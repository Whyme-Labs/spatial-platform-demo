PRAGMA foreign_keys = ON;

CREATE TRIGGER scene_navigation_traversal_metric_profile_insert_guard
BEFORE INSERT ON scene_navigation_traversals
WHEN NEW.status = 'active'
  AND NEW.evidence_registration_sha256 IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM scene_navigation_profiles AS profile
    WHERE profile.organisation_id = NEW.organisation_id
      AND profile.project_id = NEW.project_id
      AND profile.version_id = NEW.version_id
      AND profile.world_unit = 'metres'
  )
BEGIN
  SELECT RAISE(ABORT, 'capture_registered_traversal requires metric navigation profile');
END;

CREATE TRIGGER scene_navigation_traversal_metric_profile_update_guard
BEFORE UPDATE ON scene_navigation_traversals
WHEN NEW.status = 'active'
  AND NEW.evidence_registration_sha256 IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM scene_navigation_profiles AS profile
    WHERE profile.organisation_id = NEW.organisation_id
      AND profile.project_id = NEW.project_id
      AND profile.version_id = NEW.version_id
      AND profile.world_unit = 'metres'
  )
BEGIN
  SELECT RAISE(ABORT, 'capture_registered_traversal requires metric navigation profile');
END;

CREATE TRIGGER scene_navigation_profile_registered_traversal_insert_guard
BEFORE INSERT ON scene_navigation_profiles
WHEN NEW.world_unit <> 'metres'
  AND EXISTS (
    SELECT 1
    FROM scene_navigation_traversals AS traversal
    WHERE traversal.organisation_id = NEW.organisation_id
      AND traversal.project_id = NEW.project_id
      AND traversal.version_id = NEW.version_id
      AND traversal.status = 'active'
      AND traversal.evidence_registration_sha256 IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'metric navigation profile is required by active capture_registered_traversal');
END;

CREATE TRIGGER scene_navigation_profile_registered_traversal_update_guard
BEFORE UPDATE OF organisation_id, project_id, version_id, world_unit
  ON scene_navigation_profiles
WHEN (
  EXISTS (
    SELECT 1
    FROM scene_navigation_traversals AS traversal
    WHERE traversal.organisation_id = OLD.organisation_id
      AND traversal.project_id = OLD.project_id
      AND traversal.version_id = OLD.version_id
      AND traversal.status = 'active'
      AND traversal.evidence_registration_sha256 IS NOT NULL
  )
  AND (
    NEW.organisation_id <> OLD.organisation_id OR
    NEW.project_id <> OLD.project_id OR
    NEW.version_id <> OLD.version_id OR
    NEW.world_unit <> 'metres'
  )
) OR (
  NEW.world_unit <> 'metres'
  AND EXISTS (
    SELECT 1
    FROM scene_navigation_traversals AS traversal
    WHERE traversal.organisation_id = NEW.organisation_id
      AND traversal.project_id = NEW.project_id
      AND traversal.version_id = NEW.version_id
      AND traversal.status = 'active'
      AND traversal.evidence_registration_sha256 IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(ABORT, 'metric navigation profile is required by active capture_registered_traversal');
END;

CREATE TRIGGER scene_navigation_profile_registered_traversal_delete_guard
BEFORE DELETE ON scene_navigation_profiles
WHEN EXISTS (
  SELECT 1
  FROM scene_navigation_traversals AS traversal
  WHERE traversal.organisation_id = OLD.organisation_id
    AND traversal.project_id = OLD.project_id
    AND traversal.version_id = OLD.version_id
    AND traversal.status = 'active'
    AND traversal.evidence_registration_sha256 IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'metric navigation profile is required by active capture_registered_traversal');
END;

-- Invoke the traversal-side guard once for every existing registered row so a
-- pre-migration invariant violation fails this migration loudly.
UPDATE scene_navigation_traversals
SET id = id
WHERE status = 'active' AND evidence_registration_sha256 IS NOT NULL;
