# Spatial Studio architecture

## Production objective

An authenticated production operator can create a project, ingest a
browser-ready or convertible 3DGS asset, validate it, approve it, and publish an
immutable public/private release. The release can be semantically authored,
reviewed by a least-privilege customer, navigated in-browser, retained or
expired under policy, observed, revoked, or rolled back without mutating source
data.

## Runtime

```text
Browser
  |-- Studio UI -----------------------\
  |-- Published viewer ----------------+--> Cloudflare Worker (Hono)
  |-- Bundled Spark 2.x renderer ------/       |
                                                |-- D1 control plane
                                                |-- private R2 assets
                                                |-- KV ephemeral throttles
                                                |-- Email Sending binding
                                                |-- enterprise OIDC providers
                                                |-- static asset binding
                                                |-- hourly lifecycle trigger
                                                |-- processing dispatch Queue
                                                |       |
                                                |       v
                                                | Cloudflare Container
                                                | (pinned Spark + Chromium)
                                                \-- privacy + portfolio-copy
                                                    Queues

Local/cloud processing agent
  |-- bearer authentication
  |-- lease / heartbeat / complete / fail
  |-- exact dual-input registered-scene evidence
  |-- writes version-scoped R2 derivatives
  \-------------------------------------------> Worker job API

Capture export workstation
  |-- project-scoped expiring bearer credential
  |-- stable-file/hash validation
  |-- D1/R2 multipart checkpoint reconciliation
  |-- atomic local checkpoint and completion receipt
  \-------------------------------------------> Worker upload API
```

Workers owns authentication, tenancy, state transitions, release authorization,
and object delivery. CPU conversion, deterministic raw-scene registration, and
poster rendering run in a replaceable Cloudflare Container or compatible
external agent, never in a request handler. GPU reconstruction remains behind
the adapter boundary because Cloudflare Containers do not expose a CUDA/GPU
instance.

## Trust boundaries

1. Operator browser
   - signs in with a single-use email OTP or a tenant-bound OIDC
     authorization-code + PKCE flow
   - uses a five-minute ES256 JWT and rotating opaque refresh cookie
   - every JWT request is checked against the authoritative D1 session
   - all mutations require an authenticated operator and same-origin request
   - team membership has `invited`, `active`, and `revoked` lifecycle states;
     only active membership can create or use a session
   - one user may hold active memberships in several organisations, but every
     session binds exactly one active tenant and role
   - switching organisations verifies the target membership, issues fresh
     credentials, revokes the prior session, and forces the client to discard
     tenant-scoped workspace state before reloading
   - platform-admin-only role changes and revocations terminate every target
     session, while last-admin and self-removal guards preserve recoverability
   - OIDC client secrets remain Worker secrets; D1 stores only provider
     metadata, encrypted single-use login attempts, subject links, and session
     provenance
   - OIDC account linking requires an existing active membership or live
     invitation in the exact configured tenant; an allowed domain is never an
     auto-provisioning rule
   - provider disable revokes its sessions, and OIDC-authenticated sessions
     cannot switch to another organisation
2. Processing agent
   - uses a separate bearer secret
   - a dispatch Queue carries only an exact processing-job UUID
   - every cloud container is named and leased for that exact job; it cannot
     claim unrelated queued work
   - a minute reconciliation trigger re-enqueues queued or expired leased jobs,
     so a lost Queue notification or stopped container does not orphan work
   - receives an expiring, hashed job lease
   - may register outputs only under its organisation/project/version prefix
   - the Worker verifies every output exists in R2 before recording it
   - receives no D1, R2, KV, JWT, email, Stripe, or OIDC credential
3. Capture transfer agent
   - an administrator issues a credential for one or more exact projects; D1
     stores only a peppered verifier, generation, expiry, assignment, and
     last-use evidence
   - the plaintext token is returned only for create/rotate and an old
     generation fails immediately after rotation; revocation is terminal
   - bearer requests may originate from a non-browser workstation but can only
     inventory assigned projects and use upload create/open/part/complete/abort
     routes for those projects
   - each upload and immutable scene version records the credential identity;
     audit events identify the agent with a null human actor
   - the agent receives no D1, R2, KV, JWT-signing, email, billing, OIDC, or
     processing-worker secret and cannot publish, approve, or alter metadata
