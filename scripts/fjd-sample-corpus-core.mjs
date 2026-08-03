import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Transform } from "node:stream";

// ZIP EOCD is 22 bytes plus a protocol-defined comment of at most 65,535 bytes.
export const ZIP_END_RECORD_SEARCH_BYTES = 22 + 65_535;

export function fjdQualificationGates(qualificationCase, pointCloudDecoder = null) {
  const metricCoordinateRegistration = pointCloudDecoder?.coordinateRegistration === "declared"
    ? "qualifiable"
    : pointCloudDecoder?.coordinateRegistration === "missing"
      ? "blocked_missing_units_axis_origin"
      : "not_checked";
  const sharedCaptureFrame = qualificationCase.relationship === "shared-frame"
    ? "qualifiable"
    : "blocked_missing_paired_sample";
  let automaticWalkableScene = "qualifiable";
  if (sharedCaptureFrame !== "qualifiable") {
    automaticWalkableScene = "blocked_missing_paired_sample";
  } else if (metricCoordinateRegistration !== "qualifiable") {
    automaticWalkableScene = metricCoordinateRegistration === "not_checked"
      ? "not_checked"
      : "blocked_missing_units_axis_origin";
  }
  return {
    gaussianPlyValidation: "qualifiable",
    sparkRadBuild: "qualifiable",
    pointCloudDecode: "qualifiable",
    metricCoordinateRegistration,
    sharedCaptureFrame,
    privatePlatformImport: "not_run",
    browserRender: "not_run",
    automaticWalkableScene,
    publicRedistribution: "blocked_no_dataset_license",
  };
}

export function googleDriveDownloadUrl(fileId) {
  if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
    throw new Error("Google Drive fileId must contain only URL-safe identifier characters");
  }
  const url = new URL("https://drive.usercontent.google.com/download");
  url.searchParams.set("id", fileId);
  url.searchParams.set("export", "download");
  url.searchParams.set("confirm", "t");
  return url.toString();
}

export function parseZipEndRecord(tail, { archiveSizeBytes, tailStart }) {
  requireBuffer(tail, "ZIP tail");
  if (!Number.isSafeInteger(archiveSizeBytes) || archiveSizeBytes <= 0) {
    throw new Error("ZIP archive size must be a positive safe integer");
  }
  if (!Number.isSafeInteger(tailStart) || tailStart < 0) {
    throw new Error("ZIP tail start must be a non-negative safe integer");
  }
  let offset = -1;
  for (let candidate = tail.byteLength - 22; candidate >= 0; candidate -= 1) {
    if (tail.readUInt32LE(candidate) !== 0x06054b50) continue;
    const commentLength = tail.readUInt16LE(candidate + 20);
    if (candidate + 22 + commentLength === tail.byteLength) {
      offset = candidate;
      break;
    }
  }
  if (offset < 0) throw new Error("ZIP end-of-central-directory record is missing");

  const diskNumber = tail.readUInt16LE(offset + 4);
  const centralDirectoryDisk = tail.readUInt16LE(offset + 6);
  const entriesOnDisk = tail.readUInt16LE(offset + 8);
  const entryCount = tail.readUInt16LE(offset + 10);
  const centralDirectorySize = tail.readUInt32LE(offset + 12);
  const centralDirectoryOffset = tail.readUInt32LE(offset + 16);
  if (
    entriesOnDisk === 0xffff ||
    entryCount === 0xffff ||
    centralDirectorySize === 0xffff_ffff ||
    centralDirectoryOffset === 0xffff_ffff
  ) {
    throw new Error("ZIP64 archives are not supported by the selective FJD extractor");
  }
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("Multi-disk ZIP archives are not supported by the selective FJD extractor");
  }
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  const endRecordAbsoluteOffset = tailStart + offset;
  if (centralDirectoryEnd > endRecordAbsoluteOffset || centralDirectoryEnd > archiveSizeBytes) {
    throw new Error("ZIP central directory points outside the archive");
  }
  return {
    entryCount,
    centralDirectoryOffset,
    centralDirectorySize,
    endRecordOffset: endRecordAbsoluteOffset,
  };
}

