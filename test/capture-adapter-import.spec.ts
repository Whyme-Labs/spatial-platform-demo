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

describe("capture adapter evidence ingestion", () => {
  it("binds an authored SOG opening camera to the immutable version and processor lease", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Native SOG ${crypto.randomUUID().slice(0, 8)}`,
        captureAdapter: "open-import",
        deliveryTemplate: "property-tour",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const posterCamera = {
      position: [-3.25, 0.708, -0.236],
      target: [-2.372, 0.55, 0.138],
      up: [0, 1, 0],
      fovDegrees: 65,
    };
    const sourceBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const uploadResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/uploads`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          fileName: "home.sog",
          sizeBytes: sourceBytes.byteLength,
          format: "sog",
          purpose: "web_scene",
          mimeType: "application/octet-stream",
          posterCamera,
        }),
      },
    );
    expect(uploadResponse.status).toBe(201);
    const { upload } = await uploadResponse.json<{ upload: { id: string; versionId: string } }>();
    const version = await env.DB.prepare(
      "SELECT source_provenance_json FROM scene_versions WHERE id = ?",
    ).bind(upload.versionId).first<{ source_provenance_json: string }>();
    expect(JSON.parse(version?.source_provenance_json ?? "{}")).toMatchObject({ posterCamera });

    const partResponse = await exports.default.fetch(
      `${origin}/api/uploads/${upload.id}/parts/1`,
      {
        method: "PUT",
        headers: { cookie, "content-length": String(sourceBytes.byteLength) },
        body: sourceBytes,
      },
    );
    const { part } = await partResponse.json<{ part: { etag: string } }>();
    const completeResponse = await exports.default.fetch(
      `${origin}/api/uploads/${upload.id}/complete`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ parts: [{ partNumber: 1, etag: part.etag }] }),
      },
    );
    const completed = await completeResponse.json<{ job: { id: string } }>();
    expect(completeResponse.status).toBe(200);

    const leaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workerId: `test-native-sog-${crypto.randomUUID()}`,
        jobId: completed.job.id,
      }),
    });
    expect(leaseResponse.status).toBe(200);
    await expect(leaseResponse.json()).resolves.toMatchObject({
      job: {
        id: completed.job.id,
        posterCamera,
        input: { format: "sog", purpose: "web_scene" },
      },
    });
  });

  it("creates a drone project and routes source imagery to integrity validation, not Spark", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Drone capture ${crypto.randomUUID().slice(0, 8)}`,
        captureAdapter: "drone-imagery",
        deliveryTemplate: "operations-twin",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const sourceBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

    const uploadResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/uploads`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          fileName: "aerial-images.zip",
          sizeBytes: sourceBytes.byteLength,
          format: "zip",
          purpose: "source_images",
          mimeType: "application/zip",
        }),
      },
    );
    expect(uploadResponse.status).toBe(201);
    const { upload } = await uploadResponse.json<{ upload: { id: string } }>();
    const partResponse = await exports.default.fetch(
      `${origin}/api/uploads/${upload.id}/parts/1`,
      {
        method: "PUT",
        headers: { cookie, "content-length": String(sourceBytes.byteLength) },
        body: sourceBytes,
      },
    );
    expect(partResponse.status).toBe(200);
    const { part } = await partResponse.json<{ part: { etag: string } }>();

    const completeResponse = await exports.default.fetch(
      `${origin}/api/uploads/${upload.id}/complete`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ parts: [{ partNumber: 1, etag: part.etag }] }),
      },
    );
    expect(completeResponse.status).toBe(200);
    await expect(completeResponse.json()).resolves.toMatchObject({
      asset: { kind: "source", purpose: "source_images" },
      job: { type: "asset.evidence-validate", state: "QUEUED" },
    });

    const stored = await env.DB.prepare(`
      SELECT a.kind, a.format, j.job_type
      FROM upload_sessions u
      JOIN assets a ON a.id = u.asset_id
      JOIN processing_jobs j ON j.input_asset_id = a.id
      WHERE u.id = ?
    `).bind(upload.id).first<{ kind: string; format: string; job_type: string }>();
    expect(stored).toEqual({
      kind: "source",
      format: "zip",
      job_type: "asset.evidence-validate",
    });
  });

  it("rejects an incompatible purpose and format before creating an R2 upload", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Phone capture ${crypto.randomUUID().slice(0, 8)}`,
        captureAdapter: "phone-video",
        deliveryTemplate: "property-tour",
      }),
    });
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const rejected = await exports.default.fetch(`${origin}/api/projects/${project.id}/uploads`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "walkthrough.mp4",
        sizeBytes: 2048,
        format: "mp4",
        purpose: "gaussian_splat",
        mimeType: "video/mp4",
      }),
    });
    expect(rejected.status).toBe(422);
    await expect(rejected.json()).resolves.toMatchObject({
      error: expect.stringContaining("not compatible"),
    });
  });
});
