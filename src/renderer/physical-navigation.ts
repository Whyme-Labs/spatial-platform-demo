import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Vector3Tuple } from "../shared/navigation-runtime";

type PhysicalAgentProfile = {
  radius: number;
  height: number;
  eyeHeight: number;
  maxClimb: number;
  maxSlopeDegrees: number;
};

type RecoveryBounds = [Vector3Tuple, Vector3Tuple];
type DynamicBarrier = {
  id: string;
  min: Vector3Tuple;
  max: Vector3Tuple;
  defaultActive: boolean;
};

type MovementVector = { x: number; y: number; z: number };
type StructuralBarrierSegment = {
  id: string;
  start: [number, number];
  end: [number, number];
  minY: number;
  maxY: number;
  // Half the frozen wall thickness: contacts land on the prism's face, this
  // far from the centreline the segment coordinates describe.
  thicknessM?: number;
};
type StructuralBlockerBox = {
  id: string;
  kind: "solid_furniture" | "no_go";
  min: Vector3Tuple;
  max: Vector3Tuple;
};
type MovementContact = {
  colliderHandle: number | null;
  point: Vector3Tuple | null;
  normal: Vector3Tuple | null;
};

export type PhysicalMovementMode = "walk" | "fly";

let initialization: Promise<void> | undefined;
// Sub-millimetre float32 corrections from a graze along authored geometry must
// not abort a controlled traversal; only genuine obstructions should block it.
const CONTROLLED_MOVEMENT_EPSILON_METRES = 1e-3;
const MAX_COLLISION_GLB_BYTES = 256 * 1024 * 1024;
const MAX_COLLISION_VERTICES = 3_000_000;
const MAX_COLLISION_TRIANGLES = 5_000_000;

