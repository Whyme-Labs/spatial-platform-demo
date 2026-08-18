import { expect, test } from "@playwright/test";
import { SpzWriter } from "@sparkjsdev/spark";
// @ts-expect-error Plain ESM module has no separate declaration file.
import { buildAuthoredStructuralCollisionGlb } from "../scripts/authored-collision.mjs";
// @ts-expect-error Plain ESM module has no separate declaration file.
import { buildRecastNavigationArtifact, extractCollisionGeometryFromGlb } from "../scripts/navigation-build-core.mjs";

// The renderer once posted "ready" as soon as the splat was visible, before the
// Rapier and Detour runtimes existed — and once teleported the physics body to
// wherever an external message had put the camera, straight through reviewed
// walls. These tests pin the repaired boundaries: ready means movement-ready,
// the body is the authority on where the player is, and a door can never close
// on a player standing in it.

type CameraPose = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovDegrees: number;
};

type HostMessage = { type: string; code?: string };

test("the public renderer does not post ready before its walking runtime exists", async ({
  page,
}) => {
  const rapierInitWarnings: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("deprecated parameters for the initialization function")) {
      rapierInitWarnings.push(text);
    }
  });
  const fixture = await buildFixture();
  await mountFixture(page, fixture, { sendRuntime: false });

  // The splat is on screen: the local loader clears without a runtime.
  await expect(page.frameLocator("#renderer").locator("#sparkLoading")).toBeHidden({
    timeout: 15_000,
  });
  await page.waitForTimeout(1_500);
  expect(await messagesOfType(page, "ready")).toHaveLength(0);

  await sendRuntime(page, fixture);
  await expect
    .poll(async () => (await messagesOfType(page, "ready")).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  expect(rapierInitWarnings).toEqual([]);
});

