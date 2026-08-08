import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { createSpatialLookControls } from "../src/renderer/look-controls";

// The motor must feel identical on every display. A cross-frame fixed-step
// accumulator once froze velocity on any display faster than the step — a
// 144 Hz frame never fills a 1/120 s budget, so the walker stayed pinned at
// the kick-start speed and never braked after key release. These simulations
// drive the real controls at common refresh rates and assert the physics is
// rate-independent.
const FRAME_RATES_HZ = [30, 60, 90, 120, 144, 165, 240];
const WALK_SPEED = 1.4;
const BOOST_MULTIPLIER = 3;
const KICKSTART_FRACTION = 0.4;

type EventStub = {
  addEventListener: () => void;
  removeEventListener: () => void;
};

function eventStub(): EventStub {
  return { addEventListener: () => {}, removeEventListener: () => {} };
}

beforeAll(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.document = globals.document ?? eventStub();
  globals.window = globals.window ?? eventStub();
});

function createRig() {
  const controls = createSpatialLookControls(
    eventStub() as unknown as HTMLCanvasElement,
  );
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  controls.align(camera);
  return { controls, camera };
}

type FramePhase = {
  seconds: number;
  keys: string[];
};

function simulate(rateHz: number, phases: FramePhase[]): {
  position: THREE.Vector3;
  lastFrameSpeed: number;
  everyHeldFrameMoved: boolean;
  phaseEndSpeeds: number[];
} {
  const { controls, camera } = createRig();
  const delta = 1 / rateHz;
  const before = new THREE.Vector3();
  let lastFrameSpeed = 0;
  let everyHeldFrameMoved = true;
  const phaseEndSpeeds: number[] = [];
  let active = new Set<string>();
  for (const phase of phases) {
    for (const key of active) {
      if (!phase.keys.includes(key)) controls.setKeyboardKeyState(key, false);
    }
    for (const key of phase.keys) controls.setKeyboardKeyState(key, true);
    active = new Set(phase.keys);
    const frames = Math.round(phase.seconds * rateHz);
    for (let frame = 0; frame < frames; frame += 1) {
      before.copy(camera.position);
      controls.update(camera, delta);
      const moved = camera.position.distanceTo(before);
      lastFrameSpeed = moved / delta;
      if (phase.keys.length && moved <= 0) everyHeldFrameMoved = false;
    }
    phaseEndSpeeds.push(lastFrameSpeed);
  }
  controls.dispose();
  return {
    position: camera.position.clone(),
    lastFrameSpeed,
    everyHeldFrameMoved,
    phaseEndSpeeds,
  };
}

describe("first-person motor frame-rate independence", () => {
  it("reaches full walking speed at every refresh rate, including above 120 Hz", () => {
    for (const rate of FRAME_RATES_HZ) {
      const run = simulate(rate, [{ seconds: 1, keys: ["KeyW"] }]);
      expect(run.lastFrameSpeed, `${rate} Hz`).toBeGreaterThan(WALK_SPEED * 0.98);
      expect(run.lastFrameSpeed, `${rate} Hz`).toBeLessThan(WALK_SPEED * 1.02);
      // The historical failure mode: stuck at the kick-start fraction forever.
      expect(run.lastFrameSpeed, `${rate} Hz`).toBeGreaterThan(
        WALK_SPEED * KICKSTART_FRACTION * 1.5,
      );
    }
  });

  it("covers the same distance at every refresh rate", () => {
    const distances = FRAME_RATES_HZ.map((rate) =>
      simulate(rate, [{ seconds: 2, keys: ["KeyW"] }]).position.length()
    );
    const reference = distances[FRAME_RATES_HZ.indexOf(120)]!;
    for (const [index, distance] of distances.entries()) {
      expect(
        Math.abs(distance - reference),
        `${FRAME_RATES_HZ[index]} Hz travelled ${distance} vs ${reference}`,
      ).toBeLessThan(reference * 0.02);
    }
  });

  it("brakes to a stop after release at every refresh rate", () => {
    for (const rate of FRAME_RATES_HZ) {
      const run = simulate(rate, [
        { seconds: 1, keys: ["KeyW"] },
        { seconds: 1, keys: [] },
      ]);
      expect(run.lastFrameSpeed, `${rate} Hz still moving`).toBeLessThan(0.01);
    }
  });

  it("keeps the stopping distance consistent across refresh rates", () => {
    const stops = FRAME_RATES_HZ.map((rate) => {
      const held = simulate(rate, [{ seconds: 1, keys: ["KeyW"] }]);
      const released = simulate(rate, [
        { seconds: 1, keys: ["KeyW"] },
        { seconds: 1, keys: [] },
      ]);
      return released.position.length() - held.position.length();
    });
    const reference = stops[FRAME_RATES_HZ.indexOf(120)]!;
    expect(reference).toBeGreaterThan(0);
    for (const [index, stop] of stops.entries()) {
      expect(
        Math.abs(stop - reference),
        `${FRAME_RATES_HZ[index]} Hz stopping distance ${stop} vs ${reference}`,
      ).toBeLessThan(Math.max(0.01, reference * 0.1));
    }
  });

  it("reverses from forward to backward at every refresh rate", () => {
    for (const rate of FRAME_RATES_HZ) {
      const run = simulate(rate, [
        { seconds: 1, keys: ["KeyW"] },
        { seconds: 1.5, keys: ["KeyS"] },
      ]);
      expect(run.phaseEndSpeeds[1], `${rate} Hz`).toBeGreaterThan(WALK_SPEED * 0.98);
      // After a full reversal the walker must be heading back: net travel is
      // shorter than the forward leg alone.
      const forwardOnly = simulate(rate, [{ seconds: 1, keys: ["KeyW"] }]);
      expect(run.position.z, `${rate} Hz direction`).toBeGreaterThan(
        forwardOnly.position.z,
      );
    }
  });

  it("accelerates to and brakes from boost speed at every refresh rate", () => {
    for (const rate of FRAME_RATES_HZ) {
      const run = simulate(rate, [
        { seconds: 2, keys: ["KeyW", "ShiftLeft"] },
        { seconds: 2.5, keys: [] },
      ]);
      expect(run.phaseEndSpeeds[0], `${rate} Hz boost`).toBeGreaterThan(
        WALK_SPEED * BOOST_MULTIPLIER * 0.98,
      );
      expect(run.phaseEndSpeeds[1], `${rate} Hz post-boost brake`).toBeLessThan(0.01);
    }
  });

  it("emits displacement on every held frame so resistance tracking never sees a gap", () => {
    for (const rate of FRAME_RATES_HZ) {
      const run = simulate(rate, [{ seconds: 0.5, keys: ["KeyW"] }]);
      expect(run.everyHeldFrameMoved, `${rate} Hz`).toBe(true);
    }
  });
});
