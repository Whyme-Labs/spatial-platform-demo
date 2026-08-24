# Long-term Studio redesign acceptance

This ledger closes the redesign checklist raised against `main` at `6348b3e`.
It records the current implementation, the executable evidence that protects it,
and the boundary of what was actually verified. The redesign itself landed in
`4098454` and `7f99efa`; the production-scale local audit subsequently found and
fixed five bounded-inventory failures.

## Evidence boundary

- Product behavior was exercised from the production Vite bundle through local
  Wrangler with isolated D1, R2, KV, Queue, and email bindings.
- Test identities use `example.invalid`; no customer, staging, or production data
  was read or changed.
- The controlled novice E2E drives every redesign stage through visible browser
  controls. Its processing transitions are deterministic route fixtures, not an
  external processor or scanner run.
- The local production-scale receipt exercises real authentication, persistence,
  role enforcement, list boundaries, and browser rendering. It does not claim a
  physical capture-device qualification or a production deployment.

## Phase closure

| Phase | Accepted result | Executable evidence |
| --- | --- | --- |
| 1. First-class stages | The project route model includes overview, process, structure, compare, publish, measurement, and expert. Stage controls update the URL, `aria-current`, focus, and history; a project opens at its first incomplete mandatory stage. The stable project context names the current stage, exact blocker, and next action while Process owns operational progress and qualification. | `src/client/studio.ts` (`ProjectSection`, `projectWorkspaceModel`, `renderProjectContext`, `renderProcessWorkspace`, `activateProjectSection`); `e2e/release-authoring.spec.ts` (dedicated workspace, Process routing, keyboard stage activation, Back/Forward, blocked-state cases) |
| 2. Mandatory work outside Expert | Structure and publication are routed workspaces. The privacy stage was removed with automated privacy detection: privacy review happens outside the platform and is recorded as the operator's confirmation at QA. The walk stage dissolved once it held neither a walk test nor its own viewer: routes, the walking profile, and vertical traversals are structural authoring, and build receipts are raw evidence Expert already owns. The Expert route owns raw capture evidence, manual extraction, raw entity geometry, build receipts, and recovery controls. The old mandatory “Advanced evidence and diagnostics” owner is forbidden by the control audit. | `studio.html` project navigation; `src/client/studio.ts` (`renderSpatial`, `renderPublish`); `scripts/audit-control-wiring.mjs`; first-class-stage E2E |
| 3. New-scene intake | Intake is a three-step Scene details → Capture files → Review and process wizard. It uses task-level file labels, vendor guidance, conservative filename inference, PLY coordinate preflight, hard mismatch blocking, fallback-only attestation, always-visible required organisation fields, an optional-field count, an explicit two-file walkable-scene contract, and a generated processing plan. | `studio.html#newProjectDialog`; `src/client/studio.ts` (`inferNewCaptureAdapter`, `pairedCaptureCanQualifyAutomatically`, `renderNewCaptureHelp`, `renderNewCaptureReview`); `scripts/capture-compatibility-core.mjs`; `e2e/ui-quality.spec.ts`; `test/capture-compatibility.spec.ts` |
| 4. Task-level structure, movement, and publication | The registered render is the default structure editor; raw plan JSON is Expert-only. Walking profiles use presets, build bounds derive from approved structure, and starting positions are selected in the rendered scene. The scene has exactly one viewer — the page a recipient opens — reached from the Overview private-preview action before publication or the canonical release route afterwards. Studio does not embed a second copy of the renderer. A stopped walker is told which authority refused the step (reviewed barrier by name, walking-map clearance, or the edge of the captured floor) in that viewer's own HUD. Walking the scene is a check, not a publication gate. Publication exposes quality presets and Use current view; accepted transforms are read-only; the measurement disclaimer is generated from the approved grade. | `src/client/studio.ts` (`renderSceneAuthoringWorkspace`, `syncNavigationClearancePreset`, `openNavigationBuildDialog`, `syncReleaseTransformModes`, `syncReleaseQualityPreset`, `setProvisionalReleaseDisclaimer`); `studio.html` expert disclosures; release-authoring E2E and shared-policy unit tests |
| 5. Orphan capability decisions | Portfolio tools are exposed to platform administrators. Templates are selectable and apply behavior-driving workflow policy. Saved views and adapter/delivery filters are reachable. Customer email, capture source, and delivery classification are editable. Delivery classifications select canonical publication, navigation, measurement, hosting, quality, required-file, structure, and clearance policy. Phone/video and drone values are explicitly grouped as specialist evidence sources rather than primary walkable-scene sources. | `studio.html`; `src/client/studio.ts`; `src/shared/project-policies.ts`; `e2e/ui-quality.spec.ts`; `test/project-policies.spec.ts` |
| 6. Stronger automated audits | The audit rejects missing HTML IDs, unbound controls, missing destinations, hidden required controls, missing mandatory stage routes/actions, mandatory work under Advanced, template models without application, native publication confirmations, field labels/audiences/units/consumers/readback gaps, and static hidden actions without a visible-state transition or an explicit reachability contract. | `scripts/audit-control-wiring.mjs`; `scripts/audit-action-state.mjs`; `npm run check`; reachability hardening in `6160bc5` |
| 7. Machine-readable field registry | Every authenticated Studio form is governed. The registry expands to 246 lifecycle fields and records audience, stage, requiredness, request path, persistence path, consumer, readback, units, and expert explanations. The build fails when a visible named field is absent or its declared lifecycle disagrees with the UI/source. | `config/studio-field-registry.json`; `scripts/audit-control-wiring.mjs`; `docs/verification/user-facing-inventory.md` |
| 8. Novice-operator E2E | One browser test creates a scene, uploads both files, reviews the processing plan in Process, inspects structure graphically, records the publication review, approves QA, and publishes using visible controls only. It asserts that raw coordinate, raw JSON, Recast, and numeric budget controls remain hidden in the recommended path. | `e2e/release-authoring.spec.ts` (`a novice can upload, inspect the project workflow, and publish using visible controls`); expert-boundary regression in `246ef80` |