4. Published viewer
   - receives no R2 credentials or raw object keys
   - exchanges release access for a short-lived HMAC scene session
   - reads only assets bound to the active immutable release
   - receives collision, route, room, POI, and adaptive-delivery metadata from
     the immutable release manifest
5. Storage
   - raw, master, and delivery objects live in a private R2 bucket
   - D1 stores authoritative metadata, auth, and state, not 3DGS binaries
   - KV stores only expiring, non-authoritative throttling/cache hints
6. Payment provider
   - the browser is redirected only to a Stripe-hosted Checkout Session
   - D1 stores checkout, event, subscription, and invoice evidence, never card
     numbers or payment credentials
   - Checkout return URLs are informational; only a verified raw-body webhook
     may activate hosting
   - provider event IDs and payload hashes make delivery idempotent and expose
     conflicting replays
   - a paid invoice must match the recorded checkout amount and currency and
     supply its service period before the entitlement is written
   - cancellation is provider-first; a failed provider call cannot create a
     false local cancellation
7. Enterprise identity provider
   - issuer metadata, token responses, and JWKS are size/time bounded and
     redirects plus obvious local/numeric hosts are rejected
   - ID token signature, issuer, audience, authorized party, time claims,
     nonce, verified email, allowed domain, and requested email are all checked
   - browser state binding and atomic D1 attempt consumption prevent callback
     replay and login CSRF

## State model

```text
DRAFT -> UPLOADING -> INGESTED -> PROCESSING
  -> QA_REQUIRED -> APPROVED -> PUBLISHED

Failure states:
UPLOAD_FAILED | PROCESSING_FAILED | QA_REJECTED | REVOKED
```

Each upload creates a new `scene_version`. Existing versions and releases are
not overwritten. Scene versions expose a project-local numeric version and
releases expose a separate project-local numeric revision; UUIDs remain
internal identity and foreign keys. Publishing an output identical to the
active non-token release returns that release instead of manufacturing a
duplicate history row. `release_channels` provide stable slugs that point to
one immutable release, enabling rollback without rebuilding an asset.
Archived projects remain recoverable through the explicit Archived filter;
their jobs and releases are omitted from current operational inventories.

Portfolio lifecycle mutations use `project_bulk_operations` as an idempotency
ledger. The canonical action and sorted project ID set are SHA-256 hashed and
bound to a client operation ID. A replay returns the persisted terminal
response; reuse with different input is rejected. Each project is changed with
an atomic conditional update, so an active release, non-terminal job, or open
upload cannot race past the archive guard. Partial results preserve the exact
blocked reason without rolling back unrelated safe changes.

Portfolio setup is also D1-authoritative. `project_templates` stores
organisation-scoped reusable creation defaults, while `project_saved_views`
stores each operator's normalized filters and single default view.
`project_portfolio_imports` is an idempotency/evidence ledger: the canonical
manifest is hashed and bound to an operation ID, and the persisted terminal
response is returned on safe replay. Import always creates new tenant-scoped
`DRAFT` projects with new IDs and slugs; it cannot import releases, assets,
memberships, billing state, or project lifecycle authority.

Portfolio export is a bounded metadata response generated from D1 and downloaded
explicitly by the browser. Export files and import manifests are not stored in
R2 or KV. R2 remains the binary/object plane, and KV remains non-authoritative
ephemeral throttling/cache state.

`project_custom_field_definitions` is the organisation-owned project schema;
`project_custom_field_values` stores typed JSON values against tenant-scoped
projects. Field key and type are immutable, while labels, descriptions,
required status, ordering, options, and activation can evolve under
administrator control. Project creation hashes the complete normalized request,
including custom values, so an operation ID cannot silently replay different
customer or metadata content.

`project_portfolio_handoffs` is the direct cross-organisation idempotency and
evidence ledger. The caller must hold active `platform_admin` membership in
both organisations. Preview is read-only; commit hashes the sorted source
project set and destination, creates new target-scoped DRAFT metadata, and
persists the terminal response. It copies customer identity, active field
definitions, and values only. Immutable versions, R2 objects, releases, jobs,
reviews, subscriptions, and source lifecycle authority remain in the source
organisation by contract.

