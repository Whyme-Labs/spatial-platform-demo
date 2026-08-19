import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/client/api";

function jsonResponse(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// A request that never completes on its own; it only rejects once the
// per-attempt timeout (or the caller) aborts it, like a stalled connection.
function stalledFetch(): typeof fetch {
  return (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      }, { once: true });
    });
}

async function expectApiError(request: Promise<unknown>): Promise<ApiError> {
  try {
    await request;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("expected the request to reject");
}

describe("api client retries", () => {
  beforeEach(() => {
    // Full jitter draws the delay from [0, cap); pinning the draw to zero keeps
    // retry-heavy cases instant without faking timers.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries a GET after a network error and returns the eventual success", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api("/api/projects")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a GET on 5xx and honours Retry-After on 429", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(429, {}, { "Retry-After": "1" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const startedAt = Date.now();
    await expect(api("/api/projects")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(950);
  });

  it("does not retry a GET that fails with a non-retryable 4xx", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(jsonResponse(400, { error: "bad request" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await expectApiError(api("/api/projects"));
    expect(error.status).toBe(400);
    expect(error.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a mutation whose body carries a clientOperationId", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(200, { saved: true }));
    vi.stubGlobal("fetch", fetchMock);

    const request = api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ clientOperationId: "op-1", name: "Atrium" }),
    });
    await expect(request).resolves.toEqual({ saved: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a mutation without a clientOperationId single-attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503));
    vi.stubGlobal("fetch", fetchMock);

    const request = api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Atrium" }),
    });
    const error = await expectApiError(request);
    expect(error.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels the whole retry loop when the caller aborts during backoff", async () => {
    // A non-zero jitter draw keeps the loop inside the backoff sleep long
    // enough for the abort to land there instead of between attempts.
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const request = api("/api/projects", { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);

    const error = await expectApiError(request);
    expect(error.message).toBe("Request cancelled");
    expect(error.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels an in-flight attempt when the caller aborts", async () => {
    const fetchMock = vi.fn().mockImplementation(stalledFetch());
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const request = api("/api/projects", {
      signal: controller.signal,
      timeoutMs: 30_000,
    });
    setTimeout(() => controller.abort(), 50);

    const error = await expectApiError(request);
    expect(error.message).toBe("Request cancelled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the timeout ApiError once the wall-clock budget is exhausted", async () => {
    const fetchMock = vi.fn().mockImplementation(stalledFetch());
    vi.stubGlobal("fetch", fetchMock);

    const request = api("/api/projects", {
      timeoutMs: 25,
      retryBudgetMs: 120,
      retries: 50,
    });
    const error = await expectApiError(request);
    expect(error.message).toMatch(/timed out after/);
    expect(error.retryable).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(10);
  });
});
