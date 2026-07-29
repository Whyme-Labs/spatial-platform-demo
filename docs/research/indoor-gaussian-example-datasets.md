# Indoor Gaussian smoke-test datasets

Research date: 2026-07-29
Target: a small, repeatable `images → COLMAP → Nerfstudio Splatfacto/gsplat →
Gaussian PLY → RAD → web upload` validation.

## Recommendation

Run **Meta EyefulTower `playroom_small` first**.

It is the cleanest publishable smoke input found. Meta deliberately released
this 126-image indoor subset for fast iteration, supplies an exported COLMAP
model documented as gsplat-compatible, and relicensed all repository and
dataset content under **MIT** in March 2026. The smallest usable download is
only about 18 MiB: 126 `images_8` JPEGs plus the sparse COLMAP model.

Use **TUM RGB-D `freiburg1_desk`** to exercise our own COLMAP registration after
the trainer/export path works. It has unambiguous CC BY 4.0 terms, a recognizable
real office, and a manageable deterministic sample of about 100 overlapping
views.

Use **Tanks and Temples `Meetingroom`** as the higher-resolution follow-up. Its
official license page says CC BY 4.0, but the download page also retains
conflicting non-commercial prose. That conflict should be clarified with the
dataset owner before treating a public commercial deployment as cleared.

## Candidate comparison

| Dataset | Indoor content | Primary archive facts | Camera data | Rights and publication fit | Verdict |
|---|---|---|---|---|---|
| **Meta EyefulTower `playroom_small`** | Bright, recognizable playroom captured by the EyefulTower v3 rig | Official table: **14 cameras, 3 positions, 126 images**. The `colmap/images_8` prefix contains 126 JPEGs at about 688×458 and 14.8 MiB; the sparse model is about 2.9 MiB, verified from the owner-hosted S3 objects. | Exported COLMAP reconstruction and undistorted `images_2`, `images_4`, and `images_8`; the official README says the export is compatible with gsplat. | The March 2026 changelog says **all content** was relicensed MIT. Preserve the copyright/license notice and cite VR-NeRF as requested by the dataset README. | **First choice:** tiny, calibrated, gsplat-ready, and publishable. |
| **TUM RGB-D `freiburg1_desk`** | Handheld sweeps over four desks in a typical office | 328 MiB downloaded; **613 RGB PNGs**, 640×480, plus 595 depth PNGs. Counts were verified from the owner-hosted archive; the official format page specifies 640×480 RGB. | Ground-truth trajectory and calibrated RGB intrinsics are supplied, although the baseline should still exercise COLMAP from RGB. | The official benchmark page says all data is **CC BY 4.0** unless stated otherwise. Attribution is required; commercial/public reuse is allowed by that license. | **Second run:** validates our raw-image registration path. |
| **Tanks and Temples `Meetingroom`** | Full meeting room, recorded as a video-derived image sequence | 416 MiB downloaded; **371 JPEGs at 1920×1080**, verified from the owner-hosted archive. The official page says image sets are sampled from video at 1 fps. | The site provides a reference COLMAP reconstruction separately, but intentionally does not provide exact intrinsics for the image set; rerunning COLMAP is appropriate. | The dedicated official license page says **CC BY 4.0**, including commercial adaptation. However, the official download page also says the data is for non-commercial purposes. Treat commercial publication as unresolved until the owner confirms which notice controls. | **Best visual follow-up:** higher resolution and established reconstruction benchmark. |
| **ETH3D `office`** | High-resolution indoor office | Official dataset table: **26 images**, 0.3 GB for undistorted JPEGs; the benchmark describes its DSLR images as 24 Mpx. | Calibration is supplied directly in COLMAP text format. | Official site license: **CC BY-NC-SA 4.0**. Suitable for internal/non-commercial evaluation; a derivative published on a commercial product would inherit non-commercial/share-alike constraints. | Good calibrated diagnostic, not the default public-platform demo. |

## Exact downloads

### 1. Meta EyefulTower `playroom_small`

The official project recommends anonymous AWS CLI downloads:

```bash
aws s3 cp --recursive --no-sign-request \
  s3://fb-baas-f32eacb9-8abb-11eb-b2b8-4857dd089e15/EyefulTower/playroom_small/colmap/images_8/ \
  playroom_small/colmap/images_8/

aws s3 cp --recursive --no-sign-request \
  s3://fb-baas-f32eacb9-8abb-11eb-b2b8-4857dd089e15/EyefulTower/playroom_small/colmap/sparse/ \
  playroom_small/colmap/sparse/
```

Primary sources:

