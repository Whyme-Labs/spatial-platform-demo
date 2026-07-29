import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  runStagingHttpAcceptance,
  validateDeploymentStatus,
  validateRemoteD1Probe,
} from "./staging-acceptance-core.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const argumentsSet = new Set(process.argv.slice(2));
const httpOnly = argumentsSet.has("--http-only");
const appOrigin = process.env.STAGING_APP_ORIGIN
  ?? "https://spatial-studio-staging.swmengappdev.workers.dev";
const processorOrigin = process.env.STAGING_PROCESSOR_ORIGIN
  ?? "https://spatial-processor-cloud-staging.swmengappdev.workers.dev";
const expectedTurnstileSiteKey = process.env.STAGING_TURNSTILE_SITE_KEY
  ?? "1x00000000000000000000AA";
const propagationTimeoutMs = boundedInteger(
  process.env.STAGING_ACCEPTANCE_PROPAGATION_SECONDS,
  90,
  0,
  300,
) * 1_000;
const reportPath = resolve(
  process.env.STAGING_ACCEPTANCE_REPORT
    ?? ".cache/staging-acceptance/report.json",
);
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`;
const report = {
  schemaVersion: 1,
  runId,
  startedAt: new Date().toISOString(),
  mode: httpOnly ? "http-only" : "deployed-bindings",
  gitSha: process.env.GITHUB_SHA ?? await gitSha(),
  status: "running",
  http: null,
  httpAttempts: 0,
  cloudflare: null,
  cleanup: [],
};

try {
  const httpResult = await runHttpAcceptanceWithPropagationRetry();
  report.http = httpResult.acceptance;
  report.httpAttempts = httpResult.attempts;
  if (!httpOnly) {
    report.cloudflare = await runCloudflareAcceptance(runId, report.cleanup);
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = {
    name: error instanceof Error ? error.name : "Error",
    message: redact(error instanceof Error ? error.message : String(error)),
  };
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function runHttpAcceptanceWithPropagationRetry() {
  const deadline = Date.now() + propagationTimeoutMs;
  let attempts = 0;
  while (true) {
    attempts += 1;
    try {
      return {
        acceptance: await runStagingHttpAcceptance({
          appOrigin,
          processorOrigin,
          expectedEnvironment: "staging",
          expectedTurnstileSiteKey,
        }),
        attempts,
      };
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
    }
  }
}

async function runCloudflareAcceptance(currentRunId, cleanup) {
  const evidence = {};
  evidence.applicationDeployment = validateDeploymentStatus(
    parseJsonOutput(await wrangler([
      "deployments", "status", "--env", "staging", "--json",
    ])),
    "spatial-studio-staging",
  );
  evidence.processorDeployment = validateDeploymentStatus(
    parseJsonOutput(await wrangler([
      "deployments", "status",
      "--config", "wrangler.processor.jsonc",
      "--env", "staging",
      "--json",
    ])),
    "spatial-processor-cloud-staging",
  );

  const d1 = parseJsonOutput(await wrangler([
    "d1", "execute", "DB",
    "--env", "staging",
    "--remote",
    "--command",
    "SELECT 1 AS ready, COUNT(*) AS migration_count FROM d1_migrations",
    "--json",
  ]));
  evidence.d1 = validateRemoteD1Probe(d1);

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "spatial-staging-acceptance-"));
  const objectKey = `acceptance-canaries/${currentRunId}.json`;
  const objectPath = `spatial-studio-assets-staging/${objectKey}`;
  const sourcePath = join(temporaryDirectory, "r2-source.json");
  const downloadedPath = join(temporaryDirectory, "r2-downloaded.json");
  const objectPayload = `${JSON.stringify({
    schemaVersion: 1,
    runId: currentRunId,
    purpose: "staging-acceptance-canary",
  })}\n`;
  let r2Stored = false;
  const kvKey = `acceptance:${currentRunId}`;
  const kvValue = `spatial-staging-acceptance:${currentRunId}`;
  let kvStored = false;

  try {
    await writeFile(sourcePath, objectPayload, { mode: 0o600 });
    await wrangler([
      "r2", "object", "put", objectPath,
      "--remote",
      "--file", sourcePath,
      "--content-type", "application/json",
      "--force",
    ]);
    r2Stored = true;
    await wrangler([
      "r2", "object", "get", objectPath,
      "--remote",
      "--file", downloadedPath,
    ]);
    const downloaded = await readFile(downloadedPath, "utf8");
    if (downloaded !== objectPayload) {
      throw new Error("Remote R2 canary did not round-trip exact bytes");
    }
    evidence.r2 = {
      bucket: "spatial-studio-assets-staging",
      objectKey,
      bytes: Buffer.byteLength(downloaded),
      exactRoundTrip: true,
    };

    await wrangler([
      "kv", "key", "put", kvKey, kvValue,
      "--binding", "AUTH_CACHE",
      "--env", "staging",
      "--remote",
      "--ttl", "300",
    ]);
    kvStored = true;
    const observedValue = await retryKvRead(kvKey, kvValue);
    evidence.kv = {
      binding: "AUTH_CACHE",
      keyPrefix: "acceptance:",
      exactRoundTrip: observedValue === kvValue,
    };
  } finally {
    if (kvStored) {
      try {
        await wrangler([
          "kv", "key", "delete", kvKey,
          "--binding", "AUTH_CACHE",
          "--env", "staging",
          "--remote",
        ]);
        cleanup.push({ resource: "kv", key: kvKey, status: "deleted" });
      } catch (error) {
        cleanup.push({
          resource: "kv",
          key: kvKey,
          status: "failed",
          error: redact(error instanceof Error ? error.message : String(error)),
        });
      }
    }
    if (r2Stored) {
      try {
        await wrangler(["r2", "object", "delete", objectPath, "--remote"]);
        cleanup.push({ resource: "r2", key: objectKey, status: "deleted" });
      } catch (error) {
        cleanup.push({
          resource: "r2",
          key: objectKey,
          status: "failed",
          error: redact(error instanceof Error ? error.message : String(error)),
        });
      }
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  if (cleanup.some((item) => item.status !== "deleted")) {
    throw new Error("One or more staging canary resources could not be removed");
  }
  return evidence;
}

async function retryKvRead(key, expected) {
  const deadline = Date.now() + 65_000;
  let lastObserved = "";
  while (Date.now() < deadline) {
    lastObserved = (await wrangler([
      "kv", "key", "get", key,
      "--binding", "AUTH_CACHE",
      "--env", "staging",
      "--remote",
      "--text",
    ])).trim();
    if (lastObserved === expected) return lastObserved;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  throw new Error(
    `Remote KV canary did not become readable within 65 seconds (observed ${lastObserved.length} bytes)`,
  );
}

async function wrangler(args) {
  const executable = resolve(repositoryRoot, "node_modules/wrangler/bin/wrangler.js");
  return await runCommand(process.execPath, [executable, ...args]);
}

async function gitSha() {
  try {
    return (await runCommand("git", ["rev-parse", "HEAD"])).trim();
  } catch {
    return null;
  }
}

async function runCommand(command, args) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 4 * 1024 * 1024) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 4 * 1024 * 1024) child.kill("SIGTERM");
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      rejectPromise(new Error(
        `${command} ${args.slice(0, 3).join(" ")} failed with exit ${code}: ${
          redact(stderr || stdout).trim().slice(0, 2_000)
        }`,
      ));
    });
  });
}

function parseJsonOutput(output) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Cloudflare command did not return JSON: ${redact(output).slice(0, 500)}`);
  }
}

function redact(value) {
  let result = String(value);
  for (const secretName of ["CLOUDFLARE_API_TOKEN"]) {
    const secret = process.env[secretName];
    if (secret) result = result.replaceAll(secret, "<redacted>");
  }
  return result.replaceAll(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer <redacted>");
}

function boundedInteger(raw, fallback, minimum, maximum) {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `Expected an integer between ${minimum} and ${maximum}, received ${String(raw)}`,
    );
  }
  return parsed;
}
