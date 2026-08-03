# Production-readiness closure

Last reviewed: 2026-08-03

The original 2026-07-26 audit assessed the repository as a static prototype.
Milestones 1–25 replaced that prototype boundary with a deployed Cloudflare
Workers product. This matrix prevents a completed implementation from being
confused with an external activation or real-data validation gate.

## Original P0 closure matrix

| Audit area | Current status | Production evidence | Remaining boundary |
|---|---|---|---|
| Application foundation | `LIVE` | TypeScript build, lockfile, generated Worker bindings, isolated local/staging/production resources, migrations, tests, dry-runs, and deployment scripts | None inside the application |
| Identity, tenancy, authorisation | `LIVE` | Email OTP, ES256/JWKS access tokens, rotating refresh sessions, D1 revocation, RBAC, invitations, multi-organisation switching, tenant tests, and OIDC adapter | Activate and accept one real enterprise IdP |
| Project/version state machine | `LIVE` | Immutable versions/releases, guarded transitions, archive/restore, rollback/revoke, metadata import/handoff, and asset-bearing copy | Destructive move and disaster recovery are separate products |
| Large-file upload and storage | `LIVE` | 100 GiB bounded multipart R2 upload, 10 MiB parts, exact-file recovery, D1/R2 ETag reconciliation, checksum evidence, cleanup, and capture-agent transfer | Licensed vendor-export trials |
| Processing orchestration | `LIVE` | Idempotent jobs, leases, heartbeat, progress, cancellation, retry, dead-letter states, Queue dispatch, reconciliation, and pinned Container processor | Vendor-native licensed reconstruction automation and elastic GPU provider |
| Format pipeline | `LIVE` | Evidence validation plus Spark RAD/SPZ/SOG paths, malformed-input tests, posters, reports, purpose/format separation, and vendor-neutral metric PLY/E57/LAS/LAZ/PTS normalisation through pinned PDAL | Licensed K1/P2 export and quality comparison |
| Indicative floorplans | `LIVE` | Checksum-bound metric input, canonical Y-up normalisation, bounded multi-level extraction, stair/ramp evidence, immutable proposal evidence, operator review, versioned revisions, and hash-verified SVG/PDF/DXF exports | Real indoor scanner corpus, paid measurement briefs, and qualified sign-off before measured/certified claims |
| Production viewer | `LIVE` v7; `VALIDATE` v9 physical traversal evidence | Bundled Spark 2.1, private range delivery, adaptive budgets, progress/error/retry telemetry, guided rooms, live floor plan, v7 reviewed structural collision, verified multi-level Recast navigation, Rapier Walk/Fly movement, public multi-room production scene, legacy-v8 reading, and v9 elevator/ladder/moving-platform controlled paths derived from capture-frame points with hash-verified capture-to-scene registrations plus a non-geometric runtime overlay/event | Qualify automatic XGRIDS/FJD metadata extraction, then exercise v9 against a registered physical traversal on the measured phone matrix before production activation |
| Publication and access | `LIVE` | Immutable public/unlisted/token/customer releases, short-lived scene sessions, private R2 range access, revoke, rollback, review links, and approval history | Real customer hostname activation |
| Security and privacy | `LIVE` | CSP and security headers, same-origin mutation checks, Turnstile-protected OTP requests/resends, output escaping, quotas, tenant isolation, secrets/key rotation, audit records, private raw assets, automated privacy evidence, and human-only disposition | Customer security review for sensitive deployments |
| Reliability and observability | `LIVE` application controls; `VALIDATE` provider operations | Request IDs, structured logs, operations inventory, queue/dead-letter evidence, bounded auth-state cleanup, lifecycle enforcement, retained-object retrieval drill, recovery runbooks, and Worker health endpoint | External uptime alert route and provider-level restore exercise before paid customer data |
| Source release gate | `LIVE` checks; `VALIDATE` policy enforcement | Private GitHub repository plus least-privilege, SHA-pinned CI for locked install, dependency audit, application release gate, and processor dry-run | Branch protection requires an upgraded GitHub plan or a public repository |
| Testing | `LIVE` software gate; `VALIDATE` licensed scanner corpus | 216 Worker/domain tests across 42 files, 41 deterministic navigation/migration contracts, and 61 Playwright tests; hermetic Worker runtime with remote bindings disabled; action/control/config audits; responsive browser coverage from 1440×1000 through 320×568; build and production dry-run; pinned open corpus through OTP/JWT, multipart R2, D1 jobs, Spark processing, Workers AI privacy, paired-frame receipts, metric floorplan extraction/review/render correction/export, publication, and Chrome rendering | Maintain licensed K1/P2 compact/large/edge-case corpus |

## Roadmap state

The internally implementable roadmap through Milestone 25, including the
vendor-neutral floor-plan and v7 structural-navigation milestones, is complete
and deployed. The v9 authored-traversal extension now rejects evidence that is
not frozen into an accepted capture contract with an explicit
`traversal_evidence` role. Its evidence-linked path overlay and host lifecycle event
remain navigation UI rather than fabricated scene geometry. Monotonic capture
review generations prevent reject-then-reaccept from resurrecting an older
approval. The numeric capture-to-scene transform is now frozen from the
accepted manifest through D1, the authoring hash, offline build, and artifact;
the Worker also derives every qualified world path from frozen capture-frame
points. V9 still awaits qualified automatic vendor metadata extraction,
registered physical evidence, phone-matrix acceptance, and production
activation. There is no
known rendered dead control and no unimplemented application action in the
current product surface.

The remaining queue contains external evidence or account activation:

1. Obtain licensed K1 and P2 source/export projects and rights.
2. Register their actual files against the capture-bundle contract.
3. Validate coverage, registration, raw-change, floorplan extraction, and
   semantic-extraction thresholds on those paired captures.
4. Activate one real enterprise IdP and complete the acceptance lifecycle.
5. Configure Cloudflare for SaaS and activate one customer-controlled hostname.
6. Complete one real merchant-operated invoice/payment/expiry lifecycle.
7. Route uptime alerts and exercise provider-level D1/R2 recovery.
8. Complete three paid measurement briefs before promoting CAD/accuracy claims.
9. Revisit Stripe only when self-service card billing becomes a product
   priority; it is not a production-readiness dependency for manual billing.

Current production evidence is verified at the stable endpoints rather than
copied here as immediately stale deployment UUIDs:

- application health: <https://spatial.whymelabs.com/api/health>;
- processor health:
  <https://spatial-processor-cloud-production.swmengappdev.workers.dev>;
- public v7 Walk + Fly proof:
  <https://spatial.whymelabs.com/s/home-scan-spark-multi-room-demo>;
- exact Worker version IDs and immutable acceptance artifacts are retained in
  the GitHub `Release gate` / `Deploy and accept staging` runs and Wrangler
  deployment history for the deployed commit.

These are not represented as fake controls. A gate moves back into development
only when its external input exists and the resulting evidence identifies a
specific product or engineering change.

## Release discipline

Every future milestone must still provide:

1. a public UI/API contract and explicit exclusions
2. a failing contract or browser test before implementation
3. a complete pending/error/retry/cancellation action-state contract
4. typecheck, build, Worker tests, action/control audits, and deployment dry-run
5. staging migration plus real service proof
6. production migration, deployment, smoke checks, and recorded release ID

An external provider being unconfigured must render an honest unavailable
state. It must never be treated as a completed integration, and it must never
be exposed as a clickable action that cannot succeed.
