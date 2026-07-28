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

let refreshPromise: Promise<boolean> | null = null;

export async function api<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  return apiRequest<T>(path, init, true);
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
      const response = await timedFetch(path, init, method);
      if (
        response.status === 401 &&
        allowRefresh &&
        !path.startsWith("/api/auth/")
      ) {
        const refreshed = await refreshSession();
        if (refreshed) return apiRequest<T>(path, { ...init, retries: 0 }, false);
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
      const response = await timedFetch(path, init, method);
      if (response.status === 401 && allowRefresh && !path.startsWith("/api/auth/")) {
        const refreshed = await refreshSession();
        if (refreshed) return apiFileRequest(path, { ...init, retries: 0 }, false);
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

async function refreshSession(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const response = await timedFetch(
        "/api/auth/refresh",
        { method: "POST", timeoutMs: 15_000 },
        "POST",
      );
      return response.ok;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
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
