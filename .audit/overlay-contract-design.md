# Viewer and renderer overlay contract

## Boundary

The embedded renderer owns and measures its controls. It publishes an
`overlay-layout` message containing the rendered rectangles for toolbar,
status, help, movement pad, and altitude controls. The outer viewer validates
and clamps those same-origin measurements to the reported iframe viewport,
then exposes top, right, bottom, and left reservations as CSS custom
properties on the viewer viewport.

The contract lives in `src/shared/overlay-layout.ts`; neither side imports the
other page's implementation.

## Ownership modes

The outer viewer sends `set-outer-overlay-mode` with one of:

- `none` — renderer controls own their normal zones;
- `navigator` — the outer navigator owns the contextual movement zone;
- `review` — the outer review task owns that zone.

In navigator/review mode the renderer temporarily yields joystick, altitude,
and look-hint controls while keeping its labelled toolbar reachable. Closing
the outer task restores the movement controls. Free-roam never hides the only
navigator trigger.

Renderer help temporarily owns onboarding for the viewport. The outer HUD and
review panel become inert and visually hidden only while the renderer's
labelled Controls toggle is expanded; closing help restores them.

## Responsive priority

- Desktop uses vertical separation derived from measured renderer zones.
- Narrow portrait keeps the compact release and navigator controls above the
  review task; opening the navigator temporarily hides the review task.
- Short landscape divides contextual work into left and right columns. The
  right navigator can use the vertical space beside the yielded left movement
  zone instead of subtracting its height.
- In the most constrained review layout, the two persistent release/navigation
  controls remain visible and the review panel starts below them.
- Transient movement-blocked evidence lives inside release information and is
  collapsed only while the navigator itself owns the short-landscape space.

Safe-area variables wrap both outer overlays and the page shell. Tests inject
non-zero inset values and verify the resulting bounds.

## Verification

- The real renderer emits rectangle receipts after layout, help, status,
  movement-mode, and resize changes.
- The renderer hides and restores its movement zone in response to the typed
  outer-mode command.
- The public viewer checks release HUD, review, help, navigator, safe areas,
  transient blocked-movement text, and renderer-mode receipts at desktop,
  tablet, phone, small phone, and short landscape sizes.
- The access-code fixture proves the navigator remains reachable for a coarse
  pointer without test-only class removal.
- Existing renderer geometry tests continue to protect toolbar/status/help/
  joystick/altitude separation and reduced-motion behavior.
