import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import {
  IntegrityMeter,
  ZIP_END_RECORD_SEARCH_BYTES,
  googleDriveDownloadUrl,
  fjdQualificationGates,
  inspectLasHeader,
  parseZipCentralDirectory,
  parseZipEndRecord,
  parseZipLocalFileHeader,
  parseZipLocalHeaderSize,
  selectQualificationCase,
  streamFileMetadata,
  validateFjdSampleManifest,
  validatePdalSummary,
} from "./fjd-sample-corpus-core.mjs";
import {
  sparkMaximumSphericalHarmonicDegree,
  validateEvidenceAsset,
  validateGaussianPlyHeader,
} from "./processing-agent-core.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestRelativePath = "test/vendor-corpus/fjd-manifest.json";
const manifest = validateFjdSampleManifest(JSON.parse(
  await readFile(join(repositoryRoot, manifestRelativePath), "utf8"),
));
const cacheRoot = join(repositoryRoot, ".cache", "fjd-sample-corpus");
const upstreamRoot = join(cacheRoot, "upstream");
const derivedRoot = join(cacheRoot, "derived");
const reportsRoot = join(cacheRoot, "reports");
const command = process.argv[2] ?? "help";
const requestedCaseId = process.argv.find((argument) => argument.startsWith("--case="))
  ?.slice("--case=".length);

await Promise.all([
  mkdir(upstreamRoot, { recursive: true }),
  mkdir(derivedRoot, { recursive: true }),
  mkdir(reportsRoot, { recursive: true }),
]);

switch (command) {
  case "inspect":
    await inspectRemoteCorpus();
    break;
  case "fetch":
    await fetchCorpus();
    break;
  case "verify":
    await verifyCorpus();
    break;
  case "qualify":
    {
      const qualificationCase = selectQualificationCase(manifest, requestedCaseId);
      const fixtures = fixturesForCase(qualificationCase);
      await fetchCorpus(fixtures);
      await qualifyCorpus(qualificationCase, fixtures);
    }
    break;
  default:
    console.log(`Usage:
  npm run corpus:fjd:inspect
  npm run corpus:fjd:fetch
  npm run corpus:fjd:verify
  npm run corpus:fjd:qualify [-- --case=<qualification-case-id>]

Official FJD bytes are downloaded into ignored .cache storage. The source page
does not grant redistribution rights, so fixtures and derived assets must not be
committed, rehosted, or published.`);
    process.exitCode = command === "help" ? 0 : 2;
}

async function inspectRemoteCorpus() {
  const inspected = [];
  for (const fixture of manifest.fixtures) inspected.push(await inspectRemoteFixture(fixture));
  const report = {
    schemaVersion: "whymelabs.fjd-remote-inventory.v1",
    measuredAt: new Date().toISOString(),
    sourceManifest: manifestRelativePath,
    redistribution: manifest.redistribution,
    fixtures: inspected,
  };
  await writeJson(join(reportsRoot, "remote-inventory.json"), report);
  emit("fjd.inspect.completed", { fixtureCount: inspected.length });
}

async function fetchCorpus(fixtures = manifest.fixtures) {
  for (const fixture of fixtures) {
    const destination = fixturePath(fixture);
    if (await exists(destination)) {
      const metadata = await streamFileMetadata(destination);
      assertExpected(fixture, metadata);
      emit("fjd.fetch.cached", { fixture: fixture.id, ...metadata });
      continue;
    }
    if (fixture.source.zipEntry) await extractRemoteZipEntry(fixture, destination);
    else await downloadDirectFixture(fixture, destination);
  }
}

async function verifyCorpus(fixtures = manifest.fixtures, qualificationCase = null) {
  const verified = [];
  for (const fixture of fixtures) verified.push(await verifyFixture(fixture));
  const report = {
    schemaVersion: "whymelabs.fjd-local-verification.v1",
    measuredAt: new Date().toISOString(),
    sourceManifest: manifestRelativePath,
    redistribution: manifest.redistribution,
    qualificationCase: qualificationCase?.id ?? null,
    fixtures: verified,
    gates: qualificationCase ? fjdQualificationGates(qualificationCase) : null,
  };
  await writeJson(join(reportsRoot, "local-verification.json"), report);
  emit("fjd.verify.completed", { fixtureCount: verified.length });
  return report;
}

