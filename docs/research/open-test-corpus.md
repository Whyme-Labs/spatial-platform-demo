# Open, pinned test corpus for spatial ingestion and processing

Date: 2026-07-28

## Decision

Use a small, source-pinned corpus from AWS, PDAL, OpenSfM, Khronos, and
OpenDroneMap-linked datasets. Keep the upstream bytes in a download-on-demand
fixture cache rather than committing large binaries to this repository.

The recommended corpus is:

- AWS Laundry Room SOG as the compact indoor Gaussian scene.
- A deterministic Gaussian PLY derived from that SOG for the strict Gaussian
  header and Spark-to-RAD path.
- AWS Bench Melbourne SPZ as a large legacy-SPZ compatibility fixture.
- PDAL fixtures for ordinary PLY, LAS, LAZ, and E57.
- OpenSfM Berlin for real images plus camera-pose JSON.
- AWS Bench Melbourne MOV for source-video ingestion.
- A two-image, CC0 Aukerman bundle for drone-image ZIP ingestion.
- Khronos Box GLB for collision-mesh ingestion.
- Deterministic mutations of those bytes for malformed, checksum, multipart,
  and size-limit failures.

Every adopted upstream URL is immutable at a commit SHA and has an explicit
redistribution licence. External showcase scenes whose asset rights are not
explicit are excluded even when the viewer or repository code is open source.

## Application lanes this corpus must cover

The application's current import contract distinguishes source evidence from
renderable Gaussian masters:

- `gaussian_splat` accepts PLY, SPZ, SOG, SPLAT, KSPLAT, and ZIP and queues
  `asset.validate`.
- `web_scene` accepts RAD and queues bounded evidence validation.
- `source_images`, `source_video`, `camera_poses`, `calibration`, IMU, GNSS,
  metric point clouds, and collision meshes queue `asset.evidence-validate`.
- Metric point clouds accept PLY, E57, LAS, LAZ, or PTS.
- Collision meshes accept GLB, glTF, OBJ, or PLY.

See
[`src/shared/capture-adapters.ts`](../../src/shared/capture-adapters.ts),
especially its purpose/format matrix and import plan.

The processor has materially different gates:

- A Gaussian PLY must have `x/y/z`, DC colour, opacity, three scales, and four
  rotations. An ordinary point-cloud PLY is deliberately rejected as
  `INVALID_GAUSSIAN_PLY`.
- SPZ receives a bounded container preflight. Legacy gzip-framed SPZ is sent
  directly to Spark; NGSP v4 is normalized before Spark.
- Evidence formats receive bounded identity checks only: `ASTM-E57`, `LASF`,
  `RAD0`, PKZIP, JPEG/PNG/WebP, ISO-BMFF/EBML, `glTF`, PLY, or valid JSON.
  These checks do not establish semantic correctness, calibration, accuracy,
  or scanner provenance.
- The processor recomputes the downloaded byte count and SHA-256 before any
  decoder work.

See
[`scripts/processing-agent-core.mjs`](../../scripts/processing-agent-core.mjs)
and
[`scripts/processing-agent.mjs`](../../scripts/processing-agent.mjs).

## Adopted upstream fixtures

### Gaussian and source-media fixtures from AWS

