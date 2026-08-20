// Wayfinder (#32): approving a floor plan under the trajectoryAutoOpen policy
// freezes the proposal's trajectory evidence with the exact `unknown`
// openings it qualifies, cooks those openings passable, and keeps the frozen
// authoring hash reproducible from the stored revision row. With the policy
// off (the default), nothing is frozen and the sealed cook is untouched.
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";
import { currentNavigationAuthoringState } from "../src/worker/index";
import { sha256Hex } from "../src/worker/security";

const origin = "https://spatial.test";
let addressSequence = 9800;

async function login(): Promise<string> {
  const email = env.ADMIN_EMAIL.toLowerCase();
  const challengeId = crypto.randomUUID();
  const code = "424242";
  await env.DB.prepare(`
    INSERT INTO auth_otp_challenges (id, email, code_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(
    challengeId,
    email,
    await otpHash(challengeId, email, code, env.OTP_PEPPER),
    new Date(Date.now() + 60_000).toISOString(),
  ).run();
  addressSequence += 1;
  const response = await exports.default.fetch(`${origin}/api/auth/otp/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": `2001:db8::${addressSequence.toString(16)}`,
    },
    body: JSON.stringify({ email, challengeId, code }),
  });
  expect(response.status).toBe(200);
  const access = (response.headers.get("set-cookie") ?? "").match(/spatial_access=([^;,]+)/)?.[1];
  expect(access).toBeTruthy();
  return `spatial_access=${access}`;
}

