import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("new broad registration gates require an explicit assurance review", async () => {
  const sourceRoot = new URL("../src/", import.meta.url);
  const sourceFiles = await recursivelyListTypeScript(sourceRoot);
  const broadGateLocations = [];
  let workerSource = "";
  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    if (file.pathname.endsWith("/worker/index.ts")) workerSource = source;
    if (file.pathname.endsWith("/shared/paired-capture-journey.ts")) continue;
    const callCount = source.match(/pairedCaptureJourneyHasAcceptedRegistration\(/g)?.length ?? 0;
    for (let index = 0; index < callCount; index += 1) broadGateLocations.push(file.pathname);
  }
  assert.equal(
    broadGateLocations.length,
    2,
    `A new accepted-registration call must be reviewed and replaced with a typed assurance requirement for any higher-reliance capability. Calls: ${broadGateLocations.join(", ")}`,
  );
  assert.match(workerSource, /pairedCaptureJourneyMeetsAssurance\(/);
});

async function recursivelyListTypeScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await recursivelyListTypeScript(child));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(child);
  }
  return files;
}
