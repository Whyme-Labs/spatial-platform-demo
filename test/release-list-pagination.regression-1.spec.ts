import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";

const origin = "https://spatial.test";
// Receipt: docs/CAPACITY_RECEIPTS.md, "Production-scale local QA list boundaries".
const measuredReleaseBoundary = 500;

async function login(): Promise<{ cookie: string; organisationId: string; userId: string }> {
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
    headers: { "content-type": "application/json", "CF-Connecting-IP": "2001:db8::204" },
    body: JSON.stringify({ email, challengeId, code }),
  });
  expect(response.status).toBe(200);
  const access = (response.headers.get("set-cookie") ?? "").match(/spatial_access=([^;,]+)/)?.[1];
  const member = await env.DB.prepare(`
    SELECT organisation_id AS organisationId, user_id AS userId
    FROM memberships WHERE role = 'platform_admin' AND revoked_at IS NULL
    ORDER BY created_at LIMIT 1
  `).first<{ organisationId: string; userId: string }>();
  expect(access).toBeTruthy();
  expect(member).toBeTruthy();
  return { cookie: `spatial_access=${access}`, ...member! };
}

// Regression: ISSUE-004 — release history silently omitted the oldest release
// Found by /qa on 2026-08-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-08-10.md
it("continues immutable release history beyond its measured page", async () => {
  const auth = await login();
  const prefix = crypto.randomUUID();
  const projectId = `${prefix}-project`;
  const versionId = `${prefix}-version`;
  const assetId = `${prefix}-asset`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO projects
        (id, organisation_id, name, slug, status, capture_adapter,
          capture_adapter_v2, delivery_template, created_by)
      VALUES (?, ?, 'Release pagination project', ?, 'DRAFT', 'open-import',
        'open-import', 'Property showcase', ?)
    `).bind(projectId, auth.organisationId, `${prefix}-slug`, auth.userId),
    env.DB.prepare(`
      INSERT INTO scene_versions (id, project_id, version_number, status, created_by)
      VALUES (?, ?, 1, 'PUBLISHED', ?)
    `).bind(versionId, projectId, auth.userId),
    env.DB.prepare(`
      INSERT INTO assets
        (id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, sha256, integrity_status)
      VALUES (?, ?, ?, ?, 'web', 'sog', ?, 'scene.sog', 'application/octet-stream',
        1, ?, 'verified')
    `).bind(assetId, auth.organisationId, projectId, versionId, `${prefix}/scene.sog`, "0".repeat(64)),
  ]);
  await env.DB.prepare(`
    WITH RECURSIVE sequence(value) AS (
      SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < ?
    )
    INSERT INTO releases
      (id, organisation_id, project_id, version_id, web_asset_id, access_policy,
        viewer_config_json, published_at, created_by, client_operation_id, release_number)
    SELECT printf('%s-release-%04d', ?, value), ?, ?, ?, ?, 'public', '{}',
      printf('2026-08-10T00:%02d:%02d.000Z', CAST(value / 60 AS INTEGER), value % 60),
      ?, printf('%s-release-operation-%04d', ?, value), value
    FROM sequence
  `).bind(
    measuredReleaseBoundary + 1,
    prefix,
    auth.organisationId,
    projectId,
    versionId,
    assetId,
    auth.userId,
    prefix,
  ).run();

  const firstResponse = await exports.default.fetch(`${origin}/api/releases`, {
    headers: { cookie: auth.cookie },
  });
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json<{
    releases: Array<{ id: string; release_number: number }>;
    nextCursor: string | null;
  }>();
  expect(first.releases).toHaveLength(measuredReleaseBoundary);
  expect(first.nextCursor).toBeTruthy();

  const secondResponse = await exports.default.fetch(
    `${origin}/api/releases?cursor=${encodeURIComponent(first.nextCursor!)}`,
    { headers: { cookie: auth.cookie } },
  );
  expect(secondResponse.status).toBe(200);
  const second = await secondResponse.json<{
    releases: Array<{ id: string; release_number: number }>;
    nextCursor: string | null;
  }>();
  expect(second.releases).toHaveLength(1);
  expect(second.releases[0]).toMatchObject({
    id: `${prefix}-release-0001`,
    release_number: 1,
  });
  expect(second.nextCursor).toBeNull();
  const firstIds = new Set(first.releases.map((release) => release.id));
  expect(firstIds.size).toBe(first.releases.length);
  expect(firstIds.has(second.releases[0]!.id)).toBe(false);
});
