import { describe, expect, it } from "vitest";
import {
  approvedFloorplanNavigationAcceptanceDecision,
  approvedFloorplanNavigationCanAutoAccept,
} from "../src/worker/index";
import {
  finalCaptureAgreementBlockReason,
  unmatchedFinalAgreementResolutions,
} from "../src/worker/contracts";

const planHash = "b".repeat(64);
const automaticParameters = {
  automaticLayout: {
    schemaVersion: "automatic-floorplan-layout-v2",
    floorplanExtractionId: crypto.randomUUID(),
    floorplanRevisionId: crypto.randomUUID(),
    planHash,
  },
};

describe("automatic navigation acceptance", () => {
  it("does not accept proposal-only navigation evidence", () => {
    expect(approvedFloorplanNavigationCanAutoAccept({
      automaticLayout: {
        schemaVersion: "automatic-floorplan-layout-v2",
        floorplanExtractionId: crypto.randomUUID(),
        proposalHash: "a".repeat(64),
      },
    })).toBe(false);
  });

  it("accepts the final build bound to an approved immutable floor-plan revision", () => {
    expect(approvedFloorplanNavigationCanAutoAccept(automaticParameters)).toBe(true);
  });

  it("accepts only the current approved revision and exact frozen authoring state", () => {
    expect(approvedFloorplanNavigationAcceptanceDecision({
      parameters: automaticParameters,
      revision: { status: "approved", planHash },
      frozenAuthoringHash: "c".repeat(64),
      currentAuthoringHash: "c".repeat(64),
    })).toMatchObject({ approved: true });
  });

  it("blocks a build whose floor-plan revision was superseded while it ran", () => {
    expect(approvedFloorplanNavigationAcceptanceDecision({
      parameters: automaticParameters,
      revision: { status: "superseded", planHash },
      frozenAuthoringHash: "c".repeat(64),
      currentAuthoringHash: "c".repeat(64),
    })).toMatchObject({
      approved: false,
      reason: expect.stringContaining("no longer current"),
    });
  });

  it("names both hashes when the approved plan changes", () => {
    const decision = approvedFloorplanNavigationAcceptanceDecision({
      parameters: automaticParameters,
      revision: { status: "approved", planHash: "d".repeat(64) },
      frozenAuthoringHash: "c".repeat(64),
      currentAuthoringHash: "c".repeat(64),
    });
    expect(decision).toMatchObject({ approved: false });
    expect(decision.reason).toContain(`expected_plan_hash=${planHash}`);
    expect(decision.reason).toContain(`asked_plan_hash=${"d".repeat(64)}`);
  });

  it("names both hashes when authoring changes while the navigation build runs", () => {
    const decision = approvedFloorplanNavigationAcceptanceDecision({
      parameters: automaticParameters,
      revision: { status: "approved", planHash },
      frozenAuthoringHash: "c".repeat(64),
      currentAuthoringHash: "e".repeat(64),
    });
    expect(decision).toMatchObject({ approved: false });
    expect(decision.reason).toContain(`expected_authoring_hash=${"c".repeat(64)}`);
    expect(decision.reason).toContain(`asked_authoring_hash=${"e".repeat(64)}`);
  });

  const crossingFinding = {
    kind: "barrier_crosses_open_capture",
    barrierId: "wall-001",
    levelKey: "level-001",
    spanCount: 4,
    metres: 1.2,
    from: [1.5, 0],
    to: [2.7, 0],
    maximumSpanPoints: 0,
  };
  const agreementReport = {
    schemaVersion: "shell-capture-agreement-v1",
    pointSource: "voxel-centroids",
    wallBandAboveFloorM: [1, 2],
    settings: {},
    capturePointsInBand: 1_000,
    barrierCount: 4,
    inspectedBarrierCount: 4,
    findings: [crossingFinding],
    limitations: [],
  };
  const crossingResolution = {
    barrierId: "wall-001",
    levelKey: "level-001",
    from: [1.5, 0],
    to: [2.7, 0],
    classification: "glass_wall",
  };

  it("blocks acceptance when the capture disputes a wall with no frozen classification", () => {
    const decision = approvedFloorplanNavigationAcceptanceDecision({
      parameters: automaticParameters,
      revision: {
        status: "approved",
        planHash,
        captureAgreementJson: JSON.stringify({ report: agreementReport, resolutions: [] }),
      },
      frozenAuthoringHash: "c".repeat(64),
      currentAuthoringHash: "c".repeat(64),
    });
    expect(decision).toMatchObject({ approved: false });
    expect(decision.reason).toContain("capture disputes");
    expect(decision.reason).toContain("wall-001");
  });

  it("accepts once every crossing finding carries its frozen operator classification", () => {
    const decision = approvedFloorplanNavigationAcceptanceDecision({
      parameters: automaticParameters,
      revision: {
        status: "approved",
        planHash,
        captureAgreementJson: JSON.stringify({
          report: agreementReport,
          resolutions: [crossingResolution],
        }),
      },
      frozenAuthoringHash: "c".repeat(64),
      currentAuthoringHash: "c".repeat(64),
    });
    expect(decision).toMatchObject({ approved: true });
    expect(decision.reason).toContain("capture-agreement");
  });

  it("fails closed on an unreadable frozen capture agreement", () => {
    expect(approvedFloorplanNavigationAcceptanceDecision({
      parameters: automaticParameters,
      revision: { status: "approved", planHash, captureAgreementJson: "{not json" },
      frozenAuthoringHash: "c".repeat(64),
      currentAuthoringHash: "c".repeat(64),
    })).toMatchObject({
      approved: false,
      reason: expect.stringContaining("unreadable"),
    });
  });

  it("accepts revisions that predate the capture agreement", () => {
    expect(approvedFloorplanNavigationAcceptanceDecision({
      parameters: automaticParameters,
      revision: { status: "approved", planHash, captureAgreementJson: null },
      frozenAuthoringHash: "c".repeat(64),
      currentAuthoringHash: "c".repeat(64),
    })).toMatchObject({ approved: true });
  });

  const capturePinnedParameters = {
    automaticLayout: {
      ...automaticParameters.automaticLayout,
      capture: {
        assetId: crypto.randomUUID(),
        sourceFormat: "ply",
        sourceUpAxis: "y",
      },
    },
  };
  const finalAgreement = (findings: unknown[]) => ({
    schemaVersion: "shell-capture-agreement-v1",
    scope: "final-structural-barriers",
    pointSource: "voxel-centroids",
    wallBandAboveFloorM: [1, 2],
    settings: {},
    capturePointsInBand: 2_000,
    barrierCount: 6,
    inspectedBarrierCount: 6,
    findings,
    limitations: [],
  });
  const finalCrossing = {
    kind: "barrier_crosses_open_capture",
    barrierId: "auto-barrier-wall-2-1",
    levelKey: null,
    elevationM: 0,
    spanCount: 3,
    metres: 0.9,
    from: [1.6, 0],
    to: [2.4, 0],
    maximumSpanPoints: 1,
  };
  const frozenWith = (classification: string) => JSON.stringify({
    report: agreementReport,
    resolutions: [{ ...crossingResolution, classification }],
  });

  it("blocks a capture-pinned build that carries no final agreement", () => {
    const decision = approvedFloorplanNavigationAcceptanceDecision({
      parameters: capturePinnedParameters,
      revision: {
        status: "approved",
        planHash,
        captureAgreementJson: frozenWith("glass_wall"),
      },
      frozenAuthoringHash: "c".repeat(64),
      currentAuthoringHash: "c".repeat(64),
    });
    expect(decision).toMatchObject({ approved: false });
    expect(decision.reason).toContain("no readable final capture agreement");
  });

  it("blocks a final crossing on a wall added after classification", () => {
    const decision = approvedFloorplanNavigationAcceptanceDecision({
      parameters: capturePinnedParameters,
      revision: {
        status: "approved",
        planHash,
        captureAgreementJson: frozenWith("glass_wall"),
      },
      frozenAuthoringHash: "c".repeat(64),
      currentAuthoringHash: "c".repeat(64),
      finalCaptureAgreement: finalAgreement([{
        ...finalCrossing,
        barrierId: "auto-barrier-wall-added-1",
        from: [8.5, 4],
        to: [9.4, 4],
      }]),
    });
    expect(decision).toMatchObject({ approved: false });
    expect(decision.reason).toContain("no frozen operator classification");
  });

  it("blocks a door classification whose wall still stands across open capture", () => {
    const decision = approvedFloorplanNavigationAcceptanceDecision({
      parameters: capturePinnedParameters,
      revision: {
        status: "approved",
        planHash,
        captureAgreementJson: frozenWith("door_opening"),
      },
      frozenAuthoringHash: "c".repeat(64),
      currentAuthoringHash: "c".repeat(64),
      finalCaptureAgreement: finalAgreement([finalCrossing]),
    });
    expect(decision).toMatchObject({ approved: false });
    expect(decision.reason).toContain("classified door_opening yet still stands");
  });

  it("accepts a wall-affirming classification covering the surviving crossing", () => {
    expect(approvedFloorplanNavigationAcceptanceDecision({
      parameters: capturePinnedParameters,
      revision: {
        status: "approved",
        planHash,
        captureAgreementJson: frozenWith("glass_wall"),
      },
      frozenAuthoringHash: "c".repeat(64),
      currentAuthoringHash: "c".repeat(64),
      finalCaptureAgreement: finalAgreement([finalCrossing]),
    })).toMatchObject({ approved: true });
  });

  it("accepts a clean final agreement after the operator opened the doorway", () => {
    expect(approvedFloorplanNavigationAcceptanceDecision({
      parameters: capturePinnedParameters,
      revision: {
        status: "approved",
        planHash,
        captureAgreementJson: frozenWith("door_opening"),
      },
      frozenAuthoringHash: "c".repeat(64),
      currentAuthoringHash: "c".repeat(64),
      finalCaptureAgreement: finalAgreement([]),
    })).toMatchObject({ approved: true });
  });
});

