const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/i;
const identifierPattern = /^[a-z][a-z0-9_-]{1,63}$/;

export class CaptureTransferError extends Error {
  constructor(code, message, { retryable = false, details = {}, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "CaptureTransferError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export function parseCaptureTransferManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw manifestError("Capture manifest must be a JSON object");
  }
  if (value.schemaVersion !== "1.0.0") {
    throw manifestError("Capture manifest schemaVersion must be 1.0.0");
  }
  if (!uuidPattern.test(String(value.projectId ?? ""))) {
    throw manifestError("Capture manifest projectId must be a UUID");
  }
  if (!identifierPattern.test(String(value.adapter ?? ""))) {
    throw manifestError("Capture manifest adapter is invalid");
  }
  if (!Array.isArray(value.files) || value.files.length !== 1) {
    throw manifestError(
      "Capture manifest V1 must declare exactly one immutable export artifact; package multi-file vendor exports before transfer",
    );
  }
  const file = value.files[0];
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    throw manifestError("Capture manifest file declaration is invalid");
  }
  const path = validateCaptureRelativePath(file.path);
  const format = String(file.format ?? "").trim().toLowerCase();
  const purpose = String(file.purpose ?? "").trim().toLowerCase();
  const mimeType = String(file.mimeType ?? "").trim().toLowerCase();
  if (!identifierPattern.test(format)) throw manifestError("Capture artifact format is invalid");
  if (!identifierPattern.test(purpose)) throw manifestError("Capture artifact purpose is invalid");
  if (!mimeType || mimeType.length > 120 || !mimeType.includes("/")) {
    throw manifestError("Capture artifact mimeType is invalid");
  }
  const declaredSha256 = file.sha256 === undefined
    ? undefined
    : String(file.sha256).toLowerCase();
  if (declaredSha256 !== undefined && !sha256Pattern.test(declaredSha256)) {
    throw manifestError("Capture artifact sha256 must be 64 hexadecimal characters");
  }
  return {
    schemaVersion: "1.0.0",
    projectId: String(value.projectId).toLowerCase(),
    adapter: String(value.adapter),
    capturedAt: optionalIsoTimestamp(value.capturedAt, "capturedAt"),
    exportedAt: optionalIsoTimestamp(value.exportedAt, "exportedAt"),
    exporter: optionalBoundedString(value.exporter, "exporter", 120),
    exporterVersion: optionalBoundedString(
      value.exporterVersion,
      "exporterVersion",
      120,
    ),
    files: [{
      path,
      format,
      purpose,
      mimeType,
      ...(declaredSha256 ? { sha256: declaredSha256 } : {}),
    }],
  };
}

export function validateCaptureRelativePath(value) {
  if (typeof value !== "string") throw manifestError("Capture artifact path is required");
  const path = value.trim();
  if (
    !path ||
    path.length > 512 ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\\")
  ) {
    throw manifestError("Capture artifact path must be a portable relative path");
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw manifestError("Capture artifact path may not traverse outside the manifest directory");
  }
  return path;
}

export function planCaptureTransferParts(sizeBytes, partSizeBytes, uploadedParts = []) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new CaptureTransferError("INVALID_FILE_SIZE", "Capture artifact must not be empty");
  }
  if (!Number.isSafeInteger(partSizeBytes) || partSizeBytes <= 0) {
    throw new CaptureTransferError("INVALID_PART_SIZE", "Server returned an invalid multipart size");
  }
  const uploaded = new Set(uploadedParts.map((part) => {
    const partNumber = typeof part === "number" ? part : part?.partNumber;
    if (!Number.isInteger(partNumber) || partNumber < 1) {
      throw new CaptureTransferError(
        "INVALID_RECOVERY_STATE",
        "Persisted upload recovery contains an invalid part number",
      );
    }
    return partNumber;
  }));
  const parts = [];
  let offset = 0;
  let partNumber = 1;
  while (offset < sizeBytes) {
    const length = Math.min(partSizeBytes, sizeBytes - offset);
    if (!uploaded.has(partNumber)) parts.push({ partNumber, offset, length });
    offset += length;
    partNumber += 1;
  }
  return parts;
}

export function captureOperationId(fingerprintSha256) {
  if (!sha256Pattern.test(String(fingerprintSha256 ?? ""))) {
    throw new CaptureTransferError(
      "INVALID_OPERATION_FINGERPRINT",
      "Capture operation fingerprint must be a SHA-256 value",
    );
  }
  const bytes = [];
  for (let index = 0; index < 32; index += 2) {
    bytes.push(Number.parseInt(fingerprintSha256.slice(index, index + 2), 16));
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function captureTransferFailure(status, payload) {
  const message = payload && typeof payload === "object" &&
    typeof payload.error === "string"
    ? payload.error
    : `Spatial Studio returned HTTP ${status}`;
  const retryable = status === 408 || status === 425 ||
    status === 429 || status >= 500;
  return new CaptureTransferError(
    retryable ? "REMOTE_RETRYABLE" : "REMOTE_REJECTED",
    message,
    {
      retryable,
      details: {
        status,
        retryAfterSeconds:
          payload && typeof payload === "object" &&
          Number.isFinite(payload.retryAfterSeconds)
            ? payload.retryAfterSeconds
            : undefined,
      },
    },
  );
}

function manifestError(message) {
  return new CaptureTransferError("INVALID_CAPTURE_MANIFEST", message);
}

function optionalIsoTimestamp(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw manifestError(`Capture manifest ${field} must be an ISO timestamp`);
  }
  return new Date(value).toISOString();
}

function optionalBoundedString(value, field, maximumLength) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximumLength) {
    throw manifestError(`Capture manifest ${field} is invalid`);
  }
  return value.trim();
}