Asset-bearing copy uses a separate D1-authoritative workflow:
`project_asset_handoffs` stores the source snapshot, request hash, destination
identity plan, progress, and terminal state; `project_asset_handoff_versions`
and `project_asset_handoff_items` store exact source-to-destination mappings and
per-object attempts. One `PORTFOLIO_COPY_QUEUE` message streams one verified
source R2 object into a new destination key. The destination project and its
new immutable D1 version/asset records do not become visible until every object
has matching size and SHA-256. A scheduled reconciliation pass recovers lost
producer sends, retry addresses only incomplete items, and cancellation removes
pre-allocated objects before it can become terminal. This lane never copies
releases, jobs, reviews, auth, billing, or source lifecycle authority.

## Storage layout

```text
raw-private/{org}/{project}/{version}/{asset}/{file}
masters-private/{org}/{project}/{version}/{...}
delivery-private/{org}/{project}/{version}/{...}
reports-private/{org}/{project}/{version}/{...}
```

Direct browser uploads create `source` assets under `raw-private`. Processing
agents upload derivatives under the other version-scoped prefixes. Capture
transfer agents use the same source-upload API and R2 prefixes, so browser and
unattended uploads share immutable-byte, ETag, integrity, and lifecycle
controls rather than creating a second storage path.

Each upload session persists its part size. Existing 25 MiB sessions retain
their original byte boundaries across releases; new source uploads use 10 MiB
parts to bound retry cost and request duration without changing R2 multipart
integrity.

Spark RAD releases use the same private R2 bucket as compact SPZ and SOG
releases. Protected delivery uses short-lived signed URLs and private caching.
Public delivery uses a stable release-and-asset URL, a one-year immutable
per-edge cache policy, and Cloudflare's Cache API keyed by immutable asset ETag;
browsers retain the same 30-minute ceiling as protected delivery, and the
Worker verifies that the release is still the live channel before every edge
cache lookup.
Both paths support HTTP Range requests, allowing Spark to page LoD chunks
without exposing an R2 credential or object key. Renderer progress is
open-ended: the viewer reports Spark progress and explicit errors but does not
turn a slow download into a synthetic absolute-timeout failure.

## Product data branches

The scene version is the immutable join point for four separate branches:

```text
scene_version
  |-- visual asset ----------> Spark release in private R2
  |-- semantic structure ----> floors / rooms / doorways / POIs / routes
  |-- semantic candidates ---> registered PLY / polygons / human disposition
  |-- change evidence -------> authored geometry metrics / XZ overlay / review
  |-- raw change evidence ---> registered PLY occupancy / centroid / colour / review
  |-- capture evidence ------> private pose path / room coverage / recapture review
  |-- capture contract ------> verified assets / rights / portability / review
  |-- review evidence -------> comments / redactions / decisions / invitations
  |-- privacy evidence ------> scans / private frames / candidates / decisions
  \-- measurement evidence --> brief / check points / residual QA / sign-off
```

Semantic entities are vendor-neutral D1 records. Authored room/floor boxes or
concave polygons and doorway connectors compile into a triangulated walkable
surface used for spawn projection, routes, reachability, and the floor plan.
V7 releases additionally bind an explicit, reviewed structural shell with
classified floors, walls, ceilings, active doors, furniture, and triggers.
Player collision includes structural classes and excludes furniture for the
current demo profile; no wall is inferred from a floor boundary. The frozen
movement profile records input, shape, gravity, filters, speed, and recovery
bounds independently from the Detour topology.

Every new release freezes the exact semantic entities, routes, stops, navigation
mesh, obstacles, navigation profile, approved navigation build, authoring hash,
and byte identity of both the JSON validation report and Detour binary into an
immutable spatial snapshot. Publication, rollback, and public-manifest delivery
fail closed when those navigation derivatives are missing or no longer match
their verified asset rows.
Legacy releases without a snapshot retain their historical live-query fallback.
After Spark reports scene readiness, the host sends the frozen runtime to the
renderer by same-origin message. Legacy v6 movement remains constrained by the
Detour surface and authored obstacles. V7 keyboard movement instead drives a
Rapier capsule in Walk mode or a no-gravity sphere in Fly mode directly against
the structural shell; Detour remains authoritative for topology and guided
routes. Room moves use a request/acknowledgement message so rejected cameras
leave the host control recoverable. The Gaussian asset remains a visual layer;
the platform does not infer collision or measurement accuracy from it.

