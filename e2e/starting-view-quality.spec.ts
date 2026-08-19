import { expect, test } from "@playwright/test";
import { SpzWriter } from "@sparkjsdev/spark";
// @ts-expect-error Plain ESM module has no separate declaration file.
import { buildAuthoredStructuralCollisionGlb } from "../scripts/authored-collision.mjs";
// @ts-expect-error Plain ESM module has no separate declaration file.
import { buildRecastNavigationArtifact, extractCollisionGeometryFromGlb } from "../scripts/navigation-build-core.mjs";
import {
  STARTING_VIEW_MAX_NEAR_BLACK_FRACTION,
  STARTING_VIEW_MIN_RENDERED_COVERAGE_FRACTION,
  STARTING_VIEW_MIN_SAMPLED_PIXELS,
  startingViewQualityViolations,
} from "../src/shared/starting-view-quality";

// A release shipped whose frozen visitor starting view was mechanically valid
// (pose on the walkable region) and visually terrible: it faced the black
// unreconstructed void around the capture. These tests pin the two repairs:
// the renderer measures the actual first frame a capture would freeze, and a
// walk spawn without an operator-captured view defaults to facing the
// walkable region's centroid instead of wherever the QA framing pointed.

type CameraReply = {
  cameraPose: {
    position: [number, number, number];
    target: [number, number, number];
    up: [number, number, number];
    fovDegrees: number;
  };
  frameQuality: {
    schemaVersion: string;
    capturedAt: string;
    frame: { width: number; height: number; sampledPixels: number };
    nearBlackFraction: number;
    meanLuminance: number;
    renderedCoverageFraction: number;
  } | null;
};

test("the renderer measures the first frame a capture would freeze", async ({ page }) => {
  await mountRenderer(page, {
    scene: await splatWall(),
    // Standing in front of the 2x2 splat wall at z=0, looking straight at it.
    cameraQuery: "camera=0,0,3&target=0,0,0",
  });
  // Spark uploads and sorts splats asynchronously after the first visible
  // frame; poll until the presented frame contains the wall.
  await expect.poll(async () =>
    (await captureCamera(page)).frameQuality?.renderedCoverageFraction ?? 0, {
    timeout: 15_000,
  }).toBeGreaterThan(STARTING_VIEW_MIN_RENDERED_COVERAGE_FRACTION);
  const facingContent = await captureCamera(page);
  expect(facingContent.frameQuality).not.toBeNull();
  const contentQuality = facingContent.frameQuality!;
  console.log("starting-view metrics facing content:", JSON.stringify(contentQuality));
  expect(contentQuality.frame.sampledPixels).toBeGreaterThanOrEqual(
    STARTING_VIEW_MIN_SAMPLED_PIXELS,
  );
  expect(contentQuality.renderedCoverageFraction).toBeGreaterThan(
    STARTING_VIEW_MIN_RENDERED_COVERAGE_FRACTION,
  );
  expect(contentQuality.nearBlackFraction).toBeLessThan(
    STARTING_VIEW_MAX_NEAR_BLACK_FRACTION,
  );
  expect(startingViewQualityViolations({
    ...contentQuality,
    schemaVersion: "starting-view-quality-v1",
  })).toEqual([]);
});

test("a view of the unreconstructed void measures as a gate violation", async ({ page }) => {
  await mountRenderer(page, {
    scene: await splatWall(),
    // Same position, turned 180 degrees: nothing but the void behind the wall.
    cameraQuery: "camera=0,0,3&target=0,0,50",
  });
  const facingVoid = await captureCamera(page);
  expect(facingVoid.frameQuality).not.toBeNull();
  const voidQuality = facingVoid.frameQuality!;
  console.log("starting-view metrics facing void:", JSON.stringify(voidQuality));
  expect(voidQuality.nearBlackFraction).toBeGreaterThan(
    STARTING_VIEW_MAX_NEAR_BLACK_FRACTION,
  );
  expect(voidQuality.renderedCoverageFraction).toBeLessThan(
    STARTING_VIEW_MIN_RENDERED_COVERAGE_FRACTION,
  );
  expect(startingViewQualityViolations({
    ...voidQuality,
    schemaVersion: "starting-view-quality-v1",
  })).toHaveLength(2);
});

