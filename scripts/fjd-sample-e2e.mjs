import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ts from "typescript";
import {
  isLoopbackHttpUrl,
  selectFixtureForQualificationCase,
  selectQualificationCase,
  streamFileMetadata,
  validateFjdSampleManifest,
  validateLocalStorageBindings,
  validateLocalWranglerInvocation,
  validateRadRangeResponses,
} from "./fjd-sample-corpus-core.mjs";
import {
  analysePosterSample,
  posterSampleIsReady,
} from "./poster-quality.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repositoryRoot, "test", "vendor-corpus", "fjd-manifest.json");
const wranglerConfigPath = join(repositoryRoot, "wrangler.jsonc");
const cacheRoot = join(repositoryRoot, ".cache", "fjd-sample-corpus");
const upstreamRoot = join(cacheRoot, "upstream");
const reportsRoot = join(cacheRoot, "reports");
const screenshotsRoot = join(cacheRoot, "screenshots");
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
const reportPath = join(reportsRoot, `local-platform-e2e-${runId}.json`);
const screenshotPath = join(screenshotsRoot, `local-platform-e2e-${runId}.png`);
const workerLogPath = join(reportsRoot, `local-platform-e2e-worker-${runId}.log`);
const processorLogPath = join(reportsRoot, `local-platform-e2e-processor-${runId}.jsonl`);
const temporaryRoot = await mkdtemp(join(tmpdir(), "spatial-fjd-e2e-"));
const persistenceRoot = join(temporaryRoot, "wrangler-state");
const localApiTripwireMilliseconds = 120_000;
const localWorkerStartupTripwireMilliseconds = 120_000;
const localVisualTripwireMilliseconds = 180_000;
const localWorkerTerminationTripwireMilliseconds = 30_000;

const report = {
  schemaVersion: "whymelabs.fjd-local-platform-e2e.v1",
  runId,
  startedAt: new Date().toISOString(),
  sourceManifest: "test/vendor-corpus/fjd-manifest.json",
  executionBoundary: {
    localWorkerOnly: null,
    cloudStorageUsed: null,
    releaseCreated: null,
    temporaryStateRemoved: false,
    wranglerLaunch: null,
  },
  assertions: [],
  api: {
    requestCount: 0,
    maximumElapsedMilliseconds: 0,
    slowestRequest: null,
  },
  input: null,
  processing: null,
  privatePreview: null,
};

await Promise.all([
  mkdirSecure(reportsRoot),
  mkdirSecure(screenshotsRoot),
]);

let workerProcess = null;
let workerLogs = "";
let origin = null;
let observedReleaseCount = null;
const observedFetchOrigins = new Set();

