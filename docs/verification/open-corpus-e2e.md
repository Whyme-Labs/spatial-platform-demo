# Open spatial corpus end-to-end verification

- Recorded: 2026-07-28
- Environment: local Cloudflare Worker with local D1, R2, KV, Queues, remote
  Workers AI, and the production processing agent
- Renderer: Spark 2.1.0
- Processor: `spatial-processor/0.7.0`

## Result

The pinned open corpus passes the production-shaped local path:

```text
seeded email OTP challenge
  -> ES256 JWT session
  -> project creation
  -> multipart R2 upload
  -> D1 processing job
  -> worker-token lease and heartbeat
  -> integrity and format validation
  -> metric point-cloud normalisation and floorplan proposal
  -> operator review and SVG/PDF/DXF export
  -> Spark RAD and poster generation
  -> Workers AI privacy scan
  -> human-style privacy disposition
  -> QA approval
  -> immutable public release
  -> short-lived scene token
  -> private range delivery
  -> real Chrome/Spark render
```

Run:

```sh
npm run corpus:all
npm run corpus:e2e:local
```

Machine-readable evidence:

- `.cache/open-corpus/reports/upstream-verification.json`
- `.cache/open-corpus/reports/derived-provenance.json`
- `.cache/open-corpus/reports/compatibility-matrix.json`
- `.cache/open-corpus/reports/worker-e2e-2026-07-28T17-30-07-499Z-c703a878.json`
- `.cache/open-corpus/reports/viewer-e2e-2026-07-28T17-30-07-499Z-c703a878.png`

The final run completed in about 312 seconds with 15 fixture lanes and 28
passing assertions. The browser reported
`Spark 2.1.0 ready`, found one renderer canvas, and recorded no page errors,
console errors, or HTTP responses at or above 400.

The floorplan lane produced a two-room, five-wall, one-opening proposal,
recorded an operator-reviewed indicative revision, and downloaded
hash-verified SVG (2,065 bytes), PDF (1,453 bytes), and DXF (1,663 bytes)
exports.

## Covered production lanes

| Fixture lane | Source | Expected | Observed |
|---|---|---|---|
| Gaussian SPZ v4 | AWS Laundry Room SOG, converted with SplatTransform | Normalise NGSP v4, build RAD, poster, report | `SUCCEEDED` |
| Metric point cloud | PDAL LAZ | Bounded evidence validation | `SUCCEEDED` |
| Floorplan metric point cloud | Deterministic derived indoor PLY | Native metric normalisation, proposal, review, and SVG/PDF/DXF export | `READY_FOR_REVIEW`, reviewed and exported |
| Source image | OpenSfM Berlin JPEG | Bounded image validation | `SUCCEEDED` |
| Source video | Derived OpenSfM MP4 | ISO-BMFF validation | `SUCCEEDED` |
| Camera poses | OpenSfM reconstruction JSON | JSON validation | `SUCCEEDED` |
| Calibration | OpenSfM-derived YAML | Calibration evidence validation | `SUCCEEDED` |
| IMU contract | Explicitly synthetic CSV | Contract and transport only | `SUCCEEDED` |
| GNSS contract | Explicitly synthetic JSON | Contract and transport only | `SUCCEEDED` |
| Collision mesh | Khronos Box GLB | GLB validation | `SUCCEEDED` |
| Drone image bundle | Two CC0 Aukerman JPEGs | ZIP validation and multipart transfer | `SUCCEEDED` |
| XGRIDS raw transport | Explicitly synthetic XBIN | Opaque transport only | `SUCCEEDED` |
| FJD raw transport | Explicitly synthetic FJDSLAM | Opaque transport only | `SUCCEEDED` |
| LCC2 transport | Explicitly synthetic LCC2 | Opaque transport only | `SUCCEEDED` |
| Point cloud mislabeled as Gaussian | PDAL ordinary PLY | Fail closed | `FAILED` with `INVALID_GAUSSIAN_PLY` |

The negative PLY was rejected because it lacks the three DC colour fields,
opacity, three scales, and four quaternion fields. No web derivative or
release was created from it.

## Defects discovered and closed

