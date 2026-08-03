import { describe, expect, it } from "vitest";
import { sceneAuthoringOverlaySegments } from "../src/renderer/scene-authoring-overlay";

describe("render-native structural overlay", () => {
  it("projects every level and semantic opening into the registered render frame", () => {
    const segments = sceneAuthoringOverlaySegments({
      levels: [{
        elevationM: 3,
        rooms: [{ points: [[0, 0], [2, 0], [2, 2], [0, 2]] }],
        walls: [{ start: [0, 0], end: [2, 0] }],
        openings: [
          { type: "door", start: [0.5, 0], end: [1, 0] },
          { type: "window", start: [1, 0], end: [1.5, 0] },
          { type: "unknown", start: [1.5, 0], end: [2, 0] },
        ],
      }],
      connectors: [{ points: [[1, 0, 1], [1, 3, 1], [2, 3, 1], [2, 0, 1]] }],
    });

    expect(segments.filter((segment) => segment.kind === "room")).toHaveLength(4);
    expect(segments).toContainEqual({ kind: "wall", start: [0, 3, 0], end: [2, 3, 0] });
    expect(segments.map((segment) => segment.kind)).toEqual(expect.arrayContaining([
      "door", "window", "unknown-opening", "connector",
    ]));
    expect(segments.filter((segment) => segment.kind === "connector")).toHaveLength(4);
  });

  it("ignores malformed overlay geometry instead of emitting non-finite WebGL buffers", () => {
    expect(sceneAuthoringOverlaySegments({
      levels: [{ elevationM: 0, rooms: [{ points: [[0, 0], [1, Number.NaN]] }] }],
    })).toEqual([]);
  });
});
