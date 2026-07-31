export const SCENE_ROTATION_MIN_DEGREES = -360;
export const SCENE_ROTATION_MAX_DEGREES = 360;

export type SceneRotationDegrees = [number, number, number];

export function hasNonIdentitySceneRotation(
  value: readonly number[] | null | undefined,
): value is SceneRotationDegrees {
  return Boolean(value?.some((component) => component !== 0));
}

export function parseSceneRotationDegrees(
  values: readonly [unknown, unknown, unknown],
): SceneRotationDegrees | undefined {
  const rotation = values.map((value) => {
    const normalized = typeof value === "string" && value.trim() === ""
      ? 0
      : Number(value ?? 0);
    if (!Number.isFinite(normalized)) {
      throw new Error("Scene rotation must use finite numbers.");
    }
    if (
      normalized < SCENE_ROTATION_MIN_DEGREES ||
      normalized > SCENE_ROTATION_MAX_DEGREES
    ) {
      throw new Error(
        `Scene rotation must be between ${SCENE_ROTATION_MIN_DEGREES} and ${SCENE_ROTATION_MAX_DEGREES} degrees per axis.`,
      );
    }
    return Object.is(normalized, -0) ? 0 : normalized;
  }) as SceneRotationDegrees;

  return hasNonIdentitySceneRotation(rotation) ? rotation : undefined;
}
