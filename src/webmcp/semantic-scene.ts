export type Vector3Tuple = [number, number, number];

export type CameraPose = {
  position: Vector3Tuple;
  target: Vector3Tuple;
  up: Vector3Tuple;
  fovDegrees: number;
};

export type PublishedSpatialEntity = {
  id: string;
  parent_id: string | null;
  kind: "floor" | "room" | "doorway" | "poi";
  label: string;
  description: string | null;
  position_json: string | null;
  geometry_json: string | null;
  metadata_json: string;
  sort_order: number;
};

export type PublishedManifest = {
  release: {
    id: string;
    slug: string;
    number: number;
    publishedAt: string;
  };
  project: {
    id: string;
    versionId: string;
    name: string;
    captureAdapter: string;
  };
  scene: {
    contentUrl: string;
    format: string;
    collisionUrl?: string | null;
    detourUrl?: string | null;
    navMeshUrl?: string | null;
  };
  viewer: {
    title: string;
    subtitle?: string;
    measurementDisclaimer: string;
    splatBudgetMillions?: number | null;
    defaultMovementMode?: "walk" | "fly";
    sceneRotationDegrees?: Vector3Tuple;
    sourceToWorld?: Record<string, unknown>;
    initialCamera?: Partial<CameraPose> & {
      position: Vector3Tuple;
      target: Vector3Tuple;
    };
  };
  deliveryPolicy?: {
    adaptive_quality: number;
    mobile_lite_budget: number;
    mobile_standard_budget: number;
    desktop_standard_budget: number;
    desktop_high_budget: number;
    max_initial_bytes: number;
  };
  spatial?: {
    entities: PublishedSpatialEntity[];
    routes: Array<{
      id: string;
      label: string;
      description: string | null;
      accessibility: string;
      estimated_seconds: number | null;
    }>;
    routeStops: Array<{
      route_id: string;
      entity_id: string;
      sequence_number: number;
      camera_pose_json: string | null;
      narration: string | null;
    }>;
    collisionProxy: {
      version: string;
      boxes: Array<{
        entityId: string;
        label: string;
        min: Vector3Tuple;
        max: Vector3Tuple;
      }>;
    };
    navigationMesh: {
      version: string;
      vertices: Vector3Tuple[];
      indices: number[];
      sourceEntityIds: string[];
    };
    obstacleProxy?: {
      version: string;
      boxes: Array<{
        entityId: string;
        label: string;
        min: Vector3Tuple;
        max: Vector3Tuple;
      }>;
    };
    navigationProfile: {
      worldUnit?: "metres" | "scene_units";
      agentRadius: number;
      agentHeight: number;
      eyeHeight: number;
      maxStepMetres: number;
    };
    navigationArtifact?: Record<string, unknown> | null;
  };
};

export type SemanticEntityKind =
  | "site"
  | "floor"
  | "room"
  | "zone"
  | "object"
  | "surface"
  | "portal"
  | "poi";

export type SemanticReviewStatus = "reviewed" | "provisional" | "inferred";

export type SemanticQuality = {
  visualCoverage: number;
  semanticConfidence: number;
  geometryConfidence: number;
  freshnessConfidence: number;
  reviewStatus: SemanticReviewStatus;
  gaps: string[];
  evidence: string[];
};

export type SemanticRelationship = {
  predicate:
    | "inside"
    | "contains"
    | "adjacent_to"
    | "connected_to"
    | "near"
    | "above"
    | "below"
    | "beside"
    | "blocks"
    | "visible_from";
  targetId: string;
  confidence: number;
};

export type SemanticEntity = {
  id: string;
  label: string;
  kind: SemanticEntityKind;
  description: string;
  aliases: string[];
  parentId: string | null;
  position: Vector3Tuple | null;
  bounds: { min: Vector3Tuple; max: Vector3Tuple } | null;
  bestView: CameraPose | null;
  relationships: SemanticRelationship[];
  affordances: string[];
  quality: SemanticQuality;
  provenance: string[];
  source: "published_manifest" | "reviewed_sidecar";
};

export type SemanticSceneIndex = {
  sceneId: string;
  title: string;
  versionId: string;
  worldUnit: "metres" | "scene_units" | "unknown";
  measurementDisclaimer: string;
  entities: SemanticEntity[];
  entityById: Map<string, SemanticEntity>;
};

export type SemanticSearchOptions = {
  kinds?: SemanticEntityKind[];
  limit?: number;
  minimumConfidence?: number;
};

