# Deployment and operations

## Environments

| Environment | Worker / domain | Processor Worker | D1 | R2 | KV | Queues |
|---|---|---|---|---|---|---|
| staging | `spatial-studio-staging` | `spatial-processor-cloud-staging` | `spatial-studio-staging` | `spatial-studio-assets-staging` | `spatial-studio-auth-staging` | `spatial-privacy-scans-staging`; `spatial-processing-dispatch-staging`; `spatial-portfolio-copies-staging` plus DLQs |
| production | `spatial-studio-production` / `spatial.whymelabs.com` | `spatial-processor-cloud-production` | `spatial-studio-production` | `spatial-studio-assets-production` | `spatial-studio-auth-production` | `spatial-privacy-scans-production`; `spatial-processing-dispatch-production`; `spatial-portfolio-copies-production` plus DLQs |

The environments use separate databases, buckets, and secrets in Cloudflare
account `1e0170aaabc90ecf5f466128d1f0466a`.

Production is intentionally served only from
`https://spatial.whymelabs.com`. Its `workers.dev` route and preview URLs are
disabled in `wrangler.jsonc`; `npm run audit:production-config` fails if that
canonical-origin boundary or the staging/production storage separation drifts.

The GitHub `Release gate` workflow runs locked installation, dependency audit,
the full application check, and a processor deployment dry-run for every push
or pull request targeting `main`. Actions are pinned to immutable commit SHAs
and receive read-only repository contents permission. Branch protection is a
separate repository-plan control; do not treat a green workflow as mandatory
review enforcement unless GitHub reports the rule active.

The `Deploy and accept staging` workflow is the provider-native gate after
`Release gate`. It checks out the exact successful `main` SHA, migrates and
deploys both staging Workers, then verifies edge routes, ES256/JWKS boundaries,
the processor Container, remote D1 state, and temporary exact-byte R2/KV
canaries. It emits a redacted acceptance report and fails if canary cleanup
fails. Keep `CLOUDFLARE_STAGING_ENABLED=false` until a manual dispatch passes.

The Vitest Worker runtime sets `remoteBindings: false`. CI therefore needs no
Cloudflare account token and cannot accidentally call production Workers AI or
other remote bindings. Detector retry/normalisation is exercised with local
test doubles; live Workers AI availability remains an explicit staging or
production smoke check, not a unit-test dependency.

Wrangler OAuth can expose several accounts to one operator. The repository's
remote npm scripts therefore set this public account ID explicitly before
invoking Wrangler; use those scripts for migration and deployment. For a
direct Wrangler command, set the same `CLOUDFLARE_ACCOUNT_ID` inline. Do not
rely on interactive account selection in CI.

## Required secrets

- `JWT_KEYRING` — active ES256 private JWK and overlapping verification keys
- `OTP_PEPPER` — hashes one-time email codes
- `REFRESH_TOKEN_PEPPER` — hashes rotating refresh tokens
- `SESSION_PEPPER` — signs short-lived published-scene tokens and lease material
- `WORKER_API_TOKEN` — authenticates processing agents
- `TURNSTILE_SECRET_KEY` — validates single-use OTP request/resend challenges
  through server-side Siteverify; never expose it through client code or logs
- `CLOUDFLARE_SAAS_API_TOKEN` — optional until branded-hostname activation;
  scoped to custom-hostname and certificate operations for the SaaS zone
- `STRIPE_SECRET_KEY` — optional until self-service paid hosting activation;
  restricted Stripe API key used to create Checkout Sessions and request
  subscription cancellation
- `STRIPE_WEBHOOK_SECRET` — endpoint-specific signing secret for exact raw-body
  webhook verification
- `OIDC_CLIENT_SECRETS` — optional until enterprise SSO activation; a JSON
  object whose keys are D1 provider UUIDs and whose values are the corresponding
  OIDC confidential-client secrets

Set or rotate them without committing values:

```bash
npx wrangler secret put JWT_KEYRING --env production
npx wrangler secret put OTP_PEPPER --env production
npx wrangler secret put REFRESH_TOKEN_PEPPER --env production
npx wrangler secret put SESSION_PEPPER --env production
npx wrangler secret put WORKER_API_TOKEN --env production
npx wrangler secret put TURNSTILE_SECRET_KEY --env production
npx wrangler secret put WORKER_API_TOKEN -c wrangler.processor.jsonc --env production
npx wrangler secret put CLOUDFLARE_SAAS_API_TOKEN --env production
npx wrangler secret put STRIPE_SECRET_KEY --env production
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production
npx wrangler secret put OIDC_CLIENT_SECRETS --env production
```

