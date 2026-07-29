# Security and production-readiness audit

Date: 2026-07-28
Live release re-verified: 2026-07-29

Scope: Spatial Studio Worker, browser clients, processor boundary, D1, R2, KV,
Queues, Send Email, Workers AI, configuration, migrations, and release process.

## Outcome

No known critical or high-severity application vulnerability remains in the
reviewed release candidate. The production payment surface is manual,
administrator-only, idempotent, audited, and fail-closed. Stripe remains
unconfigured and is not exposed by the production UI.

This is an engineering security review, not a penetration test, compliance
certification, or legal opinion.

## Controls verified

### Identity and session security

- Email OTP challenges are hashed with a secret pepper, expire after ten
  minutes, have a five-attempt cap, and are atomically consumed.
- Email and IP request/verification limits are authoritative in D1. KV provides
  resend suppression only and never grants authentication.
- Access JWTs use ES256/P-256 with `kid`, issuer, audience, subject, session,
  role, `jti`, issued/not-before/expiry validation, a five-minute default TTL,
  and a public-only JWKS endpoint.
- Every authenticated request rechecks the non-revoked D1 session and active
  membership; a JWT alone is insufficient after revocation or role change.
- Refresh tokens are 48-byte opaque secrets stored as peppered hashes. Rotation
  uses compare-and-set state; reuse of a prior token revokes the session.
- Access and refresh cookies are `HttpOnly`, `Secure`, and `SameSite=Strict`.
  The refresh cookie is path-limited to `/api/auth`.
- The documented key-ring procedure supports active/verify overlap and bounded
  retirement. Production deployment now declares every mandatory auth/worker
  secret so Wrangler can fail early on missing credentials.

### Authorization and tenancy

- Human mutations require authentication, tenant-scoped lookup, and
  same-origin browser checks; worker and capture-agent paths use separate
  scoped bearer credentials.
- Platform-admin, production-operator, reviewer, and read-only boundaries have
  explicit contract tests. Manual billing adds a production-operator denial
  test.
- D1 object lookups include organisation/project scope rather than trusting
  route IDs or JWT tenant claims alone.
- Raw/master assets remain private in R2. Browser delivery uses short-lived,
  scoped scene/comparison sessions and range-capable Worker endpoints.
- Vendor-neutral floorplan extraction accepts only checksum-verified metric
  point-cloud assets. Gaussian masters are rejected, proposal reports are
  immutable in R2, and D1 retains the extraction, review, evidence, revision,
  and export lifecycle.

### Manual merchant billing

- Only `platform_admin` may issue an invoice or change billing state.
- Invoice issue, paid/void, and subscription transitions use stable client
  operation IDs and request hashes; conflicting reuse is rejected.
- An issued/open invoice creates a `past_due` subscription and no active
  entitlement.
- Paid transition requires a merchant payment reference and uses a guarded D1
  batch. Paid invoices cannot later be voided.
- Past-due/cancelled/expired subscription transitions require an operator note
  and cannot reactivate service.
- Every operation is present in both the billing-operation ledger and the
  general audit ledger.

### Browser and request security

- Production responses include HSTS, CSP, `nosniff`, strict referrer policy,
  permissions policy, frame protection, COOP, and CORP.
- Static application entry points and assets run through the Worker before the
  Assets binding. Live probes and a direct-entry regression test verify that
  `/studio.html` and `/images/*` cannot bypass request IDs or security headers.
- The production application disables both its `workers.dev` route and preview
  URLs, leaving `https://spatial.whymelabs.com` as its only public application
  origin. A release-gate configuration audit prevents accidental re-enablement.
- CSP denies objects, external form actions, foreign frames, and foreign base
  URLs. The only script exception is WebAssembly evaluation required by the
  bundled Spark runtime plus Cloudflare analytics.
- Auth/session and private asset responses are `no-store` or private; immutable
  delivery assets use bounded signed access.
- JSON request bodies are bounded. Upload size/type/purpose rules and multipart
  ETag/byte reconciliation are server authoritative.
- Floorplan completion fails closed on an immutable-input mismatch, unsupported
  source format, coordinate-assurance mismatch, unbounded sample request,
  inconsistent submitted/stored report, or output hash mismatch. Concurrent
  review/export requests converge on unique revisions and export objects.
- The shared `runAction` single-flight layer disables all conflicting controls,
  sets `aria-busy`, preserves form data, restores state after failure, and
  surfaces retryable errors. Static action-state and rendered-control audits
  cover the full client surface, including OTP and manual billing.

### Operations and recovery

- D1 Time Travel returned a current production restore bookmark. Cloudflare
  documents point-in-time recovery for any minute within the plan retention
  window.
- Lifecycle enforcement now deletes bounded batches of OTP challenges older
  than seven days, rate-limit windows older than two days, and refresh-token
  history older than 31 days only after its session is revoked/expired.
  Security/audit events are retained.
