import {
  NavMeshQuery,
  exportNavMesh,
  getNavMeshPositionsAndIndices,
  importNavMesh,
  init,
} from "@recast-navigation/core";
import { generateTiledNavMesh } from "@recast-navigation/generators";
import { Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const LEGACY_SCHEMA_VERSION = "spatial-navigation-v6";
const STRUCTURAL_SCHEMA_VERSION = "spatial-navigation-v7";
const LEGACY_AUTHORED_TRAVERSAL_SCHEMA_VERSION = "spatial-navigation-v8";
const AUTHORED_TRAVERSAL_SCHEMA_VERSION = "spatial-navigation-v9";
const GENERATOR_VERSION = "0.43.1";
const NATIVE_RECAST_COMMIT = "599fd0f023181c0a484df2a18cf1d75a3553852e";
const MAX_COLLISION_GLB_BYTES = 256 * 1024 * 1024;
const MAX_COLLISION_VERTICES = 3_000_000;
const MAX_COLLISION_TRIANGLES = 5_000_000;
let initialization;

export class NavigationBuildError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "NavigationBuildError";
    this.code = code;
    this.details = details;
  }
}

export async function extractCollisionGeometryFromGlb(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const document = preflightCollisionGlb(data);
  const collisionSemantics = structuralCollisionSemantics(document);
  const dynamicBarriers = structuralDynamicBarriers(document);
  const structuralGeometry = structuralGeometryReview(document);
  if (collisionSemantics &&
    collisionSemantics.includedGroups.includes("DYNAMIC_BARRIER") !== Boolean(dynamicBarriers.length)) {
    throw new NavigationBuildError(
      "INVALID_COLLISION_SEMANTICS",
      "DYNAMIC_BARRIER semantics must exactly match the embedded dynamic barrier list",
    );
  }
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  let gltf;
  try {
    gltf = await new GLTFLoader().parseAsync(arrayBuffer, "");
  } catch (error) {
    throw new NavigationBuildError(
      "INVALID_COLLISION_GLB",
      `Collision GLB could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  gltf.scene.updateMatrixWorld(true);
  const positions = [];
  const indices = [];
  const point = new Vector3();
  let meshCount = 0;
  let includedMeshCount = 0;
  let ignoredMeshCount = 0;
  const meshGroups = [];
  gltf.scene.traverse((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    const collisionGroup = typeof object.userData?.collisionGroup === "string"
      ? object.userData.collisionGroup
      : null;
    meshGroups.push(collisionGroup ?? "LEGACY_UNCLASSIFIED");
    if (collisionSemantics) {
      if (!collisionGroup || !COLLISION_GROUPS.has(collisionGroup)) {
        throw new NavigationBuildError(
          "INVALID_COLLISION_SEMANTICS",
          `Structural collision mesh ${object.name || meshCount + 1} has no valid collision group`,
        );
      }
      if (collisionSemantics.ignoredGroups.includes(collisionGroup)) {
        ignoredMeshCount += 1;
        meshCount += 1;
        return;
      }
      if (!collisionSemantics.includedGroups.includes(collisionGroup)) {
        throw new NavigationBuildError(
          "INVALID_COLLISION_SEMANTICS",
          `Collision group ${collisionGroup} is neither included nor ignored`,
        );
      }
    }
    const geometry = object.geometry;
    const position = geometry.attributes.position;
    const offset = positions.length / 3;
    if (offset + position.count > MAX_COLLISION_VERTICES) {
      throw new NavigationBuildError(
        "COLLISION_GLB_LIMIT_EXCEEDED",
        `Collision GLB exceeds ${MAX_COLLISION_VERTICES.toLocaleString()} vertices`,
      );
    }
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      positions.push(point.x, point.y, point.z);
    }
    const sourceIndices = geometry.index
      ? Array.from(geometry.index.array)
      : Array.from({ length: position.count }, (_, index) => index);
    if (sourceIndices.length % 3 !== 0) {
      throw new NavigationBuildError(
        "INVALID_COLLISION_GLB",
        `Collision mesh ${object.name || meshCount + 1} is not a triangle list`,
      );
    }
    if (indices.length / 3 + sourceIndices.length / 3 > MAX_COLLISION_TRIANGLES) {
      throw new NavigationBuildError(
        "COLLISION_GLB_LIMIT_EXCEEDED",
        `Collision GLB exceeds ${MAX_COLLISION_TRIANGLES.toLocaleString()} triangles`,
      );
    }
    const mirrored = object.matrixWorld.determinant() < 0;
    for (let index = 0; index < sourceIndices.length; index += 3) {
      const first = Number(sourceIndices[index]) + offset;
      const second = Number(sourceIndices[index + 1]) + offset;
      const third = Number(sourceIndices[index + 2]) + offset;
      indices.push(first, mirrored ? third : second, mirrored ? second : third);
    }
    includedMeshCount += 1;
    meshCount += 1;
  });
  if (!meshCount || positions.length < 9 || indices.length < 3) {
    throw new NavigationBuildError(
      "INVALID_COLLISION_GLB",
      "Collision GLB contains no indexed or non-indexed triangle meshes",
    );
  }
  return {
    positions,
    indices,
    meshCount,
    includedMeshCount,
    ignoredMeshCount,
    meshGroups,
    collisionSemantics,
    dynamicBarriers,
    structuralGeometry,
  };
}

function preflightCollisionGlb(data) {
  if (data.byteLength < 20 || data.byteLength > MAX_COLLISION_GLB_BYTES) {
    throw new NavigationBuildError(
      "COLLISION_GLB_LIMIT_EXCEEDED",
      `Collision GLB must be between 20 bytes and ${MAX_COLLISION_GLB_BYTES} bytes`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== data.byteLength
  ) {
    throw new NavigationBuildError(
      "INVALID_COLLISION_GLB",
      "Collision input must be a complete binary glTF 2.0 container",
    );
  }
  let offset = 12;
  let document = null;
  while (offset + 8 <= data.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + chunkLength > data.byteLength) {
      throw new NavigationBuildError("INVALID_COLLISION_GLB", "Collision GLB has a truncated chunk");
    }
    if (chunkType === 0x4e4f534a && !document) {
      try {
        const json = new TextDecoder().decode(data.subarray(offset, offset + chunkLength)).trim();
        document = JSON.parse(json);
      } catch {
        throw new NavigationBuildError("INVALID_COLLISION_GLB", "Collision GLB JSON is invalid");
      }
    }
    offset += chunkLength;
  }
  if (offset !== data.byteLength || !document || typeof document !== "object") {
    throw new NavigationBuildError("INVALID_COLLISION_GLB", "Collision GLB chunk table is invalid");
  }
  const externalUris = [
    ...(Array.isArray(document.buffers) ? document.buffers : []),
    ...(Array.isArray(document.images) ? document.images : []),
  ].some((entry) => entry && typeof entry === "object" && typeof entry.uri === "string");
  if (externalUris) {
    throw new NavigationBuildError(
      "EXTERNAL_COLLISION_RESOURCE",
      "Collision GLB must embed every buffer and image; external or data URIs are rejected",
    );
  }
  return document;
}

function structuralCollisionSemantics(document) {
  const asset = document?.asset;
  const extras = asset && typeof asset === "object" ? asset.extras : null;
  const value = extras && typeof extras === "object" ? extras.spatialCollision : null;
  return value ? canonicalCollisionSemantics(value) : null;
}

function structuralDynamicBarriers(document) {
  const extras = document?.asset && typeof document.asset === "object"
    ? document.asset.extras
    : null;
  const values = extras && typeof extras === "object" ? extras.dynamicBarriers : null;
  return canonicalDynamicBarriers(values ?? []);
}

function structuralGeometryReview(document) {
  const extras = document?.asset && typeof document.asset === "object"
    ? document.asset.extras
    : null;
  const value = extras && typeof extras === "object" ? extras.authoring : null;
  if (!value) return null;
  if (value.schemaVersion !== "authored-structural-collision-v2") {
    throw new NavigationBuildError(
      "INVALID_STRUCTURAL_AUTHORING",
      "Operator-authored structural collision must use explicit v2 surfaces",
    );
  }
  const floorRectangles = canonicalHorizontalRectangles(value.floorRectangles, "floor");
  const ceilingRectangles = canonicalHorizontalRectangles(value.ceilingRectangles, "ceiling");
  const dynamicBarrierIds = canonicalIds(value.dynamicBarrierIds ?? [], "dynamic barrier");
  const barrierSegments = canonicalBarrierSegments(value.barrierSegments);
  const connectorSurfaces = canonicalConnectorSurfaces(value.connectorSurfaces ?? []);
  return {
    schemaVersion: "authored-structural-collision-v2",
    floorRectangles,
    ceilingRectangles,
    barrierSegments,
    ...(connectorSurfaces.length ? { connectorSurfaces } : {}),
    dynamicBarrierIds,
  };
}

function canonicalIds(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new NavigationBuildError(
      "INVALID_STRUCTURAL_AUTHORING",
      `Explicit structural ${label} ids are invalid`,
    );
  }
  const normalized = values.map((value) => value.trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new NavigationBuildError(
      "INVALID_STRUCTURAL_AUTHORING",
      `Explicit structural ${label} ids must be unique`,
    );
  }
  return normalized;
}

function canonicalBarrierSegments(values) {
  if (!Array.isArray(values) || !values.length) {
    throw new NavigationBuildError(
      "INVALID_STRUCTURAL_AUTHORING",
      "Explicit structural barriers are required",
    );
  }
  const ids = new Set();
  return values.map((value) => {
    const id = typeof value?.id === "string" ? value.id.trim() : "";
    const start = pointTuple2(value?.start);
    const end = pointTuple2(value?.end);
    const minY = Number(value?.minY);
    const maxY = Number(value?.maxY);
    if (!id || ids.has(id) || !start || !end || !Number.isFinite(minY) ||
      !Number.isFinite(maxY) || minY >= maxY ||
      Math.hypot(end[0] - start[0], end[1] - start[1]) <= 1e-6) {
      throw new NavigationBuildError(
        "INVALID_STRUCTURAL_AUTHORING",
        `Explicit structural barrier ${id || "unknown"} is invalid`,
      );
    }
    ids.add(id);
    return { id, start, end, minY, maxY };
  });
}

function canonicalHorizontalRectangles(values, label) {
  if (!Array.isArray(values) || !values.length) {
    throw new NavigationBuildError(
      "INVALID_STRUCTURAL_AUTHORING",
      `Explicit structural ${label} rectangles are required`,
    );
  }
  const ids = new Set();
  return values.map((value) => {
    const id = typeof value?.id === "string" ? value.id.trim() : "";
    const min = pointTuple2(value?.min);
    const max = pointTuple2(value?.max);
    const elevation = Number(value?.elevation);
    if (!id || ids.has(id) || !min || !max || !Number.isFinite(elevation) ||
      min.some((coordinate, axis) => coordinate >= max[axis])) {
      throw new NavigationBuildError(
        "INVALID_STRUCTURAL_AUTHORING",
        `Explicit structural ${label} rectangle ${id || "unknown"} is invalid`,
      );
    }
    ids.add(id);
    return { id, min, max, elevation };
  });
}

function canonicalConnectorSurfaces(values) {
  if (!Array.isArray(values)) {
    throw new NavigationBuildError(
      "INVALID_STRUCTURAL_AUTHORING",
      "Explicit structural connector surfaces must be an array",
    );
  }
  const ids = new Set();
  return values.map((value) => {
    const id = typeof value?.id === "string" ? value.id.trim() : "";
    const points = Array.isArray(value?.points) ? value.points.map(pointTuple) : [];
    if (!id || ids.has(id) || points.length < 3 || points.some((point) => !point)) {
      throw new NavigationBuildError(
        "INVALID_STRUCTURAL_AUTHORING",
        `Explicit structural connector ${id || "unknown"} is invalid`,
      );
    }
    ids.add(id);
    return { id, points };
  });
}

/**
 * Deep adapter around the pinned Recast/Detour binding. The rest of Spatial
 * Studio deals only in the versioned artifact below, so the WASM binding can
 * be replaced without changing releases or device adapters.
 */
export async function buildRecastNavigationArtifact(input) {
  validateBuildInput(input);
  await ensureInitialized();
  const artifactBounds = boundsOf(input.positions);
  const recastConfig = recastConfigFor(input.agent, input.build);
  const authoredTraversals = canonicalOffMeshConnections(
    input.offMeshConnections ?? [],
    input.agent,
  );
  const generated = generateTiledNavMesh(input.positions, input.indices, {
    ...recastConfig,
    ...(input.bounds ? { bounds: input.bounds } : {}),
    ...(authoredTraversals.length
      ? { offMeshConnections: authoredTraversals.map(toOffMeshConnection) }
      : {}),
  });
  if (!generated.success) {
    throw new NavigationBuildError(
      "RECAST_BUILD_FAILED",
      `Recast could not build a tiled navigation mesh: ${generated.error}`,
      { generatorError: generated.error },
    );
  }

  const navMesh = generated.navMesh;
  const query = new NavMeshQuery(navMesh, { maxNodes: 4096 });
  try {
    const [flatPositions, debugIndices] = getNavMeshPositionsAndIndices(navMesh);
    const vertices = tuples(flatPositions);
    if (vertices.length < 3 || debugIndices.length < 3) {
      throw new NavigationBuildError(
        "EMPTY_NAVIGATION_MESH",
        "Recast produced no traversable navigation polygons",
      );
    }
    const triangleComponents = collectTriangleComponents(vertices, debugIndices);
    const queryHalfExtents = {
      x: Math.max(input.agent.radius * 2, input.build.cellSize * 2),
      y: Math.max(input.agent.height, input.build.cellHeight * 2),
      z: Math.max(input.agent.radius * 2, input.build.cellSize * 2),
    };
    const maximumProjectionDistance = Math.max(
      input.agent.radius * 2,
      input.build.cellSize * 3,
    );
    const frozenTraversals = authoredTraversals.map((connection) => ({
      ...connection,
      requestedStartPosition: [...connection.startPosition],
      startPosition: vectorTuple(projectRequired(
        query,
        connection.startPosition,
        queryHalfExtents,
        Math.max(maximumProjectionDistance, connection.radius),
        `${connection.id}:start`,
      ).point),
      requestedEndPosition: [...connection.endPosition],
      endPosition: vectorTuple(projectRequired(
        query,
        connection.endPosition,
        queryHalfExtents,
        Math.max(maximumProjectionDistance, connection.radius),
        `${connection.id}:end`,
      ).point),
    }));
    const projectedSpawn = projectRequired(
      query,
      input.spawn.position,
      queryHalfExtents,
      maximumProjectionDistance,
      input.spawn.id,
    );
    const componentProjectionHalfExtents = {
      x: Math.max(input.build.cellSize * 0.5, 0.01),
      y: Math.max(input.build.cellHeight * 2, 0.02),
      z: Math.max(input.build.cellSize * 0.5, 0.01),
    };
    const unreachableComponentRepresentatives = triangleComponents
      .map((component) => component.representative)
      .filter((representative) => {
        const projected = query.findClosestPoint(toVector(representative), {
          halfExtents: componentProjectionHalfExtents,
        });
        if (!projected.success) return true;
        return !completePath(
          query,
          projectedSpawn.point,
          projected.point,
          maximumProjectionDistance,
          queryHalfExtents,
        ) || !completePath(
          query,
          projected.point,
          projectedSpawn.point,
          maximumProjectionDistance,
          queryHalfExtents,
        );
      });
    const componentCount = 1 + unreachableComponentRepresentatives.length;
    const destinations = input.destinations.map((destination) => {
      const projected = projectOptional(
        query,
        destination.position,
        queryHalfExtents,
        maximumProjectionDistance,
      );
      const outboundRoute = projected
        ? completePath(
          query,
          projectedSpawn.point,
          projected.point,
          maximumProjectionDistance,
          queryHalfExtents,
        )
        : null;
      const inboundRoute = projected
        ? completePath(
          query,
          projected.point,
          projectedSpawn.point,
          maximumProjectionDistance,
          queryHalfExtents,
        )
        : null;
      return {
        id: destination.id,
        requestedPosition: [...destination.position],
        projectedPosition: projected ? vectorTuple(projected.point) : null,
        reachable: Boolean(outboundRoute && inboundRoute),
        outboundReachable: Boolean(outboundRoute),
        inboundReachable: Boolean(inboundRoute),
        outboundPathPointCount: outboundRoute?.length ?? 0,
        inboundPathPointCount: inboundRoute?.length ?? 0,
      };
    });
    const unreachableDestinationIds = destinations
      .filter((destination) => !destination.reachable)
      .map((destination) => destination.id);
    const validation = {
      passed: componentCount === 1 && unreachableDestinationIds.length === 0,
      componentCount,
      rawTriangleComponentCount: triangleComponents.length,
      spawnProjectedDistance: round(distance3(input.spawn.position, projectedSpawn.point)),
      destinationCount: destinations.length,
      unreachableDestinationIds,
      destinations,
    };
    if (!validation.passed) {
      throw new NavigationBuildError(
        "NAVIGATION_ACCEPTANCE_FAILED",
        "Generated navigation did not pass whole-scene reachability acceptance",
        validation,
      );
    }

    const binary = exportNavMesh(navMesh);
    const collisionSemantics = input.collisionSemantics
      ? canonicalCollisionSemantics(input.collisionSemantics)
      : null;
    const structuralGeometry = input.structuralGeometry
      ? canonicalStructuralGeometry(input.structuralGeometry)
      : null;
    if (collisionSemantics?.provenance === "operator_reviewed" && !structuralGeometry) {
      throw new NavigationBuildError(
        "INVALID_STRUCTURAL_AUTHORING",
        "Operator-reviewed v7 collision requires explicit floor, ceiling, and barrier metadata",
      );
    }
    const dynamicBarriers = collisionSemantics
      ? canonicalDynamicBarriers(input.dynamicBarriers ?? [])
      : [];
    if (structuralGeometry) {
      const frozenDynamicIds = structuralGeometry.dynamicBarrierIds;
      if (
        frozenDynamicIds.length !== dynamicBarriers.length ||
        frozenDynamicIds.some((id, index) => id !== dynamicBarriers[index]?.id)
      ) {
        throw new NavigationBuildError(
          "INVALID_STRUCTURAL_AUTHORING",
          "Explicit structural authoring and dynamic barrier metadata do not match",
        );
      }
    }
    return {
      schemaVersion: collisionSemantics
        ? frozenTraversals.length
          ? AUTHORED_TRAVERSAL_SCHEMA_VERSION
          : STRUCTURAL_SCHEMA_VERSION
        : LEGACY_SCHEMA_VERSION,
      generator: {
        name: "recast-navigation-js",
        version: GENERATOR_VERSION,
        nativeRecastCommit: NATIVE_RECAST_COMMIT,
        mode: "tiled",
      },
      coordinateSystem: {
        handedness: "right",
        upAxis: "Y",
        worldUnit: input.source.worldUnit === "scene_units" ? "scene_units" : "metres",
        triangleWinding: "counter-clockwise",
      },
      source: {
        assetId: input.source.assetId,
        sha256: input.source.sha256,
        authoringHash: input.source.authoringHash,
        triangleCount: input.indices.length / 3,
        vertexCount: input.positions.length / 3,
      },
      ...(collisionSemantics
        ? {
            collisionSemantics,
            dynamicBarriers,
            ...(structuralGeometry ? { structuralGeometry } : {}),
            movementProfiles: movementProfiles(
              collisionSemantics.includedGroups,
              input.agent,
              artifactBounds,
            ),
          }
        : {}),
      agent: { ...input.agent },
      build: { ...input.build },
      recastConfig,
      bounds: artifactBounds,
      spawn: {
        id: input.spawn.id,
        requestedPosition: [...input.spawn.position],
        projectedPosition: vectorTuple(projectedSpawn.point),
      },
      offMeshConnections: frozenTraversals,
      navMesh: {
        clearanceApplied: true,
        vertices,
        indices: [...debugIndices],
      },
      detour: {
        format: "recast-navigation-js-export-v1",
        byteLength: binary.byteLength,
        bytesBase64: bytesToBase64(binary),
      },
      validation,
    };
  } finally {
    query.destroy();
    navMesh.destroy();
  }
}

export async function importNavigationArtifact(artifact) {
  if (!artifact || ![
    LEGACY_SCHEMA_VERSION,
    STRUCTURAL_SCHEMA_VERSION,
    LEGACY_AUTHORED_TRAVERSAL_SCHEMA_VERSION,
    AUTHORED_TRAVERSAL_SCHEMA_VERSION,
  ].includes(
    artifact.schemaVersion,
  )) {
    throw new NavigationBuildError(
      "UNSUPPORTED_NAVIGATION_ARTIFACT",
      "Navigation artifact is missing or uses an unsupported schema",
    );
  }
  if (artifact.generator?.version !== GENERATOR_VERSION) {
    throw new NavigationBuildError(
      "NAVIGATION_BINDING_VERSION_MISMATCH",
      `Artifact requires recast-navigation-js ${artifact.generator?.version ?? "unknown"}`,
    );
  }
  await ensureInitialized();
  const { navMesh } = importNavMesh(base64ToBytes(artifact.detour.bytesBase64));
  const query = new NavMeshQuery(navMesh, { maxNodes: 4096 });
  const halfExtents = {
    x: Math.max(artifact.agent.radius * 2, artifact.build.cellSize * 2),
    y: Math.max(artifact.agent.height, artifact.build.cellHeight * 2),
    z: Math.max(artifact.agent.radius * 2, artifact.build.cellSize * 2),
  };
  return {
    path(from, to) {
      const start = query.findClosestPoint(toVector(from), { halfExtents });
      const end = query.findClosestPoint(toVector(to), { halfExtents });
      if (!start.success || !end.success) return null;
      const result = completePath(
        query,
        start.point,
        end.point,
        artifact.build.cellSize * 3,
        halfExtents,
      );
      return result?.map(vectorTuple) ?? null;
    },
    moveAlongSurface(from, desired) {
      const start = query.findClosestPoint(toVector(from), { halfExtents });
      if (!start.success) return null;
      const result = query.moveAlongSurface(start.polyRef, start.point, toVector(desired));
      return result.success ? vectorTuple(result.resultPosition) : null;
    },
    project(position) {
      const result = query.findClosestPoint(toVector(position), { halfExtents });
      return result.success ? vectorTuple(result.point) : null;
    },
    destroy() {
      query.destroy();
      navMesh.destroy();
    },
  };
}

function ensureInitialized() {
  initialization ??= init();
  return initialization;
}

function recastConfigFor(agent, build) {
  const walkableRadius = Math.ceil(agent.radius / build.cellSize);
  const minimumRegionSize = build.minimumRegionSizeVoxels ?? 8;
  const mergeRegionSize = build.mergeRegionSizeVoxels ?? 20;
  return {
    cs: build.cellSize,
    ch: build.cellHeight,
    tileSize: build.tileSize,
    // Tiled Recast requires radius padding around every tile; zero creates
    // false seams and is especially destructive at narrow doorways.
    borderSize: walkableRadius + 3,
    walkableSlopeAngle: agent.maxSlopeDegrees,
    walkableHeight: Math.ceil(agent.height / build.cellHeight),
    walkableClimb: Math.floor(agent.maxClimb / build.cellHeight),
    walkableRadius,
    maxEdgeLen: build.maxEdgeLengthVoxels ?? 12,
    maxSimplificationError: build.maxSimplificationError ?? 1.3,
    minRegionArea: minimumRegionSize * minimumRegionSize,
    mergeRegionArea: mergeRegionSize * mergeRegionSize,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
    chunkyTriMeshTrisPerChunk: 256,
    buildBvTree: true,
  };
}

function validateBuildInput(input) {
  if (!input || !Array.isArray(input.positions) || !Array.isArray(input.indices)) {
    throw new NavigationBuildError("INVALID_COLLISION_GEOMETRY", "Flat positions and indices are required");
  }
  if (input.positions.length < 9 || input.positions.length % 3 !== 0) {
    throw new NavigationBuildError("INVALID_COLLISION_GEOMETRY", "Collision positions must contain complete vertices");
  }
  if (input.indices.length < 3 || input.indices.length % 3 !== 0) {
    throw new NavigationBuildError("INVALID_COLLISION_GEOMETRY", "Collision indices must contain complete triangles");
  }
  if (input.positions.some((value) => !Number.isFinite(value))) {
    throw new NavigationBuildError("INVALID_COLLISION_GEOMETRY", "Collision positions must be finite");
  }
  const vertexCount = input.positions.length / 3;
  if (input.indices.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= vertexCount)) {
    throw new NavigationBuildError("INVALID_COLLISION_GEOMETRY", "Collision indices are outside the vertex array");
  }
  for (const [name, value, min, max] of [
    ["agent.radius", input.agent?.radius, 0.05, 2],
    ["agent.height", input.agent?.height, 0.5, 4],
    ["agent.eyeHeight", input.agent?.eyeHeight, 0.3, 3],
    ["agent.maxClimb", input.agent?.maxClimb, 0, 0.5],
    ["agent.maxSlopeDegrees", input.agent?.maxSlopeDegrees, 0, 89],
    ["build.cellSize", input.build?.cellSize, 0.02, 1],
    ["build.cellHeight", input.build?.cellHeight, 0.01, 0.5],
    ["build.tileSize", input.build?.tileSize, 16, 1024],
  ]) {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new NavigationBuildError("INVALID_NAVIGATION_CONFIG", `${name} must be between ${min} and ${max}`);
    }
  }
  if (!input.spawn || !point3(input.spawn.position) || typeof input.spawn.id !== "string") {
    throw new NavigationBuildError("INVALID_NAVIGATION_CONFIG", "An authored opening spawn is required");
  }
  if (!Array.isArray(input.destinations) || input.destinations.some((value) =>
    !value || typeof value.id !== "string" || !point3(value.position))) {
    throw new NavigationBuildError("INVALID_NAVIGATION_CONFIG", "Every destination needs an id and finite position");
  }
  canonicalOffMeshConnections(input.offMeshConnections ?? [], input.agent);
  if (input.offMeshConnections?.length && !input.collisionSemantics) {
    throw new NavigationBuildError(
      "AUTHORED_TRAVERSAL_REQUIRES_STRUCTURAL_COLLISION",
      "Elevators, ladders, and moving platforms require a reviewed structural collision shell",
    );
  }
  if (input.source?.sha256 && !/^[a-f0-9]{64}$/i.test(input.source.sha256)) {
    throw new NavigationBuildError("INVALID_COLLISION_GEOMETRY", "Collision source hash must be SHA-256");
  }
  if (input.source?.authoringHash && !/^[a-f0-9]{64}$/i.test(input.source.authoringHash)) {
    throw new NavigationBuildError(
      "INVALID_NAVIGATION_CONFIG",
      "Navigation authoring hash must be SHA-256",
    );
  }
  if (input.collisionSemantics) canonicalCollisionSemantics(input.collisionSemantics);
}

function canonicalCollisionSemantics(value) {
  const includedGroups = Array.isArray(value?.includedGroups)
    ? [...new Set(value.includedGroups)]
    : [];
  const ignoredGroups = Array.isArray(value?.ignoredGroups)
    ? [...new Set(value.ignoredGroups)]
    : [];
  if (
    value?.schemaVersion !== "spatial-structural-collision-v1" ||
    !["operator_reviewed", "registered_metric_mesh"].includes(value?.provenance) ||
    value?.structuralShellComplete !== true ||
    !sameStringSet(includedGroups, [
      "STRUCTURAL_FLOOR",
      "STRUCTURAL_BARRIER",
      ...(includedGroups.includes("DYNAMIC_BARRIER") ? ["DYNAMIC_BARRIER"] : []),
    ]) ||
    !sameStringSet(ignoredGroups, ["FURNITURE", "TRIGGER"])
  ) {
    throw new NavigationBuildError(
      "INVALID_COLLISION_SEMANTICS",
      "V7 requires a complete reviewed structural floor/barrier shell that explicitly ignores furniture",
    );
  }
  return {
    schemaVersion: "spatial-structural-collision-v1",
    provenance: value.provenance,
    structuralShellComplete: true,
    includedGroups,
    ignoredGroups,
  };
}

function sameStringSet(actual, expected) {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}

function canonicalDynamicBarriers(values) {
  if (!Array.isArray(values)) {
    throw new NavigationBuildError(
      "INVALID_DYNAMIC_BARRIERS",
      "Structural dynamic barriers must be an array",
    );
  }
  const ids = new Set();
  return values.map((value) => {
    const id = typeof value?.id === "string" ? value.id.trim() : "";
    const min = pointTuple(value?.min);
    const max = pointTuple(value?.max);
    if (!id || ids.has(id) || !min || !max ||
      min.some((coordinate, axis) => coordinate >= max[axis]) ||
      typeof value?.defaultActive !== "boolean") {
      throw new NavigationBuildError(
        "INVALID_DYNAMIC_BARRIERS",
        `Dynamic barrier ${id || "unknown"} has invalid identity, bounds, or state`,
      );
    }
    ids.add(id);
    return { id, min, max, defaultActive: value.defaultActive };
  });
}

function canonicalStructuralGeometry(value) {
  if (!value || typeof value !== "object" ||
    value.schemaVersion !== "authored-structural-collision-v2") {
    throw new NavigationBuildError(
      "INVALID_STRUCTURAL_AUTHORING",
      "Structural geometry review metadata is missing or unsupported",
    );
  }
  const connectorSurfaces = canonicalConnectorSurfaces(value.connectorSurfaces ?? []);
  return {
    schemaVersion: "authored-structural-collision-v2",
    floorRectangles: canonicalHorizontalRectangles(value.floorRectangles, "floor"),
    ceilingRectangles: canonicalHorizontalRectangles(value.ceilingRectangles, "ceiling"),
    barrierSegments: canonicalBarrierSegments(value.barrierSegments),
    ...(connectorSurfaces.length ? { connectorSurfaces } : {}),
    dynamicBarrierIds: canonicalIds(value.dynamicBarrierIds ?? [], "dynamic barrier"),
  };
}

function pointTuple(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? value.map(Number)
    : null;
}

function pointTuple2(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
    ? value.map(Number)
    : null;
}

function movementProfiles(collisionGroups, agent, bounds) {
  const recoveryBounds = [
    [
      bounds[0][0] - agent.radius,
      bounds[0][1] - agent.height,
      bounds[0][2] - agent.radius,
    ],
    [
      bounds[1][0] + agent.radius,
      bounds[1][1] + agent.height,
      bounds[1][2] + agent.radius,
    ],
  ];
  const planarInput = {
    forward: ["KeyW", "ArrowUp"],
    backward: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    boost: ["ShiftLeft", "ShiftRight"],
  };
  return {
    defaultMode: "walk",
    supportedModes: ["walk", "fly", "noclip"],
    walk: {
      shape: "capsule",
      gravity: true,
      groundSnap: true,
      collisionGroups: [...collisionGroups],
      input: planarInput,
      speedUnitsPerSecond: agent.maxSpeed,
      boostMultiplier: 3,
      recoveryBounds,
    },
    fly: {
      shape: "sphere",
      gravity: false,
      groundSnap: false,
      collisionGroups: [...collisionGroups],
      input: {
        ...planarInput,
        ascend: ["Space", "KeyE"],
        descend: ["KeyC", "KeyQ"],
      },
      speedUnitsPerSecond: agent.maxSpeed,
      boostMultiplier: 3,
      recoveryBounds,
    },
    noclip: {
      operatorOnly: true,
      shape: "none",
      gravity: false,
      groundSnap: false,
      collisionGroups: [],
      input: {
        ...planarInput,
        ascend: ["Space", "KeyE"],
        descend: ["KeyC", "KeyQ"],
      },
      speedUnitsPerSecond: agent.maxSpeed,
      boostMultiplier: 3,
      recoveryBounds,
    },
  };
}

const COLLISION_GROUPS = new Set([
  "STRUCTURAL_FLOOR",
  "STRUCTURAL_BARRIER",
  "FURNITURE",
  "DYNAMIC_BARRIER",
  "TRIGGER",
]);

function toOffMeshConnection(connection) {
  return {
    startPosition: toVector(connection.startPosition),
    endPosition: toVector(connection.endPosition),
    radius: connection.radius,
    bidirectional: connection.bidirectional,
    area: connection.area ?? 0,
    flags: connection.flags ?? 1,
    userId: connection.userId ?? 0,
  };
}

function canonicalOffMeshConnections(values, agent) {
  if (!Array.isArray(values)) {
    throw new NavigationBuildError(
      "INVALID_AUTHORED_TRAVERSAL",
      "Authored traversal links must be an array",
    );
  }
  const ids = new Set();
  return values.map((value) => {
    const id = typeof value?.id === "string" ? value.id.trim() : "";
    const traversalKind = value?.traversalKind;
    const label = typeof value?.label === "string" ? value.label.trim() : "";
    const startPosition = point3(value?.startPosition) ? [...value.startPosition] : null;
    const endPosition = point3(value?.endPosition) ? [...value.endPosition] : null;
    const controlPoints = Array.isArray(value?.controlPoints) &&
      value.controlPoints.every(point3)
      ? value.controlPoints.map((point) => [...point])
      : null;
    const radius = Number(value?.radius);
    const speedUnitsPerSecond = Number(value?.speedUnitsPerSecond);
    const reviewedPurpose = typeof value?.reviewedPurpose === "string"
      ? value.reviewedPurpose.trim()
      : "";
    const evidenceAssetId = typeof value?.evidenceReceipt?.assetId === "string"
      ? value.evidenceReceipt.assetId.trim()
      : "";
    const evidenceSha256 = typeof value?.evidenceReceipt?.sha256 === "string"
      ? value.evidenceReceipt.sha256.trim().toLowerCase()
      : "";
    const evidenceManifestId = typeof value?.evidenceReceipt?.manifestId === "string"
      ? value.evidenceReceipt.manifestId.trim()
      : "";
    const evidenceManifestSha256 = typeof value?.evidenceReceipt?.manifestSha256 === "string"
      ? value.evidenceReceipt.manifestSha256.trim().toLowerCase()
      : "";
    const evidenceAdapter = typeof value?.evidenceReceipt?.adapter === "string"
      ? value.evidenceReceipt.adapter.trim()
      : "";
    const evidenceReviewGeneration = Number(value?.evidenceReceipt?.reviewGeneration);
    const evidenceRegistrationSha256 = typeof value?.evidenceReceipt?.registrationSha256 === "string"
      ? value.evidenceReceipt.registrationSha256.trim().toLowerCase()
      : "";
    const evidenceSourceToWorld = sourceToWorldTransform(value?.evidenceReceipt?.sourceToWorld);
    const evidenceSourcePath = Array.isArray(value?.evidenceReceipt?.sourcePath) &&
      value.evidenceReceipt.sourcePath.length >= 2 &&
      value.evidenceReceipt.sourcePath.every(point3)
      ? value.evidenceReceipt.sourcePath.map((point) => [...point])
      : null;
    if (!id || ids.has(id)) {
      throw new NavigationBuildError(
        "INVALID_AUTHORED_TRAVERSAL",
        `Authored traversal id ${id || "unknown"} is missing or duplicated`,
      );
    }
    if (!label) {
      throw new NavigationBuildError(
        "INVALID_AUTHORED_TRAVERSAL",
        `Authored traversal ${id} requires a visible label`,
      );
    }
    if (!["elevator", "ladder", "moving_platform"].includes(traversalKind)) {
      throw new NavigationBuildError(
        "INVALID_AUTHORED_TRAVERSAL",
        `Authored traversal ${id} has an unsupported traversal kind`,
      );
    }
    if (!startPosition || !endPosition || !controlPoints) {
      throw new NavigationBuildError(
        "INVALID_AUTHORED_TRAVERSAL",
        `Authored traversal ${id} requires finite start, control, and end points`,
      );
    }
    const path = [startPosition, ...controlPoints, endPosition];
    if (path.some((point, index) => index > 0 && distance3(point, path[index - 1]) <= 0)) {
      throw new NavigationBuildError(
        "INVALID_AUTHORED_TRAVERSAL",
        `Authored traversal ${id} contains a zero-length path segment`,
      );
    }
    if (!Number.isFinite(radius) || radius < Number(agent?.radius)) {
      throw new NavigationBuildError(
        "INVALID_AUTHORED_TRAVERSAL",
        `Authored traversal ${id} radius is below the navigation agent radius: limit=${agent?.radius}, asked=${value?.radius}`,
      );
    }
    if (!Number.isFinite(speedUnitsPerSecond) || speedUnitsPerSecond <= 0) {
      throw new NavigationBuildError(
        "INVALID_AUTHORED_TRAVERSAL",
        `Authored traversal ${id} speedUnitsPerSecond must be positive: asked=${value?.speedUnitsPerSecond}`,
      );
    }
    if (typeof value?.bidirectional !== "boolean" || !reviewedPurpose) {
      throw new NavigationBuildError(
        "INVALID_AUTHORED_TRAVERSAL",
        `Authored traversal ${id} requires directionality and a reviewed purpose`,
      );
    }
    if (
      !evidenceAssetId || !/^[a-f0-9]{64}$/i.test(evidenceSha256) ||
      !evidenceManifestId || !/^[a-f0-9]{64}$/i.test(evidenceManifestSha256) ||
      !evidenceAdapter || !Number.isSafeInteger(evidenceReviewGeneration) ||
      evidenceReviewGeneration < 1 ||
      !/^[a-f0-9]{64}$/i.test(evidenceRegistrationSha256) || !evidenceSourceToWorld ||
      !evidenceSourcePath
    ) {
      throw new NavigationBuildError(
        "INVALID_AUTHORED_TRAVERSAL",
        `Authored traversal ${id} requires an immutable evidence asset, accepted capture manifest, and numeric capture-to-scene registration receipt`,
      );
    }
    const derivedWorldPath = evidenceSourcePath.map((point) =>
      transformSourcePoint(point, evidenceSourceToWorld)
    );
    if (JSON.stringify(derivedWorldPath) !== JSON.stringify(path)) {
      throw new NavigationBuildError(
        "INVALID_AUTHORED_TRAVERSAL",
        `Authored traversal ${id} world path does not match its frozen capture-frame path and registration`,
      );
    }
    for (const [name, raw, minimum, maximum] of [
      ["area", value?.area ?? 0, 0, 63],
      ["flags", value?.flags ?? 1, 1, 65535],
      ["userId", value?.userId ?? 0, 0, 0xffffffff],
    ]) {
      if (!Number.isSafeInteger(raw) || raw < minimum || raw > maximum) {
        throw new NavigationBuildError(
          "INVALID_AUTHORED_TRAVERSAL",
          `Authored traversal ${id} ${name} must be an integer between ${minimum} and ${maximum}: asked=${raw}`,
        );
      }
    }
    ids.add(id);
    return {
      id,
      traversalKind,
      label,
      startPosition,
      endPosition,
      controlPoints,
      radius,
      bidirectional: value.bidirectional,
      speedUnitsPerSecond,
      area: value.area ?? 0,
      flags: value.flags ?? 1,
      userId: value.userId ?? 0,
      reviewedPurpose,
      evidenceReceipt: {
        assetId: evidenceAssetId,
        sha256: evidenceSha256,
        manifestId: evidenceManifestId,
        manifestSha256: evidenceManifestSha256,
        adapter: evidenceAdapter,
        reviewGeneration: evidenceReviewGeneration,
        registrationSha256: evidenceRegistrationSha256,
        sourceToWorld: evidenceSourceToWorld,
        sourcePath: evidenceSourcePath,
      },
    };
  });
}

function projectRequired(query, position, halfExtents, maximumDistance, id) {
  const result = projectOptional(query, position, halfExtents, maximumDistance);
  if (!result) {
    throw new NavigationBuildError(
      "SPAWN_PROJECTION_FAILED",
      `Spawn ${id} cannot be projected onto the generated navmesh`,
      { spawnId: id, position, maximumDistance },
    );
  }
  return result;
}

function projectOptional(query, position, halfExtents, maximumDistance) {
  const result = query.findClosestPoint(toVector(position), { halfExtents });
  if (!result.success || distance3(position, result.point) > maximumDistance) return null;
  return result;
}

function completePath(query, start, end, tolerance, halfExtents) {
  const result = query.computePath(start, end, {
    halfExtents,
    maxPathPolys: 4096,
    maxStraightPathPoints: 4096,
  });
  if (!result.success || result.path.length < 1) return null;
  const last = result.path[result.path.length - 1];
  return last && distance3(last, end) <= Math.max(tolerance, 0.05) ? result.path : null;
}

function collectTriangleComponents(vertices, indices) {
  const triangleCount = indices.length / 3;
  const parents = Array.from({ length: triangleCount }, (_, index) => index);
  const edges = new Map();
  const find = (value) => {
    let current = value;
    while (parents[current] !== current) {
      parents[current] = parents[parents[current]];
      current = parents[current];
    }
    return current;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const triangleIndices = indices.slice(triangle * 3, triangle * 3 + 3);
    for (let edge = 0; edge < 3; edge += 1) {
      const first = vertexKey(vertices[triangleIndices[edge]]);
      const second = vertexKey(vertices[triangleIndices[(edge + 1) % 3]]);
      const key = first < second ? `${first}|${second}` : `${second}|${first}`;
      const owner = edges.get(key);
      if (owner === undefined) edges.set(key, triangle);
      else union(owner, triangle);
    }
  }
  const components = new Map();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const root = find(triangle);
    const existing = components.get(root);
    if (existing) {
      existing.triangleCount += 1;
      continue;
    }
    const triangleIndices = indices.slice(triangle * 3, triangle * 3 + 3);
    components.set(root, {
      triangleCount: 1,
      representative: [0, 1, 2].map((axis) =>
        triangleIndices.reduce((sum, index) => sum + vertices[index][axis], 0) / 3
      ),
    });
  }
  return [...components.values()];
}

function vertexKey(vertex) {
  return vertex.map((value) => Math.round(value * 100_000)).join(",");
}

function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  return [min, max];
}

function tuples(values) {
  const result = [];
  for (let index = 0; index < values.length; index += 3) {
    result.push([values[index], values[index + 1], values[index + 2]].map(round));
  }
  return result;
}

function point3(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function sourceToWorldTransform(value) {
  if (!value || typeof value !== "object") return null;
  if (
    !["Y", "Z"].includes(value.sourceUpAxis) || value.worldUnit !== "metres" ||
    !Number.isFinite(value.metresPerSourceUnit) || value.metresPerSourceUnit <= 0 ||
    !Number.isFinite(value.yawDegrees) || !point3(value.translationMetres)
  ) return null;
  return {
    sourceUpAxis: value.sourceUpAxis,
    worldUnit: "metres",
    metresPerSourceUnit: value.metresPerSourceUnit,
    yawDegrees: value.yawDegrees,
    translationMetres: [...value.translationMetres],
  };
}

function transformSourcePoint(point, transform) {
  const normalized = transform.sourceUpAxis === "Z"
    ? [point[0], point[2], -point[1]]
    : [...point];
  const scaled = normalized.map((coordinate) =>
    coordinate * transform.metresPerSourceUnit
  );
  const radians = transform.yawDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotated = [
    scaled[0] * cosine + scaled[2] * sine,
    scaled[1],
    -scaled[0] * sine + scaled[2] * cosine,
  ];
  return rotated.map((coordinate, index) =>
    cleanZero(coordinate + transform.translationMetres[index])
  );
}

function cleanZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function toVector(value) {
  return { x: Number(value[0]), y: Number(value[1]), z: Number(value[2]) };
}

function vectorTuple(value) {
  return [round(value.x), round(value.y), round(value.z)];
}

function distance3(first, second) {
  const firstValues = Array.isArray(first) ? first : [first.x, first.y, first.z];
  const secondValues = Array.isArray(second) ? second : [second.x, second.y, second.z];
  return Math.hypot(
    firstValues[0] - secondValues[0],
    firstValues[1] - secondValues[1],
    firstValues[2] - secondValues[2],
  );
}

function round(value) {
  const result = Math.round(Number(value) * 1_000_000) / 1_000_000;
  return Object.is(result, -0) ? 0 : result;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
