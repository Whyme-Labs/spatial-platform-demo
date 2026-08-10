import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";

const origin = "https://spatial.test";
// Receipt: docs/CAPACITY_RECEIPTS.md, "Production-scale local QA list boundaries".
const measuredJobBoundary = 200;

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
    headers: { "content-type": "application/json", "CF-Connecting-IP": "2001:db8::205" },
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

// Regression: ISSUE-005 — processing activity silently omitted the next job
// Found by /qa on 2026-08-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-08-10.md
it("continues query-visible processing history beyond its measured page", async () => {
  const auth = await login();
  const prefix = crypto.randomUUID();
  const projectId = `${prefix}-project`;
  const versionId = `${prefix}-version`;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO projects
        (id, organisation_id, name, slug, status, capture_adapter,
          capture_adapter_v2, delivery_template, created_by)
      VALUES (?, ?, 'Job pagination project', ?, 'DRAFT', 'open-import',
        'open-import', 'Property showcase', ?)
    `).bind(projectId, auth.organisationId, `${prefix}-slug`, auth.userId),
    env.DB.prepare(`
      INSERT INTO scene_versions (id, project_id, version_number, status, created_by)
      VALUES (?, ?, 1, 'PROCESSING', ?)
    `).bind(versionId, projectId, auth.userId),
  ]);
  await env.DB.prepare(`
    WITH RECURSIVE sequence(value) AS (
      SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < ?
    )
    INSERT INTO processing_jobs
      (id, organisation_id, project_id, version_id, job_type, processor_version,
        idempotency_key, state, priority, progress, created_at, updated_at)
    SELECT printf('%s-job-%04d', ?, value), ?, ?, ?, 'pagination-fixture', 'fixture',
      printf('%s-job-operation-%04d', ?, value), 'SUCCEEDED', 100, 100,
      '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z'
    FROM sequence
  `).bind(
    measuredJobBoundary + 1,
    prefix,
    auth.organisationId,
    projectId,
    versionId,
    prefix,
  ).run();

  const firstResponse = await exports.default.fetch(`${origin}/api/jobs`, {
    headers: { cookie: auth.cookie },
  });
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json<{
    jobs: Array<{ id: string }>;
    nextCursor: string | null;
  }>();
  expect(first.jobs).toHaveLength(measuredJobBoundary);
  expect(first.nextCursor).toBeTruthy();

  const secondResponse = await exports.default.fetch(
    `${origin}/api/jobs?cursor=${encodeURIComponent(first.nextCursor!)}`,
    { headers: { cookie: auth.cookie } },
  );
  expect(secondResponse.status).toBe(200);
  const second = await secondResponse.json<{
    jobs: Array<{ id: string }>;
    nextCursor: string | null;
  }>();
  expect(second.jobs).toHaveLength(1);
  expect(second.jobs[0]?.id).toBe(`${prefix}-job-0201`);
  expect(second.nextCursor).toBeNull();
  const firstIds = new Set(first.jobs.map((job) => job.id));
  expect(firstIds.size).toBe(first.jobs.length);
  expect(firstIds.has(second.jobs[0]!.id)).toBe(false);
});
