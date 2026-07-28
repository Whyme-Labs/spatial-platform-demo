import { describe, expect, it } from "vitest";
import {
  CloudflareSaasError,
  createCloudflareCustomHostname,
  deleteCloudflareCustomHostname,
  getCloudflareCustomHostname,
  isCloudflareCustomHostnameReady,
} from "../src/worker/cloudflare-saas";

const config = {
  zoneId: "0123456789abcdef0123456789abcdef",
  apiToken: "test-provider-token",
  cnameTarget: "spatial.whymelabs.com",
};

describe("Cloudflare for SaaS provider contract", () => {
  it("creates a metadata-bound hostname and does not call a pending certificate active", async () => {
    let captured: Request | null = null;
    const fetcher: typeof fetch = async (input, init) => {
      captured = new Request(input, init);
      return Response.json({
        success: true,
        result: {
          id: "custom-hostname-1",
          hostname: "tour.customer.test",
          status: "pending",
          ownership_verification: {
            name: "_cf-custom-hostname.tour.customer.test",
            type: "txt",
            value: "ownership-token",
          },
          ssl: {
            status: "pending_validation",
            validation_records: [{
              txt_name: "_acme-challenge.tour.customer.test",
              txt_value: "certificate-token",
            }],
          },
        },
      }, { status: 201 });
    };

    const hostname = await createCloudflareCustomHostname(
      config,
      "tour.customer.test",
      {
        organisationId: "org-1",
        projectId: "project-1",
        domainId: "domain-1",
      },
      fetcher,
    );

    expect(captured?.url).toBe(
      "https://api.cloudflare.com/client/v4/zones/0123456789abcdef0123456789abcdef/custom_hostnames",
    );
    expect(captured?.headers.get("authorization")).toBe("Bearer test-provider-token");
    await expect(captured?.clone().json()).resolves.toMatchObject({
      hostname: "tour.customer.test",
      ssl: { method: "txt", type: "dv", settings: { min_tls_version: "1.2" } },
      custom_metadata: {
        organisation_id: "org-1",
        project_id: "project-1",
        domain_id: "domain-1",
      },
    });
    expect(hostname).toMatchObject({
      id: "custom-hostname-1",
      hostname: "tour.customer.test",
      status: "pending",
      sslStatus: "pending_validation",
      ownershipVerification: {
        name: "_cf-custom-hostname.tour.customer.test",
        value: "ownership-token",
      },
    });
    expect(isCloudflareCustomHostnameReady(hostname)).toBe(false);
  });

  it("requires both hostname and certificate status to be active", async () => {
    const fetcher: typeof fetch = async () => Response.json({
      success: true,
      result: {
        id: "custom-hostname-2",
        hostname: "tour.customer.test",
        status: "active",
        ssl: { status: "active" },
      },
    });
    const hostname = await getCloudflareCustomHostname(
      config,
      "custom-hostname-2",
      fetcher,
    );
    expect(isCloudflareCustomHostnameReady(hostname)).toBe(true);
  });

  it("surfaces bounded provider errors without accepting a failed response", async () => {
    const fetcher: typeof fetch = async () => Response.json({
      success: false,
      errors: [{ code: 1405, message: "Custom hostname quota is not enabled" }],
    }, { status: 403 });

    await expect(createCloudflareCustomHostname(
      config,
      "tour.customer.test",
      {
        organisationId: "org-1",
        projectId: "project-1",
        domainId: "domain-1",
      },
      fetcher,
    )).rejects.toMatchObject<Partial<CloudflareSaasError>>({
      name: "CloudflareSaasError",
      status: 403,
      providerCode: 1405,
      retryable: false,
    });
  });

  it("deletes the exact provider hostname", async () => {
    let captured: Request | null = null;
    const fetcher: typeof fetch = async (input, init) => {
      captured = new Request(input, init);
      return Response.json({ success: true, result: { id: "custom-hostname-3" } });
    };
    await deleteCloudflareCustomHostname(config, "custom-hostname-3", fetcher);
    expect(captured?.method).toBe("DELETE");
    expect(captured?.url).toBe(
      "https://api.cloudflare.com/client/v4/zones/0123456789abcdef0123456789abcdef/custom_hostnames/custom-hostname-3",
    );
  });
});
