# FJD P2 independent reconstruction pipeline

Research date: 2026-08-14

Capture inspected: `2026-08-12-17-14-01.fjdslamp2.tgz`

Question: Is the raw P2 package sufficient to reconstruct a metric point cloud
and Gaussian splats without FJD Trion Model, and does FJD publish a suitable
decoder or processing SDK?

The suffix in the supplied file is `.fjdslamp2.tgz`; `.fldslamp2.tgz` is a
spelling error.

## Decision

**The capture is sufficient source material when an FJD decoder is present,
but it is not sufficient input for an independently implemented pipeline with
the public interfaces available today.**

- **Verified:** FJD Trion Model accepts original FJD project data and can turn
  it into a mapped point cloud and a Gaussian PLY. The successful PLY and
  `.fjdata` already returned from this exact capture are direct local evidence
  that the capture contains enough vendor-readable source data for its visual
  reconstruction path. FJD's own Model manual also requires the original
  `.fjdslam`/`.fjdslam.tgz` when creating a Gaussian from a built-in-camera
  capture.
- **Verified:** FJD publishes a C++ **SLAM SDK** for live S2/P2/P1 scanners. It
  discovers and connects to a scanner, starts/stops a scan, lists scanner maps,
  and downloads FJDSLAM, PLY, PTS, LAS, FJDRTK, RTCM, or INSV data.
- **Verified:** That public SDK has no documented method to open a local
  `.fjdslam*` archive, decrypt it, expose raw LiDAR/IMU/camera samples, run
  offline mapping, colorize a cloud, or train a Gaussian. Its public surface is
  a device-control and download API, not a raw-format decoder or reconstruction
  library.
- **Unknown:** No public FJD byte specification, offline decoder API, calibration
  schema, or redistribution licence for `.fjdslamp2` was found in the official
  support material or current SDK package. FJD may offer one privately; that
  requires a direct commercial/engineering answer from FJD.

**Recommendation:** Do not build a production dependency on reverse-engineering
`.fjdslamp2`. For the existing capture, use Trion Model once to export standard
geometry and image/pose evidence. For future captures, automate standard-output
download from the live scanner, then own everything downstream. Only pursue a
fully independent raw SLAM decoder if FJD supplies a supported format contract,
calibration data, and licence.

## Evidence labels

- **Verified** means directly observed in this capture, the official SDK
  package, or first-party documentation.
- **Inferred** means an engineering conclusion that follows from verified
  evidence but is not promised explicitly by FJD.
- **Unknown** means the public contract does not answer it; it must not be
  treated as available in production.

## What is actually in the supplied TGZ

Read-only inspection produced this receipt:

| Check | Observed result |
| --- | --- |
| Outer file | `2026-08-12-17-14-01.fjdslamp2.tgz` |
| Outer bytes | `609,755,692` |
| SHA-256 | `3c9b4452d4470bb28170a09816ec52ef67671f9d129ffb2cc72f80619d3dec6e` |
| Gzip integrity | pass |
| Tar integrity | pass |
| Tar entries | one regular file |
| Inner file | `2026-08-12-17-14-01.fjdslamp2` |
| Inner bytes | `906,371,072` |
| Inner prefix | opaque binary; it does not begin with a published portable-format magic |

A complete streaming scan of all `906,371,072` inner bytes found none of these
portable asset signatures:

- PLY header: `ply\nformat` or `ply\r\nformat`;
- LAS header: `LASF`;
- E57 header: `ASTM-E57`;
- PNG signature; or
- common ISO/QuickTime MP4 `ftyp` signatures.

This does not prove that images or sensor readings are absent. It proves that
they are not exposed as those ordinary embedded files. FJD Model Web explicitly
describes uploading original `FjdsalmXX` data for **data decryption and cloud
generation**, and the Model D.0205.001 release separately announces parsing for
`fjdslamxx` packages. Those first-party descriptions match the observed opaque
payload:

