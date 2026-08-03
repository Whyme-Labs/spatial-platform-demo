import { describe, expect, it } from "vitest";
import {
  appendSceneAuthoringPick,
  sceneAuthoringGeometry,
  type SceneAuthoringSession,
} from "../src/renderer/scene-authoring";

describe("render-native scene authoring", () => {
  it("rejects non-finite raycast positions and keeps the last valid evidence", () => {
    const initial: SceneAuthoringSession = {
      mode: "wall",
      requestId: "wall-1",
      points: [[1, 0, 2]],
    };
    expect(appendSceneAuthoringPick(initial, [Number.NaN, 0, 3])).toEqual(initial);
  });

  it("turns two rendered picks into wall evidence without inventing coordinates", () => {
    const first = appendSceneAuthoringPick({
      mode: "wall",
      requestId: "wall-1",
      points: [],
    }, [1, 0.1, 2]);
    const complete = appendSceneAuthoringPick(first, [4, 0.2, 2]);
    expect(sceneAuthoringGeometry(complete)).toEqual({
      kind: "wall",
      points: [[1, 0.1, 2], [4, 0.2, 2]],
      complete: true,
    });
  });

  it("requires three rendered picks before a room polygon can be finished", () => {
    let session: SceneAuthoringSession = {
      mode: "room",
      requestId: "room-1",
      points: [],
    };
    session = appendSceneAuthoringPick(session, [0, 0, 0]);
    session = appendSceneAuthoringPick(session, [4, 0, 0]);
    expect(sceneAuthoringGeometry(session).complete).toBe(false);
    session = appendSceneAuthoringPick(session, [4, 0, 3]);
    expect(sceneAuthoringGeometry(session)).toMatchObject({
      kind: "room",
      complete: true,
      points: [[0, 0, 0], [4, 0, 0], [4, 0, 3]],
    });
  });

  it("requires a four-point rendered surface for a stair or ramp connector", () => {
    const threePoints: SceneAuthoringSession = {
      mode: "connector",
      requestId: "connector-1",
      points: [[0, 0, 0], [2, 0, 0], [2, 2.8, 3]],
    };
    expect(sceneAuthoringGeometry(threePoints).complete).toBe(false);
    expect(sceneAuthoringGeometry(
      appendSceneAuthoringPick(threePoints, [0, 2.8, 3]),
    ).complete).toBe(true);
  });
});