- R2 currently has no bucket-lock rule. This is deliberate until protected
  prefixes and durations are approved: bucket locks prevent overwrite/deletion
  and take precedence over lifecycle deletion, so a broad rule would break the
  platform's customer retention/deletion contract.
- Queue consumers have bounded retries and dead-letter queues. Privacy
  inference now has an additional bounded three-attempt in-call retry before
  queue-level retry after an open-corpus run exposed a transient Workers AI
  `8008` failure.
- Worker and Container deployments have isolated staging/production bindings,
  generated binding types, observability, and dry-run gates.

## Verification evidence

- `npm audit --audit-level=low`: 0 vulnerabilities.
- `npm run check`: types, strict TypeScript, action audit, control audit,
  production-configuration audit, production build, 25 Worker/domain suites,
  and production dry-run.
- The final release gate passed all 110 tests across 25 files, including
  floorplan source/hash/report tampering, sampling bounds, cancellation/retry,
  concurrent review/export, direct static-entry headers, privacy retry,
  manual-billing, retention, authorization, and replay cases.
- Control audit: 125 static buttons, 98 dynamic buttons, 18 static links,
  eight dynamic links, and 34 forms.
- Open corpus: 13 pinned upstream fixtures verified; the final 15-lane,
  28-assertion end-to-end run passed metric floorplan extraction, review,
  hash-verified SVG/PDF/DXF export, and a real Spark scene in Chrome with no
  page, console, or failed-response errors. Its machine-readable report is
  `.cache/open-corpus/reports/worker-e2e-2026-07-28T17-30-07-499Z-c703a878.json`.
- The pinned processor image read PLY, E57, LAS, LAZ, and PTS through its
  production PDAL 2.9.2 environment.
- Main Worker and processor-Container production dry-runs passed.
- Staging migration/deployment, health, JWKS, session, direct static-entry
  security headers, and D1 billing/floorplan-schema smoke passed before
  production promotion.
- Production migration, health, public scene, JWKS, HSTS/CSP, anonymous billing
  and floorplan denial, static-entry header, and APAC D1 schema smoke passed.
- Final application releases
  `c70c026c-3221-4593-b489-a811e09edeae` (staging) and
  `d5387683-c72c-4a75-b751-c3fc61f0468a` (production), plus processor releases
  `117312e4-f252-4128-b8e3-98d07b743b19` (staging) and
  `0e7d2031-9e2c-4600-9d76-2e82fc7d9240` (production), are active.
  Production processor health reports `spatial-processor/0.7.0`,
  `Spark 2.1.0`, and `cloudflare-container`.

## Open operational decisions

### Turnstile on OTP request

Severity: medium hardening, not a current authentication bypass.

D1/KV rate limits and the generic OTP response constrain abuse, but a public
OTP endpoint can still consume email/compute resources under distributed bot
traffic. Add Cloudflare Turnstile before broad public acquisition. This
requires a `spatial.whymelabs.com` widget sitekey and secret. Validate the token
server-side before challenge creation and retain D1 rate limits as the
authoritative fallback.

Official guide:
<https://developers.cloudflare.com/turnstile/tutorials/login-pages/>

### D1 recovery exercise

Severity: medium operations.

Time Travel capability is verified, but this review did not restore the live
production database because restore changes authoritative state. Schedule a
staging clone/restore exercise, document RTO/RPO and application reconciliation,
then repeat on an approved production incident simulation.

Official overview: <https://developers.cloudflare.com/d1/>

### R2 immutable-evidence locks

Severity: policy decision.

Do not lock the entire bucket. First define whether a dedicated evidence prefix
must be immutable, how that interacts with privacy deletion and contractual
retention, and how lifecycle errors are surfaced. Apply a prefix-scoped,
time-bounded rule only after that policy is accepted.

Official guide: <https://developers.cloudflare.com/r2/buckets/bucket-locks/>

### External acceptance

These are not hidden application defects, but they remain necessary before
their respective claims:

- real K1/P2 capture/export projects and commercial rights;
- a real enterprise IdP acceptance cycle;
- one customer-controlled Cloudflare for SaaS hostname;
- uptime paging destination and provider recovery drill;
- paid measurement briefs and qualified sign-off before accuracy/CAD claims.

## Dependency posture

The installed graph has no reported vulnerability. `three` and its types remain
pinned at `0.180.0` because Spark 2.1 documents that integration line; upgrading
to `0.185.x` requires renderer regression testing. TypeScript 7 and Node 26
types are major-version upgrades and are not production hotfixes.

The Spark renderer is isolated to its renderer entry point but remains a large
client chunk (about 1.9 MiB gzip). This is a performance budget item, not a
security finding; keep measuring first useful frame, memory, and device crash
rate against real scenes.