- [FJD Trion Model Web user guide](https://store.fjdtrion.com/pages/fjd-trion-model-web-user-guide)
- [FJD Trion Model D.0205.001 release note](https://www.fjdynamics.com/se/blog/product-updates-50/release-note-fjd-trion-model-d-0205-001-853)

### Sufficiency answer

- **Verified:** The archive is a valid, intact FJD source package.
- **Verified:** It is sufficient for FJD's supported mapping and built-in-camera
  Gaussian workflow. The official Model 205 manual, section 12.1.1, says Reality
  Modeling creates a Gaussian from a point cloud and panoramic video; for the
  built-in camera it requires the original `.fjdslam` or `.fjdslam.tgz`, and
  writes a `.ply` Gaussian.
- **Inferred:** The archive therefore carries, or enables FJD to recover,
  synchronized visual and spatial information needed by that workflow.
- **Unknown:** The individual LiDAR, IMU, camera, clock, calibration, and pose
  records cannot be recovered reliably from the archive under any public FJD
  contract found in this research.

Source: [official FJD Trion Model 205 manual (PDF), sections 5.1.1 and
12.1.1](https://cdn.shopify.com/s/files/1/0755/7876/9593/files/EN-FJD_Trion_Model_205User_Manual_1.pdf?v=1767664470).

## What the public FJD SLAM SDK can and cannot do

FJD's official developer guide calls the SLAM SDK a C++ library for
communicating with S2/P2/P1 devices. Its documented public class provides:

- device discovery and connection;
- device self-check and clock synchronization;
- start/stop scanning;
- current map name and map-list queries; and
- `download_map_data(mapname, type, save_path)`.

The download enumeration contains `FJDSLAM`, `PLY`, `PTS`, `LAS`, `FJDRTK`,
`RTCM`, and `INSV`. The official sample ends by requesting `LAS` from the
connected scanner.

Sources:

- [official FJD SLAM SDK developer guide](https://www.fjdtrion.com/slam-sdk-developer-guide)
- [official FJD SLAM SDK product page](https://www.fjdtrion.com/slam-sdk)
- [official FJD SLAM SDK downloads](https://www.fjdtrion.com/support-center-fjd-trion-slam-sdk)

The current official Ubuntu 22.04 x86 package linked from that guide was also
inspected:

| SDK package receipt | Observed result |
| --- | --- |
| Version in `include/version.h` | `1.0.3` |
| Downloaded ZIP bytes | `829,643` |
| SHA-256 | `af90508ecca27349c47f9af1d34ea1d596ce807784c8ce4627a09d3e6ecedfa2` |
| Product code included | header, sample, and precompiled shared/static libraries |
| Public methods | same device-control/download methods documented above |
| Offline archive decoder method | none |
| Mapping/3DGS method | none |
| Package-level licence file | none present |

[Official Ubuntu 22.04 SDK package](https://drive.google.com/file/d/1TclmVTNDHElOQypnjn_IcAZCroo3JAdw/view?usp=drive_link)

The precompiled library contains the download filename `fjdslam.tgz`, which is
consistent with fetching a vendor archive from the scanner. It does not add a
public local-file import/decode method.

The newer official Android package was checked independently so this conclusion
does not rest only on the September 2025 Linux build:

| Android SDK receipt | Observed result |
| --- | --- |
| Version in `VERSION.txt` | `1.0.4` |
| Build time | `2026-06-22 09:57:19` |
| Downloaded ZIP bytes | `602,894` |
| Public Java methods | device discovery/connection, start/stop, map list, map download, time sync, status, and version |
| Download types | FJDSLAM, PLY, PTS, LAS, FJDRTK, RTCM, and INSV |
| Offline archive or raw-sensor API | none |

Source package: [official FJD SLAM SDK downloads](https://www.fjdtrion.com/support-center-fjd-trion-slam-sdk).

### Practical consequence

| Desired operation | Public SDK status | Conclusion |
| --- | --- | --- |
| Control a live P2 and download its map | **Verified supported** | Viable for future capture automation |
| Download live-device PLY/LAS without desktop Model | **Verified documented** | Can avoid Trion Model for the scanner's available standard map output |
| Import this existing TGZ into the SDK | **Not documented** | Do not design around it |
| Decode raw LiDAR/IMU/images/calibration | **Not exposed** | Blocks an owned raw SLAM adapter |
| Run offline mapping/colorization | **Not exposed** | SDK is not a replacement for Model processing |
| Generate Gaussian PLY | **Not exposed** | Use an owned image pipeline or FJD Model |
| Redistribute the SDK library in our platform | **Unknown** | Obtain written licence terms first |

The distinction matters: downloading a LAS from the live scanner avoids the
desktop application, but it still relies on FJD scanner firmware and its map
generation. That is an automated vendor-output boundary, not an independently
owned SLAM implementation. FJD's current P2 support page also says P2 mapping
and point-cloud colorization require supported Model PC/iPad/Android versions.
Therefore the SDK-downloaded cloud must not be assumed equivalent to Model's
post-processed/colorized result until the two are measured on the same capture:

- [official FJD P2 support and compatibility notes](https://www.fjdtrion.com/support-center/fjd-trion-p2-lidar-scanner)

- [official P2 firmware V1.2.0 release note](https://www.fjdtrion.com/fr/blog/product-updates-2/fjd-trion-p2-firmware-v1-2-0-1053),
  which requires Model PC V207.001 or above for P2 mapping and point-cloud
  colorization.

FJD also offers a hosted alternative rather than an independent decoder. Model
Web V1.4.2 accepts `.fjdslam` uploads for paid/authorized cloud mapping,
colorization, and GNSS registration, and V1.4.3 adds cloud 3DGS generation. No
public unattended processing API was found, and those notes do not explicitly
promise acceptance of this capture's `.fjdslamp2.tgz` suffix:

- [official Model Web V1.4.2 release note](https://www.fjdtrion.com/es/blog/product-updates-2/fjd-trion-model-web-v1-4-2-267)
- [official Model Web V1.4.3 release note](https://www.fjdtrion.com/jp/blog/product-updates-2/fjd-trion-model-web-v1-4-3-1048)

## The viable own-pipeline route

### Route A — recommended: own the pipeline after standard export

This route avoids Trion Model for routine future captures while not attempting
to decode `.fjdslamp2`.

1. **Acquire geometry from the scanner.** Use the SDK to download the LAS or
   PLY that the live P2 reports as available. FJD's P2 product specification
   advertises on-device real-time point-cloud processing and export of LAS,
   PLY, PTS, and E57. Treat this as the real-time/device product until a
   same-capture comparison proves it matches Model post-processing.
2. **Acquire images.** The P2 specification advertises built-in-camera JPEG
   export. For an external Insta360, preserve the original INSV; INSV is also
   present in the SDK download enumeration.
3. **Preserve provenance.** Record scanner/firmware/SDK versions, original map
   name, file hashes, coordinate system, units, and whether the files were
   real-time or post-processed outputs.
4. **Qualify metric geometry.** Validate the LAS/E57/PLY schema, units, axis,
   bounds, point finiteness, density, and floor/collision suitability. Keep it
   as structural truth.
5. **Solve image cameras.** Extract overlapping stills from JPG/INSV input and
   solve intrinsics, camera poses, and sparse geometry with COLMAP, or import
   vendor-provided calibrated poses if FJD documents them.
6. **Put images and LiDAR in one metric frame.** Use a measured camera-to-LiDAR
   calibration, surveyed correspondences, or a validated image/LiDAR
   registration. A merely plausible visual alignment is not a transform
   receipt.
7. **Train and export the visual model.** Train Splatfacto/gsplat from the
   calibrated image set, preferably initialized from registered geometry, then
   export Gaussian PLY and convert it to the platform delivery format.

First-party implementation requirements support this design:

- FJD's [official P2 specification](https://www.fjdtrion.com/product/fjd-trion-p2-lidar-scanner)
  advertises on-device point-cloud processing, LAS/PLY/PTS/E57 output, and
  built-in-camera JPEG export.
- The [COLMAP tutorial](https://colmap.github.io/tutorial.html) describes the
  image-based reconstruction sequence: recover sparse scene geometry and
  camera poses with structure from motion, then optionally produce dense
  geometry.
- Nerfstudio's [custom-data guide](https://docs.nerf.studio/quickstart/custom_dataset.html)
  states that it needs a camera pose for every image, supports video/images and
  360 input through COLMAP, and documents equirectangular preprocessing.
- Nerfstudio's [Splatfacto documentation](https://docs.nerf.studio/nerfology/methods/splat.html)
  says Gaussian training benefits from pre-existing SfM geometry and exports a
  Gaussian `.ply`.
- The original [Graphdeco 3D Gaussian Splatting implementation](https://github.com/graphdeco-inria/gaussian-splatting)
  documents its required COLMAP cameras, registered images, and sparse 3D
  points.

FJD itself describes a modular third-party 3DGS workflow using an exported
colorized point cloud plus raw external-camera video. That is first-party
confirmation of the boundary proposed here; it is not evidence that the
`.fjdslamp2` archive is publicly decodable:

- [FJD: P2 support for 3DGS workflows](https://store.fjdtrion.com/it/blogs/3d-modeling/does-fjd-trion-p2-support-3dgs-3d-gaussian-splatting-workflows)

### Route B — fully own raw LiDAR-inertial reconstruction

An independent SLAM implementation is technically possible only after the raw
vendor payload is converted into a documented sensor stream. At minimum the
adapter needs:

- per-point LiDAR coordinates/returns, channel information, and timestamps;
- synchronized IMU angular velocity and acceleration with units and axis
  conventions;
- LiDAR-to-IMU extrinsic rotation and translation;
- clock/time-offset and motion-distortion semantics;
- camera images, capture times, intrinsics/distortion, and camera-to-IMU/LiDAR
  extrinsics;
- GNSS/RTK observations and reference-frame metadata when present; and
- validity/status records needed to reject corrupt or incomplete samples.

This is not speculative algorithm preference. The official FAST-LIO
implementation requires synchronized LiDAR and IMU data, per-point timestamps
for motion compensation, and LiDAR/IMU extrinsics:

- [HKU-MARS FAST-LIO official repository](https://github.com/hku-mars/FAST_LIO)

Other SLAM, visual-inertial, or LiDAR-inertial implementations differ in their
models, but they cannot recover missing sensor timing and calibration from a
mapped PLY. A point cloud export is suitable downstream geometry; it is not a
substitute for the raw observations needed to reproduce the mapping.

**Current status: blocked by an input contract, not by lack of open-source SLAM
algorithms.** No public FJD interface found here supplies the required raw
records from `.fjdslamp2`.

## What this means for the existing capture

The fastest complete path is:

1. Keep the original TGZ unchanged as provenance.
2. Keep the already-generated Gaussian PLY and `.fjdata`.
3. Use Trion Model once more to export the mapped E57 or LAS, mapping report,
   scan pose, and built-in-camera JPGs if that export is available for this
   project.
4. Ingest the Gaussian as appearance and E57/LAS as metric structure.
5. If eliminating FJD's Gaussian generator is a product goal, benchmark the
   exported JPG/INSV sequence through COLMAP and Splatfacto, then register the
   result to the E57/LAS with a measured transform.

The TGZ alone should remain an accepted **source-evidence/archive** type, not a
direct platform reconstruction input, until a supported decoder is obtained.

## Questions to send FJD before building anything raw-specific

Request written answers and an evaluable package for these points:

1. Is there a supported offline SDK or headless CLI that accepts
   `.fjdslamp2` or `.fjdslamp2.tgz` and exports mapped LAS/E57, images, and
   poses without Trion Model's GUI?
2. Is there a published or partner-only `.fjdslamp2` format/decryption SDK?
3. Can it expose timestamped LiDAR, IMU, GNSS, and built-in-camera samples plus
   all intrinsics, extrinsics, time offsets, units, and coordinate conventions?
4. Can the public SLAM SDK import an archive after it has left the scanner, or
   can it only download map products from a connected device?
5. How are built-in JPGs associated with pose records, and can that association
   be exported in a documented machine-readable format?
6. What licence permits unattended server use and redistribution of the SDK
   runtime inside a commercial platform?
7. Which scanner firmware/package versions are compatible with each decoder
   version, and what deterministic error is returned for an unsupported
   package?

The official support center lists `support@fjdtrion.com`:
[FJD Trion downloads/support](https://store.fjdtrion.com/pages/downloads).

## Go/no-go recommendation

- **Go:** build a small live-P2 SDK spike that downloads LAS/PLY and INSV, and
  separately verify the advertised built-in JPG export. This tests whether
  routine capture can bypass desktop Model.
- **Go:** build the owned standard-input lane from LAS/E57 + JPG/INSV through
  registration and Gaussian training.
- **No-go for production today:** write or ship an independently
  reverse-engineered `.fjdslamp2` decoder.
- **Reconsider the no-go:** only after FJD supplies the format/decryption and
  calibration contract with commercial runtime terms, or a supported headless
  converter that makes raw internals irrelevant.
