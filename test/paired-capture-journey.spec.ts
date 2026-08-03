import { describe, expect, it } from "vitest";
import {
  bindPairedCaptureGeometry,
  createPairedCaptureJourney,
  pairedCaptureIdentityTransform,
  parsePairedCaptureJourney,
} from "../src/shared/paired-capture-journey";

const journeyId = "11111111-1111-4111-8111-111111111111";
const primaryAssetId = "22222222-2222-4222-8222-222222222222";
const geometryAssetId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

describe("paired capture journey receipts", () => {
  it("binds one same-frame declaration to exact visual and geometry assets", () => {
    const pending = createPairedCaptureJourney({
      request: { id: journeyId, sameFrameConfirmed: true },
      captureAdapter: "fjd-trion",
      primaryAssetId,
      confirmedBy: userId,
      confirmedAt: "2026-08-03T12:00:00.000Z",
    });
    const bound = bindPairedCaptureGeometry(pending, geometryAssetId);
    expect(parsePairedCaptureJourney(bound)).toEqual(bound);
    expect(pairedCaptureIdentityTransform).toEqual({
      sourceUpAxis: "Y",
      worldUnit: "metres",
      metresPerSourceUnit: 1,
      yawDegrees: 0,
      translationMetres: [0, 0, 0],
    });
  });

  it("rejects a changed frame identity instead of silently trusting provenance JSON", () => {
    const pending = createPairedCaptureJourney({
      request: { id: journeyId, sameFrameConfirmed: true },
      captureAdapter: "fjd-trion",
      primaryAssetId,
      confirmedBy: userId,
      confirmedAt: "2026-08-03T12:00:00.000Z",
    });
    expect(parsePairedCaptureJourney({
      ...pending,
      sourceCoordinateFrameId: "another-frame",
    })).toBeNull();
    expect(parsePairedCaptureJourney({
      ...pending,
      declaration: "looks-close-enough",
    })).toBeNull();
  });
});
