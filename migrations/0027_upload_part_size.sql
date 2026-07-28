PRAGMA foreign_keys = ON;

ALTER TABLE upload_sessions
  ADD COLUMN part_size_bytes INTEGER NOT NULL DEFAULT 26214400
    CHECK (part_size_bytes BETWEEN 5242880 AND 99614720);
