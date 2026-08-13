PRAGMA foreign_keys = ON;

-- Dispatch attempts must be tracked independently of lease grants:
-- attempt_count only moves when a processor actually leases the job, so a job
-- whose queue dispatches never reach a processor (registry outage, broken
-- image, saturated container instances) used to be re-enqueued forever with
-- attempt_count = 0 and never surfaced on the failure dashboard.
ALTER TABLE processing_jobs
  ADD COLUMN dispatch_count INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_count >= 0);
