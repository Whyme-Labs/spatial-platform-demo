import { describe, expect, it } from "vitest";
import {
  attributeBlockedBarrier,
  type AttributableBarrierSegment,
} from "../src/renderer/barrier-attribution";

// A stopped walker is told which reviewed wall stopped them. These fixtures
// pin the corner cases where nearest-centreline attribution names the wrong
// wall: junctions, acute meetings, thick walls beside thin ones, and genuine
// ties where saying nothing beats a confident wrong answer.
const TOLERANCE = 0.4;

const wall = (
  id: string,
  start: [number, number],
  end: [number, number],
  thicknessM?: number,
): AttributableBarrierSegment => ({
  id,
  start,
  end,
  minY: 0,
  maxY: 3,
  ...(thicknessM !== undefined ? { thicknessM } : {}),
});

describe("blocked-barrier attribution", () => {
  const eastWest = wall("north-wall", [0, 0], [10, 0]);
  const northSouth = wall("west-wall", [0, 0], [0, 10]);

  it("names the wall whose face the walker is pushing against at a 90° corner", () => {
    // Contact near the corner, equidistant-ish from both walls, but the
    // contact normal points along -Z: the walker is pressing the east-west
    // wall's face.
    const id = attributeBlockedBarrier(
      [eastWest, northSouth],
      [0.3, 1, 0.25],
      [0, 0, 1],
      TOLERANCE,
    );
    expect(id).toBe("north-wall");
  });

  it("names the stem wall at a T-junction when the normal faces it", () => {
    const stem = wall("stem-wall", [5, 0], [5, 6]);
    const id = attributeBlockedBarrier(
      [eastWest, stem],
      [5.2, 1, 0.3],
      [1, 0, 0],
      TOLERANCE,
    );
    expect(id).toBe("stem-wall");
  });

  it("separates an acute 30° meeting by contact normal", () => {
    const acute = wall(
      "acute-wall",
      [0, 0],
      [10 * Math.cos(Math.PI / 6), 10 * Math.sin(Math.PI / 6)],
    );
    // Standing south of the east-west wall, pushing north against its face.
    const id = attributeBlockedBarrier(
      [eastWest, acute],
      [1.2, 1, 0.2],
      [0, 0, 1],
      TOLERANCE,
    );
    expect(id).toBe("north-wall");
  });

  it("measures a thick wall from its face when a thin wall stands nearby", () => {
    // The contact sits 0.1 from the thick wall's face (centreline 0.5 away)
    // and 0.35 from the thin wall's line. Centreline distance would name the
    // thin wall; face distance names the thick one the walker is touching.
    const thick = wall("thick-wall", [0, 0], [10, 0], 0.8);
    const thin = wall("thin-wall", [0, 0.85], [10, 0.85]);
    const id = attributeBlockedBarrier(
      [thick, thin],
      [5, 1, 0.5],
      [0, 0, 1],
      TOLERANCE,
    );
    expect(id).toBe("thick-wall");
  });

  it("declines to answer when two different walls genuinely tie", () => {
    // A diagonal push into the corner touches both faces at once; either
    // answer would send the operator to a 50/50 wall.
    const id = attributeBlockedBarrier(
      [eastWest, northSouth],
      [0.2, 1, 0.2],
      [Math.SQRT1_2, 0, Math.SQRT1_2],
      TOLERANCE,
    );
    expect(id).toBeNull();
  });

  it("stays ambiguous when a rival wall hides behind two segments of the winner", () => {
    // Both of wall-7's split segments outscore wall-8's, but wall-8 is well
    // inside the ambiguity margin of the winner: comparing raw segments
    // would crowd it out of the top two and answer confidently anyway.
    const winnerFirst = wall("auto-barrier-wall-7-1", [0, 0], [4, 0]);
    const winnerSecond = wall("auto-barrier-wall-7-2", [4.01, 0], [8, 0]);
    const rival = wall("auto-barrier-wall-8-1", [4, 0.02], [4, 6]);
    const id = attributeBlockedBarrier(
      [winnerFirst, winnerSecond, rival],
      [4, 1, 0],
      null,
      TOLERANCE,
    );
    expect(id).toBeNull();
  });

  it("keeps naming the wall when the tied candidates are segments of that same wall", () => {
    const first = wall("auto-barrier-wall-7-1", [0, 0], [4, 0]);
    const second = wall("auto-barrier-wall-7-2", [4.01, 0], [8, 0]);
    const id = attributeBlockedBarrier(
      [first, second],
      [4.005, 1, 0.2],
      [0, 0, 1],
      TOLERANCE,
    );
    expect(id).toBe("auto-barrier-wall-7-1");
  });

  it("ignores walls whose vertical range does not contain the contact", () => {
    const upper = wall("upper-wall", [0, 0], [10, 0]);
    upper.minY = 3;
    upper.maxY = 6;
    expect(attributeBlockedBarrier([upper], [5, 1, 0.2], [0, 0, 1], TOLERANCE))
      .toBeNull();
  });

  it("returns nothing when every candidate is beyond the tolerance", () => {
    expect(attributeBlockedBarrier([eastWest], [5, 1, 2], [0, 0, 1], TOLERANCE))
      .toBeNull();
  });
});
