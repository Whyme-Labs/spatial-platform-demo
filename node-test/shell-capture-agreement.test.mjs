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

  it("reads a thick wall's support at its faces, keeping the crossing release-blocking", () => {
    // A 0.8 m wall's scanned faces sit 0.4 m from the recorded centreline —
    // outside the 0.25 m centreline radius. A comparator blind to the faces
    // sees "no support anywhere" and demotes the doorway crossing to the
    // informational barrier_without_any_capture, evading the mandatory gate.
    const faceOffset = 0.4;
    const points = [
      ...wallPoints([0, faceOffset], [6, faceOffset], { gapFrom: 2.5, gapTo: 3.7 }),
      ...wallPoints([0, -faceOffset], [6, -faceOffset], { gapFrom: 2.5, gapTo: 3.7 }),
    ];
    const thick = compareShellToCapture({
      authoring: {
        barrierSegments: [{
          id: "thick-wall",
          start: [0, 0],
          end: [6, 0],
          minY: 0.15,
          maxY: 3,
          thicknessM: 0.8,
        }],
      },
      points,
    });
    const crossings = thick.findings.filter((f) => f.kind === "barrier_crosses_open_capture");
    assert.equal(crossings.length, 1);
    assert.equal(crossings[0].barrierId, "thick-wall");
    assert.ok(crossings[0].from[0] >= 2.3 && crossings[0].to[0] <= 3.9);

    // The same geometry without its thickness is the failure the fix removes:
    // the centreline radius sees nothing and the crossing degrades to the
    // informational kind.
    const blind = compareShellToCapture({
      authoring: {
        barrierSegments: [{ id: "thick-wall", start: [0, 0], end: [6, 0], minY: 0.15, maxY: 3 }],
      },
      points,
    });
    assert.equal(
      blind.findings.filter((f) => f.kind === "barrier_crosses_open_capture").length,
      0,
    );
    assert.ok(blind.findings.some((f) => f.kind === "barrier_without_any_capture"));
  });

  it("refuses slab-interior clutter as thick-wall support", () => {
    // A scanner cannot see inside a real wall, so dense points running along
    // the CENTRELINE of a claimed 0.8 m wall are clutter in open space the
    // wall was wrongly drawn across — not evidence of the wall. With both
    // faces absent, every span must stay unsupported and the whole barrier
    // reads as standing in unscanned space.
    const report = compareShellToCapture({
      authoring: {
        barrierSegments: [{
          id: "hollow-claim",
          start: [0, 0],
          end: [6, 0],
          minY: 0.15,
          maxY: 3,
          thicknessM: 0.8,
        }],
      },
      points: wallPoints([0, 0], [6, 0]),
    });
    assert.equal(
      report.findings.filter((f) => f.kind === "barrier_crosses_open_capture").length,
      0,
    );
    assert.ok(report.findings.some((f) =>
      f.kind === "barrier_without_any_capture" && f.barrierId === "hollow-claim"));
  });

  it("does not let one scanned patch vouch for a doorway further along a thick wall", () => {
    // Support exists only on the first two metres of the wall's faces; the
    // rest is open. Per-span longitudinal evaluation must keep the empty run
    // reported instead of smearing the patch along the wall.
    const faceOffset = 0.3;
    const points = [
      ...wallPoints([0, faceOffset], [2, faceOffset]),
      ...wallPoints([0, -faceOffset], [2, -faceOffset]),
      ...wallPoints([5.4, faceOffset], [6, faceOffset]),
      ...wallPoints([5.4, -faceOffset], [6, -faceOffset]),
    ];
    const report = compareShellToCapture({
      authoring: {
        barrierSegments: [{
          id: "patched-wall",
          start: [0, 0],
          end: [6, 0],
          minY: 0.15,
          maxY: 3,
          thicknessM: 0.6,
        }],
      },
      points,
    });
    const crossings = report.findings.filter((f) => f.kind === "barrier_crosses_open_capture");
    assert.equal(crossings.length, 1);
    assert.ok(crossings[0].metres >= 2.5, `expected the long open run, got ${crossings[0].metres}`);
  });
});
