import { describe, expect, it } from "vitest";
import {
  comparisonModeAvailable,
  comparisonReadiness,
  comparisonVersionIdsForMode,
} from "../src/shared/comparison-readiness";

describe("comparison readiness", () => {
  it("stays unavailable when two versions have no shared eligible mode", () => {
    const readiness = comparisonReadiness([
      evidence("version-1", 1, { visual: true }),
      evidence("version-2", 2, { authoredGeometry: true }),
    ]);

    expect(readiness.available).toBe(false);
    expect(readiness.eligiblePairs).toEqual([]);
  });

  it("records every shared mode and explains exclusions per version", () => {
    const readiness = comparisonReadiness([
      evidence("version-1", 1, {
        visual: true,
        authoredGeometry: true,
        raw: true,
      }),
      evidence("version-2", 2, { visual: true, raw: true }),
      evidence("version-3", 3, {}),
    ]);

    expect(readiness.available).toBe(true);
    expect(readiness.eligiblePairs).toEqual([
      {
        leftVersionId: "version-1",
        rightVersionId: "version-2",
        modes: ["visual", "raw"],
      },
    ]);
    expect(readiness.versions[2]?.modes.visual).toEqual({
      eligible: false,
      reasons: ["verified_web_scene_missing", "approved_navigation_missing"],
    });
    expect(comparisonModeAvailable(readiness, "authored_geometry")).toBe(false);
    expect([...comparisonVersionIdsForMode(readiness, "raw")]).toEqual([
      "version-1",
      "version-2",
    ]);
  });
});

function evidence(
  versionId: string,
  versionNumber: number,
  modes: { visual?: boolean; authoredGeometry?: boolean; raw?: boolean },
) {
  return {
    versionId,
    versionNumber,
    verifiedWebScene: Boolean(modes.visual),
    approvedNavigation: Boolean(modes.visual),
    reviewedMetricStructure: Boolean(modes.authoredGeometry),
    verifiedSourcePointCloud: Boolean(modes.raw),
    registrationEvidence: Boolean(modes.raw),
  };
}
