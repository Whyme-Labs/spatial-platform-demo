import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Earcut } from "three/src/extras/Earcut.js";

/**
 * Turns reviewed floor and connector polygons into a deliberately simple
 * navigation collision surface. Appearance meshes and inferred Gaussian
 * occupancy never enter this path.
 */
export function triangulateAuthoredSurfaces(surfaces) {
  if (!Array.isArray(surfaces) || surfaces.length === 0) {
    throw new Error("At least one authored collision surface is required");
  }
  const ids = new Set();
  const positions = [];
  const indices = [];
  const sourceSurfaceIds = [];
  for (const surface of surfaces) {
    if (!surface || typeof surface.id !== "string" || !surface.id.trim()) {
      throw new Error("Every authored collision surface requires a stable id");
    }
    if (ids.has(surface.id)) throw new Error(`Duplicate authored collision surface id: ${surface.id}`);
    ids.add(surface.id);
    const points = normalizeRing(surface.points, surface.id);
    const offset = positions.length / 3;
    positions.push(...points.flat());
    const triangles = Earcut.triangulate(points.flatMap((point) => [point[0], point[2]]), [], 2);
    if (triangles.length < 3) {
      throw new Error(`Authored collision surface ${surface.id} could not be triangulated`);
    }
    for (let index = 0; index < triangles.length; index += 3) {
      let first = offset + triangles[index];
      let second = offset + triangles[index + 1];
      let third = offset + triangles[index + 2];
      const normalY = triangleNormalY(positions, first, second, third);
      if (Math.abs(normalY) <= 1e-10) continue;
      if (normalY < 0) [second, third] = [third, second];
      indices.push(first, second, third);
      sourceSurfaceIds.push(surface.id);
    }
  }
  if (indices.length < 3) throw new Error("Authored collision contains no non-degenerate triangles");
  return { positions, indices, sourceSurfaceIds };
}

export function buildAuthoredCollisionGlb(surfaces, metadata = {}) {
  const geometry = triangulateAuthoredSurfaces(surfaces);
  return serializeAuthoredCollisionGlb(geometry, metadata);
}

export function buildAuthoredStructuralCollisionGlb(config, metadata = {}) {
  if (config?.schemaVersion === "authored-structural-collision-v2") {
    return buildExplicitStructuralCollisionGlb(config, metadata);
  }
  throw new Error(
    "authored-structural-collision-v1 is retired; migrate to v2 explicit floor, ceiling, and wall surfaces",
  );
}

function buildExplicitStructuralCollisionGlb(config, metadata) {
  const provenance = config?.provenance;
  if (!["operator_reviewed", "registered_metric_mesh"].includes(provenance)) {
    throw new Error("Structural collision requires reviewed provenance");
  }
  const ids = new Set();
  const floors = normalizeHorizontalRectangles(config?.floorRectangles, "floor", ids);
  const ceilings = normalizeHorizontalRectangles(config?.ceilingRectangles, "ceiling", ids);
  const barriers = normalizeBarrierSegments(config?.barrierSegments, ids);
  if (!floors.length || !ceilings.length || !barriers.length) {
    throw new Error("V2 structural collision requires explicit floors, ceilings, and barriers");
  }
  const floorGeometry = horizontalRectanglesGeometry(floors, false);
  const barrierGeometry = emptyGeometry();
  appendGeometry(barrierGeometry, horizontalRectanglesGeometry(ceilings, true));
  appendGeometry(barrierGeometry, barrierSegmentsGeometry(barriers));
  const furniture = boxesGeometry(config?.furnitureBoxes ?? [], "furniture");
  const dynamicBarriers = normalizeDynamicBarriers(config?.dynamicBarrierBoxes ?? [], ids);
  const semantics = {
    schemaVersion: "spatial-structural-collision-v1",
    provenance,
    structuralShellComplete: true,
    includedGroups: [
      "STRUCTURAL_FLOOR",
      "STRUCTURAL_BARRIER",
      ...(dynamicBarriers.length ? ["DYNAMIC_BARRIER"] : []),
    ],
    ignoredGroups: ["FURNITURE", "TRIGGER"],
  };
  return serializeGroupedCollisionGlb([
    { group: "STRUCTURAL_FLOOR", geometry: floorGeometry },
    { group: "STRUCTURAL_BARRIER", geometry: barrierGeometry },
    ...(furniture.indices.length ? [{ group: "FURNITURE", geometry: furniture }] : []),
  ], {
    generator: metadata.generator ?? "Spatial Studio authored-structural-collision-v2",
    source: metadata.source ?? null,
    semantics,
    authoring: {
      schemaVersion: "authored-structural-collision-v2",
      floorRectangles: floors,
      ceilingRectangles: ceilings,
      barrierSegments: barriers,
      dynamicBarrierIds: dynamicBarriers.map((barrier) => barrier.id),
    },
    dynamicBarriers,
  });
}

