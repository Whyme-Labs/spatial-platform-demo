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
  const rawFloorRectangles = rooms.map((room, index) => {
    const points = room.geometry?.points ?? [];
    const xValues = points.map((point) => Number(point?.[0])).filter(Number.isFinite);
    const zValues = points.map((point) => Number(point?.[2])).filter(Number.isFinite);
    const elevation = Number(room.elevationM);
    if (!xValues.length || !zValues.length || !Number.isFinite(elevation)) {
      throw pipelineError(
        "AUTOMATIC_COLLISION_ROOM_INVALID",
        `Floor-plan room ${room.roomKey ?? index + 1} has no usable metric bounds`,
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
      id: `auto-floor-${room.roomKey ?? index + 1}`,
      min: [Math.min(...xValues), Math.min(...zValues)],
      max: [Math.max(...xValues), Math.max(...zValues)],
      elevation,
      ceilingElevation,
    };
  });
  const rawCeilingRectangles = rawFloorRectangles.map((floor) => ({
    id: floor.id.replace("auto-floor-", "auto-ceiling-"),
    min: [...floor.min],
    max: [...floor.max],
    elevation: floor.ceilingElevation,
  }));
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
  return {
    schemaVersion: "authored-structural-collision-v2",
    provenance,
    floorRectangles: carveAutomaticConnectorOpenings(
      rawFloorRectangles,
      connectorPlans,
      "floor",
    ),
    ceilingRectangles: carveAutomaticConnectorOpenings(
      rawCeilingRectangles,
      connectorPlans,
      "ceiling",
    ),
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
    openings: plan.levels.flatMap((level) => level.openings.map((opening) => ({
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
  const floors = geometry.structuralGeometry?.floorRectangles ?? [];
  const ceilings = geometry.structuralGeometry?.ceilingRectangles ?? [];
  if (!floors.length || !ceilings.length) {
    throw pipelineError(
      "AUTOMATIC_NAVIGATION_LAYOUT_MISSING",
      "Automatic navigation requires structural floor and ceiling metadata",
    );
  }
  const usableFloors = floors.filter((floor) =>
    floor.max[0] - floor.min[0] >= config.agent.radius * 2.5 &&
    floor.max[1] - floor.min[1] >= config.agent.radius * 2.5);
  if (!usableFloors.length) {
    throw pipelineError(
      "AUTOMATIC_NAVIGATION_LAYOUT_EMPTY",
      "Automatic navigation found no player-sized structural floor region",
    );
  }
  const largestFloor = usableFloors.reduce((largest, floor) =>
    rectangleArea(floor) > rectangleArea(largest) ? floor : largest);
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
    position: safeRectanglePoint(largestFloor, connectorBounds, config.agent.radius),
  };
  const destinationFloors = largestFloorPerElevation(usableFloors);
  return {
    ...config,
    bounds: [minimum, maximum],
    spawn,
    destinations: destinationFloors.map((floor, index) => ({
      id: `automatic-level-${index + 1}`,
      position: safeRectanglePoint(floor, connectorBounds, config.agent.radius),
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
    hole: {
      min: [
        Math.min(...footprint.map((point) => point[0])),
        Math.min(...footprint.map((point) => point[1])),
      ],
      max: [
        Math.max(...footprint.map((point) => point[0])),
        Math.max(...footprint.map((point) => point[1])),
      ],
    },
    surfaces,
  };
}

function carveAutomaticConnectorOpenings(rectangles, connectors, label) {
  let carved = rectangles;
  for (const connector of connectors) {
    carved = carved.flatMap((rectangle) =>
      !automaticConnectorCrossesRectangle(rectangle, connector, label)
        ? [rectangle]
        : subtractAutomaticRectangle(rectangle, connector.hole, label));
  }
  return carved;
}

function automaticConnectorCrossesRectangle(rectangle, connector, label) {
  if (label === "ceiling") {
    return rectangle.elevation > connector.lowerElevation + 0.1 &&
      rectangle.elevation <= connector.upperElevation + 0.2;
  }
  return Math.min(
    Math.abs(rectangle.elevation - connector.lowerElevation),
    Math.abs(rectangle.elevation - connector.upperElevation),
  ) <= 0.2;
}

function subtractAutomaticRectangle(rectangle, hole, label) {
  const overlap = {
    min: [Math.max(rectangle.min[0], hole.min[0]), Math.max(rectangle.min[1], hole.min[1])],
    max: [Math.min(rectangle.max[0], hole.max[0]), Math.min(rectangle.max[1], hole.max[1])],
  };
  if (overlap.min[0] >= overlap.max[0] || overlap.min[1] >= overlap.max[1]) {
    return [rectangle];
  }
  const candidates = [
    { min: rectangle.min, max: [overlap.min[0], rectangle.max[1]] },
    { min: [overlap.max[0], rectangle.min[1]], max: rectangle.max },
    { min: rectangle.min, max: [rectangle.max[0], overlap.min[1]] },
    { min: [rectangle.min[0], overlap.max[1]], max: rectangle.max },
  ].filter((candidate) =>
    candidate.max[0] - candidate.min[0] >= 0.05 &&
    candidate.max[1] - candidate.min[1] >= 0.05);
  return candidates.map((candidate, index) => ({
    id: `${rectangle.id}-${label}-cut-${index + 1}`,
    min: candidate.min.map(Number),
    max: candidate.max.map(Number),
    elevation: rectangle.elevation,
  }));
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

function largestFloorPerElevation(floors) {
  const byElevation = new Map();
  for (const floor of floors) {
    const key = Math.round(floor.elevation * 20) / 20;
    const current = byElevation.get(key);
    if (!current || rectangleArea(floor) > rectangleArea(current)) byElevation.set(key, floor);
  }
  return [...byElevation.values()].sort((left, right) => left.elevation - right.elevation);
}

function rectangleArea(rectangle) {
  return (rectangle.max[0] - rectangle.min[0]) * (rectangle.max[1] - rectangle.min[1]);
}

function safeRectanglePoint(rectangle, exclusions, radius) {
  const insetX = Math.min(
    Math.max(radius * 1.5, 0.3),
    (rectangle.max[0] - rectangle.min[0]) / 2,
  );
  const insetZ = Math.min(
    Math.max(radius * 1.5, 0.3),
    (rectangle.max[1] - rectangle.min[1]) / 2,
  );
  const xValues = [
    rectangle.min[0] + insetX,
    (rectangle.min[0] + rectangle.max[0]) / 2,
    rectangle.max[0] - insetX,
  ];
  const zValues = [
    rectangle.min[1] + insetZ,
    (rectangle.min[1] + rectangle.max[1]) / 2,
    rectangle.max[1] - insetZ,
  ];
  const candidates = xValues.flatMap((x) => zValues.map((z) => [x, z]));
  const clearance = (point, bounds) => Math.hypot(
    Math.max(bounds.min[0] - point[0], 0, point[0] - bounds.max[0]),
    Math.max(bounds.min[1] - point[1], 0, point[1] - bounds.max[1]),
  );
  const selected = candidates.sort((left, right) => {
    const leftClearance = exclusions.length
      ? Math.min(...exclusions.map((bounds) => clearance(left, bounds)))
      : Number.POSITIVE_INFINITY;
    const rightClearance = exclusions.length
      ? Math.min(...exclusions.map((bounds) => clearance(right, bounds)))
      : Number.POSITIVE_INFINITY;
    return rightClearance - leftClearance;
  })[0];
  return [selected[0], rectangle.elevation, selected[1]];
}

function addAlong(origin, direction, distance) {
  return [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance];
}

function pipelineError(code, message, details = {}) {
  return new AutomaticSpatialPipelineError(code, message, {
    failureClass: "input_validation",
    retryable: false,
    details,
  });
}
