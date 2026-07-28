export type CaptureRoomEntity = {
  id: string;
  kind: string;
  label: string;
  geometry_json: string | null;
};

export type CaptureTrajectoryPoint = {
  position: [number, number, number];
  timestampMs?: number;
};

type CaptureCompletenessInput = {
  version: { id: string; versionNumber: number };
  source: {
    adapter: string;
    fileName: string;
    format: "canonical_pose_json_v1";
    coordinateFrame: string;
    alignmentEvidence: string;
  };
  parameters: {
    coverageRadiusM: number;
    maximumSampleGapM: number;
    loopClosureRadiusM: number;
    minimumRoomCoveragePercent: number;
    verticalToleranceM: number;
  };
  rooms: CaptureRoomEntity[];
  points: CaptureTrajectoryPoint[];
};

type Point2 = [number, number];

type NormalizedRoom = {
  id: string;
  label: string;
  points: Point2[];
  yMin: number;
  yMax: number;
};

export type CaptureCompletenessReport = {
  method: "authored-room-trajectory-coverage-v1";
  result: "complete" | "complete_with_warnings" | "recapture_required" | "insufficient_evidence";
  scope: "pose_path_against_authored_rooms";
  limitation: string;
  version: CaptureCompletenessInput["version"];
  source: CaptureCompletenessInput["source"];
  parameters: CaptureCompletenessInput["parameters"];
  summary: {
    sampleCount: number;
    roomCount: number;
    roomsMeetingCoverage: number;
    roomsBelowCoverage: number;
    pathLengthM: number;
    maximumGapM: number;
    gapCount: number;
    startEndDistanceM: number;
    loopClosed: boolean;
    durationSeconds: number | null;
  };
  rooms: Array<{
    entityId: string;
    label: string;
    classification: "covered" | "recapture";
    coveragePercent: number;
    sampleCount: number;
    coveredGridPoints: number;
    totalGridPoints: number;
  }>;
  issues: Array<{
    code: "room_below_coverage" | "sample_gap" | "loop_not_closed" | "timestamps_not_monotonic";
    severity: "blocker" | "warning";
    message: string;
    roomId?: string;
    roomLabel?: string;
    segmentIndex?: number;
  }>;
  blockers: string[];
  invalidRooms: Array<{ entityId: string; label: string; reason: string }>;
  visual: {
    coordinatePlane: "XZ";
    units: "metres";
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number } | null;
    rooms: Array<{
      entityId: string;
      label: string;
      classification: "covered" | "recapture";
      points: Point2[];
    }>;
    trajectory: Point2[];
    blindSpots: Array<{ roomId: string; roomLabel: string; position: Point2 }>;
    gapSegments: Array<{ segmentIndex: number; from: Point2; to: Point2; distanceM: number }>;
  };
};

