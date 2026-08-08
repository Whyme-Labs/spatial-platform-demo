import { Earcut } from "three/src/extras/Earcut.js";
import { semanticCellOutline } from "./processing-agent-core.mjs";
import {
  BARRIER_THICKNESS_MAXIMUM_M,
  BARRIER_THICKNESS_MINIMUM_M,
  BARRIER_THICKNESS_PROVENANCES,
} from "./authored-collision.mjs";
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
    // The subtraction epsilon matters: a ceiling detected at exactly minimum
    // standing clearance (-7.2 over a -9 floor) differs from 1.8 by one ulp and
    // must not fail a >= 1.8 requirement.
    if (!level || !Number.isFinite(ceilingElevation) ||
      ceilingElevation - elevation < 1.8 - 1e-6) {
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
    // A wall with a usable thickness cooks as a prism; the provenance says
    // whether the value is the extractor's estimate or an operator's reviewed
    // correction. Out-of-range thickness falls back to the legacy surface
    // rather than inventing a plausible number.
    const thicknessM = Number(wall.thicknessM);
    const usableThickness = Number.isFinite(thicknessM) &&
      thicknessM >= BARRIER_THICKNESS_MINIMUM_M &&
      thicknessM <= BARRIER_THICKNESS_MAXIMUM_M;
    const thicknessProvenance = BARRIER_THICKNESS_PROVENANCES.has(wall.thicknessProvenance)
      ? wall.thicknessProvenance
      : "estimated";
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
        ...(usableThickness ? { thicknessM, thicknessProvenance } : {}),
      }));
  });
  if (!barrierSegments.length) {
    throw pipelineError(
      "AUTOMATIC_COLLISION_WALLS_INVALID",
      "Automatic navigation could not derive structural barrier segments",
    );
  }
  floorSurfaces.push(
    ...automaticThresholdSurfaces(roomSurfaces, openings),
    ...automaticAdjacencyThresholds(roomSurfaces, barrierSegments),
  );
  const thresholdSurfaces = floorSurfaces.filter((surface) =>
    surface.id.startsWith("auto-threshold-"));
  // A doorway has a lintel: every threshold floor gets a matching ceiling quad
  // at the lower of the joined storeys' ceilings, so the walking volume through
  // the opening is bounded above like the rooms it connects.
  for (const threshold of thresholdSurfaces) {
    const elevation = threshold.points[0][1];
    const ceilings = roomSurfaces
      .filter((room) => Math.abs(room.elevation - elevation) <= 0.15)
      .map((room) => room.ceilingElevation);
    if (!ceilings.length) continue;
    const lintel = Math.min(...ceilings);
    ceilingSurfaces.push({
      id: threshold.id.replace("auto-threshold-", "auto-threshold-ceiling-"),
      points: threshold.points.map(([x, _y, z]) => [x, lintel, z]),
      holes: [],
    });
  }
  barrierSegments.push(
    ...automaticCaptureEdgeSeals(roomSurfaces, barrierSegments, thresholdSurfaces),
  );
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

