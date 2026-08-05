#!/usr/bin/env node
/**
 * Reads a reviewed structural shell back against the capture it models.
 *
 *   node scripts/verify-shell-capture-agreement.mjs <authoring.json> <capture.ply> [report.json]
 *
 * Exits non-zero when a barrier crosses capture that shows a way through, which
 * is the shape that stops a visitor in a doorway the scene plainly renders.
 * Barriers with no capture behind them anywhere are reported but do not fail:
 * that is usually the edge of the authored region, not a wall in a doorway.
 */
import { readFile, writeFile } from "node:fs/promises";
import { compareShellToCapture } from "./shell-capture-agreement.mjs";

const [authoringPath, capturePath, reportPath] = process.argv.slice(2);
if (!authoringPath || !capturePath) {
  console.error(
    "usage: verify-shell-capture-agreement.mjs <authoring.json> <capture.ply> [report.json]",
  );
  process.exit(2);
}

const WALL_BAND_MIN = 0.9;
const WALL_BAND_MAX = 2.1;

/** Reads xyz from a binary little-endian Gaussian PLY, keeping the wall band. */
function readGaussianPlyWallBand(bytes, { opacityFloor = 0.3, stride = 3 } = {}) {
  const headerEnd = bytes.indexOf("end_header\n");
  if (headerEnd < 0) throw new Error(`${capturePath}: not a PLY with an ASCII header`);
  const header = bytes.subarray(0, headerEnd).toString("utf8");
  if (!/format binary_little_endian/.test(header)) {
    throw new Error(`${capturePath}: only binary little-endian PLY is supported`);
  }
  const vertexCount = Number(/element vertex (\d+)/.exec(header)?.[1] ?? 0);
  const properties = [...header.matchAll(/property float (\S+)/g)].map((match) => match[1]);
  if (!vertexCount || properties.length < 3) throw new Error(`${capturePath}: unreadable PLY header`);
  const recordLength = properties.length * 4;
  const opacityIndex = properties.indexOf("opacity");
  const start = headerEnd + "end_header\n".length;
  const points = [];
  for (let index = 0; index < vertexCount; index += stride) {
    const at = start + index * recordLength;
    if (at + recordLength > bytes.length) break;
    if (opacityIndex >= 0 && bytes.readFloatLE(at + opacityIndex * 4) < opacityFloor) continue;
    const y = bytes.readFloatLE(at + 4);
    if (y < WALL_BAND_MIN || y > WALL_BAND_MAX) continue;
    points.push([bytes.readFloatLE(at), y, bytes.readFloatLE(at + 8)]);
  }
  return points;
}

const authoring = JSON.parse(await readFile(authoringPath, "utf8"));
const points = readGaussianPlyWallBand(await readFile(capturePath));
const report = compareShellToCapture({
  authoring: authoring.barrierSegments ? authoring : authoring.authoring ?? authoring,
  points,
});

const crossings = report.findings.filter((f) => f.kind === "barrier_crosses_open_capture");
const unscanned = report.findings.filter((f) => f.kind !== "barrier_crosses_open_capture");

console.log(JSON.stringify({
  event: "shell.capture_agreement",
  authoringPath,
  capturePath,
  capturePointsInBand: report.capturePointsInBand,
  inspectedBarrierCount: report.inspectedBarrierCount,
  barrierCrossesOpenCapture: crossings.length,
  barrierWithoutCapture: unscanned.length,
}, null, 2));

for (const finding of crossings) {
  console.log(
    `  crosses open capture: ${finding.barrierId} ${finding.metres} m ` +
    `${JSON.stringify(finding.from)}..${JSON.stringify(finding.to)}`,
  );
}
for (const finding of unscanned) {
  console.log(`  ${finding.kind}: ${finding.barrierId} ${finding.metres} m`);
}

if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (crossings.length) {
  console.error(
    `\n${crossings.length} reviewed barrier span(s) stand where the capture shows a way ` +
    "through. Confirm each against the render before publishing.",
  );
  process.exit(1);
}
