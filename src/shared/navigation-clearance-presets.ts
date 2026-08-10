export const navigationClearancePresetIds = [
  "approved-scene",
  "ada-route-review",
  "custom",
] as const;

export type NavigationClearancePresetId = typeof navigationClearancePresetIds[number];

// US Access Board route minima converted exactly from inches. This is a
// conservative geometry-review aid, not an accessibility certification: a
// complete review still includes doors, turns, passing space, landings,
// surfaces, controls, and the applicable local standard.
export const adaRouteReviewClearance = Object.freeze({
  agentRadius: 0.4572,
  maxStepMetres: 0.0127,
  maxSlopeDegrees: Math.atan(1 / 12) * 180 / Math.PI,
});

export function navigationClearancePresetSummary(
  preset: NavigationClearancePresetId,
): string {
  if (preset === "ada-route-review") {
    return "Checks a 0.9144 m route width, 0.0127 m threshold, and 1:12 ramp slope. This geometry aid is not an accessibility certification.";
  }
  if (preset === "custom") {
    return "Uses the expert clearance values below. Record the scene evidence that justifies every override.";
  }
  return "Keeps the clearance profile already approved for this immutable scene version.";
}