export function computeCaptureCompleteness(input: CaptureCompletenessInput): CaptureCompletenessReport {
  const invalidRooms: CaptureCompletenessReport["invalidRooms"] = [];
  const rooms = normalizeRooms(input.rooms, invalidRooms);
  const blockers: string[] = [];
  if (!rooms.length) blockers.push("No valid authored room footprints were available");
  if (invalidRooms.length) blockers.push(`${invalidRooms.length} authored room footprint(s) were invalid`);
  if (input.points.length < 2) blockers.push("At least two trajectory samples are required");

  const trajectory2 = input.points.map(({ position }) => [position[0], position[2]] as Point2);
  const pathDistances = input.points.slice(1).map((point, index) => (
    distance3(input.points[index]!.position, point.position)
  ));
  const pathLengthM = sum(pathDistances);
  const maximumGapM = pathDistances.length ? Math.max(...pathDistances) : 0;
  const gapSegments = pathDistances.flatMap((distanceM, index) => (
    distanceM > input.parameters.maximumSampleGapM
      ? [{
          segmentIndex: index,
          from: trajectory2[index]!,
          to: trajectory2[index + 1]!,
          distanceM: rounded(distanceM),
        }]
      : []
  ));
  const startEndDistanceM = input.points.length > 1
    ? distance3(input.points[0]!.position, input.points.at(-1)!.position)
    : 0;
  const loopClosed = input.points.length > 1 && startEndDistanceM <= input.parameters.loopClosureRadiusM;
  const issues: CaptureCompletenessReport["issues"] = [];
  for (const gap of gapSegments) {
    issues.push({
      code: "sample_gap",
      severity: "blocker",
      segmentIndex: gap.segmentIndex,
      message: `Trajectory segment ${gap.segmentIndex + 1} is ${rounded(gap.distanceM)} m, above the ${input.parameters.maximumSampleGapM} m limit`,
    });
  }
  if (input.points.length > 1 && !loopClosed) {
    issues.push({
      code: "loop_not_closed",
      severity: "warning",
      message: `Trajectory endpoints are ${rounded(startEndDistanceM)} m apart, above the ${input.parameters.loopClosureRadiusM} m loop-closure radius`,
    });
  }
  const timestamps = input.points.map((point) => point.timestampMs).filter((value): value is number => value !== undefined);
  const timestampsMonotonic = timestamps.every((value, index) => index === 0 || value >= timestamps[index - 1]!);
  if (timestamps.length && timestamps.length !== input.points.length) {
    blockers.push("Trajectory timestamps must be supplied for every sample or omitted for every sample");
  } else if (!timestampsMonotonic) {
    issues.push({
      code: "timestamps_not_monotonic",
      severity: "blocker",
      message: "Trajectory timestamps are not monotonic",
    });
  }

  const roomResults: CaptureCompletenessReport["rooms"] = [];
  const blindSpots: CaptureCompletenessReport["visual"]["blindSpots"] = [];
  for (const room of rooms) {
    const grid = sampleRoomGrid(room, input.parameters.coverageRadiusM);
    const inRoomSamples = input.points.filter(({ position }) => (
      position[1] >= room.yMin - input.parameters.verticalToleranceM &&
      position[1] <= room.yMax + input.parameters.verticalToleranceM &&
      pointInPolygon([position[0], position[2]], room.points)
    ));
    let covered = 0;
    const roomBlindSpots: Point2[] = [];
    for (const point of grid) {
      const isCovered = inRoomSamples.some(({ position }) => (
        distance2(point, [position[0], position[2]]) <= input.parameters.coverageRadiusM
      ));
      if (isCovered) {
        covered += 1;
      } else if (roomBlindSpots.length < 32) {
        roomBlindSpots.push(point);
      }
    }
    const coveragePercent = grid.length ? rounded((covered / grid.length) * 100, 1) : 0;
    const classification = coveragePercent >= input.parameters.minimumRoomCoveragePercent
      ? "covered"
      : "recapture";
    roomResults.push({
      entityId: room.id,
      label: room.label,
      classification,
      coveragePercent,
      sampleCount: inRoomSamples.length,
      coveredGridPoints: covered,
      totalGridPoints: grid.length,
    });
    if (classification === "recapture") {
      issues.push({
        code: "room_below_coverage",
        severity: "blocker",
        roomId: room.id,
        roomLabel: room.label,
        message: `${room.label} has ${coveragePercent}% pose-path coverage, below the ${input.parameters.minimumRoomCoveragePercent}% threshold`,
      });
      blindSpots.push(...roomBlindSpots.map((position) => ({
        roomId: room.id,
        roomLabel: room.label,
        position,
      })));
    }
  }

  const blockerIssues = issues.filter((issue) => issue.severity === "blocker");
  const result: CaptureCompletenessReport["result"] = blockers.length
    ? "insufficient_evidence"
    : blockerIssues.length
      ? "recapture_required"
      : issues.length
        ? "complete_with_warnings"
        : "complete";
  const durationSeconds = timestampsMonotonic && timestamps.length === input.points.length && timestamps.length > 1
    ? rounded((timestamps.at(-1)! - timestamps[0]!) / 1000)
    : null;
  const bounds = visualBounds(rooms, trajectory2);

  return {
    method: "authored-room-trajectory-coverage-v1",
    result,
    scope: "pose_path_against_authored_rooms",
    limitation: "This measures geometric pose-path coverage against authored room footprints. It does not prove image sharpness, exposure, occlusion coverage, SLAM accuracy, loop-closure correctness, or final reconstruction quality.",
    version: input.version,
    source: input.source,
    parameters: input.parameters,
    summary: {
      sampleCount: input.points.length,
      roomCount: rooms.length,
      roomsMeetingCoverage: roomResults.filter((room) => room.classification === "covered").length,
      roomsBelowCoverage: roomResults.filter((room) => room.classification === "recapture").length,
      pathLengthM: rounded(pathLengthM),
      maximumGapM: rounded(maximumGapM),
      gapCount: gapSegments.length,
      startEndDistanceM: rounded(startEndDistanceM),
      loopClosed,
      durationSeconds,
    },
    rooms: roomResults,
    issues,
    blockers: [...new Set(blockers)],
    invalidRooms,
    visual: {
      coordinatePlane: "XZ",
      units: "metres",
      bounds,
      rooms: rooms.map((room) => ({
        entityId: room.id,
        label: room.label,
        classification: roomResults.find((result) => result.entityId === room.id)!.classification,
        points: room.points,
      })),
      trajectory: downsample(trajectory2, 500),
      blindSpots,
      gapSegments: gapSegments.slice(0, 200),
    },
  };
}

