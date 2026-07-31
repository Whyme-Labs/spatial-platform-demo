# Spark-compatible multi-room demo asset research

Research date: 2026-07-31

## Decision

**Home Scan** is the selected Spark-compatible multi-room visual and
provisional-walking demo. The current v3 release clears these gates:

1. a real, connected multi-room indoor capture;
2. rights that permit commercial use and redistribution with stated attribution;
3. a portable Gaussian format that Spark can ingest directly (`PLY`, `SPZ`, `SOG`, `ZIP`, or `RAD`); and
4. a verified Spark render that is visually faithful from an authored camera;
5. an immutable baked-upright PLY and reviewed identity Y-up transform that
   bind the visual asset to authored geometry; and
6. four inspected provisional walk zones that support bounded keyboard
   movement without making metric or certified-collision claims.

The earlier Home Scan failure was a coordinate-frame mismatch, not corrupted
Gaussian data or a Spark decoder failure. SplatTransform's PLY presentation
frame applies a 180-degree rotation around Z; Spark correctly preserved the raw
PLY/RAD frame. Applying that rotation as explicit per-release viewer metadata
raised normalized cross-correlation against the reference from `0.347871` to
`0.984221` with the same authored camera.

Publish it only as an attributed visual-navigation demonstration. The
source is distributed as streamed SSOG, so `@playcanvas/splat-transform` remains
an offline evaluation bridge and is not the FJD/XGRIDS ingestion architecture.
The runtime remains Spark-only. The v3 release has authored provisional
collision regions and a navigation mesh, but has no metric scale, certified
collision, measured floor plan, accessibility evidence, or invented bridges
across gaps between the separately reconstructed room components.

## Strongest direct-Spark candidate: Villa Badam

