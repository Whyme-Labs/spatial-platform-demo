ALTER TABLE projects ADD COLUMN capture_adapter_v2 TEXT
  CHECK (capture_adapter_v2 IS NULL OR capture_adapter_v2 IN (
    'xgrids-lcc', 'fjd-trion', 'phone-video', 'drone-imagery', 'open-import'
  ));
UPDATE projects SET capture_adapter_v2 = capture_adapter;

ALTER TABLE project_templates ADD COLUMN capture_adapter_v2 TEXT
  CHECK (capture_adapter_v2 IS NULL OR capture_adapter_v2 IN (
    'xgrids-lcc', 'fjd-trion', 'phone-video', 'drone-imagery', 'open-import'
  ));
UPDATE project_templates SET capture_adapter_v2 = capture_adapter;

ALTER TABLE capture_bundle_manifests ADD COLUMN adapter_v2 TEXT
  CHECK (adapter_v2 IS NULL OR adapter_v2 IN (
    'xgrids-lcc', 'fjd-trion', 'phone-video', 'drone-imagery', 'open-import'
  ));
UPDATE capture_bundle_manifests SET adapter_v2 = adapter;

ALTER TABLE upload_sessions ADD COLUMN purpose TEXT NOT NULL
  DEFAULT 'gaussian_splat'
  CHECK (purpose IN (
    'gaussian_splat', 'web_scene', 'vendor_project', 'raw_capture',
    'source_images', 'source_video', 'camera_poses', 'calibration',
    'imu_trajectory', 'gnss_trajectory', 'metric_point_cloud',
    'collision_mesh'
  ));
