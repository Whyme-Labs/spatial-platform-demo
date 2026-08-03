import { Earcut } from "three/src/extras/Earcut.js";
import {
  pointInPolygon2,
  pointOnRing2,
  segmentsIntersect2,
} from "./horizontal-surface.mjs";

export class AutomaticSpatialPipelineError extends Error {
  constructor(code, message, {
    failureClass = "input_validation",
    retryable = false,
    details = {},
  } = {}) {
    super(message);
    this.name = "AutomaticSpatialPipelineError";
    this.code = code;
    this.failureClass = failureClass;
    this.retryable = retryable;
    this.details = details;
  }
}

export function automaticStructuralCollisionConfig(report, {
  provenance = "registered_metric_mesh",
} = {}) {
  const rooms = Array.isArray(report.rooms) ? report.rooms : [];
  const walls = Array.isArray(report.walls) ? report.walls : [];
  const openings = Array.isArray(report.openings) ? report.openings : [];
  const connectors = Array.isArray(report.connectors) ? report.connectors : [];
  const levels = Array.isArray(report.levels) ? report.levels : [];
  if (!rooms.length || !walls.length) {
    throw pipelineError(
      "AUTOMATIC_COLLISION_INCOMPLETE",
      "Automatic navigation requires at least one inferred room and structural wall",
    );
  }
  const levelByKey = new Map(levels.map((level) => [level.levelKey, level]));
  const connectorPlans = connectors.map((connector, index) => {
    const points = connector.geometry?.points ?? [];
    if (points.length < 3 || points.some((point) =>
      !Array.isArray(point) || point.length !== 3 ||
      point.some((value) => !Number.isFinite(Number(value))))) {
      throw pipelineError(
        "AUTOMATIC_COLLISION_CONNECTOR_INVALID",
        `Floor-plan connector ${connector.connectorKey ?? index + 1} has no usable metric surface`,
      );
    }
    return automaticConnectorTreads({
      id: `auto-${connector.connectorKey ?? `connector-${index + 1}`}`,
      points: points.map((point) => point.map(Number)),
    });
  });
  const roomSurfaces = rooms.map((room, index) => {
    const sourcePoints = room.geometry?.points ?? [];
    const points = sourcePoints.map((point) => Array.isArray(point)
      ? [Number(point[0]), Number(point[1]), Number(point[2])]
      : []);
    const elevation = Number(room.elevationM);
    if (
      points.length < 3 || points.some((point) =>
        point.length !== 3 || point.some((coordinate) => !Number.isFinite(coordinate))) ||
      !Number.isFinite(elevation)
    ) {
      throw pipelineError(
        "AUTOMATIC_COLLISION_ROOM_INVALID",
        `Floor-plan room ${room.roomKey ?? index + 1} has no usable metric polygon`,
      );
    }
    const levelKey = String(room.evidence?.levelKey ?? "");
    const level = levelByKey.get(levelKey);
    const ceilingElevation = Number(level?.ceilingElevationM);
    if (!level || !Number.isFinite(ceilingElevation) || ceilingElevation - elevation < 1.8) {
      throw pipelineError(
        "AUTOMATIC_COLLISION_CEILING_MISSING",
        `Floor-plan level ${levelKey || "unknown"} has no captured or operator-reviewed ceiling support`,
        { roomKey: room.roomKey ?? null, levelKey: levelKey || null },
      );
    }
    return {
      roomKey: String(room.roomKey ?? index + 1),
      points: points.map(([x, _y, z]) => [x, elevation, z]),
      elevation,
      ceilingElevation,
    };
  });
  const floorSurfaces = roomSurfaces.map((room) => horizontalRoomSurface(
    `auto-floor-${room.roomKey}`,
    room.points,
    room.elevation,
    connectorPlans,
    "floor",
  ));
  const ceilingSurfaces = roomSurfaces.map((room) => horizontalRoomSurface(
    `auto-ceiling-${room.roomKey}`,
    room.points.map(([x, _y, z]) => [x, room.ceilingElevation, z]),
    room.ceilingElevation,
    connectorPlans,
    "ceiling",
  ));
  const barrierSegments = walls.flatMap((wall, wallIndex) => {
    const points = wall.geometry?.points ?? [];
    const start = [Number(points[0]?.[0]), Number(points[0]?.[2])];
    const end = [Number(points[1]?.[0]), Number(points[1]?.[2])];
    if (![...start, ...end].every(Number.isFinite)) return [];
    const minY = Number(wall.elevationM);
    const maxY = minY + Number(wall.heightM);
    return splitBarrierAroundOpenings(
      start,
      end,
      openings,
      Number(wall.thicknessM) || 0.2,
      minY,
    )
      .map((segment, segmentIndex) => ({
        id: `auto-barrier-${wall.wallKey ?? wallIndex + 1}-${segmentIndex + 1}`,
        start: segment.start,
        end: segment.end,
        minY,
        maxY,
      }));
  });
  if (!barrierSegments.length) {
    throw pipelineError(
      "AUTOMATIC_COLLISION_WALLS_INVALID",
      "Automatic navigation could not derive structural barrier segments",
    );
  }
  return {
    schemaVersion: "authored-structural-collision-v2",
    provenance,
    floorSurfaces,
    ceilingSurfaces,
    barrierSegments,
    connectorSurfaces: connectorPlans.flatMap((plan) => plan.surfaces),
    furnitureBoxes: [],
    dynamicBarrierBoxes: [],
  };
}

