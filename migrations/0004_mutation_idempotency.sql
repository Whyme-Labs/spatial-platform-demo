ALTER TABLE projects ADD COLUMN client_operation_id TEXT;
CREATE UNIQUE INDEX projects_org_operation_idx
  ON projects(organisation_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

ALTER TABLE upload_sessions ADD COLUMN client_operation_id TEXT;
CREATE UNIQUE INDEX uploads_org_operation_idx
  ON upload_sessions(organisation_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

ALTER TABLE releases ADD COLUMN client_operation_id TEXT;
CREATE UNIQUE INDEX releases_org_operation_idx
  ON releases(organisation_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;
