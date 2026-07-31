import { describe, expect, it } from "vitest";
import { rendererLoadTimeoutMs } from "../src/shared/renderer-readiness";

describe("published renderer readiness", () => {
  it("keeps the existing Spark timeout", () => {
    expect(rendererLoadTimeoutMs("rad", 54_803_033)).toBe(60_000);
  });

  it("allows a first-time 52 MiB native SOG load to finish", () => {
    expect(rendererLoadTimeoutMs("sog", 54_803_033)).toBe(180_000);
  });

  it("bounds native SOG waits between three and five minutes", () => {
    expect(rendererLoadTimeoutMs("sog", 1)).toBe(180_000);
    expect(rendererLoadTimeoutMs("sog", Number.MAX_SAFE_INTEGER)).toBe(300_000);
  });
});
