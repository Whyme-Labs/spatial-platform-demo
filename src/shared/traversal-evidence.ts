export type TraversalEvidenceReceipt = {
  assetId: string;
  sha256: string;
  manifestId?: string;
  manifestSha256?: string;
  adapter?: string;
  reviewGeneration?: number;
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

export function hasValidOptionalCaptureQualification(
  value: TraversalEvidenceReceipt,
): boolean {
  if (hasNoCaptureQualification(value)) return true;
  return isCaptureQualifiedTraversalEvidenceReceipt(value);
}

export function hasNoCaptureQualification(value: TraversalEvidenceReceipt): boolean {
  return value.manifestId === undefined && value.manifestSha256 === undefined &&
    value.adapter === undefined && value.reviewGeneration === undefined;
}
