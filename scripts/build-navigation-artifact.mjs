#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  buildRecastNavigationArtifact,
  extractCollisionGeometryFromGlb,
} from "./navigation-build-core.mjs";
import {
  validateAuthoredTraversals,
  validatePhysicalNavigation,
  validateStructuralNavigation,
} from "./physical-navigation-validation.mjs";

const [collisionArgument, configArgument, outputArgument] = process.argv.slice(2);
if (!collisionArgument || !configArgument || !outputArgument) {
  throw new Error(
    "Usage: node scripts/build-navigation-artifact.mjs <collision.glb> <config.json> <output-directory>",
  );
}

const collisionPath = resolve(collisionArgument);
const configPath = resolve(configArgument);
const outputDirectory = resolve(outputArgument);
const collisionBytes = await readFile(collisionPath);
const config = JSON.parse(await readFile(configPath, "utf8"));
const geometry = await extractCollisionGeometryFromGlb(collisionBytes);
const sha256 = createHash("sha256").update(collisionBytes).digest("hex");
const authoringHash = config.source?.authoringHash ?? createHash("sha256")
  .update(JSON.stringify({
    authoring: config.authoring ?? null,
    agent: config.agent,
    destinations: config.destinations ?? [],
    offMeshConnections: config.offMeshConnections ?? [],
    obstacles: config.obstacleBoxes ?? [],
    structuralGeometry: geometry.structuralGeometry ?? null,
    dynamicBarriers: geometry.dynamicBarriers ?? [],
  }))
  .digest("hex");
const artifact = await buildRecastNavigationArtifact({
  ...config,
  positions: geometry.positions,
  indices: geometry.indices,
  ...(geometry.collisionSemantics
    ? {
        collisionSemantics: geometry.collisionSemantics,
        dynamicBarriers: geometry.dynamicBarriers,
        ...(geometry.structuralGeometry
          ? { structuralGeometry: geometry.structuralGeometry }
          : {}),
      }
    : {}),
  source: {
    ...config.source,
    assetId: config.source?.assetId ?? basename(collisionPath),
    sha256,
    authoringHash,
  },
});
artifact.physicalValidation = await validatePhysicalNavigation({
  artifact,
  positions: geometry.positions,
  indices: geometry.indices,
  obstacleBoxes: config.obstacleBoxes ?? [],
});
if (artifact.schemaVersion === "spatial-navigation-v8") {
  artifact.authoredTraversalValidation = await validateAuthoredTraversals({
    artifact,
    positions: geometry.positions,
    indices: geometry.indices,
    obstacleBoxes: config.obstacleBoxes ?? [],
  });
}
if (["spatial-navigation-v7", "spatial-navigation-v8"].includes(artifact.schemaVersion)) {
  artifact.structuralValidation = await validateStructuralNavigation({
    artifact,
    positions: geometry.positions,
    indices: geometry.indices,
    ignoredMeshCount: geometry.ignoredMeshCount,
  });
}
const binary = Uint8Array.from(
  atob(artifact.detour.bytesBase64),
  (character) => character.charCodeAt(0),
);
await mkdir(outputDirectory, { recursive: true });
const binaryPath = join(outputDirectory, "navigation.detour.bin");
const reportPath = join(outputDirectory, "navigation-artifact.json");
await writeFile(binaryPath, binary, { mode: 0o600 });
await writeFile(reportPath, `${JSON.stringify({
  ...artifact,
  source: { ...artifact.source, fileName: basename(collisionPath), meshCount: geometry.meshCount },
}, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({
  status: "passed",
  collisionPath,
  collisionSha256: sha256,
  sourceTriangles: geometry.indices.length / 3,
  navigationTriangles: artifact.navMesh.indices.length / 3,
  componentCount: artifact.validation.componentCount,
  destinationCount: artifact.validation.destinationCount,
  physicalRouteCount: artifact.physicalValidation.routeCount,
  binaryPath,
  reportPath,
}, null, 2));
