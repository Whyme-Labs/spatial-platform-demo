import { describe, expect, it } from "vitest";
import { isRendererOverlayLayoutMessage } from "../src/shared/overlay-layout";

const validMessage = {
  source: "spatial-spark",
  type: "overlay-layout",
  viewport: { width: 844, height: 390 },
  zones: {
    toolbar: { left: 590, right: 834, top: 10, bottom: 62 },
    status: null,
    help: null,
    movement: { left: 18, right: 150, top: 240, bottom: 372 },
    altitude: null,
  },
};

describe("isRendererOverlayLayoutMessage", () => {
  it("accepts a complete renderer layout receipt", () => {
    expect(isRendererOverlayLayoutMessage(validMessage)).toBe(true);
  });

  it.each([
    { ...validMessage, viewport: undefined },
    { ...validMessage, viewport: { width: Number.NaN, height: 390 } },
    { ...validMessage, zones: undefined },
    { ...validMessage, zones: { ...validMessage.zones, toolbar: undefined } },
    {
      ...validMessage,
      zones: {
        ...validMessage.zones,
        movement: { left: 150, right: 18, top: 240, bottom: 372 },
      },
    },
  ])("rejects malformed renderer layout receipts", (message) => {
    expect(isRendererOverlayLayoutMessage(message)).toBe(false);
  });
});
