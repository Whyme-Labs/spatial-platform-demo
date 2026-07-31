export const RELEASE_COUPLED_SPATIAL_COLLECTIONS = [
  "entities",
  "routes",
  "routeStops",
  "navigationObstacles",
] as const;

export function hasAuthoredSpatialRuntime(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return RELEASE_COUPLED_SPATIAL_COLLECTIONS.some((key) => {
    const collection = Reflect.get(value, key);
    return Array.isArray(collection) && collection.length > 0;
  });
}
