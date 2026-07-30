import { expect, test, type Route } from "@playwright/test";

test("published viewer hands startup progress to the embedded Spark loader", async ({ page }) => {
  await page.route("**/api/releases/loading-handoff/manifest", (route) => json(route, {
    schemaVersion: "1",
    release: {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "loading-handoff",
      publishedAt: "2026-07-29T08:00:00.000Z",
      expiresAt: null,
      accessPolicy: "public",
    },
    project: {
      id: "22222222-2222-4222-8222-222222222222",
      versionId: "33333333-3333-4333-8333-333333333333",
      name: "Loading handoff fixture",
      captureAdapter: "test",
      provenance: {},
    },
    scene: {
      format: "rad",
      contentUrl: "/test-scene.rad",
      posterUrl: null,
      sizeBytes: 1,
      etag: null,
    },
    viewer: {
      title: "Loading handoff fixture",
      measurementDisclaimer: "Test scene only.",
      splatBudgetMillions: 2,
    },
  }));
  await page.route("**/api/releases/loading-handoff/telemetry", (route) => json(route, {}));
  await page.route("**/renderer/index.html?*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html>
      <html>
        <body>
          <div role="status">Loading spatial scene</div>
          <button id="free-roam" onclick="parent.postMessage({
            source: 'spatial-spark',
            type: 'control-mode',
            mode: 'free-roam'
          }, location.origin)">Free roam</button>
          <button id="exit-roam" onclick="parent.postMessage({
            source: 'spatial-spark',
            type: 'control-mode',
            mode: 'orbit'
          }, location.origin)">Exit roam</button>
          <button id="open-onboarding" onclick="parent.postMessage({
            source: 'spatial-spark',
            type: 'control-onboarding',
            visible: true
          }, location.origin)">Open onboarding</button>
          <button id="close-onboarding" onclick="parent.postMessage({
            source: 'spatial-spark',
            type: 'control-onboarding',
            visible: false
          }, location.origin)">Close onboarding</button>
          <button id="renderer-ready" onclick="parent.postMessage({
            source: 'spatial-spark',
            type: 'ready',
            runtime: 'spark',
            version: '2.1.0',
            timeToFirstFrameMs: 1200,
            format: 'rad',
            splatBudget: 2000000
          }, location.origin)">Renderer ready</button>
          <script>
            setTimeout(() => {
              parent.postMessage({
                source: "spatial-spark",
                type: "progress",
                progress: 42,
                detail: "Streaming scene detail"
              }, location.origin);
            }, 1000);
          </script>
        </body>
      </html>`,
  }));

  await page.goto("/s/loading-handoff", { waitUntil: "commit" });

  const parentLoader = page.locator("#loadingOverlay");
  const releaseInfo = page.locator("#releaseInfo");
  const rendererFrame = page.locator("#rendererFrame");
  await expect(parentLoader).toBeVisible();
  await expect(releaseInfo).toBeHidden();
  await expect(rendererFrame).toHaveClass(/is-loading/);
  await expect(rendererFrame).toHaveCSS("opacity", "0");
  await expect(parentLoader).toHaveCSS("background-color", "rgb(9, 11, 10)");
  await expect(page.frameLocator("#rendererFrame").getByRole("status")).toBeVisible();
  await expect(parentLoader).toBeVisible();
  await expect(page.locator("#loadingDetail")).toHaveText("Streaming scene detail");
  await expect(page.locator("#progressBar")).toHaveJSProperty("style.width", "42%");
  await expect(releaseInfo).toBeHidden();

  await page.frameLocator("#rendererFrame").locator("body").evaluate(() => {
    parent.postMessage({
      source: "spatial-spark",
      type: "ready",
      runtime: "spark",
      version: "2.1.0",
      timeToFirstFrameMs: 1200,
      format: "rad",
      splatBudget: 2_000_000,
    }, location.origin);
  });
  await expect(rendererFrame).not.toHaveClass(/is-loading/);
  await expect(rendererFrame).toHaveCSS("opacity", "1");
  await expect(parentLoader).toBeHidden();
  await expect(releaseInfo).toBeVisible();

  const viewport = page.locator("#viewport");
  await page.frameLocator("#rendererFrame").getByRole("button", { name: "Free roam" }).click();
  await expect(viewport).toHaveClass(/mobile-free-roam-active/);
  await page.frameLocator("#rendererFrame").getByRole("button", { name: "Exit roam" }).click();
  await expect(viewport).not.toHaveClass(/mobile-free-roam-active/);
  await page.frameLocator("#rendererFrame").getByRole("button", { name: "Open onboarding" }).click();
  await expect(viewport).toHaveClass(/mobile-controls-onboarding/);
  await page.frameLocator("#rendererFrame").getByRole("button", { name: "Close onboarding" }).click();
  await expect(viewport).not.toHaveClass(/mobile-controls-onboarding/);
});

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
