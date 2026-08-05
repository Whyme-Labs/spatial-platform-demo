import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareShellToCapture } from "../scripts/shell-capture-agreement.mjs";

// Every other acceptance check reads the shell against itself, so a wall
// authored across an opening the capture shows satisfies all of them. These
// cover the disagreement the walker actually feels, and the two innocent shapes
// that must not be reported the same way.

function wallPoints(from, to, { gapFrom = null, gapTo = null, step = 0.05 } = {}) {
  const points = [];
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.round(length / step);
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const x = from[0] + (to[0] - from[0]) * t;
    const z = from[1] + (to[1] - from[1]) * t;
    const along = length * t;
    if (gapFrom !== null && along >= gapFrom && along <= gapTo) continue;
    for (const y of [1.1, 1.4, 1.7, 1.95]) points.push([x, y, z]);
  }
  return points;
}

describe("shell capture agreement", () => {
  it("reports a barrier crossing capture that shows a way through", () => {
    // A six metre wall the capture shows open between 2.5 m and 3.7 m: a
    // doorway the shell paved over, which is exactly what trapped a visitor.
    const report = compareShellToCapture({
      authoring: {
        barrierSegments: [{ id: "wall-a", start: [0, 0], end: [6, 0], minY: 0.15, maxY: 3 }],
      },
      points: wallPoints([0, 0], [6, 0], { gapFrom: 2.5, gapTo: 3.7 }),
    });

    const crossings = report.findings.filter((f) => f.kind === "barrier_crosses_open_capture");
    assert.equal(crossings.length, 1);
    assert.equal(crossings[0].barrierId, "wall-a");
    assert.ok(crossings[0].metres >= 0.8, `expected a doorway-sized run, got ${crossings[0].metres}`);
    assert.ok(crossings[0].from[0] >= 2.3 && crossings[0].to[0] <= 3.9);
  });

  it("stays silent on a barrier the capture supports along its length", () => {
    const report = compareShellToCapture({
      authoring: {
        barrierSegments: [{ id: "wall-a", start: [0, 0], end: [6, 0], minY: 0.15, maxY: 3 }],
      },
      points: wallPoints([0, 0], [6, 0]),
    });

    assert.deepEqual(report.findings, []);
  });

  it("separates an unscanned barrier from one crossing an opening", () => {
    // The edge of the authored region has no capture anywhere along it. That is
    // worth surfacing, but it is not a wall standing in a visible doorway, and
    // reporting both the same way would bury the one that traps a walker.
    const report = compareShellToCapture({
      authoring: {
        barrierSegments: [{ id: "wall-edge", start: [0, 5], end: [6, 5], minY: 0.15, maxY: 3 }],
      },
      points: wallPoints([0, 0], [6, 0]),
    });

    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].kind, "barrier_without_any_capture");
  });

  it("skips jambs and reveals too short to carry their own evidence", () => {
    const report = compareShellToCapture({
      authoring: {
        barrierSegments: [{ id: "reveal", start: [0, 0], end: [0, 0.3], minY: 0.15, maxY: 3 }],
      },
      points: [],
    });

    assert.deepEqual(report.findings, []);
    assert.equal(report.inspectedBarrierCount, 0);
  });

  it("ranks barriers crossing open capture above unscanned ones", () => {
    const report = compareShellToCapture({
      authoring: {
        barrierSegments: [
          { id: "wall-edge", start: [0, 5], end: [9, 5], minY: 0.15, maxY: 3 },
          { id: "wall-doorway", start: [0, 0], end: [6, 0], minY: 0.15, maxY: 3 },
        ],
      },
      points: wallPoints([0, 0], [6, 0], { gapFrom: 2.5, gapTo: 3.7 }),
    });

    assert.ok(report.findings.length >= 2);
    assert.equal(report.findings[0].kind, "barrier_crosses_open_capture");
    assert.equal(report.findings[0].barrierId, "wall-doorway");
  });

  it("keeps its limitations attached to the report", () => {
    const report = compareShellToCapture({
      authoring: { barrierSegments: [] },
      points: [],
    });

    assert.equal(report.schemaVersion, "shell-capture-agreement-v1");
    assert.ok(report.limitations.some((line) => /glass|mirror|occlusion/i.test(line)));
  });
});
