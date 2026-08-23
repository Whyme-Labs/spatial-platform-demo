// Wayfinder surfacing (#35): what the conservative sealed-by-default policy
// and the machine trajectory evidence each did to an approved revision. The
// sealed-cost line exists precisely because an operator who approves a noisy
// proposal untouched otherwise never learns what those unresolved openings
// cost; the machine lines make trajectory-attested structure visible with
// its ratification path. Renders from frozen revision data only.
export function wayfinderRevisionSummaryLines(revision: {
  plan_json: string;
  trajectory_evidence_json?: string | null;
}): Array<{ tone: "machine" | "sealed"; text: string }> {
  let unknownOpeningCount = 0;
  try {
    const plan = JSON.parse(revision.plan_json) as {
      levels?: Array<{ openings?: Array<{ type?: string }> }>;
    };
    for (const level of plan.levels ?? []) {
      for (const opening of level.openings ?? []) {
        if (opening?.type === "unknown") unknownOpeningCount += 1;
      }
    }
  } catch {
    return [];
  }
  let autoOpened: Array<{ openingId: string; roomIds?: string[] }> = [];
  let demotedWalls: Array<{ wallId: string; crossingCount?: number; roomId?: string }> = [];
  let trajectorySha: string | null = null;
  if (revision.trajectory_evidence_json) {
    try {
      const frozen = JSON.parse(revision.trajectory_evidence_json) as {
        evidence?: { trajectory?: { sha256?: string } };
        qualifiedOpenings?: Array<{ openingId: string; roomIds?: string[] }>;
        demotedWalls?: Array<{ wallId: string; crossingCount?: number; roomId?: string }>;
      };
      autoOpened = frozen.qualifiedOpenings ?? [];
      demotedWalls = frozen.demotedWalls ?? [];
      trajectorySha = frozen.evidence?.trajectory?.sha256 ?? null;
    } catch {
      return [{
        tone: "machine",
        text: "Trajectory auto-open evidence is frozen but unreadable — public exposure is blocked until this revision is re-reviewed.",
      }];
    }
  }
  const lines: Array<{ tone: "machine" | "sealed"; text: string }> = [];
  if (autoOpened.length || demotedWalls.length) {
    const parts: string[] = [];
    if (autoOpened.length) {
      parts.push(`${autoOpened.length} opening${autoOpened.length === 1 ? "" : "s"} opened (${
        autoOpened.slice(0, 4).map((opening) =>
          opening.roomIds?.length === 2
            ? `${opening.openingId}: ${opening.roomIds[0]} ↔ ${opening.roomIds[1]}`
            : opening.openingId).join("; ")
      }${autoOpened.length > 4 ? "; …" : ""})`);
    }
    if (demotedWalls.length) {
      parts.push(`${demotedWalls.length} clutter wall${demotedWalls.length === 1 ? "" : "s"} removed (${
        demotedWalls.slice(0, 4).map((wall) =>
          `${wall.wallId}${wall.crossingCount ? ` · passed through ${wall.crossingCount}×` : ""}`)
          .join("; ")
      }${demotedWalls.length > 4 ? "; …" : ""})`);
    }
    lines.push({
      tone: "machine",
      text: `Machine-attested walkability · trajectory ${trajectorySha ? `${trajectorySha.slice(0, 12)}… ` : ""}— ${
        parts.join(" · ")
      }. Correct any of these in a structure draft if the capture disagrees.`,
    });
  }
  const sealedRemaining = Math.max(0, unknownOpeningCount - autoOpened.length);
  if (sealedRemaining > 0) {
    lines.push({
      tone: "sealed",
      text: `${sealedRemaining} unresolved opening${sealedRemaining === 1 ? "" : "s"} remain${sealedRemaining === 1 ? "s" : ""} sealed by the conservative default — walkable space behind them is excluded. Classify genuine doorways in the Structure workspace to open them.`,
    });
  }
  return lines;
}
