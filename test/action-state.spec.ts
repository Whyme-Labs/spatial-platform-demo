import { describe, expect, it } from "vitest";
import { runAction, SingleFlight } from "../src/client/action-state";
import { ApiError } from "../src/client/api";
import { describeActionFailure } from "../src/client/feedback";

describe("SingleFlight", () => {
  it("shares one in-flight action across rapid repeated triggers", async () => {
    let resolve!: (value: string) => void;
    let executions = 0;
    const pending = new Promise<string>((done) => {
      resolve = done;
    });
    const actions = new SingleFlight();
    const task = () => {
      executions += 1;
      return pending;
    };

    const first = actions.run("send-code", task);
    const second = actions.run("send-code", task);

    expect(executions).toBe(1);
    expect(actions.isPending("send-code")).toBe(true);
    resolve("sent");
    await expect(Promise.all([first, second])).resolves.toEqual(["sent", "sent"]);
    expect(actions.isPending("send-code")).toBe(false);
  });

  it("releases a failed action so the user can retry", async () => {
    const actions = new SingleFlight();
    let attempts = 0;
    const task = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
      return "recovered";
    };

    await expect(actions.run("publish", task)).rejects.toThrow("temporary failure");
    await expect(actions.run("publish", task)).resolves.toBe("recovered");
    expect(attempts).toBe(2);
  });

  it("does not block unrelated actions", async () => {
    const actions = new SingleFlight();
    const results = await Promise.all([
      actions.run("refresh", async () => "fresh"),
      actions.run("share", async () => "shared"),
    ]);

    expect(results).toEqual(["fresh", "shared"]);
  });

  it("surfaces an action error, restores the control, and leaves the action retryable", async () => {
    const classes = new Set<string>();
    const attributes = new Map<string, string>();
    const trigger = {
      textContent: "Generate DXF",
      disabled: false,
      isConnected: true,
      classList: {
        add: (value: string) => classes.add(value),
        remove: (value: string) => classes.delete(value),
      },
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
      getAttribute: (name: string) => attributes.get(name) ?? null,
    } as unknown as HTMLButtonElement;
    const errorTarget = fakeFeedbackTarget();
    let attempts = 0;

    await expect(runAction({
      key: "generate-dxf",
      trigger,
      pendingLabel: "Generating…",
      errorTarget,
    }, async () => {
      attempts += 1;
      throw new Error("DXF generation failed");
    })).resolves.toBeUndefined();

    expect(errorTarget.textContent).toBe("DXF generation failed");
    expect(trigger.textContent).toBe("Generate DXF");
    expect(trigger.disabled).toBe(false);
    expect(classes.size).toBe(0);
    expect(attributes.has("aria-busy")).toBe(false);

    await expect(runAction({
      key: "generate-dxf",
      trigger,
      pendingLabel: "Generating…",
      errorTarget,
    }, async () => {
      attempts += 1;
      return "ready";
    })).resolves.toBe("ready");
    expect(attempts).toBe(2);
    expect(errorTarget.textContent).toBe("");
  });

  it("preserves field, retry, and request evidence from API failures", async () => {
    const trigger = {
      textContent: "Save project",
      disabled: false,
      isConnected: true,
      classList: { add() {}, remove() {} },
      setAttribute() {},
      removeAttribute() {},
      getAttribute: () => null,
    } as unknown as HTMLButtonElement;
    const errorTarget = fakeFeedbackTarget();

    const details = { details: { fieldErrors: { name: ["Scene name is required"] } } };
    const failure = new ApiError(
      "Validation failed",
      429,
      details,
      "request-42",
      11,
      true,
    );
    const described = describeActionFailure(failure);
    expect(described).toMatchObject({
      kind: "validation",
      status: 429,
      requestId: "request-42",
      retryAfterSeconds: 11,
      retryable: true,
      fieldFailures: [{ field: "name", messages: ["Scene name is required."] }],
    });
    expect(described.details).toBe(details);
    expect(described.error).toBe(failure);
    expect(describeActionFailure(new ApiError(
      "Direct validation failed",
      422,
      { details: { name: ["Use another scene name"], _errors: ["Review the form"] } },
    ))).toMatchObject({
      kind: "validation",
      fieldFailures: [{ field: "name", messages: ["Use another scene name."] }],
      formMessages: ["Review the form."],
    });
    expect(describeActionFailure(new ApiError(
      "This scene requires access",
      401,
      { error: "This scene requires access", accessPolicy: "token" },
      "request-access",
    ))).toMatchObject({
      kind: "action",
      requestId: "request-access",
    });

    await runAction({
      key: "save-project",
      trigger,
      pendingLabel: "Saving…",
      errorTarget,
    }, async () => {
      throw failure;
    });

    expect(errorTarget.textContent).toBe(
      "Validation failed. Scene name is required. Try again in 11 seconds. Reference: request-42.",
    );
  });
});

function fakeFeedbackTarget(): HTMLElement {
  const attributes = new Map<string, string>();
  return {
    textContent: "",
    id: "",
    hidden: false,
    dataset: {},
    classList: { add() {} },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    getAttribute: (name: string) => attributes.get(name) ?? null,
  } as unknown as HTMLElement;
}
