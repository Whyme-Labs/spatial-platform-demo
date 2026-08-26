import {
  sceneContext,
  searchSemanticEntities,
  semanticEntitySummary,
  type CameraPose,
  type SemanticEntity,
  type SemanticEntityKind,
  type SemanticSceneIndex,
} from "./semantic-scene";

type JsonSchema = Record<string, unknown>;

type WebMcpTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
  execute: (input: Record<string, unknown>) => string | Promise<string>;
};

type WebMcpModelContext = EventTarget & {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ) => Promise<void>;
  getTools?: () => Promise<Array<{ name: string }>>;
};

declare global {
  interface Document {
    modelContext?: WebMcpModelContext;
  }
}

export type WebMcpActivity = {
  tool: string;
  phase: "started" | "succeeded" | "failed";
  detail: string;
  at: string;
};

export type SpatialToolRuntime = {
  getIndex: () => SemanticSceneIndex | null;
  getCameraPose: () => CameraPose | null;
  getSelectedEntityId: () => string | null;
  selectEntity: (entityId: string) => void;
  navigateToEntity: (entityId: string) => Promise<CameraPose>;
  renderSearchResults: (query: string, entityIds: string[]) => void;
  reportActivity: (activity: WebMcpActivity) => void;
};

export type RegisteredSpatialTools = {
  supported: boolean;
  names: string[];
  dispose: () => void;
};

const TOOL_OUTPUT_LIMIT = 1_450;
const SEMANTIC_KINDS: SemanticEntityKind[] = [
  "site",
  "floor",
  "room",
  "zone",
  "object",
  "surface",
  "portal",
  "poi",
];

function requireIndex(runtime: SpatialToolRuntime): SemanticSceneIndex {
  const index = runtime.getIndex();
  if (!index) throw new Error("The semantic scene is still loading.");
  return index;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalKinds(input: Record<string, unknown>): SemanticEntityKind[] | undefined {
  const value = input.kinds;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("kinds must be an array when supplied.");
  const kinds = value.filter((item): item is SemanticEntityKind =>
    typeof item === "string" && SEMANTIC_KINDS.includes(item as SemanticEntityKind)
  );
  if (kinds.length !== value.length) throw new Error("kinds contains an unsupported entity kind.");
  return kinds.length ? kinds : undefined;
}

function optionalLimit(input: Record<string, unknown>, fallback: number): number {
  const value = input.limit;
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("limit must be a finite number.");
  }
  return Math.max(1, Math.min(10, Math.trunc(value)));
}

function entityOrThrow(index: SemanticSceneIndex, entityId: string): SemanticEntity {
  const entity = index.entityById.get(entityId);
  if (!entity) {
    throw new Error(`No semantic entity has id "${entityId}". Use search_scene_entities first.`);
  }
  return entity;
}

