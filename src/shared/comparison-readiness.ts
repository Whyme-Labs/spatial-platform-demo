export const comparisonModes = ["visual", "authored_geometry", "raw"] as const;

export type ComparisonMode = typeof comparisonModes[number];

export type ComparisonModeEligibility = {
  eligible: boolean;
  reasons: string[];
};

export type ComparisonVersionReadiness = {
  versionId: string;
  versionNumber: number;
  modes: Record<ComparisonMode, ComparisonModeEligibility>;
};

export type ComparisonEligiblePair = {
  leftVersionId: string;
  rightVersionId: string;
  modes: ComparisonMode[];
};

export type ComparisonReadiness = {
  available: boolean;
  eligiblePairs: ComparisonEligiblePair[];
  versions: ComparisonVersionReadiness[];
};

export type ComparisonVersionEvidence = {
  versionId: string;
  versionNumber: number;
  verifiedWebScene: boolean;
  approvedNavigation: boolean;
  reviewedMetricStructure: boolean;
  verifiedSourcePointCloud: boolean;
  registrationEvidence: boolean;
};

export function comparisonReadiness(
  evidence: readonly ComparisonVersionEvidence[],
): ComparisonReadiness {
  const versions = evidence.map((version): ComparisonVersionReadiness => ({
    versionId: version.versionId,
    versionNumber: version.versionNumber,
    modes: {
      visual: eligibility([
        [version.verifiedWebScene, "verified_web_scene_missing"],
        [version.approvedNavigation, "approved_navigation_missing"],
      ]),
      authored_geometry: eligibility([
        [version.reviewedMetricStructure, "reviewed_metric_structure_missing"],
      ]),
      raw: eligibility([
        [version.verifiedSourcePointCloud, "verified_source_point_cloud_missing"],
        [version.registrationEvidence, "registration_evidence_missing"],
      ]),
    },
  }));
  const eligiblePairs: ComparisonEligiblePair[] = [];
  for (let leftIndex = 0; leftIndex < versions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < versions.length; rightIndex += 1) {
      const left = versions[leftIndex]!;
      const right = versions[rightIndex]!;
      const modes = comparisonModes.filter((mode) =>
        left.modes[mode].eligible && right.modes[mode].eligible
      );
      if (modes.length) {
        eligiblePairs.push({
          leftVersionId: left.versionId,
          rightVersionId: right.versionId,
          modes,
        });
      }
    }
  }
  return { available: eligiblePairs.length > 0, eligiblePairs, versions };
}

export function comparisonVersionIdsForMode(
  readiness: ComparisonReadiness,
  mode: ComparisonMode,
): Set<string> {
  return new Set(readiness.eligiblePairs.flatMap((pair) =>
    pair.modes.includes(mode) ? [pair.leftVersionId, pair.rightVersionId] : []
  ));
}

export function comparisonModeAvailable(
  readiness: ComparisonReadiness,
  mode: ComparisonMode,
): boolean {
  return readiness.eligiblePairs.some((pair) => pair.modes.includes(mode));
}

function eligibility(
  requirements: ReadonlyArray<readonly [satisfied: boolean, reason: string]>,
): ComparisonModeEligibility {
  const reasons = requirements.flatMap(([satisfied, reason]) => satisfied ? [] : [reason]);
  return { eligible: reasons.length === 0, reasons };
}
