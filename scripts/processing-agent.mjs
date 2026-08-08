import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { REVISION as threeRevision } from "three";
import { posterSampleIsReady } from "./poster-quality.mjs";
import {
  buildRecastNavigationArtifact,
  extractCollisionGeometryFromGlb,
  NavigationBuildError,
} from "./navigation-build-core.mjs";
import {
  validateAuthoredTraversals,
  validatePhysicalNavigation,
  validateStructuralNavigation,
} from "./physical-navigation-validation.mjs";
import { buildAuthoredStructuralCollisionGlb } from "./authored-collision.mjs";
import {
  E57_HEADER_BYTES,
  e57StructureSummary,
  e57XmlPhysicalSpan,
  extractE57Structure,
  parseE57Header,
  readE57XmlSection,
  serializeE57StructureReport,
} from "./e57-structure-core.mjs";
import {
  automaticNavigationLayout as buildAutomaticNavigationLayout,
  automaticStructuralCollisionConfig as buildAutomaticStructuralCollisionConfig,
} from "./automatic-spatial-pipeline.mjs";
import {
  automaticallyRegisterSceneSignatures,
  assertRegisteredSceneChangeCapacity,
  ProcessingAgentError,
  compareRegisteredScenes,
  extractMetricFloorPlan,
  extractWalkableSemanticCandidates,
  finalShellCaptureAgreement,
  inspectSpzContainer,
  parsePosterCameraJson,
  parsePlySceneSignature,
  planMultipartParts,
  processOutputEvent,
  processorFailure,
  sparkPosterSceneDescriptor,
  sparkMaximumSphericalHarmonicDegree,
  validateEvidenceAsset,
  validateGaussianPlyHeader,
  validateSogArchive,
  webScenePosterRenderer,
} from "./processing-agent-core.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const processorVersion = "spatial-processor/0.14.0";
const sparkVersion = "2.1.0";
const maximumBufferedSogBytes = 256 * 1024 * 1024;
const once = process.argv.includes("--once");
const posterOnlyIndex = process.argv.indexOf("--poster-only");
const posterOnly = posterOnlyIndex >= 0;
const configuration = posterOnly ? null : {
  origin: requiredEnvironment("SPATIAL_API_ORIGIN").replace(/\/+$/, ""),
  workerToken: requiredEnvironment("WORKER_API_TOKEN"),
  workerId: process.env.PROCESSOR_WORKER_ID?.trim() || `spark-${process.platform}-${process.pid}`,
  jobId: process.env.PROCESSOR_JOB_ID?.trim() || undefined,
  sparkBinary: resolve(
    process.env.SPARK_BUILD_LOD_BIN ||
      join(repositoryRoot, ".tools", "bin", process.platform === "win32" ? "spark-build-lod.exe" : "spark-build-lod"),
  ),
  splatTransformBinary: resolve(
    process.env.SPLAT_TRANSFORM_BIN ||
      join(
        repositoryRoot,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "splat-transform.cmd" : "splat-transform",
      ),
  ),
  pollMs: positiveInteger(process.env.PROCESSOR_POLL_SECONDS, 10) * 1000,
  heartbeatMs: positiveInteger(process.env.PROCESSOR_HEARTBEAT_SECONDS, 60) * 1000,
  maxRuntimeMs: positiveInteger(process.env.PROCESSOR_MAX_JOB_RUNTIME_MINUTES, 180) * 60 * 1000,
  maximumChangeInputBytes:
    positiveInteger(process.env.PROCESSOR_MAX_CHANGE_INPUT_MIB, 1024) * 1024 * 1024,
  maximumPointcloudInputBytes:
    positiveInteger(process.env.PROCESSOR_MAX_POINTCLOUD_INPUT_MIB, 1024) * 1024 * 1024,
  pdalBinary: resolve(process.env.PDAL_BIN || "/usr/local/bin/pdal"),
  activeHumanDurationMs: nonnegativeInteger(process.env.PROCESSOR_ACTIVE_HUMAN_MS, 0),
  chromePath: process.env.PROCESSOR_CHROME_PATH?.trim() || undefined,
  posterCamera: parsePosterCameraJson(process.env.PROCESSOR_POSTER_CAMERA_JSON),
};

if (posterOnly) {
  const source = process.argv[posterOnlyIndex + 1];
  const destination = process.argv[posterOnlyIndex + 2];
  if (!source || !destination) {
    throw new Error("Usage: node scripts/processing-agent.mjs --poster-only <scene.rad> <poster.png>");
  }
  const sourceFormat = extname(source).slice(1).toLowerCase();
  const posterCamera = parsePosterCameraJson(process.env.PROCESSOR_POSTER_CAMERA_JSON);
  const posterRenderer = webScenePosterRenderer(sourceFormat);
  if (posterRenderer === "spark") {
    await generateSparkPoster(
      resolve(source),
      resolve(destination),
      process.env.PROCESSOR_CHROME_PATH?.trim(),
      posterCamera,
    );
  } else {
    throw new ProcessingAgentError(
      "UNSUPPORTED_POSTER_SCENE",
      `Poster rendering does not support ${sourceFormat}; convert the scene to Spark RAD first`,
      { failureClass: "input_validation", retryable: false },
    );
  }
  console.log(JSON.stringify({
    event: "processor.poster_smoke_succeeded",
    source: resolve(source),
    destination: resolve(destination),
  }));
  process.exit(0);
}

await access(configuration.sparkBinary).catch(() => {
  throw new ProcessingAgentError(
    "SPARK_PROCESSOR_MISSING",
    `Spark build-lod is not installed at ${configuration.sparkBinary}; run npm run processor:setup`,
    { failureClass: "configuration", retryable: false },
  );
});
await access(configuration.splatTransformBinary).catch(() => {
  throw new ProcessingAgentError(
    "SPLAT_NORMALIZER_MISSING",
    `SplatTransform is not installed at ${configuration.splatTransformBinary}`,
    { failureClass: "configuration", retryable: false },
  );
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    log("processor.stopping", { signal });
  });
}

log("processor.started", {
  processorVersion,
  sparkVersion,
  workerId: configuration.workerId,
  origin: configuration.origin,
  mode: once ? "once" : "continuous",
  maximumChangeInputBytes: configuration.maximumChangeInputBytes,
  maximumPointcloudInputBytes: configuration.maximumPointcloudInputBytes,
});

do {
  const result = await processNextJob();
  if (once) {
    log("processor.once_complete", result);
    break;
  }
  if (!result.claimed && !stopping) await delay(configuration.pollMs);
} while (!stopping);

