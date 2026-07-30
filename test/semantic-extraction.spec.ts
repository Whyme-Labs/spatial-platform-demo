import { describe, expect, it } from "vitest";
import {
  extractWalkableSemanticCandidates,
  parsePlySceneSignature,
  ProcessingAgentError,
} from "../scripts/processing-agent-core.mjs";
import {
  navigationProfileSchema,
  releaseInputSchema,
  semanticExtractionSchema,
} from "../src/worker/contracts";

function asciiPly(points: Array<[number, number, number]>): Buffer {
  return Buffer.from([
    "ply",
    "format ascii 1.0",
    `element vertex ${points.length}`,
    "property float x",
    "property float y",
    "property float z",
    "end_header",
    ...points.map((point) => point.join(" ")),
    "",
  ].join("\n"));
}

function rectangularSurface(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  y: number,
  step = 0.25,
): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = [];
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) {
      points.push([x, y, z]);
    }
  }
  return points;
}

describe("registered point-cloud semantic candidates", () => {
  it("extracts a deterministic walkable polygon from the lower horizontal support surface", () => {
    const floor = rectangularSurface(0, 4, 0, 3, 0);
    const ceiling = rectangularSurface(0, 4, 0, 3, 3);
    const signature = parsePlySceneSignature(asciiPly([...floor, ...ceiling]), {
      voxelSizeM: 0.1,
      maximumSamplePoints: 100_000,
    });

    const report = extractWalkableSemanticCandidates(signature, {
      gridSizeM: 0.5,
      floorBandM: 0.15,
      minimumAreaM2: 2,
      maximumCandidates: 8,
    });

    expect(report.method).toBe("registered-ply-walkable-candidates-v1");
    expect(report.result).toBe("candidates_ready");
    expect(report.source).toMatchObject({
      vertexCount: floor.length + ceiling.length,
      sampledPointCount: floor.length + ceiling.length,
      coordinateAssurance: "registered_y_up_metric_frame",
    });
    expect(report.summary).toMatchObject({
      inferredFloorElevation: 0,
      candidateCount: 1,
      totalCandidateArea: 12,
    });
    expect(report.candidates).toEqual([
      expect.objectContaining({
        candidateKey: "walkable-001",
        kind: "walkable_region",
        label: "Candidate room 1",
        elevation: 0,
        area: 12,
        geometry: {
          type: "polygon",
          points: [
            [0, 0, 0],
            [4, 0, 0],
            [4, 0, 3],
            [0, 0, 3],
          ],
        },
      }),
    ]);
    expect(report.humanReviewRequired).toBe(true);
    expect(report.limitations).toContain(
      "Candidates are occupancy-derived walkable proxies, not walls, legal rooms, accessibility certification, or survey evidence.",
    );
  });

  it("preserves an L-shaped footprint instead of inflating it to a bounding box", () => {
    const lower = rectangularSurface(0, 4, 0, 1, 0);
    const left = rectangularSurface(0, 1, 1, 4, 0);
    const signature = parsePlySceneSignature(asciiPly([...lower, ...left]), {
      voxelSizeM: 0.1,
      maximumSamplePoints: 100_000,
    });

    const report = extractWalkableSemanticCandidates(signature, {
      gridSizeM: 0.5,
      floorBandM: 0.15,
      minimumAreaM2: 2,
      maximumCandidates: 8,
    });

    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0].area).toBe(7);
    expect(report.candidates[0].geometry.points).toHaveLength(6);
    expect(report.candidates[0].geometry.points).toEqual([
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, 1],
      [1, 0, 1],
      [1, 0, 4],
      [0, 0, 4],
    ]);
  });

  it("normalizes a scaled Z-up source before extracting metric walkable geometry", () => {
    const canonicalFloor = rectangularSurface(0, 4, 0, 3, 0);
    const zUpSource = canonicalFloor.map(([x, y, z]) =>
      [x / 2, -z / 2, y / 2] as [number, number, number]
    );
    const signature = parsePlySceneSignature(asciiPly(zUpSource), {
      voxelSizeM: 0.05,
      maximumSamplePoints: 100_000,
    });
    const sourceToWorld = {
      sourceUpAxis: "Z",
      metresPerSourceUnit: 2,
      yawDegrees: 0,
      translationMetres: [0, 0, 0],
    } as const;

    const report = extractWalkableSemanticCandidates(signature, {
      gridSizeM: 0.5,
      floorBandM: 0.15,
      minimumAreaM2: 2,
      maximumCandidates: 8,
      sourceToWorld,
    });

    expect(report.method).toBe("registered-ply-walkable-candidates-v2");
    expect(report.source).toMatchObject({
      coordinateAssurance: "authored_source_to_world_v1",
      sourceToWorld,
    });
    expect(report.summary).toMatchObject({
      inferredFloorElevation: 0,
      candidateCount: 1,
      totalCandidateArea: 12,
    });
    expect(report.candidates[0].geometry.points).toEqual([
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, 3],
      [0, 0, 3],
    ]);
  });

  it("fails closed when the registered PLY has no credible horizontal support", () => {
    const signature = parsePlySceneSignature(asciiPly([
      [0, 0, 0],
      [0, 0.5, 0],
      [0, 1, 0],
      [0, 1.5, 0],
      [0, 2, 0],
    ]), {
      voxelSizeM: 0.1,
      maximumSamplePoints: 1_000,
    });

    expect(() => extractWalkableSemanticCandidates(signature, {
      gridSizeM: 0.5,
      floorBandM: 0.15,
      minimumAreaM2: 2,
      maximumCandidates: 8,
    })).toThrowError(expect.objectContaining<Partial<ProcessingAgentError>>({
      code: "INSUFFICIENT_WALKABLE_SUPPORT",
      retryable: false,
      failureClass: "input_validation",
    }));
  });
});