Upstream:
[AWS Guidance for Open Source 3D Reconstruction Toolbox for Gaussian Splats](https://github.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/tree/73133959c04fb0f9f002e95b4d2a722de2d18722)

Pinned commit: `73133959c04fb0f9f002e95b4d2a722de2d18722`

Licence:
[MIT-0](https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/73133959c04fb0f9f002e95b4d2a722de2d18722/LICENSE)

| Fixture | Pinned download | Bytes | SHA-256 | Application lane | Tier |
|---|---|---:|---|---|---|
| Laundry Room SOG | [laundry room.sog](https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/73133959c04fb0f9f002e95b4d2a722de2d18722/source/Gradio/favorites/laundry%20room.sog) | 4,665,840 | `6bf14664068a3f59a651effb6055db36d8d4439423cde8ddf7c6ce0a2510e0b3` | `open-import` + `gaussian_splat/sog`; indoor renderer and decoder integration | Required integration |
| Bench Melbourne SPZ | [benchmelb.spz](https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/73133959c04fb0f9f002e95b4d2a722de2d18722/source/Gradio/favorites/benchmelb.spz) | 18,734,824 | `5245e1f427c4d10a40e7f35d8568cc0457100ad0b176fd487a74321c4984ddcb` | `open-import` + `gaussian_splat/spz`; legacy gzip SPZ preflight and Spark decoder | Nightly/evaluation |
| Bench Melbourne MOV | [BenchMelb.mov](https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/73133959c04fb0f9f002e95b4d2a722de2d18722/assets/input/BenchMelb.mov) | 93,091,034 | `77bcb6952ce19ca874026acb3ffd908f12030c3b1fdc683a7ddf104140035603` | `phone-video` + `source_video/mov`; ISO-BMFF evidence identity and large multipart transfer | Download-on-demand |

The SPZ begins with gzip bytes `1f 8b`; it is therefore a direct positive
fixture for the processor's legacy-SPZ branch. It contains about 951,891
splats and is intentionally not a fast CI fixture. A local quality-LoD run
read it successfully but remained compute-heavy after two minutes.

The Laundry Room SOG is the primary human-visible indoor scene. Its SOG v2
archive contains 192,191 splats with three spherical-harmonic bands. It is
small enough for browser and processor integration runs without weakening the
test to a synthetic cube.

### Metric point-cloud fixtures from PDAL

Upstream:
[PDAL](https://github.com/PDAL/PDAL/tree/a4c50af9a845cbf50fe690fe2dbd3181ce127dc4)

Pinned commit: `a4c50af9a845cbf50fe690fe2dbd3181ce127dc4`

Licence:
[PDAL BSD licence](https://raw.githubusercontent.com/PDAL/PDAL/a4c50af9a845cbf50fe690fe2dbd3181ce127dc4/LICENSE.txt).
The licence says it covers all files in the distribution unless otherwise
indicated.

| Fixture | Pinned download | Bytes | SHA-256 | Application lane | Tier |
|---|---|---:|---|---|---|
| Ordinary point-cloud PLY | [issue_2421.ply](https://raw.githubusercontent.com/PDAL/PDAL/a4c50af9a845cbf50fe690fe2dbd3181ce127dc4/test/data/ply/issue_2421.ply) | 197 | `86b4bbabc6291788b0d8d3d6ef9dbcbc0a8a60caa29c69876d75ae3d8e74c775` | Positive `metric_point_cloud/ply`; negative `gaussian_splat/ply` | Unit/integration |
| LAS | [simple.las](https://raw.githubusercontent.com/PDAL/PDAL/a4c50af9a845cbf50fe690fe2dbd3181ce127dc4/test/data/las/simple.las) | 36,437 | `a0570ef57b685b77a6d3e3992cbdfeecdb2c3065d3780bbeaba490818258b734` | `metric_point_cloud/las`; `LASF` bounded identity | Unit/integration |
| LAZ | [simple.laz](https://raw.githubusercontent.com/PDAL/PDAL/a4c50af9a845cbf50fe690fe2dbd3181ce127dc4/test/data/laz/simple.laz) | 18,217 | `ad3c65e06e9093b05b3181ee14ffb864a73a22363cb4fa9b7b8021e4d86cfb9d` | `metric_point_cloud/laz`; `LASF` bounded identity | Unit/integration |
| E57 | [A4.e57](https://raw.githubusercontent.com/PDAL/PDAL/a4c50af9a845cbf50fe690fe2dbd3181ce127dc4/test/data/e57/A4.e57) | 4,096 | `47b17e6a666de2b101a5837be96992d0b1304b0eb30148ab936c3110ad8a8b37` | `metric_point_cloud/e57`; `ASTM-E57` bounded identity | Unit/integration |
| Multi-scan E57 | [A_B.e57](https://raw.githubusercontent.com/PDAL/PDAL/a4c50af9a845cbf50fe690fe2dbd3181ce127dc4/test/data/e57/A_B.e57) | 6,144 | `59fbade75d9ad46b1dc3be996f2907564107ee8ccf7009d5f75249ea0e084a55` | Optional multi-scan E57 parser coverage | Evaluation |

PDAL's own pinned reader tests establish that the LAS/LAZ pair has 1,065
points and that `A4.e57` contains XYZ, RGB, and intensity values. The
application currently performs only bounded evidence validation on those
formats; a passing test must not be presented as full parsing or metric
validation.

The 197-byte PLY is particularly valuable. It should pass the point-cloud
evidence lane, but its use as a Gaussian master must fail because it lacks all
Gaussian colour, opacity, scale, and rotation properties. This protects the
critical product distinction between a point cloud and a Gaussian splat.

### Camera poses and source imagery from OpenSfM

Upstream:
[OpenSfM](https://github.com/mapillary/OpenSfM/tree/238744cdf3b5d50149c50d136a87f7fea25ad5cd)

Pinned commit: `238744cdf3b5d50149c50d136a87f7fea25ad5cd`

Licence:
[BSD](https://raw.githubusercontent.com/mapillary/OpenSfM/238744cdf3b5d50149c50d136a87f7fea25ad5cd/LICENSE)

OpenSfM's own
[documentation](https://github.com/mapillary/OpenSfM/blob/238744cdf3b5d50149c50d136a87f7fea25ad5cd/doc/source/using.rst)
identifies `data/berlin` as its example dataset.

| Fixture | Pinned download | Bytes | SHA-256 | Application lane | Tier |
|---|---|---:|---|---|---|
| Pose/reconstruction JSON | [reconstruction_example.json](https://raw.githubusercontent.com/mapillary/OpenSfM/238744cdf3b5d50149c50d136a87f7fea25ad5cd/data/berlin/reconstruction_example.json) | 477,360 | `7dfc2f48ffad36092e0f0b21d1e7275b8cf047a3183d874c460a52fa79469425` | `camera_poses/json`; JSON evidence and pose/image linkage | Integration |
| Berlin image 01 | [01.jpg](https://raw.githubusercontent.com/mapillary/OpenSfM/238744cdf3b5d50149c50d136a87f7fea25ad5cd/data/berlin/images/01.jpg) | 1,414,236 | `4b3fbfb5d2bda883f7e971535fb71ecb7b45c8fcda35606c6d856e1fb923ffce` | `source_images/jpg` | Integration |
| Berlin image 02 | [02.jpg](https://raw.githubusercontent.com/mapillary/OpenSfM/238744cdf3b5d50149c50d136a87f7fea25ad5cd/data/berlin/images/02.jpg) | 1,267,989 | `d21b2fd5a3b41b9f244a6317400a8e4a44609dd318213598c2e894f9ead9141a` | `source_images/jpg` | Integration |
| Berlin image 03 | [03.jpg](https://raw.githubusercontent.com/mapillary/OpenSfM/238744cdf3b5d50149c50d136a87f7fea25ad5cd/data/berlin/images/03.jpg) | 1,148,129 | `afec918e18fcf5ec6a66c5e3b2185117d3a04b583c31e8a1371f195a38b45501` | `source_images/jpg` | Integration |

This is real, compact pose-plus-image evidence: one camera, three shot poses,
1,430 sparse points, rig fields, and a geographic reference. It is outdoor
and therefore tests ingestion and relational integrity, not indoor visual
quality.

It does **not** directly exercise the application's private
`canonical_pose_json_v1` completeness calculation. That schema is an
application contract, not an upstream standard. Maintain a tiny
application-authored canonical fixture for that unit test and record OpenSfM
as its provenance only if a documented conversion is added.

### Drone imagery

Upstream:
[OpenDroneMap Aukerman data](https://github.com/OpenDroneMap/odm_data_aukerman/tree/4e8031630f4193494c79b1c1d3524108826d1ba9)

Pinned commit: `4e8031630f4193494c79b1c1d3524108826d1ba9`

Licence:
[CC0 1.0](https://raw.githubusercontent.com/OpenDroneMap/odm_data_aukerman/4e8031630f4193494c79b1c1d3524108826d1ba9/license.txt)

| Fixture | Pinned download | Bytes | SHA-256 | Application lane |
|---|---|---:|---|---|
| Aerial image 229 | [DSC00229.JPG](https://raw.githubusercontent.com/OpenDroneMap/odm_data_aukerman/4e8031630f4193494c79b1c1d3524108826d1ba9/images/DSC00229.JPG) | 7,896,834 | `8a0a0a8f78c66977657639823604fa21e715b809e3c9bcf6e7bdd61e4eda5787` | `drone-imagery` + `source_images/jpg` |
| Aerial image 230 | [DSC00230.JPG](https://raw.githubusercontent.com/OpenDroneMap/odm_data_aukerman/4e8031630f4193494c79b1c1d3524108826d1ba9/images/DSC00230.JPG) | 8,770,088 | `212482b7f4421137fc590c1cecdf9d89dc913f29594ac5421a6f4d5407bb7cb8` | `drone-imagery` + `source_images/jpg` |

The full 77-image dataset is about 543 MB, too large for ordinary CI. For the
ZIP lane, `scripts/open-corpus.mjs` builds a deterministic two-image archive
with pinned `fflate` 0.8.3, fixed entry names, and no platform file metadata.
The current output is:

- Bytes: `16,631,916`
- SHA-256:
  `d3fcfe069e82ff4b301c03ac89e44061caafd3e464dad1bfd8f3678be30b888d`

The two source-image hashes remain the canonical upstream facts. The archive
hash is a repository-derived fixture tied to the pinned implementation and
recipe.

For a smaller general ZIP fixture, the OpenDroneMap catalogue identifies the
[MIT-licensed Banana dataset](https://github.com/pierotofy/dataset_banana/tree/2778294e4a73aec8f37747e0d2edfc4cb38b23a6)
as a starter photogrammetry dataset. Its
[pinned commit archive](https://codeload.github.com/pierotofy/dataset_banana/zip/2778294e4a73aec8f37747e0d2edfc4cb38b23a6)
was observed at 15,285,669 bytes with SHA-256
`955d1b54cf70ede41e3784ef9a9e91ae5f2613a0a800797065d5c2f10b3f094c`.
It is suitable for PKZIP/image enumeration, but it is object
photogrammetry—not drone capture. GitHub can regenerate commit archives, so
validate archive contents against the pinned commit rather than treating that
archive hash as an upstream permanence guarantee.

### Collision GLB

Upstream:
[Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf)

Pinned commit: `2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf`

Asset licence:
[CC BY 4.0](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf/Models/Box/LICENSE.md)

| Fixture | Pinned download | Bytes | SHA-256 | Application lane | Tier |
|---|---|---:|---|---|---|
| Box GLB | [Box.glb](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf/Models/Box/glTF-Binary/Box.glb) | 1,664 | `ed52f7192b8311d700ac0ce80644e3852cd01537e4d62241b9acba023da3d54e` | `collision_mesh/glb`; GLB identity, storage, response headers, and scene attachment | Unit/integration |

This fixture has one mesh and one material. It validates a collision-asset
handoff but is intentionally not a navmesh-quality or indoor-layout
benchmark. Preserve the Cesium attribution required by CC BY 4.0 in the
fixture inventory and notices.

## Deterministic derived fixtures

Derived assets should be produced from adopted upstream bytes by pinned,
permissively licensed tools. They should not replace the upstream master.

### Indoor Gaussian PLY

Input: adopted AWS `laundry room.sog`.

Tool:
[`@playcanvas/splat-transform` 3.1.7](https://github.com/playcanvas/splat-transform/tree/1a0da686e4acd0270b4411b17211ae87c5b95987),
MIT licensed.

Pinned npm tarball:
[`splat-transform-3.1.7.tgz`](https://registry.npmjs.org/@playcanvas/splat-transform/-/splat-transform-3.1.7.tgz)

- Tarball bytes: `8,847,308`
- Tarball SHA-256:
  `7060f9ab89f05d7cace6c1fb98b2c7261e48331eddd983963035eee614aa6f5f`
- npm integrity:
  `sha512-iwUpiz2TFaR2tYZqoTlQTwwj4nmyupjrqdg6cFKbRpHtQIsQw9W252Zn9BnkEMXIOXGfqdr+CO70QrP4fF2teg==`

Recipe:

```sh
npx --yes --package @playcanvas/splat-transform@3.1.7 \
  splat-transform laundry-room.sog laundry-room.ply
```

Observed output:

- Bytes: `45,358,553`
- SHA-256:
  `5ba754cf5b801b101a9ff5741585d6477c52c558847e25403c6a5a8e19f43bdb`
- 192,191 vertices
- binary little-endian PLY
- three spherical-harmonic bands
- all Gaussian properties required by the processor

This is the canonical positive fixture for strict Gaussian PLY validation and
the Spark processing lane.

### Indoor Spark RAD

Input: derived `laundry-room.ply`.

Tool: Spark `build-lod` at the repository's pinned Spark 2.1.0 commit
[`f22236f95fdd8078f0c12e3aab479523d401daf6`](https://github.com/sparkjsdev/spark/tree/f22236f95fdd8078f0c12e3aab479523d401daf6),
MIT licensed. This is the same commit pinned in
[`processor/Dockerfile`](../../processor/Dockerfile).

Recipe:

```sh
spark-build-lod --quality --max-sh=3 --rad laundry-room.ply
```

Observed local output:

- File: `laundry-room-lod.rad`
- Bytes: `12,713,888`
- SHA-256:
  `bdd90cfeab9092d5b4f06564f741af01aec1b84495c57429bc3129e06d5d81dc`
- Magic: `RAD0`

Spark records run-duration fields in the RAD comment metadata, so RAD bytes
are not a reproducible-build identity even when the geometry and command are
unchanged. The test gate verifies the `RAD0` container, the pinned input hash,
tool/command evidence, and successful Spark decoding; it does not require a
fixed derived RAD hash across machines or runs.

This fixture exercises `web_scene/rad`, RAD identity, R2 delivery, release
manifest generation, and the browser renderer. It is a derived build output;
the AWS SOG remains the licensed source master.

## Negative and boundary fixtures

Do not search for separately hosted corrupt files. Generate deterministic
negative cases from the adopted, licensed fixtures so provenance remains
clear.

| Negative case | Construction | Expected boundary |
|---|---|---|
| Point cloud mislabeled as Gaussian | Upload PDAL `issue_2421.ply` as `gaussian_splat/ply` | Non-retryable `INVALID_GAUSSIAN_PLY`; missing colour, opacity, scale, and rotation properties |
| Missing PLY header terminator | `head -c 64 laundry-room.ply > gaussian-truncated.ply` | Non-retryable `INVALID_GAUSSIAN_PLY`; no `end_header` |
| E57 signature mismatch | Copy `A4.e57`, flip byte zero from `A` to `X` | Non-retryable `EVIDENCE_SIGNATURE_MISMATCH` |
| LAS/LAZ signature mismatch | Copy `simple.las` or `simple.laz`, flip the first `LASF` byte | Non-retryable `EVIDENCE_SIGNATURE_MISMATCH` |
| GLB signature mismatch | Copy `Box.glb`, flip the first `glTF` byte | Non-retryable `EVIDENCE_SIGNATURE_MISMATCH` |
| ZIP signature mismatch | Submit UTF-8 text named `.zip` | Non-retryable `EVIDENCE_SIGNATURE_MISMATCH` |
| Invalid camera JSON | Truncate OpenSfM JSON after the first object member | Non-retryable `EVIDENCE_SIGNATURE_MISMATCH` |
| Download checksum mismatch | Upload the exact Laundry SOG or Box GLB but register SHA-256 as 64 zeroes | Retryable `SOURCE_HASH_MISMATCH` before decoder work |
| Download size mismatch | Register one more byte than the retained object actually contains | Retryable `SOURCE_SIZE_MISMATCH` |
| Multipart byte-count mismatch | Declare the Box GLB as 1,665 bytes, upload its actual 1,664 bytes, then complete | Completion rejected because uploaded and expected bytes differ |
| Oversized declaration | With the default limit, create an upload session for `107374182401` bytes (100 GiB + 1) without uploading a body | HTTP 413 `Asset exceeds organisation upload limit` |
| Extension mismatch | Declare `format: glb` with a `.ply` filename | Request validation error before R2 multipart creation |

The oversize test must read `MAX_UPLOAD_BYTES` from the test environment if it
is overridden; 100 GiB is only the production-code default.

For checksum-negative tests, do not commit a second corrupted large binary.
Use the correct fixture bytes with a deliberately wrong expected hash. This
tests the actual immutable-record boundary and avoids redundant storage.

## Corpus tiers and storage policy

### Commit directly

Only tiny fixtures whose byte-level mutation is useful in unit tests:

- PDAL `issue_2421.ply` (197 bytes).
- Khronos `Box.glb` (1,664 bytes), together with attribution.
- Optionally PDAL `A4.e57` (4,096 bytes), LAS (36,437 bytes), and LAZ
  (18,217 bytes).
- Small generated invalid headers.

### Fetch into a hash-verified cache

- AWS Laundry Room SOG.
- Derived Laundry Room Gaussian PLY and RAD.
- OpenSfM Berlin JSON and three JPEGs.
- Aukerman drone JPEGs or the pinned two-image archive.

Each cache entry should record:

```json
{
  "id": "aws-laundry-room-sog",
  "sourceUrl": "immutable commit URL",
  "licenseUrl": "immutable commit URL",
  "sizeBytes": 4665840,
  "sha256": "6bf14664068a3f59a651effb6055db36d8d4439423cde8ddf7c6ce0a2510e0b3",
  "redistribution": "MIT-0",
  "tier": "integration"
}
```

The fetcher should fail closed on hash or byte-count differences. It should
never silently update a fixture to a moving branch head.

### Evaluation only

- AWS Bench Melbourne SPZ because it is a 951k-splat, compute-heavy scene.
- AWS Bench Melbourne MOV because it is 93 MB.
- The complete Aukerman dataset because it is approximately 543 MB.
- PDAL multi-scan E57 unless a specific multi-scan feature is under test.

## Explicit gaps and exclusions

1. **No small, explicitly licensed indoor pose-plus-image sequence was found.**
   OpenSfM Berlin is the best compact real pose fixture, but it is outdoor.
   The AWS Laundry scene covers indoor Gaussian rendering; it does not include
   source poses or images.

2. **No independent public FJD or XGRIDS raw scanner bundle is adopted.**
   Public marketing/demo outputs do not establish redistribution rights for
   XBIN, FJDSLAM, LCC, or LCC2 source packages. Vendor-supplied evaluation data
   should remain private until a written redistribution licence exists.

3. **No upstream public RAD fixture is adopted.**
   Spark's official example asset list points at externally hosted World Labs
   scenes, but open-source code licensing does not establish the asset
   redistribution rights. Generate RAD from the MIT-0 AWS scene instead.

4. **No neutral canonical trajectory fixture exists.**
   `canonical_pose_json_v1` is an application schema. Keep its existing
   application-authored unit fixture; do not present it as a vendor or
   industry-standard pose format.

5. **LAS/LAZ/E57 tests presently prove bounded identity, not decoding.**
   The processor checks magic bytes only for the evidence lane. Full parser,
   coordinate-system, scan-count, and point-count assertions require a future
   PDAL/libE57 processing stage.

6. **The Khronos box is not a collision-quality benchmark.**
   It proves a lawful GLB transport and attachment path. Walkability,
   watertightness, navmesh generation, and indoor proxy quality need
   purpose-built generated geometry or a separately licensed real building
   model.

7. **GitHub commit ZIP hashes are not as durable as raw blob hashes.**
   Prefer pinned raw blobs and a repository-controlled deterministic archive.
   Treat codeload ZIP hashes as observed evidence, not as an eternal Git object
   identity.

8. **OpenDroneMap's catalogue is not a blanket licence.**
   Its entries come from different owners. Adopt only datasets such as
   Aukerman or Banana after verifying the linked repository's own licence.

## Licence handling

This report is an engineering provenance review, not legal advice.

For every redistributed fixture:

- retain the upstream licence or asset-specific notice;
- preserve required attribution, especially Cesium/Khronos Box CC BY 4.0;
- record the upstream repository, commit, source URL, byte count, and SHA-256;
- distinguish source bytes from derived output;
- never infer asset rights from the licence of a viewer, SDK, research paper,
  or reconstruction repository.

This policy intentionally excludes visually attractive scenes when their
redistribution grant is unclear.
