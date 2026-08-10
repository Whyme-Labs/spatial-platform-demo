import { PROVISIONAL_MEASUREMENT_DISCLAIMER } from "./world-units";

export const measurementGrades = [
  "visual-only",
  "indicative",
  "project-verified",
  "professional-certified",
] as const;

export type MeasurementGrade = typeof measurementGrades[number];

export function parseMeasurementGrade(value: unknown): MeasurementGrade | null {
  return (measurementGrades as readonly unknown[]).includes(value)
    ? value as MeasurementGrade
    : null;
}

export function publicationMeasurementDisclaimer(
  grade: MeasurementGrade,
  provisionalUnits = false,
): string {
  if (provisionalUnits) return PROVISIONAL_MEASUREMENT_DISCLAIMER;
  switch (grade) {
    case "visual-only":
      return "This visual experience is not a certified survey and must not be relied upon for construction or boundary decisions.";
    case "indicative":
      return "Scene measurements are indicative only, have not been project-verified, and must not be used for construction or boundary decisions.";
    case "project-verified":
      return "Measurements were reviewed for this project, but this viewer is not a certified survey. Use the separately reviewed, hash-bound deliverables for project decisions.";
    case "professional-certified":
      return "Professional certification applies only to the separately identified, signed measurement deliverables. This viewer is not a substitute for those records.";
  }
}
