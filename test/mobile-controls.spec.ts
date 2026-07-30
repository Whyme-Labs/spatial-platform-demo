import { describe, expect, it } from "vitest";
import {
  createFallbackWalkableBounds,
  MobileControlModel,
  nearestWalkablePoint,
  planarCameraStep,
} from "../src/renderer/mobile-controls";

describe("mobile free-roam controls", () => {
  it("stays unavailable until both touch input and the renderer are ready", () => {
    const controls = new MobileControlModel();

    expect(controls.state).toMatchObject({
      touchCapable: false,
      ready: false,
      active: false,
      movement: { x: 0, z: 0 },
    });
    expect(controls.toggle()).toBe(false);

    controls.setTouchCapable(true);
    expect(controls.toggle()).toBe(false);

    controls.setReady(true);
    expect(controls.toggle()).toBe(true);
    expect(controls.state.active).toBe(true);
  });

  it("normalises a drag into bounded walking input with a dead zone", () => {
    const controls = readyControls();

    expect(controls.beginPointer(7, 3, -4, 56)).toBe(true);
    expect(controls.state.movement).toEqual({ x: 0, z: 0 });

    controls.movePointer(7, 56, -56, 56);
    expect(controls.state.movement.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(controls.state.movement.z).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(controls.state.knob.x).toBeCloseTo(56 * Math.SQRT1_2, 5);
    expect(controls.state.knob.y).toBeCloseTo(-56 * Math.SQRT1_2, 5);
    expect(controls.state.magnitude).toBe(1);
  });

  it("returns to neutral after cancellation, backgrounding, or touch capability loss", () => {
    const controls = readyControls();
    controls.beginPointer(9, 0, 0, 56);
    controls.movePointer(9, 0, -48, 56);
    expect(controls.state.movement.z).toBeLessThan(-0.7);

    controls.releasePointer(9);
    expect(controls.state.movement).toEqual({ x: 0, z: 0 });
    expect(controls.state.pointerId).toBeNull();

    controls.beginPointer(10, 0, -48, 56);
    controls.suspend();
    expect(controls.state.movement).toEqual({ x: 0, z: 0 });

    controls.beginPointer(11, 0, -48, 56);
    controls.setTouchCapable(false);
    expect(controls.state).toMatchObject({
      touchCapable: false,
      active: false,
      pointerId: null,
      movement: { x: 0, z: 0 },
    });
  });

  it("moves parallel to the floor even when the camera is pitched", () => {
    const next = planarCameraStep({
      position: [4, 1.6, 8],
      forward: [0, 0.8, -0.6],
      movement: { x: 0.5, z: -1 },
      speed: 1.4,
      deltaSeconds: 0.5,
    });

    expect(next[0]).toBeCloseTo(4.35, 5);
    expect(next[1]).toBe(1.6);
    expect(next[2]).toBeCloseTo(7.3, 5);
  });

  it("anchors an invalid spawn to the nearest authored walkable region", () => {
    expect(nearestWalkablePoint(
      [9, 1.6, 9],
      [
        { min: [-4, 0, -2], max: [4, 3, 2] },
        { min: [10, 0, 10], max: [12, 3, 12] },
      ],
    )).toEqual([10, 1.6, 10]);
    expect(nearestWalkablePoint([0, 0, 0], [])).toBeNull();
  });

  it("derives a padded fallback boundary from the splat and useful opening view", () => {
    expect(createFallbackWalkableBounds(
      { min: [0, 0, 0], max: [10, 3, 8] },
      [5, 1.6, 12],
    )).toEqual({
      min: [-0.8, -0.35, -0.64],
      max: [10.8, 3.35, 12],
    });
    expect(createFallbackWalkableBounds(
      { min: [Number.NaN, 0, 0], max: [1, 1, 1] },
      [0, 0, 0],
    )).toBeNull();
  });
});

function readyControls(): MobileControlModel {
  const controls = new MobileControlModel();
  controls.setTouchCapable(true);
  controls.setReady(true);
  controls.toggle();
  return controls;
}
