import { expect, test } from "@playwright/test";

test.describe("touch-first Spark controls", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("presents a bounded touch control surface with an explicit loading state", async ({ page }) => {
    await page.goto("/renderer/index.html");

    const freeRoam = page.getByRole("button", { name: "Free roam" });
    await expect(freeRoam).toBeVisible();
    await expect(freeRoam).toBeDisabled();
    await expect(freeRoam).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("group", { name: "Movement joystick" })).toBeHidden();
    await expect(page.locator(".spark-runtime")).toBeHidden();
    await expect(page.getByText("The spatial scene could not be rendered.", {
      exact: true,
    })).toBeVisible();

    const contract = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>("#freeRoamToggle");
      const toolbar = document.querySelector<HTMLElement>(".spark-controls");
      if (!button || !toolbar) return null;
      const buttonBounds = button.getBoundingClientRect();
      const toolbarBounds = toolbar.getBoundingClientRect();
      return {
        buttonHeight: buttonBounds.height,
        toolbarRight: toolbarBounds.right,
        toolbarTop: toolbarBounds.top,
        viewportWidth: window.innerWidth,
      };
    });
    expect(contract).not.toBeNull();
    expect(contract!.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(contract!.toolbarRight).toBeLessThanOrEqual(contract!.viewportWidth + 1);
    expect(contract!.toolbarTop).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test("onboards free roam, tracks thumb movement, and always releases to neutral", async ({ page }) => {
    await page.goto("/renderer/index.html");
    await page.evaluate(() => {
      window.dispatchEvent(new Event("spatial:e2e-mobile-controls-ready"));
    });

    const freeRoam = page.locator("#freeRoamToggle");
    const joystick = page.getByRole("group", { name: "Movement joystick" });
    const movementStatus = page.locator("#movementStatus");
    await expect(freeRoam).toBeEnabled();
    await expect(page.getByRole("dialog", { name: "Explore without learning game controls." }))
      .toBeVisible();

    await page.getByRole("button", { name: "Try Free roam" }).click();
    await expect(freeRoam).toHaveAttribute("aria-pressed", "true");
    await expect(freeRoam).toHaveText("Exit roam");
    await expect(joystick).toBeVisible();
    await expect(page.getByText("Drag scene to look")).toBeVisible();
    await expect(page.locator("#sparkViewport")).toHaveClass(/free-roam-active/);

    await joystick.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      element.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 41,
        pointerType: "touch",
        clientX: centerX,
        clientY: centerY,
      }));
      element.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerId: 41,
        pointerType: "touch",
        clientX: centerX + 18,
        clientY: centerY - 50,
      }));
    });
    await expect(movementStatus).toHaveText(/Moving forward and right/);

    await joystick.evaluate((element) => {
      element.dispatchEvent(new PointerEvent("pointercancel", {
        bubbles: true,
        cancelable: true,
        pointerId: 41,
        pointerType: "touch",
      }));
    });
    await expect(movementStatus).toHaveText("Stopped");
    await expect(page.locator("#movementKnob")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

    await joystick.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 42,
        pointerType: "touch",
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + 12,
      }));
      window.dispatchEvent(new Event("blur"));
    });
    await expect(movementStatus).toHaveText("Stopped");

    await joystick.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      element.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 43,
        pointerType: "touch",
        clientX: centerX,
        clientY: centerY - 46,
      }));
      element.dispatchEvent(new PointerEvent("lostpointercapture", {
        bubbles: true,
        cancelable: false,
        pointerId: 43,
        pointerType: "touch",
      }));
    });
    await expect(movementStatus).toHaveText("Stopped");

    await freeRoam.click();
    await expect(freeRoam).toHaveAttribute("aria-pressed", "false");
    await expect(joystick).toBeHidden();
    await expect(page.locator("#sparkViewport")).not.toHaveClass(/free-roam-active/);
  });

  test("keeps releases without authored navigation in an explicit look-only mode", async ({
    page,
  }) => {
    await page.route("**/asset/test-scene.spz", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: "invalid-spz-fixture",
      })
    );
    await page.goto("/renderer/index.html?content=/asset/test-scene.spz&format=spz");
    await expect(page.getByText(
      "The spatial scene could not be rendered.",
      { exact: true },
    )).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          source: "spatial-host",
          type: "set-spatial-runtime",
          collisionBoxes: [],
        },
        origin: location.origin,
        source: window,
      }));
    });

    const lookOnly = page.getByRole("button", { name: "Look only" });
    await expect(lookOnly).toBeVisible();
    await expect(lookOnly).toBeDisabled();
    await expect(lookOnly).toHaveAttribute(
      "title",
      "Walking is unavailable until this scene has a navigation map",
    );

    await page.getByRole("button", { name: "Controls" }).click();
    await expect(page.locator("#mobileMovementHelp")).toHaveText(
      "Drag to look · walking is unavailable for this scene",
    );
    await expect(page.locator("#mobileMovementHelp")).toBeVisible();
    await expect(page.locator("#desktopKeyboardHelp")).toHaveAttribute("hidden", "");
  });
});