export type SemanticSearchResult = {
  entity: SemanticEntity;
  score: number;
  reasons: string[];
};

export type SceneContext = {
  sceneId: string;
  title: string;
  cameraPose: CameraPose | null;
  currentRegion: SemanticEntity | null;
  selectedEntity: SemanticEntity | null;
  nearbyEntities: Array<{ entity: SemanticEntity; distance: number }>;
  worldUnit: SemanticSceneIndex["worldUnit"];
  measurementDisclaimer: string;
};

type SidecarEntity = Omit<SemanticEntity, "source">;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function isFiniteVector(value: unknown): value is Vector3Tuple {
  return Array.isArray(value) && value.length === 3 && value.every((item) =>
    typeof item === "number" && Number.isFinite(item)
  );
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseJsonValue(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function vectorFromValue(value: unknown): Vector3Tuple | null {
  if (isFiniteVector(value)) return [...value] as Vector3Tuple;
  const record = safeRecord(value);
  if (!record) return null;
  for (const key of ["position", "centroid", "point", "anchor"]) {
    if (isFiniteVector(record[key])) return [...record[key]] as Vector3Tuple;
  }
  const { x, y, z } = record;
  if ([x, y, z].every((coordinate) =>
    typeof coordinate === "number" && Number.isFinite(coordinate)
  )) {
    return [x as number, y as number, z as number];
  }
  return null;
}

function cameraPoseFromRecord(record: Record<string, unknown> | null): CameraPose | null {
  if (!record) return null;
  const candidate = safeRecord(record.cameraPose) ?? safeRecord(record.bestView) ?? record;
  const position = isFiniteVector(candidate.position) ? candidate.position : null;
  const target = isFiniteVector(candidate.target) ? candidate.target : null;
  if (!position || !target) return null;
  return {
    position: [...position] as Vector3Tuple,
    target: [...target] as Vector3Tuple,
    up: isFiniteVector(candidate.up) ? [...candidate.up] as Vector3Tuple : [0, 1, 0],
    fovDegrees: typeof candidate.fovDegrees === "number"
      ? Math.max(20, Math.min(100, candidate.fovDegrees))
      : 58,
  };
}

function boundsFromValue(value: unknown): SemanticEntity["bounds"] {
  const record = safeRecord(value);
  if (!record) return null;
  const direct = safeRecord(record.bounds);
  if (direct && isFiniteVector(direct.min) && isFiniteVector(direct.max)) {
    return {
      min: [...direct.min] as Vector3Tuple,
      max: [...direct.max] as Vector3Tuple,
    };
  }

  const rawPoints = Array.isArray(record.points)
    ? record.points
    : Array.isArray(record.polygon)
    ? record.polygon
    : [];
  const points = rawPoints.filter(isFiniteVector);
  if (!points.length) return null;

  const min: Vector3Tuple = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: Vector3Tuple = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, point[axis]!);
      max[axis] = Math.max(max[axis]!, point[axis]!);
    }
  }
  return { min, max };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function numberFrom(record: Record<string, unknown> | null, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return clamp01(value);
  }
  return fallback;
}

function mapKind(kind: PublishedSpatialEntity["kind"]): SemanticEntityKind {
  switch (kind) {
    case "doorway":
      return "portal";
    case "poi":
      return "poi";
    default:
      return kind;
  }
}

function inferBestView(position: Vector3Tuple | null, eyeHeight = 1.6): CameraPose | null {
  if (!position) return null;
  return {
    position: [position[0], Math.max(position[1] + eyeHeight, eyeHeight), position[2] + 2.2],
    target: [position[0], position[1] + 0.8, position[2]],
    up: [0, 1, 0],
    fovDegrees: 58,
  };
}

