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
        /closed loops/.test(error.message),
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
    assert.equal(config.floorRectangles.length, 10);
    assert.equal(config.ceilingRectangles.length, 10);
    assert.equal(config.barrierSegments.length, 36);
    assert.deepEqual(geometry.dynamicBarriers, config.dynamicBarrierBoxes);
    assert.deepEqual(artifact.dynamicBarriers, config.dynamicBarrierBoxes);
    assert.ok(artifact.collisionSemantics.includedGroups.includes("DYNAMIC_BARRIER"));
    assert.equal(artifact.validation.componentCount, 1);
    assert.equal(artifact.validation.destinationCount, 4);
    assert.equal(physical.routeCount, 8);
    assert.equal(structural.passed, true);
    assert.equal(structural.anchorCount, 5);
    assert.equal(structural.probeCount, 30);
    assert.equal(structural.boundaryCount, 36);
    assert.equal(structural.boundaryProbeCount, 72);
    assert.deepEqual(structural.boundaryTopology, {
      passed: true,
      method: "explicit-closed-segment-loops-v1",
      loopCount: 1,
      floorComponentCount: 1,
      dynamicClosureCount: 0,
    });
    assert.equal(structural.ignoredFurnitureMeshCount, 1);
    assert.deepEqual(
      [...new Set(structural.probes.map((probe) => probe.direction))].sort(),
      ["down", "east", "north", "south", "up", "west"],
    );
    assert.ok(structural.probes.every((probe) => probe.blocked));
    assert.ok(structural.probes.every((probe) => Array.isArray(probe.origin)));
    assert.ok(structural.boundaryProbes.every((probe) => probe.blocked));
  });
});

function triangleNormalY(positions, [first, second, third]) {
  const a = positions.slice(first * 3, first * 3 + 3);
  const b = positions.slice(second * 3, second * 3 + 3);
  const c = positions.slice(third * 3, third * 3 + 3);
  return (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
}
