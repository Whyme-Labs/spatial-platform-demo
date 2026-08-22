import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  buildAuthoredCollisionGlb,
  buildAuthoredStructuralCollisionGlb,
  triangulateAuthoredSurfaces,
} from "../scripts/authored-collision.mjs";
import {
  buildRecastNavigationArtifact,
  extractCollisionGeometryFromGlb,
} from "../scripts/navigation-build-core.mjs";
import {
  validatePhysicalNavigation,
  validateStructuralNavigation,
  cornerWithinWalkerReach,
} from "../scripts/physical-navigation-validation.mjs";

describe("authored walkable collision", () => {
  it("rejects retired v1 inferred structural shells with a migration message", () => {
    assert.throws(
      () => buildAuthoredStructuralCollisionGlb({
        schemaVersion: "authored-structural-collision-v1",
        provenance: "operator_reviewed",
        interiorVolumes: [{ id: "room", min: [0, 0, 0], max: [4, 3, 4] }],
      }),
      /retired.*explicit floor, ceiling, and wall surfaces/i,
    );
  });

  it("triangulates concave floor surfaces and keeps every triangle facing up", () => {
    const geometry = triangulateAuthoredSurfaces([{
      id: "concave-room",
      points: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 2],
        [2, 0, 2],
        [2, 0, 4],
        [0, 0, 4],
      ],
    }]);

    assert.equal(geometry.positions.length / 3, 6);
    assert.equal(geometry.indices.length / 3, 4);
    for (let index = 0; index < geometry.indices.length; index += 3) {
      assert.ok(triangleNormalY(geometry.positions, geometry.indices.slice(index, index + 3)) > 0);
    }
  });

  it("writes a self-contained GLB accepted by the production navigation decoder", async () => {
    const bytes = buildAuthoredCollisionGlb([{
      id: "room-a",
      points: [[0, 0, 0], [3, 0, 0], [3, 0, 3], [0, 0, 3]],
    }, {
      id: "doorway",
      points: [[3, 0, 1], [5, 0, 1], [5, 0, 2], [3, 0, 2]],
    }], { generator: "Spatial Studio authored collision test" });

    const decoded = await extractCollisionGeometryFromGlb(bytes);
    assert.equal(decoded.meshCount, 1);
    assert.equal(decoded.positions.length / 3, 8);
    assert.equal(decoded.indices.length / 3, 4);
  });

  it("embeds a closed structural shell and excludes classified furniture", async () => {
    const bytes = buildAuthoredStructuralCollisionGlb({
      schemaVersion: "authored-structural-collision-v2",
      provenance: "operator_reviewed",
      floorRectangles: [{ id: "floor", min: [0, 0], max: [6, 4], elevation: 0 }],
      ceilingRectangles: [{ id: "ceiling", min: [0, 0], max: [6, 4], elevation: 2.8 }],
      barrierSegments: [
        { id: "west", start: [0, 0], end: [0, 4], minY: 0, maxY: 2.8 },
        { id: "east", start: [6, 0], end: [6, 4], minY: 0, maxY: 2.8 },
        { id: "north", start: [0, 0], end: [6, 0], minY: 0, maxY: 2.8 },
        { id: "south", start: [0, 4], end: [6, 4], minY: 0, maxY: 2.8 },
      ],
      dynamicBarrierBoxes: [],
      furnitureBoxes: [{
        id: "sofa",
        min: [2, 0, 1],
        max: [4, 1.2, 3],
      }],
    });

    const decoded = await extractCollisionGeometryFromGlb(bytes);
    assert.deepEqual(decoded.collisionSemantics, {
      schemaVersion: "spatial-structural-collision-v1",
      provenance: "operator_reviewed",
      structuralShellComplete: true,
      includedGroups: ["STRUCTURAL_FLOOR", "STRUCTURAL_BARRIER"],
      ignoredGroups: ["FURNITURE", "TRIGGER"],
    });
    assert.deepEqual(decoded.meshGroups, [
      "STRUCTURAL_FLOOR",
      "STRUCTURAL_BARRIER",
      "FURNITURE",
    ]);
    assert.equal(decoded.includedMeshCount, 2);
    assert.equal(decoded.ignoredMeshCount, 1);
    // Floor + ceiling + four walls = 12 structural triangles. The sofa's 12
    // triangles remain provenance evidence but cannot block the player.
    assert.equal(decoded.indices.length / 3, 12);
  });

  it("emits only explicitly authored v2 walls instead of extruding floor edges", async () => {
    const bytes = buildAuthoredStructuralCollisionGlb({
      schemaVersion: "authored-structural-collision-v2",
      provenance: "operator_reviewed",
      floorRectangles: [{ id: "floor", min: [0, 0], max: [4, 3], elevation: 0 }],
      ceilingRectangles: [{ id: "ceiling", min: [0, 0], max: [4, 3], elevation: 2.8 }],
      barrierSegments: [{
        id: "reviewed-wall",
        start: [0, 0],
        end: [0, 3],
        minY: 0,
        maxY: 2.8,
      }],
      dynamicBarrierBoxes: [],
      furnitureBoxes: [],
    });

    const decoded = await extractCollisionGeometryFromGlb(bytes);
    assert.equal(decoded.indices.length / 3, 6);
    assert.deepEqual(decoded.structuralGeometry, {
      schemaVersion: "authored-structural-collision-v2",
      floorRectangles: [{ id: "floor", min: [0, 0], max: [4, 3], elevation: 0 }],
      ceilingRectangles: [{ id: "ceiling", min: [0, 0], max: [4, 3], elevation: 2.8 }],
      barrierSegments: [{
        id: "reviewed-wall",
        start: [0, 0],
        end: [0, 3],
        minY: 0,
        maxY: 2.8,
      }],
      dynamicBarrierIds: [],
    });
  });

  it("cooks exact concave structural floors without collision in the missing corner", async () => {
    const room = [
      [0, 0, 0], [4, 0, 0], [4, 0, 1],
      [1, 0, 1], [1, 0, 4], [0, 0, 4],
    ];
    const bytes = buildAuthoredStructuralCollisionGlb({
      schemaVersion: "authored-structural-collision-v2",
      provenance: "operator_reviewed",
      floorSurfaces: [{ id: "l-floor", points: room, holes: [] }],
      ceilingSurfaces: [{
        id: "l-ceiling",
        points: room.map(([x, _y, z]) => [x, 2.8, z]),
        holes: [],
      }],
      barrierSegments: room.map((point, index) => {
        const end = room[(index + 1) % room.length];
        return {
          id: `wall-${index + 1}`,
          start: [point[0], point[2]],
          end: [end[0], end[2]],
          minY: 0,
          maxY: 2.8,
        };
      }),
      connectorSurfaces: [],
      dynamicBarrierBoxes: [],
      furnitureBoxes: [],
    });
    const decoded = await extractCollisionGeometryFromGlb(bytes);
    const floorTriangles = [];
    for (let index = 0; index < decoded.indices.length; index += 3) {
      const triangleIndices = decoded.indices.slice(index, index + 3);
      const points = triangleIndices.map((pointIndex) =>
        decoded.positions.slice(pointIndex * 3, pointIndex * 3 + 3));
      if (points.every((point) => Math.abs(point[1]) <= 1e-9) &&
        triangleNormalY(decoded.positions, triangleIndices) > 0) {
        floorTriangles.push(points);
      }
    }
    const area = floorTriangles.reduce((total, triangle) => total + Math.abs(
      triangleNormalY(triangle.flat(), [0, 1, 2]),
    ) / 2, 0);
    assert.equal(area, 7);
    assert.ok(floorTriangles.every((triangle) => {
      const centroid = [
        triangle.reduce((sum, point) => sum + point[0], 0) / 3,
        triangle.reduce((sum, point) => sum + point[2], 0) / 3,
      ];
      return centroid[0] <= 1 || centroid[1] <= 1;
    }));
  });

  it("rejects a horizontal surface whose hole is outside its outer ring", () => {
    assert.throws(
      () => buildAuthoredStructuralCollisionGlb({
        schemaVersion: "authored-structural-collision-v2",
        provenance: "operator_reviewed",
        floorSurfaces: [{
          id: "floor",
          points: [[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]],
          holes: [[[5, 0, 5], [6, 0, 5], [6, 0, 6], [5, 0, 6]]],
        }],
        ceilingSurfaces: [{
          id: "ceiling",
          points: [[0, 3, 0], [4, 3, 0], [4, 3, 4], [0, 3, 4]],
          holes: [],
        }],
        barrierSegments: [],
        connectorSurfaces: [],
        dynamicBarrierBoxes: [],
        furnitureBoxes: [],
      }),
      /hole 1 is not strictly contained by the outer ring/,
    );
  });

  it("rejects a floor when the reviewed ceiling covers only part of its surface", async () => {
    await assert.rejects(
      validateStructuralNavigation({
        artifact: {
          schemaVersion: "spatial-navigation-v7",
          agent: {
            radius: 0.2,
            height: 1.8,
            eyeHeight: 1.6,
            maxClimb: 0.1,
            maxSlopeDegrees: 45,
          },
          structuralGeometry: {
            schemaVersion: "authored-structural-collision-v2",
            floorSurfaces: [{
              id: "floor",
              points: [[0, 0, 0], [6, 0, 0], [6, 0, 6], [0, 0, 6]],
              holes: [],
            }],
            ceilingSurfaces: [{
              id: "partial-ceiling",
              points: [[0, 3, 0], [3, 3, 0], [3, 3, 6], [0, 3, 6]],
              holes: [],
            }],
            barrierSegments: [
              { id: "north", start: [0, 0], end: [6, 0], minY: 0, maxY: 3 },
              { id: "east", start: [6, 0], end: [6, 6], minY: 0, maxY: 3 },
              { id: "south", start: [6, 6], end: [0, 6], minY: 0, maxY: 3 },
              { id: "west", start: [0, 6], end: [0, 0], minY: 0, maxY: 3 },
            ],
            dynamicBarrierIds: [],
          },
        },
        positions: [],
        indices: [],
      }),
      (error) => error?.code === "STRUCTURAL_NAVIGATION_ACCEPTANCE_FAILED" &&
        /no explicit ceiling coverage/.test(error.message),
    );
  });

  it("builds one reachable navmesh across two reviewed levels and a stair surface", async () => {
    const bytes = buildAuthoredStructuralCollisionGlb({
      schemaVersion: "authored-structural-collision-v2",
      provenance: "registered_metric_mesh",
      floorRectangles: [
        { id: "ground-left", min: [0, 0], max: [2.3, 6], elevation: 0 },
        { id: "ground-right", min: [3.7, 0], max: [6, 6], elevation: 0 },
        { id: "ground-landing", min: [2.3, 0], max: [3.7, 1.3], elevation: 0 },
        { id: "upper-left", min: [0, 0], max: [2.3, 6], elevation: 3 },
        { id: "upper-right", min: [3.7, 0], max: [6, 6], elevation: 3 },
        { id: "upper-landing", min: [0, 4.75], max: [6, 6], elevation: 3 },
      ],
      ceilingRectangles: [
        { id: "ground-ceiling-left", min: [0, 0], max: [2.3, 6], elevation: 3 },
        { id: "ground-ceiling-right", min: [3.7, 0], max: [6, 6], elevation: 3 },
        { id: "ground-ceiling-landing", min: [0, 4.75], max: [6, 6], elevation: 3 },
        { id: "upper-ceiling", min: [0, 0], max: [6, 6], elevation: 5.8 },
      ],
      barrierSegments: [
        { id: "ground-west", start: [0, 0], end: [0, 6], minY: 0, maxY: 3 },
        { id: "ground-south", start: [0, 6], end: [6, 6], minY: 0, maxY: 3 },
        { id: "ground-east", start: [6, 6], end: [6, 0], minY: 0, maxY: 3 },
        { id: "ground-north", start: [6, 0], end: [0, 0], minY: 0, maxY: 3 },
        { id: "upper-west", start: [0, 0], end: [0, 6], minY: 3, maxY: 5.8 },
        { id: "upper-south", start: [0, 6], end: [6, 6], minY: 3, maxY: 5.8 },
        { id: "upper-east", start: [6, 6], end: [6, 0], minY: 3, maxY: 5.8 },
        { id: "upper-north", start: [6, 0], end: [0, 0], minY: 3, maxY: 5.8 },
      ],
      connectorSurfaces: Array.from({ length: 19 }, (_, step) => {
        const elevation = step / 18 * 3;
        const startZ = 0.5 + step * (4.3 / 18);
        return {
          id: `main-stair-tread-${step + 1}`,
          points: [
            [2.5, elevation, startZ], [2.5, elevation, startZ + 0.3],
            [3.5, elevation, startZ + 0.3], [3.5, elevation, startZ],
          ],
        };
      }),
      dynamicBarrierBoxes: [],
      furnitureBoxes: [],
    });
    const geometry = await extractCollisionGeometryFromGlb(bytes);
    assert.equal(geometry.structuralGeometry.connectorSurfaces.length, 19);
    const buildInput = {
      positions: geometry.positions,
      indices: geometry.indices,
      collisionSemantics: geometry.collisionSemantics,
      structuralGeometry: geometry.structuralGeometry,
      dynamicBarriers: geometry.dynamicBarriers,
      source: {
        assetId: "two-level-fixture",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        authoringHash: "b".repeat(64),
        worldUnit: "metres",
      },
      bounds: [[-0.5, -0.25, -0.5], [6.5, 6.1, 6.5]],
      agent: {
        radius: 0.2,
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
      spawn: { id: "ground", position: [1, 0, 2] },
      destinations: [
        { id: "ramp-middle", position: [3, 1.5, 2.65] },
        { id: "ramp-top", position: [3, 3, 4.4] },
        { id: "upper-landing", position: [3, 3, 4.6] },
        { id: "upper", position: [1, 3, 2] },
      ],
    };
    let artifact;
    try {
      artifact = await buildRecastNavigationArtifact(buildInput);
    } catch (error) {
      assert.fail(`${error.message}: ${JSON.stringify(error.details)}`);
    }
    assert.equal(artifact.validation.componentCount, 1);
    assert.deepEqual(artifact.validation.unreachableDestinationIds, []);
  });

  it("rejects a reviewed wall loop with a player-sized opening", async () => {
    await assert.rejects(
      validateStructuralNavigation({
        artifact: {
          schemaVersion: "spatial-navigation-v7",
          agent: {
            radius: 0.2,
            height: 1.8,
            eyeHeight: 1.6,
            maxClimb: 0.1,
            maxSlopeDegrees: 45,
          },
          structuralGeometry: {
            schemaVersion: "authored-structural-collision-v2",
            floorRectangles: [{ id: "floor", min: [0, 0], max: [8, 4], elevation: 0 }],
            ceilingRectangles: [{ id: "ceiling", min: [0, 0], max: [8, 4], elevation: 3 }],
            barrierSegments: [
              { id: "west", start: [0, 0], end: [0, 4], minY: 0, maxY: 3 },
              { id: "north", start: [0, 0], end: [8, 0], minY: 0, maxY: 3 },
              { id: "south", start: [0, 4], end: [8, 4], minY: 0, maxY: 3 },
              { id: "east-a", start: [8, 0], end: [8, 1.75], minY: 0, maxY: 3 },
              { id: "east-b", start: [8, 2.25], end: [8, 4], minY: 0, maxY: 3 },
            ],
            dynamicBarrierIds: [],
          },
        },
        positions: [],
        indices: [],
      }),
      (error) => error?.code === "STRUCTURAL_NAVIGATION_ACCEPTANCE_FAILED" &&
        /not enclosed|closed loops/.test(error.message),
    );
  });

  it("keeps the exact Home Scan route continuous through every advertised room", async () => {
    const config = JSON.parse(await readFile(
      new URL("../assets/home-scan-navigation-v6.json", import.meta.url),
      "utf8",
    ));
    const bytes = buildAuthoredCollisionGlb(config.surfaces, {
      generator: "Spatial Studio Home Scan acceptance",
      source: config.source,
    });
    const geometry = await extractCollisionGeometryFromGlb(bytes);
    const artifact = await buildRecastNavigationArtifact({
      ...config,
      positions: geometry.positions,
      indices: geometry.indices,
      source: {
        ...config.source,
        assetId: "home-scan-authored-navigation-v6.glb",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        authoringHash: createHash("sha256")
          .update(JSON.stringify(config.authoring))
          .digest("hex"),
      },
    });
    const physical = await validatePhysicalNavigation({
      artifact,
      positions: geometry.positions,
      indices: geometry.indices,
    });

    assert.equal(config.source.visualMasterSha256, "1d4c11e4e6f159e9997d953c22a6c5e8a9fecc45f1fa0ec4ad4ad207fc835148");
    assert.equal(config.authoring.algorithmVersion, "1.1.0");
    assert.equal(config.authoring.reviewedRoute.posterCheckpoints.length, 9);
    assert.equal(artifact.validation.passed, true);
    assert.equal(artifact.validation.componentCount, 1);
    assert.equal(artifact.validation.destinationCount, 4);
    assert.deepEqual(artifact.validation.unreachableDestinationIds, []);
    assert.equal(physical.passed, true);
    assert.equal(physical.routeCount, 8);
  });

  it("proves the Home Scan v7 shell is closed in all six movement directions", async () => {
    const config = JSON.parse(await readFile(
      new URL("../assets/home-scan-structural-v7.json", import.meta.url),
      "utf8",
    ));
    const bytes = buildAuthoredStructuralCollisionGlb(config, {
      generator: "Spatial Studio Home Scan structural acceptance",
      source: config.source,
    });
    const geometry = await extractCollisionGeometryFromGlb(bytes);
    const artifact = await buildRecastNavigationArtifact({
      ...config,
      positions: geometry.positions,
      indices: geometry.indices,
      collisionSemantics: geometry.collisionSemantics,
      dynamicBarriers: geometry.dynamicBarriers,
      structuralGeometry: geometry.structuralGeometry,
      source: {
        ...config.source,
        assetId: "home-scan-structural-v7.glb",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        authoringHash: createHash("sha256")
          .update(JSON.stringify(config.authoring))
          .digest("hex"),
      },
    });
    const structural = await validateStructuralNavigation({
      artifact,
      positions: geometry.positions,
      indices: geometry.indices,
      ignoredMeshCount: geometry.ignoredMeshCount,
    });
    const physical = await validatePhysicalNavigation({
      artifact,
      positions: geometry.positions,
      indices: geometry.indices,
    });

    assert.equal(artifact.schemaVersion, "spatial-navigation-v7");
    assert.equal(config.schemaVersion, "authored-structural-collision-v2");
    assert.equal(config.authoring.algorithm, "operator-authored-explicit-structural-surfaces");
    assert.equal(config.floorRectangles.length, 14);
    assert.equal(config.ceilingRectangles.length, 14);
    assert.equal(config.barrierSegments.length, 50);
    assert.deepEqual(geometry.dynamicBarriers, config.dynamicBarrierBoxes);
    assert.deepEqual(artifact.dynamicBarriers, config.dynamicBarrierBoxes);
    assert.ok(artifact.collisionSemantics.includedGroups.includes("DYNAMIC_BARRIER"));
    assert.equal(artifact.validation.componentCount, 1);
    assert.equal(artifact.validation.destinationCount, 4);
    assert.equal(physical.routeCount, 8);
    assert.equal(structural.passed, true);
    assert.equal(structural.anchorCount, 5);
    assert.equal(structural.probeCount, 30);
    assert.equal(structural.boundaryCount, 50);
    assert.equal(structural.boundaryProbeCount, 200);
    assert.equal(structural.cornerCount, 50);
    assert.equal(structural.cornerProbeCount, 50);
    // A well-formed authored scene keeps every boundary corner beside its own
    // floor, so nothing is ever skipped as out of a walker's reach.
    assert.equal(structural.unreachableCornerCount, 0);
    assert.equal(structural.dynamicBarrierCount, 2);
    assert.equal(structural.dynamicBarrierProbeCount, 2);
    assert.deepEqual(structural.boundaryTopology, {
      passed: true,
      method: "explicit-planar-boundary-faces-v2",
      loopCount: 1,
      floorComponentCount: 1,
      dynamicClosureCount: 2,
    });
    assert.equal(structural.ignoredFurnitureMeshCount, 1);
    assert.deepEqual(
      [...new Set(structural.probes.map((probe) => probe.direction))].sort(),
      ["down", "east", "north", "south", "up", "west"],
    );
    assert.ok(structural.probes.every((probe) => probe.blocked));
    assert.ok(structural.probes.every((probe) => Array.isArray(probe.origin)));
    assert.ok(structural.boundaryProbes.every((probe) => probe.blocked));
    assert.deepEqual(
      [...new Set(structural.boundaryProbes.map((probe) => `${probe.mode}:${probe.shape}`))].sort(),
      ["fly:sphere", "walk:capsule"],
    );
    assert.ok(structural.cornerProbes.every((probe) => probe.blocked && probe.remainedInside));
    assert.deepEqual(
      structural.dynamicBarrierProbes.map((probe) => probe.barrierId).sort(),
      ["door-far-room", "door-main-west"],
    );
    assert.ok(structural.dynamicBarrierProbes.every((probe) =>
      probe.open.physicsPassable && probe.open.routePassable &&
      probe.closed.physicsBlocked && probe.closed.routeBlocked));
  });
});

