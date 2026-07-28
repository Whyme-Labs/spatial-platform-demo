ALTER TABLE processing_jobs ADD COLUMN compute_duration_ms INTEGER;
ALTER TABLE processing_jobs ADD COLUMN active_human_duration_ms INTEGER;
ALTER TABLE processing_jobs ADD COLUMN input_bytes INTEGER;
ALTER TABLE processing_jobs ADD COLUMN output_bytes INTEGER;
ALTER TABLE processing_jobs ADD COLUMN evidence_json TEXT;

CREATE TABLE job_output_uploads (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES processing_jobs(id),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  kind TEXT NOT NULL CHECK (kind IN ('master', 'web', 'portable', 'poster', 'pointcloud', 'collision', 'navmesh', 'report')),
  format TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  expected_size_bytes INTEGER NOT NULL CHECK (expected_size_bytes > 0),
  sha256 TEXT,
  r2_upload_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'ABORTED', 'FAILED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX job_output_uploads_job_idx ON job_output_uploads(job_id, status);

CREATE TABLE job_output_parts (
  output_upload_id TEXT NOT NULL REFERENCES job_output_uploads(id),
  part_number INTEGER NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  etag TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (output_upload_id, part_number)
);
