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
      "CF-Connecting-IP": "2001:db8::202",
    },
    body: JSON.stringify({ email, challengeId, code }),
  });
  expect(response.status).toBe(200);
  const access = (response.headers.get("set-cookie") ?? "").match(/spatial_access=([^;,]+)/)?.[1];
  expect(access).toBeTruthy();
  return `spatial_access=${access}`;
}

// Regression: ISSUE-002 — projects beyond the first list boundary were silently unreachable
// Found by /qa on 2026-08-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-08-10.md
it("returns an explicit keyset continuation for the project beyond the measured page", async () => {
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
        capture_adapter_v2, delivery_template, created_by, updated_at)
    SELECT
      printf('%s-id-%04d', ?, value), ?, printf('Paginated project %04d', value),
      printf('%s-slug-%04d', ?, value), 'DRAFT', 'open-import', 'open-import',
      'Property showcase', ?, '2026-08-10T00:00:00.000Z'
    FROM sequence
  `).bind(
    measuredProjectListBoundary + 1,
    prefix,
    member!.organisationId,
    prefix,
    member!.userId,
  ).run();

  const firstResponse = await exports.default.fetch(`${origin}/api/projects`, {
    headers: { cookie },
  });
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json<{
    projects: Array<{ id: string }>;
    nextCursor: string | null;
  }>();
  expect(first.projects).toHaveLength(measuredProjectListBoundary);
  expect(first.nextCursor).toBeTruthy();

  const secondResponse = await exports.default.fetch(
    `${origin}/api/projects?cursor=${encodeURIComponent(first.nextCursor!)}`,
    { headers: { cookie } },
  );
  expect(secondResponse.status).toBe(200);
  const second = await secondResponse.json<{
    projects: Array<{ id: string }>;
    nextCursor: string | null;
  }>();
  expect(second.projects).toHaveLength(1);
  expect(second.projects[0]?.id).toBe(`${prefix}-id-0001`);
  expect(second.nextCursor).toBeNull();

  const firstIds = new Set(first.projects.map((project) => project.id));
  expect(firstIds.size).toBe(first.projects.length);
  expect(firstIds.has(second.projects[0]!.id)).toBe(false);

  const invalidResponse = await exports.default.fetch(`${origin}/api/projects?cursor=invalid`, {
    headers: { cookie },
  });
  expect(invalidResponse.status).toBe(400);
  await expect(invalidResponse.json()).resolves.toMatchObject({
    error: "Validation failed",
    details: {
      cursor: ["Project list cursor is invalid. Reload the portfolio and try again."],
    },
  });
});
