import { describe, expect, it } from "vitest";
import {
  extractMetricFloorPlan,
  parsePlySceneSignature,
  proposalCaptureAgreement,
} from "../scripts/processing-agent-core.mjs";
// @ts-expect-error Plain ESM module has no separate declaration file.
import { horizontalSurfaceIssue } from "../scripts/horizontal-surface.mjs";
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

  it("detects a ceiling that beams and coffers fragment into isolated patches", () => {
    // A coffered or beam-crossed ceiling never forms one dense component in a
    // single 0.15 m band, so requiring that returned null on genuinely roofed
    // storeys and blocked automatic collision on all of them. Ceiling evidence
    // is per column: each floor cell's first capture above standing height.
    const points: Array<[number, number, number]> = [];
    for (let x = 0.125; x < 8; x += 0.25) {
      for (let z = 0.125; z < 4; z += 0.25) points.push([x, 0, z]);
    }
    for (let y = 0.25; y <= 2.7; y += 0.25) {
      for (let x = 0; x <= 8; x += 0.25) {
        points.push([x, y, 0]);
        points.push([x, y, 4]);
      }
      for (let z = 0; z <= 4; z += 0.25) {
        points.push([0, y, z]);
        points.push([8, y, z]);
      }
    }
    // Chequered coffers: every other cell captured, none touching its
    // neighbours, covering half the floor in plan.
    for (let i = 0; i < 32; i += 1) {
      for (let j = 0; j < 16; j += 1) {
        if ((i + j) % 2 === 0) points.push([0.125 + i * 0.25, 2.7, 0.125 + j * 0.25]);
      }
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

    expect(report.levels).toHaveLength(1);
    expect(report.levels[0].ceilingElevationM).toBe(2.7);
  });

  it("does not mint a storey out of a loaded racking deck", () => {
    // A wide storage deck holds goods within standing height above most of its
    // area; a storey floor is clear over most of its area, furniture included.
    // Footprint cannot make this distinction — the LaMAR CAB top storey covers
    // 56% of the widest floor and a workshop's shelf plane 54% — but measured
    // head-room separates them cleanly: real floors run 40-54% blocked, the
    // loaded deck 88%.
    const points: Array<[number, number, number]> = [];
    for (let x = 0.125; x < 10; x += 0.25) {
      for (let z = 0.125; z < 6; z += 0.25) points.push([x, 0, z]);
    }
    for (let y = 0.25; y <= 5.5; y += 0.25) {
      for (let x = 0; x <= 10; x += 0.25) {
        points.push([x, y, 0]);
        points.push([x, y, 6]);
      }
      for (let z = 0; z <= 6; z += 0.25) {
        points.push([0, y, z]);
        points.push([10, y, z]);
      }
    }
    // The deck: two-thirds of the hall footprint, well above the storey
    // separation, with goods stacked over four-fifths of it.
    for (let i = 0; i < 32; i += 1) {
      for (let j = 0; j < 20; j += 1) {
        const x = 0.125 + i * 0.25;
        const z = 0.125 + j * 0.25;
        points.push([x, 3, z]);
        if (i % 5 !== 4) {
          points.push([x, 3.4, z]);
          points.push([x, 3.7, z]);
          points.push([x, 4.0, z]);
        }
      }
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

    expect(report.levels.map((level) => level.elevationM)).toEqual([0]);
  });

  it("traces a simple ring where an interior void meets a notch at one corner", () => {
    // When a void inside the room and a notch in its outer edge share a single
    // cell corner, two boundary passes meet at that vertex and an arbitrary
    // stitch produces a figure-eight — a self-touching ring every collision
    // builder rejects, which killed the whole automatic build on the first
    // real building. Exercise the pinch in all four orientations.
    for (const rotation of [0, 1, 2, 3]) {
      const rotate = (i: number, j: number): [number, number] => {
        if (rotation === 0) return [i, j];
        if (rotation === 1) return [9 - j, i];
        if (rotation === 2) return [9 - i, 9 - j];
        return [j, 9 - i];
      };
      const removed = new Set<string>();
      for (const [i, j] of [[0, 4], [1, 4], [2, 4], [3, 4]] as const) {
        removed.add(rotate(i, j).join(","));
      }
      for (let i = 4; i <= 6; i += 1) {
        for (let j = 5; j <= 7; j += 1) removed.add(rotate(i, j).join(","));
      }
      const points: Array<[number, number, number]> = [];
      for (let i = 0; i < 10; i += 1) {
        for (let j = 0; j < 10; j += 1) {
          if (removed.has(`${i},${j}`)) continue;
          points.push([i * 0.25 + 0.125, 0, j * 0.25 + 0.125]);
        }
      }
      for (let y = 0.25; y <= 2.5; y += 0.25) {
        for (let t = 0; t <= 2.5; t += 0.25) {
          points.push([t, y, 0]);
          points.push([t, y, 2.5]);
          points.push([0, y, t]);
          points.push([2.5, y, t]);
        }
      }

      const signature = parsePlySceneSignature(asciiPly(points), {
        voxelSizeM: 0.125,
        maximumSamplePoints: 1_000_000,
      });
      const report = extractMetricFloorPlan(signature, {
        gridSizeM: 0.25,
        floorBandM: 0.15,
        minimumWallHeightCoverage: 0.6,
        minimumRoomAreaM2: 2,
      });
      for (const room of report.rooms) {
        const issue = horizontalSurfaceIssue({
          id: `${room.roomKey}-rotation-${rotation}`,
          points: room.geometry.points,
          holes: [],
        });
        expect(issue, `rotation ${rotation} ${room.roomKey}`).toBeNull();
      }
    }
  });

  it("finds a switchback staircase as two flights through its half-landing", () => {
    // A storey-to-storey staircase is normally a switchback: a flight up, a
    // half-landing, a flight back the opposite way. Projected on any single
    // axis that is a zigzag, so the straight-ramp fit alone can never accept
    // it — which left whole storeys of a real four-storey capture with no
    // connector at all. Each flight on its own is straight and must be found.
    const points: Array<[number, number, number]> = [];
    const add = (point: [number, number, number]) => points.push(point);
    const addStorey = (base: number) => {
      for (let x = 0.125; x < 6; x += 0.25) {
        for (let z = 0.125; z < 5; z += 0.25) {
          add([x, base, z]);
          if (x < 2 || x > 4.6) add([x, base + 2.7, z]);
        }
      }
      for (let y = base + 0.25; y <= base + 2.7; y += 0.25) {
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
    addStorey(0);
    addStorey(3);
    // Flight one climbs +z from the ground to the half-landing...
    for (let step = 0; step <= 10; step += 1) {
      const elevation = step / 10 * 1.5;
      const startZ = 0.5 + step * 0.28;
      for (let x = 2.2; x <= 3.2; x += 0.125) {
        for (let z = startZ; z < startZ + 0.28; z += 0.125) add([x, elevation, z]);
      }
    }
    // ...the landing turns...
    for (let x = 2.2; x <= 4.4; x += 0.125) {
      for (let z = 3.3; z <= 4.4; z += 0.125) add([x, 1.5, z]);
    }
    // ...and flight two climbs back -z to the upper storey.
    for (let step = 0; step <= 10; step += 1) {
      const elevation = 1.5 + step / 10 * 1.5;
      const startZ = 3.3 - step * 0.28;
      for (let x = 3.4; x <= 4.4; x += 0.125) {
        for (let z = startZ; z < startZ + 0.28; z += 0.125) add([x, elevation, z]);
      }
    }

    const signature = parsePlySceneSignature(asciiPly(points), {
      voxelSizeM: 0.1,
      maximumSamplePoints: 2_000_000,
    });
    const report = extractMetricFloorPlan(signature, {
      gridSizeM: 0.25,
      floorBandM: 0.15,
      minimumWallHeightCoverage: 0.6,
      minimumRoomAreaM2: 4,
    });

    expect(report.levels.map((level) => level.elevationM)).toEqual([0, 3]);
    expect(report.connectors.length).toBe(2);
    for (const connector of report.connectors) {
      expect(connector.kind).toBe("stair_or_ramp_candidate");
      expect(connector.geometry.points).toHaveLength(4);
      expect(connector.slopeDegrees).toBeGreaterThan(10);
      expect(connector.slopeDegrees).toBeLessThan(42);
    }
    const elevations = report.connectors.flatMap((connector) =>
      connector.geometry.points.map((point: number[]) => point[1]));
    expect(Math.min(...elevations)).toBe(0);
    expect(Math.max(...elevations)).toBe(3);
    expect(elevations.filter((value) => value === 1.5).length).toBeGreaterThan(0);
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

describe("shell-capture agreement in the automatic proposal", () => {
  it("attaches an agreement report and raises no crossing on a well-captured shell", () => {
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
    expect(report.captureAgreement).toMatchObject({
      schemaVersion: "shell-capture-agreement-v1",
      pointSource: "voxel-centroids",
    });
    expect(report.captureAgreement.inspectedBarrierCount).toBeGreaterThan(0);
    // The extractor builds its walls from observed cells, so its own capture
    // must never dispute them where the capture is dense.
    expect(report.captureAgreement.findings.filter(
      (finding: { kind: string }) => finding.kind === "barrier_crosses_open_capture",
    )).toHaveLength(0);
  });

  it("reports a wall that crosses a doorway the capture plainly shows open", () => {
    // A wall band along z=0 from x=0..4 with a 1.2 m hole in the middle —
    // exactly the shape that traps a walker in a rendered doorway.
    const points: Array<[number, number, number]> = [];
    for (let x = 0; x <= 4; x += 0.1) {
      if (x > 1.4 && x < 2.6) continue;
      for (const y of [1.1, 1.4, 1.7]) points.push([x, y, 0]);
    }
    const signature = parsePlySceneSignature(asciiPly(points), {
      voxelSizeM: 0.125,
      maximumSamplePoints: 1_000_000,
    });
    const proposal = {
      summary: { inferredFloorElevationM: 0 },
      walls: [{
        wallKey: "wall-001",
        geometry: { type: "line", points: [[0, 0, 0], [4, 0, 0]] },
        evidence: {},
      }],
    };
    const agreement = proposalCaptureAgreement(signature, proposal);
    expect(agreement.findings).toEqual([expect.objectContaining({
      kind: "barrier_crosses_open_capture",
      barrierId: "wall-001",
      levelKey: null,
    })]);
    expect(agreement.findings[0].metres).toBeGreaterThan(0.6);
  });

  it("reads each storey's walls in that storey's own doorway band", () => {
    // Wall support exists only in the level-002 band (floor at 3 m), with the
    // same doorway hole. A flat absolute band would miss it entirely.
    const points: Array<[number, number, number]> = [];
    for (let x = 0; x <= 4; x += 0.1) {
      if (x > 1.4 && x < 2.6) continue;
      for (const y of [4.1, 4.4, 4.7]) points.push([x, y, 0]);
    }
    const signature = parsePlySceneSignature(asciiPly(points), {
      voxelSizeM: 0.125,
      maximumSamplePoints: 1_000_000,
    });
    const proposal = {
      summary: { inferredFloorElevationM: 0 },
      levels: [
        { levelKey: "level-001", elevationM: 0 },
        { levelKey: "level-002", elevationM: 3 },
      ],
      walls: [{
        wallKey: "wall-007",
        geometry: { type: "line", points: [[0, 3, 0], [4, 3, 0]] },
        evidence: { levelKey: "level-002" },
      }],
    };
    const agreement = proposalCaptureAgreement(signature, proposal);
    expect(agreement.findings).toEqual([expect.objectContaining({
      kind: "barrier_crosses_open_capture",
      barrierId: "wall-007",
      levelKey: "level-002",
    })]);
  });
});
