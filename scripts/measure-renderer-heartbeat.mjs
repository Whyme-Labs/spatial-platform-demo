#!/usr/bin/env node
// Measures the real post-ready heartbeat cadence of the built Spark renderer
// in headless Chromium, for the heartbeat/liveness capacity receipt. It mounts
// the same authored-collision walking fixture as e2e/movement-integrity.spec.ts
// so ready means movement-ready, then records every heartbeat arrival for the
// requested window and reports inter-arrival gap statistics.
//
// Usage (after `npm run build:e2e`):
//   node scripts/measure-renderer-heartbeat.mjs [--seconds 65] [--port 8793]
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { SpzWriter } from "@sparkjsdev/spark";
import { buildAuthoredStructuralCollisionGlb } from "./authored-collision.mjs";
import {
  buildRecastNavigationArtifact,
  extractCollisionGeometryFromGlb,
} from "./navigation-build-core.mjs";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? Number(args[index + 1]) : fallback;
};
const measureSeconds = argValue("--seconds", 65);
const port = argValue("--port", 8793);
const origin = `http://127.0.0.1:${port}`;

async function minimalSpz() {
  const writer = new SpzWriter({ numSplats: 4, shDegree: 0, flagAntiAlias: false });
  const centres = [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]];
  centres.forEach(([x, y, z], index) => {
    writer.setCenter(index, x, y, z);
    writer.setAlpha(index, 1);
    writer.setRgb(index, 0.5, 0.5, 0.5);
    writer.setScale(index, -2, -2, -2);
    writer.setQuat(index, 0, 0, 0, 1);
  });
  return writer.finalize();
}

async function buildFixture() {
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
    dynamicBarrierBoxes: [],
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
      assetId: "fixture-heartbeat-receipt",
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

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await delay(250);
  }
  throw new Error(`vite preview did not answer at ${url}`);
}

const preview = spawn("npx", [
  "vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort",
], { stdio: "ignore" });
try {
  await waitForServer(`${origin}/`);
  const fixture = await buildFixture();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route("**/asset/fixture-heartbeat-receipt.glb", (route) => route.fulfill({
    status: 200,
    contentType: "model/gltf-binary",
    body: Buffer.from(fixture.collision),
  }));
  await page.route("**/asset/test-scene.spz", (route) => route.fulfill({
    status: 200,
    contentType: "application/octet-stream",
    body: Buffer.from(fixture.scene),
  }));
  await page.route("**/e2e/heartbeat-host.html", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      #renderer { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
    </style><script>
      window.__heartbeatsMs = [];
      window.__readyAtMs = null;
      window.addEventListener("message", (event) => {
        if (!event.data || event.data.source !== "spatial-spark") return;
        if (event.data.type === "ready") window.__readyAtMs = performance.now();
        if (event.data.type === "heartbeat") window.__heartbeatsMs.push(performance.now());
      });
    </script><iframe id="renderer" title="Heartbeat receipt"
      src="/renderer/index.html?content=/asset/test-scene.spz&format=spz&camera=1,1.6,2&target=7,1.6,2"></iframe>`,
  }));
  await page.goto(`${origin}/e2e/heartbeat-host.html`);
  await page.evaluate((artifact) => {
    const renderer = document.querySelector("#renderer")?.contentWindow;
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
      collisionUrl: "/asset/fixture-heartbeat-receipt.glb",
      defaultMovementMode: "walk",
    }, location.origin);
  }, fixture.navigationArtifact);
  const readyDeadline = Date.now() + 30_000;
  while (Date.now() < readyDeadline) {
    if (await page.evaluate(() => window.__readyAtMs !== null)) break;
    await delay(250);
  }
  if (!(await page.evaluate(() => window.__readyAtMs !== null))) {
    throw new Error("renderer never posted ready");
  }
  await delay(measureSeconds * 1000);
  const { readyAtMs, heartbeatsMs } = await page.evaluate(() => ({
    readyAtMs: window.__readyAtMs,
    heartbeatsMs: window.__heartbeatsMs,
  }));
  await browser.close();
  const gaps = heartbeatsMs.map((at, index) =>
    index === 0 ? at - readyAtMs : at - heartbeatsMs[index - 1]
  );
  const sorted = [...gaps].sort((a, b) => a - b);
  console.log(JSON.stringify({
    measureSeconds,
    heartbeats: heartbeatsMs.length,
    firstAfterReadyMs: Math.round(gaps[0]),
    minGapMs: Math.round(sorted[0]),
    maxGapMs: Math.round(sorted[sorted.length - 1]),
    meanGapMs: Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length),
  }, null, 2));
} finally {
  preview.kill("SIGTERM");
}
