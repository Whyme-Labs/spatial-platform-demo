CREATE TABLE enterprise_identity_providers (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  email_domains_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'disabled')),
  discovery_json TEXT,
  discovery_checked_at TEXT,
  last_error TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, issuer)
);

CREATE INDEX enterprise_identity_provider_domain_idx
  ON enterprise_identity_providers(organisation_id, status);

CREATE TABLE oidc_login_attempts (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES enterprise_identity_providers(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE,
  nonce_hash TEXT NOT NULL,
  nonce_ciphertext TEXT NOT NULL,
  code_verifier_ciphertext TEXT NOT NULL,
  requested_email_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX oidc_login_attempt_expiry_idx
  ON oidc_login_attempts(expires_at, consumed_at);

CREATE TABLE enterprise_identity_links (
  provider_id TEXT NOT NULL REFERENCES enterprise_identity_providers(id),
  subject TEXT NOT NULL,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  email_at_link TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider_id, subject),
  UNIQUE (provider_id, user_id)
);

CREATE INDEX enterprise_identity_link_user_idx
  ON enterprise_identity_links(organisation_id, user_id);

ALTER TABLE auth_sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'email_otp'
  CHECK (auth_method IN ('email_otp', 'oidc'));
ALTER TABLE auth_sessions ADD COLUMN identity_provider_id TEXT
  REFERENCES enterprise_identity_providers(id);

CREATE INDEX auth_sessions_identity_provider_idx
  ON auth_sessions(identity_provider_id, revoked_at);
