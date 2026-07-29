import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  convertPointCloudToDegreeZeroGaussian,
  parsePointCloudPlyHeader,
} from "../scripts/lingbot-gaussian-core.mjs";
import { validateGaussianPlyHeader } from "../scripts/processing-agent-core.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true })));
});

function pointCloudFixture() {
  const header = Buffer.from([
    "ply",
    "format binary_little_endian 1.0",
    "comment fixture",
    "element vertex 2",
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "property uchar alpha",
    "end_header",
    "",
  ].join("\n"));
  const vertices = Buffer.alloc(32);
  vertices.writeFloatLE(1, 0);
  vertices.writeFloatLE(2, 4);
  vertices.writeFloatLE(3, 8);
  vertices.set([255, 0, 128, 255], 12);
  vertices.writeFloatLE(-4, 16);
  vertices.writeFloatLE(-5, 20);
  vertices.writeFloatLE(-6, 24);
  vertices.set([0, 255, 64, 255], 28);
  return Buffer.concat([header, vertices]);
}

describe("LingBot point-cloud Gaussian derivation", () => {
  it("parses the exact binary point-cloud layout instead of treating any PLY as compatible", () => {
    expect(parsePointCloudPlyHeader(pointCloudFixture())).toMatchObject({
      format: "binary_little_endian",
      vertexCount: 2,
      vertexStride: 16,
      properties: [
        { name: "x", type: "float", offset: 0 },
        { name: "y", type: "float", offset: 4 },
        { name: "z", type: "float", offset: 8 },
        { name: "red", type: "uchar", offset: 12 },
        { name: "green", type: "uchar", offset: 13 },
        { name: "blue", type: "uchar", offset: 14 },
        { name: "alpha", type: "uchar", offset: 15 },
      ],
    });
  });

  it("writes a strict degree-0 Gaussian PLY with colour, opacity, scale, and Y-up coordinates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lingbot-gaussian-"));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, "pointcloud.ply");
    const outputPath = join(directory, "lingbot-loop.gaussian.ply");
    await writeFile(sourcePath, pointCloudFixture());

    const result = await convertPointCloudToDegreeZeroGaussian({
      sourcePath,
      outputPath,
      scaleMeters: 0.02,
      alpha: 0.9,
      coordinateTransform: "opencv-to-y-up",
    });
    const output = await readFile(outputPath);
    const gaussian = validateGaussianPlyHeader(output);
    expect(gaussian).toMatchObject({
      format: "binary_little_endian",
      vertexCount: 2,
      sphericalHarmonicDegree: 0,
    });
    expect(result).toMatchObject({
      sourceVertexCount: 2,
      outputVertexCount: 2,
      scaleMeters: 0.02,
      alpha: 0.9,
      coordinateTransform: "opencv-to-y-up",
    });

    const headerEnd = output.indexOf(Buffer.from("end_header\n")) + "end_header\n".length;
    const first = new Float32Array(
      output.buffer,
      output.byteOffset + headerEnd,
      14,
    );
    expect([...first.slice(0, 3)]).toEqual([1, -2, -3]);
    expect(first[3]).toBeCloseTo((1 - 0.5) / 0.28209479177387814, 5);
    expect(first[4]).toBeCloseTo((0 - 0.5) / 0.28209479177387814, 5);
    expect(first[5]).toBeCloseTo((128 / 255 - 0.5) / 0.28209479177387814, 5);
    expect(first[6]).toBeCloseTo(Math.log(0.9 / 0.1), 5);
    expect([...first.slice(7, 10)]).toEqual([
      expect.closeTo(Math.log(0.02), 5),
      expect.closeTo(Math.log(0.02), 5),
      expect.closeTo(Math.log(0.02), 5),
    ]);
    expect([...first.slice(10, 14)]).toEqual([1, 0, 0, 0]);
  });

  it("rejects unsupported source layouts before creating a misleading artifact", async () => {
    const ascii = Buffer.from([
      "ply",
      "format ascii 1.0",
      "element vertex 1",
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      "end_header",
      "0 0 0 255 255 255",
    ].join("\n"));
    expect(() => parsePointCloudPlyHeader(ascii)).toThrow(
      /binary_little_endian/,
    );
  });
});
