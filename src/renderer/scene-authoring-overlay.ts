import type { Vector3Tuple } from "../shared/navigation-runtime";

export type SceneAuthoringOverlayKind =
  | "room"
  | "wall"
  | "door"
  | "window"
  | "unknown-opening"
  | "connector";

export type SceneAuthoringOverlaySegment = {
  kind: SceneAuthoringOverlayKind;
  start: Vector3Tuple;
  end: Vector3Tuple;
};

export function sceneAuthoringOverlaySegments(value: unknown): SceneAuthoringOverlaySegment[] {
  if (!value || typeof value !== "object") return [];
  const levels = Reflect.get(value, "levels");
  const connectors = Reflect.get(value, "connectors");
  if (!Array.isArray(levels)) return [];
  const segments: SceneAuthoringOverlaySegment[] = [];
  for (const level of levels) {
    if (!level || typeof level !== "object") continue;
    const elevation = Number(Reflect.get(level, "elevationM"));
    if (!Number.isFinite(elevation)) continue;
    for (const room of arrayProperty(level, "rooms")) {
      const points = point2Array(Reflect.get(room, "points"));
      if (points.length < 3) continue;
      for (let index = 0; index < points.length; index += 1) {
        segments.push({
          kind: "room",
          start: [points[index]![0], elevation, points[index]![1]],
          end: [points[(index + 1) % points.length]![0], elevation, points[(index + 1) % points.length]![1]],
        });
      }
    }
    for (const wall of arrayProperty(level, "walls")) {
      const start = point2(Reflect.get(wall, "start"));
      const end = point2(Reflect.get(wall, "end"));
      if (!start || !end) continue;
      segments.push({
        kind: "wall",
        start: [start[0], elevation, start[1]],
        end: [end[0], elevation, end[1]],
      });
    }
    for (const opening of arrayProperty(level, "openings")) {
      const start = point2(Reflect.get(opening, "start"));
      const end = point2(Reflect.get(opening, "end"));
      if (!start || !end) continue;
      const type = Reflect.get(opening, "type");
      segments.push({
        kind: type === "door" || type === "opening"
          ? "door"
          : type === "window"
            ? "window"
            : "unknown-opening",
        start: [start[0], elevation, start[1]],
        end: [end[0], elevation, end[1]],
      });
    }
  }
  if (Array.isArray(connectors)) {
    for (const connector of connectors) {
      const points = connector && typeof connector === "object"
        ? point3Array(Reflect.get(connector, "points"))
        : [];
      for (let index = 1; index < points.length; index += 1) {
        segments.push({ kind: "connector", start: points[index - 1]!, end: points[index]! });
      }
      if (points.length > 2) {
        segments.push({ kind: "connector", start: points.at(-1)!, end: points[0]! });
      }
    }
  }
  return segments;
}

function arrayProperty(value: object, property: string): object[] {
  const result = Reflect.get(value, property);
  return Array.isArray(result)
    ? result.filter((item): item is object => Boolean(item) && typeof item === "object")
    : [];
}

function point2Array(value: unknown): Array<[number, number]> {
  return Array.isArray(value) ? value.map(point2).filter((point) => point !== null) : [];
}

function point3Array(value: unknown): Vector3Tuple[] {
  return Array.isArray(value) ? value.map(point3).filter((point) => point !== null) : [];
}

function point2(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2 ||
    value.some((coordinate) => !Number.isFinite(coordinate))) return null;
  return [Number(value[0]), Number(value[1])];
}

function point3(value: unknown): Vector3Tuple | null {
  if (!Array.isArray(value) || value.length !== 3 ||
    value.some((coordinate) => !Number.isFinite(coordinate))) return null;
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}
