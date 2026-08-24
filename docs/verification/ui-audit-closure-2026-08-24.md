# UI audit closure

This document reconciles
`spatial-platform-demo-ui-audit-2026-08-22.md` against the current remediation
branch on 2026-08-24.

The audit was a report, not an instruction source. Its baseline was
`4d463bc3f6c956b65c6bb82dbf6ed2bd7a0e16ed`; remediation started from current
`main` at `16b6825`, after Privacy and Walk had already been removed and
Team access had become a primary destination. The implementation therefore
preserves those current product decisions instead of restoring the audit's old
tab inventory.

## Issue and commit ledger

| Issue | Delivered commit | Result |
| --- | --- | --- |
| #60 responsive shell | `c8a145e` | one active workspace track, no Studio root overflow mask, transition proof |
| #63 feedback | `0c0468e` | shared field/action failure contract and ARIA ownership |
| #61 and #62 hierarchy/task composition | `6a62939` | stable project context, first-class Process route, depth limit, archived recovery |
| #64 responsive records/navigation | `66ce74a` | explicit record slots and native compact project picker |
| #66 accessibility floor | `a35a6d3` | rendered type/target floors, Axe, zoom, forced colors |
| #67 dialogs | `99d289e` | stable task shell, one scroll owner, bounded feedback, draft/focus handling |
| #68 viewer overlays | `0d20ec1` | measured cross-frame occupied zones and explicit ownership transfer |
| #69 cascade/primitives | `d779049` | page-owned layered CSS, typed surfaces, Process module, static ownership gate |
| #65 visual/composition gate | `e187d4b` | reviewed responsive baselines, state matrix, pixel sweep, CI diff artifacts |

These commits are local to `codex/fix-ui-audit-responsive-shell`. GitHub
issues #60–#70 remain open until the branch is reviewed and landed; local
qualification is not represented as remote completion.

## Finding-by-finding reconciliation