const TWO_ROOM_PLAN = {
  schemaVersion: "1.0.0",
  units: "metres",
  coordinateFrame: "registered_y_up_metric_frame",
  levels: [{
    id: "level-001",
    label: "Ground",
    elevationM: 0,
    ceilingElevationM: 2.8,
    rooms: [
      { id: "room-001", label: "Room A", points: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      { id: "room-002", label: "Room B", points: [[4.2, 0], [8, 0], [8, 4], [4.2, 4]] },
    ],
    walls: [
      { id: "wall-001", label: "Shared", start: [4.1, 0], end: [4.1, 4], thicknessM: 0.2, heightM: 2.8 },
      { id: "wall-002", label: "Racking", start: [1, 1], end: [1, 3], thicknessM: 0.2, heightM: 2.8 },
    ],
    openings: [
      {
        id: "opening-001",
        label: "Unresolved gap",
        type: "unknown",
        wallId: "wall-001",
        start: [4.1, 1.5],
        end: [4.1, 2.5],
        widthM: 1,
        heightM: null,
      },
    ],
  }],
  connectors: [],
};

function trajectoryEvidenceFixture(): Record<string, unknown> {
  return {
    schemaVersion: "trajectory-evidence-v1",
    trajectory: {
      assetId: crypto.randomUUID(),
      sha256: "f".repeat(64),
      sourceFormat: "las",
      vertexCount: 240,
      sampledPointCount: 240,
      samplingStride: 1,
    },
    parameters: {
      minimumVisitedSamples: 3,
      carryHeightBandM: { minimum: 0.2, maximum: 3 },
    },
    sampleCount: 240,
    unassignedSampleCount: 0,
    levels: [{
      levelId: "level-001",
      elevationM: 0,
      sampleCount: 240,
      rooms: [
        { roomId: "room-001", sampleCount: 120, visited: true },
        { roomId: "room-002", sampleCount: 120, visited: true },
      ],
    }],
    visitedRoomIds: ["level-001/room-001", "level-001/room-002"],
    wallCrossings: [{ wallId: "wall-002", crossingCount: 2 }],
  };
}

async function seedReviewableExtraction(input: {
  cookie: string;
  trajectoryAutoOpen: "off" | "visited-rooms";
  withEvidence: boolean;
}): Promise<{
  projectId: string;
  organisationId: string;
  versionId: string;
  extractionId: string;
}> {
  const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { cookie: input.cookie, "content-type": "application/json" },
    body: JSON.stringify({
      clientOperationId: crypto.randomUUID(),
      name: `Auto-open ${crypto.randomUUID().slice(0, 8)}`,
      captureAdapter: "fjd-trion",
      deliveryTemplate: "venue-navigator",
    }),
  });
  expect(projectResponse.status).toBe(201);
  const { project } = await projectResponse.json<{ project: { id: string } }>();
  if (input.trajectoryAutoOpen !== "off") {
    // Project create derives the policy from the delivery template; opting
    // into trajectory auto-open is an explicit post-create policy change.
    const policyUpdate = await exports.default.fetch(`${origin}/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { cookie: input.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        workflowPolicy: {
          schemaVersion: "project-workflow-policy-v1",
          privacyReview: "strict",
          publication: "public-after-approval",
          navigation: "visitor-walk",
          measurement: "indicative",
          hosting: "managed-required",
          quality: "standard",
          structureWorkflow: "review-every-proposal",
          navigationClearance: "ada-route-review",
          trajectoryAutoOpen: input.trajectoryAutoOpen,
        },
        transitionReason: "Opting this project into trajectory auto-open for testing.",
      }),
    });
    expect(policyUpdate.status).toBe(200);
  }
  const stored = await env.DB.prepare(
    "SELECT organisation_id, created_by, workflow_policy_revision_id FROM projects WHERE id = ?",
  ).bind(project.id).first<{
    organisation_id: string;
    created_by: string;
    workflow_policy_revision_id: string;
  }>();
  expect(stored).toBeTruthy();

  const versionId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const source = new TextEncoder().encode("ply-fixture-bytes");
  const objectKey =
    `masters-private/${stored!.organisation_id}/${project.id}/${versionId}/registered.ply`;
  await env.SPATIAL_ASSETS.put(objectKey, source);

  const jobId = crypto.randomUUID();
  const extractionId = crypto.randomUUID();
  const proposal = {
    schemaVersion: "1.0.0",
    method: "metric-pointcloud-floorplan-v1",
    result: "proposal_ready",
    ...(input.withEvidence ? { trajectoryEvidence: trajectoryEvidenceFixture() } : {}),
  };
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO scene_versions
        (id, project_id, version_number, status, source_provenance_json, created_by,
          workflow_policy_revision_id)
      VALUES (?, ?, 1, 'QA_REQUIRED', ?, ?, ?)
    `).bind(
      versionId,
      project.id,
      JSON.stringify({
        registered: true,
        units: "metres",
        upAxis: "y",
        assetProducer: "fjd-trion",
        adapter: "fjd-trion",
      }),
      stored!.created_by,
      stored!.workflow_policy_revision_id,
    ),
    env.DB.prepare(`
      INSERT INTO assets (
        id, organisation_id, project_id, version_id, kind, format, object_key,
        file_name, mime_type, size_bytes, sha256, integrity_status
      ) VALUES (?, ?, ?, ?, 'pointcloud', 'ply', ?, 'registered.ply',
        'application/octet-stream', ?, ?, 'verified')
    `).bind(
      assetId,
      stored!.organisation_id,
      project.id,
      versionId,
      objectKey,
      source.byteLength,
      await sha256Hex(source),
    ),
    env.DB.prepare(`
      INSERT INTO processing_jobs
        (id, organisation_id, project_id, version_id, input_asset_id, job_type,
          processor_version, idempotency_key, state, progress)
      VALUES (?, ?, ?, ?, ?, 'floorplan.extract-v1', 'fixture', ?, 'SUCCEEDED', 100)
    `).bind(
      jobId,
      stored!.organisation_id,
      project.id,
      versionId,
      assetId,
      `wayfinder-auto-open-${jobId}`,
    ),
    env.DB.prepare(`
      INSERT INTO floorplan_extraction_runs
        (id, organisation_id, project_id, version_id, input_asset_id, job_id,
          method, normalizer, status, parameters_json, source_evidence_json,
          proposal_json, proposal_hash, client_operation_id, request_hash,
          created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'metric-pointcloud-floorplan-v1', 'native-ply-v1',
        'READY_FOR_REVIEW', ?, '{}', ?, ?, ?, ?, ?)
    `).bind(
      extractionId,
      stored!.organisation_id,
      project.id,
      versionId,
      assetId,
      jobId,
      JSON.stringify({
        automaticPipeline: true,
        sourceUpAxis: "y",
        coordinateAssurance: "registered_y_up_metric_frame",
      }),
      JSON.stringify(proposal),
      "a".repeat(64),
      crypto.randomUUID(),
      "b".repeat(64),
      stored!.created_by,
    ),
  ]);
  return {
    projectId: project.id,
    organisationId: stored!.organisation_id,
    versionId,
    extractionId,
  };
}

async function approvePlan(cookie: string, projectId: string, extractionId: string) {
  return exports.default.fetch(
    `${origin}/api/projects/${projectId}/spatial/floorplan-extractions/${extractionId}/review`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        decision: "approve",
        note: "Approving the corrected structure for auto-open testing.",
        plan: TWO_ROOM_PLAN,
      }),
    },
  );
}

