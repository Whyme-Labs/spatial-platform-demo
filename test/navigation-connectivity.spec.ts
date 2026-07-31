import { describe, expect, it } from "vitest";
import {
  inspectWalkableConnectivity,
  type WalkableSnapshotEntity,
} from "../src/shared/navigation-connectivity";

function polygonEntity(
  id: string,
  kind: "floor" | "room" | "doorway",
  label: string,
  points: Array<[number, number, number]>,
): WalkableSnapshotEntity {
  return {
    id,
    kind,
    label,
    geometry_json: JSON.stringify({ type: "polygon", points }),
  };
}

describe("published walkable connectivity", () => {
  it("reports the current multi-room authoring shape as two disconnected components", () => {
    const entities = [
      polygonEntity("main", "floor", "Walk zone 1 - main room", [
        [-0.6, 0.15, -4], [6.4, 0.15, -4], [6.4, 0.15, 0.8], [-0.6, 0.15, 0.8],
      ]),
      polygonEntity("far", "floor", "Walk zone 2 - far room", [
        [0.3, 0.25, -13], [5.5, 0.25, -13], [5.5, 0.25, -10.7], [0.3, 0.25, -10.7],
      ]),
      polygonEntity("side-a", "floor", "Walk zone 3 - side room", [
        [-4.4, 0.2, -1.2], [-2.1, 0.2, -1.2], [-2.1, 0.2, 1.1], [-4.4, 0.2, 1.1],
      ]),
      polygonEntity("side-b", "floor", "Walk zone 4 - side room", [
        [-8.1, 0.2, -2.4], [-5.5, 0.2, -2.4], [-5.5, 0.2, 0.9], [-8.1, 0.2, 0.9],
      ]),
      polygonEntity("main-side", "doorway", "Main to side connector", [
        [-2.25, 0.15, -1.2], [-0.45, 0.15, -1.2], [-0.45, 0.15, -0.55], [-2.25, 0.15, -0.55],
      ]),
      polygonEntity("side-side", "doorway", "Side to side connector", [
        [-5.7, 0.2, -0.85], [-4.2, 0.2, -0.85], [-4.2, 0.2, -0.3], [-5.7, 0.2, -0.3],
      ]),
    ];

    expect(inspectWalkableConnectivity(entities)).toMatchObject({
      primaryRegionCount: 4,
      connectorCount: 2,
      componentCount: 2,
      components: [
        { regionIds: ["main", "side-a", "side-b"] },
        { regionIds: ["far"] },
      ],
    });
  });

  it("accepts the same scene after an authored traversal connector joins the far room", () => {
    const entities = [
      polygonEntity("main", "floor", "Main room", [
        [0, 0.15, -4], [6.4, 0.15, -4], [6.4, 0.15, 0], [0, 0.15, 0],
      ]),
      polygonEntity("far", "floor", "Far room", [
        [0.3, 0.25, -13], [5.5, 0.25, -13], [5.5, 0.25, -10.7], [0.3, 0.25, -10.7],
      ]),
      polygonEntity("far-connector", "doorway", "Provisional far-room traversal connector", [
        [4.8, 0.15, -11.3], [6, 0.15, -11.3], [6, 0.15, -2.8], [4.8, 0.15, -2.8],
      ]),
    ];

    expect(inspectWalkableConnectivity(entities)).toMatchObject({
      primaryRegionCount: 2,
      connectorCount: 1,
      componentCount: 1,
      components: [{ regionIds: ["main", "far"] }],
    });
  });

  it("does not reject visual-only or single-region releases", () => {
    expect(inspectWalkableConnectivity([])).toMatchObject({
      primaryRegionCount: 0,
      componentCount: 0,
    });
    expect(inspectWalkableConnectivity([
      polygonEntity("room", "room", "Only room", [
        [0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4],
      ]),
    ])).toMatchObject({
      primaryRegionCount: 1,
      componentCount: 1,
    });
  });
});
