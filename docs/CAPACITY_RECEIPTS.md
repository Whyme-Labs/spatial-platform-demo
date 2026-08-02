# Capacity receipts

Last measured: 2026-08-02

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
