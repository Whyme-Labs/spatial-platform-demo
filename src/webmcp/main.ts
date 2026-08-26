import { resolveDeviceProfile, type DeviceProfile } from "../client/device-profile";
import {
  buildSemanticSceneIndex,
  sceneContext,
  searchSemanticEntities,
  type CameraPose,
  type PublishedManifest,
  type SemanticEntity,
  type SemanticSceneIndex,
  type Vector3Tuple,
} from "./semantic-scene";
import {
  registerSpatialBrowserTools,
  type RegisteredSpatialTools,
  type WebMcpActivity,
} from "./webmcp-api";

const DEFAULT_SCENE_SLUG = "home-scan-spark-multi-room-demo";
const CAMERA_REQUEST_TIMEOUT_MS = 4_000;
const TOOL_LOG_LIMIT = 12;

type RendererMessage =
  | {
      source: "spatial-spark";
      type: "progress";
      progress: number;
      detail: string;
    }
  | {
      source: "spatial-spark";
      type: "ready";
      runtime: string;
      version: string;
      timeToFirstFrameMs: number;
      format: string;
      splatBudget: number;
    }
  | {
      source: "spatial-spark";
      type: "error";
      code: string;
      message: string;
    }
  | {
      source: "spatial-spark";
      type: "camera";
      requestId: string;
      cameraPose: CameraPose;
    }
  | {
      source: "spatial-spark";
      type: "camera-update";
      cameraPose: CameraPose;
    }
  | {
      source: "spatial-spark";
      type: "camera-set";
      requestId: string;
      accepted: boolean;
      message?: string;
      cameraPose: CameraPose;
    }
  | {
      source: "spatial-spark";
      type: "heartbeat";
    }
  | {
      source: "spatial-spark";
      type: "movement-blocked";
      message: string;
      cause: { kind: string; id: string | null };
      position: Vector3Tuple;
    };

type PendingCameraRequest = {
  resolve: (pose: CameraPose) => void;
  reject: (error: Error) => void;
  timeout: number;
};

const byId = <T extends Element = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as unknown as T;
};

const rendererFrame = byId<HTMLIFrameElement>("rendererFrame");
const loadingOverlay = byId<HTMLElement>("viewerLoading");
const sceneStatus = byId<HTMLElement>("sceneStatus");
const webMcpStatus = byId<HTMLElement>("webMcpStatus");
const searchForm = byId<HTMLFormElement>("semanticSearchForm");
const searchInput = byId<HTMLInputElement>("semanticSearchInput");
const searchResultsRoot = byId<HTMLElement>("searchResults");
const entityPanel = byId<HTMLElement>("entityPanel");
const toolActivityRoot = byId<HTMLOListElement>("toolActivity");
const toast = byId<HTMLElement>("toast");

let activeManifest: PublishedManifest | null = null;
let semanticIndex: SemanticSceneIndex | null = null;
let latestCameraPose: CameraPose | null = null;
let selectedEntityId: string | null = null;
let rendererReady = false;
let registeredTools: RegisteredSpatialTools | null = null;
let toastTimer: number | null = null;
const cameraReadRequests = new Map<string, PendingCameraRequest>();
const cameraMoveRequests = new Map<string, PendingCameraRequest>();
const toolActivities: WebMcpActivity[] = [];

bindInterface();
window.addEventListener("message", handleRendererMessage);
rendererFrame.addEventListener("load", sendSpatialRuntime);
window.addEventListener("beforeunload", () => registeredTools?.dispose(), { once: true });
void loadScene();

function bindInterface(): void {
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runHumanSearch(searchInput.value);
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-semantic-query]")) {
    button.addEventListener("click", () => {
      const query = button.dataset.semanticQuery?.trim() ?? "";
      if (!query) return;
      searchInput.value = query;
      runHumanSearch(query);
    });
  }

  byId<HTMLButtonElement>("reloadScene").addEventListener("click", () => {
    void loadScene();
  });
}

