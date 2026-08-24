import { expect, test, type Page, type Route } from "@playwright/test";

const CORRECT_ACCESS_CODE = "f".repeat(64);
const STORAGE_KEY = "release-access:gated-room";

test("bare token links recover through the access-code form and keep access for the session", async ({ page, browser }) => {
  const manifestQueries: string[] = [];
  await routeGatedRelease(page, manifestQueries);

  // A cleaned or bare link opens the recoverable access prompt, not a dead end.
  await page.goto("/s/gated-room", { waitUntil: "commit" });
  await expect(page.locator("#errorPanel")).toBeVisible();
  await expect(page.locator("#errorTitle")).toHaveText("This scene requires access");
  await expect(page.locator("#errorMessage")).toHaveText("Paste the access code from your invitation.");
  await expect(page.locator("#accessCodeForm")).toBeVisible();
  await expect(page.locator("#accessSignInLink")).toBeHidden();
  // The tokenless Retry would loop the same denied request, so the code form
  // replaces it for the access case.
  await expect(page.locator("#retryButton")).toBeHidden();

  // A wrong code re-prompts inline instead of dead-ending.
  const accessCode = page.locator("#accessCodeForm input[name='accessCode']");
  await page.locator("#accessCodeSubmit").click();
  await expect(accessCode).toHaveAttribute("aria-invalid", "true");
  const clientErrorId = await accessCode.getAttribute("aria-errormessage");
  expect(clientErrorId).toBeTruthy();
  await expect(page.locator(`#${clientErrorId}`)).toBeVisible();
  await expect(page.locator("#accessCodeError")).toBeHidden();

  await accessCode.fill("0".repeat(64));
  await page.locator("#accessCodeSubmit").click();
  const accessError = page.locator("#accessCodeError");
  await expect(accessError).toContainText(
    "That access code was not accepted. Check it against your invitation and try again.",
  );
  await expect(accessError).toContainText("Reference: e2e-access-denied.");
  await expect(accessError).toHaveAttribute("data-feedback-kind", "failure");
  await expect(page.locator("#accessCodeForm")).toBeVisible();

  // The correct code loads the scene exactly as a tokenized URL would.
  await page.locator("#accessCodeForm input[name='accessCode']").fill(CORRECT_ACCESS_CODE);
  await page.locator("#accessCodeSubmit").click();
  await expect(page.locator("#rendererFrame")).toBeVisible();
  await expect(page.locator("#errorPanel")).toBeHidden();
  expect(new URL(page.url()).searchParams.get("access_token")).toBeNull();
  await expect.poll(() => page.evaluate(
    (key) => sessionStorage.getItem(key),
    STORAGE_KEY,
  )).toBe(CORRECT_ACCESS_CODE);

  // Reloading the clean URL keeps access through sessionStorage.
  await page.reload({ waitUntil: "commit" });
  await expect(page.locator("#rendererFrame")).toBeVisible();
  await expect(page.locator("#errorPanel")).toBeHidden();
  expect(manifestQueries.at(-1)).toContain(`access_token=${CORRECT_ACCESS_CODE}`);

  // A browsing session without the stored token prompts again.
  const freshContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const freshPage = await freshContext.newPage();
  await routeGatedRelease(freshPage, []);
  await freshPage.goto("/s/gated-room", { waitUntil: "commit" });
  await expect(freshPage.locator("#accessCodeForm")).toBeVisible();
  await expect(freshPage.locator("#rendererFrame")).toBeHidden();
  await freshContext.close();
});

test("access-code action feedback stays contained at every supported width", async ({ page }) => {
  await routeGatedRelease(page, []);

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 800 });
    await page.goto("/s/gated-room", { waitUntil: "commit" });
    await page.locator("#accessCodeForm input[name='accessCode']").fill("0".repeat(64));
    await page.locator("#accessCodeSubmit").click();
    const geometry = await page.locator("#accessCodeError").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const parent = element.parentElement?.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        borderStyle: style.borderStyle,
        paddingTop: Number.parseFloat(style.paddingTop),
        left: bounds.left,
        right: bounds.right,
        parentLeft: parent?.left ?? 0,
        parentRight: parent?.right ?? 0,
        overflowWrap: style.overflowWrap,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(geometry.borderStyle, `${width}px action border`).not.toBe("none");
    expect(geometry.paddingTop, `${width}px action padding`).toBeGreaterThan(0);
    expect(geometry.left, `${width}px action left edge`).toBeGreaterThanOrEqual(geometry.parentLeft - 1);
    expect(geometry.right, `${width}px action right edge`).toBeLessThanOrEqual(geometry.parentRight + 1);
    expect(geometry.overflowWrap, `${width}px action wrapping`).toBe("anywhere");
    expect(geometry.documentWidth, `${width}px document width`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  }
});

