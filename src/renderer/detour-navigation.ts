import {
  NavMeshQuery,
  importNavMesh,
  init,
  type NavMesh,
} from "@recast-navigation/core";
import type { Vector3Tuple } from "../shared/navigation-runtime";
import {
  AuthoredTraversalController,
  type AuthoredTraversalFrame,
  type AuthoredTraversalLink,
} from "./authored-traversal";

export type DetourNavigationArtifact = {
  schemaVersion: "spatial-navigation-v6" | "spatial-navigation-v7" | "spatial-navigation-v8";
  generator: { version: "0.43.1" };
  agent: { radius: number; height: number; eyeHeight: number };
  build: { cellSize: number; cellHeight: number };
  bounds: [Vector3Tuple, Vector3Tuple];
  dynamicBarriers?: Array<{
    id: string;
    min: Vector3Tuple;
    max: Vector3Tuple;
    defaultActive: boolean;
  }>;
  spawn: { projectedPosition: Vector3Tuple };
  offMeshConnections: AuthoredTraversalLink[];
  detour: {
    format: "recast-navigation-js-export-v1";
    bytesBase64: string;
  };
};

let initialization: Promise<void> | undefined;

export class DetourNavigationRuntime {
  readonly #navMesh: NavMesh;
  readonly #query: NavMeshQuery;
  readonly #artifact: DetourNavigationArtifact;
  readonly #authoredTraversal: AuthoredTraversalController;
  readonly #halfExtents: { x: number; y: number; z: number };
  readonly #dynamicBarriers = new Map<string, {
    min: Vector3Tuple;
    max: Vector3Tuple;
    active: boolean;
  }>();

  private constructor(navMesh: NavMesh, artifact: DetourNavigationArtifact) {
    this.#navMesh = navMesh;
    this.#query = new NavMeshQuery(navMesh, { maxNodes: 4096 });
    this.#artifact = artifact;
    this.#authoredTraversal = new AuthoredTraversalController(
      artifact.offMeshConnections,
      artifact.agent.eyeHeight,
    );
    this.#halfExtents = {
      x: Math.max(artifact.agent.radius * 2, artifact.build.cellSize * 2),
      y: Math.max(artifact.agent.height, artifact.build.cellHeight * 2),
      z: Math.max(artifact.agent.radius * 2, artifact.build.cellSize * 2),
    };
    for (const barrier of artifact.dynamicBarriers ?? []) {
      this.#dynamicBarriers.set(barrier.id, {
        min: [...barrier.min],
        max: [...barrier.max],
        active: barrier.defaultActive,
      });
    }
  }

  static async create(value: unknown): Promise<DetourNavigationRuntime> {
    const artifact = parseArtifact(value);
    initialization ??= init();
    await initialization;
    const bytes = decodeBase64(artifact.detour.bytesBase64);
    const { navMesh } = importNavMesh(bytes);
    return new DetourNavigationRuntime(navMesh, artifact);
  }

  projectCamera(position: Vector3Tuple): Vector3Tuple | null {
    const feet = this.#cameraToFeet(position);
    const projected = this.#query.findClosestPoint(toVector(feet), {
      halfExtents: this.#halfExtents,
    });
    if (!projected.success) return null;
    const maximumDistance = Math.max(
      this.#artifact.agent.radius * 2,
      this.#artifact.build.cellSize * 3,
    );
    if (distance(feet, projected.point) > maximumDistance) return null;
    return [
      projected.point.x,
      projected.point.y + this.#artifact.agent.eyeHeight,
      projected.point.z,
    ];
  }

  openingCamera(): Vector3Tuple {
    const [x, y, z] = this.#artifact.spawn.projectedPosition;
    return [x, y + this.#artifact.agent.eyeHeight, z];
  }

  hasDynamicBarrier(id: string): boolean {
    return this.#dynamicBarriers.has(id);
  }

  setDynamicBarrierState(id: string, active: boolean): boolean {
    const barrier = this.#dynamicBarriers.get(id);
    if (!barrier) return false;
    barrier.active = active;
    return true;
  }

  isCameraAllowed(position: Vector3Tuple): boolean {
    const projected = this.projectCamera(position);
    return Boolean(projected && distance(position, projected) <= this.#artifact.build.cellSize * 1.5);
  }

  moveCamera(from: Vector3Tuple, desired: Vector3Tuple): Vector3Tuple | null {
    const startFeet = this.#cameraToFeet(from);
    const desiredFeet = this.#cameraToFeet(desired);
    const start = this.#query.findClosestPoint(toVector(startFeet), {
      halfExtents: this.#halfExtents,
    });
    if (!start.success) return null;
    const moved = this.#query.moveAlongSurface(
      start.polyRef,
      start.point,
      toVector(desiredFeet),
      { maxVisitedSize: 256 },
    );
    if (!moved.success) return null;
    return [
      moved.resultPosition.x,
      moved.resultPosition.y + this.#artifact.agent.eyeHeight,
      moved.resultPosition.z,
    ];
  }

  resolveAuthoredTraversal(
    from: Vector3Tuple,
    desired: Vector3Tuple,
    deltaSeconds: number,
  ): AuthoredTraversalFrame | null {
    return this.#authoredTraversal.resolveMovement(from, desired, deltaSeconds);
  }

  cancelAuthoredTraversal(): void {
    this.#authoredTraversal.cancel();
  }

  hasCompletePath(from: Vector3Tuple, to: Vector3Tuple): boolean {
    const start = this.projectCamera(from);
    const end = this.projectCamera(to);
    if (!start || !end) return false;
    const startFeet = this.#cameraToFeet(start);
    const endFeet = this.#cameraToFeet(end);
    const result = this.#query.computePath(toVector(startFeet), toVector(endFeet), {
      halfExtents: this.#halfExtents,
      maxPathPolys: 4096,
      maxStraightPathPoints: 4096,
    });
    const last = result.path.at(-1);
    return Boolean(
      result.success &&
      last &&
      distance(endFeet, last) <= this.#artifact.build.cellSize * 2 &&
      !this.#pathBlockedByDynamicBarrier(result.path),
    );
  }

  hasCompleteTopologyPath(from: Vector3Tuple, to: Vector3Tuple): boolean {
    const start = this.#projectTopologyCamera(from);
    const end = this.#projectTopologyCamera(to);
    if (!start || !end) return false;
    const startFeet = this.#cameraToFeet(start);
    const endFeet = this.#cameraToFeet(end);
    const result = this.#query.computePath(toVector(startFeet), toVector(endFeet), {
      halfExtents: this.#topologyHalfExtents(),
      maxPathPolys: 4096,
      maxStraightPathPoints: 4096,
    });
    const last = result.path.at(-1);
    return Boolean(
      result.success &&
      last &&
      distance(endFeet, last) <= this.#artifact.build.cellSize * 2 &&
      !this.#pathBlockedByDynamicBarrier(result.path),
    );
  }

  destroy(): void {
    this.#query.destroy();
    this.#navMesh.destroy();
  }

  #cameraToFeet(position: Vector3Tuple): Vector3Tuple {
    return [position[0], position[1] - this.#artifact.agent.eyeHeight, position[2]];
  }

  #projectTopologyCamera(position: Vector3Tuple): Vector3Tuple | null {
    const feet = this.#cameraToFeet(position);
    const projected = this.#query.findClosestPoint(toVector(feet), {
      halfExtents: this.#topologyHalfExtents(),
    });
    return projected.success
      ? [projected.point.x, projected.point.y + this.#artifact.agent.eyeHeight, projected.point.z]
      : null;
  }

  #topologyHalfExtents(): { x: number; y: number; z: number } {
    const [minimum, maximum] = this.#artifact.bounds;
    return {
      x: this.#halfExtents.x,
      y: Math.max(this.#halfExtents.y, maximum[1] - minimum[1] + this.#artifact.agent.height),
      z: this.#halfExtents.z,
    };
  }

  #pathBlockedByDynamicBarrier(path: Array<{ x: number; y: number; z: number }>): boolean {
    const active = [...this.#dynamicBarriers.values()].filter((barrier) => barrier.active);
    if (!active.length) return false;
    for (let index = 1; index < path.length; index += 1) {
      const start = path[index - 1]!;
      const end = path[index]!;
      if (active.some((barrier) => segmentIntersectsExpandedBox(
        [start.x, start.y, start.z],
        [end.x, end.y, end.z],
        barrier.min,
        barrier.max,
        this.#artifact.agent.radius,
      ))) return true;
    }
    return false;
  }
}