export function structuralCollisionConfigFromReviewPlan(plan, {
  proposedWallThicknessByKey = new Map(),
} = {}) {
  const levels = plan.levels.map((level) => ({
    levelKey: level.id,
    label: level.label,
    elevationM: level.elevationM,
    ceilingElevationM: level.ceilingElevationM,
  }));
  // A wall whose thickness still equals the machine proposal carries an
  // estimate the operator merely accepted; a changed value — or a wall the
  // proposal never had — is the operator's own reviewed assertion.
  const wallThicknessProvenance = (wall) => {
    const proposed = proposedWallThicknessByKey.get(wall.id);
    return Number.isFinite(proposed) && Math.abs(proposed - wall.thicknessM) <= 1e-6
      ? "estimated"
      : "operator_reviewed";
  };
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
      thicknessProvenance: wallThicknessProvenance(wall),
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
  // Doorway thresholds are deliberately as narrow as the wall is thick. They are
  // links between rooms, not rooms, so they neither owe room clearance nor earn a
  // reachability destination of their own.
  const roomFloors = floors.filter((floor) =>
    !String(floor.id).startsWith(THRESHOLD_SURFACE_ID_PREFIX));
  const unusableFloors = roomFloors.filter((floor) =>
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
  const usableFloors = roomFloors;
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

// Room polygons stop at the faces of the wall between them, so two rooms joined
// by a doorway are still separated by the wall's own thickness. Carving the
// opening out of the barrier is not enough on its own: with no floor across that
// strip the walker has nothing to step onto, and every room becomes its own
// navigation island. Bridge each doorway with the floor the capture implies.
const THRESHOLD_SURFACE_ID_PREFIX = "auto-threshold-";
const THRESHOLD_MAXIMUM_GAP_M = 0.75;
const THRESHOLD_ROOM_EDGE_TOLERANCE_M = 0.35;
const THRESHOLD_ROOM_OVERLAP_M = 0.05;

function automaticThresholdSurfaces(roomSurfaces, openings) {
  const surfaces = [];
  for (const [index, opening] of openings.entries()) {
    const points = opening.geometry?.points ?? [];
    const from = [Number(points[0]?.[0]), Number(points[0]?.[2])];
    const to = [Number(points[1]?.[0]), Number(points[1]?.[2])];
    if (![...from, ...to].every(Number.isFinite)) continue;
    const spanX = to[0] - from[0];
    const spanZ = to[1] - from[1];
    const width = Math.hypot(spanX, spanZ);
    if (width < 1e-3) continue;
    const along = [spanX / width, spanZ / width];
    const normal = [-along[1], along[0]];
    const middle = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];

    const neighbours = roomSurfaces
      .map((room) => ({ room, ...closestOutlinePoint(middle, room.points) }))
      .filter((candidate) => candidate.distance <= THRESHOLD_MAXIMUM_GAP_M)
      .sort((left, right) => left.distance - right.distance);
    if (neighbours.length < 2) continue;
    const [near, far] = neighbours;
    if (near.distance > THRESHOLD_ROOM_EDGE_TOLERANCE_M) continue;
    if (Math.abs(near.room.elevation - far.room.elevation) > 0.1) continue;

    // How far each room sits across the wall, measured along the doorway normal.
    const offsets = [near, far].map((candidate) =>
      (candidate.point[0] - middle[0]) * normal[0] +
      (candidate.point[1] - middle[1]) * normal[1]);
    const gap = Math.abs(offsets[1] - offsets[0]);
    if (gap < 1e-3 || gap > THRESHOLD_MAXIMUM_GAP_M) continue;

    const low = Math.min(...offsets) - THRESHOLD_ROOM_OVERLAP_M;
    const high = Math.max(...offsets) + THRESHOLD_ROOM_OVERLAP_M;
    const half = width / 2;
    const elevation = near.room.elevation;
    const corner = (alongScale, normalScale) => [
      middle[0] + along[0] * alongScale + normal[0] * normalScale,
      elevation,
      middle[1] + along[1] * alongScale + normal[1] * normalScale,
    ];
    surfaces.push({
      id: `${THRESHOLD_SURFACE_ID_PREFIX}${opening.openingKey ?? `opening-${index + 1}`}`,
      points: [
        corner(-half, low),
        corner(half, low),
        corner(half, high),
        corner(-half, high),
      ],
      holes: [],
    });
  }
  return surfaces;
}

// Opening candidates come from gaps in gridline wall runs, which a real
// building's doorways rarely satisfy — measured on a four-storey capture, 1,812
// of 1,923 recorded openings had no second room within three metres, and the
// navmesh fell apart into 92 islands. The honest connective evidence is
// adjacency itself: where two room polygons approach within a doorway's depth
// and the strip between them is free of observed wall geometry, the capture is
// showing a doorway, whether or not the opening detector recorded it.
const ADJACENCY_MAXIMUM_GAP_M = 1.0;
const ADJACENCY_SAMPLE_STEP_M = 0.1;
const ADJACENCY_MINIMUM_RUN_M = 0.7;
// Extend the bridge past both outlines so its voxels provably merge with each
// room's floor; ending exactly on the outline can leave a one-cell seam.
const ADJACENCY_OVERLAP_M = 0.3;
const ADJACENCY_RUN_BREAK_M = 0.25;
const ADJACENCY_MAXIMUM_RUNS_PER_PAIR = 2;
const ADJACENCY_WALL_CLEARANCE_M = 0.01;

function automaticAdjacencyThresholds(roomSurfaces, barrierSegments) {
  const surfaces = [];
  for (let first = 0; first < roomSurfaces.length; first += 1) {
    for (let second = first + 1; second < roomSurfaces.length; second += 1) {
      const roomA = roomSurfaces[first];
      const roomB = roomSurfaces[second];
      if (Math.abs(roomA.elevation - roomB.elevation) > 0.1) continue;
      const barriers = barrierSegments.filter((barrier) =>
        barrier.minY <= roomA.elevation + 0.5 && barrier.maxY >= roomA.elevation + 0.5);
      const crossings = [];
      let travelled = 0;
      for (let edge = 0; edge < roomA.points.length; edge += 1) {
        const start = roomA.points[edge];
        const end = roomA.points[(edge + 1) % roomA.points.length];
        const edgeLength = Math.hypot(end[0] - start[0], end[2] - start[2]);
        for (let along = 0; along <= edgeLength; along += ADJACENCY_SAMPLE_STEP_M) {
          const t = edgeLength ? along / edgeLength : 0;
          const sample = [
            start[0] + (end[0] - start[0]) * t,
            start[2] + (end[2] - start[2]) * t,
          ];
          const { distance, point } = closestOutlinePoint(sample, roomB.points);
          if (distance > ADJACENCY_MAXIMUM_GAP_M) continue;
          // The doorway is open only if nothing observed stands between the two
          // outlines. Shrink the probe so the door jambs on either side, which
          // legitimately end exactly at the outlines, do not veto the crossing.
          const blocked = distance > 2 * ADJACENCY_WALL_CLEARANCE_M &&
            barriers.some((barrier) => segmentsCross(
              shrinkSegment(sample, point, ADJACENCY_WALL_CLEARANCE_M),
              barrier,
            ));
          if (!blocked) crossings.push({ arc: travelled + along, sample, point });
        }
        travelled += edgeLength;
      }
      const runs = [];
      for (const crossing of crossings) {
        const run = runs.at(-1);
        if (run && crossing.arc - run.at(-1).arc <= ADJACENCY_RUN_BREAK_M) run.push(crossing);
        else runs.push([crossing]);
      }
      const usable = runs
        .filter((run) => run.at(-1).arc - run[0].arc >= ADJACENCY_MINIMUM_RUN_M)
        .sort((left, right) =>
          (right.at(-1).arc - right[0].arc) - (left.at(-1).arc - left[0].arc))
        .slice(0, ADJACENCY_MAXIMUM_RUNS_PER_PAIR);
      for (const [runIndex, run] of usable.entries()) {
        const head = run[0];
        const tail = run.at(-1);
        const elevation = roomA.elevation;
        const extend = (from, towards, sign) => {
          const dx = towards[0] - from[0];
          const dz = towards[1] - from[1];
          const length = Math.hypot(dx, dz) || 1;
          return [
            from[0] + sign * (dx / length) * ADJACENCY_OVERLAP_M,
            from[1] + sign * (dz / length) * ADJACENCY_OVERLAP_M,
          ];
        };
        const headSample = extend(head.sample, head.point, -1);
        const tailSample = extend(tail.sample, tail.point, -1);
        const headPoint = extend(head.point, head.sample, -1);
        const tailPoint = extend(tail.point, tail.sample, -1);
        const corners = [
          [headSample[0], elevation, headSample[1]],
          [tailSample[0], elevation, tailSample[1]],
          [tailPoint[0], elevation, tailPoint[1]],
          [headPoint[0], elevation, headPoint[1]],
        ];
        if (quadIsDegenerate(corners)) continue;
        surfaces.push({
          id: `auto-threshold-adjacent-${roomA.roomKey}-${roomB.roomKey}-${runIndex + 1}`,
          points: quadWindingFixed(corners),
          holes: [],
        });
      }
    }
  }
  return surfaces;
}

// Walls come only from observed cells, so a room's outer edge is open wherever
// the capture saw glass, a window, or nothing at all. Interior gaps between
// rooms are doorways and must stay open; the outer perimeter is the edge of the
// captured world. The structural enclosure proof walks barriers with exactly
// shared endpoints into closed planar loops, which scattered observed wall runs
// can never form — so each connected group of floors gets an explicit fence: a
// chained ring just outside the capture, harmless to movement because nothing
// walkable exists beyond the observed walls it encloses, and honest because the
// capture edge is a real boundary of the scene.
// The structural proof needs, for every storey group, a closed chained barrier
// loop whose corners a player capsule can stand inside of and be blocked by.
// Observed walls cannot chain, and a fence hugging the walkable outline puts
// probe corners inside captured clutter. The convex hull of the storey's
// walkable geometry at a two-metre standoff satisfies every requirement at
// once: corners stand in the clean band beyond the capture edge, the fence's
// own barrier blocks escape, and nothing walkable exists beyond it to lose.
const CAPTURE_RING_CELL_M = 0.125;
// Probe offset for the largest supported agent (radius 0.3: max(4r, 0.5) = 1.2)
// plus capsule radius plus margin. The fence is traced at this clearance beyond
// every cooked obstacle, so a probe standing one offset inside any fence corner
// is clear of collision by construction.
const CAPTURE_FENCE_CLEARANCE_M = 1.7;

function automaticCaptureEdgeSeals(roomSurfaces, barrierSegments, thresholdSurfaces) {
  const byElevation = new Map();
  for (const room of roomSurfaces) {
    const key = Math.round(room.elevation * 10) / 10;
    const group = byElevation.get(key) ?? { rooms: [], thresholds: [] };
    group.rooms.push(room);
    byElevation.set(key, group);
  }
  for (const surface of thresholdSurfaces) {
    const elevation = surface.points[0][1];
    for (const [key, group] of byElevation) {
      if (Math.abs(key - elevation) <= 0.15) group.thresholds.push(surface);
    }
  }
  const seals = [];
  for (const [elevationKey, group] of byElevation) {
    const storeyMiddle = elevationKey + 0.5;
    const cellSet = new Set();
    const cells = [];
    const addCell = (x, z) => {
      const key = `${x},${z}`;
      if (!cellSet.has(key)) {
        cellSet.add(key);
        cells.push([x, z]);
      }
    };
    const addPoint = (x, z) => addCell(
      Math.floor(x / CAPTURE_RING_CELL_M),
      Math.floor(z / CAPTURE_RING_CELL_M),
    );
    const polygons = [
      ...group.rooms.map((room) => room.points.map((point) => [point[0], point[2]])),
      ...group.thresholds.map((surface) =>
        surface.points.map((point) => [point[0], point[2]])),
    ];
    for (const polygon of polygons) {
      const xs = polygon.map((point) => point[0]);
      const zs = polygon.map((point) => point[1]);
      for (let x = Math.floor(Math.min(...xs) / CAPTURE_RING_CELL_M);
        x <= Math.ceil(Math.max(...xs) / CAPTURE_RING_CELL_M); x += 1) {
        for (let z = Math.floor(Math.min(...zs) / CAPTURE_RING_CELL_M);
          z <= Math.ceil(Math.max(...zs) / CAPTURE_RING_CELL_M); z += 1) {
          const centre = [
            (x + 0.5) * CAPTURE_RING_CELL_M,
            (z + 0.5) * CAPTURE_RING_CELL_M,
          ];
          if (pointInPolygon2(centre, polygon)) addCell(x, z);
        }
      }
    }
    for (const barrier of barrierSegments) {
      if (barrier.minY > storeyMiddle || barrier.maxY < storeyMiddle) continue;
      const length = Math.hypot(
        barrier.end[0] - barrier.start[0],
        barrier.end[1] - barrier.start[1],
      );
      const steps = Math.max(1, Math.ceil(length / (CAPTURE_RING_CELL_M / 2)));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        addPoint(
          barrier.start[0] + (barrier.end[0] - barrier.start[0]) * t,
          barrier.start[1] + (barrier.end[1] - barrier.start[1]) * t,
        );
      }
    }
    if (cells.length < 4) continue;
    const radius = Math.ceil(CAPTURE_FENCE_CLEARANCE_M / CAPTURE_RING_CELL_M);
    const boundary = cells.filter(([x, z]) =>
      !(cellSet.has(`${x - 1},${z}`) && cellSet.has(`${x + 1},${z}`) &&
        cellSet.has(`${x},${z - 1}`) && cellSet.has(`${x},${z + 1}`)));
    const fenceSet = new Set(cellSet);
    const fenceCells = [...cells];
    for (const [x, z] of boundary) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (dx * dx + dz * dz > radius * radius) continue;
          const key = `${x + dx},${z + dz}`;
          if (!fenceSet.has(key)) {
            fenceSet.add(key);
            fenceCells.push([x + dx, z + dz]);
          }
        }
      }
    }
    const outline = semanticCellOutline(fenceCells);
    const ring = outline.map(([x, z]) => [
      x * CAPTURE_RING_CELL_M,
      z * CAPTURE_RING_CELL_M,
    ]);
    const minY = Math.min(...group.rooms.map((room) => room.elevation));
    const maxY = Math.min(...group.rooms.map((room) => room.ceilingElevation));
    for (let index = 0; index < ring.length; index += 1) {
      seals.push({
        id: `auto-capture-ring-${elevationKey}-${index + 1}`,
        start: ring[index],
        end: ring[(index + 1) % ring.length],
        minY,
        maxY,
      });
    }
  }
  return seals;
}

