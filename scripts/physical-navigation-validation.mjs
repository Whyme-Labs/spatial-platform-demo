import RAPIER from "@dimforge/rapier3d-compat";
import { importNavigationArtifact, NavigationBuildError } from "./navigation-build-core.mjs";
import {
  pointInHorizontalSurface2,
  pointOnRing2,
  ring2,
  triangulateHorizontalSurface,
} from "./horizontal-surface.mjs";

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
 * Replays each reviewed discontinuity in every allowed direction. These paths
 * intentionally bypass gravity, matching the browser's controlled elevator,
 * ladder, and moving-platform interval, while retaining capsule sweeps against
 * the exact structural collision proxy.
 */
export async function validateAuthoredTraversals({
  artifact,
  positions,
  indices,
  obstacleBoxes = [],
}) {
  if (!["spatial-navigation-v8", "spatial-navigation-v9"].includes(artifact?.schemaVersion) ||
    !Array.isArray(artifact.offMeshConnections) || !artifact.offMeshConnections.length) {
    throw new NavigationBuildError(
      "AUTHORED_TRAVERSAL_ACCEPTANCE_FAILED",
      "Controlled-path validation requires a v8 or v9 artifact with authored traversal links",
    );
  }
  initialization ??= RAPIER.init();
  await initialization;
  const agent = physicalAgent(artifact);
  const activeDynamicBarriers = Array.isArray(artifact.dynamicBarriers)
    ? artifact.dynamicBarriers.filter((barrier) => barrier?.defaultActive === true)
    : [];
  const traversals = [];
  for (const connection of artifact.offMeshConnections) {
    const forward = [
      connection.startPosition,
      ...connection.controlPoints,
      connection.endPosition,
    ];
    for (const [direction, route] of [
      ["forward", forward],
      ...(connection.bidirectional
        ? [["reverse", [...forward].reverse()]]
        : []),
    ]) {
      let evidence;
      try {
        evidence = replayControlledRoute({
          route,
          direction,
          destinationId: connection.id,
          agent,
          positions,
          indices,
          obstacleBoxes: [...obstacleBoxes, ...activeDynamicBarriers],
        });
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new NavigationBuildError(
          "AUTHORED_TRAVERSAL_ACCEPTANCE_FAILED",
          `Authored ${connection.traversalKind} ${connection.id} is blocked in the ${direction} direction: ${cause}`,
          {
            connectionId: connection.id,
            direction,
            cause,
          },
        );
      }
      traversals.push({
        connectionId: connection.id,
        traversalKind: connection.traversalKind,
        direction,
        waypointCount: evidence.waypointCount,
        simulatedSteps: evidence.simulatedSteps,
        pathLength: evidence.pathLength,
        finalPosition: evidence.finalPosition,
      });
    }
  }
  return {
    passed: true,
    engine: "rapier3d",
    version: "0.19.3",
    controller: "kinematic-capsule-controlled-path",
    connectionCount: artifact.offMeshConnections.length,
    directionCount: traversals.length,
    traversals,
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
  if (!["spatial-navigation-v7", "spatial-navigation-v8", "spatial-navigation-v9"].includes(artifact?.schemaVersion)) {
    throw new NavigationBuildError(
      "STRUCTURAL_NAVIGATION_UNSUPPORTED",
      "Structural shell validation requires a v7, v8, or v9 navigation artifact",
    );
  }
  initialization ??= RAPIER.init();
  await initialization;
  const agent = physicalAgent(artifact);
  const boundaryTopologyResult = validateStructuralBoundaryTopology(artifact);
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
      const probeRadius = agent.radius * 0.98;
      const capsuleHalfHeight = Math.max(0.01, (agent.height - agent.radius * 2) / 2);
      // Barrier coordinates are the wall's centreline, but a barrier with
      // frozen thickness cooked as a prism whose face sits half a thickness
      // closer to the probe. Standing the origin that much further out keeps
      // the sweep an honest approach to the face instead of a cast that
      // begins inside the wall and trivially reports contact.
      const halfThickness = (barrier.thicknessM ?? 0) / 2;
      const originDistance = Math.max(agent.radius * 2.25, 0.08) + halfThickness;
      const travelDistance = originDistance * 2;
      if (barrier.maxY - barrier.minY + 1e-6 < agent.height) {
        throw structuralFailure(barrier.id, "Reviewed barrier is shorter than the production Walk capsule");
      }
      for (const [mode, shape, originY] of [
        ["walk", new RAPIER.Capsule(capsuleHalfHeight, probeRadius), barrier.minY + agent.height / 2 + 0.002],
        ["fly", new RAPIER.Ball(probeRadius), midpoint[1]],
      ]) {
        for (const side of [-1, 1]) {
          const origin = midpoint.map((coordinate, axis) =>
            axis === 1 ? originY : coordinate + normal[axis] * originDistance * side);
          const direction = normal.map((coordinate) => -coordinate * side);
          const hit = world.castShape(
            toVector(origin),
            { x: 0, y: 0, z: 0, w: 1 },
            toVector(direction),
            shape,
            0,
            travelDistance,
            true,
            undefined,
            undefined,
            collider,
            body,
          );
          if (!hit) {
            throw structuralFailure(barrier.id, `Reviewed barrier failed its ${mode} sweep`, {
              mode,
              side,
              origin: roundedPoint(origin),
              direction: roundedPoint(direction),
              requestedDistance: round(travelDistance),
            });
          }
          boundaryProbes.push({
            barrierId: barrier.id,
            mode,
            shape: mode === "walk" ? "capsule" : "sphere",
            side,
            origin: roundedPoint(origin),
            direction: roundedPoint(direction),
            requestedDistance: round(travelDistance),
            hitDistance: round(hit.time_of_impact),
            blocked: true,
          });
        }
      }
    }
    const cornerProbes = validateCornerSlides({
      world,
      artifact,
      agent,
      loops: boundaryTopologyResult.loops,
      surfaceLoopCandidates: boundaryTopologyResult.surfaceLoopCandidates ?? [],
    });
    const dynamicBarrierProbes = await validateDynamicBarrierState({
      world,
      artifact,
      agent,
    });
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
      cornerCount: cornerProbes.length,
      cornerProbeCount: cornerProbes.length,
      cornerProbes,
      dynamicBarrierCount: dynamicBarrierProbes.length,
      dynamicBarrierProbeCount: dynamicBarrierProbes.length,
      dynamicBarrierProbes,
      boundaryTopology: {
        ...boundaryTopologyResult.summary,
        dynamicClosureCount: dynamicBarrierProbes.length,
      },
    };
  } finally {
    world.free();
  }
}

