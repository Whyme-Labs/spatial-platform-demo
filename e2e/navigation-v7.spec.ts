import { expect, test } from "@playwright/test";
import { SpzWriter } from "@sparkjsdev/spark";
// These production builders are plain ESM so the processor and browser proof
// exercise the same structural-shell and Detour serialization code.
// @ts-expect-error Plain ESM module has no separate declaration file.
import { buildAuthoredStructuralCollisionGlb } from "../scripts/authored-collision.mjs";
// @ts-expect-error Plain ESM module has no separate declaration file.
import { buildRecastNavigationArtifact, extractCollisionGeometryFromGlb } from "../scripts/navigation-build-core.mjs";

test("v7 ignores furniture while Walk and Fly remain inside the structural shell", async ({
  page,
}) => {
  const fixture = await buildV7Fixture();
  await mountV7Fixture(page, fixture);

  const renderer = page.frameLocator("#renderer");
  await expect(renderer.locator("#controlStatus")).toHaveText(
    "Walk enabled · structural shell collision · furniture ignored",
    { timeout: 15_000 },
  );
  await expect(renderer.locator("#movementModeToggle")).toHaveText("Fly mode");

  await expect(setDynamicBarrier(page, "door-to-far-side", true)).resolves.toMatchObject({
    accepted: true,
    active: true,
  });
  await renderer.locator("#sparkCanvas").focus();
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1_600);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("ShiftLeft");
  const afterFurniture = await captureCamera(page);
  expect(afterFurniture.position[0]).toBeGreaterThan(5.15);
  expect(afterFurniture.position[0]).toBeLessThanOrEqual(5.3);

  const closedRoute = await setCamera(page, [7, 1.6, 2]);
  expect(closedRoute.accepted).toBe(false);
  expect(closedRoute.message).toContain("not reachable");

  await expect(setDynamicBarrier(page, "door-to-far-side", false)).resolves.toMatchObject({
    accepted: true,
    active: false,
  });

  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(900);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("ShiftLeft");
  const againstWall = await captureCamera(page);
  expect(againstWall.position[0]).toBeLessThanOrEqual(7.82);
  expect(againstWall.position[0] - afterFurniture.position[0]).toBeGreaterThan(2.2);

  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("ShiftLeft");
  const stillAgainstWall = await captureCamera(page);
  expect(stillAgainstWall.position[0] - againstWall.position[0]).toBeLessThan(0.08);

  await renderer.locator("#movementModeToggle").click();
  await expect(renderer.locator("#controlStatus")).toHaveText(
    "Fly enabled · structural shell collision · furniture ignored",
  );
  await expect(renderer.locator("#movementModeToggle")).toHaveText("Walk mode");

  await page.keyboard.down("KeyC");
  await page.waitForTimeout(1_500);
  await page.keyboard.up("KeyC");
  const onFloor = await captureCamera(page);
  expect(onFloor.position[1]).toBeGreaterThanOrEqual(0.17);
  expect(onFloor.position[1]).toBeLessThan(0.35);

  await page.keyboard.down("Space");
  await page.waitForTimeout(2_200);
  await page.keyboard.up("Space");
  const underCeiling = await captureCamera(page);
  expect(underCeiling.position[1]).toBeGreaterThan(2.6);
  expect(underCeiling.position[1]).toBeLessThanOrEqual(2.83);

  await renderer.locator("#movementModeToggle").click();
  await expect(renderer.locator("#controlStatus")).toHaveText(
    "Cannot land here · move into clear structural space",
  );
  await expect(renderer.locator("#movementModeToggle")).toHaveText("Walk mode");

  const flyRoomMove = await setCamera(page, [1, 1.6, 2]);
  expect(flyRoomMove.accepted).toBe(true);
  await renderer.locator("#movementModeToggle").click();
  await expect(renderer.locator("#controlStatus")).toHaveText(
    "Walk enabled · structural shell collision · furniture ignored",
  );
  await expect(renderer.locator("#movementModeToggle")).toHaveText("Fly mode");
});

