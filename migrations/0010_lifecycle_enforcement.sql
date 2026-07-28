ALTER TABLE assets ADD COLUMN deleted_at TEXT;
ALTER TABLE assets ADD COLUMN deletion_reason TEXT;

CREATE INDEX assets_retention_idx
  ON assets(project_id, kind, created_at, deleted_at);

CREATE TABLE lifecycle_runs (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual', 'restore_drill')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  summary_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE lifecycle_actions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES lifecycle_runs(id),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT REFERENCES projects(id),
  action TEXT NOT NULL CHECK (action IN (
    'invitation_expired',
    'release_expired',
    'subscription_past_due',
    'subscription_expired',
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

CREATE INDEX lifecycle_actions_run_idx
  ON lifecycle_actions(run_id, created_at);
CREATE INDEX lifecycle_actions_project_idx
  ON lifecycle_actions(project_id, created_at DESC);