Before a v7 build can be reviewed, the processor proves all authored anchors
are enclosed by floor, ceiling, and walls; runs both-direction Walk-capsule and
Fly-sphere sweeps for every reviewed wall; runs capsule corner-slide probes;
replays every room route in both directions; and validates every dynamic door
as open/passable and closed/blocked in both Rapier and Detour. Walk and Fly are
the only public modes. The frozen Noclip profile is explicitly operator-only,
has no collision groups, and exists for diagnostics rather than visitor use.

Point-cloud semantic extraction is a separate evidence-first processing lane.
D1 binds one immutable version, one verified source/master/point-cloud PLY, an
explicit source-to-world transform, bounded grid/floor-band/sample parameters,
job state, candidate rows, and the terminal human decision. The transform
declares the source up axis, world unit, world units per source unit, yaw,
translation, and alignment evidence. The world unit is either reviewed metric
metres or explicitly provisional scene units (`SU`); metric scale is never
inferred. The leased processor downloads and verifies the exact bytes,
normalizes them into canonical Y-up world coordinates,
detects credible horizontal support layers, selects the lower layer unless an
operator supplies an elevation hint, traces connected occupancy into polygons,
and writes the full report to private R2. Machine candidates never create scene
entities. `accept_selected` creates an editable floor grouping and room
polygons; `reject_all` preserves the evidence without authored geometry.

A release may apply a source-to-world transform only when it cites a reviewed,
accepted semantic extraction whose transform is an exact match. The navigation
profile, semantic candidates, accepted entities, and navigation obstacles all
carry immutable unit provenance and must use the same world unit. Once geometry
exists, changing the navigation profile cannot relabel its coordinates; a
metric conversion requires a new scene version and new extraction or
re-authoring. Provisional releases remain explorable, but expose `SU` in Studio
and the published viewer and use a platform-authored, non-editable warning that
makes no metre, area, clearance, survey, construction, or accessibility claim.
Metric-only authored-geometry change and pose-path coverage evidence is blocked
for provisional versions, as are measurement briefs, millimetre QA, and metric
deliverable generation. Operators can edit concave walkable polygons, author
doorway connectors, obstacle boxes, and the agent profile before publication.
Furniture, ceilings, sparse floors, stairs, glass, and overlapping levels
remain explicit limitations; this is not automatic wall or object extraction,
legal-room classification, area certification, accessibility certification, or
survey evidence.

Authored geometry change evidence is a separate, deliberately bounded lane.
The operator selects two immutable versions, declares how they share a Y-up
coordinate frame, and supplies registration evidence. The Worker matches
unambiguous floor, room, and doorway labels, then computes XZ footprint
centroid displacement, symmetric discrete boundary deviation, vertical extent
deviation, area delta, threshold classification, and an XZ overlay. Invalid
geometry or duplicate semantic keys blocks a metric conclusion instead of
guessing correspondence. D1 stores the method, source-geometry hash,
registration assertion, immutable operation response, and human disposition.
This authored-geometry lane is not raw point-cloud registration or a survey
result.

Registered raw-scene comparison is a separate processing-agent lane. D1 binds
the exact baseline/candidate versions and verified source/master/point-cloud
PLY assets, declared coordinate assurance, thresholds, job state, immutable
report asset, and human disposition. The leased agent downloads both inputs
through role-scoped URLs, verifies their recorded byte size and SHA-256,
and constructs deterministically sampled voxel signatures. In automatic mode,
the agent searches bounded 30-degree yaw seeds and refines yaw plus XYZ
translation against a maximum 10,000-voxel deterministic registration sample.
Scale and the gravity axis are never changed. Declared minimum overlap, maximum
RMSE, and solution-ambiguity gates must all pass before the transformed
candidate can enter occupancy, centroid, and mean-colour comparison. A blocked
registration is preserved as an immutable report and change analysis does not
run. In declared mode the prior shared-frame workflow remains available. Each
input is capped before download by the processor's configured in-memory limit.
The transform is evidence for human review—not full six-degree-of-freedom,
control-point, or survey registration. Repetitive geometry, scene change,
sampling, drift, and colour/exposure differences remain explicit limitations.