## Acceptance criteria

| Criterion | Result | Receipt |
| --- | --- | --- |
| Mandatory stages visible and clickable | Pass | Routed navigation, stable project context, Process workspace, and novice-workflow E2E |
| Active stage semantics and keyboard/history behavior | Pass | `aria-current` plus keyboard Enter and Back/Forward regression |
| Required fields outside closed disclosures | Pass | static audit plus dynamic custom-field E2E |
| One obvious next action and exact blockers | Pass | first-incomplete routing and blocked processing/structure/publication cases |
| No specialist engine jargon in the novice path | Pass | raw JSON/coordinate/Recast/budget visibility assertions |
| Graphical geometry and current-camera entry | Pass | render-native authoring and Use current view E2E |
| Expert settings optional, never a mandatory stage owner | Pass | route split, form disclosures, and mandatory-Advanced audit |
| Privacy and walkability first-class | Pass | publication review plus structural movement controls and novice workflow |
| Every governed field has consumer and readback | Pass | 246-field registry audit |
| No known permanently hidden actionable subsystem | Pass | product reachability E2E plus hidden-action audit |
| Full novice browser workflow | Pass in controlled E2E | deterministic browser route fixture; external processor is outside this receipt |
| Role boundaries | Pass locally | real OTP sessions for platform admin, production operator, customer reviewer, and customer read only; direct API denials verified |

## Production-scale local findings closed after the redesign

The accepted synthetic receipt contains one item beyond every measured bounded
inventory: 201 projects, 101 templates, 51 saved views, 201 query-visible jobs,
and 501 releases. It found five shared pagination failures:

1. project custom-field readback exceeded D1 SQL variables (`fc03e73`, regression `28f0905`);
2. projects beyond row 200 had no continuation (`888a609`, regression `952c789`);
3. templates and saved views stopped at 100 and 50 (`81d241d`, regression `f0b42ff`);
4. releases stopped at 500 (`81d241d`, regression `7910fc2`);
5. jobs stopped at 200 (`81d241d`, regression `1b5be6a`).

All five now use bounded, stable continuation; the UI names that more results
exist, de-duplicates by ID, makes the action single-flight, and removes it when
the cursor is exhausted. Reproduction and screenshots are retained in the local
ignored report at `.gstack/qa-reports/qa-report-localhost-2026-08-10.md`.

## Reproduction

```sh
npm run audit:inventory
node scripts/audit-control-wiring.mjs
node scripts/audit-action-state.mjs
npx playwright test e2e/release-authoring.spec.ts
npm run check
```

The authoritative inventory is generated by `npm run inventory:write`; a stale
inventory fails `npm run audit:inventory`.

## Final gate receipt — 2026-08-10

`npm run check` exited successfully from the final tree:

- 4 roles, 190 routes, 244 governed fields, 316 controls, 68 persisted state
  sets, and 59 asynchronous workflows inventoried;
- 58 migrations declared and consistent;
- 84 navigation tests passed;
- 57 Worker test files and 335 tests passed;
- coverage: 71.28% statements, 60.77% branches, 85.23% functions, and 77.81%
  lines;
- 84 Playwright tests passed;
- the production deployment configuration completed `wrangler deploy --env
  production --dry-run` without mutation.
