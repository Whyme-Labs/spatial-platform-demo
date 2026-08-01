# Spatial Studio product roadmap

This roadmap is organized around complete user journeys. A capability is marked
`LIVE` only when its UI, API, persistence, authorization, action state,
observability, tests, and deployment path work together.

## Status vocabulary

- `LIVE` — production-deployed and covered by a release gate
- `PARTIAL` — useful infrastructure exists, but the journey is not complete
- `NEXT` — the active implementation milestone
- `PLANNED` — sequenced, but not represented as a working product
- `VALIDATE` — requires real capture data or customer evidence before building

## Surface truth

| Product surface | Status | What works now | Completion boundary |
|---|---|---|---|
| Marketing site | `LIVE` | Current Walk/Fly product story, linked Home Scan multi-room demo, capture CTA, and explicit visual/structure/navigation/evidence boundaries | Replace the licensed third-party technical demo with signed company-owned client case studies |
| Sign-in | `LIVE` | Email OTP, resend cooldown, ES256 access JWT, refresh rotation, logout, expiring team invitations, tenant-scoped OIDC discovery and PKCE callback | Activate and accept one real enterprise IdP |
| Team access | `LIVE` | Admin-only member inventory, expiring email invitations, OTP acceptance, role changes, resend, revoke/reinvite, immediate session invalidation, explicit multi-organisation workspace switching, OIDC provider lifecycle | Activate and accept one real enterprise IdP |
| Projects | `LIVE` | Create, search/filter/sort, personal saved views, reusable organisation templates, organisation-defined typed fields, schema-versioned previewed metadata export/import, metadata-only handoff, queued asset-bearing cross-organisation copy, open workspace, edit metadata, guarded individual and bulk archive/restore, retention policy | Asset copy is deliberately bounded to one project, 10 versions, 50 verified assets, and 100 GiB; move, disaster recovery, and transfer of releases/jobs/reviews/auth/billing remain separate products |
| Uploads | `LIVE` | Resumable multipart R2 ingest, pause, retry, cross-session recovery/discard, persisted part reconciliation, immutable version creation, purpose/format-aware XGRIDS, FJD, phone, drone, and open-import evidence intake, plus scoped unattended transfer agents for packaged vendor exports | Scanner control, vendor-GUI export automation, and live capture coverage remain outside the transfer-agent boundary |
| Processing jobs | `LIVE` | Executable local/external Spark worker plus Queue-dispatched Cloudflare Container lane, exact-job lease/heartbeat, multipart outputs, bounded capture-evidence validation, evidence, retry/cancel, and minute reconciliation | Native vendor reconstruction adapters and hosted GPU reconstruction workers |
| QA | `LIVE` | Technical validation, automated privacy evidence, authored-geometry evidence, registered PLY occupancy/centroid/colour evidence, pose-path room coverage, and audited publication approval | Scanner-native live coverage and threshold validation on licensed K1/P2 pairs |
| Releases | `LIVE` | Global inventory, publish, open, revoke, rollback, signed side-by-side Spark comparison | Production acceptance of registered raw-scene evidence on licensed scanner pairs |
| Spark viewer | `LIVE` | RAD/SPZ/SOG, private range delivery, adaptive budgets, first-frame/error telemetry, guided navigation, live floor plan, collision-driven Rapier Walk/Fly movement, and touch altitude controls | Broader measured phone matrix and richer multi-level circulation |
| Customer review | `LIVE` | Expiring email invitations, least-privilege review, camera-anchored comments/redactions, approval history, synchronized rendered comparison | Enterprise IdP onboarding |
| Semantics | `LIVE` | Floors, rooms, doorways, POIs, routes, provisional/metric units, v7 reviewed structural shells, Recast/Detour artifacts, dynamic doors, and human-reviewed walkable-region candidates from verified registered PLY | Licensed K1/P2 validation plus automatic multi-level circulation and doorway/stair inference |
| Measurement/CAD | `PARTIAL` | Briefs, tolerance classes, independent checks, residual QA, evidence-gated draft DXF, private delivery, cost evidence, sign-off boundary | Three paid briefs and partner evidence before commercial accuracy/CAD production claims |
| Billing/hosting lifecycle | `LIVE` for merchant billing; `PARTIAL` for self-service/custom domains | Admin-only manual invoice issuance, payment-reference-required reconciliation, guarded subscription transitions, idempotent audit ledger, fail-closed entitlement, plans, themes, quotas, retention, expiry enforcement, restore retrieval drill, dormant Stripe adapter, and an honest Cloudflare for SaaS hostname state machine | Operate one real manual billing cycle; Stripe is deferred. Cloudflare for SaaS still requires one live customer hostname |

## Milestone 1 — Operations V1

Status: `LIVE` when migration `0005` and the current Worker release are in
production.

Outcome: an operator can manage projects, jobs, and releases without relying on
hidden controls or database intervention.

Acceptance criteria:

- every sidebar destination changes the visible workspace and URL hash
- `Manage` opens and focuses a project workspace
- project metadata can be edited with validation and audit history
- archive preserves the prior lifecycle state and restore returns to it
- active releases, jobs, and uploads block unsafe archival
- releases are visible across the organisation
- historical releases can be made active; active releases can be revoked
- all mutations have single-flight pending state, inline error recovery, and
  success feedback
- Worker contract tests and browser interaction checks pass

## Milestone 2 — Real processing lane

Status: `LIVE` in production release
`1050aab4-3f97-47d2-8f54-5be3f718f851`.

Outcome: a licensed K1/P2 source becomes a publishable Spark derivative without
manual database or R2 work.

Deliverables:

1. Obtain licensed scanner-origin XGRIDS and FJD sources with redistribution
   permission. A licensed AWS indoor Gaussian source is used for the production
   processing proof until vendor-origin samples are contractually available.
2. Build the processing-agent executable around the existing lease, heartbeat,
   complete, and fail contract.
3. Validate Gaussian PLY; generate Spark RAD plus poster and QA report.
4. Persist processor version, compute duration, active human time, source/output
   bytes, and failure class.
5. Add operator retry and cancel controls with explicit terminal states.
6. Run the mobile/desktop performance matrix on real indoor scenes.

Exit criteria:

- one command starts a registered worker
- a queued source produces an R2 derivative and `QA_REQUIRED` version
- retries are idempotent and never duplicate immutable assets
- one failed fixture reaches a visible, recoverable failure state
- iOS Safari, Android Chrome, and desktop results are recorded

Release evidence:

- staging job `33333333-3333-4333-8333-333333333304`
- Spark 2.1.0 quality RAD, real rendered PNG poster, and JSON QA report
- 3,771,733 input bytes and 8,842,636 immutable output bytes
- 57,096 ms measured processing duration and zero active human time
- invalid PLY fixture `33333333-3333-4333-8333-333333333314` reached a
  classified, operator-recoverable `FAILED` state
- browser matrix: `docs/verification/mobile-desktop-matrix.md`

## Milestone 3 — Client review and commercial hosting

Status: `LIVE` in production release
`2e7070b5-dcac-447f-91c8-2e0831c817f7`.

Outcome: a customer can review, approve, publish, and renew a spatial asset
without joining the production workspace.

Deliverables:

- reviewer invitations, least-privilege membership, expiry, and revocation
- location- and camera-anchored comments and redaction requests
- immutable-version approval history
- side-by-side immutable Spark rendering with synchronized navigation, exact
  comment/decision history, and evidence-only handling for versions without a
  verified web derivative
- client-specific themes and custom-domain ownership verification
- hosting plans, metering, invoices, renewal, archive, and deletion policy
- hourly lifecycle enforcement, notification digest, and retained-object
  retrieval drill

Exit criteria:

- a reviewer can complete the entire approval journey with least-privilege
  access
- every comment and approval is bound to an immutable version and camera pose
- comparison assets use short-lived, exact project/version/asset-scoped tokens
  and preserve HTTP range delivery without exposing R2 keys
- renderer loading, failure, timeout, and retry are independent per version
- expiry, renewal, revoke, and retention changes are tested and audited

Boundary: domain ownership verification and the Cloudflare for SaaS provider
adapter are deployed. Production provider credentials, fallback-origin
configuration, quota, and one customer-controlled DNS proof remain external
activation gates; no hostname is presented as active before both provider
routing and TLS status are active.

Comparison release evidence:

- exact project/version/asset-scoped HMAC sessions expire independently of the
  five-minute operator access JWT and preserve private R2 range delivery
- two current Spark 2.1 iframes reached ready state with synchronized cameras
  in authenticated browser acceptance
- an injected 503 failed only the affected side, exposed Retry, then recovered
  through a fresh signed-session request with all controls restored
- desktop and 390 × 844 mobile comparison layouts were visually inspected

## Milestone 4 — Spatial authoring moat

Status: `LIVE` in production release
`2e7070b5-dcac-447f-91c8-2e0831c817f7`.

Outcome: a raw photoreal scene becomes a structured, navigable spatial product.

Deliverables:

- floors, rooms, doorways, POIs, and route graph
- collision proxy and navmesh
- guided tour and floor-plan navigation
- device-adaptive Spark budgets and LoD policy
- review- and operator-origin privacy regions with operator approval
- semantic and asset-inventory change reports across immutable versions

