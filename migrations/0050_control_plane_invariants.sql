PRAGMA foreign_keys = ON;

-- Renewable scene render sessions. Scene tokens were HMAC-signed with a fixed
-- TTL and baked once into asset URLs, so paged RAD streaming started failing
-- mid-walkthrough with no way to refresh. A token now carries a sessionId whose
-- row can be extended up to a hard ceiling.
CREATE TABLE scene_render_sessions (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id),
  activation_generation INTEGER NOT NULL CHECK (activation_generation >= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at_epoch INTEGER NOT NULL CHECK (expires_at_epoch > 0),
  hard_expires_at_epoch INTEGER NOT NULL CHECK (hard_expires_at_epoch > 0),
  renewal_count INTEGER NOT NULL DEFAULT 0 CHECK (renewal_count >= 0)
);

CREATE INDEX scene_render_sessions_release_idx
  ON scene_render_sessions(release_id, hard_expires_at_epoch);

CREATE INDEX scene_render_sessions_expiry_idx
  ON scene_render_sessions(hard_expires_at_epoch, id);

-- One non-terminal hosting subscription per project. Manual invoice issuance
-- used to insert a fresh subscription per invoice, which left cancellation
-- picking an arbitrary row. Collapse the historical duplicates (keep the most
-- recently updated non-terminal row) before the invariant is enforced.
UPDATE project_hosting_subscriptions
SET status = 'cancelled', updated_at = datetime('now')
WHERE status IN ('active', 'past_due')
  AND id != (
    SELECT keep.id FROM project_hosting_subscriptions keep
    WHERE keep.project_id = project_hosting_subscriptions.project_id
      AND keep.status IN ('active', 'past_due')
    ORDER BY keep.updated_at DESC, keep.created_at DESC, keep.id
    LIMIT 1
  );

CREATE UNIQUE INDEX project_subscriptions_single_live_idx
  ON project_hosting_subscriptions(project_id)
  WHERE status IN ('active', 'past_due');

-- Tenant invitations are no longer auto-accepted for users who already belong
-- to an organisation, so they need an explicit declined terminal state. SQLite
-- cannot widen a CHECK constraint in place.
CREATE TABLE organisation_invitations_v2 (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('platform_admin', 'production_operator')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  invited_by TEXT NOT NULL REFERENCES users(id),
  invited_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  accepted_by TEXT REFERENCES users(id),
  accepted_at TEXT,
  revoked_at TEXT,
  client_operation_id TEXT,
  last_sent_at TEXT,
  send_count INTEGER NOT NULL DEFAULT 0 CHECK (send_count >= 0),
  declined_by TEXT REFERENCES users(id),
  declined_at TEXT
);

INSERT INTO organisation_invitations_v2 (
  id, organisation_id, email, role, status, invited_by, invited_at, expires_at,
  accepted_by, accepted_at, revoked_at, client_operation_id, last_sent_at, send_count
)
SELECT id, organisation_id, email, role, status, invited_by, invited_at, expires_at,
  accepted_by, accepted_at, revoked_at, client_operation_id, last_sent_at, send_count
FROM organisation_invitations;

DROP TABLE organisation_invitations;

ALTER TABLE organisation_invitations_v2 RENAME TO organisation_invitations;

CREATE UNIQUE INDEX organisation_invitations_operation_idx
  ON organisation_invitations(organisation_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

CREATE INDEX organisation_invitations_lookup_idx
  ON organisation_invitations(organisation_id, email, status, invited_at DESC);

CREATE INDEX organisation_invitations_email_idx
  ON organisation_invitations(email, status, expires_at);
