# Frontend architecture

The frontend has three runtime style boundaries:

- Studio imports `src/client/styles/studio-entry.css`;
- the public marketing page and published viewer import
  `src/client/styles/viewer-entry.css`; and
- the Spark renderer keeps its independent `src/renderer/styles.css`.

The public HTML hosts both marketing and viewer states, so those styles share
an entry. Every viewer selector is rooted at `.viewer-page`; switching the
body to `.marketing-page-body` therefore removes full-viewport viewer
behavior without depending on source order.

## Cascade and ownership

Entry files declare the layer order and contain imports only. Imported files
contain one matching layer:

| Owner | Responsibility |
| --- | --- |
| `primitives.css` | tokens, reset/base rules, buttons, feedback, brand, and shared state |
| `marketing.css` | marketing page composition and motion |
| `studio.css` | Studio shell, workspaces, records, dialogs, and responsive rules |
| `viewer.css` | published-viewer canvas, HUD, navigator, review, and overlay geometry |
| `exceptions.css` | hidden content, screen-reader content, forced colors, and other accessibility exceptions |

Component-responsive rules stay in the component owner. Studio code must not
reintroduce `body.studio-page .component` specificity escalation. Viewer
rules retain one explicit `.viewer-page` boundary because marketing and the
viewer share an entry. Page-root overflow masking is forbidden except for the
published viewer's documented full-viewport app boundary.

Run `npm run audit:css` after changing CSS. The audit checks the entry import
graph, layers, component owners, duplicate core declarations, undefined custom
properties, ID selectors, page-root overflow, viewer scoping, and the
accessibility-only `!important` policy. It is part of `check:static`.

## UI contracts

- `src/client/studio/ui/dom.ts` owns typed element creation, empty states, and
  surface-role annotation.
- `src/client/feedback.ts` owns field errors and action feedback, including
  ARIA description wiring.
- `src/client/action-state.ts` owns pending, disabled, retry, and asynchronous
  action feedback behavior.
- standard dialogs are normalized into header, one scrollable body, and footer
  regions before opening.
- repeated records use the explicit `record-primary`, `record-status`,
  `record-evidence`, and `record-actions` slots. They are a composition
  contract rather than one universal row component because project, release,
  queue, team, review, and hosting records have different semantics.

Do not create a new card/error/status class combination when one of these
contracts represents the state. A domain renderer receives its data and
callbacks explicitly. `src/client/studio/stages/compare.ts` and
`src/client/studio/stages/process.ts` are the current stage boundaries; API
and global Studio state remain in the controller.

## Responsive contract

The supported viewport and transition matrix is executable in
`e2e/ui-quality.spec.ts`, `e2e/release-authoring.spec.ts`,
`e2e/published-viewer.spec.ts`, and `e2e/mobile-renderer.spec.ts`. Those
tests are the receipts for the 1100/961/960 shell transition, narrow record
representations, coarse-pointer targets, short dialogs, and viewer overlay
ownership. Do not add a breakpoint without adding a measured composition
assertion at both sides of that breakpoint.

| Condition | Owning change | Receipt |
| --- | --- | --- |
| at or below 1100 px | dense release records leave their desktop table representation | `ui-quality.spec.ts` record composition matrix |
| 961 px to 960 px | the Studio sidebar changes from a side rail to the stacked shell without changing the active workspace to a second track | transition-width sweep in `ui-quality.spec.ts` |
| at or below 900 px | project section tabs become the native section picker; comparison composition becomes one column | `release-authoring.spec.ts` route/picker matrix |
| at or below 760 px | narrow Studio controls and the published-viewer top bar use their compact representations | `ui-quality.spec.ts` and `release-access-code.spec.ts` |
| at or below 640 px | operational records use named mobile slots and standard dialogs become full viewport | record and dialog composition tests in `ui-quality.spec.ts` |
| at or below 480 px | Studio action groups and compact forms become one column | small-phone matrix in `ui-quality.spec.ts` |
| at or below 500 px high | dialog and viewer overlay owners use the short-height layout | short-dialog and overlay matrices in `ui-quality.spec.ts` and `published-viewer.spec.ts` |

These are component transitions, not a global “mobile” mode. The Studio entry
owns document flow, each record collection owns its representation, each
dialog body owns vertical scrolling, and the viewer/renderer exchange measured
overlay rectangles rather than subtracting a fixed viewport allowance.

## Migration ledger

The 2026-08-24 ownership migration removed the unused prototype viewer panels,
mode switch, hotspot/tour controls, obsolete Studio pipeline/output cards, and
removed Privacy-stage selectors. It also removed accidental important
declarations and replaced undefined static tokens. There is no retained legacy
layer: every remaining rule has a named owner.
