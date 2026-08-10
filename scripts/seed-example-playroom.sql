PRAGMA foreign_keys = ON;

-- Production-safe, idempotent example release. The large binary is uploaded to
-- the matching R2 object key before this metadata transaction is applied.
INSERT OR IGNORE INTO projects (
  id,
  organisation_id,
  name,
  slug,
  status,
  capture_adapter,
  delivery_template,
  notes,
  created_by,
  created_at,
  updated_at
) VALUES (
  '665229f5-8848-4f78-bbaf-94005d36eea7',
  '00000000-0000-4000-8000-000000000001',
  'Playroom indoor example',
  'playroom-indoor-example',
  'PUBLISHED',
  'open-import',
  'Property showcase',
  'Public Apache-2.0 example used to validate Spark browser delivery, source provenance, camera alignment, and R2 range serving.',
  '00000000-0000-4000-8000-000000000002',
  '2026-07-26T15:30:00.000Z',
  '2026-07-26T15:30:00.000Z'
);

INSERT OR IGNORE INTO scene_versions (
  id,
  project_id,
  version_number,
  status,
  source_provenance_json,
  manifest_json,
  created_by,
  created_at,
  updated_at
) VALUES (
  '5eacce1f-9679-46f9-af47-ed300e14c38d',
  '665229f5-8848-4f78-bbaf-94005d36eea7',
  1,
  'PUBLISHED',
  '{"sourceType":"public-example","dataset":"Voxel51/gaussian_splatting","scene":"playroom","sourceUrl":"https://huggingface.co/datasets/Voxel51/gaussian_splatting/resolve/main/FO_dataset/playroom/point_cloud/iteration_30000/point_cloud.ply","referenceImageUrl":"https://huggingface.co/datasets/Voxel51/gaussian_splatting/resolve/main/FO_dataset/playroom/DSC05572.jpg","license":"Apache-2.0","sourceSha256":"c6fddedf6c7b412d078bbbaa1826e7a1b258f75f862c5190dc50a646243d7d9e","retrievedAt":"2026-07-26T12:00:00.000Z","derivative":{"format":"spz","tool":"Spark transcodeSpz 2.1.0","maxSh":3,"sha256":"8245dea36a48923dd57847ee9df99a941b366999e9e581c7a773497bd70f691f"}}',
  '{"schemaVersion":"1.0","units":"source-defined","coordinateSystem":{"axisConvention":"COLMAP world"},"quality":{"visualGrade":"A","measurementGrade":"visual-only","privacyStatus":"approved"}}',
  '00000000-0000-4000-8000-000000000002',
  '2026-07-26T15:30:00.000Z',
  '2026-07-26T15:30:00.000Z'
);

INSERT OR IGNORE INTO assets (
  id,
  organisation_id,
  project_id,
  version_id,
  kind,
  format,
  object_key,
  file_name,
  mime_type,
  size_bytes,
  etag,
  sha256,
  integrity_status,
  created_at
) VALUES (
  'cfb2942a-697f-444c-9b7f-4bbc184273ef',
  '00000000-0000-4000-8000-000000000001',
  '665229f5-8848-4f78-bbaf-94005d36eea7',
  '5eacce1f-9679-46f9-af47-ed300e14c38d',
  'web',
  'spz',
  'delivery-private/00000000-0000-4000-8000-000000000001/665229f5-8848-4f78-bbaf-94005d36eea7/5eacce1f-9679-46f9-af47-ed300e14c38d/playroom-30k.spz',
  'playroom-30k.spz',
  'application/octet-stream',
  45099690,
  '"1328dd27925b159f4f416b1278ac0973"',
  '8245dea36a48923dd57847ee9df99a941b366999e9e581c7a773497bd70f691f',
  'verified',
  '2026-07-26T15:30:00.000Z'
);

