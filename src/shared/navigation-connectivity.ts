export type WalkableEntityKind = "floor" | "room" | "doorway";

export type WalkableSnapshotEntity = {
  id: string;
  kind: WalkableEntityKind;
  label: string;
  geometry_json: string | null;
};

type Point2 = [number, number];

type ParsedWalkableEntity = {
  id: string;
  kind: WalkableEntityKind;
  label: string;
  ring: Point2[];
};

export type WalkableConnectivityComponent = {
  regionIds: string[];
  regionLabels: string[];
};

export type WalkableConnectivityInspection = {
  primaryRegionCount: number;
  connectorCount: number;
  componentCount: number;
  components: WalkableConnectivityComponent[];
};

const GEOMETRY_EPSILON = 1e-7;

/**
 * Checks the authored XZ topology frozen into a release. Rooms take precedence
 * over floors exactly as they do in the runtime compiler; doorway entities are
 * traversal connectors and do not become destination regions themselves.
 */
export function inspectWalkableConnectivity(
  rows: unknown[],
): WalkableConnectivityInspection {
  const parsed = rows.flatMap(parseWalkableEntity);
  const primaryKind: "room" | "floor" = parsed.some((entity) => entity.kind === "room")
    ? "room"
    : "floor";
  const primaryRegions = parsed.filter((entity) => entity.kind === primaryKind);
  const connectors = parsed.filter((entity) => entity.kind === "doorway");
  if (primaryRegions.length === 0) {
    return {
      primaryRegionCount: 0,
      connectorCount: connectors.length,
      componentCount: 0,
      components: [],
    };
  }

  const traversable = [...primaryRegions, ...connectors];
  const adjacency = traversable.map(() => [] as number[]);
  for (let left = 0; left < traversable.length; left += 1) {
    for (let right = left + 1; right < traversable.length; right += 1) {
      if (!ringsShareTraversableArea(traversable[left]!.ring, traversable[right]!.ring)) {
        continue;
      }
      adjacency[left]!.push(right);
      adjacency[right]!.push(left);
    }
  }

  const visited = new Set<number>();
  const components: WalkableConnectivityComponent[] = [];
  for (let start = 0; start < primaryRegions.length; start += 1) {
    if (visited.has(start)) continue;
    const pending = [start];
    const regionIndices: number[] = [];
    visited.add(start);
    while (pending.length > 0) {
      const current = pending.shift()!;
      if (current < primaryRegions.length) regionIndices.push(current);
      for (const neighbor of adjacency[current]!) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    regionIndices.sort((left, right) => left - right);
    components.push({
      regionIds: regionIndices.map((index) => primaryRegions[index]!.id),
      regionLabels: regionIndices.map((index) => primaryRegions[index]!.label),
    });
  }

  return {
    primaryRegionCount: primaryRegions.length,
    connectorCount: connectors.length,
    componentCount: components.length,
    components,
  };
}

function parseWalkableEntity(row: unknown): ParsedWalkableEntity[] {
  if (!row || typeof row !== "object") return [];
  const kind = Reflect.get(row, "kind");
  if (kind !== "floor" && kind !== "room" && kind !== "doorway") return [];
  const geometryJson = Reflect.get(row, "geometry_json");
  if (typeof geometryJson !== "string") return [];
  let geometry: unknown;
  try {
    geometry = JSON.parse(geometryJson);
  } catch {
    return [];
  }
  if (!geometry || typeof geometry !== "object") return [];
  const points = Reflect.get(geometry, "points");
  if (!Array.isArray(points)) return [];

  let ring: Point2[];
  if (Reflect.get(geometry, "type") === "polygon" && points.length >= 3) {
    const parsed = points.map(pointOnWalkablePlane);
    if (parsed.some((point) => point === null)) return [];
    ring = parsed as Point2[];
  } else if (Reflect.get(geometry, "type") === "box" && points.length === 2) {
    const first = pointOnWalkablePlane(points[0]);
    const second = pointOnWalkablePlane(points[1]);
    if (!first || !second) return [];
    const minX = Math.min(first[0], second[0]);
    const maxX = Math.max(first[0], second[0]);
    const minZ = Math.min(first[1], second[1]);
    const maxZ = Math.max(first[1], second[1]);
    ring = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
  } else {
    return [];
  }
  if (Math.abs(signedRingArea(ring)) <= GEOMETRY_EPSILON) return [];
  return [{
    id: String(Reflect.get(row, "id") ?? ""),
    kind,
    label: String(Reflect.get(row, "label") ?? "Walkable region"),
    ring,
  }];
}

function pointOnWalkablePlane(value: unknown): Point2 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const x = Number(value[0]);
  const z = Number(value[2]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return [x, z];
}

function ringsShareTraversableArea(left: Point2[], right: Point2[]): boolean {
  if (left.some((point) => pointStrictlyInsideRing(point, right))) return true;
  if (right.some((point) => pointStrictlyInsideRing(point, left))) return true;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const leftStart = left[leftIndex]!;
    const leftEnd = left[(leftIndex + 1) % left.length]!;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const rightStart = right[rightIndex]!;
      const rightEnd = right[(rightIndex + 1) % right.length]!;
      if (segmentsProperlyIntersect(leftStart, leftEnd, rightStart, rightEnd)) return true;
      if (collinearOverlapLength(leftStart, leftEnd, rightStart, rightEnd) > GEOMETRY_EPSILON) {
        return true;
      }
    }
  }
  return false;
}