export function parseZipCentralDirectory(bytes, expectedEntryCount) {
  requireBuffer(bytes, "ZIP central directory");
  if (!Number.isSafeInteger(expectedEntryCount) || expectedEntryCount < 0) {
    throw new Error("ZIP entry count must be a non-negative safe integer");
  }
  const entries = [];
  const names = new Set();
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (offset + 46 > bytes.byteLength || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central-directory entry at byte ${offset}`);
    }
    const flags = bytes.readUInt16LE(offset + 8);
    if ((flags & 0x1) !== 0) throw new Error("Encrypted ZIP entries are not supported");
    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const crc32 = bytes.readUInt32LE(offset + 16);
    const compressedSizeBytes = bytes.readUInt32LE(offset + 20);
    const uncompressedSizeBytes = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const diskStart = bytes.readUInt16LE(offset + 34);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    if (
      compressedSizeBytes === 0xffff_ffff ||
      uncompressedSizeBytes === 0xffff_ffff ||
      localHeaderOffset === 0xffff_ffff
    ) {
      throw new Error("ZIP64 entries are not supported by the selective FJD extractor");
    }
    if (diskStart !== 0) throw new Error("Multi-disk ZIP entries are not supported");
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > bytes.byteLength) throw new Error("Truncated ZIP central-directory entry");
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    assertSafeArchivePath(name);
    if (names.has(name)) throw new Error(`Duplicate ZIP entry path: ${name}`);
    names.add(name);
    entries.push({
      name,
      compressionMethod,
      crc32,
      compressedSizeBytes,
      uncompressedSizeBytes,
      localHeaderOffset,
    });
    offset = entryEnd;
  }
  if (entries.length !== expectedEntryCount) {
    throw new Error(
      `ZIP entry count mismatch: directory declared ${expectedEntryCount}, parsed ${entries.length}`,
    );
  }
  return entries;
}

export function parseZipLocalFileHeader(bytes, expectedEntry) {
  requireBuffer(bytes, "ZIP local header");
  if (bytes.byteLength < 30 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`Invalid ZIP local header for ${expectedEntry.name}`);
  }
  const flags = bytes.readUInt16LE(6);
  if ((flags & 0x1) !== 0) throw new Error("Encrypted ZIP entries are not supported");
  const compressionMethod = bytes.readUInt16LE(8);
  const nameLength = bytes.readUInt16LE(26);
  const extraLength = bytes.readUInt16LE(28);
  const headerSizeBytes = 30 + nameLength + extraLength;
  if (headerSizeBytes > bytes.byteLength) {
    throw new Error(`Truncated ZIP local header for ${expectedEntry.name}`);
  }
  const name = bytes.subarray(30, 30 + nameLength).toString("utf8");
  if (name !== expectedEntry.name) {
    throw new Error(`ZIP local path mismatch: expected ${expectedEntry.name}, got ${name}`);
  }
  if (compressionMethod !== expectedEntry.compressionMethod) {
    throw new Error(
      `ZIP compression mismatch for ${name}: directory=${expectedEntry.compressionMethod}, local=${compressionMethod}`,
    );
  }
  if (![0, 8].includes(compressionMethod)) {
    throw new Error(`ZIP compression method ${compressionMethod} is not supported for ${name}`);
  }
  const dataOffset = expectedEntry.localHeaderOffset + headerSizeBytes;
  return {
    name,
    headerSizeBytes,
    dataOffset,
    dataEndInclusive: dataOffset + expectedEntry.compressedSizeBytes - 1,
  };
}

export function parseZipLocalHeaderSize(bytes) {
  requireBuffer(bytes, "ZIP local fixed header");
  if (bytes.byteLength < 30 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("Invalid ZIP local fixed header");
  }
  return 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
}

export function inspectLasHeader(bytes) {
  requireBuffer(bytes, "LAS header");
  if (bytes.byteLength < 227 || bytes.subarray(0, 4).toString("ascii") !== "LASF") {
    throw new Error("LAS header is missing the LASF signature or required LAS 1.x fields");
  }
  const versionMajor = bytes[24];
  const versionMinor = bytes[25];
  const headerSizeBytes = bytes.readUInt16LE(94);
  if (headerSizeBytes < 227 || headerSizeBytes > bytes.byteLength) {
    throw new Error(
      `LAS header size is invalid: declared ${headerSizeBytes}, available ${bytes.byteLength}`,
    );
  }
  const legacyPointCount = bytes.readUInt32LE(107);
  let pointCount = legacyPointCount;
  if (versionMajor === 1 && versionMinor >= 4 && headerSizeBytes >= 255) {
    const extended = bytes.readBigUInt64LE(247);
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`LAS point count exceeds JavaScript's safe integer range: ${extended}`);
    }
    if (extended > 0n) pointCount = Number(extended);
  }
  return {
    signature: "LASF",
    version: `${versionMajor}.${versionMinor}`,
    headerSizeBytes,
    pointDataOffset: bytes.readUInt32LE(96),
    pointFormat: bytes[104] & 0x3f,
    pointRecordLengthBytes: bytes.readUInt16LE(105),
    pointCount,
    scale: [bytes.readDoubleLE(131), bytes.readDoubleLE(139), bytes.readDoubleLE(147)],
    bounds: {
      min: [bytes.readDoubleLE(187), bytes.readDoubleLE(203), bytes.readDoubleLE(219)],
      max: [bytes.readDoubleLE(179), bytes.readDoubleLE(195), bytes.readDoubleLE(211)],
    },
  };
}

