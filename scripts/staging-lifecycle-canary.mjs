#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import {
  metricPointCloudPly,
  metricRoomPoints,
} from "./staging-lifecycle-fixture.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const canonicalStagingOrigin = "https://spatial-studio-staging.swmengappdev.workers.dev";
const origin = (process.env.STAGING_APP_ORIGIN ?? canonicalStagingOrigin).replace(/\/+$/, "");
const canaryToken = requiredEnvironment("STAGING_LIFECYCLE_CANARY_TOKEN");
const reportPath = resolve(argumentValue("--report") ??
  ".cache/staging-acceptance/lifecycle-canary.json");
const screenshotPath = resolve(argumentValue("--screenshot") ??
  ".cache/staging-acceptance/lifecycle-canary.png");
const defaultLifecycleWindowSeconds = 1_800;
const apiRequestBudgetMilliseconds = 60_000;
const objectRequestBudgetMilliseconds = 30_000;
const chromeNavigationBudgetMilliseconds = 30_000;
const chromeReadyBudgetMilliseconds = 120_000;
const pollIntervalMilliseconds = 5_000;
const timeoutSeconds = Number(
  argumentValue("--timeout-seconds") ?? String(defaultLifecycleWindowSeconds),
);
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
  throw new Error("lifecycle_canary_window_seconds must be a finite positive number");
}
const deadline = Date.now() + timeoutSeconds * 1_000;
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`;
const fixtures = {
  userId: "cafe0000-0000-4000-8000-000000000001",
  organisationId: "cafe0000-0000-4000-8000-000000000002",
  email: "lifecycle-canary@synthetic.invalid",
};
const report = {
  schemaVersion: "staging-lifecycle-canary-v1",
  runId,
  gitSha: process.env.DEPLOY_SHA ?? process.env.GITHUB_SHA ?? null,
  origin,
  startedAt: new Date().toISOString(),
  status: "running",
  stages: [],
  cleanup: [],
  budgets: {
    lifecycleWindowSeconds: timeoutSeconds,
    apiRequestMilliseconds: apiRequestBudgetMilliseconds,
    objectRequestMilliseconds: objectRequestBudgetMilliseconds,
    chromeNavigationMilliseconds: chromeNavigationBudgetMilliseconds,
    chromeReadyMilliseconds: chromeReadyBudgetMilliseconds,
    pollIntervalMilliseconds,
  },
  measurements: {
    maximumApiRequestMilliseconds: 0,
    maximumObjectRequestMilliseconds: 0,
    maximumChromeNavigationMilliseconds: 0,
    maximumChromeReadyMilliseconds: 0,
    maximumSubprocessMilliseconds: 0,
    authenticatedStudioRenderMilliseconds: null,
    releaseRenderMilliseconds: null,
    visualInputBytes: null,
    visualSplats: null,
    metricInputBytes: null,
    metricPoints: null,
    candidateMetricInputBytes: null,
    candidateMetricPoints: null,
    sessionRefreshes: 0,
  },
};
let cookie = null;
let projectId = null;
let versionId = null;
let releaseSlug = null;
let releaseAccessToken = null;
let projectArchived = false;
let cleanupMode = false;
const openUploadIds = new Set();

try {
  requireStagingOrigin(origin);
  await provisionServiceOperator();
  cookie = await authenticateServiceOperator();
  stage("authenticated", { email: fixtures.email });

  const created = await api("/api/projects", {
    method: "POST",
    body: {
      clientOperationId: randomUUID(),
      name: `Lifecycle canary ${runId.slice(-8)}`,
      captureOrigin: "third-party",
      assetProducer: "open-import",
      capturePlan: [
        { purpose: "gaussian_splat", format: "ply" },
        { purpose: "metric_point_cloud", format: "ply" },
      ],
      deliveryTemplate: "Property showcase",
      notes: `Automated staging lifecycle receipt ${runId}. Synthetic data only.`,
    },
  });
  projectId = created.project.id;
  stage("project-created", { projectId });

  const captureJourney = { id: randomUUID(), sameFrameConfirmed: true };
  const visualPoints = visualRoomPoints();
  const visualBytes = gaussianPly(visualPoints);
  report.measurements.visualInputBytes = visualBytes.byteLength;
  report.measurements.visualSplats = visualPoints.length;
  const visual = await uploadBytes({
    projectId,
    bytes: visualBytes,
    fileName: "lifecycle-canary.gaussian.ply",
    format: "ply",
    purpose: "gaussian_splat",
    captureJourney,
  });
  versionId = visual.upload.versionId;
  const geometryPoints = metricRoomPoints();
  const geometryBytes = metricPointCloudPly(geometryPoints);
  report.measurements.metricInputBytes = geometryBytes.byteLength;
  report.measurements.metricPoints = geometryPoints.length;
  const geometry = await uploadBytes({
    projectId,
    bytes: geometryBytes,
    fileName: "lifecycle-canary-geometry.ply",
    format: "ply",
    purpose: "metric_point_cloud",
    targetVersionId: versionId,
    captureJourney,
  });
  stage("uploads-completed", {
    versionId,
    visualAssetId: visual.upload.assetId,
    geometryAssetId: geometry.upload.assetId,
  });

  const processedJobs = await Promise.all([
    waitForJob(visual.job.id),
    waitForJob(geometry.job.id),
  ]);
  stage("processing-completed", {
    jobs: processedJobs.map((job) => ({ id: job.id, type: job.job_type, state: job.state })),
  });

  let { workspace, build, extraction, review } = await qualifyCurrentVersionNavigation();
  stage("structure-reviewed", {
    extractionId: extraction.id,
    revisionId: review.revision.id,
    navigationBuildId: review.automaticNavigation.id,
  });
  stage("navigation-qualified", { buildId: build.id });

  const oneVersionDetail = await projectDetail();
  if (oneVersionDetail.comparisonReadiness?.available !== false) {
    throw new Error("Compare became available before a second eligible immutable version existed");
  }
  stage("comparison-unavailable-with-one-version", { versionId });

  const baselineVersionId = versionId;
  const baselineGeometryAssetId = geometry.upload.assetId;
  const candidateJourney = { id: randomUUID(), sameFrameConfirmed: true };
  const candidateVisual = await uploadBytes({
    projectId,
    bytes: gaussianPly(visualRoomPoints()),
    fileName: "lifecycle-canary-candidate.gaussian.ply",
    format: "ply",
    purpose: "gaussian_splat",
    captureJourney: candidateJourney,
  });
  versionId = candidateVisual.upload.versionId;
  const candidateGeometryPoints = metricRoomPoints({ candidateChange: true });
  const candidateGeometryBytes = metricPointCloudPly(candidateGeometryPoints);
  report.measurements.candidateMetricInputBytes = candidateGeometryBytes.byteLength;
  report.measurements.candidateMetricPoints = candidateGeometryPoints.length;
  const candidateGeometry = await uploadBytes({
    projectId,
    bytes: candidateGeometryBytes,
    fileName: "lifecycle-canary-candidate-geometry.ply",
    format: "ply",
    purpose: "metric_point_cloud",
    targetVersionId: versionId,
    captureJourney: candidateJourney,
  });
  await Promise.all([
    waitForJob(candidateVisual.job.id),
    waitForJob(candidateGeometry.job.id),
  ]);
  const candidateQualification = await qualifyCurrentVersionNavigation();
  stage("comparison-candidate-qualified", {
    versionId,
    visualAssetId: candidateVisual.upload.assetId,
    geometryAssetId: candidateGeometry.upload.assetId,
    navigationBuildId: candidateQualification.build.id,
  });
  const candidateVersionId = versionId;
  await verifyComparisonLifecycle({
    baselineVersionId,
    candidateVersionId,
    baselineGeometryAssetId,
    candidateGeometryAssetId: candidateGeometry.upload.assetId,
  });
  versionId = baselineVersionId;

  const preview = await api(`/api/projects/${projectId}/versions/${versionId}/preview`);
  const { response: previewScene, bytes: previewSceneBytes } = await fetchBytesWithBudget(
    new URL(preview.manifest.scene.contentUrl, origin),
    { headers: { cookie } },
    objectRequestBudget("private_preview_scene"),
  );
  if (!previewScene.ok || previewSceneBytes.byteLength === 0) {
    throw new Error(`Private preview scene returned HTTP ${previewScene.status}`);
  }
  stage("private-preview-verified", { format: preview.manifest.scene.format });

  const detail = await projectDetail();
  const webAsset = detail.assets.find((asset) =>
    asset.version_id === versionId && asset.kind === "web" &&
    asset.integrity_status === "verified"
  );
  const posterAsset = detail.assets.find((asset) =>
    asset.version_id === versionId && asset.kind === "poster" &&
    asset.integrity_status === "verified"
  );
  if (!webAsset || !posterAsset) {
    throw new Error("Processing produced no verified web asset and poster pair");
  }
  const queuedScan = await api(`/api/projects/${projectId}/privacy-scans`, {
    method: "POST",
    body: {
      clientOperationId: randomUUID(),
      versionId,
      assetIds: [posterAsset.id],
    },
  });
  workspace = await waitForWorkspace("privacy scan", (candidate) => {
    const scan = candidate.privacyScans.find((item) => item.id === queuedScan.scan.id);
    return scan && ["COMPLETED", "FAILED", "DEAD_LETTER"].includes(scan.status)
      ? scan
      : null;
  });
  const scan = workspace.privacyScans.find((item) => item.id === queuedScan.scan.id);
  if (scan?.status !== "COMPLETED") {
    throw new Error(`Privacy scan ended ${scan?.status ?? "missing"}`);
  }
  for (const candidate of workspace.privacyCandidates.filter((item) =>
    item.scan_id === scan.id && ["pending", "confirmed"].includes(item.status)
  )) {
    await api(`/api/projects/${projectId}/privacy-candidates/${candidate.id}`, {
      method: "PATCH",
      body: {
        status: "dismissed",
        note: "Deterministic synthetic staging canary poster contains no personal data.",
      },
    });
  }
  await api(`/api/versions/${versionId}/approve`, {
    method: "POST",
    body: {
      webAssetId: webAsset.id,
      posterAssetId: posterAsset.id,
      visualGrade: "A",
      privacyStatus: "approved",
      measurementGrade: "visual-only",
      notes: "Synthetic staging lifecycle canary passed the explicit QA criteria.",
    },
  });
  stage("qa-approved", { scanId: scan.id, visualGrade: "A" });

  releaseSlug = `lifecycle-canary-${runId.slice(-8).toLowerCase()}`;
  const published = await api(`/api/projects/${projectId}/releases`, {
    method: "POST",
    body: {
      clientOperationId: randomUUID(),
      slug: releaseSlug,
      accessPolicy: "token",
      viewerConfig: {
        title: "Staging lifecycle canary",
        subtitle: "Synthetic deployment acceptance fixture",
        measurementDisclaimer:
          "This visual experience is not a certified survey and must not be relied upon for construction or boundary decisions.",
        defaultMovementMode: "walk",
      },
    },
  });
  releaseAccessToken = published.release.accessToken;
  if (!releaseAccessToken) throw new Error("Token release returned no access token");
  const expectedPolicyRevisionId = detail.versions.find((version) => version.id === versionId)
    ?.workflow_policy_revision_id;
  if (!expectedPolicyRevisionId) throw new Error("Version has no workflow-policy revision identity");
  const manifest = await fetchJson(
    `/api/releases/${releaseSlug}/manifest?access_token=${encodeURIComponent(releaseAccessToken)}`,
  );
  const expectedIdentities = {
    releaseId: published.release.id,
    projectId,
    versionId,
    workflowPolicyRevisionId: expectedPolicyRevisionId,
    webAssetId: webAsset.id,
    webAssetSha256: webAsset.sha256,
  };
  const observedIdentities = {
    releaseId: manifest.release?.id,
    projectId: manifest.project?.id,
    versionId: manifest.project?.versionId,
    workflowPolicyRevisionId: manifest.release?.workflowPolicyRevisionId,
    webAssetId: manifest.scene?.assetId,
    webAssetSha256: manifest.scene?.sha256,
  };
  if (JSON.stringify(observedIdentities) !== JSON.stringify(expectedIdentities)) {
    throw new Error(
      `Published manifest identity mismatch: expected ${JSON.stringify(expectedIdentities)}, observed ${JSON.stringify(observedIdentities)}`,
    );
  }
  const { response: publishedScene, bytes: publishedSceneBytes } = await fetchBytesWithBudget(
    new URL(manifest.scene.contentUrl, origin),
    {},
    objectRequestBudget("published_scene_artifact"),
  );
  if (!publishedScene.ok || publishedSceneBytes.byteLength === 0) {
    throw new Error(`Published scene returned HTTP ${publishedScene.status}`);
  }
  const publishedSceneSha256 = createHash("sha256").update(publishedSceneBytes).digest("hex");
  if (publishedSceneSha256 !== expectedIdentities.webAssetSha256) {
    throw new Error(
      `Published scene artifact hash mismatch: expected ${expectedIdentities.webAssetSha256}, observed ${publishedSceneSha256}`,
    );
  }
  if (manifest.spatial?.navigationAssets?.buildId !== build.id) {
    throw new Error(
      `Published navigation identity mismatch: expected ${build.id}, observed ${manifest.spatial?.navigationAssets?.buildId ?? "missing"}`,
    );
  }
  stage("release-identity-verified", {
    ...observedIdentities,
    servedArtifactSha256: publishedSceneSha256,
    servedArtifactBytes: publishedSceneBytes.byteLength,
  });
  const releaseUrl = `${published.release.url}?access_token=${encodeURIComponent(releaseAccessToken)}`;
  await verifyLifecycleInChrome(releaseUrl);
  stage("release-rendered", { releaseId: published.release.id, slug: releaseSlug });

  await api(`/api/release-channels/${releaseSlug}`, { method: "DELETE" });
  const revoked = await fetchWithBudget(
    releaseUrl,
    { redirect: "manual" },
    apiRequestBudget("revoked_release_shell"),
  );
  if (revoked.status !== 410) {
    throw new Error(`Revoked release shell returned HTTP ${revoked.status}; expected 410`);
  }
  stage("release-revoked", { slug: releaseSlug });
  releaseSlug = null;

  await api(`/api/projects/${projectId}/archive`, { method: "POST", body: {} });
  await confirmProjectArchived();
  stage("project-archived", { projectId });
  await cleanArchivedProjectObjects(projectId);
  assertLifecycleDeadline("lifecycle completion");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = {
    name: error instanceof Error ? error.name : "Error",
    message: redact(error instanceof Error ? error.message : String(error)),
  };
  process.exitCode = 1;
} finally {
  cleanupMode = true;
  await bestEffortCleanup();
  if (report.cleanup.some((item) => item.status === "failed")) {
    report.status = "failed";
    process.exitCode = 1;
  }
  report.completedAt = new Date().toISOString();
  report.elapsedMilliseconds = Date.parse(report.completedAt) - Date.parse(report.startedAt);
  if (report.status === "passed" && Date.now() > deadline) {
    const observedSeconds = Math.ceil(report.elapsedMilliseconds / 1_000);
    report.status = "failed";
    report.error = {
      name: "LifecycleBudgetError",
      message: lifecycleBudgetMessage("final report", observedSeconds),
    };
    process.exitCode = 1;
  }
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requireStagingOrigin(value) {
  const url = new URL(value);
  if (url.origin !== canonicalStagingOrigin) {
    throw new Error(
      `Lifecycle canary origin allowlist rejected ${url.origin}; expected ${canonicalStagingOrigin}`,
    );
  }
}

function stage(name, evidence = {}) {
  assertLifecycleDeadline(`stage ${name}`);
  report.stages.push({ name, at: new Date().toISOString(), ...evidence });
}

async function provisionServiceOperator() {
  await d1([
    `INSERT INTO users (id, email, display_name) VALUES ('${fixtures.userId}', '${fixtures.email}', 'Lifecycle canary service operator') ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name`,
    `INSERT INTO organisations (id, name, slug) VALUES ('${fixtures.organisationId}', 'Lifecycle canary staging tenant', 'lifecycle-canary-staging') ON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug`,
    `UPDATE memberships SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE revoked_at IS NULL AND (user_id = '${fixtures.userId}' OR user_id IN (SELECT id FROM users WHERE lower(email) = '${fixtures.email}')) AND NOT (user_id = '${fixtures.userId}' AND organisation_id = '${fixtures.organisationId}')`,
    `INSERT INTO memberships (organisation_id, user_id, role, updated_at, revoked_at, status) VALUES ('${fixtures.organisationId}', '${fixtures.userId}', 'production_operator', datetime('now'), NULL, 'active') ON CONFLICT(organisation_id, user_id) DO UPDATE SET role = 'production_operator', updated_at = datetime('now'), revoked_at = NULL, status = 'active'`,
  ].join("; "));
}

async function authenticateServiceOperator() {
  const challenge = await fetchJson("/api/auth/staging-lifecycle-canary/otp", {
    method: "POST",
    headers: { authorization: `Bearer ${canaryToken}`, origin },
  });
  if (challenge.email !== fixtures.email) throw new Error("Canary OTP was issued for an unexpected account");
  const { response, value: payload } = await requestJsonWithBudget(
    `${origin}/api/auth/otp/verify`,
    {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        email: challenge.email,
        challengeId: challenge.challengeId,
        code: challenge.code,
      }),
    },
    apiRequestBudget("otp_verification"),
  );
  if (!response.ok) {
    throw new Error(`Canary OTP verification failed with HTTP ${response.status}: ${redact(JSON.stringify(payload))}`);
  }
  const setCookie = response.headers.get("set-cookie") ?? "";
  const candidateCookie = sessionCookieCandidate(setCookie);
  cookie = candidateCookie;
  try {
    const sessionCookie = sessionCookieFromResponse(setCookie);
    cookie = sessionCookie;
    assertServiceOperatorIdentity(payload.user, "OTP verification");
    const session = await fetchJson("/api/auth/session", {
      headers: { cookie: sessionCookie },
    });
    if (!session.authenticated) throw new Error("Canary session was not authenticated");
    assertServiceOperatorIdentity(session.user, "session bootstrap");
    return sessionCookie;
  } catch (error) {
    await revokeRejectedSession(candidateCookie, "initial identity verification", error);
  }
}

async function refreshServiceOperatorSession() {
  const { response, value: payload } = await requestJsonWithBudget(
    `${origin}/api/auth/refresh`,
    {
      method: "POST",
      headers: { cookie, origin },
    },
    apiRequestBudget("session_refresh"),
  );
  if (!response.ok) {
    throw new Error(
      `Canary session refresh failed with HTTP ${response.status}: ${redact(JSON.stringify(payload))}`,
    );
  }
  const setCookie = response.headers.get("set-cookie") ?? "";
  const candidateCookie = sessionCookieCandidate(setCookie);
  cookie = candidateCookie;
  try {
    cookie = sessionCookieFromResponse(setCookie);
    assertServiceOperatorIdentity(payload.user, "session refresh");
    const session = await fetchJson("/api/auth/session", {
      headers: { cookie },
    });
    if (!session.authenticated) throw new Error("Refreshed canary session was not authenticated");
    assertServiceOperatorIdentity(session.user, "refreshed session bootstrap");
    report.measurements.sessionRefreshes += 1;
  } catch (error) {
    await revokeRejectedSession(candidateCookie, "refreshed identity verification", error);
  }
}

function sessionCookieCandidate(setCookie) {
  const pairs = ["spatial_access", "spatial_refresh"]
    .map((name) => {
      const value = setCookie.match(new RegExp(`${name}=([^;,]+)`))?.[1];
      return value ? `${name}=${value}` : null;
    })
    .filter(Boolean);
  if (!pairs.length) throw new Error("Canary authentication returned no revocable session cookie");
  return pairs.join("; ");
}

function sessionCookieFromResponse(setCookie) {
  const access = setCookie.match(/spatial_access=([^;,]+)/)?.[1];
  const refresh = setCookie.match(/spatial_refresh=([^;,]+)/)?.[1];
  if (!access || !refresh) throw new Error("Canary authentication returned incomplete session cookies");
  return `spatial_access=${access}; spatial_refresh=${refresh}`;
}

async function revokeRejectedSession(candidateCookie, source, originalError) {
  try {
    const { response } = await requestJsonWithBudget(
      `${origin}/api/auth/session`,
      {
        method: "DELETE",
        headers: { cookie: candidateCookie, origin },
      },
      apiRequestBudget(`revoke_rejected_session:${source}`),
    );
    if (!response.ok) {
      throw new Error(`Rejected canary session revocation returned HTTP ${response.status}`);
    }
    report.cleanup.push({
      resource: "auth-session",
      status: "revoked",
      reason: source,
    });
    if (cookie === candidateCookie) cookie = null;
  } catch (revocationError) {
    report.cleanup.push({
      resource: "auth-session",
      status: "failed",
      reason: source,
      error: redact(String(revocationError)),
    });
    process.exitCode = 1;
  }
  throw originalError;
}

function assertServiceOperatorIdentity(user, source) {
  const expected = {
    userId: fixtures.userId,
    organisationId: fixtures.organisationId,
    email: fixtures.email,
    role: "production_operator",
  };
  const observed = Object.fromEntries(
    Object.keys(expected).map((key) => [key, user?.[key] ?? null]),
  );
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(
      `${source} identity mismatch: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(observed)}`,
    );
  }
}

async function uploadBytes(input) {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const created = await api(`/api/projects/${input.projectId}/uploads`, {
    method: "POST",
    body: {
      clientOperationId: randomUUID(),
      fileName: input.fileName,
      sizeBytes: input.bytes.byteLength,
      format: input.format,
      purpose: input.purpose,
      mimeType: "application/octet-stream",
      sha256,
      ...(input.targetVersionId ? { targetVersionId: input.targetVersionId } : {}),
      ...(input.captureJourney ? { captureJourney: input.captureJourney } : {}),
    },
  });
  openUploadIds.add(created.upload.id);
  const uploaded = await api(`/api/uploads/${created.upload.id}/parts/1`, {
    method: "PUT",
    bytes: input.bytes,
  });
  const completed = await api(`/api/uploads/${created.upload.id}/complete`, {
    method: "POST",
    body: { parts: [{ partNumber: 1, etag: uploaded.part.etag }] },
  });
  openUploadIds.delete(created.upload.id);
  return { upload: created.upload, asset: completed.asset, job: completed.job };
}

function visualRoomPoints() {
  const points = [];
  const samplesPerAxis = 64;
  for (let row = 0; row < samplesPerAxis; row += 1) {
    for (let column = 0; column < samplesPerAxis; column += 1) {
      const across = column / (samplesPerAxis - 1);
      const vertical = row / (samplesPerAxis - 1);
      points.push([4 * across, 0, 3 * vertical, 0.80, 0.68, 0.43]);
      points.push([4 * across, 2.5 * vertical, 0, 0.35, 0.66, 0.82]);
      points.push([0, 2.5 * vertical, 3 * across, 0.72, 0.42, 0.68]);
    }
  }
  return points;
}

function gaussianPly(points) {
  const properties = [
    "x", "y", "z",
    "f_dc_0", "f_dc_1", "f_dc_2",
    "opacity",
    "scale_0", "scale_1", "scale_2",
    "rot_0", "rot_1", "rot_2", "rot_3",
  ];
  const header = Buffer.from([
    "ply",
    "format binary_little_endian 1.0",
    "comment deterministic staging lifecycle Gaussian room fixture",
    `element vertex ${points.length}`,
    ...properties.map((name) => `property float ${name}`),
    "end_header",
    "",
  ].join("\n"));
  const vertexBytes = Buffer.alloc(points.length * properties.length * 4);
  const sphericalHarmonicConstant = 0.28209479177387814;
  const opacity = Math.log(0.95 / 0.05);
  const scale = Math.log(0.035);
  points.forEach(([x, y, z, red, green, blue], index) => {
    const values = [
      x, y, z,
      ...[red, green, blue].map((channel) =>
        (channel - 0.5) / sphericalHarmonicConstant),
      opacity,
      scale, scale, scale,
      1, 0, 0, 0,
    ];
    values.forEach((value, propertyIndex) => {
      vertexBytes.writeFloatLE(
        value,
        (index * properties.length + propertyIndex) * 4,
      );
    });
  });
  return new Uint8Array(Buffer.concat([header, vertexBytes]));
}

async function waitForJob(jobId) {
  return waitFor(`processing job ${jobId}`, async () => {
    const detail = await projectDetail();
    const job = detail.jobs.find((candidate) => candidate.id === jobId);
    if (!job || !["SUCCEEDED", "FAILED", "DEAD_LETTER", "CANCELLED"].includes(job.state)) return null;
    if (job.state !== "SUCCEEDED") {
      throw new Error(`Processing job ${jobId} ended ${job.state}: ${job.error_json ?? "no error receipt"}`);
    }
    return job;
  });
}

async function waitForWorkspace(label, predicate) {
  return waitFor(label, async () => {
    const workspace = await spatialWorkspace();
    return predicate(workspace) ? workspace : null;
  });
}

async function waitFor(label, probe) {
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollIntervalMilliseconds));
  }
  const observedSeconds = Math.ceil((Date.now() - Date.parse(report.startedAt)) / 1_000);
  throw new Error(
    `lifecycle_canary_window_seconds=${timeoutSeconds}, requested=${observedSeconds}; ${label} did not complete`,
  );
}

async function projectDetail() {
  return api(`/api/projects/${projectId}`);
}

async function spatialWorkspace() {
  return api(`/api/projects/${projectId}/spatial?versionId=${versionId}`);
}

async function qualifyCurrentVersionNavigation() {
  let workspace = await waitForWorkspace(
    `floor-plan proposal for ${versionId}`,
    (candidate) => candidate.floorplanExtractions.find((item) =>
      item.status === "READY_FOR_REVIEW" && item.proposal_json
    ),
  );
  const extraction = workspace.floorplanExtractions.find((item) =>
    item.status === "READY_FOR_REVIEW" && item.proposal_json
  );
  if (!extraction) throw new Error("The automatic floor-plan proposal disappeared");
  const proposal = JSON.parse(extraction.proposal_json);
  const review = await api(
    `/api/projects/${projectId}/spatial/floorplan-extractions/${extraction.id}/review`,
    {
      method: "POST",
      body: {
        clientOperationId: randomUUID(),
        decision: "approve",
        note: "Staging service operator reviewed the deterministic synthetic capture fixture.",
        plan: floorplanProposalToReviewPlan(proposal),
        captureAgreementResolutions: captureAgreementResolutions(proposal.captureAgreement),
      },
    },
  );
  workspace = await waitForWorkspace(`navigation build for ${versionId}`, (candidate) => {
    const candidateBuild = candidate.navigationBuilds.find((item) =>
      item.id === review.automaticNavigation.id
    );
    return candidateBuild &&
        ["APPROVED", "READY_FOR_REVIEW", "FAILED", "REJECTED"].includes(candidateBuild.status)
      ? candidateBuild
      : null;
  });
  let build = workspace.navigationBuilds.find((item) =>
    item.id === review.automaticNavigation.id
  );
  if (!build || ["FAILED", "REJECTED"].includes(build.status)) {
    throw new Error(`Navigation build ended ${build?.status ?? "missing"}`);
  }
  if (build.status === "READY_FOR_REVIEW") {
    const artifact = JSON.parse(build.artifact_json ?? "{}");
    await api(
      `/api/projects/${projectId}/spatial/navigation-builds/${build.id}/review`,
      {
        method: "POST",
        body: {
          decision: "approve",
          note: "Staging service operator reviewed the deterministic navigation receipt.",
          finalCaptureAgreementResolutions: captureAgreementResolutions(
            artifact.finalCaptureAgreement,
          ),
        },
      },
    );
    workspace = await spatialWorkspace();
    build = workspace.navigationBuilds.find((item) => item.id === build.id);
  }
  if (build?.status !== "APPROVED") {
    throw new Error(`Navigation build was not approved: ${build?.status ?? "missing"}`);
  }
  await api(`/api/projects/${projectId}/spatial/navigation-builds/${build.id}/walk-tests`, {
    method: "POST",
    body: {
      clientOperationId: randomUUID(),
      versionId,
      startPose: { position: [0.5, 1.6, 0.5], target: [1, 1.6, 0.5] },
      endPose: { position: [1, 1.6, 0.5], target: [1.5, 1.6, 0.5] },
      runtimeEvidence: {
        movementObserved: true,
        collisionFailureReported: false,
        traversalBlockReported: false,
      },
    },
  });
  return { workspace, build, extraction, review };
}

async function verifyComparisonLifecycle(input) {
  const detail = await projectDetail();
  const readiness = detail.comparisonReadiness;
  const pair = readiness?.eligiblePairs?.find((candidate) =>
    new Set([candidate.leftVersionId, candidate.rightVersionId]).size === 2 &&
    [candidate.leftVersionId, candidate.rightVersionId].includes(input.baselineVersionId) &&
    [candidate.leftVersionId, candidate.rightVersionId].includes(input.candidateVersionId)
  );
  for (const mode of ["visual", "authored_geometry", "raw"]) {
    if (!readiness?.available || !pair?.modes?.includes(mode)) {
      throw new Error(
        `Comparison readiness did not qualify ${mode}: ${JSON.stringify(readiness)}`,
      );
    }
  }
  const comparison = await api(
    `/api/projects/${projectId}/versions/compare?left=${input.baselineVersionId}` +
      `&right=${input.candidateVersionId}`,
  );
  if (comparison.renderables?.length !== 2) {
    throw new Error(`Visual comparison returned ${comparison.renderables?.length ?? 0} renderables`);
  }
  // Assurance inventory marker: GET /comparison-asset/:projectId/:versionId/:assetId/:fileName
  // These signed URLs exercise the deployed comparison-asset boundary rather
  // than reading the backing R2 objects directly.
  const served = [];
  for (const renderable of comparison.renderables) {
    const source = comparison.assets.find((asset) => asset.id === renderable.assetId);
    if (!source?.sha256 || source.sha256 !== renderable.sha256) {
      throw new Error(`Comparison renderable ${renderable.assetId} lost its source asset identity`);
    }
    const { response, bytes } = await fetchBytesWithBudget(
      new URL(renderable.contentUrl, origin),
      { headers: { cookie } },
      objectRequestBudget(`comparison_scene:${renderable.versionId}`),
    );
    const observedSha256 = createHash("sha256").update(bytes).digest("hex");
    if (!response.ok || observedSha256 !== source.sha256) {
      throw new Error(
        `Signed comparison asset ${source.id} returned HTTP ${response.status} with SHA-256 ${observedSha256}; expected ${source.sha256}`,
      );
    }
    served.push({
      versionId: renderable.versionId,
      assetId: source.id,
      sha256: observedSha256,
      bytes: bytes.byteLength,
    });
  }
  const geometry = await api(`/api/projects/${projectId}/spatial/change-reports`, {
    method: "POST",
    body: {
      clientOperationId: randomUUID(),
      fromVersionId: input.baselineVersionId,
      toVersionId: input.candidateVersionId,
      thresholdMm: 50,
      coordinateAssurance: "shared_local_frame",
      registrationEvidence:
        "Both synthetic versions use the same deterministic right-handed Y-up metre fixture.",
    },
  });
  await api(`/api/projects/${projectId}/spatial/change-reports/${geometry.report.id}`, {
    method: "PATCH",
    body: {
      decision: "accepted",
      note: "Staging service operator reviewed the deterministic authored-geometry comparison.",
    },
  });
  const raw = await api(`/api/projects/${projectId}/spatial/raw-change-reports`, {
    method: "POST",
    body: {
      clientOperationId: randomUUID(),
      baselineVersionId: input.baselineVersionId,
      candidateVersionId: input.candidateVersionId,
      baselineAssetId: input.baselineGeometryAssetId,
      candidateAssetId: input.candidateGeometryAssetId,
      registrationMode: "automatic_rigid",
      coordinateAssurance: "shared_local_frame",
      registrationEvidence:
        "Deterministic staging sources preserve the same local capture frame.",
      registrationSearchRadiusM: 1,
      registrationMaximumRmseMm: 100,
      registrationMinimumOverlapPercent: 55,
      voxelSizeM: 0.1,
      structuralChangeThresholdPercent: 2,
      photometricChangeThresholdPercent: 12,
      centroidChangeThresholdMm: 50,
      maximumSamplePoints: 2_000_000,
    },
  });
  await waitForJob(raw.report.jobId);
  const rawWorkspace = await spatialWorkspace();
  const rawReport = rawWorkspace.rawChangeReports.find((candidate) =>
    candidate.id === raw.report.id
  );
  if (
    rawReport?.status !== "COMPLETED" || rawReport.registration_status !== "accepted" ||
    !rawReport.report_asset_id
  ) {
    throw new Error(`Raw comparison did not complete with accepted registration: ${JSON.stringify(rawReport)}`);
  }
  await api(`/api/projects/${projectId}/spatial/raw-change-reports/${raw.report.id}`, {
    method: "PATCH",
    body: {
      decision: "accepted",
      note: "Staging service operator reviewed the deterministic registered raw-scene comparison.",
    },
  });
  stage("comparison-lifecycle-verified", {
    pair: {
      baselineVersionId: input.baselineVersionId,
      candidateVersionId: input.candidateVersionId,
      modes: pair.modes,
    },
    signedAssets: served,
    authoredGeometryReportId: geometry.report.id,
    rawReportId: raw.report.id,
    rawReportAssetId: rawReport.report_asset_id,
    rawSourceAssets: [input.baselineGeometryAssetId, input.candidateGeometryAssetId],
    reviewDecisions: ["authored_geometry:accepted", "raw:accepted"],
  });
}

function floorplanProposalToReviewPlan(proposal) {
  const point2 = (point) => [Number(point[0]), Number(point[2])];
  const room = (candidate) => ({
    id: candidate.roomKey,
    label: candidate.label,
    points: candidate.geometry.points.map(point2),
  });
  const wall = (candidate) => ({
    id: candidate.wallKey,
    label: candidate.label,
    start: point2(candidate.geometry.points[0]),
    end: point2(candidate.geometry.points[1]),
    thicknessM: candidate.thicknessM,
    heightM: candidate.heightM,
  });
  const opening = (candidate) => ({
    id: candidate.openingKey,
    label: candidate.label,
    type: "unknown",
    wallId: null,
    start: point2(candidate.geometry.points[0]),
    end: point2(candidate.geometry.points[1]),
    widthM: candidate.widthM,
    heightM: candidate.heightM ?? null,
  });
  const levels = Array.isArray(proposal.levels) && proposal.levels.length
    ? proposal.levels.map((level) => ({
      id: level.levelKey,
      label: level.label,
      elevationM: level.elevationM,
      ceilingElevationM: level.ceilingElevationM ?? null,
      rooms: proposal.rooms.filter((candidate) => level.roomKeys.includes(candidate.roomKey)).map(room),
      walls: proposal.walls.filter((candidate) => level.wallKeys.includes(candidate.wallKey)).map(wall),
      openings: proposal.openings.filter((candidate) => level.openingKeys.includes(candidate.openingKey)).map(opening),
    }))
    : [{
      id: "level-1",
      label: "Level 1",
      elevationM: proposal.summary.inferredFloorElevationM,
      ceilingElevationM: proposal.summary.inferredCeilingElevationM ?? null,
      rooms: proposal.rooms.map(room),
      walls: proposal.walls.map(wall),
      openings: proposal.openings.map(opening),
    }];
  return {
    schemaVersion: "1.0.0",
    units: "metres",
    coordinateFrame: "registered_y_up_metric_frame",
    levels,
    connectors: (proposal.connectors ?? []).map((connector) => ({
      id: connector.connectorKey,
      label: connector.label,
      type: "unknown",
      lowerLevelId: connector.lowerLevelKey,
      upperLevelId: connector.upperLevelKey,
      points: connector.geometry.points,
    })),
  };
}

function captureAgreementResolutions(agreement) {
  return (agreement?.findings ?? [])
    .filter((finding) => finding.kind === "barrier_crosses_open_capture")
    .map((finding) => ({
      barrierId: finding.barrierId,
      ...(finding.levelKey ? { levelKey: finding.levelKey } : {}),
      elevationM: finding.elevationM,
      from: finding.from,
      to: finding.to,
      classification: "unobserved_boundary",
      note: "Deterministic sparse canary fixture; retained as an explicit unobserved boundary.",
    }));
}

async function verifyLifecycleInChrome(url) {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist"],
    timeout: remainingLifecycleMilliseconds("chrome launch"),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const browserOrigin = new URL(origin);
    await context.addCookies(cookie.split("; ").map((pair) => {
      const separator = pair.indexOf("=");
      return {
        name: pair.slice(0, separator),
        value: pair.slice(separator + 1),
        domain: browserOrigin.hostname,
        path: "/",
        secure: true,
        sameSite: "Lax",
      };
    }));
    const studio = await context.newPage();
    const studioStartedAt = performance.now();
    await runWithBudget(chromeNavigationBudget("authenticated_studio_navigation"),
      ({ limit }) => studio.goto(`${origin}/studio.html#project/${projectId}`, {
        waitUntil: "domcontentloaded",
        timeout: limit,
      }));
    await runWithBudget(chromeReadyBudget("authenticated_studio_detail"),
      ({ limit }) => studio.locator("#detailTitle")
        .filter({ hasText: `Lifecycle canary ${runId.slice(-8)}` })
        .waitFor({ state: "visible", timeout: limit }));
    await runWithBudget(chromeReadyBudget("authenticated_studio_workspace"),
      ({ limit }) => studio.locator("#projectWorkspaceHeader")
        .waitFor({ state: "visible", timeout: limit }));
    await runWithBudget(chromeReadyBudget("comparison_stage_navigation"), async ({ limit }) => {
      const compareTab = studio.locator("#projectCompareTab");
      await compareTab.waitFor({ state: "visible", timeout: limit });
      await compareTab.click({ timeout: limit });
      await studio.locator(".comparison-evidence")
        .filter({ hasText: "Compare immutable versions" })
        .waitFor({ state: "visible", timeout: limit });
      await studio.getByRole("button", { name: "Compare scenes side by side" })
        .click({ timeout: limit });
      await studio.locator("#versionComparisonDialog")
        .waitFor({ state: "visible", timeout: limit });
      await studio.locator("#compareLeftStatus")
        .filter({ hasText: "Spark ready" })
        .waitFor({ state: "visible", timeout: limit });
      await studio.locator("#compareRightStatus")
        .filter({ hasText: "Spark ready" })
        .waitFor({ state: "visible", timeout: limit });
    });
    report.measurements.authenticatedStudioRenderMilliseconds =
      Math.ceil(performance.now() - studioStartedAt);
    stage("authenticated-studio-and-comparison-rendered", { projectId });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const releaseStartedAt = performance.now();
    await runWithBudget(chromeNavigationBudget("release_navigation"),
      ({ limit }) => page.goto(url, { waitUntil: "domcontentloaded", timeout: limit }));
    await runWithBudget(chromeReadyBudget("release_renderer_ready"),
      ({ limit }) => page.locator("#rendererStatus").filter({ hasText: " ready" }).waitFor({
        state: "visible",
        timeout: limit,
      }));
    report.measurements.releaseRenderMilliseconds =
      Math.ceil(performance.now() - releaseStartedAt);
    if (errors.length) throw new Error(`Release browser errors: ${errors.join(" | ")}`);
    await mkdir(dirname(screenshotPath), { recursive: true });
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      timeout: remainingLifecycleMilliseconds("release screenshot"),
    });
    await runWithinLifecycle("chrome context close", () => context.close(), true);
  } finally {
    await runWithinLifecycle("chrome browser close", () => browser.close(), true);
  }
}

