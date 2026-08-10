PRAGMA foreign_keys = ON;

-- Canonicalise every delivery-template identifier previously accepted by the
-- application. The current and frozen rollback Workers both accept the
-- canonical display values, so this data repair remains rollback-compatible.
UPDATE projects
SET delivery_template = CASE delivery_template
  WHEN 'indoor-experience' THEN 'Property showcase'
  WHEN 'property-tour' THEN 'Property showcase'
  WHEN 'venue-navigator' THEN 'Venue navigator'
  WHEN 'operations-twin' THEN 'Measured capture pack'
  WHEN 'measured-floor-plan' THEN 'Measured capture pack'
END
WHERE delivery_template IN (
  'indoor-experience',
  'property-tour',
  'venue-navigator',
  'operations-twin',
  'measured-floor-plan'
);

UPDATE project_templates
SET delivery_template = CASE delivery_template
  WHEN 'indoor-experience' THEN 'Property showcase'
  WHEN 'property-tour' THEN 'Property showcase'
  WHEN 'venue-navigator' THEN 'Venue navigator'
  WHEN 'operations-twin' THEN 'Measured capture pack'
  WHEN 'measured-floor-plan' THEN 'Measured capture pack'
END
WHERE delivery_template IN (
  'indoor-experience',
  'property-tour',
  'venue-navigator',
  'operations-twin',
  'measured-floor-plan'
);