try {
  const manifest = validateFjdSampleManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  const wranglerConfigSource = await readFile(wranglerConfigPath, "utf8");
  const parsedWranglerConfig = ts.parseConfigFileTextToJson(
    wranglerConfigPath,
    wranglerConfigSource,
  );
  if (parsedWranglerConfig.error) {
    throw new Error(`Could not parse ${wranglerConfigPath} as JSONC`);
  }
  report.executionBoundary.wranglerConfig = {
    path: "wrangler.jsonc",
    sha256: createHash("sha256").update(wranglerConfigSource).digest("hex"),
    storageBindings: validateLocalStorageBindings(parsedWranglerConfig.config),
  };
  const qualificationCase = selectQualificationCase(manifest, null);
  const fixture = selectFixtureForQualificationCase(
    manifest,
    qualificationCase,
    "gaussian_splat",
  );
  const sourcePath = join(upstreamRoot, fixture.fileName);
  await access(sourcePath).catch(() => {
    throw new Error(
      `Pinned FJD Gaussian is missing at ${sourcePath}; run npm run corpus:fjd:fetch first`,
    );
  });
  const sourceMetadata = await streamFileMetadata(sourcePath);
  assertReceipt("FJD Gaussian byte count matches its manifest", {
    expected: fixture.sizeBytes,
    actual: sourceMetadata.sizeBytes,
  });
  assertReceipt("FJD Gaussian SHA-256 matches its manifest", {
    expected: fixture.sha256,
    actual: sourceMetadata.sha256,
  });
  const qualificationView = fixture.qualificationView;
  if (!qualificationView) {
    throw new Error(`${fixture.id} is missing its pinned private qualification view`);
  }
  const metadataPath = join(upstreamRoot, qualificationView.metadata.fileName);
  await access(metadataPath).catch(() => {
    throw new Error(
      `Pinned FJD metadata is missing at ${metadataPath}; run npm run corpus:fjd:fetch first`,
    );
  });
  const metadataReceipt = await streamFileMetadata(metadataPath);
  assertReceipt("FJD metadata byte count matches its manifest", {
    expected: qualificationView.metadata.sizeBytes,
    actual: metadataReceipt.sizeBytes,
  });
  assertReceipt("FJD metadata SHA-256 matches its manifest", {
    expected: qualificationView.metadata.sha256,
    actual: metadataReceipt.sha256,
  });
  const metadataBytes = await readFile(metadataPath);
  recordAssertion(
    "FJD metadata contains the pinned camera-pose record",
    metadataBytes.includes(Buffer.from(qualificationView.poseRecordNeedle, "utf8")),
  );
  report.input = {
    qualificationCaseId: qualificationCase.id,
    fixtureId: fixture.id,
    fileName: fixture.fileName,
    sizeBytes: sourceMetadata.sizeBytes,
    sha256: sourceMetadata.sha256,
    metadata: {
      fileName: qualificationView.metadata.fileName,
      sizeBytes: metadataReceipt.sizeBytes,
      sha256: metadataReceipt.sha256,
    },
    qualificationView: {
      sourceUpAxis: qualificationView.sourceUpAxis,
      cameraPosition: qualificationView.cameraPosition,
      cameraTarget: qualificationView.cameraTarget,
      cameraUp: qualificationView.cameraUp,
      fovDegrees: qualificationView.fovDegrees,
      rendererProfile: qualificationView.rendererProfile,
      rendererBudgetMillions: qualificationView.rendererBudgetMillions,
      poseReceipt: qualificationView.poseReceipt,
    },
  };

  await runCommand(npmCommand(), ["run", "build"]);
  await runCommand(npxCommand(), [
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "spatial-studio-local",
    "--local",
    "--persist-to",
    persistenceRoot,
    "--config",
    wranglerConfigPath,
  ], { env: { ...process.env, CI: "true" } });

  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  workerProcess = startWorker({ port, persistenceRoot });
  const workerStartedAt = performance.now();
  await waitForWorker(workerProcess, origin);
  report.workerStartupMilliseconds = Math.round(performance.now() - workerStartedAt);
  recordAssertion("the qualification Worker uses a loopback origin", new URL(origin).hostname === "127.0.0.1");

  const variables = await readDevVariables();
  const email = (variables.ADMIN_EMAIL || "swmengappdev@gmail.com").toLowerCase();
  const workerToken = requiredValue(variables.WORKER_API_TOKEN, "WORKER_API_TOKEN");
  const otpPepper = requiredValue(variables.OTP_PEPPER, "OTP_PEPPER");
  const session = await seedAndVerifyOtp({ email, otpPepper });
  recordAssertion("the isolated Worker issues a local authenticated session", Boolean(session.accessCookie));

  const created = await api("/api/projects", {
    method: "POST",
    session,
    body: {
      clientOperationId: crypto.randomUUID(),
      name: `FJD local qualification ${runId.slice(-8)}`,
      captureAdapter: "fjd-trion",
      deliveryTemplate: "property-showcase",
      notes: "Disposable local-only FJD sample qualification. Never publish this project.",
      customFields: {},
    },
  });
  recordAssertion("the project uses the production FJD adapter", created.project.captureAdapter === "fjd-trion");

  const uploaded = await uploadFile({
    projectId: created.project.id,
    sourcePath,
    fileName: fixture.fileName,
    sizeBytes: sourceMetadata.sizeBytes,
    sha256: sourceMetadata.sha256,
    session,
  });
  recordAssertion("the FJD Gaussian upload creates an immutable processing job", Boolean(uploaded.job.id));

  const processorStartedAt = performance.now();
  const processor = await runCommand(
    process.execPath,
    [join(repositoryRoot, "scripts", "processing-agent.mjs"), "--once"],
    {
      env: {
        ...process.env,
        SPATIAL_API_ORIGIN: origin,
        WORKER_API_TOKEN: workerToken,
        PROCESSOR_JOB_ID: uploaded.job.id,
        PROCESSOR_WORKER_ID: `fjd-local-e2e-${runId}`,
        PROCESSOR_POSTER_CAMERA_JSON: JSON.stringify({
          position: qualificationView.cameraPosition,
          target: qualificationView.cameraTarget,
          up: qualificationView.cameraUp,
          fovDegrees: qualificationView.fovDegrees,
        }),
      },
    },
  );
  const processorMilliseconds = Math.round(performance.now() - processorStartedAt);
  const processorEvents = parseJsonLines(processor.stdout);
  const processorStartedEvent = processorEvents.find((event) => event.event === "processor.started");
  recordAssertion("the processor connects only to the loopback Worker", processorStartedEvent?.origin === origin);
  await writeFile(
    processorLogPath,
    `${processorEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    { mode: 0o600 },
  );

  const detail = await api(`/api/projects/${created.project.id}`, { session });
  const job = detail.jobs.find((candidate) => candidate.id === uploaded.job.id);
  recordAssertion("the genuine FJD Gaussian processing job succeeds", job?.state === "SUCCEEDED");
  const webAsset = detail.assets.find((candidate) =>
    candidate.version_id === uploaded.upload.versionId &&
    candidate.kind === "web" &&
    candidate.format === "rad" &&
    candidate.integrity_status === "verified"
  );
  const posterAsset = detail.assets.find((candidate) =>
    candidate.version_id === uploaded.upload.versionId &&
    candidate.kind === "poster" &&
    candidate.integrity_status === "verified"
  );
  recordAssertion("processing creates a verified Spark RAD derivative", Boolean(webAsset));
  recordAssertion("processing creates a verified Spark poster", Boolean(posterAsset));
  observedReleaseCount = detail.releases.length;
  recordAssertion("the local qualification creates no release", observedReleaseCount === 0);
  report.processing = {
    jobId: uploaded.job.id,
    state: job?.state ?? null,
    elapsedMilliseconds: processorMilliseconds,
    inputBytes: job?.input_bytes ?? sourceMetadata.sizeBytes,
    outputBytes: job?.output_bytes ?? null,
    webAsset: webAsset
      ? {
          id: webAsset.id,
          format: webAsset.format,
          sizeBytes: webAsset.size_bytes,
          sha256: webAsset.sha256,
        }
      : null,
    posterAsset: posterAsset
      ? {
          id: posterAsset.id,
          sizeBytes: posterAsset.size_bytes,
          sha256: posterAsset.sha256,
        }
      : null,
    processorEvents,
  };

  const preview = await api(
    `/api/projects/${created.project.id}/versions/${uploaded.upload.versionId}/preview`,
    { session },
  );
  recordAssertion("the private preview resolves the verified RAD", preview.renderable.assetId === webAsset?.id);
  const browserEvidence = await verifyPrivatePreview(preview.renderable, qualificationView);
  report.privatePreview = browserEvidence;
  const radRangeReceipt = validateRadRangeResponses(
    browserEvidence.sceneResponses,
    webAsset.size_bytes,
  );
  report.privatePreview.radRangeReceipt = radRangeReceipt;
  recordAssertion(
    "every signed RAD response is a valid byte range for the verified asset",
    radRangeReceipt.responseCount === browserEvidence.sceneResponses.length,
  );
  recordAssertion(
    "Spark reports the exact pinned renderer budget",
    browserEvidence.quality === `${qualificationView.rendererBudgetMillions}M splat budget`,
  );
  const browserStayedOnLoopback = browserEvidence.nonLoopbackRequests.length === 0;
  recordAssertion("every browser HTTP request stays on loopback", browserStayedOnLoopback);
  report.executionBoundary.observedHttpOrigins = [
    ...new Set([...observedFetchOrigins, ...browserEvidence.requestOrigins]),
  ].sort();
  const allObservedOriginsAreLoopback = report.executionBoundary.observedHttpOrigins.every(
    (candidate) => new URL(candidate).hostname === "127.0.0.1",
  );
  report.executionBoundary.localWorkerOnly = Boolean(
    report.executionBoundary.wranglerLaunch?.localFlag &&
    !report.executionBoundary.wranglerLaunch?.remoteFlag &&
    report.executionBoundary.wranglerConfig?.storageBindings.every(
      (binding) => !binding.remote,
    ) &&
    new URL(origin).hostname === "127.0.0.1" &&
    processorStartedEvent?.origin === origin &&
    browserStayedOnLoopback &&
    allObservedOriginsAreLoopback,
  );
  report.executionBoundary.cloudStorageUsed = !report.executionBoundary.localWorkerOnly;
  recordAssertion(
    "the qualification uses only isolated local Worker storage",
    report.executionBoundary.localWorkerOnly && !report.executionBoundary.cloudStorageUsed,
  );
  recordAssertion("Spark hides its loading indicator after rendering", browserEvidence.loadingHidden);
  recordAssertion("Spark reports no renderer error", browserEvidence.errorHidden);
  recordAssertion("Spark creates a visible WebGL canvas", browserEvidence.canvas.width > 0 && browserEvidence.canvas.height > 0);
  recordAssertion("the rendered FJD frame contains measured visual signal", browserEvidence.visualSampleReady);
  assertMinimumReceipt("the FJD frame clears its luminance-range tripwire", {
    minimum: qualificationView.visualTripwires.minimumLuminanceRange,
    actual: browserEvidence.visualSample.luminanceRange,
  });
  assertMinimumReceipt("the FJD frame clears its colour-bucket tripwire", {
    minimum: qualificationView.visualTripwires.minimumColourBucketCount,
    actual: browserEvidence.visualSample.colourBucketCount,
  });
  recordAssertion("the private preview retrieves the signed RAD", browserEvidence.sceneResponses.length > 0);
  recordAssertion("the private preview has no page errors", browserEvidence.pageErrors.length === 0);
  recordAssertion("the private preview has no console errors", browserEvidence.consoleErrors.length === 0);
  recordAssertion("the private preview has no failed HTTP responses", browserEvidence.failedResponses.length === 0);
} catch (error) {
  report.failure = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  process.exitCode = 1;
} finally {
  try {
    if (workerProcess) {
      report.workerTermination = await terminateWorker(workerProcess);
    }
  } catch (error) {
    registerTeardownFailure(error);
  } finally {
    try {
      if (workerLogs) await writeFile(workerLogPath, workerLogs, { mode: 0o600 });
    } catch (error) {
      registerTeardownFailure(error);
    } finally {
      try {
        await rm(temporaryRoot, { recursive: true, force: true });
        report.executionBoundary.temporaryStateRemoved = await pathIsMissing(temporaryRoot);
      } catch (error) {
        registerTeardownFailure(error);
      } finally {
        if (!report.executionBoundary.temporaryStateRemoved) process.exitCode = 1;
      }
    }
  }
  report.executionBoundary.releaseCreated = observedReleaseCount === null
    ? null
    : observedReleaseCount > 0;
  report.completedAt = new Date().toISOString();
  report.passed = !report.failure &&
    report.executionBoundary.localWorkerOnly === true &&
    report.executionBoundary.cloudStorageUsed === false &&
    report.executionBoundary.releaseCreated === false &&
    report.assertions.every((assertion) => assertion.passed) &&
    report.executionBoundary.temporaryStateRemoved;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    event: "fjd.local_platform_e2e.completed",
    passed: report.passed,
    assertionCount: report.assertions.length,
    reportPath,
    screenshotPath: report.privatePreview ? screenshotPath : null,
    failure: report.failure?.message ?? null,
  })}\n`);
  if (!report.passed) process.exitCode = 1;
}

