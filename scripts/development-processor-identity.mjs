#!/usr/bin/env node
// Non-production external-worker identity helper. Production workers must use
// an immutable OCI digest from their deployment system because host binaries,
// shared libraries, and browser packages are outside this source checkout.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const scopeIndex = process.argv.indexOf("--scope");
const scope = scopeIndex >= 0 ? process.argv[scopeIndex + 1] : null;
if (scope !== "development" && scope !== "staging") {
  throw new Error(
    "processor_identity_scope must be development or staging; production external workers must inject the immutable OCI image digest from their deployment system",
  );
}
const buildInputs = [
  "package.json",
  "package-lock.json",
  "src/shared/processor-identity.ts",
  "scripts/processing-agent.mjs",
  "scripts/processing-agent-core.mjs",
  "scripts/poster-quality.mjs",
  "scripts/navigation-build-core.mjs",
  "scripts/physical-navigation-validation.mjs",
  "scripts/authored-collision.mjs",
  "scripts/automatic-spatial-pipeline.mjs",
  "scripts/horizontal-surface.mjs",
  "scripts/e57-structure-core.mjs",
  "scripts/shell-capture-agreement.mjs",
  "scripts/capture-compatibility-contract.mjs",
  "scripts/capture-compatibility-core.mjs",
];
const dirty = execFileSync(
  "git",
  ["status", "--porcelain=v1", "--untracked-files=all", "--", ...buildInputs],
  { cwd: repositoryRoot, encoding: "utf8" },
).trim();
if (dirty) {
  throw new Error(`Commit processor build inputs before deriving identity:\n${dirty}`);
}
const agentBuildSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim().toLowerCase();
const digest = createHash("sha256");
for (const input of buildInputs) {
  const bytes = readFileSync(resolve(repositoryRoot, input));
  digest.update(`${input}\u0000${bytes.byteLength}\u0000`);
  digest.update(bytes);
}
const identitySource = readFileSync(
  resolve(repositoryRoot, "src/shared/processor-identity.ts"),
  "utf8",
);
const capabilities = Array.from(
  identitySource.matchAll(/\{ jobType: "([^"]+)", contractVersion: "([^"]+)" \}/g),
  (match) => ({ jobType: match[1], contractVersion: match[2] }),
);
if (capabilities.length === 0) throw new Error("No processor capabilities were declared");
process.stdout.write(JSON.stringify({
  agentBuildSha,
  // Non-production external workers have no OCI image. This field contains the
  // deterministic digest of the exact repository package inputs listed above.
  imageDigest: `sha256:${digest.digest("hex")}`,
  protocolVersion: "spatial-processor-lease/1",
  capabilities,
}));
