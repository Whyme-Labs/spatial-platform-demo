import { chromium } from "playwright";

const baseUrl = process.env.SPATIAL_QA_ORIGIN
  ?? "https://spatial-studio-staging.swmengappdev.workers.dev";
const sourceOrganisationId = "11111111-1111-4111-8111-111111111111";
const targetOrganisationId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const projectId = "44444444-4444-4444-8444-444444444444";
const versionId = "55555555-5555-4555-8555-555555555555";
const assetId = "66666666-6666-4666-8666-666666666666";
const handoffId = "77777777-7777-4777-8777-777777777777";
const itemId = "88888888-8888-4888-8888-888888888888";
const targetProjectId = "99999999-9999-4999-8999-999999999999";
const now = "2026-07-28T06:45:00.000Z";

const project = {
  id: projectId,
  name: "M24 verified asset copy",
  slug: "m24-verified-asset-copy",
  status: "INGESTED",
  captureAdapter: "open-import",
  deliveryTemplate: "venue-navigator",
  notes: "Browser action-state acceptance fixture.",
  customerName: "WhyMe Labs",
  customFields: {},
  latestVersionId: versionId,
  latestVersionNumber: 1,
  activeReleaseSlug: null,
  updatedAt: now,
};
const preview = {
  valid: true,
  sourceSnapshotHash: "a".repeat(64),
  sourceOrganisation: {
    id: sourceOrganisationId,
    name: "WhyMe Labs Source",
  },
  targetOrganisation: {
    id: targetOrganisationId,
    name: "WhyMe Labs Destination",
    slug: "whymelabs-destination",
  },
  project: { id: projectId, name: project.name, targetStatus: "INGESTED" },
  summary: {
    versions: 1,
    assets: 1,
    bytes: 12_582_912,
    customFields: 0,
    fieldsToCreate: 0,
  },
  fieldsToCreate: [],
  conflicts: [],
  exclusions: {
    releases: true,
    jobs: true,
    reviews: true,
    memberships: true,
    billing: true,
    uploadSessions: true,
  },
  warnings: [
    "The source remains unchanged. Destination versions return to INGESTED.",
    "QA, approvals, releases, jobs, reviews, identity, billing, and lifecycle authority do not transfer.",
  ],
};