function manifestEntityToSemantic(
  entity: PublishedSpatialEntity,
  manifest: PublishedManifest,
): SemanticEntity {
  const positionValue = parseJsonValue(entity.position_json);
  const geometryValue = parseJsonValue(entity.geometry_json);
  const metadata = safeRecord(parseJsonValue(entity.metadata_json));
  const position = vectorFromValue(positionValue) ?? vectorFromValue(geometryValue) ?? vectorFromValue(metadata);
  const bestView = cameraPoseFromRecord(metadata) ?? cameraPoseFromRecord(safeRecord(positionValue)) ?? inferBestView(position);
  const semanticConfidence = numberFrom(metadata, ["semanticConfidence", "confidence"], 0.9);
  const visualCoverage = numberFrom(metadata, ["visualCoverage", "coverage"], 0.86);
  const geometryConfidence = manifest.spatial?.navigationProfile.worldUnit === "metres" ? 0.92 : 0.68;
  const reviewStatus = metadata?.reviewStatus === "provisional" || metadata?.reviewStatus === "inferred"
    ? metadata.reviewStatus
    : "reviewed";
  const aliases = stringArray(metadata?.aliases);
  const affordances = stringArray(metadata?.affordances);
  const gaps = stringArray(metadata?.captureGaps);
  const evidence = stringArray(metadata?.evidence);
  const kind = mapKind(entity.kind);

  return {
    id: entity.id,
    label: entity.label,
    kind,
    description: entity.description ?? `${entity.label}, published as a ${kind} in this scene.`,
    aliases,
    parentId: entity.parent_id,
    position,
    bounds: boundsFromValue(geometryValue),
    bestView,
    relationships: entity.parent_id
      ? [{ predicate: "inside", targetId: entity.parent_id, confidence: 1 }]
      : [],
    affordances,
    quality: {
      visualCoverage,
      semanticConfidence,
      geometryConfidence,
      freshnessConfidence: 0.9,
      reviewStatus,
      gaps,
      evidence: evidence.length ? evidence : ["published spatial manifest"],
    },
    provenance: [
      `release:${manifest.release.slug}:${manifest.release.number}`,
      `version:${manifest.project.versionId}`,
      `capture-adapter:${manifest.project.captureAdapter}`,
    ],
    source: "published_manifest",
  };
}

const homeScanSidecar: SidecarEntity[] = [
  {
    id: "home-scan-object-central-sofa",
    label: "central sofa",
    kind: "object",
    description: "A large sofa in the central connected living area. Its semantic anchor is operator-reviewed but its dimensions remain provisional scene units.",
    aliases: ["sofa", "couch", "main sofa"],
    parentId: "main-room",
    position: [2.9, 0.65, -8.55],
    bounds: { min: [1.2, 0.1, -9.6], max: [4.6, 1.5, -7.45] },
    bestView: {
      position: [0.45, 1.7, -7.2],
      target: [2.9, 0.8, -8.55],
      up: [0, 1, 0],
      fovDegrees: 56,
    },
    relationships: [
      { predicate: "inside", targetId: "main-room", confidence: 0.82 },
      { predicate: "near", targetId: "home-scan-object-dining-table", confidence: 0.68 },
    ],
    affordances: ["sittable", "potentially_movable", "can_be_isolated"],
    quality: {
      visualCoverage: 0.78,
      semanticConfidence: 0.82,
      geometryConfidence: 0.62,
      freshnessConfidence: 0.9,
      reviewStatus: "provisional",
      gaps: ["rear surface is weakly observed", "dimensions are not survey measurements"],
      evidence: ["operator-reviewed near-sofa viewpoints", "authored structural sidecar"],
    },
    provenance: ["home-scan structural v7", "operator-reviewed challenge sidecar"],
  },
  {
    id: "home-scan-object-dining-table",
    label: "dining table",
    kind: "object",
    description: "The dining table beside the reviewed west-side walking aisle.",
    aliases: ["table", "dining room table"],
    parentId: "main-room",
    position: [2.35, 0.75, -5.55],
    bounds: { min: [1.3, 0.1, -6.4], max: [3.5, 1.2, -4.7] },
    bestView: {
      position: [0.25, 1.7, -4.4],
      target: [2.35, 0.75, -5.55],
      up: [0, 1, 0],
      fovDegrees: 58,
    },
    relationships: [
      { predicate: "inside", targetId: "main-room", confidence: 0.8 },
      { predicate: "near", targetId: "home-scan-object-central-sofa", confidence: 0.68 },
    ],
    affordances: ["supports_objects", "potentially_movable", "can_be_isolated"],
    quality: {
      visualCoverage: 0.72,
      semanticConfidence: 0.76,
      geometryConfidence: 0.6,
      freshnessConfidence: 0.9,
      reviewStatus: "provisional",
      gaps: ["underside is not fully observed", "object boundary needs instance-mask review"],
      evidence: ["reviewed walking-route description", "multi-view visual inspection"],
    },
    provenance: ["home-scan navigation v6", "operator-reviewed challenge sidecar"],
  },
  {
    id: "home-scan-zone-kitchen",
    label: "kitchen area",
    kind: "zone",
    description: "A reviewed connected floor region on the east side of the Home Scan scene.",
    aliases: ["kitchen", "cooking area"],
    parentId: "main-room",
    position: [7.0, 0.2, -6.25],
    bounds: { min: [5.0, 0.0, -8.3], max: [9.1, 3.0, -4.3] },
    bestView: {
      position: [6.1, 1.65, -4.55],
      target: [7.0, 1.0, -6.25],
      up: [0, 1, 0],
      fovDegrees: 62,
    },
    relationships: [
      { predicate: "inside", targetId: "main-room", confidence: 0.88 },
      { predicate: "connected_to", targetId: "main-room", confidence: 0.95 },
    ],
    affordances: ["walkable", "searchable", "can_be_compared"],
    quality: {
      visualCoverage: 0.84,
      semanticConfidence: 0.74,
      geometryConfidence: 0.68,
      freshnessConfidence: 0.9,
      reviewStatus: "provisional",
      gaps: ["room function is inferred from visual context"],
      evidence: ["reviewed floor-kitchen geometry", "published visual scene"],
    },
    provenance: ["home-scan structural v7", "operator-reviewed challenge sidecar"],
  },
];

