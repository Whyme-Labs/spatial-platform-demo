import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { SpzWriter } from "@sparkjsdev/spark";
// @ts-expect-error Plain ESM module has no separate declaration file.
import { buildAuthoredStructuralCollisionGlb } from "../scripts/authored-collision.mjs";
// @ts-expect-error Plain ESM module has no separate declaration file.
import { buildRecastNavigationArtifact, extractCollisionGeometryFromGlb } from "../scripts/navigation-build-core.mjs";

// The published Home Scan shell once ran wall-28 unbroken across a doorway the
// capture plainly shows, so a visitor standing in the opening slid sideways
// along an invisible wall. Offline proofs never caught it: they check the shell
// against itself. This walks the real committed shell in a real browser, so the
// opening has to survive as geometry a Rapier capsule can pass through.
const DOORWAY_CENTRE_X = 6.05;
const LIVING_ROOM_Z = -3.4;
const KITCHEN_Z = -5.5;

type CameraPose = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovDegrees: number;
};

test("the reviewed Home Scan doorway lets a walker reach the kitchen", async ({ page }) => {
  const authoring = JSON.parse(
    await readFile(new URL("../assets/home-scan-structural-v7.json", import.meta.url), "utf8"),
  );
  const collision = buildAuthoredStructuralCollisionGlb(authoring);
  const geometry = await extractCollisionGeometryFromGlb(collision);
  const artifact = await buildRecastNavigationArtifact({
    positions: geometry.positions,
    indices: geometry.indices,
    collisionSemantics: geometry.collisionSemantics,
    dynamicBarriers: geometry.dynamicBarriers,
    structuralGeometry: geometry.structuralGeometry,
    source: {
      assetId: "home-scan-structural-v7",
      sha256: "a".repeat(64),
      authoringHash: "b".repeat(64),
      worldUnit: authoring.source?.worldUnit === "metres" ? "metres" : "scene_units",
    },
    agent: authoring.agent,
    build: authoring.build,
    bounds: authoring.bounds,
    spawn: authoring.spawn,
    destinations: authoring.destinations,
    offMeshConnections: authoring.offMeshConnections ?? [],
  });

  await mountScene(page, {
    collision,
    artifact,
    camera: [DOORWAY_CENTRE_X, authoring.spawn.position[1] + 1.6, LIVING_ROOM_Z],
    target: [DOORWAY_CENTRE_X, authoring.spawn.position[1] + 1.55, LIVING_ROOM_Z - 1],
  });

  const before = await captureCamera(page);
  expect(before.position[2]).toBeGreaterThan(KITCHEN_Z);

  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(4_000);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("ShiftLeft");

  const after = await captureCamera(page);
  // Through the opening and well into the room beyond, not stalled in it.
  expect(after.position[2]).toBeLessThan(KITCHEN_Z);
  // Straight through rather than sliding along a wall that should not be there.
  expect(Math.abs(after.position[0] - before.position[0])).toBeLessThan(1);
});

test("the partition beside the reviewed doorway still stops a walker", async ({ page }) => {
  const authoring = JSON.parse(
    await readFile(new URL("../assets/home-scan-structural-v7.json", import.meta.url), "utf8"),
  );
  const collision = buildAuthoredStructuralCollisionGlb(authoring);
  const geometry = await extractCollisionGeometryFromGlb(collision);
  const artifact = await buildRecastNavigationArtifact({
    positions: geometry.positions,
    indices: geometry.indices,
    collisionSemantics: geometry.collisionSemantics,
    dynamicBarriers: geometry.dynamicBarriers,
    structuralGeometry: geometry.structuralGeometry,
    source: {
      assetId: "home-scan-structural-v7",
      sha256: "a".repeat(64),
      authoringHash: "b".repeat(64),
      worldUnit: authoring.source?.worldUnit === "metres" ? "metres" : "scene_units",
    },
    agent: authoring.agent,
    build: authoring.build,
    bounds: authoring.bounds,
    spawn: authoring.spawn,
    destinations: authoring.destinations,
    offMeshConnections: authoring.offMeshConnections ?? [],
  });

  // Two metres east of the opening the reviewed partition is solid, so opening
  // the doorway must not have opened the whole wall line with it.
  const blockedX = 8.2;
  await mountScene(page, {
    collision,
    artifact,
    camera: [blockedX, authoring.spawn.position[1] + 1.6, LIVING_ROOM_Z],
    target: [blockedX, authoring.spawn.position[1] + 1.55, LIVING_ROOM_Z - 1],
  });

  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(3_000);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("ShiftLeft");

  const after = await captureCamera(page);
  expect(after.position[2]).toBeGreaterThan(-4.2);
});

async function mountScene(
  page: import("@playwright/test").Page,
  options: {
    collision: Uint8Array;
    artifact: Record<string, unknown> & { navMesh: unknown };
    camera: [number, number, number];
    target: [number, number, number];
  },
): Promise<void> {
  await page.route("**/asset/home-scan-structural-v7.glb", (route) => route.fulfill({
    status: 200,
    contentType: "model/gltf-binary",
    body: Buffer.from(options.collision),
  }));
  await page.route("**/asset/home-scan-scene.spz", async (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: Buffer.from(await minimalSpz()),
  }));
  await page.route("**/e2e/home-scan-doorway-host.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      #renderer { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
    </style><iframe id="renderer" title="Home Scan doorway proof"
      src="/renderer/index.html?content=/asset/home-scan-scene.spz&format=spz&camera=${
      options.camera.join(",")
    }&target=${options.target.join(",")}"></iframe>`,
  }));
  await page.goto("/e2e/home-scan-doorway-host.html");
  await expect(page.locator("#renderer")).toBeVisible();
  await page.evaluate(({ artifact, profile }) => {
    const renderer = document.querySelector<HTMLIFrameElement>("#renderer")?.contentWindow;
    if (!renderer) throw new Error("renderer frame is unavailable");
    renderer.postMessage({
      source: "spatial-host",
      type: "set-spatial-runtime",
      collisionBoxes: [],
      navigationMesh: artifact.navMesh,
      obstacleBoxes: [],
      doorwayBoxes: [],
      navigationProfile: profile,
      navigationArtifact: artifact,
      collisionUrl: "/asset/home-scan-structural-v7.glb",
      defaultMovementMode: "walk",
    }, location.origin);
  }, {
    artifact: options.artifact,
    profile: {
      worldUnit: "metres",
      agentRadius: 0.18,
      agentHeight: 1.7,
      eyeHeight: 1.6,
      maxStepMetres: 0.1,
      maxSlopeDegrees: 45,
      maxSpeed: 1.6,
      maxAcceleration: 8,
    },
  });
  await expect(page.frameLocator("#renderer").locator("#sparkLoading")).toBeHidden({
    timeout: 20_000,
  });
}

async function captureCamera(page: import("@playwright/test").Page): Promise<CameraPose> {
  return page.evaluate(() => new Promise<CameraPose>((resolve, reject) => {
    const renderer = document.querySelector<HTMLIFrameElement>("#renderer")?.contentWindow;
    if (!renderer) return reject(new Error("renderer frame is unavailable"));
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => reject(new Error("camera capture timed out")), 5_000);
    const receive = (event: MessageEvent) => {
      if (event.data?.source !== "spatial-spark" || event.data?.type !== "camera" ||
        event.data?.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve(event.data.cameraPose as CameraPose);
    };
    window.addEventListener("message", receive);
    renderer.postMessage(
      { source: "spatial-host", type: "capture-camera", requestId },
      location.origin,
    );
  }));
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
