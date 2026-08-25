# Final Impeccable Studio gate — 2026-08-25

Issue #86 is the convergence gate after #79–#85. This record distinguishes the
visual polish decision, the post-fix design critique, the technical audit, and
the final executable receipts.

## Dependency state

Issues #79, #80, #81, #82, #83, #84, and #85 were closed before this gate.
Issue #79 merged as `7ec40e2`; the issue #86 branch starts from that mainline.

## Bounded polish pass

The desktop, laptop, tablet, phone, small-phone, short-landscape, processing,
loading, empty, long-record, and validation baselines were reviewed together.
The pass found one P1 responsive defect: the fully expanded mobile
workspace/account stack pushed Upload capture and Current production below the
initial working plane at 320×568 and 844×390.

The final change keeps the brand and primary navigation visible while reducing
the default workspace/account area to one compact row. A multi-organisation
switcher still expands to its complete surface. Short landscape uses one
horizontal brand/navigation row and a single-line portfolio headline. The
visual test now fails unless Upload capture and the Current production heading
are fully visible in the initial viewport at phone or short-landscape sizes.

The reviewed Linux baselines contain 29 PNGs and 1,498,021 bytes. Their hashes
are frozen in `e2e/visual-baselines.sha256`; `npm run audit:visual-baselines`
passes.

## Post-fix critique

Method: dual-agent (`issue86_critique_a_retry` design review and
`issue86_critique_b` detector/browser evidence).

| Nielsen heuristic | Score |
| --- | ---: |
| Visibility of system status | 4 |
| Match with the real world | 4 |
| User control and freedom | 3 |
| Consistency and standards | 3 |
| Error prevention | 3 |
| Recognition rather than recall | 3 |
| Flexibility and efficiency | 3 |
| Aesthetic and minimalist design | 4 |
| Error recovery | 3 |
| Help and documentation | 3 |
| **Total** | **33/40** |

The previous critique scored 31/40 with two P1 findings. The post-fix snapshot
scores 33/40 with zero P0 and zero P1 findings and is stored at
`.impeccable/critique/2026-08-25T05-15-03Z__studio-html.md`.

The specificity verdict is pass: the integrated Current production surface,
Work/Evidence/Publish journey, single Refine disclosure, evidence typography,
line-led field-dark surfaces, and rare Survey Lime signal are authored for
spatial production rather than interchangeable dashboard styling.

## Technical audit

| Dimension | Score | Receipt |
| --- | ---: | --- |
| Accessibility | 4/4 | Axe WCAG A/AA, keyboard focus, forced colors, doubled text, 12 px rendered operational floor, 40/44 px target audits |
| Performance | 3/4 | route-level transfer receipt and lazy boundaries are measured; no arbitrary byte or latency cap is claimed |
| Theming | 4/4 | layered CSS ownership, semantic tokens, no undefined static values, zero accidental `!important`, negative semantic-color fixture |
| Responsive design | 4/4 | 1440, 1280, 1100, 1024, 961, 960, 768, 390, 320, and 844×390 evidence plus the initial-working-plane tripwire |
| Implementation integrity | 4/4 | action, control, inventory, visual, production-config, migration, type, build, and route audits pass |
| **Total** | **19/20** | **Excellent; zero P0 and zero P1 findings** |

The first audit pass found one closure blocker: the generated user-facing
inventory was stale after Upload capture gained browser assurance. Running
`npm run inventory:write` produced the reviewed one-row assurance change, and
`npm run audit:inventory` now passes for 4 roles, 184 routes, 246 fields, 305
controls, 69 persisted state sets, and 59 workflows.

## Detector and browser limitations

The Impeccable CLI detector ran exactly once and returned exit 0 with `[]`.
`htmlparser2`, `css-select`, `css-tree`, and `domutils` were unavailable, so the
scan used its regex fallback and did not evaluate computed contrast, custom
properties, or selector matching. This is an undercount, not a clean proof.

Mutable browser injection succeeded in a fresh isolated tab, but subagent
visibility was unsupported. The raw static fallback did not transform the
TypeScript CSS import, so its Arial and heading-rhythm findings were verified
false positives against the actual Manrope Studio entry and reviewed compiled
screenshots. The overlay server, static server, injected tags, tab, ports, and
temporary live state were all removed.

## Final executable receipt

`npm run check` passed on 2026-08-25:

- 451 Worker/domain tests across 78 Vitest files;
- 135 navigation and migration contracts across 17 node-test files;
- 133 Playwright scenarios across 12 browser specs;
- 72.98% statements, 63.46% branches, 86.18% functions, and 79.25% lines;
- generated Cloudflare types, TypeScript, CSS ownership, visual hashes,
  action-state, control wiring, user-facing inventory, production config,
  migrations, production build, and Cloudflare production deployment dry run.

The route receipt was regenerated after the final markup/CSS change. Protected
Studio routes still load zero renderer/navigation chunks; viewer routes still
request zero marketing images. Those zero structural counts remain the
enforced tripwires. Route byte and timing observations remain receipts rather
than invented performance limits.

## Final merge-review follow-up

The merge review found two non-visual P1 defects after the complete gate: the
compact mobile presentation hid the workspace role and the “Open” prefix from
assistive names, and the generated design sidecar omitted the new Studio
Operational Floor narrative rule. The role and prefix now use visually-hidden
presentation while remaining in the accessibility tree, and the sidecar is
synchronized with `DESIGN.md`.

After those changes, `npm run audit:css`, the E2E TypeScript check, four focused
Studio accessibility/type/target/visual tests, the eight-test pinned
Ubuntu/Chromium visual suite, the production build, and the frontend route
audit all passed. The route receipt was regenerated again for the final CSS
chunk identity.

## Non-blocking watch points

- Validate the compact 320 px account row with translated copy when
  localization becomes product scope.
- Observe a genuinely busy processing queue before adding another next-action
  treatment; current evidence does not justify more UI.

No temporary wrapper, generated design variant, running test server, or
unreviewed screenshot drift remains in the tracked gate artifacts.
