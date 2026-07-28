import { describe, expect, it } from "vitest";
import {
  analysePosterSample,
  posterSampleIsReady,
} from "../scripts/poster-quality.mjs";

describe("Spark poster visual readiness", () => {
  it("rejects a syntactically valid but blank background render", () => {
    const pixels = new Uint8ClampedArray(64 * 36 * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels.set([11, 17, 14, 255], index);
    }
    const stats = analysePosterSample(pixels);
    expect(stats).toMatchObject({
      signalFraction: 0,
      luminanceRange: 0,
      colourBucketCount: 1,
    });
    expect(posterSampleIsReady(stats)).toBe(false);
  });

  it("accepts a spatially varied rendered scene", () => {
    const pixels = new Uint8ClampedArray(64 * 36 * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      const pixel = index / 4;
      pixels.set([
        40 + (pixel % 180),
        30 + ((pixel * 3) % 190),
        20 + ((pixel * 7) % 200),
        255,
      ], index);
    }
    const stats = analysePosterSample(pixels);
    expect(stats.signalFraction).toBeGreaterThan(0.9);
    expect(stats.luminanceRange).toBeGreaterThan(8);
    expect(stats.colourBucketCount).toBeGreaterThan(4);
    expect(posterSampleIsReady(stats)).toBe(true);
  });
});
