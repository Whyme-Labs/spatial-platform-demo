#!/usr/bin/env node
// Enforces the expand-and-contract migration policy the production
// attestation promises, instead of merely recording it.
//
// Static rules (always checked):
//   - every migrations/*.sql file has a declaration in
//     migrations/compatibility.json, and every declaration has a file;
//   - an "expand"-phase migration contains ZERO destructive statements
//     (DROP TABLE/COLUMN/VIEW/TRIGGER, RENAME TABLE/COLUMN, ADD COLUMN
//     NOT NULL without a DEFAULT) — a Worker rollback never rolls back D1,
//     so the frozen rollback pair must keep working against the new schema;
//   - a "contract"-phase migration must declare EVERY destructive statement
//     it performs (undeclared and stale declarations both fail), name the
//     earlier expand migration it contracts, and pin the oldest application
//     revision compatible with the contracted schema;
//   - "grandfathered" is only valid for migrations at or before the frozen
//     cutoff — history that already shipped, never new work.
//
// Deploy-time rules (--pending <wrangler d1 migrations list output>):
//   - a pending contract migration whose expand migration is ALSO pending
//     fails unconditionally: contraction must never ride in the same deploy
//     as the expansion it depends on;
//   - any pending contract migration fails unless the operator explicitly
//     acknowledged contraction (--allow-contraction), because applying it
//     expires every rollback candidate older than its
//     oldestCompatibleAppRevision.
// The machine-readable report prints to stdout for the attestation.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const MIGRATIONS_DIR = "migrations";
const DECLARATIONS_PATH = path.join(MIGRATIONS_DIR, "compatibility.json");
const PHASES = new Set(["expand", "contract"]);

function stripSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\s+/g, " ");
}

function bareName(identifier) {
  return identifier.replaceAll('"', "").replaceAll("`", "").toLowerCase();
}

