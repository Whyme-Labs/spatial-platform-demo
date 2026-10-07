import { expect, test, type Page } from "@playwright/test";
import { SpzWriter } from "@sparkjsdev/spark";

const projectId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const contentUrl = `/comparison-asset/${projectId}/${versionId}/33333333-3333-4333-8333-333333333333/preview-fixture.spz?token=fixture`;

for (const accessPolicy of ["private-preview", "public"]) {
  for (const touch of [false, true]) {
    test.describe(`${touch ? "phone" : "desktop"} ${accessPolicy} Fly preview`, () => {
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
        await page.route("**/preview-fixture.spz*", (route) => {
          assetRequests.push(route.request().url());
          return route.fulfill({ status: 200, contentType: "application/octet-stream", body: scene });
        });
        await page.route(accessPolicy === "private-preview" ? `**/api/projects/${projectId}/versions/${versionId}/preview` : "**/api/releases/single-file-scene/manifest", (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(wrapManifest(accessPolicy, {
              schemaVersion: "1.0.0",
              release: {
                id: `preview:${versionId}`, number: 0, slug: `preview-${versionId}`,
                publishedAt: new Date().toISOString(), expiresAt: null, accessPolicy,
              },
              project: { id: projectId, versionId, versionNumber: 1, name: "Single-file scene", captureAdapter: "fjd-trion", provenance: {} },
              scene: { format: "spz", contentUrl: accessPolicy === "public" ? "/public-asset/release/scene/preview-fixture.spz" : contentUrl, posterUrl: null, collisionUrl: null, sizeBytes: scene.length, etag: null },
              viewer: { title: "Single-file scene", measurementDisclaimer: "Visual preview only.", defaultMovementMode: "fly", viewingMode: "fly-only", splatBudgetMillions: 0.75 },
            })),
          }),
        );
        await page.goto(accessPolicy === "private-preview" ? `/preview/${projectId}/${versionId}` : "/s/single-file-scene");
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

        const canvas = renderer.locator("#sparkCanvas");
        if (touch) await renderer.locator("#toggleHelp").tap();
        else await renderer.locator("#toggleHelp").click();
        await expect(renderer.getByText(touch ? "Touch controls" : "PC controls", { exact: true })).toBeVisible();
        await expect(renderer.getByText(touch ? "PC controls" : "Touch controls", { exact: true })).toBeHidden();
        await expect(renderer.locator("#desktopKeyboardHelp"))[touch ? "toBeHidden" : "toBeVisible"]();
        await expect(renderer.locator("#movementPad"))[touch ? "toBeVisible" : "toBeHidden"]();
        await renderer.locator("#controlHelp").screenshot({ path: test.info().outputPath("device-controls.png") });
        if (touch) await renderer.locator("#toggleHelp").tap();
        else await renderer.locator("#toggleHelp").click();
        const panStart = await cameraPose(page);
        if (touch) {
          await canvas.dispatchEvent("pointerdown", { pointerId: 11, pointerType: "touch", clientX: 140, clientY: 200, button: 0 });
          await canvas.dispatchEvent("pointermove", { pointerId: 11, pointerType: "touch", clientX: 220, clientY: 260 });
          await canvas.dispatchEvent("pointerup", { pointerId: 11, pointerType: "touch", clientX: 220, clientY: 260, button: 0 });
        } else {
          const bounds = await canvas.boundingBox();
          expect(bounds).not.toBeNull();
          const start = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
          await page.mouse.move(start.x, start.y);
          await page.mouse.down();
          await page.mouse.move(start.x + 80, start.y + 60, { steps: 8 });
          await page.mouse.up();
        }
        await expect.poll(async () => distance((await cameraPose(page)).position, panStart.position)).toBeGreaterThan(0.01);
        const afterPan = await cameraPose(page);
        expect(distance(direction(afterPan), direction(panStart))).toBeLessThan(0.001);
        await expect(canvas.evaluate((element) => document.pointerLockElement === element)).resolves.toBe(false);

        if (touch) {
          for (let turn = 0; turn < 4; turn += 1) {
            const turnStart = await cameraPose(page);
            await canvas.dispatchEvent("pointerdown", { pointerId: 12, pointerType: "touch", clientX: 40, clientY: 200, button: 0 });
            await canvas.dispatchEvent("pointerdown", { pointerId: 13, pointerType: "touch", clientX: 120, clientY: 200, button: 0 });
            await canvas.dispatchEvent("pointermove", { pointerId: 12, pointerType: "touch", clientX: 236, clientY: 200 });
            await canvas.dispatchEvent("pointermove", { pointerId: 13, pointerType: "touch", clientX: 316, clientY: 200 });
            await expect.poll(async () => distance(direction(await cameraPose(page)), direction(turnStart))).toBeGreaterThan(0.01);
            await canvas.dispatchEvent("pointerup", { pointerId: 12, pointerType: "touch", clientX: 236, clientY: 200, button: 0 });
            await canvas.dispatchEvent("pointerup", { pointerId: 13, pointerType: "touch", clientX: 316, clientY: 200, button: 0 });
          }
        } else {
          const bounds = await canvas.boundingBox();
          await page.keyboard.down("Shift");
          await page.mouse.move(bounds!.x + 100, bounds!.y + bounds!.height / 2);
          await page.mouse.down();
          await page.mouse.move(bounds!.x + 885, bounds!.y + bounds!.height / 2, { steps: 8 });
          await page.mouse.up();
          await page.keyboard.up("Shift");
        }
        await expect.poll(async () => distance(direction(await cameraPose(page)), direction(afterPan))).toBeGreaterThan(0.01);
        expect(distance((await cameraPose(page)).position, afterPan.position)).toBeLessThan(0.001);
        const sideways = await cameraPose(page);
        await canvas.dispatchEvent("pointerdown", { pointerId: 14, pointerType: touch ? "touch" : "mouse", clientX: 140, clientY: 200, button: 0 });
        await canvas.dispatchEvent("pointermove", { pointerId: 14, pointerType: touch ? "touch" : "mouse", clientX: 220, clientY: 260 });
        await canvas.dispatchEvent("pointerup", { pointerId: 14, pointerType: touch ? "touch" : "mouse", clientX: 220, clientY: 260, button: 0 });
        await expect.poll(async () => distance((await cameraPose(page)).position, sideways.position)).toBeGreaterThan(0.01);
        const panAfterTurn = await cameraPose(page);
        expect(distance(panAfterTurn.position, sideways.position)).toBeCloseTo(distance(afterPan.position, panStart.position), 3);
        expect(distance(direction(panAfterTurn), direction(sideways))).toBeLessThan(0.001);
        // The saved view must carry its screen-up axis after inspection turns.
        expect(direction(panAfterTurn).reduce((sum, value, index) => sum + value * panAfterTurn.up[index]!, 0)).toBeCloseTo(0, 5);

        const dragMode = renderer.getByRole("combobox", { name: "Drag action" });
        await expect(dragMode).toBeVisible();
        await expect(dragMode).toBeEnabled();
        await dragMode.selectOption("rotate");
        if (touch) {
          await canvas.dispatchEvent("pointerdown", { pointerId: 19, pointerType: "touch", clientX: 140, clientY: 200, button: 0 });
          await canvas.dispatchEvent("pointermove", { pointerId: 19, pointerType: "touch", clientX: 220, clientY: 200 });
          await canvas.dispatchEvent("pointerup", { pointerId: 19, pointerType: "touch", clientX: 220, clientY: 200, button: 0 });
        } else {
          const bounds = await canvas.boundingBox();
          await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
          await page.mouse.down();
          await page.mouse.move(bounds!.x + bounds!.width / 2 + 80, bounds!.y + bounds!.height / 2, { steps: 4 });
          await page.mouse.up();
        }
        await expect.poll(async () => distance((await cameraPose(page)).up, panAfterTurn.up)).toBeGreaterThan(0.05);
        const afterRotate = await cameraPose(page);
        expect(distance(afterRotate.position, panAfterTurn.position)).toBeLessThan(0.001);
        expect(distance(direction(afterRotate), direction(panAfterTurn))).toBeLessThan(0.001);
        await dragMode.selectOption("pan");

        const before = await cameraPosition(page);
        if (touch) {
          const rise = renderer.locator("#flyAscend");
          await expect(rise).toBeVisible();
          await rise.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", button: 0 });
          await expect.poll(async () => (await cameraPosition(page))[1]).toBeGreaterThan(before[1] + 0.01);
          // A keyboard on a touch device selects the PC set and stops touch input.
          await canvas.focus();
          await page.keyboard.press("ArrowUp");
          await expect(renderer.locator("#movementPad")).toBeHidden();
          await expect(renderer.locator("#flightAltitudeControls")).toBeHidden();
          await expect(rise).not.toHaveAttribute("data-active", "");
          await rise.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", button: 0 });
          await renderer.locator("#toggleHelp").click();
          await expect(renderer.getByText("PC controls", { exact: true })).toBeVisible();
          await expect(renderer.locator("#desktopKeyboardHelp")).toBeVisible();
          await renderer.locator("#toggleHelp").click();
          await canvas.dispatchEvent("pointerdown", { pointerId: 15, pointerType: "touch", clientX: 140, clientY: 200, button: 0 });
          await canvas.dispatchEvent("pointerup", { pointerId: 15, pointerType: "touch", clientX: 140, clientY: 200, button: 0 });
          await expect(renderer.locator("#movementPad")).toBeVisible();
          await expect(renderer.locator("#flightAltitudeControls")).toBeVisible();
        } else {
          await renderer.locator("#sparkCanvas").focus();
          await page.keyboard.down("w");
          await expect.poll(async () => {
            const after = await cameraPosition(page);
            return Math.hypot(...after.map((value, index) => value - before[index]!));
          }).toBeGreaterThan(0.01);
          await page.keyboard.up("w");

          // Window size changes the layout, not the selected input controls.
          await page.setViewportSize({ width: 390, height: 844 });
          const toolbar = await renderer.locator(".spark-controls").boundingBox();
          expect(toolbar!.x).toBeGreaterThanOrEqual(0);
          expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(390);
          await renderer.locator("#toggleHelp").click();
          const help = await renderer.locator("#controlHelp").boundingBox();
          expect(help!.y + help!.height).toBeLessThanOrEqual(toolbar!.y);
          await expect(renderer.getByText("PC controls", { exact: true })).toBeVisible();
          await expect(renderer.locator("#desktopKeyboardHelp")).toBeVisible();
          await expect(renderer.locator("#movementPad")).toBeHidden();
          await renderer.locator("#toggleHelp").click();

          // Hybrid screens can return to mouse controls without losing touch.
          await canvas.dispatchEvent("pointerdown", { pointerId: 16, pointerType: "touch", clientX: 140, clientY: 200, button: 0 });
          await canvas.dispatchEvent("pointerup", { pointerId: 16, pointerType: "touch", clientX: 140, clientY: 200, button: 0 });
          await expect(renderer.locator("#movementPad")).toBeVisible();
          await expect(renderer.locator("#flightAltitudeControls")).toBeVisible();
          await canvas.click();
          await expect(renderer.locator("#movementPad")).toBeHidden();
          await expect(renderer.locator("#flightAltitudeControls")).toBeHidden();
        }

        const savedPose = await cameraPose(page);
        await page.evaluate((pose) => {
          document.querySelector<HTMLIFrameElement>("#rendererFrame")?.contentWindow?.postMessage({
            source: "spatial-host", type: "sync-camera", cameraPose: pose,
          }, location.origin);
        }, savedPose);
        const restoredPose = await cameraPose(page);
        expect(distance(direction(restoredPose), direction(savedPose))).toBeLessThan(0.001);
        expect(distance(restoredPose.up, savedPose.up)).toBeLessThan(0.001);
        if (touch) {
          await renderer.locator("#flyAscend").dispatchEvent("pointerdown", { pointerId: 18, pointerType: "touch", button: 0 });
        } else {
          await canvas.focus();
          await page.keyboard.down("e");
        }
        await expect.poll(async () => (await cameraPose(page)).position[1] - restoredPose.position[1]).toBeGreaterThan(0.01);
        if (touch) await renderer.locator("#flyAscend").dispatchEvent("pointerup", { pointerId: 18, pointerType: "touch", button: 0 });
        else await page.keyboard.up("e");
        const afterRestoredRise = await cameraPose(page);
        expect(Math.hypot(afterRestoredRise.position[0] - restoredPose.position[0], afterRestoredRise.position[2] - restoredPose.position[2])).toBeLessThan(0.001);
        if (touch) await renderer.locator("#resetView").tap();
        else await renderer.locator("#resetView").click();
        await expect.poll(async () => distance((await cameraPose(page)).position, panStart.position)).toBeLessThan(0.001);
        const resetPose = await cameraPose(page);
        expect(distance(direction(resetPose), direction(panStart))).toBeLessThan(0.001);
        expect(distance(resetPose.up, panStart.up)).toBeLessThan(0.001);
      });
    });
  }

}

function wrapManifest(accessPolicy: string, manifest: unknown): unknown {
  return accessPolicy === "private-preview" ? { manifest } : manifest;
}

async function cameraPosition(page: Page): Promise<[number, number, number]> {
  return (await cameraPose(page)).position;
}

type CameraPose = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovDegrees: number;
};

async function cameraPose(page: Page): Promise<CameraPose> {
  return page.evaluate(() => new Promise<CameraPose>((resolve, reject) => {
    const renderer = document.querySelector<HTMLIFrameElement>("#rendererFrame")?.contentWindow;
    if (!renderer) return reject(new Error("Renderer is unavailable"));
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => reject(new Error("Camera capture timed out")), 5_000);
    const receive = (event: MessageEvent) => {
      if (event.source !== renderer || event.data?.type !== "camera" || event.data?.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve(event.data.cameraPose);
    };
    window.addEventListener("message", receive);
    renderer.postMessage({ source: "spatial-host", type: "capture-camera", requestId }, location.origin);
  }));
}

function direction(pose: CameraPose): number[] {
  const vector = pose.target.map((value, index) => value - pose.position[index]!);
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

function distance(left: number[], right: number[]): number {
  return Math.hypot(...left.map((value, index) => value - right[index]!));
}