async function uploadFile({ projectId, sourcePath, fileName, sizeBytes, sha256, session }) {
  const created = await api(`/api/projects/${projectId}/uploads`, {
    method: "POST",
    session,
    body: {
      clientOperationId: crypto.randomUUID(),
      fileName,
      sizeBytes,
      format: "ply",
      purpose: "gaussian_splat",
      mimeType: "application/octet-stream",
      sha256,
    },
  });
  const partSizeBytes = created.upload.partSizeBytes;
  const parts = [];
  const handle = await open(sourcePath, "r");
  try {
    for (let offset = 0, partNumber = 1; offset < sizeBytes; partNumber += 1) {
      const requestedBytes = Math.min(partSizeBytes, sizeBytes - offset);
      const partBytes = Buffer.allocUnsafe(requestedBytes);
      const read = await handle.read(partBytes, 0, requestedBytes, offset);
      if (read.bytesRead !== requestedBytes) {
        throw new Error(
          `FJD upload_part_bytes limit=${requestedBytes} ask=${read.bytesRead} part=${partNumber}`,
        );
      }
      const uploaded = await api(`/api/uploads/${created.upload.id}/parts/${partNumber}`, {
        method: "PUT",
        session,
        rawBody: partBytes,
        headers: {
          "content-length": String(partBytes.byteLength),
          "content-type": "application/octet-stream",
        },
      });
      parts.push({ partNumber, etag: uploaded.part.etag });
      offset += requestedBytes;
    }
  } finally {
    await handle.close();
  }
  return api(`/api/uploads/${created.upload.id}/complete`, {
    method: "POST",
    session,
    body: { parts },
  }).then((completion) => ({
    upload: created.upload,
    asset: completion.asset,
    job: completion.job,
  }));
}

