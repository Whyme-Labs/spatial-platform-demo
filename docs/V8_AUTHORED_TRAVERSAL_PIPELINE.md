# V8 authored traversal pipeline

V8 extends the reviewed V7 structural shell with explicit 3D discontinuities.
It is for an elevator, ladder, or moving platform that exists in registered
evidence but cannot be represented as continuous walkable floor geometry. It
does not infer or fabricate one.

## Immutable authoring contract

An operator authors one version-scoped traversal with:

- a stable label and traversal kind;
- at least two feet-level 3D path points;
- one-way or bidirectional travel;
- an authored travel speed in the scene version's frozen world unit; and
- a review receipt identifying why the path is supported and safe to test.
- the UUID and frozen SHA-256 of a verified immutable asset from the same scene
  version that contains the supporting evidence.

The record is stored independently of a build. Changing or archiving it changes
the navigation authoring hash, so an older approval cannot silently remain
current. Ad hoc build payloads cannot inject a link.
The registry retains archived records in the authoring hash, so removing the
last active link cannot make a pre-traversal approval current again.

When navigation is generated from a reviewed floor plan, the authoring hash
also freezes the floor-plan revision id, plan SHA-256, collision asset id, and
collision SHA-256. Approval recomputes the entire current authoring hash and
rejects any build that predates a profile, geometry, route, traversal,
floor-plan, or collision change.

## Build and acceptance

The offline processor performs all of the following before review:

1. Project both path landings onto the radius-cleared Recast mesh.
2. Add the connection to the pinned Detour binary.
3. Prove every advertised destination remains reachable in every required
   direction.
4. Sweep the production Rapier Walk capsule through every authored control
   point and every allowed direction, against the structural shell plus every
   default-active dynamic barrier. Every waypoint must be reached exactly;
   ordinary route arrival tolerance is not reused for controlled paths.
5. Freeze per-direction waypoint, simulated-step, path-length, and final-pose
   evidence into `spatial-navigation-v8`.
6. Run the unchanged V7 structural-shell probes and human approval gate.

A blocked landing, zero-length segment, unsupported kind, missing review
receipt, disconnected destination, or collision-obstructed controlled path is a
named build failure. It never degrades to a blank viewer or a silent teleport.

## Published runtime

Normal movement stays with Detour plus Rapier. When a Walk-mode camera enters a
reviewed endpoint and supplies movement input toward the first reviewed path
segment, a small traversal state machine
takes ownership for only that path interval. It advances at the authored speed
through the frozen control points, and every browser frame is swept by the
Rapier capsule. On completion, normal Walk movement resumes on the destination
landing. Fly mode remains ordinary structural-shell flight and does not
auto-trigger a traversal.

The same contract covers all three kinds:

- `elevator` carries the camera through a reviewed cabin or shaft path;
- `ladder` follows a reviewed climbing path; and
- `moving_platform` follows the reviewed platform travel path.

The Gaussian scene itself is static. V8 controls collision-safe camera travel;
it does not synthesize animated visual geometry, infer door timing, or claim
that an unobserved platform exists. A dynamic door can continue to use the V7
barrier contract; if it remains closed, the controlled traversal fails closed.

## Operator flow

1. Open **Edit scene -> Routes and movement runtime**.
2. Choose **Author vertical traversal**.
3. Record the path and review receipt from registered evidence.
4. Queue **Build verified navigation**.
5. Inspect the Recast, route, Rapier traversal, and structural evidence.
6. Approve the exact build, then publish a new numeric release revision.

An authored path invalidates an older approval until this build and review flow
finishes.

Automatic floor-plan collision cooks use the same durable traversal registry,
evidence receipts, profile, and authoring hash as a manual build. They never
replace the registry with an empty link list.
