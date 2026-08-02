import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";
import { currentNavigationAuthoringState } from "../src/worker/index";
import { sha256Hex } from "../src/worker/security";
import { buildAuthoredStructuralCollisionGlb } from "../scripts/authored-collision.mjs";

const origin = "https://spatial.test";
let addressSequence = 8800;

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

describe("vendor-neutral floor-plan workflow", () => {
  it("moves immutable metric evidence through operator correction to SVG, PDF, and DXF", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Floor plan ${crypto.randomUUID().slice(0, 8)}`,
        captureAdapter: "open-import",
        deliveryTemplate: "venue-navigator",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const storedProject = await env.DB.prepare(
      "SELECT organisation_id, created_by FROM projects WHERE id = ?",
    ).bind(project.id).first<{ organisation_id: string; created_by: string }>();
    expect(storedProject).toBeTruthy();

    const versionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const source = registeredPointCloud();
    const objectKey =
      `masters-private/${storedProject!.organisation_id}/${project.id}/${versionId}/registered.ply`;
    await env.SPATIAL_ASSETS.put(objectKey, source);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO scene_versions
          (id, project_id, version_number, status, source_provenance_json, created_by)
        VALUES (?, ?, 1, 'QA_REQUIRED', '{"registered":true,"units":"metres","upAxis":"y"}', ?)
      `).bind(versionId, project.id, storedProject!.created_by),
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, sha256, integrity_status
        ) VALUES (?, ?, ?, ?, 'pointcloud', 'ply', ?, 'registered.ply',
          'application/octet-stream', ?, ?, 'verified')
      `).bind(
        assetId,
        storedProject!.organisation_id,
        project.id,
        versionId,
        objectKey,
        source.byteLength,
        await sha256Hex(source),
      ),
    ]);

    const queueRequest = {
      clientOperationId: crypto.randomUUID(),
      versionId,
      inputAssetId: assetId,
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
    };
    const unhashedAssetId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO assets (
        id, organisation_id, project_id, version_id, kind, format, object_key,
        file_name, mime_type, size_bytes, sha256, integrity_status
      ) VALUES (?, ?, ?, ?, 'pointcloud', 'ply', ?, 'unhashed.ply',
        'application/octet-stream', ?, NULL, 'verified')
    `).bind(
      unhashedAssetId,
      storedProject!.organisation_id,
      project.id,
      versionId,
      `${objectKey}.unhashed`,
      source.byteLength,
    ).run();
    const unhashedQueue = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/floorplan-extractions`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...queueRequest,
          clientOperationId: crypto.randomUUID(),
          inputAssetId: unhashedAssetId,
        }),
      },
    );
    expect(unhashedQueue.status).toBe(409);
    await expect(unhashedQueue.json()).resolves.toMatchObject({
      error: "Point-cloud asset is missing the immutable SHA-256 required for floor-plan extraction",
    });

    const create = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/floorplan-extractions`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(queueRequest),
      },
    );
    expect(create.status).toBe(202);
    const created = await create.json<{
      extraction: { id: string; jobId: string; status: string };
    }>();
    expect(created.extraction.status).toBe("QUEUED");

    const replay = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/floorplan-extractions`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(queueRequest),
      },
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      extraction: { id: created.extraction.id, jobId: created.extraction.jobId },
      idempotent: true,
    });

    const leaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workerId: "floorplan-contract-test" }),
    });
    expect(leaseResponse.status).toBe(200);
    const lease = await leaseResponse.json<{
      leaseToken: string;
      job: {
        id: string;
        jobType: string;
        floorplanExtractionId: string;
        floorplanConfig: Record<string, unknown>;
        input: { id: string; format: string };
      };
    }>();
    expect(lease.job).toMatchObject({
      id: created.extraction.jobId,
      jobType: "floorplan.extract-v1",
      floorplanExtractionId: created.extraction.id,
      input: { id: assetId, format: "ply" },
      floorplanConfig: {
        coordinateAssurance: "registered_y_up_metric_frame",
        gridSizeM: 0.25,
        wallMaxHeightM: 2.5,
      },
    });

    const roomPoints = [[0, 0, 0], [4, 0, 0], [4, 0, 3], [0, 0, 3]];
    const parameters = {
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
    };
    const report = {
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
      parameters,
      summary: {
        inferredFloorElevationM: 0,
        credibleHorizontalLayerCount: 2,
        wallCellCount: 40,
        wallCount: 4,
        roomCount: 1,
        openingCount: 1,
        totalRoomAreaM2: 12,
      },
      rooms: [{
        roomKey: "room-001",
        kind: "room_candidate",
        label: "Living room",
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
      openings: [{
        openingKey: "opening-001",
        kind: "opening_candidate",
        label: "Opening 1",
        widthM: 1,
        elevationM: 0,
        heightM: null,
        confidence: 0.7,
        geometry: { type: "line", points: [[1.5, 0, 0], [2.5, 0, 0]] },
        evidence: { classification: "door_or_window_unknown" },
      }],
      humanReviewRequired: true,
      limitations: [
        "The operator must correct and approve every proposal before an indicative export is generated.",
      ],
    };
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
        processorVersion: "spatial-processor/0.9.0",
        computeDurationMs: 42,
        activeHumanDurationMs: 0,
        inputBytes: source.byteLength,
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
    const tamperedCompletion = await exports.default.fetch(
      `${origin}/api/worker/jobs/${lease.job.id}/floorplan-extraction-complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...completionBody,
          output: { ...completionBody.output, sha256: "0".repeat(64) },
        }),
      },
    );
    expect(tamperedCompletion.status).toBe(422);
    expect(await tamperedCompletion.json()).toMatchObject({
      error: "Request cannot be applied",
      details: {
        output: ["Floor-plan proposal SHA-256 does not match the immutable R2 object"],
      },
    });
    const mismatchedReportCompletion = await exports.default.fetch(
      `${origin}/api/worker/jobs/${lease.job.id}/floorplan-extraction-complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...completionBody,
          report: {
            ...completionBody.report,
            rooms: completionBody.report.rooms.map((room, index) =>
              index === 0 ? { ...room, label: "Report not stored in R2" } : room),
          },
        }),
      },
    );
    expect(mismatchedReportCompletion.status).toBe(422);
    await expect(mismatchedReportCompletion.json()).resolves.toMatchObject({
      details: {
        output: ["Stored floor-plan proposal does not match the report submitted for approval"],
      },
    });
    const unboundedReportCompletion = await exports.default.fetch(
      `${origin}/api/worker/jobs/${lease.job.id}/floorplan-extraction-complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...completionBody,
          report: {
            ...completionBody.report,
            source: {
              ...completionBody.report.source,
              sampledPointCount: queueRequest.maximumSamplePoints + 1,
            },
          },
        }),
      },
    );
    expect(unboundedReportCompletion.status).toBe(400);
    await expect(unboundedReportCompletion.json()).resolves.toMatchObject({
      details: {
        report: ["Floor-plan sampled point count exceeds or omits the queued processing bound"],
      },
    });
    const storedParameters = await env.DB.prepare(
      "SELECT parameters_json FROM floorplan_extraction_runs WHERE job_id = ?",
    ).bind(lease.job.id).first<{ parameters_json: string }>();
    await env.DB.prepare(
      "UPDATE floorplan_extraction_runs SET parameters_json = ? WHERE job_id = ?",
    ).bind(
      JSON.stringify({ ...JSON.parse(storedParameters!.parameters_json), automaticPipeline: true }),
      lease.job.id,
    ).run();
    const collisionBytes = buildAuthoredStructuralCollisionGlb({
      schemaVersion: "authored-structural-collision-v2",
      provenance: "registered_metric_mesh",
      floorRectangles: [{ id: "floor-1", min: [0, 0], max: [4, 3], elevation: 0 }],
      ceilingRectangles: [{ id: "ceiling-1", min: [0, 0], max: [4, 3], elevation: 2.5 }],
      barrierSegments: [
        { id: "north-left", start: [0, 0], end: [1.5, 0], minY: 0, maxY: 2.5 },
        { id: "north-right", start: [2.5, 0], end: [4, 0], minY: 0, maxY: 2.5 },
        { id: "east", start: [4, 0], end: [4, 3], minY: 0, maxY: 2.5 },
        { id: "south", start: [4, 3], end: [0, 3], minY: 0, maxY: 2.5 },
        { id: "west", start: [0, 3], end: [0, 0], minY: 0, maxY: 2.5 },
      ],
      furnitureBoxes: [],
      dynamicBarrierBoxes: [],
    });
    const collisionResponse = await exports.default.fetch(
      `${origin}/api/worker/jobs/${lease.job.id}/outputs/collision/automatic-collision.glb`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "x-job-lease": lease.leaseToken,
          "content-type": "model/gltf-binary",
          "content-length": String(collisionBytes.byteLength),
        },
        body: collisionBytes,
      },
    );
    expect(collisionResponse.status).toBe(201);
    const collisionOutput = await collisionResponse.json<{ output: Record<string, unknown> }>();
    const automaticCompletionBody = {
      ...completionBody,
      collisionOutput: {
        ...collisionOutput.output,
        sha256: await sha256Hex(collisionBytes),
      },
      evidence: {
        ...completionBody.evidence,
        outputBytes: reportBytes.byteLength + collisionBytes.byteLength,
      },
    };
    const complete = await exports.default.fetch(
      `${origin}/api/worker/jobs/${lease.job.id}/floorplan-extraction-complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(automaticCompletionBody),
      },
    );
    expect(complete.status).toBe(200);
    const completed = await complete.json<{
      extraction: { status: string; proposalHash: string };
      automaticNavigation: { id: string; jobId: string; status: string };
    }>();
    expect(completed.extraction).toMatchObject({
      status: "READY_FOR_REVIEW",
      proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(completed.automaticNavigation).toMatchObject({ status: "QUEUED" });
    const automaticNavigation = await env.DB.prepare(`
      SELECT b.status, j.state, a.kind, a.format
      FROM scene_navigation_builds b
      JOIN processing_jobs j ON j.id = b.job_id
      JOIN assets a ON a.id = b.collision_asset_id
      WHERE b.id = ?
    `).bind(completed.automaticNavigation.id).first<{
      status: string;
      state: string;
      kind: string;
      format: string;
    }>();
    expect(automaticNavigation).toEqual({
      status: "QUEUED",
      state: "QUEUED",
      kind: "collision",
      format: "glb",
    });
    await env.DB.prepare(`
      UPDATE scene_navigation_builds
      SET status = 'READY_FOR_REVIEW', artifact_json = '{}'
      WHERE id = ?
    `).bind(completed.automaticNavigation.id).run();
    const proposalNavigationReview = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/navigation-builds/` +
        `${completed.automaticNavigation.id}/review`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          decision: "approve",
          note: "Attempting to approve the preliminary proposal navigation evidence.",
        }),
      },
    );
    expect(proposalNavigationReview.status).toBe(409);
    await expect(proposalNavigationReview.json()).resolves.toMatchObject({
      error: expect.stringContaining("proposal preview"),
    });
    // The approved-plan recook must be self-sufficient even when no proposal
    // preview was able to create the default profile.
    await env.DB.prepare(
      "DELETE FROM scene_navigation_profiles WHERE version_id = ?",
    ).bind(versionId).run();

    const plan = {
      schemaVersion: "1.0.0",
      units: "metres",
      coordinateFrame: "registered_y_up_metric_frame",
      levels: [
        {
          id: "level-1",
          label: "Ground floor",
          elevationM: 0,
          ceilingElevationM: 2.5,
          rooms: [{ id: "living-room", label: "Living room", points: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
          walls: [
            { id: "wall-1", label: "North wall", start: [0, 0], end: [4, 0], thicknessM: 0.2, heightM: 2.5 },
            { id: "wall-2", label: "East wall", start: [4, 0], end: [4, 3], thicknessM: 0.2, heightM: 2.5 },
            { id: "wall-3", label: "South wall", start: [4, 3], end: [0, 3], thicknessM: 0.2, heightM: 2.5 },
            { id: "wall-4", label: "West wall", start: [0, 3], end: [0, 0], thicknessM: 0.2, heightM: 2.5 },
          ],
          openings: [{
            id: "entry-door",
            label: "Entry door",
            type: "door",
            wallId: "wall-1",
            start: [1.5, 0],
            end: [2.5, 0],
            widthM: 1,
            heightM: 2.1,
          }],
        },
        {
          id: "level-2",
          label: "Upper floor",
          elevationM: 3,
          ceilingElevationM: 5.5,
          rooms: [{ id: "upper-room", label: "Upper room", points: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
          walls: [
            { id: "wall-5", label: "Upper north wall", start: [0, 0], end: [4, 0], thicknessM: 0.2, heightM: 2.5 },
            { id: "wall-6", label: "Upper east wall", start: [4, 0], end: [4, 3], thicknessM: 0.2, heightM: 2.5 },
            { id: "wall-7", label: "Upper south wall", start: [4, 3], end: [0, 3], thicknessM: 0.2, heightM: 2.5 },
            { id: "wall-8", label: "Upper west wall", start: [0, 3], end: [0, 0], thicknessM: 0.2, heightM: 2.5 },
          ],
          openings: [],
        },
      ],
      connectors: [{
        id: "stair-1",
        label: "Main stair",
        type: "stairs",
        lowerLevelId: "level-1",
        upperLevelId: "level-2",
        points: [[1.5, 0, 0.4], [1.5, 3, 2.6], [2.5, 3, 2.6], [2.5, 0, 0.4]],
      }],
    };
    const reviewUrl =
      `${origin}/api/projects/${project.id}/spatial/floorplan-extractions/${created.extraction.id}/review`;
    const reviewBody = {
      decision: "approve",
      note: "Operator corrected the opening classification and checked every wall against the source.",
      plan,
    };
    const reviewResponses = await Promise.all([
      exports.default.fetch(reviewUrl, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ ...reviewBody, clientOperationId: crypto.randomUUID() }),
      }),
      exports.default.fetch(reviewUrl, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ ...reviewBody, clientOperationId: crypto.randomUUID() }),
      }),
    ]);
    expect(reviewResponses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winningReview = reviewResponses.find((response) => response.status === 200)!;
    const reviewed = await winningReview.json<{
      revision: { id: string; planHash: string; measurementClass: string };
      collisionAssetId: string;
      automaticNavigation: {
        id: string;
        jobId: string;
        status: string;
        floorplanRevisionId: string;
        planHash: string;
      };
    }>();
    expect(reviewed.revision).toMatchObject({
      id: expect.any(String),
      planHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      measurementClass: "indicative",
    });
    expect(reviewed.collisionAssetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(reviewed.automaticNavigation).toMatchObject({
      status: "QUEUED",
      floorplanRevisionId: reviewed.revision.id,
      planHash: reviewed.revision.planHash,
    });
    const correctedBuild = await env.DB.prepare(`
      SELECT b.parameters_json, b.authoring_hash, j.state,
        a.sha256 AS collision_sha256, a.object_key
      FROM scene_navigation_builds b
      JOIN processing_jobs j ON j.id = b.job_id
      JOIN assets a ON a.id = b.collision_asset_id
      WHERE b.id = ?
    `).bind(reviewed.automaticNavigation.id).first<{
      parameters_json: string;
      authoring_hash: string;
      state: string;
      collision_sha256: string;
      object_key: string;
    }>();
    expect(correctedBuild).toBeTruthy();
    expect(JSON.parse(correctedBuild!.parameters_json)).toMatchObject({
      automaticLayout: {
        floorplanExtractionId: created.extraction.id,
        floorplanRevisionId: reviewed.revision.id,
        planHash: reviewed.revision.planHash,
      },
      source: {
        assetId: reviewed.collisionAssetId,
        sha256: correctedBuild!.collision_sha256,
        authoringHash: correctedBuild!.authoring_hash,
      },
    });
    expect(correctedBuild!.state).toBe("QUEUED");
    expect(await env.SPATIAL_ASSETS.head(correctedBuild!.object_key)).toBeTruthy();
    const correctedProfile = await env.DB.prepare(`
      SELECT world_unit, agent_radius, agent_height
      FROM scene_navigation_profiles WHERE version_id = ?
    `).bind(versionId).first<{
      world_unit: string;
      agent_radius: number;
      agent_height: number;
    }>();
    expect(correctedProfile).toEqual({
      world_unit: "metres",
      agent_radius: 0.25,
      agent_height: 1.7,
    });
    const revisionReceipt = await env.DB.prepare(`
      SELECT collision_asset_id, collision_sha256, navigation_receipt_version
      FROM floorplan_revisions WHERE id = ?
    `).bind(reviewed.revision.id).first<{
      collision_asset_id: string;
      collision_sha256: string;
      navigation_receipt_version: string;
    }>();
    expect(revisionReceipt).toEqual({
      collision_asset_id: reviewed.collisionAssetId,
      collision_sha256: correctedBuild!.collision_sha256,
      navigation_receipt_version: "floorplan-navigation-receipt-v1",
    });
    const currentNavigation = await currentNavigationAuthoringState(
      env.DB,
      storedProject!.organisation_id,
      project.id,
      versionId,
    );
    expect(currentNavigation.authoringHash).toBe(correctedBuild!.authoring_hash);

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE scene_navigation_builds
        SET status = 'READY_FOR_REVIEW', artifact_json = '{}'
        WHERE id = ?
      `).bind(reviewed.automaticNavigation.id),
      env.DB.prepare(`
        UPDATE scene_navigation_profiles SET max_speed = 1.7 WHERE version_id = ?
      `).bind(versionId),
    ]);
    const staleNavigationReview = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/navigation-builds/` +
        `${reviewed.automaticNavigation.id}/review`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          decision: "approve",
          note: "This build predates the navigation profile edit.",
        }),
      },
    );
    expect(staleNavigationReview.status).toBe(409);
    await expect(staleNavigationReview.json()).resolves.toMatchObject({
      error: expect.stringContaining("Navigation authoring changed after this build"),
    });
    const approvedRevisionCount = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM floorplan_revisions
      WHERE extraction_id = ? AND status = 'approved'
    `).bind(created.extraction.id).first<{ count: number }>();
    expect(approvedRevisionCount?.count).toBe(1);

    const exportOperationId = crypto.randomUUID();
    const exportRequest = { clientOperationId: exportOperationId, formats: ["svg", "pdf", "dxf"] };
    const exportUrl =
      `${origin}/api/projects/${project.id}/spatial/floorplan-revisions/${reviewed.revision.id}/exports`;
    const [firstExportResponse, concurrentExportResponse] = await Promise.all([
      exports.default.fetch(exportUrl, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(exportRequest),
      }),
      exports.default.fetch(exportUrl, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          formats: ["svg", "pdf", "dxf"],
        }),
      }),
    ]);
    expect([firstExportResponse.status, concurrentExportResponse.status].sort()).toEqual([200, 201]);
    const [exported, concurrentExported] = await Promise.all([
      firstExportResponse.json<{
        exports: Array<{ id: string; format: string; downloadUrl: string; sha256: string }>;
      }>(),
      concurrentExportResponse.json<{
        exports: Array<{ id: string; format: string; downloadUrl: string; sha256: string }>;
      }>(),
    ]);
    expect(concurrentExported.exports).toEqual(exported.exports);
    expect(exported.exports.map((item) => item.format).sort()).toEqual(["dxf", "pdf", "svg"]);
    const exportCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM floorplan_exports WHERE revision_id = ?",
    ).bind(reviewed.revision.id).first<{ count: number }>();
    expect(exportCount?.count).toBe(3);

    for (const item of exported.exports) {
      const download = await exports.default.fetch(`${origin}${item.downloadUrl}`, {
        headers: { cookie },
      });
      expect(download.status).toBe(200);
      const bytes = new Uint8Array(await download.arrayBuffer());
      expect(await sha256Hex(bytes)).toBe(item.sha256);
      const text = new TextDecoder().decode(bytes);
      if (item.format === "pdf") {
        expect(text.startsWith("%PDF-1.4")).toBe(true);
        expect(text).toContain("/Count 2");
      }
      if (item.format === "dxf") {
        expect(text).toContain("INDICATIVE ONLY");
        expect(text).toContain("CONNECTOR");
      }
      if (item.format === "svg") {
        expect(text).toContain("not a survey");
        expect(text).toContain("class=\"connector\"");
        expect(text).toContain("Upper floor");
      }
    }

    const exportReplay = await exports.default.fetch(
      exportUrl,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(exportRequest),
      },
    );
    expect(exportReplay.status).toBe(200);
    await expect(exportReplay.json()).resolves.toMatchObject({ idempotent: true });

    const measurementCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM measurement_deliverables WHERE project_id = ?",
    ).bind(project.id).first<{ count: number }>();
    expect(measurementCount?.count).toBe(0);

    const concurrentExtractionIds = [crypto.randomUUID(), crypto.randomUUID()];
    const concurrentJobIds = [crypto.randomUUID(), crypto.randomUUID()];
    const concurrentRequestHashes = await Promise.all(
      concurrentExtractionIds.map((_, index) => sha256Hex(`sequence-${index}`)),
    );
    await env.DB.batch(concurrentExtractionIds.flatMap((extractionId, index) => [
      env.DB.prepare(`
        INSERT INTO processing_jobs (
          id, organisation_id, project_id, version_id, input_asset_id,
          job_type, processor_version, idempotency_key, state
        ) VALUES (?, ?, ?, ?, ?, 'floorplan.extract-v1', 'spatial-processor/0.9.0', ?, 'SUCCEEDED')
      `).bind(
        concurrentJobIds[index],
        storedProject!.organisation_id,
        project.id,
        versionId,
        assetId,
        `floorplan-sequence-test:${concurrentJobIds[index]}`,
      ),
      env.DB.prepare(`
        INSERT INTO floorplan_extraction_runs (
          id, organisation_id, project_id, version_id, input_asset_id, job_id,
          normalizer, status, parameters_json, source_evidence_json,
          proposal_json, proposal_hash, client_operation_id, request_hash, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, 'native-ply-v1', 'READY_FOR_REVIEW', ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        extractionId,
        storedProject!.organisation_id,
        project.id,
        versionId,
        assetId,
        concurrentJobIds[index],
        JSON.stringify(parameters),
        JSON.stringify({ registrationEvidence: queueRequest.registrationEvidence }),
        JSON.stringify(report),
        completed.extraction.proposalHash,
        crypto.randomUUID(),
        concurrentRequestHashes[index],
        storedProject!.created_by,
      ),
    ]));
    const concurrentRevisionResponses = await Promise.all(
      concurrentExtractionIds.map((extractionId) => exports.default.fetch(
        `${origin}/api/projects/${project.id}/spatial/floorplan-extractions/${extractionId}/review`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            ...reviewBody,
            clientOperationId: crypto.randomUUID(),
          }),
        },
      )),
    );
    expect(concurrentRevisionResponses.map((response) => response.status)).toEqual([200, 200]);
    const revisions = await env.DB.prepare(`
      SELECT revision_number FROM floorplan_revisions
      WHERE organisation_id = ? AND project_id = ? AND version_id = ?
      ORDER BY revision_number
    `).bind(storedProject!.organisation_id, project.id, versionId).all<{
      revision_number: number;
    }>();
    expect(revisions.results.map((row) => row.revision_number)).toEqual([1, 2, 3]);

    const cancellableQueue = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/floorplan-extractions`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...queueRequest,
          clientOperationId: crypto.randomUUID(),
        }),
      },
    );
    expect(cancellableQueue.status).toBe(202);
    const cancellable = await cancellableQueue.json<{
      extraction: { id: string; jobId: string };
    }>();
    const cancel = await exports.default.fetch(
      `${origin}/api/jobs/${cancellable.extraction.jobId}/cancel`,
      {
        method: "POST",
        headers: { cookie, origin },
      },
    );
    expect(cancel.status).toBe(200);
    const cancelledExtraction = await env.DB.prepare(
      "SELECT status FROM floorplan_extraction_runs WHERE id = ?",
    ).bind(cancellable.extraction.id).first<{ status: string }>();
    expect(cancelledExtraction?.status).toBe("CANCELLED");
    const retry = await exports.default.fetch(
      `${origin}/api/jobs/${cancellable.extraction.jobId}/retry`,
      {
        method: "POST",
        headers: { cookie, origin },
      },
    );
    expect(retry.status).toBe(200);
    const retriedExtraction = await env.DB.prepare(
      "SELECT status FROM floorplan_extraction_runs WHERE id = ?",
    ).bind(cancellable.extraction.id).first<{ status: string }>();
    expect(retriedExtraction?.status).toBe("QUEUED");
  });
});
