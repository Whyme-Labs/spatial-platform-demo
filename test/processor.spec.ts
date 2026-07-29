import { describe, expect, it } from "vitest";
import {
  automaticallyRegisterSceneSignatures,
  assertRegisteredSceneChangeCapacity,
  compareRegisteredScenes,
  inspectSpzContainer,
  parsePlySceneSignature,
  parsePosterCameraJson,
  planMultipartParts,
  processOutputEvent,
  processorFailure,
  sparkMaximumSphericalHarmonicDegree,
  validateEvidenceAsset,
  validateGaussianPlyHeader,
} from "../scripts/processing-agent-core.mjs";

const gaussianHeader = [
  "ply",
  "format binary_little_endian 1.0",
  "element vertex 42",
  "property float x",
  "property float y",
  "property float z",
  "property float f_dc_0",
  "property float f_dc_1",
  "property float f_dc_2",
  "property float opacity",
  "property float scale_0",
  "property float scale_1",
  "property float scale_2",
  "property float rot_0",
  "property float rot_1",
  "property float rot_2",
  "property float rot_3",
  "end_header",
  "",
].join("\n");

describe("processing agent core", () => {
  it("labels a child process stderr stream as diagnostics rather than a false error", () => {
    expect(processOutputEvent("splat.normalize", "stdout")).toBe("splat.normalize");
    expect(processOutputEvent("splat.normalize", "stderr")).toBe("splat.normalize.stderr");
  });

  it("accepts a bounded authored camera for indoor Gaussian posters", () => {
    expect(parsePosterCameraJson(JSON.stringify({
      position: [-0.3, 0.71, -0.94],
      target: [-1.29, 0.61, -0.97],
      up: [-0.02, 0, 1],
      fovDegrees: 100,
    }))).toEqual({
      position: [-0.3, 0.71, -0.94],
      target: [-1.29, 0.61, -0.97],
      up: [-0.02, 0, 1],
      fovDegrees: 100,
    });
    expect(parsePosterCameraJson(" ")).toBeNull();
  });

  it("rejects unusable authored poster cameras as configuration failures", () => {
    expect(() => parsePosterCameraJson(JSON.stringify({
      position: [0, 0, 0],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fovDegrees: 58,
    }))).toThrowError(expect.objectContaining({
      code: "POSTER_CAMERA_INVALID",
      failureClass: "configuration",
      retryable: false,
    }));
  });

  it("validates a Gaussian PLY before invoking Spark", () => {
    expect(validateGaussianPlyHeader(Buffer.from(gaussianHeader))).toMatchObject({
      format: "binary_little_endian",
      vertexCount: 42,
      sphericalHarmonicDegree: 0,
    });
  });

  it("rejects a point-only PLY with a classified, non-retryable failure", () => {
    const pointOnly = Buffer.from([
      "ply",
      "format ascii 1.0",
      "element vertex 1",
      "property float x",
      "property float y",
      "property float z",
      "end_header",
      "0 0 0",
    ].join("\n"));
    expect(() => validateGaussianPlyHeader(pointOnly)).toThrowError(
      expect.objectContaining({
        code: "INVALID_GAUSSIAN_PLY",
        failureClass: "input_validation",
        retryable: false,
      }),
    );
  });

  it("distinguishes Spark-compatible legacy SPZ from NGSP v4 that needs normalization", () => {
    expect(inspectSpzContainer(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))).toEqual({
      container: "gzip",
      version: "legacy",
      sparkBuildLodCompatible: true,
      normalizationRequired: false,
    });
    expect(inspectSpzContainer(new Uint8Array([
      0x4e, 0x47, 0x53, 0x50,
      0x04, 0x00, 0x00, 0x00,
    ]))).toEqual({
      container: "ngsp",
      version: 4,
      sparkBuildLodCompatible: false,
      normalizationRequired: true,
    });
  });

  it("rejects mislabeled and unknown SPZ versions before conversion", () => {
    expect(() => inspectSpzContainer(new TextEncoder().encode("not-spz")))
      .toThrowError(expect.objectContaining({
        code: "INVALID_SPZ_HEADER",
        retryable: false,
      }));
    expect(() => inspectSpzContainer(new Uint8Array([
      0x4e, 0x47, 0x53, 0x50,
      0x05, 0x00, 0x00, 0x00,
    ]))).toThrowError(expect.objectContaining({
      code: "UNSUPPORTED_SPZ_VERSION",
      retryable: false,
      details: { version: 5 },
    }));
  });

  it("does not request spherical harmonics from the SH-free standard SPLAT format", () => {
    expect(sparkMaximumSphericalHarmonicDegree("splat")).toBe(0);
    expect(sparkMaximumSphericalHarmonicDegree("ply")).toBe(3);
    expect(sparkMaximumSphericalHarmonicDegree("ply", 2)).toBe(2);
    expect(sparkMaximumSphericalHarmonicDegree("spz")).toBe(3);
    expect(sparkMaximumSphericalHarmonicDegree("ksplat")).toBe(3);
  });

  it("performs bounded signature validation for immutable capture evidence", () => {
    expect(validateEvidenceAsset(
      Buffer.from("ASTM-E57\x01\x00capture"),
      { format: "e57", purpose: "metric_point_cloud" },
    )).toMatchObject({
      method: "bounded-file-signature-v1",
      format: "e57",
      purpose: "metric_point_cloud",
      signatureVerified: true,
      semanticValidation: false,
    });
    expect(validateEvidenceAsset(
      Buffer.from("RAD0\x01\x00scene"),
      { format: "rad", purpose: "web_scene" },
    )).toMatchObject({
      format: "rad",
      purpose: "web_scene",
      signatureVerified: true,
    });
  });

  it("rejects mislabeled capture evidence without retrying it", () => {
    expect(() => validateEvidenceAsset(
      Buffer.from("not a zip archive"),
      { format: "zip", purpose: "source_images" },
    )).toThrowError(expect.objectContaining({
      code: "EVIDENCE_SIGNATURE_MISMATCH",
      failureClass: "input_validation",
      retryable: false,
    }));
  });

  it("plans bounded multipart transfers without losing bytes", () => {
    expect(planMultipartParts(11, 4)).toEqual([
      { partNumber: 1, offset: 0, length: 4 },
      { partNumber: 2, offset: 4, length: 4 },
      { partNumber: 3, offset: 8, length: 3 },
    ]);
  });

  it("classifies unknown crashes without leaking arbitrary objects", () => {
    expect(processorFailure(new Error("GPU process exited"))).toMatchObject({
      code: "PROCESSOR_ERROR",
      message: "GPU process exited",
      failureClass: "unknown",
      retryable: true,
    });
  });

  it("rejects registered-scene inputs that exceed the configured in-memory comparison limit", () => {
    expect(() => assertRegisteredSceneChangeCapacity({
      baselineSizeBytes: 1_024,
      candidateSizeBytes: 4_097,
      maximumInputBytes: 4_096,
    })).toThrowError(expect.objectContaining({
      code: "CHANGE_INPUT_CAPACITY_EXCEEDED",
      failureClass: "capacity",
      retryable: false,
      details: {
        baselineSizeBytes: 1_024,
        candidateSizeBytes: 4_097,
        maximumInputBytes: 4_096,
      },
    }));
  });

  it("builds deterministic spatial and photometric signatures from registered PLY data", () => {
    const source = Buffer.from([
      "ply",
      "format ascii 1.0",
      "element vertex 3",
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      "end_header",
      "0.10 0 0.10 255 0 0",
      "0.20 0 0.20 255 0 0",
      "1.10 0 0.10 0 255 0",
      "",
    ].join("\n"));

    const signature = parsePlySceneSignature(source, {
      voxelSizeM: 1,
      maximumSamplePoints: 1_000,
    });

    expect(signature).toMatchObject({
      format: "ascii",
      vertexCount: 3,
      sampledPointCount: 3,
      voxelCount: 2,
      hasPhotometricData: true,
      samplingStride: 1,
    });
    expect(signature.bounds).toEqual({
      min: [0.1, 0, 0.1],
      max: [1.1, 0, 0.2],
    });
  });

  it("reports added, removed, displaced, and photometrically changed registered voxels", () => {
    const ply = (rows: string[]) => Buffer.from([
      "ply",
      "format ascii 1.0",
      `element vertex ${rows.length}`,
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      "end_header",
      ...rows,
      "",
    ].join("\n"));
    const baseline = parsePlySceneSignature(ply([
      "0.10 0 0.10 255 0 0",
      "1.10 0 0.10 0 255 0",
      "3.10 0 0.10 0 0 255",
    ]), { voxelSizeM: 1 });
    const candidate = parsePlySceneSignature(ply([
      "0.30 0 0.10 0 0 255",
      "1.10 0 0.10 0 255 0",
      "4.10 0 0.10 255 255 255",
    ]), { voxelSizeM: 1 });

    const report = compareRegisteredScenes({
      baseline,
      candidate,
      parameters: {
        structuralChangeThresholdPercent: 10,
        photometricChangeThresholdPercent: 10,
        centroidChangeThresholdMm: 100,
      },
    });

    expect(report.method).toBe("registered-ply-voxel-change-v1");
    expect(report.result).toBe("changes_detected");
    expect(report.summary).toMatchObject({
      baselineVoxels: 3,
      candidateVoxels: 3,
      commonVoxels: 2,
      addedVoxels: 1,
      removedVoxels: 1,
      structurallyChangedPercent: 50,
      photometricallyComparableVoxels: 2,
    });
    expect(report.summary.p95CentroidDisplacementMm).toBe(200);
    expect(report.summary.p95PhotometricDeltaPercent).toBeGreaterThan(80);
    expect(report.materialSignals).toEqual(expect.arrayContaining([
      expect.stringContaining("occupancy"),
      expect.stringContaining("photometric"),
      expect.stringContaining("centroid"),
    ]));
  });

  it("recovers a bounded yaw and translation before comparing the same scene", () => {
    const ply = (points: number[][]) => Buffer.from([
      "ply",
      "format ascii 1.0",
      `element vertex ${points.length}`,
      "property float x",
      "property float y",
      "property float z",
      "end_header",
      ...points.map((point) => point.join(" ")),
      "",
    ].join("\n"));
    const baselinePoints = [
      [0, 0, 0], [0.5, 0, 0], [1, 0, 0], [1.5, 0, 0],
      [0, 0, 1], [0, 0, 2], [0, 0.5, 2], [0, 1, 2],
      [1.2, 0.3, 1.7], [1.5, 0.8, 0.5], [2, 0.2, 1],
    ];
    const candidatePoints = baselinePoints.map(([x, y, z]) => [
      -z + 4,
      y - 0.75,
      x - 2,
    ]);
    const options = { voxelSizeM: 0.1, maximumSamplePoints: 10_000 };
    const baseline = parsePlySceneSignature(ply(baselinePoints), options);
    const candidate = parsePlySceneSignature(ply(candidatePoints), options);

    const registration = automaticallyRegisterSceneSignatures({
      baseline,
      candidate,
      parameters: {
        searchRadiusM: 1,
        maximumRmseMm: 80,
        minimumOverlapPercent: 80,
      },
    });

    expect(registration.status).toBe("accepted");
    expect(registration.method).toBe("bounded-yaw-icp-v1");
    expect(registration.summary.overlapPercent).toBeGreaterThanOrEqual(90);
    expect(registration.summary.rmseMm).toBeLessThan(20);
    expect(registration.transform.matrix4x4).toHaveLength(16);
    const comparison = compareRegisteredScenes({
      baseline,
      candidate: registration.registeredCandidate,
      parameters: {
        structuralChangeThresholdPercent: 5,
        photometricChangeThresholdPercent: 12,
        centroidChangeThresholdMm: 50,
      },
    });
    expect(comparison.result).toBe("no_material_change");
    expect(comparison.summary.structurallyChangedPercent).toBe(0);
  });

  it("blocks automatic registration when overlap cannot satisfy the declared gate", () => {
    const ply = (points: number[][]) => Buffer.from([
      "ply",
      "format ascii 1.0",
      `element vertex ${points.length}`,
      "property float x",
      "property float y",
      "property float z",
      "end_header",
      ...points.map((point) => point.join(" ")),
      "",
    ].join("\n"));
    const baseline = parsePlySceneSignature(ply([
      [0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1],
      [0.5, 1, 0.5], [1.5, 0.2, 0.5],
    ]), { voxelSizeM: 0.1 });
    const candidate = parsePlySceneSignature(ply([
      [50, 50, 50], [53, 50, 50], [50, 54, 50],
    ]), { voxelSizeM: 0.1 });

    const registration = automaticallyRegisterSceneSignatures({
      baseline,
      candidate,
      parameters: {
        searchRadiusM: 0.25,
        maximumRmseMm: 50,
        minimumOverlapPercent: 80,
      },
    });

    expect(registration.status).toBe("blocked");
    expect(registration.registeredCandidate).toBeNull();
    expect(registration.qualityGates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "minimum_overlap_percent", passed: false }),
    ]));
    expect(registration.limitation).toContain("not survey registration");
  });
});
