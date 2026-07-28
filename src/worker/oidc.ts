export type OidcMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  signingAlgorithms: Array<"RS256" | "ES256">;
};

export type OidcIdentity = {
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  claims: Record<string, unknown>;
};

export class OidcError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OidcError";
  }
}

type AuthorizationInput = {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
};

type TokenInput = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
};

type VerificationInput = {
  clientId: string;
  expectedNonce: string;
  nowSeconds?: number;
};

const providerTimeoutMs = 10_000;
const maxProviderBodyBytes = 512_000;

export async function discoverOidcProvider(
  issuerValue: string,
  fetcher: typeof fetch = fetch,
): Promise<OidcMetadata> {
  const issuer = normalizeOidcIssuer(issuerValue);
  const discoveryUrl = new URL(issuer);
  discoveryUrl.pathname = `${discoveryUrl.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const payload = await fetchProviderJson(discoveryUrl.toString(), {
    method: "GET",
    headers: { accept: "application/json" },
  }, fetcher);
  if (stringValue(payload.issuer) !== issuer) {
    throw new OidcError("OIDC discovery issuer does not match the configured issuer", "issuer_mismatch", false);
  }
  const responseTypes = stringArray(payload.response_types_supported);
  if (!responseTypes.includes("code")) {
    throw new OidcError("OIDC provider does not support the authorization code flow", "code_flow_unsupported", false);
  }
  const challengeMethods = stringArray(payload.code_challenge_methods_supported);
  if (!challengeMethods.includes("S256")) {
    throw new OidcError("OIDC provider does not support PKCE S256", "pkce_unsupported", false);
  }
  const signingAlgorithms = stringArray(payload.id_token_signing_alg_values_supported)
    .filter((value): value is "RS256" | "ES256" => value === "RS256" || value === "ES256");
  if (!signingAlgorithms.length) {
    throw new OidcError("OIDC provider has no supported ID-token signing algorithm", "signing_algorithm_unsupported", false);
  }
  return {
    issuer,
    authorizationEndpoint: normalizedHttpsUrl(
      requiredString(payload, "authorization_endpoint"),
      "OIDC authorization endpoint",
      true,
    ),
    tokenEndpoint: normalizedHttpsUrl(
      requiredString(payload, "token_endpoint"),
      "OIDC token endpoint",
      true,
    ),
    jwksUri: normalizedHttpsUrl(
      requiredString(payload, "jwks_uri"),
      "OIDC JWKS endpoint",
      true,
    ),
    signingAlgorithms,
  };
}

export function normalizeOidcIssuer(value: string): string {
  return normalizedHttpsUrl(value, "OIDC issuer", false);
}

export async function buildOidcAuthorizationUrl(
  metadata: OidcMetadata,
  input: AuthorizationInput,
): Promise<{ url: string; codeChallenge: string }> {
  if (!input.clientId.trim()) {
    throw new OidcError("OIDC client identifier is missing", "client_id_missing", false);
  }
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) {
    throw new OidcError("OIDC PKCE verifier is invalid", "pkce_verifier_invalid", false);
  }
  const codeChallenge = base64UrlBytes(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input.codeVerifier),
  ));
  const url = new URL(metadata.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: "openid email profile",
    state: input.state,
    nonce: input.nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), codeChallenge };
}

export async function exchangeOidcCode(
  metadata: OidcMetadata,
  input: TokenInput,
  fetcher: typeof fetch = fetch,
): Promise<{ idToken: string }> {
  const payload = await fetchProviderJson(metadata.tokenEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
      code_verifier: input.codeVerifier,
    }).toString(),
  }, fetcher);
  const tokenType = stringValue(payload.token_type);
  if (tokenType && tokenType.toLowerCase() !== "bearer") {
    throw new OidcError("OIDC token endpoint returned an unsupported token type", "token_type_invalid", false);
  }
  return { idToken: requiredString(payload, "id_token") };
}

export async function verifyOidcIdToken(
  idToken: string,
  metadata: OidcMetadata,
  input: VerificationInput,
  fetcher: typeof fetch = fetch,
): Promise<OidcIdentity> {
  if (idToken.length > 65_536) {
    throw new OidcError("OIDC ID token is too large", "id_token_too_large", false);
  }
  const segments = idToken.split(".");
  if (segments.length !== 3) {
    throw new OidcError("OIDC ID token is malformed", "id_token_malformed", false);
  }
  const header = decodeJsonSegment(segments[0]!, "ID token header");
  const claims = decodeJsonSegment(segments[1]!, "ID token claims");
  const algorithm = stringValue(header.alg);
  const keyId = stringValue(header.kid);
  if (
    (algorithm !== "RS256" && algorithm !== "ES256") ||
    !metadata.signingAlgorithms.includes(algorithm)
  ) {
    throw new OidcError("OIDC ID token uses an unsupported signing algorithm", "id_token_algorithm", false);
  }
  if (!keyId) {
    throw new OidcError("OIDC ID token omitted its signing key identifier", "id_token_kid", false);
  }
  const jwks = await fetchProviderJson(metadata.jwksUri, {
    method: "GET",
    headers: { accept: "application/json" },
  }, fetcher);
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  const jwk = keys.find((candidate) => {
    const record = objectValue(candidate);
    return record && stringValue(record.kid) === keyId &&
      (!stringValue(record.alg) || stringValue(record.alg) === algorithm);
  });
  if (!jwk || !objectValue(jwk)) {
    throw new OidcError("OIDC signing key was not found", "signing_key_missing", true);
  }
  const verificationAlgorithm = algorithm === "RS256"
    ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
    : { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk as JsonWebKey,
      verificationAlgorithm,
      false,
      ["verify"],
    );
  } catch {
    throw new OidcError("OIDC signing key could not be imported", "signing_key_invalid", true);
  }
  const signature = decodeBase64Url(segments[2]!);
  const verified = await crypto.subtle.verify(
    algorithm === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5" }
      : { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    signature,
    new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
  );
  if (!verified) {
    throw new OidcError("OIDC ID token signature is invalid", "id_token_signature", false);
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (stringValue(claims.iss) !== metadata.issuer) {
    throw new OidcError("OIDC ID token issuer is invalid", "id_token_issuer", false);
  }
  const audience = typeof claims.aud === "string" ? [claims.aud] : stringArray(claims.aud);
  if (!audience.includes(input.clientId)) {
    throw new OidcError("OIDC ID token audience is invalid", "id_token_audience", false);
  }
  if (audience.length > 1 && stringValue(claims.azp) !== input.clientId) {
    throw new OidcError("OIDC ID token authorized party is invalid", "id_token_azp", false);
  }
  const expiresAt = integerValue(claims.exp);
  const issuedAt = integerValue(claims.iat);
  const notBefore = claims.nbf === undefined ? null : integerValue(claims.nbf);
  if (expiresAt === null || expiresAt < now - 60) {
    throw new OidcError("OIDC ID token has expired", "id_token_expired", false);
  }
  if (issuedAt === null || issuedAt > now + 60 || issuedAt < now - 600) {
    throw new OidcError("OIDC ID token issue time is invalid", "id_token_iat", false);
  }
  if (claims.nbf !== undefined && (notBefore === null || notBefore > now + 60)) {
    throw new OidcError("OIDC ID token is not active yet", "id_token_nbf", false);
  }
  if (stringValue(claims.nonce) !== input.expectedNonce) {
    throw new OidcError("OIDC ID token nonce is invalid", "id_token_nonce", false);
  }
  const subject = stringValue(claims.sub);
  const email = stringValue(claims.email)?.trim().toLowerCase();
  if (!subject || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new OidcError("OIDC ID token omitted a usable subject or email", "identity_claims_missing", false);
  }
  return {
    subject,
    email,
    emailVerified: claims.email_verified === true,
    displayName: stringValue(claims.name),
    claims,
  };
}

async function fetchProviderJson(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("OIDC provider timed out"), providerTimeoutMs);
  try {
    const response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
    const raw = await readBoundedProviderText(response);
    const payload = parseObject(raw);
    if (!response.ok) {
      const description = stringValue(payload.error_description)
        ?? stringValue(payload.error)
        ?? `OIDC provider returned HTTP ${response.status}`;
      throw new OidcError(
        description.slice(0, 500),
        "provider_request_failed",
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof OidcError) throw error;
    throw new OidcError(
      controller.signal.aborted ? "OIDC provider timed out" : "OIDC provider is unavailable",
      controller.signal.aborted ? "provider_timeout" : "provider_unavailable",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedProviderText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxProviderBodyBytes) {
    await response.body?.cancel();
    throw new OidcError("OIDC provider response is too large", "provider_response_too_large", false);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let result = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxProviderBodyBytes) {
        await reader.cancel();
        throw new OidcError("OIDC provider response is too large", "provider_response_too_large", false);
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
}

function normalizedHttpsUrl(value: string, label: string, allowPath: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcError(`${label} is not a valid URL`, "provider_url_invalid", false);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (!allowPath && url.pathname !== "/" && url.pathname.endsWith("/"))
  ) {
    throw new OidcError(`${label} must be an absolute HTTPS URL`, "provider_url_invalid", false);
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.includes(":") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  ) {
    throw new OidcError(`${label} cannot use a local or numeric host`, "provider_url_invalid", false);
  }
  if (!allowPath && url.pathname === "/") url.pathname = "";
  return url.toString().replace(/\/$/, "");
}

function decodeJsonSegment(segment: string, label: string): Record<string, unknown> {
  try {
    return parseObject(new TextDecoder().decode(decodeBase64Url(segment)));
  } catch {
    throw new OidcError(`${label} is invalid`, "id_token_malformed", false);
  }
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("Invalid base64url");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlBytes(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    const object = objectValue(parsed);
    if (!object) {
      throw new OidcError("OIDC provider returned invalid JSON", "provider_response_invalid", true);
    }
    return object;
  } catch (error) {
    if (error instanceof OidcError) throw error;
    throw new OidcError("OIDC provider returned invalid JSON", "provider_response_invalid", true);
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === "string")
    : [];
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = stringValue(value[key]);
  if (!result) {
    throw new OidcError(`OIDC provider omitted ${key}`, "provider_metadata_incomplete", false);
  }
  return result;
}
