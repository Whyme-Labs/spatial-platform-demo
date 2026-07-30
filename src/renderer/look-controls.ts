import { SparkControls } from "@sparkjsdev/spark";
import * as THREE from "three";

type PlanarMovement = {
  x: number;
  z: number;
};

const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);
const MAX_PITCH_RADIANS = THREE.MathUtils.degToRad(85);
const LOOK_RADIANS_PER_PIXEL = 0.002;
const WALK_SPEED_METRES_PER_SECOND = 1.4;
const FAST_WALK_MULTIPLIER = 3;
const MOVEMENT_EPSILON = 1e-6;

/**
 * Spark's stock primary-drag path converts camera poses through world-Y Euler
 * angles. Imported splat cameras frequently use a different authored up axis,
 * which makes drag axes swap and introduces roll after turning. This wrapper
 * keeps Spark's scroll, pinch, and secondary-drag gestures, while owning the
 * primary look gesture and floor-parallel keyboard movement.
 */
export class SpatialNavigationControls {
  private readonly spark: SparkControls;
  private readonly canvas: HTMLCanvasElement;
  private readonly navigationUp = new THREE.Vector3(0, 1, 0);
  private readonly activeKeys = new Set<string>();
  private readonly activeTouches = new Set<number>();
  private lookPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private multiTouchGesture = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.spark = new SparkControls({ canvas });
    this.spark.fpsMovement.enable = false;
    this.spark.pointerControls.rotateSpeed = 0;
    this.spark.pointerControls.scrollSpeed = 0.8;
    this.spark.pointerControls.moveInertia = 0.82;
    this.spark.pointerControls.rotateInertia = 0.78;
    this.bind();
  }

  /**
   * Re-establish the authored horizon after loading, resetting, or accepting a
   * camera pose. This is the plane used for yaw and movement until the next
   * authored pose is applied.
   */
  align(camera: THREE.PerspectiveCamera): void {
    this.navigationUp.copy(camera.up).normalize();
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.spark.pointerControls.rotateVelocity.set(0, 0, 0);
  }

  update(
    camera: THREE.PerspectiveCamera,
    deltaSeconds: number,
    externalMovement: PlanarMovement = { x: 0, z: 0 },
  ): boolean {
    const sparkUpdated = this.spark.update(camera, camera);
    const lookUpdated = this.applyLook(camera);
    const movementUpdated = this.applyMovement(
      camera,
      this.combinedMovement(externalMovement),
      deltaSeconds,
    );
    return sparkUpdated || lookUpdated || movementUpdated;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    document.removeEventListener("pointermove", this.handlePointerMove);
    document.removeEventListener("pointerup", this.handlePointerEnd);
    document.removeEventListener("pointercancel", this.handlePointerEnd);
    this.canvas.removeEventListener("lostpointercapture", this.handlePointerEnd);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleSuspend);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.suspend();
  }

  private bind(): void {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    document.addEventListener("pointermove", this.handlePointerMove);
    document.addEventListener("pointerup", this.handlePointerEnd);
    document.addEventListener("pointercancel", this.handlePointerEnd);
    this.canvas.addEventListener("lostpointercapture", this.handlePointerEnd);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleSuspend);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") {
      if (event.button !== 0) return;
      this.beginLook(event);
      return;
    }

    this.activeTouches.add(event.pointerId);
    if (this.activeTouches.size === 1 && !this.multiTouchGesture) {
      this.beginLook(event);
      return;
    }

    // Spark continues to own two-finger slide and pinch. Do not resume custom
    // look until every finger from that gesture has left the surface.
    this.multiTouchGesture = true;
    this.lookPointerId = null;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.lookPointerId || this.multiTouchGesture) return;
    this.lookDeltaX += event.clientX - this.lastPointerX;
    this.lookDeltaY += event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") {
      this.activeTouches.delete(event.pointerId);
      if (this.activeTouches.size === 0) this.multiTouchGesture = false;
    }
    if (event.pointerId === this.lookPointerId) this.lookPointerId = null;
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!MOVEMENT_KEYS.has(event.code) || isEditableTarget(event.target)) return;
    this.activeKeys.add(event.code);
    event.preventDefault();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (!MOVEMENT_KEYS.has(event.code)) return;
    this.activeKeys.delete(event.code);
    event.preventDefault();
  };

  private readonly handleSuspend = (): void => {
    this.suspend();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) this.suspend();
  };

  private beginLook(event: PointerEvent): void {
    this.canvas.focus({ preventScroll: true });
    this.lookPointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
  }

  private suspend(): void {
    this.lookPointerId = null;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.activeTouches.clear();
    this.activeKeys.clear();
    this.multiTouchGesture = false;
  }

  private applyLook(camera: THREE.PerspectiveCamera): boolean {
    const deltaX = this.lookDeltaX;
    const deltaY = this.lookDeltaY;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    if (Math.abs(deltaX) < MOVEMENT_EPSILON && Math.abs(deltaY) < MOVEMENT_EPSILON) {
      return false;
    }

    const yaw = -deltaX * LOOK_RADIANS_PER_PIXEL;
    if (Math.abs(yaw) >= MOVEMENT_EPSILON) {
      camera.quaternion.premultiply(
        new THREE.Quaternion().setFromAxisAngle(this.navigationUp, yaw),
      );
    }

    const direction = camera.getWorldDirection(new THREE.Vector3());
    const currentPitch = Math.asin(THREE.MathUtils.clamp(
      direction.dot(this.navigationUp),
      -1,
      1,
    ));
    const requestedPitch = -deltaY * LOOK_RADIANS_PER_PIXEL;
    const targetPitch = THREE.MathUtils.clamp(
      currentPitch + requestedPitch,
      -MAX_PITCH_RADIANS,
      MAX_PITCH_RADIANS,
    );
    const pitch = targetPitch - currentPitch;
    if (Math.abs(pitch) >= MOVEMENT_EPSILON) {
      const screenRight = LOCAL_RIGHT.clone()
        .applyQuaternion(camera.quaternion)
        .normalize();
      camera.quaternion.premultiply(
        new THREE.Quaternion().setFromAxisAngle(screenRight, pitch),
      );
    }

    camera.quaternion.normalize();
    return true;
  }

  private combinedMovement(externalMovement: PlanarMovement): PlanarMovement {
    const keyboardX = Number(
      this.activeKeys.has("KeyD") || this.activeKeys.has("ArrowRight"),
    ) - Number(
      this.activeKeys.has("KeyA") || this.activeKeys.has("ArrowLeft"),
    );
    const keyboardZ = Number(
      this.activeKeys.has("KeyS") || this.activeKeys.has("ArrowDown"),
    ) - Number(
      this.activeKeys.has("KeyW") || this.activeKeys.has("ArrowUp"),
    );
    return {
      x: clampInput(externalMovement.x) + keyboardX,
      z: clampInput(externalMovement.z) + keyboardZ,
    };
  }

  private applyMovement(
    camera: THREE.PerspectiveCamera,
    movement: PlanarMovement,
    deltaSeconds: number,
  ): boolean {
    const inputMagnitude = Math.hypot(movement.x, movement.z);
    if (inputMagnitude < MOVEMENT_EPSILON || deltaSeconds <= 0) return false;

    const normalisation = inputMagnitude > 1 ? 1 / inputMagnitude : 1;
    const forward = camera.getWorldDirection(new THREE.Vector3())
      .projectOnPlane(this.navigationUp);
    if (forward.lengthSq() < MOVEMENT_EPSILON) return false;
    forward.normalize();
    const right = forward.clone().cross(this.navigationUp).normalize();
    const speedMultiplier = this.activeKeys.has("ShiftLeft") ||
        this.activeKeys.has("ShiftRight")
      ? FAST_WALK_MULTIPLIER
      : 1;
    const distance = WALK_SPEED_METRES_PER_SECOND *
      speedMultiplier *
      Math.min(0.05, deltaSeconds);
    camera.position
      .addScaledVector(right, movement.x * normalisation * distance)
      .addScaledVector(forward, -movement.z * normalisation * distance);
    return true;
  }
}

const MOVEMENT_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
]);

function clampInput(value: number): number {
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, -1, 1) : 0;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
}

export function createSpatialLookControls(
  canvas: HTMLCanvasElement,
): SpatialNavigationControls {
  return new SpatialNavigationControls(canvas);
}
