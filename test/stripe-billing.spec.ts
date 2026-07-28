import { describe, expect, it, vi } from "vitest";
import {
  StripeBillingError,
  cancelStripeSubscriptionAtPeriodEnd,
  createStripeCheckoutSession,
  verifyStripeWebhookSignature,
} from "../src/worker/stripe-billing";

const config = {
  secretKey: "sk_test_spatial",
  webhookSecret: "whsec_spatial",
  prices: {
    listing: "price_listing",
    portfolio: "price_portfolio",
    venue: "price_venue",
  },
};

describe("Stripe billing adapter", () => {
  it("creates a subscription Checkout Session with tenant-bound metadata", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk_test_spatial");
      expect(headers.get("content-type")).toContain("application/x-www-form-urlencoded");
      expect(headers.get("idempotency-key")).toBe("spatial-checkout-checkout-1");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("mode")).toBe("subscription");
      expect(body.get("line_items[0][price]")).toBe("price_venue");
      expect(body.get("line_items[0][quantity]")).toBe("1");
      expect(body.get("client_reference_id")).toBe("checkout-1");
      expect(body.get("customer_email")).toBe("buyer@example.com");
      expect(body.get("metadata[organisation_id]")).toBe("org-1");
      expect(body.get("metadata[project_id]")).toBe("project-1");
      expect(body.get("metadata[checkout_id]")).toBe("checkout-1");
      expect(body.get("subscription_data[metadata][project_id]")).toBe("project-1");
      return new Response(JSON.stringify({
        id: "cs_test_1",
        url: "https://checkout.stripe.com/c/pay/cs_test_1",
        status: "open",
        payment_status: "unpaid",
        expires_at: 1_785_200_000,
        customer: null,
        subscription: null,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const checkout = await createStripeCheckoutSession(config, {
      checkoutId: "checkout-1",
      organisationId: "org-1",
      projectId: "project-1",
      planCode: "venue",
      customerEmail: "buyer@example.com",
      successUrl: "https://spatial.whymelabs.com/studio.html#hosting?checkout=success",
      cancelUrl: "https://spatial.whymelabs.com/studio.html#hosting?checkout=cancelled",
    }, fetcher);

    expect(checkout).toMatchObject({
      id: "cs_test_1",
      status: "open",
      paymentStatus: "unpaid",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("requests provider cancellation at period end instead of inventing a local cancellation", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.stripe.com/v1/subscriptions/sub_123");
      expect(new Headers(init?.headers).get("idempotency-key")).toBe(
        "spatial-cancel-sub_123",
      );
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("cancel_at_period_end")).toBe("true");
      return new Response(JSON.stringify({
        id: "sub_123",
        status: "active",
        cancel_at_period_end: true,
        current_period_start: 1_785_100_000,
        current_period_end: 1_787_692_000,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const subscription = await cancelStripeSubscriptionAtPeriodEnd(
      config,
      "sub_123",
      fetcher,
    );
    expect(subscription.cancelAtPeriodEnd).toBe(true);
    expect(subscription.status).toBe("active");
  });

  it("verifies signed webhooks and rejects stale or modified payloads", async () => {
    const timestamp = 1_785_178_800;
    const rawBody = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(config.webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${rawBody}`),
    );
    const hex = Array.from(new Uint8Array(signature), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    const header = `t=${timestamp},v1=${hex}`;

    await expect(
      verifyStripeWebhookSignature(rawBody, header, config.webhookSecret, timestamp + 60),
    ).resolves.toBe(true);
    await expect(
      verifyStripeWebhookSignature(`${rawBody} `, header, config.webhookSecret, timestamp + 60),
    ).resolves.toBe(false);
    await expect(
      verifyStripeWebhookSignature(rawBody, header, config.webhookSecret, timestamp + 601),
    ).resolves.toBe(false);
  });

  it("returns bounded retryability for provider failures", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({
        error: {
          type: "rate_limit_error",
          code: "rate_limit",
          message: "Too many requests ".repeat(100),
        },
      }), { status: 429, headers: { "content-type": "application/json" } })
    );

    await expect(createStripeCheckoutSession(config, {
      checkoutId: "checkout-2",
      organisationId: "org-1",
      projectId: "project-1",
      planCode: "listing",
      customerEmail: "buyer@example.com",
      successUrl: "https://spatial.whymelabs.com/studio.html#hosting",
      cancelUrl: "https://spatial.whymelabs.com/studio.html#hosting",
    }, fetcher)).rejects.toMatchObject<Partial<StripeBillingError>>({
      status: 429,
      providerCode: "rate_limit",
      retryable: true,
    });
  });
});
