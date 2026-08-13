import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = join(repositoryRoot, ".cache", "open-corpus");
const upstreamRoot = join(cacheRoot, "upstream");
const derivedRoot = join(cacheRoot, "derived");
const reportsRoot = join(cacheRoot, "reports");
const origin = (process.env.SPATIAL_E2E_ORIGIN || "http://localhost:8787").replace(/\/+$/, "");
const localMode = new URL(origin).hostname === "localhost" || new URL(origin).hostname === "127.0.0.1";
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
const reportPath = join(reportsRoot, `worker-e2e-${runId}.json`);
const screenshotPath = join(reportsRoot, `viewer-e2e-${runId}.png`);
const processorLogPath = join(reportsRoot, `processor-e2e-${runId}.jsonl`);
const report = {
  schemaVersion: "whymelabs.open-spatial-worker-e2e.v1",
  runId,
  origin,
  startedAt: new Date().toISOString(),
  fixtures: [],
  assertions: [],
  processorEvents: [],
  floorplan: null,
  browser: null,
};

await mkdir(reportsRoot, { recursive: true });

if (!localMode) {
  throw new Error(
    "The open-corpus E2E runner seeds a disposable OTP challenge and is restricted to a local Worker origin.",
  );
}

const variables = await readDevVariables();
const email = (variables.ADMIN_EMAIL || "swmengappdev@gmail.com").toLowerCase();
const workerToken = requiredValue(variables.WORKER_API_TOKEN, "WORKER_API_TOKEN");
const otpPepper = requiredValue(variables.OTP_PEPPER, "OTP_PEPPER");
const cookie = await seedAndVerifyOtp(email, otpPepper);
recordAssertion("email OTP produces an authenticated JWT cookie", Boolean(cookie.accessCookie));

