import {
  accessTokenCookie,
  base64UrlDecode,
  base64UrlEncode,
  expiredAccessTokenCookie,
  expiredRefreshTokenCookie,
  parseCookie,
  refreshTokenCookie,
  secureToken,
  sha256Hex,
  timingSafeStringEqual,
} from "./security";
import type { AuthContext } from "./contracts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const accessCookieName = "spatial_access";
export const refreshCookieName = "spatial_refresh";

export type AuthSessionRow = AuthContext & {
  sessionId: string;
  expiresAt: string;
  revokedAt: string | null;
  authMethod: "email_otp" | "oidc";
  identityProviderId: string | null;
};

type EcKey = {
  kid: string;
  status: "active" | "verify";
  privateJwk: JsonWebKey;
  createdAt: string;
  notBefore: string;
  retireAfter?: string;
};

type KeyRing = {
  version: 1;
  activeKid: string;
  keys: EcKey[];
};

type JwtClaims = {
  iss: string;
  aud: string;
  sub: string;
  sid: string;
  jti: string;
  iat: number;
  nbf: number;
  exp: number;
  organisationId: string;
  role: AuthContext["role"];
  email: string;
};

export type AuthTokens = {
  accessToken: string;
  accessTtlSeconds: number;
  refreshToken: string;
  refreshTtlSeconds: number;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

export function appendAuthCookies(headers: Headers, tokens: AuthTokens): void {
  headers.append("Set-Cookie", accessTokenCookie(tokens.accessToken, tokens.accessTtlSeconds));
  headers.append("Set-Cookie", refreshTokenCookie(tokens.refreshToken, tokens.refreshTtlSeconds));
}

export function appendExpiredAuthCookies(headers: Headers): void {
  headers.append("Set-Cookie", expiredAccessTokenCookie());
  headers.append("Set-Cookie", expiredRefreshTokenCookie());
}

export function extractAccessToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  return parseCookie(request.headers.get("Cookie"), accessCookieName);
}

export function extractRefreshToken(request: Request): string | null {
  return parseCookie(request.headers.get("Cookie"), refreshCookieName);
}

export function publicJwks(keyRingJson: string): { keys: JsonWebKey[] } {
  const ring = parseKeyRing(keyRingJson);
  const now = Date.now();
  return {
    keys: ring.keys
      .filter((key) => !key.retireAfter || Date.parse(key.retireAfter) > now)
      .map((key) => ({
        kty: key.privateJwk.kty,
        crv: key.privateJwk.crv,
        x: key.privateJwk.x,
        y: key.privateJwk.y,
        kid: key.kid,
        alg: "ES256",
        use: "sig",
      })),
  };
}

export async function issueAuthTokens(
  env: Env,
  auth: AuthContext,
  sessionId: string,
  currentRefreshSecret?: string,
): Promise<AuthTokens> {
  const accessTtlSeconds = positiveInteger(env.ACCESS_TOKEN_TTL_SECONDS, 300);
  const refreshTtlSeconds = positiveInteger(env.REFRESH_TOKEN_TTL_SECONDS, 2_592_000);
  const now = Math.floor(Date.now() / 1000);
  const claims: JwtClaims = {
    iss: env.JWT_ISSUER,
    aud: env.JWT_AUDIENCE,
    sub: auth.userId,
    sid: sessionId,
    jti: crypto.randomUUID(),
    iat: now,
    nbf: now - 5,
    exp: now + accessTtlSeconds,
    organisationId: auth.organisationId,
    role: auth.role,
    email: auth.email,
  };
  const refreshSecret = currentRefreshSecret ?? secureToken(48);
  return {
    accessToken: await signJwt(claims, env.JWT_KEYRING),
    accessTtlSeconds,
    refreshToken: `${sessionId}.${refreshSecret}`,
    refreshTtlSeconds,
    accessExpiresAt: new Date((now + accessTtlSeconds) * 1000).toISOString(),
    refreshExpiresAt: new Date((now + refreshTtlSeconds) * 1000).toISOString(),
  };
}