async function loadScene(): Promise<void> {
  registeredTools?.dispose();
  registeredTools = null;
  activeManifest = null;
  semanticIndex = null;
  latestCameraPose = null;
  selectedEntityId = null;
  rendererReady = false;
  byId<HTMLElement>("fatalError").hidden = true;
  clearPendingCameraRequests("The scene was reloaded before the camera request completed.");
  renderEmptyEntity();
  renderContext();
  setLoading(true, "Loading the published scene manifest");
  setSceneStatus("Loading scene", "working");
  setWebMcpStatus("Waiting for semantic context", "working");
  rendererFrame.hidden = true;
  rendererFrame.removeAttribute("src");

  const sceneSlug = new URL(location.href).searchParams.get("scene")?.trim() || DEFAULT_SCENE_SLUG;
  byId("sceneSlug").textContent = sceneSlug;

  try {
    const response = await fetch(
      `/api/releases/${encodeURIComponent(sceneSlug)}/manifest`,
      { credentials: "same-origin", headers: { Accept: "application/json" } },
    );
    if (!response.ok) {
      throw new Error(`Scene manifest request failed with HTTP ${response.status}.`);
    }
    const manifest = await response.json() as PublishedManifest;
    if (!manifest.spatial) {
      throw new Error("This release has no published spatial runtime.");
    }
    activeManifest = manifest;
    semanticIndex = buildSemanticSceneIndex(manifest);
    renderSceneMetadata(manifest, semanticIndex);
    renderIndexSummary(semanticIndex);

    try {
      registeredTools = await registerSpatialBrowserTools({
        getIndex: () => semanticIndex,
        getCameraPose: () => latestCameraPose,
        getSelectedEntityId: () => selectedEntityId,
        selectEntity,
        navigateToEntity,
        renderSearchResults: renderSearchResultIds,
        reportActivity,
      });
      if (registeredTools.supported) {
        setWebMcpStatus(`${registeredTools.names.length} site tools registered`, "ready");
        byId("registeredToolNames").textContent = registeredTools.names.join(" · ");
      } else {
        setWebMcpStatus("WebMCP unavailable in this browser", "warning");
        byId("registeredToolNames").textContent = "Enable WebMCP in ChatGPT's browser or Chrome testing flags.";
      }
    } catch (error) {
      setWebMcpStatus("WebMCP registration failed", "error");
      byId("registeredToolNames").textContent = errorMessage(error);
    }

    rendererFrame.src = rendererUrl(manifest).toString();
    rendererFrame.hidden = false;
    setLoading(true, "Streaming the photoreal scene");

    const initial = semanticIndex.entityById.get("home-scan-object-central-sofa")
      ?? semanticIndex.entities.find((entity) => entity.kind === "room")
      ?? semanticIndex.entities[0]
      ?? null;
    if (initial) {
      selectEntity(initial.id);
      renderSearchResultIds(initial.label, [initial.id]);
      searchInput.value = initial.label;
    }
  } catch (error) {
    setLoading(false);
    setSceneStatus("Scene unavailable", "error");
    setWebMcpStatus("Tools not registered", "error");
    showFatalError(errorMessage(error));
  }
}

function rendererUrl(manifest: PublishedManifest): URL {
  const profile = deviceProfile();
  const url = new URL("/renderer/index.html", location.origin);
  url.searchParams.set("content", manifest.scene.contentUrl);
  url.searchParams.set("format", manifest.scene.format);
  url.searchParams.set("budget", String(splatBudget(manifest, profile)));
  url.searchParams.set("profile", profile);
  if (manifest.viewer.sceneRotationDegrees) {
    url.searchParams.set("rotation", manifest.viewer.sceneRotationDegrees.join(","));
  }
  if (manifest.viewer.sourceToWorld) {
    url.searchParams.set("sourceToWorld", JSON.stringify(manifest.viewer.sourceToWorld));
  }
  if (manifest.viewer.initialCamera) {
    url.searchParams.set("camera", manifest.viewer.initialCamera.position.join(","));
    url.searchParams.set("target", manifest.viewer.initialCamera.target.join(","));
    if (manifest.viewer.initialCamera.up) {
      url.searchParams.set("up", manifest.viewer.initialCamera.up.join(","));
    }
    url.searchParams.set("fov", String(manifest.viewer.initialCamera.fovDegrees ?? 58));
  }
  return url;
}

function deviceProfile(): DeviceProfile {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  const memory = typeof navigatorWithMemory.deviceMemory === "number"
    ? navigatorWithMemory.deviceMemory
    : null;
  return resolveDeviceProfile({
    mobile: matchMedia("(max-width: 820px), (pointer: coarse)").matches,
    deviceMemoryGb: memory,
  });
}

