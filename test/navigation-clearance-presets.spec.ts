import { describe, expect, it } from "vitest";
import {
  adaRouteReviewClearance,
  navigationClearancePresetSummary,
} from "../src/shared/navigation-clearance-presets";

describe("navigation clearance presets", () => {
  it("converts the receipted route, threshold, and ramp values", () => {
    expect(adaRouteReviewClearance.agentRadius * 2).toBeCloseTo(36 * 0.0254, 10);
    expect(adaRouteReviewClearance.maxStepMetres).toBeCloseTo(0.5 * 0.0254, 10);
    expect(adaRouteReviewClearance.maxSlopeDegrees)
      .toBeCloseTo(Math.atan(1 / 12) * 180 / Math.PI, 10);
  });

  it("states that the review preset is not certification", () => {
    expect(navigationClearancePresetSummary("ada-route-review"))
      .toContain("not an accessibility certification");
  });
});