function classifyStatement(statement) {
  const s = statement.trim();
  if (!s) return [];
  const found = [];
  let m;
  if ((m = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_"`]+)/i.exec(s))) {
    found.push(`drop_table ${bareName(m[1])}`);
  }
  if ((m = /^DROP\s+(VIEW|TRIGGER)\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_"`]+)/i.exec(s))) {
    found.push(`drop_${m[1].toLowerCase()} ${bareName(m[2])}`);
  }
  if ((m = /^ALTER\s+TABLE\s+([A-Za-z0-9_"`]+)\s+RENAME\s+TO\s+([A-Za-z0-9_"`]+)/i.exec(s))) {
    found.push(`rename_table ${bareName(m[1])} ${bareName(m[2])}`);
  } else if ((m = /^ALTER\s+TABLE\s+([A-Za-z0-9_"`]+)\s+RENAME\s+(?:COLUMN\s+)?([A-Za-z0-9_"`]+)\s+TO\s+([A-Za-z0-9_"`]+)/i.exec(s))) {
    found.push(`rename_column ${bareName(m[1])} ${bareName(m[2])} ${bareName(m[3])}`);
  }
  if ((m = /^ALTER\s+TABLE\s+([A-Za-z0-9_"`]+)\s+DROP\s+(?:COLUMN\s+)?([A-Za-z0-9_"`]+)/i.exec(s))) {
    found.push(`drop_column ${bareName(m[1])} ${bareName(m[2])}`);
  }
  if ((m = /^ALTER\s+TABLE\s+([A-Za-z0-9_"`]+)\s+ADD\s+(?:COLUMN\s+)?([A-Za-z0-9_"`]+)/i.exec(s))) {
    if (/\bNOT\s+NULL\b/i.test(s) && !/\bDEFAULT\b/i.test(s)) {
      found.push(`not_null_without_default ${bareName(m[1])} ${bareName(m[2])}`);
    }
  }
  return found;
}

function classifyMigration(sqlPath) {
  const statements = stripSql(readFileSync(sqlPath, "utf8")).split(";");
  // A trigger or view dropped AND recreated in the same migration is a
  // replacement, not a contraction — old Worker code never references
  // triggers or views by more than their effect.
  const recreated = new Set(statements.flatMap((statement) => {
    const m = /^\s*CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?(VIEW|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_"`]+)/i.exec(statement);
    return m ? [`${m[1].toLowerCase()} ${bareName(m[2])}`] : [];
  }));
  return statements.flatMap(classifyStatement).filter((finding) => {
    const m = /^drop_(view|trigger) (.+)$/.exec(finding);
    return !(m && recreated.has(`${m[1]} ${m[2]}`));
  });
}

function main() {
  const args = process.argv.slice(2);
  const pendingIndex = args.indexOf("--pending");
  const pendingPath = pendingIndex >= 0 ? args[pendingIndex + 1] : null;
  const allowContraction = args.includes("--allow-contraction");
  if (pendingIndex >= 0 && !pendingPath) {
    console.error("::error::--pending requires the migrations-list output path");
    process.exit(1);
  }

  const errors = [];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const declarations = JSON.parse(readFileSync(DECLARATIONS_PATH, "utf8"));
  const declared = declarations.migrations ?? {};
  const cutoff = declarations.grandfatherCutoff ?? "";

  for (const name of Object.keys(declared)) {
    if (!files.includes(name)) {
      errors.push(`declaration for ${name} has no migration file`);
    }
  }

  const classified = new Map();
  for (const file of files) {
    const destructive = classifyMigration(path.join(MIGRATIONS_DIR, file));
    classified.set(file, destructive);
    const entry = declared[file];
    if (!entry) {
      errors.push(`${file} has no compatibility declaration`);
      continue;
    }
    if (!PHASES.has(entry.phase)) {
      errors.push(`${file} declares unknown phase ${JSON.stringify(entry.phase)}`);
      continue;
    }
    if (entry.phase === "expand") {
      for (const statement of destructive) {
        errors.push(`${file} is declared expand but contains destructive SQL: ${statement}`);
      }
      continue;
    }
    const declaredDestructive = entry.declaredDestructive ?? [];
    for (const statement of destructive) {
      if (!declaredDestructive.includes(statement)) {
        errors.push(`${file} performs undeclared destructive SQL: ${statement}`);
      }
    }
    for (const statement of declaredDestructive) {
      if (!destructive.includes(statement)) {
        errors.push(`${file} declares destructive SQL it does not perform: ${statement}`);
      }
    }
    if (entry.grandfathered) {
      if (!cutoff || file > cutoff) {
        errors.push(`${file} claims grandfathered status past the cutoff ${cutoff || "(unset)"}`);
      }
      continue;
    }
    if (!files.includes(entry.expandMigration) || entry.expandMigration >= file) {
      errors.push(`${file} must name an EARLIER expand migration it contracts (got ${JSON.stringify(entry.expandMigration)})`);
    }
    if (!/^[0-9a-f]{40}$/.test(entry.oldestCompatibleAppRevision ?? "")) {
      errors.push(`${file} must pin oldestCompatibleAppRevision (full git SHA) for the contracted schema`);
    }
  }

  // The upload purpose vocabulary lives in src/shared/capture-adapters.ts, but
  // the column that stores it pins an enumerated CHECK. A purpose added to one
  // and not the other ships an import the operator can start and the schema
  // then rejects (scanner_trajectory did exactly that). The newest CHECK must
  // list the whole vocabulary, so widening the schema is part of adding one.
  const sharedVocabularyPath = path.join(
    MIGRATIONS_DIR, "..", "src", "shared", "capture-adapters.ts",
  );
  // Synthetic migration sets (the auditor's own fixtures) carry no application
  // source; the vocabulary rule only applies to a real checkout.
  const purposeVocabulary = !existsSync(sharedVocabularyPath) ? "not-applicable" : (() => {
    const shared = readFileSync(sharedVocabularyPath, "utf8");
    const declaration = shared.match(
      /export const captureAssetPurposes = \[([\s\S]*?)\] as const;/,
    );
    return declaration
      ? [...declaration[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1])
      : null;
  })();
  if (purposeVocabulary === null) {
    errors.push("src/shared/capture-adapters.ts declares no captureAssetPurposes array");
  } else if (purposeVocabulary !== "not-applicable") {
    const constraintFiles = files.filter((file) =>
      /purpose TEXT NOT NULL DEFAULT/.test(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")));
    const newest = constraintFiles.at(-1);
    if (!newest) {
      errors.push("no migration defines the upload purpose CHECK constraint");
    } else {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, newest), "utf8");
      const block = sql.match(/purpose TEXT NOT NULL DEFAULT[\s\S]*?CHECK \(purpose IN \(([\s\S]*?)\)\)/);
      const admitted = block
        ? [...block[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
        : [];
      for (const purpose of purposeVocabulary) {
        if (!admitted.includes(purpose)) {
          errors.push(
            `${newest} upload purpose CHECK omits declared purpose ${purpose}: widen the constraint in a new migration`,
          );
        }
      }
      for (const purpose of admitted) {
        if (!purposeVocabulary.includes(purpose)) {
          errors.push(`${newest} upload purpose CHECK admits ${purpose}, which is not a declared capture asset purpose`);
        }
      }
    }
  }

  let report = null;
  if (pendingPath) {
    const listOutput = readFileSync(pendingPath, "utf8");
    const pendingNames = [...new Set(
      [...listOutput.matchAll(/[0-9]{4}_[A-Za-z0-9_-]+\.sql/g)].map((m) => m[0]),
    )].filter((name) => files.includes(name)).sort();
    const pending = pendingNames.map((name) => ({
      name,
      phase: declared[name]?.phase ?? "undeclared",
      destructiveStatements: classified.get(name) ?? [],
      oldestCompatibleAppRevision: declared[name]?.oldestCompatibleAppRevision ?? null,
    }));
    const pendingContract = pending.filter((p) => p.phase === "contract");
    for (const migration of pendingContract) {
      const expand = declared[migration.name]?.expandMigration;
      if (expand && pendingNames.includes(expand)) {
        errors.push(`${migration.name} contracts ${expand}, which is pending in the SAME deploy — contraction must ship in a later release`);
      }
      if (!allowContraction) {
        errors.push(`${migration.name} is a pending CONTRACT migration: rollback candidates older than ${migration.oldestCompatibleAppRevision} expire when it applies — rerun with contraction explicitly acknowledged to proceed`);
      }
    }
    report = {
      schemaVersion: "migration-compatibility-report-v1",
      policy: declarations.policy ?? null,
      pending,
      pendingContract: pendingContract.map((p) => p.name),
      contractionAcknowledged: allowContraction,
      ok: errors.length === 0,
    };
  }

  if (report) {
    console.log(JSON.stringify(report, null, 2));
  } else if (errors.length === 0) {
    console.error(`migration compatibility: ${files.length} migrations declared and consistent`);
  }
  for (const error of errors) {
    console.error(`::error::migration compatibility: ${error}`);
  }
  process.exit(errors.length === 0 ? 0 : 1);
}

main();
