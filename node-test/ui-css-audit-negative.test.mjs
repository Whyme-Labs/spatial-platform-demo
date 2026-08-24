import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("the CSS audit rejects a migrated Studio color literal", () => {
  const result = spawnSync(process.execPath, ["scripts/audit-ui-css.mjs", "--negative-fixture"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /reintroduced semantic color literal #858b83; use var\(--placeholder-text\)/);
  assert.match(result.stderr, /#101210; use var\(--work-surface\) or var\(--select-surface\) or var\(--file-input-surface\)/);
  assert.match(result.stderr, /rgba\(212,255,88,.08\); use var\(--focus-halo-quiet\) or var\(--active-step-surface\)/);
});
