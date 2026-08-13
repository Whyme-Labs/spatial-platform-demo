import { describe, expect, it } from "vitest";
import {
  comparisonWorkspaceAvailable,
  resolveComparisonWorkspaceSection,
} from "../src/client/project-stage-policy";

const unavailable = {
  available: false,
  eligiblePairs: [],
  versions: [],
} as const;

const visualPair = {
  available: true,
  eligiblePairs: [{
    leftVersionId: "version-1",
    rightVersionId: "version-2",
    modes: ["visual" as const],
  }],
  versions: [],
} as const;

describe("conditional comparison workspace policy", () => {
  it("keeps comparison in Expert until two immutable versions exist", () => {
    expect(comparisonWorkspaceAvailable(unavailable)).toBe(false);
    expect(resolveComparisonWorkspaceSection("compare", unavailable)).toBe("expert");
  });

  it("exposes the dedicated Compare stage only for a server-qualified pair", () => {
    expect(comparisonWorkspaceAvailable(visualPair)).toBe(true);
    expect(resolveComparisonWorkspaceSection("compare", visualPair)).toBe("compare");
    expect(resolveComparisonWorkspaceSection("privacy", visualPair)).toBe("privacy");
  });
});
