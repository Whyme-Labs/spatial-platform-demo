import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildOidcAuthorizationUrl,
  discoverOidcProvider,
  exchangeOidcCode,
  verifyOidcIdToken,
} from "../src/worker/oidc";

const issuer = "https://identity.example.com";
const metadata = {
  issuer,
  authorizationEndpoint: `${issuer}/authorize`,
  tokenEndpoint: `${issuer}/token`,
  jwksUri: `${issuer}/jwks`,
  signingAlgorithms: ["RS256"] as const,
};

describe("enterprise OIDC adapter", () => {
  it("rejects private and local provider endpoints before discovery", async () => {
    const fetcher = vi.fn();
    await expect(discoverOidcProvider("https://localhost", fetcher))
      .rejects.toMatchObject({ code: "provider_url_invalid" });
    await expect(discoverOidcProvider("https://127.0.0.1", fetcher))
      .rejects.toMatchObject({ code: "provider_url_invalid" });
    await expect(discoverOidcProvider("https://identity.internal", fetcher))
      .rejects.toMatchObject({ code: "provider_url_invalid" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("validates discovery metadata and builds a PKCE authorization request", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      issuer,
      authorization_endpoint: metadata.authorizationEndpoint,
      token_endpoint: metadata.tokenEndpoint,
      jwks_uri: metadata.jwksUri,
      response_types_supported: ["code"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
    }), { headers: { "content-type": "application/json" } }));
    const discovered = await discoverOidcProvider(issuer, fetcher);
    const request = await buildOidcAuthorizationUrl(discovered, {
      clientId: "client_spatial",
      redirectUri: "https://spatial.whymelabs.com/api/auth/oidc/provider-1/callback",
      state: "state_123",
      nonce: "nonce_123",
      codeVerifier: "a".repeat(64),
    });
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe(metadata.authorizationEndpoint);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state_123");
    expect(url.searchParams.get("nonce")).toBe("nonce_123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("rejects oversized provider responses before parsing them", async () => {
    const fetcher = vi.fn(async () => new Response("{}", {
      headers: { "content-length": "512001" },
    }));
    await expect(discoverOidcProvider(issuer, fetcher))
      .rejects.toMatchObject({ code: "provider_response_too_large" });
  });

  it("exchanges an authorization code without leaking the client secret into the URL", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(metadata.tokenEndpoint);
      expect(init?.method).toBe("POST");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("code_123");
      expect(body.get("client_secret")).toBe("secret_123");
      expect(body.get("code_verifier")).toBe("v".repeat(64));
      return new Response(JSON.stringify({
        token_type: "Bearer",
        id_token: "header.payload.signature",
      }), { headers: { "content-type": "application/json" } });
    });
    const tokens = await exchangeOidcCode(metadata, {
      clientId: "client_spatial",
      clientSecret: "secret_123",
      redirectUri: "https://spatial.whymelabs.com/api/auth/oidc/provider-1/callback",
      code: "code_123",
      codeVerifier: "v".repeat(64),
    }, fetcher);
    expect(tokens.idToken).toBe("header.payload.signature");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("verifies an RS256 ID token and rejects the wrong nonce", async () => {
    const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const publicJwk = await webcrypto.subtle.exportKey("jwk", publicKey);
    publicJwk.kid = "provider-key-1";
    publicJwk.alg = "RS256";
    const now = 1_785_180_000;
    const token = await signRs256(privateKey, {
      iss: issuer,
      aud: "client_spatial",
      sub: "subject-123",
      email: "buyer@example.com",
      email_verified: true,
      nonce: "nonce_123",
      iat: now - 10,
      exp: now + 300,
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      keys: [publicJwk],
    }), { headers: { "content-type": "application/json" } }));

    await expect(verifyOidcIdToken(token, metadata, {
      clientId: "client_spatial",
      expectedNonce: "nonce_123",
      nowSeconds: now,
    }, fetcher)).resolves.toMatchObject({
      subject: "subject-123",
      email: "buyer@example.com",
      emailVerified: true,
    });
    await expect(verifyOidcIdToken(token, metadata, {
      clientId: "client_spatial",
      expectedNonce: "wrong",
      nowSeconds: now,
    }, fetcher)).rejects.toThrow(/nonce/i);

    const staleToken = await signRs256(privateKey, {
      iss: issuer,
      aud: "client_spatial",
      sub: "subject-123",
      email: "buyer@example.com",
      email_verified: true,
      nonce: "nonce_123",
      iat: now - 601,
      exp: now + 300,
    });
    await expect(verifyOidcIdToken(staleToken, metadata, {
      clientId: "client_spatial",
      expectedNonce: "nonce_123",
      nowSeconds: now,
    }, fetcher)).rejects.toMatchObject({ code: "id_token_iat" });
  });
});

async function signRs256(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
): Promise<string> {
  const header = base64Url(JSON.stringify({
    alg: "RS256",
    typ: "JWT",
    kid: "provider-key-1",
  }));
  const payload = base64Url(JSON.stringify(claims));
  const signed = `${header}.${payload}`;
  const signature = await webcrypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${base64Url(new Uint8Array(signature))}`;
}

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString("base64url");
}
