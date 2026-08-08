# V7 structural navigation pipeline

> V7 remains the structural-shell foundation. Explicit elevators, ladders, and
> moving platforms extend it through the
> [V8 authored traversal pipeline](./V8_AUTHORED_TRAVERSAL_PIPELINE.md).

V7 is the current production contract for making a Gaussian scene physically
explorable. The Gaussian splat remains the visual layer. Collision, movement,
route topology, room reachability, and the floor plan come from separate,
reviewed, immutable evidence.

Public proof:
<https://spatial.whymelabs.com/s/home-scan-spark-multi-room-demo>.

## Why v7 exists

V5 authored floor polygons and v6 added an offline Recast build, but neither
model was sufficient for the current product promise:

- a floor boundary cannot safely manufacture walls or ceilings;
- furniture occupancy should not automatically block visitor movement;
- pathfinding alone does not provide physical collision or wall sliding;
- a visitor must be able to move vertically without public Noclip; and
- publication must freeze the exact geometry, tuning, validation, and bytes
  that were reviewed.

V7 therefore treats walkability as a 3D game-scene problem while keeping the
Gaussian renderer device-neutral.

## Immutable inputs

Every v7 build targets one immutable scene version and binds:

1. a verified Spark visual asset (`RAD`, `SPZ`, or `SOG`);
2. an `authored-structural-collision-v2` JSON asset;
3. reviewed Walk and Fly movement profiles;
4. authored rooms, anchors, routes, and dynamic-door semantics; and
5. explicit metric metres or provisional scene units (`SU`).

The structural asset classifies each primitive independently:

- `structural_floor`;
- `structural_barrier` for walls and ceilings;
- `dynamic_barrier` for doors whose open/closed state changes;
- `ignored_furniture` for geometry excluded from a public movement profile; or
- a trigger that carries semantics without physical collision.

No wall is extruded from a floor edge. Furniture exclusion is explicit and does
not weaken structural barriers. The example contract is
[`../assets/home-scan-structural-v7.json`](../assets/home-scan-structural-v7.json).

## Offline build

Studio creates a version-bound build request. The processor then:

1. verifies the exact structural asset bytes and SHA-256;
2. validates finite coordinates, winding, groups, world units, bounds, room
   anchors, route endpoints, door states, and agent dimensions;
3. builds tiled Recast/Detour topology using world-unit voxel parameters;
4. imports the same structural shell into Rapier;
5. validates every public movement and route claim;
6. writes immutable validation JSON and exported Detour binary assets; and
7. completes the build with exact tool versions, hashes, byte sizes, tuning,
   source identity, authoring hash, and bounded timing evidence.

Manually queued builds remain `READY_FOR_REVIEW` until an operator approves
them. A build created from an approved immutable floor-plan revision advances
directly to `APPROVED` only after the same schema, Recast reachability, Rapier
movement, structural shell, source hash, and authoring-hash checks pass.
Retuning or changing authoring creates different evidence; it cannot silently
mutate an approved build.

For the automatic floor-plan lane, a build made from an uncorrected machine
proposal is explicitly preview-only. Approving the floor plan recooks the
collision GLB from exact concave floor/ceiling polygons, connector holes,
corrected walls, openings, and stair/ramp surfaces, then queues a new navigation build bound to the approved revision
ID and exact plan hash. Only that revision-bound build can be accepted, and the
Worker accepts it automatically after objective validation succeeds.

## Required validation

A build cannot be approved unless it proves:

- every published room anchor is enclosed by valid floor, ceiling, and wall
  support in all six directions;
- every reviewed wall blocks both-direction Walk-capsule and Fly-sphere sweeps;
- capsule corner-slide probes preserve motion without penetrating barriers;
- every advertised room route replays in both directions;
- every inferred room, including rooms on the same floor, owns a frozen
  reachability destination;
- each dynamic door is passable/open and blocked/closed in both Rapier and
  Detour; and
- the resulting topology is connected for every advertised destination.

These are release gates, not visual QA suggestions. Missing, failed, stale, or
hash-mismatched evidence blocks movement-enabled publication and manifest
delivery.

