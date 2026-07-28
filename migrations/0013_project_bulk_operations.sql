PRAGMA foreign_keys = ON;

CREATE TABLE project_bulk_operations (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  client_operation_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('archive', 'restore')),
  project_ids_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  response_json TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX project_bulk_operations_org_created_idx
  ON project_bulk_operations (organisation_id, started_at DESC);
