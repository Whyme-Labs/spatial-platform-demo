PRAGMA foreign_keys = ON;

ALTER TABLE project_templates
  ADD COLUMN policy_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE projects
  ADD COLUMN project_template_id TEXT REFERENCES project_templates(id) ON DELETE SET NULL;

ALTER TABLE projects
  ADD COLUMN workflow_policy_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX projects_template_idx
  ON projects (organisation_id, project_template_id, updated_at DESC);