function validateStructuralBoundaryTopology(artifact) {
  const geometry = artifact?.structuralGeometry;
  if (!geometry) {
    return {
      summary: {
        passed: true,
        method: "registered-mesh-anchor-enclosure",
        loopCount: 0,
        floorComponentCount: 0,
        dynamicClosureCount: 0,
      },
      loops: [],
    };
  }
  const groupedBarriers = new Map();
  for (const barrier of geometry.barrierSegments) {
    const startKey = point2Key(barrier.start);
    const endKey = point2Key(barrier.end);
    if (startKey === endKey) {
      throw structuralFailure(barrier.id, "Structural boundary contains a zero-length edge");
    }
    const groupKey = `${round(barrier.minY)}:${round(barrier.maxY)}`;
    const group = groupedBarriers.get(groupKey) ?? [];
    group.push(barrier);
    groupedBarriers.set(groupKey, group);
  }
  const candidateLoops = [...groupedBarriers.values()]
    .flatMap((barriers) => planarBarrierLoops(barriers));
  const floorSurfaces = structuralHorizontalSurfaces(geometry, "floor");
  const ceilingSurfaces = structuralHorizontalSurfaces(geometry, "ceiling");
  const floorComponents = surfaceComponents(floorSurfaces);
  const acceptedLoops = new Map();
  const surfaceLoopCandidates = [];
  for (const component of floorComponents) {
    for (const surface of component) {
      const center = horizontalSurfaceInteriorPoint(surface);
      const containingLoops = candidateLoops
        .filter((loop) => Math.abs(loop.minY - surface.elevation) <= 0.1 &&
          pointInPolygon2(center, loop.points))
        .sort((left, right) => Math.abs(signedPolygonArea2(left.points)) -
          Math.abs(signedPolygonArea2(right.points)));
      if (!containingLoops.length) {
        throw structuralFailure(
          surface.id,
          "Reviewed floor component is not enclosed by a structural boundary loop",
          { center },
        );
      }
      const floorTriangles = horizontalSurfaceTriangles2(surface);
      const containedCandidates = containingLoops.filter((candidate) =>
        floorTriangles.every((triangle) =>
          triangleContainedInRing(triangle, candidate.points)));
      if (!containedCandidates.length) {
        throw structuralFailure(
          surface.id,
          "Reviewed floor extends outside its structural boundary loop",
        );
      }
      const loop = containedCandidates[0];
      acceptedLoops.set(loop.key, loop);
      surfaceLoopCandidates.push({ surfaceId: surface.id, loops: containedCandidates });
      const coveredByCeiling = floorTriangles.every((triangle) =>
        ceilingSurfaces.some((ceiling) =>
          ceiling.elevation > surface.elevation &&
          triangleContainedInHorizontalSurface(triangle, ceiling)));
      if (!coveredByCeiling) {
        throw structuralFailure(surface.id, "Reviewed floor has no explicit ceiling coverage");
      }
    }
  }
  const loops = [...acceptedLoops.values()];
  return {
    summary: {
      passed: true,
      method: "explicit-planar-boundary-faces-v2",
      loopCount: loops.length,
      floorComponentCount: floorComponents.length,
      dynamicClosureCount: 0,
    },
    loops,
    surfaceLoopCandidates,
  };
}

