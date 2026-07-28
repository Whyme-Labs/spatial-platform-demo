import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { zipSync } from "fflate";
import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";
import * as THREE from "three";
import {
  inspectSpzContainer,
  sparkMaximumSphericalHarmonicDegree,
  validateEvidenceAsset,
  validateGaussianPlyHeader,
} from "./processing-agent-core.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repositoryRoot, "test", "open-corpus", "manifest.json");
const cacheRoot = join(repositoryRoot, ".cache", "open-corpus");
const upstreamRoot = join(cacheRoot, "upstream");
const derivedRoot = join(cacheRoot, "derived");
const reportsRoot = join(cacheRoot, "reports");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const command = process.argv[2] ?? "help";
const includeEvaluation = process.argv.includes("--include-evaluation");

await mkdir(upstreamRoot, { recursive: true });
await mkdir(derivedRoot, { recursive: true });
await mkdir(reportsRoot, { recursive: true });

switch (command) {
  case "fetch":
    await fetchCorpus();
    break;
  case "verify":
    await verifyCorpus();
    break;
  case "prepare":
    await verifyCorpus();
    await prepareCorpus();
    break;
  case "compat":
    await verifyCorpus();
    await verifyDerivedCorpus();
    await runCompatibilityMatrix();
    break;
  case "all":
    await fetchCorpus();
    await verifyCorpus();
    await prepareCorpus();
    await verifyDerivedCorpus();
    await runCompatibilityMatrix();
    break;
  default:
    console.log(`Usage:
  npm run corpus:fetch [-- --include-evaluation]
  npm run corpus:verify [-- --include-evaluation]
  npm run corpus:prepare
  npm run corpus:compat
  npm run corpus:all

The default corpus excludes the two large evaluation fixtures.`);
    process.exitCode = command === "help" ? 0 : 2;
}

async function fetchCorpus() {
  for (const fixture of selectedFixtures()) {
    const destination = fixturePath(fixture);
    if (await exists(destination)) {
      const metadata = await fileMetadata(destination);
      assertExpected(fixture, metadata);
      emit("corpus.fetch.cached", { fixture: fixture.id, ...metadata });
      continue;
    }
    const temporary = `${destination}.${crypto.randomUUID()}.partial`;
    const response = await fetch(fixture.sourceUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(fixture.tier === "evaluation" ? 300_000 : 120_000),
      headers: { "user-agent": "whymelabs-open-corpus/1.0" },
    });
    if (!response.ok || !response.body) {
      throw new Error(`Unable to download ${fixture.id}: HTTP ${response.status}`);
    }
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        sizeBytes += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        meter,
        createWriteStream(temporary, { mode: 0o600 }),
      );
      const metadata = { sizeBytes, sha256: hash.digest("hex") };
      assertExpected(fixture, metadata);
      await rename(temporary, destination);
      emit("corpus.fetch.completed", { fixture: fixture.id, ...metadata });
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}

async function verifyCorpus() {
  const verified = [];
  for (const fixture of selectedFixtures()) {
    const path = fixturePath(fixture);
    if (!(await exists(path))) {
      throw new Error(`Missing ${fixture.id}; run npm run corpus:fetch first`);
    }
    const metadata = await fileMetadata(path);
    assertExpected(fixture, metadata);
    verified.push({ id: fixture.id, fileName: fixture.fileName, ...metadata });
  }
  await writeJson(join(reportsRoot, "upstream-verification.json"), {
    schemaVersion: "whymelabs.open-spatial-corpus-verification.v1",
    manifest: "test/open-corpus/manifest.json",
    includeEvaluation,
    verified,
  });
  emit("corpus.verify.completed", { fixtureCount: verified.length });
}

