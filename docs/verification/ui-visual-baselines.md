# Responsive UI visual baselines

The required browser gate combines image diffs with composition assertions.
Screenshots catch hierarchy, wrapping, density, and local spacing changes;
geometry assertions explain which layout contract failed.

## Reviewed matrix

The shared matrix in `e2e/helpers/visual-matrix.ts` covers:

| Profile | Viewport |
| --- | ---: |
| large desktop | 1440 × 1000 |
| standard laptop | 1280 × 800 |
| collapse entry | 1100 × 800 |
| tablet/laptop | 1024 × 768 |
| pre-collapse boundary | 961 × 768 |
| post-collapse boundary | 960 × 768 |
| portrait tablet | 768 × 1024 |
| phone | 390 × 844 |
| small phone | 320 × 568 |
| phone landscape / short height | 844 × 390 |

Each viewport has a populated Studio baseline and a ready-viewer baseline.
Additional reviewed images cover:

- Studio session loading;
- an empty project collection;
- 100 project records with 120-character project names;
- pending and completed processing together;
- inline field validation;
- a long action error in a 260 px-high dialog;
- viewer loading;
- a 320 px access failure; and
- the measured viewer navigator in short landscape.

The 120-character project/title, 255-character upload filename, and
80-character release-slug fixtures come from the Worker contract maxima.
Fixture time is frozen at `2026-08-24T08:00:00.000Z`, motion is reduced,
animations are disabled for capture, the caret is hidden, and bundled fonts
must finish loading before comparison.

The 945–1110 px Studio sweep is intentionally geometry-only. It checks every
integer width in the critical corridor, attaches the measured shell/workspace
JSON to the Playwright report, and makes a discontinuity diagnosable without
committing 166 nearly identical images.

## Baseline environment

The committed images were generated with the same pinned Ubuntu/Chromium
environment used by CI:

- image: `mcr.microsoft.com/playwright:v1.62.0-noble`
- pulled image digest:
  `sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07`
- dependencies: `npm ci` from the committed lockfile

From the repository root, install dependencies into a disposable Docker
volume:

```bash
docker run --rm --ipc=host \
  -v "$PWD":/work \
  -v spatial-ui65-node-modules:/work/node_modules \
  -w /work \
  mcr.microsoft.com/playwright:v1.62.0-noble \
  npm ci
```

Generate candidate baselines only when the visual change is intentional:

```bash
docker run --rm --ipc=host \
  -v "$PWD":/work \
  -v spatial-ui65-node-modules:/work/node_modules \
  -w /work \
  mcr.microsoft.com/playwright:v1.62.0-noble \
  npx playwright test \
    e2e/ui-quality.spec.ts \
    e2e/published-viewer.spec.ts \
    e2e/release-access-code.spec.ts \
    --grep 'visual baselines|session bootstrap|processing distinct|long operational records|constraint feedback|short dialog keeps|action feedback stays contained' \
    --update-snapshots
```

Review every changed PNG, then run the same command without
`--update-snapshots`. CI never updates baselines. On a mismatch, Playwright
writes actual, expected, and diff images into `test-results/`; the browser job
uploads that directory and the HTML report even when tests fail.

After accepting changed PNGs, refresh and verify their integrity manifest:

```bash
find e2e -type f -path '*-snapshots/*.png' -print0 \
  | sort -z \
  | xargs -0 shasum -a 256 \
  > e2e/visual-baselines.sha256
npm run audit:visual-baselines
```

Pixel comparison runs when the Playwright host is Linux. macOS and other local
hosts still execute the full geometry/composition matrix, but font
rasterization differs enough to make cross-platform pixel comparison noisy.
Use the pinned Docker command above whenever a non-Linux developer needs to
review or verify the committed images.

Do not accept a baseline solely because the update command completed. The
reviewer must verify the fixture state, viewport name, visible task hierarchy,
text wrapping, action reachability, and intentionality of each changed region.