async function verifyPrivatePreview(renderable, qualificationView) {
  const sourceToWorld = {
    sourceUpAxis: qualificationView.sourceUpAxis,
    worldUnit: "scene_units",
    metresPerSourceUnit: 1,
    yawDegrees: 0,
    translationMetres: [0, 0, 0],
  };
  const cameraPosition = sourcePointToWorld(
    qualificationView.cameraPosition,
    qualificationView.sourceUpAxis,
  );
  const cameraTarget = sourcePointToWorld(
    qualificationView.cameraTarget,
    qualificationView.sourceUpAxis,
  );
  const cameraUp = sourceDirectionToWorld(
    qualificationView.cameraUp,
    qualificationView.sourceUpAxis,
  );
  const rendererUrl = new URL("/renderer/index.html", origin);
  rendererUrl.searchParams.set("content", renderable.contentUrl);
  rendererUrl.searchParams.set("format", renderable.format);
  rendererUrl.searchParams.set("budget", String(qualificationView.rendererBudgetMillions));
  rendererUrl.searchParams.set("sourceToWorld", JSON.stringify(sourceToWorld));
  rendererUrl.searchParams.set("camera", cameraPosition.join(","));
  rendererUrl.searchParams.set("target", cameraTarget.join(","));
  rendererUrl.searchParams.set("up", cameraUp.join(","));
  rendererUrl.searchParams.set("fov", String(qualificationView.fovDegrees));
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  const sceneResponses = [];
  const requestOrigins = new Set();
  const nonLoopbackRequests = [];
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      ["http:", "https:"].includes(requestUrl.protocol) &&
      !isLoopbackHttpUrl(requestUrl.toString())
    ) {
      nonLoopbackRequests.push({ origin: requestUrl.origin, path: requestUrl.pathname });
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (!["http:", "https:"].includes(requestUrl.protocol)) return;
    requestOrigins.add(requestUrl.origin);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push({
        status: response.status(),
        path: new URL(response.url()).pathname,
      });
    }
    if (response.url().includes("/comparison-asset/")) {
      const headers = response.headers();
      sceneResponses.push({
        status: response.status(),
        contentLength: headers["content-length"] ?? null,
        contentRange: headers["content-range"] ?? null,
      });
    }
  });
  try {
    const startedAt = performance.now();
    await withPlaywrightTripwire(
      "fjd_renderer_navigation_ms",
      localWorkerStartupTripwireMilliseconds,
      () => page.goto(rendererUrl.toString(), {
        waitUntil: "domcontentloaded",
        timeout: localWorkerStartupTripwireMilliseconds,
      }),
    );
    await withPlaywrightTripwire(
      "fjd_spark_loading_ms",
      localVisualTripwireMilliseconds,
      () => page.locator("#sparkLoading").waitFor({
        state: "hidden",
        timeout: localVisualTripwireMilliseconds,
      }),
    );
    const visualSample = await waitForVisualSample(page);
    const loadingHidden = await page.locator("#sparkLoading").evaluate((element) => element.hidden);
    const errorHidden = await page.locator("#sparkError").evaluate((element) => element.hidden);
    const canvas = await page.locator("#sparkCanvas").evaluate((element) => ({
      width: element instanceof HTMLCanvasElement ? element.width : 0,
      height: element instanceof HTMLCanvasElement ? element.height : 0,
      clientWidth: element instanceof HTMLElement ? element.clientWidth : 0,
      clientHeight: element instanceof HTMLElement ? element.clientHeight : 0,
    }));
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return {
      rendererPath: rendererUrl.pathname,
      sourceToWorld,
      camera: {
        position: cameraPosition,
        target: cameraTarget,
        up: cameraUp,
        fovDegrees: qualificationView.fovDegrees,
      },
      elapsedMilliseconds: Math.round(performance.now() - startedAt),
      title: await page.title(),
      quality: await page.locator("#sparkQuality").innerText(),
      rendererProfile: qualificationView.rendererProfile,
      rendererBudgetMillions: qualificationView.rendererBudgetMillions,
      loadingHidden,
      errorHidden,
      canvas,
      visualSample,
      visualSampleReady: posterSampleIsReady(visualSample),
      pageErrors,
      consoleErrors,
      failedResponses,
      sceneResponses,
      requestOrigins: [...requestOrigins].sort(),
      nonLoopbackRequests,
      screenshotPath,
    };
  } finally {
    await browser.close();
  }
}