async function bestEffortCleanup() {
  if (releaseSlug && cookie) {
    try {
      await api(`/api/release-channels/${releaseSlug}`, { method: "DELETE" });
      report.cleanup.push({ resource: "release-channel", id: releaseSlug, status: "revoked" });
    } catch (error) {
      report.cleanup.push({ resource: "release-channel", id: releaseSlug, status: "failed", error: redact(String(error)) });
      process.exitCode = 1;
    }
  }
  if (projectId && cookie) {
    for (const uploadId of [...openUploadIds]) {
      try {
        await api(`/api/uploads/${uploadId}`, { method: "DELETE" });
        openUploadIds.delete(uploadId);
        report.cleanup.push({ resource: "upload-session", id: uploadId, status: "aborted" });
      } catch (error) {
        report.cleanup.push({
          resource: "upload-session",
          id: uploadId,
          status: "failed",
          error: redact(String(error)),
        });
        process.exitCode = 1;
      }
    }
    try {
      const detail = await projectDetail();
      for (const job of detail.jobs.filter((candidate) =>
        ["QUEUED", "LEASED", "RUNNING"].includes(candidate.state)
      )) {
        await api(`/api/jobs/${job.id}/cancel`, { method: "POST", body: {} });
        report.cleanup.push({ resource: "processing-job", id: job.id, status: "cancelled" });
      }
    } catch (error) {
      report.cleanup.push({ resource: "processing-jobs", id: projectId, status: "failed", error: redact(String(error)) });
      process.exitCode = 1;
    }
    if (!projectArchived) {
      try {
        await api(`/api/projects/${projectId}/archive`, { method: "POST", body: {} });
        await confirmProjectArchived();
        report.cleanup.push({ resource: "project", id: projectId, status: "archived" });
      } catch (error) {
        report.cleanup.push({ resource: "project", id: projectId, status: "failed", error: redact(String(error)) });
        process.exitCode = 1;
      }
    }
    if (projectArchived) {
      try {
        await cleanArchivedProjectObjects(projectId);
      } catch (error) {
        report.cleanup.push({ resource: "project-objects", id: projectId, status: "failed", error: redact(String(error)) });
        process.exitCode = 1;
      }
    }
  }
  if (cookie) {
    try {
      await api("/api/auth/session", { method: "DELETE" });
      report.cleanup.push({ resource: "auth-session", status: "revoked" });
      cookie = null;
    } catch (error) {
      report.cleanup.push({ resource: "auth-session", status: "failed", error: redact(String(error)) });
      process.exitCode = 1;
    }
  }
}