## Browser runtime

After Spark reports first-frame readiness, the host sends the frozen navigation
snapshot to the same-origin renderer. The renderer loads:

- the splat into Spark;
- the structural shell into Rapier;
- the exported topology into Detour; and
- the frozen rooms/routes into the navigator and floor plan.

Walk mode uses a grounded Rapier capsule with collision response and sliding.
Fly mode uses a no-gravity sphere against the same structural barriers. Detour
remains authoritative for route topology and guided destinations; Rapier is
authoritative for physical motion.

Three runtime invariants hold at this boundary:

- **`ready` means movement-ready.** The renderer posts `ready` to its host only
  once the visual is on screen *and* the Rapier/Detour runtime is verified (or
  an authoring host has granted collision-free inspection). The local loading
  overlay clears on visual readiness alone, but a host must never enable room
  navigation from a visual-only state, and a fatal walking-map error is
  terminal: no `ready` ever follows it.
- **The Rapier body is the authority on player position.** Externally supplied
  cameras (`sync-camera`, `set-camera`) are teleport requests that pass full
  placement validation — overlap and, in Walk mode, ground support. A rejected
  placement recovers the camera from the body; the body is never silently
  relocated to a camera, because that would skip the collision sweep and could
  embed the capsule beyond a zero-thickness wall.
- **A door never closes on the player.** Activating a dynamic barrier that
  overlaps the capsule is refused in Rapier and, because Detour only follows an
  accepted change, the route planner and the collision world cannot disagree
  about a door's state.

Desktop controls:

- `WASD` or arrow keys: move;
- `Shift`: speed boost;
- Fly mode `Space`/`E`: rise; and
- Fly mode `C`/`Q`: descend.

Touch devices use the on-screen movement pad plus explicit Rise/Lower controls
in Fly mode. Walk and Fly are public. The frozen Noclip profile is operator-only
diagnostic evidence and is never exposed in the published viewer.

## Publication and rollback

A movement-enabled release freezes:

- semantic entities, room anchors, routes, and stops;
- structural groups and dynamic-door state;
- Walk/Fly movement profiles;
- approved navigation build ID and authoring hash;
- validation JSON and Detour asset IDs, SHA-256 values, and byte sizes; and
- the exact visual scene version and source-to-world provenance.

Rollback points a release channel to a previous immutable release. It does not
rebuild navigation or reinterpret current authoring.

## Operator sequence

1. Upload a portable Gaussian and registered metric capture result; Studio
   creates the immutable scene version and queues spatial processing.
2. Preview the splat and any automatically generated floor-plan/navigation
   drafts.
3. Correct and approve levels, captured ceiling elevations, rooms, walls,
   openings, and stair/ramp connectors.
4. Let Studio recook structural collision and verified navigation from the
   approved revision; tune Walk and Fly only if the default agent does not fit.
5. Inspect the validation summary and approve the exact revision-bound build.
6. Author optional anchors, routes, doors, and richer semantics on top.
7. Publish a new release bound to that build.
8. Verify Walk, Fly, mobile movement, room routing, floor-plan position, and
   door state on staging before production.
9. Run the independent manifest verification:

   ```bash
   npm run verify:navigation -- https://example.test/api/releases/scene-slug/manifest
   ```

## Boundaries

V7 closes the static indoor collision, movement, route, and publication gap for
an explicitly reviewed structural shell. The automatic spatial v2 processor can
now infer multiple captured levels and continuous stair/ramp candidates from a
registered metric point cloud, cook bounded Recast treads and landings, and
fail the build when any inferred level is unreachable. It requires captured or
operator-reviewed ceiling support and does not manufacture ceilings from wall
height. It does not infer unobserved circulation, elevators, ladders, or moving
platforms. Those discontinuities require explicit reviewed V8 paths. V7 does not
provide moving-furniture physics, survey accuracy, clearance certification,
accessibility certification, or native XGRIDS/FJD reconstruction.

Provisional `SU` scenes are valid interaction demonstrations but not real-world
measurements. A metric release requires a separately measured scene version and
must preserve that evidence through the same immutable build contract.