test("a fatal walking-map error is never followed by ready", async ({ page }) => {
  const fixture = await buildFixture();
  await mountFixture(page, fixture, { sendRuntime: false });
  await expect(page.frameLocator("#renderer").locator("#sparkLoading")).toBeHidden({
    timeout: 15_000,
  });

  // A runtime without its collision asset must fail closed.
  await sendRuntime(page, fixture, { omitCollisionUrl: true });
  await expect
    .poll(async () => (await messagesOfType(page, "error")).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  const errors = await messagesOfType(page, "error");
  expect(errors[0]?.code).toBe("WALKING_MAP_COLLISION_REQUIRED");
  await page.waitForTimeout(1_500);
  expect(await messagesOfType(page, "ready")).toHaveLength(0);
});

test("a walk release opens standing and level, not at the authored review framing", async ({
  page,
}) => {
  const fixture = await buildFixture();
  // The authored QA framing: elevated above the room, pitched steeply down,
  // with a tilted authored up vector. A walk-enabled release must open
  // standing on the walkable floor at eye height, gaze level, world-vertical
  // up — only the heading survives from the framing.
  await mountFixture(page, fixture, {
    sendRuntime: true,
    cameraQuery: "camera=1,5,2&target=3,0.2,2.6&up=0.2,0.9,0.3",
  });

  const opened = await captureCamera(page);
  const eye = opened.position[1];
  expect(eye).toBeGreaterThan(1.4);
  expect(eye).toBeLessThan(1.8);
  // Standing inside the 8x4 room, on the walkable surface.
  expect(opened.position[0]).toBeGreaterThan(0);
  expect(opened.position[0]).toBeLessThan(8);
  expect(opened.position[2]).toBeGreaterThan(0);
  expect(opened.position[2]).toBeLessThan(4);
  // Level gaze, world-vertical up (no roll), heading kept from the framing.
  const direction = subtractTuple(opened.target, opened.position);
  const length = Math.hypot(...direction);
  expect(Math.abs(direction[1]! / length)).toBeLessThan(0.01);
  expect(opened.up[0]).toBeCloseTo(0, 5);
  expect(opened.up[1]).toBeCloseTo(1, 5);
  expect(opened.up[2]).toBeCloseTo(0, 5);
  expect(direction[0]! / length).toBeGreaterThan(0.5);

  // And walking works immediately from the opening pose.
  await page.frameLocator("#renderer").locator("#sparkCanvas").focus();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowUp");
  const walked = await captureCamera(page);
  expect(walked.position[0]).toBeGreaterThan(opened.position[0] + 0.3);
});

test("a synced camera cannot drag the player through a closed door", async ({ page }) => {
  const fixture = await buildFixture();
  await mountFixture(page, fixture, { sendRuntime: true });

  // The door slab spans x 5.5–5.62. Closed, it is solid; a sync-camera pose
  // inside it is a teleport into reviewed collision geometry and must be
  // rejected, recovering the camera from the physics body instead.
  await expect(setDynamicBarrier(page, "door-to-far-side", true)).resolves.toMatchObject({
    accepted: true,
    active: true,
  });
  const before = await captureCamera(page);
  await syncCamera(page, [5.56, 1.6, 2]);
  const after = await captureCamera(page);
  expect(Math.abs(after.position[0] - before.position[0])).toBeLessThan(0.05);
  expect(after.position[0]).toBeLessThan(5.2);
});

test("a synced camera outside the captured world recovers to the body", async ({ page }) => {
  const fixture = await buildFixture();
  await mountFixture(page, fixture, { sendRuntime: true });

  const before = await captureCamera(page);
  // Far beyond the shell: no navmesh projection, no floor. The old runtime
  // left the camera there and teleported the body after it into the void.
  await syncCamera(page, [30, 1.6, 2]);
  const after = await captureCamera(page);
  expect(after.position[0]).toBeLessThan(8);
  expect(Math.abs(after.position[0] - before.position[0])).toBeLessThan(0.05);

  // Movement still works from the recovered position.
  await page.frameLocator("#renderer").locator("#sparkCanvas").focus();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowUp");
  const walked = await captureCamera(page);
  expect(walked.position[0]).toBeGreaterThan(after.position[0] + 0.3);
});

test("a dynamic door refuses to close on a player standing in it", async ({ page }) => {
  const fixture = await buildFixture();
  await mountFixture(page, fixture, { sendRuntime: true });

  // Stand in the open doorway, then ask it to close around the capsule.
  const placed = await setCamera(page, [5.56, 1.6, 2]);
  expect(placed.accepted).toBe(true);
  const refused = await setDynamicBarrier(page, "door-to-far-side", true);
  expect(refused.accepted).toBe(false);
  expect(refused.message).toContain("cannot close");

  // The doorway stayed open in both worlds: walking straight on leaves it.
  await page.frameLocator("#renderer").locator("#sparkCanvas").focus();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(900);
  await page.keyboard.up("ArrowUp");
  const escaped = await captureCamera(page);
  expect(escaped.position[0]).toBeGreaterThan(5.8);

  // Clear of the slab, the same request must now succeed.
  await expect(setDynamicBarrier(page, "door-to-far-side", true)).resolves.toMatchObject({
    accepted: true,
    active: true,
  });
});

test("a walker stopped by a closed door is told which door", async ({ page }) => {
  const fixture = await buildFixture();
  await mountFixture(page, fixture, { sendRuntime: true });

  await expect(setDynamicBarrier(page, "door-to-far-side", true)).resolves.toMatchObject({
    accepted: true,
    active: true,
  });
  await page.frameLocator("#renderer").locator("#sparkCanvas").focus();
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("ArrowUp");
  await expect(page.frameLocator("#renderer").locator("#controlStatus")).toHaveText(
    "Blocked by door-to-far-side · this door is closed",
    { timeout: 8_000 },
  );
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("ShiftLeft");
});

async function buildFixture(): Promise<{
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
      assetId: "fixture-movement-integrity",
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

async function mountFixture(
  page: import("@playwright/test").Page,
  fixture: Awaited<ReturnType<typeof buildFixture>>,
  options: { sendRuntime: boolean; cameraQuery?: string },
): Promise<void> {
  const cameraQuery = options.cameraQuery ?? "camera=1,1.6,2&target=7,1.6,2";
  await page.route("**/asset/fixture-movement-integrity.glb", (route) => route.fulfill({
    status: 200,
    contentType: "model/gltf-binary",
    body: Buffer.from(fixture.collision),
  }));
  await page.route("**/asset/test-scene.spz", (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: Buffer.from(fixture.scene),
  }));
  await page.route("**/e2e/movement-integrity-host.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      #renderer { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
    </style><script>
      window.__rendererMessages = [];
      window.addEventListener("message", (event) => {
        if (event.data && event.data.source === "spatial-spark") {
          window.__rendererMessages.push({ type: event.data.type, code: event.data.code });
        }
      });
    </script><iframe id="renderer" title="Movement integrity proof"
      src="/renderer/index.html?content=/asset/test-scene.spz&format=spz&${cameraQuery}"></iframe>`,
  }));
  await page.goto("/e2e/movement-integrity-host.html");
  await expect(page.locator("#renderer")).toBeVisible();
  if (options.sendRuntime) {
    await sendRuntime(page, fixture);
    await expect(page.frameLocator("#renderer").locator("#controlStatus")).toHaveText(
      "Walk enabled · structural shell collision · furniture ignored",
      { timeout: 15_000 },
    );
  }
}

async function sendRuntime(
  page: import("@playwright/test").Page,
  fixture: Awaited<ReturnType<typeof buildFixture>>,
  options: { omitCollisionUrl?: boolean } = {},
): Promise<void> {
  await page.evaluate(({ artifact, omitCollisionUrl }) => {
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
      ...(omitCollisionUrl ? {} : { collisionUrl: "/asset/fixture-movement-integrity.glb" }),
      defaultMovementMode: "walk",
    }, location.origin);
  }, { artifact: fixture.navigationArtifact, omitCollisionUrl: options.omitCollisionUrl === true });
}

async function messagesOfType(
  page: import("@playwright/test").Page,
  type: string,
): Promise<HostMessage[]> {
  return page.evaluate((wanted) => {
    const messages = (window as unknown as { __rendererMessages?: HostMessage[] })
      .__rendererMessages ?? [];
    return messages.filter((message) => message.type === wanted);
  }, type) as Promise<HostMessage[]>;
}

async function syncCamera(
  page: import("@playwright/test").Page,
  position: [number, number, number],
): Promise<void> {
  await page.evaluate((requested) => {
    const renderer = document.querySelector<HTMLIFrameElement>("#renderer")?.contentWindow;
    if (!renderer) throw new Error("renderer frame is unavailable");
    renderer.postMessage({
      source: "spatial-host",
      type: "sync-camera",
      cameraPose: {
        position: requested,
        target: [requested[0] + 1, requested[1], requested[2]],
        up: [0, 1, 0],
        fovDegrees: 58,
      },
    }, location.origin);
  }, position);
  await page.waitForTimeout(400);
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

function subtractTuple(
  left: [number, number, number],
  right: [number, number, number],
): [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
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
