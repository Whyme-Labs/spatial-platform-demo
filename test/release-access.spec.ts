import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/worker/security";

const origin = "https://spatial.test";

// Seeds the minimum rows for an active release channel so the manifest
// endpoint reaches its access decision. The rows deliberately stop before a
// frozen spatial snapshot: an authorised request then answers 409 (snapshot
// missing) instead of 401, which cleanly separates the access decision under
// test from full manifest assembly (covered by test/platform.spec.ts).
async function seedActiveRelease(options: {
  slug: string;
  accessPolicy: "token" | "customer-authenticated";
  accessToken?: string;
}): Promise<void> {
  const organisationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const releaseId = crypto.randomUUID();
  const accessTokenHash = options.accessToken
    ? await sha256Hex(`${options.accessToken}:${env.SESSION_PEPPER}`)
    : null;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organisations (id, name, slug) VALUES (?, ?, ?)",
    ).bind(organisationId, `Access org ${options.slug}`, `access-org-${options.slug}`),
    env.DB.prepare(
      "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)",
    ).bind(userId, `${options.slug}@access.test`, "Access seeder"),
    env.DB.prepare(`
      INSERT INTO projects (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by)
      VALUES (?, ?, ?, ?, 'PUBLISHED', 'open-import', 'Property showcase', ?)
    `).bind(projectId, organisationId, `Access project ${options.slug}`, `access-${options.slug}`, userId),
    env.DB.prepare(`
      INSERT INTO scene_versions (id, project_id, version_number, status, created_by)
      VALUES (?, ?, 1, 'PUBLISHED', ?)
    `).bind(versionId, projectId, userId),
    env.DB.prepare(`
      INSERT INTO assets (id, organisation_id, project_id, version_id, kind, format, object_key,
        file_name, mime_type, size_bytes, sha256, integrity_status)
      VALUES (?, ?, ?, ?, 'web', 'rad', ?, 'scene.rad', 'application/octet-stream', 1, ?, 'verified')
    `).bind(assetId, organisationId, projectId, versionId, `web/${assetId}/scene.rad`, "a".repeat(64)),
    env.DB.prepare(`
      INSERT INTO releases (id, organisation_id, project_id, version_id, web_asset_id,
        access_policy, access_token_hash, release_number, published_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), ?)
    `).bind(
      releaseId,
      organisationId,
      projectId,
      versionId,
      assetId,
      options.accessPolicy,
      accessTokenHash,
      userId,
    ),
    env.DB.prepare(`
      INSERT INTO release_channels (id, organisation_id, project_id, slug, active_release_id)
      VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), organisationId, projectId, options.slug, releaseId),
  ]);
}

function manifestUrl(slug: string, accessToken?: string): string {
  const url = new URL(`${origin}/api/releases/${slug}/manifest`);
  if (accessToken) url.searchParams.set("access_token", accessToken);
  return url.toString();
}

describe("release manifest access denial", () => {
  it("answers a bare token-release link with a 401 naming the token policy and no hash material", async () => {
    await seedActiveRelease({
      slug: "gated-token-scene",
      accessPolicy: "token",
      accessToken: "0".repeat(63) + "1",
    });
    const denied = await exports.default.fetch(manifestUrl("gated-token-scene"));
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    const body = await denied.json<Record<string, unknown>>();
    expect(body).toEqual({
      error: "This scene requires access",
      accessPolicy: "token",
      requestId: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain("hash");
    expect(JSON.stringify(body)).not.toContain("0".repeat(20));
  });

  it("rejects a wrong access token with the same 401 body it gives a missing one", async () => {
    await seedActiveRelease({
      slug: "gated-token-retry",
      accessPolicy: "token",
      accessToken: "2".repeat(64),
    });
    const wrongCode = await exports.default.fetch(
      manifestUrl("gated-token-retry", "3".repeat(64)),
    );
    expect(wrongCode.status).toBe(401);
    await expect(wrongCode.json()).resolves.toMatchObject({
      error: "This scene requires access",
      accessPolicy: "token",
    });
  });

  it("authorises the correct access token past the 401 gate", async () => {
    await seedActiveRelease({
      slug: "gated-token-unlock",
      accessPolicy: "token",
      accessToken: "4".repeat(64),
    });
    const authorised = await exports.default.fetch(
      manifestUrl("gated-token-unlock", "4".repeat(64)),
    );
    // The seed stops before a frozen spatial snapshot, so an authorised
    // request reports the post-access 409 instead of any access denial.
    expect(authorised.status).toBe(409);
    await expect(authorised.json()).resolves.toMatchObject({
      error: expect.stringContaining("frozen spatial snapshot"),
    });
  });

  it("labels an unauthenticated customer-authenticated release for the sign-in affordance", async () => {
    await seedActiveRelease({
      slug: "gated-customer-scene",
      accessPolicy: "customer-authenticated",
    });
    const denied = await exports.default.fetch(manifestUrl("gated-customer-scene"));
    expect(denied.status).toBe(401);
    await expect(denied.json()).resolves.toEqual({
      error: "This scene requires access",
      accessPolicy: "customer-authenticated",
      requestId: expect.any(String),
    });
  });

  it("never accepts an access token for a customer-authenticated release", async () => {
    await seedActiveRelease({
      slug: "gated-customer-token",
      accessPolicy: "customer-authenticated",
    });
    const denied = await exports.default.fetch(
      manifestUrl("gated-customer-token", "5".repeat(64)),
    );
    expect(denied.status).toBe(401);
    await expect(denied.json()).resolves.toMatchObject({
      accessPolicy: "customer-authenticated",
    });
  });
});
