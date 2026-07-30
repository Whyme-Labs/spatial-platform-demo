ALTER TABLE releases ADD COLUMN spatial_snapshot_json TEXT;

CREATE TABLE scene_navigation_obstacles (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  label TEXT NOT NULL,
  bounds_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  client_operation_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX scene_navigation_obstacles_version_idx
  ON scene_navigation_obstacles(version_id, status, label);
