import { describe, expect, it } from "vitest";
import { resolveDeviceProfile } from "../src/client/device-profile";

describe("viewer device profile resolution", () => {
  it("treats a mobile device with no memory signal as mobile-lite", () => {
    // All WebKit browsers — every iPhone — omit navigator.deviceMemory, so the
    // unknown-memory mobile case must land on the conservative budget instead
    // of the standard one that can OOM-kill a low-RAM tab.
    expect(resolveDeviceProfile({ mobile: true, deviceMemoryGb: null }))
      .toBe("mobile-lite");
  });

  it("keeps the reported-memory mobile split", () => {
    expect(resolveDeviceProfile({ mobile: true, deviceMemoryGb: 4 }))
      .toBe("mobile-lite");
    expect(resolveDeviceProfile({ mobile: true, deviceMemoryGb: 8 }))
      .toBe("mobile-standard");
  });

  it("keeps the desktop split, defaulting to standard without a signal", () => {
    expect(resolveDeviceProfile({ mobile: false, deviceMemoryGb: null }))
      .toBe("desktop-standard");
    expect(resolveDeviceProfile({ mobile: false, deviceMemoryGb: 4 }))
      .toBe("desktop-standard");
    expect(resolveDeviceProfile({ mobile: false, deviceMemoryGb: 8 }))
      .toBe("desktop-high");
  });
});
