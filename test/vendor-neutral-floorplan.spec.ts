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

  it("ignores a narrow skirt hanging below the slab when choosing the floor", () => {
    // Photogrammetric meshes and SLAM clouds both trail a skirt of stray surface
    // under the real floor. Anchoring the storey there scores *higher* on wall
    // support than the slab does, because everything standing on the floor then
    // falls inside the sub-floor anchor's wall-evidence window while the slab's
    // own window starts above it. The Meta EyefulTower apartment mesh reproduced
    // this exactly: a 61-cell skirt beat the 802-cell slab 0.3 m above it, and
    // the extractor returned one 2 m2 room for a whole apartment.
    const points: Array<[number, number, number]> = [];
    const add = (point: [number, number, number]) => points.push(point);

    for (let x = 0.125; x < 8; x += 0.25) {
      for (let z = 0.125; z < 4; z += 0.25) add([x, 0, z]);
    }
    // Walls stop below 2.5 m so the lower anchor forfeits no wall evidence.
    for (let y = 0.25; y <= 2.2; y += 0.25) {
      for (let x = 0; x <= 8; x += 0.25) {
        add([x, y, 0]);
        add([x, y, 4]);
      }
      for (let z = 0; z <= 4; z += 0.25) {
        add([0, y, z]);
        add([8, y, z]);
      }
      for (let z = 0; z <= 4; z += 0.25) {
        if (z >= 1.5 && z <= 2.5) continue;
        add([4, y, z]);
      }
    }
    // Low clutter resting on the slab, visible only to a sub-floor anchor.
    for (let x = 0.125; x < 8; x += 0.25) {
      for (let z = 0.125; z < 4; z += 0.25) {
        for (const y of [0.06, 0.12, 0.18, 0.24]) add([x, y, z]);
      }
    }
    // The skirt itself: compact, well above the minimum room size, but covering
    // far less ground than the slab it hangs beneath.
    for (let x = 0.125; x < 3; x += 0.25) {
      for (let z = 0.125; z < 3; z += 0.25) add([x, -0.3, z]);
    }

    const signature = parsePlySceneSignature(asciiPly(points), {
      voxelSizeM: 0.125,
      maximumSamplePoints: 1_000_000,
    });
    const report = extractMetricFloorPlan(signature, {
      gridSizeM: 0.25,
      floorBandM: 0.15,
      minimumWallHeightCoverage: 0.6,
      minimumRoomAreaM2: 4,
    });

    expect(report.summary.inferredFloorElevationM).toBe(0);
    expect(report.rooms).toHaveLength(2);
    expect(report.rooms.reduce((area, room) => area + room.areaM2, 0)).toBeGreaterThan(25);
  });

  it("anchors a tall hall on the ground rather than on a raised deck", () => {
    // The Meta EyefulTower workshop is a single 13 m hall whose roof structure
    // gives raised decks more wall evidence above them than the ground has: at
    // 2.85 m it scored 13,801 against the floor's 9,677. Ranking by wall evidence
    // therefore put the storey partway up the racking and reported 4 m2 of a
    // 75 m2 floor. Ground wins on footprint, which is what should decide.
    const points: Array<[number, number, number]> = [];
    const add = (point: [number, number, number]) => points.push(point);

    for (let x = 0.125; x < 12; x += 0.25) {
      for (let z = 0.125; z < 8; z += 0.25) add([x, 0, z]);
    }
    // Stacked racking decks, close enough together that every height between the
    // floor and the roof stays occupied and the hall remains a single cluster.
    for (const y of [0.7, 1.4, 2.1, 2.8]) {
      for (let x = 0.125; x < 8; x += 0.25) {
        for (let z = 0.125; z < 4; z += 0.25) add([x, y, z]);
      }
    }
    // Hall walls run the full 6 m height, so every anchor sees wall evidence.
    for (let y = 0.25; y <= 6; y += 0.25) {
      for (let x = 0; x <= 12; x += 0.25) {
        add([x, y, 0]);
        add([x, y, 8]);
      }
      for (let z = 0; z <= 8; z += 0.25) {
        add([0, y, z]);
        add([12, y, z]);
      }
    }
    // Dense roof structure, sitting inside the top deck's evidence window and
    // outside the ground's — the thing that flattered the raised decks.
    for (const y of [3.3, 3.45, 3.6, 3.75, 3.9, 4.05]) {
      for (let x = 0.125; x < 10; x += 0.25) {
        for (let z = 0.125; z < 8; z += 0.25) add([x, y, z]);
      }
    }

    const signature = parsePlySceneSignature(asciiPly(points), {
      voxelSizeM: 0.125,
      maximumSamplePoints: 4_000_000,
    });
    const report = extractMetricFloorPlan(signature, {
      gridSizeM: 0.25,
      floorBandM: 0.15,
      minimumWallHeightCoverage: 0.6,
      minimumRoomAreaM2: 4,
    });

    expect(report.summary.inferredFloorElevationM).toBe(0);
    expect(report.rooms.reduce((area, room) => area + room.areaM2, 0)).toBeGreaterThan(60);
  });

  it("leaves the wall line open where it recorded an opening", () => {
    // Bounded gaps are closed so the flood fill can tell one room from the next,
    // but those cells are inferred rather than observed. Emitting them as wall
    // geometry drew a solid wall straight across every opening found in the same
    // pass, so a reviewer approved a doorway that was sealed in collision.
    const signature = parsePlySceneSignature(rectangularTwoRoomFixture(), {
      voxelSizeM: 0.125,
      maximumSamplePoints: 1_000_000,
    });
    const report = extractMetricFloorPlan(signature, {
      gridSizeM: 0.25,
      floorBandM: 0.15,
      minimumWallHeightCoverage: 0.6,
      minimumRoomAreaM2: 4,
      maximumOpeningWidthM: 1.25,
    });

    const opening = report.openings.find((candidate) => candidate.widthM >= 0.75);
    expect(opening, "fixture should record the 1 m doorway").toBeDefined();

    // Nothing may bridge the doorway mouth along the shared wall at x = 4.
    const mouth = { from: 1.6, to: 2.4 };
    const spanning = report.walls.filter((wall) => {
      const [start, end] = wall.geometry.points;
      if (Math.abs(start[0] - 4) > 0.13 || Math.abs(end[0] - 4) > 0.13) return false;
      const low = Math.min(start[2], end[2]);
      const high = Math.max(start[2], end[2]);
      return low < mouth.to && high > mouth.from;
    });
    expect(spanning.map((wall) => wall.wallKey)).toEqual([]);
  });

  it("finds every storey of a building with no empty band between them", () => {
    // An occupied building is contiguous in elevation: floor, contents, ceiling,
    // then the next floor, with no gap anywhere. Grouping layers into clusters
    // separated by empty space therefore collapsed the whole building into one
    // group and reported a single storey. The LaMAR CAB capture showed it at
    // scale — 240 credible layers over four real storeys, of which one was found.
    const points: Array<[number, number, number]> = [];
    const add = (point: [number, number, number]) => points.push(point);

    for (const base of [0, 3, 6]) {
      for (let x = 0.125; x < 8; x += 0.25) {
        for (let z = 0.125; z < 6; z += 0.25) {
          add([x, base, z]);
          // The ceiling is pierced by the stairwell, so the floor above always
          // covers more ground than the slab underside below it.
          if (x < 2.5 || x > 4.5) add([x, base + 2.7, z]);
        }
      }
      // Contents at head height keep every intermediate layer occupied.
      for (const lift of [0.6, 1.2, 1.8, 2.4]) {
        for (let x = 0.125; x < 4; x += 0.25) {
          for (let z = 0.125; z < 3; z += 0.25) add([x, base + lift, z]);
        }
      }
      for (let y = base + 0.15; y <= base + 2.7; y += 0.15) {
        for (let x = 0; x <= 8; x += 0.25) {
          add([x, y, 0]);
          add([x, y, 6]);
        }
        for (let z = 0; z <= 6; z += 0.25) {
          add([0, y, z]);
          add([8, y, z]);
        }
      }
    }

    const signature = parsePlySceneSignature(asciiPly(points), {
      voxelSizeM: 0.125,
      maximumSamplePoints: 4_000_000,
    });
    const report = extractMetricFloorPlan(signature, {
      gridSizeM: 0.25,
      floorBandM: 0.15,
      minimumWallHeightCoverage: 0.6,
      minimumRoomAreaM2: 4,
    });

    expect(report.levels.map((level) => level.elevationM)).toEqual([0, 3, 6]);
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
