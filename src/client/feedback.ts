import { ApiError } from "./api";

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export type FieldFailure = Readonly<{
  field: string;
  messages: readonly string[];
}>;

type FailureFacts = Readonly<{
  message: string;
  status?: number;
  details?: unknown;
  error: unknown;
  retryable: boolean;
  retryAfterSeconds?: number;
  requestId?: string;
}>;

export type ClientFailure =
  | (FailureFacts & Readonly<{
    kind: "validation";
    fieldFailures: readonly FieldFailure[];
    formMessages: readonly string[];
  }>)
  | (FailureFacts & Readonly<{
    kind: "action";
  }>);

export type ActionFeedbackContext = Readonly<{
  trigger: HTMLButtonElement;
  form?: HTMLFormElement;
  message?: string;
}>;

const boundForms = new WeakSet<HTMLFormElement>();
let generatedTargetId = 0;

export function bindFormFeedback(form: HTMLFormElement): void {
  if (boundForms.has(form)) return;
  boundForms.add(form);
  const actionTarget = form.querySelector<HTMLElement>(".form-error, [data-action-feedback]");
  if (actionTarget) prepareActionTarget(actionTarget);

  let focusScheduled = false;
  form.addEventListener("invalid", (event) => {
    const control = formControl(event.target);
    if (!control) return;
    showFieldFailure(form, control, control.validationMessage || "Review this field and try again.", "constraint");
    if (actionTarget) clearFormActionFeedback(form, actionTarget);
    if (focusScheduled) return;
    focusScheduled = true;
    queueMicrotask(() => {
      focusScheduled = false;
      firstInvalidControl(form)?.focus();
    });
  }, true);

  const clearValidControl = (event: Event): void => {
    const control = formControl(event.target);
    if (control?.validity.valid) clearFieldFailure(control);
  };
  form.addEventListener("input", clearValidControl);
  form.addEventListener("change", clearValidControl);
  form.addEventListener("reset", () => {
    const actionMessageAtReset = actionTarget?.textContent ?? "";
    queueMicrotask(() => {
      for (const element of Array.from(form.elements)) {
        const control = formControl(element);
        if (control) clearFieldFailure(control);
      }
      if (
        actionTarget &&
        (!actionTarget.textContent || actionTarget.textContent === actionMessageAtReset)
      ) {
        clearFormActionFeedback(form, actionTarget);
      }
    });
  });
}

export function describeActionFailure(error: unknown): ClientFailure {
  if (error instanceof ApiError) {
    const validation = validationFailures(error.details);
    const facts: FailureFacts = {
      message: error.message.trim() || "The action could not be completed.",
      status: error.status,
      details: error.details,
      error,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
      requestId: error.requestId,
    };
    if (validation.fieldFailures.length || validation.formMessages.length) {
      return {
        kind: "validation",
        ...facts,
        fieldFailures: validation.fieldFailures,
        formMessages: validation.formMessages,
      };
    }
    return { kind: "action", ...facts };
  }
  if (error instanceof Error && error.message.trim()) {
    return {
      kind: "action",
      message: error.message.trim(),
      error,
      retryable: false,
    };
  }
  if (typeof error === "string" && error.trim()) {
    return {
      kind: "action",
      message: error.trim(),
      error,
      retryable: false,
    };
  }
  return {
    kind: "action",
    message: "The action could not be completed. Review the connection and retry.",
    error,
    retryable: false,
  };
}

export function actionFailureMessage(error: unknown): string {
  return formatFailure(describeActionFailure(error));
}

export function clearActionFeedback(
  target: HTMLElement,
  context: ActionFeedbackContext,
): void {
  prepareActionTarget(target);
  clearTarget(target);
  removeDescribedBy(context.trigger, target.id);
  if (context.form) clearServerFieldFailures(context.form);
}

export function showActionFailure(
  target: HTMLElement,
  error: unknown,
  context: ActionFeedbackContext,
): ClientFailure {
  prepareActionTarget(target);
  const failure = describeActionFailure(error);
  const matchedFields = new Set<string>();
  let firstMatchedControl: FormControl | null = null;

  if (context.form && failure.kind === "validation") {
    clearServerFieldFailures(context.form);
    for (const fieldFailure of failure.fieldFailures) {
      const control = findFieldControl(context.form, fieldFailure.field);
      if (!control) continue;
      matchedFields.add(fieldFailure.field);
      showFieldFailure(
        context.form,
        control,
        fieldFailure.messages.join(" "),
        "server",
      );
      firstMatchedControl ??= control;
    }
  }

  const displayedFailure = context.message
    ? { ...failure, message: context.message }
    : failure;
  const message = formatFailure(displayedFailure, matchedFields);
  target.textContent = message;
  target.dataset.feedbackKind = "failure";
  target.hidden = false;
  addDescribedBy(context.trigger, target.id);
  if (firstMatchedControl) queueMicrotask(() => firstMatchedControl?.focus());
  return failure;
}

function prepareActionTarget(target: HTMLElement): void {
  target.classList.add("action-feedback");
  target.setAttribute("role", "alert");
  target.setAttribute("aria-atomic", "true");
  if (!target.id) {
    generatedTargetId += 1;
    target.id = `spatial-action-feedback-${generatedTargetId}`;
  }
}

function clearTarget(target: HTMLElement): void {
  target.textContent = "";
  delete target.dataset.feedbackKind;
}

function clearFormActionFeedback(form: HTMLFormElement, target: HTMLElement): void {
  clearTarget(target);
  for (const element of Array.from(form.elements)) {
    if (element instanceof HTMLElement) removeDescribedBy(element, target.id);
  }
}

