// Names the reviewed wall a movement contact belongs to. Pure geometry with
// no engine dependencies, so the corner cases — junctions, acute meetings,
// thick walls beside thin ones — are pinned by direct unit fixtures.

export type AttributableBarrierSegment = {
  id: string;
  start: [number, number];
  end: [number, number];
  minY: number;
  maxY: number;
  thicknessM?: number;
};

const NORMAL_MISALIGNMENT_WEIGHT = 0.3;
// Two candidates this close in score are genuinely ambiguous — a corner
// contact touches both walls at once. Saying nothing is better than
// confidently sending an operator to edit the wrong barrier.
const AMBIGUITY_SCORE_MARGIN = 0.05;

export function pointToSegmentDistance2D(
  x: number,
  z: number,
  start: [number, number],
  end: [number, number],
): number {
  const deltaX = end[0] - start[0];
  const deltaZ = end[1] - start[1];
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((x - start[0]) * deltaX + (z - start[1]) * deltaZ) / lengthSquared))
    : 0;
  return Math.hypot(x - (start[0] + deltaX * t), z - (start[1] + deltaZ * t));
}

// 0 when the contact normal is exactly the candidate wall's face normal,
// 1 when it runs along the wall instead; contacts without a usable
// horizontal normal contribute nothing so pure distance still decides.
function barrierNormalMisalignment(
  barrier: AttributableBarrierSegment,
  contactNormal: readonly [number, number, number] | null,
): number {
  if (!contactNormal) return 0;
  const horizontal = Math.hypot(contactNormal[0], contactNormal[2]);
  if (horizontal < 0.3) return 0;
  const deltaX = barrier.end[0] - barrier.start[0];
  const deltaZ = barrier.end[1] - barrier.start[1];
  const length = Math.hypot(deltaX, deltaZ);
  if (length <= 1e-6) return 0;
  const wallNormalDot = Math.abs(
    (contactNormal[0] * -deltaZ + contactNormal[2] * deltaX) / (length * horizontal),
  );
  return 1 - Math.min(1, wallNormalDot);
}

// Scores every vertically-containing candidate by distance to its face plus
// how badly its face normal disagrees with the contact normal. A clear winner
// is named; two winners within the ambiguity margin name nobody — the caller
// falls back to the generic blocked message rather than guessing.
// Two auto-cooked segments of one reviewed wall share their source wall, so a
// tie between them is not ambiguity — either answer names the same wall to
// the operator.
function attributionIdentity(barrierId: string): string {
  const match = /^auto-barrier-(.+)-\d+$/.exec(barrierId);
  return match ? match[1]! : barrierId;
}

export function attributeBlockedBarrier(
  barriers: readonly AttributableBarrierSegment[],
  point: readonly [number, number, number],
  contactNormal: readonly [number, number, number] | null,
  maximumDistanceM: number,
): string | null {
  let best: { id: string; score: number } | null = null;
  let runnerUp: { id: string; score: number } | null = null;
  for (const barrier of barriers) {
    if (point[1] < barrier.minY - 0.1 || point[1] > barrier.maxY + 0.1) continue;
    const distanceToSegment = pointToSegmentDistance2D(
      point[0],
      point[2],
      barrier.start,
      barrier.end,
    );
    // A thick wall's contact lands on its face, half a thickness away from
    // the centreline the segment records; measure from the face.
    const distanceToFace = Math.max(
      0,
      distanceToSegment - (barrier.thicknessM ?? 0) / 2,
    );
    if (distanceToFace >= maximumDistanceM) continue;
    const score = distanceToFace +
      barrierNormalMisalignment(barrier, contactNormal) * NORMAL_MISALIGNMENT_WEIGHT;
    if (!best || score < best.score) {
      runnerUp = best;
      best = { id: barrier.id, score };
    } else if (!runnerUp || score < runnerUp.score) {
      runnerUp = { id: barrier.id, score };
    }
  }
  if (!best || best.score >= maximumDistanceM) return null;
  if (runnerUp && runnerUp.score - best.score < AMBIGUITY_SCORE_MARGIN &&
    attributionIdentity(runnerUp.id) !== attributionIdentity(best.id)) {
    return null;
  }
  return best.id;
}
