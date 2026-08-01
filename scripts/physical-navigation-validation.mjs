import RAPIER from "@dimforge/rapier3d-compat";
import { importNavigationArtifact, NavigationBuildError } from "./navigation-build-core.mjs";

let initialization;

/**
 * Replays every authored Detour route with the same Rapier capsule settings as
 * the browser. A build is publishable only when planning and physical movement
 * agree; a visual-only navmesh is not sufficient evidence.
 */
export async function validatePhysicalNavigation({
  artifact,
  positions,
  indices,
  obstacleBoxes = [],
}) {
  initialization ??= RAPIER.init();
  await initialization;
  const agent = physicalAgent(artifact);
  validateCapsuleOccupancy({
    position: artifact.spawn.projectedPosition,
    label: artifact.spawn.id ?? "opening-spawn",
    agent,
    positions,
    indices,
    obstacleBoxes,
  });
  const runtime = await importNavigationArtifact(artifact);
  const routes = [];
  try {
    for (const destination of artifact.validation.destinations) {
      if (!destination.projectedPosition) {
        throw physicalFailure(destination.id, "Destination has no projected Detour position");
      }
      for (const direction of ["outbound", "inbound"]) {
        const route = direction === "outbound"
          ? runtime.path(artifact.spawn.projectedPosition, destination.projectedPosition)
          : runtime.path(destination.projectedPosition, artifact.spawn.projectedPosition);
        if (!route || route.length < 1) {
          throw physicalFailure(
            destination.id,
            `Destination has no complete ${direction} Detour route`,
          );
        }
        routes.push(replayRoute({
          route,
          direction,
          destinationId: destination.id,
          agent,
          positions,
          indices,
          obstacleBoxes,
          cellSize: artifact.build.cellSize,
        }));
      }
    }
  } finally {
    runtime.destroy();
  }
  return {
    passed: true,
    engine: "rapier3d",
    version: "0.19.3",
    controller: "kinematic-capsule",
    spawnOccupancyPassed: true,
    routeCount: routes.length,
    failedDestinationIds: [],
    routes,
  };
}

/**
 * Proves that every published navigation anchor is enclosed by the same
 * structural collision used by Fly mode. Each Rapier sphere sweep must hit a
 * floor, ceiling, or exterior wall in all six cardinal directions. Furniture
 * is absent from positions/indices by construction and is recorded only as
 * ignored provenance evidence.
 */
