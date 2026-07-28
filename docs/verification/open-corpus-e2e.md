# Open spatial corpus end-to-end verification

- Recorded: 2026-07-28
- Environment: local Cloudflare Worker with local D1, R2, KV, Queues, remote
  Workers AI, and the production processing agent
- Renderer: Spark 2.1.0
- Processor: `spatial-processor/0.6.2`

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
- `.cache/open-corpus/reports/worker-e2e-2026-07-28T13-04-12-959Z-e9f5eebd.json`
- `.cache/open-corpus/reports/viewer-e2e-2026-07-28T13-04-12-959Z-e9f5eebd.png`

The final run completed in about 152 seconds with 14 fixture lanes and 24
passing assertions. The browser reported
`Spark 2.1.0 ready`, found one renderer canvas, and recorded no page errors,
console errors, or HTTP responses at or above 400.

## Covered production lanes

| Fixture lane | Source | Expected | Observed |
|---|---|---|---|
| Gaussian SPZ v4 | AWS Laundry Room SOG, converted with SplatTransform | Normalise NGSP v4, build RAD, poster, report | `SUCCEEDED` |
| Metric point cloud | PDAL LAZ | Bounded evidence validation | `SUCCEEDED` |
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

## Staging deployment proof

The exact processor image was published to isolated staging and production
resources on 2026-07-28:

- Application Worker:
  staging `594814af-79d3-4cdd-a8ba-8255ba8a3426`,
  production `1af567ca-e372-491c-983a-0edb80d27123`
- Processor Worker and container:
  staging `0e5a6696-da04-4ae4-bf06-9e771aa60770`,
  production `ab2a9496-794e-4c39-973d-41b44fad5216`
- Processor image digest:
  `sha256:9ccadf6540687ded43de1d231b6efac4bf46bd99e9cc1198447534eb59fe5ba4`

Live staging and production health checks returned HTTP 200. The processor
identified
`spatial-processor/0.6.2`, `Spark 2.1.0`, and
`cloudflare-container` execution. Authenticated corpus mutation remains a
local disposable proof because the staging OTP and JWT secrets are
intentionally non-exportable; staging validation does not bypass that
security boundary.

## Honest boundaries

- The XBIN, FJDSLAM, and LCC2 files are synthetic opaque containers. They
  prove upload, retention, audit labelling, and evidence handling only. They
  do not prove a vendor decoder, scanner provenance, or licensed export.
- LAS/LAZ/E57 currently receive bounded signature and hash validation, not
  full coordinate, point-count, registration, or accuracy analysis.
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
