import { describe, expect, it } from "vitest";
import {
  approvedFloorplanNavigationAcceptanceDecision,
  approvedFloorplanNavigationCanAutoAccept,
} from "../src/worker/index";
import {
  finalAgreementFindingIdentity,
  finalCaptureAgreementBlockReason,
  invalidFinalAgreementResolutionIssues,
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
    elevationM: 0,
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
    expect(decision.reason).toContain("classified door_opening");
    expect(decision.reason).toContain("re-reviewing the floor plan");
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
// cannot leak onto a different wall or storey. Each case here is a concrete
// false-approval shape: stacked storeys, nearby parallel walls, corners,
// resolution reuse beyond the classified span, and the frozen-contradiction
// override the merged-pool design permitted.
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
    elevationM: 0,
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
    elevationM: 0,
    from: [4, 2],
    to: [6, 2],
    classification: "glass_wall",
    ...overrides,
  });
  const manualFor = (
    finding: Record<string, unknown>,
    classification = "glass_wall",
  ) => ({
    findingId: finalAgreementFindingIdentity(finding as never),
    classification,
    note: "Verified against the registered render during approval.",
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

  it("fails closed on a legacy resolution frozen without its storey elevation", () => {
    // Pre-elevation receipts cannot prove which storey they classified, so
    // they no longer match at all: the revision needs re-review, not a
    // matcher that guesses the floor.
    const reason = finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([crossing({})]),
      captureAgreementJson: frozen([
        { ...glassAt({}), elevationM: undefined },
      ]),
    });
    expect(reason).toContain("no frozen operator classification");
  });

  it("blocks a split-level offset beyond half a metre", () => {
    const reason = finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([crossing({ elevationM: 0.75 })]),
      captureAgreementJson: frozen([glassAt({})]),
    });
    expect(reason).toContain("no frozen operator classification");
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

  it("refuses migration onto a parallel wall even when the original is gone", () => {
    // Only ONE crossing survives, 0.8 m from the classified line and on a
    // different wall: nothing competes for the resolution, so only the
    // tightened lateral gate stops the classification from migrating.
    const reason = finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([
        crossing({ barrierId: "auto-barrier-wall-2", from: [4, 2.8], to: [6, 2.8] }),
      ]),
      captureAgreementJson: frozen([glassAt({})]),
    });
    expect(reason).toContain("no frozen operator classification");
  });

  it("lets the same reviewed wall keep its classification through a larger nudge", () => {
    // Lineage: the surviving barrier was cooked from the very wall the
    // operator classified, so the envelope is generous where a different
    // wall's would be tight.
    expect(finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([
        crossing({ barrierId: "auto-barrier-wall-9-1", from: [4, 2.8], to: [6, 2.8] }),
      ]),
      captureAgreementJson: frozen([glassAt({ barrierId: "wall-9" })]),
    })).toBeNull();
  });

  it("refuses a classification for an acute wall rotated past the angle gate", () => {
    // 20° about the same midpoint: inside the old 30° tolerance, outside the
    // tightened 15° gate for a different wall.
    const reason = finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([
        crossing({ from: [4.06, 1.66], to: [5.94, 2.34] }),
      ]),
      captureAgreementJson: frozen([glassAt({})]),
    });
    expect(reason).toContain("no frozen operator classification");
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

  it("refuses split reuse for a neighbouring wall inside the containment tolerance", () => {
    // Crossing A descends from the classified wall and consumes the frozen
    // resolution; crossing B belongs to a DIFFERENT wall 0.2 m away, fully
    // contained in the classified span longitudinally. Geometry alone cannot
    // tell a split half from a neighbour — lineage must gate the reuse.
    const reason = finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([
        crossing({ barrierId: "auto-barrier-wall-1-1", from: [4, 2], to: [4.8, 2] }),
        crossing({ barrierId: "auto-barrier-wall-2-1", from: [5.2, 2.2], to: [6, 2.2] }),
      ]),
      captureAgreementJson: frozen([glassAt({})]),
    });
    expect(reason).toContain("auto-barrier-wall-2-1");
    expect(reason).toContain("no frozen operator classification");
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

  it("keeps a frozen door decision monotonic against a better-scoring manual answer", () => {
    // The floor-plan review said this span should be OPEN. The wall still
    // stands, and the approving operator supplies a pixel-perfect glass
    // answer. The frozen contradiction must win: superseding it means
    // re-reviewing the floor plan, not out-scoring it at approval.
    const survivor = crossing({ from: [4.1, 2.3], to: [6.1, 2.3] });
    const reason = finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([survivor]),
      captureAgreementJson: frozen([glassAt({ classification: "door_opening" })]),
      manualResolutions: [manualFor(survivor)],
    });
    expect(reason).toContain("classified door_opening");
    expect(reason).toContain("re-reviewing the floor plan");
  });

  it("refuses a manual answer that restates a crossing a frozen classification covers", () => {
    const covered = crossing({});
    const reason = finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([covered]),
      captureAgreementJson: frozen([glassAt({})]),
      manualResolutions: [manualFor(covered)],
    });
    expect(reason).toContain("cannot restate or replace");
  });

  it("accepts a final-only crossing through an exact finding-id manual resolution", () => {
    const finalOnly = crossing({
      barrierId: "auto-barrier-wall-new-1",
      from: [10, 5],
      to: [12, 5],
    });
    expect(finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([finalOnly]),
      captureAgreementJson: frozen([]),
    })).toContain("no frozen operator classification");
    expect(finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([finalOnly]),
      captureAgreementJson: frozen([]),
      manualResolutions: [manualFor(finalOnly)],
    })).toBeNull();
  });

  it("refuses one manual statement stretched across two independent findings", () => {
    // A broad caller-drawn span once satisfied both crossings via
    // containment reuse; finding ids make that impossible — the second
    // finding has no resolution of its own.
    const first = crossing({ barrierId: "auto-barrier-wall-a-1", from: [10, 0], to: [11, 0] });
    const second = crossing({ barrierId: "auto-barrier-wall-b-1", from: [20, 0], to: [21, 0] });
    const reason = finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([first, second]),
      captureAgreementJson: frozen([]),
      manualResolutions: [manualFor(first)],
    });
    expect(reason).toContain("auto-barrier-wall-b-1");
  });

  it("still refuses a door classification supplied manually for a standing wall", () => {
    const survivor = crossing({});
    expect(finalCaptureAgreementBlockReason({
      captureExpected: true,
      finalAgreement: agreement([survivor]),
      captureAgreementJson: frozen([]),
      manualResolutions: [manualFor(survivor, "door_opening")],
    })).toContain("classified door_opening yet still stands");
  });

  it("rejects unknown and duplicated manual finding ids", () => {
    const survivor = crossing({});
    const issues = invalidFinalAgreementResolutionIssues(
      agreement([survivor]),
      [
        manualFor(survivor),
        manualFor(survivor, "mirror"),
        {
          findingId: "not-a-real-finding",
          classification: "glass_wall",
          note: "Names nothing in the frozen agreement.",
        },
      ] as never,
    );
    expect(issues).toHaveLength(2);
    expect(issues.some((issue) => issue.includes("more than once"))).toBe(true);
    expect(issues.some((issue) => issue.includes("not-a-real-finding"))).toBe(true);
    expect(invalidFinalAgreementResolutionIssues(
      agreement([survivor]),
      [manualFor(survivor)] as never,
    )).toHaveLength(0);
  });
});
