# Accessibility floor and verification contract

## Scope

Issue #66 owns legibility, accessible names, effective hit targets, status
semantics, visible focus, text reflow, forced colors, and automated accessibility
checks. Dialog composition remains #67. Viewer overlay reachability remains #68;
the #66 viewer test deliberately exposes the current navigator to isolate its
target and focus behavior until #68 removes the suppression.

## Type policy

The production type tokens are the contract:

- 11px captions are allowed only for secondary annotation.
- 12px is the floor for operational labels, status, metadata, and actions.
- 13px is the floor for body copy and input values.

Viewer release state, access labels, floor-plan controls, barrier labels, and
Studio status chips use the label token. Decorative or explanatory captions
may retain the caption token.

## Target policy

The issue-defined target standard is 40 CSS pixels for fine-pointer controls
and 44 CSS pixels for coarse-pointer controls. The visual checkbox may remain
18px because the containing label is the interactive target. Project-selection
cells are labels, so clicking blank space inside the cell toggles the input and
does not open the project.

## Names, status, and focus

`bindDialogSemantics()` gives every dialog an accessible name and supplies a
specific close label for icon-only close controls. Visible-text Cancel controls
keep their own name. Status dots and project state markers are decorative and
hidden from assistive technology because adjacent text owns the status.

Focus rings are inset where an overflow-clipped surface would otherwise cut
them off. Forced-colors rules use system colors for focus, selected/expanded
state, status borders, and disabled controls without lowering opacity.

## Verification

- Axe WCAG A/AA scans run on Projects, Published previews, Team access, the
  capture dialog, the public access-code gate, viewer navigation, and renderer
  chrome. The Turnstile test stub, canvas, and renderer iframe are excluded
  only where their internals are verified separately.
- Fine-pointer tests measure effective project selection and visible controls.
- A touch-enabled Chromium context measures project, checkbox, dialog close,
  comparison-sync, access, navigator, and barrier targets.
- Forced-colors tests assert media activation, keyboard focus, expanded-state
  borders, and readable disabled controls in Studio, viewer, and renderer.
- Reflow is exercised both at a 640px CSS viewport (the 1280px-at-200%-zoom
  equivalent) and with the root font size doubled for Studio, a dialog, and the
  access-code form.
