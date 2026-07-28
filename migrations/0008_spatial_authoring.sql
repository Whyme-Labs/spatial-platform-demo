CREATE TABLE scene_entities (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  parent_id TEXT REFERENCES scene_entities(id),
  kind TEXT NOT NULL CHECK (kind IN ('floor', 'room', 'doorway', 'poi')),
  label TEXT NOT NULL,
  description TEXT,
  position_json TEXT,
  geometry_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  client_operation_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);
CREATE INDEX scene_entities_version_idx
  ON scene_entities(version_id, kind, sort_order);

CREATE TABLE scene_routes (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  label TEXT NOT NULL,
  description TEXT,
  accessibility TEXT NOT NULL DEFAULT 'standard'
    CHECK (accessibility IN ('standard', 'step_free', 'restricted')),
  estimated_seconds INTEGER CHECK (estimated_seconds IS NULL OR estimated_seconds BETWEEN 1 AND 86400),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE scene_route_stops (
  route_id TEXT NOT NULL REFERENCES scene_routes(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES scene_entities(id),
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 0),
  camera_pose_json TEXT,
  narration TEXT,
  PRIMARY KEY (route_id, sequence_number)
);

CREATE TABLE privacy_regions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  label TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('operator', 'client_review', 'automated')),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  review_comment_id TEXT REFERENCES review_comments(id),
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX privacy_regions_version_idx
  ON privacy_regions(version_id, status);

CREATE TABLE change_detection_reports (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  from_version_id TEXT NOT NULL REFERENCES scene_versions(id),
  to_version_id TEXT NOT NULL REFERENCES scene_versions(id),
  status TEXT NOT NULL CHECK (status IN ('ready', 'reviewed')),
  summary_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  UNIQUE (project_id, from_version_id, to_version_id)
);

CREATE TABLE project_delivery_policies (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  adaptive_quality INTEGER NOT NULL DEFAULT 1 CHECK (adaptive_quality IN (0, 1)),
  mobile_lite_budget REAL NOT NULL DEFAULT 0.75,
  mobile_standard_budget REAL NOT NULL DEFAULT 1.25,
  desktop_standard_budget REAL NOT NULL DEFAULT 2.0,
  desktop_high_budget REAL NOT NULL DEFAULT 4.0,
  max_initial_bytes INTEGER NOT NULL DEFAULT 15728640,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
