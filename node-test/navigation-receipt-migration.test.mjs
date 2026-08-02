import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("navigation receipt migrations preserve legacy rows and atomically require scene registration", async () => {
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
  const registrationMigration = await readFile(
    new URL("../migrations/0045_capture_scene_registration_receipts.sql", import.meta.url),
    "utf8",
  );
  database.exec(registrationMigration);

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
        evidence_manifest_review_generation, evidence_registration_sha256,
        evidence_source_to_world_json, evidence_source_path_json, request_hash
      FROM scene_navigation_traversals WHERE id = 'legacy-v8'
    `).get() },
    {
      evidence_manifest_id: null,
      evidence_manifest_sha256: null,
      evidence_adapter: null,
      evidence_manifest_review_generation: null,
      evidence_registration_sha256: null,
      evidence_source_to_world_json: null,
      evidence_source_path_json: null,
      request_hash: null,
    },
  );
  assert.throws(
    () => database.exec(`
      UPDATE scene_navigation_traversals
      SET evidence_adapter = 'xgrids-lcc' WHERE id = 'legacy-v8'
    `),
    /traversal_capture_receipt requires manifest_id, manifest_sha256, adapter, review_generation, registration_sha256, source_to_world, and source_path together/,
  );
  database.close();
});

test("viewer telemetry migration adds an atomic per-session chronology", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE releases (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT
    );
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      organisation_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE memberships (
      organisation_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      revoked_at TEXT,
      PRIMARY KEY (organisation_id, user_id)
    );
    CREATE TABLE project_access (
      organisation_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL,
      revoked_at TEXT,
      PRIMARY KEY (project_id, user_id)
    );
    CREATE TABLE release_channels (
      id TEXT PRIMARY KEY,
      active_release_id TEXT REFERENCES releases(id)
    );
    CREATE TABLE viewer_events (
      id TEXT PRIMARY KEY,
      release_id TEXT NOT NULL REFERENCES releases(id),
      event_type TEXT NOT NULL,
      session_id TEXT,
      device_profile TEXT,
      metric_value REAL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO releases (id, organisation_id, project_id)
      VALUES ('release', 'organisation', 'project');
    INSERT INTO users (id) VALUES ('reviewer');
    INSERT INTO auth_sessions (id, user_id, organisation_id, expires_at)
      VALUES ('auth-session', 'reviewer', 'organisation', datetime('now', '+1 day'));
    INSERT INTO memberships (organisation_id, user_id, role, status)
      VALUES ('organisation', 'reviewer', 'platform_admin', 'active');
    INSERT INTO release_channels (id, active_release_id)
      VALUES ('channel', 'release');
    INSERT INTO viewer_events (id, release_id, event_type, session_id)
      VALUES ('legacy', 'release', 'viewer_open', 'legacy-session');
  `);
  const migration = await readFile(
    new URL("../migrations/0046_viewer_telemetry_sessions.sql", import.meta.url),
    "utf8",
  );
  database.exec(migration);

  assert.deepEqual(
    { ...database.prepare(`
      SELECT received_at_ms, session_sequence FROM viewer_events WHERE id = 'legacy'
    `).get() },
    { received_at_ms: null, session_sequence: null },
  );
  database.exec(`
    INSERT INTO viewer_telemetry_sessions
      (id, release_id, channel_id, created_by, auth_session_id,
        activation_generation, expires_at_epoch, next_sequence)
    VALUES ('session', 'release', 'channel', 'reviewer', 'auth-session',
      1, unixepoch('now') + 3600, 1);
    INSERT INTO viewer_events
      (id, release_id, event_type, session_id, received_at_ms, session_sequence)
    VALUES ('started', 'release', 'navigation_traversal', 'session', 1000, 1);
  `);
  assert.throws(
    () => database.exec(`
      INSERT INTO viewer_telemetry_sessions
        (id, release_id, channel_id, created_by, auth_session_id,
          activation_generation, expires_at_epoch, next_sequence)
      VALUES ('duplicate', 'release', 'channel', 'reviewer', 'auth-session',
        1, unixepoch('now') + 3601, 1);
    `),
    /UNIQUE constraint failed/,
  );
  const cleanupPlan = database.prepare(`
    EXPLAIN QUERY PLAN
    SELECT id FROM viewer_telemetry_sessions
    WHERE expires_at_epoch < unixepoch('now')
    ORDER BY expires_at_epoch, id
    LIMIT 500
  `).all().map((row) => String(row.detail));
  assert.ok(
    cleanupPlan.some((detail) =>
      detail.includes("USING COVERING INDEX viewer_telemetry_sessions_expiry_idx")
    ),
    `expected expiry-index search, got ${cleanupPlan.join(" | ")}`,
  );
  assert.ok(
    cleanupPlan.every((detail) => !detail.includes("USE TEMP B-TREE")),
    `cleanup must not sort the full backlog: ${cleanupPlan.join(" | ")}`,
  );
  const pendingPlan = database.prepare(`
    EXPLAIN QUERY PLAN
    SELECT 1 FROM viewer_telemetry_sessions
    WHERE expires_at_epoch < unixepoch('now')
    LIMIT 1
  `).all().map((row) => String(row.detail));
  assert.ok(
    pendingPlan.some((detail) =>
      detail.includes("USING COVERING INDEX viewer_telemetry_sessions_expiry_idx")
    ),
    `expected indexed pending probe, got ${pendingPlan.join(" | ")}`,
  );
  database.exec(`
    UPDATE release_channels SET activation_generation = 2 WHERE id = 'channel';
  `);
  assert.throws(
    () => database.exec(`
      INSERT INTO viewer_events
        (id, release_id, event_type, session_id, received_at_ms, session_sequence)
      VALUES ('stale-activation', 'release', 'navigation_traversal', 'session', 1001, 2);
    `),
    /navigation_traversal evidence requires an active release and reviewer authorization/,
  );
  database.exec(`
    UPDATE release_channels SET activation_generation = 1 WHERE id = 'channel';
  `);
  database.exec(`
    UPDATE auth_sessions SET revoked_at = datetime('now') WHERE id = 'auth-session';
  `);
  assert.throws(
    () => database.exec(`
      INSERT INTO viewer_events
        (id, release_id, event_type, session_id, received_at_ms, session_sequence)
      VALUES ('revoked-auth', 'release', 'navigation_traversal', 'session', 1001, 2);
    `),
    /navigation_traversal evidence requires an active release and reviewer authorization/,
  );
  database.prepare(`
    UPDATE auth_sessions SET revoked_at = NULL, expires_at = ?
    WHERE id = 'auth-session'
  `).run(new Date(Date.now() - 1_000).toISOString());
  assert.throws(
    () => database.exec(`
      INSERT INTO viewer_events
        (id, release_id, event_type, session_id, received_at_ms, session_sequence)
      VALUES ('expired-auth', 'release', 'navigation_traversal', 'session', 1001, 2);
    `),
    /navigation_traversal evidence requires an active release and reviewer authorization/,
  );
  database.prepare(`
    UPDATE auth_sessions SET expires_at = ? WHERE id = 'auth-session'
  `).run(new Date(Date.now() + 60_000).toISOString());
  database.exec(`
    UPDATE memberships SET role = 'customer_reviewer' WHERE user_id = 'reviewer';
  `);
  assert.throws(
    () => database.exec(`
      INSERT INTO viewer_events
        (id, release_id, event_type, session_id, received_at_ms, session_sequence)
      VALUES ('revoked-access', 'release', 'navigation_traversal', 'session', 1001, 2);
    `),
    /navigation_traversal evidence requires an active release and reviewer authorization/,
  );
  database.exec(`
    INSERT INTO project_access
      (organisation_id, project_id, user_id, role)
    VALUES ('organisation', 'project', 'reviewer', 'customer_reviewer');
  `);
  database.prepare(`
    UPDATE releases SET expires_at = ? WHERE id = 'release'
  `).run(new Date(Date.now() - 1_000).toISOString());
  assert.throws(
    () => database.exec(`
      INSERT INTO viewer_events
        (id, release_id, event_type, session_id, received_at_ms, session_sequence)
      VALUES ('expired-release', 'release', 'navigation_traversal', 'session', 1001, 2);
    `),
    /navigation_traversal evidence requires an active release and reviewer authorization/,
  );
  database.exec(`
    UPDATE releases SET expires_at = NULL WHERE id = 'release';
    UPDATE viewer_telemetry_sessions SET expires_at_epoch = unixepoch('now') - 1
    WHERE id = 'session';
  `);
  assert.throws(
    () => database.exec(`
      INSERT INTO viewer_events
        (id, release_id, event_type, session_id, received_at_ms, session_sequence)
      VALUES ('expired-session', 'release', 'navigation_traversal', 'session', 1001, 2);
    `),
    /navigation_traversal evidence requires an active release and reviewer authorization/,
  );
  database.exec(`
    UPDATE viewer_telemetry_sessions SET expires_at_epoch = unixepoch('now') + 3600
    WHERE id = 'session';
  `);
  assert.throws(
    () => database.exec(`
      INSERT INTO viewer_events
        (id, release_id, event_type, session_id, received_at_ms, session_sequence)
      VALUES ('completed', 'release', 'navigation_traversal', 'session', 1000, 1);
    `),
    /UNIQUE constraint failed/,
  );
  database.exec(`
    UPDATE release_channels SET active_release_id = NULL WHERE id = 'channel';
  `);
  assert.throws(
    () => database.exec(`
      INSERT INTO viewer_events
        (id, release_id, event_type, session_id, received_at_ms, session_sequence)
      VALUES ('retired', 'release', 'navigation_traversal', 'session', 1001, 2);
    `),
    /navigation_traversal evidence requires an active release and reviewer authorization/,
  );
  database.close();
});

