import { describe, expect, it } from "vitest";
import {
  buildSemanticSceneIndex,
  sceneContext,
  searchSemanticEntities,
  semanticEntitySummary,
  type PublishedManifest,
} from "../src/webmcp/semantic-scene";

function manifest(slug = "semantic-test-scene"): PublishedManifest {
  return {
    release: {
      id: "release-1",
      slug,
      number: 1,
      publishedAt: "2026-08-26T00:00:00.000Z",
    },
    project: {
      id: "project-1",
      versionId: "version-1",
      name: "Semantic test scene",
      captureAdapter: "test-adapter",
    },
    scene: {
      contentUrl: "/assets/test.spz",
      format: "spz",
    },
    viewer: {
      title: "Semantic test scene",
      subtitle: "A deterministic fixture",
      measurementDisclaimer: "Fixture geometry is not a surveyed measurement.",
    },
    spatial: {
      entities: [
        {
          id: "floor-ground",
          parent_id: null,
          kind: "floor",
          label: "Ground floor",
          description: null,
          position_json: JSON.stringify([0, 0, 0]),
          geometry_json: JSON.stringify({
            type: "box",
            points: [[-5, 0, -5], [5, 0.25, 5]],
          }),
          metadata_json: JSON.stringify({ reviewStatus: "reviewed" }),
          sort_order: 0,
        },
        {
          id: "living-room",
          parent_id: "floor-ground",
          kind: "room",
          label: "Living room",
          description: "The main seating area.",
          position_json: JSON.stringify([0, 0.1, 0]),
          geometry_json: JSON.stringify({
            type: "box",
            points: [[-3, 0, -3], [3, 2.8, 3]],
          }),
          metadata_json: JSON.stringify({
            aliases: ["lounge"],
            semanticConfidence: 0.96,
            visualCoverage: 0.91,
            cameraPose: {
              position: [0, 1.6, 2],
              target: [0, 1, 0],
              up: [0, 1, 0],
              fovDegrees: 58,
            },
          }),
          sort_order: 1,
        },
        {
          id: "poi-help-point",
          parent_id: "living-room",
          kind: "poi",
          label: "Help point",
          description: "A persistent assistance point.",
          position_json: JSON.stringify([1, 1, 1]),
          geometry_json: null,
          metadata_json: JSON.stringify({
            aliases: ["assistance", "emergency help"],
            affordances: ["call_for_help"],
            semanticConfidence: 0.88,
          }),
          sort_order: 2,
        },
      ],
      routes: [],
      routeStops: [],
      collisionProxy: { version: "test", boxes: [] },
      navigationMesh: { version: "test", vertices: [], indices: [], sourceEntityIds: [] },
      navigationProfile: {
        worldUnit: "scene_units",
        agentRadius: 0.2,
        agentHeight: 1.7,
        eyeHeight: 1.6,
        maxStepMetres: 0.1,
      },
    },
  };
}

describe("semantic scene index", () => {
  it("parses tuple positions and box geometry from the published manifest", () => {
    const index = buildSemanticSceneIndex(manifest());
    const room = index.entityById.get("living-room");

    expect(room?.position).toEqual([0, 0.1, 0]);
    expect(room?.bounds).toEqual({ min: [-3, 0, -3], max: [3, 2.8, 3] });
    expect(room?.bestView?.position).toEqual([0, 1.6, 2]);
  });

  it("searches stable entities by label, alias, and affordance without inventing matches", () => {
    const index = buildSemanticSceneIndex(manifest());

    expect(searchSemanticEntities(index, "lounge")[0]?.entity.id).toBe("living-room");
    expect(searchSemanticEntities(index, "call for help")[0]?.entity.id).toBe("poi-help-point");
    expect(searchSemanticEntities(index, "imaginary escalator")).toEqual([]);
  });

  it("grounds live camera context in a classified region", () => {
    const index = buildSemanticSceneIndex(manifest());
    const context = sceneContext(index, {
      position: [0, 1.6, 0],
      target: [0, 1, -1],
      up: [0, 1, 0],
      fovDegrees: 58,
    }, "poi-help-point");

    expect(context.currentRegion?.id).toBe("living-room");
    expect(context.selectedEntity?.id).toBe("poi-help-point");
    expect(context.nearbyEntities.some(({ entity }) => entity.id === "poi-help-point")).toBe(true);
  });

  it("adds reverse containment relationships for graph traversal", () => {
    const index = buildSemanticSceneIndex(manifest());
    const room = index.entityById.get("living-room");

    expect(room?.relationships).toContainEqual({
      predicate: "contains",
      targetId: "poi-help-point",
      confidence: 1,
    });
  });

  it("keeps reviewed Home Scan object semantics explicitly provisional", () => {
    const index = buildSemanticSceneIndex(manifest("home-scan-spark-multi-room-demo"));
    const sofa = index.entityById.get("home-scan-object-central-sofa");
    const summary = sofa ? semanticEntitySummary(sofa) : null;

    expect(sofa?.label).toBe("central sofa");
    expect(sofa?.quality.reviewStatus).toBe("provisional");
    expect(sofa?.quality.gaps).toContain("rear surface is weakly observed");
    expect(summary?.bestViewAvailable).toBe(true);
  });
});
