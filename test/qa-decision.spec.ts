import { describe, expect, it } from "vitest";

import { qaDecisionSchema } from "../src/worker/contracts";

const baseDecision = {
  webAssetId: "00000000-0000-4000-8000-000000000001",
  visualGrade: "C" as const,
  privacyStatus: "approved" as const,
  measurementGrade: "visual-only" as const,
};

describe("QA decision contract", () => {
  it("requires an explicit acceptance note for a conditional visual decision", () => {
    expect(qaDecisionSchema.safeParse(baseDecision).success).toBe(false);
    expect(qaDecisionSchema.safeParse({ ...baseDecision, notes: "   " }).success).toBe(false);
    expect(qaDecisionSchema.safeParse({ ...baseDecision, notes: "Client accepted the doorway edge artifact." }).success).toBe(true);
  });

  it("does not require a note for client-ready or acceptable decisions", () => {
    expect(qaDecisionSchema.safeParse({ ...baseDecision, visualGrade: "A" }).success).toBe(true);
    expect(qaDecisionSchema.safeParse({ ...baseDecision, visualGrade: "B" }).success).toBe(true);
  });

  it("keeps metric claims out of Fly-only approval", () => {
    const visual = { ...baseDecision, visualGrade: "B", viewingMode: "fly-only" };
    expect(qaDecisionSchema.safeParse(visual).success).toBe(true);
    expect(qaDecisionSchema.safeParse({ ...visual, measurementGrade: "indicative" }).success).toBe(false);
    expect(qaDecisionSchema.safeParse({ ...visual, privacyStatus: "pending" }).success).toBe(false);
  });
});
