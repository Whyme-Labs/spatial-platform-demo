export type PlanarMovement = {
  x: number;
  z: number;
};

export type WalkableBounds = {
  min: [number, number, number];
  max: [number, number, number];
};

export type MobileControlState = {
  touchCapable: boolean;
  ready: boolean;
  active: boolean;
  pointerId: number | null;
  movement: PlanarMovement;
  knob: {
    x: number;
    y: number;
  };
  magnitude: number;
};

export type MobileControlSurfaceElements = {
  viewport: HTMLElement;
  toggle: HTMLButtonElement;
  pad: HTMLElement;
  knob: HTMLElement;
  status: HTMLElement;
  lookHint: HTMLElement;
  onboarding: HTMLElement;
  onboardingStart: HTMLButtonElement;
  onboardingDismiss: HTMLButtonElement;
};

const NEUTRAL_INPUT = {
  movement: { x: 0, z: 0 },
  knob: { x: 0, y: 0 },
  magnitude: 0,
} as const;

export class MobileControlModel {
  private readonly deadZone: number;
  private current: MobileControlState = {
    touchCapable: false,
    ready: false,
    active: false,
    pointerId: null,
    ...neutralInput(),
  };

  constructor({ deadZone = 0.14 }: { deadZone?: number } = {}) {
    this.deadZone = clamp(deadZone, 0, 0.5);
  }

  get state(): MobileControlState {
    return {
      ...this.current,
      movement: { ...this.current.movement },
      knob: { ...this.current.knob },
    };
  }

  setTouchCapable(touchCapable: boolean): void {
    this.current.touchCapable = touchCapable;
    if (!touchCapable) this.deactivate();
  }

  setReady(ready: boolean): void {
    this.current.ready = ready;
    if (!ready) this.deactivate();
  }

  toggle(): boolean {
    if (!this.current.touchCapable || !this.current.ready) return false;
    if (this.current.active) {
      this.deactivate();
      return false;
    }
    this.current.active = true;
    return true;
  }

  beginPointer(
    pointerId: number,
    deltaX: number,
    deltaY: number,
    radius: number,
  ): boolean {
    if (
      !this.current.active ||
      !this.current.ready ||
      !this.current.touchCapable ||
      this.current.pointerId !== null
    ) {
      return false;
    }
    this.current.pointerId = pointerId;
    this.updateInput(deltaX, deltaY, radius);
    return true;
  }

  movePointer(
    pointerId: number,
    deltaX: number,
    deltaY: number,
    radius: number,
  ): boolean {
    if (this.current.pointerId !== pointerId) return false;
    this.updateInput(deltaX, deltaY, radius);
    return true;
  }

  releasePointer(pointerId: number): boolean {
    if (this.current.pointerId !== pointerId) return false;
    this.resetInput();
    return true;
  }

  suspend(): void {
    this.resetInput();
  }

  private deactivate(): void {
    this.current.active = false;
    this.resetInput();
  }

  private resetInput(): void {
    this.current.pointerId = null;
    Object.assign(this.current, neutralInput());
  }

  private updateInput(deltaX: number, deltaY: number, radius: number): void {
    const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;
    const rawX = Number.isFinite(deltaX) ? deltaX : 0;
    const rawY = Number.isFinite(deltaY) ? deltaY : 0;
    const rawMagnitude = Math.hypot(rawX, rawY);
    const boundedMagnitude = Math.min(rawMagnitude, safeRadius);
    const directionX = rawMagnitude > 0 ? rawX / rawMagnitude : 0;
    const directionY = rawMagnitude > 0 ? rawY / rawMagnitude : 0;
    const normalisedMagnitude = boundedMagnitude / safeRadius;
    const movementMagnitude = normalisedMagnitude <= this.deadZone
      ? 0
      : (normalisedMagnitude - this.deadZone) / (1 - this.deadZone);

    this.current.knob = {
      x: directionX * boundedMagnitude,
      y: directionY * boundedMagnitude,
    };
    this.current.movement = {
      x: movementMagnitude === 0 ? 0 : directionX * movementMagnitude,
      z: movementMagnitude === 0 ? 0 : directionY * movementMagnitude,
    };
    this.current.magnitude = movementMagnitude;
  }
}

export class MobileControlSurface {
  private readonly model = new MobileControlModel();
  private readonly elements: MobileControlSurfaceElements;
  private readonly coarsePointer: MediaQueryList;
  private readonly storage: Pick<Storage, "getItem" | "setItem"> | null;
  private readonly onModeChange: (active: boolean) => void;
  private lastReportedActive = false;
  private disposed = false;

