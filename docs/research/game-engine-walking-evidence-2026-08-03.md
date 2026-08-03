# Automatic walking evidence and game-engine navigation

Last verified: 2026-08-03

## Decision

Spatial Studio should automatically generate a complete walking package whenever
capture intake supplies enough registered geometric evidence. The normal journey
should be one pipeline:

```text
capture bundle
  -> registered structural geometry
  -> collision shell
  -> Recast navigation build
  -> Rapier physical and structural validation
  -> walking package
  -> preview URL
```

The blocked state remains necessary, but only as the fail-closed outcome when
geometry is absent, reconstruction is ambiguous, or an objective validation
fails. It should not be the ordinary authoring journey.

Automatic generation and automatic acceptance are different decisions. The
current navigation builder and validators are suitable for automatic execution.
The current point-cloud-to-structural-shell inference is not yet supported by a
representative indoor vendor corpus and is too lossy to approve without review.

The central game-engine lesson is that player movement and navigation are
separate systems:

- a human player's WASD movement is a collision-constrained capsule or sphere;
- a NavMesh provides pathfinding, reachability, guided routes, and topology; and
- both consume a structural world that is distinct from visible rendering.

A Gaussian splat is therefore the visual layer, not the physical world.

## What Unreal Engine actually automates

Unreal does not infer a trustworthy building from a Gaussian splat. It starts
after usable scene geometry and collision already exist.

| Stage | Unreal behavior | Automatic after configuration? | Author responsibility |
| --- | --- | --- | --- |
| Visible scene | Static meshes, landscapes, or other render components | Import can be automated | Supply usable source assets and transforms |
| Physical world | Simple primitives, convex decomposition, or complex collision mesh | Some collision generation can be automated per mesh | Review collision fidelity and collision responses; a mesh without collision can be walked through |
| Navigation source | Collision geometry inside a `NavMeshBoundsVolume` | Yes | Define playable bounds, supported agents, modifiers, and areas |
| NavMesh | Recast rasterizes collision into tiled walkable polygons and a graph | Yes; adding or resizing the bounds volume triggers generation | Tune agent radius, height, step, slope, resolution, and region policy |
| Player movement | `ACharacter` uses a capsule and `CharacterMovementComponent` | Runtime movement is automatic after the controller is configured | Supply input and game-specific movement policy |
| Discontinuities | Navigation links connect otherwise disconnected surfaces | Simple jump/drop links can be generated | Doors, elevators, ladders, special animations, direction, and state are usually authored |
| Dynamic changes | Static, Dynamic, or Dynamic Modifiers Only generation modes | Affected tiles or modifiers can update at runtime | Choose rebuild policy and mark navigation-relevant objects |
| Acceptance | NavMesh visualization, collision visualization, simulation, and play testing | Debug output is available | Unreal does not produce Spatial Studio's immutable proof package by default |