The staging deployment workflow additionally requires:

- repository variable `CLOUDFLARE_ACCOUNT_ID`;
- repository variable `CLOUDFLARE_STAGING_ENABLED`, initially `false`;
- GitHub `staging` environment secret `CLOUDFLARE_API_TOKEN`.

Create a dedicated Cloudflare API token scoped only to this account and the
staging Worker/Container, D1, R2, KV, and Queue deployment or canary operations
used by the workflow. The current Cloudflare permission labels are D1 Write,
Workers Scripts Write, Workers KV Storage Write, Workers R2 Storage Write,
Queues Write, and Containers Write (or their user-token `Edit` equivalents).
Scope every policy to account `1e0170aaabc90ecf5f466128d1f0466a`. Do not place
the operator's Wrangler OAuth credentials or any application secret in GitHub.
After a successful manual dispatch, set `CLOUDFLARE_STAGING_ENABLED=true` to
accept every successful `main` release gate automatically. Manual dispatches
are accepted only from `main`.

See [AUTHENTICATION.md](./AUTHENTICATION.md) for overlapping ES256 rotation.
Rotating `SESSION_PEPPER` invalidates published-scene sessions. Rotate
`WORKER_API_TOKEN` atomically across the application Worker, cloud processor
Worker, and any temporary external processors.

Production uses the public Turnstile sitekey declared in `wrangler.jsonc` for
`spatial.whymelabs.com`; local and staging configuration uses Cloudflare's
documented always-pass test sitekey. Set the corresponding documented test
secret in local `.dev.vars` and staging only. Production must use the real
secret and `npm run audit:production-config` rejects a production test sitekey.
After secret rotation, complete a fresh browser challenge and verify that an
OTP request succeeds before retiring the previous key.

## Enterprise OIDC activation

The deployed OIDC adapter is safely unavailable until an administrator creates
a draft provider and operations stores its client secret. Do not place the
client secret in Wrangler variables, D1, the browser form, source control, or
shell history.

1. Register the identity-provider client as a confidential web application.
2. Create a draft in Team > Configure SSO with its exact issuer, client ID, and
   exact allowed email domains.
3. Copy the generated provider UUID. Register these exact callback URLs with
   the IdP:

   ```text
   https://spatial-studio-staging.swmengappdev.workers.dev/api/auth/oidc/{provider-id}/callback
   https://spatial.whymelabs.com/api/auth/oidc/{provider-id}/callback
   ```

4. Maintain an encrypted operational source file containing every provider
   secret for that environment:

   ```json
   {
     "provider-uuid": "client-secret"
   }
   ```

   Upload the complete map through standard input because a Cloudflare secret
   cannot be read back or patched in place:

   ```bash
   umask 077
   npx wrangler secret put OIDC_CLIENT_SECRETS --env staging \
     < oidc-client-secrets.staging.json
   ```

5. Deploy, return to Team, and activate the provider. Activation must stay
   `draft` if secret lookup or live discovery fails.
6. Exercise an existing invited member through first link, repeat login,
   provider denial, expired/replayed callback, wrong email/domain, and current
   JWKS key rotation.
7. Disable the provider and prove its existing access and refresh credentials
   fail immediately while email OTP remains available.
8. Repeat in production only after staging evidence. Keep the encrypted source
   map and client-secret rotation procedure under operational access control.

Removing a provider key from `OIDC_CLIENT_SECRETS` makes public discovery and
new login unavailable but does not by itself revoke existing sessions. Use the
Studio Disable action first; it records the lifecycle and revokes every session
issued through that provider.

## Cloudflare for SaaS activation

The application ships the provider adapter but intentionally remains
unconfigured until all account-level prerequisites exist. Before enabling
automatic branded hostnames:

1. Enable Cloudflare for SaaS on the production zone.
2. Configure and validate `spatial.whymelabs.com` as the fallback origin.
3. Set `CLOUDFLARE_SAAS_ZONE_ID` in the production Wrangler variables.
4. Create a least-privilege API token with the zone's custom-hostname and
   certificate write/read permissions, then store it with:

   ```bash
   npx wrangler secret put CLOUDFLARE_SAAS_API_TOKEN --env production
   ```

5. Deploy and confirm Studio changes from `Provider setup required` to
   `Provision hostname` only after DNS ownership is verified.
