import { describe, expect, it } from "vitest";
import { AuthoredTraversalController } from "../src/renderer/authored-traversal";
import { parseDetourNavigationArtifact } from "../src/renderer/detour-navigation";
import { controlledMovementReachedTarget } from "../src/renderer/physical-navigation";
import { isSceneRegisteredTraversalEvidenceReceipt } from "../src/shared/traversal-evidence";

const elevator = {
  id: "east-lift",
  traversalKind: "elevator" as const,
  label: "East lift",
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
    manifestId: "22222222-2222-4222-8222-222222222222",
    manifestSha256: "b".repeat(64),
    adapter: "xgrids-lcc",
    reviewGeneration: 1,
    registrationSha256: "c".repeat(64),
    sourceToWorld: {
      sourceUpAxis: "Y" as const,
      worldUnit: "metres" as const,
      metresPerSourceUnit: 1,
      yawDegrees: 0,
      translationMetres: [0, 0, 0] as [number, number, number],
    },
    sourcePath: [[0, 0, 0], [1, 0, 0], [1, 3, 0], [2, 3, 0]] as Array<[number, number, number]>,
  },
};

describe("authored traversal controller", () => {
  it("distinguishes a numerically registered capture receipt from legacy manifest provenance", () => {
    expect(isSceneRegisteredTraversalEvidenceReceipt(elevator.evidenceReceipt)).toBe(true);
    expect(isSceneRegisteredTraversalEvidenceReceipt({
      assetId: elevator.evidenceReceipt.assetId,
      sha256: elevator.evidenceReceipt.sha256,
      manifestId: elevator.evidenceReceipt.manifestId,
      manifestSha256: elevator.evidenceReceipt.manifestSha256,
      adapter: elevator.evidenceReceipt.adapter,
      reviewGeneration: elevator.evidenceReceipt.reviewGeneration,
    })).toBe(false);
  });
  it("moves through the reviewed path at authored speed instead of teleporting", () => {
    const controller = new AuthoredTraversalController([elevator], 1.6);
    const started = controller.resolveMovement([0, 1.6, 0], [0.2, 1.6, 0], 0.5);
    expect(started).toMatchObject({
      connectionId: "east-lift",
      traversalKind: "elevator",
      started: true,
      phase: "started",
    });
    expect(started?.position).toEqual([0.5, 1.6, 0]);

    let frame = started;
    for (let index = 0; index < 10 && frame?.phase !== "completed"; index += 1) {
      frame = controller.resolveMovement(frame!.position, [20, 20, 20], 0.5);
    }
    expect(frame).toMatchObject({ phase: "completed", position: [2, 4.6, 0] });
  });

  it("marks a traversal started even when one controller frame also completes it", () => {
    const controller = new AuthoredTraversalController([{
      ...elevator,
      controlPoints: [],
      endPosition: [0.1, 0, 0],
      speedUnitsPerSecond: 10,
    }], 1.6);

    expect(controller.resolveMovement([0, 1.6, 0], [0.1, 1.6, 0], 0.05)).toMatchObject({
      connectionId: "east-lift",
      started: true,
      phase: "completed",
      position: [0.1, 1.6, 0],
    });
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

  it("keeps legacy v8 traversal artifacts readable without granting v9 qualification", () => {
    const legacy = parseDetourNavigationArtifact({
      schemaVersion: "spatial-navigation-v8",
      generator: { version: "0.43.1" },
      agent: { radius: 0.25, height: 1.7, eyeHeight: 1.6 },
      build: { cellSize: 0.1, cellHeight: 0.05 },
      bounds: [[0, 0, 0], [2, 3, 2]],
      spawn: { projectedPosition: [0, 0, 0] },
      detour: { format: "recast-navigation-js-export-v1", bytesBase64: "AA==" },
      dynamicBarriers: [],
      offMeshConnections: [{
        ...elevator,
        label: undefined,
        evidenceReceipt: {
          assetId: elevator.evidenceReceipt.assetId,
          sha256: elevator.evidenceReceipt.sha256,
        },
      }],
    });
    expect(legacy.offMeshConnections[0]).toMatchObject({
      label: "Elevator traversal",
      evidenceReceipt: {
        assetId: elevator.evidenceReceipt.assetId,
        sha256: elevator.evidenceReceipt.sha256,
      },
    });
    expect(() => parseDetourNavigationArtifact({
      ...legacy,
      schemaVersion: "spatial-navigation-v9",
      offMeshConnections: legacy.offMeshConnections.map((connection) => ({
        ...connection,
        label: undefined,
      })),
    })).toThrow("Navigation artifact is incomplete");
    expect(() => parseDetourNavigationArtifact({
      ...legacy,
      schemaVersion: "spatial-navigation-v8",
      offMeshConnections: [{ ...elevator }],
    })).toThrow("Navigation artifact is incomplete");
    expect(() => parseDetourNavigationArtifact({
      ...legacy,
      schemaVersion: "spatial-navigation-v8",
      offMeshConnections: [{
        ...elevator,
        evidenceReceipt: {
          ...elevator.evidenceReceipt,
          adapter: undefined,
        },
      }],
    })).toThrow("Navigation artifact is incomplete");
  });
});
