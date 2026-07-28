PRAGMA foreign_keys = ON;

CREATE TABLE project_templates (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  description TEXT,
  capture_adapter TEXT NOT NULL
    CHECK (capture_adapter IN ('xgrids-lcc', 'fjd-trion', 'open-import', 'phone-video')),
  delivery_template TEXT NOT NULL,
  notes TEXT,
  client_operation_id TEXT,
  request_hash TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, name),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX project_templates_org_updated_idx
  ON project_templates (organisation_id, updated_at DESC);

CREATE TABLE project_saved_views (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  client_operation_id TEXT,
  request_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, user_id, name),
  UNIQUE (organisation_id, user_id, client_operation_id)
);

CREATE INDEX project_saved_views_user_updated_idx
  ON project_saved_views (organisation_id, user_id, updated_at DESC);

CREATE UNIQUE INDEX project_saved_views_one_default_idx
  ON project_saved_views (organisation_id, user_id)
  WHERE is_default = 1;

CREATE TABLE project_portfolio_imports (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  project_count INTEGER NOT NULL CHECK (project_count BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  response_json TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX project_portfolio_imports_org_created_idx
  ON project_portfolio_imports (organisation_id, started_at DESC);
