CREATE TABLE billing_checkout_sessions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  plan_code TEXT NOT NULL REFERENCES hosting_plans(code),
  status TEXT NOT NULL CHECK (status IN ('pending', 'open', 'complete', 'expired', 'failed', 'cancelled')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'MYR',
  customer_email TEXT NOT NULL,
  archive_on_expiry INTEGER NOT NULL DEFAULT 1 CHECK (archive_on_expiry IN (0, 1)),
  payment_provider TEXT NOT NULL DEFAULT 'stripe',
  provider_checkout_id TEXT,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  checkout_url TEXT,
  payment_status TEXT,
  request_hash TEXT NOT NULL,
  client_operation_id TEXT NOT NULL,
  last_error TEXT,
  expires_at TEXT,
  completed_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE UNIQUE INDEX billing_checkout_provider_idx
  ON billing_checkout_sessions(payment_provider, provider_checkout_id)
  WHERE provider_checkout_id IS NOT NULL;
CREATE INDEX billing_checkout_project_idx
  ON billing_checkout_sessions(project_id, created_at DESC);

CREATE TABLE billing_provider_events (
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  provider_created_at TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('processing', 'processed', 'ignored', 'failed')),
  error_message TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  PRIMARY KEY (provider, provider_event_id)
);

ALTER TABLE project_hosting_subscriptions ADD COLUMN payment_provider TEXT;
ALTER TABLE project_hosting_subscriptions ADD COLUMN provider_subscription_id TEXT;
ALTER TABLE project_hosting_subscriptions ADD COLUMN provider_customer_id TEXT;
ALTER TABLE project_hosting_subscriptions ADD COLUMN activated_at TEXT;
ALTER TABLE project_hosting_subscriptions ADD COLUMN provider_cancel_at_period_end INTEGER NOT NULL DEFAULT 0
  CHECK (provider_cancel_at_period_end IN (0, 1));

CREATE UNIQUE INDEX hosting_subscription_provider_idx
  ON project_hosting_subscriptions(payment_provider, provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

ALTER TABLE billing_invoices ADD COLUMN payment_provider TEXT;
ALTER TABLE billing_invoices ADD COLUMN provider_invoice_id TEXT;
ALTER TABLE billing_invoices ADD COLUMN provider_payment_intent_id TEXT;
ALTER TABLE billing_invoices ADD COLUMN provider_event_id TEXT;

CREATE UNIQUE INDEX billing_invoice_provider_idx
  ON billing_invoices(payment_provider, provider_invoice_id)
  WHERE provider_invoice_id IS NOT NULL;

-- Historical paid-plan subscriptions were activated by an internal record
-- mutation, not provider evidence. Keep the ledger, but remove the paid
-- entitlement claim until a provider-backed collection path resolves it.
UPDATE project_hosting_subscriptions
SET status = 'past_due',
    renews_automatically = 0,
    updated_at = datetime('now')
WHERE status = 'active'
  AND payment_provider IS NULL
  AND EXISTS (
    SELECT 1 FROM hosting_plans hp
    WHERE hp.code = project_hosting_subscriptions.plan_code
      AND hp.monthly_price_cents > 0
  );
