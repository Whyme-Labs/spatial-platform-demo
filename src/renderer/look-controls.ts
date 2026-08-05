import * as THREE from "three";

type MovementInput = {
  x: number;
  y?: number;
  z: number;
};

export type SpatialMovementMode = "walk" | "fly";

type NavigationBounds = {
  min: THREE.Vector3;
  max: THREE.Vector3;
};

const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);
const MAX_PITCH_RADIANS = THREE.MathUtils.degToRad(85);
const LOOK_RADIANS_PER_PIXEL = 0.002;
const DEFAULT_MOVEMENT_SPEED_UNITS_PER_SECOND = 1.4;
const DEFAULT_BOOST_MULTIPLIER = 3;
const TRACKPAD_METRES_PER_PIXEL = 0.0025;
const MAX_TRACKPAD_DELTA_PIXELS = 80;
const MOVEMENT_EPSILON = 1e-6;
const CLICK_MAX_TRAVEL_PIXELS = 4;

/**
 * A single, scene-aware input owner for the Spark renderer. Primary drag looks
 * in screen space, and a stationary primary click requests pointer lock so a
 * desktop mouse can look without holding a button (Esc releases the lock and
 * drag-look remains the fallback). Keyboard, joystick, mouse wheel, and
 * two-finger trackpad scrolling move on the authored navigation plane.
 * Secondary clicks are inert so trackpad click jitter cannot move the camera.
 */
export class SpatialNavigationControls {
  private readonly canvas: HTMLCanvasElement;
  private readonly navigationUp = new THREE.Vector3(0, 1, 0);
  private readonly activeKeys = new Set<string>();
  private readonly pendingKeys = new Set<string>();
  private readonly activeTouches = new Set<number>();
  private navigationBounds: NavigationBounds[] = [];
  private movementMode: SpatialMovementMode = "walk";
  private movementSpeeds: Record<SpatialMovementMode, number> = {
    walk: DEFAULT_MOVEMENT_SPEED_UNITS_PER_SECOND,
    fly: DEFAULT_MOVEMENT_SPEED_UNITS_PER_SECOND,
  };
  private boostMultipliers: Record<SpatialMovementMode, number> = {
    walk: DEFAULT_BOOST_MULTIPLIER,
    fly: DEFAULT_BOOST_MULTIPLIER,
  };
  private translationEnabled = true;
  private lookEnabled = true;
  private lookPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lookStartX = 0;
  private lookStartY = 0;
  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private wheelDeltaX = 0;
  private wheelDeltaY = 0;
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

  setNavigationBounds(bounds: NavigationBounds[]): void {
    this.navigationBounds = bounds.flatMap(({ min, max }) => {
      const coordinates = [...min.toArray(), ...max.toArray()];
      if (coordinates.some((coordinate) => !Number.isFinite(coordinate))) return [];
      return [{
        min: new THREE.Vector3(
          Math.min(min.x, max.x),
          Math.min(min.y, max.y),
          Math.min(min.z, max.z),
        ),
        max: new THREE.Vector3(
          Math.max(min.x, max.x),
          Math.max(min.y, max.y),
          Math.max(min.z, max.z),
        ),
      }];
    });
  }

  setMovementMode(mode: SpatialMovementMode): void {
    this.movementMode = mode;
    this.clearKeyboardState();
    this.wheelDeltaX = 0;
    this.wheelDeltaY = 0;
  }

  configureMovementProfiles(artifact: unknown): void {
    if (!artifact || typeof artifact !== "object") return;
    const profiles = Reflect.get(artifact, "movementProfiles");
    if (!profiles || typeof profiles !== "object") return;
    for (const mode of ["walk", "fly"] as const) {
      const profile = Reflect.get(profiles, mode);
      if (!profile || typeof profile !== "object") continue;
      const speed = Number(Reflect.get(profile, "speedUnitsPerSecond"));
      const boost = Number(Reflect.get(profile, "boostMultiplier"));
      if (Number.isFinite(speed) && speed > 0) this.movementSpeeds[mode] = speed;
      if (Number.isFinite(boost) && boost >= 1) this.boostMultipliers[mode] = boost;
    }
  }

  setTranslationEnabled(enabled: boolean): void {
    this.translationEnabled = enabled;
    if (enabled) return;
    this.wheelDeltaX = 0;
    this.wheelDeltaY = 0;
    this.clearKeyboardState();
  }

