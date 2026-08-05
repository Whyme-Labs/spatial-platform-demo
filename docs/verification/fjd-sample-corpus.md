# FJD official sample qualification

Last measured: 2026-08-03

## Outcome

The FJD-first qualification lane now exercises genuine vendor exports through
the pinned Gaussian and companion `.fjdata`, the production `fjd-trion`
adapter, Spark conversion, the strict private-preview gate, and the point-cloud decoder.
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
| Private Studio FJD import | Visual processing passed; current preview blocked by design | The exact 536,812,164-byte PLY traversed the isolated Worker, production `fjd-trion` adapter, multipart upload, lease, quality RAD build, and poster attachment. Its earlier visual-only browser smoke is retained as processor evidence, but the current product correctly refuses to mint a preview without registered geometry and an approved walking map. |
| Private production upload | Passed | Project `87c7ab8e-6e61-4552-9ac9-cef577210f33` accepted the exact PLY through 52 resumable parts; cloud job `c36777a5-42bd-494f-98f3-7b647d0718f3` verified the source and generated a RAD, poster, and QA report. The project remains `QA_REQUIRED` with zero releases. |
| Historical Spark visual smoke | Retained as processor evidence only | Before the strict walking-map gate, headless Chrome loaded the signed 141,351,968-byte RAD using HTTP 206 ranges with no page, console, renderer, or HTTP errors. That receipt still proves Spark compatibility, but current product code will not repeat a visual-only preview. |
| Structured E57 vendor semantics | Blocked | `npm run corpus:fjd:e57:inspect` finds no E57 under `.cache/fjd-sample-corpus` or `.cache/open-corpus` and writes `blocked_missing_registered_indoor_corpus` to `.cache/fjd-sample-corpus/reports/e57-structure-inventory.json`. The public ASTM container reader exists and is tested against a synthetic file, but no vendor export has been read. |
| Shared visual/geometry frame | Blocked | P2 Horse and V4e interior are different captures; no transform registers them. |
| Automatic walkable scene | Blocked | Requires an indoor FJD capture containing both the portable visual and metric structural geometry in one declared frame. |
| Public redistribution | Blocked | The official sample page provides downloads but no dataset-specific redistribution grant. |

Passing source, Gaussian, Studio ingestion, point-cloud-decoder, and Spark-build
gates proves the portable FJD Gaussian processing path. It
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
npm run corpus:fjd:e57:inspect
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
real FJD adapter, runs the processing agent, proves the private-preview API
rejects the resulting visual derivative because this horse sample has no
registered indoor collision/navigation package, asserts that no release
exists, and removes the exact temporary Worker state directory. The historical
Spark/Chrome smoke remains a processor compatibility receipt only; it is not
part of the current product-preview command.

`e57:inspect` walks `.cache/fjd-sample-corpus` and `.cache/open-corpus` for any
`.e57` file and reads each one through the public ASTM E2807 container reader:
the 48-byte header, the CRC-32C-paged XML section, then per-scan poses, bounds,
point counts, the point-field inventory including vendor extension names
recorded verbatim, image records with their representation types, and
coordinate metadata. It reads the header and XML section only, never the point
payload. No E57 is currently present, so the command writes
`blocked_missing_registered_indoor_corpus` rather than implying a reading it
never performed. It never guesses FJD's classification or mesh schema: vendor
field names are preserved as evidence and left undecoded.

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

## Public sample sweep, 2026-08-05

FJD's whole public sample library was re-enumerated and measured at byte level
(live folder listings, ZIP central directories, parsed LAS headers). It cannot
close the paired gap:

- Exactly one 3DGS exists in the catalogue — the outdoor P2 Horse — and it
  ships **no point cloud**. Every indoor sample ships `.fjdata` plus `.las`
  with **no splat**.
- A new indoor sample, `Floor Plan 60x40m.zip` (625,962,309 bytes, 41,088,411
  points, 30.4 x 46.8 x 5.3 m), is genuinely multi-room — 1 m-cell occupancy
  fills 24.9 % of its bounding box — but is single storey and unfurnished, and
  carries no splat.
- **No public FJD sample is multi-floor.** Measured directly from the pinned
  `fjd-v4e-interior.las` over 1 m cells: the 0.2-2.6 m band occupies 956 cells
  while the 4.4-6.2 m band occupies 171, so the upper level covers only 17.9 %
  of the lower footprint, and 54 % of the 126 cells occupied in both bands show
  an intervening 3.3-4.2 m slab. That is a partial mezzanine or gallery over a
  tall single level, not a second storey, and its 20 m header Z extent is
  outlier-driven. `Building` is an exterior walk whose trajectory climbs 1.63 m
  over 7.2 minutes. Two independent sweeps disagreed on this file — one read
  the two Z bands as two storeys — so the footprint ratio above was recomputed
  from the pinned bytes rather than taken from either report.
- No sample ships E57, SPZ, SOG, SPLAT, mesh, classified output, or imagery.
- No dataset-specific licence exists. The only governing text is the store's
  Shopify terms, which withhold reproduction and redistribution rights, so the
  private-cache policy in this repo stands.

`.fjdata` is a readable ASCII sidecar: the georeferenced samples carry a 6-DoF
trajectory (`timestamp E N H qx qy qz qw`) in the same frame as their LAS plus
a camera intrinsics block, and the Horse sidecar adds image records. That is
decodable provenance an adapter could read once a paired capture exists.

One capture can qualify the paired lane without waiting on FJD: **P2 Horse
ships its raw `.fjdslamp2` SLAM file and the companion `.insv` video**, which
is exactly what Trion Model needs to reconstruct both a point cloud and a 3DGS
from one session, then run the Linkage matching step. It is an outdoor object
capture and cannot qualify indoor navigation, but it can prove the
paired-artifact and registration-transform semantics end to end.

Structured E57 remains the highest-risk assumption. Release note D.0203 claims
the export carries structured data including point clouds, images, and
transformation matrices, but the 180-page Rev.205 manual mentions E57 exactly
once, as a flat entry in a format list with no structure toggle and no image
option, and the export dialog's filter list matches CloudCompare's, whose E57
writer emits unstructured files. Vendor marketing and vendor documentation
disagree; only a real export settles it.

## Gap to close with the first device capture

Ask FJD Trion Model export for one indoor capture containing:

1. portable 3DGS (`PLY` preferred for the first qualification);
2. metric LAS, E57, PLY, or mesh from the same reconstruction;
3. units, up axis, origin, and the visual-to-geometry transform;
4. floor/room/opening output when available;
5. a structured `E57` retaining per-scan poses and image records, plus any
   classified mesh or segmentation sidecar the software produces; and
6. written permission covering private processing and the intended demo.

The local-only P2 adapter/browser E2E is complete. The remaining device gap is
a same-capture indoor bundle plus a supported FJD metadata contract that can
derive axis, scale, visual-to-geometry registration, and opening camera without
a fixture pin. That bundle is the missing receipt for automatic floor-plan,
structural collision, Recast navigation, and publish qualification. XGRIDS is
intentionally deferred until this FJD acceptance lane closes.

The structured E57 and vendor semantic exports carry their own, narrower gap.
The platform now preserves a classified mesh or segmentation sidecar under the
`vendor_semantic_mesh` role and records what the public E57 container declares,
but it decodes no FJD label vocabulary and derives no wall, floor, or ceiling
claim from one. Closing that gap needs a registered indoor FJD export so the
actual exported dimensions, pose records, and extension field names can be read
instead of assumed. Until that file exists, `corpus:fjd:e57:inspect` reports
`blocked_missing_registered_indoor_corpus` and the adapter declares the
classification semantics as unparsed.
