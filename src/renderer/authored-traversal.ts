import type { Vector3Tuple } from "../shared/navigation-runtime";
import type { TraversalEvidenceReceipt } from "../shared/traversal-evidence";

export type AuthoredTraversalKind = "elevator" | "ladder" | "moving_platform";

export type AuthoredTraversalLink = {
  id: string;
  traversalKind: AuthoredTraversalKind;
  label: string;
  requestedStartPosition?: Vector3Tuple;
  startPosition: Vector3Tuple;
  controlPoints: Vector3Tuple[];
  requestedEndPosition?: Vector3Tuple;
  endPosition: Vector3Tuple;
  radius: number;
  bidirectional: boolean;
  speedUnitsPerSecond: number;
  reviewedPurpose: string;
  evidenceReceipt: TraversalEvidenceReceipt;
};

export type AuthoredTraversalFrame = {
  connectionId: string;
  traversalKind: AuthoredTraversalKind;
  label: string;
  evidenceReceipt: AuthoredTraversalLink["evidenceReceipt"];
  position: Vector3Tuple;
  started: boolean;
  phase: "started" | "active" | "completed";
};

type ActiveTraversal = {
  connection: AuthoredTraversalLink;
  points: Vector3Tuple[];
  segmentIndex: number;
  position: Vector3Tuple;
};

/**
 * Runs only explicit, reviewed discontinuities. Ordinary movement remains with
 * Detour and Rapier; this controller owns the one interval where an elevator,
 * ladder, or moving platform carries the camera along its frozen 3D path.
 */
export class AuthoredTraversalController {
  readonly #links: AuthoredTraversalLink[];
  readonly #eyeHeight: number;
  #active: ActiveTraversal | null = null;
  #completedExit: { connectionId: string; position: Vector3Tuple; radius: number } | null = null;

  constructor(links: AuthoredTraversalLink[], eyeHeight: number) {
    this.#links = links.map((link) => ({
      ...link,
      startPosition: [...link.startPosition],
      controlPoints: link.controlPoints.map((point) => [...point]),
      endPosition: [...link.endPosition],
      evidenceReceipt: { ...link.evidenceReceipt },
    }));
    this.#eyeHeight = eyeHeight;
  }

  get active(): boolean {
    return Boolean(this.#active);
  }

  resolveMovement(
    fromCamera: Vector3Tuple,
    desiredCamera: Vector3Tuple,
    deltaSeconds: number,
  ): AuthoredTraversalFrame | null {
    if (!this.#active) {
      this.#clearCompletedExitAfterDeparture(fromCamera);
      const displacement = distance(fromCamera, desiredCamera);
      if (displacement <= 0) return null;
      const entry = this.#entryAt(fromCamera, desiredCamera);
      if (!entry) return null;
      const feetPath = entry.reverse
        ? [
            entry.connection.endPosition,
            ...[...entry.connection.controlPoints].reverse(),
            entry.connection.startPosition,
          ]
        : [
            entry.connection.startPosition,
            ...entry.connection.controlPoints,
            entry.connection.endPosition,
          ];
      this.#active = {
        connection: entry.connection,
        points: [
          [...fromCamera],
          ...feetPath.map((point) => this.#feetToCamera(point)),
        ],
        segmentIndex: 1,
        position: [...fromCamera],
      };
      return this.#advance(deltaSeconds, "started");
    }
    return this.#advance(deltaSeconds, "active");
  }

  cancel(): void {
    this.#active = null;
  }

  #advance(
    deltaSeconds: number,
    initialPhase: "started" | "active",
  ): AuthoredTraversalFrame {
    const active = this.#active!;
    let remainingDistance = active.connection.speedUnitsPerSecond *
      Math.max(0, deltaSeconds);
    while (active.segmentIndex < active.points.length) {
      const target = active.points[active.segmentIndex]!;
      const segmentRemaining = distance(active.position, target);
      if (segmentRemaining > remainingDistance) {
        active.position = moveToward(active.position, target, remainingDistance);
        remainingDistance = 0;
        break;
      }
      active.position = [...target];
      active.segmentIndex += 1;
      remainingDistance -= segmentRemaining;
      if (remainingDistance <= 0) break;
    }
    const completed = active.segmentIndex >= active.points.length;
    const frame: AuthoredTraversalFrame = {
      connectionId: active.connection.id,
      traversalKind: active.connection.traversalKind,
      label: active.connection.label,
      evidenceReceipt: { ...active.connection.evidenceReceipt },
      position: [...active.position],
      started: initialPhase === "started",
      phase: completed ? "completed" : initialPhase,
    };
    if (completed) {
      this.#completedExit = {
        connectionId: active.connection.id,
        position: [...active.position],
        radius: active.connection.radius,
      };
      this.#active = null;
    }
    return frame;
  }

  #entryAt(cameraPosition: Vector3Tuple, desiredCamera: Vector3Tuple): {
    connection: AuthoredTraversalLink;
    reverse: boolean;
  } | null {
    let nearest: {
      connection: AuthoredTraversalLink;
      reverse: boolean;
      distance: number;
    } | null = null;
    for (const connection of this.#links) {
      if (this.#completedExit?.connectionId === connection.id) continue;
      for (const reverse of connection.bidirectional ? [false, true] : [false]) {
        const endpoint = this.#feetToCamera(
          reverse ? connection.endPosition : connection.startPosition,
        );
        const endpointDistance = distance(cameraPosition, endpoint);
        const feetPath = reverse
          ? [connection.endPosition, ...[...connection.controlPoints].reverse(), connection.startPosition]
          : [connection.startPosition, ...connection.controlPoints, connection.endPosition];
        const directionTarget = feetPath.find((point) => distance(feetPath[0]!, point) > 0);
        const displacement: Vector3Tuple = [
          desiredCamera[0] - cameraPosition[0],
          desiredCamera[1] - cameraPosition[1],
          desiredCamera[2] - cameraPosition[2],
        ];
        const entersReviewedPath = directionTarget && dot(
          displacement,
          [
            directionTarget[0] - feetPath[0]![0],
            directionTarget[1] - feetPath[0]![1],
            directionTarget[2] - feetPath[0]![2],
          ],
        ) > 0;
        if (endpointDistance > connection.radius ||
          !entersReviewedPath ||
          (nearest && endpointDistance >= nearest.distance)) continue;
        nearest = { connection, reverse, distance: endpointDistance };
      }
    }
    return nearest
      ? { connection: nearest.connection, reverse: nearest.reverse }
      : null;
  }

  #clearCompletedExitAfterDeparture(cameraPosition: Vector3Tuple): void {
    if (this.#completedExit &&
      distance(cameraPosition, this.#completedExit.position) > this.#completedExit.radius) {
      this.#completedExit = null;
    }
  }

  #feetToCamera(position: Vector3Tuple): Vector3Tuple {
    return [position[0], position[1] + this.#eyeHeight, position[2]];
  }
}

function moveToward(
  from: Vector3Tuple,
  to: Vector3Tuple,
  requestedDistance: number,
): Vector3Tuple {
  const totalDistance = distance(from, to);
  if (totalDistance <= requestedDistance || totalDistance <= 0) return [...to];
  const ratio = requestedDistance / totalDistance;
  return [
    from[0] + (to[0] - from[0]) * ratio,
    from[1] + (to[1] - from[1]) * ratio,
    from[2] + (to[2] - from[2]) * ratio,
  ];
}

function distance(first: Vector3Tuple, second: Vector3Tuple): number {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  );
}

function dot(first: Vector3Tuple, second: Vector3Tuple): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}
