#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function missingMigrationNames(localNames, recordedNames) {
  const recorded = new Set(recordedNames);
  return localNames.filter((name) => !recorded.has(name));
}

async function runWrangler(args, captureOutput = false) {
  return await new Promise((resolveRun, rejectRun) => {
    const child = spawn("wrangler", args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: captureOutput ? ["inherit", "pipe", "inherit"] : "inherit",
    });
    let stdout = "";
    if (captureOutput) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    child.once("error", rejectRun);
    child.once("close", (code, signal) => {
      resolveRun({ code, signal, stdout });
    });
  });
}

async function recordedMigrationNames(environment) {
  const result = await runWrangler([
    "d1",
    "execute",
    "DB",
    "--env",
    environment,
    "--remote",
    "--json",
    "--command",
    "SELECT name FROM d1_migrations ORDER BY id",
  ], true);
  if (result.code !== 0) {
    throw new Error(
      `Unable to reconcile D1 migrations after apply failure (exit=${result.code}, signal=${result.signal ?? "none"})`,
    );
  }
  const payload = JSON.parse(result.stdout);
  if (!Array.isArray(payload) || !Array.isArray(payload[0]?.results)) {
    throw new Error("D1 migration reconciliation returned an unexpected response");
  }
  return payload[0].results.map((row) => row.name).filter((name) => typeof name === "string");
}

async function applyMigrations(environment) {
  if (environment !== "staging" && environment !== "production") {
    throw new Error("Usage: apply-d1-migrations.mjs staging|production");
  }
  const applyResult = await runWrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--env",
    environment,
    "--remote",
  ]);
  if (applyResult.code === 0) return;

  // D1 can commit a migration and then time out before Wrangler receives the
  // response. Reconcile the durable migration ledger before declaring the
  // deployment failed; never continue while any checked-in migration is absent.
  const localNames = (await readdir(resolve(repositoryRoot, "migrations")))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  const recordedNames = await recordedMigrationNames(environment);
  const missing = missingMigrationNames(localNames, recordedNames);
  if (missing.length > 0) {
    throw new Error(
      `D1 migration apply failed and reconciliation found unapplied migrations: ${missing.join(", ")}`,
    );
  }
  console.warn(
    "D1 migration apply returned failure after every checked-in migration was recorded; continuing from the reconciled durable state.",
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  applyMigrations(process.argv[2]).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
