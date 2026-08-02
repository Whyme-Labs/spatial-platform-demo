# Authored traversal pipeline: v8 compatibility and v9 qualification

V9 extends the reviewed V7 structural shell with explicit 3D discontinuities.
It is for an elevator, ladder, or moving platform that exists in registered
evidence but cannot be represented as continuous walkable floor geometry. It
does not infer or fabricate one.

## Immutable authoring contract

An operator authors one version-scoped traversal with:

- a stable label and traversal kind;
- at least two feet-level 3D path points;
- one-way or bidirectional travel;
- an authored travel speed in the scene version's frozen world unit; and
- a review receipt identifying why the path is supported and safe to test;
- the UUID and frozen SHA-256 of a verified immutable asset from the same scene
  version that contains the supporting evidence; and
- the UUID, SHA-256, and capture adapter of an accepted, non-blocked capture
  contract that explicitly declares that asset as `traversal_evidence`.

A merely uploaded or checksum-verified asset is not sufficient. The Worker
recomputes the canonical capture-manifest hash, verifies the selected asset and
SHA against the manifest, binds the manifest's project, version, adapter, and
verified immutable manifest asset, and rejects a poster or unrelated derivative
that was not explicitly assigned the traversal-evidence role. Every review decision
increments a generation that is frozen into the traversal. Changing the review
invalidates the authoring hash; accepting the same manifest again does not
resurrect an older traversal or navigation approval. The traversal must be
requalified and rebuilt against the new generation.

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
5. Freeze per-direction waypoint, simulated-step, path-length, final-pose, and
   capture-review-generation evidence into `spatial-navigation-v9`. Legacy v8
   artifacts remain readable, but only v9 can carry the capture-contract
   qualification receipt. V8 is read-only at the Worker boundary: new
   processor completions and approvals cannot use it because it did not
   preserve requested landings separately from projected landings.
6. Preserve authored landings as `requestedStartPosition` and
   `requestedEndPosition`, separately freeze Recast's projected landings, and
   reject a projection outside the same measured build radius used by the
   cooker. Exact-compare the requested path and every semantic/receipt field
   with the Worker-frozen build parameters at processor completion and again at
   human approval.
7. Run the unchanged V7 structural-shell probes and human approval gate.

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

The Gaussian scene itself is static. V9 controls collision-safe camera travel;
it does not synthesize cabin walls, doors, machinery, infer door timing, or
claim that an unobserved platform exists. During an evidence-linked traversal,
the viewer draws a bright path line and moving marker explicitly as a navigation
overlay. It also emits a host event containing the connection id, phase,
adapter, and manifest SHA-256 so a future device or engine adapter can
synchronise its own authored model without changing collision evidence. Legacy
software-validation artifacts remain readable, but they receive no qualified
overlay or qualification claim. A dynamic door can continue to use the V7
barrier contract; if it remains closed, the controlled traversal fails closed.

## Operator flow

1. Register the XGRIDS, FJD, or other vendor-neutral capture contract and mark
   the truthful supporting asset as **Traversal evidence**.
2. Review and accept the non-blocked capture contract.
3. Open **Edit scene -> Routes and movement runtime**.
4. Choose **Author vertical traversal** and select the accepted manifest receipt.
5. Record the feet-level path and review receipt from registered evidence.
6. Queue **Build verified navigation**.
7. Inspect the Recast, route, Rapier traversal, and structural evidence.
8. Approve the exact build, then publish a new numeric release revision.

An authored path invalidates an older approval until this build and review flow
finishes.

Automatic floor-plan collision cooks use the same durable traversal registry,
evidence receipts, profile, and authoring hash as a manual build. They never
replace the registry with an empty link list.

## Remaining qualification boundary

The v9 receipt proves that an accepted capture contract declares the frozen
asset as traversal evidence. It does not yet prove numerically that the authored
path coordinates came from that asset: the capture contract currently records
a coordinate-frame description and registration method, not a frozen
capture-to-scene transform. Production activation therefore still requires that
transform receipt and an actual registered capture in which an elevator,
ladder, or moving platform is visible. The resulting device evidence must pass
the capture contract, offline build, controlled Rapier replay, browser
traversal, and the measured phone matrix. Synthetic fixtures prove the software
contract; they do not prove a physical installation.
