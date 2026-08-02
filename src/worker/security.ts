import { timingSafeEqual } from "node:crypto";

const encoder = new TextEncoder();

export function secureToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function sha256Hex(value: string | ArrayBuffer | Uint8Array): Promise<string> {
  const source = typeof value === "string"
    ? encoder.encode(value)
    : value instanceof ArrayBuffer
      ? value
      : Uint8Array.from(value);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function timingSafeStringEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return timingSafeEqual(new Uint8Array(leftHash), new Uint8Array(rightHash));
}

export function parseCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const segment of header.split(";")) {
    const [key, ...value] = segment.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return accessTokenCookie(token, maxAgeSeconds);
}

export function expiredSessionCookie(): string {
  return expiredAccessTokenCookie();
}

export function accessTokenCookie(token: string, maxAgeSeconds: number): string {
  return `spatial_access=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function refreshTokenCookie(token: string, maxAgeSeconds: number): string {
  return `spatial_refresh=${encodeURIComponent(token)}; Path=/api/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function expiredAccessTokenCookie(): string {
  return "spatial_access=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

export function expiredRefreshTokenCookie(): string {
  return "spatial_refresh=; Path=/api/auth; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

type SceneTokenPayload = {
  releaseId: string;
  expiresAt: number;
  scope?: "telemetry";
  sessionId?: string;
  channelActivationGeneration?: number;
};

export async function signSceneToken(payload: SceneTokenPayload, secret: string): Promise<string> {
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await hmac(encodedPayload, secret);
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

export async function verifySceneToken(token: string, secret: string): Promise<SceneTokenPayload | null> {
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) return null;
  const expectedSignature = await hmac(encodedPayload, secret);
  const suppliedSignature = base64UrlDecode(encodedSignature);
  if (expectedSignature.byteLength !== suppliedSignature.byteLength) return null;
  if (!timingSafeEqual(expectedSignature, suppliedSignature)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as SceneTokenPayload;
    if (typeof payload.releaseId !== "string") return null;
    if (payload.scope !== undefined && payload.scope !== "telemetry") return null;
    if (payload.sessionId !== undefined && typeof payload.sessionId !== "string") return null;
    if (payload.scope === "telemetry" && (
      !payload.sessionId || !Number.isSafeInteger(payload.channelActivationGeneration) ||
      payload.channelActivationGeneration! < 1
    )) return null;
    if (typeof payload.expiresAt !== "number") return null;
    if (payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function safeFileName(value: string): string {
  const cleaned = value.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 180) || "asset.bin";
}

export function slugify(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "project";
}

export function parseRangeHeader(value: string | null | undefined, objectSize: number): R2Range | undefined {
  if (!value?.startsWith("bytes=")) return undefined;
  const expression = value.slice(6);
  if (expression.includes(",")) return undefined;
  const [startText, endText] = expression.split("-");
  if (startText) {
    const offset = Number(startText);
    const end = endText ? Number(endText) : objectSize - 1;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset < 0 || end < offset || offset >= objectSize) return undefined;
    return { offset, length: Math.min(objectSize - offset, end - offset + 1) };
  }
  const suffix = Number(endText);
  if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined;
  return { suffix: Math.min(suffix, objectSize) };
}

export function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
