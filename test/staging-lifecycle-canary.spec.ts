import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/worker/index";
import {
  authorizeStagingLifecycleCanary,
  STAGING_LIFECYCLE_CANARY_EMAIL,
  STAGING_LIFECYCLE_CANARY_ORGANISATION_ID,
  STAGING_LIFECYCLE_CANARY_USER_ID,
} from "../src/worker/staging-lifecycle-canary";

describe("staging lifecycle canary authentication", () => {
  it("is unavailable outside staging even when a valid credential is supplied", async () => {
    expect(await authorizeStagingLifecycleCanary(
      "production",
      "canary-secret",
      "Bearer canary-secret",
    )).toBe(false);
  });

  it("accepts only an exact bearer credential for the fixed service operator", async () => {
    expect(STAGING_LIFECYCLE_CANARY_EMAIL).toBe("lifecycle-canary@synthetic.invalid");
    expect(STAGING_LIFECYCLE_CANARY_USER_ID).toBe("cafe0000-0000-4000-8000-000000000001");
    expect(STAGING_LIFECYCLE_CANARY_ORGANISATION_ID).toBe("cafe0000-0000-4000-8000-000000000002");
    expect(await authorizeStagingLifecycleCanary(
      "staging",
      "canary-secret",
      "Bearer wrong-secret",
    )).toBe(false);
    expect(await authorizeStagingLifecycleCanary(
      "staging",
      "canary-secret",
      "Bearer canary-secret",
    )).toBe(true);
  });

  it("keeps the OTP route nonexistent outside staging and same-origin inside it", async () => {
    const productionContext = createExecutionContext();
    const production = await worker.fetch(new Request(
      "https://spatial.test/api/auth/staging-lifecycle-canary/otp",
      { method: "POST", headers: { origin: "https://spatial.test" } },
    ), env, productionContext);
    await waitOnExecutionContext(productionContext);
    expect(production.status).toBe(404);

    const stagingEnv = Object.assign(Object.create(env) as Env, {
      APP_ENV: "staging",
      APP_ORIGIN: "https://spatial-studio-staging.swmengappdev.workers.dev",
      STAGING_LIFECYCLE_CANARY_TOKEN: "canary-secret",
    });
    const crossOriginContext = createExecutionContext();
    const crossOrigin = await worker.fetch(new Request(
      "https://spatial-studio-staging.swmengappdev.workers.dev/api/auth/staging-lifecycle-canary/otp",
      {
        method: "POST",
        headers: {
          origin: "https://staging.attacker.example",
          authorization: "Bearer canary-secret",
        },
      },
    ), stagingEnv, crossOriginContext);
    await waitOnExecutionContext(crossOriginContext);
    expect(crossOrigin.status).toBe(403);
  });

  it("issues an OTP only when the fixed user has exactly the fixed operator membership", async () => {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET email = excluded.email
      `).bind(
        STAGING_LIFECYCLE_CANARY_USER_ID,
        STAGING_LIFECYCLE_CANARY_EMAIL,
        "Lifecycle canary service operator",
      ),
      env.DB.prepare(`
        INSERT INTO organisations (id, name, slug) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name
      `).bind(
        STAGING_LIFECYCLE_CANARY_ORGANISATION_ID,
        "Lifecycle canary staging tenant",
        "lifecycle-canary-staging",
      ),
      env.DB.prepare(`
        INSERT INTO memberships
          (organisation_id, user_id, role, updated_at, revoked_at, status)
        VALUES (?, ?, 'production_operator', datetime('now'), NULL, 'active')
        ON CONFLICT(organisation_id, user_id) DO UPDATE SET
          role = excluded.role, revoked_at = NULL, status = 'active'
      `).bind(
        STAGING_LIFECYCLE_CANARY_ORGANISATION_ID,
        STAGING_LIFECYCLE_CANARY_USER_ID,
      ),
    ]);
    const stagingEnv = Object.assign(Object.create(env) as Env, {
      APP_ENV: "staging",
      APP_ORIGIN: "https://spatial-studio-staging.swmengappdev.workers.dev",
      STAGING_LIFECYCLE_CANARY_TOKEN: "canary-secret",
    });
    const requestOtp = async () => {
      const context = createExecutionContext();
      const response = await worker.fetch(new Request(
        "https://spatial-studio-staging.swmengappdev.workers.dev/api/auth/staging-lifecycle-canary/otp",
        {
          method: "POST",
          headers: {
            origin: "https://spatial-studio-staging.swmengappdev.workers.dev",
            authorization: "Bearer canary-secret",
          },
        },
      ), stagingEnv, context);
      await waitOnExecutionContext(context);
      return response;
    };
    expect((await requestOtp()).status).toBe(200);

    const otherOrganisationId = "cafe0000-0000-4000-8000-000000000003";
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO organisations (id, name, slug) VALUES (?, ?, ?)
      `).bind(otherOrganisationId, "Unexpected canary tenant", "unexpected-canary-tenant"),
      env.DB.prepare(`
        INSERT INTO memberships
          (organisation_id, user_id, role, updated_at, revoked_at, status)
        VALUES (?, ?, 'platform_admin', datetime('now'), NULL, 'active')
      `).bind(otherOrganisationId, STAGING_LIFECYCLE_CANARY_USER_ID),
    ]);
    expect((await requestOtp()).status).toBe(503);
  });
});