describe("wayfinder trajectory auto-open freeze", () => {
  it("freezes qualified openings and keeps the authoring hash reproducible", async () => {
    const cookie = await login();
    const seeded = await seedReviewableExtraction({
      cookie,
      trajectoryAutoOpen: "visited-rooms",
      withEvidence: true,
    });
    const review = await approvePlan(cookie, seeded.projectId, seeded.extractionId);
    expect(review.status).toBe(200);

    const revision = await env.DB.prepare(`
      SELECT id, trajectory_evidence_json, plan_hash FROM floorplan_revisions
      WHERE extraction_id = ? AND status = 'approved'
    `).bind(seeded.extractionId).first<{
      id: string;
      trajectory_evidence_json: string | null;
      plan_hash: string;
    }>();
    expect(revision).toBeTruthy();
    expect(revision!.trajectory_evidence_json).toBeTruthy();
    const frozen = JSON.parse(revision!.trajectory_evidence_json!);
    expect(frozen).toMatchObject({
      schemaVersion: "trajectory-auto-open-v1",
      qualifiedOpenings: [{
        levelId: "level-001",
        openingId: "opening-001",
        roomIds: ["room-001", "room-002"],
      }],
    });
    expect(frozen.evidence.trajectory.sha256).toBe("f".repeat(64));
    expect(frozen.demotedWalls).toEqual([{
      levelId: "level-001",
      wallId: "wall-002",
      crossingCount: 2,
      roomId: "room-001",
    }]);

    // The queued build's frozen authoring hash must be reproducible from the
    // stored revision row — the receipt fragment lives in both hash sites.
    const build = await env.DB.prepare(`
      SELECT authoring_hash FROM scene_navigation_builds
      WHERE organisation_id = ? AND project_id = ? AND version_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(seeded.organisationId, seeded.projectId, seeded.versionId)
      .first<{ authoring_hash: string }>();
    expect(build).toBeTruthy();
    const recomputed = await currentNavigationAuthoringState(
      env.DB,
      seeded.organisationId,
      seeded.projectId,
      seeded.versionId,
    );
    expect(recomputed.authoringHash).toBe(build!.authoring_hash);

    // Differential proof that the frozen evidence participates in the hash:
    // removing it must change the recomputed authoring hash.
    await env.DB.prepare(`
      UPDATE floorplan_revisions SET trajectory_evidence_json = NULL WHERE id = ?
    `).bind(revision!.id).run();
    const withoutEvidence = await currentNavigationAuthoringState(
      env.DB,
      seeded.organisationId,
      seeded.projectId,
      seeded.versionId,
    );
    expect(withoutEvidence.authoringHash).not.toBe(build!.authoring_hash);
  }, 120_000);

  it("freezes nothing when the policy is off, even with evidence present", async () => {
    const cookie = await login();
    const seeded = await seedReviewableExtraction({
      cookie,
      trajectoryAutoOpen: "off",
      withEvidence: true,
    });
    const review = await approvePlan(cookie, seeded.projectId, seeded.extractionId);
    expect(review.status).toBe(200);
    const revision = await env.DB.prepare(`
      SELECT trajectory_evidence_json FROM floorplan_revisions
      WHERE extraction_id = ? AND status = 'approved'
    `).bind(seeded.extractionId).first<{ trajectory_evidence_json: string | null }>();
    expect(revision).toBeTruthy();
    expect(revision!.trajectory_evidence_json).toBeNull();
    const build = await env.DB.prepare(`
      SELECT authoring_hash FROM scene_navigation_builds
      WHERE organisation_id = ? AND project_id = ? AND version_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(seeded.organisationId, seeded.projectId, seeded.versionId)
      .first<{ authoring_hash: string }>();
    const recomputed = await currentNavigationAuthoringState(
      env.DB,
      seeded.organisationId,
      seeded.projectId,
      seeded.versionId,
    );
    expect(recomputed.authoringHash).toBe(build!.authoring_hash);
  }, 120_000);

  it("freezes an empty qualification when the policy is on but no evidence exists", async () => {
    const cookie = await login();
    const seeded = await seedReviewableExtraction({
      cookie,
      trajectoryAutoOpen: "visited-rooms",
      withEvidence: false,
    });
    const review = await approvePlan(cookie, seeded.projectId, seeded.extractionId);
    expect(review.status).toBe(200);
    const revision = await env.DB.prepare(`
      SELECT trajectory_evidence_json FROM floorplan_revisions
      WHERE extraction_id = ? AND status = 'approved'
    `).bind(seeded.extractionId).first<{ trajectory_evidence_json: string | null }>();
    expect(revision!.trajectory_evidence_json).toBeNull();
  }, 120_000);
});
