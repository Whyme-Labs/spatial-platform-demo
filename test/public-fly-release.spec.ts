import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";
import { sha256Hex } from "../src/worker/security";
import { publicationMeasurementDisclaimer } from "../src/shared/measurement-disclaimers";

const origin = "https://spatial.test";

it("publishes a reviewed visual scene, freezes Fly-only capabilities, and preserves access and revocation", async () => {
  const cookie = await login();
  const created = await exports.default.fetch(`${origin}/api/projects`, post(cookie, {
    name: "Single-file public fixture", captureAdapter: "open-import", deliveryTemplate: "Property showcase",
  }));
  expect(created.status).toBe(201);
  const { project } = await created.json<{ project: { id: string } }>();
  const owner = await env.DB.prepare("SELECT organisation_id, created_by, workflow_policy_revision_id FROM projects WHERE id = ?")
    .bind(project.id).first<{ organisation_id: string; created_by: string; workflow_policy_revision_id: string }>();
  const versionId = crypto.randomUUID();
  const webAssetId = crypto.randomUUID();
  const rawAssetId = crypto.randomUUID();
  const webKey = `delivery-private/${project.id}/${versionId}/scene.rad`;
  const rawKey = `raw-private/${project.id}/${versionId}/source.ply`;
  const bytes = new Uint8Array([82, 65, 68, 1, 2, 3]);
  await env.SPATIAL_ASSETS.put(webKey, bytes);
  await env.SPATIAL_ASSETS.put(rawKey, "private capture evidence");
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO scene_versions
      (id, project_id, version_number, status, created_by, workflow_policy_revision_id)
      VALUES (?, ?, 1, 'QA_REQUIRED', ?, ?)`)
      .bind(versionId, project.id, owner!.created_by, owner!.workflow_policy_revision_id),
    env.DB.prepare(`INSERT INTO assets
      (id, organisation_id, project_id, version_id, kind, format, object_key, file_name, mime_type, size_bytes, sha256, integrity_status)
      VALUES (?, ?, ?, ?, 'web', 'rad', ?, 'scene.rad', 'application/octet-stream', ?, ?, 'verified')`)
      .bind(webAssetId, owner!.organisation_id, project.id, versionId, webKey, bytes.length, await sha256Hex(bytes)),
    env.DB.prepare(`INSERT INTO assets
      (id, organisation_id, project_id, version_id, kind, format, object_key, file_name, mime_type, size_bytes, integrity_status)
      VALUES (?, ?, ?, ?, 'master', 'ply', ?, 'source.ply', 'application/octet-stream', 24, 'verified')`)
      .bind(rawAssetId, owner!.organisation_id, project.id, versionId, rawKey),
  ]);
  const approval = { webAssetId, visualGrade: "B", privacyStatus: "approved", measurementGrade: "visual-only", viewingMode: "fly-only" };
  const publication = {
    slug: "single-file-public", accessPolicy: "public",
    viewerConfig: { title: "Visual scene", measurementDisclaimer: publicationMeasurementDisclaimer("visual-only"), viewingMode: "fly-only", defaultMovementMode: "fly" },
  };
  const approve = (body: unknown) => exports.default.fetch(`${origin}/api/versions/${versionId}/approve`, post(cookie, body));
  const publish = (body: unknown) => exports.default.fetch(`${origin}/api/projects/${project.id}/releases`, post(cookie, body));
  expect((await publish(publication)).status).toBe(400);
  expect((await approve({ ...approval, privacyStatus: "pending" })).status).toBe(400);
  expect((await approve({ ...approval, measurementGrade: "indicative" })).status).toBe(400);
  expect((await approve({ ...approval, viewingMode: "walkable" })).status).toBe(409);
  expect((await approve({ ...approval, webAssetId: rawAssetId })).status).toBe(400);
  expect((await approve({ ...approval, posterAssetId: rawAssetId })).status).toBe(400);
  expect((await approve(approval)).status).toBe(200);
  expect((await approve(approval)).status).toBe(200);
  expect((await approve({ ...approval, viewingMode: "walkable" })).status).toBe(409);
  expect((await publish({ ...publication, viewerConfig: { ...publication.viewerConfig, viewingMode: "walkable", defaultMovementMode: "walk" } })).status).toBe(422);
  const published = await publish(publication);
  expect(published.status, JSON.stringify(await published.clone().json())).toBe(201);
  const first = await published.json<{ release: { id: string; releaseNumber: number } }>();
  const stored = await env.DB.prepare("SELECT spatial_snapshot_json, viewer_config_json FROM releases WHERE id = ?")
    .bind(first.release.id).first<{ spatial_snapshot_json: string | null; viewer_config_json: string }>();
  expect(stored!.spatial_snapshot_json).toBeNull();
  expect(JSON.parse(stored!.viewer_config_json)).toMatchObject({ viewingMode: "fly-only", defaultMovementMode: "fly" });
  const manifest = await exports.default.fetch(`${origin}/api/releases/single-file-public/manifest`);
  expect(manifest.status).toBe(200);
  const data = await manifest.json<{
    viewer: { viewingMode: string; sourceToWorld?: unknown; captureRegistration?: unknown };
    spatial: unknown;
    scene: { contentUrl: string; collisionUrl: null; detourUrl: null };
  }>();
  expect(data.viewer.viewingMode).toBe("fly-only");
  expect(data.viewer.sourceToWorld).toBeUndefined();
  expect(data.viewer.captureRegistration).toBeUndefined();
  expect(data.spatial).toBeNull();
  expect(data.scene.collisionUrl).toBeNull();
  expect(data.scene.detourUrl).toBeNull();
  const asset = await exports.default.fetch(new URL(data.scene.contentUrl, origin), { headers: { range: "bytes=0-2" } });
  expect(asset.status).toBe(206);
  expect(new Uint8Array(await asset.arrayBuffer())).toEqual(bytes.slice(0, 3));
  const rawPublic = await exports.default.fetch(`${origin}/public-asset/${first.release.id}/${rawAssetId}/source.ply`);
  expect(rawPublic.status).toBe(404);
  const repeated = await publish({ ...publication, clientOperationId: crypto.randomUUID() });
  expect(repeated.status).toBe(200);
  await expect(repeated.json()).resolves.toMatchObject({ duplicate: true, release: { id: first.release.id } });

  // Live geometry is not part of the immutable Fly-only release.
  await env.DB.prepare(`INSERT INTO scene_entities
    (id, organisation_id, project_id, version_id, kind, label, geometry_json, created_by)
    VALUES (?, ?, ?, ?, 'floor', 'Later geometry', ?, ?)`)
    .bind(crypto.randomUUID(), owner!.organisation_id, project.id, versionId,
      JSON.stringify({ type: "polygon", points: [[0, 0, 0], [1, 0, 0], [1, 0, 1]] }), owner!.created_by).run();
  const frozen = await exports.default.fetch(`${origin}/api/releases/single-file-public/manifest`);
  await expect(frozen.json()).resolves.toMatchObject({ spatial: null, viewer: { viewingMode: "fly-only" } });

  const privatePublished = await publish({ ...publication, slug: "single-file-private", accessPolicy: "token", clientOperationId: crypto.randomUUID() });
  expect(privatePublished.status).toBe(201);
  const privateRelease = await privatePublished.json<{ release: { accessToken: string } }>();
  expect((await exports.default.fetch(`${origin}/api/releases/single-file-private/manifest`)).status).toBe(401);
  expect((await exports.default.fetch(`${origin}/api/releases/single-file-private/manifest?access_token=${privateRelease.release.accessToken}`)).status).toBe(200);

  const revised = await publish({ ...publication, viewerConfig: { ...publication.viewerConfig, title: "New visual framing" } });
  expect(revised.status).toBe(201);
  const rollback = await exports.default.fetch(`${origin}/api/release-channels/single-file-public/rollback`, post(cookie, { releaseId: first.release.id }));
  expect(rollback.status).toBe(200);
  const rolledBack = await exports.default.fetch(`${origin}/api/releases/single-file-public/manifest`);
  await expect(rolledBack.json()).resolves.toMatchObject({ release: { id: first.release.id }, viewer: { title: "Visual scene", viewingMode: "fly-only" } });
  const revoked = await exports.default.fetch(`${origin}/api/release-channels/single-file-public`, { method: "DELETE", headers: { cookie, origin } });
  expect(revoked.status).toBe(204);
  expect((await exports.default.fetch(new URL(data.scene.contentUrl, origin))).status).toBe(404);
  expect((await exports.default.fetch(`${origin}/api/releases/single-file-public/manifest`)).status).toBe(404);
});

function post(cookie: string, body: unknown): RequestInit {
  return { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function login(): Promise<string> {
  const challengeId = crypto.randomUUID();
  const email = env.ADMIN_EMAIL.toLowerCase();
  const code = "123456";
  await env.DB.prepare("INSERT INTO auth_otp_challenges (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(challengeId, email, await otpHash(challengeId, email, code, env.OTP_PEPPER), new Date(Date.now() + 60_000).toISOString()).run();
  const response = await exports.default.fetch(`${origin}/api/auth/otp/verify`, post("", { email, challengeId, code }));
  expect(response.status).toBe(200);
  const token = response.headers.get("set-cookie")?.match(/spatial_access=([^;,]+)/)?.[1];
  expect(token).toBeTruthy();
  return `spatial_access=${token}`;
}
