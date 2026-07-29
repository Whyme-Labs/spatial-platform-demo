import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname } from "node:path";

const maximumHeaderBytes = 64 * 1024;
const sphericalHarmonicConstant = 0.28209479177387814;
export const lingbotGaussianDefaults = Object.freeze({
  scaleMeters: 0.008,
  alpha: 0.9,
  coordinateTransform: "opencv-to-y-up",
});
const outputPropertyNames = [
  "x", "y", "z",
  "f_dc_0", "f_dc_1", "f_dc_2",
  "opacity",
  "scale_0", "scale_1", "scale_2",
  "rot_0", "rot_1", "rot_2", "rot_3",
];
const scalarTypes = new Map([
  ["char", { bytes: 1, read: (bytes, offset) => bytes.readInt8(offset) }],
  ["int8", { bytes: 1, read: (bytes, offset) => bytes.readInt8(offset) }],
  ["uchar", { bytes: 1, read: (bytes, offset) => bytes.readUInt8(offset) }],
  ["uint8", { bytes: 1, read: (bytes, offset) => bytes.readUInt8(offset) }],
  ["short", { bytes: 2, read: (bytes, offset) => bytes.readInt16LE(offset) }],
  ["int16", { bytes: 2, read: (bytes, offset) => bytes.readInt16LE(offset) }],
  ["ushort", { bytes: 2, read: (bytes, offset) => bytes.readUInt16LE(offset) }],
  ["uint16", { bytes: 2, read: (bytes, offset) => bytes.readUInt16LE(offset) }],
  ["int", { bytes: 4, read: (bytes, offset) => bytes.readInt32LE(offset) }],
  ["int32", { bytes: 4, read: (bytes, offset) => bytes.readInt32LE(offset) }],
  ["uint", { bytes: 4, read: (bytes, offset) => bytes.readUInt32LE(offset) }],
  ["uint32", { bytes: 4, read: (bytes, offset) => bytes.readUInt32LE(offset) }],
  ["float", { bytes: 4, read: (bytes, offset) => bytes.readFloatLE(offset) }],
  ["float32", { bytes: 4, read: (bytes, offset) => bytes.readFloatLE(offset) }],
  ["double", { bytes: 8, read: (bytes, offset) => bytes.readDoubleLE(offset) }],
  ["float64", { bytes: 8, read: (bytes, offset) => bytes.readDoubleLE(offset) }],
]);

export function parsePointCloudPlyHeader(bytes) {
  const headerBytes = Buffer.from(bytes).subarray(0, maximumHeaderBytes);
  const endHeader = findHeaderEnd(headerBytes);
  if (!endHeader) {
    throw new Error("PLY header is missing end_header within the first 64 KiB");
  }
  const lines = headerBytes.subarray(0, endHeader.offset)
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== "ply") throw new Error("Source is not a PLY file");
  const format = lines.find((line) => line.startsWith("format "))?.split(/\s+/)[1];
  if (format !== "binary_little_endian") {
    throw new Error(`Source PLY must use binary_little_endian, received ${format ?? "unknown"}`);
  }

  let currentElement;
  let vertexCount;
  let vertexStride = 0;
  const properties = [];
  for (const line of lines) {
    const fields = line.split(/\s+/);
    if (fields[0] === "element") {
      currentElement = fields[1];
      if (currentElement === "vertex") vertexCount = Number(fields[2]);
      continue;
    }
    if (fields[0] !== "property" || currentElement !== "vertex") continue;
    if (fields[1] === "list") {
      throw new Error("List properties are not supported in the vertex element");
    }
    const scalar = scalarTypes.get(fields[1]);
    if (!scalar) throw new Error(`Unsupported PLY scalar type ${fields[1]}`);
    properties.push({
      name: fields[2],
      type: fields[1],
      offset: vertexStride,
      bytes: scalar.bytes,
    });
    vertexStride += scalar.bytes;
  }
  if (!Number.isSafeInteger(vertexCount) || vertexCount <= 0) {
    throw new Error("Source PLY declares no vertices");
  }
  for (const name of ["x", "y", "z", "red", "green", "blue"]) {
    if (!properties.some((property) => property.name === name)) {
      throw new Error(`Source point cloud is missing required ${name} property`);
    }
  }
  return {
    format,
    vertexCount,
    vertexStride,
    headerBytes: endHeader.bytes,
    properties: properties.map(({ name, type, offset }) => ({ name, type, offset })),
  };
}

