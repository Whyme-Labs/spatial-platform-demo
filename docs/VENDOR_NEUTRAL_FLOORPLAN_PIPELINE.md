# Vendor-neutral floor-plan pipeline

Recorded: 2026-07-28

## Production contract

The platform accepts an immutable, integrity-verified registered point cloud
from any capture vendor. Supported source formats are PLY, E57, LAS, LAZ, and
PTS. The source declares whether its vertical axis is Y or Z; the processor
normalises it into the platform's right-handed, metre-based, Y-up coordinate
frame before any floor-plan inference.

```text
verified point-cloud asset in private R2
  -> idempotent D1 extraction/job records
  -> lease-bound processor download and SHA-256 verification
  -> native PLY or pinned PDAL normalisation
  -> bounded level, ceiling, room, wall, opening, and stair/ramp proposal
  -> immutable proposal report in private R2
  -> optional proposal-only structural/navigation preview when the captured shell is complete
  -> required operator correction and decision
  -> immutable approved indicative revision in D1
  -> recooked collision GLB and navigation build bound to revision ID + plan hash
  -> hash-bound SVG, PDF, and DXF in private R2
```

This is deliberately separate from the measurement brief, independent
check-point, residual QA, and professional sign-off workflow. An approved
floor-plan revision is always `indicative`. It never becomes a certified
survey by changing a label or export format.

## Storage responsibilities

| System | Responsibility |
|---|---|
| R2 | Immutable source point clouds, processor proposal reports, proposal/reviewed collision GLBs, navigation artifacts, and private SVG/PDF/DXF deliverables |
| D1 | Extraction/job states, source evidence, proposal/revision hashes, revision-bound navigation identity, operator decisions, export batches, asset metadata, and audit links |
| KV | No source geometry or authoritative workflow state; KV remains appropriate only for bounded ephemeral/cache use |

Files are not stored in D1 or KV. D1 rows refer to R2 object keys and retain
the expected byte length and SHA-256 so the application can verify the same
evidence at every boundary.

## Normalisation

- PLY already declared as Y-up is parsed without a lossy format conversion.
- PLY declared as Z-up and all E57/LAS/LAZ/PTS sources pass through PDAL 2.9.2.
- Z-up input is transformed from source `(X, Y, Z)` to canonical
  `(X, Z, -Y)`, preserving a right-handed frame.
- The worker completion contract records source format, source up-axis,
  normalised format, tool, and a digest of the exact PDAL pipeline.
- The processor refuses unsupported axes, over-limit files, hash mismatches,
  missing geometry, and point clouds without credible vertical wall support.

The production image verifies the PDAL PLY writer and E57, LAS/LAZ, and PTS
readers during its Docker build. PDAL documents that its E57 reader supports
Cartesian point records and merges multiple point clouds; spherical records
are not supported. A scanner export should therefore use Cartesian E57.

## Derivation and review boundary

The first production extractor uses bounded metric occupancy:

1. infer distinct credible floor elevations;
2. match captured horizontal ceiling support to each floor without deriving a
   ceiling from wall height;
3. identify cells with sufficient vertical wall support;
4. close bounded gaps only for room segmentation;
5. derive candidate room polygons and wall centre lines;
6. preserve bounded gaps as same-level opening candidates;
7. infer continuous stair/ramp surfaces between adjacent levels; and
8. require an operator to correct level/ceiling evidence, labels, polygons,
   wall geometry, opening type/associations, and connectors.

Reviewed room outlines remain exact concave floor and ceiling surfaces in the
collision GLB; they are never expanded to axis-aligned room bounds. Stair/ramp
footprints cut explicit holes, and the navigation proof targets every inferred
room rather than only one point per storey.

Missing ceiling support does not discard the floor-plan proposal, but it blocks
the automatic collision preview until the operator supplies reviewed evidence.
The system never substitutes maximum wall height as an imaginary ceiling.

The server rejects an approved plan containing duplicate identifiers,
self-intersecting room polygons, degenerate walls/openings, inconsistent
opening widths, unknown wall links, or implausible room areas. Rejection
creates no approved revision.

