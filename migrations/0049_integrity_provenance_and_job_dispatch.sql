PRAGMA foreign_keys = ON;

ALTER TABLE assets
  ADD COLUMN integrity_source TEXT CHECK (
    integrity_source IS NULL OR integrity_source IN (
      'client_declared', 'server_verified', 'processor_reported', 'operator_manual'
    )
  );

ALTER TABLE processing_jobs ADD COLUMN dispatched_at TEXT;

ALTER TABLE processing_jobs
  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0);

ALTER TABLE project_asset_handoff_items ADD COLUMN dispatched_at TEXT;

CREATE INDEX jobs_dispatch_backoff_idx
  ON processing_jobs(state, dispatched_at);

CREATE INDEX upload_sessions_expiry_idx
  ON upload_sessions(status, expires_at);

-- Lifecycle enforcement now retires expired OPEN upload sessions, which needs
-- a vocabulary the append-only action ledger did not yet allow.
CREATE TABLE lifecycle_actions_v2 (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES lifecycle_runs(id),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT REFERENCES projects(id),
  action TEXT NOT NULL CHECK (action IN (
    'invitation_expired',
    'release_expired',
    'subscription_past_due',
    'subscription_expired',
    'upload_session_expired',
    'project_archived',
    'asset_deleted',
    'restore_verified',
    'notification_sent',
    'notification_failed'
  )),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO lifecycle_actions_v2 (
  id, run_id, organisation_id, project_id, action, resource_type,
  resource_id, metadata_json, created_at
)
SELECT id, run_id, organisation_id, project_id, action, resource_type,
  resource_id, metadata_json, created_at
FROM lifecycle_actions;

DROP TABLE lifecycle_actions;

ALTER TABLE lifecycle_actions_v2 RENAME TO lifecycle_actions;

CREATE INDEX lifecycle_actions_run_idx
  ON lifecycle_actions(run_id, created_at);
CREATE INDEX lifecycle_actions_project_idx
  ON lifecycle_actions(project_id, created_at DESC);
