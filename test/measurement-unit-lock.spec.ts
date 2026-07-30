import { describe, expect, it } from "vitest";
import workerSource from "../src/worker/index.ts?raw";

function workerRoute(start: string, end: string): string {
  const startIndex = workerSource.indexOf(start);
  const endIndex = workerSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return workerSource.slice(startIndex, endIndex);
}

describe("measurement evidence unit lock", () => {
  it("creates a measurement brief with one guarded write", () => {
    const route = workerRoute(
      'app.post("/api/projects/:projectId/measurement/briefs"',
      'app.post("/api/projects/:projectId/measurement/briefs/:briefId/check-points"',
    );

    expect(route).not.toContain("isMetricSpatialVersion(");
    expect(route).toMatch(
      /INSERT INTO measurement_briefs[\s\S]*SELECT[\s\S]*scene_navigation_profiles[\s\S]*scene_entities[\s\S]*scene_navigation_obstacles[\s\S]*RETURNING id/,
    );
  });

  it("guards checkpoint insertion against provisional spatial state", () => {
    const route = workerRoute(
      'app.post("/api/projects/:projectId/measurement/briefs/:briefId/check-points"',
      'app.post("/api/projects/:projectId/measurement/briefs/:briefId/qa-report"',
    );

    expect(route).toMatch(
      /INSERT INTO measurement_check_points[\s\S]*SELECT[\s\S]*scene_navigation_profiles[\s\S]*scene_entities[\s\S]*scene_navigation_obstacles[\s\S]*RETURNING id/,
    );
  });
});