describe("wall thickness and passability semantics", () => {
  // Existing approved revisions freeze their cooked GLB bytes in R2 and bind
  // them into authoring hashes. A config with no thickness or passability
  // fields — the shape every pre-thickness revision has — must therefore cook
  // byte-identically forever. If an intentional cook change ever breaks this
  // digest, it must be versioned to apply to new revisions only.
  it("cooks a legacy-shaped config to byte-identical output", async () => {
    const config = JSON.parse(await readFile(
      new URL("../assets/home-scan-structural-v7.json", import.meta.url),
      "utf8",
    ));
    const bytes = buildAuthoredStructuralCollisionGlb(config, {
      generator: "Spatial Studio authored-structural-collision-v2",
      source: config.source ?? null,
    });
    assert.equal(bytes.byteLength, 14768);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      "8ba8ea877c7926fee72222ec5efa957708489b3d91765d04dcd6815ecd77f96f",
    );
  });

  it("cooks a thick wall as a closed prism on its centreline and freezes the evidence", async () => {
    const bytes = buildAuthoredStructuralCollisionGlb({
      schemaVersion: "authored-structural-collision-v2",
      provenance: "operator_reviewed",
      floorRectangles: [{ id: "floor", min: [0, 0], max: [6, 4], elevation: 0 }],
      ceilingRectangles: [{ id: "ceiling", min: [0, 0], max: [6, 4], elevation: 2.8 }],
      barrierSegments: [
        { id: "thin", start: [0, 0], end: [0, 4], minY: 0, maxY: 2.8 },
        {
          id: "thick",
          start: [6, 0],
          end: [6, 4],
          minY: 0,
          maxY: 2.8,
          thicknessM: 0.3,
          thicknessProvenance: "operator_reviewed",
        },
      ],
      dynamicBarrierBoxes: [],
      furnitureBoxes: [],
    });
    const decoded = await extractCollisionGeometryFromGlb(bytes);
    assert.deepEqual(decoded.structuralGeometry.barrierSegments, [
      { id: "thin", start: [0, 0], end: [0, 4], minY: 0, maxY: 2.8 },
      {
        id: "thick",
        start: [6, 0],
        end: [6, 4],
        minY: 0,
        maxY: 2.8,
        thicknessM: 0.3,
        thicknessProvenance: "operator_reviewed",
      },
    ]);
    // The prism's faces stand half a thickness either side of x = 6, so the
    // barrier geometry must reach 5.85 and 6.15 (float32-quantised) and no
    // further.
    const barrierXs = decoded.positions
      .filter((_, index) => index % 3 === 0)
      .filter((x) => x > 5);
    assert.ok(Math.abs(Math.min(...barrierXs) - 5.85) < 1e-6);
    assert.ok(Math.abs(Math.max(...barrierXs) - 6.15) < 1e-6);
  });

  it("rejects thickness outside the cookable range and unknown provenance", () => {
    const base = {
      schemaVersion: "authored-structural-collision-v2",
      provenance: "operator_reviewed",
      floorRectangles: [{ id: "floor", min: [0, 0], max: [4, 4], elevation: 0 }],
      ceilingRectangles: [{ id: "ceiling", min: [0, 0], max: [4, 4], elevation: 2.8 }],
      dynamicBarrierBoxes: [],
      furnitureBoxes: [],
    };
    assert.throws(
      () => buildAuthoredStructuralCollisionGlb({
        ...base,
        barrierSegments: [{
          id: "wall",
          start: [0, 0],
          end: [4, 0],
          minY: 0,
          maxY: 2.8,
          thicknessM: 3,
        }],
      }),
      /thickness must be between/,
    );
    assert.throws(
      () => buildAuthoredStructuralCollisionGlb({
        ...base,
        barrierSegments: [{
          id: "wall",
          start: [0, 0],
          end: [4, 0],
          minY: 0,
          maxY: 2.8,
          thicknessM: 0.2,
          thicknessProvenance: "guessed",
        }],
      }),
      /unsupported thickness provenance/,
    );
  });

  it("blocks with solid furniture and no-go volumes while decorative furniture stays passable", async () => {
    const bytes = buildAuthoredStructuralCollisionGlb({
      schemaVersion: "authored-structural-collision-v2",
      provenance: "operator_reviewed",
      floorRectangles: [{ id: "floor", min: [0, 0], max: [8, 6], elevation: 0 }],
      ceilingRectangles: [{ id: "ceiling", min: [0, 0], max: [8, 6], elevation: 2.8 }],
      barrierSegments: [
        { id: "west", start: [0, 0], end: [0, 6], minY: 0, maxY: 2.8 },
        { id: "east", start: [8, 0], end: [8, 6], minY: 0, maxY: 2.8 },
        { id: "north", start: [0, 0], end: [8, 0], minY: 0, maxY: 2.8 },
        { id: "south", start: [0, 6], end: [8, 6], minY: 0, maxY: 2.8 },
      ],
      dynamicBarrierBoxes: [],
      furnitureBoxes: [
        { id: "rug-sofa", min: [1, 0, 1], max: [2, 1, 2] },
        { id: "wardrobe", min: [5, 0, 2], max: [6, 2.2, 4], passability: "solid" },
      ],
      noGoVolumes: [{ id: "exhibit-keep-out", min: [3, 0, 4.5], max: [4, 2.8, 5.5] }],
    });
    const decoded = await extractCollisionGeometryFromGlb(bytes);
    assert.deepEqual(decoded.collisionSemantics.includedGroups, [
      "STRUCTURAL_FLOOR",
      "STRUCTURAL_BARRIER",
      "SOLID_FURNITURE",
      "NO_GO_VOLUME",
    ]);
    assert.deepEqual(decoded.meshGroups, [
      "STRUCTURAL_FLOOR",
      "STRUCTURAL_BARRIER",
      "FURNITURE",
      "SOLID_FURNITURE",
      "NO_GO_VOLUME",
    ]);
    assert.equal(decoded.ignoredMeshCount, 1);
    // Shell (floor + ceiling + 4 walls = 12) plus two blocking boxes at 12
    // triangles each plus each box's interior anti-island cap (2 triangles);
    // the decorative sofa contributes nothing.
    assert.equal(decoded.indices.length / 3, 40);
    assert.deepEqual(decoded.structuralGeometry.solidFurnitureBoxes, [
      { id: "wardrobe", min: [5, 0, 2], max: [6, 2.2, 4] },
    ]);
    assert.deepEqual(decoded.structuralGeometry.noGoVolumes, [
      { id: "exhibit-keep-out", min: [3, 0, 4.5], max: [4, 2.8, 5.5] },
    ]);
  });

  it("rejects a solid furniture box without a stable id and unknown passability", () => {
    const base = {
      schemaVersion: "authored-structural-collision-v2",
      provenance: "operator_reviewed",
      floorRectangles: [{ id: "floor", min: [0, 0], max: [4, 4], elevation: 0 }],
      ceilingRectangles: [{ id: "ceiling", min: [0, 0], max: [4, 4], elevation: 2.8 }],
      barrierSegments: [{ id: "wall", start: [0, 0], end: [4, 0], minY: 0, maxY: 2.8 }],
      dynamicBarrierBoxes: [],
    };
    assert.throws(
      () => buildAuthoredStructuralCollisionGlb({
        ...base,
        furnitureBoxes: [{ min: [1, 0, 1], max: [2, 1, 2], passability: "solid" }],
      }),
      /solid furniture box needs a unique stable id/,
    );
    assert.throws(
      () => buildAuthoredStructuralCollisionGlb({
        ...base,
        furnitureBoxes: [{ id: "ghost", min: [1, 0, 1], max: [2, 1, 2], passability: "ghost" }],
      }),
      /unsupported passability/,
    );
  });

  it("proves a shell with a prism wall, solid furniture, and a no-go volume end to end", async () => {
    const bytes = buildAuthoredStructuralCollisionGlb({
      schemaVersion: "authored-structural-collision-v2",
      provenance: "operator_reviewed",
      floorRectangles: [{ id: "floor", min: [0, 0], max: [8, 6], elevation: 0 }],
      ceilingRectangles: [{ id: "ceiling", min: [0, 0], max: [8, 6], elevation: 2.8 }],
      barrierSegments: [
        {
          id: "west",
          start: [0, 0],
          end: [0, 6],
          minY: 0,
          maxY: 2.8,
          thicknessM: 0.24,
          thicknessProvenance: "registered_mesh",
        },
        { id: "east", start: [8, 0], end: [8, 6], minY: 0, maxY: 2.8 },
        { id: "north", start: [0, 0], end: [8, 0], minY: 0, maxY: 2.8 },
        { id: "south", start: [0, 6], end: [8, 6], minY: 0, maxY: 2.8 },
      ],
      dynamicBarrierBoxes: [],
      furnitureBoxes: [
        { id: "wardrobe", min: [5, 0, 2.5], max: [6, 2.2, 3.5], passability: "solid" },
      ],
      noGoVolumes: [{ id: "keep-out", min: [2.5, 0, 4.8], max: [3.5, 2.8, 5.8] }],
    });
    const geometry = await extractCollisionGeometryFromGlb(bytes);
    const artifact = await buildRecastNavigationArtifact({
      positions: geometry.positions,
      indices: geometry.indices,
      collisionSemantics: geometry.collisionSemantics,
      structuralGeometry: geometry.structuralGeometry,
      dynamicBarriers: geometry.dynamicBarriers,
      source: {
        assetId: "passability-fixture",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        authoringHash: "c".repeat(64),
        worldUnit: "metres",
      },
      bounds: [[-0.7, -0.25, -0.5], [8.5, 3.1, 6.5]],
      agent: {
        radius: 0.2,
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
      spawn: { id: "middle", position: [2, 0, 2] },
      destinations: [{ id: "far-corner", position: [7, 0, 5] }],
    });
    assert.equal(artifact.validation.passed, true);
    assert.ok(artifact.collisionSemantics.includedGroups.includes("SOLID_FURNITURE"));
    assert.ok(artifact.collisionSemantics.includedGroups.includes("NO_GO_VOLUME"));
    const structural = await validateStructuralNavigation({
      artifact,
      positions: geometry.positions,
      indices: geometry.indices,
    });
    assert.equal(structural.passed, true);
    assert.equal(structural.boundaryCount, 4);
    assert.ok(structural.boundaryProbes.every((probe) => probe.blocked));
    // The navmesh must carve around blocking boxes: no walkable triangle
    // centroid may fall inside the wardrobe or the no-go footprint.
    const navVertices = artifact.navMesh.vertices;
    for (let index = 0; index < artifact.navMesh.indices.length; index += 3) {
      const centroid = [0, 1, 2].map((axis) =>
        [0, 1, 2].reduce((sum, point) =>
          sum + navVertices[artifact.navMesh.indices[index + point]][axis], 0) / 3);
      const insideWardrobe = centroid[0] > 5 && centroid[0] < 6 &&
        centroid[2] > 2.5 && centroid[2] < 3.5;
      const insideKeepOut = centroid[0] > 2.5 && centroid[0] < 3.5 &&
        centroid[2] > 4.8 && centroid[2] < 5.8;
      assert.ok(!insideWardrobe, "navmesh crossed solid furniture");
      assert.ok(!insideKeepOut, "navmesh crossed a no-go volume");
    }
  });
});

