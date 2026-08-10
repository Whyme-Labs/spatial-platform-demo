import type {
  PairedPlyCoordinatePreflight,
  PairedPlyCoordinateQualification,
  PlyCoordinateDescriptor,
  PlyCoordinateEvidence,
} from "./capture-compatibility-contract.mjs";

export {
  AUTOMATIC_PLY_COORDINATE_EVIDENCE_METHOD,
  PLY_COORDINATE_HEADER_BUDGET_BYTES,
  PLY_COORDINATE_HEADER_BUDGET_NAME,
} from "./capture-compatibility-contract.mjs";

export function plyCoordinateHeaderBudgetError(): Error;
export function preflightPairedPlyCoordinateDescriptors(
  visual: PlyCoordinateDescriptor,
  geometry: PlyCoordinateDescriptor,
): PairedPlyCoordinatePreflight;
export function parsePlyCoordinateDescriptor(
  input: ArrayBuffer | Uint8Array,
): PlyCoordinateDescriptor;
export function createPlyCoordinateEvidenceAccumulator(
  descriptor: PlyCoordinateDescriptor,
): {
  consume(input: ArrayBuffer | Uint8Array): void;
  finish(): PlyCoordinateEvidence;
};
export function qualifyPairedPlyCoordinateEvidence(
  visual: PlyCoordinateEvidence,
  geometry: PlyCoordinateEvidence,
): PairedPlyCoordinateQualification;
