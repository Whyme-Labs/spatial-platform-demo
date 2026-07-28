INSERT OR IGNORE INTO projects
  (id, organisation_id, name, slug, status, capture_adapter, delivery_template, notes, created_by)
VALUES
  (
    '33333333-3333-4333-8333-333333333311',
    '11111111-1111-4111-8111-111111111111',
    'Processor failure recovery fixture',
    'staging-processor-failure-fixture',
    'INGESTED',
    'open-import',
    'internal-processor-validation',
    'Deliberately invalid Gaussian PLY used to verify classified failure and operator recovery.',
    '22222222-2222-4222-8222-222222222222'
  );

INSERT OR IGNORE INTO scene_versions
  (id, project_id, version_number, status, source_provenance_json, created_by)
VALUES
  (
    '33333333-3333-4333-8333-333333333312',
    '33333333-3333-4333-8333-333333333311',
    1,
    'INGESTED',
    '{"sourceType":"test-fixture","purpose":"processing failure classification","expectedFailure":"input_validation"}',
    '22222222-2222-4222-8222-222222222222'
  );

INSERT OR IGNORE INTO assets
  (id, organisation_id, project_id, version_id, kind, format, object_key, file_name, mime_type, size_bytes, sha256, integrity_status)
VALUES
  (
    '33333333-3333-4333-8333-333333333313',
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333311',
    '33333333-3333-4333-8333-333333333312',
    'source',
    'ply',
    'raw-private/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333311/33333333-3333-4333-8333-333333333312/33333333-3333-4333-8333-333333333313/invalid-gaussian.ply',
    'invalid-gaussian.ply',
    'application/octet-stream',
    106,
    'bfb923d2c48bd8c8103813a66b52b03c582a609cab6e986db4c794891ec99f24',
    'pending'
  );

INSERT OR IGNORE INTO processing_jobs
  (id, organisation_id, project_id, version_id, input_asset_id, job_type, processor_version, idempotency_key, state)
VALUES
  (
    '33333333-3333-4333-8333-333333333314',
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333311',
    '33333333-3333-4333-8333-333333333312',
    '33333333-3333-4333-8333-333333333313',
    'asset.validate',
    'spatial-processor/0.1.0',
    'staging-spark-processor-failure:v1',
    'QUEUED'
  );
