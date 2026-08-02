import { expect, test, type Page, type Route } from "@playwright/test";
import {
  SCENE_ROTATION_MAX_DEGREES,
  SCENE_ROTATION_MIN_DEGREES,
} from "../src/shared/scene-rotation";

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "phone", width: 390, height: 844 },
  { name: "narrow-phone", width: 320, height: 568 },
] as const;

const now = "2026-07-29T08:00:00.000Z";
const organisationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";

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
        const form = dialog.querySelector("form");
        const widget = dialog.querySelector("#turnstileWidget");
        return {
          left: bounds.left,
          right: bounds.right,
          viewportWidth: window.innerWidth,
          formOverflowY: form ? getComputedStyle(form).overflowY : null,
          formClientHeight: form?.clientHeight ?? null,
          formScrollHeight: form?.scrollHeight ?? null,
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
      name: "Upload once. Preview the processed splat. Edit only when needed.",
    })).toBeVisible();
  });

  test("capture intake keeps legacy project workflow settings out of the primary path", async ({ page }) => {
    await page.getByRole("button", { name: "Upload capture", exact: true }).click();
    const dialog = page.locator("#newProjectDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", {
      name: "Upload a capture result and let the platform prepare the preview.",
      exact: true,
    })).toBeVisible();
    await expect(dialog.getByLabel("Project name", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Capture source", exact: true })).toBeVisible();
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
      "Required for automatic floor-plan and navigation generation. Export a registered Y-up metric PLY, E57, LAS, LAZ, or PTS from the device workflow.",
      { exact: true },
    )).toBeVisible();
    await expect(dialog.getByLabel("Delivery template", { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel("Start from template", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText("Project details", { exact: true })).toBeVisible();
    await expectResponsiveSurface(page, "#newProjectDialog");
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

  test("every columnar Studio row shares one column geometry contract", async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);

      await page.getByRole("button", { name: "Projects", exact: true }).click();
      await expectColumnsAligned(page, ".project-row");

      await page.getByText("Advanced tools", { exact: true }).click();
      await page.getByRole("button", { name: "Processing activity", exact: true }).click();
      await expectColumnsAligned(page, ".queue-item");

      await page.getByRole("button", { name: "Published previews", exact: true }).click();
      await expectColumnsAligned(page, ".release-list-row");

      await page.getByText("Advanced tools", { exact: true }).click();
      await page.getByRole("button", { name: "Team access", exact: true }).click();
      await expectColumnsAligned(page, ".team-member-row");

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

  test("traversal evidence download keeps the complete server digest visible", async ({ page }) => {
    await page.getByText("Advanced tools", { exact: true }).click();
    await page.getByRole("button", { name: "Published previews", exact: true }).click();
    await page.getByRole("button", { name: "Export traversal evidence" }).first().click();
    await expect(page.locator("#globalNotice")).toContainText(`SHA-256 ${"a".repeat(64)}`);
  });

  test("archived projects stay out of current production and remain recoverable", async ({ page }) => {
    await expect(page.getByText("Archived alignment fixture", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await expect(page.getByText("Archived alignment fixture", { exact: true })).toBeVisible();
    await expect(page.getByText("Responsive indoor scene", { exact: true })).toHaveCount(0);
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

  test("every dialog keeps action groups separated from content and adjacent controls", async ({
    page,
  }) => {
    const dialogIds = await page.locator("dialog.dialog-card").evaluateAll((dialogs) =>
      dialogs.map((dialog) => dialog.id)
    );

    expect(dialogIds.length).toBeGreaterThan(20);

    for (const viewport of [viewports[0], viewports[3], viewports[4]]) {
      await page.setViewportSize(viewport);

      for (const dialogId of dialogIds) {
        const dialog = page.locator(`#${dialogId}`);
        await dialog.evaluate((element) => {
          const current = element as HTMLDialogElement;
          document.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach((openDialog) => {
            if (openDialog !== current) openDialog.close();
          });
          current.show();
        });

        const layout = await dialog.evaluate((element) => {
          const current = element as HTMLDialogElement;
          const forms = [...current.querySelectorAll<HTMLFormElement>("form")];
          const groupedActions = [...current.querySelectorAll<HTMLElement>(".form-actions")]
            .filter((group) => group.getClientRects().length > 0)
            .map((group) => {
              const style = getComputedStyle(group);
              return {
                columnGap: Number.parseFloat(style.columnGap || "0"),
                rowGap: Number.parseFloat(style.rowGap || "0"),
                marginTop: Number.parseFloat(style.marginTop || "0"),
              };
            });
          const directActions = forms.flatMap((form) =>
            [...form.children]
              .filter((child): child is HTMLButtonElement => (
                child instanceof HTMLButtonElement &&
                !child.classList.contains("dialog-close") &&
                child.matches(".primary-button.wide, .quiet-button.wide, .text-button.wide") &&
                child.getClientRects().length > 0
              ))
              .map((button) => Number.parseFloat(getComputedStyle(button).marginTop || "0"))
          );
          const bottomSurface = current.querySelector<HTMLElement>(
            ":scope > .portfolio-tools-grid",
          ) ?? current.querySelector<HTMLElement>(
            ":scope > .comparison-shell",
          ) ?? current.querySelector<HTMLFormElement>(
            ":scope > form",
          );
          return {
            groupedActions,
            directActions,
            bottomPadding: bottomSurface
              ? Number.parseFloat(getComputedStyle(bottomSurface).paddingBottom || "0")
              : null,
            left: current.getBoundingClientRect().left,
            right: current.getBoundingClientRect().right,
            viewportWidth: window.innerWidth,
          };
        });

        for (const group of layout.groupedActions) {
          expect(group.columnGap, `${dialogId} horizontal action gap`).toBeGreaterThanOrEqual(10);
          expect(group.rowGap, `${dialogId} vertical action gap`).toBeGreaterThanOrEqual(10);
          expect(group.marginTop, `${dialogId} action-group separation`).toBeGreaterThanOrEqual(16);
        }
        for (const marginTop of layout.directActions) {
          expect(marginTop, `${dialogId} direct-action separation`).toBeGreaterThanOrEqual(10);
        }
        expect(layout.bottomPadding, `${dialogId} has a bottom surface`).not.toBeNull();
        expect(layout.bottomPadding!, `${dialogId} safe bottom padding`).toBeGreaterThanOrEqual(20);
        expect(layout.left, `${dialogId} left viewport edge`).toBeGreaterThanOrEqual(-1);
        expect(layout.right, `${dialogId} right viewport edge`).toBeLessThanOrEqual(
          layout.viewportWidth + 1,
        );

        await dialog.evaluate((element) => (element as HTMLDialogElement).close());
      }
    }
  });
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

    await page.goto("/studio.html#projects");

    await expect(page.locator("#workspaceName")).toHaveText("Checking session…");
    await expect(page.locator("#workspaceName")).not.toHaveText("Sign in required");
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
      name: "Upload once. Preview the processed splat. Edit only when needed.",
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
      name: "Upload once. Preview the processed splat. Edit only when needed.",
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
      expect(studioPage.getByRole("button", { name: "Manage" }).first()).toBeVisible()
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
      expect(studioPage.getByRole("button", { name: "Manage" }).first()).toBeVisible()
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
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      fonts: [...new Set(visible.map((element) => getComputedStyle(element).fontFamily))],
      undersizedControls: controls.map((element) => ({
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
      name: "A longer project name for alignment",
      slug: "longer-project",
      status: "PUBLISHED",
      latestVersionId: "55555555-5555-4555-8555-555555555555",
      latestVersionNumber: 2,
      activeReleaseSlug: "longer-project",
    };
    const archivedProject = {
      ...project,
      id: "44444444-4444-4444-8444-444444444445",
      name: "Archived alignment fixture",
      slug: "archived-alignment-fixture",
      status: "ARCHIVED",
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
    if (path === "/api/review/inbox") return json(route, 200, { projects: [] });
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
          progress_message: "Needs retry",
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
        plans: [],
        subscriptions: [],
        checkouts: [],
        invoices: [],
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
          email: "reviewer@whymelabs.com",
          displayName: "Reviewer",
          role: "reviewer",
          status: "invited",
          lastActiveAt: null,
        }],
        invitations: [],
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
