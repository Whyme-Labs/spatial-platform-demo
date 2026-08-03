import type { Vector3Tuple } from "../shared/navigation-runtime";

export type EditableFloorplan = {
  schemaVersion: "1.0.0";
  units: "metres";
  coordinateFrame: "registered_y_up_metric_frame";
  levels: EditableFloorplanLevel[];
  connectors: EditableFloorplanConnector[];
};

export type EditableFloorplanLevel = {
  id: string;
  label: string;
  elevationM: number;
  ceilingElevationM: number | null;
  rooms: Array<{ id: string; label: string; points: Array<[number, number]> }>;
  walls: Array<{
    id: string;
    label: string;
    start: [number, number];
    end: [number, number];
    thicknessM: number;
    heightM: number;
  }>;
  openings: Array<{
    id: string;
    label: string;
    type: "door" | "window" | "opening" | "unknown";
    wallId: string | null;
    start: [number, number];
    end: [number, number];
    widthM: number;
    heightM: number | null;
  }>;
};

export type EditableFloorplanConnector = {
  id: string;
  label: string;
  type: "stairs" | "ramp" | "unknown";
  lowerLevelId: string;
  upperLevelId: string;
  points: Vector3Tuple[];
};

export type RenderNativeCorrectionMode =
  | "room"
  | "wall"
  | "door"
  | "window"
  | "stairs"
  | "ramp"
  | "remove";

export type RenderNativeCorrectionResult = {
  plan: EditableFloorplan;
  summary: string;
  affectedId: string;
};

export function applyRenderNativeFloorplanCorrection(
  source: EditableFloorplan,
  mode: RenderNativeCorrectionMode,
  points: Vector3Tuple[],
  createId: () => string = () => crypto.randomUUID(),
): RenderNativeCorrectionResult {
  const required = mode === "remove" ? 1 : mode === "room" ? 3 :
    mode === "stairs" || mode === "ramp" ? 4 : 2;
  if (points.length < required || points.some((point) =>
    point.length !== 3 || point.some((coordinate) => !Number.isFinite(coordinate)))) {
    throw new Error(`${correctionLabel(mode)} needs ${required} finite rendered point${required === 1 ? "" : "s"}.`);
  }
  if (!source.levels.length) throw new Error("The corrected plan has no registered level.");
  const plan = structuredClone(source);
  if (mode === "remove") return removeNearestStructure(plan, points[0]!);
  if (mode === "stairs" || mode === "ramp") {
    return appendConnector(plan, mode, points, createId());
  }
  const level = levelAtOrBelow(plan.levels, Math.min(...points.map((point) => point[1])));
  const id = createId();
  if (mode === "room") {
    level.rooms.push({
      id,
      label: `Room ${level.rooms.length + 1}`,
      points: points.map(([x, _y, z]) => [x, z]),
    });
    return { plan, affectedId: id, summary: `${level.label}: room added from rendered marks` };
  }
  if (mode === "wall") {
    const template = level.walls[0];
    if (!template) {
      throw new Error(`${level.label} has no measured wall thickness or height to reuse.`);
    }
    const [start, end] = points;
    level.walls.push({
      id,
      label: `Wall ${level.walls.length + 1}`,
      start: [start![0], start![2]],
      end: [end![0], end![2]],
      thicknessM: template.thicknessM,
      heightM: template.heightM,
    });
    return { plan, affectedId: id, summary: `${level.label}: wall added from rendered marks` };
  }
  const [start, end] = points;
  const type = mode;
  level.openings.push({
    id,
    label: `${mode === "door" ? "Doorway" : "Window"} ${level.openings.length + 1}`,
    type,
    wallId: nearestWallId(level, [
      (start![0] + end![0]) / 2,
      (start![2] + end![2]) / 2,
    ]),
    start: [start![0], start![2]],
    end: [end![0], end![2]],
    widthM: Math.hypot(end![0] - start![0], end![2] - start![2]),
    heightM: null,
  });
  return {
    plan,
    affectedId: id,
    summary: `${level.label}: ${mode === "door" ? "passable doorway" : "blocked window"} marked on render`,
  };
}

function appendConnector(
  plan: EditableFloorplan,
  type: "stairs" | "ramp",
  points: Vector3Tuple[],
  id: string,
): RenderNativeCorrectionResult {
  const lower = closestLevel(plan.levels, Math.min(...points.map((point) => point[1])));
  const upper = closestLevel(plan.levels, Math.max(...points.map((point) => point[1])));
  if (lower.id === upper.id) {
    throw new Error(`${correctionLabel(type)} marks do not reach two registered levels.`);
  }
  const ordered = lower.elevationM < upper.elevationM
    ? [lower, upper]
    : [upper, lower];
  plan.connectors.push({
    id,
    label: `${type === "stairs" ? "Stairs" : "Ramp"} ${plan.connectors.length + 1}`,
    type,
    lowerLevelId: ordered[0]!.id,
    upperLevelId: ordered[1]!.id,
    points: points.map((point) => [...point] as Vector3Tuple),
  });
  return {
    plan,
    affectedId: id,
    summary: `${ordered[0]!.label} → ${ordered[1]!.label}: ${type} added from rendered marks`,
  };
}