const projects = new Map();
const fixtureRuns = [];
const fixtures = [
  {
    id: "gaussian-spz-v4",
    projectKey: "open",
    adapter: "open-import",
    file: join(derivedRoot, "aws-laundry-room-ngsp-v4.spz"),
    format: "spz",
    purpose: "gaussian_splat",
    mimeType: "application/octet-stream",
    expectedState: "SUCCEEDED",
    publish: true,
  },
  {
    id: "metric-laz",
    projectKey: "fjd",
    adapter: "fjd-trion",
    file: join(upstreamRoot, "pdal-simple.laz"),
    format: "laz",
    purpose: "metric_point_cloud",
    mimeType: "application/octet-stream",
    expectedState: "SUCCEEDED",
  },
  {
    id: "floorplan-metric-ply",
    projectKey: "floorplan",
    adapter: "open-import",
    file: join(derivedRoot, "vendor-neutral-two-room.ply"),
    format: "ply",
    purpose: "metric_point_cloud",
    mimeType: "application/octet-stream",
    expectedState: "SUCCEEDED",
    synthetic: true,
    floorplan: true,
  },
  {
    id: "source-image",
    projectKey: "fjd",
    adapter: "fjd-trion",
    file: join(upstreamRoot, "opensfm-berlin-01.jpg"),
    format: "jpg",
    purpose: "source_images",
    mimeType: "image/jpeg",
    expectedState: "SUCCEEDED",
  },
  {
    id: "source-video",
    projectKey: "phone",
    adapter: "phone-video",
    file: join(derivedRoot, "opensfm-berlin-01.mp4"),
    format: "mp4",
    purpose: "source_video",
    mimeType: "video/mp4",
    expectedState: "SUCCEEDED",
  },
  {
    id: "camera-poses",
    projectKey: "phone",
    adapter: "phone-video",
    file: join(upstreamRoot, "opensfm-berlin-reconstruction.json"),
    format: "json",
    purpose: "camera_poses",
    mimeType: "application/json",
    expectedState: "SUCCEEDED",
  },
  {
    id: "calibration",
    projectKey: "phone",
    adapter: "phone-video",
    file: join(derivedRoot, "opensfm-berlin-calibration.yaml"),
    format: "yaml",
    purpose: "calibration",
    mimeType: "application/yaml",
    expectedState: "SUCCEEDED",
  },
  {
    id: "imu-contract",
    projectKey: "phone",
    adapter: "phone-video",
    file: join(derivedRoot, "synthetic-imu-trajectory.csv"),
    format: "csv",
    purpose: "imu_trajectory",
    mimeType: "text/csv",
    expectedState: "SUCCEEDED",
    synthetic: true,
  },
  {
    id: "gnss-contract",
    projectKey: "phone",
    adapter: "phone-video",
    file: join(derivedRoot, "synthetic-gnss-trajectory.json"),
    format: "json",
    purpose: "gnss_trajectory",
    mimeType: "application/json",
    expectedState: "SUCCEEDED",
    synthetic: true,
  },
  {
    id: "collision-glb",
    projectKey: "open",
    adapter: "open-import",
    file: join(upstreamRoot, "khronos-box.glb"),
    format: "glb",
    purpose: "collision_mesh",
    mimeType: "model/gltf-binary",
    expectedState: "SUCCEEDED",
  },
  {
    id: "drone-image-bundle",
    projectKey: "drone",
    adapter: "drone-imagery",
    file: join(derivedRoot, "odm-aukerman-two-image.zip"),
    format: "zip",
    purpose: "source_images",
    mimeType: "application/zip",
    expectedState: "SUCCEEDED",
  },
  {
    id: "xgrids-opaque-transport",
    projectKey: "xgrids",
    adapter: "xgrids-lcc",
    file: join(derivedRoot, "synthetic-opaque.xbin"),
    format: "xbin",
    purpose: "raw_capture",
    mimeType: "application/octet-stream",
    expectedState: "SUCCEEDED",
    synthetic: true,
    opaque: true,
  },
  {
    id: "fjd-opaque-transport",
    projectKey: "fjd",
    adapter: "fjd-trion",
    file: join(derivedRoot, "synthetic-opaque.fjdslam"),
    format: "fjdslam",
    purpose: "vendor_project",
    mimeType: "application/octet-stream",
    expectedState: "SUCCEEDED",
    synthetic: true,
    opaque: true,
  },
  {
    id: "lcc2-opaque-transport",
    projectKey: "xgrids",
    adapter: "xgrids-lcc",
    file: join(derivedRoot, "synthetic-opaque.lcc2"),
    format: "lcc2",
    purpose: "vendor_project",
    mimeType: "application/octet-stream",
    expectedState: "SUCCEEDED",
    synthetic: true,
    opaque: true,
  },
  {
    id: "point-cloud-rejected-as-gaussian",
    projectKey: "negative",
    adapter: "open-import",
    file: join(upstreamRoot, "pdal-issue-2421.ply"),
    format: "ply",
    purpose: "gaussian_splat",
    mimeType: "application/octet-stream",
    expectedState: "FAILED",
    negative: true,
  },
];