Capture completeness uses a canonical, bounded Y-up pose-path contract rather
than a scanner-specific project format. The Worker verifies that the declared
adapter matches the project, stores the exact source JSON as an immutable
private R2 `report` asset, and keeps only its hash, thresholds, bounded XZ
visual evidence, result, and human disposition in D1. Coverage is sampled over
authored room footprints using a declared pose radius. Large sample gaps,
uncovered rooms, invalid room geometry, partial/non-monotonic timestamps, and
an open endpoint loop remain explicit evidence. The result can recommend a
recapture; it does not prove image sharpness, exposure, occlusion coverage,
SLAM correctness, or final reconstruction quality.

Capture-bundle manifests define the normalisation boundary before any
vendor-specific reconstruction adapter. D1 binds the project adapter, exact
immutable version, request hash/idempotency, readiness result, manifest hash,
and human disposition. The full canonical manifest is a private, verified R2
`report` asset and resolves every declared role to the stored asset kind,
format, byte length, and SHA-256. The validator reports browser-renderable,
metric-ready, portable-reconstruction, independently-reconstructable, and
automation-ready capabilities separately. Commercial use, self-hosting, and
derived redistribution must each be explicitly confirmed. This is evidence of
what an operator registered and the platform preserved; it does not prove
scanner origin, calibration accuracy, reconstruction quality, or the truth of
vendor licence terms.

Reviewer comments and decisions always reference an immutable version.
Redaction feedback creates a privacy-region candidate that an operator must
approve or reject before it is treated as applied evidence.

Automated privacy detection is a separate evidence lane. D1 is authoritative
for scan state, idempotency, detector/version metadata, candidates, and human
decisions. Verified poster bytes remain private in R2. A queue message contains
only the scan ID; the consumer re-authorizes the D1/R2 inputs, invokes Workers
AI for six bounded targets, normalizes/deduplicates returned boxes, and writes
evidence before completing the run. Queue retries are bounded and feed an
environment-specific dead-letter queue. Neither a model candidate nor a clean
model result can approve publication. The QA gate requires a completed latest
scan and human resolution of all automated and authored privacy blockers.

Measurement briefs state intended use, exclusions, units, tolerance, and
reliance class. Reference/observed check points produce residual statistics.
Professional certification cannot be recorded without passing evidence and a
separate licensed-professional sign-off record.

## Processing-agent contract

1. `POST /api/worker/jobs/lease`
2. download the immutable input through
   `GET /api/worker/jobs/{id}/input` with the lease token; registered-scene
   jobs additionally receive and download one exact candidate input
3. `POST /api/worker/jobs/{id}/heartbeat`
4. upload each derivative with lease-scoped direct or multipart output routes
5. `POST /api/worker/jobs/{id}/complete` with hashes, bytes, tool versions, and
   duration evidence, or the stricter registered-scene completion route with
   exact dual-input byte evidence and the declared comparison method
6. on error, `POST /api/worker/jobs/{id}/fail` with a stable failure class

Expired leases can be reclaimed. Attempts are bounded; terminal failures become
`FAILED` or `DEAD_LETTER`. Completion verifies lease ownership and R2 output
existence, checks input/output byte evidence, and atomically moves the version
to `QA_REQUIRED`. Operators can cancel active work or retry terminal failures
without creating duplicate assets.

The shipped agent pins the official Spark 2.1.0 `build-lod` implementation and
uses its quality LoD method for production RAD derivatives. It also renders a
real Spark poster and emits a machine-readable QA report. SplatTransform remains
the compatible interchange path, while PDAL/Open3D remain candidates for future
metric derivatives. The legacy v5 compatibility path separates visual
reconstruction from authored floor polygons, doorway connectors, obstacle
proxies, and an agent profile. The current v7 path binds a reviewed structural
shell, Rapier collision profiles, Detour topology, validation probes, and exact
derivative hashes to the immutable release snapshot. Rich automatic wall/object
geometry extraction remains behind the adapter boundary.

## Renderer and formats

- quality/archive master: Gaussian PLY
- compact web release: SPZ or SOG
- large web release: Spark RAD
- portable derivative: SPZ
- optional vendor derivative: LCC2

The viewer packages `@sparkjsdev/spark` and Three.js into the deployment. Spark
is the only scene renderer. Its iframe receives only an authorized release URL,
format, and device-aware splat budget, never an R2 credential. Spark requires
WebGL2 and reports progress, first-frame readiness, and failures to the release
shell through a same-origin message contract.

