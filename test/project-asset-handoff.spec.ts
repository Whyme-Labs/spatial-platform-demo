import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  env,
  getQueueResult,
  waitOnExecutionContext,
} from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { otpHash } from "../src/worker/auth";
import worker from "../src/worker/index";

const origin = "https://spatial.test";
const copyQueue = "spatial-portfolio-copies-local";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function login(): Promise<{ cookie: string; userId: string; sourceOrganisationId: string }> {
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
  const fixture = await env.DB.prepare(`
    SELECT u.id AS user_id, m.organisation_id
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    WHERE lower(u.email) = lower(?) AND m.status = 'active'
    ORDER BY m.created_at
    LIMIT 1
  `).bind(email).first<{ user_id: string; organisation_id: string }>();
  if (!fixture) throw new Error("Expected the authenticated fixture user");
  return {
    cookie: `spatial_access=${access}`,
    userId: fixture.user_id,
    sourceOrganisationId: fixture.organisation_id,
  };
}

async function addDestination(userId: string): Promise<string> {
  const organisationId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO organisations (id, name, slug)
      VALUES (?, ?, ?)
    `).bind(
      organisationId,
      `Asset destination ${organisationId.slice(0, 8)}`,
      `asset-destination-${organisationId.slice(0, 8)}`,
    ),
    env.DB.prepare(`
      INSERT INTO memberships (organisation_id, user_id, role, status, updated_at)
      VALUES (?, ?, 'platform_admin', 'active', datetime('now'))
    `).bind(organisationId, userId),
  ]);
  return organisationId;
}

async function seedAssetProject(
  organisationId: string,
  userId: string,
  options: { assetCount?: number; omitObjectAt?: number } = {},
): Promise<{
  projectId: string;
  versionId: string;
  assets: Array<{ id: string; objectKey: string; bytes: Uint8Array; sha256: string }>;
}> {
  const projectId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const assetCount = options.assetCount ?? 1;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO projects
        (id, organisation_id, name, slug, status, capture_adapter,
          capture_adapter_v2, delivery_template, notes, created_by)
      VALUES (?, ?, ?, ?, 'INGESTED', 'open-import', 'open-import',
        'Portable spatial project', 'Source remains unchanged.', ?)
    `).bind(
      projectId,
      organisationId,
      `Asset source ${projectId.slice(0, 8)}`,
      `asset-source-${projectId.slice(0, 8)}`,
      userId,
    ),
    env.DB.prepare(`
      INSERT INTO scene_versions
        (id, project_id, version_number, status, source_provenance_json,
          manifest_json, created_by)
      VALUES (?, ?, 1, 'INGESTED', ?, ?, ?)
    `).bind(
      versionId,
      projectId,
      JSON.stringify({ adapter: "open-import", immutable: true }),
      JSON.stringify({ schemaVersion: 1, coordinateSystem: "local-metric-y-up" }),
      userId,
    ),
  ]);
  const assets: Array<{ id: string; objectKey: string; bytes: Uint8Array; sha256: string }> = [];
  for (let index = 0; index < assetCount; index += 1) {
    const id = crypto.randomUUID();
    const objectKey = `${organisationId}/${projectId}/${versionId}/${id}/source-${index}.ply`;
    const bytes = new TextEncoder().encode(`verified spatial asset ${projectId} ${index}`);
    const sha256 = await sha256Hex(bytes);
    if (index !== options.omitObjectAt) {
      await env.SPATIAL_ASSETS.put(objectKey, bytes);
    }
    await env.DB.prepare(`
      INSERT INTO assets
        (id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, sha256, integrity_status)
      VALUES (?, ?, ?, ?, 'source', 'ply', ?, ?, 'application/octet-stream',
        ?, ?, 'verified')
    `).bind(
      id,
      organisationId,
      projectId,
      versionId,
      objectKey,
      `source-${index}.ply`,
      bytes.byteLength,
      sha256,
    ).run();
    assets.push({ id, objectKey, bytes, sha256 });
  }
  return { projectId, versionId, assets };
}

async function queueCopyItem(itemId: string, attempts = 1): Promise<void> {
  const batch = createMessageBatch(copyQueue, [{
    id: crypto.randomUUID(),
    timestamp: new Date(),
    attempts,
    body: { type: "project_asset_copy", itemId },
  }]);
  const context = createExecutionContext();
  await worker.queue!(batch, env, context);
  await waitOnExecutionContext(context);
  const result = await getQueueResult(batch, context);
  expect(result.outcome).toBe("ok");
}

