export type ComparisonWorkspaceSection = "compare" | "expert";

export function comparisonWorkspaceAvailable(versionCount: number): boolean {
  return versionCount >= 2;
}

export function resolveComparisonWorkspaceSection<T extends string>(
  requestedSection: T,
  versionCount: number,
): T | ComparisonWorkspaceSection {
  return requestedSection === "compare" && !comparisonWorkspaceAvailable(versionCount)
    ? "expert"
    : requestedSection;
}
