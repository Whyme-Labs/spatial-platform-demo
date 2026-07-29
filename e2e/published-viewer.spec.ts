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
  await expect(parentLoader).toBeVisible();
  await expect(page.frameLocator("#rendererFrame").getByRole("status")).toBeVisible();
  await expect(parentLoader).toBeHidden();
});

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
