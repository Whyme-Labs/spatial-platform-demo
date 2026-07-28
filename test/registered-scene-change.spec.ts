import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";
import { sha256Hex } from "../src/worker/security";

const origin = "https://spatial.test";
let addressSequence = 5000;

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

function ply(rows: string[]): Uint8Array {
  return new TextEncoder().encode([
    "ply",
    "format ascii 1.0",
    `element vertex ${rows.length}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "end_header",
    ...rows,
    "",
  ].join("\n"));
}

describe("registered raw-scene change evidence", () => {
  it("queues exact registered PLY inputs, leases both, and persists processor evidence for review", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Registered change ${crypto.randomUUID().slice(0, 8)}`,
        captureAdapter: "open-import",
        deliveryTemplate: "operations-twin",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const project = await projectResponse.json<{ project: { id: string } }>();
    const storedProject = await env.DB.prepare(
      "SELECT organisation_id, created_by FROM projects WHERE id = ?",
    ).bind(project.project.id).first<{ organisation_id: string; created_by: string }>();
    expect(storedProject).toBeTruthy();

    const baselineVersionId = crypto.randomUUID();
    const candidateVersionId = crypto.randomUUID();
    const baselineAssetId = crypto.randomUUID();
    const candidateAssetId = crypto.randomUUID();
    const baselineBytes = ply([
      "0.10 0 0.10 255 0 0",
      "1.10 0 0.10 0 255 0",
    ]);
    const candidateBytes = ply([
      "0.30 0 0.10 0 0 255",
      "2.10 0 0.10 255 255 255",
    ]);
    const baselineKey = `masters-private/${storedProject!.organisation_id}/${project.project.id}/${baselineVersionId}/baseline.ply`;
    const candidateKey = `masters-private/${storedProject!.organisation_id}/${project.project.id}/${candidateVersionId}/candidate.ply`;
    await Promise.all([
      env.SPATIAL_ASSETS.put(baselineKey, baselineBytes),
      env.SPATIAL_ASSETS.put(candidateKey, candidateBytes),
    ]);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO scene_versions
          (id, project_id, version_number, status, source_provenance_json, created_by)
        VALUES (?, ?, 1, 'QA_REQUIRED', '{"registered":true}', ?)
      `).bind(baselineVersionId, project.project.id, storedProject!.created_by),
      env.DB.prepare(`
        INSERT INTO scene_versions
          (id, project_id, version_number, status, source_provenance_json, created_by)
        VALUES (?, ?, 2, 'QA_REQUIRED', '{"registered":true}', ?)
      `).bind(candidateVersionId, project.project.id, storedProject!.created_by),
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, sha256, integrity_status
        ) VALUES (?, ?, ?, ?, 'master', 'ply', ?, 'baseline.ply',
          'application/octet-stream', ?, ?, 'verified')
      `).bind(
        baselineAssetId,
        storedProject!.organisation_id,
        project.project.id,
        baselineVersionId,
        baselineKey,
        baselineBytes.byteLength,
        await sha256Hex(baselineBytes),
      ),
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, sha256, integrity_status
        ) VALUES (?, ?, ?, ?, 'master', 'ply', ?, 'candidate.ply',
          'application/octet-stream', ?, ?, 'verified')
      `).bind(
        candidateAssetId,
        storedProject!.organisation_id,
        project.project.id,
        candidateVersionId,
        candidateKey,
        candidateBytes.byteLength,
        await sha256Hex(candidateBytes),
      ),
    ]);

    const clientOperationId = crypto.randomUUID();
    const requestBody = {
      clientOperationId,
      baselineVersionId,
      candidateVersionId,
      baselineAssetId,
      candidateAssetId,
      registrationMode: "declared",
      coordinateAssurance: "registered_project_frame",
      registrationEvidence: "Both immutable PLY assets were aligned to the same verified project control.",
      voxelSizeM: 0.25,
      structuralChangeThresholdPercent: 2,
      photometricChangeThresholdPercent: 12,
      centroidChangeThresholdMm: 50,
      maximumSamplePoints: 100_000,
    };
    const create = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}/spatial/raw-change-reports`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      },
    );
    expect(create.status).toBe(202);
    const created = await create.json<{ report: { id: string; jobId: string; status: string } }>();
    expect(created.report.status).toBe("QUEUED");

    const replay = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}/spatial/raw-change-reports`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      },
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      report: { id: created.report.id, jobId: created.report.jobId },
      idempotent: true,
    });

    const lease = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workerId: "registered-change-test" }),
    });
    expect(lease.status).toBe(200);
    const leased = await lease.json<{
      leaseToken: string;
      job: {
        id: string;
        jobType: string;
        changeReportId: string;
        changeConfig: { voxelSizeM: number; coordinateAssurance: string; registrationMode: string };
        input: { id: string; downloadUrl: string };
        secondaryInput: { id: string; downloadUrl: string };
      };
    }>();
    expect(leased.job).toMatchObject({
      id: created.report.jobId,
      jobType: "registered-scene-change-v1",
      changeReportId: created.report.id,
      changeConfig: {
        voxelSizeM: 0.25,
        coordinateAssurance: "registered_project_frame",
        registrationMode: "declared",
      },
      input: { id: baselineAssetId },
      secondaryInput: { id: candidateAssetId },
    });
    for (const [input, expected] of [
      [leased.job.input, baselineBytes],
      [leased.job.secondaryInput, candidateBytes],
    ] as const) {
      const response = await exports.default.fetch(new URL(input.downloadUrl, origin), {
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "x-job-lease": leased.leaseToken,
        },
      });
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(expected);
    }

    const report = {
      schemaVersion: "1.0.0",
      method: "registered-ply-voxel-change-v1",
      result: "changes_detected",
      summary: {
        baselineVoxels: 2,
        candidateVoxels: 2,
        commonVoxels: 1,
        addedVoxels: 1,
        removedVoxels: 1,
        structurallyChangedPercent: 66.67,
      },
      registration: {
        status: "accepted",
        coordinateAssurance: "registered_project_frame",
        performedByProcessor: false,
      },
      limitation: "Registered voxel evidence requires human review.",
    };
    const reportBytes = new TextEncoder().encode(`${JSON.stringify(report)}\n`);
    const outputResponse = await exports.default.fetch(
      `${origin}/api/worker/jobs/${leased.job.id}/outputs/report/change-report.json`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "x-job-lease": leased.leaseToken,
          "content-type": "application/json",
          "content-length": String(reportBytes.byteLength),
        },
        body: reportBytes,
      },
    );
    expect(outputResponse.status).toBe(201);
    const output = await outputResponse.json<{ output: Record<string, unknown> }>();
    const complete = await exports.default.fetch(
      `${origin}/api/worker/jobs/${leased.job.id}/scene-change-complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leaseToken: leased.leaseToken,
          progressMessage: "Registered comparison ready",
          output: output.output,
          report,
          evidence: {
            processorVersion: "spatial-processor/0.2.0",
            computeDurationMs: 42,
            activeHumanDurationMs: 0,
            baselineInputBytes: baselineBytes.byteLength,
            candidateInputBytes: candidateBytes.byteLength,
            inputBytes: baselineBytes.byteLength + candidateBytes.byteLength,
            outputBytes: reportBytes.byteLength,
            toolVersions: { processor: "0.2.0" },
          },
        }),
      },
    );
    expect(complete.status).toBe(200);
    await expect(complete.json()).resolves.toMatchObject({
      job: { id: leased.job.id, state: "SUCCEEDED" },
      report: { id: created.report.id, status: "COMPLETED", result: "changes_detected" },
      reportAssetId: expect.any(String),
    });

    const workspace = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}/spatial?versionId=${candidateVersionId}`,
      { headers: { cookie } },
    );
    expect(workspace.status).toBe(200);
    await expect(workspace.json()).resolves.toMatchObject({
      rawChangeReports: [{
        id: created.report.id,
        status: "COMPLETED",
        job_state: "SUCCEEDED",
        result: "changes_detected",
        baseline_version_number: 1,
        candidate_version_number: 2,
      }],
    });

    const review = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}/spatial/raw-change-reports/${created.report.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          decision: "investigate",
          note: "The occupancy delta is material; inspect the added region against site records.",
        }),
      },
    );
    expect(review.status).toBe(200);
    await expect(review.json()).resolves.toMatchObject({
      report: {
        id: created.report.id,
        status: "REVIEWED",
        reviewDecision: "investigate",
      },
    });

    const automaticCreate = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}/spatial/raw-change-reports`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...requestBody,
          clientOperationId: crypto.randomUUID(),
          registrationMode: "automatic_rigid",
          coordinateAssurance: "shared_local_frame",
          registrationEvidence:
            "Both exports use metres and the same gravity-aligned axis convention; origin and yaw require bounded registration.",
          registrationSearchRadiusM: 1,
          registrationMaximumRmseMm: 100,
          registrationMinimumOverlapPercent: 55,
        }),
      },
    );
    expect(automaticCreate.status).toBe(202);
    const automatic = await automaticCreate.json<{
      report: { id: string; jobId: string };
    }>();
    const automaticLeaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workerId: "automatic-registration-test" }),
    });
    expect(automaticLeaseResponse.status).toBe(200);
    const automaticLease = await automaticLeaseResponse.json<{
      leaseToken: string;
      job: {
        id: string;
        changeConfig: {
          registrationMode: string;
          registrationSearchRadiusM: number;
          registrationMaximumRmseMm: number;
          registrationMinimumOverlapPercent: number;
        };
      };
    }>();
    expect(automaticLease.job.changeConfig).toMatchObject({
      registrationMode: "automatic_rigid",
      registrationSearchRadiusM: 1,
      registrationMaximumRmseMm: 100,
      registrationMinimumOverlapPercent: 55,
    });
    const blockedReport = {
      schemaVersion: "1.0.0",
      method: "registered-ply-voxel-change-v1",
      result: "registration_blocked",
      summary: {
        baselineVoxels: 2,
        candidateVoxels: 2,
        commonVoxels: 0,
        addedVoxels: 0,
        removedVoxels: 0,
        structurallyChangedPercent: 0,
      },
      materialSignals: [
        "Automatic registration did not pass every declared quality gate; change analysis was not run.",
      ],
      registration: {
        method: "bounded-yaw-icp-v1",
        status: "blocked",
        performedByProcessor: true,
        transform: {
          matrix4x4: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
        summary: {
          rmseMm: 500,
          overlapPercent: 20,
          ambiguous: false,
        },
      },
      limitation: "Automatic alignment remains human-reviewed evidence.",
    };
    const blockedBytes = new TextEncoder().encode(`${JSON.stringify(blockedReport)}\n`);
    const blockedOutputResponse = await exports.default.fetch(
      `${origin}/api/worker/jobs/${automaticLease.job.id}/outputs/report/registration-blocked.json`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "x-job-lease": automaticLease.leaseToken,
          "content-type": "application/json",
          "content-length": String(blockedBytes.byteLength),
        },
        body: blockedBytes,
      },
    );
    expect(blockedOutputResponse.status).toBe(201);
    const blockedOutput = await blockedOutputResponse.json<{
      output: Record<string, unknown>;
    }>();
    const blockedComplete = await exports.default.fetch(
      `${origin}/api/worker/jobs/${automaticLease.job.id}/scene-change-complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leaseToken: automaticLease.leaseToken,
          progressMessage: "Automatic registration was blocked and is ready for human review",
          output: blockedOutput.output,
          report: blockedReport,
          evidence: {
            processorVersion: "spatial-processor/0.3.0",
            computeDurationMs: 51,
            activeHumanDurationMs: 0,
            baselineInputBytes: baselineBytes.byteLength,
            candidateInputBytes: candidateBytes.byteLength,
            inputBytes: baselineBytes.byteLength + candidateBytes.byteLength,
            outputBytes: blockedBytes.byteLength,
            toolVersions: { processor: "0.3.0" },
          },
        }),
      },
    );
    expect(blockedComplete.status).toBe(200);
    await expect(blockedComplete.json()).resolves.toMatchObject({
      report: {
        id: automatic.report.id,
        status: "COMPLETED",
        result: "registration_blocked",
      },
    });
    const blockedStored = await env.DB.prepare(`
      SELECT result, registration_status, registration_summary_json
      FROM registered_scene_change_reports WHERE id = ?
    `).bind(automatic.report.id).first<{
      result: string | null;
      registration_status: string;
      registration_summary_json: string;
    }>();
    expect(blockedStored).toMatchObject({
      result: null,
      registration_status: "blocked",
    });
    expect(JSON.parse(blockedStored!.registration_summary_json)).toMatchObject({
      method: "bounded-yaw-icp-v1",
      status: "blocked",
    });
  });
});
