PRAGMA foreign_keys = ON;

CREATE TABLE scene_navigation_walk_tests (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES scene_versions(id) ON DELETE CASCADE,
  navigation_build_id TEXT NOT NULL REFERENCES scene_navigation_builds(id) ON DELETE CASCADE,
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  start_pose_json TEXT NOT NULL,
  end_pose_json TEXT NOT NULL,
  runtime_evidence_json TEXT NOT NULL,
  completed_by TEXT NOT NULL REFERENCES users(id),
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX scene_navigation_walk_tests_version_idx
  ON scene_navigation_walk_tests (
    organisation_id,
    project_id,
    version_id,
    completed_at DESC
  );
