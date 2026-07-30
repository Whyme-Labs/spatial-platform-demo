import { describe, expect, it } from "vitest";
import {
  isNavigationPointAllowed,
  isNavigationTransitionAllowed,
  nearestNavigationPoint,
  parseNavigationRuntimeMessage,
  transformSourceDirection,
  transformSourcePoint,
  type NavigationRuntime,
  type SourceToWorldTransform,
} from "../src/shared/navigation-runtime";

describe("v5 source-to-world normalization", () => {
  it("normalizes a Z-up source into the canonical Y-up world before scale and translation", () => {
    const transform: SourceToWorldTransform = {
      sourceUpAxis: "Z",
      worldUnit: "scene_units",
      metresPerSourceUnit: 2,
      yawDegrees: 0,
      translationMetres: [10, 20, 30],
    };

    expect(transformSourcePoint([1, 2, 3], transform)).toEqual([12, 26, 26]);
    expect(transformSourceDirection([0, 0, 1], transform)).toEqual([0, 1, 0]);
  });

  it("applies world yaw after up-axis normalization", () => {
    const transform: SourceToWorldTransform = {
      sourceUpAxis: "Y",
      metresPerSourceUnit: 1,
      yawDegrees: 90,
      translationMetres: [0, 0, 0],
    };

    const point = transformSourcePoint([1, 0, 0], transform);
    expect(point[0]).toBeCloseTo(0, 10);
    expect(point[1]).toBe(0);
    expect(point[2]).toBeCloseTo(-1, 10);
  });
});

describe("v5 navigation enforcement", () => {
  const runtime: NavigationRuntime = {
    navigationMesh: {
      vertices: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 1],
        [0, 0, 1],
        [0, 0, 4],
        [1, 0, 4],
        [1, 0, 1],
      ],
      indices: [
        0, 1, 2,
        0, 2, 3,
        3, 6, 5,
        3, 5, 4,
      ],
    },
    obstacleBoxes: [],
    profile: {
      worldUnit: "scene_units",
      agentRadius: 0.2,
      agentHeight: 1.8,
      eyeHeight: 1.6,
      maxStepMetres: 0.1,
    },
  };

  it("uses authored triangles rather than the mesh bounding box", () => {
    expect(isNavigationPointAllowed([3, 1.6, 0.5], runtime)).toBe(true);
    expect(isNavigationPointAllowed([0.5, 1.6, 3], runtime)).toBe(true);
    expect(isNavigationPointAllowed([3, 1.6, 3], runtime)).toBe(false);
  });

  it("inflates obstacles by the authored agent radius", () => {
    const withObstacle: NavigationRuntime = {
      ...runtime,
      obstacleBoxes: [{
        entityId: "table",
        min: [1.5, 0, 0.2],
        max: [2.5, 0.9, 0.8],
      }],
    };

    expect(isNavigationPointAllowed([1.35, 1.6, 0.5], withObstacle)).toBe(false);
    expect(isNavigationPointAllowed([1.1, 1.6, 0.5], withObstacle)).toBe(true);
  });

  it("samples the whole transition so a large frame step cannot tunnel through an obstacle", () => {
    const withObstacle: NavigationRuntime = {
      ...runtime,
      obstacleBoxes: [{
        entityId: "partition",
        min: [1.9, 0, 0],
        max: [2.1, 2.4, 1],
      }],
    };

    expect(isNavigationTransitionAllowed(
      [1, 1.6, 0.5],
      [3, 1.6, 0.5],
      withObstacle,
    )).toBe(false);
  });

  it("anchors an invalid camera position onto a clearance-safe point on the mesh", () => {
    const anchored = nearestNavigationPoint([3, 1.6, 3], runtime);

    expect(anchored).not.toBeNull();
    expect(isNavigationPointAllowed(anchored!, runtime)).toBe(true);
    expect(Math.hypot(anchored![0] - 3, anchored![2] - 3)).toBeLessThan(3);
  });

  it("anchors camera height to the authored floor instead of permitting flight over obstacles", () => {
    expect(isNavigationPointAllowed([3, 9, 0.5], runtime)).toBe(false);

    const anchored = nearestNavigationPoint([3, 9, 0.5], runtime);
    expect(anchored?.[1]).toBeCloseTo(1.6, 6);
    expect(isNavigationPointAllowed(anchored!, runtime)).toBe(true);
  });

  it("accepts the published host-to-renderer runtime contract", () => {
    const parsed = parseNavigationRuntimeMessage({
      source: "spatial-host",
      type: "set-spatial-runtime",
      navigationMesh: runtime.navigationMesh,
      obstacleBoxes: [{
        entityId: "table",
        min: [1.5, 0, 0.2],
        max: [2.5, 0.9, 0.8],
      }],
      navigationProfile: runtime.profile,
    });

    expect(parsed).toEqual({
      navigationMesh: runtime.navigationMesh,
      obstacleBoxes: [{
        entityId: "table",
        min: [1.5, 0, 0.2],
        max: [2.5, 0.9, 0.8],
      }],
      profile: runtime.profile,
    });
  });
});