6. On a customer-controlled test hostname, publish the displayed TXT ownership
   record and CNAME to `spatial.whymelabs.com`.
7. Refresh until both Cloudflare hostname and TLS states are `active`; verify
   the hostname opens only its bound project's current release.
8. Remove and recreate the disposable hostname, confirming Cloudflare deletion
   completes and no provider orphan remains.

Do not mark the capability live from TXT verification or a successful create
API response alone. The authoritative acceptance condition is both provider
hostname and SSL status `active`, followed by a real HTTPS request.

## Manual merchant billing

Manual billing is the production payment path. It requires no payment-provider
secret and is intentionally restricted to `platform_admin`.

1. Open **Hosting & billing** and issue an invoice against one exact project,
   plan, amount, currency, service period, due date, and merchant reference.
2. The new subscription remains `past_due`. It does not grant hosting
   entitlement.
3. After independently verifying the bank transfer or other merchant
   collection, record the unique payment reference and optional note, then
   choose **Mark paid**.
4. Only that guarded paid transition activates the linked subscription. Reusing
   the same client operation is idempotent; reusing it with different content
   is rejected.
5. An open invoice may be voided. A paid invoice cannot be voided. Active
   subscriptions may be marked past due, cancelled, or expired with a required
   operator note; inactive states cannot be used to reactivate service.
6. Confirm the invoice, subscription, `billing_manual_operations`, and
   `audit_events` rows agree before treating the collection as reconciled.

The system does not initiate a bank transfer, send a tax invoice, or assert
accounting/tax compliance. The merchant remains responsible for payment
verification, numbering, tax documents, refunds, and charge disputes.

## Stripe billing activation

The application retains a provider adapter but self-service card billing is
deferred and the current production UI does not expose it. If that product line
is enabled later:

1. Create recurring monthly MYR prices for Listing, Portfolio, and Venue.
2. Set `STRIPE_PRICE_LISTING`, `STRIPE_PRICE_PORTFOLIO`, and
   `STRIPE_PRICE_VENUE` to those exact price IDs in the staging Wrangler
   variables. Never use product IDs where price IDs are required.
3. Create a restricted staging/test Stripe key with only the Checkout Session
   and subscription capabilities required by the adapter, then store it as
   `STRIPE_SECRET_KEY`.
4. Register
   `https://spatial-studio-staging.swmengappdev.workers.dev/api/billing/stripe/webhook`
   and subscribe to:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Store that endpoint's signing secret as `STRIPE_WEBHOOK_SECRET`; do not reuse
   the Stripe CLI forwarding secret.
6. Deploy staging. Confirm Checkout opens only once under a repeated client
   operation ID and that the Studio says payment is still being reconciled
   after the success redirect.
7. Confirm no D1 subscription or invoice exists until the signed
   `invoice.paid` event matches the checkout amount, currency, and service
   period.
8. Replay the same webhook and confirm the event ledger reports idempotency.
   Replay its event ID with altered bytes and confirm conflict rejection.
9. Exercise failed payment, successful recovery, checkout expiry,
   cancel-at-period-end, renewal, and terminal subscription deletion.
10. Repeat with live production products/secrets only after staging evidence is
    recorded. Complete one real paid and refunded/cancelled customer lifecycle
    before marking billing `LIVE`.

If any Stripe variable or secret is absent, `/api/hosting` reports the provider
as unconfigured and checkout refuses to create local entitlement records. This
is the expected safe state.

## Processing-agent operations

### Cloudflare Container lane

Create the dispatch Queue/DLQ pairs before deploying either Worker:

```bash
npx wrangler queues create spatial-processing-dispatch-staging
npx wrangler queues create spatial-processing-dispatch-staging-dlq
npx wrangler queues create spatial-processing-dispatch-production
npx wrangler queues create spatial-processing-dispatch-production-dlq
```

The application Worker emits only `{ "jobId": "…" }`. The processor Worker
starts one deterministic Container identity for that job, passes the platform
origin and independent worker bearer secret at runtime, and runs one exact
lease attempt. A minute Cron reconciliation re-emits jobs still queued or whose
lease expired, while D1's atomic lease prevents duplicate execution authority.
That pass stamps `processing_jobs.dispatched_at` when it enqueues and skips rows
dispatched inside a ten-minute backoff window, so a slow job is no longer
re-enqueued every minute; project asset copies use the same stamp. The same pass
dead-letters jobs still `LEASED`/`RUNNING` whose lease expired after
`max_attempts` was exhausted, with failure class `lease_expired`, so a stalled
job appears in the failure dashboard instead of sitting invisible. When
inspecting a stuck job, read `state`, `attempt_count`, `retry_count`,
`dispatched_at`, and `lease_expires_at` together.

