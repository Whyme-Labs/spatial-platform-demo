import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRecastNavigationArtifact,
  extractCollisionGeometryFromGlb,
  importNavigationArtifact,
} from "../scripts/navigation-build-core.mjs";
import {
  controlledMovementReachedTarget,
  validateAuthoredTraversals,
  validatePhysicalNavigation,
} from "../scripts/physical-navigation-validation.mjs";

it("rejects same-length Rapier slides away from an authored traversal segment", () => {
  assert.equal(controlledMovementReachedTarget(
    [1, 0, 0],
    { x: 0, y: 0, z: 1 },
  ), false);
  assert.equal(controlledMovementReachedTarget(
    [1 / 3, 0, 0],
    { x: Math.fround(1 / 3), y: 0, z: 0 },
  ), true);
});

function appendFloor(positions, indices, minX, minZ, maxX, maxZ) {
  const offset = positions.length / 3;
  positions.push(
    minX, 0, minZ,
    minX, 0, maxZ,
    maxX, 0, maxZ,
    maxX, 0, minZ,
  );
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

const profile = {
  radius: 0.22,
  height: 1.8,
  eyeHeight: 1.6,
  maxClimb: 0.1,
  maxSlopeDegrees: 45,
  maxSpeed: 1.6,
  maxAcceleration: 8,
};
const build = { cellSize: 0.1, cellHeight: 0.05, tileSize: 32 };

function externalResourceGlb() {
  const source = JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ byteLength: 0, uri: "https://attacker.invalid/collision.bin" }],
    scenes: [{}],
    scene: 0,
  });
  const padded = source.padEnd(Math.ceil(source.length / 4) * 4, " ");
  const bytes = new Uint8Array(20 + padded.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, padded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(new TextEncoder().encode(padded), 20);
  return bytes;
}

