import { describe, expect, it } from "vitest";
import {
  CaptureTransferError,
  captureOperationId,
  captureTransferFailure,
  parseCaptureTransferManifest,
  planCaptureTransferParts,
  validateCaptureRelativePath,
} from "../scripts/capture-transfer-agent-core.mjs";

describe("capture transfer agent core", () => {
  const projectId = "123e4567-e89b-42d3-a456-426614174000";

  it("normalizes one immutable vendor export artifact", () => {
    expect(parseCaptureTransferManifest({
      schemaVersion: "1.0.0",
      projectId,
      adapter: "xgrids-lcc",
      capturedAt: "2026-07-28T01:02:03+08:00",
      exporter: "Lixel CyberColor",
      exporterVersion: "2.0",
      files: [{
        path: "exports/k1-project.zip",
        format: "zip",
        purpose: "vendor_project",
        mimeType: "application/zip",
        sha256: "a".repeat(64),
      }],
    })).toEqual({
      schemaVersion: "1.0.0",
      projectId,
      adapter: "xgrids-lcc",
      capturedAt: "2026-07-27T17:02:03.000Z",
      exporter: "Lixel CyberColor",
      exporterVersion: "2.0",
      files: [{
        path: "exports/k1-project.zip",
        format: "zip",
        purpose: "vendor_project",
        mimeType: "application/zip",
        sha256: "a".repeat(64),
      }],
    });
  });

  it("rejects traversal, absolute paths, and ambiguous multi-file grouping", () => {
    for (const path of ["../secret.zip", "/tmp/secret.zip", "C:/secret.zip", "exports\\secret.zip"]) {
      expect(() => validateCaptureRelativePath(path)).toThrowError(
        expect.objectContaining({ code: "INVALID_CAPTURE_MANIFEST" }),
      );
    }
    expect(() => parseCaptureTransferManifest({
      schemaVersion: "1.0.0",
      projectId,
      adapter: "fjd-trion",
      files: [
        { path: "one.zip", format: "zip", purpose: "vendor_project", mimeType: "application/zip" },
        { path: "two.zip", format: "zip", purpose: "vendor_project", mimeType: "application/zip" },
      ],
    })).toThrowError(/exactly one immutable export artifact/);
  });

  it("resumes only missing multipart ranges without losing the final byte", () => {
    expect(planCaptureTransferParts(11, 4, [{ partNumber: 2 }])).toEqual([
      { partNumber: 1, offset: 0, length: 4 },
      { partNumber: 3, offset: 8, length: 3 },
    ]);
  });

  it("derives a stable UUID operation ID from immutable file identity", () => {
    expect(captureOperationId("a".repeat(64))).toBe(
      "aaaaaaaa-aaaa-5aaa-aaaa-aaaaaaaaaaaa",
    );
    expect(captureOperationId("a".repeat(64))).toBe(
      captureOperationId("a".repeat(64)),
    );
  });

  it("classifies transient remote responses for bounded retry", () => {
    expect(captureTransferFailure(503, { error: "R2 unavailable" })).toMatchObject({
      code: "REMOTE_RETRYABLE",
      retryable: true,
      message: "R2 unavailable",
    });
    expect(captureTransferFailure(422, { error: "Unsupported export" })).toMatchObject({
      code: "REMOTE_REJECTED",
      retryable: false,
    });
    expect(() => planCaptureTransferParts(0, 10)).toThrowError(CaptureTransferError);
  });
});