Exit criteria:

- a non-technical viewer can reach any authored room in three interactions
- mobile performance policy is selected from measured device capability
- semantic data remains independent of scanner and splat format

Production evidence:

- the public `playroom` release exposes a floor, walkable room, POI, guided
  route, collision proxy, and navigation triangles
- its production quality RAD derivative returned first-frame telemetry in
  1,094 ms on the deployment smoke browser while retaining the prior SPZ
  release for rollback
- the Spark iframe receives the authored collision runtime and constrains FPS
  movement inside a walkable region
- box and polygon room footprints project into a scale-preserving SVG floor
  plan; the marker follows Spark camera updates and room moves require a
  renderer acknowledgement with visible pending, error, and retry states
- a non-technical visitor can open the guided navigator and reach the room or
  POI without using game controls

Boundary: automated privacy detection is evidence-only and currently covers the
verified rendered frames supplied to the scan, not every possible viewpoint in
the Gaussian scene. Authored geometry evidence is delivered by Milestone 10;
raw point-cloud, Gaussian, photometric, and survey-registration comparison is
not claimed.

## Milestone 5 — Measurement products

Status: `PARTIAL` in production release
`083fc05d-3ae5-42cf-bdb7-6e7b4e53f92d` — the evidence and draft-deliverable
workflow is deployed; the commercial product remains `VALIDATE`.

Outcome: metric derivatives are sold with explicit accuracy, evidence, and
professional boundaries.

Validation gates:

- select one wedge: measured floor plan, Scan-to-CAD, heritage archive, or
  stockpile volume
- obtain three paid briefs with explicit acceptance tolerances
- define control/check-point evidence and licensed-partner responsibility
- measure human cleanup time and contribution margin

Deployed validation tooling:

- measured-floor-plan and Scan-to-CAD briefs with intended use, exclusions,
  coordinates, tolerance, and reliance class
- independent reference/observed check points with computed residuals
- QA reports with point count, RMSE, mean, maximum, p95, and pass/fail state
- deterministic R12 DXF drafts generated only from a passing QA report and the
  exact authored-room geometry hash captured by that report
- stale-QA rejection when authored geometry changes, idempotent regeneration,
  private R2 bytes, D1 asset/provenance records, and tenant-scoped range
  downloads
- direct-cost evidence and contribution inputs
- an enforced boundary preventing self-declared professional certification

Only after the external gates:

- paid floor-plan/DXF product positioning and acceptance SLA
- client-facing tolerance and residual report package
- CAD/BIM handoff package
- partner sign-off and professional-liability controls

## Milestone 6 — Organisation team access

Status: `LIVE` in production release
`ae77e0a9-1f5d-4715-bc97-40a1c61410df`.

Outcome: a platform administrator can grant, inspect, change, and revoke
production-team access without direct D1 intervention.

Deployed controls:

- idempotent, expiring email invitations for platform administrators and
  production operators
- membership remains `invited` and cannot authenticate until a successful OTP
  proves control of the invited address
- admin-only inventory of active, invited, and revoked members plus the latest
  invitation lifecycle and email attempt count
- role changes and revocation invalidate all target refresh and access sessions
  immediately
- self-demotion/self-revocation and removal of the final active administrator
  are rejected
- expired invitations are revoked by the hourly lifecycle job and cannot
  request or verify OTP
- invitations may grant the same verified user access to multiple
  organisations; the active tenant remains explicit and session-bound
- every mutation is same-origin, audited, and exposed through single-flight
  loading, inline/global error, and deliberate retry states

Boundary: customer enterprise identity-provider federation is not implemented.
Email OTP remains the production identity proof. Multi-organisation session
switching is delivered by Milestone 12.

## Milestone 7 — Portfolio project operations

Status: `LIVE` in production release
`afa1b64e-b889-4e8e-b8d2-53df40764410`.

Outcome: an operator can safely apply lifecycle changes to a portfolio without
losing per-project dependency evidence or accidentally replaying a mutation.

Deployed controls:

- accessible row selection, select-all, mixed-state selection, and an explicit
  selected-project action bar
- bulk archive and restore across up to 50 tenant-scoped projects per operation
- the archive path atomically rejects projects with active releases,
  non-terminal jobs, or open uploads instead of racing the lifecycle check
- each result is classified as changed, already in the requested state,
  blocked, or not found; blocked projects remain selected for deliberate retry
- stable browser operation IDs are retained across timeout or network failure
- D1-persisted request hashes and responses make deliberate replay idempotent
  while conflicting reuse of an operation ID is rejected
- pending labels, `aria-busy`, conflicting-control disabling, timeout recovery,
  partial-success feedback, and exact blocked-project guidance work on desktop
  and mobile
- every terminal operation is tenant-scoped, audited, and recoverable from its
  persisted result

Boundary: reusable templates, metadata-only portfolio transfer, and personal
saved views are delivered by Milestone 9. Cross-organisation transfer and
portable release/source binaries are intentionally excluded.

## Milestone 8 — Automated privacy evidence

Status: `LIVE` in production release
`dee1cc08-054d-4bd7-a112-2b162935ff62`.

Outcome: a processed scene cannot reach publication QA until a bounded,
auditable automated privacy scan has completed and every proposed issue has a
recorded human outcome.

Deployed controls:

- verified private poster assets are queued through isolated staging and
  production Cloudflare Queues; raw capture and public release assets are never
  sent to the detector
- Workers AI Moondream checks six explicit classes: faces, licence plates,
  personal documents, sensitive screens, access credentials, and personal
  photographs
- every run records detector/version, exact input asset/hash/bytes, target set,
  inference count, duration, queue attempt, truncation, completion, and the
  continuing human-review requirement
- detector responses are defensively normalized across bounded box shapes,
  malformed/zero-area boxes are rejected, near-identical boxes are
  deduplicated, and missing model confidence is presented honestly
- candidates remain `pending`, `confirmed`, `dismissed`, or `resolved`;
  decisions retain the operator, evidence note, and timestamp
- QA preflight and the authoritative Worker gate require the latest scan to be
  complete and reject pending/confirmed candidates or pending/approved authored
  privacy regions
- queue, retry, polling, private-image loading, image retry, candidate decision,
  and QA preflight all expose pending, failure, and deliberate recovery states
- queue retries are bounded; failed and dead-lettered runs remain visible and
  retryable rather than silently disappearing

Production acceptance evidence:

- production scan `eea08a3b-08ca-4194-8140-60f6b0ae6269` processed the
  `playroom` evidence poster on the first queue attempt
- six detector inferences completed in 3,679 ms with the exact 727,717-byte
  SHA-256-addressed private input recorded in D1
- staging exercised the same queue/AI path in 3,761 ms before promotion
- the public `playroom` Spark 2.1.0 release remained ready with zero browser
  console errors after deployment

Boundary: a clean detector result is not a publication approval. Operators
remain responsible for reviewing evidence, adding viewpoints where coverage is
insufficient, and applying confirmed redactions. Full-scene viewpoint coverage,
OCR-based secret classification, and video/keyframe sampling remain future
work.

## Milestone 9 — Repeatable portfolio setup and transfer

Status: `LIVE` in production release
`420bc049-9f6b-40cb-af5c-6787899893d4`.

Outcome: an operator can reproduce project defaults, return to a useful
portfolio query, and move bounded project metadata through an explicit,
previewed workflow without copying lifecycle authority or private binaries.

Implemented controls:

- organisation-scoped reusable project templates with capture-adapter,
  delivery-profile, notes, and active/inactive lifecycle
- user-scoped saved views covering search, archive visibility, adapter,
  delivery profile, and deterministic sort, with one default view per user
- versioned JSON portfolio export for an explicit selection or a bounded
  filtered set, with browser download state and no implicit mutation
- import file validation and server preview before a separately confirmed
  commit; warnings identify existing names and every imported project receives
  a new ID, slug, and `DRAFT` state
- persistent import operation IDs, request hashes, and terminal responses make
  transport retries safe while rejecting conflicting operation reuse
- templates, saved views, and imports are tenant-scoped and audited; export
  contains metadata only and never includes source assets, releases,
  credentials, memberships, billing records, or lifecycle authority
- pending, error, timeout, deliberate retry, and terminal success states are
  explicit for every action; the import transition is derived from current
  state so a completed preview cannot be overwritten by stale control state
- desktop and 390 px mobile browser QA cover template application, saved-view
  creation, real export download, preview, commit, and overflow-free layout

Production acceptance evidence:

- migration `0015_portfolio_management.sql` was applied to isolated staging and
  production D1 databases before code promotion
- staging release `6c75fdbe-2e50-49ca-b9f7-cb40a5562c51` passed health,
  static-surface, and anonymous authorization-boundary smoke checks
- the full release gate passed 34 Worker-runtime tests, strict TypeScript,
  static action-state audit, production build, and Cloudflare deployment dry-run
- production health and authorization boundaries passed; the existing
  `playroom` Spark RAD release remained available and returned the requested
  1,024-byte range with HTTP `206`

Boundary: the manifest is for same-organisation project setup and external
metadata backup. It is not a complete tenant export, cross-organisation
transfer, asset migration, or disaster-recovery format.

## Milestone 10 — Authored geometry change evidence