function serializeAuthoredCollisionGlb(geometry, metadata = {}) {
  const positionBytes = typedBytes(new Float32Array(geometry.positions));
  const indexBytes = typedBytes(new Uint32Array(geometry.indices));
  const binary = new Uint8Array(positionBytes.byteLength + indexBytes.byteLength);
  binary.set(positionBytes);
  binary.set(indexBytes, positionBytes.byteLength);
  const document = gltfDocument(geometry, positionBytes.byteLength, binary.byteLength, metadata);
  const encodedJson = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = alignedLength(encodedJson.byteLength);
  const binaryLength = alignedLength(binary.byteLength);
  const output = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(encodedJson, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}

function serializeGroupedCollisionGlb(groups, metadata) {
  const binaryParts = [];
  const bufferViews = [];
  const accessors = [];
  const meshes = [];
  const nodes = [];
  let byteOffset = 0;
  for (const { group, geometry } of groups) {
    if (!geometry.positions.length || !geometry.indices.length) continue;
    const positionBytes = typedBytes(new Float32Array(geometry.positions));
    const indexBytes = typedBytes(new Uint32Array(geometry.indices));
    const positionView = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: positionBytes.byteLength,
      target: 34962,
    });
    binaryParts.push(positionBytes);
    byteOffset += positionBytes.byteLength;
    const indexView = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: indexBytes.byteLength,
      target: 34963,
    });
    binaryParts.push(indexBytes);
    byteOffset += indexBytes.byteLength;
    const axes = [0, 1, 2].map((axis) =>
      geometry.positions.filter((_, index) => index % 3 === axis));
    const positionAccessor = accessors.length;
    accessors.push({
      bufferView: positionView,
      componentType: 5126,
      count: geometry.positions.length / 3,
      type: "VEC3",
      min: axes.map((values) => Math.min(...values)),
      max: axes.map((values) => Math.max(...values)),
    });
    const indexAccessor = accessors.length;
    accessors.push({
      bufferView: indexView,
      componentType: 5125,
      count: geometry.indices.length,
      type: "SCALAR",
      min: [Math.min(...geometry.indices)],
      max: [Math.max(...geometry.indices)],
    });
    const meshIndex = meshes.length;
    meshes.push({
      name: group,
      primitives: [{
        attributes: { POSITION: positionAccessor },
        indices: indexAccessor,
        mode: 4,
      }],
    });
    nodes.push({
      name: group,
      mesh: meshIndex,
      extras: { collisionGroup: group },
    });
  }
  if (!nodes.length) throw new Error("Structural collision contains no geometry");
  const binary = new Uint8Array(byteOffset);
  let destinationOffset = 0;
  for (const part of binaryParts) {
    binary.set(part, destinationOffset);
    destinationOffset += part.byteLength;
  }
  const document = {
    asset: {
      version: "2.0",
      generator: metadata.generator,
      extras: {
        spatialCollision: metadata.semantics,
        source: metadata.source,
        volumeIds: metadata.volumeIds,
        authoring: metadata.authoring,
        dynamicBarriers: metadata.dynamicBarriers,
      },
    },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.byteLength }],
  };
  return serializeGlbDocument(document, binary);
}

function normalizeHorizontalRectangles(values, label, ids) {
  if (!Array.isArray(values)) throw new Error(`${label} rectangles must be an array`);
  return values.map((value) => {
    const id = stableUniqueId(value, `${label} rectangle`, ids);
    const min = finitePoint2(value?.min);
    const max = finitePoint2(value?.max);
    const elevation = Number(value?.elevation);
    if (!min || !max || !Number.isFinite(elevation) ||
      min.some((coordinate, axis) => coordinate >= max[axis])) {
      throw new Error(`${label} rectangle ${id} has invalid bounds`);
    }
    return { id, min, max, elevation };
  });
}

