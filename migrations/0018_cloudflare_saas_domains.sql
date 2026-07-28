ALTER TABLE custom_domains ADD COLUMN dns_verified_at TEXT;
ALTER TABLE custom_domains ADD COLUMN provider TEXT;
ALTER TABLE custom_domains ADD COLUMN provider_hostname_id TEXT;
ALTER TABLE custom_domains ADD COLUMN provider_status TEXT;
ALTER TABLE custom_domains ADD COLUMN provider_ssl_status TEXT;
ALTER TABLE custom_domains ADD COLUMN provider_validation_json TEXT;
ALTER TABLE custom_domains ADD COLUMN provisioning_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE custom_domains ADD COLUMN last_checked_at TEXT;
ALTER TABLE custom_domains ADD COLUMN provisioned_at TEXT;

CREATE UNIQUE INDEX custom_domains_provider_hostname_idx
  ON custom_domains(provider, provider_hostname_id)
  WHERE provider_hostname_id IS NOT NULL;

-- Prior releases used "active" to mean ownership-verified only. That state did
-- not prove Cloudflare routing or certificate readiness, so demote it before
-- the provider lifecycle becomes authoritative.
UPDATE custom_domains
SET status = 'pending',
    dns_verified_at = COALESCE(verified_at, datetime('now')),
    last_error = 'Ownership is verified; Cloudflare for SaaS provisioning is still required'
WHERE status = 'active' AND provider_hostname_id IS NULL;