Status: `LIVE` in production release
`7958fe73-a1bb-4622-beb2-f3bbe1008b6b`.

Outcome: an operator can compare spatial semantics across two immutable
versions without presenting a rendered-image impression as metric evidence.

Implemented controls:

- the operator selects two immutable versions, a material-change threshold, a
  shared-local or registered-project frame assertion, and explicit registration
  evidence
- only active authored floors, rooms, and doorways with valid box or polygon
  geometry are compared; correspondence uses normalized kind and label
- the Worker computes XZ footprint centroid displacement, symmetric discrete
  boundary deviation, vertical extent deviation, area delta, threshold
  classification, p50/p95/maximum summaries, and an XZ visual overlay
- duplicate semantic keys, invalid footprints, or no unambiguous matches block
  a metric conclusion instead of being guessed
- every report records its method, source-geometry hash, coordinate assertion,
  registration evidence, threshold, actor, and human disposition
- every client operation has a D1-persisted request hash and immutable response;
  old operation IDs remain replayable after later regeneration and conflicting
  reuse is rejected
- generation and review have single-flight pending state, inline failure,
  retained form data, deliberate retry, and overflow-free mobile rendering

Production acceptance evidence:

- migration `0016_authored_geometry_change_evidence.sql` was applied to isolated
  staging and production D1 databases before code promotion
- staging release `d33b77b7-84cc-4960-8e6a-4bef8a8e06ef` passed health, static
  surface, anonymous authorization-boundary, and schema smoke checks
- the full release gate passed 38 Worker-runtime tests, strict TypeScript,
  static action-state audit, production build, and Cloudflare dry-run
- delayed generation and review exposed disabled `aria-busy` states; an
  injected 503 retained every field, rendered the server error, and succeeded
  on deliberate retry
- the 390 px evidence view had no horizontal overflow and a full authenticated
  reload produced zero console errors
- production health and authorization boundaries passed; the public `playroom`
  Spark 2.1.0 RAD release reached ready with zero console errors and returned
  the requested 1,024-byte range with HTTP `206`

Boundary: this is an authored semantic-geometry comparison in a coordinate
frame asserted by the operator. It is not point-cloud registration, Gaussian
or photometric change detection, certified survey evidence, or an automatic
recapture decision.

## Milestone 11 — Vendor-neutral capture completeness evidence

Status: `LIVE` in production release
`18460ea3-6215-46b1-b530-819d9c8845db`.

Outcome: a capture operator can supply a scanner-independent pose trajectory
and receive bounded room-coverage and recapture evidence before investing in
reconstruction.

Implemented controls:

- a canonical Y-up JSON contract accepts 2–5,000 finite pose samples, with
  optional all-or-none monotonic timestamps and an explicit alignment statement
- the declared adapter must match the project; the exact canonical source is
  SHA-256 addressed and preserved as an immutable private R2 report asset
- active authored room boxes and polygons define the target; the Worker samples
  their XZ footprints and reports coverage percentage, in-room sample count,
  path length, maximum sample gap, endpoint distance, loop status, and duration
- uncovered rooms, excessive gaps, invalid room geometry, partial timestamps,
  and non-monotonic timestamps block or require recapture rather than being
  silently ignored
- a bounded XZ overlay shows room state, trajectory, excessive gaps, and blind
  spots; full source pose data stays out of D1
- persistent operation IDs prevent duplicate D1 reports and R2 assets; changed
  reuse is rejected
- a human accepts the evidence or records a recapture decision with an audited
  note
- analysis and review expose synchronous pending state, inline errors, retained
  file/form data, and deliberate retry

Boundary: this evidence measures geometric pose-path proximity to authored room
footprints. It does not validate source-image quality, exposure, occlusion,
sensor calibration, SLAM accuracy, loop-closure correctness, final Gaussian
quality, or real-world scanner false-positive/false-negative rates.

Release evidence:

- the complete release gate passed generated Cloudflare bindings, both
  TypeScript targets, the action-state audit, production build, all 43 Worker
  and domain tests, and a production Wrangler dry-run
- staging migration `0017_capture_completeness_evidence.sql` and release
  `c1d06de7-f252-49e4-baef-b2103e6303ae` passed health, static Studio,
  anonymous-auth, and D1-schema smoke tests
- production migration and release
  `18460ea3-6215-46b1-b530-819d9c8845db` passed the same boundary checks
- the public `playroom` release still reached `Spark 2.1.0 ready` without
  browser console errors; its 65,149,352-byte RAD source returned the requested
  1,024-byte HTTP `206` range
- authenticated desktop QA verified retained trajectory/form state across a
  forced `503`, successful retry, recapture visualization, and reviewed
  disposition; 390 px mobile QA found no horizontal overflow

## Milestone 12 — Secure multi-organisation membership and switching

Status: `LIVE` in production release
`5a92cffc-ec30-4f44-8ea0-47e3596d960c`.

Outcome: one verified user can belong to several customer organisations and
change the active tenant without ambiguous JWT scope, stale project state, or
another OTP round trip.

Implemented controls:

- OTP verification accepts every live pending organisation invitation for the
  verified address while selecting exactly one active membership for the new
  session
- the workspace inventory returns only the authenticated user's active
  memberships and labels each organisation, role, and current tenant
- switching verifies an active membership, accepts live project invitations in
  the target tenant, creates fresh access and refresh credentials, and revokes
  the old session before returning
- the client clears tenant-scoped projects, jobs, releases, reviews, portfolio
  state, and active workspace state before loading the selected organisation
- a same-tenant switch is idempotent; a non-member or inactive membership is
  rejected without changing the current session
- the public session response contains only user-facing identity context and
  does not disclose the internal session identifier or refresh lifetime
- the selector is hidden for single-organisation users and remains available
  with sign-out on narrow mobile layouts
- switching exposes a single-flight `Switching…` state, disables conflicting
  workspace controls, keeps the selected target and inline error on failure,
  and permits deliberate retry

Local acceptance evidence:

- the Worker integration suite proves membership inventory, forbidden-switch
  session retention, successful credential rotation, rejection of the old
  access token, target-tenant role scope, and cross-organisation OTP acceptance
- the complete local typecheck, action audit, build, and 44-test suite pass
- a 390 px authenticated Chrome session switched from `Spatial Studio` to
  `Field Operations` with a `200` response, loaded only target-tenant data,
  produced no post-switch console errors, and had no horizontal overflow

Release evidence:

- the complete release gate passed generated Cloudflare bindings, both
  TypeScript targets, the action-state audit, production build, all 44 Worker
  and domain tests, and a production Wrangler dry-run
- staging release `7b967020-ee9a-4a04-bad5-e36e606cee05` passed health,
  static Studio, and anonymous membership-boundary smoke tests
- production release `5a92cffc-ec30-4f44-8ea0-47e3596d960c` passed the same
  health, static, and authorization boundaries
- the public `playroom` release still reached `Spark 2.1.0 ready` with no
  browser console errors; its 65,149,352-byte RAD source returned the requested
  1,024-byte HTTP `206` range

Boundary: this is explicit email-OTP-backed tenant selection. It does not
implement SAML/OIDC enterprise federation, SCIM provisioning, delegated domain
administration, or automatic cross-organisation data transfer.

## Milestone 13 — Cloudflare for SaaS custom-hostname lifecycle

Status: `PARTIAL` in production release
`01b29d1a-1c20-4d2f-a535-ec6f9142ca5f`.

Outcome: an operator can manage branded-hostname ownership and provider
activation without confusing a DNS TXT proof with working customer traffic.

Implemented controls:

- D1 records ownership verification, Cloudflare hostname identity, routing
  status, TLS status, validation records, attempts, bounded provider errors,
  last check, and activation time separately
- the provider adapter creates, retrieves, reconciles, and deletes Cloudflare
  custom hostnames using bounded timeouts and bearer authentication
- orphan reconciliation finds an exact pre-existing Cloudflare hostname before
  creating a replacement, while deletion refuses to orphan provider state when
  configuration is missing
- a hostname becomes `active` only when the local state, Cloudflare hostname
  state, and Cloudflare SSL state are all `active`
- customer-host requests are scoped to the bound project and active release;
  pending hostnames receive a setup response and cannot read another project's
  manifest or scene
- prior ownership-only `active` rows are demoted by migration so historical
  data cannot preserve the false claim
- the Studio exposes TXT ownership and CNAME delivery instructions, persistent
  routing/TLS evidence, challenge replacement, verification, provisioning
  refresh, removal, and explicit provider-configuration guidance
- create, verify, refresh, challenge, inventory, and removal actions use
  single-flight pending state, inline error recovery, and deliberate retry

Release evidence:

- migration `0018_cloudflare_saas_domains.sql` was applied to isolated local,
  staging, and production D1 databases before the corresponding code release
- all 49 Worker/domain tests passed, including bounded provider failures,
  exact deletion, DNS-only non-activation, primary-host regression, and
  customer-host project isolation
- staging release `df03a5b5-5570-4241-ae14-4fdb75f1146f` passed health, static
  Studio, anonymous authorization, and schema smoke checks
- production release `01b29d1a-1c20-4d2f-a535-ec6f9142ca5f` passed the same
  checks; the existing 65,149,352-byte `playroom` RAD still returned a
  1,024-byte HTTP `206` range and reached a complete Spark 2.1 render without
  application console errors
