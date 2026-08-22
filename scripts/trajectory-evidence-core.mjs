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

// ————— Clutter-wall demotion (issue #33) —————

// A proposed wall run is demotable only when it is short — the clutter the
// extractor mistakes for walls (racking, shelving, furniture) forms short
// runs; genuine partitions are long and live on room outlines.
export const MAXIMUM_DEMOTABLE_WALL_LENGTH_M = 3.0;

// Per-wall pass-through evidence, computed at proposal time when positions
// are in hand. The carry band is capped at each wall's own top: a crossing
// only counts when the rig rode BELOW the claimed wall height, so the
// scanner itself passed through claimed-solid space — physically impossible
// for a real wall. Walking past or over a low rack never counts.
export function trajectoryWallCrossingEvidence({
  positions,
  walls,
  carryHeightBandM = DEFAULT_CARRY_HEIGHT_BAND_M,
}) {
  const entries = [];
  for (const wall of walls ?? []) {
    const wallId = String(wall?.wallId ?? wall?.id ?? "");
    const elevation = Number(wall?.elevationM);
    const heightM = Number(wall?.heightM);
    const span = wall?.span ?? wall?.geometry?.points ?? null;
    const from = Array.isArray(span) ? span[0] : span?.start ?? span?.from;
    const to = Array.isArray(span) ? span[span.length - 1] : span?.end ?? span?.to;
    if (!wallId || !Number.isFinite(elevation) || !Number.isFinite(heightM) ||
      !from || !to) continue;
    const bandMaximum = Math.min(Number(carryHeightBandM?.maximum ?? 0), heightM);
    if (bandMaximum <= Number(carryHeightBandM?.minimum ?? 0)) continue;
    const crossingCount = trajectoryWallCrossingCount({
      positions,
      span: { from, to },
      elevationM: elevation,
      carryHeightBandM: {
        minimum: Number(carryHeightBandM?.minimum ?? 0),
        maximum: bandMaximum,
      },
    });
    if (crossingCount > 0) entries.push({ wallId, crossingCount });
  }
  return entries.sort((left, right) => left.wallId.localeCompare(right.wallId));
}

function pointStrictlyInsideOutline(point, outline) {
  return pointInPolygonXZ(point[0], point[1], outline);
}

// The reviewed-plan walls that pass-through evidence qualifies for demotion.
// Deliberately narrow: the wall must be short, wholly inside ONE
// scanner-visited room (endpoints and midpoint — freestanding clutter;
// envelope and partition walls sit on outlines and never qualify), carry
// pass-through evidence under its own id, and be untouched by any frozen
// human classification. Anything else keeps its wall.
export function trajectoryDemotableWalls({
  plan,
  trajectoryEvidence,
  resolutionCoveredWallIds = new Set(),
  maximumWallLengthM = MAXIMUM_DEMOTABLE_WALL_LENGTH_M,
}) {
  if (!trajectoryEvidence ||
    trajectoryEvidence.schemaVersion !== TRAJECTORY_EVIDENCE_SCHEMA_VERSION ||
    !Array.isArray(trajectoryEvidence.visitedRoomIds) ||
    !Array.isArray(trajectoryEvidence.wallCrossings)) {
    return [];
  }
  const crossingsByWallId = new Map(trajectoryEvidence.wallCrossings
    .filter((entry) => entry && typeof entry.wallId === "string" &&
      Number.isFinite(Number(entry.crossingCount)) && Number(entry.crossingCount) > 0)
    .map((entry) => [entry.wallId, Number(entry.crossingCount)]));
  if (!crossingsByWallId.size) return [];
  const visited = new Set(trajectoryEvidence.visitedRoomIds
    .filter((id) => typeof id === "string"));
  const demoted = [];
  for (const level of plan?.levels ?? []) {
    const levelId = String(level.id ?? level.levelKey ?? "");
    if (!levelId) continue;
    const rooms = (level.rooms ?? [])
      .map((room) => ({
        roomId: String(room.id ?? room.roomKey ?? ""),
        outline: (room.points ?? []).map(polygonPointXZ).filter(Boolean),
      }))
      .filter((room) => room.roomId && room.outline.length >= 3 &&
        visited.has(`${levelId}/${room.roomId}`))
      .sort((left, right) => left.roomId.localeCompare(right.roomId));
    if (!rooms.length) continue;
    for (const wall of level.walls ?? []) {
      const wallId = String(wall?.id ?? wall?.wallKey ?? "");
      if (!wallId || resolutionCoveredWallIds.has(wallId)) continue;
      const crossingCount = crossingsByWallId.get(wallId);
      if (!crossingCount) continue;
      const from = polygonPointXZ(wall.start);
      const to = polygonPointXZ(wall.end);
      if (!from || !to) continue;
      if (Math.hypot(to[0] - from[0], to[1] - from[1]) > maximumWallLengthM) continue;
      // Containment in a room polygon used to be required here, and it was
      // wrong on real captures: the extractor traces a room as a ring around
      // observed floor, so genuine free-standing clutter sits OUTSIDE that
      // ring and every real clutter wall failed the test. What actually
      // carries the claim is the pass-through itself — the rig rode through
      // the wall's plane below its own top. That is only trustworthy while
      // consecutive samples are close enough to represent continuous travel
      // rather than a chord cutting a corner, which the caller enforces by
      // rejecting sparse trajectories.
      const middle = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      const nearestRoom = rooms.find((room) =>
        pointStrictlyInsideOutline(from, room.outline) ||
        pointStrictlyInsideOutline(to, room.outline) ||
        pointStrictlyInsideOutline(middle, room.outline)) ?? rooms[0];
      demoted.push({
        levelId,
        wallId,
        crossingCount,
        roomId: nearestRoom.roomId,
      });
    }
  }
  return demoted.sort((left, right) =>
    left.levelId.localeCompare(right.levelId) ||
    left.wallId.localeCompare(right.wallId));
}

