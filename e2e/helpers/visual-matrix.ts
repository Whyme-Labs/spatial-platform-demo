import { expect, type Page } from "@playwright/test";

export const RESPONSIVE_VISUAL_VIEWPORTS = [
  { name: "large-desktop", width: 1440, height: 1000 },
  { name: "standard-laptop", width: 1280, height: 800 },
  { name: "collapse-entry", width: 1100, height: 800 },
  { name: "tablet-laptop", width: 1024, height: 768 },
  { name: "pre-collapse", width: 961, height: 768 },
  { name: "post-collapse", width: 960, height: 768 },
  { name: "portrait-tablet", width: 768, height: 1024 },
  { name: "phone", width: 390, height: 844 },
  { name: "small-phone", width: 320, height: 568 },
  { name: "short-landscape", width: 844, height: 390 },
] as const;

export async function expectReviewedScreenshot(
  page: Page,
  name: string,
): Promise<void> {
  // The committed baselines are reviewed in the pinned Ubuntu/Chromium
  // environment used by CI. Other platforms still execute every geometry
  // assertion; use the documented Docker command for pixel comparison.
  if (process.platform !== "linux") return;
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
  });
}