async function qualifyCorpus(qualificationCase, fixtures) {
  const startedAt = new Date();
  const verification = await verifyCorpus(fixtures, qualificationCase);
  const gaussian = fixtureById(qualificationCase.gaussianFixtureId);
  const pointCloud = fixtureById(qualificationCase.pointCloudFixtureId);
  const gaussianPath = fixturePath(gaussian);
  const gaussianInspection = await inspectFixtureBytes(gaussian);
  const generatedBesideInput = gaussianPath.replace(/\.ply$/i, "-lod.rad");
  const radPath = join(derivedRoot, gaussian.fileName.replace(/\.ply$/i, "-lod.rad"));
  await rm(generatedBesideInput, { force: true });
  const sparkBinary = join(repositoryRoot, ".tools", "bin", executableName("spark-build-lod"));
  if (!(await exists(sparkBinary))) {
    throw new Error("Spark build-lod is missing; run npm run processor:setup");
  }
  const maximumShDegree = sparkMaximumSphericalHarmonicDegree(
    "ply",
    gaussianInspection.sphericalHarmonicDegree,
  );
  emit("fjd.qualify.spark.started", {
    fixture: gaussian.id,
    maximumSphericalHarmonicDegree: maximumShDegree,
  });
  await runTool(sparkBinary, [
    "--quick",
    `--max-sh=${maximumShDegree}`,
    "--rad",
    gaussianPath,
  ]);
  await rm(radPath, { force: true });
  await rename(generatedBesideInput, radPath);
  const radHeader = await readPrefix(radPath, 16);
  const radInspection = validateEvidenceAsset(radHeader, { format: "rad", purpose: "web_scene" });
  const radMetadata = await streamFileMetadata(radPath);
  const pointCloudFixture = verification.fixtures.find((fixture) => fixture.id === pointCloud.id);
  if (!pointCloudFixture) {
    throw new Error(`${qualificationCase.id} verification is missing ${pointCloud.id}`);
  }
  const pointCloudDecoder = await inspectPointCloudWithPdal(
    pointCloud,
    pointCloudFixture.inspection,
  );
  const completedAt = new Date();
  const gates = fjdQualificationGates(qualificationCase, pointCloudDecoder);
  const report = {
    schemaVersion: "whymelabs.fjd-qualification.v1",
    measuredAt: completedAt.toISOString(),
    sourceManifest: manifestRelativePath,
    qualificationCase,
    elapsedMilliseconds: completedAt.getTime() - startedAt.getTime(),
    inputs: verification.fixtures,
    output: {
      fileName: radPath.split("/").at(-1),
      ...radMetadata,
      inspection: radInspection,
      byteIdentity: "per-run",
      byteIdentityReason: "Spark RAD metadata records measured build durations.",
    },
    pointCloudDecoder,
    gates,
    conclusion: {
      gaussianPlyValidation: "passed",
      sparkRadBuild: "passed",
      pointCloudDecode: "passed",
      privatePlatformImport: "not_run",
      browserRender: "not_run",
      metricCoordinateRegistration:
        gates.metricCoordinateRegistration === "qualifiable" ? "eligible" : "blocked",
      automaticWalkableScene:
        gates.automaticWalkableScene === "qualifiable" ? "not_run" : "blocked",
      reason: qualificationLimitation(qualificationCase, pointCloudDecoder),
    },
  };
  await writeJson(join(reportsRoot, "qualification.json"), report);
  emit("fjd.qualify.completed", {
    radBytes: radMetadata.sizeBytes,
    automaticWalkableScene: gates.automaticWalkableScene,
  });
}

function qualificationLimitation(qualificationCase, pointCloudDecoder) {
  const limitations = [];
  if (qualificationCase.relationship !== "shared-frame") {
    limitations.push("the selected Gaussian and point-cloud fixtures are different captures");
  }
  if (pointCloudDecoder.coordinateRegistration !== "declared") {
    limitations.push("the point cloud declares neither a spatial reference nor horizontal units");
  }
  limitations.push("private Studio import and browser rendering have not been run");
  return `Qualification remains incomplete: ${limitations.join("; ")}.`;
}