function splatBudget(manifest: PublishedManifest, profile: DeviceProfile): number {
  if (typeof manifest.viewer.splatBudgetMillions === "number") {
    return manifest.viewer.splatBudgetMillions;
  }
  const policy = manifest.deliveryPolicy;
  if (policy) {
    const value = {
      "mobile-lite": policy.mobile_lite_budget,
      "mobile-standard": policy.mobile_standard_budget,
      "desktop-standard": policy.desktop_standard_budget,
      "desktop-high": policy.desktop_high_budget,
    }[profile];
    if (Number.isFinite(value) && value > 0) return value;
  }
  return profile === "mobile-lite" ? 1.2 : profile === "mobile-standard" ? 1.8 : 3;
}

function sendSpatialRuntime(): void {
  const spatial = activeManifest?.spatial;
  if (!spatial || !rendererFrame.contentWindow) return;
  const artifactNavMesh = spatial.navigationArtifact
    ? Reflect.get(spatial.navigationArtifact, "navMesh")
    : null;
  const navigationMesh = artifactNavMesh && typeof artifactNavMesh === "object"
    ? {
        version: "recast-debug-triangles-v6",
        vertices: Reflect.get(artifactNavMesh, "vertices"),
        indices: Reflect.get(artifactNavMesh, "indices"),
        sourceEntityIds: [],
      }
    : spatial.navigationMesh;
  const doorwayEntityIds = new Set(
    spatial.entities
      .filter((entity) => entity.kind === "doorway")
      .map((entity) => entity.id),
  );

  rendererFrame.contentWindow.postMessage({
    source: "spatial-host",
    type: "set-spatial-runtime",
    collisionBoxes: spatial.collisionProxy.boxes,
    navigationMesh,
    obstacleBoxes: spatial.obstacleProxy?.boxes ?? [],
    doorwayBoxes: spatial.collisionProxy.boxes.filter((box) =>
      doorwayEntityIds.has(box.entityId)
    ),
    navigationProfile: spatial.navigationProfile,
    navigationArtifact: spatial.navigationArtifact ?? null,
    collisionUrl: activeManifest?.scene.collisionUrl ?? null,
    detourUrl: activeManifest?.scene.detourUrl ?? null,
    navMeshUrl: activeManifest?.scene.navMeshUrl ?? null,
    defaultMovementMode: activeManifest?.viewer.defaultMovementMode ?? "walk",
  }, location.origin);
}

function handleRendererMessage(event: MessageEvent<unknown>): void {
  if (event.origin !== location.origin || event.source !== rendererFrame.contentWindow) return;
  if (!isRendererMessage(event.data)) return;
  const message = event.data;

  if (message.type === "heartbeat") return;
  if (message.type === "progress") {
    setLoading(true, message.detail, message.progress);
    setSceneStatus(message.detail, "working");
    return;
  }
  if (message.type === "error") {
    rendererReady = false;
    setLoading(false);
    setSceneStatus(`Renderer error: ${message.message}`, "error");
    showToast(message.message, "error");
    return;
  }
  if (message.type === "ready") {
    rendererReady = true;
    setLoading(false);
    setSceneStatus(`Scene ready · ${message.timeToFirstFrameMs} ms`, "ready");
    void captureRendererCamera().catch(() => undefined);
    return;
  }
  if (message.type === "camera-update") {
    latestCameraPose = message.cameraPose;
    renderContext();
    return;
  }
  if (message.type === "camera") {
    const pending = cameraReadRequests.get(message.requestId);
    if (!pending) return;
    clearPending(cameraReadRequests, message.requestId);
    latestCameraPose = message.cameraPose;
    renderContext();
    pending.resolve(message.cameraPose);
    return;
  }
  if (message.type === "camera-set") {
    const pending = cameraMoveRequests.get(message.requestId);
    if (!pending) return;
    clearPending(cameraMoveRequests, message.requestId);
    if (!message.accepted) {
      pending.reject(new Error(message.message ?? "The renderer rejected this camera pose."));
      return;
    }
    latestCameraPose = message.cameraPose;
    renderContext();
    pending.resolve(message.cameraPose);
    return;
  }
  if (message.type === "movement-blocked") {
    byId("movementNotice").textContent = message.message;
    byId("movementNotice").hidden = !message.message;
  }
}

function isRendererMessage(value: unknown): value is RendererMessage {
  if (!value || typeof value !== "object") return false;
  return Reflect.get(value, "source") === "spatial-spark" &&
    typeof Reflect.get(value, "type") === "string";
}

