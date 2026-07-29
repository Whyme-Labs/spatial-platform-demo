#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  convertPointCloudToDegreeZeroGaussian,
  lingbotGaussianDefaults,
} from "./lingbot-gaussian-core.mjs";

const options = parseArguments(process.argv.slice(2));
if (!options.source || !options.output) {
  console.error([
    "Usage: npm run lingbot:gaussian -- --source <pointcloud.ply> --output <derived.gaussian.ply>",
    `  [--manifest <manifest.json>] [--scale-meters ${lingbotGaussianDefaults.scaleMeters}] [--alpha ${lingbotGaussianDefaults.alpha}]`,
    `  [--coordinate-transform ${lingbotGaussianDefaults.coordinateTransform}|none]`,
  ].join("\n"));
  process.exitCode = 2;
} else {
  const sourcePath = resolve(options.source);
  const outputPath = resolve(options.output);
  const manifestPath = resolve(options.manifest ?? `${outputPath}.manifest.json`);
  const result = await convertPointCloudToDegreeZeroGaussian({
    sourcePath,
    outputPath,
    scaleMeters: numberOption(
      options["scale-meters"],
      lingbotGaussianDefaults.scaleMeters,
    ),
    alpha: numberOption(options.alpha, lingbotGaussianDefaults.alpha),
    coordinateTransform: options["coordinate-transform"]
      ?? lingbotGaussianDefaults.coordinateTransform,
  });
  const manifest = {
    ...result,
    generatedAt: new Date().toISOString(),
    generator: "scripts/lingbot-gaussian.mjs",
    parameters: {
      scaleRationale: "User-selected isotropic surfel scale; tune this to source density and the intended viewing distance.",
      opacityEncoding: "logit(alpha)",
      colorEncoding: "degree-0 spherical harmonics from sRGB bytes",
      rotationEncoding: "identity quaternion",
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({
    outputPath,
    manifestPath,
    outputBytes: result.outputBytes,
    outputVertexCount: result.outputVertexCount,
    outputSha256: result.outputSha256,
  }, null, 2));
}

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument ${argument}`);
    const [flag, inlineValue] = argument.slice(2).split("=", 2);
    const value = inlineValue ?? args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${flag}`);
    parsed[flag] = value;
    if (inlineValue === undefined) index += 1;
  }
  return parsed;
}

function numberOption(value, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, received ${value}`);
  return number;
}
