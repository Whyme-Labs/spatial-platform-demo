# Multi-room Gaussian-splat demo asset

Research date: 2026-07-31

## Decision

Use **“Single family home, Bellevue WA (XGRIDS PortalCam)”** from SuperSplat
for the first public Spatial Studio multi-room demo.

It is the best candidate that clears all immediate gates:

- a real captured residence rather than a synthetic render;
- visibly connected living, dining, and kitchen spaces in the published viewer;
- asset-specific **CC BY 4.0** permission and an enabled download;
- a 52.26 MB SOG, which the Spark browser runtime supports natively;
- a public authored opening camera.

Keep Habitat-GS “Sales gallery” as a technical reference only. It is a much
better navigation package, but binary verification maps it to an InteriorGS
scene. InteriorGS permits only non-commercial research and education and
forbids redistribution. Do not upload or publish that scene in Spatial Studio
without written permission from the rights holder.

## Ranked candidates

| Rank | Candidate | Multi-room evidence | Format and size | Rights | Decision |
|---|---|---|---|---|---|
| 1 | [Single family home, Bellevue WA](https://superspl.at/scene/6f412fa2) by Paolo Tosolini (`tosolini`) | Real single-family-home capture. Manual viewer inspection on 2026-07-31 confirmed a continuous living/dining/kitchen reconstruction rather than isolated room cards. | SOG, 54,802,727 bytes on the asset record (52.26 MB in the UI) | Asset page exposes Download and links **CC BY 4.0** | **Use now** |
| 2 | [Home Scan](https://superspl.at/scene/3f89bbd3) by Isaiah Sweeney (`luxury_scans`) | The author explicitly says the entire NJ ranch home was captured room-by-room and merged into one seamless scene with clean transitions. | SSOG, 513,131,522 bytes (489.36 MB) | Asset page exposes Download and links **CC BY 4.0** | Strongest whole-home content, but too large and SSOG is outside the current ingest contract. Revisit after streaming-SSOG support. |
| 3 | [Habitat-GS Sales gallery](https://zju3dv.github.io/habitat-gs/) | Excellent connected venue, walkable viewer, supplied Recast/Detour navmesh, roughly 20 m × 24 m navigation envelope | Raw `.splat`, 13,802,208 bytes; navmesh JSON, 28,417 bytes | The live binary maps to `interior_0184_840116`, which is derived from InteriorGS. InteriorGS terms prohibit commercial use and redistribution. | **Do not publish** |
| 4 | [Matterport-derived home scan](https://superspl.at/scene/bc23fc76) | Likely real interior and compact | SOG, 17,761,430 bytes (16.94 MB) | SuperSplat says CC BY 4.0, but the author says it was derived from a Matterport virtual tour and does not document the source-tour rights | Hold pending source-capture permission |
| 5 | [My apartments in Moscow](https://superspl.at/scene/04d937e1) | Real iPhone apartment capture | SOG, 15,684,033 bytes | Asset-specific CC BY 4.0 | Reject for this demo: manual viewer inspection found conspicuous reconstruction artifacts and uncertain full-apartment continuity |

## Selected asset: verified record

The SuperSplat page exposes these server-rendered facts:

- title: `Single family home, Bellevue WA (XGRIDS PortalCam)`;
- author: Paolo Tosolini, username `tosolini`;
- format: `sog`;
- stored size: `54,802,727` bytes;
- license code: `by`, with the page's canonical
  [CC BY 4.0 link](https://creativecommons.org/licenses/by/4.0/);
- download enabled;
- created 2025-11-24T03:28:47.159Z and completed
  2025-11-24T03:30:01.551Z.

Viewer:

<https://superspl.at/s?id=6f412fa2>

The public SOG component root is:

<https://d28zzqy0iyovbz.cloudfront.net/6f412fa2/v1/>

| Component | Bytes | SHA-256 |
|---|---:|---|
| `meta.json` | 9,933 | `4dea4fb59d6f93e23be5e04e3d856efa9fe0c9a8ab39fbf04430c0cd08f0cf60` |
| `means_l.webp` | 14,239,832 | `99a374de8e09523fce2f74fcba3027a9f3f2108bae5ed386993a80304771069a` |
| `means_u.webp` | 2,101,772 | `feaee533041469d5882fb4378aeceffcb5500ac033be141e10e6326cad002f05` |
| `scales.webp` | 11,690,884 | `1b621531494b05e177d02f14787815bfc8fd5d525c9a1b681b82b762314166c8` |
| `quats.webp` | 12,745,266 | `acb46a3ef2ac242574759e683f4df0482953da7415427c4ef383d53bb88bce96` |
| `sh0.webp` | 14,014,744 | `06a9648120ce32b7b8e0e7f22f884d279e851a024c6832bee564b0b4a550421f` |

`meta.json` declares 4,944,177 Gaussians and SOG version 2. Its Gaussian
position bounds are:

```text
min = [-3.6311297669453535, -3.351431877043111, -3.435817628888684]
max = [ 3.24077762197242,   1.435687780717878,  4.322269247870247]
```

The authored viewer opening is:

```json
{
  "fov": 65,
  "position": [-3.2509567737579346, 0.7080726623535156, -0.23564030230045319],
  "target": [-2.372227814962092, 0.5503343124134096, 0.1384473287927974]
}
```

This is an opening camera only. The asset does not provide source images,
camera trajectories, a collision mesh, a navmesh, metric-scale evidence, room
polygons, or semantic labels.

### Spatial Studio compatibility

Import the immutable SOG directly as a **Ready Spark web scene**. Do not route
this SOG v2 package through `spark-build-lod`: the current Spark 2.1.0 builder
panics while decoding it, even though the Spark browser renderer supports SOG
delivery directly. Spatial Studio's web-scene import contract was extended to
accept RAD, SPZ, and SOG so the original licensed asset can remain immutable.

An SPZ/RAD conversion was tested only as a diagnostic and must not be
published: although the conversion completed, independent rendered previews
did not reproduce the source scene faithfully.

## Reproducible SOG acquisition

The canonical user-facing route is the asset page's Download button. It
requires a SuperSplat login. For automated evaluation, the public SOG
components can be fetched and packaged as a stored ZIP:

```bash
mkdir -p bellevue-home-sog
for part in meta.json means_l.webp means_u.webp scales.webp quats.webp sh0.webp; do
  curl --fail --location \
    --output "bellevue-home-sog/${part}" \
    "https://d28zzqy0iyovbz.cloudfront.net/6f412fa2/v1/${part}"
done

(cd bellevue-home-sog && zip -0 -X ../bellevue-home.sog \
  meta.json means_l.webp means_u.webp scales.webp quats.webp sh0.webp)
```

Verify every component against the table above before upload. Archive bytes
can vary with ZIP metadata, so the component hashes are the durable integrity
record.

Required release attribution:

```text
“Single family home, Bellevue WA (XGRIDS PortalCam)” by Paolo Tosolini
(@tosolini), licensed under CC BY 4.0.
Source: https://superspl.at/scene/6f412fa2
License: https://creativecommons.org/licenses/by/4.0/
```

## Habitat-GS Sales gallery: technical verification and rights failure

The official Habitat-GS page labels its comparison scenes as InteriorGS and
provides a live walkable viewer. The viewer's “Sales gallery” files are:

- [`scene.splat`](https://zju3dv.github.io/habitat-gs/static/scenes/scene1/scene.splat):
  13,802,208 bytes, 431,319 32-byte Gaussian records,
  SHA-256 `33005e0bef1493aed894974cf646d2c6273050ce5f74a1a649e2cd75a06c7cd2`;
- [`navmesh.json`](https://zju3dv.github.io/habitat-gs/static/scenes/scene1/navmesh.json):
  28,417 bytes, 698 vertices, 722 triangles,
  SHA-256 `98a2791916e414fb7ad00026dede975387041c99f7b0ddd6f55b7cc5d65fb3c6`.

The navmesh spans 19.9 m × 23.9 m in X/Z and has about 195.52 square metres of
projected triangle area. It uses a 1.5 m walkable height, 0.1 m radius, and
0.2 m climb. This is exactly the kind of authored navigation evidence missing
from the Bellevue SOG.

The binary provenance is conclusive:

1. The official Habitat-GS dataset card says `interior_*` entries come from
   [InteriorGS](https://huggingface.co/datasets/spatialverse/InteriorGS).
2. The official dataset entry
   [`train/interior_0184_840116`](https://huggingface.co/datasets/RukawaY/gs_scenes/tree/main/train/interior_0184_840116)
   contains a 106,968,643-byte PLY with LFS SHA-256
   `87329d35a48c3b474a3814e0c88dce72396398945d642bac75dce7b2b7d2f03e`
   and a 54,832-byte navmesh with LFS SHA-256
   `ee34d9d7cb02430d963c7b0163d2baba0899d75e4f94f43390399373d7c4ce24`.
3. Running Habitat-GS's own
   [PLY-to-splat converter](https://github.com/zju3dv/zju3dv.github.io/blob/b8bdac0e7babb21fd4b3313e83a42a82bd44bb23/habitat-gs/tools/convert_ply_to_splat.py)
   on that PLY produces a byte-for-byte match for the live `scene.splat`.
4. Running its
   [navmesh-to-JSON converter](https://github.com/zju3dv/zju3dv.github.io/blob/b8bdac0e7babb21fd4b3313e83a42a82bd44bb23/habitat-gs/tools/convert_navmesh_to_json.py)
   produces the same vertices, triangles, and parameters as the live
   `navmesh.json`.

The Habitat-GS Hugging Face card carries an Apache-2.0 metadata tag, but that
generic tag cannot safely relicense an explicitly identified third-party
InteriorGS asset. The upstream
[InteriorGS Terms of Use](https://kloudsim-usa-cos.kujiale.com/InteriorGS/InteriorGS_Terms_of_Use.pdf)
say the database is only for non-commercial research and educational purposes
and that downloaded data must not be redistributed in whole or in part.

Therefore:

- local technical evaluation is possible only within those terms;
- publishing the splat through Spatial Studio would redistribute it;
- a public product demo should not use it without written permission;
- the live Habitat-GS files should not be copied into this repository or R2.

## Import acceptance gates for the selected Bellevue home

Before calling the release complete:

1. Verify all six component hashes and package a loadable SOG.
2. Import the immutable SOG as a ready web scene and load it through the same
   native Spark SOG route used in production.
3. Start at the authored camera above and confirm living, dining, and kitchen
   connectivity in desktop and mobile browsers.
4. Record the CC BY attribution in release metadata and the visible release
   panel.
5. Label scale as unknown/provisional. Do not imply metric measurement.
6. Do not claim authored collision, navmesh, floorplan, room polygons, or
   semantic navigation. Generate those as separate derived artifacts and mark
   their provenance.
7. Keep the original SOG immutable; make any crop, LOD, or navigation version a
   separately checksummed derivative.

## Sources

- [SuperSplat Bellevue asset record](https://superspl.at/scene/6f412fa2)
- [SuperSplat Home Scan asset record](https://superspl.at/scene/3f89bbd3)
- [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
- [Habitat-GS project page](https://zju3dv.github.io/habitat-gs/)
- [Habitat-GS official dataset card](https://huggingface.co/datasets/RukawaY/gs_scenes)
- [Habitat-GS Sales gallery source directory](https://github.com/zju3dv/zju3dv.github.io/tree/b8bdac0e7babb21fd4b3313e83a42a82bd44bb23/habitat-gs/static/scenes/scene1)
- [InteriorGS repository](https://github.com/manycore-research/InteriorGS)
- [InteriorGS Terms of Use](https://kloudsim-usa-cos.kujiale.com/InteriorGS/InteriorGS_Terms_of_Use.pdf)