function pointStrictlyInsideRing(point: Point2, ring: Point2[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index]!;
    const previousPoint = ring[previous]!;
    if (pointOnSegment(point, previousPoint, currentPoint)) return false;
    const crosses = (currentPoint[1] > point[1]) !== (previousPoint[1] > point[1]);
    if (
      crosses &&
      point[0] <
        (previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1]) /
          (previousPoint[1] - currentPoint[1]) + currentPoint[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsProperlyIntersect(
  firstStart: Point2,
  firstEnd: Point2,
  secondStart: Point2,
  secondEnd: Point2,
): boolean {
  const firstA = orientation(firstStart, firstEnd, secondStart);
  const firstB = orientation(firstStart, firstEnd, secondEnd);
  const secondA = orientation(secondStart, secondEnd, firstStart);
  const secondB = orientation(secondStart, secondEnd, firstEnd);
  return firstA * firstB < -GEOMETRY_EPSILON && secondA * secondB < -GEOMETRY_EPSILON;
}

function collinearOverlapLength(
  firstStart: Point2,
  firstEnd: Point2,
  secondStart: Point2,
  secondEnd: Point2,
): number {
  if (
    Math.abs(orientation(firstStart, firstEnd, secondStart)) > GEOMETRY_EPSILON ||
    Math.abs(orientation(firstStart, firstEnd, secondEnd)) > GEOMETRY_EPSILON
  ) return 0;
  const useX = Math.abs(firstEnd[0] - firstStart[0]) >= Math.abs(firstEnd[1] - firstStart[1]);
  const firstMin = Math.min(firstStart[useX ? 0 : 1], firstEnd[useX ? 0 : 1]);
  const firstMax = Math.max(firstStart[useX ? 0 : 1], firstEnd[useX ? 0 : 1]);
  const secondMin = Math.min(secondStart[useX ? 0 : 1], secondEnd[useX ? 0 : 1]);
  const secondMax = Math.max(secondStart[useX ? 0 : 1], secondEnd[useX ? 0 : 1]);
  return Math.max(0, Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin));
}

function pointOnSegment(point: Point2, start: Point2, end: Point2): boolean {
  if (Math.abs(orientation(start, end, point)) > GEOMETRY_EPSILON) return false;
  return point[0] >= Math.min(start[0], end[0]) - GEOMETRY_EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + GEOMETRY_EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - GEOMETRY_EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + GEOMETRY_EPSILON;
}

function orientation(first: Point2, second: Point2, third: Point2): number {
  return (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0]);
}

function signedRingArea(ring: Point2[]): number {
  return ring.reduce((area, point, index) => {
    const next = ring[(index + 1) % ring.length]!;
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}