test("does not add game controls for a fine-pointer desktop viewer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/renderer/index.html");

  await expect(page.getByRole("button", { name: "Free roam" })).toBeHidden();
  await expect(page.getByRole("group", { name: "Movement joystick" })).toBeHidden();
});

test("hides the diagnostic runtime badge when the renderer is embedded", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    Reflect.set(window, "rendererMessages", []);
    window.addEventListener("message", (event) => {
      if (event.data?.source === "spatial-spark") {
        Reflect.get(window, "rendererMessages").push(event.data);
      }
    });
    const frame = document.createElement("iframe");
    frame.id = "embedded-renderer";
    frame.src = "/renderer/index.html";
    document.body.append(frame);
  });

  const renderer = page.frameLocator("#embedded-renderer");
  await expect(renderer.locator("html")).toHaveClass(/spark-embedded/);
  await expect(renderer.locator(".spark-runtime")).toBeHidden();
  await renderer.getByRole("button", { name: "Controls" }).click();
  await expect(renderer.locator("#controlHelp")).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    Reflect.get(window, "rendererMessages").find(
      (message: { type?: string }) => message.type === "control-help",
    )
  )).toMatchObject({
    type: "control-help",
    visible: true,
    height: expect.any(Number),
  });
});

test("summarizes authored walking readiness without exposing mesh jargon", async ({ page }) => {
  await page.route("**/asset/test-scene.spz", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: "invalid-spz-fixture",
    })
  );
  await page.goto("/renderer/index.html?content=/asset/test-scene.spz&format=spz");
  await expect(page.getByText(
    "The spatial scene could not be rendered.",
    { exact: true },
  )).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        source: "spatial-host",
        type: "set-spatial-runtime",
        collisionBoxes: [{ min: [0, 0, 0], max: [4, 3, 4] }],
        navigationMesh: {
          vertices: [[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]],
          indices: [0, 1, 2, 0, 2, 3],
          sourceEntityIds: ["room"],
        },
        obstacleBoxes: [{
          entityId: "table",
          min: [1, 0, 1],
          max: [2, 1, 2],
        }],
        navigationProfile: {
          worldUnit: "scene_units",
          agentRadius: 0.22,
          agentHeight: 1.8,
          eyeHeight: 1.6,
          maxStepMetres: 0.1,
        },
      },
      origin: location.origin,
      source: window,
    }));
  });

  const status = page.locator("#controlStatus");
  await expect(status).toHaveText("Walking enabled · 1 obstacle mapped");
  await expect(status).toHaveAttribute("data-tone", "ready");
  await expect(status).not.toContainText("triangles");
  await expect(page.getByRole("button", { name: "Reset view" })).toBeVisible();
  const controlsButton = page.getByRole("button", { name: "Controls" });
  await expect(controlsButton).toBeVisible();
  await expect(page.getByRole("button", { name: "Full screen" })).toBeVisible();

  await controlsButton.click();
  await expect(page.locator("#controlHelp")).toBeVisible();
  await expect(status).toBeHidden();
  const controlsLayout = await page.evaluate(() => {
    const help = document.querySelector<HTMLElement>("#controlHelp");
    const controls = document.querySelector<HTMLElement>(".spark-controls");
    if (!help || !controls) return null;
    const helpBounds = help.getBoundingClientRect();
    const controlBounds = controls.getBoundingClientRect();
    return {
      overlaps:
        helpBounds.left < controlBounds.right &&
        helpBounds.right > controlBounds.left &&
        helpBounds.top < controlBounds.bottom &&
        helpBounds.bottom > controlBounds.top,
    };
  });
  expect(controlsLayout).toEqual({ overlaps: false });

  await controlsButton.click();
  await expect(page.locator("#controlHelp")).toBeHidden();
  await expect(status).toBeVisible();
});

test("keeps renderer status and controls separated in a compact fine-pointer viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/renderer/index.html");

  const layout = await page.evaluate(() => {
    const runtime = document.querySelector<HTMLElement>(".spark-runtime");
    const controls = document.querySelector<HTMLElement>(".spark-controls");
    if (!runtime || !controls) return null;
    const runtimeBounds = runtime.getBoundingClientRect();
    const controlBounds = controls.getBoundingClientRect();
    return {
      runtime: {
        top: runtimeBounds.top,
        right: runtimeBounds.right,
        bottom: runtimeBounds.bottom,
        left: runtimeBounds.left,
      },
      controls: {
        top: controlBounds.top,
        right: controlBounds.right,
        bottom: controlBounds.bottom,
        left: controlBounds.left,
      },
    };
  });

  expect(layout).not.toBeNull();
  const overlaps =
    layout!.runtime.left < layout!.controls.right
    && layout!.runtime.right > layout!.controls.left
    && layout!.runtime.top < layout!.controls.bottom
    && layout!.runtime.bottom > layout!.controls.top;
  expect(overlaps).toBe(false);
});
