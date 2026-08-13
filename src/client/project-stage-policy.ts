import type { ComparisonReadiness } from "../shared/comparison-readiness";

export type ComparisonWorkspaceSection = "compare" | "expert";

export function comparisonWorkspaceAvailable(readiness: ComparisonReadiness): boolean {
  return readiness.available && readiness.eligiblePairs.length > 0;
}

export function resolveComparisonWorkspaceSection<T extends string>(
  requestedSection: T,
  readiness: ComparisonReadiness,
): T | ComparisonWorkspaceSection {
  return requestedSection === "compare" && !comparisonWorkspaceAvailable(readiness)
    ? "expert"
    : requestedSection;
}