function normalizeRooms(
  entities: CaptureRoomEntity[],
  invalid: CaptureCompletenessReport["invalidRooms"],
): NormalizedRoom[] {
  const rooms: NormalizedRoom[] = [];
  for (const entity of entities) {
    if (entity.kind !== "room" || !entity.geometry_json) continue;
    try {
      rooms.push(normalizeRoom(entity));
    } catch (error) {
      invalid.push({
        entityId: entity.id,
        label: entity.label,
        reason: error instanceof Error ? error.message : "Invalid room geometry",
      });
    }
  }
  return rooms;
}

function normalizeRoom(entity: CaptureRoomEntity): NormalizedRoom {
  const geometry = JSON.parse(entity.geometry_json!) as unknown;
  if (!geometry || typeof geometry !== "object") throw new Error("Geometry is not an object");
  const type = Reflect.get(geometry, "type");
  const rawPoints = Reflect.get(geometry, "points");
  if (!Array.isArray(rawPoints)) throw new Error("Geometry points are missing");
  const points3 = rawPoints.map((point) => {
    if (!Array.isArray(point) || point.length !== 3) throw new Error("Every room point must have three coordinates");
    const values = point.map(Number);
    if (values.some((value) => !Number.isFinite(value))) throw new Error("Room coordinates must be finite");
    return values as [number, number, number];
  });
  let points: Point2[];
  if (type === "box") {
    if (points3.length !== 2) throw new Error("Box geometry requires two corner points");
    const minX = Math.min(points3[0]![0], points3[1]![0]);
    const maxX = Math.max(points3[0]![0], points3[1]![0]);
    const minZ = Math.min(points3[0]![2], points3[1]![2]);
    const maxZ = Math.max(points3[0]![2], points3[1]![2]);
    if (maxX <= minX || maxZ <= minZ) throw new Error("Room footprint has zero or negative extent");
    points = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
  } else if (type === "polygon") {
    if (points3.length < 3) throw new Error("Polygon geometry requires at least three points");
    points = points3.map(([x, , z]) => [x, z]);
    if (polygonArea(points) <= 1e-9) throw new Error("Room footprint has zero area");
  } else {
    throw new Error("Only box and polygon room geometry is supported");
  }
  return {
    id: entity.id,
    label: entity.label,
    points,
    yMin: Math.min(...points3.map((point) => point[1])),
    yMax: Math.max(...points3.map((point) => point[1])),
  };
}

function sampleRoomGrid(room: NormalizedRoom, coverageRadiusM: number): Point2[] {
  const minX = Math.min(...room.points.map((point) => point[0]));
  const maxX = Math.max(...room.points.map((point) => point[0]));
  const minZ = Math.min(...room.points.map((point) => point[1]));
  const maxZ = Math.max(...room.points.map((point) => point[1]));
  let spacing = Math.max(0.25, coverageRadiusM / 2);
  const estimated = Math.max(1, Math.ceil((maxX - minX) / spacing) * Math.ceil((maxZ - minZ) / spacing));
  if (estimated > 10_000) spacing *= Math.sqrt(estimated / 10_000);
  const points: Point2[] = [];
  for (let x = minX + spacing / 2; x < maxX; x += spacing) {
    for (let z = minZ + spacing / 2; z < maxZ; z += spacing) {
      const point: Point2 = [x, z];
      if (pointInPolygon(point, room.points)) points.push(point);
    }
  }
  if (!points.length) {
    points.push([
      room.points.reduce((sum, point) => sum + point[0], 0) / room.points.length,
      room.points.reduce((sum, point) => sum + point[1], 0) / room.points.length,
    ]);
  }
  return points;
}

function pointInPolygon(point: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let left = 0, right = polygon.length - 1; left < polygon.length; right = left, left += 1) {
    const a = polygon[left]!;
    const b = polygon[right]!;
    const intersects = (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonArea(points: Point2[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twiceArea) / 2;
}

function visualBounds(rooms: NormalizedRoom[], trajectory: Point2[]) {
  const points = [...rooms.flatMap((room) => room.points), ...trajectory];
  if (!points.length) return null;
  return {
    minX: Math.min(...points.map((point) => point[0])),
    minZ: Math.min(...points.map((point) => point[1])),
    maxX: Math.max(...points.map((point) => point[0])),
    maxZ: Math.max(...points.map((point) => point[1])),
  };
}

function downsample<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  const sampled: T[] = [];
  const step = (values.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) {
    sampled.push(values[Math.round(index * step)]!);
  }
  return sampled;
}

function distance2(left: Point2, right: Point2): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function distance3(left: [number, number, number], right: [number, number, number]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function rounded(value: number, decimals = 3): number {
  const multiplier = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}
