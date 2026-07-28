import { describe, expect, it } from "vitest";
import { runAction, SingleFlight } from "../src/client/action-state";

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
    } as unknown as HTMLButtonElement;
    const errorTarget = { textContent: "" } as HTMLElement;
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
});
