# Unreal-equivalent navigation pipeline for Spatial Studio

Last verified: 2026-08-01

## Decision

An Unreal-equivalent result does **not** require Unreal Engine, but it does
require the same distinct systems that an Unreal level uses:

1. a visual scene;
2. metric, queryable collision geometry;
3. a Recast navigation build for a declared agent;
4. Detour projection, reachability, and path queries;
5. a swept capsule character controller for physical movement;
6. authored links and dynamic obstacles;
7. frozen, versioned navigation artefacts; and
8. publish-time and runtime debug/acceptance tooling.

Spatial Studio should therefore keep Spark as the Gaussian renderer and add
two standard runtime layers:

- **Recast/Detour** through the pinned `@recast-navigation/*` packages for
  navigation generation and queries; and
- **Rapier's kinematic character controller** for capsule shape-casting,
  collision response, sliding, slopes, and steps.

The browser should run Detour queries and the character controller. A Node
processing job should build the collision and navigation artefacts offline.
The Cloudflare Worker should remain the control plane and release gate; it
should not build a Recast mesh inside an edge request.

This is the web equivalent of putting a Gaussian visual into an Unreal level,
adding collision, covering the play area with `NavMeshBoundsVolume`, building
`RecastNavMesh`, configuring a character capsule, and testing every intended
route. Epic states explicitly that Unreal's navigation mesh is generated from
the world's **collision geometry**, so importing a splat into Unreal would not
remove any of these geometry and validation requirements.

Primary sources:

- [Epic: Basic Navigation, collision geometry and Nav Mesh Bounds Volume](https://dev.epicgames.com/documentation/unreal-engine/basic-navigation-in-unreal-engine?lang=en-US)
- [Epic: Collision Response Reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/collision-response-reference-in-unreal-engine)
- [Recast Navigation: modules and build process](https://github.com/recastnavigation/recastnavigation#recast-navigation)
- [Rapier: kinematic character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/)

## What “Unreal-equivalent” means here

| Unreal capability | Spatial Studio equivalent | Required implementation |
| --- | --- | --- |
| Visible level geometry | Spark `SplatMesh` | Keep the 3DGS/RAD/SPZ/SOG asset visual-only. It must share one versioned transform with the geometry branch. |
| Simple/complex collision on level meshes | Collision Proxy v2 | Ingest a metric vendor mesh or derive one from the registered point cloud; clean and decimate it; publish a content-addressed triangle mesh plus semantic obstacle IDs. Use it as hidden static collision geometry. Epic distinguishes simple collision primitives from complex triangle collision, and warns that a mesh without collision can be walked through. [Epic collision setup](https://dev.epicgames.com/documentation/en-us/unreal-engine/setting-up-collisions-with-static-meshes-in-unreal-engine) |
| `NavMeshBoundsVolume` | Explicit navigation build bounds | Store a Y-up metric AABB/polygon for the playable volume. Never use the splat bounds as an implicit playable volume. |
| `RecastNavMesh` build | Offline `generateTiledNavMesh` | Rasterize the collision triangles, filter agent-inaccessible spans, erode by agent radius, partition regions, and build a tiled Detour mesh. This is the same documented Recast pipeline. [Upstream Recast build stages](https://github.com/recastnavigation/recastnavigation#how-it-works) |
| Supported agent / character capsule | One immutable `AgentProfile` used by every layer | Radius, total height, eye height, maximum climb, maximum slope, speed, acceleration, and query extents must drive Recast voxel settings, Detour queries, and the Rapier capsule. Do not allow the three layers to drift. |
| `CharacterMovementComponent` and capsule sweeps | Rapier kinematic character controller | Run capsule shape casts against the collision proxy, stop at walls, slide, reject penetration, and handle steps/slopes. Recast/Detour is a path planner, not physical collision. Rapier documents `computeColliderMovement`, capsule support, move-and-slide, slopes, steps, and collision events. [Rapier character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/) |
| Nav Link Proxy / Smart Link | Detour off-mesh connection | Use `OffMeshConnectionParams` only for genuine discontinuities such as a jump, lift, or a reviewed missing-geometry transition. Normal open doorways should be continuous navmesh portals. Epic describes Nav Link Proxies as extra connections between areas without a direct navigation path. [Epic navigation links](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-how-to-modify-the-navigation-mesh-in-unreal-engine) |
| Navigation modifier/area costs | Detour polygon area/flags and `QueryFilter` | Encode stairs, restricted areas, closed areas, and traversal costs. The JS binding exposes include/exclude flags and per-area costs. A custom generator is needed because its default high-level generator marks ordinary walkable polygons as area `0`, flag `1`. |
| Dynamic obstacles and closing doors | Rapier collider plus Detour Tile Cache obstacle or disabled link | Physical collision and path availability must change together. `TileCache` supports box/cylinder obstacles and incremental tile rebuilds; a smart/off-mesh link can also be enabled/disabled for a door. [recast-navigation-js temporary obstacles](https://github.com/isaac-mason/recast-navigation-js#temporary-obstacles) |
| Spawn adjustment | Detour projection plus capsule overlap test | Project the authored feet position with `findClosestPoint`, reject projection beyond a configured distance, then prove a full Rapier capsule can occupy the result without overlap. Epic exposes the equivalent `Project Point to Navigation`. [Epic projection API](https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/AI/Navigation/ProjectPointtoNavigation?lang=en-US) |
| Path and reachability query | `NavMeshQuery.computePath` / `findPath` | Every advertised room, route stop, and connector endpoint must have a successful path from the opening spawn. Epic similarly exposes `FindPathSync`, `FindPathAsync`, and the faster `TestPathSync`. [Epic navigation system API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/NavigationSystem/UNavigationSystemV1) |
| Player movement constrained to navigable surface | `NavMeshQuery.moveAlongSurface`, then capsule movement | Constrain desired XZ movement to the current polygon corridor; pass the result through the character controller; finally reproject and reject excessive Detour/physics divergence. |
| `P` navmesh display and collision debug | Recast `DebugDrawerUtils`, Rapier `debugRender`, and floor-plan overlay | Render build intermediates, final portals/polygons, collision wireframe, spawn, room targets, failed paths, and tile/component IDs from the exact frozen release artefacts. Epic's basic guide uses `P` to show the generated mesh. [Epic navmesh visualization](https://dev.epicgames.com/documentation/unreal-engine/basic-navigation-in-unreal-engine?lang=en-US) |
| Cooked navigation data | Content-addressed exported Detour bytes | Use `exportNavMesh(navMesh): Uint8Array` and `importNavMesh(bytes)`. Record the binding version, native fork commit, build configuration, input hash, and an artefact schema version. |
| World Partition navigation chunks | Tiled navmesh and optional Tile Cache chunks | Small indoor releases may load one exported tiled mesh. Large sites need a tile manifest and controlled `NavMesh.addTile`/`removeTile` or Tile Cache loading. Upstream identifies tiled meshes and `DetourTileCache` as the path to rebaking and navigation streaming. [Recast tiled navigation](https://github.com/recastnavigation/recastnavigation#how-it-works) |

## Current package selection and exact interfaces

### Recast/Detour

Pin these exact ESM packages at `0.43.1` initially:

```json
{
  "@recast-navigation/core": "0.43.1",
  "@recast-navigation/generators": "0.43.1",
  "@recast-navigation/wasm": "0.43.1"
}
```

The repository's current package manifests identify all three as version
`0.43.1`; `core` depends on the matching WASM package and `generators` depends
on both. The umbrella `recast-navigation@0.43.1` package is convenient, but the
scoped packages keep the offline generator out of the viewer bundle.

Sources:

- [`@recast-navigation/core` package manifest](https://raw.githubusercontent.com/isaac-mason/recast-navigation-js/main/packages/recast-navigation-core/package.json)
- [`@recast-navigation/generators` package manifest](https://raw.githubusercontent.com/isaac-mason/recast-navigation-js/main/packages/recast-navigation-generators/package.json)
- [`@recast-navigation/wasm` package manifest](https://raw.githubusercontent.com/isaac-mason/recast-navigation-js/main/packages/recast-navigation-wasm/package.json)
- [Official repository installation and environment support](https://github.com/isaac-mason/recast-navigation-js#installation)

The binding is community-maintained, not an official upstream Recast package.
Its build currently checks out Isaac Mason's Recast fork at commit
`599fd0f023181c0a484df2a18cf1d75a3553852e`, so provenance must record both the
NPM version and that native source commit. The binding is MIT-licensed; the
embedded native Recast/Detour source is zlib-licensed.

Sources:

- [WASM build script and pinned native commit](https://raw.githubusercontent.com/isaac-mason/recast-navigation-js/main/packages/recast-navigation-wasm/build.sh)
- [recast-navigation-js MIT licence](https://raw.githubusercontent.com/isaac-mason/recast-navigation-js/main/LICENSE)
- [upstream Recast/Detour zlib licence](https://raw.githubusercontent.com/recastnavigation/recastnavigation/main/License.txt)

The supported high-level interface is:

```ts
import {
  init,
  exportNavMesh,
  importNavMesh,
  NavMeshQuery,
  QueryFilter,
} from "@recast-navigation/core";
import {
  generateTiledNavMesh,
  generateTileCache,
} from "@recast-navigation/generators";

await init();

const build = generateTiledNavMesh(positions, indices, config);
if (!build.success) throw new Error(build.error);

const bytes = exportNavMesh(build.navMesh);
const { navMesh } = importNavMesh(bytes);
const query = new NavMeshQuery(navMesh, { maxNodes: 4096 });

const projected = query.findClosestPoint(worldPosition, {
  halfExtents: { x: 0.5, y: 1.0, z: 0.5 },
});
const route = query.computePath(projected.point, target);
const constrained = query.moveAlongSurface(
  projected.polyRef,
  projected.point,
  desiredPosition,
);
```

The official package exposes:

- `generateSoloNavMesh` for small static scenes;
- `generateTiledNavMesh` for larger or streamable scenes;
- `generateTileCache` for temporary obstacles;
- `OffMeshConnectionParams` with start/end, radius, direction, area, flags,
  and user ID;
- `NavMeshQuery.findClosestPoint`, `computePath`, `findPath`,
  `findStraightPath`, `moveAlongSurface`, `raycast`, and height queries;
- `QueryFilter` include/exclude flags and area costs;
- `exportNavMesh`, `importNavMesh`, `exportTileCache`, and
  `importTileCache`; and
- `DebugDrawerUtils` for Recast intermediates and Detour navmesh primitives.

The repository documents right-handed coordinates, counter-clockwise triangle
winding, flat position/index arrays, browser and Node ESM support, Web Worker
generation, offline export/import, and individual tile transfer. [Official
recast-navigation-js overview and usage](https://github.com/isaac-mason/recast-navigation-js#overview)

### Unit conversion is mandatory

The high-level generator's `RecastConfig` fields mix world and voxel units.
`cs` and `ch` are world-unit voxel dimensions, while `walkableHeight`,
`walkableClimb`, and `walkableRadius` are voxel counts. Its generator uses those
counts directly during filtering/erosion, then multiplies them by `ch` or `cs`
when writing Detour metadata. Therefore the adapter must derive, not copy, the
profile fields:

```ts
const config = {
  cs,
  ch,
  walkableHeight: Math.ceil(agent.height / ch),
  walkableClimb: Math.floor(agent.maxClimb / ch),
  walkableRadius: Math.ceil(agent.radius / cs),
  walkableSlopeAngle: agent.maxSlopeDegrees,
  tileSize: 64,
  // contour/detail/region settings are versioned build policy
};
```

Passing the current `0.22 m` radius directly as `walkableRadius: 0.22` would
mean less than one voxel of erosion and would repeat the doorway-clearance
mistake in a different implementation. The units and build sequence are visible
in the package's own generator source. [Official generator source](https://raw.githubusercontent.com/isaac-mason/recast-navigation-js/main/packages/recast-navigation-generators/src/generators/generate-tiled-nav-mesh.ts)

### Character collision

Recast/Detour does not replace an Unreal character capsule. The implemented
browser adapter pins `@dimforge/rapier3d-compat@0.19.3`. Rapier's official JS
guide exposes a kinematic
character controller that performs the move-and-slide shape casts, supports
capsules, stairs, slopes, collision events, and moving platforms. Its official
JS package is Apache-2.0. The compatibility variant embeds WASM in the lazy
physical-navigation chunk, which is operationally simple but currently costs
about 857 KiB gzip. A device/browser performance slice should evaluate the
separate-WASM package so the binary can be cached independently.

Sources:

- [Rapier JavaScript character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/)
- [Rapier colliders, including capsule and triangle mesh](https://rapier.rs/docs/user_guides/javascript/colliders/)
- [Rapier shape casting](https://rapier.rs/docs/user_guides/javascript/scene_queries/)
- [Rapier JS installation and WASM variants](https://rapier.rs/docs/user_guides/templates/getting_started_js/)
- [Rapier Apache-2.0 licence](https://raw.githubusercontent.com/dimforge/rapier.js/master/LICENSE)

This is the material layer needed to match Unreal collision behavior; Detour
Crowd is agent steering/avoidance, not a substitute for physical capsule
collision.

## Browser, Node, WASM, and Cloudflare compatibility

| Environment | Status | Decision |
| --- | --- | --- |
| Node processing job | **Supported upstream** | Build the collision proxy and Recast/Detour artefacts here. Call `init()` once per process, generate tiled navmesh, export bytes, emit debug geometry and attestations, and dispose native objects. |
| Browser main thread | **Supported upstream** | Import the frozen navmesh and query it. Avoid building the mesh at viewer startup. Load Rapier and collision proxy once, then move the capsule at a fixed step. |
| Browser Web Worker | **Supported by an upstream example** | Optional for expensive validation or tile loading. The official repo describes transferring `exportNavMesh`/`importNavMesh` bytes between a worker and the main thread. |
| Cloudflare Worker | **Not drop-in; do not use for the build** | Cloudflare supports Wasm, but only precompiled modules. It forbids `WebAssembly.compile`, streaming compilation, and instantiating from a raw buffer, and it does not provide the browser Web Worker API. The package's default Emscripten loader uses streaming or `WebAssembly.instantiate(binary, imports)`. A custom `init(impl)` loader may be possible, but it is unproven and unnecessary for this architecture. |

Cloudflare also limits Worker memory to 128 MB, compressed script size to 3 MB
on Free or 10 MB on Paid, and CPU to 10 ms on Free or a configurable maximum on
Paid. Recast voxelization of a scanner mesh should not run in an HTTP request.
The Worker should instead verify content hashes, required metadata, and signed
processing attestations before freezing an R2 artefact into a release.

Sources:

- [Cloudflare WebAssembly runtime constraints](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)
- [Cloudflare JavaScript/WebAssembly restrictions](https://developers.cloudflare.com/workers/runtime-apis/web-standards/)
- [Cloudflare Worker limits](https://developers.cloudflare.com/workers/platform/limits/)
- [recast-navigation-js browser/Node and worker support](https://github.com/isaac-mason/recast-navigation-js#overview)

## V6 artefact contract and target extensions

The implemented processor freezes the Detour bytes and the complete JSON
build/validation report as immutable assets and references the exact verified
collision GLB. The final navigation triangles are embedded in the signed JSON
report for runtime and floor-plan/debug use. The target directory form below
adds a dedicated debug GLB and optional tile-cache payload:

```text
navigation-v6/
  manifest.json
  collision.glb                  # metric Y-up hidden collision proxy
  navmesh.detour.bin             # exportNavMesh output
  navmesh-debug.glb              # final polygons, boundaries and portals
  build-report.json              # logs, counts, bounds and component evidence
  reachability.json              # spawn -> every room/route/link, both directions
  optional-tile-cache.detour.bin # only when dynamic path obstacles are required
```

`manifest.json` must include:

- source mesh and visual asset IDs plus SHA-256 hashes;
- one reviewed source-to-world transform, up axis, handedness, world unit, and
  scale evidence shared by both assets;
- collision-proxy algorithm/version and triangle count;
- `AgentProfile` and the fully derived Recast config;
- navigation bounds;
- exact `@recast-navigation/*` versions and native fork commit;
- Rapier version and capsule parameters;
- room/door/off-mesh-link IDs and nav area flags;
- per-artefact hashes and byte lengths;
- connected-component count;
- projected opening spawn and projection distance;
- reachability and bidirectional-door results; and
- a provisional flag and limitation text when any connector is inferred rather
  than measured.

The Detour binary is a runtime artefact, not the canonical interchange format
with Unreal or a device. Native clients should receive the collision GLB and
agent/build metadata and generate their own engine-native nav data. The binary
must only be imported by a compatible adapter version; a version change should
rebuild it from the canonical collision mesh.

## Required processing stages

1. **Ingest and register both branches.** Require the visual splat and a mesh or
   point cloud from the same capture. Convert to canonical right-handed, Y-up,
   metric coordinates. Reject silent independent recentring/scaling.
2. **Build Collision Proxy v2.** Remove people, scan noise, floating fragments,
   and invisible duplicate surfaces; preserve walls, floors, furniture, stair
   risers, and real doorway openings; decimate to a bounded triangle budget.
   Emit a reviewable GLB.
3. **Author/correct semantics.** Label floors, rooms, doors, restricted areas,
   stairs, lifts, and dynamic objects. Hand-authored regions remain a correction
   tool, not the primary collision source.
4. **Build Recast offline.** Use collision triangles, explicit bounds, and the
   single declared agent profile. Prefer tiled generation even for the indoor
   implementation so the artefact format has a path to site-scale streaming.
5. **Attach navigation semantics.** Continuous doorway portals remain ordinary
   navmesh. Use area flags/costs for traversable classes and off-mesh links only
   for genuine discontinuities.
6. **Instantiate physical collision.** Load the same proxy as static Rapier
   triangle/convex colliders; instantiate the kinematic agent capsule.
7. **Prove the spawn.** Detour-project the opening position, enforce a maximum
   projection distance, test capsule occupancy, and save the resolved feet and
   eye poses.
8. **Prove reachability.** Run Detour paths from spawn to every room and route
   stop and in both directions across every connector. Fail on partial paths,
   component islands, excessive detours, or inadequate doorway clearance.
9. **Prove physical traversal.** Replay keyboard-sized movements along the
   returned path corridor through the Rapier character controller. Reaching a
   target by Detour while the capsule is blocked is a failed build.
10. **Emit debug artefacts.** Include collision wireframe, final navmesh,
    rejected spans, component colors, spawn, room targets, links, and failed
    path segments. The published floor plan must derive from this frozen result.
11. **Publish fail-closed.** The Worker verifies hashes, schema, package/build
    provenance, and all attestations before a release can claim walking.

## Runtime movement contract

For each fixed movement step:

1. convert keyboard/controller input to a desired planar displacement;
2. use the current polygon and `moveAlongSurface` to clamp it to the Detour
   surface;
3. apply gravity/grounding and give the constrained displacement to Rapier's
   `computeColliderMovement`;
4. move the capsule by the corrected translation and derive the camera from
   capsule feet plus eye height;
5. update the current Detour polygon with a tightly bounded nearest-poly query;
6. reject/resync if the physics position cannot be projected within tolerance;
7. never teleport to a distant component as a nearest-point fallback.

Room buttons and routes must first call `computePath`. A room is selectable
only if the path is complete. A camera cut may remain available as an explicitly
labelled teleport mode, but it is not evidence that the room is walkable.

## FJD and XGRIDS input contract and gaps

### FJD

FJD's P2 page lists point cloud, floor plan, 3D mesh, 3DGS, and panoramas as
separate deliverables from one scan. It explicitly lists LAS, PLY, PTS, and E57
point-cloud exports. This is enough to establish a geometry branch alongside
3DGS, but the page does **not** specify the mesh file format or a machine-readable
manifest proving that mesh and 3DGS use exactly the same origin, axis, and
scale. [FJD Trion P2 official product page](https://us.fjdynamics.com/products/fjd-trion-p2-scanner)

Before the FJD adapter can be production-ready, obtain a representative export
bundle and document:

- mesh format and tiled/monolithic behavior;
- coordinate reference system, unit, axis, origin, and any global offset;
- visual-to-mesh registration transform;
- stable IDs/checksums across re-export;
- material/texture sidecars;
- floor/stair/door retention after meshing; and
- commercial rights to process and redistribute derived collision artefacts.

### XGRIDS

The K2 manual states that K2 outputs real-time point cloud, post-processed LAS,
Mesh, and 3DGS; LixelStudio handles point cloud/mesh and LCC Studio handles
3DGS. [XGRIDS K2 official manual](https://docs.xgrids.com/en-us/02-lingguang-k/02-lingguang-k2/v1.2.0/09-faq.html#29-what-output-formats-does-the-k2-support)

The current LixelStudio FAQ adds two material constraints:

- map merging cannot output a combined mesh; and
- OBJ mesh output is tiled and cannot be merged inside LixelStudio.

Therefore a multi-map XGRIDS scene needs an external, deterministic tile/map
merge into one canonical collision frame before Recast. A fused 3DGS alone is
not enough. [XGRIDS LixelStudio mesh and merging FAQ](https://docs.xgrids.com/en-us/05-lixel-studio/v4.0.1.4/11-faq.html#36-do-k1-and-l2-pro-support-mesh-generation-in-lixelstudio)

For K1/L2 Pro, the same FAQ states that mesh generation requires a compatible
LixelStudio version and panoramic-photo output during coloring. The adapter
preflight should inspect those expected sidecars instead of accepting a LAS
file and later discovering that no viable mesh can be generated.

### Shared vendor gaps

The official vendor pages prove that geometry outputs exist; they do not prove
collision quality. Production acceptance still needs real bundles covering:

- narrow doors, reflective glass, stairs, furniture legs, moving people, and
  two connected rooms;
- visual/mesh transform agreement;
- sufficient floor and wall continuity after decimation;
- doorway openings not accidentally filled by surface reconstruction;
- metric scale and vertical direction; and
- multi-segment capture merging.

## Implemented static-indoor V6 baseline

The repository now implements the core static-level equivalent:

1. the processor accepts only embedded binary glTF 2.0 collision assets, applies
   transforms and mirrored winding, and enforces byte, vertex, and triangle
   limits;
2. tiled Recast generation derives voxel clearance, height, climb, slope, and
   border settings from one immutable agent profile;
3. Detour projects the authored floor-level spawn, verifies one traversable
   component, and proves complete outbound and inbound paths for every room and
   route-stop destination;
4. offline Rapier validation rejects spawn penetration and replays both route
   directions with the production kinematic capsule;
5. the browser imports the frozen Detour bytes, constrains arrow-key movement
   with `moveAlongSurface`, then applies Rapier move-and-slide against the exact
   collision GLB;
6. room camera requests require a complete Detour path and collision-safe
   placement; a distant component is never accepted as a teleport fallback;
7. the control plane hashes the profile, walkable/doorway geometry, obstacles,
   and route-stop cameras, and accepts processor evidence only for the leased
   collision asset ID and SHA;
8. an operator must approve the completed build, and publication and rollback
   both fail closed unless that exact current artifact and collision SHA remain
   available; and
9. automated acceptance covers disconnected rooms, a collision-blocked
   doorway, blocked spawn, external-resource GLBs, two-tab refresh rotation,
   and real browser Arrow-Up traversal through a narrow two-room connector.

The V5 authored polygons remain as a semantic/floor-plan compatibility layer.
When a V6 artifact is present, they no longer decide whether physical walking
is enabled.

## Remaining technical gaps

1. **Device input contract:** no real FJD or XGRIDS paired mesh-plus-3DGS bundle
   has yet proved a shared origin, axis, metric scale, and stable registration.
   This is the blocking input gap for automatic device publishes.
2. **DJI-derived collision quality:** the current DJI collision candidate is a
   splat/photogrammetry derivative in provisional scene units. Its V6 preflight
   correctly reports seven disconnected components, so it must not be
   published as walkable.
3. **Collision Proxy v2 automation:** the runtime accepts a verified GLB, but
   automated mesh cleanup/decimation and semantic preservation from raw vendor
   point clouds is not yet a complete production adapter.
4. **Human debug review:** Studio lists the evidence and requires approval, but
   it does not yet render the frozen navmesh, collision wireframe, failed paths,
   component colors, and clearance overlays before approval.
5. **Dynamic navigation:** closing doors, moving obstacles, elevators, jumps,
   and stairs requiring special traversal need Tile Cache/area flags and an
   explicit browser traversal state machine. V6 rejects off-mesh links rather
   than certifying unsupported traversal.
6. **Large worlds and agents:** the baseline loads one complete navmesh and one
   agent profile. It has no world-partition tile streaming, multiple agent
   builds, crowds, or networked authoritative movement.
7. **Derived floor plan:** the published floor plan still uses authored semantic
   regions; it should be reconciled with the final radius-cleared navmesh so the
   displayed reachable area cannot disagree with the certified surface.
8. **Target hardware performance:** the lazy Rapier compatibility chunk is
   about 857 KiB gzip. FJD/XGRIDS browser/device adapters need measured load,
   memory, frame-time, and WebGL/WASM compatibility budgets.
9. **Metric assurance:** provisional scene units remain intentionally relative
   and are not construction, accessibility, clearance, or survey evidence.

## Implementation slices and exit criteria

### Slice 1 — Standard offline Recast artefact — implemented baseline

- Add the pinned scoped Recast packages only to the Node processor.
- Accept a small metric GLB triangle fixture.
- Derive voxel counts from one immutable agent profile.
- Export/import a tiled Detour mesh and final debug GLB.
- Prove exact paths from spawn to two rooms through a doorway.

Exit: deterministic artefact hashes on repeated builds, one reachable
component, and no path through a wall.

### Slice 2 — Browser Detour movement — implemented baseline

- Load the frozen binary in the viewer.
- Replace triangle inset/rotated-doorway heuristics with bounded projection,
  `moveAlongSurface`, and `computePath`.
- Derive floor plan and room availability from the frozen nav result.

Exit: keyboard movement crosses every certified doorway without steering
assistance, and an island target is unavailable rather than teleported to.

### Slice 3 — Capsule collision parity — implemented baseline

- Load Collision Proxy v2 into Rapier.
- Add the kinematic capsule and fixed-step move-and-slide controller.
- Synchronize Detour constraint and physical collision.
- Add wall, L-table, narrow-door, step, slope, and low-ceiling tests.

Exit: no tunnelling at the maximum allowed frame delta, no camera penetration,
and Detour-positive/Rapier-blocked paths fail publication.

### Slice 4 — Doors, links, and dynamic obstacles — remaining

- Add areas/flags/query filters.
- Model real doors as physical colliders plus Tile Cache obstacle or link state.
- Defer reviewed off-mesh connections until the browser has an explicit link
  traversal controller; v6 rejects them instead of certifying a link that
  `moveAlongSurface` cannot traverse.

Exit: closing a door blocks both pathfinding and capsule movement; reopening it
restores both; one-way links remain one-way.

### Slice 5 — Vendor adapters — remaining

- Validate one FJD and one XGRIDS paired geometry/3DGS bundle.
- Preserve a single metric transform.
- Merge XGRIDS mesh tiles/maps externally where required.
- Run the complete build and acceptance report.

Exit: a real connected multi-room device capture publishes with no manual
walkable floor polygons other than reviewed corrections.

### Slice 6 — Release and operations — partially implemented

- Freeze hashes and attestations in the release snapshot.
- Add top-down debug-image and reachability evidence to Studio review.
- Gate activation on spawn, component, room-path, doorway-clearance, physical
  replay, and floor-plan consistency.
- Add whole-artefact caching first; implement tile streaming only when measured
  scene size requires it.

Exit: the release pipeline cannot label a scene “walkable” unless the exact
published artefacts pass every acceptance check.

## Bottom line

The renderer is not the limiting tool. Spark + Recast/Detour + Rapier now closes
the static indoor planning, collision, movement, and release-gating gap. It is
the browser equivalent of a cooked static Unreal level, not full Unreal Engine
feature parity. The largest remaining external uncertainty is the quality and
registration contract of the vendors' mesh outputs, especially multi-map
XGRIDS mesh merging; the largest product gap is reviewable frozen navigation
debug evidence before an operator approves a build.
