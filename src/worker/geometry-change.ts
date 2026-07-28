export type GeometryEntity = {
  id: string;
  kind: string;
  label: string;
  geometry_json: string | null;
};

type Point2 = [number, number];

type NormalizedGeometry = {
  entityId: string;
  kind: string;
  label: string;
  key: string;
  points: Point2[];
  yMin: number;
  yMax: number;
  areaM2: number;
  centroid: Point2;
};

type ChangeInput = {
  fromVersion: { id: string; versionNumber: number };
  toVersion: { id: string; versionNumber: number };
  fromEntities: GeometryEntity[];
  toEntities: GeometryEntity[];
  thresholdMm: number;
  coordinateAssurance: "shared_local_frame" | "registered_project_frame";
  registrationEvidence: string;
};

export type AuthoredGeometryChangeReport = {
  method: "authored-plan-geometry-diff-v1";
  result: "changes_detected" | "no_material_change" | "insufficient_correspondence";
  scope: "authored_semantic_geometry";
  limitation: string;
  thresholdMm: number;
  coordinateAssurance: ChangeInput["coordinateAssurance"];
  registrationEvidence: string;
  versions: {
    from: ChangeInput["fromVersion"];
    to: ChangeInput["toVersion"];
  };
  summary: {
    comparable: number;
    changed: number;
    unchanged: number;
    added: number;
    removed: number;
    p50DeviationMm: number | null;
    p95DeviationMm: number | null;
    maxDeviationMm: number | null;
  };
  comparisons: Array<{
    key: string;
    label: string;
    kind: string;
    fromEntityId: string;
    toEntityId: string;
    classification: "changed" | "unchanged";
    centroidDisplacementMm: number;
    boundaryDeviationMm: number;
    verticalDeviationMm: number;
    maxDeviationMm: number;
    areaFromM2: number;
    areaToM2: number;
    areaDeltaM2: number;
    areaDeltaPercent: number | null;
  }>;
  added: Array<{ key: string; label: string; kind: string; entityId: string }>;
  removed: Array<{ key: string; label: string; kind: string; entityId: string }>;
  blockers: string[];
  invalidGeometry: Array<{
    version: "from" | "to";
    entityId: string;
    label: string;
    reason: string;
  }>;
  visual: {
    coordinatePlane: "XZ";
    units: "metres";
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number } | null;
    overlays: Array<{
      key: string;
      label: string;
      kind: string;
      classification: "changed" | "unchanged" | "added" | "removed";
      fromPoints: Point2[] | null;
      toPoints: Point2[] | null;
    }>;
  };
};

const comparableKinds = new Set(["floor", "room", "doorway"]);

