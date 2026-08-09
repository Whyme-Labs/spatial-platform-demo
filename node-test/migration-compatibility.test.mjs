import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/audit-migration-compatibility.mjs");

function fixture({ migrations, declarations, pending = null }) {
  const root = mkdtempSync(join(tmpdir(), "migration-compat-"));
  mkdirSync(join(root, "migrations"));
  for (const [name, sql] of Object.entries(migrations)) {
    writeFileSync(join(root, "migrations", name), sql);
  }
  writeFileSync(join(root, "migrations", "compatibility.json"), JSON.stringify(declarations));
  let pendingPath = null;
  if (pending !== null) {
    pendingPath = join(root, "pending.txt");
    writeFileSync(pendingPath, pending);
  }
  return { root, pendingPath };
}

function run(root, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

const EXPAND_SQL = "CREATE TABLE widgets (id TEXT PRIMARY KEY);\nALTER TABLE gadgets ADD COLUMN widget_id TEXT REFERENCES widgets(id);\n";
const CONTRACT_SQL = "DROP TABLE legacy_widgets;\n";

test("consistent expand declarations pass", () => {
  const { root } = fixture({
    migrations: { "0001_expand.sql": EXPAND_SQL },
    declarations: { migrations: { "0001_expand.sql": { phase: "expand" } } },
  });
  assert.equal(run(root).code, 0);
});

test("destructive SQL declared expand fails", () => {
  const { root } = fixture({
    migrations: { "0001_bad.sql": CONTRACT_SQL },
    declarations: { migrations: { "0001_bad.sql": { phase: "expand" } } },
  });
  const result = run(root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /destructive SQL: drop_table legacy_widgets/);
});

test("an undeclared migration file fails", () => {
  const { root } = fixture({
    migrations: { "0001_expand.sql": EXPAND_SQL },
    declarations: { migrations: {} },
  });
  assert.match(run(root).stderr, /no compatibility declaration/);
});

test("a NOT NULL column without a default is destructive; with a default it is not", () => {
  const { root: bad } = fixture({
    migrations: { "0001_x.sql": "ALTER TABLE t ADD COLUMN c TEXT NOT NULL;\n" },
    declarations: { migrations: { "0001_x.sql": { phase: "expand" } } },
  });
  assert.match(run(bad).stderr, /not_null_without_default t c/);
  const { root: good } = fixture({
    migrations: { "0001_x.sql": "ALTER TABLE t ADD COLUMN c TEXT NOT NULL\n  DEFAULT 'v';\n" },
    declarations: { migrations: { "0001_x.sql": { phase: "expand" } } },
  });
  assert.equal(run(good).code, 0);
});

test("a trigger dropped and recreated in the same migration is a replacement", () => {
  const { root } = fixture({
    migrations: { "0001_x.sql": "DROP TRIGGER guard;\nCREATE TRIGGER guard BEFORE INSERT ON t BEGIN SELECT 1; END;\n" },
    declarations: { migrations: { "0001_x.sql": { phase: "expand" } } },
  });
  assert.equal(run(root).code, 0);
});

const CONTRACT_DECLARATIONS = {
  migrations: {
    "0001_expand.sql": { phase: "expand" },
    "0002_contract.sql": {
      phase: "contract",
      expandMigration: "0001_expand.sql",
      declaredDestructive: ["drop_table legacy_widgets"],
      oldestCompatibleAppRevision: "a".repeat(40),
    },
  },
};

test("a fully declared contract migration passes statically", () => {
  const { root } = fixture({
    migrations: { "0001_expand.sql": EXPAND_SQL, "0002_contract.sql": CONTRACT_SQL },
    declarations: CONTRACT_DECLARATIONS,
  });
  assert.equal(run(root).code, 0);
});

test("undeclared and stale destructive declarations both fail", () => {
  const { root: undeclared } = fixture({
    migrations: {
      "0001_expand.sql": EXPAND_SQL,
      "0002_contract.sql": `${CONTRACT_SQL}DROP TABLE other_table;\n`,
    },
    declarations: CONTRACT_DECLARATIONS,
  });
  assert.match(run(undeclared).stderr, /undeclared destructive SQL: drop_table other_table/);
  const { root: stale } = fixture({
    migrations: { "0001_expand.sql": EXPAND_SQL, "0002_contract.sql": "CREATE TABLE t (id TEXT);\n" },
    declarations: CONTRACT_DECLARATIONS,
  });
  assert.match(run(stale).stderr, /declares destructive SQL it does not perform/);
});

test("a pending contract migration fails without acknowledgment and passes with it", () => {
  const { root, pendingPath } = fixture({
    migrations: { "0001_expand.sql": EXPAND_SQL, "0002_contract.sql": CONTRACT_SQL },
    declarations: CONTRACT_DECLARATIONS,
    pending: "Migrations to be applied:\n0002_contract.sql\n",
  });
  const blocked = run(root, ["--pending", pendingPath]);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /explicitly acknowledged/);
  const acknowledged = run(root, ["--pending", pendingPath, "--allow-contraction"]);
  assert.equal(acknowledged.code, 0);
  const report = JSON.parse(acknowledged.stdout);
  assert.deepEqual(report.pendingContract, ["0002_contract.sql"]);
  assert.equal(report.contractionAcknowledged, true);
});

test("a contract migration pending alongside its expand fails even when acknowledged", () => {
  const { root, pendingPath } = fixture({
    migrations: { "0001_expand.sql": EXPAND_SQL, "0002_contract.sql": CONTRACT_SQL },
    declarations: CONTRACT_DECLARATIONS,
    pending: "0001_expand.sql\n0002_contract.sql\n",
  });
  const result = run(root, ["--pending", pendingPath, "--allow-contraction"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /SAME deploy/);
});

test("grandfathered status past the cutoff fails", () => {
  const { root } = fixture({
    migrations: { "0060_new.sql": CONTRACT_SQL },
    declarations: {
      grandfatherCutoff: "0053_x.sql",
      migrations: {
        "0060_new.sql": {
          phase: "contract",
          grandfathered: true,
          declaredDestructive: ["drop_table legacy_widgets"],
        },
      },
    },
  });
  assert.match(run(root).stderr, /past the cutoff/);
});
