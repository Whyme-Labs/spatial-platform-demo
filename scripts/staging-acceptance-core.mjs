const maximumJsonBytes = 256 * 1024;
const maximumHtmlBytes = 2 * 1024 * 1024;

export class StagingAcceptanceError extends Error {
  constructor(message, evidence = {}) {
    super(message);
    this.name = "StagingAcceptanceError";
    this.evidence = evidence;
  }
}

export async function runStagingHttpAcceptance({
  appOrigin,
  processorOrigin,
  expectedEnvironment = "staging",
  expectedTurnstileSiteKey,
  fetcher = fetch,
  timeoutMs = 15_000,
}) {
  const app = normaliseHttpsOrigin(appOrigin, "Application");
  const processor = normaliseHttpsOrigin(processorOrigin, "Processor");
  const steps = [];

  const health = await timedStep(steps, "application-health", async () => {
    const response = await fetchBounded(fetcher, `${app}/api/health`, {
      timeoutMs,
      expectedStatus: 200,
      maximumBytes: maximumJsonBytes,
    });
    assertWorkerSecurityHeaders(response);
    const payload = parseJson(response.body, "Application health");
    if (
      payload.status !== "ok" ||
      payload.environment !== expectedEnvironment ||
      typeof payload.timestamp !== "string" ||
      !Number.isFinite(Date.parse(payload.timestamp))
    ) {
      throw new StagingAcceptanceError("Application health payload is not ready", {
        status: payload.status,
        environment: payload.environment,
      });
    }
    const requestId = response.headers.get("x-request-id");
    if (!requestId || payload.requestId !== requestId) {
      throw new StagingAcceptanceError("Application request ID was not propagated", {
        headerRequestId: requestId,
        bodyRequestId: payload.requestId,
      });
    }
    return {
      environment: payload.environment,
      requestId,
      timestamp: payload.timestamp,
    };
  });

  await timedStep(steps, "auth-public-configuration", async () => {
    const response = await fetchBounded(fetcher, `${app}/api/auth/config`, {
      timeoutMs,
      expectedStatus: 200,
      maximumBytes: maximumJsonBytes,
    });
    assertWorkerSecurityHeaders(response);
    assertNoStore(response, "Auth configuration");
    const payload = parseJson(response.body, "Auth configuration");
    const serialized = JSON.stringify(payload).toLowerCase();
    if (serialized.includes("secret") || serialized.includes("pepper") || serialized.includes("private")) {
      throw new StagingAcceptanceError("Auth configuration exposed private material");
    }
    if (
      payload.turnstileAction !== "otp_request" ||
      typeof payload.turnstileSiteKey !== "string" ||
      payload.turnstileSiteKey.length < 20
    ) {
      throw new StagingAcceptanceError("Auth configuration is incomplete");
    }
    if (
      expectedTurnstileSiteKey &&
      payload.turnstileSiteKey !== expectedTurnstileSiteKey
    ) {
      throw new StagingAcceptanceError("Staging Turnstile site key differs from the expected key");
    }
    return {
      turnstileAction: payload.turnstileAction,
      siteKeyKind: payload.turnstileSiteKey.startsWith("1x000000")
        ? "cloudflare-testing"
        : "managed",
    };
  });

  await timedStep(steps, "anonymous-session", async () => {
    // assurance-route: GET /api/auth/session
    const response = await fetchBounded(fetcher, `${app}/api/auth/session`, {
      timeoutMs,
      expectedStatus: 200,
      maximumBytes: maximumJsonBytes,
    });
    assertWorkerSecurityHeaders(response);
    assertNoStore(response, "Anonymous session");
    const payload = parseJson(response.body, "Anonymous session");
    if (payload.authenticated !== false) {
      throw new StagingAcceptanceError("Anonymous request unexpectedly obtained a session");
    }
    return { authenticated: false };
  });

  await timedStep(steps, "protected-route-denial", async () => {
    const response = await fetchBounded(fetcher, `${app}/api/projects`, {
      timeoutMs,
      expectedStatus: 401,
      maximumBytes: maximumJsonBytes,
    });
    assertWorkerSecurityHeaders(response);
    assertNoStore(response, "Protected route denial");
    const payload = parseJson(response.body, "Protected route denial");
    if (typeof payload.error !== "string" || payload.error.length === 0) {
      throw new StagingAcceptanceError("Protected route did not return a bounded denial");
    }
    return { status: response.status };
  });

  await timedStep(steps, "jwks", async () => {
    const response = await fetchBounded(fetcher, `${app}/.well-known/jwks.json`, {
      timeoutMs,
      expectedStatus: 200,
      maximumBytes: maximumJsonBytes,
    });
    assertWorkerSecurityHeaders(response);
    const payload = parseJson(response.body, "JWKS");
    if (!Array.isArray(payload.keys) || payload.keys.length === 0) {
      throw new StagingAcceptanceError("JWKS contains no verification keys");
    }
    const kids = new Set();
    for (const key of payload.keys) {
      if (
        !key ||
        key.kty !== "EC" ||
        key.crv !== "P-256" ||
        key.alg !== "ES256" ||
        key.use !== "sig" ||
        typeof key.kid !== "string" ||
        !key.kid ||
        typeof key.x !== "string" ||
        typeof key.y !== "string" ||
        "d" in key
      ) {
        throw new StagingAcceptanceError("JWKS contains an invalid or private signing key");
      }
      if (kids.has(key.kid)) {
        throw new StagingAcceptanceError("JWKS contains a duplicate key identifier");
      }
      kids.add(key.kid);
    }
    return { keyCount: payload.keys.length, kids: [...kids] };
  });

  await timedStep(steps, "openid-discovery", async () => {
    const response = await fetchBounded(
      fetcher,
      `${app}/.well-known/openid-configuration`,
      {
        timeoutMs,
        expectedStatus: 200,
        maximumBytes: maximumJsonBytes,
      },
    );
    assertWorkerSecurityHeaders(response);
    const payload = parseJson(response.body, "OpenID configuration");
    if (
      payload.issuer !== app ||
      payload.jwks_uri !== `${app}/.well-known/jwks.json` ||
      !Array.isArray(payload.id_token_signing_alg_values_supported) ||
      !payload.id_token_signing_alg_values_supported.includes("ES256")
    ) {
      throw new StagingAcceptanceError("OpenID discovery does not match the staging origin");
    }
    return { issuer: payload.issuer, algorithm: "ES256" };
  });

  for (const [name, path, marker] of [
    ["landing-entry", "/", "Spatial"],
    ["studio-entry", "/studio.html", "Spatial Studio"],
    ["renderer-entry", "/renderer/index.html", "Spark"],
  ]) {
    await timedStep(steps, name, async () => {
      const response = await fetchBounded(fetcher, `${app}${path}`, {
        timeoutMs,
        expectedStatus: 200,
        maximumBytes: maximumHtmlBytes,
      });
      assertWorkerSecurityHeaders(response);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") || !response.body.includes(marker)) {
        throw new StagingAcceptanceError(`${name} did not return the expected application entry`);
      }
      return {
        contentType: contentType.split(";")[0],
        bytes: new TextEncoder().encode(response.body).byteLength,
      };
    });
  }

  const processorHealth = await timedStep(steps, "processor-health", async () => {
    const response = await fetchBounded(fetcher, processor, {
      timeoutMs,
      expectedStatus: 200,
      maximumBytes: maximumJsonBytes,
    });
    const payload = parseJson(response.body, "Processor health");
    if (
      payload.service !== "spatial-processor-cloud" ||
      payload.status !== "ok" ||
      !validProcessorIdentity(payload.identity) ||
      typeof payload.renderer !== "string" ||
      !payload.renderer.startsWith("Spark ") ||
      payload.execution !== "cloudflare-container"
    ) {
      throw new StagingAcceptanceError("Processor health payload is incomplete", payload);
    }
    return {
      identity: payload.identity,
      renderer: payload.renderer,
      execution: payload.execution,
    };
  });

  return {
    schemaVersion: 1,
    environment: expectedEnvironment,
    appOrigin: app,
    processorOrigin: processor,
    checkedAt: new Date().toISOString(),
    application: health,
    processor: processorHealth,
    steps,
  };
}