function sourcePointToWorld(point, sourceUpAxis) {
  if (sourceUpAxis === "Y") return [...point];
  return [point[0], point[2], -point[1]];
}

function sourceDirectionToWorld(direction, sourceUpAxis) {
  return sourcePointToWorld(direction, sourceUpAxis);
}

async function waitForVisualSample(page) {
  const startedAt = performance.now();
  let latest = null;
  while (performance.now() - startedAt <= localVisualTripwireMilliseconds) {
    const pixels = await page.locator("#sparkCanvas").evaluate(async (canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) return [];
      await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
      const sample = document.createElement("canvas");
      sample.width = 96;
      sample.height = 54;
      const context = sample.getContext("2d", { willReadFrequently: true });
      if (!context) return [];
      context.drawImage(canvas, 0, 0, sample.width, sample.height);
      return Array.from(context.getImageData(0, 0, sample.width, sample.height).data);
    });
    if (pixels.length > 0) {
      latest = analysePosterSample(Uint8ClampedArray.from(pixels));
      if (posterSampleIsReady(latest)) return latest;
    }
    await delay(250);
  }
  throw new Error(
    `fjd_visual_signal_ms limit=${localVisualTripwireMilliseconds} ask=${Math.round(performance.now() - startedAt)} latest=${JSON.stringify(latest)}`,
  );
}

