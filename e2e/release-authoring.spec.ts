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

  await expect(page).toHaveURL(new RegExp(`#project/${projectId}$`));
  await expect(page.locator("#studioGrid")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Corrected Spark room", exact: true })).toBeVisible();
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

  await page.getByRole("button", { name: "Scene & navigation", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${projectId}/scene$`));
  await expect(page.getByRole("heading", { name: "Floors, rooms, doorways, POIs, routes, and privacy regions" })).toBeVisible();
  await expect(page.locator("#projectTable")).toBeHidden();

  await page.getByRole("button", { name: "Back to projects", exact: true }).click();
  await expect(page).toHaveURL(/#projects$/);
  await expect(page.locator("#projectTable")).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Corrected Spark room" })).toBeVisible();

  const openRelease = page.getByRole("button", { name: "Publish shareable URL", exact: true });
  await openRelease.click();
  const dialog = page.locator("#releaseDialog");
  await dialog.getByRole("textbox", { name: "Subtitle", exact: true }).fill("Stale project copy");
  await dialog.locator("input[name='initialCameraPosition']").fill("1, 2, 3");
  await dialog.locator("input[name='sceneRotationZ']").fill("180");
  await dialog.getByRole("button", { name: "×", exact: true }).click();

  await openRelease.click();
  await expect(dialog.getByRole("textbox", { name: "Subtitle", exact: true })).toHaveValue("");
  await expect(dialog.locator("input[name='initialCameraPosition']")).toHaveValue("");
  await expect(dialog.locator("input[name='sceneRotationZ']")).toHaveValue("0");

  await dialog.locator("input[name='sceneRotationZ']").fill("361");
  expect(pageErrors).toEqual([]);
  await dialog.locator("input[name='sceneRotationZ']").fill("180");
  await dialog.getByRole("button", { name: "Publish release", exact: true }).click();
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
  await page.getByRole("button", { name: "Publish shareable URL", exact: true }).click();

  const dialog = page.locator("#releaseDialog");
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
  await expect(page.getByRole("button", { name: "Review privacy and approve", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish shareable URL", exact: true }).click();
  await expect(page.locator("#releaseDialog")).toBeVisible();
});

test("processed splats stay blocked until their walking map is approved", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, { previewReady: false });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
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
  await expect(page.getByText("Floor plan", { exact: true })).toBeVisible();
  await expect(page.getByText("Geometry required", { exact: true })).toBeVisible();
});

test("walking evidence builds automatically without exposing routine authoring", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, {
    previewReady: false,
    walkingState: "building",
  });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
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
  await expect(page.getByRole("heading", { name: "Structural exceptions need review.", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review structural exceptions", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete walking map", exact: true })).toHaveCount(0);
});

test("multi-level floor-plan review shows every level and vertical connector", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, { multiLevelFloorplan: true });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
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
  await expect(page.locator("details.spatial-advanced-workflows")).not.toHaveAttribute("open", "");
  await page.getByText("Advanced evidence and diagnostics", { exact: true }).click();
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
  await page.getByRole("button", { name: "Edit scene", exact: true }).click();
  await page.getByText("Advanced evidence and diagnostics", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Routes and movement runtime" })).toBeVisible();

  const card = page.locator("article.workspace-card-large").filter({
    has: page.getByRole("heading", { name: "Routes and movement runtime" }),
  });
  const createRoute = card.getByRole("button", { name: "Create guided route", exact: true });
  const tuneNavigation = card.getByRole("button", { name: "Tune navigation agent", exact: true });
  const authorTraversal = card.getByRole("button", { name: "Author vertical traversal", exact: true });
  const buildNavigation = card.getByRole("button", { name: "Build verified navigation", exact: true });
  const firstApprove = card.getByRole("button", { name: "Approve navigation", exact: true }).first();
  const buildEvidence = card.getByText("Inspect build evidence", { exact: true }).first();
  await expect(buildEvidence).toBeVisible();
  await buildEvidence.click();
  await expect(card.getByText('"schemaVersion": "spatial-navigation-v9"')).toBeVisible();

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
    ]);
    const [createBox, tuneBox, traversalBox, buildBox, approveBox] = boxes;
    if (!createBox || !tuneBox || !traversalBox || !buildBox || !approveBox) {
      throw new Error(`${viewport.width}px navigation controls are not measurable`);
    }

    for (const [label, gap] of [
      ["create/tune", tuneBox.y - (createBox.y + createBox.height)],
      ["tune/traversal", traversalBox.y - (tuneBox.y + tuneBox.height)],
      ["traversal/build", buildBox.y - (traversalBox.y + traversalBox.height)],
      ["build/review", approveBox.y - (buildBox.y + buildBox.height)],
    ] as const) {
      expect(gap, `${viewport.width}px ${label} controls overlap`).toBeGreaterThan(0);
    }
  }
});

test("vertical traversal authoring offers only capture-qualified evidence", async ({ page }) => {
  await mockApprovedProject(page, () => undefined, { qualifiedTraversalEvidence: true });

  await page.goto("/studio.html#projects");
  await page.getByRole("button", { name: "Open Corrected Spark room", exact: true }).click();
  await page.getByRole("button", { name: "Edit scene", exact: true }).click();
  await page.getByText("Advanced evidence and diagnostics", { exact: true }).click();
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
    navigationBuildHistory?: boolean;
    multiLevelFloorplan?: boolean;
    qualifiedTraversalEvidence?: boolean;
    previewReady?: boolean;
    walkingState?: "building" | "exception";
  } = {},
): Promise<void> {
  const project = {
    id: projectId,
    name: "Corrected Spark room",
    slug: "corrected-spark-room",
    status: "APPROVED",
    captureAdapter: "open-import",
    deliveryTemplate: "Property showcase",
    notes: "Visual-only Gaussian fixture.",
    customerName: "WhyMe Labs",
    customFields: {},
    latestVersionId: options.auxiliaryQaVersion ? auxiliaryQaVersionId : versionId,
    latestVersionNumber: options.auxiliaryQaVersion ? 2 : 1,
    activeReleaseSlug: null,
    updatedAt: now,
  };
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
        activeProjects: 1,
        processingJobs: 0,
        hostedAssets: 1,
        hostedBytes: 73_400_000,
        activeReleases: 0,
      });
    }
    if (path === "/api/projects" && method === "GET") return json(route, 200, { projects: [project] });
    if (path === `/api/projects/${projectId}` && method === "GET") {
      return json(route, 200, {
        project,
        versions: [
          ...(options.auxiliaryQaVersion
            ? [{
              id: auxiliaryQaVersionId,
              version_number: 2,
              status: "QA_REQUIRED",
              created_at: "2026-07-31T14:00:00.000Z",
            }]
            : []),
          { id: versionId, version_number: 1, status: "APPROVED", created_at: now },
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
        jobs: options.walkingState === "building"
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
        previewReadyVersionIds: options.previewReady === false ? [] : [versionId],
      });
    }
    if (path === `/api/projects/${projectId}/spatial`) {
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
        privacyScans: [],
        privacyCandidates: [],
        changeReports: [],
        captureCompletenessReports: [],
        rawChangeReports: [],
        semanticExtractions: reviewedTransform,
        semanticCandidates: [],
        floorplanExtractions: options.multiLevelFloorplan
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
        deliveryPolicy: null,
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
        navigationBuilds: options.navigationBuildHistory
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
              artifact_json: null,
              navmesh_asset_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
              report_asset_id: "12121212-1212-4212-8212-121212121212",
              review_note: "Reviewed collision evidence.",
              reviewed_at: "2026-08-01T09:18:12.000Z",
              created_at: "2026-08-01T09:18:12.000Z",
              updated_at: "2026-08-01T09:18:12.000Z",
            },
          ]
          : [],
        navigationArtifact: null,
      });
    }
    if (path === `/api/projects/${projectId}/releases` && method === "POST") {
      onPublish(request.postDataJSON() as Record<string, unknown>);
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
