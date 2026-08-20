// Wayfinder trajectory evidence (issues #30-#33).
//
// The scanner's SLAM pose trajectory is derived from ego-motion, never from
// point returns, so it is immune to the artifacts that make passability
// ambiguous in the capture itself: a mirror's phantom reflected room contains
// zero trajectory samples, and glass never lets the rig through. Anywhere the
// rig was physically carried is therefore both provably real and provably
// traversable. This module turns an ordered trajectory point stream into
// deterministic, receiptable evidence against a frozen floor plan:
//
//   - which rooms the scanner visited (per storey, elevation-banded);
//   - how often consecutive trajectory samples cross a given wall span.
//
// Everything here is pure and deterministic so artifacts stay byte-stable;
// the trajectory sha256 and thresholds travel with the evidence so a receipt
// can stand alone.

import {
  ProcessingAgentError,
  parseAsciiVertices,
  parseBinaryVertices,
  parsePlyDescriptor,
  semanticRound,
} from "./processing-agent-core.mjs";

export const TRAJECTORY_EVIDENCE_SCHEMA_VERSION = "trajectory-evidence-v1";

// A room counts as visited only with a handful of independent samples inside
// it — a single sample can be jitter across a doorway threshold.
export const DEFAULT_MINIMUM_VISITED_SAMPLES = 3;

// The rig is carried above the floor. Samples are assigned to the storey whose
// floor sits within this band below them; outside every band they are noise
// (or an unmodelled storey) and stay unassigned.
export const DEFAULT_CARRY_HEIGHT_BAND_M = Object.freeze({
  minimum: 0.2,
  maximum: 3.0,
});

// Mirrors automaticThresholdSurfaces: an opening belongs to the two nearest
// room outlines within a doorway's depth on either side of the wall.
export const OPENING_ROOM_MAXIMUM_GAP_M = 0.75;

const MAXIMUM_TRAJECTORY_SAMPLE_POINTS = 200_000;

