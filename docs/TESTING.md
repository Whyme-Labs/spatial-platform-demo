# Testing strategy

Spatial Studio uses four complementary test layers. A change is production-ready
only when the public behavior at its relevant seam is covered and the complete
`npm run check` gate passes.

## Test layers

| Layer | Public seam | Command | Current scope |
| --- | --- | --- | --- |
| Unit | Pure modules and bounded adapters | `npm run test:unit` | Action state, capture formats, paired-frame receipts, render-native floor-plan corrections/overlays, geometry and floor-plan logic, navigation triangles/obstacles/transitions, evidence-linked traversal overlays, coordinate transforms, OIDC helpers, processor validation, privacy detection, Turnstile verification |
| Integration | Worker HTTP routes and Cloudflare bindings | `npm run test:integration` | D1, R2, KV, queues, email, authentication, tenancy, billing state, processing, review, release and lifecycle workflows, and the public E57 container-structure evidence lane |
| Navigation contracts | Offline build, movement evidence, receipt migration, and the processor image | `npm run test:navigation` | Structural shell validation, Recast/Detour export, Walk/Fly collision sweeps, corner slides, dynamic doors, connectivity, deterministic physical-runtime probes, legacy receipt backfill/atomicity, the public ASTM E57 container reader, and the Container `Dockerfile` COPY graph |
| End to end | Production browser bundle | `npm run test:e2e` | Landing and live-demo messaging, OTP pending/error/retry behavior, responsive sign-in and Turnstile, paired-capture intake, registered-render structure approval/correction controls, navigation authoring/review spacing, Spark renderer chrome, Walk/Fly input, floor plan, and the host-to-renderer navigation snapshot handoff |
| Deployed staging | Cloudflare edge, deployed Workers and remote bindings | `npm run verify:staging` plus `npm run verify:staging:lifecycle` | Worker deployments, security/auth boundaries, D1 migration state, exact R2/KV canary round trips, processor identity and cleanup, and an authenticated two-version lifecycle through visual, authored-geometry, and processor-backed raw comparison |

The Studio browser gate measures column starts and resolved grid tracks across
every columnar Projects, Jobs, Releases, and Team row, including their headers
and differing action states. The published-viewer gate also rejects any
absolute Spark startup watchdog; progress continues until Spark reports ready,
an explicit renderer error, or the operator retries.

The project-workspace browser contract clicks the portfolio row itself, rejects
the former Manage-button split pane, asserts the dedicated
`#project/{project-id}` route, exercises nested Scene & navigation routing, and
returns through Back to projects. It repeats the project header/navigation
geometry at desktop, tablet, phone, and narrow-short-phone widths and fails on
document overflow or overlapping project navigation.

`npm test` runs all Worker unit and integration tests once. `npm run test:all`
runs the instrumented Worker suite plus browser E2E.

## Contract lanes added with the integrity and evidence work

- `node-test/processor-container-image.test.mjs` parses `processor/Dockerfile`,
  walks the local import graph from the `ENTRYPOINT` script, and fails when a
  reachable `scripts/*.mjs` module is not copied into the image. It is a static
  contract: it proves the image would not fail at first `import`, not that a
  built image runs.
- `node-test/e57-structure.test.mjs` covers the public ASTM E2807 container
  reader against synthetic files: the standard CRC-32C check value, per-scan
  poses, bounds, vendor field names and image representations, a page whose
  stored CRC no longer matches, an XML section declared above the 64 MiB logical
  bound, a non-E57 signature, and a DTD-bearing XML section. No vendor E57 is
  read anywhere in the suite.
- `test/capture-scan-structure.spec.ts` is the Worker-side contract: the bounded
  reading is persisted and bound to its stored R2 report, a claimed reading that
  cites no stored derivative is refused, an unreadable container is recorded
  without blocking preservation of the bytes, and a pose-path claim binds only
  to a structure reading from its own version.
- `test/sha256-stream.spec.ts` pins the incremental client hash against the NIST
  vectors, proves the digest is invariant across block-aligned and unaligned
  split points, and covers blob streaming, progress, abort, and post-finalise
  rejection. It runs under `npm test` and `npm run test:coverage`; it is not yet
  listed in the explicit `test:unit` file set.

## Coverage

`npm run test:coverage` uses Istanbul instrumentation because Cloudflare's
Workers Vitest runtime does not expose native V8 coverage. Reports are written
to `coverage/` in text summary, JSON summary, LCOV and HTML formats.

The enforced baseline is:

| Metric | Minimum |
| --- | ---: |
| Statements | 66% |
| Branches | 50% |
| Functions | 82% |
| Lines | 74% |

Coverage includes Worker, shared, processor-cloud, action-state and floor-plan
TypeScript. Browser layout behavior is enforced through Playwright assertions
rather than source-line coverage.

## Responsive UI contract

The browser suite tests 1440x1000, 1024x768, 768x1024, 390x844 and 320x568
viewports. It fails when:

- the document scrolls horizontally;
- visible text leaves the Manrope and IBM Plex Mono system;
- a visible button, text input, select or textarea is below 40 px high;
- sign-in or Turnstile content escapes its dialog;
- a short-screen dialog cannot scroll;
- project fields or dropdowns exceed their parent width;
- action clusters lose their minimum gap;
- the project command grid does not collapse at the mobile breakpoint;
- OTP submission sends duplicate requests or omits pending, failure and retry states.

The authenticated Studio shell also sweeps widths 1280, 1100, 1024, 961 and
960. At every width, the active Projects or Processing activity workspace must
own the grid's only track. The gate also rejects page-level horizontal overflow
masking so a clipped component cannot make the document-width check pass.

## Production gate

`npm run check` runs:

