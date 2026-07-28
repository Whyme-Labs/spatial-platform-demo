import { describe, expect, it } from "vitest";
import { computeAuthoredGeometryChange } from "../src/worker/geometry-change";

const box = (
  id: string,
  label: string,
  min: [number, number, number],
  max: [number, number, number],
) => ({
  id,
  kind: "room",
  label,
  geometry_json: JSON.stringify({ type: "box", points: [min, max] }),
});

describe("authored geometry change evidence", () => {
  it("matches normalized room labels and reports metric and visual evidence", () => {
    const report = computeAuthoredGeometryChange({
      fromVersion: { id: "from", versionNumber: 1 },
      toVersion: { id: "to", versionNumber: 2 },
      fromEntities: [
        box("a", "Gallery A", [0, 0, 0], [4, 5, 3]),
        box("b", "Removed room", [8, 0, 0], [10, 2, 3]),
      ],
      toEntities: [
        box("c", " gallery   a ", [0.1, 0, 0], [4.1, 5, 3]),
        box("d", "Added room", [12, 0, 0], [14, 3, 3]),
      ],
      thresholdMm: 50,
      coordinateAssurance: "shared_local_frame",
      registrationEvidence: "Both versions use the same surveyed project origin.",
    });

    expect(report.method).toBe("authored-plan-geometry-diff-v1");
    expect(report.result).toBe("changes_detected");
    expect(report.summary).toMatchObject({
      comparable: 1,
      changed: 1,
      unchanged: 0,
      added: 1,
      removed: 1,
      maxDeviationMm: 100,
    });
    expect(report.comparisons[0]).toMatchObject({
      label: "Gallery A",
      classification: "changed",
      centroidDisplacementMm: 100,
      boundaryDeviationMm: 100,
    });
    expect(report.visual).toMatchObject({
      coordinatePlane: "XZ",
      units: "metres",
    });
    expect(report.visual.overlays).toHaveLength(3);
  });

  it("does not claim a metric result when correspondence is ambiguous", () => {
    const report = computeAuthoredGeometryChange({
      fromVersion: { id: "from", versionNumber: 1 },
      toVersion: { id: "to", versionNumber: 2 },
      fromEntities: [
        box("a", "Room", [0, 0, 0], [2, 2, 3]),
        box("b", "room", [4, 0, 0], [6, 2, 3]),
      ],
      toEntities: [box("c", "Room", [0, 0, 0], [2, 2, 3])],
      thresholdMm: 20,
      coordinateAssurance: "registered_project_frame",
      registrationEvidence: "Independent control confirms the registered frame.",
    });

    expect(report.result).toBe("insufficient_correspondence");
    expect(report.blockers).toContain("Duplicate from-version semantic key: room:room");
    expect(report.summary.comparable).toBe(0);
  });

  it("rejects invalid geometry instead of silently treating it as unchanged", () => {
    const report = computeAuthoredGeometryChange({
      fromVersion: { id: "from", versionNumber: 1 },
      toVersion: { id: "to", versionNumber: 2 },
      fromEntities: [{
        id: "a",
        kind: "room",
        label: "Broken",
        geometry_json: JSON.stringify({ type: "box", points: [[0, 0, 0], [0, 2, 3]] }),
      }],
      toEntities: [box("b", "Broken", [0, 0, 0], [2, 2, 3])],
      thresholdMm: 20,
      coordinateAssurance: "shared_local_frame",
      registrationEvidence: "Both versions use the same local project origin.",
    });

    expect(report.result).toBe("insufficient_correspondence");
    expect(report.invalidGeometry).toEqual([
      expect.objectContaining({ version: "from", label: "Broken" }),
    ]);
  });
});