- 390 px authenticated browser QA verified overflow-free DNS instructions,
  synchronous disabled creation state, injected provider failure, exact inline
  error, and a restored verification control for deliberate retry

External activation boundary:

- `CLOUDFLARE_SAAS_ZONE_ID` and `CLOUDFLARE_SAAS_API_TOKEN` are intentionally
  absent in production, so the UI reports provider configuration required
- the Cloudflare zone must enable Cloudflare for SaaS, declare and validate the
  fallback origin, grant the scoped API token, and have sufficient hostname
  quota
- one customer-controlled hostname must complete TXT ownership, CNAME routing,
  hostname activation, certificate activation, live request routing, and
  deletion/recreation acceptance before this milestone can be marked `LIVE`

## Milestone 14 — Provider-backed payment lifecycle

Status: `PARTIAL` in production release
`ab6ff625-f501-4841-8733-344e8eadaf43`; the application journey is deployed
but Stripe account activation and a real paid transaction remain external
acceptance gates.

Outcome: paid hosting cannot become active from a local button or database
mutation; only provider-signed payment evidence creates the entitlement.

Implemented controls:

- plan checkout creates a Stripe subscription Checkout Session with exact
  organisation, project, checkout, and plan metadata
- stable browser operation IDs and Stripe idempotency keys prevent duplicate
  sessions when a request is retried after a timeout
- the browser never creates an invoice or subscription locally and explicitly
  reports that payment setup is unavailable when provider configuration is
  absent
- webhook HMAC verification uses the exact raw body, bounded timestamp
  tolerance, multiple `v1` signatures, and timing-safe comparison
- provider event IDs and payload hashes form a D1 idempotency/conflict ledger;
  failed reconciliation is retained and returns a retryable server failure
- checkout completion alone does not grant access; a paid invoice must match
  the recorded checkout amount and currency and include an exact service period
  before D1 activates hosting
- paid, payment-failed, checkout-expired, subscription-updated, and
  subscription-deleted events reconcile the local lifecycle
- cancellation first requests `cancel_at_period_end` from Stripe and changes
  local state only after Stripe confirms it
- historical paid records created without provider evidence are demoted to
  `past_due` by migration rather than preserving an unverified entitlement
- checkout, provider event, subscription, and invoice identifiers remain in D1;
  API/webhook secrets remain Worker secrets and no payment card data reaches
  the application
- checkout, delivery-settings, and cancellation actions use explicit pending,
  disabled, inline/global error, and deliberate retry states

Local acceptance evidence:

- all 53 Worker/domain tests passed with bounded provider errors, Stripe
  idempotency headers, signed/stale/modified webhook verification, and the
  no-provider no-entitlement integration path
- a 390 px authenticated browser run verified the honest disabled
  `Payment setup required` state without overflow or console errors
- an injected delayed provider failure changed checkout to
  `Creating secure checkout…`, disabled the form with `aria-busy`, displayed
  the exact error, and restored `Start secure checkout` for deliberate retry

Release evidence:

- migration `0019_provider_backed_billing.sql` was applied to isolated local,
  staging, and production D1 databases before the corresponding code release
- staging release `39c8e692-e810-4a89-bfcf-dc3e6c38f906` passed health, static
  Studio, anonymous authorization, unconfigured-webhook, and schema smoke checks
- production release `ab6ff625-f501-4841-8733-344e8eadaf43` passed the same
  checks with zero fabricated checkout/event records
- the existing `playroom` release still reached `Spark 2.1.0 ready` with no
  browser console errors; its 65,149,352-byte RAD returned the requested
  1,024-byte HTTP `206` range

External activation boundary:

- production intentionally has no Stripe secret key, webhook secret, or price
  IDs, so the UI cannot create a checkout and the API cannot invent a paid
  subscription
- create live/test Stripe products and recurring MYR prices, store both secrets,
  set all plan price IDs, and register the signed webhook endpoint
- complete checkout success, delayed webhook, payment failure, recovery,
  cancellation-at-period-end, renewal, and event-replay exercises in staging
- complete one real paid and refunded/cancelled test-customer lifecycle before
  presenting self-service billing as `LIVE`

## Milestone 15 — Enterprise OIDC federation

Status: `PARTIAL` in production release
`b29aa7e7-e802-4cd7-8366-22125885f802`; the complete application boundary is
deployed, while a real customer identity provider and its secret remain an
external acceptance gate.

Outcome: an invited or active organisation member can authenticate through an
administrator-configured OIDC provider without weakening tenant isolation,
email ownership, or session provenance.

Implemented controls:

- administrators create tenant-scoped draft providers, validate live discovery
  before activation, disable providers with immediate session revocation, and
  delete only providers that have no active state or linked identities
- client secrets never enter D1 or the browser; D1 stores only a secret
  reference and the Worker resolves it from `OIDC_CLIENT_SECRETS`
- public discovery returns only active providers whose exact email domain and
  mapped secret match, without exposing issuer, client ID, or secret reference
- authorization code flow uses PKCE S256, single-use state, a secure
  `SameSite=Lax` state cookie, encrypted verifier and nonce, and a ten-minute
  attempt lifetime
- discovery, token, and JWKS responses use HTTPS, reject local or numeric
  destinations, disallow redirects, enforce bounded time and response size,
  and require exact issuer metadata
- ID tokens require RS256 or ES256, exact issuer and audience, `azp` where
  applicable, a matching nonce, bounded issue time, valid lifetime, a verified
  email, and an exact configured domain
- account linking is limited to an existing provider subject or an exact
  invited/active organisation membership for the asserted email; successful
  sessions retain their OIDC provider provenance and cannot switch
  organisations
- provider discovery, provider start, provider administration, and callback
  completion expose explicit pending, disabled, error, retry, and terminal
  states without double submission

Release evidence:

- migration `0020_enterprise_oidc.sql` was applied to isolated local, staging,
  and production D1 databases before code promotion
- the full release gate passed generated Cloudflare bindings, both TypeScript
  targets, the static action-state audit, production build, all 60 Worker and
  domain tests, and a production Wrangler dry-run
- staging release `fff5baa6-8f7a-47ab-bf9b-cb51f542e2c0` passed health,
  static Studio, anonymous administration, empty public discovery,
  missing-provider, and D1-schema smoke checks
- production release `b29aa7e7-e802-4cd7-8366-22125885f802` passed the same
  checks; the production secret inventory intentionally contains no OIDC
  client-secret map
- delayed discovery and provider-start browser checks verified synchronous
  `aria-busy`, conflicting-control disabling, exact inline errors, and
  deliberate recovery on 390 px mobile and desktop Team surfaces
- the public `playroom` release still reached `Spark 2.1.0 ready` without
  browser console errors; its 65,149,352-byte RAD returned the requested
  1,024-byte HTTP `206` range

External activation boundary:

- register an OIDC web application with a customer IdP using the exact callback
  URL shown in Studio
- store the provider's client secret in the environment-specific
  `OIDC_CLIENT_SECRETS` map, then activate it through the administrator UI
- accept successful login, provider denial, expired state, replayed callback,
  wrong nonce, wrong audience, unverified email, non-member email, disable,
  session revocation, and secret-rotation scenarios against the real provider
- do not present enterprise federation as fully accepted until that real
  provider lifecycle passes in staging and production

## Milestone 16 — Registered raw-scene change evidence

Status: `PARTIAL` in production release
`bcbcee35-b4a8-4f6e-b7ff-c6bdf66f97a1`; the complete application and processor
contract is deployed, while licensed scanner-pair validation remains external.

Outcome: an operator can compare two exact immutable PLY assets that are already
registered to a declared shared frame, inspect processor-generated structural
and photometric evidence, recover a failed run, and record a human disposition.

Implemented controls:

- D1 binds exact baseline/candidate versions and verified source, master, or
  point-cloud PLY assets, request hash/idempotency, declared coordinate
  assurance, registration evidence, thresholds, job state, output, and review
- the existing bearer-authenticated lease lane returns two exact private inputs
  only to the current lease; each download is verified against D1 size and
  SHA-256 before analysis
- ASCII and binary little-endian PLY inputs produce deterministic bounded voxel
  signatures with occupancy, common-voxel centroid, RGB/Gaussian-DC mean colour,
  bounds, sampling stride, and source counts
- reports retain added/removed voxels, structural-change percentage, centroid
  and colour percentiles, threshold signals, top changed voxels, method/version,
  exact input evidence, limitations, and mandatory human review
- immutable report upload and specialized completion require exact dual-input
  byte evidence and cannot be substituted through the generic completion route
- processor input capacity is explicit and enforced before download; terminal
  capacity/input failures remain visible and manually retryable after correction
- queued/running progress, exact failed/dead-letter error, retry, completed
  metrics, rendered-version comparison, and human review are first-class Studio
  states
- static control-wiring audit now fails the release when a visible button lacks
  a submit contract, direct client binding, or auditable delegated binding

Local acceptance evidence:

- processor and Worker integration tests prove deterministic signatures,
  structural/photometric/centroid evidence, capacity rejection, idempotent
  creation, exact dual-input leases, private downloads, specialized completion,
  persisted report inventory, and human disposition
