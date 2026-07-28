# Action-state audit

Last reviewed: 2026-07-28

## Contract

Every asynchronous user action must:

1. Enter a visible pending state synchronously.
2. Accept only one execution for its action key while pending.
3. Disable conflicting controls and expose `aria-busy`.
4. Keep errors next to the initiating action, including a request reference when available.
5. Restore controls after success, failure, timeout, or cancellation.
6. Permit a deliberate retry after failure.
7. Retry automatically only when the operation is safe or the server contract is idempotent.

`src/client/action-state.ts` owns the browser single-flight and control-state contract.
`src/client/api.ts` owns timeouts, safe retries, retry-after handling, and single-flight
refresh-token rotation.

## Audited actions

| Surface | Action | Pending state | Failure recovery | Retry or idempotency |
| --- | --- | --- | --- | --- |
| Sign-in | Request email code | Entire form disabled; `Sending code…` | Inline error, request reference, restored form | Manual retry; server rate limit and resend cooldown |
| Sign-in | Verify code | Entire form disabled; `Signing in…` | Inline error; code remains editable | Manual retry while challenge remains valid; OTP is consumed once |
| Sign-in | Resend code | Button and conflicting auth controls disabled | Inline error | Server cooldown plus visible countdown |
| Sign-in | Discover enterprise provider | Email and both auth triggers disable; `Finding your provider…` with `aria-busy` | Exact inline message, email retained, trigger restored | Rate-limited deliberate retry; active provider and exact domain are rediscovered |
| Sign-in | Start enterprise redirect | Selected provider enters `Opening identity provider…`; conflicting login controls disable | Inline provider/start error; provider choices and email remain | Single-use state/nonce/PKCE attempt; a failed attempt starts a new authorization request |
| Studio | Refresh dashboard | Refresh button pending | Global error and restored button | GET requests retry twice with bounded backoff |
| Studio | Sign out | Sign-out button pending | Session remains intact and error is shown | Manual retry |
| Studio | Create project | Dialog form disabled; `Creating project…` | Inline dialog error; values retained | Stable client operation ID; D1 returns the original project on replay |
| Studio | Open project | Row action pending | Global error; action restored | GET retries twice |
| Studio | Bulk archive/restore projects | Selected-project bar enters `Archiving…` or `Restoring…`; row, clear, and conflicting lifecycle controls disable together with `aria-busy` | Timeout/network failure restores controls and retains the exact selection; partial results clear completed rows and retain blocked rows with dependency guidance | Stable client operation ID is reused after transport failure; D1 stores the request hash and terminal response; conflicting reuse is rejected |
| Studio | Create/update/delete saved portfolio view | Initiating form or row control enters a specific pending label and disables conflicting view controls with `aria-busy` | Inline/global error retains the normalized filters and restores controls | Create uses a stable operation ID; update/delete are explicit manual retries against tenant/user-scoped D1 state |
| Studio | Create/update/delete project template | Initiating form or row control enters a specific pending label and disables conflicting template controls with `aria-busy` | Dialog/global error retains form values and restores controls | Create uses a stable operation ID; update/delete are explicit manual retries against tenant-scoped D1 state |
| Studio | Create/update/deactivate project field | Field form or row control enters `Saving field…`, `Deactivating…`, or `Reactivating…`; immutable/conflicting controls disable with `aria-busy` | Inline/global error retains the typed schema values and restores every control | Create reuses a stable operation ID for the same canonical definition; update is tenant-scoped and select options still in use cannot be removed |
| Studio | Export portfolio metadata | Export control announces preparation and disables conflicting scope controls | Download failure is shown beside the portfolio tools and preserves selection | Read-only bounded export; a successful response is downloaded only after the request settles |
| Studio | Preview portfolio import | Validate control and file input disable with `Validating…`; commit remains unavailable until a current preview succeeds | Validation errors and manifest warnings stay in the dialog; the selected file can be replaced or deliberately retried | Server validation is side-effect free and safe to repeat |
| Studio | Commit portfolio import | Commit, preview, and file controls disable with `Creating projects…` and `aria-busy` | Transport/server failure restores the confirmed-preview state and permits deliberate retry | Stable operation ID plus D1 request hash/terminal response prevents duplicate projects and rejects conflicting reuse |
| Studio | Preview cross-workspace handoff | Preview control enters `Checking destination…`; destination and commit controls disable | Inline conflict/error keeps the project selection and restores the destination control | Read-only validation is safe to repeat and requires active administrator membership in both workspaces |
| Studio | Commit cross-workspace handoff | Commit enters `Creating DRAFT copies…`; destination and preview controls disable | Failure restores the valid preview for deliberate retry; the source remains unchanged | Stable operation ID plus a source/destination/project-set hash returns the persisted terminal response and rejects changed reuse |
| Studio | Preview/start/refresh/retry/cancel asset-bearing project copy | Preview enters `Checking assets…`; start enters `Starting copy…`; refresh, retry, and cancel expose their own pending labels; every conflicting destination, confirmation, and operation control disables with `aria-busy` | Exact API/Queue state remains beside the operation, selected destination and stable operation ID survive failure, and background polling never clears a user-action error; terminal operations render controls as unavailable | Preview and GET refresh are safe and bounded; start uses a stable operation ID plus snapshot/request hashes; retry queues only incomplete items; cancel is authoritative in D1 before R2 cleanup and safely handles an in-flight worker |
| Studio | Open Spatial/Measurement workspace | Visible loading region with `aria-busy` | Inline empty-state error with Retry | Project-scoped single-flight GET; stale responses are discarded |
| Studio | Multipart upload | Form disabled, live part progress, pause available | Uploaded parts remain discoverable across sessions; inline error | Initiation, PUT parts, and completion are idempotent; parts retry three times |
| Studio | Resume/discard interrupted upload | Recovery inventory has visible loading/error/retry state; selected session disables conflicting controls | Exact-file mismatch is explained; expired sessions can still be discarded | D1 part ETags reconcile with the R2 multipart upload; resume skips persisted parts |
| Studio | Complete processing job | Row action pending | Global error; action restored | Server returns an idempotent success when already completed |
| Studio | Approve version | Dialog form disabled; `Approving version…` | Inline dialog error | Server returns idempotent success for the same approved web asset |
| Studio | Publish release | Dialog form disabled; `Publishing release…` | Inline dialog error; form retained | Stable client operation ID; D1 returns the original release on replay |
| Studio | Revoke release | Release action pending | Global error; action restored | Repeating revocation is safe |
| Studio | Reviewer invitation/revocation | Initiating control pending | Inline/global error; membership remains authoritative in D1 | Stable invitation operation ID; revocation is safe to repeat |
| Studio | Team invite/role/resend/revoke | Form or row controls enter a single-flight pending state; conflicting role controls disable together | Dialog errors remain inline; row errors are globally announced; starting a deliberate retry clears stale global failure state | Stable invitation operation ID; resend is explicit; live D1 membership and session revocation remain authoritative |
| Studio | Create/activate/disable/delete OIDC provider | Dialog or exact provider row enters `Creating draft…`, `Checking provider…`, `Disabling…`, or `Deleting…`; trigger is disabled with `aria-busy` | Form/row error stays inline; provider evidence and secret reference remain visible; controls restore | Identical draft creation is idempotent by issuer/config; activation requires live discovery; disable is idempotent and revokes provider sessions; delete is idempotent but blocked by active/linked providers |
| Studio | Create/edit/rotate/revoke capture agent and copy issued token | Dialog or exact credential row enters `Creating token…`, `Saving scope…`, `Rotating token…`, `Revoking…`, or `Copying…`; the form/trigger disables with `aria-busy` | Inline dialog/row error retains name, scope, and expiry for deliberate retry; token remains selectable when clipboard permission fails; every control restores | Create and rotation reuse a stable operation ID and request hash so a transport retry returns the same one-time token; update is explicit; revoke is idempotent and immediately invalidates the bearer generation |
| Studio | Switch organisation workspace | Selector and switch control enter `Switching…`; refresh, navigation, project, and portfolio controls disable with `aria-busy` | Inline error retains the selected target, restores all controls, and leaves the current tenant session authoritative | Deliberate retry; the Worker rotates credentials only after active target membership is verified, revokes the old session on success, and treats a same-tenant request idempotently |
| Studio | Custom-domain inventory/create/verify/provision/remove | Inventory has an immediate loading region; each mutation changes its own label, disables the trigger with `aria-busy`, and prevents same-key replay | Exact DNS/provider error remains in the dialog; TXT/CNAME instructions and registered-domain evidence remain visible; controls restore after failure | Inventory has an explicit Retry control; ownership and provider controls remain deliberate retries; provider reconciliation reuses an exact existing hostname and deletion refuses to orphan provider state |
| Studio | Review comment/redaction/decision | Form or decision control pending | In-scene error with request reference | Form data captured before disable; deliberate retry |
| Studio | Compare immutable versions | Comparison form pending, signed-session status announced, each Spark frame reports progress independently | API errors stay beside the form; frame failure/timeout identifies the affected side and exposes Retry | Safe comparison GET retries twice; Retry refreshes both short-lived signed sessions before reloading |
| Studio | Spatial entity/route/privacy/policy | Form or row control pending | Dialog/global error and retryable control | Form data captured before disable; create uses a client operation ID |
| Studio | Automated privacy scan/retry | Queue control enters `Queueing…`; active scan disables duplicate runs; bounded polling announces retained long-running work | Failed/dead-letter evidence exposes an explicit retry; transport failure refreshes authoritative state | Stable scan operation ID survives transport failure; D1 request hash prevents duplicate scans; retry reuses the persisted scan |
| Studio | Privacy evidence preview/decision | Private image reports loading; decision dialog enters `Recording decision…` | Image exposes Retry without hiding the candidate; form retains values and inline error | Image requests are safe tenant-scoped GETs; decisions update one persisted candidate and retain audit history |
| Studio | QA privacy preflight | QA opener enters `Checking evidence…`; submit and confirmation stay disabled when blocked | Exact missing/running/unresolved evidence is shown with a route back to Spatial authoring | Worker repeats the complete latest-scan and zero-blocker checks authoritatively |
| Studio | Generate/review authored geometry comparison | Comparison form enters `Comparing geometry…`; review enters `Recording review…`; the active form and conflicting controls disable with `aria-busy` | Inline errors retain versions, threshold, coordinate assertion, registration evidence, and review note; controls restore after failure | Stable operation ID survives transport failure; D1 stores every request hash and immutable response so an older operation remains replayable after later regeneration; conflicting reuse is rejected |
| Studio | Queue/retry/review automatic registration and raw-scene comparison | The form enters `Queueing registration…`; all version, asset, registration-mode, overlap/RMSE/search, evidence, change-threshold, close, and submit controls disable together with `aria-busy`; queued/running cards expose persisted progress | Exact API or processor failures remain visible; the form retains registration preconditions and every gate; terminal worker failure exposes an explicit retry; a quality-blocked registration remains reviewable without inventing change evidence | Stable operation ID and request hash prevent duplicate reports/jobs; worker retry reuses the exact persisted version/asset pair; completion requires dual byte/hash evidence, server-consistent transform/gates, and one immutable report |
| Studio | Queue/retry/cancel/review/export vendor-neutral floor plans | Extraction, review, and export forms use the shared single-flight action controller; related controls disable together, submit labels expose the current action, and active extraction cards retain processor progress while polling | API/normalisation/extraction/review/export errors remain attached to the relevant workflow; failed extraction exposes retry, active extraction exposes cancel, malformed operator JSON cannot be approved, and the corrected plan remains in the dialog | Stable operation IDs make queue, decision, and export mutations replay-safe; immutable proposal and plan hashes bind approved indicative SVG/PDF/DXF to their exact source/revision |
| Studio | Queue/retry/cancel/review point-cloud semantic extraction | Queue enters `Queueing extraction…`; review enters `Recording review…`; source, parameters, evidence, candidate choices, close, and submit controls disable together with `aria-busy`; cards expose persisted progress and human-review state | Inline API failures retain every extraction parameter or candidate decision; failed jobs expose retry, active jobs expose guarded cancellation, and long-running work remains refreshable | Queue and review each retain a stable operation ID plus request hash across transport failure; worker completion requires exact source bytes, server-consistent parameters, valid polygon/area evidence, and one immutable report; candidates never author entities before review |
| Studio | Analyze/review capture trajectory | Analysis form enters `Analyzing trajectory…`; review enters `Recording review…`; file input, thresholds, and conflicting controls disable with `aria-busy` | Inline error keeps the selected file, coordinate frame, evidence, and thresholds; deliberate retry restores the same request | Stable operation ID survives transport failure; D1 request hash prevents duplicate reports and R2 assets; conflicting reuse is rejected |
| Studio | Register/review capture bundle | The manifest form enters `Registering bundle…`; version, hardware/export metadata, role selectors, rights evidence, close, and submit controls disable together with `aria-busy`; review enters its own `Recording review…` state | Exact API error stays inline; selected assets, role assignments, rights, coordinate frame, limitations, and operation ID remain available for deliberate retry | Stable operation ID and request hash prevent duplicate D1 rows or R2 manifests; the Worker re-resolves exact verified version assets and hashes before persistence; a blocked contract cannot be accepted |
| Studio | Measurement brief/check point/QA | Form or row control pending | Dialog/global error and retryable control | Form data captured before disable; QA generation is deterministic |
| Studio | Generate/download measurement DXF | Generating or downloading control pending; conflicting evidence controls disabled during generation | Inline row error, restored controls, explicit retry | Generation is hash-idempotent; authenticated GET retries twice and preserves private delivery |
| Studio | Issue manual hosting invoice | Admin form enters `Issuing invoice…`; every invoice field and submit control disables with `aria-busy` while the exact form snapshot is retained | Exact validation/API error stays beside the form; values remain available; controls restore for deliberate retry | Stable client operation ID and request hash prevent duplicate invoices/subscriptions; an unpaid invoice creates no active entitlement |
| Studio | Mark manual invoice paid / void | The selected row enters `Recording payment…` or `Voiding invoice…`; conflicting row controls disable; payment reference is required for collection | Inline row error retains payment reference/note and restores controls; illegal or concurrent transitions are explicit conflicts | Stable operation ID; paid activation is a compare-and-set D1 batch and can be replayed safely; a paid invoice cannot later be voided |
| Studio | Mark manual subscription past due / cancelled / expired | The selected row enters a transition-specific pending state and disables conflicting controls | Required operator note remains available after failure; authoritative state reloads after success | Stable operation ID and guarded state machine; inactive states cannot be used to reactivate hosting |
| Studio | Lifecycle enforcement/restore drill | Control pending | Global error; lifecycle history remains intact | Single-flight; each run records its terminal outcome |
| Viewer | Load release | Full viewport loading state and progress | Dedicated error panel | Manifest GET retries twice; explicit Retry action |
| Viewer | Retry release | Retry button pending | Error panel remains actionable | Single-flight with the load action |
| Viewer | Share | Share button pending | Clipboard fallback, then explicit guidance | Manual retry |
| Viewer | Room/floor-plan navigation | Room control pending until the Spark camera acknowledgement; other moves are single-flight | Inline navigator error; control and keyboard target restored | Explicit retry sends a new request ID; cameras outside collision are rejected |
| Renderer | Enter/exit fullscreen | Fullscreen button pending | Non-blocking inline control status | Manual retry |
| Marketing | Workflow tabs | Synchronous local transition | No network or durable state | Not applicable |
| Marketing | Contact and navigation links | Browser-native navigation | Browser-native | Not applicable |

