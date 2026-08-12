import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("workflow policy revisions classify legacy evidence and become immutable", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE organisations (id TEXT PRIMARY KEY);
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      delivery_template TEXT NOT NULL,
      workflow_policy_json TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE scene_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id)
    );
    CREATE TABLE releases (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL REFERENCES scene_versions(id)
    );
    INSERT INTO users VALUES ('user');
    INSERT INTO organisations VALUES ('organisation');
    INSERT INTO projects VALUES (
      'project', 'organisation', 'Property showcase',
      '{"schemaVersion":"project-workflow-policy-v1"}', 'user',
      '2026-08-01T00:00:00Z'
    );
    INSERT INTO scene_versions VALUES ('version', 'project');
    INSERT INTO releases VALUES ('release', 'version');
  `);
  for (const name of [
    "0060_workflow_policy_revisions.sql",
    "0061_workflow_policy_revision_integrity.sql",
  ]) {
    database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }

  assert.deepEqual(
    database.prepare(`
      SELECT id, classification_status
      FROM project_workflow_policy_revisions ORDER BY revision_number
    `).all().map((row) => ({ ...row })),
    [
      { id: "legacy-policy-unknown:project", classification_status: "legacy_unknown" },
      { id: "legacy-policy-current:project", classification_status: "classified" },
    ],
  );
  database.exec(`
    INSERT INTO project_workflow_policy_revisions
      (id, organisation_id, project_id, revision_number, delivery_template,
        policy_json, transition_reason, created_by)
    VALUES (
      'old-worker-write', 'organisation', 'project', 3, 'Property showcase',
      '{"schemaVersion":"project-workflow-policy-v1"}',
      'Writer deployed before migration 0061.', 'user'
    )
  `);
  assert.equal(
    database.prepare(`
      SELECT classification_status FROM project_workflow_policy_revisions
      WHERE id = 'old-worker-write'
    `).get().classification_status,
    "legacy_unknown",
  );
  assert.throws(
    () => database.exec(`
      UPDATE project_workflow_policy_revisions SET transition_reason = 'rewritten'
      WHERE id = 'legacy-policy-current:project'
    `),
    /workflow_policy_revision_immutable/,
  );
  assert.throws(
    () => database.exec(`
      DELETE FROM project_workflow_policy_revisions
      WHERE id = 'legacy-policy-unknown:project'
    `),
    /workflow_policy_revision_immutable/,
  );
  database.close();
});
