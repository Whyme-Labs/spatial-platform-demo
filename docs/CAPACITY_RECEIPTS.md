# Capacity receipts

Last measured: 2026-08-25

## Frontend CSS ownership receipt

Last measured: 2026-08-24

The UI audit baseline was measured from `styles.css` at commit `0d20ec1`
with a PostCSS AST inventory:

| Source | Bytes | Lines | Rules | Selectors | Declarations | `!important` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| mixed baseline | 160,868 | 3,757 | 1,450 | 1,666 | 4,655 | 24 |
| owned sources | 141,464 | 3,665 | 1,313 | 1,460 | 4,080 | 15 |
| measured change | -19,404 | -92 | -137 | -206 | -575 | -9 |

The reduction is a receipt, not a target. It came from deleting source-proved
dead prototype families, consolidating the authoritative shell/feedback/
record/dialog contracts, and removing accidental important declarations.
The remaining important declarations are limited to hidden and screen-reader
content, reduced motion, and forced-color focus/state handling.

Reproduce the owned-source measurement and enforce the ownership contract from
the repository root:

```bash
npm run audit:css -- --json
```

The command fails for unlayered rules, a changed entry graph, cross-owner core
selectors, duplicate selector/property declarations in one condition,
undefined static custom properties, ID selectors, page-root overflow masks,
unscoped viewer rules, or important declarations outside accessibility
exceptions. Re-run the browser UI matrix whenever a rule moves between owners;
a lower byte count alone is not evidence that the migration preserved layout.

## Responsive visual-baseline receipt

Last measured: 2026-08-25

`npm run audit:visual-baselines` verifies 29 reviewed PNGs containing
1,497,187 bytes against `e2e/visual-baselines.sha256`. The images were
generated in `mcr.microsoft.com/playwright:v1.62.0-noble` at pulled image
digest
`sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07`,
the Ubuntu/Chromium environment pinned for baseline review and matched by the
CI browser job.

Twenty images are the paired populated-Studio and ready-viewer matrix at the
ten supported viewports. Nine state images cover Studio session loading,
empty projects, 100 records, pending plus completed processing, inline
validation, a short-height long error, viewer loading, access failure, and the
short-landscape navigator. The long fixtures use the contract maxima of 120
characters for project/viewer titles, 255 characters for upload filenames, and
80 characters for release slugs.

The portfolio-health readout has its own geometry receipt at the exact compact
boundary. The browser contract resolves four contained columns at 641 × 800 and
two contained columns at 640 × 800, with no per-fact radius or shadow. Reproduce
that boundary receipt with:

```bash
npx playwright test e2e/ui-quality.spec.ts \
  --grep "portfolio health is one integrated readout"
```

The pixel-by-pixel Studio transition receipt is produced by:

```bash
npx playwright test e2e/ui-quality.spec.ts \
  --grep 'every critical transition pixel'
```

It measures every integer viewport width from 945 through 1110 px and attaches
`studio-transition-corridor.json` to the Playwright report. Each row records
shell tracks, Studio-grid width, active-workspace width, and sidebar width.
The gate verifies root overflow ownership, exact one-track/two-track mode,
active-workspace equality with its grid, primary-workspace dominance over the
navigation rail in side-rail mode, and non-decreasing width inside each mode.
The width interval is the audit's prescribed critical corridor, not a runtime
capacity limit.

## Staging lifecycle canary budgets

Last measured: 2026-08-13

