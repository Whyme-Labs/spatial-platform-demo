import { expect, test } from "@playwright/test";
import { SpzWriter } from "@sparkjsdev/spark";
// The production builder is intentionally plain ESM so the Node processor and
// browser acceptance fixture exercise the exact same Detour serialization.
// @ts-expect-error Plain ESM test fixture module has no separate declaration file.
import { buildRecastNavigationArtifact } from "../scripts/navigation-build-core.mjs";

test("initialises the frozen Detour mesh and Rapier collision proxy before enabling walking", async ({
  page,
}) => {
  const positions: number[] = [];
  const indices: number[] = [];
  appendFloor(positions, indices, 0, 0, 4, 4);
  appendFloor(positions, indices, 4, 1.4, 5.5, 2.6);
  appendFloor(positions, indices, 5.5, 0, 9.5, 4);
  const artifact = await buildRecastNavigationArtifact({
    positions,
    indices,
    source: {
      assetId: "fixture-collision",
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
    destinations: [{ id: "far-room", position: [8.5, 0, 2] }],
  });
  const collision = collisionGlb(positions, indices);
  const scene = await minimalSpz();
  await page.route("**/asset/fixture-collision.glb", (route) => route.fulfill({
    status: 200,
    contentType: "model/gltf-binary",
    body: Buffer.from(collision),
  }));
  await page.route("**/asset/test-scene.spz", (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: Buffer.from(scene),
  }));
  await page.route("**/e2e/navigation-host.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      #renderer { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
    </style><iframe id="renderer" title="Walking runtime"
      src="/renderer/index.html?content=/asset/test-scene.spz&format=spz"></iframe>`,
  }));
  await page.goto("/e2e/navigation-host.html");
  await expect(page.locator("#renderer")).toBeVisible();
  await expect(page.frameLocator("#renderer").locator("#sparkLoading")).toBeHidden({
    timeout: 15_000,
  });

  await page.evaluate(({ navigationArtifact }) => {
    const renderer = document.querySelector<HTMLIFrameElement>("#renderer")?.contentWindow;
    if (!renderer) throw new Error("renderer frame is unavailable");
    renderer.postMessage({
        source: "spatial-host",
        type: "set-spatial-runtime",
        collisionBoxes: [],
        navigationMesh: navigationArtifact.navMesh,
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
        navigationArtifact,
        collisionUrl: "/asset/fixture-collision.glb",
      }, location.origin);
  }, { navigationArtifact: artifact });

  const renderer = page.frameLocator("#renderer");
  await expect(renderer.locator("#controlStatus")).toHaveText(
    "Walking enabled · Detour + capsule collision verified",
    { timeout: 15_000 },
  );
  await expect(renderer.locator("#controlStatus")).toHaveAttribute("data-tone", "ready");

  const placed = await setCamera(page, {
    position: [1, 1.6, 2],
    target: [8.5, 1.6, 2],
    up: [0, 1, 0],
    fovDegrees: 58,
  });
  expect(placed.accepted).toBe(true);
  const before = await captureCamera(page);
  await renderer.locator("#sparkCanvas").focus();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(4_500);
  await page.keyboard.up("ArrowUp");
  const after = await captureCamera(page);
  expect(after.position[0]).toBeGreaterThan(5.5);
  expect(after.position[0] - before.position[0]).toBeGreaterThan(4);
});

function appendFloor(
  positions: number[],
  indices: number[],
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): void {
  const offset = positions.length / 3;
  positions.push(minX, 0, minZ, minX, 0, maxZ, maxX, 0, maxZ, maxX, 0, minZ);
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}

type CameraPose = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovDegrees: number;
};

async function setCamera(
  page: import("@playwright/test").Page,
  cameraPose: CameraPose,
): Promise<{ accepted: boolean; cameraPose: CameraPose }> {
  return page.evaluate((pose) => new Promise((resolve, reject) => {
    const renderer = document.querySelector<HTMLIFrameElement>("#renderer")?.contentWindow;
    if (!renderer) return reject(new Error("renderer frame is unavailable"));
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => reject(new Error("camera-set timed out")), 5_000);
    const receive = (event: MessageEvent) => {
      if (event.data?.source !== "spatial-spark" || event.data?.type !== "camera-set" ||
        event.data?.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve({ accepted: Boolean(event.data.accepted), cameraPose: event.data.cameraPose });
    };
    window.addEventListener("message", receive);
    renderer.postMessage(
      { source: "spatial-host", type: "set-camera", requestId, cameraPose: pose },
      location.origin,
    );
  }), cameraPose) as Promise<{ accepted: boolean; cameraPose: CameraPose }>;
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

async function minimalSpz(): Promise<Uint8Array> {
  const writer = new SpzWriter({
    numSplats: 4,
    shDegree: 0,
    flagAntiAlias: false,
  });
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

function collisionGlb(positions: number[], indices: number[]): Uint8Array {
  const positionBytes = new Uint8Array(new Float32Array(positions).buffer);
  const indexBytes = new Uint8Array(new Uint32Array(indices).buffer);
  const binary = new Uint8Array(positionBytes.byteLength + indexBytes.byteLength);
  binary.set(positionBytes, 0);
  binary.set(indexBytes, positionBytes.byteLength);
  const xs = positions.filter((_, index) => index % 3 === 0);
  const ys = positions.filter((_, index) => index % 3 === 1);
  const zs = positions.filter((_, index) => index % 3 === 2);
  const document = {
    asset: { version: "2.0", generator: "Spatial Studio navigation E2E" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: positions.length / 3,
      type: "VEC3",
      min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    }, {
      bufferView: 1,
      componentType: 5125,
      count: indices.length,
      type: "SCALAR",
      min: [Math.min(...indices)],
      max: [Math.max(...indices)],
    }],
    bufferViews: [{
      buffer: 0,
      byteOffset: 0,
      byteLength: positionBytes.byteLength,
      target: 34962,
    }, {
      buffer: 0,
      byteOffset: positionBytes.byteLength,
      byteLength: indexBytes.byteLength,
      target: 34963,
    }],
    buffers: [{ byteLength: binary.byteLength }],
  };
  const encodedJson = new TextEncoder().encode(JSON.stringify(document));
  const paddedJsonLength = Math.ceil(encodedJson.byteLength / 4) * 4;
  const paddedBinaryLength = Math.ceil(binary.byteLength / 4) * 4;
  const output = new Uint8Array(12 + 8 + paddedJsonLength + 8 + paddedBinaryLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + paddedJsonLength);
  output.set(encodedJson, 20);
  const binaryHeader = 20 + paddedJsonLength;
  view.setUint32(binaryHeader, paddedBinaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}
