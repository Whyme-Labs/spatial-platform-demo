// Attaching supporting evidence to an already-approved version must not send
// that version back through QA: the upload promises it does not replace the
// immutable scene bytes, and the published release keeps serving. Only a kind
// that could BECOME the published scene still forces re-approval.
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";
import { sha256Hex } from "../src/worker/security";
import { processorLeaseRequest, testProcessorIdentity } from "./helpers/processor-identity";

const origin = "https://spatial.test";
let addressSequence = 9700;

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
  const access = (response.headers.get("set-cookie") ?? "").match(/spatial_access=([^;,]+)/)?.[1];
  return `spatial_access=${access}`;
}

async function seedPublishedVersion(cookie: string) {
  const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      clientOperationId: crypto.randomUUID(),
      name: `Evidence demotion ${crypto.randomUUID().slice(0, 8)}`,
      captureAdapter: "fjd-trion",
      deliveryTemplate: "Property showcase",
    }),
  });
  const { project } = await projectResponse.json<{ project: { id: string } }>();
  const stored = await env.DB.prepare(
    "SELECT organisation_id, created_by, workflow_policy_revision_id FROM projects WHERE id = ?",
  ).bind(project.id).first<{
    organisation_id: string;
    created_by: string;
    workflow_policy_revision_id: string;
  }>();
  const versionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO scene_versions
        (id, project_id, version_number, status, manifest_json, source_provenance_json,
          created_by, workflow_policy_revision_id)
      VALUES (?, ?, 1, 'PUBLISHED', '{}', ?, ?, ?)
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
      stored!.created_by,
      stored!.workflow_policy_revision_id,
    ),
    env.DB.prepare(
      "UPDATE projects SET status = 'PUBLISHED' WHERE id = ?",
    ).bind(project.id),
  ]);
  return { projectId: project.id, versionId, organisationId: stored!.organisation_id };
}

async function uploadEvidence(input: {
  cookie: string;
  projectId: string;
  versionId: string;
  purpose: string;
  format: string;
  fileName: string;
  bytes: Uint8Array;
}): Promise<string> {
  const create = await exports.default.fetch(`${origin}/api/projects/${input.projectId}/uploads`, {
    method: "POST",
    headers: { cookie: input.cookie, "content-type": "application/json" },
    body: JSON.stringify({
      clientOperationId: crypto.randomUUID(),
      targetVersionId: input.versionId,
      fileName: input.fileName,
      sizeBytes: input.bytes.byteLength,
      format: input.format,
      purpose: input.purpose,
      mimeType: "application/octet-stream",
      sha256: await sha256Hex(input.bytes),
    }),
  });
  expect(create.status).toBe(201);
  const upload = await create.json<{ upload: { id: string } }>();
  const part = await exports.default.fetch(
    `${origin}/api/uploads/${upload.upload.id}/parts/1`,
    { method: "PUT", headers: { cookie: input.cookie }, body: input.bytes },
  );
  if (part.status !== 200) throw new Error(`part ${part.status}: ${await part.text()}`);
  const { part: uploadedPart } = await part.json<{ part: { etag: string } }>();
  const completed = await exports.default.fetch(
    `${origin}/api/uploads/${upload.upload.id}/complete`,
    {
      method: "POST",
      headers: { cookie: input.cookie, "content-type": "application/json" },
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: uploadedPart.etag }] }),
    },
  );
  if (completed.status !== 200) throw new Error(`complete ${completed.status}: ${await completed.text()}`);
  const body = await completed.json<{ job: { id: string } }>();
  return body.job.id;
}

async function completeEvidenceJob(jobId: string, bytes: Uint8Array) {
  const leaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.WORKER_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(processorLeaseRequest(`evidence-${crypto.randomUUID()}`, jobId)),
  });
  expect(leaseResponse.status).toBe(200);
  const lease = await leaseResponse.json<{ leaseToken: string }>();
  const response = await exports.default.fetch(`${origin}/api/worker/jobs/${jobId}/complete`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.WORKER_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      leaseToken: lease.leaseToken,
      progressMessage: "Evidence verified",
      outputs: [],
      report: { source: { sha256: await sha256Hex(bytes) } },
      evidence: {
        processorIdentity: testProcessorIdentity,
        processorVersion: "spatial-evidence/1.0.0",
        computeDurationMs: 10,
        activeHumanDurationMs: 0,
        inputBytes: bytes.byteLength,
        outputBytes: 0,
        toolVersions: { processor: "test" },
      },
    }),
  });
  return response;
}

async function versionStatus(versionId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT status FROM scene_versions WHERE id = ?")
    .bind(versionId).first<{ status: string }>();
  return row!.status;
}

describe("evidence uploads and QA state", () => {
  it("keeps a published version published when scanner evidence is attached", async () => {
    const cookie = await login();
    const seeded = await seedPublishedVersion(cookie);
    const bytes = new TextEncoder().encode("LASF-trajectory-evidence-fixture");
    const jobId = await uploadEvidence({
      cookie,
      projectId: seeded.projectId,
      versionId: seeded.versionId,
      purpose: "scanner_trajectory",
      format: "las",
      fileName: "capture.trajectory.las",
      bytes,
    });
    const completion = await completeEvidenceJob(jobId, bytes);
    expect(completion.status).toBe(200);
    expect(await versionStatus(seeded.versionId)).toBe("PUBLISHED");
  }, 120_000);

  it("keeps it published for metric geometry too", async () => {
    const cookie = await login();
    const seeded = await seedPublishedVersion(cookie);
    const bytes = new TextEncoder().encode("ply\nformat ascii 1.0\nend_header\n0 0 0\n");
    const jobId = await uploadEvidence({
      cookie,
      projectId: seeded.projectId,
      versionId: seeded.versionId,
      purpose: "metric_point_cloud",
      format: "ply",
      fileName: "registered.ply",
      bytes,
    });
    const completion = await completeEvidenceJob(jobId, bytes);
    expect(completion.status).toBe(200);
    expect(await versionStatus(seeded.versionId)).toBe("PUBLISHED");
  }, 120_000);
});
