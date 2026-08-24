export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

type SurfaceRole = "task" | "notice" | "record";

function classNames(baseClass: string, extraClassName: string): string {
  return extraClassName ? `${baseClass} ${extraClassName}` : baseClass;
}

function surfaceElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  role: SurfaceRole,
  className: string,
  text = "",
): HTMLElementTagNameMap[K] {
  const node = element(tag, className, text);
  node.dataset.surfaceRole = role;
  return node;
}

export function workspaceTask(extraClassName = ""): HTMLElement {
  return surfaceElement("article", "task", classNames("workspace-card-large", extraClassName));
}

export function detailTask(extraClassName = ""): HTMLElement {
  return surfaceElement("article", "task", classNames("detail-card", extraClassName));
}

export function taskDisclosure(extraClassName = ""): HTMLDetailsElement {
  return surfaceElement("details", "task", classNames("project-detail-disclosure", extraClassName));
}

export function noticeSurface<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  extraClassName = "",
  text = "",
): HTMLElementTagNameMap[K] {
  return surfaceElement(tag, "notice", classNames("notice-card", extraClassName), text);
}

export function recordSurface<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = "",
): HTMLElementTagNameMap[K] {
  return surfaceElement(tag, "record", className, text);
}

export function recordRow<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  extraClassName = "",
  text = "",
): HTMLElementTagNameMap[K] {
  return recordSurface(tag, classNames("record-row", extraClassName), text);
}

export function detailLine(text = "", extraClassName = ""): HTMLDivElement {
  return recordSurface("div", classNames("detail-line", extraClassName), text);
}

export function emptyState(message: string, compact = false): HTMLElement {
  return element("div", `empty-state${compact ? " compact" : ""}`, message);
}