let handoff = makeHandoff("failed", 0, 0, "QA-injected source object outage. Retry remains safe.");
const requests = {
  preview: 0,
  commit: 0,
  refresh: 0,
  retry: 0,
  cancel: 0,
};
const requestBodies = {
  commit: [],
  retry: [],
  cancel: [],
};

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_EXECUTABLE_PATH
    ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  const page = await context.newPage();
  const unexpectedErrors = [];
  let expectedInjectedNetworkErrors = 0;
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (
      message.text() ===
        "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
    ) {
      expectedInjectedNetworkErrors += 1;
      return;
    }
    unexpectedErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => unexpectedErrors.push(`page: ${error.message}`));

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "POST" && url.pathname === "/api/projects/asset-handoffs/preview") {
      requests.preview += 1;
      if (requests.preview === 1) return delayedFailure(route, "QA-injected preview outage. Retry remains safe.");
      return json(route, 200, preview);
    }
    if (method === "POST" && url.pathname === "/api/projects/asset-handoffs") {
      requests.commit += 1;
      requestBodies.commit.push(JSON.parse(request.postData() ?? "{}"));
      if (requests.commit === 1) return delayedFailure(route, "QA-injected Queue dispatch outage. Retry remains safe.");
      handoff = makeHandoff("failed", 0, 0, "QA-injected source object outage. Retry remains safe.");
      return json(route, 202, { handoff });
    }
    if (method === "GET" && url.pathname === `/api/projects/asset-handoffs/${handoffId}`) {
      requests.refresh += 1;
      if (requests.refresh <= 3) {
        return delayedFailure(route, "QA-injected progress outage. Retry remains safe.");
      }
      return json(route, 200, { handoff });
    }
    if (method === "POST" && url.pathname === `/api/projects/asset-handoffs/${handoffId}/retry`) {
      requests.retry += 1;
      requestBodies.retry.push(JSON.parse(request.postData() ?? "{}"));
      if (requests.retry === 1) return delayedFailure(route, "QA-injected retry outage. Retry remains safe.");
      handoff = makeHandoff("copying", 0, 0, null);
      return json(route, 202, { handoffId, status: "queued", queuedItems: 1 });
    }
    if (method === "POST" && url.pathname === `/api/projects/asset-handoffs/${handoffId}/cancel`) {
      requests.cancel += 1;
      requestBodies.cancel.push(JSON.parse(request.postData() ?? "{}"));
      if (requests.cancel === 1) return delayedFailure(route, "QA-injected cleanup outage. Retry remains safe.");
      handoff = makeHandoff("cancelled", 0, 0, null);
      return json(route, 200, { handoff });
    }
    const response = mockApiResponse(url.pathname, method);
    return json(route, response.status ?? 200, response.body);
  });

  await page.goto(`${baseUrl}/studio.html#projects`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.getByRole("heading", { name: "From immutable source to approved spatial release." })
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("checkbox", { name: `Select ${project.name}` }).check();
  await page.getByRole("button", { name: "Portfolio tools" }).click();
  const dialog = page.locator("#portfolioToolsDialog");
  await dialog.waitFor({ state: "visible" });
  await dialog.locator("#assetHandoffTarget").selectOption(targetOrganisationId);

  const previewFailure = await exerciseFailure(
    page,
    "#previewAssetHandoff",
    "Checking immutable assets…",
    "QA-injected preview outage. Retry remains safe.",
    () => requests.preview,
  );
  await dialog.locator("#previewAssetHandoff").click();
  await dialog.locator("#commitAssetHandoff").waitFor({ state: "visible" });
  if (await dialog.locator("#commitAssetHandoff").isDisabled()) {
    throw new Error("Successful preview did not enable the verified copy action.");
  }

  page.once("dialog", (prompt) => prompt.accept());
  const commitFailure = await exerciseFailure(
    page,
    "#commitAssetHandoff",
    "Starting verified copy…",
    "QA-injected Queue dispatch outage. Retry remains safe.",
    () => requests.commit,
  );
  page.once("dialog", (prompt) => prompt.accept());
  await dialog.locator("#commitAssetHandoff").click();
  await dialog.locator("#retryAssetHandoff:not([disabled])").waitFor({ state: "visible" });
  if (
    requestBodies.commit.length !== 2 ||
    requestBodies.commit[0].clientOperationId !== requestBodies.commit[1].clientOperationId
  ) {
    throw new Error(`Commit did not retain its operation ID: ${JSON.stringify(requestBodies.commit)}`);
  }

  const refreshFailure = await exerciseFailure(
    page,
    "#refreshAssetHandoff",
    "Refreshing progress…",
    "QA-injected progress outage. Retry remains safe.",
    () => requests.refresh,
    3,
  );
  await dialog.locator("#refreshAssetHandoff").click();
  await dialog.locator("#retryAssetHandoff:not([disabled])").waitFor({ state: "visible" });

  const retryFailure = await exerciseFailure(
    page,
    "#retryAssetHandoff",
    "Requeueing failed items…",
    "QA-injected retry outage. Retry remains safe.",
    () => requests.retry,
  );
  await dialog.locator("#retryAssetHandoff").click();
  await dialog.locator("#cancelAssetHandoff:not([disabled])").waitFor({ state: "visible" });
  if (
    requestBodies.retry.length !== 2 ||
    requestBodies.retry[0].clientOperationId !== requestBodies.retry[1].clientOperationId
  ) {
    throw new Error(`Retry did not retain its operation ID: ${JSON.stringify(requestBodies.retry)}`);
  }

  page.once("dialog", (prompt) => prompt.accept());
  const cancelFailurePromise = exerciseFailure(
    page,
    "#cancelAssetHandoff",
    "Cancelling and cleaning up…",
    "QA-injected cleanup outage. Retry remains safe.",
    () => requests.cancel,
  );
  const cancelFailure = await cancelFailurePromise;
  page.once("dialog", (prompt) => prompt.accept());
  await dialog.locator("#cancelAssetHandoff").click();
  await dialog.locator("#assetHandoffPreview").getByText(/Copy cancelled/)
    .waitFor({ state: "visible" });
  if (
    requestBodies.cancel.length !== 2 ||
    requestBodies.cancel[0].clientOperationId !== requestBodies.cancel[1].clientOperationId
  ) {
    throw new Error(`Cancel did not retain its operation ID: ${JSON.stringify(requestBodies.cancel)}`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const viewport = await page.evaluate(() => {
    const dialog = document.querySelector("#portfolioToolsDialog");
    const section = document.querySelector("#assetHandoffSection");
    const bounds = dialog?.getBoundingClientRect();
    return {
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dialogLeft: bounds?.left ?? null,
      dialogRight: bounds?.right ?? null,
      sectionClientWidth: section?.clientWidth ?? null,
      sectionScrollWidth: section?.scrollWidth ?? null,
    };
  });
  if (
    viewport.scrollWidth > viewport.width + 1 ||
    viewport.dialogLeft === null ||
    viewport.dialogRight === null ||
    viewport.dialogLeft < -1 ||
    viewport.dialogRight > viewport.width + 1 ||
    viewport.sectionClientWidth !== viewport.sectionScrollWidth
  ) {
    throw new Error(`Mobile horizontal overflow: ${JSON.stringify(viewport)}`);
  }
  await page.locator("#assetHandoffSection").scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.screenshot({
    path: "artifacts/qa/m24-asset-handoff-staging.png",
    fullPage: false,
  });
  if (expectedInjectedNetworkErrors !== 7) {
    throw new Error(
      `Expected seven injected 503 console errors, received ${expectedInjectedNetworkErrors}.`,
    );
  }
  if (unexpectedErrors.length) {
    throw new Error(`Unexpected browser errors:\n${unexpectedErrors.join("\n")}`);
  }
  process.stdout.write(`${JSON.stringify({
    desktop: {
      previewFailure,
      commitFailure,
      refreshFailure,
      retryFailure,
      cancelFailure,
      stableOperationIds: true,
      finalStatus: handoff.status,
    },
    mobile: { viewport, noHorizontalOverflow: true },
    requestCounts: requests,
    expectedInjectedNetworkErrors,
    unexpectedErrors: 0,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}

function makeHandoff(status, copiedAssets, copiedBytes, errorMessage) {
  return {
    id: handoffId,
    sourceOrganisationId,
    targetOrganisationId,
    sourceProjectId: projectId,
    targetProjectId,
    sourceSnapshotHash: preview.sourceSnapshotHash,
    status,
    totalVersions: 1,
    totalAssets: 1,
    totalBytes: preview.summary.bytes,
    copiedAssets,
    copiedBytes,
    progressPercent: Math.round((copiedBytes / preview.summary.bytes) * 100),
    errorMessage,
    startedAt: now,
    completedAt: status === "completed" ? now : null,
    cancelledAt: status === "cancelled" ? now : null,
    updatedAt: now,
    items: [{
      id: itemId,
      sourceAssetId: assetId,
      targetAssetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      targetObjectKey: `${targetOrganisationId}/${targetProjectId}/${versionId}/scene.rad`,
      kind: "web",
      format: "rad",
      fileName: "indoor-scene.rad",
      mimeType: "application/octet-stream",
      sizeBytes: preview.summary.bytes,
      sha256: "b".repeat(64),
      status: status === "completed"
        ? "copied"
        : status === "cancelled"
          ? "cancelled"
          : status === "failed"
            ? "failed"
            : "copying",
      attemptCount: status === "failed" ? 3 : 1,
      errorMessage,
      copiedAt: status === "completed" ? now : null,
    }],
  };
}

async function exerciseFailure(
  page,
  selector,
  pendingLabel,
  errorText,
  counter,
  expectedRequestCount = 1,
) {
  const button = page.locator(selector);
  const before = counter();
  await button.evaluate((trigger) => {
    window.setTimeout(() => {
      const section = document.querySelector("#assetHandoffSection");
      window.__assetHandoffPending = {
        label: trigger.textContent,
        disabled: trigger.disabled,
        busy: trigger.getAttribute("aria-busy"),
        disabledControlCount: section?.querySelectorAll(
          "button:disabled, input:disabled, select:disabled, textarea:disabled",
        ).length ?? 0,
      };
    }, 100);
    trigger.click();
    trigger.click();
  });
  try {
    await page.locator("#assetHandoffError").getByText(errorText)
      .waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    const diagnostic = {
      selector,
      expectedError: errorText,
      requestCount: counter() - before,
      errorText: await page.locator("#assetHandoffError").textContent(),
      disabled: await button.isDisabled(),
      busy: await button.getAttribute("aria-busy"),
      progress: await page.locator("#assetHandoffProgress").textContent(),
    };
    throw new Error(`Failure-state diagnostic: ${JSON.stringify(diagnostic)}`, {
      cause: error,
    });
  }
  const pending = await page.evaluate(() => window.__assetHandoffPending);
  const recovered = {
    label: await button.textContent(),
    disabled: await button.isDisabled(),
    busy: await button.getAttribute("aria-busy"),
    target: await page.locator("#assetHandoffTarget").inputValue(),
    error: await page.locator("#assetHandoffError").textContent(),
    requestCount: counter() - before,
  };
  if (
    pending.label !== pendingLabel ||
    !pending.disabled ||
    pending.busy !== "true" ||
    pending.disabledControlCount < 6 ||
    recovered.busy !== null ||
    recovered.target !== targetOrganisationId ||
    !recovered.error?.includes("Retry remains safe") ||
    recovered.requestCount !== expectedRequestCount
  ) {
    throw new Error(`Invalid ${pendingLabel} failure state: ${JSON.stringify({ pending, recovered })}`);
  }
  return { pending, recovered };
}

function mockApiResponse(pathname, method) {
  const user = {
    userId,
    organisationId: sourceOrganisationId,
    email: "qa@whymelabs.com",
    displayName: "M24 QA",
    role: "platform_admin",
  };
  if (pathname === "/api/auth/session") return { body: { authenticated: true, user } };
  if (pathname === "/api/auth/organisations") {
    return {
      body: {
        currentOrganisationId: sourceOrganisationId,
        organisations: [
          {
            id: sourceOrganisationId,
            name: "WhyMe Labs Source",
            slug: "whymelabs-source",
            role: "platform_admin",
            membershipUpdatedAt: now,
            current: true,
          },
          {
            id: targetOrganisationId,
            name: "WhyMe Labs Destination",
            slug: "whymelabs-destination",
            role: "platform_admin",
            membershipUpdatedAt: now,
            current: false,
          },
        ],
      },
    };
  }
  if (pathname === "/api/review/inbox") return { body: { projects: [] } };
  if (pathname === "/api/dashboard") {
    return {
      body: {
        activeProjects: 1,
        processingJobs: 0,
        hostedAssets: 1,
        hostedBytes: preview.summary.bytes,
        activeReleases: 0,
      },
    };
  }
  if (pathname === "/api/projects" && method === "GET") return { body: { projects: [project] } };
  if (pathname.startsWith("/api/projects/asset-handoffs") && method === "GET") {
    return { body: { handoffs: [] } };
  }
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

async function delayedFailure(route, message) {
  await new Promise((resolve) => setTimeout(resolve, 1_400));
  return json(route, 503, { error: message });
}

function json(route, status, body) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