function parseArtifact(value: unknown): DetourNavigationArtifact {
  if (!value || typeof value !== "object") throw new Error("Navigation artifact is missing");
  if (!["spatial-navigation-v6", "spatial-navigation-v7", "spatial-navigation-v8"].includes(
    String(Reflect.get(value, "schemaVersion")),
  )) {
    throw new Error("Unsupported navigation artifact schema");
  }
  const generator = Reflect.get(value, "generator");
  if (!generator || typeof generator !== "object" || Reflect.get(generator, "version") !== "0.43.1") {
    throw new Error("Navigation artifact requires a different Detour binding");
  }
  const agent = Reflect.get(value, "agent");
  const build = Reflect.get(value, "build");
  const spawn = Reflect.get(value, "spawn");
  const detour = Reflect.get(value, "detour");
  const bounds = Reflect.get(value, "bounds");
  const dynamicBarriers = Reflect.get(value, "dynamicBarriers");
  const offMeshConnections = Reflect.get(value, "offMeshConnections");
  if (!agent || typeof agent !== "object" || !build || typeof build !== "object" ||
    !spawn || typeof spawn !== "object" || !finiteTuple(Reflect.get(spawn, "projectedPosition")) ||
    !Array.isArray(bounds) || bounds.length !== 2 || !bounds.every(finiteTuple) ||
    !detour || typeof detour !== "object" ||
    Reflect.get(detour, "format") !== "recast-navigation-js-export-v1" ||
    typeof Reflect.get(detour, "bytesBase64") !== "string" ||
    !validDynamicBarriers(dynamicBarriers) ||
    !validAuthoredTraversals(offMeshConnections)) {
    throw new Error("Navigation artifact is incomplete");
  }
  for (const [record, names] of [
    [agent, ["radius", "height", "eyeHeight"]],
    [build, ["cellSize", "cellHeight"]],
  ] as const) {
    if (names.some((name) => !Number.isFinite(Number(Reflect.get(record, name))))) {
      throw new Error("Navigation artifact contains invalid numeric parameters");
    }
  }
  return value as DetourNavigationArtifact;
}

