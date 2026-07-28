import { chromium } from "playwright";

const baseUrl = process.env.SPATIAL_QA_ORIGIN
  ?? "https://spatial-studio-staging.swmengappdev.workers.dev";
const projectId = "88888888-0000-4000-8000-000000000023";
const versionId = "88888888-0000-4000-8000-000000000024";
const assetId = "88888888-0000-4000-8000-000000000025";
const extractionId = "88888888-0000-4000-8000-000000000027";
const candidateId = "bc81d479-9fe9-4d46-aa68-ae6d18851045";
const now = "2026-07-28T05:40:00.000Z";

const project = {
  id: projectId,
  name: "M23 semantic extraction staging QA",
  slug: "m23-semantic-extraction-staging-qa",
  status: "DRAFT",
  captureAdapter: "open-import",
  deliveryTemplate: "venue-navigator",
  notes: "Browser action-state acceptance fixture.",
  customerName: null,
  customFields: {},
  latestVersionId: versionId,
  latestVersionNumber: 1,
  activeReleaseSlug: null,
  updatedAt: now,
};
const asset = {
  id: assetId,
  version_id: versionId,
  kind: "pointcloud",
  format: "ply",
  file_name: "registered-semantic-floor.ply",
  size_bytes: 1253,
  integrity_status: "verified",
};
const spatial = {
  version: { id: versionId, version_number: 1 },
  entities: [],
  routes: [],
  routeStops: [],
  privacyRegions: [],
  privacyScans: [],
  privacyCandidates: [],
  changeReports: [],
  captureCompletenessReports: [],
  rawChangeReports: [],
  semanticExtractions: [{
    id: extractionId,
    version_id: versionId,
    input_asset_id: assetId,
    job_id: "88888888-0000-4000-8000-000000000026",
    method: "registered-ply-walkable-candidates-v1",
    status: "READY_FOR_REVIEW",
    parameters_json: "{}",
    summary_json: JSON.stringify({
      inferredFloorElevationM: 0,
      candidateCount: 1,
      totalCandidateAreaM2: 12,
    }),
    candidate_count: 1,
    review_decision: null,
    review_note: null,
    job_state: "SUCCEEDED",
    job_progress: 100,
    job_progress_message: "Walkable candidates ready for human review",
    job_error_json: null,
    input_file_name: asset.file_name,
    input_size_bytes: asset.size_bytes,
    created_at: now,
  }],
  semanticCandidates: [{
    id: candidateId,
    extraction_id: extractionId,
    candidate_key: "walkable-001",
    kind: "walkable_region",
    label: "Candidate room 1",
    geometry_json: JSON.stringify({
      type: "polygon",
      points: [[0, 0, 0], [4, 0, 0], [4, 0, 3], [0, 0, 3]],
    }),
    elevation_m: 0,
    area_m2: 12,
    confidence: 0.95,
    evidence_json: "{}",
    status: "pending",
    scene_entity_id: null,
  }],
  deliveryPolicy: null,
  collisionProxy: { version: "empty-v1", boxes: [] },
  navigationMesh: { version: "empty-v1", vertices: [], indices: [], sourceEntityIds: [] },
};

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_EXECUTABLE_PATH
    ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const unexpectedErrors = [];
  let expectedFailureActive = false;
  let queueRequests = 0;
  let reviewRequests = 0;
  page.on("console", (message) => {
    if (message.type() === "error" && !expectedFailureActive) {
      unexpectedErrors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => unexpectedErrors.push(`page: ${error.message}`));

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "POST" && url.pathname.endsWith("/spatial/semantic-extractions")) {
      queueRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "QA-injected semantic processor outage. Retry remains safe." }),
      });
    }
    if (
      method === "POST" &&
      url.pathname.endsWith(`/spatial/semantic-extractions/${extractionId}/review`)
    ) {
      reviewRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "QA-injected semantic review outage. Retry remains safe." }),
      });
    }
    const response = mockApiResponse(url.pathname, method);
    return route.fulfill({
      status: response.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(response.body),
    });
  });

  await page.goto(
    `${baseUrl}/studio.html#spatial/${encodeURIComponent(projectId)}`,
    { waitUntil: "domcontentloaded", timeout: 30_000 },
  );
  await page.getByRole("heading", { name: "Machine candidates, human-authored structure" })
    .waitFor({ state: "visible", timeout: 20_000 });
  if (await page.locator("#loginDialog[open]").count()) {
    throw new Error("Mocked authenticated Studio still opened the login dialog.");
  }

  await page.getByRole("button", { name: "Queue another extraction" }).click();
  const extractionDialog = page.locator("#semanticExtractionDialog");
  await extractionDialog.waitFor({ state: "visible" });
  await extractionDialog.locator("[name='registrationEvidence']").fill(
    "Browser QA inspected metres, Y-up orientation, and the immutable project-local registration evidence.",
  );
  const extractionForm = page.locator("#semanticExtractionForm");
  const extractionSubmit = extractionForm.getByRole("button", { name: "Queue semantic extraction" });
  expectedFailureActive = true;
  await extractionSubmit.evaluate((button) => {
    window.setTimeout(() => {
      const form = document.querySelector("#semanticExtractionForm");
      const trigger = form?.querySelector("[type='submit']");
      window.__semanticExtractionPending = {
        label: trigger?.textContent ?? null,
        disabled: trigger instanceof HTMLButtonElement ? trigger.disabled : null,
        busy: form?.getAttribute("aria-busy") ?? null,
        disabledControlCount: form?.querySelectorAll(
          "input:disabled, select:disabled, textarea:disabled, button:disabled",
        ).length ?? 0,
      };
    }, 100);
    button.click();
    button.click();
  });
  await page.locator("#semanticExtractionError").getByText(
    "QA-injected semantic processor outage. Retry remains safe.",
  ).waitFor({ state: "visible", timeout: 7_500 });
  const extractionPending = {
    requestCount: queueRequests,
    ...await page.evaluate(() => window.__semanticExtractionPending),
  };
  const extractionRecovered = {
    label: await extractionSubmit.textContent(),
    disabled: await extractionSubmit.isDisabled(),
    busy: await extractionForm.getAttribute("aria-busy"),
    evidence: await extractionDialog.locator("[name='registrationEvidence']").inputValue(),
    error: await page.locator("#semanticExtractionError").textContent(),
  };
  assertPending(
    extractionPending,
    "Queueing extraction…",
    "semantic extraction",
  );
  assertRecovered(
    extractionRecovered,
    "Queue semantic extraction",
    "Browser QA inspected metres",
    "semantic extraction",
  );
  await extractionDialog.locator(".dialog-close").click();

  expectedFailureActive = false;
  await page.getByRole("button", { name: "Review candidates" }).click();
  const reviewDialog = page.locator("#semanticReviewDialog");
  await reviewDialog.waitFor({ state: "visible" });
  const candidate = reviewDialog.locator(`input[value="${candidateId}"]`);
  if (!await candidate.isChecked()) throw new Error("Review did not select the candidate by default.");
  await reviewDialog.locator("[name='decision']").selectOption("reject_all");
  if (!await candidate.isDisabled() || await candidate.isChecked()) {
    throw new Error("Reject-all did not visibly disable and clear candidate acceptance.");
  }
  await reviewDialog.locator("[name='decision']").selectOption("accept_selected");
  await candidate.check();
  await reviewDialog.locator("[name='note']").fill(
    "Browser QA checked the polygon against the registered point cloud before accepting the editable seed.",
  );
  const reviewForm = page.locator("#semanticReviewForm");
  const reviewSubmit = reviewForm.getByRole("button", { name: "Record semantic review" });
  expectedFailureActive = true;
  await reviewSubmit.evaluate((button) => {
    window.setTimeout(() => {
      const form = document.querySelector("#semanticReviewForm");
      const trigger = form?.querySelector("[type='submit']");
      window.__semanticReviewPending = {
        label: trigger?.textContent ?? null,
        disabled: trigger instanceof HTMLButtonElement ? trigger.disabled : null,
        busy: form?.getAttribute("aria-busy") ?? null,
        disabledControlCount: form?.querySelectorAll(
          "input:disabled, select:disabled, textarea:disabled, button:disabled",
        ).length ?? 0,
      };
    }, 100);
    button.click();
    button.click();
  });
  await page.locator("#semanticReviewError").getByText(
    "QA-injected semantic review outage. Retry remains safe.",
  ).waitFor({ state: "visible", timeout: 7_500 });
  const reviewPending = {
    requestCount: reviewRequests,
    ...await page.evaluate(() => window.__semanticReviewPending),
  };
  const reviewRecovered = {
    label: await reviewSubmit.textContent(),
    disabled: await reviewSubmit.isDisabled(),
    busy: await reviewForm.getAttribute("aria-busy"),
    candidateChecked: await candidate.isChecked(),
    note: await reviewDialog.locator("[name='note']").inputValue(),
    error: await page.locator("#semanticReviewError").textContent(),
  };
  assertPending(reviewPending, "Recording review…", "semantic review");
  assertRecovered(
    reviewRecovered,
    "Record semantic review",
    "Browser QA checked the polygon",
    "semantic review",
    "note",
  );
  if (!reviewRecovered.candidateChecked) {
    throw new Error("Semantic review did not retain the inspected candidate after failure.");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const viewport = await page.evaluate(() => {
    const dialog = document.querySelector("#semanticReviewDialog");
    const form = document.querySelector("#semanticReviewForm");
    const bounds = dialog?.getBoundingClientRect();
    return {
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dialogLeft: bounds?.left ?? null,
      dialogRight: bounds?.right ?? null,
      formClientWidth: form?.clientWidth ?? null,
      formScrollWidth: form?.scrollWidth ?? null,
    };
  });
  if (
    viewport.scrollWidth > viewport.width + 1 ||
    viewport.dialogLeft === null ||
    viewport.dialogRight === null ||
    viewport.dialogLeft < -1 ||
    viewport.dialogRight > viewport.width + 1 ||
    viewport.formClientWidth !== viewport.formScrollWidth
  ) {
    throw new Error(`Mobile horizontal overflow: ${JSON.stringify(viewport)}`);
  }
  await page.screenshot({
    path: "artifacts/qa/m23-semantic-extraction-staging.png",
    fullPage: true,
  });
  expectedFailureActive = false;
  if (unexpectedErrors.length) {
    throw new Error(`Unexpected browser errors:\n${unexpectedErrors.join("\n")}`);
  }
  process.stdout.write(`${JSON.stringify({
    desktop: {
      extractionPending,
      extractionRecovered,
      reviewPending,
      reviewRecovered,
      rejectAllClearedCandidate: true,
    },
    mobile: { viewport, noHorizontalOverflow: true },
    unexpectedErrors: 0,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}

function mockApiResponse(pathname, method) {
  const user = {
    userId: "22222222-2222-4222-8222-222222222222",
    organisationId: "11111111-1111-4111-8111-111111111111",
    email: "qa@whymelabs.com",
    displayName: "M23 QA",
    role: "platform_admin",
  };
  if (pathname === "/api/auth/session") return { body: { authenticated: true, user } };
  if (pathname === "/api/auth/organisations") {
    return {
      body: {
        currentOrganisationId: user.organisationId,
        organisations: [{
          id: user.organisationId,
          name: "WhyMe Labs QA",
          slug: "whymelabs-qa",
          role: "platform_admin",
          membershipUpdatedAt: now,
          current: true,
        }],
      },
    };
  }
  if (pathname === "/api/review/inbox") return { body: { projects: [] } };
  if (pathname === "/api/dashboard") {
    return { body: { activeProjects: 1, processingJobs: 0, hostedAssets: 1, hostedBytes: 1253, activeReleases: 0 } };
  }
  if (pathname === "/api/projects" && method === "GET") return { body: { projects: [project] } };
  if (pathname === `/api/projects/${projectId}`) {
    return {
      body: {
        project,
        versions: [{ id: versionId, version_number: 1, status: "QA_REQUIRED", created_at: now }],
        assets: [asset],
        jobs: [],
        releases: [],
        captureBundles: [],
      },
    };
  }
  if (pathname === `/api/projects/${projectId}/spatial`) return { body: spatial };
  if (pathname === "/api/jobs") return { body: { jobs: [] } };
  if (pathname === "/api/releases") return { body: { releases: [] } };
  if (pathname === "/api/hosting") {
    return {
      body: {
        paymentProviderConfigured: false,
        plans: [],
        subscriptions: [],
        checkouts: [],
        invoices: [],
        alerts: [],
        lifecycleRuns: [],
      },
    };
  }
  if (pathname === "/api/team") return { body: { members: [], invitations: [] } };
  if (pathname === "/api/team/identity-providers") return { body: { providers: [] } };
  if (pathname === "/api/capture-agents") return { body: { credentials: [] } };
  if (pathname === "/api/project-templates") return { body: { templates: [] } };
  if (pathname === "/api/project-views") return { body: { views: [] } };
  if (pathname === "/api/project-fields") return { body: { fields: [] } };
  if (pathname === "/api/uploads/recoverable") return { body: { uploads: [] } };
  return { status: 404, body: { error: `Unmocked QA route: ${method} ${pathname}` } };
}

function assertPending(actual, label, action) {
  if (
    actual.requestCount !== 1 ||
    actual.label !== label ||
    !actual.disabled ||
    actual.busy !== "true" ||
    actual.disabledControlCount < 2
  ) {
    throw new Error(`Invalid ${action} pending state: ${JSON.stringify(actual)}`);
  }
}

function assertRecovered(actual, label, retainedPrefix, action, valueKey = "evidence") {
  if (
    actual.label !== label ||
    actual.disabled ||
    actual.busy !== null ||
    typeof actual[valueKey] !== "string" ||
    !actual[valueKey].startsWith(retainedPrefix) ||
    !actual.error?.includes("Retry remains safe")
  ) {
    throw new Error(`Invalid ${action} recovery state: ${JSON.stringify(actual)}`);
  }
}
