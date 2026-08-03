# Spatial Studio

Spatial Studio is the production V0 of a device-neutral 3D Gaussian Splatting
post-capture platform. It turns a captured scene into an immutable, reviewed,
access-controlled browser release without exposing raw capture files.

- Production: <https://spatial.whymelabs.com>
- Studio: <https://spatial.whymelabs.com/studio.html>
- Public Walk + Fly multi-room release: <https://spatial.whymelabs.com/s/home-scan-spark-multi-room-demo>
- Staging: <https://spatial-studio-staging.swmengappdev.workers.dev>

## Implemented production path

```text
Portable FJD / XGRIDS / open Gaussian export
  + registered metric point cloud for device captures
  -> automatic project creation
  -> purpose/format-aware resumable multipart R2 upload
  -> bounded capture-evidence validation or Gaussian processing
  -> immutable scene version
  -> leased/idempotent processing job
  -> automatic metric floor-plan proposal
  -> automatic structural collision + Recast preview when captured shell evidence is complete
  -> short-lived authenticated private preview URL
  -> Spark 2.x renderer
  -> operator correction of generated levels / ceilings / rooms / openings / connectors
  -> recooked collision + Recast build bound to the approved floor-plan revision
  -> optional approval of generated scene / room / navigation data
  -> operator QA approval
  -> numbered immutable release revision
  -> stable public/private release channel
  -> short-lived scene session
  -> range-capable R2 delivery
  -> collision and navigation runtime
  -> queued automated privacy evidence
  -> mandatory human privacy disposition
  -> client review / synchronized immutable-version comparison
  -> approval / hosting lifecycle
  -> telemetry / revoke / rollback
```

The primary Studio journey is deliberately narrower than the full operations
surface: **Upload capture -> Process splat + floor plan + navigation -> Preview
-> Correct or approve generated drafts (optional for visual-only sharing) -> Publish**.
The Projects view is a portfolio only: clicking anywhere on a project row opens
its route-addressable `#project/{project-id}` workspace. Preview and publication
start from that page, while scene/navigation and measurement are nested project
sections rather than contextless global tabs. A Back to projects control returns
to the portfolio without leaving selected-project state hidden below the list.
Creating a project, selecting a delivery template, declaring a low-level asset
purpose, registering a capture contract, or manually starting floor-plan and
navigation jobs are not prerequisites for the first splat preview. The Studio
creates the project with safe defaults, automatically queues spatial drafts
from registered geometry, and exposes correction, QA, measurement, review,
hosting, and custom-domain modules only as post-preview or advanced operations.

XGRIDS and FJD intake requires both a portable Gaussian result (`PLY`, `SPZ`,
`SOG`, `SPLAT`, `KSPLAT`) or browser-ready Spark `RAD`, and a registered metric
point cloud (`PLY`, `E57`, `LAS`, `LAZ`, or `PTS`) for automatic floor-plan and
navigation generation. Native `XBIN`, `LCC`, and `FJDSLAM` projects can still be
preserved as private supporting evidence, but they cannot truthfully enter the
automatic preview lane without portable exports. A processed version can be opened before publication through
an authenticated, short-lived exact-asset preview session; public or customer
URLs still require privacy review and an explicit release.

Hardware qualification is currently **FJD first** because FJD is the first
capture device in the product rollout. The repository pins official P2 and V4e
sample identities and provides an on-demand private qualification lane; XGRIDS
sample integration is deliberately deferred until the FJD lane is complete.
The local FJD E2E never publishes or copies bytes to cloud storage: it deletes
its isolated Worker state after proving adapter, processor, private-preview,
range-streaming, and Chrome rendering behavior. A separate operator-authorized
production qualification stores the P2 sample privately with zero releases;
it is not a public demo and does not change the vendor-neutral production asset
contract.

