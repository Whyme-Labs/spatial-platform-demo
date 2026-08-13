PRAGMA foreign_keys = ON;

-- Expand the historical processor_version field into its two actual concepts.
-- The old column remains populated throughout the rollback window; current
-- Workers read contract_version and never overwrite it at completion time.
ALTER TABLE processing_jobs ADD COLUMN contract_version TEXT;
ALTER TABLE processing_jobs ADD COLUMN leased_processor_identity_json TEXT;
ALTER TABLE processing_jobs ADD COLUMN processor_identity_json TEXT;

UPDATE processing_jobs
SET contract_version = processor_version
WHERE contract_version IS NULL;

CREATE INDEX processing_jobs_compatible_lease_idx
  ON processing_jobs(state, job_type, contract_version, priority, created_at);