export class PhysicalNavigationRuntime {
  readonly #world: RAPIER.World;
  readonly #body: RAPIER.RigidBody;
  #collider: RAPIER.Collider;
  #controller: RAPIER.KinematicCharacterController;
  readonly #controlledController: RAPIER.KinematicCharacterController;
  readonly #agent: PhysicalAgentProfile;
  readonly #recoveryBounds: Record<PhysicalMovementMode, RecoveryBounds>;
  readonly #dynamicBarrierColliders: Map<string, {
    collider: RAPIER.Collider;
    min: Vector3Tuple;
    max: Vector3Tuple;
  }>;
  #mode: PhysicalMovementMode;
  #verticalVelocity = 0;
  #controlledFailure: string | null = null;
  #structuralBarriers: StructuralBarrierSegment[] = [];
  #structuralBlockerBoxes: StructuralBlockerBox[] = [];
  #lastContacts: MovementContact[] = [];

  private constructor(
    world: RAPIER.World,
    body: RAPIER.RigidBody,
    collider: RAPIER.Collider,
    controller: RAPIER.KinematicCharacterController,
    controlledController: RAPIER.KinematicCharacterController,
    agent: PhysicalAgentProfile,
    mode: PhysicalMovementMode,
    recoveryBounds: Record<PhysicalMovementMode, RecoveryBounds>,
    dynamicBarrierColliders: Map<string, {
      collider: RAPIER.Collider;
      min: Vector3Tuple;
      max: Vector3Tuple;
    }>,
  ) {
    this.#world = world;
    this.#body = body;
    this.#collider = collider;
    this.#controller = controller;
    this.#controlledController = controlledController;
    this.#agent = agent;
    this.#mode = mode;
    this.#recoveryBounds = recoveryBounds;
    this.#dynamicBarrierColliders = dynamicBarrierColliders;
  }

  static async create(
    collisionUrl: string,
    artifact: unknown,
    obstacleBoxes: unknown[] = [],
    initialMode: PhysicalMovementMode = "walk",
  ): Promise<PhysicalNavigationRuntime> {
    const agent = parseAgent(artifact);
    const recoveryBounds = parseRecoveryBounds(artifact);
    initialization ??= RAPIER.init();
    const [response] = await Promise.all([
      fetch(collisionUrl, { credentials: "same-origin" }),
      initialization,
    ]);
    if (!response.ok) throw new Error(`Collision proxy download failed (${response.status})`);
    const contentLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_COLLISION_GLB_BYTES) {
      throw new Error(
        `collision_glb_bytes limit=${MAX_COLLISION_GLB_BYTES}, asked=${contentLength}`,
      );
    }
    const collisionBytes = await response.arrayBuffer();
    if (collisionBytes.byteLength > MAX_COLLISION_GLB_BYTES) {
      throw new Error(
        `collision_glb_bytes limit=${MAX_COLLISION_GLB_BYTES}, asked=${collisionBytes.byteLength}`,
      );
    }
    const geometry = await collisionGeometry(collisionBytes, artifact);
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.trimesh(
      new Float32Array(geometry.positions),
      new Uint32Array(geometry.indices),
    ));
    if (!geometry.structuralSemantics) {
      for (const rawBox of obstacleBoxes) addObstacleBox(world, rawBox);
    }
    const dynamicBarrierColliders = new Map<string, {
      collider: RAPIER.Collider;
      min: Vector3Tuple;
      max: Vector3Tuple;
    }>();
    for (const barrier of parseDynamicBarriers(artifact)) {
      const collider = addBoxCollider(world, barrier.min, barrier.max);
      collider.setEnabled(barrier.defaultActive);
      dynamicBarrierColliders.set(barrier.id, {
        collider,
        min: barrier.min,
        max: barrier.max,
      });
    }

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const mode = supportsMode(artifact, initialMode) ? initialMode : "walk";
    const { collider, controller } = createPlayer(world, body, agent, mode);
    const controlledController = createControlledPlayerController(world, agent);
    world.step();
    const runtime = new PhysicalNavigationRuntime(
      world,
      body,
      collider,
      controller,
      controlledController,
      agent,
      mode,
      recoveryBounds,
      dynamicBarrierColliders,
    );
    runtime.#structuralBarriers = parseStructuralBarrierSegments(artifact);
    runtime.#structuralBlockerBoxes = parseStructuralBlockerBoxes(artifact);
    return runtime;
  }

  get mode(): PhysicalMovementMode {
    return this.#mode;
  }

  get controlledFailure(): string | null {
    return this.#controlledFailure;
  }

  hasDynamicBarrier(id: string): boolean {
    return this.#dynamicBarrierColliders.has(id);
  }

  setDynamicBarrierState(id: string, active: boolean): boolean {
    const barrier = this.#dynamicBarrierColliders.get(id);
    if (!barrier) return false;
    // A door must never close on the player: enabling a barrier that overlaps
    // the capsule would start every following frame from penetration, and a
    // penetrating capsule can be pushed through the wall it belongs to.
    if (active && this.#playerOverlapsBox(barrier.min, barrier.max)) return false;
    barrier.collider.setEnabled(active);
    this.#world.step();
    return true;
  }

  #playerOverlapsBox(min: Vector3Tuple, max: Vector3Tuple): boolean {
    const center = this.#body.translation();
    const radius = this.#agent.radius;
    const halfY = this.#mode === "fly" ? radius : this.#agent.height / 2;
    return center.x + radius > min[0] && center.x - radius < max[0] &&
      center.y + halfY > min[1] && center.y - halfY < max[1] &&
      center.z + radius > min[2] && center.z - radius < max[2];
  }

  cameraPosition(): Vector3Tuple {
    const center = this.#body.translation();
    return this.#centerToCamera([center.x, center.y, center.z], this.#mode);
  }

  #recordMovementContacts(): void {
    this.#lastContacts = [];
    for (let index = 0; index < this.#controller.numComputedCollisions(); index += 1) {
      const collision = this.#controller.computedCollision(index);
      if (!collision) continue;
      this.#lastContacts.push({
        colliderHandle: collision.collider ? collision.collider.handle : null,
        point: collision.witness1
          ? [collision.witness1.x, collision.witness1.y, collision.witness1.z]
          : null,
        normal: collision.normal1
          ? [collision.normal1.x, collision.normal1.y, collision.normal1.z]
          : null,
      });
    }
  }

  // Names the specific reviewed geometry the last movement leaned on, so a
  // stopped walker can be told which wall stopped them instead of a generic
  // "blocked by the walking map". Dynamic doors resolve by their own collider
  // handle; the merged structural trimesh resolves by matching the contact
  // point against the frozen barrier segments the artifact carries.
  lastBlockedBarrier(): {
    id: string;
    kind: "dynamic" | "structural" | "solid_furniture" | "no_go";
  } | null {
    for (const contact of this.#lastContacts) {
      if (contact.colliderHandle !== null) {
        for (const [id, barrier] of this.#dynamicBarrierColliders) {
          if (
            barrier.collider.handle === contact.colliderHandle &&
            barrier.collider.isEnabled()
          ) {
            return { id, kind: "dynamic" };
          }
        }
      }
      if (!contact.point || !contact.normal) continue;
      // A mostly vertical contact normal is the floor or a ceiling, not the
      // wall the walker is asking about.
      if (Math.abs(contact.normal[1]) > 0.7) continue;
      // A contact on a reviewed box is more specific than the nearest wall
      // centreline — a solid cabinet often stands right against a wall.
      const box = this.#blockerBoxAt(contact.point);
      if (box) return { id: box.id, kind: box.kind };
      const nearest = this.#nearestBarrierSegment(contact.point);
      if (nearest) return { id: nearest, kind: "structural" };
    }
    return null;
  }

  #blockerBoxAt(point: Vector3Tuple): StructuralBlockerBox | null {
    const tolerance = 0.05;
    for (const box of this.#structuralBlockerBoxes) {
      if (
        point[0] >= box.min[0] - tolerance && point[0] <= box.max[0] + tolerance &&
        point[1] >= box.min[1] - tolerance && point[1] <= box.max[1] + tolerance &&
        point[2] >= box.min[2] - tolerance && point[2] <= box.max[2] + tolerance
      ) {
        return box;
      }
    }
    return null;
  }

  #nearestBarrierSegment(point: Vector3Tuple): string | null {
    let best: string | null = null;
    let bestDistance = Math.max(0.4, this.#agent.radius * 1.5);
    for (const barrier of this.#structuralBarriers) {
      if (point[1] < barrier.minY - 0.1 || point[1] > barrier.maxY + 0.1) continue;
      const distanceToSegment = pointToSegmentDistance2D(
        point[0],
        point[2],
        barrier.start,
        barrier.end,
      );
      // A thick wall's contact lands on its face, half a thickness away from
      // the centreline the segment records; measure from the face.
      const distanceToFace = distanceToSegment - (barrier.thicknessM ?? 0) / 2;
      if (distanceToFace < bestDistance) {
        bestDistance = distanceToFace;
        best = barrier.id;
      }
    }
    return best;
  }

  setMode(mode: PhysicalMovementMode, cameraPosition: Vector3Tuple): boolean {
    if (mode === this.#mode) return this.placeCamera(cameraPosition) !== null;
    const center = this.#cameraToCenter(cameraPosition, mode);
    if (!this.#canPlaceCenter(center, mode) ||
      (mode === "walk" && !this.#hasSafeGroundForWalk(cameraPosition))) return false;
    this.#world.removeCharacterController(this.#controller);
    this.#world.removeCollider(this.#collider, true);
    const player = createPlayer(this.#world, this.#body, this.#agent, mode);
    this.#collider = player.collider;
    this.#controller = player.controller;
    this.#mode = mode;
    this.#verticalVelocity = 0;
    this.#body.setTranslation(toRapierVector(center), true);
    this.#world.step();
    return true;
  }

  // Returns the physically resolved camera position, or null when the
  // placement is invalid. Walk placements are grounded first: navmesh
  // quantisation routinely hands over feet a few millimetres inside the
  // floor, and a full-size overlap test would truthfully reject the real
  // opening. Resting the capsule on its support answers with the height the
  // body will actually occupy, so callers must adopt the returned position.
  placeCamera(position: Vector3Tuple): Vector3Tuple | null {
    if (this.#mode === "fly") {
      const center = this.#cameraToCenter(position, "fly");
      if (!this.#canPlaceCenter(center, "fly")) return null;
      this.#body.setTranslation(toRapierVector(center), true);
      this.#verticalVelocity = 0;
      return [...position];
    }
    const requested = this.#cameraToCenter(position, "walk");
    const grounded = this.#groundedCenterNear(requested);
    if (!grounded || !this.#canPlaceCenter(grounded, "walk")) return null;
    this.#body.setTranslation(toRapierVector(grounded), true);
    this.#verticalVelocity = 0;
    return this.#centerToCamera(grounded, "walk");
  }

  // Rests the full-size capsule on whatever supports it near the requested
  // centre. Returns null when nothing supports the capsule within the step
  // tolerance — the void outside the shell has no floor to rest on.
  #groundedCenterNear(center: Vector3Tuple): Vector3Tuple | null {
    const halfHeight = Math.max(0.01, this.#agent.height / 2 - this.#agent.radius);
    const lift = Math.max(this.#agent.maxClimb, 0.05) + 0.03;
    const contactOffset = Math.max(0.002, Math.min(0.02, this.#agent.radius * 0.05));
    const start: Vector3Tuple = [center[0], center[1] + lift, center[2]];
    const hit = this.#world.castShape(
      toRapierVector(start),
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: -1, z: 0 },
      new RAPIER.Capsule(halfHeight, this.#agent.radius),
      0,
      lift * 2,
      true,
      undefined,
      undefined,
      this.#collider,
      this.#body,
    );
    if (!hit) return null;
    const restingY = start[1] - hit.time_of_impact + contactOffset;
    if (Math.abs(restingY - center[1]) > lift) return null;
    return [center[0], restingY, center[2]];
  }

  canPlaceCamera(position: Vector3Tuple): boolean {
    return this.#canPlaceCenter(this.#cameraToCenter(position, this.#mode), this.#mode);
  }

  #canPlaceCenter(center: Vector3Tuple, mode: PhysicalMovementMode): boolean {
    // Placement validates the full-size player shape: a shrunken probe can
    // accept a position the real capsule slightly overlaps, which starts the
    // next frame in penetration against geometry with no volume to recover
    // from. Height is preserved by deriving the half-height from the same
    // radius the probe uses.
    const halfHeight = Math.max(0.01, this.#agent.height / 2 - this.#agent.radius);
    const clearanceShape = mode === "fly"
      ? new RAPIER.Ball(this.#agent.radius)
      : new RAPIER.Capsule(halfHeight, this.#agent.radius);
    return !this.#world.intersectionWithShape(
      toRapierVector(center),
      { x: 0, y: 0, z: 0, w: 1 },
      clearanceShape,
      undefined,
      undefined,
      this.#collider,
      this.#body,
    );
  }

  #hasSafeGroundForWalk(cameraPosition: Vector3Tuple): boolean {
    const center = this.#cameraToCenter(cameraPosition, "walk");
    const halfHeight = Math.max(0.01, this.#agent.height / 2 - this.#agent.radius);
    const maximumLandingDistance = Math.max(this.#agent.maxClimb, 0.05) + 0.03;
    const hit = this.#world.castShape(
      toRapierVector(center),
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: -1, z: 0 },
      new RAPIER.Capsule(halfHeight, this.#agent.radius),
      0,
      maximumLandingDistance,
      true,
      undefined,
      undefined,
      this.#collider,
      this.#body,
    );
    return Boolean(hit && hit.time_of_impact <= maximumLandingDistance);
  }

  moveCamera(
    from: Vector3Tuple,
    desired: Vector3Tuple,
    deltaSeconds = 1 / 60,
  ): Vector3Tuple | null {
    // The body is the authority on where the player physically is. A camera
    // that drifted away from it — an external overwrite that skipped
    // placeCamera — is recovered from the body; teleporting the body to the
    // camera instead would skip the sweep entirely, and a capsule embedded in
    // a zero-thickness wall has no volume to push it back out.
    const bodyPosition = this.#body.translation();
    const currentCenter: Vector3Tuple = [bodyPosition.x, bodyPosition.y, bodyPosition.z];
    const cameraCenter = this.#cameraToCenter(from, this.#mode);
    if (distance(cameraCenter, bodyPosition) > Math.max(0.05, this.#agent.radius * 0.25)) {
      this.#verticalVelocity = 0;
      return this.#centerToCamera(currentCenter, this.#mode);
    }
    // Input is the camera's requested displacement; it is applied from the
    // body's own centre because computeColliderMovement sweeps the collider
    // from where the collider actually is.
    const desiredCenter: Vector3Tuple = [
      currentCenter[0] + (desired[0] - from[0]),
      currentCenter[1] + (desired[1] - from[1]),
      currentCenter[2] + (desired[2] - from[2]),
    ];
    if (this.#mode === "walk") {
      this.#verticalVelocity = Math.max(
        -30,
        this.#verticalVelocity - 9.81 * Math.max(0, Math.min(0.05, deltaSeconds)),
      );
      desiredCenter[1] = currentCenter[1] + this.#verticalVelocity *
        Math.max(0, Math.min(0.05, deltaSeconds));
    }
    const translation = {
      x: desiredCenter[0] - currentCenter[0],
      y: desiredCenter[1] - currentCenter[1],
      z: desiredCenter[2] - currentCenter[2],
    };
    this.#controller.computeColliderMovement(this.#collider, translation);
    const corrected = this.#controller.computedMovement();
    this.#recordMovementContacts();
    if (this.#mode === "walk" && this.#controller.computedGrounded()) {
      this.#verticalVelocity = 0;
    }
    const nextCenter = {
      x: currentCenter[0] + corrected.x,
      y: currentCenter[1] + corrected.y,
      z: currentCenter[2] + corrected.z,
    };
    const nextCamera = this.#centerToCamera(
      [nextCenter.x, nextCenter.y, nextCenter.z],
      this.#mode,
    );
    if (!insideBounds(nextCamera, this.#recoveryBounds[this.#mode])) {
      this.#verticalVelocity = 0;
      return null;
    }
    this.#body.setNextKinematicTranslation(nextCenter);
    // Match the physics integration to the same clamped wall-clock delta the
    // gravity term uses; a small floor keeps kinematic velocities finite when
    // two frames land on the same millisecond.
    this.#world.timestep = Math.max(1 / 1_000, Math.min(0.05, deltaSeconds));
    this.#world.step();
    const actual = this.#body.translation();
    return this.#centerToCamera([actual.x, actual.y, actual.z], this.#mode);
  }

  moveControlledCamera(from: Vector3Tuple, desired: Vector3Tuple): Vector3Tuple | null {
    this.#controlledFailure = null;
    if (this.#mode !== "walk") {
      this.#controlledFailure = `controlled_traversal_mode required=walk, asked=${this.#mode}`;
      return null;
    }
    // Same body authority as moveCamera: a controlled traversal must start
    // from where the capsule physically is, never teleport the capsule to a
    // camera that something else moved.
    const bodyPosition = this.#body.translation();
    const currentCenter: Vector3Tuple = [bodyPosition.x, bodyPosition.y, bodyPosition.z];
    const cameraCenter = this.#cameraToCenter(from, "walk");
    if (distance(cameraCenter, bodyPosition) > Math.max(0.05, this.#agent.radius * 0.25)) {
      this.#controlledFailure = `controlled_traversal_desync camera=${
        JSON.stringify(cameraCenter)
      }, body=${JSON.stringify(currentCenter)}`;
      return null;
    }
    const desiredCenter = this.#cameraToCenter(desired, "walk");
    const translation = {
      x: desiredCenter[0] - currentCenter[0],
      y: desiredCenter[1] - currentCenter[1],
      z: desiredCenter[2] - currentCenter[2],
    };
    this.#controlledController.computeColliderMovement(this.#collider, translation);
    const corrected = this.#controlledController.computedMovement();
    if (!controlledMovementReachedTarget(translation, corrected)) {
      this.#controlledFailure = `controlled_traversal_path requested=${JSON.stringify([
        translation.x,
        translation.y,
        translation.z,
      ])}, corrected=${JSON.stringify([corrected.x, corrected.y, corrected.z])}`;
      return null;
    }
    // The sweep proves that the complete requested displacement is clear. Use
    // the authored destination itself so float32 accumulation cannot leave a
    // tiny tail that offline acceptance would correctly reject.
    const nextCenter = {
      x: desiredCenter[0],
      y: desiredCenter[1],
      z: desiredCenter[2],
    };
    const nextCamera = this.#centerToCamera(
      [nextCenter.x, nextCenter.y, nextCenter.z],
      "walk",
    );
    if (!insideBounds(nextCamera, this.#recoveryBounds.walk)) {
      this.#controlledFailure = `controlled_traversal_bounds asked=${JSON.stringify(nextCamera)}`;
      return null;
    }
    this.#body.setNextKinematicTranslation(nextCenter);
    this.#world.step();
    const actual = this.#body.translation();
    this.#verticalVelocity = 0;
    return this.#centerToCamera([actual.x, actual.y, actual.z], "walk");
  }

  destroy(): void {
    this.#world.removeCharacterController(this.#controller);
    this.#world.removeCharacterController(this.#controlledController);
    this.#world.free();
  }

  #cameraToCenter(position: Vector3Tuple, mode: PhysicalMovementMode): Vector3Tuple {
    if (mode === "fly") return [...position];
    const feetY = position[1] - this.#agent.eyeHeight;
    return [position[0], feetY + this.#agent.height / 2, position[2]];
  }

  #centerToCamera(position: Vector3Tuple, mode: PhysicalMovementMode): Vector3Tuple {
    if (mode === "fly") return [...position];
    return [
      position[0],
      position[1] - this.#agent.height / 2 + this.#agent.eyeHeight,
      position[2],
    ];
  }
}

export function controlledMovementReachedTarget(
  requested: MovementVector,
  corrected: MovementVector,
): boolean {
  return Math.abs(corrected.x - requested.x) <= CONTROLLED_MOVEMENT_EPSILON_METRES &&
    Math.abs(corrected.y - requested.y) <= CONTROLLED_MOVEMENT_EPSILON_METRES &&
    Math.abs(corrected.z - requested.z) <= CONTROLLED_MOVEMENT_EPSILON_METRES;
}

function parseRecoveryBounds(artifact: unknown): Record<PhysicalMovementMode, RecoveryBounds> {
  if (!artifact || typeof artifact !== "object") throw new Error("Movement profiles are missing");
  const profiles = Reflect.get(artifact, "movementProfiles");
  if (!profiles || typeof profiles !== "object") throw new Error("Movement profiles are missing");
  return {
    walk: recoveryBoundsFor(Reflect.get(profiles, "walk"), "walk"),
    fly: recoveryBoundsFor(Reflect.get(profiles, "fly"), "fly"),
  };
}

function parseDynamicBarriers(artifact: unknown): DynamicBarrier[] {
  if (!artifact || typeof artifact !== "object") return [];
  const raw = Reflect.get(artifact, "dynamicBarriers");
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  return raw.map((value) => {
    const id = value && typeof value === "object" ? String(Reflect.get(value, "id") ?? "") : "";
    const min = value && typeof value === "object" ? finitePoint(Reflect.get(value, "min")) : null;
    const max = value && typeof value === "object" ? finitePoint(Reflect.get(value, "max")) : null;
    const defaultActive = value && typeof value === "object"
      ? Reflect.get(value, "defaultActive")
      : null;
    if (!id || ids.has(id) || !min || !max ||
      min.some((coordinate, axis) => coordinate >= max[axis]!) ||
      typeof defaultActive !== "boolean") {
      throw new Error("Dynamic barrier profile is invalid");
    }
    ids.add(id);
    return { id, min, max, defaultActive };
  });
}

function recoveryBoundsFor(profile: unknown, mode: PhysicalMovementMode): RecoveryBounds {
  if (profile && typeof profile === "object") {
    const raw = Reflect.get(profile, "recoveryBounds");
    if (Array.isArray(raw) && raw.length === 2) {
      const minimum = finitePoint(raw[0]);
      const maximum = finitePoint(raw[1]);
      if (minimum && maximum && minimum.every((coordinate, axis) => coordinate < maximum[axis]!)) {
        return [minimum, maximum];
      }
    }
  }
  throw new Error(`${mode} movement recovery bounds are missing or invalid`);
}

function insideBounds(position: Vector3Tuple, [minimum, maximum]: RecoveryBounds): boolean {
  return position.every((coordinate, axis) =>
    coordinate >= minimum[axis]! && coordinate <= maximum[axis]!
  );
}

function parseStructuralBarrierSegments(artifact: unknown): StructuralBarrierSegment[] {
  if (!artifact || typeof artifact !== "object") return [];
  const structural = Reflect.get(artifact, "structuralGeometry");
  if (!structural || typeof structural !== "object") return [];
  const segments = Reflect.get(structural, "barrierSegments");
  if (!Array.isArray(segments)) return [];
  const parsed: StructuralBarrierSegment[] = [];
  for (const segment of segments) {
    if (!segment || typeof segment !== "object") continue;
    const id = Reflect.get(segment, "id");
    const start = Reflect.get(segment, "start");
    const end = Reflect.get(segment, "end");
    const minY = Reflect.get(segment, "minY");
    const maxY = Reflect.get(segment, "maxY");
    if (
      typeof id !== "string" || !id ||
      !Array.isArray(start) || start.length !== 2 || !start.every(Number.isFinite) ||
      !Array.isArray(end) || end.length !== 2 || !end.every(Number.isFinite) ||
      !Number.isFinite(minY) || !Number.isFinite(maxY)
    ) continue;
    const thicknessM = Number(Reflect.get(segment, "thicknessM"));
    parsed.push({
      id,
      start: [Number(start[0]), Number(start[1])],
      end: [Number(end[0]), Number(end[1])],
      minY: Number(minY),
      maxY: Number(maxY),
      ...(Number.isFinite(thicknessM) && thicknessM > 0 ? { thicknessM } : {}),
    });
  }
  return parsed;
}

function parseStructuralBlockerBoxes(artifact: unknown): StructuralBlockerBox[] {
  if (!artifact || typeof artifact !== "object") return [];
  const structural = Reflect.get(artifact, "structuralGeometry");
  if (!structural || typeof structural !== "object") return [];
  const parsed: StructuralBlockerBox[] = [];
  for (const [property, kind] of [
    ["solidFurnitureBoxes", "solid_furniture"],
    ["noGoVolumes", "no_go"],
  ] as const) {
    const boxes = Reflect.get(structural, property);
    if (!Array.isArray(boxes)) continue;
    for (const box of boxes) {
      if (!box || typeof box !== "object") continue;
      const id = Reflect.get(box, "id");
      const min = finitePoint(Reflect.get(box, "min"));
      const max = finitePoint(Reflect.get(box, "max"));
      if (typeof id !== "string" || !id || !min || !max) continue;
      parsed.push({ id, kind, min, max });
    }
  }
  return parsed;
}

function pointToSegmentDistance2D(
  x: number,
  z: number,
  start: [number, number],
  end: [number, number],
): number {
  const deltaX = end[0] - start[0];
  const deltaZ = end[1] - start[1];
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((x - start[0]) * deltaX + (z - start[1]) * deltaZ) / lengthSquared))
    : 0;
  return Math.hypot(x - (start[0] + deltaX * t), z - (start[1] + deltaZ * t));
}

function createPlayer(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  agent: PhysicalAgentProfile,
  mode: PhysicalMovementMode,
): { collider: RAPIER.Collider; controller: RAPIER.KinematicCharacterController } {
  const halfHeight = Math.max(0.01, (agent.height - agent.radius * 2) / 2);
  const collider = world.createCollider(
    mode === "fly"
      ? RAPIER.ColliderDesc.ball(agent.radius)
      : RAPIER.ColliderDesc.capsule(halfHeight, agent.radius),
    body,
  );
  const controller = world.createCharacterController(
    Math.max(0.002, Math.min(0.02, agent.radius * 0.05)),
  );
  controller.setSlideEnabled(true);
  if (mode === "walk") {
    controller.enableAutostep(agent.maxClimb, Math.max(agent.radius * 0.5, 0.05), false);
    controller.enableSnapToGround(Math.max(agent.maxClimb, 0.05));
    controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(agent.maxSlopeDegrees));
    controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(
      Math.min(89, agent.maxSlopeDegrees + 5),
    ));
  }
  return { collider, controller };
}

function createControlledPlayerController(
  world: RAPIER.World,
  agent: PhysicalAgentProfile,
): RAPIER.KinematicCharacterController {
  const controller = world.createCharacterController(
    Math.max(0.002, Math.min(0.02, agent.radius * 0.05)),
  );
  controller.setSlideEnabled(false);
  return controller;
}

function supportsMode(artifact: unknown, mode: PhysicalMovementMode): boolean {
  if (mode === "walk") return true;
  if (!artifact || typeof artifact !== "object") return false;
  const profiles = Reflect.get(artifact, "movementProfiles");
  return profiles && typeof profiles === "object" &&
    Array.isArray(Reflect.get(profiles, "supportedModes")) &&
    Reflect.get(profiles, "supportedModes").includes(mode);
}

function parseAgent(artifact: unknown): PhysicalAgentProfile {
  if (!artifact || typeof artifact !== "object") throw new Error("Physical navigation artifact is missing");
  const raw = Reflect.get(artifact, "agent");
  if (!raw || typeof raw !== "object") throw new Error("Physical agent profile is missing");
  const agent = {
    radius: Number(Reflect.get(raw, "radius")),
    height: Number(Reflect.get(raw, "height")),
    eyeHeight: Number(Reflect.get(raw, "eyeHeight")),
    maxClimb: Number(Reflect.get(raw, "maxClimb")),
    maxSlopeDegrees: Number(Reflect.get(raw, "maxSlopeDegrees")),
  };
  if (Object.values(agent).some((value) => !Number.isFinite(value)) ||
    agent.radius <= 0 || agent.height <= agent.radius * 2 ||
    agent.eyeHeight <= 0 || agent.eyeHeight >= agent.height) {
    throw new Error("Physical agent profile is invalid");
  }
  return agent;
}

async function collisionGeometry(buffer: ArrayBuffer, artifact: unknown): Promise<{
  positions: number[];
  indices: number[];
  structuralSemantics: boolean;
}> {
  const document = preflightCollisionGlb(buffer);
  const semantics = collisionSemantics(document, artifact);
  validateDynamicBarrierBinding(document, artifact);
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  gltf.scene.updateMatrixWorld(true);
  const positions: number[] = [];
  const indices: number[] = [];
  const point = new THREE.Vector3();
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.geometry.attributes.position) return;
    const group = typeof object.userData.collisionGroup === "string"
      ? object.userData.collisionGroup
      : null;
    if (semantics) {
      if (!group) throw new Error(`Structural collision mesh ${object.name || "unnamed"} is unclassified`);
      if (semantics.ignoredGroups.includes(group)) return;
      if (!semantics.includedGroups.includes(group)) {
        throw new Error(`Collision group ${group} is neither included nor ignored`);
      }
    }
    const position = object.geometry.attributes.position;
    const offset = positions.length / 3;
    if (offset + position.count > MAX_COLLISION_VERTICES) {
      throw new Error(
        `collision_vertices limit=${MAX_COLLISION_VERTICES}, asked=${offset + position.count}`,
      );
    }
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      positions.push(point.x, point.y, point.z);
    }
    const source = object.geometry.index
      ? Array.from(object.geometry.index.array, Number)
      : Array.from({ length: position.count }, (_, index) => index);
    if (source.length % 3 !== 0) throw new Error("Collision proxy is not a triangle list");
    if (indices.length / 3 + source.length / 3 > MAX_COLLISION_TRIANGLES) {
      throw new Error(
        `collision_triangles limit=${MAX_COLLISION_TRIANGLES}, asked=${indices.length / 3 + source.length / 3}`,
      );
    }
    const mirrored = object.matrixWorld.determinant() < 0;
    for (let index = 0; index < source.length; index += 3) {
      const first = source[index]! + offset;
      const second = source[index + 1]! + offset;
      const third = source[index + 2]! + offset;
      indices.push(first, mirrored ? third : second, mirrored ? second : third);
    }
  });
  if (positions.length < 9 || indices.length < 3) {
    throw new Error("Collision proxy contains no triangle geometry");
  }
  return { positions, indices, structuralSemantics: Boolean(semantics) };
}

function validateDynamicBarrierBinding(
  document: Record<string, unknown>,
  artifact: unknown,
): void {
  if (!artifact || typeof artifact !== "object" ||
    !["spatial-navigation-v7", "spatial-navigation-v8", "spatial-navigation-v9"].includes(
      String(Reflect.get(artifact, "schemaVersion")),
    )) return;
  const asset = Reflect.get(document, "asset");
  const extras = asset && typeof asset === "object" ? Reflect.get(asset, "extras") : null;
  const embeddedRaw = extras && typeof extras === "object"
    ? Reflect.get(extras, "dynamicBarriers")
    : [];
  const embedded = parseDynamicBarriers({ dynamicBarriers: embeddedRaw });
  const frozen = parseDynamicBarriers(artifact);
  if (embedded.length !== frozen.length || embedded.some((barrier, index) => {
    const expected = frozen[index];
    return !expected || barrier.id !== expected.id ||
      barrier.defaultActive !== expected.defaultActive ||
      barrier.min.some((coordinate, axis) => coordinate !== expected.min[axis]) ||
      barrier.max.some((coordinate, axis) => coordinate !== expected.max[axis]);
  })) {
    throw new Error("Dynamic barrier metadata does not match the frozen v7 artifact");
  }
}

function preflightCollisionGlb(buffer: ArrayBuffer): Record<string, unknown> {
  if (buffer.byteLength < 20 || buffer.byteLength > MAX_COLLISION_GLB_BYTES) {
    throw new Error(
      `collision_glb_bytes limit=${MAX_COLLISION_GLB_BYTES}, asked=${buffer.byteLength}`,
    );
  }
  const view = new DataView(buffer);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== buffer.byteLength
  ) throw new Error("Collision proxy must be a complete binary glTF 2.0 container");
  const bytes = new Uint8Array(buffer);
  let offset = 12;
  let document: Record<string, unknown> | null = null;
  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + chunkLength > buffer.byteLength) throw new Error("Collision proxy has a truncated chunk");
    if (chunkType === 0x4e4f534a && !document) {
      document = JSON.parse(new TextDecoder().decode(bytes.subarray(offset, offset + chunkLength)).trim()) as Record<string, unknown>;
    }
    offset += chunkLength;
  }
  if (offset !== buffer.byteLength || !document) throw new Error("Collision proxy chunk table is invalid");
  const hasUri = [document.buffers, document.images]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .some((entry) => entry && typeof entry === "object" && typeof Reflect.get(entry, "uri") === "string");
  if (hasUri) throw new Error("Collision proxy contains an external resource URI");
  return document;
}

function collisionSemantics(
  document: Record<string, unknown>,
  artifact: unknown,
): { includedGroups: string[]; ignoredGroups: string[] } | null {
  const schemaVersion = artifact && typeof artifact === "object"
    ? Reflect.get(artifact, "schemaVersion")
    : null;
  if (!["spatial-navigation-v7", "spatial-navigation-v8", "spatial-navigation-v9"].includes(String(schemaVersion))) {
    return null;
  }
  const artifactSemantics = Reflect.get(artifact as object, "collisionSemantics");
  const asset = Reflect.get(document, "asset");
  const extras = asset && typeof asset === "object" ? Reflect.get(asset, "extras") : null;
  const glbSemantics = extras && typeof extras === "object"
    ? Reflect.get(extras, "spatialCollision")
    : null;
  const frozen = canonicalCollisionSemantics(artifactSemantics);
  const embedded = canonicalCollisionSemantics(glbSemantics);
  if (!frozen || !embedded ||
    frozen.schemaVersion !== embedded.schemaVersion ||
    frozen.provenance !== embedded.provenance ||
    frozen.structuralShellComplete !== embedded.structuralShellComplete ||
    frozen.includedGroups.join("\u0000") !== embedded.includedGroups.join("\u0000") ||
    frozen.ignoredGroups.join("\u0000") !== embedded.ignoredGroups.join("\u0000")) {
    throw new Error("Structural collision semantics do not match the frozen v7 artifact");
  }
  return {
    includedGroups: frozen.includedGroups,
    ignoredGroups: frozen.ignoredGroups,
  };
}

function canonicalCollisionSemantics(value: unknown): {
  schemaVersion: string;
  provenance: string;
  structuralShellComplete: boolean;
  includedGroups: string[];
  ignoredGroups: string[];
} | null {
  if (!value || typeof value !== "object") return null;
  const included = Reflect.get(value, "includedGroups");
  const ignored = Reflect.get(value, "ignoredGroups");
  if (!Array.isArray(included) || !Array.isArray(ignored)) return null;
  return {
    schemaVersion: String(Reflect.get(value, "schemaVersion") ?? ""),
    provenance: String(Reflect.get(value, "provenance") ?? ""),
    structuralShellComplete: Reflect.get(value, "structuralShellComplete") === true,
    includedGroups: [...new Set(included.map(String))].sort(),
    ignoredGroups: [...new Set(ignored.map(String))].sort(),
  };
}

function addObstacleBox(world: RAPIER.World, value: unknown): void {
  if (!value || typeof value !== "object") return;
  const min = finitePoint(Reflect.get(value, "min"));
  const max = finitePoint(Reflect.get(value, "max"));
  if (!min || !max) return;
  const half = [
    Math.abs(max[0] - min[0]) / 2,
    Math.abs(max[1] - min[1]) / 2,
    Math.abs(max[2] - min[2]) / 2,
  ] as Vector3Tuple;
  if (half.some((value) => value <= 0)) return;
  addBoxCollider(world, min, max);
}

function addBoxCollider(
  world: RAPIER.World,
  min: Vector3Tuple,
  max: Vector3Tuple,
): RAPIER.Collider {
  const half = [
    Math.abs(max[0] - min[0]) / 2,
    Math.abs(max[1] - min[1]) / 2,
    Math.abs(max[2] - min[2]) / 2,
  ] as Vector3Tuple;
  return world.createCollider(
    RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2]).setTranslation(
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ),
  );
}

function finitePoint(value: unknown): Vector3Tuple | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const point = value.map(Number);
  return point.every(Number.isFinite) ? point as Vector3Tuple : null;
}

function toRapierVector(value: Vector3Tuple): { x: number; y: number; z: number } {
  return { x: value[0], y: value[1], z: value[2] };
}

function distance(
  first: Vector3Tuple,
  second: { x: number; y: number; z: number },
): number {
  return Math.hypot(first[0] - second.x, first[1] - second.y, first[2] - second.z);
}
