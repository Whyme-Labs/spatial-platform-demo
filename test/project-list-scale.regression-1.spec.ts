import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";

const origin = "https://spatial.test";
// Receipt: docs/CAPACITY_RECEIPTS.md, "Production-scale local QA list boundaries".
const measuredProjectListBoundary = 200;

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
      "CF-Connecting-IP": "2001:db8::201",
    },
    body: JSON.stringify({ email, challengeId, code }),
  });
  expect(response.status).toBe(200);
  const access = (response.headers.get("set-cookie") ?? "").match(/spatial_access=([^;,]+)/)?.[1];
  expect(access).toBeTruthy();
  return `spatial_access=${access}`;
}

// Regression: ISSUE-001 — project custom-field readback exceeded D1's SQL-variable ceiling
// Found by /qa on 2026-08-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-08-10.md
it("returns the complete measured project page without expanding one SQL variable per project", async () => {
  const cookie = await login();
  const member = await env.DB.prepare(`
    SELECT organisation_id AS organisationId, user_id AS userId
    FROM memberships WHERE role = 'platform_admin' AND revoked_at IS NULL
    ORDER BY created_at LIMIT 1
  `).first<{ organisationId: string; userId: string }>();
  expect(member).toBeTruthy();
  const prefix = crypto.randomUUID();
  await env.DB.prepare(`
    WITH RECURSIVE sequence(value) AS (
      SELECT 1
      UNION ALL
      SELECT value + 1 FROM sequence WHERE value < ?
    )
    INSERT INTO projects
      (id, organisation_id, name, slug, status, capture_adapter,
        capture_adapter_v2, delivery_template, created_by)
    SELECT
      printf('%s-id-%04d', ?, value), ?, printf('Scale project %04d', value),
      printf('%s-slug-%04d', ?, value), 'DRAFT', 'open-import', 'open-import',
      'Property showcase', ?
    FROM sequence
  `).bind(
    measuredProjectListBoundary,
    prefix,
    member!.organisationId,
    prefix,
    member!.userId,
  ).run();

  const response = await exports.default.fetch(`${origin}/api/projects`, {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  const body = await response.json<{ projects: Array<{ id: string }> }>();
  expect(body.projects).toHaveLength(measuredProjectListBoundary);
});
