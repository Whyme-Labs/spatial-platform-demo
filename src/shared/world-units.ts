export type WorldUnit = "metres" | "scene_units";

export const PROVISIONAL_MEASUREMENT_DISCLAIMER =
  "Provisional scene units (SU) only. Distances, areas, navigation radii, and heights are relative values, not real-world measurements, and must not be relied upon for construction, survey, boundary, clearance, or accessibility decisions.";

export function parseWorldUnit(value: unknown): WorldUnit {
  return value === "scene_units" ? "scene_units" : "metres";
}

export function worldUnitSymbol(worldUnit: WorldUnit | undefined): "m" | "SU" {
  return worldUnit === "scene_units" ? "SU" : "m";
}
