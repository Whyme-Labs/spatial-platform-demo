import { describe, expect, it } from "vitest";
import {
  applyRenderNativeFloorplanCorrection,
  type EditableFloorplan,
} from "../src/client/render-native-floorplan";

function twoLevelPlan(): EditableFloorplan {
  const level = (id: string, label: string, elevationM: number) => ({
    id,
    label,
    elevationM,
    ceilingElevationM: elevationM + 2.8,
    rooms: [{
      id: `${id}-room`,
      label: `${label} room`,
      points: [[0, 0], [6, 0], [6, 6], [0, 6]] as Array<[number, number]>,
    }],
    walls: [{
      id: `${id}-wall`,
      label: `${label} wall`,
      start: [0, 0] as [number, number],
      end: [6, 0] as [number, number],
      thicknessM: 0.2,
      heightM: 2.8,
    }],
    openings: [],
  });
  return {
    schemaVersion: "1.0.0",
    units: "metres",
    coordinateFrame: "registered_y_up_metric_frame",
    levels: [level("ground", "Ground", 0), level("upper", "Upper", 3)],
    connectors: [],
  };
}

describe("render-native floor-plan corrections", () => {
  it("places rendered wall and window marks on their actual upper level", () => {
    const plan = twoLevelPlan();
    const wall = applyRenderNativeFloorplanCorrection(
      plan,
      "wall",
      [[1, 3.2, 2], [5, 3.2, 2]],
      () => "upper-wall-mark",
    );
    const window = applyRenderNativeFloorplanCorrection(
      wall.plan,
      "window",
      [[2, 4.1, 2], [3, 4.1, 2]],
      () => "upper-window-mark",
    );

    expect(window.plan.levels[0]!.walls).toHaveLength(1);
    expect(window.plan.levels[1]!.walls.at(-1)).toMatchObject({ id: "upper-wall-mark" });
    expect(window.plan.levels[1]!.openings.at(-1)).toMatchObject({
      id: "upper-window-mark",
      type: "window",
      wallId: "upper-wall-mark",
    });
  });

  it("binds a rendered ramp to the closest lower and upper levels", () => {
    const result = applyRenderNativeFloorplanCorrection(
      twoLevelPlan(),
      "ramp",
      [[2, 0, 1], [3, 0, 1], [3, 3, 5], [2, 3, 5]],
      () => "rendered-ramp",
    );

    expect(result.plan.connectors).toEqual([expect.objectContaining({
      id: "rendered-ramp",
      type: "ramp",
      lowerLevelId: "ground",
      upperLevelId: "upper",
    })]);
  });

  it("removes the nearest opening before a coincident wall or room", () => {
    const plan = twoLevelPlan();
    plan.levels[0]!.openings.push({
      id: "wrong-gap",
      label: "Wrong gap",
      type: "unknown",
      wallId: "ground-wall",
      start: [2, 0],
      end: [3, 0],
      widthM: 1,
      heightM: null,
    });

    const result = applyRenderNativeFloorplanCorrection(
      plan,
      "remove",
      [[2.5, 0, 0]],
    );

    expect(result.affectedId).toBe("wrong-gap");
    expect(result.plan.levels[0]!.openings).toEqual([]);
    expect(result.plan.levels[0]!.walls).toHaveLength(1);
    expect(result.plan.levels[0]!.rooms).toHaveLength(1);
  });
});