export function validateFjdSampleManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== "whymelabs.fjd-sample-corpus.v1") {
    throw new Error("FJD sample manifest schemaVersion is unsupported");
  }
  if (manifest.redistribution !== "not-granted") {
    throw new Error("FJD sample manifest must declare redistribution=not-granted");
  }
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
    throw new Error("FJD sample manifest must contain fixtures");
  }
  const ids = new Set();
  for (const fixture of manifest.fixtures) {
    if (!fixture?.id || ids.has(fixture.id)) {
      throw new Error(`FJD fixture id is missing or duplicated: ${fixture?.id ?? "missing"}`);
    }
    ids.add(fixture.id);
    if (!["gaussian_splat", "metric_point_cloud"].includes(fixture.role)) {
      throw new Error(`${fixture.id} has unsupported role ${fixture.role}`);
    }
    if (!fixture.source?.fileId) throw new Error(`${fixture.id} is missing a source fileId`);
    if (fixture.source.provider !== "google-drive") {
      throw new Error(`${fixture.id} must use the pinned google-drive source provider`);
    }
    googleDriveDownloadUrl(fixture.source.fileId);
    if (
      typeof fixture.fileName !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(fixture.fileName) ||
      fixture.fileName === "." ||
      fixture.fileName === ".." ||
      !Number.isSafeInteger(fixture.sizeBytes) ||
      fixture.sizeBytes <= 0
    ) {
      throw new Error(`${fixture.id} must pin fileName and positive sizeBytes`);
    }
    if (!/^[a-f0-9]{64}$/.test(fixture.sha256 ?? "") || /^0{64}$/.test(fixture.sha256)) {
      throw new Error(`${fixture.id} must pin an exact lowercase SHA-256`);
    }
    if (fixture.source.zipEntry) {
      validateZipEntryReceipt(fixture.id, fixture.source, fixture.source.zipEntry, fixture.sizeBytes);
    }
    if (fixture.role === "gaussian_splat") {
      const inspection = fixture.inspection;
      if (
        !Number.isSafeInteger(inspection?.headerBytes) || inspection.headerBytes <= 0 ||
        !Number.isSafeInteger(inspection?.vertexCount) || inspection.vertexCount <= 0 ||
        !Number.isSafeInteger(inspection?.sphericalHarmonicDegree) ||
        !Number.isSafeInteger(inspection?.propertyCount) || inspection.propertyCount <= 0
      ) {
        throw new Error(`${fixture.id} must pin its Gaussian header inspection receipt`);
      }
      if (fixture.qualificationView) validateQualificationView(fixture);
    }
  }
  if (!Array.isArray(manifest.qualificationCases) || manifest.qualificationCases.length === 0) {
    throw new Error("FJD sample manifest must declare at least one qualification case");
  }
  const caseIds = new Set();
  for (const qualificationCase of manifest.qualificationCases) {
    if (
      !qualificationCase?.id ||
      !/^[a-z0-9][a-z0-9-]*$/.test(qualificationCase.id) ||
      caseIds.has(qualificationCase.id)
    ) {
      throw new Error(`FJD qualification case id is missing, invalid, or duplicated: ${qualificationCase?.id ?? "missing"}`);
    }
    caseIds.add(qualificationCase.id);
    const gaussian = manifest.fixtures.find(
      (fixture) => fixture.id === qualificationCase.gaussianFixtureId,
    );
    const pointCloud = manifest.fixtures.find(
      (fixture) => fixture.id === qualificationCase.pointCloudFixtureId,
    );
    if (gaussian?.role !== "gaussian_splat" || pointCloud?.role !== "metric_point_cloud") {
      throw new Error(
        `${qualificationCase.id} must name one Gaussian fixture and one metric point-cloud fixture`,
      );
    }
    if (!["different-captures", "shared-frame"].includes(qualificationCase.relationship)) {
      throw new Error(`${qualificationCase.id} has unsupported capture relationship`);
    }
    if (qualificationCase.relationship === "shared-frame" && !qualificationCase.frameId) {
      throw new Error(`${qualificationCase.id} shared-frame case must pin frameId`);
    }
  }
  return manifest;
}