function appliesHomeScanSidecar(manifest: PublishedManifest): boolean {
  const haystack = `${manifest.release.slug} ${manifest.viewer.title} ${manifest.project.name}`.toLowerCase();
  return haystack.includes("home-scan") || haystack.includes("home scan");
}

function mergeSidecar(entities: SemanticEntity[], sidecar: SidecarEntity[]): SemanticEntity[] {
  const merged = new Map(entities.map((entity) => [entity.id, entity]));
  for (const entity of sidecar) {
    merged.set(entity.id, { ...entity, source: "reviewed_sidecar" });
  }
  return [...merged.values()];
}

function addReverseRelationships(entities: SemanticEntity[]): SemanticEntity[] {
  const cloned = entities.map((entity) => ({
    ...entity,
    relationships: [...entity.relationships],
  }));
  const byId = new Map(cloned.map((entity) => [entity.id, entity]));
  for (const entity of cloned) {
    if (entity.parentId && byId.has(entity.parentId)) {
      const parent = byId.get(entity.parentId)!;
      if (!parent.relationships.some((relation) =>
        relation.predicate === "contains" && relation.targetId === entity.id
      )) {
        parent.relationships.push({ predicate: "contains", targetId: entity.id, confidence: 1 });
      }
    }
  }
  return cloned;
}

