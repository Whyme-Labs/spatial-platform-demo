// Wayfinder (#30/#31): the scanner-trajectory capture input. Covers the pin's
// immutability bar at extraction creation, the lease payload, the leased
// inputs/trajectory route, and the fail-closed completion reconciliation in
// both directions (pinned-without-evidence and evidence-without-pin).
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";
import { sha256Hex } from "../src/worker/security";
import { processorLeaseRequest, testProcessorIdentity } from "./helpers/processor-identity";

const origin = "https://spatial.test";
let addressSequence = 9600;

async function login(): Promise<string> {
  const email = env.ADMIN_EMAIL.toLowerCase();
  const challengeId = crypto.randomUUID();
  const code = "424242";
  await env.DB.prepare(`
    INSERT INTO auth_otp_challenges (id, email, code_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(
    challengeId,
    email,
    await otpHash(challengeId, email, code, env.OTP_PEPPER),
    new Date(Date.now() + 60_000).toISOString(),
  ).run();
  addressSequence += 1;
  const response = await exports.default.fetch(`${origin}/api/auth/otp/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": `2001:db8::${addressSequence.toString(16)}`,
    },
    body: JSON.stringify({ email, challengeId, code }),
  });
  expect(response.status).toBe(200);
  const access = (response.headers.get("set-cookie") ?? "").match(/spatial_access=([^;,]+)/)?.[1];
  expect(access).toBeTruthy();
  return `spatial_access=${access}`;
}

function registeredPointCloud(): Uint8Array {
  const points = [
    "0 0 0", "4 0 0", "4 0 3", "0 0 3",
    "0 2.5 0", "4 2.5 0", "4 2.5 3", "0 2.5 3",
  ];
  return new TextEncoder().encode([
    "ply",
    "format ascii 1.0",
    `element vertex ${points.length}`,
    "property float x",
    "property float y",
    "property float z",
    "end_header",
    ...points,
    "",
  ].join("\n"));
}

type Fixture = {
  cookie: string;
  projectId: string;
  organisationId: string;
  versionId: string;
  pointCloudAssetId: string;
  pointCloudBytes: Uint8Array;
  trajectoryAssetId: string;
  trajectoryBytes: Uint8Array;
  trajectorySha256: string;
  queueRequest: Record<string, unknown>;
};

