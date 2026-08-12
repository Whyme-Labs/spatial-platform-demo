import { describe, expect, it } from "vitest";
import {
  comparisonWorkspaceAvailable,
  resolveComparisonWorkspaceSection,
} from "../src/client/project-stage-policy";

describe("conditional comparison workspace policy", () => {
  it("keeps comparison in Expert until two immutable versions exist", () => {
    expect(comparisonWorkspaceAvailable(0)).toBe(false);
    expect(comparisonWorkspaceAvailable(1)).toBe(false);
    expect(resolveComparisonWorkspaceSection("compare", 1)).toBe("expert");
  });

  it("exposes the dedicated Compare stage once comparison is meaningful", () => {
    expect(comparisonWorkspaceAvailable(2)).toBe(true);
    expect(resolveComparisonWorkspaceSection("compare", 2)).toBe("compare");
    expect(resolveComparisonWorkspaceSection("privacy", 2)).toBe("privacy");
  });
});