async function confirmProjectArchived() {
  const detail = await projectDetail();
  if (detail.project?.status !== "ARCHIVED") {
    throw new Error(
      `project_archive_state expected ARCHIVED, observed ${detail.project?.status ?? "missing"}`,
    );
  }
  projectArchived = true;
}

async function cleanArchivedProjectObjects(id) {
  if (report.cleanup.some((item) => item.resource === "project-objects" && item.id === id)) return;
  const escapedId = id.replaceAll("'", "''");
  const openOutputs = await d1(`SELECT id FROM job_output_uploads WHERE project_id = '${escapedId}' AND status = 'OPEN'`);
  const openOutputIds = openOutputs[0]?.results?.map((row) => row.id).filter(Boolean) ?? [];
  if (openOutputIds.length) {
    throw new Error(
      `job_output_upload_cleanup expected 0 OPEN rows after archive, observed ${openOutputIds.length}: ${openOutputIds.join(",")}`,
    );
  }
  const result = await d1(`
    SELECT object_key, 'asset' AS source
    FROM assets
    WHERE project_id = '${escapedId}' AND deleted_at IS NULL
    UNION
    SELECT object_key, 'job-output' AS source
    FROM job_output_uploads
    WHERE project_id = '${escapedId}' AND status = 'COMPLETED'
  `);
  const objects = result[0]?.results?.filter((row) => row.object_key) ?? [];
  const keys = [...new Set(objects.map((row) => row.object_key))];
  for (const key of keys) {
    await wrangler(["r2", "object", "delete", `spatial-studio-assets-staging/${key}`, "--remote"]);
  }
  await d1(`UPDATE assets SET deleted_at = COALESCE(deleted_at, datetime('now')) WHERE project_id = '${escapedId}'`);
  await d1(`UPDATE job_output_uploads SET status = 'ABORTED', completed_at = COALESCE(completed_at, datetime('now')) WHERE project_id = '${escapedId}' AND status = 'COMPLETED'`);
  report.cleanup.push({
    resource: "project-objects",
    id,
    status: "deleted",
    objectCount: keys.length,
    jobOutputObjectCount: objects.filter((row) => row.source === "job-output").length,
    retainedD1Evidence: "archived immutable lifecycle receipt",
  });
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("accept", "application/json");
  if (cookie) headers.set("cookie", cookie);
  if (options.method && options.method !== "GET") headers.set("origin", origin);
  let body;
  if (options.bytes) {
    body = options.bytes;
    headers.set("content-type", "application/octet-stream");
    headers.set("content-length", String(options.bytes.byteLength));
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers.set("content-type", "application/json");
  }
  return fetchJson(path, { method: options.method ?? "GET", headers, body });
}

