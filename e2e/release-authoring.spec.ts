import { expect, test, type Page, type Route } from "@playwright/test";

const now = "2026-07-31T13:30:00.000Z";
const organisationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const auxiliaryQaVersionId = "99999999-9999-4999-8999-999999999999";

test("project rows open a dedicated project workspace with nested tools", async ({ page }) => {
  await mockApprovedProject(page, () => undefined);

  await page.goto("/studio.html#projects");
  const projectRow = page.locator(".project-row").filter({ hasText: "Corrected Spark room" });
  await expect(projectRow).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage", exact: true })).toHaveCount(0);

  await projectRow.click();

  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/publish$`));
  await expect(page.locator("#studioGrid")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Corrected Spark room", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review and publish", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}$`));
  await expect(page.getByRole("heading", { name: "Your walkable splat preview is ready.", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const heading = document.querySelector<HTMLElement>(".project-page-heading")?.getBoundingClientRect();
      const navigation = document.querySelector<HTMLElement>(".project-section-nav")?.getBoundingClientRect();
      return {
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
        navigationGap: heading && navigation ? navigation.top - heading.bottom : -1,
      };
    });
    expect(layout.documentOverflow, `${viewport.width}px project page overflows`).toBeLessThanOrEqual(1);
    expect(layout.navigationGap, `${viewport.width}px project navigation overlaps its heading`).toBeGreaterThan(0);
  }

  const processStep = page.locator(".project-journey-step").filter({ hasText: "Process" });
  await processStep.click();
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/process$`));
  await expect(page.locator('.project-journey-step[aria-current="step"]')).toHaveCount(1);
  await expect(processStep).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", {
    name: "Your walkable splat preview is ready.",
    exact: true,
  })).toBeFocused();

  await page.getByRole("button", { name: "Structure", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/structure$`));
  await expect(page.getByRole("heading", { name: "Review reconstructed rooms and openings" })).toBeVisible();
  await expect(page.locator("#projectTable")).toBeHidden();

  const privacyTab = page.getByRole("button", { name: "Privacy", exact: true });
  await privacyTab.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/privacy$`));
  await expect(privacyTab).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".project-journey-step").filter({ hasText: "Privacy" })).toHaveAttribute("aria-current", "step");
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/structure$`));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/privacy$`));

  await page.getByRole("button", { name: "Back to projects", exact: true }).click();
  await expect(page).toHaveURL(/#projects$/);
  await expect(page.locator("#projectTable")).toBeVisible();
});

test("privacy, walk testing, expert evidence, and publication are first-class project tasks", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, { auxiliaryQaVersion: true });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/privacy$`));
  await expect(page.getByRole("heading", {
    name: "Automated candidates, human decisions",
    exact: true,
  })).toBeVisible();

  await page.getByRole("button", { name: "Walk test", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/walk$`));
  await expect(page.getByRole("heading", { name: "Routes and movement runtime", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Expert", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/expert$`));
  await expect(page.getByRole("heading", {
    name: "Inspect technical evidence and recovery controls",
    exact: true,
  })).toBeVisible();

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/publish$`));
  await expect(page.getByRole("heading", { name: "Review and publish", exact: true })).toBeVisible();
});

test("privacy polling stays active on the Privacy stage until delayed evidence completes", async ({ page }) => {
  await page.addInitScript(() => {
    const originalSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const duration = timeout ?? 0;
      const acceleratePrivacyPolling = (window as Window & {
        __spatialAcceleratePrivacyPolling?: boolean;
      }).__spatialAcceleratePrivacyPolling;
      const effectiveDuration = acceleratePrivacyPolling && [1_500, 3_000].includes(duration)
        ? 25
        : duration;
      return originalSetTimeout(handler, effectiveDuration, ...args);
    }) as typeof window.setTimeout;
  });
  const polling = { spatialReads: 0 };
  await mockApprovedProject(page, () => undefined, { delayedPrivacyScan: polling });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await page.getByRole("button", { name: "Privacy", exact: true }).click();
  await page.getByRole("button", { name: "Run automated privacy scan", exact: true }).click();

  await expect(page.locator("#privacyAssuranceCard").getByText("Running", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { __spatialAcceleratePrivacyPolling?: boolean })
      .__spatialAcceleratePrivacyPolling = true;
  });
  await expect(page.locator("#privacyAssuranceCard").getByText("Completed", { exact: true })).toBeVisible();
  await expect(page.getByText(
    "No privacy candidates were detected. The completed scan remains part of the QA evidence.",
    { exact: true },
  )).toBeVisible();
  expect(polling.spatialReads).toBeGreaterThanOrEqual(3);
});

test("a novice can upload, inspect every stage, walk test, and publish using visible controls", async ({ page }) => {
  let publishedBody: Record<string, unknown> | null = null;
  await mockApprovedProject(page, (body) => {
    publishedBody = body;
  }, { captureIntake: true, noviceLifecycle: true });

  await page.goto("/studio.html#projects");
  await expect(page.getByText("Corrected Spark room", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Upload capture", exact: true }).click();
  const intake = page.locator("#newProjectDialog");
  await intake.getByLabel("Scene name", { exact: true }).fill("Corrected Spark room");
  await intake.getByRole("button", { name: "Continue to files", exact: true }).click();
  await intake.getByRole("combobox", {
    name: "Where did the observations come from?",
    exact: true,
  }).selectOption("third-party");
  await intake.getByRole("combobox", {
    name: "Which pipeline produced these files?",
    exact: true,
  }).selectOption("open-import");
  await intake.getByLabel("3D appearance file", { exact: true }).setInputFiles({
    name: "showroom.spz",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("portable-visual"),
  });
  await intake.getByLabel("Measurement geometry file", { exact: true }).setInputFiles({
    name: "showroom.e57",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("registered-geometry"),
  });
  const fallback = intake.getByRole("checkbox", {
    name: "I confirm both files came from the same unchanged capture coordinate system.",
    exact: true,
  });
  await expect(fallback).toBeVisible();
  await fallback.check();
  await intake.getByRole("button", { name: "Review processing plan", exact: true }).click();
  await expect(intake.getByText("✓ Build the walkable area", { exact: true })).toBeVisible();
  await intake.getByRole("button", { name: "Create and process scene", exact: true }).click();
  await expect(intake).toBeHidden();

  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.locator(".project-journey-step").filter({ hasText: "Process" }).click();
  await expect(page.getByRole("heading", {
    name: "Structural exceptions need review.",
    exact: true,
  })).toBeVisible();
  await page.getByRole("button", { name: "Structure", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review reconstructed rooms and openings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add structure or navigation obstacle", exact: true })).toHaveCount(0);
  await expect(page.locator("input[name='position']:visible")).toHaveCount(0);
  await expect(page.locator("input[name='bounds']:visible")).toHaveCount(0);
  await expect(page.locator("textarea[name='planJson']:visible")).toHaveCount(0);
  await page.getByRole("button", { name: "Correct and review plan", exact: true }).click();
  const floorplanReview = page.locator("#floorplanReviewDialog");
  await expect(floorplanReview.getByText("Expert: edit raw structured plan", { exact: true })).toBeVisible();
  await expect(floorplanReview.locator("textarea[name='planJson']")).toBeHidden();
  await floorplanReview.getByLabel("Evidence note", { exact: true }).fill(
    "Checked room outlines, wall runs, and the registered source overlay.",
  );
  await floorplanReview.getByRole("button", { name: "Save operator decision", exact: true }).click();
  await expect(floorplanReview).toBeHidden();

  await page.getByRole("button", { name: "Privacy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Automated candidates, human decisions", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review candidate", exact: true }).click();
  const privacyReview = page.locator("#privacyCandidateDialog");
  await privacyReview.getByLabel("Evidence note", { exact: true }).fill(
    "Verified as a reflection in the poster frame.",
  );
  await privacyReview.getByRole("button", { name: "Record privacy decision", exact: true }).click();
  await expect(privacyReview).toBeHidden();
  await expect(page.getByText("Privacy candidate dismissed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Walk test", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Walk test", exact: true })).toBeVisible();
  await expect(page.getByLabel("Recast cell size", { exact: true })).toBeHidden();
  await expect(page.getByText(
    "0 unreachable authored destinations · 0 failed physical routes in the approved processor receipt.",
    { exact: true },
  )).toBeVisible();
  const walkFrame = page.frameLocator("#walkTestPreview");
  await walkFrame.getByRole("button", { name: "Stand at safe start", exact: true }).click();
  const setStartingPosition = page.getByRole("button", {
    name: "Set test start here",
    exact: true,
  });
  await expect(setStartingPosition).toBeEnabled();
  await setStartingPosition.click();
  await expect(page.locator("#walkTestStatus")).toContainText("Starting point set");
  await walkFrame.getByRole("button", { name: "Walk to destination", exact: true }).click();
  const completeWalkTest = page.getByRole("button", { name: "Complete walk test", exact: true });
  await expect(completeWalkTest).toBeEnabled();
  await completeWalkTest.click();
  await expect(page.getByText("Walk test completed and recorded", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Review privacy and approve", exact: true }).click();
  const qa = page.locator("#qaDialog");
  await expect(qa.getByText("Privacy evidence is ready", { exact: true })).toBeVisible();
  await expect(qa.locator("select[name='visualGrade'] option")).toHaveText([
    "A — Client-ready: no visible defects at the approved framing and quality preset",
    "B — Acceptable: minor defects do not distract from the intended experience",
    "C — Conditional: visible defects require an explicit acceptance note before release",
  ]);
  await qa.getByRole("checkbox", {
    name: "I confirm privacy and publication review is approved.",
    exact: true,
  }).check();
  await qa.getByLabel("QA notes", { exact: true }).fill("Completed the visible novice review journey.");
  await qa.getByRole("button", { name: "Approve immutable version", exact: true }).click();

  const release = page.locator("#releaseDialog");
  await expect(release).toBeVisible();
  await expect(release.locator("select[name='qualityPreset']")).toBeVisible();
  await expect(release.locator("select[name='qualityPreset']")).toHaveValue("standard");
  await release.locator("select[name='accessPolicy']").selectOption("public");
  await expect(release.locator("input[name='splatBudgetMillions']")).toBeHidden();
  await expect(release.locator('textarea[name="measurementDisclaimer"]')).toHaveValue(
    "This visual experience is not a certified survey and must not be relied upon for construction or boundary decisions.",
  );
  await release.getByRole("button", { name: "Publish release", exact: true }).click();
  // Open exposure is a deliberate act: public requires an explicit
  // confirmation before the publish request fires.
  const openExposureConfirmation = page.locator("#publicationConfirmationDialog");
  await expect(openExposureConfirmation.getByText("Publish publicly?", { exact: true })).toBeVisible();
  await openExposureConfirmation
    .getByRole("button", { name: "Make it public", exact: true }).click();
  await expect.poll(() => publishedBody).not.toBeNull();
  expect(publishedBody).toMatchObject({
    accessPolicy: "public",
    viewerConfig: {
      title: "Corrected Spark room",
      defaultMovementMode: "walk",
    },
  });
});

test("QA recovery opens the visible privacy task", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, { auxiliaryQaVersion: true });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Review privacy and approve", exact: true }).click();
  await page.getByRole("button", { name: "Open privacy evidence workspace", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/privacy$`));
  await expect(page.locator("#privacyAssuranceCard")).toBeVisible();
});

