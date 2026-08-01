# V7 structural navigation pipeline

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

The build remains `READY_FOR_REVIEW` until an operator approves it. Retuning or
changing authoring creates different evidence; it cannot silently mutate an
approved build.

## Required validation

A build cannot be approved unless it proves:

- every published room anchor is enclosed by valid floor, ceiling, and wall
  support in all six directions;
- every reviewed wall blocks both-direction Walk-capsule and Fly-sphere sweeps;
- capsule corner-slide probes preserve motion without penetrating barriers;
- every advertised room route replays in both directions;
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

1. Select the immutable scene version in Spatial authoring.
2. Upload and verify the visual and structural assets.
3. Author or review rooms, anchors, routes, doors, and group classifications.
4. Tune Walk and Fly profiles for the declared world unit.
5. Build verified navigation and inspect any processor failure evidence.
6. Review the validation summary and approve the exact build.
7. Publish a new release bound to that build.
8. Verify Walk, Fly, mobile movement, room routing, floor-plan position, and
   door state on staging before production.
9. Run the independent manifest verification:

   ```bash
   npm run verify:navigation -- https://example.test/api/releases/scene-slug/manifest
   ```

## Boundaries

V7 closes the static indoor collision, movement, route, and publication gap for
an explicitly reviewed structural shell. It does not provide automatic wall or
stair inference, multi-level circulation, moving furniture physics, elevators,
survey accuracy, clearance certification, accessibility certification, or
native XGRIDS/FJD reconstruction.

Provisional `SU` scenes are valid interaction demonstrations but not real-world
measurements. A metric release requires a separately measured scene version and
must preserve that evidence through the same immutable build contract.
