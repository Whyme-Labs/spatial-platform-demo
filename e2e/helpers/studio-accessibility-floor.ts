import type { Page } from "@playwright/test";

export interface StudioAccessibilityFloorAudit {
  text: Array<{
    text: string;
    tagName: string;
    className: string;
    fontSize: number;
  }>;
  controls: Array<{
    label: string;
    tagName: string;
    width: number;
    height: number;
  }>;
}

export async function auditStudioAccessibilityFloor(
  page: Page,
  options: {
    root?: string;
    minimumControlSize?: number;
    requireSquareControls?: boolean;
  } = {},
): Promise<StudioAccessibilityFloorAudit> {
  const {
    root = ".studio-shell",
    minimumControlSize = 40,
    requireSquareControls = false,
  } = options;

  return page.locator(root).evaluate((surface, auditOptions) => {
    const text: StudioAccessibilityFloorAudit["text"] = [];
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const element = node.parentElement;
      const content = node.textContent?.trim().replace(/\s+/g, " ");
      if (
        element &&
        content &&
        !element.closest('[aria-hidden="true"]') &&
        !element.matches("script,style,template")
      ) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const style = getComputedStyle(element);
        if (
          range.getClientRects().length > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        ) {
          const fontSize = Number.parseFloat(style.fontSize);
          if (fontSize < 12) {
            text.push({
              text: content.slice(0, 80),
              tagName: element.tagName,
              className: typeof element.className === "string"
                ? element.className
                : element.getAttribute("class") ?? "",
              fontSize,
            });
          }
        }
      }
      node = walker.nextNode();
    }

    const directControls = [...surface.querySelectorAll<HTMLElement>([
      "button",
      "a[href]",
      "summary",
      "select",
      "textarea",
      "input:not([type='checkbox']):not([type='radio']):not([type='color'])",
      "[role='button']",
      "[role='link']",
      "[role='tab']",
      "[role='menuitem']",
      "[role='option']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='switch']",
    ].join(","))];
    const choiceTargets = [...surface.querySelectorAll<HTMLInputElement>(
      "input[type='checkbox'],input[type='radio'],input[type='color']",
    )].map((input) => input.labels?.[0] ?? input);
    const controls = [...new Set([...directControls, ...choiceTargets])].flatMap((control) => {
      if (
        control.getClientRects().length === 0 ||
        control.closest('[aria-hidden="true"]')
      ) return [];
      const bounds = control.getBoundingClientRect();
      const undersized = bounds.height < auditOptions.minimumControlSize || (
        auditOptions.requireSquareControls && bounds.width < auditOptions.minimumControlSize
      );
      return undersized
        ? [{
            label: (
              control.textContent?.trim() ||
              control.getAttribute("aria-label") ||
              control.getAttribute("name") ||
              control.tagName
            ).replace(/\s+/g, " ").slice(0, 80),
            tagName: control.tagName,
            width: bounds.width,
            height: bounds.height,
          }]
        : [];
    });

    return { text, controls };
  }, { minimumControlSize, requireSquareControls });
}