export function structuralCollisionConfigFromReviewPlan(plan) {
  const levels = plan.levels.map((level) => ({
    levelKey: level.id,
    label: level.label,
    elevationM: level.elevationM,
    ceilingElevationM: level.ceilingElevationM,
  }));
  return automaticStructuralCollisionConfig({
    levels,
    rooms: plan.levels.flatMap((level) => level.rooms.map((room) => ({
      roomKey: room.id,
      elevationM: level.elevationM,
      geometry: {
        type: "polygon",
        points: room.points.map(([x, z]) => [x, level.elevationM, z]),
      },
      evidence: { levelKey: level.id },
    }))),
    walls: plan.levels.flatMap((level) => level.walls.map((wall) => ({
      wallKey: wall.id,
      elevationM: level.elevationM,
      heightM: wall.heightM,
      thicknessM: wall.thicknessM,
      geometry: {
        type: "line",
        points: [
          [wall.start[0], level.elevationM, wall.start[1]],
          [wall.end[0], level.elevationM, wall.end[1]],
        ],
      },
      evidence: { levelKey: level.id },
    }))),
    openings: plan.levels.flatMap((level) => level.openings
      .filter((opening) => opening.type === "door" || opening.type === "opening")
      .map((opening) => ({
      openingKey: opening.id,
      elevationM: level.elevationM,
      widthM: opening.widthM,
      heightM: opening.heightM ?? null,
      geometry: {
        type: "line",
        points: [
          [opening.start[0], level.elevationM, opening.start[1]],
          [opening.end[0], level.elevationM, opening.end[1]],
        ],
      },
      evidence: { levelKey: level.id },
      }))),
    connectors: plan.connectors.map((connector) => ({
      connectorKey: connector.id,
      geometry: { type: "polygon", points: connector.points },
    })),
  }, { provenance: "operator_reviewed" });
}

export function automaticNavigationLayout(config, geometry) {
  const floors = horizontalNavigationSurfaces(geometry.structuralGeometry, "floor");
  const ceilings = horizontalNavigationSurfaces(geometry.structuralGeometry, "ceiling");
  if (!floors.length || !ceilings.length) {
    throw pipelineError(
      "AUTOMATIC_NAVIGATION_LAYOUT_MISSING",
      "Automatic navigation requires structural floor and ceiling metadata",
    );
  }
  const agentDiameter = config.agent.radius * 2;
  const unusableFloors = floors.filter((floor) =>
    floor.max[0] - floor.min[0] <= agentDiameter ||
    floor.max[1] - floor.min[1] <= agentDiameter);
  if (unusableFloors.length) {
    throw pipelineError(
      "AUTOMATIC_NAVIGATION_ROOM_CLEARANCE_UNPROVEN",
      `Automatic navigation cannot prove every inferred room for agent_radius=${config.agent.radius}; blocked_room_ids=${unusableFloors.map((floor) => floor.id).join(",")}`,
      {
        agentRadius: config.agent.radius,
        agentDiameter,
        blockedRooms: unusableFloors.map((floor) => ({
          id: floor.id,
          width: floor.max[0] - floor.min[0],
          depth: floor.max[1] - floor.min[1],
        })),
      },
    );
  }
  const usableFloors = floors;
  const largestFloor = usableFloors.reduce((largest, floor) =>
    floor.area > largest.area ? floor : largest);
  const connectorBounds = (geometry.structuralGeometry?.connectorSurfaces ?? [])
    .map((surface) => ({
      min: [
        Math.min(...surface.points.map((point) => point[0])),
        Math.min(...surface.points.map((point) => point[2])),
      ],
      max: [
        Math.max(...surface.points.map((point) => point[0])),
        Math.max(...surface.points.map((point) => point[2])),
      ],
    }));
  const minimum = [
    Math.min(...floors.map((floor) => floor.min[0])) - 0.5,
    Math.min(...floors.map((floor) => floor.elevation)) - 0.25,
    Math.min(...floors.map((floor) => floor.min[1])) - 0.5,
  ];
  const maximum = [
    Math.max(...floors.map((floor) => floor.max[0])) + 0.5,
    Math.max(...ceilings.map((ceiling) => ceiling.elevation)) + 0.25,
    Math.max(...floors.map((floor) => floor.max[1])) + 0.5,
  ];
  const spawn = {
    id: "automatic-opening",
    position: safeSurfacePoint(largestFloor, connectorBounds),
  };
  return {
    ...config,
    bounds: [minimum, maximum],
    spawn,
    destinations: [...usableFloors]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((floor) => ({
        id: `automatic-room-${floor.id.replace(/^auto-floor-/, "")}`,
        position: safeSurfacePoint(floor, connectorBounds),
      })),
  };
}

