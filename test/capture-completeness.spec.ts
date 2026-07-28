import { describe, expect, it } from "vitest";
import { computeCaptureCompleteness } from "../src/worker/capture-completeness";

const room = (
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

const defaults = {
  version: { id: "00000000-0000-4000-8000-000000000001", versionNumber: 1 },
  source: {
    adapter: "open-import",
    fileName: "trajectory.json",
    format: "canonical_pose_json_v1" as const,
    coordinateFrame: "project-local-y-up",
    alignmentEvidence: "Operator aligned the trajectory and authored rooms to the same local frame.",
  },
  parameters: {
    coverageRadiusM: 1.25,
    maximumSampleGapM: 3,
    loopClosureRadiusM: 1,
    minimumRoomCoveragePercent: 85,
    verticalToleranceM: 0.5,
  },
};

describe("capture completeness evidence", () => {
  it("marks a closed, dense trajectory as complete and returns an XZ evidence overlay", () => {
    const points = [
      [0.5, 1.5, 0.5],
      [2, 1.5, 0.5],
      [3.5, 1.5, 0.5],
      [3.5, 1.5, 2],
      [3.5, 1.5, 3.5],
      [2, 1.5, 3.5],
      [0.5, 1.5, 3.5],
      [0.5, 1.5, 2],
      [0.5, 1.5, 0.5],
    ] as Array<[number, number, number]>;

    const report = computeCaptureCompleteness({
      ...defaults,
      rooms: [room("room-a", "Gallery A", [0, 0, 0], [4, 3, 4])],
      points: points.map((position, index) => ({ position, timestampMs: index * 1000 })),
    });

    expect(report.result).toBe("complete");
    expect(report.summary).toMatchObject({
      roomCount: 1,
      roomsMeetingCoverage: 1,
      loopClosed: true,
      maximumGapM: 1.5,
    });
    expect(report.rooms[0]).toMatchObject({
      label: "Gallery A",
      classification: "covered",
    });
    expect(report.rooms[0]!.coveragePercent).toBeGreaterThanOrEqual(85);
    expect(report.visual).toMatchObject({
      coordinatePlane: "XZ",
      units: "metres",
    });
    expect(report.visual.trajectory).toHaveLength(points.length);
    expect(report.limitation).toContain("does not prove image sharpness");
  });

  it("requires recapture when an authored room is not traversed", () => {
    const report = computeCaptureCompleteness({
      ...defaults,
      rooms: [
        room("room-a", "Gallery A", [0, 0, 0], [4, 3, 4]),
        room("room-b", "Gallery B", [8, 0, 0], [12, 3, 4]),
      ],
      points: [
        { position: [0.5, 1.5, 0.5] },
        { position: [2, 1.5, 0.5] },
        { position: [3.5, 1.5, 0.5] },
        { position: [3.5, 1.5, 2] },
        { position: [3.5, 1.5, 3.5] },
        { position: [2, 1.5, 3.5] },
        { position: [0.5, 1.5, 3.5] },
        { position: [0.5, 1.5, 2] },
        { position: [0.5, 1.5, 0.5] },
      ],
    });

    expect(report.result).toBe("recapture_required");
    expect(report.summary.roomsBelowCoverage).toBe(1);
    expect(report.rooms.find((item) => item.label === "Gallery B")).toMatchObject({
      classification: "recapture",
      sampleCount: 0,
      coveragePercent: 0,
    });
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "room_below_coverage",
      severity: "blocker",
      roomLabel: "Gallery B",
    }));
    expect(report.visual.blindSpots.length).toBeGreaterThan(0);
  });

  it("returns insufficient evidence rather than guessing when no valid authored rooms exist", () => {
    const report = computeCaptureCompleteness({
      ...defaults,
      rooms: [],
      points: [
        { position: [0, 1.5, 0] },
        { position: [5, 1.5, 0] },
      ],
    });

    expect(report.result).toBe("insufficient_evidence");
    expect(report.blockers).toContain("No valid authored room footprints were available");
    expect(report.summary.maximumGapM).toBe(5);
  });

  it("blocks a complete conclusion when an active authored room has invalid geometry", () => {
    const report = computeCaptureCompleteness({
      ...defaults,
      rooms: [
        room("room-a", "Gallery A", [0, 0, 0], [4, 3, 4]),
        {
          id: "room-invalid",
          kind: "room",
          label: "Broken room",
          geometry_json: JSON.stringify({ type: "polygon", points: [[0, 0, 0], [0, 0, 0]] }),
        },
      ],
      points: [
        { position: [0.5, 1.5, 0.5] },
        { position: [2, 1.5, 0.5] },
        { position: [3.5, 1.5, 0.5] },
        { position: [3.5, 1.5, 3.5] },
        { position: [0.5, 1.5, 3.5] },
        { position: [0.5, 1.5, 0.5] },
      ],
    });

    expect(report.result).toBe("insufficient_evidence");
    expect(report.blockers).toContain("1 authored room footprint(s) were invalid");
    expect(report.invalidRooms).toContainEqual(expect.objectContaining({
      entityId: "room-invalid",
      label: "Broken room",
    }));
  });
});
