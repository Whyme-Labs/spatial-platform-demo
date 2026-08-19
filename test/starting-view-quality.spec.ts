import { describe, expect, it } from "vitest";
import {
  parseStartingViewQualityMetrics,
  STARTING_VIEW_MAX_NEAR_BLACK_FRACTION,
  STARTING_VIEW_MIN_RENDERED_COVERAGE_FRACTION,
  STARTING_VIEW_QUALITY_SCHEMA_VERSION,
  startingViewQualityViolations,
  startingViewQualityWarnings,
  type StartingViewQualityMetrics,
} from "../src/shared/starting-view-quality";
import { releaseInputSchema } from "../src/worker/contracts";

function metrics(
  overrides: Partial<StartingViewQualityMetrics> = {},
): StartingViewQualityMetrics {
  return {
    schemaVersion: STARTING_VIEW_QUALITY_SCHEMA_VERSION,
    capturedAt: "2026-08-19T08:00:00.000Z",
    frame: { width: 1280, height: 720, sampledPixels: 57_600 },
    nearBlackFraction: 0.2,
    meanLuminance: 0.31,
    renderedCoverageFraction: 0.8,
    ...overrides,
  };
}

const capturedPose = {
  position: [1, 1.6, 2] as [number, number, number],
  target: [4, 1.6, 2] as [number, number, number],
  up: [0, 1, 0] as [number, number, number],
  fovDegrees: 58,
};

function releaseRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "gated-starting-view",
    accessPolicy: "unlisted",
    viewerConfig: {
      title: "Gated starting view",
      measurementDisclaimer: "Visual experience only.",
      initialCamera: capturedPose,
    },
    startingViewQuality: { ...metrics(), cameraPose: capturedPose },
    ...overrides,
  };
}

describe("startingViewQualityViolations", () => {
  it("accepts a starting view that frames visible content", () => {
    expect(startingViewQualityViolations(metrics())).toEqual([]);
  });

  it("accepts a view exactly at both tripwires", () => {
    expect(startingViewQualityViolations(metrics({
      nearBlackFraction: STARTING_VIEW_MAX_NEAR_BLACK_FRACTION,
      renderedCoverageFraction: STARTING_VIEW_MIN_RENDERED_COVERAGE_FRACTION,
    }))).toEqual([]);
  });

  it("names the near-black measurement and its limit when the view frames the void", () => {
    const violations = startingViewQualityViolations(metrics({
      nearBlackFraction: 0.97,
      meanLuminance: 0.042,
      renderedCoverageFraction: 0.5,
    }));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("mostly unreconstructed space");
    expect(violations[0]).toContain("97%");
    expect(violations[0]).toContain("85%");
  });

  it("names the coverage measurement and its floor when almost nothing rendered", () => {
    const violations = startingViewQualityViolations(metrics({
      renderedCoverageFraction: 0.03,
    }));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("almost no reconstructed content");
    expect(violations[0]).toContain("3%");
    expect(violations[0]).toContain("10%");
  });

  it("reports both failures for a fully void view", () => {
    expect(startingViewQualityViolations(metrics({
      nearBlackFraction: 1,
      meanLuminance: 0.041,
      renderedCoverageFraction: 0,
    }))).toHaveLength(2);
  });
});

describe("startingViewQualityWarnings", () => {
  it("stays silent for a clearly good view", () => {
    expect(startingViewQualityWarnings(metrics())).toEqual([]);
  });

  it("warns inside the soft band without blocking", () => {
    const soft = metrics({
      nearBlackFraction: 0.7,
      meanLuminance: 0.05,
      renderedCoverageFraction: 0.2,
    });
    expect(startingViewQualityViolations(soft)).toEqual([]);
    expect(startingViewQualityWarnings(soft)).toHaveLength(3);
  });

  it("yields to the hard violation instead of duplicating it", () => {
    expect(startingViewQualityWarnings(metrics({
      nearBlackFraction: 0.97,
      renderedCoverageFraction: 0.05,
    }))).toEqual([]);
  });
});

describe("parseStartingViewQualityMetrics", () => {
  it("round-trips renderer metrics", () => {
    expect(parseStartingViewQualityMetrics(metrics())).toEqual(metrics());
  });

  it.each([
    ["null", null],
    ["wrong schema version", metrics({ schemaVersion: "starting-view-quality-v0" as never })],
    ["fraction above one", metrics({ nearBlackFraction: 1.2 })],
    ["negative luminance", metrics({ meanLuminance: -0.1 })],
    ["undersampled frame", metrics({ frame: { width: 16, height: 16, sampledPixels: 256 } })],
    ["unparsable timestamp", metrics({ capturedAt: "yesterday" })],
  ])("rejects %s", (_label, value) => {
    expect(parseStartingViewQualityMetrics(value)).toBeNull();
  });
});

describe("releaseInputSchema starting-view receipts", () => {
  it("accepts a receipt bound to the exact published starting camera", () => {
    const result = releaseInputSchema.safeParse(releaseRequest());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startingViewQuality?.nearBlackFraction).toBe(0.2);
    }
  });

  it("keeps the older no-starting-view flow working without a receipt", () => {
    expect(releaseInputSchema.safeParse({
      slug: "no-starting-view",
      accessPolicy: "unlisted",
      viewerConfig: {
        title: "No starting view",
        measurementDisclaimer: "Visual experience only.",
      },
    }).success).toBe(true);
  });

  it("rejects a receipt without the starting camera it claims to measure", () => {
    const request = releaseRequest();
    delete (request.viewerConfig as Record<string, unknown>).initialCamera;
    const result = releaseInputSchema.safeParse(request);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.startingViewQuality?.[0])
        .toContain("requires the starting camera");
    }
  });

  it("rejects a receipt that measured a different pose than the one published", () => {
    const result = releaseInputSchema.safeParse(releaseRequest({
      startingViewQuality: {
        ...metrics(),
        cameraPose: { ...capturedPose, position: [9, 1.6, 2] },
      },
    }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.startingViewQuality?.[0])
        .toContain("exact starting camera");
    }
  });

  it("rejects an undersampled receipt outright", () => {
    expect(releaseInputSchema.safeParse(releaseRequest({
      startingViewQuality: {
        ...metrics({ frame: { width: 16, height: 16, sampledPixels: 256 } }),
        cameraPose: capturedPose,
      },
    })).success).toBe(false);
  });
});