- authenticated browser acceptance dispatched the comparison submit twice
  during an injected outage and observed exactly one request, 13 disabled
  controls, `Queueing comparison…`, `aria-busy`, exact inline error, retained
  evidence, restored retry, zero application errors, and no overflow at
  390 × 844
- the control-wiring release gate accounts for 98 static buttons, 75
  TypeScript-generated buttons, 18 static links, 7 generated links, and 26
  interactive forms; two disabled fake actions discovered by the first dynamic
  audit were replaced with semantic status text

Release evidence:

- migration `0021_registered_raw_scene_change.sql` was applied to isolated
  local, staging, and production D1 databases before code promotion
- the complete release gate passed generated Worker bindings, both TypeScript
  targets, the action-state audit, the 98-static/75-dynamic-button,
  18-static/7-dynamic-link, and 26-form control-wiring audit,
  production build, all 64 Worker/domain tests across 12 files, and a production
  Wrangler dry-run
- staging release `0c850c39-08e4-46cd-beb5-1ab1aac29ab1` passed health, static
  Studio, anonymous raw-evidence authorization, worker-authentication, mobile
  layout, console, and D1-schema smoke checks
- production release `bcbcee35-b4a8-4f6e-b7ff-c6bdf66f97a1` passed the same
  checks; the new report table is empty rather than populated with fabricated
  scanner evidence
- the public `playroom` release still reached `Spark 2.1.0 ready` with no
  browser console errors; its 65,149,352-byte RAD returned the requested
  1,024-byte HTTP `206` range

Validation boundary:

- the processor assumes the two inputs are already registered; it does not
  estimate or certify registration
- deterministic voxel sampling can miss sub-voxel changes, while mean-colour
  deltas can reflect exposure or lighting instead of physical change
- licensed K1 and P2 scanner-origin pairs, real thresholds, false-positive and
  false-negative rates, and field operator SOPs remain external validation gates
- do not present this evidence as a survey result or automated acceptance
  decision

## Milestone 17 — Vendor-neutral capture-bundle contract

Status: `PARTIAL` in production release
`d21dddd6-ffcb-4946-acb7-9529f8c35433`; the complete internal contract is live,
while licensed XGRIDS/FJD bundle acceptance remains external.

Outcome: an operator can register the exact immutable evidence received from a
capture/export workflow, distinguish immediate delivery capability from future
reconstruction independence, and record a human disposition without making the
platform depend on one scanner format.

Implemented controls:

- the `1.0.0` contract records project adapter, capture hardware and firmware,
  exporter/version/time/mode, coordinate frame/units/axis/EPSG, registration
  method, declared limitations, and written commercial-rights evidence
- every manifest role resolves to an exact verified, non-deleted asset on the
  selected immutable version; D1/R2 byte mismatch, absent SHA-256, wrong tenant,
  wrong version, or pending integrity blocks persistence
- role/asset kind/format compatibility and declared-capability evidence are
  checked server-side rather than trusted from the browser
- rendering, metric geometry, portable reconstruction, independent
  reconstruction inputs, and CLI/API automation readiness are reported as
  separate properties
- commercial use, self-hosting, and derived redistribution are independent
  required assertions; missing rights block the contract
- the complete canonical manifest is SHA-256 addressed and preserved as a
  private verified R2 report asset; D1 stores the bounded validation,
  idempotency hash, lifecycle, and human review
- persistent operation IDs return the original response on exact replay and
  reject changed reuse; a blocked contract cannot be accepted
- the Studio derives capability declarations from selected evidence roles,
  keeps all form state after failure, and provides a dedicated review lifecycle

Local acceptance evidence:

- domain tests distinguish portable Gaussian delivery from independent
  reconstruction inputs and interactive export from automation evidence
- Worker integration proves exact version/asset resolution, private R2 manifest
  persistence, SHA-256/byte inventory, adapter isolation, idempotent replay,
  conflicting-reuse rejection, and human review
- authenticated browser QA dispatched submit twice during an injected `503`
  and observed one request, `Registering bundle…`, `aria-busy`, 24 disabled
  controls, exact inline error, retained assets/roles/rights evidence, restored
  retry, zero unexpected browser errors, and no overflow at 390 px
- the control-wiring release gate accounts for 102 static buttons, 77
  TypeScript-generated buttons, 18 static links, 7 generated links, and 28
  interactive forms

Release evidence:

- migration `0022_capture_bundle_manifests.sql` was applied to isolated local,
  staging, and production D1 databases before code promotion
- the complete release gate passed generated Worker bindings, both TypeScript
  targets, action-state and control-wiring audits, production build, all 66
  Worker/domain tests across 13 files, and a production Wrangler dry-run
- staging release `dc101d13-5a0d-4f7e-82b3-c8c366c84a9a` passed health,
  static Studio, anonymous authorization, and D1-schema smoke checks; its
  capture-bundle table remains empty rather than containing fabricated scanner
  evidence
- production release `d21dddd6-ffcb-4946-acb7-9529f8c35433` passed the same
  checks; the 390 × 844 Studio sign-in surface had no horizontal overflow or
  browser errors
- the public `playroom` release still reached `Spark 2.1.0 ready` with no
  browser errors; its 65,149,352-byte RAD returned the requested 1,024-byte
  HTTP `206` range

External validation boundary:

- register one licensed K1/LCC and one P2/Trion export and verify the actual
  availability of source images, timestamps, poses, intrinsics, extrinsics,
  IMU, GNSS, point cloud, Gaussian master, and commercial rights
- this contract proves what was registered and preserved; it does not verify
  scanner origin, calibration accuracy, reconstruction quality, or vendor
  licence truth
- purpose-aware vendor ingestion now consumes this stable contract without
  changing downstream project semantics; native scanner control and
  reconstruction remain future, licensed adapter work

## Milestone 18 — Bounded automatic raw-scene registration

Status: `PARTIAL` in production release
`826d7d2e-7029-4353-b25b-79c102f2a389`; the complete internal workflow is
live, while scanner-origin threshold calibration remains external.

Outcome: an operator can submit two immutable, same-scale and gravity-aligned
PLY assets without asserting a common origin/yaw. The leased processor estimates
a bounded transform, proves whether its declared quality gates passed, and runs
change analysis only after registration acceptance.

Implemented controls:

- automatic mode preserves scale and the gravity axis and estimates yaw plus XYZ
  translation only; the established declared-frame mode remains available
- deterministic registration input is capped at 10,000 occupied voxels per
  scene and uses twelve 30-degree yaw seeds with bounded refinement
- minimum symmetric overlap, maximum RMSE, and an unambiguous-solution check are
  independent required gates; a failed gate produces `registration_blocked`
- blocked registration still preserves its candidate transform, overlap, RMSE,
  P95/maximum residual, iterations, alternate solution, parameters, and gates
  as a private immutable JSON report, but occupancy/change analysis does not run
- accepted transforms re-voxelize the candidate in the baseline frame before
  the existing occupancy, centroid, and mean-colour comparison
- the Worker revalidates processor evidence against D1-declared gates and exact
  dual-input byte inventory before accepting completion
- persistent operation IDs prevent duplicate reports/jobs and exact worker
  retries reuse the same immutable asset pair
- the Studio defaults to automatic mode, exposes every registration assumption
  and gate, separates registration metrics from change metrics, and defaults a
  blocked result to `needs_recapture` for human review

Local acceptance evidence:

- processor contracts recover a known 90-degree yaw and translation with 100%
  overlap and zero residual, then return no material change after re-voxelizing
  the candidate
- a low-overlap fixture is blocked and cannot produce a registered candidate
- Worker integration proves declared-mode compatibility, automatic lease
  configuration, immutable blocked-report upload, completion validation, null
  change conclusion, D1 registration state, and preserved report JSON
- the real `spatial-processor/0.3.0` agent leased local fixture job
  `f7149a9e-6765-4793-bc4d-ae495c99bcfe`, verified both immutable inputs,
  recovered the known 90-degree yaw and `[2, 0.75, 4]` metre translation with
  100% overlap and 0 mm RMSE, registered a verified 4,707-byte private report,
  and concluded no material change in 1,436 ms
- authenticated browser QA dispatched submit twice during an injected `503`
  and observed one request, `Queueing registration…`, `aria-busy`, 17 disabled
  controls, exact inline error, retained registration mode/search/RMSE/overlap
  and evidence, restored retry, zero unexpected errors, and no overflow at
  390 × 844
- the complete release gate passed generated Worker bindings, both TypeScript
  targets, action-state and control-wiring audits, production build, all 68
  Worker/domain tests across 13 files, and a production Wrangler dry-run

Release evidence:

- migration `0023_automatic_scene_registration.sql` was applied to isolated
  local, staging, and production D1 databases before code promotion
- staging release `86d6bddb-ebf5-4b0f-80fc-5c227d5482d2` passed health,
  static Studio, anonymous authorization, and exact six-column schema smoke
  checks; no synthetic automatic-registration record was inserted
- production release `826d7d2e-7029-4353-b25b-79c102f2a389` passed the same
  checks; its 390 × 844 Studio sign-in surface had no horizontal overflow or
  browser errors
