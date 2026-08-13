# Physical navigation qualification matrix

Status: `VALIDATE` until every row is backed by a real device session and
immutable evidence. Do not copy browser-emulation results into this matrix.

## Immutable release identity

| Field | Recorded value |
| --- | --- |
| Release URL and numeric revision | |
| Release UUID | |
| Scene version | |
| Navigation artifact asset and SHA-256 | |
| Capture manifest UUID and SHA-256 | |
| Capture registration SHA-256 | |
| Registration evidence asset and SHA-256 | |
| Tested traversal ids and directions | |

## Device sessions

Declare the supported device targets before testing. Add one row per physical
device, OS, browser, release, and network profile. Reusing a device with a new
browser or OS build creates a new row.

| Target | Hardware | OS/build | Browser/build | Network evidence | Viewer session UUID | Traversal result | First useful frame | Frame pacing | Peak memory | Thermal/reload evidence | Screen recording SHA-256 | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| iOS target | | | | | | `VALIDATE` | | | | | | `VALIDATE` |
| Android target | | | | | | `VALIDATE` | | | | | | `VALIDATE` |

## Mobile browser interaction smoke

These rows are release evidence, not emulation. Run them against the same
immutable release named above, keep free roam available throughout, and verify
that every alternate navigation method remains disabled on coarse-touch
devices.

| Target | Free-roam default | Pointer cancellation | Browser back/edge gesture | Address-bar resize | Safe-area controls | Rotation | Virtual keyboard recovery | Multi-touch arbitration | Recording SHA-256 | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Physical iPhone Safari | `VALIDATE` | `VALIDATE` | `VALIDATE` | `VALIDATE` | `VALIDATE` | `VALIDATE` | `VALIDATE` | `VALIDATE` | | `VALIDATE` |
| Physical Android Chrome | `VALIDATE` | `VALIDATE` | `VALIDATE` | `VALIDATE` | `VALIDATE` | `VALIDATE` | `VALIDATE` | `VALIDATE` | | `VALIDATE` |

## Signed release decision

| Field | Recorded value |
| --- | --- |
| Exact Git commit | |
| Tester identity | |
| Tested at (UTC) | |
| Evidence bundle SHA-256 | |
| Signature method and signer identity | |
| iPhone Safari decision | `VALIDATE` |
| Android Chrome decision | `VALIDATE` |

The table records measurements; it does not invent universal pass thresholds.
Any network, duration, memory, frame-pacing, or thermal limit used for a
decision must cite the reproducible measurement and sizing rule in
`docs/CAPACITY_RECEIPTS.md`.

## Run procedure

1. Sign in to the review host, open the exact active release on the physical
   device, and record its hardware, OS, browser, network, and logical viewer
   session UUID. Credential renewal and a same-tab reload before session expiry
   must preserve that UUID. An idle same-tab run that resumes after expiry and
   lifecycle cleanup must reconstruct that UUID and continue its server event
   sequence. Tabs in one authenticated browser session share that run; a
   separately authenticated physical device receives a new session UUID. Any
   publish or rollback starts a new channel-activation
   generation and therefore a new session UUID, even when it restores the same
   immutable release.
2. Confirm Studio shows the same navigation artifact, capture manifest, and
   registration SHA-256 listed above.
3. Record the complete session. Exercise every authored traversal in every
   allowed direction, ordinary doors and stairs, narrow structural passages,
   and movement beside representative furniture.
4. Verify each traversal produces matching `started` and `completed`
   `navigation_traversal` diagnostic events. The signed viewer session accepts
   only connection ids in the frozen release; a server sequence preserves
   lifecycle order even when events share one wall-clock second. The Worker resolves the capture
   adapter, manifest SHA-256, review generation, registration SHA-256, numeric
   transform, and source path from that artifact. A `blocked` event is a failed
   traversal unless the test explicitly exercises a closed barrier.
5. Verify Walk resumes at the reviewed landing, walls remain blocking,
   furniture remains non-blocking under the published collision policy, and
   Fly remains inside the structural shell.
6. In Studio's release history choose **Export traversal evidence**. Its
   deterministic file name, visible Studio receipt, and `X-Spatial-SHA256`
   response header contain the complete byte digest. Preserve that export and the recording as immutable assets, then
   have an operator review the row against the exact release identity.

The same export is reproducible from an authenticated operator shell:

```sh
curl --fail --show-error --location \
  --cookie "$SPATIAL_AUTH_COOKIE" \
  --remote-header-name --remote-name \
  "$SPATIAL_ORIGIN/api/releases/$SPATIAL_RELEASE_ID/navigation-traversal-evidence"
```

The diagnostic events corroborate a recording; a viewer can still control its
own browser and therefore cannot turn telemetry alone into physical attestation.

Browser emulation, offline Recast/Rapier replay, and synthetic scenes remain
software evidence. They cannot change a physical row from `VALIDATE` to an
accepted decision.
