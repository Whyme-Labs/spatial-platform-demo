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
});
