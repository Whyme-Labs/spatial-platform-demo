import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  buildAuthoredCollisionGlb,
  triangulateAuthoredSurfaces,
} from "../scripts/authored-collision.mjs";
import {
  buildRecastNavigationArtifact,
  extractCollisionGeometryFromGlb,
} from "../scripts/navigation-build-core.mjs";
import { validatePhysicalNavigation } from "../scripts/physical-navigation-validation.mjs";

describe("authored walkable collision", () => {
  it("triangulates concave floor surfaces and keeps every triangle facing up", () => {
    const geometry = triangulateAuthoredSurfaces([{
      id: "concave-room",
      points: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 2],
        [2, 0, 2],
        [2, 0, 4],
        [0, 0, 4],
      ],
    }]);

    assert.equal(geometry.positions.length / 3, 6);
    assert.equal(geometry.indices.length / 3, 4);
    for (let index = 0; index < geometry.indices.length; index += 3) {
      assert.ok(triangleNormalY(geometry.positions, geometry.indices.slice(index, index + 3)) > 0);
    }
  });

  it("writes a self-contained GLB accepted by the production navigation decoder", async () => {
    const bytes = buildAuthoredCollisionGlb([{
      id: "room-a",
      points: [[0, 0, 0], [3, 0, 0], [3, 0, 3], [0, 0, 3]],
    }, {
      id: "doorway",
      points: [[3, 0, 1], [5, 0, 1], [5, 0, 2], [3, 0, 2]],
    }], { generator: "Spatial Studio authored collision test" });

    const decoded = await extractCollisionGeometryFromGlb(bytes);
    assert.equal(decoded.meshCount, 1);
    assert.equal(decoded.positions.length / 3, 8);
    assert.equal(decoded.indices.length / 3, 4);
  });

  it("keeps the exact Home Scan route continuous through every advertised room", async () => {
    const config = JSON.parse(await readFile(
      new URL("../assets/home-scan-navigation-v6.json", import.meta.url),
      "utf8",
    ));
    const bytes = buildAuthoredCollisionGlb(config.surfaces, {
      generator: "Spatial Studio Home Scan acceptance",
      source: config.source,
    });
    const geometry = await extractCollisionGeometryFromGlb(bytes);
    const artifact = await buildRecastNavigationArtifact({
      ...config,
      positions: geometry.positions,
      indices: geometry.indices,
      source: {
        ...config.source,
        assetId: "home-scan-authored-navigation-v6.glb",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        authoringHash: createHash("sha256")
          .update(JSON.stringify(config.authoring))
          .digest("hex"),
      },
    });
    const physical = await validatePhysicalNavigation({
      artifact,
      positions: geometry.positions,
      indices: geometry.indices,
    });

    assert.equal(config.source.visualMasterSha256, "1d4c11e4e6f159e9997d953c22a6c5e8a9fecc45f1fa0ec4ad4ad207fc835148");
    assert.equal(config.authoring.algorithmVersion, "1.1.0");
    assert.equal(config.authoring.reviewedRoute.posterCheckpoints.length, 9);
    assert.equal(artifact.validation.passed, true);
    assert.equal(artifact.validation.componentCount, 1);
    assert.equal(artifact.validation.destinationCount, 4);
    assert.deepEqual(artifact.validation.unreachableDestinationIds, []);
    assert.equal(physical.passed, true);
    assert.equal(physical.routeCount, 8);
  });
});

function triangleNormalY(positions, [first, second, third]) {
  const a = positions.slice(first * 3, first * 3 + 3);
  const b = positions.slice(second * 3, second * 3 + 3);
  const c = positions.slice(third * 3, third * 3 + 3);
  return (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
}
