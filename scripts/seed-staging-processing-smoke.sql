INSERT OR IGNORE INTO projects
  (id, organisation_id, name, slug, status, capture_adapter, delivery_template, notes, created_by)
VALUES
  (
    '33333333-3333-4333-8333-333333333301',
    '11111111-1111-4111-8111-111111111111',
    'Spark processor staging smoke',
    'staging-spark-processor-smoke',
    'INGESTED',
    'open-import',
    'internal-processor-validation',
    'Licensed AWS laundry-room Gaussian splat used to validate the pinned Spark 2.1 processing lane.',
    '22222222-2222-4222-8222-222222222222'
  );

INSERT OR IGNORE INTO scene_versions
  (id, project_id, version_number, status, source_provenance_json, created_by)
VALUES
  (
    '33333333-3333-4333-8333-333333333302',
    '33333333-3333-4333-8333-333333333301',
    1,
    'INGESTED',
    '{"sourceType":"public-example","dataset":"AWS Guidance for Open Source 3D Reconstruction Toolbox for Gaussian Splats","scene":"laundry room","sourceUrl":"https://github.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/blob/73133959c04fb0f9f002e95b4d2a722de2d18722/source/Gradio/favorites/laundry%20room.sog","license":"MIT-0","retrievedAt":"2026-07-26T14:52:00.000Z","derivative":{"format":"spz","tool":"Spark 2.1.0","sha256":"5750f6a0e88c9657fbbb04f431c439f1c396244fe67e4bde84c05ec5f3160623"}}',
    '22222222-2222-4222-8222-222222222222'
  );

INSERT OR IGNORE INTO assets
  (id, organisation_id, project_id, version_id, kind, format, object_key, file_name, mime_type, size_bytes, sha256, integrity_status)
VALUES
  (
    '33333333-3333-4333-8333-333333333303',
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333302',
    'source',
    'spz',
    'raw-private/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333301/33333333-3333-4333-8333-333333333302/33333333-3333-4333-8333-333333333303/laundry-room.spz',
    'laundry-room.spz',
    'application/octet-stream',
    3771733,
    '5750f6a0e88c9657fbbb04f431c439f1c396244fe67e4bde84c05ec5f3160623',
    'pending'
  );

INSERT OR IGNORE INTO processing_jobs
  (id, organisation_id, project_id, version_id, input_asset_id, job_type, processor_version, idempotency_key, state)
VALUES
  (
    '33333333-3333-4333-8333-333333333304',
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333301',
    '33333333-3333-4333-8333-333333333302',
    '33333333-3333-4333-8333-333333333303',
    'asset.validate',
    'spatial-processor/0.1.0',
    'staging-spark-processor-smoke:v1',
    'QUEUED'
  );
