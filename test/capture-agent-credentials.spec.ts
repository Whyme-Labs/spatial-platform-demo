import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";

const origin = "https://spatial.test";

async function login(): Promise<string> {
  const email = env.ADMIN_EMAIL.toLowerCase();
  const challengeId = crypto.randomUUID();
  const code = "626262";
  await env.DB.prepare(`
    INSERT INTO auth_otp_challenges (id, email, code_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(
    challengeId,
    email,
    await otpHash(challengeId, email, code, env.OTP_PEPPER),
    new Date(Date.now() + 60_000).toISOString(),
  ).run();
  const response = await exports.default.fetch(`${origin}/api/auth/otp/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": `2001:db8::${crypto.getRandomValues(new Uint16Array(1))[0].toString(16)}`,
    },
    body: JSON.stringify({ email, challengeId, code }),
  });
  expect(response.status).toBe(200);
  const access = (response.headers.get("set-cookie") ?? "").match(/spatial_access=([^;,]+)/)?.[1];
  expect(access).toBeTruthy();
  return `spatial_access=${access}`;
}

async function createProject(cookie: string, name: string): Promise<{ id: string }> {
  const response = await exports.default.fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      clientOperationId: crypto.randomUUID(),
      name,
      captureAdapter: "xgrids-lcc",
      deliveryTemplate: "Venue navigator",
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json<{ project: { id: string } }>()).project;
}

