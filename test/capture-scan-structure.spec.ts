import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";

const origin = "https://spatial.test";

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
  const response = await exports.default.fetch(`${origin}/api/auth/otp/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": `2001:db8::${crypto.getRandomValues(new Uint16Array(1))[0].toString(16)}`,
    },
    body: JSON.stringify({ email, challengeId, code }),
  });
  expect(response.status).toBe(200);
  const access = (response.headers.get("set-cookie") ?? "").match(/spatial_access=([^;,]+)/)?.[1];
  expect(access).toBeTruthy();
  return `spatial_access=${access}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type Fixture = {
  cookie: string;
  organisationId: string;
  userId: string;
  projectId: string;
  versionId: string;
  assetId: string;
  jobId: string;
  sourceSha256: string;
};

// The E57 bytes are never parsed by the Worker; the container reading arrives
// from the processor as a bounded summary plus an immutable report derivative.
const sourceBytes = new Uint8Array([0x41, 0x53, 0x54, 0x4d, 0x2d, 0x45, 0x35, 0x37]);

async function seedEvidenceJob(): Promise<Fixture> {
  const cookie = await login();
  const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      clientOperationId: crypto.randomUUID(),
      name: `Structured E57 ${crypto.randomUUID().slice(0, 8)}`,
      captureAdapter: "fjd-trion",
      deliveryTemplate: "property-tour",
    }),
  });
  expect(projectResponse.status).toBe(201);
  const { project } = await projectResponse.json<{ project: { id: string } }>();
  const projectRow = await env.DB.prepare(
    "SELECT organisation_id, created_by FROM projects WHERE id = ?",
  ).bind(project.id).first<{ organisation_id: string; created_by: string }>();
  const organisationId = projectRow!.organisation_id;
  const userId = projectRow!.created_by;
  const versionId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const sourceSha256 = await sha256Hex(sourceBytes);
  const objectKey = `masters-private/${organisationId}/${project.id}/${versionId}/station-set.e57`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO scene_versions
        (id, project_id, version_number, status, source_provenance_json, created_by)
      VALUES (?, ?, 1, 'PROCESSING', '{}', ?)
    `).bind(versionId, project.id, userId),
    env.DB.prepare(`
      INSERT INTO assets
        (id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, etag, sha256, integrity_status, integrity_source)
      VALUES (?, ?, ?, ?, 'source', 'e57', ?, 'station-set.e57', 'application/octet-stream',
        ?, 'source-etag', ?, 'verified', 'server_verified')
    `).bind(
      assetId,
      organisationId,
      project.id,
      versionId,
      objectKey,
      sourceBytes.byteLength,
      sourceSha256,
    ),
    // The vendor semantic purpose must survive the widened upload_sessions
    // CHECK constraint, otherwise the evidence could only be shoehorned in.
    env.DB.prepare(`
      INSERT INTO upload_sessions
        (id, organisation_id, project_id, version_id, asset_id, object_key, r2_upload_id,
          file_name, format, mime_type, expected_size_bytes, sha256, status, expires_at,
          created_by, purpose)
      VALUES (?, ?, ?, ?, ?, ?, 'r2-upload', 'station-set.e57', 'e57',
        'application/octet-stream', ?, ?, 'COMPLETED', ?, ?, 'vendor_semantic_mesh')
    `).bind(
      crypto.randomUUID(),
      organisationId,
      project.id,
      versionId,
      assetId,
      objectKey,
      sourceBytes.byteLength,
      sourceSha256,
      new Date(Date.now() + 3_600_000).toISOString(),
      userId,
    ),
    env.DB.prepare(`
      INSERT INTO processing_jobs (
        id, organisation_id, project_id, version_id, input_asset_id, job_type,
        processor_version, idempotency_key, state, priority, max_attempts,
        progress_message
      ) VALUES (?, ?, ?, ?, ?, 'asset.evidence-validate',
        'spatial-processor/0.11.0', ?, 'QUEUED', 60, 3,
        'Waiting for an evidence worker')
    `).bind(
      jobId,
      organisationId,
      project.id,
      versionId,
      assetId,
      crypto.randomUUID(),
    ),
  ]);
  return {
    cookie,
    organisationId,
    userId,
    projectId: project.id,
    versionId,
    assetId,
    jobId,
    sourceSha256,
  };
}

async function leaseJob(jobId: string): Promise<string> {
  const response = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.WORKER_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ workerId: "e57-structure-reader", jobId }),
  });
  expect(response.status).toBe(200);
  const lease = await response.json<{ leaseToken: string }>();
  return lease.leaseToken;
}

async function storeStructureReport(fixture: Fixture): Promise<{
  objectKey: string;
  sizeBytes: number;
  sha256: string;
}> {
  const reportBytes = new TextEncoder().encode(`${JSON.stringify({
    schemaVersion: "whymelabs.e57-structure.v1",
    method: "e57-structure-parser-v1",
    summary: {
      scanCount: 2,
      imageCount: 1,
      hasPerScanPoses: true,
      vendorFieldNames: ["fjd:segmentId", "fjd:surfaceClass"],
    },
  }, null, 2)}\n`);
  const objectKey =
    `reports-private/${fixture.organisationId}/${fixture.projectId}/${fixture.versionId}/e57-structure.json`;
  await env.SPATIAL_ASSETS.put(objectKey, reportBytes);
  return {
    objectKey,
    sizeBytes: reportBytes.byteLength,
    sha256: await sha256Hex(reportBytes),
  };
}

describe("public E57 container structure evidence", () => {
  it("persists the bounded reading, binds it to the stored report, and surfaces it read-only", async () => {
    const fixture = await seedEvidenceJob();
    const leaseToken = await leaseJob(fixture.jobId);
    const report = await storeStructureReport(fixture);

    const completion = await exports.default.fetch(
      `${origin}/api/worker/jobs/${fixture.jobId}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leaseToken,
          progressMessage: "Immutable capture evidence passed bounded integrity validation",
          outputs: [{
            kind: "report",
            format: "json",
            objectKey: report.objectKey,
            fileName: "e57-structure.json",
            mimeType: "application/json",
            sha256: report.sha256,
          }],
          report: { source: { sha256: fixture.sourceSha256 } },
          captureScanStructure: {
            status: "structure_read",
            method: "e57-structure-parser-v1",
            scanCount: 2,
            imageCount: 1,
            hasPerScanPoses: true,
            vendorFieldNames: ["fjd:segmentId", "fjd:surfaceClass"],
            reportSha256: report.sha256,
          },
          evidence: {
            processorVersion: "spatial-processor/0.11.0",
            computeDurationMs: 12,
            activeHumanDurationMs: 0,
            inputBytes: sourceBytes.byteLength,
            outputBytes: report.sizeBytes,
            toolVersions: { validator: "bounded-file-signature-v1", e57Structure: "e57-structure-parser-v1" },
          },
        }),
      },
    );
    expect(completion.status).toBe(200);
    const completed = await completion.json<{ outputs: Array<{ id: string; kind: string }> }>();
    const reportAssetId = completed.outputs.find((output) => output.kind === "report")?.id;
    expect(reportAssetId).toBeTruthy();

    const stored = await env.DB.prepare(`
      SELECT asset_id, job_id, report_asset_id, method, status, source_format,
        scan_count, image_count, has_per_scan_poses, vendor_field_names_json,
        report_sha256, unreadable_reason
      FROM capture_scan_structures
      WHERE organisation_id = ? AND job_id = ?
    `).bind(fixture.organisationId, fixture.jobId).first<Record<string, unknown>>();
    expect(stored).toEqual({
      asset_id: fixture.assetId,
      job_id: fixture.jobId,
      report_asset_id: reportAssetId,
      method: "e57-structure-parser-v1",
      status: "structure_read",
      source_format: "e57",
      scan_count: 2,
      image_count: 1,
      has_per_scan_poses: 1,
      vendor_field_names_json: JSON.stringify(["fjd:segmentId", "fjd:surfaceClass"]),
      report_sha256: report.sha256,
      unreadable_reason: null,
    });

    const spatial = await exports.default.fetch(
      `${origin}/api/projects/${fixture.projectId}/spatial?versionId=${fixture.versionId}`,
      { headers: { cookie: fixture.cookie } },
    );
    expect(spatial.status).toBe(200);
    const workspace = await spatial.json<{
      captureScanStructures: Array<Record<string, unknown>>;
    }>();
    expect(workspace.captureScanStructures).toHaveLength(1);
    expect(workspace.captureScanStructures[0]).toMatchObject({
      assetId: fixture.assetId,
      assetFileName: "station-set.e57",
      reportAssetId,
      reportFileName: "e57-structure.json",
      status: "structure_read",
      sourceFormat: "e57",
      scanCount: 2,
      imageCount: 1,
      hasPerScanPoses: true,
      vendorFieldNames: ["fjd:segmentId", "fjd:surfaceClass"],
      unreadableReason: null,
    });
    // The Studio may list the vendor names, but the API must keep saying that
    // their meaning was never decoded.
    expect(workspace.captureScanStructures[0]!.limitation).toContain("not parsed");
  });

  it("refuses a claimed reading that cites no stored report derivative", async () => {
    const fixture = await seedEvidenceJob();
    const leaseToken = await leaseJob(fixture.jobId);

    const completion = await exports.default.fetch(
      `${origin}/api/worker/jobs/${fixture.jobId}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leaseToken,
          progressMessage: "Immutable capture evidence passed bounded integrity validation",
          outputs: [],
          report: { source: { sha256: fixture.sourceSha256 } },
          captureScanStructure: {
            status: "structure_read",
            method: "e57-structure-parser-v1",
            scanCount: 2,
            imageCount: 1,
            hasPerScanPoses: true,
            vendorFieldNames: ["fjd:surfaceClass"],
            reportSha256: "b".repeat(64),
          },
          evidence: {
            processorVersion: "spatial-processor/0.11.0",
            computeDurationMs: 12,
            activeHumanDurationMs: 0,
            inputBytes: sourceBytes.byteLength,
            outputBytes: 0,
            toolVersions: { validator: "bounded-file-signature-v1" },
          },
        }),
      },
    );
    expect(completion.status).toBe(400);
    await expect(completion.json()).resolves.toMatchObject({
      details: {
        captureScanStructure: ["A read container structure must cite a stored report derivative by SHA-256"],
      },
    });
    const persisted = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM capture_scan_structures WHERE job_id = ?",
    ).bind(fixture.jobId).first<{ count: number }>();
    expect(persisted?.count).toBe(0);
  });

  it("records an unreadable container without blocking preservation of the bytes", async () => {
    const fixture = await seedEvidenceJob();
    const leaseToken = await leaseJob(fixture.jobId);

    const completion = await exports.default.fetch(
      `${origin}/api/worker/jobs/${fixture.jobId}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leaseToken,
          progressMessage: "Immutable capture evidence passed bounded integrity validation",
          outputs: [],
          report: { source: { sha256: fixture.sourceSha256 } },
          captureScanStructure: {
            status: "structure_unreadable",
            method: "e57-structure-parser-v1",
            scanCount: 0,
            imageCount: 0,
            hasPerScanPoses: false,
            vendorFieldNames: [],
            reportSha256: null,
            reason: "E57 page 1 CRC-32C mismatch",
          },
          evidence: {
            processorVersion: "spatial-processor/0.11.0",
            computeDurationMs: 12,
            activeHumanDurationMs: 0,
            inputBytes: sourceBytes.byteLength,
            outputBytes: 0,
            toolVersions: { validator: "bounded-file-signature-v1" },
          },
        }),
      },
    );
    expect(completion.status).toBe(200);
    const stored = await env.DB.prepare(`
      SELECT status, report_asset_id, unreadable_reason, scan_count
      FROM capture_scan_structures WHERE job_id = ?
    `).bind(fixture.jobId).first<Record<string, unknown>>();
    expect(stored).toEqual({
      status: "structure_unreadable",
      report_asset_id: null,
      unreadable_reason: "E57 page 1 CRC-32C mismatch",
      scan_count: 0,
    });
    const asset = await env.DB.prepare(
      "SELECT integrity_status FROM assets WHERE id = ?",
    ).bind(fixture.assetId).first<{ integrity_status: string }>();
    expect(asset?.integrity_status).toBe("verified");
  });

  it("binds a pose-path claim to a structure reading and refuses an unrelated one", async () => {
    const fixture = await seedEvidenceJob();
    const leaseToken = await leaseJob(fixture.jobId);
    const report = await storeStructureReport(fixture);
    const completion = await exports.default.fetch(
      `${origin}/api/worker/jobs/${fixture.jobId}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leaseToken,
          progressMessage: "Immutable capture evidence passed bounded integrity validation",
          outputs: [{
            kind: "report",
            format: "json",
            objectKey: report.objectKey,
            fileName: "e57-structure.json",
            mimeType: "application/json",
            sha256: report.sha256,
          }],
          report: { source: { sha256: fixture.sourceSha256 } },
          captureScanStructure: {
            status: "structure_read",
            method: "e57-structure-parser-v1",
            scanCount: 2,
            imageCount: 1,
            hasPerScanPoses: true,
            vendorFieldNames: [],
            reportSha256: report.sha256,
          },
          evidence: {
            processorVersion: "spatial-processor/0.11.0",
            computeDurationMs: 12,
            activeHumanDurationMs: 0,
            inputBytes: sourceBytes.byteLength,
            outputBytes: report.sizeBytes,
            toolVersions: { validator: "bounded-file-signature-v1" },
          },
        }),
      },
    );
    expect(completion.status).toBe(200);
    const structure = await env.DB.prepare(
      "SELECT id FROM capture_scan_structures WHERE job_id = ?",
    ).bind(fixture.jobId).first<{ id: string }>();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO scene_navigation_profiles (
          version_id, organisation_id, project_id, world_unit, agent_radius,
          agent_height, eye_height, max_step_metres, updated_by
        ) VALUES (?, ?, ?, 'metres', 0.3, 1.7, 1.6, 0.2, ?)
      `).bind(fixture.versionId, fixture.organisationId, fixture.projectId, fixture.userId),
      env.DB.prepare(`
        INSERT INTO scene_entities (
          id, organisation_id, project_id, version_id, kind, label,
          geometry_json, metadata_json, created_by, world_unit
        ) VALUES (?, ?, ?, ?, 'room', 'Lobby', ?, '{}', ?, 'metres')
      `).bind(
        crypto.randomUUID(),
        fixture.organisationId,
        fixture.projectId,
        fixture.versionId,
        JSON.stringify({ type: "box", points: [[0, 0, 0], [4, 3, 4]] }),
        fixture.userId,
      ),
    ]);

    const trajectory = {
      versionId: fixture.versionId,
      source: {
        adapter: "fjd-trion",
        fileName: "trajectory.json",
        format: "canonical_pose_json_v1",
        coordinateFrame: "project-local-y-up",
        alignmentEvidence: "Operator aligned the trajectory and authored rooms to the same local frame.",
      },
      parameters: {
        coverageRadiusM: 1.25,
        maximumSampleGapM: 3,
        loopClosureRadiusM: 1,
        minimumRoomCoveragePercent: 85,
        verticalToleranceM: 0.5,
      },
      points: [
        { position: [0.5, 1.5, 0.5], timestampMs: 0 },
        { position: [2, 1.5, 0.5], timestampMs: 1000 },
        { position: [3.5, 1.5, 0.5], timestampMs: 2000 },
        { position: [3.5, 1.5, 2], timestampMs: 3000 },
        { position: [3.5, 1.5, 3.5], timestampMs: 4000 },
        { position: [2, 1.5, 3.5], timestampMs: 5000 },
        { position: [0.5, 1.5, 3.5], timestampMs: 6000 },
        { position: [0.5, 1.5, 2], timestampMs: 7000 },
        { position: [0.5, 1.5, 0.5], timestampMs: 8000 },
      ],
    };
    const headers = {
      cookie: fixture.cookie,
      "content-type": "application/json",
      origin,
    };

    const unrelated = await exports.default.fetch(
      `${origin}/api/projects/${fixture.projectId}/spatial/capture-completeness`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...trajectory,
          clientOperationId: crypto.randomUUID(),
          scanStructureId: crypto.randomUUID(),
        }),
      },
    );
    expect(unrelated.status).toBe(400);
    await expect(unrelated.json()).resolves.toMatchObject({
      details: {
        scanStructureId: ["Container structure reading is not registered against this scene version"],
      },
    });

    const bound = await exports.default.fetch(
      `${origin}/api/projects/${fixture.projectId}/spatial/capture-completeness`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...trajectory,
          clientOperationId: crypto.randomUUID(),
          scanStructureId: structure!.id,
        }),
      },
    );
    expect(bound.status).toBe(201);
    const created = await bound.json<{ report: { id: string; scanStructureId: string | null } }>();
    expect(created.report.scanStructureId).toBe(structure!.id);
    const persisted = await env.DB.prepare(
      "SELECT scan_structure_id FROM capture_completeness_reports WHERE id = ?",
    ).bind(created.report.id).first<{ scan_structure_id: string | null }>();
    expect(persisted?.scan_structure_id).toBe(structure!.id);
  });
});
