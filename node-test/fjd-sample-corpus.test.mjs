import assert from "node:assert/strict";
import { once } from "node:events";
import { describe, it } from "node:test";
import { zipSync } from "fflate";
import {
  IntegrityMeter,
  ZIP_END_RECORD_SEARCH_BYTES,
  inspectLasHeader,
  fjdQualificationGates,
  parseZipCentralDirectory,
  parseZipEndRecord,
  parseZipLocalFileHeader,
  parseZipLocalHeaderSize,
  selectQualificationCase,
  validatePdalSummary,
  validateFjdSampleManifest,
} from "../scripts/fjd-sample-corpus-core.mjs";

function zipDirectoryFixture() {
  const archive = Buffer.from(zipSync({
    "result/room_Gaussian.ply": Buffer.from("ply\nformat binary_little_endian 1.0\n"),
    "raw/capture.fjdslamp2.tgz": Buffer.from("vendor bytes"),
  }, { level: 6 }));
  const tailStart = Math.max(0, archive.byteLength - ZIP_END_RECORD_SEARCH_BYTES);
  const tail = archive.subarray(tailStart);
  const end = parseZipEndRecord(tail, {
    archiveSizeBytes: archive.byteLength,
    tailStart,
  });
  const central = archive.subarray(
    end.centralDirectoryOffset,
    end.centralDirectoryOffset + end.centralDirectorySize,
  );
  return { archive, end, central };
}

function sampleManifest() {
  return {
    schemaVersion: "whymelabs.fjd-sample-corpus.v1",
    redistribution: "not-granted",
    fixtures: [
      {
        id: "fjd-room-gaussian",
        role: "gaussian_splat",
        source: {
          provider: "google-drive",
          fileId: "gaussian-file-id",
          archiveSizeBytes: 1000,
          archiveEntryCount: 1,
          centralDirectorySizeBytes: 100,
          centralDirectoryOffset: 878,
          zipEntry: {
            name: "result/room_Gaussian.ply",
            compressionMethod: 8,
            crc32: "12345678",
            compressedSizeBytes: 50,
            uncompressedSizeBytes: 123,
            localHeaderOffset: 0,
          },
        },
        fileName: "room-gaussian.ply",
        sizeBytes: 123,
        sha256: "b".repeat(64),
        inspection: {
          headerBytes: 100,
          vertexCount: 10,
          sphericalHarmonicDegree: 0,
          propertyCount: 14,
        },
      },
      {
        id: "fjd-indoor-las",
        role: "metric_point_cloud",
        source: { provider: "google-drive", fileId: "point-file-id" },
        fileName: "interior.las",
        sizeBytes: 123,
        sha256: "a".repeat(64),
      },
    ],
    qualificationCases: [{
      id: "room-tool-compatibility",
      gaussianFixtureId: "fjd-room-gaussian",
      pointCloudFixtureId: "fjd-indoor-las",
      relationship: "different-captures",
    }],
  };
}