  setLookEnabled(enabled: boolean): void {
    this.lookEnabled = enabled;
    if (!enabled) this.suspend();
  }

  setKeyboardKeyState(code: string, pressed: boolean): void {
    if (!MOVEMENT_KEYS.has(code)) return;
    if (pressed) {
      this.activeKeys.add(code);
      this.pendingKeys.add(code);
      return;
    }
    this.activeKeys.delete(code);
  }

  clearKeyboardState(): void {
    this.activeKeys.clear();
    this.pendingKeys.clear();
  }

  update(
    camera: THREE.PerspectiveCamera,
    deltaSeconds: number,
    externalMovement: MovementInput = { x: 0, y: 0, z: 0 },
  ): boolean {
    const positionBeforeMovement = this.navigationBounds.length
      ? camera.position.clone()
      : null;
    const lookUpdated = this.applyLook(camera);
    if (!this.translationEnabled) {
      this.wheelDeltaX = 0;
      this.wheelDeltaY = 0;
      this.clearKeyboardState();
      return lookUpdated;
    }
    const wheelUpdated = this.applyWheel(camera);
    const movementUpdated = this.applyMovement(
      camera,
      this.combinedMovement(externalMovement),
      deltaSeconds,
    );
    this.pendingKeys.clear();
    const translated = wheelUpdated || movementUpdated;
    if (
      translated &&
      positionBeforeMovement &&
      !this.isInsideNavigationBounds(camera.position)
    ) {
      camera.position.copy(positionBeforeMovement);
      return lookUpdated;
    }
    return lookUpdated || translated;
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
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
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
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!this.lookEnabled) return;
    if (event.pointerType === "mouse") {
      if (event.button !== 0 || this.isPointerLocked()) return;
      this.beginLook(event);
      return;
    }