- the public `playroom` release still reached `Spark 2.1.0 ready` without
  browser errors; its 65,149,352-byte RAD returned the requested 1,024-byte
  HTTP `206` range

External validation boundary:

- the algorithm is not full 6DoF, scale, control-point, or survey registration
- repetitive geometry, low overlap, large physical changes, SLAM drift, wrong
  units/axis declarations, and deterministic sampling can produce a plausible
  but incorrect transform
- licensed K1 and P2 version pairs must establish search radii, overlap/RMSE
  thresholds, ambiguity sensitivity, false-alignment rates, and operator SOPs
  before this evidence is used commercially

## Milestone 19 — Elastic cloud processor dispatch

Status: `LIVE` in application production release
`0a2daedc-d8da-45de-9516-ff1ace2a9654` and processor production release
`efe060a4-6a28-48e8-b243-87b8593437f9`.

Outcome: an operator-created processing job runs without a manually supervised
workstation while retaining the existing D1 job authority, private R2 boundary,
processor evidence, bounded retries, and provider-neutral external-worker
option.

Implemented controls:

- the application publishes only an exact processing-job UUID to a dedicated
  Queue; no asset bytes, object keys, tenant metadata, or credentials enter the
  message
- a processor Container is deterministically addressed by job UUID and passes
  `PROCESSOR_JOB_ID`, so its lease request cannot claim unrelated work
- D1's existing atomic lease, expiry, heartbeat, attempt, completion, and
  classified failure model remains authoritative
- the application immediately dispatches new/retried work and reconciles every
  minute for queued or expired leased jobs, covering a lost Queue notification,
  failed cold start, or stopped Container
- the linux/amd64 image compiles Spark 2.1.0 `build-lod` from pinned commit
  `f22236f95fdd8078f0c12e3aab479523d401daf6` and includes Node 22 plus Chromium
  for the established real-poster lane
- the cloud processor receives only the platform origin and independent worker
  bearer secret; it has no D1, R2, KV, email, JWT, billing, OIDC, or SaaS
  provider binding
- concurrency is capped at three `standard-3` instances; raw-scene inputs
  retain the processor's explicit 1,024 MiB per-input capacity gate
- a Container remains eligible for four hours of request-idle time so a
  processor with an accepted 180-minute internal runtime cannot be terminated
  by a short request-activity timeout while Spark is computing
- a rendered poster is accepted only after two consecutive sampled frames have
  non-background signal, luminance range, and colour diversity; a syntactically
  valid but blank canvas is a classified processor failure rather than a
  publishable derivative
- the existing local/external agent remains a compatible fallback and
  GPU/vendor reconstruction remains behind a separate adapter because this
  Cloudflare Container lane is CPU-only

Local acceptance evidence:

- the lease contract first failed when an assigned job UUID was ignored, then
  passed after the Worker constrained its atomic claim to that exact UUID
- an unrelated valid UUID returns `204` without consuming available work, while
  the assigned UUID leases and completes through the established immutable
  input/output evidence contract
- dispatch parsing rejects missing/malformed job IDs and the generated
  Container environment carries no direct R2 credentials
- the exact linux/amd64 image is 1,003,879,430 bytes with local image digest
  `sha256:f28c844a2e8449e9dd469c0dae95286310549154d34bba865a0e8893696b1e2b`;
  its containerized poster rendered the stairwell scene instead of the
  previously detected uniform-background false success
- the complete release gate passed generated bindings, both TypeScript
  targets, action-state and control-wiring audits, production build, all 73
  Worker/domain tests across 15 files, and production dry-runs for the
  application and processor Workers
- the control-wiring audit accounts for 102 static buttons, 77
  TypeScript-generated buttons, 18 static links, 7 generated links, and 28
  interactive forms

Release evidence:

- staging application release `1cb96719-2765-4523-ba80-9bac00e9c3b4` and
  processor release `cf933f35-586c-4038-812f-4eeebfe9aa71` were activated with
  Queue `spatial-processing-dispatch-staging` reporting one producer and one
  consumer
- staging exact-job proof `33333333-3333-4333-8333-333333333305` was emitted
  by minute reconciliation, leased only by its deterministic Container,
  verified the 3,771,733-byte SPZ input, and completed once in 37,611 ms
- that staging job registered an 8,340,144-byte Spark quality RAD, a real
  499,413-byte Spark-rendered PNG poster, and a 1,213-byte immutable JSON QA
  report; D1 records `SUCCEEDED`, one attempt, 100% progress, exact hashes, and
  zero error evidence
- the staging Container application is
  `a03e7d77-9ac4-44a7-be0d-36644b36600a`; the production Container application
  is `a03b9d84-fce7-4025-8987-cd69f0b1bf76`; both reference remote image digest
  `sha256:16276a0e452bcacd9dc253434faeb0ae731cb5b2736fa57dc60361f3bed74fa2`
- production application release `0a2daedc-d8da-45de-9516-ff1ace2a9654` and
  processor release `efe060a4-6a28-48e8-b243-87b8593437f9` passed health,
  static Studio security-header, independent-secret inventory, anonymous
  worker-authentication, and Queue topology smoke checks
- the 390 × 844 production Studio had no horizontal overflow; the public
  `playroom` reached `Spark 2.1.0 ready` without page or console errors and its
  private RAD LoD issued multiple authenticated HTTP `206` range responses

External boundary:

- Containers provide the Linux/CLI execution plane used here, not CUDA/GPU
  reconstruction
- account billing, concurrency, regional placement, cold-start latency, and
  real scanner-sized memory/runtime distributions require production
  observation before increasing the three-instance cap or per-input limit

## Milestone 20 — Vendor-neutral capture adapter ingestion

Status: `LIVE` in application production release
`d4915066-23c8-40cc-90a4-e85afaea2e30` and processor production release
`c66a103c-2cb1-4fd6-9aa9-c6a0787d9005`.

Outcome: an operator can preserve capture evidence from XGRIDS, FJD, phone,
drone, or open import workflows without sending non-Gaussian evidence into the
Spark reconstruction lane or misrepresenting file integrity as scene quality.

Implemented controls:

- a shared adapter registry defines supported purposes, formats, required
  evidence, known limitations, and default intake behavior for `xgrids-lcc`,
  `fjd-trion`, `phone-video`, `drone-imagery`, and `open-import`
- every multipart upload records an explicit purpose in D1 and keeps immutable
  bytes private in R2; recovery and idempotency require an exact purpose match
  as well as the original file identity
- only portable Gaussian masters create `asset.validate` Spark jobs;
  browser-ready RAD scenes and capture evidence create
  `asset.evidence-validate` jobs, so E57, LAS/LAZ, vendor projects, imagery,
  video, trajectories, calibration, and collision meshes cannot be
  accidentally reconstructed as splats
- the bounded evidence validator verifies source bytes, SHA-256, and a
  format-specific signature or parse boundary while explicitly reporting that
  it does not prove scanner origin, calibration, reconstruction quality,
  survey control, or professional accuracy
- verified evidence is classified as `source`, `pointcloud`, `collision`, or
  `web`; its zero-derivative QA report remains pending human evidence review
- the additive `capture_adapter_v2` migration preserves legacy adapter values
  while exposing the real `drone-imagery` adapter throughout projects,
  templates, and capture bundles
- Studio dynamically restricts formats by purpose, explains adapter-specific
  evidence requirements, keeps the selected local file immutable, and uses the
  established single-flight action contract for upload and authentication

Local acceptance evidence:

- red-green contract tests first failed on the absent adapter registry,
  unsupported drone import, unclassified evidence lane, and absent bounded
  validator before the implementation was added
- the complete release gate passed generated bindings, both TypeScript
  targets, action-state and control-wiring audits, production build, all 81
  Worker/domain tests across 17 files, plus production dry-runs for both
  Workers
- the control-wiring audit accounts for 102 static buttons, 77
  TypeScript-generated buttons, 18 static links, 7 generated links, and 28
  interactive forms

Release evidence:

- migration `0024_capture_adapter_ingestion.sql` was applied to isolated local,
  staging, and production D1 databases; production retains both legacy and V2
  adapter fields, records upload purpose, and has no foreign-key violations
- staging application release `7079bd07-81fd-4722-9c07-4e31efcb54b3` and
  processor release `c24f0f9d-ea94-431c-a557-f6e8b4aded41` completed a real
  Queue-to-Container evidence job for a 4,760-byte drone source-image ZIP
- staging D1 records that job as `SUCCEEDED` once, with processor
  `spatial-processor/0.4.0`, exact source bytes and SHA-256, zero derivative
  bytes, `PKZIP` signature evidence, and mandatory human review; the source
  asset is verified and the adapter reads as `drone-imagery`
- browser QA at 390 × 844 found no overflow or browser errors and proved an
  adversarial double-submit of the OTP action emitted one request, immediately
  disabled the action with `aria-busy` and `Sending code…`, then restored a
  verification action with the 60-second resend cooldown
- production application release `d4915066-23c8-40cc-90a4-e85afaea2e30` and
  processor release `c66a103c-2cb1-4fd6-9aa9-c6a0787d9005` passed health,
  static security-header, anonymous worker-authentication, mobile Studio, and
  public viewer smoke checks; the processor runs remote image digest
  `sha256:493300b5a797c49e46a652c38f47a9959dde0f2b68d73ec0978b2124ee00f1af`