export function buildSemanticSceneIndex(manifest: PublishedManifest): SemanticSceneIndex {
  const published = (manifest.spatial?.entities ?? []).map((entity) =>
    manifestEntityToSemantic(entity, manifest)
  );
  const enriched = appliesHomeScanSidecar(manifest)
    ? mergeSidecar(published, homeScanSidecar)
    : published;
  const entities = addReverseRelationships(enriched);
  return {
    sceneId: manifest.release.slug,
    title: manifest.viewer.title,
    versionId: manifest.project.versionId,
    worldUnit: manifest.viewer.sourceToWorld
      ? (manifest.spatial?.navigationProfile.worldUnit ?? "metres")
      : (manifest.spatial?.navigationProfile.worldUnit ?? "unknown"),
    measurementDisclaimer: manifest.viewer.measurementDisclaimer,
    entities,
    entityById: new Map(entities.map((entity) => [entity.id, entity])),
  };
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function entitySearchText(entity: SemanticEntity): string {
  return normalize([
    entity.id,
    entity.label,
    entity.kind,
    entity.description,
    ...entity.aliases,
    ...entity.affordances,
  ].join(" "));
}

export function searchSemanticEntities(
  index: SemanticSceneIndex,
  query: string,
  options: SemanticSearchOptions = {},
): SemanticSearchResult[] {
  const normalizedQuery = normalize(query);
  const tokens = tokenize(query);
  const kinds = options.kinds?.length ? new Set(options.kinds) : null;
  const minimumConfidence = clamp01(options.minimumConfidence ?? 0);
  const limit = Math.max(1, Math.min(20, Math.trunc(options.limit ?? 8)));

  const results: SemanticSearchResult[] = [];
  for (const entity of index.entities) {
    if (kinds && !kinds.has(entity.kind)) continue;
    if (entity.quality.semanticConfidence < minimumConfidence) continue;
    const text = entitySearchText(entity);
    const normalizedLabel = normalize(entity.label);
    const normalizedId = normalize(entity.id);
    const normalizedAliases = entity.aliases.map(normalize);
    const reasons: string[] = [];
    let score = 0;

    if (!normalizedQuery) {
      score = 0.2 + entity.quality.semanticConfidence * 0.5;
      reasons.push("listed by confidence");
    } else {
      if (normalizedLabel === normalizedQuery) {
        score += 6;
        reasons.push("exact label");
      }
      if (normalizedId === normalizedQuery) {
        score += 5.5;
        reasons.push("exact id");
      }
      if (normalizedAliases.includes(normalizedQuery)) {
        score += 5;
        reasons.push("exact alias");
      }
      if (normalizedLabel.startsWith(normalizedQuery)) {
        score += 2.5;
        reasons.push("label prefix");
      }
      const matchedTokens = tokens.filter((token) => text.includes(token));
      if (matchedTokens.length) {
        score += matchedTokens.length * 1.2;
        reasons.push(`matched ${matchedTokens.length}/${tokens.length || 1} query terms`);
      }
      if (tokens.length && matchedTokens.length !== tokens.length) continue;
      if (!tokens.length || !text.includes(normalizedQuery)) {
        if (score <= 0) continue;
      } else {
        score += 1;
      }
      score += entity.quality.semanticConfidence * 0.6;
      if (entity.quality.reviewStatus === "reviewed") score += 0.35;
    }

    results.push({ entity, score, reasons });
  }

  return results
    .sort((left, right) => right.score - left.score || left.entity.label.localeCompare(right.entity.label))
    .slice(0, limit);
}

function distance(a: Vector3Tuple, b: Vector3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function contains(bounds: NonNullable<SemanticEntity["bounds"]>, point: Vector3Tuple): boolean {
  const verticalPadding = 0.5;
  return point[0] >= bounds.min[0] && point[0] <= bounds.max[0] &&
    point[1] >= bounds.min[1] - verticalPadding && point[1] <= bounds.max[1] + verticalPadding &&
    point[2] >= bounds.min[2] && point[2] <= bounds.max[2];
}

export function sceneContext(
  index: SemanticSceneIndex,
  cameraPose: CameraPose | null,
  selectedEntityId: string | null,
): SceneContext {
  const selectedEntity = selectedEntityId ? index.entityById.get(selectedEntityId) ?? null : null;
  if (!cameraPose) {
    return {
      sceneId: index.sceneId,
      title: index.title,
      cameraPose: null,
      currentRegion: null,
      selectedEntity,
      nearbyEntities: [],
      worldUnit: index.worldUnit,
      measurementDisclaimer: index.measurementDisclaimer,
    };
  }

  const position = cameraPose.position;
  const regions = index.entities.filter((entity) => entity.kind === "room" || entity.kind === "zone");
  const containingRegions = regions.filter((entity) => entity.bounds && contains(entity.bounds, position));
  const currentRegion = containingRegions.sort((left, right) =>
    right.quality.semanticConfidence - left.quality.semanticConfidence
  )[0] ?? regions
    .filter((entity) => entity.position)
    .sort((left, right) => distance(left.position!, position) - distance(right.position!, position))[0] ?? null;

  const nearbyEntities = index.entities
    .filter((entity) => entity.position)
    .map((entity) => ({ entity, distance: distance(entity.position!, position) }))
    .filter(({ distance: value }) => value <= 12)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 8);

  return {
    sceneId: index.sceneId,
    title: index.title,
    cameraPose,
    currentRegion,
    selectedEntity,
    nearbyEntities,
    worldUnit: index.worldUnit,
    measurementDisclaimer: index.measurementDisclaimer,
  };
}

export function semanticEntitySummary(entity: SemanticEntity): Record<string, unknown> {
  return {
    id: entity.id,
    label: entity.label,
    kind: entity.kind,
    description: entity.description,
    aliases: entity.aliases,
    parentId: entity.parentId,
    position: entity.position,
    affordances: entity.affordances,
    quality: {
      visualCoverage: Number(entity.quality.visualCoverage.toFixed(2)),
      semanticConfidence: Number(entity.quality.semanticConfidence.toFixed(2)),
      geometryConfidence: Number(entity.quality.geometryConfidence.toFixed(2)),
      freshnessConfidence: Number(entity.quality.freshnessConfidence.toFixed(2)),
      reviewStatus: entity.quality.reviewStatus,
      gaps: entity.quality.gaps,
    },
    provenance: entity.provenance,
    bestViewAvailable: Boolean(entity.bestView),
  };
}