// ————— Trajectory-evidenced floor —————

// Room polygons are traced from observed floor returns, which in a cluttered
// space can cover a fraction of where a person actually walked: on the FJD
// capture the ring held 12.9 m² while 73% of the pose samples fell outside it.
// Those excluded areas are not blocked by anything — they are simply absent
// from the floor, so no amount of opening walls makes them reachable.
//
// The rig having been carried through a spot is the strongest walkability
// evidence available: stronger than inferring floor from returns, and immune
// to the glass and mirror artifacts that confuse them. This turns the pose
// path into floor. It only ever ADDS surface — walls still stand, agent
// erosion still applies — so the worst case is floor under a standing wall,
// which the wall continues to block.
export const DEFAULT_WALKED_FLOOR_CELL_M = 0.25;
// Half-width of the walked corridor. Recast erodes by roughly the agent
// radius, so a corridor must exceed twice that to survive as navmesh.
export const DEFAULT_WALKED_FLOOR_RADIUS_M = 0.6;

function mergeCellsIntoRectangles(cells, cellSizeM) {
  // Row runs first, then merge identical runs downward: far fewer surfaces
  // than one quad per cell, and deterministic given a sorted cell set.
  const byRow = new Map();
  for (const key of cells) {
    const [column, row] = key.split(",").map(Number);
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push(column);
  }
  const runs = [];
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    const columns = byRow.get(row).sort((a, b) => a - b);
    let start = columns[0];
    let previous = columns[0];
    for (const column of columns.slice(1)) {
      if (column === previous + 1) { previous = column; continue; }
      runs.push({ row, start, end: previous });
      start = column;
      previous = column;
    }
    runs.push({ row, start, end: previous });
  }
  const open = new Map();
  const rectangles = [];
  for (const run of runs) {
    const key = `${run.start},${run.end}`;
    const pending = open.get(key);
    if (pending && pending.endRow === run.row - 1) {
      pending.endRow = run.row;
      continue;
    }
    if (pending) rectangles.push(pending);
    open.set(key, { start: run.start, end: run.end, startRow: run.row, endRow: run.row });
  }
  rectangles.push(...open.values());
  return rectangles
    .map((rectangle) => ({
      minX: rectangle.start * cellSizeM,
      maxX: (rectangle.end + 1) * cellSizeM,
      minZ: rectangle.startRow * cellSizeM,
      maxZ: (rectangle.endRow + 1) * cellSizeM,
    }))
    .sort((left, right) => left.minZ - right.minZ || left.minX - right.minX);
}

