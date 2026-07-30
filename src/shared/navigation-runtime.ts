export type Vector3Tuple = [number, number, number];

export type SourceToWorldTransform = {
  sourceUpAxis: "Y" | "Z";
  metresPerSourceUnit: number;
  yawDegrees: number;
  translationMetres: Vector3Tuple;
};

export type NavigationMesh = {
  vertices: Vector3Tuple[];
  indices: number[];
};

export type NavigationObstacleBox = {
  entityId: string;
  min: Vector3Tuple;
  max: Vector3Tuple;
};

export type NavigationProfile = {
  agentRadius: number;
  agentHeight: number;
  eyeHeight: number;
  maxStepMetres: number;
};

export type NavigationRuntime = {
  navigationMesh: NavigationMesh;
  obstacleBoxes: NavigationObstacleBox[];
  profile: NavigationProfile;
};

export const DEFAULT_SOURCE_TO_WORLD: SourceToWorldTransform = {
  sourceUpAxis: "Y",
  metresPerSourceUnit: 1,
  yawDegrees: 0,
  translationMetres: [0, 0, 0],
};

export const DEFAULT_NAVIGATION_PROFILE: NavigationProfile = {
  agentRadius: 0.22,
  agentHeight: 1.8,
  eyeHeight: 1.6,
  maxStepMetres: 0.1,
};

export function parseNavigationRuntimeMessage(
  message: unknown,
  legacyBoxes: Array<{ min: Vector3Tuple; max: Vector3Tuple }> = [],
): NavigationRuntime | null {
  if (!message || typeof message !== "object") return null;
  const rawMesh = Reflect.get(message, "navigationMesh");
  const rawVertices = rawMesh && typeof rawMesh === "object"
    ? Reflect.get(rawMesh, "vertices")
    : null;
  const rawIndices = rawMesh && typeof rawMesh === "object"
    ? Reflect.get(rawMesh, "indices")
    : null;
  const vertices = Array.isArray(rawVertices)
    ? rawVertices.flatMap((value) => {
        const tuple = finiteTuple(value);
        return tuple ? [tuple] : [];
      })
    : [];
  const indices = Array.isArray(rawIndices) ? rawIndices.map(Number) : [];
  const validAuthoredMesh =
    vertices.length >= 3 &&
    indices.length >= 3 &&
    indices.length % 3 === 0 &&
    indices.every((index) =>
      Number.isSafeInteger(index) && index >= 0 && index < vertices.length
    );
  if (!validAuthoredMesh && !legacyBoxes.length) return null;

  const legacyVertices: Vector3Tuple[] = [];
  const legacyIndices: number[] = [];
  if (!validAuthoredMesh) {
    for (const box of legacyBoxes) {
      const offset = legacyVertices.length;
      legacyVertices.push(
        [box.min[0], box.min[1], box.min[2]],
        [box.max[0], box.min[1], box.min[2]],
        [box.max[0], box.min[1], box.max[2]],
        [box.min[0], box.min[1], box.max[2]],
      );
      legacyIndices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    }
  }

  const rawObstacles = Reflect.get(message, "obstacleBoxes");
  const obstacleBoxes = Array.isArray(rawObstacles)
    ? rawObstacles.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const min = finiteTuple(Reflect.get(value, "min"));
        const max = finiteTuple(Reflect.get(value, "max"));
        if (!min || !max) return [];
        return [{
          entityId: String(Reflect.get(value, "entityId") ?? ""),
          min,
          max,
        }];
      })
    : [];
  const rawProfile = Reflect.get(message, "navigationProfile");
  const profile = rawProfile && typeof rawProfile === "object"
    ? {
        agentRadius: boundedRuntimeNumber(
          Reflect.get(rawProfile, "agentRadius"),
          DEFAULT_NAVIGATION_PROFILE.agentRadius,
          0,
          2,
        ),
        agentHeight: boundedRuntimeNumber(
          Reflect.get(rawProfile, "agentHeight"),
          DEFAULT_NAVIGATION_PROFILE.agentHeight,
          0.5,
          4,
        ),
        eyeHeight: boundedRuntimeNumber(
          Reflect.get(rawProfile, "eyeHeight"),
          DEFAULT_NAVIGATION_PROFILE.eyeHeight,
          0.3,
          3,
        ),
        maxStepMetres: boundedRuntimeNumber(
          Reflect.get(rawProfile, "maxStepMetres"),
          DEFAULT_NAVIGATION_PROFILE.maxStepMetres,
          0.01,
          0.5,
        ),
      }
    : { ...DEFAULT_NAVIGATION_PROFILE };
  return {
    navigationMesh: {
      vertices: validAuthoredMesh ? vertices : legacyVertices,
      indices: validAuthoredMesh ? indices : legacyIndices,
    },
    obstacleBoxes,
    profile,
  };
}