test("v7 preserves an authored elevated opening camera in default Fly mode", async ({ page }) => {
  const fixture = await buildV7Fixture();
  await mountV7Fixture(page, fixture, {
    defaultMode: "fly",
    cameraPosition: [1, 2.4, 2],
  });

  const renderer = page.frameLocator("#renderer");
  await expect(renderer.locator("#controlStatus")).toHaveText(
    "Fly enabled · structural shell collision · furniture ignored",
    { timeout: 15_000 },
  );
  await expect(renderer.locator("#movementModeToggle")).toHaveText("Walk mode");
  const opening = await captureCamera(page);
  expect(opening.position[1]).toBeCloseTo(2.4, 1);
});

test("v9 carries Walk mode through an evidence-linked multi-floor elevator path", async ({ page }) => {
  const fixture = await buildV8Fixture();
  await mountV7Fixture(page, fixture, {
    cameraPosition: [1, 1.6, 2],
  });
  const renderer = page.frameLocator("#renderer");
  await expect(renderer.locator("#controlStatus")).toHaveText(
    "Walk enabled · structural shell collision · furniture ignored",
  );
  await page.evaluate(() => {
    const events: unknown[] = [];
    Reflect.set(window, "__authoredTraversalEvents", events);
    window.addEventListener("message", (event) => {
      if (event.data?.source === "spatial-spark" &&
        event.data?.type === "authored-traversal-state") events.push(event.data);
    });
  });
  const idleLimePixels = await countTraversalOverlayPixels(
    page,
    await renderer.locator("#sparkCanvas").screenshot(),
  );
  await renderer.locator("#sparkCanvas").focus();
  await page.keyboard.down("ArrowUp");
  try {
    await expect(renderer.locator("#controlStatus")).toContainText("evidence-linked");
    const activeLimePixels = await countTraversalOverlayPixels(
      page,
      await renderer.locator("#sparkCanvas").screenshot(),
    );
    expect(activeLimePixels).toBeGreaterThan(idleLimePixels);
    await expect.poll(async () => {
      const position = (await captureCamera(page)).position;
	      return position[0] > 3.65 && position[1] > 4.5;
    }).toBe(true);
  } finally {
    await page.keyboard.up("ArrowUp");
  }
  const upperFloor = await captureCamera(page);
  expect(upperFloor.position[0]).toBeGreaterThan(3.65);
  expect(upperFloor.position[1]).toBeGreaterThan(4.5);
  expect(upperFloor.position[1]).toBeLessThan(4.75);
  const traversalEvents = await page.evaluate(() =>
    Reflect.get(window, "__authoredTraversalEvents") as Array<Record<string, unknown>>
  );
  expect(traversalEvents).toEqual([
    expect.objectContaining({
      connectionId: "east-lift",
      label: "East lift",
      phase: "started",
      qualification: {
        adapter: "xgrids-lcc",
        manifestSha256: "b".repeat(64),
        reviewGeneration: 1,
        registrationSha256: "c".repeat(64),
      },
    }),
    expect.objectContaining({
      connectionId: "east-lift",
      label: "East lift",
      phase: "completed",
      qualification: {
        adapter: "xgrids-lcc",
        manifestSha256: "b".repeat(64),
        reviewGeneration: 1,
        registrationSha256: "c".repeat(64),
      },
    }),
  ]);
});

async function countTraversalOverlayPixels(
  page: import("@playwright/test").Page,
  screenshot: Buffer,
): Promise<number> {
  return page.evaluate(async (encoded) => {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Browser could not inspect the rendered traversal overlay");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let matches = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index]!;
      const green = pixels[index + 1]!;
      const blue = pixels[index + 2]!;
      // The relation comes from the authored overlay colour 0xcaff3f and is
      // stable through antialiasing because blending scales all three channels.
      if (green > red && red > blue * 2) matches += 1;
    }
    return matches;
  }, screenshot.toString("base64"));
}

