import { describe, expect, it } from "vitest";
import {
  isLoopbackHttpUrl,
  selectFixtureForQualificationCase,
  selectQualificationCase,
  validateFjdSampleManifest,
  validateLocalWranglerInvocation,
  validateLocalStorageBindings,
  validateRadRangeResponses,
} from "../scripts/fjd-sample-corpus-core.mjs";
import manifest from "./vendor-corpus/fjd-manifest.json";

function selectedGaussian(document: typeof manifest) {
  const qualificationCase = selectQualificationCase(document, null);
  return selectFixtureForQualificationCase(document, qualificationCase, "gaussian_splat");
}

describe("FJD private qualification corpus", () => {
  it("pins the companion metadata and the measured source-frame view", () => {
    const validated = validateFjdSampleManifest(structuredClone(manifest));
    const gaussian = selectedGaussian(validated);

    expect(gaussian.qualificationView).toMatchObject({
      sourceUpAxis: "Z",
      cameraPosition: [10.637473, 5.462846, 0.416062],
      cameraTarget: [4.819623, 5.50264, 1.324583],
      cameraUp: [0, 0, 1],
      fovDegrees: 70,
      rendererProfile: "explicit-budget",
      rendererBudgetMillions: 1.25,
      visualTripwires: {
        minimumLuminanceRange: 128,
        minimumColourBucketCount: 64,
      },
      metadata: {
        fileName: "fjd-p2-horse-gaussian.fjdata",
        sizeBytes: 9_747_730,
        sha256: "e83fba620ac6a40f252d9d22818477eedc2bd82eb957eaf08511ac5c7c600489",
      },
    });
  });

  it("rejects a qualification view without an exact companion receipt", () => {
    const invalid = structuredClone(manifest);
    selectedGaussian(invalid).qualificationView.metadata.sha256 = "unknown";

    expect(() => validateFjdSampleManifest(invalid)).toThrowError(
      /qualificationView must pin/,
    );
  });

  it("rejects missing visual regression tripwires", () => {
    const invalid = structuredClone(manifest);
    delete selectedGaussian(invalid).qualificationView.visualTripwires;

    expect(() => validateFjdSampleManifest(invalid)).toThrowError(
      /visual tripwires/,
    );
  });

  it("resolves the Gaussian through the selected qualification case", () => {
    const reordered = structuredClone(manifest);
    reordered.fixtures.reverse();

    expect(selectedGaussian(reordered).id).toBe("fjd-p2-horse-gaussian");
  });

  it("proves the Wrangler worker launch uses local persisted bindings", () => {
    expect(validateLocalWranglerInvocation([
      "wrangler",
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--persist-to",
      "/tmp/fjd-state",
      "--config",
      "/repo/wrangler.jsonc",
    ], {
      expectedPersistenceRoot: "/tmp/fjd-state",
      expectedConfigPath: "/repo/wrangler.jsonc",
    })).toMatchObject({
      localFlag: true,
      remoteFlag: false,
      loopbackIp: "127.0.0.1",
      persistenceRoot: "/tmp/fjd-state",
      configPath: "/repo/wrangler.jsonc",
    });

    expect(() => validateLocalWranglerInvocation([
      "wrangler",
      "dev",
      "--remote",
      "--ip",
      "127.0.0.1",
      "--persist-to",
      "/tmp/fjd-state",
      "--config",
      "/repo/wrangler.jsonc",
    ], {
      expectedPersistenceRoot: "/tmp/fjd-state",
      expectedConfigPath: "/repo/wrangler.jsonc",
    })).toThrowError(/local Wrangler boundary/);
  });

  it("rejects any remote override on a local storage binding", () => {
    const localConfig = {
      d1_databases: [{ binding: "DB" }],
      r2_buckets: [{ binding: "SPATIAL_ASSETS" }],
      kv_namespaces: [{ binding: "AUTH_CACHE" }],
    };
    expect(validateLocalStorageBindings(localConfig)).toEqual([
      { kind: "d1", binding: "DB", remote: false },
      { kind: "r2", binding: "SPATIAL_ASSETS", remote: false },
      { kind: "kv", binding: "AUTH_CACHE", remote: false },
    ]);

    const remoteConfig = structuredClone(localConfig);
    remoteConfig.r2_buckets[0].remote = true;
    expect(() => validateLocalStorageBindings(remoteConfig)).toThrowError(
      /local storage boundary.*SPATIAL_ASSETS/,
    );
  });

  it("requires every Spark asset response to be a valid byte range", () => {
    expect(validateRadRangeResponses([
      { status: 206, contentLength: "100", contentRange: "bytes 0-99/250" },
      { status: 206, contentLength: "150", contentRange: "bytes 100-249/250" },
    ], 250)).toMatchObject({ responseCount: 2, totalBytes: 250 });

    expect(() => validateRadRangeResponses([
      { status: 200, contentLength: "250", contentRange: null },
    ], 250)).toThrowError(/rad_range_response/);
  });

  it("fails closed before a browser request can leave loopback", () => {
    expect(isLoopbackHttpUrl("http://127.0.0.1:8787/renderer/index.html")).toBe(true);
    expect(isLoopbackHttpUrl("https://cdn.example/analytics.js")).toBe(false);
    expect(isLoopbackHttpUrl("data:text/plain,local")).toBe(false);
  });
});
