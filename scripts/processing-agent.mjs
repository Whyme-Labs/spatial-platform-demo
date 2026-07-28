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
import {
  automaticallyRegisterSceneSignatures,
  assertRegisteredSceneChangeCapacity,
  ProcessingAgentError,
  compareRegisteredScenes,
  extractWalkableSemanticCandidates,
  inspectSpzContainer,
  parsePlySceneSignature,
  planMultipartParts,
  processOutputEvent,
  processorFailure,
  sparkMaximumSphericalHarmonicDegree,
  validateEvidenceAsset,
  validateGaussianPlyHeader,
} from "./processing-agent-core.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const processorVersion = "spatial-processor/0.6.2";
const sparkVersion = "2.1.0";
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
  activeHumanDurationMs: nonnegativeInteger(process.env.PROCESSOR_ACTIVE_HUMAN_MS, 0),
  chromePath: process.env.PROCESSOR_CHROME_PATH?.trim() || undefined,
};

if (posterOnly) {
  const source = process.argv[posterOnlyIndex + 1];
  const destination = process.argv[posterOnlyIndex + 2];
  if (!source || !destination) {
    throw new Error("Usage: node scripts/processing-agent.mjs --poster-only <scene.rad> <poster.png>");
  }
  await generateSparkPoster(resolve(source), resolve(destination), process.env.PROCESSOR_CHROME_PATH?.trim());
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
  const jobStartedAt = performance.now();
  const workDirectory = await mkdtemp(join(tmpdir(), `spatial-${job.id}-`));
  let heartbeatTimer;
  let heartbeatFailure = null;

  try {
    heartbeatTimer = setInterval(() => {
      void heartbeat(job.id, lease.leaseToken, 40, "Spatial processing is running")
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
      );
      return { claimed: true, jobId: job.id, state: "SUCCEEDED", ...result };
    }

    await heartbeat(job.id, lease.leaseToken, 3, "Downloading immutable source");
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

    if (job.jobType === "semantic.extract-v1") {
      if (!job.semanticExtractionId || !job.semanticConfig) {
        throw new ProcessingAgentError(
          "SEMANTIC_JOB_INCOMPLETE",
          "Semantic extraction lease is missing its extraction identity or bounded parameters",
          { failureClass: "configuration", retryable: false },
        );
      }
      await heartbeat(job.id, lease.leaseToken, 35, "Building bounded registered PLY occupancy");
      const sourceBytes = await readFile(sourcePath);
      const signature = parsePlySceneSignature(sourceBytes, {
        voxelSizeM: Math.max(0.05, Math.min(
          Number(job.semanticConfig.gridSizeM) / 2,
          Number(job.semanticConfig.floorBandM),
        )),
        maximumSamplePoints: Number(job.semanticConfig.maximumSamplePoints),
      });
      await heartbeat(job.id, lease.leaseToken, 68, "Extracting reviewable walkable polygons");
      const report = extractWalkableSemanticCandidates(signature, {
        gridSizeM: Number(job.semanticConfig.gridSizeM),
        floorBandM: Number(job.semanticConfig.floorBandM),
        minimumAreaM2: Number(job.semanticConfig.minimumAreaM2),
        maximumCandidates: Number(job.semanticConfig.maximumCandidates),
        elevationHintM: job.semanticConfig.elevationHintM === null
          ? null
          : Number(job.semanticConfig.elevationHintM),
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
      };
      const reportPath = join(workDirectory, `semantic-candidates-${job.semanticExtractionId}.json`);
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await heartbeat(job.id, lease.leaseToken, 86, "Uploading immutable semantic evidence");
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
              processor: "0.6.2",
              extractor: "registered-ply-walkable-candidates-v1",
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
      await heartbeat(job.id, lease.leaseToken, 45, "Validating immutable capture evidence");
      const validation = await validateEvidenceSource(
        sourcePath,
        job.input.format,
        job.input.purpose,
      );
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
        checks: {
          sourceBytesVerified: true,
          sourceHashVerified: job.input.sha256 ? true : "not_supplied",
          boundedSignatureChecked: true,
          semanticValidation: false,
          humanEvidenceReview: "required",
        },
        generatedAt: new Date().toISOString(),
      };
      await heartbeat(job.id, lease.leaseToken, 92, "Recording evidence integrity result");
      const computeDurationMs = Math.round(performance.now() - jobStartedAt);
      const completion = await fetchJson(`/api/worker/jobs/${job.id}/complete`, {
        method: "POST",
        body: JSON.stringify({
          leaseToken: lease.leaseToken,
          progressMessage: "Immutable capture evidence passed bounded integrity validation",
          outputs: [],
          report,
          evidence: {
            processorVersion,
            computeDurationMs,
            activeHumanDurationMs: configuration.activeHumanDurationMs,
            inputBytes: download.sizeBytes,
            outputBytes: 0,
            toolVersions: {
              node: process.version,
              processor: "0.6.2",
              validator: "bounded-file-signature-v1",
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

    await heartbeat(job.id, lease.leaseToken, 12, "Validating Gaussian source");
    const sourceValidation = await validateSource(sourcePath, job.input.format);
    const preparedSource = await prepareSparkSource(
      sourcePath,
      job.input.format,
      sourceValidation,
      workDirectory,
      configuration.splatTransformBinary,
      configuration.maxRuntimeMs,
    );
    await heartbeat(job.id, lease.leaseToken, 20, "Building Spark quality RAD LoD");
    const radPath = await buildSparkRad(
      preparedSource.path,
      job.input.format,
      preparedSource.maximumShDegree,
      configuration.sparkBinary,
      configuration.maxRuntimeMs,
    );
    if (heartbeatFailure) throw heartbeatFailure;
    const radMetadata = await fileMetadata(radPath);

    await heartbeat(job.id, lease.leaseToken, 72, "Rendering Spark scene poster");
    const posterPath = join(workDirectory, "poster.png");
    await generateSparkPoster(radPath, posterPath, configuration.chromePath);
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
        poster: { fileName: basename(posterPath), sizeBytes: posterMetadata.sizeBytes, sha256: posterMetadata.sha256 },
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

    await heartbeat(job.id, lease.leaseToken, 82, "Uploading immutable derivatives");
    const outputs = [];
    outputs.push(await uploadOutput(job, lease.leaseToken, "web", radPath, "application/octet-stream"));
    outputs.push(await uploadOutput(job, lease.leaseToken, "poster", posterPath, "image/png"));
    outputs.push(await uploadOutput(job, lease.leaseToken, "report", reportPath, "application/json"));
    const outputBytes = outputs.reduce((total, output) => total + output.sizeBytes, 0);

    await heartbeat(job.id, lease.leaseToken, 96, "Registering derivatives and QA report");
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
            processor: "0.6.2",
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

async function processRegisteredSceneChange(job, leaseToken, workDirectory, heartbeatFailure) {
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
  await heartbeat(job.id, leaseToken, 3, "Downloading registered baseline");
  const baselinePath = join(workDirectory, `baseline-${job.input.fileName}`);
  const baselineDownload = await downloadSource(job, leaseToken, baselinePath);
  verifyDownloadedInput(job.input, baselineDownload, "baseline");

  await heartbeat(job.id, leaseToken, 16, "Downloading registered candidate");
  const candidatePath = join(workDirectory, `candidate-${job.secondaryInput.fileName}`);
  const candidateDownload = await downloadSource(
    { ...job, input: job.secondaryInput },
    leaseToken,
    candidatePath,
  );
  verifyDownloadedInput(job.secondaryInput, candidateDownload, "candidate");

  await heartbeat(job.id, leaseToken, 34, "Building bounded registered-scene signatures");
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
    await heartbeat(job.id, leaseToken, 58, "Estimating bounded yaw and translation");
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
      await heartbeat(job.id, leaseToken, 70, "Comparing registered occupancy, centroids, and mean colour");
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
    await heartbeat(job.id, leaseToken, 66, "Comparing declared registered occupancy, centroids, and mean colour");
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
  await heartbeat(job.id, leaseToken, 82, "Uploading immutable change evidence");
  const output = await uploadOutput(job, leaseToken, "report", reportPath, "application/json");
  const computeDurationMs = Math.round(performance.now() - jobStartedAt);
  await heartbeat(job.id, leaseToken, 96, "Registering raw-scene evidence");
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
          processor: "0.6.2",
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
  const response = await fetchWithRetry(job.input.downloadUrl, {
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
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${configuration.workerToken}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, headers });
      if (response.ok || (allowNoContent && response.status === 204)) return response;
      const message = await response.text();
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

async function generateSparkPoster(radPath, outputPath, configuredChromePath) {
  const server = await startPosterServer(radPath);
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
    // The poster module uses top-level await while Spark opens the paged RAD
    // hierarchy, so DOMContentLoaded is not a valid navigation readiness signal.
    await page.goto(server.url, { waitUntil: "commit", timeout: 30_000 });
    try {
      await page.waitForFunction(
        () => document.body.dataset.ready === "true",
        null,
        { timeout: 90_000, polling: 500 },
      );
    } catch (readinessError) {
      // Avoid rejecting a real frame that crossed the threshold at the exact
      // Playwright timeout boundary.
      const readyAtTimeout = await page.evaluate(() => document.body.dataset.ready === "true");
      if (!readyAtTimeout) throw readinessError;
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

async function startPosterServer(radPath) {
  const sparkModule = join(repositoryRoot, "node_modules", "@sparkjsdev", "spark", "dist", "spark.module.js");
  const sparkAssets = join(repositoryRoot, "node_modules", "@sparkjsdev", "spark", "dist", "assets");
  const threeBuild = join(repositoryRoot, "node_modules", "three", "build");
  const threeAddons = join(repositoryRoot, "node_modules", "three", "examples", "jsm");
  const radStats = await stat(radPath);
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(posterHtml());
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
    if (pathname === "/scene.rad") {
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : radStats.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= radStats.size) {
          response.writeHead(416, { "Content-Range": `bytes */${radStats.size}` });
          response.end();
          return;
        }
        response.writeHead(206, {
          "Content-Type": "application/octet-stream",
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${radStats.size}`,
          "Content-Length": String(end - start + 1),
        });
        createReadStream(radPath, { start, end }).pipe(response);
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Length": String(radStats.size),
      });
      createReadStream(radPath).pipe(response);
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

function posterHtml() {
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
const spark=new SparkRenderer({renderer,lodSplatCount:500000,lodRenderScale:1,minPixelRadius:.2,maxPixelRadius:256,sortRadial:true,numLodFetchers:2});
scene.add(spark);
const mesh=new SplatMesh({url:"/scene.rad",fileName:"scene.rad",paged:true,raycastable:false});
scene.add(mesh);
await mesh.initialized;
const sphere=mesh.getBoundingBox().getBoundingSphere(new THREE.Sphere());
const radius=Number.isFinite(sphere.radius)&&sphere.radius>0?sphere.radius:1;
camera.near=Math.max(.005,radius/2000);
camera.far=Math.max(1000,radius*50);
camera.position.copy(sphere.center).add(new THREE.Vector3(radius*.65,radius*.28,radius*1.85));
camera.lookAt(sphere.center);
camera.updateProjectionMatrix();
const sampleCanvas=document.createElement("canvas");
sampleCanvas.width=96;
sampleCanvas.height=54;
const sampleContext=sampleCanvas.getContext("2d",{willReadFrequently:true});
let lastSampleAt=0;
let readyStreak=0;
let stopped=false;
window.posterStats=null;
window.posterDetail={center:sphere.center.toArray(),radius};
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
