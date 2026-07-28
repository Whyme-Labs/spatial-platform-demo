CREATE TABLE capture_bundle_manifests (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  adapter TEXT NOT NULL
    CHECK (adapter IN ('xgrids-lcc', 'fjd-trion', 'open-import', 'phone-video')),
  schema_version TEXT NOT NULL CHECK (schema_version = '1.0.0'),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'reviewed')),
  result TEXT NOT NULL
    CHECK (result IN ('ready', 'ready_with_warnings', 'blocked')),
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  manifest_asset_id TEXT NOT NULL REFERENCES assets(id),
  manifest_hash TEXT NOT NULL,
  canonical_manifest_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  review_decision TEXT
    CHECK (review_decision IN ('accepted', 'needs_vendor_evidence', 'rejected')),
  review_note TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX capture_bundle_project_idx
  ON capture_bundle_manifests(
    organisation_id,
    project_id,
    version_id,
    created_at DESC
  );