function validProcessorIdentity(identity) {
  return identity && typeof identity === "object" &&
    /^[a-f0-9]{40}$/.test(identity.agentBuildSha) &&
    /^sha256:[a-f0-9]{64}$/.test(identity.imageDigest) &&
    identity.protocolVersion === "spatial-processor-lease/1" &&
    Array.isArray(identity.capabilities) && identity.capabilities.length > 0 &&
    identity.capabilities.every((capability) =>
      capability && typeof capability.jobType === "string" &&
      typeof capability.contractVersion === "string"
    );
}

export function assertWorkerSecurityHeaders(response) {
  const required = {
    "content-security-policy": ["default-src 'self'", "object-src 'none'", "frame-ancestors 'self'"],
    "x-content-type-options": ["nosniff"],
    "x-frame-options": ["SAMEORIGIN"],
    "referrer-policy": ["strict-origin-when-cross-origin"],
    "permissions-policy": ["camera=()", "microphone=()"],
  };
  for (const [header, fragments] of Object.entries(required)) {
    const value = response.headers.get(header);
    if (!value || fragments.some((fragment) => !value.includes(fragment))) {
      throw new StagingAcceptanceError(`Response is missing the required ${header} policy`, {
        header,
        value,
      });
    }
  }
  const requestId = response.headers.get("x-request-id");
  if (!requestId || requestId.length > 128) {
    throw new StagingAcceptanceError("Response is missing a bounded request ID");
  }
}

