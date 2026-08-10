PRAGMA foreign_keys = ON;

-- The deployment canary predates behavior-driving delivery policies and wrote
-- a placeholder that no real project API accepts. Repair only that fixed,
-- synthetic fixture; unknown customer data must continue to fail closed.
UPDATE projects
SET delivery_template = 'Property showcase'
WHERE id = 'caaa0000-0000-4000-8000-000000000002'
  AND organisation_id = 'caaa0000-0000-4000-8000-000000000001'
  AND delivery_template = 'none';
