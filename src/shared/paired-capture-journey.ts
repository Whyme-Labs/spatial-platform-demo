import {
  captureAdapterIds,
  type CaptureAdapterId,
} from "./capture-adapters";
import type { SourceToWorldTransform } from "./navigation-runtime";

export const PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION =
  "paired-capture-journey-v1" as const;
export const PAIRED_CAPTURE_FRAME_DECLARATION =
  "same-capture-registered-y-up-metres" as const;

export type PairedCaptureJourneyRequest = {
  id: string;
  sameFrameConfirmed: true;
};

export type PairedCaptureJourney = {
  schemaVersion: typeof PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION;
  id: string;
  captureAdapter: CaptureAdapterId;
  primaryAssetId: string;
  geometryAssetId?: string;
  declaration: typeof PAIRED_CAPTURE_FRAME_DECLARATION;
  sourceCoordinateFrameId: string;
  confirmedBy: string;
  confirmedAt: string;
};

export const pairedCaptureIdentityTransform: SourceToWorldTransform & {
  worldUnit: "metres";
} = {
  sourceUpAxis: "Y",
  worldUnit: "metres",
  metresPerSourceUnit: 1,
  yawDegrees: 0,
  translationMetres: [0, 0, 0],
};

export function createPairedCaptureJourney(input: {
  request: PairedCaptureJourneyRequest;
  captureAdapter: CaptureAdapterId;
  primaryAssetId: string;
  confirmedBy: string;
  confirmedAt: string;
}): PairedCaptureJourney {
  return {
    schemaVersion: PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION,
    id: input.request.id,
    captureAdapter: input.captureAdapter,
    primaryAssetId: input.primaryAssetId,
    declaration: PAIRED_CAPTURE_FRAME_DECLARATION,
    sourceCoordinateFrameId: `capture-journey:${input.request.id}`,
    confirmedBy: input.confirmedBy,
    confirmedAt: input.confirmedAt,
  };
}

export function bindPairedCaptureGeometry(
  journey: PairedCaptureJourney,
  geometryAssetId: string,
): PairedCaptureJourney {
  return { ...journey, geometryAssetId };
}

export function parsePairedCaptureJourney(value: unknown): PairedCaptureJourney | null {
  if (!value || typeof value !== "object") return null;
  const id = Reflect.get(value, "id");
  const captureAdapter = Reflect.get(value, "captureAdapter");
  const primaryAssetId = Reflect.get(value, "primaryAssetId");
  const geometryAssetId = Reflect.get(value, "geometryAssetId");
  const sourceCoordinateFrameId = Reflect.get(value, "sourceCoordinateFrameId");
  const confirmedBy = Reflect.get(value, "confirmedBy");
  const confirmedAt = Reflect.get(value, "confirmedAt");
  if (
    Reflect.get(value, "schemaVersion") !== PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION ||
    typeof id !== "string" || !uuidPattern.test(id) ||
    typeof captureAdapter !== "string" ||
    !captureAdapterIds.includes(captureAdapter as CaptureAdapterId) ||
    typeof primaryAssetId !== "string" || !uuidPattern.test(primaryAssetId) ||
    (geometryAssetId !== undefined &&
      (typeof geometryAssetId !== "string" || !uuidPattern.test(geometryAssetId))) ||
    Reflect.get(value, "declaration") !== PAIRED_CAPTURE_FRAME_DECLARATION ||
    sourceCoordinateFrameId !== `capture-journey:${id}` ||
    typeof confirmedBy !== "string" || !uuidPattern.test(confirmedBy) ||
    typeof confirmedAt !== "string" || !Number.isFinite(Date.parse(confirmedAt))
  ) return null;
  return {
    schemaVersion: PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION,
    id,
    captureAdapter: captureAdapter as CaptureAdapterId,
    primaryAssetId,
    ...(geometryAssetId ? { geometryAssetId } : {}),
    declaration: PAIRED_CAPTURE_FRAME_DECLARATION,
    sourceCoordinateFrameId,
    confirmedBy,
    confirmedAt,
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
