-- A manual navigation approval that resolves final-only capture crossings
-- freezes those per-finding classifications with the build it approved, so
-- the review evidence names exactly which disputed walls the operator
-- affirmed and why — a generic approval note is never an implicit override.
ALTER TABLE scene_navigation_builds ADD COLUMN final_capture_agreement_json TEXT;
