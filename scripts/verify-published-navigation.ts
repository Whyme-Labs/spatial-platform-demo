import { inspectWalkableConnectivity } from "../src/shared/navigation-connectivity.ts";

const manifestUrl = process.argv[2];
if (!manifestUrl) {
  console.error("Usage: npm run verify:navigation -- <published-manifest-url>");
  process.exit(2);
}

const response = await fetch(manifestUrl, {
  headers: { accept: "application/json" },
});
if (!response.ok) {
  console.error(`Could not load ${manifestUrl}: HTTP ${response.status}`);
  process.exit(2);
}

const manifest = await response.json() as Record<string, unknown>;
const spatial = Reflect.get(manifest, "spatial");
const entities = spatial && typeof spatial === "object"
  ? Reflect.get(spatial, "entities")
  : null;
const inspection = inspectWalkableConnectivity(Array.isArray(entities) ? entities : []);

console.log(JSON.stringify(inspection, null, 2));
if (inspection.componentCount > 1) {
  console.error(
    `Navigation verification failed: ${inspection.componentCount} disconnected components.`,
  );
  process.exit(1);
}
console.log(
  inspection.primaryRegionCount === 0
    ? "Navigation verification passed: visual-only release."
    : `Navigation verification passed: ${inspection.primaryRegionCount} regions in one component.`,
);
