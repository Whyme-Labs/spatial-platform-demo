import { describe, expect, it } from "vitest";
import {
  createPlyCoordinateEvidenceAccumulator,
  parsePlyCoordinateDescriptor,
  PLY_COORDINATE_HEADER_BUDGET_BYTES,
  plyCoordinateHeaderBudgetError,
  preflightPairedPlyCoordinateDescriptors,
  qualifyPairedPlyCoordinateEvidence,
} from "../scripts/capture-compatibility-core.mjs";

function binaryPly(input: {
  frame: string;
  upAxis?: string;
  units?: string;
  points: Array<[number, number, number]>;
}): Uint8Array {
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    `comment spatial_studio_coordinate_frame ${input.frame}`,
    `comment spatial_studio_up_axis ${input.upAxis ?? "Y"}`,
    `comment spatial_studio_units ${input.units ?? "metres"}`,
    `element vertex ${input.points.length}`,
    "property float x",
    "property float y",
    "property float z",
    "end_header",
    "",
  ].join("\n");
  const headerBytes = new TextEncoder().encode(header);
  const result = new Uint8Array(headerBytes.length + input.points.length * 12);
  result.set(headerBytes);
  const view = new DataView(result.buffer);
  input.points.forEach((point, pointIndex) => point.forEach((value, axis) => {
    view.setFloat32(headerBytes.length + pointIndex * 12 + axis * 4, value, true);
  }));
  return result;
}

function evidence(bytes: Uint8Array) {
  const descriptor = parsePlyCoordinateDescriptor(bytes);
  const accumulator = createPlyCoordinateEvidenceAccumulator(descriptor);
  const body = bytes.subarray(descriptor.dataOffset);
  const split = Math.floor(body.length / 2);
  accumulator.consume(body.subarray(0, split));
  accumulator.consume(body.subarray(split));
  return accumulator.finish();
}

describe("paired PLY coordinate qualification", () => {
  it("proves a matching metric Y-up frame and exact overlapping bounds from streamed vertices", () => {
    const visual = evidence(binaryPly({
      frame: "scanner-run-42",
      points: [[0, 0, 0], [10, 3, 8]],
    }));
    const geometry = evidence(binaryPly({
      frame: "scanner-run-42",
      points: [[1, 0, 1], [9, 2.5, 7]],
    }));

    expect(qualifyPairedPlyCoordinateEvidence(visual, geometry)).toEqual({
      qualified: true,
      method: "automatic-ply-coordinate-evidence-v1",
      coordinateFrameId: "scanner-run-42",
      sourceUpAxis: "Y",
      worldUnit: "metres",
      overlapBounds: { min: [1, 0, 1], max: [9, 2.5, 7] },
      visual,
      geometry,
    });
  });

  it("blocks different frames, units, axes, and disjoint bounds instead of guessing", () => {
    const baseline = evidence(binaryPly({
      frame: "scanner-run-42",
      points: [[0, 0, 0], [2, 2, 2]],
    }));
    const candidates = [
      evidence(binaryPly({ frame: "another-run", points: [[0, 0, 0], [2, 2, 2]] })),
      evidence(binaryPly({ frame: "scanner-run-42", units: "feet", points: [[0, 0, 0], [2, 2, 2]] })),
      evidence(binaryPly({ frame: "scanner-run-42", upAxis: "Z", points: [[0, 0, 0], [2, 2, 2]] })),
      evidence(binaryPly({ frame: "scanner-run-42", points: [[3, 3, 3], [4, 4, 4]] })),
    ];

    expect(candidates.map((candidate) => qualifyPairedPlyCoordinateEvidence(baseline, candidate))).toEqual([
      { qualified: false, reason: "The two PLY files declare different coordinate frame identities." },
      { qualified: false, reason: "Automatic qualification requires both PLY files to declare metre units." },
      { qualified: false, reason: "Automatic qualification requires both PLY files to declare a Y-up axis." },
      { qualified: false, reason: "The exact PLY bounds do not overlap in their declared shared frame." },
    ]);
  });

  it("distinguishes unavailable metadata from metadata that explicitly contradicts attestation", () => {
    const visual = parsePlyCoordinateDescriptor(binaryPly({
      frame: "scanner-run-42",
      points: [[0, 0, 0]],
    }));
    const differentFrame = parsePlyCoordinateDescriptor(binaryPly({
      frame: "another-run",
      points: [[0, 0, 0]],
    }));
    const wrongUnit = parsePlyCoordinateDescriptor(binaryPly({
      frame: "scanner-run-42",
      units: "feet",
      points: [[0, 0, 0]],
    }));

    expect(preflightPairedPlyCoordinateDescriptors(visual, visual)).toEqual({ status: "qualified" });
    expect(preflightPairedPlyCoordinateDescriptors(visual, differentFrame)).toMatchObject({
      status: "contradicted",
    });
    expect(preflightPairedPlyCoordinateDescriptors(visual, wrongUnit)).toMatchObject({
      status: "contradicted",
    });
  });

  it("requires explicit coordinate metadata and all declared vertices", () => {
    const incompleteHeader = new TextEncoder().encode([
      "ply",
      "format binary_little_endian 1.0",
      "element vertex 1",
      "property float x",
      "property float y",
      "property float z",
      "end_header",
      "",
    ].join("\n"));
    expect(() => parsePlyCoordinateDescriptor(incompleteHeader)).toThrow(
      "PLY has no spatial_studio_coordinate_frame comment",
    );

    const complete = binaryPly({ frame: "scanner-run-42", points: [[0, 0, 0], [1, 1, 1]] });
    const descriptor = parsePlyCoordinateDescriptor(complete);
    const accumulator = createPlyCoordinateEvidenceAccumulator(descriptor);
    accumulator.consume(complete.subarray(descriptor.dataOffset, complete.length - descriptor.recordBytes));
    expect(() => accumulator.finish()).toThrow("asked_vertices=2, observed_vertices=1");
  });

  it("fails closed when any binary element precedes the vertex records", () => {
    const bytes = binaryPly({ frame: "scanner-run-42", points: [[0, 0, 0]] });
    const headerEnd = new TextDecoder().decode(bytes).indexOf("element vertex 1");
    const prefix = new TextEncoder().encode("element camera 1\nproperty float focal\n");
    const malformed = new Uint8Array(bytes.length + prefix.length);
    malformed.set(bytes.subarray(0, headerEnd));
    malformed.set(prefix, headerEnd);
    malformed.set(bytes.subarray(headerEnd), headerEnd + prefix.length);

    expect(() => parsePlyCoordinateDescriptor(malformed)).toThrow(
      "requires the vertex element first",
    );
  });

  it("names the receipted header budget, limit, and first rejected request", () => {
    expect(plyCoordinateHeaderBudgetError().message).toBe(
      `PLY header exceeds budget=ply_coordinate_header_bytes, ` +
        `limit=${PLY_COORDINATE_HEADER_BUDGET_BYTES}, ` +
        `requested=${PLY_COORDINATE_HEADER_BUDGET_BYTES + 1}`,
    );
  });
});
