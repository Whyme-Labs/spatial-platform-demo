// What a stopped walker is told, and why. Pure mapping with no engine
// dependencies, so every verdict is pinned by direct unit fixtures.
//
// Walk has three authorities that can refuse a step, and from inside the
// scene they are indistinguishable — the walker simply stops. They call for
// opposite responses, so the message has to name which one acted:
//
//   a reviewed barrier   the capsule touched geometry the cook kept
//   the walking map      Detour clamped the step before the capsule moved
//   the captured floor   there is no cooked ground to stand on beyond here
//
// Only the last is beyond any policy: no amount of opening or demoting
// geometry reaches ground the scanner never walked.

export type BlockedMovementBarrier = {
  id: string;
  kind: "dynamic" | "structural" | "solid_furniture" | "no_go";
};

export type BlockedMovementCauseKind =
  | BlockedMovementBarrier["kind"]
  | "navigation_map_clearance"
  | "capture_edge"
  | "unsupported_floor"
  | "outside_recovery_bounds"
  | "unknown";

export type BlockedMovementCause = {
  kind: BlockedMovementCauseKind;
  id: string | null;
};

export function blockedMovementMessage(
  blocker: BlockedMovementBarrier | null,
  cause: BlockedMovementCauseKind | null = null,
): string {
  if (blocker) return blockedBarrierMessage(blocker);
  // The walking map stops Walk before the capsule touches anything, so these
  // two cover the commonest stops in a cluttered capture.
  if (cause === "navigation_map_clearance") {
    return "Stopped by the walking map · captured floor continues here, " +
      "but the map holds agent clearance away from nearby walls";
  }
  // A step refused for want of support produces no contact at all. Calling
  // that "no reviewed opening" sends an operator hunting for a wall that is
  // not there; it is the edge of the capture, and only re-scanning moves it.
  if (cause === "capture_edge" || cause === "unsupported_floor") {
    return "Stopped at the edge of the captured floor · the scanner never walked past here";
  }
  if (cause === "outside_recovery_bounds") {
    return "Stopped at the edge of the reviewed movement bounds";
  }
  return "Blocked by the walking map · this surface has no reviewed opening";
}

function blockedBarrierMessage(blocker: BlockedMovementBarrier): string {
  if (blocker.kind === "dynamic") return `Blocked by ${blocker.id} · this door is closed`;
  if (blocker.kind === "solid_furniture") return `Blocked by ${blocker.id} · solid furniture`;
  if (blocker.kind === "no_go") return `Blocked by ${blocker.id} · reviewed no-go volume`;
  if (blocker.id.startsWith("auto-capture-ring-")) {
    return "Blocked at the reviewed edge of the captured world";
  }
  // Cooked barriers carry a segment suffix; the operator needs the reviewed
  // wall it came from, not the cook's own numbering.
  const automaticWall = blocker.id.match(/^auto-barrier-(.+)-\d+$/);
  if (automaticWall) return `Blocked by ${automaticWall[1]} · automatic structural wall`;
  if (blocker.id.startsWith("auto-threshold-")) {
    return `Blocked by ${blocker.id} · reviewed threshold`;
  }
  return `Blocked by ${blocker.id} · reviewed structural wall`;
}