## Retry policy

- GET, HEAD, and OPTIONS: up to two retries for network failures, 408, 425, 429,
  502, 503, and 504.
- Multipart part PUT: up to three retries because a part number is replaced
  idempotently.
- Multipart completion POST: up to two retries because the endpoint returns the
  completed asset when the upload is already complete.
- Capture transfer agent: its local checkpoint retries only network failures,
  408, 425, 429, and 5xx responses. It reuses the deterministic upload
  operation, reconciles committed R2 part ETags, and never automatically retries
  a 4xx contract or authorization failure.
- Other mutations: no automatic network replay. Project creation, upload initiation,
  QA approval, job completion, upload completion, and release publication are
  server-idempotent when deliberately retried.
- Refresh-token rotation: one shared in-flight refresh for the entire page. This
  prevents concurrent 401 responses from rotating the same refresh credential
  more than once.
- Initial page load retries the session through the rotating refresh cookie once
  before showing OTP sign-in, so an expired five-minute access JWT does not eject
  a valid long-lived session.
- `runAction` consumes handled failures after rendering the error next to the
  initiating action, or emits a global action error when no inline target exists.
  This prevents fire-and-forget button handlers from becoming unhandled promise
  rejections while preserving deliberate retry.

## Required regression checks

- Dispatch the sign-in form twice while the first OTP request is unresolved:
  exactly one request is allowed.
