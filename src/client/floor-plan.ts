export type Vector3Tuple = [number, number, number];

const STANDALONE_FLOOR_PLAN_ID = "standalone-floor-zones";

export type FloorPlanEntity = {
  id: string;
  parent_id: string | null;
  kind: "floor" | "room" | "doorway" | "poi";
  label: string;
  position_json: string | null;
  geometry_json: string | null;
  sort_order?: number;
};

export type PlanRoom = {
  id: string;
  label: string;
  floorId: string;
  points: Array<[number, number]>;
  center: [number, number];
  minY: number;
  maxY: number;
  authoredPosition: Vector3Tuple | null;
  geometryType: "box" | "polygon";
};

export type FloorPlan = {
  id: string;
  label: string;
  rooms: PlanRoom[];
  connectors: PlanRoom[];
  bounds: {
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
  };
};

export type ProjectedFloorPlan = {
  viewBox: string;
  connectors: Array<{
    id: string;
    label: string;
    path: string;
  }>;
  rooms: Array<{
    id: string;
    label: string;
    path: string;
    labelPosition: [number, number];
  }>;
};

export type RoomCameraPose = {
  position: Vector3Tuple;
  target: Vector3Tuple;
  up: Vector3Tuple;
  fovDegrees: number;
};

export function floorPlanDisplayLabel(
  label: string,
  index: number,
  roomCount: number,
): string {
  return roomCount > 2 || label.length > 18 ? String(index + 1) : label;
}

export function buildFloorPlans(entities: FloorPlanEntity[]): FloorPlan[] {
  const floors = entities
    .filter((entity) => entity.kind === "floor")
    .sort(entityOrder);
  const floorById = new Map(floors.map((floor) => [floor.id, floor]));
  const roomsByFloor = new Map<string, PlanRoom[]>();
  const connectorsByFloor = new Map<string, PlanRoom[]>();

  for (const entity of entities.filter((candidate) => candidate.kind === "room").sort(entityOrder)) {
    const floorId = entity.parent_id && floorById.has(entity.parent_id)
      ? entity.parent_id
      : "unassigned";
    const room = parsePlanRoom(entity, floorId);
    if (!room) continue;
    const floorRooms = roomsByFloor.get(floorId) ?? [];
    floorRooms.push(room);
    roomsByFloor.set(floorId, floorRooms);
  }
  for (const entity of entities.filter((candidate) => candidate.kind === "doorway").sort(entityOrder)) {
    const floorId = entity.parent_id && floorById.has(entity.parent_id)
      ? entity.parent_id
      : STANDALONE_FLOOR_PLAN_ID;
    const connector = parsePlanRoom(entity, floorId);
    if (!connector) continue;
    const floorConnectors = connectorsByFloor.get(floorId) ?? [];
    floorConnectors.push(connector);
    connectorsByFloor.set(floorId, floorConnectors);
  }

  const plans: FloorPlan[] = [];
  for (const floor of floors) {
    const rooms = roomsByFloor.get(floor.id);
    if (!rooms?.length) continue;
    const connectors = connectorsByFloor.get(floor.id) ?? [];
    plans.push({
      id: floor.id,
      label: floor.label,
      rooms,
      connectors,
      bounds: boundsForRooms([...rooms, ...connectors]),
    });
  }
  const standaloneFloorZones = floors.flatMap((floor) => {
    if (roomsByFloor.get(floor.id)?.length) return [];
    const zone = parsePlanRoom(floor, STANDALONE_FLOOR_PLAN_ID);
    return zone ? [zone] : [];
  });
  if (standaloneFloorZones.length) {
    const connectors = connectorsByFloor.get(STANDALONE_FLOOR_PLAN_ID) ?? [];
    plans.push({
      id: STANDALONE_FLOOR_PLAN_ID,
      label: standaloneFloorZones.length === 1
        ? standaloneFloorZones[0]!.label
        : "Walkable areas",
      rooms: standaloneFloorZones,
      connectors,
      bounds: boundsForRooms([...standaloneFloorZones, ...connectors]),
    });
  }
  const unassigned = roomsByFloor.get("unassigned");
  if (unassigned?.length) {
    plans.push({
      id: "unassigned",
      label: floors.length ? "Other rooms" : "Floor plan",
      rooms: unassigned,
      connectors: standaloneFloorZones.length
        ? []
        : connectorsByFloor.get(STANDALONE_FLOOR_PLAN_ID) ?? [],
      bounds: boundsForRooms([
        ...unassigned,
        ...(standaloneFloorZones.length
          ? []
          : connectorsByFloor.get(STANDALONE_FLOOR_PLAN_ID) ?? []),
      ]),
    });
  }
  return plans;
}