test("metric traversal migration guards both write orders and rejects an existing violation", async () => {
  const migration = await readFile(
    new URL("../migrations/0047_metric_registered_traversal_guards.sql", import.meta.url),
    "utf8",
  );
  const schema = `
    CREATE TABLE scene_navigation_profiles (
      version_id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      world_unit TEXT NOT NULL
    );
    CREATE TABLE scene_navigation_traversals (
      id TEXT PRIMARY KEY,
      organisation_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      status TEXT NOT NULL,
      evidence_registration_sha256 TEXT
    );
  `;

  const database = new DatabaseSync(":memory:");
  database.exec(schema);
  database.exec(`
    INSERT INTO scene_navigation_profiles
      (version_id, organisation_id, project_id, world_unit)
    VALUES ('version', 'organisation', 'project', 'metres');
  `);
  database.exec(migration);
  database.exec(`
    INSERT INTO scene_navigation_traversals
      (id, organisation_id, project_id, version_id, status,
        evidence_registration_sha256)
    VALUES ('registered', 'organisation', 'project', 'version', 'active',
      '${"a".repeat(64)}');
  `);
  assert.throws(
    () => database.exec(`
      UPDATE scene_navigation_profiles
      SET world_unit = 'scene_units' WHERE version_id = 'version';
    `),
    /metric navigation profile is required by active capture_registered_traversal/,
  );
  assert.throws(
    () => database.exec(`
      DELETE FROM scene_navigation_profiles WHERE version_id = 'version';
    `),
    /metric navigation profile is required by active capture_registered_traversal/,
  );
  database.exec(`
    UPDATE scene_navigation_traversals
    SET status = 'archived' WHERE id = 'registered';
    UPDATE scene_navigation_profiles
    SET world_unit = 'scene_units' WHERE version_id = 'version';
  `);
  assert.throws(
    () => database.exec(`
      UPDATE scene_navigation_traversals
      SET status = 'active' WHERE id = 'registered';
    `),
    /capture_registered_traversal requires metric navigation profile/,
  );
  database.exec(`
    UPDATE scene_navigation_profiles
    SET world_unit = 'metres' WHERE version_id = 'version';
    UPDATE scene_navigation_traversals
    SET status = 'active' WHERE id = 'registered';
  `);
  database.close();

  const invalidLegacyDatabase = new DatabaseSync(":memory:");
  invalidLegacyDatabase.exec(schema);
  invalidLegacyDatabase.exec(`
    INSERT INTO scene_navigation_profiles
      (version_id, organisation_id, project_id, world_unit)
    VALUES ('version', 'organisation', 'project', 'scene_units');
    INSERT INTO scene_navigation_traversals
      (id, organisation_id, project_id, version_id, status,
        evidence_registration_sha256)
    VALUES ('registered', 'organisation', 'project', 'version', 'active',
      '${"b".repeat(64)}');
  `);
  assert.throws(
    () => invalidLegacyDatabase.exec(migration),
    /capture_registered_traversal requires metric navigation profile/,
  );
  invalidLegacyDatabase.close();
});
