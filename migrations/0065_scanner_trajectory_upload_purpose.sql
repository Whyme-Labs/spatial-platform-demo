PRAGMA foreign_keys = ON;

-- The scanner_trajectory import purpose shipped in the application (shared
-- vocabulary, Worker validation, format map, upload dialog) but never reached
-- the schema: upload_sessions.purpose pins an enumerated CHECK, so every
-- attempt to start a trajectory upload failed the constraint and surfaced as
-- an internal error. SQLite cannot widen a CHECK in place, and upload_parts
-- references upload_sessions, so both tables are rebuilt together and renamed
-- back exactly as migration 0051 did when it admitted vendor_semantic_mesh.
--
-- The rebuilt CHECK lists the complete captureAssetPurposes vocabulary; the
-- migration audit now pins these two lists together so a purpose can never
-- again ship to operators without the schema that stores it.
--
-- Widening an enumerated CHECK is backward compatible: every application
-- revision that ran against the 0051 shape writes only values this shape still
-- admits, so the frozen rollback pair keeps working.
CREATE TABLE upload_sessions_v3 (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  asset_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  r2_upload_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  format TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  expected_size_bytes INTEGER NOT NULL CHECK (expected_size_bytes > 0),
  sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'ABORTED', 'FAILED')),
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  client_operation_id TEXT,
  purpose TEXT NOT NULL DEFAULT 'gaussian_splat'
    CHECK (purpose IN (
      'gaussian_splat', 'web_scene', 'vendor_project', 'raw_capture',
      'source_images', 'source_video', 'camera_poses', 'calibration',
      'imu_trajectory', 'gnss_trajectory', 'scanner_trajectory',
      'metric_point_cloud', 'collision_mesh', 'vendor_semantic_mesh'
    )),
  capture_agent_credential_id TEXT REFERENCES capture_agent_credentials(id),
  part_size_bytes INTEGER NOT NULL DEFAULT 26214400
    CHECK (part_size_bytes BETWEEN 5242880 AND 99614720),
  capture_journey_id TEXT CHECK (
    capture_journey_id IS NULL OR length(capture_journey_id) = 36
  )
);

INSERT INTO upload_sessions_v3 (
  id, organisation_id, project_id, version_id, asset_id, object_key,
  r2_upload_id, file_name, format, mime_type, expected_size_bytes, sha256,
  status, expires_at, created_by, created_at, completed_at, client_operation_id,
  purpose, capture_agent_credential_id, part_size_bytes, capture_journey_id
)
SELECT id, organisation_id, project_id, version_id, asset_id, object_key,
  r2_upload_id, file_name, format, mime_type, expected_size_bytes, sha256,
  status, expires_at, created_by, created_at, completed_at, client_operation_id,
  purpose, capture_agent_credential_id, part_size_bytes, capture_journey_id
FROM upload_sessions;

CREATE TABLE upload_parts_v3 (
  upload_session_id TEXT NOT NULL REFERENCES upload_sessions_v3(id),
  part_number INTEGER NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  etag TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (upload_session_id, part_number)
);

INSERT INTO upload_parts_v3 (
  upload_session_id, part_number, etag, size_bytes, uploaded_at
)
SELECT upload_session_id, part_number, etag, size_bytes, uploaded_at
FROM upload_parts;

DROP TABLE upload_parts;

DROP TABLE upload_sessions;

ALTER TABLE upload_sessions_v3 RENAME TO upload_sessions;

ALTER TABLE upload_parts_v3 RENAME TO upload_parts;

CREATE INDEX upload_sessions_org_idx ON upload_sessions(organisation_id, status);

CREATE UNIQUE INDEX uploads_org_operation_idx
  ON upload_sessions(organisation_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

CREATE INDEX upload_sessions_capture_agent_idx
  ON upload_sessions (capture_agent_credential_id, created_at DESC);

CREATE INDEX upload_sessions_capture_journey_idx
  ON upload_sessions(organisation_id, project_id, version_id, capture_journey_id);

CREATE INDEX upload_sessions_expiry_idx
  ON upload_sessions(status, expires_at);
