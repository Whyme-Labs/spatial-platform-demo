PRAGMA foreign_keys = ON;

-- Freezes the shell-capture agreement report and its operator resolutions
-- with the approved revision. Every other acceptance proof reads the shell
-- against itself; this column is the receipt that each wall the capture
-- disputed was explicitly classified by a human before the plan could feed
-- an automatically accepted walking map.
ALTER TABLE floorplan_revisions ADD COLUMN capture_agreement_json TEXT;