function validAuthoredTraversals(value: unknown): value is AuthoredTraversalLink[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((connection) => {
    if (!connection || typeof connection !== "object") return false;
    const id = Reflect.get(connection, "id");
    const kind = Reflect.get(connection, "traversalKind");
    const controlPoints = Reflect.get(connection, "controlPoints");
    const radius = Number(Reflect.get(connection, "radius"));
    const speed = Number(Reflect.get(connection, "speedUnitsPerSecond"));
    const reviewedPurpose = Reflect.get(connection, "reviewedPurpose");
    const evidenceReceipt = Reflect.get(connection, "evidenceReceipt");
    if (typeof id !== "string" || !id || ids.has(id) ||
      !["elevator", "ladder", "moving_platform"].includes(String(kind)) ||
      !finiteTuple(Reflect.get(connection, "startPosition")) ||
      !finiteTuple(Reflect.get(connection, "endPosition")) ||
      !Array.isArray(controlPoints) || !controlPoints.every(finiteTuple) ||
      !Number.isFinite(radius) || radius <= 0 ||
      !Number.isFinite(speed) || speed <= 0 ||
      typeof Reflect.get(connection, "bidirectional") !== "boolean" ||
      typeof reviewedPurpose !== "string" || !reviewedPurpose.trim() ||
      !evidenceReceipt || typeof evidenceReceipt !== "object" ||
      typeof Reflect.get(evidenceReceipt, "assetId") !== "string" ||
      !/^[a-f0-9]{64}$/i.test(String(Reflect.get(evidenceReceipt, "sha256")))) return false;
    ids.add(id);
    return true;
  });
}

function validDynamicBarriers(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((barrier) => {
    if (!barrier || typeof barrier !== "object") return false;
    const id = Reflect.get(barrier, "id");
    const min = Reflect.get(barrier, "min");
    const max = Reflect.get(barrier, "max");
    const active = Reflect.get(barrier, "defaultActive");
    if (typeof id !== "string" || !id || ids.has(id) || !finiteTuple(min) ||
      !finiteTuple(max) || min.some((coordinate, axis) => coordinate >= max[axis]!) ||
      typeof active !== "boolean") return false;
    ids.add(id);
    return true;
  });
}

function segmentIntersectsExpandedBox(
  start: Vector3Tuple,
  end: Vector3Tuple,
  minimum: Vector3Tuple,
  maximum: Vector3Tuple,
  expansion: number,
): boolean {
  let near = 0;
  let far = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = end[axis]! - start[axis]!;
    const min = minimum[axis]! - expansion;
    const max = maximum[axis]! + expansion;
    if (Math.abs(delta) < 1e-9) {
      if (start[axis]! < min || start[axis]! > max) return false;
      continue;
    }
    const first = (min - start[axis]!) / delta;
    const second = (max - start[axis]!) / delta;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return false;
  }
  return true;
}

function finiteTuple(value: unknown): value is Vector3Tuple {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toVector(value: Vector3Tuple): { x: number; y: number; z: number } {
  return { x: value[0], y: value[1], z: value[2] };
}

function distance(
  first: Vector3Tuple,
  second: Vector3Tuple | { x: number; y: number; z: number },
): number {
  const values: Vector3Tuple = Array.isArray(second)
    ? second
    : [second.x, second.y, second.z];
  return Math.hypot(first[0] - values[0], first[1] - values[1], first[2] - values[2]);
}
