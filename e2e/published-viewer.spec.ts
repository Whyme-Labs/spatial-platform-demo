import { expect, test, type Route } from "@playwright/test";
import { PROVISIONAL_MEASUREMENT_DISCLAIMER } from "../src/shared/world-units";

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
          <button id="free-roam" onclick="parent.postMessage({
            source: 'spatial-spark',
            type: 'control-mode',
            mode: 'free-roam'
          }, location.origin)">Free roam</button>
          <button id="exit-roam" onclick="parent.postMessage({
            source: 'spatial-spark',
            type: 'control-mode',
            mode: 'orbit'
          }, location.origin)">Exit roam</button>
          <button id="open-onboarding" onclick="parent.postMessage({
            source: 'spatial-spark',
            type: 'control-onboarding',
            visible: true
          }, location.origin)">Open onboarding</button>
          <button id="close-onboarding" onclick="parent.postMessage({
            source: 'spatial-spark',
            type: 'control-onboarding',
            visible: false
          }, location.origin)">Close onboarding</button>
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
  const exploreRooms = page.getByRole("button", { name: "Explore rooms" });
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
  await controlsButton.click();
  await expect(controlsHelp).toBeVisible();
  await expect(page.locator("#releaseInfoDetails")).toBeHidden();
  await expect(page.locator("#toggleReleaseInfo")).toHaveAttribute("aria-expanded", "false");
  await expectHudAndHelpSeparated();
  await controlsButton.click();
  await expect(controlsHelp).toBeHidden();

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
  await controlsButton.click();
  await expect(controlsHelp).toBeVisible();
  await expect(page.locator("#spatialNavigator")).toBeHidden();
  await expect(exploreRooms).toHaveAttribute("aria-expanded", "false");
  await expectHudAndHelpSeparated();
  await controlsButton.click();
  await expect(controlsHelp).toBeHidden();

  await exploreRooms.click();
  await expect(page.locator("#spatialNavigator")).toBeVisible();
  await page.locator("#closeNavigator").click();
  await expect(page.locator("#spatialNavigator")).toBeHidden();
  await expect(exploreRooms).toBeVisible();
  await expect(exploreRooms).toHaveAttribute("aria-expanded", "false");

  await controlsButton.click();
  await expect(controlsHelp).toBeVisible();
  await expectHudAndHelpSeparated();
  await page.setViewportSize({ width: 700, height: 760 });
  await expect(viewerHud).toBeHidden();
  await controlsButton.click();
  await expect(controlsHelp).toBeHidden();
  await expect(viewerHud).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await controlsButton.click();
  await expect(controlsHelp).toBeVisible();
  await expect(viewerHud).toBeHidden();
  await controlsButton.click();
  await expect(controlsHelp).toBeHidden();
  await expect(viewerHud).toBeVisible();

  const [exploreBox, qualityBox] = await Promise.all([
    exploreRooms.boundingBox(),
    qualityStatus.boundingBox(),
  ]);
  expect(exploreBox).not.toBeNull();
  expect(qualityBox).not.toBeNull();
  expect(rectanglesOverlap(exploreBox!, qualityBox!)).toBe(false);
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
  await page.frameLocator("#rendererFrame").getByRole("button", { name: "Free roam" }).click();
  await expect(viewport).toHaveClass(/mobile-free-roam-active/);
  await page.frameLocator("#rendererFrame").getByRole("button", { name: "Exit roam" }).click();
  await expect(viewport).not.toHaveClass(/mobile-free-roam-active/);
  await page.frameLocator("#rendererFrame").getByRole("button", { name: "Open onboarding" }).click();
  await expect(viewport).toHaveClass(/mobile-controls-onboarding/);
  await page.frameLocator("#rendererFrame").getByRole("button", { name: "Close onboarding" }).click();
  await expect(viewport).not.toHaveClass(/mobile-controls-onboarding/);

  for (const viewportSize of [
    { width: 700, height: 760 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewportSize);
    await expect.poll(async () => {
      const [responsiveExploreBox, responsiveQualityBox] = await Promise.all([
        exploreRooms.boundingBox(),
        qualityStatus.boundingBox(),
      ]);
      return responsiveExploreBox !== null
        && responsiveQualityBox !== null
        && !rectanglesOverlap(responsiveExploreBox, responsiveQualityBox);
    }).toBe(true);
  }

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
      splatBudgetMillions: 2,
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
