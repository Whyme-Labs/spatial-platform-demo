import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";

const origin = "https://spatial.test";

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
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": "2001:db8::203",
    },
    body: JSON.stringify({ email, challengeId, code }),
  });
  expect(response.status).toBe(200);
  const access = (response.headers.get("set-cookie") ?? "").match(/spatial_access=([^;,]+)/)?.[1];
  expect(access).toBeTruthy();
  const member = await env.DB.prepare(`
    SELECT organisation_id AS organisationId, user_id AS userId
    FROM memberships WHERE role = 'platform_admin' AND revoked_at IS NULL
    ORDER BY created_at LIMIT 1
  `).first<{ organisationId: string; userId: string }>();
  expect(member).toBeTruthy();
  return {
    cookie: `spatial_access=${access}`,
    organisationId: member!.organisationId,
    userId: member!.userId,
  };
}

// Regression: the production example row used this pre-policy identifier. The
// redesign must keep the whole portfolio readable while old data is repaired.
it("lists a project persisted with the legacy indoor-experience identifier", async () => {
  const auth = await login();
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO projects
      (id, organisation_id, name, slug, status, capture_adapter,
        capture_adapter_v2, delivery_template, created_by)
    VALUES (?, ?, 'Legacy indoor project', ?, 'PUBLISHED', 'open-import',
      'open-import', 'indoor-experience', ?)
  `).bind(id, auth.organisationId, `legacy-indoor-${id.slice(0, 8)}`, auth.userId).run();

  const response = await exports.default.fetch(`${origin}/api/projects`, {
    headers: { cookie: auth.cookie },
  });
  expect(response.status).toBe(200);
  const body = await response.json<{
    projects: Array<{
      id: string;
      deliveryTemplate: string;
      workflowPolicy: { publication: string; navigation: string };
    }>;
  }>();
  expect(body.projects.find((project) => project.id === id)).toMatchObject({
    deliveryTemplate: "indoor-experience",
    workflowPolicy: {
      publication: "public-after-approval",
      navigation: "visitor-walk",
    },
  });
});