The direct production path accepts browser-ready Spark `.rad`, `.spz`, and
`.sog` assets. Gaussian PLY and SPZ source assets can also be leased to the
production processing agent, which validates the source, builds a Spark RAD LoD
derivative, renders a poster, writes a QA report, and uploads the immutable
outputs through the Worker. The same lease lane can compare two explicitly
registered, verified PLY assets and retain bounded voxel-occupancy, centroid,
mean-colour, source-byte, method, and human-review evidence. It can also inspect
a verified PLY in either reviewed metric metres or explicitly provisional scene
units for bounded horizontal occupancy and propose polygonal walkable regions.
Provisional releases expose unit-neutral candidate values in `SU`, attach unit
provenance to accepted entities and obstacles, and use a mandatory
platform-authored non-measurement warning. All candidates remain machine
evidence until an operator explicitly accepts selected polygons as editable
room seeds; they are never survey, legal-room, area, clearance, construction,
or accessibility claims. Metric-only geometry-change and pose-path coverage
evidence stays unavailable until a new measured scene version is authored.
Measurement briefs, millimetre QA, and metric deliverables are blocked on the
same boundary. RAD is the preferred large-scene format because Spark can page
its prebuilt LoD tree directly through the range-capable R2 release endpoint.
Public releases use stable immutable asset URLs backed by browser and
Cloudflare edge caching. The browser cache remains bounded to 30 minutes while
the Worker checks the live channel before using its long-lived per-edge copy;
protected releases retain short-lived signed URLs and private caching.

## Platform boundaries

Implemented:

- Hono API on Cloudflare Workers
- generated Worker binding types and strict TypeScript
- isolated staging and production environments
- D1 tenant, project, version, job, QA, release, audit, and telemetry records
- D1 reviewer, spatial-semantic, measurement-evidence, hosting, retention, and
  lifecycle records
- private R2 source/master/delivery object storage
- 100 GiB resumable multipart uploads with D1/R2 byte and ETag reconciliation,
  cross-session discovery, exact-file resume, expiry handling, and explicit
  discard
- purpose-aware XGRIDS, FJD, phone, drone, and open-import ingestion that keeps
  raw capture, vendor projects, imagery, video, poses, calibration,
  trajectories, point clouds, and collision geometry out of Spark while
  retaining exact private R2 bytes and bounded D1 integrity evidence
- administrator-issued, project-scoped capture-agent credentials with hash-only
  storage, expiry, generation rotation, immediate revocation, last-use
  evidence, and an unattended local export-transfer agent that checkpoints
  exact-file SHA-256 plus committed multipart ETags before retry or restart
- Turnstile-protected email OTP authentication, ES256/JWKS access tokens,
  rotating refresh sessions, immediate D1 revocation, role checks, and
  authoritative D1 rate limits
- tenant-scoped enterprise OIDC with authorization code + PKCE, live provider
  discovery, RS256/ES256 ID-token verification, invited-account linking,
  provider session provenance, and immediate provider-disable revocation
- admin-only organisation team inventory with expiring email invitations,
  OTP acceptance, role changes, resend/reinvite, last-admin protection, and
  immediate target-session invalidation
- explicit multi-organisation membership inventory and session-rotating
  workspace switching with tenant-state clearing and mobile access
- organisation project templates, personal saved portfolio views, deterministic
  search/filter/sort, organisation-defined typed project fields, schema V2
  metadata export/import, direct administrator-to-administrator metadata
  handoff, and a separate queued asset-bearing project-copy path with preview,
  exact checksum verification, durable progress, retry, cancellation, and
  explicit lifecycle-authority exclusions
- KV-backed resend suppression that never replaces authoritative D1 auth state
- isolated Cloudflare Queues plus Workers AI Moondream privacy detection over
  verified private evidence frames, with bounded retries, exact detector/input
  evidence, human-only disposition, and QA blocking
- operator-authored floor/room/doorway comparison across immutable versions,
  with declared coordinate assurance, metric deviation evidence, an XZ overlay,
  persistent idempotency, and human review
- registered raw-scene PLY comparison across exact immutable version/assets,
  with deterministic bounded sampling, voxel occupancy, centroid and mean-colour
  evidence, classified worker failure/retry, immutable R2 report output, and
  mandatory human disposition
- registered PLY walkable-region extraction with bounded deterministic
  sampling, lower horizontal-support selection, concave polygon preservation,
  immutable R2 report evidence, D1 candidate lifecycle, explicit
  accept-selected/reject-all review, and polygonal navigation triangles only
  after human acceptance
- vendor-neutral registered PLY/E57/LAS/LAZ/PTS floor-plan extraction with
  explicit source-axis normalisation, captured multi-level ceiling and
  stair/ramp evidence, immutable proposals, mandatory operator correction,
  revision-bound collision/navigation recooking, versioned indicative
  revisions, and hash-bound private SVG/PDF/DXF exports that remain separate
  from measurement certification
- vendor-neutral canonical pose-path coverage against authored rooms, with the
  immutable source JSON in private R2 and bounded completeness, recapture, and
  human-review evidence in D1
- vendor-neutral capture-bundle contracts that bind exact verified version
  assets, exporter/hardware metadata, coordinate conventions, commercial
  rights, portability, independent-reconstruction inputs, automation readiness,
  and human disposition to an immutable private R2 manifest
