PRAGMA foreign_keys = ON;

CREATE TABLE capture_agent_credentials (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_generation INTEGER NOT NULL DEFAULT 1 CHECK (token_generation >= 1),
  project_ids_json TEXT NOT NULL CHECK (json_valid(project_ids_json)),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT,
  last_used_ip TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  rotation_operation_id TEXT,
  rotation_request_hash TEXT,
  rotated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX capture_agent_credentials_org_status_idx
  ON capture_agent_credentials (organisation_id, revoked_at, expires_at);

ALTER TABLE scene_versions
  ADD COLUMN capture_agent_credential_id TEXT
    REFERENCES capture_agent_credentials(id);

ALTER TABLE upload_sessions
  ADD COLUMN capture_agent_credential_id TEXT
    REFERENCES capture_agent_credentials(id);

CREATE INDEX upload_sessions_capture_agent_idx
  ON upload_sessions (capture_agent_credential_id, created_at DESC);
