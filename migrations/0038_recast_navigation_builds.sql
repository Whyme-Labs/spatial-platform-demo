PRAGMA foreign_keys = ON;

ALTER TABLE scene_navigation_profiles ADD COLUMN max_slope_degrees REAL NOT NULL DEFAULT 45
  CHECK (max_slope_degrees BETWEEN 0 AND 89);
ALTER TABLE scene_navigation_profiles ADD COLUMN max_speed REAL NOT NULL DEFAULT 1.6
  CHECK (max_speed BETWEEN 0.1 AND 20);
ALTER TABLE scene_navigation_profiles ADD COLUMN max_acceleration REAL NOT NULL DEFAULT 8
  CHECK (max_acceleration BETWEEN 0.1 AND 100);

CREATE TABLE scene_navigation_builds (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  collision_asset_id TEXT NOT NULL REFERENCES assets(id),
  job_id TEXT NOT NULL UNIQUE REFERENCES processing_jobs(id),
  status TEXT NOT NULL CHECK (status IN (
    'QUEUED', 'PROCESSING', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'FAILED'
  )),
  parameters_json TEXT NOT NULL,
  artifact_json TEXT,
  navmesh_asset_id TEXT REFERENCES assets(id),
  report_asset_id TEXT REFERENCES assets(id),
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  authoring_hash TEXT NOT NULL CHECK (length(authoring_hash) = 64),
  created_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  review_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX scene_navigation_builds_version_idx
  ON scene_navigation_builds(version_id, status, updated_at DESC);