function normalizeBarrierSegments(values, ids) {
  if (!Array.isArray(values)) throw new Error("barrier segments must be an array");
  return values.map((value) => {
    const id = stableUniqueId(value, "barrier segment", ids);
    const start = finitePoint2(value?.start);
    const end = finitePoint2(value?.end);
    const minY = Number(value?.minY);
    const maxY = Number(value?.maxY);
    if (!start || !end || !Number.isFinite(minY) || !Number.isFinite(maxY) ||
      minY >= maxY || Math.hypot(end[0] - start[0], end[1] - start[1]) <= 1e-6) {
      throw new Error(`barrier segment ${id} has invalid geometry`);
    }
    return { id, start, end, minY, maxY };
  });
}

function normalizeDynamicBarriers(values, ids) {
  if (!Array.isArray(values)) throw new Error("dynamic barrier boxes must be an array");
  return values.map((value) => {
    const id = stableUniqueId(value, "dynamic barrier", ids);
    const min = finitePoint(value?.min);
    const max = finitePoint(value?.max);
    if (!min || !max || min.some((coordinate, axis) => coordinate >= max[axis]) ||
      typeof value?.defaultActive !== "boolean") {
      throw new Error(`dynamic barrier ${id} has invalid bounds or state`);
    }
    return { id, min, max, defaultActive: value.defaultActive };
  });
}

function stableUniqueId(value, label, ids) {
  if (!value || typeof value.id !== "string" || !value.id.trim() || ids.has(value.id)) {
    throw new Error(`Every ${label} needs a unique stable id`);
  }
  ids.add(value.id);
  return value.id;
}

function horizontalRectanglesGeometry(rectangles, downward) {
  const geometry = emptyGeometry();
  for (const rectangle of rectangles) {
    const [[x0, z0], [x1, z1]] = [rectangle.min, rectangle.max];
    const points = [
      [x0, rectangle.elevation, z0],
      [x0, rectangle.elevation, z1],
      [x1, rectangle.elevation, z1],
      [x1, rectangle.elevation, z0],
    ];
    appendQuad(geometry, ...(downward ? points.reverse() : points));
  }
  return geometry;
}

function barrierSegmentsGeometry(barriers) {
  const geometry = emptyGeometry();
  for (const barrier of barriers) {
    appendQuad(
      geometry,
      [barrier.start[0], barrier.minY, barrier.start[1]],
      [barrier.start[0], barrier.maxY, barrier.start[1]],
      [barrier.end[0], barrier.maxY, barrier.end[1]],
      [barrier.end[0], barrier.minY, barrier.end[1]],
    );
  }
  return geometry;
}

function appendGeometry(target, source) {
  const offset = target.positions.length / 3;
  target.positions.push(...source.positions);
  target.indices.push(...source.indices.map((index) => index + offset));
}