function convexHull2(points) {
  const sorted = [...new Map(points.map((point) =>
    [`${point[0].toFixed(4)},${point[1].toFixed(4)}`, point])).values()]
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 &&
      cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 &&
      cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function shrinkSegment(from, to, margin) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz) || 1;
  const scale = margin / length;
  return {
    start: [from[0] + dx * scale, from[1] + dz * scale],
    end: [to[0] - dx * scale, to[1] - dz * scale],
  };
}

function segmentsCross(probe, barrier) {
  return segmentsIntersect2(probe.start, probe.end, barrier.start, barrier.end);
}

function quadIsDegenerate(corners) {
  let doubledArea = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const a = corners[index];
    const b = corners[(index + 1) % corners.length];
    doubledArea += a[0] * b[2] - b[0] * a[2];
  }
  return Math.abs(doubledArea / 2) < 0.05;
}

function quadWindingFixed(corners) {
  // The two outline runs can be traversed in opposite senses, which twists the
  // quad into a bowtie; swapping the far edge untwists it.
  const [a, b, c, d] = corners;
  const flat = (point) => [point[0], point[2]];
  if (segmentsIntersect2(flat(a), flat(b), flat(c), flat(d)) ||
    segmentsIntersect2(flat(b), flat(c), flat(d), flat(a))) {
    return [a, b, d, c];
  }
  return corners;
}

