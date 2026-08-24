import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  SCENE_ROTATION_MAX_DEGREES,
  SCENE_ROTATION_MIN_DEGREES,
} from "../src/shared/scene-rotation";
import {
  expectReviewedScreenshot,
  RESPONSIVE_VISUAL_VIEWPORTS,
} from "./helpers/visual-matrix";

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "phone", width: 390, height: 844 },
  { name: "narrow-phone", width: 320, height: 568 },
] as const;

const studioShellTransitionWidths = [1280, 1100, 1024, 961, 960] as const;
const now = "2026-07-29T08:00:00.000Z";
const organisationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const maximumProjectName = (
  "Museum conservation capture and reviewed navigation workspace "
    .repeat(3)
    .slice(0, 120)
);
const maximumReleaseSlug = (
  "museum-conservation-capture-reviewed-publication-channel-"
    .repeat(2)
    .slice(0, 80)
    .replace(/-$/, "x")
);

test.describe("responsive public surfaces", () => {
  test("landing page preserves readable controls and layout at supported aspect ratios", async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);

      await expect(page.getByRole("heading", { name: /Places, made explorable/i })).toBeVisible();
      await expect(page.getByRole("link", { name: "Explore multi-room demo", exact: true })).toHaveAttribute(
        "href",
        "/s/home-scan-spark-multi-room-demo",
      );
      await expect(page.getByRole("heading", {
        name: "The splat is the view. The scene graph makes it playable.",
        exact: true,
      })).toBeAttached();
      await expect(page.getByRole("link", { name: "Home Scan by Isaiah Sweeney", exact: true })).toHaveAttribute(
        "href",
        "https://superspl.at/scene/3f89bbd3",
      );
      await expectResponsiveSurface(page, "body");
    }
  });

  test("email OTP sign-in prevents duplicate submission and recovers for retry", async ({ page }) => {
    await installTurnstileStub(page);
    let otpRequests = 0;
    let releaseFirstRequest!: () => void;
    const firstRequestGate = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/session") {
        return json(route, 200, { authenticated: false });
      }
      if (path === "/api/auth/config") {
        return json(route, 200, {
          turnstileSiteKey: "1x00000000000000000000AA",
          turnstileAction: "otp_request",
        });
      }
      if (path === "/api/auth/otp/request") {
        otpRequests += 1;
        if (otpRequests === 1) {
          await firstRequestGate;
          return json(route, 503, {
            error: "Temporary email outage. Retry remains safe.",
          });
        }
        return json(route, 200, {
          challengeId: "44444444-4444-4444-8444-444444444444",
          expiresInSeconds: 600,
          retryAfterSeconds: 60,
          message: "If the address is authorised, a code has been sent.",
        });
      }
      return json(route, 404, { error: `Unmocked route: ${request.method()} ${path}` });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/studio.html");
    const dialog = page.locator("#loginDialog");
    const form = page.locator("#loginForm");
    const submit = page.locator("#loginSubmit");
    await expect(dialog).toBeVisible();
    await page.locator("#loginEmail").fill("operator@example.com");
    await expect(submit).toBeEnabled();

    await submit.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => otpRequests).toBe(1);
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText("Sending code…");
    await expect(form).toHaveAttribute("aria-busy", "true");
    releaseFirstRequest();
    await expect(page.locator("#loginError")).toContainText("Temporary email outage");
    expect(otpRequests).toBe(1);
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveText("Email me a code");
    await expect(form).not.toHaveAttribute("aria-busy");

    await submit.click();
    await expect(page.locator("#otpField")).toHaveClass(/active/);
    await expect(page.locator("#loginEmail")).toHaveAttribute("readonly", "");
    expect(otpRequests).toBe(2);

    await expectResponsiveSurface(page, "#loginDialog");
  });

  test("sign-in dialog and Turnstile stay contained on narrow and short screens", async ({ page }) => {
    await installTurnstileStub(page);
    await mockAnonymousAuth(page);

    for (const viewport of viewports.slice(3)) {
      await page.setViewportSize(viewport);
      await page.goto("/studio.html");
      await expect(page.locator("#loginDialog")).toBeVisible();
      await expect.poll(() => page.evaluate(() => {
        return (window as typeof window & { __turnstileOptions?: { size?: string } })
          .__turnstileOptions?.size ?? null;
      })).toBe(viewport.width < 360 ? "compact" : "flexible");

      const geometry = await page.locator("#loginDialog").evaluate((dialog) => {
        const bounds = dialog.getBoundingClientRect();
        const scrollBody = dialog.querySelector<HTMLElement>(".dialog-shell-body");
        const widget = dialog.querySelector("#turnstileWidget");
        return {
          left: bounds.left,
          right: bounds.right,
          viewportWidth: window.innerWidth,
          formOverflowY: scrollBody ? getComputedStyle(scrollBody).overflowY : null,
          formClientHeight: scrollBody?.clientHeight ?? null,
          formScrollHeight: scrollBody?.scrollHeight ?? null,
          widgetFits: widget ? widget.scrollWidth <= widget.clientWidth + 1 : false,
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(-1);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(geometry.formOverflowY).toBe("auto");
      expect(geometry.formClientHeight).not.toBeNull();
      expect(geometry.formScrollHeight).not.toBeNull();
      if (viewport.height <= 568) {
        expect(geometry.formScrollHeight!).toBeGreaterThan(geometry.formClientHeight!);
      }
      expect(geometry.widgetFits).toBe(true);
      await expectResponsiveSurface(page, "#loginDialog");
    }
  });
});

test.describe("authenticated studio UI", () => {
  test.beforeEach(async ({ page }) => {
    await installTurnstileStub(page);
    await mockAuthenticatedStudio(page);
    await page.goto("/studio.html#projects");
    await expect(page.getByRole("heading", {
      name: "Your spatial portfolio, at a glance.",
    })).toBeVisible();
  });

  test("core Studio views and the capture dialog pass automated accessibility checks", async ({ page }) => {
    const expectAxeClean = async (label: string): Promise<void> => {
      const result = await new AxeBuilder({ page })
        .exclude("#turnstileWidget")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(result.violations, label).toEqual([]);
    };

    await expectAxeClean("Projects");
    await page.getByRole("button", { name: "Published previews", exact: true }).click();
    await expectAxeClean("Published previews");
    await page.getByRole("button", { name: "Team access", exact: true }).click();
    await expectAxeClean("Team access");
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await page.getByRole("button", { name: "Upload capture", exact: true }).click();
    await expectAxeClean("Capture dialog");
  });

  test("portfolio health is one integrated readout inside Current production", async ({ page }) => {
    const board = page.locator("#projectBoard");
    const overview = page.locator("#summaryGrid");

    await expect(board).toBeVisible();
    await expect(overview).toBeVisible();
    await expect(overview.locator("dt")).toHaveCount(4);
    expect(await overview.evaluate((element) => element.parentElement?.id)).toBe("projectBoard");

    for (const viewport of [
      viewports[0],
      { name: "portfolio-pre-collapse", width: 641, height: 800 },
      { name: "portfolio-collapse", width: 640, height: 800 },
      viewports[3],
    ]) {
      await page.setViewportSize(viewport);
      const contract = await overview.evaluate((element) => {
        const style = getComputedStyle(element);
        const board = element.parentElement?.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        const facts = [...element.children].map((fact) => {
          const factStyle = getComputedStyle(fact);
          return {
            borderRadius: factStyle.borderRadius,
            boxShadow: factStyle.boxShadow,
          };
        });
        return {
          columns: style.gridTemplateColumns.trim().split(/\s+/).length,
          contained: Boolean(board) && bounds.left >= board!.left - 1 && bounds.right <= board!.right + 1,
          facts,
        };
      });

      expect(contract.columns, viewport.name).toBe(viewport.width <= 640 ? 2 : 4);
      expect(contract.contained, viewport.name).toBe(true);
      expect(contract.facts, viewport.name).toEqual([
        { borderRadius: "0px", boxShadow: "none" },
        { borderRadius: "0px", boxShadow: "none" },
        { borderRadius: "0px", boxShadow: "none" },
        { borderRadius: "0px", boxShadow: "none" },
      ]);
      await expectResponsiveSurface(page, "#projectBoard");
    }
  });

  test("Studio names icon controls and preserves targets, focus, and doubled text", async ({ page }) => {
    const dialogSemantics = await page.locator("dialog").evaluateAll((dialogs) => dialogs.map((dialog) => ({
      id: dialog.id,
      named: Boolean(dialog.getAttribute("aria-label") || dialog.getAttribute("aria-labelledby")),
      closeNames: [...dialog.querySelectorAll<HTMLElement>(".dialog-close")]
        .map((close) => close.getAttribute("aria-label") || close.getAttribute("aria-labelledby") || ""),
    })));
    expect(dialogSemantics.length).toBeGreaterThan(0);
    expect(dialogSemantics.filter((dialog) => !dialog.named)).toEqual([]);
    expect(dialogSemantics.flatMap((dialog) => dialog.closeNames).filter((name) => !name)).toEqual([]);

    const selectorCell = page.locator("#projectTable .project-select-cell").nth(1);
    const projectCheckbox = selectorCell.locator("input");
    await expect(projectCheckbox).not.toBeChecked();
    const selectorTarget = await selectorCell.boundingBox();
    expect(selectorTarget).not.toBeNull();
    expect(selectorTarget!.width).toBeGreaterThanOrEqual(40);
    expect(selectorTarget!.height).toBeGreaterThanOrEqual(40);
    await selectorCell.click({ position: { x: 2, y: selectorTarget!.height / 2 } });
    await expect(projectCheckbox).toBeChecked();
    await expect(page).toHaveURL(/#projects$/);

    const statusSizes = await page.locator(".worker-status:visible, .status-pill:visible, .record-status:visible")
      .evaluateAll((statuses) => statuses.map((status) => ({
        text: status.textContent?.trim() ?? "",
        fontSize: Number.parseFloat(getComputedStyle(status).fontSize),
      })));
    expect(statusSizes.length).toBeGreaterThan(0);
    for (const status of statusSizes) {
      expect(status.text).not.toBe("");
      expect(status.fontSize, status.text).toBeGreaterThanOrEqual(12);
    }

    await page.emulateMedia({ forcedColors: "active" });
    const projectsNav = page.getByRole("button", { name: "Projects", exact: true });
    await page.keyboard.press("Tab");
    await projectsNav.focus();
    const forcedColorFocus = await projectsNav.evaluate((button) => ({
      forcedColors: matchMedia("(forced-colors: active)").matches,
      focusVisible: button.matches(":focus-visible"),
      outlineWidth: Number.parseFloat(getComputedStyle(button).outlineWidth),
      borderWidth: Number.parseFloat(getComputedStyle(button).borderTopWidth),
    }));
    expect(forcedColorFocus.forcedColors).toBe(true);
    expect(forcedColorFocus.focusVisible).toBe(true);
    expect(forcedColorFocus.outlineWidth).toBeGreaterThanOrEqual(3);
    expect(forcedColorFocus.borderWidth).toBeGreaterThanOrEqual(2);

    await page.emulateMedia({ forcedColors: "none" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await page.getByRole("button", { name: "Upload capture", exact: true }).click();
    const dialog = page.locator("#newProjectDialog");
    const continueAction = dialog.getByRole("button", { name: "Continue to files", exact: true });
    await continueAction.scrollIntoViewIfNeeded();
    await expect(continueAction).toBeVisible();
    const scaled = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const scrollBody = element.querySelector<HTMLElement>(".dialog-shell-body");
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        formOverflowY: scrollBody ? getComputedStyle(scrollBody).overflowY : null,
      };
    });
    expect(scaled.left).toBeGreaterThanOrEqual(-1);
    expect(scaled.right).toBeLessThanOrEqual(scaled.viewportWidth + 1);
    expect(scaled.top).toBeGreaterThanOrEqual(-1);
    expect(scaled.bottom).toBeLessThanOrEqual(scaled.viewportHeight + 1);
    expect(scaled.documentWidth).toBeLessThanOrEqual(scaled.viewportWidth + 1);
    expect(scaled.formOverflowY).toBe("auto");

    await dialog.locator(".dialog-close").click();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    await page.setViewportSize({ width: 640, height: 800 });
    await expect(page.getByRole("button", { name: "Upload capture", exact: true })).toBeVisible();
    await expectResponsiveSurface(page, ".studio-shell");
  });

  test("operational Studio text never falls below the 12px label floor", async ({ page }) => {
    const violations: Array<{ view: string; text: string; className: string; fontSize: number }> = [];
    const auditCurrentView = async (view: string): Promise<void> => {
      const current = await page.locator([
        ".studio-main button:visible",
        ".studio-sidebar button:visible",
        ".studio-main a:visible",
        ".record-row :is(strong,small,span,p,summary):visible",
        ".project-pagination:visible",
        ".list-pagination:visible",
        ".worker-status:visible",
        ".status-pill:visible",
        ".status-badge:visible",
        ".domain-evidence span:visible",
        ".geometry-change-row:visible",
        ".capture-evidence-issues li:visible",
        ".field-message:visible",
        ".form-error:visible",
      ].join(", ")).evaluateAll((elements) => elements
        .filter((element) => element.textContent?.trim() && element.getAttribute("aria-hidden") !== "true")
        .map((element) => ({
          text: element.textContent!.trim().replace(/\s+/g, " ").slice(0, 80),
          className: element.className,
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        }))
        .filter((element) => element.fontSize < 12));
      violations.push(...current.map((entry) => ({ view, ...entry })));
    };

    await auditCurrentView("Projects");
    const advanced = page.locator(".studio-nav-advanced");
    await advanced.getByText("Advanced tools", { exact: true }).click();
    await page.getByRole("button", { name: "Processing activity", exact: true }).click();
    await auditCurrentView("Processing activity");
    await page.getByRole("button", { name: "Client review", exact: true }).click();
    await page.getByRole("button", { name: "Open activity", exact: true }).click();
    await auditCurrentView("Client review");
    await page.getByRole("button", { name: "Hosting & lifecycle", exact: true }).click();
    await auditCurrentView("Hosting & lifecycle");
    await page.getByRole("button", { name: "Published previews", exact: true }).click();
    await auditCurrentView("Published previews");
    await page.getByRole("button", { name: "Team access", exact: true }).click();
    await auditCurrentView("Team access");
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await page.getByRole("button", { name: "Upload capture", exact: true }).click();
    await auditCurrentView("Capture dialog");

    expect(violations).toEqual([]);
  });

  test("capture intake guides a novice through details, files, and the processing plan", async ({ page }) => {
    await page.getByRole("button", { name: "Upload capture", exact: true }).click();
    const dialog = page.locator("#newProjectDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", {
      name: "Create a walkable scene.",
      exact: true,
    })).toBeVisible();
    await expect(dialog.getByLabel("Scene name", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Start from project defaults", { exact: true })).toBeHidden();
    await expect(dialog.getByText("Optional project details", { exact: false })).toBeVisible();
    await dialog.getByLabel("Scene name", { exact: true }).fill("Atrium walkthrough");
    await dialog.getByRole("button", { name: "Continue to files", exact: true }).click();

    await expect(dialog.getByRole("combobox", {
      name: "Where did the observations come from?",
      exact: true,
    })).toBeVisible();
    await dialog.getByRole("combobox", {
      name: "Where did the observations come from?",
      exact: true,
    }).selectOption("third-party");
    await dialog.getByRole("combobox", {
      name: "Which pipeline produced these files?",
      exact: true,
    }).selectOption("open-import");
    await expect(dialog.getByLabel("3D appearance file", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Measurement geometry file", { exact: true })).toBeVisible();
    await expect(dialog.locator("#newCaptureAsset")).toHaveAttribute(
      "accept",
      ".ply,.spz,.sog,.splat,.ksplat,.rad",
    );
    await expect(dialog.locator("#newCaptureGeometry")).toHaveAttribute(
      "accept",
      ".ply,.e57,.las,.laz,.pts",
    );
    await expect(dialog.locator("#newCaptureGeometry")).toHaveAttribute(
      "required",
      "",
    );
    await expect(dialog.getByText(
      "Required. Choose the registered PLY, E57, LAS, LAZ, or PTS point cloud exported from the same scan. It supplies the floor plan, collision shell, and walking map.",
      { exact: true },
    )).toBeVisible();
    const frameConfirmation = dialog.getByLabel(
      "I confirm both files came from the same unchanged capture coordinate system.",
      { exact: true },
    );
    await expect(dialog.locator("#newCaptureFrameConfirmation")).toBeHidden();
    await dialog.getByRole("combobox", {
      name: "Which pipeline produced these files?",
      exact: true,
    }).selectOption("open-import");
    await expect(dialog.locator("#newCaptureGeometry")).toHaveAttribute("required", "");
    await expect(dialog.getByLabel("Delivery template", { exact: true })).toHaveCount(0);
    const maximumAssetFileName =
      `${"registered-capture-visual-evidence-".repeat(10).slice(0, 251)}.spz`;
    expect(maximumAssetFileName).toHaveLength(255);
    await dialog.locator("#newCaptureAsset").setInputFiles({
      name: maximumAssetFileName,
      mimeType: "application/octet-stream",
      buffer: Buffer.from("visual"),
    });
    await dialog.locator("#newCaptureGeometry").setInputFiles({
      name: "atrium.e57",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("geometry"),
    });
    await expect.poll(() => dialog.locator("#newCaptureAsset").evaluate(
      (input) => (input as HTMLInputElement).files?.[0]?.name.length ?? 0,
    )).toBe(255);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectResponsiveSurface(page, "#newProjectDialog");
    await expect(frameConfirmation).toBeVisible();
    await expect(frameConfirmation).toHaveAttribute("required", "");
    await frameConfirmation.check();
    await dialog.getByRole("button", { name: "Review processing plan", exact: true }).click();
    await expect(dialog.getByText("✓ Prepare the browser scene", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Create and process scene", exact: true })).toBeVisible();
    await expectResponsiveSurface(page, "#newProjectDialog");
  });

  test("constraint feedback stays with the invalid field and clears after correction", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-08-24T08:00:00.000Z"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Upload capture", exact: true }).click();
    const dialog = page.locator("#newProjectDialog");
    const field = dialog.locator("#newCaptureName");
    const fieldLabel = dialog.locator('label[for="newCaptureName"]');

    await dialog.getByRole("button", { name: "Continue to files", exact: true }).click();

    await expect(field).toHaveAttribute("aria-invalid", "true");
    const errorId = await field.getAttribute("aria-errormessage");
    expect(errorId).toBeTruthy();
    const fieldMessage = fieldLabel.locator(`#${errorId}`);
    await expect(fieldMessage).toBeVisible();
    await expect(fieldMessage).not.toBeEmpty();
    await expect(dialog.locator("#projectError")).toBeEmpty();
    const validationGap = await fieldLabel.evaluate((label) => {
      const control = label.querySelector("input")!.getBoundingClientRect();
      const message = label.querySelector<HTMLElement>(".field-message")!.getBoundingClientRect();
      return message.top - control.bottom;
    });
    expect(validationGap).toBeGreaterThan(0);
    await field.evaluate((input) => input.blur());
    await expectReviewedScreenshot(page, "studio-inline-validation-phone.png");

    await field.fill("Atrium walkthrough");
    await expect(field).not.toHaveAttribute("aria-invalid");
    await expect(field).not.toHaveAttribute("aria-errormessage");
    await expect(fieldMessage).toBeHidden();
  });

  test("server field failures stay inline while action evidence remains singular", async ({ page }) => {
    let saveAttempts = 0;
    await page.route("**/api/project-views", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      saveAttempts += 1;
      if (saveAttempts > 1) {
        await json(route, 200, {
          view: {
            id: "94949494-9494-4494-8494-949494949494",
            name: "Recovered view",
            filter: {
              query: "",
              statuses: [],
              captureAdapters: [],
              deliveryTemplates: [],
              sort: "updated_desc",
            },
            isDefault: false,
            createdAt: now,
            updatedAt: now,
          },
        });
        return;
      }
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        headers: { "x-request-id": "request-saved-view" },
        body: JSON.stringify({
          error: "Validation failed",
          details: {
            fieldErrors: { name: ["A saved view already uses this name"] },
            formErrors: [],
          },
        }),
      });
    });
    await page.locator("#projectAdvancedFilters").getByText("Filters and saved views", {
      exact: true,
    }).click();
    await page.getByRole("button", { name: "Save view", exact: true }).click();

    const dialog = page.locator("#savedViewDialog");
    const name = dialog.getByLabel("View name", { exact: true });
    const submit = dialog.getByRole("button", { name: "Save project view", exact: true });
    await name.fill("Duplicate view");
    await dialog.locator(".dialog-close").click();
    const discard = page.locator("#askDialog");
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue("Duplicate view");
    await submit.click();

    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toBeFocused();
    const errorId = await name.getAttribute("aria-errormessage");
    expect(errorId).toBeTruthy();
    await expect(dialog.locator(`#${errorId}`)).toHaveText("A saved view already uses this name.");
    const actionFeedback = dialog.locator("#savedViewError");
    await expect(actionFeedback).toContainText("Validation failed.");
    await expect(actionFeedback).toContainText("Reference: request-saved-view.");
    await expect(actionFeedback).not.toContainText("A saved view already uses this name");
    await expect(dialog.locator('[role="alert"]:visible')).toHaveCount(1);
    await expect(submit).toHaveAttribute("aria-describedby", /savedViewError/);

    await name.fill("");
    await submit.click();
    await expect(actionFeedback).toBeHidden();
    await expect(submit).not.toHaveAttribute("aria-describedby");
    await expect(name).toBeFocused();

    await name.fill("Recovered view");
    await submit.click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#toast")).toHaveText("Project view saved");
    expect(saveAttempts).toBe(2);

    await page.getByRole("button", { name: "Save view", exact: true }).click();
    await expect(name).not.toHaveAttribute("aria-invalid");
    await expect(name).not.toHaveAttribute("aria-errormessage");
    await expect(actionFeedback).toBeHidden();
  });

  test("primary project forms propagate server field failures to the shared feedback owner", async ({ page }) => {
    await page.route(`**/api/projects/${projectId}`, async (route) => {
      if (route.request().method() === "GET") {
        return json(route, 200, {
          project: {
            id: projectId,
            name: "Responsive indoor scene",
            slug: "responsive-indoor-scene",
            status: "INGESTED",
            captureAdapter: "open-import",
            deliveryTemplate: "venue-navigator",
            notes: "Stable UI acceptance fixture.",
            customerName: "WhyMe Labs",
            customFields: {},
            latestVersionId: null,
            latestVersionNumber: null,
            activeReleaseSlug: null,
            updatedAt: now,
          },
          versions: [],
          assets: [],
          jobs: [],
          releases: [],
          captureBundles: [],
          comparisonReadiness: { available: false, eligiblePairs: [], versions: [] },
          previewReadyVersionIds: [],
        });
      }
      if (route.request().method() !== "PATCH") return route.fallback();
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        headers: { "x-request-id": "request-project-settings" },
        body: JSON.stringify({
          error: "Project settings were not accepted",
          details: {
            fieldErrors: { name: ["Use a unique project name"] },
            formErrors: [],
          },
        }),
      });
    });
    await page.getByRole("button", { name: "Open Responsive indoor scene" }).click();
    await page.getByRole("button", { name: "Work", exact: true }).click();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.getByText("Technical details and source history", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Edit project settings" })).toBeVisible();
    await page.getByRole("button", { name: "Edit project settings" }).click();

    const dialog = page.locator("#editProjectDialog");
    const name = dialog.getByLabel("Project name", { exact: true });
    const submit = dialog.getByRole("button", { name: "Save project settings", exact: true });
    await name.fill("Rejected duplicate project name");
    await submit.click();

    await expect(name).toHaveAttribute("aria-invalid", "true");
    const errorId = await name.getAttribute("aria-errormessage");
    expect(errorId).toBeTruthy();
    await expect(dialog.locator(`#${errorId}`)).toHaveText("Use a unique project name.");
    await expect(dialog.locator("#editProjectError")).toContainText(
      "Project settings were not accepted.",
    );
    await expect(dialog.locator("#editProjectError")).toContainText(
      "Reference: request-project-settings.",
    );
  });

  test("record workspaces do not own or nest live announcements", async ({ page }) => {
    for (const id of [
      "projectTable",
      "releaseList",
      "reviewInbox",
      "hostingOverview",
      "spatialOverview",
      "measurementOverview",
      "publishOverview",
      "teamOverview",
      "comparisonGrid",
    ]) {
      await expect(page.locator(`#${id}`)).not.toHaveAttribute("aria-live");
    }
    await expect(page.locator('[aria-live] [role="alert"], [role="alert"] [aria-live]'))
      .toHaveCount(0);
  });

  test("capture intake keeps required organisation metadata visible", async ({ page }) => {
    await page.route("**/api/project-fields", async (route) => {
      await json(route, 200, {
        fields: [{
          id: "91919191-9191-4919-8919-919191919191",
          key: "portfolio_code",
          label: "Portfolio code",
          description: "Required by this workspace.",
          type: "text",
          required: true,
          options: [],
          active: true,
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
        }, {
          id: "92929292-9292-4929-8929-929292929292",
          key: "site_reference",
          label: "Site reference",
          description: null,
          type: "text",
          required: false,
          options: [],
          active: true,
          sortOrder: 1,
          createdAt: now,
          updatedAt: now,
        }],
      });
    });
    await page.reload();

    await page.getByRole("button", { name: "Upload capture", exact: true }).click();
    const dialog = page.locator("#newProjectDialog");
    const requiredField = dialog.getByLabel("Portfolio code", { exact: true });
    const optionalDetails = dialog.locator("#newProjectOptionalDetails");

    await expect(requiredField).toBeVisible();
    await expect(requiredField).toHaveAttribute("required", "");
    await expect(optionalDetails).not.toHaveAttribute("open", "");
    await expect(dialog.getByLabel("Site reference", { exact: true })).toBeHidden();
    await expect(optionalDetails.getByText("Optional project details · 5 fields", { exact: true })).toBeVisible();
  });

  test("portfolio administration and saved project filters are reachable", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Portfolio tools", exact: true })).toBeVisible();
    await expect(page.locator("#projectAdvancedFilters")).toBeVisible();
    await page.locator("#projectAdvancedFilters").getByText("Filters and saved views", {
      exact: true,
    }).click();
    await expect(page.locator("#savedProjectView")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save view", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Portfolio tools", exact: true }).click();
    await expect(page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "Templates and portable metadata." }),
    })).toBeVisible();
  });

  test("saved project defaults configure a new capture", async ({ page }) => {
    await page.route("**/api/project-templates", async (route) => {
      await json(route, 200, {
        templates: [{
          id: "93939393-9393-4939-8939-939393939393",
          name: "Museum evidence pack",
          description: "Defaults for specialist gallery evidence.",
          captureAdapter: "open-import",
          deliveryTemplate: "Venue navigator",
          notes: "Preserve the accessible public route.",
          createdAt: now,
          updatedAt: now,
        }],
      });
    });
    await page.reload();

    await page.getByRole("button", { name: "Upload capture", exact: true }).click();
    const dialog = page.locator("#newProjectDialog");
    await dialog.locator("#newProjectOptionalDetails").getByText(
      "Optional project details · 4 fields",
      { exact: true },
    ).click();
    await dialog.locator("#newProjectTemplate")
      .selectOption("93939393-9393-4939-8939-939393939393");

    await expect(dialog.locator("#newCaptureAdapter")).toHaveValue("open-import");
    await expect(dialog.locator("textarea[name='notes']")).toHaveValue(
      "Preserve the accessible public route.",
    );
  });

  test("capture contracts do not invent an identity scene registration", async ({ page }) => {
    await page.locator("#captureBundleDialog").evaluate((dialog) =>
      (dialog as HTMLDialogElement).showModal()
    );
    const toggle = page.getByLabel("Attach a reviewed numeric capture-to-scene registration");
    const evidence = page.locator("#captureRegistrationEvidence");
    await expect(toggle).not.toBeChecked();
    await expect(evidence).toBeHidden();
    for (const name of [
      "registrationYawDegrees",
      "registrationTranslationX",
      "registrationTranslationY",
      "registrationTranslationZ",
    ]) {
      await expect(page.locator(`#captureBundleForm [name='${name}']`)).toHaveValue("");
    }
    await toggle.check();
    await expect(evidence).toBeVisible();
    await expect(evidence).toHaveAttribute("required", "");
  });

  test("studio shell uses the shared type system and responsive control layout", async ({ page }) => {
    const sort = page.locator("#projectSort");
    await sort.selectOption("name_asc");
    await expect(sort).toHaveValue("name_asc");

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expectResponsiveSurface(page, ".studio-shell");

      const contract = await page.evaluate(() => {
        const commandBar = document.querySelector(".project-command-bar");
        const search = document.querySelector("#projectSearch");
        const selects = [...document.querySelectorAll<HTMLSelectElement>(
          ".studio-shell select:not([hidden])",
        )].filter((element) => element.getClientRects().length > 0);
        const gaps = [...document.querySelectorAll<HTMLElement>(
          ".studio-header-actions, .filter-row, .project-command-bar",
        )].filter((element) => element.getClientRects().length > 0)
          .map((element) => Number.parseFloat(getComputedStyle(element).gap || "0"));
        return {
          commandColumns: commandBar ? getComputedStyle(commandBar).gridTemplateColumns : null,
          searchTextOverflow: search ? getComputedStyle(search).textOverflow : null,
          searchMinWidth: search ? getComputedStyle(search).minWidth : null,
          selects: selects.map((select) => ({
            height: select.getBoundingClientRect().height,
            width: select.getBoundingClientRect().width,
            parentWidth: select.parentElement?.getBoundingClientRect().width ?? 0,
            fontFamily: getComputedStyle(select).fontFamily,
          })),
          gaps,
        };
      });

      expect(contract.searchTextOverflow).toBe("ellipsis");
      expect(contract.searchMinWidth).toBe("0px");
      expect(contract.selects.length).toBeGreaterThan(0);
      for (const select of contract.selects) {
        expect(select.height).toBeGreaterThanOrEqual(44);
        expect(select.width).toBeLessThanOrEqual(select.parentWidth + 1);
        expect(select.fontFamily).toContain("Manrope");
      }
      expect(contract.gaps.every((gap) => gap >= 10)).toBe(true);
      if (viewport.width <= 640) {
        expect(contract.commandColumns?.trim().split(/\s+/)).toHaveLength(1);
      } else {
        expect(contract.commandColumns?.trim().split(/\s+/)).toHaveLength(2);
      }
    }
  });

  test("reviewed Studio visual baselines cover every supported transition viewport", async ({ page }) => {
    expect(maximumProjectName).toHaveLength(120);
    expect(maximumReleaseSlug).toHaveLength(80);
    await page.clock.setFixedTime(new Date("2026-08-24T08:00:00.000Z"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#projectSort").selectOption("name_asc");
    await page.evaluate(() => document.fonts.ready);

    for (const viewport of RESPONSIVE_VISUAL_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => scrollTo(0, 0));
      const composition = await page.evaluate(() => {
        const visibleInViewport = (element: HTMLElement) => {
          const style = getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          return style.display !== "none"
            && style.visibility !== "hidden"
            && bounds.width > 0
            && bounds.height > 0
            && bounds.bottom > 0
            && bounds.top < innerHeight;
        };
        const clippedActions = [...document.querySelectorAll<HTMLElement>(
          ".studio-shell :is(button,a[href],input,select,textarea,summary)",
        )].filter(visibleInViewport).filter((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.left < -1 || bounds.right > innerWidth + 1;
        }).map((element) => element.textContent?.trim() || element.getAttribute("aria-label"));
        const unusableText = [...document.querySelectorAll<HTMLElement>(
          ".studio-header h1, .project-row .record-primary",
        )].filter(visibleInViewport).filter((element) => element.clientWidth <= 0);
        return {
          clippedActions,
          unusableTextCount: unusableText.length,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
        };
      });
      expect(composition.clippedActions, viewport.name).toEqual([]);
      expect(composition.unusableTextCount, viewport.name).toBe(0);
      expect(composition.documentWidth, viewport.name).toBeLessThanOrEqual(
        composition.viewportWidth + 1,
      );
      await expectReviewedScreenshot(page, `studio-projects-${viewport.name}.png`);
    }
  });

  test("reviewed Studio state baseline keeps pending and completed processing distinct", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-08-24T08:00:00.000Z"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/jobs", (route) => json(route, 200, {
      jobs: [{
        id: "66666666-6666-4666-8666-666666666671",
        project_id: projectId,
        version_id: null,
        project_name: maximumProjectName,
        job_type: "scene.prepare",
        state: "PROCESSING",
        progress: 52,
        progress_message: "Building the browser scene and retaining the upload receipt",
        attempt_count: 1,
        max_attempts: 3,
        created_at: now,
      }, {
        id: "66666666-6666-4666-8666-666666666672",
        project_id: projectId,
        version_id: null,
        project_name: maximumProjectName,
        job_type: "asset.validate",
        state: "SUCCEEDED",
        progress: 100,
        progress_message: "Source evidence validated",
        attempt_count: 1,
        max_attempts: 3,
        created_at: now,
      }],
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const advanced = page.locator(".studio-nav-advanced");
    await advanced.getByText("Advanced tools", { exact: true }).click();
    await page.getByRole("button", { name: "Processing activity", exact: true }).click();
    await expect(page.getByText("Building the browser scene", { exact: false })).toBeVisible();
    await expect(page.getByText("Source evidence validated", { exact: true })).toBeVisible();
    await expectReviewedScreenshot(page, "studio-processing-pending-phone.png");
  });

  test("the active Studio workspace owns the full grid at transition widths", async ({ page }) => {
    const expectOnlyVisibleWorkspaceOwnsGrid = async (
      workspaceSelector: string,
      expectedShellTracks: number,
    ): Promise<void> => {
      const geometry = await page.locator("#studioGrid").evaluate((grid, selector) => {
        const workspace = grid.querySelector<HTMLElement>(selector);
        const shell = document.querySelector<HTMLElement>(".studio-shell");
        if (!workspace || !shell) return null;
        const gridBounds = grid.getBoundingClientRect();
        const workspaceBounds = workspace.getBoundingClientRect();
        return {
          bodyOverflowX: getComputedStyle(document.body).overflowX,
          shellTracks: getComputedStyle(shell).gridTemplateColumns.trim().split(/\s+/),
          gridTracks: getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/),
          gridWidth: gridBounds.width,
          workspaceWidth: workspaceBounds.width,
          visibleChildren: [...grid.children].filter((child) => (
            child.getClientRects().length > 0 && getComputedStyle(child).display !== "none"
          )).length,
        };
      }, workspaceSelector);

      expect(geometry).not.toBeNull();
      expect(geometry!.bodyOverflowX).not.toBe("hidden");
      expect(geometry!.shellTracks).toHaveLength(expectedShellTracks);
      expect(geometry!.gridTracks).toHaveLength(1);
      expect(geometry!.visibleChildren).toBe(1);
      expect(Math.abs(geometry!.gridWidth - geometry!.workspaceWidth)).toBeLessThanOrEqual(1);
    };

    for (const width of studioShellTransitionWidths) {
      await page.setViewportSize({ width, height: 800 });
      const expectedShellTracks = width <= 960 ? 1 : 2;

      await page.getByRole("button", { name: "Projects", exact: true }).click();
      await expectOnlyVisibleWorkspaceOwnsGrid("#projectBoard", expectedShellTracks);

      const advancedTools = page.locator(".studio-nav-advanced");
      if (await advancedTools.getAttribute("open") === null) {
        await advancedTools.getByText("Advanced tools", { exact: true }).click();
      }
      await page.getByRole("button", { name: "Processing activity", exact: true }).click();
      await expectOnlyVisibleWorkspaceOwnsGrid("#queuePanel", expectedShellTracks);
    }
  });

  test("the Studio shell stays continuous through every critical transition pixel", async ({ page }) => {
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    const receipt: Array<{
      width: number;
      shellTracks: number;
      gridWidth: number;
      workspaceWidth: number;
      sidebarWidth: number;
    }> = [];

    for (let width = 945; width <= 1110; width += 1) {
      await page.setViewportSize({ width, height: 800 });
      const geometry = await page.evaluate(() => {
        const shell = document.querySelector<HTMLElement>(".studio-shell")!;
        const sidebar = document.querySelector<HTMLElement>(".studio-sidebar")!;
        const grid = document.querySelector<HTMLElement>("#studioGrid")!;
        const workspace = document.querySelector<HTMLElement>("#projectBoard")!;
        return {
          shellTracks: getComputedStyle(shell).gridTemplateColumns.trim().split(/\s+/).length,
          gridWidth: grid.getBoundingClientRect().width,
          workspaceWidth: workspace.getBoundingClientRect().width,
          sidebarWidth: sidebar.getBoundingClientRect().width,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
          bodyOverflowX: getComputedStyle(document.body).overflowX,
        };
      });

      expect(geometry.bodyOverflowX, `${width}px root overflow owner`).not.toBe("hidden");
      expect(geometry.documentWidth, `${width}px document width`).toBeLessThanOrEqual(
        geometry.viewportWidth + 1,
      );
      expect(geometry.shellTracks, `${width}px shell tracks`).toBe(width <= 960 ? 1 : 2);
      expect(
        Math.abs(geometry.gridWidth - geometry.workspaceWidth),
        `${width}px active workspace ownership`,
      ).toBeLessThanOrEqual(1);
      if (width > 960) {
        expect(
          geometry.workspaceWidth,
          `${width}px primary workspace versus navigation rail`,
        ).toBeGreaterThan(geometry.sidebarWidth);
      }

      const previous = receipt.at(-1);
      if (previous?.shellTracks === geometry.shellTracks) {
        expect(
          geometry.workspaceWidth,
          `${width}px workspace continuity`,
        ).toBeGreaterThanOrEqual(previous.workspaceWidth);
      }
      receipt.push({ width, ...geometry });
    }

    await test.info().attach("studio-transition-corridor.json", {
      body: Buffer.from(JSON.stringify(receipt, null, 2)),
      contentType: "application/json",
    });
  });

  test("every columnar Studio row shares one column geometry contract", async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);

      await page.getByRole("button", { name: "Projects", exact: true }).click();
      if (viewport.width > 640) await expectColumnsAligned(page, ".project-row");
      else await expect(page.locator(".project-row.record-row")).toHaveCount(2);

      const advancedTools = page.locator(".studio-nav-advanced");
      if (await advancedTools.getAttribute("open") === null) {
        await advancedTools.getByText("Advanced tools", { exact: true }).click();
      }
      await page.getByRole("button", { name: "Processing activity", exact: true }).click();
      if (viewport.width > 640) await expectColumnsAligned(page, ".queue-item");
      else await expect(page.locator(".queue-item.record-row")).toHaveCount(2);

      await page.getByRole("button", { name: "Published previews", exact: true }).click();
      if (viewport.width > 1100) await expectColumnsAligned(page, ".release-list-row");
      else await expect(page.locator(".release-list-row.record-row")).toHaveCount(2);

      // Team access is a primary nav destination now that inviting is the only
      // way anyone gets access.
      await page.getByRole("button", { name: "Team access", exact: true }).click();
      if (viewport.width > 760) await expectColumnsAligned(page, ".team-member-row");
      else await expect(page.locator(".team-member-row.record-row")).toHaveCount(2);

      await page.evaluate(() => {
        const fixture = document.createElement("div");
        fixture.dataset.geometryColumnFixture = "true";
        for (const values of [
          ["Kitchen wall", "12 mm max", "Unchanged"],
          ["Long corridor partition label", "180 mm max", "Changed"],
        ]) {
          const row = document.createElement("div");
          row.className = "geometry-change-row";
          for (const [index, value] of values.entries()) {
            const cell = document.createElement("span");
            cell.textContent = value;
            if (index === 2) cell.className = "status-pill";
            row.append(cell);
          }
          fixture.append(row);
        }
        document.querySelector(".studio-main")?.append(fixture);
      });
      await expectColumnsAligned(page, ".geometry-change-row");
      await page.locator("[data-geometry-column-fixture]").evaluate((fixture) => fixture.remove());
      await expectResponsiveSurface(page, ".studio-shell");
    }
  });

  test("long operational records use explicit responsive priorities", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-08-24T08:00:00.000Z"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 800 });
    const longProjects = Array.from({ length: 100 }, (_, index) => ({
      id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
      name: (
        `Conservation capture ${String(index + 1).padStart(3, "0")} with reviewed operational evidence `
          .repeat(3)
          .slice(0, 120)
      ),
      slug: `conservation-capture-${index + 1}`,
      status: index % 2 === 0 ? "INGESTED" : "PUBLISHED",
      captureAdapter: "registered-open-import-with-expanded-source-identifier",
      deliveryTemplate: "venue-navigator",
      notes: null,
      customerName: "An institution with an expanded portfolio identity",
      customFields: {},
      latestVersionId: null,
      latestVersionNumber: null,
      activeReleaseSlug: null,
      updatedAt: now,
    }));
    expect(longProjects.every((project) => project.name.length === 120)).toBe(true);
    let projectFixtureCount = 100;
    await page.route("**/api/projects", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await json(route, 200, { projects: longProjects.slice(0, projectFixtureCount) });
    });
    for (const count of [0, 1, 10, 100]) {
      projectFixtureCount = count;
      await page.reload();
      await expect(page.locator("#projectTable .record-row")).toHaveCount(count);
      if (count === 0) {
        await expect(page.locator("#projectTable .empty-state")).toBeVisible();
        await expectReviewedScreenshot(page, "studio-empty-projects-standard-laptop.png");
      }
    }
    await expectReviewedScreenshot(page, "studio-maximum-records-standard-laptop.png");
    await expect(page.getByRole("button", {
      name: `Open ${longProjects.at(-1)!.name}`,
      exact: true,
    })).toBeVisible();

    const expectContainedRecords = async (
      selector: string,
      expectedKinds: readonly string[],
    ): Promise<void> => {
      const records = await page.locator(selector).evaluateAll((rows) => rows
        .filter((row) => row.getClientRects().length > 0)
        .map((row) => {
          const bounds = row.getBoundingClientRect();
          const actions = [...row.querySelectorAll<HTMLElement>("button, a, summary, select")]
            .filter((action) => action.getClientRects().length > 0)
            .map((action) => {
              const actionBounds = action.getBoundingClientRect();
              return {
                left: actionBounds.left,
                right: actionBounds.right,
              };
            });
          return {
            kind: (row as HTMLElement).dataset.recordKind ?? "",
            hasPrimary: Boolean(row.querySelector(":scope > .record-primary")),
            left: bounds.left,
            right: bounds.right,
            clientWidth: (row as HTMLElement).clientWidth,
            scrollWidth: (row as HTMLElement).scrollWidth,
            viewportWidth: window.innerWidth,
            actions,
          };
        }));
      expect(records.length, `${selector} has visible records`).toBeGreaterThan(0);
      for (const record of records) {
        expect(expectedKinds, `${selector} declares ${record.kind}`).toContain(record.kind);
        expect(record.hasPrimary, `${record.kind} declares an identity slot`).toBe(true);
        expect(record.left, `${record.kind} left containment`).toBeGreaterThanOrEqual(-1);
        expect(record.right, `${record.kind} right containment`).toBeLessThanOrEqual(record.viewportWidth + 1);
        expect(record.scrollWidth, `${record.kind} internal overflow`).toBeLessThanOrEqual(record.clientWidth + 1);
        for (const action of record.actions) {
          expect(action.left, `${record.kind} action left containment`).toBeGreaterThanOrEqual(-1);
          expect(action.right, `${record.kind} action right containment`).toBeLessThanOrEqual(record.viewportWidth + 1);
        }
      }
      await expectResponsiveSurface(page, ".studio-shell");
    };

    for (const viewport of viewports.slice(1)) {
      await page.setViewportSize(viewport);
      await page.getByRole("button", { name: "Projects", exact: true }).click();
      await expectContainedRecords("#projectTable .record-row", ["project"]);
      const projectHeader = page.locator("#projectTable .record-table-header");
      if (viewport.width <= 640) await expect(projectHeader).toBeHidden();
      else await expect(projectHeader).toBeVisible();

      const advanced = page.locator(".studio-nav-advanced");
      if (await advanced.getAttribute("open") === null) {
        await advanced.getByText("Advanced tools", { exact: true }).click();
      }
      await page.getByRole("button", { name: "Processing activity", exact: true }).click();
      await expectContainedRecords("#jobList .record-row", ["job"]);

      await page.getByRole("button", { name: "Client review", exact: true }).click();
      if (await page.locator("#reviewInbox .record-row").count() === 0) {
        await page.getByRole("button", { name: "Open activity", exact: true }).click();
      }
      await expect(page.locator("#reviewInbox .record-row")).toHaveCount(2);
      await expectContainedRecords("#reviewInbox .record-row", ["review-comment", "reviewer"]);

      await page.getByRole("button", { name: "Published previews", exact: true }).click();
      await expectContainedRecords("#releaseList .record-row", ["release"]);
      const release = page.locator("#releaseList .record-row").first();
      await expect(release.locator(".record-primary")).toBeVisible();
      await expect(release.locator(".record-status")).toBeVisible();
      await expect(release.locator(".record-essential")).toBeVisible();
      await expect(release.getByText("More release actions", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Team access", exact: true }).click();
      await expectContainedRecords("#teamOverview .record-row", ["team-member", "team-invitation"]);

      if (await advanced.getAttribute("open") === null) {
        await advanced.getByText("Advanced tools", { exact: true }).click();
      }
      await page.getByRole("button", { name: "Hosting & lifecycle", exact: true }).click();
      await expectContainedRecords("#hostingOverview .record-row", [
        "hosting-subscription",
        "invoice",
        "checkout",
      ]);
      await expect(page.getByRole("button", { name: "Mark paid", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Void", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Resume secure checkout", exact: true })).toBeVisible();
    }

    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole("button", { name: "Published previews", exact: true }).click();
    const firstRelease = page.locator("#releaseList .record-row").first();
    await firstRelease.getByText("More release actions", { exact: true }).click();
    await expect(firstRelease.getByRole("button", { name: "Export traversal evidence" })).toBeVisible();
    await expect(firstRelease.getByRole("button", { name: "Revoke" })).toBeVisible();
    await expectContainedRecords("#releaseList .record-row", ["release"]);
  });

  test("normal Studio actions stay within two bordered content surfaces", async ({ page }) => {
    const expectSurfaceDepth = async (): Promise<void> => {
      const depths = await page.locator(".studio-main button:visible, .studio-main a:visible")
        .evaluateAll((actions) => actions.map((action) => {
          let depth = 0;
          let current = action.parentElement;
          while (current && !current.classList.contains("studio-main")) {
            const style = getComputedStyle(current);
            if (
              style.borderStyle !== "none" &&
              Number.parseFloat(style.borderTopWidth) > 0
            ) depth += 1;
            current = current.parentElement;
          }
          return { label: action.textContent?.trim() ?? action.tagName, depth };
        }));
      expect(depths.length).toBeGreaterThan(0);
      expect(depths.filter((entry) => entry.depth > 2)).toEqual([]);
      const unownedSurfaces = await page.locator([
        ".workspace-card-large:visible",
        ".detail-card:visible",
        ".project-detail-disclosure:visible",
        ".worker-card:visible",
      ].join(", ")).evaluateAll((surfaces) => surfaces
        .filter((surface) => !surface.getAttribute("data-surface-role"))
        .map((surface) => surface.className));
      expect(unownedSurfaces).toEqual([]);
    };

    await expectSurfaceDepth();
    await page.getByText("Advanced tools", { exact: true }).click();
    for (const name of [
      "Processing activity",
      "Client review",
      "Hosting & lifecycle",
    ]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expectSurfaceDepth();
    }
    await page.getByRole("button", { name: "Published previews", exact: true }).click();
    await expectSurfaceDepth();
    await page.getByRole("button", { name: "Team access", exact: true }).click();
    await expectSurfaceDepth();
  });

  test("traversal evidence download keeps the complete server digest visible", async ({ page }) => {
    await page.getByText("Advanced tools", { exact: true }).click();
    await page.getByRole("button", { name: "Published previews", exact: true }).click();
    await page.getByText("More release actions", { exact: true }).first().click();
    await page.getByRole("button", { name: "Export traversal evidence" }).first().click();
    await expect(page.locator("#globalNotice")).toContainText(`SHA-256 ${"a".repeat(64)}`);
  });

  test("archived projects stay out of current production and remain recoverable", async ({ page }) => {
    const projects = page.locator("#projectTable");
    await expect(projects.getByText("Archived alignment fixture", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await expect(projects.getByText("Archived alignment fixture", { exact: true })).toBeVisible();
    await expect(projects.getByText("Responsive indoor scene", { exact: true })).toHaveCount(0);
  });

  test("provisional navigation authoring is labelled in scene units instead of metres", async ({
    page,
  }) => {
    await expect(page.locator(
      "#semanticExtractionForm select[name='worldUnit']",
    )).toHaveValue("scene_units");
    await expect(page.locator(
      "#navigationProfileForm select[name='worldUnit']",
    )).toHaveValue("scene_units");
    await expect(page.locator(
      "#releaseForm select[name='releaseWorldUnit']",
    )).toHaveValue("scene_units");
    await expect(page.locator(
      "#releaseForm input[name='sceneRotationX']",
    )).toHaveValue("0");
    await expect(page.locator(
      "#releaseForm input[name='sceneRotationY']",
    )).toHaveValue("0");
    await expect(page.locator(
      "#releaseForm input[name='sceneRotationZ']",
    )).toHaveValue("0");
    for (const axis of ["X", "Y", "Z"]) {
      const input = page.locator(`#releaseForm input[name='sceneRotation${axis}']`);
      await expect(input).toHaveAttribute("min", String(SCENE_ROTATION_MIN_DEGREES));
      await expect(input).toHaveAttribute("max", String(SCENE_ROTATION_MAX_DEGREES));
    }
    await expect(page.locator("#semanticExtractionDialog")).toContainText(
      "SU supports aligned navigation but not metre or area claims",
    );
    await expect(page.locator("#releaseDialog")).toContainText(
      "Provisional SU releases support navigation",
    );
    await expect(page.locator("#releaseDialog")).toContainText(
      "Visual orientation only",
    );
  });

  test("every dialog declares one task and one main scroll owner", async ({ page }) => {
    const contracts = await page.locator("dialog.dialog-card").evaluateAll((dialogs) => dialogs.map((dialog) => ({
      id: dialog.id,
      purpose: (dialog as HTMLElement).dataset.dialogPurpose ?? "",
      standardShells: dialog.querySelectorAll(":scope > .dialog-shell").length,
      standardHeaders: dialog.querySelectorAll(":scope > .dialog-shell > .dialog-shell-header").length,
      standardBodies: dialog.querySelectorAll(":scope > .dialog-shell > .dialog-shell-body").length,
      standardFooters: dialog.querySelectorAll(":scope > .dialog-shell > .dialog-shell-footer").length,
      composite: dialog.classList.contains("dialog-composite-shell"),
      comparison: dialog.id === "versionComparisonDialog",
    })));
    expect(contracts.length).toBeGreaterThan(20);
    expect(contracts.filter((dialog) => !dialog.purpose)).toEqual([]);
    for (const dialog of contracts) {
      if (dialog.composite || dialog.comparison) continue;
      expect(dialog.standardShells, `${dialog.id} shell`).toBe(1);
      expect(dialog.standardHeaders, `${dialog.id} header`).toBe(1);
      expect(dialog.standardBodies, `${dialog.id} body`).toBe(1);
      expect(dialog.standardFooters, `${dialog.id} footer`).toBe(1);
    }

    await page.setViewportSize({ width: 844, height: 390 });
    for (const contract of contracts.filter((dialog) => !dialog.composite && !dialog.comparison)) {
      const dialog = page.locator(`#${contract.id}`);
      await dialog.evaluate((element) => {
        const current = element as HTMLDialogElement;
        document.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach((openDialog) => {
          if (openDialog !== current) openDialog.close();
        });
        current.show();
      });
      const geometry = await dialog.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const header = element.querySelector<HTMLElement>(".dialog-shell-header")?.getBoundingClientRect();
        const body = element.querySelector<HTMLElement>(".dialog-shell-body")?.getBoundingClientRect();
        const footer = element.querySelector<HTMLElement>(".dialog-shell-footer")?.getBoundingClientRect();
        const visibleActions = [...element.querySelectorAll<HTMLElement>(".dialog-shell-footer button")]
          .filter((action) => action.getClientRects().length > 0)
          .map((action) => action.getBoundingClientRect());
        return {
          bounds: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom },
          header: header ? { top: header.top, bottom: header.bottom } : null,
          body: body ? { top: body.top, bottom: body.bottom } : null,
          footer: footer ? { top: footer.top, bottom: footer.bottom } : null,
          visibleActions: visibleActions.map((action) => ({ top: action.top, bottom: action.bottom })),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        };
      });
      expect(geometry.header, `${contract.id} header`).not.toBeNull();
      expect(geometry.body, `${contract.id} body`).not.toBeNull();
      expect(geometry.footer, `${contract.id} footer`).not.toBeNull();
      expect(geometry.bounds.left, `${contract.id} left`).toBeGreaterThanOrEqual(-1);
      expect(geometry.bounds.right, `${contract.id} right`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(geometry.bounds.top, `${contract.id} top`).toBeGreaterThanOrEqual(-1);
      expect(geometry.bounds.bottom, `${contract.id} bottom`).toBeLessThanOrEqual(geometry.viewportHeight + 1);
      for (const action of geometry.visibleActions) {
        expect(action.top, `${contract.id} action top`).toBeGreaterThanOrEqual(-1);
        expect(action.bottom, `${contract.id} action bottom`).toBeLessThanOrEqual(geometry.viewportHeight + 1);
      }
      await dialog.evaluate((element) => (element as HTMLDialogElement).close());
    }

    const comparison = page.locator("#versionComparisonDialog");
    await comparison.evaluate((dialog) => (dialog as HTMLDialogElement).show());
    const comparisonContract = await comparison.evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect();
      const grid = dialog.querySelector<HTMLElement>(".comparison-grid");
      const gridBounds = grid?.getBoundingClientRect();
      return {
        bottom: bounds.bottom,
        viewportHeight: window.innerHeight,
        gridBottom: gridBounds?.bottom ?? 0,
        gridOverflowY: grid ? getComputedStyle(grid).overflowY : null,
      };
    });
    expect(comparisonContract.bottom).toBeLessThanOrEqual(comparisonContract.viewportHeight + 1);
    expect(comparisonContract.gridBottom).toBeLessThanOrEqual(comparisonContract.viewportHeight + 1);
    expect(comparisonContract.gridOverflowY).toBe("auto");
    await comparison.evaluate((dialog) => (dialog as HTMLDialogElement).close());

    await page.getByRole("button", { name: "Portfolio tools", exact: true }).click();
    const portfolio = page.locator("#portfolioToolsDialog");
    const picker = portfolio.locator(".portfolio-task-picker select");
    await expect(picker).toBeVisible();
    await expect(portfolio.locator(".portfolio-tool-section:visible")).toHaveCount(1);
    await picker.selectOption({ label: "Import metadata" });
    await expect(portfolio.getByRole("heading", {
      name: "Preview, then create DRAFT projects",
      exact: true,
    })).toBeVisible();
    await expect(portfolio.locator(".portfolio-tool-section:visible")).toHaveCount(1);
    await portfolio.locator(".dialog-close").click();
    await expect(portfolio).toBeHidden();

    for (const viewport of [
      ...viewports,
      { name: "short-landscape", width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await page.getByRole("button", { name: "Upload capture", exact: true }).click();
      const dialog = page.locator("#newProjectDialog");
      await expect(dialog.locator(".dialog-shell-header")).toBeVisible();
      await expect(dialog.locator(".dialog-shell-footer")).toBeVisible();
      await expect(dialog.locator(".dialog-close")).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Continue to files", exact: true })).toBeVisible();
      const bounds = await dialog.boundingBox();
      expect(bounds, viewport.name).not.toBeNull();
      expect(bounds!.x, `${viewport.name} left`).toBeGreaterThanOrEqual(-1);
      expect(bounds!.x + bounds!.width, `${viewport.name} right`).toBeLessThanOrEqual(viewport.width + 1);
      expect(bounds!.y, `${viewport.name} top`).toBeGreaterThanOrEqual(-1);
      expect(bounds!.y + bounds!.height, `${viewport.name} bottom`).toBeLessThanOrEqual(viewport.height + 1);
      await dialog.locator(".dialog-close").click();
      await expect(dialog).toBeHidden();
    }
  });

  test("a short dialog keeps context and actions stable, restores focus, and guards dirty input", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const trigger = page.getByRole("button", { name: "Upload capture", exact: true });
    await trigger.click();
    const dialog = page.locator("#newProjectDialog");
    const shell = dialog.locator(".dialog-shell");
    const header = shell.locator(".dialog-shell-header");
    const body = shell.locator(".dialog-shell-body");
    const footer = shell.locator(".dialog-shell-footer");
    const close = dialog.locator(".dialog-close");
    const primary = footer.getByRole("button", { name: "Continue to files", exact: true });
    await expect(dialog).toBeVisible();
    await expect(header).toBeVisible();
    await expect(body).toBeVisible();
    await expect(footer).toBeVisible();
    await expect(close).toBeVisible();
    await expect(primary).toBeVisible();

    const scrollContract = await shell.evaluate((element) => ({
      directScrollOwners: [...element.children]
        .filter((child) => ["auto", "scroll"].includes(getComputedStyle(child).overflowY))
        .map((child) => child.className),
      shellOverflow: getComputedStyle(element).overflowY,
      dialogHeight: element.closest("dialog")?.getBoundingClientRect().height ?? 0,
      viewportHeight: window.innerHeight,
    }));
    expect(scrollContract.directScrollOwners).toEqual(["dialog-shell-body"]);
    expect(scrollContract.shellOverflow).toBe("hidden");
    expect(scrollContract.dialogHeight).toBeLessThanOrEqual(scrollContract.viewportHeight + 1);

    await close.focus();
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    const sceneName = dialog.getByLabel("Scene name", { exact: true });
    await sceneName.fill("Short landscape draft that must survive a resize");
    await page.setViewportSize({ width: 844, height: 260 });
    await expect(sceneName).toHaveValue("Short landscape draft that must survive a resize");
    await dialog.locator("#projectError").evaluate((error) => {
      error.textContent = Array.from({ length: 30 }, () =>
        "A deliberately expanded validation message explains the exact field, retained draft, and recovery action without displacing the dialog footer."
      ).join(" ");
    });
    await expect(close).toBeVisible();
    await expect(primary).toBeVisible();
    const longErrorLayout = await footer.evaluate((element) => {
      const footerBounds = element.getBoundingClientRect();
      const error = element.querySelector<HTMLElement>(".form-error");
      const action = element.querySelector<HTMLElement>("button:not([hidden])");
      const errorBounds = error?.getBoundingClientRect();
      const actionBounds = action?.getBoundingClientRect();
      return {
        footerTop: footerBounds.top,
        footerBottom: footerBounds.bottom,
        actionTop: actionBounds?.top ?? 0,
        actionBottom: actionBounds?.bottom ?? 0,
        errorBottom: errorBounds?.bottom ?? 0,
        errorClientHeight: error?.clientHeight ?? 0,
        errorScrollHeight: error?.scrollHeight ?? 0,
        errorOverflowY: error ? getComputedStyle(error).overflowY : null,
        viewportHeight: window.innerHeight,
      };
    });
    expect(longErrorLayout.footerTop).toBeGreaterThanOrEqual(-1);
    expect(longErrorLayout.footerBottom).toBeLessThanOrEqual(longErrorLayout.viewportHeight + 1);
    expect(longErrorLayout.actionTop).toBeGreaterThanOrEqual(longErrorLayout.footerTop);
    expect(longErrorLayout.actionTop).toBeGreaterThan(longErrorLayout.errorBottom);
    expect(longErrorLayout.actionBottom).toBeLessThanOrEqual(longErrorLayout.viewportHeight + 1);
    expect(longErrorLayout.errorScrollHeight).toBeGreaterThan(longErrorLayout.errorClientHeight);
    expect(longErrorLayout.errorOverflowY).toBe("auto");
    await expectReviewedScreenshot(page, "studio-long-error-dialog-short-height.png");

    await close.click();
    const discard = page.locator("#askDialog");
    await expect(discard).toBeVisible();
    await expect(discard).toHaveAttribute("data-dialog-purpose", /Discard the changes/);
    await discard.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(sceneName).toHaveValue("Short landscape draft that must survive a resize");

    await page.keyboard.press("Escape");
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Discard changes", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test("coarse-pointer Studio controls expose full 44px targets", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await installTurnstileStub(page);
    await mockAuthenticatedStudio(page);
    await page.goto("/studio.html#projects");
    await expect(page.getByRole("heading", {
      name: "Your spatial portfolio, at a glance.",
    })).toBeVisible();
    expect(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches)).toBe(true);

    const projectTarget = await page.locator("#projectTable .project-select-cell").nth(1).boundingBox();
    expect(projectTarget).not.toBeNull();
    expect(projectTarget!.width).toBeGreaterThanOrEqual(44);
    expect(projectTarget!.height).toBeGreaterThanOrEqual(44);

    await page.locator("#captureBundleDialog").evaluate((dialog) =>
      (dialog as HTMLDialogElement).showModal()
    );
    const checkboxTarget = await page.locator("#captureBundleDialog .checkbox-row").first().boundingBox();
    const closeTarget = await page.locator("#captureBundleDialog .dialog-close").boundingBox();
    expect(checkboxTarget).not.toBeNull();
    expect(checkboxTarget!.height).toBeGreaterThanOrEqual(44);
    expect(closeTarget).not.toBeNull();
    expect(closeTarget!.width).toBeGreaterThanOrEqual(44);
    expect(closeTarget!.height).toBeGreaterThanOrEqual(44);
    await page.locator("#captureBundleDialog").evaluate((dialog) =>
      (dialog as HTMLDialogElement).close()
    );

    await page.locator("#versionComparisonDialog").evaluate((dialog) =>
      (dialog as HTMLDialogElement).showModal()
    );
    const syncTarget = await page.locator(".comparison-sync-control").boundingBox();
    expect(syncTarget).not.toBeNull();
    expect(syncTarget!.height).toBeGreaterThanOrEqual(44);
  } finally {
    await context.close();
  }
});

