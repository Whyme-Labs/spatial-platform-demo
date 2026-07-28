export type StripePlanCode = "listing" | "portfolio" | "venue";

export type StripeBillingConfig = {
  secretKey: string;
  webhookSecret: string;
  prices: Record<StripePlanCode, string>;
};

export type StripeCheckoutSession = {
  id: string;
  url: string;
  status: string;
  paymentStatus: string;
  expiresAt: number;
  customerId: string | null;
  subscriptionId: string | null;
};

export type StripeSubscription = {
  id: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
};

export class StripeBillingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerCode: string | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "StripeBillingError";
  }
}

type StripeCheckoutInput = {
  checkoutId: string;
  organisationId: string;
  projectId: string;
  planCode: StripePlanCode;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
};

type StripeErrorEnvelope = {
  error?: {
    code?: unknown;
    type?: unknown;
    message?: unknown;
  };
};

const stripeApiOrigin = "https://api.stripe.com";
const providerTimeoutMs = 15_000;

export async function createStripeCheckoutSession(
  config: StripeBillingConfig,
  input: StripeCheckoutInput,
  fetcher: typeof fetch = fetch,
): Promise<StripeCheckoutSession> {
  const priceId = config.prices[input.planCode]?.trim();
  if (!priceId) {
    throw new StripeBillingError(
      `Stripe price is not configured for the ${input.planCode} plan`,
      503,
      "price_not_configured",
      false,
    );
  }
  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: input.checkoutId,
    customer_email: input.customerEmail,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "metadata[organisation_id]": input.organisationId,
    "metadata[project_id]": input.projectId,
    "metadata[checkout_id]": input.checkoutId,
    "metadata[plan_code]": input.planCode,
    "subscription_data[metadata][organisation_id]": input.organisationId,
    "subscription_data[metadata][project_id]": input.projectId,
    "subscription_data[metadata][checkout_id]": input.checkoutId,
    "subscription_data[metadata][plan_code]": input.planCode,
  });
  const payload = await stripeRequest(
    config,
    "/v1/checkout/sessions",
    body,
    `spatial-checkout-${input.checkoutId}`,
    fetcher,
  );
  const id = requiredString(payload, "id");
  const url = requiredString(payload, "url");
  return {
    id,
    url,
    status: optionalString(payload, "status") ?? "open",
    paymentStatus: optionalString(payload, "payment_status") ?? "unpaid",
    expiresAt: optionalInteger(payload, "expires_at") ?? 0,
    customerId: expandableId(payload.customer),
    subscriptionId: expandableId(payload.subscription),
  };
}

export async function cancelStripeSubscriptionAtPeriodEnd(
  config: StripeBillingConfig,
  subscriptionId: string,
  fetcher: typeof fetch = fetch,
): Promise<StripeSubscription> {
  if (!/^sub_[A-Za-z0-9_]+$/.test(subscriptionId)) {
    throw new StripeBillingError("Stripe subscription identifier is invalid", 400, null, false);
  }
  const payload = await stripeRequest(
    config,
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    new URLSearchParams({ cancel_at_period_end: "true" }),
    `spatial-cancel-${subscriptionId}`,
    fetcher,
  );
  return {
    id: requiredString(payload, "id"),
    status: requiredString(payload, "status"),
    cancelAtPeriodEnd: payload.cancel_at_period_end === true,
    currentPeriodStart: optionalInteger(payload, "current_period_start"),
    currentPeriodEnd: optionalInteger(payload, "current_period_end"),
  };
}

export async function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestampValue = parts.find((part) => part.startsWith("t="))?.slice(2);
  const timestamp = timestampValue ? Number(timestampValue) : Number.NaN;
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return false;
  }
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => hexBytes(part.slice(3)))
    .filter((value): value is Uint8Array => value !== null);
  if (!signatures.length) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  ));
  return signatures.some((candidate) => timingSafeBytesEqual(expected, candidate));
}

async function stripeRequest(
  config: StripeBillingConfig,
  path: string,
  body: URLSearchParams,
  idempotencyKey: string,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("Stripe request timed out"), providerTimeoutMs);
  try {
    const response = await fetcher(`${stripeApiOrigin}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": idempotencyKey,
      },
      body: body.toString(),
      signal: controller.signal,
    });
    const raw = await response.text();
    const payload = parseObject(raw);
    if (!response.ok) {
      const envelope = payload as StripeErrorEnvelope;
      const providerCode = stringValue(envelope.error?.code)
        ?? stringValue(envelope.error?.type);
      const message = (
        stringValue(envelope.error?.message)
        ?? `Stripe returned HTTP ${response.status}`
      ).slice(0, 500);
      throw new StripeBillingError(
        message,
        response.status,
        providerCode,
        response.status === 408 || response.status === 409 ||
          response.status === 429 || response.status >= 500,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof StripeBillingError) throw error;
    const timedOut = controller.signal.aborted;
    throw new StripeBillingError(
      timedOut ? "Stripe request timed out" : "Stripe is temporarily unavailable",
      503,
      timedOut ? "timeout" : null,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The bounded provider error below is safer than returning an HTML body.
  }
  throw new StripeBillingError("Stripe returned an invalid response", 502, null, true);
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = optionalString(value, key);
  if (!result) throw new StripeBillingError(`Stripe response omitted ${key}`, 502, null, true);
  return result;
}

function optionalString(value: Record<string, unknown>, key: string): string | null {
  return stringValue(value[key]);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalInteger(value: Record<string, unknown>, key: string): number | null {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isInteger(candidate) ? candidate : null;
}

function expandableId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return stringValue(Reflect.get(value, "id"));
  }
  return null;
}

function hexBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function timingSafeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}