Build and validate the linux/amd64 image:

```bash
npm run processor:container:build
npm run processor:cloud:dry-run
```

Deploy staging first, then production:

```bash
npm run processor:cloud:staging
curl --fail https://spatial-processor-cloud-staging.swmengappdev.workers.dev
npm run processor:cloud:production
curl --fail https://spatial-processor-cloud-production.swmengappdev.workers.dev
```

The image contains the Spark 2.1.0 source pinned to commit
`f22236f95fdd8078f0c12e3aab479523d401daf6`, compiles `build-lod` during the
image build, and uses distro Chromium only for the deterministic poster lane.
The configured `standard-3` instance has 8 GiB memory and 16 GB ephemeral disk;
the image sets `NODE_OPTIONS=--max-old-space-size=6144` so a large in-memory
point cloud fails as a classified job error rather than an opaque OOM kill, and
the application still enforces a 1,024 MiB maximum per raw-scene input. This is
a CPU processing lane. Vendor reconstruction or other CUDA work must use an
external GPU adapter while preserving the same exact-job lease contract.

The processor Worker may declare the optional passthrough variables
`PROCESSOR_MAX_POINTCLOUD_INPUT_MIB`, `PROCESSOR_POLL_SECONDS`, and
`PROCESSOR_HEARTBEAT_SECONDS` alongside the required `APP_ORIGIN`,
`PROCESSOR_MAX_CHANGE_INPUT_MIB`, and `PROCESSOR_MAX_JOB_RUNTIME_MINUTES`. Each
optional variable is forwarded into the Container only when it is set, so
removing it from `wrangler.processor.jsonc` restores the agent's own default
instead of injecting an empty string. `wrangler.processor.jsonc` currently
declares all three in the default, staging, and production environments; keep
the three environments' values aligned when tuning one.

The Container `sleepAfter` window is four hours and must stay above the accepted
180-minute `PROCESSOR_MAX_JOB_RUNTIME_MINUTES`. Cloudflare Container activity is
request based: `@cloudflare/containers` renews the activity window on start and
on each fetch, and this dispatch lane starts the entrypoint rather than fetching
it, so the agent's own compute never renews it. For this lane the window is
therefore a wall-clock cap on a running job, not an idle timeout — reducing it
below the accepted job runtime stops a long Spark, PDAL, or Recast job
mid-execution. Instance slots are not the reason the value is large: the
`--once` entrypoint runs one lease attempt and exits, and a Container that has
exited releases its slot without waiting for this window.

Poster generation does not use a fixed sleep. The browser samples the Spark
canvas until two consecutive frames contain enough non-background pixels,
luminance range, and colour diversity. A blank but valid PNG therefore fails
the job instead of becoming release evidence.

### Capture adapter ingestion

The upload contract requires a declared capture purpose and compatible format.
The browser exposes five adapter profiles: XGRIDS LCC, FJD Trion, phone/video,
drone imagery, and open import.

- Gaussian masters (`ply`, `spz`, `sog`, `splat`, `ksplat`, or a supported
  Gaussian ZIP) create the established Spark `asset.validate` job.
- Ready Spark `rad` scenes and non-Gaussian evidence create
  `asset.evidence-validate`.
- Evidence validation verifies the exact R2 bytes and SHA-256 plus a bounded
  file signature or parse boundary. It deliberately produces no derivative and
  leaves the QA report pending human evidence review.
- E57, LAS/LAZ, vendor project containers, imagery, video, poses, calibration,
  IMU/GNSS trajectories, and collision meshes must never be routed to Spark.
- Treat an opaque vendor-container success as an integrity result only. It does
  not prove scanner origin, vendor licence, calibration, export completeness,
  reconstruction quality, or survey accuracy.

The processor health response must report `spatial-processor/0.5.0` or newer
before accepting these evidence jobs. A production validation should inspect
`processing_jobs.job_type`, `assets.kind`, `assets.integrity_status`,
`assets.integrity_source`, and the immutable `qa_reports.report_json` limitation
together.