export function projectFloorPlan(
  plan: FloorPlan,
  width = 400,
  height = 240,
  padding = 20,
): ProjectedFloorPlan {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const safePadding = Math.max(0, Math.min(padding, Math.min(safeWidth, safeHeight) / 2 - 0.5));
  return {
    viewBox: `0 0 ${formatCoordinate(safeWidth)} ${formatCoordinate(safeHeight)}`,
    connectors: plan.connectors.map((connector) => ({
      id: connector.id,
      label: connector.label,
      path: projectedRegionPath(plan, connector, safeWidth, safeHeight, safePadding),
    })),
    rooms: plan.rooms.map((room) => {
      const labelPosition = projectPlanPoint(plan, room.center, safeWidth, safeHeight, safePadding);
      return {
        id: room.id,
        label: room.label,
        path: projectedRegionPath(plan, room, safeWidth, safeHeight, safePadding),
        labelPosition,
      };
    }),
  };
}

function projectedRegionPath(
  plan: FloorPlan,
  region: PlanRoom,
  width: number,
  height: number,
  padding: number,
): string {
  const projected = region.points.map((point) =>
    projectPlanPoint(plan, point, width, height, padding)
  );
  return `${projected.map(([x, y], index) =>
    `${index === 0 ? "M" : "L"}${formatCoordinate(x)} ${formatCoordinate(y)}`
  ).join(" ")} Z`;
}

export function projectPlanPoint(
  plan: FloorPlan,
  point: [number, number],
  width = 400,
  height = 240,
  padding = 20,
): [number, number] {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const safePadding = Math.max(0, Math.min(padding, Math.min(safeWidth, safeHeight) / 2 - 0.5));
  const availableWidth = Math.max(1, safeWidth - safePadding * 2);
  const availableHeight = Math.max(1, safeHeight - safePadding * 2);
  const sceneWidth = Math.max(0.001, plan.bounds.maxX - plan.bounds.minX);
  const sceneHeight = Math.max(0.001, plan.bounds.maxZ - plan.bounds.minZ);
  const scale = Math.min(availableWidth / sceneWidth, availableHeight / sceneHeight);
  const usedWidth = sceneWidth * scale;
  const usedHeight = sceneHeight * scale;
  const offsetX = (safeWidth - usedWidth) / 2;
  const offsetY = (safeHeight - usedHeight) / 2;
  return [
    roundCoordinate(offsetX + (point[0] - plan.bounds.minX) * scale),
    roundCoordinate(offsetY + (plan.bounds.maxZ - point[1]) * scale),
  ];
}

export function locatePlanRoom(
  plan: FloorPlan,
  position: Vector3Tuple,
): PlanRoom | null {
  const point: [number, number] = [position[0], position[2]];
  return plan.rooms.find((room) => pointInPolygon(point, room.points)) ?? null;
}

export function cameraPoseForPlanRoom(room: PlanRoom): RoomCameraPose {
  const verticalExtent = room.maxY - room.minY;
  const authoredY = room.authoredPosition?.[1];
  const eyeY = verticalExtent >= 1.7
    ? Math.min(room.maxY - 0.1, room.minY + 1.6)
    : typeof authoredY === "number"
      ? authoredY
      : room.minY + 1.6;
  const depth = Math.max(...room.points.map((point) => point[1])) -
    Math.min(...room.points.map((point) => point[1]));
  const cameraOffset = Math.min(1.2, Math.max(0.35, depth * 0.18));
  return {
    position: [room.center[0], roundCoordinate(eyeY), roundCoordinate(room.center[1] + cameraOffset)],
    target: [room.center[0], roundCoordinate(Math.min(eyeY, room.minY + 1.25)), room.center[1]],
    up: [0, 1, 0],
    fovDegrees: 58,
  };
}

