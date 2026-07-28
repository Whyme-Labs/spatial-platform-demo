export class SingleFlight {
  private readonly active = new Map<string, Promise<unknown>>();

  isPending(key: string): boolean {
    return this.active.has(key);
  }

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const current = this.active.get(key);
    if (current) return current as Promise<T>;

    let result: Promise<T>;
    try {
      result = task();
    } catch (error) {
      result = Promise.reject(error);
    }
    const pending = result
      .finally(() => {
        if (this.active.get(key) === pending) this.active.delete(key);
      });
    this.active.set(key, pending);
    return pending;
  }
}

export type ActionUiOptions = {
  key: string;
  trigger: HTMLButtonElement;
  pendingLabel: string;
  idleLabel?: string | (() => string);
  form?: HTMLFormElement;
  errorTarget?: HTMLElement;
  disable?: Array<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>;
  keepEnabled?: Array<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>;
};

const actionFlights = new SingleFlight();

export function isActionPending(key: string): boolean {
  return actionFlights.isPending(key);
}

export function runAction<T>(
  options: ActionUiOptions,
  task: () => Promise<T>,
): Promise<T | undefined> {
  return actionFlights.run(options.key, async () => {
    const controls = uniqueControls(options);
    const disabledStates = controls.map((control) => [control, control.disabled] as const);
    const originalLabel = options.trigger.textContent ?? "";

    if (!options.errorTarget && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("spatial-action-start"));
    }
    if (options.errorTarget) options.errorTarget.textContent = "";
    options.trigger.textContent = options.pendingLabel;
    options.trigger.classList.add("is-pending");
    options.trigger.setAttribute("aria-busy", "true");
    options.form?.setAttribute("aria-busy", "true");
    for (const control of controls) control.disabled = true;

    try {
      return await task();
    } catch (error) {
      const message = actionErrorMessage(error);
      if (options.errorTarget) {
        options.errorTarget.textContent = message;
      } else if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("spatial-action-error", {
          detail: { message },
        }));
      }
      return undefined;
    } finally {
      const idleLabel = typeof options.idleLabel === "function"
        ? options.idleLabel()
        : options.idleLabel ?? originalLabel;
      options.trigger.textContent = idleLabel;
      options.trigger.classList.remove("is-pending");
      options.trigger.removeAttribute("aria-busy");
      options.form?.removeAttribute("aria-busy");
      for (const [control, wasDisabled] of disabledStates) {
        if (control.isConnected) control.disabled = wasDisabled;
      }
    }
  });
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The action could not be completed. Review the connection and retry.";
}

function uniqueControls(
  options: ActionUiOptions,
): Array<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement> {
  const controls = options.form
    ? Array.from(options.form.querySelectorAll<
      HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement
    >("input, button, select, textarea"))
    : [options.trigger];
  for (const control of options.disable ?? []) {
    if (!controls.includes(control)) controls.push(control);
  }
  return controls.filter((control) => !(options.keepEnabled ?? []).includes(control));
}