async function fetchJson(path, options = {}) {
  const input = path.startsWith("http") ? path : `${origin}${path}`;
  const budget = apiRequestBudget(`${options.method ?? "GET"} ${path}`);
  let { response, value } = await requestJsonWithBudget(input, options, budget);
  if (
    response.status === 401 &&
    cookie &&
    !path.startsWith("/api/auth/")
  ) {
    await refreshServiceOperatorSession();
    const retryHeaders = new Headers(options.headers ?? {});
    retryHeaders.set("cookie", cookie);
    ({ response, value } = await requestJsonWithBudget(
      input,
      { ...options, headers: retryHeaders },
      budget,
    ));
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed with HTTP ${response.status}: ${redact(JSON.stringify(value)).slice(0, 2000)}`);
  }
  return value;
}

function apiRequestBudget(operation) {
  return {
    name: "api_request_milliseconds",
    operation,
    limit: apiRequestBudgetMilliseconds,
    measurement: "maximumApiRequestMilliseconds",
  };
}

function objectRequestBudget(operation) {
  return {
    name: "object_request_milliseconds",
    operation,
    limit: objectRequestBudgetMilliseconds,
    measurement: "maximumObjectRequestMilliseconds",
  };
}

function chromeNavigationBudget(operation) {
  return {
    name: "chrome_navigation_milliseconds",
    operation,
    limit: chromeNavigationBudgetMilliseconds,
    measurement: "maximumChromeNavigationMilliseconds",
  };
}

function chromeReadyBudget(operation) {
  return {
    name: "chrome_ready_milliseconds",
    operation,
    limit: chromeReadyBudgetMilliseconds,
    measurement: "maximumChromeReadyMilliseconds",
  };
}

function lifecycleBudgetMessage(operation, observedSeconds = null) {
  const requested = observedSeconds ?? Math.ceil(
    (Date.now() - Date.parse(report.startedAt)) / 1_000,
  );
  return `lifecycle_canary_window_seconds limit=${timeoutSeconds}, requested=${requested}; operation=${operation}`;
}

function remainingLifecycleMilliseconds(operation) {
  if (cleanupMode) return apiRequestBudgetMilliseconds;
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(lifecycleBudgetMessage(operation));
  return remaining;
}

function assertLifecycleDeadline(operation) {
  remainingLifecycleMilliseconds(operation);
}

async function runWithinLifecycle(operation, action, cleanup = false) {
  const remaining = cleanup && Date.now() >= deadline
    ? apiRequestBudgetMilliseconds
    : remainingLifecycleMilliseconds(operation);
  let timer;
  try {
    return await Promise.race([
      action(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(lifecycleBudgetMessage(operation))), remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runWithBudget(budget, action) {
  const startedAt = performance.now();
  const lifecycleRemaining = remainingLifecycleMilliseconds(budget.operation);
  const effectiveLimit = Math.min(budget.limit, lifecycleRemaining);
  try {
    return await action({
      limit: effectiveLimit,
      signal: AbortSignal.timeout(effectiveLimit),
    });
  } catch (error) {
    const requested = Math.ceil(performance.now() - startedAt);
    if (
      error?.name === "TimeoutError" ||
      error?.name === "AbortError" ||
      requested >= effectiveLimit
    ) {
      if (effectiveLimit === lifecycleRemaining) {
        throw new Error(lifecycleBudgetMessage(budget.operation), { cause: error });
      }
      throw new Error(
        `${budget.name} limit=${budget.limit}, requested=${Math.max(requested, budget.limit)}; operation=${budget.operation}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    const observed = Math.ceil(performance.now() - startedAt);
    report.measurements[budget.measurement] = Math.max(
      report.measurements[budget.measurement],
      observed,
    );
  }
}

