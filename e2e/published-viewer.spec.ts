import { expect, test, type Page, type Route } from "@playwright/test";
import { PROVISIONAL_MEASUREMENT_DISCLAIMER } from "../src/shared/world-units";
import {
  expectReviewedScreenshot,
  RESPONSIVE_VISUAL_VIEWPORTS,
} from "./helpers/visual-matrix";

const maximumViewerTitle = (
  "Museum conservation release with reviewed navigation and publication evidence "
    .repeat(3)
    .slice(0, 120)
);

test("published viewer hands startup progress to the embedded Spark loader", async ({ page }) => {
  const telemetry: Array<Record<string, unknown>> = [];
  let telemetrySessionIssueCount = 0;
  let simulatedCredentialExpiry = false;
  let simulateActivationChange = false;
  let activationTokenRejected = false;
  await page.addInitScript(() => {
    const originalSetTimeout = window.setTimeout.bind(window);
    const scheduledTimeouts: number[] = [];
    Object.defineProperty(window, "__scheduledTimeouts", {
      configurable: false,
      value: scheduledTimeouts,
    });
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      scheduledTimeouts.push(Number(timeout ?? 0));
      return originalSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout;
  });
  await page.route("**/api/releases/loading-handoff/manifest", (route) => json(route, {
    schemaVersion: "1",
    release: {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "loading-handoff",
      publishedAt: "2026-07-29T08:00:00.000Z",
      expiresAt: null,
      accessPolicy: "public",
    },
    project: {
      id: "22222222-2222-4222-8222-222222222222",
      versionId: "33333333-3333-4333-8333-333333333333",
      name: "Loading handoff fixture",
      captureAdapter: "test",
      provenance: {},
    },
    scene: {
      format: "rad",
      contentUrl: "/test-scene.rad",
      posterUrl: null,
      sizeBytes: 1,
      etag: null,
    },
    viewer: {
      title: "Loading handoff fixture",
      measurementDisclaimer: PROVISIONAL_MEASUREMENT_DISCLAIMER,
      splatBudgetMillions: 2,
      sourceToWorld: {
        sourceUpAxis: "Z",
        worldUnit: "scene_units",
        metresPerSourceUnit: 1,
        yawDegrees: 0,
        translationMetres: [0, 0, 0],
      },
    },
    spatial: {
      entities: [{
        id: "77777777-7777-4777-8777-777777777777",
        parent_id: null,
        kind: "floor",
        label: "Walk zone",
        position_json: null,
        geometry_json: JSON.stringify({
          type: "polygon",
          points: [[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]],
        }),
      }, {
        id: "99999999-9999-4999-8999-999999999991",
        parent_id: null,
        kind: "floor",
        label: "Walk zone 2 — far room",
        position_json: null,
        geometry_json: JSON.stringify({
          type: "polygon",
          points: [[0, 0, 10], [2, 0, 10], [2, 0, 12], [0, 0, 12]],
        }),
      }, {
        id: "99999999-9999-4999-8999-999999999992",
        parent_id: null,
        kind: "floor",
        label: "Walk zone 3 — side room",
        position_json: null,
        geometry_json: JSON.stringify({
          type: "polygon",
          points: [[-4, 0, 0], [-2, 0, 0], [-2, 0, 2], [-4, 0, 2]],
        }),
      }, {
        id: "99999999-9999-4999-8999-999999999993",
        parent_id: null,
        kind: "floor",
        label: "Walk zone 4 — side room",
        position_json: null,
        geometry_json: JSON.stringify({
          type: "polygon",
          points: [[-8, 0, 0], [-6, 0, 0], [-6, 0, 2], [-8, 0, 2]],
        }),
      }, {
        id: "88888888-8888-4888-8888-888888888888",
        parent_id: null,
        kind: "doorway",
        label: "Main-to-far corridor",
        position_json: null,
        geometry_json: JSON.stringify({
          type: "polygon",
          points: [[0.8, 0, 3.5], [1.2, 0, 3.5], [1.2, 0, 10.5], [0.8, 0, 10.5]],
        }),
      }],
      routes: [],
      routeStops: [],
      collisionProxy: {
        version: "box-union-v1",
        boxes: [
          { entityId: "room", label: "Room", min: [0, 0, 0], max: [4, 3, 4] },
          {
            entityId: "88888888-8888-4888-8888-888888888888",
            label: "Doorway",
            min: [1.5, 0, 3.5],
            max: [2.5, 2.4, 4.5],
          },
        ],
      },
      navigationMesh: {
        version: "authored-polygon-triangles-v2",
        vertices: [[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]],
        indices: [0, 1, 2, 0, 2, 3],
        sourceEntityIds: ["room"],
      },
      obstacleProxy: {
        version: "authored-obstacle-boxes-v1",
        boxes: [{ entityId: "table", label: "Table", min: [1, 0, 1], max: [2, 1, 2] }],
      },
      navigationProfile: {
        worldUnit: "scene_units",
        agentRadius: 0.22,
        agentHeight: 1.8,
        eyeHeight: 1.6,
        maxStepMetres: 0.1,
      },
      navigationArtifact: {
        schemaVersion: "spatial-navigation-v7",
        dynamicBarriers: [{
          id: "door-main-west",
          min: [-0.15, 0.15, -3.9],
          max: [0.8, 3, -3.78],
          defaultActive: false,
        }],
      },
    },
  }));
  await page.route("**/api/releases/loading-handoff/telemetry-session", async (route) => {
    telemetrySessionIssueCount += 1;
    const request = route.request().postDataJSON() as {
      releaseId: string;
      sessionId?: string;
    };
    expect(request.releaseId).toBe("11111111-1111-4111-8111-111111111111");
    if (telemetrySessionIssueCount === 1) {
      expect(request.sessionId).toBeUndefined();
    } else {
      if (telemetrySessionIssueCount === 2 || telemetrySessionIssueCount === 3) {
        expect(request.sessionId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      } else {
        expect(request.sessionId).toBeUndefined();
      }
    }
    if (telemetrySessionIssueCount === 3) {
      await route.fulfill({
        status: 410,
        contentType: "application/json",
        body: '{"error":"activation retired"}',
      });
      return;
    }
    const currentActivation = telemetrySessionIssueCount >= 4;
    await json(route, {
      sessionId: currentActivation
        ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      token: currentActivation
        ? "new-activation-telemetry-token"
        : telemetrySessionIssueCount === 1
          ? "signed-telemetry-token"
          : "renewed-telemetry-token",
      expiresAtEpochSeconds: Number.MAX_SAFE_INTEGER,
    });
  });
  await page.route("**/api/telemetry", async (route) => {
    const event = route.request().postDataJSON() as Record<string, unknown>;
    if (event.eventType !== "navigation_traversal") {
      expect(route.request().headers().authorization).toBeUndefined();
      telemetry.push(event);
      await route.fulfill({ status: 204 });
      return;
    }
    if (!simulatedCredentialExpiry) {
      simulatedCredentialExpiry = true;
      expect(route.request().headers().authorization).toBe("Bearer signed-telemetry-token");
      await route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"expired"}' });
      return;
    }
    if (simulateActivationChange && !activationTokenRejected) {
      activationTokenRejected = true;
      expect(route.request().headers().authorization).toBe("Bearer renewed-telemetry-token");
      await route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"retired"}' });
      return;
    }
    expect(route.request().headers().authorization).toBe(
      simulateActivationChange
        ? "Bearer new-activation-telemetry-token"
        : "Bearer renewed-telemetry-token",
    );
    telemetry.push(event);
    await route.fulfill({ status: 204 });
  });
  await page.route("**/renderer/index.html?*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html>
      <html>
        <head>
          <style>
            body { margin: 0; }
            #quality-status {
              position: fixed;
              left: 12px;
              bottom: 12px;
              padding: 10px 16px;
              border: 1px solid #39403e;
              border-radius: 999px;
              background: #101514;
              color: white;
              font: 14px sans-serif;
              pointer-events: none;
            }
            @media (max-width: 640px) {
              #quality-status {
                top: 14px;
                bottom: auto;
              }
            }
            #control-help {
              position: fixed;
              right: 14px;
              bottom: 114px;
              width: 360px;
              min-height: 138px;
              padding: 16px;
              border: 1px solid #39403e;
              border-radius: 14px;
              background: #101514;
              color: white;
              font: 14px/1.5 sans-serif;
            }
            #control-help[hidden] { display: none; }
            @media (max-width: 640px) {
              #control-help {
                right: 14px;
                bottom: 70px;
                left: 14px;
                width: auto;
                min-height: 160px;
              }
            }
          </style>
        </head>
        <body>
          <div role="status">Loading spatial scene</div>
          <div id="quality-status">Spark 2.1 · 2M splat budget</div>
          <button id="toggle-controls" onclick="
            const help = document.getElementById('control-help');
            help.hidden = !help.hidden;
            parent.postMessage({
              source: 'spatial-spark',
              type: 'control-help',
              visible: !help.hidden,
              height: help.hidden ? 0 : help.getBoundingClientRect().height
            }, location.origin);
          ">Controls</button>
          <div id="control-help" hidden>
            <strong>Explore the scene</strong>
            <p>Drag to look · scroll or two-finger swipe to travel</p>
            <p>Desktop: WASD or arrow keys to move · Shift for speed</p>
          </div>
          <button id="renderer-ready" onclick="parent.postMessage({
            source: 'spatial-spark',
            type: 'ready',
            runtime: 'spark',
            version: '2.1.0',
            timeToFirstFrameMs: 1200,
            format: 'rad',
            splatBudget: 2000000
          }, location.origin)">Renderer ready</button>
          <script>
            window.addEventListener("message", (event) => {
              if (event.data?.type === "set-spatial-runtime") {
                window.runtimeMessage = event.data;
              }
              if (event.data?.type === "movement-key") {
                window.movementMessages = [
                  ...(window.movementMessages ?? []),
                  event.data
                ];
              }
              if (event.data?.type === "set-dynamic-barrier-state") {
                window.dynamicBarrierMessages = [
                  ...(window.dynamicBarrierMessages ?? []),
                  event.data
                ];
                parent.postMessage({
                  source: "spatial-spark",
                  type: "dynamic-barrier-state",
                  requestId: event.data.requestId,
                  barrierId: event.data.barrierId,
                  active: event.data.active,
                  accepted: true,
                  message: event.data.barrierId + " is now " + (event.data.active ? "closed" : "open"),
                }, location.origin);
              }
              if (event.data?.type === "set-outer-overlay-mode") {
                window.outerOverlayModes = [
                  ...(window.outerOverlayModes ?? []),
                  event.data.mode
                ];
              }
            });
            setTimeout(() => {
              parent.postMessage({
                source: "spatial-spark",
                type: "progress",
                progress: 42,
                detail: "Streaming scene detail"
              }, location.origin);
            }, 1000);
          </script>
        </body>
      </html>`,
  }));

  await page.goto("/review/loading-handoff", { waitUntil: "commit" });
  await expect.poll(() => page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith("spatial.traversal-run."))
  )).toEqual([]);

  const parentLoader = page.locator("#loadingOverlay");
  const releaseInfo = page.locator("#releaseInfo");
  const viewerHud = page.locator("#viewerHud");
  const rendererFrame = page.locator("#rendererFrame");
  await expect(rendererFrame).toHaveAttribute("allowfullscreen", "");
  // Pointer lock is gated by iframe sandboxing rather than permissions policy,
  // so the embedded renderer keeps mouse-look only while this frame stays
  // unsandboxed; a sandbox attribute would need allow-pointer-lock.
  await expect(rendererFrame).not.toHaveAttribute("sandbox", /.*/);
  await expect(parentLoader).toBeVisible();
  await expect(viewerHud).toBeHidden();
  await expect(releaseInfo).toBeHidden();
  await expect(rendererFrame).toHaveClass(/is-loading/);
  await expect(rendererFrame).toHaveCSS("opacity", "0");
  await expect(parentLoader).toHaveCSS("background-color", "rgb(9, 11, 10)");
  await expect(page.frameLocator("#rendererFrame").getByRole("status")).toBeVisible();
  await expect(parentLoader).toBeVisible();
  await expect(page.locator("#loadingDetail")).toHaveText("Streaming scene detail");
  await expect(page.locator("#progressBar")).toHaveJSProperty("style.width", "42%");
  await expect(releaseInfo).toBeHidden();
  await expect.poll(() => page.evaluate(() => (
    (window as typeof window & { __scheduledTimeouts: number[] }).__scheduledTimeouts
  ).filter((timeout) => timeout >= 60_000))).toEqual([]);

  await page.frameLocator("#rendererFrame").locator("body").evaluate(() => {
    parent.postMessage({
      source: "spatial-spark",
      type: "error",
      code: "TEST_LATE_READY",
      message: "The first-frame watchdog fired before the renderer completed.",
    }, location.origin);
  });
  await expect(page.locator("#errorPanel")).toBeVisible();
  await expect(rendererFrame).toBeHidden();

  await page.frameLocator("#rendererFrame").locator("body").evaluate(() => {
    parent.postMessage({
      source: "spatial-spark",
      type: "ready",
      runtime: "spark",
      version: "2.1.0",
      timeToFirstFrameMs: 1200,
      format: "rad",
      splatBudget: 2_000_000,
    }, location.origin);
    parent.postMessage({
      source: "spatial-spark",
      type: "control-mode",
      mode: "free-roam",
    }, location.origin);
  });
  await expect(page.locator("#errorPanel")).toBeHidden();
  await expect(rendererFrame).toBeVisible();
  await expect(rendererFrame).not.toHaveClass(/is-loading/);
  await expect(rendererFrame).toHaveCSS("opacity", "1");
  await expect(parentLoader).toBeHidden();
  await expect(viewerHud).toBeVisible();
  await expect(releaseInfo).toBeVisible();
  await expect(page.locator(".performance-chip")).toHaveCount(0);
  await expect(page.locator("#rendererStatus")).toHaveText("Scene ready");
  await page.frameLocator("#rendererFrame").locator("body").evaluate(() => {
    for (const phase of ["started", "completed"]) {
      parent.postMessage({
        source: "spatial-spark",
        type: "authored-traversal-state",
        connectionId: "east-lift",
        traversalKind: "elevator",
        label: "East lift",
        phase,
        qualification: {
          adapter: "xgrids-lcc",
          manifestSha256: "b".repeat(64),
          reviewGeneration: 3,
          registrationSha256: "c".repeat(64),
        },
      }, location.origin);
    }
  });
  await expect.poll(() => telemetry.filter((event) =>
    event.eventType === "navigation_traversal"
  )).toEqual([
    expect.objectContaining({
      eventType: "navigation_traversal",
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      metadata: {
        connectionId: "east-lift",
        phase: "started",
      },
    }),
    expect.objectContaining({
      eventType: "navigation_traversal",
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      metadata: {
        connectionId: "east-lift",
        phase: "completed",
      },
    }),
  ]);
  expect(telemetrySessionIssueCount).toBe(2);
  await rendererFrame.evaluate((element) => {
    element.dispatchEvent(new Event("load"));
  });
  await expect(page.locator("#rendererStatus")).toHaveText("Scene ready");
  await expect(page.locator("#releaseInfoDetails")).toBeHidden();
  await expect(page.locator("#toggleReleaseInfo")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#scaleStatus")).toHaveText(
    "Provisional scene units (SU)",
  );
  const exploreRooms = page.locator("#openNavigator");
  const qualityStatus = page.frameLocator("#rendererFrame").locator("#quality-status");
  await expect(exploreRooms).toBeVisible();
  await expect(qualityStatus).toBeVisible();
  await expect(page.locator("#viewerHud")).toContainText("Loading handoff fixture");
  await expect.poll(() => page.locator("#viewerHud").evaluate((hud) =>
    document.getElementById("releaseInfo")?.parentElement === hud &&
    ["spatialNavigator", "openNavigator"].every((id) =>
      document.getElementById(id)?.parentElement?.id === "releaseInfo"
    )
  )).toBe(true);
  await expect(page.locator("#viewerHud .glass-panel")).toHaveCount(1);

  const controlsHelp = page.frameLocator("#rendererFrame").locator("#control-help");
  const controlsButton = page.frameLocator("#rendererFrame").getByRole("button", {
    name: "Controls",
  });
  const toggleControls = () => controlsButton.evaluate((button: HTMLButtonElement) => {
    // The fixture button has no renderer chrome positioning; invoke it in-frame
    // so this test isolates the host/renderer message and layout contract.
    button.click();
  });
  const expectHudAndHelpSeparated = async (): Promise<void> => {
    await expect.poll(async () => {
      const [hudBox, helpBox] = await Promise.all([
        viewerHud.boundingBox(),
        controlsHelp.boundingBox(),
      ]);
      return hudBox !== null && helpBox !== null && rectanglesOverlap(hudBox, helpBox);
    }).toBe(false);
  };

  await page.locator("#toggleReleaseInfo").click();
  await expect(page.locator("#toggleReleaseInfo")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#releaseInfoDetails")).toBeVisible();
  await expect(page.locator("#spatialNavigator")).toBeHidden();
  await expect(exploreRooms).toHaveAttribute("aria-expanded", "false");
  await toggleControls();
  await expect(controlsHelp).toBeVisible();
  await expect(viewerHud).toBeHidden();
  await expect(page.locator("#releaseInfoDetails")).toBeHidden();
  await expect(page.locator("#toggleReleaseInfo")).toHaveAttribute("aria-expanded", "false");
  await expectHudAndHelpSeparated();
  await toggleControls();
  await expect(controlsHelp).toBeHidden();
  await expect(viewerHud).toBeVisible();

  await exploreRooms.click();
  await expect(page.locator("#toggleReleaseInfo")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#releaseInfoDetails")).toBeHidden();
  await expect(page.locator("#spatialNavigator")).toBeVisible();
  await expect(page.locator("#floorPlanSection")).toBeVisible();
  await expect(page.locator(".floor-plan-room-target")).toHaveCount(4);
  await expect(page.locator(".floor-plan-connector")).toHaveCount(1);
  await expect(page.locator(".floor-plan-label")).toHaveText(["1", "2", "3", "4"]);
  await expect(page.locator("#roomDirectory").getByRole("button", {
    name: "1. Walk zone",
  }))
    .toBeVisible();
  await expect(page.locator("#dynamicBarrierSection")).toBeVisible();
  await expect(page.locator("#dynamicBarrierList")).toContainText("Open · route available");
  const closeDoor = page.getByRole("button", { name: "Close Main West" });
  await closeDoor.click();
  await expect(page.locator("#dynamicBarrierList")).toContainText("Closed · route blocked");
  await expect(page.getByRole("button", { name: "Open Main West" })).toBeVisible();
  await expect.poll(() => page.frameLocator("#rendererFrame").locator("html").evaluate(
    () => Reflect.get(window, "dynamicBarrierMessages") ?? [],
  )).toEqual([expect.objectContaining({
    source: "spatial-host",
    type: "set-dynamic-barrier-state",
    barrierId: "door-main-west",
    active: true,
  })]);
  await expect.poll(async () => {
    const [hudBox, viewportBox] = await Promise.all([
      viewerHud.boundingBox(),
      page.locator("#viewport").boundingBox(),
    ]);
    return hudBox !== null && viewportBox !== null &&
      hudBox.y >= viewportBox.y &&
      hudBox.y + hudBox.height <= viewportBox.y + viewportBox.height;
  }).toBe(true);
  await expect(exploreRooms).toBeVisible();
  await expect(exploreRooms).toHaveAttribute("aria-expanded", "true");
  await toggleControls();
  await expect(controlsHelp).toBeVisible();
  await expect(viewerHud).toBeHidden();
  await expect(page.locator("#spatialNavigator")).toBeHidden();
  await expect(exploreRooms).toHaveAttribute("aria-expanded", "false");
  await expectHudAndHelpSeparated();
  await toggleControls();
  await expect(controlsHelp).toBeHidden();
  await expect(viewerHud).toBeVisible();

  await exploreRooms.click();
  await expect(page.locator("#spatialNavigator")).toBeVisible();
  await page.locator("#closeNavigator").click();
  await expect(page.locator("#spatialNavigator")).toBeHidden();
  await expect(exploreRooms).toBeVisible();
  await expect(exploreRooms).toHaveAttribute("aria-expanded", "false");

  await toggleControls();
  await expect(controlsHelp).toBeVisible();
  await expectHudAndHelpSeparated();
  await page.setViewportSize({ width: 700, height: 760 });
  await expect(viewerHud).toBeHidden();
  await toggleControls();
  await expect(controlsHelp).toBeHidden();
  await expect(viewerHud).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await toggleControls();
  await expect(controlsHelp).toBeVisible();
  await expect(viewerHud).toBeHidden();
  await toggleControls();
  await expect(controlsHelp).toBeHidden();
  await expect(viewerHud).toBeVisible();

  await expect(exploreRooms).toBeVisible();
  await expect(qualityStatus).toBeVisible();
  await expect.poll(() => page.frameLocator("#rendererFrame").locator("html").evaluate(
    () => Reflect.get(window, "runtimeMessage"),
  )).toMatchObject({
    type: "set-spatial-runtime",
    navigationMesh: {
      indices: [0, 1, 2, 0, 2, 3],
      sourceEntityIds: ["room"],
    },
    obstacleBoxes: [{
      entityId: "table",
      min: [1, 0, 1],
      max: [2, 1, 2],
    }],
    doorwayBoxes: [{
      entityId: "88888888-8888-4888-8888-888888888888",
      min: [1.5, 0, 3.5],
      max: [2.5, 2.4, 4.5],
    }],
    navigationProfile: {
      worldUnit: "scene_units",
      agentRadius: 0.22,
      agentHeight: 1.8,
      eyeHeight: 1.6,
      maxStepMetres: 0.1,
    },
  });

  await page.locator("#toggleReleaseInfo").focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => page.frameLocator("#rendererFrame").locator("html").evaluate(
    () => Reflect.get(window, "movementMessages") ?? [],
  )).toEqual([]);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => page.frameLocator("#rendererFrame").locator("html").evaluate(
    () => Reflect.get(window, "movementMessages") ?? [],
  )).toEqual([
    {
      source: "spatial-host",
      type: "movement-key",
      code: "ArrowUp",
      pressed: true,
    },
    {
      source: "spatial-host",
      type: "movement-key",
      code: "ArrowUp",
      pressed: false,
    },
  ]);

  const viewport = page.locator("#viewport");
  await expect(viewport).toHaveClass(/mobile-free-roam-active/);
  await expect(exploreRooms).toBeVisible();

  for (const viewportSize of [
    { width: 700, height: 760 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewportSize);
    await expect(exploreRooms).toBeVisible();
    await expect(qualityStatus).toBeVisible();
  }

  for (const viewportSize of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewportSize);
    await page.frameLocator("#rendererFrame").locator("body").evaluate(() => {
      const width = innerWidth;
      const height = innerHeight;
      const compact = width <= 640;
      parent.postMessage({
        source: "spatial-spark",
        type: "overlay-layout",
        viewport: { width, height },
        zones: {
          toolbar: compact
            ? { left: width - 244, right: width - 10, top: 10, bottom: 62 }
            : { left: width - 244, right: width - 10, top: height - 62, bottom: height - 10 },
          status: compact
            ? { left: width - 244, right: width - 10, top: 70, bottom: 100 }
            : { left: width - 244, right: width - 10, top: height - 100, bottom: height - 70 },
          help: null,
          movement: null,
          altitude: null,
        },
      }, location.origin);
    });
    await expect(exploreRooms).toBeVisible();
    const layout = await page.locator("#viewport").evaluate((root) => {
      const release = root.querySelector<HTMLElement>("#releaseInfo");
      const review = root.querySelector<HTMLElement>("#reviewPanel");
      if (!release || !review) return null;
      const releaseBounds = release.getBoundingClientRect();
      const reviewBounds = review.getBoundingClientRect();
      const rootBounds = root.getBoundingClientRect();
      const overlaps = releaseBounds.left < reviewBounds.right && releaseBounds.right > reviewBounds.left &&
        releaseBounds.top < reviewBounds.bottom && releaseBounds.bottom > reviewBounds.top;
      return {
        overlaps,
        releaseContained: releaseBounds.left >= rootBounds.left - 1 &&
          releaseBounds.right <= rootBounds.right + 1 &&
          releaseBounds.top >= rootBounds.top - 1 &&
          releaseBounds.bottom <= rootBounds.bottom + 1,
        reviewContained: reviewBounds.left >= rootBounds.left - 1 &&
          reviewBounds.right <= rootBounds.right + 1 &&
          reviewBounds.top >= rootBounds.top - 1 &&
          reviewBounds.bottom <= rootBounds.bottom + 1,
      };
    });
    expect(layout, `${viewportSize.width}x${viewportSize.height}`).toEqual({
      overlaps: false,
      releaseContained: true,
      reviewContained: true,
    });
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator("#viewport").evaluate((root) => {
    (root as HTMLElement).style.setProperty("--viewer-safe-top", "32px");
    (root as HTMLElement).style.setProperty("--viewer-safe-right", "24px");
    (root as HTMLElement).style.setProperty("--viewer-safe-bottom", "18px");
    (root as HTMLElement).style.setProperty("--viewer-safe-left", "20px");
  });
  await page.frameLocator("#rendererFrame").locator("body").evaluate(() => {
    const width = innerWidth;
    const height = innerHeight;
    parent.postMessage({
      source: "spatial-spark",
      type: "overlay-layout",
      viewport: { width, height },
      zones: {
        toolbar: { left: width - 244, right: width - 10, top: 10, bottom: 62 },
        status: { left: width - 244, right: width - 10, top: 70, bottom: 100 },
        help: null,
        movement: { left: 18, right: 150, top: height - 150, bottom: height - 18 },
        altitude: null,
      },
    }, location.origin);
    parent.postMessage({
      source: "spatial-spark",
      type: "movement-blocked",
      message: "Main West is closed · route blocked",
      cause: { kind: "doorway", id: "door-main-west" },
      position: [1, 0, 1],
    }, location.origin);
  });
  await expect(page.locator("#viewerBlockedReason")).toHaveText(
    "Main West is closed · route blocked",
  );
  await exploreRooms.click();
  await expect(page.locator("#spatialNavigator")).toBeVisible();
  await expect(page.locator("#reviewPanel")).toBeHidden();
  await expect(page.locator("#closeNavigator")).toBeVisible();
  await expect(page.locator(".navigator-item").first()).toBeVisible();
  const protectedLayout = await page.locator("#viewport").evaluate((root) => {
    const rect = (selector: string) => {
      const element = root.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    };
    const overlaps = (
      first: { left: number; right: number; top: number; bottom: number },
      second: { left: number; right: number; top: number; bottom: number },
    ) => first.left < second.right && first.right > second.left &&
      first.top < second.bottom && first.bottom > second.top;
    const hud = rect("#viewerHud");
    const rootBounds = root.getBoundingClientRect();
    const toolbar = {
      left: rootBounds.right - 244,
      right: rootBounds.right - 10,
      top: rootBounds.top + 10,
      bottom: rootBounds.top + 62,
    };
    const movement = {
      left: rootBounds.left + 18,
      right: rootBounds.left + 150,
      top: rootBounds.bottom - 150,
      bottom: rootBounds.bottom - 18,
    };
    const navigator = rect("#spatialNavigator");
    return {
      hudToolbarOverlap: overlaps(hud, toolbar),
      hudMovementOverlap: overlaps(hud, movement),
      navigatorContained: navigator.top >= hud.top - 1 && navigator.bottom <= hud.bottom + 1,
      navigatorHeight: navigator.bottom - navigator.top,
      navigatorTop: navigator.top,
      navigatorBottom: navigator.bottom,
      viewportHeight: rootBounds.bottom,
      viewportWidth: rootBounds.right,
      hudRight: hud.right,
      hudTop: hud.top,
      viewportTop: rootBounds.top,
      hudBottom: hud.bottom,
    };
  });
  expect(protectedLayout.hudToolbarOverlap).toBe(false);
  expect(protectedLayout.hudMovementOverlap).toBe(false);
  expect(protectedLayout.navigatorContained, JSON.stringify(protectedLayout)).toBe(true);
  expect(protectedLayout.navigatorHeight).toBeGreaterThan(0);
  expect(protectedLayout.hudRight).toBeLessThanOrEqual(protectedLayout.viewportWidth - 24 + 1);
  expect(protectedLayout.hudTop).toBeGreaterThanOrEqual(protectedLayout.viewportTop + 32 + 100);
  expect(protectedLayout.hudBottom).toBeLessThanOrEqual(protectedLayout.viewportHeight + 1);
  await expect.poll(() => page.frameLocator("#rendererFrame").locator("html").evaluate(
    () => (Reflect.get(window, "outerOverlayModes") ?? []).at(-1),
  )).toBe("navigator");
  await page.locator("#closeNavigator").click();
  await expect(page.locator("#reviewPanel")).toBeVisible();
  const reviewSafeArea = await page.locator("#reviewPanel").evaluate((panel) => {
    const bounds = panel.getBoundingClientRect();
    return { right: bounds.right, bottom: bounds.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  expect(reviewSafeArea.right).toBeLessThanOrEqual(reviewSafeArea.viewportWidth - 24 + 1);
  expect(reviewSafeArea.bottom).toBeLessThanOrEqual(reviewSafeArea.viewportHeight - 18 + 1);
  await expect.poll(() => page.frameLocator("#rendererFrame").locator("html").evaluate(
    () => (Reflect.get(window, "outerOverlayModes") ?? []).at(-1),
  )).toBe("review");

  simulateActivationChange = true;
  await page.frameLocator("#rendererFrame").locator("body").evaluate(() => {
    parent.postMessage({
      source: "spatial-spark",
      type: "authored-traversal-state",
      connectionId: "east-lift",
      traversalKind: "elevator",
      label: "East lift",
      phase: "started",
      qualification: {
        adapter: "xgrids-lcc",
        manifestSha256: "b".repeat(64),
        reviewGeneration: 3,
        registrationSha256: "c".repeat(64),
      },
    }, location.origin);
  });
  await expect.poll(() => telemetrySessionIssueCount).toBe(4);
  await expect.poll(() => telemetry.at(-1)).toMatchObject({
    eventType: "navigation_traversal",
    sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });

  await page.reload({ waitUntil: "commit" });
  await expect(page.frameLocator("#rendererFrame").getByRole("button", {
    name: "Renderer ready",
    exact: true,
  })).toBeVisible();
  await page.frameLocator("#rendererFrame").locator("body").evaluate(() => {
    parent.postMessage({
      source: "spatial-spark",
      type: "ready",
      runtime: "spark",
      version: "2.1.0",
      timeToFirstFrameMs: 1200,
      format: "rad",
      splatBudget: 2_000_000,
    }, location.origin);
    parent.postMessage({
      source: "spatial-spark",
      type: "authored-traversal-state",
      connectionId: "east-lift",
      traversalKind: "elevator",
      label: "East lift",
      phase: "completed",
      qualification: {
        adapter: "xgrids-lcc",
        manifestSha256: "b".repeat(64),
        reviewGeneration: 3,
        registrationSha256: "c".repeat(64),
      },
    }, location.origin);
  });
  await expect.poll(() => telemetrySessionIssueCount).toBe(5);
  await expect.poll(() => page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith("spatial.traversal-run."))
  )).toEqual([]);
});

test("reviewed viewer visual baselines cover every supported transition viewport", async ({ page }) => {
  const manifest = posterManifest("visual-matrix", null);
  expect(maximumViewerTitle).toHaveLength(120);
  manifest.project.name = maximumViewerTitle;
  manifest.viewer.title = maximumViewerTitle;
  manifest.spatial = {
    ...manifest.spatial,
    entities: [{
      id: "98888888-8888-4888-8888-888888888888",
      parent_id: null,
      kind: "room",
      label: "Long gallery room and conservation review area",
      position_json: JSON.stringify([0, 0, 0]),
      geometry_json: null,
      metadata_json: "{}",
    }],
    routes: [],
    routeStops: [],
  };

  await page.clock.setFixedTime(new Date("2026-08-24T08:00:00.000Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/releases/visual-matrix/manifest", (route) => json(route, manifest));
  await page.route("**/api/releases/visual-matrix/telemetry-session", (route) => json(route, {
    sessionId: "99999999-9999-4999-8999-999999999999",
    token: "visual-matrix-token",
    expiresAtEpochSeconds: Number.MAX_SAFE_INTEGER,
  }));
  await page.route("**/api/telemetry", (route) => route.fulfill({ status: 204 }));
  await page.route("**/renderer/index.html?*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: readyOnDemandRenderer().replace(
      "<body>",
      '<body style="margin:0;background:#090b0a;color:#f4efe1"><style>[role="status"]{display:none}</style>',
    ),
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/s/visual-matrix", { waitUntil: "commit" });
  await expect(page.locator("#loadingOverlay")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expectReviewedScreenshot(page, "viewer-loading-phone.png");

  await sendRendererReady(page);
  await expect(page.locator("#viewerHud")).toBeVisible();
  await expect(page.locator("#openNavigator")).toBeVisible();

  for (const viewport of RESPONSIVE_VISUAL_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => scrollTo(0, 0));
    const composition = await page.locator("#viewport").evaluate((root) => {
      const rootBounds = root.getBoundingClientRect();
      const controls = [...document.querySelectorAll<HTMLElement>(
        "#releaseApp :is(button,a[href],input,select,textarea,summary)",
      )].filter((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && bounds.width > 0
          && bounds.height > 0
          && bounds.bottom > 0
          && bounds.top < innerHeight;
      });
      return {
        clippedControls: controls.filter((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.left < -1 || bounds.right > innerWidth + 1
            || bounds.top < -1 || bounds.bottom > innerHeight + 1;
        }).map((element) => element.textContent?.trim() || element.getAttribute("aria-label")),
        hudContained: [...root.querySelectorAll<HTMLElement>("#viewerHud > :not([hidden])")]
          .every((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= rootBounds.left - 1
              && bounds.right <= rootBounds.right + 1
              && bounds.top >= rootBounds.top - 1
              && bounds.bottom <= rootBounds.bottom + 1;
          }),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
      };
    });
    expect(composition.clippedControls, viewport.name).toEqual([]);
    expect(composition.hudContained, viewport.name).toBe(true);
    expect(composition.documentWidth, viewport.name).toBeLessThanOrEqual(
      composition.viewportWidth + 1,
    );
    await expectReviewedScreenshot(page, `viewer-ready-${viewport.name}.png`);
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await page.frameLocator("#rendererFrame").locator("body").evaluate(() => {
    const width = innerWidth;
    const height = innerHeight;
    parent.postMessage({
      source: "spatial-spark",
      type: "overlay-layout",
      viewport: { width, height },
      zones: {
        toolbar: { left: width - 244, right: width - 10, top: 10, bottom: 62 },
        status: { left: width - 244, right: width - 10, top: 70, bottom: 100 },
        help: null,
        movement: { left: 18, right: 150, top: height - 150, bottom: height - 18 },
        altitude: null,
      },
    }, location.origin);
  });
  await page.locator("#openNavigator").click();
  await expect(page.locator("#spatialNavigator")).toBeVisible();
  await expectReviewedScreenshot(page, "viewer-navigator-short-landscape.png");
});

test("visual-only releases do not imply a metric scale", async ({ page }) => {
  await page.route("**/api/releases/visual-only-room/manifest", (route) => json(route, {
    schemaVersion: "1",
    release: {
      id: "44444444-4444-4444-8444-444444444444",
      slug: "visual-only-room",
      publishedAt: "2026-07-30T00:00:00.000Z",
      expiresAt: null,
      accessPolicy: "public",
    },
    project: {
      id: "55555555-5555-4555-8555-555555555555",
      versionId: "66666666-6666-4666-8666-666666666666",
      name: "Visual-only room",
      captureAdapter: "test",
      provenance: {},
    },
    scene: {
      format: "rad",
      contentUrl: "/visual-only.rad",
      posterUrl: null,
      sizeBytes: 1,
      etag: null,
    },
    viewer: {
      title: "Visual-only room",
      measurementDisclaimer: "Visual experience only.",
      splatBudgetMillions: null,
    },
    deliveryPolicy: {
      adaptive_quality: 1,
      mobile_lite_budget: 0.75,
      mobile_standard_budget: 0.75,
      desktop_standard_budget: 0.75,
      desktop_high_budget: 0.75,
      max_initial_bytes: 15_728_640,
    },
    spatial: {
      entities: [],
      routes: [],
      routeStops: [],
      collisionProxy: { version: "box-union-v1", boxes: [] },
      navigationMesh: {
        version: "room-box-triangles-v1",
        vertices: [],
        indices: [],
        sourceEntityIds: [],
      },
      obstacleProxy: { version: "authored-obstacle-boxes-v1", boxes: [] },
      navigationProfile: {
        worldUnit: "metres",
        agentRadius: 0.22,
        agentHeight: 1.8,
        eyeHeight: 1.6,
        maxStepMetres: 0.1,
      },
    },
  }));
  await page.route("**/api/releases/visual-only-room/telemetry", (route) => json(route, {}));

  await page.goto("/s/visual-only-room", { waitUntil: "commit" });
  await expect(page.locator("#scaleStatus")).toHaveText("Visual only — scale not declared");
  // A release published without an operator budget must reach the delivery
  // policy instead of silently opening every device at the same splat count.
  await expect(page.locator("#rendererFrame")).toHaveAttribute("src", /budget=0\.75/);
});

test("routes SOG releases through the Spark renderer", async ({ page }) => {
  await page.route("**/api/releases/spark-sog-loading/manifest", (route) => json(route, {
    schemaVersion: "1",
    release: {
      id: "74444444-4444-4444-8444-444444444444",
      slug: "spark-sog-loading",
      publishedAt: "2026-07-31T00:00:00.000Z",
      expiresAt: null,
      accessPolicy: "public",
    },
    project: {
      id: "75555555-5555-4555-8555-555555555555",
      versionId: "76666666-6666-4666-8666-666666666666",
      name: "Native SOG loading",
      captureAdapter: "open-import",
      provenance: {},
    },
    scene: {
      format: "sog",
      contentUrl: "/native-room.sog",
      posterUrl: "/native-room-poster.png",
      sizeBytes: 54_803_033,
      etag: null,
    },
    viewer: {
      title: "Native SOG loading",
      measurementDisclaimer: "Visual experience only.",
      splatBudgetMillions: 2,
      sceneRotationDegrees: [0, 0, 180],
    },
    spatial: {
      entities: [],
      routes: [],
      routeStops: [],
      collisionProxy: { version: "box-union-v1", boxes: [] },
      navigationMesh: {
        version: "room-box-triangles-v1",
        vertices: [],
        indices: [],
        sourceEntityIds: [],
      },
      obstacleProxy: { version: "authored-obstacle-boxes-v1", boxes: [] },
      navigationProfile: {
        worldUnit: "metres",
        agentRadius: 0.22,
        agentHeight: 1.8,
        eyeHeight: 1.6,
        maxStepMetres: 0.1,
      },
    },
  }));
  await page.route("**/api/releases/spark-sog-loading/telemetry", (route) => json(route, {}));
  await page.route("**/renderer/index.html?*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<html><body style='background:#5d7044'></body></html>",
  }));

  await page.goto("/s/spark-sog-loading", { waitUntil: "commit" });

  const rendererFrame = page.locator("#rendererFrame");
  await expect(rendererFrame).not.toHaveClass(/native-streaming/);
  await expect(rendererFrame).toHaveAttribute("src", /\/renderer\/index\.html\?.*format=sog/);
  await expect(rendererFrame).toHaveAttribute("src", /rotation=0%2C0%2C180/);

  await page.frameLocator("#rendererFrame").locator("body").evaluate(() => {
    parent.postMessage({
      source: "spatial-spark",
      type: "ready",
      runtime: "spark",
      version: "test",
      timeToFirstFrameMs: 1200,
      format: "sog",
      splatBudget: 2_000_000,
    }, location.origin);
  });
  await expect(page.locator("#viewerHud")).toBeVisible();
});

test("the release poster covers the viewport until the renderer reports its first frame", async ({ page }) => {
  await page.route(
    "**/api/releases/poster-handoff/manifest",
    (route) => json(route, posterManifest()),
  );
  await page.route("**/scene-poster.png", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from(TRANSPARENT_PNG_BASE64, "base64"),
  }));
  await page.route("**/renderer/index.html?*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: readyOnDemandRenderer(),
  }));

  await page.goto("/s/poster-handoff", { waitUntil: "commit" });
  const poster = page.locator("#scenePoster");
  await expect(poster).toBeVisible();
  await expect(poster).toHaveAttribute("src", /scene-poster\.png/);
  await expect(poster).toHaveCSS("object-fit", "cover");
  await expect.poll(() => poster.evaluate((element) => {
    const viewport = document.getElementById("viewport")!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return Math.abs(box.width - viewport.width) <= 4 &&
      Math.abs(box.height - viewport.height) <= 4;
  })).toBe(true);

  await sendRendererReady(page);
  await expect(page.locator("#viewerHud")).toBeVisible();
  await expect(poster).toBeHidden();
});

test("a renderer that never reports progress ends in a retryable error", async ({ page }) => {
  await page.clock.install();
  await page.route(
    "**/api/releases/stalled-loading/manifest",
    (route) => json(route, posterManifest("stalled-loading", null)),
  );
  await page.route("**/renderer/index.html?*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<html><body><div role='status'>Loading spatial scene</div></body></html>",
  }));

  await page.goto("/s/stalled-loading", { waitUntil: "commit" });
  await expect(page.locator("#loadingOverlay")).toBeVisible();
  await expect(page.locator("#errorPanel")).toBeHidden();

  await page.clock.fastForward(95_000);
  await expect(page.locator("#errorPanel")).toBeVisible();
  await expect(page.locator("#errorTitle")).toHaveText(
    "This scene stopped responding while loading.",
  );
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.locator("#loadingOverlay")).toBeHidden();
});

test("the viewer renews its scene session and reports an unrecoverable expiry", async ({ page }) => {
  const renewals: string[] = [];
  await page.route("**/api/releases/session-renewal/manifest", (route) => {
    const manifest = posterManifest("session-renewal", null);
    manifest.scene.contentUrl = "/asset/release/asset/scene.rad?token=first-scene-token";
    manifest.integrity = {
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sessionExpiresAt: new Date(Date.now() + 6_000).toISOString(),
      sessionHardExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      sessionRenewalPath: "/api/scene-sessions/renew",
    };
    return json(route, manifest);
  });
  await page.route("**/api/scene-sessions/renew", async (route) => {
    const body = route.request().postDataJSON() as { token: string };
    renewals.push(body.token);
    if (renewals.length > 1) {
      await route.fulfill({
        status: 410,
        contentType: "application/json",
        body: '{"error":"This scene session can no longer be renewed"}',
      });
      return;
    }
    await json(route, {
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      token: "renewed-scene-token",
      expiresAtEpochSeconds: Math.floor((Date.now() + 6_000) / 1_000),
      sessionExpiresAt: new Date(Date.now() + 6_000).toISOString(),
      sessionHardExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      renewalPath: "/api/scene-sessions/renew",
    });
  });
  await page.route("**/renderer/index.html?*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: readyOnDemandRenderer(),
  }));

  await page.goto("/s/session-renewal", { waitUntil: "commit" });
  await sendRendererReady(page);
  await expect(page.locator("#viewerHud")).toBeVisible();

  // Ready replays the current token to the renderer so a renewal that fired
  // during loading is never stranded in the parent's manifest.
  await expect.poll(async () => (await frameHostMessages(page))
    .filter((message) => message.type === "refresh-scene-tokens")
    .map((message) => message.contentUrl)
  ).toEqual(["/asset/release/asset/scene.rad?token=first-scene-token"]);

  // Renewal runs at roughly sixty percent of the remaining session lifetime and
  // carries the token minted with the manifest, never the release slug.
  await expect.poll(() => renewals, { timeout: 20_000 }).toEqual(["first-scene-token"]);
  // The renewed token reaches the running renderer, not just the manifest: the
  // paged tile stream must issue every later ranged fetch with it.
  await expect.poll(async () => (await frameHostMessages(page))
    .filter((message) => message.type === "refresh-scene-tokens")
    .map((message) => message.contentUrl), { timeout: 20_000 }
  ).toEqual([
    "/asset/release/asset/scene.rad?token=first-scene-token",
    "/asset/release/asset/scene.rad?token=renewed-scene-token",
  ]);
  await expect.poll(() => renewals, { timeout: 20_000 }).toEqual([
    "first-scene-token",
    "renewed-scene-token",
  ]);
  await expect(page.locator("#errorPanel")).toBeVisible();
  await expect(page.locator("#errorTitle")).toHaveText("This viewing session expired.");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
});

test("a renderer that stops heartbeating after ready surfaces a retryable error", async ({ page }) => {
  await page.clock.install();
  await page.route(
    "**/api/releases/dead-renderer/manifest",
    (route) => json(route, posterManifest("dead-renderer", null)),
  );
  await page.route("**/renderer/index.html?*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: readyOnDemandRenderer(),
  }));

  await page.goto("/s/dead-renderer", { waitUntil: "commit" });
  await sendRendererReady(page);
  await expect(page.locator("#viewerHud")).toBeVisible();

  // One heartbeat arms the liveness watchdog; a mobile OOM tab-kill or GPU
  // process death then goes silent without ever firing webglcontextlost.
  await page.frameLocator("#rendererFrame").locator("body").evaluate(() => {
    parent.postMessage({ source: "spatial-spark", type: "heartbeat" }, location.origin);
  });
  await page.clock.fastForward(35_000);
  await expect(page.locator("#errorPanel")).toBeVisible();
  await expect(page.locator("#errorTitle")).toHaveText("This scene stopped responding.");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
});

test("a quiet renderer that never heartbeats is not misread as dead", async ({ page }) => {
  await page.clock.install();
  await page.route(
    "**/api/releases/quiet-renderer/manifest",
    (route) => json(route, posterManifest("quiet-renderer", null)),
  );
  await page.route("**/renderer/index.html?*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: readyOnDemandRenderer(),
  }));

  await page.goto("/s/quiet-renderer", { waitUntil: "commit" });
  await sendRendererReady(page);
  await expect(page.locator("#viewerHud")).toBeVisible();

  // The watchdog arms only on a real heartbeat, so a renderer build (or an
  // embedding fixture) that never heartbeats keeps its healthy viewer.
  await page.clock.fastForward(120_000);
  await expect(page.locator("#errorPanel")).toBeHidden();
  await expect(page.locator("#viewerHud")).toBeVisible();
});

test("resuming a suspended tab does not misread a live renderer as dead", async ({ page }) => {
  await page.clock.install();
  await page.route(
    "**/api/releases/suspended-tab/manifest",
    (route) => json(route, posterManifest("suspended-tab", null)),
  );
  await page.route("**/renderer/index.html?*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: readyOnDemandRenderer(),
  }));

  await page.goto("/s/suspended-tab", { waitUntil: "commit" });
  await sendRendererReady(page);
  await expect(page.locator("#viewerHud")).toBeVisible();
  await page.frameLocator("#rendererFrame").locator("body").evaluate(() => {
    parent.postMessage({ source: "spatial-spark", type: "heartbeat" }, location.origin);
  });

  // iOS Safari freezes a hidden page outright: visibilitychange fires, then
  // not a single timer callback runs until the user returns.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const frozenAtMs = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(frozenAtMs + 1_000);
  // Five background minutes pass with zero timer callbacks — the deterministic
  // model of a frozen page: setSystemTime moves the clock but fires nothing.
  await page.clock.setSystemTime(frozenAtMs + 301_000);

  // The resume visibilitychange runs its viewer tick synchronously, before any
  // queued heartbeat from the still-live renderer can be processed, so the
  // stale deadline must be forgiven by the transition itself.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#errorPanel")).toBeHidden();
  await expect(page.locator("#viewerHud")).toBeVisible();

  // Resume grants a fresh grace period, not immunity: a renderer that really
  // died during the suspension still fails visibly one deadline later.
  await page.clock.fastForward(35_000);
  await expect(page.locator("#errorPanel")).toBeVisible();
  await expect(page.locator("#errorTitle")).toHaveText("This scene stopped responding.");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
});

const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type ViewerManifestFixture = {
  schemaVersion: string;
  release: Record<string, unknown>;
  project: Record<string, unknown>;
  scene: {
    format: string;
    contentUrl: string;
    posterUrl: string | null;
    collisionUrl: string | null;
    detourUrl: string | null;
    navMeshUrl: string | null;
    sizeBytes: number;
    etag: string | null;
  };
  viewer: Record<string, unknown>;
  spatial: Record<string, unknown>;
  integrity?: Record<string, string>;
};

function posterManifest(
  slug = "poster-handoff",
  posterUrl: string | null = "/scene-poster.png",
): ViewerManifestFixture {
  return {
    schemaVersion: "1",
    release: {
      id: "84444444-4444-4444-8444-444444444444",
      slug,
      publishedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: null,
      accessPolicy: "public",
    },
    project: {
      id: "85555555-5555-4555-8555-555555555555",
      versionId: "86666666-6666-4666-8666-666666666666",
      name: "Poster handoff fixture",
      captureAdapter: "test",
      provenance: {},
    },
    scene: {
      format: "rad",
      contentUrl: "/poster-handoff.rad",
      posterUrl,
      collisionUrl: null,
      detourUrl: null,
      navMeshUrl: null,
      sizeBytes: 1,
      etag: null,
    },
    viewer: {
      title: "Poster handoff fixture",
      measurementDisclaimer: "Visual experience only.",
      splatBudgetMillions: null,
    },
    spatial: {
      entities: [],
      routes: [],
      routeStops: [],
      collisionProxy: { version: "box-union-v1", boxes: [] },
      navigationMesh: {
        version: "room-box-triangles-v1",
        vertices: [],
        indices: [],
        sourceEntityIds: [],
      },
      obstacleProxy: { version: "authored-obstacle-boxes-v1", boxes: [] },
      navigationProfile: {
        worldUnit: "metres",
        agentRadius: 0.22,
        agentHeight: 1.8,
        eyeHeight: 1.6,
        maxStepMetres: 0.1,
      },
    },
  };
}

function readyOnDemandRenderer(): string {
  return `<!doctype html>
    <html>
      <body>
        <div role="status">Loading spatial scene</div>
        <script>
          window.__hostMessages = [];
          window.addEventListener("message", (event) => {
            if (event.data && event.data.source === "spatial-host") {
              window.__hostMessages.push(event.data);
            }
          });
        </script>
      </body>
    </html>`;
}

function frameHostMessages(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.frameLocator("#rendererFrame").locator("html").evaluate(() =>
    (window as unknown as { __hostMessages?: Array<Record<string, unknown>> })
      .__hostMessages ?? []
  );
}

function sendRendererReady(page: Page): Promise<void> {
  return page.frameLocator("#rendererFrame").locator("body").evaluate(() => {
    parent.postMessage({
      source: "spatial-spark",
      type: "ready",
      runtime: "spark",
      version: "2.1.0",
      timeToFirstFrameMs: 1200,
      format: "rad",
      splatBudget: 2_000_000,
    }, location.origin);
  });
}

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function rectanglesOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
): boolean {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}
