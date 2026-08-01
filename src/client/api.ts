export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiRequestInit = RequestInit & {
  timeoutMs?: number;
  retries?: number;
};

export const AUTH_SESSION_EXPIRED_EVENT = "spatial-auth-session-expired";

const AUTH_SESSION_STORAGE_KEY = "spatial.auth.session-state.v1";
const AUTH_REFRESH_LOCK = "spatial.auth.refresh.v1";
const UNAUTHENTICATED_API_PATHS = new Set([
  "/api/auth/config",
  "/api/auth/refresh",
  "/api/auth/session",
]);

type AuthSessionMarker = {
  generation: string;
  status: "authenticated" | "signed-out";
  updatedAt: number;
};

type RefreshOutcome = "refreshed" | "expired" | "unavailable";

let refreshPromise: Promise<RefreshOutcome> | null = null;
let authExpiryNotified = false;
let memoryAuthMarker: AuthSessionMarker | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== AUTH_SESSION_STORAGE_KEY) return;
    const marker = parseAuthMarker(event.newValue);
    memoryAuthMarker = marker;
    if (marker?.status === "authenticated") {
      authExpiryNotified = false;
      return;
    }
    if (marker?.status === "signed-out" && !authExpiryNotified) {
      authExpiryNotified = true;
      dispatchAuthExpired();
    }
  });
}

export async function api<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  return apiRequest<T>(path, init, true);
}

export async function restoreAuthenticationSession(): Promise<boolean> {
  const outcome = await refreshSession(readAuthMarker()?.generation ?? null);
  if (outcome === "unavailable") throw refreshUnavailableError();
  return outcome === "refreshed";
}

export function markAuthenticationEstablished(): void {
  authExpiryNotified = false;
  writeAuthMarker("authenticated");
}

export function markAuthenticationSignedOut(): void {
  authExpiryNotified = true;
  writeAuthMarker("signed-out");
}

export async function apiFile(
  path: string,
  init: ApiRequestInit = {},
): Promise<{ blob: Blob; fileName: string | null }> {
  return apiFileRequest(path, init, true);
}

async function apiRequest<T>(
  path: string,
  init: ApiRequestInit,
  allowRefresh: boolean,
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const retries = init.retries ?? (isSafeMethod(method) ? 2 : 0);
  let attempt = 0;

  while (true) {
    try {
      const requestAuthGeneration = readAuthMarker()?.generation ?? null;
      const response = await timedFetch(path, init, method);
      if (response.status === 401 && isProtectedApiPath(path)) {
        if (allowRefresh) {
          const outcome = await refreshSession(requestAuthGeneration);
          if (outcome === "refreshed") {
            return apiRequest<T>(path, { ...init, retries: 0 }, false);
          }
          if (outcome === "unavailable") throw refreshUnavailableError();
        }
        notifyAuthExpired();
      }
      if (shouldRetryStatus(response.status) && attempt < retries) {
        await waitForRetry(response, attempt, init.signal);
        attempt += 1;
        continue;
      }
      return await readResponse<T>(response);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.retryable && attempt < retries) {
          await retryDelay(attempt, init.signal);
          attempt += 1;
          continue;
        }
        throw error;
      }
      const aborted = init.signal?.aborted;
      if (!aborted && attempt < retries) {
        await retryDelay(attempt, init.signal);
        attempt += 1;
        continue;
      }
      if (aborted) throw new ApiError("Request cancelled", 0, undefined, undefined, undefined, false);
      throw new ApiError(
        "The network request did not complete. Check your connection and retry.",
        0,
        error,
        undefined,
        undefined,
        true,
      );
    }
  }
}

async function apiFileRequest(
  path: string,
  init: ApiRequestInit,
  allowRefresh: boolean,
): Promise<{ blob: Blob; fileName: string | null }> {
  const method = (init.method ?? "GET").toUpperCase();
  const retries = init.retries ?? (isSafeMethod(method) ? 2 : 0);
  let attempt = 0;
  while (true) {
    try {
      const requestAuthGeneration = readAuthMarker()?.generation ?? null;
      const response = await timedFetch(path, init, method);
      if (response.status === 401 && isProtectedApiPath(path)) {
        if (allowRefresh) {
          const outcome = await refreshSession(requestAuthGeneration);
          if (outcome === "refreshed") {
            return apiFileRequest(path, { ...init, retries: 0 }, false);
          }
          if (outcome === "unavailable") throw refreshUnavailableError();
        }
        notifyAuthExpired();
      }
      if (shouldRetryStatus(response.status) && attempt < retries) {
        await waitForRetry(response, attempt, init.signal);
        attempt += 1;
        continue;
      }
      if (!response.ok) return await readResponse<never>(response);
      return {
        blob: await response.blob(),
        fileName: attachmentFileName(response.headers.get("Content-Disposition")),
      };
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.retryable && attempt < retries) {
          await retryDelay(attempt, init.signal);
          attempt += 1;
          continue;
        }
        throw error;
      }
      const aborted = init.signal?.aborted;
      if (!aborted && attempt < retries) {
        await retryDelay(attempt, init.signal);
        attempt += 1;
        continue;
      }
      if (aborted) throw new ApiError("Request cancelled", 0, undefined, undefined, undefined, false);
      throw new ApiError(
        "The download did not complete. Check your connection and retry.",
        0,
        error,
        undefined,
        undefined,
        true,
      );
    }
  }
}

