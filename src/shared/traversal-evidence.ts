import type { SourceToWorldTransform, Vector3Tuple } from "./navigation-runtime";

export type TraversalEvidenceReceipt = {
  assetId: string;
  sha256: string;
  manifestId?: string;
  manifestSha256?: string;
  adapter?: string;
  reviewGeneration?: number;
  registrationSha256?: string;
  sourceToWorld?: SourceToWorldTransform;
  sourcePath?: Vector3Tuple[];
};

export type SceneRegisteredTraversalEvidenceReceipt =
  CaptureQualifiedTraversalEvidenceReceipt & {
    registrationSha256: string;
    sourceToWorld: SourceToWorldTransform & { worldUnit: "metres" };
    sourcePath: Vector3Tuple[];
  };

export type CaptureQualifiedTraversalEvidenceReceipt = TraversalEvidenceReceipt & {
  manifestId: string;
  manifestSha256: string;
  adapter: string;
  reviewGeneration: number;
};

export function isCaptureQualifiedTraversalEvidenceReceipt(
  value: TraversalEvidenceReceipt,
): value is CaptureQualifiedTraversalEvidenceReceipt {
  return typeof value.manifestId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.manifestId,
    ) &&
    typeof value.manifestSha256 === "string" &&
    /^[a-f0-9]{64}$/i.test(value.manifestSha256) &&
    typeof value.adapter === "string" && Boolean(value.adapter.trim()) &&
    Number.isSafeInteger(value.reviewGeneration) && Number(value.reviewGeneration) > 0;
}

export function isSceneRegisteredTraversalEvidenceReceipt(
  value: TraversalEvidenceReceipt,
): value is SceneRegisteredTraversalEvidenceReceipt {
  const transform = value.sourceToWorld;
  return isCaptureQualifiedTraversalEvidenceReceipt(value) &&
    typeof value.registrationSha256 === "string" &&
    /^[a-f0-9]{64}$/i.test(value.registrationSha256) &&
    Boolean(transform) &&
    (transform?.sourceUpAxis === "Y" || transform?.sourceUpAxis === "Z") &&
    transform?.worldUnit === "metres" &&
    Number.isFinite(transform?.metresPerSourceUnit) &&
    Number(transform?.metresPerSourceUnit) > 0 &&
    Number.isFinite(transform?.yawDegrees) &&
    Array.isArray(transform?.translationMetres) &&
    transform.translationMetres.length === 3 &&
    transform.translationMetres.every(Number.isFinite) &&
    Array.isArray(value.sourcePath) &&
    value.sourcePath.length >= 2 &&
    value.sourcePath.every((point) =>
      Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)
    );
}

export function hasValidOptionalCaptureQualification(
  value: TraversalEvidenceReceipt,
): boolean {
  if (hasNoCaptureQualification(value)) return true;
  return isCaptureQualifiedTraversalEvidenceReceipt(value);
}

export function hasNoCaptureQualification(value: TraversalEvidenceReceipt): boolean {
  return value.manifestId === undefined && value.manifestSha256 === undefined &&
    value.adapter === undefined && value.reviewGeneration === undefined &&
    value.registrationSha256 === undefined && value.sourceToWorld === undefined &&
    value.sourcePath === undefined;
}