async function prepareCorpus() {
  const sourceSog = fixturePath(fixtureById("aws-laundry-room-sog"));
  const gaussianPly = join(derivedRoot, "aws-laundry-room.ply");
  const modernSpz = join(derivedRoot, "aws-laundry-room-ngsp-v4.spz");
  const gaussianZip = join(derivedRoot, "aws-laundry-room-sog-container.zip");
  const standardSplat = join(derivedRoot, "aws-laundry-room.splat");
  const kSplat = join(derivedRoot, "aws-laundry-room.ksplat");
  const rad = join(derivedRoot, "aws-laundry-room-lod.rad");

  if (!(await exists(gaussianPly))) {
    await runTool(
      join(repositoryRoot, "node_modules", ".bin", executableName("splat-transform")),
      [sourceSog, gaussianPly],
    );
  }
  if (!(await exists(modernSpz))) {
    await runTool(
      join(repositoryRoot, "node_modules", ".bin", executableName("splat-transform")),
      [sourceSog, modernSpz],
    );
  }
  if (!(await exists(gaussianZip))) await copyFile(sourceSog, gaussianZip);
  if (!(await exists(standardSplat)) || !(await exists(kSplat))) {
    await createStandardSplatAndKSplat(gaussianPly, standardSplat, kSplat);
  }

  const sparkBinary = join(repositoryRoot, ".tools", "bin", executableName("spark-build-lod"));
  if (!(await exists(sparkBinary))) {
    throw new Error("Spark build-lod is missing; run npm run processor:setup");
  }
  if (!(await exists(rad))) {
    const generatedRad = gaussianPly.replace(/\.ply$/, "-lod.rad");
    await rm(generatedRad, { force: true });
    await runTool(sparkBinary, ["--quality", "--max-sh=3", "--rad", gaussianPly], {
      timeoutMs: 10 * 60_000,
    });
    await rename(generatedRad, rad);
  }

  await createSourceEvidenceDerivatives();
  await createNegativeAndOpaqueFixtures();
  const derived = await inventoryDerived();
  await writeJson(join(reportsRoot, "derived-provenance.json"), {
    schemaVersion: "whymelabs.open-spatial-derived-corpus.v1",
    sourceManifest: "test/open-corpus/manifest.json",
    sourceFixture: "aws-laundry-room-sog",
    tools: {
      splatTransform: "3.1.7",
      spark: "2.1.0@f22236f95fdd8078f0c12e3aab479523d401daf6",
      gaussianSplats3D: "0.4.7",
      fflate: "0.8.3",
      ffmpeg: await toolVersion("ffmpeg"),
    },
    derived,
    limitations: [
      "Synthetic IMU/GNSS fixtures validate the application contract only.",
      "Opaque XBIN/FJDSLAM/LCC/LCC2 fixtures validate transport and audit labelling only, never vendor origin or decoding.",
      "The Khronos box validates collision GLB transport, not walkability or navmesh quality.",
    ],
  });
  emit("corpus.prepare.completed", { derivedCount: derived.length });
}

async function createStandardSplatAndKSplat(plyPath, splatPath, kSplatPath) {
  const source = await readFile(plyPath);
  const arrayBuffer = source.buffer.slice(
    source.byteOffset,
    source.byteOffset + source.byteLength,
  );
  const splatArray = GaussianSplats3D.PlyParser.parseToUncompressedSplatArray(
    arrayBuffer,
    3,
  );
  const standard = Buffer.allocUnsafe(splatArray.splatCount * 32);
  for (let index = 0; index < splatArray.splatCount; index += 1) {
    const splat = splatArray.getSplat(index);
    const offset = index * 32;
    for (let component = 0; component < 3; component += 1) {
      standard.writeFloatLE(splat[component], offset + component * 4);
      standard.writeFloatLE(splat[3 + component], offset + 12 + component * 4);
    }
    standard[offset + 24] = clampByte(splat[10]);
    standard[offset + 25] = clampByte(splat[11]);
    standard[offset + 26] = clampByte(splat[12]);
    standard[offset + 27] = clampByte(splat[13]);
    standard[offset + 28] = quaternionByte(splat[6]);
    standard[offset + 29] = quaternionByte(splat[7]);
    standard[offset + 30] = quaternionByte(splat[8]);
    standard[offset + 31] = quaternionByte(splat[9]);
  }
  await writeFile(splatPath, standard, { mode: 0o600 });
  const generator = GaussianSplats3D.SplatBufferGenerator.getStandardGenerator(
    1,
    1,
    0,
    new THREE.Vector3(),
    5,
    256,
  );
  const splatBuffer = generator.generateFromUncompressedSplatArray(splatArray);
  await writeFile(kSplatPath, Buffer.from(splatBuffer.bufferData), { mode: 0o600 });
}

