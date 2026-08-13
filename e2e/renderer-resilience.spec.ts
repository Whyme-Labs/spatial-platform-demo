import { expect, test } from "@playwright/test";
import { SpzWriter } from "@sparkjsdev/spark";

// A published renderer keeps running long after its iframe src was set: paged
// scenes stream tile fetches with an embedded token, and non-paged scenes
// download their whole asset up front. These tests pin the guards around that
// lifetime — a device-profile size ceiling enforced before the download starts,
// and the refresh-scene-tokens message that points future fetches at a renewed
// scene token without reloading the frame.

type HostMessage = { type: string; code?: string };

// Reported against the mobile OOM defect: a 338 MB PLY-derived SPZ.
const OVERSIZED_SCENE_BYTES = 354_334_801;

test("an oversized non-paged scene fails closed on a mobile profile", async ({ page }) => {
  await mountRendererHost(
    page,
    "/renderer/index.html?content=/asset/oversized-scene.spz&format=spz&profile=mobile-lite",
  );

  await expect
    .poll(async () => (await messagesOfType(page, "error")).length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  const errors = await messagesOfType(page, "error");
  expect(errors[0]?.code).toBe("SCENE_ASSET_TOO_LARGE");
  await expect(
    page.frameLocator("#renderer").getByText("The spatial scene could not be rendered.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(await messagesOfType(page, "ready")).toHaveLength(0);
});

test("the same declared size passes the generous desktop ceiling", async ({ page }) => {
  // No profile parameter: authoring hosts and older embeds keep the desktop
  // ceiling, and 338 MB sits under it.
  await mountRendererHost(
    page,
    "/renderer/index.html?content=/asset/oversized-scene.spz&format=spz",
  );

  await expect(page.frameLocator("#renderer").locator("#sparkLoading")).toBeHidden({
    timeout: 15_000,
  });
  expect(await messagesOfType(page, "error")).toHaveLength(0);
});

test("a refreshed scene token is ignored pre-ready, applied post-ready, and validated", async ({
  page,
}) => {
  await mountRendererHost(
    page,
    `/renderer/index.html?content=${
      encodeURIComponent("/asset/refresh-scene.spz?token=first-token")
    }&format=spz`,
  );
  await expect(page.frameLocator("#renderer").locator("#sparkLoading")).toBeHidden({
    timeout: 15_000,
  });

  // The visual is on screen but no movement runtime exists, so ready was never
  // posted: a refresh in this state must be ignored without an error.
  await sendTokenRefresh(page, "/asset/refresh-scene.spz?token=too-early-token");
  await page.waitForTimeout(500);
  expect(await appliedRefreshes(page)).toEqual([]);

  // An authoring host grant is the shortest path to a real ready.
  await page.evaluate(() => {
    const renderer = document.querySelector<HTMLIFrameElement>("#renderer")?.contentWindow;
    if (!renderer) throw new Error("renderer frame is unavailable");
    renderer.postMessage({
      source: "spatial-host",
      type: "set-authoring-plan",
      plan: null,
    }, location.origin);
  });
  await expect
    .poll(async () => (await messagesOfType(page, "ready")).length, { timeout: 15_000 })
    .toBeGreaterThan(0);

  await sendTokenRefresh(page, "/asset/refresh-scene.spz?token=renewed-token");
  await expect.poll(() => appliedRefreshes(page)).toEqual([
    `${new URL("/asset/refresh-scene.spz?token=renewed-token", "http://127.0.0.1:8791")}`,
  ]);

  // Untrusted or foreign URLs never repoint the stream: another origin, a
  // non-asset route, and a different asset path are all refused.
  await sendTokenRefresh(page, "https://evil.example/asset/refresh-scene.spz?token=stolen");
  await sendTokenRefresh(page, "/api/scene-sessions/renew?token=wrong-route");
  await sendTokenRefresh(page, "/asset/another-scene.spz?token=other-asset");
  await page.waitForTimeout(500);
  expect(await appliedRefreshes(page)).toHaveLength(1);
  expect(await messagesOfType(page, "error")).toHaveLength(0);
});

async function mountRendererHost(
  page: import("@playwright/test").Page,
  rendererSrc: string,
): Promise<void> {
  const scene = await minimalSpz();
  const serveScene = (route: import("@playwright/test").Route) => {
    // The size-gate preflight asks for a single byte; answering its Range
    // request with the declared oversized total exercises the gate without
    // shipping an oversized fixture. Every other read gets the real bytes.
    if (route.request().headers()["range"] === "bytes=0-0") {
      return route.fulfill({
        status: 206,
        contentType: "application/octet-stream",
        headers: { "Content-Range": `bytes 0-0/${OVERSIZED_SCENE_BYTES}` },
        body: Buffer.from(scene.slice(0, 1)),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: Buffer.from(scene),
    });
  };
  await page.route("**/asset/oversized-scene.spz", serveScene);
  await page.route("**/asset/refresh-scene.spz**", (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: Buffer.from(scene),
  }));
  await page.route("**/e2e/renderer-resilience-host.html", (route) => route.fulfill({
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
    </script><iframe id="renderer" title="Renderer resilience proof"
      src="${rendererSrc}"></iframe>`,
  }));
  await page.goto("/e2e/renderer-resilience-host.html");
  await expect(page.locator("#renderer")).toBeVisible();
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

async function sendTokenRefresh(
  page: import("@playwright/test").Page,
  contentUrl: string,
): Promise<void> {
  await page.evaluate((refreshedUrl) => {
    const renderer = document.querySelector<HTMLIFrameElement>("#renderer")?.contentWindow;
    if (!renderer) throw new Error("renderer frame is unavailable");
    renderer.postMessage({
      source: "spatial-host",
      type: "refresh-scene-tokens",
      contentUrl: refreshedUrl,
      collisionUrl: null,
      detourUrl: null,
      navMeshUrl: null,
    }, location.origin);
  }, contentUrl);
}

async function appliedRefreshes(
  page: import("@playwright/test").Page,
): Promise<string[]> {
  return page.evaluate(() => {
    const renderer = document.querySelector<HTMLIFrameElement>("#renderer")?.contentWindow;
    if (!renderer) throw new Error("renderer frame is unavailable");
    return (renderer as unknown as { __sceneTokenRefreshes?: string[] })
      .__sceneTokenRefreshes ?? [];
  });
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
