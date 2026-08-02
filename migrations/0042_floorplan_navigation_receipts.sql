PRAGMA foreign_keys = ON;

ALTER TABLE floorplan_revisions
  ADD COLUMN collision_asset_id TEXT REFERENCES assets(id);

ALTER TABLE floorplan_revisions
  ADD COLUMN collision_sha256 TEXT CHECK (
    collision_sha256 IS NULL OR length(collision_sha256) = 64
  );

CREATE INDEX floorplan_revisions_collision_idx
  ON floorplan_revisions(collision_asset_id);
