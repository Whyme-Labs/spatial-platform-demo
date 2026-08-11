import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { issueAuthTokens, otpHash } from "../src/worker/auth";
import { navigationArtifactSchema } from "../src/worker/contracts";
import worker, {
  completeReleaseRepublishIntent,
  currentNavigationAuthoringState,
  navigationArtifactMatchesFrozenConnections,
  navigationAuthoringHash,
} from "../src/worker/index";
import { sha256Hex, signSceneToken } from "../src/worker/security";
import { PROVISIONAL_MEASUREMENT_DISCLAIMER } from "../src/shared/world-units";
import { publicationMeasurementDisclaimer } from "../src/shared/measurement-disclaimers";
import { projectPolicyForDeliveryTemplate } from "../src/shared/project-policies";

const origin = "https://spatial.test";
const VISUAL_ONLY_MEASUREMENT_DISCLAIMER = publicationMeasurementDisclaimer("visual-only");
let testClientSequence = 0;

function nextTestClientAddress(): string {
  testClientSequence += 1;
  return `2001:db8::${testClientSequence.toString(16)}`;
}

async function loginSession(
  requestedEmail = env.ADMIN_EMAIL,
): Promise<{ accessCookie: string; refreshCookie: string; challengeId: string; code: string; email: string }> {
  const email = requestedEmail.toLowerCase();
  const challengeId = crypto.randomUUID();
  const code = "314159";
  const codeHash = await otpHash(challengeId, email, code, env.OTP_PEPPER);
  await env.DB.prepare(`
    INSERT INTO auth_otp_challenges (id, email, code_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(
    challengeId,
    email,
    codeHash,
    new Date(Date.now() + 60_000).toISOString(),
  ).run();
  const response = await exports.default.fetch(`${origin}/api/auth/otp/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": nextTestClientAddress(),
    },
    body: JSON.stringify({ email, challengeId, code }),
  });

  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toContain("spatial_access=");
  const access = cookie!.match(/spatial_access=([^;,]+)/)?.[1];
  const refresh = cookie!.match(/spatial_refresh=([^;,]+)/)?.[1];
  expect(access).toBeTruthy();
  expect(refresh).toBeTruthy();
  return {
    accessCookie: `spatial_access=${access}`,
    refreshCookie: `spatial_refresh=${refresh}`,
    challengeId,
    code,
    email,
  };
}

async function login(): Promise<string> {
  return (await loginSession()).accessCookie;
}

async function verifyOtp(
  requestedEmail: string,
): Promise<Response> {
  const email = requestedEmail.toLowerCase();
  const challengeId = crypto.randomUUID();
  const code = "271828";
  const codeHash = await otpHash(challengeId, email, code, env.OTP_PEPPER);
  await env.DB.prepare(`
    INSERT INTO auth_otp_challenges (id, email, code_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(
    challengeId,
    email,
    codeHash,
    new Date(Date.now() + 60_000).toISOString(),
  ).run();
  return exports.default.fetch(`${origin}/api/auth/otp/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": nextTestClientAddress(),
    },
    body: JSON.stringify({ email, challengeId, code }),
  });
}

