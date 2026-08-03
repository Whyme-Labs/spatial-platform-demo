# Unreal-style walkability and automatic walking evidence

Last verified: 2026-08-03

## Scope and conclusion

This review uses current Epic documentation and API references, upstream
Recast/Detour documentation and source, Rapier documentation, and this
repository's implementation. It does not rely on marketplace tutorials or
third-party summaries.

The result is unambiguous: **walking evidence should normally be generated
automatically, but only after intake has supplied registered structural
geometry.** Unreal Engine automates navigation from collision; it does not
infer reliable collision, doors, stairs, or playable intent from a rendered
Gaussian splat.

The game-like stack is:

```text
render geometry or Gaussian splat          visual only
                 |
registered structural geometry             metric physical source
                 |
collision geometry                         blocks/supports the player
                 |
Recast NavMesh + Detour queries             routes/reachability/topology
                 |
capsule character controller                actual keyboard movement
                 |
links + modifiers + dynamic state           doors/lifts/jumps/platforms
```

Spatial Studio already uses the correct families of tools: Spark for the
visual, Recast/Detour for navigation, and Rapier for physical movement and
validation. The remaining hard problem is not NavMesh generation. It is
automatically producing a trustworthy, registered, semantically classified
structural world from FJD capture evidence.

## How Unreal Engine produces game walkability

### 1. Import the visible world and establish collision

Unreal treats rendering and collision as separate concerns. A Static Mesh can
have collision bodies imported from the authoring package or generated in the
Static Mesh Editor. Epic's FBX pipeline recognizes authored box, capsule,
sphere, and convex collision by `UBX_`, `UCP_`, `USP_`, and `UCX_` names and
turns those helper meshes into collision models rather than visible geometry.
The FBX importer can also auto-generate collision. Complex collision can use
the render triangle mesh for queries, while simple collision uses primitives
or convex hulls. Unreal's Auto Convex tool uses V-HACD to decompose a mesh into
convex hulls. These are explicit choices, not properties of appearance.

Sources:

