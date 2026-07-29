const siteverifyEndpoint =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const maximumTokenLength = 2_048;
const verificationTimeoutMs = 8_000;
const maximumAttempts = 2;

type SiteverifyResponse = {
  success?: boolean;
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
  metadata?: {
    result_with_testing_key?: boolean;
  };
  "error-codes"?: unknown;
};

export type TurnstileVerification = {
  hostname: string;
  action: string;
  challengeTimestamp: string | null;
  attempts: number;
};

export class TurnstileVerificationError extends Error {
  constructor(
    message: string,
    readonly code: "rejected" | "unavailable" | "misconfigured",
    readonly retryable: boolean,
    readonly providerCodes: string[] = [],
  ) {
    super(message);
    this.name = "TurnstileVerificationError";
  }
}

export async function verifyTurnstileToken(options: {
  secretKey: string;
  token: string;
  remoteIp: string | null;
  expectedHostname: string;
  expectedAction: string;
  testMode?: boolean;
  idempotencyKey?: string;
  fetcher?: typeof fetch;
}): Promise<TurnstileVerification> {
  const secretKey = options.secretKey.trim();
  const token = options.token.trim();
  if (!secretKey) {
    throw new TurnstileVerificationError(
      "Turnstile secret is not configured",
      "misconfigured",
      false,
    );
  }
  if (!token || token.length > maximumTokenLength) {
    throw new TurnstileVerificationError(
      "Turnstile token is missing or malformed",
      "rejected",
      false,
    );
  }
  const expectedHostname = normalizeHostname(options.expectedHostname);
  if (!expectedHostname || !validTurnstileAction(options.expectedAction)) {
    throw new TurnstileVerificationError(
      "Turnstile verification context is invalid",
      "misconfigured",
      false,
    );
  }

  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const fetcher = options.fetcher ?? fetch;
  let lastError: TurnstileVerificationError | null = null;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const controller = new AbortController();
    try {
      const response = await fetchWithDeadline(
        fetcher,
        siteverifyEndpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            secret: secretKey,
            response: token,
            remoteip: options.remoteIp || undefined,
            idempotency_key: idempotencyKey,
          }),
          signal: controller.signal,
        },
        controller,
      );
      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        lastError = new TurnstileVerificationError(
          "Turnstile verification service returned an error",
          "unavailable",
          retryable,
        );
        if (retryable && attempt < maximumAttempts) continue;
        throw lastError;
      }

      const payload = await boundedJson(response);
      const providerCodes = providerErrorCodes(payload["error-codes"]);
      if (!payload.success) {
        const misconfigured = providerCodes.some((code) =>
          code === "invalid-input-secret" || code === "missing-input-secret"
        );
        const retryable = providerCodes.includes("internal-error");
        lastError = new TurnstileVerificationError(
          misconfigured
            ? "Turnstile rejected the server configuration"
            : retryable
              ? "Turnstile verification is temporarily unavailable"
              : "Turnstile challenge was rejected",
          misconfigured ? "misconfigured" : retryable ? "unavailable" : "rejected",
          retryable,
          providerCodes,
        );
        if (retryable && attempt < maximumAttempts) continue;
        throw lastError;
      }

      const hostname = normalizeHostname(payload.hostname ?? "");
      const action = payload.action ?? "";
      const validTestResponse =
        options.testMode === true &&
        payload.metadata?.result_with_testing_key === true;
      if (
        !validTestResponse &&
        (hostname !== expectedHostname || action !== options.expectedAction)
      ) {
        throw new TurnstileVerificationError(
          "Turnstile challenge context did not match this application",
          "rejected",
          false,
          ["context-mismatch"],
        );
      }
      return {
        hostname,
        action,
        challengeTimestamp:
          typeof payload.challenge_ts === "string"
            ? payload.challenge_ts.slice(0, 64)
            : null,
        attempts: attempt,
      };
    } catch (error) {
      if (error instanceof TurnstileVerificationError) {
        lastError = error;
        if (error.retryable && attempt < maximumAttempts) continue;
        throw error;
      }
      lastError = new TurnstileVerificationError(
        "Turnstile verification did not complete",
        "unavailable",
        true,
      );
      if (attempt >= maximumAttempts) throw lastError;
    }
  }

  throw lastError ??
    new TurnstileVerificationError(
      "Turnstile verification did not complete",
      "unavailable",
      true,
    );
}

async function fetchWithDeadline(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  controller: AbortController,
): Promise<Response> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort("Turnstile verification timed out");
      reject(new TurnstileVerificationError(
        "Turnstile verification timed out",
        "unavailable",
        true,
      ));
    }, verificationTimeoutMs);
  });

  try {
    return await Promise.race([fetcher(input, init), deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function boundedJson(response: Response): Promise<SiteverifyResponse> {
  const text = await response.text();
  if (!text || text.length > 16_384) {
    throw new TurnstileVerificationError(
      "Turnstile returned an invalid response",
      "unavailable",
      true,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TurnstileVerificationError(
      "Turnstile returned invalid JSON",
      "unavailable",
      true,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TurnstileVerificationError(
      "Turnstile returned an invalid payload",
      "unavailable",
      true,
    );
  }
  return parsed as SiteverifyResponse;
}

function providerErrorCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((code): code is string => typeof code === "string")
    .map((code) => code.slice(0, 80))
    .slice(0, 12);
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function validTurnstileAction(value: string): boolean {
  return /^[a-z0-9_-]{1,32}$/i.test(value);
}