Source: [SuperSplat scene `a7c5cec0`](https://superspl.at/scene/a7c5cec0),
published by `al1zade`.

| Gate | Evidence | Result |
|---|---|---|
| Connected multi-room content | The official scene contains authored annotations for `Guest Hall`, `Master Bedroom`, `Wardrobe`, `WC`, `Main Entrance`, and `Backyard opening`. The live viewer visibly shows doorways, partitions, columns, stairs, and connected spaces. The description says it was captured with an Insta360 X4 and MipMap from 497 frames. | Pass |
| License | The official page exposes Download and identifies the license as CC BY 4.0. CC BY 4.0 permits sharing, adaptation, and commercial use when attribution and the other license conditions are met. | Pass, with attribution required |
| Portable format | The official SuperSplat API identifies the asset as SOG, with downloads enabled and a reported size of 121,969,031 bytes. Spark documents SOG as a supported input to both its loader and offline LoD builder. | Pass |
| Direct Spark decode/build | The public SOG v2 components were packaged without semantic conversion and processed by the repository's pinned Spark 2.1.0 `build-lod`. With the source's actual SH degree (`--max-sh=0`), Spark read 10,278,103 Gaussians and wrote a 257,992,744-byte RAD containing 14,110,880 LoD splats. | Pass |
| Visual fidelity | The repository poster renderer completed, but its 640 x 360 result was almost entirely black with only a small blurred fragment in the upper-left corner. This does not match the clearly legible official viewer. | **Fail** |

The rights signal is usable but not institutionally curated: this is a
user-published asset and the public identity available in the source is the
username `al1zade`. A release should retain that attribution and the original
scene URL. If a production demo requires stronger chain-of-title evidence,
obtain written confirmation from the creator before redistribution.

### Reproducible source and build evidence

Official metadata/API query:

```text
https://playcanvas.com/api/splats/explore?limit=10&sort=createdAt&order=-1&search=Villa%20Badam
```

Official public component root:

```text
https://d28zzqy0iyovbz.cloudfront.net/a7c5cec0/v1/
```

The SOG v2 metadata declares 10,278,103 Gaussians and no higher-order `shN`
section, so its effective SH degree is zero. Component SHA-256 values:

| Component | SHA-256 |
|---|---|
| `meta.json` | `688576ea90778d5a6830cefc2f1d82d059225f9e416f95db20a059aa8bb79bb6` |
| `means_l.webp` | `58ec74aaaa8679844d72c2911c8ac4dccabec44046c4f6af80cf51e8bb65deb5` |
| `means_u.webp` | `6d6b51783fcecbd98efa814f55f527d77903b6466d756000ed4ec13183ce7d2b` |
| `scales.webp` | `d98f63b14dd6c3a2c8a8658a025e99a4684234e44dcf08ba7bfdb60100607748` |
| `quats.webp` | `7899c20dd36a36eb4a9d052719ac6eb46fc78687dca786ec74bc152a76a2cea7` |
| `sh0.webp` | `9c1f04d66b9321d05a2513e63dbb6e49788a16f90d8dac8698cc5781e5a1d7bc` |

For testing, those components were placed in a deterministic, uncompressed ZIP
in the order shown above. This is a locally assembled equivalent SOG container,
not the byte-for-byte provider download:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Assembled `villa-badam.sog` | 121,968,977 | `263941d3b3df4c0d8132bb01d8fc15c64d56eff4ad9fa5442d3d38fdc63f7f23` |
| Spark `villa-badam-lod.rad` | 257,992,744 | `6844982ea33a5615b2fba23c7be70e4dbb5c46503d5896af2ea4eb5ec811986c` |
| Validation poster | 55,335 | `b944838b3d4de16f7e2988ad4400070802e16657ca89fe140d00bf01712214db` |

Successful direct-Spark command:

```bash
.tools/bin/spark-build-lod \
  --quality --max-sh=0 --rad \
  /tmp/villa-badam-spark/villa-badam.sog
```

Observed build evidence:

```text
Read: num_splats: 10278103 with sh_degree: 0
final_splat_count: 14110880
lod_duration: 356.820s
chunk_duration: 20.144s
```

This proves that Spark can decode and build the source representation. It does
not prove that the current platform camera and coordinate conventions reproduce
the source viewer. The visual failure is therefore a release blocker, not a
format blocker. The next bounded investigation should recover and explicitly
apply the source-authored camera/transform, render the original SOG and derived
RAD from that same camera, and compare them side by side.

### Spark 2.1 SH-degree constraint

The test must use the asset's actual SH degree. For this SOG that is zero.
Forcing `--max-sh=3` on a degree-zero SOG triggers the known Spark 2.1.0 panic in
[`sparkjsdev/spark#352`](https://github.com/sparkjsdev/spark/issues/352), fixed by
the clamp in [PR #359](https://github.com/sparkjsdev/spark/pull/359). This is
documented in the companion
[`spark-sog-crash-2026-07-31.md`](./spark-sog-crash-2026-07-31.md).

The FJD/XGRIDS ingestion contract should inspect source metadata, preserve the
source degree, and clamp rather than invent missing SH coefficients.

## Selected content: Home Scan, corrected Spark release

Source: [SuperSplat scene `3f89bbd3`](https://superspl.at/scene/3f89bbd3),
published by `luxury_scans`.

This is the strongest content match found. The official description says the
entire New Jersey ranch home was captured, each room was reconstructed
separately in MipMap, and the rooms were manually aligned and merged in
SuperSplat into a seamless connected scene. The official viewer shows a
furnished, whole-home dollhouse with multiple connected rooms.

The official API record reports:

- format `ssog`;
- exact source size 513,131,522 bytes;
- downloads enabled;
- license `by` (CC BY 4.0);
- creation time `2026-07-14T07:47:42.214Z`;
- completion time `2026-07-14T07:57:25.422Z`.

Official API query:

```text
https://playcanvas.com/api/splats/explore?limit=10&sort=createdAt&order=-1&search=Home%20Scan
```

The public streamed manifest is:

```text
https://d28zzqy0iyovbz.cloudfront.net/3f89bbd3/v1/lod-meta.json
```

It is 61,004 bytes with SHA-256
`7f5ab588959fca6506b110fcdd27ebdd007b971d0956d59352ee9a0d57504906`.
It identifies `splat-transform v2.7.1`, 42,323,301 total Gaussians, and six LoD
levels with counts:

```text
21497908, 10748589, 5374295, 2687148, 1343574, 671787
```

The official preview is 1,638,774 bytes with SHA-256
`b99725f4c0d8d8e609a712ac994124fddcd13bf9bfc46309e75eb51786c03e01`:

```text
https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat/3f89bbd3/v1/mov.webp
```

Spark's documented format list does not include SSOG. Current SplatTransform
can consume `lod-meta.json`, select an LoD, and decimate it to PLY. That permits
a temporary offline experiment such as:

```bash
npx --yes --package @playcanvas/splat-transform@3.2.0 \
  splat-transform --no-tty \
  'https://d28zzqy0iyovbz.cloudfront.net/3f89bbd3/v1/lod-meta.json' \
  --select-lod 3 --decimate 2000000 \
  home-scan-lod3-2m.ply
```

Two offline experiments completed:

| Artifact | Result | Bytes | SHA-256 |
|---|---|---:|---|
| Adaptive 42.3M to 2M PLY | Completed in 18m14s; peak CPU memory 2.46 GB; SH0 | 112,000,363 | `df4d53f81caa9d23a8fa4141b8dee14c22b19bb842b597c218521713ede48879` |
| Author-provided LoD 3 PLY | Selected 2,687,148 Gaussians and wrote in 6.386s; SH0 | 150,480,651 | `87e22003bb459f01c8300d9cfc85eb4b5ba0c99d5b183787908ed84234fb3692` |
| Spark RAD from LoD 3 | Direct Spark 2.1 build; 3,887,159 LoD splats | 73,417,608 | `8b287f358f19c50cf2593a293b3f05973630ee7f8c16b1b4341e442efe681e36` |
| LoD 3 reference poster | Temporary converter render from the evaluation PLY | 59,728 | `53098ea7632a1969b8cb09f8683dd4596435721df117491f78d4ce101203cec8` |
| LoD 3 Spark poster | Spatial Studio Spark renderer from the RAD | 84,496 | `0e040160351ee3cbb63dc1b65b394392de9ea349c8be23ae2746c6139e53f7f6` |
| Corrected Spark comparison frame | Same camera with explicit `[0, 0, 180]` scene rotation | 84,913 | `fb0f03c6abcc059dee0e6bd12e5b2f79b365fddefdf56fd2ac34e06e405493f6` |

The direct Spark PLY and Spark RAD produce the same recognizable whole-home
dollhouse from the tested numeric camera, which clears the PLY-to-RAD integrity
check. Inspection of SplatTransform's installed source map identified its PLY
presentation transform as a 180-degree Z rotation. Spark intentionally does not
invent that transform. Applying the same orientation to Spark produces a
reference-equivalent frame: normalized cross-correlation improved from
`0.347871` before correction to `0.984221` after correction.

The first production release authored both inputs instead of relying on
guesswork:

```text
sceneRotationDegrees: [0, 0, 180]
camera.position: [16, 13, 15]
camera.target: [-3.93, -1.3, -6.07]
camera.up: [0, 1, 0]
camera.fovDegrees: 55
```

That v1 release cleared the whole-home dollhouse visual gate only. The current
v3 release bakes the same 180-degree correction into an immutable PLY, rebuilds
RAD from that master, and adds reviewed provisional navigation evidence.

### Current production walkable release verification

The walkable Spark v3 release was published and independently re-opened from
the public channel on 2026-07-31:

- public viewer: <https://spatial.whymelabs.com/s/home-scan-spark-multi-room-demo>;
- project: `8575b01f-af96-401f-a245-3013fda91706`;
- immutable version: `fcdbecb7-3042-40d1-a96b-1bbc4fc3913c`;
- active release: `665dc7ca-53c8-4d35-931d-51f749a3d394`;
- immutable upright PLY: 150,480,651 bytes, SHA-256
  `1d4c11e4e6f159e9997d953c22a6c5e8a9fecc45f1fa0ec4ad4ad207fc835148`;
- production-generated RAD: 73,437,240 bytes, SHA-256
  `ee0342109aff6661fe5c0a75e91f7a5401dcc23ee47c866105a23299d36462cf`;
- reviewed transform evidence: `cc2f2648-4838-4df5-871f-9adf8301ff25`;
- QA report: `eb1ac575-466f-406d-b3ee-be9f83c77ac2`;
- deployed application commit: `0be9cdc`;
- Cloudflare Worker version: `3861a40e-4363-4823-b3aa-4aec582da573`.

The active manifest records a 4M splat budget, reviewed identity Y-up/SU
transform, opening camera `[3.433, 1.75, -2.433]` looking toward
`[2.433, 1.75, -2.433]`, four authored floor entities, 82 runtime navigation
triangles, a 0.30 SU agent radius, and no authored obstacles. The four polygons
retain 30.53 SU² of relative Recast footprint across four disconnected
components; the platform does not claim that SU is metres or that the gaps are
real doors.

A fresh production Chrome run reached `Scene ready`, displayed `Walking
enabled · clear route map`, emitted no console errors, and visibly moved the
camera forward after 18 real Arrow Up keypresses. A late-iframe-load regression
that could overwrite the ready label with `Preparing scene` was reproduced in
Playwright, fixed, and deployed with a dedicated regression assertion.

Before production deployment, `npm run check` passed 163 unit/worker tests, 39
Playwright tests, all type/build/static audits, and the Cloudflare production
deployment dry-run. The temporary upload credential was revoked after the
immutable PLY and derivatives were verified.

The prior visual-only release remains in immutable history as version
`388c4f7b-fcbd-4f1b-bffa-5f223fa13d10` / release
`9f62c462-5420-4f53-b02a-0c90022064a9`, but it is no longer the active channel
target.

`@playcanvas/splat-transform` must remain an offline evaluation bridge only.
The production FJD/XGRIDS path should accept a creator/vendor export in a
portable Gaussian format and use Spark directly; it should not depend on
PlayCanvas at runtime or treat SSOG as the platform's canonical asset.

## Other evaluated candidates

| Candidate | Rights and format | Evidence | Decision |
|---|---|---|---|
| AWS `venetian-hall-panos.sog` | MIT-0 repository; SOG | The pinned source SOG is 8,339,325 bytes, SHA-256 `e413ff3fe21937e901842de3bf0db767cfafa6a1ae7bd7e3e2a885f3e2090bcd`. It converted and built successfully, but the verified image is one circular Venetian hall, not a connected multi-room property. | Reject: wrong spatial content |
| Maison Provence on SuperSplat | SOG; CC BY-ND | Visually relevant, but BY-ND prohibits distributing adapted material. A transformed or rebuilt RAD should not be the platform's redistributable demo. | Reject: derivative/redistribution risk |
| Matterport, HM3D, ScanNet, Replica, and related research corpora | Typically research-only, non-commercial, or redistribution-restricted dataset terms | These sources may contain excellent multi-room geometry, but their official terms do not give the clear commercial redistribution grant needed for a public product demo. | Reject for this release |

Pinned AWS source and license:

- [`venetian-hall-panos.sog`](https://raw.githubusercontent.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/73133959c04fb0f9f002e95b4d2a722de2d18722/source/Gradio/favorites/venetian-hall-panos.sog)
- [AWS repository MIT-0 license](https://github.com/aws-solutions-library-samples/guidance-for-open-source-3d-reconstruction-toolbox-for-gaussian-splats-on-aws/blob/73133959c04fb0f9f002e95b4d2a722de2d18722/LICENSE)

## Production acceptance contract for FJD/XGRIDS

A future demo asset should not be accepted merely because a loader does not
crash. Require all of the following:

- a stable source URL, creator identity, original asset checksum, capture
  provenance, and a license that explicitly permits the intended commercial
  use and redistribution;
- an original vendor export in `PLY`, `SPZ`, or validated `SOG`, retained as
  the immutable master artifact;
- direct Spark ingestion and offline Spark RAD generation, with the real SH
  degree derived from source metadata;
- a source-authored camera plus an explicit coordinate/up-axis transform;
- same-camera screenshots of the source master and Spark RAD that demonstrate
  equivalent room connectivity, color, scale, and orientation;
- collision proxy, walkable zones, navmesh, room graph, and floor-plan data as
  separate authored or derived artifacts with their own provenance; and
- browser validation in Spatial Studio for desktop and phone before publish.

Home Scan is the visual demo that currently clears this contract's image,
rights, connectivity, and authored-frame gates. Villa Badam remains useful for
debugging native SOG ingestion, but it is not suitable as the public demo until
its camera/transform mismatch is explained and its Spark render passes the
same-camera visual gate.

## Primary sources

- [Spark: loading splats](https://sparkjs.dev/docs/loading-splats/)
- [Spark: offline LoD and RAD generation](https://sparkjs.dev/docs/lod-getting-started/)
- [SuperSplat: Villa Badam](https://superspl.at/scene/a7c5cec0)
- [SuperSplat: Home Scan](https://superspl.at/scene/3f89bbd3)
- [PlayCanvas SplatTransform](https://github.com/playcanvas/splat-transform)
- [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
- [Spark issue #352](https://github.com/sparkjsdev/spark/issues/352)
- [Spark PR #359](https://github.com/sparkjsdev/spark/pull/359)