export function transformSourcePoint(
  point: Vector3Tuple,
  transform: SourceToWorldTransform,
): Vector3Tuple {
  const normalized = normalizeUpAxis(point, transform.sourceUpAxis);
  const scaled: Vector3Tuple = [
    normalized[0] * transform.metresPerSourceUnit,
    normalized[1] * transform.metresPerSourceUnit,
    normalized[2] * transform.metresPerSourceUnit,
  ];
  const rotated = rotateAroundWorldUp(scaled, transform.yawDegrees);
  return [
    rotated[0] + transform.translationMetres[0],
    rotated[1] + transform.translationMetres[1],
    rotated[2] + transform.translationMetres[2],
  ];
}

export function transformSourceDirection(
  direction: Vector3Tuple,
  transform: SourceToWorldTransform,
): Vector3Tuple {
  const normalized = normalizeUpAxis(direction, transform.sourceUpAxis);
  const rotated = rotateAroundWorldUp(normalized, transform.yawDegrees);
  const length = Math.hypot(...rotated);
  if (length <= Number.EPSILON) return [0, 0, 0];
  return [
    cleanZero(rotated[0] / length),
    cleanZero(rotated[1] / length),
    cleanZero(rotated[2] / length),
  ];
}

export function isNavigationPointAllowed(
  cameraPosition: Vector3Tuple,
  runtime: NavigationRuntime,
): boolean {
  const { agentRadius } = runtime.profile;
  const footprintSamples: Array<[number, number]> = [[0, 0]];
  if (agentRadius > 0) {
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      footprintSamples.push([
        Math.cos(angle) * agentRadius,
        Math.sin(angle) * agentRadius,
      ]);
    }
  }

  const onNavigationMesh = footprintSamples.every(([offsetX, offsetZ]) =>
    isPointInsideNavigationMesh(
      cameraPosition[0] + offsetX,
      cameraPosition[2] + offsetZ,
      runtime.navigationMesh,
    )
  );
  if (!onNavigationMesh) return false;

  return !runtime.obstacleBoxes.some((obstacle) =>
    intersectsObstacle(cameraPosition, obstacle, runtime.profile)
  );
}

export function isNavigationTransitionAllowed(
  from: Vector3Tuple,
  to: Vector3Tuple,
  runtime: NavigationRuntime,
): boolean {
  const distance = Math.hypot(
    to[0] - from[0],
    to[1] - from[1],
    to[2] - from[2],
  );
  const step = Math.max(0.01, runtime.profile.maxStepMetres);
  const sampleCount = Math.max(1, Math.ceil(distance / step));
  for (let index = 0; index <= sampleCount; index += 1) {
    const ratio = index / sampleCount;
    const sample: Vector3Tuple = [
      from[0] + (to[0] - from[0]) * ratio,
      from[1] + (to[1] - from[1]) * ratio,
      from[2] + (to[2] - from[2]) * ratio,
    ];
    if (!isNavigationPointAllowed(sample, runtime)) return false;
  }
  return true;
}

export function nearestNavigationPoint(
  cameraPosition: Vector3Tuple,
  runtime: NavigationRuntime,
): Vector3Tuple | null {
  if (isNavigationPointAllowed(cameraPosition, runtime)) return [...cameraPosition];
  let nearest: Vector3Tuple | null = null;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 2 < runtime.navigationMesh.indices.length; index += 3) {
    const first = runtime.navigationMesh.vertices[runtime.navigationMesh.indices[index]!];
    const second = runtime.navigationMesh.vertices[runtime.navigationMesh.indices[index + 1]!];
    const third = runtime.navigationMesh.vertices[runtime.navigationMesh.indices[index + 2]!];
    if (!first || !second || !third) continue;
    const closest = closestPointOnTriangle2d(
      cameraPosition[0],
      cameraPosition[2],
      first,
      second,
      third,
    );
    const centroid: [number, number] = [
      (first[0] + second[0] + third[0]) / 3,
      (first[2] + second[2] + third[2]) / 3,
    ];
    for (const inset of [0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1]) {
      const candidate: Vector3Tuple = [
        closest[0] + (centroid[0] - closest[0]) * inset,
        cameraPosition[1],
        closest[1] + (centroid[1] - closest[1]) * inset,
      ];
      if (!isNavigationPointAllowed(candidate, runtime)) continue;
      const distanceSquared =
        (candidate[0] - cameraPosition[0]) ** 2 +
        (candidate[2] - cameraPosition[2]) ** 2;
      if (distanceSquared < nearestDistanceSquared) {
        nearest = candidate;
        nearestDistanceSquared = distanceSquared;
      }
    }
  }
  return nearest;
}

