#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { SpzWriter } from "@sparkjsdev/spark";
import { buildAuthoredStructuralCollisionGlb } from "./authored-collision.mjs";
import {
  buildRecastNavigationArtifact,
  extractCollisionGeometryFromGlb,
} from "./navigation-build-core.mjs";

const args = process.argv.slice(2);
const writeReceipt = args.includes("--write");
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8794;
const origin = `http://127.0.0.1:${port}`;
const receiptPath = new URL("../config/frontend-route-receipts.json", import.meta.url);
const protectedChunkPrefixes = [
  "renderer-",
  "physical-navigation-",
  "detour-navigation-",
  "recast-navigation-",
];

const routeDefinitions = [
  { id: "signed-out-studio", path: "/studio.html", kind: "signed-out", protected: true },
  { id: "authenticated-portfolio", path: "/studio.html#projects", kind: "portfolio", protected: true },
  {
    id: "private-preview-first-frame",
    path: "/preview/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333",
    kind: "private-preview",
    protected: false,
  },
  { id: "published-viewer-first-frame", path: "/s/route-receipt", kind: "published", protected: false },
];

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function minimalSpz() {
  const writer = new SpzWriter({ numSplats: 4, shDegree: 0, flagAntiAlias: false });
  [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]].forEach(([x, y, z], index) => {
    writer.setCenter(index, x, y, z);
    writer.setAlpha(index, 1);
    writer.setRgb(index, 0.5, 0.5, 0.5);
    writer.setScale(index, -2, -2, -2);
    writer.setQuat(index, 0, 0, 0, 1);
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    return writer.finalize();
  } finally {
    console.log = originalLog;
  }
}

async function buildRendererFixture() {
  const collision = buildAuthoredStructuralCollisionGlb({
    schemaVersion: "authored-structural-collision-v2",
    provenance: "operator_reviewed",
    floorRectangles: [{ id: "floor", min: [0, 0], max: [8, 4], elevation: 0 }],
    ceilingRectangles: [{ id: "ceiling", min: [0, 0], max: [8, 4], elevation: 3 }],
    barrierSegments: [
      { id: "west", start: [0, 0], end: [0, 4], minY: 0, maxY: 3 },
      { id: "east", start: [8, 0], end: [8, 4], minY: 0, maxY: 3 },
      { id: "north", start: [0, 0], end: [8, 0], minY: 0, maxY: 3 },
      { id: "south", start: [0, 4], end: [8, 4], minY: 0, maxY: 3 },
    ],
    dynamicBarrierBoxes: [],
    furnitureBoxes: [],
  });
  const geometry = await extractCollisionGeometryFromGlb(collision);
  const originalLog = console.log;
  console.log = () => {};
  let navigationArtifact;
  try {
    navigationArtifact = await buildRecastNavigationArtifact({
      positions: geometry.positions,
      indices: geometry.indices,
      collisionSemantics: geometry.collisionSemantics,
      dynamicBarriers: geometry.dynamicBarriers,
      structuralGeometry: geometry.structuralGeometry,
      source: {
        assetId: "frontend-route-receipt",
        sha256: "a".repeat(64),
        authoringHash: "b".repeat(64),
        worldUnit: "metres",
      },
      agent: {
        radius: 0.22, height: 1.8, eyeHeight: 1.6, maxClimb: 0.1,
        maxSlopeDegrees: 45, maxSpeed: 1.6, maxAcceleration: 8,
      },
      build: { cellSize: 0.1, cellHeight: 0.05, tileSize: 32 },
      spawn: { id: "opening", position: [1, 0, 2] },
      destinations: [{ id: "far-side", position: [7, 0, 2] }],
    });
  } finally {
    console.log = originalLog;
  }
  return { collision, navigationArtifact, scene: await minimalSpz() };
}

