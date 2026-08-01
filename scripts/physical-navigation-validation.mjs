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
