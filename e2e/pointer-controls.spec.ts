import { expect, test } from "@playwright/test";

test.describe("Spark pointer-look direction", () => {
  for (const camera of [
    {
      label: "an imported camera with an inverted authored up vector",
      path: "/e2e/fixtures/pointer-controls.html",
    },
    {
      label: "a conventional world-up camera",
      path: "/e2e/fixtures/pointer-controls.html?orientation=world-up",
    },
  ]) {
    test(`dragging up looks up for ${camera.label}`, async ({ page }) => {
      await page.goto(camera.path);

      await drag(page, { x: 300, y: 260 }, { x: 300, y: 180 });

      await expect.poll(() => readProbe(page)).toMatchObject({
        up: expect.any(Number),
      });
      expect((await readProbe(page)).up).toBeGreaterThan(0.02);
    });

    test(`dragging left looks left for ${camera.label}`, async ({ page }) => {
      await page.goto(camera.path);

      await drag(page, { x: 300, y: 260 }, { x: 220, y: 260 });

      expect((await readProbe(page)).right).toBeLessThan(-0.02);
    });
  }
});

async function drag(
  page: import("@playwright/test").Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.waitForTimeout(32);
  await page.mouse.up();
}

async function readProbe(
  page: import("@playwright/test").Page,
): Promise<{ up: number; right: number }> {
  return page.locator("body").evaluate((body) =>
    JSON.parse(body.dataset.lookProbe ?? '{"up":0,"right":0}') as {
      up: number;
      right: number;
    }
  );
}
