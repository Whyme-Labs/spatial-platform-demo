import assert from "node:assert/strict";
import test from "node:test";
import { missingMigrationNames } from "../scripts/apply-d1-migrations.mjs";

test("migration reconciliation continues only when every local migration is recorded", () => {
  assert.deepEqual(
    missingMigrationNames(["0001_initial.sql", "0002_policy.sql"], [
      "0001_initial.sql",
      "0002_policy.sql",
    ]),
    [],
  );
  assert.deepEqual(
    missingMigrationNames(["0001_initial.sql", "0002_policy.sql"], ["0001_initial.sql"]),
    ["0002_policy.sql"],
  );
});