function planarBarrierLoops(barriers) {
  const nodes = new Map();
  const edges = [];
  for (const barrier of barriers) {
    const startKey = point2Key(barrier.start);
    const endKey = point2Key(barrier.end);
    addBoundaryNode(nodes, startKey, barrier.start, endKey);
    addBoundaryNode(nodes, endKey, barrier.end, startKey);
    edges.push([startKey, endKey]);
  }
  for (const node of nodes.values()) {
    node.neighbours = [...new Set(node.neighbours)].sort((left, right) => {
      const leftPoint = nodes.get(left).point;
      const rightPoint = nodes.get(right).point;
      return Math.atan2(leftPoint[1] - node.point[1], leftPoint[0] - node.point[0]) -
        Math.atan2(rightPoint[1] - node.point[1], rightPoint[0] - node.point[0]);
    });
  }
  const visited = new Set();
  const loops = new Map();
  for (const [first, second] of edges.flatMap(([start, end]) => [[start, end], [end, start]])) {
    const startDirection = `${first}>${second}`;
    if (visited.has(startDirection)) continue;
    let from = first;
    let to = second;
    const keys = [];
    let closed = false;
    for (let guard = 0; guard <= edges.length * 2 + 2; guard += 1) {
      const directionKey = `${from}>${to}`;
      if (visited.has(directionKey)) break;
      visited.add(directionKey);
      keys.push(from);
      const neighbours = nodes.get(to)?.neighbours ?? [];
      const incoming = neighbours.indexOf(from);
      if (incoming < 0 || !neighbours.length) break;
      const next = neighbours[(incoming - 1 + neighbours.length) % neighbours.length];
      from = to;
      to = next;
      if (from === first && to === second) {
        closed = true;
        break;
      }
    }
    if (!closed) continue;
    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.length < 3) continue;
    const points = keys.map((key) => nodes.get(key).point);
    if (Math.abs(signedPolygonArea2(points)) <= 1e-6) continue;
    const key = uniqueKeys.sort().join("|");
    if (!loops.has(key)) {
      loops.set(key, {
        key: `${round(barriers[0].minY)}:${round(barriers[0].maxY)}:${key}`,
        minY: barriers[0].minY,
        maxY: barriers[0].maxY,
        points,
      });
    }
  }
  return [...loops.values()];
}