try {
  for (const fixture of fixtures) {
    const project = await projectFor(fixture.projectKey, fixture.adapter);
    const uploaded = await uploadFixture(project.id, fixture, cookie);
    fixtureRuns.push({ fixture, project, ...uploaded });
  }

  for (const fixtureRun of fixtureRuns) {
    const output = await runProcessor(fixtureRun.job.id, workerToken);
    report.processorEvents.push(...output.events);
    const terminal = await waitForJob(fixtureRun.job.id, fixtureRun.fixture.expectedState, cookie);
    const fixtureReport = {
      id: fixtureRun.fixture.id,
      adapter: fixtureRun.fixture.adapter,
      purpose: fixtureRun.fixture.purpose,
      format: fixtureRun.fixture.format,
      projectId: fixtureRun.project.id,
      versionId: fixtureRun.upload.versionId,
      assetId: fixtureRun.upload.assetId,
      jobId: fixtureRun.job.id,
      expectedState: fixtureRun.fixture.expectedState,
      actualState: terminal.state,
      synthetic: Boolean(fixtureRun.fixture.synthetic),
      opaqueTransportOnly: Boolean(fixtureRun.fixture.opaque),
      negative: Boolean(fixtureRun.fixture.negative),
      evidence: parseStoredJson(terminal.evidence_json),
      error: parseStoredJson(terminal.error_json),
    };
    report.fixtures.push(fixtureReport);
    recordAssertion(
      `${fixtureRun.fixture.id} reaches ${fixtureRun.fixture.expectedState}`,
      terminal.state === fixtureRun.fixture.expectedState,
    );
    if (fixtureRun.fixture.opaque) {
      recordAssertion(
        `${fixtureRun.fixture.id} is labelled as opaque transport evidence`,
        fixtureReport.opaqueTransportOnly && fixtureReport.synthetic,
      );
    }
  }

  const floorplanRun = fixtureRuns.find((entry) => entry.fixture.floorplan);
  if (!floorplanRun) throw new Error("Missing deterministic floor-plan contract fixture");
  report.floorplan = await runFloorplanWorkflow(floorplanRun, cookie, workerToken);
  recordAssertion(
    "vendor-neutral floor-plan processor reaches operator review",
    report.floorplan.extractionStatus === "READY_FOR_REVIEW",
  );
  recordAssertion(
    "operator-approved floor plan emits SVG, PDF, and DXF",
    report.floorplan.exports.map((entry) => entry.format).sort().join(",") === "dxf,pdf,svg",
  );
  recordAssertion(
    "floor-plan exports remain indicative and are hash verified",
    report.floorplan.measurementClass === "indicative" &&
      report.floorplan.exports.every((entry) => entry.hashVerified),
  );

  const gaussianRun = fixtureRuns.find((entry) => entry.fixture.publish);
  if (!gaussianRun) throw new Error("Missing publishable Gaussian fixture");
  const release = await approveAndPublish(gaussianRun, cookie);
  const manifest = await api(`/api/releases/${release.slug}/manifest`);
  recordAssertion("published release uses Spark RAD", manifest.scene?.format === "rad");
  recordAssertion(
    "published release retains asset integrity evidence",
    /^[a-f0-9]{64}$/i.test(manifest.integrity?.assetSha256 ?? ""),
  );
  const sceneResponse = await fetch(new URL(manifest.scene.contentUrl, origin));
  assertResponse(sceneResponse, "download published scene");
  const sceneBytes = new Uint8Array(await sceneResponse.arrayBuffer());
  recordAssertion(
    "published scene is a non-empty RAD container",
    sceneBytes.byteLength > 16 && Buffer.from(sceneBytes.subarray(0, 4)).toString("ascii") === "RAD0",
  );
  const browserEvidence = await verifyBrowserRelease(release.url);
  report.browser = browserEvidence;
  recordAssertion("browser reports Spark ready", browserEvidence.rendererStatus.includes(" ready"));
  recordAssertion("browser has no page errors", browserEvidence.pageErrors.length === 0);
  recordAssertion("browser has no failed HTTP responses", browserEvidence.failedResponses.length === 0);
} catch (error) {
  report.failure = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  report.passed = !report.failure && report.assertions.every((assertion) => assertion.passed);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    event: "open_corpus.worker_e2e.completed",
    passed: report.passed,
    fixtureCount: report.fixtures.length,
    assertionCount: report.assertions.length,
    reportPath,
    screenshotPath: report.browser ? screenshotPath : null,
    failure: report.failure?.message ?? null,
  })}\n`);
  if (!report.passed) process.exitCode = 1;
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
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

async function seedAndVerifyOtp(email, pepper) {
  const challengeId = crypto.randomUUID();
  const code = "424242";
  const codeHash = createHash("sha256")
    .update(`${challengeId}:${email}:${code}:${pepper}`)
    .digest("hex");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const sql = `
    INSERT INTO auth_otp_challenges (id, email, code_hash, expires_at)
    VALUES ('${sqlQuote(challengeId)}', '${sqlQuote(email)}', '${sqlQuote(codeHash)}', '${sqlQuote(expiresAt)}')
  `;
  await runCommand(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["wrangler", "d1", "execute", "spatial-studio-local", "--local", "--command", sql],
    { timeoutMs: 60_000 },
  );
  const response = await fetch(`${origin}/api/auth/otp/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": `127.0.0.${Math.floor(Math.random() * 200) + 20}`,
      "user-agent": "whymelabs-open-corpus-e2e/1.0",
    },
    body: JSON.stringify({ email, challengeId, code }),
  });
  if (!response.ok) {
    throw new Error(
      `verify seeded OTP failed with HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`,
    );
  }
  const session = sessionCookies(response.headers.get("set-cookie") ?? "");
  if (!session.accessCookie || !session.refreshCookie) {
    throw new Error("OTP verification did not return access and refresh cookies");
  }
  return session;
}

