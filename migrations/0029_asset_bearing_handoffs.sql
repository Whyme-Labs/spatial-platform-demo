PRAGMA foreign_keys = ON;

CREATE TABLE project_asset_handoffs (
  id TEXT PRIMARY KEY,
  source_organisation_id TEXT NOT NULL REFERENCES organisations(id),
  target_organisation_id TEXT NOT NULL REFERENCES organisations(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  source_project_id TEXT NOT NULL REFERENCES projects(id),
  target_project_id TEXT NOT NULL,
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  source_snapshot_hash TEXT NOT NULL,
  source_snapshot_json TEXT NOT NULL CHECK (json_valid(source_snapshot_json)),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'copying', 'finalizing', 'failed', 'completed', 'cancelled')),
  total_versions INTEGER NOT NULL CHECK (total_versions BETWEEN 1 AND 10),
  total_assets INTEGER NOT NULL CHECK (total_assets BETWEEN 1 AND 50),
  total_bytes INTEGER NOT NULL CHECK (total_bytes BETWEEN 1 AND 107374182400),
  copied_assets INTEGER NOT NULL DEFAULT 0 CHECK (copied_assets >= 0),
  copied_bytes INTEGER NOT NULL DEFAULT 0 CHECK (copied_bytes >= 0),
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  cancelled_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_organisation_id, client_operation_id)
);

CREATE INDEX project_asset_handoffs_source_idx
  ON project_asset_handoffs
  (source_organisation_id, source_project_id, started_at DESC);

CREATE INDEX project_asset_handoffs_target_idx
  ON project_asset_handoffs
  (target_organisation_id, status, started_at DESC);

CREATE TABLE project_asset_handoff_versions (
  id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL REFERENCES project_asset_handoffs(id),
  source_version_id TEXT NOT NULL REFERENCES scene_versions(id),
  target_version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  source_provenance_json TEXT NOT NULL CHECK (json_valid(source_provenance_json)),
  manifest_json TEXT CHECK (manifest_json IS NULL OR json_valid(manifest_json)),
  UNIQUE (handoff_id, source_version_id),
  UNIQUE (handoff_id, target_version_id),
  UNIQUE (handoff_id, version_number)
);

CREATE TABLE project_asset_handoff_items (
  id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL REFERENCES project_asset_handoffs(id),
  version_mapping_id TEXT NOT NULL REFERENCES project_asset_handoff_versions(id),
  source_asset_id TEXT NOT NULL REFERENCES assets(id),
  target_asset_id TEXT NOT NULL,
  source_object_key TEXT NOT NULL,
  target_object_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  format TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (
    length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  source_etag TEXT,
  target_etag TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'copying', 'copied', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  error_message TEXT,
  copied_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (handoff_id, source_asset_id),
  UNIQUE (target_object_key),
  UNIQUE (target_asset_id)
);

CREATE INDEX project_asset_handoff_items_work_idx
  ON project_asset_handoff_items (handoff_id, status, updated_at);

CREATE TABLE project_asset_handoff_actions (
  id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL REFERENCES project_asset_handoffs(id),
  source_organisation_id TEXT NOT NULL REFERENCES organisations(id),
  client_operation_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('retry', 'cancel')),
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_organisation_id, client_operation_id)
);
