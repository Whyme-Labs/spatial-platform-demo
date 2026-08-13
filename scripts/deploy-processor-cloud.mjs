#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const environmentIndex = process.argv.indexOf("--env");
const environment = environmentIndex >= 0 ? process.argv[environmentIndex + 1] : null;
if (!environment || !["staging", "production"].includes(environment)) {
  console.error(
    "Usage: deploy-processor-cloud.mjs --env staging|production [wrangler deploy options]",
  );
  process.exit(1);
}
const forwarded = process.argv.slice(2).filter((value, index, values) =>
  value !== "--env" && values[index - 1] !== "--env"
);
for (const args of [["diff", "--quiet"], ["diff", "--cached", "--quiet"]]) {
  const clean = spawnSync("git", args, { cwd: repositoryRoot, stdio: "ignore" });
  if (clean.status !== 0) {
    throw new Error("Processor Worker and container must be deployed from a clean tracked checkout");
  }
}
const processorBuildInputs = [
  "package.json",
  "package-lock.json",
  "processor/Dockerfile",
  "processor/package.json",
  "processor/package-lock.json",
  "src/processor-cloud",
  "src/shared/processor-identity.ts",
  "wrangler.processor.jsonc",
  "scripts/deploy-processor-cloud.mjs",
  "scripts/stamp-processor-build.mjs",
  "scripts/processing-agent.mjs",
  "scripts/processing-agent-core.mjs",
  "scripts/poster-quality.mjs",
  "scripts/navigation-build-core.mjs",
  "scripts/physical-navigation-validation.mjs",
  "scripts/authored-collision.mjs",
  "scripts/automatic-spatial-pipeline.mjs",
  "scripts/horizontal-surface.mjs",
  "scripts/e57-structure-core.mjs",
  "scripts/shell-capture-agreement.mjs",
  "scripts/capture-compatibility-contract.mjs",
  "scripts/capture-compatibility-core.mjs",
];
const agentBuildSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim().toLowerCase();
if (!/^[a-f0-9]{40}$/.test(agentBuildSha)) {
  throw new Error(`Git returned an invalid processor build SHA: ${agentBuildSha}`);
}
if (process.env.DEPLOY_SHA && process.env.DEPLOY_SHA.toLowerCase() !== agentBuildSha) {
  throw new Error(
    `Processor checkout ${agentBuildSha} does not match DEPLOY_SHA ${process.env.DEPLOY_SHA}`,
  );
}
const dirtyBuildInputs = execFileSync(
  "git",
  ["status", "--porcelain=v1", "--untracked-files=all", "--", ...processorBuildInputs],
  { cwd: repositoryRoot, encoding: "utf8" },
).trim();
if (dirtyBuildInputs) {
  throw new Error(
    `Processor build inputs do not match stamped Git revision ${agentBuildSha}:\n${dirtyBuildInputs}`,
  );
}

run(process.execPath, [resolve(repositoryRoot, "scripts/stamp-processor-build.mjs")]);
const localTag = `spatial-processor:${agentBuildSha}`;
run("docker", [
  "build",
  "--platform",
  "linux/amd64",
  "-f",
  "processor/Dockerfile",
  "-t",
  localTag,
  ".",
]);
const pushOutput = run(process.execPath, [
  resolve(repositoryRoot, "node_modules/wrangler/bin/wrangler.js"),
  "containers",
  "push",
  localTag,
  "-c",
  "wrangler.processor.jsonc",
  "--env",
  environment,
]);
const cleanPushOutput = pushOutput.replace(/\x1b\[[0-9;]*m/g, "");
const registryImage = cleanPushOutput.match(
  /Pushed image:\s*(registry\.cloudflare\.com\/[^\s]+)/,
)?.[1];
if (!registryImage) throw new Error("Wrangler did not report the pushed registry image");
const imageDigest = cleanPushOutput.match(/digest:\s*(sha256:[a-f0-9]{64})/i)?.[1]?.toLowerCase();
if (!imageDigest) throw new Error("Wrangler did not report the pushed image digest");
const registryImageName = registryImage.replace(/:[^/:]+$/, "");
const immutableImage = `${registryImageName}@${imageDigest}`;

const sourceConfig = JSON.parse(readFileSync(
  resolve(repositoryRoot, "wrangler.processor.jsonc"),
  "utf8",
));
const selected = sourceConfig.env?.[environment];
if (!selected || !Array.isArray(selected.containers) || selected.containers.length !== 1) {
  throw new Error(`Processor ${environment} config must declare exactly one container`);
}
selected.containers[0].image = immutableImage;
delete selected.containers[0].image_build_context;
selected.vars = {
  ...selected.vars,
  PROCESSOR_AGENT_BUILD_SHA: agentBuildSha,
  PROCESSOR_IMAGE_DIGEST: imageDigest,
};
const generatedConfig = resolve(
  repositoryRoot,
  `.wrangler.processor.deploy-${process.pid}.jsonc`,
);
writeFileSync(generatedConfig, `${JSON.stringify(sourceConfig, null, 2)}\n`, { mode: 0o600 });
let deployOutput;
try {
  deployOutput = run(process.execPath, [
    resolve(repositoryRoot, "node_modules/wrangler/bin/wrangler.js"),
    "deploy",
    "-c",
    generatedConfig,
    "--env",
    environment,
    ...forwarded,
  ]);
} finally {
  unlinkSync(generatedConfig);
}
const workerVersion = deployOutput.match(/Current Version ID:\s*([0-9a-f-]+)/)?.[1];
if (!workerVersion) throw new Error("Wrangler did not report the deployed processor Worker version");
console.log(`PROCESSOR_AGENT_BUILD_SHA=${agentBuildSha}`);
console.log(`PROCESSOR_IMAGE_NAME=${registryImageName}`);
console.log(`PROCESSOR_IMAGE_DIGEST=${imageDigest}`);
console.log(`PROCESSOR_WORKER_VERSION=${workerVersion}`);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.slice(0, 4).join(" ")} exited ${result.status}`);
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}