- [Epic: FBX Static Mesh Pipeline and custom collision naming](https://dev.epicgames.com/documentation/unreal-engine/fbx-static-mesh-pipeline-in-unreal-engine)
- [Epic: FBX import option `Auto Generate Collision`](https://dev.epicgames.com/documentation/unreal-engine/fbx-import-options-reference-in-unreal-engine?lang=en-US)
- [Epic: Auto Convex Collision and V-HACD](https://dev.epicgames.com/documentation/unreal-engine/add-a-collision-hull-to-a-static-mesh-using-the-auto-convex-collision-tool-in-unreal-engine)
- [Epic: Simple versus Complex Collision](https://dev.epicgames.com/documentation/unreal-engine/simple-versus-complex-collision-in-unreal-engine)
- [Epic: Setting Up Collisions With Static Meshes](https://dev.epicgames.com/documentation/unreal-engine/setting-up-collisions-with-static-meshes-in-unreal-engine?lang=en-US)

Epic's collision guide demonstrates the consequence directly: a visible door
with no collision can be walked through. Therefore a Gaussian splat that looks
like a wall is not a wall to the game. Unreal would still need an invisible
collision representation.

Collision response is also semantic. Unreal classifies objects into collision
channels/profiles and lets a query `Block`, `Overlap`, or `Ignore` them. Its
`Pawn` profile is intended for a playable capsule; `WorldStatic` represents
nonmoving level geometry. This is how a project can block walls while ignoring
decorative or non-gameplay objects.
[Epic: Collision Response Reference](https://dev.epicgames.com/documentation/en-us/unreal-engine/collision-response-reference-in-unreal-engine)

### 2. Bound the playable build and generate the Recast NavMesh

Epic states that Unreal's Navigation System generates a NavMesh from the
level's **collision geometry**, divides it into tiles, divides tiles into
polygons, and uses those polygons as a costed pathfinding graph. A
`NavMeshBoundsVolume` says where navigation may be generated. Adding or
resizing that volume triggers the build in the editor.

Sources:

- [Epic: Navigation System](https://dev.epicgames.com/documentation/unreal-engine/navigation-system-in-unreal-engine?lang=en-US)
- [Epic: Basic Navigation and `NavMeshBoundsVolume`](https://dev.epicgames.com/documentation/unreal-engine/basic-navigation-in-unreal-engine?lang=en-US)

The bounds volume is an authoring boundary, not a reconstruction algorithm. It
does not declare everything inside the box walkable. Recast evaluates the
collision surfaces within the box. It also does not prove that the entire scan
should be playable; a level designer still decides the intended play area.

Upstream Recast documents the underlying algorithm:

1. rasterize input triangles into a voxel heightfield;
2. filter spans the declared agent cannot occupy or traverse;
3. partition remaining walkable spans into regions; and
4. contour and polygonize those regions into a navigation mesh.

[Upstream Recast Navigation: modules and build process](https://github.com/recastnavigation/recastnavigation#how-it-works)

This is a 3D surface representation, not a volumetric free-flight map. It can
contain surfaces at several elevations and tile layers, but paths follow
walkable surfaces. Detour's `moveAlongSurface` explicitly constrains movement
to the navigation mesh.
[Upstream Detour `dtNavMeshQuery`](https://recastnav.com/classdtNavMeshQuery.html)

### 3. Build for a declared agent

The NavMesh is not universally walkable. Unreal's Recast settings include cell
size and height, agent radius and height, maximum slope, maximum step height,
region policy, and contour/detail policy. The agent radius removes clearance
near obstacles; height removes low-clearance spans; step and slope decide
which neighboring surfaces connect.
[Epic: Navigation Mesh settings](https://dev.epicgames.com/documentation/unreal-engine/navigation-mesh-settings-in-the-unreal-engine-project-settings?lang=en-US)

Upstream `rcConfig` makes the same rules precise:

- `walkableHeight` is the required floor-to-ceiling clearance;
- `walkableClimb` is the maximum traversable ledge/step;
- `walkableRadius` erodes walkable cells away from obstacles; and
- `walkableSlopeAngle` rejects surfaces too steep for the agent.

It also distinguishes world units from voxel units. Height and climb are
derived using vertical cell height; radius is derived using horizontal cell
size. Copying a metric radius directly into a voxel-count field would be an
incorrect build.
[Upstream Recast `rcConfig`](https://recastnav.com/structrcConfig.html)

This agent profile must agree with the actual player controller. Unreal exposes
navigation-agent radius, height, and step height separately from
`UCharacterMovementComponent`'s capsule, `MaxStepHeight`, and
`WalkableFloorAngle`. Unreal provides the parameters; the project is
responsible for keeping their intent aligned.

Sources:

- [Epic: `FNavAgentProperties`](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/FNavAgentProperties?lang=en-US)
- [Epic: `UCharacterMovementComponent`](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/UCharacterMovementComponent)

### 4. Move the player with a capsule, not with the NavMesh

An Unreal `ACharacter` contains a `UCapsuleComponent` used for movement
collision and a `UCharacterMovementComponent` used for walking, falling,
flying, and other movement modes. Its movement code performs floor sweeps,
step-up logic, sliding, and penetration handling. This is a separate runtime
system from AI pathfinding.

Sources:

- [Epic: `ACharacter`](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/ACharacter?lang=en-US)
- [Epic: `UCapsuleComponent`](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UCapsuleComponent)
- [Epic: `UCharacterMovementComponent::FindFloor` and `StepUp`](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/UCharacterMovementComponent)
- [Epic: `UMovementComponent` collision utilities](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/GameFramework/UMovementComponent?application_version=5.5)

This distinction matters for Spatial Studio:

- keyboard Walk movement should be a capsule swept against structural
  collision;
- Detour should prove reachability, provide guided routes, and project targets;
  and
- Fly should be a collision-constrained 3D controller, not a larger NavMesh.

A green NavMesh alone does not prove a player capsule cannot pass through a
wall, snag on a collision seam, tunnel through a corner, or fail on the same
stairs. Physical replay is separate evidence.

### 5. Stairs and multiple floors

Recast's compact heightfield may contain multiple walkable spans at the same
horizontal location, its layer set explicitly represents multiple layers, and
Detour tiles carry vertical layer data. Ordinary ramps and stairs
work without a special teleport when collision forms a continuous sequence of
surfaces satisfying the declared slope, step, clearance, and radius policy.
Epic's basic navigation example shows the generated NavMesh over stairs, while
Recast documents that `walkableClimb` lets the mesh flow over stairs and that
smaller vertical cells improve precision around steps and curbs.

Sources:

- [Epic: Basic Navigation stair visualization](https://dev.epicgames.com/documentation/unreal-engine/basic-navigation-in-unreal-engine?lang=en-US)
- [Upstream Recast `walkableClimb` and cell-height behavior](https://recastnav.com/structrcConfig.html)
- [Upstream Recast `rcCompactHeightfield`](https://recastnav.com/structrcCompactHeightfield.html)
- [Upstream Recast `rcHeightfieldLayerSet`](https://recastnav.com/structrcHeightfieldLayerSet.html)
- [Upstream Detour tile layer field](https://recastnav.com/structdtNavMeshCreateParams.html)

Therefore multiple floors are not a separate “2D map per building” limitation.
They are multiple connected 3D surfaces. A staircase or ramp connects floors
continuously when the captured collision supports it. A lift, ladder, jump,
teleport, moving platform, or missing stair geometry is discontinuous and needs
an explicit traversal link and behavior.

### 6. Discontinuities, semantic areas, and dynamic obstacles

Unreal uses Navigation Modifier Volumes and area classes to change polygon
costs or exclude an area. It uses `ANavLinkProxy` to connect navigation regions
with no direct path. Simple links are static; smart-link state can be changed
without rebuilding the NavMesh. Recent Unreal versions also have experimental
automatic link generation for configured jump/drop behavior, but Epic cautions
about shipping that feature and describes it primarily for jumping or falling.

Sources:

- [Epic: Modifying the Navigation Mesh](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-how-to-modify-the-navigation-mesh-in-unreal-engine)
- [Epic: `ANavLinkProxy`](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/AIModule/ANavLinkProxy)
- [Epic: Automatic Navigation Link Generation](https://dev.epicgames.com/documentation/unreal-engine/automatic-navigation-link-generation)

Upstream Detour represents the equivalent as off-mesh connections with
endpoints, radius, area, flags, direction, and a user ID. They are explicitly
described as user-defined traversable edges. Recast cannot infer “this gap is
an elevator” from triangles.
[Upstream Detour off-mesh connection parameters](https://recastnav.com/structdtNavMeshCreateParams.html)

For runtime changes, Unreal exposes three generation modes:

- **Static**: build offline, save with the level, and do not change at runtime;
- **Dynamic**: rebuild affected navigation tiles as navigation-relevant
  geometry changes; and
- **Dynamic Modifiers Only**: keep the surface build and apply modifier/link/
  obstacle changes without generating new surfaces.

[Epic: Runtime Navigation Mesh generation modes](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-how-to-modify-the-navigation-mesh-in-unreal-engine)

Upstream `dtTileCache` is the direct Recast/Detour mechanism for local dynamic
obstacles. Its source accepts cylinder, axis-aligned box, and Y-rotated box
obstacles, then rebuilds tiles touched by queued obstacle changes.
[Upstream `DetourTileCache.h`](https://github.com/recastnavigation/recastnavigation/blob/main/DetourTileCache/Include/DetourTileCache.h)

The physical and navigation states must change together. A closed door needs a
blocking collision object and an unavailable/high-cost path; an open door needs
both removed or enabled consistently. Updating only one layer produces either
an invisible physical wall or a route through a closed door.

### 7. Build-time and runtime validation

Unreal provides diagnostics, not an immutable acceptance receipt. In the editor
the `P` key displays the NavMesh. Recast settings can retain and display tile
generation intermediates such as rasterized heightfields, radius/height
filtering, compact heightfields, regions, contours, and final polygons. Unreal
also exposes failed-link drawing, tile labels/bounds, AI path debugging,
`show Navigation`, and `show COLLISION`.

Sources:

- [Epic: Navigation Mesh settings and tile-generation debug](https://dev.epicgames.com/documentation/unreal-engine/navigation-mesh-settings-in-the-unreal-engine-project-settings?lang=en-US)
- [Epic: AI Debugging](https://dev.epicgames.com/documentation/unreal-engine/ai-debugging-in-unreal-engine?lang=en-US)
- [Epic: Review Collision in Your Game](https://dev.epicgames.com/documentation/en-us/unreal-engine/review-collision-in-your-unreal-engine-game)

`UNavigationSystemV1` exposes point projection and synchronous/asynchronous path
queries. Those APIs can prove that selected targets project to the intended
NavMesh and have a path, but the application must decide which spawns, rooms,
doors, floors, and routes must be tested.
[Epic: `UNavigationSystemV1`](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/NavigationSystem/UNavigationSystemV1)

Upstream Recast/Detour supplies equivalent debug drawing, nearest-polygon,
path, straight-path, surface movement, raycast, wall-distance, and portal
queries.

Sources:

- [Upstream `dtNavMeshQuery`](https://recastnav.com/classdtNavMeshQuery.html)
- [Upstream Detour debug drawing source](https://github.com/recastnavigation/recastnavigation/blob/main/DebugUtils/Include/DetourDebugDraw.h)

For large worlds, Unreal can freeze navigation data in streamable World
Partition chunks; dynamic modes rebuild only loaded or affected space. The web
equivalent is content-addressed tiled navigation built offline, then loaded as
needed—not rebuilding a whole scanner mesh in a browser request.
[Epic: World Partitioned Navigation Mesh](https://dev.epicgames.com/documentation/unreal-engine/world-partitioned-navigation-mesh)

## Recast/Detour and Rapier equivalents in Spatial Studio

| Unreal responsibility | Web equivalent | Evidence it should emit |
| --- | --- | --- |
| Static/complex collision | Registered structural GLB loaded as Rapier trimesh and Recast source | geometry hash, transform, semantic groups, bounds, topology checks |
| `NavMeshBoundsVolume` | Explicit build bounds derived from accepted structural/playable extent | bound provenance and exact coordinates |
| `RecastNavMesh` | `generateTiledNavMesh` from pinned `@recast-navigation/*` | full Recast config, generator/native version, input/output hashes |
| Navigation queries | Detour projection, path, portal, surface, and filter queries | projected distances, complete bidirectional paths, unreachable IDs |
| Character capsule | Rapier kinematic capsule controller | collision-constrained route replay and runtime movement profile |
| Step/slope/floor movement | Rapier autostep, slope limits, ground snapping, gravity supplied by application | physical replay over stairs/ramps and ground-contact results |
| Collision channels | Rapier collision groups or controller filters | declared structural/furniture/dynamic masks |
| Nav link/smart link | Detour off-mesh connection plus authored traversal behavior | direction, endpoints, radius, state, controller replay |
| Dynamic obstacle | Rapier collider plus Detour tile-cache obstacle or link/area state | matched open/closed physical and path tests |
| `P`/collision debug | Frozen collision/nav overlays and validation report | exact release-bound debug artifact |

Rapier's official character controller performs the relevant shape casts for
move-and-slide, obstacles, stairs, slopes, ground snap, and moving platforms.
It accepts a desired translation and returns the corrected translation. Gravity
is deliberately supplied by the application. It can filter obstacles through
flags, collision groups, or a predicate. Rapier's collider documentation also
exposes triangle meshes/heightfields and an internal-edge correction flag for
reducing artificial contacts on connected triangle-mesh faces; mesh cleanup
and physical replay are therefore still required rather than assuming any raw
scanner triangles will feel game-ready.

Sources:

- [Rapier: Kinematic Character Controller](https://rapier.rs/docs/user_guides/javascript/character_controller/)
- [Rapier: Colliders](https://rapier.rs/docs/user_guides/javascript/colliders/)
- [Rapier: Collision groups](https://rapier.rs/docs/user_guides/javascript/collider_collision_groups/)
- [Rapier: Scene queries and filters](https://rapier.rs/docs/user_guides/javascript/scene_queries/)

Recast/Detour decides where an agent can route; Rapier decides whether the
actual body can move there. Neither replaces the other.

## What walking evidence can be generated automatically

Automatic generation is justified when the input includes a visual asset and
registered metric structural geometry in the same coordinate frame, with
gravity/up, unit scale, and exact asset identities proven.

From that evidence the pipeline can automatically derive and attest:

1. **Canonical registration** — verify the visual-to-geometry transform,
   coordinate handedness, up axis, units, asset hashes, and bounds.
2. **Collision artifact** — clean and simplify accepted structural triangles,
   preserve floors/walls/ceilings/stairs, assign verified semantic groups, and
   freeze the result with provenance.
3. **Navigation build** — derive voxel-unit Recast values from one declared
   metric agent profile, build the tiled mesh, and freeze the Detour bytes.
4. **Projection and connectivity** — project the opening spawn and all declared
   room/floor/connector targets, reject excessive projection, and require
   complete paths in both directions where travel is bidirectional.
5. **Clearance and multilevel support** — let Recast filter by capsule radius,
   height, step, and slope; prove that every intended level and continuous
   stair/ramp belongs to the accepted connected graph.
6. **Physical replay** — run the same capsule/profile against the same collision
   with Rapier; test occupancy, walls, corners, stairs/ramps, ground support,
   dynamic barrier states, and each controlled traversal.
7. **Release binding** — freeze the visual, registration, collision, NavMesh,
   movement profile, semantic topology, validation report, and hashes as one
   inseparable walking package.

These stages should run without a routine author click. A blocked state is
appropriate only when an input or proof is missing or a validation fails. Its
message should name the missing evidence and the exact correction needed.

## What geometry alone cannot safely decide

The following are not objective consequences of a raw point cloud or Gaussian
splat and therefore require vendor metadata, a supported classifier with
measured corpus evidence, or focused authoring:

| Question | Why it is not automatically proven by appearance/points |
| --- | --- |
| Is this gap a door, window, glass panel, mirror, or missing scan? | Absence of samples is not evidence of free space. |
| Is this object a structural wall, furniture, curtain, plant, or temporary obstruction? | Collision behavior is semantic and product-specific. |
| Should furniture block the viewer? | Unreal solves this with collision channels; geometry does not encode the desired game rule. |
| Is a discontinuity a lift, ladder, jump, teleport, or inaccessible void? | Each requires different direction, state, animation, and safety behavior. |
| Should a door be open, closed, lockable, or dynamic? | A scan captures one state, not the gameplay state machine. |
| Which spaces are intended to be playable? | Capture bounds and observed free space are not the same as design intent. |
| Which agent should the scene support? | Radius, height, eye height, step, slope, and movement modes are product policy. |
| Is unobserved space safe to synthesize? | Reconstruction uncertainty cannot be converted into collision-free space without evidence. |

Ordinary stairs and ramps are the useful boundary case. If registered geometry
shows a continuous, sufficiently observed surface and it passes the declared
agent's Recast and Rapier tests, it can be automatic. An inferred connector
created to bridge missing geometry cannot be treated as captured fact; it
requires review or explicit device semantics.

## What the FJD source contract should carry

FJD's current P2 product documentation says one scan can produce a point
cloud, automatically vectorized 2D floor plan, 3D mesh, Gaussian splat, and
georeferenced panoramas. The current point-cloud export list is LAS, PLY, PTS,
and E57. FJD's own iPadOS Model release notes also describe automatic indoor
classification of walls, floors, and ceilings plus point-cloud-to-mesh
creation. These are better upstream inputs than asking Spatial Studio to infer
every structural semantic from unlabelled XYZ samples.

Sources:

- [FJD: Trion P2 deliverables and export formats](https://us.fjdynamics.com/products/fjd-trion-p2-scanner)
- [FJD: Trion Model iPadOS indoor classification and mesh creation](https://www.fjdynamics.com/se/blog/product-updates-50/release-note-fjd-trion-model-ipados-v1-3-289)
- [FJD: structured E57 includes point clouds, images, and transformation matrices](https://www.fjdynamics.com/blog/product-updates-50/new-release-fjd-trion-model-v1-000-d-0203-515)

The preferred FJD ingestion contract is therefore one registered bundle:

```text
Gaussian visual
+ classified structural point cloud or mesh
+ scan/pose transformations and gravity
+ exact shared-frame declaration and hashes
```

Spatial Studio's current automatic intake accepts the Gaussian visual and a
metric point cloud, but its non-native normalization writes only `X,Y,Z` and
the extractor consumes geometry rather than vendor semantic classes or scan
origins. This deliberately avoids guessing undocumented FJD scalar names, but
it also discards evidence needed for robust free-space carving and automatic
wall/floor/ceiling classification. The next FJD corpus must identify and
preserve the actual exported dimensions and pose records before we make them a
production contract.

Repository evidence:

- [`capture-adapters.ts`](../../src/shared/capture-adapters.ts)
- [`processing-agent.mjs`](../../scripts/processing-agent.mjs)
- [`processing-agent-core.mjs`](../../scripts/processing-agent-core.mjs)

## What algorithms Spatial Studio uses now

The current implementation is not a single AI model. It is a deterministic
pipeline with one heuristic reconstruction stage followed by standard game
navigation and physics:

1. [`automatic-spatial-pipeline.mjs`](../../scripts/automatic-spatial-pipeline.mjs)
   converts reviewed/inferred rooms, walls, openings, ceilings, and connectors
   into concave floors/ceilings, barrier segments, and connector tread surfaces.
   It treats only a reviewed door/generic opening as passable; windows and
   unknown gaps remain barriers.
2. [`navigation-build-core.mjs`](../../scripts/navigation-build-core.mjs) feeds
   structural triangles to `generateTiledNavMesh`, derives Recast clearance
   from the agent profile, projects the spawn/destinations, and requires one
   connected, bidirectionally reachable whole-scene graph.
3. [`physical-navigation-validation.mjs`](../../scripts/physical-navigation-validation.mjs)
   replays routes and structural probes with Rapier, checks enclosure and
   barrier/corner behavior, and tests dynamic barrier states and controlled
   traversals.
4. [`physical-navigation.ts`](../../src/renderer/physical-navigation.ts) uses
   the same structural collision and agent profile for a gravity-driven Walk
   capsule and a collision-constrained Fly shape.
5. [`package.json`](../../package.json) pins the Recast/Detour JavaScript binding
   and Rapier runtime used by these artifacts.

The weakest stage is upstream: point-cloud occupancy and geometric heuristics
propose floors, wall persistence, room components, gaps, and stair/ramp support.
This is not a semantic or pose-aware watertight reconstruction. It cannot turn
an ambiguous gap into a verified door merely because doing so would connect a
route.

## Recommended product contract

The normal user journey should be one automatic state machine:

```text
FJD visual + registered metric geometry
  -> verify paired frame and source hashes
  -> reconstruct/classify structural shell
  -> compile collision
  -> build Recast/Detour navigation
  -> replay Rapier physical acceptance
  -> freeze one walking package
  -> issue preview URL
```

The UI may later expose render-native corrections, but floor plan, collision,
NavMesh, and proof jobs are pipeline artifacts, not separate tasks the user
should create manually.

Publication should require the complete release-bound walking package. There
should be no “look around only” publication fallback. Failure should remain
fail-closed and actionable, for example:

- visual asset has no registered structural-geometry pair;
- gravity/up or metric scale is unproven;
- boundary gap is unclassified;
- room or floor target is unreachable;
- stair fails capsule step/slope/clearance replay;
- physical door state and path state disagree; or
- collision/NavMesh/visual transforms or hashes do not bind to the same
  revision.

This is stricter than Unreal's default editor workflow because Spatial Studio
must publish a trustworthy URL without a level designer manually playing every
build. The extra proof package is the automation layer Unreal leaves to each
game team.
