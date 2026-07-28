PRAGMA foreign_keys = ON;

CREATE TABLE auth_refresh_token_history (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES auth_sessions(id),
  used_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX auth_refresh_history_session_idx
  ON auth_refresh_token_history(session_id, used_at DESC);
