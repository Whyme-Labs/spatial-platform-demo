import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import {
  TurnstileVerificationError,
  verifyTurnstileToken,
} from "../src/worker/turnstile";

const origin = "https://spatial.test";

describe("Turnstile verification", () => {
  it("accepts only a successful response for the expected action and hostname", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        success: true,
        challenge_ts: "2026-07-29T05:00:00.000Z",
        hostname: "spatial.test",
        action: "otp_request",
      }),
      { headers: { "Content-Type": "application/json" } },
    ));

    await expect(verifyTurnstileToken({
      secretKey: "test-secret",
      token: "test-token",
      remoteIp: "2001:db8::1",
      expectedHostname: "spatial.test",
      expectedAction: "otp_request",
      idempotencyKey: "ddf4db1b-ad1d-4cbb-a0e0-a6417ee7b79d",
      fetcher,
    })).resolves.toEqual({
      hostname: "spatial.test",
      action: "otp_request",
      challengeTimestamp: "2026-07-29T05:00:00.000Z",
      attempts: 1,
    });

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      idempotency_key: string;
      remoteip: string;
      response: string;
    };
    expect(body).toMatchObject({
      idempotency_key: "ddf4db1b-ad1d-4cbb-a0e0-a6417ee7b79d",
      remoteip: "2001:db8::1",
      response: "test-token",
    });
  });

  it("retries a transient provider failure with the same idempotency key", async () => {
    const requestBodies: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      requestBodies.push(String(init?.body));
      if (requestBodies.length === 1) {
        return new Response(
          JSON.stringify({ success: false, "error-codes": ["internal-error"] }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          hostname: "spatial.test",
          action: "otp_request",
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });

    await expect(verifyTurnstileToken({
      secretKey: "test-secret",
      token: "test-token",
      remoteIp: null,
      expectedHostname: "spatial.test",
      expectedAction: "otp_request",
      idempotencyKey: "f5435771-1c74-42af-9943-d3e1d806969c",
      fetcher,
    })).resolves.toMatchObject({ attempts: 2 });
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[1]).toBe(requestBodies[0]);
  });

  it("rejects action or hostname substitution", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        success: true,
        hostname: "attacker.example",
        action: "otp_request",
      }),
      { headers: { "Content-Type": "application/json" } },
    ));

    await expect(verifyTurnstileToken({
      secretKey: "test-secret",
      token: "test-token",
      remoteIp: null,
      expectedHostname: "spatial.test",
      expectedAction: "otp_request",
      fetcher,
    })).rejects.toMatchObject<TurnstileVerificationError>({
      code: "rejected",
      retryable: false,
    });
  });

  it("accepts Cloudflare testing-key metadata only when test mode is explicit", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        success: true,
        hostname: "example.com",
        metadata: { result_with_testing_key: true },
      }),
      { headers: { "Content-Type": "application/json" } },
    ));

    await expect(verifyTurnstileToken({
      secretKey: "test-secret",
      token: "test-token",
      remoteIp: null,
      expectedHostname: "localhost",
      expectedAction: "test",
      testMode: true,
      fetcher,
    })).resolves.toMatchObject({
      hostname: "example.com",
      action: "",
      attempts: 1,
    });
  });
});

describe("Turnstile-protected OTP requests", () => {
  it("publishes only the site key and fails closed without a challenge token", async () => {
    const configResponse = await exports.default.fetch(`${origin}/api/auth/config`);
    expect(configResponse.status).toBe(200);
    expect(configResponse.headers.get("cache-control")).toBe("private, no-store");
    const configText = await configResponse.text();
    expect(configText).toContain(env.TURNSTILE_SITE_KEY);
    expect(configText).not.toContain(env.TURNSTILE_SECRET_KEY);

    const before = await otpChallengeCount();
    const response = await exports.default.fetch(`${origin}/api/auth/otp/request`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: origin,
        "CF-Connecting-IP": "2001:db8::100",
      },
      body: JSON.stringify({ email: "unknown@example.com" }),
    });
    expect(response.status).toBe(400);
    expect(await otpChallengeCount()).toBe(before);
  });
});

async function otpChallengeCount(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM auth_otp_challenges",
  ).first<{ count: number }>();
  return row?.count ?? 0;
}
