# FJD official sample qualification

Last measured: 2026-08-03

## Outcome

The FJD-first qualification lane now exercises genuine vendor exports through
the pinned Gaussian and companion `.fjdata`, the production `fjd-trion`
adapter, Spark conversion, a real Chrome render, and the point-cloud decoder.
The local E2E remains isolated: it creates no release, writes no cloud storage,
and deletes its local D1/R2 state at teardown. A separate, operator-authorized
production qualification uploaded the P2 Horse PLY to a private FJD project on
2026-08-03; that project has zero releases and must not be published without a
redistribution grant.

| Gate | Result | Receipt |
| --- | --- | --- |
| Official-source identity | Passed | Vendor Google Drive file IDs, exact remote byte counts, and the P2 ZIP central-directory entry are pinned in `test/vendor-corpus/fjd-manifest.json`. |
| Gaussian PLY validation | Passed | P2 Horse is a binary little-endian, SH-degree-3 PLY with 2,164,559 splats. |
| Point-cloud decoding | Passed | Pinned PDAL 2.9.2 decodes all 3,851,558 V4e interior LAS points and agrees with the file header's bounds. |
| Metric coordinate registration | Blocked | PDAL reports unknown horizontal units and no spatial reference; LAS coordinate scale fields are storage quantisation, not proof of metres. |
| Spark RAD build compatibility | Passed | `npm run corpus:fjd:qualify` makes the pinned Spark CLI decode the complete PLY and build a RAD with a valid container signature; its exact receipt is written to `.cache/fjd-sample-corpus/reports/qualification.json`. |
| Private Studio FJD import | Passed locally | The exact 536,812,164-byte PLY traversed the isolated Worker, production `fjd-trion` adapter, multipart upload, lease, quality RAD build, poster attachment, and authenticated private preview. |
| Private production upload | Passed | Project `87c7ab8e-6e61-4552-9ac9-cef577210f33` accepted the exact PLY through 52 resumable parts; cloud job `c36777a5-42bd-494f-98f3-7b647d0718f3` verified the source and generated a RAD, poster, and QA report. The project remains `QA_REQUIRED` with zero releases. |
| Spark browser render | Passed locally | Headless Chrome loaded the signed 141,351,968-byte RAD using HTTP 206 ranges with no page, console, renderer, or HTTP errors. The measured frame had luminance range 222 and 155 quantised colour buckets. |
| Shared visual/geometry frame | Blocked | P2 Horse and V4e interior are different captures; no transform registers them. |
| Automatic walkable scene | Blocked | Requires an indoor FJD capture containing both the portable visual and metric structural geometry in one declared frame. |
| Public redistribution | Blocked | The official sample page provides downloads but no dataset-specific redistribution grant. |

Passing source, Gaussian, Studio lifecycle, browser, point-cloud-decoder, and
Spark-build gates proves the portable FJD Gaussian path works end to end. It
does not turn unregistered or unrelated samples into a collision proxy, floor
plan, or navigable release. The Horse scene is outdoors and the V4e interior is
a different capture, so neither can qualify automatic indoor navigation.

## Reproduce

From the repository root:

```sh
npm run processor:setup
npm run processor:container:build
npm run corpus:fjd:inspect
npm run corpus:fjd:fetch
npm run corpus:fjd:verify
npm run corpus:fjd:qualify
npm run corpus:fjd:e2e:local
```

`inspect` reads the remote metadata and ZIP directory using HTTP byte ranges.
`fetch` downloads the 161,765,909-byte interior LAS and only the
481,046,648-byte compressed Gaussian PLY plus 2,435,997-byte compressed
`.fjdata` entries from the 2,587,208,251-byte P2 archive. It verifies each ZIP
CRC-32 while inflating and verifies exact SHA-256 and byte counts before
atomically installing a file. `verify` rereads all pinned files through
streaming hashes, checks the `.fjdata` camera-pose record, and inspects the real
PLY/LAS headers. `qualify` runs
the same pinned Spark `build-lod` binary used by the processing agent and writes
a machine-readable report. Qualification also runs the real LAS through the
pinned processor image's `readers.las` decoder and compares PDAL's file size,
point count, and bounds with the independently parsed LAS header.
`e2e:local` then creates a disposable local project, imports the PLY through the
real FJD adapter, runs the processing agent, opens the private RAD in Chrome
from the `.fjdata`-backed camera, asserts that no release exists, and removes
the exact temporary Worker state directory.

The manifest currently declares one explicit qualification case,
`p2-horse-v4e-tool-compatibility`, which binds these two fixtures and labels
them as different captures. If another case is added, `qualify` refuses to pick
the first one silently and requires `--case=<qualification-case-id>`.

Local downloaded and derived bytes live under `.cache/fjd-sample-corpus`, which
is ignored by Git. The private production qualification is the sole recorded
cloud exception: it stores the P2 source and generated derivatives without a
release, while content-addressed private R2 keys retain the companion `.fjdata`
and local RAD receipt. Do not copy these bytes into `public/`, a release, a Git
artifact, or any publicly reachable bucket without written permission from the
dataset owner. Exact production receipts are in `docs/CAPACITY_RECEIPTS.md`.

## Exact input pins

| Fixture | Bytes | SHA-256 |
| --- | ---: | --- |
| Extracted P2 Horse Gaussian PLY | 536,812,164 | `5146b69324c30fcf0946013a92b70d47eed825586a38756dc6f7d8613a9d5b65` |
| Extracted P2 Horse Gaussian `.fjdata` | 9,747,730 | `e83fba620ac6a40f252d9d22818477eedc2bd82eb957eaf08511ac5c7c600489` |
| V4e interior LAS | 161,765,909 | `99afa8faab24b7bfa13a63482e06a382ad6f18140f05cf686f8ecc87a31fa9fb` |

The P2 ZIP selection is additionally pinned to entry CRC-32 `667bd5dd`,
compressed bytes `481046648`, local header offset `2436135`, and exact entry
path. The companion is pinned to CRC-32 `9ef98aff`, compressed bytes `2435997`,
local header offset `42`, and its exact path. Any vendor-side replacement fails
loudly with the expected and observed field rather than silently changing the
qualification input. The Gaussian payload begins at byte 1,532, including the
complete `end_header` line terminator.

The RAD is intentionally identified per run rather than pinned as a
byte-reproducible derivative. Spark records measured build durations in RAD
metadata, and two repeated builds after streaming input verification differed
by 8 bytes while both builds completed and emitted signature-valid RAD
containers. Each qualification report records the exact RAD byte count and
SHA-256 it actually produced.

## Gap to close with the first device capture

Ask FJD Trion Model export for one indoor capture containing:

1. portable 3DGS (`PLY` preferred for the first qualification);
2. metric LAS, E57, PLY, or mesh from the same reconstruction;
3. units, up axis, origin, and the visual-to-geometry transform;
4. floor/room/opening output when available; and
5. written permission covering private processing and the intended demo.

The local-only P2 adapter/browser E2E is complete. The remaining device gap is
a same-capture indoor bundle plus a supported FJD metadata contract that can
derive axis, scale, visual-to-geometry registration, and opening camera without
a fixture pin. That bundle is the missing receipt for automatic floor-plan,
structural collision, Recast navigation, and publish qualification. XGRIDS is
intentionally deferred until this FJD acceptance lane closes.
