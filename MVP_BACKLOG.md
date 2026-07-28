# Product backlog

The journey-level sequence and production acceptance criteria live in
[PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md). This file is the concise execution
queue.

## Current execution state

The internally implementable roadmap through Milestone 24 is production
deployed. Every remaining unchecked item below is an external activation or
real-world evidence gate, not a known dead control or missing application
handler. The closure matrix is recorded in
[docs/PRODUCTION_READINESS_CLOSURE.md](./docs/PRODUCTION_READINESS_CLOSURE.md).

## Completed production V0

- [x] Cloudflare Workers/Hono API and static asset deployment
- [x] isolated staging and production D1/R2 resources
- [x] operator session and role enforcement
- [x] tenant-scoped project/version model
- [x] resumable multipart private uploads
- [x] cross-session upload recovery with persisted R2 part reconciliation,
      exact-file resume, expiry handling, and explicit discard
- [x] immutable assets, scene versions, and releases
- [x] job idempotency, lease, heartbeat, complete, retry, and dead-letter states
- [x] audited manual validation and QA gate
- [x] public, unlisted, token, and customer-authenticated release policies
- [x] signed scene sessions, HTTP range delivery, revoke, and rollback
- [x] bundled Spark 2.1 viewer for RAD, SPZ, and SOG
- [x] private range-capable RAD LoD delivery
- [x] viewer telemetry and structured Workers logs
- [x] Worker-runtime integration tests for the release path and tenant isolation
- [x] project workspace with metadata editing and guarded archive/restore
- [x] idempotent portfolio bulk archive/restore with per-project dependency
      outcomes and retained retry selection
- [x] reusable organisation project templates and user-scoped default saved
      portfolio views
- [x] versioned metadata-only portfolio export plus server-validated preview and
      idempotent confirmed import
- [x] organisation-defined typed project metadata with required-field
      validation, schema V2 portable transfer, and immutable key/type contracts
- [x] administrator-to-administrator cross-organisation metadata handoff with
      preview, conflict checks, request-hashed replay, unchanged source state,
      and an explicit no-assets/lifecycle boundary
- [x] queued asset-bearing cross-organisation project copy with an exact
      inventory snapshot, new project/version/asset identities, streaming R2
      checksum verification, durable progress, reconciliation, retry,
      cancellation cleanup, and an explicit no-authority-transfer boundary
- [x] dedicated Projects, Processing jobs, and Releases workspaces
- [x] organisation-wide release inventory and rollback controls
- [x] admin-only organisation team invitations, role lifecycle, expiry,
      revocation/reinvite, and immediate session invalidation
- [x] explicit multi-organisation membership inventory and session-rotating
      workspace switching
- [x] scoped, expiring capture-agent credentials plus unattended vendor-export
      transfer with hash-only token storage, rotation/revocation, exact-project
      assignment, multipart checkpoint reconciliation, and receipts

## P0 next — operate real capture jobs

- [ ] obtain one licensed scanner-origin K1 and one P2 source project
- [x] vendor-neutral capture-bundle contract with exact version/asset hashes,
      capture/export metadata, coordinate frame, commercial rights, portability
      classification, immutable private R2 manifest, and human review
- [ ] register licensed K1 and P2 exports against the capture-bundle contract
      and record the actual raw-image/pose/calibration/export limitations
- [x] obtain a licensed public indoor source for the processing-lane proof
- [x] implement the local/cloud Spark processing agent
- [x] package the processor as a pinned linux/amd64 Cloudflare Container with
      exact-job dispatch, Queue notification, minute reconciliation, bounded
      concurrency, and no direct R2/D1 credentials
- [x] validate Gaussian PLY and build production Spark RAD derivatives
- [x] upload poster images and automated technical QA reports
- [x] record compute time, active human time, output bytes, and failure class
- [x] run WebKit iPhone, Android Chrome, and desktop browser matrix
- [x] add processing-agent contract tests with real R2 derivative registration

## P1 — client workflow and revenue

- [x] expiring customer reviewer invitations and least-privilege membership
- [x] in-scene review comments and redaction requests
- [x] immutable-version approval history
- [x] signed side-by-side Spark version comparison with synchronized cameras,
      exact approval/comment history, and side-specific retry recovery
