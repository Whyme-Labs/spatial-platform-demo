CREATE TABLE floorplan_extraction_runs (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  input_asset_id TEXT NOT NULL REFERENCES assets(id),
  job_id TEXT NOT NULL UNIQUE REFERENCES processing_jobs(id),
  method TEXT NOT NULL DEFAULT 'metric-pointcloud-floorplan-v1',
  normalizer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'PROCESSING', 'READY_FOR_REVIEW', 'REVIEWED', 'REJECTED', 'FAILED', 'CANCELLED')),
  parameters_json TEXT NOT NULL,
  source_evidence_json TEXT NOT NULL,
  proposal_json TEXT,
  proposal_hash TEXT,
  report_asset_id TEXT REFERENCES assets(id),
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  review_decision TEXT CHECK (review_decision IS NULL OR review_decision IN ('approve', 'reject')),
  review_note TEXT,
  review_client_operation_id TEXT,
  review_request_hash TEXT,
  review_response_json TEXT,
  reviewed_at TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id),
  UNIQUE (organisation_id, review_client_operation_id)
);
CREATE INDEX floorplan_extraction_project_idx
  ON floorplan_extraction_runs(project_id, version_id, created_at DESC);
CREATE INDEX floorplan_extraction_job_idx
  ON floorplan_extraction_runs(job_id, status);

CREATE TABLE floorplan_revisions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  extraction_id TEXT NOT NULL REFERENCES floorplan_extraction_runs(id),
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  measurement_class TEXT NOT NULL DEFAULT 'indicative'
    CHECK (measurement_class IN ('indicative')),
  status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'superseded')),
  plan_json TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  source_proposal_hash TEXT NOT NULL,
  review_note TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  approved_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (extraction_id, revision_number),
  UNIQUE (organisation_id, id)
);
CREATE INDEX floorplan_revision_project_idx
  ON floorplan_revisions(project_id, version_id, status, created_at DESC);

CREATE TABLE floorplan_export_batches (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision_id TEXT NOT NULL REFERENCES floorplan_revisions(id),
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE TABLE floorplan_exports (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  revision_id TEXT NOT NULL REFERENCES floorplan_revisions(id),
  batch_id TEXT NOT NULL REFERENCES floorplan_export_batches(id),
  asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id),
  format TEXT NOT NULL CHECK (format IN ('svg', 'pdf', 'dxf')),
  generator_version TEXT NOT NULL DEFAULT 'indicative-floorplan-export-v1',
  plan_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'superseded')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (revision_id, format)
);
CREATE INDEX floorplan_exports_revision_idx
  ON floorplan_exports(revision_id, format, created_at DESC);