export async function verifyAccessJwt(token: string, env: Env): Promise<JwtClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const encodedHeader = parts[0]!;
    const encodedPayload = parts[1]!;
    const encodedSignature = parts[2]!;
    const header = JSON.parse(decoder.decode(base64UrlDecode(encodedHeader))) as Record<string, unknown>;
    if (header.alg !== "ES256" || header.typ !== "JWT" || typeof header.kid !== "string") return null;
    const ring = parseKeyRing(env.JWT_KEYRING);
    const keyRecord = ring.keys.find((key) => key.kid === header.kid);
    if (!keyRecord) return null;
    const nowMs = Date.now();
    if (Date.parse(keyRecord.notBefore) > nowMs) return null;
    if (keyRecord.retireAfter && Date.parse(keyRecord.retireAfter) <= nowMs) return null;
    const publicJwk: JsonWebKey = {
      kty: keyRecord.privateJwk.kty,
      crv: keyRecord.privateJwk.crv,
      x: keyRecord.privateJwk.x,
      y: keyRecord.privateJwk.y,
      ext: true,
    };
    const key = await crypto.subtle.importKey(
      "jwk",
      publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      base64UrlDecode(encodedSignature),
      encoder.encode(`${encodedHeader}.${encodedPayload}`),
    );
    if (!verified) return null;
    const claims = JSON.parse(decoder.decode(base64UrlDecode(encodedPayload))) as JwtClaims;
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.iss !== env.JWT_ISSUER ||
      claims.aud !== env.JWT_AUDIENCE ||
      typeof claims.sub !== "string" ||
      typeof claims.sid !== "string" ||
      typeof claims.jti !== "string" ||
      typeof claims.organisationId !== "string" ||
      typeof claims.email !== "string" ||
      !["platform_admin", "production_operator", "customer_reviewer", "customer_readonly"].includes(claims.role) ||
      !Number.isFinite(claims.exp) ||
      !Number.isFinite(claims.iat) ||
      !Number.isFinite(claims.nbf) ||
      claims.exp <= now ||
      claims.iat > now + 30 ||
      claims.nbf > now + 30
    ) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function authenticateRequest(request: Request, env: Env): Promise<AuthSessionRow | null> {
  const token = extractAccessToken(request);
  if (!token) return null;
  const claims = await verifyAccessJwt(token, env);
  if (!claims) return null;
  const row = await env.DB.prepare(`
    SELECT s.id AS sessionId, s.expires_at AS expiresAt, s.revoked_at AS revokedAt,
      s.auth_method AS authMethod, s.identity_provider_id AS identityProviderId,
      u.id AS userId, s.organisation_id AS organisationId, u.email,
      u.display_name AS displayName, m.role
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    JOIN memberships m ON m.user_id = s.user_id AND m.organisation_id = s.organisation_id
    WHERE s.id = ? AND s.user_id = ? AND s.organisation_id = ?
      AND s.revoked_at IS NULL AND m.revoked_at IS NULL
      AND m.status = 'active' AND s.expires_at > ?
  `).bind(
    claims.sid,
    claims.sub,
    claims.organisationId,
    new Date().toISOString(),
  ).first<AuthSessionRow>();
  if (!row || row.role !== claims.role || row.email.toLowerCase() !== claims.email.toLowerCase()) return null;
  return row;
}