test.describe("studio authentication lifecycle", () => {
  test("does not present a signed-out identity while session bootstrap is pending", async ({
    page,
  }) => {
    await installTurnstileStub(page);
    await mockAuthenticatedStudio(page);
    let releaseSession!: () => void;
    const sessionGate = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    await page.route("**/api/auth/session", async (route) => {
      await sessionGate;
      return route.fallback();
    });

    await page.clock.setFixedTime(new Date("2026-08-24T08:00:00.000Z"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/studio.html#projects");

    await expect(page.locator("#workspaceName")).toHaveText("Checking session…");
    await expect(page.locator("#workspaceName")).not.toHaveText("Sign in required");
    await expectReviewedScreenshot(page, "studio-session-loading-standard-laptop.png");
    releaseSession();
    await expect(page.locator("#workspaceName")).toHaveText("UI QA");
    await expect(page.locator("#loginDialog")).not.toBeVisible();
  });

  test("recovers a persisted session through the refresh cookie on page load", async ({
    page,
  }) => {
    await installTurnstileStub(page);
    await mockAuthenticatedStudio(page);
    let sessionRequests = 0;
    let refreshRequests = 0;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/session") {
        sessionRequests += 1;
        if (sessionRequests === 1) {
          return json(route, 200, { authenticated: false });
        }
        return route.fallback();
      }
      if (path === "/api/auth/refresh") {
        refreshRequests += 1;
        return json(route, 200, { refreshed: true });
      }
      return route.fallback();
    });

    await page.goto("/studio.html#projects");

    await expect(page.getByRole("heading", {
      name: "Your spatial portfolio, at a glance.",
    })).toBeVisible();
    await expect.poll(() => sessionRequests).toBe(2);
    await expect.poll(() => refreshRequests).toBe(1);
    await expect(page.locator("#loginDialog")).not.toBeVisible();
  });

  test("waits for an in-flight refresh from the previous page before showing sign-in", async ({
    page,
  }) => {
    await installTurnstileStub(page);
    await mockAuthenticatedStudio(page);
    let sessionRequests = 0;
    let refreshRequests = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/session") {
        sessionRequests += 1;
        if (sessionRequests < 4) {
          return json(route, 200, { authenticated: false });
        }
        return route.fallback();
      }
      if (path === "/api/auth/refresh") {
        refreshRequests += 1;
        if (refreshRequests < 3) {
          return json(route, 409, { code: "stale_refresh" });
        }
        return json(route, 200, { refreshed: true });
      }
      return route.fallback();
    });

    await page.goto("/studio.html#projects");

    await expect(page.getByRole("heading", {
      name: "Your spatial portfolio, at a glance.",
    })).toBeVisible();
    await expect.poll(() => refreshRequests).toBe(3);
    await expect(page.locator("#loginDialog")).not.toBeVisible();
    await expect(page.locator("#workspaceName")).toHaveText("UI QA");
  });

  test("refreshes once and retries a protected request after access expiry", async ({
    page,
  }) => {
    await installTurnstileStub(page);
    await mockAuthenticatedStudio(page);
    let organisationRequests = 0;
    let refreshRequests = 0;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/organisations") {
        organisationRequests += 1;
        if (organisationRequests === 2) {
          return json(route, 401, { error: "Access token expired" });
        }
        return route.fallback();
      }
      if (path === "/api/auth/refresh") {
        refreshRequests += 1;
        return json(route, 200, { refreshed: true });
      }
      return route.fallback();
    });

    await page.goto("/studio.html#projects");
    await expect(page.locator("#workspaceName")).toHaveText("UI QA");
    await page.locator("#refreshButton").click();
    await expect.poll(() => organisationRequests).toBe(3);
    await expect.poll(() => refreshRequests).toBe(1);
    await expect(page.locator("#refreshButton")).toHaveText("Refresh");
    await expect(page.locator("#loginDialog")).not.toBeVisible();
  });

  test("retries a non-destructive stale refresh without signing the browser out", async ({
    page,
  }) => {
    await installTurnstileStub(page);
    await mockAuthenticatedStudio(page);
    let organisationRequests = 0;
    let refreshRequests = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/session" && refreshRequests === 1) {
        return json(route, 200, { authenticated: false });
      }
      if (path === "/api/auth/organisations") {
        organisationRequests += 1;
        if (organisationRequests === 2) {
          return json(route, 401, { error: "Access token expired" });
        }
        return route.fallback();
      }
      if (path === "/api/auth/refresh") {
        refreshRequests += 1;
        return refreshRequests === 1
          ? json(route, 409, { code: "stale_refresh" })
          : json(route, 200, { refreshed: true });
      }
      return route.fallback();
    });

    await page.goto("/studio.html#projects");
    await expect(page.locator("#workspaceName")).toHaveText("UI QA");
    await page.locator("#refreshButton").click();
    await expect.poll(() => refreshRequests).toBe(2);
    await expect.poll(() => organisationRequests).toBe(3);
    await expect(page.locator("#loginDialog")).not.toBeVisible();
  });

  test("returns to sign-in when an expired access token cannot be refreshed", async ({
    page,
  }) => {
    await installTurnstileStub(page);
    await mockAuthenticatedStudio(page);
    let organisationRequests = 0;
    let refreshRequests = 0;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/organisations") {
        organisationRequests += 1;
        if (organisationRequests === 2) {
          return json(route, 401, { error: "Access token expired" });
        }
        return route.fallback();
      }
      if (path === "/api/auth/refresh") {
        refreshRequests += 1;
        return json(route, 401, { error: "Refresh token expired" });
      }
      return route.fallback();
    });

    await page.goto("/studio.html#projects");
    await expect(page.locator("#workspaceName")).toHaveText("UI QA");
    await page.locator("#refreshButton").click();
    await expect(page.locator("#loginDialog")).toBeVisible();
    await expect.poll(() => refreshRequests).toBe(1);
    await expect(page.locator("#loginError")).toContainText(
      "Your session expired. Sign in again.",
    );
    await expect(page.locator("#workspaceName")).toHaveText("Sign in required");
    await expect(page.locator("#signOutButton")).toBeHidden();
  });

  test("treats a no-content refresh as an expired session", async ({ page }) => {
    await installTurnstileStub(page);
    await mockAuthenticatedStudio(page);
    let organisationRequests = 0;
    let refreshRequests = 0;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/organisations") {
        organisationRequests += 1;
        if (organisationRequests === 2) {
          return json(route, 401, { error: "Access token expired" });
        }
        return route.fallback();
      }
      if (path === "/api/auth/refresh") {
        refreshRequests += 1;
        return route.fulfill({ status: 204 });
      }
      return route.fallback();
    });

    await page.goto("/studio.html#projects");
    await expect(page.locator("#workspaceName")).toHaveText("UI QA");
    await page.locator("#refreshButton").click();
    await expect(page.locator("#loginDialog")).toBeVisible();
    await expect.poll(() => refreshRequests).toBe(1);
    await expect(page.locator("#loginError")).toContainText(
      "Your session expired. Sign in again.",
    );
    await expect(page.locator("#workspaceName")).toHaveText("Sign in required");
  });

  test("coordinates refresh-token rotation across open studio tabs", async ({
    context,
  }) => {
    const pages = [await context.newPage(), await context.newPage()];
    const organisationRequests = [0, 0];
    let refreshRequests = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    for (const [index, studioPage] of pages.entries()) {
      await installTurnstileStub(studioPage);
      await mockAuthenticatedStudio(studioPage);
      await studioPage.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/organisations") {
          organisationRequests[index] = (organisationRequests[index] ?? 0) + 1;
          if (organisationRequests[index] === 2) {
            return json(route, 401, { error: "Access token expired" });
          }
          return route.fallback();
        }
        if (path === "/api/auth/refresh") {
          refreshRequests += 1;
          await refreshGate;
          return json(route, 200, { refreshed: true });
        }
        return route.fallback();
      });
    }

    await Promise.all(pages.map((studioPage) => studioPage.goto("/studio.html#projects")));
    await Promise.all(pages.map((studioPage) =>
      expect(studioPage.getByRole("button", { name: /^Open / }).first()).toBeVisible()
    ));

    await Promise.all(pages.map((studioPage) => studioPage.locator("#refreshButton").click()));
    await Promise.all(pages.map((studioPage) =>
      expect(studioPage.locator("#refreshButton")).toHaveAttribute("aria-busy", "true")
    ));
    await expect.poll(() => refreshRequests).toBe(1);
    releaseRefresh();

    await expect.poll(() => organisationRequests).toEqual([3, 3]);
    await Promise.all(pages.map((studioPage) =>
      expect(studioPage.locator("#refreshButton")).toHaveText("Refresh")
    ));
    expect(refreshRequests).toBe(1);
    await Promise.all(pages.map((studioPage) =>
      expect(studioPage.locator("#loginDialog")).not.toBeVisible()
    ));
  });

  test("propagates terminal session expiry to every open studio tab", async ({
    context,
  }) => {
    const primary = await context.newPage();
    const secondary = await context.newPage();
    for (const studioPage of [primary, secondary]) {
      await installTurnstileStub(studioPage);
      await mockAuthenticatedStudio(studioPage);
    }
    let organisationRequests = 0;
    await primary.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/organisations") {
        organisationRequests += 1;
        if (organisationRequests === 2) {
          return json(route, 401, { error: "Access token expired" });
        }
        return route.fallback();
      }
      if (path === "/api/auth/refresh") {
        return json(route, 401, { error: "Refresh token expired" });
      }
      return route.fallback();
    });

    await Promise.all([
      primary.goto("/studio.html#projects"),
      secondary.goto("/studio.html#projects"),
    ]);
    await Promise.all([primary, secondary].map((studioPage) =>
      expect(studioPage.getByRole("button", { name: /^Open / }).first()).toBeVisible()
    ));

    await primary.locator("#refreshButton").click();

    for (const studioPage of [primary, secondary]) {
      await expect(studioPage.locator("#loginDialog")).toBeVisible();
      await expect(studioPage.locator("#loginError")).toContainText(
        "Your session expired. Sign in again.",
      );
      await expect(studioPage.locator("#workspaceName")).toHaveText("Sign in required");
      await expect(studioPage.locator("#signOutButton")).toBeHidden();
    }
  });
});

