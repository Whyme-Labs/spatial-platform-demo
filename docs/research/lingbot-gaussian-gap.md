# Closing the LingBot Map to Gaussian-splat gap

Research date: 2026-07-29

## Conclusion

LingBot Map does **not** currently emit trained Gaussian splats in any published
mode or example. It predicts camera pose, depth, confidence, and dense world
points; its official interactive and offline renderers display those results as
a point cloud. The Loop scene currently published by Spatial Studio is therefore
not a photorealistic reconstruction produced by LingBot. It is our compatibility
preview: one million LingBot RGB points wrapped in fixed, isotropic, degree-0
Gaussian records.

The missing stage is multi-view photometric Gaussian optimization. We still need
the overlapping source images, calibrated camera intrinsics/extrinsics, a real
3DGS trainer, and an export/validation step. The 237-frame Loop example contains
all source images and LingBot already predicted per-frame cameras, so it is a
good bounded experiment.

The user's “MipMap” reference is most likely **MipMap Desktop / MipMap Engine**
from Beijing Manman Xingtu Technology Co., Ltd. It is a commercial
image/video-to-Gaussian reconstruction product. It is unrelated to the academic
[Mip-Splatting](https://github.com/autonomousvision/mip-splatting) anti-aliasing
project.

## 1. What LingBot Map actually produces

The LingBot paper defines its task as recovering “camera poses and point clouds”
from video, and describes task heads for camera pose and depth rather than a
Gaussian radiance field:
[paper abstract](https://arxiv.org/abs/2604.14141).

The pinned implementation makes the contract explicit. The model returns:

- `pose_enc`;
- `depth` and `depth_conf`; and
- `world_points` and `world_points_conf`.

Source:
[pinned `gct_base.py`](https://github.com/Robbyant/lingbot-map/blob/1f480aeb8a47a24656090d46d053115b7fe60435/lingbot_map/models/gct_base.py#L300-L315).
Post-processing derives per-frame camera extrinsics and intrinsics:
[pinned `demo.py`](https://github.com/Robbyant/lingbot-map/blob/1f480aeb8a47a24656090d46d053115b7fe60435/demo.py#L278-L304).
The viewer passes XYZ positions and RGB values to Viser as a point cloud:
[pinned point-cloud viewer](https://github.com/Robbyant/lingbot-map/blob/1f480aeb8a47a24656090d46d053115b7fe60435/lingbot_map/vis/point_cloud_viewer.py#L157-L225).

There is no Gaussian head, Gaussian optimization loop, or Gaussian export mode
in the pinned source. The official offline outputs are point-cloud videos,
source-frame video, configuration, and a run summary—not PLY/SPZ/SOG/RAD:
[official output table](https://github.com/Robbyant/lingbot-map/blob/1f480aeb8a47a24656090d46d053115b7fe60435/README.md#output-files).
Streaming, windowed, courthouse, university, Loop, dynamic, and long-sequence
examples all use this same point/depth/camera representation.

LingBot Map is Apache-2.0:
[official license](https://github.com/Robbyant/lingbot-map/blob/1f480aeb8a47a24656090d46d053115b7fe60435/LICENSE.txt).

## 2. What our current Loop release contains

Our successful Modal run used all 237 Loop PNGs, the LingBot streaming mode, and
an NVIDIA A10. It sampled one million points from LingBot's reconstruction. The
source images are only 518 × 294, so even a correctly trained splat will have a
hard ceiling on recoverable texture detail.

Local evidence:

- sibling-run `summary.json`: 237 source frames, one million sampled points,
  approximately 113.5 seconds total;
- sibling-run `trajectory.json`: 237 predicted 3 × 4 extrinsics and 3 × 3
  intrinsics;
- sibling-run `reconstruction-sample.npz`: points, RGB colours, confidence,
  extrinsics, and intrinsics;
- [`loop-full-20mm.gaussian.ply.manifest.json`](../../artifacts/lingbot-map/platform/loop-full-20mm.gaussian.ply.manifest.json):
  one million output records, SH degree 0, 20 mm isotropic scale, alpha 0.9,
  and identity rotation.

The converter in
[`scripts/lingbot-gaussian-core.mjs`](../../scripts/lingbot-gaussian-core.mjs)
does not train anything. It copies point positions and RGB, then assigns the
same opacity, scale, and rotation to every point. That explains the screenshot:
large blurred blobs follow the camera path, but there is no learned anisotropic
shape, occlusion, or view-dependent appearance.

A real 3DGS model optimizes Gaussian centers, anisotropic covariance
(scale/rotation), opacity, and spherical-harmonic appearance against multiple
calibrated views. The original implementation takes a COLMAP or synthetic NeRF
dataset and recommends 24 GB VRAM for its paper-quality configuration:
[official GraphDeco implementation](https://github.com/graphdeco-inria/gaussian-splatting).
Its software license is research/non-commercial, so it is useful as a reference
baseline but is not the preferred product dependency:
[GraphDeco license](https://github.com/graphdeco-inria/gaussian-splatting/blob/main/LICENSE.md).

## 3. MipMap product assessment

MipMap's full-pipeline CLI performs metadata extraction, aerial triangulation,
and reconstruction from images or video. Its explicit Gaussian outputs are
`generate_gs_ply`, `generate_gs_sog`, and tiled SOG:
[official full-pipeline API](https://docs.mipmap3d.com/engine/en/basic/reconstruct-full).
It accepts an image folder or video as the minimum input and can use a local
coordinate system when GPS/POS is absent. This means it can process the original
Loop frames; it cannot recover a photorealistic splat from our RGB point-cloud
PLY alone.

### Inputs and calibration

- Images: JPG/TIFF/PNG; videos include MP4/OSV/INSV/AVI; optional point-cloud
  inputs are LAS/LAZ:
  [Engine product specification](https://na.mipmap3d.com/products/mipmap-engine).
- Visible-light reconstruction solves camera positions/orientations through
  aerial triangulation. EXIF/GPS can help but are not mandatory.
- Its LiDAR lane fuses point clouds **with imagery**. It is not documented as a
  point-cloud-only RGB-to-photorealistic-splat converter.

### Deployment and licensing

- Desktop is a local Windows application. Its current free tier allows up to
  500 images per task and includes visible-light Gaussian PLY/SOG output, so the
  237-frame Loop capture fits:
  [official pricing](https://na.mipmap3d.com/pricing).
- Engine is a proprietary CLI with modular commercial licensing and local or
  private-cloud deployment:
  [Engine product page](https://na.mipmap3d.com/products/mipmap-engine).
- Linux is supported only through the vendor Docker image; WSL is unsupported.
  Gaussian generation requires an NVIDIA GPU with compute capability 7.0+,
  while 32 GB RAM and 500 GB disk are recommended:
  [Linux deployment guide](https://docs.mipmap3d.com/engine/en/overview/linux-deployment).
- The license is online/key-based. The Desktop agreement grants a
  non-transferable, revocable internal-use license, prohibits redistribution and
  reverse engineering, and says users own generated models:
  [subscription agreement](https://na.mipmap3d.com/legal_agreements/EN/subscribe_agreement.html).
  Backend embedding therefore requires a separate Engine commercial agreement.

MipMap does not publish its Gaussian PLY property schema or SH degree. Its SOG
and PLY must pass an actual header, decode, orientation, and render test before
we call them Spark-compatible.

## 4. Ranked integration options

| Rank | Pipeline | Camera/geometry requirement | GPU and deployment | Main risk |
|---|---|---|---|---|
| 1 | **Open product pipeline: images → COLMAP → gsplat/Nerfstudio Splatfacto → Gaussian PLY → Spark RAD** | Re-solve intrinsics, distortion, poses, and sparse points with COLMAP. This is the clean baseline. | CUDA GPU. The current A10 24 GB is a sensible first worker; measure peak VRAM rather than promising a fixed minimum. | More engineering and runtime than a commercial tool; capture registration can fail. |
| 2 | **Fast pilot: Loop images → MipMap Desktop/Engine → GS PLY or SOG → Spark RAD** | Original overlapping images/video; MipMap solves poses. LingBot output is optional comparison evidence. | Desktop: Windows/NVIDIA. Engine: vendor Linux Docker, CC 7.0+, online commercial license. | Proprietary dependency, automation rights, undocumented export schema, and unverified Modal compatibility. |
| 3 | **LingBot-assisted trainer: Loop images + LingBot cameras/points → COLMAP-compatible dataset → gsplat/Splatfacto** | Convert all 237 predicted cameras and the point cloud into a validated dataset; verify camera convention and reprojection before training. | LingBot A10 inference plus a CUDA training job; likely reusable on the same Modal GPU class. | Highest R&D risk: pose convention, crop/intrinsic alignment, missing lens distortion, drift, and custom point initialization. |
| 4 | **GraphDeco reference 3DGS** | Standard COLMAP capture. | Official guidance is 24 GB VRAM for paper-quality training. | Research/non-commercial software license; use only as a comparison baseline unless relicensed. |

Why rank the COLMAP baseline first: Nerfstudio states that splatting works much
better when initialized from SfM geometry and automatically uses points from
COLMAP/`ns-process-data` captures:
[Splatfacto data guidance](https://docs.nerf.studio/nerfology/methods/splat.html).
Nerfstudio and gsplat are Apache-2.0:
[Nerfstudio license](https://github.com/nerfstudio-project/nerfstudio/blob/main/LICENSE),
[gsplat license](https://github.com/nerfstudio-project/gsplat/blob/main/LICENSE).
The gsplat COLMAP trainer follows the original training logic with lower memory
use:
[official COLMAP example](https://docs.gsplat.studio/main/examples/colmap.html),
[official evaluation](https://docs.gsplat.studio/main/tests/eval.html).
Nerfstudio exports trained splats as PLY:
[official export documentation](https://docs.nerf.studio/nerfology/methods/splat.html#exporting-splats).

The LingBot-assisted route is worth pursuing only after the baseline. LingBot's
predicted matrices are valuable, but camera convention must not be guessed:
Nerfstudio uses OpenGL/Blender camera axes while COLMAP/OpenCV flips Y and Z:
[Nerfstudio conventions](https://docs.nerf.studio/quickstart/data_conventions.html).
Its custom format permits per-frame intrinsics and camera-to-world matrices, but
non-COLMAP datasets do not automatically initialize Gaussians from arbitrary
point clouds. We would need either a valid COLMAP sparse model or a small custom
dataparser/initializer.

## 5. Spark delivery contract

Once a real trainer returns a valid Gaussian:

1. retain its Gaussian PLY as the portable master;
2. optionally create SOG or SPZ with PlayCanvas SplatTransform, which reads PLY
   and writes PLY/SOG/SPZ under MIT:
   [official SplatTransform documentation](https://developer.playcanvas.com/user-manual/splat-transform/);
3. build paged RAD for production delivery with Spark's `build-lod`; it accepts
   PLY, SPZ, SPLAT, KSPLAT, SOG, and ZIP:
   [Spark LoD documentation](https://sparkjs.dev/docs/lod-getting-started/);
4. load PLY/SPZ/SOG/RAD directly in Spark for the browser smoke:
   [Spark format documentation](https://sparkjs.dev/docs/loading-splats/).

Keep PLY as the master because SPZ/SOG/RAD are delivery encodings, not
reconstruction algorithms.

## 6. Recommended staged Loop experiment

### Stage A — fastest truth check

1. Fetch the pinned 237 Loop PNGs from the LingBot repository.
2. On a Windows NVIDIA machine, run MipMap Desktop Free in local coordinates and
   export both Gaussian PLY and SOG.
3. Inspect the PLY fields and distribution. Opacity, three scales, four
   rotations, and Gaussian colour/SH must be finite; scales/rotations/opacities
   should reflect learned variation rather than our current constants.
4. Load PLY and SOG directly in Spark, build RAD, publish an internal release,
   and capture fixed viewpoints.
5. Compare it with the current fixed-20-mm release and with held-out source
   frames. Record registration coverage, render quality, processing time, peak
   VRAM, output size, and license/version provenance.

This pilot needs no Engine contract and stays within the 500-image free limit.
It tells us whether MipMap can produce a materially better Loop scene before we
design backend integration.

### Stage B — open baseline on Modal

1. Process the same 237 frames with COLMAP/`ns-process-data`.
2. Train gsplat or Splatfacto on an A10 24 GB worker.
3. Export Gaussian PLY, validate, convert to RAD, and publish the same fixed
   viewpoints.
4. Compare quality, registration rate, wall time, GPU cost, and artifacts
   against Stage A.

### Stage C — prove whether LingBot adds value

1. Export LingBot's full-resolution per-frame depth, c2w pose, intrinsic matrix,
   confidence, and frame preprocessing metadata—not only the sampled one-million
   point PLY.
2. Convert those cameras to a Nerfstudio/COLMAP-compatible dataset.
3. Before training, reproject LingBot points into their source frames and report
   pixel residuals, invalid depths, and pose-loop closure. Reject the lane if
   conventions or drift cannot be reconciled.
4. Train with LingBot geometry as initialization and optionally enable bounded
   camera refinement.
5. Accept the LingBot-assisted lane only if it improves time/cost without losing
   held-out view quality against Stage B.

## Acceptance boundary

The technical gap is closed only when the platform receives a photometrically
optimized Gaussian master with per-Gaussian learned appearance, opacity, scale,
and rotation, and the same artifact passes Spark/RAD browser QA. A PLY that
merely adds constant Gaussian fields to LingBot RGB points remains a compatibility
preview and must continue to be labelled as such.