test.describe("v7 touch flight controls", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("keeps altitude, joystick, status, and toolbar controls separate", async ({ page }) => {
    const fixture = await buildV7Fixture();
    await mountV7Fixture(page, fixture);
    const renderer = page.frameLocator("#renderer");
    await expect(renderer.locator("#controlStatus")).toHaveText(
      "Walk enabled · structural shell collision · furniture ignored",
      { timeout: 15_000 },
    );
    await renderer.locator("#startFreeRoam").click();
    await renderer.locator("#movementModeToggle").click();
    await expect(renderer.locator("#movementModeToggle")).toHaveText("Walk");
    await expect(renderer.locator("#flightAltitudeControls")).toBeVisible();

    const before = await captureCamera(page);
    await renderer.locator("#flyAscend").evaluate((element) => {
      element.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 71,
        pointerType: "touch",
      }));
    });
    await page.waitForTimeout(500);
    await renderer.locator("#flyAscend").evaluate((element) => {
      element.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 71,
        pointerType: "touch",
      }));
    });
    const after = await captureCamera(page);
    expect(after.position[1] - before.position[1]).toBeGreaterThan(0.25);

    const layout = await renderer.locator("#sparkViewport").evaluate((viewport) => {
      const rect = (selector: string) => {
        const element = viewport.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
      };
      const overlaps = (
        first: { left: number; right: number; top: number; bottom: number },
        second: { left: number; right: number; top: number; bottom: number },
      ) => first.left < second.right && first.right > second.left &&
        first.top < second.bottom && first.bottom > second.top;
      const toolbar = rect(".spark-controls");
      const status = rect("#controlStatus");
      const joystick = rect("#movementPad");
      const altitude = rect("#flightAltitudeControls");
      return {
        toolbarStatusOverlap: overlaps(toolbar, status),
        joystickAltitudeOverlap: overlaps(joystick, altitude),
        horizontalOverflow: Math.max(toolbar.right, status.right, joystick.right, altitude.right) >
          viewport.clientWidth + 1,
      };
    });
    expect(layout).toEqual({
      toolbarStatusOverlap: false,
      joystickAltitudeOverlap: false,
      horizontalOverflow: false,
    });
  });

  test("keeps the expanded help clear of flight controls in short landscape", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const fixture = await buildV7Fixture();
    await mountV7Fixture(page, fixture);
    const renderer = page.frameLocator("#renderer");
    await expect(renderer.locator("#controlStatus")).toHaveText(
      "Walk enabled · structural shell collision · furniture ignored",
      { timeout: 15_000 },
    );
    await renderer.locator("#startFreeRoam").click();
    await renderer.locator("#movementModeToggle").click();
    await renderer.locator("#toggleHelp").click();
    await expect(renderer.locator("#controlHelp")).toBeVisible();
    await expect(renderer.locator("#flightAltitudeControls")).toBeVisible();

    const layout = await renderer.locator("#sparkViewport").evaluate((viewport) => {
      const rect = (selector: string) => {
        const element = viewport.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
      };
      const overlaps = (
        first: { left: number; right: number; top: number; bottom: number },
        second: { left: number; right: number; top: number; bottom: number },
      ) => first.left < second.right && first.right > second.left &&
        first.top < second.bottom && first.bottom > second.top;
      const help = rect("#controlHelp");
      const toolbar = rect(".spark-controls");
      const joystick = rect("#movementPad");
      const altitude = rect("#flightAltitudeControls");
      return {
        helpToolbarOverlap: overlaps(help, toolbar),
        helpJoystickOverlap: overlaps(help, joystick),
        helpAltitudeOverlap: overlaps(help, altitude),
        joystickAltitudeOverlap: overlaps(joystick, altitude),
        verticalOverflow: Math.max(help.bottom, toolbar.bottom, joystick.bottom, altitude.bottom) >
          viewport.clientHeight + 1,
        horizontalOverflow: Math.max(help.right, toolbar.right, joystick.right, altitude.right) >
          viewport.clientWidth + 1,
      };
    });
    expect(layout).toEqual({
      helpToolbarOverlap: false,
      helpJoystickOverlap: false,
      helpAltitudeOverlap: false,
      joystickAltitudeOverlap: false,
      verticalOverflow: false,
      horizontalOverflow: false,
    });
  });
});

