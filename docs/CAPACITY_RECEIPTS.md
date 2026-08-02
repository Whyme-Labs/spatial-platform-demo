# Capacity receipts

Last measured: 2026-08-02

## Browser collision proxy tripwires

The checked local collision corpus contains four Home Scan GLBs. The largest
measured proxy is `home-scan-physical.collision.glb` at 551,168 bytes, 15,644
vertices, and 30,232 triangles. The browser/offline decoder tripwires remain:

- `collision_glb_bytes=268435456` (487 times the measured maximum);
- `collision_vertices=3000000` (191 times the measured maximum); and
- `collision_triangles=5000000` (165 times the measured maximum).

These are corruption/runaway-allocation tripwires, not supported asset targets.
Every failure reports the budget name, limit, and observed ask.

Remeasure from the repository root with:

```sh
node --input-type=module -e 'import {readFile} from "node:fs/promises"; import {extractCollisionGeometryFromGlb} from "./scripts/navigation-build-core.mjs"; const files=[".cache/spark-home-scan/home-scan-physical.collision.glb",".cache/spark-home-scan/home-scan-upright.collision.glb",".cache/spark-home-scan/home-scan-structural-v7.glb",".cache/spark-home-scan/home-scan-authored-navigation-v6.glb"]; for (const file of files) { const bytes=await readFile(file); const geometry=await extractCollisionGeometryFromGlb(bytes); console.log(JSON.stringify({file,bytes:bytes.length,vertices:geometry.positions.length/3,triangles:geometry.indices.length/3})); }'
```

Update this receipt and resize the tripwires if a known-good collision proxy
approaches them.

## Authored traversal protocol domains

The authored-link `area`, `flags`, and `userId` ranges are wire-format domains,
not product capacity budgets. They come from the exact native Recast commit
frozen in every navigation artifact and from the installed
`@recast-navigation/core@0.43.1` binding:

- `area=0..63`: Detour reserves six bits for the area id and declares
  `DT_MAX_AREAS=64`; Recast declares `RC_WALKABLE_AREA=63`.
- `flags=1..65535`: Detour stores polygon and off-mesh flags as an unsigned
  16-bit value. Spatial Studio reserves zero as non-traversable, so authored
  traversals must ask for at least one flag bit.
- `userId=0..4294967295`: Detour stores off-mesh user ids as an unsigned
  32-bit value.

Protocol receipts, pinned to native commit
`599fd0f023181c0a484df2a18cf1d75a3553852e`:

- [Detour area count and packed area field](https://github.com/recastnavigation/recastnavigation/blob/599fd0f023181c0a484df2a18cf1d75a3553852e/Detour/Include/DetourNavMesh.h#L85-L87)
- [Detour off-mesh field types](https://github.com/recastnavigation/recastnavigation/blob/599fd0f023181c0a484df2a18cf1d75a3553852e/Detour/Include/DetourNavMeshBuilder.h#L56-L66)
- [Recast walkable area maximum](https://github.com/recastnavigation/recastnavigation/blob/599fd0f023181c0a484df2a18cf1d75a3553852e/Recast/Include/Recast.h#L583-L591)

If the native commit or JS binding changes, re-read those declarations before
changing the contract. Do not treat these protocol widths as adjustable
tripwires.
