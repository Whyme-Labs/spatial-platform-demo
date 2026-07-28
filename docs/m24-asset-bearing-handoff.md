# Milestone 24 — asset-bearing project handoff

## Outcome

An administrator who is active in both organisations can copy one project,
its immutable scene versions, and its verified non-deleted R2 assets into the
destination organisation without changing the source project or transferring
publication, identity, billing, processing, or review authority.

This is a copy workflow, not a move workflow and not disaster recovery.

## Product boundary

The copied project receives a new project ID and slug. Every version and asset
also receives a new ID and R2 object key. Copied versions return to `INGESTED`
and the destination project returns to `INGESTED`; the destination must run its
own processing, QA, review, and publication lifecycle.

Included:

- project metadata, customer metadata, typed custom-field definitions/values
- immutable scene-version provenance and manifest snapshots
- verified, non-deleted R2 assets with a recorded SHA-256
- exact source-to-destination project, version, asset, and object-key mappings
- copy attempts, copied bytes, terminal errors, cancellation, and audit events

Excluded:

- upload sessions and multipart state
- processing jobs and worker leases
- QA reports, approvals, reviewer invitations, and comments
- releases, channels, access tokens, viewer sessions, and telemetry
- capture-agent credentials, team memberships, OIDC configuration, and auth
- themes, domains, subscriptions, invoices, and retention lifecycle authority
- measurement briefs, professional sign-off, and commercial accuracy claims

## Safety and consistency

1. Preview is read-only and accepts exactly one project.
2. The server snapshots project metadata plus every included version and asset,
   returns a SHA-256 snapshot hash, and rejects more than 50 assets or 100 GiB.
3. Commit recomputes the snapshot and rejects changed sources. A stable client
   operation ID and request hash make transport retries safe.
4. The operation pre-allocates destination IDs and object keys but does not
   expose destination project records until every object has copied.
5. One Queue message copies one asset. It streams R2-to-R2 and supplies the
   recorded SHA-256 to `R2Bucket.put`, so R2 rejects changed bytes.
6. A copied item is complete only when destination size and SHA-256 match the
   immutable source record.
7. Duplicate Queue delivery reuses the exact destination key and recognizes an
   already verified object instead of creating another object.
8. Finalization is idempotent and inserts the destination project, versions,
   assets, field mappings, and audit evidence only after every item is copied.
9. Failure retains successful objects and progress. Deliberate retry only
   requeues failed or still-queued items.
10. Cancellation first changes authoritative D1 state, then removes every
    pre-allocated destination object. An in-flight worker rechecks state after
    its write and deletes its output when cancellation won the race.
11. A minute scheduler re-enqueues only queued items from queued/copying
    operations, so a lost producer send is recoverable without reviving a
    terminally failed or cancelled operation. Duplicate delivery remains safe.

## API

- `POST /api/projects/asset-handoffs/preview`
- `POST /api/projects/asset-handoffs`
- `GET /api/projects/asset-handoffs`
- `GET /api/projects/asset-handoffs/:handoffId`
- `POST /api/projects/asset-handoffs/:handoffId/retry`
- `POST /api/projects/asset-handoffs/:handoffId/cancel`

All mutations are same-origin, administrator-only, destination-administrator
checked, tenant-scoped, request-hashed, and audited.

## Acceptance

- preview reports exact version, asset, and byte totals plus exclusions
- changed source metadata or asset inventory invalidates the preview hash
- double commit creates one operation and one mapping set
- cross-tenant source or destination access fails closed
- Queue duplicate delivery is idempotent
- R2 checksum or size mismatch is visible and retryable
- partial failure retains copied progress and queues only incomplete items
- finalization produces new IDs and exact copied bytes but no release/review/job
- cancellation removes copied destination objects and creates no project
- every UI action has pending, disabled, error, retained-input, and retry states
- desktop and 390 × 844 browser QA show no dead controls or overflow

## Release evidence

- migration `0029_asset_bearing_handoffs.sql` is applied to staging and
  production
- all 98 tests across 23 files pass in the serial Cloudflare Workers runtime
  gate; both TypeScript targets, action-state audit, control-wiring audit,
  production build, and deployment dry-run pass
- live staging operation `24242424-0000-4000-8000-000000000001` copied one
  4,760-byte object through scheduled reconciliation and the copy Queue on its
  first attempt; the target project is `INGESTED`, the source remains present,
  and the target has zero jobs, releases, and reviews
- independent source and destination downloads both produced SHA-256
  `657561af5829f87c42c80f9a8586adbc3c29d0702ea5155e6a0dd39dabc1f17f`
- live staging browser QA covers all five actions, duplicate activation,
  bounded safe GET retry, deliberate mutation retry, cancellation, retained
  context, terminal state, background-poll/error isolation, and 390 × 844
  overflow; screenshot:
  `artifacts/qa/m24-asset-handoff-staging.png`
- production release `c5c670a0-dbc3-4144-8c60-accbc80e3535` serves
  `spatial.whymelabs.com` with the portfolio-copy Queue/DLQ, minute
  reconciliation, security headers, health, and anonymous auth boundary
