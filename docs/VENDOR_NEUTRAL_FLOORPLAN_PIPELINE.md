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
7. infer continuous stair/ramp surfaces between adjacent levels;
8. read every proposed wall back against the capture in a doorway-height band
   relative to its own storey (`captureAgreement` on the proposal): a wall
   with capture support on both sides of an empty run crosses space the
   capture shows as open, and approval requires the operator to classify it
   (actual wall, glass wall, mirror, unobserved boundary, intentional no-go,
   door/opening, false barrier) — never to delete it automatically, because
   glass, mirrors, and sparse scans make real walls look unsupported; and
9. require an operator to correct level/ceiling evidence, labels, polygons,
   wall geometry, opening type/associations, and connectors.

The classification freezes with the approved revision
(`floorplan_revisions.capture_agreement_json`), joins the navigation
authoring hash through the floor-plan receipt, and blocks automatic
navigation acceptance whenever a crossing finding has no frozen resolution.

### Choosing the storeys

Storeys of an occupied building are contiguous in elevation: floor, contents,
ceiling, then the next floor, with no empty band anywhere between. Grouping
credible layers into clusters separated by empty space therefore collapses a
whole building into one group and can only ever report a single storey. Candidate
floors are instead taken greedily by footprint, each at least
`MINIMUM_STOREY_SEPARATION_M` from every candidate already taken, so a slab and
its mezzanine or racking deck cannot both be storeys.

Candidacy carries no compactness test. Bounding-box density selects for exactly
the wrong thing — a stair landing is compact, while a real storey walked as
offices off long corridors is sprawling; on the LaMAR CAB capture a density
gate deleted the genuine top storey (density 0.27) and kept the half-landings.

Three gates then apply, each answering a physical question:

- **Wall evidence** (`FLOOR_LEVEL_MINIMUM_WALL_SUPPORT_RATIO`): could anything
  stand here at all? Rejects ceilings and roof planes — nothing sits above them.
- **Footprint** (`FLOOR_LEVEL_MINIMUM_FOOTPRINT_RATIO`): a storey covers ground
  comparable to the building's widest floor. Rejects skirts and small decks.
  This ratio cannot be pushed high enough to reject wide shelf planes — on real
  captures a genuine top storey (56% of the widest floor) and a workshop shelf
  plane (54%) are indistinguishable by footprint.
- **Head-room** (`FLOOR_LEVEL_MAXIMUM_HEADROOM_BLOCKED_RATIO`): people do not
  stand on surfaces without standing height above them. Capture between 0.25 m
  and 1.8 m above a candidate marks columns a person cannot occupy. Measured
  floors run 40-54% blocked, furniture included; the top of loaded racking runs
  88%. The line sits at 0.6.

### Choosing the floor of a storey

Wall evidence answers only *could anything stand here?*, which is what rejects
ceilings and roof planes — nothing sits above them. It must not rank the
survivors, because it is biased in two opposite directions:

- A mesh skirt or scan fringe hanging *below* the slab outscores the slab, since
  everything resting on the floor falls inside the sub-floor anchor's evidence
  window while the slab's own window starts above it.
- In a tall hall, roof structure can give a raised deck a better score than the
  ground it stands on.

Among the layers that carry wall evidence, the storey's floor is therefore the
one covering the most ground, breaking ties downwards. Measured on the Meta
EyefulTower captures, ranking by wall evidence anchored the apartment on a
61-cell skirt beneath its 802-cell slab (one 2 m² room for the whole flat) and
anchored the workshop partway up its racking, where a 2.85 m layer scored 13,801
against the floor's 9,677 (4 m² of a 75 m² floor). Ranking by footprint recovers
26.9 m² and 70.3 m² respectively, unattended.

### Observed cells versus closed cells

