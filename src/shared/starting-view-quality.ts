// Starting-view quality: the publish-time contract that a frozen visitor
// starting view frames visible reconstructed content, not the dark void
// around the capture. The renderer measures the exact frame the operator
// captured ("Use current view" reads the live WebGL canvas), the Studio
// client attaches those measurements to the publish request as an
// operator-session receipt, and the Worker enforces the thresholds and
// freezes the receipt with the release — the same client-collected,
// worker-enforced shape as walk-test receipts.

export const STARTING_VIEW_QUALITY_SCHEMA_VERSION = "starting-view-quality-v1";

// Receipt for 0.09: the renderer clears every uncovered pixel to #080b0d,
// whose Rec. 709 luminance is 0.041. Unreconstructed space therefore measures
// at or just above 0.041 (splat fringes lift it slightly), while even dim
// reconstructed surfaces in the e2e fixtures measure above 0.15. 0.09 sits a
// little over twice the void luminance: everything the clear color paints is
// "near black", and no lit surface is. Reproduce with
// `npx playwright test e2e/starting-view-quality.spec.ts` — the spec prints
// the measured fractions for a void-facing and a content-facing capture.
export const STARTING_VIEW_NEAR_BLACK_LUMINANCE_CEILING = 0.09;

// Receipt for 0.85: a legitimate dim interior can hold large dark regions —
// shadowed floors and unlit corners — but it never fills seven-eighths of the
// frame with them; the content-facing e2e capture measures well under 0.5
// near-black even though the fixture wall covers only part of the frame. The
// failure being gated (the frozen view that shipped facing an unreconstructed
// corner) is the opposite regime: the void-facing e2e capture measures at
// essentially 1.0. 0.85 is a tripwire between the two regimes with wide
// margin on both sides; a good starting view never feels it.
export const STARTING_VIEW_MAX_NEAR_BLACK_FRACTION = 0.85;

// Receipt for 0.10: coverage counts pixels that differ from the renderer's
// clear color at all, i.e. pixels with any splat contribution. A view that is
// dark but real still covers most of the frame; the void covers none of it
// (the void-facing e2e capture measures ~0.0, the content-facing one well
// above 0.3). Requiring one-tenth of the frame to contain any reconstruction
// at all is the floor below which the visitor is looking at nothing.
export const STARTING_VIEW_MIN_RENDERED_COVERAGE_FRACTION = 0.1;

// Soft advisory band, surfaced in the publish dialog before submit but never
// enforced: past these the view is publishable yet likely disappointing.
export const STARTING_VIEW_WARN_NEAR_BLACK_FRACTION = 0.6;
export const STARTING_VIEW_WARN_RENDERED_COVERAGE_FRACTION = 0.3;
export const STARTING_VIEW_WARN_MEAN_LUMINANCE_FLOOR = 0.06;

// A receipt sampled from a handful of pixels proves nothing. The renderer
// samples up to 65,536 pixels on a stride; even a minimal 375x600 mobile
// canvas yields far more than this floor, so only a truncated or fabricated
// receipt trips it.
export const STARTING_VIEW_MIN_SAMPLED_PIXELS = 1_024;

export type StartingViewQualityMetrics = {
  schemaVersion: typeof STARTING_VIEW_QUALITY_SCHEMA_VERSION;
  capturedAt: string;
  frame: { width: number; height: number; sampledPixels: number };
  /** Fraction of sampled pixels at or below the near-black luminance ceiling. */
  nearBlackFraction: number;
  /** Mean Rec. 709 luminance of the sampled pixels, 0..1. */
  meanLuminance: number;
  /** Fraction of sampled pixels with any splat contribution (differs from the clear color). */
  renderedCoverageFraction: number;
};

function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

