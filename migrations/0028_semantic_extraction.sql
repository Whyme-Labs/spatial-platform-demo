CREATE TABLE semantic_extraction_runs (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  input_asset_id TEXT NOT NULL REFERENCES assets(id),
  job_id TEXT NOT NULL UNIQUE REFERENCES processing_jobs(id),
  method TEXT NOT NULL DEFAULT 'registered-ply-walkable-candidates-v1',
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'PROCESSING', 'READY_FOR_REVIEW', 'REVIEWED', 'FAILED')),
  parameters_json TEXT NOT NULL,
  summary_json TEXT,
  report_asset_id TEXT REFERENCES assets(id),
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count BETWEEN 0 AND 100),
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  review_decision TEXT CHECK (review_decision IS NULL OR review_decision IN ('accept_selected', 'reject_all')),
  review_note TEXT,
  review_client_operation_id TEXT,
  review_request_hash TEXT,
  review_response_json TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id),
  UNIQUE (organisation_id, review_client_operation_id)
);
CREATE INDEX semantic_extraction_project_idx
  ON semantic_extraction_runs(project_id, version_id, created_at DESC);
CREATE INDEX semantic_extraction_job_idx
  ON semantic_extraction_runs(job_id, status);

CREATE TABLE semantic_candidates (
  id TEXT PRIMARY KEY,
  extraction_id TEXT NOT NULL REFERENCES semantic_extraction_runs(id) ON DELETE CASCADE,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  candidate_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('walkable_region')),
  label TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  elevation_m REAL NOT NULL,
  area_m2 REAL NOT NULL CHECK (area_m2 > 0),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  scene_entity_id TEXT REFERENCES scene_entities(id),
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (extraction_id, candidate_key)
);
CREATE INDEX semantic_candidates_extraction_idx
  ON semantic_candidates(extraction_id, status, candidate_key);
CREATE INDEX semantic_candidates_version_idx
  ON semantic_candidates(version_id, status, created_at DESC);