Epic states that the Navigation System generates its NavMesh from **collision
geometry**, divides it into tiles and polygons, and uses polygon costs during
pathfinding. A `NavMeshBoundsVolume` defines where that generation occurs.
[Navigation System](https://dev.epicgames.com/documentation/unreal-engine/navigation-system-in-unreal-engine?lang=en-US),
[Basic Navigation](https://dev.epicgames.com/documentation/unreal-engine/basic-navigation-in-unreal-engine?lang=en-US)

Unreal also keeps rendering and collision distinct. Its Static Mesh tools can
create primitive, K-DOP, or convex collision, while complex shapes may need
custom collision. The visible mesh is not itself proof that a player will be
blocked correctly.
[Setting Up Collisions With Static Meshes](https://dev.epicgames.com/documentation/unreal-engine/setting-up-collisions-with-static-meshes-in-unreal-engine?lang=en-US)

`ACharacter` owns the capsule used for movement collision, while
`UCharacterMovementComponent` supports walking, falling, swimming, flying, and
custom movement. This is the direct analogue of Spatial Studio's Rapier
capsule/sphere runtime, not of Detour path following.
[ACharacter](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/ACharacter),
[`UCharacterMovementComponent`](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/UCharacterMovementComponent)

Unreal's modifiers and links change costs, block areas, or connect surfaces
without a continuous path. Its runtime generation modes range from frozen
offline data to rebuilding affected tiles.
[Modifying the Navigation Mesh](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-how-to-modify-the-navigation-mesh-in-unreal-engine),
[Automatic Navigation Link Generation](https://dev.epicgames.com/documentation/en-us/unreal-engine/automatic-navigation-link-generation)

## Unity confirms the same boundary

Unity's current AI Navigation package follows the same architecture:

- `NavMeshSurface` collects selected render meshes or physics colliders by
  hierarchy, volume, layer, and modifier policy;
- the bake voxelizes that geometry and creates a polygonal surface for a
  configured agent;
- `NavMeshLink` connects otherwise disconnected surfaces;
- `NavMeshObstacle` can apply local avoidance or carve a hole; and
- a separate capsule-shaped `CharacterController` moves the player while
  collision constrains the requested motion.

Unity supports editor and runtime NavMesh generation, but application code still
chooses the source set and when a rebuild occurs. Ordinary stairs can bake when
they satisfy the agent's step and slope policy. Elevators, ladders, semantic
doors, and other special transitions still need links and traversal behavior.

Primary sources:

- [AI Navigation package](https://docs.unity3d.com/ja/current/Manual/com.unity.ai.navigation.html)
- [`NavMeshSurface`](https://docs.unity3d.com/Packages/com.unity.ai.navigation@2.0/manual/NavMeshSurface.html)
- [Navigation system internals](https://docs.unity3d.com/Packages/com.unity.ai.navigation@2.0/manual/NavInnerWorkings.html)
- [`NavMeshLink`](https://docs.unity3d.com/Packages/com.unity.ai.navigation@2.0/manual/NavMeshLink.html)
- [NavMesh obstacles](https://docs.unity3d.com/Packages/com.unity.ai.navigation@2.0/manual/AboutObstacles.html)
- [`CharacterController.Move`](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/CharacterController.Move.html)

## Current Spatial Studio generation

### 1. Intake and automatic queueing

After a `metric_point_cloud` asset passes integrity validation, the Worker
automatically queues `floorplan.extract-v1`. Visual-only Gaussian output does
not trigger this branch. The input must claim registered metric geometry.

The automatic extractor currently carries fixed values for its grid, height
bands, wall coverage, room area, opening width, room count, and sampled-point
limit. Unit tests cover synthetic rooms, but `docs/CAPACITY_RECEIPTS.md` records
that the project still lacks a redistributable registered indoor FJD corpus for
an end-to-end success receipt. These fixed extraction values must not become an
automatic-approval policy until measured against that corpus.

### 2. Point cloud to floor-plan proposal

The Node processor normalizes PLY/E57/LAS/LAZ/PTS input to a metric Y-up PLY,
samples it, and voxelizes the samples. The extractor then:

1. bins occupied X/Z cells into horizontal height layers;
2. selects credible floor layers by support area;
3. looks for a higher overlapping horizontal layer as captured ceiling support;
4. marks X/Z cells as walls when samples persist through enough vertical bins;
5. closes bounded gaps in those walls while segmenting connected floor cells;
6. emits connected components as room candidates;
7. emits the bounded wall gaps as opening candidates, without knowing whether
   they are doors or windows; and
8. clusters credible levels and uses a principal-axis/linear-fit heuristic over
   intermediate-height support to propose a stair or ramp.

This is occupancy segmentation and geometric heuristics, not neural scene
understanding, TSDF fusion, or a watertight mesh reconstruction.

### 3. Floor plan to collision shell

The automatic collision compiler currently converts each room outline to its
axis-aligned bounding rectangle for both floor and ceiling, turns inferred wall
lines into barrier segments, removes every matching opening gap from the wall,
and converts an inferred stair/ramp into generated tread rectangles. Furniture
is deliberately excluded.

This stage is the main correctness gap. Bounding rectangles can fill concave or
L-shaped voids; a geometric gap can be a doorway, window, glass surface, or
missing scan; and absent observations do not prove free space. Requiring captured
ceiling support prevents an invented open shell but does not make the remaining
shell reliable.

### 4. Collision shell to navigation

The navigation processor decodes the structural GLB, excludes `FURNITURE` and
`TRIGGER`, and feeds the structural triangles to a pinned Recast build. Upstream
Recast describes the algorithm as:

1. rasterize input triangles into voxels;
2. filter spans the declared agent cannot traverse;
3. partition walkable spans into regions; and
4. polygonize those regions into a NavMesh.

Spatial Studio uses a tiled build and derives walkable height, radius, climb,
and slope from the same agent profile used at runtime. Detour then projects the
spawn and destinations, proves complete paths in both directions, and rejects
disconnected components.
[Recast Navigation](https://github.com/recastnavigation/recastnavigation#how-it-works)

### 5. Automated physical evidence

The builder replays every Detour route with a Rapier kinematic capsule against
the same structural collision used in the browser. Structural validation also
checks:

- spawn occupancy;
- closed floor/wall/ceiling enclosure in six directions;
- capsule and sphere sweeps against every reviewed barrier;
- corner sliding without tunnelling;
- open and closed states for dynamic barriers;
- connected boundary topology; and
- controlled off-mesh traversal in every allowed direction.

Rapier's controller is designed for move-and-slide, slopes, automatic steps,
ground snapping, and collision-constrained kinematic motion.
[Rapier character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/)

### 6. Runtime movement

For current v7-v9 walking packages, ordinary keyboard movement goes directly
through the Rapier physical controller. It is **not** constrained by Detour on
every step. Detour remains loaded for reachability, room movement, guided paths,
dynamic path state, and authored elevators/ladders/platforms. Walk uses a
gravity-driven capsule with sliding, autostep, ground snap, and slope limits;
Fly uses a no-gravity sphere against the same structural shell.

This already matches the Unreal/Unity separation at runtime.

## What should change

### Make automatic generation the single product journey

The Studio journey should expose one job, not separate floor-plan and navigation
workflows:

```text
Upload capture
  -> Processing visual
  -> Reconstructing structural geometry
  -> Building walking map
  -> Verifying every room and connector
  -> Preview ready
```

Floor plan, collision, Detour data, and validation reports remain separate
immutable artifacts, but they are implementation details underneath one job.

### Move the source of truth upstream of the floor plan

The long-term compiler should be:

```text
registered vendor mesh, or pose-aware point-cloud reconstruction
  -> classified watertight structural shell
  -> collision proxy
  -> floor plan and room topology derived from that shell
  -> Recast + Rapier evidence
```

The current direction—floor-plan rectangles first, collision second—is too
lossy. Prefer a vendor-supplied registered mesh when available. For point-cloud
fallbacks, use scanner poses to distinguish observed free space from unobserved
space, reconstruct floor/wall/ceiling surfaces, preserve concave boundaries, and
classify doors, windows, glass, furniture, and missing coverage explicitly.

### Permit automatic acceptance only from objective proof

An automatically generated package can become preview-ready without a human
click when all of these are true:

- metric frame, gravity, scale, registration, and source hashes are proven;
- the structural shell has no unclassified boundary or unsupported opening;
- every declared room and floor is connected through physically replayed paths;
- the collision shell passes enclosure, barrier, corner, and door-state probes;
- all limits and thresholds have representative-corpus receipts; and
- the exact collision, Detour binary, report, visual transform, and source
  revision are frozen together.

Failure should route to a focused correction such as “classify this gap as door
or window” or “recapture this missing ceiling region,” not to a generic manual
authoring tab. No fabricated geometry and no look-around fallback are needed.

## Remaining technical gaps

1. **Representative vendor evidence.** The official FJD horse asset proves the
   visual adapter, not indoor structural reconstruction. A registered indoor
   FJD bundle is required before automatic acceptance has a receipt.
2. **Structural reconstruction.** Replace bounding-room collision and gap-equals-
   opening assumptions with pose-aware, concavity-preserving, uncertainty-aware
   structural geometry.
3. **Semantic transitions.** Automatically infer ordinary stairs and ramps from
   geometry; require explicit evidence for elevators, ladders, moving platforms,
   and ambiguous doors.
4. **Measured policy.** Derive extraction and navigation settings from the
   device/corpus and supported agent, then record the measurement. The current
   fixed values are implementation defaults, not proven product limits.
5. **One-job lifecycle.** Automatically advance successful stages and replace
   two routine approval clicks with objective acceptance. Keep human review as
   exception handling and later editing.
6. **Game-feel qualification.** The core capsule behavior exists. A browser
   corpus must additionally qualify narrow doors, stairs, ramps, corners,
   dynamic doors, multilevel routes, Walk/Fly switching, and recovery behavior
   using the exact production artifacts.

The navigation stack is not the wrong tool. The architecture now uses the same
categories of systems as Unreal and Unity. The remaining work is to give those
systems a trustworthy structural world automatically and to make their already
automated proofs drive the product lifecycle.