function captureRendererCamera(): Promise<CameraPose> {
  if (!rendererReady || !rendererFrame.contentWindow) {
    return Promise.reject(new Error("The scene is not ready yet."));
  }
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cameraReadRequests.delete(requestId);
      reject(new Error("The renderer did not return its camera context."));
    }, CAMERA_REQUEST_TIMEOUT_MS);
    cameraReadRequests.set(requestId, { resolve, reject, timeout });
    rendererFrame.contentWindow?.postMessage({
      source: "spatial-host",
      type: "capture-camera",
      requestId,
    }, location.origin);
  });
}

function setRendererCamera(cameraPose: CameraPose): Promise<CameraPose> {
  if (!rendererReady || !rendererFrame.contentWindow) {
    return Promise.reject(new Error("Wait for the spatial scene to finish loading."));
  }
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cameraMoveRequests.delete(requestId);
      reject(new Error("The renderer did not confirm the camera move."));
    }, CAMERA_REQUEST_TIMEOUT_MS);
    cameraMoveRequests.set(requestId, { resolve, reject, timeout });
    rendererFrame.contentWindow?.postMessage({
      source: "spatial-host",
      type: "set-camera",
      requestId,
      cameraPose,
    }, location.origin);
  });
}

async function navigateToEntity(entityId: string): Promise<CameraPose> {
  const index = requireSemanticIndex();
  const entity = index.entityById.get(entityId);
  if (!entity) throw new Error(`Unknown semantic entity: ${entityId}`);
  if (!entity.bestView) throw new Error(`${entity.label} has no authored best view.`);
  selectEntity(entity.id);
  setSceneStatus(`Moving to ${entity.label}`, "working");
  try {
    const pose = await setRendererCamera(entity.bestView);
    setSceneStatus(`Viewing ${entity.label}`, "ready");
    showToast(`Moved to ${entity.label}`, "ready");
    return pose;
  } catch (error) {
    setSceneStatus("Camera move rejected", "error");
    showToast(errorMessage(error), "error");
    throw error;
  }
}

function runHumanSearch(query: string): void {
  const index = semanticIndex;
  const trimmed = query.trim();
  if (!index || !trimmed) return;
  const results = searchSemanticEntities(index, trimmed, { limit: 8 });
  renderSearchResultIds(trimmed, results.map((result) => result.entity.id));
}

function renderSearchResultIds(query: string, entityIds: string[]): void {
  const index = semanticIndex;
  if (!index) return;
  searchInput.value = query;
  searchResultsRoot.replaceChildren();
  byId("resultCount").textContent = `${entityIds.length} match${entityIds.length === 1 ? "" : "es"}`;

  if (!entityIds.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = `No persistent entity matched "${query}". The system will not invent one.`;
    searchResultsRoot.append(empty);
    return;
  }

  for (const entityId of entityIds) {
    const entity = index.entityById.get(entityId);
    if (!entity) continue;
    const row = document.createElement("article");
    row.className = "result-row";
    row.dataset.entityId = entity.id;
    row.classList.toggle("is-selected", entity.id === selectedEntityId);

    const select = document.createElement("button");
    select.type = "button";
    select.className = "result-main";
    select.addEventListener("click", () => selectEntity(entity.id));

    const heading = document.createElement("span");
    heading.className = "result-title";
    heading.textContent = entity.label;
    const meta = document.createElement("span");
    meta.className = "result-meta";
    meta.textContent = `${entity.kind} · ${Math.round(entity.quality.semanticConfidence * 100)}% semantic confidence`;
    select.append(heading, meta);

    const navigate = document.createElement("button");
    navigate.type = "button";
    navigate.className = "result-navigate";
    navigate.textContent = "View";
    navigate.disabled = !entity.bestView;
    navigate.setAttribute("aria-label", `Navigate to ${entity.label}`);
    navigate.addEventListener("click", () => {
      void navigateToEntity(entity.id);
    });

    row.append(select, navigate);
    searchResultsRoot.append(row);
  }
}

function selectEntity(entityId: string): void {
  const index = semanticIndex;
  if (!index) return;
  const entity = index.entityById.get(entityId);
  if (!entity) return;
  selectedEntityId = entity.id;
  renderEntity(entity, index);
  renderContext();
  for (const row of searchResultsRoot.querySelectorAll<HTMLElement>(".result-row")) {
    row.classList.toggle("is-selected", row.dataset.entityId === entity.id);
  }
}