export async function convertPointCloudToDegreeZeroGaussian({
  sourcePath,
  outputPath,
  scaleMeters = lingbotGaussianDefaults.scaleMeters,
  alpha = lingbotGaussianDefaults.alpha,
  coordinateTransform = lingbotGaussianDefaults.coordinateTransform,
}) {
  if (!sourcePath || !outputPath) throw new Error("sourcePath and outputPath are required");
  if (!Number.isFinite(scaleMeters) || scaleMeters <= 0) {
    throw new Error("scaleMeters must be a positive finite number");
  }
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    throw new Error("alpha must be greater than 0 and less than 1");
  }
  if (!["none", "opencv-to-y-up"].includes(coordinateTransform)) {
    throw new Error(`Unsupported coordinate transform ${coordinateTransform}`);
  }

  const sourceHandle = await open(sourcePath, "r");
  let outputHandle;
  const temporaryOutputPath = `${outputPath}.tmp-${process.pid}`;
  try {
    const sourceInfo = await sourceHandle.stat();
    const initialBytes = Buffer.alloc(Math.min(maximumHeaderBytes, sourceInfo.size));
    const initialRead = await sourceHandle.read(initialBytes, 0, initialBytes.length, 0);
    const descriptor = parsePointCloudPlyHeader(initialBytes.subarray(0, initialRead.bytesRead));
    const requiredSourceBytes = descriptor.headerBytes
      + descriptor.vertexCount * descriptor.vertexStride;
    if (sourceInfo.size < requiredSourceBytes) {
      throw new Error(
        `Source PLY is truncated: expected at least ${requiredSourceBytes} bytes, received ${sourceInfo.size}`,
      );
    }

    await mkdir(dirname(outputPath), { recursive: true });
    outputHandle = await open(temporaryOutputPath, "wx");
    const outputHeader = createGaussianHeader(descriptor.vertexCount);
    await outputHandle.write(outputHeader);

    const propertyMap = new Map(descriptor.properties.map((property) => [
      property.name,
      {
        ...property,
        read: scalarTypes.get(property.type).read,
      },
    ]));
    const chunkVertexCount = 16 * 1024;
    const sourceChunk = Buffer.alloc(chunkVertexCount * descriptor.vertexStride);
    const outputChunk = Buffer.alloc(chunkVertexCount * outputPropertyNames.length * 4);
    const logScale = Math.log(scaleMeters);
    const logitAlpha = Math.log(alpha / (1 - alpha));
    const bounds = {
      minimum: [Infinity, Infinity, Infinity],
      maximum: [-Infinity, -Infinity, -Infinity],
    };
    let outputVertexOffset = 0;

    while (outputVertexOffset < descriptor.vertexCount) {
      const count = Math.min(
        chunkVertexCount,
        descriptor.vertexCount - outputVertexOffset,
      );
      const bytesToRead = count * descriptor.vertexStride;
      const sourcePosition = descriptor.headerBytes
        + outputVertexOffset * descriptor.vertexStride;
      const read = await sourceHandle.read(sourceChunk, 0, bytesToRead, sourcePosition);
      if (read.bytesRead !== bytesToRead) {
        throw new Error(`Source PLY ended at vertex ${outputVertexOffset}`);
      }
      for (let index = 0; index < count; index += 1) {
        const sourceOffset = index * descriptor.vertexStride;
        const outputOffset = index * outputPropertyNames.length * 4;
        const sourceCoordinates = ["x", "y", "z"].map((name) =>
          readProperty(sourceChunk, sourceOffset, propertyMap.get(name)));
        const [x, y, z] = coordinateTransform === "opencv-to-y-up"
          ? [sourceCoordinates[0], -sourceCoordinates[1], -sourceCoordinates[2]]
          : sourceCoordinates;
        const rgb = ["red", "green", "blue"].map((name) =>
          readProperty(sourceChunk, sourceOffset, propertyMap.get(name)));
        const values = [
          x, y, z,
          ...rgb.map((channel) =>
            (Math.min(255, Math.max(0, channel)) / 255 - 0.5)
              / sphericalHarmonicConstant),
          logitAlpha,
          logScale, logScale, logScale,
          1, 0, 0, 0,
        ];
        for (let propertyIndex = 0; propertyIndex < values.length; propertyIndex += 1) {
          outputChunk.writeFloatLE(values[propertyIndex], outputOffset + propertyIndex * 4);
        }
        for (let axis = 0; axis < 3; axis += 1) {
          bounds.minimum[axis] = Math.min(bounds.minimum[axis], values[axis]);
          bounds.maximum[axis] = Math.max(bounds.maximum[axis], values[axis]);
        }
      }
      await outputHandle.write(
        outputChunk.subarray(0, count * outputPropertyNames.length * 4),
      );
      outputVertexOffset += count;
    }
    await outputHandle.close();
    outputHandle = undefined;
    await rename(temporaryOutputPath, outputPath);

    const [sourceSha256, outputSha256, outputInfo] = await Promise.all([
      sha256File(sourcePath),
      sha256File(outputPath),
      stat(outputPath),
    ]);
    return {
      schemaVersion: 1,
      artifactKind: "derived_degree_zero_gaussian_visualization",
      claimBoundary: "This is a surfel-like visualization derived from LingBot Map's colored point cloud; it is not a learned Gaussian reconstruction emitted by LingBot Map.",
      sourcePath,
      outputPath,
      sourceSha256,
      outputSha256,
      sourceVertexCount: descriptor.vertexCount,
      outputVertexCount: descriptor.vertexCount,
      outputBytes: outputInfo.size,
      sphericalHarmonicDegree: 0,
      scaleMeters,
      alpha,
      coordinateTransform,
      bounds,
    };
  } catch (error) {
    if (outputHandle) await outputHandle.close().catch(() => {});
    await rm(temporaryOutputPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    await sourceHandle.close();
  }
}

function findHeaderEnd(bytes) {
  for (const marker of [Buffer.from("end_header\n"), Buffer.from("end_header\r\n")]) {
    const offset = bytes.indexOf(marker);
    if (offset >= 0) return { offset: offset + "end_header".length, bytes: offset + marker.length };
  }
  return undefined;
}

function createGaussianHeader(vertexCount) {
  const lines = [
    "ply",
    "format binary_little_endian 1.0",
    "comment derived degree-0 Gaussian visualization; not a learned LingBot Gaussian reconstruction",
    `element vertex ${vertexCount}`,
    ...outputPropertyNames.map((name) => `property float ${name}`),
  ];
  let paddingLength = 0;
  while (true) {
    const padding = paddingLength ? [`comment ${" ".repeat(paddingLength)}`] : [];
    const header = Buffer.from([...lines, ...padding, "end_header", ""].join("\n"));
    if (header.length % 4 === 0) return header;
    paddingLength += 1;
  }
}

function readProperty(bytes, vertexOffset, property) {
  return property.read(bytes, vertexOffset + property.offset);
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}
