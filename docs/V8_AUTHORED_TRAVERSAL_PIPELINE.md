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
- the SHA-256 and complete numeric `sourceToWorld` value from that capture
  contract's reviewed `capture-to-scene-registration-v1` receipt.
- the capture-frame path points from which the Worker derives the complete
  scene-world path. World-only manual paths are not qualified.

A merely uploaded or checksum-verified asset is not sufficient. The Worker
recomputes the canonical capture-manifest hash, verifies the selected asset and
SHA against the manifest, binds the manifest's project, version, adapter, and
verified immutable manifest asset, and rejects a poster or unrelated derivative
that was not explicitly assigned the traversal-evidence role. Every review decision
increments a generation that is frozen into the traversal. Changing the review
invalidates the authoring hash; accepting the same manifest again does not
resurrect an older traversal or navigation approval. The traversal must be
requalified and rebuilt against the new generation.

The registration receipt maps a named capture frame into the platform's
right-handed, Y-up metric scene frame. It freezes the immutable evidence asset
and digest, source up axis, metres per source unit, yaw, translation, and
operator/vendor method. The Worker independently hashes that canonical payload,
then hashes the containing capture manifest. A missing transform, a left-handed
frame without an adapter conversion, unit/up-axis mismatch, evidence drift, or
hash mismatch cannot appear as a traversal-evidence option.

Registered traversal authoring and builds therefore require the version's
navigation profile to use metres. A provisional `scene_units` profile can
still support visual-only navigation, but it cannot accept or build a
capture-registered vertical traversal, and an active registered traversal
prevents unit relabelling.

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
adapter, manifest SHA-256, and registration SHA-256 so a future device or engine adapter can
synchronise its own authored model without changing collision evidence. Legacy
software-validation artifacts remain readable, but they receive no qualified
overlay or qualification claim. A dynamic door can continue to use the V7
barrier contract; if it remains closed, the controlled traversal fails closed.

## Operator flow

1. Register the XGRIDS, FJD, or other vendor-neutral capture contract and mark
   the truthful supporting asset as **Traversal evidence**.
2. Bind the capture frame to scene world using an immutable export/control
   asset. Today the operator records evidence-derived yaw and translation and
   acknowledges the manual registration. Versioned XGRIDS/FJD metadata
   extraction remains to be implemented and qualified against licensed files.
3. Review and accept the non-blocked capture contract.
4. Open **Edit scene -> Routes and movement runtime**.
5. Choose **Author vertical traversal** and select the accepted manifest receipt.
6. Record feet-level points in the capture frame. The Worker derives and stores
   the scene-world path; it never accepts a qualified world-only path.
7. Queue **Build verified navigation**.
8. Inspect the Recast, route, Rapier traversal, and structural evidence.
9. Approve the exact build, then publish a new numeric release revision.

An authored path invalidates an older approval until this build and review flow
finishes.

Automatic floor-plan collision cooks use the same durable traversal registry,
evidence receipts, profile, and authoring hash as a manual build. They never
replace the registry with an empty link list.

## Remaining qualification boundary

The v9 software receipt now proves the exact reviewed numeric mapping and
capture-frame path, derives the scene-world path, and freezes both through the
offline build and artifact. An authenticated review endpoint rotates the
expiring bearer without changing the logical session id; the server resolves
the full receipt from the frozen release and assigns a monotonic per-session
event sequence. The authoritative auth-session-derived id makes lost responses,
reloads, and concurrent same-session tabs idempotent without browser storage.
Lifecycle enforcement retires expired rows; advancing,
rolling back, revoking, or expiring the active channel immediately invalidates
the session and bearer, while the row ages out on its credential expiry. An
idle tab that resumes after row cleanup
reconstructs the same server-derived session UUID and continues its sequence
from immutable events, so this lifecycle needs no guessed renewal grace.
The channel increments a monotonic activation generation on publish, rollback,
and retirement. That generation is signed and included in the database guard
and session identity, so R1 to R2 to R1 cannot merge evidence or resurrect an
R1 bearer.
One authoritative auth session maps to one evidence row per activation. The
server-derived identity makes concurrent tabs and unavailable or evicted
browser storage converge on that row; distinct physical devices authenticate
separately. Ingestion and the database trigger require that auth session,
membership, and reviewer project access to remain active, so logout or access
revocation stops qualification evidence immediately. Expired rows drain through the indexed, measured lifecycle lane
recorded in `docs/CAPACITY_RECEIPTS.md`, with provider rows-read/written and
bounded pending-backlog state returned to the operator.
Studio preserves the complete export SHA-256 rather than a shortened display
prefix.
Production activation still requires automatic vendor metadata extraction for
the supported licensed exports and an actual registered
capture in which an elevator, ladder, or moving platform is visible. The
resulting physical device evidence must pass
the capture contract, offline build, controlled Rapier replay, browser
traversal, and the measured phone matrix. Synthetic fixtures prove the software
contract; they do not prove a physical installation. Physical runs use the
[qualification matrix template](verification/physical-navigation-matrix-template.md),
which binds device evidence to the exact navigation, capture-manifest, and
registration hashes.
