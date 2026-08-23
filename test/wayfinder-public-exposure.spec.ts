// Wayfinder (#34) capped machine-attested walkability at the credential-gated
// tier. That gate is gone: trajectory evidence is trusted for public exposure
// like any other cook. These pin the removal so it cannot creep back.
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";

const origin = "https://spatial.test";
let addressSequence = 9900;

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

function frozenAutoOpenBlob(): string {
  return JSON.stringify({
    schemaVersion: "trajectory-auto-open-v1",
    evidence: {
      schemaVersion: "trajectory-evidence-v1",
      trajectory: {
        assetId: crypto.randomUUID(),
        sha256: "e".repeat(64),
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
    },
    qualifiedOpenings: [{
      levelId: "level-001",
      openingId: "opening-001",
      roomIds: ["room-001", "room-002"],
    }],
  });
}

async function seedApprovedVersion(cookie: string, trajectoryEvidenceJson: string | null): Promise<{
  projectId: string;
  revisionId: string;
  planHash: string;
}> {
  const revisionId = crypto.randomUUID();
  const planHash = "c".repeat(64);
  const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      clientOperationId: crypto.randomUUID(),
      name: `Machine exposure ${crypto.randomUUID().slice(0, 8)}`,
      captureAdapter: "fjd-trion",
      deliveryTemplate: "Property showcase",
    }),
  });
  expect(projectResponse.status).toBe(201);
  const { project } = await projectResponse.json<{ project: { id: string } }>();
  const stored = await env.DB.prepare(
    "SELECT organisation_id, created_by, workflow_policy_revision_id FROM projects WHERE id = ?",
  ).bind(project.id).first<{
    organisation_id: string;
    created_by: string;
    workflow_policy_revision_id: string;
  }>();
  const versionId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const extractionJobId = crypto.randomUUID();
  const extractionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO scene_versions
        (id, project_id, version_number, status, manifest_json,
          source_provenance_json, created_by, workflow_policy_revision_id)
      VALUES (?, ?, 1, 'APPROVED', '{}', '{}', ?, ?)
    `).bind(
      versionId,
      project.id,
      stored!.created_by,
      stored!.workflow_policy_revision_id,
    ),
    env.DB.prepare(`
      INSERT INTO assets (
        id, organisation_id, project_id, version_id, kind, format, object_key,
        file_name, mime_type, size_bytes, sha256, integrity_status
      ) VALUES (?, ?, ?, ?, 'pointcloud', 'ply', ?, 'registered.ply',
        'application/octet-stream', 16, ?, 'verified')
    `).bind(
      assetId,
      stored!.organisation_id,
      project.id,
      versionId,
      `masters-private/${stored!.organisation_id}/${project.id}/fixture.ply`,
      "d".repeat(64),
    ),
    env.DB.prepare(`
      INSERT INTO processing_jobs
        (id, organisation_id, project_id, version_id, input_asset_id, job_type,
          processor_version, idempotency_key, state, progress)
      VALUES (?, ?, ?, ?, ?, 'floorplan.extract-v1', 'fixture', ?, 'SUCCEEDED', 100)
    `).bind(
      extractionJobId,
      stored!.organisation_id,
      project.id,
      versionId,
      assetId,
      `exposure-gate-${extractionJobId}`,
    ),
    env.DB.prepare(`
      INSERT INTO floorplan_extraction_runs
        (id, organisation_id, project_id, version_id, input_asset_id, job_id,
          method, normalizer, status, parameters_json, source_evidence_json,
          proposal_json, proposal_hash, client_operation_id, request_hash, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'metric-pointcloud-floorplan-v1', 'native-ply-v1',
        'REVIEWED', '{"automaticPipeline":true}', '{}', '{}', ?, ?, ?, ?)
    `).bind(
      extractionId,
      stored!.organisation_id,
      project.id,
      versionId,
      assetId,
      extractionJobId,
      "a".repeat(64),
      crypto.randomUUID(),
      "b".repeat(64),
      stored!.created_by,
    ),
    env.DB.prepare(`
      INSERT INTO floorplan_revisions
        (id, organisation_id, project_id, version_id, extraction_id,
          revision_number, plan_json, plan_hash, source_proposal_hash,
          review_note, created_by, trajectory_evidence_json)
      VALUES (?, ?, ?, ?, ?, 1, '{}', ?, ?, 'Exposure gate fixture.', ?, ?)
    `).bind(
      revisionId,
      stored!.organisation_id,
      project.id,
      versionId,
      extractionId,
      planHash,
      "a".repeat(64),
      stored!.created_by,
      trajectoryEvidenceJson,
    ),
  ]);
  return { projectId: project.id, revisionId, planHash };
}

function publish(cookie: string, projectId: string, accessPolicy: string) {
  return exports.default.fetch(`${origin}/api/projects/${projectId}/releases`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      slug: `exposure-gate-${crypto.randomUUID().slice(0, 8)}`,
      accessPolicy,
      viewerConfig: {
        title: "Exposure gate fixture",
        measurementDisclaimer: "Visual reference only.",
        defaultMovementMode: "walk",
      },
    }),
  });
}

// Trajectory evidence is trusted for public exposure like any other cook. The
// gate that capped machine-changed walking maps at the credential-gated tier
// was removed: the operator decides this once, when they set the project's
// trajectory policy, and re-collecting it per revision only taught operators to
// publish token-only.
describe("machine-changed walking maps and public exposure", () => {
  it("never refuses public exposure for machine trajectory changes", async () => {
    const cookie = await login();
    const seeded = await seedApprovedVersion(cookie, frozenAutoOpenBlob());
    for (const accessPolicy of ["public", "unlisted"]) {
      const attempt = await publish(cookie, seeded.projectId, accessPolicy);
      const body = JSON.stringify(await attempt.json());
      expect(body).not.toContain("machine trajectory evidence");
      expect(body).not.toContain("operator-ratified structure");
    }
  }, 120_000);

  it("does not refuse on an unreadable frozen blob either", async () => {
    // Nothing reads the blob for an exposure decision any more, so a corrupt
    // one can no longer block a release on its own.
    const cookie = await login();
    const seeded = await seedApprovedVersion(cookie, "{\"not\":\"a valid blob\"}");
    const attempt = await publish(cookie, seeded.projectId, "public");
    const body = JSON.stringify(await attempt.json());
    expect(body).not.toContain("trajectory auto-open evidence is unreadable");
  }, 120_000);
});