describe("scoped capture-agent credentials", () => {
  it("uploads only assigned project evidence and supports rotate/revoke lifecycle", async () => {
    const cookie = await login();
    const assigned = await createProject(cookie, `Capture agent assigned ${crypto.randomUUID().slice(0, 8)}`);
    const forbidden = await createProject(cookie, `Capture agent forbidden ${crypto.randomUUID().slice(0, 8)}`);

    const createOperationId = crypto.randomUUID();
    const createRequest = {
      clientOperationId: createOperationId,
      name: "K1 export workstation",
      expiresInDays: 30,
      projectIds: [assigned.id],
    };
    const createCredential = await exports.default.fetch(`${origin}/api/capture-agents`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(createRequest),
    });
    expect(createCredential.status).toBe(201);
    const created = await createCredential.json<{
      credential: {
        id: string;
        name: string;
        status: string;
        projectIds: string[];
        generation: number;
      };
      token: string;
    }>();
    expect(created.credential).toMatchObject({
      name: "K1 export workstation",
      status: "active",
      projectIds: [assigned.id],
      generation: 1,
    });
    expect(created.token).toMatch(/^spcap_[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);

    const createRetry = await exports.default.fetch(`${origin}/api/capture-agents`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(createRequest),
    });
    expect(createRetry.status).toBe(200);
    await expect(createRetry.json()).resolves.toMatchObject({
      credential: { id: created.credential.id },
      token: created.token,
      idempotent: true,
    });
    const conflictingCreateRetry = await exports.default.fetch(`${origin}/api/capture-agents`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ ...createRequest, expiresInDays: 31 }),
    });
    expect(conflictingCreateRetry.status).toBe(409);

    const inventory = await exports.default.fetch(`${origin}/api/capture-agents`, {
      headers: { cookie },
    });
    expect(inventory.status).toBe(200);
    const inventoryBody = await inventory.json<{
      credentials: Array<Record<string, unknown>>;
    }>();
    expect(inventoryBody.credentials).toHaveLength(1);
    expect(inventoryBody.credentials[0]).not.toHaveProperty("token");
    expect(inventoryBody.credentials[0]).not.toHaveProperty("tokenHash");

    const unauthenticated = await exports.default.fetch(`${origin}/api/capture-agent/projects`);
    expect(unauthenticated.status).toBe(401);
    const agentHeaders = { authorization: `Bearer ${created.token}` };
    const projects = await exports.default.fetch(`${origin}/api/capture-agent/projects`, {
      headers: agentHeaders,
    });
    expect(projects.status).toBe(200);
    await expect(projects.json()).resolves.toMatchObject({
      credential: { id: created.credential.id, generation: 1 },
      projects: [{ id: assigned.id, captureAdapter: "xgrids-lcc" }],
    });

    const rejectedProject = await exports.default.fetch(
      `${origin}/api/projects/${forbidden.id}/uploads`,
      {
        method: "POST",
        headers: { ...agentHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          fileName: "forbidden.zip",
          sizeBytes: 6,
          format: "zip",
          purpose: "vendor_project",
          mimeType: "application/zip",
        }),
      },
    );
    expect(rejectedProject.status).toBe(404);

    const sourceBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const uploadOperationId = crypto.randomUUID();
    const createUpload = await exports.default.fetch(
      `${origin}/api/projects/${assigned.id}/uploads`,
      {
        method: "POST",
        headers: { ...agentHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: uploadOperationId,
          fileName: "k1-project.zip",
          sizeBytes: sourceBytes.byteLength,
          format: "zip",
          purpose: "vendor_project",
          mimeType: "application/zip",
        }),
      },
    );
    expect(createUpload.status).toBe(201);
    const { upload } = await createUpload.json<{
      upload: { id: string; partSizeBytes: number };
    }>();

    const uploadPart = await exports.default.fetch(
      `${origin}/api/uploads/${upload.id}/parts/1`,
      {
        method: "PUT",
        headers: {
          ...agentHeaders,
          "content-length": String(sourceBytes.byteLength),
        },
        body: sourceBytes,
      },
    );
    expect(uploadPart.status).toBe(200);
    const { part } = await uploadPart.json<{ part: { etag: string } }>();

    const recovery = await exports.default.fetch(
      `${origin}/api/projects/${assigned.id}/uploads/open`,
      { headers: agentHeaders },
    );
    expect(recovery.status).toBe(200);
    await expect(recovery.json()).resolves.toMatchObject({
      uploads: [{
        id: upload.id,
        uploadedBytes: sourceBytes.byteLength,
        parts: [{ partNumber: 1, etag: part.etag }],
      }],
    });

    const complete = await exports.default.fetch(
      `${origin}/api/uploads/${upload.id}/complete`,
      {
        method: "POST",
        headers: { ...agentHeaders, "content-type": "application/json" },
        body: JSON.stringify({ parts: [{ partNumber: 1, etag: part.etag }] }),
      },
    );
    expect(complete.status).toBe(200);
    await expect(complete.json()).resolves.toMatchObject({
      asset: { kind: "source", purpose: "vendor_project" },
      job: { type: "asset.evidence-validate", state: "QUEUED" },
    });

    const stored = await env.DB.prepare(`
      SELECT us.capture_agent_credential_id AS credentialId,
        sv.capture_agent_credential_id AS versionCredentialId,
        c.token_hash AS tokenHash
      FROM upload_sessions us
      JOIN scene_versions sv ON sv.id = us.version_id
      JOIN capture_agent_credentials c ON c.id = us.capture_agent_credential_id
      WHERE us.id = ?
    `).bind(upload.id).first<{
      credentialId: string;
      versionCredentialId: string;
      tokenHash: string;
    }>();
    expect(stored).toMatchObject({
      credentialId: created.credential.id,
      versionCredentialId: created.credential.id,
    });
    expect(stored?.tokenHash).not.toContain(created.token);

    const expandedScope = await exports.default.fetch(
      `${origin}/api/capture-agents/${created.credential.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          name: "K1 transfer station",
          projectIds: [assigned.id, forbidden.id],
        }),
      },
    );
    expect(expandedScope.status).toBe(200);
    await expect(expandedScope.json()).resolves.toMatchObject({
      credential: {
        name: "K1 transfer station",
        projectIds: [assigned.id, forbidden.id].sort(),
      },
    });
    const expandedInventory = await exports.default.fetch(`${origin}/api/capture-agent/projects`, {
      headers: agentHeaders,
    });
    expect(expandedInventory.status).toBe(200);
    expect(
      (await expandedInventory.json<{ projects: Array<{ id: string }> }>()).projects
        .map((project) => project.id),
    ).toEqual(expect.arrayContaining([assigned.id, forbidden.id]));

    const rotationOperationId = crypto.randomUUID();
    const rotationRequest = {
      clientOperationId: rotationOperationId,
      expiresInDays: 45,
    };
    const rotatedResponse = await exports.default.fetch(
      `${origin}/api/capture-agents/${created.credential.id}/rotate`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(rotationRequest),
      },
    );
    expect(rotatedResponse.status).toBe(200);
    const rotated = await rotatedResponse.json<{
      credential: { generation: number };
      token: string;
    }>();
    expect(rotated.credential.generation).toBe(2);
    expect(rotated.token).not.toBe(created.token);
    const rotationRetry = await exports.default.fetch(
      `${origin}/api/capture-agents/${created.credential.id}/rotate`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(rotationRequest),
      },
    );
    expect(rotationRetry.status).toBe(200);
    await expect(rotationRetry.json()).resolves.toMatchObject({
      credential: { generation: 2 },
      token: rotated.token,
      idempotent: true,
    });
    const conflictingRotationRetry = await exports.default.fetch(
      `${origin}/api/capture-agents/${created.credential.id}/rotate`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ ...rotationRequest, expiresInDays: 46 }),
      },
    );
    expect(conflictingRotationRetry.status).toBe(409);
    expect((await exports.default.fetch(`${origin}/api/capture-agent/projects`, {
      headers: agentHeaders,
    })).status).toBe(401);
    expect((await exports.default.fetch(`${origin}/api/capture-agent/projects`, {
      headers: { authorization: `Bearer ${rotated.token}` },
    })).status).toBe(200);

    const revoke = await exports.default.fetch(
      `${origin}/api/capture-agents/${created.credential.id}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(revoke.status).toBe(204);
    expect((await exports.default.fetch(`${origin}/api/capture-agent/projects`, {
      headers: { authorization: `Bearer ${rotated.token}` },
    })).status).toBe(401);

    const agentAudit = await env.DB.prepare(`
      SELECT actor_user_id, metadata_json
      FROM audit_events
      WHERE action = 'capture_agent.upload.complete'
        AND json_extract(metadata_json, '$.credentialId') = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(created.credential.id).first<{
      actor_user_id: string | null;
      metadata_json: string;
    }>();
    expect(agentAudit?.actor_user_id).toBeNull();
    expect(JSON.parse(agentAudit?.metadata_json ?? "{}")).toMatchObject({
      credentialId: created.credential.id,
      projectId: assigned.id,
    });
  });

  it("rejects expired credentials without exposing their stored verifier", async () => {
    const cookie = await login();
    const project = await createProject(cookie, `Expired capture agent ${crypto.randomUUID().slice(0, 8)}`);
    const response = await exports.default.fetch(`${origin}/api/capture-agents`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: "Expired workstation",
        expiresInDays: 1,
        projectIds: [project.id],
      }),
    });
    expect(response.status).toBe(201);
    const created = await response.json<{
      credential: { id: string };
      token: string;
    }>();
    await env.DB.prepare(`
      UPDATE capture_agent_credentials
      SET expires_at = datetime('now', '-1 second')
      WHERE id = ?
    `).bind(created.credential.id).run();
    const denied = await exports.default.fetch(`${origin}/api/capture-agent/projects`, {
      headers: { authorization: `Bearer ${created.token}` },
    });
    expect(denied.status).toBe(401);
    const inventory = await exports.default.fetch(`${origin}/api/capture-agents`, {
      headers: { cookie },
    });
    expect(inventory.status).toBe(200);
    const body = await inventory.json<{
      credentials: Array<Record<string, unknown>>;
    }>();
    const credential = body.credentials.find((candidate) => candidate.id === created.credential.id);
    expect(credential).toMatchObject({ status: "expired" });
    expect(credential).not.toHaveProperty("token");
    expect(credential).not.toHaveProperty("tokenHash");
  });
});
