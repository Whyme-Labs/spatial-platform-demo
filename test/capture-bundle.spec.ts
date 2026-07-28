import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";
import { validateCaptureBundle } from "../src/worker/capture-bundle";
import { sha256Hex } from "../src/worker/security";

const origin = "https://spatial.test";
let addressSequence = 7000;

async function login(): Promise<string> {
  const email = env.ADMIN_EMAIL.toLowerCase();
  const challengeId = crypto.randomUUID();
  const code = "565656";
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

describe("vendor-neutral capture bundle", () => {
  it("classifies portability separately from independent reconstruction", () => {
    const validation = validateCaptureBundle({
      assets: [
        {
          id: crypto.randomUUID(),
          roles: ["raw_capture", "metric_point_cloud"],
          kind: "source",
          format: "ply",
          fileName: "capture.ply",
          mimeType: "application/octet-stream",
          sizeBytes: 120,
          sha256: "a".repeat(64),
        },
        {
          id: crypto.randomUUID(),
          roles: ["gaussian_splat"],
          kind: "master",
          format: "spz",
          fileName: "scene.spz",
          mimeType: "application/octet-stream",
          sizeBytes: 80,
          sha256: "b".repeat(64),
        },
      ],
      capabilities: {
        rawImages: false,
        cameraPoses: false,
        intrinsics: false,
        extrinsics: false,
        imu: false,
        gnss: false,
        lidarPointCloud: true,
        gaussianSplat: true,
        collisionMesh: false,
      },
      rights: {
        commercialUseConfirmed: true,
        selfHostingConfirmed: true,
        redistributionConfirmed: true,
        evidence: "The supplier quotation explicitly grants commercial self-hosting and derived delivery.",
      },
      exporterMode: "gui",
      coordinateUnits: "metres",
      declaredLimitations: ["Camera calibration was not included in the supplied export."],
    });

    expect(validation).toMatchObject({
      result: "ready_with_warnings",
      summary: {
        renderableNow: true,
        metricReady: true,
        reconstructionPortable: true,
        independentlyReconstructable: false,
        automationReady: false,
      },
    });
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "reconstruction_inputs_incomplete",
      severity: "warning",
    }));
  });

  it("persists exact verified assets, an immutable R2 manifest, idempotency, and review", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Capture bundle ${crypto.randomUUID().slice(0, 8)}`,
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

    const versionId = crypto.randomUUID();
    const pointCloudId = crypto.randomUUID();
    const gaussianId = crypto.randomUUID();
    const pointCloudBytes = new TextEncoder().encode("verified point-cloud fixture");
    const gaussianBytes = new TextEncoder().encode("verified Gaussian fixture");
    const pointCloudKey =
      `raw-private/${storedProject!.organisation_id}/${project.project.id}/${versionId}/${pointCloudId}/capture.ply`;
    const gaussianKey =
      `masters-private/${storedProject!.organisation_id}/${project.project.id}/${versionId}/${gaussianId}/scene.spz`;
    await Promise.all([
      env.SPATIAL_ASSETS.put(pointCloudKey, pointCloudBytes),
      env.SPATIAL_ASSETS.put(gaussianKey, gaussianBytes),
    ]);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO scene_versions
          (id, project_id, version_number, status, source_provenance_json, created_by)
        VALUES (?, ?, 1, 'QA_REQUIRED', '{"registered":true}', ?)
      `).bind(versionId, project.project.id, storedProject!.created_by),
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, sha256, integrity_status
        ) VALUES (?, ?, ?, ?, 'source', 'ply', ?, 'capture.ply',
          'application/octet-stream', ?, ?, 'verified')
      `).bind(
        pointCloudId,
        storedProject!.organisation_id,
        project.project.id,
        versionId,
        pointCloudKey,
        pointCloudBytes.byteLength,
        await sha256Hex(pointCloudBytes),
      ),
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, sha256, integrity_status
        ) VALUES (?, ?, ?, ?, 'master', 'spz', ?, 'scene.spz',
          'application/octet-stream', ?, ?, 'verified')
      `).bind(
        gaussianId,
        storedProject!.organisation_id,
        project.project.id,
        versionId,
        gaussianKey,
        gaussianBytes.byteLength,
        await sha256Hex(gaussianBytes),
      ),
    ]);

    const operationId = crypto.randomUUID();
    const body = {
      clientOperationId: operationId,
      versionId,
      schemaVersion: "1.0.0",
      adapter: "open-import",
      captureSystem: {
        vendor: "Independent operator",
        model: "Portable export",
        hardwareVersion: null,
        firmwareVersion: null,
        deviceIdHash: null,
      },
      exporter: {
        name: "Open exporter",
        version: "1.0.0",
        exportedAt: new Date().toISOString(),
        mode: "gui",
        operatingSystem: "Windows",
      },
      coordinateFrame: {
        id: "project-local-y-up",
        units: "metres",
        axisConvention: "right-handed-y-up",
        epsg: null,
        registrationMethod: "The operator preserved the scanner-local metric frame without an external control network.",
      },
      assets: [
        {
          assetId: pointCloudId,
          roles: ["raw_capture", "metric_point_cloud"],
          description: "Immutable capture and metric geometry export.",
        },
        {
          assetId: gaussianId,
          roles: ["gaussian_splat"],
          description: "Portable self-hostable Gaussian master.",
        },
      ],
      capabilities: {
        rawImages: false,
        cameraPoses: false,
        intrinsics: false,
        extrinsics: false,
        imu: false,
        gnss: false,
        lidarPointCloud: true,
        gaussianSplat: true,
        collisionMesh: false,
      },
      rights: {
        commercialUseConfirmed: true,
        selfHostingConfirmed: true,
        redistributionConfirmed: true,
        evidence: "Written supplier terms permit commercial delivery, self-hosting, and redistribution of derived assets.",
      },
      limitations: ["Camera images, poses, and calibration were not included in this export."],
    };
    const create = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}/capture-bundles`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(create.status).toBe(201);
    const created = await create.json<{
      manifest: {
        id: string;
        result: string;
        manifestAssetId: string;
        validation: { summary: Record<string, unknown> };
      };
    }>();
    expect(created.manifest).toMatchObject({
      result: "ready_with_warnings",
      manifestAssetId: expect.any(String),
      validation: {
        summary: {
          renderableNow: true,
          metricReady: true,
          reconstructionPortable: true,
          independentlyReconstructable: false,
        },
      },
    });

    const replay = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}/capture-bundles`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      manifest: { id: created.manifest.id },
      idempotent: true,
    });
    const conflict = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}/capture-bundles`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          rights: { ...body.rights, redistributionConfirmed: false },
        }),
      },
    );
    expect(conflict.status).toBe(409);

    const wrongAdapter = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}/capture-bundles`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          clientOperationId: crypto.randomUUID(),
          adapter: "fjd-trion",
        }),
      },
    );
    expect(wrongAdapter.status).toBe(422);

    const reviewed = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}/capture-bundles/${created.manifest.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          decision: "needs_vendor_evidence",
          note: "Request calibrated images and camera poses before treating this bundle as independently reconstructable.",
        }),
      },
    );
    expect(reviewed.status).toBe(200);
    await expect(reviewed.json()).resolves.toMatchObject({
      manifest: {
        id: created.manifest.id,
        status: "reviewed",
        reviewDecision: "needs_vendor_evidence",
      },
    });

    const stored = await env.DB.prepare(`
      SELECT b.manifest_hash, b.request_hash, b.reviewed_by,
        a.object_key, a.size_bytes, a.sha256, a.integrity_status
      FROM capture_bundle_manifests b
      JOIN assets a ON a.id = b.manifest_asset_id
      WHERE b.id = ?
    `).bind(created.manifest.id).first<{
      manifest_hash: string;
      request_hash: string;
      reviewed_by: string;
      object_key: string;
      size_bytes: number;
      sha256: string;
      integrity_status: string;
    }>();
    expect(stored).toMatchObject({
      reviewed_by: storedProject!.created_by,
      integrity_status: "verified",
    });
    expect(stored!.manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored!.request_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored!.sha256).toBe(stored!.manifest_hash);
    const object = await env.SPATIAL_ASSETS.get(stored!.object_key);
    expect(object).not.toBeNull();
    expect(object!.size).toBe(stored!.size_bytes);
    const persisted = JSON.parse(await object!.text()) as {
      project: { id: string };
      version: { id: string };
      assets: Array<{ id: string; sha256: string }>;
      validation: { result: string };
    };
    expect(persisted).toMatchObject({
      project: { id: project.project.id },
      version: { id: versionId },
      validation: { result: "ready_with_warnings" },
    });
    expect(persisted.assets).toHaveLength(2);
    expect(persisted.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256))).toBe(true);

    const detail = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}`,
      { headers: { cookie } },
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      captureBundles: [{
        id: created.manifest.id,
        result: "ready_with_warnings",
        review_decision: "needs_vendor_evidence",
      }],
    });
  });
});