function fixturesForCase(qualificationCase) {
  return [
    fixtureById(qualificationCase.gaussianFixtureId),
    fixtureById(qualificationCase.pointCloudFixtureId),
  ];
}

function fixtureById(id) {
  const fixture = manifest.fixtures.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Unknown FJD fixture ${id}`);
  return fixture;
}

async function inspectPointCloudWithPdal(fixture, headerInspection) {
  const image = process.env.PROCESSOR_IMAGE ?? "spatial-processor:0.11.0";
  let imageReceipt;
  let result;
  try {
    imageReceipt = await runToolCapture("docker", ["image", "inspect", "--format", "{{.Id}}", image]);
    result = await runToolCapture("docker", [
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--volume",
      `${fixturePath(fixture)}:/input/source.las:ro`,
      "--entrypoint",
      "/opt/conda/bin/pdal",
      image,
      "info",
      "--summary",
      "/input/source.las",
    ]);
  } catch (error) {
    throw new Error(
      `Pinned FJD PDAL qualification failed with ${image}; run npm run processor:container:build. ${error.message}`,
      { cause: error },
    );
  }
  let document;
  try {
    document = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`PDAL returned invalid JSON for ${fixture.id}: ${error.message}`, { cause: error });
  }
  return {
    processorImage: image,
    processorImageId: imageReceipt.stdout.trim(),
    ...validatePdalSummary(document, {
      sizeBytes: fixture.sizeBytes,
      pointCount: headerInspection.pointCount,
      bounds: headerInspection.bounds,
      scale: headerInspection.scale,
    }),
  };
}

async function inspectRemoteFixture(fixture) {
  const url = googleDriveDownloadUrl(fixture.source.fileId);
  const head = await fetch(url, { method: "HEAD", redirect: "follow", headers: userAgentHeaders() });
  if (!head.ok) throw new Error(`${fixture.id} HEAD failed: HTTP ${head.status}`);
  const remoteSizeBytes = parseContentLength(head, fixture.id);
  const expectedRemoteSize = fixture.source.archiveSizeBytes ?? fixture.sizeBytes;
  if (remoteSizeBytes !== expectedRemoteSize) {
    throw new Error(
      `${fixture.id} remote_size_bytes mismatch: expected ${expectedRemoteSize}, got ${remoteSizeBytes}`,
    );
  }
  const base = {
    id: fixture.id,
    remoteSizeBytes,
    acceptRanges: head.headers.get("accept-ranges"),
    lastModified: head.headers.get("last-modified"),
    contentDisposition: head.headers.get("content-disposition"),
  };
  if (!fixture.source.zipEntry) return base;
  const inspected = await inspectRemoteZip(url, fixture.source);
  const entry = inspected.entries.find((candidate) => candidate.name === fixture.source.zipEntry.name);
  if (!entry) throw new Error(`${fixture.id} is missing ZIP entry ${fixture.source.zipEntry.name}`);
  assertZipEntryExpected(fixture, entry);
  return {
    ...base,
    rangeExtraction: {
      archiveEntryCount: inspected.entries.length,
      centralDirectorySizeBytes: inspected.end.centralDirectorySize,
      selectedEntry: serializableZipEntry(entry),
    },
  };
}

async function inspectRemoteZip(url, sourceReceipt) {
  const archiveSizeBytes = sourceReceipt.archiveSizeBytes;
  const tailStart = Math.max(0, archiveSizeBytes - ZIP_END_RECORD_SEARCH_BYTES);
  const tail = await fetchRangeBuffer(url, tailStart, archiveSizeBytes - 1);
  const end = parseZipEndRecord(tail, { archiveSizeBytes, tailStart });
  for (const [field, expected] of Object.entries({
    entryCount: sourceReceipt.archiveEntryCount,
    centralDirectorySize: sourceReceipt.centralDirectorySizeBytes,
    centralDirectoryOffset: sourceReceipt.centralDirectoryOffset,
  })) {
    if (end[field] !== expected) {
      throw new Error(`FJD ZIP ${field} mismatch: expected ${expected}, got ${end[field]}`);
    }
  }
  const central = await fetchRangeBuffer(
    url,
    end.centralDirectoryOffset,
    end.centralDirectoryOffset + end.centralDirectorySize - 1,
  );
  return { end, entries: parseZipCentralDirectory(central, end.entryCount) };
}

async function extractRemoteZipEntry(fixture, destination) {
  const url = googleDriveDownloadUrl(fixture.source.fileId);
  const inspected = await inspectRemoteZip(url, fixture.source);
  const entry = inspected.entries.find((candidate) => candidate.name === fixture.source.zipEntry.name);
  if (!entry) throw new Error(`${fixture.id} is missing ZIP entry ${fixture.source.zipEntry.name}`);
  assertZipEntryExpected(fixture, entry);
  const localFixedBytes = await fetchRangeBuffer(
    url,
    entry.localHeaderOffset,
    entry.localHeaderOffset + 29,
  );
  const localHeaderSizeBytes = parseZipLocalHeaderSize(localFixedBytes);
  const localBytes = await fetchRangeBuffer(
    url,
    entry.localHeaderOffset,
    entry.localHeaderOffset + localHeaderSizeBytes - 1,
  );
  const local = parseZipLocalFileHeader(localBytes, entry);
  const response = await fetchRange(url, local.dataOffset, local.dataEndInclusive);
  if (!response.body) throw new Error(`${fixture.id} ZIP entry response has no body`);
  const temporary = `${destination}.${crypto.randomUUID()}.partial`;
  const meter = new IntegrityMeter({
    maximumSizeBytes: fixture.sizeBytes,
    budgetName: `${fixture.id}.uncompressed_size_bytes`,
  });
  const source = Readable.fromWeb(response.body);
  try {
    if (entry.compressionMethod === 8) {
      await pipeline(source, createInflateRaw(), meter, createWriteStream(temporary, { mode: 0o600 }));
    } else {
      await pipeline(source, meter, createWriteStream(temporary, { mode: 0o600 }));
    }
    const metadata = meter.metadata();
    if (metadata.crc32 !== entry.crc32) {
      throw new Error(
        `${fixture.id} ZIP CRC-32 mismatch: expected ${hex32(entry.crc32)}, got ${hex32(metadata.crc32)}`,
      );
    }
    assertExpected(fixture, metadata);
    await rename(temporary, destination);
    emit("fjd.fetch.completed", { fixture: fixture.id, transport: "zip-range", ...metadata });
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function downloadDirectFixture(fixture, destination) {
  const response = await fetch(googleDriveDownloadUrl(fixture.source.fileId), {
    redirect: "follow",
    headers: userAgentHeaders(),
  });
  if (!response.ok || !response.body) {
    throw new Error(`${fixture.id} download failed: HTTP ${response.status}`);
  }
  const responseSizeBytes = parseContentLength(response, fixture.id);
  if (responseSizeBytes !== fixture.sizeBytes) {
    throw new Error(
      `${fixture.id} content_length_bytes mismatch: expected ${fixture.sizeBytes}, got ${responseSizeBytes}`,
    );
  }
  const temporary = `${destination}.${crypto.randomUUID()}.partial`;
  const meter = new IntegrityMeter({
    maximumSizeBytes: fixture.sizeBytes,
    budgetName: `${fixture.id}.download_size_bytes`,
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      meter,
      createWriteStream(temporary, { mode: 0o600 }),
    );
    const metadata = meter.metadata();
    assertExpected(fixture, metadata);
    await rename(temporary, destination);
    emit("fjd.fetch.completed", { fixture: fixture.id, transport: "direct", ...metadata });
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function verifyFixture(fixture) {
  const path = fixturePath(fixture);
  if (!(await exists(path))) {
    throw new Error(`Missing ${fixture.id}; run npm run corpus:fjd:fetch first`);
  }
  const metadata = await streamFileMetadata(path);
  assertExpected(fixture, metadata);
  return {
    id: fixture.id,
    role: fixture.role,
    fileName: fixture.fileName,
    ...metadata,
    inspection: await inspectFixtureBytes(fixture),
  };
}

async function inspectFixtureBytes(fixture) {
  const path = fixturePath(fixture);
  if (fixture.role === "gaussian_splat") {
    const inspection = validateGaussianPlyHeader(
      await readPrefix(path, fixture.inspection.headerBytes),
    );
    for (const field of ["headerBytes", "vertexCount", "sphericalHarmonicDegree", "propertyCount"]) {
      if (inspection[field] !== fixture.inspection[field]) {
        throw new Error(
          `${fixture.id} gaussian_${field} mismatch: expected ${fixture.inspection[field]}, got ${inspection[field]}`,
        );
      }
    }
    return inspection;
  }
  if (fixture.role === "metric_point_cloud") {
    const fixedHeader = await readPrefix(path, 227);
    validateEvidenceAsset(fixedHeader, { format: "las", purpose: "metric_point_cloud" });
    const headerSizeBytes = fixedHeader.readUInt16LE(94);
    return inspectLasHeader(
      headerSizeBytes > fixedHeader.byteLength
        ? await readPrefix(path, headerSizeBytes)
        : fixedHeader,
    );
  }
  throw new Error(`Unsupported FJD fixture role ${fixture.role}`);
}

async function fetchRangeBuffer(url, start, endInclusive) {
  const response = await fetchRange(url, start, endInclusive);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchRange(url, start, endInclusive) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { ...userAgentHeaders(), range: `bytes=${start}-${endInclusive}` },
  });
  if (response.status !== 206) {
    throw new Error(
      `FJD source does not honor required byte range ${start}-${endInclusive}: HTTP ${response.status}`,
    );
  }
  const contentRange = response.headers.get("content-range");
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange ?? "");
  if (!match || Number(match[1]) !== start || Number(match[2]) !== endInclusive) {
    throw new Error(
      `FJD byte-range response mismatch: asked ${start}-${endInclusive}, got ${contentRange ?? "missing"}`,
    );
  }
  return response;
}

function assertZipEntryExpected(fixture, entry) {
  const expected = fixture.source.zipEntry;
  const actual = {
    compressionMethod: entry.compressionMethod,
    crc32: hex32(entry.crc32),
    compressedSizeBytes: entry.compressedSizeBytes,
    uncompressedSizeBytes: entry.uncompressedSizeBytes,
    localHeaderOffset: entry.localHeaderOffset,
  };
  for (const [field, expectedValue] of Object.entries({
    compressionMethod: expected.compressionMethod,
    crc32: expected.crc32,
    compressedSizeBytes: expected.compressedSizeBytes,
    uncompressedSizeBytes: expected.uncompressedSizeBytes,
    localHeaderOffset: expected.localHeaderOffset,
  })) {
    if (actual[field] !== expectedValue) {
      throw new Error(
        `${fixture.id} zip_entry_${field} mismatch: expected ${expectedValue}, got ${actual[field]}`,
      );
    }
  }
}

function assertExpected(fixture, actual) {
  if (actual.sizeBytes !== fixture.sizeBytes) {
    throw new Error(
      `${fixture.id} size_bytes mismatch: expected ${fixture.sizeBytes}, got ${actual.sizeBytes}`,
    );
  }
  if (actual.sha256 !== fixture.sha256) {
    throw new Error(
      `${fixture.id} sha256 mismatch: expected ${fixture.sha256}, got ${actual.sha256}`,
    );
  }
}

async function readPrefix(path, requestedBytes) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(requestedBytes);
    const { bytesRead } = await handle.read(buffer, 0, requestedBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function runTool(binary, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(binary, args, { cwd: repositoryRoot, stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${binary} exited ${code ?? signal}`));
    });
  });
}

async function runToolCapture(binary, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(binary, args, {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else {
        rejectPromise(new Error(
          `${binary} exited ${code ?? signal}: ${stderr.trim() || stdout.trim() || "no diagnostic output"}`,
        ));
      }
    });
  });
}

function parseContentLength(response, fixtureId) {
  const value = response.headers.get("content-length");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${fixtureId} response has invalid content-length: ${value ?? "missing"}`);
  }
  return parsed;
}

function serializableZipEntry(entry) {
  return { ...entry, crc32: hex32(entry.crc32) };
}

function hex32(value) {
  return value.toString(16).padStart(8, "0");
}

function fixturePath(fixture) {
  return join(upstreamRoot, fixture.fileName);
}

function executableName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function userAgentHeaders() {
  return { "user-agent": "whymelabs-fjd-corpus/1.0" };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function emit(event, details = {}) {
  console.log(JSON.stringify({ event, ...details }));
}
