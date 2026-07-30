# V5 authored navigation pipeline

V5 turns a visual Gaussian reconstruction into an explicitly authored,
release-safe navigation scene. It does not claim that a Gaussian splat is
collision geometry, infer real-world scale, or automatically reconstruct every
wall and piece of furniture.

## Runtime contract

The pipeline keeps four inputs separate:

1. the PLY/RAD Gaussian asset is the visual layer;
2. a reviewed source-to-world transform puts source coordinates into canonical
   Y-up world coordinates, either metric metres or provisional scene units;
3. authored floor/room polygons and doorway connectors define the walkable
   triangle mesh;
4. obstacle boxes and a version-specific agent profile define clearance and
   camera behavior.

The source-to-world transform contains:

- source up axis (`Y` or `Z`);
- world unit (`metres` or provisional `scene_units`);
- world units per source unit;
- yaw in degrees;
- translation in the selected world unit;
- registration and scale evidence.

For stored-release compatibility, the transport fields remain named
`metresPerSourceUnit`, `translationMetres`, and `maxStepMetres`. Their numeric
values follow `worldUnit`; when it is `scene_units`, those values are SU rather
than metres. Studio and the published viewer never present them as metric.

An applied release transform must exactly match a reviewed, accepted semantic
extraction record. The renderer applies the same transform to the visual mesh
and uses the already-normalized authored navigation data.

At publication time, the platform freezes the semantic entities, routes,
stops, navigation mesh, obstacle boxes, and navigation profile into the release
record. Editing the project later therefore does not silently change an
existing release.

## DJI room handoff

The improved DJI reconstruction is available locally as:

- `artifacts/gaussian-examples/user-room/improved-exhaustive-colmap-15000/user-room-exhaustive-colmap.splatfacto.ply`
- `artifacts/gaussian-examples/user-room/improved-exhaustive-colmap-15000/user-room-exhaustive-colmap.splatfacto-lod.rad`

It is Z-up and its units are arbitrary. V5 can publish a provisional navigation
release now with `worldUnit: scene_units`; Studio and the viewer display those
values as `SU` and suppress any metre or area interpretation. Use an internally
consistent scale factor, author the navigation profile in SU, and retain the
reviewed transform as provisional evidence.

When a real measurement becomes available, create a new metric extraction and
release. Measure one distance between two unambiguous points visible in the
capture and compute:

```text
metresPerSourceUnit = measuredDistanceMetres / reconstructedDistanceSourceUnits
```

Record the point descriptions and physical measurement as the scale evidence.
Do not estimate this value from furniture dimensions or from the point-cloud
bounds.

## Operator sequence

1. Upload or select the verified PLY and RAD assets for the immutable version.
2. Queue semantic extraction with source up axis `Z`, world unit
   `scene_units`, a temporary scale factor, and any required yaw/translation.
3. Review the detected floor candidates and accept only the correct support
   layer.
4. Edit the resulting walkable polygons so both connected spaces are covered.
5. Add a doorway connector across the threshold between the spaces.
6. Add obstacle boxes for the L-shaped table, furniture, and any other volumes
   the camera must not enter.
7. Set the navigation profile to `scene_units` and tune the intended
   player/camera dimensions by visual inspection.
8. Inspect the Studio floor plan and viewer movement, then publish using the
   accepted extraction as transform evidence.

Concave room polygons preserve blocked voids. Doorways provide explicit
connectivity. Obstacle boxes are inflated by the agent radius, and transitions
are sampled so a large movement cannot tunnel through an obstacle.

## Deployment order

1. Apply D1 migrations `0033_v5_navigation.sql`,
   `0034_navigation_profiles.sql`, and `0035_navigation_world_units.sql` in
   order.
2. Deploy the application Worker and static bundle from the same tested
   revision.
3. Run the deployed staging acceptance suite.
4. Complete an authenticated Studio smoke test.
5. Create and inspect a new v5 release.

The implementation can be tested locally without mutating the existing DJI
release. A provisional v5 publication does not require a real measurement, but
production deployment still requires migration and deployed-acceptance
evidence. A later metric publication requires a measured control distance.

## Explicit exclusions

V5 does not provide automatic wall collision, stair traversal, multi-level
navigation, ceiling collision, glass detection, legal-room classification,
survey accuracy, accessibility certification, or Unreal Engine navmesh export.
Those can be added behind the authored navigation adapter without changing the
release snapshot contract.
