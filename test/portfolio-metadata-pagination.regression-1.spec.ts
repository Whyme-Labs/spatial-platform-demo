import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";

const origin = "https://spatial.test";
// Receipt: docs/CAPACITY_RECEIPTS.md, "Production-scale local QA list boundaries".
const measuredTemplateBoundary = 100;
const measuredSavedViewBoundary = 50;

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
    headers: { "content-type": "application/json", "CF-Connecting-IP": "2001:db8::203" },
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

// Regression: ISSUE-003 — portfolio metadata inventories stopped without continuation
// Found by /qa on 2026-08-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-08-10.md
it("continues template and saved-view inventories beyond their measured pages", async () => {
  const auth = await login();
  const prefix = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < ?
      )
      INSERT INTO project_templates
        (id, organisation_id, name, capture_adapter, capture_adapter_v2,
          delivery_template, policy_json, client_operation_id, request_hash, created_by)
      SELECT printf('%s-template-%04d', ?, value), ?, printf('Pagination template %04d', value),
        'open-import', 'open-import', 'Property showcase', '{}',
        printf('%s-template-operation-%04d', ?, value), 'fixture', ?
      FROM sequence
    `).bind(
      measuredTemplateBoundary + 1,
      prefix,
      auth.organisationId,
      prefix,
      auth.userId,
    ),
    env.DB.prepare(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < ?
      )
      INSERT INTO project_saved_views
        (id, organisation_id, user_id, name, filter_json, is_default,
          client_operation_id, request_hash)
      SELECT printf('%s-view-%04d', ?, value), ?, ?, printf('Pagination view %04d', value),
        '{"query":"","statuses":[],"captureAdapters":[],"deliveryTemplates":[],"sort":"updated_desc"}',
        0, printf('%s-view-operation-%04d', ?, value), 'fixture'
      FROM sequence
    `).bind(
      measuredSavedViewBoundary + 1,
      prefix,
      auth.organisationId,
      auth.userId,
      prefix,
    ),
  ]);

  const templates = await readTwoPages("project-templates", "templates", auth.cookie);
  expect(templates.first).toHaveLength(measuredTemplateBoundary);
  expect(templates.second).toHaveLength(1);
  expect(templates.second[0]?.id).toBe(`${prefix}-template-0101`);

  const views = await readTwoPages("project-views", "views", auth.cookie);
  expect(views.first).toHaveLength(measuredSavedViewBoundary);
  expect(views.second).toHaveLength(1);
  expect(views.second[0]?.id).toBe(`${prefix}-view-0051`);
});

async function readTwoPages(
  endpoint: string,
  key: "templates" | "views",
  cookie: string,
): Promise<{ first: Array<{ id: string }>; second: Array<{ id: string }> }> {
  const firstResponse = await exports.default.fetch(`${origin}/api/${endpoint}`, { headers: { cookie } });
  expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json<Record<typeof key, Array<{ id: string }>> & { nextCursor: string | null }>();
  expect(first.nextCursor).toBeTruthy();
  const secondResponse = await exports.default.fetch(
    `${origin}/api/${endpoint}?cursor=${encodeURIComponent(first.nextCursor!)}`,
    { headers: { cookie } },
  );
  expect(secondResponse.status).toBe(200);
  const second = await secondResponse.json<Record<typeof key, Array<{ id: string }>> & { nextCursor: string | null }>();
  expect(second.nextCursor).toBeNull();
  const firstIds = new Set(first[key].map((record) => record.id));
  expect(firstIds.size).toBe(first[key].length);
  expect(firstIds.has(second[key][0]!.id)).toBe(false);
  return { first: first[key], second: second[key] };
}
