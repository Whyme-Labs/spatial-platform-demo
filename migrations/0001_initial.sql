PRAGMA foreign_keys = ON;

CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE memberships (
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('platform_admin', 'production_operator', 'customer_reviewer', 'customer_readonly')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (organisation_id, user_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  contact_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, name)
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  customer_id TEXT REFERENCES customers(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'UPLOADING', 'INGESTED', 'PROCESSING', 'QA_REQUIRED', 'APPROVED', 'PUBLISHED', 'ARCHIVED', 'UPLOAD_FAILED', 'PROCESSING_FAILED', 'QA_REJECTED', 'REVOKED')),
  capture_adapter TEXT NOT NULL CHECK (capture_adapter IN ('xgrids-lcc', 'fjd-trion', 'open-import', 'phone-video')),
  delivery_template TEXT NOT NULL,
  notes TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, slug)
);
CREATE INDEX projects_org_updated_idx ON projects(organisation_id, updated_at DESC);

CREATE TABLE scene_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('UPLOADING', 'INGESTED', 'PROCESSING', 'QA_REQUIRED', 'APPROVED', 'PUBLISHED', 'ARCHIVED', 'UPLOAD_FAILED', 'PROCESSING_FAILED', 'QA_REJECTED')),
  source_provenance_json TEXT NOT NULL DEFAULT '{}',
  manifest_json TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, version_number)
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  kind TEXT NOT NULL CHECK (kind IN ('source', 'master', 'web', 'portable', 'poster', 'pointcloud', 'collision', 'navmesh', 'report')),
  format TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  etag TEXT,
  sha256 TEXT,
  integrity_status TEXT NOT NULL CHECK (integrity_status IN ('pending', 'verified', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX assets_version_idx ON assets(version_id, kind);

CREATE TABLE upload_sessions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  asset_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  r2_upload_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  format TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  expected_size_bytes INTEGER NOT NULL CHECK (expected_size_bytes > 0),
  sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'ABORTED', 'FAILED')),
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX upload_sessions_org_idx ON upload_sessions(organisation_id, status);

CREATE TABLE upload_parts (
  upload_session_id TEXT NOT NULL REFERENCES upload_sessions(id),
  part_number INTEGER NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  etag TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (upload_session_id, part_number)
);

CREATE TABLE processing_jobs (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  input_asset_id TEXT REFERENCES assets(id),
  job_type TEXT NOT NULL,
  processor_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('QUEUED', 'LEASED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER')),
  priority INTEGER NOT NULL DEFAULT 100,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  lease_token_hash TEXT,
  leased_by TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  progress_message TEXT,
  output_json TEXT,
  error_json TEXT,
  estimated_cost_cents INTEGER,
  actual_cost_cents INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX jobs_lease_idx ON processing_jobs(state, priority, created_at);
CREATE INDEX jobs_org_idx ON processing_jobs(organisation_id, updated_at DESC);

CREATE TABLE qa_reports (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  report_json TEXT NOT NULL,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  web_asset_id TEXT NOT NULL REFERENCES assets(id),
  poster_asset_id TEXT REFERENCES assets(id),
  access_policy TEXT NOT NULL CHECK (access_policy IN ('public', 'unlisted', 'token', 'customer-authenticated')),
  access_token_hash TEXT,
  viewer_config_json TEXT NOT NULL DEFAULT '{}',
  published_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX releases_project_idx ON releases(project_id, published_at DESC);

CREATE TABLE release_channels (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  slug TEXT NOT NULL UNIQUE,
  active_release_id TEXT REFERENCES releases(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX release_channels_project_idx ON release_channels(project_id);

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
CREATE INDEX viewer_events_release_idx ON viewer_events(release_id, occurred_at DESC);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX audit_events_org_idx ON audit_events(organisation_id, created_at DESC);

CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  subject TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (bucket, subject, window_start)
);
