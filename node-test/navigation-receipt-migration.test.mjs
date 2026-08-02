import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("navigation receipt migration backfills reviewed manifests and preserves legacy traversals", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE capture_bundle_manifests (
      id TEXT PRIMARY KEY,
      review_decision TEXT,
      reviewed_at TEXT
    );
    CREATE TABLE scene_navigation_traversals (id TEXT PRIMARY KEY);
    INSERT INTO capture_bundle_manifests (id, review_decision, reviewed_at)
      VALUES ('reviewed', 'accepted', '2026-08-01T00:00:00Z');
    INSERT INTO capture_bundle_manifests (id, review_decision, reviewed_at)
      VALUES ('pending', NULL, NULL);
    INSERT INTO scene_navigation_traversals (id) VALUES ('legacy-v8');
  `);
  const migration = await readFile(
    new URL("../migrations/0044_navigation_traversal_capture_receipts.sql", import.meta.url),
    "utf8",
  );
  database.exec(migration);

  assert.deepEqual(
    database.prepare(`
      SELECT id, review_generation FROM capture_bundle_manifests ORDER BY id
    `).all().map((row) => ({ ...row })),
    [
      { id: "pending", review_generation: 0 },
      { id: "reviewed", review_generation: 1 },
    ],
  );
  assert.deepEqual(
    { ...database.prepare(`
      SELECT evidence_manifest_id, evidence_manifest_sha256, evidence_adapter,
        evidence_manifest_review_generation
      FROM scene_navigation_traversals WHERE id = 'legacy-v8'
    `).get() },
    {
      evidence_manifest_id: null,
      evidence_manifest_sha256: null,
      evidence_adapter: null,
      evidence_manifest_review_generation: null,
    },
  );
  assert.throws(
    () => database.exec(`
      UPDATE scene_navigation_traversals
      SET evidence_adapter = 'xgrids-lcc' WHERE id = 'legacy-v8'
    `),
    /traversal_capture_receipt requires manifest_id, manifest_sha256, adapter, and review_generation together/,
  );
  database.close();
});
