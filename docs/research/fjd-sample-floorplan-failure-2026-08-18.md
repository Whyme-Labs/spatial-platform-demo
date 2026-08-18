# FJD sample floor-plan failure: capture, Trion export, or platform?

Research date: 2026-08-18
Sample LAS: `2026-08-12-17-14-01_2.las`
Sample Gaussian: `2026-08-12-17-14-01_1_Gaussian.ply`

## Verdict

The confirmed primary fault is **our automatic floor-selection heuristic and
its fallback error reporting**, not a wrong LAS axis and not proof of a bad FJD
capture or a bad Trion export.

The LAS contains usable floor and vertically persistent wall geometry. With the
same production sampling and extractor settings, supplying a floor-elevation
hint of `-0.30 m` succeeds with 349 wall cells, 153 wall segments, four room
candidates, 32 opening candidates, and 19.8125 m² of proposed room area. The
unattended path rejects that floor earlier because 429 of its 551 floor cells
have some return in the standing-height band. That measured 77.858% blocked
ratio exceeds the extractor's hard-coded 60% head-room gate. With no accepted
floor candidate, the fallback chooses the widest horizontal layer at `3.75 m`
— the ceiling — then honestly finds zero wall support *above the ceiling* and
emits the misleading `INSUFFICIENT_WALL_SUPPORT` error.

Capture coverage and Trion settings can make this heuristic easier or harder to
satisfy, but they are secondary for this file: the same exported LAS succeeds
when the correct floor elevation is supplied.

## Evidence labels

- **Observed**: measured from the supplied files or reproduced with this
  repository's current extraction code.
- **FJD-documented**: stated in an official FJD manual, support page, release
  note, or developer guide.
- **Inference**: a diagnosis that follows from those observations but is not an
  FJD product guarantee.

## What the supplied files establish

### File and coordinate receipts

| Observation | Receipt |
| --- | --- |
| LAS identity | 329,755,665 bytes; SHA-256 `6f94c6d1451355aea8f85e599b683bf3b550586fa943586809d28651b75865f0` |
| Gaussian identity | 378,484,888 bytes; SHA-256 `74cf47725b6d8656285c4313fd5b8656acaca460f9c9de541935a974a31ca2c6` |
| LAS schema | LAS 1.4, point format 3, 9,698,685 records, XYZ quantisation `0.0001` |
| LAS bounds | X `-15.1379..12.4979`, Y `-18.0902..8.0375`, Z `-0.6070..3.9077` |
| Gaussian bounds | X `-15.0832..12.4435`, Y `-18.1316..8.1219`, Z `-0.7186..4.0661` |
| LAS colour | RGB is non-zero on 9,697,621 of 9,698,685 points |
| LAS classification | all 9,698,685 records use LAS classification `0` (unclassified) |
| CRS metadata | none present; point-data offset equals the 375-byte LAS header, with no VLR carrying a spatial reference |

**Observed:** both files have two approximately 26–28-unit horizontal extents
and a roughly 4.5-unit Z extent. They agree closely enough to establish that the
FJD exports use the same coordinate ordering and that this LAS is Z-up. The
platform's LAS transform `(X,Y,Z) -> (X,Z,-Y)` is therefore the correct
right-handed Z-up-to-Y-up normalization for this sample. This comparison does
not establish a surveyed origin or CRS.

The LAS scale fields are storage quantisation, not a declaration of real-world
units. **Documentation gap:** the public FJD material reviewed here does not
specify the unit, handedness, or up-axis serialized in a local, non-RTK LAS, or
promise that a Gaussian PLY and LAS carry an identical portable frame. The
working metre interpretation is supported by the scene extents and the
platform's same-capture checks, not by LAS CRS metadata.

### Exact pre-fix platform failure reproduction

The baseline replay used the production LAS path and defaults before the
floor-selection fix:

1. sample 9,698,685 LAS records at stride five for the two-million-point cap;
2. normalize Z-up LAS to Y-up;
3. voxelize at `0.125 m` (`min(grid / 2, floorBand)`);
4. use a `0.25 m` horizontal grid and `0.15 m` floor band;
5. seek wall returns from `0.25 m` through `2.50 m` above a floor with minimum
   vertical-span coverage `0.45`.

These are the current implementation paths in
[`scripts/processing-agent.mjs`](../../scripts/processing-agent.mjs) and
[`scripts/processing-agent-core.mjs`](../../scripts/processing-agent-core.mjs).
The replay produced 26,758 occupied voxels and the following decisive floor
candidates:

