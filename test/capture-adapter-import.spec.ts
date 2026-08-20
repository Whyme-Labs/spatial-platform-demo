import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";
import { processorLeaseRequest, testProcessorIdentity } from "./helpers/processor-identity";

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
        VALUES (?, ?, 1, 'PUBLISHED', ?, ?)
      `).bind(
        versionId,
        project.id,
        JSON.stringify({ assetProducer: "open-import", adapter: "open-import" }),
        projectRow!.created_by,
      ),
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
        body: JSON.stringify(processorLeaseRequest("collision-verifier", completed.job.id)),
    });
    const lease = await leaseResponse.json<{ leaseToken: string }>();
    const completionBody = (reportedSha256: string) => JSON.stringify({
      leaseToken: lease.leaseToken,
      progressMessage: "Collision integrity verified",
      outputs: [],
      report: { source: { sha256: reportedSha256 } },
      evidence: {
        processorIdentity: testProcessorIdentity,
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

  it("validates auxiliary evidence against the target version's frozen asset producer", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Frozen producer ${crypto.randomUUID().slice(0, 8)}`,
        captureOrigin: "fjd",
        assetProducer: "fjd-trion",
        deliveryTemplate: "Property showcase",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const visualResponse = await exports.default.fetch(`${origin}/api/projects/${project.id}/uploads`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "frozen.rad",
        sizeBytes: 16,
        format: "rad",
        purpose: "web_scene",
        mimeType: "application/octet-stream",
      }),
    });
    expect(visualResponse.status).toBe(201);
    const visual = await visualResponse.json<{ upload: { versionId: string } }>();
    await env.DB.prepare(
      "UPDATE scene_versions SET status = 'INGESTED' WHERE id = ?",
    ).bind(visual.upload.versionId).run();

    const transition = await exports.default.fetch(`${origin}/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ assetProducer: "xgrids-lcc" }),
    });
    expect(transition.status).toBe(200);

    const auxiliary = await exports.default.fetch(`${origin}/api/projects/${project.id}/uploads`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        targetVersionId: visual.upload.versionId,
        fileName: "fjd-collision.glb",
        sizeBytes: 16,
        format: "glb",
        purpose: "collision_mesh",
        mimeType: "model/gltf-binary",
      }),
    });
    expect(auxiliary.status).toBe(201);
    await expect(auxiliary.json()).resolves.toMatchObject({
      upload: { versionId: visual.upload.versionId },
    });
  });

  it("attaches raw capture evidence without changing a published visual version", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Raw evidence ${crypto.randomUUID().slice(0, 8)}`,
        captureOrigin: "fjd",
        assetProducer: "fjd-trion",
        deliveryTemplate: "Property showcase",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const visualResponse = await exports.default.fetch(`${origin}/api/projects/${project.id}/uploads`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        fileName: "room.rad",
        sizeBytes: 16,
        format: "rad",
        purpose: "web_scene",
        mimeType: "application/octet-stream",
      }),
    });
    expect(visualResponse.status).toBe(201);
    const visual = await visualResponse.json<{ upload: { versionId: string } }>();
    await env.DB.batch([
      env.DB.prepare("UPDATE scene_versions SET status = 'PUBLISHED' WHERE id = ?")
        .bind(visual.upload.versionId),
      env.DB.prepare("UPDATE projects SET status = 'PUBLISHED' WHERE id = ?")
        .bind(project.id),
    ]);

    const rawBytes = new TextEncoder().encode("raw-fjd-evidence");
    const created = await exports.default.fetch(`${origin}/api/projects/${project.id}/uploads`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        targetVersionId: visual.upload.versionId,
        fileName: "room.fjdslam",
        sizeBytes: rawBytes.byteLength,
        format: "fjdslam",
        purpose: "raw_capture",
        mimeType: "application/octet-stream",
      }),
    });
    expect(created.status).toBe(201);
    const { upload } = await created.json<{
      upload: { id: string; versionId: string; assetId: string };
    }>();
    expect(upload.versionId).toBe(visual.upload.versionId);
    const uploadedPart = await exports.default.fetch(
      `${origin}/api/uploads/${upload.id}/parts/1`,
      {
        method: "PUT",
        headers: { cookie, "content-length": String(rawBytes.byteLength) },
        body: rawBytes,
      },
    );
    expect(uploadedPart.status).toBe(200);
    const { part } = await uploadedPart.json<{ part: { etag: string } }>();
    const completed = await exports.default.fetch(`${origin}/api/uploads/${upload.id}/complete`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: part.etag }] }),
    });
    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toMatchObject({
      asset: {
        id: upload.assetId,
        versionId: visual.upload.versionId,
        purpose: "raw_capture",
        kind: "source",
      },
      job: { type: "asset.evidence-validate", state: "QUEUED" },
    });
    const statuses = await env.DB.prepare(`
      SELECT version.status AS version_status, project.status AS project_status
      FROM scene_versions version
      JOIN projects project ON project.id = version.project_id
      WHERE version.id = ?
    `).bind(visual.upload.versionId).first<{
      version_status: string;
      project_status: string;
    }>();
    expect(statuses).toEqual({
      version_status: "PUBLISHED",
      project_status: "PUBLISHED",
    });
  });

  it("records an explicit source-only transition instead of silently retaining the old producer", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: `Source only ${crypto.randomUUID().slice(0, 8)}`,
        captureOrigin: "third-party",
        assetProducer: "open-import",
        deliveryTemplate: "Property showcase",
      }),
    });
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const transition = await exports.default.fetch(`${origin}/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ captureOrigin: "phone", assetProducer: null }),
    });
    expect(transition.status).toBe(200);
    await expect(transition.json()).resolves.toMatchObject({
      project: {
        captureOrigin: "phone",
        captureAdapter: "phone-video",
        assetProducer: null,
      },
    });

    const derived = await exports.default.fetch(`${origin}/api/projects/${project.id}/uploads`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "derived.rad",
        sizeBytes: 16,
        format: "rad",
        purpose: "web_scene",
        mimeType: "application/octet-stream",
      }),
    });
    expect(derived.status).toBe(422);
    await expect(derived.json()).resolves.toMatchObject({
      error: expect.stringContaining("pipeline that produced"),
    });

    const source = await exports.default.fetch(`${origin}/api/projects/${project.id}/uploads`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "capture.mp4",
        sizeBytes: 16,
        format: "mp4",
        purpose: "source_video",
        mimeType: "video/mp4",
      }),
    });
    expect(source.status).toBe(201);
  });

  it("qualifies paired PLY coordinates and queues floor-plan generation when geometry finishes first", async () => {
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
      captureJourney?: {
        id: string;
        qualification: "automatic-ply-coordinate-evidence-v1";
      };
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
      qualification: "automatic-ply-coordinate-evidence-v1" as const,
    };
    const binaryPly = (points: Array<[number, number, number]>) => {
      const header = [
        "ply",
        "format binary_little_endian 1.0",
        "comment spatial_studio_coordinate_frame scanner-run-42",
        "comment spatial_studio_up_axis Y",
        "comment spatial_studio_units metres",
        `element vertex ${points.length}`,
        "property float x",
        "property float y",
        "property float z",
        "end_header",
        "",
      ].join("\n");
      const headerBytes = new TextEncoder().encode(header);
      const bytes = new Uint8Array(headerBytes.byteLength + points.length * 12);
      bytes.set(headerBytes);
      const view = new DataView(bytes.buffer);
      points.forEach((point, pointIndex) => point.forEach((value, axis) => {
        view.setFloat32(headerBytes.byteLength + pointIndex * 12 + axis * 4, value, true);
      }));
      return bytes;
    };
    const coordinateEvidence = (bounds: {
      min: [number, number, number];
      max: [number, number, number];
    }) => ({
      schemaVersion: "ply-coordinate-evidence-v1",
      method: "automatic-ply-coordinate-evidence-v1",
      coordinateFrameId: "scanner-run-42",
      sourceUpAxis: "Y",
      worldUnit: "metres",
      vertexCount: 2,
      finitePointCount: 2,
      bounds,
    });
    const visualBytes = binaryPly([[0, 0, 0], [10, 3, 8]]);
    const visual = await uploadBytes({
      bytes: visualBytes,
      fileName: "capture.ply",
      format: "ply",
      purpose: "gaussian_splat",
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
    const metricBytes = binaryPly([[1, 0, 1], [9, 2.5, 7]]);
    const geometry = await uploadBytes({
      bytes: metricBytes,
      fileName: "registered-room.ply",
      format: "ply",
      purpose: "metric_point_cloud",
      targetVersionId: visual.upload.versionId,
      captureJourney,
    });
    expect(geometry.upload.versionId).toBe(visual.upload.versionId);
    const policyTransition = await exports.default.fetch(
      `${origin}/api/projects/${project.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ deliveryTemplate: "Venue navigator" }),
      },
    );
    expect(policyTransition.status).toBe(200);
    const pairedVersion = await env.DB.prepare(`
      SELECT source_provenance_json
      FROM scene_versions
      WHERE id = ?
    `).bind(visual.upload.versionId).first<{ source_provenance_json: string }>();
    expect(JSON.parse(pairedVersion?.source_provenance_json ?? "{}")).toMatchObject({
      captureJourney: {
        schemaVersion: "paired-capture-journey-v2",
        id: captureJourney.id,
        captureAdapter: "xgrids-lcc",
        primaryAssetId: visual.upload.assetId,
        geometryAssetId: geometry.upload.assetId,
        declaration: "same-capture-registered-y-up-metres",
        sourceCoordinateFrameId: `capture-journey:${captureJourney.id}`,
        qualification: {
          method: "automatic-ply-coordinate-evidence-v1",
          status: "pending",
        },
      },
    });

    const completeJob = async (input: {
      jobId: string;
      bytes: Uint8Array;
      bounds: { min: [number, number, number]; max: [number, number, number] };
    }) => {
      const leaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...processorLeaseRequest(`automatic-floorplan-${crypto.randomUUID()}`, input.jobId),
        }),
      });
      expect(leaseResponse.status).toBe(200);
      const lease = await leaseResponse.json<{ leaseToken: string }>();
      const sha256 = await crypto.subtle.digest("SHA-256", input.bytes)
        .then((hash) => Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""));
      const response = await exports.default.fetch(
        `${origin}/api/worker/jobs/${input.jobId}/complete`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.WORKER_API_TOKEN}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            leaseToken: lease.leaseToken,
            progressMessage: "Coordinate evidence verified",
            outputs: [],
            report: { source: { sha256, coordinateEvidence: coordinateEvidence(input.bounds) } },
            evidence: {
              processorIdentity: testProcessorIdentity,
              processorVersion: "spatial-evidence/1.0.0",
              computeDurationMs: 10,
              activeHumanDurationMs: 0,
              inputBytes: input.bytes.byteLength,
              outputBytes: 0,
              toolVersions: { processor: "test" },
            },
          }),
        },
      );
      expect(response.status).toBe(200);
      return response.json<{
        automaticFloorplan: { id: string; jobId: string; status: string } | null;
      }>();
    };

    const geometryCompletion = await completeJob({
      jobId: geometry.completion.job.id,
      bytes: metricBytes,
      bounds: { min: [1, 0, 1], max: [9, 2.5, 7] },
    });
    expect(geometryCompletion.automaticFloorplan).toBeNull();
    const completed = await completeJob({
      jobId: visual.completion.job.id,
      bytes: visualBytes,
      bounds: { min: [0, 0, 0], max: [10, 3, 8] },
    }) as {
      automaticFloorplan: { id: string; jobId: string; status: string };
    };
    expect(completed.automaticFloorplan).toMatchObject({ status: "QUEUED" });
    const qualifiedVersion = await env.DB.prepare(`
      SELECT source_provenance_json
      FROM scene_versions
      WHERE id = ?
    `).bind(visual.upload.versionId).first<{ source_provenance_json: string }>();
    expect(JSON.parse(qualifiedVersion?.source_provenance_json ?? "{}")).toMatchObject({
      captureJourney: {
        qualification: {
          method: "automatic-ply-coordinate-evidence-v1",
          status: "verified",
          coordinateFrameId: "scanner-run-42",
          overlapBounds: { min: [1, 0, 1], max: [9, 2.5, 7] },
        },
      },
    });
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
      structureWorkflow: "automatic-extract-review",
      coordinateAssurance: "registered_y_up_metric_frame",
    });
    const restoreProjectDefaults = await exports.default.fetch(
      `${origin}/api/projects/${project.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ deliveryTemplate: "Property showcase" }),
      },
    );
    expect(restoreProjectDefaults.status).toBe(200);

    const failingJourney = {
      id: crypto.randomUUID(),
      qualification: "automatic-ply-coordinate-evidence-v1" as const,
    };
    const failingVisualBytes = binaryPly([[0, 0, 0], [4, 2, 4]]);
    const failingVisual = await uploadBytes({
      bytes: failingVisualBytes,
      fileName: "failed-capture.ply",
      format: "ply",
      purpose: "gaussian_splat",
      captureJourney: failingJourney,
    });
    const failingGeometryBytes = binaryPly([[1, 0, 1], [3, 1.5, 3]]);
    const failingGeometry = await uploadBytes({
      bytes: failingGeometryBytes,
      fileName: "failed-geometry.ply",
      format: "ply",
      purpose: "metric_point_cloud",
      targetVersionId: failingVisual.upload.versionId,
      captureJourney: failingJourney,
    });
    await completeJob({
      jobId: failingGeometry.completion.job.id,
      bytes: failingGeometryBytes,
      bounds: { min: [1, 0, 1], max: [3, 1.5, 3] },
    });
    const failingLeaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...processorLeaseRequest(
          `automatic-floorplan-failure-${crypto.randomUUID()}`,
          failingVisual.completion.job.id,
        ),
      }),
    });
    expect(failingLeaseResponse.status).toBe(200);
    const failingLease = await failingLeaseResponse.json<{ leaseToken: string }>();
    const failureResponse = await exports.default.fetch(
      `${origin}/api/worker/jobs/${failingVisual.completion.job.id}/fail`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leaseToken: failingLease.leaseToken,
          code: "PLY_COORDINATE_READ_FAILED",
          message: "The visual PLY coordinate stream could not be read",
          retryable: false,
          failureClass: "input_validation",
        }),
      },
    );
    expect(failureResponse.status).toBe(200);
    const failedVersion = await env.DB.prepare(`
      SELECT source_provenance_json
      FROM scene_versions
      WHERE id = ?
    `).bind(failingVisual.upload.versionId).first<{ source_provenance_json: string }>();
    expect(JSON.parse(failedVersion?.source_provenance_json ?? "{}")).toMatchObject({
      captureJourney: {
        qualification: {
          method: "automatic-ply-coordinate-evidence-v1",
          status: "blocked",
          reason: expect.stringContaining("visual PLY"),
        },
      },
    });
    const retryResponse = await exports.default.fetch(
      `${origin}/api/jobs/${failingVisual.completion.job.id}/retry`,
      { method: "POST", headers: { cookie } },
    );
    expect(retryResponse.status).toBe(200);
    const recovered = await completeJob({
      jobId: failingVisual.completion.job.id,
      bytes: failingVisualBytes,
      bounds: { min: [0, 0, 0], max: [4, 2, 4] },
    });
    expect(recovered.automaticFloorplan).toMatchObject({ status: "QUEUED" });
    const recoveredVersion = await env.DB.prepare(`
      SELECT source_provenance_json
      FROM scene_versions
      WHERE id = ?
    `).bind(failingVisual.upload.versionId).first<{ source_provenance_json: string }>();
    expect(JSON.parse(recoveredVersion?.source_provenance_json ?? "{}")).toMatchObject({
      captureJourney: {
        qualification: {
          method: "automatic-ply-coordinate-evidence-v1",
          status: "verified",
          coordinateFrameId: "scanner-run-42",
        },
      },
    });
    const versionCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM scene_versions WHERE project_id = ?",
    ).bind(project.id).first<{ count: number }>();
    expect(versionCount?.count).toBe(2);
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
        ...processorLeaseRequest(`test-native-sog-${crypto.randomUUID()}`, completed.job.id),
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

  it("rejects a derived asset before a source-only project records its producer", async () => {
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
      error: expect.stringContaining("pipeline that produced"),
    });
  });
});