export async function createAuthSession(
  env: Env,
  auth: AuthContext,
  request: Request,
  provenance: {
    authMethod: "email_otp" | "oidc";
    identityProviderId?: string | null;
  } = { authMethod: "email_otp" },
): Promise<AuthTokens> {
  const sessionId = crypto.randomUUID();
  const tokens = await issueAuthTokens(env, auth, sessionId);
  const refreshSecret = tokens.refreshToken.slice(tokens.refreshToken.indexOf(".") + 1);
  const refreshHash = await hashRefreshToken(refreshSecret, env.REFRESH_TOKEN_PEPPER);
  await env.DB.prepare(`
    INSERT INTO auth_sessions
      (id, user_id, organisation_id, refresh_token_hash, expires_at, user_agent,
        ip_address, auth_method, identity_provider_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    sessionId,
    auth.userId,
    auth.organisationId,
    refreshHash,
    tokens.refreshExpiresAt,
    request.headers.get("User-Agent")?.slice(0, 512) ?? null,
    request.headers.get("CF-Connecting-IP") ?? null,
    provenance.authMethod,
    provenance.identityProviderId ?? null,
  ).run();
  return tokens;
}

export async function rotateRefreshSession(
  env: Env,
  request: Request,
): Promise<{ auth: AuthContext; tokens: AuthTokens } | null> {
  const raw = extractRefreshToken(request);
  if (!raw) return null;
  const separator = raw.indexOf(".");
  if (separator < 1) return null;
  const sessionId = raw.slice(0, separator);
  const suppliedSecret = raw.slice(separator + 1);
  if (suppliedSecret.length < 40 || sessionId.length > 80) return null;
  const suppliedHash = await hashRefreshToken(suppliedSecret, env.REFRESH_TOKEN_PEPPER);
  const previouslyUsed = await env.DB.prepare(
    "SELECT session_id FROM auth_refresh_token_history WHERE token_hash = ?",
  ).bind(suppliedHash).first<{ session_id: string }>();
  if (previouslyUsed) {
    await revokeSession(env.DB, previouslyUsed.session_id, "refresh_reuse");
    return null;
  }
  const row = await env.DB.prepare(`
    SELECT s.id, s.user_id, s.organisation_id, s.refresh_token_hash,
      s.previous_refresh_token_hash, s.expires_at, s.revoked_at,
      u.email, u.display_name, m.role
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    JOIN memberships m ON m.user_id = s.user_id AND m.organisation_id = s.organisation_id
    WHERE s.id = ? AND m.revoked_at IS NULL AND m.status = 'active'
  `).bind(sessionId).first<{
    id: string;
    user_id: string;
    organisation_id: string;
    refresh_token_hash: string;
    previous_refresh_token_hash: string | null;
    expires_at: string;
    revoked_at: string | null;
    email: string;
    display_name: string;
    role: AuthContext["role"];
  }>();
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) return null;
  if (row.previous_refresh_token_hash && await timingSafeStringEqual(suppliedHash, row.previous_refresh_token_hash)) {
    await revokeSession(env.DB, sessionId, "refresh_reuse");
    return null;
  }
  if (!(await timingSafeStringEqual(suppliedHash, row.refresh_token_hash))) return null;

  const auth: AuthContext = {
    userId: row.user_id,
    organisationId: row.organisation_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
  const nextSecret = secureToken(48);
  const nextHash = await hashRefreshToken(nextSecret, env.REFRESH_TOKEN_PEPPER);
  const tokens = await issueAuthTokens(env, auth, sessionId, nextSecret);
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE auth_sessions
      SET previous_refresh_token_hash = refresh_token_hash,
        refresh_token_hash = ?, rotated_at = datetime('now'),
        last_seen_at = datetime('now'), expires_at = ?
      WHERE id = ? AND refresh_token_hash = ? AND revoked_at IS NULL
    `).bind(nextHash, tokens.refreshExpiresAt, sessionId, suppliedHash),
    env.DB.prepare(`
      INSERT OR IGNORE INTO auth_refresh_token_history (token_hash, session_id)
      VALUES (?, ?)
    `).bind(suppliedHash, sessionId),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1) {
    await revokeSession(env.DB, sessionId, "refresh_race");
    return null;
  }
  return { auth, tokens };
}

export async function revokeSession(database: D1Database, sessionId: string, reason: string): Promise<void> {
  await database.prepare(`
    UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, datetime('now')),
      revoke_reason = COALESCE(revoke_reason, ?)
    WHERE id = ?
  `).bind(reason, sessionId).run();
}

export async function otpHash(challengeId: string, email: string, code: string, pepper: string): Promise<string> {
  return sha256Hex(`${challengeId}:${email.toLowerCase()}:${code}:${pepper}`);
}

export function generateOtp(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0]! % 1_000_000).padStart(6, "0");
}

async function signJwt(claims: JwtClaims, keyRingJson: string): Promise<string> {
  const ring = parseKeyRing(keyRingJson);
  const keyRecord = ring.keys.find((key) => key.kid === ring.activeKid && key.status === "active");
  if (!keyRecord) throw new Error("JWT key ring has no active signing key");
  const now = Date.now();
  if (Date.parse(keyRecord.notBefore) > now || (keyRecord.retireAfter && Date.parse(keyRecord.retireAfter) <= now)) {
    throw new Error("JWT active signing key is outside its lifecycle");
  }
  const key = await crypto.subtle.importKey(
    "jwk",
    keyRecord.privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: "ES256", typ: "JWT", kid: keyRecord.kid })));
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const input = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(input),
  ));
  return `${input}.${base64UrlEncode(signature)}`;
}

function parseKeyRing(value: string): KeyRing {
  const parsed = JSON.parse(value) as Partial<KeyRing>;
  if (
    parsed.version !== 1 ||
    typeof parsed.activeKid !== "string" ||
    !Array.isArray(parsed.keys) ||
    parsed.keys.length < 1 ||
    !parsed.keys.every((key) =>
      typeof key.kid === "string" &&
      (key.status === "active" || key.status === "verify") &&
      key.privateJwk?.kty === "EC" &&
      key.privateJwk?.crv === "P-256" &&
      typeof key.privateJwk?.x === "string" &&
      typeof key.privateJwk?.y === "string" &&
      typeof key.privateJwk?.d === "string" &&
      typeof key.notBefore === "string"
    )
  ) throw new Error("Invalid JWT key ring");
  return parsed as KeyRing;
}

async function hashRefreshToken(token: string, pepper: string): Promise<string> {
  return sha256Hex(`${token}:${pepper}`);
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
