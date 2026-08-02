import { describe, expect, it } from "vitest";
import { AuthoredTraversalController } from "../src/renderer/authored-traversal";
import { controlledMovementReachedTarget } from "../src/renderer/physical-navigation";

const elevator = {
  id: "east-lift",
  traversalKind: "elevator" as const,
  startPosition: [0, 0, 0] as [number, number, number],
  controlPoints: [[1, 0, 0], [1, 3, 0]] as Array<[number, number, number]>,
  endPosition: [2, 3, 0] as [number, number, number],
  radius: 0.25,
  bidirectional: true,
  speedUnitsPerSecond: 1,
  reviewedPurpose: "Reviewed lift path between captured floors.",
  evidenceReceipt: {
    assetId: "11111111-1111-4111-8111-111111111111",
    sha256: "a".repeat(64),
  },
};

describe("authored traversal controller", () => {
  it("moves through the reviewed path at authored speed instead of teleporting", () => {
    const controller = new AuthoredTraversalController([elevator], 1.6);
    const started = controller.resolveMovement([0, 1.6, 0], [0.2, 1.6, 0], 0.5);
    expect(started).toMatchObject({
      connectionId: "east-lift",
      traversalKind: "elevator",
      phase: "started",
    });
    expect(started?.position).toEqual([0.5, 1.6, 0]);

    let frame = started;
    for (let index = 0; index < 10 && frame?.phase !== "completed"; index += 1) {
      frame = controller.resolveMovement(frame!.position, [20, 20, 20], 0.5);
    }
    expect(frame).toMatchObject({ phase: "completed", position: [2, 4.6, 0] });
  });

  it("fails closed when collision response slides away from the authored path", () => {
    expect(controlledMovementReachedTarget(
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    )).toBe(false);
    expect(controlledMovementReachedTarget(
      { x: 1 / 3, y: 0, z: 0 },
      { x: Math.fround(1 / 3), y: 0, z: 0 },
    )).toBe(true);
  });

  it("does not enter the reverse side of a one-way ladder", () => {
    const controller = new AuthoredTraversalController([{
      ...elevator,
      id: "service-ladder",
      traversalKind: "ladder",
      bidirectional: false,
    }], 1.6);
    expect(controller.resolveMovement([2, 4.6, 0], [1.8, 4.6, 0], 0.5)).toBeNull();
  });

  it("requires movement intent along the reviewed entry tangent in both directions", () => {
    const forward = new AuthoredTraversalController([elevator], 1.6);
    expect(forward.resolveMovement([0, 1.6, 0], [-0.2, 1.6, 0], 0.5)).toBeNull();
    expect(forward.resolveMovement([0, 1.6, 0], [0, 1.6, 0.2], 0.5)).toBeNull();

    const reverse = new AuthoredTraversalController([elevator], 1.6);
    expect(reverse.resolveMovement([2, 4.6, 0], [1.8, 4.6, 0], 0.5)).toMatchObject({
      connectionId: "east-lift",
      phase: "started",
    });
  });
});