function serializeGlbDocument(document, binary) {
  const encodedJson = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = alignedLength(encodedJson.byteLength);
  const binaryLength = alignedLength(binary.byteLength);
  const output = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(encodedJson, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}

function normalizeInteriorVolumes(values) {
  if (!Array.isArray(values) || !values.length) {
    throw new Error("At least one reviewed structural interior volume is required");
  }
  const ids = new Set();
  const volumes = values.map((value) => {
    if (!value || typeof value.id !== "string" || !value.id.trim() || ids.has(value.id)) {
      throw new Error("Every structural interior volume needs a unique stable id");
    }
    ids.add(value.id);
    const min = finitePoint(value.min);
    const max = finitePoint(value.max);
    if (!min || !max || min.some((coordinate, axis) => coordinate >= max[axis])) {
      throw new Error(`Structural interior volume ${value.id} has invalid bounds`);
    }
    return { id: value.id, min, max };
  });
  const floorY = volumes[0].min[1];
  const ceilingY = volumes[0].max[1];
  if (volumes.some((volume) =>
    Math.abs(volume.min[1] - floorY) > 1e-6 ||
    Math.abs(volume.max[1] - ceilingY) > 1e-6
  )) {
    throw new Error("V1 structural interior volumes must share one floor and ceiling elevation");
  }
  return volumes;
}

function structuralShellGeometry(volumes) {
  const floor = emptyGeometry();
  const barrier = emptyGeometry();
  const xStops = uniqueSorted(volumes.flatMap((volume) => [volume.min[0], volume.max[0]]));
  const zStops = uniqueSorted(volumes.flatMap((volume) => [volume.min[2], volume.max[2]]));
  const floorY = volumes[0].min[1];
  const ceilingY = volumes[0].max[1];
  const occupied = new Set();
  for (let x = 0; x + 1 < xStops.length; x += 1) {
    for (let z = 0; z + 1 < zStops.length; z += 1) {
      const centerX = (xStops[x] + xStops[x + 1]) / 2;
      const centerZ = (zStops[z] + zStops[z + 1]) / 2;
      if (volumes.some((volume) =>
        centerX > volume.min[0] - 1e-9 && centerX < volume.max[0] + 1e-9 &&
        centerZ > volume.min[2] - 1e-9 && centerZ < volume.max[2] + 1e-9
      )) occupied.add(`${x}:${z}`);
    }
  }
  for (const key of occupied) {
    const [x, z] = key.split(":").map(Number);
    const minX = xStops[x];
    const maxX = xStops[x + 1];
    const minZ = zStops[z];
    const maxZ = zStops[z + 1];
    appendQuad(floor,
      [minX, floorY, minZ], [minX, floorY, maxZ],
      [maxX, floorY, maxZ], [maxX, floorY, minZ]);
    appendQuad(barrier,
      [minX, ceilingY, minZ], [maxX, ceilingY, minZ],
      [maxX, ceilingY, maxZ], [minX, ceilingY, maxZ]);
    if (!occupied.has(`${x - 1}:${z}`)) appendQuad(barrier,
      [minX, floorY, minZ], [minX, ceilingY, minZ],
      [minX, ceilingY, maxZ], [minX, floorY, maxZ]);
    if (!occupied.has(`${x + 1}:${z}`)) appendQuad(barrier,
      [maxX, floorY, maxZ], [maxX, ceilingY, maxZ],
      [maxX, ceilingY, minZ], [maxX, floorY, minZ]);
    if (!occupied.has(`${x}:${z - 1}`)) appendQuad(barrier,
      [maxX, floorY, minZ], [maxX, ceilingY, minZ],
      [minX, ceilingY, minZ], [minX, floorY, minZ]);
    if (!occupied.has(`${x}:${z + 1}`)) appendQuad(barrier,
      [minX, floorY, maxZ], [minX, ceilingY, maxZ],
      [maxX, ceilingY, maxZ], [maxX, floorY, maxZ]);
  }
  return { floor, barrier };
}

function boxesGeometry(values, label) {
  const geometry = emptyGeometry();
  if (!Array.isArray(values)) throw new Error(`${label} boxes must be an array`);
  for (const value of values) {
    const min = finitePoint(value?.min);
    const max = finitePoint(value?.max);
    if (!min || !max || min.some((coordinate, axis) => coordinate >= max[axis])) {
      throw new Error(`${label} box ${value?.id ?? "unknown"} has invalid bounds`);
    }
    appendBox(geometry, min, max);
  }
  return geometry;
}

function appendBox(geometry, min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  appendQuad(geometry, [x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]);
  appendQuad(geometry, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]);
  appendQuad(geometry, [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]);
  appendQuad(geometry, [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0]);
  appendQuad(geometry, [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0]);
  appendQuad(geometry, [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]);
}

