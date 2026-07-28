PRAGMA foreign_keys = ON;

CREATE TABLE auth_otp_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  consumed_at TEXT,
  requested_ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX auth_otp_email_created_idx ON auth_otp_challenges(email, created_at DESC);
CREATE INDEX auth_otp_expiry_idx ON auth_otp_challenges(expires_at);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  refresh_token_hash TEXT NOT NULL,
  previous_refresh_token_hash TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT,
  user_agent TEXT,
  ip_address TEXT,
  rotated_at TEXT,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX auth_sessions_refresh_idx ON auth_sessions(refresh_token_hash);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id, expires_at DESC);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE auth_security_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  email_hash TEXT,
  user_id TEXT REFERENCES users(id),
  session_id TEXT,
  request_id TEXT NOT NULL,
  ip_address TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX auth_security_events_created_idx ON auth_security_events(event_type, created_at DESC);
