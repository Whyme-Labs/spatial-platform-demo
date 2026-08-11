import {
  captureAdapterIds,
  type CaptureAdapterId,
} from "./capture-adapters";
import type { SourceToWorldTransform } from "./navigation-runtime";
import {
  AUTOMATIC_PLY_COORDINATE_EVIDENCE_METHOD,
  type PlyCoordinateEvidence,
} from "../../scripts/capture-compatibility-contract.mjs";

export type { PlyCoordinateEvidence } from "../../scripts/capture-compatibility-contract.mjs";

export const PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION =
  "paired-capture-journey-v2" as const;
const LEGACY_PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION =
  "paired-capture-journey-v1" as const;
export const PAIRED_CAPTURE_FRAME_DECLARATION =
  "same-capture-registered-y-up-metres" as const;

export const AUTOMATIC_PAIRED_CAPTURE_METHOD =
  AUTOMATIC_PLY_COORDINATE_EVIDENCE_METHOD;
export const ATTESTED_PAIRED_CAPTURE_METHOD = "operator-attestation-v1" as const;

export type PairedCaptureJourneyRequest = {
  id: string;
  qualification?:
    | typeof AUTOMATIC_PAIRED_CAPTURE_METHOD
    | typeof ATTESTED_PAIRED_CAPTURE_METHOD;
  sameFrameConfirmed?: true;
};

export type AutomaticPairedCaptureQualification = {
  method: typeof AUTOMATIC_PAIRED_CAPTURE_METHOD;
  status: "pending";
} | {
  method: typeof AUTOMATIC_PAIRED_CAPTURE_METHOD;
  status: "verified";
  coordinateFrameId: string;
  sourceUpAxis: "Y";
  worldUnit: "metres";
  overlapBounds: { min: [number, number, number]; max: [number, number, number] };
  visual: PlyCoordinateEvidence;
  geometry: PlyCoordinateEvidence;
} | {
  method: typeof AUTOMATIC_PAIRED_CAPTURE_METHOD;
  status: "blocked";
  reason: string;
};

export type PairedCaptureQualification = AutomaticPairedCaptureQualification | {
  method: typeof ATTESTED_PAIRED_CAPTURE_METHOD;
  status: "verified";
  confirmedBy: string;
  confirmedAt: string;
};

export type PairedCaptureJourney = {
  schemaVersion:
    | typeof PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION
    | typeof LEGACY_PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION;
  id: string;
  captureAdapter: CaptureAdapterId;
  primaryAssetId: string;
  geometryAssetId?: string;
  declaration: typeof PAIRED_CAPTURE_FRAME_DECLARATION;
  sourceCoordinateFrameId: string;
  confirmedBy: string;
  confirmedAt: string;
  qualification?: PairedCaptureQualification;
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
  const automatic = "qualification" in input.request &&
    input.request.qualification === AUTOMATIC_PAIRED_CAPTURE_METHOD;
  return {
    schemaVersion: PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION,
    id: input.request.id,
    captureAdapter: input.captureAdapter,
    primaryAssetId: input.primaryAssetId,
    declaration: PAIRED_CAPTURE_FRAME_DECLARATION,
    sourceCoordinateFrameId: `capture-journey:${input.request.id}`,
    confirmedBy: input.confirmedBy,
    confirmedAt: input.confirmedAt,
    qualification: automatic
      ? { method: AUTOMATIC_PAIRED_CAPTURE_METHOD, status: "pending" }
      : {
        method: ATTESTED_PAIRED_CAPTURE_METHOD,
        status: "verified",
        confirmedBy: input.confirmedBy,
        confirmedAt: input.confirmedAt,
      },
  };
}

export function bindPairedCaptureGeometry(
  journey: PairedCaptureJourney,
  geometryAssetId: string,
): PairedCaptureJourney {
  return { ...journey, geometryAssetId };
}

export function setPairedCaptureAutomaticQualification(
  journey: PairedCaptureJourney,
  qualification: Exclude<AutomaticPairedCaptureQualification, { status: "pending" }>,
): PairedCaptureJourney {
  if (
    journey.schemaVersion !== PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION ||
    journey.qualification?.method !== AUTOMATIC_PAIRED_CAPTURE_METHOD
  ) {
    throw new Error("Only an automatic paired-capture journey can receive processor qualification");
  }
  return { ...journey, qualification };
}

export function pairedCaptureJourneyIsVerified(journey: PairedCaptureJourney): boolean {
  return journey.schemaVersion === LEGACY_PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION ||
    journey.qualification?.status === "verified";
}

export function pairedCaptureJourneyHasProcessorQualification(
  journey: PairedCaptureJourney,
): boolean {
  return journey.schemaVersion === PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION &&
    journey.qualification?.method === AUTOMATIC_PAIRED_CAPTURE_METHOD &&
    journey.qualification.status === "verified";
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
    ![
      PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION,
      LEGACY_PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION,
    ].includes(Reflect.get(value, "schemaVersion") as typeof PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION) ||
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
  const schemaVersion = Reflect.get(value, "schemaVersion") as PairedCaptureJourney["schemaVersion"];
  const qualification = schemaVersion === PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION
    ? parsePairedCaptureQualification(Reflect.get(value, "qualification"))
    : undefined;
  if (schemaVersion === PAIRED_CAPTURE_JOURNEY_SCHEMA_VERSION && !qualification) return null;
  return {
    schemaVersion,
    id,
    captureAdapter: captureAdapter as CaptureAdapterId,
    primaryAssetId,
    ...(geometryAssetId ? { geometryAssetId } : {}),
    declaration: PAIRED_CAPTURE_FRAME_DECLARATION,
    sourceCoordinateFrameId,
    confirmedBy,
    confirmedAt,
    ...(qualification ? { qualification } : {}),
  };
}