export async function validateStructuralNavigation({
  artifact,
  positions,
  indices,
  ignoredMeshCount = 0,
}) {
  if (artifact?.schemaVersion !== "spatial-navigation-v7") {
    throw new NavigationBuildError(
      "STRUCTURAL_NAVIGATION_UNSUPPORTED",
      "Structural shell validation requires a v7 navigation artifact",
    );
  }
  initialization ??= RAPIER.init();
  await initialization;
  const agent = physicalAgent(artifact);
  const boundaryTopology = validateStructuralBoundaryTopology(artifact);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    world.createCollider(RAPIER.ColliderDesc.trimesh(
      new Float32Array(positions),
      new Uint32Array(indices),
    ));
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const collider = world.createCollider(RAPIER.ColliderDesc.ball(agent.radius), body);
    const controller = world.createCharacterController(
      Math.max(0.002, Math.min(0.02, agent.radius * 0.05)),
    );
    controller.setSlideEnabled(true);
    const [[minX, minY, minZ], [maxX, maxY, maxZ]] = artifact.bounds;
    const probeDistance = Math.max(
      4,
      Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 2,
    );
    const anchors = [{
      id: artifact.spawn.id ?? "opening",
      position: artifact.spawn.projectedPosition,
    }, ...artifact.validation.destinations.map((destination) => ({
      id: destination.id,
      position: destination.projectedPosition,
    }))];
    const directions = [
      ["east", [1, 0, 0]],
      ["west", [-1, 0, 0]],
      ["up", [0, 1, 0]],
      ["down", [0, -1, 0]],
      ["south", [0, 0, 1]],
      ["north", [0, 0, -1]],
    ];
    const probes = [];
    for (const anchor of anchors) {
      const origin = [
        anchor.position[0],
        anchor.position[1] + artifact.agent.eyeHeight,
        anchor.position[2],
      ];
      body.setTranslation(toVector(origin), true);
      world.step();
      const overlap = world.intersectionWithShape(
        toVector(origin),
        { x: 0, y: 0, z: 0, w: 1 },
        new RAPIER.Ball(agent.radius * 0.98),
        undefined,
        undefined,
        collider,
        body,
      );
      if (overlap) {
        throw structuralFailure(anchor.id, "Fly probe origin overlaps structural collision", {
          origin: roundedPoint(origin),
        });
      }
      for (const [direction, unit] of directions) {
        body.setTranslation(toVector(origin), true);
        world.step();
        const requested = unit.map((value) => value * probeDistance);
        controller.computeColliderMovement(collider, toVector(requested));
        const corrected = controller.computedMovement();
        const actualDistance = Math.hypot(corrected.x, corrected.y, corrected.z);
        const blocked = actualDistance < probeDistance - Math.max(0.02, agent.radius * 0.25);
        if (!blocked) {
          throw structuralFailure(anchor.id, `Structural shell is open toward ${direction}`, {
            direction,
            origin: roundedPoint(origin),
            requestedDistance: round(probeDistance),
            actualDistance: round(actualDistance),
          });
        }
        probes.push({
          anchorId: anchor.id,
          origin: roundedPoint(origin),
          direction,
          blocked: true,
          requestedDistance: round(probeDistance),
          actualDistance: round(actualDistance),
        });
      }
    }
    const boundaryProbes = [];
    const barriers = artifact.structuralGeometry?.barrierSegments ?? [];
    for (const barrier of barriers) {
      const deltaX = barrier.end[0] - barrier.start[0];
      const deltaZ = barrier.end[1] - barrier.start[1];
      const length = Math.hypot(deltaX, deltaZ);
      const normal = [-deltaZ / length, 0, deltaX / length];
      const midpoint = [
        (barrier.start[0] + barrier.end[0]) / 2,
        (barrier.minY + barrier.maxY) / 2,
        (barrier.start[1] + barrier.end[1]) / 2,
      ];
      const probeRadius = Math.max(0.004, Math.min(agent.radius * 0.2, length * 0.2, 0.04));
      const originDistance = Math.max(agent.radius * 1.5, probeRadius * 3);
      const travelDistance = originDistance * 2;
      for (const side of [-1, 1]) {
        const origin = midpoint.map((coordinate, axis) =>
          coordinate + normal[axis] * originDistance * side);
        const direction = normal.map((coordinate) => -coordinate * side);
        const hit = world.castShape(
          toVector(origin),
          { x: 0, y: 0, z: 0, w: 1 },
          toVector(direction),
          new RAPIER.Ball(probeRadius),
          0,
          travelDistance,
          true,
          undefined,
          undefined,
          collider,
          body,
        );
        if (!hit) {
          throw structuralFailure(barrier.id, "Reviewed barrier failed its bidirectional sphere sweep", {
            side,
            origin: roundedPoint(origin),
            direction: roundedPoint(direction),
            requestedDistance: round(travelDistance),
          });
        }
        boundaryProbes.push({
          barrierId: barrier.id,
          side,
          origin: roundedPoint(origin),
          direction: roundedPoint(direction),
          requestedDistance: round(travelDistance),
          hitDistance: round(hit.time_of_impact),
          blocked: true,
        });
      }
    }
    world.removeCharacterController(controller);
    return {
      passed: true,
      engine: "rapier3d",
      version: "0.19.3",
      shape: "sphere",
      ignoredFurnitureMeshCount: Number.isSafeInteger(ignoredMeshCount) && ignoredMeshCount > 0
        ? ignoredMeshCount
        : 0,
      anchorCount: anchors.length,
      probeCount: probes.length,
      probes,
      boundaryCount: barriers.length,
      boundaryProbeCount: boundaryProbes.length,
      boundaryProbes,
      boundaryTopology,
    };
  } finally {
    world.free();
  }
}

