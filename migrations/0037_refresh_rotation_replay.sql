PRAGMA foreign_keys = ON;

-- Generation makes rotation compare-and-swap explicit. A losing concurrent
-- refresh receives a non-destructive stale response and never receives the
-- winning request's bearer tokens.
ALTER TABLE auth_sessions ADD COLUMN refresh_generation INTEGER NOT NULL DEFAULT 0;