function renderEntity(entity: SemanticEntity, index: SemanticSceneIndex): void {
  entityPanel.replaceChildren();
  const header = document.createElement("header");
  const type = document.createElement("span");
  type.className = "entity-kind";
  type.textContent = `${entity.kind} · ${entity.quality.reviewStatus}`;
  const title = document.createElement("h2");
  title.textContent = entity.label;
  const description = document.createElement("p");
  description.textContent = entity.description;
  header.append(type, title, description);

  const actions = document.createElement("div");
  actions.className = "entity-actions";
  const view = document.createElement("button");
  view.type = "button";
  view.className = "primary-action";
  view.textContent = entity.bestView ? "Open best view" : "No authored view";
  view.disabled = !entity.bestView;
  view.addEventListener("click", () => void navigateToEntity(entity.id));
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "secondary-action";
  copy.textContent = "Copy entity ID";
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(entity.id);
    showToast("Entity ID copied", "ready");
  });
  actions.append(view, copy);

  const quality = document.createElement("section");
  quality.className = "quality-card";
  const qualityTitle = document.createElement("div");
  qualityTitle.className = "section-line";
  const qualityHeading = document.createElement("h3");
  qualityHeading.textContent = "Capture assurance";
  const qualityVerdict = document.createElement("span");
  qualityVerdict.textContent = entity.quality.gaps.length ? "Limitations disclosed" : "No recorded gap";
  qualityTitle.append(qualityHeading, qualityVerdict);
  quality.append(qualityTitle);
  quality.append(
    metricBar("Visual coverage", entity.quality.visualCoverage),
    metricBar("Semantic confidence", entity.quality.semanticConfidence),
    metricBar("Geometry confidence", entity.quality.geometryConfidence),
    metricBar("Freshness", entity.quality.freshnessConfidence),
  );

  const gaps = document.createElement("div");
  gaps.className = "evidence-block";
  const gapHeading = document.createElement("strong");
  gapHeading.textContent = "Known gaps";
  const gapList = document.createElement("ul");
  const gapValues = entity.quality.gaps.length
    ? entity.quality.gaps
    : ["No blocking capture gap is recorded for general exploration."];
  for (const value of gapValues) {
    const item = document.createElement("li");
    item.textContent = value;
    gapList.append(item);
  }
  gaps.append(gapHeading, gapList);

  const relationships = document.createElement("div");
  relationships.className = "evidence-block";
  const relationHeading = document.createElement("strong");
  relationHeading.textContent = "Spatial relationships";
  const relationList = document.createElement("ul");
  if (!entity.relationships.length) {
    const item = document.createElement("li");
    item.textContent = "No explicit relationship is stored yet.";
    relationList.append(item);
  } else {
    for (const relation of entity.relationships.slice(0, 6)) {
      const item = document.createElement("li");
      const target = index.entityById.get(relation.targetId);
      item.textContent = `${relation.predicate.replaceAll("_", " ")} ${target?.label ?? relation.targetId} · ${Math.round(relation.confidence * 100)}%`;
      relationList.append(item);
    }
  }
  relationships.append(relationHeading, relationList);

  const provenance = document.createElement("div");
  provenance.className = "provenance-line";
  provenance.textContent = `${entity.source.replaceAll("_", " ")} · ${entity.provenance.join(" · ")}`;

  entityPanel.append(header, actions, quality, gaps, relationships, provenance);
}

function metricBar(label: string, value: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "quality-metric";
  const copy = document.createElement("div");
  const name = document.createElement("span");
  name.textContent = label;
  const score = document.createElement("strong");
  score.textContent = `${Math.round(value * 100)}%`;
  copy.append(name, score);
  const track = document.createElement("div");
  track.className = "quality-track";
  const fill = document.createElement("span");
  fill.style.width = `${Math.max(0, Math.min(100, value * 100))}%`;
  track.append(fill);
  row.append(copy, track);
  return row;
}

function renderEmptyEntity(): void {
  entityPanel.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "entity-empty";
  const title = document.createElement("h2");
  title.textContent = "Select a persistent scene entity";
  const body = document.createElement("p");
  body.textContent = "The semantic layer keeps identity, room membership, evidence, relationships, and uncertainty across camera views.";
  empty.append(title, body);
  entityPanel.append(empty);
}

