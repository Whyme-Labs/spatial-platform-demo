import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderProcessWorkspace } from "../src/client/studio/stages/process";
import {
  detailLine,
  detailTask,
  element,
  emptyState,
  noticeSurface,
  recordRow,
  recordSurface,
  taskDisclosure,
  workspaceTask,
} from "../src/client/studio/ui/dom";

class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  className = "";
  textContent = "";

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }
}

function rendered(node: unknown): FakeElement {
  if (!(node instanceof FakeElement)) throw new Error("Expected the fake DOM element");
  return node;
}

describe("Studio DOM module", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: (tagName: string) => new FakeElement(tagName),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("assigns semantic roles only through explicit surface primitives", () => {
    expect(rendered(element("article", "detail-card")).dataset.surfaceRole).toBeUndefined();

    const task = rendered(workspaceTask("process-task"));
    expect(task.className).toBe("workspace-card-large process-task");
    expect(task.dataset.surfaceRole).toBe("task");
    expect(rendered(detailTask()).dataset.surfaceRole).toBe("task");
    expect(rendered(taskDisclosure()).dataset.surfaceRole).toBe("task");

    const notice = rendered(noticeSurface("p", "success", "Ready"));
    expect(notice.className).toBe("notice-card success");
    expect(notice.dataset.surfaceRole).toBe("notice");

    expect(rendered(recordSurface("section", "plan-card")).dataset.surfaceRole).toBe("record");
    const row = rendered(recordRow("article", "domain-row"));
    expect(row.className).toBe("record-row domain-row");
    expect(row.dataset.surfaceRole).toBe("record");
    expect(rendered(detailLine("Version 1")).dataset.surfaceRole).toBe("record");

    const compact = rendered(emptyState("Nothing here", true));
    expect(compact.className).toBe("empty-state compact");
    expect(compact.textContent).toBe("Nothing here");
  });

  it("renders Process state and history from explicit inputs", () => {
    const container = element("section");
    renderProcessWorkspace({
      container,
      jobs: [{
        job_type: "scene.prepare",
        state: "RUNNING",
        progress: 42,
        progress_message: null,
      }],
      process: {
        kind: "working",
        title: "Prepare scene",
        job: {
          job_type: "scene.prepare",
          state: "RUNNING",
          progress: 42,
          progress_message: "Indexing geometry",
        },
      },
      humanStatus: (status) => status.replaceAll("_", " ").toLowerCase(),
    });

    const [task, history] = rendered(container).children;
    expect(task?.dataset.surfaceRole).toBe("task");
    expect(task?.children[2]?.textContent).toBe("Indexing geometry");
    expect(task?.children[3]?.children[0]?.style.width).toBe("42%");
    expect(history?.dataset.surfaceRole).toBe("task");
    expect(history?.children[1]?.children[0]?.textContent).toBe(
      "scene.prepare · running · 42% complete",
    );
    expect(history?.children[1]?.children[0]?.dataset.surfaceRole).toBe("record");
  });
});