export function trajectoryWalkedFloor({
  positions,
  plan,
  cellSizeM = DEFAULT_WALKED_FLOOR_CELL_M,
  radiusM = DEFAULT_WALKED_FLOOR_RADIUS_M,
  carryHeightBandM = DEFAULT_CARRY_HEIGHT_BAND_M,
}) {
  if (!Number.isFinite(cellSizeM) || cellSizeM < 0.05 || cellSizeM > 1) {
    throw new ProcessingAgentError(
      "INVALID_TRAJECTORY_PARAMETERS",
      "Walked-floor cell size must be between 0.05 and 1 metres",
      { failureClass: "input_validation", retryable: false },
    );
  }
  if (!Number.isFinite(radiusM) || radiusM < 0.1 || radiusM > 3) {
    throw new ProcessingAgentError(
      "INVALID_TRAJECTORY_PARAMETERS",
      "Walked-floor radius must be between 0.1 and 3 metres",
      { failureClass: "input_validation", retryable: false },
    );
  }
  const levels = (plan?.levels ?? [])
    .map((level) => ({
      levelId: String(level.id ?? level.levelKey ?? ""),
      elevationM: Number(level.elevationM),
      ceilingElevationM: Number(level.ceilingElevationM ?? level.elevationM),
    }))
    .filter((level) => level.levelId && Number.isFinite(level.elevationM))
    .sort((left, right) => right.elevationM - left.elevationM ||
      left.levelId.localeCompare(right.levelId));
  const bandMinimum = Number(carryHeightBandM?.minimum ?? 0);
  const bandMaximum = Number(carryHeightBandM?.maximum ?? 0);
  const cellsByLevel = new Map(levels.map((level) => [level.levelId, new Set()]));
  const reach = Math.ceil(radiusM / cellSizeM);
  for (const position of positions ?? []) {
    const x = Number(position[0]);
    const y = Number(position[1]);
    const z = Number(position[2]);
    if (![x, y, z].every(Number.isFinite)) continue;
    const level = levels.find((candidate) =>
      y >= candidate.elevationM + bandMinimum && y <= candidate.elevationM + bandMaximum);
    if (!level) continue;
    const centreColumn = Math.floor(x / cellSizeM);
    const centreRow = Math.floor(z / cellSizeM);
    const cells = cellsByLevel.get(level.levelId);
    for (let column = centreColumn - reach; column <= centreColumn + reach; column += 1) {
      for (let row = centreRow - reach; row <= centreRow + reach; row += 1) {
        const cellX = (column + 0.5) * cellSizeM;
        const cellZ = (row + 0.5) * cellSizeM;
        if (Math.hypot(cellX - x, cellZ - z) <= radiusM) cells.add(`${column},${row}`);
      }
    }
  }
  return levels
    .filter((level) => cellsByLevel.get(level.levelId).size)
    .map((level) => ({
      levelId: level.levelId,
      elevationM: semanticRound(level.elevationM),
      ceilingElevationM: semanticRound(level.ceilingElevationM),
      cellSizeM: semanticRound(cellSizeM),
      radiusM: semanticRound(radiusM),
      cellCount: cellsByLevel.get(level.levelId).size,
      rectangles: mergeCellsIntoRectangles(
        [...cellsByLevel.get(level.levelId)].sort(),
        cellSizeM,
      ).map((rectangle) => ({
        minX: semanticRound(rectangle.minX),
        maxX: semanticRound(rectangle.maxX),
        minZ: semanticRound(rectangle.minZ),
        maxZ: semanticRound(rectangle.maxZ),
      })),
    }))
    .sort((left, right) => left.levelId.localeCompare(right.levelId));
}

// ————— Walked-floor clutter demotion —————

// Pass-through demotion (above) only ever fires on a wall the rig walked
// STRAIGHT THROUGH. On the FJD capture that was 12 crossings against 136
// extracted wall runs, and it left 40.5% of the walked floor reachable: an
// operator never walks through a pile of stacked goods, they walk down the
// aisle beside it, so aisle-flanking clutter can never earn a crossing.
//
// The complementary evidence is the walked floor itself. Ground the rig was
// carried over is proven standable; a 2.5 m wall claiming to occupy that same
// ground contradicts the ego-motion record. Two thresholds, because the
// inference weakens as the overlap shrinks:
//
//   walked-majority — most of the run sits on walked floor. Conservative:
//                     keeps walls the rig merely passed near.
//   walked-contact  — any part sits on walked floor. The disc that builds the
//                     walked floor has a radius, so this also catches a real
//                     wall the rig passed within that radius of on one side.
//
// Neither can enlarge the walkable world: the cook lays floor ONLY under room
// polygons, thresholds, and walked rectangles, so demoting a wall can at most
// join two places the rig already stood.
export const WALKED_FLOOR_DEMOTION_MODES = Object.freeze([
  "walked-majority",
  "walked-contact",
]);
export const WALKED_FLOOR_MAJORITY_FRACTION = 0.5;
const WALKED_FLOOR_WALL_SAMPLE_SPACING_M = 0.05;