  constructor({
    elements,
    coarsePointer,
    storage = safeLocalStorage(),
    onModeChange = () => {},
  }: {
    elements: MobileControlSurfaceElements;
    coarsePointer: MediaQueryList;
    storage?: Pick<Storage, "getItem" | "setItem"> | null;
    onModeChange?: (active: boolean) => void;
  }) {
    this.elements = elements;
    this.coarsePointer = coarsePointer;
    this.storage = storage;
    this.onModeChange = onModeChange;
    this.model.setTouchCapable(coarsePointer.matches);
    this.bind();
    this.render();
  }

  get movement(): PlanarMovement {
    return this.model.state.movement;
  }

  get active(): boolean {
    return this.model.state.active;
  }

  setReady(ready: boolean): void {
    this.model.setReady(ready);
    if (!ready) this.elements.onboarding.hidden = true;
    this.render();
    if (ready) this.offerOnboarding();
  }

  suspend(): void {
    this.model.suspend();
    this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.model.setReady(false);
    this.render();
    this.elements.toggle.removeEventListener("click", this.handleToggle);
    this.elements.pad.removeEventListener("pointerdown", this.handlePointerDown);
    this.elements.pad.removeEventListener("pointermove", this.handlePointerMove);
    this.elements.pad.removeEventListener("pointerup", this.handlePointerEnd);
    this.elements.pad.removeEventListener("pointercancel", this.handlePointerEnd);
    this.elements.pad.removeEventListener("lostpointercapture", this.handlePointerEnd);
    this.elements.onboardingStart.removeEventListener("click", this.handleOnboardingStart);
    this.elements.onboardingDismiss.removeEventListener("click", this.handleOnboardingDismiss);
    window.removeEventListener("blur", this.handleSuspend);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.coarsePointer.removeEventListener("change", this.handleCapabilityChange);
  }

  private bind(): void {
    this.elements.toggle.addEventListener("click", this.handleToggle);
    this.elements.pad.addEventListener("pointerdown", this.handlePointerDown);
    this.elements.pad.addEventListener("pointermove", this.handlePointerMove);
    this.elements.pad.addEventListener("pointerup", this.handlePointerEnd);
    this.elements.pad.addEventListener("pointercancel", this.handlePointerEnd);
    this.elements.pad.addEventListener("lostpointercapture", this.handlePointerEnd);
    this.elements.onboardingStart.addEventListener("click", this.handleOnboardingStart);
    this.elements.onboardingDismiss.addEventListener("click", this.handleOnboardingDismiss);
    window.addEventListener("blur", this.handleSuspend);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.coarsePointer.addEventListener("change", this.handleCapabilityChange);
  }

  private readonly handleToggle = (): void => {
    this.model.toggle();
    this.dismissOnboarding();
    this.render();
    if (this.model.state.active) {
      vibrate(8);
    }
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") return;
    const input = this.pointerInput(event);
    if (!this.model.beginPointer(event.pointerId, input.x, input.y, input.radius)) return;
    event.preventDefault();
    try {
      this.elements.pad.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic accessibility tooling may not register a native active pointer.
    }
    this.render();
    vibrate(6);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const input = this.pointerInput(event);
    if (!this.model.movePointer(event.pointerId, input.x, input.y, input.radius)) return;
    event.preventDefault();
    this.render();
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    if (!this.model.releasePointer(event.pointerId)) return;
    event.preventDefault();
    if (this.elements.pad.hasPointerCapture(event.pointerId)) {
      this.elements.pad.releasePointerCapture(event.pointerId);
    }
    this.render();
  };

  private readonly handleOnboardingStart = (): void => {
    if (!this.model.state.active) this.model.toggle();
    this.dismissOnboarding();
    this.render();
    this.elements.toggle.focus({ preventScroll: true });
    vibrate(8);
  };

  private readonly handleOnboardingDismiss = (): void => {
    this.dismissOnboarding();
    this.render();
    this.elements.toggle.focus({ preventScroll: true });
  };

  private readonly handleSuspend = (): void => {
    this.suspend();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") this.suspend();
  };

  private readonly handleCapabilityChange = (event: MediaQueryListEvent): void => {
    this.model.setTouchCapable(event.matches);
    if (!event.matches) this.elements.onboarding.hidden = true;
    this.render();
    if (event.matches && this.model.state.ready) this.offerOnboarding();
  };

  private pointerInput(event: PointerEvent): {
    x: number;
    y: number;
    radius: number;
  } {
    const bounds = this.elements.pad.getBoundingClientRect();
    return {
      x: event.clientX - (bounds.left + bounds.width / 2),
      y: event.clientY - (bounds.top + bounds.height / 2),
      radius: Math.max(1, Math.min(bounds.width, bounds.height) * 0.34),
    };
  }

