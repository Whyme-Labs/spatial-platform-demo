import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientShellUrl = new URL("../src/client/studio.ts", import.meta.url);
const clientDomainUrl = new URL("../src/client/studio/stages/compare.ts", import.meta.url);
const workerShellUrl = new URL("../src/worker/index.ts", import.meta.url);
const workerDomainUrl = new URL("../src/worker/routes/comparison.ts", import.meta.url);
const inventoryUrl = new URL("../scripts/user-facing-inventory.mjs", import.meta.url);

test("Compare owns its complete client behavior and contracts", async () => {
  const [shell, domain] = await Promise.all([
    readFile(clientShellUrl, "utf8"),
    readFile(clientDomainUrl, "utf8"),
  ]);
  for (const ownedSymbol of [
    "loadVersionComparison",
    "generateChangeReport",
    "pollRawSceneChange",
    "reviewRawSceneChangeReport",
  ]) {
    assert.equal(shell.includes(ownedSymbol), false, `${ownedSymbol} leaked back into the Studio shell`);
    assert.equal(domain.includes(ownedSymbol), true, `${ownedSymbol} is missing from the Compare domain`);
  }
  assert.doesNotMatch(shell, /^type RegisteredSceneChangeReport\s*=/m);
  assert.match(domain, /^export type RegisteredSceneChangeReport\s*=/m);
  assert.match(shell, /compareDomain\.renderStage/);
  assert.match(domain, /export function createCompareDomain/);
});

test("Compare owns its complete Worker route surface", async () => {
  const [shell, domain] = await Promise.all([
    readFile(workerShellUrl, "utf8"),
    readFile(workerDomainUrl, "utf8"),
  ]);
  for (const route of [
    "/api/projects/:projectId/versions/compare",
    "/api/projects/:projectId/spatial/change-reports",
    "/api/projects/:projectId/spatial/raw-change-reports",
    "/comparison-asset/:projectId/:versionId/:assetId/:fileName",
  ]) {
    assert.equal(shell.includes(route), false, `${route} leaked back into the Worker shell`);
    assert.equal(domain.includes(route), true, `${route} is missing from the comparison route module`);
  }
  assert.match(shell, /registerComparisonRoutes\(app/);
  assert.match(domain, /export function registerComparisonRoutes/);
});

test("acceptance inventory follows the extracted Compare surfaces", async () => {
  const inventory = await readFile(inventoryUrl, "utf8");
  assert.match(inventory, /src\/client\/studio\/stages\/compare\.ts/);
  assert.match(inventory, /src\/worker\/routes\/comparison\.ts/);
});
