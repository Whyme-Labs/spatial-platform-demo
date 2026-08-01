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
if (inspection.primaryRegionCount > 0) {
  const artifact = spatial && typeof spatial === "object"
    ? Reflect.get(spatial, "navigationArtifact")
    : null;
  const assets = spatial && typeof spatial === "object"
    ? Reflect.get(spatial, "navigationAssets")
    : null;
  const source = artifact && typeof artifact === "object"
    ? Reflect.get(artifact, "source")
    : null;
  const artifactEvidence = assets && typeof assets === "object"
    ? Reflect.get(assets, "artifact")
    : null;
  const detourEvidence = assets && typeof assets === "object"
    ? Reflect.get(assets, "detour")
    : null;
  if (
    !artifact || typeof artifact !== "object" ||
    !source || typeof source !== "object" ||
    !assets || typeof assets !== "object" ||
    !validFrozenDerivative(artifactEvidence, "json") ||
    !validFrozenDerivative(detourEvidence, "bin")
  ) {
    console.error("Navigation verification failed: immutable artifact or derivative evidence is missing.");
    process.exit(1);
  }
  if (Reflect.get(source, "authoringHash") !== Reflect.get(assets, "authoringHash")) {
    console.error("Navigation verification failed: derivative evidence does not match the authored scene.");
    process.exit(1);
  }
  console.log(JSON.stringify({
    navigationSchema: Reflect.get(artifact, "schemaVersion"),
    collisionSha256: Reflect.get(source, "sha256"),
    navigationAuthoringHash: Reflect.get(assets, "authoringHash"),
    navigationArtifactSha256: Reflect.get(artifactEvidence as object, "sha256"),
    detourSha256: Reflect.get(detourEvidence as object, "sha256"),
  }, null, 2));
}
console.log(
  inspection.primaryRegionCount === 0
    ? "Navigation verification passed: visual-only release."
    : `Navigation verification passed: ${inspection.primaryRegionCount} regions in one component.`,
);

function validFrozenDerivative(value: unknown, format: "json" | "bin"): value is object {
  return Boolean(
    value && typeof value === "object" &&
    Reflect.get(value, "format") === format &&
    typeof Reflect.get(value, "assetId") === "string" &&
    /^[a-f0-9]{64}$/i.test(String(Reflect.get(value, "sha256") ?? "")) &&
    Number.isSafeInteger(Reflect.get(value, "sizeBytes")) &&
    Number(Reflect.get(value, "sizeBytes")) > 0,
  );
}
