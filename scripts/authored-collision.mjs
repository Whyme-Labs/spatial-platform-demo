import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Earcut } from "three/src/extras/Earcut.js";
import { horizontalSurfaceIssue } from "./horizontal-surface.mjs";

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
    const holes = Array.isArray(surface.holes)
      ? surface.holes.map((hole, index) => normalizeRing(hole, `${surface.id} hole ${index + 1}`))
      : [];
    const rings = [points, ...holes];
    const offset = positions.length / 3;
    const allPoints = rings.flat();
    positions.push(...allPoints.flat());
    const holeIndices = [];
    let ringOffset = points.length;
    for (const hole of holes) {
      holeIndices.push(ringOffset);
      ringOffset += hole.length;
    }
    const triangles = Earcut.triangulate(
      allPoints.flatMap((point) => [point[0], point[2]]),
      holeIndices,
      2,
    );
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
  const usesFloorSurfaces = Array.isArray(config?.floorSurfaces);
  const usesCeilingSurfaces = Array.isArray(config?.ceilingSurfaces);
  const floors = usesFloorSurfaces
    ? normalizeHorizontalSurfaces(config.floorSurfaces, "floor", ids)
    : rectanglesToSurfaces(normalizeHorizontalRectangles(config?.floorRectangles, "floor", ids));
  const ceilings = usesCeilingSurfaces
    ? normalizeHorizontalSurfaces(config.ceilingSurfaces, "ceiling", ids)
    : rectanglesToSurfaces(normalizeHorizontalRectangles(config?.ceilingRectangles, "ceiling", ids));
  const barriers = normalizeBarrierSegments(config?.barrierSegments, ids);
  const connectors = normalizeConnectorSurfaces(config?.connectorSurfaces ?? [], ids);
  if (!floors.length || !ceilings.length || !barriers.length) {
    throw new Error("V2 structural collision requires explicit floors, ceilings, and barriers");
  }
  const floorGeometry = triangulateAuthoredSurfaces(floors);
  if (connectors.length) {
    appendGeometry(floorGeometry, triangulateAuthoredSurfaces(connectors));
  }
  const barrierGeometry = emptyGeometry();
  appendGeometry(barrierGeometry, reverseTriangleWinding(triangulateAuthoredSurfaces(ceilings)));
  appendGeometry(barrierGeometry, barrierSegmentsGeometry(barriers));
  const { ignoredFurniture, solidFurniture } = partitionFurnitureBoxes(
    config?.furnitureBoxes ?? [],
    ids,
  );
  const furniture = boxesGeometry(ignoredFurniture, "furniture");
  const solidFurnitureGeometry = boxesGeometry(solidFurniture, "solid furniture", {
    blocking: true,
  });
  const noGoVolumes = normalizeNoGoVolumes(config?.noGoVolumes ?? [], ids);
  const noGoGeometry = boxesGeometry(noGoVolumes, "no-go volume", { blocking: true });
  const dynamicBarriers = normalizeDynamicBarriers(config?.dynamicBarrierBoxes ?? [], ids);
  const semantics = {
    schemaVersion: "spatial-structural-collision-v1",
    provenance,
    structuralShellComplete: true,
    includedGroups: [
      "STRUCTURAL_FLOOR",
      "STRUCTURAL_BARRIER",
      ...(dynamicBarriers.length ? ["DYNAMIC_BARRIER"] : []),
      ...(solidFurniture.length ? ["SOLID_FURNITURE"] : []),
      ...(noGoVolumes.length ? ["NO_GO_VOLUME"] : []),
    ],
    ignoredGroups: ["FURNITURE", "TRIGGER"],
  };
  return serializeGroupedCollisionGlb([
    { group: "STRUCTURAL_FLOOR", geometry: floorGeometry },
    { group: "STRUCTURAL_BARRIER", geometry: barrierGeometry },
    ...(furniture.indices.length ? [{ group: "FURNITURE", geometry: furniture }] : []),
    ...(solidFurnitureGeometry.indices.length
      ? [{ group: "SOLID_FURNITURE", geometry: solidFurnitureGeometry }]
      : []),
    ...(noGoGeometry.indices.length ? [{ group: "NO_GO_VOLUME", geometry: noGoGeometry }] : []),
  ], {
    generator: metadata.generator ?? "Spatial Studio authored-structural-collision-v2",
    source: metadata.source ?? null,
    semantics,
    authoring: {
      schemaVersion: "authored-structural-collision-v2",
      floorRectangles: horizontalSurfaceBounds(floors),
      ceilingRectangles: horizontalSurfaceBounds(ceilings),
      ...(usesFloorSurfaces ? { floorSurfaces: floors } : {}),
      ...(usesCeilingSurfaces ? { ceilingSurfaces: ceilings } : {}),
      barrierSegments: barriers,
      connectorSurfaces: connectors,
      dynamicBarrierIds: dynamicBarriers.map((barrier) => barrier.id),
      ...(solidFurniture.length
        ? {
            solidFurnitureBoxes: solidFurniture.map((box) => ({
              id: box.id,
              min: box.min,
              max: box.max,
            })),
          }
        : {}),
      ...(noGoVolumes.length
        ? {
            noGoVolumes: noGoVolumes.map((volume) => ({
              id: volume.id,
              min: volume.min,
              max: volume.max,
            })),
          }
        : {}),
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
    const axisExtents = [0, 1, 2].map((axis) =>
      arrayExtent(geometry.positions.filter((_, index) => index % 3 === axis)));
    const indexExtent = arrayExtent(geometry.indices);
    const positionAccessor = accessors.length;
    accessors.push({
      bufferView: positionView,
      componentType: 5126,
      count: geometry.positions.length / 3,
      type: "VEC3",
      min: axisExtents.map(([minimum]) => minimum),
      max: axisExtents.map(([, maximum]) => maximum),
    });
    const indexAccessor = accessors.length;
    accessors.push({
      bufferView: indexView,
      componentType: 5125,
      count: geometry.indices.length,
      type: "SCALAR",
      min: [indexExtent[0]],
      max: [indexExtent[1]],
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

function normalizeHorizontalSurfaces(values, label, ids) {
  if (!Array.isArray(values) || !values.length) {
    throw new Error(`${label} surfaces must be a non-empty array`);
  }
  return values.map((value) => {
    const id = stableUniqueId(value, `${label} surface`, ids);
    const points = normalizeRing(value?.points, id);
    const holes = Array.isArray(value?.holes)
      ? value.holes.map((hole, index) => normalizeRing(hole, `${id} hole ${index + 1}`))
      : [];
    const elevation = points[0][1];
    const surface = { id, points, holes };
    const issue = horizontalSurfaceIssue(surface);
    if (issue) throw new Error(`${label} surface ${id} ${issue}`);
    return surface;
  });
}

function rectanglesToSurfaces(rectangles) {
  return rectangles.map((rectangle) => ({
    id: rectangle.id,
    points: [
      [rectangle.min[0], rectangle.elevation, rectangle.min[1]],
      [rectangle.min[0], rectangle.elevation, rectangle.max[1]],
      [rectangle.max[0], rectangle.elevation, rectangle.max[1]],
      [rectangle.max[0], rectangle.elevation, rectangle.min[1]],
    ],
    holes: [],
  }));
}

function horizontalSurfaceBounds(surfaces) {
  return surfaces.map((surface) => ({
    id: surface.id,
    min: [
      Math.min(...surface.points.map((point) => point[0])),
      Math.min(...surface.points.map((point) => point[2])),
    ],
    max: [
      Math.max(...surface.points.map((point) => point[0])),
      Math.max(...surface.points.map((point) => point[2])),
    ],
    elevation: surface.points[0][1],
  }));
}

// Where a barrier's cross-section came from. A segment without thickness is a
// zero-depth surface ("surface_only") and cooks the legacy quad, which keeps
// every pre-thickness config byte-identical; a segment with thickness cooks a
// closed prism and must say whether the value is a machine estimate, an
// operator's reviewed correction, or measured registered geometry.
export const BARRIER_THICKNESS_PROVENANCES = new Set([
  "estimated",
  "operator_reviewed",
  "registered_mesh",
]);
export const BARRIER_THICKNESS_MINIMUM_M = 0.01;
export const BARRIER_THICKNESS_MAXIMUM_M = 2;

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
    if (value?.thicknessM === undefined || value?.thicknessM === null) {
      return { id, start, end, minY, maxY };
    }
    const thicknessM = Number(value.thicknessM);
    if (!Number.isFinite(thicknessM) || thicknessM < BARRIER_THICKNESS_MINIMUM_M ||
      thicknessM > BARRIER_THICKNESS_MAXIMUM_M) {
      throw new Error(
        `barrier segment ${id} thickness must be between ${BARRIER_THICKNESS_MINIMUM_M} and ${BARRIER_THICKNESS_MAXIMUM_M} metres`,
      );
    }
    const thicknessProvenance = value?.thicknessProvenance ?? "operator_reviewed";
    if (!BARRIER_THICKNESS_PROVENANCES.has(thicknessProvenance)) {
      throw new Error(`barrier segment ${id} has an unsupported thickness provenance`);
    }
    return { id, start, end, minY, maxY, thicknessM, thicknessProvenance };
  });
}

function normalizeConnectorSurfaces(values, ids) {
  if (!Array.isArray(values)) throw new Error("connector surfaces must be an array");
  return values.map((value) => {
    const id = stableUniqueId(value, "connector surface", ids);
    const points = normalizeRing(value?.points, id);
    return { id, points };
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

function reverseTriangleWinding(geometry) {
  const reversed = {
    positions: [...geometry.positions],
    indices: [...geometry.indices],
    sourceSurfaceIds: [...(geometry.sourceSurfaceIds ?? [])],
  };
  for (let index = 0; index < reversed.indices.length; index += 3) {
    [reversed.indices[index + 1], reversed.indices[index + 2]] = [
      reversed.indices[index + 2],
      reversed.indices[index + 1],
    ];
  }
  return reversed;
}

function barrierSegmentsGeometry(barriers) {
  const geometry = emptyGeometry();
  for (const barrier of barriers) {
    if (barrier.thicknessM === undefined) {
      appendQuad(
        geometry,
        [barrier.start[0], barrier.minY, barrier.start[1]],
        [barrier.start[0], barrier.maxY, barrier.start[1]],
        [barrier.end[0], barrier.maxY, barrier.end[1]],
        [barrier.end[0], barrier.minY, barrier.end[1]],
      );
      continue;
    }
    appendBarrierPrism(geometry, barrier);
  }
  return geometry;
}

// A blocking volume rasterizes as a hollow shell, and the reviewed floor
// running underneath it would survive inside as an enclosed walkable island
// that breaks whole-scene reachability. One down-facing diaphragm above the
// volume's base starves that interior of headroom without touching any
// geometry a walker can actually reach. The lift must clear the largest
// permitted agent climb (0.5) — Recast promotes an obstacle within climb
// height of a walkable floor to a steppable surface — while staying under
// the smallest permitted agent height so the floor beneath reads as cramped.
const INTERIOR_CAP_LIFT_M = 0.55;

// A thick wall is a closed box centred on its reviewed centreline: the walker
// meets the wall's face where the building's face is, not a sheet floating in
// the middle of the wall's footprint. Every horizontal face winds downward —
// a wall top is never a reviewed walkable surface, and an up-facing cap at
// ceiling height would manufacture unreachable roof-strip navmesh islands.
function appendBarrierPrism(geometry, barrier) {
  const deltaX = barrier.end[0] - barrier.start[0];
  const deltaZ = barrier.end[1] - barrier.start[1];
  const length = Math.hypot(deltaX, deltaZ);
  const half = barrier.thicknessM / 2;
  const normalX = (-deltaZ / length) * half;
  const normalZ = (deltaX / length) * half;
  const corners = [
    [barrier.start[0] - normalX, barrier.start[1] - normalZ],
    [barrier.end[0] - normalX, barrier.end[1] - normalZ],
    [barrier.end[0] + normalX, barrier.end[1] + normalZ],
    [barrier.start[0] + normalX, barrier.start[1] + normalZ],
  ];
  const at = (corner, y) => [corner[0], y, corner[1]];
  for (let index = 0; index < corners.length; index += 1) {
    const from = corners[index];
    const to = corners[(index + 1) % corners.length];
    appendQuad(
      geometry,
      at(from, barrier.minY),
      at(from, barrier.maxY),
      at(to, barrier.maxY),
      at(to, barrier.minY),
    );
  }
  const capY = barrier.minY +
    Math.min(INTERIOR_CAP_LIFT_M, (barrier.maxY - barrier.minY) / 2);
  for (const y of [barrier.maxY, barrier.minY, capY]) {
    appendQuad(
      geometry,
      at(corners[0], y),
      at(corners[1], y),
      at(corners[2], y),
      at(corners[3], y),
    );
  }
}

// Loop-based extent: Math.min(...values) turns every element into a call
// argument and overflows the stack on building-scale geometry.
function arrayExtent(values) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return [minimum, maximum];
}

function appendGeometry(target, source) {
  // Element-wise, not push(...spread): a building-scale collision config carries
  // more vertices than V8 accepts as call arguments.
  const offset = target.positions.length / 3;
  for (const position of source.positions) target.positions.push(position);
  for (const index of source.indices) target.indices.push(index + offset);
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

// Furniture is non-blocking unless a box explicitly opts into "solid". A solid
// box physically blocks movement and carves the navmesh, so unlike decorative
// footprints it needs a stable id the runtime can name when it stops a walker.
function partitionFurnitureBoxes(values, ids) {
  if (!Array.isArray(values)) throw new Error("furniture boxes must be an array");
  const ignoredFurniture = [];
  const solidFurniture = [];
  for (const value of values) {
    const passability = value?.passability ?? "non_blocking";
    if (passability === "non_blocking") {
      ignoredFurniture.push(value);
      continue;
    }
    if (passability !== "solid") {
      throw new Error(
        `furniture box ${value?.id ?? "unknown"} has an unsupported passability`,
      );
    }
    const id = stableUniqueId(value, "solid furniture box", ids);
    const min = finitePoint(value?.min);
    const max = finitePoint(value?.max);
    if (!min || !max || min.some((coordinate, axis) => coordinate >= max[axis])) {
      throw new Error(`solid furniture box ${id} has invalid bounds`);
    }
    solidFurniture.push({ id, min, max });
  }
  return { ignoredFurniture, solidFurniture };
}

// An intentional no-go volume blocks movement without claiming to be observed
// structure: a reviewed "do not walk here", honest about being policy rather
// than geometry.
function normalizeNoGoVolumes(values, ids) {
  if (!Array.isArray(values)) throw new Error("no-go volumes must be an array");
  return values.map((value) => {
    const id = stableUniqueId(value, "no-go volume", ids);
    const min = finitePoint(value?.min);
    const max = finitePoint(value?.max);
    if (!min || !max || min.some((coordinate, axis) => coordinate >= max[axis])) {
      throw new Error(`no-go volume ${id} has invalid bounds`);
    }
    return { id, min, max };
  });
}

function boxesGeometry(values, label, { blocking = false } = {}) {
  const geometry = emptyGeometry();
  if (!Array.isArray(values)) throw new Error(`${label} boxes must be an array`);
  for (const value of values) {
    const min = finitePoint(value?.min);
    const max = finitePoint(value?.max);
    if (!min || !max || min.some((coordinate, axis) => coordinate >= max[axis])) {
      throw new Error(`${label} box ${value?.id ?? "unknown"} has invalid bounds`);
    }
    appendBox(geometry, min, max);
    if (blocking) {
      // Starve the enclosed floor of headroom so a blocking volume cannot
      // leave a walkable island inside its own footprint.
      const capY = min[1] + Math.min(INTERIOR_CAP_LIFT_M, (max[1] - min[1]) / 2);
      appendQuad(
        geometry,
        [min[0], capY, min[2]],
        [max[0], capY, min[2]],
        [max[0], capY, max[2]],
        [min[0], capY, max[2]],
      );
    }
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
  const axisExtents = [0, 1, 2].map((axis) =>
    arrayExtent(geometry.positions.filter((_, index) => index % 3 === axis)));
  const indexExtent = arrayExtent(geometry.indices);
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
      min: axisExtents.map(([minimum]) => minimum),
      max: axisExtents.map(([, maximum]) => maximum),
    }, {
      bufferView: 1,
      componentType: 5125,
      count: geometry.indices.length,
      type: "SCALAR",
      min: [indexExtent[0]],
      max: [indexExtent[1]],
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