function signedPolygonArea2(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function validateCornerSlides({
  world,
  artifact,
  agent,
  loops,
  surfaceLoopCandidates = [],
}) {
  // A floor is proven when any structural loop that contains it survives the
  // corner exercise, tried tightest first. Observed walls can chain into an
  // honest loop whose corners stand in captured clutter no capsule fits into;
  // the capture fence enclosing the same floor is just as real a barrier, and
  // refusing the scene because the tighter loop is unprobeable would fail
  // captures for being honest about clutter.
  const work = surfaceLoopCandidates.length
    ? surfaceLoopCandidates
    : loops.map((loop) => ({ surfaceId: loop.key, loops: [loop] }));
  if (!work.length) return [];
  const halfHeight = Math.max(0.01, (agent.height - agent.radius * 2) / 2);
  const shape = new RAPIER.Capsule(halfHeight, agent.radius);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, agent.radius), body);
  const controller = world.createCharacterController(
    Math.max(0.002, Math.min(0.02, agent.radius * 0.05)),
  );
  controller.setSlideEnabled(true);
  controller.enableAutostep(agent.maxClimb, Math.max(agent.radius * 0.5, 0.05), false);
  controller.enableSnapToGround(Math.max(agent.maxClimb, 0.05));
  controller.setMaxSlopeClimbAngle(degreesToRadians(agent.maxSlopeDegrees));
  controller.setMinSlopeSlideAngle(degreesToRadians(Math.min(89, agent.maxSlopeDegrees + 5)));
  const probes = [];
  const loopOutcomes = new Map();
  const exerciseLoop = (loopRecord, loopIndex) => {
    if (loopOutcomes.has(loopRecord.key)) return loopOutcomes.get(loopRecord.key);
    const loopProbes = [];
    let outcome;
    try {
      runCornerExercise(loopRecord, loopIndex, loopProbes);
      outcome = { passed: true, probes: loopProbes };
    } catch (error) {
      outcome = { passed: false, error };
    }
    loopOutcomes.set(loopRecord.key, outcome);
    return outcome;
  };
  const runCornerExercise = (loopRecord, loopIndex, loopProbes) => {
    {
      const loop = loopRecord.points;
      for (const [cornerIndex, corner] of loop.entries()) {
        const cornerId = `loop-${loopIndex + 1}-corner-${cornerIndex + 1}`;
        const offset = Math.max(agent.radius * 4, 0.5);
        let selected = null;
        let interiorSampleCount = 0;
        let overlapSampleCount = 0;
        for (let sample = 0; sample < 32; sample += 1) {
          const angle = sample / 32 * Math.PI * 2;
          const origin2 = [
            corner[0] + Math.cos(angle) * offset,
            corner[1] + Math.sin(angle) * offset,
          ];
          const requestedEnd2 = [
            corner[0] - Math.cos(angle) * offset,
            corner[1] - Math.sin(angle) * offset,
          ];
          if (!pointInPolygon2(origin2, loop) || pointInPolygon2(requestedEnd2, loop)) continue;
          interiorSampleCount += 1;
          const floorElevation = loopRecord.minY;
          const floorClearance = Math.max(0.01, agent.radius * 0.05);
          const center = [origin2[0], floorElevation + agent.height / 2 + floorClearance, origin2[1]];
          const overlap = world.intersectionWithShape(
            toVector(center),
            { x: 0, y: 0, z: 0, w: 1 },
            shape,
            undefined,
            undefined,
            collider,
            body,
          );
          if (overlap) overlapSampleCount += 1;
          if (!overlap) {
            selected = { origin2, requestedEnd2, floorElevation, center };
            break;
          }
        }
        if (!selected) {
          throw structuralFailure(
            cornerId,
            "No player-sized interior origin could exercise this corner",
            {
              corner: roundedPoint([corner[0], loopRecord.minY, corner[1]]),
              interiorSampleCount,
              overlapSampleCount,
            },
          );
        }
        body.setTranslation(toVector(selected.center), true);
        world.step();
        const desired = [
          selected.requestedEnd2[0] - selected.origin2[0],
          0,
          selected.requestedEnd2[1] - selected.origin2[1],
        ];
        controller.computeColliderMovement(collider, toVector(desired));
        const corrected = controller.computedMovement();
        const actualEnd = [
          selected.origin2[0] + corrected.x,
          selected.floorElevation,
          selected.origin2[1] + corrected.z,
        ];
        const requestedDistance = Math.hypot(desired[0], desired[2]);
        const actualDistance = Math.hypot(corrected.x, corrected.z);
        const actualPoint2 = [actualEnd[0], actualEnd[2]];
        const remainedInside = pointInPolygon2(actualPoint2, loop) ||
          distanceToPolygon2(actualPoint2, loop) <= Math.max(0.01, agent.radius * 0.15);
        const blocked = actualDistance < requestedDistance - Math.max(0.02, agent.radius * 0.2);
        if (!blocked || !remainedInside) {
          throw structuralFailure(cornerId, "Walk capsule tunneled through a reviewed structural corner", {
            origin: roundedPoint([selected.origin2[0], selected.floorElevation, selected.origin2[1]]),
            requestedEnd: roundedPoint([
              selected.requestedEnd2[0],
              selected.floorElevation,
              selected.requestedEnd2[1],
            ]),
            actualEnd: roundedPoint(actualEnd),
          });
        }
        loopProbes.push({
          cornerId,
          origin: roundedPoint([selected.origin2[0], selected.floorElevation, selected.origin2[1]]),
          requestedEnd: roundedPoint([
            selected.requestedEnd2[0],
            selected.floorElevation,
            selected.requestedEnd2[1],
          ]),
          actualEnd: roundedPoint(actualEnd),
          blocked: true,
          remainedInside: true,
        });
      }
    }
  };
  try {
    for (const entry of work) {
      let accepted = null;
      let firstFailure = null;
      for (const [candidateIndex, loopRecord] of entry.loops.entries()) {
        const outcome = exerciseLoop(loopRecord, candidateIndex);
        if (process.env.CORNER_DEBUG) {
          const area = Math.abs(signedPolygonArea2(loopRecord.points)).toFixed(1);
          console.error(`[corner-debug] ${entry.surfaceId} candidate ${candidateIndex} ` +
            `area=${area} corners=${loopRecord.points.length} passed=${outcome.passed}` +
            (outcome.passed ? "" : ` err=${outcome.error?.details?.anchorId ?? outcome.error?.message}`));
        }
        if (outcome.passed) {
          accepted = outcome;
          break;
        }
        firstFailure ??= outcome.error;
      }
      if (!accepted) throw firstFailure;
      for (const probe of accepted.probes) {
        if (!probes.some((existing) => existing.cornerId === probe.cornerId &&
          existing.origin.join() === probe.origin.join())) {
          probes.push(probe);
        }
      }
    }
  } finally {
    world.removeCharacterController(controller);
    world.removeCollider(collider, true);
    world.removeRigidBody(body);
  }
  return probes;
}

