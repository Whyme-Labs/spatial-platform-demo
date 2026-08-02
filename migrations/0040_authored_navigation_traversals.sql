PRAGMA foreign_keys = ON;

CREATE TABLE scene_navigation_traversals (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  traversal_kind TEXT NOT NULL CHECK (traversal_kind IN (
    'elevator', 'ladder', 'moving_platform'
  )),
  label TEXT NOT NULL,
  path_json TEXT NOT NULL,
  bidirectional INTEGER NOT NULL CHECK (bidirectional IN (0, 1)),
  speed_units_per_second REAL NOT NULL CHECK (speed_units_per_second > 0),
  reviewed_purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  client_operation_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX scene_navigation_traversals_version_idx
  ON scene_navigation_traversals(version_id, status, label);
