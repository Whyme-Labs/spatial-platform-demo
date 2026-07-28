CREATE TABLE capture_completeness_reports (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'reviewed')),
  method TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('complete', 'complete_with_warnings', 'recapture_required', 'insufficient_evidence')),
  source_asset_id TEXT NOT NULL REFERENCES assets(id),
  source_file_name TEXT NOT NULL,
  source_format TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  coordinate_frame TEXT NOT NULL,
  alignment_evidence TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  review_decision TEXT CHECK (review_decision IN ('accepted', 'needs_recapture')),
  review_note TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX capture_completeness_project_idx
  ON capture_completeness_reports(organisation_id, project_id, version_id, created_at DESC);
