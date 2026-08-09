import { describe, expect, it } from "vitest";
import {
  buildRepublishPayload,
  type ReviewedSourceToWorldEvidence,
} from "../src/client/release-clone";

const BASE = {
  slug: "workshop-scene",
  accessPolicy: "public",
  expiresAt: null,
  clientOperationId: "0f7a1c2d-3b4e-45f6-8a9b-0c1d2e3f4a5b",
  reviewedSourceToWorld: [] as ReviewedSourceToWorldEvidence[],
};

const STORED_CONFIG = {
  title: "Workshop",
  measurementDisclaimer: "Indicative only",
  splatBudgetMillions: 2,
  defaultMovementMode: "walk",
};

describe("buildRepublishPayload", () => {
  it("clones slug, policy, expiry, and the stored viewer configuration verbatim", () => {
    const clone = buildRepublishPayload({
      ...BASE,
      expiresAt: "2027-01-01T00:00:00.000Z",
      viewerConfigJson: JSON.stringify(STORED_CONFIG),
    });
    expect(clone).toEqual({
      ok: true,
      payload: {
        clientOperationId: BASE.clientOperationId,
        slug: "workshop-scene",
        accessPolicy: "public",
        expiresAt: "2027-01-01T00:00:00.000Z",
        viewerConfig: STORED_CONFIG,
      },
    });
  });

  it("refuses token-gated releases: republishing would mint a new access token", () => {
    const clone = buildRepublishPayload({
      ...BASE,
      accessPolicy: "token",
      viewerConfigJson: JSON.stringify(STORED_CONFIG),
    });
    expect(clone.ok).toBe(false);
    if (!clone.ok) expect(clone.reason).toMatch(/access token/);
  });

  it("refuses unreadable or non-object stored configuration", () => {
    for (const viewerConfigJson of [null, undefined, "", "not json", "[]", "42"]) {
      const clone = buildRepublishPayload({ ...BASE, viewerConfigJson });
      expect(clone.ok).toBe(false);
    }
  });

  it("re-derives the source-to-world evidence id only on an exact transform match", () => {
    const transform = {
      sourceUpAxis: "Z",
      worldUnit: "metres",
      metresPerSourceUnit: 0.5,
      yawDegrees: 90,
      translationMetres: [1, 2, 3],
    };
    const evidence: ReviewedSourceToWorldEvidence = {
      extractionId: "aaaaaaaa-0000-4000-8000-000000000001",
      sourceUpAxis: "Z",
      worldUnit: "metres",
      metresPerSourceUnit: 0.5,
      yawDegrees: 90,
      translationMetres: [1, 2, 3],
    };
    const matched = buildRepublishPayload({
      ...BASE,
      viewerConfigJson: JSON.stringify({ ...STORED_CONFIG, sourceToWorld: transform }),
      reviewedSourceToWorld: [evidence],
    });
    expect(matched.ok).toBe(true);
    if (matched.ok) {
      expect(matched.payload.sourceToWorldEvidenceId).toBe(evidence.extractionId);
    }
    const nearMiss = buildRepublishPayload({
      ...BASE,
      viewerConfigJson: JSON.stringify({
        ...STORED_CONFIG,
        sourceToWorld: { ...transform, yawDegrees: 90.0001 },
      }),
      reviewedSourceToWorld: [evidence],
    });
    expect(nearMiss.ok).toBe(false);
    if (!nearMiss.ok) expect(nearMiss.reason).toMatch(/could not be re-derived/);
  });

  it("refuses when the stored transform exists but no evidence is reviewable", () => {
    const clone = buildRepublishPayload({
      ...BASE,
      viewerConfigJson: JSON.stringify({
        ...STORED_CONFIG,
        sourceToWorld: {
          sourceUpAxis: "Y",
          worldUnit: "metres",
          metresPerSourceUnit: 1,
          yawDegrees: 0,
          translationMetres: [0, 0, 0],
        },
      }),
    });
    expect(clone.ok).toBe(false);
  });
});