| Candidate | Horizontal cells | Wall-support score | Head-room blocked | Result |
| --- | ---: | ---: | ---: | --- |
| `3.75 m` ceiling | 845 | 0 | 0/845 | rejected for no wall support |
| `-0.15 m` floor | 551 | 4,698 | 429/551 (77.858%) | rejected by the 60% head-room gate |

Once both automatic candidates are rejected, `extractMetricFloorPlan()` falls
back to the single widest horizontal layer. That is the `3.75 m` ceiling, so
the downstream wall test has no points in its above-floor wall band and returns
`observedWallCellCount=0`.

An explicit `-0.30 m` floor hint bypasses the faulty candidate-selection step
and succeeds on the unchanged LAS:

| Result field | Observed value |
| --- | ---: |
| wall cells | 349 |
| wall segments | 153 |
| room candidates | 4 |
| opening candidates | 32 |
| proposed room area | 19.8125 m² |

This is the key discriminator: the export does **not** lack vertically
persistent wall evidence. Our unattended selector discards the usable floor,
then reports the ceiling's lack of walls as if it described the whole cloud.

### Implemented-fix replay

The durable fix scores every automatic hypothesis by wall support, footprint,
and usable head-room. It treats a column as occupied only when returns persist
through at least three vertical bins, then requires one four-neighbour-connected
clear component large enough for the configured minimum room area. This tests
for actual contiguous standing space instead of using a global blocked-cell
ratio or giving the lowest relative plane an unconditional exemption. A dense
furnished floor can therefore pass while the separated clear stripes on a
loaded rack fail. If no hypothesis reaches extraction, the result contains the
exact screening and extraction evidence instead of silently retrying the
widest ceiling layer.

Replaying the immutable LAS with the same production stride and no elevation
hint now returns `proposal_ready`:

| Result field | Post-fix observed value |
| --- | ---: |
| selected floor elevation | `-0.15 m` |
| wall cells | 314 |
| wall segments | 136 |
| room candidates | 1 |
| opening candidates | 24 |
| proposed room area | 12.875 m² |

The emitted candidate assessment records 551 horizontal cells, wall-support
score 4,698, footprint ratio 0.652071, and 332 vertically persistent blocked
cells at a 0.125 m vertical resolution for the accepted `-0.15 m` floor. Its
219 clear cells contain a largest connected component of 85 cells against 32
required. The `3.75 m` ceiling is rejected for `wall_support_below_ratio` and is
not attempted. The report records `screenedElevationsM=[-0.15]`,
`selectedElevationsM=[-0.15]`, and no candidate failures. This output remains
an indicative proposal that requires human review; the receipt proves
automatic extraction now selects the usable structural evidence instead of
the ceiling.

## What FJD officially documents

The current public support material still links the 205 Model user manual. Its
relevant documented behavior is:

