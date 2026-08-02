import type { SourceToWorldTransform } from "./navigation-runtime";

export const CAPTURE_SCENE_REGISTRATION_SCHEMA_VERSION =
  "capture-to-scene-registration-v1" as const;
export const SCENE_WORLD_COORDINATE_FRAME = "scene-world-right-handed-y-up-metres" as const;

export type CaptureSceneRegistrationPayload = {
  schemaVersion: typeof CAPTURE_SCENE_REGISTRATION_SCHEMA_VERSION;
  sourceCoordinateFrameId: string;
  targetCoordinateFrameId: typeof SCENE_WORLD_COORDINATE_FRAME;
  evidenceAssetId: string;
  evidenceSha256: string;
  method: string;
  sourceToWorld: SourceToWorldTransform & { worldUnit: "metres" };
};

export type CaptureSceneRegistration = CaptureSceneRegistrationPayload & {
  transformSha256: string;
};

export function captureSceneRegistrationPayload(
  value: CaptureSceneRegistrationPayload,
): CaptureSceneRegistrationPayload {
  return {
    schemaVersion: CAPTURE_SCENE_REGISTRATION_SCHEMA_VERSION,
    sourceCoordinateFrameId: value.sourceCoordinateFrameId,
    targetCoordinateFrameId: SCENE_WORLD_COORDINATE_FRAME,
    evidenceAssetId: value.evidenceAssetId,
    evidenceSha256: value.evidenceSha256.toLowerCase(),
    method: value.method,
    sourceToWorld: {
      sourceUpAxis: value.sourceToWorld.sourceUpAxis,
      worldUnit: "metres",
      metresPerSourceUnit: value.sourceToWorld.metresPerSourceUnit,
      yawDegrees: value.sourceToWorld.yawDegrees,
      translationMetres: [...value.sourceToWorld.translationMetres],
    },
  };
}

export function parseCaptureSceneRegistration(value: unknown): CaptureSceneRegistration | null {
  if (!value || typeof value !== "object") return null;
  const sourceCoordinateFrameId = Reflect.get(value, "sourceCoordinateFrameId");
  const evidenceAssetId = Reflect.get(value, "evidenceAssetId");
  const evidenceSha256 = Reflect.get(value, "evidenceSha256");
  const method = Reflect.get(value, "method");
  const transformSha256 = Reflect.get(value, "transformSha256");
  const sourceToWorld = Reflect.get(value, "sourceToWorld");
  if (
    Reflect.get(value, "schemaVersion") !== CAPTURE_SCENE_REGISTRATION_SCHEMA_VERSION ||
    Reflect.get(value, "targetCoordinateFrameId") !== SCENE_WORLD_COORDINATE_FRAME ||
    typeof sourceCoordinateFrameId !== "string" || !sourceCoordinateFrameId.trim() ||
    typeof evidenceAssetId !== "string" || !uuidPattern.test(evidenceAssetId) ||
    typeof evidenceSha256 !== "string" || !sha256Pattern.test(evidenceSha256) ||
    typeof method !== "string" || !method.trim() ||
    typeof transformSha256 !== "string" || !sha256Pattern.test(transformSha256) ||
    !sourceToWorld || typeof sourceToWorld !== "object"
  ) return null;
  const sourceUpAxis = Reflect.get(sourceToWorld, "sourceUpAxis");
  const metresPerSourceUnit = Number(Reflect.get(sourceToWorld, "metresPerSourceUnit"));
  const yawDegrees = Number(Reflect.get(sourceToWorld, "yawDegrees"));
  const translationMetres = finitePoint3(Reflect.get(sourceToWorld, "translationMetres"));
  if (
    (sourceUpAxis !== "Y" && sourceUpAxis !== "Z") ||
    Reflect.get(sourceToWorld, "worldUnit") !== "metres" ||
    !Number.isFinite(metresPerSourceUnit) || metresPerSourceUnit <= 0 ||
    !Number.isFinite(yawDegrees) || !translationMetres
  ) return null;
  return {
    schemaVersion: CAPTURE_SCENE_REGISTRATION_SCHEMA_VERSION,
    sourceCoordinateFrameId: sourceCoordinateFrameId.trim(),
    targetCoordinateFrameId: SCENE_WORLD_COORDINATE_FRAME,
    evidenceAssetId,
    evidenceSha256: evidenceSha256.toLowerCase(),
    method: method.trim(),
    sourceToWorld: {
      sourceUpAxis,
      worldUnit: "metres",
      metresPerSourceUnit,
      yawDegrees,
      translationMetres,
    },
    transformSha256: transformSha256.toLowerCase(),
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/i;

function finitePoint3(value: unknown): [number, number, number] | null {
  if (
    !Array.isArray(value) || value.length !== 3 ||
    value.some((coordinate) => !Number.isFinite(Number(coordinate)))
  ) return null;
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}