function automaticConnectorTreads(connector) {
  const elevations = connector.points.map((point) => point[1]);
  const lowerElevation = Math.min(...elevations);
  const upperElevation = Math.max(...elevations);
  const tolerance = 0.02;
  const lowerEdge = connector.points.filter((point) =>
    Math.abs(point[1] - lowerElevation) <= tolerance);
  const upperEdge = connector.points.filter((point) =>
    Math.abs(point[1] - upperElevation) <= tolerance);
  if (lowerEdge.length !== 2 || upperEdge.length !== 2 ||
    upperElevation - lowerElevation < 0.2) {
    throw pipelineError(
      "AUTOMATIC_COLLISION_CONNECTOR_EDGES_INVALID",
      `Floor-plan connector ${connector.id} must have two endpoints on each level`,
    );
  }
  const center = (edge) => [
    (edge[0][0] + edge[1][0]) / 2,
    (edge[0][2] + edge[1][2]) / 2,
  ];
  const lowerCenter = center(lowerEdge);
  const upperCenter = center(upperEdge);
  const delta = [upperCenter[0] - lowerCenter[0], upperCenter[1] - lowerCenter[1]];
  const run = Math.hypot(...delta);
  if (run < 0.5) {
    throw pipelineError(
      "AUTOMATIC_COLLISION_CONNECTOR_RUN_INVALID",
      `Floor-plan connector ${connector.id} has no usable horizontal run`,
    );
  }
  const direction = delta.map((value) => value / run);
  const side = [-direction[1], direction[0]];
  const lowerWidth = Math.hypot(
    lowerEdge[1][0] - lowerEdge[0][0],
    lowerEdge[1][2] - lowerEdge[0][2],
  );
  const upperWidth = Math.hypot(
    upperEdge[1][0] - upperEdge[0][0],
    upperEdge[1][2] - upperEdge[0][2],
  );
  const width = Math.max(0.65, Math.min(3, (lowerWidth + upperWidth) / 2));
  const rise = upperElevation - lowerElevation;
  const stepCount = Math.max(2, Math.ceil(rise / 0.17));
  const treadOverlap = Math.min(0.08, run / stepCount * 0.26);
  const surfaces = [];
  for (let step = 0; step <= stepCount; step += 1) {
    const amount = step / stepCount;
    const elevation = lowerElevation + rise * amount;
    const startDistance = run * amount;
    const endDistance = startDistance + run / stepCount + treadOverlap;
    const halfWidth = width / 2;
    const start = addAlong(lowerCenter, direction, startDistance);
    const end = addAlong(lowerCenter, direction, endDistance);
    surfaces.push({
      id: `${connector.id}-tread-${String(step + 1).padStart(3, "0")}`,
      points: [
        [start[0] + side[0] * halfWidth, elevation, start[1] + side[1] * halfWidth],
        [end[0] + side[0] * halfWidth, elevation, end[1] + side[1] * halfWidth],
        [end[0] - side[0] * halfWidth, elevation, end[1] - side[1] * halfWidth],
        [start[0] - side[0] * halfWidth, elevation, start[1] - side[1] * halfWidth],
      ],
    });
  }
  const holeStart = addAlong(lowerCenter, direction, 0.8);
  const holeEnd = addAlong(upperCenter, direction, -0.05);
  const holeHalfWidth = width / 2 + 0.2;
  const footprint = [
    [holeStart[0] + side[0] * holeHalfWidth, holeStart[1] + side[1] * holeHalfWidth],
    [holeEnd[0] + side[0] * holeHalfWidth, holeEnd[1] + side[1] * holeHalfWidth],
    [holeEnd[0] - side[0] * holeHalfWidth, holeEnd[1] - side[1] * holeHalfWidth],
    [holeStart[0] - side[0] * holeHalfWidth, holeStart[1] - side[1] * holeHalfWidth],
  ];
  return {
    id: connector.id,
    lowerElevation,
    upperElevation,
    hole: { points: footprint },
    surfaces,
  };
}