function removeNearestStructure(
  plan: EditableFloorplan,
  point: Vector3Tuple,
): RenderNativeCorrectionResult {
  type Candidate = {
    id: string;
    label: string;
    kind: "opening" | "wall" | "connector" | "room";
    distance: number;
    priority: number;
    remove: () => void;
  };
  const level = levelAtOrBelow(plan.levels, point[1]);
  const point2: [number, number] = [point[0], point[2]];
  const candidates: Candidate[] = [];
  for (const opening of level.openings) {
    candidates.push({
      id: opening.id,
      label: opening.label,
      kind: "opening",
      priority: 0,
      distance: distanceToSegment2(point2, opening.start, opening.end),
      remove: () => removeById(level.openings, opening.id),
    });
  }
  for (const wall of level.walls) {
    candidates.push({
      id: wall.id,
      label: wall.label,
      kind: "wall",
      priority: 1,
      distance: distanceToSegment2(point2, wall.start, wall.end),
      remove: () => removeById(level.walls, wall.id),
    });
  }
  for (const connector of plan.connectors) {
    candidates.push({
      id: connector.id,
      label: connector.label,
      kind: "connector",
      priority: 2,
      distance: distanceToPolyline3(point, connector.points),
      remove: () => removeById(plan.connectors, connector.id),
    });
  }
  for (const room of level.rooms) {
    candidates.push({
      id: room.id,
      label: room.label,
      kind: "room",
      priority: 3,
      distance: distanceToPolygon2(point2, room.points),
      remove: () => removeById(level.rooms, room.id),
    });
  }
  const selected = candidates.sort((left, right) =>
    left.distance - right.distance || left.priority - right.priority)[0];
  if (!selected) throw new Error(`${level.label} has no structure to remove.`);
  selected.remove();
  return {
    plan,
    affectedId: selected.id,
    summary: `${level.label}: removed ${selected.kind} “${selected.label}”`,
  };
}

function levelAtOrBelow(levels: EditableFloorplanLevel[], elevation: number): EditableFloorplanLevel {
  const ordered = [...levels].sort((left, right) => left.elevationM - right.elevationM);
  return [...ordered].reverse().find((level) => level.elevationM <= elevation) ?? ordered[0]!;
}

function closestLevel(levels: EditableFloorplanLevel[], elevation: number): EditableFloorplanLevel {
  return [...levels].sort((left, right) =>
    Math.abs(left.elevationM - elevation) - Math.abs(right.elevationM - elevation) ||
    left.elevationM - right.elevationM)[0]!;
}

function nearestWallId(level: EditableFloorplanLevel, point: [number, number]): string | null {
  return [...level.walls].sort((left, right) =>
    distanceToSegment2(point, left.start, left.end) -
    distanceToSegment2(point, right.start, right.end))[0]?.id ?? null;
}

function removeById(values: Array<{ id: string }>, id: string): void {
  const index = values.findIndex((value) => value.id === id);
  if (index >= 0) values.splice(index, 1);
}

function distanceToPolyline3(point: Vector3Tuple, points: Vector3Tuple[]): number {
  if (points.length === 1) return distance3(point, points[0]!);
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(distance, distanceToSegment3(point, points[index - 1]!, points[index]!));
  }
  return distance;
}

function distanceToPolygon2(point: [number, number], polygon: Array<[number, number]>): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    distance = Math.min(distance, distanceToSegment2(
      point,
      polygon[index]!,
      polygon[(index + 1) % polygon.length]!,
    ));
  }
  return distance;
}

function distanceToSegment2(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): number {
  const delta: [number, number] = [end[0] - start[0], end[1] - start[1]];
  const denominator = delta[0] * delta[0] + delta[1] * delta[1];
  const amount = denominator === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - start[0]) * delta[0] + (point[1] - start[1]) * delta[1]) / denominator));
  return Math.hypot(
    point[0] - (start[0] + delta[0] * amount),
    point[1] - (start[1] + delta[1] * amount),
  );
}

function distanceToSegment3(point: Vector3Tuple, start: Vector3Tuple, end: Vector3Tuple): number {
  const delta = end.map((coordinate, axis) => coordinate - start[axis]!) as Vector3Tuple;
  const denominator = delta.reduce((sum, coordinate) => sum + coordinate * coordinate, 0);
  const amount = denominator === 0 ? 0 : Math.max(0, Math.min(1,
    point.reduce((sum, coordinate, axis) =>
      sum + (coordinate - start[axis]!) * delta[axis]!, 0) / denominator));
  return distance3(point, start.map((coordinate, axis) =>
    coordinate + delta[axis]! * amount) as Vector3Tuple);
}

function distance3(first: Vector3Tuple, second: Vector3Tuple): number {
  return Math.hypot(...first.map((coordinate, axis) => coordinate - second[axis]!));
}

function correctionLabel(mode: RenderNativeCorrectionMode): string {
  if (mode === "door") return "Doorway";
  if (mode === "window") return "Window";
  if (mode === "remove") return "Remove structure";
  return `${mode[0]!.toUpperCase()}${mode.slice(1)}`;
}
