const maximumHeaderBytes = 2 * 1024 * 1024;

export class ProcessingAgentError extends Error {
  constructor(code, message, {
    failureClass = "unknown",
    retryable = true,
    details = {},
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ProcessingAgentError";
    this.code = code;
    this.failureClass = failureClass;
    this.retryable = retryable;
    this.details = details;
  }
}

export function processOutputEvent(baseEvent, stream) {
  return stream === "stderr" ? `${baseEvent}.stderr` : baseEvent;
}

export function validateGaussianPlyHeader(bytes) {
  const headerBytes = bytes instanceof Uint8Array
    ? bytes.subarray(0, maximumHeaderBytes)
    : new Uint8Array(bytes).subarray(0, maximumHeaderBytes);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(headerBytes);
  const endOffset = text.indexOf("end_header");
  if (endOffset < 0) {
    throw new ProcessingAgentError(
      "INVALID_GAUSSIAN_PLY",
      "PLY header is missing end_header within the first 2 MiB",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const lines = text.slice(0, endOffset + "end_header".length)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== "ply") {
    throw new ProcessingAgentError(
      "INVALID_GAUSSIAN_PLY",
      "Source is not a PLY file",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const formatLine = lines.find((line) => line.startsWith("format "));
  const format = formatLine?.split(/\s+/)[1];
  if (!["ascii", "binary_little_endian"].includes(format)) {
    throw new ProcessingAgentError(
      "UNSUPPORTED_PLY_FORMAT",
      `PLY format ${format ?? "unknown"} is not supported by this processor`,
      { failureClass: "input_validation", retryable: false },
    );
  }
  const vertexLine = lines.find((line) => line.startsWith("element vertex "));
  const vertexCount = Number(vertexLine?.split(/\s+/)[2]);
  if (!Number.isSafeInteger(vertexCount) || vertexCount <= 0) {
    throw new ProcessingAgentError(
      "INVALID_GAUSSIAN_PLY",
      "PLY declares no Gaussian vertices",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const propertyNames = new Set(
    lines
      .filter((line) => line.startsWith("property "))
      .map((line) => line.split(/\s+/).at(-1)),
  );
  const required = [
    "x", "y", "z",
    "f_dc_0", "f_dc_1", "f_dc_2",
    "opacity",
    "scale_0", "scale_1", "scale_2",
    "rot_0", "rot_1", "rot_2", "rot_3",
  ];
  const missing = required.filter((name) => !propertyNames.has(name));
  if (missing.length) {
    throw new ProcessingAgentError(
      "INVALID_GAUSSIAN_PLY",
      `PLY is a point cloud, not a complete Gaussian splat (${missing.length} properties missing)`,
      {
        failureClass: "input_validation",
        retryable: false,
        details: { missingProperties: missing },
      },
    );
  }
  const restCount = [...propertyNames].filter((name) => name?.startsWith("f_rest_")).length;
  let sphericalHarmonicDegree = 0;
  for (let degree = 1; degree <= 3; degree += 1) {
    if (restCount >= 3 * ((degree + 1) ** 2 - 1)) sphericalHarmonicDegree = degree;
  }
  return {
    format,
    vertexCount,
    sphericalHarmonicDegree,
    headerBytes: endOffset + "end_header".length,
    propertyCount: propertyNames.size,
  };
}

export function inspectSpzContainer(bytes) {
  const header = bytes instanceof Uint8Array
    ? bytes.subarray(0, 16)
    : new Uint8Array(bytes).subarray(0, 16);
  if (startsWithBytes(header, [0x1f, 0x8b])) {
    return {
      container: "gzip",
      version: "legacy",
      sparkBuildLodCompatible: true,
      normalizationRequired: false,
    };
  }
  if (startsWithBytes(header, [0x4e, 0x47, 0x53, 0x50])) {
    if (header.byteLength < 8) {
      throw new ProcessingAgentError(
        "INVALID_SPZ_HEADER",
        "SPZ NGSP header is truncated",
        { failureClass: "input_validation", retryable: false },
      );
    }
    const version = new DataView(
      header.buffer,
      header.byteOffset + 4,
      4,
    ).getUint32(0, true);
    if (version !== 4) {
      throw new ProcessingAgentError(
        "UNSUPPORTED_SPZ_VERSION",
        `SPZ NGSP version ${version} is not supported`,
        {
          failureClass: "input_validation",
          retryable: false,
          details: { version },
        },
      );
    }
    return {
      container: "ngsp",
      version,
      sparkBuildLodCompatible: false,
      normalizationRequired: true,
    };
  }
  throw new ProcessingAgentError(
    "INVALID_SPZ_HEADER",
    "SPZ source is neither a gzip-framed legacy file nor an NGSP v4 file",
    { failureClass: "input_validation", retryable: false },
  );
}

export function sparkMaximumSphericalHarmonicDegree(format, detectedDegree) {
  if (String(format).toLowerCase() === "splat") return 0;
  if (
    Number.isSafeInteger(detectedDegree)
    && detectedDegree >= 0
    && detectedDegree <= 3
  ) return detectedDegree;
  return 3;
}

export function validateEvidenceAsset(bytes, { format, purpose }) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!source.byteLength) {
    throw evidenceSignatureError(format, "Evidence file is empty");
  }
  const normalizedFormat = String(format).toLowerCase();
  const header = source.subarray(0, Math.min(source.byteLength, maximumHeaderBytes));
  const ascii = new TextDecoder("utf-8", { fatal: false }).decode(header);
  let signatureVerified = true;
  let signature;

  switch (normalizedFormat) {
    case "e57":
      signature = "ASTM-E57";
      assertBytes(header, [0x41, 0x53, 0x54, 0x4d, 0x2d, 0x45, 0x35, 0x37], format);
      break;
    case "las":
    case "laz":
      signature = "LASF";
      assertBytes(header, [0x4c, 0x41, 0x53, 0x46], format);
      break;
    case "rad":
      signature = "RAD0";
      assertBytes(header, [0x52, 0x41, 0x44, 0x30], format);
      break;
    case "zip":
      signature = "PKZIP";
      if (
        !startsWithBytes(header, [0x50, 0x4b, 0x03, 0x04]) &&
        !startsWithBytes(header, [0x50, 0x4b, 0x05, 0x06]) &&
        !startsWithBytes(header, [0x50, 0x4b, 0x07, 0x08])
      ) throw evidenceSignatureError(format, "ZIP evidence is missing a PK archive signature");
      break;
    case "jpg":
    case "jpeg":
      signature = "JPEG";
      assertBytes(header, [0xff, 0xd8, 0xff], format);
      break;
    case "png":
      signature = "PNG";
      assertBytes(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], format);
      break;
    case "webp":
      signature = "RIFF-WEBP";
      if (
        !startsWithBytes(header, [0x52, 0x49, 0x46, 0x46]) ||
        !startsWithBytes(header.subarray(8), [0x57, 0x45, 0x42, 0x50])
      ) throw evidenceSignatureError(format, "WEBP evidence is missing its RIFF/WEBP signature");
      break;
    case "mp4":
    case "mov":
    case "webm":
      signature = normalizedFormat === "webm" ? "EBML" : "ISO-BMFF";
      if (normalizedFormat === "webm") {
        assertBytes(header, [0x1a, 0x45, 0xdf, 0xa3], format);
      } else if (!startsWithBytes(header.subarray(4), [0x66, 0x74, 0x79, 0x70])) {
        throw evidenceSignatureError(format, "Video evidence is missing an ISO BMFF ftyp box");
      }
      break;
    case "glb":
      signature = "glTF";
      assertBytes(header, [0x67, 0x6c, 0x54, 0x46], format);
      break;
    case "ply":
      signature = "PLY";
      if (!ascii.startsWith("ply") || !ascii.includes("end_header")) {
        throw evidenceSignatureError(format, "PLY evidence has no complete bounded header");
      }
      break;
    case "json":
    case "gltf":
      signature = "JSON";
      try {
        JSON.parse(ascii);
      } catch {
        throw evidenceSignatureError(format, "JSON evidence is not valid JSON within the bounded validator input");
      }
      break;
    case "csv":
    case "yaml":
    case "yml":
    case "pts":
    case "obj":
      signature = "text";
      if (!ascii.trim()) throw evidenceSignatureError(format, "Text evidence contains no non-whitespace content");
      break;
    case "xbin":
    case "fjdslam":
    case "lcc":
    case "lcc2":
      signature = "opaque-vendor-container";
      signatureVerified = false;
      break;
    default:
      throw evidenceSignatureError(format, `No evidence validator is registered for ${format}`);
  }

  return {
    method: "bounded-file-signature-v1",
    format: normalizedFormat,
    purpose,
    inspectedBytes: header.byteLength,
    signature,
    signatureVerified,
    semanticValidation: false,
    limitation:
      "This bounded check verifies file identity and integrity signals only; it does not prove scanner origin, calibration, reconstruction quality, survey control, or professional accuracy.",
  };
}

function startsWithBytes(bytes, expected) {
  if (bytes.byteLength < expected.length) return false;
  return expected.every((value, index) => bytes[index] === value);
}

function assertBytes(bytes, expected, format) {
  if (!startsWithBytes(bytes, expected)) {
    throw evidenceSignatureError(format, `${String(format).toUpperCase()} evidence has an invalid file signature`);
  }
}

function evidenceSignatureError(format, message) {
  return new ProcessingAgentError(
    "EVIDENCE_SIGNATURE_MISMATCH",
    message,
    {
      failureClass: "input_validation",
      retryable: false,
      details: { format },
    },
  );
}

export function planMultipartParts(sizeBytes, partSizeBytes) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new TypeError("sizeBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(partSizeBytes) || partSizeBytes <= 0) {
    throw new TypeError("partSizeBytes must be a positive safe integer");
  }
  const parts = [];
  for (let offset = 0, partNumber = 1; offset < sizeBytes; offset += partSizeBytes, partNumber += 1) {
    parts.push({
      partNumber,
      offset,
      length: Math.min(partSizeBytes, sizeBytes - offset),
    });
  }
  if (parts.length > 10_000) throw new RangeError("Output exceeds the 10,000-part R2 limit");
  return parts;
}

export function assertRegisteredSceneChangeCapacity({
  baselineSizeBytes,
  candidateSizeBytes,
  maximumInputBytes,
}) {
  for (const [name, value] of Object.entries({
    baselineSizeBytes,
    candidateSizeBytes,
    maximumInputBytes,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
  if (
    baselineSizeBytes <= maximumInputBytes
    && candidateSizeBytes <= maximumInputBytes
  ) return;
  throw new ProcessingAgentError(
    "CHANGE_INPUT_CAPACITY_EXCEEDED",
    `Each registered-scene PLY must be at most ${maximumInputBytes} bytes for this processor`,
    {
      failureClass: "capacity",
      retryable: false,
      details: {
        baselineSizeBytes,
        candidateSizeBytes,
        maximumInputBytes,
      },
    },
  );
}

export function parsePlySceneSignature(input, {
  voxelSizeM = 0.1,
  maximumSamplePoints = 2_000_000,
} = {}) {
  if (!Number.isFinite(voxelSizeM) || voxelSizeM < 0.005 || voxelSizeM > 5) {
    throw new ProcessingAgentError(
      "INVALID_CHANGE_PARAMETERS",
      "Voxel size must be between 0.005 and 5 metres",
      { failureClass: "input_validation", retryable: false },
    );
  }
  if (!Number.isSafeInteger(maximumSamplePoints) || maximumSamplePoints < 1_000 || maximumSamplePoints > 10_000_000) {
    throw new ProcessingAgentError(
      "INVALID_CHANGE_PARAMETERS",
      "Maximum sample points must be between 1,000 and 10,000,000",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const descriptor = parsePlyDescriptor(bytes);
  const samplingStride = Math.max(1, Math.ceil(descriptor.vertexCount / maximumSamplePoints));
  const voxels = new Map();
  const bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
  let sampledPointCount = 0;
  let hasPhotometricData = false;

  const consume = (values, vertexIndex) => {
    if (vertexIndex % samplingStride !== 0) return;
    const x = values[descriptor.propertyIndex.x];
    const y = values[descriptor.propertyIndex.y];
    const z = values[descriptor.propertyIndex.z];
    if (![x, y, z].every(Number.isFinite)) return;
    const color = readPlyColor(values, descriptor.propertyIndex);
    hasPhotometricData ||= color !== null;
    sampledPointCount += 1;
    bounds.min[0] = Math.min(bounds.min[0], x);
    bounds.min[1] = Math.min(bounds.min[1], y);
    bounds.min[2] = Math.min(bounds.min[2], z);
    bounds.max[0] = Math.max(bounds.max[0], x);
    bounds.max[1] = Math.max(bounds.max[1], y);
    bounds.max[2] = Math.max(bounds.max[2], z);
    const key = [
      voxelCoordinate(x, voxelSizeM),
      voxelCoordinate(y, voxelSizeM),
      voxelCoordinate(z, voxelSizeM),
    ].join(",");
    const voxel = voxels.get(key) ?? {
      key,
      count: 0,
      position: [0, 0, 0],
      color: [0, 0, 0],
      colorCount: 0,
    };
    voxel.count += 1;
    voxel.position[0] += x;
    voxel.position[1] += y;
    voxel.position[2] += z;
    if (color) {
      voxel.color[0] += color[0];
      voxel.color[1] += color[1];
      voxel.color[2] += color[2];
      voxel.colorCount += 1;
    }
    voxels.set(key, voxel);
  };

  if (descriptor.format === "ascii") {
    parseAsciiVertices(bytes, descriptor, consume);
  } else {
    parseBinaryVertices(bytes, descriptor, consume);
  }
  if (!sampledPointCount) {
    throw new ProcessingAgentError(
      "EMPTY_REGISTERED_SCENE",
      "The PLY contains no finite registered points",
      { failureClass: "input_validation", retryable: false },
    );
  }
  for (const voxel of voxels.values()) {
    voxel.centroid = voxel.position.map((value) => value / voxel.count);
    voxel.meanColor = voxel.colorCount
      ? voxel.color.map((value) => value / voxel.colorCount)
      : null;
    delete voxel.position;
    delete voxel.color;
  }
  return {
    format: descriptor.format,
    vertexCount: descriptor.vertexCount,
    sampledPointCount,
    samplingStride,
    voxelSizeM,
    voxelCount: voxels.size,
    hasPhotometricData,
    bounds,
    voxels,
  };
}

export function extractWalkableSemanticCandidates(signature, {
  gridSizeM = 0.25,
  floorBandM = 0.15,
  minimumAreaM2 = 2,
  maximumCandidates = 24,
  elevationHintM = null,
} = {}) {
  if (!signature || !(signature.voxels instanceof Map) || !signature.voxels.size) {
    throw new ProcessingAgentError(
      "INVALID_SEMANTIC_SOURCE",
      "A non-empty registered PLY signature is required for semantic extraction",
      { failureClass: "input_validation", retryable: false },
    );
  }
  if (!Number.isFinite(gridSizeM) || gridSizeM < 0.05 || gridSizeM > 2) {
    throw new ProcessingAgentError(
      "INVALID_SEMANTIC_PARAMETERS",
      "Grid size must be between 0.05 and 2 metres",
      { failureClass: "input_validation", retryable: false },
    );
  }
  if (!Number.isFinite(floorBandM) || floorBandM < 0.05 || floorBandM > 0.5) {
    throw new ProcessingAgentError(
      "INVALID_SEMANTIC_PARAMETERS",
      "Floor band must be between 0.05 and 0.5 metres",
      { failureClass: "input_validation", retryable: false },
    );
  }
  if (!Number.isFinite(minimumAreaM2) || minimumAreaM2 < 0.25 || minimumAreaM2 > 10_000) {
    throw new ProcessingAgentError(
      "INVALID_SEMANTIC_PARAMETERS",
      "Minimum candidate area must be between 0.25 and 10,000 square metres",
      { failureClass: "input_validation", retryable: false },
    );
  }
  if (!Number.isSafeInteger(maximumCandidates) || maximumCandidates < 1 || maximumCandidates > 100) {
    throw new ProcessingAgentError(
      "INVALID_SEMANTIC_PARAMETERS",
      "Maximum candidates must be between 1 and 100",
      { failureClass: "input_validation", retryable: false },
    );
  }
  if (elevationHintM !== null && !Number.isFinite(elevationHintM)) {
    throw new ProcessingAgentError(
      "INVALID_SEMANTIC_PARAMETERS",
      "Elevation hint must be a finite number of metres",
      { failureClass: "input_validation", retryable: false },
    );
  }

  const minimumCells = Math.ceil(minimumAreaM2 / (gridSizeM * gridSizeM));
  const layers = new Map();
  for (const voxel of signature.voxels.values()) {
    const [x, y, z] = voxel.centroid ?? [];
    if (![x, y, z].every(Number.isFinite)) continue;
    const layerIndex = Math.round(y / floorBandM);
    const cell = `${Math.floor(x / gridSizeM)},${Math.floor(z / gridSizeM)}`;
    const layer = layers.get(layerIndex) ?? new Set();
    layer.add(cell);
    layers.set(layerIndex, layer);
  }
  const credibleLayers = [...layers.entries()]
    .filter(([, cells]) => cells.size >= minimumCells)
    .map(([index, cells]) => ({
      index,
      elevationM: semanticRound(index * floorBandM),
      cells,
    }));
  if (!credibleLayers.length) {
    throw new ProcessingAgentError(
      "INSUFFICIENT_WALKABLE_SUPPORT",
      "The registered PLY contains no horizontal support layer large enough for the declared minimum area",
      {
        failureClass: "input_validation",
        retryable: false,
        details: {
          minimumAreaM2,
          gridSizeM,
          observedLayerCount: layers.size,
        },
      },
    );
  }
  credibleLayers.sort((left, right) => {
    if (elevationHintM !== null) {
      const distance = Math.abs(left.elevationM - elevationHintM) -
        Math.abs(right.elevationM - elevationHintM);
      if (distance) return distance;
    }
    return left.elevationM - right.elevationM || right.cells.size - left.cells.size;
  });
  const selectedLayer = credibleLayers[0];
  const components = semanticCellComponents(selectedLayer.cells)
    .filter((component) => component.length >= minimumCells)
    .sort((left, right) => right.length - left.length ||
      semanticCellSortKey(left).localeCompare(semanticCellSortKey(right)))
    .slice(0, maximumCandidates);
  if (!components.length) {
    throw new ProcessingAgentError(
      "INSUFFICIENT_WALKABLE_SUPPORT",
      "Horizontal support was detected, but no connected region satisfies the declared minimum area",
      { failureClass: "input_validation", retryable: false },
    );
  }

  const candidates = components.map((component, index) => {
    const outline = semanticCellOutline(component);
    const points = outline.map(([x, z]) => [
      semanticRound(x * gridSizeM),
      selectedLayer.elevationM,
      semanticRound(z * gridSizeM),
    ]);
    const areaM2 = semanticRound(component.length * gridSizeM * gridSizeM);
    const xs = component.map(([x]) => x);
    const zs = component.map(([, z]) => z);
    const boundingCellCount =
      (Math.max(...xs) - Math.min(...xs) + 1) *
      (Math.max(...zs) - Math.min(...zs) + 1);
    const supportRatio = component.length / boundingCellCount;
    return {
      candidateKey: `walkable-${String(index + 1).padStart(3, "0")}`,
      kind: "walkable_region",
      label: `Candidate room ${index + 1}`,
      elevationM: selectedLayer.elevationM,
      areaM2,
      confidence: semanticRound(Math.min(0.99, 0.55 + supportRatio * 0.4)),
      geometry: {
        type: "polygon",
        points,
      },
      evidence: {
        occupiedCellCount: component.length,
        boundingCellCount,
        supportRatio: semanticRound(supportRatio),
        gridSizeM,
        floorBandM,
      },
    };
  });
  return {
    schemaVersion: "1.0.0",
    method: "registered-ply-walkable-candidates-v1",
    result: "candidates_ready",
    source: {
      format: signature.format,
      vertexCount: signature.vertexCount,
      sampledPointCount: signature.sampledPointCount,
      samplingStride: signature.samplingStride,
      voxelCount: signature.voxelCount,
      coordinateAssurance: "registered_y_up_metric_frame",
    },
    parameters: {
      gridSizeM,
      floorBandM,
      minimumAreaM2,
      maximumCandidates,
      elevationHintM,
    },
    summary: {
      inferredFloorElevationM: selectedLayer.elevationM,
      credibleHorizontalLayerCount: credibleLayers.length,
      candidateCount: candidates.length,
      totalCandidateAreaM2: semanticRound(candidates.reduce((sum, candidate) => sum + candidate.areaM2, 0)),
    },
    candidates,
    humanReviewRequired: true,
    limitations: [
      "Candidates are occupancy-derived walkable proxies, not walls, legal rooms, accessibility certification, or survey evidence.",
      "The source must already use metres in a registered Y-up coordinate frame; this method does not register or calibrate it.",
      "Ceilings, furniture, sparse floors, stairs, glass, and multi-level overlap may require a supplied elevation hint or manual authoring.",
      "No candidate becomes an authored entity until an operator reviews and explicitly accepts it.",
    ],
    generatedAt: new Date().toISOString(),
  };
}

function semanticCellComponents(cells) {
  const remaining = new Set(cells);
  const components = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    const queue = [first];
    remaining.delete(first);
    const component = [];
    while (queue.length) {
      const current = queue.shift();
      const [x, z] = semanticParseCell(current);
      component.push([x, z]);
      for (const neighbour of [
        `${x - 1},${z}`,
        `${x + 1},${z}`,
        `${x},${z - 1}`,
        `${x},${z + 1}`,
      ]) {
        if (!remaining.delete(neighbour)) continue;
        queue.push(neighbour);
      }
    }
    components.push(component);
  }
  return components;
}

function semanticCellOutline(component) {
  const cells = new Set(component.map(([x, z]) => `${x},${z}`));
  const edges = [];
  for (const [x, z] of component) {
    if (!cells.has(`${x},${z - 1}`)) edges.push([[x, z], [x + 1, z]]);
    if (!cells.has(`${x + 1},${z}`)) edges.push([[x + 1, z], [x + 1, z + 1]]);
    if (!cells.has(`${x},${z + 1}`)) edges.push([[x + 1, z + 1], [x, z + 1]]);
    if (!cells.has(`${x - 1},${z}`)) edges.push([[x, z + 1], [x, z]]);
  }
  const outgoing = new Map();
  for (const [start, end] of edges) {
    const key = `${start[0]},${start[1]}`;
    const targets = outgoing.get(key) ?? [];
    targets.push(end);
    outgoing.set(key, targets);
  }
  const loops = [];
  const unused = new Set(edges.map(([start, end]) =>
    `${start[0]},${start[1]}>${end[0]},${end[1]}`));
  while (unused.size) {
    const firstEdge = unused.values().next().value;
    const [startText, endText] = firstEdge.split(">");
    const start = semanticParseCell(startText);
    let current = semanticParseCell(endText);
    const loop = [start];
    unused.delete(firstEdge);
    let guard = edges.length + 1;
    while ((current[0] !== start[0] || current[1] !== start[1]) && guard > 0) {
      loop.push(current);
      const targets = outgoing.get(`${current[0]},${current[1]}`) ?? [];
      const next = targets.find((target) =>
        unused.has(`${current[0]},${current[1]}>${target[0]},${target[1]}`));
      if (!next) break;
      unused.delete(`${current[0]},${current[1]}>${next[0]},${next[1]}`);
      current = next;
      guard -= 1;
    }
    if (current[0] === start[0] && current[1] === start[1] && loop.length >= 3) {
      loops.push(semanticSimplifyOutline(loop));
    }
  }
  if (!loops.length) {
    throw new ProcessingAgentError(
      "SEMANTIC_OUTLINE_FAILED",
      "The occupancy component did not produce a closed walkable outline",
      { failureClass: "processing", retryable: false },
    );
  }
  const outer = loops.sort((left, right) =>
    Math.abs(semanticPolygonArea(right)) - Math.abs(semanticPolygonArea(left)))[0];
  if (semanticPolygonArea(outer) < 0) outer.reverse();
  const startIndex = outer.reduce((best, point, index) => {
    const current = outer[best];
    return point[1] < current[1] || (point[1] === current[1] && point[0] < current[0])
      ? index
      : best;
  }, 0);
  return [...outer.slice(startIndex), ...outer.slice(0, startIndex)];
}

function semanticSimplifyOutline(points) {
  if (points.length <= 3) return points;
  const simplified = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index + points.length - 1) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const collinear =
      (previous[0] === current[0] && current[0] === next[0]) ||
      (previous[1] === current[1] && current[1] === next[1]);
    if (!collinear) simplified.push(current);
  }
  return simplified;
}

function semanticPolygonArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function semanticParseCell(value) {
  return value.split(",").map(Number);
}

function semanticCellSortKey(component) {
  return component
    .map(([x, z]) => `${String(x).padStart(12, "0")},${String(z).padStart(12, "0")}`)
    .sort()[0];
}

function semanticRound(value) {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function automaticallyRegisterSceneSignatures({
  baseline,
  candidate,
  parameters = {},
}) {
  if (!baseline?.voxels || !candidate?.voxels) {
    throw new TypeError("Baseline and candidate scene signatures are required");
  }
  if (Math.abs(baseline.voxelSizeM - candidate.voxelSizeM) > Number.EPSILON) {
    throw new ProcessingAgentError(
      "REGISTRATION_VOXEL_MISMATCH",
      "Automatic registration inputs must use the same voxel size",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const searchRadiusM = boundedNumber(
    parameters.searchRadiusM,
    Math.max(0.5, baseline.voxelSizeM * 8),
    baseline.voxelSizeM,
    20,
  );
  const maximumRmseMm = boundedNumber(
    parameters.maximumRmseMm,
    Math.max(50, baseline.voxelSizeM * 750),
    1,
    10_000,
  );
  const minimumOverlapPercent = boundedNumber(
    parameters.minimumOverlapPercent,
    55,
    5,
    100,
  );
  const maximumIterations = Math.round(boundedNumber(
    parameters.maximumIterations,
    12,
    1,
    50,
  ));
  const maximumRegistrationVoxels = Math.round(boundedNumber(
    parameters.maximumRegistrationVoxels,
    10_000,
    1_000,
    100_000,
  ));
  const baselinePoints = signaturePoints(baseline, maximumRegistrationVoxels);
  const candidatePoints = signaturePoints(candidate, maximumRegistrationVoxels);
  if (baselinePoints.length < 3 || candidatePoints.length < 3) {
    throw new ProcessingAgentError(
      "REGISTRATION_INPUT_TOO_SPARSE",
      "Automatic registration requires at least three occupied voxels in each scene",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const baselineCentroid = meanPoint(baselinePoints);
  const candidateCentroid = meanPoint(candidatePoints);
  const searchIndex = buildRegistrationIndex(baselinePoints, searchRadiusM);
  const seeds = [];
  for (let degrees = 0; degrees < 360; degrees += 30) {
    const yawRadians = degrees * Math.PI / 180;
    const rotatedCandidateCentroid = rotateY(candidateCentroid, yawRadians);
    const seed = {
      yawRadians,
      translation: subtract3(baselineCentroid, rotatedCandidateCentroid),
    };
    seeds.push(refineYawRegistration({
      baselinePoints,
      candidatePoints,
      searchIndex,
      searchRadiusM,
      initial: seed,
      maximumIterations,
    }));
  }
  seeds.sort(compareRegistrationSolutions);
  const best = seeds[0];
  const second = seeds.find((solution) => (
    angularDifferenceDegrees(solution.yawRadians, best.yawRadians) >= 10
  )) ?? null;
  const ambiguous = Boolean(
    second &&
    second.overlapPercent >= best.overlapPercent - 2 &&
    second.rmseM <= best.rmseM + Math.max(0.001, best.rmseM * 0.05),
  );
  const qualityGates = [
    {
      name: "minimum_overlap_percent",
      threshold: minimumOverlapPercent,
      observed: round(best.overlapPercent, 2),
      passed: best.overlapPercent >= minimumOverlapPercent,
    },
    {
      name: "maximum_rmse_mm",
      threshold: maximumRmseMm,
      observed: round(best.rmseM * 1000, 2),
      passed: best.rmseM * 1000 <= maximumRmseMm,
    },
    {
      name: "unambiguous_solution",
      threshold: true,
      observed: !ambiguous,
      passed: !ambiguous,
    },
  ];
  const accepted = qualityGates.every((gate) => gate.passed);
  const matrix4x4 = yawTransformMatrix(best.yawRadians, best.translation);
  return {
    method: "bounded-yaw-icp-v1",
    status: accepted ? "accepted" : "blocked",
    scope: "same_scale_gravity_aligned_rigid_yaw_and_translation",
    limitation:
      "This bounded automatic alignment preserves scale and the gravity axis, searches yaw and translation only, " +
      "and is not survey registration. Repetitive geometry, low overlap, scene change, drift, or a wrong axis/unit " +
      "declaration can produce a plausible but incorrect transform; human review and independent control remain required.",
    parameters: {
      searchRadiusM,
      maximumRmseMm,
      minimumOverlapPercent,
      maximumIterations,
      maximumRegistrationVoxels,
      seedYawStepDegrees: 30,
    },
    transform: {
      matrix4x4: matrix4x4.map((value) => round(value, 12)),
      yawDegrees: round(normalizeDegrees(best.yawRadians * 180 / Math.PI), 6),
      translationM: best.translation.map((value) => round(value, 9)),
      scale: 1,
    },
    summary: {
      baselineVoxels: baselinePoints.length,
      candidateVoxels: candidatePoints.length,
      matchedCandidateVoxels: best.matchCount,
      uniqueBaselineMatches: best.uniqueBaselineMatches,
      overlapPercent: round(best.overlapPercent, 2),
      rmseMm: round(best.rmseM * 1000, 2),
      p95ResidualMm: round(best.p95M * 1000, 2),
      maximumResidualMm: round(best.maximumM * 1000, 2),
      iterations: best.iterations,
      ambiguous,
      alternativeYawDegrees: second
        ? round(normalizeDegrees(second.yawRadians * 180 / Math.PI), 6)
        : null,
    },
    qualityGates,
    humanReviewRequired: true,
    registeredCandidate: accepted
      ? transformSceneSignature(candidate, matrix4x4)
      : null,
  };
}

export function transformSceneSignature(signature, matrix4x4) {
  if (!signature?.voxels || !Array.isArray(matrix4x4) || matrix4x4.length !== 16) {
    throw new TypeError("A scene signature and 4x4 transform are required");
  }
  const voxels = new Map();
  const bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
  for (const source of signature.voxels.values()) {
    const centroid = transformPoint(source.centroid, matrix4x4);
    const key = centroid.map((value) => voxelCoordinate(value, signature.voxelSizeM)).join(",");
    const target = voxels.get(key) ?? {
      key,
      count: 0,
      position: [0, 0, 0],
      color: [0, 0, 0],
      colorCount: 0,
    };
    target.count += source.count;
    for (let axis = 0; axis < 3; axis += 1) {
      target.position[axis] += centroid[axis] * source.count;
      bounds.min[axis] = Math.min(bounds.min[axis], centroid[axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], centroid[axis]);
    }
    if (source.meanColor) {
      for (let channel = 0; channel < 3; channel += 1) {
        target.color[channel] += source.meanColor[channel] * source.count;
      }
      target.colorCount += source.count;
    }
    voxels.set(key, target);
  }
  for (const voxel of voxels.values()) {
    voxel.centroid = voxel.position.map((value) => value / voxel.count);
    voxel.meanColor = voxel.colorCount
      ? voxel.color.map((value) => value / voxel.colorCount)
      : null;
    delete voxel.position;
    delete voxel.color;
  }
  return {
    ...signature,
    voxelCount: voxels.size,
    bounds,
    voxels,
    appliedTransform: matrix4x4,
  };
}

export function compareRegisteredScenes({
  baseline,
  candidate,
  parameters = {},
}) {
  if (!baseline?.voxels || !candidate?.voxels) {
    throw new TypeError("Both registered scene signatures are required");
  }
  if (Math.abs(baseline.voxelSizeM - candidate.voxelSizeM) > Number.EPSILON) {
    throw new ProcessingAgentError(
      "CHANGE_VOXEL_MISMATCH",
      "Registered scenes must use the same voxel size",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const structuralThreshold = boundedPercent(
    parameters.structuralChangeThresholdPercent,
    2,
  );
  const photometricThreshold = boundedPercent(
    parameters.photometricChangeThresholdPercent,
    12,
  );
  const centroidThresholdMm = boundedNumber(
    parameters.centroidChangeThresholdMm,
    baseline.voxelSizeM * 500,
    1,
    10_000,
  );
  const baselineKeys = new Set(baseline.voxels.keys());
  const candidateKeys = new Set(candidate.voxels.keys());
  const added = [...candidateKeys].filter((key) => !baselineKeys.has(key));
  const removed = [...baselineKeys].filter((key) => !candidateKeys.has(key));
  const common = [...baselineKeys].filter((key) => candidateKeys.has(key));
  const centroidDistances = [];
  const photometricDistances = [];
  const changedVoxels = [];

  for (const key of common) {
    const from = baseline.voxels.get(key);
    const to = candidate.voxels.get(key);
    const centroidMm = distance3(from.centroid, to.centroid) * 1000;
    centroidDistances.push(centroidMm);
    let photometricPercent = null;
    if (from.meanColor && to.meanColor) {
      photometricPercent = distance3(from.meanColor, to.meanColor) / Math.sqrt(3) * 100;
      photometricDistances.push(photometricPercent);
    }
    if (centroidMm >= centroidThresholdMm || (photometricPercent ?? 0) >= photometricThreshold) {
      changedVoxels.push({
        key,
        centroidDisplacementMm: round(centroidMm, 2),
        photometricDeltaPercent: photometricPercent === null ? null : round(photometricPercent, 2),
        baselinePointCount: from.count,
        candidatePointCount: to.count,
      });
    }
  }
  changedVoxels.sort((left, right) => (
    Math.max(right.centroidDisplacementMm / centroidThresholdMm, (right.photometricDeltaPercent ?? 0) / photometricThreshold) -
    Math.max(left.centroidDisplacementMm / centroidThresholdMm, (left.photometricDeltaPercent ?? 0) / photometricThreshold)
  ));
  const unionCount = baselineKeys.size + added.length;
  const structurallyChangedPercent = unionCount
    ? (added.length + removed.length) / unionCount * 100
    : 0;
  const p95Centroid = percentile(centroidDistances, 0.95);
  const p95Photometric = percentile(photometricDistances, 0.95);
  const materialSignals = [];
  if (structurallyChangedPercent >= structuralThreshold) {
    materialSignals.push(
      `Voxel occupancy changed by ${round(structurallyChangedPercent, 2)}%, above the ${structuralThreshold}% threshold.`,
    );
  }
  if (p95Photometric !== null && p95Photometric >= photometricThreshold) {
    materialSignals.push(
      `P95 photometric delta is ${round(p95Photometric, 2)}%, above the ${photometricThreshold}% threshold.`,
    );
  }
  if (p95Centroid !== null && p95Centroid >= centroidThresholdMm) {
    materialSignals.push(
      `P95 centroid displacement is ${round(p95Centroid, 2)} mm, above the ${centroidThresholdMm} mm threshold.`,
    );
  }
  return {
    method: "registered-ply-voxel-change-v1",
    result: materialSignals.length ? "changes_detected" : "no_material_change",
    scope: "registered_ply_voxel_occupancy_centroid_and_mean_colour",
    limitation:
      "This deterministic comparison assumes both PLY assets are already registered to the declared coordinate frame. " +
      "Voxel sampling can miss sub-voxel changes, and colour deltas can reflect lighting or exposure rather than physical change.",
    parameters: {
      voxelSizeM: baseline.voxelSizeM,
      structuralChangeThresholdPercent: structuralThreshold,
      photometricChangeThresholdPercent: photometricThreshold,
      centroidChangeThresholdMm: centroidThresholdMm,
    },
    sources: {
      baseline: signaturePublicSummary(baseline),
      candidate: signaturePublicSummary(candidate),
    },
    summary: {
      baselineVoxels: baselineKeys.size,
      candidateVoxels: candidateKeys.size,
      commonVoxels: common.length,
      addedVoxels: added.length,
      removedVoxels: removed.length,
      structurallyChangedPercent: round(structurallyChangedPercent, 2),
      photometricallyComparableVoxels: photometricDistances.length,
      changedCommonVoxels: changedVoxels.length,
      p50CentroidDisplacementMm: nullableRound(percentile(centroidDistances, 0.5)),
      p95CentroidDisplacementMm: nullableRound(p95Centroid),
      maximumCentroidDisplacementMm: nullableRound(maximum(centroidDistances)),
      p50PhotometricDeltaPercent: nullableRound(percentile(photometricDistances, 0.5)),
      p95PhotometricDeltaPercent: nullableRound(p95Photometric),
      maximumPhotometricDeltaPercent: nullableRound(maximum(photometricDistances)),
    },
    materialSignals,
    changedVoxels: changedVoxels.slice(0, 200),
    addedVoxelKeys: added.slice(0, 200),
    removedVoxelKeys: removed.slice(0, 200),
    generatedAt: new Date().toISOString(),
  };
}

export function processorFailure(error) {
  if (error instanceof ProcessingAgentError) {
    return {
      code: error.code,
      message: error.message,
      failureClass: error.failureClass,
      retryable: error.retryable,
      details: error.details,
    };
  }
  return {
    code: "PROCESSOR_ERROR",
    message: error instanceof Error ? error.message : String(error),
    failureClass: "unknown",
    retryable: true,
    details: {},
  };
}

function parsePlyDescriptor(bytes) {
  const marker = Buffer.from("end_header");
  const markerOffset = bytes.indexOf(marker);
  if (markerOffset < 0 || markerOffset > maximumHeaderBytes) {
    throw new ProcessingAgentError(
      "INVALID_PLY",
      "PLY header is missing end_header within the first 2 MiB",
      { failureClass: "input_validation", retryable: false },
    );
  }
  let dataOffset = markerOffset + marker.length;
  if (bytes[dataOffset] === 13) dataOffset += 1;
  if (bytes[dataOffset] === 10) dataOffset += 1;
  const lines = bytes.subarray(0, markerOffset + marker.length).toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== "ply") {
    throw new ProcessingAgentError(
      "INVALID_PLY",
      "Registered scene input is not a PLY file",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const format = lines.find((line) => line.startsWith("format "))?.split(/\s+/)[1];
  if (!["ascii", "binary_little_endian"].includes(format)) {
    throw new ProcessingAgentError(
      "UNSUPPORTED_PLY_FORMAT",
      `PLY format ${format ?? "unknown"} is not supported for change evidence`,
      { failureClass: "input_validation", retryable: false },
    );
  }
  const vertexElementIndex = lines.findIndex((line) => line.startsWith("element vertex "));
  if (vertexElementIndex < 0) {
    throw new ProcessingAgentError(
      "INVALID_PLY",
      "PLY has no vertex element",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const vertexCount = Number(lines[vertexElementIndex].split(/\s+/)[2]);
  if (!Number.isSafeInteger(vertexCount) || vertexCount <= 0) {
    throw new ProcessingAgentError(
      "INVALID_PLY",
      "PLY declares no comparable vertices",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const properties = [];
  for (let index = vertexElementIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("element ") || line === "end_header") break;
    if (!line.startsWith("property ")) continue;
    const parts = line.split(/\s+/);
    if (parts[1] === "list") {
      throw new ProcessingAgentError(
        "UNSUPPORTED_PLY_VERTEX_LIST",
        "PLY vertex list properties are not supported for registered change evidence",
        { failureClass: "input_validation", retryable: false },
      );
    }
    const type = scalarType(parts[1]);
    const name = parts[2];
    if (!type || !name) {
      throw new ProcessingAgentError(
        "UNSUPPORTED_PLY_PROPERTY",
        `Unsupported PLY vertex property: ${line}`,
        { failureClass: "input_validation", retryable: false },
      );
    }
    properties.push({ name, ...type });
  }
  const propertyIndex = Object.fromEntries(properties.map((property, index) => [property.name, index]));
  for (const axis of ["x", "y", "z"]) {
    if (!Number.isInteger(propertyIndex[axis])) {
      throw new ProcessingAgentError(
        "INVALID_PLY",
        `PLY is missing the ${axis} coordinate`,
        { failureClass: "input_validation", retryable: false },
      );
    }
  }
  return {
    format,
    vertexCount,
    properties,
    propertyIndex,
    recordBytes: properties.reduce((total, property) => total + property.bytes, 0),
    dataOffset,
  };
}

function parseAsciiVertices(bytes, descriptor, consume) {
  const body = bytes.subarray(descriptor.dataOffset).toString("utf8");
  const lines = body.split(/\r?\n/);
  let vertexIndex = 0;
  for (const line of lines) {
    if (vertexIndex >= descriptor.vertexCount) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const values = trimmed.split(/\s+/).slice(0, descriptor.properties.length).map(Number);
    if (values.length !== descriptor.properties.length) {
      throw new ProcessingAgentError(
        "TRUNCATED_PLY",
        `ASCII PLY vertex ${vertexIndex} has ${values.length} of ${descriptor.properties.length} properties`,
        { failureClass: "input_validation", retryable: false },
      );
    }
    consume(values, vertexIndex);
    vertexIndex += 1;
  }
  if (vertexIndex !== descriptor.vertexCount) {
    throw new ProcessingAgentError(
      "TRUNCATED_PLY",
      `ASCII PLY contains ${vertexIndex} of ${descriptor.vertexCount} declared vertices`,
      { failureClass: "input_validation", retryable: false },
    );
  }
}

function parseBinaryVertices(bytes, descriptor, consume) {
  const requiredBytes = descriptor.dataOffset + descriptor.vertexCount * descriptor.recordBytes;
  if (bytes.length < requiredBytes) {
    throw new ProcessingAgentError(
      "TRUNCATED_PLY",
      `Binary PLY is ${requiredBytes - bytes.length} bytes shorter than its declared vertex data`,
      { failureClass: "input_validation", retryable: false },
    );
  }
  const values = new Array(descriptor.properties.length);
  let recordOffset = descriptor.dataOffset;
  for (let vertexIndex = 0; vertexIndex < descriptor.vertexCount; vertexIndex += 1) {
    let propertyOffset = recordOffset;
    for (let propertyIndex = 0; propertyIndex < descriptor.properties.length; propertyIndex += 1) {
      const property = descriptor.properties[propertyIndex];
      values[propertyIndex] = property.read(bytes, propertyOffset);
      propertyOffset += property.bytes;
    }
    consume(values, vertexIndex);
    recordOffset += descriptor.recordBytes;
  }
}

function scalarType(name) {
  return {
    char: { bytes: 1, read: (buffer, offset) => buffer.readInt8(offset) },
    int8: { bytes: 1, read: (buffer, offset) => buffer.readInt8(offset) },
    uchar: { bytes: 1, read: (buffer, offset) => buffer.readUInt8(offset) },
    uint8: { bytes: 1, read: (buffer, offset) => buffer.readUInt8(offset) },
    short: { bytes: 2, read: (buffer, offset) => buffer.readInt16LE(offset) },
    int16: { bytes: 2, read: (buffer, offset) => buffer.readInt16LE(offset) },
    ushort: { bytes: 2, read: (buffer, offset) => buffer.readUInt16LE(offset) },
    uint16: { bytes: 2, read: (buffer, offset) => buffer.readUInt16LE(offset) },
    int: { bytes: 4, read: (buffer, offset) => buffer.readInt32LE(offset) },
    int32: { bytes: 4, read: (buffer, offset) => buffer.readInt32LE(offset) },
    uint: { bytes: 4, read: (buffer, offset) => buffer.readUInt32LE(offset) },
    uint32: { bytes: 4, read: (buffer, offset) => buffer.readUInt32LE(offset) },
    float: { bytes: 4, read: (buffer, offset) => buffer.readFloatLE(offset) },
    float32: { bytes: 4, read: (buffer, offset) => buffer.readFloatLE(offset) },
    double: { bytes: 8, read: (buffer, offset) => buffer.readDoubleLE(offset) },
    float64: { bytes: 8, read: (buffer, offset) => buffer.readDoubleLE(offset) },
  }[name] ?? null;
}

function readPlyColor(values, propertyIndex) {
  if (
    Number.isInteger(propertyIndex.red) &&
    Number.isInteger(propertyIndex.green) &&
    Number.isInteger(propertyIndex.blue)
  ) {
    return [
      clamp01(values[propertyIndex.red] / 255),
      clamp01(values[propertyIndex.green] / 255),
      clamp01(values[propertyIndex.blue] / 255),
    ];
  }
  if (
    Number.isInteger(propertyIndex.f_dc_0) &&
    Number.isInteger(propertyIndex.f_dc_1) &&
    Number.isInteger(propertyIndex.f_dc_2)
  ) {
    const c0 = 0.28209479177387814;
    return [
      clamp01(0.5 + c0 * values[propertyIndex.f_dc_0]),
      clamp01(0.5 + c0 * values[propertyIndex.f_dc_1]),
      clamp01(0.5 + c0 * values[propertyIndex.f_dc_2]),
    ];
  }
  return null;
}

function signaturePublicSummary(signature) {
  return {
    format: signature.format,
    vertexCount: signature.vertexCount,
    sampledPointCount: signature.sampledPointCount,
    samplingStride: signature.samplingStride,
    voxelCount: signature.voxelCount,
    voxelSizeM: signature.voxelSizeM,
    hasPhotometricData: signature.hasPhotometricData,
    bounds: signature.bounds,
  };
}

function signaturePoints(signature, maximumPoints) {
  const voxels = [...signature.voxels.values()];
  const stride = Math.max(1, Math.ceil(voxels.length / maximumPoints));
  const points = [];
  for (let index = 0; index < voxels.length; index += stride) {
    points.push({
      index,
      position: voxels[index].centroid,
    });
  }
  return points;
}

function buildRegistrationIndex(points, cellSize) {
  const cells = new Map();
  for (const point of points) {
    const key = registrationCellKey(point.position, cellSize);
    const cell = cells.get(key) ?? [];
    cell.push(point);
    cells.set(key, cell);
  }
  return { cells, cellSize };
}

function registrationCellKey(point, cellSize) {
  return point.map((value) => Math.floor(value / cellSize)).join(",");
}

function voxelCoordinate(value, voxelSize) {
  const scaled = value / voxelSize;
  const nearestInteger = Math.round(scaled);
  return Math.abs(scaled - nearestInteger) <= 1e-9
    ? nearestInteger
    : Math.floor(scaled);
}

function refineYawRegistration({
  baselinePoints,
  candidatePoints,
  searchIndex,
  searchRadiusM,
  initial,
  maximumIterations,
}) {
  let current = initial;
  let iterations = 0;
  for (; iterations < maximumIterations; iterations += 1) {
    const correspondences = registrationCorrespondences(
      baselinePoints,
      candidatePoints,
      searchIndex,
      searchRadiusM,
      current,
    );
    if (correspondences.length < 3) break;
    const trimmed = trimRegistrationCorrespondences(correspondences);
    const fitted = fitYawTransform(trimmed);
    if (!fitted) break;
    const yawDelta = angularDifferenceDegrees(fitted.yawRadians, current.yawRadians);
    const translationDelta = distance3(fitted.translation, current.translation);
    current = fitted;
    if (yawDelta < 0.001 && translationDelta < 0.0001) {
      iterations += 1;
      break;
    }
  }
  const correspondences = registrationCorrespondences(
    baselinePoints,
    candidatePoints,
    searchIndex,
    searchRadiusM,
    current,
  );
  const distances = correspondences.map((item) => item.distanceM);
  const uniqueBaselineMatches = new Set(correspondences.map((item) => item.target.index)).size;
  const candidateCoverage = correspondences.length / candidatePoints.length * 100;
  const baselineCoverage = uniqueBaselineMatches / baselinePoints.length * 100;
  return {
    ...current,
    matchCount: correspondences.length,
    uniqueBaselineMatches,
    overlapPercent: Math.min(candidateCoverage, baselineCoverage),
    rmseM: distances.length
      ? Math.sqrt(distances.reduce((total, value) => total + value ** 2, 0) / distances.length)
      : Number.POSITIVE_INFINITY,
    p95M: percentile(distances, 0.95) ?? Number.POSITIVE_INFINITY,
    maximumM: maximum(distances) ?? Number.POSITIVE_INFINITY,
    iterations,
  };
}

function registrationCorrespondences(
  baselinePoints,
  candidatePoints,
  searchIndex,
  searchRadiusM,
  transform,
) {
  const result = [];
  const radiusSquared = searchRadiusM ** 2;
  for (const source of candidatePoints) {
    const transformed = add3(rotateY(source.position, transform.yawRadians), transform.translation);
    const origin = transformed.map((value) => Math.floor(value / searchIndex.cellSize));
    let nearest = null;
    let nearestSquared = radiusSquared;
    for (let x = origin[0] - 1; x <= origin[0] + 1; x += 1) {
      for (let y = origin[1] - 1; y <= origin[1] + 1; y += 1) {
        for (let z = origin[2] - 1; z <= origin[2] + 1; z += 1) {
          const cell = searchIndex.cells.get(`${x},${y},${z}`);
          if (!cell) continue;
          for (const target of cell) {
            const squared = squaredDistance3(transformed, target.position);
            if (squared <= nearestSquared) {
              nearest = target;
              nearestSquared = squared;
            }
          }
        }
      }
    }
    if (nearest) {
      result.push({
        source,
        target: nearest,
        transformed,
        distanceM: Math.sqrt(nearestSquared),
      });
    }
  }
  return result;
}

function trimRegistrationCorrespondences(correspondences) {
  if (correspondences.length <= 5) return correspondences;
  const sorted = [...correspondences].sort((left, right) => left.distanceM - right.distanceM);
  return sorted.slice(0, Math.max(3, Math.ceil(sorted.length * 0.8)));
}

function fitYawTransform(correspondences) {
  if (correspondences.length < 3) return null;
  const sourceMean = meanPoint(correspondences.map((item) => item.source));
  const targetMean = meanPoint(correspondences.map((item) => item.target));
  let numerator = 0;
  let denominator = 0;
  for (const correspondence of correspondences) {
    const source = subtract3(correspondence.source.position, sourceMean);
    const target = subtract3(correspondence.target.position, targetMean);
    numerator += source[2] * target[0] - source[0] * target[2];
    denominator += source[0] * target[0] + source[2] * target[2];
  }
  const yawRadians = Math.atan2(numerator, denominator);
  return {
    yawRadians,
    translation: subtract3(targetMean, rotateY(sourceMean, yawRadians)),
  };
}

function compareRegistrationSolutions(left, right) {
  if (Math.abs(left.overlapPercent - right.overlapPercent) > 0.001) {
    return right.overlapPercent - left.overlapPercent;
  }
  if (Math.abs(left.rmseM - right.rmseM) > 0.000001) return left.rmseM - right.rmseM;
  return normalizeDegrees(left.yawRadians * 180 / Math.PI) -
    normalizeDegrees(right.yawRadians * 180 / Math.PI);
}

function meanPoint(points) {
  const mean = [0, 0, 0];
  for (const item of points) {
    const point = Array.isArray(item) ? item : item.position;
    mean[0] += point[0];
    mean[1] += point[1];
    mean[2] += point[2];
  }
  return mean.map((value) => value / points.length);
}

function rotateY(point, yawRadians) {
  const cosine = Math.cos(yawRadians);
  const sine = Math.sin(yawRadians);
  return [
    cosine * point[0] + sine * point[2],
    point[1],
    -sine * point[0] + cosine * point[2],
  ];
}

function yawTransformMatrix(yawRadians, translation) {
  const cosine = Math.cos(yawRadians);
  const sine = Math.sin(yawRadians);
  return [
    cosine, 0, -sine, 0,
    0, 1, 0, 0,
    sine, 0, cosine, 0,
    translation[0], translation[1], translation[2], 1,
  ];
}

function transformPoint(point, matrix) {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

function add3(left, right) {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract3(left, right) {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function squaredDistance3(left, right) {
  return (
    (left[0] - right[0]) ** 2 +
    (left[1] - right[1]) ** 2 +
    (left[2] - right[2]) ** 2
  );
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function angularDifferenceDegrees(left, right) {
  const delta = Math.abs(normalizeDegrees((left - right) * 180 / Math.PI));
  return Math.min(delta, 360 - delta);
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function maximum(values) {
  if (!values.length) return null;
  let result = Number.NEGATIVE_INFINITY;
  for (const value of values) result = Math.max(result, value);
  return result;
}

function distance3(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function boundedPercent(value, fallback) {
  return boundedNumber(value, fallback, 0, 100);
}

function boundedNumber(value, fallback, minimum, maximumValue) {
  const number = Number.isFinite(value) ? value : fallback;
  return Math.min(maximumValue, Math.max(minimum, number));
}

function nullableRound(value) {
  return value === null ? null : round(value, 2);
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