test("a tokenized URL stores its token before stripping it from the address bar", async ({ page }) => {
  const manifestQueries: string[] = [];
  await routeGatedRelease(page, manifestQueries);

  await page.goto(`/s/gated-room?access_token=${CORRECT_ACCESS_CODE}`, { waitUntil: "commit" });
  await expect(page.locator("#rendererFrame")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("access_token")).toBeNull();
  await expect.poll(() => page.evaluate(
    (key) => sessionStorage.getItem(key),
    STORAGE_KEY,
  )).toBe(CORRECT_ACCESS_CODE);

  // The stripped URL survives its own reload.
  await page.reload({ waitUntil: "commit" });
  await expect(page.locator("#rendererFrame")).toBeVisible();
  expect(manifestQueries.at(-1)).toContain(`access_token=${CORRECT_ACCESS_CODE}`);
});

test("an expired stored token clears and re-prompts instead of looping", async ({ page }) => {
  // Every manifest request is denied: the release was republished and the
  // stored token no longer matches.
  await page.route("**/api/releases/gated-room/manifest*", (route) => deny(route, "token"));
  await page.addInitScript(([key, value]) => {
    sessionStorage.setItem(key!, value!);
  }, [STORAGE_KEY, "1".repeat(64)]);

  await page.goto("/s/gated-room", { waitUntil: "commit" });
  await expect(page.locator("#accessCodeForm")).toBeVisible();
  // The lapsed token is dropped so retries prompt instead of silently
  // resending a dead credential.
  await expect.poll(() => page.evaluate(
    (key) => sessionStorage.getItem(key),
    STORAGE_KEY,
  )).toBeNull();
  // A stored-token lapse is not the visitor's typo: the prompt opens clean.
  await expect(page.locator("#accessCodeError")).toBeHidden();
});

test("customer-authenticated releases offer sign-in instead of an access-code form", async ({ page }) => {
  await page.route(
    "**/api/releases/customer-room/manifest*",
    (route) => deny(route, "customer-authenticated"),
  );

  await page.goto("/s/customer-room", { waitUntil: "commit" });
  await expect(page.locator("#errorPanel")).toBeVisible();
  await expect(page.locator("#errorTitle")).toHaveText("This scene requires access");
  await expect(page.locator("#accessCodeForm")).toBeHidden();
  const signIn = page.locator("#accessSignInLink");
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute("href", "/studio.html");
  // After signing in from another tab, Retry re-runs the cookie-backed fetch.
  await expect(page.locator("#retryButton")).toBeVisible();
});

async function routeGatedRelease(page: Page, manifestQueries: string[]): Promise<void> {
  await page.route("**/api/releases/gated-room/manifest*", (route) => {
    const url = new URL(route.request().url());
    manifestQueries.push(url.search);
    if (url.searchParams.get("access_token") !== CORRECT_ACCESS_CODE) {
      return deny(route, "token");
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(gatedManifest()),
    });
  });
  await page.route("**/api/telemetry", (route) => route.fulfill({ status: 204 }));
  await page.route("**/renderer/index.html?*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<html><body style='background:#20241f'></body></html>",
  }));
}

function deny(route: Route, accessPolicy: "token" | "customer-authenticated"): Promise<void> {
  return route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({
      error: "This scene requires access",
      accessPolicy,
      requestId: "e2e-access-denied",
    }),
  });
}

function gatedManifest(): Record<string, unknown> {
  return {
    schemaVersion: "1",
    release: {
      id: "94444444-4444-4444-8444-444444444444",
      slug: "gated-room",
      publishedAt: "2026-08-18T00:00:00.000Z",
      expiresAt: null,
      accessPolicy: "token",
    },
    project: {
      id: "95555555-5555-4555-8555-555555555555",
      versionId: "96666666-6666-4666-8666-666666666666",
      name: "Gated room fixture",
      captureAdapter: "test",
      provenance: {},
    },
    scene: {
      format: "rad",
      contentUrl: "/gated-room.rad",
      posterUrl: null,
      sizeBytes: 1,
      etag: null,
    },
    viewer: {
      title: "Gated room fixture",
      measurementDisclaimer: "Visual experience only.",
      splatBudgetMillions: 2,
    },
    spatial: {
      entities: [],
      routes: [],
      routeStops: [],
      collisionProxy: { version: "box-union-v1", boxes: [] },
      navigationMesh: {
        version: "room-box-triangles-v1",
        vertices: [],
        indices: [],
        sourceEntityIds: [],
      },
      obstacleProxy: { version: "authored-obstacle-boxes-v1", boxes: [] },
      navigationProfile: {
        worldUnit: "metres",
        agentRadius: 0.22,
        agentHeight: 1.8,
        eyeHeight: 1.6,
        maxStepMetres: 0.1,
      },
    },
  };
}