// Parses a normalized (metric, y-up) PLY trajectory into an ORDERED position
// list. Order matters: wall-crossing evidence walks consecutive samples, so
// sampling uses a stride over the original sequence, never a re-sort.
export function parseTrajectoryPositions(input, {
  maximumSamplePoints = MAXIMUM_TRAJECTORY_SAMPLE_POINTS,
} = {}) {
  if (!Number.isSafeInteger(maximumSamplePoints) ||
    maximumSamplePoints < 100 || maximumSamplePoints > 2_000_000) {
    throw new ProcessingAgentError(
      "INVALID_TRAJECTORY_PARAMETERS",
      "Maximum trajectory sample points must be between 100 and 2,000,000",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const descriptor = parsePlyDescriptor(bytes);
  const samplingStride = Math.max(1, Math.ceil(descriptor.vertexCount / maximumSamplePoints));
  const positions = [];
  const bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
  const consume = (values, vertexIndex) => {
    if (vertexIndex % samplingStride !== 0) return;
    const x = values[descriptor.propertyIndex.x];
    const y = values[descriptor.propertyIndex.y];
    const z = values[descriptor.propertyIndex.z];
    if (![x, y, z].every(Number.isFinite)) return;
    positions.push([x, y, z]);
    bounds.min[0] = Math.min(bounds.min[0], x);
    bounds.min[1] = Math.min(bounds.min[1], y);
    bounds.min[2] = Math.min(bounds.min[2], z);
    bounds.max[0] = Math.max(bounds.max[0], x);
    bounds.max[1] = Math.max(bounds.max[1], y);
    bounds.max[2] = Math.max(bounds.max[2], z);
  };
  if (descriptor.format === "ascii") {
    parseAsciiVertices(bytes, descriptor, consume);
  } else {
    parseBinaryVertices(bytes, descriptor, consume);
  }
  if (!positions.length) {
    throw new ProcessingAgentError(
      "EMPTY_TRAJECTORY",
      "The trajectory contains no finite pose positions",
      { failureClass: "input_validation", retryable: false },
    );
  }
  return {
    format: descriptor.format,
    vertexCount: descriptor.vertexCount,
    sampledPointCount: positions.length,
    samplingStride,
    bounds,
    positions,
  };
}

// A mis-registered trajectory (wrong frame, wrong export) shows up as a pose
// path that barely lives inside the capture. Requiring horizontal containment
// of most samples is a cheap, deterministic guard; vertical drift is judged by
// the carry bands instead, so a tall atrium capture cannot fail it.
export function trajectoryWithinCaptureBounds(trajectoryBounds, captureBounds, {
  toleranceM = 1.0,
} = {}) {
  const axes = [0, 2];
  return axes.every((axis) =>
    trajectoryBounds.min[axis] >= captureBounds.min[axis] - toleranceM &&
    trajectoryBounds.max[axis] <= captureBounds.max[axis] + toleranceM);
}

function polygonPointXZ(point) {
  if (!Array.isArray(point)) return null;
  const [first, second, third] = point;
  const x = Number(first);
  const z = point.length >= 3 ? Number(third) : Number(second);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return [x, z];
}

function pointInPolygonXZ(x, z, outline) {
  let inside = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index, index += 1) {
    const [x1, z1] = outline[index];
    const [x2, z2] = outline[previous];
    const crossesRay = (z1 > z) !== (z2 > z);
    if (!crossesRay) continue;
    const intersectX = x1 + ((z - z1) / (z2 - z1)) * (x2 - x1);
    if (x < intersectX) inside = !inside;
  }
  return inside;
}

function normalizedRooms(level) {
  return (level.rooms ?? [])
    .map((room) => ({
      roomId: String(room.id ?? room.roomKey ?? ""),
      outline: (room.points ?? []).map(polygonPointXZ).filter(Boolean),
    }))
    .filter((room) => room.roomId && room.outline.length >= 3)
    .sort((left, right) => left.roomId.localeCompare(right.roomId));
}

// Assigns each sample to the HIGHEST storey whose carry band contains it —
// the floor directly beneath the rig — then tests room polygons on that
// storey only. Deterministic: rooms are visited in sorted id order and a
// sample counts for the first containing polygon.
export function trajectoryPlanEvidence({
  positions,
  plan,
  minimumVisitedSamples = DEFAULT_MINIMUM_VISITED_SAMPLES,
  carryHeightBandM = DEFAULT_CARRY_HEIGHT_BAND_M,
}) {
  if (!Array.isArray(positions) || !positions.length) {
    throw new ProcessingAgentError(
      "EMPTY_TRAJECTORY",
      "Trajectory evidence requires at least one pose position",
      { failureClass: "input_validation", retryable: false },
    );
  }
  if (!Number.isSafeInteger(minimumVisitedSamples) || minimumVisitedSamples < 1 ||
    minimumVisitedSamples > 10_000) {
    throw new ProcessingAgentError(
      "INVALID_TRAJECTORY_PARAMETERS",
      "Minimum visited samples must be between 1 and 10,000",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const bandMinimum = Number(carryHeightBandM?.minimum);
  const bandMaximum = Number(carryHeightBandM?.maximum);
  if (!Number.isFinite(bandMinimum) || !Number.isFinite(bandMaximum) ||
    bandMinimum < 0 || bandMaximum <= bandMinimum || bandMaximum > 10) {
    throw new ProcessingAgentError(
      "INVALID_TRAJECTORY_PARAMETERS",
      "Carry height band must satisfy 0 <= minimum < maximum <= 10 metres",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const levels = (plan?.levels ?? [])
    .map((level) => ({
      levelId: String(level.id ?? level.levelKey ?? ""),
      elevationM: Number(level.elevationM),
      rooms: normalizedRooms(level),
    }))
    .filter((level) => level.levelId && Number.isFinite(level.elevationM))
    .sort((left, right) => right.elevationM - left.elevationM ||
      left.levelId.localeCompare(right.levelId));
  if (!levels.length) {
    throw new ProcessingAgentError(
      "INVALID_TRAJECTORY_PLAN",
      "Trajectory evidence requires a plan with at least one level",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const roomSampleCounts = new Map();
  const levelSampleCounts = new Map(levels.map((level) => [level.levelId, 0]));
  let unassignedSampleCount = 0;
  for (const position of positions) {
    const y = Number(position[1]);
    const x = Number(position[0]);
    const z = Number(position[2]);
    if (![x, y, z].every(Number.isFinite)) continue;
    // levels are sorted highest first, so the first band hit is the floor
    // directly beneath the sample.
    const level = levels.find((candidate) =>
      y >= candidate.elevationM + bandMinimum &&
      y <= candidate.elevationM + bandMaximum);
    if (!level) {
      unassignedSampleCount += 1;
      continue;
    }
    levelSampleCounts.set(level.levelId, levelSampleCounts.get(level.levelId) + 1);
    const room = level.rooms.find((candidate) =>
      pointInPolygonXZ(x, z, candidate.outline));
    if (!room) continue;
    const key = `${level.levelId} ${room.roomId}`;
    roomSampleCounts.set(key, (roomSampleCounts.get(key) ?? 0) + 1);
  }
  const levelEvidence = levels
    .slice()
    .sort((left, right) => left.levelId.localeCompare(right.levelId))
    .map((level) => ({
      levelId: level.levelId,
      elevationM: semanticRound(level.elevationM),
      sampleCount: levelSampleCounts.get(level.levelId),
      rooms: level.rooms.map((room) => {
        const sampleCount = roomSampleCounts.get(`${level.levelId} ${room.roomId}`) ?? 0;
        return {
          roomId: room.roomId,
          sampleCount,
          visited: sampleCount >= minimumVisitedSamples,
        };
      }),
    }));
  return {
    schemaVersion: TRAJECTORY_EVIDENCE_SCHEMA_VERSION,
    parameters: {
      minimumVisitedSamples,
      carryHeightBandM: {
        minimum: semanticRound(bandMinimum),
        maximum: semanticRound(bandMaximum),
      },
    },
    sampleCount: positions.length,
    unassignedSampleCount,
    levels: levelEvidence,
    visitedRoomIds: levelEvidence
      .flatMap((level) => level.rooms
        .filter((room) => room.visited)
        .map((room) => `${level.levelId}/${room.roomId}`))
      .sort(),
  };
}

// Adapts a floor-plan proposal report (v1 single-level or v2 multi-level)
// into the level/room shape trajectoryPlanEvidence consumes. Room polygons
// keep the report's own keys so the evidence names the exact rooms the
// reviewer sees.
export function proposalReportPlanLevels(report) {
  const roomsByKey = new Map((report?.rooms ?? [])
    .map((room) => [room.roomKey, room]));
  const planRoom = (room) => ({
    id: room.roomKey,
    points: room.geometry?.points ?? [],
  });
  if (Array.isArray(report?.levels) && report.levels.length) {
    return report.levels.map((level) => ({
      id: level.levelKey,
      elevationM: level.elevationM,
      rooms: (level.roomKeys ?? [])
        .map((key) => roomsByKey.get(key))
        .filter(Boolean)
        .map(planRoom),
    }));
  }
  return [{
    id: "level-001",
    elevationM: Number(report?.summary?.inferredFloorElevationM ?? 0),
    rooms: [...roomsByKey.values()].map(planRoom),
  }];
}

function orientation(ax, az, bx, bz, cx, cz) {
  const value = (bz - az) * (cx - bx) - (bx - ax) * (cz - bz);
  if (value > 1e-12) return 1;
  if (value < -1e-12) return -1;
  return 0;
}

// The crossing point of a side-changing carry segment, expressed as the
// parameter along the wall span. Only crossings that land within the span
// itself count — a walk around the wall's free end changes side too, but its
// crossing parameter falls outside [0, 1].
function crossingSpanParameter(previousPoint, currentPoint, from, to) {
  const wallX = to[0] - from[0];
  const wallZ = to[1] - from[1];
  const wallLengthSquared = wallX * wallX + wallZ * wallZ;
  if (wallLengthSquared <= 0) return null;
  const signedArea = (point) =>
    wallX * (point[1] - from[1]) - wallZ * (point[0] - from[0]);
  const previousDistance = signedArea(previousPoint);
  const currentDistance = signedArea(currentPoint);
  const denominator = previousDistance - currentDistance;
  if (denominator === 0) return null;
  const s = previousDistance / denominator;
  const crossingX = previousPoint[0] + (currentPoint[0] - previousPoint[0]) * s;
  const crossingZ = previousPoint[1] + (currentPoint[1] - previousPoint[1]) * s;
  return ((crossingX - from[0]) * wallX + (crossingZ - from[1]) * wallZ) /
    wallLengthSquared;
}

// Counts the moments the rig was physically carried through where the plan
// draws a wall — evidence the span cannot be solid. Robust formulation: a
// crossing is a sign change of the side-of-wall function between in-band
// samples, with samples exactly on the wall line bridged (a pose landing on
// the line is still one pass through it, never two and never zero). Leaving
// the storey's carry band breaks continuity, so a stairwell excursion cannot
// stitch a phantom crossing together.
export function trajectoryWallCrossingCount({
  positions,
  span,
  elevationM,
  carryHeightBandM = DEFAULT_CARRY_HEIGHT_BAND_M,
}) {
  const from = polygonPointXZ(span?.from ?? span?.start);
  const to = polygonPointXZ(span?.to ?? span?.end);
  const elevation = Number(elevationM);
  if (!from || !to || !Number.isFinite(elevation)) {
    throw new ProcessingAgentError(
      "INVALID_TRAJECTORY_PARAMETERS",
      "Wall-crossing evidence requires a finite span and storey elevation",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const bandMinimum = elevation + Number(carryHeightBandM?.minimum ?? 0);
  const bandMaximum = elevation + Number(carryHeightBandM?.maximum ?? 0);
  let crossings = 0;
  let previous = null;
  for (const position of positions) {
    const y = Number(position[1]);
    if (y < bandMinimum || y > bandMaximum) {
      previous = null;
      continue;
    }
    const point = [Number(position[0]), Number(position[2])];
    if (!point.every(Number.isFinite)) {
      previous = null;
      continue;
    }
    const side = orientation(from[0], from[1], to[0], to[1], point[0], point[1]);
    if (side === 0) continue;
    if (previous && previous.side !== side) {
      const parameter = crossingSpanParameter(previous.point, point, from, to);
      if (parameter !== null && parameter >= 0 && parameter <= 1) crossings += 1;
    }
    previous = { point, side };
  }
  return crossings;
}

function closestOutlineDistance(point, outline) {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < outline.length; index += 1) {
    const [x1, z1] = outline[index];
    const [x2, z2] = outline[(index + 1) % outline.length];
    const edgeX = x2 - x1;
    const edgeZ = z2 - z1;
    const lengthSquared = edgeX * edgeX + edgeZ * edgeZ;
    const t = lengthSquared > 0
      ? Math.max(0, Math.min(1,
        ((point[0] - x1) * edgeX + (point[1] - z1) * edgeZ) / lengthSquared))
      : 0;
    const dx = point[0] - (x1 + edgeX * t);
    const dz = point[1] - (z1 + edgeZ * t);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

// The two rooms an opening connects, mirroring the threshold cook's adjacency
// rule: the nearest two room outlines within a doorway's depth of the opening
// midpoint. Fewer than two neighbours means the opening faces the envelope
// (or an unmodelled space) and can never qualify for trajectory auto-open.
export function openingAdjacentRoomIds({
  level,
  opening,
  maximumGapM = OPENING_ROOM_MAXIMUM_GAP_M,
}) {
  const from = polygonPointXZ(opening?.start ?? opening?.from);
  const to = polygonPointXZ(opening?.end ?? opening?.to);
  if (!from || !to) return [];
  const middle = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const rooms = normalizedRooms(level);
  return rooms
    .map((room) => ({
      roomId: room.roomId,
      distance: closestOutlineDistance(middle, room.outline),
    }))
    .filter((candidate) => candidate.distance <= maximumGapM)
    .sort((left, right) => left.distance - right.distance ||
      left.roomId.localeCompare(right.roomId))
    .slice(0, 2)
    .map((candidate) => candidate.roomId);
}

// ————— Trajectory auto-open qualification (issue #32) —————

// The receipt source name for machine-minted passability coverage.
export const TRAJECTORY_AUTO_OPEN_SOURCE = "trajectory-evidence";

// Decides whether one wall-line span (an unknown opening, or a capture
// crossing) qualifies for trajectory auto-open: it must sit between exactly
// two modelled rooms, and the scanner must have physically visited BOTH.
// Everything else stays sealed — an envelope window has one neighbour, a
// mirror-phantom room is never visited, and a room the operator added after
// the scan carries no evidence. Failing closed here is the design, not a
// limitation.
export function spanTrajectoryQualification({
  level,
  levelId,
  span,
  visitedRoomIds,
  maximumGapM = OPENING_ROOM_MAXIMUM_GAP_M,
}) {
  const adjacent = openingAdjacentRoomIds({ level, opening: span, maximumGapM });
  if (adjacent.length < 2) {
    return { qualified: false, reason: "envelope_or_unmodelled", roomIds: adjacent };
  }
  const visited = new Set(
    Array.isArray(visitedRoomIds)
      ? visitedRoomIds.filter((id) => typeof id === "string")
      : [],
  );
  const unvisited = adjacent.filter((roomId) => !visited.has(`${levelId}/${roomId}`));
  if (unvisited.length) {
    return { qualified: false, reason: "adjacent_room_unvisited", roomIds: adjacent };
  }
  return { qualified: true, reason: "both_adjacent_rooms_visited", roomIds: adjacent };
}

// Every `unknown` opening of a reviewed plan that trajectory evidence
// qualifies for cooking as passable. Deterministic and fail-closed: no
// evidence, a foreign schema version, or malformed visited ids yield an
// empty list (the plan cooks sealed, exactly as before Wayfinder).
export function trajectoryQualifiedUnknownOpenings({
  plan,
  trajectoryEvidence,
  maximumGapM = OPENING_ROOM_MAXIMUM_GAP_M,
}) {
  if (!trajectoryEvidence ||
    trajectoryEvidence.schemaVersion !== TRAJECTORY_EVIDENCE_SCHEMA_VERSION ||
    !Array.isArray(trajectoryEvidence.visitedRoomIds)) {
    return [];
  }
  const qualified = [];
  for (const level of plan?.levels ?? []) {
    const levelId = String(level.id ?? level.levelKey ?? "");
    if (!levelId) continue;
    for (const opening of level.openings ?? []) {
      if (!opening || opening.type !== "unknown") continue;
      const openingId = String(opening.id ?? opening.openingKey ?? "");
      if (!openingId) continue;
      const verdict = spanTrajectoryQualification({
        level,
        levelId,
        span: opening,
        visitedRoomIds: trajectoryEvidence.visitedRoomIds,
        maximumGapM,
      });
      if (verdict.qualified) {
        qualified.push({ levelId, openingId, roomIds: verdict.roomIds });
      }
    }
  }
  return qualified.sort((left, right) =>
    left.levelId.localeCompare(right.levelId) ||
    left.openingId.localeCompare(right.openingId));
}
