import { describe, expect, it } from "vitest";
import {
  approvedFloorplanNavigationAcceptanceDecision,
  approvedFloorplanNavigationCanAutoAccept,
} from "../src/worker/index";

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
});
