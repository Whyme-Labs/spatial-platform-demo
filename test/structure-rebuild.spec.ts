// Re-running the automatic structure lane over evidence already attached to a
// version. Without this, a trajectory or corrected geometry added after
// intake is unusable: only the intake lane produces a reviewable proposal,
// and re-uploading registered geometry is refused because it must carry its
// original paired-capture receipt.
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";
import { sha256Hex } from "../src/worker/security";

const origin = "https://spatial.test";
let addressSequence = 9300;

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

async function seedVersion(cookie: string, options: { withGeometry: boolean }) {
  const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      clientOperationId: crypto.randomUUID(),
      name: `Structure rebuild ${crypto.randomUUID().slice(0, 8)}`,
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
  const statements = [
    env.DB.prepare(`
      INSERT INTO scene_versions
        (id, project_id, version_number, status, manifest_json, source_provenance_json,
          created_by, workflow_policy_revision_id)
      VALUES (?, ?, 1, 'APPROVED', '{}', '{}', ?, ?)
    `).bind(versionId, project.id, stored!.created_by, stored!.workflow_policy_revision_id),
  ];
  let assetId: string | null = null;
  if (options.withGeometry) {
    assetId = crypto.randomUUID();
    const uploadId = crypto.randomUUID();
    const bytes = new TextEncoder().encode("ply\nformat ascii 1.0\nend_header\n0 0 0\n");
    statements.push(
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, sha256, integrity_status
        ) VALUES (?, ?, ?, ?, 'pointcloud', 'ply', ?, 'registered.ply',
          'application/octet-stream', ?, ?, 'verified')
      `).bind(
        assetId,
        stored!.organisation_id,
        project.id,
        versionId,
        `masters-private/${stored!.organisation_id}/${project.id}/${versionId}/registered.ply`,
        bytes.byteLength,
        await sha256Hex(bytes),
      ),
      env.DB.prepare(`
        INSERT INTO upload_sessions (
          id, organisation_id, project_id, version_id, asset_id, object_key,
          r2_upload_id, file_name, format, mime_type, expected_size_bytes,
          status, expires_at, created_by, purpose
        ) VALUES (?, ?, ?, ?, ?, ?, 'r2-upload', 'registered.ply', 'ply',
          'application/octet-stream', ?, 'COMPLETED', ?, ?, 'metric_point_cloud')
      `).bind(
        uploadId,
        stored!.organisation_id,
        project.id,
        versionId,
        assetId,
        `masters-private/${stored!.organisation_id}/${project.id}/${versionId}/registered.ply`,
        bytes.byteLength,
        new Date(Date.now() + 3_600_000).toISOString(),
        stored!.created_by,
      ),
    );
  }
  await env.DB.batch(statements);
  return { projectId: project.id, versionId, assetId };
}

function rebuild(cookie: string, projectId: string, versionId: string, operationId?: string) {
  return exports.default.fetch(
    `${origin}/api/projects/${projectId}/spatial/versions/${versionId}/structure-rebuilds`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ clientOperationId: operationId ?? crypto.randomUUID() }),
    },
  );
}

describe("structure rebuild from attached capture", () => {
  it("queues a fresh extraction bound to the version's own geometry", async () => {
    const cookie = await login();
    const seeded = await seedVersion(cookie, { withGeometry: true });
    const response = await rebuild(cookie, seeded.projectId, seeded.versionId);
    expect(response.status).toBe(202);
    const body = await response.json<{ extraction: { id: string; jobId: string; status: string } }>();
    expect(body.extraction.status).toBe("QUEUED");
    const run = await env.DB.prepare(`
      SELECT input_asset_id, version_id, json_extract(parameters_json, '$.automaticPipeline') AS automatic
      FROM floorplan_extraction_runs WHERE id = ?
    `).bind(body.extraction.id).first<{
      input_asset_id: string;
      version_id: string;
      automatic: number;
    }>();
    // It must reuse the version's registered geometry and run the SAME
    // automatic lane — that is what produces a reviewable walking map.
    expect(run!.input_asset_id).toBe(seeded.assetId);
    expect(run!.version_id).toBe(seeded.versionId);
    expect(run!.automatic).toBe(1);
  }, 120_000);

  it("is replay-safe per operation but allows a genuine second rebuild", async () => {
    const cookie = await login();
    const seeded = await seedVersion(cookie, { withGeometry: true });
    const operationId = crypto.randomUUID();
    const first = await rebuild(cookie, seeded.projectId, seeded.versionId, operationId);
    const replay = await rebuild(cookie, seeded.projectId, seeded.versionId, operationId);
    const firstBody = await first.json<{ extraction: { id: string } }>();
    const replayBody = await replay.json<{ extraction: { id: string } }>();
    expect(replayBody.extraction.id).toBe(firstBody.extraction.id);

    const second = await rebuild(cookie, seeded.projectId, seeded.versionId);
    const secondBody = await second.json<{ extraction: { id: string } }>();
    expect(secondBody.extraction.id).not.toBe(firstBody.extraction.id);
  }, 120_000);

  it("refuses a version with no verified metric geometry", async () => {
    const cookie = await login();
    const seeded = await seedVersion(cookie, { withGeometry: false });
    const response = await rebuild(cookie, seeded.projectId, seeded.versionId);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      details: { versionId: [expect.stringContaining("no verified metric point cloud")] },
    });
  }, 120_000);
});
