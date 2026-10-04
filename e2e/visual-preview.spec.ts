import { expect, test, type Page } from "@playwright/test";
import { SpzWriter } from "@sparkjsdev/spark";

const projectId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const contentUrl = `/comparison-asset/${projectId}/${versionId}/33333333-3333-4333-8333-333333333333/preview-fixture.spz?token=fixture`;

for (const touch of [false, true]) {
  test.describe(touch ? "phone Fly preview" : "desktop Fly preview", () => {
    test.use(touch
      ? { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } }
      : { viewport: { width: 1280, height: 800 } });

    test("renders and moves without collision or metric claims", async ({ page }) => {
      const writer = new SpzWriter({ numSplats: 4, shDegree: 0, flagAntiAlias: false });
      [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]].forEach(([x, y, z], index) => {
        writer.setCenter(index, x!, y!, z!);
        writer.setAlpha(index, 1);
        writer.setRgb(index, 0.8, 0.5, 0.2);
        writer.setScale(index, -2, -2, -2);
        writer.setQuat(index, 0, 0, 0, 1);
      });
      const scene = Buffer.from(await writer.finalize());
      const assetRequests: string[] = [];
      await page.route("**/comparison-asset/**/preview-fixture.spz*", (route) => {
        assetRequests.push(route.request().url());
        return route.fulfill({ status: 200, contentType: "application/octet-stream", body: scene });
      });
      await page.route(`**/api/projects/${projectId}/versions/${versionId}/preview`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ manifest: {
            schemaVersion: "1.0.0",
            release: {
              id: `preview:${versionId}`, number: 0, slug: `preview-${versionId}`,
              publishedAt: new Date().toISOString(), expiresAt: null, accessPolicy: "private-preview",
            },
            project: { id: projectId, versionId, versionNumber: 1, name: "Single-file scene", captureAdapter: "fjd-trion", provenance: {} },
            scene: { format: "spz", contentUrl, posterUrl: null, collisionUrl: null, sizeBytes: scene.length, etag: null },
            viewer: { title: "Single-file scene", measurementDisclaimer: "Visual preview only.", defaultMovementMode: "fly", splatBudgetMillions: 0.75 },
          } }),
        }),
      );
      await page.goto(`/preview/${projectId}/${versionId}`);
      const renderer = page.frameLocator("#rendererFrame");
      await expect(page.locator("#rendererStatus")).toHaveText("Scene ready");
      await expect(renderer.locator("#controlStatus")).toContainText("Fly preview");
      await expect(renderer.locator("#sparkError")).toBeHidden();
      await expect(renderer.locator("#movementModeToggle")).toBeHidden();
      await expect(page.locator("#openNavigator")).toBeHidden();
      await page.locator("#toggleReleaseInfo").click();
      await expect(page.locator("#scaleStatus")).toHaveText("Visual only — scale not declared");
      await page.locator("#toggleReleaseInfo").click();
      expect(assetRequests.length).toBeGreaterThan(0);

      const before = await cameraPosition(page);
      if (touch) {
        const rise = renderer.getByRole("button", { name: "Rise while flying" });
        await expect(rise).toBeVisible();
        await rise.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", button: 0 });
        await expect.poll(async () => (await cameraPosition(page))[1]).toBeGreaterThan(before[1] + 0.01);
        await rise.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", button: 0 });
      } else {
        await renderer.locator("#sparkCanvas").focus();
        await page.keyboard.down("w");
        await expect.poll(async () => {
          const after = await cameraPosition(page);
          return Math.hypot(...after.map((value, index) => value - before[index]!));
        }).toBeGreaterThan(0.01);
        await page.keyboard.up("w");
      }
    });
  });
}

async function cameraPosition(page: Page): Promise<[number, number, number]> {
  return page.evaluate(() => new Promise<[number, number, number]>((resolve, reject) => {
    const renderer = document.querySelector<HTMLIFrameElement>("#rendererFrame")?.contentWindow;
    if (!renderer) return reject(new Error("Renderer is unavailable"));
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => reject(new Error("Camera capture timed out")), 5_000);
    const receive = (event: MessageEvent) => {
      if (event.source !== renderer || event.data?.type !== "camera" || event.data?.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve(event.data.cameraPose.position);
    };
    window.addEventListener("message", receive);
    renderer.postMessage({ source: "spatial-host", type: "capture-camera", requestId }, location.origin);
  }));
}