async function createFixture(): Promise<Fixture> {
  const cookie = await login();
  const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      clientOperationId: crypto.randomUUID(),
      name: `Wayfinder ${crypto.randomUUID().slice(0, 8)}`,
      captureAdapter: "fjd-trion",
      deliveryTemplate: "venue-navigator",
    }),
  });
  expect(projectResponse.status).toBe(201);
  const { project } = await projectResponse.json<{ project: { id: string } }>();
  const storedProject = await env.DB.prepare(
    "SELECT organisation_id, created_by, workflow_policy_revision_id FROM projects WHERE id = ?",
  ).bind(project.id).first<{
    organisation_id: string;
    created_by: string;
    workflow_policy_revision_id: string;
  }>();
  expect(storedProject).toBeTruthy();

  const versionId = crypto.randomUUID();
  const pointCloudAssetId = crypto.randomUUID();
  const pointCloudBytes = registeredPointCloud();
  const pointCloudKey =
    `masters-private/${storedProject!.organisation_id}/${project.id}/${versionId}/registered.ply`;
  const trajectoryAssetId = crypto.randomUUID();
  const trajectoryBytes = new TextEncoder().encode(
    "LASF-wayfinder-test-trajectory-bytes",
  );
  const trajectorySha256 = await sha256Hex(trajectoryBytes);
  const trajectoryKey =
    `raw-private/${storedProject!.organisation_id}/${project.id}/${versionId}/${trajectoryAssetId}/scan.trajectory.las`;
  await env.SPATIAL_ASSETS.put(pointCloudKey, pointCloudBytes);
  await env.SPATIAL_ASSETS.put(trajectoryKey, trajectoryBytes);
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO scene_versions
        (id, project_id, version_number, status, source_provenance_json, created_by,
          workflow_policy_revision_id)
      VALUES (?, ?, 1, 'QA_REQUIRED', ?, ?, ?)
    `).bind(
      versionId,
      project.id,
      JSON.stringify({
        registered: true,
        units: "metres",
        upAxis: "y",
        assetProducer: "fjd-trion",
        adapter: "fjd-trion",
      }),
      storedProject!.created_by,
      storedProject!.workflow_policy_revision_id,
    ),
    env.DB.prepare(`
      INSERT INTO assets (
        id, organisation_id, project_id, version_id, kind, format, object_key,
        file_name, mime_type, size_bytes, sha256, integrity_status
      ) VALUES (?, ?, ?, ?, 'pointcloud', 'ply', ?, 'registered.ply',
        'application/octet-stream', ?, ?, 'verified')
    `).bind(
      pointCloudAssetId,
      storedProject!.organisation_id,
      project.id,
      versionId,
      pointCloudKey,
      pointCloudBytes.byteLength,
      await sha256Hex(pointCloudBytes),
    ),
    env.DB.prepare(`
      INSERT INTO assets (
        id, organisation_id, project_id, version_id, kind, format, object_key,
        file_name, mime_type, size_bytes, sha256, integrity_status
      ) VALUES (?, ?, ?, ?, 'source', 'las', ?, 'scan.trajectory.las',
        'application/octet-stream', ?, ?, 'verified')
    `).bind(
      trajectoryAssetId,
      storedProject!.organisation_id,
      project.id,
      versionId,
      trajectoryKey,
      trajectoryBytes.byteLength,
      trajectorySha256,
    ),
  ]);
  return {
    cookie,
    projectId: project.id,
    organisationId: storedProject!.organisation_id,
    versionId,
    pointCloudAssetId,
    pointCloudBytes,
    trajectoryAssetId,
    trajectoryBytes,
    trajectorySha256,
    queueRequest: {
      clientOperationId: crypto.randomUUID(),
      versionId,
      inputAssetId: pointCloudAssetId,
      coordinateAssurance: "registered_y_up_metric_frame",
      sourceUpAxis: "y",
      registrationEvidence:
        "Operator checked the immutable source transform, metres, and Y-up project frame.",
      gridSizeM: 0.25,
      floorBandM: 0.15,
      wallMinHeightM: 0.25,
      wallMaxHeightM: 2.5,
      minimumWallHeightCoverage: 0.45,
      minimumRoomAreaM2: 2,
      maximumOpeningWidthM: 1.25,
      maximumRooms: 100,
      maximumSamplePoints: 100_000,
      elevationHintM: null,
    },
  };
}

function proposalReport(fixture: Fixture): Record<string, unknown> {
  const roomPoints = [[0, 0, 0], [4, 0, 0], [4, 0, 3], [0, 0, 3]];
  return {
    schemaVersion: "1.0.0",
    method: "metric-pointcloud-floorplan-v1",
    result: "proposal_ready",
    measurementClass: "indicative",
    source: {
      sourceFormat: "ply",
      normalizedFormat: "ply",
      coordinateAssurance: "registered_y_up_metric_frame",
      sampledPointCount: 5_000,
    },
    parameters: {
      gridSizeM: 0.25,
      floorBandM: 0.15,
      wallMinHeightM: 0.25,
      wallMaxHeightM: 2.5,
      minimumWallHeightCoverage: 0.45,
      minimumRoomAreaM2: 2,
      maximumOpeningWidthM: 1.25,
      maximumRooms: 100,
      maximumSamplePoints: 100_000,
      sourceUpAxis: "y",
      elevationHintM: null,
    },
    summary: {
      inferredFloorElevationM: 0,
      credibleHorizontalLayerCount: 2,
      wallCellCount: 40,
      wallCount: 4,
      roomCount: 1,
      openingCount: 0,
      totalRoomAreaM2: 12,
    },
    rooms: [{
      roomKey: "room-001",
      kind: "room_candidate",
      label: "Hall",
      elevationM: 0,
      areaM2: 12,
      confidence: 0.82,
      geometry: { type: "polygon", points: roomPoints },
      evidence: { occupiedCellCount: 192 },
    }],
    walls: [
      [[0, 0, 0], [4, 0, 0]],
      [[4, 0, 0], [4, 0, 3]],
      [[4, 0, 3], [0, 0, 3]],
      [[0, 0, 3], [0, 0, 0]],
    ].map((points, index) => ({
      wallKey: `wall-${String(index + 1).padStart(3, "0")}`,
      kind: "wall_candidate",
      label: `Wall ${index + 1}`,
      elevationM: 0,
      heightM: 2.5,
      thicknessM: 0.25,
      confidence: 0.8,
      geometry: { type: "line", points },
      evidence: { supportingCellCount: 10 },
    })),
    openings: [],
    trajectoryEvidence: {
      schemaVersion: "trajectory-evidence-v1",
      trajectory: {
        assetId: fixture.trajectoryAssetId,
        sha256: fixture.trajectorySha256,
        sourceFormat: "las",
        vertexCount: 240,
        sampledPointCount: 240,
        samplingStride: 1,
      },
      parameters: {
        minimumVisitedSamples: 3,
        carryHeightBandM: { minimum: 0.2, maximum: 3 },
      },
      sampleCount: 240,
      unassignedSampleCount: 0,
      levels: [{
        levelId: "level-001",
        elevationM: 0,
        sampleCount: 240,
        rooms: [{ roomId: "room-001", sampleCount: 240, visited: true }],
      }],
      visitedRoomIds: ["level-001/room-001"],
    },
    humanReviewRequired: true,
    limitations: [
      "The operator must correct and approve every proposal before an indicative export is generated.",
    ],
  };
}

async function leaseQueuedJob(): Promise<{
  leaseToken: string;
  job: Record<string, unknown> & { id: string };
}> {
  const leaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.WORKER_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(processorLeaseRequest("wayfinder-trajectory-test")),
  });
  expect(leaseResponse.status).toBe(200);
  return await leaseResponse.json();
}

describe("wayfinder scanner-trajectory capture input", () => {
  it("pins, serves, and fail-closed-reconciles the trajectory through the extraction lane", async () => {
    const fixture = await createFixture();
    const extractionsUrl =
      `${origin}/api/projects/${fixture.projectId}/spatial/floorplan-extractions`;
    const queue = (body: Record<string, unknown>) =>
      exports.default.fetch(extractionsUrl, {
        method: "POST",
        headers: { cookie: fixture.cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const unknownTrajectory = await queue({
      ...fixture.queueRequest,
      clientOperationId: crypto.randomUUID(),
      trajectoryAssetId: crypto.randomUUID(),
    });
    expect(unknownTrajectory.status).toBe(404);

    // The metric point cloud itself is a verified asset, but it is not a
    // LAS/LAZ source: the pin must reject it as trajectory evidence.
    const wrongKind = await queue({
      ...fixture.queueRequest,
      clientOperationId: crypto.randomUUID(),
      trajectoryAssetId: fixture.pointCloudAssetId,
    });
    expect(wrongKind.status).toBe(422);
    await expect(wrongKind.json()).resolves.toMatchObject({
      details: {
        trajectoryAssetId: [
          "Scanner trajectory evidence requires a LAS or LAZ source asset",
        ],
      },
    });

    const unhashedTrajectoryId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO assets (
        id, organisation_id, project_id, version_id, kind, format, object_key,
        file_name, mime_type, size_bytes, sha256, integrity_status
      ) VALUES (?, ?, ?, ?, 'source', 'las', ?, 'unhashed.trajectory.las',
        'application/octet-stream', 64, NULL, 'verified')
    `).bind(
      unhashedTrajectoryId,
      fixture.organisationId,
      fixture.projectId,
      fixture.versionId,
      `raw-private/${fixture.organisationId}/${fixture.projectId}/${fixture.versionId}/${unhashedTrajectoryId}/unhashed.trajectory.las`,
    ).run();
    const unhashedTrajectory = await queue({
      ...fixture.queueRequest,
      clientOperationId: crypto.randomUUID(),
      trajectoryAssetId: unhashedTrajectoryId,
    });
    expect(unhashedTrajectory.status).toBe(409);
    await expect(unhashedTrajectory.json()).resolves.toMatchObject({
      error: "Scanner trajectory asset is missing the immutable SHA-256 required as traversal evidence",
    });

    const create = await queue({
      ...fixture.queueRequest,
      trajectoryAssetId: fixture.trajectoryAssetId,
    });
    expect(create.status).toBe(202);
    const created = await create.json<{
      extraction: { id: string; jobId: string; status: string };
    }>();
    expect(created.extraction.status).toBe("QUEUED");

    const lease = await leaseQueuedJob();
    expect(lease.job).toMatchObject({
      id: created.extraction.jobId,
      jobType: "floorplan.extract-v1",
      floorplanTrajectory: {
        assetId: fixture.trajectoryAssetId,
        sha256: fixture.trajectorySha256,
        sourceFormat: "las",
        sizeBytes: fixture.trajectoryBytes.byteLength,
        fileName: "scan.trajectory.las",
      },
    });

    const served = await exports.default.fetch(
      `${origin}/api/worker/jobs/${lease.job.id}/inputs/trajectory`,
      { headers: { authorization: `Bearer ${env.WORKER_API_TOKEN}`, "x-job-lease": lease.leaseToken } },
    );
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(fixture.trajectoryBytes);

    const report = proposalReport(fixture);
    const reportBytes = new TextEncoder().encode(`${JSON.stringify(report)}\n`);
    const outputResponse = await exports.default.fetch(
      `${origin}/api/worker/jobs/${lease.job.id}/outputs/report/floorplan-proposal.json`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "x-job-lease": lease.leaseToken,
          "content-type": "application/json",
          "content-length": String(reportBytes.byteLength),
        },
        body: reportBytes,
      },
    );
    expect(outputResponse.status).toBe(201);
    const output = await outputResponse.json<{ output: Record<string, unknown> }>();
    const completionBody = {
      leaseToken: lease.leaseToken,
      progressMessage: "Indicative proposal ready for operator review",
      output: { ...output.output, sha256: await sha256Hex(reportBytes) },
      report,
      evidence: {
        processorIdentity: testProcessorIdentity,
        processorVersion: "spatial-processor/0.9.0",
        computeDurationMs: 42,
        activeHumanDurationMs: 0,
        inputBytes: fixture.pointCloudBytes.byteLength,
        outputBytes: reportBytes.byteLength,
        toolVersions: { processor: "0.9.0", normalizer: "native-ply-v1" },
        normalization: {
          sourceFormat: "ply",
          sourceUpAxis: "y",
          normalizedFormat: "ply",
          tool: "native-ply-v1",
          commandDigest: null,
        },
      },
    };
    const complete = (body: Record<string, unknown>) =>
      exports.default.fetch(
        `${origin}/api/worker/jobs/${lease.job.id}/floorplan-extraction-complete`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.WORKER_API_TOKEN}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );

    // A processor that silently skipped the pinned trajectory analysis must
    // not pass.
    const { trajectoryEvidence: _dropped, ...reportWithoutEvidence } = report;
    const missingEvidence = await complete({
      ...completionBody,
      report: reportWithoutEvidence,
    });
    expect(missingEvidence.status).toBe(400);
    await expect(missingEvidence.json()).resolves.toMatchObject({
      details: {
        report: [
          "A scanner trajectory is pinned for this extraction but the report carries no trajectory evidence",
        ],
      },
    });

    const evidence = report.trajectoryEvidence as {
      trajectory: Record<string, unknown>;
    };
    const mismatchedSha = await complete({
      ...completionBody,
      report: {
        ...report,
        trajectoryEvidence: {
          ...(report.trajectoryEvidence as Record<string, unknown>),
          trajectory: { ...evidence.trajectory, sha256: "0".repeat(64) },
        },
      },
    });
    expect(mismatchedSha.status).toBe(400);
    await expect(mismatchedSha.json()).resolves.toMatchObject({
      details: {
        report: ["Trajectory evidence sha256 does not match the pinned scanner trajectory"],
      },
    });

    const succeeded = await complete(completionBody);
    expect(succeeded.status).toBe(200);
    await expect(succeeded.json()).resolves.toMatchObject({
      extraction: { id: created.extraction.id, status: "READY_FOR_REVIEW" },
    });
  }, 120_000);

  it("keeps unpinned extractions exactly as before and rejects unsolicited evidence", async () => {
    const fixture = await createFixture();
    const create = await exports.default.fetch(
      `${origin}/api/projects/${fixture.projectId}/spatial/floorplan-extractions`,
      {
        method: "POST",
        headers: { cookie: fixture.cookie, "content-type": "application/json" },
        body: JSON.stringify(fixture.queueRequest),
      },
    );
    expect(create.status).toBe(202);
    const lease = await leaseQueuedJob();
    expect(lease.job).not.toHaveProperty("floorplanTrajectory");

    const served = await exports.default.fetch(
      `${origin}/api/worker/jobs/${lease.job.id}/inputs/trajectory`,
      { headers: { authorization: `Bearer ${env.WORKER_API_TOKEN}`, "x-job-lease": lease.leaseToken } },
    );
    expect(served.status).toBe(404);

    const report = proposalReport(fixture);
    const reportBytes = new TextEncoder().encode(`${JSON.stringify(report)}\n`);
    const outputResponse = await exports.default.fetch(
      `${origin}/api/worker/jobs/${lease.job.id}/outputs/report/floorplan-proposal.json`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "x-job-lease": lease.leaseToken,
          "content-type": "application/json",
          "content-length": String(reportBytes.byteLength),
        },
        body: reportBytes,
      },
    );
    expect(outputResponse.status).toBe(201);
    const output = await outputResponse.json<{ output: Record<string, unknown> }>();
    const unsolicited = await exports.default.fetch(
      `${origin}/api/worker/jobs/${lease.job.id}/floorplan-extraction-complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leaseToken: lease.leaseToken,
          progressMessage: "Indicative proposal ready for operator review",
          output: { ...output.output, sha256: await sha256Hex(reportBytes) },
          report,
          evidence: {
            processorIdentity: testProcessorIdentity,
            processorVersion: "spatial-processor/0.9.0",
            computeDurationMs: 42,
            activeHumanDurationMs: 0,
            inputBytes: fixture.pointCloudBytes.byteLength,
            outputBytes: reportBytes.byteLength,
            toolVersions: { processor: "0.9.0", normalizer: "native-ply-v1" },
            normalization: {
              sourceFormat: "ply",
              sourceUpAxis: "y",
              normalizedFormat: "ply",
              tool: "native-ply-v1",
              commandDigest: null,
            },
          },
        }),
      },
    );
    expect(unsolicited.status).toBe(400);
    await expect(unsolicited.json()).resolves.toMatchObject({
      details: {
        report: [
          "The report carries trajectory evidence but this extraction pinned no scanner trajectory",
        ],
      },
    });
  }, 120_000);
});
