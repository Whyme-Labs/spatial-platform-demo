import { expect, test } from "@playwright/test";

test.describe("spatial navigation direction", () => {
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

  test("keeps drag axes screen-aligned after a large horizontal turn", async ({ page }) => {
    await page.goto("/e2e/fixtures/pointer-controls.html");
    const initial = await readCameraState(page);

    await drag(page, { x: 1_000, y: 320 }, { x: 215, y: 320 });
    const afterTurn = await readCameraState(page);

    expect(dot(subtract(afterTurn.direction, initial.direction), initial.right))
      .toBeLessThan(-0.2);
    expect(dot(afterTurn.up, initial.up)).toBeGreaterThan(0.99);

    await drag(page, { x: 500, y: 360 }, { x: 500, y: 260 });
    const afterPitch = await readCameraState(page);
    const pitchDelta = subtract(afterPitch.direction, afterTurn.direction);

    expect(dot(pitchDelta, afterTurn.up)).toBeGreaterThan(0.02);
    expect(Math.abs(dot(pitchDelta, afterTurn.right))).toBeLessThan(0.02);
  });

  test("arrow keys move on the floor plane in the viewed direction", async ({ page }) => {
    await page.goto("/e2e/fixtures/pointer-controls.html");
    const initial = await readCameraState(page);

    await drag(page, { x: 500, y: 360 }, { x: 500, y: 260 });
    const afterLook = await readCameraState(page);
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(180);
    await page.keyboard.up("ArrowUp");
    const afterForward = await readCameraState(page);
    const forwardDelta = subtract(afterForward.position, afterLook.position);
    const planarForward = normalise(projectOnPlane(afterLook.direction, initial.up));

    expect(dot(forwardDelta, initial.up)).toBeCloseTo(0, 5);
    expect(dot(forwardDelta, planarForward)).toBeGreaterThan(0.1);

    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(180);
    await page.keyboard.up("ArrowLeft");
    const afterStrafe = await readCameraState(page);
    const strafeDelta = subtract(afterStrafe.position, afterForward.position);
    const planarRight = normalise(projectOnPlane(afterLook.right, initial.up));

    expect(dot(strafeDelta, initial.up)).toBeCloseTo(0, 5);
    expect(dot(strafeDelta, planarRight)).toBeLessThan(-0.1);
  });

  test("a quick arrow-key press still advances one rendered frame", async ({ page }) => {
    await page.goto("/e2e/fixtures/pointer-controls.html");
    const initial = await readCameraState(page);
    const planarForward = normalise(projectOnPlane(initial.direction, initial.up));

    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(80);

    const afterPress = await readCameraState(page);
    const travel = subtract(afterPress.position, initial.position);
    expect(dot(travel, initial.up)).toBeCloseTo(0, 5);
    expect(dot(travel, planarForward)).toBeGreaterThan(0.01);
  });

  test("a flat authored floor boundary permits eye-height walking", async ({ page }) => {
    await page.goto("/e2e/fixtures/pointer-controls.html?boundary=flat-floor");
    const initial = await readCameraState(page);
    const planarForward = normalise(projectOnPlane(initial.direction, initial.up));

    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(80);

    const afterPress = await readCameraState(page);
    const travel = subtract(afterPress.position, initial.position);
    expect(dot(travel, planarForward)).toBeGreaterThan(0.01);
  });

  test("a trackpad secondary click cannot translate or rotate the camera", async ({ page }) => {
    await page.goto("/e2e/fixtures/pointer-controls.html");
    const initial = await readCameraState(page);

    await page.mouse.move(500, 320);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(508, 326, { steps: 3 });
    await page.mouse.up({ button: "right" });
    await page.waitForTimeout(80);
    const afterClick = await readCameraState(page);

    expect(vectorLength(subtract(afterClick.position, initial.position))).toBeLessThan(0.001);
    expect(vectorLength(subtract(afterClick.direction, initial.direction))).toBeLessThan(0.001);
  });

  test("two-finger trackpad scrolling travels a bounded distance on the walk plane", async ({
    page,
  }) => {
    await page.goto("/e2e/fixtures/pointer-controls.html");
    const authored = await readCameraState(page);
    await drag(page, { x: 500, y: 360 }, { x: 500, y: 260 });
    const beforeScroll = await readCameraState(page);
    const planarForward = normalise(
      projectOnPlane(beforeScroll.direction, authored.up),
    );

    await page.mouse.wheel(0, -12);
    await page.waitForTimeout(80);
    const afterScroll = await readCameraState(page);
    const travel = subtract(afterScroll.position, beforeScroll.position);

    expect(dot(travel, authored.up)).toBeCloseTo(0, 5);
    expect(dot(travel, planarForward)).toBeGreaterThan(0.005);
    expect(vectorLength(travel)).toBeLessThan(0.2);
  });

  test("cancels pending trackpad travel when the viewer loses focus", async ({ page }) => {
    await page.goto("/e2e/fixtures/pointer-controls.html");
    const initial = await readCameraState(page);

    await page.locator("#controlCanvas").evaluate((canvas) => {
      canvas.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -24,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      }));
      window.dispatchEvent(new Event("blur"));
    });
    await page.waitForTimeout(80);
    const afterBlur = await readCameraState(page);

    expect(vectorLength(subtract(afterBlur.position, initial.position))).toBeLessThan(0.001);
  });

  test("repeated travel cannot leave the active navigation boundary", async ({ page }) => {
    await page.goto("/e2e/fixtures/pointer-controls.html?boundary=1");

    for (let index = 0; index < 24; index += 1) {
      await page.mouse.wheel(0, -80);
    }
    await page.waitForTimeout(120);

    const state = await readCameraState(page);
    const bounds = await page.locator("body").evaluate((body) =>
      JSON.parse(body.dataset.navigationBounds ?? "{}") as {
        min: number[];
        max: number[];
      }
    );
    for (const [index, coordinate] of state.position.entries()) {
      expect(coordinate).toBeGreaterThanOrEqual(bounds.min[index]! - 1e-6);
      expect(coordinate).toBeLessThanOrEqual(bounds.max[index]! + 1e-6);
    }
  });

  test("look-only scenes reject travel without disabling camera look", async ({ page }) => {
    await page.goto("/e2e/fixtures/pointer-controls.html?translation=disabled");
    const initial = await readCameraState(page);

    for (let index = 0; index < 8; index += 1) {
      await page.mouse.wheel(0, -80);
    }
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(180);
    await page.keyboard.up("ArrowUp");
    const afterTravel = await readCameraState(page);

    expect(vectorLength(subtract(afterTravel.position, initial.position))).toBeLessThan(0.001);

    await drag(page, { x: 500, y: 320 }, { x: 400, y: 320 });
    const afterLook = await readCameraState(page);
    expect(vectorLength(subtract(afterLook.direction, initial.direction))).toBeGreaterThan(0.02);
  });
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

type CameraState = {
  position: number[];
  direction: number[];
  up: number[];
  right: number[];
};

async function readCameraState(
  page: import("@playwright/test").Page,
): Promise<CameraState> {
  return page.locator("body").evaluate((body) =>
    JSON.parse(body.dataset.cameraState ?? "{}") as CameraState
  );
}

function subtract(left: number[], right: number[]): number[] {
  return left.map((value, index) => value - (right[index] ?? 0));
}

function dot(left: number[], right: number[]): number {
  return left.reduce(
    (total, value, index) => total + value * (right[index] ?? 0),
    0,
  );
}

function normalise(vector: number[]): number[] {
  const length = Math.hypot(...vector);
  return length > 0 ? vector.map((value) => value / length) : vector;
}

function projectOnPlane(vector: number[], normal: number[]): number[] {
  const alongNormal = dot(vector, normal);
  return vector.map((value, index) => value - alongNormal * (normal[index] ?? 0));
}

function vectorLength(vector: number[]): number {
  return Math.hypot(...vector);
}