1. **Modern SPZ was not accepted by Spark's Rust decoder.** NGSP v4 is now
   detected and normalised through pinned SplatTransform 3.1.7 while the
   immutable source remains retained.
2. **Standard SPLAT was forced through SH3.** The processor now uses SH0 for
   the SH-free standard SPLAT contract.
3. **KSPLAT SH degree was assumed to be three.** KSPLAT is normalised to a
   Gaussian PLY, its actual SH degree is detected, and Spark receives the
   matching bound.
4. **YAML calibration was advertised but rejected by capture adapters.**
   Portable JSON/CSV/YAML calibration evidence is now accepted for XGRIDS,
   FJD, phone/video, and drone capture paths.
5. **Poster rendering monopolised headless Chromium and timed out after about
   fourteen minutes.** The poster renderer now yields between bounded frames,
   uses a 640 x 360 and 500k-splat budget, captures the preserved canvas
   buffer directly, and rejects blank or malformed PNG output.
6. **The verification client could outlive its short JWT.** It now exercises
   refresh-token rotation instead of treating a long job as an auth failure.
7. **Successful SplatTransform progress was labelled as an error.** Child
   stderr is now retained as a `.stderr` diagnostic stream; a regression test
   prevents ordinary CLI progress from creating false error telemetry.
8. **Metric input had no vendor-neutral authoring path.** The processor now
   normalises PLY/E57/LAS/LAZ/PTS through pinned native/PDAL readers, enforces
   a bounded sample budget and canonical Y-up coordinates, and stores an
   immutable proposal report before human review and export.
9. **Static asset routes could bypass Worker headers or return 404 when forced
   through the Worker.** Explicit static pass-through routes now preserve
   Cloudflare Assets delivery while applying request IDs, CSP, and production
   HSTS.

## Staging deployment proof

The exact processor image was published to isolated staging and production
resources on 2026-07-28:

- Application Worker:
  staging `c70c026c-3221-4593-b489-a811e09edeae`,
  production `d5387683-c72c-4a75-b751-c3fc61f0468a`
- Processor Worker and container:
  staging `117312e4-f252-4128-b8e3-98d07b743b19`,
  production `0e7d2031-9e2c-4600-9d76-2e82fc7d9240`
- Processor image digest:
  `sha256:05751ed5c0cadbb8cae4c6fc0d5b71e6a2d58490c06237a75b6ace41be76f612`

Live staging and production health checks returned HTTP 200. The processor
identified
`spatial-processor/0.7.0`, `Spark 2.1.0`, and
`cloudflare-container` execution. Authenticated corpus mutation remains a
local disposable proof because the staging OTP and JWT secrets are
intentionally non-exportable; staging validation does not bypass that
security boundary.

## Honest boundaries

- The XBIN, FJDSLAM, and LCC2 files are synthetic opaque containers. They
  prove upload, retention, audit labelling, and evidence handling only. They
  do not prove a vendor decoder, scanner provenance, or licensed export.
- PLY/E57/LAS/LAZ/PTS now have production-format readers and bounded
  normalisation for floorplan proposals. This does not prove source
  registration, absolute accuracy, or suitability for certified measurement.
- The deterministic indoor PLY proves the complete software path and geometric
  review contract. It is not evidence of K1/P2 capture quality.
- The Khronos box proves lawful GLB transport, not automatic indoor collision
  or navmesh quality.
- OpenSfM Berlin is outdoor. It supplies lawful image/pose evidence but is not
  an indoor capture-quality benchmark.
- The AWS Laundry Room scene has no authored presentation camera. Automatic
  framing renders a genuine scene but is not a substitute for operator camera
  and upright-orientation approval before customer publication.
- Browser proof is a real headless Chrome run. Physical iPhone, mid-range
  Android, thermal, memory-pressure, and carrier-network measurements remain
  separate acceptance gates.

## Fixture provenance

Upstream hashes, immutable commit URLs, licence URLs, attribution, derivation
recipes, and exclusions are maintained in
[`../research/open-test-corpus.md`](../research/open-test-corpus.md) and
[`../../test/open-corpus/manifest.json`](../../test/open-corpus/manifest.json).
