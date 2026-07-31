# Spark 2.1.0 SOG `build-lod` crash investigation

Research date: 2026-07-31

## Conclusion

The Bellevue SOG is valid. The crash is a **known Spark `build-lod` 2.1.0
bug triggered by an incorrect argument from our processor**:

1. The Bellevue `meta.json` has no optional `shN` section, so it correctly
   contains **0 higher-order spherical-harmonic bands**.
2. Spatial Studio's pre-fix
   `sparkMaximumSphericalHarmonicDegree("sog")` defaulted an undetected SOG
   degree to **3**.
3. Spark 2.1.0's `--max-sh=3` implementation raises its internal degree from
   0 to 3 without allocating SH arrays. The first LoD merge then indexes empty
   `sh1` storage and panics.
4. Spark fixed this exact defect in
   [issue #352](https://github.com/sparkjsdev/spark/issues/352) and
   [PR #359](https://github.com/sparkjsdev/spark/pull/359), merged as
   [`63c6d6a`](https://github.com/sparkjsdev/spark/commit/63c6d6a13d7eb5794a3208233ef8352c588321f1)
   on 2026-06-04. Our pinned `v2.1.0` commit
   [`f22236f`](https://github.com/sparkjsdev/spark/commit/f22236f95fdd8078f0c12e3aab479523d401daf6)
   predates that fix.

This is therefore **not a malformed-asset failure**. It is both an upstream
robustness bug in the pinned Spark release and an application-side SH-degree
selection bug. Either side can prevent the panic; production should correct
both.

## Exact reproduction

Pinned tool:

| Property | Value |
|---|---|
| Spark tag | `v2.1.0` |
| Spark commit | `f22236f95fdd8078f0c12e3aab479523d401daf6` |
| Local binary SHA-256 | `230d50f18fed37a0adcc8a430c52aa61b555e8fe37e979a411f6c985c1a3db3e` |
| Input SHA-256 | `916de7e72b9f09870e063d9a0d335da387b447c7c2c3a630d460a560c58b2922` |
| Input size | 54,803,033 bytes |

The failing command is deterministic and completes in about three seconds:

```bash
RUST_BACKTRACE=full .tools/bin/spark-build-lod \
  --quality --max-sh=3 --rad \
  .cache/supersplat-bellevue-sog/bellevue-home.sog
```

Observed terminal signal:

```text
Detected file type: SOGS
Read: num_splats: 4944177 with sh_degree: 0
bhatt_lod::compute_lod_tree: initial_len=4944177
Sorted and prepared splats
Level: -9, step: 0.001953125, frontier: 1 / 4944177, # active: 1, # splats: 4944177
Level: -8, step: 0.00390625, frontier: 19135 / 4944177, # active: 19135, # splats: 4944177

thread 'main' panicked at spark-lib/src/gsplat.rs:414:36:
index out of bounds: the len is 0 but the index is 0
```

Exit code: `101`. The full backtrace enters
`GsplatArray::new_merged`, then `build_lod::process_file_lod_tsplat`.

The prior failed processor attempt reported the same source location and exit
code, so this reproduces the production symptom rather than a nearby error.

## Differential result

Changing only the requested maximum SH degree makes the same input succeed:

```bash
.tools/bin/spark-build-lod \
  --quality --max-sh=0 --rad \
  .cache/supersplat-bellevue-sog/bellevue-home.sog
```

Observed result:

```text
Read: num_splats: 4944177 with sh_degree: 0
...
final_splat_count: 7016915
input_sh_degree: 0
max_sh_degree: 0
Wrote bellevue-home-lod.rad
```

The generated RAD was 132,428,720 bytes. This proves the SOG decoder and LoD
builder can process this asset when the argument respects its actual degree.

A second control used AWS's 192,191-Gaussian `laundry-room.sog`, whose metadata
declares `shN.bands = 3`. The same pinned binary completed
`--quality --max-sh=3 --rad` successfully and wrote a 256,183-splat RAD. The
failure is therefore tied to requesting nonexistent SH bands, not SOG size,
ZIP packaging, or all SOG inputs.

## Asset validity

The Bellevue archive passed `unzip -t` with no errors. It contains exactly the
six files referenced by `meta.json`:

- `meta.json`
- `means_l.webp`
- `means_u.webp`
- `scales.webp`
- `quats.webp`
- `sh0.webp`

All five WebP textures decode as 2224 x 2224 images, providing 4,946,176
texels for the declared 4,944,177 Gaussians. The absence of `shN` is valid:
the official SOG v2 proposal defines `shN_centroids` and `shN_labels` as
optional. See the
[PlayCanvas SOG v2 proposal](https://github.com/playcanvas/splat-transform/issues/38).

The official PlayCanvas decoder also treats absent `shN` as zero bands. In
the pinned `@playcanvas/splat-transform` v3.1.7 source,
[`MetaV2.shN` is optional](https://github.com/playcanvas/splat-transform/blob/33d2dd8e27816c7cc4a8da7c88afdc5d90063e8e/src/lib/readers/read-sog.ts#L26-L34)
and the metadata reader uses
[`meta.shN?.bands ?? 0`](https://github.com/playcanvas/splat-transform/blob/33d2dd8e27816c7cc4a8da7c88afdc5d90063e8e/src/lib/readers/read-sog.ts#L315-L329).

Running that official decoder against the stored asset confirms:

```bash
npx splat-transform \
  .cache/supersplat-bellevue-sog/bellevue-home.sog \
  --info=json null
```

```json
{
  "format": "sog",
  "gaussian": true,
  "numGaussians": 4944177,
  "numLods": 1,
  "lodCounts": [4944177],
  "shBands": 0,
  "layers": ["position", "geometric", "color"],
  "extraColumns": []
}
```

## Failure mechanism in Spark 2.1.0

The pinned Spark source is internally inconsistent when the CLI cap is above
the source degree:

1. The SOG decoder correctly computes degree 0 when `shN` is absent and
   initializes empty SH vectors:
   [`sogs.rs` lines 182-212](https://github.com/sparkjsdev/spark/blob/f22236f95fdd8078f0c12e3aab479523d401daf6/rust/spark-lib/src/sogs.rs#L182-L212).
2. `build-lod` then passes the requested `--max-sh` directly to
   `set_max_sh_degree`:
   [`main.rs` lines 161-163](https://github.com/sparkjsdev/spark/blob/f22236f95fdd8078f0c12e3aab479523d401daf6/rust/build-lod/src/main.rs#L161-L163).
3. `set_max_sh_degree` assigns the higher value but only implements clearing
   arrays when lowering it; it cannot create missing coefficients:
   [`gsplat.rs` lines 256-269](https://github.com/sparkjsdev/spark/blob/f22236f95fdd8078f0c12e3aab479523d401daf6/rust/spark-lib/src/gsplat.rs#L256-L269).
4. The LoD merge sees degree >= 1 and unconditionally indexes `self.sh1`:
   [`gsplat.rs` lines 410-420](https://github.com/sparkjsdev/spark/blob/f22236f95fdd8078f0c12e3aab479523d401daf6/rust/spark-lib/src/gsplat.rs#L410-L420).

Upstream PR #359 renamed the setter to `clamp_sh_degree`, clamps the requested
degree to the source's existing degree, and records the effective degree in
the RAD metadata. The issue and merged patch describe this exact failure and
workaround; it is not merely a similar crash.

## Spatial Studio contribution

Before this correction, the helper returned:

```json
{"sog":3,"splat":0,"ply":3}
```

because the old implementation of
[`sparkMaximumSphericalHarmonicDegree`](../../scripts/processing-agent-core.mjs)
special-cases only `.splat`, accepts a detected PLY degree, and otherwise
defaulted to 3. The old SOG archive validator verified structure and
`meta.json` references but did not return `meta.shN?.bands`. Consequently the
old SOG-to-RAD job invoked the affected Spark build with `--max-sh=3`.

The published Spark renderer can load SOG directly and therefore bypasses
`build-lod`; that browser path does not hit this CLI panic. The failure was in
the optional SOG-to-RAD conversion path.

## Correction status

The application-side layer is implemented in this change:

- `validateSogArchive` returns `meta.shN?.bands ?? 0` after checking that the
  value is an integer from 0 through 3;
- `validateSource` passes that detected value to the builder; and
- undetected SOG inputs default safely to degree 0 rather than inventing
  missing coefficients.

The remaining upstream hardening is:

1. **Upstream fix:** replace the pinned `v2.1.0` builder with the official
   fixed commit `63c6d6a13d7eb5794a3208233ef8352c588321f1` or a later tagged Spark
   release containing PR #359. As of this investigation, the official remote
   exposes `v2.0.0` and `v2.1.0`; no later `v2` tag was present.
2. **Binary regression gate:** when the builder is upgraded, run a degree-0
   SOG through the real `build-lod` binary
   while requesting a cap of 3. A fixed upstream builder should clamp and
   complete. The processor helper already has unit coverage for detected SH0
   and SH3 SOG metadata.
3. **Visual acceptance remains separate:** a non-crashing RAD conversion does
   not prove equivalent image quality. Compare the converted RAD and original
   SOG from the same authored camera before changing the published renderer.

The crash itself is not a reason to abandon Spark or this asset. It is a
versioned CLI defect with a deterministic workaround and an upstream fix.

## Primary sources

- [Spark issue #352: exact SOG `--max-sh` panic](https://github.com/sparkjsdev/spark/issues/352)
- [Spark PR #359: merged clamp fix](https://github.com/sparkjsdev/spark/pull/359)
- [Spark fix commit `63c6d6a`](https://github.com/sparkjsdev/spark/commit/63c6d6a13d7eb5794a3208233ef8352c588321f1)
- [Spark v2.1.0 pinned commit `f22236f`](https://github.com/sparkjsdev/spark/commit/f22236f95fdd8078f0c12e3aab479523d401daf6)
- [PlayCanvas SOG v2 proposal](https://github.com/playcanvas/splat-transform/issues/38)
- [PlayCanvas v3.1.7 SOG decoder](https://github.com/playcanvas/splat-transform/blob/33d2dd8e27816c7cc4a8da7c88afdc5d90063e8e/src/lib/readers/read-sog.ts)
