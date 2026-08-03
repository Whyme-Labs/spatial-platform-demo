# Official XGRIDS and FJD sample exports

Research date: 2026-08-03

## Decision

Official samples exist for both vendors, but FJD is the first capture device in
the product rollout. Qualification order is therefore FJD first and XGRIDS
later:

- Use the FJD **P2 Horse 3DGS** archive to qualify FJD package inspection,
  Gaussian PLY validation, Spark RAD building, and result lineage. It pairs
  scanner raw data and external video with a Gaussian PLY result, but it is an
  object capture rather than an indoor navigation test. A separate local-only
  Studio adapter/browser E2E now passes; the bytes must never be published or
  rehosted without a redistribution grant.
- Use FJD **Building** or the V4e **interior** LAS for point-cloud and indicative
  floor-plan processing. Neither is paired with a 3DGS visual result in its
  published folder, so it cannot prove visual-to-collision registration.
- Defer the XGRIDS **Apartment** archive until the FJD lane is complete. It is
  the smallest paired XGRIDS visual-and-mesh package found: LCC2 metadata, SOG
  3DGS tiles, PLY mesh tiles, spatial poses, and one shared coordinate tree in
  50,624,921 bytes.
- No public XGRIDS raw scanner capture project was found. The public XGRIDS
  packages are generated model exports, not inputs that can qualify our
  capture-to-reconstruction adapter.

Neither vendor sample location presents a dataset-specific redistribution
licence. The inspected XGRIDS descriptor says the model is all-rights-reserved.
Keep these downloads in a private, ignored qualification cache; do not commit,
mirror, or publish their bytes without written permission.

## Qualification matrix

| Vendor sample | Verified package | What it can validate | What it cannot validate |
| --- | --- | --- | --- |
| XGRIDS Apartment | 50,624,921-byte ZIP; LCC2 descriptor; 8 SOG model tiles plus `env.sog`; 8 PLY mesh and `.btree` pairs; `poses.json`; thumbnail | LCC2/SOG ingestion, LoD selection, tiled mesh ingestion, pose parsing, visual/mesh frame checks, collision-proxy and navigation generation | Raw scanner import, LCC Studio reconstruction, automatic spatial-recognition metadata, redistribution rights |
| XGRIDS `[PortalCam] Office Showroom` | 561,334,664-byte ZIP; 81 SOG files, 32 PLY mesh and 32 `.btree` files, `meta.lcc2`, thumbnail | A larger real indoor LCC2/SOG streaming test and paired visual/mesh processing | Raw PortalCam capture, pose import, redistribution rights |
| XGRIDS public showroom viewer | Public viewer backed by a 1,701-byte `.lcc` manifest declaring 11,620,122 splats; model data is fetched as remote sidecars | Vendor viewer smoke and legacy LCC URL loading | A self-contained offline fixture, raw capture, collision or navigation generation |
| FJD P2 Horse 3DGS | 2,587,208,251-byte ZIP containing processed `.fjdata` and Gaussian `.ply`, plus raw `.fjdslamp2.tgz` and Insta360 `.insv` | FJD raw-package extraction, video-sidecar association, Gaussian PLY ingestion, raw-to-result provenance | Indoor room/floor-plan quality, paired collision mesh, multi-room navigation |
| FJD P2 Building | 11,199,632-byte `.fjdata` plus 1,506,175,261-byte LAS | Real FJD point-cloud decoding, scale/axis inspection, floor/wall extraction experiments | 3DGS rendering or proof that a visual and collision source share one frame |
| FJD V4e sample folder | Five colorized LAS files; 83,797,959 to 306,406,557 bytes; one is explicitly named as an interior capture | LAS ingestion, color attributes, real interior point-cloud processing | Native P2 project handling, 3DGS, paired mesh/visual registration |
| FJD `.Fjdm` samples | Two opaque files: 641,846,025 and 1,575,367,999 bytes | Upload/storage routing and deliberate unsupported-format errors | Decoding or reconstruction until FJD supplies a format contract or supported converter |

## XGRIDS evidence

