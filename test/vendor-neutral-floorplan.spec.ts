import { describe, expect, it } from "vitest";
import {
  extractMetricFloorPlan,
  parsePlySceneSignature,
} from "../scripts/processing-agent-core.mjs";
import { floorplanProposalReportSchema } from "../src/worker/contracts";

function asciiPly(points: Array<[number, number, number]>): Uint8Array {
  return new TextEncoder().encode([
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

function rectangularTwoRoomFixture(): Uint8Array {
  const points: Array<[number, number, number]> = [];
  const add = (point: [number, number, number]) => points.push(point);

  // Dense floor support for an 8 m x 4 m footprint.
  for (let x = 0.125; x < 8; x += 0.25) {
    for (let z = 0.125; z < 4; z += 0.25) add([x, 0, z]);
  }

  // Exterior walls.
  for (let y = 0.25; y <= 2.5; y += 0.25) {
    for (let x = 0; x <= 8; x += 0.25) {
      add([x, y, 0]);
      add([x, y, 4]);
    }
    for (let z = 0; z <= 4; z += 0.25) {
      add([0, y, z]);
      add([8, y, z]);
    }

    // Shared wall at x=4 with a one-metre opening between z=1.5 and 2.5.
    for (let z = 0; z <= 4; z += 0.25) {
      if (z >= 1.5 && z <= 2.5) continue;
      add([4, y, z]);
    }
  }
  return asciiPly(points);
}

function twoLevelStairFixture(): Uint8Array {
  const points: Array<[number, number, number]> = [];
  const add = (point: [number, number, number]) => points.push(point);
  const addLevel = (elevation: number) => {
    for (let x = 0.125; x < 6; x += 0.25) {
      for (let z = 0.125; z < 5; z += 0.25) {
        add([x, elevation, z]);
        // Preserve a captured stairwell opening instead of drawing a ceiling
        // plane through the connector volume.
        if (x < 2 || x > 4) add([x, elevation + 2.5, z]);
      }
    }
    for (let y = elevation + 0.25; y <= elevation + 2.5; y += 0.25) {
      for (let x = 0; x <= 6; x += 0.25) {
        add([x, y, 0]);
        add([x, y, 5]);
      }
      for (let z = 0; z <= 5; z += 0.25) {
        add([0, y, z]);
        add([6, y, z]);
      }
    }
  };
  addLevel(0);
  addLevel(3);

  // A 1 m wide, 6 m long staircase represented by dense tread support. The
  // extractor must infer one continuous reviewed ramp proxy rather than an
  // off-mesh teleport between otherwise disconnected levels.
  const steps = 12;
  for (let step = 0; step <= steps; step += 1) {
    const elevation = step / steps * 3;
    const startZ = -1 + step * 0.5;
    for (let x = 2.5; x <= 3.5; x += 0.125) {
      for (let z = startZ; z < startZ + 0.5; z += 0.125) add([x, elevation, z]);
    }
  }
  return asciiPly(points);
}

describe("vendor-neutral metric floor-plan extraction", () => {
  it("turns a registered metric PLY into reviewable rooms, walls, and an opening", () => {
    const signature = parsePlySceneSignature(rectangularTwoRoomFixture(), {
      voxelSizeM: 0.125,
      maximumSamplePoints: 1_000_000,
    });
    const report = extractMetricFloorPlan(signature, {
      gridSizeM: 0.25,
      floorBandM: 0.15,
      wallMinHeightM: 0.25,
      wallMaxHeightM: 2.5,
      minimumWallHeightCoverage: 0.6,
      minimumRoomAreaM2: 4,
      maximumOpeningWidthM: 1.25,
      maximumRooms: 20,
      maximumSamplePoints: 1_000_000,
    });

    expect(report).toMatchObject({
      schemaVersion: "1.0.0",
      method: "metric-pointcloud-floorplan-v2",
      result: "proposal_ready",
      humanReviewRequired: true,
      source: {
        coordinateAssurance: "registered_y_up_metric_frame",
      },
      summary: {
        inferredFloorElevationM: 0,
        roomCount: 2,
      },
    });
    expect(report.rooms).toHaveLength(2);
    expect(report.rooms.map((room) => room.areaM2)).toEqual(
      expect.arrayContaining([expect.any(Number), expect.any(Number)]),
    );
    expect(report.rooms.reduce((area, room) => area + room.areaM2, 0)).toBeGreaterThan(25);
    expect(report.walls.length).toBeGreaterThanOrEqual(5);
    expect(report.openings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "opening_candidate",
        widthM: expect.closeTo(1, 0),
        confidence: expect.any(Number),
      }),
    ]));
    expect(report.limitations.join(" ")).toContain("operator");
    expect(report.measurementClass).toBe("indicative");
  });

  it("rejects a source without enough vertically persistent wall evidence", () => {
    const floorOnly: Array<[number, number, number]> = [];
    for (let x = 0.125; x < 4; x += 0.25) {
      for (let z = 0.125; z < 3; z += 0.25) floorOnly.push([x, 0, z]);
    }
    const signature = parsePlySceneSignature(asciiPly(floorOnly), {
      voxelSizeM: 0.125,
      maximumSamplePoints: 100_000,
    });

    expect(() => extractMetricFloorPlan(signature, {
      gridSizeM: 0.25,
      floorBandM: 0.15,
      minimumRoomAreaM2: 2,
    })).toThrowError(/wall/i);
  });

  it("extracts distinct levels and a continuous stair connector", () => {
    const signature = parsePlySceneSignature(twoLevelStairFixture(), {
      voxelSizeM: 0.1,
      maximumSamplePoints: 1_000_000,
    });
    const report = extractMetricFloorPlan(signature, {
      gridSizeM: 0.25,
      floorBandM: 0.15,
      wallMinHeightM: 0.25,
      wallMaxHeightM: 2.5,
      minimumWallHeightCoverage: 0.6,
      minimumRoomAreaM2: 4,
      maximumOpeningWidthM: 1.25,
      maximumRooms: 20,
      maximumSamplePoints: 1_000_000,
    });

    expect(report).toMatchObject({
      method: "metric-pointcloud-floorplan-v2",
      summary: {
        levelCount: 2,
        connectorCount: 1,
      },
    });
    expect(report.levels.map((level) => level.elevationM)).toEqual([0, 3]);
    expect(report.levels.map((level) => level.ceilingElevationM)).toEqual([2.55, 5.55]);
    expect(report.connectors).toEqual([expect.objectContaining({
      kind: "stair_or_ramp_candidate",
      lowerLevelKey: "level-001",
      upperLevelKey: "level-002",
      riseM: expect.closeTo(3, 1),
      slopeDegrees: expect.any(Number),
      geometry: { type: "polygon", points: expect.any(Array) },
    })]);
    expect(report.connectors[0].geometry.points).toHaveLength(4);
    const parsed = floorplanProposalReportSchema.safeParse(report);
    expect(parsed.success, parsed.success ? "" : parsed.error.message).toBe(true);
  });
});
