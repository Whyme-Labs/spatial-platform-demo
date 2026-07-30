import { describe, expect, it } from "vitest";
import { triangulateWalkablePolygon } from "../src/worker";

function triangleArea(
  points: Array<[number, number, number]>,
  first: number,
  second: number,
  third: number,
): number {
  const a = points[first]!;
  const b = points[second]!;
  const c = points[third]!;
  return Math.abs(
    (b[0] - a[0]) * (c[2] - a[2]) -
    (b[2] - a[2]) * (c[0] - a[0]),
  ) / 2;
}

describe("authored walkable polygon triangulation", () => {
  it("triangulates a valid occupancy outline with a repeated pinch-point vertex", () => {
    const points: Array<[number, number, number]> = [
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 2],
      [1, 0, 2],
      [1, 0, 3],
      [3, 0, 3],
      [3, 0, 5],
      [1, 0, 5],
      [1, 0, 3],
      [0, 0, 3],
    ];

    const indices = triangulateWalkablePolygon(points);

    expect(indices).toHaveLength(18);
    const area = Array.from({ length: indices.length / 3 }, (_, triangle) =>
      triangleArea(
        points,
        indices[triangle * 3]!,
        indices[triangle * 3 + 1]!,
        indices[triangle * 3 + 2]!,
      )).reduce((sum, value) => sum + value, 0);
    expect(area).toBe(9);
  });

  it("preserves a pinch-point hole instead of filling it as walkable", () => {
    const points: Array<[number, number, number]> = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, 4],
      [0, 0, 4],
      [0, 0, 2],
      [1, 0, 2],
      [2, 0, 2],
      [2, 0, 1],
      [1, 0, 1],
      [1, 0, 2],
      [0, 0, 2],
    ];

    const indices = triangulateWalkablePolygon(points);
    const area = Array.from({ length: indices.length / 3 }, (_, triangle) =>
      triangleArea(
        points,
        indices[triangle * 3]!,
        indices[triangle * 3 + 1]!,
        indices[triangle * 3 + 2]!,
      )).reduce((sum, value) => sum + value, 0);

    expect(indices.length).toBeGreaterThan(0);
    expect(area).toBe(15);
  });
});
