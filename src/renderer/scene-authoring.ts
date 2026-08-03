import type { Vector3Tuple } from "../shared/navigation-runtime";

export type SceneAuthoringMode = "room" | "wall" | "opening" | "connector";

export type SceneAuthoringSession = {
  mode: SceneAuthoringMode;
  requestId: string;
  points: Vector3Tuple[];
};

export type SceneAuthoringGeometry = {
  kind: SceneAuthoringMode;
  points: Vector3Tuple[];
  complete: boolean;
};

export function appendSceneAuthoringPick(
  session: SceneAuthoringSession,
  point: Vector3Tuple,
): SceneAuthoringSession {
  if (point.some((coordinate) => !Number.isFinite(coordinate))) return session;
  return {
    ...session,
    points: [...session.points, [...point] as Vector3Tuple],
  };
}

export function sceneAuthoringGeometry(
  session: SceneAuthoringSession,
): SceneAuthoringGeometry {
  const requiredPoints = session.mode === "connector" ? 4 : session.mode === "room" ? 3 : 2;
  return {
    kind: session.mode,
    points: session.points.map((point) => [...point] as Vector3Tuple),
    complete: session.points.length >= requiredPoints,
  };
}