describe("asset-bearing cross-organisation project handoff", () => {
  it("previews, checksum-copies, finalizes, and safely replays one immutable project", async () => {
    const auth = await login();
    const destinationId = await addDestination(auth.userId);
    const source = await seedAssetProject(auth.sourceOrganisationId, auth.userId);
    const previewResponse = await exports.default.fetch(
      `${origin}/api/projects/asset-handoffs/preview`,
      {
        method: "POST",
        headers: { cookie: auth.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          targetOrganisationId: destinationId,
          projectId: source.projectId,
        }),
      },
    );
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json<{
      valid: boolean;
      sourceSnapshotHash: string;
      summary: { versions: number; assets: number; bytes: number };
      exclusions: Record<string, boolean>;
    }>();
    expect(preview).toMatchObject({
      valid: true,
      summary: {
        versions: 1,
        assets: 1,
        bytes: source.assets[0]!.bytes.byteLength,
      },
      exclusions: {
        releases: true,
        jobs: true,
        reviews: true,
        memberships: true,
        billing: true,
      },
    });
    expect(preview.sourceSnapshotHash).toMatch(/^[0-9a-f]{64}$/);

    const clientOperationId = crypto.randomUUID();
    const commitBody = {
      clientOperationId,
      targetOrganisationId: destinationId,
      projectId: source.projectId,
      sourceSnapshotHash: preview.sourceSnapshotHash,
    };
    const commit = await exports.default.fetch(`${origin}/api/projects/asset-handoffs`, {
      method: "POST",
      headers: { cookie: auth.cookie, "content-type": "application/json" },
      body: JSON.stringify(commitBody),
    });
    expect(commit.status).toBe(202);
    const started = await commit.json<{
      handoff: {
        id: string;
        status: string;
        totalAssets: number;
        totalBytes: number;
        items: Array<{ id: string; status: string }>;
      };
    }>();
    expect(started.handoff).toMatchObject({
      status: "queued",
      totalAssets: 1,
      totalBytes: source.assets[0]!.bytes.byteLength,
      items: [{ status: "queued" }],
    });

    const replay = await exports.default.fetch(`${origin}/api/projects/asset-handoffs`, {
      method: "POST",
      headers: { cookie: auth.cookie, "content-type": "application/json" },
      body: JSON.stringify(commitBody),
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      idempotent: true,
      handoff: { id: started.handoff.id },
    });

    await queueCopyItem(started.handoff.items[0]!.id);
    await queueCopyItem(started.handoff.items[0]!.id);

    const status = await exports.default.fetch(
      `${origin}/api/projects/asset-handoffs/${started.handoff.id}`,
      { headers: { cookie: auth.cookie } },
    );
    expect(status.status).toBe(200);
    const completed = await status.json<{
      handoff: {
        status: string;
        copiedAssets: number;
        copiedBytes: number;
        targetProjectId: string;
        items: Array<{ targetObjectKey: string; status: string }>;
      };
    }>();
    expect(completed.handoff).toMatchObject({
      status: "completed",
      copiedAssets: 1,
      copiedBytes: source.assets[0]!.bytes.byteLength,
      items: [{ status: "copied" }],
    });

    const destinationProject = await env.DB.prepare(`
      SELECT organisation_id, status FROM projects WHERE id = ?
    `).bind(completed.handoff.targetProjectId).first<{
      organisation_id: string;
      status: string;
    }>();
    expect(destinationProject).toEqual({
      organisation_id: destinationId,
      status: "INGESTED",
    });
    const copiedAsset = await env.DB.prepare(`
      SELECT organisation_id, project_id, size_bytes, sha256, integrity_status,
        object_key
      FROM assets
      WHERE project_id = ?
    `).bind(completed.handoff.targetProjectId).first<{
      organisation_id: string;
      project_id: string;
      size_bytes: number;
      sha256: string;
      integrity_status: string;
      object_key: string;
    }>();
    expect(copiedAsset).toMatchObject({
      organisation_id: destinationId,
      project_id: completed.handoff.targetProjectId,
      size_bytes: source.assets[0]!.bytes.byteLength,
      sha256: source.assets[0]!.sha256,
      integrity_status: "verified",
    });
    const copiedObject = await env.SPATIAL_ASSETS.get(copiedAsset!.object_key);
    expect(copiedObject).not.toBeNull();
    expect(new Uint8Array(await copiedObject!.arrayBuffer())).toEqual(source.assets[0]!.bytes);
    const authority = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS count FROM releases WHERE project_id = ?")
        .bind(completed.handoff.targetProjectId),
      env.DB.prepare("SELECT COUNT(*) AS count FROM processing_jobs WHERE project_id = ?")
        .bind(completed.handoff.targetProjectId),
      env.DB.prepare("SELECT COUNT(*) AS count FROM review_comments WHERE project_id = ?")
        .bind(completed.handoff.targetProjectId),
    ]);
    expect(authority.map((result) => Number((result.results[0] as { count: number }).count)))
      .toEqual([0, 0, 0]);
  });

  it("rejects a changed preview and recovers a missing-object copy through deliberate retry", async () => {
    const auth = await login();
    const destinationId = await addDestination(auth.userId);
    const changed = await seedAssetProject(auth.sourceOrganisationId, auth.userId);
    const previewResponse = await exports.default.fetch(
      `${origin}/api/projects/asset-handoffs/preview`,
      {
        method: "POST",
        headers: { cookie: auth.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          targetOrganisationId: destinationId,
          projectId: changed.projectId,
        }),
      },
    );
    const preview = await previewResponse.json<{ sourceSnapshotHash: string }>();
    await env.DB.prepare(`
      UPDATE projects SET notes = 'Changed after preview', updated_at = datetime('now')
      WHERE id = ?
    `).bind(changed.projectId).run();
    const staleCommit = await exports.default.fetch(`${origin}/api/projects/asset-handoffs`, {
      method: "POST",
      headers: { cookie: auth.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        targetOrganisationId: destinationId,
        projectId: changed.projectId,
        sourceSnapshotHash: preview.sourceSnapshotHash,
      }),
    });
    expect(staleCommit.status).toBe(409);
    await expect(staleCommit.json()).resolves.toMatchObject({
      error: expect.stringMatching(/changed/i),
    });

    const missing = await seedAssetProject(auth.sourceOrganisationId, auth.userId, {
      omitObjectAt: 0,
    });
    const validPreviewResponse = await exports.default.fetch(
      `${origin}/api/projects/asset-handoffs/preview`,
      {
        method: "POST",
        headers: { cookie: auth.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          targetOrganisationId: destinationId,
          projectId: missing.projectId,
        }),
      },
    );
    const validPreview = await validPreviewResponse.json<{ sourceSnapshotHash: string }>();
    const commit = await exports.default.fetch(`${origin}/api/projects/asset-handoffs`, {
      method: "POST",
      headers: { cookie: auth.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        targetOrganisationId: destinationId,
        projectId: missing.projectId,
        sourceSnapshotHash: validPreview.sourceSnapshotHash,
      }),
    });
    const started = await commit.json<{
      handoff: { id: string; items: Array<{ id: string }> };
    }>();
    await queueCopyItem(started.handoff.items[0]!.id, 3);
    let operation = await env.DB.prepare(`
      SELECT status, error_message FROM project_asset_handoffs WHERE id = ?
    `).bind(started.handoff.id).first<{ status: string; error_message: string | null }>();
    expect(operation).toMatchObject({
      status: "failed",
      error_message: expect.stringMatching(/source object/i),
    });

    await env.SPATIAL_ASSETS.put(missing.assets[0]!.objectKey, missing.assets[0]!.bytes);
    const retryOperationId = crypto.randomUUID();
    const retry = await exports.default.fetch(
      `${origin}/api/projects/asset-handoffs/${started.handoff.id}/retry`,
      {
        method: "POST",
        headers: { cookie: auth.cookie, "content-type": "application/json" },
        body: JSON.stringify({ clientOperationId: retryOperationId }),
      },
    );
    expect(retry.status).toBe(202);
    const retryReplay = await exports.default.fetch(
      `${origin}/api/projects/asset-handoffs/${started.handoff.id}/retry`,
      {
        method: "POST",
        headers: { cookie: auth.cookie, "content-type": "application/json" },
        body: JSON.stringify({ clientOperationId: retryOperationId }),
      },
    );
    expect(retryReplay.status).toBe(200);
    await expect(retryReplay.json()).resolves.toMatchObject({ idempotent: true });
    await queueCopyItem(started.handoff.items[0]!.id);
    operation = await env.DB.prepare(`
      SELECT status, error_message FROM project_asset_handoffs WHERE id = ?
    `).bind(started.handoff.id).first<{ status: string; error_message: string | null }>();
    expect(operation).toEqual({ status: "completed", error_message: null });
  });

  it("cancels safely, removes copied destinations, and creates no target project", async () => {
    const auth = await login();
    const destinationId = await addDestination(auth.userId);
    const source = await seedAssetProject(auth.sourceOrganisationId, auth.userId, {
      assetCount: 2,
    });
    const previewResponse = await exports.default.fetch(
      `${origin}/api/projects/asset-handoffs/preview`,
      {
        method: "POST",
        headers: { cookie: auth.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          targetOrganisationId: destinationId,
          projectId: source.projectId,
        }),
      },
    );
    const preview = await previewResponse.json<{ sourceSnapshotHash: string }>();
    const commit = await exports.default.fetch(`${origin}/api/projects/asset-handoffs`, {
      method: "POST",
      headers: { cookie: auth.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        targetOrganisationId: destinationId,
        projectId: source.projectId,
        sourceSnapshotHash: preview.sourceSnapshotHash,
      }),
    });
    const started = await commit.json<{
      handoff: {
        id: string;
        targetProjectId: string;
        items: Array<{ id: string; targetObjectKey: string }>;
      };
    }>();
    await queueCopyItem(started.handoff.items[0]!.id);
    expect(await env.SPATIAL_ASSETS.head(started.handoff.items[0]!.targetObjectKey))
      .not.toBeNull();
    const cancel = await exports.default.fetch(
      `${origin}/api/projects/asset-handoffs/${started.handoff.id}/cancel`,
      {
        method: "POST",
        headers: { cookie: auth.cookie, "content-type": "application/json" },
        body: JSON.stringify({ clientOperationId: crypto.randomUUID() }),
      },
    );
    expect(cancel.status).toBe(200);
    await expect(cancel.json()).resolves.toMatchObject({
      handoff: { status: "cancelled" },
    });
    expect(await env.SPATIAL_ASSETS.head(started.handoff.items[0]!.targetObjectKey))
      .toBeNull();
    expect(await env.DB.prepare("SELECT id FROM projects WHERE id = ?")
      .bind(started.handoff.targetProjectId).first()).toBeNull();
  });

  it("reconciles a queued copy item without reviving terminal operations", async () => {
    const auth = await login();
    const destinationId = await addDestination(auth.userId);
    const source = await seedAssetProject(auth.sourceOrganisationId, auth.userId, {
      assetCount: 2,
    });
    const previewResponse = await exports.default.fetch(
      `${origin}/api/projects/asset-handoffs/preview`,
      {
        method: "POST",
        headers: { cookie: auth.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          targetOrganisationId: destinationId,
          projectId: source.projectId,
        }),
      },
    );
    const preview = await previewResponse.json<{ sourceSnapshotHash: string }>();
    const commit = await exports.default.fetch(`${origin}/api/projects/asset-handoffs`, {
      method: "POST",
      headers: { cookie: auth.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        targetOrganisationId: destinationId,
        projectId: source.projectId,
        sourceSnapshotHash: preview.sourceSnapshotHash,
      }),
    });
    const started = await commit.json<{
      handoff: { id: string; items: Array<{ id: string }> };
    }>();
    const queuedItemId = started.handoff.items[0]!.id;
    const terminalItemId = started.handoff.items[1]!.id;
    await env.DB.prepare(`
      UPDATE project_asset_handoff_items
      SET status = 'cancelled', updated_at = datetime('now')
      WHERE id = ?
    `).bind(terminalItemId).run();
    const copySend = vi.fn(async () => undefined);
    const processingSend = vi.fn(async () => undefined);
    const scheduledEnv = {
      ...env,
      PORTFOLIO_COPY_QUEUE: { send: copySend },
      PROCESSING_DISPATCH_QUEUE: { send: processingSend },
    } as unknown as Env;
    const context = createExecutionContext();
    await worker.scheduled!(
      createScheduledController({ cron: "* * * * *" }),
      scheduledEnv,
      context,
    );
    await waitOnExecutionContext(context);
    expect(copySend).toHaveBeenCalledWith({
      type: "project_asset_copy",
      itemId: queuedItemId,
    });
    expect(copySend).not.toHaveBeenCalledWith(
      expect.objectContaining({ itemId: terminalItemId }),
    );
  });
});