function triangleNormalY(positions, [first, second, third]) {
  const a = positions.slice(first * 3, first * 3 + 3);
  const b = positions.slice(second * 3, second * 3 + 3);
  const c = positions.slice(third * 3, third * 3 + 3);
  return (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
}

describe("cornerWithinWalkerReach", () => {
  // A boundary loop chained from observed walls can wander far outside the
  // cooked floor, through clutter the scanner saw but never walked. Those
  // corners cannot be exercised and cannot matter, because walkability is
  // bounded by cooked floor and no walker can stand near them.
  const room = [[0, 0], [4, 0], [4, 3], [0, 3]];

  it("keeps a corner standing on the floor", () => {
    assert.equal(cornerWithinWalkerReach([2, 1.5], [room], 1.25), true);
  });

  it("keeps a corner just outside the floor edge within reach", () => {
    assert.equal(cornerWithinWalkerReach([4.5, 1.5], [room], 1.25), true);
    assert.equal(cornerWithinWalkerReach([5.2, 1.5], [room], 1.25), true);
  });

  it("skips a corner no walker can approach", () => {
    // The FJD case: the failing corner sat 1.875 m from the nearest cooked
    // floor while the probe reaches 1.25 m.
    assert.equal(cornerWithinWalkerReach([5.875, 1.5], [room], 1.25), false);
    assert.equal(cornerWithinWalkerReach([2, -4], [room], 1.25), false);
  });

  it("measures against every floor ring, not just the first", () => {
    const far = [[20, 20], [22, 20], [22, 22], [20, 22]];
    assert.equal(cornerWithinWalkerReach([21, 19.5], [room, far], 1.25), true);
  });

  it("never skips when no floor rings are known, so the gate stays closed", () => {
    // The caller only consults this when rings exist; an empty set must not
    // silently exempt anything if that ever changes.
    assert.equal(cornerWithinWalkerReach([2, 1.5], [], 1.25), false);
  });
});
