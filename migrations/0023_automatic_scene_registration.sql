ALTER TABLE registered_scene_change_reports
  ADD COLUMN registration_mode TEXT NOT NULL DEFAULT 'declared'
  CHECK (registration_mode IN ('declared', 'automatic_rigid'));

ALTER TABLE registered_scene_change_reports
  ADD COLUMN registration_search_radius_m REAL NOT NULL DEFAULT 1
  CHECK (registration_search_radius_m BETWEEN 0.005 AND 20);

ALTER TABLE registered_scene_change_reports
  ADD COLUMN registration_maximum_rmse_mm REAL NOT NULL DEFAULT 100
  CHECK (registration_maximum_rmse_mm BETWEEN 1 AND 10000);

ALTER TABLE registered_scene_change_reports
  ADD COLUMN registration_minimum_overlap_percent REAL NOT NULL DEFAULT 55
  CHECK (registration_minimum_overlap_percent BETWEEN 5 AND 100);

ALTER TABLE registered_scene_change_reports
  ADD COLUMN registration_status TEXT
  CHECK (registration_status IN ('accepted', 'blocked'));

ALTER TABLE registered_scene_change_reports
  ADD COLUMN registration_summary_json TEXT;