function compactEntity(entity: SemanticEntity): Record<string, unknown> {
  return {
    id: entity.id,
    label: entity.label,
    kind: entity.kind,
    parentId: entity.parentId,
    semanticConfidence: round(entity.quality.semanticConfidence),
    reviewStatus: entity.quality.reviewStatus,
    bestViewAvailable: Boolean(entity.bestView),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function jsonOutput(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded.length <= TOOL_OUTPUT_LIMIT) return encoded;
  return JSON.stringify({
    truncated: true,
    message: "The tool result exceeded the page output limit. Narrow the query or request one entity.",
    preview: encoded.slice(0, 1_050),
  });
}

function qualityVerdict(entity: SemanticEntity): string {
  const quality = entity.quality;
  const minimum = Math.min(
    quality.visualCoverage,
    quality.semanticConfidence,
    quality.geometryConfidence,
    quality.freshnessConfidence,
  );
  if (minimum >= 0.85 && quality.gaps.length === 0) return "strong evidence for exploration";
  if (minimum >= 0.65) return "usable with disclosed limitations";
  return "insufficient for a confident operational conclusion";
}

function recommendedCaptureAction(entity: SemanticEntity): string {
  if (!entity.quality.gaps.length) {
    return "No blocking capture gap is recorded. Inspect source evidence before a high-consequence decision.";
  }
  return `Recapture or review this entity before relying on: ${entity.quality.gaps[0]}`;
}

function activity(
  runtime: SpatialToolRuntime,
  tool: string,
  phase: WebMcpActivity["phase"],
  detail: string,
): void {
  runtime.reportActivity({ tool, phase, detail, at: new Date().toISOString() });
}

function wrapTool(
  runtime: SpatialToolRuntime,
  definition: Omit<WebMcpTool, "execute"> & {
    execute: (input: Record<string, unknown>) => string | Promise<string>;
  },
): WebMcpTool {
  return {
    ...definition,
    execute: async (input) => {
      activity(runtime, definition.name, "started", "Tool invoked by the page agent.");
      try {
        const result = await definition.execute(input ?? {});
        activity(runtime, definition.name, "succeeded", "The shared scene state was updated.");
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown tool failure.";
        activity(runtime, definition.name, "failed", message);
        throw error;
      }
    },
  };
}

function spatialTools(runtime: SpatialToolRuntime): WebMcpTool[] {
  return [
    wrapTool(runtime, {
      name: "get_scene_context",
      description: "Read the live spatial page context: camera, current region, selected entity, nearby entities, units, and measurement warning.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => {
        const index = requireIndex(runtime);
        const context = sceneContext(index, runtime.getCameraPose(), runtime.getSelectedEntityId());
        return jsonOutput({
          sceneId: context.sceneId,
          title: context.title,
          cameraPose: context.cameraPose,
          currentRegion: context.currentRegion ? compactEntity(context.currentRegion) : null,
          selectedEntity: context.selectedEntity ? compactEntity(context.selectedEntity) : null,
          nearbyEntities: context.nearbyEntities.slice(0, 6).map(({ entity, distance }) => ({
            ...compactEntity(entity),
            distance: round(distance),
            distanceUnit: context.worldUnit,
          })),
          worldUnit: context.worldUnit,
          measurementDisclaimer: context.measurementDisclaimer,
        });
      },
    }),
    wrapTool(runtime, {
      name: "search_scene_entities",
      description: "Search persistent rooms, zones, objects, surfaces, portals, and points of interest in the loaded 3D scene. Use before requesting an entity id.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            minLength: 1,
            maxLength: 120,
            description: "Object, room, zone, alias, or capability to find, such as sofa, kitchen, or walkable.",
          },
          kinds: {
            type: "array",
            maxItems: 8,
            items: { type: "string", enum: SEMANTIC_KINDS },
            description: "Optional entity kinds to include.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Maximum number of matches. Defaults to 6.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        const index = requireIndex(runtime);
        const query = requiredString(input, "query");
        const kinds = optionalKinds(input);
        const results = searchSemanticEntities(index, query, {
          limit: optionalLimit(input, 6),
          ...(kinds ? { kinds } : {}),
        });
        runtime.renderSearchResults(query, results.map((result) => result.entity.id));
        return jsonOutput({
          query,
          count: results.length,
          notFound: results.length === 0,
          results: results.map((result) => ({
            ...compactEntity(result.entity),
            score: round(result.score),
            reasons: result.reasons,
          })),
          next: results.length
            ? "Call get_scene_entity or navigate_to_entity with a returned id."
            : "Try a broader category or inspect uncertain entities in the page.",
        });
      },
    }),
    wrapTool(runtime, {
      name: "get_scene_entity",
      description: "Get one semantic scene entity, including its stable identity, relationships, affordances, confidence, provenance, and best-view availability.",
      inputSchema: {
        type: "object",
        properties: {
          entityId: {
            type: "string",
            minLength: 1,
            maxLength: 160,
            description: "Stable entity id returned by search_scene_entities.",
          },
        },
        required: ["entityId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        const index = requireIndex(runtime);
        const entity = entityOrThrow(index, requiredString(input, "entityId"));
        runtime.selectEntity(entity.id);
        return jsonOutput({
          ...semanticEntitySummary(entity),
          relationships: entity.relationships.slice(0, 10).map((relation) => ({
            predicate: relation.predicate,
            targetId: relation.targetId,
            targetLabel: index.entityById.get(relation.targetId)?.label ?? null,
            confidence: round(relation.confidence),
          })),
          evidence: entity.quality.evidence.slice(0, 6),
          source: entity.source,
        });
      },
    }),
    wrapTool(runtime, {
      name: "get_entity_quality",
      description: "Assess whether one scene entity has enough visual, semantic, geometric, and freshness evidence for exploration. Returns disclosed gaps, not a safety certification.",
      inputSchema: {
        type: "object",
        properties: {
          entityId: {
            type: "string",
            minLength: 1,
            maxLength: 160,
            description: "Stable entity id returned by search_scene_entities.",
          },
        },
        required: ["entityId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        const index = requireIndex(runtime);
        const entity = entityOrThrow(index, requiredString(input, "entityId"));
        runtime.selectEntity(entity.id);
        return jsonOutput({
          entity: compactEntity(entity),
          verdict: qualityVerdict(entity),
          visualCoverage: round(entity.quality.visualCoverage),
          semanticConfidence: round(entity.quality.semanticConfidence),
          geometryConfidence: round(entity.quality.geometryConfidence),
          freshnessConfidence: round(entity.quality.freshnessConfidence),
          reviewStatus: entity.quality.reviewStatus,
          gaps: entity.quality.gaps,
          evidence: entity.quality.evidence.slice(0, 6),
          recommendedAction: recommendedCaptureAction(entity),
          measurementDisclaimer: index.measurementDisclaimer,
        });
      },
    }),
    wrapTool(runtime, {
      name: "navigate_to_entity",
      description: "Move the live 3D viewer to an entity's authored best view. The renderer accepts the move only when it is reachable within reviewed navigation and collision boundaries.",
      inputSchema: {
        type: "object",
        properties: {
          entityId: {
            type: "string",
            minLength: 1,
            maxLength: 160,
            description: "Stable entity id returned by search_scene_entities.",
          },
        },
        required: ["entityId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => {
        const index = requireIndex(runtime);
        const entity = entityOrThrow(index, requiredString(input, "entityId"));
        if (!entity.bestView) {
          throw new Error(`${entity.label} has no authored best view. Inspect its evidence instead.`);
        }
        runtime.selectEntity(entity.id);
        const acceptedPose = await runtime.navigateToEntity(entity.id);
        return jsonOutput({
          accepted: true,
          entity: compactEntity(entity),
          cameraPose: acceptedPose,
          boundaryAuthority: "reviewed renderer navigation and collision runtime",
          warning: index.measurementDisclaimer,
        });
      },
    }),
  ];
}

export async function registerSpatialBrowserTools(
  runtime: SpatialToolRuntime,
): Promise<RegisteredSpatialTools> {
  const modelContext = document.modelContext;
  if (!modelContext?.registerTool) {
    return { supported: false, names: [], dispose: () => undefined };
  }

  const controller = new AbortController();
  const tools = spatialTools(runtime);
  try {
    for (const tool of tools) {
      await modelContext.registerTool(tool, { signal: controller.signal });
    }
  } catch (error) {
    controller.abort();
    throw error;
  }

  return {
    supported: true,
    names: tools.map((tool) => tool.name),
    dispose: () => controller.abort(),
  };
}
