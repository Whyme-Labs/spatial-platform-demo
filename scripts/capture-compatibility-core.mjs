import {
  AUTOMATIC_PLY_COORDINATE_EVIDENCE_METHOD,
  PLY_COORDINATE_HEADER_BUDGET_BYTES,
  PLY_COORDINATE_HEADER_BUDGET_NAME,
} from "./capture-compatibility-contract.mjs";

export {
  AUTOMATIC_PLY_COORDINATE_EVIDENCE_METHOD,
  PLY_COORDINATE_HEADER_BUDGET_BYTES,
  PLY_COORDINATE_HEADER_BUDGET_NAME,
};

const coordinateCommentNames = Object.freeze({
  frame: "spatial_studio_coordinate_frame",
  upAxis: "spatial_studio_up_axis",
  units: "spatial_studio_units",
});

const scalarReaders = Object.freeze({
  char: { bytes: 1, read: (view, offset) => view.getInt8(offset) },
  int8: { bytes: 1, read: (view, offset) => view.getInt8(offset) },
  uchar: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
  uint8: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
  short: { bytes: 2, read: (view, offset) => view.getInt16(offset, true) },
  int16: { bytes: 2, read: (view, offset) => view.getInt16(offset, true) },
  ushort: { bytes: 2, read: (view, offset) => view.getUint16(offset, true) },
  uint16: { bytes: 2, read: (view, offset) => view.getUint16(offset, true) },
  int: { bytes: 4, read: (view, offset) => view.getInt32(offset, true) },
  int32: { bytes: 4, read: (view, offset) => view.getInt32(offset, true) },
  uint: { bytes: 4, read: (view, offset) => view.getUint32(offset, true) },
  uint32: { bytes: 4, read: (view, offset) => view.getUint32(offset, true) },
  float: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true) },
  float32: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true) },
  double: { bytes: 8, read: (view, offset) => view.getFloat64(offset, true) },
  float64: { bytes: 8, read: (view, offset) => view.getFloat64(offset, true) },
});

export function plyCoordinateHeaderBudgetError() {
  return new Error(
    `PLY header exceeds budget=${PLY_COORDINATE_HEADER_BUDGET_NAME}, ` +
      `limit=${PLY_COORDINATE_HEADER_BUDGET_BYTES}, ` +
      `requested=${PLY_COORDINATE_HEADER_BUDGET_BYTES + 1}`,
  );
}

export function preflightPairedPlyCoordinateDescriptors(visual, geometry) {
  if (visual.coordinateFrameId !== geometry.coordinateFrameId) {
    return {
      status: "contradicted",
      reason: "The two PLY files explicitly declare different coordinate frame identities.",
    };
  }
  if (visual.worldUnit !== "metres" || geometry.worldUnit !== "metres") {
    return {
      status: "contradicted",
      reason: "The PLY metadata explicitly declares units other than metres.",
    };
  }
  if (visual.sourceUpAxis !== "Y" || geometry.sourceUpAxis !== "Y") {
    return {
      status: "contradicted",
      reason: "The PLY metadata explicitly declares an up axis other than Y.",
    };
  }
  return { status: "qualified" };
}

export function parsePlyCoordinateDescriptor(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const markerOffset = text.indexOf("end_header");
  if (markerOffset < 0) throw new Error("PLY header has no end_header marker");
  let dataOffset = new TextEncoder().encode(text.slice(0, markerOffset + "end_header".length)).length;
  if (bytes[dataOffset] === 13) dataOffset += 1;
  if (bytes[dataOffset] === 10) dataOffset += 1;
  const lines = text.slice(0, markerOffset + "end_header".length)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== "ply") throw new Error("Source is not a PLY file");
  const format = lines.find((line) => line.startsWith("format "))?.split(/\s+/)[1];
  if (format !== "binary_little_endian") {
    throw new Error(`Automatic coordinate qualification requires binary_little_endian PLY, received ${format ?? "unknown"}`);
  }
  const vertexElementIndex = lines.findIndex((line) => line.startsWith("element vertex "));
  if (vertexElementIndex < 0) throw new Error("PLY has no vertex element");
  const precedingElement = lines
    .slice(0, vertexElementIndex)
    .find((line) => line.startsWith("element "));
  if (precedingElement) {
    throw new Error(
      `Automatic coordinate qualification requires the vertex element first, received ${precedingElement}`,
    );
  }
  const vertexCount = Number(lines[vertexElementIndex]?.split(/\s+/)[2]);
  if (!Number.isSafeInteger(vertexCount) || vertexCount <= 0) {
    throw new Error("PLY declares no coordinate vertices");
  }
  const properties = [];
  let recordBytes = 0;
  for (let index = vertexElementIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.startsWith("element ") || line === "end_header") break;
    if (!line.startsWith("property ")) continue;
    const fields = line.split(/\s+/);
    if (fields[1] === "list") throw new Error("Automatic coordinate qualification does not support PLY vertex list properties");
    const scalar = scalarReaders[fields[1]];
    const name = fields[2];
    if (!scalar || !name) throw new Error(`Unsupported PLY vertex property: ${line}`);
    properties.push({ name, offset: recordBytes, ...scalar });
    recordBytes += scalar.bytes;
  }
  const propertyByName = new Map(properties.map((property) => [property.name, property]));
  for (const axis of ["x", "y", "z"]) {
    if (!propertyByName.has(axis)) throw new Error(`PLY is missing the ${axis} coordinate`);
  }
  const comments = new Map();
  for (const line of lines) {
    if (!line.startsWith("comment ")) continue;
    const content = line.slice("comment ".length);
    const separator = content.indexOf(" ");
    if (separator < 0) continue;
    comments.set(content.slice(0, separator), content.slice(separator + 1).trim());
  }
  const coordinateFrameId = comments.get(coordinateCommentNames.frame);
  const sourceUpAxis = comments.get(coordinateCommentNames.upAxis);
  const worldUnit = comments.get(coordinateCommentNames.units);
  if (!coordinateFrameId) throw new Error("PLY has no spatial_studio_coordinate_frame comment");
  if (!sourceUpAxis) throw new Error("PLY has no spatial_studio_up_axis comment");
  if (!worldUnit) throw new Error("PLY has no spatial_studio_units comment");
  return {
    schemaVersion: "ply-coordinate-descriptor-v1",
    format,
    vertexCount,
    recordBytes,
    dataOffset,
    coordinateFrameId,
    sourceUpAxis,
    worldUnit,
    properties,
    propertyByName,
  };
}