async function validateDynamicBarrierState({
  world,
  artifact,
  agent,
}) {
  const barriers = artifact.dynamicBarriers ?? [];
  if (!barriers.length) return [];
  const runtime = await importNavigationArtifact(artifact);
  const probes = [];
  try {
    for (const barrier of barriers) {
      const extentX = barrier.max[0] - barrier.min[0];
      const extentZ = barrier.max[2] - barrier.min[2];
      const axis = extentX <= extentZ ? "x" : "z";
      const axisIndex = axis === "x" ? 0 : 2;
      const center = barrier.min.map((coordinate, index) => (coordinate + barrier.max[index]) / 2);
      const floorElevation = floorElevationAt(
        structuralHorizontalSurfaces(artifact.structuralGeometry, "floor"),
        [center[0], center[2]],
      );
      if (floorElevation === null) {
        throw structuralFailure(barrier.id, "Dynamic barrier has no reviewed floor beneath it");
      }
      const clearance = (barrier.max[axisIndex] - barrier.min[axisIndex]) / 2 +
        agent.radius * 2 + Math.max(0.04, artifact.build.cellSize);
      const start = [center[0], floorElevation, center[2]];
      const end = [center[0], floorElevation, center[2]];
      start[axisIndex] -= clearance;
      end[axisIndex] += clearance;
      const route = runtime.path(start, end);
      if (!route || route.length < 2 || !pathIntersectsExpandedBox(route, barrier, agent.radius)) {
        throw structuralFailure(
          barrier.id,
          "Dynamic barrier does not gate a complete Detour route in its open state",
        );
      }
      const halfHeight = Math.max(0.01, (agent.height - agent.radius * 2) / 2);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
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
      const dynamicCollider = addBoxCollider(world, barrier.min, barrier.max);
      const startCenter = feetToCenter(start, agent.height);
      const desired = end.map((coordinate, index) => coordinate - start[index]);
      const requestedDistance = Math.hypot(desired[0], desired[2]);
      try {
        dynamicCollider.setEnabled(false);
        body.setTranslation(startCenter, true);
        world.step();
        controller.computeColliderMovement(collider, toVector(desired));
        const openMovement = controller.computedMovement();
        const openDistance = Math.hypot(openMovement.x, openMovement.z);
        if (openDistance < requestedDistance - Math.max(0.04, artifact.build.cellSize)) {
          throw structuralFailure(barrier.id, "Open dynamic barrier did not permit the production Walk capsule");
        }
        dynamicCollider.setEnabled(true);
        body.setTranslation(startCenter, true);
        world.step();
        controller.computeColliderMovement(collider, toVector(desired));
        const closedMovement = controller.computedMovement();
        const closedDistance = Math.hypot(closedMovement.x, closedMovement.z);
        if (closedDistance >= requestedDistance - Math.max(0.04, agent.radius * 0.2)) {
          throw structuralFailure(barrier.id, "Closed dynamic barrier did not block the production Walk capsule");
        }
      } finally {
        world.removeCharacterController(controller);
        world.removeCollider(dynamicCollider, true);
        world.removeCollider(collider, true);
        world.removeRigidBody(body);
      }
      probes.push({
        barrierId: barrier.id,
        axis,
        open: { physicsPassable: true, routePassable: true },
        closed: { physicsBlocked: true, routeBlocked: true },
      });
    }
  } finally {
    runtime.destroy();
  }
  return probes;
}