describe("Unreal-equivalent navigation artifact", () => {
  it("rejects collision GLBs that can fetch external resources", async () => {
    await assert.rejects(
      extractCollisionGeometryFromGlb(externalResourceGlb()),
      (error) => error?.code === "EXTERNAL_COLLISION_RESOURCE",
    );
  });

  it("keeps legacy v8 artifacts readable in the offline importer", async () => {
    const positions = [];
    const indices = [];
    appendFloor(positions, indices, 0, 0, 4, 4);
    const artifact = await buildRecastNavigationArtifact({
      positions,
      indices,
      source: {
        assetId: "legacy-v8-collision",
        sha256: "8".repeat(64),
        authoringHash: "9".repeat(64),
        worldUnit: "metres",
      },
      agent: profile,
      build,
      spawn: { id: "opening", position: [2, 0, 2] },
      destinations: [],
    });
    const legacyV8Artifact = { ...artifact, schemaVersion: "spatial-navigation-v8" };
    const runtime = await importNavigationArtifact(legacyV8Artifact);
    assert.deepEqual(runtime.project([2, 0, 2]), [2, 0.05, 2]);
    runtime.destroy();
  });

  it("builds a reviewed elevator link between disconnected floors", async () => {
    const positions = [];
    const indices = [];
    appendFloor(positions, indices, 0, 0, 2, 4);
    const upperOffset = positions.length / 3;
    positions.push(3, 3, 0, 3, 3, 4, 5, 3, 4, 5, 3, 0);
    indices.push(
      upperOffset,
      upperOffset + 1,
      upperOffset + 2,
      upperOffset,
      upperOffset + 2,
      upperOffset + 3,
    );
    const artifact = await buildRecastNavigationArtifact({
      positions,
      indices,
      collisionSemantics: {
        schemaVersion: "spatial-structural-collision-v1",
        provenance: "registered_metric_mesh",
        structuralShellComplete: true,
        includedGroups: ["STRUCTURAL_FLOOR", "STRUCTURAL_BARRIER"],
        ignoredGroups: ["FURNITURE", "TRIGGER"],
      },
      source: {
        assetId: "link-collision",
        sha256: "f".repeat(64),
        authoringHash: "4".repeat(64),
        worldUnit: "metres",
      },
      agent: profile,
      build,
      spawn: { id: "opening", position: [1, 0, 1] },
      destinations: [{ id: "upper-floor", position: [4, 3, 3] }],
      offMeshConnections: [{
        id: "east-lift",
        traversalKind: "elevator",
        label: "East lift",
        startPosition: [1, 0, 2],
        endPosition: [4, 3, 2],
        controlPoints: [[1.5, 0.05, 2], [1.5, 3.05, 2], [3.5, 3.05, 2]],
        radius: 0.22,
        bidirectional: true,
        speedUnitsPerSecond: 1.6,
        area: 0,
        flags: 1,
        userId: 1,
        reviewedPurpose: "Reviewed elevator connecting the two captured floors.",
        evidenceReceipt: {
          assetId: "11111111-1111-4111-8111-111111111111",
          sha256: "a".repeat(64),
          manifestId: "22222222-2222-4222-8222-222222222222",
          manifestSha256: "b".repeat(64),
          adapter: "xgrids-lcc",
          reviewGeneration: 1,
          registrationSha256: "c".repeat(64),
          sourceToWorld: {
            sourceUpAxis: "Y",
            worldUnit: "metres",
            metresPerSourceUnit: 1,
            yawDegrees: 0,
            translationMetres: [10, 0, 0],
          },
          sourcePath: [
            [-9, 0, 2],
            [-8.5, 0.05, 2],
            [-8.5, 3.05, 2],
            [-6.5, 3.05, 2],
            [-6, 3, 2],
          ],
        },
      }],
    });

    assert.equal(artifact.schemaVersion, "spatial-navigation-v9");
    assert.equal(artifact.offMeshConnections[0].id, "east-lift");
    assert.deepEqual(artifact.offMeshConnections[0].requestedStartPosition, [1, 0, 2]);
    assert.deepEqual(artifact.offMeshConnections[0].requestedEndPosition, [4, 3, 2]);
    assert.deepEqual(artifact.offMeshConnections[0].startPosition, [1, 0.05, 2]);
    assert.deepEqual(artifact.offMeshConnections[0].endPosition, [4, 3.05, 2]);
    assert.equal(artifact.validation.componentCount, 1);
    assert.equal(artifact.validation.destinations[0].reachable, true);
    const traversalValidation = await validateAuthoredTraversals({
      artifact,
      positions,
      indices,
    });
    assert.equal(traversalValidation.connectionCount, 1);
    assert.equal(traversalValidation.directionCount, 2);
    await assert.rejects(
      validateAuthoredTraversals({
        artifact: {
          ...artifact,
          dynamicBarriers: [{
            id: "lift-shaft-blocked",
            defaultActive: true,
            min: [1.5, 1, 1.5],
            max: [2, 2, 2.5],
          }],
        },
        positions,
        indices,
      }),
      (error) => error?.code === "AUTHORED_TRAVERSAL_ACCEPTANCE_FAILED" &&
        /deviated/.test(error.message),
    );
    await assert.rejects(
      validateAuthoredTraversals({
        artifact,
        positions,
        indices,
        obstacleBoxes: [{
          min: [1.5, 1, 1.5],
          max: [2, 2, 2.5],
        }],
      }),
      (error) => error?.code === "AUTHORED_TRAVERSAL_ACCEPTANCE_FAILED" &&
        /deviated/.test(error.message),
    );
    const runtime = await importNavigationArtifact(artifact);
    try {
      const path = runtime.path([1, 0, 1], [4, 3, 3]);
      assert.ok(path && path.length >= 2);
      assert.ok(Math.abs(path.at(-1)[1] - 3.05) < 0.1);
    } finally {
      runtime.destroy();
    }
  });

  it("builds one radius-cleared Detour mesh and proves a two-room route", async () => {
    const positions = [];
    const indices = [];
    appendFloor(positions, indices, 0, 0, 4, 4);
    appendFloor(positions, indices, 4, 1.4, 5.5, 2.6);
    appendFloor(positions, indices, 5.5, 0, 9.5, 4);

    const artifact = await buildRecastNavigationArtifact({
      positions,
      indices,
      source: {
        assetId: "collision-asset",
        sha256: "a".repeat(64),
        authoringHash: "1".repeat(64),
      },
      agent: profile,
      build,
      spawn: { id: "opening", position: [1, 0, 2] },
      destinations: [{ id: "far-room", position: [8.5, 0, 2] }],
    });

    assert.equal(artifact.schemaVersion, "spatial-navigation-v6");
    assert.equal(artifact.source.authoringHash, "1".repeat(64));
    assert.deepEqual(artifact.generator, {
      name: "recast-navigation-js",
      version: "0.43.1",
      nativeRecastCommit: "599fd0f023181c0a484df2a18cf1d75a3553852e",
      mode: "tiled",
    });
    assert.equal(artifact.recastConfig.walkableRadius, 3);
    assert.equal(artifact.recastConfig.walkableHeight, 36);
    assert.equal(artifact.recastConfig.walkableClimb, 2);
    assert.equal(artifact.recastConfig.borderSize, 6);
    assert.equal(artifact.recastConfig.minRegionArea, 64);
    assert.equal(artifact.recastConfig.mergeRegionArea, 400);
    assert.equal(artifact.validation.passed, true);
    assert.equal(artifact.validation.componentCount, 1);
    assert.deepEqual(artifact.validation.unreachableDestinationIds, []);
    assert.ok(artifact.navMesh.vertices.length > 3);
    assert.ok(artifact.navMesh.indices.length > 3);
    assert.ok(artifact.detour.bytesBase64.length > 40);

    const runtime = await importNavigationArtifact(artifact);
    const moved = runtime.moveAlongSurface([1, 0, 2], [1.2, 0, 2]);
    assert.ok(moved);
    assert.ok(Math.abs(moved[0] - 1.2) < 0.11);
    assert.ok(runtime.path([1, 0, 2], [8.5, 0, 2])?.length > 1);
    runtime.destroy();

    const physical = await validatePhysicalNavigation({ artifact, positions, indices });
    assert.equal(physical.passed, true);
    assert.equal(physical.engine, "rapier3d");
    assert.equal(physical.routeCount, 2);
    assert.deepEqual(physical.failedDestinationIds, []);
    assert.deepEqual(
      physical.routes.map((route) => `${route.destinationId}:${route.direction}`).sort(),
      ["far-room:inbound", "far-room:outbound"],
    );
  });

  it("freezes structural collision semantics and public plus operator movement profiles in v7", async () => {
    const positions = [];
    const indices = [];
    appendFloor(positions, indices, 0, 0, 6, 4);
    const artifact = await buildRecastNavigationArtifact({
      positions,
      indices,
      source: {
        assetId: "structural-shell",
        sha256: "d".repeat(64),
        authoringHash: "5".repeat(64),
        worldUnit: "scene_units",
      },
      collisionSemantics: {
        schemaVersion: "spatial-structural-collision-v1",
        provenance: "operator_reviewed",
        structuralShellComplete: true,
        includedGroups: ["STRUCTURAL_FLOOR", "STRUCTURAL_BARRIER"],
        ignoredGroups: ["FURNITURE", "TRIGGER"],
      },
      structuralGeometry: {
        schemaVersion: "authored-structural-collision-v2",
        floorRectangles: [{ id: "floor", min: [0, 0], max: [6, 4], elevation: 0 }],
        ceilingRectangles: [{ id: "ceiling", min: [0, 0], max: [6, 4], elevation: 3 }],
        barrierSegments: [{
          id: "wall",
          start: [0, 0],
          end: [0, 4],
          minY: 0,
          maxY: 3,
        }],
        dynamicBarrierIds: [],
      },
      agent: profile,
      build,
      spawn: { id: "opening", position: [1, 0, 2] },
      destinations: [{ id: "room", position: [5, 0, 2] }],
    });

    assert.equal(artifact.schemaVersion, "spatial-navigation-v7");
    assert.equal(artifact.collisionSemantics.structuralShellComplete, true);
    assert.equal(artifact.structuralGeometry.barrierSegments.length, 1);
    assert.deepEqual(artifact.collisionSemantics.ignoredGroups, ["FURNITURE", "TRIGGER"]);
    assert.deepEqual(artifact.movementProfiles, {
      defaultMode: "walk",
      supportedModes: ["walk", "fly", "noclip"],
      walk: {
        shape: "capsule",
        gravity: true,
        groundSnap: true,
        collisionGroups: ["STRUCTURAL_FLOOR", "STRUCTURAL_BARRIER"],
        input: {
          forward: ["KeyW", "ArrowUp"],
          backward: ["KeyS", "ArrowDown"],
          left: ["KeyA", "ArrowLeft"],
          right: ["KeyD", "ArrowRight"],
          boost: ["ShiftLeft", "ShiftRight"],
        },
        speedUnitsPerSecond: 1.6,
        boostMultiplier: 3,
        recoveryBounds: [[-0.22, -1.8, -0.22], [6.22, 1.8, 4.22]],
      },
      fly: {
        shape: "sphere",
        gravity: false,
        groundSnap: false,
        collisionGroups: ["STRUCTURAL_FLOOR", "STRUCTURAL_BARRIER"],
        input: {
          forward: ["KeyW", "ArrowUp"],
          backward: ["KeyS", "ArrowDown"],
          left: ["KeyA", "ArrowLeft"],
          right: ["KeyD", "ArrowRight"],
          boost: ["ShiftLeft", "ShiftRight"],
          ascend: ["Space", "KeyE"],
          descend: ["KeyC", "KeyQ"],
        },
        speedUnitsPerSecond: 1.6,
        boostMultiplier: 3,
        recoveryBounds: [[-0.22, -1.8, -0.22], [6.22, 1.8, 4.22]],
      },
      noclip: {
        operatorOnly: true,
        shape: "none",
        gravity: false,
        groundSnap: false,
        collisionGroups: [],
        input: {
          forward: ["KeyW", "ArrowUp"],
          backward: ["KeyS", "ArrowDown"],
          left: ["KeyA", "ArrowLeft"],
          right: ["KeyD", "ArrowRight"],
          boost: ["ShiftLeft", "ShiftRight"],
          ascend: ["Space", "KeyE"],
          descend: ["KeyC", "KeyQ"],
        },
        speedUnitsPerSecond: 1.6,
        boostMultiplier: 3,
        recoveryBounds: [[-0.22, -1.8, -0.22], [6.22, 1.8, 4.22]],
      },
    });

    const runtime = await importNavigationArtifact(artifact);
    assert.ok(runtime.path([1, 0, 2], [5, 0, 2])?.length > 1);
    runtime.destroy();
  });

  it("fails closed when collision blocks a Detour-approved doorway", async () => {
    const positions = [];
    const indices = [];
    appendFloor(positions, indices, 0, 0, 4, 4);
    appendFloor(positions, indices, 4, 1.4, 5.5, 2.6);
    appendFloor(positions, indices, 5.5, 0, 9.5, 4);
    const artifact = await buildRecastNavigationArtifact({
      positions,
      indices,
      source: {
        assetId: "collision-asset",
        sha256: "c".repeat(64),
        authoringHash: "2".repeat(64),
      },
      agent: profile,
      build,
      spawn: { id: "opening", position: [1, 0, 2] },
      destinations: [{ id: "far-room", position: [8.5, 0, 2] }],
    });

    await assert.rejects(
      validatePhysicalNavigation({
        artifact,
        positions,
        indices,
        obstacleBoxes: [{ min: [4.5, 0, 1.35], max: [5, 2.2, 2.65] }],
      }),
      (error) => {
        assert.equal(error.code, "PHYSICAL_NAVIGATION_ACCEPTANCE_FAILED");
        assert.equal(error.details.destinationId, "far-room");
        return true;
      },
    );
  });

  it("fails closed when the projected opening spawn overlaps collision", async () => {
    const positions = [];
    const indices = [];
    appendFloor(positions, indices, 0, 0, 4, 4);
    const artifact = await buildRecastNavigationArtifact({
      positions,
      indices,
      source: {
        assetId: "spawn-collision",
        sha256: "c".repeat(64),
        authoringHash: "3".repeat(64),
        worldUnit: "metres",
      },
      agent: profile,
      build,
      spawn: { id: "blocked-opening", position: [1, 0, 1] },
      destinations: [{ id: "room", position: [3, 0, 3] }],
    });
    await assert.rejects(
      validatePhysicalNavigation({
        artifact,
        positions,
        indices,
        obstacleBoxes: [{ min: [0.5, 0, 0.5], max: [1.5, 2, 1.5] }],
      }),
      (error) => error?.code === "PHYSICAL_NAVIGATION_ACCEPTANCE_FAILED" &&
        error?.details?.destinationId === "blocked-opening",
    );
  });

  it("fails closed when advertised rooms remain disconnected", async () => {
    const positions = [];
    const indices = [];
    appendFloor(positions, indices, 0, 0, 4, 4);
    appendFloor(positions, indices, 7, 0, 11, 4);

    await assert.rejects(
      buildRecastNavigationArtifact({
        positions,
        indices,
        source: {
          assetId: "collision-asset",
          sha256: "b".repeat(64),
          authoringHash: "3".repeat(64),
        },
        agent: profile,
        build,
        spawn: { id: "opening", position: [1, 0, 2] },
        destinations: [{ id: "far-room", position: [9, 0, 2] }],
      }),
      (error) => {
        assert.equal(error.code, "NAVIGATION_ACCEPTANCE_FAILED");
        assert.equal(error.details.componentCount, 2);
        assert.deepEqual(error.details.unreachableDestinationIds, ["far-room"]);
        return true;
      },
    );
  });
});
