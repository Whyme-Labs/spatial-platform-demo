-- Staging-only acceptance fixture for Milestone 24.
-- The minute scheduler discovers this queued item and the deployed Queue
-- consumer must stream, checksum-verify, and finalize it. Do not run in prod.

INSERT INTO project_asset_handoffs
  (id, source_organisation_id, target_organisation_id, actor_user_id,
    source_project_id, target_project_id, client_operation_id, request_hash,
    source_snapshot_hash, source_snapshot_json, status, total_versions,
    total_assets, total_bytes)
VALUES (
  '24242424-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  '22222222-2222-4222-8222-222222222222',
  '44444444-4444-4444-8444-444444444400',
  '24242424-0000-4000-8000-000000000002',
  '24242424-0000-4000-8000-000000000007',
  '4cda6e12518d3bb53dbd87cbaf1ce1cd22efc7c30d9ea28d0c0ff4ad91a1108a',
  '89ec86b1e207d805a4923bff4532699cddb72a537893efde63a2d41095cf72a5',
  '{"schemaVersion":1,"sourceOrganisation":{"id":"11111111-1111-4111-8111-111111111111","name":"Spatial Studio QA"},"project":{"id":"44444444-4444-4444-8444-444444444400","name":"Drone evidence staging proof","captureAdapter":"drone-imagery","deliveryTemplate":"operations-twin","notes":"Staging-only evidence validation proof","customerName":null,"customerEmail":null},"fieldDefinitions":[],"customFields":{},"versions":[{"id":"44444444-4444-4444-8444-444444444401","versionNumber":1,"sourceProvenanceJson":"{\"adapter\":\"drone-imagery\",\"stagingProof\":true}","manifestJson":null}],"assets":[{"id":"44444444-4444-4444-8444-444444444402","versionId":"44444444-4444-4444-8444-444444444401","kind":"source","format":"zip","objectKey":"raw-private/11111111-1111-4111-8111-111111111111/44444444-4444-4444-8444-444444444400/44444444-4444-4444-8444-444444444401/44444444-4444-4444-8444-444444444402/aerial-images.zip","fileName":"aerial-images.zip","mimeType":"application/zip","sizeBytes":4760,"sha256":"657561af5829f87c42c80f9a8586adbc3c29d0702ea5155e6a0dd39dabc1f17f","etag":null}]}',
  'queued',
  1,
  1,
  4760
);

INSERT INTO project_asset_handoff_versions
  (id, handoff_id, source_version_id, target_version_id, version_number,
    source_provenance_json, manifest_json)
VALUES (
  '24242424-0000-4000-8000-000000000003',
  '24242424-0000-4000-8000-000000000001',
  '44444444-4444-4444-8444-444444444401',
  '24242424-0000-4000-8000-000000000004',
  1,
  '{"adapter":"drone-imagery","stagingProof":true}',
  NULL
);

INSERT INTO project_asset_handoff_items
  (id, handoff_id, version_mapping_id, source_asset_id, target_asset_id,
    source_object_key, target_object_key, kind, format, file_name, mime_type,
    size_bytes, sha256, source_etag)
VALUES (
  '24242424-0000-4000-8000-000000000005',
  '24242424-0000-4000-8000-000000000001',
  '24242424-0000-4000-8000-000000000003',
  '44444444-4444-4444-8444-444444444402',
  '24242424-0000-4000-8000-000000000006',
  'raw-private/11111111-1111-4111-8111-111111111111/44444444-4444-4444-8444-444444444400/44444444-4444-4444-8444-444444444401/44444444-4444-4444-8444-444444444402/aerial-images.zip',
  '33333333-3333-4333-8333-333333333333/24242424-0000-4000-8000-000000000002/24242424-0000-4000-8000-000000000004/24242424-0000-4000-8000-000000000006/aerial-images.zip',
  'source',
  'zip',
  'aerial-images.zip',
  'application/zip',
  4760,
  '657561af5829f87c42c80f9a8586adbc3c29d0702ea5155e6a0dd39dabc1f17f',
  NULL
);
