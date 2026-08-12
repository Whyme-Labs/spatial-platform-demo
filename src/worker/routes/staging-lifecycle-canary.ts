import type { Hono } from "hono";

import { generateOtp, otpHash } from "../auth";
import { sha256Hex } from "../security";
import {
  authorizeStagingLifecycleCanary,
  STAGING_LIFECYCLE_CANARY_EMAIL,
  STAGING_LIFECYCLE_CANARY_ORGANISATION_ID,
  STAGING_LIFECYCLE_CANARY_USER_ID,
} from "../staging-lifecycle-canary";

type StagingLifecycleCanaryEnvironment = {
  Bindings: Env;
  Variables: { requestId: string };
};

export function registerStagingLifecycleCanaryRoutes(
  app: Hono<StagingLifecycleCanaryEnvironment>,
): void {
  app.post("/api/auth/staging-lifecycle-canary/otp", async (context) => {
    const response = (message: string, status: 401 | 403 | 404) => {
      context.header("Cache-Control", "private, no-store");
      return context.json({ error: message, requestId: context.get("requestId") }, status);
    };
    if (context.env.APP_ENV !== "staging") return response("Route not found", 404);
    if (context.req.header("Origin") !== new URL(context.env.APP_ORIGIN).origin) {
      return response("Cross-origin request rejected", 403);
    }
    if (!(await authorizeStagingLifecycleCanary(
      context.env.APP_ENV,
      context.env.STAGING_LIFECYCLE_CANARY_TOKEN,
      context.req.header("Authorization"),
    ))) {
      return response("Invalid staging lifecycle canary credential", 401);
    }
    const auth = await context.env.DB.prepare(`
      SELECT COUNT(*) AS activeMembershipCount,
        SUM(CASE
          WHEN u.id = ? AND m.organisation_id = ? AND m.role = 'production_operator'
          THEN 1 ELSE 0
        END) AS expectedMembershipCount
      FROM users u
      JOIN memberships m ON m.user_id = u.id
      WHERE lower(u.email) = ? AND m.revoked_at IS NULL AND m.status = 'active'
    `).bind(
      STAGING_LIFECYCLE_CANARY_USER_ID,
      STAGING_LIFECYCLE_CANARY_ORGANISATION_ID,
      STAGING_LIFECYCLE_CANARY_EMAIL,
    ).first<{
      activeMembershipCount: number;
      expectedMembershipCount: number;
    }>();
    if (
      !auth ||
      auth.activeMembershipCount !== 1 ||
      auth.expectedMembershipCount !== 1
    ) {
      return context.json({
        error: "The staging lifecycle canary service operator identity is not uniquely provisioned",
        requestId: context.get("requestId"),
      }, 503);
    }
    const challengeId = crypto.randomUUID();
    const code = generateOtp();
    const expiresAt = new Date(
      Date.now() + Number(context.env.OTP_TTL_SECONDS) * 1_000,
    ).toISOString();
    const emailHash = await sha256Hex(STAGING_LIFECYCLE_CANARY_EMAIL);
    await context.env.DB.batch([
      context.env.DB.prepare(`
        INSERT INTO auth_otp_challenges (id, email, code_hash, expires_at)
        VALUES (?, ?, ?, ?)
      `).bind(
        challengeId,
        STAGING_LIFECYCLE_CANARY_EMAIL,
        await otpHash(
          challengeId,
          STAGING_LIFECYCLE_CANARY_EMAIL,
          code,
          context.env.OTP_PEPPER,
        ),
        expiresAt,
      ),
      context.env.DB.prepare(`
        INSERT INTO auth_security_events
          (id, event_type, email_hash, user_id, session_id, request_id,
            ip_address, metadata_json)
        VALUES (?, 'staging_canary.otp_issued', ?, ?, NULL, ?, ?, '{}')
      `).bind(
        crypto.randomUUID(),
        emailHash,
        STAGING_LIFECYCLE_CANARY_USER_ID,
        context.get("requestId"),
        context.req.header("CF-Connecting-IP") ?? null,
      ),
    ]);
    return context.json({
      email: STAGING_LIFECYCLE_CANARY_EMAIL,
      challengeId,
      code,
      expiresAt,
    });
  });
}