- Reject the OTP request: the form is enabled again, the error is announced, and a
  second submission succeeds.
- Repeat manual job completion and QA approval: the Worker returns an idempotent
  success instead of creating duplicate workflow records.
- Repeat project creation, upload initiation, and release publication with the same
  client operation ID: D1 returns the original resource.
- Select active and archived projects together: only the valid bulk action is
  enabled for each state. Delay or reject the mutation: the action label and
  `aria-busy` state must recover while selection remains. Return a partial
  result: changed/not-found rows clear and blocked rows remain selected for a
  deliberate retry using a new operation ID.
- Delay saved-view and template creation: the initiating button must expose its
  pending label, disable exactly once with `aria-busy`, and recover without
  losing the current filters or form fields.
- Preview a portfolio import, then allow the preview action's cleanup to run:
  the commit control must remain enabled from the new preview state rather than
  being restored to its stale pre-preview disabled state. During commit, file,
  preview, and commit controls disable together; after success they remain
  terminally disabled and the persisted imported-project evidence is shown.
- Delay asset-copy preview and start, then rapidly activate each twice: only one
  mutation may leave the browser and every conflicting control must disable
  with the exact pending label. Inject a refresh failure and confirm safe GET
  retries are bounded. Inject a cancel failure while automatic progress polling
  succeeds: the cancel error must remain visible until a deliberate action
  clears it, and the destination plus stable operation ID must remain intact.
  A completed/cancelled terminal operation must expose no actionable retry or
  cancel control.