- the public `playroom` release reached `Spark 2.1.0 ready`, generated
  authenticated HTTP `206` range traffic, and produced no page or console
  errors

External validation boundary:

- ingesting an XGRIDS/FJD project container does not mean the platform can
  decode or reconstruct it; native vendor parsing, GUI/CLI automation, GPU
  reconstruction, licence entitlements, and export availability require real
  vendor software and licensed scanner-origin samples
- the next external proof must register one licensed K1/LCC and one P2/Trion
  project, enumerate the actually exportable images, poses, calibration,
  trajectories, point clouds, and Gaussian masters, and compare reconstruction
  quality in the same delivery runtime

## Milestone 21 — Governed project metadata and workspace handoff

Status: `LIVE` in application production release
`2191c4f4-f74a-422c-b855-de2ffe63967c`.

Outcome: a platform administrator can define the metadata that every project in
their workspace must carry, and can copy selected canonical project metadata
directly into another workspace where they are also an administrator without
moving hidden binary or lifecycle state.

Implemented controls:

- organisation-scoped project fields support text, number, true/false, date,
  select, and URL values with immutable keys/types, optional required
  enforcement, stable ordering, activation lifecycle, and protection against
  removing select options still used by projects
- create and edit validate typed values server-side; project creation hashes the
  complete canonical request, including customer, adapter, delivery, notes, and
  custom fields, so changed reuse of an operation ID is rejected
- portable portfolio schema V2 carries active field definitions and values;
  preview detects missing definitions, incompatible key/type conflicts, and
  invalid values before an idempotent import creates any DRAFT records; V1
  manifests remain accepted
- direct handoff requires active `platform_admin` membership in both source and
  target workspaces, previews field/customer impact, creates target-scoped
  field definitions and DRAFT project copies, preserves the source unchanged,
  and writes an auditable, request-hashed terminal response safe to replay
- the contract and Studio both state the exclusion boundary: versions, R2
  assets, releases, processing jobs, reviews, and lifecycle authority never
  cross the workspace boundary
- Studio dynamically renders typed project inputs, exposes an administrator
  field manager, and makes handoff preview/commit unavailable until the
  selection and destination are valid

Acceptance evidence:

- migration `0025_project_custom_fields_handoffs.sql` was applied to isolated
  local, staging, and production D1 databases; production contains the request
  hash column and all three new tables with no foreign-key violations
- red-green Worker tests cover typed field creation, complete create-request
  idempotency, V2 export, direct handoff, exact replay, destination role
  denial, field-type conflict rejection, copied values, and unchanged source
  state
- the complete release gate passed generated bindings, both TypeScript
  targets, action-state and control-wiring audits, production build, all 83
  Worker/domain tests across 18 files, and a production deployment dry-run
- the control-wiring audit accounts for 106 static buttons, 79
  TypeScript-generated buttons, 18 static links, 7 generated links, and 29
  interactive forms
- authenticated real-browser staging QA ran on code release
  `95609027-c91c-42a6-9e19-81a1afeedba5` followed by staging-only signing-key
  rotation `4df4c5bf-65da-4ad7-81c9-156bda2dccd1`: an injected `503` restored
  the field form and succeeded on deliberate retry, while project creation and
  handoff preview/commit held their pending labels and disabled every
  conflicting control
- staging D1 records one source and one target DRAFT project with the same typed
  value, a completed persistent handoff ledger, unchanged source identity, and
  no foreign-key violations; the short-lived QA session was revoked after
  verification
- production release `2191c4f4-f74a-422c-b855-de2ffe63967c` serves the landing
  page, Studio, public Spark scene, anonymous session boundary, protected field
  endpoint, and cached JWKS with security headers and no browser page or console
  errors

Boundary:

- direct handoff remains the fast metadata-only path. Milestone 24 adds a
  separately governed asset-bearing copy path; neither path is a move, disaster
  recovery, or transfer of publication, review, identity, billing, or
  processing authority.

## Milestone 22 — Scoped capture-agent credentials and unattended transfer

Status: `LIVE` in application production release
`8e6576c5-18d8-4efa-a28d-36859b0781e3`.

Outcome: after a vendor export has been packaged, an administrator can issue a
short-lived or dated, project-scoped credential to a capture workstation and
the workstation can transfer exactly one immutable artifact through the same
verified multipart intake path as an interactive operator without receiving a
human session or broad workspace authority.

Implemented controls:

- capture-agent credentials are organisation-scoped, project-assigned,
  generation-versioned, expiry-aware, hash-only at rest, and reveal the bearer
  token only on issue or rotation
- creation and rotation use a stable client operation ID plus canonical request
  hash, so a transport retry returns the original one-time token while changed
  reuse is rejected; scope updates are explicit and revocation is immediate
- the service bearer can list only assigned active projects and can call only
  the bounded multipart-upload surface; it cannot use Studio, administer
  members, alter project metadata, publish, review, or access another project
- machine requests authenticate without browser `Origin`, while browser
  sessions retain the existing origin and CSRF boundary; upload and version
  provenance record the capture credential and audit entries deliberately use
  a null human actor with a capture-agent event prefix
- each upload persists its own part size. Existing open sessions preserve their
  original 25 MiB boundaries while new capture-agent sessions use 10 MiB
  boundaries, so recovery does not silently reinterpret already uploaded parts
- the local transfer agent accepts a strict single-artifact manifest, waits for
  stable files, verifies full SHA-256, validates project and adapter identity,
  derives deterministic operation IDs, reconciles remote multipart state, and
  writes atomic local checkpoints and a terminal receipt without deleting the
  source export
- only network failures and HTTP `408`, `425`, `429`, or `5xx` responses retry;
  authentication, authorization, validation, and changed-request conflicts stop
  for operator intervention
- Studio provides administrator create, edit-scope, rotate, copy, and revoke
  journeys with action-specific pending labels, `aria-busy`, retained inline
  errors, deliberate retry, and no duplicate submission

Acceptance evidence:

- migrations `0026_capture_agent_credentials.sql` and
  `0027_upload_part_size.sql` were applied to isolated local, staging, and
  production D1 databases with no foreign-key violations
- red-green Worker tests cover safe create and rotation replay, changed-request
  conflict, token non-disclosure in lists, assignment enforcement, authenticated
  upload/recovery/completion, D1 provenance, scope edit, expiry, revocation, and
  null-human audit records; transfer-agent unit tests cover manifest contracts,
  part calculation, deterministic operations, checkpoint recovery, and terminal
  versus retryable failures
- the complete release gate passed generated bindings, both TypeScript targets,
  production build, deployment dry-run, all 90 tests across 20 files, and action
  audits accounting for 112 static buttons, 82 generated buttons, 18 static
  links, 7 generated links, and 30 forms
- authenticated staging browser QA injected a `503` during credential creation:
  the disabled `Creating token…` state recovered with the entered form retained,
  deliberate retry issued one token, scope editing succeeded, rotation held
  `Rotating token…` and produced generation 2, and revocation held `Revoking…`
  before the bearer immediately returned `401`
- staging application release `f51b56fc-fcbb-47ab-96bb-79c144014ed6`
  completed real 31 MiB transfers through a persisted open multipart checkpoint
  and exact part reconciliation, then completed an 11 MiB transfer using the new
  10 MiB plus 1 MiB boundary; D1 records verified evidence, successful
  `asset.evidence-validate` jobs, matching upload/version credential provenance,
  and null human audit actors
- production release `8e6576c5-18d8-4efa-a28d-36859b0781e3` serves the
  landing page, Studio, health endpoint, cached JWKS, and anonymous credential
  boundary with the expected security headers; both capture-agent endpoints
  reject anonymous requests with `401`
- the production public `playroom` accessibility snapshot shows the Spark 2.1
  canvas, one authored walkable region, RAD release metadata, and host status
  `Spark 2.1.0 ready`

Boundary:

- this milestone begins after a vendor-native GUI or supported export tool has
  produced one immutable packaged artifact. It does not control a scanner,
  monitor live coverage, automate proprietary reconstruction software, prove
  vendor licence entitlements, or decode native vendor projects.

## Milestone 23 — Reviewed point-cloud semantic candidates

Status: `LIVE` in application production release
`6cfb3be0-008a-4c9c-a206-5a6e0bfb2a81` and processor production release
`93259b27-63b2-4a03-9fad-b7e80967d34f`.

Outcome: an operator can turn one verified, registered Y-up metric PLY into
bounded walkable polygon candidates, inspect each candidate, and explicitly
accept selected polygons as editable room seeds or reject the whole extraction
without allowing a machine result to silently become authored structure.

Implemented controls:

- a request-hashed, replay-safe operator endpoint binds the exact project,
  immutable version, verified source/master/point-cloud PLY, registered-frame
  assertion, registration evidence, grid, floor band, minimum area, candidate
  cap, sampling cap, and optional elevation hint
- `semantic.extract-v1` uses the existing Queue, Cloudflare Container,
  exact-job lease, heartbeat, private download, immutable output upload,
  classified failure, retry, cancellation, and reconciliation contracts
- deterministic extraction identifies credible horizontal support layers,
  chooses the lower layer by default, traces connected occupancy boundaries,
  preserves concave outlines, bounds candidate count, and fails closed when no
  credible horizontal support exists