Step 4 closes bounded gaps so the flood fill in step 5 can tell one room from the
next. Those cells are inferred, never observed, and they exist only for
segmentation. Wall geometry in step 5 is therefore derived from observed wall
cells alone. Deriving it from the closed set instead drew a solid wall straight
across every opening recorded in step 6 — the extractor would report a doorway
and seal it in the same pass, and a reviewer approving the plan got a wall where
the capture plainly showed a gap.

### Doorway thresholds

Room outlines stop at the faces of the wall between them, so two rooms joined by
a doorway are still separated by the wall's own thickness. Carving the opening
out of the barrier is not sufficient: with no floor across that strip a walker
has nothing to step onto and each room becomes its own navigation island. The
automatic collision config bridges each opening that lies between two rooms on
one level with a threshold floor spanning the gap and overlapping slightly into
both. Thresholds are links rather than rooms, so they are exempt from the
per-room clearance proof and earn no reachability destination of their own.

### Stairs between storeys

A storey-to-storey staircase is normally a switchback: a flight up, a
half-landing, and a flight back the opposite way. Projected on any single axis
that is a zigzag, so a straight-ramp fit alone finds flights only where a
half-landing happened to survive as its own level. Connector inference
therefore first strips the support window of anything locally level — the
intervening ceiling plates, their rims, and wall lines, none of which a stair
tread resembles, since a tread has neighbours above and below its own height —
then fits candidate flights per component, classifies them as the lower or
upper half of the rise, and pairs halves whose landing ends stand together.
Flight width is padded slightly so the cooked tread strips of the two flights
merge across the landing instead of stopping a seam apart.

Reviewed room outlines remain exact concave floor and ceiling surfaces in the
collision GLB; they are never expanded to axis-aligned room bounds. Stair/ramp
footprints cut explicit holes, and the navigation proof targets every inferred
room rather than only one point per storey.

### Ceilings

A real ceiling rarely forms one clean flat band over a whole floor — beams,
coffers, ducts, and partial capture fragment it, and demanding a single dense
band that overlaps 35% of the floor returned null on genuinely roofed storeys
(the CAB ground storey's best band covered 14%), which blocked automatic
collision on every such level. Ceiling evidence must also respect occlusion:
in a merged multi-storey cloud the next floor up overlaps this one almost
everywhere in plan, so any occlusion-blind band count elects the storey above.

Each floor cell therefore contributes its FIRST capture above standing height.
Whether the storey is roofed at all is the fraction of floor cells with any
such evidence (`CEILING_MINIMUM_COLUMN_COVERAGE`). Where the ceiling is, is the
highest band nearly as populated as the strongest one
(`CEILING_BAND_STRENGTH_RATIO`) — clutter tops pile up at the clearance cutoff
(defeating a mode) and a half-racked hall splits the distribution (defeating a
median), but first hits concentrate at real surfaces, clutter forms the lower
concentrations, and anything seen above the ceiling is leakage through voids.

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
persisted. The primary Studio surface is the registered Gaussian render with
the current rooms, walls, doors, blocked windows, unresolved openings, stairs,
and ramps drawn over it. An operator can approve the automatic structure
as-is, or mark rooms, walls, doors, windows, stairs, and ramps—and remove a
wrong structural element—by raycasting that render. Marks are assigned to
their rendered level, connectors bind their nearest lower/upper levels, and
staged changes support undo; coordinates are never typed into ordinary forms. Raw extraction
controls and evidence remain collapsed under Advanced diagnostics. The Studio
disables related controls while an operation is pending, retains the staged
plan on failure, exposes retry/cancel actions only when valid, and polls only
while an extraction is active.

A navigation build produced directly from the machine proposal is a preview
only and cannot be approved. Only the recooked build whose immutable parameters
name the approved floor-plan revision ID and exact plan hash can enter automatic
navigation acceptance and publication.

Ordinary doors are the only classified openings that cut a passable wall gap.
Windows and unresolved gaps remain physical barriers until the operator marks
them as doors. This keeps an uncertain reconstruction fail-closed without
turning furniture into structural collision.

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