test("comparison leaves Privacy and becomes its own stage only with a comparison-ready pair", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, {
    auxiliaryQaVersion: true,
    comparisonReady: true,
  });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await expect(page.getByRole("button", { name: "Compare", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Privacy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Automated candidates, human decisions", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Compare immutable versions", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/compare$`));
  await expect(page.getByRole("heading", { name: "Compare immutable versions", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Visual version comparison", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Compare scenes side by side", exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Automated candidates, human decisions", exact: true })).toHaveCount(0);
});

test("a one-version project keeps comparison in Expert and canonicalizes a Compare deep link", async ({ page }) => {
  await mockApprovedProject(page, () => undefined);

  await page.goto(`/studio.html#project/${projectId}/compare`);
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/expert$`));
  await expect(page.getByRole("button", { name: "Compare", exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Compare immutable versions", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Compare scenes side by side", exact: true })).toBeDisabled();
  await expect(page.getByText(
    "Two versions need reviewed metric structure before authored geometry can be compared.",
    { exact: true },
  )).toBeVisible();
});

test("publication keeps technical overrides behind an expert disclosure", async ({ page }) => {
  await mockApprovedProject(page, () => undefined);

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Configure publication", exact: true }).click();

  const dialog = page.locator("#releaseDialog");
  await expect(dialog.getByLabel("Public slug", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Use current view", exact: true })).toBeVisible();
  await expect(dialog.locator("#releaseCameraPreview")).toBeVisible();
  await expect(dialog.getByLabel("Splat budget (millions)", { exact: true })).toBeHidden();
  await expect(dialog.getByLabel("Starting camera position (x, y, z)", { exact: true })).toBeHidden();
  await expect(dialog.getByText("Expert settings", { exact: true })).toBeVisible();
});

const capturedStartingViewFrame = {
  schemaVersion: "starting-view-quality-v1",
  capturedAt: "2026-08-19T08:00:00.000Z",
  frame: { width: 1280, height: 720, sampledPixels: 57_600 },
};

test("a captured starting view publishes with its measured quality receipt", async ({ page }) => {
  let publishedBody: Record<string, unknown> | null = null;
  const goodFrameQuality = {
    ...capturedStartingViewFrame,
    nearBlackFraction: 0.21,
    meanLuminance: 0.3,
    renderedCoverageFraction: 0.74,
  };
  await mockApprovedProject(page, (body) => {
    publishedBody = body;
  }, { startingViewFrameQuality: goodFrameQuality });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Publish shareable URL", exact: true }).click();

  const dialog = page.locator("#releaseDialog");
  const useCurrentView = dialog.getByRole("button", { name: "Use current view", exact: true });
  await page.frameLocator("#releaseCameraPreview")
    .getByRole("button", { name: "Stand at safe start", exact: true }).click();
  await expect(useCurrentView).toBeEnabled();
  await useCurrentView.click();
  await expect(page.locator("#releaseCameraStatus")).toContainText("Starting view captured");
  await expect(page.locator("#releaseError")).toHaveText("");

  await dialog.getByRole("button", { name: "Publish release", exact: true }).click();
  await page.locator("#publicationConfirmationDialog")
    .getByRole("button", { name: "Make it public", exact: true }).click();
  await expect.poll(() => publishedBody).not.toBeNull();
  expect(publishedBody).toMatchObject({
    startingViewQuality: {
      ...goodFrameQuality,
      cameraPose: {
        position: [1, 1.6, 2],
        target: [1, 1.6, 1],
        up: [0, 1, 0],
        fovDegrees: 58,
      },
    },
    viewerConfig: {
      initialCamera: {
        position: [1, 1.6, 2],
        target: [1, 1.6, 1],
      },
    },
  });
});

test("a mostly-black captured starting view warns at capture and surfaces the publish block", async ({
  page,
}) => {
  let publishedBody: Record<string, unknown> | null = null;
  const blockedMessage =
    "The starting view frames mostly unreconstructed space (97% near-black, limit 85%) — move to a view with visible content, then capture it again";
  await mockApprovedProject(page, (body) => {
    publishedBody = body;
  }, {
    startingViewFrameQuality: {
      ...capturedStartingViewFrame,
      nearBlackFraction: 0.97,
      meanLuminance: 0.042,
      renderedCoverageFraction: 0.02,
    },
    publishResult: {
      status: 422,
      body: {
        error: "Request cannot be applied",
        details: { startingViewQuality: [blockedMessage] },
      },
    },
  });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Publish shareable URL", exact: true }).click();

  const dialog = page.locator("#releaseDialog");
  const useCurrentView = dialog.getByRole("button", { name: "Use current view", exact: true });
  await page.frameLocator("#releaseCameraPreview")
    .getByRole("button", { name: "Stand at safe start", exact: true }).click();
  await expect(useCurrentView).toBeEnabled();
  await useCurrentView.click();

  // The dialog pre-empts the worker gate at capture time…
  await expect(page.locator("#releaseError")).toContainText("mostly unreconstructed space");
  await expect(page.locator("#releaseCameraStatus")).toContainText("mostly unreconstructed space");

  // …and the worker rejection lands in the same error element on submit.
  await dialog.getByRole("button", { name: "Publish release", exact: true }).click();
  await page.locator("#publicationConfirmationDialog")
    .getByRole("button", { name: "Make it public", exact: true }).click();
  await expect.poll(() => publishedBody).not.toBeNull();
  expect(publishedBody).toMatchObject({
    startingViewQuality: { nearBlackFraction: 0.97 },
  });
  await expect(dialog).toBeVisible();
  await expect(page.locator("#releaseError")).toContainText("mostly unreconstructed space");
});

test("release authoring resets project-specific fields and submits scene rotation", async ({ page }) => {
  let publishedBody: Record<string, unknown> | null = null;
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await mockApprovedProject(page, (body) => {
    publishedBody = body;
  });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Corrected Spark room" })).toBeVisible();

  const openRelease = page.getByRole("button", { name: "Publish shareable URL", exact: true });
  await openRelease.click();
  const dialog = page.locator("#releaseDialog");
  await dialog.getByText("Expert settings", { exact: true }).click();
  await dialog.getByRole("textbox", { name: "Subtitle", exact: true }).fill("Stale project copy");
  await dialog.locator("input[name='initialCameraPosition']").fill("1, 2, 3");
  await dialog.locator("input[name='sceneRotationZ']").fill("180");
  await dialog.getByRole("button", { name: "×", exact: true }).click();

  await openRelease.click();
  await expect(dialog.getByRole("textbox", { name: "Subtitle", exact: true })).toHaveValue("");
  await expect(dialog.locator("input[name='initialCameraPosition']")).toHaveValue("");
  await expect(dialog.locator("input[name='sceneRotationZ']")).toHaveValue("0");

  await dialog.getByText("Expert settings", { exact: true }).click();
  await dialog.locator("input[name='sceneRotationZ']").fill("361");
  expect(pageErrors).toEqual([]);
  await dialog.locator("input[name='sceneRotationZ']").fill("180");
  await dialog.getByRole("button", { name: "Publish release", exact: true }).click();
  await page.locator("#publicationConfirmationDialog")
    .getByRole("button", { name: "Make it public", exact: true }).click();
  await expect.poll(() => publishedBody).not.toBeNull();
  expect(publishedBody).toMatchObject({
    viewerConfig: {
      title: "Corrected Spark room",
      sceneRotationDegrees: [0, 0, 180],
    },
  });
  expect(pageErrors).toEqual([]);
});

test("release authoring loads spatial guards before enabling visual rotation", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, { authoredSpatial: true });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Publish shareable URL", exact: true }).click();

  const dialog = page.locator("#releaseDialog");
  await expect(dialog.locator("input[name='sceneRotationZ']")).toBeDisabled();
  await expect(dialog.locator("#sceneRotationNote")).toContainText(
    "this version has authored spatial geometry",
  );
});

test("release authoring makes visual rotation and reviewed transforms mutually exclusive", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, { reviewedTransform: true });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Publish shareable URL", exact: true }).click();

  const dialog = page.locator("#releaseDialog");
  await dialog.getByText("Expert settings", { exact: true }).click();
  const applyTransform = dialog.getByRole("checkbox", {
    name: "Apply authored source-to-world transform",
    exact: true,
  });
  const rotationZ = dialog.locator("input[name='sceneRotationZ']");
  await expect(applyTransform).toBeChecked();
  await expect(rotationZ).toBeDisabled();

  await applyTransform.uncheck();
  await expect(rotationZ).toBeEnabled();
  await rotationZ.fill("180");
  await expect(applyTransform).not.toBeChecked();
  await expect(applyTransform).toBeDisabled();

  await rotationZ.fill("0");
  await expect(applyTransform).toBeEnabled();
  await applyTransform.check();
  await expect(rotationZ).toHaveValue("0");
  await expect(rotationZ).toBeDisabled();
});

test("an auxiliary QA version does not hide publishing for the approved visual version", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, { auxiliaryQaVersion: true });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review privacy and approve", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish shareable URL", exact: true }).click();
  await expect(page.locator("#releaseDialog")).toBeVisible();
});

test("processed splats stay blocked until their walking map is approved", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, { previewReady: false });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/structure$`));
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Registered structural geometry is required.", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open private preview", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy preview URL", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Complete walking map", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh processing status", exact: true })).toBeVisible();
  await expect(page.getByText(
    "The visual is preserved, but it has no registered structural source from which collision and walking proof can be generated safely.",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByText("Optional editing, evidence, and delivery tools", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Structure", exact: true }).click();
  await expect(page.getByRole("heading", {
    name: "Metric capture → operator revision → portable drawings",
    exact: true,
  })).toBeVisible();
  await expect(page.getByText(
    "A verified metric point cloud is required; visual-only Gaussian splats are not measurement evidence.",
    { exact: true },
  )).toBeVisible();
});

test("walking evidence builds automatically without exposing routine authoring", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, {
    previewReady: false,
    walkingState: "building",
  });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/process$`));
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Building and verifying the walking map.", exact: true })).toBeVisible();
  await expect(page.getByText(/No routine navigation setup is required\.$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh walking-map progress", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review structural exceptions", exact: true })).toHaveCount(0);
});

test("automatic reconstruction exposes only unresolved structural exceptions", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, {
    previewReady: false,
    walkingState: "exception",
  });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/structure$`));
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Structural exceptions need review.", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review structural exceptions", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete walking map", exact: true })).toHaveCount(0);
});

