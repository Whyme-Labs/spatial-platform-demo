ALTER TABLE measurement_qa_reports ADD COLUMN source_geometry_hash TEXT;

CREATE TABLE measurement_deliverables (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  brief_id TEXT NOT NULL REFERENCES measurement_briefs(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  qa_report_id TEXT NOT NULL REFERENCES measurement_qa_reports(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  deliverable_type TEXT NOT NULL
    CHECK (deliverable_type IN ('floor_plan_dxf', 'scan_to_cad_dxf')),
  source_geometry_hash TEXT NOT NULL,
  generator_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'superseded')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (brief_id, qa_report_id, deliverable_type, source_geometry_hash)
);

CREATE INDEX measurement_deliverables_project_idx
  ON measurement_deliverables(project_id, created_at DESC);
CREATE INDEX measurement_deliverables_brief_idx
  ON measurement_deliverables(brief_id, created_at DESC);