async function recordCompletedPrivacyScan(
  projectId: string,
  versionId: string,
  assetId: string,
): Promise<void> {
  const project = await env.DB.prepare(
    "SELECT organisation_id, created_by FROM projects WHERE id = ?",
  ).bind(projectId).first<{ organisation_id: string; created_by: string }>();
  const asset = await env.DB.prepare(
    "SELECT sha256, mime_type, size_bytes FROM assets WHERE id = ? AND version_id = ?",
  ).bind(assetId, versionId).first<{ sha256: string | null; mime_type: string; size_bytes: number }>();
  if (!project || !asset) throw new Error("Privacy fixture requires an existing project and asset");
  const scanId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO privacy_scans
        (id, organisation_id, project_id, version_id, client_operation_id,
          request_hash, detector, detector_version, targets_json, status,
          input_count, candidate_count, evidence_json, created_by, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, 'test-fixture', 'test-fixture/1', '[]',
        'COMPLETED', 1, 0, '{"humanReviewRequired":true}', ?, datetime('now'))
    `).bind(
      scanId,
      project.organisation_id,
      projectId,
      versionId,
      crypto.randomUUID(),
      "d".repeat(64),
      project.created_by,
    ),
    env.DB.prepare(`
      INSERT INTO privacy_scan_inputs
        (scan_id, asset_id, asset_sha256, mime_type, size_bytes)
      VALUES (?, ?, ?, ?, ?)
    `).bind(scanId, assetId, asset.sha256, asset.mime_type, asset.size_bytes),
  ]);
}

describe("Spatial Studio Worker", () => {
  it("keeps legacy traversal receipts nullable but rejects partially written capture receipts", async () => {
    await login();
    const member = await env.DB.prepare(`
      SELECT organisation_id AS organisationId, user_id AS userId
      FROM memberships ORDER BY created_at LIMIT 1
    `).first<{ organisationId: string; userId: string }>();
    const projectId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const traversalId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by)
        VALUES (?, ?, 'Legacy traversal receipt', ?, 'QA_REQUIRED', 'open-import',
          'venue-navigator', ?)
      `).bind(
        projectId,
        member!.organisationId,
        `legacy-traversal-${projectId.slice(0, 8)}`,
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO scene_versions (
          id, project_id, version_number, status, source_provenance_json, created_by
        ) VALUES (?, ?, 1, 'QA_REQUIRED', ?, ?)
      `).bind(
        versionId,
        projectId,
        JSON.stringify({ assetProducer: "open-import", adapter: "open-import" }),
        member!.userId,
      ),
    ]);
    await expect(env.DB.prepare(`
      INSERT INTO scene_navigation_traversals (
        id, organisation_id, project_id, version_id, traversal_kind, label,
        path_json, bidirectional, speed_units_per_second, reviewed_purpose,
        client_operation_id, created_by
      ) VALUES (?, ?, ?, ?, 'elevator', 'Legacy lift', '[[0,0,0],[0,3,0]]',
        1, 1, 'Legacy v8 record with no capture receipt.', ?, ?)
    `).bind(
      traversalId,
      member!.organisationId,
      projectId,
      versionId,
      crypto.randomUUID(),
      member!.userId,
    ).run()).resolves.toMatchObject({ success: true });
    await expect(env.DB.prepare(`
      UPDATE scene_navigation_traversals SET evidence_adapter = 'xgrids-lcc'
      WHERE id = ?
    `).bind(traversalId).run()).rejects.toThrow(
      "traversal_capture_receipt requires manifest_id, manifest_sha256, adapter, review_generation, registration_sha256, source_to_world, and source_path together",
    );
  });

  it("keeps an archived last traversal hash-bound instead of resurrecting an old approval", async () => {
    const profile = {
      world_unit: "metres",
      agent_radius: 0.25,
      agent_height: 1.7,
      eye_height: 1.6,
      max_step_metres: 0.2,
      max_slope_degrees: 45,
      max_speed: 1.6,
      max_acceleration: 8,
    };
    const traversal = {
      id: crypto.randomUUID(),
      traversal_kind: "elevator",
      label: "East lift",
      path_json: JSON.stringify([[0, 0, 0], [0, 3, 0]]),
      bidirectional: 1,
      speed_units_per_second: 1,
      reviewed_purpose: "Visible in the registered capture.",
      evidence_asset_id: crypto.randomUUID(),
      evidence_sha256: "a".repeat(64),
      evidence_manifest_id: crypto.randomUUID(),
      evidence_manifest_sha256: "b".repeat(64),
      evidence_adapter: "xgrids-lcc",
      evidence_manifest_review_generation: 1,
      evidence_registration_sha256: "c".repeat(64),
      evidence_source_to_world_json: JSON.stringify({
        sourceUpAxis: "Y",
        worldUnit: "metres",
        metresPerSourceUnit: 1,
        yawDegrees: 0,
        translationMetres: [0, 0, 0],
      }),
      evidence_source_path_json: JSON.stringify([[0, 0, 0], [0, 3, 0]]),
      status: "active",
    };
    const neverAuthored = await navigationAuthoringHash(profile, [], [], [], []);
    const active = await navigationAuthoringHash(profile, [], [], [], [traversal]);
    const archived = await navigationAuthoringHash(
      profile,
      [],
      [],
      [],
      [{ ...traversal, status: "archived" }],
    );
    expect(new Set([neverAuthored, active, archived]).size).toBe(3);
    const firstFloorplan = await navigationAuthoringHash(profile, [], [], [], [], {
      schemaVersion: "reviewed-floorplan-navigation-receipt-v1",
      floorplanRevisionId: "revision-1",
      planHash: "b".repeat(64),
      collisionAssetId: "collision-1",
      collisionSha256: "c".repeat(64),
    });
    const secondFloorplan = await navigationAuthoringHash(profile, [], [], [], [], {
      schemaVersion: "reviewed-floorplan-navigation-receipt-v1",
      floorplanRevisionId: "revision-2",
      planHash: "d".repeat(64),
      collisionAssetId: "collision-2",
      collisionSha256: "e".repeat(64),
    });
    expect(firstFloorplan).not.toBe(secondFloorplan);
    expect(firstFloorplan).not.toBe(neverAuthored);
  });
  it("reports binding health without exposing secrets", async () => {
    const response = await exports.default.fetch(`${origin}/api/health`);
    const body = await response.json<Record<string, unknown>>();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.dependencies).toEqual({ database: "ok", cache: "ok", storage: "ok" });
    expect(JSON.stringify(body)).not.toContain("test-otp-pepper");
  });

  it("serves direct static entry points through the Worker security middleware", async () => {
    for (const path of [
      "/studio.html",
      "/preview/project-fixture/version-fixture",
      "/images/spatial-hero.webp",
      "/renderer/index.html",
    ]) {
      const response = await exports.default.fetch(`${origin}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBeTruthy();
      expect(response.headers.get("content-security-policy")).toContain("object-src 'none'");
      expect(response.headers.get("content-security-policy")).toContain(
        "script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com https://challenges.cloudflare.com",
      );
      expect(response.headers.get("content-security-policy")).toContain(
        "frame-src 'self' https://challenges.cloudflare.com",
      );
    }
  });

  it("does not expose the retired PlayCanvas renderer entry point", async () => {
    const response = await exports.default.fetch(`${origin}/playcanvas-renderer/index.html`);
    expect(response.status).toBe(404);
  });

  it("gives operators a signed render-native authoring scene without weakening preview walking gates", async () => {
    const cookie = await login();
    const membership = await env.DB.prepare(`
      SELECT organisation_id AS organisationId, user_id AS userId
      FROM memberships ORDER BY created_at LIMIT 1
    `).first<{ organisationId: string; userId: string }>();
    const projectId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const manifestId = crypto.randomUUID();
    const manifestAssetId = crypto.randomUUID();
    const objectKey = `authoring/${membership!.organisationId}/${projectId}/${versionId}/scene.rad`;
    const bytes = new Uint8Array([82, 65, 68, 1, 2, 3, 4]);
    const assetSha256 = await sha256Hex(bytes);
    const registrationPayload = {
      schemaVersion: "capture-to-scene-registration-v1",
      sourceCoordinateFrameId: "authoring-y-up",
      targetCoordinateFrameId: "scene-world-right-handed-y-up-metres",
      evidenceAssetId: assetId,
      evidenceSha256: assetSha256,
      method: "Test fixture keeps the immutable render and scene world in one metric frame.",
      sourceToWorld: {
        sourceUpAxis: "Y",
        worldUnit: "metres",
        metresPerSourceUnit: 1,
        yawDegrees: 0,
        translationMetres: [0, 0, 0],
      },
    };
    const registrationSha256 = await sha256Hex(JSON.stringify(registrationPayload));
    const canonicalManifest = JSON.stringify({
      format: "whymelabs.spatial.capture-bundle",
      schemaVersion: "1.0.0",
      manifestId,
      project: { id: projectId, captureAdapter: "fjd-trion" },
      version: { id: versionId, versionNumber: 1 },
      coordinateFrame: {
        id: "authoring-y-up",
        units: "metres",
        axisConvention: "right-handed-y-up",
        epsg: null,
        registrationMethod: registrationPayload.method,
      },
      sceneRegistration: {
        ...registrationPayload,
        transformSha256: registrationSha256,
      },
      assets: [{
        id: assetId,
        roles: ["traversal_evidence"],
        sha256: assetSha256,
      }],
    });
    const manifestSha256 = await sha256Hex(canonicalManifest);
    await env.SPATIAL_ASSETS.put(objectKey, bytes);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by)
        VALUES (?, ?, 'Render authoring fixture', ?, 'QA_REQUIRED', 'fjd-trion',
          'venue-navigator', ?)
      `).bind(
        projectId,
        membership!.organisationId,
        `render-authoring-${projectId.slice(0, 8)}`,
        membership!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO scene_versions (id, project_id, version_number, status, created_by)
        VALUES (?, ?, 1, 'QA_REQUIRED', ?)
      `).bind(versionId, projectId, membership!.userId),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, sha256, integrity_status)
        VALUES (?, ?, ?, ?, 'web', 'rad', ?, 'scene.rad',
          'application/octet-stream', ?, ?, 'verified')
      `).bind(
        assetId,
        membership!.organisationId,
        projectId,
        versionId,
        objectKey,
        bytes.byteLength,
        assetSha256,
      ),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, sha256, integrity_status)
        VALUES (?, ?, ?, ?, 'report', 'capture-bundle-manifest-json', ?,
          'capture-bundle-manifest.json', 'application/json', ?, ?, 'verified')
      `).bind(
        manifestAssetId,
        membership!.organisationId,
        projectId,
        versionId,
        `reports-private/${membership!.organisationId}/${projectId}/${versionId}/capture-bundle-manifest.json`,
        new TextEncoder().encode(canonicalManifest).byteLength,
        manifestSha256,
      ),
      env.DB.prepare(`
        INSERT INTO capture_bundle_manifests (
          id, organisation_id, project_id, version_id, adapter, adapter_v2,
          schema_version, status, result, client_operation_id, request_hash,
          manifest_asset_id, manifest_hash, canonical_manifest_json,
          validation_json, created_by, review_decision, review_note,
          reviewed_by, reviewed_at, review_generation
        ) VALUES (?, ?, ?, ?, 'fjd-trion', 'fjd-trion', '1.0.0',
          'reviewed', 'ready', ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, datetime('now'), 1)
      `).bind(
        manifestId,
        membership!.organisationId,
        projectId,
        versionId,
        crypto.randomUUID(),
        "a".repeat(64),
        manifestAssetId,
        manifestSha256,
        canonicalManifest,
        JSON.stringify({ method: "capture-bundle-contract-v1", result: "ready" }),
        membership!.userId,
        "Accepted registered authoring fixture.",
        membership!.userId,
      ),
    ]);

    const authoringResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/authoring-renderable?versionId=${versionId}`,
      { headers: { cookie } },
    );
    expect(authoringResponse.status).toBe(200);
    expect(authoringResponse.headers.get("cache-control")).toBe("private, no-store");
    const authoring = await authoringResponse.json<{
      renderable: {
        versionId: string;
        assetId: string;
        contentUrl: string;
        purpose: string;
        viewer: { sourceToWorld: unknown; captureRegistration: { transformSha256: string } };
      };
    }>();
    expect(authoring.renderable).toMatchObject({
      versionId,
      assetId,
      purpose: "spatial-authoring",
    });
    expect(authoring.renderable.viewer).toMatchObject({
      sourceToWorld: registrationPayload.sourceToWorld,
      captureRegistration: { transformSha256: registrationSha256 },
    });
    const assetResponse = await exports.default.fetch(
      new URL(authoring.renderable.contentUrl, origin),
    );
    expect(assetResponse.status).toBe(200);
    expect(new Uint8Array(await assetResponse.arrayBuffer())).toEqual(bytes);

    const previewResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/versions/${versionId}/preview`,
      { headers: { cookie } },
    );
    expect(previewResponse.status).toBe(409);
    await expect(previewResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("approved structural collision"),
    });

    const sourceJobId = crypto.randomUUID();
    const sourceExtractionId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO processing_jobs
          (id, organisation_id, project_id, version_id, input_asset_id, job_type,
            processor_version, idempotency_key, state, progress)
        VALUES (?, ?, ?, ?, ?, 'floorplan.extract-v1', 'fixture', ?, 'SUCCEEDED', 100)
      `).bind(
        sourceJobId,
        membership!.organisationId,
        projectId,
        versionId,
        assetId,
        `source-floorplan-${sourceJobId}`,
      ),
      env.DB.prepare(`
        INSERT INTO floorplan_extraction_runs
          (id, organisation_id, project_id, version_id, input_asset_id, job_id,
            method, normalizer, status, parameters_json, source_evidence_json,
            proposal_json, proposal_hash, client_operation_id, request_hash,
            created_by, reviewed_by, review_decision, review_note,
            review_client_operation_id, review_request_hash, review_response_json,
            reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, 'metric-pointcloud-floorplan-v2', 'native-ply-v1',
          'REVIEWED', '{"automaticPipeline":true}', '{}', '{}', ?, ?, ?, ?, ?,
          'approve', 'Fixture source review.', ?, ?, '{}', datetime('now'))
      `).bind(
        sourceExtractionId,
        membership!.organisationId,
        projectId,
        versionId,
        assetId,
        sourceJobId,
        "a".repeat(64),
        crypto.randomUUID(),
        "b".repeat(64),
        membership!.userId,
        membership!.userId,
        crypto.randomUUID(),
        "c".repeat(64),
      ),
      env.DB.prepare(`
        INSERT INTO floorplan_revisions
          (id, organisation_id, project_id, version_id, extraction_id,
            revision_number, plan_json, plan_hash, source_proposal_hash,
            review_note, created_by)
        VALUES (?, ?, ?, ?, ?, 1, '{}', ?, ?, 'Fixture approved plan.', ?)
      `).bind(
        revisionId,
        membership!.organisationId,
        projectId,
        versionId,
        sourceExtractionId,
        "d".repeat(64),
        "a".repeat(64),
        membership!.userId,
      ),
    ]);
    const draftOperationId = crypto.randomUUID();
    const correctionDraftResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/floorplan-revisions/${revisionId}/correction-drafts`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ clientOperationId: draftOperationId }),
      },
    );
    expect(correctionDraftResponse.status).toBe(201);
    const correctionDraft = await correctionDraftResponse.json<{
      extraction: { id: string; status: string };
    }>();
    expect(correctionDraft.extraction.status).toBe("READY_FOR_REVIEW");
    const correctionReplay = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/floorplan-revisions/${revisionId}/correction-drafts`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ clientOperationId: draftOperationId }),
      },
    );
    expect(correctionReplay.status).toBe(200);
    await expect(correctionReplay.json()).resolves.toMatchObject({
      extraction: { id: correctionDraft.extraction.id },
      idempotent: true,
    });
  });

  it("blocks render-native marking when the scene has no verified metric registration", async () => {
    const cookie = await login();
    const membership = await env.DB.prepare(`
      SELECT organisation_id AS organisationId, user_id AS userId
      FROM memberships ORDER BY created_at LIMIT 1
    `).first<{ organisationId: string; userId: string }>();
    const projectId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const objectKey = `authoring/${membership!.organisationId}/${projectId}/${versionId}/unregistered.rad`;
    await env.SPATIAL_ASSETS.put(objectKey, new Uint8Array([82, 65, 68, 8]));
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by)
        VALUES (?, ?, 'Unregistered authoring fixture', ?, 'QA_REQUIRED', 'fjd-trion',
          'venue-navigator', ?)
      `).bind(
        projectId,
        membership!.organisationId,
        `unregistered-authoring-${projectId.slice(0, 8)}`,
        membership!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO scene_versions (id, project_id, version_number, status, created_by)
        VALUES (?, ?, 1, 'QA_REQUIRED', ?)
      `).bind(versionId, projectId, membership!.userId),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, integrity_status)
        VALUES (?, ?, ?, ?, 'web', 'rad', ?, 'unregistered.rad',
          'application/octet-stream', 4, 'verified')
      `).bind(
        assetId,
        membership!.organisationId,
        projectId,
        versionId,
        objectKey,
      ),
    ]);

    const response = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/authoring-renderable?versionId=${versionId}`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("no verified paired-upload frame receipt"),
    });
  });

  it("uses the immutable paired-upload receipt for render-native marking without a manual capture manifest", async () => {
    const cookie = await login();
    const membership = await env.DB.prepare(`
      SELECT organisation_id AS organisationId, user_id AS userId
      FROM memberships ORDER BY created_at LIMIT 1
    `).first<{ organisationId: string; userId: string }>();
    const projectId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const journeyId = crypto.randomUUID();
    const visualAssetId = crypto.randomUUID();
    const geometryAssetId = crypto.randomUUID();
    const objectKey = `authoring/${membership!.organisationId}/${projectId}/${versionId}/paired.rad`;
    const visualBytes = new Uint8Array([82, 65, 68, 9]);
    const visualSha256 = await sha256Hex(visualBytes);
    const geometrySha256 = "b".repeat(64);
    await env.SPATIAL_ASSETS.put(objectKey, visualBytes);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by)
        VALUES (?, ?, 'Paired authoring fixture', ?, 'QA_REQUIRED', 'fjd-trion',
          'venue-navigator', ?)
      `).bind(
        projectId,
        membership!.organisationId,
        `paired-authoring-${projectId.slice(0, 8)}`,
        membership!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO scene_versions
          (id, project_id, version_number, status, source_provenance_json, created_by)
        VALUES (?, ?, 1, 'QA_REQUIRED', ?, ?)
      `).bind(
        versionId,
        projectId,
        JSON.stringify({
          adapter: "fjd-trion",
          captureJourney: {
            schemaVersion: "paired-capture-journey-v1",
            id: journeyId,
            captureAdapter: "fjd-trion",
            primaryAssetId: visualAssetId,
            geometryAssetId,
            declaration: "same-capture-registered-y-up-metres",
            sourceCoordinateFrameId: `capture-journey:${journeyId}`,
            confirmedBy: membership!.userId,
            confirmedAt: new Date().toISOString(),
          },
        }),
        membership!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, sha256, integrity_status)
        VALUES (?, ?, ?, ?, 'web', 'rad', ?, 'paired.rad',
          'application/octet-stream', ?, ?, 'verified')
      `).bind(
        visualAssetId,
        membership!.organisationId,
        projectId,
        versionId,
        objectKey,
        visualBytes.byteLength,
        visualSha256,
      ),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, sha256, integrity_status)
        VALUES (?, ?, ?, ?, 'pointcloud', 'ply', ?, 'registered-room.ply',
          'application/octet-stream', 128, ?, 'verified')
      `).bind(
        geometryAssetId,
        membership!.organisationId,
        projectId,
        versionId,
        `raw-private/${membership!.organisationId}/${projectId}/${versionId}/${geometryAssetId}/registered-room.ply`,
        geometrySha256,
      ),
    ]);

    const response = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/authoring-renderable?versionId=${versionId}`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      renderable: {
        viewer: {
          sourceToWorld: unknown;
          captureRegistration: Record<string, unknown>;
        };
      };
    }>();
    expect(body.renderable.viewer.sourceToWorld).toEqual({
      sourceUpAxis: "Y",
      worldUnit: "metres",
      metresPerSourceUnit: 1,
      yawDegrees: 0,
      translationMetres: [0, 0, 0],
    });
    expect(body.renderable.viewer.captureRegistration).toMatchObject({
      source: "paired-capture-journey",
      journeyId,
      primaryAssetId: visualAssetId,
      primarySha256: visualSha256,
      evidenceAssetId: geometryAssetId,
      evidenceSha256: geometrySha256,
    });
    expect(body.renderable.viewer.captureRegistration.transformSha256)
      .toMatch(/^[a-f0-9]{64}$/);
    expect(body.renderable.viewer.captureRegistration.receiptSha256)
      .toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unauthenticated tenant APIs", async () => {
    const response = await exports.default.fetch(`${origin}/api/dashboard`);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("publishes only the public ES256 verification key", async () => {
    const response = await exports.default.fetch(`${origin}/.well-known/jwks.json`);
    const body = await response.json<{ keys: Array<Record<string, unknown>> }>();
    expect(response.status).toBe(200);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).toMatchObject({
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
      use: "sig",
      kid: "test-es256-key",
    });
    expect(body.keys[0]).not.toHaveProperty("d");
  });

  it("reports an anonymous session without turning the sign-in screen into a failed request", async () => {
    const response = await exports.default.fetch(`${origin}/api/auth/session`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ authenticated: false });

    const refresh = await exports.default.fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
    });
    expect(refresh.status).toBe(204);
    expect(refresh.headers.get("cache-control")).toBe("private, no-store");
  });

  it("never presents DNS-only custom-domain ownership as active routing", async () => {
    const operatorCookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie: operatorCookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Custom domain ${crypto.randomUUID().slice(0, 8)}`,
        captureAdapter: "open-import",
        deliveryTemplate: "Property showcase",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const project = await projectResponse.json<{ project: { id: string } }>();
    const hostname = `tour-${crypto.randomUUID().slice(0, 8)}.customer.test`;
    const createResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}/domains`,
      {
        method: "POST",
        headers: { cookie: operatorCookie, "content-type": "application/json" },
        body: JSON.stringify({ hostname }),
      },
    );
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json<{
      domain: { id: string; status: string; verificationToken: string };
    }>();
    expect(created.domain.status).toBe("ownership_pending");

    await env.DB.prepare(`
      UPDATE custom_domains
      SET dns_verified_at = datetime('now'), verified_at = datetime('now'),
        status = 'pending', last_error = NULL
      WHERE id = ?
    `).bind(created.domain.id).run();

    const provision = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}/domains/${created.domain.id}/provision`,
      {
        method: "POST",
        headers: { cookie: operatorCookie, "content-type": "application/json" },
      },
    );
    expect(provision.status).toBe(503);
    await expect(provision.json()).resolves.toMatchObject({
      error: expect.stringContaining("not configured"),
      retryable: false,
    });

    const inventory = await exports.default.fetch(
      `${origin}/api/projects/${project.project.id}/domains`,
      { headers: { cookie: operatorCookie } },
    );
    expect(inventory.status).toBe(200);
    await expect(inventory.json()).resolves.toMatchObject({
      providerConfigured: false,
      cnameTarget: "spatial.whymelabs.com",
      domains: [{
        id: created.domain.id,
        hostname,
        status: "provider_configuration_required",
        dnsVerifiedAt: expect.any(String),
        providerHostnameId: null,
      }],
    });
    const stored = await env.DB.prepare(`
      SELECT status, dns_verified_at, provider_hostname_id, provisioned_at
      FROM custom_domains WHERE id = ?
    `).bind(created.domain.id).first<{
      status: string;
      dns_verified_at: string | null;
      provider_hostname_id: string | null;
      provisioned_at: string | null;
    }>();
    expect(stored).toMatchObject({
      status: "pending",
      dns_verified_at: expect.any(String),
      provider_hostname_id: null,
      provisioned_at: null,
    });
  });

  it("retires bootstrap login and consumes each OTP once", async () => {
    const retired = await exports.default.fetch(`${origin}/api/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "legacy-bootstrap-token" }),
    });
    expect(retired.status).toBe(410);
    const session = await loginSession();
    const replay = await exports.default.fetch(`${origin}/api/auth/otp/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: session.email,
        challengeId: session.challengeId,
        code: session.code,
      }),
    });
    expect(replay.status).toBe(401);
  });

  it("rejects stale refreshes without returning current bearers or revoking the session", async () => {
    const session = await loginSession();
    const refresh = await exports.default.fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: session.refreshCookie },
    });
    expect(refresh.status).toBe(200);
    const refreshedCookies = refresh.headers.get("set-cookie") ?? "";
    const newAccess = refreshedCookies.match(/spatial_access=([^;,]+)/)?.[1];
    const newRefresh = refreshedCookies.match(/spatial_refresh=([^;,]+)/)?.[1];
    expect(newAccess).toBeTruthy();
    expect(newRefresh).toBeTruthy();

    // A browser may retry after rotation committed. The stale request receives
    // no current bearer and cannot revoke the winning session.
    const replay = await exports.default.fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: session.refreshCookie },
    });
    expect(replay.status).toBe(409);
    const replayedCookies = replay.headers.get("set-cookie") ?? "";
    expect(replayedCookies).not.toContain("spatial_refresh=");
    expect(replayedCookies).not.toContain("spatial_access=");

    const secondRefresh = await exports.default.fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: `spatial_refresh=${newRefresh}` },
    });
    expect(secondRefresh.status).toBe(200);
    const secondCookies = secondRefresh.headers.get("set-cookie") ?? "";
    const latestAccess = secondCookies.match(/spatial_access=([^;,]+)/)?.[1];
    expect(latestAccess).toBeTruthy();

    const historicalReplay = await exports.default.fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: session.refreshCookie },
    });
    expect(historicalReplay.status).toBe(409);
    expect(historicalReplay.headers.get("set-cookie") ?? "").not.toContain("spatial_refresh=");

    const survivingAccess = await exports.default.fetch(`${origin}/api/dashboard`, {
      headers: { cookie: `spatial_access=${latestAccess}` },
    });
    expect(survivingAccess.status).toBe(200);
  });

  it("does not let a stolen rotated refresh token recover the current bearer", async () => {
    const session = await loginSession();
    const first = await exports.default.fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: session.refreshCookie },
    });
    expect(first.status).toBe(200);
    const cookies = first.headers.get("set-cookie") ?? "";
    const currentRefresh = cookies.match(/spatial_refresh=([^;,]+)/)?.[1];
    expect(currentRefresh).toBeTruthy();

    const stolenReplay = await exports.default.fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: session.refreshCookie.split("; ")[0] },
    });
    expect(stolenReplay.status).toBe(409);
    expect(stolenReplay.headers.get("set-cookie") ?? "").not.toContain("spatial_refresh=");

    const legitimate = await exports.default.fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: `spatial_refresh=${currentRefresh}` },
    });
    expect(legitimate.status).toBe(200);
  });

  it("keeps one browser session alive when two tabs refresh concurrently", async () => {
    const session = await loginSession();
    const [first, second] = await Promise.all([
      exports.default.fetch(`${origin}/api/auth/refresh`, {
        method: "POST",
        headers: { cookie: session.refreshCookie },
      }),
      exports.default.fetch(`${origin}/api/auth/refresh`, {
        method: "POST",
        headers: { cookie: session.refreshCookie },
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winning = first.status === 200 ? first : second;
    const stale = first.status === 409 ? first : second;
    expect(winning.headers.get("set-cookie") ?? "").toContain("spatial_refresh=");
    expect(stale.headers.get("set-cookie") ?? "").not.toContain("spatial_refresh=");
  });

  it("classifies malformed and oversized JSON bodies instead of failing the request", async () => {
    const malformed = await exports.default.fetch(`${origin}/api/auth/otp/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Connecting-IP": nextTestClientAddress(),
      },
      body: "{not valid json",
    });
    expect(malformed.status).toBe(400);
    const malformedBody = await malformed.json<{ code?: string; requestId?: string }>();
    expect(malformedBody.code).toBe("invalid_json");
    expect(malformedBody.requestId).toBeTruthy();

    const oversized = await exports.default.fetch(`${origin}/api/auth/otp/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Connecting-IP": nextTestClientAddress(),
      },
      body: JSON.stringify({
        email: "reviewer@example.com",
        challengeId: crypto.randomUUID(),
        code: "9".repeat(1024 * 1024 + 64),
      }),
    });
    expect(oversized.status).toBe(413);
    const oversizedBody = await oversized.json<{ code?: string; requestId?: string }>();
    expect(oversizedBody.code).toBe("request_body_too_large");
    expect(oversizedBody.requestId).toBeTruthy();
  });

  it("rate limits refresh attempts per address with the real window in Retry-After", async () => {
    const clientAddress = nextTestClientAddress();
    const windowStart = Math.floor(Date.now() / 1000 / 600) * 600;
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO rate_limits (bucket, subject, window_start, request_count)
        VALUES ('refresh-ip', ?, ?, 60)
      `).bind(clientAddress, windowStart),
      env.DB.prepare(`
        INSERT INTO rate_limits (bucket, subject, window_start, request_count)
        VALUES ('refresh-ip', ?, ?, 60)
      `).bind(clientAddress, windowStart + 600),
    ]);

    const denied = await exports.default.fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
      headers: { "CF-Connecting-IP": clientAddress },
    });
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBe("600");

    const freshAddress = await exports.default.fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
      headers: { "CF-Connecting-IP": nextTestClientAddress() },
    });
    expect(freshAddress.status).toBe(204);
  });

  it("rejects declared cross-origin writes while keeping non-browser clients working", async () => {
    const crossOrigin = await exports.default.fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "CF-Connecting-IP": nextTestClientAddress(),
      },
    });
    expect(crossOrigin.status).toBe(403);

    const crossSite = await exports.default.fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "cross-site",
        "CF-Connecting-IP": nextTestClientAddress(),
      },
    });
    expect(crossSite.status).toBe(403);

    const canonical = await exports.default.fetch(`${origin}/api/auth/refresh`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
        "CF-Connecting-IP": nextTestClientAddress(),
      },
    });
    expect(canonical.status).toBe(204);
  });

  it("manages organisation invitations and invalidates access across role lifecycle changes", async () => {
    const administrator = await loginSession();
    const teammateEmail = `operator-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const clientOperationId = crypto.randomUUID();
    const invitationBody = JSON.stringify({
      clientOperationId,
      email: teammateEmail,
      role: "production_operator",
      expiresInDays: 7,
    });

    const invitationResponse = await exports.default.fetch(`${origin}/api/team/invitations`, {
      method: "POST",
      headers: {
        cookie: administrator.accessCookie,
        "content-type": "application/json",
      },
      body: invitationBody,
    });
    expect(invitationResponse.status).toBe(201);
    const invitation = await invitationResponse.json<{
      invitation: { id: string; userId: string; status: string; deliveryStatus: string };
    }>();
    expect(invitation.invitation).toMatchObject({
      status: "pending",
      deliveryStatus: "sent",
    });

    const repeatedInvitation = await exports.default.fetch(`${origin}/api/team/invitations`, {
      method: "POST",
      headers: {
        cookie: administrator.accessCookie,
        "content-type": "application/json",
      },
      body: invitationBody,
    });
    expect(repeatedInvitation.status).toBe(200);
    await expect(repeatedInvitation.json()).resolves.toMatchObject({
      invitation: { id: invitation.invitation.id },
      idempotent: true,
    });

    const teamBeforeSignIn = await exports.default.fetch(`${origin}/api/team`, {
      headers: { cookie: administrator.accessCookie },
    });
    expect(teamBeforeSignIn.status).toBe(200);
    const teamBefore = await teamBeforeSignIn.json<{
      members: Array<Record<string, unknown>>;
      invitations: Array<Record<string, unknown>>;
    }>();
    expect(teamBefore.members.find((member) => member.userId === invitation.invitation.userId)).toMatchObject({
      email: teammateEmail,
      role: "production_operator",
      status: "invited",
    });
    expect(teamBefore.invitations.find((item) => item.id === invitation.invitation.id)).toMatchObject({
      status: "pending",
    });

    const teammate = await loginSession(teammateEmail);
    const operatorTeamAttempt = await exports.default.fetch(`${origin}/api/team`, {
      headers: { cookie: teammate.accessCookie },
    });
    expect(operatorTeamAttempt.status).toBe(403);

    const acceptedTeam = await exports.default.fetch(`${origin}/api/team`, {
      headers: { cookie: administrator.accessCookie },
    });
    const accepted = await acceptedTeam.json<{
      members: Array<Record<string, unknown>>;
      invitations: Array<Record<string, unknown>>;
    }>();
    expect(accepted.members.find((member) => member.userId === invitation.invitation.userId)).toMatchObject({
      status: "active",
    });
    expect(accepted.invitations.find((item) => item.id === invitation.invitation.id)).toMatchObject({
      status: "accepted",
    });

    const promoteResponse = await exports.default.fetch(
      `${origin}/api/team/members/${invitation.invitation.userId}`,
      {
        method: "PATCH",
        headers: {
          cookie: administrator.accessCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "platform_admin" }),
      },
    );
    expect(promoteResponse.status).toBe(200);
    await expect(promoteResponse.json()).resolves.toMatchObject({
      member: { role: "platform_admin", status: "active" },
    });

    const staleAccess = await exports.default.fetch(`${origin}/api/dashboard`, {
      headers: { cookie: teammate.accessCookie },
    });
    expect(staleAccess.status).toBe(401);
    const promoted = await loginSession(teammateEmail);

    const selfDemotion = await exports.default.fetch(
      `${origin}/api/team/members/${invitation.invitation.userId}`,
      {
        method: "PATCH",
        headers: {
          cookie: promoted.accessCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "production_operator" }),
      },
    );
    expect(selfDemotion.status).toBe(409);

    const revokeResponse = await exports.default.fetch(
      `${origin}/api/team/members/${invitation.invitation.userId}`,
      {
        method: "DELETE",
        headers: { cookie: administrator.accessCookie },
      },
    );
    expect(revokeResponse.status).toBe(204);
    const revokedAccess = await exports.default.fetch(`${origin}/api/dashboard`, {
      headers: { cookie: promoted.accessCookie },
    });
    expect(revokedAccess.status).toBe(401);
    expect((await verifyOtp(teammateEmail)).status).toBe(401);

    const reinvite = await exports.default.fetch(`${origin}/api/team/invitations`, {
      method: "POST",
      headers: {
        cookie: administrator.accessCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        email: teammateEmail,
        role: "production_operator",
        expiresInDays: 7,
      }),
    });
    expect(reinvite.status).toBe(201);
    expect((await verifyOtp(teammateEmail)).status).toBe(200);

    const selfRevoke = await exports.default.fetch(
      `${origin}/api/team/members/00000000-0000-4000-8000-000000000002`,
      {
        method: "DELETE",
        headers: { cookie: administrator.accessCookie },
      },
    );
    expect(selfRevoke.status).toBe(409);

    const expiringEmail = `expired-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const expiringInvitation = await exports.default.fetch(`${origin}/api/team/invitations`, {
      method: "POST",
      headers: {
        cookie: administrator.accessCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        email: expiringEmail,
        role: "production_operator",
        expiresInDays: 1,
      }),
    });
    expect(expiringInvitation.status).toBe(201);
    await env.DB.prepare(`
      UPDATE organisation_invitations SET expires_at = datetime('now', '-1 minute')
      WHERE lower(email) = lower(?)
    `).bind(expiringEmail).run();
    const lifecycle = await exports.default.fetch(`${origin}/api/hosting/lifecycle/run`, {
      method: "POST",
      headers: { cookie: administrator.accessCookie },
    });
    expect(lifecycle.status).toBe(200);
    await expect(lifecycle.json()).resolves.toMatchObject({
      summary: { invitationsExpired: 1 },
    });
    expect((await verifyOtp(expiringEmail)).status).toBe(401);
  });

  it("accepts memberships in multiple organisations and rotates the session when switching", async () => {
    const administrator = await loginSession();
    const administratorUserId = "00000000-0000-4000-8000-000000000002";
    const primaryOrganisationId = "00000000-0000-4000-8000-000000000001";
    const secondOrganisationId = crypto.randomUUID();
    const inaccessibleOrganisationId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO organisations (id, name, slug, created_at) VALUES (?, 'Field operations', ?, ?)",
      ).bind(secondOrganisationId, `field-${secondOrganisationId.slice(0, 8)}`, now),
      env.DB.prepare(
        "INSERT INTO organisations (id, name, slug, created_at) VALUES (?, 'Restricted tenant', ?, ?)",
      ).bind(inaccessibleOrganisationId, `restricted-${inaccessibleOrganisationId.slice(0, 8)}`, now),
      env.DB.prepare(`
        INSERT INTO memberships
          (organisation_id, user_id, role, created_at, updated_at, status)
        VALUES (?, ?, 'production_operator', ?, ?, 'active')
      `).bind(secondOrganisationId, administratorUserId, now, now),
    ]);

    const organisationsResponse = await exports.default.fetch(`${origin}/api/auth/organisations`, {
      headers: { cookie: administrator.accessCookie },
    });
    expect(organisationsResponse.status).toBe(200);
    await expect(organisationsResponse.json()).resolves.toMatchObject({
      currentOrganisationId: primaryOrganisationId,
      organisations: expect.arrayContaining([
        expect.objectContaining({
          id: primaryOrganisationId,
          name: "Spatial Studio",
          role: "platform_admin",
          current: true,
        }),
        expect.objectContaining({
          id: secondOrganisationId,
          name: "Field operations",
          role: "production_operator",
          current: false,
        }),
      ]),
    });

    const forbiddenSwitch = await exports.default.fetch(`${origin}/api/auth/organisations/switch`, {
      method: "POST",
      headers: {
        cookie: administrator.accessCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ organisationId: inaccessibleOrganisationId }),
    });
    expect(forbiddenSwitch.status).toBe(403);
    expect((await exports.default.fetch(`${origin}/api/dashboard`, {
      headers: { cookie: administrator.accessCookie },
    })).status).toBe(200);

    const switchedResponse = await exports.default.fetch(`${origin}/api/auth/organisations/switch`, {
      method: "POST",
      headers: {
        cookie: administrator.accessCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ organisationId: secondOrganisationId }),
    });
    expect(switchedResponse.status).toBe(200);
    await expect(switchedResponse.clone().json()).resolves.toMatchObject({
      user: {
        userId: administratorUserId,
        organisationId: secondOrganisationId,
        role: "production_operator",
      },
      organisation: {
        id: secondOrganisationId,
        name: "Field operations",
      },
    });
    const switchedCookieHeader = switchedResponse.headers.get("set-cookie");
    const switchedAccess = switchedCookieHeader?.match(/spatial_access=([^;,]+)/)?.[1];
    const switchedRefresh = switchedCookieHeader?.match(/spatial_refresh=([^;,]+)/)?.[1];
    expect(switchedAccess).toBeTruthy();
    expect(switchedRefresh).toBeTruthy();
    expect((await exports.default.fetch(`${origin}/api/dashboard`, {
      headers: { cookie: administrator.accessCookie },
    })).status).toBe(401);
    const switchedSession = await exports.default.fetch(`${origin}/api/auth/session`, {
      headers: { cookie: `spatial_access=${switchedAccess}` },
    });
    expect(switchedSession.status).toBe(200);
    await expect(switchedSession.json()).resolves.toMatchObject({
      authenticated: true,
      user: {
        organisationId: secondOrganisationId,
        role: "production_operator",
      },
    });

    const multiOrganisationEmail = `multi-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const multiOrganisationUserId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, 'Multi tenant operator', ?)",
      ).bind(multiOrganisationUserId, multiOrganisationEmail, now),
      env.DB.prepare(`
        INSERT INTO memberships
          (organisation_id, user_id, role, created_at, updated_at, status)
        VALUES (?, ?, 'production_operator', ?, ?, 'active')
      `).bind(secondOrganisationId, multiOrganisationUserId, now, now),
    ]);
    const primaryInvitation = await exports.default.fetch(`${origin}/api/team/invitations`, {
      method: "POST",
      headers: {
        cookie: (await loginSession()).accessCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        email: multiOrganisationEmail,
        role: "production_operator",
        expiresInDays: 7,
      }),
    });
    expect(primaryInvitation.status).toBe(201);
    const primaryInvitationBody = await primaryInvitation.json<{ invitation: { id: string } }>();
    // An account that already belongs to an organisation is never enrolled
    // silently: the invitation stays pending until it is answered explicitly.
    const multiOrganisationSession = await loginSession(multiOrganisationEmail);
    const membershipsBeforeConsent = await exports.default.fetch(`${origin}/api/auth/organisations`, {
      headers: { cookie: multiOrganisationSession.accessCookie },
    });
    expect(membershipsBeforeConsent.status).toBe(200);
    const pendingMemberships = await membershipsBeforeConsent.json<{
      organisations: Array<{ id: string }>;
    }>();
    expect(pendingMemberships.organisations.map((organisation) => organisation.id)).toEqual([
      secondOrganisationId,
    ]);
    const pendingSession = await exports.default.fetch(`${origin}/api/auth/session`, {
      headers: { cookie: multiOrganisationSession.accessCookie },
    });
    expect(pendingSession.status).toBe(200);
    await expect(pendingSession.json()).resolves.toMatchObject({
      pendingInvitations: [
        {
          id: primaryInvitationBody.invitation.id,
          organisationId: primaryOrganisationId,
          role: "production_operator",
        },
      ],
    });

    const acceptedInvitation = await exports.default.fetch(
      `${origin}/api/team/invitations/${primaryInvitationBody.invitation.id}/accept`,
      {
        method: "POST",
        headers: { cookie: multiOrganisationSession.accessCookie, origin },
      },
    );
    expect(acceptedInvitation.status).toBe(200);
    await expect(acceptedInvitation.json()).resolves.toMatchObject({
      invitation: { organisationId: primaryOrganisationId, status: "accepted" },
    });
    const repeatedAcceptance = await exports.default.fetch(
      `${origin}/api/team/invitations/${primaryInvitationBody.invitation.id}/accept`,
      {
        method: "POST",
        headers: { cookie: multiOrganisationSession.accessCookie, origin },
      },
    );
    expect(repeatedAcceptance.status).toBe(404);
    const membershipsAfterAcceptance = await exports.default.fetch(`${origin}/api/auth/organisations`, {
      headers: { cookie: multiOrganisationSession.accessCookie },
    });
    expect(membershipsAfterAcceptance.status).toBe(200);
    const membershipsBody = await membershipsAfterAcceptance.json<{
      organisations: Array<{ id: string }>;
    }>();
    expect(membershipsBody.organisations.map((organisation) => organisation.id)).toEqual(
      expect.arrayContaining([primaryOrganisationId, secondOrganisationId]),
    );
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'team.invitation_accept' AND resource_id = ?",
    ).bind(primaryInvitationBody.invitation.id).first<{ count: number }>()).toMatchObject({ count: 1 });
  });

  it("declines a tenant invitation without enrolling the invitee", async () => {
    const administratorCookie = await login();
    const invitedEmail = `decline-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const invitedUserId = crypto.randomUUID();
    const otherOrganisationId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO organisations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
      ).bind(otherOrganisationId, "Decline tenant", `decline-${otherOrganisationId.slice(0, 8)}`, now),
      env.DB.prepare(
        "INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, 'Declining operator', ?)",
      ).bind(invitedUserId, invitedEmail, now),
      env.DB.prepare(`
        INSERT INTO memberships
          (organisation_id, user_id, role, created_at, updated_at, status)
        VALUES (?, ?, 'production_operator', ?, ?, 'active')
      `).bind(otherOrganisationId, invitedUserId, now, now),
    ]);
    const invitation = await exports.default.fetch(`${origin}/api/team/invitations`, {
      method: "POST",
      headers: { cookie: administratorCookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        email: invitedEmail,
        role: "production_operator",
        expiresInDays: 7,
      }),
    });
    expect(invitation.status).toBe(201);
    const invitationId = (await invitation.json<{ invitation: { id: string } }>()).invitation.id;
    const invitedSession = await loginSession(invitedEmail);
    const declined = await exports.default.fetch(
      `${origin}/api/team/invitations/${invitationId}/decline`,
      { method: "POST", headers: { cookie: invitedSession.accessCookie, origin } },
    );
    expect(declined.status).toBe(200);
    await expect(declined.json()).resolves.toMatchObject({
      invitation: { id: invitationId, status: "declined" },
    });
    expect(await env.DB.prepare(
      "SELECT status FROM organisation_invitations WHERE id = ?",
    ).bind(invitationId).first<{ status: string }>()).toMatchObject({ status: "declined" });
    expect(await env.DB.prepare(
      "SELECT status FROM memberships WHERE user_id = ? AND organisation_id != ?",
    ).bind(invitedUserId, otherOrganisationId).first<{ status: string }>()).toMatchObject({
      status: "revoked",
    });
    const sessionAfterDecline = await exports.default.fetch(`${origin}/api/auth/session`, {
      headers: { cookie: invitedSession.accessCookie },
    });
    await expect(sessionAfterDecline.json()).resolves.toMatchObject({ pendingInvitations: [] });
  });

  it("creates projects and enforces tenant isolation", async () => {
    const cookie = await login();
    const clientOperationId = crypto.randomUUID();
    const projectBody = JSON.stringify({
      clientOperationId,
      name: "Test apartment",
      captureAdapter: "open-import",
      deliveryTemplate: "property-tour",
    });
    const createResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: projectBody,
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json<{ project: { id: string } }>();
    const repeatedCreateResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: projectBody,
    });
    expect(repeatedCreateResponse.status).toBe(200);
    await expect(repeatedCreateResponse.json()).resolves.toMatchObject({
      project: { id: created.project.id },
      idempotent: true,
    });

    const otherOrganisationId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const otherSessionId = crypto.randomUUID();
    const otherRefreshHash = await sha256Hex("other-refresh:test-refresh-pepper");
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const now = new Date().toISOString();

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO organisations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
      ).bind(otherOrganisationId, "Other organisation", "other-org", now),
      env.DB.prepare(
        "INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)",
      ).bind(otherUserId, "other@example.com", "Other", now),
      env.DB.prepare(
        "INSERT INTO memberships (organisation_id, user_id, role, created_at) VALUES (?, ?, 'customer_readonly', ?)",
      ).bind(otherOrganisationId, otherUserId, now),
      env.DB.prepare(`
        INSERT INTO auth_sessions
          (id, user_id, organisation_id, refresh_token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        otherSessionId,
        otherUserId,
        otherOrganisationId,
        otherRefreshHash,
        expiresAt,
        now,
      ),
    ]);
    const otherAuth = {
      userId: otherUserId,
      organisationId: otherOrganisationId,
      email: "other@example.com",
      displayName: "Other",
      role: "customer_readonly" as const,
    };
    const otherTokens = await issueAuthTokens(env, otherAuth, otherSessionId, "other-refresh");

    const isolatedResponse = await exports.default.fetch(
      `${origin}/api/projects/${created.project.id}`,
      {
        headers: { cookie: `spatial_access=${otherTokens.accessToken}` },
      },
    );

    expect(isolatedResponse.status).toBe(404);
  });

  it("runs a platform-admin manual invoice lifecycle without granting unpaid entitlement", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Manual billing ${crypto.randomUUID().slice(0, 8)}`,
        customerName: "Spatial Merchant",
        customerEmail: "accounts@example.com",
        captureAdapter: "open-import",
        deliveryTemplate: "Venue navigator",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const project = await projectResponse.json<{ project: { id: string } }>();
    const periodStart = new Date().toISOString();
    const periodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const dueAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const clientOperationId = crypto.randomUUID();
    const issueBody = {
      clientOperationId,
      projectId: project.project.id,
      planCode: "venue",
      amountCents: 49_900,
      currency: "MYR",
      periodStart,
      periodEnd,
      dueAt,
      archiveOnExpiry: true,
      externalReference: "INV-TEST-001",
      note: "Bank transfer due within seven days.",
    };
    const operatorUserId = crypto.randomUUID();
    const operatorSessionId = crypto.randomUUID();
    const operatorEmail = `billing-operator-${operatorUserId.slice(0, 8)}@example.com`;
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, display_name)
        VALUES (?, ?, 'Billing operator')
      `).bind(operatorUserId, operatorEmail),
      env.DB.prepare(`
        INSERT INTO memberships
          (organisation_id, user_id, role, status, updated_at)
        VALUES ('00000000-0000-4000-8000-000000000001', ?,
          'production_operator', 'active', datetime('now'))
      `).bind(operatorUserId),
      env.DB.prepare(`
        INSERT INTO auth_sessions
          (id, user_id, organisation_id, refresh_token_hash, expires_at)
        VALUES (?, ?, '00000000-0000-4000-8000-000000000001', ?,
          datetime('now', '+1 day'))
      `).bind(
        operatorSessionId,
        operatorUserId,
        crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"),
      ),
    ]);
    const operatorTokens = await issueAuthTokens(env, {
      userId: operatorUserId,
      organisationId: "00000000-0000-4000-8000-000000000001",
      email: operatorEmail,
      displayName: "Billing operator",
      role: "production_operator",
    }, operatorSessionId);
    const forbiddenIssue = await exports.default.fetch(`${origin}/api/admin/billing/invoices`, {
      method: "POST",
      headers: {
        cookie: `spatial_access=${operatorTokens.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(issueBody),
    });
    expect(forbiddenIssue.status).toBe(403);

    const issue = await exports.default.fetch(`${origin}/api/admin/billing/invoices`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(issueBody),
    });
    expect(issue.status).toBe(201);
    const issued = await issue.json<{
      idempotent: boolean;
      invoice: { id: string; status: string; billing_method: string };
      subscription: { id: string; status: string; payment_provider: string };
    }>();
    expect(issued).toMatchObject({
      idempotent: false,
      invoice: { status: "open", billing_method: "manual" },
      subscription: { status: "past_due", payment_provider: "manual" },
    });

    const replay = await exports.default.fetch(`${origin}/api/admin/billing/invoices`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(issueBody),
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      idempotent: true,
      invoice: { id: issued.invoice.id, status: "open" },
      subscription: { id: issued.subscription.id, status: "past_due" },
    });

    const missingReference = await exports.default.fetch(
      `${origin}/api/admin/billing/invoices/${issued.invoice.id}/transition`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          status: "paid",
        }),
      },
    );
    expect(missingReference.status).toBe(400);

    const paidOperationId = crypto.randomUUID();
    const paidBody = {
      clientOperationId: paidOperationId,
      status: "paid",
      paymentReference: "MBB-20260728-123456",
      note: "Verified against the merchant bank statement.",
    };
    const paid = await exports.default.fetch(
      `${origin}/api/admin/billing/invoices/${issued.invoice.id}/transition`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(paidBody),
      },
    );
    expect(paid.status).toBe(200);
    await expect(paid.json()).resolves.toMatchObject({
      idempotent: false,
      invoice: {
        id: issued.invoice.id,
        status: "paid",
        payment_reference: paidBody.paymentReference,
      },
      subscription: { id: issued.subscription.id, status: "active" },
    });

    const paidReplay = await exports.default.fetch(
      `${origin}/api/admin/billing/invoices/${issued.invoice.id}/transition`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(paidBody),
      },
    );
    expect(paidReplay.status).toBe(200);
    await expect(paidReplay.json()).resolves.toMatchObject({ idempotent: true });

    const voidPaid = await exports.default.fetch(
      `${origin}/api/admin/billing/invoices/${issued.invoice.id}/transition`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          status: "void",
          note: "Should be rejected because collection was already recorded.",
        }),
      },
    );
    expect(voidPaid.status).toBe(409);

    const cancel = await exports.default.fetch(
      `${origin}/api/admin/billing/subscriptions/${issued.subscription.id}/transition`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          status: "cancelled",
          note: "Customer requested termination after the current paid period.",
        }),
      },
    );
    expect(cancel.status).toBe(200);
    await expect(cancel.json()).resolves.toMatchObject({
      subscription: { id: issued.subscription.id, status: "cancelled" },
    });

    const workspaceResponse = await exports.default.fetch(`${origin}/api/hosting`, {
      headers: { cookie },
    });
    expect(workspaceResponse.status).toBe(200);
    const workspace = await workspaceResponse.json<{
      manualBillingEnabled: boolean;
      invoices: Array<{ id: string; status: string; billing_method: string }>;
    }>();
    expect(workspace.manualBillingEnabled).toBe(true);
    expect(workspace.invoices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: issued.invoice.id,
        status: "paid",
        billing_method: "manual",
      }),
    ]));

    const operationCount = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM billing_manual_operations
      WHERE invoice_id = ? OR subscription_id = ?
    `).bind(issued.invoice.id, issued.subscription.id).first<{ count: number }>();
    expect(operationCount?.count).toBe(3);
  });

  it("blocks managed-hosting projects from publication until hosting is active", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Managed venue ${crypto.randomUUID().slice(0, 8)}`,
        captureAdapter: "open-import",
        deliveryTemplate: "Venue navigator",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const publicationRequest = {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        slug: `managed-venue-${crypto.randomUUID().slice(0, 8)}`,
        accessPolicy: "public",
        viewerConfig: {
          title: "Managed venue",
          measurementDisclaimer: VISUAL_ONLY_MEASUREMENT_DISCLAIMER,
        },
      }),
    };
    const blocked = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      publicationRequest,
    );
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({
      error: expect.stringContaining("requires active managed hosting"),
    });

    await env.DB.prepare(`
      INSERT INTO project_hosting_subscriptions (
        id, organisation_id, project_id, plan_code, status,
        current_period_start, current_period_end, renews_automatically,
        archive_on_expiry, created_by
      )
      SELECT ?, organisation_id, id, 'venue', 'active', datetime('now'),
        datetime('now', '+1 day'), 0, 1, created_by
      FROM projects WHERE id = ?
    `).bind(crypto.randomUUID(), project.id).run();
    const pastHostingGate = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      publicationRequest,
    );
    expect(pastHostingGate.status).toBe(400);
    await expect(pastHostingGate.json()).resolves.toMatchObject({
      details: { project: [expect.stringContaining("no approved scene version")] },
    });
  });

  it("keeps one live hosting subscription per project across repeated manual invoices", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Recurring billing ${crypto.randomUUID().slice(0, 8)}`,
        customerName: "Spatial Merchant",
        customerEmail: "accounts@example.com",
        captureAdapter: "open-import",
        deliveryTemplate: "Venue navigator",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const projectId = (await projectResponse.json<{ project: { id: string } }>()).project.id;
    const issueInvoice = async (amountCents: number, reference: string) => {
      const periodStart = new Date().toISOString();
      const periodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
      return exports.default.fetch(`${origin}/api/admin/billing/invoices`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          projectId,
          planCode: "venue",
          amountCents,
          currency: "MYR",
          periodStart,
          periodEnd,
          dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          archiveOnExpiry: true,
          externalReference: reference,
        }),
      });
    };
    const first = await issueInvoice(49_900, "INV-RECUR-001");
    expect(first.status).toBe(201);
    const firstBody = await first.json<{
      invoice: { id: string };
      subscription: { id: string };
    }>();
    const second = await issueInvoice(59_900, "INV-RECUR-002");
    expect(second.status).toBe(201);
    const secondBody = await second.json<{
      invoice: { id: string };
      subscription: { id: string };
    }>();
    // A second billing period attaches to the same non-terminal subscription
    // instead of inserting a duplicate that cancellation would then pick between.
    expect(secondBody.subscription.id).toBe(firstBody.subscription.id);
    expect(secondBody.invoice.id).not.toBe(firstBody.invoice.id);
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM project_hosting_subscriptions
      WHERE project_id = ? AND status IN ('active', 'past_due')
    `).bind(projectId).first<{ count: number }>()).toMatchObject({ count: 1 });
    // The audit rows ride in the same batch as the mutation they record.
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM audit_events
      WHERE action = 'billing.manual.invoice.issue' AND resource_id IN (?, ?)
    `).bind(firstBody.invoice.id, secondBody.invoice.id).first<{ count: number }>())
      .toMatchObject({ count: 2 });

    const cancelled = await exports.default.fetch(
      `${origin}/api/admin/billing/subscriptions/${firstBody.subscription.id}/transition`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          status: "cancelled",
          note: "Merchant closed the venue.",
        }),
      },
    );
    expect(cancelled.status).toBe(200);
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM project_hosting_subscriptions
      WHERE project_id = ? AND status IN ('active', 'past_due')
    `).bind(projectId).first<{ count: number }>()).toMatchObject({ count: 0 });

    // A subsequent invoice opens exactly one replacement subscription, so the
    // partial unique index still holds.
    const third = await issueInvoice(69_900, "INV-RECUR-003");
    expect(third.status).toBe(201);
    const thirdBody = await third.json<{ subscription: { id: string } }>();
    expect(thirdBody.subscription.id).not.toBe(firstBody.subscription.id);
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM project_hosting_subscriptions
      WHERE project_id = ? AND status IN ('active', 'past_due')
    `).bind(projectId).first<{ count: number }>()).toMatchObject({ count: 1 });
  });

  it("manages project metadata and preserves lifecycle state across archive and restore", async () => {
    const cookie = await login();
    const createResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Heritage gallery",
        captureAdapter: "open-import",
        deliveryTemplate: "property-tour",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json<{ project: { id: string } }>();

    const updateResponse = await exports.default.fetch(
      `${origin}/api/projects/${created.project.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Heritage gallery archive",
          customerName: "City Museum",
          customerEmail: "collections@museum.example",
          captureAdapter: "fjd-trion",
          deliveryTemplate: "Venue navigator",
          notes: "Keep metric masters and a public web derivative.",
        }),
      },
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      project: {
        id: created.project.id,
        name: "Heritage gallery archive",
        customerName: "City Museum",
        customerEmail: "collections@museum.example",
        captureAdapter: "fjd-trion",
        deliveryTemplate: "Venue navigator",
        notes: "Keep metric masters and a public web derivative.",
        status: "DRAFT",
      },
    });

    const emailOnlyResponse = await exports.default.fetch(
      `${origin}/api/projects/${created.project.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ customerEmail: "archives@museum.example" }),
      },
    );
    expect(emailOnlyResponse.status).toBe(200);
    await expect(emailOnlyResponse.json()).resolves.toMatchObject({
      project: {
        customerName: "City Museum",
        customerEmail: "archives@museum.example",
      },
    });

    const customerNameOnlyResponse = await exports.default.fetch(
      `${origin}/api/projects/${created.project.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ customerName: "City Museum" }),
      },
    );
    expect(customerNameOnlyResponse.status).toBe(200);
    await expect(customerNameOnlyResponse.json()).resolves.toMatchObject({
      project: {
        customerName: "City Museum",
        customerEmail: "archives@museum.example",
      },
    });

    const archiveResponse = await exports.default.fetch(
      `${origin}/api/projects/${created.project.id}/archive`,
      { method: "POST", headers: { cookie } },
    );
    expect(archiveResponse.status).toBe(200);
    await expect(archiveResponse.json()).resolves.toMatchObject({
      project: { id: created.project.id, status: "ARCHIVED" },
    });

    const restoreResponse = await exports.default.fetch(
      `${origin}/api/projects/${created.project.id}/restore`,
      { method: "POST", headers: { cookie } },
    );
    expect(restoreResponse.status).toBe(200);
    await expect(restoreResponse.json()).resolves.toMatchObject({
      project: { id: created.project.id, status: "DRAFT" },
    });

    const sharedCustomerResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Museum west wing",
        customerName: "City Museum",
        captureAdapter: "fjd-trion",
        deliveryTemplate: "Venue navigator",
      }),
    });
    expect(sharedCustomerResponse.status).toBe(201);
  });

  it("applies idempotent tenant-scoped bulk project lifecycle changes with per-project outcomes", async () => {
    const cookie = await login();
    const createProject = async (name: string) => {
      const response = await exports.default.fetch(`${origin}/api/projects`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          name,
          captureAdapter: "open-import",
          deliveryTemplate: "Property showcase",
        }),
      });
      expect(response.status).toBe(201);
      return (await response.json<{ project: { id: string } }>()).project;
    };
    const first = await createProject("Bulk lifecycle first");
    const second = await createProject("Bulk lifecycle second");

    const alreadyArchived = await exports.default.fetch(
      `${origin}/api/projects/${first.id}/archive`,
      { method: "POST", headers: { cookie } },
    );
    expect(alreadyArchived.status).toBe(200);

    const operationId = crypto.randomUUID();
    const requestBody = {
      clientOperationId: operationId,
      action: "archive",
      projectIds: [second.id, first.id, second.id],
    };
    const response = await exports.default.fetch(`${origin}/api/projects/bulk-lifecycle`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    expect(response.status).toBe(200);
    const result = await response.json<{
      operationId: string;
      clientOperationId: string;
      action: string;
      requestedCount: number;
      summary: { changed: number; unchanged: number; blocked: number; notFound: number };
      results: Array<{ projectId: string; outcome: string; status?: string }>;
    }>();
    expect(result).toMatchObject({
      clientOperationId: operationId,
      action: "archive",
      requestedCount: 2,
      summary: { changed: 1, unchanged: 1, blocked: 0, notFound: 0 },
    });
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: first.id, outcome: "unchanged", status: "ARCHIVED" }),
      expect.objectContaining({ projectId: second.id, outcome: "changed", status: "ARCHIVED" }),
    ]));

    const repeated = await exports.default.fetch(`${origin}/api/projects/bulk-lifecycle`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    expect(repeated.status).toBe(200);
    await expect(repeated.json()).resolves.toMatchObject({
      clientOperationId: operationId,
      idempotent: true,
      summary: { changed: 1, unchanged: 1 },
    });

    const conflicting = await exports.default.fetch(`${origin}/api/projects/bulk-lifecycle`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: operationId,
        action: "restore",
        projectIds: [first.id, second.id],
      }),
    });
    expect(conflicting.status).toBe(409);

    const missingId = crypto.randomUUID();
    const restore = await exports.default.fetch(`${origin}/api/projects/bulk-lifecycle`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        action: "restore",
        projectIds: [first.id, second.id, missingId],
      }),
    });
    expect(restore.status).toBe(200);
    await expect(restore.json()).resolves.toMatchObject({
      requestedCount: 3,
      summary: { changed: 2, unchanged: 0, blocked: 0, notFound: 1 },
      results: expect.arrayContaining([
        expect.objectContaining({ projectId: missingId, outcome: "not_found" }),
      ]),
    });

    const projectRows = await env.DB.prepare(
      "SELECT id, status FROM projects WHERE id IN (?, ?) ORDER BY id",
    ).bind(first.id, second.id).all<{ id: string; status: string }>();
    expect(projectRows.results).toHaveLength(2);
    expect(projectRows.results.every((project) => project.status === "DRAFT")).toBe(true);

    const operationRows = await env.DB.prepare(
      "SELECT status, request_hash, response_json FROM project_bulk_operations WHERE client_operation_id = ?",
    ).bind(operationId).all<{ status: string; request_hash: string; response_json: string }>();
    expect(operationRows.results).toHaveLength(1);
    expect(operationRows.results[0]).toMatchObject({ status: "completed" });
    expect(operationRows.results[0]!.request_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(operationRows.results[0]!.response_json)).toMatchObject({
      action: "archive",
      requestedCount: 2,
    });
  });

  it("manages templates and saved views and performs a previewed idempotent portfolio round trip", async () => {
    const cookie = await login();
    const templateOperationId = crypto.randomUUID();
    const templateBody = {
      clientOperationId: templateOperationId,
      name: "Premium venue",
      description: "Reusable venue defaults",
      captureAdapter: "fjd-trion",
      deliveryTemplate: "Venue navigator",
      notes: "Capture public routes before staff-only areas.",
      policy: {
        schemaVersion: "project-workflow-policy-v1",
        privacyReview: "strict",
        publication: "private-review",
        navigation: "visitor-walk",
        measurement: "controlled",
        hosting: "managed-required",
        quality: "high-detail",
      },
    };
    const templateResponse = await exports.default.fetch(`${origin}/api/project-templates`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(templateBody),
    });
    expect(templateResponse.status).toBe(201);
    const template = await templateResponse.json<{ template: { id: string } }>();
    const templateReplay = await exports.default.fetch(`${origin}/api/project-templates`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(templateBody),
    });
    expect(templateReplay.status).toBe(200);
    await expect(templateReplay.json()).resolves.toMatchObject({
      template: {
        id: template.template.id,
        name: "Premium venue",
        policy: templateBody.policy,
      },
      idempotent: true,
    });

    const templatedProjectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        projectTemplateId: template.template.id,
        name: "Template-governed venue",
        captureAdapter: "open-import",
        deliveryTemplate: "Property showcase",
      }),
    });
    expect(templatedProjectResponse.status).toBe(201);
    await expect(templatedProjectResponse.json()).resolves.toMatchObject({
      project: {
        projectTemplateId: template.template.id,
        captureAdapter: "fjd-trion",
        deliveryTemplate: "Venue navigator",
        notes: templateBody.notes,
        workflowPolicy: templateBody.policy,
      },
    });

    const viewResponse = await exports.default.fetch(`${origin}/api/project-views`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: "Venue queue",
        isDefault: true,
        filter: {
          query: "museum",
          statuses: ["QA_REQUIRED", "PROCESSING", "PROCESSING"],
          captureAdapters: ["fjd-trion"],
          deliveryTemplates: ["Venue navigator"],
          sort: "name_asc",
        },
      }),
    });
    expect(viewResponse.status).toBe(201);
    const view = await viewResponse.json<{ view: { id: string } }>();
    const views = await exports.default.fetch(`${origin}/api/project-views`, {
      headers: { cookie },
    });
    expect(views.status).toBe(200);
    await expect(views.json()).resolves.toMatchObject({
      views: [{
        id: view.view.id,
        name: "Venue queue",
        isDefault: true,
        filter: {
          query: "museum",
          statuses: ["PROCESSING", "QA_REQUIRED"],
          captureAdapters: ["fjd-trion"],
          deliveryTemplates: ["Venue navigator"],
          sort: "name_asc",
        },
      }],
    });

    const sourceProjectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Portable museum wing",
        customerName: "Museum Trust",
        customerEmail: "ops@museum.example",
        captureAdapter: "fjd-trion",
        deliveryTemplate: "Venue navigator",
        notes: "Preserve the public route.",
      }),
    });
    expect(sourceProjectResponse.status).toBe(201);
    const sourceProject = await sourceProjectResponse.json<{ project: { id: string } }>();
    const exportResponse = await exports.default.fetch(`${origin}/api/projects/export`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ projectIds: [sourceProject.project.id] }),
    });
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-type")).toContain("application/json");
    expect(exportResponse.headers.get("content-disposition")).toContain("attachment");
    const exported = await exportResponse.json<{
      format: string;
      schemaVersion: number;
      fieldDefinitions: Array<Record<string, unknown>>;
      projects: Array<Record<string, unknown>>;
    }>();
    expect(exported).toMatchObject({
      format: "whymelabs.spatial.portfolio",
      schemaVersion: 2,
      fieldDefinitions: [],
      projects: [{
        sourceId: sourceProject.project.id,
        name: "Portable museum wing",
        customerName: "Museum Trust",
        customerEmail: "ops@museum.example",
        captureAdapter: "fjd-trion",
        deliveryTemplate: "Venue navigator",
        customFields: {},
      }],
    });
    expect(exported.projects[0]).not.toHaveProperty("status");
    expect(exported.projects[0]).not.toHaveProperty("slug");

    const previewResponse = await exports.default.fetch(`${origin}/api/projects/import/preview`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(exported),
    });
    expect(previewResponse.status).toBe(200);
    await expect(previewResponse.json()).resolves.toMatchObject({
      valid: true,
      schemaVersion: 2,
      summary: { projects: 1, customers: 1 },
      projects: [{ name: "Portable museum wing", targetStatus: "DRAFT" }],
    });

    const clientOperationId = crypto.randomUUID();
    const importBody = { clientOperationId, manifest: exported };
    const importResponse = await exports.default.fetch(`${origin}/api/projects/import`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(importBody),
    });
    expect(importResponse.status).toBe(201);
    const imported = await importResponse.json<{
      importId: string;
      createdCount: number;
      projects: Array<{ id: string; sourceId: string; name: string; status: string }>;
    }>();
    expect(imported).toMatchObject({
      createdCount: 1,
      projects: [{
        sourceId: sourceProject.project.id,
        name: "Portable museum wing",
        status: "DRAFT",
      }],
    });
    expect(imported.projects[0].id).not.toBe(sourceProject.project.id);

    const importReplay = await exports.default.fetch(`${origin}/api/projects/import`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(importBody),
    });
    expect(importReplay.status).toBe(200);
    await expect(importReplay.json()).resolves.toMatchObject({
      importId: imported.importId,
      createdCount: 1,
      idempotent: true,
    });

    const conflictResponse = await exports.default.fetch(`${origin}/api/projects/import`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId,
        manifest: {
          ...exported,
          projects: [{ ...exported.projects[0], name: "Conflicting replay" }],
        },
      }),
    });
    expect(conflictResponse.status).toBe(409);

    const deleteView = await exports.default.fetch(`${origin}/api/project-views/${view.view.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleteView.status).toBe(204);
    const deleteTemplate = await exports.default.fetch(
      `${origin}/api/project-templates/${template.template.id}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(deleteTemplate.status).toBe(204);
  });

  it("scopes an invited reviewer to one immutable project review journey", async () => {
    const operatorCookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie: operatorCookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Client approval suite",
        captureAdapter: "open-import",
        deliveryTemplate: "venue-navigator",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const versionId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO scene_versions
        (id, project_id, version_number, status, source_provenance_json, created_by)
      VALUES (?, ?, 1, 'QA_REQUIRED', '{}', ?)
    `).bind(versionId, project.id, "00000000-0000-4000-8000-000000000002").run();

    const reviewerEmail = "reviewer@example.com";
    const invitationResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/reviewers`,
      {
        method: "POST",
        headers: { cookie: operatorCookie, "content-type": "application/json" },
        body: JSON.stringify({
          email: reviewerEmail,
          role: "customer_reviewer",
          expiresInDays: 7,
        }),
      },
    );
    expect(invitationResponse.status).toBe(201);
    const invitation = await invitationResponse.json<{
      invitation: { id: string; userId: string; status: string };
    }>();
    expect(invitation.invitation.status).toBe("pending");

    const reviewerCookie = (await loginSession(reviewerEmail)).accessCookie;
    const inboxResponse = await exports.default.fetch(`${origin}/api/review/inbox`, {
      headers: { cookie: reviewerCookie },
    });
    expect(inboxResponse.status).toBe(200);
    await expect(inboxResponse.json()).resolves.toMatchObject({
      projects: [{ id: project.id, role: "customer_reviewer" }],
    });

    const commentResponse = await exports.default.fetch(
      `${origin}/api/review/projects/${project.id}/versions/${versionId}/comments`,
      {
        method: "POST",
        headers: { cookie: reviewerCookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          kind: "redaction",
          body: "Blur the family photo beside the doorway.",
          cameraPose: {
            position: [1.2, 1.6, -2.4],
            target: [0.1, 1.1, 0.3],
            up: [0, 1, 0],
            fovDegrees: 58,
          },
          anchor: { point: [0.4, 1.3, -0.2], radius: 0.2 },
        }),
      },
    );
    expect(commentResponse.status).toBe(201);
    const comment = await commentResponse.json<{ comment: { id: string } }>();

    const decisionResponse = await exports.default.fetch(
      `${origin}/api/review/projects/${project.id}/versions/${versionId}/decisions`,
      {
        method: "POST",
        headers: { cookie: reviewerCookie, "content-type": "application/json" },
        body: JSON.stringify({
          decision: "changes_requested",
          note: "Approve after the redaction request is resolved.",
        }),
      },
    );
    expect(decisionResponse.status).toBe(201);

    const reviewResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/reviews`,
      { headers: { cookie: operatorCookie } },
    );
    expect(reviewResponse.status).toBe(200);
    await expect(reviewResponse.json()).resolves.toMatchObject({
      comments: [{
        id: comment.comment.id,
        version_id: versionId,
        kind: "redaction",
        status: "open",
      }],
      decisions: [{
        version_id: versionId,
        decision: "changes_requested",
      }],
      reviewers: [{
        user_id: invitation.invitation.userId,
        invitation_status: "accepted",
      }],
    });

    const secondVersionId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO scene_versions
        (id, project_id, version_number, status, source_provenance_json, created_by)
      VALUES (?, ?, 2, 'QA_REQUIRED', '{"revision":"client changes"}', ?)
    `).bind(secondVersionId, project.id, "00000000-0000-4000-8000-000000000002").run();
    const projectScope = await env.DB.prepare(
      "SELECT organisation_id FROM projects WHERE id = ?",
    ).bind(project.id).first<{ organisation_id: string }>();
    const leftAssetId = crypto.randomUUID();
    const rightAssetId = crypto.randomUUID();
    const leftObjectKey = `delivery-private/${projectScope!.organisation_id}/${project.id}/${versionId}/left.rad`;
    const rightObjectKey = `delivery-private/${projectScope!.organisation_id}/${project.id}/${secondVersionId}/right.rad`;
    const leftBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const rightBytes = new Uint8Array([7, 8, 9, 10, 11, 12]);
    await Promise.all([
      env.SPATIAL_ASSETS.put(leftObjectKey, leftBytes),
      env.SPATIAL_ASSETS.put(rightObjectKey, rightBytes),
    ]);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, integrity_status)
        VALUES (?, ?, ?, ?, 'web', 'rad', ?, 'left.rad', 'application/octet-stream', ?, 'verified')
      `).bind(leftAssetId, projectScope!.organisation_id, project.id, versionId, leftObjectKey, leftBytes.byteLength),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, integrity_status)
        VALUES (?, ?, ?, ?, 'web', 'rad', ?, 'right.rad', 'application/octet-stream', ?, 'verified')
      `).bind(rightAssetId, projectScope!.organisation_id, project.id, secondVersionId, rightObjectKey, rightBytes.byteLength),
      env.DB.prepare("UPDATE scene_versions SET manifest_json = ? WHERE id = ?")
        .bind(JSON.stringify({ webAssetId: leftAssetId }), versionId),
      env.DB.prepare("UPDATE scene_versions SET manifest_json = ? WHERE id = ?")
        .bind(JSON.stringify({ webAssetId: rightAssetId }), secondVersionId),
    ]);
    const previewResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/versions/${secondVersionId}/preview`,
      { headers: { cookie: reviewerCookie } },
    );
    expect(previewResponse.status).toBe(409);
    expect(previewResponse.headers.get("cache-control")).toBe("private, no-store");
    await expect(previewResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("no verified capture-to-scene registration"),
    });

    const comparisonResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/versions/compare?left=${versionId}&right=${secondVersionId}`,
      { headers: { cookie: reviewerCookie } },
    );
    expect(comparisonResponse.status).toBe(409);
    await expect(comparisonResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("verified capture registration plus approved v7+ collision and navigation"),
    });

    const themeResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/theme`,
      {
        method: "PUT",
        headers: { cookie: operatorCookie, "content-type": "application/json" },
        body: JSON.stringify({
          brandName: "Whyme Venue",
          accentColor: "#b8ff46",
          surfaceColor: "#121713",
        }),
      },
    );
    expect(themeResponse.status).toBe(200);

    const hostingResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/hosting`,
      {
        method: "PUT",
        headers: { cookie: operatorCookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          planCode: "venue",
          renewsAutomatically: true,
          archiveOnExpiry: true,
        }),
      },
    );
    expect(hostingResponse.status).toBe(503);
    await expect(hostingResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("payment provider"),
      retryable: false,
    });
    const retentionResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/retention`,
      {
        method: "PUT",
        headers: { cookie: operatorCookie, "content-type": "application/json" },
        body: JSON.stringify({
          rawRetentionDays: 90,
          derivativeRetentionDays: 730,
          releaseRetentionDays: 1095,
          legalHold: false,
        }),
      },
    );
    expect(retentionResponse.status).toBe(200);
    const hostingWorkspaceResponse = await exports.default.fetch(`${origin}/api/hosting`, {
      headers: { cookie: operatorCookie },
    });
    expect(hostingWorkspaceResponse.status).toBe(200);
    const hostingWorkspace = await hostingWorkspaceResponse.json<{
      paymentProviderConfigured: boolean;
      plans: Array<{ code: string }>;
      subscriptions: Array<{ project_id: string }>;
      invoices: Array<{ project_id: string }>;
      checkouts: Array<{ project_id: string }>;
    }>();
    expect(hostingWorkspace.paymentProviderConfigured).toBe(false);
    expect(hostingWorkspace.plans).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "venue" })]),
    );
    expect(hostingWorkspace.subscriptions.find((item) => item.project_id === project.id))
      .toBeUndefined();
    expect(hostingWorkspace.invoices.find((item) => item.project_id === project.id))
      .toBeUndefined();
    expect(hostingWorkspace.checkouts.find((item) => item.project_id === project.id))
      .toBeUndefined();

    const revokeResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/reviewers/${invitation.invitation.userId}`,
      { method: "DELETE", headers: { cookie: operatorCookie } },
    );
    expect(revokeResponse.status).toBe(204);

    const revokedInbox = await exports.default.fetch(`${origin}/api/review/inbox`, {
      headers: { cookie: reviewerCookie },
    });
    expect(revokedInbox.status).toBe(200);
    await expect(revokedInbox.json()).resolves.toEqual({ projects: [] });
  });

  it("runs the immutable Spark RAD publish, range delivery, and revoke path end to end", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Publishable apartment",
        captureAdapter: "open-import",
        deliveryTemplate: "property-tour",
      }),
    });
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const sceneBytes = new TextEncoder().encode("test-spark-rad-scene");

    const uploadResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/uploads`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: "44444444-4444-4444-8444-444444444444",
          fileName: "scene.rad",
          sizeBytes: sceneBytes.byteLength,
          format: "rad",
          mimeType: "application/octet-stream",
        }),
      },
    );
    expect(uploadResponse.status).toBe(201);
    const { upload } = await uploadResponse.json<{
      upload: { id: string; versionId: string; assetId: string };
    }>();
    const repeatedUploadResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/uploads`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: "44444444-4444-4444-8444-444444444444",
          fileName: "scene.rad",
          sizeBytes: sceneBytes.byteLength,
          format: "rad",
          mimeType: "application/octet-stream",
        }),
      },
    );
    expect(repeatedUploadResponse.status).toBe(200);
    await expect(repeatedUploadResponse.json()).resolves.toMatchObject({
      upload: { id: upload.id },
      idempotent: true,
    });

    const partResponse = await exports.default.fetch(
      `${origin}/api/uploads/${upload.id}/parts/1`,
      {
        method: "PUT",
        headers: {
          cookie,
          "content-length": String(sceneBytes.byteLength),
        },
        body: sceneBytes,
      },
    );
    expect(partResponse.status).toBe(200);
    const { part } = await partResponse.json<{ part: { etag: string } }>();

    const recoveryResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/uploads/open`,
      { headers: { cookie } },
    );
    expect(recoveryResponse.status).toBe(200);
    await expect(recoveryResponse.json()).resolves.toMatchObject({
      uploads: [{
        id: upload.id,
        projectId: project.id,
        versionId: upload.versionId,
        fileName: "scene.rad",
        format: "rad",
        expectedSizeBytes: sceneBytes.byteLength,
        uploadedBytes: sceneBytes.byteLength,
        partSizeBytes: 10 * 1024 * 1024,
        expired: false,
        parts: [{ partNumber: 1, etag: part.etag, sizeBytes: sceneBytes.byteLength }],
      }],
    });

    const completeResponse = await exports.default.fetch(
      `${origin}/api/uploads/${upload.id}/complete`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          parts: [{ partNumber: 1, etag: part.etag }],
        }),
      },
    );
    expect(completeResponse.status).toBe(200);
    const completed = await completeResponse.json<{
      job: { id: string };
      asset: { id: string; versionId: string };
    }>();
    const completedRecoveryResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/uploads/open`,
      { headers: { cookie } },
    );
    await expect(completedRecoveryResponse.json()).resolves.toEqual({ uploads: [] });

    const jobResponse = await exports.default.fetch(
      `${origin}/api/jobs/${completed.job.id}/manual-complete`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          progressMessage: "Spark RAD validated",
          report: { validation: "passed" },
        }),
      },
    );
    expect(jobResponse.status).toBe(200);
    const repeatedJobResponse = await exports.default.fetch(
      `${origin}/api/jobs/${completed.job.id}/manual-complete`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          progressMessage: "Spark RAD validated",
          report: { validation: "passed" },
        }),
      },
    );
    expect(repeatedJobResponse.status).toBe(200);
    await expect(repeatedJobResponse.json()).resolves.toMatchObject({ idempotent: true });

    const generatedPosterAssetId = crypto.randomUUID();
    const generatedPosterKey =
      `delivery-private/generated-poster/${completed.asset.versionId}/poster.png`;
    await env.SPATIAL_ASSETS.put(generatedPosterKey, new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]), {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { sha256: "c".repeat(64) },
    });
    await env.DB.prepare(`
      INSERT INTO assets (
        id, organisation_id, project_id, version_id, kind, format, object_key,
        file_name, mime_type, size_bytes, sha256, integrity_status
      )
      SELECT ?, organisation_id, project_id, version_id, 'poster', 'png', ?,
        'poster.png', 'image/png', 8, ?, 'verified'
      FROM assets WHERE id = ?
    `).bind(
      generatedPosterAssetId,
      generatedPosterKey,
      "c".repeat(64),
      completed.asset.id,
    ).run();

    await recordCompletedPrivacyScan(project.id, completed.asset.versionId, completed.asset.id);
    const approvalRequest = {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        webAssetId: completed.asset.id,
        visualGrade: "A",
        privacyStatus: "approved",
        measurementGrade: "visual-only",
        notes: "Test approval",
      }),
    };
    const approvalResponse = await exports.default.fetch(
      `${origin}/api/versions/${completed.asset.versionId}/approve`,
      approvalRequest,
    );
    expect(approvalResponse.status).toBe(409);
    await expect(approvalResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("QA approval blocked"),
    });
    const repeatedApprovalResponse = await exports.default.fetch(
      `${origin}/api/versions/${completed.asset.versionId}/approve`,
      approvalRequest,
    );
    expect(repeatedApprovalResponse.status).toBe(409);

    for (const [slug, initialCamera] of [
      ["invalid-camera-target", {
        position: [0, 0, 0],
        target: [0, 0, 0],
        up: [0, 1, 0],
        fovDegrees: 58,
      }],
      ["invalid-camera-up", {
        position: [0, 0, 0],
        target: [0, 0, -1],
        up: [0, 0, 2],
        fovDegrees: 58,
      }],
    ] as const) {
      const invalidCameraResponse = await exports.default.fetch(
        `${origin}/api/projects/${project.id}/releases`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            slug,
            accessPolicy: "public",
            viewerConfig: {
              title: "Invalid camera",
              measurementDisclaimer: VISUAL_ONLY_MEASUREMENT_DISCLAIMER,
              initialCamera,
            },
          }),
        },
      );
      expect(invalidCameraResponse.status).toBe(400);
    }

    const provisionalTransform = {
      sourceUpAxis: "Z",
      worldUnit: "scene_units",
      metresPerSourceUnit: 1,
      yawDegrees: 0,
      translationMetres: [0, 0, 0],
    };
    const unprovenProvisionalRelease = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "unproven-provisional-release",
          accessPolicy: "unlisted",
          viewerConfig: {
            title: "Unproven provisional release",
            measurementDisclaimer: PROVISIONAL_MEASUREMENT_DISCLAIMER,
            sourceToWorld: provisionalTransform,
          },
        }),
      },
    );
    expect(unprovenProvisionalRelease.status).toBe(400);
    const unknownProvisionalEvidence = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "unknown-provisional-evidence",
          accessPolicy: "unlisted",
          sourceToWorldEvidenceId: crypto.randomUUID(),
          viewerConfig: {
            title: "Unknown provisional evidence",
            measurementDisclaimer: PROVISIONAL_MEASUREMENT_DISCLAIMER,
            sourceToWorld: provisionalTransform,
          },
        }),
      },
    );
    expect(unknownProvisionalEvidence.status).toBe(400);

    const provisionalEvidenceId = crypto.randomUUID();
    const provisionalEvidenceJobId = crypto.randomUUID();
    const provisionalEvidenceOwner = await env.DB.prepare(`
      SELECT organisation_id, created_by FROM projects WHERE id = ?
    `).bind(project.id).first<{ organisation_id: string; created_by: string }>();
    expect(provisionalEvidenceOwner).toBeTruthy();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO processing_jobs (
          id, organisation_id, project_id, version_id, input_asset_id, job_type,
          processor_version, idempotency_key, state, progress, progress_message
        ) VALUES (?, ?, ?, ?, ?, 'semantic.extract-v1', 'test/1.0',
          ?, 'SUCCEEDED', 100, 'Reviewed provisional-unit evidence')
      `).bind(
        provisionalEvidenceJobId,
        provisionalEvidenceOwner!.organisation_id,
        project.id,
        completed.asset.versionId,
        completed.asset.id,
        `provisional-evidence:${provisionalEvidenceId}`,
      ),
      env.DB.prepare(`
        INSERT INTO semantic_extraction_runs (
          id, organisation_id, project_id, version_id, input_asset_id, job_id,
          status, parameters_json, candidate_count, client_operation_id,
          request_hash, created_by, reviewed_by, review_decision, review_note,
          reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'REVIEWED', ?, 1, ?, ?, ?, ?,
          'accept_selected', 'Reviewed fixture proving the exact transform.',
          datetime('now'))
      `).bind(
        provisionalEvidenceId,
        provisionalEvidenceOwner!.organisation_id,
        project.id,
        completed.asset.versionId,
        completed.asset.id,
        provisionalEvidenceJobId,
        JSON.stringify({
          coordinateAssurance: "authored_source_to_world_v1",
          sourceToWorld: provisionalTransform,
          registrationEvidence:
            "Temporary scene units preserve alignment without claiming real-world scale.",
        }),
        crypto.randomUUID(),
        "f".repeat(64),
        provisionalEvidenceOwner!.created_by,
        provisionalEvidenceOwner!.created_by,
      ),
    ]);
    const mismatchedProvisionalEvidence = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "mismatched-provisional-evidence",
          accessPolicy: "unlisted",
          sourceToWorldEvidenceId: provisionalEvidenceId,
          viewerConfig: {
            title: "Mismatched provisional evidence",
            measurementDisclaimer: PROVISIONAL_MEASUREMENT_DISCLAIMER,
            sourceToWorld: { ...provisionalTransform, metresPerSourceUnit: 1.1 },
          },
        }),
      },
    );
    expect(mismatchedProvisionalEvidence.status).toBe(400);
    const mismatchedNavigationUnit = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "proven-provisional-release",
          accessPolicy: "unlisted",
          sourceToWorldEvidenceId: provisionalEvidenceId,
          viewerConfig: {
            title: "Proven provisional release",
            measurementDisclaimer: PROVISIONAL_MEASUREMENT_DISCLAIMER,
            sourceToWorld: provisionalTransform,
          },
        }),
      },
    );
    expect(mismatchedNavigationUnit.status).toBe(400);
    const provisionalProfile = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/navigation-profile`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          versionId: completed.asset.versionId,
          worldUnit: "scene_units",
          agentRadius: 0.12,
          agentHeight: 0.8,
          eyeHeight: 0.65,
          maxStepMetres: 0.05,
        }),
      },
    );
    expect(provisionalProfile.status).toBe(200);
    const provenProvisionalRelease = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "proven-provisional-release",
          accessPolicy: "unlisted",
          sourceToWorldEvidenceId: provisionalEvidenceId,
          viewerConfig: {
            title: "Proven provisional release",
            measurementDisclaimer: PROVISIONAL_MEASUREMENT_DISCLAIMER,
            sourceToWorld: provisionalTransform,
          },
        }),
      },
    );
    expect(provenProvisionalRelease.status).toBe(400);
    await expect(provenProvisionalRelease.json()).resolves.toMatchObject({
      details: { project: [expect.stringContaining("no approved scene version")] },
    });
    const restoreMetricProfile = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/navigation-profile`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          versionId: completed.asset.versionId,
          worldUnit: "metres",
          agentRadius: 0.22,
          agentHeight: 1.8,
          eyeHeight: 1.6,
          maxStepMetres: 0.1,
        }),
      },
    );
    expect(restoreMetricProfile.status).toBe(200);

    const snapshotEntityResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/entities`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          versionId: completed.asset.versionId,
          kind: "room",
          label: "Published walkable room",
          geometry: {
            type: "polygon",
            points: [[0, 0, 0], [4, 0, 0], [4, 0, 1], [1, 0, 1], [1, 0, 4], [0, 0, 4]],
          },
          metadata: {},
        }),
      },
    );
    expect(snapshotEntityResponse.status).toBe(201);
    const snapshotEntity = await snapshotEntityResponse.json<{ entity: { id: string } }>();
    const disconnectedEntityResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/entities`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          versionId: completed.asset.versionId,
          kind: "room",
          label: "Disconnected room",
          geometry: {
            type: "polygon",
            points: [[20, 0, 20], [24, 0, 20], [24, 0, 24], [20, 0, 24]],
          },
          metadata: {},
        }),
      },
    );
    expect(disconnectedEntityResponse.status).toBe(201);
    const disconnectedEntity = await disconnectedEntityResponse.json<{
      entity: { id: string };
    }>();
    const disconnectedReleaseResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "disconnected-apartment",
          accessPolicy: "unlisted",
          viewerConfig: {
            title: "Disconnected apartment",
            measurementDisclaimer: VISUAL_ONLY_MEASUREMENT_DISCLAIMER,
          },
        }),
      },
    );
    expect(disconnectedReleaseResponse.status).toBe(400);
    await expect(disconnectedReleaseResponse.json()).resolves.toMatchObject({
      details: { project: [expect.stringContaining("no approved scene version")] },
    });
    const archiveDisconnectedEntity = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/entities/${disconnectedEntity.entity.id}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(archiveDisconnectedEntity.status).toBe(204);
    const snapshotObstacleResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/navigation-obstacles`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          versionId: completed.asset.versionId,
          label: "Published table",
          geometry: {
            type: "box",
            points: [[1.5, 0, 0.2], [2.5, 0.9, 0.8]],
          },
          metadata: {},
        }),
      },
    );
    expect(snapshotObstacleResponse.status).toBe(201);
    const snapshotObstacle = await snapshotObstacleResponse.json<{
      obstacle: { id: string };
    }>();

    const misalignedRotationResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "misaligned-spatial-runtime",
          accessPolicy: "unlisted",
          viewerConfig: {
            title: "Misaligned spatial runtime",
            measurementDisclaimer: VISUAL_ONLY_MEASUREMENT_DISCLAIMER,
            sceneRotationDegrees: [0, 0, 180],
          },
        }),
      },
    );
    expect(misalignedRotationResponse.status).toBe(400);

    const missingVerifiedNavigation = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "missing-verified-navigation",
          accessPolicy: "unlisted",
          viewerConfig: {
            title: "Missing verified navigation",
            measurementDisclaimer: VISUAL_ONLY_MEASUREMENT_DISCLAIMER,
          },
        }),
      },
    );
    expect(missingVerifiedNavigation.status).toBe(400);
    await expect(missingVerifiedNavigation.json()).resolves.toMatchObject({
      details: { project: [expect.stringContaining("no approved scene version")] },
    });

    const collisionAssetId = crypto.randomUUID();
    const navigationJobId = crypto.randomUUID();
    const navigationBuildId = crypto.randomUUID();
    const navigationReportAssetId = crypto.randomUUID();
    const navigationDetourAssetId = crypto.randomUUID();
    const collisionSha256 = "d".repeat(64);
    const navigationReportSha256 = "a".repeat(64);
    const navigationDetourSha256 = "b".repeat(64);
    const navigationAuthoringHash = await sha256Hex(JSON.stringify({
      profile: {
        worldUnit: "metres",
        agentRadius: 0.22,
        agentHeight: 1.8,
        eyeHeight: 1.6,
        maxStepMetres: 0.1,
        maxSlopeDegrees: 45,
        maxSpeed: 1.6,
        maxAcceleration: 8,
      },
      destinations: [{
        id: snapshotEntity.entity.id,
        position: [1 / 3, 0, 8 / 3],
      }],
      obstacles: [{
        id: snapshotObstacle.obstacle.id,
        label: "Published table",
        min: [1.5, 0, 0.2],
        max: [2.5, 0.9, 0.8],
      }],
      walkableGeometry: [{
        id: snapshotEntity.entity.id,
        kind: "room",
        position: null,
        geometry: {
          type: "polygon",
          points: [[0, 0, 0], [4, 0, 0], [4, 0, 1], [1, 0, 1], [1, 0, 4], [0, 0, 4]],
        },
      }],
      routeStops: [],
    }));
    const collisionObjectKey =
      `masters-private/${provisionalEvidenceOwner!.organisation_id}/${project.id}/${completed.asset.versionId}/fixture.collision.glb`;
    await env.SPATIAL_ASSETS.put(collisionObjectKey, new Uint8Array([1, 2, 3, 4]));
    const navigationArtifact = {
      schemaVersion: "spatial-navigation-v6",
      generator: {
        name: "recast-navigation-js",
        version: "0.43.1",
        nativeRecastCommit: "599fd0f023181c0a484df2a18cf1d75a3553852e",
        mode: "tiled",
      },
      coordinateSystem: {
        handedness: "right",
        upAxis: "Y",
        worldUnit: "metres",
        triangleWinding: "counter-clockwise",
      },
      source: {
        assetId: collisionAssetId,
        sha256: collisionSha256,
        authoringHash: navigationAuthoringHash,
        triangleCount: 2,
        vertexCount: 4,
      },
      agent: {
        radius: 0.22,
        height: 1.8,
        eyeHeight: 1.6,
        maxClimb: 0.1,
        maxSlopeDegrees: 45,
        maxSpeed: 1.6,
        maxAcceleration: 8,
      },
      build: {
        cellSize: 0.1,
        cellHeight: 0.05,
        tileSize: 32,
        maxEdgeLengthVoxels: 12,
        maxSimplificationError: 1.3,
        minimumRegionSizeVoxels: 8,
        mergeRegionSizeVoxels: 20,
      },
      recastConfig: { walkableRadius: 3, walkableHeight: 36, walkableClimb: 2 },
      bounds: [[0, 0, 0], [4, 2.6, 4]],
      spawn: {
        id: "opening",
        requestedPosition: [0.5, 0, 0.5],
        projectedPosition: [0.5, 0, 0.5],
      },
      offMeshConnections: [],
      navMesh: {
        clearanceApplied: true,
        vertices: [[0.22, 0, 0.22], [3.78, 0, 0.22], [0.22, 0, 3.78]],
        indices: [0, 1, 2],
      },
      detour: {
        format: "recast-navigation-js-export-v1",
        byteLength: 64,
        bytesBase64: btoa("x".repeat(64)),
      },
      validation: {
        passed: true,
        componentCount: 1,
        rawTriangleComponentCount: 1,
        spawnProjectedDistance: 0,
        destinationCount: 1,
        unreachableDestinationIds: [],
        destinations: [{
          id: snapshotEntity.entity.id,
          requestedPosition: [0.7, 0, 0.7],
          projectedPosition: [0.7, 0, 0.7],
          reachable: true,
          outboundReachable: true,
          inboundReachable: true,
          outboundPathPointCount: 2,
          inboundPathPointCount: 2,
        }],
      },
      physicalValidation: {
        passed: true,
        engine: "rapier3d",
        version: "0.19.3",
        controller: "kinematic-capsule",
        spawnOccupancyPassed: true,
        routeCount: 2,
        failedDestinationIds: [],
        routes: ["outbound", "inbound"].map((direction) => ({
          destinationId: snapshotEntity.entity.id,
          direction,
          passed: true,
          waypointCount: 2,
          simulatedSteps: 8,
          pathLength: 0.3,
          finalPosition: [0.7, 0, 0.7],
        })),
      },
    };
    const v7Directions = ["east", "west", "up", "down", "south", "north"] as const;
    const v7ArtifactContract = navigationArtifactSchema.safeParse({
      ...navigationArtifact,
      schemaVersion: "spatial-navigation-v7",
      collisionSemantics: {
        schemaVersion: "spatial-structural-collision-v1",
        provenance: "operator_reviewed",
        structuralShellComplete: true,
        includedGroups: ["STRUCTURAL_FLOOR", "STRUCTURAL_BARRIER"],
        ignoredGroups: ["FURNITURE", "TRIGGER"],
      },
      dynamicBarriers: [],
      structuralGeometry: {
        schemaVersion: "authored-structural-collision-v2",
        floorRectangles: [{ id: "floor", min: [0, 0], max: [4, 4], elevation: 0 }],
        ceilingRectangles: [{ id: "ceiling", min: [0, 0], max: [4, 4], elevation: 2.6 }],
        barrierSegments: [{
          id: "wall",
          start: [0, 0],
          end: [0, 4],
          minY: 0,
          maxY: 2.6,
        }],
        dynamicBarrierIds: [],
      },
      movementProfiles: {
        defaultMode: "walk",
        supportedModes: ["walk", "fly", "noclip"],
        walk: {
          shape: "capsule",
          gravity: true,
          groundSnap: true,
          collisionGroups: ["STRUCTURAL_FLOOR", "STRUCTURAL_BARRIER"],
          input: {
            forward: ["KeyW", "ArrowUp"], backward: ["KeyS", "ArrowDown"],
            left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
            boost: ["ShiftLeft", "ShiftRight"],
          },
          speedUnitsPerSecond: 1.6,
          boostMultiplier: 3,
          recoveryBounds: [[-0.22, -1.8, -0.22], [4.22, 4.4, 4.22]],
        },
        fly: {
          shape: "sphere",
          gravity: false,
          groundSnap: false,
          collisionGroups: ["STRUCTURAL_FLOOR", "STRUCTURAL_BARRIER"],
          input: {
            forward: ["KeyW", "ArrowUp"], backward: ["KeyS", "ArrowDown"],
            left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"],
            boost: ["ShiftLeft", "ShiftRight"], ascend: ["Space", "KeyE"],
            descend: ["KeyC", "KeyQ"],
          },
          speedUnitsPerSecond: 1.6,
          boostMultiplier: 3,
          recoveryBounds: [[-0.22, -1.8, -0.22], [4.22, 4.4, 4.22]],
        },
        noclip: {
          operatorOnly: true,
          shape: "none",
          gravity: false,
          groundSnap: false,
          collisionGroups: [],
          input: {
            forward: ["KeyW", "ArrowUp"],
            backward: ["KeyS", "ArrowDown"],
            left: ["KeyA", "ArrowLeft"],
            right: ["KeyD", "ArrowRight"],
            boost: ["ShiftLeft", "ShiftRight"],
            ascend: ["Space", "KeyE"],
            descend: ["KeyC", "KeyQ"],
          },
          speedUnitsPerSecond: 1.6,
          boostMultiplier: 3,
          recoveryBounds: [[-0.22, -1.8, -0.22], [4.22, 4.4, 4.22]],
        },
      },
      structuralValidation: {
        passed: true,
        engine: "rapier3d",
        version: "0.19.3",
        shape: "sphere",
        ignoredFurnitureMeshCount: 1,
        anchorCount: 2,
        probeCount: 12,
        probes: [
          ...v7Directions.map((direction) => ({
            anchorId: "opening",
            origin: [0.5, 1.6, 0.5],
            direction,
            blocked: true,
            requestedDistance: 10,
            actualDistance: 1,
          })),
          ...v7Directions.map((direction) => ({
            anchorId: snapshotEntity.entity.id,
            origin: [0.7, 1.6, 0.7],
            direction,
            blocked: true,
            requestedDistance: 10,
            actualDistance: 1,
          })),
        ],
        boundaryCount: 1,
        boundaryProbeCount: 4,
        boundaryProbes: (["walk", "fly"] as const).flatMap((mode) =>
          [-1, 1].map((side) => ({
            barrierId: "wall",
            mode,
            shape: mode === "walk" ? "capsule" as const : "sphere" as const,
            side,
            origin: [0.3 * side, 1.3, 2],
            direction: [-side, 0, 0],
            requestedDistance: 0.6,
            hitDistance: 0.3,
            blocked: true,
          }))),
        cornerCount: 2,
        cornerProbeCount: 2,
        cornerProbes: [0, 4].map((z, index) => ({
          cornerId: `wall-corner-${index + 1}`,
          origin: [0.3, 0, z + (index ? -0.3 : 0.3)],
          requestedEnd: [-0.3, 0, z + (index ? 0.3 : -0.3)],
          actualEnd: [0.22, 0, z],
          blocked: true,
          remainedInside: true,
        })),
        dynamicBarrierCount: 0,
        dynamicBarrierProbeCount: 0,
        dynamicBarrierProbes: [],
        boundaryTopology: {
          passed: true,
          method: "explicit-closed-segment-loops-v1",
          loopCount: 1,
          floorComponentCount: 1,
          dynamicClosureCount: 0,
        },
      },
    });
    expect(v7ArtifactContract.success).toBe(true);
    if (!v7ArtifactContract.success) throw new Error("V7 fixture failed its contract");
    let telemetryNavigationArtifact: unknown = null;
    if (v7ArtifactContract.success && v7ArtifactContract.data.structuralValidation) {
      const planarBoundaryArtifact = structuredClone(v7ArtifactContract.data);
      planarBoundaryArtifact.structuralValidation!.boundaryTopology.method =
        "explicit-planar-boundary-faces-v2";
      expect(navigationArtifactSchema.safeParse(planarBoundaryArtifact).success).toBe(true);
      const v9Artifact = {
        ...structuredClone(planarBoundaryArtifact),
        schemaVersion: "spatial-navigation-v9",
        offMeshConnections: [{
          id: "gallery-lift",
          traversalKind: "elevator",
          label: "Gallery lift",
          requestedStartPosition: [0.5, 0, 0.5],
          startPosition: [0.5, 0.05, 0.5],
          controlPoints: [[0.5, 2.6, 0.5]],
          requestedEndPosition: [0.7, 2.55, 0.7],
          endPosition: [0.7, 2.6, 0.7],
          radius: 0.22,
          bidirectional: true,
          speedUnitsPerSecond: 1.2,
          area: 0,
          flags: 1,
          userId: 1,
          reviewedPurpose: "Reviewed gallery lift path from registered evidence.",
          evidenceReceipt: {
            assetId: "11111111-1111-4111-8111-111111111111",
            sha256: "a".repeat(64),
            manifestId: "22222222-2222-4222-8222-222222222222",
            manifestSha256: "b".repeat(64),
            adapter: "xgrids-lcc",
            reviewGeneration: 1,
            registrationSha256: "c".repeat(64),
            sourceToWorld: {
              sourceUpAxis: "Y",
              worldUnit: "metres",
              metresPerSourceUnit: 1,
              yawDegrees: 0,
              translationMetres: [0, 0, 0],
            },
            sourcePath: [[0.5, 0, 0.5], [0.5, 2.6, 0.5], [0.7, 2.55, 0.7]],
          },
        }],
        authoredTraversalValidation: {
          passed: true,
          engine: "rapier3d",
          version: "0.19.3",
          controller: "kinematic-capsule-controlled-path",
          connectionCount: 1,
          directionCount: 2,
          traversals: ["forward", "reverse"].map((direction) => ({
            connectionId: "gallery-lift",
            traversalKind: "elevator",
            direction,
            waypointCount: 3,
            simulatedSteps: 64,
            pathLength: 2.9,
            finalPosition: direction === "forward" ? [0.7, 2.6, 0.7] : [0.5, 0, 0.5],
          })),
        },
      };
      const missingTraversalEvidence = structuredClone(v9Artifact);
      delete (missingTraversalEvidence.offMeshConnections[0] as {
        evidenceReceipt?: unknown;
      }).evidenceReceipt;
      expect(navigationArtifactSchema.safeParse(missingTraversalEvidence).success).toBe(false);
      expect(navigationArtifactSchema.safeParse(v9Artifact).success).toBe(true);
      telemetryNavigationArtifact = structuredClone(v9Artifact);
      const frozenTraversalParameters = {
        offMeshConnections: v9Artifact.offMeshConnections.map((connection) => {
          const {
            requestedStartPosition,
            requestedEndPosition,
            ...frozenConnection
          } = structuredClone(connection);
          return {
            ...frozenConnection,
            startPosition: requestedStartPosition,
            endPosition: requestedEndPosition,
          };
        }),
      };
      expect(navigationArtifactMatchesFrozenConnections(
        v9Artifact,
        frozenTraversalParameters,
      )).toBe(true);
      for (const mutate of [
        (candidate: typeof v9Artifact) => {
          candidate.offMeshConnections[0]!.requestedEndPosition = [0.8, 2.55, 0.7];
        },
        (candidate: typeof v9Artifact) => {
          candidate.offMeshConnections[0]!.evidenceReceipt.manifestId =
            "33333333-3333-4333-8333-333333333333";
        },
        (candidate: typeof v9Artifact) => {
          candidate.offMeshConnections[0]!.evidenceReceipt.reviewGeneration = 2;
        },
        (candidate: typeof v9Artifact) => {
          candidate.offMeshConnections[0]!.evidenceReceipt.registrationSha256 = "d".repeat(64);
        },
        (candidate: typeof v9Artifact) => {
          candidate.offMeshConnections[0]!.evidenceReceipt.sourceToWorld.yawDegrees = 5;
        },
        (candidate: typeof v9Artifact) => {
          candidate.offMeshConnections[0]!.evidenceReceipt.sourcePath[1] = [0.5, 2.5, 0.5];
        },
      ]) {
        const substitutedArtifact = structuredClone(v9Artifact);
        mutate(substitutedArtifact);
        expect(navigationArtifactMatchesFrozenConnections(
          substitutedArtifact,
          frozenTraversalParameters,
        )).toBe(false);
      }
      const legacyV8Artifact = structuredClone(v9Artifact);
      legacyV8Artifact.schemaVersion = "spatial-navigation-v8";
      const legacyConnection = legacyV8Artifact.offMeshConnections[0] as {
        label?: string;
        requestedStartPosition?: [number, number, number];
        requestedEndPosition?: [number, number, number];
        evidenceReceipt: {
          manifestId?: string;
          manifestSha256?: string;
          adapter?: string;
          reviewGeneration?: number;
          registrationSha256?: string;
          sourceToWorld?: unknown;
          sourcePath?: unknown;
        };
      };
      delete legacyConnection.label;
      delete legacyConnection.requestedStartPosition;
      delete legacyConnection.requestedEndPosition;
      delete legacyConnection.evidenceReceipt.manifestId;
      delete legacyConnection.evidenceReceipt.manifestSha256;
      delete legacyConnection.evidenceReceipt.adapter;
      delete legacyConnection.evidenceReceipt.reviewGeneration;
      delete legacyConnection.evidenceReceipt.registrationSha256;
      delete legacyConnection.evidenceReceipt.sourceToWorld;
      delete legacyConnection.evidenceReceipt.sourcePath;
      expect(navigationArtifactSchema.safeParse(legacyV8Artifact).success).toBe(true);
      expect(navigationArtifactMatchesFrozenConnections(legacyV8Artifact, {
        offMeshConnections: structuredClone(legacyV8Artifact.offMeshConnections),
      })).toBe(false);
      const fullyQualifiedV8Artifact = structuredClone(v9Artifact);
      fullyQualifiedV8Artifact.schemaVersion = "spatial-navigation-v8";
      expect(navigationArtifactSchema.safeParse(fullyQualifiedV8Artifact).success).toBe(false);
      const partiallyQualifiedV8Artifact = structuredClone(fullyQualifiedV8Artifact);
      delete (partiallyQualifiedV8Artifact.offMeshConnections[0] as {
        evidenceReceipt: { adapter?: string };
      }).evidenceReceipt.adapter;
      expect(navigationArtifactSchema.safeParse(partiallyQualifiedV8Artifact).success).toBe(false);
    }
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, etag, sha256, integrity_status
        ) VALUES (?, ?, ?, ?, 'collision', 'glb', ?, 'fixture.collision.glb',
          'model/gltf-binary', 4, 'fixture-etag', ?, 'verified')
      `).bind(
        collisionAssetId,
        provisionalEvidenceOwner!.organisation_id,
        project.id,
        completed.asset.versionId,
        collisionObjectKey,
        collisionSha256,
      ),
      env.DB.prepare(`
        INSERT INTO processing_jobs (
          id, organisation_id, project_id, version_id, input_asset_id, job_type,
          processor_version, idempotency_key, state, progress, progress_message
        ) VALUES (?, ?, ?, ?, ?, 'navigation.build-v1', 'spatial-processor/0.9.0',
          ?, 'SUCCEEDED', 100, 'Fixture Recast and Rapier evidence accepted')
      `).bind(
        navigationJobId,
        provisionalEvidenceOwner!.organisation_id,
        project.id,
        completed.asset.versionId,
        collisionAssetId,
        `navigation-build-fixture:${navigationBuildId}`,
      ),
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, etag, sha256, integrity_status
        ) VALUES (?, ?, ?, ?, 'report', 'json', ?, 'navigation.json',
          'application/json', 2048, 'report-etag', ?, 'verified')
      `).bind(
        navigationReportAssetId,
        provisionalEvidenceOwner!.organisation_id,
        project.id,
        completed.asset.versionId,
        `reports-private/${provisionalEvidenceOwner!.organisation_id}/${project.id}/${completed.asset.versionId}/navigation.json`,
        navigationReportSha256,
      ),
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, etag, sha256, integrity_status
        ) VALUES (?, ?, ?, ?, 'navmesh', 'bin', ?, 'navigation.bin',
          'application/octet-stream', 64, 'detour-etag', ?, 'verified')
      `).bind(
        navigationDetourAssetId,
        provisionalEvidenceOwner!.organisation_id,
        project.id,
        completed.asset.versionId,
        `delivery-private/${provisionalEvidenceOwner!.organisation_id}/${project.id}/${completed.asset.versionId}/navigation.bin`,
        navigationDetourSha256,
      ),
      env.DB.prepare(`
        INSERT INTO scene_navigation_builds (
          id, organisation_id, project_id, version_id, collision_asset_id,
          job_id, status, parameters_json, artifact_json, navmesh_asset_id,
          report_asset_id, client_operation_id,
          request_hash, authoring_hash, created_by, reviewed_by, review_note, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', '{}', ?, ?, ?, ?, ?, ?, ?, ?,
          'Reviewed whole-scene reachability and capsule-collision evidence.', datetime('now'))
      `).bind(
        navigationBuildId,
        provisionalEvidenceOwner!.organisation_id,
        project.id,
        completed.asset.versionId,
        collisionAssetId,
        navigationJobId,
        JSON.stringify(navigationArtifact),
        navigationDetourAssetId,
        navigationReportAssetId,
        crypto.randomUUID(),
        "e".repeat(64),
        navigationAuthoringHash,
        provisionalEvidenceOwner!.created_by,
        provisionalEvidenceOwner!.created_by,
      ),
    ]);

    const walkTestResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/navigation-builds/${navigationBuildId}/walk-tests`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          versionId: completed.asset.versionId,
          startPose: { position: [0.5, 1.6, 0.5], target: [0.5, 1.6, 0] },
          endPose: { position: [0.7, 1.6, 0.7], target: [0.7, 1.6, 0.2] },
          runtimeEvidence: {
            movementObserved: true,
            collisionFailureReported: false,
            traversalBlockReported: false,
          },
        }),
      },
    );
    expect(walkTestResponse.status).toBe(201);

    const unsupportedFlyRelease = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "v6-cannot-default-to-fly",
          accessPolicy: "unlisted",
          viewerConfig: {
            title: "Unsafe v6 Fly default",
            measurementDisclaimer: VISUAL_ONLY_MEASUREMENT_DISCLAIMER,
            defaultMovementMode: "fly",
          },
        }),
      },
    );
    expect(unsupportedFlyRelease.status).toBe(422);
    await expect(unsupportedFlyRelease.json()).resolves.toMatchObject({
      details: {
        defaultMovementMode: [expect.stringContaining("walking")],
      },
    });

    const navigationReportKey =
      `reports-private/${provisionalEvidenceOwner!.organisation_id}/${project.id}/${completed.asset.versionId}/navigation.json`;
    const navigationDetourKey =
      `delivery-private/${provisionalEvidenceOwner!.organisation_id}/${project.id}/${completed.asset.versionId}/navigation.bin`;
    await Promise.all([
      env.SPATIAL_ASSETS.put(navigationReportKey, new Uint8Array(2048), {
        customMetadata: { sha256: navigationReportSha256 },
      }),
      env.SPATIAL_ASSETS.put(navigationDetourKey, new Uint8Array(64), {
        customMetadata: { sha256: navigationDetourSha256 },
      }),
      env.DB.prepare(`
        UPDATE scene_navigation_builds SET artifact_json = ? WHERE id = ?
      `).bind(JSON.stringify(v7ArtifactContract.data), navigationBuildId).run(),
    ]);

    const unregisteredWalkableApprovalResponse = await exports.default.fetch(
      `${origin}/api/versions/${completed.asset.versionId}/approve`,
      approvalRequest,
    );
    expect(unregisteredWalkableApprovalResponse.status).toBe(409);
    await expect(unregisteredWalkableApprovalResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("verified capture-to-scene registration"),
    });

    // A shell drawn on one visual master registers by naming that master, but
    // only when the Worker can match the digest to a verified master on the
    // same version. A shell naming a master that is not there stays blocked,
    // otherwise the receipt would rest on the claim rather than the check.
    const bindingArtifact = structuredClone(v7ArtifactContract.data) as Record<string, unknown>;
    const bindingSource = { ...(bindingArtifact.source as Record<string, unknown>) };
    bindingSource.authoredVisualBinding = { visualMasterSha256: "c".repeat(64) };
    bindingArtifact.source = bindingSource;
    await env.DB.prepare(`UPDATE scene_navigation_builds SET artifact_json = ? WHERE id = ?`)
      .bind(JSON.stringify(bindingArtifact), navigationBuildId).run();
    const unmatchedBindingResponse = await exports.default.fetch(
      `${origin}/api/versions/${completed.asset.versionId}/approve`,
      approvalRequest,
    );
    expect(unmatchedBindingResponse.status).toBe(409);
    await expect(unmatchedBindingResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("verified capture-to-scene registration"),
    });

    const boundMasterSha256 = await sha256Hex(sceneBytes);
    await env.DB.prepare(`
      INSERT INTO assets (
        id, organisation_id, project_id, version_id, kind, format, object_key,
        file_name, mime_type, size_bytes, etag, sha256, integrity_status
      ) VALUES (?, ?, ?, ?, 'master', 'ply', ?, 'authored-visual-master.ply',
        'application/octet-stream', 128, 'master-etag', ?, 'verified')
    `).bind(
      crypto.randomUUID(),
      provisionalEvidenceOwner!.organisation_id,
      project.id,
      completed.asset.versionId,
      `masters-private/${provisionalEvidenceOwner!.organisation_id}/${project.id}/${completed.asset.versionId}/authored-visual-master.ply`,
      boundMasterSha256,
    ).run();
    bindingSource.authoredVisualBinding = { visualMasterSha256: boundMasterSha256 };
    bindingArtifact.source = bindingSource;
    await env.DB.prepare(`UPDATE scene_navigation_builds SET artifact_json = ? WHERE id = ?`)
      .bind(JSON.stringify(bindingArtifact), navigationBuildId).run();
    const matchedBindingResponse = await exports.default.fetch(
      `${origin}/api/versions/${completed.asset.versionId}/approve`,
      approvalRequest,
    );
    expect(matchedBindingResponse.status).not.toBe(409);

    await env.DB.prepare(`UPDATE scene_navigation_builds SET artifact_json = ? WHERE id = ?`)
      .bind(JSON.stringify(v7ArtifactContract.data), navigationBuildId).run();

    const pairedJourneyId = crypto.randomUUID();
    const pairedGeometryAssetId = crypto.randomUUID();
    const pairedVisualSha256 = await sha256Hex(sceneBytes);
    const processorCoordinateEvidence = {
      schemaVersion: "ply-coordinate-evidence-v1",
      method: "automatic-ply-coordinate-evidence-v1",
      coordinateFrameId: `capture-journey:${pairedJourneyId}`,
      sourceUpAxis: "Y",
      worldUnit: "metres",
      vertexCount: 2,
      finitePointCount: 2,
      bounds: { min: [0, 0, 0], max: [2, 2, 2] },
    };
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE assets SET sha256 = ? WHERE id = ? AND version_id = ?
      `).bind(
        pairedVisualSha256,
        completed.asset.id,
        completed.asset.versionId,
      ),
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, sha256, integrity_status
        ) VALUES (?, ?, ?, ?, 'pointcloud', 'ply', ?, 'registered-room.ply',
          'application/octet-stream', 128, ?, 'verified')
      `).bind(
        pairedGeometryAssetId,
        provisionalEvidenceOwner!.organisation_id,
        project.id,
        completed.asset.versionId,
        `raw-private/${provisionalEvidenceOwner!.organisation_id}/${project.id}/${completed.asset.versionId}/${pairedGeometryAssetId}/registered-room.ply`,
        "9".repeat(64),
      ),
      env.DB.prepare(`
        UPDATE scene_versions SET source_provenance_json = ? WHERE id = ?
      `).bind(JSON.stringify({
        adapter: "open-import",
        captureJourney: {
          schemaVersion: "paired-capture-journey-v2",
          id: pairedJourneyId,
          captureAdapter: "open-import",
          primaryAssetId: completed.asset.id,
          geometryAssetId: pairedGeometryAssetId,
          declaration: "same-capture-registered-y-up-metres",
          sourceCoordinateFrameId: `capture-journey:${pairedJourneyId}`,
          confirmedBy: provisionalEvidenceOwner!.created_by,
          confirmedAt: new Date().toISOString(),
          qualification: {
            method: "automatic-ply-coordinate-evidence-v1",
            status: "verified",
            coordinateFrameId: `capture-journey:${pairedJourneyId}`,
            sourceUpAxis: "Y",
            worldUnit: "metres",
            overlapBounds: { min: [0, 0, 0], max: [2, 2, 2] },
            visual: processorCoordinateEvidence,
            geometry: processorCoordinateEvidence,
          },
        },
      }), completed.asset.versionId),
    ]);

    const walkableApprovalResponse = await exports.default.fetch(
      `${origin}/api/versions/${completed.asset.versionId}/approve`,
      approvalRequest,
    );
    expect(
      walkableApprovalResponse.status,
      JSON.stringify(await walkableApprovalResponse.clone().json()),
    ).toBe(200);
    const repeatedWalkableApprovalResponse = await exports.default.fetch(
      `${origin}/api/versions/${completed.asset.versionId}/approve`,
      approvalRequest,
    );
    expect(repeatedWalkableApprovalResponse.status).toBe(200);
    await expect(repeatedWalkableApprovalResponse.json()).resolves.toMatchObject({
      idempotent: true,
    });

    const privatePreviewResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/versions/${completed.asset.versionId}/preview`,
      { headers: { cookie } },
    );
    expect(privatePreviewResponse.status).toBe(200);
    const privatePreview = await privatePreviewResponse.json<{
      manifest: { scene: { collisionUrl: string } };
    }>();
    expect(privatePreview).toMatchObject({
      manifest: {
        scene: {
          collisionUrl: expect.stringContaining(`/${collisionAssetId}/fixture.collision.glb`),
        },
        spatial: {
          navigationArtifact: { schemaVersion: "spatial-navigation-v7" },
        },
      },
    });
    const privateCollisionResponse = await exports.default.fetch(
      new URL(privatePreview.manifest.scene.collisionUrl, origin),
    );
    expect(privateCollisionResponse.status).toBe(200);
    expect(new Uint8Array(await privateCollisionResponse.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    await env.SPATIAL_ASSETS.delete(navigationReportKey);
    const missingNavigationObjectRelease = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          slug: "missing-navigation-object",
          accessPolicy: "unlisted",
          viewerConfig: {
            title: "Missing navigation object",
            measurementDisclaimer: VISUAL_ONLY_MEASUREMENT_DISCLAIMER,
          },
        }),
      },
    );
    expect(missingNavigationObjectRelease.status).toBe(409);
    await expect(missingNavigationObjectRelease.json()).resolves.toMatchObject({
      error: expect.stringContaining("must all be present and verified"),
    });
    await env.SPATIAL_ASSETS.put(navigationReportKey, new Uint8Array(2048), {
      customMetadata: { sha256: navigationReportSha256 },
    });

    const releaseResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: "55555555-5555-4555-8555-555555555555",
          slug: "publishable-apartment",
          accessPolicy: "public",
          viewerConfig: {
            title: "Publishable apartment",
            measurementDisclaimer: VISUAL_ONLY_MEASUREMENT_DISCLAIMER,
            splatBudgetMillions: 1,
            initialCamera: {
              position: [3.14, 0.18, -3.56],
              target: [3.08, -0.31, -2.69],
              up: [-0.01, -0.87, -0.49],
              fovDegrees: 58,
            },
          },
        }),
      },
    );
    expect(releaseResponse.status).toBe(201);
    const release = await releaseResponse.clone().json<{
      release: { id: string; slug: string; releaseNumber: number; versionNumber: number };
    }>();
    expect(release.release).toMatchObject({ releaseNumber: 1, versionNumber: 1 });
    const storedSnapshot = await env.DB.prepare(`
      SELECT spatial_snapshot_json FROM releases WHERE id = ?
    `).bind(release.release.id).first<{ spatial_snapshot_json: string }>();
    const telemetrySnapshot = JSON.parse(storedSnapshot!.spatial_snapshot_json) as Record<string, unknown>;
    telemetrySnapshot.navigationArtifact = telemetryNavigationArtifact;
    await env.DB.prepare(`
      UPDATE releases SET spatial_snapshot_json = ? WHERE id = ?
    `).bind(JSON.stringify(telemetrySnapshot), release.release.id).run();
    const republishIntentId = crypto.randomUUID();
    const channelBeforeRepublish = await env.DB.prepare(`
      SELECT id, activation_generation FROM release_channels WHERE active_release_id = ?
    `).bind(release.release.id).first<{ id: string; activation_generation: number }>();
    expect(channelBeforeRepublish).toBeTruthy();
    await env.DB.prepare(`
      INSERT INTO release_republish_intents (
        id, organisation_id, project_id, version_id, navigation_build_id,
        source_release_id, status, requested_by, client_operation_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      republishIntentId,
      provisionalEvidenceOwner!.organisation_id,
      project.id,
      completed.asset.versionId,
      navigationBuildId,
      release.release.id,
      provisionalEvidenceOwner!.created_by,
      crypto.randomUUID(),
    ).run();
    const republished = await completeReleaseRepublishIntent(
      env,
      navigationBuildId,
      "durable-republish-test",
    );
    expect(republished).toMatchObject({
      id: republishIntentId,
      status: "completed",
      releaseId: expect.any(String),
      error: null,
    });
    const republishedRelease = await env.DB.prepare(`
      SELECT r.id, r.release_number, r.viewer_config_json, r.spatial_snapshot_json,
        rc.active_release_id
      FROM releases r
      JOIN release_channels rc ON rc.project_id = r.project_id
        AND rc.organisation_id = r.organisation_id
      WHERE r.id = ?
    `).bind(republished!.releaseId).first<{
      id: string;
      release_number: number;
      viewer_config_json: string;
      spatial_snapshot_json: string;
      active_release_id: string;
    }>();
    expect(republishedRelease).toMatchObject({
      id: republished!.releaseId,
      release_number: 2,
      active_release_id: republished!.releaseId,
    });
    expect(JSON.parse(republishedRelease!.viewer_config_json)).toEqual(
      JSON.parse((await env.DB.prepare(
        "SELECT viewer_config_json FROM releases WHERE id = ?",
      ).bind(release.release.id).first<{ viewer_config_json: string }>())!.viewer_config_json),
    );
    expect(JSON.parse(republishedRelease!.spatial_snapshot_json)).toMatchObject({
      navigationAssets: { buildId: navigationBuildId },
    });
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE release_channels
        SET active_release_id = ?, activation_generation = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        release.release.id,
        channelBeforeRepublish!.activation_generation,
        channelBeforeRepublish!.id,
      ),
      env.DB.prepare("DELETE FROM release_republish_intents WHERE id = ?")
        .bind(republishIntentId),
      env.DB.prepare("DELETE FROM releases WHERE id = ?")
        .bind(republished!.releaseId),
    ]);
    const publishedManifestResponse = await exports.default.fetch(
      `${origin}/api/releases/${release.release.slug}/manifest`,
    );
    expect(publishedManifestResponse.status).toBe(200);
    expect(publishedManifestResponse.headers.get("cache-control")).toBe("private, no-store");
    await expect(publishedManifestResponse.json()).resolves.not.toHaveProperty("telemetry");
    const unauthenticatedTelemetrySession = await exports.default.fetch(
      `${origin}/api/releases/${release.release.slug}/telemetry-session`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          releaseId: release.release.id,
        }),
      },
    );
    expect(unauthenticatedTelemetrySession.status).toBe(401);
    const issueTelemetrySession = () => exports.default.fetch(
      `${origin}/api/releases/${release.release.slug}/telemetry-session`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ releaseId: release.release.id }),
      },
    );
    const [telemetrySessionResponse, concurrentTelemetrySessionResponse] =
      await Promise.all([issueTelemetrySession(), issueTelemetrySession()]);
    expect(telemetrySessionResponse.status).toBe(200);
    expect(concurrentTelemetrySessionResponse.status).toBe(200);
    expect(telemetrySessionResponse.headers.get("cache-control")).toBe("private, no-store");
    const publishedTelemetry = await telemetrySessionResponse.json<{
      sessionId: string;
      token: string;
      expiresAtEpochSeconds: number;
    }>();
    await expect(concurrentTelemetrySessionResponse.json()).resolves.toMatchObject({
      sessionId: publishedTelemetry.sessionId,
    });
    const retriedTelemetryResponse = await exports.default.fetch(
      `${origin}/api/releases/${release.release.slug}/telemetry-session`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          releaseId: release.release.id,
        }),
      },
    );
    expect(retriedTelemetryResponse.status).toBe(200);
    const retriedTelemetry = await retriedTelemetryResponse.json<{
      sessionId: string;
      token: string;
      expiresAtEpochSeconds: number;
    }>();
    expect(retriedTelemetry.sessionId).toBe(publishedTelemetry.sessionId);
    const renewedTelemetryResponse = await exports.default.fetch(
      `${origin}/api/releases/${release.release.slug}/telemetry-session`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          releaseId: release.release.id,
          sessionId: publishedTelemetry.sessionId,
        }),
      },
    );
    expect(renewedTelemetryResponse.status).toBe(200);
    const renewedTelemetry = await renewedTelemetryResponse.json<{
      sessionId: string;
      token: string;
      expiresAtEpochSeconds: number;
    }>();
    expect(renewedTelemetry.sessionId).toBe(publishedTelemetry.sessionId);
    expect(renewedTelemetry.expiresAtEpochSeconds).toBeGreaterThanOrEqual(
      publishedTelemetry.expiresAtEpochSeconds,
    );
    const substitutedSessionResponse = await exports.default.fetch(
      `${origin}/api/releases/${release.release.slug}/telemetry-session`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          releaseId: release.release.id,
          sessionId: "99999999-9999-4999-8999-999999999999",
        }),
      },
    );
    expect(substitutedSessionResponse.status).toBe(410);
    const activeSessionCount = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM viewer_telemetry_sessions WHERE release_id = ?
    `).bind(release.release.id).first<{ count: number }>();
    expect(activeSessionCount?.count).toBe(1);
    const rejectedTelemetryAssetAccess = await exports.default.fetch(
      `${origin}/asset/${release.release.id}/${completed.asset.id}/scene.rad?token=${encodeURIComponent(publishedTelemetry.token)}`,
    );
    expect(rejectedTelemetryAssetAccess.status).toBe(401);
    const rejectedUnknownTraversal = await exports.default.fetch(`${origin}/api/telemetry`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${publishedTelemetry.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        releaseId: release.release.id,
        eventType: "navigation_traversal",
        sessionId: publishedTelemetry.sessionId,
        metadata: { connectionId: "invented-lift", phase: "completed" },
      }),
    });
    expect(rejectedUnknownTraversal.status).toBe(422);
    const rejectedSubstitutedReceipt = await exports.default.fetch(`${origin}/api/telemetry`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${publishedTelemetry.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        releaseId: release.release.id,
        eventType: "navigation_traversal",
        sessionId: publishedTelemetry.sessionId,
        metadata: {
          connectionId: "gallery-lift",
          phase: "completed",
          registrationSha256: "d".repeat(64),
        },
      }),
    });
    expect(rejectedSubstitutedReceipt.status).toBe(400);
    const expiredTelemetryToken = await signSceneToken({
      releaseId: release.release.id,
      expiresAt: Math.floor(Date.now() / 1000) - 1,
      scope: "telemetry",
      sessionId: publishedTelemetry.sessionId,
      channelActivationGeneration: 1,
    }, env.SESSION_PEPPER);
    const rejectedExpiredSession = await exports.default.fetch(`${origin}/api/telemetry`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${expiredTelemetryToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        releaseId: release.release.id,
        eventType: "navigation_traversal",
        sessionId: publishedTelemetry.sessionId,
        metadata: { connectionId: "gallery-lift", phase: "started" },
      }),
    });
    expect(rejectedExpiredSession.status).toBe(401);
    for (const phase of ["started", "completed"] as const) {
      const traversalTelemetry = await exports.default.fetch(`${origin}/api/telemetry`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${publishedTelemetry.token}`,
          "content-type": "application/json",
          "CF-Connecting-IP": "2001:db8::7777",
        },
        body: JSON.stringify({
          releaseId: release.release.id,
          eventType: "navigation_traversal",
          sessionId: publishedTelemetry.sessionId,
          deviceProfile: "physical-device-under-review",
          metadata: {
            connectionId: "gallery-lift",
            phase,
          },
        }),
      });
      expect(traversalTelemetry.status).toBe(204);
    }
    const storedTraversalTelemetry = await env.DB.prepare(`
      SELECT event_type, session_id, device_profile, metadata_json,
        received_at_ms, session_sequence
      FROM viewer_events
      WHERE release_id = ? AND session_id = ?
      ORDER BY session_sequence
    `).bind(release.release.id, publishedTelemetry.sessionId).all<{
      event_type: string;
      session_id: string;
      device_profile: string;
      metadata_json: string;
      received_at_ms: number;
      session_sequence: number;
    }>();
    expect(storedTraversalTelemetry.results).toHaveLength(2);
    expect(storedTraversalTelemetry.results.map((event) => event.session_sequence)).toEqual([1, 2]);
    expect(storedTraversalTelemetry.results.every((event) =>
      Number.isSafeInteger(event.received_at_ms)
    )).toBe(true);
    expect(storedTraversalTelemetry.results[1]).toMatchObject({
      event_type: "navigation_traversal",
      session_id: publishedTelemetry.sessionId,
      device_profile: "physical-device-under-review",
    });
    expect(JSON.parse(storedTraversalTelemetry.results[1]!.metadata_json)).toEqual({
      connectionId: "gallery-lift",
      traversalKind: "elevator",
      label: "Gallery lift",
      phase: "completed",
      adapter: "xgrids-lcc",
      manifestSha256: "b".repeat(64),
      reviewGeneration: 1,
      registrationSha256: "c".repeat(64),
      sourceToWorld: {
        sourceUpAxis: "Y",
        worldUnit: "metres",
        metresPerSourceUnit: 1,
        yawDegrees: 0,
        translationMetres: [0, 0, 0],
      },
      sourcePath: [[0.5, 0, 0.5], [0.5, 2.6, 0.5], [0.7, 2.55, 0.7]],
    });
    await env.DB.prepare(`
      UPDATE viewer_telemetry_sessions
      SET expires_at_epoch = unixepoch('now') - 1
      WHERE id = ?
    `).bind(publishedTelemetry.sessionId).run();
    const expiredRunLifecycleResponse = await exports.default.fetch(
      `${origin}/api/hosting/lifecycle/run`,
      { method: "POST", headers: { cookie } },
    );
    expect(expiredRunLifecycleResponse.status).toBe(200);
    const expiredRunLifecycle = await expiredRunLifecycleResponse.json<{
      summary: { telemetrySessionsRetired: number };
    }>();
    expect(expiredRunLifecycle.summary.telemetrySessionsRetired).toBeGreaterThanOrEqual(1);
    const resumedSessionResponse = await exports.default.fetch(
      `${origin}/api/releases/${release.release.slug}/telemetry-session`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          releaseId: release.release.id,
          sessionId: publishedTelemetry.sessionId,
        }),
      },
    );
    expect(resumedSessionResponse.status).toBe(200);
    const resumedTelemetry = await resumedSessionResponse.json<{
      sessionId: string;
      token: string;
    }>();
    expect(resumedTelemetry.sessionId).toBe(publishedTelemetry.sessionId);
    const resumedTraversal = await exports.default.fetch(`${origin}/api/telemetry`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${resumedTelemetry.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        releaseId: release.release.id,
        eventType: "navigation_traversal",
        sessionId: resumedTelemetry.sessionId,
        deviceProfile: "physical-device-under-review",
        metadata: { connectionId: "gallery-lift", phase: "started" },
      }),
    });
    expect(resumedTraversal.status).toBe(204);
    const resumedSequences = await env.DB.prepare(`
      SELECT session_sequence FROM viewer_events
      WHERE release_id = ? AND session_id = ?
      ORDER BY session_sequence
    `).bind(release.release.id, publishedTelemetry.sessionId).all<{
      session_sequence: number;
    }>();
    expect(resumedSequences.results.map((event) => event.session_sequence)).toEqual([1, 2, 3]);
    const traversalEvidenceExport = await exports.default.fetch(
      `${origin}/api/releases/${release.release.id}/navigation-traversal-evidence`,
      { headers: { cookie } },
    );
    expect(traversalEvidenceExport.status).toBe(200);
    const exportBytes = await traversalEvidenceExport.clone().arrayBuffer();
    const exportDigest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", exportBytes)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(traversalEvidenceExport.headers.get("x-spatial-sha256")).toBe(exportDigest);
    expect(traversalEvidenceExport.headers.get("content-disposition")).toContain(
      exportDigest,
    );
    await expect(traversalEvidenceExport.json()).resolves.toMatchObject({
      schemaVersion: "navigation-traversal-evidence-export-v1",
      release: { id: release.release.id, releaseNumber: 1, versionNumber: 1 },
      events: [
        {
          sessionId: publishedTelemetry.sessionId,
          sessionSequence: 1,
          evidence: { connectionId: "gallery-lift", phase: "started" },
        },
        {
          sessionId: publishedTelemetry.sessionId,
          sessionSequence: 2,
          evidence: {
            connectionId: "gallery-lift",
            phase: "completed",
            registrationSha256: "c".repeat(64),
          },
        },
        {
          sessionId: publishedTelemetry.sessionId,
          sessionSequence: 3,
          evidence: { connectionId: "gallery-lift", phase: "started" },
        },
      ],
    });
    const secondPhysicalDeviceCookie = await login();
    const inactiveSessionResponse = await exports.default.fetch(
      `${origin}/api/releases/${release.release.slug}/telemetry-session`,
      {
        method: "POST",
        headers: { cookie: secondPhysicalDeviceCookie, "content-type": "application/json" },
        body: JSON.stringify({
          releaseId: release.release.id,
        }),
      },
    );
    expect(inactiveSessionResponse.status).toBe(200);
    const inactiveSession = await inactiveSessionResponse.json<{
      sessionId: string;
      token: string;
    }>();
    expect(inactiveSession.sessionId).not.toBe(publishedTelemetry.sessionId);
    const secondDeviceLogout = await exports.default.fetch(`${origin}/api/auth/session`, {
      method: "DELETE",
      headers: { cookie: secondPhysicalDeviceCookie },
    });
    expect(secondDeviceLogout.status).toBe(204);
    const revokedAuthTelemetry = await exports.default.fetch(`${origin}/api/telemetry`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${inactiveSession.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        releaseId: release.release.id,
        eventType: "navigation_traversal",
        sessionId: inactiveSession.sessionId,
        deviceProfile: "revoked-auth-session",
        metadata: { connectionId: "gallery-lift", phase: "completed" },
      }),
    });
    expect(revokedAuthTelemetry.status).toBe(401);
    await expect(revokedAuthTelemetry.json()).resolves.toMatchObject({
      error: "Reviewer authorization has ended",
    });
    const reviewOwner = await env.DB.prepare(`
      SELECT organisation_id, created_by FROM projects WHERE id = ?
    `).bind(project.id).first<{ organisation_id: string; created_by: string }>();
    expect(reviewOwner).toBeTruthy();
    const reviewerUserId = crypto.randomUUID();
    const reviewerAuthSessionId = crypto.randomUUID();
    const reviewerEmail = `traversal-reviewer-${reviewerUserId.slice(0, 8)}@example.com`;
    const reviewerRefreshSecret = `traversal-reviewer-${reviewerAuthSessionId}`;
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, display_name)
        VALUES (?, ?, 'Traversal reviewer')
      `).bind(reviewerUserId, reviewerEmail),
      env.DB.prepare(`
        INSERT INTO memberships (organisation_id, user_id, role)
        VALUES (?, ?, 'customer_reviewer')
      `).bind(reviewOwner!.organisation_id, reviewerUserId),
      env.DB.prepare(`
        INSERT INTO project_access
          (organisation_id, project_id, user_id, role, invited_by)
        VALUES (?, ?, ?, 'customer_reviewer', ?)
      `).bind(
        reviewOwner!.organisation_id,
        project.id,
        reviewerUserId,
        reviewOwner!.created_by,
      ),
      env.DB.prepare(`
        INSERT INTO auth_sessions
          (id, user_id, organisation_id, refresh_token_hash, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        reviewerAuthSessionId,
        reviewerUserId,
        reviewOwner!.organisation_id,
        await sha256Hex(`${reviewerRefreshSecret}:${env.REFRESH_TOKEN_PEPPER}`),
        new Date(Date.now() + 60_000).toISOString(),
      ),
    ]);
    const reviewerTokens = await issueAuthTokens(env, {
      userId: reviewerUserId,
      organisationId: reviewOwner!.organisation_id,
      email: reviewerEmail,
      displayName: "Traversal reviewer",
      role: "customer_reviewer",
    }, reviewerAuthSessionId, reviewerRefreshSecret);
    const reviewerSessionResponse = await exports.default.fetch(
      `${origin}/api/releases/${release.release.slug}/telemetry-session`,
      {
        method: "POST",
        headers: {
          cookie: `spatial_access=${reviewerTokens.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ releaseId: release.release.id }),
      },
    );
    expect(reviewerSessionResponse.status).toBe(200);
    const reviewerTelemetry = await reviewerSessionResponse.json<{
      sessionId: string;
      token: string;
    }>();
    await env.DB.prepare(`
      UPDATE project_access SET revoked_at = datetime('now')
      WHERE project_id = ? AND user_id = ?
    `).bind(project.id, reviewerUserId).run();
    const revokedProjectAccessTelemetry = await exports.default.fetch(
      `${origin}/api/telemetry`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${reviewerTelemetry.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          releaseId: release.release.id,
          eventType: "navigation_traversal",
          sessionId: reviewerTelemetry.sessionId,
          deviceProfile: "revoked-project-access",
          metadata: { connectionId: "gallery-lift", phase: "completed" },
        }),
      },
    );
    expect(revokedProjectAccessTelemetry.status).toBe(401);
    await expect(revokedProjectAccessTelemetry.json()).resolves.toMatchObject({
      error: "Reviewer authorization has ended",
    });
    await env.DB.prepare(`
      UPDATE releases SET expires_at = ? WHERE id = ?
    `).bind(new Date(Date.now() - 1_000).toISOString(), release.release.id).run();
    const expiredReleaseTelemetry = await exports.default.fetch(`${origin}/api/telemetry`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${publishedTelemetry.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        releaseId: release.release.id,
        eventType: "navigation_traversal",
        sessionId: publishedTelemetry.sessionId,
        deviceProfile: "expired-iso-release",
        metadata: { connectionId: "gallery-lift", phase: "completed" },
      }),
    });
    expect(expiredReleaseTelemetry.status).toBe(410);
    await expect(expiredReleaseTelemetry.json()).resolves.toMatchObject({
      error: "This scene is no longer available",
    });
    await env.DB.prepare(`
      UPDATE releases SET expires_at = NULL WHERE id = ?
    `).bind(release.release.id).run();
    await env.DB.prepare(`
      UPDATE viewer_telemetry_sessions
      SET expires_at_epoch = unixepoch('now') - 1
      WHERE id IN (?, ?)
    `).bind(inactiveSession.sessionId, reviewerTelemetry.sessionId).run();
    const lifecycleResponse = await exports.default.fetch(
      `${origin}/api/hosting/lifecycle/run`,
      { method: "POST", headers: { cookie } },
    );
    expect(lifecycleResponse.status).toBe(200);
    const lifecycle = await lifecycleResponse.json<{
      summary: { telemetrySessionsRetired: number };
    }>();
    expect(lifecycle.summary.telemetrySessionsRetired).toBeGreaterThanOrEqual(1);
    const sessionsAfterExpiry = await env.DB.prepare(`
      SELECT id FROM viewer_telemetry_sessions WHERE release_id = ? ORDER BY id
    `).bind(release.release.id).all<{ id: string }>();
    expect(sessionsAfterExpiry.results).toEqual([{ id: publishedTelemetry.sessionId }]);
    const telemetryCapacityOwner = await env.DB.prepare(`
      SELECT organisation_id, created_by FROM projects WHERE id = ?
    `).bind(project.id).first<{
      organisation_id: string;
      created_by: string;
    }>();
    const telemetryCapacityChannel = await env.DB.prepare(`
      SELECT id, activation_generation FROM release_channels WHERE slug = ?
    `).bind(release.release.slug).first<{
      id: string;
      activation_generation: number;
    }>();
    expect(telemetryCapacityOwner).toBeTruthy();
    expect(telemetryCapacityChannel).toBeTruthy();
    await env.DB.prepare(`
      WITH RECURSIVE sequence(number) AS (
        SELECT 1
        UNION ALL
        SELECT number + 1 FROM sequence WHERE number < 501
      )
      INSERT INTO auth_sessions (
        id, user_id, organisation_id, refresh_token_hash, expires_at,
        last_seen_at, created_at
      )
      SELECT printf('telemetry-capacity-auth-%04d', number), ?, ?,
        printf('telemetry-capacity-refresh-%04d', number),
        datetime('now', '+1 day'), datetime('now'), datetime('now')
      FROM sequence
    `).bind(
      telemetryCapacityOwner!.created_by,
      telemetryCapacityOwner!.organisation_id,
    ).run();
    await env.DB.prepare(`
      WITH RECURSIVE sequence(number) AS (
        SELECT 1
        UNION ALL
        SELECT number + 1 FROM sequence WHERE number < 501
      )
      INSERT INTO viewer_telemetry_sessions (
        id, release_id, channel_id, created_by, auth_session_id,
        activation_generation, expires_at_epoch, next_sequence
      )
      SELECT printf('telemetry-capacity-run-%04d', number), ?, ?, ?,
        printf('telemetry-capacity-auth-%04d', number), ?,
        unixepoch('now') - 1, 1
      FROM sequence
    `).bind(
      release.release.id,
      telemetryCapacityChannel!.id,
      telemetryCapacityOwner!.created_by,
      telemetryCapacityChannel!.activation_generation,
    ).run();
    const firstCapacityDrainResponse = await exports.default.fetch(
      `${origin}/api/hosting/lifecycle/run`,
      { method: "POST", headers: { cookie } },
    );
    expect(firstCapacityDrainResponse.status).toBe(200);
    const firstCapacityDrain = await firstCapacityDrainResponse.json<{
      summary: {
        telemetrySessionsRetired: number;
        telemetrySessionRowsRead: number;
        telemetrySessionRowsWritten: number;
        telemetrySessionRetirementPending: boolean;
      };
    }>();
    expect(firstCapacityDrain).toMatchObject({
      summary: {
        telemetrySessionsRetired: 500,
        telemetrySessionRetirementPending: true,
      },
    });
    expect(firstCapacityDrain.summary.telemetrySessionRowsRead).toBeGreaterThanOrEqual(500);
    expect(firstCapacityDrain.summary.telemetrySessionRowsWritten).toBe(500);
    const pendingCapacityRows = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM viewer_telemetry_sessions
      WHERE id LIKE 'telemetry-capacity-run-%'
    `).first<{ count: number }>();
    expect(pendingCapacityRows?.count).toBe(1);
    const secondCapacityDrainResponse = await exports.default.fetch(
      `${origin}/api/hosting/lifecycle/run`,
      { method: "POST", headers: { cookie } },
    );
    expect(secondCapacityDrainResponse.status).toBe(200);
    await expect(secondCapacityDrainResponse.json()).resolves.toMatchObject({
      summary: {
        telemetrySessionsRetired: 1,
        telemetrySessionRetirementPending: false,
      },
    });
    await env.DB.prepare(`
      UPDATE releases SET spatial_snapshot_json = ? WHERE id = ?
    `).bind(storedSnapshot!.spatial_snapshot_json, release.release.id).run();
    const repeatedReleaseResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: "55555555-5555-4555-8555-555555555555",
          slug: "publishable-apartment",
          accessPolicy: "public",
          viewerConfig: {
            title: "Publishable apartment",
            measurementDisclaimer: VISUAL_ONLY_MEASUREMENT_DISCLAIMER,
            splatBudgetMillions: 1,
            initialCamera: {
              position: [3.14, 0.18, -3.56],
              target: [3.08, -0.31, -2.69],
              up: [-0.01, -0.87, -0.49],
              fovDegrees: 58,
            },
          },
        }),
      },
    );
    expect(repeatedReleaseResponse.status).toBe(200);
    await expect(repeatedReleaseResponse.json()).resolves.toMatchObject({
      release: {
        id: release.release.id,
        releaseNumber: 1,
        versionNumber: 1,
      },
      idempotent: true,
    });

    const accidentalDuplicateResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: "55555555-5555-4555-8555-555555555556",
          slug: "publishable-apartment",
          accessPolicy: "public",
          viewerConfig: {
            title: "Publishable apartment",
            measurementDisclaimer: VISUAL_ONLY_MEASUREMENT_DISCLAIMER,
            splatBudgetMillions: 1,
            initialCamera: {
              position: [3.14, 0.18, -3.56],
              target: [3.08, -0.31, -2.69],
              up: [-0.01, -0.87, -0.49],
              fovDegrees: 58,
            },
          },
        }),
      },
    );
    expect(accidentalDuplicateResponse.status).toBe(200);
    await expect(accidentalDuplicateResponse.json()).resolves.toMatchObject({
      release: { id: release.release.id, releaseNumber: 1, versionNumber: 1 },
      idempotent: true,
      duplicate: true,
    });

    const revisedReleaseResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/releases`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: "55555555-5555-4555-8555-555555555557",
          slug: "publishable-apartment",
          accessPolicy: "public",
          viewerConfig: {
            title: "Publishable apartment — revised presentation",
            measurementDisclaimer: VISUAL_ONLY_MEASUREMENT_DISCLAIMER,
            initialCamera: {
              position: [3.14, 0.18, -3.56],
              target: [3.08, -0.31, -2.69],
              up: [-0.01, -0.87, -0.49],
              fovDegrees: 58,
            },
          },
        }),
      },
    );
    expect(revisedReleaseResponse.status).toBe(201);
    const revisedRelease = await revisedReleaseResponse.json<{
      release: { id: string; releaseNumber: number; versionNumber: number };
    }>();
    expect(revisedRelease.release).toMatchObject({ releaseNumber: 2, versionNumber: 1 });
    expect(revisedRelease.release.id).not.toBe(release.release.id);
    // The publish batch only reports success once the channel actually points at
    // the new release, so a committed release is never left without its channel.
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM releases r
      WHERE r.project_id = ? AND r.revoked_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM release_channels rc
        WHERE rc.active_release_id = r.id OR rc.project_id = r.project_id
      )
    `).bind(project.id).first<{ count: number }>()).toMatchObject({ count: 0 });
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM audit_events
      WHERE action = 'release.publish' AND resource_id IN (?, ?)
    `).bind(release.release.id, revisedRelease.release.id).first<{ count: number }>())
      .toMatchObject({ count: 2 });
    const supersededTelemetryResponse = await exports.default.fetch(`${origin}/api/telemetry`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${renewedTelemetry.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        releaseId: release.release.id,
        eventType: "navigation_traversal",
        sessionId: renewedTelemetry.sessionId,
        metadata: { connectionId: "gallery-lift", phase: "completed" },
      }),
    });
    expect(supersededTelemetryResponse.status).toBe(410);
    const retiredSessionCount = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM viewer_telemetry_sessions WHERE release_id = ?
    `).bind(release.release.id).first<{ count: number }>();
    expect(retiredSessionCount?.count).toBe(1);
    const supersededAssetResponse = await exports.default.fetch(new URL(
      `/public-asset/${release.release.id}/${upload.assetId}/scene.rad`,
      origin,
    ));
    expect(supersededAssetResponse.status).toBe(404);

    const releasesResponse = await exports.default.fetch(`${origin}/api/releases`, {
      headers: { cookie },
    });
    expect(releasesResponse.status).toBe(200);
    const releaseInventory = await releasesResponse.json<{
      releases: Array<Record<string, unknown>>;
    }>();
    expect(releaseInventory.releases).toHaveLength(2);
    expect(releaseInventory.releases[0]).toMatchObject({
      id: revisedRelease.release.id,
      project_id: project.id,
      project_name: "Publishable apartment",
      version_number: 1,
      release_number: 2,
      slug: "publishable-apartment",
      is_active: 1,
    });

    const manifestResponse = await exports.default.fetch(
      `${origin}/api/releases/publishable-apartment/manifest`,
    );
    expect(manifestResponse.status).toBe(200);
    const manifest = await manifestResponse.json<{
      release: { number: number };
      project: { versionNumber: number };
      scene: {
        contentUrl: string;
        posterUrl: string | null;
        collisionUrl: string | null;
        detourUrl: string | null;
        navMeshUrl: string | null;
      };
      spatial: {
        entities: Array<{ id: string; label: string }>;
        navigationMesh: { indices: number[]; sourceEntityIds: string[] };
        obstacleProxy: {
          boxes: Array<{
            entityId: string;
            min: [number, number, number];
            max: [number, number, number];
          }>;
        };
        navigationArtifact: {
          schemaVersion: string;
          source: { assetId: string };
          physicalValidation: { passed: boolean; routeCount: number };
        };
        navigationAssets: {
          buildId: string;
          authoringHash: string;
          artifact: { assetId: string; format: "json"; sha256: string; sizeBytes: number };
          detour: { assetId: string; format: "bin"; sha256: string; sizeBytes: number };
        };
      };
      viewer: {
        splatBudgetMillions: number | null;
        initialCamera: {
          position: [number, number, number];
          target: [number, number, number];
          up: [number, number, number];
          fovDegrees: number;
        };
      };
      integrity: {
        assetSha256: string | null;
        sessionId: string;
        sessionExpiresAt: string;
        sessionHardExpiresAt: string;
        sessionRenewalPath: string;
      };
    }>();
    expect(manifest.release.number).toBe(2);
    expect(manifest.project.versionNumber).toBe(1);
    expect(manifest.scene.contentUrl).toContain("/public-asset/");
    expect(manifest.scene.contentUrl).not.toContain("?token=");
    expect(manifest.scene.posterUrl).toContain(
      `/${generatedPosterAssetId}/poster.png?token=`,
    );
    expect(manifest.scene.collisionUrl).toContain(
      `/${collisionAssetId}/fixture.collision.glb?token=`,
    );
    const collisionResponse = await exports.default.fetch(
      new URL(manifest.scene.collisionUrl!, origin),
    );
    expect(collisionResponse.status).toBe(200);
    expect(new Uint8Array(await collisionResponse.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    // A release published without an operator budget publishes an explicit null
    // so the viewer runs its device-aware selection instead of a fixed default.
    expect(manifest.viewer.splatBudgetMillions).toBeNull();

    // The frozen Detour navmesh is reachable through the release asset route so
    // a renderer can stream it instead of decoding the inline base64 copy.
    expect(manifest.scene.detourUrl).toContain(
      `/${manifest.spatial.navigationAssets.detour.assetId}/`,
    );
    expect(manifest.scene.detourUrl).toContain("?token=");
    const detourResponse = await exports.default.fetch(
      new URL(manifest.scene.detourUrl!, origin),
    );
    expect(detourResponse.status).toBe(200);

    // A token-gated asset is authorised on every request and only then served
    // from the edge, keyed on immutable asset identity and never on the token.
    expect(collisionResponse.headers.get("x-spatial-asset-cache")).toBe("MISS");
    expect(collisionResponse.headers.get("cache-control")).toBe(
      "private, max-age=1800, immutable",
    );
    const cachedCollisionResponse = await exports.default.fetch(
      new URL(manifest.scene.collisionUrl!, origin),
    );
    expect(cachedCollisionResponse.status).toBe(200);
    expect(cachedCollisionResponse.headers.get("x-spatial-asset-cache")).toBe("HIT");
    expect(cachedCollisionResponse.headers.get("cache-control")).toBe(
      "private, max-age=1800, immutable",
    );
    const untokenizedCollisionResponse = await exports.default.fetch(
      new URL(new URL(manifest.scene.collisionUrl!, origin).pathname, origin),
    );
    expect(untokenizedCollisionResponse.status).toBe(401);

    // Scene tokens are bound to a renewable D1 session so a long walkthrough can
    // extend its streaming grant instead of 401ing mid-scene.
    expect(manifest.integrity).toMatchObject({
      sessionRenewalPath: "/api/scene-sessions/renew",
    });
    expect(manifest.integrity.sessionId).toEqual(expect.any(String));
    expect(Date.parse(manifest.integrity.sessionHardExpiresAt)).toBeGreaterThan(
      Date.parse(manifest.integrity.sessionExpiresAt),
    );
    const collisionAssetPath =
      `/asset/${revisedRelease.release.id}/${collisionAssetId}/fixture.collision.glb`;
    const sceneToken = new URL(manifest.scene.collisionUrl!, origin)
      .searchParams.get("token")!;
    const strandedSessionToken = await signSceneToken({
      releaseId: revisedRelease.release.id,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      sessionId: crypto.randomUUID(),
    }, env.SESSION_PEPPER);
    const strandedSessionAsset = await exports.default.fetch(
      `${origin}${collisionAssetPath}?token=${encodeURIComponent(strandedSessionToken)}`,
    );
    expect(strandedSessionAsset.status).toBe(401);
    // Tokens minted before renewable sessions carry no sessionId and must keep
    // validating on the signature alone until they lapse naturally.
    const legacySceneToken = await signSceneToken({
      releaseId: revisedRelease.release.id,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    }, env.SESSION_PEPPER);
    const legacySceneAsset = await exports.default.fetch(
      `${origin}${collisionAssetPath}?token=${encodeURIComponent(legacySceneToken)}`,
    );
    expect(legacySceneAsset.status).toBe(200);

    const renewalResponse = await exports.default.fetch(
      `${origin}${manifest.integrity.sessionRenewalPath}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: sceneToken }),
      },
    );
    expect(renewalResponse.status).toBe(200);
    const renewedSession = await renewalResponse.json<{
      sessionId: string;
      token: string;
      expiresAtEpochSeconds: number;
      sessionHardExpiresAt: string;
    }>();
    expect(renewedSession.sessionId).toBe(manifest.integrity.sessionId);
    expect(renewedSession.sessionHardExpiresAt).toBe(manifest.integrity.sessionHardExpiresAt);
    expect(renewedSession.expiresAtEpochSeconds * 1000).toBeGreaterThanOrEqual(
      Date.parse(manifest.integrity.sessionExpiresAt),
    );
    const renewedAsset = await exports.default.fetch(
      `${origin}${collisionAssetPath}?token=${encodeURIComponent(renewedSession.token)}`,
    );
    expect(renewedAsset.status).toBe(200);
    const rejectedRenewal = await exports.default.fetch(
      `${origin}${manifest.integrity.sessionRenewalPath}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: legacySceneToken }),
      },
    );
    expect(rejectedRenewal.status).toBe(401);
    // Past the hard ceiling the walkthrough must start a fresh session.
    await env.DB.prepare(`
      UPDATE scene_render_sessions SET hard_expires_at_epoch = ? WHERE id = ?
    `).bind(Math.floor(Date.now() / 1000) - 1, manifest.integrity.sessionId).run();
    const ceilingRenewal = await exports.default.fetch(
      `${origin}${manifest.integrity.sessionRenewalPath}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: renewedSession.token }),
      },
    );
    expect(ceilingRenewal.status).toBe(410);
    expect(manifest.viewer.initialCamera.up).toEqual([-0.01, -0.87, -0.49]);
    expect(manifest.spatial).toMatchObject({
      entities: [{ id: snapshotEntity.entity.id, label: "Published walkable room" }],
      navigationMesh: {
        sourceEntityIds: [snapshotEntity.entity.id],
      },
    });
    expect(manifest.spatial.navigationMesh.indices).toHaveLength(12);
    expect(manifest.spatial.navigationArtifact).toMatchObject({
      schemaVersion: "spatial-navigation-v7",
      source: { assetId: collisionAssetId },
      physicalValidation: { passed: true, routeCount: 2 },
    });
    expect(manifest.spatial.navigationAssets).toEqual({
      buildId: navigationBuildId,
      authoringHash: navigationAuthoringHash,
      artifact: {
        assetId: navigationReportAssetId,
        format: "json",
        sha256: navigationReportSha256,
        sizeBytes: 2048,
      },
      detour: {
        assetId: navigationDetourAssetId,
        format: "bin",
        sha256: navigationDetourSha256,
        sizeBytes: 64,
      },
    });
    expect(manifest.spatial.obstacleProxy).toEqual({
      version: "authored-obstacle-boxes-v1",
      boxes: [{
        entityId: snapshotObstacle.obstacle.id,
        label: "Published table",
        min: [1.5, 0, 0.2],
        max: [2.5, 0.9, 0.8],
      }],
    });

    await env.DB.prepare("UPDATE assets SET sha256 = ? WHERE id = ?")
      .bind("e".repeat(64), collisionAssetId).run();
    const mismatchedCollisionManifest = await exports.default.fetch(
      `${origin}/api/releases/publishable-apartment/manifest`,
    );
    expect(mismatchedCollisionManifest.status).toBe(409);
    await expect(mismatchedCollisionManifest.json()).resolves.toMatchObject({
      error: expect.stringContaining("not all present and verified"),
    });
    await env.DB.prepare("UPDATE assets SET sha256 = ? WHERE id = ?")
      .bind(collisionSha256, collisionAssetId).run();

    await env.DB.prepare("UPDATE assets SET sha256 = ? WHERE id = ?")
      .bind("f".repeat(64), navigationDetourAssetId).run();
    const mismatchedNavigationManifest = await exports.default.fetch(
      `${origin}/api/releases/publishable-apartment/manifest`,
    );
    expect(mismatchedNavigationManifest.status).toBe(409);
    await expect(mismatchedNavigationManifest.json()).resolves.toMatchObject({
      error: expect.stringContaining("not all present and verified"),
    });
    await env.DB.prepare("UPDATE assets SET sha256 = ? WHERE id = ?")
      .bind(navigationDetourSha256, navigationDetourAssetId).run();

    await env.SPATIAL_ASSETS.delete(navigationDetourKey);
    const missingNavigationObjectManifest = await exports.default.fetch(
      `${origin}/api/releases/publishable-apartment/manifest`,
    );
    expect(missingNavigationObjectManifest.status).toBe(409);
    await expect(missingNavigationObjectManifest.json()).resolves.toMatchObject({
      error: expect.stringContaining("not all present and verified"),
    });
    await env.SPATIAL_ASSETS.put(navigationDetourKey, new Uint8Array(64), {
      customMetadata: { sha256: navigationDetourSha256 },
    });

    const archiveSnapshotEntity = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/entities/${snapshotEntity.entity.id}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(archiveSnapshotEntity.status).toBe(204);
    const archiveSnapshotObstacle = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/navigation-obstacles/${snapshotObstacle.obstacle.id}`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(archiveSnapshotObstacle.status).toBe(204);
    const immutableManifestResponse = await exports.default.fetch(
      `${origin}/api/releases/publishable-apartment/manifest`,
    );
    expect(immutableManifestResponse.status).toBe(200);
    await expect(immutableManifestResponse.json()).resolves.toMatchObject({
      spatial: {
        entities: [{ id: snapshotEntity.entity.id, label: "Published walkable room" }],
        navigationMesh: { sourceEntityIds: [snapshotEntity.entity.id] },
        obstacleProxy: {
          boxes: [{ entityId: snapshotObstacle.obstacle.id, label: "Published table" }],
        },
      },
    });

    const customHostname = `published-${crypto.randomUUID().slice(0, 8)}.customer.test`;
    const customDomainId = crypto.randomUUID();
    const owningProject = await env.DB.prepare(`
      SELECT organisation_id, created_by FROM projects WHERE id = ?
    `).bind(project.id).first<{ organisation_id: string; created_by: string }>();
    expect(owningProject).toBeTruthy();
    await env.DB.prepare(`
      INSERT INTO custom_domains (
        id, organisation_id, project_id, hostname, status, verification_token_hash,
        created_by, verified_at, dns_verified_at, provider, provider_hostname_id,
        provider_status, provider_ssl_status, provisioned_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, datetime('now'), datetime('now'),
        'cloudflare-for-saas', ?, 'active', 'active', datetime('now'))
    `).bind(
      customDomainId,
      owningProject!.organisation_id,
      project.id,
      customHostname,
      "a".repeat(64),
      owningProject!.created_by,
      `provider-${customDomainId}`,
    ).run();

    const customDomainRoot = await exports.default.fetch(
      `https://${customHostname}/`,
      { redirect: "manual" },
    );
    expect(customDomainRoot.status).toBe(302);
    expect(customDomainRoot.headers.get("location")).toBe("/s/publishable-apartment");

    const customDomainManifest = await exports.default.fetch(
      `https://${customHostname}/api/releases/publishable-apartment/manifest`,
    );
    expect(customDomainManifest.status).toBe(200);

    await env.DB.prepare(`
      UPDATE custom_domains SET provider_ssl_status = 'pending' WHERE id = ?
    `).bind(customDomainId).run();
    const pendingCustomDomain = await exports.default.fetch(
      `https://${customHostname}/`,
    );
    expect(pendingCustomDomain.status).toBe(503);
    const pendingCustomManifest = await exports.default.fetch(
      `https://${customHostname}/api/releases/publishable-apartment/manifest`,
    );
    expect(pendingCustomManifest.status).toBe(404);

    const assetResponse = await exports.default.fetch(
      new URL(manifest.scene.contentUrl, origin),
    );
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("cache-control")).toBe(
      "public, max-age=1800, s-maxage=31536000, immutable",
    );
    expect(assetResponse.headers.get("x-spatial-asset-cache")).toBe("MISS");
    expect(
      new TextDecoder().decode(await assetResponse.arrayBuffer()),
    ).toBe("test-spark-rad-scene");

    const rangeResponse = await exports.default.fetch(
      new URL(manifest.scene.contentUrl, origin),
      { headers: { range: "bytes=5-13" } },
    );
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get("x-spatial-asset-cache")).toBe("HIT");
    expect(rangeResponse.headers.get("accept-ranges")).toBe("bytes");
    expect(rangeResponse.headers.get("content-range")).toBe(
      `bytes 5-13/${sceneBytes.byteLength}`,
    );
    expect(new TextDecoder().decode(await rangeResponse.arrayBuffer())).toBe(
      "spark-rad",
    );

    const blockedArchive = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/archive`,
      { method: "POST", headers: { cookie } },
    );
    expect(blockedArchive.status).toBe(409);
    await expect(blockedArchive.json()).resolves.toMatchObject({
      error: "Revoke the active release before archiving this project",
    });

    await env.SPATIAL_ASSETS.delete(navigationReportKey);
    const blockedRollbackResponse = await exports.default.fetch(
      `${origin}/api/release-channels/publishable-apartment/rollback`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ releaseId: release.release.id }),
      },
    );
    expect(blockedRollbackResponse.status).toBe(409);
    await expect(blockedRollbackResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("not all present and verified"),
    });
    await env.SPATIAL_ASSETS.put(navigationReportKey, new Uint8Array(2048), {
      customMetadata: { sha256: navigationReportSha256 },
    });

    const rollbackResponse = await exports.default.fetch(
      `${origin}/api/release-channels/publishable-apartment/rollback`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ releaseId: release.release.id }),
      },
    );
    expect(rollbackResponse.status).toBe(200);
    const rolledBackChannel = await env.DB.prepare(`
      SELECT active_release_id, activation_generation FROM release_channels
      WHERE slug = 'publishable-apartment'
    `).first<{
      active_release_id: string;
      activation_generation: number;
    }>();
    expect(rolledBackChannel).toEqual({
      active_release_id: release.release.id,
      activation_generation: 3,
    });
    const staleActivationRenewal = await exports.default.fetch(
      `${origin}/api/releases/${release.release.slug}/telemetry-session`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          releaseId: release.release.id,
          sessionId: publishedTelemetry.sessionId,
        }),
      },
    );
    expect(staleActivationRenewal.status).toBe(410);
    const rolledBackSessionResponse = await exports.default.fetch(
      `${origin}/api/releases/${release.release.slug}/telemetry-session`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          releaseId: release.release.id,
        }),
      },
    );
    expect(rolledBackSessionResponse.status).toBe(200);
    const rolledBackSession = await rolledBackSessionResponse.json<{
      sessionId: string;
    }>();
    expect(rolledBackSession.sessionId).not.toBe(publishedTelemetry.sessionId);
    const resurrectedBearerResponse = await exports.default.fetch(`${origin}/api/telemetry`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${renewedTelemetry.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        releaseId: release.release.id,
        eventType: "navigation_traversal",
        sessionId: publishedTelemetry.sessionId,
        metadata: { connectionId: "gallery-lift", phase: "completed" },
      }),
    });
    expect(resurrectedBearerResponse.status).toBe(410);

    const revokeResponse = await exports.default.fetch(
      `${origin}/api/release-channels/publishable-apartment`,
      { method: "DELETE", headers: { cookie } },
    );
    expect(revokeResponse.status).toBe(204);
    const revokedManifest = await exports.default.fetch(
      `${origin}/api/releases/publishable-apartment/manifest`,
    );
    expect(revokedManifest.status).toBe(404);
    const revokedAsset = await exports.default.fetch(
      new URL(manifest.scene.contentUrl, origin),
    );
    expect(revokedAsset.status).toBe(404);

    const archiveResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/archive`,
      { method: "POST", headers: { cookie } },
    );
    expect(archiveResponse.status).toBe(200);
    await expect(archiveResponse.json()).resolves.toMatchObject({
      project: { status: "ARCHIVED" },
    });
    const restoreResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/restore`,
      { method: "POST", headers: { cookie } },
    );
    expect(restoreResponse.status).toBe(200);
    await expect(restoreResponse.json()).resolves.toMatchObject({
      project: { status: "REVOKED" },
    });
  });

  it("lets a leased processor download its source, upload a derivative, and persist execution evidence", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Worker transfer contract",
        captureAdapter: "open-import",
        deliveryTemplate: "property-tour",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const sourceBytes = new TextEncoder().encode("ply\nformat ascii 1.0\nend_header\n");

    const uploadResponse = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/uploads`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "worker-source.ply",
          sizeBytes: sourceBytes.byteLength,
          format: "ply",
          mimeType: "application/octet-stream",
        }),
      },
    );
    expect(uploadResponse.status).toBe(201);
    const { upload } = await uploadResponse.json<{ upload: { id: string } }>();
    const partResponse = await exports.default.fetch(
      `${origin}/api/uploads/${upload.id}/parts/1`,
      {
        method: "PUT",
        headers: { cookie, "content-length": String(sourceBytes.byteLength) },
        body: sourceBytes,
      },
    );
    const { part } = await partResponse.json<{ part: { etag: string } }>();
    const completionResponse = await exports.default.fetch(
      `${origin}/api/uploads/${upload.id}/complete`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ parts: [{ partNumber: 1, etag: part.etag }] }),
      },
    );
    expect(completionResponse.status).toBe(200);
    const completedUpload = await completionResponse.clone().json<{
      job: { id: string };
    }>();

    const unrelatedLeaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workerId: "test-spark-worker",
        jobId: crypto.randomUUID(),
      }),
    });
    expect(unrelatedLeaseResponse.status).toBe(204);

    const leaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workerId: "test-spark-worker",
        jobId: completedUpload.job.id,
      }),
    });
    expect(leaseResponse.status).toBe(200);
    const leased = await leaseResponse.json<{
      job: {
        id: string;
        projectId: string;
        versionId: string;
        input: {
          id: string;
          fileName: string;
          format: string;
          sizeBytes: number;
          downloadUrl: string;
        };
      };
      leaseToken: string;
    }>();
    expect(leased.job.id).toBe(completedUpload.job.id);
    expect(leased.job.projectId).toBe(project.id);
    expect(leased.job.input).toMatchObject({
      fileName: "worker-source.ply",
      format: "ply",
      sizeBytes: sourceBytes.byteLength,
    });

    const sourceResponse = await exports.default.fetch(
      new URL(leased.job.input.downloadUrl, origin),
      {
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "x-job-lease": leased.leaseToken,
        },
      },
    );
    expect(sourceResponse.status).toBe(200);
    expect(new Uint8Array(await sourceResponse.arrayBuffer())).toEqual(sourceBytes);

    const derivativeBytes = new TextEncoder().encode("spark-spz-derivative");
    const createDerivativeResponse = await exports.default.fetch(
      `${origin}/api/worker/jobs/${leased.job.id}/outputs`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "x-job-lease": leased.leaseToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "web",
          fileName: "worker-scene.spz",
          mimeType: "application/octet-stream",
          sizeBytes: derivativeBytes.byteLength,
        }),
      },
    );
    expect(createDerivativeResponse.status).toBe(201);
    const createdDerivative = await createDerivativeResponse.json<{
      upload: { id: string };
    }>();
    const derivativePartResponse = await exports.default.fetch(
      `${origin}/api/worker/jobs/${leased.job.id}/outputs/${createdDerivative.upload.id}/parts/1`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "x-job-lease": leased.leaseToken,
          "content-length": String(derivativeBytes.byteLength),
        },
        body: derivativeBytes,
      },
    );
    expect(derivativePartResponse.status).toBe(200);
    const derivativePart = await derivativePartResponse.json<{ part: { etag: string } }>();
    const derivativeResponse = await exports.default.fetch(
      `${origin}/api/worker/jobs/${leased.job.id}/outputs/${createdDerivative.upload.id}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "x-job-lease": leased.leaseToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          parts: [{ partNumber: 1, etag: derivativePart.part.etag }],
        }),
      },
    );
    expect(derivativeResponse.status).toBe(200);
    const derivative = await derivativeResponse.json<{
      output: {
        kind: string;
        format: string;
        objectKey: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
      };
    }>();
    expect(derivative.output).toMatchObject({
      kind: "web",
      format: "spz",
      fileName: "worker-scene.spz",
      sizeBytes: derivativeBytes.byteLength,
    });

    const completeResponse = await exports.default.fetch(
      `${origin}/api/worker/jobs/${leased.job.id}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leaseToken: leased.leaseToken,
          progressMessage: "Spark SPZ derivative generated",
          outputs: [derivative.output],
          report: { validation: "passed", renderer: "Spark 2.1.0" },
          evidence: {
            processorVersion: "spatial-processor/0.1.0",
            computeDurationMs: 3210,
            activeHumanDurationMs: 0,
            inputBytes: sourceBytes.byteLength,
            outputBytes: derivativeBytes.byteLength,
            toolVersions: {
              spark: "2.1.0",
              processor: "0.1.0",
            },
          },
        }),
      },
    );
    expect(completeResponse.status).toBe(200);
    await expect(completeResponse.json()).resolves.toMatchObject({
      job: { id: leased.job.id, state: "SUCCEEDED" },
      outputs: [{ kind: "web", format: "spz", sizeBytes: derivativeBytes.byteLength }],
    });

    const jobsResponse = await exports.default.fetch(`${origin}/api/jobs`, {
      headers: { cookie },
    });
    const jobs = await jobsResponse.json<{
      jobs: Array<{
        id: string;
        state: string;
        compute_duration_ms: number;
        active_human_duration_ms: number;
        input_bytes: number;
        output_bytes: number;
        evidence_json: string;
      }>;
    }>();
    expect(jobs.jobs.find((job) => job.id === leased.job.id)).toMatchObject({
      state: "SUCCEEDED",
      compute_duration_ms: 3210,
      active_human_duration_ms: 0,
      input_bytes: sourceBytes.byteLength,
      output_bytes: derivativeBytes.byteLength,
    });
  });

  it("surfaces and safely discards expired recoverable uploads", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Expired upload recovery",
        captureAdapter: "open-import",
        deliveryTemplate: "property-tour",
      }),
    });
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const uploadResponse = await exports.default.fetch(`${origin}/api/projects/${project.id}/uploads`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "expired.sog",
        sizeBytes: 16,
        format: "sog",
        mimeType: "application/octet-stream",
      }),
    });
    const { upload } = await uploadResponse.json<{ upload: { id: string } }>();
    await env.DB.prepare(
      "UPDATE upload_sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
    ).bind(upload.id).run();

    const inventory = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/uploads/open`,
      { headers: { cookie } },
    );
    await expect(inventory.json()).resolves.toMatchObject({
      uploads: [{ id: upload.id, expired: true, uploadedBytes: 0, parts: [] }],
    });

    const otherOrganisationId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const otherSessionId = crypto.randomUUID();
    const otherRefreshSecret = "upload-isolation-refresh";
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO organisations (id, name, slug, created_at) VALUES (?, 'Upload isolation', ?, ?)",
      ).bind(otherOrganisationId, `upload-isolation-${project.id.slice(0, 8)}`, now),
      env.DB.prepare(
        "INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, 'Upload isolation', ?)",
      ).bind(otherUserId, `upload-${project.id.slice(0, 8)}@example.com`, now),
      env.DB.prepare(
        "INSERT INTO memberships (organisation_id, user_id, role, created_at) VALUES (?, ?, 'production_operator', ?)",
      ).bind(otherOrganisationId, otherUserId, now),
      env.DB.prepare(`
        INSERT INTO auth_sessions
          (id, user_id, organisation_id, refresh_token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        otherSessionId,
        otherUserId,
        otherOrganisationId,
        await sha256Hex(`${otherRefreshSecret}:${env.REFRESH_TOKEN_PEPPER}`),
        new Date(Date.now() + 60_000).toISOString(),
        now,
      ),
    ]);
    const otherTokens = await issueAuthTokens(env, {
      userId: otherUserId,
      organisationId: otherOrganisationId,
      email: `upload-${project.id.slice(0, 8)}@example.com`,
      displayName: "Upload isolation",
      role: "production_operator",
    }, otherSessionId, otherRefreshSecret);
    const isolatedInventory = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/uploads/open`,
      { headers: { cookie: `spatial_access=${otherTokens.accessToken}` } },
    );
    expect(isolatedInventory.status).toBe(404);

    const rejectedPart = await exports.default.fetch(`${origin}/api/uploads/${upload.id}/parts/1`, {
      method: "PUT",
      headers: { cookie, "content-length": "16" },
      body: new Uint8Array(16),
    });
    expect(rejectedPart.status).toBe(410);
    await expect(rejectedPart.json()).resolves.toMatchObject({
      code: "upload_expired",
    });

    const discard = await exports.default.fetch(`${origin}/api/uploads/${upload.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(discard.status).toBe(204);
    const emptyInventory = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/uploads/open`,
      { headers: { cookie } },
    );
    await expect(emptyInventory.json()).resolves.toEqual({ uploads: [] });
  });

  it("gives operators explicit retry and cancel recovery controls", async () => {
    const cookie = await login();
    const projectId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const member = await env.DB.prepare(`
      SELECT m.organisation_id AS organisationId, m.user_id AS userId
      FROM memberships m
      ORDER BY m.created_at
      LIMIT 1
    `).first<{ organisationId: string; userId: string }>();
    const organisationId = member!.organisationId;
    const userId = member!.userId;
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by)
        VALUES (?, ?, 'Recovery contract', ?, 'PROCESSING_FAILED', 'open-import', 'property-tour', ?)
      `).bind(projectId, organisationId, `recovery-${projectId.slice(0, 8)}`, userId),
      env.DB.prepare(`
        INSERT INTO scene_versions (id, project_id, version_number, status, created_by)
        VALUES (?, ?, 1, 'PROCESSING_FAILED', ?)
      `).bind(versionId, projectId, userId),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key, file_name, mime_type, size_bytes, integrity_status)
        VALUES (?, ?, ?, ?, 'source', 'ply', ?, 'bad-scene.ply', 'application/octet-stream', 1, 'failed')
      `).bind(assetId, organisationId, projectId, versionId, `raw-private/${organisationId}/${projectId}/${versionId}/bad-scene.ply`),
      env.DB.prepare(`
        INSERT INTO processing_jobs
          (id, organisation_id, project_id, version_id, input_asset_id, job_type, processor_version, idempotency_key, state, error_json)
        VALUES (?, ?, ?, ?, ?, 'asset.validate', 'spatial-processor/0.1.0', ?, 'FAILED', ?)
      `).bind(jobId, organisationId, projectId, versionId, assetId, `recovery:${jobId}`, JSON.stringify({
        code: "INVALID_PLY",
        message: "PLY header is incomplete",
        failureClass: "input_validation",
      })),
    ]);

    const retryResponse = await exports.default.fetch(`${origin}/api/jobs/${jobId}/retry`, {
      method: "POST",
      headers: { cookie },
    });
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toMatchObject({
      job: { id: jobId, state: "QUEUED" },
    });

    const cancelResponse = await exports.default.fetch(`${origin}/api/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: { cookie },
    });
    expect(cancelResponse.status).toBe(200);
    await expect(cancelResponse.json()).resolves.toMatchObject({
      job: { id: jobId, state: "CANCELLED" },
    });
  });

  it("authors vendor-neutral scene semantics, routes, privacy, and adaptive delivery", async () => {
    const cookie = await login();
    const member = await env.DB.prepare(`
      SELECT organisation_id AS organisationId, user_id AS userId
      FROM memberships ORDER BY created_at LIMIT 1
    `).first<{ organisationId: string; userId: string }>();
    const projectId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const traversalEvidenceAssetId = crypto.randomUUID();
    const traversalEvidenceManifestId = crypto.randomUUID();
    const traversalEvidenceManifestAssetId = crypto.randomUUID();
    const unqualifiedManifestId = crypto.randomUUID();
    const unqualifiedManifestAssetId = crypto.randomUUID();
    const corruptManifestId = crypto.randomUUID();
    const corruptManifestAssetId = crypto.randomUUID();
    const nestedCorruptManifestId = crypto.randomUUID();
    const nestedCorruptManifestAssetId = crypto.randomUUID();
    const driftedManifestId = crypto.randomUUID();
    const driftedManifestAssetId = crypto.randomUUID();
    const traversalEvidenceSha256 = "c".repeat(64);
    const traversalRegistrationPayload = {
      schemaVersion: "capture-to-scene-registration-v1",
      sourceCoordinateFrameId: "registered-gallery-y-up",
      targetCoordinateFrameId: "scene-world-right-handed-y-up-metres",
      evidenceAssetId: traversalEvidenceAssetId,
      evidenceSha256: traversalEvidenceSha256,
      method: "The exported metric point cloud and traversal path share the reviewed device frame.",
      sourceToWorld: {
        sourceUpAxis: "Y",
        worldUnit: "metres",
        metresPerSourceUnit: 1,
        yawDegrees: 0,
        translationMetres: [10, 0, 0],
      },
    };
    const traversalRegistrationHash = await sha256Hex(
      JSON.stringify(traversalRegistrationPayload),
    );
    const traversalEvidenceManifest = JSON.stringify({
      format: "whymelabs.spatial.capture-bundle",
      schemaVersion: "1.0.0",
      manifestId: traversalEvidenceManifestId,
      project: { id: projectId, captureAdapter: "open-import" },
      version: { id: versionId, versionNumber: 1 },
      coordinateFrame: {
        id: "registered-gallery-y-up",
        units: "metres",
        axisConvention: "right-handed-y-up",
        epsg: null,
        registrationMethod: traversalRegistrationPayload.method,
      },
      sceneRegistration: {
        ...traversalRegistrationPayload,
        transformSha256: traversalRegistrationHash,
      },
      assets: [{
        id: traversalEvidenceAssetId,
        roles: ["traversal_evidence"],
        sha256: traversalEvidenceSha256,
      }],
    });
    const traversalEvidenceManifestHash = await sha256Hex(traversalEvidenceManifest);
    const unqualifiedManifest = JSON.stringify({
      format: "whymelabs.spatial.capture-bundle",
      schemaVersion: "1.0.0",
      manifestId: unqualifiedManifestId,
      project: { id: projectId, captureAdapter: "open-import" },
      version: { id: versionId, versionNumber: 1 },
      assets: [{
        id: traversalEvidenceAssetId,
        roles: ["traversal_evidence"],
        sha256: traversalEvidenceSha256,
      }],
    });
    const unqualifiedManifestHash = await sha256Hex(unqualifiedManifest);
    const corruptManifestHash = await sha256Hex("not-json");
    const nestedCorruptManifest = JSON.stringify({
      format: "whymelabs.spatial.capture-bundle",
      schemaVersion: "1.0.0",
      manifestId: nestedCorruptManifestId,
      project: { id: projectId, captureAdapter: "open-import" },
      version: { id: versionId, versionNumber: 1 },
      assets: ["{"],
    });
    const nestedCorruptManifestHash = await sha256Hex(nestedCorruptManifest);
    const driftedManifest = JSON.stringify({
      format: "whymelabs.spatial.capture-bundle",
      schemaVersion: "1.0.0",
      manifestId: driftedManifestId,
      project: { id: crypto.randomUUID(), captureAdapter: "xgrids-lcc" },
      version: { id: crypto.randomUUID(), versionNumber: 99 },
      assets: [{
        id: traversalEvidenceAssetId,
        roles: ["traversal_evidence"],
        sha256: traversalEvidenceSha256,
      }],
    });
    const driftedManifestHash = await sha256Hex(driftedManifest);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by)
        VALUES (?, ?, 'Authored venue', ?, 'QA_REQUIRED', 'open-import', 'venue-navigator', ?)
      `).bind(projectId, member!.organisationId, `authored-${projectId.slice(0, 8)}`, member!.userId),
      env.DB.prepare(`
        INSERT INTO scene_versions (
          id, project_id, version_number, status, source_provenance_json, created_by
        ) VALUES (?, ?, 1, 'QA_REQUIRED', ?, ?)
      `).bind(
        versionId,
        projectId,
        JSON.stringify({ assetProducer: "open-import", adapter: "open-import" }),
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, sha256, integrity_status
        ) VALUES (?, ?, ?, ?, 'master', 'ply', ?, 'gallery-capture.ply',
          'application/octet-stream', 4, ?, 'verified')
      `).bind(
        traversalEvidenceAssetId,
        member!.organisationId,
        projectId,
        versionId,
        `masters-private/${member!.organisationId}/${projectId}/${versionId}/gallery-capture.ply`,
        traversalEvidenceSha256,
      ),
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, sha256, integrity_status
        ) VALUES
          (?, ?, ?, ?, 'report', 'capture-bundle-manifest-json', ?,
            'qualified-manifest.json', 'application/json', 4, ?, 'verified'),
          (?, ?, ?, ?, 'report', 'capture-bundle-manifest-json', ?,
            'unqualified-manifest.json', 'application/json', 4, ?, 'verified'),
          (?, ?, ?, ?, 'report', 'capture-bundle-manifest-json', ?,
            'corrupt-manifest.json', 'application/json', 4, ?, 'verified'),
          (?, ?, ?, ?, 'report', 'capture-bundle-manifest-json', ?,
            'nested-corrupt-manifest.json', 'application/json', 4, ?, 'verified'),
          (?, ?, ?, ?, 'report', 'capture-bundle-manifest-json', ?,
            'drifted-manifest.json', 'application/json', 4, ?, 'verified')
      `).bind(
        traversalEvidenceManifestAssetId, member!.organisationId, projectId, versionId,
        `reports-private/${member!.organisationId}/${projectId}/${versionId}/qualified-manifest.json`,
        traversalEvidenceManifestHash,
        unqualifiedManifestAssetId, member!.organisationId, projectId, versionId,
        `reports-private/${member!.organisationId}/${projectId}/${versionId}/unqualified-manifest.json`,
        unqualifiedManifestHash,
        corruptManifestAssetId, member!.organisationId, projectId, versionId,
        `reports-private/${member!.organisationId}/${projectId}/${versionId}/corrupt-manifest.json`,
        corruptManifestHash,
        nestedCorruptManifestAssetId, member!.organisationId, projectId, versionId,
        `reports-private/${member!.organisationId}/${projectId}/${versionId}/nested-corrupt-manifest.json`,
        nestedCorruptManifestHash,
        driftedManifestAssetId, member!.organisationId, projectId, versionId,
        `reports-private/${member!.organisationId}/${projectId}/${versionId}/drifted-manifest.json`,
        driftedManifestHash,
      ),
      env.DB.prepare(`
        INSERT INTO capture_bundle_manifests (
          id, organisation_id, project_id, version_id, adapter, adapter_v2,
          schema_version, status, result, client_operation_id, request_hash,
          manifest_asset_id, manifest_hash, canonical_manifest_json,
          validation_json, created_by, review_decision, review_note,
          reviewed_by, reviewed_at, review_generation
        ) VALUES (?, ?, ?, ?, 'open-import', 'open-import', '1.0.0',
          'reviewed', 'ready', ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, datetime('now'), 1)
      `).bind(
        traversalEvidenceManifestId,
        member!.organisationId,
        projectId,
        versionId,
        crypto.randomUUID(),
        "e".repeat(64),
        traversalEvidenceManifestAssetId,
        traversalEvidenceManifestHash,
        traversalEvidenceManifest,
        JSON.stringify({ method: "capture-bundle-contract-v1", result: "ready" }),
        member!.userId,
        "Accepted registered capture evidence for traversal qualification.",
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO capture_bundle_manifests (
          id, organisation_id, project_id, version_id, adapter, adapter_v2,
          schema_version, status, result, client_operation_id, request_hash,
          manifest_asset_id, manifest_hash, canonical_manifest_json,
          validation_json, created_by, review_decision, review_note,
          reviewed_by, reviewed_at, review_generation
        ) VALUES (?, ?, ?, ?, 'open-import', 'open-import', '1.0.0',
          'reviewed', 'ready', ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, datetime('now'), 1)
      `).bind(
        unqualifiedManifestId,
        member!.organisationId,
        projectId,
        versionId,
        crypto.randomUUID(),
        "f".repeat(64),
        unqualifiedManifestAssetId,
        unqualifiedManifestHash,
        unqualifiedManifest,
        JSON.stringify({ method: "capture-bundle-contract-v1", result: "ready" }),
        member!.userId,
        "Accepted traversal evidence without a numerical capture-to-scene registration.",
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO capture_bundle_manifests (
          id, organisation_id, project_id, version_id, adapter, adapter_v2,
          schema_version, status, result, client_operation_id, request_hash,
          manifest_asset_id, manifest_hash, canonical_manifest_json,
          validation_json, created_by, review_decision, review_note,
          reviewed_by, reviewed_at, review_generation
        ) VALUES (?, ?, ?, ?, 'open-import', 'open-import', '1.0.0',
          'reviewed', 'ready', ?, ?, ?, ?, 'not-json', ?, ?, 'accepted', ?, ?, datetime('now'), 1)
      `).bind(
        corruptManifestId,
        member!.organisationId,
        projectId,
        versionId,
        crypto.randomUUID(),
        "7".repeat(64),
        corruptManifestAssetId,
        corruptManifestHash,
        JSON.stringify({ method: "capture-bundle-contract-v1", result: "ready" }),
        member!.userId,
        "Corrupt accepted fixture must be excluded without breaking the workspace.",
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO capture_bundle_manifests (
          id, organisation_id, project_id, version_id, adapter, adapter_v2,
          schema_version, status, result, client_operation_id, request_hash,
          manifest_asset_id, manifest_hash, canonical_manifest_json,
          validation_json, created_by, review_decision, review_note,
          reviewed_by, reviewed_at, review_generation
        ) VALUES (?, ?, ?, ?, 'open-import', 'open-import', '1.0.0',
          'reviewed', 'ready', ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, datetime('now'), 1)
      `).bind(
        nestedCorruptManifestId,
        member!.organisationId,
        projectId,
        versionId,
        crypto.randomUUID(),
        "8".repeat(64),
        nestedCorruptManifestAssetId,
        nestedCorruptManifestHash,
        nestedCorruptManifest,
        JSON.stringify({ method: "capture-bundle-contract-v1", result: "ready" }),
        member!.userId,
        "Nested corrupt declaration must be excluded without breaking the workspace.",
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO capture_bundle_manifests (
          id, organisation_id, project_id, version_id, adapter, adapter_v2,
          schema_version, status, result, client_operation_id, request_hash,
          manifest_asset_id, manifest_hash, canonical_manifest_json,
          validation_json, created_by, review_decision, review_note,
          reviewed_by, reviewed_at, review_generation
        ) VALUES (?, ?, ?, ?, 'open-import', 'open-import', '1.0.0',
          'reviewed', 'ready', ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, datetime('now'), 1)
      `).bind(
        driftedManifestId,
        member!.organisationId,
        projectId,
        versionId,
        crypto.randomUUID(),
        "9".repeat(64),
        driftedManifestAssetId,
        driftedManifestHash,
        driftedManifest,
        JSON.stringify({ method: "capture-bundle-contract-v1", result: "ready" }),
        member!.userId,
        "Hashed provenance drift fixture must not qualify traversal evidence.",
        member!.userId,
      ),
    ]);

    const provisionalNavigationProfileResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-profile`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          versionId,
          worldUnit: "scene_units",
          agentRadius: 0.3,
          agentHeight: 1.75,
          eyeHeight: 1.58,
          maxStepMetres: 0.08,
        }),
      },
    );
    expect(provisionalNavigationProfileResponse.status).toBe(200);
    const provisionalMetricTraversal = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-traversals`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          versionId,
          traversalKind: "elevator",
          label: "Unsafe provisional lift",
          sourcePath: [[-11, 0, 0], [-11, 2.8, 0], [-9, 2.8, 0]],
          bidirectional: true,
          speedUnitsPerSecond: 1.2,
          reviewedPurpose: "This must not mix a metric registration with scene units.",
          evidenceAssetId: traversalEvidenceAssetId,
          evidenceManifestId: traversalEvidenceManifestId,
        }),
      },
    );
    expect(provisionalMetricTraversal.status).toBe(409);
    await expect(provisionalMetricTraversal.json()).resolves.toMatchObject({
      error: expect.stringContaining("metric navigation profile"),
    });

    const navigationProfileResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-profile`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          versionId,
          worldUnit: "metres",
          agentRadius: 0.3,
          agentHeight: 1.75,
          eyeHeight: 1.58,
          maxStepMetres: 0.08,
        }),
      },
    );
    expect(navigationProfileResponse.status).toBe(200);

    const entityResponse = await exports.default.fetch(`${origin}/api/projects/${projectId}/spatial/entities`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        versionId,
        kind: "room",
        label: "Gallery one",
        position: [1, 1.6, 2],
        geometry: {
          type: "box",
          points: [[-2, 0, -3], [2, 2.8, 3]],
        },
        metadata: {
          cameraPose: {
            position: [1, 1.6, 4],
            target: [1, 1.2, 2],
            up: [0, 1, 0],
            fovDegrees: 58,
          },
        },
      }),
    });
    expect(entityResponse.status).toBe(201);
    const entity = await entityResponse.json<{ entity: { id: string } }>();

    const doorwayResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/entities`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          versionId,
          kind: "doorway",
          label: "Gallery connector",
          geometry: {
            type: "box",
            points: [[-0.4, 0, 2.8], [0.4, 2.2, 3.3]],
          },
          metadata: {},
        }),
      },
    );
    expect(doorwayResponse.status).toBe(201);
    const doorway = await doorwayResponse.json<{ entity: { id: string } }>();

    const obstacleResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-obstacles`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          versionId,
          label: "Display plinth",
          geometry: {
            type: "box",
            points: [[-0.5, 0, -0.5], [0.5, 1.2, 0.5]],
          },
          metadata: { authoredFrom: "reviewed-plan" },
        }),
      },
    );
    expect(obstacleResponse.status).toBe(201);
    const obstacle = await obstacleResponse.json<{ obstacle: { id: string } }>();

    const unqualifiedTraversalResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-traversals`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: crypto.randomUUID(),
          versionId,
          traversalKind: "elevator",
          label: "Gallery lift",
          sourcePath: [[-11, 0, 0], [-11, 2.8, 0], [-9, 2.8, 0]],
          bidirectional: true,
          speedUnitsPerSecond: 1.2,
          reviewedPurpose: "Reviewed lift path in the registered gallery capture.",
          evidenceAssetId: traversalEvidenceAssetId,
          evidenceManifestId: unqualifiedManifestId,
        }),
      },
    );
    expect(unqualifiedTraversalResponse.status).toBe(422);
    await expect(unqualifiedTraversalResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("capture manifest"),
    });

    const traversalOperationId = crypto.randomUUID();
    const traversalUrl =
      `${origin}/api/projects/${projectId}/spatial/navigation-traversals`;
    const traversalRequest = {
      clientOperationId: traversalOperationId,
      versionId,
      traversalKind: "elevator",
      label: "Gallery lift",
      sourcePath: [[-11, 0, 0], [-11, 2.8, 0], [-9, 2.8, 0]],
      bidirectional: true,
      speedUnitsPerSecond: 1.2,
      reviewedPurpose: "Reviewed lift path in the registered gallery capture.",
      evidenceAssetId: traversalEvidenceAssetId,
      evidenceManifestId: traversalEvidenceManifestId,
    };
    const [firstTraversalResponse, concurrentTraversalResponse] = await Promise.all([
      exports.default.fetch(traversalUrl, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(traversalRequest),
      }),
      exports.default.fetch(traversalUrl, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(traversalRequest),
      }),
    ]);
    expect([firstTraversalResponse.status, concurrentTraversalResponse.status].sort()).toEqual([200, 201]);
    const [firstTraversal, concurrentTraversal] = await Promise.all([
      firstTraversalResponse.json<{
        traversal: { id: string; path_json: string; evidence_source_path_json: string };
      }>(),
      concurrentTraversalResponse.json<{
        traversal: { id: string; path_json: string; evidence_source_path_json: string };
      }>(),
    ]);
    expect(concurrentTraversal.traversal.id).toBe(firstTraversal.traversal.id);
    const traversal: {
      traversal: { id: string; path_json: string; evidence_source_path_json: string };
    } = firstTraversal;
    expect(JSON.parse(traversal.traversal.path_json)).toEqual([
      [-1, 0, 0], [-1, 2.8, 0], [1, 2.8, 0],
    ]);
    expect(JSON.parse(traversal.traversal.evidence_source_path_json)).toEqual([
      [-11, 0, 0], [-11, 2.8, 0], [-9, 2.8, 0],
    ]);
    const conflictingTraversalReplay = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-traversals`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: traversalOperationId,
          versionId,
          traversalKind: "elevator",
          label: "Gallery lift",
          sourcePath: [[-11, 0, 0], [-11, 2.8, 0], [-8.5, 2.8, 0]],
          bidirectional: true,
          speedUnitsPerSecond: 1.2,
          reviewedPurpose: "Reviewed lift path in the registered gallery capture.",
          evidenceAssetId: traversalEvidenceAssetId,
          evidenceManifestId: traversalEvidenceManifestId,
        }),
      },
    );
    expect(conflictingTraversalReplay.status).toBe(409);
    await expect(conflictingTraversalReplay.json()).resolves.toMatchObject({
      error: expect.stringContaining("different authored traversal request"),
    });
    const racingConflictOperationId = crypto.randomUUID();
    const racingConflictBase = {
      ...traversalRequest,
      clientOperationId: racingConflictOperationId,
      label: "Service lift A",
    };
    const [firstRacingConflict, secondRacingConflict] = await Promise.all([
      exports.default.fetch(traversalUrl, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(racingConflictBase),
      }),
      exports.default.fetch(traversalUrl, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ ...racingConflictBase, label: "Service lift B" }),
      }),
    ]);
    expect([firstRacingConflict.status, secondRacingConflict.status].sort()).toEqual([201, 409]);
    const racingWinnerResponse = firstRacingConflict.status === 201
      ? firstRacingConflict
      : secondRacingConflict;
    const racingWinner = await racingWinnerResponse.json<{ traversal: { id: string } }>();
    const archivedRacingWinner = await env.DB.prepare(`
      UPDATE scene_navigation_traversals SET status = 'archived' WHERE id = ?
    `).bind(racingWinner.traversal.id).run();
    expect(archivedRacingWinner.meta.changes).toBe(1);
    await env.DB.prepare(`
      UPDATE scene_navigation_traversals SET evidence_registration_sha256 = ? WHERE id = ?
    `).bind("d".repeat(64), traversal.traversal.id).run();
    const missingReplacementSourcePath = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-traversals/${traversal.traversal.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ speedUnitsPerSecond: 1.4 }),
      },
    );
    expect(missingReplacementSourcePath.status).toBe(422);
    await expect(missingReplacementSourcePath.json()).resolves.toMatchObject({
      details: { sourcePath: [expect.stringContaining("new capture frame")] },
    });
    const repairRegistrationReceipt = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-traversals/${traversal.traversal.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          sourcePath: [[-11, 0, 0], [-11, 2.8, 0], [-9, 2.8, 0]],
        }),
      },
    );
    expect(repairRegistrationReceipt.status).toBe(200);
    const updateTraversalResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-traversals/${traversal.traversal.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ speedUnitsPerSecond: 1.4 }),
      },
    );
    expect(updateTraversalResponse.status).toBe(200);
    const revokeEvidenceResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/capture-bundles/${traversalEvidenceManifestId}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          decision: "rejected",
          note: "Traversal evidence withdrawn during qualification review.",
        }),
      },
    );
    expect(revokeEvidenceResponse.status).toBe(200);
    const staleEvidenceUpdate = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-traversals/${traversal.traversal.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ speedUnitsPerSecond: 1.5 }),
      },
    );
    expect(staleEvidenceUpdate.status).toBe(422);
    const restoreEvidenceResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/capture-bundles/${traversalEvidenceManifestId}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          decision: "accepted",
          note: "Traversal evidence reaccepted after the qualification review was corrected.",
        }),
      },
    );
    expect(restoreEvidenceResponse.status).toBe(200);
    await expect(currentNavigationAuthoringState(
      env.DB,
      member!.organisationId,
      projectId,
      versionId,
    )).rejects.toThrow("Active authored traversal records are invalid: stored=1, usable=0");
    const requalifyTraversalResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-traversals/${traversal.traversal.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ speedUnitsPerSecond: 1.4 }),
      },
    );
    expect(requalifyTraversalResponse.status).toBe(200);
    const automaticNavigation = await currentNavigationAuthoringState(
      env.DB,
      member!.organisationId,
      projectId,
      versionId,
    );
    expect(automaticNavigation.offMeshConnections).toEqual([
      expect.objectContaining({
        id: traversal.traversal.id,
        traversalKind: "elevator",
        evidenceReceipt: {
          assetId: traversalEvidenceAssetId,
          sha256: traversalEvidenceSha256,
          manifestId: traversalEvidenceManifestId,
          manifestSha256: traversalEvidenceManifestHash,
          adapter: "open-import",
          reviewGeneration: 3,
          registrationSha256: traversalRegistrationHash,
          sourceToWorld: traversalRegistrationPayload.sourceToWorld,
          sourcePath: [[-11, 0, 0], [-11, 2.8, 0], [-9, 2.8, 0]],
        },
      }),
    ]);
    await env.DB.prepare(`
      UPDATE scene_navigation_traversals
      SET evidence_source_to_world_json = ?
      WHERE id = ?
    `).bind(
      JSON.stringify({
        ...traversalRegistrationPayload.sourceToWorld,
        yawDegrees: 5,
      }),
      traversal.traversal.id,
    ).run();
    await expect(currentNavigationAuthoringState(
      env.DB,
      member!.organisationId,
      projectId,
      versionId,
    )).rejects.toThrow("Active authored traversal records are invalid: stored=1, usable=0");
    const repairTransformReceipt = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-traversals/${traversal.traversal.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ speedUnitsPerSecond: 1.4 }),
      },
    );
    expect(repairTransformReceipt.status).toBe(200);

    const unsafeUnitRelabel = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-profile`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          versionId,
          worldUnit: "scene_units",
          agentRadius: 0.3,
          agentHeight: 1.75,
          eyeHeight: 1.58,
          maxStepMetres: 0.08,
        }),
      },
    );
    expect(unsafeUnitRelabel.status).toBe(409);
    await expect(unsafeUnitRelabel.json()).resolves.toMatchObject({
      error: expect.stringContaining("Create a new version"),
    });

    const routeResponse = await exports.default.fetch(`${origin}/api/projects/${projectId}/spatial/routes`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        versionId,
        label: "First visit",
        accessibility: "step_free",
        stops: [{ entityId: entity.entity.id }],
      }),
    });
    expect(routeResponse.status).toBe(201);

    const policyResponse = await exports.default.fetch(`${origin}/api/projects/${projectId}/spatial/delivery-policy`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        adaptiveQuality: true,
        mobileLiteBudget: 0.75,
        mobileStandardBudget: 1.25,
        desktopStandardBudget: 2,
        desktopHighBudget: 4,
        maxInitialBytes: 15728640,
      }),
    });
    expect(policyResponse.status).toBe(200);

    const regionResponse = await exports.default.fetch(`${origin}/api/projects/${projectId}/spatial/privacy-regions`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        versionId,
        label: "Personal photograph",
        source: "operator",
        geometry: { type: "polygon", points: [[0, 0, 0], [1, 0, 0], [1, 1, 0]] },
      }),
    });
    expect(regionResponse.status).toBe(201);
    const region = await regionResponse.json<{ privacyRegion: { id: string } }>();
    const approveRegion = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/privacy-regions/${region.privacyRegion.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      },
    );
    expect(approveRegion.status).toBe(200);

    const workspace = await exports.default.fetch(`${origin}/api/projects/${projectId}/spatial`, {
      headers: { cookie },
    });
    expect(workspace.status).toBe(200);
    await expect(workspace.json()).resolves.toMatchObject({
      version: { id: versionId, version_number: 1 },
      entities: [
        { id: doorway.entity.id, kind: "doorway", label: "Gallery connector" },
        { id: entity.entity.id, kind: "room", label: "Gallery one" },
      ],
      routes: [{ label: "First visit", accessibility: "step_free" }],
      privacyRegions: [{ label: "Personal photograph", status: "approved" }],
      deliveryPolicy: { adaptive_quality: 1, mobile_lite_budget: 0.75 },
      collisionProxy: {
        version: "box-union-v1",
        boxes: [
          { entityId: entity.entity.id, label: "Gallery one", min: [-2, 0, -3], max: [2, 2.8, 3] },
          { entityId: doorway.entity.id, label: "Gallery connector", min: [-0.4, 0, 2.8], max: [0.4, 2.2, 3.3] },
        ],
      },
      navigationMesh: {
        version: "room-box-triangles-v1",
        indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
        sourceEntityIds: [entity.entity.id, doorway.entity.id],
      },
      navigationObstacles: [{
        id: obstacle.obstacle.id,
        label: "Display plinth",
      }],
      navigationTraversals: [{
        id: traversal.traversal.id,
        traversal_kind: "elevator",
        label: "Gallery lift",
        speed_units_per_second: 1.4,
        evidence_asset_id: traversalEvidenceAssetId,
        evidence_sha256: traversalEvidenceSha256,
        evidence_manifest_id: traversalEvidenceManifestId,
        evidence_manifest_sha256: traversalEvidenceManifestHash,
        evidence_adapter: "open-import",
        evidence_manifest_review_generation: 3,
      }],
      traversalEvidenceOptions: [{
        assetId: traversalEvidenceAssetId,
        fileName: "gallery-capture.ply",
        kind: "master",
        sha256: traversalEvidenceSha256,
        manifestId: traversalEvidenceManifestId,
        manifestSha256: traversalEvidenceManifestHash,
        adapter: "open-import",
        reviewGeneration: 3,
      }],
      obstacleProxy: {
        version: "authored-obstacle-boxes-v1",
        boxes: [{
          entityId: obstacle.obstacle.id,
          label: "Display plinth",
          min: [-0.5, 0, -0.5],
          max: [0.5, 1.2, 0.5],
        }],
      },
      navigationProfile: {
        worldUnit: "metres",
        agentRadius: 0.3,
        agentHeight: 1.75,
        eyeHeight: 1.58,
        maxStepMetres: 0.08,
      },
    });

    const updateRoom = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/entities/${entity.entity.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          label: "Gallery one revised",
          geometry: {
            type: "polygon",
            points: [
              [-2, 0, -3],
              [2, 0, -3],
              [2, 0, -1],
              [0, 0, -1],
              [0, 0, 3],
              [-2, 0, 3],
            ],
          },
        }),
      },
    );
    expect(updateRoom.status).toBe(200);
    const revisedWorkspace = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial`,
      { headers: { cookie } },
    );
    expect(revisedWorkspace.status).toBe(200);
    const revised = await revisedWorkspace.json<{
      entities: Array<{ id: string; label: string }>;
      navigationMesh: { version: string; sourceEntityIds: string[] };
    }>();
    expect(revised.entities.some((candidate) =>
      candidate.id === entity.entity.id &&
      candidate.label === "Gallery one revised"
    )).toBe(true);
    expect(revised.navigationMesh).toMatchObject({
        version: "authored-polygon-triangles-v2",
        sourceEntityIds: [entity.entity.id, doorway.entity.id],
    });
  });

  it("produces idempotent reviewed metric and visual evidence from authored geometry", async () => {
    const cookie = await login();
    const member = await env.DB.prepare(`
      SELECT organisation_id AS organisationId, user_id AS userId
      FROM memberships ORDER BY created_at LIMIT 1
    `).first<{ organisationId: string; userId: string }>();
    const projectId = crypto.randomUUID();
    const fromVersionId = crypto.randomUUID();
    const toVersionId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by)
        VALUES (?, ?, 'Geometry evidence', ?, 'QA_REQUIRED', 'open-import', 'venue-navigator', ?)
      `).bind(projectId, member!.organisationId, `geometry-${projectId.slice(0, 8)}`, member!.userId),
      env.DB.prepare(`
        INSERT INTO scene_versions (id, project_id, version_number, status, created_by)
        VALUES (?, ?, 1, 'QA_REQUIRED', ?)
      `).bind(fromVersionId, projectId, member!.userId),
      env.DB.prepare(`
        INSERT INTO scene_versions (id, project_id, version_number, status, created_by)
        VALUES (?, ?, 2, 'QA_REQUIRED', ?)
      `).bind(toVersionId, projectId, member!.userId),
      env.DB.prepare(`
        INSERT INTO scene_entities
          (id, organisation_id, project_id, version_id, kind, label, geometry_json, metadata_json, created_by)
        VALUES (?, ?, ?, ?, 'room', 'Gallery A', ?, '{}', ?)
      `).bind(
        crypto.randomUUID(),
        member!.organisationId,
        projectId,
        fromVersionId,
        JSON.stringify({ type: "box", points: [[0, 0, 0], [4, 3, 5]] }),
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO scene_entities
          (id, organisation_id, project_id, version_id, kind, label, geometry_json, metadata_json, created_by)
        VALUES (?, ?, ?, ?, 'room', 'Gallery A', ?, '{}', ?)
      `).bind(
        crypto.randomUUID(),
        member!.organisationId,
        projectId,
        toVersionId,
        JSON.stringify({ type: "box", points: [[0.1, 0, 0], [4.1, 3, 5]] }),
        member!.userId,
      ),
    ]);

    const body = {
      clientOperationId: operationId,
      fromVersionId,
      toVersionId,
      thresholdMm: 50,
      coordinateAssurance: "registered_project_frame",
      registrationEvidence: "Independent project control confirms both authored versions use the same Y-up local origin.",
    };
    const createdResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/change-reports`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json<{
      report: { id: string; status: string; summary: Record<string, unknown> };
    }>();
    expect(created.report).toMatchObject({
      status: "ready",
      summary: {
        method: "authored-plan-geometry-diff-v1",
        result: "changes_detected",
        thresholdMm: 50,
        summary: {
          comparable: 1,
          changed: 1,
          maxDeviationMm: 100,
        },
        visual: {
          coordinatePlane: "XZ",
          units: "metres",
        },
      },
    });

    const replayResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/change-reports`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(replayResponse.status).toBe(200);
    await expect(replayResponse.json()).resolves.toMatchObject({
      report: { id: created.report.id },
      idempotent: true,
    });

    const conflictResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/change-reports`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ ...body, thresholdMm: 80 }),
      },
    );
    expect(conflictResponse.status).toBe(409);

    const reviewResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/change-reports/${created.report.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          decision: "needs_recapture",
          note: "The 100 mm shift exceeds the agreed threshold; recapture and verify registration.",
        }),
      },
    );
    expect(reviewResponse.status).toBe(200);
    await expect(reviewResponse.json()).resolves.toMatchObject({
      report: {
        id: created.report.id,
        status: "reviewed",
        reviewDecision: "needs_recapture",
      },
    });

    const stored = await env.DB.prepare(`
      SELECT method, result, threshold_mm, source_geometry_hash,
        client_operation_id, request_hash, review_decision, reviewed_by
      FROM change_detection_reports WHERE id = ?
    `).bind(created.report.id).first<Record<string, unknown>>();
    expect(stored).toMatchObject({
      method: "authored-plan-geometry-diff-v1",
      result: "changes_detected",
      threshold_mm: 50,
      client_operation_id: operationId,
      review_decision: "needs_recapture",
      reviewed_by: member!.userId,
    });
    expect(stored!.source_geometry_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored!.request_hash).toMatch(/^[a-f0-9]{64}$/);

    const secondOperationId = crypto.randomUUID();
    const regeneratedResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/change-reports`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          clientOperationId: secondOperationId,
          thresholdMm: 80,
        }),
      },
    );
    expect(regeneratedResponse.status).toBe(201);
    await expect(regeneratedResponse.json()).resolves.toMatchObject({
      report: {
        id: created.report.id,
        summary: { thresholdMm: 80 },
      },
    });

    const historicalReplay = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/change-reports`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(historicalReplay.status).toBe(200);
    await expect(historicalReplay.json()).resolves.toMatchObject({
      report: {
        id: created.report.id,
        summary: { thresholdMm: 50 },
      },
      idempotent: true,
    });
    const operationCount = await env.DB.prepare(`
      SELECT count(*) AS count FROM change_detection_operations
      WHERE organisation_id = ? AND project_id = ?
    `).bind(member!.organisationId, projectId).first<{ count: number }>();
    expect(operationCount?.count).toBe(2);
  });

  it("stores private trajectory evidence and returns reviewed recapture guidance", async () => {
    const cookie = await login();
    const member = await env.DB.prepare(`
      SELECT organisation_id AS organisationId, user_id AS userId
      FROM memberships ORDER BY created_at LIMIT 1
    `).first<{ organisationId: string; userId: string }>();
    const projectId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by)
        VALUES (?, ?, 'Capture coverage', ?, 'QA_REQUIRED', 'open-import', 'venue-navigator', ?)
      `).bind(projectId, member!.organisationId, `coverage-${projectId.slice(0, 8)}`, member!.userId),
      env.DB.prepare(`
        INSERT INTO scene_versions (
          id, project_id, version_number, status, source_provenance_json, created_by
        ) VALUES (?, ?, 1, 'QA_REQUIRED', ?, ?)
      `).bind(
        versionId,
        projectId,
        JSON.stringify({ assetProducer: "open-import", adapter: "open-import" }),
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO scene_entities
          (id, organisation_id, project_id, version_id, kind, label, geometry_json, metadata_json, created_by)
        VALUES (?, ?, ?, ?, 'room', 'Captured room', ?, '{}', ?)
      `).bind(
        crypto.randomUUID(),
        member!.organisationId,
        projectId,
        versionId,
        JSON.stringify({ type: "box", points: [[0, 0, 0], [4, 3, 4]] }),
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO scene_entities
          (id, organisation_id, project_id, version_id, kind, label, geometry_json, metadata_json, created_by)
        VALUES (?, ?, ?, ?, 'room', 'Missed room', ?, '{}', ?)
      `).bind(
        crypto.randomUUID(),
        member!.organisationId,
        projectId,
        versionId,
        JSON.stringify({ type: "box", points: [[8, 0, 0], [12, 3, 4]] }),
        member!.userId,
      ),
    ]);
    const body = {
      clientOperationId: operationId,
      versionId,
      source: {
        adapter: "open-import",
        fileName: "capture-trajectory.json",
        format: "canonical_pose_json_v1",
        coordinateFrame: "project-local-y-up",
        alignmentEvidence: "Operator aligned the trajectory and authored rooms to the same local project frame.",
      },
      parameters: {
        coverageRadiusM: 1.25,
        maximumSampleGapM: 3,
        loopClosureRadiusM: 1,
        minimumRoomCoveragePercent: 85,
        verticalToleranceM: 0.5,
      },
      points: [
        { position: [0.5, 1.5, 0.5], timestampMs: 0 },
        { position: [2, 1.5, 0.5], timestampMs: 1000 },
        { position: [3.5, 1.5, 0.5], timestampMs: 2000 },
        { position: [3.5, 1.5, 2], timestampMs: 3000 },
        { position: [3.5, 1.5, 3.5], timestampMs: 4000 },
        { position: [2, 1.5, 3.5], timestampMs: 5000 },
        { position: [0.5, 1.5, 3.5], timestampMs: 6000 },
        { position: [0.5, 1.5, 2], timestampMs: 7000 },
        { position: [0.5, 1.5, 0.5], timestampMs: 8000 },
      ],
    };
    const provisionalProjectId = crypto.randomUUID();
    const provisionalVersionId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, name, slug, status, capture_adapter,
            delivery_template, created_by)
        VALUES (?, ?, 'Provisional capture coverage', ?, 'QA_REQUIRED',
          'open-import', 'venue-navigator', ?)
      `).bind(
        provisionalProjectId,
        member!.organisationId,
        `provisional-coverage-${provisionalProjectId.slice(0, 8)}`,
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO scene_versions
          (id, project_id, version_number, status, source_provenance_json, created_by)
        VALUES (?, ?, 1, 'QA_REQUIRED', ?, ?)
      `).bind(
        provisionalVersionId,
        provisionalProjectId,
        JSON.stringify({ assetProducer: "open-import", adapter: "open-import" }),
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO scene_navigation_profiles (
          version_id, organisation_id, project_id, world_unit, agent_radius,
          agent_height, eye_height, max_step_metres, updated_by
        ) VALUES (?, ?, ?, 'scene_units', 0.2, 1.2, 1, 0.05, ?)
      `).bind(
        provisionalVersionId,
        member!.organisationId,
        provisionalProjectId,
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO scene_entities (
          id, organisation_id, project_id, version_id, kind, label,
          geometry_json, metadata_json, created_by, world_unit
        ) VALUES (?, ?, ?, ?, 'room', 'Provisional room', ?, '{}', ?,
          'scene_units')
      `).bind(
        crypto.randomUUID(),
        member!.organisationId,
        provisionalProjectId,
        provisionalVersionId,
        JSON.stringify({ type: "box", points: [[0, 0, 0], [4, 3, 4]] }),
        member!.userId,
      ),
    ]);
    const producerTransition = await exports.default.fetch(`${origin}/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ assetProducer: "fjd-trion" }),
    });
    expect(producerTransition.status).toBe(200);
    const provisionalResponse = await exports.default.fetch(
      `${origin}/api/projects/${provisionalProjectId}/spatial/capture-completeness`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          clientOperationId: crypto.randomUUID(),
          versionId: provisionalVersionId,
        }),
      },
    );
    expect(provisionalResponse.status).toBe(409);
    await expect(provisionalResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("requires reviewed metric metres"),
    });

    const createdResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/capture-completeness`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json<{
      report: { id: string; result: string; summary: Record<string, unknown> };
    }>();
    expect(created.report).toMatchObject({
      result: "recapture_required",
      summary: {
        method: "authored-room-trajectory-coverage-v1",
        summary: {
          sampleCount: 9,
          roomCount: 2,
          roomsMeetingCoverage: 1,
          roomsBelowCoverage: 1,
          loopClosed: true,
        },
      },
    });

    const replay = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/capture-completeness`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      report: { id: created.report.id },
      idempotent: true,
    });
    const conflict = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/capture-completeness`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          parameters: { ...body.parameters, coverageRadiusM: 2 },
        }),
      },
    );
    expect(conflict.status).toBe(409);
    const adapterMismatch = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/capture-completeness`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          clientOperationId: crypto.randomUUID(),
          source: { ...body.source, adapter: "fjd-trion" },
        }),
      },
    );
    expect(adapterMismatch.status).toBe(422);

    const reviewed = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/capture-completeness/${created.report.id}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          decision: "needs_recapture",
          note: "The missed room requires another capture pass before reconstruction proceeds.",
        }),
      },
    );
    expect(reviewed.status).toBe(200);
    await expect(reviewed.json()).resolves.toMatchObject({
      report: {
        id: created.report.id,
        status: "reviewed",
        reviewDecision: "needs_recapture",
      },
    });

    const stored = await env.DB.prepare(`
      SELECT c.source_hash, c.request_hash, c.reviewed_by,
        a.object_key, a.size_bytes, a.integrity_status
      FROM capture_completeness_reports c
      JOIN assets a ON a.id = c.source_asset_id
      WHERE c.id = ?
    `).bind(created.report.id).first<{
      source_hash: string;
      request_hash: string;
      reviewed_by: string;
      object_key: string;
      size_bytes: number;
      integrity_status: string;
    }>();
    expect(stored).toMatchObject({
      reviewed_by: member!.userId,
      integrity_status: "verified",
    });
    expect(stored!.source_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored!.request_hash).toMatch(/^[a-f0-9]{64}$/);
    const sourceObject = await env.SPATIAL_ASSETS.get(stored!.object_key);
    expect(sourceObject).not.toBeNull();
    expect(sourceObject?.size).toBe(stored!.size_bytes);
    const persistedCounts = await env.DB.prepare(`
      SELECT
        (SELECT count(*) FROM capture_completeness_reports WHERE project_id = ?) AS reports,
        (SELECT count(*) FROM assets WHERE project_id = ? AND format = 'capture-trajectory-json') AS assets
    `).bind(projectId, projectId).first<{ reports: number; assets: number }>();
    expect(persistedCounts).toEqual({ reports: 1, assets: 1 });

    const workspace = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial?versionId=${versionId}`,
      { headers: { cookie } },
    );
    expect(workspace.status).toBe(200);
    await expect(workspace.json()).resolves.toMatchObject({
      captureCompletenessReports: [{
        id: created.report.id,
        result: "recapture_required",
        review_decision: "needs_recapture",
      }],
    });
  });

  it("queues idempotent privacy scans, exposes evidence candidates, and gates QA on human resolution", async () => {
    const cookie = await login();
    const member = await env.DB.prepare(`
      SELECT organisation_id AS organisationId, user_id AS userId
      FROM memberships ORDER BY created_at LIMIT 1
    `).first<{ organisationId: string; userId: string }>();
    const projectId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const posterAssetId = crypto.randomUUID();
    const webAssetId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const posterKey = `delivery-private/${member!.organisationId}/${projectId}/${versionId}/privacy-frame.png`;
    await env.SPATIAL_ASSETS.put(posterKey, new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]), {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { sha256: "a".repeat(64) },
    });
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by)
        VALUES (?, ?, 'Privacy evidence contract', ?, 'QA_REQUIRED', 'open-import', 'property-tour', ?)
      `).bind(projectId, member!.organisationId, `privacy-${projectId.slice(0, 8)}`, member!.userId),
      env.DB.prepare(`
        INSERT INTO scene_versions (id, project_id, version_number, status, created_by)
        VALUES (?, ?, 1, 'QA_REQUIRED', ?)
      `).bind(versionId, projectId, member!.userId),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, sha256, integrity_status)
        VALUES (?, ?, ?, ?, 'poster', 'png', ?, 'privacy-frame.png', 'image/png', 8, ?, 'verified')
      `).bind(
        posterAssetId, member!.organisationId, projectId, versionId, posterKey, "a".repeat(64),
      ),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, sha256, integrity_status)
        VALUES (?, ?, ?, ?, 'web', 'rad', ?, 'scene.rad', 'application/octet-stream', 8, ?, 'verified')
      `).bind(
        webAssetId, member!.organisationId, projectId, versionId,
        `delivery-private/${member!.organisationId}/${projectId}/${versionId}/scene.rad`,
        "b".repeat(64),
      ),
    ]);

    const requestBody = {
      clientOperationId: operationId,
      versionId,
      assetIds: [posterAssetId],
    };
    const queued = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/privacy-scans`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      },
    );
    expect(queued.status).toBe(202);
    const queuedBody = await queued.json<{ scan: { id: string; status: string } }>();
    expect(queuedBody.scan.status).toBe("QUEUED");

    const replay = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/privacy-scans`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      },
    );
    expect(replay.status).toBe(202);
    await expect(replay.json()).resolves.toMatchObject({
      scan: { id: queuedBody.scan.id },
      idempotent: true,
    });

    const candidateId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE privacy_scans
        SET status = 'COMPLETED', input_count = 1, candidate_count = 1,
          evidence_json = ?, completed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).bind(JSON.stringify({ detector: "test-fixture", inputs: 1 }), queuedBody.scan.id),
      env.DB.prepare(`
        INSERT INTO privacy_candidates
          (id, scan_id, organisation_id, project_id, version_id, asset_id, target,
            label, bbox_json, bbox_hash, detector_metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, 'human face', 'Human face', ?, ?, ?)
      `).bind(
        candidateId,
        queuedBody.scan.id,
        member!.organisationId,
        projectId,
        versionId,
        posterAssetId,
        JSON.stringify({ xMin: 0.1, yMin: 0.2, xMax: 0.4, yMax: 0.6 }),
        "c".repeat(64),
        JSON.stringify({ modelConfidenceUnavailable: true }),
      ),
    ]);

    const workspace = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial?versionId=${versionId}`,
      { headers: { cookie } },
    );
    expect(workspace.status).toBe(200);
    await expect(workspace.json()).resolves.toMatchObject({
      privacyScans: [{
        id: queuedBody.scan.id,
        status: "COMPLETED",
        input_count: 1,
        candidate_count: 1,
      }],
      privacyCandidates: [{
        id: candidateId,
        asset_id: posterAssetId,
        target: "human face",
        status: "pending",
      }],
    });

    const approvalBody = {
      webAssetId,
      posterAssetId,
      visualGrade: "A",
      privacyStatus: "approved",
      measurementGrade: "visual-only",
    };
    const blockedApproval = await exports.default.fetch(
      `${origin}/api/versions/${versionId}/approve`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(approvalBody),
      },
    );
    expect(blockedApproval.status).toBe(409);
    await expect(blockedApproval.json()).resolves.toMatchObject({
      error: expect.stringContaining("Privacy"),
    });

    const dismissed = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/privacy-candidates/${candidateId}`,
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          status: "dismissed",
          note: "Fixture contains no identifiable person.",
        }),
      },
    );
    expect(dismissed.status).toBe(200);

    const approved = await exports.default.fetch(
      `${origin}/api/versions/${versionId}/approve`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(approvalBody),
      },
    );
    expect(approved.status).toBe(409);
    await expect(approved.json()).resolves.toMatchObject({
      error: expect.stringContaining("QA approval blocked"),
    });
  });

  it("enforces retention in R2 and records an auditable lifecycle run", async () => {
    const cookie = await login();
    const member = await env.DB.prepare(`
      SELECT organisation_id AS organisationId, user_id AS userId
      FROM memberships ORDER BY created_at LIMIT 1
    `).first<{ organisationId: string; userId: string }>();
    const projectId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const expiredSessionId = crypto.randomUUID();
    const expiredRefreshHash = crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");
    const expiredHistoryHash = crypto.randomUUID().replaceAll("-", "").padEnd(64, "1");
    const objectKey = `raw-private/${member!.organisationId}/${projectId}/${versionId}/expired-source.ply`;
    await env.SPATIAL_ASSETS.put(objectKey, new Uint8Array([1, 2, 3, 4]));
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by)
        VALUES (?, ?, 'Retention proof', ?, 'ARCHIVED', 'open-import', 'property-tour', ?)
      `).bind(projectId, member!.organisationId, `retention-${projectId.slice(0, 8)}`, member!.userId),
      env.DB.prepare(`
        INSERT INTO scene_versions (id, project_id, version_number, status, created_by)
        VALUES (?, ?, 1, 'ARCHIVED', ?)
      `).bind(versionId, projectId, member!.userId),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, integrity_status, created_at)
        VALUES (?, ?, ?, ?, 'source', 'ply', ?, 'expired-source.ply',
          'application/octet-stream', 4, 'verified', '2000-01-01T00:00:00.000Z')
      `).bind(assetId, member!.organisationId, projectId, versionId, objectKey),
      env.DB.prepare(`
        INSERT INTO project_retention_policies
          (project_id, organisation_id, raw_retention_days, derivative_retention_days,
            release_retention_days, legal_hold, updated_by)
        VALUES (?, ?, 0, 30, 30, 0, ?)
      `).bind(projectId, member!.organisationId, member!.userId),
      env.DB.prepare(`
        INSERT INTO auth_otp_challenges
          (id, email, code_hash, expires_at, consumed_at, created_at)
        VALUES (?, 'expired@example.com', ?, datetime('now', '-8 days'),
          datetime('now', '-8 days'), datetime('now', '-8 days'))
      `).bind(crypto.randomUUID(), crypto.randomUUID()),
      env.DB.prepare(`
        INSERT INTO rate_limits (bucket, subject, window_start, request_count)
        VALUES ('retention-test', 'expired-subject', unixepoch('now') - 259200, 1)
      `),
      env.DB.prepare(`
        INSERT INTO auth_sessions
          (id, user_id, organisation_id, refresh_token_hash, expires_at, revoked_at,
            revoke_reason, last_seen_at, created_at)
        VALUES (?, ?, ?, ?, datetime('now', '-32 days'), datetime('now', '-32 days'),
          'retention_test', datetime('now', '-32 days'), datetime('now', '-32 days'))
      `).bind(expiredSessionId, member!.userId, member!.organisationId, expiredRefreshHash),
      env.DB.prepare(`
        INSERT INTO auth_refresh_token_history (token_hash, session_id, used_at)
        VALUES (?, ?, datetime('now', '-32 days'))
      `).bind(expiredHistoryHash, expiredSessionId),
    ]);

    // A second affected tenant proves the run-level digest is sent once rather
    // than once per organisation touched by the run.
    const tenantOrganisationId = crypto.randomUUID();
    const tenantProjectId = crypto.randomUUID();
    const tenantVersionId = crypto.randomUUID();
    const tenantAssetId = crypto.randomUUID();
    const tenantObjectKey =
      `raw-private/${tenantOrganisationId}/${tenantProjectId}/${tenantVersionId}/expired-source.ply`;
    await env.SPATIAL_ASSETS.put(tenantObjectKey, new Uint8Array([5, 6, 7, 8]));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO organisations (id, name, slug) VALUES (?, 'Retention tenant', ?)",
      ).bind(tenantOrganisationId, `retention-tenant-${tenantOrganisationId.slice(0, 8)}`),
      env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by)
        VALUES (?, ?, 'Tenant retention proof', ?, 'ARCHIVED', 'open-import', 'property-tour', ?)
      `).bind(
        tenantProjectId,
        tenantOrganisationId,
        `retention-${tenantProjectId.slice(0, 8)}`,
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO scene_versions (id, project_id, version_number, status, created_by)
        VALUES (?, ?, 1, 'ARCHIVED', ?)
      `).bind(tenantVersionId, tenantProjectId, member!.userId),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, integrity_status, created_at)
        VALUES (?, ?, ?, ?, 'source', 'ply', ?, 'expired-source.ply',
          'application/octet-stream', 4, 'verified', '2000-01-01T00:00:00.000Z')
      `).bind(tenantAssetId, tenantOrganisationId, tenantProjectId, tenantVersionId, tenantObjectKey),
      env.DB.prepare(`
        INSERT INTO project_retention_policies
          (project_id, organisation_id, raw_retention_days, derivative_retention_days,
            release_retention_days, legal_hold, updated_by)
        VALUES (?, ?, 0, 30, 30, 0, ?)
      `).bind(tenantProjectId, tenantOrganisationId, member!.userId),
    ]);

    const digestsBeforeRun = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM notification_deliveries WHERE template = 'lifecycle_digest'",
    ).first<{ count: number }>();
    const response = await exports.default.fetch(`${origin}/api/hosting/lifecycle/run`, {
      method: "POST",
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const lifecycleRun = await response.json<{
      runId: string;
      status: string;
      summary: Record<string, number>;
    }>();
    expect(lifecycleRun).toMatchObject({
      status: "succeeded",
      summary: {
        assetsDeleted: 2,
        otpChallengesDeleted: 1,
        rateLimitWindowsDeleted: 1,
        refreshHistoryDeleted: 1,
        notificationsSent: 1,
      },
    });
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM lifecycle_actions
      WHERE run_id = ? AND action = 'notification_sent'
    `).bind(lifecycleRun.runId).first<{ count: number }>()).toMatchObject({ count: 1 });
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM lifecycle_actions
      WHERE run_id = ? AND action = 'asset_deleted'
    `).bind(lifecycleRun.runId).first<{ count: number }>()).toMatchObject({ count: 2 });
    const digestsAfterRun = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM notification_deliveries WHERE template = 'lifecycle_digest'",
    ).first<{ count: number }>();
    expect(digestsAfterRun!.count - digestsBeforeRun!.count).toBe(1);
    await expect(env.SPATIAL_ASSETS.head(objectKey)).resolves.toBeNull();
    const tombstone = await env.DB.prepare(`
      SELECT deleted_at, deletion_reason FROM assets WHERE id = ?
    `).bind(assetId).first<{ deleted_at: string | null; deletion_reason: string | null }>();
    expect(tombstone?.deleted_at).toBeTruthy();
    expect(tombstone?.deletion_reason).toBe("source_retention_elapsed");
    const action = await env.DB.prepare(`
      SELECT action FROM lifecycle_actions WHERE resource_id = ? ORDER BY created_at DESC LIMIT 1
    `).bind(assetId).first<{ action: string }>();
    expect(action?.action).toBe("asset_deleted");
  });

  it("gates measured floor plans on scoped tolerance and independent residual evidence", async () => {
    const cookie = await login();
    const member = await env.DB.prepare(`
      SELECT organisation_id AS organisationId, user_id AS userId
      FROM memberships ORDER BY created_at LIMIT 1
    `).first<{ organisationId: string; userId: string }>();
    const projectId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const provisionalVersionId = crypto.randomUUID();
    const workflowPolicyRevisionId = crypto.randomUUID();
    const measurementJourneyId = crypto.randomUUID();
    const measurementVisualAssetId = crypto.randomUUID();
    const measurementGeometryAssetId = crypto.randomUUID();
    const measurementCoordinateEvidence = {
      schemaVersion: "ply-coordinate-evidence-v1",
      method: "automatic-ply-coordinate-evidence-v1",
      coordinateFrameId: `capture-journey:${measurementJourneyId}`,
      sourceUpAxis: "Y",
      worldUnit: "metres",
      vertexCount: 2,
      finitePointCount: 2,
      bounds: { min: [0, 0, 0], max: [5, 3, 6] },
    };
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by)
        VALUES (?, ?, 'Measured suite', ?, 'QA_REQUIRED', 'open-import', 'measured-floor-plan', ?)
      `).bind(projectId, member!.organisationId, `measured-${projectId.slice(0, 8)}`, member!.userId),
      env.DB.prepare(`
        INSERT INTO project_workflow_policy_revisions (
          id, organisation_id, project_id, revision_number, delivery_template,
          policy_json, transition_reason, created_by
        ) VALUES (?, ?, ?, 1, 'Measured capture pack', ?, 'Measurement test fixture', ?)
      `).bind(
        workflowPolicyRevisionId,
        member!.organisationId,
        projectId,
        JSON.stringify(projectPolicyForDeliveryTemplate("Measured capture pack")),
        member!.userId,
      ),
      env.DB.prepare(
        "UPDATE projects SET workflow_policy_revision_id = ? WHERE id = ?",
      ).bind(workflowPolicyRevisionId, projectId),
      env.DB.prepare(`
        INSERT INTO scene_versions (
          id, project_id, version_number, status, source_provenance_json,
          created_by, workflow_policy_revision_id
        ) VALUES (?, ?, 1, 'QA_REQUIRED', ?, ?, ?), (?, ?, 2, 'QA_REQUIRED', ?, ?, ?)
      `).bind(
        versionId,
        projectId,
        JSON.stringify({
          assetProducer: "open-import",
          adapter: "open-import",
          captureJourney: {
            schemaVersion: "paired-capture-journey-v2",
            id: measurementJourneyId,
            captureAdapter: "open-import",
            primaryAssetId: measurementVisualAssetId,
            geometryAssetId: measurementGeometryAssetId,
            declaration: "same-capture-registered-y-up-metres",
            sourceCoordinateFrameId: `capture-journey:${measurementJourneyId}`,
            confirmedBy: member!.userId,
            confirmedAt: new Date().toISOString(),
            qualification: {
              method: "automatic-ply-coordinate-evidence-v1",
              status: "verified",
              coordinateFrameId: `capture-journey:${measurementJourneyId}`,
              sourceUpAxis: "Y",
              worldUnit: "metres",
              overlapBounds: { min: [0, 0, 0], max: [5, 3, 6] },
              visual: measurementCoordinateEvidence,
              geometry: measurementCoordinateEvidence,
            },
          },
        }),
        member!.userId,
        workflowPolicyRevisionId,
        provisionalVersionId,
        projectId,
        JSON.stringify({ assetProducer: "open-import", adapter: "open-import" }),
        member!.userId,
        workflowPolicyRevisionId,
      ),
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, sha256, integrity_status
        ) VALUES
          (?, ?, ?, ?, 'master', 'ply', ?, 'measured-visual.ply',
            'application/octet-stream', 16, ?, 'verified'),
          (?, ?, ?, ?, 'pointcloud', 'ply', ?, 'measured-geometry.ply',
            'application/octet-stream', 16, ?, 'verified')
      `).bind(
        measurementVisualAssetId,
        member!.organisationId,
        projectId,
        versionId,
        `masters-private/${member!.organisationId}/${projectId}/${versionId}/measured-visual.ply`,
        "a".repeat(64),
        measurementGeometryAssetId,
        member!.organisationId,
        projectId,
        versionId,
        `raw-private/${member!.organisationId}/${projectId}/${versionId}/measured-geometry.ply`,
        "b".repeat(64),
      ),
      env.DB.prepare(`
        INSERT INTO scene_navigation_profiles (
          version_id, organisation_id, project_id, world_unit, agent_radius,
          agent_height, eye_height, max_step_metres, updated_by
        ) VALUES (?, ?, ?, 'scene_units', 0.22, 1.8, 1.6, 0.1, ?)
      `).bind(
        provisionalVersionId,
        member!.organisationId,
        projectId,
        member!.userId,
      ),
      env.DB.prepare(`
        INSERT INTO scene_entities (
          id, organisation_id, project_id, version_id, kind, label,
          geometry_json, metadata_json, created_by, world_unit
        ) VALUES (?, ?, ?, ?, 'room', 'Provisional measured room', ?, '{}', ?,
          'scene_units')
      `).bind(
        crypto.randomUUID(),
        member!.organisationId,
        projectId,
        provisionalVersionId,
        JSON.stringify({ type: "box", points: [[0, 0, 0], [4, 3, 4]] }),
        member!.userId,
      ),
    ]);

    const provisionalBrief = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/measurement/briefs`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          versionId: provisionalVersionId,
          productType: "measured_floor_plan",
          intendedUse: "Construction layout",
          units: "metres",
          toleranceMm: 30,
          relianceClass: "project_verified",
        }),
      },
    );
    expect(provisionalBrief.status).toBe(409);
    await expect(provisionalBrief.json()).resolves.toMatchObject({
      error: expect.stringContaining("require reviewed metric metres"),
    });
    const rejectedBriefCount = await env.DB.prepare(`
      SELECT count(*) AS count FROM measurement_briefs
      WHERE organisation_id = ? AND project_id = ? AND version_id = ?
    `).bind(
      member!.organisationId,
      projectId,
      provisionalVersionId,
    ).first<{ count: number }>();
    expect(Number(rejectedBriefCount?.count ?? 0)).toBe(0);

    const inconsistentBriefId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO measurement_briefs
        (id, organisation_id, project_id, version_id, product_type, intended_use,
          units, tolerance_mm, reliance_class, status, created_by)
      VALUES (?, ?, ?, ?, 'measured_floor_plan', 'Legacy inconsistent fixture',
        'metres', 30, 'project_verified', 'evidence_required', ?)
    `).bind(
      inconsistentBriefId,
      member!.organisationId,
      projectId,
      provisionalVersionId,
      member!.userId,
    ).run();
    const provisionalCheckPoint = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/measurement/briefs/${inconsistentBriefId}/check-points`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          label: "Rejected provisional checkpoint",
          reference: [0, 0, 0],
          observed: [0.01, 0, 0],
        }),
      },
    );
    expect(provisionalCheckPoint.status).toBe(409);
    const rejectedCheckPointCount = await env.DB.prepare(`
      SELECT count(*) AS count FROM measurement_check_points WHERE brief_id = ?
    `).bind(inconsistentBriefId).first<{ count: number }>();
    expect(Number(rejectedCheckPointCount?.count ?? 0)).toBe(0);
    await env.DB.prepare("DELETE FROM measurement_briefs WHERE id = ?")
      .bind(inconsistentBriefId)
      .run();

    const invalidCertified = await exports.default.fetch(`${origin}/api/projects/${projectId}/measurement/briefs`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        versionId,
        productType: "measured_floor_plan",
        intendedUse: "Leasing layout",
        units: "metres",
        toleranceMm: 30,
        relianceClass: "professional_certified",
      }),
    });
    expect(invalidCertified.status).toBe(400);

    const briefResponse = await exports.default.fetch(`${origin}/api/projects/${projectId}/measurement/briefs`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        versionId,
        productType: "measured_floor_plan",
        intendedUse: "Leasing layout and furniture planning",
        units: "metres",
        toleranceMm: 30,
        relianceClass: "project_verified",
        exclusions: "Hidden services and title boundaries",
      }),
    });
    expect(briefResponse.status).toBe(201);
    const brief = await briefResponse.json<{ brief: { id: string } }>();

    const relabelMeasuredVersion = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/spatial/navigation-profile`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          versionId,
          worldUnit: "scene_units",
          agentRadius: 0.22,
          agentHeight: 1.8,
          eyeHeight: 1.6,
          maxStepMetres: 0.1,
        }),
      },
    );
    expect(relabelMeasuredVersion.status).toBe(409);

    const roomResponse = await exports.default.fetch(`${origin}/api/projects/${projectId}/spatial/entities`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        versionId,
        kind: "room",
        label: "Measured room",
        geometry: {
          type: "box",
          points: [[1, 0, 2], [5.5, 2.8, 6]],
        },
        metadata: {},
      }),
    });
    expect(roomResponse.status).toBe(201);

    const prematureDeliverable = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/measurement/briefs/${brief.brief.id}/deliverables`,
      { method: "POST", headers: { cookie } },
    );
    expect(prematureDeliverable.status).toBe(409);
    await expect(prematureDeliverable.json()).resolves.toMatchObject({
      error: "A passing measurement QA report is required before generating a deliverable",
      code: "measurement_qa_required",
    });

    for (const [index, observed] of [[0.005, 0, 0], [1.01, 0, 0], [2.015, 0, 0]].entries()) {
      const response = await exports.default.fetch(
        `${origin}/api/projects/${projectId}/measurement/briefs/${brief.brief.id}/check-points`,
        {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            label: `CP-${index + 1}`,
            reference: [index, 0, 0],
            observed,
          }),
        },
      );
      expect(response.status).toBe(201);
    }

    const reportResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/measurement/briefs/${brief.brief.id}/qa-report`,
      { method: "POST", headers: { cookie } },
    );
    expect(reportResponse.status).toBe(201);
    await expect(reportResponse.json()).resolves.toMatchObject({
      report: { pointCount: 3, result: "pass", toleranceMm: 30 },
    });

    const deliverableResponse = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/measurement/briefs/${brief.brief.id}/deliverables`,
      { method: "POST", headers: { cookie } },
    );
    expect(deliverableResponse.status).toBe(201);
    const deliverable = await deliverableResponse.json<{
      deliverable: { id: string; assetId: string; fileName: string; sha256: string; downloadUrl: string };
    }>();
    expect(deliverable.deliverable).toMatchObject({
      fileName: `measured-${projectId.slice(0, 8)}-floor-plan.dxf`,
    });
    expect(deliverable.deliverable.sha256).toMatch(/^[a-f0-9]{64}$/);

    const download = await exports.default.fetch(`${origin}${deliverable.deliverable.downloadUrl}`, {
      headers: { cookie },
    });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain("application/dxf");
    expect(download.headers.get("content-disposition")).toContain(`measured-${projectId.slice(0, 8)}-floor-plan.dxf`);
    const dxf = new TextDecoder().decode(await download.arrayBuffer());
    expect(dxf).toContain("$INSUNITS");
    expect(dxf).toContain("ROOM_OUTLINE");
    expect(dxf).toContain("Measured room");
    expect(await sha256Hex(dxf)).toBe(deliverable.deliverable.sha256);

    const repeatedDeliverable = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/measurement/briefs/${brief.brief.id}/deliverables`,
      { method: "POST", headers: { cookie } },
    );
    expect(repeatedDeliverable.status).toBe(200);
    await expect(repeatedDeliverable.json()).resolves.toMatchObject({
      idempotent: true,
      deliverable: {
        id: deliverable.deliverable.id,
        assetId: deliverable.deliverable.assetId,
        sha256: deliverable.deliverable.sha256,
      },
    });

    const range = await exports.default.fetch(`${origin}${deliverable.deliverable.downloadUrl}`, {
      headers: { cookie, Range: "bytes=0-99" },
    });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toMatch(/^bytes 0-99\/\d+$/);
    expect((await range.arrayBuffer()).byteLength).toBe(100);

    const isolatedOrganisationId = crypto.randomUUID();
    const isolatedUserId = crypto.randomUUID();
    const isolatedSessionId = crypto.randomUUID();
    const isolatedRefreshSecret = "isolated-measurement-refresh";
    const isolatedNow = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO organisations (id, name, slug, created_at) VALUES (?, 'Isolated surveyor', ?, ?)",
      ).bind(isolatedOrganisationId, `isolated-${projectId.slice(0, 8)}`, isolatedNow),
      env.DB.prepare(
        "INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, 'Isolated operator', ?)",
      ).bind(isolatedUserId, `isolated-${projectId.slice(0, 8)}@example.com`, isolatedNow),
      env.DB.prepare(
        "INSERT INTO memberships (organisation_id, user_id, role, created_at) VALUES (?, ?, 'production_operator', ?)",
      ).bind(isolatedOrganisationId, isolatedUserId, isolatedNow),
      env.DB.prepare(`
        INSERT INTO auth_sessions
          (id, user_id, organisation_id, refresh_token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        isolatedSessionId,
        isolatedUserId,
        isolatedOrganisationId,
        await sha256Hex(`${isolatedRefreshSecret}:${env.REFRESH_TOKEN_PEPPER}`),
        new Date(Date.now() + 60_000).toISOString(),
        isolatedNow,
      ),
    ]);
    const isolatedTokens = await issueAuthTokens(env, {
      userId: isolatedUserId,
      organisationId: isolatedOrganisationId,
      email: `isolated-${projectId.slice(0, 8)}@example.com`,
      displayName: "Isolated operator",
      role: "production_operator",
    }, isolatedSessionId, isolatedRefreshSecret);
    const isolatedDownload = await exports.default.fetch(
      `${origin}${deliverable.deliverable.downloadUrl}`,
      { headers: { cookie: `spatial_access=${isolatedTokens.accessToken}` } },
    );
    expect(isolatedDownload.status).toBe(404);

    const changedGeometry = await exports.default.fetch(`${origin}/api/projects/${projectId}/spatial/entities`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        versionId,
        kind: "room",
        label: "Added after QA",
        geometry: {
          type: "box",
          points: [[6, 0, 2], [8, 2.8, 4]],
        },
        metadata: {},
      }),
    });
    expect(changedGeometry.status).toBe(201);
    const staleGeneration = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/measurement/briefs/${brief.brief.id}/deliverables`,
      { method: "POST", headers: { cookie } },
    );
    expect(staleGeneration.status).toBe(409);
    await expect(staleGeneration.json()).resolves.toMatchObject({
      code: "measurement_qa_stale",
    });
    const retainedDownload = await exports.default.fetch(
      `${origin}${deliverable.deliverable.downloadUrl}`,
      { headers: { cookie } },
    );
    expect(retainedDownload.status).toBe(200);
    expect(await sha256Hex(new TextDecoder().decode(await retainedDownload.arrayBuffer())))
      .toBe(deliverable.deliverable.sha256);

    const workspace = await exports.default.fetch(`${origin}/api/projects/${projectId}/measurement`, {
      headers: { cookie },
    });
    expect(workspace.status).toBe(200);
    await expect(workspace.json()).resolves.toMatchObject({
      briefs: [{ id: brief.brief.id, status: "accepted", reliance_class: "project_verified" }],
      qaReports: [{ point_count: 3, result: "pass" }],
      deliverables: [{ id: deliverable.deliverable.id, asset_id: deliverable.deliverable.assetId }],
      economics: { totalCostCents: 0, currency: "MYR" },
    });
  });
});