- Interrupt an upload after at least one part, reload the browser, and reopen
  Upload source: the durable recovery row shows persisted bytes and expiry;
  Resume requires the exact same file and skips completed parts, while Discard
  aborts the R2 multipart upload.
- Interrupt `capture-agent:start` after a committed part: the local checkpoint
  and `/uploads/open` inventory must agree, the next process must skip that
  part, completion must produce one version/asset, and rotating or revoking the
  scoped credential must make its prior bearer return 401.
- Fail a release manifest request: the error panel exposes a working single-flight
  Retry control.
- Run `npm run audit:actions`: the static regression audit rejects submit
  handlers that construct `FormData` after `runAction` has disabled the form.
- Run `npm run audit:controls`: every static button must be an audited submit
  control, have an ID referenced by the client, or be covered by an explicit
  delegated-control selector. Every TypeScript-generated button must resolve
  through the compiler symbol graph to a click handler. A visible unbound
  button fails the release gate; a non-interactive state is rendered as status
  text rather than a disabled fake action. Static and TypeScript-generated
  links must likewise have a real destination.
- Select a project and navigate directly through the Spatial and Measurement
  sidebar buttons: each workspace must load the selected project, expose
  `aria-busy`, and provide a Retry action on failure.
- Queue the same privacy scan operation twice: D1 returns one scan. Fail queue
  delivery: the workspace refreshes to the persisted failed run and exposes
  Retry. Complete a scan with a pending candidate: both QA preflight and the
  Worker approval endpoint remain blocked until a human dismisses or resolves
  it. Fail the private preview: the candidate stays visible and Retry restores
  the same tenant-scoped image.