type CameraPose = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovDegrees: number;
};

async function buildV7Fixture(): Promise<{
  collision: Uint8Array;
  navigationArtifact: Record<string, unknown> & { navMesh: unknown };
  scene: Uint8Array;
}> {
  const collision = buildAuthoredStructuralCollisionGlb({
    schemaVersion: "authored-structural-collision-v2",
    provenance: "operator_reviewed",
    floorRectangles: [{ id: "floor", min: [0, 0], max: [8, 4], elevation: 0 }],
    ceilingRectangles: [{ id: "ceiling", min: [0, 0], max: [8, 4], elevation: 3 }],
    barrierSegments: [
      { id: "west-wall", start: [0, 0], end: [0, 4], minY: 0, maxY: 3 },
      { id: "east-wall", start: [8, 0], end: [8, 4], minY: 0, maxY: 3 },
      { id: "north-wall", start: [0, 0], end: [8, 0], minY: 0, maxY: 3 },
      { id: "south-wall", start: [0, 4], end: [8, 4], minY: 0, maxY: 3 },
    ],
    dynamicBarrierBoxes: [{
      id: "door-to-far-side",
      min: [5.5, 0, 0],
      max: [5.62, 3, 4],
      defaultActive: false,
    }],
    // This box spans the route and would stop the player if the appearance
    // classification leaked into movement collision.
    furnitureBoxes: [{ id: "sofa", min: [3, 0, 0.4], max: [5, 1.4, 3.6] }],
  });
  const geometry = await extractCollisionGeometryFromGlb(collision);
  const navigationArtifact = await buildRecastNavigationArtifact({
    positions: geometry.positions,
    indices: geometry.indices,
    collisionSemantics: geometry.collisionSemantics,
    dynamicBarriers: geometry.dynamicBarriers,
    structuralGeometry: geometry.structuralGeometry,
    source: {
      assetId: "fixture-structural-v7",
      sha256: "a".repeat(64),
      authoringHash: "b".repeat(64),
      worldUnit: "metres",
    },
    agent: {
      radius: 0.22,
      height: 1.8,
      eyeHeight: 1.6,
      maxClimb: 0.1,
      maxSlopeDegrees: 45,
      maxSpeed: 1.6,
      maxAcceleration: 8,
    },
    build: { cellSize: 0.1, cellHeight: 0.05, tileSize: 32 },
    spawn: { id: "opening", position: [1, 0, 2] },
    destinations: [{ id: "far-side", position: [7, 0, 2] }],
  });
  return { collision, navigationArtifact, scene: await minimalSpz() };
}