export function validateRemoteD1Probe(payload) {
  if (
    !Array.isArray(payload) ||
    payload.length !== 1 ||
    payload[0]?.success !== true ||
    payload[0]?.results?.[0]?.ready !== 1
  ) {
    throw new StagingAcceptanceError("Remote D1 probe did not return ready=1");
  }
  const migrationCount = payload[0].results[0].migration_count;
  if (!Number.isSafeInteger(migrationCount) || migrationCount < 1) {
    throw new StagingAcceptanceError("Remote D1 probe found no applied migrations");
  }
  return { migrationCount };
}

export function validateDeploymentStatus(payload, expectedWorkerName) {
  if (
    !payload ||
    typeof payload.id !== "string" ||
    !Array.isArray(payload.versions) ||
    payload.versions.length !== 1 ||
    payload.versions[0]?.percentage !== 100 ||
    typeof payload.versions[0]?.version_id !== "string"
  ) {
    throw new StagingAcceptanceError(`${expectedWorkerName} has no full staging deployment`);
  }
  return {
    worker: expectedWorkerName,
    deploymentId: payload.id,
    versionId: payload.versions[0].version_id,
    createdOn: payload.created_on ?? null,
  };
}

function normaliseHttpsOrigin(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new StagingAcceptanceError(`${label} origin is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new StagingAcceptanceError(`${label} origin must be a clean HTTPS origin`);
  }
  return parsed.origin;
}

async function timedStep(steps, name, operation) {
  const started = performance.now();
  try {
    const evidence = await operation();
    steps.push({
      name,
      status: "passed",
      durationMs: Math.round(performance.now() - started),
      evidence,
    });
    return evidence;
  } catch (error) {
    steps.push({
      name,
      status: "failed",
      durationMs: Math.round(performance.now() - started),
      evidence: error instanceof StagingAcceptanceError ? error.evidence : {},
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function fetchBounded(fetcher, url, {
  timeoutMs,
  expectedStatus,
  maximumBytes,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("staging acceptance timeout"), timeoutMs);
  try {
    const response = await fetcher(url, {
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/json,text/html;q=0.9",
        "User-Agent": "spatial-staging-acceptance/1",
      },
    });
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      throw new StagingAcceptanceError(`Response from ${url} exceeds its acceptance bound`);
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > maximumBytes) {
      throw new StagingAcceptanceError(`Response from ${url} exceeds its acceptance bound`);
    }
    if (response.status !== expectedStatus) {
      throw new StagingAcceptanceError(`Expected ${expectedStatus} from ${url}, received ${response.status}`, {
        status: response.status,
        body: body.slice(0, 500),
      });
    }
    return { status: response.status, headers: response.headers, body };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(body, label) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new StagingAcceptanceError(`${label} did not return JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StagingAcceptanceError(`${label} returned an invalid JSON object`);
  }
  return parsed;
}

function assertNoStore(response, label) {
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (!cacheControl.toLowerCase().includes("no-store")) {
    throw new StagingAcceptanceError(`${label} is missing Cache-Control: no-store`);
  }
}
