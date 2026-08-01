# Player movement, structural collision, and 3D navigation

Last verified: 2026-08-01

## Decision

The sofa problem is **not evidence that walking needs a volumetric navigation
mesh**. It shows that Spatial Studio is currently using a surface pathfinding
constraint as a player-movement constraint, and that the authored surface does
not represent the intended experience.

Video-game engines normally separate three concerns:

1. **Player locomotion** consumes input and asks a kinematic controller to move
   a collision shape through 3D space.
2. **Collision filtering** decides which scene classes can block that shape.
3. **Navigation** plans routes for agents or guided movement over authored
   traversable surfaces; it does not have to govern every keyboard step.

Spatial Studio should make the same separation:

- keep Spark as the visual-only Gaussian layer;
- add a real, authored **structural collision shell** containing floor, walls,
  ceilings, and closed doors;
- classify furniture separately and exclude it from the player collision mask
  when the intended demo behavior is to pass through furniture;
- move a Rapier capsule with gravity in **Walk** mode, without first constraining
  each keyboard delta through `Detour.moveAlongSurface`;
- add a **Fly** mode that moves a Rapier sphere or capsule in all three axes,
  without gravity or ground snapping, while still colliding with the structural
  shell; and
- retain Detour for spawn projection, release reachability, guided routes, and
  the floor-plan topology.

This is closer to an Unreal first-person player plus Spectator Pawn than to an
AI NavMesh Agent. Unreal's `CharacterMovementComponent` explicitly supports
walking, falling, swimming, flying, and custom modes, while its Default Pawn
and Spectator Pawn use a no-gravity flying movement style. The Spectator
collision profile ignores everything except `WorldStatic` by default.

Primary sources:

- [Epic: Character Movement Component movement modes](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UCharacterMovementComponent)
- [Epic: Default Pawn and Spectator Pawn](https://dev.epicgames.com/documentation/en-us/unreal-engine/pawn-in-unreal-engine)
- [Epic: collision profiles and responses](https://dev.epicgames.com/documentation/en-us/unreal-engine/collision-response-reference-in-unreal-engine)

## What engines actually do

### Grounded character movement is collision-driven

Unreal's character movement component provides walking and flying as movement
modes on a player character. Unity's `CharacterController.Move` accepts a 3D
motion vector, constrains it by collisions, and deliberately leaves gravity to
the application. Godot's `CharacterBody3D` similarly exposes a grounded mode,
where floor, wall, ceiling, slope, and platform behavior matter, and a floating
mode, where there is no floor/ceiling distinction and contacts are treated as
walls.

Rapier follows the same model. Its kinematic character controller computes a
corrected translation using shape casts, can stop or slide at obstacles, can
handle steps and slopes, and requires the application to provide gravity. The
desired translation is a 3D vector; Recast/Detour is not involved in that
operation.

Sources:

- [Unity 6: `CharacterController.Move`](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/CharacterController.Move.html)
- [Godot: `CharacterBody3D` grounded and floating motion modes](https://docs.godotengine.org/en/stable/classes/class_characterbody3d.html)
- [Rapier: kinematic character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/)

### Free-fly or spectator movement is still 3D collision movement

Unreal's Default Pawn is a no-gravity flying pawn with a spherical collision
component; Spectator Pawn uses the same flying behavior. This is not AI
pathfinding. It applies player input directly to a movement component and can
use swept movement to stop at geometry.

For Spatial Studio, Fly mode should therefore be a second controller policy,
not a second NavMesh:

- desired motion is view-relative in 3D;
- gravity, autostep, slope limits, and snap-to-ground are disabled;
- a sphere is simplest for a camera, while a capsule preserves the viewer's
  body clearance if that is preferred;
- the movement shape is swept only against structural collision; and
- an explicit diagnostics-only **Noclip** mode may bypass all collision, but
  should not be conflated with Fly.

In this repository and Three.js scene convention, **Y is vertical** and X/Z
form the floor plane. Forward/backward movement already changes X/Z according
to camera yaw. A request to move vertically through the scene therefore means
adding Y-axis input, even if it is described conversationally as “move through
the Z axis.”

Source: [Epic: Pawn, Default Pawn, Spectator Pawn, and swept movement](https://dev.epicgames.com/documentation/en-us/unreal-engine/pawn-in-unreal-engine).

### Ignoring furniture is a semantic collision-filtering decision

Engines do not solve “pass through the sofa but not the wall” by making
navigation more dimensional. They assign objects to collision classes and
configure the player profile to block some classes and ignore others.

Unreal exposes object types, trace channels, and `Ignore`, `Overlap`, or
`Block` responses. Its built-in Spectator profile ignores all actors except
`WorldStatic`. Unity's Layer Collision Matrix controls which layers may
interact, and individual colliders expose included and excluded layers. Godot's
navigation baker can filter source collision objects by a collision mask.
Rapier collision groups use membership and filter bitmasks, and the character
controller also accepts `filterGroups` or an arbitrary filter predicate.

Sources:

- [Epic: collision object types, profiles, and responses](https://dev.epicgames.com/documentation/en-us/unreal-engine/collision-response-reference-in-unreal-engine)
- [Unity 6: layer-based collision filtering](https://docs.unity3d.com/6000.0/Documentation/Manual/LayerBasedCollision.html)
- [Unity 6: `Collider` include/exclude layers](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Collider.html)
- [Godot: navigation source collision masks](https://docs.godotengine.org/en/stable/tutorials/navigation/navigation_using_navigationmeshes.html)
- [Rapier: collider collision groups](https://rapier.rs/docs/user_guides/javascript/collider_collision_groups/)
- [Rapier: character-controller filtering](https://rapier.rs/docs/user_guides/javascript/character_controller/#filtering)

Spatial Studio should use explicit semantic groups, for example:

| Group | Examples | Walk | Fly | Navigation bake |
| --- | --- | --- | --- | --- |
| `STRUCTURAL_FLOOR` | floor slabs, stairs, landings | block/support | block | include as walkable source |
| `STRUCTURAL_BARRIER` | walls, ceilings, columns, closed doors | block | block | include as obstruction |
| `FURNITURE` | sofa, table, chair, cabinet | ignore for this demo profile | ignore for this demo profile | exclude |
| `DYNAMIC_BARRIER` | a door when closed | block when active | block when active | tile-cache obstacle or link state |
| `TRIGGER` | room/portal volumes | overlap only | overlap only | topology metadata only |

The classification must be stored in the authored geometry/provenance. A
Gaussian splat has appearance but does not reliably identify which fuzzy
samples are a wall, sofa, curtain, reflection, or reconstruction artifact.

## Why “3D NavMesh” does not mean volumetric free space

Recast starts from triangle geometry, rasterizes it into a voxel heightfield,
extracts walkable spans, partitions them into regions, and emits navigation
polygons. Detour queries that polygon mesh. The source and resulting polygons
have 3D coordinates and can represent slopes, stairs, and several floor levels,
but the traversable set remains a collection of **surfaces** on which the
agent's center can stand.

Unity describes its NavMesh as an approximation of walkable surfaces and says
the agent is constrained to that surface. Godot's `NavigationMesh` is likewise
a 3D surface for an agent's center; its documentation explicitly distinguishes
navigation from rendering and physics and says visuals and collision shapes
are ignored by pathfinding unless they are incorporated during baking. Unreal
generates polygon tiles from collision geometry, then uses the polygons as a
graph. Links connect surfaces that do not have a continuous path, such as a
jump or drop.

Unity's current `NavMeshSurface` also makes the source choice explicit: a bake
can collect only selected layers and can use render meshes or physics
colliders. Excluding furniture from path generation is therefore an authoring
input decision, independent of whether the sofa remains visible.

Sources:

- [Recast Navigation: documented build stages](https://github.com/recastnavigation/recastnavigation#how-it-works)
- [Detour: `moveAlongSurface` is constrained to the navigation mesh](https://recastnav.com/classdtNavMeshQuery.html)
- [Unity: building a NavMesh from walkable surfaces](https://docs.unity3d.com/2019.4/Documentation/Manual/nav-BuildingNavMesh.html)
- [Unity: NavMesh agents are constrained to the surface](https://docs.unity3d.com/2018.3/Documentation/Manual/nav-HeightMesh.html)
- [Unity AI Navigation: `NavMeshSurface` source layers and geometry](https://docs.unity3d.com/Packages/com.unity.ai.navigation@2.0/manual/NavMeshSurface.html)
- [Godot: what a 3D navigation mesh represents](https://docs.godotengine.org/en/stable/tutorials/navigation/navigation_using_navigationmeshes.html)
- [Epic: Navigation System polygon graph](https://dev.epicgames.com/documentation/unreal-engine/navigation-system-in-unreal-engine)
- [Epic: Navigation Links between discontinuous surfaces](https://dev.epicgames.com/documentation/unreal-engine/automatic-navigation-link-generation)

Consequently:

- use a Recast surface mesh for walking routes, multi-floor stairs, ramps, and
  guided room navigation;
- use off-mesh/portal links for authored discontinuities such as lifts, jumps,
  or teleports; and
- use direct collision-constrained movement for a human-controlled flying
  camera.

A true volumetric free-space graph is warranted only if Spatial Studio later
needs autonomous drone-style path planning, not merely keyboard Fly mode. That
would be a separate artifact: voxelize the structural shell into occupied and
free 3D cells, erode by the flying agent radius, connect neighboring free cells
or convex volumes through portals, and run A* over that graph. It would not
replace the floor NavMesh or the floor plan.

Godot documents this same design boundary: `AStar3D` is a weighted-point graph
suited to cell-based 3D gameplay, whereas `NavigationServer3D` finds paths over
an area defined by a navigation mesh. [Godot: 3D navigation overview](https://docs.godotengine.org/en/stable/tutorials/navigation/navigation_introduction_3d.html).

## Diagnosis of the current Spatial Studio runtime

The current player loop in `src/renderer/main.ts` sends each keyboard-derived
camera destination through `DetourNavigationRuntime.moveCamera` and only then
through `PhysicalNavigationRuntime.moveCamera`. The former calls
`NavMeshQuery.moveAlongSurface`, so the camera cannot leave the authored
surface even when Rapier would accept the physical movement.

The current controls in `src/renderer/look-controls.ts` also flatten the camera
forward vector onto the navigation plane and generate only planar X/Z input.
The current Rapier runtime in `src/renderer/physical-navigation.ts` loads the
entire collision GLB as one unclassified collider and configures grounded
autostep, slopes, and snap-to-ground. It does not establish structural versus
furniture collision groups.

For the Home Scan example, the v6 proxy is a reviewed set of floor and
threshold surfaces, not a closed 3D structural shell. Removing Detour from the
keyboard path today would therefore let the viewer leave the intended floor
envelope and could not reliably stop it at walls. The prerequisite is not a
larger floor polygon; it is a wall/floor/ceiling proxy with explicit semantics.

## Recommended Spatial Studio runtime

```text
Spark Gaussian visual (non-colliding)
              |
              +----------------------------+
              |                            |
    structural collision shell       authored topology
   floor / wall / ceiling / door     rooms / portals / targets
              |                            |
         Rapier queries              Recast -> Detour
              |                            |
       +------+------+            spawn / routes / QA /
       |             |              floor-plan graph
  Walk controller  Fly controller
  gravity/capsule  no gravity/sphere
       |             |
       +------ direct player input ------+
```

### Walk mode

1. Convert W/A/S/D or arrow input into view-yaw-relative X/Z translation.
2. Add gravity and use a Rapier capsule character controller.
3. Filter movement against structural floor/barrier and active-door groups;
   ignore furniture.
4. Do **not** call `moveAlongSurface` for each player step.
5. Use downward ground probes, slope/step policy, and a fall/recovery boundary
   to prevent escaping through missing geometry.
6. Keep Detour queries for guided routes, target reachability, and optional
   click-to-move.

### Fly mode

1. Convert W/A/S/D to camera-relative forward/strafe in full 3D, with a separate
   vertical pair such as Space/C for up/down. Keep Shift as speed boost.
2. Disable gravity, ground snap, step, and slope behavior.
3. Sweep a sphere or capsule against structural barriers, floors, ceilings, and
   closed doors; ignore furniture.
4. Do not project the camera back onto Detour.
5. Preserve room/portal trigger reporting and the floor-plan marker by
   projecting the current X/Z position for display only.

### Noclip diagnostics

Noclip should be an operator-only mode with no collision at all. It is useful
for inspecting reconstruction artifacts but should never be reported as
“walking verified.”

## Artifact and publication changes

The next navigation contract should freeze these independently:

- `visual`: the immutable Spark-compatible asset and transform;
- `structuralCollision`: triangle mesh plus per-primitive semantic group;
- `furnitureCollision`: optional and disabled for the requested demo profile;
- `navigationSurface`: Recast/Detour bytes for a declared grounded agent;
- `topology`: rooms, portals, targets, and floor-plan projection;
- `movementProfiles`: Walk, Fly, and operator-only Noclip policies with input,
  shape, gravity, filters, speed, and recovery bounds; and
- `validation`: hashes and test evidence for collision and route behavior.

The publisher must not infer a structural wall from a floor boundary. For a
visual-only online splat, an operator can author a provisional shell, but the
release must say so. For FJD/XGRIDS or LiDAR capture, the registered metric mesh
should be classified and simplified into the shell while retaining the exact
visual-to-geometry transform.

## Acceptance criteria for the multi-room demo

Before republishing Home Scan with this behavior:

1. A direct input test crosses the sofa's visual footprint in Walk and Fly
   modes because `FURNITURE` is excluded.
2. Capsule/sphere sweeps stop at every reviewed exterior and interior wall in
   both directions; corner sliding does not tunnel through the shell.
3. Doors pass when open and block when closed, with physics and route state
   changing together.
4. Walk mode remains grounded over floor transitions and cannot leave the
   authored shell through missing floor or wall geometry.
5. Fly mode moves up and down, stops at floor and ceiling, and never snaps back
   to the Detour surface.
6. Switching modes never teleports the camera: Fly to Walk either finds safe
   ground beneath the camera or reports that landing is unavailable.
7. All four room targets still pass Detour reachability and appear in the floor
   plan; keyboard movement passing through furniture does not rewrite topology.
8. The published manifest states whether structural collision is measured,
   derived, or provisional and identifies the exact collision and navigation
   hashes.

## Technical gap

The browser libraries are sufficient. Rapier already supports arbitrary
desired translation and collision filters; Spark can remain unchanged; Detour
already serves route planning. The main gap is **geometry and semantics**:

- Home Scan currently has a visual splat and reviewed floor/threshold proxy,
  but no complete structural wall/floor/ceiling shell.
- The runtime has one combined grounded controller policy rather than separate
  Walk and Fly policies.
- Keyboard movement is incorrectly coupled to `moveAlongSurface`.
- The collision artifact lacks primitive-level structural/furniture groups.

So the right next implementation is a dual-mode, collision-driven player over
an authored structural shell. A volumetric navigation system is a later,
separate requirement only if autonomous 3D route planning becomes a product
goal.
