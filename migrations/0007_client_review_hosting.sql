CREATE TABLE project_invitations (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer_reviewer', 'customer_readonly')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by TEXT NOT NULL REFERENCES users(id),
  invited_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  accepted_by TEXT REFERENCES users(id),
  accepted_at TEXT,
  revoked_at TEXT,
  client_operation_id TEXT,
  UNIQUE (organisation_id, client_operation_id)
);
CREATE INDEX project_invitations_project_idx
  ON project_invitations(project_id, invited_at DESC);
CREATE INDEX project_invitations_email_idx
  ON project_invitations(organisation_id, email, status);

CREATE TABLE project_access (
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('customer_reviewer', 'customer_readonly')),
  invited_by TEXT NOT NULL REFERENCES users(id),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_access_user_idx
  ON project_access(organisation_id, user_id, revoked_at);

CREATE TABLE review_comments (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  author_user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'redaction')),
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
  body TEXT NOT NULL,
  camera_pose_json TEXT NOT NULL,
  anchor_json TEXT,
  client_operation_id TEXT,
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);
CREATE INDEX review_comments_version_idx
  ON review_comments(version_id, created_at DESC);

CREATE TABLE version_review_decisions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_id TEXT NOT NULL REFERENCES scene_versions(id),
  reviewer_user_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX review_decisions_version_idx
  ON version_review_decisions(version_id, created_at DESC);

CREATE TABLE project_themes (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  brand_name TEXT,
  logo_url TEXT,
  accent_color TEXT NOT NULL DEFAULT '#d6ff4b',
  surface_color TEXT NOT NULL DEFAULT '#0d0f0e',
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE custom_domains (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  hostname TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'failed', 'removed')),
  verification_token_hash TEXT NOT NULL,
  last_error TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  removed_at TEXT
);

CREATE TABLE hosting_plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_price_cents INTEGER NOT NULL CHECK (monthly_price_cents >= 0),
  included_storage_bytes INTEGER NOT NULL CHECK (included_storage_bytes >= 0),
  included_delivery_bytes INTEGER NOT NULL CHECK (included_delivery_bytes >= 0),
  retention_days INTEGER NOT NULL CHECK (retention_days >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

INSERT INTO hosting_plans
  (code, name, monthly_price_cents, included_storage_bytes, included_delivery_bytes, retention_days)
VALUES
  ('listing', 'Listing', 4900, 10737418240, 107374182400, 365),
  ('portfolio', 'Portfolio', 19900, 107374182400, 1073741824000, 730),
  ('venue', 'Venue', 49900, 536870912000, 5368709120000, 1095),
  ('enterprise', 'Enterprise private', 0, 0, 0, 2555);

CREATE TABLE project_hosting_subscriptions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  plan_code TEXT NOT NULL REFERENCES hosting_plans(code),
  status TEXT NOT NULL CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  renews_automatically INTEGER NOT NULL DEFAULT 0 CHECK (renews_automatically IN (0, 1)),
  archive_on_expiry INTEGER NOT NULL DEFAULT 1 CHECK (archive_on_expiry IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX project_subscriptions_project_idx
  ON project_hosting_subscriptions(project_id, current_period_end DESC);

CREATE TABLE project_retention_policies (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  raw_retention_days INTEGER NOT NULL CHECK (raw_retention_days BETWEEN 0 AND 3650),
  derivative_retention_days INTEGER NOT NULL CHECK (derivative_retention_days BETWEEN 1 AND 3650),
  release_retention_days INTEGER NOT NULL CHECK (release_retention_days BETWEEN 1 AND 3650),
  delete_after TEXT,
  legal_hold INTEGER NOT NULL DEFAULT 0 CHECK (legal_hold IN (0, 1)),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE billing_invoices (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  subscription_id TEXT NOT NULL REFERENCES project_hosting_subscriptions(id),
  status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'void')),
  currency TEXT NOT NULL DEFAULT 'MYR',
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  due_at TEXT NOT NULL,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX billing_invoices_org_idx
  ON billing_invoices(organisation_id, created_at DESC);

CREATE TABLE hosting_usage_monthly (
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  period_month TEXT NOT NULL,
  storage_bytes INTEGER NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0),
  delivery_bytes INTEGER NOT NULL DEFAULT 0 CHECK (delivery_bytes >= 0),
  viewer_sessions INTEGER NOT NULL DEFAULT 0 CHECK (viewer_sessions >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, period_month)
);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT REFERENCES projects(id),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'operational_log')),
  template TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