function formControl(value: EventTarget | null): FormControl | null {
  return value instanceof HTMLInputElement ||
      value instanceof HTMLSelectElement ||
      value instanceof HTMLTextAreaElement
    ? value
    : null;
}

function firstInvalidControl(form: HTMLFormElement): FormControl | null {
  for (const element of Array.from(form.elements)) {
    const control = formControl(element);
    if (control && !control.validity.valid) return control;
  }
  return null;
}

function fieldKey(control: FormControl): string {
  return control.dataset.feedbackField ||
    control.dataset.customFieldKey ||
    control.name ||
    control.id ||
    "field";
}

function messageId(form: HTMLFormElement, control: FormControl): string {
  const formKey = form.id || "form";
  const controlKey = fieldKey(control).replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `${formKey}-${controlKey}-error`;
}

function showFieldFailure(
  form: HTMLFormElement,
  control: FormControl,
  message: string,
  source: "constraint" | "server",
): void {
  clearFieldFailure(control);
  const id = messageId(form, control);
  const fieldMessage = control.ownerDocument.createElement("small");
  fieldMessage.id = id;
  fieldMessage.className = "field-message";
  fieldMessage.dataset.feedbackSource = source;
  fieldMessage.dataset.feedbackFor = fieldKey(control);
  fieldMessage.textContent = message;
  const label = control.closest("label");
  if (label) {
    const labelText = label.querySelector<HTMLElement>(":scope > span");
    if (
      labelText &&
      !control.hasAttribute("aria-label") &&
      !control.hasAttribute("aria-labelledby")
    ) {
      labelText.id ||= `${id}-label`;
      control.setAttribute("aria-labelledby", labelText.id);
    }
    label.append(fieldMessage);
  }
  else control.insertAdjacentElement("afterend", fieldMessage);
  control.setAttribute("aria-invalid", "true");
  control.setAttribute("aria-errormessage", id);
}

function clearFieldFailure(control: FormControl): void {
  const id = control.getAttribute("aria-errormessage");
  if (id) control.ownerDocument.getElementById(id)?.remove();
  control.removeAttribute("aria-invalid");
  control.removeAttribute("aria-errormessage");
}

function clearServerFieldFailures(form: HTMLFormElement): void {
  for (const element of Array.from(form.elements)) {
    const control = formControl(element);
    if (!control) continue;
    const id = control.getAttribute("aria-errormessage");
    if (!id) continue;
    const message = control.ownerDocument.getElementById(id);
    if (message?.dataset.feedbackSource === "server") clearFieldFailure(control);
  }
}

function findFieldControl(form: HTMLFormElement, field: string): FormControl | null {
  for (const element of Array.from(form.elements)) {
    const control = formControl(element);
    if (!control) continue;
    if (
      control.dataset.feedbackField === field ||
      control.dataset.customFieldKey === field ||
      control.name === field ||
      control.id === field
    ) return control;
  }
  return null;
}

function addDescribedBy(element: HTMLElement, id: string): void {
  const ids = describedByIds(element);
  if (!ids.includes(id)) ids.push(id);
  element.setAttribute("aria-describedby", ids.join(" "));
}

function removeDescribedBy(element: HTMLElement, id: string): void {
  const ids = describedByIds(element).filter((candidate) => candidate !== id);
  if (ids.length) element.setAttribute("aria-describedby", ids.join(" "));
  else element.removeAttribute("aria-describedby");
}

function describedByIds(element: HTMLElement): string[] {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

function validationFailures(details: unknown): {
  fieldFailures: FieldFailure[];
  formMessages: string[];
} {
  const payload = objectValue(details);
  if (!payload) return { fieldFailures: [], formMessages: [] };
  const nested = objectValue(Reflect.get(payload, "details"));
  if (!nested) return { fieldFailures: [], formMessages: [] };
  const source = nested;
  const explicitFields = objectValue(Reflect.get(source, "fieldErrors"));
  const fieldSource = explicitFields ?? source;
  const fieldFailures: FieldFailure[] = [];
  const formMessages = messagesFrom(Reflect.get(source, "formErrors"));

  for (const [field, value] of Object.entries(fieldSource)) {
    if (field === "fieldErrors" || field === "formErrors") continue;
    if (field === "_errors") {
      formMessages.push(...messagesFrom(value));
      continue;
    }
    const messages = messagesFrom(value);
    if (messages.length) fieldFailures.push({ field, messages });
  }
  return { fieldFailures, formMessages };
}

function objectValue(value: unknown): object | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function messagesFrom(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [sentence(value.trim())] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => messagesFrom(item));
}

function formatFailure(failure: ClientFailure, omittedFields = new Set<string>()): string {
  if (
    failure.kind === "action" &&
    failure.status === undefined &&
    failure.requestId === undefined &&
    failure.retryAfterSeconds === undefined &&
    !failure.retryable
  ) return failure.message;
  const parts = [sentence(failure.message)];
  if (failure.kind === "validation") {
    for (const fieldFailure of failure.fieldFailures) {
      if (!omittedFields.has(fieldFailure.field)) parts.push(...fieldFailure.messages);
    }
    parts.push(...failure.formMessages);
  }
  if (failure.retryAfterSeconds !== undefined) {
    parts.push(`Try again in ${failure.retryAfterSeconds} seconds.`);
  } else if (failure.retryable) {
    parts.push("You can retry this action.");
  }
  if (failure.requestId) parts.push(`Reference: ${failure.requestId}.`);
  return parts.map(sentence).join(" ");
}

function sentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}