function validateQualificationView(fixture) {
  const view = fixture.qualificationView;
  const vectors = [view.cameraPosition, view.cameraTarget, view.cameraUp];
  const vectorIsFinite = (value) =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  const cameraHasDirection = vectorIsFinite(view.cameraPosition) &&
    vectorIsFinite(view.cameraTarget) &&
    view.cameraPosition.some((coordinate, index) => coordinate !== view.cameraTarget[index]);
  const upLengthSquared = vectorIsFinite(view.cameraUp)
    ? view.cameraUp.reduce((sum, coordinate) => sum + coordinate ** 2, 0)
    : 0;
  const metadata = view.metadata;
  const visualTripwires = view.visualTripwires;
  if (
    !["Y", "Z"].includes(view.sourceUpAxis) ||
    !vectors.every(vectorIsFinite) ||
    !cameraHasDirection ||
    !(upLengthSquared > 0) ||
    !Number.isFinite(view.fovDegrees) ||
    !(view.fovDegrees > 0 && view.fovDegrees < 180) ||
    view.rendererProfile !== "explicit-budget" ||
    !Number.isFinite(view.rendererBudgetMillions) ||
    !(view.rendererBudgetMillions > 0) ||
    typeof view.poseReceipt !== "string" ||
    !view.poseReceipt.trim() ||
    typeof view.poseRecordNeedle !== "string" ||
    !view.poseRecordNeedle.trim() ||
    typeof metadata?.fileName !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(metadata.fileName) ||
    !Number.isSafeInteger(metadata?.sizeBytes) ||
    metadata.sizeBytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(metadata?.sha256 ?? "") ||
    /^0{64}$/.test(metadata?.sha256)
  ) {
    throw new Error(
      `${fixture.id} qualificationView must pin finite camera vectors, source up axis, FOV, renderer profile/budget, provenance, and an exact companion receipt`,
    );
  }
  if (
    !Number.isSafeInteger(visualTripwires?.minimumLuminanceRange) ||
    visualTripwires.minimumLuminanceRange <= 0 ||
    visualTripwires.minimumLuminanceRange > 255 ||
    !Number.isSafeInteger(visualTripwires?.minimumColourBucketCount) ||
    visualTripwires.minimumColourBucketCount <= 0
  ) {
    throw new Error(
      `${fixture.id} qualificationView must pin positive measured visual tripwires`,
    );
  }
  validateZipEntryReceipt(
    `${fixture.id} qualificationView`,
    fixture.source,
    metadata.zipEntry,
    metadata.sizeBytes,
  );
}

function validateZipEntryReceipt(label, source, entry, expectedSizeBytes) {
  try {
    assertSafeArchivePath(entry?.name);
  } catch (error) {
    throw new Error(`${label} has invalid zipEntry path: ${error.message}`, { cause: error });
  }
  if (
    !Number.isSafeInteger(source.archiveSizeBytes) ||
    source.archiveSizeBytes <= 0 ||
    !Number.isSafeInteger(source.archiveEntryCount) ||
    source.archiveEntryCount <= 0 ||
    !Number.isSafeInteger(source.centralDirectorySizeBytes) ||
    source.centralDirectorySizeBytes <= 0 ||
    !Number.isSafeInteger(source.centralDirectoryOffset) ||
    source.centralDirectoryOffset < 0 ||
    ![0, 8].includes(entry?.compressionMethod) ||
    !/^[a-f0-9]{8}$/.test(entry?.crc32 ?? "") ||
    !Number.isSafeInteger(entry?.compressedSizeBytes) ||
    entry.compressedSizeBytes <= 0 ||
    !Number.isSafeInteger(entry?.uncompressedSizeBytes) ||
    entry.uncompressedSizeBytes <= 0 ||
    !Number.isSafeInteger(entry?.localHeaderOffset) ||
    entry.localHeaderOffset < 0 ||
    entry.uncompressedSizeBytes !== expectedSizeBytes
  ) {
    throw new Error(
      `${label} zipEntry must pin archive size/directory, method, CRC-32, compressed/uncompressed sizes, and local offset`,
    );
  }
}

