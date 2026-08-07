import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  automaticNavigationLayout,
  automaticStructuralCollisionConfig,
  structuralCollisionConfigFromReviewPlan,
} from "../scripts/automatic-spatial-pipeline.mjs";
import { buildAuthoredStructuralCollisionGlb } from "../scripts/authored-collision.mjs";
import {
  buildRecastNavigationArtifact,
  extractCollisionGeometryFromGlb,
} from "../scripts/navigation-build-core.mjs";
import {
  validatePhysicalNavigation,
  validateStructuralNavigation,
} from "../scripts/physical-navigation-validation.mjs";

function lineProposal(wallKey, elevationM, start, end) {
  return {
    wallKey,
    elevationM,
    heightM: 3,
    thicknessM: 0.2,
    geometry: {
      type: "line",
      points: [[start[0], elevationM, start[1]], [end[0], elevationM, end[1]]],
    },
  };
}

function roomProposal(roomKey, levelKey, elevationM) {
  return {
    roomKey,
    elevationM,
    geometry: {
      type: "polygon",
      points: [[0, elevationM, 0], [6, elevationM, 0],
        [6, elevationM, 6], [0, elevationM, 6]],
    },
    evidence: { levelKey },
  };
}

describe("automatic multi-level spatial pipeline", () => {
  it("preserves a concave room footprint instead of inventing bounding-box floor", async () => {
    const roomPoints = [
      [0, 0, 0], [4, 0, 0], [4, 0, 1],
      [1, 0, 1], [1, 0, 4], [0, 0, 4],
    ];
    const report = {
      levels: [{ levelKey: "level-001", elevationM: 0, ceilingElevationM: 2.8 }],
      rooms: [{
        roomKey: "l-room",
        elevationM: 0,
        geometry: { type: "polygon", points: roomPoints },
        evidence: { levelKey: "level-001" },
      }],
      walls: roomPoints.map((point, index) => {
        const next = roomPoints[(index + 1) % roomPoints.length];
        return lineProposal(`wall-${index + 1}`, 0, [point[0], point[2]], [next[0], next[2]]);
      }),
      openings: [],
      connectors: [],
    };

    const config = automaticStructuralCollisionConfig(report);
    assert.deepEqual(config.floorSurfaces, [{
      id: "auto-floor-l-room",
      points: roomPoints,
      holes: [],
    }]);
    const bytes = buildAuthoredStructuralCollisionGlb(config);
    const geometry = await extractCollisionGeometryFromGlb(bytes);
    assert.deepEqual(geometry.structuralGeometry.floorSurfaces, config.floorSurfaces);
    const layout = automaticNavigationLayout({
      agent: { radius: 0.25 },
    }, geometry);
    assert.equal(pointInPolygon2(
      [layout.spawn.position[0], layout.spawn.position[2]],
      roomPoints.map(([x, _y, z]) => [x, z]),
    ), true);
    assert.equal(pointInPolygon2([3, 3], roomPoints.map(([x, _y, z]) => [x, z])), false);
  });

  it("creates a reachability destination for every inferred room, not only every floor", async () => {
    const report = {
      levels: [{ levelKey: "level-001", elevationM: 0, ceilingElevationM: 2.8 }],
      rooms: [
        {
          roomKey: "room-west",
          elevationM: 0,
          geometry: { type: "polygon", points: [
            [0, 0, 0], [3, 0, 0], [3, 0, 3], [0, 0, 3],
          ] },
          evidence: { levelKey: "level-001" },
        },
        {
          roomKey: "room-east",
          elevationM: 0,
          geometry: { type: "polygon", points: [
            [3, 0, 0], [6, 0, 0], [6, 0, 3], [3, 0, 3],
          ] },
          evidence: { levelKey: "level-001" },
        },
      ],
      walls: [
        lineProposal("north", 0, [0, 0], [6, 0]),
        lineProposal("east", 0, [6, 0], [6, 3]),
        lineProposal("south", 0, [6, 3], [0, 3]),
        lineProposal("west", 0, [0, 3], [0, 0]),
      ],
      openings: [],
      connectors: [],
    };
    const config = automaticStructuralCollisionConfig(report);
    const geometry = await extractCollisionGeometryFromGlb(
      buildAuthoredStructuralCollisionGlb(config),
    );
    const layout = automaticNavigationLayout({ agent: { radius: 0.25 } }, geometry);
    assert.deepEqual(
      layout.destinations.map((destination) => destination.id),
      ["automatic-room-room-east", "automatic-room-room-west"],
    );
  });

  it("blocks the whole automatic build when any inferred room cannot fit the player", async () => {
    const report = {
      levels: [{ levelKey: "level-001", elevationM: 0, ceilingElevationM: 2.8 }],
      rooms: [{
        roomKey: "narrow-room",
        elevationM: 0,
        geometry: { type: "polygon", points: [
          [0, 0, 0], [0.5, 0, 0], [0.5, 0, 4], [0, 0, 4],
        ] },
        evidence: { levelKey: "level-001" },
      }],
      walls: [
        lineProposal("north", 0, [0, 0], [0.5, 0]),
        lineProposal("east", 0, [0.5, 0], [0.5, 4]),
        lineProposal("south", 0, [0.5, 4], [0, 4]),
        lineProposal("west", 0, [0, 4], [0, 0]),
      ],
      openings: [],
      connectors: [],
    };
    const geometry = await extractCollisionGeometryFromGlb(
      buildAuthoredStructuralCollisionGlb(automaticStructuralCollisionConfig(report)),
    );

    assert.throws(
      () => automaticNavigationLayout({ agent: { radius: 0.25 } }, geometry),
      (error) => error?.code === "AUTOMATIC_NAVIGATION_ROOM_CLEARANCE_UNPROVEN" &&
        error.details?.blockedRooms?.[0]?.id === "auto-floor-narrow-room" &&
        /agent_radius=0.25.*blocked_room_ids=auto-floor-narrow-room/.test(error.message),
    );
  });

  it("preserves an oriented stair footprint instead of replacing it with an axis-aligned box", () => {
    const room = [
      [0, 0, 0], [14, 0, 0], [14, 0, 14], [0, 0, 14],
    ];
    const report = {
      levels: [
        { levelKey: "level-001", elevationM: 0, ceilingElevationM: 2.8 },
        { levelKey: "level-002", elevationM: 3, ceilingElevationM: 5.8 },
      ],
      rooms: [
        { ...roomProposal("lower", "level-001", 0), geometry: { type: "polygon", points: room } },
        { ...roomProposal("upper", "level-002", 3), geometry: {
          type: "polygon",
          points: room.map(([x, _y, z]) => [x, 3, z]),
        } },
      ],
      walls: room.flatMap((point, index) => {
        const next = room[(index + 1) % room.length];
        return [0, 3].map((elevation) => lineProposal(
          `wall-${elevation}-${index}`,
          elevation,
          [point[0], point[2]],
          [next[0], next[2]],
        ));
      }),
      openings: [],
      connectors: [{
        connectorKey: "diagonal-stair",
        geometry: { type: "polygon", points: [
          [3, 0, 5], [5, 0, 3], [9, 3, 11], [11, 3, 9],
        ] },
      }],
    };

    const config = automaticStructuralCollisionConfig(report);
    const lowerHole = config.floorSurfaces.find((surface) =>
      surface.id === "auto-floor-lower").holes[0];
    assert.equal(new Set(lowerHole.map((point) => point[0])).size, 4);
    assert.equal(new Set(lowerHole.map((point) => point[2])).size, 4);
  });

  it("floors the doorway threshold so rooms are not separate navigation islands", async () => {
    // Room polygons stop at the faces of the wall between them, so two rooms a
    // doorway apart are still separated by the wall's own thickness. Carving the
    // opening out of the barrier is not enough: without floor across that strip
    // the walker has nothing to step onto and each room is its own island.
    const northOf = (z) => [[0, 0, z], [6, 0, z], [6, 0, z + 3.75], [0, 0, z + 3.75]];
    const report = {
      levels: [{ levelKey: "level-001", elevationM: 0, ceilingElevationM: 2.5 }],
      rooms: [
        {
          roomKey: "south",
          elevationM: 0,
          geometry: { type: "polygon", points: [[0, 0, 0], [6, 0, 0], [6, 0, 4], [0, 0, 4]] },
          evidence: { levelKey: "level-001" },
        },
        {
          roomKey: "north",
          elevationM: 0,
          geometry: { type: "polygon", points: northOf(4.25) },
          evidence: { levelKey: "level-001" },
        },
      ],
      walls: [
        // The shared wall is observed on both faces and open across the doorway.
        lineProposal("wall-001", 0, [0, 4], [2, 4]),
        lineProposal("wall-002", 0, [3.25, 4], [6, 4]),
        lineProposal("wall-003", 0, [0, 4.25], [2, 4.25]),
        lineProposal("wall-004", 0, [3.25, 4.25], [6, 4.25]),
        lineProposal("wall-005", 0, [0, 0], [6, 0]),
        lineProposal("wall-006", 0, [6, 0], [6, 4]),
        lineProposal("wall-007", 0, [0, 4], [0, 0]),
        lineProposal("wall-008", 0, [0, 8], [6, 8]),
        lineProposal("wall-009", 0, [6, 4.25], [6, 8]),
        lineProposal("wall-010", 0, [0, 4.25], [0, 8]),
      ],
      openings: [{
        openingKey: "opening-001",
        kind: "opening_candidate",
        widthM: 1.25,
        elevationM: 0,
        geometry: { type: "line", points: [[2, 0, 4], [3.25, 0, 4]] },
      }],
      connectors: [],
    };

    const config = automaticStructuralCollisionConfig(report);
    const threshold = config.floorSurfaces.find((surface) =>
      surface.id === "auto-threshold-opening-001");
    assert.ok(threshold, "the doorway should be floored");
    const thresholdZ = threshold.points.map((point) => point[2]);
    assert.ok(Math.min(...thresholdZ) < 4, "threshold must reach into the south room");
    assert.ok(Math.max(...thresholdZ) > 4.25, "threshold must reach into the north room");

    const bytes = buildAuthoredStructuralCollisionGlb(config);
    const geometry = await extractCollisionGeometryFromGlb(bytes);
    const layout = automaticNavigationLayout({
      agent: {
        radius: 0.25,
        height: 1.7,
        eyeHeight: 1.6,
        maxClimb: 0.1,
        maxSlopeDegrees: 45,
      },
      build: {
        cellSize: 0.08,
        cellHeight: 0.05,
        tileSize: 64,
        maxEdgeLengthVoxels: 80,
        maxSimplificationError: 1.3,
        minimumRegionSizeVoxels: 2,
        mergeRegionSizeVoxels: 8,
      },
      source: {
        assetId: "automatic-doorway-threshold-fixture",
        sha256: createHash("sha256").update("doorway-threshold").digest("hex"),
        authoringHash: createHash("sha256").update("doorway-authoring").digest("hex"),
        worldUnit: "metres",
      },
    }, geometry);
    // A threshold links rooms; it is not a room, so it earns no destination.
    assert.deepEqual(layout.destinations.map((destination) => destination.id),
      ["automatic-room-north", "automatic-room-south"]);

    const artifact = await buildRecastNavigationArtifact({
      ...layout,
      positions: geometry.positions,
      indices: geometry.indices,
      collisionSemantics: geometry.collisionSemantics,
      structuralGeometry: geometry.structuralGeometry,
      dynamicBarriers: geometry.dynamicBarriers,
    });
    assert.deepEqual(artifact.validation.unreachableDestinationIds, []);
    assert.equal(artifact.validation.componentCount, 1);
  });

  it("scopes a disconnected capture to the spawn component and names the exclusions", async () => {
    // A real capture can hold rooms the scanner saw through glass but never
    // walked into. Strict acceptance rightly refuses such a scene outright;
    // the automatic proposal path instead scopes to what the spawn reaches and
    // discloses what fell outside, so the operator reviews the exclusions
    // rather than a hard failure.
    const room = (key, originX) => ({
      roomKey: key,
      elevationM: 0,
      geometry: { type: "polygon", points: [
        [originX, 0, 0], [originX + 6, 0, 0], [originX + 6, 0, 6], [originX, 0, 6],
      ] },
      evidence: { levelKey: "level-001" },
    });
    const box = (keyPrefix, originX) => [
      [originX, 0, originX, 6], [originX, 6, originX + 6, 6],
      [originX + 6, 6, originX + 6, 0], [originX + 6, 0, originX, 0],
    ].map(([x1, z1, x2, z2], index) =>
      lineProposal(`${keyPrefix}-${index + 1}`, 0, [x1, z1], [x2, z2]));
    const report = {
      levels: [{ levelKey: "level-001", elevationM: 0, ceilingElevationM: 2.5 }],
      // Twenty metres apart: no adjacency threshold may bridge them.
      rooms: [room("near", 0), room("far", 26)],
      walls: [...box("wall-near", 0), ...box("wall-far", 26)],
      openings: [],
      connectors: [],
    };

    const config = automaticStructuralCollisionConfig(report);
    const bytes = buildAuthoredStructuralCollisionGlb(config);
    const geometry = await extractCollisionGeometryFromGlb(bytes);
    const layout = automaticNavigationLayout({
      agent: {
        radius: 0.25, height: 1.7, eyeHeight: 1.6, maxClimb: 0.1, maxSlopeDegrees: 45,
      },
      build: {
        cellSize: 0.08, cellHeight: 0.05, tileSize: 64, maxEdgeLengthVoxels: 80,
        maxSimplificationError: 1.3, minimumRegionSizeVoxels: 2, mergeRegionSizeVoxels: 8,
      },
    }, geometry);
    const buildInput = {
      ...layout,
      positions: geometry.positions,
      indices: geometry.indices,
      collisionSemantics: geometry.collisionSemantics,
      structuralGeometry: geometry.structuralGeometry,
      dynamicBarriers: geometry.dynamicBarriers,
      source: {
        assetId: "disconnected-capture-fixture",
        sha256: createHash("sha256").update("disconnected").digest("hex"),
        authoringHash: createHash("sha256").update("disconnected-authoring").digest("hex"),
        worldUnit: "metres",
      },
    };

    await assert.rejects(
      buildRecastNavigationArtifact(buildInput),
      (error) => error.code === "NAVIGATION_ACCEPTANCE_FAILED",
      "strict acceptance must refuse a disconnected scene",
    );

    const artifact = await buildRecastNavigationArtifact({
      ...buildInput,
      acceptance: "largest-component",
    });
    assert.equal(artifact.validation.acceptanceMode, "largest-component");
    assert.equal(artifact.validation.passed, true);
    assert.ok(artifact.validation.componentCount > 1);
    assert.equal(artifact.validation.excludedDestinations.length, 1);
    const excluded = artifact.validation.excludedDestinations[0];
    assert.match(excluded.id, /far/);
    assert.ok([
      "disconnected_from_spawn_component",
      "no_navigable_surface_at_destination",
    ].includes(excluded.reason));
  });

  it("cooks stair treads and proves every inferred level is reachable", async () => {
    const report = {
      levels: [
        { levelKey: "level-001", elevationM: 0, ceilingElevationM: 2.5 },
        { levelKey: "level-002", elevationM: 3, ceilingElevationM: 5.5 },
      ],
      rooms: [
        roomProposal("room-001", "level-001", 0),
        roomProposal("room-002", "level-002", 3),
      ],
      walls: [
        ...[[0, 0, 0, 6], [0, 6, 6, 6], [6, 6, 6, 0], [6, 0, 0, 0]]
          .map(([x1, z1, x2, z2], index) =>
            lineProposal(`wall-00${index + 1}`, 0, [x1, z1], [x2, z2])),
        ...[[0, 0, 0, 6], [0, 6, 6, 6], [6, 6, 6, 0], [6, 0, 0, 0]]
          .map(([x1, z1, x2, z2], index) =>
            lineProposal(`wall-00${index + 5}`, 3, [x1, z1], [x2, z2])),
      ],
      openings: [],
      connectors: [{
        connectorKey: "connector-001",
        geometry: {
          type: "polygon",
          points: [[2.5, 0, 0.5], [2.5, 3, 4.8], [3.5, 3, 4.8], [3.5, 0, 0.5]],
        },
      }],
    };
    const collisionConfig = automaticStructuralCollisionConfig(report);
    assert.equal(collisionConfig.connectorSurfaces.length, 19);
    assert.ok(collisionConfig.floorSurfaces.some((floor) => floor.points[0][1] === 0));
    assert.ok(collisionConfig.floorSurfaces.some((floor) => floor.points[0][1] === 3));
    const bytes = buildAuthoredStructuralCollisionGlb(collisionConfig);
    const geometry = await extractCollisionGeometryFromGlb(bytes);
    const baseConfig = {
      agent: {
        radius: 0.25,
        height: 1.7,
        eyeHeight: 1.6,
        maxClimb: 0.2,
        maxSlopeDegrees: 45,
        maxSpeed: 1.6,
        maxAcceleration: 8,
      },
      build: {
        cellSize: 0.1,
        cellHeight: 0.05,
        tileSize: 32,
        minimumRegionSizeVoxels: 2,
        mergeRegionSizeVoxels: 4,
      },
      source: {
        assetId: "automatic-two-level-fixture",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        authoringHash: "c".repeat(64),
        worldUnit: "metres",
      },
    };
    const layout = automaticNavigationLayout(baseConfig, geometry);
    assert.deepEqual(layout.destinations.map((destination) => destination.position[1]), [0, 3]);
    let artifact;
    try {
      artifact = await buildRecastNavigationArtifact({
      ...layout,
      positions: geometry.positions,
      indices: geometry.indices,
      collisionSemantics: geometry.collisionSemantics,
      structuralGeometry: geometry.structuralGeometry,
      dynamicBarriers: geometry.dynamicBarriers,
      });
    } catch (error) {
      assert.fail(`${error.message}: ${JSON.stringify(error.details)}`);
    }
    assert.equal(artifact.validation.componentCount, 1);
    assert.deepEqual(artifact.validation.unreachableDestinationIds, []);
    const physical = await validatePhysicalNavigation({
      artifact,
      positions: geometry.positions,
      indices: geometry.indices,
    });
    assert.equal(physical.passed, true);
    let structural;
    try {
      structural = await validateStructuralNavigation({
        artifact,
        positions: geometry.positions,
        indices: geometry.indices,
        ignoredMeshCount: geometry.ignoredMeshCount,
      });
    } catch (error) {
      assert.fail(`${error.message}: ${JSON.stringify(error.details)}`);
    }
    assert.equal(structural.passed, true);
    assert.equal(structural.boundaryTopology.floorComponentCount, 2);
  });

  it("rejects stacked levels when no stair evidence exists", async () => {
    const report = {
      levels: [
        { levelKey: "level-001", elevationM: 0, ceilingElevationM: 2.5 },
        { levelKey: "level-002", elevationM: 3, ceilingElevationM: 5.5 },
      ],
      rooms: [
        roomProposal("room-001", "level-001", 0),
        roomProposal("room-002", "level-002", 3),
      ],
      walls: [
        lineProposal("wall-001", 0, [0, 0], [6, 0]),
        lineProposal("wall-002", 0, [6, 0], [6, 6]),
        lineProposal("wall-003", 0, [6, 6], [0, 6]),
        lineProposal("wall-004", 0, [0, 6], [0, 0]),
      ],
      openings: [],
      connectors: [],
    };
    const config = automaticStructuralCollisionConfig(report);
    assert.equal(config.connectorSurfaces.length, 0);
    assert.equal(config.floorSurfaces.length, 2);
    const bytes = buildAuthoredStructuralCollisionGlb(config);
    const geometry = await extractCollisionGeometryFromGlb(bytes);
    const baseConfig = {
      agent: {
        radius: 0.25,
        height: 1.7,
        eyeHeight: 1.6,
        maxClimb: 0.2,
        maxSlopeDegrees: 45,
        maxSpeed: 1.6,
        maxAcceleration: 8,
      },
      build: {
        cellSize: 0.1,
        cellHeight: 0.05,
        tileSize: 32,
        minimumRegionSizeVoxels: 2,
        mergeRegionSizeVoxels: 4,
      },
      source: {
        assetId: "disconnected-two-level-fixture",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        authoringHash: "d".repeat(64),
        worldUnit: "metres",
      },
    };
    const layout = automaticNavigationLayout(baseConfig, geometry);
    await assert.rejects(
      buildRecastNavigationArtifact({
        ...layout,
        positions: geometry.positions,
        indices: geometry.indices,
        collisionSemantics: geometry.collisionSemantics,
        structuralGeometry: geometry.structuralGeometry,
        dynamicBarriers: geometry.dynamicBarriers,
      }),
      (error) => error?.code === "NAVIGATION_ACCEPTANCE_FAILED" &&
        error.details?.unreachableDestinationIds?.includes("automatic-room-room-002"),
    );
  });

  it("only cuts a wall with openings declared on the same level", () => {
    const report = {
      levels: [
        { levelKey: "level-001", elevationM: 0, ceilingElevationM: 2.5 },
        { levelKey: "level-002", elevationM: 3, ceilingElevationM: 5.5 },
      ],
      rooms: [
        roomProposal("room-001", "level-001", 0),
        roomProposal("room-002", "level-002", 3),
      ],
      walls: [
        lineProposal("wall-001", 0, [0, 0], [6, 0]),
        lineProposal("wall-002", 3, [0, 0], [6, 0]),
      ],
      openings: [{
        openingKey: "opening-001",
        elevationM: 3,
        geometry: {
          type: "line",
          points: [[2, 3, 0], [3, 3, 0]],
        },
      }],
      connectors: [],
    };
    const config = automaticStructuralCollisionConfig(report);
    const observed = config.barrierSegments.filter((barrier) =>
      barrier.id.startsWith("auto-barrier-"));
    const lower = observed.filter((barrier) => barrier.minY === 0);
    const upper = observed.filter((barrier) => barrier.minY === 3);
    assert.equal(lower.length, 1);
    assert.deepEqual(lower[0].start, [0, 0]);
    assert.deepEqual(lower[0].end, [6, 0]);
    assert.equal(upper.length, 2);
  });

  it("rings each storey so honestly gapped walls still enclose the scene", async () => {
    // Observed walls legitimately stop where the capture saw glass or nothing.
    // The structural proof still demands a closed boundary loop with corners a
    // player capsule can stand beside, so the config fences each storey along
    // its walkable outline. The EyefulTower workshop reproduced the failure:
    // wall gaps meant no loop, and the whole automatic build failed closed.
    const report = {
      levels: [{ levelKey: "level-001", elevationM: 0, ceilingElevationM: 2.5 }],
      rooms: [roomProposal("room-001", "level-001", 0)],
      walls: [
        // Three sides observed; the north side is a captured-glass gap.
        lineProposal("wall-001", 0, [0, 0], [6, 0]),
        lineProposal("wall-002", 0, [6, 0], [6, 6]),
        lineProposal("wall-003", 0, [0, 6], [0, 0]),
      ],
      openings: [],
      connectors: [],
    };
    const config = automaticStructuralCollisionConfig(report);
    const ring = config.barrierSegments.filter((barrier) =>
      barrier.id.startsWith("auto-capture-ring-"));
    assert.ok(ring.length >= 4, "storey should be ringed");

    const bytes = buildAuthoredStructuralCollisionGlb(config);
    const geometry = await extractCollisionGeometryFromGlb(bytes);
    const layout = automaticNavigationLayout({
      agent: {
        radius: 0.25, height: 1.7, eyeHeight: 1.6, maxClimb: 0.1, maxSlopeDegrees: 45,
      },
      build: {
        cellSize: 0.08, cellHeight: 0.05, tileSize: 64, maxEdgeLengthVoxels: 80,
        maxSimplificationError: 1.3, minimumRegionSizeVoxels: 2, mergeRegionSizeVoxels: 8,
      },
    }, geometry);
    const artifact = await buildRecastNavigationArtifact({
      ...layout,
      positions: geometry.positions,
      indices: geometry.indices,
      collisionSemantics: geometry.collisionSemantics,
      structuralGeometry: geometry.structuralGeometry,
      dynamicBarriers: geometry.dynamicBarriers,
      source: {
        assetId: "ringed-gap-fixture",
        sha256: createHash("sha256").update("ringed-gap").digest("hex"),
        authoringHash: createHash("sha256").update("ringed-gap-authoring").digest("hex"),
        worldUnit: "metres",
      },
    });
    const structural = await validateStructuralNavigation({
      artifact,
      positions: geometry.positions,
      indices: geometry.indices,
      ignoredMeshCount: geometry.ignoredMeshCount,
    });
    assert.equal(structural.passed, true);
  });

  it("cuts passable doors but keeps windows and unknown gaps physically blocked", () => {
    const plan = {
      schemaVersion: "1.0.0",
      units: "metres",
      coordinateFrame: "registered_y_up_metric_frame",
      levels: [{
        id: "ground",
        label: "Ground",
        elevationM: 0,
        ceilingElevationM: 2.8,
        rooms: [{
          id: "room",
          label: "Room",
          points: [[0, 0], [6, 0], [6, 4], [0, 4]],
        }],
        walls: [
          { id: "north", label: "North", start: [0, 0], end: [6, 0], thicknessM: 0.2, heightM: 2.8 },
          { id: "east", label: "East", start: [6, 0], end: [6, 4], thicknessM: 0.2, heightM: 2.8 },
          { id: "south", label: "South", start: [6, 4], end: [0, 4], thicknessM: 0.2, heightM: 2.8 },
          { id: "west", label: "West", start: [0, 4], end: [0, 0], thicknessM: 0.2, heightM: 2.8 },
        ],
        openings: [
          { id: "door", label: "Door", type: "door", wallId: "south", start: [2, 4], end: [3, 4], widthM: 1, heightM: 2.1 },
          { id: "window", label: "Window", type: "window", wallId: "north", start: [2, 0], end: [3, 0], widthM: 1, heightM: 1.2 },
          { id: "unknown", label: "Unknown", type: "unknown", wallId: "east", start: [6, 1], end: [6, 2], widthM: 1, heightM: null },
        ],
      }],
      connectors: [],
    };

    const config = structuralCollisionConfigFromReviewPlan(plan);
    assert.equal(config.barrierSegments.filter((barrier) => barrier.id.includes("south")).length, 2);
    assert.equal(config.barrierSegments.filter((barrier) => barrier.id.includes("north")).length, 1);
    assert.equal(config.barrierSegments.filter((barrier) => barrier.id.includes("east")).length, 1);
  });

  it("fails closed when a level has no captured ceiling support", () => {
    assert.throws(
      () => automaticStructuralCollisionConfig({
        levels: [{ levelKey: "level-001", elevationM: 0, ceilingElevationM: null }],
        rooms: [roomProposal("room-001", "level-001", 0)],
        walls: [lineProposal("wall-001", 0, [0, 0], [6, 0])],
        openings: [],
        connectors: [],
      }),
      (error) => error?.code === "AUTOMATIC_COLLISION_CEILING_MISSING",
    );
  });
});

function pointInPolygon2(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length;
    previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}
