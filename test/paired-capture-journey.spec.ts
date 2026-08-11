import { describe, expect, it } from "vitest";
import {
  bindPairedCaptureGeometry,
  createPairedCaptureJourney,
  pairedCaptureJourneyHasProcessorQualification,
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
    expect(bound.qualification).toMatchObject({
      method: "operator-attestation-v1",
      status: "verified",
    });
    expect(pairedCaptureIdentityTransform).toEqual({
      sourceUpAxis: "Y",
      worldUnit: "metres",
      metresPerSourceUnit: 1,
      yawDegrees: 0,
      translationMetres: [0, 0, 0],
    });
  });

  it("keeps automatic PLY qualification pending until processor evidence is bound", () => {
    const pending = createPairedCaptureJourney({
      request: { id: journeyId, qualification: "automatic-ply-coordinate-evidence-v1" },
      captureAdapter: "open-import",
      primaryAssetId,
      confirmedBy: userId,
      confirmedAt: "2026-08-03T12:00:00.000Z",
    });

    expect(parsePairedCaptureJourney(pending)).toEqual(pending);
    expect(pending.qualification).toEqual({
      method: "automatic-ply-coordinate-evidence-v1",
      status: "pending",
    });
  });

  it("distinguishes operator attestation from processor-qualified registration", () => {
    const attested = createPairedCaptureJourney({
      request: { id: crypto.randomUUID(), sameFrameConfirmed: true },
      captureAdapter: "open-import",
      primaryAssetId: crypto.randomUUID(),
      confirmedBy: crypto.randomUUID(),
      confirmedAt: new Date().toISOString(),
    });

    expect(pairedCaptureJourneyHasProcessorQualification(attested)).toBe(false);
  });

  it("rejects contradictory or fabricated automatic coordinate evidence", () => {
    const pending = bindPairedCaptureGeometry(createPairedCaptureJourney({
      request: { id: journeyId, qualification: "automatic-ply-coordinate-evidence-v1" },
      captureAdapter: "open-import",
      primaryAssetId,
      confirmedBy: userId,
      confirmedAt: "2026-08-03T12:00:00.000Z",
    }), geometryAssetId);
    const evidence = (bounds: { min: [number, number, number]; max: [number, number, number] }) => ({
      schemaVersion: "ply-coordinate-evidence-v1",
      method: "automatic-ply-coordinate-evidence-v1",
      coordinateFrameId: "scanner-run-42",
      sourceUpAxis: "Y",
      worldUnit: "metres",
      vertexCount: 2,
      finitePointCount: 2,
      bounds,
    });
    const visual = evidence({ min: [0, 0, 0], max: [2, 2, 2] });
    const geometry = evidence({ min: [1, 1, 1], max: [3, 3, 3] });
    const qualification = {
      method: "automatic-ply-coordinate-evidence-v1",
      status: "verified",
      coordinateFrameId: "scanner-run-42",
      sourceUpAxis: "Y",
      worldUnit: "metres",
      overlapBounds: { min: [1, 1, 1], max: [2, 2, 2] },
      visual,
      geometry,
    };

    expect(parsePairedCaptureJourney({ ...pending, qualification })).not.toBeNull();
    expect(parsePairedCaptureJourney({
      ...pending,
      qualification: {
        ...qualification,
        visual: { ...visual, worldUnit: "feet" },
      },
    })).toBeNull();
    expect(parsePairedCaptureJourney({
      ...pending,
      qualification: {
        ...qualification,
        overlapBounds: { min: [0, 0, 0], max: [2, 2, 2] },
      },
    })).toBeNull();
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
