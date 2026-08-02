# Testing strategy

Spatial Studio uses four complementary test layers. A change is production-ready
only when the public behavior at its relevant seam is covered and the complete
`npm run check` gate passes.

## Test layers

| Layer | Public seam | Command | Current scope |
| --- | --- | --- | --- |
| Unit | Pure modules and bounded adapters | `npm run test:unit` | Action state, capture formats, geometry and floor-plan logic, navigation triangles/obstacles/transitions, coordinate transforms, OIDC helpers, processor validation, privacy detection, Turnstile verification |
| Integration | Worker HTTP routes and Cloudflare bindings | `npm run test:integration` | D1, R2, KV, queues, email, authentication, tenancy, billing state, processing, review, release and lifecycle workflows |
| Navigation contracts | Offline build and movement evidence | `npm run test:navigation` | Structural shell validation, Recast/Detour export, Walk/Fly collision sweeps, corner slides, dynamic doors, connectivity, and deterministic physical-runtime probes |
| End to end | Production browser bundle | `npm run test:e2e` | Landing and live-demo messaging, OTP pending/error/retry behavior, responsive sign-in and Turnstile, authenticated project controls, navigation authoring/review spacing, Spark renderer chrome, Walk/Fly input, floor plan, and the host-to-renderer navigation snapshot handoff |
| Deployed staging | Cloudflare edge, deployed Workers and remote bindings | `npm run verify:staging` | Worker deployments, security/auth boundaries, D1 migration state, exact R2/KV canary round trips, processor Container health and cleanup evidence |

The Studio browser gate measures column starts and resolved grid tracks across
every columnar Projects, Jobs, Releases, and Team row, including their headers
and differing action states. The published-viewer gate also rejects any
absolute Spark startup watchdog; progress continues until Spark reports ready,
an explicit renderer error, or the operator retries.

`npm test` runs all Worker unit and integration tests once. `npm run test:all`
runs the instrumented Worker suite plus browser E2E.

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

The v7 release gate treats navigation as immutable production evidence. A build
must prove room-anchor enclosure, both-direction Walk/Fly wall sweeps, capsule
corner sliding, room-route replay, and open/closed door parity before Studio can
approve it or a movement-enabled release can be published.

The v8 extension additionally builds disconnected floors through a reviewed
Detour link, replays every allowed 3D path direction with the production Rapier
capsule, unit-tests non-teleport controller timing and one-way behavior, and
drives an Arrow-key browser traversal from the lower to the upper landing.

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

The `Deploy and accept staging` GitHub workflow deploys the exact `main`
revision that passed `Release gate`, then uploads this report as immutable CI
evidence. Automatic staging deployment remains disabled until the scoped
Cloudflare API token is installed and a manual workflow dispatch from `main`
passes.

OTP is never bypassed in staging. Public acceptance verifies the anonymous and
protected-route boundaries; a periodic operator smoke test must complete the
real email OTP and managed Turnstile flow before a production release.