INSERT OR IGNORE INTO assets (
  id,
  organisation_id,
  project_id,
  version_id,
  kind,
  format,
  object_key,
  file_name,
  mime_type,
  size_bytes,
  etag,
  sha256,
  integrity_status,
  created_at
) VALUES (
  'cfb2942a-697f-444c-9b7f-4bbc184273f0',
  '00000000-0000-4000-8000-000000000001',
  '665229f5-8848-4f78-bbaf-94005d36eea7',
  '5eacce1f-9679-46f9-af47-ed300e14c38d',
  'web',
  'rad',
  'delivery-private/00000000-0000-4000-8000-000000000001/665229f5-8848-4f78-bbaf-94005d36eea7/5eacce1f-9679-46f9-af47-ed300e14c38d/playroom-quality.rad',
  'playroom-quality.rad',
  'application/octet-stream',
  65149352,
  '"5d05837b04cae02d4df924d93333312a"',
  '97165a5eab5e4dd3c7f29b71a3c3dad7505660328fcaa7751e71e5626aa64269',
  'verified',
  '2026-07-27T09:30:00.000Z'
);

INSERT OR IGNORE INTO qa_reports (
  id,
  organisation_id,
  project_id,
  version_id,
  status,
  report_json,
  reviewed_by,
  reviewed_at,
  created_at
) VALUES (
  '89d92c29-b846-4c7a-8125-d267e054d634',
  '00000000-0000-4000-8000-000000000001',
  '665229f5-8848-4f78-bbaf-94005d36eea7',
  '5eacce1f-9679-46f9-af47-ed300e14c38d',
  'approved',
  '{"visualGrade":"A","privacyStatus":"approved","measurementGrade":"visual-only","checks":{"sparkRender":"passed","sourceCameraAlignment":"passed","desktopBrowser":"passed","assetSha256":"verified"},"notes":"Public sample only; no measurement claims."}',
  '00000000-0000-4000-8000-000000000002',
  '2026-07-26T15:30:00.000Z',
  '2026-07-26T15:30:00.000Z'
);

INSERT OR IGNORE INTO releases (
  id,
  organisation_id,
  project_id,
  version_id,
  web_asset_id,
  access_policy,
  viewer_config_json,
  published_at,
  created_by,
  created_at
) VALUES (
  'ab1ba24f-e8e3-4b76-8bb2-ce06be0f0a27',
  '00000000-0000-4000-8000-000000000001',
  '665229f5-8848-4f78-bbaf-94005d36eea7',
  '5eacce1f-9679-46f9-af47-ed300e14c38d',
  'cfb2942a-697f-444c-9b7f-4bbc184273ef',
  'public',
  '{"title":"Playroom · Indoor spatial example","subtitle":"A high-fidelity indoor Gaussian-splat scene delivered through Spark 2.1","measurementDisclaimer":"Visual demonstration only. This source reconstruction is not a survey-grade measurement asset. Dataset: Voxel51 Gaussian Splats (Apache-2.0).","splatBudgetMillions":2,"initialCamera":{"position":[3.1404339644832393,0.18188197960280994,-3.563482533678277],"target":[3.0776369997372894,-0.3061370888964205,-2.6929114969444337],"up":[-0.01146267728441226,-0.8718824481262268,-0.4895810491419074],"fovDegrees":58}}',
  '2026-07-26T15:30:00.000Z',
  '00000000-0000-4000-8000-000000000002',
  '2026-07-26T15:30:00.000Z'
);

INSERT OR IGNORE INTO releases (
  id,
  organisation_id,
  project_id,
  version_id,
  web_asset_id,
  access_policy,
  viewer_config_json,
  published_at,
  created_by,
  created_at
) VALUES (
  'ab1ba24f-e8e3-4b76-8bb2-ce06be0f0a28',
  '00000000-0000-4000-8000-000000000001',
  '665229f5-8848-4f78-bbaf-94005d36eea7',
  '5eacce1f-9679-46f9-af47-ed300e14c38d',
  'cfb2942a-697f-444c-9b7f-4bbc184273f0',
  'public',
  '{"title":"Playroom · Indoor spatial example","subtitle":"A high-fidelity indoor Gaussian-splat scene delivered through paged Spark RAD LoD","measurementDisclaimer":"Visual demonstration only. This source reconstruction is not a survey-grade measurement asset. Dataset: Voxel51 Gaussian Splats (Apache-2.0).","splatBudgetMillions":2,"initialCamera":{"position":[3.1404339644832393,0.18188197960280994,-3.563482533678277],"target":[3.0776369997372894,-0.3061370888964205,-2.6929114969444337],"up":[-0.01146267728441226,-0.8718824481262268,-0.4895810491419074],"fovDegrees":58}}',
  '2026-07-27T09:30:00.000Z',
  '00000000-0000-4000-8000-000000000002',
  '2026-07-27T09:30:00.000Z'
);

