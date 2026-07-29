# LingBot Map platform import

LingBot Map's examples emit an ordinary coloured point cloud, not a trained
Gaussian-splat model. Spatial Studio intentionally rejects that PLY as a
Gaussian source because it does not contain opacity, scale, rotation, or
spherical-harmonic properties.

The repository provides a narrow conversion step for previewing that point
cloud in the Gaussian viewer:

```sh
npm run lingbot:gaussian -- \
  --source /absolute/path/to/pointcloud.ply \
  --output /absolute/path/to/lingbot-loop.gaussian.ply
```

The converter:

- preserves all source points and RGB values;
- rotates `(x, y, z)` to `(x, -y, -z)` for the platform's Y-up convention;
- encodes RGB as degree-0 spherical harmonics;
- assigns a constant 8 mm isotropic scale and 0.9 alpha;
- writes identity rotations; and
- emits a SHA-256 provenance manifest next to the output.

The default scale is 8 mm. The full `loop` example was previewed at 8 mm and
20 mm; 20 mm was selected for platform upload because it remains legible when
the viewer initially frames the full roughly 11-metre scene:

```sh
npm run lingbot:gaussian -- \
  --source /absolute/path/to/pointcloud.ply \
  --output /absolute/path/to/lingbot-loop.gaussian.ply \
  --scale-meters 0.02
```

This result is a surfel-like, degree-0 Gaussian visualization derived from the
LingBot point cloud. It must not be described as a learned Gaussian
reconstruction produced by LingBot Map.
