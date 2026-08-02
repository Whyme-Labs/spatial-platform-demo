PRAGMA foreign_keys = ON;

ALTER TABLE capture_bundle_manifests
  ADD COLUMN review_generation INTEGER NOT NULL DEFAULT 0 CHECK (review_generation >= 0);

UPDATE capture_bundle_manifests
SET review_generation = 1
WHERE review_decision IS NOT NULL AND reviewed_at IS NOT NULL;

ALTER TABLE scene_navigation_traversals
  ADD COLUMN evidence_manifest_id TEXT REFERENCES capture_bundle_manifests(id);

ALTER TABLE scene_navigation_traversals
  ADD COLUMN evidence_manifest_sha256 TEXT CHECK (
    evidence_manifest_sha256 IS NULL OR length(evidence_manifest_sha256) = 64
  );

ALTER TABLE scene_navigation_traversals
  ADD COLUMN evidence_adapter TEXT CHECK (
    evidence_adapter IS NULL OR length(trim(evidence_adapter)) > 0
  );

ALTER TABLE scene_navigation_traversals
  ADD COLUMN evidence_manifest_review_generation INTEGER CHECK (
    evidence_manifest_review_generation IS NULL OR evidence_manifest_review_generation >= 1
  );

CREATE INDEX scene_navigation_traversals_manifest_idx
  ON scene_navigation_traversals(evidence_manifest_id);

CREATE TRIGGER scene_navigation_traversal_receipt_insert_guard
BEFORE INSERT ON scene_navigation_traversals
WHEN (
  NEW.evidence_manifest_id IS NULL OR
  NEW.evidence_manifest_sha256 IS NULL OR
  NEW.evidence_adapter IS NULL OR
  NEW.evidence_manifest_review_generation IS NULL
) AND (
  NEW.evidence_manifest_id IS NOT NULL OR
  NEW.evidence_manifest_sha256 IS NOT NULL OR
  NEW.evidence_adapter IS NOT NULL OR
  NEW.evidence_manifest_review_generation IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'traversal_capture_receipt requires manifest_id, manifest_sha256, adapter, and review_generation together');
END;

CREATE TRIGGER scene_navigation_traversal_receipt_update_guard
BEFORE UPDATE OF evidence_manifest_id, evidence_manifest_sha256, evidence_adapter,
  evidence_manifest_review_generation ON scene_navigation_traversals
WHEN (
  NEW.evidence_manifest_id IS NULL OR
  NEW.evidence_manifest_sha256 IS NULL OR
  NEW.evidence_adapter IS NULL OR
  NEW.evidence_manifest_review_generation IS NULL
) AND (
  NEW.evidence_manifest_id IS NOT NULL OR
  NEW.evidence_manifest_sha256 IS NOT NULL OR
  NEW.evidence_adapter IS NOT NULL OR
  NEW.evidence_manifest_review_generation IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'traversal_capture_receipt requires manifest_id, manifest_sha256, adapter, and review_generation together');
END;
