# EyefulTower playroom Gaussian-splat verification

Verified on 2026-07-30 (Asia/Kuala_Lumpur).

## Outcome

The Meta EyefulTower `playroom_small` example was reconstructed as a real
3D Gaussian splat, converted to Spark RAD, uploaded to Spatial Studio,
privacy-scanned, approved, and published as an unlisted release:

- Release: https://spatial.whymelabs.com/s/eyefultower-playroom-splatfacto
- Release ID: `2cdf5805-2de6-4ef3-b886-c0d378ec4df3`
- Project ID: `716ed711-7e0a-4b1d-97ae-6a17daea8aaa`
- Published version ID: `727611d7-4629-4009-b343-b79016694fb5`
- Published RAD asset ID: `6c911408-1ff1-4c1f-b7ff-fcea5174cca6`
- Production deployment version: `cd4d08a1-62db-49dc-b4e8-98324c840bfd`

## Source and reconstruction

- Dataset: Meta EyefulTower `playroom_small`
- Source: https://github.com/facebookresearch/EyefulTower
- License: MIT
- Input: 126 downsampled images with the supplied COLMAP reconstruction
- Method: Nerfstudio `1.1.5` Splatfacto
- Training: 7,000 iterations on a Modal A10G
- Training and export elapsed time: 153.988 seconds
- Modal workspace: `wmhy-tech`
- Modal training run: https://modal.com/apps/wmhy-tech/main/ap-YFMESHIfIeGEYvIzEgAB7o
- Modal camera-inspection run: https://modal.com/apps/wmhy-tech/main/ap-3uCFnHLluMwzS0PjbNmA2m

## Generated artifacts

| Artifact | Size | Integrity / shape |
| --- | ---: | --- |
| `playroom-small.splatfacto.ply` | 96,033,889 bytes | SHA-256 `e19d0991d9fcb9217ca5eb916b2fb4b543e594d3b883c3c67a8792393417e8fa`; 387,227 Gaussians; SH degree 3 |
| Local `playroom-small.splatfacto-lod.rad` | 23.0 MiB | SHA-256 `930abfb8c6e3fb61cb37214e0faef1dfe3036364724a6b8da61796599e6c6d91` |
| Published processor RAD | 23,933,824 bytes | Manifest SHA-256 `88e377a15874055cb2649b78cbb772d861a80051e949d519f692cd04d8dabfc1` |
| Camera-aware poster | 640 × 360 PNG | Recognizable indoor room from the authored training camera |

The learned PLY fields were finite and varying. The result is not the earlier
LingBot loop visualization: it contains learned Gaussian position, scale,
rotation, opacity, colour, and spherical-harmonic fields.

## Authored initial camera

Generic outside-in auto-framing produced a misleading blob for this indoor
capture. The published release therefore records the verified camera:

```json
{
  "position": [-0.29866090416908264, 0.7125909328460693, -0.9430274963378906],
  "target": [-1.2933079898357391, 0.6117688491940498, -0.965648453682661],
  "up": [-0.022745374590158463, 0.00008449354209005833, 0.9997411370277405],
  "fovDegrees": 100
}
```

The API, Studio form, and poster processor reject zero-length, parallel-up,
out-of-bounds, and otherwise degenerate camera configurations. Processor QA
reports now record whether rendering used auto-framing or the normalized
authored camera.

## Platform evidence

- Version 1 direct RAD integrity validation succeeded in 3.5 seconds.
- Version 2 PLY processing succeeded in 48.4 seconds and emitted verified RAD,
  poster PNG, and QA JSON derivatives.
- Privacy scan completed with 0 candidates across 1 frame.
- Version 2 received visual grade B, `visual-only` measurement grade, and
  privacy approval before publication.
- The public manifest returns the exact initial camera and active unlisted
  release metadata.
- Production browser QA reached `Spark 2.1.0 ready` at the authored indoor
  view. No page-origin console errors were present.
- Screenshot:
  `output/playwright/eyefultower-production-release.png`

## Software verification

- `vitest test/processor.spec.ts`: 17 passed
- Targeted end-to-end immutable RAD publish test: 1 passed, 25 skipped
- TypeScript no-emit check: passed
- Production Vite build: passed
- Production deployment was built from clean commit `83eb69a`; unrelated local
  workspace changes were excluded.

## Limitations

This is a 7,000-iteration visual experiment intended to close the image-to-splat
pipeline gap. It is not a survey, metric deliverable, construction record, or
best-possible Splatfacto convergence run.