// Hard failures. Every message names the measured amount and the limit so an
// operator (or their agent) can act on the rejection without reading code.
export function startingViewQualityViolations(
  metrics: StartingViewQualityMetrics,
): string[] {
  const violations: string[] = [];
  if (metrics.nearBlackFraction > STARTING_VIEW_MAX_NEAR_BLACK_FRACTION) {
    violations.push(
      `The starting view frames mostly unreconstructed space (${
        formatPercent(metrics.nearBlackFraction)
      } near-black, limit ${
        formatPercent(STARTING_VIEW_MAX_NEAR_BLACK_FRACTION)
      }) — move to a view with visible content, then capture it again`,
    );
  }
  if (metrics.renderedCoverageFraction < STARTING_VIEW_MIN_RENDERED_COVERAGE_FRACTION) {
    violations.push(
      `The starting view shows almost no reconstructed content (${
        formatPercent(metrics.renderedCoverageFraction)
      } splat coverage, minimum ${
        formatPercent(STARTING_VIEW_MIN_RENDERED_COVERAGE_FRACTION)
      }) — face the reconstructed scene, then capture it again`,
    );
  }
  return violations;
}

// Soft advisory band for the publish dialog. Never blocks.
export function startingViewQualityWarnings(
  metrics: StartingViewQualityMetrics,
): string[] {
  if (startingViewQualityViolations(metrics).length) return [];
  const warnings: string[] = [];
  if (metrics.nearBlackFraction > STARTING_VIEW_WARN_NEAR_BLACK_FRACTION) {
    warnings.push(
      `Most of this view is near-black (${formatPercent(metrics.nearBlackFraction)}); visitors will open facing a largely dark frame.`,
    );
  }
  if (metrics.renderedCoverageFraction < STARTING_VIEW_WARN_RENDERED_COVERAGE_FRACTION) {
    warnings.push(
      `Reconstructed content covers only ${formatPercent(metrics.renderedCoverageFraction)} of this view.`,
    );
  }
  if (metrics.meanLuminance < STARTING_VIEW_WARN_MEAN_LUMINANCE_FLOOR) {
    warnings.push("This view is very dark on average.");
  }
  return warnings;
}

// The Studio client receives metrics through the renderer's postMessage
// bridge, which is untrusted data: validate every field before treating it as
// a receipt candidate.
export function parseStartingViewQualityMetrics(
  value: unknown,
): StartingViewQualityMetrics | null {
  if (!value || typeof value !== "object") return null;
  if (
    Reflect.get(value, "schemaVersion") !== STARTING_VIEW_QUALITY_SCHEMA_VERSION
  ) return null;
  const capturedAt = Reflect.get(value, "capturedAt");
  if (typeof capturedAt !== "string" || Number.isNaN(Date.parse(capturedAt))) return null;
  const frame = Reflect.get(value, "frame");
  if (!frame || typeof frame !== "object") return null;
  const width = Number(Reflect.get(frame, "width"));
  const height = Number(Reflect.get(frame, "height"));
  const sampledPixels = Number(Reflect.get(frame, "sampledPixels"));
  if (
    !Number.isInteger(width) || width < 1 ||
    !Number.isInteger(height) || height < 1 ||
    !Number.isInteger(sampledPixels) || sampledPixels < STARTING_VIEW_MIN_SAMPLED_PIXELS
  ) return null;
  const fractions = [
    Number(Reflect.get(value, "nearBlackFraction")),
    Number(Reflect.get(value, "meanLuminance")),
    Number(Reflect.get(value, "renderedCoverageFraction")),
  ];
  if (fractions.some((fraction) => !Number.isFinite(fraction) || fraction < 0 || fraction > 1)) {
    return null;
  }
  return {
    schemaVersion: STARTING_VIEW_QUALITY_SCHEMA_VERSION,
    capturedAt,
    frame: { width, height, sampledPixels },
    nearBlackFraction: fractions[0]!,
    meanLuminance: fractions[1]!,
    renderedCoverageFraction: fractions[2]!,
  };
}