export function selectQualificationCase(manifest, requestedId) {
  const cases = manifest.qualificationCases ?? [];
  if (requestedId) {
    const selected = cases.find((qualificationCase) => qualificationCase.id === requestedId);
    if (!selected) {
      throw new Error(
        `Unknown FJD qualification case ${requestedId}; available=${cases.map((item) => item.id).join(",")}`,
      );
    }
    return selected;
  }
  if (cases.length !== 1) {
    throw new Error(
      `Multiple FJD qualification cases are declared; choose --case=<id> from ${cases.map((item) => item.id).join(",")}`,
    );
  }
  return cases[0];
}

export function selectFixtureForQualificationCase(manifest, qualificationCase, role) {
  const idKey = role === "gaussian_splat"
    ? "gaussianFixtureId"
    : role === "metric_point_cloud"
      ? "pointCloudFixtureId"
      : null;
  if (!idKey) throw new Error(`Unsupported FJD qualification fixture role: ${role}`);
  const fixtureId = qualificationCase?.[idKey];
  const fixture = manifest.fixtures?.find((candidate) => candidate.id === fixtureId);
  if (!fixture || fixture.role !== role) {
    throw new Error(
      `${qualificationCase?.id ?? "unknown"} does not resolve ${idKey}=${fixtureId ?? "missing"} as ${role}`,
    );
  }
  return fixture;
}

export function validateLocalWranglerInvocation(args, {
  expectedPersistenceRoot,
  expectedConfigPath,
}) {
  const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const evidence = {
    localFlag: args.includes("--local"),
    remoteFlag: args.includes("--remote"),
    loopbackIp: valueAfter("--ip") ?? null,
    persistenceRoot: valueAfter("--persist-to") ?? null,
    configPath: valueAfter("--config") ?? null,
  };
  if (
    args[0] !== "wrangler" ||
    args[1] !== "dev" ||
    !evidence.localFlag ||
    evidence.remoteFlag ||
    evidence.loopbackIp !== "127.0.0.1" ||
    evidence.persistenceRoot !== expectedPersistenceRoot ||
    evidence.configPath !== expectedConfigPath
  ) {
    throw new Error(
      `FJD local Wrangler boundary failed: local=${evidence.localFlag} remote=${evidence.remoteFlag} ip=${evidence.loopbackIp} persist=${evidence.persistenceRoot} config=${evidence.configPath}`,
    );
  }
  return evidence;
}

export function validateLocalStorageBindings(config) {
  const groups = [
    ["d1", "d1_databases"],
    ["r2", "r2_buckets"],
    ["kv", "kv_namespaces"],
  ];
  const evidence = groups.flatMap(([kind, key]) =>
    (config?.[key] ?? []).map((binding) => ({
      kind,
      binding: binding.binding ?? "missing",
      remote: binding.remote === true,
    }))
  );
  const requiredBindings = ["DB", "SPATIAL_ASSETS", "AUTH_CACHE"];
  const missing = requiredBindings.filter(
    (binding) => !evidence.some((candidate) => candidate.binding === binding),
  );
  const remote = evidence.filter((candidate) => candidate.remote);
  if (missing.length > 0 || remote.length > 0) {
    throw new Error(
      `FJD local storage boundary failed: missing=${missing.join(",") || "none"} remote=${remote.map((item) => item.binding).join(",") || "none"}`,
    );
  }
  return evidence;
}

export function isLoopbackHttpUrl(value) {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && url.hostname === "127.0.0.1";
}

export function validateRadRangeResponses(responses, expectedTotalBytes) {
  if (!Array.isArray(responses) || responses.length === 0) {
    throw new Error("rad_range_response_count limit=1 ask=0");
  }
  for (const [index, response] of responses.entries()) {
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.contentRange ?? "");
    const start = match ? Number(match[1]) : NaN;
    const end = match ? Number(match[2]) : NaN;
    const total = match ? Number(match[3]) : NaN;
    const contentLength = Number(response.contentLength);
    if (
      response.status !== 206 ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      !Number.isSafeInteger(total) ||
      start < 0 ||
      end < start ||
      end >= total ||
      total !== expectedTotalBytes ||
      contentLength !== end - start + 1
    ) {
      throw new Error(
        `rad_range_response index=${index} expected_status=206 expected_total=${expectedTotalBytes} status=${response.status} content_range=${response.contentRange ?? "missing"} content_length=${response.contentLength ?? "missing"}`,
      );
    }
  }
  return { responseCount: responses.length, totalBytes: expectedTotalBytes };
}