function validateStructuralBoundaryTopology(artifact) {
  const geometry = artifact?.structuralGeometry;
  if (!geometry) {
    return {
      passed: true,
      method: "registered-mesh-anchor-enclosure",
      loopCount: 0,
      floorComponentCount: 0,
      dynamicClosureCount: 0,
    };
  }
  const nodes = new Map();
  const edges = [];
  for (const barrier of geometry.barrierSegments) {
    const startKey = point2Key(barrier.start);
    const endKey = point2Key(barrier.end);
    if (startKey === endKey) {
      throw structuralFailure(barrier.id, "Structural boundary contains a zero-length edge");
    }
    addBoundaryNode(nodes, startKey, barrier.start, endKey);
    addBoundaryNode(nodes, endKey, barrier.end, startKey);
    edges.push([startKey, endKey]);
  }
  const invalidNodes = [...nodes.entries()]
    .filter(([, node]) => node.neighbours.length !== 2)
    .map(([key, node]) => ({ key, degree: node.neighbours.length }));
  if (invalidNodes.length) {
    throw structuralFailure(
      "boundary-topology",
      "Reviewed structural barriers do not form closed loops",
      { invalidNodes },
    );
  }
  const unusedEdges = new Set(edges.map(([start, end]) => edgeKey(start, end)));
  const loops = [];
  while (unusedEdges.size) {
    const firstEdge = unusedEdges.values().next().value;
    const [first, second] = firstEdge.split("|");
    const loopKeys = [first];
    let previous = first;
    let current = second;
    unusedEdges.delete(firstEdge);
    while (current !== first) {
      loopKeys.push(current);
      const node = nodes.get(current);
      const next = node.neighbours.find((candidate) => candidate !== previous);
      if (!next || loopKeys.length > edges.length + 1) {
        throw structuralFailure("boundary-topology", "Structural boundary loop traversal failed");
      }
      const nextEdge = edgeKey(current, next);
      if (!unusedEdges.delete(nextEdge) && next !== first) {
        throw structuralFailure("boundary-topology", "Structural boundary contains a reused or crossing edge");
      }
      previous = current;
      current = next;
    }
    loops.push(loopKeys.map((key) => nodes.get(key).point));
  }
  const floorComponents = rectangleComponents(geometry.floorRectangles);
  for (const component of floorComponents) {
    for (const rectangle of component) {
      const center = [
        (rectangle.min[0] + rectangle.max[0]) / 2,
        (rectangle.min[1] + rectangle.max[1]) / 2,
      ];
      if (!loops.some((loop) => pointInPolygon2(center, loop))) {
        throw structuralFailure(
          rectangle.id,
          "Reviewed floor component is not enclosed by a structural boundary loop",
          { center },
        );
      }
      const coveredByCeiling = geometry.ceilingRectangles.some((ceiling) =>
        ceiling.elevation > rectangle.elevation &&
        center[0] > ceiling.min[0] - 1e-6 && center[0] < ceiling.max[0] + 1e-6 &&
        center[1] > ceiling.min[1] - 1e-6 && center[1] < ceiling.max[1] + 1e-6);
      if (!coveredByCeiling) {
        throw structuralFailure(rectangle.id, "Reviewed floor has no explicit ceiling coverage");
      }
    }
  }
  return {
    passed: true,
    method: "explicit-closed-segment-loops-v1",
    loopCount: loops.length,
    floorComponentCount: floorComponents.length,
    dynamicClosureCount: 0,
  };
}

function addBoundaryNode(nodes, key, point, neighbour) {
  const node = nodes.get(key) ?? { point: [...point], neighbours: [] };
  node.neighbours.push(neighbour);
  nodes.set(key, node);
}

