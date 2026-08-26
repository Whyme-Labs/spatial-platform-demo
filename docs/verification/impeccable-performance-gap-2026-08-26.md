# Impeccable performance-gap closure — 2026-08-26

Issue #95 follows the final issue #86 gate. It addresses the only remaining
technical-audit deduction: performance had route-transfer and lazy-loading
receipts, but no reproducible throttled-mobile paint, stability, or interaction
measurement for the current Studio bundle.

## Current-build receipt

`npm run audit:frontend-routes` now runs an authenticated Studio portfolio at
412x823 and 1.75 device scale with a 4x CPU slowdown and Lighthouse's adjusted
direct-CDP Slow 4G profile: 562.5 ms request latency, 188,743 B/s download, and
86,400 B/s upload. The profile is frozen in
`config/frontend-route-receipts.json` with separate viewport and network
sources pinned to Lighthouse commit `f9cbf2b`. The route
opens Refine and switches Published then Current so the measurement covers an
actual portfolio interaction instead of only initial paint.

The stored run measured:

| Measure | Result | Gate |
| --- | ---: | ---: |
| First Contentful Paint | 1,676 ms | 1,800 ms |
| Largest Contentful Paint | 1,676 ms | 2,500 ms |
| Cumulative Layout Shift | 0.000135 | 0.1 |
| Longest tested interaction | 152 ms | 200 ms |

The LCP element was `h1#viewTitle`. Chromium observed three distinct scripted
interactions: opening Refine took 152 ms, Published took 24 ms, and Current took
32 ms. It also observed three long tasks, with the longest at 146 ms. Long-task
count and duration are recorded observations, not invented limits. The
interaction value is the maximum browser Event Timing duration in this bounded
flow, not production field INP.

All four enforced measures are within their published good-experience
boundaries. No measured bottleneck justified a UI or bundle change. The durable
change is the measurement itself: CI now fails with the metric name, limit,
requested value, and receipt path when a threshold is crossed. It also fails
closed when the browser lacks or cannot install an LCP, layout-shift, event, or
long-task observer; when FCP or LCP has no positive sample or identified LCP
element; or when fewer than the three receipted interactions are observed. A
receipt regeneration is audited before it is written, so an over-budget run
cannot replace the passing baseline.

## Score reassessment

| Dimension | Previous | Current | Basis |
| --- | ---: | ---: | --- |
| Accessibility | 4/4 | 4/4 | unchanged executable WCAG, keyboard, forced-colors, text-scale, type, and target receipts |
| Performance | 3/4 | 4/4 | current-build throttled-mobile paint, layout-shift, interaction, long-task, transfer, and lazy-boundary receipts |
| Theming | 4/4 | 4/4 | unchanged CSS ownership and semantic-token receipts |
| Responsive design | 4/4 | 4/4 | unchanged reviewed viewport matrix and transition tripwires |
| Implementation integrity | 4/4 | 4/4 | performance route is part of the existing CI frontend audit |
| **Total** | **19/20** | **20/20** | **No P0 or P1 finding remains in the audited scope** |

The design critique remains 33/40. Its seven-point difference from a perfect
heuristic score reflects P2 product-depth opportunities, not unresolved
correctness or polish defects, so this performance receipt does not rewrite
that historical critique.

## Scope boundary

The receipt runs against the locally built current branch. An authenticated
Chrome check found that the live production Studio was still serving an older
pre-#79–#86 interface, so production timing was treated as informative only
and was not used to certify current main. Issue #95 does not deploy production
or claim field performance.

## Verification

- `npm run audit:frontend-routes` passed the regenerated receipt and a fresh
  confirmation run.
- `npm run check` passed 451 Worker/domain tests, 135 navigation and migration
  contracts, and 133 Playwright browser scenarios, plus the static audits,
  production build, and Cloudflare production deployment dry run.
