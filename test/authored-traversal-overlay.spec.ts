import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  AuthoredTraversalOverlay,
  authoredTraversalOverlayState,
} from "../src/renderer/authored-traversal-overlay";
import type {
  AuthoredTraversalFrame,
  AuthoredTraversalLink,
} from "../src/renderer/authored-traversal";

const qualifiedLift: AuthoredTraversalLink = {
  id: "east-lift",
  traversalKind: "elevator",
  label: "East lift",
  startPosition: [0, 0, 0],
  controlPoints: [[0, 3, 0]],
  endPosition: [2, 3, 0],
  radius: 0.3,
  bidirectional: true,
  speedUnitsPerSecond: 1,
  reviewedPurpose: "Reviewed lift path.",
  evidenceReceipt: {
    assetId: "11111111-1111-4111-8111-111111111111",
    sha256: "a".repeat(64),
    manifestId: "22222222-2222-4222-8222-222222222222",
    manifestSha256: "b".repeat(64),
    adapter: "xgrids-lcc",
    reviewGeneration: 1,
    registrationSha256: "c".repeat(64),
    sourceToWorld: {
      sourceUpAxis: "Y",
      worldUnit: "metres",
      metresPerSourceUnit: 1,
      yawDegrees: 0,
      translationMetres: [0, 0, 0],
    },
    sourcePath: [[0, 0, 0], [0, 3, 0], [2, 3, 0]],
  },
};

function frame(phase: AuthoredTraversalFrame["phase"]): AuthoredTraversalFrame {
  return {
    connectionId: qualifiedLift.id,
    traversalKind: qualifiedLift.traversalKind,
    label: qualifiedLift.label,
    evidenceReceipt: { ...qualifiedLift.evidenceReceipt },
    position: [0, 3.1, 0],
    started: phase === "started",
    phase,
  };
}

describe("authored traversal overlay contract", () => {
  it("shows only an active evidence-linked path and identifies its receipt", () => {
    expect(authoredTraversalOverlayState([qualifiedLift], 1.6, frame("active"))).toEqual({
      connectionId: "east-lift",
      traversalKind: "elevator",
      label: "East lift",
      adapter: "xgrids-lcc",
      manifestSha256: "b".repeat(64),
      reviewGeneration: 1,
      registrationSha256: "c".repeat(64),
      radius: 0.3,
      path: [[0, 0, 0], [0, 3, 0], [2, 3, 0]],
      markerPosition: [0, 1.5, 0],
    });

    expect(authoredTraversalOverlayState(
      [{ ...qualifiedLift, evidenceReceipt: {
        assetId: qualifiedLift.evidenceReceipt.assetId,
        sha256: qualifiedLift.evidenceReceipt.sha256,
      } }],
      1.6,
      frame("active"),
    )).toBeNull();
    expect(authoredTraversalOverlayState([qualifiedLift], 1.6, frame("completed"))).toBeNull();
  });

  it("renders the active marker at a world-space size derived from the traversal radius", () => {
    const scene = new THREE.Scene();
    const overlay = new AuthoredTraversalOverlay(scene, [qualifiedLift], 1.6);

    overlay.update(frame("active"));

    const marker = scene.getObjectsByProperty("type", "Mesh")[0] as THREE.Mesh;
    expect(marker).toBeDefined();
    expect(marker.visible).toBe(true);
    expect(marker.position.toArray()).toEqual([0, 1.5, 0]);
    expect(marker.scale.toArray()).toEqual([0.6, 0.6, 0.6]);
    overlay.destroy();
  });
});
