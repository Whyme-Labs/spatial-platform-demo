import { describe, expect, it } from "vitest";
import {
  extractWalkableSemanticCandidates,
  parsePlySceneSignature,
  ProcessingAgentError,
} from "../scripts/processing-agent-core.mjs";

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
      inferredFloorElevationM: 0,
      candidateCount: 1,
      totalCandidateAreaM2: 12,
    });
    expect(report.candidates).toEqual([
      expect.objectContaining({
        candidateKey: "walkable-001",
        kind: "walkable_region",
        label: "Candidate room 1",
        elevationM: 0,
        areaM2: 12,
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
    expect(report.candidates[0].areaM2).toBe(7);
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
      inferredFloorElevationM: 0,
      candidateCount: 1,
      totalCandidateAreaM2: 12,
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
