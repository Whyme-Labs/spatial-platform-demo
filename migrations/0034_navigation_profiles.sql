CREATE TABLE scene_navigation_profiles (
  version_id TEXT PRIMARY KEY REFERENCES scene_versions(id),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  agent_radius REAL NOT NULL CHECK (agent_radius BETWEEN 0.05 AND 2),
  agent_height REAL NOT NULL CHECK (agent_height BETWEEN 0.5 AND 4),
  eye_height REAL NOT NULL CHECK (eye_height BETWEEN 0.3 AND 3),
  max_step_metres REAL NOT NULL CHECK (max_step_metres BETWEEN 0.01 AND 0.5),
  updated_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX scene_navigation_profiles_project_idx
  ON scene_navigation_profiles(project_id, updated_at DESC);
