#!/usr/bin/env node
// Synthetic processor canary: proves a deployed processor end to end using
// only the credentials CI already holds. The driver plants a tiny immutable
// input in R2, inserts a QUEUED `canary.roundtrip-v1` job through reviewed
// SQL, and then only OBSERVES: the deployed application Worker's minutely
// reconciler dispatches the job onto the real queue, the deployed processor
// Worker consumes it, the container image boots, authenticates back to the
// application with WORKER_API_TOKEN, leases the job, heartbeats, uploads a
// deterministic output, and files a completion receipt. The driver then
// re-downloads the output from R2, recomputes its SHA-256, and compares it
// against both the declared digest and the locally computed expectation —
// the output is a pure function of the input, so any divergence is a real
// pipeline defect, not noise.
//
// Execution-side failures are retried with a FRESH job (bounded): container
// image rollouts propagate asynchronously after `wrangler deploy` returns,
// so the first job after a deploy can land on an instance still running the
// previous image — observed live as the old code shoving the canary input
// through the Spark lane. A SUCCEEDED job whose verification fails is NEVER
// retried: determinism means that is a real defect. Every per-run resource
// is deleted per attempt, and a cleanup failure in ANY attempt fails the
// canary even if a later attempt goes green — leaked rows are a defect too.
// The four fixed fixture rows (synthetic user/organisation/project/version)
// are inert, carry no release or publication, and are excluded from real
// lifecycle transitions by job type.
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { processorCanaryOutput } from "./processing-agent-core.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

const FIXTURES = {
  userId: "caaa0000-0000-4000-8000-00000000000f",
  organisationId: "caaa0000-0000-4000-8000-000000000001",
  projectId: "caaa0000-0000-4000-8000-000000000002",
  versionId: "caaa0000-0000-4000-8000-000000000003",
};
const CANARY_JOB_TYPE = "canary.roundtrip-v1";
const RETRY_DELAY_MS = 90_000;

