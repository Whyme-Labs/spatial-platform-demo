# Gaussian reconstruction options for Spatial Studio

Research date: 2026-07-29
Scope: a production-capable image sequence → Gaussian PLY → Spark RAD pipeline,
with the 237-frame LingBot Loop capture as the first benchmark.

## Decision

Use **COLMAP → Nerfstudio Splatfacto/gsplat → Gaussian PLY → Spark RAD** as the
owned production baseline.

Keep **LingBot Map** as an optional geometry lane for long or streaming captures,
not as the Gaussian generator. Test **AnySplat** as a fast R&D challenger and
**Brush** as a permissively licensed trainer challenger. Use **MipMap** only as a
commercial quality benchmark until its Engine licensing, unattended operation,
output schema, and Modal compatibility are proven.

## Is MipMap open source?

No official open-source implementation was found. The official products are:

- MipMap Desktop, distributed under a revocable, non-transferable subscription
  license that prohibits source extraction, modification, and redistribution;
  the vendor retains all software IP while the user owns generated models:
  [subscription agreement](https://na.mipmap3d.com/legal_agreements/EN/subscribe_agreement.html).
- MipMap Engine, a license-keyed CLI delivered as a vendor Docker image on
  Linux. The documented command invokes a compiled `reconstruct_full_engine`
  binary and requires the vendor configuration for license access:
  [Linux deployment](https://docs.mipmap3d.com/engine/en/overview/linux-deployment).

Engine is automated and does generate real Gaussian PLY, SOG, and tiled SOG
directly from images or video, including pose solving:
[full-pipeline API](https://docs.mipmap3d.com/engine/en/basic/reconstruct-full).
That makes it technically relevant, but proprietary—not an implementation we
can own or freely deploy.

## Practical comparison

| Option | Inputs and poses | True 3DGS output | License / product fit | Automation and compute | Loop and Spark fit | Main risk |
|---|---|---|---|---|---|---|
| **COLMAP + Nerfstudio Splatfacto/gsplat** | Original overlapping images. COLMAP solves intrinsics, poses, and sparse geometry. | Yes. Splatfacto trains learned position, scale, rotation, opacity, and appearance and exports Gaussian PLY. | COLMAP is new-BSD; Nerfstudio and gsplat are Apache-2.0. Best licensing fit for an owned commercial service. [COLMAP](https://github.com/colmap/colmap), [Splatfacto](https://docs.nerf.studio/nerfology/methods/splat.html), [gsplat](https://github.com/nerfstudio-project/gsplat) | Mature CLIs and Python/CUDA stack; natural fit for a Modal GPU image. Splatfacto documents about 6 GB for default and 12 GB for `splatfacto-big`, before pipeline overhead. | Strongest baseline for 237 overlapping frames. Native Gaussian PLY feeds Spark directly and can be converted to RAD. | COLMAP registration can fail on blur, low texture, moving content, or weak overlap; requires capture QA and retry policy. |
| **Brush** | Existing COLMAP or Nerfstudio dataset. It does not replace pose solving. | Yes; it is a native Gaussian reconstruction trainer. | Apache-2.0; the cleanest alternate trainer license. [official repository](https://github.com/ArthurBrussee/brush) | CLI; Linux/macOS/Windows and broad WebGPU hardware support. Simple Rust binaries avoid a large CUDA/Python runtime. | Plausible second trainer on the same COLMAP result. PLY tooling exists, but its exact training-export schema should pass our validator before adoption. | Younger production surface than Nerfstudio/gsplat; Modal WebGPU/device behavior and quality settings need measurement. |
| **OpenSplat** | Requires camera poses **and sparse points** in COLMAP, OpenSfM, OpenMVG, ODM, or Nerfstudio format. | Yes; produces `splat.ply` or `.splat`. | AGPLv3. Commercial use is possible, but network-service and modification/source obligations require product/legal review. [official repository](https://github.com/pierotofy/OpenSplat) | Headless C++ CLI and Docker; CUDA, ROCm, Metal, or CPU, although CPU is documented as about 100× slower. | Direct PLY compatibility. Its own notes estimate about 2 GB VRAM per million Gaussians. | Copyleft fit; project still lists memory, filtering, distributed compute, and other production features as goals. |
| **LichtFeld Studio** | COLMAP dataset; does not replace registration. | Yes. Trains, edits, and exports PLY/SOG/SPZ. | GPLv3. Better as a separate internal inspection/editing tool than a linked product dependency without legal review. [official repository](https://github.com/MrNeRF/LichtFeld-Studio) | Has a headless workflow, config/CLI, plugins, and automation; current stack targets NVIDIA and CUDA 12.8+, with Windows as the primary binary target. | Excellent manual QA/edit/export companion; all documented exports are Spark-readable. | GPL integration boundary, source-build complexity, and workstation-first scope. |
| **MipMap Desktop / Engine** | Images or video; automatically performs metadata extraction, aerial triangulation, and reconstruction. Poses are not required. | Yes; official outputs include GS PLY/SOG/tiled SOG. | Proprietary subscription/SDK; backend use needs an Engine commercial agreement. | Engine is a license-keyed CLI. Linux runs only in the vendor Docker image; NVIDIA GPU is required and GS needs compute capability 7.0+. | 237 frames are a small practical pilot. PLY/SOG should load in Spark, but schema, orientation, SH, and RAD conversion must be tested. | Vendor/license dependency, undocumented Gaussian schema, online license behavior, and unproven operation inside Modal. |
| **AnySplat** | Uncalibrated images; predicts poses and Gaussians in one forward pass, with optional post-optimization. | Yes; it predicts Gaussian position, opacity, rotation, scale, and colour. | Code **and checkpoint** are MIT, making it genuinely usable commercially. [official repository](https://github.com/InternRobotics/AnySplat), [official model card](https://huggingface.co/lhjiang/anysplat) | Python/PyTorch/CUDA 12.1 reference; 1B-parameter checkpoint, input processed to 448×448. Programmatic inference exists. | Valuable fast candidate, but official results top out at 64-view examples; the documented demo renders video rather than exporting a standard PLY. Start with 16/32/64-frame subsets and add an explicit PLY exporter/validator. | New codebase, uncertain 237-view memory/quality, lower resolution, and no documented portable export contract. |
| **VGGT / VGGT-1B-Commercial** | Uncalibrated images; predicts cameras, depth, points, and tracks and can export a COLMAP sparse model, optionally with bundle adjustment. | **No.** It supplies geometry to a later trainer. | Code has a custom license; only the separately gated `VGGT-1B-Commercial` checkpoint permits commercial use, subject to its acceptable-use license. [official repository](https://github.com/facebookresearch/vggt), [commercial checkpoint license](https://huggingface.co/facebook/VGGT-1B-Commercial/blob/main/LICENSE) | Python/CUDA, 1B parameters. Official tooling supports one to hundreds of views and COLMAP export. | A credible learned registration fallback or COLMAP initializer. It still needs gsplat/Splatfacto to produce the deliverable. | Custom model license, transformer memory scaling, and less explicit long-stream handling than LingBot. |
| **LingBot Map** | Uncalibrated image folder or video; predicts pose, depth, confidence, and world points. | **No.** Its published renderer and outputs are point clouds, not optimized Gaussians. | Apache-2.0; commercially friendly. [official repository](https://github.com/Robbyant/lingbot-map) | Headless Python/CUDA inference; streaming/windowed modes and reported support for sequences beyond 10,000 frames. | Relevant for fast trajectory/geometry and unusually long sequences. Its outputs could be converted to a validated COLMAP/Nerfstudio initializer, but still require photometric 3DGS training. | Custom camera-convention/preprocessing bridge, pose drift, no direct sparse-track bundle, and no proven quality gain over COLMAP for this 237-frame scene. |

Spark already loads Gaussian PLY, SPZ, SOG, and RAD, and its `build-lod` CLI
converts PLY to streamable RAD:
[loading formats](https://sparkjs.dev/docs/loading-splats/),
[RAD build workflow](https://sparkjs.dev/docs/lod-getting-started/).
Therefore PLY should remain the reconstruction master and RAD the delivery
artifact.

## Methods not selected for production

- **InstantSplat** is aimed at sparse views, not this dense 237-frame loop. Its
  own TODO still lists long-sequence cross-window alignment; although the main
  code license is Apache-2.0, its license explicitly says the required DUSt3R
  dependency is CC BY-NC-SA and prohibits commercial use:
  [official repository](https://github.com/NVlabs/InstantSplat),
  [official license](https://github.com/NVlabs/InstantSplat/blob/main/LICENSE).
- **Splatt3R** generates real Gaussian PLY from uncalibrated image **pairs**, but
  the official code is CC BY-NC 4.0 and is not a product dependency:
  [official repository and license](https://github.com/btsmart/splatt3r).
- The original GraphDeco implementation remains a useful academic reference,
  but its research/non-commercial license is inferior to the Apache-2.0 gsplat
  reimplementation for this product.

## Is LingBot still relevant?

Yes, but in a narrower role than originally assumed:

1. **Keep it** for fast streaming geometry, long captures, loop-closure
   experiments, confidence maps, and a registration fallback.
2. **Do not put it on the critical path** for the 237-frame Loop production
   baseline. COLMAP already produces exactly the calibrated sparse dataset that
   Splatfacto/gsplat expects.
3. **Only adopt LingBot-assisted training** if a controlled experiment proves
   it improves registration rate, elapsed time, GPU cost, or held-out render
   quality. Apache licensing alone is not enough reason to carry the extra
   camera and point-initialization bridge.

For this capture, AnySplat is the more relevant feed-forward *Gaussian*
experiment; VGGT is the more standardized learned *geometry* alternative
because it exports COLMAP. LingBot's clearer advantage appears when sequences
become long enough that batch transformers or conventional registration become
the bottleneck.

## Phased Loop experiment

### Phase 1 — establish the owned baseline

1. Use the original 237 Loop frames, not the converted LingBot point cloud.
2. Run COLMAP with sequential matching, then reject the result unless at least
   90% of frames register and reprojection/trajectory inspection shows a
   coherent closed loop.
3. Train Splatfacto on the current Modal A10 24 GB worker; export Gaussian PLY.
4. Validate finite position, opacity, three learned scales, four-component
   rotation, and colour/SH; confirm these fields are not constants.
5. Load PLY directly in Spark, build quality RAD, publish fixed viewpoints, and
   record registration rate, wall time, peak VRAM, Gaussian count, PLY/RAD size,
   and held-out image metrics.

### Phase 2 — compare useful challengers

- Train **Brush** from the exact same COLMAP dataset.
- Run **AnySplat** on deterministic 16-, 32-, and 64-frame subsets. Only try all
  237 after measuring memory and confirming a standards-compliant PLY export.
- Run **MipMap Desktop** on all 237 frames as an external quality ceiling; move
  to Engine only if output wins materially and commercial/Modal constraints are
  acceptable.

### Phase 3 — decide whether LingBot earns a place

Export full LingBot cameras, intrinsics, depth, confidence, and geometry; convert
them into a validated COLMAP model; reproject points into source frames; then
train the same gsplat configuration. Keep the lane only if it beats the Phase 1
baseline on a predeclared target such as:

- materially higher registered-frame coverage;
- at least 25% lower end-to-end GPU time/cost at equivalent held-out quality; or
- better loop closure without increased render artifacts.

The technical gap is closed only when a photometrically optimized Gaussian PLY,
not a point cloud with invented Gaussian fields, passes Spark and RAD browser
QA.