function floorElevationAt(surfaces, point) {
  const elevations = surfaces
    .filter((surface) => pointInHorizontalSurface(point, surface))
    .map((surface) => surface.elevation);
  return elevations.length ? Math.max(...elevations) : null;
}

function pathIntersectsExpandedBox(path, barrier, radius) {
  const min = [barrier.min[0] - radius, barrier.min[2] - radius];
  const max = [barrier.max[0] + radius, barrier.max[2] + radius];
  return path.slice(1).some((end, index) => segmentIntersectsBox2(
    [path[index][0], path[index][2]],
    [end[0], end[2]],
    min,
    max,
  ));
}

function segmentIntersectsBox2(start, end, min, max) {
  let entry = 0;
  let exit = 1;
  for (let axis = 0; axis < 2; axis += 1) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) <= 1e-9) {
      if (start[axis] < min[axis] || start[axis] > max[axis]) return false;
      continue;
    }
    const first = (min[axis] - start[axis]) / delta;
    const second = (max[axis] - start[axis]) / delta;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (entry > exit) return false;
  }
  return true;
}

function distanceToPolygon2(point, polygon) {
  let minimum = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    minimum = Math.min(minimum, distanceToSegment2(point, start, end));
  }
  return minimum;
}

function distanceToSegment2(point, start, end) {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const denominator = deltaX * deltaX + deltaY * deltaY;
  const amount = denominator
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / denominator))
    : 0;
  return Math.hypot(
    point[0] - (start[0] + deltaX * amount),
    point[1] - (start[1] + deltaY * amount),
  );
}

function addBoxCollider(world, min, max) {
  const half = min.map((coordinate, axis) => (max[axis] - coordinate) / 2);
  return world.createCollider(
    RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setTranslation(
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ),
  );
}