async function projectFor(projectKey, adapter) {
  if (projects.has(projectKey)) return projects.get(projectKey);
  const result = await api("/api/projects", {
    method: "POST",
    cookie,
    body: {
      clientOperationId: crypto.randomUUID(),
      name: `Open corpus ${projectKey} ${runId.slice(-8)}`,
      captureAdapter: adapter,
      deliveryTemplate: projectKey === "open" ? "venue-navigator" : "operations-twin",
      notes: "Disposable local E2E project generated from the pinned open-data corpus.",
      customFields: {},
    },
  });
  projects.set(projectKey, result.project);
  return result.project;
}

async function uploadFixture(projectId, fixture, authCookie) {
  const bytes = await readFile(fixture.file);
  const metadata = await stat(fixture.file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const created = await api(`/api/projects/${projectId}/uploads`, {
    method: "POST",
    cookie: authCookie,
    body: {
      clientOperationId: crypto.randomUUID(),
      fileName: fixture.file.split("/").at(-1),
      sizeBytes: metadata.size,
      format: fixture.format,
      purpose: fixture.purpose,
      mimeType: fixture.mimeType,
      sha256,
    },
  });
  const partSize = created.upload.partSizeBytes;
  const parts = [];
  for (let offset = 0, partNumber = 1; offset < bytes.length; offset += partSize, partNumber += 1) {
    const partBytes = bytes.subarray(offset, Math.min(offset + partSize, bytes.length));
    const uploaded = await api(`/api/uploads/${created.upload.id}/parts/${partNumber}`, {
      method: "PUT",
      cookie: authCookie,
      rawBody: partBytes,
      headers: {
        "content-length": String(partBytes.byteLength),
        "content-type": "application/octet-stream",
      },
    });
    parts.push({ partNumber, etag: uploaded.part.etag });
  }
  const completed = await api(`/api/uploads/${created.upload.id}/complete`, {
    method: "POST",
    cookie: authCookie,
    body: { parts },
  });
  return { upload: created.upload, asset: completed.asset, job: completed.job };
}

async function runProcessor(jobId, token) {
  const result = await runCommand(
    process.execPath,
    [join(repositoryRoot, "scripts", "processing-agent.mjs"), "--once"],
    {
      timeoutMs: 15 * 60_000,
      env: {
        ...process.env,
        SPATIAL_API_ORIGIN: origin,
        WORKER_API_TOKEN: token,
        PROCESSOR_JOB_ID: jobId,
        PROCESSOR_WORKER_ID: `open-corpus-${runId}`,
        PROCESSOR_IDENTITY_JSON: localProcessorIdentityJson(),
      },
    },
  );
  const events = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { event: "processor.unstructured_output", line: line.slice(0, 500) };
      }
    });
  await writeFile(processorLogPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, {
    flag: "a",
    mode: 0o600,
  });
  return { events };
}

function localProcessorIdentityJson() {
  return process.env.PROCESSOR_IDENTITY_JSON ?? JSON.stringify({
    agentBuildSha: "0".repeat(40),
    imageDigest: `sha256:${"0".repeat(64)}`,
    protocolVersion: "spatial-processor-lease/1",
    capabilities: [
      { jobType: "asset.validate", contractVersion: "open-import-v1" },
      { jobType: "asset.evidence-validate", contractVersion: "spatial-evidence/1.0.0" },
      { jobType: "floorplan.extract-v1", contractVersion: "spatial-processor/0.11.0" },
      { jobType: "navigation.build-v1", contractVersion: "spatial-processor/0.11.0" },
    ],
  });
}

