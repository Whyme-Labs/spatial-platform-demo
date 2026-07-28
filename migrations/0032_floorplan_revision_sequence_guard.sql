CREATE UNIQUE INDEX floorplan_revision_sequence_unique
  ON floorplan_revisions(
    organisation_id,
    project_id,
    version_id,
    revision_number
  );