- Delay authored geometry generation and review: each initiating button changes
  label, disables once, and exposes `aria-busy`. Inject a generation 503: the
  dialog stays open with every field retained and a deliberate retry succeeds.
  Regenerate the same version pair with a new operation ID, then replay the
  first ID: D1 must return the first immutable response and reject conflicting
  reuse. At 390 px the evidence card and XZ overlay must not overflow.
- Queue a registered raw-scene comparison and dispatch its submit control twice
  while the request is delayed: exactly one request is allowed, all controls
  disable, `Queueing comparison…` and `aria-busy` are visible, and the project
  remains unchanged. Inject a 503: the exact error, selected immutable inputs,
  registration evidence, and thresholds remain; the form restores for a
  deliberate retry. Render queued, running, failed, completed, and reviewed
  reports at 390 px without horizontal overflow.
- Delay capture analysis, then inject a 503: the selected JSON file, coordinate
  evidence, and thresholds remain present; the submit control restores and a
  deliberate retry creates exactly one D1 report and one immutable private R2
  asset. Delay human review and confirm its own pending state. At 390 px the
  room coverage, blind-spot overlay, issues, and review result must not overflow.
- Delay capture-bundle registration and dispatch its submit control twice:
  exactly one request is allowed, all 24 form controls disable,
  `Registering bundle…` and `aria-busy` remain visible, and the exact error is
  announced inline. Confirm the selected immutable assets, role assignments,
  rights evidence, coordinate frame, and limitations remain intact for a
  deliberate retry. At 390 px the open dialog and role selectors must not
  overflow horizontally.
