# UI feedback design

## Problem

Browser constraint errors and failed actions currently share `.form-error`.
`bindConstraintFeedback()` moves a field error into one form-level target, while
`runAction()` drops `ApiError` details, retry timing, and request references.
The replacement must improve every existing action without making more than one
hundred callers coordinate a new controller.

## Caller usage

Forms bind field feedback once. Existing `runAction()` callers keep their
current options.

```ts
bindFormFeedback(savedViewForm);

void runAction({
  key: "save-project-view",
  trigger: savedViewSubmit,
  form: savedViewForm,
  pendingLabel: "Saving view…",
  errorTarget: byId("savedViewError"),
}, () => saveProjectView(new FormData(savedViewForm)));
```

The viewer passes a denied access error directly because its release loader
consumes the rejection while selecting the access panel.

```ts
showActionFailure(accessCodeError, error, {
  form: accessCodeForm,
  trigger: accessCodeSubmit,
});
```

## Shape

`src/client/feedback.ts` owns one internal failure model and the DOM policy.

```ts
type ClientFailure =
  | {
      kind: "validation";
      message: string;
      status?: number;
      details?: unknown;
      error: unknown;
      retryable: boolean;
      retryAfterSeconds?: number;
      requestId?: string;
      fieldFailures: readonly FieldFailure[];
      formMessages: readonly string[];
    }
  | {
      kind: "action";
      message: string;
      status?: number;
      details?: unknown;
      error: unknown;
      retryable: boolean;
      retryAfterSeconds?: number;
      requestId?: string;
    };
```

The module exports `bindFormFeedback()`, `describeActionFailure()`,
`actionFailureMessage()`, `clearActionFeedback()`, and
`showActionFailure()`. `runAction()` keeps its current signature and delegates
failure presentation to that module.

Inline field messages are not live regions. Each invalid control owns one
`aria-errormessage` ID. The existing action target remains the only assertive
region for that action group. Matched server field messages do not repeat in
the action target.

Generated field resolution uses `data-feedback-field`, then
`data-custom-field-key`, `name`, and `id`. Message IDs derive from that stable
key rather than a form position. Existing `aria-describedby` helper links stay
unchanged.

The original trigger remains the retry path. The feedback module never stores
or replays an action closure or stale `FormData`.

## Synthesis decision

Candidate A is the base. It keeps the existing `runAction()` interface and
places error parsing, field linkage, focus, and announcement ownership behind
one module. Candidate B contributed stable generated-field mapping and complete
preservation of `ApiError.status` and the raw error.

The design rejects Candidate B's public sink, controller, and WeakMap registry.
Those interfaces expose migration machinery to callers without hiding more
policy. It also rejects mechanical `.form-error` renaming because some current
uses are persistent diagnostics rather than action targets.

## Verification contract

- A unit test preserves field details, status, retry timing, and request ID.
- A browser test links a client constraint error to the field and clears it
  after correction without touching the action region.
- Server field errors focus and describe the matching field. Unmatched messages
  stay in one action region.
- Long action feedback wraps at 320, 390, 768, and desktop widths.
- No feedback path creates nested live regions or auto-replays an action.

## Tradeoffs

- Keep the narrow `errorTarget` name to avoid a caller-only rename.
- Create field messages at runtime to avoid static empty nodes for every field.
- Leave success messages with the domain because the successful result differs
  by action.