async function buildV8Fixture(): Promise<Awaited<ReturnType<typeof buildV7Fixture>>> {
  const collision = buildAuthoredStructuralCollisionGlb({
    schemaVersion: "authored-structural-collision-v2",
    provenance: "operator_reviewed",
    floorRectangles: [
      { id: "lower-floor", min: [0, 0], max: [2, 4], elevation: 0 },
      { id: "upper-floor", min: [3, 0], max: [5, 4], elevation: 3 },
    ],
    ceilingRectangles: [
      { id: "lower-ceiling-clear-of-lift-shaft", min: [0, 0], max: [1.2, 4], elevation: 3 },
      { id: "upper-ceiling", min: [3, 0], max: [5, 4], elevation: 6 },
    ],
    barrierSegments: [
      { id: "lower-west", start: [0, 0], end: [0, 4], minY: 0, maxY: 3 },
      { id: "lower-north", start: [0, 0], end: [2, 0], minY: 0, maxY: 3 },
      { id: "lower-south", start: [0, 4], end: [2, 4], minY: 0, maxY: 3 },
      { id: "upper-east", start: [5, 0], end: [5, 4], minY: 3, maxY: 6 },
      { id: "upper-north", start: [3, 0], end: [5, 0], minY: 3, maxY: 6 },
      { id: "upper-south", start: [3, 4], end: [5, 4], minY: 3, maxY: 6 },
    ],
    furnitureBoxes: [],
  });
  const geometry = await extractCollisionGeometryFromGlb(collision);
  const navigationArtifact = await buildRecastNavigationArtifact({
    positions: geometry.positions,
    indices: geometry.indices,
    collisionSemantics: geometry.collisionSemantics,
    dynamicBarriers: geometry.dynamicBarriers,
    structuralGeometry: geometry.structuralGeometry,
    source: {
      assetId: "fixture-structural-v8",
      sha256: "c".repeat(64),
      authoringHash: "d".repeat(64),
      worldUnit: "metres",
    },
    agent: {
      radius: 0.22,
      height: 1.8,
      eyeHeight: 1.6,
      maxClimb: 0.1,
      maxSlopeDegrees: 45,
      maxSpeed: 1.6,
      maxAcceleration: 8,
    },
    build: { cellSize: 0.1, cellHeight: 0.05, tileSize: 32 },
    spawn: { id: "opening", position: [1, 0, 2] },
    destinations: [{ id: "upper-room", position: [4, 3, 2] }],
    offMeshConnections: [{
      id: "east-lift",
      traversalKind: "elevator",
      label: "East lift",
      startPosition: [1.3, 0.05, 2],
      controlPoints: [[1.75, 0.05, 2], [1.75, 3.05, 2], [3.3, 3.05, 2]],
      endPosition: [3.7, 3.05, 2],
      radius: 0.25,
      bidirectional: true,
      speedUnitsPerSecond: 2,
      area: 0,
      flags: 1,
      userId: 1,
      reviewedPurpose: "Reviewed elevator path between the lower and upper captured rooms.",
      evidenceReceipt: {
        assetId: "11111111-1111-4111-8111-111111111111",
        sha256: "a".repeat(64),
        manifestId: "22222222-2222-4222-8222-222222222222",
        manifestSha256: "b".repeat(64),
        adapter: "xgrids-lcc",
        reviewGeneration: 1,
        registrationSha256: "c".repeat(64),
        sourceToWorld: {
          sourceUpAxis: "Y",
          worldUnit: "metres",
          metresPerSourceUnit: 1,
          yawDegrees: 0,
          translationMetres: [0, 0, 0],
        },
        sourcePath: [
          [1.3, 0.05, 2],
          [1.75, 0.05, 2],
          [1.75, 3.05, 2],
          [3.3, 3.05, 2],
          [3.7, 3.05, 2],
        ],
      },
    }],
  });
  return { collision, navigationArtifact, scene: await minimalSpz() };
}

