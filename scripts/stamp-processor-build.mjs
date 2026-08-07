// Write a unique stamp file into the processor build context before every
// image build. Three production deploys once rebuilt a byte-identical image
// from a poisoned layer cache and silently skipped the push, leaving
// production validating with week-old pipeline code; a stamp layer ahead of
// the script COPYs makes every deploy's image provably fresh.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

let revision = "unknown";
try {
  revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  // Building outside a checkout still deserves a unique stamp.
}
const stamp = `${revision} ${new Date().toISOString()}\n`;
writeFileSync(new URL("../processor/.build-stamp", import.meta.url), stamp);
console.log(`processor build stamp: ${stamp.trim()}`);