function parsePlanRoom(entity: FloorPlanEntity, floorId: string): PlanRoom | null {
  if (!entity.geometry_json) return null;
  let geometry: unknown;
  try {
    geometry = JSON.parse(entity.geometry_json) as unknown;
  } catch {
    return null;
  }
  if (!geometry || typeof geometry !== "object") return null;
  const type = Reflect.get(geometry, "type");
  const rawPoints = Reflect.get(geometry, "points");
  if (!Array.isArray(rawPoints)) return null;

  if (type === "box" && rawPoints.length === 2) {
    const first = finitePoint3(rawPoints[0]);
    const second = finitePoint3(rawPoints[1]);
    if (!first || !second) return null;
    const minX = Math.min(first[0], second[0]);
    const maxX = Math.max(first[0], second[0]);
    const minY = Math.min(first[1], second[1]);
    const maxY = Math.max(first[1], second[1]);
    const minZ = Math.min(first[2], second[2]);
    const maxZ = Math.max(first[2], second[2]);
    if (maxX - minX < 0.05 || maxZ - minZ < 0.05) return null;
    return {
      id: entity.id,
      label: entity.label,
      floorId,
      points: [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]],
      center: [(minX + maxX) / 2, (minZ + maxZ) / 2],
      minY,
      maxY,
      authoredPosition: parsePosition(entity.position_json),
      geometryType: "box",
    };
  }

  if (type === "polygon" && rawPoints.length >= 3) {
    const points3 = rawPoints.map(finitePoint3);
    if (points3.some((point) => !point)) return null;
    const finitePoints = points3 as Vector3Tuple[];
    const points = finitePoints.map<[number, number]>((point) => [point[0], point[2]]);
    if (Math.abs(polygonArea(points)) < 0.0025) return null;
    return {
      id: entity.id,
      label: entity.label,
      floorId,
      points,
      center: polygonCenter(points),
      minY: Math.min(...finitePoints.map((point) => point[1])),
      maxY: Math.max(...finitePoints.map((point) => point[1])),
      authoredPosition: parsePosition(entity.position_json),
      geometryType: "polygon",
    };
  }
  return null;
}

function boundsForRooms(rooms: PlanRoom[]): FloorPlan["bounds"] {
  const points = rooms.flatMap((room) => room.points);
  return {
    minX: Math.min(...points.map((point) => point[0])),
    minZ: Math.min(...points.map((point) => point[1])),
    maxX: Math.max(...points.map((point) => point[0])),
    maxZ: Math.max(...points.map((point) => point[1])),
  };
}

function finitePoint3(value: unknown): Vector3Tuple | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const coordinates = value.map(Number);
  if (coordinates.some((coordinate) => !Number.isFinite(coordinate))) return null;
  return [coordinates[0]!, coordinates[1]!, coordinates[2]!];
}

function parsePosition(value: string | null): Vector3Tuple | null {
  if (!value) return null;
  try {
    return finitePoint3(JSON.parse(value));
  } catch {
    return null;
  }
}

function polygonArea(points: Array<[number, number]>): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function polygonCenter(points: Array<[number, number]>): [number, number] {
  const signedArea = polygonArea(points);
  if (Math.abs(signedArea) < 1e-9) {
    return [
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    ];
  }
  let x = 0;
  let z = 0;
  for (const [index, point] of points.entries()) {
    const next = points[(index + 1) % points.length]!;
    const cross = point[0] * next[1] - next[0] * point[1];
    x += (point[0] + next[0]) * cross;
    z += (point[1] + next[1]) * cross;
  }
  return [x / (6 * signedArea), z / (6 * signedArea)];
}

function pointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]!;
    const previousPoint = polygon[previous]!;
    if (pointOnSegment(point, previousPoint, currentPoint)) return true;
    const intersects = (currentPoint[1] > point[1]) !== (previousPoint[1] > point[1]) &&
      point[0] <
        (previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1]) /
          (previousPoint[1] - currentPoint[1]) +
        currentPoint[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointOnSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): boolean {
  const cross = (point[1] - start[1]) * (end[0] - start[0]) -
    (point[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > 1e-8) return false;
  const dot = (point[0] - start[0]) * (end[0] - start[0]) +
    (point[1] - start[1]) * (end[1] - start[1]);
  if (dot < 0) return false;
  const squaredLength = (end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2;
  return dot <= squaredLength;
}

function entityOrder(first: FloorPlanEntity, second: FloorPlanEntity): number {
  return (first.sort_order ?? 0) - (second.sort_order ?? 0) ||
    first.label.localeCompare(second.label) ||
    first.id.localeCompare(second.id);
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function formatCoordinate(value: number): string {
  return String(roundCoordinate(value));
}
