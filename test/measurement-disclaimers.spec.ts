import { describe, expect, it } from "vitest";
import {
  parseMeasurementGrade,
  publicationMeasurementDisclaimer,
} from "../src/shared/measurement-disclaimers";
import { PROVISIONAL_MEASUREMENT_DISCLAIMER } from "../src/shared/world-units";

describe("approval-derived publication measurement disclaimers", () => {
  it("keeps every approved reliance grade distinct", () => {
    const grades = [
      "visual-only",
      "indicative",
      "project-verified",
      "professional-certified",
    ] as const;
    expect(new Set(grades.map((grade) => publicationMeasurementDisclaimer(grade))).size).toBe(4);
  });

  it("uses the provisional warning whenever the accepted transform has provisional units", () => {
    expect(publicationMeasurementDisclaimer("professional-certified", true))
      .toBe(PROVISIONAL_MEASUREMENT_DISCLAIMER);
  });

  it("rejects missing and unknown approval grades", () => {
    expect(parseMeasurementGrade("indicative")).toBe("indicative");
    expect(parseMeasurementGrade("unknown")).toBeNull();
    expect(parseMeasurementGrade(null)).toBeNull();
  });
});
