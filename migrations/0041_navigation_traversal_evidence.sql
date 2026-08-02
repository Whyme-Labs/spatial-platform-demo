PRAGMA foreign_keys = ON;

ALTER TABLE scene_navigation_traversals
  ADD COLUMN evidence_asset_id TEXT REFERENCES assets(id);

ALTER TABLE scene_navigation_traversals
  ADD COLUMN evidence_sha256 TEXT CHECK (
    evidence_sha256 IS NULL OR length(evidence_sha256) = 64
  );

CREATE INDEX scene_navigation_traversals_evidence_idx
  ON scene_navigation_traversals(evidence_asset_id);