INSERT OR IGNORE INTO release_channels (
  id,
  organisation_id,
  project_id,
  slug,
  active_release_id,
  created_at,
  updated_at
) VALUES (
  'c6dc6de7-c110-4309-a85d-1939fd2db923',
  '00000000-0000-4000-8000-000000000001',
  '665229f5-8848-4f78-bbaf-94005d36eea7',
  'playroom',
  'ab1ba24f-e8e3-4b76-8bb2-ce06be0f0a27',
  '2026-07-26T15:30:00.000Z',
  '2026-07-26T15:30:00.000Z'
);

UPDATE release_channels
SET active_release_id = 'ab1ba24f-e8e3-4b76-8bb2-ce06be0f0a28',
    updated_at = '2026-07-27T09:30:00.000Z'
WHERE organisation_id = '00000000-0000-4000-8000-000000000001'
  AND slug = 'playroom';

UPDATE scene_versions
SET source_provenance_json = '{"sourceType":"public-example","dataset":"Voxel51/gaussian_splatting","scene":"playroom","sourceUrl":"https://huggingface.co/datasets/Voxel51/gaussian_splatting/resolve/main/FO_dataset/playroom/point_cloud/iteration_30000/point_cloud.ply","referenceImageUrl":"https://huggingface.co/datasets/Voxel51/gaussian_splatting/resolve/main/FO_dataset/playroom/DSC05572.jpg","license":"Apache-2.0","sourceSha256":"c6fddedf6c7b412d078bbbaa1826e7a1b258f75f862c5190dc50a646243d7d9e","retrievedAt":"2026-07-26T12:00:00.000Z","derivatives":[{"format":"spz","tool":"Spark transcodeSpz 2.1.0","maxSh":3,"sha256":"8245dea36a48923dd57847ee9df99a941b366999e9e581c7a773497bd70f691f"},{"format":"rad","tool":"Spark build-lod 2.1.0","method":"quality","maxSh":3,"sha256":"97165a5eab5e4dd3c7f29b71a3c3dad7505660328fcaa7751e71e5626aa64269"}]}',
    updated_at = '2026-07-27T09:30:00.000Z'
WHERE id = '5eacce1f-9679-46f9-af47-ed300e14c38d';

