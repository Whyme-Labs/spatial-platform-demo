const MEBIBYTE = 1_048_576;

export function rendererLoadTimeoutMs(format: string, sizeBytes: number): number {
  if (format.toLowerCase() !== "sog") return 60_000;
  const boundedSize = Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0;
  const sizeAllowance = Math.ceil(boundedSize / MEBIBYTE) * 1_000;
  return Math.min(300_000, Math.max(180_000, 120_000 + sizeAllowance));
}