async function createSourceEvidenceDerivatives() {
  const image = fixturePath(fixtureById("opensfm-berlin-image-01"));
  const png = join(derivedRoot, "opensfm-berlin-01.png");
  const webp = join(derivedRoot, "opensfm-berlin-01.webp");
  const mp4 = join(derivedRoot, "opensfm-berlin-01.mp4");
  const mov = join(derivedRoot, "opensfm-berlin-01.mov");
  const webm = join(derivedRoot, "opensfm-berlin-01.webm");
  await runTool("ffmpeg", ["-y", "-loglevel", "error", "-i", image, "-frames:v", "1", png]);
  await runTool("ffmpeg", ["-y", "-loglevel", "error", "-i", image, "-frames:v", "1", webp]);
  const sharedVideo = [
    "-y", "-loglevel", "error", "-loop", "1", "-i", image,
    "-t", "1", "-vf", "scale=640:-2", "-r", "10",
  ];
  await runTool("ffmpeg", [
    ...sharedVideo, "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", mp4,
  ]);
  await runTool("ffmpeg", [
    ...sharedVideo, "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", mov,
  ]);
  await runTool("ffmpeg", [
    ...sharedVideo, "-c:v", "libvpx-vp9", "-deadline", "good",
    "-cpu-used", "4", "-pix_fmt", "yuv420p", webm,
  ]);

  const reconstruction = JSON.parse(
    await readFile(fixturePath(fixtureById("opensfm-berlin-reconstruction")), "utf8"),
  );
  const camera = reconstruction[0]?.cameras
    ? Object.entries(reconstruction[0].cameras)[0]
    : null;
  const calibrationYaml = [
    "# Derived from the pinned OpenSfM Berlin reconstruction fixture.",
    "schema: whymelabs.calibration-evidence.v1",
    `source_fixture: opensfm-berlin-reconstruction`,
    `camera_id: ${camera?.[0] ?? "unknown"}`,
    `projection_type: ${camera?.[1]?.projection_type ?? "unknown"}`,
    `width: ${camera?.[1]?.width ?? 0}`,
    `height: ${camera?.[1]?.height ?? 0}`,
    `focal: ${camera?.[1]?.focal ?? 0}`,
    `k1: ${camera?.[1]?.k1 ?? 0}`,
    `k2: ${camera?.[1]?.k2 ?? 0}`,
    "",
  ].join("\n");
  await writeFile(join(derivedRoot, "opensfm-berlin-calibration.yaml"), calibrationYaml);

  const zipEpoch = new Date("1980-01-01T00:00:00.000Z");
  const droneZip = zipSync({
    "images/DSC00229.JPG": [
      await readFile(fixturePath(fixtureById("odm-aukerman-image-229"))),
      { level: 9, mtime: zipEpoch },
    ],
    "images/DSC00230.JPG": [
      await readFile(fixturePath(fixtureById("odm-aukerman-image-230"))),
      { level: 9, mtime: zipEpoch },
    ],
    "PROVENANCE.txt": [
      Buffer.from(
        "CC0 Aukerman images pinned at 4e8031630f4193494c79b1c1d3524108826d1ba9.\n",
      ),
      { level: 9, mtime: zipEpoch },
    ],
  }, { level: 9, mtime: zipEpoch });
  await writeFile(join(derivedRoot, "odm-aukerman-two-image.zip"), droneZip);

  await writeFile(
    join(derivedRoot, "synthetic-imu-trajectory.csv"),
    [
      "# Synthetic application-contract fixture; no sensor-provenance claim.",
      "timestamp_s,ax_m_s2,ay_m_s2,az_m_s2,gx_rad_s,gy_rad_s,gz_rad_s",
      "0.000,0.000,0.000,9.80665,0.000,0.000,0.000",
      "0.010,0.003,-0.002,9.80660,0.001,0.000,-0.001",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(derivedRoot, "synthetic-gnss-trajectory.json"),
    JSON.stringify({
      schema: "whymelabs.gnss-evidence.v1",
      synthetic: true,
      limitation: "Contract fixture only; not evidence of a physical capture.",
      samples: [
        { timestamp: "2026-01-01T00:00:00.000Z", latitude: 52.520008, longitude: 13.404954, altitudeM: 34.2 },
      ],
    }, null, 2),
  );
}

async function createNegativeAndOpaqueFixtures() {
  const pointCloud = await readFile(fixturePath(fixtureById("pdal-point-cloud-ply")));
  await writeFile(join(derivedRoot, "negative-truncated-gaussian.ply"), pointCloud.subarray(0, 64));
  const corruptedE57 = Buffer.from(await readFile(fixturePath(fixtureById("pdal-a4-e57"))));
  corruptedE57[0] = 0x58;
  await writeFile(join(derivedRoot, "negative-signature.e57"), corruptedE57);
  const opaqueNotice = [
    "WHYMELABS TEST-ONLY OPAQUE CONTAINER",
    "This is not vendor data and proves transport/audit labelling only.",
    "",
  ].join("\n");
  for (const extension of ["xbin", "fjdslam", "lcc", "lcc2"]) {
    await writeFile(join(derivedRoot, `synthetic-opaque.${extension}`), opaqueNotice);
  }
}

async function verifyDerivedCorpus() {
  const required = [
    "aws-laundry-room.ply",
    "aws-laundry-room-ngsp-v4.spz",
    "aws-laundry-room-sog-container.zip",
    "aws-laundry-room.splat",
    "aws-laundry-room.ksplat",
    "aws-laundry-room-lod.rad",
    "opensfm-berlin-01.png",
    "opensfm-berlin-01.webp",
    "opensfm-berlin-01.mp4",
    "opensfm-berlin-01.mov",
    "opensfm-berlin-01.webm",
    "opensfm-berlin-calibration.yaml",
    "odm-aukerman-two-image.zip",
    "synthetic-imu-trajectory.csv",
    "synthetic-gnss-trajectory.json",
  ];
  for (const fileName of required) {
    if (!(await exists(join(derivedRoot, fileName)))) {
      throw new Error(`Missing derived fixture ${fileName}; run npm run corpus:prepare`);
    }
  }
  emit("corpus.derived.verify.completed", { fixtureCount: required.length });
}

async function runCompatibilityMatrix() {
  const results = [];
  const gaussianPly = join(derivedRoot, "aws-laundry-room.ply");
  const plyBytes = await readFile(gaussianPly);
  results.push({
    lane: "gaussian_splat/ply",
    fixture: "aws-laundry-room.ply",
    result: validateGaussianPlyHeader(plyBytes.subarray(0, 2 * 1024 * 1024)),
  });
  const spz = await readFile(join(derivedRoot, "aws-laundry-room-ngsp-v4.spz"));
  results.push({
    lane: "gaussian_splat/spz",
    fixture: "aws-laundry-room-ngsp-v4.spz",
    result: inspectSpzContainer(spz.subarray(0, 16)),
  });

  const evidenceCases = [
    ["metric_point_cloud/ply", fixturePath(fixtureById("pdal-point-cloud-ply")), "ply", "metric_point_cloud"],
    ["metric_point_cloud/las", fixturePath(fixtureById("pdal-simple-las")), "las", "metric_point_cloud"],
    ["metric_point_cloud/laz", fixturePath(fixtureById("pdal-simple-laz")), "laz", "metric_point_cloud"],
    ["metric_point_cloud/e57", fixturePath(fixtureById("pdal-a4-e57")), "e57", "metric_point_cloud"],
    ["source_images/jpg", fixturePath(fixtureById("opensfm-berlin-image-01")), "jpg", "source_images"],
    ["source_images/png", join(derivedRoot, "opensfm-berlin-01.png"), "png", "source_images"],
    ["source_images/webp", join(derivedRoot, "opensfm-berlin-01.webp"), "webp", "source_images"],
    ["source_images/zip", join(derivedRoot, "odm-aukerman-two-image.zip"), "zip", "source_images"],
    ["source_video/mp4", join(derivedRoot, "opensfm-berlin-01.mp4"), "mp4", "source_video"],
    ["source_video/mov", join(derivedRoot, "opensfm-berlin-01.mov"), "mov", "source_video"],
    ["source_video/webm", join(derivedRoot, "opensfm-berlin-01.webm"), "webm", "source_video"],
    ["camera_poses/json", fixturePath(fixtureById("opensfm-berlin-reconstruction")), "json", "camera_poses"],
    ["calibration/yaml", join(derivedRoot, "opensfm-berlin-calibration.yaml"), "yaml", "calibration"],
    ["imu_trajectory/csv", join(derivedRoot, "synthetic-imu-trajectory.csv"), "csv", "imu_trajectory"],
    ["gnss_trajectory/json", join(derivedRoot, "synthetic-gnss-trajectory.json"), "json", "gnss_trajectory"],
    ["collision_mesh/glb", fixturePath(fixtureById("khronos-box-glb")), "glb", "collision_mesh"],
    ["web_scene/rad", join(derivedRoot, "aws-laundry-room-lod.rad"), "rad", "web_scene"],
  ];
  for (const [lane, path, format, purpose] of evidenceCases) {
    const bytes = await readFile(path);
    results.push({
      lane,
      fixture: path.split("/").at(-1),
      result: validateEvidenceAsset(bytes.subarray(0, 2 * 1024 * 1024), { format, purpose }),
    });
  }
  for (const format of ["xbin", "fjdslam", "lcc", "lcc2"]) {
    const bytes = await readFile(join(derivedRoot, `synthetic-opaque.${format}`));
    const result = validateEvidenceAsset(bytes, { format, purpose: "vendor_project" });
    if (result.signatureVerified !== false) {
      throw new Error(`${format} must remain explicitly unverified`);
    }
    results.push({
      lane: `vendor_project/${format}`,
      fixture: `synthetic-opaque.${format}`,
      result,
    });
  }

  let pointCloudRejectedAsGaussian = false;
  try {
    const bytes = await readFile(fixturePath(fixtureById("pdal-point-cloud-ply")));
    validateGaussianPlyHeader(bytes);
  } catch (error) {
    pointCloudRejectedAsGaussian = error?.code === "INVALID_GAUSSIAN_PLY";
    results.push({
      lane: "negative/point-cloud-is-not-gaussian",
      fixture: "pdal-issue-2421.ply",
      result: { code: error?.code, message: error?.message },
    });
  }
  if (!pointCloudRejectedAsGaussian) {
    throw new Error("Ordinary point cloud was not rejected as a Gaussian splat");
  }

  const decoderResults = await runSparkDecoderMatrix();
  const report = {
    schemaVersion: "whymelabs.open-spatial-compatibility.v1",
    passed: true,
    boundedEvidenceCases: results,
    sparkDecoderCases: decoderResults,
    limitations: [
      "Bounded evidence checks prove signatures and integrity, not semantic correctness or metric accuracy.",
      "Opaque vendor-container cases deliberately remain signatureVerified=false.",
    ],
  };
  await writeJson(join(reportsRoot, "compatibility-matrix.json"), report);
  emit("corpus.compat.completed", {
    boundedCases: results.length,
    decoderCases: decoderResults.length,
  });
}

async function runSparkDecoderMatrix() {
  const sparkBinary = join(repositoryRoot, ".tools", "bin", executableName("spark-build-lod"));
  const splatTransformBinary = join(
    repositoryRoot,
    "node_modules",
    ".bin",
    executableName("splat-transform"),
  );
  const cases = [
    ["ply", join(derivedRoot, "aws-laundry-room.ply")],
    ["sog", fixturePath(fixtureById("aws-laundry-room-sog"))],
    ["zip", join(derivedRoot, "aws-laundry-room-sog-container.zip")],
    ["splat", join(derivedRoot, "aws-laundry-room.splat")],
    ["ksplat", join(derivedRoot, "aws-laundry-room.ksplat")],
    ["spz-v4", join(derivedRoot, "aws-laundry-room-ngsp-v4.spz")],
  ];
  const results = [];
  const matrixRoot = join(cacheRoot, "compat");
  await rm(matrixRoot, { recursive: true, force: true });
  await mkdir(matrixRoot, { recursive: true });
  for (const [format, source] of cases) {
    let decoderInput = source;
    let normalized = false;
    let detectedDegree;
    if (format === "spz-v4" || format === "ksplat") {
      decoderInput = join(matrixRoot, `${format}-normalized.ply`);
      await runTool(splatTransformBinary, [source, decoderInput]);
      normalized = true;
      const normalizedBytes = await readFile(decoderInput);
      detectedDegree = validateGaussianPlyHeader(
        normalizedBytes.subarray(0, 2 * 1024 * 1024),
      ).sphericalHarmonicDegree;
    } else {
      const extension = source.split(".").at(-1);
      decoderInput = join(matrixRoot, `${format}.${extension}`);
      await copyFile(source, decoderInput);
    }
    const expectedOutput = decoderInput.replace(/\.[^.]+$/, "-lod.rad");
    const maximumShDegree = sparkMaximumSphericalHarmonicDegree(
      format === "spz-v4" ? "spz" : format,
      detectedDegree,
    );
    await runTool(sparkBinary, ["--quick", `--max-sh=${maximumShDegree}`, "--rad", decoderInput], {
      timeoutMs: 10 * 60_000,
    });
    const metadata = await fileMetadata(expectedOutput);
    const header = await readFile(expectedOutput);
    validateEvidenceAsset(header.subarray(0, 16), { format: "rad", purpose: "web_scene" });
    results.push({ format, normalized, ...metadata });
  }
  return results;
}

function selectedFixtures() {
  return manifest.fixtures.filter(
    (fixture) => includeEvaluation || fixture.tier !== "evaluation",
  );
}

function fixtureById(id) {
  const fixture = manifest.fixtures.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Unknown corpus fixture ${id}`);
  return fixture;
}

function fixturePath(fixture) {
  return join(upstreamRoot, fixture.fileName);
}

function assertExpected(fixture, actual) {
  if (fixture.sizeBytes !== actual.sizeBytes) {
    throw new Error(
      `${fixture.id} byte count mismatch: expected ${fixture.sizeBytes}, got ${actual.sizeBytes}`,
    );
  }
  if (fixture.sha256 !== actual.sha256) {
    throw new Error(
      `${fixture.id} SHA-256 mismatch: expected ${fixture.sha256}, got ${actual.sha256}`,
    );
  }
}

async function fileMetadata(path) {
  const hash = createHash("sha256");
  const bytes = await readFile(path);
  hash.update(bytes);
  return { sizeBytes: bytes.byteLength, sha256: hash.digest("hex") };
}

async function inventoryDerived() {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(derivedRoot, { withFileTypes: true });
  const files = [];
  for (const entry of entries.filter((candidate) => candidate.isFile()).sort((a, b) => a.name.localeCompare(b.name))) {
    files.push({ fileName: entry.name, ...(await fileMetadata(join(derivedRoot, entry.name))) });
  }
  return files;
}

async function runTool(binary, args, { timeoutMs = 5 * 60_000 } = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(binary, args, {
      cwd: repositoryRoot,
      stdio: ["ignore", "inherit", "inherit"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`${binary} exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${binary} exited ${code ?? signal}`));
    });
  });
}

async function toolVersion(binary) {
  return new Promise((resolvePromise) => {
    const child = spawn(binary, ["-version"], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.once("exit", () => resolvePromise(output.split(/\r?\n/)[0] || "unknown"));
    child.once("error", () => resolvePromise("unavailable"));
  });
}

function executableName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function quaternionByte(value) {
  return Math.max(0, Math.min(255, Math.round(value * 128 + 128)));
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
