export type CloudflareSaasConfig = {
  zoneId: string;
  apiToken: string;
  cnameTarget: string;
};

export type CloudflareCustomHostname = {
  id: string;
  hostname: string;
  status: string;
  sslStatus: string | null;
  ownershipVerification: {
    name: string;
    type: string;
    value: string;
  } | null;
  sslValidationRecords: Array<{
    status: string | null;
    txtName: string | null;
    txtValue: string | null;
  }>;
  verificationErrors: string[];
};

type CloudflareApiEnvelope = {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: unknown;
};

export class CloudflareSaasError extends Error {
  readonly status: number;
  readonly providerCode: number | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    status: number,
    providerCode: number | null,
    retryable: boolean,
  ) {
    super(message);
    this.name = "CloudflareSaasError";
    this.status = status;
    this.providerCode = providerCode;
    this.retryable = retryable;
  }
}

export async function createCloudflareCustomHostname(
  config: CloudflareSaasConfig,
  hostname: string,
  metadata: {
    organisationId: string;
    projectId: string;
    domainId: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<CloudflareCustomHostname> {
  return providerRequest(
    config,
    "",
    {
      method: "POST",
      body: JSON.stringify({
        hostname,
        ssl: {
          method: "txt",
          type: "dv",
          settings: {
            min_tls_version: "1.2",
          },
        },
        custom_metadata: {
          organisation_id: metadata.organisationId,
          project_id: metadata.projectId,
          domain_id: metadata.domainId,
        },
      }),
    },
    fetcher,
  );
}

export async function getCloudflareCustomHostname(
  config: CloudflareSaasConfig,
  providerHostnameId: string,
  fetcher: typeof fetch = fetch,
): Promise<CloudflareCustomHostname> {
  return providerRequest(config, `/${encodeURIComponent(providerHostnameId)}`, {}, fetcher);
}

export async function findCloudflareCustomHostname(
  config: CloudflareSaasConfig,
  hostname: string,
  fetcher: typeof fetch = fetch,
): Promise<CloudflareCustomHostname | null> {
  const envelope = await providerEnvelope(
    config,
    `?hostname=${encodeURIComponent(hostname)}&per_page=2`,
    {},
    fetcher,
  );
  if (!Array.isArray(envelope.result)) {
    throw new CloudflareSaasError(
      "Cloudflare for SaaS returned an invalid hostname inventory",
      502,
      null,
      true,
    );
  }
  const exact = envelope.result
    .map((value) => normaliseCustomHostname(value))
    .find((candidate) => candidate.hostname === hostname);
  return exact ?? null;
}

export async function deleteCloudflareCustomHostname(
  config: CloudflareSaasConfig,
  providerHostnameId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await providerEnvelope(
    config,
    `/${encodeURIComponent(providerHostnameId)}`,
    { method: "DELETE" },
    fetcher,
  );
}

export function isCloudflareCustomHostnameReady(
  hostname: Pick<CloudflareCustomHostname, "status" | "sslStatus">,
): boolean {
  return hostname.status === "active" && hostname.sslStatus === "active";
}

async function providerRequest(
  config: CloudflareSaasConfig,
  suffix: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<CloudflareCustomHostname> {
  const envelope = await providerEnvelope(config, suffix, init, fetcher);
  return normaliseCustomHostname(envelope.result);
}

async function providerEnvelope(
  config: CloudflareSaasConfig,
  suffix: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<CloudflareApiEnvelope> {
  validateConfig(config);
  const url = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(config.zoneId)}/custom_hostnames${suffix}`;
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: {
        "authorization": `Bearer ${config.apiToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new CloudflareSaasError(
      `Cloudflare for SaaS request failed: ${boundedMessage(error)}`,
      503,
      null,
      true,
    );
  }

  let envelope: CloudflareApiEnvelope;
  try {
    envelope = await response.json<CloudflareApiEnvelope>();
  } catch {
    throw new CloudflareSaasError(
      `Cloudflare for SaaS returned an unreadable response (${response.status})`,
      response.status,
      null,
      isRetryableStatus(response.status),
    );
  }
  if (!response.ok || envelope.success !== true) {
    const first = Array.isArray(envelope.errors) ? envelope.errors[0] : undefined;
    const providerMessage = typeof first?.message === "string"
      ? first.message.slice(0, 500)
      : `Cloudflare for SaaS returned ${response.status}`;
    throw new CloudflareSaasError(
      providerMessage,
      response.status,
      typeof first?.code === "number" ? first.code : null,
      isRetryableStatus(response.status),
    );
  }
  return envelope;
}

function normaliseCustomHostname(value: unknown): CloudflareCustomHostname {
  const result = asRecord(value);
  const ssl = asRecord(result.ssl);
  const ownership = asRecord(result.ownership_verification);
  const validationRecords = Array.isArray(ssl.validation_records)
    ? ssl.validation_records.map(asRecord)
    : [];
  const verificationErrors = Array.isArray(result.verification_errors)
    ? result.verification_errors
      .filter((item): item is string => typeof item === "string")
      .slice(0, 10)
      .map((item) => item.slice(0, 500))
    : [];
  const id = readString(result.id);
  const hostname = readString(result.hostname);
  const status = readString(result.status);
  if (!id || !hostname || !status) {
    throw new CloudflareSaasError(
      "Cloudflare for SaaS returned an incomplete custom hostname",
      502,
      null,
      true,
    );
  }
  const ownershipName = readString(ownership.name);
  const ownershipValue = readString(ownership.value);
  return {
    id,
    hostname,
    status,
    sslStatus: readString(ssl.status),
    ownershipVerification: ownershipName && ownershipValue
      ? {
          name: ownershipName,
          type: readString(ownership.type) ?? "txt",
          value: ownershipValue,
        }
      : null,
    sslValidationRecords: validationRecords.slice(0, 10).map((record) => ({
      status: readString(record.status),
      txtName: readString(record.txt_name),
      txtValue: readString(record.txt_value),
    })),
    verificationErrors,
  };
}

function validateConfig(config: CloudflareSaasConfig): void {
  if (!config.zoneId.trim() || !config.apiToken.trim() || !config.cnameTarget.trim()) {
    throw new CloudflareSaasError(
      "Cloudflare for SaaS is not configured",
      503,
      null,
      false,
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function boundedMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "network error").slice(0, 500);
}

function isRetryableStatus(status: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}