- Reject a measurement DXF generation or download: the row must show the error,
  restore every disabled control, and permit a second attempt.
- Delay a team invitation request: the submit label changes, `aria-busy` is set,
  and all form controls remain disabled until the request settles. Inject a
  resend 503: the Resend control must recover, expose the request error, and a
  successful deliberate retry must clear that stale error.
- At 390 px, enter a valid enterprise email and delay discovery: both sign-in
  methods and the email input disable while the SSO trigger reads
  `Finding your provider…` with `aria-busy`. Return no provider or inject a
  failure: the exact inline message must remain, every control must restore,
  the email must be retained, and deliberate retry must be possible. In Team,
  apply the same test to create, activation, disable, and delete; disabling
  must invalidate every provider session rather than only changing the badge.
- Select another organisation and delay the switch response: the control must
  announce `Switching…`, expose `aria-busy`, and disable tenant navigation.
  Reject the request: the selected target and current session remain intact and
  a deliberate retry is possible. Complete it: the old access token must fail,
  the new tenant role must be authoritative, and no prior-tenant projects may
  remain rendered.
- Open custom-domain management at 390 px and delay creation: the control must
  read `Creating record…`, be disabled, and expose `aria-busy`. Confirm TXT and
  CNAME instructions do not overflow. Inject a verification/provider 503: the
  exact error must remain beside the lifecycle, the initiating control must
  restore, and deliberate retry must be possible. DNS ownership alone must
  never render `active`; a custom host may route only when both provider
  hostname and TLS statuses are `active` and the release belongs to that host's
  project.
- Open delivery settings at 390 px with payment configuration absent: checkout
  must be disabled as `Payment setup required`, state why, and create no D1
  checkout/subscription/invoice. With a configured client response, delay and
  reject checkout creation: the control must synchronously read
  `Creating secure checkout…`, be disabled with `aria-busy`, retain the form,
  show the exact provider error inline, and restore for deliberate retry. A
  success redirect must remain pending until signed webhook reconciliation
  proves a matching paid invoice.
- Delay the version-comparison manifest: exactly one request is allowed and the
  form remains disabled until it settles. Force one comparison asset to return
  503: the other frame remains usable, the failed side exposes Retry, and a
  successful retry refreshes the signed sessions and clears the error.
- With synchronization enabled, one valid `camera-update` from either current
  Spark iframe is forwarded once to the opposite iframe. Messages from stale,
  foreign-origin, or non-Spark windows are ignored.
