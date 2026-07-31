# Walkable Gaussian-splat runtime: Spark, Unreal, and navigation tooling

Last verified: 2026-08-01

## Decision

Keep Spark 2.1 as Spatial Studio's web **visual layer**. It is not the cause of
the disconnected walkable map. The weak link is the independently authored
collision/navigation layer and the absence of a release gate that proves all
intended rooms are reachable.

For a durable pipeline, build a metric collision proxy from the scanner's
point-cloud or triangle-mesh output, generate the navigation mesh offline with
Recast, and query it with Detour at runtime. For the current TypeScript/browser
stack, [`recast-navigation-js`](https://github.com/isaac-mason/recast-navigation-js)
is the most direct maintained WebAssembly binding to evaluate. Keep the current
hand-authored floor polygons as an operator correction tool, not as the primary
multi-room topology generator.

Moving the same splat to Unreal would not remove this work. Unreal's official
navigation guide says that its navmesh is generated from the world's
**collision geometry**, and its setup explicitly adds and sizes a
`NavMeshBoundsVolume`. A splat importer can provide the visual asset, but a
collision proxy, navigation build, agent settings, and reachability QA are
still required.

## What the primary sources establish

### 1. Gaussian rendering and walkability are separate products

Spark describes itself as an advanced 3D Gaussian Splatting renderer for
Three.js. Its published feature set covers rendering, transforms, formats,
editing, and mixing splats with mesh-based objects; it does not claim to
generate collision geometry or navigation. The mesh integration is useful:
Spatial Studio can render a Gaussian scene while maintaining ordinary,
possibly invisible triangle meshes for collision and navigation.

Source: [Spark official repository and 2.1 example](https://github.com/sparkjsdev/spark#readme).

Recast makes the separation concrete. Its documented build starts by
rasterizing **input triangle meshes** into voxels, filters non-walkable areas,
partitions walkable regions, then generates navigation polygons. Gaussian
primitives are not that triangle input; a mesh or authored proxy has to supply
the traversable geometry.

Source: [Recast Navigation official repository](https://github.com/recastnavigation/recastnavigation#how-it-works).

### 2. Unreal requires the same missing layer

Epic's current Navigation System documentation says Unreal generates its
navigation mesh from collision geometry. Its Basic Navigation guide then
requires a `NavMeshBoundsVolume`, sizes it over the play area, and uses the
generated `RecastNavMesh` for pathfinding. Epic's collision documentation also
requires collidable objects to have enabled collision and appropriate object
responses.

Sources:

- [Unreal Engine Navigation System](https://dev.epicgames.com/documentation/unreal-engine/navigation-system-in-unreal-engine)
- [Unreal Engine Basic Navigation](https://dev.epicgames.com/documentation/unreal-engine/basic-navigation-in-unreal-engine)
- [Unreal Engine Collision Overview](https://dev.epicgames.com/documentation/unreal-engine/collision-in-unreal-engine---overview)

Therefore, loading 3DGS into Unreal is not the operation that makes a scene
walkable. An Unreal implementation may make the authoring UI familiar, but it
still needs a proxy mesh/collision setup, a navmesh build, character capsule
parameters, doors or navigation links where appropriate, and validation that
the intended area is connected.

### 3. Recast/Detour is the appropriate standard layer

The upstream project splits responsibilities cleanly:

- Recast generates navigation meshes from level triangle geometry.
- Detour loads and queries navmeshes and performs pathfinding.
- Detour Tile Cache supports streamed and temporary-obstacle cases.
- Detour Crowd adds agent steering and avoidance when needed.

Recast is zlib-licensed and identifies itself as the navigation foundation used
by Unreal, Unity, Godot, O3DE, and other engines. Detour also supports explicit
user-authored off-mesh connections for genuine discontinuities such as lifts or
jumps; an ordinary doorway should normally be a continuous, adequately wide
navmesh portal instead of a teleport-like workaround.

Sources:

- [Recast/Detour modules and licence](https://github.com/recastnavigation/recastnavigation#recast-navigation)
- [Detour off-mesh connection reference](https://recastnav.com/structdtOffMeshConnection.html)

`recast-navigation-js` exposes Recast and Detour to Node.js and browsers. Its
official repository supports offline or runtime navmesh generation, Detour
queries, browser/Node ECMAScript modules, Web Workers, export/import, and
Three.js helpers. For a largely static scanned room, its own guidance supports
offline generation and runtime import, which avoids spending viewer startup
time rebuilding the mesh.

Source: [`recast-navigation-js` official repository](https://github.com/isaac-mason/recast-navigation-js#overview).

This binding is community-maintained rather than an official Recast project,
so it should enter through a pinned-version adapter plus a corpus of known
rooms. The canonical artefact should remain an engine-neutral navmesh/proxy
representation so another Detour binding or native device runtime can replace
it without changing releases.

## Fit with the current Spatial Studio implementation

The repository already has the correct separation in outline:

- `@sparkjsdev/spark` 2.1.0 renders the splat in `src/renderer/main.ts`.
- `src/shared/navigation-runtime.ts` separately checks an authored triangle
  mesh, agent footprint, step height, obstacle boxes, and doorway assistance.
- The release manifest carries collision and navigation data independently of
  the Gaussian asset.

That is a valid prototype architecture. The problem is that manually authored
regions can be geometrically valid yet topologically disconnected, while the
viewer still advertises walking. A custom point-in-triangle mover also leaves
us responsible for portal connectivity, nearest-point behaviour, path
corridors, clearance, and every doorway edge case that Detour already models.

The current renderer should therefore stay; the navigation implementation
should graduate from "author a few regions and hope they join" to a generated
and validated navigation product.

## FJD and XGRIDS device pipelines

Both device families can provide a geometry source alongside 3DGS:

- FJD's P2 page lists point clouds, 3D mesh models, and 3D Gaussian Splatting as
  separate deliverables from one scan, and lists LAS, PLY, PTS, and E57 point
  cloud exports. [FJD P2 official product page](https://us.fjdynamics.com/products/fjd-trion-p2-scanner)
- XGRIDS' K2 manual lists real-time point cloud, LAS, Mesh, and 3DGS outputs;
  LixelStudio handles mesh processing while LCC Studio handles 3DGS.
  [XGRIDS K2 official manual](https://docs.xgrids.com/en-us/02-lingguang-k/02-lingguang-k2/v1.2.0/09-faq.html#29-what-output-formats-does-the-k2-support)

The correct adapter contract is therefore:

```text
one registered, metric device scene
  |- 3DGS / SPZ / SOG ------------> Spark visual layer
  `- mesh or point cloud
       -> clean/classify floor, walls, stairs, and obstacles
       -> decimated collision proxy
       -> Recast navmesh for declared agent profile
       -> Detour/runtime navigation artefact
```

The visual and geometry branches must preserve one unit, axis, origin, and
transform. Device geometry is evidence for collision; the splat is not reverse
engineered into a physics surface when better LiDAR/mesh data exists.

One important XGRIDS constraint is already documented: LixelStudio's current
map-merging path cannot output a combined mesh, and its OBJ mesh output is
tiled. A multi-map scene must not be published as continuously walkable until
those tiles/maps have been transformed into one collision proxy and the
resulting topology passes reachability checks.

Source: [XGRIDS LixelStudio official FAQ, mesh generation and merging](https://docs.xgrids.com/en-us/05-lixel-studio/v4.0.1.4/11-faq.html#36-do-k1-and-l2-pro-support-mesh-generation-in-lixelstudio).

## Recommended production pipeline

1. Ingest the visual splat and geometry evidence as two artefacts sharing one
   explicit coordinate transform and metric scale.
2. Build a simplified collision proxy from vendor mesh or classified point
   cloud. Preserve doorway openings; remove scanning noise and transient
   people; do not use a visual Gaussian hull as collision.
3. Generate a Recast navmesh offline using the release's declared agent radius,
   height, maximum step, and maximum slope. Keep generation parameters and
   source hashes in provenance.
4. Export an engine-neutral proxy plus a pinned Detour-compatible navmesh.
   Spark remains the web renderer; web navigation uses a pinned
   `recast-navigation-js` adapter. FJD/XGRIDS/native clients can consume the
   same proxy or generate their platform-native equivalent from it.
5. Retain Studio floor/door/obstacle authoring for corrections and for a
   provisional demo corridor when geometry is missing. Mark such corrections
   as provisional; never silently invent measured geometry.
6. Publish only after deterministic navigation acceptance passes.

## Required publish-time acceptance

A release that claims walking should be rejected unless all of these pass:

- exactly one reachable component covers all intended rooms, or every
  additional component has an explicit, reviewed navigation link and purpose;
- the opening camera pose is on the navmesh with full agent-radius clearance;
- every advertised room target is reachable from the opening pose;
- each doorway has enough clearance for the declared agent radius and remains
  traversable in both directions;
- representative keyboard paths can cross every room-to-room edge without
  nearest-point teleporting or doorway steering outside the proxy;
- obstacles block the agent capsule, while doors and circulation areas do not;
- the floor-plan overlay is generated from the same frozen topology and shows
  every reachable room/connector;
- a headless regression exports connected-component counts, route results, and
  a top-down debug image before the release can become active.

These gates are the material difference between the current demo and an Unreal
scene that a level designer has actually prepared and tested. The renderer is
not the gap; collision-proxy generation, standard navmesh authoring, and release
validation are.