function horizontalRoomSurface(id, points, elevation, connectors, label) {
  const outline = points.map(([x, _y, z]) => [x, z]);
  const holes = [];
  for (const connector of connectors) {
    if (!automaticConnectorCrossesElevation(elevation, connector, label)) continue;
    const hole = connector.hole.points.map((point) => [...point]);
    const edgesIntersect = polygonEdges(outline).some(([start, end]) =>
      polygonEdges(hole).some(([holeStart, holeEnd]) =>
        segmentsIntersect2(start, end, holeStart, holeEnd)));
    const holeStrictlyInside = hole.every((point) =>
      pointInPolygon2(point, outline) && !pointOnRing2(point, outline));
    const disjoint = !edgesIntersect &&
      !hole.some((point) => pointInPolygon2(point, outline)) &&
      !outline.some((point) => pointInPolygon2(point, hole));
    if (holeStrictlyInside) {
      holes.push(hole.map(([x, z]) => [x, elevation, z]));
      continue;
    }
    if (disjoint) continue;
    throw pipelineError(
      "AUTOMATIC_COLLISION_CONNECTOR_HOLE_AMBIGUOUS",
      `Connector ${connector.id} only partially overlaps room surface ${id}; classify the landing against the registered render before rebuilding`,
      { connectorId: connector.id, surfaceId: id },
    );
  }
  return {
    id,
    points: points.map(([x, _y, z]) => [x, elevation, z]),
    holes,
  };
}

function automaticConnectorCrossesElevation(elevation, connector, label) {
  if (label === "ceiling") {
    return elevation > connector.lowerElevation + 0.1 &&
      elevation <= connector.upperElevation + 0.2;
  }
  return Math.min(
    Math.abs(elevation - connector.lowerElevation),
    Math.abs(elevation - connector.upperElevation),
  ) <= 0.2;
}

function splitBarrierAroundOpenings(start, end, openings, thickness, wallElevationM) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-8) return [];
  const length = Math.sqrt(lengthSquared);
  const tolerance = Math.max(0.12, thickness);
  const cuts = [];
  for (const opening of openings) {
    const openingElevationM = Number(opening.elevationM);
    if (!Number.isFinite(openingElevationM) ||
      Math.abs(openingElevationM - wallElevationM) > 0.1) continue;
    const points = opening.geometry?.points ?? [];
    const first = [Number(points[0]?.[0]), Number(points[0]?.[2])];
    const second = [Number(points[1]?.[0]), Number(points[1]?.[2])];
    if (![...first, ...second].every(Number.isFinite)) continue;
    const projections = [first, second].map((point) =>
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared);
    const distances = [first, second].map((point, index) => {
      const projected = [
        start[0] + dx * projections[index],
        start[1] + dz * projections[index],
      ];
      return Math.hypot(point[0] - projected[0], point[1] - projected[1]);
    });
    if (Math.max(...distances) > tolerance) continue;
    const from = Math.max(0, Math.min(...projections));
    const to = Math.min(1, Math.max(...projections));
    if (to - from > 1e-4) cuts.push([from, to]);
  }
  cuts.sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const cut of cuts) {
    const prior = merged.at(-1);
    if (prior && cut[0] <= prior[1] + 1e-4) prior[1] = Math.max(prior[1], cut[1]);
    else merged.push([...cut]);
  }
  const intervals = [];
  let cursor = 0;
  for (const cut of merged) {
    if ((cut[0] - cursor) * length > 0.05) intervals.push([cursor, cut[0]]);
    cursor = Math.max(cursor, cut[1]);
  }
  if ((1 - cursor) * length > 0.05) intervals.push([cursor, 1]);
  return intervals.map(([from, to]) => ({
    start: [start[0] + dx * from, start[1] + dz * from],
    end: [start[0] + dx * to, start[1] + dz * to],
  }));
}

