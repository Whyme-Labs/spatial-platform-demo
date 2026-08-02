# FJD official sample qualification

Last measured: 2026-08-03

## Outcome

The FJD-first qualification lane now exercises genuine vendor exports through
the pinned Gaussian, Spark conversion, and point-cloud decoder tools:

| Gate | Result | Receipt |
| --- | --- | --- |
| Official-source identity | Passed | Vendor Google Drive file IDs, exact remote byte counts, and the P2 ZIP central-directory entry are pinned in `test/vendor-corpus/fjd-manifest.json`. |
| Gaussian PLY validation | Passed | P2 Horse is a binary little-endian, SH-degree-3 PLY with 2,164,559 splats. |
| Point-cloud decoding | Passed | Pinned PDAL 2.9.2 decodes all 3,851,558 V4e interior LAS points and agrees with the file header's bounds. |
| Metric coordinate registration | Blocked | PDAL reports unknown horizontal units and no spatial reference; LAS coordinate scale fields are storage quantisation, not proof of metres. |
| Spark RAD build compatibility | Passed | `npm run corpus:fjd:qualify` makes the pinned Spark CLI decode the complete PLY and build a RAD with a valid container signature; its exact receipt is written to `.cache/fjd-sample-corpus/reports/qualification.json`. |
| Private Studio FJD import | Not run | The vendor bytes have not yet traversed the local Worker upload, FJD adapter, lease, and output-attachment path. |
| Spark browser render | Not run | The generated RAD has not yet been loaded by the browser renderer. |
| Shared visual/geometry frame | Blocked | P2 Horse and V4e interior are different captures; no transform registers them. |
| Automatic walkable scene | Blocked | Requires an indoor FJD capture containing both the portable visual and metric structural geometry in one declared frame. |
| Public redistribution | Blocked | The official sample page provides downloads but no dataset-specific redistribution grant. |

Passing source, Gaussian, point-cloud-decoder, and Spark-build gates proves
tool-level compatibility with genuine FJD Gaussian and LAS outputs. It does
not yet prove the Studio import lifecycle or browser rendering, and it does not
turn unregistered or unrelated samples into a collision proxy, floor plan, or
navigable release.

## Reproduce

From the repository root:

```sh
npm run processor:setup
npm run processor:container:build
npm run corpus:fjd:inspect
npm run corpus:fjd:fetch
npm run corpus:fjd:verify
npm run corpus:fjd:qualify
```

`inspect` reads the remote metadata and ZIP directory using HTTP byte ranges.
`fetch` downloads the 161,765,909-byte interior LAS and only the
481,046,648-byte compressed Gaussian PLY entry from the 2,587,208,251-byte P2
archive. It verifies the ZIP CRC-32 while inflating and verifies exact SHA-256
and byte counts before atomically installing either file. `verify` rereads both
files through streaming hashes and inspects their real headers. `qualify` runs
the same pinned Spark `build-lod` binary used by the processing agent and writes
a machine-readable report. Qualification also runs the real LAS through the
pinned processor image's `readers.las` decoder and compares PDAL's file size,
point count, and bounds with the independently parsed LAS header.

The manifest currently declares one explicit qualification case,
`p2-horse-v4e-tool-compatibility`, which binds these two fixtures and labels
them as different captures. If another case is added, `qualify` refuses to pick
the first one silently and requires `--case=<qualification-case-id>`.

All downloaded and derived bytes live under `.cache/fjd-sample-corpus`, which
is ignored by Git. Do not copy them into `public/`, R2, a release, or a Git
artifact without written permission from the dataset owner.

## Exact input pins

| Fixture | Bytes | SHA-256 |
| --- | ---: | --- |
| Extracted P2 Horse Gaussian PLY | 536,812,164 | `5146b69324c30fcf0946013a92b70d47eed825586a38756dc6f7d8613a9d5b65` |
| V4e interior LAS | 161,765,909 | `99afa8faab24b7bfa13a63482e06a382ad6f18140f05cf686f8ecc87a31fa9fb` |

The P2 ZIP selection is additionally pinned to entry CRC-32 `667bd5dd`,
compressed bytes `481046648`, local header offset `2436135`, and exact entry
path. Any vendor-side replacement fails loudly with the expected and observed
field rather than silently changing the qualification input.

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

Before accepting that bundle, add a local-only E2E which uploads the current
pinned P2 PLY through the `fjd-trion` capture adapter, leases processing,
attaches the resulting RAD, and opens it in Spark without publishing or
rehosting the vendor bytes. The paired bundle is then the remaining receipt for
automatic floor-plan, structural collision, Recast navigation, and publish
qualification. XGRIDS is intentionally deferred until this FJD acceptance lane
closes.
