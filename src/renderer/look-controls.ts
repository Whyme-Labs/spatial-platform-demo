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
const TRACKPAD_METRES_PER_PIXEL = 0.0025;
const MAX_TRACKPAD_DELTA_PIXELS = 80;
const MOVEMENT_EPSILON = 1e-6;

/**
 * A single, scene-aware input owner for the Spark renderer. Primary drag looks
 * in screen space; keyboard, joystick, mouse wheel, and two-finger trackpad
 * scrolling move on the authored navigation plane. Secondary clicks are inert
 * so trackpad click jitter cannot move the camera.
 */
export class SpatialNavigationControls {
  private readonly canvas: HTMLCanvasElement;
  private readonly navigationUp = new THREE.Vector3(0, 1, 0);
  private readonly activeKeys = new Set<string>();
  private readonly activeTouches = new Set<number>();
  private lookPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private wheelDeltaX = 0;
  private wheelDeltaY = 0;
  private multiTouchGesture = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
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
    this.wheelDeltaX = 0;
    this.wheelDeltaY = 0;
  }

  update(
    camera: THREE.PerspectiveCamera,
    deltaSeconds: number,
    externalMovement: PlanarMovement = { x: 0, z: 0 },
  ): boolean {
    const lookUpdated = this.applyLook(camera);
    const wheelUpdated = this.applyWheel(camera);
    const movementUpdated = this.applyMovement(
      camera,
      this.combinedMovement(externalMovement),
      deltaSeconds,
    );
    return lookUpdated || wheelUpdated || movementUpdated;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    document.removeEventListener("pointermove", this.handlePointerMove);
    document.removeEventListener("pointerup", this.handlePointerEnd);
    document.removeEventListener("pointercancel", this.handlePointerEnd);
    this.canvas.removeEventListener("lostpointercapture", this.handlePointerEnd);
    this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
    this.canvas.removeEventListener("wheel", this.handleWheel);
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
    this.canvas.addEventListener("contextmenu", this.handleContextMenu);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
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
    try {
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The browser may retire a touch pointer before lostpointercapture runs.
    }
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // Browser trackpad pinch is commonly exposed as Ctrl+wheel. Movement and
    // zoom are explicit product controls, so ignore this ambiguous gesture.
    if (event.ctrlKey) return;
    const unitScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? Math.max(1, this.canvas.clientHeight)
      : 1;
    this.wheelDeltaX += event.deltaX * unitScale;
    this.wheelDeltaY += event.deltaY * unitScale;
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
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; document-level move/up listeners
      // still preserve a complete gesture when a browser declines it.
    }
    this.lookPointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.wheelDeltaX = 0;
    this.wheelDeltaY = 0;
  }

  private suspend(): void {
    this.lookPointerId = null;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.wheelDeltaX = 0;
    this.wheelDeltaY = 0;
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

  private applyWheel(camera: THREE.PerspectiveCamera): boolean {
    const deltaX = this.wheelDeltaX;
    const deltaY = this.wheelDeltaY;
    this.wheelDeltaX = 0;
    this.wheelDeltaY = 0;
    const magnitude = Math.hypot(deltaX, deltaY);
    if (magnitude < MOVEMENT_EPSILON) return false;

    const basis = this.navigationBasis(camera);
    if (!basis) return false;
    const boundedScale = TRACKPAD_METRES_PER_PIXEL *
      Math.min(1, MAX_TRACKPAD_DELTA_PIXELS / magnitude);
    camera.position
      .addScaledVector(basis.right, deltaX * boundedScale)
      .addScaledVector(basis.forward, -deltaY * boundedScale);
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
    const basis = this.navigationBasis(camera);
    if (!basis) return false;
    const speedMultiplier = this.activeKeys.has("ShiftLeft") ||
        this.activeKeys.has("ShiftRight")
      ? FAST_WALK_MULTIPLIER
      : 1;
    const distance = WALK_SPEED_METRES_PER_SECOND *
      speedMultiplier *
      Math.min(0.05, deltaSeconds);
    camera.position
      .addScaledVector(basis.right, movement.x * normalisation * distance)
      .addScaledVector(basis.forward, -movement.z * normalisation * distance);
    return true;
  }

  private navigationBasis(
    camera: THREE.PerspectiveCamera,
  ): { forward: THREE.Vector3; right: THREE.Vector3 } | null {
    const forward = camera.getWorldDirection(new THREE.Vector3())
      .projectOnPlane(this.navigationUp);
    if (forward.lengthSq() < MOVEMENT_EPSILON) return null;
    forward.normalize();
    return {
      forward,
      right: forward.clone().cross(this.navigationUp).normalize(),
    };
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