    this.activeTouches.add(event.pointerId);
    // Additional touches are inert: they neither move the camera nor cancel an
    // in-progress one-finger look.
    if (this.activeTouches.size === 1) this.beginLook(event);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.isPointerLocked()) {
      if (!this.lookEnabled) return;
      this.lookDeltaX += event.movementX;
      this.lookDeltaY += event.movementY;
      return;
    }
    if (event.pointerId !== this.lookPointerId) return;
    this.lookDeltaX += event.clientX - this.lastPointerX;
    this.lookDeltaY += event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") {
      this.activeTouches.delete(event.pointerId);
    } else if (
      event.type === "pointerup" &&
      event.button === 0 &&
      event.pointerId === this.lookPointerId &&
      this.lookEnabled &&
      !this.isPointerLocked() &&
      Math.hypot(
        event.clientX - this.lookStartX,
        event.clientY - this.lookStartY,
      ) < CLICK_MAX_TRAVEL_PIXELS
    ) {
      // A stationary primary click upgrades to pointer-lock mouse look; a drag
      // stays on the existing capture-based look path.
      this.requestPointerLock();
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
    this.setKeyboardKeyState(event.code, true);
    event.preventDefault();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (!MOVEMENT_KEYS.has(event.code)) return;
    this.setKeyboardKeyState(event.code, false);
    event.preventDefault();
  };

  private readonly handleSuspend = (): void => {
    this.suspend();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) this.suspend();
  };

  private readonly handlePointerLockChange = (): void => {
    if (this.isPointerLocked()) return;
    // Browser-native unlock (Esc) discards pending locked-look deltas and
    // returns input to the drag-look path.
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
  };

  private isPointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  private requestPointerLock(): void {
    const canvas = this.canvas as HTMLCanvasElement & {
      requestPointerLock?: () => Promise<void> | void;
    };
    if (typeof canvas.requestPointerLock !== "function") return;
    try {
      const request = canvas.requestPointerLock();
      if (request instanceof Promise) {
        request.catch(() => {
          // A denied pointer lock keeps the drag-look fallback working.
        });
      }
    } catch {
      // Pointer lock is an enhancement; drag-look remains the fallback.
    }
  }

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
    this.lookStartX = event.clientX;
    this.lookStartY = event.clientY;
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
    this.clearKeyboardState();
    if (this.isPointerLocked() && typeof document.exitPointerLock === "function") {
      document.exitPointerLock();
    }
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

    const basis = this.movementBasis(camera);
    if (!basis) return false;
    const boundedScale = TRACKPAD_METRES_PER_PIXEL *
      Math.min(1, MAX_TRACKPAD_DELTA_PIXELS / magnitude);
    camera.position
      .addScaledVector(basis.right, deltaX * boundedScale)
      .addScaledVector(basis.forward, -deltaY * boundedScale);
    return true;
  }

  private combinedMovement(externalMovement: MovementInput): Required<MovementInput> {
    const keyboardX = Number(
      this.hasKeyboardKey("KeyD") || this.hasKeyboardKey("ArrowRight"),
    ) - Number(
      this.hasKeyboardKey("KeyA") || this.hasKeyboardKey("ArrowLeft"),
    );
    const keyboardZ = Number(
      this.hasKeyboardKey("KeyS") || this.hasKeyboardKey("ArrowDown"),
    ) - Number(
      this.hasKeyboardKey("KeyW") || this.hasKeyboardKey("ArrowUp"),
    );
    const keyboardY = this.movementMode === "fly"
      ? Number(this.hasKeyboardKey("Space") || this.hasKeyboardKey("KeyE")) -
        Number(this.hasKeyboardKey("KeyC") || this.hasKeyboardKey("KeyQ"))
      : 0;
    return {
      x: clampInput(externalMovement.x) + keyboardX,
      y: clampInput(externalMovement.y ?? 0) + keyboardY,
      z: clampInput(externalMovement.z) + keyboardZ,
    };
  }

  private applyMovement(
    camera: THREE.PerspectiveCamera,
    movement: Required<MovementInput>,
    deltaSeconds: number,
  ): boolean {
    const inputMagnitude = Math.hypot(movement.x, movement.y, movement.z);
    if (inputMagnitude < MOVEMENT_EPSILON || deltaSeconds <= 0) return false;

    const normalisation = inputMagnitude > 1 ? 1 / inputMagnitude : 1;
    const basis = this.movementBasis(camera);
    if (!basis) return false;
    const speedMultiplier = this.hasKeyboardKey("ShiftLeft") ||
        this.hasKeyboardKey("ShiftRight")
      ? this.boostMultipliers[this.movementMode]
      : 1;
    const distance = this.movementSpeeds[this.movementMode] *
      speedMultiplier *
      Math.min(0.05, deltaSeconds);
    camera.position
      .addScaledVector(basis.right, movement.x * normalisation * distance)
      .addScaledVector(basis.forward, -movement.z * normalisation * distance)
      .addScaledVector(this.navigationUp, movement.y * normalisation * distance);
    return true;
  }

  private hasKeyboardKey(code: string): boolean {
    return this.activeKeys.has(code) || this.pendingKeys.has(code);
  }

  private movementBasis(
    camera: THREE.PerspectiveCamera,
  ): { forward: THREE.Vector3; right: THREE.Vector3 } | null {
    const forward = camera.getWorldDirection(new THREE.Vector3());
    if (this.movementMode === "walk") forward.projectOnPlane(this.navigationUp);
    if (forward.lengthSq() < MOVEMENT_EPSILON) return null;
    forward.normalize();
    const screenRight = LOCAL_RIGHT.clone().applyQuaternion(camera.quaternion);
    const right = this.movementMode === "fly"
      ? screenRight.normalize()
      : forward.clone().cross(this.navigationUp).normalize();
    return {
      forward,
      right,
    };
  }

  private isInsideNavigationBounds(position: THREE.Vector3): boolean {
    if (!this.navigationBounds.length) return true;
    return this.navigationBounds.some(({ min, max }) =>
      position.x >= min.x &&
      position.x <= max.x &&
      position.z >= min.z &&
      position.z <= max.z &&
      (this.movementMode === "walk" || (
        position.y >= min.y && position.y <= max.y
      ))
    );
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
  "Space",
  "KeyE",
  "KeyC",
  "KeyQ",
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
    target instanceof HTMLSelectElement ||
    target.closest("button, a[href], [role='button'], [role='link']") !== null;
}

export function createSpatialLookControls(
  canvas: HTMLCanvasElement,
): SpatialNavigationControls {
  return new SpatialNavigationControls(canvas);
}
