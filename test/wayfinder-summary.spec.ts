// Wayfinder (#35): the revision-card summary — machine-attested changes with
// their ratification path, and the sealed-cost line that makes the
// conservative default's price visible.
import { describe, expect, it } from "vitest";
import { wayfinderRevisionSummaryLines } from "../src/client/wayfinder-summary";

const planWithUnknowns = JSON.stringify({
  levels: [{
    openings: [
      { type: "door" },
      { type: "unknown" },
      { type: "unknown" },
      { type: "unknown" },
      { type: "window" },
    ],
  }],
});

describe("wayfinderRevisionSummaryLines", () => {
  it("reports machine changes with the ratification path and the sealed remainder", () => {
    const lines = wayfinderRevisionSummaryLines({
      plan_json: planWithUnknowns,
      trajectory_evidence_json: JSON.stringify({
        evidence: { trajectory: { sha256: "ab".repeat(32) } },
        qualifiedOpenings: [
          { openingId: "opening-002", roomIds: ["room-001", "room-002"] },
        ],
        demotedWalls: [
          { wallId: "wall-007", crossingCount: 2, roomId: "room-001" },
        ],
      }),
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ tone: "machine" });
    expect(lines[0]!.text).toContain("1 opening opened");
    expect(lines[0]!.text).toContain("opening-002: room-001 ↔ room-002");
    expect(lines[0]!.text).toContain("1 clutter wall removed");
    expect(lines[0]!.text).toContain("passed through 2×");
    expect(lines[0]!.text).toContain("structure correction draft");
    expect(lines[1]).toMatchObject({ tone: "sealed" });
    expect(lines[1]!.text).toContain("2 unresolved openings remain sealed");
  });

  it("shows the sealed-cost line alone for a conservative approval without evidence", () => {
    const lines = wayfinderRevisionSummaryLines({ plan_json: planWithUnknowns });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ tone: "sealed" });
    expect(lines[0]!.text).toContain("3 unresolved openings remain sealed");
  });

  it("stays silent for a fully classified plan", () => {
    expect(wayfinderRevisionSummaryLines({
      plan_json: JSON.stringify({ levels: [{ openings: [{ type: "door" }] }] }),
    })).toEqual([]);
  });

  it("surfaces an unreadable frozen blob instead of hiding it", () => {
    const lines = wayfinderRevisionSummaryLines({
      plan_json: planWithUnknowns,
      trajectory_evidence_json: "not json",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toContain("unreadable");
  });

  it("returns nothing for an unparseable plan", () => {
    expect(wayfinderRevisionSummaryLines({ plan_json: "broken" })).toEqual([]);
  });
});