function renderSceneMetadata(manifest: PublishedManifest, index: SemanticSceneIndex): void {
  document.title = `${manifest.viewer.title} · Spatial Browser`;
  byId("sceneTitle").textContent = manifest.viewer.title;
  byId("sceneSubtitle").textContent = manifest.viewer.subtitle ?? manifest.project.name;
  byId("sceneFormat").textContent = manifest.scene.format.toUpperCase();
  byId("sceneUnit").textContent = index.worldUnit === "scene_units"
    ? "Provisional scene units"
    : index.worldUnit === "metres"
    ? "Registered metres"
    : "Scale unknown";
  byId("measurementDisclaimer").textContent = index.measurementDisclaimer;
}

function renderIndexSummary(index: SemanticSceneIndex): void {
  const rooms = index.entities.filter((entity) => entity.kind === "room" || entity.kind === "zone").length;
  const objects = index.entities.filter((entity) => entity.kind === "object").length;
  const reviewed = index.entities.filter((entity) => entity.quality.reviewStatus === "reviewed").length;
  byId("entityCount").textContent = String(index.entities.length);
  byId("roomCount").textContent = String(rooms);
  byId("objectCount").textContent = String(objects);
  byId("reviewedCount").textContent = String(reviewed);
}

function renderContext(): void {
  const index = semanticIndex;
  if (!index) {
    byId("currentRegion").textContent = "No scene context";
    byId("cameraPosition").textContent = "Camera unavailable";
    byId("nearbyEntities").textContent = "No nearby entities";
    return;
  }
  const context = sceneContext(index, latestCameraPose, selectedEntityId);
  byId("currentRegion").textContent = context.currentRegion?.label ?? "Outside classified regions";
  byId("cameraPosition").textContent = context.cameraPose
    ? context.cameraPose.position.map((value) => value.toFixed(2)).join(", ")
    : "Waiting for renderer";
  byId("nearbyEntities").textContent = context.nearbyEntities.length
    ? context.nearbyEntities.slice(0, 4).map(({ entity }) => entity.label).join(" · ")
    : "No indexed entity within the context radius";
}

function reportActivity(entry: WebMcpActivity): void {
  toolActivities.unshift(entry);
  toolActivities.splice(TOOL_LOG_LIMIT);
  toolActivityRoot.replaceChildren();
  for (const activity of toolActivities) {
    const item = document.createElement("li");
    item.dataset.phase = activity.phase;
    const top = document.createElement("div");
    const name = document.createElement("code");
    name.textContent = activity.tool;
    const phase = document.createElement("span");
    phase.textContent = activity.phase;
    top.append(name, phase);
    const detail = document.createElement("p");
    detail.textContent = activity.detail;
    const time = document.createElement("time");
    time.dateTime = activity.at;
    time.textContent = new Date(activity.at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    item.append(top, detail, time);
    toolActivityRoot.append(item);
  }
}

function setLoading(visible: boolean, detail = "", progress?: number): void {
  loadingOverlay.hidden = !visible;
  if (detail) byId("loadingDetail").textContent = detail;
  const progressBar = byId<HTMLElement>("loadingProgress");
  progressBar.style.width = `${typeof progress === "number" ? Math.max(4, Math.min(100, progress)) : 18}%`;
}

function setSceneStatus(message: string, tone: "working" | "ready" | "error"): void {
  sceneStatus.textContent = message;
  sceneStatus.dataset.tone = tone;
}

function setWebMcpStatus(message: string, tone: "working" | "ready" | "warning" | "error"): void {
  webMcpStatus.textContent = message;
  webMcpStatus.dataset.tone = tone;
}

function showFatalError(message: string): void {
  const panel = byId<HTMLElement>("fatalError");
  panel.hidden = false;
  byId("fatalErrorMessage").textContent = message;
}

function showToast(message: string, tone: "ready" | "error" = "ready"): void {
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.hidden = false;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
    toastTimer = null;
  }, 3_500);
}

function requireSemanticIndex(): SemanticSceneIndex {
  if (!semanticIndex) throw new Error("The semantic index is still loading.");
  return semanticIndex;
}

function clearPending(
  map: Map<string, PendingCameraRequest>,
  requestId: string,
): void {
  const pending = map.get(requestId);
  if (!pending) return;
  window.clearTimeout(pending.timeout);
  map.delete(requestId);
}

function clearPendingCameraRequests(reason: string): void {
  for (const map of [cameraReadRequests, cameraMoveRequests]) {
    for (const [requestId, pending] of map) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
      map.delete(requestId);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unknown error occurred.";
}