function normalizeUpAxis(
  vector: Vector3Tuple,
  sourceUpAxis: SourceToWorldTransform["sourceUpAxis"],
): Vector3Tuple {
  return sourceUpAxis === "Z"
    ? [vector[0], vector[2], -vector[1]]
    : [...vector];
}

function finiteTuple(value: unknown): Vector3Tuple | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const coordinates = value.map(Number);
  if (coordinates.some((coordinate) => !Number.isFinite(coordinate))) return null;
  return [coordinates[0]!, coordinates[1]!, coordinates[2]!];
}

function boundedRuntimeNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}

function rotateAroundWorldUp(
  vector: Vector3Tuple,
  yawDegrees: number,
): Vector3Tuple {
  if (yawDegrees === 0) return [...vector];
  const radians = yawDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    cosine * vector[0] + sine * vector[2],
    vector[1],
    -sine * vector[0] + cosine * vector[2],
  ];
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function isPointInsideNavigationMesh(
  x: number,
  z: number,
  mesh: NavigationMesh,
): boolean {
  for (let index = 0; index + 2 < mesh.indices.length; index += 3) {
    const first = mesh.vertices[mesh.indices[index]!];
    const second = mesh.vertices[mesh.indices[index + 1]!];
    const third = mesh.vertices[mesh.indices[index + 2]!];
    if (!first || !second || !third) continue;
    if (pointInTriangle2d(x, z, first, second, third)) return true;
  }
  return false;
}

function pointInTriangle2d(
  x: number,
  z: number,
  first: Vector3Tuple,
  second: Vector3Tuple,
  third: Vector3Tuple,
): boolean {
  const denominator =
    (second[2] - third[2]) * (first[0] - third[0]) +
    (third[0] - second[0]) * (first[2] - third[2]);
  if (Math.abs(denominator) <= Number.EPSILON) return false;

  const firstWeight = (
    (second[2] - third[2]) * (x - third[0]) +
    (third[0] - second[0]) * (z - third[2])
  ) / denominator;
  const secondWeight = (
    (third[2] - first[2]) * (x - third[0]) +
    (first[0] - third[0]) * (z - third[2])
  ) / denominator;
  const thirdWeight = 1 - firstWeight - secondWeight;
  const epsilon = 1e-8;
  return firstWeight >= -epsilon && secondWeight >= -epsilon && thirdWeight >= -epsilon;
}

function closestPointOnTriangle2d(
  x: number,
  z: number,
  first: Vector3Tuple,
  second: Vector3Tuple,
  third: Vector3Tuple,
): [number, number] {
  if (pointInTriangle2d(x, z, first, second, third)) return [x, z];
  const candidates = [
    closestPointOnSegment2d(x, z, first[0], first[2], second[0], second[2]),
    closestPointOnSegment2d(x, z, second[0], second[2], third[0], third[2]),
    closestPointOnSegment2d(x, z, third[0], third[2], first[0], first[2]),
  ];
  candidates.sort((left, right) =>
    (left[0] - x) ** 2 + (left[1] - z) ** 2 -
    ((right[0] - x) ** 2 + (right[1] - z) ** 2)
  );
  return candidates[0]!;
}

function closestPointOnSegment2d(
  x: number,
  z: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): [number, number] {
  const deltaX = endX - startX;
  const deltaZ = endZ - startZ;
  const lengthSquared = deltaX ** 2 + deltaZ ** 2;
  if (lengthSquared <= Number.EPSILON) return [startX, startZ];
  const ratio = Math.max(
    0,
    Math.min(1, ((x - startX) * deltaX + (z - startZ) * deltaZ) / lengthSquared),
  );
  return [startX + deltaX * ratio, startZ + deltaZ * ratio];
}

function intersectsObstacle(
  cameraPosition: Vector3Tuple,
  obstacle: NavigationObstacleBox,
  profile: NavigationProfile,
): boolean {
  const feetY = cameraPosition[1] - profile.eyeHeight;
  const headY = feetY + profile.agentHeight;
  const overlapsVertically = headY >= obstacle.min[1] && feetY <= obstacle.max[1];
  if (!overlapsVertically) return false;
  return (
    cameraPosition[0] >= obstacle.min[0] - profile.agentRadius &&
    cameraPosition[0] <= obstacle.max[0] + profile.agentRadius &&
    cameraPosition[2] >= obstacle.min[2] - profile.agentRadius &&
    cameraPosition[2] <= obstacle.max[2] + profile.agentRadius
  );
}