| Finding | Disposition | Evidence |
| --- | --- | --- |
| F-01 breakpoint inversion | Fixed | one authoritative `.studio-grid`; 945–1110 px sweep |
| F-02 stretched side panel | Fixed | active workspaces are routed one at a time and align to content |
| F-03 page overflow masking | Fixed | Studio root mask removed; component/root ownership audited |
| F-04 viewport versus content width | Fixed by subtraction | no competing side workspace; record owners change representation |
| F-05 mobile as one long column | Fixed | stable context/task routes, disclosures, compact records |
| F-06 hidden section navigation | Fixed | native project picker; visible two-column global phone navigation |
| F-07 visual/DOM queue order | Fixed | Processing is a dedicated route in logical DOM order |
| F-08 card as universal hierarchy | Fixed | explicit surface roles and flat record slots |
| F-09 compounded padding | Fixed and measured | flattened project sections reclaim measured width |
| F-10 oversized empty cards | Fixed | compact empty-state primitive and reviewed empty baseline |
| F-11 borders instead of hierarchy | Guarded | normal actions permit at most two bordered ancestors |
| F-12 surface importance ambiguity | Fixed | task, record, notice, and modal roles own their treatment |
| F-13 current task not dominant | Fixed | project stage, blocker, next action, and routed task stay together |
| F-14 history competes with controls | Fixed | history and technical evidence live in disclosures/routes |
| F-15 equal-weight pipeline strip | Removed | obsolete lifecycle strip deleted |
| F-16 weak deep links | Fixed | project/section route, reload, Back, and picker share one router |
| F-17 administration near routine work | Fixed | portfolio exposes one selected task; other tools retain routes |
| F-18 overloaded `.form-error` | Fixed | FieldMessage and ActionFeedback have separate owners |
| F-19 viewer error touches action | Fixed and measured | contained callout plus positive action/error separation assertion |
| F-20 field errors not linked | Fixed | invalid state, error ID, description, and focus are shared behavior |
| F-21 blank error bands | Fixed | empty feedback is removed from layout |
| F-22 action versus validation state | Fixed | action-state and feedback modules expose distinct states |
| F-23 long server-message containment | Fixed | wrap, bounded dialog feedback, long-ID fixtures |
| F-24 incomplete recovery pattern | Fixed | retryability, retained state, request reference, and safe retry remain together |
| F-25 overflow-only record tests | Fixed | usable slots, action containment, and internal-width assertions |
| F-26 implicit column priority | Fixed | primary/status/evidence/action slots are explicit |
| F-27 desktop rows on mobile | Fixed | named mobile grid areas and action disclosures |
| F-28 long identifiers | Fixed | exact contract-max fixtures, wrap/truncate/copy behavior |
| F-29 large-list risk | Measured/guarded | 0/1/10/100 fixture, pagination, selection and containment; virtualization remains demand-led |
| F-30 9–11 px operational text | Fixed | rendered operational floor is 12 px |
| F-31 small checkbox targets | Fixed | labelled row target and coarse-pointer geometry |
| F-32 color-only status | Fixed | textual status accompanies markers; forced-colors state is explicit |
| F-33 focus clipping/order | Fixed | focus-visible, modal containment/restoration, and routed heading focus |
| F-34 zoom/forced colors | Fixed | doubled-text, reflow, forced-color and coarse-pointer tests |
| F-35 live-region duplication | Fixed | one action owner; records cannot own nested live regions |
| F-36 multi-purpose dialogs | Fixed | portfolio exposes one selected task at a time |
| F-37 unstable dialog regions | Fixed | persistent header, one scroll body, footer and bounded feedback |
| F-38 short landscape | Fixed | full-viewport short mode with reviewed baselines |
| F-39 draft loss | Fixed | dirty close/Escape confirmation and focus restoration |
| F-40 two overlay layers collide | Fixed | shared renderer-measured rectangle contract |
| F-41 hidden control discoverability | Fixed | free-roam navigator stays reachable; ownership restores controls |
| F-42 fixed navigator subtraction | Fixed | measured zones and short-landscape side allocation |
| F-43 renderer strengths | Retained | safe-area, pointer and motion adaptations remain renderer-owned |
| F-44 competing help layers | Fixed | renderer help temporarily owns the viewport and outer controls yield |
| F-45 multiple cascade owners | Fixed | page entries and five named layers |
| F-46 specificity as migration | Fixed | no Studio page-root escalation; duplicate property owners rejected |
| F-47 monolithic rendering | Improved/guarded | Compare and Process are domain modules; new governed surfaces use typed constructors |
| F-48 no shared UI-state contract | Fixed | DOM surface, feedback, action, record and dialog contracts |
| F-49 guessed dead CSS | Fixed and measured | PostCSS inventory, deleted proved-dead rules, before/after receipt |
| F-50 unmeasured UI payload | Measured, non-blocking | production build reports page-owned CSS/JS chunks; no guessed optimization target |
| F-51 survival-only responsive tests | Fixed | composition, hierarchy, state and screenshot assertions |
| F-52 missing critical widths | Fixed | shared ten-viewport matrix |
| F-53 happy-path-only screenshots | Fixed | nine additional loading/empty/max/pending/error/dialog/overlay states |
| F-54 screenshots without geometry | Fixed | width, containment, separation, focus and protected-zone assertions |
| F-55 no breakpoint sweep | Fixed | every integer width from 945 through 1110 attaches a JSON receipt |

## Umbrella acceptance

- The primary task owns the Studio grid throughout the transition corridor.
- No secondary workspace stretches beside or compresses the active task.
- Normal task actions have no more than two bordered/elevated ancestors.
- Field and action errors are contained, singular, and programmatically linked.
- Dense collections declare responsive identity/status/evidence/action slots.
- Dialog and viewer overlay controls remain reachable in short landscape.
- Operational type, targets, focus, forced colors, and doubled text meet the
  documented accessibility floor.
- CSS has one owner per selector/property/condition, enforced by
  `npm run audit:css`.
- Twenty-nine reviewed PNGs and the geometry matrix are required by CI; failure
  artifacts contain actual, expected, and diff images.

The full decision trail is append-only in
`.audit/ui-audit-issues-60-70.tsv`. Numeric receipts and reproduction commands
are recorded in `docs/CAPACITY_RECEIPTS.md`.
