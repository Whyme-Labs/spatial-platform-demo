# FJD Trion raw package and platform deliverables

Research date: 2026-08-12

Input inspected: `/Users/sohweimeng/Downloads/2026-08-12-17-14-01.fjdslamp2.tgz`

## Decision

The supplied `.fjdslamp2.tgz` is **raw proprietary FJD capture data, not a
portable web scene**. Give the **outer TGZ directly** to a current FJD Trion
Model build; do not manually extract it as the normal workflow. From Trion
Model, generate at least:

1. a mapped, preferably colorized point cloud in E57 or LAS;
2. a 3D Gaussian PLY if the photorealistic scene is wanted; and
3. the configuration/pose and mapping-report evidence needed to prove that the
   Gaussian and geometry are in one frame.

A mesh, panorama set, floor plan, and video are optional deliverables for
specific use cases. A point cloud or vendor mesh alone is not a photorealistic
3DGS scene, while a Gaussian PLY alone does not supply trustworthy walking
collision.

## What the supplied archive actually contains

Read-only inspection produced this receipt:

| Property | Observed value |
| --- | --- |
| Outer archive | `2026-08-12-17-14-01.fjdslamp2.tgz` |
| Outer bytes | `609,755,692` |
| SHA-256 | `3c9b4452d4470bb28170a09816ec52ef67671f9d129ffb2cc72f80619d3dec6e` |
| Tar entries | exactly one regular file |
| Inner name | `2026-08-12-17-14-01.fjdslamp2` |
| Inner bytes | `906,371,072` |
| Inner inspection | opaque binary; no portable point-cloud, mesh, image, or Gaussian header was visible |

The archive is therefore only a gzip-compressed tar wrapper around one FJD
binary payload. FJD's own Model Web page describes the corresponding workflow
as uploading “Original Data (FjdsalmXX)” for **data decryption and cloud
generation**, and the October 2025 Model release says the software added
parsing for `fjdslamxx` packages. These first-party descriptions support
treating the payload as vendor input rather than as a standard interchange
format:

- [FJD Trion Model Web](https://store.fjdtrion.com/products/fjd-trion-model-web)
- [FJD Trion Model D.0205.001 release note](https://www.fjdynamics.com/se/blog/product-updates-50/release-note-fjd-trion-model-d-0205-001-853)

No public FJD specification found in this research documents the byte layout
of `.fjdslamp2`. Its exact internal sensor streams, encryption, calibration,
image layout, and coordinate convention remain vendor-owned unknowns.

## Should Trion Model receive the outer TGZ?

**Yes. Keep the TGZ intact and browse to the outer file.** The current official
evidence is:

- the Trion Model 205 manual's Point Cloud Mapping dialog accepts `.fjdslam`
  **or `.fjdslam.tgz`**;
- the same manual's queue-mapping workflow explicitly selects compressed raw
  packages;
- the D.0205.001 release added `fjdslamxx` package parsing and P2 mapping and
  colorization support; and
- the later V207.001 release added “direct loading of real-time TGZ data.”

Sources:

- [Official FJD support/download center](https://store.fjdtrion.com/pages/downloads)
- [Official Trion Model 205 user manual (PDF), sections 5.1.1, 5.6.1, and 12.1.1](https://cdn.shopify.com/s/files/1/0755/7876/9593/files/EN-FJD_Trion_Model_205User_Manual_1.pdf?v=1767664470)
- [Official Model D.0205.001 release note](https://www.fjdynamics.com/se/blog/product-updates-50/release-note-fjd-trion-model-d-0205-001-853)
- [Official Model V207.001 release note](https://www.fjdtrion.com/blog/product-updates-2/fjd-trion-model-v207-001-159)

The older manual spells the input generically and predates the exact
`.fjdslamp2.tgz` suffix. It does not literally print that suffix. The conclusion
that the supplied P2-style package belongs in the same direct-TGZ path is an
inference from FJD's successive `fjdslamxx`, P2, and direct-TGZ support claims.
If the current client rejects the outer file, do not rename or unpack it to
work around the check; preserve the original and ask FJD support which Trion
Model/Scan versions produced and consume this suffix.

## Recommended Trion Model processing

The labels below follow the official 205 manual. The UI may have moved in newer
builds, but the processing products remain the same.

### 1. Preserve the original

- Copy the TGZ without changing its name or contents.
- Record its byte count, SHA-256, scanner model, scanner/Scan-app version,
  capture mode, and whether the built-in or an external camera was used.
- If an external Insta360 camera was used, keep its original `.insv` files
  beside the TGZ. They are a required source, not disposable intermediates.

### 2. Map the raw package to a metric point cloud

In **Start -> Point Cloud Mapping**:

1. Browse to the **outer `.fjdslamp2.tgz`**.
2. Choose the actual scanner model and capture scenario; for this sample, use
   `Indoor` only if that is how it was captured.
3. Enable the mapping report so mapping quality is preserved as evidence.
4. Enable RTK fusion or control-point optimization only when the corresponding
   field data was actually collected. The manual says those two modes cannot
   be enabled simultaneously.
5. Use Back to starting point only for a capture that failed to close its loop.
   Moving-object removal is appropriate if people or vehicles moved through
   the scan. Mapping filtering, densification, colorization range, and coloring
   frequency are quality controls, not values to guess; inspect the first
   result and retain the chosen settings with the mapping report.
6. If camera data exists, request point-cloud colorization as part of mapping
   or run **Start -> Point Cloud Colorization** afterwards.

The manual says the result becomes a point-cloud object and is saved beside
the raw package. FJD's product page lists LAS, PLY, PTS, and E57 as common
point-cloud formats, and the manual says the point-cloud Export action supports
those formats:

- [Official Trion Model product page](https://us.fjdynamics.com/products/trion-model-software)
- [Official Trion Model 205 manual, sections 3.5.1, 4.5, 5.1.1, and 5.1.6](https://cdn.shopify.com/s/files/1/0755/7876/9593/files/EN-FJD_Trion_Model_205User_Manual_1.pdf?v=1767664470)

**Platform handoff:** export E57 and LAS when practical. E57 is the richer
archive candidate according to FJD's D203 release note, which says its
structured E57 export can contain point clouds, images, and transformation
matrices. However, the public 205 manual exposes only a generic E57 file type
and no structure/image toggle, so that richer behavior remains unverified for
this software build until the actual file is inspected. LAS is a useful
independent metric geometry input. Preserve the native mapped project and
`.fjdata` configuration alongside both exports.

- [Official Model D203 release note: structured E57 export](https://www.fjdynamics.com/blog/product-updates-50/new-release-fjd-trion-model-v1-000-d-0203-515)

### 3. Generate the photorealistic 3DGS result

In **Gaussian Modeling -> Reality Modeling**:

1. Select the mapped point cloud.
2. Choose the real scenario and camera type.
3. For a **built-in camera**, the manual says to select the original
   `.fjdslam` or `.fjdslam.tgz` project data. For this package, use the intact
   outer `.fjdslamp2.tgz` through the current client's TGZ/P2 input path.
4. For an **external camera**, select the original `.insv` video. An archive by
   itself is not proof that the external video is embedded.
5. Choose a save path and run Reality Modeling. The documented output is a 3D
   Gaussian model in `.ply` format.

Source: [Official Trion Model 205 manual, section 12.1.1](https://cdn.shopify.com/s/files/1/0755/7876/9593/files/EN-FJD_Trion_Model_205User_Manual_1.pdf?v=1767664470). FJD's D205 release is the
first official release note found that announces Gaussian-model creation from
Trion scanner data: [Model D205 release note](https://www.fjdynamics.com/dk/blog/product-updates-50/release-note-fjd-trion-model-1-000-d-0205-782).

The supplied TGZ has no separate `.insv` companion. That is consistent with a
built-in-camera capture, but the file inventory alone cannot prove which camera
mode was used. Confirm it from the scan record or the Trion Model prompt.

### 4. Export frame and pose evidence

For the mapped point cloud, use its project-file actions to retain:

- `.fjdata` configuration;
- extracted scan pose (`.txt`);
- trajectory (`.trajectory.las`), if needed;
- mapping report;
- the selected E57/LAS point cloud; and
- the Gaussian PLY.

The manual requires `.fjdata` for trajectory/control-point/pose-dependent
operations and documents configuration and scan-pose extraction in section
3.5.1. These files should travel together as one capture/result bundle.

### 5. Optional mesh

In **Edit -> Triangular Mesh**, select the cleaned point cloud and choose:

- **TIN** for an approximately planar target, such as a ground/floor surface;
  or
- **Surface Triangular Mesh** for an enclosed surface.

The result can be exported as OBJ, PLY, STL, and other model formats. For a
walkable indoor platform, a whole-scene surface mesh may bridge doorways,
furniture, or occlusions. Keep the metric classified point cloud as the source
of truth and qualify any mesh before treating it as collision.

Source: [Official Trion Model 205 manual, sections 3.5.2 and 6.5.1](https://cdn.shopify.com/s/files/1/0755/7876/9593/files/EN-FJD_Trion_Model_205User_Manual_1.pdf?v=1767664470).

### 6. Optional panoramas

In **Display -> Panorama Image Export**:

1. select the point cloud;
2. load its `.fjdata` configuration and camera video when prompted (one MP4 or
   two INSV files in the documented 205 workflow);
3. choose extraction by distance or time interval;
4. Generate, review, and Export.

FJD describes the result as panorama images plus corresponding position
information. Preserve both, rather than copying only the JPEGs.

Source: [Official Trion Model 205 manual, section 7.3.3](https://cdn.shopify.com/s/files/1/0755/7876/9593/files/EN-FJD_Trion_Model_205User_Manual_1.pdf?v=1767664470). The D205 release added pose
optimization and fixed-point-image export to the panorama workflow:
[D205 release note](https://www.fjdynamics.com/dk/blog/product-updates-50/release-note-fjd-trion-model-1-000-d-0205-782).

## Linkage transform/export semantics are unresolved

The manual's Gaussian **Image Fusion -> Linkage** operation asks the user to
select the Gaussian and its corresponding point cloud, then performs a matching
calculation so both can be **displayed simultaneously at the same position**.
The documented operation has no Export or Save-transform step. The earlier
point-cloud/video Linkage operation is likewise described as synchronized
display.

Therefore Linkage is useful visual QA, but whether it writes a shared transform
into either portable file or exposes a transformation matrix is **unresolved**.
The current public documentation establishes neither behavior. Do not treat
“looks aligned in Trion Model” as a machine-readable registration receipt.
Export the native `.fjdata`, scan pose, point cloud, and Gaussian together,
then have the receiving platform measure their frame agreement before
permitting collision or navigation.

Source: [Official Trion Model 205 manual, sections 7.3.2 and 12.2.1](https://cdn.shopify.com/s/files/1/0755/7876/9593/files/EN-FJD_Trion_Model_205User_Manual_1.pdf?v=1767664470).

## Current-version evidence and documentation gap

On 2026-08-12, FJD's official Support Center download linked to:

`https://cdn-fjdynamics.fjdynamics.com/S1_download_document/FJDTrionModel-setup.zip`

A read-only HTTP and ZIP-central-directory check measured:

- `Last-Modified: Mon, 10 Aug 2026 07:52:37 GMT`;
- `Content-Length: 6,552,801,892`; and
- installer folder/file name `FJDTrionModelV1.000.D.0208.001.setup`.

That is the current first-party public installer identity this research could
verify. No first-party page or release note found in this pass documents a
`V2.0.8.2` label. If an installed client's About dialog reports `V2.0.8.2`,
retain a screenshot because its relationship to public `D.0208.001` is not
documented. The public manual linked beside the installer is still the October
2025 Model 205 manual, so exact 208 UI wording and any newer P2 package behavior
remain under-documented.

## Minimum bundle to return for platform qualification

Return one folder containing:

- untouched `.fjdslamp2.tgz`;
- external `.insv` source files, if any;
- mapped colorized `.e57` and/or `.las`;
- Gaussian `.ply`;
- `.fjdata` configuration and extracted scan pose;
- mapping report;
- optional mesh OBJ/PLY/STL;
- optional panorama images plus their positions; and
- a small manifest recording file names, byte counts, SHA-256 values, scanner
  and software versions, camera mode, coordinate system, units, and every
  processing option used.

This bundle is usable as a platform input and qualification corpus. The raw TGZ
by itself is only reconstructable source evidence.
