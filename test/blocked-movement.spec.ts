import { describe, expect, it } from "vitest";
import { blockedMovementMessage } from "../src/renderer/blocked-movement";

describe("blocked movement verdicts", () => {
  it("names the reviewed wall a contact belongs to", () => {
    expect(blockedMovementMessage({ id: "east-wall", kind: "structural" }))
      .toBe("Blocked by east-wall · reviewed structural wall");
  });

  it("reports the reviewed wall behind a cooked barrier segment, not the cook's numbering", () => {
    expect(blockedMovementMessage({ id: "auto-barrier-wall-041-2", kind: "structural" }))
      .toBe("Blocked by wall-041 · automatic structural wall");
  });

  it("distinguishes doors, furniture, and no-go volumes", () => {
    expect(blockedMovementMessage({ id: "door-to-far-side", kind: "dynamic" }))
      .toBe("Blocked by door-to-far-side · this door is closed");
    expect(blockedMovementMessage({ id: "cabinet", kind: "solid_furniture" }))
      .toBe("Blocked by cabinet · solid furniture");
    expect(blockedMovementMessage({ id: "plant-room", kind: "no_go" }))
      .toBe("Blocked by plant-room · reviewed no-go volume");
  });

  // The three authorities that can refuse a step read identically from inside
  // the scene, so each has to name itself. These two are the ones a cluttered
  // capture produces, and they call for opposite responses.
  it("says the walking map held clearance when cooked floor continues past the stop", () => {
    const message = blockedMovementMessage(null, "navigation_map_clearance");
    expect(message).toContain("Stopped by the walking map");
    expect(message).toContain("captured floor continues here");
  });

  it("says the capture ran out when there is no floor beyond the stop", () => {
    const expected =
      "Stopped at the edge of the captured floor · the scanner never walked past here";
    expect(blockedMovementMessage(null, "capture_edge")).toBe(expected);
    // Losing footing mid-step is the same fact arriving by a different route.
    expect(blockedMovementMessage(null, "unsupported_floor")).toBe(expected);
  });

  it("never blames the capture when a barrier was actually touched", () => {
    // A navmesh clamp and a wall contact can coexist; the wall is the specific
    // answer and must win, or the operator is sent to re-scan a space that has
    // a wall standing in it.
    expect(blockedMovementMessage({ id: "east-wall", kind: "structural" }, "capture_edge"))
      .toBe("Blocked by east-wall · reviewed structural wall");
    expect(
      blockedMovementMessage(
        { id: "east-wall", kind: "structural" },
        "navigation_map_clearance",
      ),
    ).toBe("Blocked by east-wall · reviewed structural wall");
  });

  it("keeps the reviewed capture ring and movement bounds distinguishable", () => {
    expect(blockedMovementMessage({ id: "auto-capture-ring-1", kind: "structural" }))
      .toBe("Blocked at the reviewed edge of the captured world");
    expect(blockedMovementMessage(null, "outside_recovery_bounds"))
      .toBe("Stopped at the edge of the reviewed movement bounds");
  });

  it("falls back to the generic verdict rather than guessing a cause", () => {
    const generic = "Blocked by the walking map · this surface has no reviewed opening";
    expect(blockedMovementMessage(null)).toBe(generic);
    expect(blockedMovementMessage(null, "unknown")).toBe(generic);
  });
});