  private render(): void {
    const state = this.model.state;
    this.elements.toggle.hidden = !state.touchCapable;
    this.elements.toggle.disabled = !state.ready;
    this.elements.toggle.setAttribute("aria-pressed", String(state.active));
    this.elements.toggle.textContent = state.active ? "Exit roam" : "Free roam";
    this.elements.pad.hidden = !state.touchCapable || !state.active;
    this.elements.pad.setAttribute("aria-disabled", String(!state.ready));
    this.elements.status.textContent = movementDescription(state.movement);
    this.elements.pad.toggleAttribute("data-active", state.pointerId !== null);
    this.elements.knob.style.transform = `translate3d(${round(state.knob.x)}px, ${round(state.knob.y)}px, 0)`;
    this.elements.lookHint.hidden = !state.touchCapable || !state.active;
    this.elements.viewport.classList.toggle("free-roam-active", state.active);
    if (state.active !== this.lastReportedActive) {
      this.lastReportedActive = state.active;
      this.onModeChange(state.active);
    }
  }

  private offerOnboarding(): void {
    const state = this.model.state;
    if (!state.touchCapable || !state.ready || state.active || this.hasSeenOnboarding()) return;
    this.elements.onboarding.hidden = false;
  }

  private dismissOnboarding(): void {
    this.elements.onboarding.hidden = true;
    try {
      this.storage?.setItem(ONBOARDING_STORAGE_KEY, ONBOARDING_VERSION);
    } catch {
      // Storage can be blocked in embedded or privacy-restricted contexts.
    }
  }

  private hasSeenOnboarding(): boolean {
    try {
      return this.storage?.getItem(ONBOARDING_STORAGE_KEY) === ONBOARDING_VERSION;
    } catch {
      return false;
    }
  }
}

export function planarCameraStep({
  position,
  forward,
  movement,
  speed,
  deltaSeconds,
}: {
  position: [number, number, number];
  forward: [number, number, number];
  movement: PlanarMovement;
  speed: number;
  deltaSeconds: number;
}): [number, number, number] {
  let forwardX = finite(forward[0]);
  let forwardZ = finite(forward[2]);
  const horizontalLength = Math.hypot(forwardX, forwardZ);
  if (horizontalLength < 1e-8) {
    forwardX = 0;
    forwardZ = -1;
  } else {
    forwardX /= horizontalLength;
    forwardZ /= horizontalLength;
  }

  const rightX = -forwardZ;
  const rightZ = forwardX;
  const distance = Math.max(0, finite(speed)) * Math.max(0, finite(deltaSeconds));
  const strafe = clamp(finite(movement.x), -1, 1);
  const travel = -clamp(finite(movement.z), -1, 1);

  return [
    position[0] + (rightX * strafe + forwardX * travel) * distance,
    position[1],
    position[2] + (rightZ * strafe + forwardZ * travel) * distance,
  ];
}

export function nearestWalkablePoint(
  position: [number, number, number],
  bounds: WalkableBounds[],
): [number, number, number] | null {
  let nearest: [number, number, number] | null = null;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;

  for (const region of bounds) {
    const candidate: [number, number, number] = [
      clamp(position[0], Math.min(region.min[0], region.max[0]), Math.max(region.min[0], region.max[0])),
      clamp(position[1], Math.min(region.min[1], region.max[1]), Math.max(region.min[1], region.max[1])),
      clamp(position[2], Math.min(region.min[2], region.max[2]), Math.max(region.min[2], region.max[2])),
    ];
    const distanceSquared =
      (candidate[0] - position[0]) ** 2 +
      (candidate[1] - position[1]) ** 2 +
      (candidate[2] - position[2]) ** 2;
    if (distanceSquared < nearestDistanceSquared) {
      nearest = candidate;
      nearestDistanceSquared = distanceSquared;
    }
  }

  return nearest;
}

export function movementDescription(movement: PlanarMovement): string {
  const magnitude = Math.hypot(movement.x, movement.z);
  if (magnitude < 0.01) return "Stopped";
  const directions: string[] = [];
  if (movement.z < -0.2) directions.push("forward");
  if (movement.z > 0.2) directions.push("backward");
  if (movement.x < -0.2) directions.push("left");
  if (movement.x > 0.2) directions.push("right");
  return `Moving ${directions.join(" and ") || "slowly"} ${Math.round(magnitude * 100)}%`;
}

function neutralInput(): Pick<MobileControlState, "movement" | "knob" | "magnitude"> {
  return {
    movement: { ...NEUTRAL_INPUT.movement },
    knob: { ...NEUTRAL_INPUT.knob },
    magnitude: NEUTRAL_INPUT.magnitude,
  };
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function vibrate(duration: number): void {
  try {
    navigator.vibrate?.(duration);
  } catch {
    // Haptics are optional and must never block navigation.
  }
}

const ONBOARDING_STORAGE_KEY = "spatial:mobile-controls";
const ONBOARDING_VERSION = "v1";