- [Official repository, scene table, download instructions, data layout, changelog, citation, and license](https://github.com/facebookresearch/EyefulTower)
- [Browsable owner-hosted `playroom_small` objects](https://fb-baas-f32eacb9-8abb-11eb-b2b8-4857dd089e15.s3.amazonaws.com/EyefulTower/playroom_small/index.html)
- [MIT license](https://github.com/facebookresearch/EyefulTower/blob/main/LICENSE)

Use `images_8` for the first trainer/export/upload smoke. If it works but looks
soft, switch only the image directory to `images_4` (about 61 MiB) while keeping
the same sparse model; then try `images_2` (about 232 MiB).

### 2. TUM RGB-D `freiburg1_desk`

```bash
curl -L --fail \
  'https://cvg.cit.tum.de/rgbd/dataset/freiburg1/rgbd_dataset_freiburg1_desk.tgz' \
  -o rgbd_dataset_freiburg1_desk.tgz
tar -xzf rgbd_dataset_freiburg1_desk.tgz
```

Primary sources:

- [Dataset description and direct download](https://cvg.cit.tum.de/rgbd/dataset/#freiburg1_desk)
- [Dataset license and citation](https://cvg.cit.tum.de/data/datasets/rgbd-dataset)
- [Image format and camera calibration](https://cvg.cit.tum.de/data/datasets/rgbd-dataset/file_formats)

For the first run, take every sixth RGB image in lexicographic/timestamp order:
about 103 views. This preserves dense temporal overlap while keeping COLMAP and
training costs low. If registration is weak, retry every fourth image rather
than changing datasets.

### 3. Tanks and Temples `Meetingroom`

The archive is on the official project's Google Drive. This command was
successfully verified on 2026-07-29:

```bash
python -m pip install gdown
gdown \
  'https://drive.google.com/uc?id=0B-ePgl6HF260cV9lNmlZZGp6aUU&resourcekey=0-AvrSVlLY3Q6HP3oVVzSvsw&export=download' \
  -O Meetingroom.zip
unzip Meetingroom.zip
```

Primary sources:

- [Official downloads and Meetingroom image-set link](https://www.tanksandtemples.org/download/)
- [Dedicated official CC BY 4.0 license page](https://www.tanksandtemples.org/license/)

Start with every third frame, about 124 views. If the quality is promising,
train all 371 images as the higher-quality reference.

### 4. ETH3D `office`

```bash
curl -L --fail \
  'https://www.eth3d.net/data/office_dslr_undistorted.7z' \
  -o office_dslr_undistorted.7z
7z x office_dslr_undistorted.7z
```

Primary sources:

- [Official dataset table and direct archive](https://www.eth3d.net/datasets)
- [COLMAP calibration format](https://www.eth3d.net/documentation)
- [Official CC BY-NC-SA 4.0 notice](https://www.eth3d.net/)

The 24 Mpx images should be downscaled before a smoke run. Because the supplied
poses are already in COLMAP format, this scene is especially useful for
separating trainer/export problems from SfM problems.

## Proposed first-run acceptance gates

For `playroom_small`:

1. Download `colmap/images_8` and `colmap/sparse`, record an object manifest and
   hash every downloaded file.
2. Load the supplied COLMAP model and require exactly **126 registered images**.
3. Do not rerun COLMAP in the first smoke: the purpose is to isolate
   Splatfacto, PLY export, RAD conversion, and platform upload.
4. Train Splatfacto for a short smoke budget, then export Gaussian PLY.
5. Reject any PLY that lacks learned per-Gaussian position, opacity, anisotropic
   scale, rotation, and colour/SH fields.
6. Convert the validated PLY to RAD, open it locally in Spark, and only then
   upload it.
7. Publish the MIT copyright/license notice and VR-NeRF citation alongside the
   scene.

After this succeeds, run `freiburg1_desk` from raw RGB with every sixth frame,
requiring at least 90% COLMAP registration. This separates registration failures
from trainer/export failures. If EyefulTower `images_8` looks too soft, move to
`images_4` before changing scenes.

## Excluded popular examples

- Nerfstudio's `poster` capture is extremely convenient through
  `ns-download-data`, but no dataset-specific license or usage grant was found
  alongside the official downloader. The Apache-2.0 code license does not
  automatically license the downloaded photographs.
- Mip-NeRF 360's `room`, `counter`, `kitchen`, and `bonsai` scenes are standard
  splatting benchmarks, but the official project page does not state dataset
  licensing terms. They are unsuitable for our first publicly uploaded
  derivative without separate permission.
- Deep Blending `Playroom` is a recognizable indoor benchmark, but its official
  dataset page does not publish a reusable-data license.
