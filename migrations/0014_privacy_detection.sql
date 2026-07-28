CREATE TABLE privacy_scans (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  detector TEXT NOT NULL,
  detector_version TEXT NOT NULL,
  targets_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTER')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  input_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT,
  error_json TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (organisation_id, client_operation_id)
);
CREATE INDEX privacy_scans_version_idx
  ON privacy_scans(version_id, created_at DESC);
CREATE INDEX privacy_scans_status_idx
  ON privacy_scans(status, updated_at);

CREATE TABLE privacy_scan_inputs (
  scan_id TEXT NOT NULL REFERENCES privacy_scans(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  asset_sha256 TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scan_id, asset_id)
);

CREATE TABLE privacy_candidates (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES privacy_scans(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  target TEXT NOT NULL,
  label TEXT NOT NULL,
  bbox_json TEXT NOT NULL,
  bbox_hash TEXT NOT NULL,
  confidence REAL CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  ),
  detector_metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'confirmed', 'dismissed', 'resolved')
  ),
  decision_note TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (scan_id, asset_id, target, bbox_hash)
);
CREATE INDEX privacy_candidates_version_idx
  ON privacy_candidates(version_id, status, created_at DESC);