INSERT OR IGNORE INTO scene_entities (
  id,
  organisation_id,
  project_id,
  version_id,
  parent_id,
  kind,
  label,
  description,
  position_json,
  geometry_json,
  metadata_json,
  sort_order,
  status,
  client_operation_id,
  created_by,
  created_at,
  updated_at
) VALUES
(
  'd886c48a-61ad-4d08-a86c-bd3510332048',
  '00000000-0000-4000-8000-000000000001',
  '665229f5-8848-4f78-bbaf-94005d36eea7',
  '5eacce1f-9679-46f9-af47-ed300e14c38d',
  NULL,
  'floor',
  'Ground floor',
  'The public playroom demonstration floor.',
  '[0,0,0]',
  NULL,
  '{"source":"curated-example"}',
  0,
  'active',
  'seed-playroom-floor',
  '00000000-0000-4000-8000-000000000002',
  '2026-07-27T08:00:00.000Z',
  '2026-07-27T08:00:00.000Z'
),
(
  'f8ee70c3-65a8-4ea2-ad4d-4641160d029d',
  '00000000-0000-4000-8000-000000000001',
  '665229f5-8848-4f78-bbaf-94005d36eea7',
  '5eacce1f-9679-46f9-af47-ed300e14c38d',
  'd886c48a-61ad-4d08-a86c-bd3510332048',
  'room',
  'Main play area',
  'Authored walkable region used by the collision and navigation runtime.',
  '[0,1.5,0]',
  '{"type":"box","points":[[-3,0,-4],[3,3,4]]}',
  '{"source":"curated-example","measurementStatus":"visual-only"}',
  10,
  'active',
  'seed-playroom-room',
  '00000000-0000-4000-8000-000000000002',
  '2026-07-27T08:00:00.000Z',
  '2026-07-27T08:00:00.000Z'
),
(
  '9ba102cf-e347-478d-984d-3aa07ef7f9d0',
  '00000000-0000-4000-8000-000000000001',
  '665229f5-8848-4f78-bbaf-94005d36eea7',
  '5eacce1f-9679-46f9-af47-ed300e14c38d',
  'f8ee70c3-65a8-4ea2-ad4d-4641160d029d',
  'poi',
  'Play table',
  'A visual landmark in the licensed indoor sample.',
  '[0.2,0.7,-0.6]',
  NULL,
  '{"source":"curated-example"}',
  20,
  'active',
  'seed-playroom-poi',
  '00000000-0000-4000-8000-000000000002',
  '2026-07-27T08:00:00.000Z',
  '2026-07-27T08:00:00.000Z'
);

INSERT OR IGNORE INTO scene_routes (
  id,
  organisation_id,
  project_id,
  version_id,
  label,
  description,
  accessibility,
  estimated_seconds,
  status,
  created_by,
  created_at,
  updated_at
) VALUES (
  '81bc58a9-53a9-465a-88d4-e9108ce2e7fe',
  '00000000-0000-4000-8000-000000000001',
  '665229f5-8848-4f78-bbaf-94005d36eea7',
  '5eacce1f-9679-46f9-af47-ed300e14c38d',
  'Quick indoor tour',
  'A short guided route through the main play area.',
  'standard',
  45,
  'active',
  '00000000-0000-4000-8000-000000000002',
  '2026-07-27T08:00:00.000Z',
  '2026-07-27T08:00:00.000Z'
);

INSERT OR IGNORE INTO scene_route_stops (
  route_id,
  entity_id,
  sequence_number,
  camera_pose_json,
  narration
) VALUES
(
  '81bc58a9-53a9-465a-88d4-e9108ce2e7fe',
  'f8ee70c3-65a8-4ea2-ad4d-4641160d029d',
  0,
  NULL,
  'Begin in the main play area.'
),
(
  '81bc58a9-53a9-465a-88d4-e9108ce2e7fe',
  '9ba102cf-e347-478d-984d-3aa07ef7f9d0',
  1,
  NULL,
  'Continue to the play table landmark.'
);

INSERT OR IGNORE INTO project_delivery_policies (
  project_id,
  organisation_id,
  adaptive_quality,
  mobile_lite_budget,
  mobile_standard_budget,
  desktop_standard_budget,
  desktop_high_budget,
  max_initial_bytes,
  updated_by,
  updated_at
) VALUES (
  '665229f5-8848-4f78-bbaf-94005d36eea7',
  '00000000-0000-4000-8000-000000000001',
  1,
  0.75,
  1.25,
  2.0,
  4.0,
  15728640,
  '00000000-0000-4000-8000-000000000002',
  '2026-07-27T08:00:00.000Z'
);

INSERT OR IGNORE INTO audit_events (
  id,
  organisation_id,
  actor_user_id,
  action,
  resource_type,
  resource_id,
  request_id,
  metadata_json,
  created_at
) VALUES (
  '9a48aa4e-36bf-4c92-8a90-6c2ff559c9b5',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'example.release.seeded',
  'release',
  'ab1ba24f-e8e3-4b76-8bb2-ce06be0f0a27',
  'seed-example-playroom',
  '{"slug":"playroom","source":"Voxel51/gaussian_splatting","license":"Apache-2.0"}',
  '2026-07-26T15:30:00.000Z'
);
