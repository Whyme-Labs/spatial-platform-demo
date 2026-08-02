import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parsePlySceneSignature } from "./processing-agent-core.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const upstreamRoot = join(repositoryRoot, ".cache", "open-corpus", "upstream");
const reportPath = join(
  repositoryRoot,
  ".cache",
  "open-corpus",
  "reports",
  "pdal-container-verification.json",
);
const image = process.env.PROCESSOR_IMAGE ?? "spatial-processor:0.10.0";
const fixtures = [
  { id: "ply", fileName: "pdal-issue-2421.ply" },
  { id: "las", fileName: "pdal-simple.las" },
  { id: "laz", fileName: "pdal-simple.laz" },
  { id: "e57", fileName: "pdal-a4.e57" },
  { id: "pts", fileName: "pdal-test.pts" },
];

const workDirectory = await mkdtemp(join(tmpdir(), "spatial-pdal-"));
const results = [];
try {
  for (const fixture of fixtures) {
    const inputPath = join(upstreamRoot, fixture.fileName);
    await readFile(inputPath).catch(() => {
      throw new Error(`Missing ${fixture.fileName}; run npm run corpus:fetch first`);
    });
    const outputPath = join(workDirectory, `${fixture.id}.ply`);
    const startedAt = performance.now();
    const { stderr } = await execFileAsync("docker", [
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--volume",
      `${inputPath}:/input/source.${fixture.id}:ro`,
      "--volume",
      `${workDirectory}:/output`,
      "--entrypoint",
      "/opt/conda/bin/pdal",
      image,
      "translate",
      `/input/source.${fixture.id}`,
      `/output/${fixture.id}.ply`,
    ], {
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const output = await readFile(outputPath);
    const signature = parsePlySceneSignature(output);
    results.push({
      fixture: fixture.fileName,
      sourceFormat: fixture.id,
      normalizedFormat: "ply",
      vertexCount: signature.vertexCount,
      sampledPointCount: signature.sampledPointCount,
      outputBytes: output.byteLength,
      durationMs: Math.round(performance.now() - startedAt),
      stderr: stderr.trim() || null,
    });
  }
  const report = {
    schemaVersion: "whymelabs.pdal-container-verification.v1",
    verifiedAt: new Date().toISOString(),
    image,
    pdalVersion: "2.9.2",
    result: "pass",
    fixtures: results,
    limitation:
      "These pinned upstream fixtures prove decoder and metric-PLY normalisation compatibility; they are not indoor floor-plan accuracy evidence.",
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    event: "pdal.container.verify.completed",
    fixtureCount: results.length,
    reportPath,
  })}\n`);
} finally {
  await rm(workDirectory, { recursive: true, force: true });
}
