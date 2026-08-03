PRAGMA foreign_keys = ON;

ALTER TABLE upload_sessions
  ADD COLUMN capture_journey_id TEXT CHECK (
    capture_journey_id IS NULL OR length(capture_journey_id) = 36
  );

CREATE INDEX upload_sessions_capture_journey_idx
  ON upload_sessions(organisation_id, project_id, version_id, capture_journey_id);