- worker bearer authentication, expiring leases, heartbeats, retries, and
  dead-letter state
- a pinned Spark 2.1 processing agent with byte-verified input, multipart output,
  processor evidence, classified failure, retry, and cancellation
- immutable releases with a project-local numeric release revision, a numeric
  scene version, exact duplicate suppression, and public, unlisted, token, or
  customer-authenticated policies; UUIDs remain internal identity keys
- recoverable project archival that removes retired work from current Projects,
  Jobs, and Releases views while retaining its immutable project history
- short-lived signed scene sessions, HTTP range delivery, revocation, and
  rollback
- authenticated pre-publication version previews with short-lived exact-asset
  URLs, so operators can inspect a processed splat before optional authoring or
  release QA
- Spark RAD, SPZ, and SOG browser delivery
- bundled Spark 2.1 and Three.js runtime; no client-side CDN dependency
- device-adaptive Spark budgets, guided navigation, room/POI semantics, and a
  responsive authored-geometry floor plan with live camera position
- v7 structural collision with reviewed floor/wall/ceiling groups, furniture-
  ignoring Rapier Walk and Fly profiles, direct arrow/WASD motion, touch
  altitude controls, synchronized open/closed door barriers, Detour route
  topology, frozen six-direction shell probes at every published room anchor,
  144 bidirectional Walk-capsule and Fly-sphere sweeps across all 36 reviewed
  walls, 36 capsule corner-slide probes, and immutable JSON/Detour derivative
  hashes; an operator-only Noclip profile is frozen for diagnostics but is not
  exposed in the public viewer
- v9 capture-contract-qualified discontinuities for elevators, ladders, and
  moving platforms: immutable-asset-bound version-scoped paths, monotonic
  evidence-review receipts, Detour topology links, bidirectional Rapier capsule
  replay, controlled non-teleport viewer movement, and an evidence-linked
  runtime overlay/event; legacy v8 artifacts remain readable, while registered
  device evidence and coordinate-registration proof remain production gates
- expiring reviewer invitations, camera-anchored comments/redactions,
  immutable-version decisions, and access revocation
- tenant-scoped immutable-version comparison with short-lived exact-asset
  tokens, range-capable private delivery, two synchronized Spark renderers,
  exact approval/comment evidence, and side-specific timeout/error/retry states
- themes, hosting subscriptions, invoices, retention policies, hourly lifecycle
  enforcement, and retained-object retrieval drills
- custom-domain ownership plus a Cloudflare for SaaS provider state machine
  that persists routing/TLS evidence and refuses DNS-only activation
- merchant-operated manual billing with admin-only invoice issuance,
  payment-reference-required collection, explicit paid/void/past-due/
  cancelled/expired transitions, idempotent operations, audit history, and
  fail-closed hosting activation
- a dormant Stripe Checkout and signed-webhook adapter retained for a later
  self-service phase; it is not exposed by the current production UI and cannot
  grant entitlement while its provider configuration is absent
- tolerance-scoped measurement briefs, independent check points, residual QA,
  geometry-hash-bound draft DXF generation, private R2 delivery, cost evidence,
  and professional-sign-off boundaries
- structured logs, request IDs, Workers observability, security headers, and
  Worker-runtime integration tests

Intentionally outside the current production boundary:

- native XGRIDS/FJD project decoding or reconstruction inside Workers or the
  CPU-only processor Container; the production intake can preserve these files
  and validate bounded identity/integrity evidence without claiming it can
  reconstruct them
- licensed scanner-origin acceptance of the declared XGRIDS/FJD capture-bundle
  exports; the deployed contract validates preserved evidence, not vendor claims
- scanner-native live coverage guidance and licensed-device threshold
  validation
- full-scene privacy coverage beyond the explicitly supplied evidence frames
- licensed scanner-origin validation and full 6DoF/control-point registration;
  the deployed raw-scene lane can estimate bounded same-scale,
  gravity-aligned yaw and translation, but does not certify survey accuracy
- survey-grade automatic floor plans or unobserved vertical circulation; the
  vendor-neutral v2 lane detects distinct captured levels, infers continuous
  stair/ramp evidence, cooks radius-cleared Recast treads and landings, and
  rejects disconnected levels before review. It requires captured or
  operator-reviewed ceiling support and never manufactures a ceiling from wall
  height. Proposal-derived navigation is preview-only; approval recooks a new
  build bound to the corrected revision and plan hash. Every level and
  connector remains an indicative proposal requiring operator correction.
  Elevators, ladders, moving platforms, or stairs absent from registered
  geometry are never inferred. V8 supports them only as explicit reviewed 3D
  paths whose landings project onto Recast and whose allowed directions pass
  the production Rapier capsule replay