function parsePairedCaptureQualification(value: unknown): PairedCaptureQualification | null {
  if (!value || typeof value !== "object") return null;
  const method = Reflect.get(value, "method");
  const status = Reflect.get(value, "status");
  if (method === ATTESTED_PAIRED_CAPTURE_METHOD && status === "verified") {
    const confirmedBy = Reflect.get(value, "confirmedBy");
    const confirmedAt = Reflect.get(value, "confirmedAt");
    if (
      typeof confirmedBy !== "string" || !uuidPattern.test(confirmedBy) ||
      typeof confirmedAt !== "string" || !Number.isFinite(Date.parse(confirmedAt))
    ) return null;
    return { method, status, confirmedBy, confirmedAt };
  }
  if (method !== AUTOMATIC_PAIRED_CAPTURE_METHOD) return null;
  if (status === "pending") return { method, status };
  if (status === "blocked") {
    const reason = Reflect.get(value, "reason");
    return typeof reason === "string" && reason.trim()
      ? { method, status, reason }
      : null;
  }
  if (status !== "verified") return null;
  const coordinateFrameId = Reflect.get(value, "coordinateFrameId");
  const overlapBounds = parseBounds(Reflect.get(value, "overlapBounds"));
  const visual = parsePlyCoordinateEvidence(Reflect.get(value, "visual"));
  const geometry = parsePlyCoordinateEvidence(Reflect.get(value, "geometry"));
  const exactOverlap = visual && geometry
    ? {
        min: visual.bounds.min.map((coordinate, axis) =>
          Math.max(coordinate, geometry.bounds.min[axis]!)) as [number, number, number],
        max: visual.bounds.max.map((coordinate, axis) =>
          Math.min(coordinate, geometry.bounds.max[axis]!)) as [number, number, number],
      }
    : null;
  if (
    typeof coordinateFrameId !== "string" || !coordinateFrameId.trim() ||
    Reflect.get(value, "sourceUpAxis") !== "Y" ||
    Reflect.get(value, "worldUnit") !== "metres" ||
    !overlapBounds || !visual || !geometry ||
    visual.coordinateFrameId !== coordinateFrameId ||
    geometry.coordinateFrameId !== coordinateFrameId ||
    visual.sourceUpAxis !== "Y" || geometry.sourceUpAxis !== "Y" ||
    visual.worldUnit !== "metres" || geometry.worldUnit !== "metres" ||
    !exactOverlap || exactOverlap.min.some((coordinate, axis) =>
      coordinate >= exactOverlap.max[axis]! ||
      coordinate !== overlapBounds.min[axis] ||
      exactOverlap.max[axis] !== overlapBounds.max[axis]
    )
  ) return null;
  return {
    method,
    status,
    coordinateFrameId,
    sourceUpAxis: "Y",
    worldUnit: "metres",
    overlapBounds,
    visual,
    geometry,
  };
}

function parsePlyCoordinateEvidence(value: unknown): PlyCoordinateEvidence | null {
  if (!value || typeof value !== "object") return null;
  const bounds = parseBounds(Reflect.get(value, "bounds"));
  const coordinateFrameId = Reflect.get(value, "coordinateFrameId");
  const sourceUpAxis = Reflect.get(value, "sourceUpAxis");
  const worldUnit = Reflect.get(value, "worldUnit");
  const vertexCount = Reflect.get(value, "vertexCount");
  const finitePointCount = Reflect.get(value, "finitePointCount");
  if (
    Reflect.get(value, "schemaVersion") !== "ply-coordinate-evidence-v1" ||
    Reflect.get(value, "method") !== AUTOMATIC_PAIRED_CAPTURE_METHOD ||
    typeof coordinateFrameId !== "string" || !coordinateFrameId.trim() ||
    sourceUpAxis !== "Y" || worldUnit !== "metres" ||
    !Number.isSafeInteger(vertexCount) || (vertexCount as number) <= 0 ||
    !Number.isSafeInteger(finitePointCount) || (finitePointCount as number) <= 0 ||
    (finitePointCount as number) > (vertexCount as number) || !bounds
  ) return null;
  return {
    schemaVersion: "ply-coordinate-evidence-v1",
    method: AUTOMATIC_PAIRED_CAPTURE_METHOD,
    coordinateFrameId,
    sourceUpAxis,
    worldUnit,
    vertexCount: vertexCount as number,
    finitePointCount: finitePointCount as number,
    bounds,
  };
}

export function parsePlyCoordinateEvidenceReceipt(value: unknown): PlyCoordinateEvidence | null {
  return parsePlyCoordinateEvidence(value);
}

function parseBounds(value: unknown): { min: [number, number, number]; max: [number, number, number] } | null {
  if (!value || typeof value !== "object") return null;
  const minimum = Reflect.get(value, "min");
  const maximum = Reflect.get(value, "max");
  if (
    !Array.isArray(minimum) || minimum.length !== 3 || !minimum.every(Number.isFinite) ||
    !Array.isArray(maximum) || maximum.length !== 3 || !maximum.every(Number.isFinite) ||
    minimum.some((coordinate, axis) => coordinate > maximum[axis])
  ) return null;
  return {
    min: minimum as [number, number, number],
    max: maximum as [number, number, number],
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