test.describe("studio invitation consent", () => {
  const invitationId = "99999999-9999-4999-8999-999999999991";
  const invitedOrganisationId = "11111111-1111-4111-8111-111111111112";

  test("answers a pending organisation invitation and refreshes the membership inventory", async ({
    page,
  }) => {
    await installTurnstileStub(page);
    await mockAuthenticatedStudio(page);
    const invitation = {
      id: invitationId,
      organisationId: invitedOrganisationId,
      organisationName: "Northwind Surveying",
      role: "production_operator",
      invitedAt: now,
      expiresAt: "2026-08-05T08:00:00.000Z",
    };
    let accepted = false;
    let acceptRequests = 0;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/auth/session" && request.method() === "GET") {
        return json(route, 200, {
          authenticated: true,
          user: {
            userId,
            organisationId,
            email: "qa@whymelabs.com",
            displayName: "UI QA",
            role: "platform_admin",
          },
          pendingInvitations: accepted ? [] : [invitation],
        });
      }
      if (path === `/api/team/invitations/${invitationId}/accept` && request.method() === "POST") {
        acceptRequests += 1;
        accepted = true;
        return json(route, 200, { invitation: { ...invitation, status: "accepted" } });
      }
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
          }, ...(accepted
            ? [{
              id: invitedOrganisationId,
              name: invitation.organisationName,
              slug: "northwind-surveying",
              role: "production_operator",
              membershipUpdatedAt: now,
              current: false,
            }]
            : [])],
        });
      }
      return route.fallback();
    });

    await page.goto("/studio.html#projects");

    const panel = page.locator("#pendingInvitationsPanel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Northwind Surveying");
    await expect(panel).toContainText("Production Operator");
    await expect(panel.getByRole("button", { name: "Decline" })).toBeVisible();
    await expect(page.locator("#organisationSwitcher")).toBeHidden();

    await panel.getByRole("button", { name: "Accept" }).click();

    await expect.poll(() => acceptRequests).toBe(1);
    await expect(panel).toBeHidden();
    await expect(page.locator("#organisationSwitcher")).toBeVisible();
    await expect(page.locator("#organisationSelect")).toContainText("Northwind Surveying");
    await expect(page.locator("#toast")).toHaveText("Joined Northwind Surveying");
  });
});

