ALTER TABLE scene_navigation_profiles
  ADD COLUMN world_unit TEXT NOT NULL DEFAULT 'metres'
  CHECK (world_unit IN ('metres', 'scene_units'));