The expanded two-version lifecycle ran against exact repository revision
`87b72e21ee1dabcb09ea407de840d8aa245e4ade`, Cloudflare staging application
version `f9fd9d6f-bdfb-427c-bc02-27fada1ff1f1`, and processor Worker version
`4eb93f61-e3f1-49ed-84be-56a188bda7cf`. The processor reported that exact Git
SHA and used immutable container image digest
`sha256:1e86416ebdc1054d99baab89864a173e1bd3dc8b6da2d5624e6638d27872ebfd`.
GitHub Actions run
[`31672823087`](https://github.com/Whyme-Labs/spatial-platform-demo/actions/runs/31672823087)
preserves the application acceptance, processor round-trip, lifecycle JSON,
and Chrome screenshot. Rerun the lifecycle from the repository root with a
staging-only canary credential:

```bash
STAGING_LIFECYCLE_CANARY_TOKEN='<staging secret>' \
STAGING_APP_ORIGIN='https://spatial-studio-staging.swmengappdev.workers.dev' \
npm run verify:staging:lifecycle -- \
  --report .cache/staging-acceptance/lifecycle-canary.json \
  --screenshot .cache/staging-acceptance/lifecycle-canary.png
```

Run `2026-08-13T06-16-00-382Z-9762c7d1-7013-4f15-8c3b-7c32789bc7d7`
completed in 329,629 ms. It authenticated the fixed service identity, created a
project, uploaded a deterministic 688,551-byte/12,288-splat Gaussian PLY and a
34,610-byte/2,234-point registered metric PLY, and passed the real processor.
It then reviewed the automatic floor plan and Recast navigation, recorded a
walk test, and proved comparison remained unavailable with only one eligible
immutable version. A second version used a 35,138-byte/2,266-point metric PLY
with a small asymmetric change. Both versions passed processing and navigation
qualification before visual, authored-geometry, and raw registered comparison
were exercised. The raw automatic registration was unambiguous and accepted;
both authored and raw evidence received explicit service-operator review.

The same run completed privacy and QA, rendered authenticated Studio plus its
two-version comparison in mobile/touch Chrome, published and rendered the
token release through `/s/lifecycle-canary-789bc7d7`, revoked the release,
archived the project, deleted 27 R2 objects including 21 processor job-output
objects, and revoked the session. Immutable archived D1 evidence was retained
deliberately. One access-token refresh completed during the run.

| Named budget | Observed maximum | Tripwire |
| --- | ---: | ---: |
| `lifecycle_canary_window_seconds` | 329.629 s complete lifecycle | 1,800 s |
| `api_request_milliseconds` | 4,853 ms | 60,000 ms |
| `object_request_milliseconds` | 934 ms | 30,000 ms |
| `chrome_navigation_milliseconds` | 777 ms | 30,000 ms |
| `chrome_ready_milliseconds` | 8,542 ms | 120,000 ms |
| global-deadline-bounded Wrangler subprocess | 1,715 ms | remaining lifecycle window |

Authenticated Studio reached its visible project workspace and rendered the
comparison in 16,352 ms. The public release reached a ready Spark renderer in
7,938 ms. The canary polls
asynchronous state every 5,000 ms; this is a request-cadence control rather than
a developer-facing capacity ceiling. Every network, Chrome, D1, and R2 action
is bounded by the remaining global lifecycle window. Wrangler is terminated if
that window expires, and a run that crosses the window cannot report success.
Every timeout failure names its budget, limit, requested duration, and
operation. Remeasure after processor, fixture, region, or Chrome changes;
resize a tripwire if a known-good run approaches it.

The two comparison assets each contained 45,280 bytes. Their downloaded
SHA-256 values,
`bfeef504543e7253dad87aaa7e682d50788b517a7b8043008f844e75c0a2ede3`
and `e146aa60d78f88a79319e4c422757eca3ad44e285f2f11e8631f857fae9342d0`,
matched the immutable source records. The published baseline artifact also
matched its public manifest. The immediately preceding deployed run
[`31669287764`](https://github.com/Whyme-Labs/spatial-platform-demo/actions/runs/31669287764)
correctly blocked the old byte-identical, rotationally symmetric geometry pair
as ambiguous. The revised exact fixture adds a deterministic asymmetric marker
to both versions and a second small marker only to the candidate; the local
regression and this live receipt prove accepted automatic registration and a
non-empty raw voxel change.

## Processing dispatch exhaustion budget

Last measured: 2026-08-13

`jobDispatchExhaustionLimit=6` and `jobDispatchBackoffMinutes=10`
(`src/worker/index.ts`) bound how long a queued processing job may be
re-dispatched without ever being leased before it dead-letters as
`dispatch_exhausted`. The minutely reconciliation cron (`"* * * * *"` in
`wrangler.jsonc`) re-enqueues a dispatchable job at most once per ten-minute
backoff window, so six dispatches span roughly fifty minutes, and the reaper
additionally requires the final dispatch to be at least one full window old:
a job whose dispatches never reach a processor dead-letters about one hour
after its first dispatch and surfaces on the same failure dashboard as a
`lease_expired` job.

The hour is a tripwire sized against the measured healthy path, not a target.
Staging run `2026-08-12T14-58-37-247Z-f864bc47-f6e0-489f-b52a-bde9de7074e8`
(`verify:staging:lifecycle` against
`https://spatial-studio-staging.swmengappdev.workers.dev`) moved both real
processing jobs (`asset.validate`, `asset.evidence-validate`) from
uploads-completed at `14:58:43.282Z` to `SUCCEEDED` at `14:59:17.880Z` —
34.598 s including the canary's 5,000 ms poll cadence — so the exhaustion
horizon is roughly 104 times a measured complete dispatch-lease-process round
trip. The local FJD lane measured 38,161 ms of processing for a 536 MB input.
A lease grant resets `dispatch_count` to zero, so a slow-but-working processor
can never be dead-lettered by this budget; only a delivery path that fails six
spaced windows in a row can.

Reproduce the contracts from the repository root with:

```sh
npx vitest run test/platform.spec.ts --silent=passed-only -t "dispatch"
```

They measure exactly six dispatches before the dead-letter, the
`JOB_DISPATCH_EXHAUSTED` failure reaching the hosting dashboard, a
dispatch-exhausted canary staying out of the scene lifecycle, and a lease
grant resetting the budget. Remeasure if the cron cadence, backoff window, or
queue delivery path changes.

## Public scene-asset R2 miss budget

Last measured: 2026-08-13 (paging session measured 2026-08-03)

`publicAssetMissLimitPerWindow=300` and `publicAssetMissWindowSeconds=60`
(`src/worker/index.ts`) meter only `/public-asset` reads that miss the edge
cache and fall through to R2, per client address. A warm viewer session
consumes zero budget and zero D1 writes.

The measured worst case is a fully cold page-in of the largest known web
derivative: the 141,351,968-byte FJD P2 Horse RAD. Run
`2026-08-03T05-42-10-918Z-4be9575a` paged the entire container through 45
HTTP 206 range responses (mean 3,142,520 bytes, largest 3,334,568 bytes)
during a 32,606 ms headless-Chrome render — about 45 misses in 33 seconds,
or ~83 per minute if a viewer somehow stayed fully cold. The staging
lifecycle canary's public release reached a ready Spark renderer in 7,938 ms
with far fewer ranges. The budget is therefore 6.7 times the complete cold
page-in of the largest known asset, and it caps anonymous R2 egress at about
954 MiB per address per window (300 × the largest observed range).

This remains judgment-sized against single-viewer measurements: many viewers
behind one NAT share an address budget, and no production traffic
distribution has been measured yet. Remeasure with real traffic analytics
once the platform has anonymous production load, and whenever Spark's paging
chunk size or the RAD LoD layout changes.

Recount the stored paging receipt and rerun the contracts from the
repository root with:

```sh
node -e 'const r = require("./.cache/fjd-sample-corpus/reports/local-platform-e2e-2026-08-03T05-42-10-918Z-4be9575a.json"); const sizes = r.privatePreview.sceneResponses.map((s) => { const [a, b] = s.contentRange.split(" ")[1].split("/")[0].split("-"); return Number(b) - Number(a) + 1; }); console.log({ responses: sizes.length, renderMs: r.privatePreview.elapsedMilliseconds, meanRangeBytes: Math.round(sizes.reduce((x, y) => x + y, 0) / sizes.length), maxRangeBytes: Math.max(...sizes), receipt: r.privatePreview.radRangeReceipt });'
npx vitest run test/platform.spec.ts --silent=passed-only -t "R2 misses"
```

The contracts prove edge hits are never counted against the budget, a
legitimate paging session is never throttled, and an exhausted budget answers
429 with the real window in `Retry-After` while already-cached ranges keep
serving.

## Per-tier scene-asset download ceilings

Last derived: 2026-08-13

`MAX_SCENE_ASSET_BYTES` (`src/renderer/main.ts`) applies only to non-paged
SPZ/SOG scenes, which download and decode whole before the first frame; paged
RAD scenes stream bounded chunks against the splat budget and are exempt. The
tiers are derived from two existing receipts rather than guessed:

- the browser-side `collision_glb_bytes=268435456` cap (above), a 256 MiB
  whole-buffer decode the browser demonstrably performs; and
- the receipted default splat budgets served by the Worker render manifest
  (0.75M mobile-lite, 1.25M mobile-standard, 2M desktop-standard).

Desktop keeps twice the collision cap; the mobile tiers scale the collision
cap by their splat-budget ratio against desktop-standard:

| Tier | Derivation | Ceiling |
| --- | --- | ---: |
| `mobile-lite` | 256 MiB × (0.75 / 2) | 100,663,296 bytes (96 MiB) |
| `mobile-standard` | 256 MiB × (1.25 / 2) | 167,772,160 bytes (160 MiB) |
| `desktop-standard` / `desktop-high` | 256 MiB × 2 | 536,870,912 bytes (512 MiB) |

These are OOM tripwires that convert a certain mobile tab-kill into an
explicit, retryable `SCENE_ASSET_TOO_LARGE` error naming the ceiling — not
delivery targets. The largest known web derivative, the 141,378,928-byte FJD
RAD, is paged and even fully downloaded would use 26% of the desktop ceiling;
a 2M-splat SH0 SPZ measures around 32 MiB, a fifth of the mobile-standard
ceiling. A legitimate compact derivative that approaches these ceilings means
the publish pipeline should have produced a paged RAD instead.

Reproduce the derivation from the repository root with:

```sh
node - <<'NODE'
const collisionCapBytes = 268435456;
const budgets = { mobileLite: 0.75, mobileStandard: 1.25, desktopStandard: 2 };
console.log({
  mobileLiteBytes: collisionCapBytes * (budgets.mobileLite / budgets.desktopStandard),
  mobileStandardBytes: collisionCapBytes * (budgets.mobileStandard / budgets.desktopStandard),
  desktopBytes: collisionCapBytes * 2,
});
NODE
```

Rederive if the collision cap, the default splat budgets, or the set of
non-paged formats changes.

## Renderer heartbeat and viewer liveness watchdog

Last measured: 2026-08-13

`HEARTBEAT_INTERVAL_MS=5000` (`src/renderer/main.ts`) and
`RENDERER_LIVENESS_TIMEOUT_MS=30000` (`src/client/viewer.ts`): a ready
renderer posts a low-frequency heartbeat so a visible tab whose iframe
process died silently (mobile OOM kill, GPU-process death — states that fire
no `webglcontextlost`) is detected instead of leaving a frozen canvas behind
a healthy-looking viewer.

Measured on the built renderer with the movement-integrity walking fixture in
headless Chromium: 13 heartbeats over 65 s post-ready with inter-arrival gaps
of 4,999–5,001 ms (mean 5,000 ms), the first 4,999 ms after `ready`. The
30,000 ms timeout therefore requires six consecutive missed beats and holds
25 s of margin beyond the worst observed gap. The watchdog arms only on the
first post-ready heartbeat (a renderer that never heartbeats is never misread
as dead), any renderer message re-arms it, and a hidden tab gets a fresh
window on resume because browsers throttle background timers to a crawl.

Reproduce from the repository root with:

```sh
npm run build:e2e
node scripts/measure-renderer-heartbeat.mjs --seconds 65
npx playwright test e2e/published-viewer.spec.ts -g "heartbeat|suspended tab"
```

The Playwright contracts pin the stopped-heartbeat retryable error, the
never-heartbeating renderer staying healthy, and the suspended-tab resume not
being misread as death. Remeasure after renderer main-loop, Spark, or Chrome
changes; five seconds of interval is a request-cadence control, and the 30 s
timeout is the tripwire to resize if a known-good renderer ever approaches it.

## PLY coordinate-header preflight

Last measured: 2026-08-12

The checked repository and ignored qualification corpus contains ten readable
PLY files. The largest header ends at byte 1,532 in each FJD P2 Horse Gaussian
fixture. Capture intake and the processor read at most
`ply_coordinate_header_bytes=2097152`, 1,368 times that measured maximum. A
header that reaches the tripwire blocks intake and names the budget, limit, and
first rejected request. Ordinary files whose metadata is unavailable may use
explicit same-frame attestation; a too-large header may not bypass inspection.
Automatic qualification then streams every declared binary vertex; it does not
sample the bounds.

Remeasure from the repository root with:

```sh
find assets test .cache -type f -iname '*.ply' -print0 2>/dev/null | \
  xargs -0 -n1 sh -c 'p="$0"; n=$(LC_ALL=C awk "BEGIN{n=0} {n+=length(\$0)+1; if (\$0==\"end_header\") {print n; exit}}" "$p" 2>/dev/null); if [ -n "$n" ]; then printf "%s\t%s\n" "$n" "$p"; fi' | \
  sort -n
```

Remeasure and resize the tripwire if a known-good header approaches it.

## US ADA route-review preset

Last verified: 2026-08-10

The optional `ada-route-review` navigation preset is a conservative geometry
review aid, not an accessibility certification. It uses the US Access Board's
36-inch continuous accessible-route width, 1/2-inch maximum threshold, and
1:12 maximum ramp slope. The circular navigation agent therefore has a
0.4572-metre radius, the climb check uses 0.0127 metres, and the slope check
uses 4.763641690726178 degrees. The broader standard also governs doors,
turns, passing spaces, landings, surfaces, controls, and other conditions that
this navigation profile cannot certify.

Primary references:

- https://www.access-board.gov/ada/guides/chapter-4-accessible-routes/
- https://www.access-board.gov/ada/guides/chapter-4-entrances-doors-and-gates/
- https://www.access-board.gov/ada/guides/chapter-4-ramps-and-curb-ramps/

Reproduce the conversions from the repository root with:

```sh
node - <<'NODE'
const inchesToMetres = 0.0254;
console.log({
  routeWidthMetres: 36 * inchesToMetres,
  agentRadiusMetres: 36 * inchesToMetres / 2,
  thresholdMetres: 0.5 * inchesToMetres,
  rampSlopeDegrees: Math.atan(1 / 12) * 180 / Math.PI,
});
NODE
```

Reverify the cited standard before changing the preset or its label.

## Exact horizontal-surface tolerance

Last measured: 2026-08-03

The checked authored-navigation JSON corpus contains 783 finite numeric values.
Its largest absolute scalar is 80 and its largest measured Float32 round-trip
error is `4.196166987213701e-7`. The shared horizontal-surface validator uses
`geometry_epsilon=1e-6`, 2.38 times that measured error, for coplanarity,
zero-edge, intersection, and area-consistency checks. This is an input-quality
tripwire: an otherwise valid known-good structural artifact rejected by it
requires remeasurement and a scale-aware replacement, not a silent catch.

Remeasure from the repository root with:

```sh
node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
let maxError = 0;
let maxAbs = 0;
let count = 0;
for (const name of fs.readdirSync('assets')) {
  if (!name.endsWith('.json')) continue;
  let value;
  try { value = JSON.parse(fs.readFileSync(path.join('assets', name), 'utf8')); } catch { continue; }
  const visit = (node) => {
    if (typeof node === 'number' && Number.isFinite(node)) {
      count += 1;
      maxAbs = Math.max(maxAbs, Math.abs(node));
      maxError = Math.max(maxError, Math.abs(node - Math.fround(node)));
    } else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') Object.values(node).forEach(visit);
  };
  visit(value);
}
console.log({ numericValues: count, maxAbsoluteCoordinateOrScalar: maxAbs,
  maxFloat32RoundTripError: maxError });
NODE
```

## Browser collision proxy tripwires

The checked local collision corpus contains four Home Scan GLBs. The largest
measured proxy is `home-scan-physical.collision.glb` at 551,168 bytes, 15,644
vertices, and 30,232 triangles. The browser/offline decoder tripwires remain:

- `collision_glb_bytes=268435456` (487 times the measured maximum);
- `collision_vertices=3000000` (191 times the measured maximum); and
- `collision_triangles=5000000` (165 times the measured maximum).

These are corruption/runaway-allocation tripwires, not supported asset targets.
Every failure reports the budget name, limit, and observed ask.

Remeasure from the repository root with:

```sh
node --input-type=module -e 'import {readFile} from "node:fs/promises"; import {extractCollisionGeometryFromGlb} from "./scripts/navigation-build-core.mjs"; const files=[".cache/spark-home-scan/home-scan-physical.collision.glb",".cache/spark-home-scan/home-scan-upright.collision.glb",".cache/spark-home-scan/home-scan-structural-v7.glb",".cache/spark-home-scan/home-scan-authored-navigation-v6.glb"]; for (const file of files) { const bytes=await readFile(file); const geometry=await extractCollisionGeometryFromGlb(bytes); console.log(JSON.stringify({file,bytes:bytes.length,vertices:geometry.positions.length/3,triangles:geometry.indices.length/3})); }'
```

Update this receipt and resize the tripwires if a known-good collision proxy
approaches them.

## Authored traversal protocol domains

The authored-link `area`, `flags`, and `userId` ranges are wire-format domains,
not product capacity budgets. They come from the exact native Recast commit
frozen in every navigation artifact and from the installed
`@recast-navigation/core@0.43.1` binding:

- `area=0..63`: Detour reserves six bits for the area id and declares
  `DT_MAX_AREAS=64`; Recast declares `RC_WALKABLE_AREA=63`.
- `flags=1..65535`: Detour stores polygon and off-mesh flags as an unsigned
  16-bit value. Spatial Studio reserves zero as non-traversable, so authored
  traversals must ask for at least one flag bit.
- `userId=0..4294967295`: Detour stores off-mesh user ids as an unsigned
  32-bit value.

Protocol receipts, pinned to native commit
`599fd0f023181c0a484df2a18cf1d75a3553852e`:

- [Detour area count and packed area field](https://github.com/recastnavigation/recastnavigation/blob/599fd0f023181c0a484df2a18cf1d75a3553852e/Detour/Include/DetourNavMesh.h#L85-L87)
- [Detour off-mesh field types](https://github.com/recastnavigation/recastnavigation/blob/599fd0f023181c0a484df2a18cf1d75a3553852e/Detour/Include/DetourNavMeshBuilder.h#L56-L66)
- [Recast walkable area maximum](https://github.com/recastnavigation/recastnavigation/blob/599fd0f023181c0a484df2a18cf1d75a3553852e/Recast/Include/Recast.h#L583-L591)

If the native commit or JS binding changes, re-read those declarations before
changing the contract. Do not treat these protocol widths as adjustable
tripwires.

## Traversal evidence session lifecycle

Traversal evidence session storage is bounded by release state, not by a
silent row cap. A public manifest creates zero credentials and zero session
rows. An authenticated reviewer has one logical run per authoritative auth
session and channel activation; credential renewal preserves that run and its
sequence row. The browser owns no run identity. Concurrent tabs, a lost
response, disabled storage, storage eviction, and reload all ask the server for
the same auth-session-derived UUID. If an idle tab resumes after cleanup, the
server reconstructs that UUID and continues `next_sequence` from its immutable
events instead of requiring a guessed grace period. A monotonic channel-
activation generation is part of the row, signed bearer, database guard, and
session UUID.
Publishing a replacement revision, rolling back, revoking, or expiring the
active channel advances that identity, so returning to an older release cannot
resurrect its prior session or bearer. Immutable diagnostic events remain
available for review. Ingestion and the database guard also re-check the
authoritative auth session, active organisation membership, and current
operator or `customer_reviewer` project access. Logout, membership revocation,
and project-access revocation therefore stop new qualification evidence
immediately rather than leaving a residual bearer window.

The one-row property is a database uniqueness invariant, not a developer-facing
quota: `(channel_id, release_id, activation_generation, auth_session_id)` is
unique and the deterministic upsert returns the canonical row. A separately
authenticated physical device has a separate authoritative auth session. There
is no guessed per-account or per-release run cap.

Security invalidation and storage retirement are deliberately separate.
Release/channel state and the signed activation generation reject a stale
bearer immediately; its small session row is retired after the credential's
own expiry. Lifecycle cleanup uses the
`viewer_telemetry_sessions_expiry_idx(expires_at_epoch, id)` range lane and
`telemetry_session_cleanup_batch=500`. The same indexed predicate drives the
bounded pending probe. There is no release join, full-table scan, or temporary
sort in either cleanup query.

The migration contract runs `EXPLAIN QUERY PLAN` and requires a covering search
through `viewer_telemetry_sessions_expiry_idx` with no `USE TEMP B-TREE`. The
Worker contract inserts 501 expired rows: the first lifecycle response reports
500 retired with 1 row still pending, and the second reports 1 retired with no
pending work. Every lifecycle response and operator digest also records D1's
provider-measured `rows_read` and `rows_written` for the deletion. These are
receipts, not a fixed performance claim: re-run them after an index, predicate,
or provider change.

Reproduce the lifecycle receipt from the repository root with:

```sh
npx vitest run test/platform.spec.ts --silent=passed-only \
  -t "runs the immutable Spark RAD publish, range delivery, and revoke path end to end"
```

The contract measures an unauthenticated session request as HTTP 401, the same
session UUID and one D1 row after two simultaneous first requests plus repeated
renewal under one auth session, and a different UUID for a separately
authenticated device. Browser coverage proves no traversal run key is stored
before or after reload. The contracts measure the indexed 501-row cleanup
receipt above and that explicit lifecycle enforcement removes an expired second
run while preserving the live run. They separately expire and remove a run
with two events, resume it under the same UUID, and measure the next event at
sequence 3. They also prove an R1 to R2 to R1 rollback creates a different
activation/session UUID, rejects renewal of the original UUID, and keeps the
original bearer invalid. A telemetry-scoped bearer cannot fetch a scene asset.
Separate mint-then-logout and mint-then-project-access-revocation contracts
reject the old bearer with HTTP 401, while the migration trigger independently
rejects revoked authorization.
This is a state-transition receipt; no maximum physical-run duration or total
account quota is inferred from it.

## FJD vendor qualification transport and artifact receipt

Last measured: 2026-08-03

The official P2 Horse source archive measured 2,587,208,251 bytes. Its ZIP
central directory measured 773 bytes and located the Gaussian PLY as a
481,046,648-byte deflated entry producing 536,812,164 bytes. The extractor
therefore transfers the selected entry rather than the full archive. The
separate V4e interior LAS measured 161,765,909 bytes. Both installed inputs are
stream-hashed and pinned in `test/vendor-corpus/fjd-manifest.json`; vendor bytes
remain in ignored `.cache` storage.

The only range-window constant is `ZIP_END_RECORD_SEARCH_BYTES=65557`. This is
not an estimated capacity limit: the ZIP protocol defines an end record of 22
bytes and a maximum comment length of 65,535 bytes. ZIP64 and multi-disk
archives fail with an explicit unsupported-contract error rather than silently
truncating offsets.

The inflating writer uses the manifest's exact uncompressed byte count as its
maximum, not a guessed allowance. If the stream asks for one byte more, the
error names the fixture budget, exact pinned limit, and observed ask before the
partial file can be installed. The current ignored cache measured 838,964 KiB
after both inputs, the RAD, and JSON receipts were present.

The measured P2 input contains 2,164,559 splats at SH degree 3. A cached-input
local qualification produced a signature-valid 152,148,256-byte RAD container
in 15,406 ms while
also rehashing both inputs and decoding the LAS with PDAL. Input acquisition is
excluded, and the streaming hash warms the PLY in the OS page cache before
Spark runs; this is not a cold-build claim. Pinned PDAL 2.9.2 decoded all
3,851,558 LAS points. It reported
unknown horizontal units and no spatial reference, so the sample is blocked
from metric registration, floor-plan generation, structural collision, and
navigation regardless of successful format decoding.

Spark includes measured build durations in RAD metadata. Two repeated builds
after streaming input verification produced 152,148,264 and 152,148,256 bytes
with different SHA-256 values. The production invariant is therefore exact
per-run output identity, not byte-for-byte reproducibility across builds.
Qualification always rebuilds the RAD and records that run's byte count and
SHA-256.

Reproduce the current receipts from the repository root:

```sh
npm run processor:setup
npm run processor:container:build
npm run corpus:fjd:inspect
npm run corpus:fjd:qualify
du -sk .cache/fjd-sample-corpus
```

Machine-readable remote, input, decoder, and output receipts are written under
`.cache/fjd-sample-corpus/reports`. Remeasure and update this section when FJD
replaces a sample, Spark changes its encoding, PDAL changes its decoder, or the
first paired indoor FJD bundle becomes available.

## FJD local adapter and strict-preview-gate tripwires

Last measured: 2026-08-03

The official FJD horse sample is a private adapter/processor qualification
input, not an indoor walking corpus or hosted demo. This command uses an
isolated loopback Worker, creates no release, and deletes its exact D1/R2 state:

```sh
npm run corpus:fjd:e2e:local
```

Current run `2026-08-03T10-02-35-458Z-e894261d` passed 16 assertions and
measured the strict product boundary:

| Receipt | Measured value |
| --- | ---: |
| Local Worker startup | 1,161 ms |
| Local Worker termination | 107 ms, no `SIGKILL` escalation |
| Slowest of 57 local API requests | 129 ms (`PUT` upload part 10) |
| FJD-to-RAD processing | 38,161 ms |
| Input PLY | 536,812,164 bytes |
| Quality RAD | 141,351,968 bytes |
| Poster | 328,018 bytes |
| Private preview without registered walking evidence | HTTP 409 |
| Release count | 0 |
| Observed HTTP origins | 1, loopback only |

The local API and Worker-startup tripwires remain 120,000 ms, more than 930
times the measured slowest API request and 103 times measured startup. Worker
termination gets 30,000 ms before escalation, more than 280 times the measured
shutdown. Every timeout error names its budget, limit, and observed ask. The
report records the Wrangler config hash, non-remote D1/R2/KV bindings,
`--local`, loopback IP, disposable `--persist-to` directory, and the terminal
facts `localWorkerOnly=true`, `cloudStorageUsed=false`,
`releaseCreated=false`, and `temporaryStateRemoved=true`.

Historical run `2026-08-03T05-42-10-918Z-4be9575a` predates the mandatory
walking-map gate. Its 29 assertions measured Spark compatibility only: a
32,606 ms headless-Chrome render, 45/45 HTTP 206 RAD ranges, an explicit 1.25M
splat budget, luminance range 222, and 155 four-bit RGB colour buckets. Those
numbers remain useful processor/renderer evidence but are not claims about the
current `corpus:fjd:e2e:local` command and cannot qualify a product preview.
The preceding historical run `2026-08-03T05-38-48-511Z-d13f0f4d` also retained
the observed disposable-R2-emulator HTTP 500 rather than hiding it with a
retry.

The remaining FJD qualification gap is explicit: obtain a redistributable,
registered indoor FJD capture with structural geometry, then run the complete
automatic floor-plan, collision, Detour, private-preview, and browser-walking
lane. Until that corpus exists, the horse sample proves FJD ingestion and RAD
generation plus correct fail-closed behavior; it does not prove FJD walking
reconstruction.

## FJD room-capture archive receipt

Last measured: 2026-08-20

The local source archive used for the private FJD room investigation is
`/Users/sohweimeng/Downloads/2026-08-12-17-14-01.fjdslamp2.tgz`.
It is 609,755,692 bytes with SHA-256
`3c9b4452d4470bb28170a09816ec52ef67671f9d129ffb2cc72f80619d3dec6e` and
contains one top-level `2026-08-12-17-14-01.fjdslamp2` entry. Reproduce with:

```sh
shasum -a 256 /Users/sohweimeng/Downloads/2026-08-12-17-14-01.fjdslamp2.tgz
stat -f '%N %z bytes' /Users/sohweimeng/Downloads/2026-08-12-17-14-01.fjdslamp2.tgz
tar -tzf /Users/sohweimeng/Downloads/2026-08-12-17-14-01.fjdslamp2.tgz
```

This receipt establishes source-byte identity only. It does not grant
commercial use, self-hosting, or redistribution rights and must not be used to
bypass the capture-bundle rights gate.

## FJD production private-upload receipt

Last measured: 2026-08-03

The official P2 Horse sample was uploaded only to private production storage for
compatibility qualification. Project
`87c7ab8e-6e61-4552-9ac9-cef577210f33` remains at `QA_REQUIRED`; its release
count is zero. Do not approve or publish it without a redistribution grant.

Wrangler 4.114.0 rejected a direct upload of the 536,812,164-byte PLY before
writing it and reported its measured CLI ceiling explicitly:

```text
Wrangler only supports uploading files up to 300 MiB in size
fjd-p2-horse-gaussian.ply is 512 MiB in size
```

The production capture-agent path returned `partSizeBytes=10485760`, so the
source traversed 52 resumable parts. Multipart completion recorded the exact
536,812,164-byte source and its pinned
`5146b69324c30fcf0946013a92b70d47eed825586a38756dc6f7d8613a9d5b65`
SHA-256. The one-project transfer credential was revoked after completion and
has one `capture_agent.revoke` audit event.

Cloud processing job `c36777a5-42bd-494f-98f3-7b647d0718f3` succeeded and
verified four project assets:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| Source PLY | 536,812,164 | `5146b69324c30fcf0946013a92b70d47eed825586a38756dc6f7d8613a9d5b65` |
| Browser RAD | 141,378,928 | `4793be46500e4dafb66afeaf2771804a474e2d366aa37ec63c66fff19921f1ed` |
| Poster PNG | 152,568 | `fc39f23d076a559681998840fc654b693377acae349ee38104c4b3bb6d36e884` |
| QA report | 1,512 | `a71529cec376fd8a604dbea9909eb86762ceaa8fcfb7de44a65f2e06b4c98404` |

The companion `.fjdata` and the locally qualified RAD were also stored under
private, content-addressed `qualification/fjd/p2-horse/` R2 keys. Full remote
reads reproduced their local SHA-256 values:

```text
e83fba620ac6a40f252d9d22818477eedc2bd82eb957eaf08511ac5c7c600489  capture.fjdata
ced83c79802465ca02be33e50907219a0270f4ca3ae87da66f4695a191ff50b3  scene.rad
```

Immediately after completion, Studio reported 61 tracked assets and 2.4 GiB of
private project storage. `wrangler r2 bucket info` still reported the earlier
69-object, 1.92-GB bucket aggregate, so bucket aggregate statistics are not an
acceptance receipt immediately after writes. Exact multipart completion,
database asset records, and full remote hash reads are the authoritative
receipts for this operation.

## Production-scale local QA list boundaries

Last measured: 2026-08-10

The inventory and dataset are derived from the current source rather than a
guessed tenant size:

```bash
npm run inventory:write
npm run audit:inventory
npm run qa:data:local
```

The inventory audit measured 4 roles, 191 Worker/client routes, 37 forms, 37
dialogs, 246 governed fields, 318 static/generated controls, 68 persisted state
sets, and 59 asynchronous workflows. The committed generated inventory records
the source location and acceptance/edge policy for every row.

`qa:data:local` reads each primary Studio list query and creates one synthetic
row beyond its existing SQL boundary in a new isolated `--persist-to`
directory. The accepted receipt contained only `example.invalid` identities,
recorded `sensitiveData=false` and `productionTouched=false`, and verified these
exact D1 counts:

| Entity | Existing query boundary | Generated and queried rows |
| --- | ---: | ---: |
| Projects | 200 | 201 |
| Project templates | 100 | 101 |
| Saved views | 50 | 51 |
| Processing jobs | 200 | 201 |
| Releases | 500 | 501 |

Each bounded inventory now reads one tripwire row past its measured page only
to determine whether an opaque keyset continuation exists. The tripwire row is
not returned on that page. The browser names the number of loaded records,
keeps the existing page usable during continuation, and removes the control
when the cursor is exhausted.

The first seed attempt batched every entity into one SQL statement and D1
returned `statement too long: SQLITE_TOOBIG`. The generator now emits one row
per statement instead of inventing an unmeasured batch size. The first
authenticated project load also measured that the 200-row parent query caused
`projectCustomFieldValues` to exceed D1's SQL-variable ceiling. The query now
passes its project IDs through one `json_each` parameter, and the regression
test exercises the same 200-row page.

## Automatic floor head-room persistence

Last measured: 2026-08-18

Command:

```bash
npx vitest run test/vendor-neutral-floorplan.spec.ts
```

The extractor reuses its existing three-vertical-bin persistence requirement
to distinguish isolated furniture returns from structure occupying standing
height. Vertical bins use the bounded physical voxel resolution, not the
independently configurable horizontal-surface band. It does not apply a new
global occupancy percentage. A candidate must instead contain a
four-neighbour-connected head-room-clear component at least as large as the
configured minimum room support.

The deterministic furnished-floor fixture measured 332 persistently occupied
cells out of 512 (0.648438), but its remaining clear region contains one
180-cell component against 64 required and is accepted. The cropped loaded-rack
fixture measured 526 occupied cells out of 640 (0.821875); its largest clear
component is only 19 cells against 64 required and is rejected. The test also
repeats that rack receipt at valid floor bands of 0.05, 0.15, and 0.5 m. The
corresponding measured vertical resolutions are 0.05, 0.125, and 0.125 m. The
test also proves zero wall support is rejected during screening and that
downstream extraction failures are reconciled into the same candidate
assessment.

The immutable FJD LAS replay receipt is recorded in
[`docs/research/fjd-sample-floorplan-failure-2026-08-18.md`](research/fjd-sample-floorplan-failure-2026-08-18.md):
its selected floor has an 85-cell clear component against the production
32-cell requirement, while the ceiling is rejected for zero wall support.

## Studio project-canvas width

Last measured: 2026-08-24

Command:

```bash
npx playwright test e2e/release-authoring.spec.ts \
  --grep 'flattened project sections reclaim' --reporter=json
```

The test opens the authenticated project fixture and measures `#detailBody`.
It then replays the removed `.output-section` border and responsive padding on
the same DOM before measuring again. This isolates the width consumed by the
extra section card without comparing different project data.

| Viewport | Nested section width | Flat section width | Reclaimed width |
| ---: | ---: | ---: | ---: |
| 1024 px | 655.53125 px | 698.46875 px | 42.9375 px |
| 768 px | 698 px | 732 px | 34 px |

The regression requires the flat width to exceed the replayed nested width at
both viewports. It does not turn either observed width into a minimum or a
budget. Re-run the receipt when the Studio shell, page padding, or project
workspace composition changes.

## Starting-view first-frame quality thresholds

Last measured: 2026-08-19

Command:

```bash
npx playwright test e2e/starting-view-quality.spec.ts
```

The spec drives the real Spark renderer against two deterministic fixtures and
prints the measured metrics: a camera facing a 2x2 m wall of overlapping
mid-grey splats from three metres, and the same camera turned 180 degrees into
the unreconstructed void. Both frames were sampled at 102,480 pixels of a
1280x720 buffer.

| Named budget | Facing content | Facing void | Tripwire |
| --- | ---: | ---: | ---: |
| `starting_view_near_black_fraction` | 0.446 | 1.000 | > 0.85 rejects |
| `starting_view_rendered_coverage_fraction` | 0.582 | 0.000 | < 0.10 rejects |
| `starting_view_mean_luminance` | 0.324 | 0.041 | warn-only < 0.06 |

Derivations: the renderer clears every uncovered pixel to `#080b0d`, whose
Rec. 709 luminance measured exactly 0.0412 in the void capture, so the
near-black luminance ceiling of 0.09 sits a little over twice the void level —
everything the clear colour paints counts as near-black and no lit surface
does. The two enforced tripwires (0.85 near-black, 0.10 coverage in
`src/shared/starting-view-quality.ts`) separate the measured regimes with wide
margin on both sides: the content capture deliberately leaves most of the
frame as void and still measures 0.45/0.58. The soft advisory band (0.60
near-black, 0.30 coverage, 0.06 mean luminance) warns in the publish dialog
without blocking. A receipt must carry at least 1,024 sampled pixels; the
renderer samples up to 65,536 on a stride, and even a minimal mobile canvas
exceeds the floor by two orders of magnitude. Remeasure by rerunning the spec
whenever the clear colour, tone mapping, or output colour space of the
renderer changes.

## Frontend route transfer and lazy-loading boundary

Last measured: 2026-08-25

Source baseline: `6eae367`, with the issue #83 route-audit and marketing-image
hydration changes in the measured worktree. The client chunks below carry
their own SHA-256 identities in `config/frontend-route-receipts.json`.

Reproduce the production-bundle receipt and enforce its structural tripwires
from the repository root with:

```bash
npm run audit:frontend-routes
```

The command builds in production mode, starts `vite preview`, and opens each
route in a fresh Chromium context at 1280x800, `en-US`, UTC, with service
workers blocked. The recorded run used Node 22.23.0, Vite 8.1.5, Playwright
1.62.0, Chromium 151.0.7922.34, and macOS arm64. CDP records response transfer
bytes while response metadata supplies encoded-body bytes. API fixture bodies
and the deterministic four-splat scene/collision files are excluded from the
frontend totals; their only job is to carry both viewer routes through the real
`spatial-spark:ready` movement-ready boundary.

| Route | Frontend encoded body | Frontend transferred | FCP | Route ready | Renderer first frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| Signed-out Studio | 205,067 B | 206,341 B | 116 ms | 169 ms | n/a |
| Authenticated portfolio | 205,067 B | 206,341 B | 40 ms | 82 ms | n/a |
| First private preview | 3,333,015 B | 3,334,647 B | 44 ms | 901 ms | 152 ms |
| First published viewer frame | 3,333,015 B | 3,334,647 B | 44 ms | 874 ms | 95 ms |

The Studio routes loaded only `studio-jAuhcphL.js`,
`action-state-DO3fNd-u.js`, and `world-units-SLVxYD65.js`. Each viewer route
also loaded the real renderer, physical-navigation, Detour, and Recast
compatibility chunks before `ready`. The exact filenames, raw byte counts,
source-map ownership classification, and SHA-256 digests are stored in the
machine receipt.

Two zero-limit tripwires are derived directly from the good paths:

- Signed-out Studio and authenticated portfolio measured zero chunks owned by
  `src/renderer`, Recast, or Rapier. Their
  `renderer_navigation_chunk_count` limit is therefore 0.
- After moving the shared page's hero sources behind marketing-route
  hydration, private and published viewer routes measured zero `/images/`
  requests. Their `unexpected_marketing_asset_count` limit is therefore 0.

These are structural lazy-boundary tripwires, not claims about general latency
or total-byte targets. On failure the audit names the route, budget, limit,
requested count, requested bytes, offending assets/chunks, and this receipt.
Wall-clock timings and total route bytes remain observations because local
server compression and runner scheduling vary. Regenerate the machine receipt
with `npm run build && node scripts/audit-frontend-routes.mjs --write` whenever
Vite, Playwright, Chromium, Spark, Recast/Rapier, entry imports, fonts, auth
bootstrap, renderer-ready semantics, or delivery compression/cache behavior
changes.

## Full software-gate receipt

Last measured: 2026-08-24

Command:

```bash
npm run check
```

The complete local production gate passed with 451 Worker/domain tests across
78 Vitest files, 134 navigation and migration contracts across 16 node-test
files, and 129 Playwright scenarios across 12 browser specs. Instrumented
coverage measured 72.99% statements, 63.42% branches, 86.18% functions, and
79.26% lines. The same command also passed generated types, TypeScript, CSS and
visual-baseline ownership audits, the action-state audit for 2 client entry
points, the control-wiring audit (151 static and 111 dynamic buttons, 23 static
and 10 dynamic links, 37 interactive forms, 246 governed lifecycle fields),
the current user-facing inventory, production-config and migration audits, the
production build, and a Cloudflare production deployment dry run. Remeasure
this receipt whenever those reported counts or coverage values change.