- [x] project-level retention and enforced R2 deletion policies
- [x] hosting plans, metering, billing records, and renewal workflow
- [x] admin-only manual invoice issuance, payment-reference reconciliation,
      guarded subscription transitions, idempotency, audit history, and
      fail-closed entitlement
- [x] branded themes and custom-domain ownership verification
- [x] Cloudflare for SaaS provider adapter, persisted routing/TLS lifecycle,
      honest non-activation, project-scoped custom-host routing, and deletion
- [x] Stripe Checkout adapter, signed-webhook/idempotency ledger,
      provider-evidenced activation, payment-failure reconciliation, and
      provider-first cancellation
- [x] operational alerts and retained-object retrieval drill
- [x] tenant-scoped OIDC adapter, PKCE/state/nonce callback, invited-account
      linking, provider administration, session provenance, disable revocation,
      and complete browser action states
- [ ] configure one real enterprise IdP client secret and complete provider
      consent, first-link, repeat-login, denial, expiry, key-rotation, and
      disable/revocation acceptance in staging
- [ ] configure the Cloudflare for SaaS production zone, scoped API token,
      fallback origin, quota, and complete one customer-controlled hostname
- [ ] optional/deferred: configure Stripe products/prices/secrets and complete
      one real paid/renewal/failure/cancellation acceptance lifecycle when
      self-service card billing is required

## P2 — defensible spatial moat

- [x] vendor-neutral pose-path completeness against authored rooms, private R2
      source evidence, XZ blind-spot overlay, explicit thresholds, and human
      recapture disposition
- [ ] validate live capture guidance and false-positive/false-negative rates on
      licensed K1 and P2 scanner-origin trajectories
- [x] adaptive mobile/desktop quality profiles and LoD policy
- [x] floor, room, doorway, POI, and route semantics
- [x] authored box-union collision proxy and navigation triangles
- [x] verified registered-PLY walkable-region candidates with deterministic
      horizontal-support extraction, immutable evidence, explicit human
      acceptance/rejection, editable room seeds, and polygonal navmesh
- [x] responsive box/polygon floor-plan overlay with live camera marker,
      keyboard room controls, and acknowledged click-to-teleport
- [x] review/operator privacy regions with human approval
- [x] automated private-frame privacy detection through Workers AI/Queues,
      human candidate disposition, evidence retention, bounded retries, and QA
      gating
- [x] measurement brief, tolerance, check-point, residual QA, and cost evidence
- [x] evidence-gated draft DXF generation with geometry-hash provenance,
      private R2 storage, D1 records, and authenticated range download
- [x] semantic and asset-inventory change reports between immutable versions
- [x] metric authored-geometry comparison and XZ overlay with declared
      registration evidence, persistent idempotency, and human disposition
- [x] registered source/master/point-cloud PLY comparison with deterministic
      voxel occupancy, centroid, and mean-colour evidence, exact dual-input
      provenance, processor failure/retry, immutable report, and human review
- [ ] validate registered raw-scene thresholds and false-positive/false-negative
      rates on licensed K1 and P2 scanner-origin version pairs
- [ ] validate walkable-region extraction, elevation hints, and false polygon
      rates on licensed K1 and P2 scanner-origin point clouds
- [x] bounded automatic same-scale/gravity-axis PLY registration before
      comparison using yaw/translation multi-start refinement, declared
      overlap/RMSE/ambiguity gates, immutable transform/residual evidence,
      blocked-analysis state, and human review
- [ ] validate automatic registration thresholds, ambiguity detection, and
      false alignment rates on licensed K1 and P2 scanner-origin version pairs
- [ ] paid floor-plan/DXF product after three-customer validation gate
- [x] purpose/format-aware XGRIDS, FJD, phone, drone, and imported-data intake
      adapters with opaque-evidence limitations

## Explicit non-goals until validated

- certified cadastral or engineering measurement without licensed partners
- fully automated CAD/BIM promises
- critical-infrastructure hosting without customer security review
- self-service phone capture before rescan and cleanup rates are measured
- scanner-specific platform lock-in