- arbitrary capture editing, furniture asset placement, or generative
  background reconstruction after deleting captured objects
- activation and acceptance of a real customer enterprise identity provider
- Stripe products/prices/secrets; self-service card billing is deliberately
  deferred while merchant-operated manual billing is the production path
- Cloudflare for SaaS production account activation, fallback-origin
  validation, quota, and one live customer-controlled hostname
- legal/professional certification of measurements

These are product modules, not hidden claims of the deployed release.

## Local development

Requirements: Node.js 22+, npm, and Wrangler authentication.

```bash
npm install
npm run auth:init:local
npm run db:migrate:local
npm run dev
```

Open `http://localhost:8787/studio.html`. Local email delivery is simulated by
Wrangler; production OTP mail is sent from `login@whymelabs.com`.

## Processing agent

Production dispatch uses a dedicated Cloudflare Queue and short-lived
Cloudflare Container image containing the pinned official Spark `build-lod`
commit, Node 22, and Chromium. Build it locally with:

```bash
npm run processor:container:build
```

For development or a provider-neutral external worker, install the same pinned
Spark executable once and run the agent against the intended environment:

```bash
npm run processor:setup
SPATIAL_API_ORIGIN=http://localhost:8787 \
PROCESSOR_MAX_CHANGE_INPUT_MIB=1024 \
npm run processor:start
```

The v7 navigation lane requires operator-authored shells to use
`authored-structural-collision-v2`: floors, ceilings, and wall segments are
separate reviewed inputs, so the publisher cannot manufacture walls by
extruding a floor edge. Primitives are classified as structural floor,
structural barrier, dynamic barrier, or ignored furniture. The processor builds
Detour topology, replays all room routes with a Rapier capsule, proves every
room anchor is enclosed in all six directions, sweeps both sides of every
reviewed wall with both the production Walk capsule and Fly sphere, probes
capsule corner slides, and proves each dynamic door is passable/open and
blocked/closed in both Rapier and Detour before publication. A release freezes
the exact approved build ID, authoring hash, JSON report asset, Detour binary,
SHA-256 hashes, and sizes. The example Home Scan authoring contract is
[`assets/home-scan-structural-v7.json`](./assets/home-scan-structural-v7.json).

For automatically extracted plans, a complete captured shell may create an
early navigation preview, but that preview is not approvable. Floor-plan
approval recooks collision from the corrected level, ceiling, wall, opening,
and connector data and queues a new build cryptographically bound to the
approved revision ID and plan hash.

The processor reads `WORKER_API_TOKEN` from the environment. Use
`npm run processor:once` for a single lease attempt or deployment smoke. It does
not receive R2 credentials: source downloads and multipart derivative uploads
are scoped by a short-lived job lease. `PROCESSOR_JOB_ID` optionally pins a
worker/container to one exact queued job. Raw-scene comparison currently reads
each input into memory after enforcing the per-input
`PROCESSOR_MAX_CHANGE_INPUT_MIB` limit (1,024 MiB by default); increase it only
on a processor with a measured memory budget.

## Capture transfer agent

The transfer agent preserves a completed vendor export; it does not control a
scanner or claim to decode an opaque vendor project. In Team > Capture agent, a
platform administrator assigns the exact destination projects, chooses a short
expiry, and stores the one-time displayed credential. Package multi-file
vendor output into one immutable artifact, copy
[`examples/capture-transfer-manifest.example.json`](./examples/capture-transfer-manifest.example.json),
and run:

```bash
SPATIAL_API_ORIGIN=https://spatial.whymelabs.com \
SPATIAL_CAPTURE_AGENT_TOKEN=... \
SPATIAL_CAPTURE_INBOX=/absolute/path/to/export-inbox \
npm run capture-agent:start
```

Use `npm run capture-agent:once` for a supervised smoke. The agent validates
the manifest, project assignment, capture adapter, stable-file window, byte
size, and optional declared SHA-256; uploads resumable 10 MiB parts; reconciles
remote parts after restart; writes atomic checkpoints and a completion receipt
under the inbox; and never deletes the source export. Rotate or revoke the
credential in Studio without changing operator sessions or `WORKER_API_TOKEN`.

## Verification

```bash
npm run check
npm run corpus:all
npm run corpus:e2e:local
npm run corpus:fjd:inspect
npm run corpus:fjd:qualify
npm run corpus:fjd:e2e:local
```

