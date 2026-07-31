import { describe, expect, it } from "vitest";
import { rendererLoadTimeoutMs } from "../src/shared/renderer-readiness";

describe("published renderer readiness", () => {
  it("keeps the existing Spark timeout", () => {
    expect(rendererLoadTimeoutMs("rad", 54_803_033)).toBe(60_000);
  });

  it("allows a first-time 52 MiB Spark SOG load to finish", () => {
    expect(rendererLoadTimeoutMs("sog", 54_803_033)).toBe(240_000);
  });

  it("bounds Spark SOG waits between four and five minutes", () => {
    expect(rendererLoadTimeoutMs("sog", 1)).toBe(240_000);
    expect(rendererLoadTimeoutMs("sog", Number.MAX_SAFE_INTEGER)).toBe(300_000);
  });
});