async function mountV7Fixture(
  page: import("@playwright/test").Page,
  fixture: Awaited<ReturnType<typeof buildV7Fixture>>,
  options: {
    defaultMode?: "walk" | "fly";
    cameraPosition?: [number, number, number];
  } = {},
): Promise<void> {
  const defaultMode = options.defaultMode ?? "walk";
  const cameraPosition = options.cameraPosition ?? [1, 1.6, 2];
  await page.route("**/asset/fixture-structural-v7.glb", (route) => route.fulfill({
    status: 200,
    contentType: "model/gltf-binary",
    body: Buffer.from(fixture.collision),
  }));
  await page.route("**/asset/test-scene.spz", (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: Buffer.from(fixture.scene),
  }));
  await page.route("**/e2e/navigation-v7-host.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      #renderer { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
    </style><iframe id="renderer" title="V7 movement runtime"
      src="/renderer/index.html?content=/asset/test-scene.spz&format=spz&camera=${cameraPosition.join(",")}&target=7,${cameraPosition[1]},2"></iframe>`,
  }));
  await page.goto("/e2e/navigation-v7-host.html");
  await expect(page.locator("#renderer")).toBeVisible();
  const rendererFrame = page.frameLocator("#renderer");
  await expect(rendererFrame.locator("#sparkLoading")).toBeHidden({ timeout: 15_000 });
  await page.evaluate(({ artifact, defaultMovementMode }) => {
    const renderer = document.querySelector<HTMLIFrameElement>("#renderer")?.contentWindow;
    if (!renderer) throw new Error("renderer frame is unavailable");
    renderer.postMessage({
      source: "spatial-host",
      type: "set-spatial-runtime",
      collisionBoxes: [],
      navigationMesh: artifact.navMesh,
      obstacleBoxes: [],
      doorwayBoxes: [],
      navigationProfile: {
        worldUnit: "metres",
        agentRadius: 0.22,
        agentHeight: 1.8,
        eyeHeight: 1.6,
        maxStepMetres: 0.1,
        maxSlopeDegrees: 45,
        maxSpeed: 1.6,
        maxAcceleration: 8,
      },
      navigationArtifact: artifact,
      collisionUrl: "/asset/fixture-structural-v7.glb",
      defaultMovementMode,
    }, location.origin);
  }, { artifact: fixture.navigationArtifact, defaultMovementMode: defaultMode });
}

async function captureCamera(page: import("@playwright/test").Page): Promise<CameraPose> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const renderer = document.querySelector<HTMLIFrameElement>("#renderer")?.contentWindow;
    if (!renderer) return reject(new Error("renderer frame is unavailable"));
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => reject(new Error("camera capture timed out")), 5_000);
    const receive = (event: MessageEvent) => {
      if (event.data?.source !== "spatial-spark" || event.data?.type !== "camera" ||
        event.data?.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve(event.data.cameraPose);
    };
    window.addEventListener("message", receive);
    renderer.postMessage(
      { source: "spatial-host", type: "capture-camera", requestId },
      location.origin,
    );
  })) as Promise<CameraPose>;
}

async function setDynamicBarrier(
  page: import("@playwright/test").Page,
  barrierId: string,
  active: boolean,
): Promise<{ accepted: boolean; active: boolean; message: string }> {
  return page.evaluate(({ barrierId, active }) => new Promise((resolve, reject) => {
    const renderer = document.querySelector<HTMLIFrameElement>("#renderer")?.contentWindow;
    if (!renderer) return reject(new Error("renderer frame is unavailable"));
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => reject(new Error("barrier state timed out")), 5_000);
    const receive = (event: MessageEvent) => {
      if (event.data?.source !== "spatial-spark" || event.data?.type !== "dynamic-barrier-state" ||
        event.data?.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve(event.data);
    };
    window.addEventListener("message", receive);
    renderer.postMessage({
      source: "spatial-host",
      type: "set-dynamic-barrier-state",
      requestId,
      barrierId,
      active,
    }, location.origin);
  }), { barrierId, active }) as Promise<{ accepted: boolean; active: boolean; message: string }>;
}

async function setCamera(
  page: import("@playwright/test").Page,
  position: [number, number, number],
): Promise<{ accepted: boolean; message?: string }> {
  return page.evaluate((position) => new Promise((resolve, reject) => {
    const renderer = document.querySelector<HTMLIFrameElement>("#renderer")?.contentWindow;
    if (!renderer) return reject(new Error("renderer frame is unavailable"));
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => reject(new Error("camera set timed out")), 5_000);
    const receive = (event: MessageEvent) => {
      if (event.data?.source !== "spatial-spark" || event.data?.type !== "camera-set" ||
        event.data?.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve(event.data);
    };
    window.addEventListener("message", receive);
    renderer.postMessage({
      source: "spatial-host",
      type: "set-camera",
      requestId,
      cameraPose: {
        position,
        target: [position[0] + 1, position[1], position[2]],
        up: [0, 1, 0],
        fovDegrees: 58,
      },
    }, location.origin);
  }), position) as Promise<{ accepted: boolean; message?: string }>;
}

async function minimalSpz(): Promise<Uint8Array> {
  const writer = new SpzWriter({ numSplats: 4, shDegree: 0, flagAntiAlias: false });
  const centres = [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]] as const;
  centres.forEach(([x, y, z], index) => {
    writer.setCenter(index, x, y, z);
    writer.setAlpha(index, 1);
    writer.setRgb(index, 0.5, 0.5, 0.5);
    writer.setScale(index, -2, -2, -2);
    writer.setQuat(index, 0, 0, 0, 1);
  });
  return writer.finalize();
}