function manifest(fixture, accessPolicy) {
  return {
    schemaVersion: "1",
    release: {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "route-receipt",
      publishedAt: "2026-08-25T00:00:00.000Z",
      expiresAt: null,
      accessPolicy,
    },
    project: {
      id: "22222222-2222-4222-8222-222222222222",
      versionId: "33333333-3333-4333-8333-333333333333",
      name: "Frontend route receipt",
      captureAdapter: "open-import",
      provenance: {},
    },
    scene: {
      format: "spz",
      contentUrl: "/asset/route-receipt-scene.spz",
      posterUrl: null,
      collisionUrl: "/asset/route-receipt-collision.glb",
      detourUrl: null,
      navMeshUrl: null,
      sizeBytes: fixture.scene.byteLength,
      etag: null,
    },
    viewer: {
      title: "Frontend route receipt",
      measurementDisclaimer: "Deterministic local performance fixture.",
      splatBudgetMillions: 2,
      defaultMovementMode: "walk",
    },
    spatial: {
      entities: [], routes: [], routeStops: [],
      collisionProxy: { version: "box-union-v1", boxes: [] },
      navigationMesh: {
        version: "recast-debug-triangles-v6",
        vertices: fixture.navigationArtifact.navMesh.vertices,
        indices: fixture.navigationArtifact.navMesh.indices,
        sourceEntityIds: [],
      },
      obstacleProxy: { version: "authored-obstacle-boxes-v1", boxes: [] },
      navigationProfile: {
        worldUnit: "metres", agentRadius: 0.22, agentHeight: 1.8,
        eyeHeight: 1.6, maxStepMetres: 0.1, maxSlopeDegrees: 45,
        maxSpeed: 1.6, maxAcceleration: 8,
      },
      navigationArtifact: fixture.navigationArtifact,
    },
  };
}

async function installRoutes(page, kind, fixture) {
  await page.addInitScript(() => {
    window.__routeReceiptReady = [];
    window.addEventListener("message", (event) => {
      if (event.data?.source === "spatial-spark" && event.data?.type === "ready") {
        window.__routeReceiptReady.push({ atMs: performance.now(), ...event.data });
      }
    }, true);
    window.turnstile = {
      render(container, options) {
        container.textContent = "Security check ready";
        queueMicrotask(() => options.callback("route-receipt-token"));
        return "route-receipt";
      },
      reset() {},
      remove() {},
    };
  });
  await page.route("**/asset/route-receipt-scene.spz", (route) => route.fulfill({
    status: 200, contentType: "application/octet-stream", body: Buffer.from(fixture.scene),
  }));
  await page.route("**/asset/route-receipt-collision.glb", (route) => route.fulfill({
    status: 200, contentType: "model/gltf-binary", body: Buffer.from(fixture.collision),
  }));
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/config") {
      return json(route, { turnstileSiteKey: "1x00000000000000000000AA", turnstileAction: "otp_request" });
    }
    if (path === "/api/auth/refresh") return route.fulfill({ status: 204, body: "" });
    if (kind === "signed-out" && path === "/api/auth/session") return json(route, { authenticated: false });
    if (kind === "portfolio") {
      if (path === "/api/auth/session") return json(route, {
        authenticated: true,
        user: {
          userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          organisationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          email: "receipt@example.com",
          displayName: "Receipt operator",
          role: "production_operator",
        },
        pendingInvitations: [],
      });
      if (path === "/api/auth/organisations") return json(route, {
        currentOrganisationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        organisations: [{
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Receipt workspace",
          slug: "receipt-workspace",
          role: "production_operator",
          membershipUpdatedAt: "2026-08-25T00:00:00.000Z",
          current: true,
        }],
      });
      if (path === "/api/dashboard") return json(route, {
        activeProjects: 1, processingJobs: 0, hostedAssets: 0, hostedBytes: 0, activeReleases: 0,
      });
      if (path === "/api/review/inbox") return json(route, { projects: [] });
      if (path === "/api/projects") return json(route, { projects: [{
        id: "22222222-2222-4222-8222-222222222222",
        name: "Frontend route receipt",
        slug: "frontend-route-receipt",
        status: "INGESTED",
        captureAdapter: "open-import",
        deliveryTemplate: "venue-navigator",
        customerName: "Receipt workspace",
        customFields: {},
        latestVersionId: null,
        latestVersionNumber: null,
        activeReleaseSlug: null,
        updatedAt: "2026-08-25T00:00:00.000Z",
      }], nextCursor: null });
      if (path === "/api/jobs") return json(route, { jobs: [], nextCursor: null });
      if (path === "/api/releases") return json(route, { releases: [], nextCursor: null });
      if (path === "/api/hosting") return json(route, {
        paymentProviderConfigured: false, manualBillingEnabled: true,
        plans: [], subscriptions: [], checkouts: [], invoices: [], alerts: [], lifecycleRuns: [],
      });
      if (path === "/api/project-templates") return json(route, { templates: [], nextCursor: null });
      if (path === "/api/project-views") return json(route, { views: [], nextCursor: null });
      if (path === "/api/project-fields") return json(route, { fields: [] });
      if (path === "/api/uploads/recoverable") return json(route, { uploads: [] });
    }
    if (kind === "private-preview" && path.endsWith("/preview")) {
      return json(route, { manifest: manifest(fixture, "private") });
    }
    if (kind === "published" && path === "/api/releases/route-receipt/manifest") {
      return json(route, manifest(fixture, "public"));
    }
    if (path.includes("telemetry")) return route.fulfill({ status: 204, body: "" });
    console.error(`frontend-route-audit: unmocked ${kind} request ${request.method()} ${path}`);
    return json(route, { error: `Unmocked route: ${request.method()} ${path}` }, 404);
  });
}