export function computeAuthoredGeometryChange(input: ChangeInput): AuthoredGeometryChangeReport {
  const invalidGeometry: AuthoredGeometryChangeReport["invalidGeometry"] = [];
  const from = normalizeEntities(input.fromEntities, "from", invalidGeometry);
  const to = normalizeEntities(input.toEntities, "to", invalidGeometry);
  const blockers: string[] = [];
  const fromByKey = uniqueGeometryMap(from, "from", blockers);
  const toByKey = uniqueGeometryMap(to, "to", blockers);
  const comparisons: AuthoredGeometryChangeReport["comparisons"] = [];
  const added: AuthoredGeometryChangeReport["added"] = [];
  const removed: AuthoredGeometryChangeReport["removed"] = [];
  const overlays: AuthoredGeometryChangeReport["visual"]["overlays"] = [];
  const matchedKeys = new Set<string>();

  for (const [key, fromGeometry] of fromByKey) {
    const toGeometry = toByKey.get(key);
    if (!toGeometry) {
      removed.push(entityReference(fromGeometry));
      overlays.push({
        key,
        label: fromGeometry.label,
        kind: fromGeometry.kind,
        classification: "removed",
        fromPoints: fromGeometry.points,
        toPoints: null,
      });
      continue;
    }
    matchedKeys.add(key);
    const centroidDisplacementMm = rounded(distance(fromGeometry.centroid, toGeometry.centroid) * 1_000);
    const boundaryDeviationMm = rounded(
      symmetricBoundaryDeviation(fromGeometry.points, toGeometry.points) * 1_000,
    );
    const verticalDeviationMm = rounded(Math.max(
      Math.abs(fromGeometry.yMin - toGeometry.yMin),
      Math.abs(fromGeometry.yMax - toGeometry.yMax),
    ) * 1_000);
    const maxDeviationMm = rounded(Math.max(
      centroidDisplacementMm,
      boundaryDeviationMm,
      verticalDeviationMm,
    ));
    const areaDeltaM2 = rounded(toGeometry.areaM2 - fromGeometry.areaM2, 6);
    const areaDeltaPercent = fromGeometry.areaM2 > 0
      ? rounded((areaDeltaM2 / fromGeometry.areaM2) * 100, 3)
      : null;
    const classification = maxDeviationMm > input.thresholdMm ? "changed" : "unchanged";
    comparisons.push({
      key,
      label: fromGeometry.label,
      kind: fromGeometry.kind,
      fromEntityId: fromGeometry.entityId,
      toEntityId: toGeometry.entityId,
      classification,
      centroidDisplacementMm,
      boundaryDeviationMm,
      verticalDeviationMm,
      maxDeviationMm,
      areaFromM2: rounded(fromGeometry.areaM2, 6),
      areaToM2: rounded(toGeometry.areaM2, 6),
      areaDeltaM2,
      areaDeltaPercent,
    });
    overlays.push({
      key,
      label: fromGeometry.label,
      kind: fromGeometry.kind,
      classification,
      fromPoints: fromGeometry.points,
      toPoints: toGeometry.points,
    });
  }

  for (const [key, toGeometry] of toByKey) {
    if (matchedKeys.has(key) || fromByKey.has(key)) continue;
    added.push(entityReference(toGeometry));
    overlays.push({
      key,
      label: toGeometry.label,
      kind: toGeometry.kind,
      classification: "added",
      fromPoints: null,
      toPoints: toGeometry.points,
    });
  }

  if (invalidGeometry.length) {
    blockers.push(`${invalidGeometry.length} authored geometry record(s) were invalid`);
  }
  if (!comparisons.length) blockers.push("No unambiguous authored geometry correspondence was available");

  const deviations = comparisons.map((comparison) => comparison.maxDeviationMm).sort((a, b) => a - b);
  const changed = comparisons.filter((comparison) => comparison.classification === "changed").length;
  const result = blockers.length
    ? "insufficient_correspondence"
    : changed || added.length || removed.length
      ? "changes_detected"
      : "no_material_change";

  return {
    method: "authored-plan-geometry-diff-v1",
    result,
    scope: "authored_semantic_geometry",
    limitation: "This compares operator-authored floor, room, and doorway geometry in an asserted common coordinate frame. It is not a raw point-cloud, Gaussian, photometric, or survey registration result.",
    thresholdMm: input.thresholdMm,
    coordinateAssurance: input.coordinateAssurance,
    registrationEvidence: input.registrationEvidence,
    versions: { from: input.fromVersion, to: input.toVersion },
    summary: {
      comparable: comparisons.length,
      changed,
      unchanged: comparisons.length - changed,
      added: added.length,
      removed: removed.length,
      p50DeviationMm: quantile(deviations, 0.5),
      p95DeviationMm: quantile(deviations, 0.95),
      maxDeviationMm: deviations.length ? deviations.at(-1)! : null,
    },
    comparisons,
    added,
    removed,
    blockers: [...new Set(blockers)],
    invalidGeometry,
    visual: {
      coordinatePlane: "XZ",
      units: "metres",
      bounds: visualBounds(overlays),
      overlays,
    },
  };
}

function normalizeEntities(
  entities: GeometryEntity[],
  version: "from" | "to",
  invalid: AuthoredGeometryChangeReport["invalidGeometry"],
): NormalizedGeometry[] {
  const normalized: NormalizedGeometry[] = [];
  for (const entity of entities) {
    if (!comparableKinds.has(entity.kind) || !entity.geometry_json) continue;
    try {
      const geometry = JSON.parse(entity.geometry_json) as unknown;
      normalized.push(normalizeGeometry(entity, geometry));
    } catch (error) {
      invalid.push({
        version,
        entityId: entity.id,
        label: entity.label,
        reason: error instanceof Error ? error.message : "Invalid geometry",
      });
    }
  }
  return normalized;
}