async function fetchWithBudget(input, options, budget) {
  return runWithBudget(budget, ({ signal }) => fetch(input, { ...options, signal }));
}

async function fetchBytesWithBudget(input, options, budget) {
  return runWithBudget(budget, async ({ signal }) => {
    const response = await fetch(input, { ...options, signal });
    return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
  });
}

async function requestJsonWithBudget(input, options, budget) {
  return runWithBudget(budget, async ({ signal }) => {
    const response = await fetch(input, { ...options, signal });
    const text = await response.text();
    let value = null;
    try { value = text ? JSON.parse(text) : null; } catch { value = text; }
    return { response, value };
  });
}

async function d1(command) {
  const output = await wrangler([
    "d1", "execute", "DB", "--env", "staging", "--remote",
    "--command", command, "--json",
  ]);
  const start = output.indexOf("[");
  if (start < 0) throw new Error(`D1 returned no JSON: ${output.slice(0, 500)}`);
  return JSON.parse(output.slice(start));
}

async function wrangler(args) {
  const executable = resolve(repositoryRoot, "node_modules/wrangler/bin/wrangler.js");
  const operation = `wrangler ${args.slice(0, 3).join(" ")}`;
  const remaining = remainingLifecycleMilliseconds(operation);
  const startedAt = performance.now();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [executable, ...args], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const observed = Math.ceil(performance.now() - startedAt);
      report.measurements.maximumSubprocessMilliseconds = Math.max(
        report.measurements.maximumSubprocessMilliseconds,
        observed,
      );
      action();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error(lifecycleBudgetMessage(operation))));
    }, remaining);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code) => {
      finish(() => {
        if (code === 0) resolvePromise(stdout);
        else reject(new Error(`${operation} exited ${code}: ${redact(`${stderr} ${stdout}`).slice(-2000)}`));
      });
    });
  });
}

function redact(value) {
  return String(value)
    .replaceAll(canaryToken, "[REDACTED]")
    .replace(/spatial_(?:access|refresh)=[^;\s]+/g, "spatial_session=[REDACTED]")
    .replace(/access_token=[^&\s"']+/g, "access_token=[REDACTED]");
}
