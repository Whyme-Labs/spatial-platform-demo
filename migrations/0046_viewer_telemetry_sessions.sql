PRAGMA foreign_keys = ON;

ALTER TABLE release_channels
  ADD COLUMN activation_generation INTEGER NOT NULL DEFAULT 1 CHECK (
    activation_generation >= 1
  );

CREATE TABLE viewer_telemetry_sessions (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL REFERENCES releases(id),
  channel_id TEXT NOT NULL REFERENCES release_channels(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  auth_session_id TEXT NOT NULL REFERENCES auth_sessions(id),
  activation_generation INTEGER NOT NULL CHECK (activation_generation >= 1),
  expires_at_epoch INTEGER NOT NULL CHECK (expires_at_epoch > 0),
  next_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX viewer_telemetry_sessions_expiry_idx
  ON viewer_telemetry_sessions(expires_at_epoch, id);

CREATE UNIQUE INDEX viewer_telemetry_sessions_auth_run_idx
  ON viewer_telemetry_sessions(
    channel_id, release_id, activation_generation, auth_session_id
  );

ALTER TABLE viewer_events
  ADD COLUMN received_at_ms INTEGER CHECK (
    received_at_ms IS NULL OR received_at_ms >= 0
  );

ALTER TABLE viewer_events
  ADD COLUMN session_sequence INTEGER CHECK (
    session_sequence IS NULL OR session_sequence >= 1
  );

CREATE UNIQUE INDEX viewer_events_session_sequence_idx
  ON viewer_events(release_id, session_id, session_sequence)
  WHERE event_type = 'navigation_traversal' AND session_id IS NOT NULL
    AND session_sequence IS NOT NULL;

CREATE TRIGGER viewer_navigation_event_active_release_guard
BEFORE INSERT ON viewer_events
WHEN NEW.event_type = 'navigation_traversal'
  AND NOT EXISTS (
    SELECT 1
    FROM viewer_telemetry_sessions AS session
    JOIN release_channels AS channel ON channel.id = session.channel_id
    JOIN releases AS release ON release.id = session.release_id
    JOIN auth_sessions AS auth_session
      ON auth_session.id = session.auth_session_id
      AND auth_session.user_id = session.created_by
      AND auth_session.organisation_id = release.organisation_id
    JOIN memberships AS membership
      ON membership.organisation_id = auth_session.organisation_id
      AND membership.user_id = auth_session.user_id
    WHERE session.id = NEW.session_id
      AND session.release_id = NEW.release_id
      AND session.expires_at_epoch >= unixepoch('now')
      AND channel.active_release_id = NEW.release_id
      AND channel.activation_generation = session.activation_generation
      AND release.revoked_at IS NULL
      AND (
        release.expires_at IS NULL
        OR unixepoch(release.expires_at) > unixepoch('now')
      )
      AND auth_session.revoked_at IS NULL
      AND unixepoch(auth_session.expires_at) > unixepoch('now')
      AND membership.revoked_at IS NULL
      AND membership.status = 'active'
      AND (
        membership.role IN ('platform_admin', 'production_operator')
        OR EXISTS (
          SELECT 1 FROM project_access AS access
          WHERE access.organisation_id = release.organisation_id
            AND access.project_id = release.project_id
            AND access.user_id = auth_session.user_id
            AND access.role = 'customer_reviewer'
            AND access.revoked_at IS NULL
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'navigation_traversal evidence requires an active release and reviewer authorization');
END;
