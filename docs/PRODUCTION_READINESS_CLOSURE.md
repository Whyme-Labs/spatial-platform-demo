# Production-readiness closure

Last reviewed: 2026-07-29

The original 2026-07-26 audit assessed the repository as a static prototype.
Milestones 1–24 replaced that prototype boundary with a deployed Cloudflare
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
| Indicative floorplans | `LIVE` | Checksum-bound metric input, canonical Y-up normalisation, bounded extraction, immutable proposal evidence, operator review, versioned revisions, and hash-verified SVG/PDF/DXF exports | Real indoor scanner corpus, paid measurement briefs, and qualified sign-off before measured/certified claims |
| Production viewer | `LIVE` | Bundled Spark 2.1, private range delivery, adaptive budgets, progress/error/retry telemetry, guided navigation, collision, floor plan, and public production scene | Broader physical phone matrix |
| Publication and access | `LIVE` | Immutable public/unlisted/token/customer releases, short-lived scene sessions, private R2 range access, revoke, rollback, review links, and approval history | Real customer hostname activation |
| Security and privacy | `LIVE` | CSP and security headers, same-origin mutation checks, output escaping, quotas, tenant isolation, secrets/key rotation, audit records, private raw assets, automated privacy evidence, and human-only disposition | Customer security review for sensitive deployments |
| Reliability and observability | `LIVE` application controls; `VALIDATE` provider operations | Request IDs, structured logs, operations inventory, queue/dead-letter evidence, bounded auth-state cleanup, lifecycle enforcement, retained-object retrieval drill, recovery runbooks, and Worker health endpoint | External uptime alert route and provider-level restore exercise before paid customer data |
| Testing | `LIVE` software gate; `VALIDATE` licensed scanner corpus | 110 Worker/domain tests across 25 files; action-state and control-wiring audits; build and production dry-run; final 15-lane/28-assertion pinned open corpus through OTP/JWT, multipart R2, D1 jobs, Spark processing, Workers AI privacy, metric floorplan extraction/review/export, publication, and Chrome rendering; live staging and production Worker/container health | Maintain licensed K1/P2 compact/large/edge-case corpus |

## Roadmap state

The internally implementable roadmap through Milestone 24, plus the
vendor-neutral floorplan milestone, is complete and deployed. There is no
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

Current production release evidence:

- application Worker: staging `c70c026c-3221-4593-b489-a811e09edeae`,
  production `d5387683-c72c-4a75-b751-c3fc61f0468a`;
- processor Worker/container: staging
  `117312e4-f252-4128-b8e3-98d07b743b19`, production
  `0e7d2031-9e2c-4600-9d76-2e82fc7d9240`;
- processor health: `spatial-processor/0.7.0`, Spark 2.1.0,
  `cloudflare-container`.

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