Every approved revision is versioned and bound to:

- the scene version;
- the source point-cloud asset;
- the immutable extraction proposal hash;
- the corrected plan hash;
- the reviewing user and decision timestamp.

Generating another export never mutates the approved revision. Each export is
bound to the same plan hash and is delivered with private, no-store download
headers.

## API and state model

```text
POST /api/projects/:projectId/spatial/floorplan-extractions
  QUEUED -> PROCESSING -> READY_FOR_REVIEW
                    \-> FAILED / CANCELLED

POST /api/projects/:projectId/spatial/floorplan-extractions/:extractionId/review
  approved -> new APPROVED revision
           -> new operator-reviewed collision asset
           -> new hash-bound navigation build
  rejected -> no revision

POST /api/projects/:projectId/spatial/floorplan-revisions/:revisionId/correction-drafts
  -> idempotent READY_FOR_REVIEW correction workspace based on the approved revision
  -> render-native marks use the normal immutable review and recook path

POST /api/projects/:projectId/spatial/floorplan-revisions/:revisionId/exports
  -> SVG/PDF/DXF assets, idempotent per operation and revision/format

GET /api/projects/:projectId/spatial/floorplan-exports/:exportId/download
  -> tenant-authorised private object response
```

Queue, review, correction-draft, and export mutations require stable client
operation IDs. Lease, retry, cancel, worker failure, and completion states are
persisted. The primary Studio surface is the registered Gaussian render. An
operator marks rooms, walls, doorways, stairs, and ramps by raycasting that
render; coordinates are never typed into ordinary forms. Raw extraction
controls and evidence remain collapsed under Advanced diagnostics. The Studio
disables related controls while an operation is pending, retains the staged
plan on failure, exposes retry/cancel actions only when valid, and polls only
while an extraction is active.

A navigation build produced directly from the machine proposal is a preview
only and cannot be approved. Only the recooked build whose immutable parameters
name the approved floor-plan revision ID and exact plan hash can enter automatic
navigation acceptance and publication.

## Open-corpus evidence

Parser fixtures are pinned in
[`test/open-corpus/manifest.json`](../test/open-corpus/manifest.json):

- PDAL `simple.las` and `simple.laz`;
- PDAL `A4.e57`;
- PDAL `test.pts`;
- a PDAL point-cloud PLY;
- negative checksum and malformed-format derivatives.

They validate real upstream formats and the normalisation/runtime boundary.
They are intentionally not called indoor floor-plan accuracy benchmarks. The
two-room extractor contract uses deterministic metric geometry so room, wall,
opening, review, hash, and export assertions remain reproducible.

After building the production processor image, run:

```sh
npm run corpus:fetch
npm run processor:pdal:verify
```

The second command executes the exact container image against all five pinned
upstream formats and records point counts plus normalised PLY evidence at
`.cache/open-corpus/reports/pdal-container-verification.json`.

The full local Worker E2E additionally runs the actual queue and processor
against the deterministic two-room metric fixture, requires operator review,
generates all three exports, downloads them through the tenant-authorised
route, and recomputes their hashes:

```sh
npm run corpus:prepare
npm run corpus:e2e:local
```

The deterministic scene is an application contract fixture, not a physical
scanner or floor-plan accuracy claim.

## Known boundary: captured furniture editing

This pipeline derives and edits the plan representation. It does not claim to
remove an object from the captured Gaussian appearance or synthesize unseen
background, and it does not bake new furniture into the immutable capture.

Furniture placement can be added safely as a separate, non-destructive scene
overlay revision: a licensed GLB/USD asset, transform, visibility rules, and
attribution stored in the project manifest and rendered above the splat.
Furniture removal is materially different. It requires mask authoring,
multi-view-consistent inpainting/reconstruction, artefact QA, and a derived
appearance asset whose provenance remains distinct from the captured master.
That workflow must not silently overwrite reality-capture evidence.
