ALTER TABLE memberships ADD COLUMN updated_at TEXT;
ALTER TABLE memberships ADD COLUMN revoked_at TEXT;
ALTER TABLE memberships ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

UPDATE memberships
SET updated_at = COALESCE(updated_at, created_at);

CREATE INDEX memberships_active_org_idx
  ON memberships(organisation_id, status, revoked_at, role, updated_at DESC);

CREATE TABLE organisation_invitations (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('platform_admin', 'production_operator')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  invited_by TEXT NOT NULL REFERENCES users(id),
  invited_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  accepted_by TEXT REFERENCES users(id),
  accepted_at TEXT,
  revoked_at TEXT,
  client_operation_id TEXT,
  last_sent_at TEXT,
  send_count INTEGER NOT NULL DEFAULT 0 CHECK (send_count >= 0)
);

CREATE UNIQUE INDEX organisation_invitations_operation_idx
  ON organisation_invitations(organisation_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

CREATE INDEX organisation_invitations_lookup_idx
  ON organisation_invitations(organisation_id, email, status, invited_at DESC);