1. generated Cloudflare types;
2. application and E2E TypeScript checks;
3. action-state and control-wiring audits;
4. production configuration audit;
5. production build;
6. deterministic Node navigation contracts;
7. instrumented unit/integration tests with coverage thresholds;
8. Playwright E2E;
9. Cloudflare production deployment dry run.

The `Release gate` GitHub workflow runs this suite in a `functional` job that
executes in parallel with a `security` job (`npm audit`) and a `processor` job
(processor bundle dry-run). All three block the workflow — and therefore
staging — but a dependency advisory can no longer erase the functional
diagnostic signal by failing before it runs.

The v7+ view gate treats navigation as immutable production evidence. Private
preview, immutable-version comparison, publication, rollback, and manifest
delivery all fail closed before Spark can be viewed when the exact-version
collision or walking-map derivatives are absent. The renderer clears its local
loading overlay on visual readiness, but posts `ready` to the host only after
Detour and Rapier initialize (or an authoring host grants collision-free
inspection), and never after a fatal error; there is no camera-only public
mode. `e2e/movement-integrity.spec.ts` pins this protocol along with body
authority (a synced camera cannot drag the physics body through reviewed
geometry) and door-occupancy refusal (a dynamic barrier will not close on the
player). A build
must prove room-anchor enclosure, both-direction Walk/Fly wall sweeps, capsule
corner sliding, room-route replay, and open/closed door parity before Studio can
approve it or a movement-enabled release can be published.

The v9 extension additionally requires an accepted capture contract whose
immutable asset is explicitly marked `traversal_evidence`, builds disconnected
floors through a reviewed Detour link, replays every allowed 3D path direction
with the production Rapier capsule, unit-tests non-teleport controller timing
and one-way behavior, and drives an Arrow-key browser traversal from the lower
to the upper landing. The browser proof also asserts the start/completion host
events and their frozen registration hash. Worker/domain contracts prove that
the signed, expiring review session accepts only a connection from the frozen release
and resolves its capture adapter, manifest hash, review generation, numeric
source-to-world transform, and capture-frame path server-side. It decodes a
real canvas screenshot and verifies
that enabling the authored route adds visible route-overlay pixels. Negative
contracts omit the numerical registration or substitute a capture/world path,
manifest identity, review generation, registration hash, or transform while
retaining the expected authoring hash and prove that the Worker rejects the
processor payload. Legacy v8 artifact parsing remains a compatibility contract
and does not grant the v9 qualification claim.

The authenticated review host accepts the renderer's evidence-linked traversal
lifecycle event and records a `navigation_traversal` diagnostic row with a
stable logical run id across credential renewal and a same-tab reload, server
receive time, per-session sequence, device profile, and server-resolved frozen
registration receipt. The contract issues two simultaneous first requests to
prove the authoritative auth-session identity is idempotent without browser
storage, then proves lifecycle enforcement retires an expired run and an
authenticated idle tab reconstructs the same UUID with its next sequence
derived from immutable prior events. A separate R1 to R2 to R1
rollback contract proves the channel activation generation prevents the old R1
session and bearer from returning. The same integration contract mints
evidence credentials and then proves both logout and project-reviewer access
revocation reject the old bearer immediately; the migration trigger repeats
the authorization guard below the HTTP layer. Capacity coverage requires an expiry-index
query plan without a temporary sort and drains 501 expired session rows as 500
then 1 while reporting D1 rows read/written and whether a pending backlog
remains. The deterministic
Studio export includes its full byte SHA-256 in the response header, download
name, and visible Studio success receipt. Physical qualification
uses [the device matrix template](verification/physical-navigation-matrix-template.md);
synthetic browser runs never populate its accepted rows.
The contracts also expire copied bearers and reject a superseded release
immediately while its already-invalid session row remains bounded by credential
expiry and the indexed lifecycle lane.

Playwright serves the built `dist/` bundle through Vite Preview on port 8791.
All API responses used by UI-layout tests are explicit fixtures. Worker routing
and binding behavior remains the responsibility of the integration suite.

## Deployed Cloudflare acceptance

Local workerd tests are necessary but do not prove Cloudflare account state,
remote binding permissions, edge headers, Worker routing, Container readiness,
or remote consistency. The deployed acceptance runner closes that gap without
bypassing authentication:

```bash
# Public HTTP boundary only; no Cloudflare account mutation.
npm run verify:staging:public

# Full staging acceptance with authenticated, temporary binding canaries.
npm run verify:staging
```

The full runner checks the active application and processor deployments, reads
the remote D1 migration ledger, performs exact-byte R2 and KV canary
round-trips, and removes both canaries in a `finally` block. A cleanup failure
fails the run. The bounded, redacted report is written to
`.cache/staging-acceptance/report.json`.

The authenticated lifecycle runner then creates two deterministic immutable
versions. It proves Compare is unavailable after the first qualified version,
qualifies the second, verifies all three server-derived comparison modes, loads
both signed visual assets and checks their source hashes, accepts an authored
geometry report, completes and accepts a processor-backed registered raw-scene
report, and drives the resulting Compare workspace through Chrome. Its final
cleanup enumerates and removes every project object, including comparison
reports, before archiving the temporary project and revoking the session.

The `Deploy and accept staging` GitHub workflow deploys the exact `main`
revision that passed `Release gate`, then uploads this report as immutable CI
evidence. Automatic staging deployment remains disabled until the scoped
Cloudflare API token is installed and a manual workflow dispatch from `main`
passes.

OTP is never bypassed in staging. Public acceptance verifies the anonymous and
protected-route boundaries; a periodic operator smoke test must complete the
real email OTP and managed Turnstile flow before a production release.