function appendQuad(geometry, ...points) {
  const offset = geometry.positions.length / 3;
  geometry.positions.push(...points.flat());
  geometry.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

function emptyGeometry() {
  return { positions: [], indices: [] };
}

function finitePoint(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? value.map(Number)
    : null;
}

function finitePoint2(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
    ? value.map(Number)
    : null;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function normalizeRing(points, id) {
  if (!Array.isArray(points)) throw new Error(`Authored collision surface ${id} has no points`);
  const ring = points.filter((point, index) =>
    index === 0 || !samePoint(point, points[index - 1]));
  if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop();
  if (ring.length < 3 || ring.some((point) =>
    !Array.isArray(point) || point.length !== 3 || point.some((value) => !Number.isFinite(value)))) {
    throw new Error(`Authored collision surface ${id} requires at least three finite x, y, z points`);
  }
  return ring.map((point) => point.map(Number));
}

function samePoint(first, second) {
  return Array.isArray(first) && Array.isArray(second) &&
    first.length === 3 && second.length === 3 &&
    first.every((value, index) => Math.abs(value - second[index]) <= 1e-9);
}

function triangleNormalY(positions, first, second, third) {
  const ax = positions[first * 3];
  const az = positions[first * 3 + 2];
  const bx = positions[second * 3];
  const bz = positions[second * 3 + 2];
  const cx = positions[third * 3];
  const cz = positions[third * 3 + 2];
  return (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
}

function gltfDocument(geometry, positionByteLength, binaryByteLength, metadata) {
  const axes = [0, 1, 2].map((axis) => geometry.positions.filter((_, index) => index % 3 === axis));
  return {
    asset: {
      version: "2.0",
      generator: metadata.generator ?? "Spatial Studio authored-collision-v1",
      extras: {
        schemaVersion: "authored-walkable-collision-v1",
        source: metadata.source ?? null,
        surfaceIds: [...new Set(geometry.sourceSurfaceIds)],
      },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Authored walkable collision", mesh: 0 }],
    meshes: [{
      name: "Reviewed floor and connector surfaces",
      primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }],
    }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: geometry.positions.length / 3,
      type: "VEC3",
      min: axes.map((values) => Math.min(...values)),
      max: axes.map((values) => Math.max(...values)),
    }, {
      bufferView: 1,
      componentType: 5125,
      count: geometry.indices.length,
      type: "SCALAR",
      min: [Math.min(...geometry.indices)],
      max: [Math.max(...geometry.indices)],
    }],
    bufferViews: [{
      buffer: 0,
      byteOffset: 0,
      byteLength: positionByteLength,
      target: 34962,
    }, {
      buffer: 0,
      byteOffset: positionByteLength,
      byteLength: geometry.indices.length * 4,
      target: 34963,
    }],
    buffers: [{ byteLength: binaryByteLength }],
  };
}

function typedBytes(value) {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function alignedLength(value) {
  return Math.ceil(value / 4) * 4;
}

async function main() {
  const [configPath, outputPath] = process.argv.slice(2);
  if (!configPath || !outputPath) {
    console.error("Usage: node scripts/authored-collision.mjs <config.json> <output.glb>");
    process.exitCode = 2;
    return;
  }
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (config.schemaVersion === "authored-structural-collision-v1") {
    throw new Error(
      "authored-structural-collision-v1 is retired; migrate to v2 explicit floor, ceiling, and wall surfaces",
    );
  }
  if (config.schemaVersion === "authored-structural-collision-v2") {
    const bytes = buildAuthoredStructuralCollisionGlb(config, {
      generator: `Spatial Studio ${config.schemaVersion}`,
      source: config.source ?? null,
    });
    await writeFile(outputPath, bytes);
    const structuralCounts = {
      floorRectangleCount: config.floorRectangles?.length ?? 0,
      ceilingRectangleCount: config.ceilingRectangles?.length ?? 0,
      barrierSegmentCount: config.barrierSegments?.length ?? 0,
      dynamicBarrierCount: config.dynamicBarrierBoxes?.length ?? 0,
    };
    console.log(JSON.stringify({
      outputPath,
      byteLength: bytes.byteLength,
      ...structuralCounts,
      furnitureBoxCount: config.furnitureBoxes?.length ?? 0,
      collisionSemantics: "structural shell; furniture ignored",
    }, null, 2));
    return;
  }
  if (config.schemaVersion !== "authored-walkable-collision-v1") {
    throw new Error("Unsupported authored collision config schema");
  }
  const geometry = triangulateAuthoredSurfaces(config.surfaces);
  const bytes = serializeAuthoredCollisionGlb(geometry, {
    generator: "Spatial Studio authored-collision-v1",
    source: config.source ?? null,
  });
  await writeFile(outputPath, bytes);
  console.log(JSON.stringify({
    outputPath,
    byteLength: bytes.byteLength,
    surfaceCount: config.surfaces.length,
    vertexCount: geometry.positions.length / 3,
    triangleCount: geometry.indices.length / 3,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
