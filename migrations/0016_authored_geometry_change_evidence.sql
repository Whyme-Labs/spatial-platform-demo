ALTER TABLE change_detection_reports
  ADD COLUMN method TEXT NOT NULL DEFAULT 'manifest-asset-semantic-diff-v1';
ALTER TABLE change_detection_reports
  ADD COLUMN result TEXT;
ALTER TABLE change_detection_reports
  ADD COLUMN threshold_mm REAL;
ALTER TABLE change_detection_reports
  ADD COLUMN coordinate_assurance TEXT;
ALTER TABLE change_detection_reports
  ADD COLUMN registration_evidence TEXT;
ALTER TABLE change_detection_reports
  ADD COLUMN source_geometry_hash TEXT;
ALTER TABLE change_detection_reports
  ADD COLUMN client_operation_id TEXT;
ALTER TABLE change_detection_reports
  ADD COLUMN request_hash TEXT;
ALTER TABLE change_detection_reports
  ADD COLUMN review_decision TEXT;
ALTER TABLE change_detection_reports
  ADD COLUMN review_note TEXT;
ALTER TABLE change_detection_reports
  ADD COLUMN reviewed_by TEXT REFERENCES users(id);
ALTER TABLE change_detection_reports
  ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));

CREATE UNIQUE INDEX change_detection_operation_idx
  ON change_detection_reports(organisation_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

CREATE INDEX change_detection_project_updated_idx
  ON change_detection_reports(organisation_id, project_id, updated_at DESC);

CREATE TABLE change_detection_operations (
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  report_id TEXT NOT NULL REFERENCES change_detection_reports(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (organisation_id, client_operation_id)
);

CREATE INDEX change_detection_operations_project_idx
  ON change_detection_operations(organisation_id, project_id, created_at DESC);
