PRAGMA foreign_keys = ON;

-- ASTM E57 is a public container standard, so a structured export's scan poses,
-- image records, and point-field inventory can be preserved as evidence instead
-- of being reduced to unlabelled XYZ points. This table stores only the bounded
-- summary the processor read from the public structure; the immutable JSON
-- report asset holds the full reading. No vendor classification or mesh schema
-- is decoded or stored here.
CREATE TABLE capture_scan_structures (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  job_id TEXT NOT NULL REFERENCES processing_jobs(id),
  report_asset_id TEXT REFERENCES assets(id),
  method TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('structure_read', 'structure_unreadable')),
  source_format TEXT NOT NULL,
  scan_count INTEGER NOT NULL DEFAULT 0 CHECK (scan_count >= 0),
  image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  has_per_scan_poses INTEGER NOT NULL DEFAULT 0
    CHECK (has_per_scan_poses IN (0, 1)),
  vendor_field_names_json TEXT NOT NULL DEFAULT '[]',
  report_sha256 TEXT,
  unreadable_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, job_id)
);

CREATE INDEX capture_scan_structures_version_idx
  ON capture_scan_structures(
    organisation_id,
    project_id,
    version_id,
    created_at DESC
  );

CREATE INDEX capture_scan_structures_asset_idx
  ON capture_scan_structures(organisation_id, asset_id, created_at DESC);

-- A pose-path claim was previously bound to nothing. It may now optionally cite
-- one immutable structure reading, which binds the trajectory to the exported
-- scan poses it claims to describe.
ALTER TABLE capture_completeness_reports
  ADD COLUMN scan_structure_id TEXT REFERENCES capture_scan_structures(id);

-- Vendor semantic exports (classified meshes and segmentation sidecars) are now
-- preserved under their own import purpose instead of being rejected outright
-- or shoehorned into the collision-mesh purpose, which would assert a physical
-- claim the platform cannot support. SQLite cannot widen a CHECK constraint in
-- place, and upload_parts references upload_sessions, so both tables are
-- rebuilt together and renamed back so the child foreign key follows.
CREATE TABLE upload_sessions_v2 (
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
      'imu_trajectory', 'gnss_trajectory', 'metric_point_cloud',
      'collision_mesh', 'vendor_semantic_mesh'
    )),
  capture_agent_credential_id TEXT REFERENCES capture_agent_credentials(id),
  part_size_bytes INTEGER NOT NULL DEFAULT 26214400
    CHECK (part_size_bytes BETWEEN 5242880 AND 99614720),
  capture_journey_id TEXT CHECK (
    capture_journey_id IS NULL OR length(capture_journey_id) = 36
  )
);

INSERT INTO upload_sessions_v2 (
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

CREATE TABLE upload_parts_v2 (
  upload_session_id TEXT NOT NULL REFERENCES upload_sessions_v2(id),
  part_number INTEGER NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  etag TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (upload_session_id, part_number)
);

INSERT INTO upload_parts_v2 (
  upload_session_id, part_number, etag, size_bytes, uploaded_at
)
SELECT upload_session_id, part_number, etag, size_bytes, uploaded_at
FROM upload_parts;

DROP TABLE upload_parts;

DROP TABLE upload_sessions;

ALTER TABLE upload_sessions_v2 RENAME TO upload_sessions;

ALTER TABLE upload_parts_v2 RENAME TO upload_parts;

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
