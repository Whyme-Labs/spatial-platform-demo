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

export type PhysicalMovementMode = "walk" | "fly";

let initialization: Promise<void> | undefined;
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
  readonly #dynamicBarrierColliders: Map<string, RAPIER.Collider>;
  #mode: PhysicalMovementMode;
  #verticalVelocity = 0;
  #controlledFailure: string | null = null;

  private constructor(
    world: RAPIER.World,
    body: RAPIER.RigidBody,
    collider: RAPIER.Collider,
    controller: RAPIER.KinematicCharacterController,
    controlledController: RAPIER.KinematicCharacterController,
    agent: PhysicalAgentProfile,
    mode: PhysicalMovementMode,
    recoveryBounds: Record<PhysicalMovementMode, RecoveryBounds>,
    dynamicBarrierColliders: Map<string, RAPIER.Collider>,
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
    const dynamicBarrierColliders = new Map<string, RAPIER.Collider>();
    for (const barrier of parseDynamicBarriers(artifact)) {
      const collider = addBoxCollider(world, barrier.min, barrier.max);
      collider.setEnabled(barrier.defaultActive);
      dynamicBarrierColliders.set(barrier.id, collider);
    }

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const mode = supportsMode(artifact, initialMode) ? initialMode : "walk";
    const { collider, controller } = createPlayer(world, body, agent, mode);
    const controlledController = createControlledPlayerController(world, agent);
    world.step();
    return new PhysicalNavigationRuntime(
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
    const collider = this.#dynamicBarrierColliders.get(id);
    if (!collider) return false;
    collider.setEnabled(active);
    this.#world.step();
    return true;
  }

  setMode(mode: PhysicalMovementMode, cameraPosition: Vector3Tuple): boolean {
    if (mode === this.#mode) return this.placeCamera(cameraPosition);
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

  placeCamera(position: Vector3Tuple): boolean {
    if (!this.canPlaceCamera(position)) return false;
    const center = this.#cameraToCenter(position, this.#mode);
    this.#body.setTranslation(toRapierVector(center), true);
    this.#verticalVelocity = 0;
    return true;
  }

  canPlaceCamera(position: Vector3Tuple): boolean {
    return this.#canPlaceCenter(this.#cameraToCenter(position, this.#mode), this.#mode);
  }

  #canPlaceCenter(center: Vector3Tuple, mode: PhysicalMovementMode): boolean {
    const halfHeight = Math.max(0.01, (this.#agent.height - this.#agent.radius * 2) / 2);
    const clearanceShape = mode === "fly"
      ? new RAPIER.Ball(this.#agent.radius * 0.98)
      : new RAPIER.Capsule(halfHeight, this.#agent.radius * 0.98);
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
    const halfHeight = Math.max(0.01, (this.#agent.height - this.#agent.radius * 2) / 2);
    const maximumLandingDistance = Math.max(this.#agent.maxClimb, 0.05) + 0.03;
    const hit = this.#world.castShape(
      toRapierVector(center),
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: -1, z: 0 },
      new RAPIER.Capsule(halfHeight, this.#agent.radius * 0.98),
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
    const currentCenter = this.#cameraToCenter(from, this.#mode);
    const bodyPosition = this.#body.translation();
    if (distance(currentCenter, bodyPosition) > Math.max(0.05, this.#agent.radius * 0.25)) {
      this.#body.setTranslation(toRapierVector(currentCenter), true);
    }
    const desiredCenter = this.#cameraToCenter(desired, this.#mode);
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
      this.#body.setTranslation(toRapierVector(currentCenter), true);
      this.#verticalVelocity = 0;
      return null;
    }
    this.#body.setNextKinematicTranslation(nextCenter);
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
    const currentCenter = this.#cameraToCenter(from, "walk");
    this.#body.setTranslation(toRapierVector(currentCenter), true);
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
      this.#body.setTranslation(toRapierVector(currentCenter), true);
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
  return corrected.x === Math.fround(requested.x) &&
    corrected.y === Math.fround(requested.y) &&
    corrected.z === Math.fround(requested.z);
}

function parseRecoveryBounds(artifact: unknown): Record<PhysicalMovementMode, RecoveryBounds> {
  if (!artifact || typeof artifact !== "object") throw new Error("Movement profiles are missing");
  const profiles = Reflect.get(artifact, "movementProfiles");
  if (!profiles || typeof profiles !== "object") {
    const fallback = fallbackRecoveryBounds(artifact);
    return { walk: fallback, fly: fallback };
  }
  return {
    walk: recoveryBoundsFor(Reflect.get(profiles, "walk"), artifact),
    fly: recoveryBoundsFor(Reflect.get(profiles, "fly"), artifact),
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

function recoveryBoundsFor(profile: unknown, artifact: unknown): RecoveryBounds {
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
  return fallbackRecoveryBounds(artifact);
}

function fallbackRecoveryBounds(artifact: unknown): RecoveryBounds {
  const raw = artifact && typeof artifact === "object" ? Reflect.get(artifact, "bounds") : null;
  if (!Array.isArray(raw) || raw.length !== 2) throw new Error("Movement recovery bounds are missing");
  const minimum = finitePoint(raw[0]);
  const maximum = finitePoint(raw[1]);
  if (!minimum || !maximum) throw new Error("Movement recovery bounds are invalid");
  const rawAgent = artifact && typeof artifact === "object" ? Reflect.get(artifact, "agent") : null;
  const agentHeight = rawAgent && typeof rawAgent === "object"
    ? Number(Reflect.get(rawAgent, "height"))
    : Number.NaN;
  // v6 froze only floor/navmesh bounds. Its walk camera lives at eye height
  // above that range, so derive a conservative vertical recovery volume while
  // retaining the authored horizontal limits. v7 supplies exact per-mode bounds.
  if (Number.isFinite(agentHeight) && agentHeight > 0) {
    minimum[1] -= agentHeight;
    maximum[1] += agentHeight * 2;
  }
  return [minimum, maximum];
}

function insideBounds(position: Vector3Tuple, [minimum, maximum]: RecoveryBounds): boolean {
  return position.every((coordinate, axis) =>
    coordinate >= minimum[axis]! && coordinate <= maximum[axis]!
  );
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