function frontendResource(url) {
  const parsed = new URL(url);
  if (parsed.origin !== origin) return false;
  if (parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/asset/route-receipt-")) return false;
  return parsed.pathname === "/" || parsed.pathname === "/studio.html" ||
    parsed.pathname.startsWith("/s/") || parsed.pathname.startsWith("/preview/") ||
    parsed.pathname === "/renderer/index.html" || parsed.pathname.startsWith("/assets/");
}

function chunkName(url) {
  const name = new URL(url).pathname.split("/").at(-1) ?? "";
  return name.endsWith(".js") ? name : null;
}

async function builtChunkCatalogue() {
  const assetsDirectory = new URL("../dist/assets/", import.meta.url);
  const files = await readdir(assetsDirectory);
  const catalogue = new Map();
  for (const name of files.filter((file) => file.endsWith(".js"))) {
    const bytes = await readFile(new URL(name, assetsDirectory));
    let sources = [];
    let mapReadable = false;
    try {
      const sourceMap = JSON.parse(await readFile(new URL(`${name}.map`, assetsDirectory), "utf8"));
      if (!Array.isArray(sourceMap.sources)) throw new Error(`${name}.map has no sources array`);
      sources = sourceMap.sources;
      mapReadable = true;
    } catch {}
    const rendererOwned = protectedChunkPrefixes.some((prefix) => name.startsWith(prefix)) ||
      sources.some((source) =>
      /(?:\/src\/renderer\/|node_modules\/(?:@recast-navigation|@dimforge\/rapier))/.test(source)
      );
    catalogue.set(name, {
      name,
      role: rendererOwned ? "renderer-navigation" : mapReadable ? "shell-shared" : "unclassified",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      rawBytes: bytes.byteLength,
    });
  }
  return catalogue;
}

async function measureRoute(browser, definition, fixture, chunkCatalogue) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }, locale: "en-US", timezoneId: "UTC", serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`frontend-route-audit: page error on ${definition.id}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`frontend-route-audit: console error on ${definition.id}: ${message.text()}`);
  });
  await installRoutes(page, definition.kind, fixture);
  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  const resources = new Map();
  client.on("Network.responseReceived", ({ requestId, response, type }) => {
    const contentLength = Number(response.headers["content-length"] ?? response.headers["Content-Length"] ?? 0);
    resources.set(requestId, {
      url: response.url, type, status: response.status,
      fromDiskCache: response.fromDiskCache,
      contentLength: Number.isFinite(contentLength) ? contentLength : 0,
      transferBytes: 0,
    });
  });
  client.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => {
    const resource = resources.get(requestId);
    if (resource) resource.transferBytes = Math.round(encodedDataLength);
  });

  await page.goto(`${origin}${definition.path}`, { waitUntil: "domcontentloaded" });
  if (definition.kind === "signed-out") {
    await page.locator("#loginDialog").waitFor({ state: "visible" });
  } else if (definition.kind === "portfolio") {
    await page.locator("#projectTable .project-row:not(.header)").waitFor({ state: "visible" });
  } else {
    try {
      await page.locator("#rendererStatus").filter({ hasText: "Scene ready" })
        .waitFor({ state: "visible", timeout: 45_000 });
    } catch (error) {
      console.error(`frontend-route-audit: viewer state on ${definition.id}: ${await page.locator("body").innerText()}`);
      throw error;
    }
  }
  const routeReadyAtMs = await page.evaluate(() => Math.round(performance.now()));
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const timing = await page.evaluate(() => ({
    firstContentfulPaintMs: Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0),
    rendererReady: window.__routeReceiptReady.at(-1) ?? null,
  }));
  timing.readyAtMs = routeReadyAtMs;
  const frontend = [...resources.values()].filter((resource) => frontendResource(resource.url));
  const assets = frontend.map((resource) => ({
    path: new URL(resource.url).pathname,
    type: resource.type,
    encodedBodyBytes: resource.status === 304 || resource.fromDiskCache || resource.transferBytes === 0
      ? 0
      : resource.contentLength || resource.transferBytes,
    transferredBytes: resource.transferBytes,
  })).sort((left, right) => left.path.localeCompare(right.path));
  const chunks = [...new Set(frontend.map((resource) => chunkName(resource.url)).filter(Boolean))].sort();
  const chunkIdentities = chunks.map((name) => chunkCatalogue.get(name) ?? {
    name, role: protectedChunkPrefixes.some((prefix) => name.startsWith(prefix))
      ? "renderer-navigation"
      : "unknown",
    sha256: null,
    rawBytes: null,
  });
  const marketingAssets = [...resources.values()].filter((resource) => {
    const parsed = new URL(resource.url);
    return parsed.origin === origin && parsed.pathname.startsWith("/images/");
  }).map((resource) => ({
    path: new URL(resource.url).pathname,
    transferredBytes: resource.transferBytes,
  }));
  const result = {
    id: definition.id,
    path: definition.path,
    frontendEncodedBodyBytes: assets.reduce((sum, asset) => sum + asset.encodedBodyBytes, 0),
    frontendTransferredBytes: assets.reduce((sum, asset) => sum + asset.transferredBytes, 0),
    chunks,
    chunkIdentities,
    unexpectedMarketingAssets: marketingAssets,
    assets,
    timing,
  };
  await context.close();
  return result;
}

async function waitForServer(url) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`vite preview did not answer at ${url}`);
}

function audit(results, receipt) {
  const failures = [];
  if (receipt.schemaVersion !== 1 || !receipt.routes || typeof receipt.routes !== "object") {
    return ["config/frontend-route-receipts.json: invalid schemaVersion or routes object"];
  }
  for (const result of results) {
    const budget = receipt.routes[result.id];
    if (!budget) {
      failures.push(`${result.id}: missing frontend route receipt`);
      continue;
    }
    let invalidLimit = false;
    for (const key of ["maxForbiddenChunkCount", "maxUnexpectedMarketingAssetCount"]) {
      const value = budget[key];
      if (value !== null && (!Number.isInteger(value) || value < 0)) {
        invalidLimit = true;
        failures.push(
          `${result.id}: ${key} must be a non-negative integer or null in config/frontend-route-receipts.json`,
        );
      }
    }
    if (invalidLimit) continue;
    if (budget.maxForbiddenChunkCount !== null) {
      const forbidden = result.chunkIdentities.filter((chunk) => chunk.role !== "shell-shared");
      if (forbidden.length > budget.maxForbiddenChunkCount) {
        failures.push(
          `${result.id}: renderer_navigation_chunk_count limit=${budget.maxForbiddenChunkCount} ` +
          `requested=${forbidden.length} requested_raw_bytes=${forbidden.reduce((sum, chunk) => sum + (chunk.rawBytes ?? 0), 0)} ` +
          `chunks=${forbidden.map((chunk) => chunk.name).join(",")} ` +
          `receipt=config/frontend-route-receipts.json`,
        );
      }
    }
    if (budget.maxUnexpectedMarketingAssetCount !== null &&
      result.unexpectedMarketingAssets.length > budget.maxUnexpectedMarketingAssetCount) {
      failures.push(
        `${result.id}: unexpected_marketing_asset_count limit=${budget.maxUnexpectedMarketingAssetCount} ` +
        `requested=${result.unexpectedMarketingAssets.length} ` +
        `requested_transferred_bytes=${result.unexpectedMarketingAssets.reduce((sum, asset) => sum + asset.transferredBytes, 0)} ` +
        `assets=${result.unexpectedMarketingAssets.map((asset) => asset.path).join(",")} ` +
        `receipt=config/frontend-route-receipts.json`,
      );
    }
  }
  return failures;
}

const preview = spawn("npx", [
  "vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { stdio: "ignore" });
try {
  await waitForServer(`${origin}/`);
  const receiptLog = console.log;
  console.log = () => {};
  const fixture = await buildRendererFixture();
  await delay(0);
  console.log = receiptLog;
  const chunkCatalogue = await builtChunkCatalogue();
  const browser = await chromium.launch();
  const results = [];
  for (const definition of routeDefinitions) {
    results.push(await measureRoute(browser, definition, fixture, chunkCatalogue));
  }
  const environment = {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    chromium: browser.version(),
    viewport: "1280x800",
    buildMode: "production",
    cache: "fresh browser context per route",
    server: "vite preview",
  };
  await browser.close();
  const output = { schemaVersion: 1, measuredAt: new Date().toISOString(), environment, routes: results };
  if (writeReceipt) {
    const receipt = {
      schemaVersion: 1,
      measuredAt: output.measuredAt,
      environment,
      derivation: "Protected Studio routes measured zero renderer/navigation chunks, and viewer routes measured zero marketing-image requests after route hydration; zero is each boundary tripwire. Route bytes and timings are receipts, not CI limits.",
      routes: Object.fromEntries(results.map((result) => {
        const definition = routeDefinitions.find((candidate) => candidate.id === result.id);
        return [result.id, {
          measuredFrontendEncodedBodyBytes: result.frontendEncodedBodyBytes,
          measuredFrontendTransferredBytes: result.frontendTransferredBytes,
          maxForbiddenChunkCount: definition?.protected ? 0 : null,
          maxUnexpectedMarketingAssetCount: definition?.protected ? null : 0,
          measuredChunks: result.chunks,
          measuredChunkIdentities: result.chunkIdentities,
          measuredUnexpectedMarketingAssets: result.unexpectedMarketingAssets,
          measuredTiming: result.timing,
        }];
      })),
    };
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  } else {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    const failures = audit(results, receipt);
    if (failures.length) {
      for (const failure of failures) console.error(`frontend-route-audit: ${failure}`);
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify(output, null, 2));
} finally {
  preview.kill("SIGTERM");
}
