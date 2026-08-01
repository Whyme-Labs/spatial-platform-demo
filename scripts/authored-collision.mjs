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
