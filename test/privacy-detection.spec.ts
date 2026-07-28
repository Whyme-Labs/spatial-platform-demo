import { describe, expect, it } from "vitest";
import {
  normalisePrivacyBoxes,
  runPrivacyDetectionWithRetry,
} from "../src/worker/index";

describe("privacy detection response normalisation", () => {
  it("normalises documented and defensive bounding-box shapes without inventing confidence", () => {
    expect(normalisePrivacyBoxes({
      objects: [
        {
          bbox: { x_min: 100, y_min: 200, x_max: 400, y_max: 650 },
          score: 0.87,
        },
        {
          bounding_box: [0.6, 0.1, 0.9, 0.3],
        },
        {
          box: { left: 900, top: 900, right: 900, bottom: 950 },
          confidence: 0.9,
        },
        { bbox: ["not-a-coordinate", 0, 1, 1] },
      ],
    })).toMatchObject([
      {
        xMin: 0.1,
        yMin: 0.2,
        xMax: 0.4,
        yMax: 0.65,
        confidence: 0.87,
      },
      {
        xMin: 0.6,
        yMin: 0.1,
        xMax: 0.9,
        yMax: 0.3,
        confidence: null,
      },
    ]);
  });

  it("deduplicates effectively identical detections and rejects malformed responses", () => {
    expect(normalisePrivacyBoxes({
      objects: [
        { bbox: [0.1, 0.1, 0.5, 0.5] },
        { bbox: [0.102, 0.102, 0.498, 0.498] },
      ],
    })).toHaveLength(1);
    expect(normalisePrivacyBoxes({ objects: "not-an-array" })).toEqual([]);
    expect(normalisePrivacyBoxes(null)).toEqual([]);
  });

  it("retries bounded transient detector failures without duplicating a successful call", async () => {
    let calls = 0;
    const ai = {
      async run(): Promise<unknown> {
        calls += 1;
        if (calls < 3) throw new Error("8008: Internal server error");
        return { objects: [] };
      },
    };
    await expect(runPrivacyDetectionWithRetry(ai, {}, {}, 3)).resolves.toEqual({
      output: { objects: [] },
      attempts: 3,
    });
    expect(calls).toBe(3);
  });

  it("stops after the configured detector retry budget", async () => {
    let calls = 0;
    const ai = {
      async run(): Promise<unknown> {
        calls += 1;
        throw new Error("upstream unavailable");
      },
    };
    await expect(runPrivacyDetectionWithRetry(ai, {}, {}, 2)).rejects.toThrow(
      "upstream unavailable",
    );
    expect(calls).toBe(2);
  });
});