- **Mapping and output:** Point Cloud Mapping asks for device model, scanning
  scenario, mapping range, and an optional mapping report. Point-cloud export
  supports LAS, E57, PLY, and PTS. `.fjdata` is needed for configuration,
  trajectory, control-point, and pose-dependent operations. See manual
  sections 3.5.1, 4.5, and 5.1.1: [official FJD Trion Model user manual
  (PDF)](https://drive.google.com/file/d/1sw-4oRSDx2-B5v4C3uMc9CHKGCnuvMhJ/view?usp=drive_link).
- **Mapping quality controls:** section 5.1.1 exposes mapping filtering for
  insufficient density in special scenarios, point-cloud densification,
  moving-object removal, camera calibration, colorization range, and
  colorization frequency. FJD says a higher coloring frequency improves result
  quality at greater processing time. It does not publish a setting that
  guarantees floor-plan wall continuity.
- **Geometry repair and inspection:** sections 5.2.2–5.2.6 and 5.5.3 document
  plane rectification, `10 mm` default-resolution densification, occlusion-hole
  filling, XY transpose, statistical outlier deletion, and density evaluation.
  Section 6.3.1 can extract indoor Wall, Floor, and Ceiling point clouds.
- **Subsampling:** section 6.1.1 deliberately retains fewer points using
  distance-, density-, or spatial-structure-based modes. FJD states which
  parameter direction removes more points, but publishes no wall-completeness
  threshold for a subsampled LAS.
- **Coordinates and units:** section 4.8 describes unit settings for displayed
  and calculated length/area/radius/volume/angle results. It does not say those
  settings rewrite LAS coordinates. Section 5.4.1 separately documents scanner-
  to-world coordinate transformation, residual/RMS calculation, and saving the
  transform parameters.
- **Colorization:** sections 5.1.6–5.1.7 say true colour is assigned from
  captured video and can be wrong or missing in complex conditions. Colour
  quality is not a documented test of LiDAR wall completeness.
- **Gaussian creation and Linkage:** sections 12.1.1 and 12.2.1 say Reality
  Modeling uses the selected point cloud plus panoramic imagery and produces a
  Gaussian PLY. Linkage matches that Gaussian with its corresponding point
  cloud and configuration for simultaneous display at the same location. FJD
  does not document an exported Linkage transform or a guarantee that the two
  portable files serialize a reusable identical frame.

FJD's public Model V2.0.8 release adds one-click floor-plan extraction for
indoor scenes within 200 m², building correction, improved processing and 3DGS
quality, and LAZ as the default reconstruction format: [official Model V2.0.8
release note](https://www.fjdtrion.com/blog/product-updates-2/fjd-trion-model-v2-0-8-1052).
This gives us a useful vendor-side A/B test; it is not evidence that the user's
LAS was exported incorrectly.

FJD's P2 V1.2.0 capture guidance is more specific for sparse indoor geometry:
keep the scanner `0.5–1 m` from walls, keep it level, remain still for up to ten
seconds during Scan Enhancement, scan every rectangular-room corner, scan every
corner in L-shaped or concave areas, and heed speed/vibration warnings:
[official P2 V1.2.0 firmware guidance](https://www.fjdtrion.com/blog/product-updates-2/fjd-trion-p2-firmware-v1-2-0-1053).
The official SDK guide likewise says to keep the device stable and avoid sudden
movements: [official FJD SLAM SDK developer guide](https://www.fjdtrion.com/slam-sdk-developer-guide).

## Could Trion export settings be responsible?

**Possible in general; not the primary cause demonstrated here.**

- **Inference:** aggressive Subsample or high-level Delete Outliers can remove
  thin or isolated wall returns because FJD documents that those operations
  remove points. The public manual does not quantify when they break walls.
- **Inference:** Mapping filtering, Densify Point Cloud, rectification/building
  correction, or a carefully bounded hole-fill can improve a sparse or tilted
  derivative. Hole filling must not silently become measurement truth because
  it generates points in occluded areas.
- **Observed counter-evidence:** this LAS contains 9.7 million densely repeated
  points and hundreds of cells that pass our exact vertical-wall test once the
  correct floor is selected. Re-exporting only to obtain “more wall points” is
  therefore not the first fix.
- **Observed limitation:** the LAS is unclassified and lacks CRS metadata, and
  the supplied bundle does not include the Trion mapping report or saved
  coordinate transform. Those are provenance/qualification gaps, but our
  current extractor ignores LAS classification and had already normalized the
  correct up axis, so neither explains this failure.

## Recommended next actions

1. **Platform fix completed:** the automatic selector now requires contiguous
   head-room-clear support, keeps the loaded-racking rejection, and reconciles
   per-candidate screening with the final extraction outcome. Keep the explicit
   elevation hint as an operator override, not as the default repair.
2. **Vendor A/B test:** in current Trion Model, crop the same mapped cloud to
   the indoor area, run Indoor Classification for Wall/Floor/Ceiling, then run
   V2.0.8 Floor Plan Extraction. Preserve its result and mapping report.
3. **Export A/B test only if needed:** export the untouched mapped cloud and a
   separately named rectified/densified derivative. Do not Subsample or apply
   aggressive outlier removal for this comparison. Run our extractor on both.
4. **Interpret the outcomes:** if Trion succeeds on the same cloud while our
   automatic run fails, our extractor is at fault. If both fail, inspect capture
   coverage and mapping settings. If Trion succeeds from the raw package but a
   processed LAS fails, the derivative/export steps are responsible.
5. **Future capture:** follow FJD's wall-distance, level/stillness, and corner
   coverage guidance, and return the untouched TGZ, mapped LAS/E57, Gaussian
   PLY, `.fjdata`, mapping report, and any saved coordinate transform together.

## Bottom line

This is not evidence that the sample must be rescanned or that Trion Model was
used incorrectly. The visual and metric exports are usable. The immediate
failure was reproducible in our code, and the fixed automatic path now selects
the floor without an operator hint. A Trion-side classified/floor-plan run is
still valuable as a controlled comparison and to close the missing provenance
gaps.