describe("FJD official sample corpus", () => {
  it("plans selective extraction from a standard ZIP central directory", () => {
    const { archive, end, central } = zipDirectoryFixture();
    const entries = parseZipCentralDirectory(central, end.entryCount);
    const gaussian = entries.find((entry) => entry.name.endsWith("_Gaussian.ply"));
    assert.ok(gaussian);
    assert.equal(gaussian.uncompressedSizeBytes, 36);
    assert.ok([0, 8].includes(gaussian.compressionMethod));

    const localBytes = archive.subarray(gaussian.localHeaderOffset);
    const localHeaderSize = parseZipLocalHeaderSize(localBytes.subarray(0, 30));
    const header = parseZipLocalFileHeader(localBytes.subarray(0, localHeaderSize), gaussian);
    assert.equal(header.dataOffset, gaussian.localHeaderOffset + header.headerSizeBytes);
    assert.equal(header.dataEndInclusive, header.dataOffset + gaussian.compressedSizeBytes - 1);
  });

  it("rejects ZIP64 instead of silently truncating offsets", () => {
    const { archive } = zipDirectoryFixture();
    const tail = Buffer.from(archive);
    let endOffset = -1;
    for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) === 0x06054b50) {
        endOffset = offset;
        break;
      }
    }
    tail.writeUInt32LE(0xffff_ffff, endOffset + 16);
    assert.throws(
      () => parseZipEndRecord(tail, { archiveSizeBytes: tail.byteLength, tailStart: 0 }),
      /ZIP64.*not supported/,
    );
  });

  it("reads metric bounds and point count from a LAS 1.2 header", () => {
    const header = Buffer.alloc(227);
    header.write("LASF", 0, "ascii");
    header[24] = 1;
    header[25] = 2;
    header.writeUInt16LE(227, 94);
    header.writeUInt32LE(227, 96);
    header[104] = 3;
    header.writeUInt16LE(34, 105);
    header.writeUInt32LE(42, 107);
    header.writeDoubleLE(0.001, 131);
    header.writeDoubleLE(0.001, 139);
    header.writeDoubleLE(0.001, 147);
    header.writeDoubleLE(12, 179);
    header.writeDoubleLE(-4, 187);
    header.writeDoubleLE(7, 195);
    header.writeDoubleLE(-3, 203);
    header.writeDoubleLE(3, 211);
    header.writeDoubleLE(0, 219);

    assert.deepEqual(inspectLasHeader(header), {
      signature: "LASF",
      version: "1.2",
      headerSizeBytes: 227,
      pointDataOffset: 227,
      pointFormat: 3,
      pointRecordLengthBytes: 34,
      pointCount: 42,
      scale: [0.001, 0.001, 0.001],
      bounds: { min: [-4, -3, 0], max: [12, 7, 3] },
    });
  });

  it("requires pinned bytes and explicit redistribution status", () => {
    const manifest = sampleManifest();
    assert.equal(validateFjdSampleManifest(manifest), manifest);
    assert.throws(
      () => validateFjdSampleManifest({ ...manifest, redistribution: undefined }),
      /redistribution/,
    );
    assert.throws(
      () => validateFjdSampleManifest({
        ...manifest,
        fixtures: [{ ...manifest.fixtures[0], sha256: "pending" }, manifest.fixtures[1]],
      }),
      /SHA-256/,
    );
    assert.throws(
      () => validateFjdSampleManifest({
        ...manifest,
        fixtures: [{ ...manifest.fixtures[0], sha256: "0".repeat(64) }, manifest.fixtures[1]],
      }),
      /SHA-256/,
    );
    assert.throws(
      () => validateFjdSampleManifest({
        ...manifest,
        fixtures: [{
          ...manifest.fixtures[0],
          source: {
            ...manifest.fixtures[0].source,
            zipEntry: { name: "../escape.ply" },
          },
        }, manifest.fixtures[1]],
      }),
      /zipEntry/,
    );
    assert.throws(
      () => validateFjdSampleManifest({
        ...manifest,
        fixtures: [manifest.fixtures[0], {
          ...manifest.fixtures[1],
          fileName: "../../../public/vendor.las",
        }],
      }),
      /fileName/,
    );
  });

  it("requires an explicit qualification case when the manifest grows", () => {
    const manifest = sampleManifest();
    assert.equal(selectQualificationCase(manifest).id, "room-tool-compatibility");
    const expanded = {
      ...manifest,
      qualificationCases: [
        ...manifest.qualificationCases,
        { ...manifest.qualificationCases[0], id: "paired-indoor" },
      ],
    };
    assert.throws(() => selectQualificationCase(expanded), /Multiple FJD qualification cases/);
    assert.equal(selectQualificationCase(expanded, "paired-indoor").id, "paired-indoor");
  });

  it("does not promote unregistered samples to a walkable-scene claim", () => {
    assert.deepEqual(fjdQualificationGates({ relationship: "different-captures" }, {
      coordinateRegistration: "missing",
    }), {
      gaussianPlyValidation: "qualifiable",
      sparkRadBuild: "qualifiable",
      pointCloudDecode: "qualifiable",
      metricCoordinateRegistration: "blocked_missing_units_axis_origin",
      sharedCaptureFrame: "blocked_missing_paired_sample",
      privatePlatformImport: "not_run",
      browserRender: "not_run",
      automaticWalkableScene: "blocked_missing_paired_sample",
      publicRedistribution: "blocked_no_dataset_license",
    });
    const paired = fjdQualificationGates({ relationship: "shared-frame" }, {
      coordinateRegistration: "declared",
    });
    assert.equal(paired.metricCoordinateRegistration, "qualifiable");
    assert.equal(paired.sharedCaptureFrame, "qualifiable");
    assert.equal(paired.automaticWalkableScene, "qualifiable");
  });

  it("keeps a decoded LAS unregistered when PDAL reports unknown units", () => {
    const summary = {
      file_size: 161765909,
      reader: "readers.las",
      pdal_version: "2.9.2",
      summary: {
        num_points: 3851558,
        bounds: { minx: -1, miny: -2, minz: 0, maxx: 1, maxy: 2, maxz: 3 },
        metadata: { srs: { units: { horizontal: "unknown", vertical: "" } } },
      },
    };
    const result = validatePdalSummary(summary, {
      sizeBytes: 161765909,
      pointCount: 3851558,
      bounds: { min: [-1, -2, 0], max: [1, 2, 3] },
      scale: [0.001, 0.001, 0.001],
    });
    assert.equal(result.decoder, "readers.las");
    assert.equal(result.coordinateRegistration, "missing");
    assert.equal(result.horizontalUnits, "unknown");
    assert.throws(
      () => validatePdalSummary({ ...summary, summary: { ...summary.summary, num_points: 1 } }, {
        sizeBytes: 161765909,
        pointCount: 3851558,
        bounds: { min: [-1, -2, 0], max: [1, 2, 3] },
        scale: [0.001, 0.001, 0.001],
      }),
      /point_count mismatch/,
    );
    assert.throws(
      () => validatePdalSummary({
        ...summary,
        summary: { ...summary.summary, bounds: { ...summary.summary.bounds, maxz: 4 } },
      }, {
        sizeBytes: 161765909,
        pointCount: 3851558,
        bounds: { min: [-1, -2, 0], max: [1, 2, 3] },
        scale: [0.001, 0.001, 0.001],
      }),
      /bounds_max_z mismatch/,
    );
  });

  it("checks ZIP CRC while stopping an inflated entry at its pinned byte receipt", async () => {
    const meter = new IntegrityMeter({ maximumSizeBytes: 9, budgetName: "fixture_size_bytes" });
    meter.resume();
    meter.end(Buffer.from("123456789"));
    await once(meter, "finish");
    assert.equal(meter.metadata().crc32.toString(16), "cbf43926");

    const overflow = new IntegrityMeter({
      maximumSizeBytes: 3,
      budgetName: "fixture_size_bytes",
    });
    overflow.resume();
    const failed = once(overflow, "error");
    overflow.end(Buffer.from("four"));
    const [error] = await failed;
    assert.match(error.message, /fixture_size_bytes limit=3 ask=4/);
  });
});