function closestOutlinePoint(point, polygon) {
  let distance = Infinity;
  let closest = point;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const spanX = end[0] - start[0];
    const spanZ = end[2] - start[2];
    const lengthSquared = spanX * spanX + spanZ * spanZ;
    const projection = lengthSquared
      ? Math.max(0, Math.min(1,
        ((point[0] - start[0]) * spanX + (point[1] - start[2]) * spanZ) / lengthSquared))
      : 0;
    const candidate = [start[0] + spanX * projection, start[2] + spanZ * projection];
    const candidateDistance = Math.hypot(point[0] - candidate[0], point[1] - candidate[1]);
    if (candidateDistance < distance) {
      distance = candidateDistance;
      closest = candidate;
    }
  }
  return { distance, point: closest };
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
    // A stairwell shaft has no floor capture, so the flood-filled room already
    // carries a notch where the stair is, and the connector footprint normally
    // overhangs that notch's boundary by a sliver of grid alignment. There is
    // nothing to cut — the shaft is already outside the floor polygon. Only a
    // connector emerging mostly INSIDE the surface, which a hole cut cannot
    // represent without clipping, still fails closed for operator review.
    const cornersInside = hole.filter((point) =>
      pointInPolygon2(point, outline) && !pointOnRing2(point, outline)).length;
    if (cornersInside * 2 <= hole.length) continue;
    throw pipelineError(
      "AUTOMATIC_COLLISION_CONNECTOR_HOLE_AMBIGUOUS",
      `Connector ${connector.id} emerges inside room surface ${id}; classify the landing against the registered render before rebuilding`,
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