test.describe("Spark renderer chrome", () => {
  test("renderer error and navigation controls remain usable on desktop and mobile", async ({ page }) => {
    for (const viewport of [viewports[0], viewports[3], viewports[4]]) {
      await page.setViewportSize(viewport);
      await page.goto("/renderer/index.html");
      await expect(page.getByText("The spatial scene could not be rendered.", {
        exact: true,
      })).toBeVisible();
      await expectResponsiveSurface(page, "body");
    }

    const axe = await new AxeBuilder({ page })
      .exclude("#sparkCanvas")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.emulateMedia({ forcedColors: "active" });
    const help = page.locator("#toggleHelp");
    await help.focus();
    const forced = await help.evaluate((button) => ({
      active: matchMedia("(forced-colors: active)").matches,
      focusVisible: button.matches(":focus-visible"),
      outlineWidth: Number.parseFloat(getComputedStyle(button).outlineWidth),
      disabledOpacity: getComputedStyle(document.querySelector("#resetView")!).opacity,
    }));
    expect(forced.active).toBe(true);
    expect(forced.focusVisible).toBe(true);
    expect(forced.outlineWidth).toBeGreaterThanOrEqual(3);
    expect(forced.disabledOpacity).toBe("1");
  });
});

async function expectResponsiveSurface(page: Page, rootSelector: string): Promise<void> {
  const result = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return null;
    const visible = [...root.querySelectorAll<HTMLElement>("*")].filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0;
    });
    const controls = visible.filter((element) => {
      if (element instanceof HTMLInputElement) {
        return !["checkbox", "radio", "hidden"].includes(element.type);
      }
      return element instanceof HTMLButtonElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement;
    });
    const choiceTargets = visible
      .filter((element): element is HTMLInputElement =>
        element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)
      )
      .map((input) => input.closest<HTMLElement>("label") ?? input);
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      fonts: [...new Set(visible.map((element) => getComputedStyle(element).fontFamily))],
      undersizedControls: [...controls, ...choiceTargets].map((element) => ({
        label: element.textContent?.trim() || element.getAttribute("aria-label") || element.tagName,
        height: element.getBoundingClientRect().height,
      })).filter((control) => control.height < 39.5),
    };
  }, rootSelector);

  expect(result).not.toBeNull();
  expect(result!.documentWidth).toBeLessThanOrEqual(result!.viewportWidth + 1);
  expect(result!.undersizedControls).toEqual([]);
  expect(result!.fonts.every((font) => (
    font.includes("Manrope") || font.includes("IBM Plex Mono")
  ))).toBe(true);
}

