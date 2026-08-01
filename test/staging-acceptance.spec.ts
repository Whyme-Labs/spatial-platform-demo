import { describe, expect, it } from "vitest";
import {
  assertWorkerSecurityHeaders,
  runStagingHttpAcceptance,
  StagingAcceptanceError,
  validateDeploymentStatus,
  validateRemoteD1Probe,
} from "../scripts/staging-acceptance-core.mjs";

const appOrigin = "https://staging.example.com";
const processorOrigin = "https://processor-staging.example.com";
const requestId = "acceptance-request-id";
const securityHeaders = {
  "content-security-policy":
    "default-src 'self'; object-src 'none'; frame-ancestors 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=()",
  "x-request-id": requestId,
};

describe("deployed staging acceptance contract", () => {
  it("accepts a complete deployed HTTP boundary without bypassing authentication", async () => {
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === `${appOrigin}/api/health`) {
        return json({
          status: "ok",
          environment: "staging",
          timestamp: "2026-07-29T12:00:00.000Z",
          requestId,
        });
      }
      if (url === `${appOrigin}/api/auth/config`) {
        return json({
          turnstileSiteKey: "1x00000000000000000000AA",
          turnstileAction: "otp_request",
        }, { "cache-control": "no-store" });
      }
      if (url === `${appOrigin}/api/auth/session`) {
        return json({ authenticated: false }, { "cache-control": "no-store" });
      }
      if (url === `${appOrigin}/api/projects`) {
        return json({ error: "Authentication required" }, {
          "cache-control": "no-store",
        }, 401);
      }
      if (url === `${appOrigin}/.well-known/jwks.json`) {
        return json({
          keys: [{
            kty: "EC",
            crv: "P-256",
            alg: "ES256",
            use: "sig",
            kid: "staging-key",
            x: "x-coordinate",
            y: "y-coordinate",
          }],
        });
      }
      if (url === `${appOrigin}/.well-known/openid-configuration`) {
        return json({
          issuer: appOrigin,
          jwks_uri: `${appOrigin}/.well-known/jwks.json`,
          id_token_signing_alg_values_supported: ["ES256"],
        });
      }
      if (
        url === `${appOrigin}/` ||
        url === `${appOrigin}/studio.html` ||
        url === `${appOrigin}/renderer/index.html`
      ) {
        return new Response(
          url.endsWith("renderer/index.html")
            ? "<html>Spark</html>"
            : "<html>Spatial Studio</html>",
          {
            headers: {
              ...securityHeaders,
              "content-type": "text/html; charset=utf-8",
            },
          },
        );
      }
      if (url === processorOrigin) {
        return json({
          service: "spatial-processor-cloud",
          status: "ok",
          processor: "spatial-processor/0.8.0",
          renderer: "Spark 2.1.0",
          execution: "cloudflare-container",
        }, {}, 200, false);
      }
      return new Response("missing", { status: 404 });
    };

    const result = await runStagingHttpAcceptance({
      appOrigin,
      processorOrigin,
      expectedTurnstileSiteKey: "1x00000000000000000000AA",
      fetcher,
    });

    expect(result.steps).toHaveLength(10);
    expect(result.steps.every((step: { status: string }) => step.status === "passed")).toBe(true);
    expect(result.application).toMatchObject({ environment: "staging", requestId });
    expect(result.processor).toMatchObject({
      processor: "spatial-processor/0.8.0",
      renderer: "Spark 2.1.0",
    });
  });

  it("fails closed when security headers or private-key boundaries drift", () => {
    expect(() => assertWorkerSecurityHeaders(new Response())).toThrow(
      StagingAcceptanceError,
    );
    expect(() => validateDeploymentStatus({
      id: "deployment",
      versions: [{ version_id: "version", percentage: 50 }],
    }, "worker")).toThrow("no full staging deployment");
    expect(() => validateRemoteD1Probe([{
      success: true,
      results: [{ ready: 1, migration_count: 0 }],
    }])).toThrow("no applied migrations");
  });
});

function json(
  body: unknown,
  extraHeaders: Record<string, string> = {},
  status = 200,
  includeWorkerHeaders = true,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...(includeWorkerHeaders ? securityHeaders : {}),
      ...extraHeaders,
      "content-type": "application/json",
    },
  });
}
