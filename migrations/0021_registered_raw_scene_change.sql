CREATE TABLE registered_scene_change_reports (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  baseline_version_id TEXT NOT NULL REFERENCES scene_versions(id),
  candidate_version_id TEXT NOT NULL REFERENCES scene_versions(id),
  baseline_asset_id TEXT NOT NULL REFERENCES assets(id),
  candidate_asset_id TEXT NOT NULL REFERENCES assets(id),
  job_id TEXT NOT NULL UNIQUE REFERENCES processing_jobs(id),
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTER', 'REVIEWED')
  ),
  coordinate_assurance TEXT NOT NULL CHECK (
    coordinate_assurance IN ('shared_local_frame', 'registered_project_frame')
  ),
  registration_evidence TEXT NOT NULL,
  voxel_size_m REAL NOT NULL CHECK (voxel_size_m BETWEEN 0.005 AND 5),
  structural_threshold_percent REAL NOT NULL CHECK (
    structural_threshold_percent BETWEEN 0 AND 100
  ),
  photometric_threshold_percent REAL NOT NULL CHECK (
    photometric_threshold_percent BETWEEN 0 AND 100
  ),
  centroid_threshold_mm REAL NOT NULL CHECK (centroid_threshold_mm BETWEEN 1 AND 10000),
  maximum_sample_points INTEGER NOT NULL CHECK (
    maximum_sample_points BETWEEN 1000 AND 10000000
  ),
  report_asset_id TEXT REFERENCES assets(id),
  result TEXT CHECK (result IN ('changes_detected', 'no_material_change')),
  summary_json TEXT,
  error_json TEXT,
  review_decision TEXT CHECK (
    review_decision IN ('accepted', 'needs_recapture', 'investigate')
  ),
  review_note TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX registered_scene_change_project_idx
  ON registered_scene_change_reports(project_id, created_at DESC);
CREATE INDEX registered_scene_change_job_idx
  ON registered_scene_change_reports(job_id, status);