function argValue(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const environment = argValue("--env");
if (!["staging", "production"].includes(environment ?? "")) {
  console.error("Usage: processor-canary.mjs --env staging|production [--report <path>] [--timeout-seconds N] [--attempts N]");
  process.exit(1);
}
if (!process.env.CLOUDFLARE_ACCOUNT_ID || (process.env.CI === "true" && !process.env.CLOUDFLARE_API_TOKEN)) {
  console.error("::error::CLOUDFLARE_ACCOUNT_ID (and CLOUDFLARE_API_TOKEN in CI) are required; local runs may use wrangler OAuth");
  process.exit(1);
}
const reportPath = argValue("--report");
const timeoutSeconds = Number(argValue("--timeout-seconds", "720"));
const pollSeconds = Number(argValue("--poll-seconds", "10"));
const maxAttempts = Number(argValue("--attempts", "3"));
const bucket = `spatial-studio-assets-${environment}`;

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function wrangler(args, { timeoutMs = 180_000 } = {}) {
  const executable = resolve(repositoryRoot, "node_modules/wrangler/bin/wrangler.js");
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [executable, ...args], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`wrangler ${args.slice(0, 3).join(" ")} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(stdout);
      // Wrangler reports API errors on stdout under --json; include both.
      else reject(new Error(`wrangler ${args.slice(0, 3).join(" ")} exited ${code}: ${stderr.slice(-1500)} ${stdout.slice(-1500)}`.trim()));
    });
  });
}

async function d1(command) {
  const output = await wrangler([
    "d1", "execute", "DB",
    "--env", environment,
    "--remote",
    "--command", command,
    "--json",
  ]);
  const jsonStart = output.indexOf("[");
  if (jsonStart < 0) throw new Error(`wrangler d1 execute produced no JSON: ${output.slice(0, 500)}`);
  return JSON.parse(output.slice(jsonStart));
}

class CanaryFailure extends Error {
  constructor(message, { retryable }) {
    super(message);
    this.retryable = retryable;
  }
}

async function runCanaryAttempt(attemptNumber) {
  const runId = randomUUID();
  const jobId = randomUUID();
  const assetId = randomUUID();
  const nonce = randomUUID();
  const inputPayload = `${JSON.stringify({ schemaVersion: "processor-canary-input-v1", nonce })}\n`;
  const inputSha256 = sha256Hex(inputPayload);
  const inputBytes = Buffer.byteLength(inputPayload);
  const expectedOutput = processorCanaryOutput({ nonce }, inputSha256);
  const expectedOutputSha256 = sha256Hex(expectedOutput);
  const inputObjectKey = `raw-private/${FIXTURES.organisationId}/${FIXTURES.projectId}/${FIXTURES.versionId}/${assetId}/canary-input.json`;
  const startedAt = Date.now();

  const attempt = {
    attempt: attemptNumber,
    jobId,
    assetId,
    nonce,
    inputSha256,
    expectedOutputSha256,
    verification: null,
    cleanup: [],
    cleanupOk: true,
    ok: false,
    retryable: false,
  };
  let outputObjectKey = null;
  let inputStored = false;

  const workDirectory = await mkdtemp(join(tmpdir(), "processor-canary-"));
  const inputPath = join(workDirectory, "canary-input.json");
  await writeFile(inputPath, inputPayload, { mode: 0o600 });

  try {
    // The immutable input must exist in R2 BEFORE the job row becomes
    // dispatchable — the container downloads and digest-checks it.
    try {
      await wrangler([
        "r2", "object", "put", `${bucket}/${inputObjectKey}`,
        "--remote",
        "--file", inputPath,
        "--content-type", "application/json",
        "--force",
      ]);
      inputStored = true;
      await d1([
        `INSERT OR IGNORE INTO users (id, email, display_name) VALUES ('${FIXTURES.userId}', 'deployment-canary@synthetic.invalid', 'Deployment canary (synthetic)')`,
        `INSERT OR IGNORE INTO organisations (id, name, slug) VALUES ('${FIXTURES.organisationId}', 'Deployment canary (synthetic)', 'deployment-canary-synthetic')`,
        `INSERT OR IGNORE INTO projects (id, organisation_id, name, slug, status, capture_adapter, delivery_template, created_by) VALUES ('${FIXTURES.projectId}', '${FIXTURES.organisationId}', 'Processor canary (synthetic)', 'processor-canary', 'DRAFT', 'open-import', 'Property showcase', '${FIXTURES.userId}')`,
        `INSERT OR IGNORE INTO scene_versions (id, project_id, version_number, status, created_by) VALUES ('${FIXTURES.versionId}', '${FIXTURES.projectId}', 1, 'INGESTED', '${FIXTURES.userId}')`,
        `INSERT INTO assets (id, organisation_id, project_id, version_id, kind, format, object_key, file_name, mime_type, size_bytes, sha256, integrity_status, integrity_source) VALUES ('${assetId}', '${FIXTURES.organisationId}', '${FIXTURES.projectId}', '${FIXTURES.versionId}', 'source', 'json', '${inputObjectKey}', 'canary-input.json', 'application/json', ${inputBytes}, '${inputSha256}', 'verified', 'client_declared')`,
        `INSERT INTO processing_jobs (id, organisation_id, project_id, version_id, input_asset_id, job_type, processor_version, idempotency_key, state, priority, max_attempts) VALUES ('${jobId}', '${FIXTURES.organisationId}', '${FIXTURES.projectId}', '${FIXTURES.versionId}', '${assetId}', '${CANARY_JOB_TYPE}', 'spatial-processor/0.16.0', 'canary-${runId}', 'QUEUED', 1000, 2)`,
      ].join("; "));
    } catch (setupError) {
      throw new CanaryFailure(`setup failed: ${setupError.message}`, { retryable: true });
    }

    console.log(`Canary attempt ${attemptNumber}: job ${jobId} queued in ${environment}; waiting for the deployed pipeline...`);
    const deadline = Date.now() + timeoutSeconds * 1000;
    let row = null;
    for (;;) {
      const result = await d1(
        `SELECT state, leased_by, heartbeat_at, completed_at, output_json, error_json, evidence_json FROM processing_jobs WHERE id = '${jobId}'`,
      );
      row = result[0]?.results?.[0] ?? null;
      if (!row) throw new CanaryFailure("canary job row disappeared while polling", { retryable: false });
      if (["SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTER"].includes(row.state)) break;
      if (Date.now() > deadline) {
        // A stuck rollout can starve container starts; a fresh attempt is
        // allowed to try again against the settled deployment.
        throw new CanaryFailure(
          `canary job still ${row.state} after ${timeoutSeconds} s (leased_by=${row.leased_by ?? "never"})`,
          { retryable: true },
        );
      }
      await delay(pollSeconds * 1000);
    }
    if (row.state !== "SUCCEEDED") {
      // Execution-side failure: plausibly an instance still on the previous
      // image (rollouts propagate after the deploy command returns), so a
      // fresh job may be served by the new image.
      throw new CanaryFailure(
        `canary job ended ${row.state}: ${row.error_json ?? "no error recorded"}`,
        { retryable: true },
      );
    }

    // The completion handler rewrites declared outputs into asset summaries
    // ({id, kind, format, sizeBytes}) and mints one immutable assets row per
    // output — object key and processor-declared digest live on that row.
    const outputRecord = JSON.parse(row.output_json ?? "{}");
    const outputs = outputRecord.outputs ?? [];
    const evidence = JSON.parse(row.evidence_json ?? "{}");
    const failures = [];
    if (!String(row.leased_by ?? "").startsWith("cloudflare-container:")) {
      failures.push(`job was executed by ${row.leased_by ?? "nobody"}, not a Cloudflare container`);
    }
    if (!row.heartbeat_at) failures.push("no heartbeat was ever recorded");
    if (!row.completed_at) failures.push("no completion time was recorded");
    if (outputs.length !== 1 || outputs[0].kind !== "report") {
      failures.push(`expected exactly one report output, got ${JSON.stringify(outputs.map((o) => o.kind))}`);
    }
    if (outputRecord.report?.nonce !== nonce) failures.push("completion receipt does not echo the canary nonce");
    if (outputRecord.report?.inputSha256 !== inputSha256) failures.push("completion receipt reports a different input digest");
    if (!evidence.processorVersion) failures.push("execution receipt is missing processorVersion");
    if (!evidence.completedAt) failures.push("execution receipt is missing completedAt");
    let storedOutputSha256 = null;
    let declaredOutputSha256 = null;
    const outputAssetId = outputs[0]?.id;
    if (outputAssetId && /^[0-9a-f-]{36}$/.test(outputAssetId)) {
      const assetResult = await d1(
        `SELECT object_key, sha256, size_bytes FROM assets WHERE id = '${outputAssetId}'`,
      );
      const outputAsset = assetResult[0]?.results?.[0] ?? null;
      if (!outputAsset) {
        failures.push(`completion summary names asset ${outputAssetId}, but no such assets row exists`);
      } else {
        outputObjectKey = outputAsset.object_key;
        declaredOutputSha256 = (outputAsset.sha256 ?? "").toLowerCase() || null;
        if (!outputObjectKey.startsWith(`reports-private/${FIXTURES.organisationId}/${FIXTURES.projectId}/${FIXTURES.versionId}/${jobId}/`)) {
          failures.push(`output landed at unexpected key ${outputObjectKey}`);
        }
        if (declaredOutputSha256 !== expectedOutputSha256) {
          failures.push(`declared output digest ${declaredOutputSha256} differs from the deterministic expectation`);
        }
        const outputPath = join(workDirectory, "canary-output.json");
        await wrangler(["r2", "object", "get", `${bucket}/${outputObjectKey}`, "--remote", "--file", outputPath]);
        const storedBytes = await readFile(outputPath);
        storedOutputSha256 = sha256Hex(storedBytes);
        if (storedOutputSha256 !== expectedOutputSha256) {
          failures.push(`stored output digest ${storedOutputSha256} differs from the deterministic expectation ${expectedOutputSha256}`);
        }
      }
    } else {
      failures.push("completion summary names no output asset");
    }

    attempt.verification = {
      state: row.state,
      leasedBy: row.leased_by,
      heartbeatAt: row.heartbeat_at,
      completedAt: row.completed_at,
      processorVersion: evidence.processorVersion ?? null,
      outputAssetId: outputAssetId ?? null,
      outputObjectKey,
      declaredOutputSha256,
      storedOutputSha256,
      roundTripMs: Date.now() - startedAt,
      failures,
    };
    if (failures.length > 0) {
      // The job SUCCEEDED but its evidence is wrong: deterministic, real,
      // and never retried away.
      throw new CanaryFailure(`verification failed: ${failures.join("; ")}`, { retryable: false });
    }
    attempt.ok = true;
  } catch (error) {
    attempt.error = String(error?.message ?? error);
    attempt.retryable = error instanceof CanaryFailure ? error.retryable : true;
  } finally {
    // Cleanup sweeps the ENTIRE synthetic fixture version — every canary
    // job, every asset row, every stored object — not just this run's ids,
    // so a leak from an earlier failed attempt is collected by the next one.
    // The fixture version carries nothing but canary artifacts by
    // construction, and fixture statuses are reset in case a pre-canary
    // application revision flipped them.
    const objectKeys = new Set(
      [inputStored ? inputObjectKey : null, outputObjectKey].filter(Boolean),
    );
    try {
      const assetRows = await d1(`SELECT object_key FROM assets WHERE version_id = '${FIXTURES.versionId}'`);
      for (const assetRow of assetRows[0]?.results ?? []) objectKeys.add(assetRow.object_key);
    } catch (enumerateError) {
      attempt.cleanup.push({ resource: "asset-enumeration", status: "failed", error: String(enumerateError?.message ?? enumerateError) });
      attempt.cleanupOk = false;
    }
    const canaryJobs = `SELECT id FROM processing_jobs WHERE version_id = '${FIXTURES.versionId}' AND job_type = '${CANARY_JOB_TYPE}'`;
    const cleanupSteps = [
      ["d1-rows", () => d1([
        `DELETE FROM job_output_parts WHERE output_upload_id IN (SELECT id FROM job_output_uploads WHERE job_id IN (${canaryJobs}))`,
        `DELETE FROM job_output_uploads WHERE job_id IN (${canaryJobs})`,
        `DELETE FROM qa_reports WHERE version_id = '${FIXTURES.versionId}'`,
        `DELETE FROM processing_jobs WHERE version_id = '${FIXTURES.versionId}' AND job_type = '${CANARY_JOB_TYPE}'`,
        `DELETE FROM assets WHERE version_id = '${FIXTURES.versionId}'`,
        `UPDATE scene_versions SET status = 'INGESTED', updated_at = datetime('now') WHERE id = '${FIXTURES.versionId}'`,
        `UPDATE projects SET status = 'DRAFT', updated_at = datetime('now') WHERE id = '${FIXTURES.projectId}'`,
      ].join("; "))],
      ...[...objectKeys].map((objectKey) => [
        `r2:${objectKey.split("/").slice(-2).join("/")}`,
        () => wrangler(["r2", "object", "delete", `${bucket}/${objectKey}`, "--remote"]),
      ]),
    ];
    for (const [resource, run] of cleanupSteps) {
      try {
        await run();
        attempt.cleanup.push({ resource, status: "deleted" });
      } catch (cleanupError) {
        attempt.cleanup.push({ resource, status: "failed", error: String(cleanupError?.message ?? cleanupError) });
        attempt.cleanupOk = false;
      }
    }
  }
  return attempt;
}

async function main() {
  const attempts = [];
  for (let n = 1; n <= maxAttempts; n += 1) {
    const attempt = await runCanaryAttempt(n);
    attempts.push(attempt);
    if (attempt.ok || !attempt.retryable) break;
    if (n < maxAttempts) {
      console.log(`Canary attempt ${n} failed (${attempt.error}); retrying with a fresh job in ${RETRY_DELAY_MS / 1000} s — a container rollout may still be propagating`);
      await delay(RETRY_DELAY_MS);
    }
  }
  const last = attempts[attempts.length - 1];
  const cleanupOk = attempts.every((attempt) => attempt.cleanupOk);
  const report = {
    schemaVersion: "processor-canary-run-v2",
    environment,
    jobType: CANARY_JOB_TYPE,
    attempts,
    cleanupOk,
    ok: last.ok && cleanupOk,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) await writeFile(reportPath, serialized);
  console.log(serialized);
  if (!report.ok) {
    const reason = !last.ok ? last.error : "cleanup left resources behind — see the report";
    throw new Error(reason);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`::error::processor canary: ${String(error?.message ?? error)}`);
    process.exit(1);
  },
);
