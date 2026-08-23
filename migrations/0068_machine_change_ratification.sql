-- Public exposure requires operator-ratified structure. That was designed when
-- machine trajectory evidence changed a handful of openings, and ratifying
-- meant reclassifying each one by hand. Walked-floor clutter demotion routinely
-- changes tens of wall runs — 87 on the first production capture — and hand
-- editing 87 elements to say "yes, I accept these" is not review, it is
-- attrition, and it pushes operators toward token-only publication for reasons
-- that have nothing to do with the scene.
--
-- Record the attestation directly instead: who accepted the machine changes on
-- this exact revision, when, how many, and why. The ratification is bound to
-- the revision's frozen plan hash, so re-cooking the map invalidates it and the
-- operator must look again.
ALTER TABLE floorplan_revisions ADD COLUMN machine_change_ratified_at TEXT;
ALTER TABLE floorplan_revisions ADD COLUMN machine_change_ratified_by TEXT;
ALTER TABLE floorplan_revisions ADD COLUMN machine_change_ratified_count INTEGER;
ALTER TABLE floorplan_revisions ADD COLUMN machine_change_ratification_note TEXT;
ALTER TABLE floorplan_revisions ADD COLUMN machine_change_ratified_plan_hash TEXT;