function addBoundaryNode(nodes, key, point, neighbour) {
  const node = nodes.get(key) ?? { point: [...point], neighbours: [] };
  node.neighbours.push(neighbour);
  nodes.set(key, node);
}

function point2Key(point) {
  return `${round(Number(point[0]))},${round(Number(point[1]))}`;
}

function structuralHorizontalSurfaces(geometry, label) {
  if (!geometry) return [];
  const authored = geometry[`${label}Surfaces`];
  if (Array.isArray(authored) && authored.length) {
    return authored.map((surface) => ({
      id: surface.id,
      elevation: surface.points[0][1],
      points: surface.points.map((point) => [...point]),
      holes: (surface.holes ?? []).map((hole) => hole.map((point) => [...point])),
    }));
  }
  return (geometry[`${label}Rectangles`] ?? []).map((rectangle) => ({
    id: rectangle.id,
    elevation: rectangle.elevation,
    points: [
      [rectangle.min[0], rectangle.elevation, rectangle.min[1]],
      [rectangle.min[0], rectangle.elevation, rectangle.max[1]],
      [rectangle.max[0], rectangle.elevation, rectangle.max[1]],
      [rectangle.max[0], rectangle.elevation, rectangle.min[1]],
    ],
    holes: [],
  }));
}

function horizontalSurfaceInteriorPoint(surface) {
  const triangulation = triangulateHorizontalSurface(surface);
  let selected = null;
  for (let index = 0; index < triangulation.indices.length; index += 3) {
    const triangle = triangulation.indices.slice(index, index + 3)
      .map((pointIndex) => triangulation.points2[pointIndex]);
    const area = Math.abs(signedPolygonArea2(triangle));
    if (!selected || area > selected.area) {
      selected = {
        area,
        point: [
          triangle.reduce((sum, point) => sum + point[0], 0) / 3,
          triangle.reduce((sum, point) => sum + point[1], 0) / 3,
        ],
      };
    }
  }
  return selected.point;
}

function horizontalSurfaceTriangles2(surface) {
  const triangulation = triangulateHorizontalSurface(surface);
  const triangles = [];
  for (let index = 0; index < triangulation.indices.length; index += 3) {
    triangles.push(triangulation.indices.slice(index, index + 3)
      .map((pointIndex) => triangulation.points2[pointIndex]));
  }
  return triangles;
}

function triangleContainedInRing(triangle, boundary) {
  if (triangle.some((point) =>
    !pointInPolygon2(point, boundary) && !pointOnRing2(point, boundary))) return false;
  return !polygonSegments(triangle).some(([start, end]) =>
    polygonSegments(boundary).some(([boundaryStart, boundaryEnd]) =>
      segmentsStrictlyCross2(start, end, boundaryStart, boundaryEnd)));
}

function triangleContainedInHorizontalSurface(triangle, surface) {
  if (triangle.some((point) => !pointInHorizontalSurface2(point, surface, true))) return false;
  const triangleEdges = polygonSegments(triangle);
  const surfaceRings = [ring2(surface.points), ...(surface.holes ?? []).map(ring2)];
  if (triangleEdges.some(([start, end]) =>
    surfaceRings.some((surfaceRing) => polygonSegments(surfaceRing)
      .some(([surfaceStart, surfaceEnd]) =>
        segmentsStrictlyCross2(start, end, surfaceStart, surfaceEnd))))) return false;
  return !(surface.holes ?? []).some((hole) => ring2(hole).some((point) =>
    pointInPolygon2(point, triangle) && !pointOnRing2(point, triangle)));
}

function segmentsStrictlyCross2(a, b, c, d) {
  const first = orientation2(a, b, c);
  const second = orientation2(a, b, d);
  const third = orientation2(c, d, a);
  const fourth = orientation2(c, d, b);
  const epsilon = 1e-6;
  if ([first, second, third, fourth].some((value) => Math.abs(value) <= epsilon)) {
    return false;
  }
  return (first > 0) !== (second > 0) && (third > 0) !== (fourth > 0);
}

function orientation2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
}