describe("upload integrity and processing-job durability", () => {
  async function createProject(cookie: string, captureAdapter = "open-import"): Promise<string> {
    const response = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Integrity ${crypto.randomUUID().slice(0, 8)}`,
        captureAdapter,
        deliveryTemplate: "property-tour",
      }),
    });
    expect(response.status).toBe(201);
    const { project } = await response.json<{ project: { id: string } }>();
    return project.id;
  }

  async function createUpload(
    cookie: string,
    projectId: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string; assetId: string; versionId: string; partSizeBytes: number }> {
    const response = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/uploads`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ clientOperationId: crypto.randomUUID(), ...body }),
      },
    );
    expect(response.status).toBe(201);
    const { upload } = await response.json<{
      upload: { id: string; assetId: string; versionId: string; partSizeBytes: number };
    }>();
    return upload;
  }

  it("scales the multipart part size so a session can never exceed R2's part ceiling", async () => {
    const cookie = await login();
    const projectId = await createProject(cookie);
    const small = await createUpload(cookie, projectId, {
      fileName: "small.rad",
      sizeBytes: 4 * 1024 * 1024,
      format: "rad",
      mimeType: "application/octet-stream",
    });
    expect(small.partSizeBytes).toBe(10 * 1024 * 1024);

    const hugeSizeBytes = 100 * 1024 * 1024 * 1024;
    const huge = await createUpload(cookie, projectId, {
      fileName: "huge.rad",
      sizeBytes: hugeSizeBytes,
      format: "rad",
      mimeType: "application/octet-stream",
    });
    expect(huge.partSizeBytes).toBeGreaterThan(10 * 1024 * 1024);
    expect(huge.partSizeBytes % (1024 * 1024)).toBe(0);
    expect(huge.partSizeBytes).toBeLessThanOrEqual(95 * 1024 * 1024);
    expect(Math.ceil(hugeSizeBytes / huge.partSizeBytes)).toBeLessThanOrEqual(10_000);
    const persisted = await env.DB.prepare(
      "SELECT part_size_bytes FROM upload_sessions WHERE id = ?",
    ).bind(huge.id).first<{ part_size_bytes: number }>();
    expect(persisted?.part_size_bytes).toBe(huge.partSizeBytes);
  });

  it("records a server-computed digest and quarantines a declared digest that does not match", async () => {
    const cookie = await login();
    const bytes = new Uint8Array(64).fill(7);
    const trueSha256 = await sha256Hex(bytes);

    const honestProject = await createProject(cookie);
    const honest = await createUpload(cookie, honestProject, {
      fileName: "honest.rad",
      sizeBytes: bytes.byteLength,
      format: "rad",
      mimeType: "application/octet-stream",
      sha256: trueSha256,
    });
    const honestPart = await exports.default.fetch(
      `${origin}/api/uploads/${honest.id}/parts/1`,
      {
        method: "PUT",
        headers: { cookie, "content-length": String(bytes.byteLength) },
        body: bytes,
      },
    );
    expect(honestPart.status).toBe(200);
    await expect(honestPart.json()).resolves.toMatchObject({ sizeBytes: bytes.byteLength });
    const honestEtag = (await env.DB.prepare(
      "SELECT etag FROM upload_parts WHERE upload_session_id = ? AND part_number = 1",
    ).bind(honest.id).first<{ etag: string }>())!.etag;
    const honestComplete = await exports.default.fetch(
      `${origin}/api/uploads/${honest.id}/complete`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ parts: [{ partNumber: 1, etag: honestEtag }] }),
      },
    );
    expect(honestComplete.status).toBe(200);
    await expect(honestComplete.json()).resolves.toMatchObject({
      asset: {
        sha256: trueSha256,
        integrityStatus: "verified",
        integritySource: "server_verified",
      },
    });

    const lyingProject = await createProject(cookie);
    const lying = await createUpload(cookie, lyingProject, {
      fileName: "lying.rad",
      sizeBytes: bytes.byteLength,
      format: "rad",
      mimeType: "application/octet-stream",
      sha256: "b".repeat(64),
    });
    await exports.default.fetch(`${origin}/api/uploads/${lying.id}/parts/1`, {
      method: "PUT",
      headers: { cookie, "content-length": String(bytes.byteLength) },
      body: bytes,
    });
    const lyingEtag = (await env.DB.prepare(
      "SELECT etag FROM upload_parts WHERE upload_session_id = ? AND part_number = 1",
    ).bind(lying.id).first<{ etag: string }>())!.etag;
    const lyingComplete = await exports.default.fetch(
      `${origin}/api/uploads/${lying.id}/complete`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ parts: [{ partNumber: 1, etag: lyingEtag }] }),
      },
    );
    expect(lyingComplete.status).toBe(409);
    const quarantined = await env.DB.prepare(`
      SELECT a.integrity_status, a.integrity_source, a.sha256,
        u.status AS upload_status,
        (SELECT COUNT(*) FROM processing_jobs WHERE input_asset_id = a.id) AS job_count
      FROM assets a
      JOIN upload_sessions u ON u.asset_id = a.id
      WHERE a.id = ?
    `).bind(lying.assetId).first<{
      integrity_status: string;
      integrity_source: string;
      sha256: string;
      upload_status: string;
      job_count: number;
    }>();
    expect(quarantined).toEqual({
      integrity_status: "failed",
      integrity_source: "server_verified",
      sha256: trueSha256,
      upload_status: "FAILED",
      job_count: 0,
    });
  });

  it("retires expired open upload sessions and unblocks project archival", async () => {
    const cookie = await login();
    const projectId = await createProject(cookie);
    const upload = await createUpload(cookie, projectId, {
      fileName: "abandoned.rad",
      sizeBytes: 1024,
      format: "rad",
      mimeType: "application/octet-stream",
    });
    const blockedArchive = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/archive`,
      { method: "POST", headers: { cookie, origin } },
    );
    expect(blockedArchive.status).toBe(409);

    await env.DB.prepare(
      "UPDATE upload_sessions SET expires_at = datetime('now', '-1 day') WHERE id = ?",
    ).bind(upload.id).run();
    const expiredArchive = await exports.default.fetch(
      `${origin}/api/projects/${projectId}/archive`,
      { method: "POST", headers: { cookie, origin } },
    );
    expect(expiredArchive.status).toBe(200);
    await exports.default.fetch(`${origin}/api/projects/${projectId}/restore`, {
      method: "POST",
      headers: { cookie, origin },
    });

    const lifecycle = await exports.default.fetch(`${origin}/api/hosting/lifecycle/run`, {
      method: "POST",
      headers: { cookie },
    });
    expect(lifecycle.status).toBe(200);
    const summary = await lifecycle.json<{ summary: { uploadSessionsExpired: number } }>();
    expect(summary.summary.uploadSessionsExpired).toBeGreaterThanOrEqual(1);
    const retired = await env.DB.prepare(
      "SELECT status FROM upload_sessions WHERE id = ?",
    ).bind(upload.id).first<{ status: string }>();
    expect(retired?.status).toBe("ABORTED");
    const action = await env.DB.prepare(
      "SELECT action FROM lifecycle_actions WHERE resource_id = ? AND resource_type = 'upload_session'",
    ).bind(upload.id).first<{ action: string }>();
    expect(action?.action).toBe("upload_session_expired");
  });

  it("keeps the highest reported progress across heartbeats", async () => {
    const cookie = await login();
    const projectId = await createProject(cookie);
    const project = await env.DB.prepare(
      "SELECT organisation_id, created_by FROM projects WHERE id = ?",
    ).bind(projectId).first<{ organisation_id: string; created_by: string }>();
    const versionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO scene_versions
          (id, project_id, version_number, status, source_provenance_json, created_by)
        VALUES (?, ?, 1, 'PROCESSING', '{}', ?)
      `).bind(versionId, projectId, project!.created_by),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, sha256, integrity_status)
        VALUES (?, ?, ?, ?, 'source', 'rad', ?, 'scene.rad', 'application/octet-stream',
          16, ?, 'pending')
      `).bind(
        assetId,
        project!.organisation_id,
        projectId,
        versionId,
        `raw-private/${project!.organisation_id}/${projectId}/${versionId}/scene.rad`,
        "e".repeat(64),
      ),
      env.DB.prepare(`
        INSERT INTO processing_jobs
          (id, organisation_id, project_id, version_id, input_asset_id, job_type,
            processor_version, idempotency_key, state)
        VALUES (?, ?, ?, ?, ?, 'asset.validate', 'open-import-v1', ?, 'QUEUED')
      `).bind(
        jobId,
        project!.organisation_id,
        projectId,
        versionId,
        assetId,
        `heartbeat-progress:${jobId}`,
      ),
    ]);
    const leaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workerId: "progress-worker", jobId }),
    });
    expect(leaseResponse.status).toBe(200);
    const lease = await leaseResponse.json<{ leaseToken: string }>();
    for (const progress of [96, 12]) {
      const heartbeat = await exports.default.fetch(
        `${origin}/api/worker/jobs/${jobId}/heartbeat`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.WORKER_API_TOKEN}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ leaseToken: lease.leaseToken, progress, message: `at ${progress}` }),
        },
      );
      expect(heartbeat.status).toBe(200);
    }
    const stored = await env.DB.prepare(
      "SELECT progress, progress_message FROM processing_jobs WHERE id = ?",
    ).bind(jobId).first<{ progress: number; progress_message: string }>();
    expect(stored).toEqual({ progress: 96, progress_message: "at 12" });
  });

  it("bounds operator retries and clears the dispatch stamp on requeue", async () => {
    const cookie = await login();
    const projectId = await createProject(cookie);
    const project = await env.DB.prepare(
      "SELECT organisation_id, created_by FROM projects WHERE id = ?",
    ).bind(projectId).first<{ organisation_id: string; created_by: string }>();
    const versionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO scene_versions
          (id, project_id, version_number, status, source_provenance_json, created_by)
        VALUES (?, ?, 1, 'PROCESSING_FAILED', '{}', ?)
      `).bind(versionId, projectId, project!.created_by),
      env.DB.prepare(`
        INSERT INTO processing_jobs
          (id, organisation_id, project_id, version_id, job_type, processor_version,
            idempotency_key, state, retry_count, dispatched_at)
        VALUES (?, ?, ?, ?, 'asset.validate', 'open-import-v1', ?, 'DEAD_LETTER', 4,
          datetime('now'))
      `).bind(
        jobId,
        project!.organisation_id,
        projectId,
        versionId,
        `retry-bound:${jobId}`,
      ),
    ]);
    const retry = await exports.default.fetch(`${origin}/api/jobs/${jobId}/retry`, {
      method: "POST",
      headers: { cookie, origin },
    });
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      job: { state: "QUEUED", retryCount: 5 },
      retriesRemaining: 0,
    });
    const requeued = await env.DB.prepare(
      "SELECT retry_count, dispatched_at FROM processing_jobs WHERE id = ?",
    ).bind(jobId).first<{ retry_count: number; dispatched_at: string | null }>();
    expect(requeued?.retry_count).toBe(5);
    expect(requeued?.dispatched_at).toBeNull();

    await env.DB.prepare(
      "UPDATE processing_jobs SET state = 'DEAD_LETTER' WHERE id = ?",
    ).bind(jobId).run();
    const exhausted = await exports.default.fetch(`${origin}/api/jobs/${jobId}/retry`, {
      method: "POST",
      headers: { cookie, origin },
    });
    expect(exhausted.status).toBe(409);
    await expect(exhausted.json()).resolves.toMatchObject({ code: "retry_limit_exhausted" });
  });
});