async function installTurnstileStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = {
      options: null as null | {
        size?: string;
        callback: (token: string) => void;
      },
    };
    (window as typeof window & {
      __turnstileOptions?: typeof state.options;
      turnstile?: unknown;
    }).turnstile = {
      render(container: HTMLElement, options: typeof state.options) {
        if (!options) throw new Error("Turnstile options missing");
        state.options = options;
        (window as typeof window & { __turnstileOptions?: typeof state.options })
          .__turnstileOptions = options;
        const testWidget = document.createElement("div");
        testWidget.dataset.testTurnstile = "ready";
        testWidget.textContent = "Security check ready";
        testWidget.style.width = "100%";
        testWidget.style.minHeight = "44px";
        container.replaceChildren(testWidget);
        queueMicrotask(() => options.callback("test-turnstile-token"));
        return "test-turnstile";
      },
      reset() {
        if (state.options) queueMicrotask(() => state.options?.callback("test-turnstile-token"));
      },
      remove() {
        state.options = null;
      },
    };
  });
}

async function mockAnonymousAuth(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session") return json(route, 200, { authenticated: false });
    if (path === "/api/auth/config") {
      return json(route, 200, {
        turnstileSiteKey: "1x00000000000000000000AA",
        turnstileAction: "otp_request",
      });
    }
    return json(route, 404, { error: `Unmocked route: ${route.request().method()} ${path}` });
  });
}