export function createPlyCoordinateEvidenceAccumulator(descriptor) {
  let remainder = new Uint8Array();
  let observedVertexCount = 0;
  let finitePointCount = 0;
  const bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
  const axisProperties = ["x", "y", "z"].map((axis) => descriptor.propertyByName.get(axis));
  return {
    consume(input) {
      if (observedVertexCount >= descriptor.vertexCount) return;
      const incoming = input instanceof Uint8Array ? input : new Uint8Array(input);
      const bytes = new Uint8Array(remainder.byteLength + incoming.byteLength);
      bytes.set(remainder);
      bytes.set(incoming, remainder.byteLength);
      const remainingVertices = descriptor.vertexCount - observedVertexCount;
      const completeRecords = Math.min(
        remainingVertices,
        Math.floor(bytes.byteLength / descriptor.recordBytes),
      );
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let recordIndex = 0; recordIndex < completeRecords; recordIndex += 1) {
        const recordOffset = recordIndex * descriptor.recordBytes;
        const point = axisProperties.map((property) => property.read(view, recordOffset + property.offset));
        observedVertexCount += 1;
        if (!point.every(Number.isFinite)) continue;
        finitePointCount += 1;
        for (const axis of [0, 1, 2]) {
          bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
          bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
        }
      }
      remainder = bytes.slice(completeRecords * descriptor.recordBytes);
    },
    finish() {
      if (observedVertexCount !== descriptor.vertexCount) {
        throw new Error(
          `PLY coordinate evidence is incomplete: asked_vertices=${descriptor.vertexCount}, observed_vertices=${observedVertexCount}`,
        );
      }
      if (!finitePointCount) throw new Error("PLY coordinate evidence contains no finite vertices");
      return {
        schemaVersion: "ply-coordinate-evidence-v1",
        method: AUTOMATIC_PLY_COORDINATE_EVIDENCE_METHOD,
        coordinateFrameId: descriptor.coordinateFrameId,
        sourceUpAxis: descriptor.sourceUpAxis,
        worldUnit: descriptor.worldUnit,
        vertexCount: descriptor.vertexCount,
        finitePointCount,
        bounds,
      };
    },
  };
}

export function qualifyPairedPlyCoordinateEvidence(visual, geometry) {
  if (visual.coordinateFrameId !== geometry.coordinateFrameId) {
    return { qualified: false, reason: "The two PLY files declare different coordinate frame identities." };
  }
  if (visual.worldUnit !== "metres" || geometry.worldUnit !== "metres") {
    return { qualified: false, reason: "Automatic qualification requires both PLY files to declare metre units." };
  }
  if (visual.sourceUpAxis !== "Y" || geometry.sourceUpAxis !== "Y") {
    return { qualified: false, reason: "Automatic qualification requires both PLY files to declare a Y-up axis." };
  }
  const overlapBounds = {
    min: visual.bounds.min.map((value, axis) => Math.max(value, geometry.bounds.min[axis])),
    max: visual.bounds.max.map((value, axis) => Math.min(value, geometry.bounds.max[axis])),
  };
  if (overlapBounds.min.some((value, axis) => value >= overlapBounds.max[axis])) {
    return { qualified: false, reason: "The exact PLY bounds do not overlap in their declared shared frame." };
  }
  return {
    qualified: true,
    method: AUTOMATIC_PLY_COORDINATE_EVIDENCE_METHOD,
    coordinateFrameId: visual.coordinateFrameId,
    sourceUpAxis: "Y",
    worldUnit: "metres",
    overlapBounds,
    visual,
    geometry,
  };
}
