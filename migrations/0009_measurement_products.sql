CREATE TABLE measurement_briefs (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  product_type TEXT NOT NULL CHECK (product_type IN ('measured_floor_plan', 'scan_to_cad')),
  intended_use TEXT NOT NULL,
  units TEXT NOT NULL DEFAULT 'metres' CHECK (units IN ('metres', 'millimetres')),
  tolerance_mm REAL NOT NULL CHECK (tolerance_mm > 0 AND tolerance_mm <= 1000),
  reliance_class TEXT NOT NULL CHECK (reliance_class IN ('indicative', 'project_verified', 'professional_certified')),
  coordinate_reference TEXT,
  exclusions TEXT,
  acceptance_notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'evidence_required', 'qa_required', 'accepted', 'rejected')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX measurement_briefs_project_idx
  ON measurement_briefs(project_id, created_at DESC);

CREATE TABLE measurement_check_points (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL REFERENCES measurement_briefs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  reference_x REAL NOT NULL,
  reference_y REAL NOT NULL,
  reference_z REAL NOT NULL,
  observed_x REAL NOT NULL,
  observed_y REAL NOT NULL,
  observed_z REAL NOT NULL,
  residual_mm REAL NOT NULL CHECK (residual_mm >= 0),
  evidence_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX measurement_points_brief_idx ON measurement_check_points(brief_id);

CREATE TABLE measurement_qa_reports (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  brief_id TEXT NOT NULL REFERENCES measurement_briefs(id),
  point_count INTEGER NOT NULL CHECK (point_count >= 0),
  rmse_mm REAL,
  mean_mm REAL,
  max_mm REAL,
  p95_mm REAL,
  tolerance_mm REAL NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('insufficient_evidence', 'pass', 'fail')),
  methodology TEXT NOT NULL,
  generated_by TEXT NOT NULL REFERENCES users(id),
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE professional_signoffs (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  brief_id TEXT NOT NULL REFERENCES measurement_briefs(id),
  professional_name TEXT NOT NULL,
  registration_body TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  scope TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  evidence_asset_id TEXT REFERENCES assets(id),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE project_cost_records (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  brief_id TEXT REFERENCES measurement_briefs(id),
  category TEXT NOT NULL CHECK (category IN ('capture_labour', 'travel', 'compute', 'cleanup_labour', 'qa_labour', 'partner', 'hosting', 'other')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'MYR',
  quantity REAL NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit TEXT,
  note TEXT,
  incurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
