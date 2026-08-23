-- The exposure gate these columns served is gone: trajectory evidence is
-- trusted for public exposure like any other cook, so nothing reads or writes
-- a ratification. Dropped in place rather than by table rebuild, which would
-- have to recreate three indexes including the revision-sequence unique
-- constraint and silently loses them if it does not.
ALTER TABLE floorplan_revisions DROP COLUMN machine_change_ratified_at;
ALTER TABLE floorplan_revisions DROP COLUMN machine_change_ratified_by;
ALTER TABLE floorplan_revisions DROP COLUMN machine_change_ratified_count;
ALTER TABLE floorplan_revisions DROP COLUMN machine_change_ratification_note;
ALTER TABLE floorplan_revisions DROP COLUMN machine_change_ratified_plan_hash;