// The reconciliation matcher must be strict enough that one classification
// cannot leak onto a different wall. Each case here is a concrete
// false-approval shape: stacked storeys, nearby parallel walls, corners,
// and resolution reuse beyond the classified span.
describe("final capture-agreement geometry matching", () => {
  const agreement = (findings: unknown[]) => ({
    schemaVersion: "shell-capture-agreement-v1",
    scope: "final-structural-barriers",
    pointSource: "voxel-centroids",
    wallBandAboveFloorM: [1, 2],
    settings: {},
    capturePointsInBand: 2_000,
    barrierCount: 6,
    inspectedBarrierCount: 6,
    findings,
    limitations: [],
  });
  const crossing = (overrides: Record<string, unknown>) => ({
    kind: "barrier_crosses_open_capture",
    barrierId: "auto-barrier-wall-1",
    levelKey: null,
    spanCount: 3,
    metres: 0.9,
    from: [4, 2],
    to: [6, 2],
    maximumSpanPoints: 1,
    ...overrides,
  });
  const frozen = (resolutions: unknown[]) => JSON.stringify({
    report: null,
    resolutions,
  });
  const glassAt = (overrides: Record<string, unknown>) => ({
    barrierId: "wall-1",
    from: [4, 2],
    to: [6, 2],
    classification: "glass_wall",
    ...overrides,
  });

  it("refuses to replay a ground-floor classification onto the storey above", () => {
    const reason = finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([
        crossing({ elevationM: 0 }),
        crossing({ barrierId: "auto-barrier-wall-up-1", elevationM: 3 }),
      ]),
      captureAgreementJson: frozen([glassAt({ elevationM: 0 })]),
    });
    expect(reason).toContain("auto-barrier-wall-up-1");
    expect(reason).toContain("no frozen operator classification");
  });

  it("matches classifications without elevation the way pre-elevation receipts froze them", () => {
    expect(finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([crossing({ elevationM: 0 })]),
      captureAgreementJson: frozen([glassAt({})]),
    })).toBeNull();
  });

  it("refuses one classification for two nearby parallel walls", () => {
    const reason = finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([
        crossing({ from: [4, 2], to: [6, 2] }),
        crossing({ barrierId: "auto-barrier-wall-2", from: [4, 2.8], to: [6, 2.8] }),
      ]),
      captureAgreementJson: frozen([glassAt({})]),
    });
    expect(reason).toContain("auto-barrier-wall-2");
  });

  it("refuses a classification for the perpendicular wall through the same midpoint", () => {
    const reason = finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([
        crossing({ from: [5, 1], to: [5, 3] }),
      ]),
      captureAgreementJson: frozen([glassAt({})]),
    });
    expect(reason).toContain("no frozen operator classification");
  });

  it("lets one classification cover both halves of the wall an opening split", () => {
    expect(finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([
        crossing({ from: [4, 2], to: [4.8, 2] }),
        crossing({ barrierId: "auto-barrier-wall-1-2", from: [5.2, 2], to: [6, 2] }),
      ]),
      captureAgreementJson: frozen([glassAt({})]),
    })).toBeNull();
  });

  it("refuses reuse on a second crossing outside the classified span", () => {
    const reason = finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([
        crossing({ from: [4, 2], to: [6, 2] }),
        crossing({ barrierId: "auto-barrier-wall-far-1", from: [6.8, 2], to: [8.4, 2] }),
      ]),
      captureAgreementJson: frozen([glassAt({})]),
    });
    expect(reason).toContain("auto-barrier-wall-far-1");
  });

  it("matches a span recorded with reversed endpoints", () => {
    expect(finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([crossing({ from: [6, 2], to: [4, 2] })]),
      captureAgreementJson: frozen([glassAt({})]),
    })).toBeNull();
  });

  it("matches a wall the operator nudged without re-classifying", () => {
    expect(finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([crossing({ from: [4.1, 2.3], to: [6.1, 2.3] })]),
      captureAgreementJson: frozen([glassAt({})]),
    })).toBeNull();
  });

  it("accepts a final-only crossing through an explicit manual resolution", () => {
    const finalOnly = agreement([
      crossing({ barrierId: "auto-barrier-wall-new-1", from: [10, 5], to: [12, 5] }),
    ]);
    expect(finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: finalOnly,
      captureAgreementJson: frozen([]),
    })).toContain("no frozen operator classification");
    expect(finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: finalOnly,
      captureAgreementJson: frozen([]),
      additionalResolutions: [
        glassAt({ barrierId: "wall-new", from: [10, 5], to: [12, 5] }) as never,
      ],
    })).toBeNull();
  });

  it("still refuses a door classification supplied manually for a standing wall", () => {
    expect(finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([crossing({})]),
      captureAgreementJson: frozen([]),
      additionalResolutions: [
        glassAt({ classification: "door_opening" }) as never,
      ],
    })).toContain("classified door_opening yet still stands");
  });

  it("rejects manual resolutions that resolve no actual final crossing", () => {
    const unmatched = unmatchedFinalAgreementResolutions(
      agreement([crossing({})]),
      [glassAt({ barrierId: "wall-elsewhere", from: [40, 40], to: [42, 40] }) as never],
    );
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]).toContain("wall-elsewhere");
    expect(unmatchedFinalAgreementResolutions(
      agreement([crossing({})]),
      [glassAt({}) as never],
    )).toHaveLength(0);
  });
});