function point2Key(point) {
  return `${round(Number(point[0]))},${round(Number(point[1]))}`;
}

function edgeKey(first, second) {
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function rectangleComponents(rectangles) {
  const remaining = new Set(rectangles.map((_, index) => index));
  const components = [];
  while (remaining.size) {
    const seed = remaining.values().next().value;
    remaining.delete(seed);
    const queue = [seed];
    const component = [];
    while (queue.length) {
      const index = queue.shift();
      const rectangle = rectangles[index];
      component.push(rectangle);
      for (const candidate of [...remaining]) {
        if (rectanglesTouch(rectangle, rectangles[candidate])) {
          remaining.delete(candidate);
          queue.push(candidate);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function rectanglesTouch(first, second) {
  return Math.abs(first.elevation - second.elevation) <= 0.05 &&
    first.min[0] <= second.max[0] + 1e-6 && first.max[0] >= second.min[0] - 1e-6 &&
    first.min[1] <= second.max[1] + 1e-6 && first.max[1] >= second.min[1] - 1e-6;
}

function pointInPolygon2(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length;
    previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = (a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function validateCapsuleOccupancy({
  position,
  label,
  agent,
  positions,
  indices,
  obstacleBoxes,
}) {
  if (!Array.isArray(position) || position.length !== 3) {
    throw physicalFailure(label, "Projected spawn position is missing");
  }
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    world.createCollider(RAPIER.ColliderDesc.trimesh(
      new Float32Array(positions),
      new Uint32Array(indices),
    ));
    for (const box of obstacleBoxes) addObstacleBox(world, box);
    world.step();
    const halfHeight = Math.max(0.01, (agent.height - agent.radius * 2) / 2);
    const shape = new RAPIER.Capsule(halfHeight, agent.radius * 0.98);
    const hit = world.intersectionWithShape(
      feetToCenter(position, agent.height),
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
    );
    if (hit) {
      throw physicalFailure(label, "Projected spawn overlaps collision geometry");
    }
  } finally {
    world.free();
  }
}

function replayRoute({
  route,
  direction,
  destinationId,
  agent,
  positions,
  indices,
  obstacleBoxes,
  cellSize,
}) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  try {
    world.createCollider(RAPIER.ColliderDesc.trimesh(
      new Float32Array(positions),
      new Uint32Array(indices),
    ));
    for (const box of obstacleBoxes) addObstacleBox(world, box);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const halfHeight = Math.max(0.01, (agent.height - agent.radius * 2) / 2);
    const collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, agent.radius),
      body,
    );
    const controller = world.createCharacterController(
      Math.max(0.002, Math.min(0.02, agent.radius * 0.05)),
    );
    controller.setSlideEnabled(true);
    controller.enableAutostep(agent.maxClimb, Math.max(agent.radius * 0.5, 0.05), false);
    controller.enableSnapToGround(Math.max(agent.maxClimb, 0.05));
    controller.setMaxSlopeClimbAngle(degreesToRadians(agent.maxSlopeDegrees));
    controller.setMinSlopeSlideAngle(degreesToRadians(Math.min(89, agent.maxSlopeDegrees + 5)));

    let feet = [...route[0]];
    body.setTranslation(feetToCenter(feet, agent.height), true);
    let simulatedSteps = 0;
    let pathLength = 0;
    const stepLength = Math.max(0.02, Math.min(cellSize * 0.5, agent.radius * 0.5, 0.1));
    const arrivalTolerance = Math.max(cellSize * 1.5, agent.radius * 0.5, 0.08);

    for (const waypoint of route.slice(1)) {
      const segmentLength = distance(feet, waypoint);
      pathLength += segmentLength;
      const stepLimit = Math.max(12, Math.ceil(segmentLength / stepLength) * 4);
      let stalledSteps = 0;
      for (let attempt = 0; attempt < stepLimit; attempt += 1) {
        const remaining = distance(feet, waypoint);
        if (remaining <= arrivalTolerance) break;
        const desired = scaledDirection(feet, waypoint, Math.min(stepLength, remaining));
        controller.computeColliderMovement(collider, toVector(desired));
        const corrected = controller.computedMovement();
        const correctedLength = Math.hypot(corrected.x, corrected.y, corrected.z);
        stalledSteps = correctedLength < stepLength * 0.05 ? stalledSteps + 1 : 0;
        const center = feetToCenter(feet, agent.height);
        const nextCenter = {
          x: center.x + corrected.x,
          y: center.y + corrected.y,
          z: center.z + corrected.z,
        };
        body.setNextKinematicTranslation(nextCenter);
        world.step();
        const actual = body.translation();
        feet = [actual.x, actual.y - agent.height / 2, actual.z];
        simulatedSteps += 1;
        if (stalledSteps >= 8) break;
      }
      if (distance(feet, waypoint) > arrivalTolerance) {
        throw physicalFailure(
          destinationId,
          "Rapier capsule could not follow a Detour-approved route",
          {
            blockedAt: roundedPoint(feet),
            waypoint: roundedPoint(waypoint),
            remainingDistance: round(distance(feet, waypoint)),
          },
        );
      }
    }
    return {
      destinationId,
      direction,
      passed: true,
      waypointCount: route.length,
      simulatedSteps,
      pathLength: round(pathLength),
      finalPosition: roundedPoint(feet),
    };
  } finally {
    world.free();
  }
}

function physicalAgent(artifact) {
  const agent = artifact?.agent;
  if (!agent || ["radius", "height", "maxClimb", "maxSlopeDegrees"].some(
    (name) => !Number.isFinite(Number(agent[name])),
  )) {
    throw new NavigationBuildError(
      "INVALID_PHYSICAL_AGENT",
      "Physical validation requires a complete finite agent profile",
    );
  }
  return {
    radius: Number(agent.radius),
    height: Number(agent.height),
    maxClimb: Number(agent.maxClimb),
    maxSlopeDegrees: Number(agent.maxSlopeDegrees),
  };
}

function addObstacleBox(world, value) {
  const min = finitePoint(value?.min);
  const max = finitePoint(value?.max);
  if (!min || !max || min.some((coordinate, axis) => coordinate >= max[axis])) {
    throw new NavigationBuildError(
      "INVALID_OBSTACLE_GEOMETRY",
      "Every authored obstacle box must have finite increasing min and max coordinates",
    );
  }
  const half = min.map((coordinate, axis) => (max[axis] - coordinate) / 2);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setTranslation(
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ),
  );
}

function physicalFailure(destinationId, message, details = {}) {
  return new NavigationBuildError(
    "PHYSICAL_NAVIGATION_ACCEPTANCE_FAILED",
    message,
    { destinationId, ...details },
  );
}

function structuralFailure(anchorId, message, details = {}) {
  return new NavigationBuildError(
    "STRUCTURAL_NAVIGATION_ACCEPTANCE_FAILED",
    message,
    { anchorId, ...details },
  );
}

function finitePoint(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? value.map(Number)
    : null;
}

function feetToCenter(feet, height) {
  return { x: feet[0], y: feet[1] + height / 2, z: feet[2] };
}

function scaledDirection(from, to, length) {
  const divisor = distance(from, to) || 1;
  return [
    (to[0] - from[0]) / divisor * length,
    (to[1] - from[1]) / divisor * length,
    (to[2] - from[2]) / divisor * length,
  ];
}

function toVector(value) {
  return { x: value[0], y: value[1], z: value[2] };
}

function distance(first, second) {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  );
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function roundedPoint(value) {
  return value.map(round);
}

function round(value) {
  const result = Math.round(Number(value) * 1_000_000) / 1_000_000;
  return Object.is(result, -0) ? 0 : result;
}
