import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";

const origin = "https://spatial.test";

async function administratorCookie(): Promise<string> {
  const email = env.ADMIN_EMAIL.toLowerCase();
  const challengeId = crypto.randomUUID();
  const code = "314159";
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
      Origin: origin,
      "CF-Connecting-IP": "2001:db8::420",
    },
    body: JSON.stringify({ challengeId, email, code }),
  });
  expect(response.status).toBe(200);
  const access = response.headers.get("set-cookie")
    ?.match(/spatial_access=([^;,]+)/)?.[1];
  expect(access).toBeTruthy();
  return `spatial_access=${access}`;
}

describe("enterprise OIDC HTTP lifecycle", () => {
  it("keeps a new provider draft until its external secret and discovery both succeed", async () => {
    const cookie = await administratorCookie();
    const create = await exports.default.fetch(`${origin}/api/team/identity-providers`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: origin,
        Cookie: cookie,
      },
      body: JSON.stringify({
        name: "Example workforce",
        issuer: "https://identity.example.com/",
        clientId: "spatial-client",
        emailDomains: ["example.com"],
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json<{
      provider: {
        id: string;
        status: string;
        secretConfigured: boolean;
        issuer: string;
      };
      secretReference: string;
    }>();
    expect(created.provider).toMatchObject({
      status: "draft",
      secretConfigured: false,
      issuer: "https://identity.example.com",
    });
    expect(created.secretReference).toBe(created.provider.id);

    const activate = await exports.default.fetch(
      `${origin}/api/team/identity-providers/${created.provider.id}/activate`,
      {
        method: "POST",
        headers: { Origin: origin, Cookie: cookie },
      },
    );
    expect(activate.status).toBe(503);
    await expect(activate.json()).resolves.toMatchObject({
      code: "client_secret_missing",
      secretReference: created.provider.id,
    });
    const stored = await env.DB.prepare(`
      SELECT status FROM enterprise_identity_providers WHERE id = ?
    `).bind(created.provider.id).first<{ status: string }>();
    expect(stored?.status).toBe("draft");

    const list = await exports.default.fetch(`${origin}/api/team/identity-providers`, {
      headers: { Cookie: cookie },
    });
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      providers: [{
        id: created.provider.id,
        status: "draft",
        secretConfigured: false,
      }],
    });

    const discovery = await exports.default.fetch(`${origin}/api/auth/oidc/discover`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: origin,
        "CF-Connecting-IP": "2001:db8::421",
      },
      body: JSON.stringify({ email: "person@example.com" }),
    });
    expect(discovery.status).toBe(200);
    await expect(discovery.json()).resolves.toEqual({ providers: [] });

    const remove = await exports.default.fetch(
      `${origin}/api/team/identity-providers/${created.provider.id}`,
      {
        method: "DELETE",
        headers: { Origin: origin, Cookie: cookie },
      },
    );
    expect(remove.status).toBe(204);
  });

  it("does not expose provider administration to anonymous callers", async () => {
    const response = await exports.default.fetch(`${origin}/api/team/identity-providers`);
    expect(response.status).toBe(401);
  });
});