function horizontalNavigationSurfaces(structuralGeometry, label) {
  if (!structuralGeometry) return [];
  const surfaces = structuralGeometry[`${label}Surfaces`];
  if (Array.isArray(surfaces) && surfaces.length) {
    return surfaces.map((surface) => navigationSurface(surface));
  }
  const rectangles = structuralGeometry[`${label}Rectangles`] ?? [];
  return rectangles.map((rectangle) => navigationSurface({
    id: rectangle.id,
    points: [
      [rectangle.min[0], rectangle.elevation, rectangle.min[1]],
      [rectangle.min[0], rectangle.elevation, rectangle.max[1]],
      [rectangle.max[0], rectangle.elevation, rectangle.max[1]],
      [rectangle.max[0], rectangle.elevation, rectangle.min[1]],
    ],
    holes: [],
  }));
}

function navigationSurface(surface) {
  const points = surface.points.map((point) => point.map(Number));
  const holes = (surface.holes ?? []).map((hole) => hole.map((point) => point.map(Number)));
  return {
    id: surface.id,
    points,
    holes,
    elevation: points[0][1],
    min: [
      Math.min(...points.map((point) => point[0])),
      Math.min(...points.map((point) => point[2])),
    ],
    max: [
      Math.max(...points.map((point) => point[0])),
      Math.max(...points.map((point) => point[2])),
    ],
    area: Math.abs(polygonArea2(points.map(([x, _y, z]) => [x, z]))) -
      holes.reduce((total, hole) => total + Math.abs(
        polygonArea2(hole.map(([x, _y, z]) => [x, z])),
      ), 0),
  };
}

function safeSurfacePoint(surface, exclusions) {
  const rings = [surface.points, ...surface.holes];
  const allPoints = rings.flat();
  const holeIndices = [];
  let offset = surface.points.length;
  for (const hole of surface.holes) {
    holeIndices.push(offset);
    offset += hole.length;
  }
  const indices = Earcut.triangulate(
    allPoints.flatMap(([x, _y, z]) => [x, z]),
    holeIndices,
    2,
  );
  const candidates = [];
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = indices.slice(index, index + 3).map((pointIndex) => allPoints[pointIndex]);
    const point = [
      triangle.reduce((sum, vertex) => sum + vertex[0], 0) / 3,
      triangle.reduce((sum, vertex) => sum + vertex[2], 0) / 3,
    ];
    candidates.push({ point, area: Math.abs(polygonArea2(
      triangle.map(([x, _y, z]) => [x, z]),
    )) });
  }
  if (!candidates.length) {
    throw pipelineError(
      "AUTOMATIC_NAVIGATION_SURFACE_EMPTY",
      `Automatic navigation surface ${surface.id} could not produce an interior anchor`,
    );
  }
  const clearance = (point, bounds) => Math.hypot(
    Math.max(bounds.min[0] - point[0], 0, point[0] - bounds.max[0]),
    Math.max(bounds.min[1] - point[1], 0, point[1] - bounds.max[1]),
  );
  const selected = candidates.sort((left, right) => {
    const leftClearance = exclusions.length
      ? Math.min(...exclusions.map((bounds) => clearance(left.point, bounds)))
      : Number.POSITIVE_INFINITY;
    const rightClearance = exclusions.length
      ? Math.min(...exclusions.map((bounds) => clearance(right.point, bounds)))
      : Number.POSITIVE_INFINITY;
    return rightClearance - leftClearance || right.area - left.area;
  })[0];
  return [selected.point[0], surface.elevation, selected.point[1]];
}

function polygonArea2(points) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function addAlong(origin, direction, distance) {
  return [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance];
}

function polygonEdges(points) {
  return points.map((point, index) => [point, points[(index + 1) % points.length]]);
}

function pipelineError(code, message, details = {}) {
  return new AutomaticSpatialPipelineError(code, message, {
    failureClass: "input_validation",
    retryable: false,
    details,
  });
}
