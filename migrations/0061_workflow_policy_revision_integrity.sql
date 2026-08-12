PRAGMA foreign_keys = ON;

ALTER TABLE project_workflow_policy_revisions
  ADD COLUMN classification_status TEXT NOT NULL DEFAULT 'legacy_unknown'
  CHECK (classification_status IN ('classified', 'legacy_unknown'));

UPDATE project_workflow_policy_revisions
SET classification_status = CASE
  WHEN id LIKE 'legacy-policy-current:%' THEN 'classified'
  ELSE 'legacy_unknown'
END;

CREATE TRIGGER project_workflow_policy_revisions_immutable_update
BEFORE UPDATE ON project_workflow_policy_revisions
BEGIN
  SELECT RAISE(ABORT, 'workflow_policy_revision_immutable');
END;

CREATE TRIGGER project_workflow_policy_revisions_immutable_delete
BEFORE DELETE ON project_workflow_policy_revisions
BEGIN
  SELECT RAISE(ABORT, 'workflow_policy_revision_immutable');
END;