async function waitForJob(jobId, expectedState, authCookie) {
  const terminalStates = new Set(["SUCCEEDED", "FAILED", "DEAD_LETTER", "CANCELLED"]);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await api("/api/jobs", { cookie: authCookie });
    const job = result.jobs.find((candidate) => candidate.id === jobId);
    if (job && terminalStates.has(job.state)) {
      if (job.state !== expectedState) {
        throw new Error(
          `Job ${jobId} reached ${job.state}; expected ${expectedState}: ${job.error_json ?? "no error evidence"}`,
        );
      }
      return job;
    }
    await delay(Math.min(3000, 250 + attempt * 150));
  }
  throw new Error(`Job ${jobId} did not reach a terminal state`);
}

async function runFloorplanWorkflow(fixtureRun, authCookie, token) {
  const queued = await api(
    `/api/projects/${fixtureRun.project.id}/spatial/floorplan-extractions`,
    {
      method: "POST",
      cookie: authCookie,
      body: {
        clientOperationId: crypto.randomUUID(),
        versionId: fixtureRun.upload.versionId,
        inputAssetId: fixtureRun.upload.assetId,
        coordinateAssurance: "registered_y_up_metric_frame",
        sourceUpAxis: "y",
        registrationEvidence:
          "Deterministic metre-based Y-up contract fixture generated and hash-verified by the open-corpus runner.",
        gridSizeM: 0.25,
        floorBandM: 0.15,
        wallMinHeightM: 0.25,
        wallMaxHeightM: 2.5,
        minimumWallHeightCoverage: 0.6,
        minimumRoomAreaM2: 4,
        maximumOpeningWidthM: 1.25,
        maximumRooms: 20,
        maximumSamplePoints: 1_000_000,
      },
    },
  );
  const processor = await runProcessor(queued.extraction.jobId, token);
  report.processorEvents.push(...processor.events);
  await waitForJob(queued.extraction.jobId, "SUCCEEDED", authCookie);
  const workspace = await api(
    `/api/projects/${fixtureRun.project.id}/spatial?versionId=${fixtureRun.upload.versionId}`,
    { cookie: authCookie },
  );
  const extraction = workspace.floorplanExtractions.find(
    (candidate) => candidate.id === queued.extraction.id,
  );
  if (!extraction?.proposal_json || extraction.status !== "READY_FOR_REVIEW") {
    throw new Error("Floor-plan processor did not produce a reviewable immutable proposal");
  }
  const proposal = JSON.parse(extraction.proposal_json);
  const plan = {
    schemaVersion: "1.0.0",
    units: "metres",
    coordinateFrame: "registered_y_up_metric_frame",
    levels: [{
      id: "level-ground",
      label: "Ground floor",
      elevationM: proposal.summary.inferredFloorElevationM,
      rooms: proposal.rooms.map((room) => ({
        id: room.roomKey,
        label: room.label,
        points: room.geometry.points.map(([x, , z]) => [x, z]),
      })),
      walls: proposal.walls.map((wall) => ({
        id: wall.wallKey,
        label: wall.label,
        start: [wall.geometry.points[0][0], wall.geometry.points[0][2]],
        end: [wall.geometry.points[1][0], wall.geometry.points[1][2]],
        thicknessM: wall.thicknessM,
        heightM: wall.heightM,
      })),
      openings: proposal.openings.map((opening) => ({
        id: opening.openingKey,
        label: opening.label,
        type: "unknown",
        wallId: null,
        start: [opening.geometry.points[0][0], opening.geometry.points[0][2]],
        end: [opening.geometry.points[1][0], opening.geometry.points[1][2]],
        widthM: opening.widthM,
        heightM: opening.heightM,
      })),
    }],
  };
  const reviewed = await api(
    `/api/projects/${fixtureRun.project.id}/spatial/floorplan-extractions/${extraction.id}/review`,
    {
      method: "POST",
      cookie: authCookie,
      body: {
        clientOperationId: crypto.randomUUID(),
        decision: "approve",
        note:
          "Automated contract operator checked the deterministic source and preserved every proposal for export verification.",
        plan,
      },
    },
  );
  const generated = await api(
    `/api/projects/${fixtureRun.project.id}/spatial/floorplan-revisions/${reviewed.revision.id}/exports`,
    {
      method: "POST",
      cookie: authCookie,
      body: {
        clientOperationId: crypto.randomUUID(),
        formats: ["svg", "pdf", "dxf"],
      },
    },
  );
  const verifiedExports = [];
  for (const item of generated.exports) {
    const response = await fetch(`${origin}${item.downloadUrl}`, {
      headers: { cookie: cookieHeader(authCookie) },
      signal: AbortSignal.timeout(30_000),
    });
    assertResponse(response, `download ${item.format} floor-plan export`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    verifiedExports.push({
      id: item.id,
      format: item.format,
      sizeBytes: bytes.byteLength,
      sha256: item.sha256,
      hashVerified: digest === item.sha256,
    });
  }
  return {
    projectId: fixtureRun.project.id,
    versionId: fixtureRun.upload.versionId,
    extractionId: extraction.id,
    extractionStatus: extraction.status,
    roomCount: proposal.summary.roomCount,
    wallCount: proposal.summary.wallCount,
    openingCount: proposal.summary.openingCount,
    revisionId: reviewed.revision.id,
    measurementClass: reviewed.revision.measurementClass,
    exports: verifiedExports,
  };
}

async function approveAndPublish(gaussianRun, authCookie) {
  const projectId = gaussianRun.project.id;
  const versionId = gaussianRun.upload.versionId;
  const detail = await api(`/api/projects/${projectId}`, { cookie: authCookie });
  const webAsset = detail.assets.find(
    (asset) => asset.version_id === versionId && asset.kind === "web" && asset.integrity_status === "verified",
  );
  const posterAsset = detail.assets.find(
    (asset) => asset.version_id === versionId && asset.kind === "poster" && asset.integrity_status === "verified",
  );
  if (!webAsset || !posterAsset) {
    throw new Error("Gaussian processing did not create verified web and poster assets");
  }

  const scanResult = await api(`/api/projects/${projectId}/privacy-scans`, {
    method: "POST",
    cookie: authCookie,
    body: {
      clientOperationId: crypto.randomUUID(),
      versionId,
      assetIds: [posterAsset.id],
    },
  });
  let workspace;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    workspace = await api(`/api/projects/${projectId}/spatial?versionId=${versionId}`, {
      cookie: authCookie,
    });
    const scan = workspace.privacyScans.find((candidate) => candidate.id === scanResult.scan.id);
    if (scan && ["COMPLETED", "FAILED", "DEAD_LETTER"].includes(scan.status)) {
      if (scan.status !== "COMPLETED") {
        throw new Error(`Privacy scan ${scan.id} ended ${scan.status}: ${scan.error_json ?? "no error"}`);
      }
      break;
    }
    await delay(Math.min(3000, 500 + attempt * 100));
  }
  const scan = workspace?.privacyScans.find((candidate) => candidate.id === scanResult.scan.id);
  if (scan?.status !== "COMPLETED") throw new Error("Privacy scan did not complete");
  for (const candidate of workspace.privacyCandidates.filter((item) => item.scan_id === scan.id)) {
    await api(`/api/projects/${projectId}/privacy-candidates/${candidate.id}`, {
      method: "PATCH",
      cookie: authCookie,
      body: {
        status: "dismissed",
        note: "Open-corpus poster reviewed during automated local E2E; no publishable personal data is present.",
      },
    });
  }

  await api(`/api/versions/${versionId}/approve`, {
    method: "POST",
    cookie: authCookie,
    body: {
      webAssetId: webAsset.id,
      posterAssetId: posterAsset.id,
      visualGrade: "A",
      privacyStatus: "approved",
      measurementGrade: "visual-only",
      notes: "Pinned open-source indoor scene; visual demonstration only.",
    },
  });
  const slug = `open-corpus-${runId.slice(-8)}`;
  const published = await api(`/api/projects/${projectId}/releases`, {
    method: "POST",
    cookie: authCookie,
    body: {
      clientOperationId: crypto.randomUUID(),
      slug,
      accessPolicy: "public",
      viewerConfig: {
        title: "Open corpus laundry room",
        subtitle: "Pinned lawful fixture rendered by the production Spark pipeline",
        captureDate: "2026-07-28",
        measurementDisclaimer: "Visual demonstration only. Not a survey or certified measurement deliverable.",
        splatBudgetMillions: 2,
      },
    },
  });
  return published.release;
}

