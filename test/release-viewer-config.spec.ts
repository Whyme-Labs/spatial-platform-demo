import { describe, expect, it } from "vitest";
import { parseSceneRotationDegrees } from "../src/shared/scene-rotation";
import {
  hasAuthoredSpatialRuntime,
  RELEASE_COUPLED_SPATIAL_COLLECTIONS,
} from "../src/shared/spatial-release-guard";

describe("parseSceneRotationDegrees", () => {
  it("omits the renderer transform when the authored rotation is the identity", () => {
    expect(parseSceneRotationDegrees(["0", "0", "0"])).toBeUndefined();
  });

  it("preserves a non-zero authored scene-frame rotation", () => {
    expect(parseSceneRotationDegrees(["0", "0", "180"])).toEqual([0, 0, 180]);
  });

  it.each([
    [["not-a-number", "0", "0"], "finite numbers"],
    [["0", "0", "361"], "between -360 and 360"],
  ] as const)("rejects invalid values %#", (values, message) => {
    expect(() => parseSceneRotationDegrees(values)).toThrow(message);
  });
});

describe("hasAuthoredSpatialRuntime", () => {
  it("treats every public spatial collection as release-coupled", () => {
    for (const key of RELEASE_COUPLED_SPATIAL_COLLECTIONS) {
      expect(hasAuthoredSpatialRuntime({ [key]: [{ id: "authored" }] })).toBe(true);
    }
  });

  it("accepts an empty visual-only spatial snapshot", () => {
    expect(hasAuthoredSpatialRuntime({
      entities: [],
      routes: [],
      routeStops: [],
      navigationObstacles: [],
    })).toBe(false);
  });
});