`assets.integrity_source` records who established the digest:
`server_verified` (the Worker streamed the finished R2 object through
`crypto.DigestStream` at upload completion), `client_declared` (the object
exceeded `SERVER_HASH_MAX_BYTES` so only the uploader's declared hash exists),
`processor_reported` (a processor filled a previously NULL digest), or
`operator_manual` (an operator signed the job off without a digest). Tune
`SERVER_HASH_MAX_BYTES` (default `2147483648`, 2 GiB) per environment: raising
it hashes more uploads in-request at the cost of request duration. The bound was
chosen against the largest pinned vendor master — the FJD P2 Gaussian PLY is
536,812,164 bytes, which the previous 512 MiB bound cleared by only ~57 KB —
and native SHA-256 costs under a second of CPU per 2 GiB, so the dominant cost
is streaming the object from R2 (roughly ten to twenty seconds in-datacentre). A declared hash that
contradicts the server-computed one leaves the asset `integrity_status =
'failed'` with no processing job; investigate the uploader before retrying.

`semantic.extract-v1` is a separate processor lane. It accepts only a verified
source, master, or point-cloud PLY already asserted to use metres in a
registered Y-up project frame. The lease carries bounded grid, floor-band,
minimum-area, candidate-count, sample-count, and optional elevation-hint
parameters. Successful completion must register one immutable JSON report,
exact source byte/hash evidence, and reviewable polygon candidates. It must not
author rooms itself. Confirm `semantic_extraction_runs`,
`semantic_candidates`, the report asset, and the terminal processing job
together; promotion requires an operator accept-selected or reject-all
decision.

The processor Worker receives only `WORKER_API_TOKEN`. It has no D1, R2, KV,
email, JWT, billing, or OIDC binding. Inspect both Queue/DLQ state and
`processing_jobs` when a container start or job run fails.

### Capture transfer agents

Capture-agent bearer tokens are issued and scoped in Team > Capture agent.
They are not Wrangler secrets and must not be shared with the processor lane.
Create one credential per export workstation or supervised transfer process,
assign only the projects it may write, and prefer the shortest practical
expiry. Store the one-time displayed value in that workstation's secret
manager as `SPATIAL_CAPTURE_AGENT_TOKEN`.

Prepare a vendor export as one immutable artifact plus a sibling manifest. V1
accepts exactly one file because one upload creates one immutable scene
version; archive a multi-file vendor directory before declaring it.

```bash
cp examples/capture-transfer-manifest.example.json \
  /capture/inbox/job-001.spatial-capture.json

SPATIAL_API_ORIGIN=https://spatial.whymelabs.com \
SPATIAL_CAPTURE_AGENT_TOKEN=... \
SPATIAL_CAPTURE_INBOX=/capture/inbox \
SPATIAL_CAPTURE_SETTLE_SECONDS=10 \
npm run capture-agent:once
```

For continuous operation, supervise `npm run capture-agent:start`. The process:

1. ignores manifests with an existing completion receipt
2. locks one manifest locally and waits for its artifact to stop changing
3. validates its exact project assignment and adapter through the agent API
4. hashes the manifest and full artifact before initiating the upload
5. stores a deterministic operation ID and atomic checkpoint in
   `.spatial-transfer/`
6. reconciles D1/R2 committed parts and skips them after restart
7. uploads 10 MiB parts with bounded network/429/5xx retry
8. writes a mode-0600 receipt containing exact hashes, bytes, credential
   generation, upload/version/asset IDs, and validation-job evidence
9. leaves source exports untouched

HTTP 4xx contract failures, including project scope, adapter mismatch, archive
state, or conflicting operation reuse, are terminal until an operator corrects
the manifest or credential. Network errors, 408, 425, 429, and 5xx responses
are checkpointed with bounded exponential retry. A restart reuses the same
server operation and remote parts. Rotate a credential by updating the
workstation secret before restarting; revoke it immediately for loss,
decommissioning, or unexpected use. Inspect `capture_agent_credentials`,
`upload_sessions.capture_agent_credential_id`,
`scene_versions.capture_agent_credential_id`, and `capture_agent.upload.*`
audit events during an incident.

This workflow starts after vendor export. Scanner control, live coverage,
vendor-GUI automation, native reconstruction, and proof of vendor licensing
remain outside the credential's authority.

### External/local fallback lane

Install the pinned Spark processor on each registered worker:

```bash
npm ci
npm run processor:setup
```

Run one lease for a smoke test:

```bash
SPATIAL_API_ORIGIN=https://spatial-studio-staging.swmengappdev.workers.dev \
  npm run processor:once
```

Run continuously under the selected process supervisor only when exercising
the provider-neutral external lane:

```bash
SPATIAL_API_ORIGIN=https://spatial.whymelabs.com npm run processor:start
```

Required process environment:

- `WORKER_API_TOKEN`
- `SPATIAL_API_ORIGIN`

Optional controls include `PROCESSOR_WORKER_ID`, `PROCESSOR_JOB_ID`,
`PROCESSOR_POLL_SECONDS`,
`PROCESSOR_HEARTBEAT_SECONDS`, `PROCESSOR_MAX_JOB_RUNTIME_MINUTES`,
`PROCESSOR_MAX_CHANGE_INPUT_MIB`, `PROCESSOR_ACTIVE_HUMAN_MS`,
`PROCESSOR_CHROME_PATH`, and `SPARK_BUILD_LOD_BIN`. The registered-scene lane
defaults to a 1,024 MiB limit for each in-memory PLY input and rejects larger
assets before download. The agent exits cleanly on `SIGINT`/`SIGTERM`, uses
heartbeats during long work, verifies downloaded source hashes, and reports a
classified failure before discarding its temporary workspace.

The platform owns R2 credentials. Agents and Containers receive lease-scoped download and
multipart-upload capabilities through the Worker API. Rotate the platform secret
first, update every supervised worker, verify a lease, and only then retire the
previous worker process.

## Privacy-detection operations

The privacy consumer uses the environment's Workers AI binding and a dedicated
Queue/DLQ pair. Create these once before the first deployment:

```bash
npx wrangler queues create spatial-privacy-scans-staging
npx wrangler queues create spatial-privacy-scans-staging-dlq
npx wrangler queues create spatial-privacy-scans-production
npx wrangler queues create spatial-privacy-scans-production-dlq
```

The producer sends only a scan ID. The consumer reloads the authoritative
tenant-scoped D1 scan and verified private R2 inputs, then records the model,
version, exact hashes/bytes, timing, candidate count, and error evidence. Do not
move image bytes into Queue messages or KV. Queue retries are bounded; inspect
`privacy_scans` for `FAILED`/`DEAD_LETTER` and the Cloudflare DLQ when an
incident persists. Reprocessing is an explicit Studio action.

## Release procedure

```bash
npm ci
npm run check
npm run db:migrate:staging
npm run processor:cloud:staging
npm run deploy:staging
npm run verify:staging

npm run processor:cloud:production
npm run deploy:production
curl --fail https://spatial.whymelabs.com/api/health
```

`npm run deploy:production` applies production D1 migrations before it publishes
the Worker. Do not replace it with a direct `wrangler deploy`: that would let
application code reach production before its schema. D1 migrations are
append-only after production deployment; do not edit an already applied file.
The current release requires `0037_refresh_rotation_replay.sql`,
`0038_recast_navigation_builds.sql`, and
`0039_numeric_release_revisions.sql` in both environments before deploying the
Worker. Migration `0037` preserves refresh-token replay evidence; `0038` stores
the exact v7 navigation build state, tuning, authoring hashes, approved
report/Detour assets, and review evidence used by the publication gate; `0039`
backfills deterministic project-local release revisions and enforces their
uniqueness.
`wrangler deploy` publishes both the Worker and its declared
domain and schedule; verify both the `workers.dev` and branded JWKS after a
signing-key secret change.

`npm run verify:staging:public` is a safe read-only edge check. The full
`npm run verify:staging` command also uses authenticated Wrangler access for a
read-only remote D1 probe and temporary R2/KV canaries. Every canary uses a
unique run ID and is deleted before the command succeeds.

## Post-deploy smoke test

1. Check `/api/health` returns `status: ok` and the intended environment.
2. Open `/studio.html`, request an OTP, and confirm it arrives from
   `login@whymelabs.com`.
3. Confirm dashboard counters load.
4. Create a disposable project in staging.
5. Upload a valid Gaussian PLY or SPZ, run `npm run processor:once`, confirm the
   job reaches `SUCCEEDED` and its immutable version reaches `QA_REQUIRED`. For
   a PLY source, also confirm the version carries a `portable` `spz` asset
   beside the `web` RAD, and that `qa_reports.report_json` lists a
   `derivatives.compact` entry. Its absence means SPZ compaction was skipped —
   check the `processor.compact_spz_skipped` log — and is not by itself a job
   failure.
6. Approve QA, publish the Spark RAD release, confirm the numeric scene version
   and release revision, open it, and revoke it. Repeating an identical
   non-token publish with a new operation ID must return the active release
   instead of adding a duplicate history row.
7. Confirm a revoked manifest is unavailable.
8. Open Spatial authoring and confirm the selected project loads, create a
   disposable room with walkable bounds, and confirm collision/navigation counts
   update.
9. Open Measurement, create an indicative brief and three independent check
   points, generate a passing QA report, then generate and download the draft
   DXF. Confirm its D1 provenance, private R2 object, SHA-256, and range response.
10. In Hosting & lifecycle, run enforcement and a retained-object retrieval
    drill. Confirm both actions appear in lifecycle history.
11. Open the anonymous Studio and one public Spark release; both must report no
    browser console errors or warnings.
12. Check Workers logs for a shared request ID and no secret material.
13. Queue one verified poster through automated privacy detection. Confirm the
    run reaches `COMPLETED`, records six target inferences and exact input
    evidence, and that QA remains blocked until every proposed candidate has a
    human disposition.
14. In staging, create and apply a disposable project template, save a personal
    portfolio view, export an explicit project selection, and inspect the
    downloaded manifest. Upload that file to import preview, confirm the
    warnings and `DRAFT` destinations, then deliberately commit once. Repeat
    the same operation ID through the API and confirm the persisted result is
    returned rather than duplicate projects. Delete the disposable template and
    view.
14a. As a platform administrator, create one required typed project field and
    force its first save request to fail. Confirm `Saving field…`, disabled
    conflicting controls, an inline recoverable error, restored values, and a
    successful deliberate retry. Create a project carrying the value. With
    administrator membership in a second staging workspace, preview and commit
    a direct handoff; verify the target has a new DRAFT project and equivalent
    field/value, the source ID is unchanged, versions/assets/releases/jobs/
    reviews were not copied, the terminal response safely replays, and
    `PRAGMA foreign_key_check` is empty.
14b. With the source project containing at least one verified non-deleted R2
    asset, preview an asset-bearing copy into the second staging workspace.
    Confirm exact version/asset/byte totals and exclusions, then start once.
    Observe Queue progress to `completed`, independently download source and
    destination objects, and compare SHA-256. Verify the destination uses new
    project/version/asset IDs, returns to `INGESTED`, contains no jobs,
    releases, or reviews, and leaves the source unchanged. Inject a failed
    refresh or cancel response in browser QA: the initiating control must
    recover with its inline error retained even while background polling
    continues.
15. Create two immutable versions with authored room geometry in an asserted
    common Y-up frame. Generate change evidence, verify the metric summary and
    XZ overlay, record a human disposition, regenerate with a new threshold,
    then replay the first operation ID and confirm its original response is
    returned. Force one generation request to fail and confirm the form retains
    its values and succeeds on deliberate retry.
16. Upload canonical pose-path JSON for a version with at least two authored
    rooms. Confirm the exact source is a verified private R2 `report` asset,
    D1 stores its hash and bounded result, the XZ overlay identifies an
    intentionally missed room, and human recapture disposition persists.
    Repeat the operation ID and confirm no duplicate report or R2 asset appears.
17. When Cloudflare for SaaS is configured, run the complete customer-hostname
    activation and deletion exercise above. When it is not configured, confirm
    Studio explicitly reports provider setup required and cannot present a
    DNS-verified hostname as active.
18. When Stripe is configured, run the complete payment lifecycle above. Delay
    webhook delivery after Checkout success and confirm hosting remains
    inactive, then deliver the event and confirm exact-period activation.
    Inject a provider failure during cancellation and confirm the local
    subscription remains unchanged and retryable.
19. Create two immutable versions with verified source/master/point-cloud PLY
    assets already registered to the same declared frame. Queue registered
    raw-scene evidence, run `npm run processor:once`, verify both leased inputs
    by hash and bytes, inspect the immutable JSON report, and record a human
    disposition. Inject a processor outage and confirm one request, visible
    pending state, preserved form values, exact failure, and deliberate retry.
    Repeat with one input above `PROCESSOR_MAX_CHANGE_INPUT_MIB` and confirm the
    classified capacity failure occurs before download.
20. On a version with verified source/master/point-cloud/web assets, register a
    capture bundle with exact evidence roles, coordinate frame, exporter mode,
    and written rights evidence. Confirm the private R2 JSON reproduces each
    D1 asset hash and byte length. Declare a capability without its evidence
    role and confirm the manifest is blocked rather than rejected or silently
    upgraded. Delay the browser request and dispatch submit twice: exactly one
    request runs, all form controls disable, the exact error remains inline,
    every selection is retained, and deliberate retry is available.
21. Queue automatic registration for two same-scale, gravity-aligned immutable
    PLY assets whose origin and yaw differ. Confirm the leased processor records
    a 4×4 yaw/translation transform, overlap, RMSE, P95/maximum residual,
    ambiguity result, exact dual-input hashes/bytes, and a private immutable
    report before change analysis. Repeat with insufficient overlap: the job
    must complete with `registration_blocked`, preserve its transform/gates for
    review, and never report an occupancy-change conclusion. Delay the browser
    request and double-submit: exactly one request runs, every registration
    control is disabled with `aria-busy`, and the exact form state survives a
    deliberate retry.
22. Create a drone-imagery project and upload a small source-image ZIP with
    purpose `source_images`. Confirm the open upload record preserves that
    purpose, the resulting asset kind is `source`, and the job type is
    `asset.evidence-validate`. Verify one Queue-to-Container attempt records the
    exact bytes and SHA-256, zero derivative bytes, bounded `PKZIP` evidence,
    and a pending human-review report. Repeat with an E57 metric point cloud and
    confirm it is classified as `pointcloud`, never invokes Spark, and makes no
    semantic, calibration, or survey-accuracy claim.
23. On an immutable version with a reviewed `authored-structural-collision-v2`
    shell, tune the Walk/Fly agents and build verified navigation. Confirm the
    processor emits hash-bound validation JSON and Detour assets; review and
    approve the build; then publish. In the public viewer, prove arrow/WASD and
    touch movement, Shift boost, Fly rise/lower, collision against every wall,
    furniture-ignoring traversal, live floor-plan position, room reachability,
    and open/closed door parity. Tamper one artifact hash and confirm publication
    and manifest delivery fail closed.

The automated test suite runs the same release lifecycle locally in workerd.

## Rollback

Code rollback:

```bash
npx wrangler deployments list --env production
npx wrangler rollback --env production
```

Scene rollback does not require a Worker deployment. Use
`POST /api/release-channels/{slug}/rollback` with a previous immutable
`releaseId`, or use the Studio when that control is exposed.

## Incident actions

- leaked signing key: replace `JWT_KEYRING` and revoke affected D1 auth sessions
- leaked refresh token: revoke the affected `auth_sessions` row
- leaked processing token: rotate `WORKER_API_TOKEN` and stop/reconfigure agents
- leaked capture-agent token: revoke that credential in Team immediately,
  inspect its last-use and upload/audit evidence, then create or rotate only
  after project scope is reconfirmed
- leaked scene token: tokens expire within `SCENE_SESSION_TTL_SECONDS`
  (30 minutes by default) and can be renewed only up to their session's 24 h
  hard ceiling; delete the `scene_render_sessions` row to cut streaming off
  within the 60 s validation cache, or revoke the release channel for immediate
  denial
- bad release: revoke or point the channel to a previous release
- failed upload: abort the multipart session; source versions are not overwritten
- stuck worker: use the Studio cancel action, or let the lease expire and retry;
  attempts, failure class, processor evidence, and progress are visible to the
  operator
- failed privacy scan: inspect `error_json`, queue delivery attempts, Workers AI
  availability, and the environment DLQ; use the persisted Studio retry instead
  of inserting a new candidate or silently overriding QA

## Backups and retention

D1 metadata and R2 objects are separate recovery concerns. The application
enforces project-specific raw, derivative, and release retention; legal hold
suppresses deletion; every deleted object retains a D1 tombstone and lifecycle
action. The hourly schedule and the manual operator action run the same policy.

The in-product restore drill verifies that a retained R2 object can be retrieved
through the bound bucket and records the evidence. It does not restore a deleted
object and must not be described as provider backup recovery. Before paid
customer work, enable the Cloudflare recovery/backup features appropriate to
the selected plan and perform a separately documented provider-level restore
exercise.

## Identity follow-up

- add customer and team invitation/onboarding controls
- add WebAuthn or an enterprise IdP when customer procurement requires it
- activate the deployed Cloudflare for SaaS adapter with a scoped token,
  validated fallback origin, quota, and one customer-controlled hostname before
  claiming automatic customer-domain provisioning is live
- activate the deployed Stripe adapter with three exact price IDs, restricted
  API credentials, an endpoint-specific webhook secret, and one evidenced paid
  lifecycle before claiming self-service payment collection is live
- configure allowed embed origins if customer websites must iframe releases
- publish privacy, terms, retention, and measurement-disclaimer policies
- add uptime monitoring and alert routing