function normalizeGeometry(entity: GeometryEntity, geometry: unknown): NormalizedGeometry {
  if (!geometry || typeof geometry !== "object") throw new Error("Geometry is not an object");
  const type = Reflect.get(geometry, "type");
  const rawPoints = Reflect.get(geometry, "points");
  if (!Array.isArray(rawPoints)) throw new Error("Geometry points are missing");
  const points3 = rawPoints.map((point) => {
    if (!Array.isArray(point) || point.length !== 3) throw new Error("Every geometry point must have three coordinates");
    const values = point.map(Number);
    if (values.some((value) => !Number.isFinite(value))) throw new Error("Geometry coordinates must be finite");
    return values as [number, number, number];
  });
  let points: Point2[];
  let yMin: number;
  let yMax: number;
  if (type === "box") {
    if (points3.length !== 2) throw new Error("Box geometry requires two corner points");
    const [a, b] = points3;
    const minX = Math.min(a![0], b![0]);
    const minZ = Math.min(a![2], b![2]);
    const maxX = Math.max(a![0], b![0]);
    const maxZ = Math.max(a![2], b![2]);
    yMin = Math.min(a![1], b![1]);
    yMax = Math.max(a![1], b![1]);
    if (maxX <= minX || maxZ <= minZ || yMax <= yMin) throw new Error("Box geometry has zero or negative extent");
    points = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
  } else if (type === "polygon") {
    if (points3.length < 3) throw new Error("Polygon geometry requires at least three points");
    points = points3.map(([x, , z]) => [x, z]);
    yMin = Math.min(...points3.map((point) => point[1]));
    yMax = Math.max(...points3.map((point) => point[1]));
  } else {
    throw new Error("Only box and polygon geometry is comparable");
  }
  const areaM2 = polygonArea(points);
  if (areaM2 <= 1e-9) throw new Error("Geometry footprint has zero area");
  return {
    entityId: entity.id,
    kind: entity.kind,
    label: entity.label.trim(),
    key: semanticKey(entity.kind, entity.label),
    points,
    yMin,
    yMax,
    areaM2,
    centroid: polygonCentroid(points),
  };
}

function uniqueGeometryMap(
  geometries: NormalizedGeometry[],
  version: "from" | "to",
  blockers: string[],
): Map<string, NormalizedGeometry> {
  const groups = new Map<string, NormalizedGeometry[]>();
  for (const geometry of geometries) {
    const group = groups.get(geometry.key) ?? [];
    group.push(geometry);
    groups.set(geometry.key, group);
  }
  const result = new Map<string, NormalizedGeometry>();
  for (const [key, group] of groups) {
    if (group.length > 1) {
      blockers.push(`Duplicate ${version}-version semantic key: ${key}`);
      continue;
    }
    result.set(key, group[0]!);
  }
  return result;
}

function semanticKey(kind: string, label: string): string {
  return `${kind.trim().toLowerCase()}:${label.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

function entityReference(geometry: NormalizedGeometry) {
  return {
    key: geometry.key,
    label: geometry.label,
    kind: geometry.kind,
    entityId: geometry.entityId,
  };
}

function polygonArea(points: Point2[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twiceArea) / 2;
}

function polygonCentroid(points: Point2[]): Point2 {
  let crossSum = 0;
  let xSum = 0;
  let ySum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const cross = current[0] * next[1] - next[0] * current[1];
    crossSum += cross;
    xSum += (current[0] + next[0]) * cross;
    ySum += (current[1] + next[1]) * cross;
  }
  if (Math.abs(crossSum) < 1e-12) {
    return [
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    ];
  }
  return [xSum / (3 * crossSum), ySum / (3 * crossSum)];
}

function symmetricBoundaryDeviation(left: Point2[], right: Point2[]): number {
  return Math.max(
    directedBoundaryDeviation(left, right),
    directedBoundaryDeviation(right, left),
  );
}

function directedBoundaryDeviation(source: Point2[], target: Point2[]): number {
  return Math.max(...source.map((point) => {
    let minimum = Number.POSITIVE_INFINITY;
    for (let index = 0; index < target.length; index += 1) {
      minimum = Math.min(
        minimum,
        pointSegmentDistance(point, target[index]!, target[(index + 1) % target.length]!),
      );
    }
    return minimum;
  }));
}

function pointSegmentDistance(point: Point2, start: Point2, end: Point2): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const projection = Math.max(0, Math.min(
    1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
  ));
  return distance(point, [start[0] + projection * dx, start[1] + projection * dy]);
}

function distance(left: Point2, right: Point2): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function quantile(sorted: number[], probability: number): number | null {
  if (!sorted.length) return null;
  const index = Math.ceil(probability * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]!;
}

function visualBounds(overlays: AuthoredGeometryChangeReport["visual"]["overlays"]) {
  const points = overlays.flatMap((overlay) => [
    ...(overlay.fromPoints ?? []),
    ...(overlay.toPoints ?? []),
  ]);
  if (!points.length) return null;
  return {
    minX: Math.min(...points.map((point) => point[0])),
    minZ: Math.min(...points.map((point) => point[1])),
    maxX: Math.max(...points.map((point) => point[0])),
    maxZ: Math.max(...points.map((point) => point[1])),
  };
}

function rounded(value: number, decimals = 3): number {
  const multiplier = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}