export function validatePdalSummary(document, expected) {
  if (!document || document.reader !== "readers.las" || !document.summary) {
    throw new Error("FJD PDAL receipt must come from readers.las summary output");
  }
  if (document.file_size !== expected.sizeBytes) {
    throw new Error(
      `FJD PDAL file_size mismatch: expected ${expected.sizeBytes}, got ${document.file_size}`,
    );
  }
  if (document.summary.num_points !== expected.pointCount) {
    throw new Error(
      `FJD PDAL point_count mismatch: expected ${expected.pointCount}, got ${document.summary.num_points}`,
    );
  }
  const pdalBounds = document.summary.bounds ?? {};
  for (const [axisIndex, axis] of ["x", "y", "z"].entries()) {
    const receiptScale = expected.scale?.[axisIndex];
    if (!Number.isFinite(receiptScale) || receiptScale <= 0) {
      throw new Error(`FJD LAS scale_${axis} must be a positive finite receipt`);
    }
    for (const edge of ["min", "max"]) {
      const expectedValue = expected.bounds?.[edge]?.[axisIndex];
      const actualValue = pdalBounds[`${edge}${axis}`];
      if (
        !Number.isFinite(expectedValue) ||
        !Number.isFinite(actualValue) ||
        Math.abs(expectedValue - actualValue) > receiptScale
      ) {
        throw new Error(
          `FJD PDAL bounds_${edge}_${axis} mismatch: expected ${expectedValue}, got ${actualValue}, LAS scale receipt ${receiptScale}`,
        );
      }
    }
  }
  const srs = document.summary.metadata?.srs ?? {};
  const horizontalUnits = srs.units?.horizontal || "unknown";
  const spatialReference = srs.horizontal || srs.compoundwkt || srs.wkt || "";
  return {
    pdalVersion: document.pdal_version,
    decoder: document.reader,
    pointCount: document.summary.num_points,
    bounds: document.summary.bounds,
    horizontalUnits,
    spatialReference: spatialReference || null,
    coordinateRegistration:
      horizontalUnits !== "unknown" && spatialReference ? "declared" : "missing",
  };
}

export async function streamFileMetadata(path) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    sizeBytes += chunk.byteLength;
    hash.update(chunk);
  }
  return { sizeBytes, sha256: hash.digest("hex") };
}

export class IntegrityMeter extends Transform {
  #crc = 0xffff_ffff;
  #hash = createHash("sha256");
  #sizeBytes = 0;
  #maximumSizeBytes;
  #budgetName;

  constructor({ maximumSizeBytes, budgetName } = {}) {
    super();
    if (maximumSizeBytes !== undefined && (
      !Number.isSafeInteger(maximumSizeBytes) || maximumSizeBytes <= 0 || !budgetName
    )) {
      throw new Error("IntegrityMeter maximumSizeBytes requires a positive receipt and budgetName");
    }
    this.#maximumSizeBytes = maximumSizeBytes;
    this.#budgetName = budgetName;
  }

  _transform(chunk, _encoding, callback) {
    const requestedSizeBytes = this.#sizeBytes + chunk.byteLength;
    if (this.#maximumSizeBytes !== undefined && requestedSizeBytes > this.#maximumSizeBytes) {
      callback(new Error(
        `${this.#budgetName} limit=${this.#maximumSizeBytes} ask=${requestedSizeBytes}`,
      ));
      return;
    }
    this.#sizeBytes = requestedSizeBytes;
    this.#hash.update(chunk);
    for (const byte of chunk) {
      this.#crc = CRC32_TABLE[(this.#crc ^ byte) & 0xff] ^ (this.#crc >>> 8);
    }
    callback(null, chunk);
  }

  metadata() {
    return {
      sizeBytes: this.#sizeBytes,
      sha256: this.#hash.copy().digest("hex"),
      crc32: (this.#crc ^ 0xffff_ffff) >>> 0,
    };
  }
}

function assertSafeArchivePath(name) {
  if (
    name.length === 0 ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").includes("..")
  ) {
    throw new Error(`Unsafe ZIP entry path: ${name}`);
  }
}

function requireBuffer(value, label) {
  if (!Buffer.isBuffer(value)) throw new TypeError(`${label} must be a Buffer`);
}

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}
