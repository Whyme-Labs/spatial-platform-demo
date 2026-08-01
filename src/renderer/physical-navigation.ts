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

let initialization: Promise<void> | undefined;
const MAX_COLLISION_GLB_BYTES = 256 * 1024 * 1024;
const MAX_COLLISION_VERTICES = 3_000_000;
const MAX_COLLISION_TRIANGLES = 5_000_000;

export class PhysicalNavigationRuntime {
  readonly #world: RAPIER.World;
  readonly #body: RAPIER.RigidBody;
  readonly #collider: RAPIER.Collider;
  readonly #controller: RAPIER.KinematicCharacterController;
  readonly #agent: PhysicalAgentProfile;

  private constructor(
    world: RAPIER.World,
    body: RAPIER.RigidBody,
    collider: RAPIER.Collider,
    controller: RAPIER.KinematicCharacterController,
    agent: PhysicalAgentProfile,
  ) {
    this.#world = world;
    this.#body = body;
    this.#collider = collider;
    this.#controller = controller;
    this.#agent = agent;
  }

  static async create(
    collisionUrl: string,
    artifact: unknown,
    obstacleBoxes: unknown[] = [],
  ): Promise<PhysicalNavigationRuntime> {
    const agent = parseAgent(artifact);
    initialization ??= RAPIER.init();
    const [response] = await Promise.all([
      fetch(collisionUrl, { credentials: "same-origin" }),
      initialization,
    ]);
    if (!response.ok) throw new Error(`Collision proxy download failed (${response.status})`);
    const contentLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_COLLISION_GLB_BYTES) {
      throw new Error("Collision proxy exceeds the browser safety limit");
    }
    const collisionBytes = await response.arrayBuffer();
    if (collisionBytes.byteLength > MAX_COLLISION_GLB_BYTES) {
      throw new Error("Collision proxy exceeds the browser safety limit");
    }
    const geometry = await collisionGeometry(collisionBytes);
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.trimesh(
      new Float32Array(geometry.positions),
      new Uint32Array(geometry.indices),
    ));
    for (const rawBox of obstacleBoxes) addObstacleBox(world, rawBox);

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
    controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(agent.maxSlopeDegrees));
    controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(
      Math.min(89, agent.maxSlopeDegrees + 5),
    ));
    world.step();
    return new PhysicalNavigationRuntime(world, body, collider, controller, agent);
  }

  placeCamera(position: Vector3Tuple): boolean {
    if (!this.canPlaceCamera(position)) return false;
    const center = this.#cameraToCenter(position);
    this.#body.setTranslation(toRapierVector(center), true);
    return true;
  }

  canPlaceCamera(position: Vector3Tuple): boolean {
    const center = this.#cameraToCenter(position);
    const halfHeight = Math.max(0.01, (this.#agent.height - this.#agent.radius * 2) / 2);
    const clearanceShape = new RAPIER.Capsule(halfHeight, this.#agent.radius * 0.98);
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

  moveCamera(from: Vector3Tuple, desired: Vector3Tuple): Vector3Tuple | null {
    const currentCenter = this.#cameraToCenter(from);
    const bodyPosition = this.#body.translation();
    if (distance(currentCenter, bodyPosition) > Math.max(0.05, this.#agent.radius * 0.25)) {
      this.#body.setTranslation(toRapierVector(currentCenter), true);
    }
    const desiredCenter = this.#cameraToCenter(desired);
    const translation = {
      x: desiredCenter[0] - currentCenter[0],
      y: desiredCenter[1] - currentCenter[1],
      z: desiredCenter[2] - currentCenter[2],
    };
    this.#controller.computeColliderMovement(this.#collider, translation);
    const corrected = this.#controller.computedMovement();
    const nextCenter = {
      x: currentCenter[0] + corrected.x,
      y: currentCenter[1] + corrected.y,
      z: currentCenter[2] + corrected.z,
    };
    this.#body.setNextKinematicTranslation(nextCenter);
    this.#world.step();
    const actual = this.#body.translation();
    return [
      actual.x,
      actual.y - this.#agent.height / 2 + this.#agent.eyeHeight,
      actual.z,
    ];
  }

  destroy(): void {
    this.#world.removeCharacterController(this.#controller);
    this.#world.free();
  }

  #cameraToCenter(position: Vector3Tuple): Vector3Tuple {
    const feetY = position[1] - this.#agent.eyeHeight;
    return [position[0], feetY + this.#agent.height / 2, position[2]];
  }
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

async function collisionGeometry(buffer: ArrayBuffer): Promise<{
  positions: number[];
  indices: number[];
}> {
  preflightCollisionGlb(buffer);
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  gltf.scene.updateMatrixWorld(true);
  const positions: number[] = [];
  const indices: number[] = [];
  const point = new THREE.Vector3();
  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.geometry.attributes.position) return;
    const position = object.geometry.attributes.position;
    const offset = positions.length / 3;
    if (offset + position.count > MAX_COLLISION_VERTICES) {
      throw new Error("Collision proxy exceeds the browser vertex limit");
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
      throw new Error("Collision proxy exceeds the browser triangle limit");
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
  return { positions, indices };
}

function preflightCollisionGlb(buffer: ArrayBuffer): void {
  if (buffer.byteLength < 20 || buffer.byteLength > MAX_COLLISION_GLB_BYTES) {
    throw new Error("Collision proxy has an invalid byte length");
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
  world.createCollider(
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
