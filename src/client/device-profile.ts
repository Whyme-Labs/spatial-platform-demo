export type DeviceProfile =
  | "mobile-lite"
  | "mobile-standard"
  | "desktop-standard"
  | "desktop-high";

// WebKit implements navigator.deviceMemory on no platform, so every iPhone
// reaches the viewer with no memory signal at all. hardwareConcurrency is no
// substitute: low-RAM phones ship high core counts (a 3 GB iPhone SE reports
// six). A mobile device that cannot prove its memory therefore takes the
// conservative tier — the lite budget degrades splat density a little, while
// the standard budget can end a low-RAM tab in a silent OOM kill. Browsers
// that do expose deviceMemory (Android Chrome) keep the finer split.
export function resolveDeviceProfile(input: {
  mobile: boolean;
  deviceMemoryGb: number | null;
}): DeviceProfile {
  if (input.mobile) {
    return input.deviceMemoryGb === null || input.deviceMemoryGb <= 4
      ? "mobile-lite"
      : "mobile-standard";
  }
  return input.deviceMemoryGb !== null && input.deviceMemoryGb >= 8
    ? "desktop-high"
    : "desktop-standard";
}
