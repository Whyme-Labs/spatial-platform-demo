-- Platform-admin operated billing for bank transfer, cash, and other
-- merchant-recorded collection methods. Entitlements are activated only by an
-- explicit paid transition with a payment reference.

ALTER TABLE billing_invoices ADD COLUMN billing_method TEXT NOT NULL DEFAULT 'provider'
  CHECK (billing_method IN ('provider', 'manual'));
ALTER TABLE billing_invoices ADD COLUMN external_reference TEXT;
ALTER TABLE billing_invoices ADD COLUMN payment_reference TEXT;
ALTER TABLE billing_invoices ADD COLUMN note TEXT;
ALTER TABLE billing_invoices ADD COLUMN issued_by TEXT REFERENCES users(id);
ALTER TABLE billing_invoices ADD COLUMN updated_at TEXT;

UPDATE billing_invoices
SET billing_method = CASE WHEN payment_provider IS NULL THEN 'manual' ELSE 'provider' END,
    updated_at = created_at
WHERE updated_at IS NULL;

ALTER TABLE project_hosting_subscriptions ADD COLUMN billing_note TEXT;

CREATE TABLE billing_manual_operations (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  subscription_id TEXT REFERENCES project_hosting_subscriptions(id),
  invoice_id TEXT REFERENCES billing_invoices(id),
  client_operation_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN (
    'issue_invoice',
    'mark_paid',
    'void_invoice',
    'mark_past_due',
    'cancel_subscription',
    'expire_subscription'
  )),
  request_hash TEXT NOT NULL,
  payment_reference TEXT,
  note TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, client_operation_id)
);

CREATE INDEX billing_manual_operations_invoice_idx
  ON billing_manual_operations(invoice_id, created_at DESC);
CREATE INDEX billing_manual_operations_subscription_idx
  ON billing_manual_operations(subscription_id, created_at DESC);
CREATE INDEX billing_invoices_manual_status_idx
  ON billing_invoices(organisation_id, billing_method, status, due_at);
