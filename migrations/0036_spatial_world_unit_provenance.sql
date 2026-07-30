ALTER TABLE semantic_candidates
  ADD COLUMN world_unit TEXT NOT NULL DEFAULT 'metres'
  CHECK (world_unit IN ('metres', 'scene_units'));

ALTER TABLE scene_entities
  ADD COLUMN world_unit TEXT NOT NULL DEFAULT 'metres'
  CHECK (world_unit IN ('metres', 'scene_units'));

ALTER TABLE scene_navigation_obstacles
  ADD COLUMN world_unit TEXT NOT NULL DEFAULT 'metres'
  CHECK (world_unit IN ('metres', 'scene_units'));

CREATE INDEX scene_entities_version_unit_idx
  ON scene_entities(version_id, world_unit, status);

CREATE INDEX scene_navigation_obstacles_version_unit_idx
  ON scene_navigation_obstacles(version_id, world_unit, status);