function startWorker({ port, persistenceRoot: statePath }) {
  const args = [
    "wrangler",
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    statePath,
    "--config",
    wranglerConfigPath,
    "--var",
    `APP_ORIGIN:${origin}`,
    "--var",
    `JWT_ISSUER:${origin}`,
    "--log-level",
    "error",
    "--show-interactive-dev-session=false",
  ];
  report.executionBoundary.wranglerLaunch = validateLocalWranglerInvocation(args, {
    expectedPersistenceRoot: statePath,
    expectedConfigPath: wranglerConfigPath,
  });
  const child = spawn(npxCommand(), args, {
    cwd: repositoryRoot,
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = new Promise((resolveClosed) => child.once("close", resolveClosed));
  const capture = (chunk) => {
    workerLogs += chunk.toString();
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  return Object.assign(child, { closed });
}

async function terminateWorker(child) {
  const startedAt = performance.now();
  if (child.exitCode !== null) {
    return { elapsedMilliseconds: 0, escalatedToSigkill: false, exitCode: child.exitCode };
  }
  child.kill("SIGTERM");
  let result = await settleWithin(child.closed, localWorkerTerminationTripwireMilliseconds);
  let escalatedToSigkill = false;
  if (!result.settled) {
    escalatedToSigkill = true;
    child.kill("SIGKILL");
    result = await settleWithin(child.closed, localWorkerTerminationTripwireMilliseconds);
  }
  const elapsedMilliseconds = Math.round(performance.now() - startedAt);
  if (!result.settled) {
    throw new Error(
      `local_worker_termination_ms limit=${localWorkerTerminationTripwireMilliseconds * 2} ask=${elapsedMilliseconds} signal=SIGKILL`,
    );
  }
  return {
    elapsedMilliseconds,
    escalatedToSigkill,
    exitCode: child.exitCode,
    signalCode: child.signalCode,
  };
}

async function settleWithin(promise, limitMilliseconds) {
  return new Promise((resolveSettle) => {
    const timer = setTimeout(
      () => resolveSettle({ settled: false, value: null }),
      limitMilliseconds,
    );
    promise.then((value) => {
      clearTimeout(timer);
      resolveSettle({ settled: true, value });
    }, (error) => {
      clearTimeout(timer);
      resolveSettle({ settled: true, error });
    });
  });
}

async function waitForWorker(child, workerOrigin) {
  const startedAt = performance.now();
  while (performance.now() - startedAt <= localWorkerStartupTripwireMilliseconds) {
    if (child.exitCode !== null) {
      throw new Error(`Local FJD Worker exited ${child.exitCode}: ${workerLogs.slice(-4000)}`);
    }
    try {
      const elapsedMilliseconds = performance.now() - startedAt;
      const remainingMilliseconds = Math.max(
        1,
        Math.ceil(localWorkerStartupTripwireMilliseconds - elapsedMilliseconds),
      );
      const response = await fetchWithTripwire(
        `${workerOrigin}/api/health`,
        {},
        "local_worker_startup_ms",
        remainingMilliseconds,
      );
      if (response.ok) return;
    } catch {
      // The loopback socket is expected to refuse connections while Wrangler starts.
    }
    await delay(250);
  }
  throw new Error(
    `local_worker_startup_ms limit=${localWorkerStartupTripwireMilliseconds} ask=${Math.round(performance.now() - startedAt)}`,
  );
}

async function withPlaywrightTripwire(name, limitMilliseconds, operation) {
  const startedAt = performance.now();
  try {
    return await operation();
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
    const askMilliseconds = Math.max(
      limitMilliseconds,
      Math.round(performance.now() - startedAt),
    );
    throw new Error(`${name} limit=${limitMilliseconds} ask=${askMilliseconds}`, {
      cause: error,
    });
  }
}

async function fetchWithTripwire(url, options, name, limitMilliseconds) {
  const requestUrl = new URL(url);
  if (!isLoopbackHttpUrl(requestUrl.toString())) {
    throw new Error(
      `fjd_local_http_boundary expected=127.0.0.1 actual=${requestUrl.hostname} path=${requestUrl.pathname}`,
    );
  }
  observedFetchOrigins.add(requestUrl.origin);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(limitMilliseconds),
    });
    const body = await response.arrayBuffer();
    return new Response(
      response.status === 204 || response.status === 304 ? null : body,
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  } catch (error) {
    if (!["AbortError", "TimeoutError"].includes(error?.name)) throw error;
    const askMilliseconds = Math.max(
      limitMilliseconds,
      Math.round(performance.now() - startedAt),
    );
    throw new Error(
      `${name} limit=${limitMilliseconds} ask=${askMilliseconds} method=${options.method ?? "GET"} path=${requestUrl.pathname}`,
      { cause: error },
    );
  }
}

async function seedAndVerifyOtp({ email, otpPepper }) {
  const challengeId = crypto.randomUUID();
  const code = "424242";
  const codeHash = createHash("sha256")
    .update(`${challengeId}:${email}:${code}:${otpPepper}`)
    .digest("hex");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const sql = `
    INSERT INTO auth_otp_challenges (id, email, code_hash, expires_at)
    VALUES ('${sqlQuote(challengeId)}', '${sqlQuote(email)}', '${sqlQuote(codeHash)}', '${sqlQuote(expiresAt)}')
  `;
  await runCommand(npxCommand(), [
    "wrangler",
    "d1",
    "execute",
    "spatial-studio-local",
    "--local",
    "--persist-to",
    persistenceRoot,
    "--config",
    wranglerConfigPath,
    "--command",
    sql,
  ]);
  const response = await fetchWithTripwire(`${origin}/api/auth/otp/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": "127.0.0.42",
      "user-agent": "whymelabs-fjd-local-e2e/1.0",
    },
    body: JSON.stringify({ email, challengeId, code }),
  }, "fjd_local_api_ms", localApiTripwireMilliseconds);
  if (!response.ok) {
    throw new Error(`Local OTP verification failed with HTTP ${response.status}: ${await response.text()}`);
  }
  const setCookie = response.headers.get("set-cookie") ?? "";
  const accessCookie = setCookie.match(/spatial_access=([^;,]+)/)?.[1];
  const refreshCookie = setCookie.match(/spatial_refresh=([^;,]+)/)?.[1];
  if (!accessCookie || !refreshCookie) throw new Error("Local OTP verification did not return both session cookies");
  return {
    accessCookie: `spatial_access=${accessCookie}`,
    refreshCookie: `spatial_refresh=${refreshCookie}`,
  };
}

async function api(path, options = {}) {
  const startedAt = performance.now();
  const url = path.startsWith("http") ? path : `${origin}${path}`;
  const headers = new Headers(options.headers ?? {});
  headers.set("accept", "application/json");
  if (options.session) headers.set("cookie", cookieHeader(options.session));
  if (options.method && options.method !== "GET") headers.set("origin", origin);
  let body;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
  } else if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  let response = await fetchWithTripwire(url, {
    method: options.method ?? "GET",
    headers,
    body,
  }, "fjd_local_api_ms", localApiTripwireMilliseconds);
  if (response.status === 401 && options.session) {
    await refreshSession(options.session);
    headers.set("cookie", cookieHeader(options.session));
    response = await fetchWithTripwire(url, {
      method: options.method ?? "GET",
      headers,
      body,
    }, "fjd_local_api_ms", localApiTripwireMilliseconds);
  }
  if (!response.ok) {
    recordApiTiming(options.method ?? "GET", new URL(url).pathname, startedAt);
    throw new Error(
      `${options.method ?? "GET"} ${path} failed with HTTP ${response.status}: ${(await response.text()).slice(0, 2000)}`,
    );
  }
  recordApiTiming(options.method ?? "GET", new URL(url).pathname, startedAt);
  if (response.status === 204) return null;
  return response.json();
}

function recordApiTiming(method, path, startedAt) {
  const elapsedMilliseconds = Math.round(performance.now() - startedAt);
  report.api.requestCount += 1;
  if (elapsedMilliseconds > report.api.maximumElapsedMilliseconds) {
    report.api.maximumElapsedMilliseconds = elapsedMilliseconds;
    report.api.slowestRequest = { method, path, elapsedMilliseconds };
  }
}

async function refreshSession(session) {
  const response = await fetchWithTripwire(`${origin}/api/auth/refresh`, {
    method: "POST",
    headers: {
      accept: "application/json",
      origin,
      cookie: session.refreshCookie,
      "user-agent": "whymelabs-fjd-local-e2e/1.0",
    },
  }, "fjd_local_api_ms", localApiTripwireMilliseconds);
  if (!response.ok) throw new Error(`Local session refresh failed with HTTP ${response.status}`);
  const setCookie = response.headers.get("set-cookie") ?? "";
  const accessCookie = setCookie.match(/spatial_access=([^;,]+)/)?.[1];
  const refreshCookie = setCookie.match(/spatial_refresh=([^;,]+)/)?.[1];
  if (!accessCookie || !refreshCookie) throw new Error("Local session refresh did not rotate both cookies");
  session.accessCookie = `spatial_access=${accessCookie}`;
  session.refreshCookie = `spatial_refresh=${refreshCookie}`;
}

async function readDevVariables() {
  const source = await readFile(join(repositoryRoot, ".dev.vars"), "utf8");
  const parsed = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    parsed[key] = value;
  }
  return parsed;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a loopback port");
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  return address.port;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectCommand);
    child.once("close", (code, signal) => {
      if (code === 0) resolveCommand({ stdout, stderr });
      else rejectCommand(new Error(`${command} exited ${code ?? signal}: ${(stderr || stdout).slice(-5000)}`));
    });
  });
}

function parseJsonLines(source) {
  return source.split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { event: "processor.unstructured_output", line: line.slice(0, 500) };
    }
  });
}

function assertReceipt(name, { expected, actual }) {
  const passed = expected === actual;
  report.assertions.push({ name, passed, expected, actual });
  if (!passed) throw new Error(`${name}: expected=${expected} actual=${actual}`);
}

function assertMinimumReceipt(name, { minimum, actual }) {
  const passed = Number.isFinite(actual) && actual >= minimum;
  report.assertions.push({ name, passed, minimum, actual });
  if (!passed) throw new Error(`${name}: minimum=${minimum} actual=${actual}`);
}

function recordAssertion(name, passed) {
  report.assertions.push({ name, passed: Boolean(passed) });
  if (!passed) throw new Error(`Assertion failed: ${name}`);
}

function registerTeardownFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  report.teardownFailures ??= [];
  report.teardownFailures.push(message);
  if (!report.failure) report.failure = { message };
  process.exitCode = 1;
}

function cookieHeader(session) {
  return [session.accessCookie, session.refreshCookie].filter(Boolean).join("; ");
}

function requiredValue(value, name) {
  if (!value) throw new Error(`${name} is missing from .dev.vars`);
  return value;
}

function sqlQuote(value) {
  return String(value).replaceAll("'", "''");
}

async function mkdirSecure(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

async function pathIsMissing(path) {
  try {
    await stat(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
