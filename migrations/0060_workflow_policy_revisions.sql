PRAGMA foreign_keys = ON;

CREATE TABLE project_workflow_policy_revisions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  delivery_template TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  transition_reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, revision_number)
);

CREATE INDEX project_policy_revisions_project_idx
  ON project_workflow_policy_revisions (project_id, revision_number DESC);

ALTER TABLE projects ADD COLUMN workflow_policy_revision_id TEXT
  REFERENCES project_workflow_policy_revisions(id);

ALTER TABLE scene_versions ADD COLUMN workflow_policy_revision_id TEXT
  REFERENCES project_workflow_policy_revisions(id);

ALTER TABLE releases ADD COLUMN workflow_policy_revision_id TEXT
  REFERENCES project_workflow_policy_revisions(id);

INSERT INTO project_workflow_policy_revisions
  (id, organisation_id, project_id, revision_number, delivery_template,
    policy_json, transition_reason, created_by, created_at)
SELECT 'legacy-policy-unknown:' || id, organisation_id, id, 1, delivery_template,
  '{"schemaVersion":"project-workflow-policy-v1","privacyReview":"strict","publication":"private-review","navigation":"review-walk-and-fly","measurement":"hidden","hosting":"managed-optional","quality":"standard","requiredFiles":"visual-and-registered-geometry","structureWorkflow":"review-every-proposal","navigationClearance":"custom"}',
  'Historical artifact policy is unknown; conservative review-only policy recorded during migration.',
  created_by, created_at
FROM projects;

INSERT INTO project_workflow_policy_revisions
  (id, organisation_id, project_id, revision_number, delivery_template,
    policy_json, transition_reason, created_by, created_at)
SELECT 'legacy-policy-current:' || id, organisation_id, id, 2, delivery_template,
  workflow_policy_json, 'Current project policy migrated from the project record.',
  created_by, created_at
FROM projects;

UPDATE projects
SET workflow_policy_revision_id = 'legacy-policy-current:' || id;

UPDATE scene_versions
SET workflow_policy_revision_id = 'legacy-policy-unknown:' || project_id;

UPDATE releases
SET workflow_policy_revision_id = (
  SELECT sv.workflow_policy_revision_id FROM scene_versions sv
  WHERE sv.id = releases.version_id
);
