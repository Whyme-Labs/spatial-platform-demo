# Dialog shell design

## Ownership

Every standard Studio dialog is normalized once at startup into:

```text
dialog
  form.dialog-shell
    header.dialog-shell-header
    div.dialog-shell-body
    footer.dialog-shell-footer
```

The header owns the eyebrow and task title. The body is the only direct child
that scrolls. The footer owns action feedback and the task actions. Existing
form IDs, fields, listeners, validation, and submission semantics remain in the
same form; the binding only groups its direct children.

The immutable-version comparison keeps its purpose-built comparison shell and
makes only the comparison grid scroll. Portfolio operations are the sole
multi-tool legacy surface. A labelled task picker now exposes one operation at
a time, and its render functions reapply that selection after state updates.

## Responsive composition

Desktop and tall tablet screens keep a centered modal. Phones and short-height
screens use a full-viewport sheet. Safe-area padding belongs to the header and
footer. Reducing viewport height to simulate an on-screen keyboard shrinks the
body rather than moving the title, close control, or primary action out of the
viewport.

## Task continuity

Each dialog records the exact focused invoker before `showModal()` and restores
it after close. A local Tab loop keeps keyboard focus within the open dialog.
Resize does not rebuild the dialog or reset form state.

The multi-step capture and portfolio task dialogs mark trusted user edits as
dirty. Close controls and Escape ask before discarding; cancelling the question
keeps both the dialog and entered values intact. Programmatic resets and
successful submission closes do not create false discard prompts.

## Verification contract

- Every dialog declares a non-empty task purpose.
- Every standard dialog has exactly one header, body, and footer.
- Only the body is a direct vertical scroll owner.
- The capture dialog keeps header, close, and primary action visible at the
  complete desktop/tablet/phone matrix and in short landscape.
- A virtual-keyboard-height resize retains entered data and a long error while
  keeping the action footer visible.
- Native modal containment plus the local boundary loop traps focus, and close
  restores focus to the invoker.
- Portfolio exposes one task section at a time.