This regenerates Worker types, type-checks the client and Worker, statically
audits asynchronous action handlers, builds the static assets and bundled
renderer, runs tests inside Cloudflare's Workers runtime with isolated D1/R2
storage, and performs a production deployment dry-run.

The integration suite validates health, authentication, tenant isolation, R2
multipart upload and cross-session recovery, worker lease/input/output
contracts, recovery actions,
validation, QA, publish, signed scene retrieval, revoke, client review,
organisation team access, idempotent portfolio project lifecycle operations,
multi-organisation session switching,
project templates, personal saved views, typed project schemas,
previewed/idempotent portfolio import and direct cross-workspace metadata
handoff, queued asset-bearing project copy with R2 checksum evidence,
scoped capture-agent issuance/rotation/revocation and unattended transfer
provenance,
spatial authoring, measurement evidence,
deterministic DXF delivery, and lifecycle enforcement. The
real-browser matrix and current limitations are recorded in
[`docs/verification/mobile-desktop-matrix.md`](./docs/verification/mobile-desktop-matrix.md).
The open-corpus commands fetch and checksum source-pinned, licensed fixtures,
build their deterministic derivatives, exercise the production-shaped
OTP/JWT, D1, R2, processor, privacy, publication, and Spark/Chrome path, and
write machine-readable evidence under `.cache/open-corpus/reports`. Coverage,
provenance, and the vendor-data boundaries are recorded in
[`docs/verification/open-corpus-e2e.md`](./docs/verification/open-corpus-e2e.md)
and
[`docs/research/open-test-corpus.md`](./docs/research/open-test-corpus.md).
The FJD commands range-inspect the official P2 archive, selectively extract its
Gaussian PLY and companion `.fjdata` without downloading the whole archive,
verify a separate official V4e interior LAS, build a Spark RAD compatibility
artifact, and run a disposable local FJD-adapter/Chrome E2E. Local vendor bytes
and reports remain under ignored `.cache/fjd-sample-corpus`; the exact pins,
commands, isolated-E2E boundary, private production qualification receipt, and
remaining paired-frame gap are recorded
in [`docs/verification/fjd-sample-corpus.md`](./docs/verification/fjd-sample-corpus.md).

## Deployments

```bash
npm run db:migrate:staging
npm run deploy:staging

npm run db:migrate:production
npm run deploy:production
```

Secrets are configured with `wrangler secret put`; they are never stored in the
repository. See [DEPLOYMENT.md](./DEPLOYMENT.md) for rotation, smoke tests, and
rollback procedures.

## Key documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — trust boundaries, data model, and
  processing-agent contract
- [DEPLOYMENT.md](./DEPLOYMENT.md) — environments and operating runbook
- [AUTHENTICATION.md](./AUTHENTICATION.md) — OTP, JWT, refresh, and key rotation
- [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md) — journey-level milestones,
  surface status, and acceptance criteria
- [MVP_BACKLOG.md](./MVP_BACKLOG.md) — concise execution queue
- [docs/PRODUCTION_READINESS_CLOSURE.md](./docs/PRODUCTION_READINESS_CLOSURE.md)
  — original audit closure matrix and external validation gates
- [docs/SECURITY_AUDIT_2026-07-28.md](./docs/SECURITY_AUDIT_2026-07-28.md)
  — final application security review, verification evidence, and operational
  hardening decisions
- [docs/verification/open-corpus-e2e.md](./docs/verification/open-corpus-e2e.md)
  — reproducible open-data end-to-end proof and explicit evidence boundaries
- [docs/V7_NAVIGATION_PIPELINE.md](./docs/V7_NAVIGATION_PIPELINE.md) — current
  structural collision, Rapier Walk/Fly, Detour build, validation, and immutable
  publication contract
- [docs/V8_AUTHORED_TRAVERSAL_PIPELINE.md](./docs/V8_AUTHORED_TRAVERSAL_PIPELINE.md)
  — elevators, ladders, moving platforms, and controlled-path acceptance
- [docs/V5_NAVIGATION_PIPELINE.md](./docs/V5_NAVIGATION_PIPELINE.md) — legacy
  authored-floor compatibility path and provisional-unit boundary
- [docs/research/floorplan-and-scene-editing.md](./docs/research/floorplan-and-scene-editing.md)
  — verified floor-plan and furniture-editing capability boundaries and
  implementation sequence
- [DEMO_ASSET_POLICY.md](./DEMO_ASSET_POLICY.md) — asset provenance rules
