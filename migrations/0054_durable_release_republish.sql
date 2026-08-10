CREATE TABLE release_republish_intents (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  navigation_build_id TEXT NOT NULL UNIQUE REFERENCES scene_navigation_builds(id),
  source_release_id TEXT NOT NULL REFERENCES releases(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  requested_by TEXT NOT NULL REFERENCES users(id),
  client_operation_id TEXT NOT NULL,
  completed_release_id TEXT REFERENCES releases(id),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX release_republish_intents_project_idx
  ON release_republish_intents(project_id, version_id, created_at DESC);

CREATE INDEX release_republish_intents_pending_idx
  ON release_republish_intents(status, updated_at)
  WHERE status = 'pending';
