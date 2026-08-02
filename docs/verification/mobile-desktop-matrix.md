# Spark 2.1 indoor-scene browser matrix

- Recorded: 2026-07-27
- Release under test: `https://spatial.whymelabs.com/s/playroom`
- Asset: 43.0 MiB SPZ, Voxel51 playroom, Apache-2.0
- Renderer: bundled Spark 2.1, 2 million splat budget

## Results

| Profile | Browser engine | Viewport/device profile | Result | Console |
|---|---|---|---|---|
| Desktop | Chrome / Chromium | 1440 × 900 | Pass — `Spark 2.1.0 ready`; scene and controls rendered | No renderer failure observed |
| iOS browser gate | Playwright WebKit 26.5 | iPhone 15 emulation | Pass — scene and controls rendered | 0 errors, 0 warnings after the renderer CSP correction |
| Android browser gate | Chrome / Chromium | Pixel 7 emulation | Pass — scene and controls rendered | 0 errors, 0 warnings |

Screenshots:

- `output/playwright/m2-matrix-desktop-ready.png`
- `output/playwright/m2-matrix-ios-webkit.png`
- `output/playwright/m2-matrix-ios-webkit-final.png`
- `output/playwright/m2-matrix-android-chrome.png`

## Scope and limitations

These are real browser-engine runs with mobile device emulation, not physical
device thermal, memory-pressure, or carrier-network tests. They prove the
release shell, private range delivery, Spark initialization, responsive layout,
and first rendered scene on Chromium and WebKit.

Before a paid mobile SLA, declare the supported physical iPhone and Android
targets, record the device/OS/browser/build identity, and repeat the matrix
while recording:

- time to first useful frame on the product's measured Wi-Fi and mobile-network profiles
- median and 1% low frame rate during a fixed camera path
- peak browser memory
- thermal throttling and crash/reload rate over a measured soak window

The network profile and soak window must be recorded in
`docs/CAPACITY_RECEIPTS.md` from the actual target hardware before either is
made an acceptance limit. Until then they are evidence fields, not pass/fail
thresholds.

The current acceptance gate is browser compatibility. The physical-device
performance policy remains a Milestone 4 deliverable.
