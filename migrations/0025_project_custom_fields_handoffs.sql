PRAGMA foreign_keys = ON;

ALTER TABLE projects ADD COLUMN create_request_hash TEXT;

CREATE TABLE project_custom_field_definitions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  field_type TEXT NOT NULL
    CHECK (field_type IN ('text', 'number', 'boolean', 'date', 'select', 'url')),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  options_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(options_json)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
  created_by TEXT NOT NULL REFERENCES users(id),
  client_operation_id TEXT,
  request_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, key),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX project_custom_fields_org_sort_idx
  ON project_custom_field_definitions
  (organisation_id, active DESC, sort_order, label);

CREATE TABLE project_custom_field_values (
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  field_id TEXT NOT NULL REFERENCES project_custom_field_definitions(id),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, field_id)
);

CREATE INDEX project_custom_field_values_org_field_idx
  ON project_custom_field_values (organisation_id, field_id, updated_at DESC);

CREATE TABLE project_portfolio_handoffs (
  id TEXT PRIMARY KEY,
  source_organisation_id TEXT NOT NULL REFERENCES organisations(id),
  target_organisation_id TEXT NOT NULL REFERENCES organisations(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  project_ids_json TEXT NOT NULL CHECK (json_valid(project_ids_json)),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  response_json TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_organisation_id, client_operation_id)
);

CREATE INDEX project_portfolio_handoffs_source_created_idx
  ON project_portfolio_handoffs (source_organisation_id, started_at DESC);

CREATE INDEX project_portfolio_handoffs_target_created_idx
  ON project_portfolio_handoffs (target_organisation_id, started_at DESC);
