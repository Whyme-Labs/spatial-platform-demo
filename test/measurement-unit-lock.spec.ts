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
    expect(route.match(/INSERT INTO measurement_briefs/g)).toHaveLength(1);
    expect(route).toContain("const eligibilityResults = await context.env.DB.batch([");
    expect(route).toContain(
      "WHERE (? <> 'project_verified' OR ${recognizedMeasurementRegistrationPredicateSql})",
    );
    expect(route).toContain("AND ${metricSpatialVersionPredicateSql}");
    expect(workerSource).toMatch(
      /const metricSpatialVersionPredicateSql[\s\S]*scene_navigation_profiles[\s\S]*scene_entities[\s\S]*scene_navigation_obstacles/,
    );
    expect(workerSource).toMatch(
      /const recognizedMeasurementRegistrationPredicateSql[\s\S]*review_generation[\s\S]*canonical_manifest_json[\s\S]*source_provenance_json/,
    );
    expect(route).toMatch(
      /registration_eligible[\s\S]*if \(registrationGuard\)[\s\S]*registration evidence changed during creation[\s\S]*recognized processor-qualified/,
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
