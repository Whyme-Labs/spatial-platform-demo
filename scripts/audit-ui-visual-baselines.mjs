import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RESPONSIVE_VISUAL_VIEWPORTS } from "../e2e/helpers/visual-matrix.ts";

const root = process.cwd();
const manifestPath = path.join(root, "e2e/visual-baselines.sha256");
const manifest = new Map(
  fs.readFileSync(manifestPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
      if (!match) throw new Error(`Invalid visual-baseline manifest line: ${line}`);
      return [match[2], match[1]];
    }),
);

const actualFiles = recursivelyList(path.join(root, "e2e"))
  .filter((file) => /-snapshots\/.*\.png$/.test(file))
  .map((file) => path.relative(root, file))
  .sort();
const expectedFiles = [...manifest.keys()].sort();
const errors = [];

if (actualFiles.join("\n") !== expectedFiles.join("\n")) {
  errors.push("visual baseline manifest and committed PNG inventory differ");
}

let totalBytes = 0;
for (const relativePath of actualFiles) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  totalBytes += bytes.byteLength;
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (manifest.get(relativePath) !== digest) {
    errors.push(`${relativePath}: SHA-256 differs from e2e/visual-baselines.sha256`);
  }
}

for (const viewport of RESPONSIVE_VISUAL_VIEWPORTS) {
  for (const relativePath of [
    `e2e/ui-quality.spec.ts-snapshots/studio-projects-${viewport.name}.png`,
    `e2e/published-viewer.spec.ts-snapshots/viewer-ready-${viewport.name}.png`,
  ]) {
    if (!manifest.has(relativePath)) {
      errors.push(`${relativePath}: required responsive baseline is missing`);
    }
  }
}

for (const relativePath of [
  "e2e/published-viewer.spec.ts-snapshots/viewer-loading-phone.png",
  "e2e/published-viewer.spec.ts-snapshots/viewer-navigator-short-landscape.png",
  "e2e/release-access-code.spec.ts-snapshots/viewer-access-error-small-phone.png",
  "e2e/ui-quality.spec.ts-snapshots/studio-empty-projects-standard-laptop.png",
  "e2e/ui-quality.spec.ts-snapshots/studio-inline-validation-phone.png",
  "e2e/ui-quality.spec.ts-snapshots/studio-long-error-dialog-short-height.png",
  "e2e/ui-quality.spec.ts-snapshots/studio-maximum-records-standard-laptop.png",
  "e2e/ui-quality.spec.ts-snapshots/studio-processing-pending-phone.png",
  "e2e/ui-quality.spec.ts-snapshots/studio-session-loading-standard-laptop.png",
]) {
  if (!manifest.has(relativePath)) {
    errors.push(`${relativePath}: required state baseline is missing`);
  }
}

if (errors.length) {
  console.error("Visual-baseline audit failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Visual-baseline audit passed for ${actualFiles.length} reviewed PNGs (${totalBytes} bytes).`,
  );
}

function recursivelyList(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return recursivelyList(absolutePath);
    return entry.isFile() ? [absolutePath] : [];
  });
}