async function verifyBrowserRelease(url) {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push({ status: response.status(), url: response.url() });
    }
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#rendererStatus").filter({ hasText: " ready" }).waitFor({
      state: "visible",
      timeout: 90_000,
    });
    const errorHidden = await page.locator("#errorPanel").evaluate((element) => element.hidden);
    if (!errorHidden) {
      throw new Error(await page.locator("#errorPanel").innerText());
    }
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return {
      url: page.url(),
      title: await page.title(),
      rendererStatus: await page.locator("#rendererStatus").innerText(),
      releaseTitle: await page.locator("#releaseTitle").innerText(),
      iframeCanvasCount: await page.locator("#rendererFrame").contentFrame().locator("canvas").count(),
      pageErrors,
      consoleErrors,
      failedResponses,
      screenshotPath,
    };
  } finally {
    await browser.close();
  }
}

async function api(path, options = {}) {
  const url = path.startsWith("http") ? path : `${origin}${path}`;
  const headers = new Headers(options.headers ?? {});
  headers.set("accept", "application/json");
  if (options.cookie) headers.set("cookie", cookieHeader(options.cookie));
  if (options.method && options.method !== "GET") headers.set("origin", origin);
  let body;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
  } else if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  let response;
  let refreshed = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body,
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status === 401 && options.cookie && !refreshed) {
      await refreshSession(options.cookie);
      headers.set("cookie", cookieHeader(options.cookie));
      refreshed = true;
      continue;
    }
    if (![429, 502, 503, 504].includes(response.status) || attempt === 3) break;
    await delay(250 * 2 ** attempt);
  }
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed with HTTP ${response.status}: ${(await response.text()).slice(0, 2000)}`,
    );
  }
  if (response.status === 204) return null;
  return response.json();
}

async function refreshSession(session) {
  const response = await fetch(`${origin}/api/auth/refresh`, {
    method: "POST",
    headers: {
      accept: "application/json",
      origin,
      cookie: session.refreshCookie,
      "user-agent": "whymelabs-open-corpus-e2e/1.0",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`refresh E2E session failed with HTTP ${response.status}`);
  }
  const rotated = sessionCookies(response.headers.get("set-cookie") ?? "");
  if (!rotated.accessCookie || !rotated.refreshCookie) {
    throw new Error("Session refresh did not rotate both cookies");
  }
  session.accessCookie = rotated.accessCookie;
  session.refreshCookie = rotated.refreshCookie;
  report.assertions.push({ name: "expired JWT session rotates through refresh token", passed: true });
}

function sessionCookies(setCookie) {
  const access = setCookie.match(/spatial_access=([^;,]+)/)?.[1];
  const refresh = setCookie.match(/spatial_refresh=([^;,]+)/)?.[1];
  return {
    accessCookie: access ? `spatial_access=${access}` : "",
    refreshCookie: refresh ? `spatial_refresh=${refresh}` : "",
  };
}

function cookieHeader(session) {
  if (typeof session === "string") return session;
  return [session.accessCookie, session.refreshCookie].filter(Boolean).join("; ");
}

function assertResponse(response, action) {
  if (response?.ok) return;
  throw new Error(
    `${action} failed with HTTP ${response?.status ?? "unknown"} ${response?.statusText ?? ""}`,
  );
}

function recordAssertion(name, passed) {
  report.assertions.push({ name, passed: Boolean(passed) });
  if (!passed) throw new Error(`Assertion failed: ${name}`);
}

function parseStoredJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return { invalidJson: true };
  }
}

function requiredValue(value, name) {
  if (!value) throw new Error(`${name} is missing from .dev.vars`);
  return value;
}

function sqlQuote(value) {
  return String(value).replaceAll("'", "''");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
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
    const limit = 10 * 1024 * 1024;
    child.stdout.on("data", (chunk) => {
      if (stdout.length < limit) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < limit) stderr += chunk;
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectCommand(new Error(`${command} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs ?? 120_000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectCommand(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolveCommand({ stdout, stderr });
      } else {
        rejectCommand(
          new Error(
            `${command} exited ${code ?? signal}: ${(stderr || stdout).slice(-4000)}`,
          ),
        );
      }
    });
  });
}