test("a walk release without a captured starting view opens facing the walkable centroid", async ({
  page,
}) => {
  // No camera query: the spawn heading would otherwise be whatever the
  // automatic framing pointed at. The 8x4 room's walkable centroid sits near
  // (4, 0, 2); the framed default looks back toward the tiny splat cluster at
  // the origin, well over the keep-authored threshold away from the centroid.
  const fixture = await buildWalkFixture();
  await mountRenderer(page, { scene: fixture.scene, cameraQuery: null });
  await sendRuntime(page, fixture);
  await expect(page.frameLocator("#renderer").locator("#controlStatus")).toHaveText(
    "Walk enabled · structural shell collision · furniture ignored",
    { timeout: 15_000 },
  );

  const opened = await captureCamera(page);
  const { position, target, up } = opened.cameraPose;
  // Standing: eye height on the walkable floor, world-vertical up, level gaze.
  expect(position[1]).toBeGreaterThan(1.4);
  expect(position[1]).toBeLessThan(1.8);
  expect(up[0]).toBeCloseTo(0, 5);
  expect(up[1]).toBeCloseTo(1, 5);
  expect(up[2]).toBeCloseTo(0, 5);
  const direction = [
    target[0] - position[0],
    target[1] - position[1],
    target[2] - position[2],
  ];
  const length = Math.hypot(...direction);
  expect(Math.abs(direction[1]! / length)).toBeLessThan(0.01);
  // Facing the centroid of the walkable region from wherever the runtime
  // placed the body.
  const bearing = [4 - position[0], 2 - position[2]];
  const bearingLength = Math.hypot(...bearing);
  const alignment =
    (direction[0]! * bearing[0]! + direction[2]! * bearing[1]!) /
    (length * bearingLength);
  expect(alignment).toBeGreaterThan(0.99);
});

async function mountRenderer(
  page: import("@playwright/test").Page,
  options: { scene: Uint8Array; cameraQuery: string | null },
): Promise<void> {
  await page.route("**/asset/test-scene.spz", (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: Buffer.from(options.scene),
  }));
  await page.route("**/asset/fixture-starting-view.glb", (route) => route.fulfill({
    status: 200,
    contentType: "model/gltf-binary",
    body: Buffer.from(startingViewCollision),
  }));
  const query = options.cameraQuery ? `&${options.cameraQuery}` : "";
  await page.route("**/e2e/starting-view-host.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      #renderer { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
    </style><iframe id="renderer" title="Starting-view quality proof"
      src="/renderer/index.html?content=/asset/test-scene.spz&format=spz${query}"></iframe>`,
  }));
  await page.goto("/e2e/starting-view-host.html");
  await expect(page.frameLocator("#renderer").locator("#sparkLoading")).toBeHidden({
    timeout: 15_000,
  });
}

let startingViewCollision: Uint8Array = new Uint8Array();

async function buildWalkFixture(): Promise<{
  scene: Uint8Array;
  navigationArtifact: Record<string, unknown> & { navMesh: unknown };
}> {
  startingViewCollision = buildAuthoredStructuralCollisionGlb({
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
    dynamicBarrierBoxes: [],
    furnitureBoxes: [],
  });
  const geometry = await extractCollisionGeometryFromGlb(startingViewCollision);
  const navigationArtifact = await buildRecastNavigationArtifact({
    positions: geometry.positions,
    indices: geometry.indices,
    collisionSemantics: geometry.collisionSemantics,
    dynamicBarriers: geometry.dynamicBarriers,
    structuralGeometry: geometry.structuralGeometry,
    source: {
      assetId: "fixture-starting-view",
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
  return { scene: await minimalSpz(), navigationArtifact };
}

async function sendRuntime(
  page: import("@playwright/test").Page,
  fixture: Awaited<ReturnType<typeof buildWalkFixture>>,
): Promise<void> {
  await page.evaluate((artifact) => {
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
      collisionUrl: "/asset/fixture-starting-view.glb",
      defaultMovementMode: "walk",
    }, location.origin);
  }, fixture.navigationArtifact);
}

async function captureCamera(page: import("@playwright/test").Page): Promise<CameraReply> {
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
      resolve({
        cameraPose: event.data.cameraPose,
        frameQuality: event.data.frameQuality ?? null,
      });
    };
    window.addEventListener("message", receive);
    renderer.postMessage(
      { source: "spatial-host", type: "capture-camera", requestId },
      location.origin,
    );
  })) as Promise<CameraReply>;
}

// A 2x2 metre wall of overlapping mid-grey splats at z=0: dense enough that a
// camera facing it from two metres away fills well over the coverage floor,
// while the view behind it is pure clear-colour void.
async function splatWall(): Promise<Uint8Array> {
  const columns = 9;
  const rows = 9;
  const writer = new SpzWriter({
    numSplats: columns * rows,
    shDegree: 0,
    flagAntiAlias: false,
  });
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      // Centred on the origin so any SPZ axis-sign convention keeps the wall
      // in front of a camera on the z axis. setScale takes LINEAR scale.
      writer.setCenter(index, column * 0.25 - 1, row * 0.25 - 1, 0);
      writer.setAlpha(index, 1);
      writer.setRgb(index, 0.7, 0.7, 0.7);
      writer.setScale(index, 0.25, 0.25, 0.25);
      writer.setQuat(index, 0, 0, 0, 1);
    }
  }
  return writer.finalize();
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