async function mockAuthenticatedStudio(page: Page): Promise<void> {
  const longProjectName = maximumProjectName;
  const longReleaseSlug = maximumReleaseSlug;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const user = {
      userId,
      organisationId,
      email: "qa@whymelabs.com",
      displayName: "UI QA",
      role: "platform_admin",
    };
    const project = {
      id: projectId,
      name: "Responsive indoor scene",
      slug: "responsive-indoor-scene",
      status: "INGESTED",
      captureAdapter: "open-import",
      deliveryTemplate: "venue-navigator",
      notes: "Stable UI acceptance fixture.",
      customerName: "WhyMe Labs",
      customFields: {},
      latestVersionId: null,
      latestVersionNumber: null,
      activeReleaseSlug: null,
      updatedAt: now,
    };
    const secondProject = {
      ...project,
      id: "44444444-4444-4444-8444-444444444444",
      name: longProjectName,
      slug: longReleaseSlug,
      status: "PUBLISHED",
      latestVersionId: "55555555-5555-4555-8555-555555555555",
      latestVersionNumber: 2,
      activeReleaseSlug: longReleaseSlug,
    };
    const archivedProject = {
      ...project,
      id: "44444444-4444-4444-8444-444444444445",
      name: "Archived alignment fixture",
      slug: "archived-alignment-fixture",
      status: "ARCHIVED",
    };

    if (path === "/api/auth/session") {
      return json(route, 200, { authenticated: true, user, pendingInvitations: [] });
    }
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
    if (path === "/api/review/inbox") {
      return json(route, 200, {
        projects: [{
          id: secondProject.id,
          name: longProjectName,
          slug: secondProject.slug,
          status: "PUBLISHED",
          role: "production_operator",
          latest_version_id: secondProject.latestVersionId,
          latest_version_number: 2,
          release_slug: longReleaseSlug,
        }],
      });
    }
    if (path === `/api/projects/${secondProject.id}/reviews` && method === "GET") {
      return json(route, 200, {
        comments: [{
          id: "97979797-9797-4797-8797-979797979701",
          version_id: secondProject.latestVersionId,
          kind: "comment",
          status: "open",
          body: "A long reviewer note explains the exact visual region, expected correction, and publication consequence without clipping on a narrow viewport.",
          author_email: "reviewer.with.an.expanded.operational.identity@subdomain.whymelabs.example",
          author_name: "External conservation reviewer",
          created_at: now,
        }],
        decisions: [],
        reviewers: [{
          invitation_id: "97979797-9797-4797-8797-979797979702",
          user_id: "97979797-9797-4797-8797-979797979703",
          email: "reviewer.with.an.expanded.operational.identity@subdomain.whymelabs.example",
          display_name: "External conservation reviewer",
          role: "reviewer",
          invitation_status: "accepted",
          expires_at: "2026-09-29T08:00:00.000Z",
          revoked_at: null,
        }],
        versions: [],
      });
    }
    if (path === "/api/dashboard") {
      return json(route, 200, {
        activeProjects: 1,
        processingJobs: 0,
        hostedAssets: 0,
        hostedBytes: 0,
        activeReleases: 0,
      });
    }
    if (path === "/api/projects" && method === "GET") {
      return json(route, 200, { projects: [project, secondProject, archivedProject] });
    }
    if (path === "/api/jobs") {
      return json(route, 200, {
        jobs: [{
          id: "66666666-6666-4666-8666-666666666661",
          project_id: project.id,
          version_id: secondProject.latestVersionId,
          project_name: project.name,
          job_type: "asset.validate",
          state: "SUCCEEDED",
          progress: 100,
          progress_message: "Validated",
          attempt_count: 1,
          max_attempts: 3,
          created_at: now,
        }, {
          id: "66666666-6666-4666-8666-666666666662",
          project_id: secondProject.id,
          version_id: secondProject.latestVersionId,
          project_name: secondProject.name,
          job_type: "semantic.extract-v1",
          state: "FAILED",
          progress: 52,
          progress_message: "Needs retry after a multi-line source validation failure with expanded operator guidance",
          attempt_count: 1,
          max_attempts: 3,
          created_at: now,
        }],
      });
    }
    if (
      path ===
      "/api/releases/77777777-7777-4777-8777-777777777771/navigation-traversal-evidence"
    ) {
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-disposition":
            `attachment; filename="release-2-navigation-${"a".repeat(64)}.json"`,
          "x-spatial-sha256": "a".repeat(64),
        },
        body: '{"schemaVersion":"navigation-traversal-evidence-export-v1","events":[]}',
      });
    }
    if (path === "/api/releases") {
      return json(route, 200, {
        releases: [{
          id: "77777777-7777-4777-8777-777777777771",
          project_id: secondProject.id,
          project_name: secondProject.name,
          version_id: secondProject.latestVersionId,
          version_number: 2,
          release_number: 2,
          access_policy: "public",
          published_at: now,
          revoked_at: null,
          slug: secondProject.activeReleaseSlug,
          is_active: 1,
        }, {
          id: "77777777-7777-4777-8777-777777777772",
          project_id: secondProject.id,
          project_name: secondProject.name,
          version_id: secondProject.latestVersionId,
          version_number: 2,
          release_number: 1,
          access_policy: "public",
          published_at: now,
          revoked_at: null,
          slug: secondProject.activeReleaseSlug,
          is_active: 0,
        }],
      });
    }
    if (path === "/api/hosting") {
      return json(route, 200, {
        paymentProviderConfigured: false,
        manualBillingEnabled: true,
        plans: [],
        subscriptions: [{
          id: "98989898-9898-4898-8989-989898989801",
          project_id: secondProject.id,
          project_name: longProjectName,
          plan_code: "managed_delivery_with_expanded_operational_identifier",
          plan_name: "Managed delivery and evidence retention",
          status: "active",
          current_period_end: "2026-09-29T08:00:00.000Z",
          renews_automatically: 1,
          storage_bytes: 73_400_000,
          included_storage_bytes: 1_000_000_000,
          payment_provider: null,
          provider_subscription_id: null,
          provider_cancel_at_period_end: 0,
          billing_note: null,
        }],
        checkouts: [{
          id: "98989898-9898-4898-8989-989898989802",
          project_id: secondProject.id,
          project_name: longProjectName,
          plan_code: "managed_delivery",
          status: "open",
          amount_cents: 12_500,
          currency: "MYR",
          payment_provider: "stripe",
          provider_checkout_id: null,
          payment_status: "requires_payment_method",
          checkout_url: "https://billing.example.com/session/expanded-checkout-identifier-98989898",
          last_error: "The payment provider returned an expanded multi-line recovery message that must remain readable without clipping.",
          expires_at: "2026-09-29T08:00:00.000Z",
          completed_at: null,
          created_at: now,
        }],
        invoices: [{
          id: "98989898-9898-4898-8989-989898989803",
          project_name: longProjectName,
          status: "open",
          currency: "MYR",
          amount_cents: 12_500,
          due_at: "2026-09-29T08:00:00.000Z",
          period_start: now,
          period_end: "2026-09-29T08:00:00.000Z",
          paid_at: null,
          billing_method: "manual",
          external_reference: "invoice-reference-with-expanded-operational-identifier-98989898",
          payment_reference: null,
          note: null,
          subscription_id: "98989898-9898-4898-8989-989898989801",
        }],
        alerts: [],
        lifecycleRuns: [],
      });
    }
    if (path === "/api/team") {
      return json(route, 200, {
        members: [{
          userId,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          status: "active",
          lastActiveAt: now,
        }, {
          userId: "88888888-8888-4888-8888-888888888888",
          email: "reviewer.with.an.expanded.operational.identity@subdomain.whymelabs.example",
          displayName: "Reviewer",
          role: "reviewer",
          status: "invited",
          lastActiveAt: null,
        }],
        invitations: [{
          id: "89898989-8989-4898-8989-898989898989",
          email: "invited.operator.with.expanded.identity@subdomain.whymelabs.example",
          role: "production_operator",
          status: "pending",
          invitedAt: now,
          expiresAt: "2026-09-29T08:00:00.000Z",
          acceptedAt: null,
          revokedAt: null,
          lastSentAt: now,
          sendCount: 2,
          invitedBy: userId,
        }],
      });
    }
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

async function expectColumnsAligned(page: Page, selector: string): Promise<void> {
  const rows = await page.locator(selector).evaluateAll((elements) => (
    elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        tracks: getComputedStyle(element).gridTemplateColumns,
        cells: [...element.children].map((child) => child.getBoundingClientRect().left),
      }))
  ));
  expect(rows.length, `${selector} needs more than one row`).toBeGreaterThan(1);
  expect(new Set(rows.map((row) => row.tracks)).size, `${selector} grid tracks`).toBe(1);
  const columnCount = Math.min(...rows.map((row) => row.cells.length));
  for (let column = 0; column < columnCount; column += 1) {
    const lefts = rows.map((row) => row.cells[column]!);
    expect(Math.max(...lefts) - Math.min(...lefts), `${selector} column ${column + 1} left edge`).toBeLessThanOrEqual(1);
  }
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