function surfaceComponents(surfaces) {
  const remaining = new Set(surfaces.map((_, index) => index));
  const components = [];
  while (remaining.size) {
    const seed = remaining.values().next().value;
    remaining.delete(seed);
    const queue = [seed];
    const component = [];
    while (queue.length) {
      const index = queue.shift();
      const surface = surfaces[index];
      component.push(surface);
      for (const candidate of [...remaining]) {
        if (surfacesTouch(surface, surfaces[candidate])) {
          remaining.delete(candidate);
          queue.push(candidate);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function surfacesTouch(first, second) {
  if (Math.abs(first.elevation - second.elevation) > 0.05) return false;
  const firstRing = ring2(first.points);
  const secondRing = ring2(second.points);
  if (firstRing.some((point) => pointInHorizontalSurface(point, second)) ||
    secondRing.some((point) => pointInHorizontalSurface(point, first))) return true;
  return polygonSegments(firstRing).some(([firstStart, firstEnd]) =>
    polygonSegments(secondRing).some(([secondStart, secondEnd]) =>
      segmentsIntersect2(firstStart, firstEnd, secondStart, secondEnd)));
}

function polygonSegments(points) {
  return points.map((point, index) => [point, points[(index + 1) % points.length]]);
}

function segmentsIntersect2(a, b, c, d) {
  const cross = (first, second, third) =>
    (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0]);
  const values = [cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)];
  if (values.some((value) => Math.abs(value) <= 1e-6)) {
    return [a, b].some((point) => pointOnSegment2(point, c, d)) ||
      [c, d].some((point) => pointOnSegment2(point, a, b));
  }
  return (values[0] > 0) !== (values[1] > 0) && (values[2] > 0) !== (values[3] > 0);
}

function pointOnSegment2(point, start, end) {
  return distanceToSegment2(point, start, end) <= 1e-6;
}

function pointInHorizontalSurface(point, surface) {
  return pointInHorizontalSurface2(point, surface);
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

function replayControlledRoute({
  route,
  direction,
  destinationId,
  agent,
  positions,
  indices,
  obstacleBoxes,
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
    controller.setSlideEnabled(false);

    let center = floatPoint(feetToCenter(route[0], agent.height));
    body.setTranslation(toVector(center), true);
    let simulatedSteps = 0;
    let pathLength = 0;

    for (const waypoint of route.slice(1)) {
      const target = floatPoint(feetToCenter(waypoint, agent.height));
      const desired = [
        target[0] - center[0],
        target[1] - center[1],
        target[2] - center[2],
      ];
      pathLength += distance(center, target);
      controller.computeColliderMovement(collider, toVector(desired));
      const corrected = controller.computedMovement();
      if (!controlledMovementReachedTarget(desired, corrected)) {
        const requestedMovement = roundedPoint(desired);
        const correctedMovement = roundedPoint([corrected.x, corrected.y, corrected.z]);
        throw physicalFailure(
          destinationId,
          `Rapier collision response deviated from the authored controlled path: requested=${JSON.stringify(desired)}, corrected=${JSON.stringify([corrected.x, corrected.y, corrected.z])}`,
          { requestedMovement, correctedMovement },
        );
      }
      body.setNextKinematicTranslation(toVector(target));
      world.step();
      const actual = body.translation();
      center = [actual.x, actual.y, actual.z];
      simulatedSteps += 1;
      if (distance(center, target) !== 0) {
        throw physicalFailure(
          destinationId,
          `Rapier capsule did not reach the authored controlled waypoint exactly: requested_target=${JSON.stringify(roundedPoint(target))}, actual=${JSON.stringify(roundedPoint(center))}`,
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
      finalPosition: roundedPoint([
        center[0],
        center[1] - agent.height / 2,
        center[2],
      ]),
    };
  } finally {
    world.free();
  }
}

export function controlledMovementReachedTarget(requested, corrected) {
  return corrected.x === Math.fround(requested[0]) &&
    corrected.y === Math.fround(requested[1]) &&
    corrected.z === Math.fround(requested[2]);
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

function floatPoint(value) {
  const point = Array.isArray(value) ? value : [value.x, value.y, value.z];
  return point.map(Math.fround);
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
