import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { otpHash } from "../src/worker/auth";
import { sha256Hex } from "../src/worker/security";

const origin = "https://spatial.test";
let addressSequence = 7200;

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

function pointCloudPly(): Uint8Array {
  const points: string[] = [];
  for (const y of [0, 3]) {
    for (let x = 0.125; x < 4; x += 0.25) {
      for (let z = 0.125; z < 3; z += 0.25) points.push(`${x} ${y} ${z}`);
    }
  }
  return new TextEncoder().encode([
    "ply",
    "format ascii 1.0",
    `element vertex ${points.length}`,
    "property float x",
    "property float y",
    "property float z",
    "end_header",
    ...points,
    "",
  ].join("\n"));
}

describe("reviewed point-cloud semantic extraction", () => {
  it("queues a verified PLY, persists machine candidates, and authors only the accepted polygon", async () => {
    const cookie = await login();
    const projectResponse = await exports.default.fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        name: `Semantic extraction ${crypto.randomUUID().slice(0, 8)}`,
        captureAdapter: "open-import",
        deliveryTemplate: "venue-navigator",
      }),
    });
    expect(projectResponse.status).toBe(201);
    const { project } = await projectResponse.json<{ project: { id: string } }>();
    const storedProject = await env.DB.prepare(
      "SELECT organisation_id, created_by FROM projects WHERE id = ?",
    ).bind(project.id).first<{ organisation_id: string; created_by: string }>();
    expect(storedProject).toBeTruthy();

    const versionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const bytes = pointCloudPly();
    const objectKey =
      `masters-private/${storedProject!.organisation_id}/${project.id}/${versionId}/registered-floor.ply`;
    await env.SPATIAL_ASSETS.put(objectKey, bytes);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO scene_versions
          (id, project_id, version_number, status, source_provenance_json, created_by)
        VALUES (?, ?, 1, 'QA_REQUIRED', '{"registered":true,"units":"scene_units","upAxis":"y"}', ?)
      `).bind(versionId, project.id, storedProject!.created_by),
      env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format, object_key,
          file_name, mime_type, size_bytes, sha256, integrity_status
        ) VALUES (?, ?, ?, ?, 'pointcloud', 'ply', ?, 'registered-floor.ply',
          'application/octet-stream', ?, ?, 'verified')
      `).bind(
        assetId,
        storedProject!.organisation_id,
        project.id,
        versionId,
        objectKey,
        bytes.byteLength,
        await sha256Hex(bytes),
      ),
    ]);

    const clientOperationId = crypto.randomUUID();
    const request = {
      clientOperationId,
      versionId,
      inputAssetId: assetId,
      coordinateAssurance: "authored_source_to_world_v1",
      sourceToWorld: {
        sourceUpAxis: "Y",
        worldUnit: "scene_units",
        metresPerSourceUnit: 1,
        yawDegrees: 0,
        translationMetres: [0, 0, 0],
      },
      registrationEvidence:
        "The immutable PLY uses provisional scene units in a reviewed project-local Y-up frame; no metric scale is claimed.",
      gridSizeM: 0.5,
      floorBandM: 0.15,
      minimumAreaM2: 2,
      maximumCandidates: 8,
      maximumSamplePoints: 100_000,
    };
    const create = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/semantic-extractions`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    expect(create.status).toBe(202);
    const created = await create.json<{
      extraction: { id: string; jobId: string; status: string };
    }>();
    expect(created.extraction.status).toBe("QUEUED");

    const replay = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/semantic-extractions`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      extraction: { id: created.extraction.id, jobId: created.extraction.jobId },
      idempotent: true,
    });

    const leaseResponse = await exports.default.fetch(`${origin}/api/worker/jobs/lease`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ workerId: "semantic-extraction-test" }),
    });
    expect(leaseResponse.status).toBe(200);
    const lease = await leaseResponse.json<{
      leaseToken: string;
      job: {
        id: string;
        jobType: string;
        semanticExtractionId: string;
        semanticConfig: {
          gridSizeM: number;
          floorBandM: number;
          minimumAreaM2: number;
          coordinateAssurance: string;
        };
        input: { id: string; downloadUrl: string };
      };
    }>();
    expect(lease.job).toMatchObject({
      id: created.extraction.jobId,
      jobType: "semantic.extract-v1",
      semanticExtractionId: created.extraction.id,
      semanticConfig: {
        gridSizeM: 0.5,
        floorBandM: 0.15,
        minimumAreaM2: 2,
        coordinateAssurance: "authored_source_to_world_v1",
      },
      input: { id: assetId },
    });

    const report = {
      schemaVersion: "1.0.0",
      worldUnit: "scene_units",
      method: "registered-ply-walkable-candidates-v2",
      result: "candidates_ready",
      source: {
        vertexCount: 384,
        sampledPointCount: 384,
        voxelCount: 384,
        coordinateAssurance: "authored_source_to_world_v1",
        sourceToWorld: request.sourceToWorld,
      },
      parameters: {
        gridSize: 0.5,
        floorBand: 0.15,
        minimumArea: 2,
        maximumCandidates: 8,
        elevationHint: null,
      },
      summary: {
        inferredFloorElevation: 0,
        credibleHorizontalLayerCount: 2,
        candidateCount: 1,
        totalCandidateArea: 12,
      },
      candidates: [{
        candidateKey: "walkable-001",
        kind: "walkable_region",
        label: "Candidate room 1",
        elevation: 0,
        area: 12,
        confidence: 0.95,
        geometry: {
          type: "polygon",
          points: [[0, 0, 0], [4, 0, 0], [4, 0, 3], [0, 0, 3]],
        },
        evidence: {
          occupiedCellCount: 48,
          boundingCellCount: 48,
          supportRatio: 1,
          gridSize: 0.5,
          floorBand: 0.15,
        },
      }],
      humanReviewRequired: true,
      limitations: [
        "Candidates are occupancy-derived walkable proxies, not walls, legal rooms, accessibility certification, or survey evidence.",
      ],
    };
    const reportBytes = new TextEncoder().encode(`${JSON.stringify(report)}\n`);
    const outputResponse = await exports.default.fetch(
      `${origin}/api/worker/jobs/${lease.job.id}/outputs/report/semantic-candidates.json`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "x-job-lease": lease.leaseToken,
          "content-type": "application/json",
          "content-length": String(reportBytes.byteLength),
        },
        body: reportBytes,
      },
    );
    expect(outputResponse.status).toBe(201);
    const output = await outputResponse.json<{ output: Record<string, unknown> }>();
    const complete = await exports.default.fetch(
      `${origin}/api/worker/jobs/${lease.job.id}/semantic-extraction-complete`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          leaseToken: lease.leaseToken,
          progressMessage: "Walkable candidates ready for human review",
          output: output.output,
          report,
          evidence: {
            processorVersion: "spatial-processor/0.5.0",
            computeDurationMs: 38,
            activeHumanDurationMs: 0,
            inputBytes: bytes.byteLength,
            outputBytes: reportBytes.byteLength,
            toolVersions: { processor: "0.5.0" },
          },
        }),
      },
    );
    expect(complete.status).toBe(200);
    await expect(complete.json()).resolves.toMatchObject({
      job: { id: lease.job.id, state: "SUCCEEDED" },
      extraction: {
        id: created.extraction.id,
        status: "READY_FOR_REVIEW",
        candidateCount: 1,
      },
    });

    const workspace = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial?versionId=${versionId}`,
      { headers: { cookie } },
    );
    expect(workspace.status).toBe(200);
    const spatial = await workspace.json<{
      semanticExtractions: Array<{
        id: string;
        status: string;
        summary_json: string;
      }>;
      semanticCandidates: Array<{
        id: string;
        status: string;
        geometry_json: string;
        elevation: number;
        area: number;
        worldUnit: string;
      }>;
    }>();
    expect(spatial.semanticExtractions).toEqual([
      expect.objectContaining({ id: created.extraction.id, status: "READY_FOR_REVIEW" }),
    ]);
    expect(JSON.parse(spatial.semanticExtractions[0]!.summary_json)).toEqual({
      inferredFloorElevation: 0,
      credibleHorizontalLayerCount: 2,
      candidateCount: 1,
      totalCandidateArea: 12,
    });
    expect(spatial.semanticCandidates).toEqual([
      expect.objectContaining({
        status: "pending",
        geometry_json: expect.stringContaining("polygon"),
        elevation: 0,
        area: 12,
        worldUnit: "scene_units",
      }),
    ]);

    const candidateId = spatial.semanticCandidates[0]!.id;
    const reviewOperationId = crypto.randomUUID();
    const review = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/semantic-extractions/${created.extraction.id}/review`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: reviewOperationId,
          decision: "accept_selected",
          candidateIds: [candidateId],
          note: "The operator checked the polygon against the registered point cloud and accepts it as an editable room seed.",
        }),
      },
    );
    expect(review.status).toBe(200);
    const reviewed = await review.json<{
      extraction: { status: string };
      createdEntities: Array<{ id: string; kind: string; parentId: string | null }>;
    }>();
    expect(reviewed.extraction.status).toBe("REVIEWED");
    expect(reviewed.createdEntities).toEqual([
      expect.objectContaining({ kind: "floor", parentId: null }),
      expect.objectContaining({ kind: "room", parentId: expect.any(String) }),
    ]);

    const reviewReplay = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/semantic-extractions/${created.extraction.id}/review`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          clientOperationId: reviewOperationId,
          decision: "accept_selected",
          candidateIds: [candidateId],
          note: "The operator checked the polygon against the registered point cloud and accepts it as an editable room seed.",
        }),
      },
    );
    expect(reviewReplay.status).toBe(200);
    await expect(reviewReplay.json()).resolves.toMatchObject({
      idempotent: true,
      createdEntities: reviewed.createdEntities,
    });
    const entityCount = await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM scene_entities
      WHERE project_id = ? AND version_id = ? AND status = 'active'
    `).bind(project.id, versionId).first<{ count: number }>();
    expect(entityCount?.count).toBe(2);
    const autoSeededProfile = await env.DB.prepare(`
      SELECT world_unit FROM scene_navigation_profiles
      WHERE project_id = ? AND version_id = ?
    `).bind(project.id, versionId).first<{ world_unit: string }>();
    expect(autoSeededProfile?.world_unit).toBe("scene_units");
    const unitProfile = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial/navigation-profile`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          versionId,
          worldUnit: "scene_units",
          agentRadius: 0.2,
          agentHeight: 1.2,
          eyeHeight: 1,
          maxStepMetres: 0.05,
        }),
      },
    );
    expect(unitProfile.status).toBe(200);

    const finalSpatial = await exports.default.fetch(
      `${origin}/api/projects/${project.id}/spatial?versionId=${versionId}`,
      { headers: { cookie } },
    );
    const final = await finalSpatial.json<{
      entities: Array<{
        kind: string;
        label: string;
        geometry_json: string | null;
        metadata_json: string;
        world_unit: string;
      }>;
      navigationMesh: { version: string; vertices: number[][]; indices: number[] };
    }>();
    expect(final.entities.map((entity) => entity.kind).sort()).toEqual(["floor", "room"]);
    expect(final.entities.every((entity) => entity.world_unit === "scene_units")).toBe(true);
    expect(final.entities.find((entity) => entity.kind === "floor")?.label).toContain("SU");
    expect(final.entities.find((entity) => entity.kind === "room")?.metadata_json)
      .not.toContain("areaM2");
    expect(final.navigationMesh).toMatchObject({
      version: "authored-polygon-triangles-v2",
      vertices: [[0, 0.02, 0], [4, 0.02, 0], [4, 0.02, 3], [0, 0.02, 3]],
    });
    expect(final.navigationMesh.indices).toHaveLength(6);
    const triangleArea = (first: number, second: number, third: number) => {
      const a = final.navigationMesh.vertices[first]!;
      const b = final.navigationMesh.vertices[second]!;
      const c = final.navigationMesh.vertices[third]!;
      return Math.abs(
        (b[0]! - a[0]!) * (c[2]! - a[2]!) -
        (b[2]! - a[2]!) * (c[0]! - a[0]!),
      ) / 2;
    };
    expect(
      triangleArea(...final.navigationMesh.indices.slice(0, 3) as [number, number, number]) +
      triangleArea(...final.navigationMesh.indices.slice(3, 6) as [number, number, number]),
    ).toBe(12);
  });
});
