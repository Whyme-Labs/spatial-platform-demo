ALTER TABLE releases ADD COLUMN release_number INTEGER;

UPDATE releases
SET release_number = (
  SELECT COUNT(*)
  FROM releases AS prior
  WHERE prior.project_id = releases.project_id
    AND (
      prior.published_at < releases.published_at
      OR (prior.published_at = releases.published_at AND prior.id <= releases.id)
    )
);

CREATE UNIQUE INDEX releases_project_number_idx
  ON releases(project_id, release_number)
  WHERE release_number IS NOT NULL;