test("multi-level floor-plan review shows every level and vertical connector", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, { multiLevelFloorplan: true });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Edit scene", exact: true }).click();
  await expect(page.getByRole("heading", {
    name: "Inspect and correct the reconstructed structure in place",
  })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark room", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark doorway", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark window", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark stairs", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark ramp", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove structure", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo staged change", exact: true })).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Approve structure and build walking map",
    exact: true,
  })).toBeEnabled();
  await expect(page.getByText("Passable doorway", { exact: true })).toBeVisible();
  await expect(page.getByText("Blocked window", { exact: true })).toBeVisible();
  const toolbar = page.locator(".scene-authoring-toolbar");
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await toolbar.scrollIntoViewIfNeeded();
    await expect.poll(() => toolbar.evaluate((element) =>
      element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await expect(page.getByText("2 levels", { exact: true })).toBeVisible();
  await expect(page.getByText("1 stair/ramp connector", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Correct and review plan", exact: true }).click();

  const dialog = page.locator("#floorplanReviewDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".floorplan-level-preview")).toHaveCount(2);
  await expect(dialog.getByRole("img", { name: "Ground floor floor-plan preview" })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Level 2 floor-plan preview" })).toBeVisible();
  await expect(dialog.locator(".preview-connector")).toHaveCount(2);
  await expect(dialog.locator("#floorplanReviewValidation")).toHaveText(
    "2 levels · 2 rooms · 8 walls · 0 openings · 1 stair/ramp connectors",
  );
});

test("navigation authoring actions and review rows never touch or overlap", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, { navigationBuildHistory: true });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Edit scene", exact: true }).click();
  await page.getByRole("button", { name: "Walk test", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Routes and movement runtime" })).toBeVisible();

  const card = page.locator("article.workspace-card-large").filter({
    has: page.getByRole("heading", { name: "Routes and movement runtime" }),
  });
  const reviewCard = page.locator("article.workspace-card-large").filter({
    has: page.getByRole("heading", { name: "Build receipts and operator review" }),
  });
  const createRoute = card.getByRole("button", { name: "Create guided route", exact: true });
  const tuneNavigation = card.getByRole("button", { name: "Walking profile", exact: true });
  const authorTraversal = card.getByRole("button", { name: "Author vertical traversal", exact: true });
  const buildNavigation = card.getByRole("button", { name: "Build verified navigation", exact: true });
  const firstApprove = reviewCard.getByRole("button", { name: "Approve navigation", exact: true }).first();
  const firstReject = reviewCard.getByRole("button", { name: "Reject", exact: true }).first();
  const buildEvidence = reviewCard.getByText("Inspect build evidence", { exact: true }).first();
  await expect(buildEvidence).toBeVisible();
  await buildEvidence.click();
  await expect(reviewCard.getByText('"schemaVersion": "spatial-navigation-v9"').first()).toBeVisible();

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await card.scrollIntoViewIfNeeded();
    await firstApprove.focus();

    const boxes = await Promise.all([
      createRoute.boundingBox(),
      tuneNavigation.boundingBox(),
      authorTraversal.boundingBox(),
      buildNavigation.boundingBox(),
      firstApprove.boundingBox(),
      firstReject.boundingBox(),
      card.boundingBox(),
      reviewCard.boundingBox(),
    ]);
    const [createBox, tuneBox, traversalBox, buildBox, approveBox, rejectBox, routesCardBox, reviewCardBox] = boxes;
    if (
      !createBox || !tuneBox || !traversalBox || !buildBox || !approveBox || !rejectBox ||
      !routesCardBox || !reviewCardBox
    ) {
      throw new Error(`${viewport.width}px navigation controls are not measurable`);
    }

    for (const [label, gap] of [
      ["create/tune", tuneBox.y - (createBox.y + createBox.height)],
      ["tune/traversal", traversalBox.y - (tuneBox.y + tuneBox.height)],
      ["traversal/build", buildBox.y - (traversalBox.y + traversalBox.height)],
    ] as const) {
      expect(gap, `${viewport.width}px ${label} controls overlap`).toBeGreaterThan(0);
    }

    // Authoring and review now live in sibling cards: they may sit side by side or
    // stack, but they must never overlap and the review pair must stay separated.
    const cardsSeparated = reviewCardBox.y >= routesCardBox.y + routesCardBox.height ||
      reviewCardBox.x >= routesCardBox.x + routesCardBox.width ||
      routesCardBox.y >= reviewCardBox.y + reviewCardBox.height ||
      routesCardBox.x >= reviewCardBox.x + reviewCardBox.width;
    expect(cardsSeparated, `${viewport.width}px authoring and review cards overlap`).toBe(true);
    const reviewPairSeparated = rejectBox.x >= approveBox.x + approveBox.width ||
      rejectBox.y >= approveBox.y + approveBox.height;
    expect(reviewPairSeparated, `${viewport.width}px approve and reject overlap`).toBe(true);

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(horizontalOverflow, `${viewport.width}px page overflows horizontally`).toBeLessThanOrEqual(1);
    expect(approveBox.x, `${viewport.width}px approval starts off-canvas`).toBeGreaterThanOrEqual(0);
    expect(
      rejectBox.x + rejectBox.width,
      `${viewport.width}px rejection ends off-canvas`,
    ).toBeLessThanOrEqual(viewport.width + 1);
  }
});

test("vertical traversal authoring offers only capture-qualified evidence", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, { qualifiedTraversalEvidence: true });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Edit scene", exact: true }).click();
  await page.getByRole("button", { name: "Walk test", exact: true }).click();
  await page.getByRole("button", { name: "Author vertical traversal", exact: true }).click();

  const dialog = page.locator("#navigationTraversalDialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#navigationTraversalEvidenceAsset")).toHaveValue(
    "23232323-2323-4232-8232-232323232323|24242424-2424-4242-8242-242424242424",
  );
  await expect(dialog.locator("#navigationTraversalEvidenceAsset option")).toHaveText(
    /lift-proof\.ply · XGRIDS Lixel \/ LCC capture · registration cccccccccccc…/,
  );
});

