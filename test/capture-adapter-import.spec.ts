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
  it("attaches collision to the approved visual version and persists the worker-verified SHA", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Collision attachment ${crypto.randomUUID().slice(0, 8)}`,
        captureAdapter: "open-import",
        deliveryTemplate: "property-tour",
      }),
    });
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const projectRow = await env.DB.prepare(
      "SELECT organisation_id, created_by FROM projects WHERE id = ?",
    ).bind(project.id).first<{ organisation_id: string; created_by: string }>();
    const versionId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO scene_versions
          (id, project_id, version_number, status, source_provenance_json, created_by)
        VALUES (?, ?, 1, 'PUBLISHED', '{}', ?)
      `).bind(versionId, project.id, projectRow!.created_by),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, etag, sha256, integrity_status)
        VALUES (?, ?, ?, ?, 'web', 'rad', ?, 'scene.rad', 'application/octet-stream',
          32, 'visual-etag', ?, 'verified')
      `).bind(
        crypto.randomUUID(),
        projectRow!.organisation_id,
        project.id,
        versionId,
        `delivery-private/${projectRow!.organisation_id}/${project.id}/${versionId}/scene.rad`,
        "1".repeat(64),
      ),
      env.DB.prepare(
        "UPDATE projects SET status = 'PUBLISHED' WHERE id = ?",
      ).bind(project.id),
    ]);

    const collisionBytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0, 0, 0]);
    const uploadResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/uploads`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          targetVersionId: versionId,
          fileName: "reviewed-collision.glb",
          sizeBytes: collisionBytes.byteLength,
          format: "glb",
          purpose: "collision_mesh",
          mimeType: "model/gltf-binary",
        }),
      },
    );
    expect(uploadResponse.status).toBe(201);
    const { upload } = await uploadResponse.json<{
      upload: { id: string; versionId: string; assetId: string };
    }>();
    expect(upload.versionId).toBe(versionId);
    const versionCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM scene_versions WHERE project_id = ?",
    ).bind(project.id).first<{ count: number }>();
    expect(versionCount?.count).toBe(1);

    const partResponse = await exports.default.fetch(
      `${origin}/api/uploads/${upload.id}/parts/1`,
      {
        method: "PUT",
        headers: { cookie, "content-length": String(collisionBytes.byteLength) },
        body: collisionBytes,
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
    const completed = await completeResponse.json<{
      job: { id: string };
      asset: { sha256: string | null; integritySource: string | null };
    }>();
    expect(completeResponse.status).toBe(200);
    // The Worker streams the finished object through DigestStream, so the
    // digest of record exists before any processor ever leases the job.
    const verifiedSha256 = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", collisionBytes)),
    ].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(completed.asset).toMatchObject({
      sha256: verifiedSha256,
      integritySource: "server_verified",
    });
    const beforeCompletion = await env.DB.prepare(
      "SELECT integrity_status, sha256, integrity_source FROM assets WHERE id = ?",
    ).bind(upload.assetId).first<{
      integrity_status: string;
      sha256: string;
      integrity_source: string;
    }>();
    expect(beforeCompletion).toEqual({
      integrity_status: "verified",
      sha256: verifiedSha256,
      integrity_source: "server_verified",
    });

    const leaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workerId: "collision-verifier", jobId: completed.job.id }),
    });
    const lease = await leaseResponse.json<{ leaseToken: string }>();
    const completionBody = (reportedSha256: string) => JSON.stringify({
      leaseToken: lease.leaseToken,
      progressMessage: "Collision integrity verified",
      outputs: [],
      report: { source: { sha256: reportedSha256 } },
      evidence: {
        processorVersion: "spatial-evidence/1.0.0",
        computeDurationMs: 10,
        activeHumanDurationMs: 0,
        inputBytes: collisionBytes.byteLength,
        outputBytes: 0,
        toolVersions: { processor: "test" },
      },
    });
    // An arbitrary processor-declared digest can never overwrite the
    // server-verified hash; it is a contradiction, not a correction.
    const contradiction = await exports.default.fetch(
      `${origin}/api/worker/jobs/${completed.job.id}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: completionBody("a".repeat(64)),
      },
    );
    expect(contradiction.status).toBe(409);
    await expect(contradiction.json()).resolves.toMatchObject({
      error: expect.stringContaining("contradicts the stored server_verified digest"),
    });
    const afterContradiction = await env.DB.prepare(
      "SELECT state, integrity_status, sha256, integrity_source FROM assets a JOIN processing_jobs j ON j.input_asset_id = a.id WHERE a.id = ?",
    ).bind(upload.assetId).first<{
      state: string;
      integrity_status: string;
      sha256: string;
      integrity_source: string;
    }>();
    expect(afterContradiction).toEqual({
      state: "LEASED",
      integrity_status: "verified",
      sha256: verifiedSha256,
      integrity_source: "server_verified",
    });

    const workerComplete = await exports.default.fetch(
      `${origin}/api/worker/jobs/${completed.job.id}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: completionBody(verifiedSha256),
      },
    );
    expect(workerComplete.status).toBe(200);
    const stored = await env.DB.prepare(`
      SELECT a.integrity_status, a.sha256, a.integrity_source,
        sv.status AS version_status, p.status AS project_status
      FROM assets a
      JOIN scene_versions sv ON sv.id = a.version_id
      JOIN projects p ON p.id = a.project_id
      WHERE a.id = ?
    `).bind(upload.assetId).first<{
      integrity_status: string;
      sha256: string;
      integrity_source: string;
      version_status: string;
      project_status: string;
    }>();
    expect(stored).toEqual({
      integrity_status: "verified",
      sha256: verifiedSha256,
      integrity_source: "server_verified",
      version_status: "PUBLISHED",
      project_status: "PUBLISHED",
    });
    const detailResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}`,
      { headers: { cookie } },
    );
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json<{
      assets: Array<{ id: string; sha256: string | null }>;
    }>();
    expect(detail.assets.find((asset) => asset.id === upload.assetId)?.sha256)
      .toBe(verifiedSha256);
  });

  it("attaches registered geometry to the visual version and queues floor-plan generation automatically", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Automatic capture ${crypto.randomUUID().slice(0, 8)}`,
        captureAdapter: "xgrids-lcc",
        deliveryTemplate: "property-tour",
      }),
    });
    const { project } = await projectResponse.json<{ project: { id: string } }>();

    const uploadBytes = async (input: {
      bytes: Uint8Array;
      fileName: string;
      format: string;
      purpose: string;
      targetVersionId?: string;
      captureJourney?: { id: string; sameFrameConfirmed: true };
    }) => {
      const created = await exports.default.fetch(`${origin}/api/projects/${project.id}/uploads`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          fileName: input.fileName,
          sizeBytes: input.bytes.byteLength,
          format: input.format,
          purpose: input.purpose,
          mimeType: "application/octet-stream",
          ...(input.targetVersionId ? { targetVersionId: input.targetVersionId } : {}),
          ...(input.captureJourney ? { captureJourney: input.captureJourney } : {}),
        }),
      });
      expect(created.status).toBe(201);
      const { upload } = await created.json<{
        upload: { id: string; versionId: string; assetId: string };
      }>();
      const partResponse = await exports.default.fetch(
        `${origin}/api/uploads/${upload.id}/parts/1`,
        {
          method: "PUT",
          headers: { cookie, "content-length": String(input.bytes.byteLength) },
          body: input.bytes,
        },
      );
      expect(partResponse.status).toBe(200);
      const { part } = await partResponse.json<{ part: { etag: string } }>();
      const completed = await exports.default.fetch(`${origin}/api/uploads/${upload.id}/complete`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ parts: [{ partNumber: 1, etag: part.etag }] }),
      });
      expect(completed.status).toBe(200);
      return {
        upload,
        completion: await completed.json<{ job: { id: string } }>(),
      };
    };

    const captureJourney = {
      id: crypto.randomUUID(),
      sameFrameConfirmed: true as const,
    };
    const visual = await uploadBytes({
      bytes: new Uint8Array([0x52, 0x41, 0x44, 0x01]),
      fileName: "capture.rad",
      format: "rad",
      purpose: "web_scene",
      captureJourney,
    });
    const unpairedGeometry = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/uploads`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          targetVersionId: visual.upload.versionId,
          fileName: "unpaired-room.ply",
          sizeBytes: 128,
          format: "ply",
          purpose: "metric_point_cloud",
          mimeType: "application/octet-stream",
        }),
      },
    );
    expect(unpairedGeometry.status).toBe(422);
    await expect(unpairedGeometry.json()).resolves.toMatchObject({
      error: "Request cannot be applied",
      details: {
        captureJourney: [expect.stringContaining(
          "Registered geometry must carry the same paired-capture journey receipt",
        )],
      },
    });
    const metricBytes = new TextEncoder().encode(
      "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n",
    );
    const geometry = await uploadBytes({
      bytes: metricBytes,
      fileName: "registered-room.ply",
      format: "ply",
      purpose: "metric_point_cloud",
      targetVersionId: visual.upload.versionId,
      captureJourney,
    });
    expect(geometry.upload.versionId).toBe(visual.upload.versionId);
    const pairedVersion = await env.DB.prepare(`
      SELECT source_provenance_json
      FROM scene_versions
      WHERE id = ?
    `).bind(visual.upload.versionId).first<{ source_provenance_json: string }>();
    expect(JSON.parse(pairedVersion?.source_provenance_json ?? "{}")).toMatchObject({
      captureJourney: {
        schemaVersion: "paired-capture-journey-v1",
        id: captureJourney.id,
        captureAdapter: "xgrids-lcc",
        primaryAssetId: visual.upload.assetId,
        geometryAssetId: geometry.upload.assetId,
        declaration: "same-capture-registered-y-up-metres",
        sourceCoordinateFrameId: `capture-journey:${captureJourney.id}`,
      },
    });

    const leaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workerId: `automatic-floorplan-${crypto.randomUUID()}`,
        jobId: geometry.completion.job.id,
      }),
    });
    expect(leaseResponse.status).toBe(200);
    const lease = await leaseResponse.json<{ leaseToken: string }>();
    const verifiedSha256 = await crypto.subtle.digest("SHA-256", metricBytes)
      .then((hash) => Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""));
    const workerComplete = await exports.default.fetch(
      `${origin}/api/worker/jobs/${geometry.completion.job.id}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leaseToken: lease.leaseToken,
          progressMessage: "Registered geometry verified",
          outputs: [],
          report: { source: { sha256: verifiedSha256 } },
          evidence: {
            processorVersion: "spatial-evidence/1.0.0",
            computeDurationMs: 10,
            activeHumanDurationMs: 0,
            inputBytes: metricBytes.byteLength,
            outputBytes: 0,
            toolVersions: { processor: "test" },
          },
        }),
      },
    );
    expect(workerComplete.status).toBe(200);
    const completed = await workerComplete.json<{
      automaticFloorplan: { id: string; jobId: string; status: string };
    }>();
    expect(completed.automaticFloorplan).toMatchObject({ status: "QUEUED" });
    const automatic = await env.DB.prepare(`
      SELECT r.status, r.parameters_json, j.state, j.job_type
      FROM floorplan_extraction_runs r
      JOIN processing_jobs j ON j.id = r.job_id
      WHERE r.id = ?
    `).bind(completed.automaticFloorplan.id).first<{
      status: string;
      parameters_json: string;
      state: string;
      job_type: string;
    }>();
    expect(automatic).toMatchObject({
      status: "QUEUED",
      state: "QUEUED",
      job_type: "floorplan.extract-v1",
    });
    expect(JSON.parse(automatic!.parameters_json)).toMatchObject({
      automaticPipeline: true,
      coordinateAssurance: "registered_y_up_metric_frame",
    });
    const versionCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM scene_versions WHERE project_id = ?",
    ).bind(project.id).first<{ count: number }>();
    expect(versionCount?.count).toBe(1);
  });

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