describe("v5 coordinate contracts", () => {
  it("fails closed when authored coordinate assurance omits its transform", () => {
    const result = semanticExtractionSchema.safeParse({
      clientOperationId: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      inputAssetId: crypto.randomUUID(),
      coordinateAssurance: "authored_source_to_world_v1",
      registrationEvidence: "A measured control distance established the metric scale.",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.sourceToWorld).toContain(
        "An authored source-to-world transform is required for this coordinate assurance",
      );
    }
  });

  it("accepts one transform contract for extraction and the immutable viewer release", () => {
    const sourceToWorld = {
      sourceUpAxis: "Z",
      metresPerSourceUnit: 0.42,
      yawDegrees: 12,
      translationMetres: [1, 0, -2],
    } as const;
    expect(semanticExtractionSchema.safeParse({
      clientOperationId: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      inputAssetId: crypto.randomUUID(),
      coordinateAssurance: "authored_source_to_world_v1",
      sourceToWorld,
      registrationEvidence: "A measured control distance established the metric scale.",
    }).success).toBe(true);
    expect(releaseInputSchema.safeParse({
      slug: "v5-room",
      accessPolicy: "unlisted",
      viewerConfig: {
        title: "V5 room",
        measurementDisclaimer: "Indicative visual navigation only.",
        sourceToWorld,
      },
    }).success).toBe(false);
    expect(releaseInputSchema.safeParse({
      slug: "v5-room",
      accessPolicy: "unlisted",
      sourceToWorldEvidenceId: crypto.randomUUID(),
      viewerConfig: {
        title: "V5 room",
        measurementDisclaimer: "Indicative visual navigation only.",
        sourceToWorld,
      },
    }).success).toBe(true);
  });

  it("preserves provisional scene units without representing them as metres", () => {
    const sourceToWorld = {
      sourceUpAxis: "Z",
      worldUnit: "scene_units",
      metresPerSourceUnit: 1,
      yawDegrees: 0,
      translationMetres: [0, 0, 0],
    } as const;
    const extraction = semanticExtractionSchema.safeParse({
      clientOperationId: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      inputAssetId: crypto.randomUUID(),
      coordinateAssurance: "authored_source_to_world_v1",
      sourceToWorld,
      registrationEvidence:
        "Temporary scene units preserve reconstruction alignment; no metric scale is claimed.",
    });
    expect(extraction.success).toBe(true);
    if (extraction.success) {
      expect(extraction.data.sourceToWorld?.worldUnit).toBe("scene_units");
    }

    const release = releaseInputSchema.safeParse({
      slug: "provisional-v5-room",
      accessPolicy: "unlisted",
      sourceToWorldEvidenceId: crypto.randomUUID(),
      viewerConfig: {
        title: "Provisional V5 room",
        measurementDisclaimer:
          "Provisional scene units (SU) only. Distances, areas, navigation radii, and heights are relative values, not real-world measurements, and must not be relied upon for construction, survey, boundary, clearance, or accessibility decisions.",
        sourceToWorld,
      },
    });
    expect(release.success).toBe(true);
    if (release.success) {
      expect(release.data.viewerConfig.sourceToWorld?.worldUnit).toBe("scene_units");
    }

    const navigationProfile = navigationProfileSchema.safeParse({
      versionId: crypto.randomUUID(),
      worldUnit: "scene_units",
      agentRadius: 0.12,
      agentHeight: 0.8,
      eyeHeight: 0.65,
      maxStepMetres: 0.05,
    });
    expect(navigationProfile.success).toBe(true);
    if (navigationProfile.success) {
      expect(navigationProfile.data.worldUnit).toBe("scene_units");
    }
  });

  it("rejects an operator-authored metric claim on a provisional release", () => {
    const result = releaseInputSchema.safeParse({
      slug: "unsafe-provisional-v5-room",
      accessPolicy: "unlisted",
      sourceToWorldEvidenceId: crypto.randomUUID(),
      viewerConfig: {
        title: "Unsafe provisional room",
        measurementDisclaimer:
          "Surveyed metric room suitable for construction and accessibility decisions.",
        sourceToWorld: {
          sourceUpAxis: "Z",
          worldUnit: "scene_units",
          metresPerSourceUnit: 1,
          yawDegrees: 0,
          translationMetres: [0, 0, 0],
        },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.viewerConfig).toBeDefined();
    }
  });

  it("emits unit-neutral provisional semantic measurements", () => {
    const floor = rectangularSurface(0, 4, 0, 3, 0);
    const signature = parsePlySceneSignature(asciiPly(floor), {
      voxelSizeM: 0.1,
      maximumSamplePoints: 100_000,
    });
    const report = extractWalkableSemanticCandidates(signature, {
      gridSizeM: 0.5,
      floorBandM: 0.15,
      minimumAreaM2: 2,
      maximumCandidates: 8,
      sourceToWorld: {
        sourceUpAxis: "Y",
        worldUnit: "scene_units",
        metresPerSourceUnit: 1,
        yawDegrees: 0,
        translationMetres: [0, 0, 0],
      },
    });

    expect(report.worldUnit).toBe("scene_units");
    expect(report.summary).toMatchObject({
      inferredFloorElevation: 0,
      totalCandidateArea: 12,
    });
    expect(report.candidates[0]).toMatchObject({ elevation: 0, area: 12 });
    expect(report.candidates[0]).not.toHaveProperty("elevationM");
    expect(report.candidates[0]).not.toHaveProperty("areaM2");
    expect(JSON.stringify(report)).not.toMatch(/square metres|\\bmetres\\b/);
  });

  it("defaults legacy transforms and navigation profiles to metres", () => {
    const extraction = semanticExtractionSchema.safeParse({
      clientOperationId: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      inputAssetId: crypto.randomUUID(),
      coordinateAssurance: "authored_source_to_world_v1",
      sourceToWorld: {
        sourceUpAxis: "Y",
        metresPerSourceUnit: 1,
        yawDegrees: 0,
        translationMetres: [0, 0, 0],
      },
      registrationEvidence: "Legacy metric transform with reviewed scale evidence.",
    });
    expect(extraction.success).toBe(true);
    if (extraction.success) {
      expect(extraction.data.sourceToWorld?.worldUnit).toBe("metres");
    }
  });
});
