PRAGMA foreign_keys = ON;

-- Wayfinder (#32): a revision approved under the trajectoryAutoOpen policy
-- freezes the proposal's trajectory evidence together with the exact list of
-- unresolved openings that evidence qualified for cooking as passable. The
-- frozen blob is the single source the collision cook, the navigation
-- authoring receipt, and automatic acceptance all echo — nothing downstream
-- recomputes the qualification. NULL means the feature was off (or no
-- evidence existed) at approval: the plan cooked sealed, exactly as before.
ALTER TABLE floorplan_revisions ADD COLUMN trajectory_evidence_json TEXT;