The [official XGRIDS sample catalogue](https://developer.xgrids.com/#/download?page=sampledata)
currently lists 21 model archives through the vendor's
[catalogue API](https://api-gw.xgrids.com/front-api/lcc-model/fine/v3). The
catalogue ranges from the 48.28 MiB Apartment to a vendor-reported 2.31 GB
Cultural Palace model. The normal download UI required an XGRIDS login during
this check. XGRIDS' official Web SDK also directs developers to this exact
sample-data page. See the
[official Web SDK README](https://github.com/xgrids/LCC-Web-SDK/blob/main/README.md).

The smallest archive is directly available from XGRIDS-owned storage:

- [Apartment / `XGRIDS_Revit__Home.zip`](https://da9i2vj1xvtoc.cloudfront.net/lcc-pub/lcc2-v1/XGRIDS_Revit__Home.zip)
- byte size: `50,624,921`
- SHA-256: `208665cec0c44a7198586749ef739bb60fd7be61f6903e387ae7ad9a3895fb0d`
- LCC2 metadata: `4,148,359` total splats across four LoD levels, portable
  `L2Pro`, SOG encoding
- mesh metadata: eight tiles totalling `29,648` vertices and `32,011` faces
- poses: `3,160`

This is materially better than a visual-only splat for Spatial Studio because
the 3DGS and mesh are packaged beneath one LCC2 hierarchy. It still needs a
measured frame-consistency check before the mesh is treated as collision
evidence. File co-location is not itself a registration receipt.

The current XGRIDS manual confirms that LCC2 can contain SOG or SPZ, optional
mesh described as collision data, and optional spatial-recognition results.
It also lists PLY, USD, and 3D Tiles exports. See
[My Models and export formats](https://docs.xgrids.com/en-us/06-lixel-cybercolor/01-lcc-studio/v2.2.0/11-my-models.html#export-formats).
The inspected Apartment archive contains mesh and poses but no separately
identified spatial-recognition or floor-plan result.

For a more representative PortalCam indoor load, the same catalogue exposes
[Office Showroom](https://da9i2vj1xvtoc.cloudfront.net/lcc-pub/lcc2-v1/Office%20Showroom.zip).
Its exact `561,334,664`-byte size and 152-entry inventory above were read from
the HTTP content range and ZIP central directory without downloading the full
archive.

XGRIDS' public PortalCam page also links a
[legacy LCC showroom viewer](https://lcc-viewer.xgrids.cloud/?data=https://cdn-buklcc1.xgrids.cloud/lcc-pub/portalcam/showroom%20level%202/showroom2.lcc).
That is a viewer experience, not a complete offline model download. XGRIDS'
[pre-reconstruction manual](https://docs.xgrids.com/en-us/06-lixel-cybercolor/01-lcc-studio/v2.0.0/05-pre-reconstruction.html)
describes raw capture import from local storage or a connected device; no
equivalent public raw package was found in the catalogue or official SDK
releases.

## FJD evidence

The official [FJD sample-data page](https://store.fjdtrion.com/pages/sample-data)
links public vendor-managed Google Drive folders for
[P2](https://drive.google.com/drive/folders/1TeX-RLZ3PwZCDhOJYnp2-N1Vk3JxLLKU?usp=drive_link)
and
[V4e](https://drive.google.com/drive/folders/1PlS77t9KxU0bAYVQ4-nQ4HEzS0xyw52n).
No account was required to read or range-download the files during this check.

The P2 folder's `P2 Horse 3DGS.zip` is a real paired raw/result package. Its ZIP
central directory contains exactly:

| Entry | Uncompressed bytes |
| --- | ---: |
| `3DGS result/..._Gaussian.fjdata` | 9,747,730 |
| `3DGS result/..._Gaussian.ply` | 536,812,164 |
| `Raw data/...fjdslamp2.tgz` | 1,646,293,973 |
| `Raw data/...insv` | 457,232,738 |

The same P2 folder currently exposes Building and Roman Forum `.fjdata` + LAS
pairs, a standalone railway LAS, and two `.Fjdm` files. The V4e folder exposes
five colorized LAS files, including one explicitly named as an interior test.
FJD's
[official P2 specifications](https://us.fjdynamics.com/products/fjd-trion-p2-scanner)
independently list point clouds, floor plans, mesh, 3DGS and panoramas as
deliverables, and LAS/PLY/PTS/E57 as point-cloud formats.

These samples close the basic "does genuine FJD data exist for testing?" gap.
The P2 PLY and `.fjdata` now also pass the isolated `fjd-trion` import,
quality-RAD build, private range delivery, and Chrome render lifecycle with no
release or cloud storage. They do **not** close the platform's production
acceptance gap: the published
FJD indoor geometry is not paired with its visual 3DGS, while the paired Horse
archive is not a building and contains no collision mesh.

## Platform compatibility gap

The current production-shaped acceptance order should therefore be:

1. FJD P2 Horse for raw-package, external-video, and Gaussian-result lineage.
2. FJD Building or V4e interior LAS for geometry and indicative floor-plan
   generation.
3. A vendor-supplied or permission-cleared **FJD indoor bundle containing both
   3DGS and mesh/LAS in one declared frame** before claiming automatic FJD
   navigation publication.
4. XGRIDS Apartment for the later LCC2/SOG + tiled-mesh adapter test.
5. XGRIDS Office Showroom for later indoor streaming, collision generation,
   and navigation continuity after the small XGRIDS fixture passes.
6. A vendor-supplied **XGRIDS raw capture project** before claiming that our
   XGRIDS capture-to-model path is qualified.

For every real fixture, record the source URL, byte count, SHA-256, vendor and
software version, units, axis, origin, capture/result transform, and written
usage rights. A successful decoder is only a format receipt; it is not a scale,
registration, collision-quality, or redistribution receipt.