async function timedFetch(
  path: string,
  init: ApiRequestInit,
  method: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof Blob) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? (method === "GET" ? 15_000 : 30_000);
  const timeout = window.setTimeout(() => controller.abort("timeout"), timeoutMs);
  const forwardAbort = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    return await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) {
      throw new ApiError(
        `The request timed out after ${Math.ceil(timeoutMs / 1_000)} seconds. Retry when the connection is stable.`,
        0,
        error,
        undefined,
        undefined,
        true,
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", forwardAbort);
  }
}

async function refreshSession(
  requestAuthGeneration: string | null,
): Promise<RefreshOutcome> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = coordinateRefresh(requestAuthGeneration)
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

async function coordinateRefresh(
  requestAuthGeneration: string | null,
): Promise<RefreshOutcome> {
  const refresh = async (): Promise<RefreshOutcome> => {
    const currentMarker = readAuthMarker();
    if (
      currentMarker &&
      currentMarker.generation !== requestAuthGeneration
    ) {
      return currentMarker.status === "authenticated" ? "refreshed" : "expired";
    }
    try {
      const response = await timedFetch(
        "/api/auth/refresh",
        { method: "POST", timeoutMs: 15_000 },
        "POST",
      );
      if (response.status === 200) {
        markAuthenticationEstablished();
        return "refreshed";
      }
      if (response.status === 409) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        const retry = await timedFetch(
          "/api/auth/refresh",
          { method: "POST", timeoutMs: 15_000 },
          "POST",
        );
        if (retry.status === 200) {
          markAuthenticationEstablished();
          return "refreshed";
        }
        if (retry.status === 204 || retry.status === 401 || retry.status === 403) {
          return "expired";
        }
        return "unavailable";
      }
      if (response.status === 204 || response.status === 401 || response.status === 403) {
        return "expired";
      }
      return "unavailable";
    } catch {
      return "unavailable";
    }
  };

  if (navigator.locks?.request) {
    return navigator.locks.request(AUTH_REFRESH_LOCK, { mode: "exclusive" }, refresh);
  }
  return refresh();
}

function isProtectedApiPath(path: string): boolean {
  if (!path.startsWith("/api/")) return false;
  if (UNAUTHENTICATED_API_PATHS.has(path)) return false;
  return !path.startsWith("/api/auth/otp/") &&
    !path.startsWith("/api/auth/oidc/");
}

function refreshUnavailableError(): ApiError {
  return new ApiError(
    "Your session could not be refreshed. Check your connection and retry.",
    503,
    undefined,
    undefined,
    undefined,
    true,
  );
}

function notifyAuthExpired(): void {
  if (authExpiryNotified) return;
  authExpiryNotified = true;
  writeAuthMarker("signed-out");
  dispatchAuthExpired();
  void clearBrowserAuthSession();
}

function dispatchAuthExpired(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT));
}

async function clearBrowserAuthSession(): Promise<void> {
  try {
    await fetch("/api/auth/session", {
      method: "DELETE",
      credentials: "same-origin",
    });
  } catch {
    // Local state is already safe; a later sign-in overwrites expired cookies.
  }
}

function readAuthMarker(): AuthSessionMarker | null {
  if (typeof window === "undefined") return memoryAuthMarker;
  try {
    const marker = parseAuthMarker(window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY));
    memoryAuthMarker = marker;
    return marker;
  } catch {
    return memoryAuthMarker;
  }
}

function writeAuthMarker(status: AuthSessionMarker["status"]): void {
  const marker: AuthSessionMarker = {
    generation: crypto.randomUUID(),
    status,
    updatedAt: Date.now(),
  };
  memoryAuthMarker = marker;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(marker));
  } catch {
    // The in-memory marker still provides same-tab single-flight behaviour.
  }
}

function parseAuthMarker(value: string | null): AuthSessionMarker | null {
  if (!value) return null;
  try {
    const marker = JSON.parse(value) as Partial<AuthSessionMarker>;
    if (
      typeof marker.generation !== "string" ||
      (marker.status !== "authenticated" && marker.status !== "signed-out") ||
      typeof marker.updatedAt !== "number"
    ) return null;
    return marker as AuthSessionMarker;
  } catch {
    return null;
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("Content-Type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");
  if (!response.ok) {
    const message = readString(payload, "error") ?? `Request failed with status ${response.status}`;
    const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));
    throw new ApiError(
      message,
      response.status,
      payload,
      response.headers.get("X-Request-Id") ?? readString(payload, "requestId") ?? undefined,
      retryAfterSeconds,
      shouldRetryStatus(response.status),
    );
  }
  return payload as T;
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 ||
    status === 502 || status === 503 || status === 504;
}

async function waitForRetry(
  response: Response,
  attempt: number,
  signal?: AbortSignal | null,
): Promise<void> {
  const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
  await delay(
    retryAfter === undefined ? backoff(attempt) : Math.min(30_000, retryAfter * 1_000),
    signal,
  );
}

async function retryDelay(attempt: number, signal?: AbortSignal | null): Promise<void> {
  await delay(backoff(attempt), signal);
}

function backoff(attempt: number): number {
  return Math.min(4_000, 350 * 2 ** attempt) + Math.floor(Math.random() * 180);
}

function delay(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1_000));
}

function attachmentFileName(value: string | null): string | null {
  if (!value) return null;
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      return utf8;
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

export function readString(value: unknown, property: string): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = Reflect.get(value, property);
  return typeof candidate === "string" ? candidate : null;
}
