PRAGMA foreign_keys = ON;

ALTER TABLE scene_navigation_traversals
  ADD COLUMN evidence_registration_sha256 TEXT CHECK (
    evidence_registration_sha256 IS NULL OR length(evidence_registration_sha256) = 64
  );

ALTER TABLE scene_navigation_traversals
  ADD COLUMN evidence_source_to_world_json TEXT CHECK (
    evidence_source_to_world_json IS NULL OR json_valid(evidence_source_to_world_json)
  );

ALTER TABLE scene_navigation_traversals
  ADD COLUMN evidence_source_path_json TEXT CHECK (
    evidence_source_path_json IS NULL OR json_valid(evidence_source_path_json)
  );

ALTER TABLE scene_navigation_traversals
  ADD COLUMN request_hash TEXT CHECK (
    request_hash IS NULL OR length(request_hash) = 64
  );

DROP TRIGGER scene_navigation_traversal_receipt_insert_guard;
DROP TRIGGER scene_navigation_traversal_receipt_update_guard;

CREATE TRIGGER scene_navigation_traversal_receipt_insert_guard
BEFORE INSERT ON scene_navigation_traversals
WHEN (
  NEW.evidence_manifest_id IS NULL OR
  NEW.evidence_manifest_sha256 IS NULL OR
  NEW.evidence_adapter IS NULL OR
  NEW.evidence_manifest_review_generation IS NULL OR
  NEW.evidence_registration_sha256 IS NULL OR
  NEW.evidence_source_to_world_json IS NULL OR
  NEW.evidence_source_path_json IS NULL
) AND (
  NEW.evidence_manifest_id IS NOT NULL OR
  NEW.evidence_manifest_sha256 IS NOT NULL OR
  NEW.evidence_adapter IS NOT NULL OR
  NEW.evidence_manifest_review_generation IS NOT NULL OR
  NEW.evidence_registration_sha256 IS NOT NULL OR
  NEW.evidence_source_to_world_json IS NOT NULL OR
  NEW.evidence_source_path_json IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'traversal_capture_receipt requires manifest_id, manifest_sha256, adapter, review_generation, registration_sha256, source_to_world, and source_path together');
END;

CREATE TRIGGER scene_navigation_traversal_receipt_update_guard
BEFORE UPDATE OF evidence_manifest_id, evidence_manifest_sha256, evidence_adapter,
  evidence_manifest_review_generation, evidence_registration_sha256,
  evidence_source_to_world_json, evidence_source_path_json ON scene_navigation_traversals
WHEN (
  NEW.evidence_manifest_id IS NULL OR
  NEW.evidence_manifest_sha256 IS NULL OR
  NEW.evidence_adapter IS NULL OR
  NEW.evidence_manifest_review_generation IS NULL OR
  NEW.evidence_registration_sha256 IS NULL OR
  NEW.evidence_source_to_world_json IS NULL OR
  NEW.evidence_source_path_json IS NULL
) AND (
  NEW.evidence_manifest_id IS NOT NULL OR
  NEW.evidence_manifest_sha256 IS NOT NULL OR
  NEW.evidence_adapter IS NOT NULL OR
  NEW.evidence_manifest_review_generation IS NOT NULL OR
  NEW.evidence_registration_sha256 IS NOT NULL OR
  NEW.evidence_source_to_world_json IS NOT NULL OR
  NEW.evidence_source_path_json IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'traversal_capture_receipt requires manifest_id, manifest_sha256, adapter, review_generation, registration_sha256, source_to_world, and source_path together');
END;
