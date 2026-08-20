import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MINIMUM_VISITED_SAMPLES,
  openingAdjacentRoomIds,
  spanTrajectoryQualification,
  trajectoryQualifiedUnknownOpenings,
  parseTrajectoryPositions,
  proposalReportPlanLevels,
  trajectoryPlanEvidence,
  trajectoryWallCrossingCount,
  trajectoryWithinCaptureBounds,
} from "../scripts/trajectory-evidence-core.mjs";

function asciiTrajectoryPly(points) {
  return Buffer.from([
    "ply",
    "format ascii 1.0",
    `element vertex ${points.length}`,
    "property float x",
    "property float y",
    "property float z",
    "end_header",
    ...points.map(([x, y, z]) => `${x} ${y} ${z}`),
    "",
  ].join("\n"), "utf8");
}

function binaryTrajectoryPly(points) {
  const header = Buffer.from([
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${points.length}`,
    "property float x",
    "property float y",
    "property float z",
    "end_header",
    "",
  ].join("\n"), "utf8");
  const body = Buffer.alloc(points.length * 12);
  points.forEach(([x, y, z], index) => {
    body.writeFloatLE(x, index * 12);
    body.writeFloatLE(y, index * 12 + 4);
    body.writeFloatLE(z, index * 12 + 8);
  });
  return Buffer.concat([header, body]);
}

// Two rooms side by side, joined by an unknown opening in the shared wall at
// x = 4: room-a spans x 0..4, room-b spans x 4..8, both z 0..4.
const TWO_ROOM_PLAN = {
  levels: [{
    id: "level-1",
    elevationM: 0,
    rooms: [
      { id: "room-a", points: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      { id: "room-b", points: [[4, 0], [8, 0], [8, 4], [4, 4]] },
    ],
  }],
};

function walkAcrossBothRooms() {
  // Ordered carry path at eye height through the doorway.
  const points = [];
  for (let step = 0; step <= 14; step += 1) {
    points.push([0.5 + step * 0.5, 1.5, 2]);
  }
  return points;
}

describe("parseTrajectoryPositions", () => {
  it("keeps the ordered pose sequence from ascii and binary PLY alike", () => {
    const walked = walkAcrossBothRooms();
    for (const bytes of [asciiTrajectoryPly(walked), binaryTrajectoryPly(walked)]) {
      const parsed = parseTrajectoryPositions(bytes);
      assert.equal(parsed.sampledPointCount, walked.length);
      assert.equal(parsed.samplingStride, 1);
      assert.deepEqual(
        parsed.positions.map(([x]) => Math.round(x * 2) / 2),
        walked.map(([x]) => x),
      );
    }
  });

  it("rejects an empty trajectory", () => {
    assert.throws(
      () => parseTrajectoryPositions(asciiTrajectoryPly([[Number.NaN, 0, 0]])),
      /finite pose positions/,
    );
  });
});

describe("trajectoryPlanEvidence", () => {
  it("marks both rooms visited when the rig walked through the doorway", () => {
    const evidence = trajectoryPlanEvidence({
      positions: walkAcrossBothRooms(),
      plan: TWO_ROOM_PLAN,
    });
    assert.equal(evidence.schemaVersion, "trajectory-evidence-v1");
    assert.deepEqual(evidence.visitedRoomIds, [
      "level-1/room-a",
      "level-1/room-b",
    ]);
    const [level] = evidence.levels;
    assert.ok(level.rooms.every((room) =>
      room.sampleCount >= DEFAULT_MINIMUM_VISITED_SAMPLES));
  });

  it("never marks a mirror-phantom room visited: pose paths are not reflected", () => {
    // The phantom is a plausible-looking third room the point returns invented
    // beyond a mirror at x = 8; the rig only ever moved inside room-a.
    const planWithPhantom = {
      levels: [{
        id: "level-1",
        elevationM: 0,
        rooms: [
          ...TWO_ROOM_PLAN.levels[0].rooms,
          { id: "room-phantom", points: [[8, 0], [12, 0], [12, 4], [8, 4]] },
        ],
      }],
    };
    const evidence = trajectoryPlanEvidence({
      positions: walkAcrossBothRooms(),
      plan: planWithPhantom,
    });
    const phantom = evidence.levels[0].rooms.find((room) => room.roomId === "room-phantom");
    assert.equal(phantom.sampleCount, 0);
    assert.equal(phantom.visited, false);
  });

  it("assigns samples to the storey directly beneath the rig", () => {
    const twoStoreyPlan = {
      levels: [
        {
          id: "level-1",
          elevationM: 0,
          rooms: [{ id: "room-lower", points: [[0, 0], [4, 0], [4, 4], [0, 4]] }],
        },
        {
          id: "level-2",
          elevationM: 3.2,
          rooms: [{ id: "room-upper", points: [[0, 0], [4, 0], [4, 4], [0, 4]] }],
        },
      ],
    };
    const upstairsWalk = [
      [1, 4.7, 2], [2, 4.7, 2], [3, 4.7, 2], [3.5, 4.7, 2],
    ];
    const evidence = trajectoryPlanEvidence({
      positions: upstairsWalk,
      plan: twoStoreyPlan,
    });
    const lower = evidence.levels.find((level) => level.levelId === "level-1");
    const upper = evidence.levels.find((level) => level.levelId === "level-2");
    assert.equal(lower.rooms[0].visited, false);
    assert.equal(upper.rooms[0].visited, true);
  });

  it("leaves out-of-band samples unassigned instead of guessing a storey", () => {
    const evidence = trajectoryPlanEvidence({
      positions: [[1, 9.5, 2], [2, 9.5, 2], [3, 9.5, 2]],
      plan: TWO_ROOM_PLAN,
    });
    assert.equal(evidence.unassignedSampleCount, 3);
    assert.deepEqual(evidence.visitedRoomIds, []);
  });

  it("requires the visited threshold, not a single jitter sample", () => {
    const evidence = trajectoryPlanEvidence({
      positions: [
        [1, 1.5, 2], [1.2, 1.5, 2], [1.4, 1.5, 2],
        // one sample pokes across the doorway without a real visit
        [4.2, 1.5, 2],
      ],
      plan: TWO_ROOM_PLAN,
    });
    const roomB = evidence.levels[0].rooms.find((room) => room.roomId === "room-b");
    assert.equal(roomB.sampleCount, 1);
    assert.equal(roomB.visited, false);
  });

  it("is deterministic regardless of plan room order", () => {
    const reversed = {
      levels: [{
        ...TWO_ROOM_PLAN.levels[0],
        rooms: [...TWO_ROOM_PLAN.levels[0].rooms].reverse(),
      }],
    };
    const left = JSON.stringify(trajectoryPlanEvidence({
      positions: walkAcrossBothRooms(),
      plan: TWO_ROOM_PLAN,
    }));
    const right = JSON.stringify(trajectoryPlanEvidence({
      positions: walkAcrossBothRooms(),
      plan: reversed,
    }));
    assert.equal(left, right);
  });
});

describe("trajectoryWallCrossingCount", () => {
  it("counts carried-through crossings of a clutter wall span", () => {
    const crossings = trajectoryWallCrossingCount({
      positions: walkAcrossBothRooms(),
      span: { start: [4, 0], end: [4, 4] },
      elevationM: 0,
    });
    assert.equal(crossings, 1);
  });

  it("ignores crossings ridden outside the storey's carry band", () => {
    const upstairs = walkAcrossBothRooms().map(([x, , z]) => [x, 4.8, z]);
    assert.equal(trajectoryWallCrossingCount({
      positions: upstairs,
      span: { start: [4, 0], end: [4, 4] },
      elevationM: 0,
    }), 0);
  });

  it("does not count walking around the wall's free end", () => {
    // Side of the wall line changes, but the crossing lands beyond the span.
    const aroundTheEnd = [[3.5, 1.5, 5.5], [4.5, 1.5, 5.5]];
    assert.equal(trajectoryWallCrossingCount({
      positions: aroundTheEnd,
      span: { start: [4, 0], end: [4, 4] },
      elevationM: 0,
    }), 0);
  });

  it("counts a pose sample landing exactly on the wall line as one crossing", () => {
    assert.equal(trajectoryWallCrossingCount({
      positions: [[3.5, 1.5, 2], [4, 1.5, 2], [4.5, 1.5, 2]],
      span: { start: [4, 0], end: [4, 4] },
      elevationM: 0,
    }), 1);
  });

  it("does not count a path that runs alongside the wall", () => {
    const alongside = [[3.5, 1.5, 0.5], [3.5, 1.5, 3.5]];
    assert.equal(trajectoryWallCrossingCount({
      positions: alongside,
      span: { start: [4, 0], end: [4, 4] },
      elevationM: 0,
    }), 0);
  });
});

describe("openingAdjacentRoomIds", () => {
  it("resolves the two rooms an interior doorway connects", () => {
    assert.deepEqual(openingAdjacentRoomIds({
      level: TWO_ROOM_PLAN.levels[0],
      opening: { start: [4, 1.5], end: [4, 2.5] },
    }), ["room-a", "room-b"]);
  });

  it("returns a single room for an envelope window", () => {
    assert.deepEqual(openingAdjacentRoomIds({
      level: TWO_ROOM_PLAN.levels[0],
      opening: { start: [0, 1.5], end: [0, 2.5] },
    }), ["room-a"]);
  });
});

describe("proposalReportPlanLevels", () => {
  const roomProposal = (key, offsetX) => ({
    roomKey: key,
    elevationM: 0,
    geometry: {
      type: "polygon",
      points: [
        [offsetX, 0, 0], [offsetX + 4, 0, 0], [offsetX + 4, 0, 4], [offsetX, 0, 4],
      ],
    },
  });

  it("maps a v2 multi-level report through its level room keys", () => {
    const levels = proposalReportPlanLevels({
      rooms: [roomProposal("room-001", 0), roomProposal("room-002", 4)],
      levels: [
        { levelKey: "level-001", elevationM: 0, roomKeys: ["room-001"] },
        { levelKey: "level-002", elevationM: 3.2, roomKeys: ["room-002"] },
      ],
    });
    assert.deepEqual(levels.map((level) => [level.id, level.rooms.map((room) => room.id)]), [
      ["level-001", ["room-001"]],
      ["level-002", ["room-002"]],
    ]);
  });

  it("falls back to a single level for a v1 report", () => {
    const levels = proposalReportPlanLevels({
      rooms: [roomProposal("room-001", 0)],
      summary: { inferredFloorElevationM: 1.5 },
    });
    assert.equal(levels.length, 1);
    assert.equal(levels[0].elevationM, 1.5);
    assert.deepEqual(levels[0].rooms.map((room) => room.id), ["room-001"]);
  });

  it("round-trips into trajectoryPlanEvidence with 3D room points", () => {
    const evidence = trajectoryPlanEvidence({
      positions: walkAcrossBothRooms(),
      plan: {
        levels: proposalReportPlanLevels({
          rooms: [roomProposal("room-001", 0), roomProposal("room-002", 4)],
          levels: [
            { levelKey: "level-001", elevationM: 0, roomKeys: ["room-001", "room-002"] },
          ],
        }),
      },
    });
    assert.deepEqual(evidence.visitedRoomIds, [
      "level-001/room-001",
      "level-001/room-002",
    ]);
  });
});

describe("trajectoryWithinCaptureBounds", () => {
  it("accepts a pose path inside the capture and rejects a mis-registered one", () => {
    const capture = { min: [0, 0, 0], max: [8, 3, 4] };
    assert.equal(trajectoryWithinCaptureBounds(
      { min: [0.5, 1.5, 2], max: [7.5, 1.5, 2] },
      capture,
    ), true);
    assert.equal(trajectoryWithinCaptureBounds(
      { min: [40.5, 1.5, 2], max: [47.5, 1.5, 2] },
      capture,
    ), false);
  });
});

describe("trajectoryQualifiedUnknownOpenings", () => {
  const reviewPlan = {
    levels: [{
      id: "level-001",
      elevationM: 0,
      rooms: [
        { id: "room-001", points: [[0, 0], [4, 0], [4, 4], [0, 4]] },
        { id: "room-002", points: [[4, 0], [8, 0], [8, 4], [4, 4]] },
        { id: "room-phantom", points: [[8, 0], [12, 0], [12, 4], [8, 4]] },
      ],
      openings: [
        // interior doorway between the two visited rooms
        { id: "opening-001", type: "unknown", start: [4, 1.5], end: [4, 2.5] },
        // crossing into the never-visited (mirror-phantom) room
        { id: "opening-002", type: "unknown", start: [8, 1.5], end: [8, 2.5] },
        // envelope window: one neighbour only
        { id: "opening-003", type: "unknown", start: [0, 1.5], end: [0, 2.5] },
        // operator already classified this one; not the machine's to open
        { id: "opening-004", type: "window", start: [4, 3.2], end: [4, 3.8] },
      ],
    }],
  };
  const evidence = {
    schemaVersion: "trajectory-evidence-v1",
    visitedRoomIds: ["level-001/room-001", "level-001/room-002"],
  };

  it("opens only the interior doorway between two visited rooms", () => {
    assert.deepEqual(trajectoryQualifiedUnknownOpenings({
      plan: reviewPlan,
      trajectoryEvidence: evidence,
    }), [{
      levelId: "level-001",
      openingId: "opening-001",
      roomIds: ["room-001", "room-002"],
    }]);
  });

  it("fails closed without evidence or on a foreign schema version", () => {
    assert.deepEqual(trajectoryQualifiedUnknownOpenings({
      plan: reviewPlan,
      trajectoryEvidence: null,
    }), []);
    assert.deepEqual(trajectoryQualifiedUnknownOpenings({
      plan: reviewPlan,
      trajectoryEvidence: { ...evidence, schemaVersion: "trajectory-evidence-v2" },
    }), []);
  });

  it("never opens a span whose far room the scanner did not visit", () => {
    const verdict = spanTrajectoryQualification({
      level: reviewPlan.levels[0],
      levelId: "level-001",
      span: { start: [8, 1.5], end: [8, 2.5] },
      visitedRoomIds: evidence.visitedRoomIds,
    });
    assert.equal(verdict.qualified, false);
    assert.equal(verdict.reason, "adjacent_room_unvisited");
  });

  it("never opens an envelope span with a single neighbour", () => {
    const verdict = spanTrajectoryQualification({
      level: reviewPlan.levels[0],
      levelId: "level-001",
      span: { start: [0, 1.5], end: [0, 2.5] },
      visitedRoomIds: evidence.visitedRoomIds,
    });
    assert.equal(verdict.qualified, false);
    assert.equal(verdict.reason, "envelope_or_unmodelled");
  });
});
