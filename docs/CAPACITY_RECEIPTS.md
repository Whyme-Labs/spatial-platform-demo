# Capacity receipts

Last measured: 2026-08-02

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