The authenticated comparison workspace requests two immutable version IDs and
receives fresh, short-lived renderables rather than stored public URLs. Each
renderable token is scoped to the exact project, version, asset, and filename;
the Worker revalidates the D1 relationship before serving private R2 bytes with
range support. Two isolated Spark iframes render the versions. The Studio
forwards validated same-origin camera poses between only those current frames,
while the renderer suppresses the synchronized pose from being broadcast back.
Approval decisions and comments come from immutable D1 history and are shown
beside the corresponding scene. This visual renderer remains a human review
aid; the separate authored-geometry report is the only automated comparison
currently claimed.

## Security properties

- tenant IDs are enforced in every operator-side project query
- release slugs are globally unique and cannot be reassigned across tenants or
  projects
- OTPs, refresh tokens, release tokens, and worker lease tokens are stored only
  as hashes
- access JWTs use ES256 with `kid`, issuer/audience/time validation, JWKS
  publication, overlapping signing-key rotation, and D1-backed revocation
- secrets are Cloudflare Worker secrets
- JSON request bodies are bounded
- upload part sizes and final byte counts are reconciled
- asset filenames are canonicalized and must match their declared Spark format
- comparison tokens cannot be replayed against a different project, version,
  asset, or filename and never expose an R2 object key
- CSP, permissions policy, frame policy, MIME sniffing protection, and
  structured audit events are enabled

## Lifecycle enforcement

The Worker scheduled handler runs at minute 17 of each hour and applies
authoritative D1 policy:

- expire reviewer invitations and dated releases
- mark hosting subscriptions past due or expired
- archive configured projects and revoke their active releases
- delete due R2 objects only when no legal hold applies
- preserve D1 tombstones and action records for every deletion
- send an operator digest and record notification success or failure

The manual lifecycle action uses the same implementation. A restore drill reads
a bounded range from a retained R2 object and records the result. This proves
that the application retrieval path works; it is not a claim that provider
backup restoration has been exercised.

Custom hostnames have a separate provider lifecycle. D1 remains authoritative
for the tenant/project binding and records DNS ownership, Cloudflare hostname
identity, provider routing state, SSL state, validation records, attempts, and
bounded error evidence. The Worker calls Cloudflare for SaaS only through the
provider adapter; TXT verification alone never changes a hostname to `active`.
At request time a customer host is accepted only when both Cloudflare hostname
and SSL status are active, and it may serve only the release channel bound to
that domain's project. The production zone/token/fallback-origin activation is
an external operations gate, not hidden application state.

The production merchant-billing lifecycle is administrator-operated and
fail-closed. Issuing an invoice creates an `open` manual invoice and a
`past_due` subscription. A payment-reference-required, idempotent compare-and-
set transition is the only manual path that changes that subscription to
`active`. Void, past-due, cancellation, and expiry transitions are state
guarded and audited; none can reactivate service.

The deferred Stripe path has a separate provider-evidence lifecycle. Creating a Checkout
Session writes only a pending/open D1 checkout record. The return redirect does
not create an invoice or subscription. A signature-verified `invoice.paid`
event must resolve to the exact recorded checkout, match its amount/currency,
and provide the service period before a D1 subscription becomes active and a
paid invoice is recorded. Payment failures and provider subscription changes
update an existing provider-backed record; they cannot create one. Every Stripe
event ID and payload hash is retained for idempotent replay and conflict
detection.

## Remaining production modules

The deployed platform is a secure ingest-to-release, review, spatial authoring,
privacy-evidence, measurement-evidence, and hosting-lifecycle product. Remaining
roadmap work requires either external evidence or deeper specialist processing:
scanner-native adapters and live coverage validation, multi-level circulation
and doorway/stair inference, licensed scanner floor-plan validation, paid DXF/CAD validation, enterprise
IdP onboarding, Stripe account/live-lifecycle activation, and production Cloudflare for SaaS account
activation with a live customer hostname.

The current measurement derivative is deliberately narrower than a Scan-to-BIM
claim. A passing QA report snapshots the canonical authored-room geometry hash.
The Worker emits a deterministic R12 DXF draft only while that hash is current,
stores the immutable bytes in private R2, records the QA report, generator,
asset hash, and source-geometry hash in D1, and serves the file only through a
tenant-scoped range-capable API. Any later geometry change makes the prior QA
stale for new generation; the already-issued artifact remains retrievable and
unchanged.