describe("processing-job dispatch, lease reaping, and output size", () => {
  async function seedLeasableJob(options: {
    jobType: string;
    state?: string;
    attemptCount?: number;
    maxAttempts?: number;
    leaseExpiresAt?: string | null;
    assetKind?: string;
    assetFormat?: string;
    assetBytes?: Uint8Array;
    assetSha256?: string;
  }): Promise<{
    cookie: string;
    organisationId: string;
    createdBy: string;
    projectId: string;
    versionId: string;
    assetId: string;
    jobId: string;
    objectKey: string;
  }> {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Dispatch ${crypto.randomUUID().slice(0, 8)}`,
        captureAdapter: "open-import",
        deliveryTemplate: "property-tour",
      }),
    });
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const owner = (await env.DB.prepare(
      "SELECT organisation_id, created_by FROM projects WHERE id = ?",
    ).bind(project.id).first<{ organisation_id: string; created_by: string }>())!;
    const versionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const assetBytes = options.assetBytes ?? new Uint8Array(8).fill(3);
    const assetSha256 = options.assetSha256 ?? await sha256Hex(assetBytes);
    const assetKind = options.assetKind ?? "source";
    const assetFormat = options.assetFormat ?? "rad";
    const objectKey =
      `raw-private/${owner.organisation_id}/${project.id}/${versionId}/input.${assetFormat}`;
    await env.SPATIAL_ASSETS.put(objectKey, assetBytes);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO scene_versions
          (id, project_id, version_number, status, source_provenance_json, created_by)
        VALUES (?, ?, 1, 'PROCESSING', '{}', ?)
      `).bind(versionId, project.id, owner.created_by),
      env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, sha256, integrity_status, integrity_source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'application/octet-stream', ?, ?, 'verified',
          'server_verified')
      `).bind(
        assetId,
        owner.organisation_id,
        project.id,
        versionId,
        assetKind,
        assetFormat,
        objectKey,
        `input.${assetFormat}`,
        assetBytes.byteLength,
        assetSha256,
      ),
      env.DB.prepare(`
        INSERT INTO processing_jobs
          (id, organisation_id, project_id, version_id, input_asset_id, job_type,
            processor_version, idempotency_key, state, attempt_count, max_attempts,
            lease_expires_at)
        VALUES (?, ?, ?, ?, ?, ?, 'spatial-processor/0.11.0', ?, ?, ?, ?, ?)
      `).bind(
        jobId,
        owner.organisation_id,
        project.id,
        versionId,
        assetId,
        options.jobType,
        `dispatch-fixture:${jobId}`,
        options.state ?? "QUEUED",
        options.attemptCount ?? 0,
        options.maxAttempts ?? 3,
        options.leaseExpiresAt ?? null,
      ),
    ]);
    return {
      cookie,
      organisationId: owner.organisation_id,
      createdBy: owner.created_by,
      projectId: project.id,
      versionId,
      assetId,
      jobId,
      objectKey,
    };
  }

  it("dispatches a reconciled job once per backoff window instead of every minute", async () => {
    const seeded = await seedLeasableJob({ jobType: "asset.validate" });
    const processingSend = vi.fn(async () => undefined);
    const scheduledEnv = {
      ...env,
      PROCESSING_DISPATCH_QUEUE: { send: processingSend },
      PORTFOLIO_COPY_QUEUE: { send: vi.fn(async () => undefined) },
    } as unknown as Env;
    for (let tick = 0; tick < 3; tick += 1) {
      const context = createExecutionContext();
      await worker.scheduled!(
        createScheduledController({ cron: "* * * * *" }),
        scheduledEnv,
        context,
      );
      await waitOnExecutionContext(context);
    }
    expect(
      processingSend.mock.calls.filter(([message]) =>
        (message as { jobId?: string }).jobId === seeded.jobId
      ),
    ).toHaveLength(1);
    const stamped = await env.DB.prepare(
      "SELECT dispatched_at FROM processing_jobs WHERE id = ?",
    ).bind(seeded.jobId).first<{ dispatched_at: string | null }>();
    expect(stamped?.dispatched_at).toBeTruthy();

    await env.DB.prepare(
      "UPDATE processing_jobs SET dispatched_at = datetime('now', '-20 minutes') WHERE id = ?",
    ).bind(seeded.jobId).run();
    const laterContext = createExecutionContext();
    await worker.scheduled!(
      createScheduledController({ cron: "* * * * *" }),
      scheduledEnv,
      laterContext,
    );
    await waitOnExecutionContext(laterContext);
    expect(
      processingSend.mock.calls.filter(([message]) =>
        (message as { jobId?: string }).jobId === seeded.jobId
      ),
    ).toHaveLength(2);
  });

  it("dead-letters an exhausted job whose lease expired so it reaches the failure dashboard", async () => {
    const seeded = await seedLeasableJob({
      jobType: "asset.validate",
      state: "RUNNING",
      attemptCount: 3,
      maxAttempts: 3,
      leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const scheduledEnv = {
      ...env,
      PROCESSING_DISPATCH_QUEUE: { send: vi.fn(async () => undefined) },
      PORTFOLIO_COPY_QUEUE: { send: vi.fn(async () => undefined) },
    } as unknown as Env;
    const context = createExecutionContext();
    await worker.scheduled!(
      createScheduledController({ cron: "* * * * *" }),
      scheduledEnv,
      context,
    );
    await waitOnExecutionContext(context);
    const reaped = await env.DB.prepare(
      "SELECT state, error_json, lease_expires_at FROM processing_jobs WHERE id = ?",
    ).bind(seeded.jobId).first<{
      state: string;
      error_json: string;
      lease_expires_at: string | null;
    }>();
    expect(reaped?.state).toBe("DEAD_LETTER");
    expect(reaped?.lease_expires_at).toBeNull();
    expect(JSON.parse(reaped!.error_json)).toMatchObject({
      code: "JOB_LEASE_EXPIRED",
      failureClass: "lease_expired",
    });
    const version = await env.DB.prepare(
      "SELECT status FROM scene_versions WHERE id = ?",
    ).bind(seeded.versionId).first<{ status: string }>();
    expect(version?.status).toBe("PROCESSING_FAILED");
  });

  it("requeues a reclaimed-lease failure report instead of treating it as terminal", async () => {
    const seeded = await seedLeasableJob({ jobType: "asset.validate" });
    const leaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workerId: "lease-reporter", jobId: seeded.jobId }),
    });
    expect(leaseResponse.status).toBe(200);
    const lease = await leaseResponse.json<{ leaseToken: string }>();
    const failure = await exports.default.fetch(
      `${origin}/api/worker/jobs/${seeded.jobId}/fail`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leaseToken: lease.leaseToken,
          code: "PROCESSOR_LEASE_REJECTED",
          message: "A lease-scoped route rejected the reclaimed lease",
          retryable: false,
          failureClass: "lease",
        }),
      },
    );
    expect(failure.status).toBe(200);
    await expect(failure.json()).resolves.toMatchObject({
      job: { state: "QUEUED", retryQueued: true },
    });
    const requeued = await env.DB.prepare(
      "SELECT state, dispatched_at FROM processing_jobs WHERE id = ?",
    ).bind(seeded.jobId).first<{ state: string; dispatched_at: string | null }>();
    expect(requeued).toEqual({ state: "QUEUED", dispatched_at: null });
  });

  it("stores only a navigation summary on the job and keeps the artifact on the build", async () => {
    const collisionBytes = new Uint8Array(4).fill(1);
    const collisionSha256 = await sha256Hex(collisionBytes);
    const seeded = await seedLeasableJob({
      jobType: "navigation.build-v1",
      assetKind: "collision",
      assetFormat: "glb",
      assetBytes: collisionBytes,
      assetSha256: collisionSha256,
    });
    const buildAuthoringHash = "f".repeat(64);
    const buildId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO scene_navigation_builds (
        id, organisation_id, project_id, version_id, collision_asset_id,
        job_id, status, parameters_json, client_operation_id, request_hash,
        authoring_hash, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?)
    `).bind(
      buildId,
      seeded.organisationId,
      seeded.projectId,
      seeded.versionId,
      seeded.assetId,
      seeded.jobId,
      JSON.stringify({ offMeshConnections: [] }),
      crypto.randomUUID(),
      "a".repeat(64),
      buildAuthoringHash,
      seeded.createdBy,
    ).run();

    const detourBase64 = btoa("x".repeat(1024));
    const navigationArtifact = {
      schemaVersion: "spatial-navigation-v6",
      generator: {
        name: "recast-navigation-js",
        version: "0.43.1",
        nativeRecastCommit: "599fd0f023181c0a484df2a18cf1d75a3553852e",
        mode: "tiled",
      },
      coordinateSystem: {
        handedness: "right",
        upAxis: "Y",
        worldUnit: "metres",
        triangleWinding: "counter-clockwise",
      },
      source: {
        assetId: seeded.assetId,
        sha256: collisionSha256,
        authoringHash: buildAuthoringHash,
        triangleCount: 2,
        vertexCount: 4,
      },
      agent: {
        radius: 0.22,
        height: 1.8,
        eyeHeight: 1.6,
        maxClimb: 0.1,
        maxSlopeDegrees: 45,
        maxSpeed: 1.6,
        maxAcceleration: 8,
      },
      build: {
        cellSize: 0.1,
        cellHeight: 0.05,
        tileSize: 32,
        maxEdgeLengthVoxels: 12,
        maxSimplificationError: 1.3,
        minimumRegionSizeVoxels: 8,
        mergeRegionSizeVoxels: 20,
      },
      recastConfig: { walkableRadius: 3, walkableHeight: 36, walkableClimb: 2 },
      bounds: [[0, 0, 0], [4, 2.6, 4]],
      spawn: {
        id: "opening",
        requestedPosition: [0.5, 0, 0.5],
        projectedPosition: [0.5, 0, 0.5],
      },
      offMeshConnections: [],
      navMesh: {
        clearanceApplied: true,
        vertices: Array.from({ length: 900 }, (_, index) => [index * 0.01, 0, index * 0.02]),
        indices: Array.from({ length: 900 }, (_, index) => index % 900),
      },
      detour: {
        format: "recast-navigation-js-export-v1",
        byteLength: 1024,
        bytesBase64: detourBase64,
      },
      validation: {
        passed: true,
        componentCount: 1,
        rawTriangleComponentCount: 1,
        spawnProjectedDistance: 0,
        destinationCount: 0,
        unreachableDestinationIds: [],
        destinations: [],
      },
      physicalValidation: {
        passed: true,
        engine: "rapier3d",
        version: "0.19.3",
        controller: "kinematic-capsule",
        spawnOccupancyPassed: true,
        routeCount: 0,
        failedDestinationIds: [],
        routes: [],
      },
    };
    expect(navigationArtifactSchema.safeParse(navigationArtifact).success).toBe(true);

    const navmeshKey =
      `delivery-private/${seeded.organisationId}/${seeded.projectId}/${seeded.versionId}/navigation.bin`;
    const reportKey =
      `reports-private/${seeded.organisationId}/${seeded.projectId}/${seeded.versionId}/navigation.json`;
    const navmeshBytes = new Uint8Array(64).fill(9);
    const reportBytes = new TextEncoder().encode(JSON.stringify({ ok: true }));
    await Promise.all([
      env.SPATIAL_ASSETS.put(navmeshKey, navmeshBytes),
      env.SPATIAL_ASSETS.put(reportKey, reportBytes),
    ]);

    const leaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workerId: "navigation-builder", jobId: seeded.jobId }),
    });
    expect(leaseResponse.status).toBe(200);
    const lease = await leaseResponse.json<{ leaseToken: string }>();
    const completion = await exports.default.fetch(
      `${origin}/api/worker/jobs/${seeded.jobId}/complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leaseToken: lease.leaseToken,
          progressMessage: "Navigation build accepted",
          outputs: [
            {
              kind: "navmesh",
              format: "bin",
              objectKey: navmeshKey,
              fileName: "navigation.bin",
              mimeType: "application/octet-stream",
            },
            {
              kind: "report",
              format: "json",
              objectKey: reportKey,
              fileName: "navigation.json",
              mimeType: "application/json",
            },
          ],
          report: navigationArtifact,
          evidence: {
            processorVersion: "spatial-processor/0.11.0",
            computeDurationMs: 100,
            activeHumanDurationMs: 0,
            inputBytes: collisionBytes.byteLength,
            outputBytes: navmeshBytes.byteLength + reportBytes.byteLength,
            toolVersions: { processor: "test" },
          },
        }),
      },
    );
    expect(completion.status).toBe(200);
    const stored = await env.DB.prepare(`
      SELECT j.output_json, b.artifact_json, b.status
      FROM processing_jobs j
      JOIN scene_navigation_builds b ON b.job_id = j.id
      WHERE j.id = ?
    `).bind(seeded.jobId).first<{
      output_json: string;
      artifact_json: string;
      status: string;
    }>();
    expect(stored?.status).toBe("READY_FOR_REVIEW");
    // The full artifact survives exactly once, on the build the manifest reads.
    expect(JSON.parse(stored!.artifact_json)).toMatchObject({
      navMesh: { indices: navigationArtifact.navMesh.indices },
      detour: { bytesBase64: detourBase64 },
    });
    expect(stored!.output_json).not.toContain(detourBase64);
    expect(stored!.output_json.length).toBeLessThan(stored!.artifact_json.length / 4);
    expect(JSON.parse(stored!.output_json)).toMatchObject({
      report: {
        artifactStoredIn: "scene_navigation_builds.artifact_json",
        navMesh: { vertexCount: 900, indexCount: 900 },
        detour: { format: "recast-navigation-js-export-v1", byteLength: 1024 },
      },
    });
  });
});