- completion re-verifies the server parameters, exact source bytes/hash,
  candidate identity, polygon validity, elevation, computed area, report path,
  immutable report bytes, and one-use active lease before D1/R2 persistence
- candidates remain `pending` machine evidence. A separately idempotent
  human-review operation can accept selected candidates or reject all; accepted
  candidates create one editable floor grouping and editable room polygons
  with explicit provenance, while replay cannot duplicate entities
- accepted polygon rooms are ear-clipped into navigation triangles, including
  concave outlines; collision remains a conservative AABB proxy
- Studio exposes eligible-asset selection, bounded parameters, registration
  evidence, queued/progress/failure cards, refresh, retry, guarded cancel,
  candidate selection, accept-selected/reject-all, and evidence notes with the
  shared single-flight pending/error/retry contract
- every surface states that the output is an occupancy-derived editable proxy,
  not walls, legal-room classification, certified area, accessibility,
  calibration, control, or survey evidence

Acceptance evidence:

- migration `0028_semantic_extraction.sql` is applied to isolated local,
  staging, and production D1; both remote databases have no foreign-key
  violations
- red-green domain and Worker tests cover lower-floor selection over ceilings,
  L-shaped polygon preservation, vertical-only fail-closed behavior, exact
  create replay, worker lease/completion, immutable report/candidate
  persistence, human acceptance, exact review replay, duplicate prevention,
  and polygonal navmesh area
- the complete release gate passed generated bindings, both TypeScript targets,
  production build, deployment dry-run, all 94 tests across 22 files, and
  action audits accounting for 116 static buttons, 87 generated buttons, 18
  static links, 7 generated links, and 32 forms
- staging application release `d93711a5-77bc-4412-8c4e-0f20073abb58` and
  processor release `099a3e4c-5f3b-45c5-8a5a-a7cb59e89def` completed real job
  `88888888-0000-4000-8000-000000000026` through minute reconciliation,
  Queue, and Container exactly once
- that job used processor `spatial-processor/0.5.0`, verified the exact
  1,253-byte PLY and SHA-256, wrote a 2,341-byte verified immutable R2 report,
  and persisted one 12 m², 95%-confidence pending rectangle at elevation zero;
  the report retains the explicit four-part limitation set and
  human-review-required flag
- the processor Container image digest is
  `sha256:c4d742c6d15108756d088bdbc7ba0fb197ebc0f7ebf0d2f7f992b92515dfecaa`
- live staging-code browser QA injected separate `503` failures into queue and
  review calls: double clicks emitted one request, all conflicting controls
  entered the exact pending label plus `aria-busy`, every field and candidate
  choice survived recovery, reject-all visibly cleared acceptance, and the
  390 × 844 layout had no overflow or browser errors; the screenshot is
  `artifacts/qa/m23-semantic-extraction-staging.png`
- production health, processor `0.5.0` health, static security headers,
  migration presence, empty initial semantic tables, anonymous operator `401`,
  anonymous worker `401`, and D1 foreign-key checks passed after promotion

Boundary:

- the browser QA uses live staging assets with deterministic API fixtures to
  test failure/action recovery because no staging human session was reused; the
  real Queue/Container/R2/D1 proof is separately recorded above
- the algorithm currently extracts horizontal walkable candidates from one
  registered PLY. Licensed K1/P2 threshold validation, multi-level circulation,
  doorways, stairs/ramps, wall inference, and measured floor-plan production
  remain distinct validation or specialist-processing work

## Milestone 24 — Asset-bearing cross-organisation project copy

Status: `LIVE` in application production release
`c5c670a0-dbc3-4144-8c60-accbc80e3535`.

Outcome: an administrator who is active in both organisations can copy one
project, its immutable scene versions, and its verified R2 assets into the
destination organisation without changing the source or transferring hidden
publication, processing, review, identity, billing, or lifecycle authority.

Implemented controls:

- a read-only preview snapshots the canonical project metadata, typed fields,
  up to 10 versions, up to 50 verified non-deleted assets, and at most 100 GiB,
  then binds the exact inventory to a SHA-256 snapshot hash
- commit rechecks the snapshot, pre-allocates new destination project/version/
  asset IDs and object keys, persists a request-hashed operation, and sends one
  Queue message per asset without exposing a partial destination project
- the consumer streams source R2 bytes directly into a new destination object,
  supplies the recorded SHA-256 to R2, verifies destination size and checksum,
  and safely recognizes duplicate delivery of an already verified object
- finalization inserts the copied project, versions, assets, custom-field
  mappings, and audit evidence only after every object is verified; the copied
  project and versions deliberately return to `INGESTED`
- failed items retain copied progress and expose deliberate retry; cancellation
  first wins in D1, then removes every pre-allocated object and prevents an
  in-flight worker from publishing a destination project
- minute reconciliation re-enqueues only dispatchable queued items, recovering
  a lost producer send without reviving terminal operations
- Studio provides destination selection, exact preview totals/exclusions,
  confirmed start, durable progress, refresh, retry, and guarded cancel with
  action-specific pending labels, `aria-busy`, retained context, and inline
  recovery

Acceptance evidence:

- migration `0029_asset_bearing_handoffs.sql` is applied to isolated local,
  staging, and production D1 databases
- red-green Worker tests cover changed snapshots, exact replay, destination
  authorization, duplicate delivery, checksum enforcement, partial retry,
  cancellation cleanup, terminal finalization, and scheduled reconciliation
- the serial full release gate passes both TypeScript targets, the production
  build, all 98 tests across 23 files, action-state audit, control-wiring audit,
  and production dry-run
- live staging operation `24242424-0000-4000-8000-000000000001` copied one
  4,760-byte source object through the minute scheduler and Queue on its first
  attempt, created one new `INGESTED` target project, left the source unchanged,
  and copied zero jobs, releases, or reviews
- independent source and destination downloads both produced SHA-256
  `657561af5829f87c42c80f9a8586adbc3c29d0702ea5155e6a0dd39dabc1f17f`
- 390 × 844 live staging browser QA proved single-flight preview/start/retry/
  cancel, safe automatic GET retries, retained target and operation identity,
  no overflow, and that background progress polling cannot erase a visible
  action failure; the screenshot is
  `artifacts/qa/m24-asset-handoff-staging.png`
- production health, anonymous auth boundary, custom-domain routing, Queue
  bindings, and security headers passed after deployment

Boundary:

- this is a copy, not a move. The source remains authoritative and unchanged
- no upload sessions, jobs, leases, QA, approvals, reviews, releases, access
  tokens, telemetry, capture credentials, memberships, identity providers,
  themes, domains, subscriptions, invoices, retention authority, or
  professional measurement claims cross the organisation boundary
- larger portfolios, resumable cross-account/object-store migration, disaster
  recovery, and destructive source retirement require separately designed
  products

## Milestone 25 — Verified structural Walk + Fly navigation

Status: `LIVE` in the public Home Scan multi-room release.

Outcome: a Gaussian splat can be explored like a game scene without pretending
that splat density is collision geometry or flattening movement into a 2D
furniture-obstacle problem.

Implemented controls:

- an `authored-structural-collision-v2` contract keeps reviewed floors, walls,
  ceilings, dynamic doors, furniture groups, and triggers distinct
- the processor builds Recast/Detour topology from the reviewed shell and emits
  content-addressed JSON validation plus Detour binary derivatives
- the release freezes its authoring hash, agent profile, artifact IDs, hashes,
  byte sizes, validation evidence, and operator approval
- the browser loads the same shell into Rapier and drives a grounded capsule in
  Walk mode or a no-gravity collision sphere in Fly mode
- furniture can be excluded from the public movement profiles while walls,
  ceilings, floors, and closed doors remain blocking
- desktop arrow/WASD controls, Shift speed boost, Fly altitude keys, and mobile
  movement/altitude controls share one collision runtime
- the floor plan, room routes, runtime topology, and published scene all bind to
  the same immutable navigation build

Acceptance evidence:

- every published room anchor is enclosed in six directions by the reviewed
  shell
- both-direction Walk-capsule and Fly-sphere sweeps cover every reviewed wall
- capsule corner-slide probes reject penetration while preserving traversal
- every room route replays in both directions, and every dynamic door is proven
  open/passable and closed/blocked in both Rapier and Detour
- stale, missing, disconnected, or hash-mismatched navigation evidence blocks
  movement-enabled publication
- the public Home Scan release exposes four connected rooms, reviewed collision,
  Walk/Fly modes, a live floor plan, and no public Noclip mode

Boundary: the Home Scan visual and shell use provisional scene units. They are
interaction evidence, not survey, clearance, accessibility, or construction
measurements. Metric claims still require a separately measured scene version.

## Delivery discipline

Every milestone is released in vertical slices:

1. define the public UI/API seam and acceptance evidence
2. add a failing Worker or browser contract
3. implement the smallest end-to-end journey
4. run typecheck, build, Worker tests, deployment dry-run, and browser QA
5. migrate staging, deploy staging, smoke test
6. migrate production, deploy production, smoke test and record the Worker
   version

No roadmap item is presented as clickable UI before its journey is implemented.
Future roadmap items remain documented rather than rendered as dead controls.