function walkedCellLookup(walkedFloor) {
  const cellSizeM = Number(walkedFloor?.cellSizeM);
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) return null;
  const cells = new Set();
  for (const rectangle of walkedFloor?.rectangles ?? []) {
    const minX = Number(rectangle?.minX);
    const maxX = Number(rectangle?.maxX);
    const minZ = Number(rectangle?.minZ);
    const maxZ = Number(rectangle?.maxZ);
    if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) continue;
    // The rectangles were merged from whole cells, so their edges land on cell
    // boundaries and rounding recovers the exact index range.
    for (let column = Math.round(minX / cellSizeM); column < Math.round(maxX / cellSizeM); column += 1) {
      for (let row = Math.round(minZ / cellSizeM); row < Math.round(maxZ / cellSizeM); row += 1) {
        cells.add(`${column},${row}`);
      }
    }
  }
  if (!cells.size) return null;
  return (x, z) => cells.has(
    `${Math.floor(x / cellSizeM)},${Math.floor(z / cellSizeM)}`,
  );
}

// The fraction of a wall run's centre line that stands on walked floor.
export function wallWalkedFloorFraction({ from, to, contains }) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(4, Math.ceil(length / WALKED_FLOOR_WALL_SAMPLE_SPACING_M));
  let onWalkedFloor = 0;
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    if (contains(
      from[0] + (to[0] - from[0]) * ratio,
      from[1] + (to[1] - from[1]) * ratio,
    )) onWalkedFloor += 1;
  }
  return onWalkedFloor / (steps + 1);
}

export function trajectoryWalkedFloorDemotableWalls({
  plan,
  trajectoryEvidence,
  mode,
  resolutionCoveredWallIds = new Set(),
}) {
  if (!WALKED_FLOOR_DEMOTION_MODES.includes(mode)) return [];
  if (!trajectoryEvidence ||
    trajectoryEvidence.schemaVersion !== TRAJECTORY_EVIDENCE_SCHEMA_VERSION ||
    !Array.isArray(trajectoryEvidence.walkedFloors)) {
    return [];
  }
  const lookupByLevelId = new Map();
  for (const walkedFloor of trajectoryEvidence.walkedFloors) {
    const levelId = String(walkedFloor?.levelId ?? "");
    const lookup = walkedCellLookup(walkedFloor);
    if (levelId && lookup) lookupByLevelId.set(levelId, lookup);
  }
  if (!lookupByLevelId.size) return [];
  const minimumFraction = mode === "walked-majority" ? WALKED_FLOOR_MAJORITY_FRACTION : 0;
  const demoted = [];
  for (const level of plan?.levels ?? []) {
    const levelId = String(level.id ?? level.levelKey ?? "");
    const contains = lookupByLevelId.get(levelId);
    if (!levelId || !contains) continue;
    for (const wall of level.walls ?? []) {
      const wallId = String(wall?.id ?? wall?.wallKey ?? "");
      // A wall any frozen human classification touched is never the machine's
      // to remove, exactly as for pass-through demotion.
      if (!wallId || resolutionCoveredWallIds.has(wallId)) continue;
      const from = polygonPointXZ(wall.start);
      const to = polygonPointXZ(wall.end);
      if (!from || !to) continue;
      const walkedFraction = wallWalkedFloorFraction({ from, to, contains });
      if (walkedFraction <= 0 || walkedFraction < minimumFraction) continue;
      demoted.push({
        levelId,
        wallId,
        mode,
        walkedFraction: semanticRound(walkedFraction),
      });
    }
  }
  return demoted.sort((left, right) =>
    left.levelId.localeCompare(right.levelId) ||
    left.wallId.localeCompare(right.wallId));
}