async function processNextJob() {
  const leaseResponse = await fetchWithRetry("/api/worker/jobs/lease", {
    method: "POST",
    body: JSON.stringify({
      workerId: configuration.workerId,
      ...(configuration.jobId ? { jobId: configuration.jobId } : {}),
    }),
  }, { allowNoContent: true });
  if (leaseResponse.status === 204) return { claimed: false };
  const lease = await leaseResponse.json();
  const job = lease.job;
  const posterCamera = job.posterCamera
    ? parsePosterCameraJson(JSON.stringify(job.posterCamera))
    : configuration.posterCamera;
  const jobStartedAt = performance.now();
  const workDirectory = await mkdtemp(join(tmpdir(), `spatial-${job.id}-`));
  let heartbeatTimer;
  let heartbeatFailure = null;
  let stageProgress = 2;
  let stageMessage = "Spatial processing is starting";
  const reportProgress = async (progress, message) => {
    stageProgress = progress;
    stageMessage = message;
    return heartbeat(job.id, lease.leaseToken, progress, message);
  };

  try {
    heartbeatTimer = setInterval(() => {
      void heartbeat(job.id, lease.leaseToken, stageProgress, stageMessage)
        .catch((error) => {
          heartbeatFailure = error;
          log("processor.heartbeat_failed", { jobId: job.id, error: safeMessage(error) });
        });
    }, configuration.heartbeatMs);
    heartbeatTimer.unref?.();

    if (job.jobType === "registered-scene-change-v1") {
      const result = await processRegisteredSceneChange(
        job,
        lease.leaseToken,
        workDirectory,
        () => heartbeatFailure,
        reportProgress,
      );
      return { claimed: true, jobId: job.id, state: "SUCCEEDED", ...result };
    }

    await reportProgress(3, "Downloading immutable source");
    const sourcePath = join(workDirectory, job.input.fileName);
    const download = await downloadSource(job, lease.leaseToken, sourcePath);
    if (download.sizeBytes !== job.input.sizeBytes) {
      throw new ProcessingAgentError(
        "SOURCE_SIZE_MISMATCH",
        `Downloaded ${download.sizeBytes} bytes; expected ${job.input.sizeBytes}`,
        { failureClass: "storage", retryable: true },
      );
    }
    if (job.input.sha256 && job.input.sha256 !== download.sha256) {
      throw new ProcessingAgentError(
        "SOURCE_HASH_MISMATCH",
        "Downloaded source SHA-256 does not match the immutable asset record",
        { failureClass: "storage", retryable: true },
      );
    }

    if (job.jobType === "floorplan.extract-v1") {
      if (!job.floorplanExtractionId || !job.floorplanConfig) {
        throw new ProcessingAgentError(
          "FLOORPLAN_JOB_INCOMPLETE",
          "Floor-plan extraction lease is missing its extraction identity or bounded parameters",
          { failureClass: "configuration", retryable: false },
        );
      }
      if (download.sizeBytes > configuration.maximumPointcloudInputBytes) {
        throw new ProcessingAgentError(
          "FLOORPLAN_INPUT_CAPACITY_EXCEEDED",
          `Point cloud is ${download.sizeBytes} bytes; the worker limit is ${configuration.maximumPointcloudInputBytes}`,
          {
            failureClass: "capacity",
            retryable: false,
            details: {
              inputBytes: download.sizeBytes,
              maximumInputBytes: configuration.maximumPointcloudInputBytes,
            },
          },
        );
      }
      await reportProgress(24, "Normalizing vendor point cloud to metric PLY");
      const normalized = await normalizeMetricPointCloud({
        sourcePath,
        sourceFormat: String(job.input.format).toLowerCase(),
        sourceUpAxis: String(job.floorplanConfig.sourceUpAxis ?? "y"),
        workDirectory,
        pdalBinary: configuration.pdalBinary,
        timeoutMs: configuration.maxRuntimeMs,
      });
      await reportProgress(48, "Building bounded metric occupancy");
      const sourceBytes = await readFile(normalized.path);
      const signature = parsePlySceneSignature(sourceBytes, {
        voxelSizeM: Math.max(0.025, Math.min(
          Number(job.floorplanConfig.gridSizeM) / 2,
          Number(job.floorplanConfig.floorBandM),
        )),
        maximumSamplePoints: Number(job.floorplanConfig.maximumSamplePoints),
      });
      await reportProgress(70, "Deriving reviewable rooms, walls, and openings");
      const report = extractMetricFloorPlan(signature, {
        gridSizeM: Number(job.floorplanConfig.gridSizeM),
        floorBandM: Number(job.floorplanConfig.floorBandM),
        wallMinHeightM: Number(job.floorplanConfig.wallMinHeightM),
        wallMaxHeightM: Number(job.floorplanConfig.wallMaxHeightM),
        minimumWallHeightCoverage: Number(job.floorplanConfig.minimumWallHeightCoverage),
        minimumRoomAreaM2: Number(job.floorplanConfig.minimumRoomAreaM2),
        maximumOpeningWidthM: Number(job.floorplanConfig.maximumOpeningWidthM),
        maximumRooms: Number(job.floorplanConfig.maximumRooms),
        maximumSamplePoints: Number(job.floorplanConfig.maximumSamplePoints),
        elevationHintM: job.floorplanConfig.elevationHintM === null
          ? null
          : Number(job.floorplanConfig.elevationHintM),
      });
      report.parameters.sourceUpAxis = String(job.floorplanConfig.sourceUpAxis ?? "y");
      report.floorplanExtractionId = job.floorplanExtractionId;
      report.source = {
        ...report.source,
        assetId: job.input.id,
        fileName: job.input.fileName,
        sourceFormat: String(job.input.format).toLowerCase(),
        normalizedFormat: "ply",
        sizeBytes: download.sizeBytes,
        sha256: download.sha256,
        coordinateAssurance: String(job.floorplanConfig.coordinateAssurance),
        registrationEvidence: String(job.floorplanConfig.registrationEvidence),
      };
      const reportPath = join(
        workDirectory,
        `floorplan-proposal-${job.floorplanExtractionId}.json`,
      );
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await reportProgress(88, "Uploading immutable floor-plan proposal");
      const output = await uploadOutput(job, lease.leaseToken, "report", reportPath, "application/json");
      let collisionOutput = null;
      if (job.floorplanConfig.automaticPipeline === true) {
        await reportProgress(92, "Building automatic structural collision draft");
        try {
          const collisionPath = join(
            workDirectory,
            `automatic-structural-collision-${job.floorplanExtractionId}.glb`,
          );
          const collisionBytes = buildAuthoredStructuralCollisionGlb(
            buildAutomaticStructuralCollisionConfig(report),
            {
              generator: "Spatial Studio automatic-floorplan-collision-v2",
              source: {
                floorplanExtractionId: job.floorplanExtractionId,
                inputAssetId: job.input.id,
                inputSha256: download.sha256,
                humanReviewRequired: true,
              },
            },
          );
          await writeFile(collisionPath, collisionBytes, { mode: 0o600 });
          collisionOutput = await uploadOutput(
            job,
            lease.leaseToken,
            "collision",
            collisionPath,
            "model/gltf-binary",
          );
        } catch (error) {
          if (error?.code !== "AUTOMATIC_COLLISION_CEILING_MISSING") throw error;
        }
      }
      if (heartbeatFailure) throw heartbeatFailure;
      const computeDurationMs = Math.round(performance.now() - jobStartedAt);
      const completion = await fetchJson(`/api/worker/jobs/${job.id}/floorplan-extraction-complete`, {
        method: "POST",
        body: JSON.stringify({
          leaseToken: lease.leaseToken,
          progressMessage: collisionOutput
            ? "Floor-plan, collision, and navigation drafts are ready for review"
            : "Indicative floor-plan proposal is ready for operator review",
          output,
          ...(collisionOutput ? { collisionOutput } : {}),
          report,
          evidence: {
            processorVersion,
            computeDurationMs,
            activeHumanDurationMs: configuration.activeHumanDurationMs,
            inputBytes: download.sizeBytes,
            outputBytes: output.sizeBytes + (collisionOutput?.sizeBytes ?? 0),
            toolVersions: {
              node: process.version,
              processor: "0.14.0",
              extractor: "metric-pointcloud-floorplan-v2",
              normalizer: normalized.tool,
              ...(collisionOutput
                ? { collision: "automatic-floorplan-collision-v2" }
                : {}),
            },
            normalization: {
              sourceFormat: String(job.input.format).toLowerCase(),
              sourceUpAxis: String(job.floorplanConfig.sourceUpAxis ?? "y"),
              normalizedFormat: "ply",
              tool: normalized.tool,
              commandDigest: normalized.commandDigest,
            },
          },
        }),
      });
      log("processor.floorplan_extraction_succeeded", {
        jobId: job.id,
        floorplanExtractionId: job.floorplanExtractionId,
        roomCount: report.rooms.length,
        wallCount: report.walls.length,
        openingCount: report.openings.length,
        computeDurationMs,
        reportAssetId: completion.reportAssetId,
      });
      return {
        claimed: true,
        jobId: job.id,
        state: "SUCCEEDED",
        floorplanExtractionId: job.floorplanExtractionId,
      };
    }

    if (job.jobType === "navigation.build-v1") {
      if (!job.navigationBuildId || !job.navigationBuildConfig) {
        throw new ProcessingAgentError(
          "NAVIGATION_JOB_INCOMPLETE",
          "Navigation lease is missing its build identity or immutable parameters",
          { failureClass: "configuration", retryable: false },
        );
      }
      if (String(job.input.format).toLowerCase() !== "glb") {
        throw new ProcessingAgentError(
          "NAVIGATION_COLLISION_FORMAT_UNSUPPORTED",
          "Offline Recast navigation requires a canonical collision GLB",
          { failureClass: "input_validation", retryable: false },
        );
      }
      await reportProgress(25, "Decoding canonical collision GLB");
      const collisionBytes = await readFile(sourcePath);
      let geometry;
      let artifact;
      try {
        geometry = await extractCollisionGeometryFromGlb(collisionBytes);
        const navigationConfig = job.navigationBuildConfig.automaticLayout
          ? {
            ...buildAutomaticNavigationLayout(job.navigationBuildConfig, geometry),
            // A raw capture can hold rooms the scanner saw but never walked
            // into; scope the automatic proposal to the spawn's component and
            // surface the exclusions for review instead of failing the build.
            acceptance: "largest-component",
          }
          : job.navigationBuildConfig;
        await reportProgress(48, "Building radius-cleared tiled Recast mesh");
        artifact = await buildRecastNavigationArtifact({
          ...navigationConfig,
          positions: geometry.positions,
          indices: geometry.indices,
          ...(geometry.collisionSemantics
            ? {
                collisionSemantics: geometry.collisionSemantics,
                dynamicBarriers: geometry.dynamicBarriers,
                ...(geometry.structuralGeometry
                  ? { structuralGeometry: geometry.structuralGeometry }
                  : {}),
              }
            : {}),
          // The shell states which visual master it was drawn against. Carrying
          // that digest lets the Worker confirm the binding against its own
          // asset rows, which is the only registration an authored shell over a
          // single visual can honestly offer.
          ...(geometry.authoredVisualBinding
            ? { authoredVisualBinding: geometry.authoredVisualBinding }
            : {}),
          source: {
            ...navigationConfig.source,
            assetId: job.input.id,
            sha256: download.sha256,
          },
        });
        await reportProgress(65, "Replaying every route with a Rapier capsule");
        artifact.physicalValidation = await validatePhysicalNavigation({
          artifact,
          positions: geometry.positions,
          indices: geometry.indices,
          obstacleBoxes: job.navigationBuildConfig.obstacleBoxes ?? [],
        });
        if (artifact.schemaVersion === "spatial-navigation-v9") {
          artifact.authoredTraversalValidation = await validateAuthoredTraversals({
            artifact,
            positions: geometry.positions,
            indices: geometry.indices,
            obstacleBoxes: job.navigationBuildConfig.obstacleBoxes ?? [],
          });
        }
        if (["spatial-navigation-v7", "spatial-navigation-v8", "spatial-navigation-v9"].includes(artifact.schemaVersion)) {
          artifact.structuralValidation = await validateStructuralNavigation({
            artifact,
            positions: geometry.positions,
            indices: geometry.indices,
            ignoredMeshCount: geometry.ignoredMeshCount,
          });
        }
        const pinnedCapture = job.navigationBuildConfig.automaticLayout?.capture;
        if (pinnedCapture && geometry.structuralGeometry) {
          // The proposal-time capture agreement cannot see walls the operator
          // added or moved during review. This reads the FINAL barrier set —
          // the exact geometry this collision GLB was cooked from — back
          // against the capture, and the Worker refuses automatic acceptance
          // when a crossing here lacks a frozen wall-affirming classification.
          await reportProgress(74, "Reading the final structural shell back against its capture");
          const capturePath = join(workDirectory, "navigation-capture-input");
          await downloadLeasedFile(
            `/api/worker/jobs/${job.id}/inputs/capture`,
            lease.leaseToken,
            capturePath,
          );
          const normalizedCapture = await normalizeMetricPointCloud({
            sourcePath: capturePath,
            sourceFormat: String(pinnedCapture.sourceFormat ?? "ply").toLowerCase(),
            sourceUpAxis: pinnedCapture.sourceUpAxis === "z" ? "z" : "y",
            workDirectory,
            pdalBinary: configuration.pdalBinary,
            timeoutMs: configuration.maxRuntimeMs,
          });
          const captureSignature = parsePlySceneSignature(
            await readFile(normalizedCapture.path),
            { voxelSizeM: 0.05, maximumSamplePoints: 2_000_000 },
          );
          artifact.finalCaptureAgreement = finalShellCaptureAgreement(
            captureSignature,
            geometry.structuralGeometry,
          );
        }
      } catch (error) {
        if (error instanceof NavigationBuildError) {
          throw new ProcessingAgentError(error.code, error.message, {
            failureClass: "input_validation",
            retryable: false,
            details: error.details,
            cause: error,
          });
        }
        throw error;
      }
      const navmeshPath = join(workDirectory, `navigation-${job.navigationBuildId}.bin`);
      const reportPath = join(workDirectory, `navigation-${job.navigationBuildId}.json`);
      await writeFile(
        navmeshPath,
        Buffer.from(artifact.detour.bytesBase64, "base64"),
        { mode: 0o600 },
      );
      await writeFile(reportPath, `${JSON.stringify(artifact, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await reportProgress(82, "Uploading frozen Detour and reachability evidence");
      const navmeshOutput = await uploadOutput(
        job,
        lease.leaseToken,
        "navmesh",
        navmeshPath,
        "application/octet-stream",
      );
      const reportOutput = await uploadOutput(
        job,
        lease.leaseToken,
        "report",
        reportPath,
        "application/json",
      );
      if (heartbeatFailure) throw heartbeatFailure;
      const computeDurationMs = Math.round(performance.now() - jobStartedAt);
      await fetchJson(`/api/worker/jobs/${job.id}/complete`, {
        method: "POST",
        body: JSON.stringify({
          leaseToken: lease.leaseToken,
          progressMessage: "Recast navigation is ready for operator review",
          outputs: [navmeshOutput, reportOutput],
          report: artifact,
          evidence: {
            processorVersion,
            computeDurationMs,
            activeHumanDurationMs: configuration.activeHumanDurationMs,
            inputBytes: download.sizeBytes,
            outputBytes: navmeshOutput.sizeBytes + reportOutput.sizeBytes,
            toolVersions: {
              node: process.version,
              processor: "0.14.0",
              recastNavigationJs: "0.43.1",
              nativeRecast: artifact.generator.nativeRecastCommit,
              rapier3d: artifact.physicalValidation.version,
              collisionDecoder: `three/${threeRevision}`,
            },
          },
        }),
      });
      log("processor.navigation_build_succeeded", {
        jobId: job.id,
        navigationBuildId: job.navigationBuildId,
        sourceTriangles: geometry.indices.length / 3,
        navigationTriangles: artifact.navMesh.indices.length / 3,
        destinationCount: artifact.validation.destinationCount,
        computeDurationMs,
      });
      return {
        claimed: true,
        jobId: job.id,
        state: "SUCCEEDED",
        navigationBuildId: job.navigationBuildId,
      };
    }

    if (job.jobType === "semantic.extract-v1") {
      if (!job.semanticExtractionId || !job.semanticConfig) {
        throw new ProcessingAgentError(
          "SEMANTIC_JOB_INCOMPLETE",
          "Semantic extraction lease is missing its extraction identity or bounded parameters",
          { failureClass: "configuration", retryable: false },
        );
      }
      await reportProgress(35, "Building bounded registered PLY occupancy");
      const sourceBytes = await readFile(sourcePath);
      const sourceToWorld = job.semanticConfig.sourceToWorld &&
        typeof job.semanticConfig.sourceToWorld === "object"
        ? job.semanticConfig.sourceToWorld
        : null;
      const metresPerSourceUnit = sourceToWorld
        ? Number(sourceToWorld.metresPerSourceUnit)
        : 1;
      const signature = parsePlySceneSignature(sourceBytes, {
        voxelSizeM: Math.max(0.05, Math.min(
          Number(job.semanticConfig.gridSizeM) / 2,
          Number(job.semanticConfig.floorBandM),
        )) / metresPerSourceUnit,
        maximumSamplePoints: Number(job.semanticConfig.maximumSamplePoints),
      });
      await reportProgress(68, "Extracting reviewable walkable polygons");
      const report = extractWalkableSemanticCandidates(signature, {
        gridSizeM: Number(job.semanticConfig.gridSizeM),
        floorBandM: Number(job.semanticConfig.floorBandM),
        minimumAreaM2: Number(job.semanticConfig.minimumAreaM2),
        maximumCandidates: Number(job.semanticConfig.maximumCandidates),
        elevationHintM: job.semanticConfig.elevationHintM === null
          ? null
          : Number(job.semanticConfig.elevationHintM),
        sourceToWorld,
      });
      report.semanticExtractionId = job.semanticExtractionId;
      report.source = {
        ...report.source,
        assetId: job.input.id,
        fileName: job.input.fileName,
        sizeBytes: download.sizeBytes,
        sha256: download.sha256,
        coordinateAssurance: String(job.semanticConfig.coordinateAssurance),
        registrationEvidence: String(job.semanticConfig.registrationEvidence),
        ...(sourceToWorld ? { sourceToWorld } : {}),
      };
      const reportPath = join(workDirectory, `semantic-candidates-${job.semanticExtractionId}.json`);
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await reportProgress(86, "Uploading immutable semantic evidence");
      const output = await uploadOutput(job, lease.leaseToken, "report", reportPath, "application/json");
      if (heartbeatFailure) throw heartbeatFailure;
      const computeDurationMs = Math.round(performance.now() - jobStartedAt);
      const completion = await fetchJson(`/api/worker/jobs/${job.id}/semantic-extraction-complete`, {
        method: "POST",
        body: JSON.stringify({
          leaseToken: lease.leaseToken,
          progressMessage: "Walkable candidates ready for human review",
          output,
          report,
          evidence: {
            processorVersion,
            computeDurationMs,
            activeHumanDurationMs: configuration.activeHumanDurationMs,
            inputBytes: download.sizeBytes,
            outputBytes: output.sizeBytes,
            toolVersions: {
              node: process.version,
              processor: "0.14.0",
              extractor: sourceToWorld
                ? "registered-ply-walkable-candidates-v2"
                : "registered-ply-walkable-candidates-v1",
            },
          },
        }),
      });
      log("processor.semantic_extraction_succeeded", {
        jobId: job.id,
        semanticExtractionId: job.semanticExtractionId,
        candidateCount: report.candidates.length,
        computeDurationMs,
        inputBytes: download.sizeBytes,
        outputBytes: output.sizeBytes,
        reportAssetId: completion.reportAssetId,
      });
      return {
        claimed: true,
        jobId: job.id,
        state: "SUCCEEDED",
        semanticExtractionId: job.semanticExtractionId,
      };
    }

    if (job.jobType === "asset.evidence-validate") {
      await reportProgress(45, "Validating immutable capture evidence");
      const validation = await validateEvidenceSource(
        sourcePath,
        job.input.format,
        job.input.purpose,
      );
      const posterRenderer = job.input.purpose === "web_scene"
        ? webScenePosterRenderer(job.input.format)
        : null;
      let posterPath;
      let posterMetadata;
      if (posterRenderer) {
        await reportProgress(65, "Rendering Spark RAD poster");
        posterPath = join(workDirectory, "poster.png");
        await generateSparkPoster(
          sourcePath,
          posterPath,
          configuration.chromePath,
          posterCamera,
        );
        posterMetadata = await fileMetadata(posterPath);
      }
      // ASTM E57 is a public container standard, so its scan poses, bounds,
      // point-field inventory, and image records can be preserved as evidence
      // instead of being reduced to unlabelled points. A structure read that
      // fails must never block preservation of the immutable bytes.
      let structureReportPath;
      let structureMetadata;
      let structureSummary = null;
      let structureEvidence = { attempted: false, status: "not_applicable" };
      if (job.input.format === "e57") {
        await reportProgress(70, "Reading E57 container structure");
        try {
          const structure = await readE57Structure(sourcePath);
          structureReportPath = join(workDirectory, "e57-structure.json");
          await writeFile(structureReportPath, serializeE57StructureReport(structure));
          structureMetadata = await fileMetadata(structureReportPath);
          structureSummary = {
            status: "structure_read",
            ...e57StructureSummary(structure),
            reportSha256: structureMetadata.sha256,
          };
          structureEvidence = {
            attempted: true,
            status: "structure_read",
            schemaVersion: structure.schemaVersion,
            method: structure.method,
            reportSha256: structureMetadata.sha256,
            scanCount: structure.summary.scanCount,
            imageCount: structure.summary.imageCount,
            hasPerScanPoses: structure.summary.hasPerScanPoses,
            vendorFieldNames: structure.summary.vendorFieldNames,
            limitations: structure.limitations,
          };
        } catch (error) {
          structureReportPath = undefined;
          structureMetadata = undefined;
          structureEvidence = {
            attempted: true,
            status: "structure_unreadable",
            code: error?.code ?? "E57_STRUCTURE_UNREADABLE",
            reason: safeMessage(error),
            limitation:
              "The bounded file-signature check still preserves these bytes; no scan pose, image, or point-field evidence could be read from this container.",
          };
          // The bytes are still preserved and still complete the job. The gap
          // is declared rather than hidden behind a silent magic-check pass.
          structureSummary = {
            status: "structure_unreadable",
            method: "e57-structure-parser-v1",
            scanCount: 0,
            imageCount: 0,
            hasPerScanPoses: false,
            vendorFieldNames: [],
            reportSha256: null,
            reason: structureEvidence.reason,
          };
          log("processor.e57_structure_unreadable", {
            jobId: job.id,
            code: structureEvidence.code,
            reason: structureEvidence.reason,
          });
        }
      }
      const report = {
        schemaVersion: "1.0.0",
        status: "pending_human_review",
        processor: {
          name: processorVersion,
          validationMethod: validation.method,
        },
        source: {
          assetId: job.input.id,
          fileName: job.input.fileName,
          format: job.input.format,
          purpose: job.input.purpose,
          sizeBytes: download.sizeBytes,
          sha256: download.sha256,
          validation,
        },
          ...(posterMetadata
          ? {
            derivatives: {
              poster: {
                fileName: basename(posterPath),
                sizeBytes: posterMetadata.sizeBytes,
                sha256: posterMetadata.sha256,
              },
            },
            rendering: {
              renderer: posterRenderer,
              posterCamera: posterCamera
                ? { mode: "authored", ...posterCamera }
                : { mode: "auto" },
              sourceContainerPreserved: true,
            },
          }
          : {}),
        ...(structureEvidence.attempted ? { containerStructure: structureEvidence } : {}),
        checks: {
          sourceBytesVerified: true,
          sourceHashVerified: job.input.sha256 ? true : "not_supplied",
          boundedSignatureChecked: true,
          semanticValidation: false,
          ...(structureEvidence.attempted
            ? { containerStructure: structureEvidence.status }
            : {}),
          ...(posterRenderer
            ? {
              posterRenderedBy: posterRenderer,
              privacyReview: "required",
              visualReview: "required",
            }
            : {}),
          humanEvidenceReview: "required",
        },
        generatedAt: new Date().toISOString(),
      };
      await reportProgress(92, "Recording evidence integrity result");
      const outputs = [];
      if (posterPath) {
        outputs.push(await uploadOutput(
          job,
          lease.leaseToken,
          "poster",
          posterPath,
          "image/png",
        ));
      }
      if (structureReportPath) {
        outputs.push(await uploadOutput(
          job,
          lease.leaseToken,
          "report",
          structureReportPath,
          "application/json",
        ));
      }
      const outputBytes = outputs.reduce((total, output) => total + output.sizeBytes, 0);
      if (heartbeatFailure) throw heartbeatFailure;
      const computeDurationMs = Math.round(performance.now() - jobStartedAt);
      const completion = await fetchJson(`/api/worker/jobs/${job.id}/complete`, {
        method: "POST",
        body: JSON.stringify({
          leaseToken: lease.leaseToken,
          progressMessage: posterRenderer
            ? "Immutable web scene verified and Spark poster generated"
            : "Immutable capture evidence passed bounded integrity validation",
          outputs,
          report,
          ...(structureSummary ? { captureScanStructure: structureSummary } : {}),
          evidence: {
            processorVersion,
            computeDurationMs,
            activeHumanDurationMs: configuration.activeHumanDurationMs,
            inputBytes: download.sizeBytes,
            outputBytes,
            toolVersions: {
              node: process.version,
              processor: "0.14.0",
              validator: "bounded-file-signature-v1",
              ...(structureEvidence.attempted
                ? { e57Structure: "e57-structure-parser-v1" }
                : {}),
              ...(posterRenderer
                ? {
                  renderer: posterRenderer,
                  spark: sparkVersion,
                  posterCamera: posterCamera ? "authored" : "auto",
                }
                : {}),
            },
          },
        }),
      });
      log("processor.evidence_succeeded", {
        jobId: job.id,
        projectId: job.projectId,
        purpose: job.input.purpose,
        format: job.input.format,
        computeDurationMs,
        inputBytes: download.sizeBytes,
        qaReportId: completion.qaReportId,
      });
      return { claimed: true, jobId: job.id, state: "SUCCEEDED" };
    }

    await reportProgress(12, "Validating Gaussian source");
    const sourceValidation = await validateSource(sourcePath, job.input.format);
    const preparedSource = await prepareSparkSource(
      sourcePath,
      job.input.format,
      sourceValidation,
      workDirectory,
      configuration.splatTransformBinary,
      configuration.maxRuntimeMs,
    );
    await reportProgress(20, "Building Spark quality RAD LoD");
    const radPath = await buildSparkRad(
      preparedSource.path,
      job.input.format,
      preparedSource.maximumShDegree,
      configuration.sparkBinary,
      configuration.maxRuntimeMs,
    );
    if (heartbeatFailure) throw heartbeatFailure;
    const radMetadata = await fileMetadata(radPath);

    let compactSpzPath = null;
    let compactSpzMetadata = null;
    if (job.input.format === "ply") {
      await reportProgress(60, "Writing compact SPZ release");
      const candidateSpzPath = join(
        workDirectory,
        `${basename(preparedSource.path, extname(preparedSource.path))}-compact.spz`,
      );
      try {
        await runProcess(
          configuration.splatTransformBinary,
          [preparedSource.path, candidateSpzPath],
          configuration.maxRuntimeMs,
          {
            tool: "SplatTransform",
            event: "splat.compact_spz",
            startCode: "SPLAT_COMPACT_START_FAILED",
            failureCode: "SPLAT_COMPACT_FAILED",
            timeoutCode: "SPLAT_COMPACT_TIMEOUT",
            failureClass: "conversion",
          },
        );
        await access(candidateSpzPath);
        compactSpzPath = candidateSpzPath;
        compactSpzMetadata = await fileMetadata(candidateSpzPath);
      } catch (error) {
        // The compact SPZ derivative is optional evidence: the Spark RAD stays
        // the canonical web scene, so a compaction failure must not fail the job.
        log("processor.compact_spz_skipped", { jobId: job.id, error: safeMessage(error) });
      }
    }

    await reportProgress(72, "Rendering Spark scene poster");
    const posterPath = join(workDirectory, "poster.png");
    await generateSparkPoster(
      radPath,
      posterPath,
      configuration.chromePath,
      posterCamera,
    );
    const posterMetadata = await fileMetadata(posterPath);

    const reportPath = join(workDirectory, "qa-report.json");
    const report = {
      schemaVersion: "1.0.0",
      status: "pending_human_review",
      processor: {
        name: processorVersion,
        sparkVersion,
        buildLodMode: "quality",
        maximumSphericalHarmonicDegree: 3,
      },
      source: {
        assetId: job.input.id,
        fileName: job.input.fileName,
        format: job.input.format,
        sizeBytes: download.sizeBytes,
        sha256: download.sha256,
        validation: {
          ...sourceValidation,
          normalization: preparedSource.normalization,
        },
      },
      derivatives: {
        web: { fileName: basename(radPath), sizeBytes: radMetadata.sizeBytes, sha256: radMetadata.sha256 },
        ...(compactSpzMetadata
          ? {
            compact: {
              fileName: basename(compactSpzPath),
              sizeBytes: compactSpzMetadata.sizeBytes,
              sha256: compactSpzMetadata.sha256,
            },
          }
          : {}),
        poster: { fileName: basename(posterPath), sizeBytes: posterMetadata.sizeBytes, sha256: posterMetadata.sha256 },
      },
      rendering: {
        posterCamera: posterCamera
          ? { mode: "authored", ...posterCamera }
          : { mode: "auto" },
      },
      checks: {
        sourceBytesVerified: true,
        sourceHashVerified: job.input.sha256 ? true : "not_supplied",
        sparkDecoderValidated: true,
        radGenerated: true,
        posterRenderedBySpark: true,
        privacyReview: "required",
        visualReview: "required",
      },
      generatedAt: new Date().toISOString(),
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    const reportMetadata = await fileMetadata(reportPath);

    await reportProgress(82, "Uploading immutable derivatives");
    const outputs = [];
    outputs.push(await uploadOutput(job, lease.leaseToken, "web", radPath, "application/octet-stream"));
    if (compactSpzPath) {
      outputs.push(await uploadOutput(job, lease.leaseToken, "portable", compactSpzPath, "application/octet-stream"));
    }
    outputs.push(await uploadOutput(job, lease.leaseToken, "poster", posterPath, "image/png"));
    outputs.push(await uploadOutput(job, lease.leaseToken, "report", reportPath, "application/json"));
    const outputBytes = outputs.reduce((total, output) => total + output.sizeBytes, 0);
    if (heartbeatFailure) throw heartbeatFailure;

    await reportProgress(96, "Registering derivatives and QA report");
    const computeDurationMs = Math.round(performance.now() - jobStartedAt);
    const completion = await fetchJson(`/api/worker/jobs/${job.id}/complete`, {
      method: "POST",
      body: JSON.stringify({
        leaseToken: lease.leaseToken,
        progressMessage: "Spark quality RAD, rendered poster, and QA report generated",
        outputs,
        report,
        evidence: {
          processorVersion,
          computeDurationMs,
          activeHumanDurationMs: configuration.activeHumanDurationMs,
          inputBytes: download.sizeBytes,
          outputBytes,
          toolVersions: {
            spark: sparkVersion,
            buildLod: "spark-v2.1.0-quality",
            splatTransform: "3.1.7",
            node: process.version,
            processor: "0.14.0",
            posterCamera: posterCamera ? "authored" : "auto",
          },
        },
      }),
    });
    log("processor.job_succeeded", {
      jobId: job.id,
      projectId: job.projectId,
      computeDurationMs,
      inputBytes: download.sizeBytes,
      outputBytes,
      qaReportId: completion.qaReportId,
    });
    return { claimed: true, jobId: job.id, state: "SUCCEEDED" };
  } catch (error) {
    const failure = processorFailure(error);
    log("processor.job_failed", { jobId: job.id, ...failure });
    try {
      await fetchJson(`/api/worker/jobs/${job.id}/fail`, {
        method: "POST",
        body: JSON.stringify({ leaseToken: lease.leaseToken, ...failure }),
      });
    } catch (reportError) {
      log("processor.failure_report_failed", {
        jobId: job.id,
        error: safeMessage(reportError),
      });
    }
    return { claimed: true, jobId: job.id, state: "FAILED", failure };
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await rm(workDirectory, { recursive: true, force: true });
  }
}

async function processRegisteredSceneChange(job, leaseToken, workDirectory, heartbeatFailure, reportProgress) {
  if (!job.secondaryInput || !job.changeReportId || !job.changeConfig) {
    throw new ProcessingAgentError(
      "CHANGE_JOB_INCOMPLETE",
      "Registered-scene change lease is missing its candidate input or configuration",
      { failureClass: "configuration", retryable: false },
    );
  }
  const jobStartedAt = performance.now();
  assertRegisteredSceneChangeCapacity({
    baselineSizeBytes: Number(job.input.sizeBytes),
    candidateSizeBytes: Number(job.secondaryInput.sizeBytes),
    maximumInputBytes: configuration.maximumChangeInputBytes,
  });
  await reportProgress(3, "Downloading registered baseline");
  const baselinePath = join(workDirectory, `baseline-${job.input.fileName}`);
  const baselineDownload = await downloadSource(job, leaseToken, baselinePath);
  verifyDownloadedInput(job.input, baselineDownload, "baseline");

  await reportProgress(16, "Downloading registered candidate");
  const candidatePath = join(workDirectory, `candidate-${job.secondaryInput.fileName}`);
  const candidateDownload = await downloadSource(
    { ...job, input: job.secondaryInput },
    leaseToken,
    candidatePath,
  );
  verifyDownloadedInput(job.secondaryInput, candidateDownload, "candidate");

  await reportProgress(34, "Building bounded registered-scene signatures");
  const [baselineBytes, candidateBytes] = await Promise.all([
    readFile(baselinePath),
    readFile(candidatePath),
  ]);
  const signatureOptions = {
    voxelSizeM: Number(job.changeConfig.voxelSizeM),
    maximumSamplePoints: Number(job.changeConfig.maximumSamplePoints),
  };
  const baseline = parsePlySceneSignature(baselineBytes, signatureOptions);
  const candidate = parsePlySceneSignature(candidateBytes, signatureOptions);

  let report;
  const registrationMode = String(job.changeConfig.registrationMode ?? "declared");
  if (registrationMode === "automatic_rigid") {
    await reportProgress(58, "Estimating bounded yaw and translation");
    const registrationResult = automaticallyRegisterSceneSignatures({
      baseline,
      candidate,
      parameters: {
        searchRadiusM: Number(job.changeConfig.registrationSearchRadiusM),
        maximumRmseMm: Number(job.changeConfig.registrationMaximumRmseMm),
        minimumOverlapPercent: Number(job.changeConfig.registrationMinimumOverlapPercent),
      },
    });
    const { registeredCandidate, ...registrationEvidence } = registrationResult;
    const registration = {
      ...registrationEvidence,
      coordinateAssurance: String(job.changeConfig.coordinateAssurance ?? ""),
      evidence: String(job.changeConfig.registrationEvidence ?? ""),
      performedByProcessor: true,
    };
    if (registrationResult.status === "blocked" || !registeredCandidate) {
      report = {
        method: "registered-ply-voxel-change-v1",
        result: "registration_blocked",
        scope: "automatic_registration_quality_gate",
        limitation: registrationResult.limitation,
        parameters: {
          voxelSizeM: signatureOptions.voxelSizeM,
          structuralChangeThresholdPercent: Number(job.changeConfig.structuralChangeThresholdPercent),
          photometricChangeThresholdPercent: Number(job.changeConfig.photometricChangeThresholdPercent),
          centroidChangeThresholdMm: Number(job.changeConfig.centroidChangeThresholdMm),
        },
        sources: {
          baseline: { voxelCount: baseline.voxelCount, sampledPointCount: baseline.sampledPointCount },
          candidate: { voxelCount: candidate.voxelCount, sampledPointCount: candidate.sampledPointCount },
        },
        summary: {
          baselineVoxels: baseline.voxelCount,
          candidateVoxels: candidate.voxelCount,
          commonVoxels: 0,
          addedVoxels: 0,
          removedVoxels: 0,
          structurallyChangedPercent: 0,
          photometricallyComparableVoxels: 0,
          changedCommonVoxels: 0,
          p50CentroidDisplacementMm: null,
          p95CentroidDisplacementMm: null,
          maximumCentroidDisplacementMm: null,
          p50PhotometricDeltaPercent: null,
          p95PhotometricDeltaPercent: null,
          maximumPhotometricDeltaPercent: null,
        },
        materialSignals: [
          "Automatic registration did not pass every declared quality gate; change analysis was not run.",
        ],
        changedVoxels: [],
        addedVoxelKeys: [],
        removedVoxelKeys: [],
        registration,
        generatedAt: new Date().toISOString(),
      };
    } else {
      await reportProgress(70, "Comparing registered occupancy, centroids, and mean colour");
      report = compareRegisteredScenes({
        baseline,
        candidate: registeredCandidate,
        parameters: {
          structuralChangeThresholdPercent: Number(job.changeConfig.structuralChangeThresholdPercent),
          photometricChangeThresholdPercent: Number(job.changeConfig.photometricChangeThresholdPercent),
          centroidChangeThresholdMm: Number(job.changeConfig.centroidChangeThresholdMm),
        },
      });
      report.registration = registration;
    }
  } else {
    await reportProgress(66, "Comparing declared registered occupancy, centroids, and mean colour");
    report = compareRegisteredScenes({
      baseline,
      candidate,
      parameters: {
        structuralChangeThresholdPercent: Number(job.changeConfig.structuralChangeThresholdPercent),
        photometricChangeThresholdPercent: Number(job.changeConfig.photometricChangeThresholdPercent),
        centroidChangeThresholdMm: Number(job.changeConfig.centroidChangeThresholdMm),
      },
    });
    report.registration = {
      status: "accepted",
      coordinateAssurance: String(job.changeConfig.coordinateAssurance ?? ""),
      evidence: String(job.changeConfig.registrationEvidence ?? ""),
      performedByProcessor: false,
    };
  }
  report.schemaVersion = "1.0.0";
  report.changeReportId = job.changeReportId;
  report.assets = {
    baseline: {
      id: job.input.id,
      fileName: job.input.fileName,
      format: job.input.format,
      sizeBytes: baselineDownload.sizeBytes,
      sha256: baselineDownload.sha256,
    },
    candidate: {
      id: job.secondaryInput.id,
      fileName: job.secondaryInput.fileName,
      format: job.secondaryInput.format,
      sizeBytes: candidateDownload.sizeBytes,
      sha256: candidateDownload.sha256,
    },
  };
  report.humanReviewRequired = true;
  if (heartbeatFailure()) throw heartbeatFailure();

  const reportPath = join(workDirectory, `registered-change-${job.changeReportId}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await reportProgress(82, "Uploading immutable change evidence");
  const output = await uploadOutput(job, leaseToken, "report", reportPath, "application/json");
  const computeDurationMs = Math.round(performance.now() - jobStartedAt);
  await reportProgress(96, "Registering raw-scene evidence");
  await fetchJson(`/api/worker/jobs/${job.id}/scene-change-complete`, {
    method: "POST",
    body: JSON.stringify({
      leaseToken,
      progressMessage: report.result === "registration_blocked"
        ? "Automatic registration was blocked and is ready for human review"
        : "Registered raw-scene change evidence is ready for human review",
      output,
      report,
      evidence: {
        processorVersion,
        computeDurationMs,
        activeHumanDurationMs: configuration.activeHumanDurationMs,
        baselineInputBytes: baselineDownload.sizeBytes,
        candidateInputBytes: candidateDownload.sizeBytes,
        inputBytes: baselineDownload.sizeBytes + candidateDownload.sizeBytes,
        outputBytes: output.sizeBytes,
        toolVersions: {
          node: process.version,
          processor: "0.14.0",
          method: "registered-ply-voxel-change-v1",
        },
      },
    }),
  });
  log("processor.change_succeeded", {
    jobId: job.id,
    changeReportId: job.changeReportId,
    computeDurationMs,
    result: report.result,
    baselineBytes: baselineDownload.sizeBytes,
    candidateBytes: candidateDownload.sizeBytes,
  });
  return { changeReportId: job.changeReportId, result: report.result };
}

async function normalizeMetricPointCloud({
  sourcePath,
  sourceFormat,
  sourceUpAxis,
  workDirectory,
  pdalBinary,
  timeoutMs,
}) {
  if (sourceFormat === "ply" && sourceUpAxis === "y") {
    return {
      path: sourcePath,
      tool: "native-ply-v1",
      commandDigest: null,
    };
  }
  if (!["y", "z"].includes(sourceUpAxis)) {
    throw new ProcessingAgentError(
      "UNSUPPORTED_POINTCLOUD_AXIS",
      `Floor-plan normalization does not support a ${sourceUpAxis}-up source`,
      { failureClass: "input_validation", retryable: false },
    );
  }
  const readerByFormat = {
    ply: "readers.ply",
    e57: "readers.e57",
    las: "readers.las",
    laz: "readers.las",
    pts: "readers.pts",
  };
  const reader = readerByFormat[sourceFormat];
  if (!reader) {
    throw new ProcessingAgentError(
      "UNSUPPORTED_FLOORPLAN_SOURCE",
      `Floor-plan normalization does not support ${sourceFormat}`,
      {
        failureClass: "input_validation",
        retryable: false,
        details: { supportedFormats: ["ply", "e57", "las", "laz", "pts"] },
      },
    );
  }
  await access(pdalBinary).catch((error) => {
    throw new ProcessingAgentError(
      "PDAL_PROCESSOR_MISSING",
      `PDAL is required to normalize ${sourceFormat} point clouds`,
      { failureClass: "configuration", retryable: false, cause: error },
    );
  });
  const normalizedPath = join(workDirectory, "registered-pointcloud.normalized.ply");
  const stages = [
    { type: reader, filename: sourcePath },
    ...(sourceUpAxis === "z"
      ? [{
        type: "filters.transformation",
        matrix: "1 0 0 0  0 0 1 0  0 -1 0 0  0 0 0 1",
      }]
      : []),
    {
      type: "writers.ply",
      filename: normalizedPath,
      storage_mode: "little endian",
      dims: "X,Y,Z",
    },
  ];
  const pipelineDocument = {
    pipeline: stages,
  };
  const serialized = `${JSON.stringify(pipelineDocument, null, 2)}\n`;
  const pipelinePath = join(workDirectory, "pdal-floorplan-pipeline.json");
  await writeFile(pipelinePath, serialized, { encoding: "utf8", mode: 0o600 });
  const commandDigest = createHash("sha256").update(serialized).digest("hex");
  await runProcess(
    pdalBinary,
    ["pipeline", pipelinePath],
    timeoutMs,
    {
      tool: "PDAL",
      event: "pointcloud.normalize",
      startCode: "PDAL_START_FAILED",
      failureCode: "PDAL_NORMALIZATION_FAILED",
      timeoutCode: "PDAL_NORMALIZATION_TIMEOUT",
      failureClass: "conversion",
    },
  );
  return {
    path: normalizedPath,
    tool: "PDAL",
    commandDigest,
  };
}

function verifyDownloadedInput(expected, actual, label) {
  if (actual.sizeBytes !== expected.sizeBytes) {
    throw new ProcessingAgentError(
      "SOURCE_SIZE_MISMATCH",
      `Downloaded ${label} is ${actual.sizeBytes} bytes; expected ${expected.sizeBytes}`,
      { failureClass: "storage", retryable: true },
    );
  }
  if (expected.sha256 && expected.sha256 !== actual.sha256) {
    throw new ProcessingAgentError(
      "SOURCE_HASH_MISMATCH",
      `Downloaded ${label} SHA-256 does not match its immutable asset record`,
      { failureClass: "storage", retryable: true },
    );
  }
}

async function downloadSource(job, leaseToken, destination) {
  return downloadLeasedFile(job.input.downloadUrl, leaseToken, destination);
}

async function downloadLeasedFile(url, leaseToken, destination) {
  const response = await fetchWithRetry(url, {
    headers: { "X-Job-Lease": leaseToken },
  });
  if (!response.body) throw new ProcessingAgentError(
    "SOURCE_DOWNLOAD_EMPTY",
    "Worker returned an empty source response",
    { failureClass: "storage", retryable: true },
  );
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const destinationStream = createWriteStream(destination, { mode: 0o600 });
  const hashingStream = new TransformStream({
    transform(chunk, controller) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      sizeBytes += bytes.byteLength;
      hash.update(bytes);
      controller.enqueue(bytes);
    },
  });
  await pipeline(response.body.pipeThrough(hashingStream), destinationStream);
  return { sizeBytes, sha256: hash.digest("hex") };
}

async function validateSource(sourcePath, format) {
  if (format === "sog") {
    return {
      format,
      validatedBy: "SOG metadata and payload preflight",
      ...validateSogArchive(await readBufferedSogArchive(sourcePath)),
    };
  }
  if (format === "spz") {
    const handle = await open(sourcePath, "r");
    try {
      const buffer = Buffer.alloc(16);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return {
        format,
        validatedBy: "SPZ bounded container preflight",
        ...inspectSpzContainer(buffer.subarray(0, bytesRead)),
      };
    } finally {
      await handle.close();
    }
  }
  if (format !== "ply") return { format, validatedBy: "Spark build-lod decoder" };
  const handle = await open(sourcePath, "r");
  try {
    const buffer = Buffer.alloc(2 * 1024 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return validateGaussianPlyHeader(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function prepareSparkSource(
  sourcePath,
  format,
  sourceValidation,
  workDirectory,
  splatTransformBinary,
  timeoutMs,
) {
  const requiresNormalization =
    (format === "spz" && sourceValidation.normalizationRequired)
    || format === "ksplat";
  if (!requiresNormalization) {
    return {
      path: sourcePath,
      maximumShDegree: sparkMaximumSphericalHarmonicDegree(
        format,
        sourceValidation.sphericalHarmonicDegree,
      ),
      normalization: {
        applied: false,
        reason: "source_is_spark_build_lod_compatible",
      },
    };
  }
  const normalizedPath = join(
    workDirectory,
    `${basename(sourcePath, extname(sourcePath))}.normalized.ply`,
  );
  await runProcess(
    splatTransformBinary,
    [sourcePath, normalizedPath],
    timeoutMs,
    {
      tool: "SplatTransform",
      event: "splat.normalize",
      startCode: "SPLAT_NORMALIZATION_START_FAILED",
      failureCode: "SPLAT_NORMALIZATION_FAILED",
      timeoutCode: "SPLAT_NORMALIZATION_TIMEOUT",
      failureClass: "conversion",
    },
  );
  await access(normalizedPath).catch(() => {
    throw new ProcessingAgentError(
      "SPLAT_NORMALIZATION_OUTPUT_MISSING",
      "SplatTransform exited without producing the normalized PLY",
      {
        failureClass: "conversion",
        retryable: false,
        details: { normalizedPath },
      },
    );
  });
  const normalizedValidation = await readGaussianPlyValidation(normalizedPath);
  return {
    path: normalizedPath,
    maximumShDegree: sparkMaximumSphericalHarmonicDegree(
      "ply",
      normalizedValidation.sphericalHarmonicDegree,
    ),
    normalization: {
      applied: true,
      tool: "@playcanvas/splat-transform",
      toolVersion: "3.1.7",
      from: format === "spz" ? "spz-ngsp-v4" : format,
      to: "gaussian-ply",
      originalSourcePreserved: true,
      normalizedValidation,
    },
  };
}

async function readGaussianPlyValidation(sourcePath) {
  const handle = await open(sourcePath, "r");
  try {
    const buffer = Buffer.alloc(2 * 1024 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return validateGaussianPlyHeader(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function validateEvidenceSource(sourcePath, format, purpose) {
  if (format === "sog") {
    return validateEvidenceAsset(await readBufferedSogArchive(sourcePath), { format, purpose });
  }
  const handle = await open(sourcePath, "r");
  try {
    const sourceStat = await handle.stat();
    const buffer = Buffer.alloc(Math.min(sourceStat.size, 2 * 1024 * 1024));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return validateEvidenceAsset(buffer.subarray(0, bytesRead), { format, purpose });
  } finally {
    await handle.close();
  }
}

// Only the 48-byte header and the CRC-paged XML section are ever read. A
// structured E57 can carry gigabytes of point payload; none of it is loaded to
// recover the scan poses, image records, and point-field inventory.
async function readE57Structure(sourcePath) {
  const handle = await open(sourcePath, "r");
  try {
    const headerBytes = Buffer.alloc(E57_HEADER_BYTES);
    const headerRead = await handle.read(headerBytes, 0, E57_HEADER_BYTES, 0);
    if (headerRead.bytesRead !== E57_HEADER_BYTES) {
      throw new ProcessingAgentError(
        "INVALID_E57_HEADER",
        `E57 header requires ${E57_HEADER_BYTES} bytes, read ${headerRead.bytesRead}`,
        { failureClass: "input_validation", retryable: false },
      );
    }
    const header = parseE57Header(headerBytes);
    const span = e57XmlPhysicalSpan(header);
    const sectionBytes = Buffer.alloc(span.physicalLength);
    const sectionRead = await handle.read(
      sectionBytes,
      0,
      span.physicalLength,
      span.physicalStart,
    );
    if (sectionRead.bytesRead !== span.physicalLength) {
      throw new ProcessingAgentError(
        "INVALID_E57_XML_SECTION",
        `E57 XML section requires ${span.physicalLength} bytes, read ${sectionRead.bytesRead}`,
        { failureClass: "input_validation", retryable: false },
      );
    }
    return extractE57Structure(
      header,
      readE57XmlSection(header, sectionBytes, span.physicalStart),
    );
  } finally {
    await handle.close();
  }
}

async function readBufferedSogArchive(sourcePath) {
  const sourceStat = await stat(sourcePath);
  if (sourceStat.size > maximumBufferedSogBytes) {
    throw new ProcessingAgentError(
      "SOG_VALIDATION_CAPACITY_EXCEEDED",
      "SOG sources larger than 256 MiB require a streaming validation path",
      {
        failureClass: "capacity",
        retryable: false,
        details: {
          sourceBytes: sourceStat.size,
          maximumBytes: maximumBufferedSogBytes,
        },
      },
    );
  }
  return readFile(sourcePath);
}

async function buildSparkRad(sourcePath, sourceFormat, maximumShDegree, sparkBinary, timeoutMs) {
  const outputPath = sourcePath.replace(/\.[^.]+$/, "-lod.rad");
  const safeMaximumShDegree = sparkMaximumSphericalHarmonicDegree(
    sourceFormat,
    maximumShDegree,
  );
  await runProcess(
    sparkBinary,
    ["--quality", `--max-sh=${safeMaximumShDegree}`, "--rad", sourcePath],
    timeoutMs,
  );
  await access(outputPath).catch(() => {
    throw new ProcessingAgentError(
      "SPARK_OUTPUT_MISSING",
      "Spark build-lod exited without producing the expected RAD asset",
      { failureClass: "conversion", retryable: false, details: { outputPath } },
    );
  });
  return outputPath;
}

async function uploadOutput(job, leaseToken, kind, filePath, mimeType) {
  const metadata = await fileMetadata(filePath);
  const created = await fetchJson(`/api/worker/jobs/${job.id}/outputs`, {
    method: "POST",
    headers: { "X-Job-Lease": leaseToken },
    body: JSON.stringify({
      kind,
      fileName: basename(filePath),
      mimeType,
      sizeBytes: metadata.sizeBytes,
      sha256: metadata.sha256,
    }),
  });
  const parts = [];
  const handle = await open(filePath, "r");
  try {
    for (const partPlan of planMultipartParts(metadata.sizeBytes, created.upload.partSizeBytes)) {
      const bytes = Buffer.allocUnsafe(partPlan.length);
      const { bytesRead } = await handle.read(bytes, 0, partPlan.length, partPlan.offset);
      if (bytesRead !== partPlan.length) {
        throw new ProcessingAgentError(
          "OUTPUT_READ_INCOMPLETE",
          `Read ${bytesRead} of ${partPlan.length} bytes for output part ${partPlan.partNumber}`,
          { failureClass: "storage", retryable: true },
        );
      }
      const response = await fetchWithRetry(
        `/api/worker/jobs/${job.id}/outputs/${created.upload.id}/parts/${partPlan.partNumber}`,
        {
          method: "PUT",
          headers: {
            "X-Job-Lease": leaseToken,
            "Content-Length": String(bytesRead),
          },
          body: bytes,
        },
      );
      const uploaded = await response.json();
      parts.push({ partNumber: partPlan.partNumber, etag: uploaded.part.etag });
    }
  } finally {
    await handle.close();
  }
  const completed = await fetchJson(
    `/api/worker/jobs/${job.id}/outputs/${created.upload.id}/complete`,
    {
      method: "POST",
      headers: { "X-Job-Lease": leaseToken },
      body: JSON.stringify({ parts }),
    },
  );
  return completed.output;
}

async function heartbeat(jobId, leaseToken, progress, message) {
  return fetchJson(`/api/worker/jobs/${jobId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({ leaseToken, progress, message }),
  });
}

async function fetchJson(path, init = {}) {
  const response = await fetchWithRetry(path, init);
  return response.json();
}

async function fetchWithRetry(path, init = {}, { allowNoContent = false } = {}) {
  const url = path.startsWith("http://") || path.startsWith("https://")
    ? path
    : `${configuration.origin}${path}`;
  // Every per-job route sits under /api/worker/jobs/<jobId>/ and is authorised
  // by the lease token, so a 403 there means the lease was reclaimed or
  // expired, not that this processor is misconfigured.
  const leaseScopedRoute = /^\/api\/worker\/jobs\/[^/]+\//.test(new URL(url).pathname);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${configuration.workerToken}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, headers });
      if (response.ok || (allowNoContent && response.status === 204)) return response;
      const message = await response.text();
      if (response.status === 403 && leaseScopedRoute) {
        throw new ProcessingAgentError(
          "PROCESSOR_LEASE_REJECTED",
          `Platform API rejected the job lease with 403: ${message.slice(0, 1000)}`,
          { failureClass: "lease", retryable: true, details: { status: 403 } },
        );
      }
      if (response.status < 500 && response.status !== 429) {
        throw new ProcessingAgentError(
          "PROCESSOR_API_REJECTED",
          `Platform API returned ${response.status}: ${message.slice(0, 1000)}`,
          { failureClass: "configuration", retryable: false, details: { status: response.status } },
        );
      }
      lastError = new Error(`Platform API returned ${response.status}: ${message.slice(0, 500)}`);
    } catch (error) {
      if (error instanceof ProcessingAgentError) throw error;
      lastError = error;
    }
    if (attempt < 4) await delay(250 * 2 ** (attempt - 1));
  }
  throw new ProcessingAgentError(
    "PROCESSOR_API_UNAVAILABLE",
    safeMessage(lastError),
    { failureClass: "network", retryable: true },
  );
}

async function fileMetadata(path) {
  const hash = createHash("sha256");
  const source = createReadStream(path);
  source.on("data", (chunk) => hash.update(chunk));
  await new Promise((resolvePromise, reject) => {
    source.once("end", resolvePromise);
    source.once("error", reject);
  });
  const metadata = await stat(path);
  return { sizeBytes: metadata.size, sha256: hash.digest("hex") };
}

async function runProcess(command, args, timeoutMs, {
  tool = "Spark build-lod",
  event = "spark.build_lod",
  startCode = "SPARK_PROCESS_START_FAILED",
  failureCode = "SPARK_CONVERSION_FAILED",
  timeoutCode = "SPARK_PROCESS_TIMEOUT",
  failureClass = "conversion",
} = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new ProcessingAgentError(
        timeoutCode,
        `${tool} exceeded ${Math.round(timeoutMs / 60_000)} minutes`,
        { failureClass: "capacity", retryable: true },
      ));
    }, timeoutMs);
    const stderr = [];
    child.stdout.on("data", (chunk) => log(
      processOutputEvent(event, "stdout"),
      { output: String(chunk).trim().slice(0, 2000) },
    ));
    child.stderr.on("data", (chunk) => {
      stderr.push(String(chunk));
      // Several production CLIs, including SplatTransform, emit ordinary
      // progress and summaries on stderr. Preserve the stream as diagnostic
      // evidence without falsely classifying a successful process as an error.
      log(
        processOutputEvent(event, "stderr"),
        { output: String(chunk).trim().slice(0, 2000) },
      );
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new ProcessingAgentError(
        startCode,
        error.message,
        { failureClass: "configuration", retryable: false, cause: error },
      ));
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) return resolvePromise();
      reject(new ProcessingAgentError(
        failureCode,
        `${tool} exited with ${code ?? signal ?? "unknown"}: ${stderr.join("").slice(-2000)}`,
        { failureClass, retryable: false, details: { code, signal } },
      ));
    });
  });
}

async function generateSparkPoster(
  scenePath,
  outputPath,
  configuredChromePath,
  posterCamera = null,
) {
  const sceneDescriptor = sparkPosterSceneDescriptor("rad");
  const server = await startPosterServer(scenePath, posterCamera, sceneDescriptor);
  const executablePath = configuredChromePath || await detectedChromePath();
  let browser;
  let page;
  try {
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      headless: true,
      args: ["--disable-dev-shm-usage", "--use-angle=swiftshader"],
    });
    page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
    page.on("console", (message) => {
      if (message.type() === "error") log("poster.browser_error", { message: message.text().slice(0, 1000) });
    });
    page.on("pageerror", (error) => log("poster.page_error", { message: error.message.slice(0, 1000) }));
    page.on("requestfailed", (request) => log("poster.request_failed", {
      url: request.url(),
      error: request.failure()?.errorText,
    }));
    // The poster module uses top-level await while Spark opens the scene, so
    // DOMContentLoaded is not a valid navigation readiness signal.
    await page.goto(server.url, { waitUntil: "commit", timeout: 30_000 });
    try {
      await page.waitForFunction(
        () => document.body.dataset.ready === "true",
        null,
        { timeout: 90_000, polling: 500 },
      );
    } catch (readinessError) {
      // Loading a large Spark RAD scene can occupy the browser main thread
      // beyond the Playwright clock. Accept the first completed frame only when
      // its measured signal, luminance, and colour diversity pass the same gate.
      const readinessAtTimeout = await page.evaluate(() => ({
        ready: document.body.dataset.ready === "true",
        stats: window.posterStats ?? null,
      }));
      if (
        !readinessAtTimeout.ready &&
        (!readinessAtTimeout.stats || !posterSampleIsReady(readinessAtTimeout.stats))
      ) {
        throw readinessError;
      }
    }
    const pngDataUrl = await page.evaluate(() => {
      window.stopPosterRender?.();
      const canvas = document.querySelector("#scene");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Poster canvas is unavailable");
      return canvas.toDataURL("image/png");
    });
    const encoded = pngDataUrl.match(/^data:image\/png;base64,(.+)$/)?.[1];
    if (!encoded) throw new Error("Spark poster did not produce a PNG data URL");
    const pngBytes = Buffer.from(encoded, "base64");
    if (
      pngBytes.byteLength < 1024 ||
      !pngBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      throw new Error("Spark poster PNG is empty or has an invalid signature");
    }
    await writeFile(outputPath, pngBytes, { mode: 0o600 });
  } catch (error) {
    const renderState = await page?.evaluate(() => ({
      ready: document.body.dataset.ready ?? null,
      stats: window.posterStats ?? null,
      detail: window.posterDetail ?? null,
    })).catch(() => null);
    throw new ProcessingAgentError(
      "SPARK_POSTER_FAILED",
      `Spark poster rendering failed: ${safeMessage(error)}${
        renderState ? `; render state ${JSON.stringify(renderState)}` : ""
      }`,
      { failureClass: "conversion", retryable: true, cause: error, details: renderState },
    );
  } finally {
    await browser?.close();
    await server.close();
  }
}

async function startPosterServer(scenePath, posterCamera, sceneDescriptor) {
  const sparkModule = join(repositoryRoot, "node_modules", "@sparkjsdev", "spark", "dist", "spark.module.js");
  const sparkAssets = join(repositoryRoot, "node_modules", "@sparkjsdev", "spark", "dist", "assets");
  const threeBuild = join(repositoryRoot, "node_modules", "three", "build");
  const threeAddons = join(repositoryRoot, "node_modules", "three", "examples", "jsm");
  const sceneStats = await stat(scenePath);
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(posterHtml(posterCamera, sceneDescriptor));
      return;
    }
    if (pathname === "/spark.module.js") return streamFile(response, sparkModule, "text/javascript");
    if (pathname === "/poster-quality.mjs") {
      return streamFile(response, join(repositoryRoot, "scripts", "poster-quality.mjs"), "text/javascript");
    }
    if (pathname === "/three.module.js" || pathname === "/three.core.js") {
      return streamFile(response, join(threeBuild, basename(pathname)), "text/javascript");
    }
    if (pathname.startsWith("/three-addons/")) {
      const relativePath = pathname.slice("/three-addons/".length);
      if (!relativePath || relativePath.split("/").includes("..")) {
        response.writeHead(400);
        response.end();
        return;
      }
      return streamFile(response, join(threeAddons, relativePath), "text/javascript");
    }
    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (pathname.startsWith("/assets/")) {
      const fileName = basename(pathname);
      const contentType = fileName.endsWith(".map")
        ? "application/json"
        : "text/javascript";
      return streamFile(response, join(sparkAssets, fileName), contentType);
    }
    if (pathname === sceneDescriptor.path) {
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : sceneStats.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= sceneStats.size) {
          response.writeHead(416, { "Content-Range": `bytes */${sceneStats.size}` });
          response.end();
          return;
        }
        response.writeHead(206, {
          "Content-Type": "application/octet-stream",
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${sceneStats.size}`,
          "Content-Length": String(end - start + 1),
        });
        createReadStream(scenePath, { start, end }).pipe(response);
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Length": String(sceneStats.size),
      });
      createReadStream(scenePath).pipe(response);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Poster server did not bind to a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolvePromise, reject) => {
      server.close((error) => error ? reject(error) : resolvePromise());
    }),
  };
}

function posterHtml(posterCamera, sceneDescriptor) {
  const cameraJson = JSON.stringify(posterCamera);
  const sceneJson = JSON.stringify(sceneDescriptor);
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,canvas{width:100%;height:100%;margin:0;display:block;background:#0b110e;overflow:hidden}</style>
<script type="importmap">{"imports":{"three":"/three.module.js","three/addons/":"/three-addons/","@sparkjsdev/spark":"/spark.module.js"}}</script>
</head><body><canvas id="scene"></canvas><script type="module">
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { analysePosterSample, posterSampleIsReady } from "/poster-quality.mjs";
const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:"high-performance",preserveDrawingBuffer:true});
renderer.setSize(640,360,false);
renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x0b110e);
const camera=new THREE.PerspectiveCamera(50,640/360,0.01,10000);
const spark=new SparkRenderer({renderer,lodSplatCount:2000000,lodRenderScale:1,minPixelRadius:.2,maxPixelRadius:256,sortRadial:true,numLodFetchers:2});
scene.add(spark);
const sceneDescriptor=${sceneJson};
const mesh=new SplatMesh({url:sceneDescriptor.path,fileName:sceneDescriptor.fileName,paged:sceneDescriptor.paged,raycastable:false});
scene.add(mesh);
await mesh.initialized;
const sphere=mesh.getBoundingBox().getBoundingSphere(new THREE.Sphere());
const radius=Number.isFinite(sphere.radius)&&sphere.radius>0?sphere.radius:1;
camera.near=Math.max(.005,radius/2000);
camera.far=Math.max(1000,radius*50);
const authoredCamera=${cameraJson};
if(authoredCamera){
  camera.position.fromArray(authoredCamera.position);
  camera.up.fromArray(authoredCamera.up).normalize();
  camera.fov=authoredCamera.fovDegrees;
  camera.lookAt(new THREE.Vector3().fromArray(authoredCamera.target));
}else{
  camera.position.copy(sphere.center).add(new THREE.Vector3(radius*.65,radius*.28,radius*1.85));
  camera.lookAt(sphere.center);
}
camera.updateProjectionMatrix();
const sampleCanvas=document.createElement("canvas");
sampleCanvas.width=96;
sampleCanvas.height=54;
const sampleContext=sampleCanvas.getContext("2d",{willReadFrequently:true});
let lastSampleAt=0;
let readyStreak=0;
let stopped=false;
window.posterStats=null;
window.posterDetail={center:sphere.center.toArray(),radius,camera:authoredCamera};
const renderPosterFrame=()=>{
  if(stopped)return;
  renderer.render(scene,camera);
  const now=performance.now();
  if(sampleContext&&now-lastSampleAt>=250){
    lastSampleAt=now;
    sampleContext.drawImage(canvas,0,0,sampleCanvas.width,sampleCanvas.height);
    const stats=analysePosterSample(
      sampleContext.getImageData(0,0,sampleCanvas.width,sampleCanvas.height).data
    );
    window.posterStats=stats;
    readyStreak=posterSampleIsReady(stats)?readyStreak+1:0;
    if(readyStreak>=2)document.body.dataset.ready="true";
  }
  if(document.body.dataset.ready!=="true")setTimeout(renderPosterFrame,100);
};
setTimeout(renderPosterFrame,0);
window.stopPosterRender=()=>{stopped=true;};
</script></body></html>`;
}

function streamFile(response, path, contentType) {
  response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
  createReadStream(path).pipe(response);
}

async function detectedChromePath() {
  const candidates = process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : process.platform === "win32"
      ? [
          join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
          join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
        ]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through known platform locations.
    }
  }
  return undefined;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonnegativeInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function log(event, properties = {}) {
  console.log(JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    workerId: configuration?.workerId ?? "poster-smoke",
    ...properties,
  }));
}