async function mockApprovedProject(
  page: Page,
  onPublish: (body: Record<string, unknown>) => void,
  options: {
    authoredSpatial?: boolean;
    reviewedTransform?: boolean;
    auxiliaryQaVersion?: boolean;
    comparisonReady?: boolean;
    navigationBuildHistory?: boolean;
    multiLevelFloorplan?: boolean;
    qualifiedTraversalEvidence?: boolean;
    previewReady?: boolean;
    walkingState?: "building" | "exception";
    captureIntake?: boolean;
    noviceLifecycle?: boolean;
    delayedPrivacyScan?: { spatialReads: number };
    startingViewFrameQuality?: Record<string, unknown>;
    publishResult?: { status: number; body: Record<string, unknown> };
  } = {},
): Promise<void> {
  let projectCreated = !options.captureIntake;
  let noviceStage: "structure" | "privacy" | "approved" = options.noviceLifecycle
    ? "structure"
    : "approved";
  let novicePrivacyResolved = false;
  let noviceWalkTestCompleted = !options.noviceLifecycle;
  let delayedPrivacyScanStatus: "RUNNING" | "COMPLETED" | null = null;
  const uploads = new Map<string, {
    assetId: string;
    fileName: string;
    format: string;
    purpose: string;
    sizeBytes: number;
  }>();
  const project = {
    id: projectId,
    name: "Corrected Spark room",
    slug: "corrected-spark-room",
    status: options.noviceLifecycle ? "QA_REQUIRED" : "APPROVED",
    captureAdapter: "open-import",
    deliveryTemplate: "Property showcase",
    notes: "Visual-only Gaussian fixture.",
    customerName: "WhyMe Labs",
    customFields: {},
    latestVersionId: options.auxiliaryQaVersion ? auxiliaryQaVersionId : versionId,
    latestVersionNumber: options.auxiliaryQaVersion ? 2 : 1,
    activeReleaseSlug: null,
    workflowPolicy: {
      schemaVersion: "project-workflow-policy-v1",
      privacyReview: "strict",
      publication: "public-after-approval",
      navigation: "visitor-walk",
      requiredFiles: "visual-and-registered-geometry",
      structureWorkflow: "automatic-extract-review",
      navigationClearance: "approved-scene",
      measurement: "hidden",
      hosting: "managed-optional",
      quality: "standard",
    },
    updatedAt: now,
  };
  await page.route("**/renderer/index.html**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <button id="start">Stand at safe start</button>
        <button id="destination">Walk to destination</button>
        <script>
          let pose = null;
          const send = (position, target) => {
            pose = { position, target, up: [0, 1, 0], fovDegrees: 58 };
            parent.postMessage({
              source: "spatial-spark",
              type: "camera-update",
              cameraPose: pose,
            }, location.origin);
          };
          document.querySelector("#start").addEventListener("click", () => send([1, 1.6, 2], [1, 1.6, 1]));
          document.querySelector("#destination").addEventListener("click", () => send([2, 1.6, 2], [2, 1.6, 1]));
          window.addEventListener("message", (event) => {
            const data = event.data;
            if (!data || data.source !== "spatial-host" || data.type !== "capture-camera") return;
            parent.postMessage({
              source: "spatial-spark",
              type: "camera",
              requestId: data.requestId,
              cameraPose: pose ?? { position: [1, 1.6, 2], target: [1, 1.6, 1], up: [0, 1, 0], fovDegrees: 58 },
              frameQuality: ${JSON.stringify(options.startingViewFrameQuality ?? null)},
            }, location.origin);
          });
        </script>
      </body></html>`,
    });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const user = {
      userId: "44444444-4444-4444-8444-444444444444",
      organisationId,
      email: "qa@whymelabs.com",
      displayName: "Release QA",
      role: "platform_admin",
    };

    if (path === "/api/auth/session") return json(route, 200, { authenticated: true, user });
    if (path === "/api/auth/organisations") {
      return json(route, 200, {
        currentOrganisationId: organisationId,
        organisations: [{
          id: organisationId,
          name: "WhyMe Labs",
          slug: "whymelabs",
          role: "platform_admin",
          membershipUpdatedAt: now,
          current: true,
        }],
      });
    }
    if (path === "/api/dashboard") {
      return json(route, 200, {
        activeProjects: projectCreated ? 1 : 0,
        processingJobs: 0,
        hostedAssets: 1,
        hostedBytes: 73_400_000,
        activeReleases: 0,
      });
    }
    if (path === "/api/projects" && method === "POST" && options.captureIntake) {
      projectCreated = true;
      return json(route, 201, { project });
    }
    if (path === "/api/projects" && method === "GET") {
      return json(route, 200, { projects: projectCreated ? [project] : [] });
    }
    if (
      options.delayedPrivacyScan && method === "POST" &&
      path === `/api/projects/${projectId}/privacy-scans`
    ) {
      delayedPrivacyScanStatus = "RUNNING";
      return json(route, 202, {
        scan: {
          id: "60606060-6060-4060-8060-606060606060",
          status: "QUEUED",
        },
      });
    }
    if (path === `/api/projects/${projectId}/uploads` && method === "POST" && options.captureIntake) {
      const body = request.postDataJSON() as {
        fileName: string;
        format: string;
        purpose: string;
        sizeBytes: number;
      };
      const uploadId = crypto.randomUUID();
      const assetId = crypto.randomUUID();
      uploads.set(uploadId, { assetId, ...body });
      return json(route, 201, {
        upload: {
          id: uploadId,
          versionId,
          assetId,
          purpose: body.purpose,
          partSizeBytes: body.sizeBytes,
          expectedSizeBytes: body.sizeBytes,
          expiresAt: "2026-08-17T13:30:00.000Z",
          status: "OPEN",
        },
      });
    }
    const uploadPart = path.match(/^\/api\/uploads\/([^/]+)\/parts\/(\d+)$/);
    if (uploadPart && method === "PUT" && options.captureIntake) {
      return json(route, 200, {
        part: { partNumber: Number(uploadPart[2]), etag: `etag-${uploadPart[1]}` },
      });
    }
    const uploadCompletion = path.match(/^\/api\/uploads\/([^/]+)\/complete$/);
    if (uploadCompletion && method === "POST" && options.captureIntake) {
      const upload = uploads.get(uploadCompletion[1]!);
      if (!upload) return json(route, 404, { error: "Unknown upload fixture" });
      return json(route, 200, {
        asset: {
          id: upload.assetId,
          versionId,
          kind: upload.purpose === "metric_point_cloud" ? "pointcloud" : "master",
          purpose: upload.purpose,
          sizeBytes: upload.sizeBytes,
          integrityStatus: "pending",
        },
        job: {
          id: crypto.randomUUID(),
          type: upload.purpose === "metric_point_cloud" ? "asset.evidence-validate" : "asset.validate",
          state: "QUEUED",
        },
      });
    }
    if (
      options.noviceLifecycle && method === "POST" &&
      path === `/api/projects/${projectId}/spatial/floorplan-extractions/14141414-1414-4414-8414-141414141414/review`
    ) {
      noviceStage = "privacy";
      return json(route, 200, {
        extraction: { id: "14141414-1414-4414-8414-141414141414", status: "REVIEWED" },
        revision: { id: "62626262-6262-4262-8262-626262626262", status: "approved" },
      });
    }
    if (
      options.noviceLifecycle && method === "PATCH" &&
      path === `/api/projects/${projectId}/privacy-candidates/61616161-6161-4161-8161-616161616161`
    ) {
      novicePrivacyResolved = true;
      return json(route, 200, {
        candidate: { id: "61616161-6161-4161-8161-616161616161", status: "dismissed" },
      });
    }
    if (
      options.noviceLifecycle && method === "POST" &&
      path === `/api/versions/${versionId}/approve`
    ) {
      noviceStage = "approved";
      project.status = "APPROVED";
      return json(route, 200, { version: { id: versionId, status: "APPROVED" } });
    }
    if (
      options.noviceLifecycle && method === "POST" &&
      path === `/api/projects/${projectId}/spatial/navigation-builds/dddddddd-dddd-4ddd-8ddd-dddddddddddd/walk-tests`
    ) {
      noviceWalkTestCompleted = true;
      return json(route, 201, {
        walkTest: {
          id: "73737373-7373-4373-8373-737373737373",
          navigation_build_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          completed_at: now,
        },
      });
    }
    if (path === `/api/projects/${projectId}` && method === "GET") {
      return json(route, 200, {
        project,
        comparisonReadiness: comparisonReadinessFixture(Boolean(options.comparisonReady)),
        versions: [
          ...(options.auxiliaryQaVersion
            ? [{
              id: auxiliaryQaVersionId,
              version_number: 2,
              status: "QA_REQUIRED",
              created_at: "2026-07-31T14:00:00.000Z",
            }]
            : []),
          {
            id: versionId,
            version_number: 1,
            status: options.noviceLifecycle && noviceStage !== "approved" ? "QA_REQUIRED" : "APPROVED",
            manifest_json: noviceStage === "approved"
              ? JSON.stringify({ measurementGrade: "visual-only" })
              : null,
            created_at: now,
          },
        ],
        assets: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            version_id: versionId,
            kind: "web",
            format: "rad",
            file_name: "scene.rad",
            size_bytes: 73_400_000,
            integrity_status: "verified",
          },
          ...(options.noviceLifecycle || options.delayedPrivacyScan
            ? [
              {
                id: "57575757-5757-4575-8575-575757575757",
                version_id: versionId,
                kind: "poster",
                format: "png",
                file_name: "private-evidence.png",
                size_bytes: 4096,
                integrity_status: "verified",
              },
              {
                id: "58585858-5858-4585-8585-585858585858",
                version_id: versionId,
                kind: "pointcloud",
                format: "e57",
                file_name: "showroom.e57",
                size_bytes: 8192,
                integrity_status: "verified",
              },
            ]
            : []),
          ...(options.navigationBuildHistory
            ? [{
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              version_id: versionId,
              kind: "collision",
              format: "glb",
              file_name: "collision.glb",
              size_bytes: 4096,
              integrity_status: "verified",
            }]
            : []),
          ...(options.multiLevelFloorplan
            ? [{
              id: "13131313-1313-4313-8313-131313131313",
              version_id: versionId,
              kind: "pointcloud",
              format: "ply",
              file_name: "registered-room.ply",
              size_bytes: 8192,
              integrity_status: "verified",
              sha256: "a".repeat(64),
            }]
            : []),
          ...(options.qualifiedTraversalEvidence
            ? [{
              id: "24242424-2424-4242-8242-242424242424",
              version_id: versionId,
              kind: "pointcloud",
              format: "ply",
              file_name: "lift-proof.ply",
              size_bytes: 16384,
              integrity_status: "verified",
              sha256: "a".repeat(64),
            }]
            : []),
          ...(options.walkingState
            ? [{
              id: "34343434-3434-4434-8434-343434343434",
              version_id: versionId,
              kind: "pointcloud",
              format: "ply",
              file_name: "registered-building.ply",
              size_bytes: 32768,
              integrity_status: "verified",
              sha256: "c".repeat(64),
            }]
            : []),
        ],
        jobs: options.noviceLifecycle && noviceStage === "structure"
          ? [{
            id: "59595959-5959-4595-8595-595959595959",
            version_id: versionId,
            job_type: "floorplan.extract-v1",
            state: "SUCCEEDED",
            progress: 100,
            progress_message: "Structural proposal ready",
            created_at: now,
          }]
          : options.walkingState === "building"
          ? [{
            id: "45454545-4545-4454-8454-454545454545",
            version_id: versionId,
            job_type: "floorplan.extract-v1",
            state: "RUNNING",
            progress: 56,
            progress_message: "Classifying structural surfaces",
          }]
          : options.walkingState === "exception"
            ? [{
              id: "56565656-5656-4565-8565-565656565656",
              version_id: versionId,
              job_type: "floorplan.extract-v1",
              state: "SUCCEEDED",
              progress: 100,
              progress_message: "Structural proposal ready",
            }]
            : [],
        releases: [],
        captureBundles: options.qualifiedTraversalEvidence
          ? [{
            id: "23232323-2323-4232-8232-232323232323",
            version_id: versionId,
            adapter: "xgrids-lcc",
            schema_version: "1.0.0",
            status: "reviewed",
            result: "ready",
            manifest_asset_id: "25252525-2525-4252-8252-252525252525",
            manifest_hash: "b".repeat(64),
            validation_json: "{}",
            review_decision: "accepted",
            review_generation: 1,
            review_note: "Accepted lift evidence.",
            reviewed_at: now,
            created_at: now,
            updated_at: now,
          }]
          : [],
        previewReadyVersionIds: options.previewReady === false ||
            options.noviceLifecycle && noviceStage === "structure"
          ? []
          : [versionId],
        walkTestReadyVersionIds: noviceWalkTestCompleted ? [versionId] : [],
      });
    }
    if (path === `/api/projects/${projectId}/spatial`) {
      if (options.delayedPrivacyScan && delayedPrivacyScanStatus) {
        options.delayedPrivacyScan.spatialReads += 1;
        if (options.delayedPrivacyScan.spatialReads >= 3) {
          delayedPrivacyScanStatus = "COMPLETED";
        }
      }
      const reviewedTransform = options.reviewedTransform
        ? [{
          id: "66666666-6666-4666-8666-666666666666",
          version_id: versionId,
          input_asset_id: "77777777-7777-4777-8777-777777777777",
          job_id: "88888888-8888-4888-8888-888888888888",
          method: "registered-ply-walkable-candidates-v1",
          status: "REVIEWED",
          parameters_json: JSON.stringify({
            sourceToWorld: {
              sourceUpAxis: "Y",
              worldUnit: "scene_units",
              metresPerSourceUnit: 1,
              yawDegrees: 0,
              translationMetres: [0, 0, 0],
            },
          }),
          summary_json: null,
          candidate_count: 0,
          review_decision: "accept_selected",
          review_note: "Reviewed transform",
          job_state: "SUCCEEDED",
          job_progress: 100,
          job_progress_message: "Reviewed",
          job_error_json: null,
          input_file_name: "scene.ply",
          input_size_bytes: 100,
          created_at: now,
        }]
        : [];
      return json(route, 200, {
        version: { id: versionId, version_number: 1 },
        entities: options.authoredSpatial
          ? [{
            id: "99999999-9999-4999-8999-999999999999",
            parent_id: null,
            kind: "room",
            label: "Authored room",
            description: null,
            position_json: null,
            geometry_json: JSON.stringify({
              type: "box",
              points: [[0, 0, 0], [4, 3, 4]],
            }),
            metadata_json: "{}",
            sort_order: 0,
            world_unit: "scene_units",
          }]
          : [],
        routes: [],
        routeStops: [],
        privacyRegions: [],
        privacyScans: delayedPrivacyScanStatus
          ? [{
            id: "60606060-6060-4060-8060-606060606060",
            status: delayedPrivacyScanStatus,
            detector: "fixture-detector",
            detector_version: "fixture/1",
            attempt_count: 1,
            max_attempts: 3,
            input_count: 1,
            candidate_count: 0,
            evidence_json: delayedPrivacyScanStatus === "COMPLETED" ? "{}" : null,
            error_json: null,
            created_at: now,
            completed_at: delayedPrivacyScanStatus === "COMPLETED" ? now : null,
          }]
          : options.noviceLifecycle && noviceStage !== "structure"
          ? [{
            id: "60606060-6060-4060-8060-606060606060",
            status: "COMPLETED",
            detector: "fixture-detector",
            detector_version: "fixture/1",
            attempt_count: 1,
            max_attempts: 3,
            input_count: 1,
            candidate_count: 1,
            evidence_json: "{}",
            error_json: null,
            created_at: now,
            completed_at: now,
          }]
          : [],
        privacyCandidates: options.noviceLifecycle && noviceStage !== "structure"
          ? [{
            id: "61616161-6161-4161-8161-616161616161",
            scan_id: "60606060-6060-4060-8060-606060606060",
            asset_id: "57575757-5757-4575-8575-575757575757",
            asset_file_name: "private-evidence.png",
            asset_mime_type: "image/png",
            target: "poster",
            label: "Possible face",
            bbox_json: JSON.stringify({ xMin: 0.2, yMin: 0.2, xMax: 0.4, yMax: 0.5 }),
            confidence: 0.82,
            detector_metadata_json: "{}",
            status: novicePrivacyResolved ? "dismissed" : "pending",
            decision_note: novicePrivacyResolved ? "Verified as a poster reflection." : null,
            created_at: now,
            reviewed_at: novicePrivacyResolved ? now : null,
          }]
          : [],
        changeReports: [],
        captureCompletenessReports: [],
        rawChangeReports: [],
        semanticExtractions: reviewedTransform,
        semanticCandidates: [],
        floorplanExtractions: options.multiLevelFloorplan ||
            options.noviceLifecycle && noviceStage === "structure"
          ? [{
            id: "14141414-1414-4414-8414-141414141414",
            version_id: versionId,
            input_asset_id: "13131313-1313-4313-8313-131313131313",
            job_id: "15151515-1515-4515-8515-151515151515",
            method: "metric-pointcloud-floorplan-v2",
            normalizer: "native-ply",
            status: "READY_FOR_REVIEW",
            parameters_json: "{}",
            source_evidence_json: "{}",
            proposal_json: JSON.stringify(multiLevelFloorplanProposal()),
            proposal_hash: "b".repeat(64),
            report_asset_id: "16161616-1616-4616-8616-161616161616",
            review_decision: null,
            review_note: null,
            error_json: null,
            job_state: "SUCCEEDED",
            job_progress: 100,
            job_progress_message: "Multi-level proposal ready for review",
            job_error_json: null,
            input_file_name: "registered-room.ply",
            input_format: "ply",
            input_size_bytes: 8192,
            created_at: now,
          }]
          : [],
        floorplanRevisions: [],
        floorplanExports: [],
        deliveryPolicy: {
          mobile_lite_budget: 0.75,
          mobile_standard_budget: 1.25,
          desktop_standard_budget: 2,
          desktop_high_budget: 4,
        },
        collisionProxy: { version: "empty-v1", boxes: [] },
        navigationMesh: { version: "empty-v1", vertices: [], indices: [], sourceEntityIds: [] },
        navigationObstacles: [],
        navigationTraversals: [],
        traversalEvidenceOptions: options.qualifiedTraversalEvidence
          ? [{
            assetId: "24242424-2424-4242-8242-242424242424",
            fileName: "lift-proof.ply",
            kind: "pointcloud",
            sha256: "a".repeat(64),
            manifestId: "23232323-2323-4232-8232-232323232323",
            manifestSha256: "b".repeat(64),
            adapter: "xgrids-lcc",
            reviewGeneration: 1,
            registrationSha256: "c".repeat(64),
            sourceToWorld: {
              sourceUpAxis: "Y",
              worldUnit: "metres",
              metresPerSourceUnit: 1,
              yawDegrees: 0,
              translationMetres: [0, 0, 0],
            },
          }]
          : [],
        obstacleProxy: { version: "empty-v1", boxes: [] },
        navigationProfile: {
          worldUnit: "scene_units",
          agentRadius: 0.22,
          agentHeight: 1.8,
          eyeHeight: 1.6,
          maxStepMetres: 0.1,
        },
        navigationBuilds: options.navigationBuildHistory ||
            options.noviceLifecycle && noviceStage !== "structure"
          ? [
            {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              collision_asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              job_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              status: "READY_FOR_REVIEW",
              parameters_json: "{}",
              artifact_json: JSON.stringify({
                schemaVersion: "spatial-navigation-v9",
                source: { authoringHash: "a".repeat(64) },
                validation: { passed: true, componentCount: 1 },
                physicalValidation: { passed: true, routeCount: 2 },
                structuralValidation: { passed: true, probeCount: 12 },
                offMeshConnections: [],
                authoredTraversalValidation: { passed: true, directionCount: 0 },
              }),
              navmesh_asset_id: null,
              report_asset_id: null,
              review_note: null,
              reviewed_at: null,
              created_at: "2026-08-01T15:18:04.000Z",
              updated_at: "2026-08-01T15:18:04.000Z",
            },
            {
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              collision_asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              job_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              status: "APPROVED",
              parameters_json: "{}",
              artifact_json: JSON.stringify({
                schemaVersion: "spatial-navigation-v9",
                source: { authoringHash: "d".repeat(64) },
                validation: {
                  passed: true,
                  componentCount: 1,
                  unreachableDestinationIds: [],
                },
                physicalValidation: {
                  passed: true,
                  routeCount: 2,
                  failedDestinationIds: [],
                },
                structuralValidation: { passed: true, probeCount: 12 },
                offMeshConnections: [],
                authoredTraversalValidation: { passed: true, directionCount: 0 },
              }),
              navmesh_asset_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
              report_asset_id: "12121212-1212-4212-8212-121212121212",
              review_note: "Reviewed collision evidence.",
              reviewed_at: "2026-08-01T09:18:12.000Z",
              created_at: "2026-08-01T09:18:12.000Z",
              updated_at: "2026-08-01T09:18:12.000Z",
            },
          ]
          : [],
        walkTests: noviceWalkTestCompleted
          ? [{
            id: "73737373-7373-4373-8373-737373737373",
            navigation_build_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            start_pose_json: JSON.stringify({ position: [1, 1.6, 2], target: [1, 1.6, 1] }),
            end_pose_json: JSON.stringify({ position: [2, 1.6, 2], target: [2, 1.6, 1] }),
            runtime_evidence_json: JSON.stringify({ movementObserved: true }),
            completed_by: "44444444-4444-4444-8444-444444444444",
            completed_at: now,
          }]
          : [],
        navigationArtifact: null,
      });
    }
    if (path === `/api/projects/${projectId}/versions/${versionId}/preview`) {
      return json(route, 200, {
        renderable: {
          versionId,
          assetId: "55555555-5555-4555-8555-555555555555",
          format: "rad",
          fileName: "scene.rad",
          mimeType: "application/octet-stream",
          sizeBytes: 73_400_000,
          sha256: "f".repeat(64),
          contentUrl: "/mock-assets/scene.rad",
          collisionUrl: "/mock-assets/collision.bin",
          sessionExpiresAt: "2026-08-10T14:30:00.000Z",
          spatial: {
            entities: [],
            routes: [],
            routeStops: [],
            collisionProxy: { version: "empty-v1", boxes: [] },
            navigationMesh: { version: "empty-v1", vertices: [], indices: [], sourceEntityIds: [] },
            obstacleProxy: { version: "empty-v1", boxes: [] },
            navigationProfile: {
              worldUnit: "scene_units",
              agentRadius: 0.22,
              agentHeight: 1.8,
              eyeHeight: 1.6,
              maxStepMetres: 0.1,
            },
            navigationArtifact: null,
          },
          viewer: null,
        },
      });
    }
    if (path === `/api/projects/${projectId}/releases` && method === "POST") {
      onPublish(request.postDataJSON() as Record<string, unknown>);
      if (options.publishResult) {
        return json(route, options.publishResult.status, options.publishResult.body);
      }
      return json(route, 200, {
        release: {
          url: "https://spatial.example/s/corrected-spark-room",
          accessPolicy: "public",
          accessToken: null,
        },
      });
    }
    if (path === "/api/review/inbox") return json(route, 200, { projects: [] });
    if (path === "/api/jobs") return json(route, 200, { jobs: [] });
    if (path === "/api/releases") return json(route, 200, { releases: [] });
    if (path === "/api/hosting") {
      return json(route, 200, {
        paymentProviderConfigured: false,
        plans: [],
        subscriptions: [],
        checkouts: [],
        invoices: [],
        alerts: [],
        lifecycleRuns: [],
      });
    }
    if (path === "/api/team") return json(route, 200, { members: [], invitations: [] });
    if (path === "/api/team/identity-providers") return json(route, 200, { providers: [] });
    if (path === "/api/capture-agents") return json(route, 200, { credentials: [] });
    if (path === "/api/project-templates") return json(route, 200, { templates: [] });
    if (path === "/api/project-views") return json(route, 200, { views: [] });
    if (path === "/api/project-fields") return json(route, 200, { fields: [] });
    if (path === "/api/uploads/recoverable") return json(route, 200, { uploads: [] });
    if (path.startsWith("/api/projects/asset-handoffs") && method === "GET") {
      return json(route, 200, { handoffs: [] });
    }
    return json(route, 404, { error: `Unmocked route: ${method} ${path}` });
  });
}

function comparisonReadinessFixture(ready: boolean): Record<string, unknown> {
  const mode = (eligible: boolean, reason: string) => ({
    eligible,
    reasons: eligible ? [] : [reason],
  });
  const version = (id: string, number: number, eligible: boolean) => ({
    versionId: id,
    versionNumber: number,
    modes: {
      visual: mode(eligible, "approved_navigation_missing"),
      authored_geometry: mode(false, "reviewed_metric_structure_missing"),
      raw: mode(false, "verified_source_point_cloud_missing"),
    },
  });
  return ready
    ? {
      available: true,
      eligiblePairs: [{
        leftVersionId: auxiliaryQaVersionId,
        rightVersionId: versionId,
        modes: ["visual"],
      }],
      versions: [version(auxiliaryQaVersionId, 2, true), version(versionId, 1, true)],
    }
    : {
      available: false,
      eligiblePairs: [],
      versions: [version(versionId, 1, false)],
    };
}

function multiLevelFloorplanProposal(): Record<string, unknown> {
  const room = (roomKey: string, levelKey: string, elevationM: number) => ({
    roomKey,
    kind: "room_candidate",
    label: levelKey === "level-001" ? "Ground room" : "Upper room",
    areaM2: 36,
    elevationM,
    confidence: 0.9,
    geometry: {
      type: "polygon",
      points: [[0, elevationM, 0], [6, elevationM, 0],
        [6, elevationM, 6], [0, elevationM, 6]],
    },
    evidence: { levelKey },
  });
  const wall = (
    wallKey: string,
    levelKey: string,
    elevationM: number,
    start: [number, number],
    end: [number, number],
  ) => ({
    wallKey,
    kind: "wall_candidate",
    label: wallKey,
    elevationM,
    heightM: 3,
    thicknessM: 0.2,
    confidence: 0.9,
    geometry: {
      type: "line",
      points: [[start[0], elevationM, start[1]], [end[0], elevationM, end[1]]],
    },
    evidence: { levelKey },
  });
  const rooms = [
    room("room-001", "level-001", 0),
    room("room-002", "level-002", 3),
  ];
  const edges: Array<[[number, number], [number, number]]> = [
    [[0, 0], [6, 0]], [[6, 0], [6, 6]], [[6, 6], [0, 6]], [[0, 6], [0, 0]],
  ];
  const walls = [
    ...edges.map(([start, end], index) =>
      wall(`wall-00${index + 1}`, "level-001", 0, start, end)),
    ...edges.map(([start, end], index) =>
      wall(`wall-00${index + 5}`, "level-002", 3, start, end)),
  ];
  return {
    schemaVersion: "1.0.0",
    method: "metric-pointcloud-floorplan-v2",
    result: "proposal_ready",
    measurementClass: "indicative",
    summary: {
      inferredFloorElevationM: 0,
      credibleHorizontalLayerCount: 2,
      wallCellCount: 96,
      wallCount: 8,
      roomCount: 2,
      openingCount: 0,
      totalRoomAreaM2: 72,
      levelCount: 2,
      connectorCount: 1,
    },
    levels: [
      {
        levelKey: "level-001",
        label: "Ground floor",
        elevationM: 0,
        roomKeys: ["room-001"],
        wallKeys: ["wall-001", "wall-002", "wall-003", "wall-004"],
        openingKeys: [],
      },
      {
        levelKey: "level-002",
        label: "Level 2",
        elevationM: 3,
        roomKeys: ["room-002"],
        wallKeys: ["wall-005", "wall-006", "wall-007", "wall-008"],
        openingKeys: [],
      },
    ],
    connectors: [{
      connectorKey: "connector-001",
      kind: "stair_or_ramp_candidate",
      label: "Stair/ramp candidate 1",
      lowerLevelKey: "level-001",
      upperLevelKey: "level-002",
      riseM: 3,
      runM: 4.3,
      widthM: 1,
      slopeDegrees: 35,
      confidence: 0.8,
      geometry: {
        type: "polygon",
        points: [[2.5, 0, 0.5], [2.5, 3, 4.8], [3.5, 3, 4.8], [3.5, 0, 0.5]],
      },
      evidence: {},
    }],
    rooms,
    walls,
    openings: [],
    humanReviewRequired: true,
    limitations: ["Indicative fixture requiring operator review."],
  };
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
