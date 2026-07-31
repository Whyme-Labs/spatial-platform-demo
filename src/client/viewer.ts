import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import { api } from "./api";
import { rendererLoadTimeoutMs } from "../shared/renderer-readiness";
import { runAction, SingleFlight } from "./action-state";
import {
  buildFloorPlans,
  cameraPoseForPlanRoom,
  locatePlanRoom,
  projectFloorPlan,
  projectPlanPoint,
  type FloorPlan,
  type PlanRoom,
} from "./floor-plan";
import type { SourceToWorldTransform } from "../shared/navigation-runtime";
import "../../styles.css";

const VIEWER_MOVEMENT_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
]);

type ReleaseManifest = {
  schemaVersion: string;
  release: {
    id: string;
    slug: string;
    publishedAt: string;
    expiresAt: string | null;
    accessPolicy: string;
  };
  project: {
    id: string;
    versionId: string;
    name: string;
    captureAdapter: string;
    provenance: unknown;
  };
  scene: {
    format: string;
    contentUrl: string;
    posterUrl: string | null;
    sizeBytes: number;
    etag: string | null;
  };
  viewer: {
    title: string;
    subtitle?: string;
    captureDate?: string;
    measurementDisclaimer: string;
    splatBudgetMillions?: number;
    sceneRotationDegrees?: [number, number, number];
    sourceToWorld?: SourceToWorldTransform;
    initialCamera?: {
      position: [number, number, number];
      target: [number, number, number];
      up?: [number, number, number];
      fovDegrees?: number;
    };
  };
  theme?: {
    brandName: string | null;
    logoUrl: string | null;
    accentColor: string;
    surfaceColor: string;
  };
  spatial?: {
    entities: Array<{
      id: string;
      parent_id: string | null;
      kind: "floor" | "room" | "doorway" | "poi";
      label: string;
      description: string | null;
      position_json: string | null;
      geometry_json: string | null;
      metadata_json: string;
      sort_order: number;
    }>;
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
        min: [number, number, number];
        max: [number, number, number];
      }>;
    };
    navigationMesh: {
      version: string;
      vertices: Array<[number, number, number]>;
      indices: number[];
      sourceEntityIds: string[];
    };
    obstacleProxy: {
      version: string;
      boxes: Array<{
        entityId: string;
        label: string;
        min: [number, number, number];
        max: [number, number, number];
      }>;
    };
    navigationProfile: {
      worldUnit?: "metres" | "scene_units";
      agentRadius: number;
      agentHeight: number;
      eyeHeight: number;
      maxStepMetres: number;
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
};
type CameraPose = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovDegrees: number;
};
type SceneReview = {
  comments: Array<{ id: string; kind: string; status: string; body: string; created_at: string }>;
  decisions: Array<{ id: string; decision: string; note: string | null; created_at: string }>;
};

type SparkRendererMessage =
  | {
      source: "spatial-spark";
      type: "progress";
      progress: number;
      detail: string;
    }
  | {
      source: "spatial-spark";
      type: "ready";
      runtime: "spark";
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
      type: "control-mode";
      mode: "orbit" | "free-roam";
    }
  | {
      source: "spatial-spark";
      type: "control-onboarding";
      visible: boolean;
    }
  | {
      source: "spatial-spark";
      type: "control-help";
      visible: boolean;
      height: number;
    };
type PlayCanvasRendererMessage =
  | {
      source: "spatial-playcanvas";
      type: "progress";
      progress: number;
      detail: string;
    }
  | {
      source: "spatial-playcanvas";
      type: "ready";
      runtime: "playcanvas";
      version: string;
      timeToFirstFrameMs: number;
      format: string;
      splatBudget: number;
    }
  | {
      source: "spatial-playcanvas";
      type: "error";
      code: string;
      message: string;
    }
  | {
      source: "spatial-playcanvas";
      type: "camera";
      requestId: string;
      cameraPose: CameraPose;
    }
  | {
      source: "spatial-playcanvas";
      type: "camera-set";
      requestId: string;
      accepted: boolean;
      message?: string;
      cameraPose: CameraPose;
    };
type SpatialRendererMessage = SparkRendererMessage | PlayCanvasRendererMessage;
type SpatialRendererRuntime = "spark" | "playcanvas";

const byId = <T extends Element = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as unknown as T;
};

const frame = byId<HTMLIFrameElement>("rendererFrame");
const loading = byId<HTMLElement>("loadingOverlay");
const errorPanel = byId<HTMLElement>("errorPanel");
const releaseInfo = byId<HTMLElement>("releaseInfo");
const toast = byId<HTMLElement>("toast");
const deviceProfile = detectDeviceProfile();
const viewerSessionId = crypto.randomUUID();
const activeReleaseSlug = releaseSlug();
const viewerActions = new SingleFlight();
let activeManifest: ReleaseManifest | null = null;
let activeRendererRuntime: SpatialRendererRuntime = "spark";
let loadTimeout: number | null = null;
let activeReview: SceneReview | null = null;
let activeFloorPlans: FloorPlan[] = [];
let activeFloorPlanId: string | null = null;
let latestCameraPose: CameraPose | null = null;
let rendererReady = false;
const planRoomsById = new Map<string, PlanRoom>();
const cameraRequests = new Map<string, {
  resolve: (pose: CameraPose) => void;
  reject: (error: Error) => void;
  timeout: number;
}>();
const cameraMoveRequests = new Map<string, {
  resolve: (pose: CameraPose) => void;
  reject: (error: Error) => void;
  timeout: number;
}>();
const reviewMode = location.pathname.startsWith("/review/");

if (activeReleaseSlug) {
  document.body.className = "viewer-page";
  byId<HTMLElement>("marketingPage").hidden = true;
  byId<HTMLElement>("releaseApp").hidden = false;
  const shareButton = byId<HTMLButtonElement>("shareButton");
  shareButton.addEventListener("click", () => {
    void runAction({
      key: "share-release",
      trigger: shareButton,
      pendingLabel: "Sharing…",
    }, shareCurrentUrl);
  });
  const retryButton = byId<HTMLButtonElement>("retryButton");
  retryButton.addEventListener("click", () => {
    void runAction({
      key: "retry-release",
      trigger: retryButton,
      pendingLabel: "Retrying…",
    }, loadPublishedRelease);
  });
  window.addEventListener("message", handleRendererMessage);
  bindViewerKeyboardBridge();
  if (reviewMode) bindReviewInterface();
  bindViewerHud();
  bindSpatialNavigator();
  void loadPublishedRelease();
} else {
  document.body.className = "marketing-page-body";
  byId<HTMLElement>("marketingPage").hidden = false;
  byId<HTMLElement>("releaseApp").hidden = true;
  initialiseMarketingPage();
}

async function loadPublishedRelease(): Promise<void> {
  return viewerActions.run("load-release", loadPublishedReleaseOnce);
}

async function loadPublishedReleaseOnce(): Promise<void> {
  const slug = releaseSlug();
  if (!slug) return;
  setLoading(true, "Authorising scene release…");
  rendererReady = false;
  setNavigatorReady(false);
  byId("viewport").classList.remove("mobile-free-roam-active");
  byId("viewport").classList.remove("mobile-controls-onboarding");
  byId("viewport").classList.remove("renderer-help-open");
  byId<HTMLElement>("viewport").style.removeProperty("--renderer-help-height");
  errorPanel.hidden = true;
  setViewerHudMode("collapsed");
  byId<HTMLElement>("viewerHud").hidden = true;
  releaseInfo.hidden = true;
  byId<HTMLButtonElement>("openNavigator").hidden = true;
  byId("reviewPanel").hidden = true;
  frame.classList.add("is-loading");
  frame.hidden = true;
  if (loadTimeout !== null) window.clearTimeout(loadTimeout);

  try {
    const accessToken = new URL(location.href).searchParams.get("access_token");
    const query = accessToken ? `?access_token=${encodeURIComponent(accessToken)}` : "";
    const manifest = await api<ReleaseManifest>(`/api/releases/${encodeURIComponent(slug)}/manifest${query}`);
    activeManifest = manifest;
    if (accessToken) {
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete("access_token");
      history.replaceState({}, "", cleanUrl);
    }
    applyManifest(manifest);
    if (reviewMode) await loadSceneReview();
    void recordTelemetry("viewer_open");
    const rendererUrl = publishedRendererUrl(manifest);
    frame.src = rendererUrl.toString();
    frame.hidden = false;
    const timeoutMs = rendererLoadTimeoutMs(manifest.scene.format, manifest.scene.sizeBytes);
    loadTimeout = window.setTimeout(() => {
      const rendererName = activeRendererRuntime === "playcanvas" ? "The native SOG viewer" : "Spark";
      showError(
        `${rendererName} did not become ready within ${timeoutMs / 1000} seconds.`,
        "Check the network connection or retry on a device with WebGL2 support.",
      );
      void recordTelemetry("renderer_error", timeoutMs, {
        reason: "load_timeout",
        runtime: activeRendererRuntime,
      });
    }, timeoutMs);
  } catch (error) {
    showError("This spatial release is unavailable.", error instanceof Error ? error.message : "The release could not be authorised.");
  }
}

frame.addEventListener("load", () => {
  if (!activeManifest) return;
  byId("rendererStatus").textContent = "Preparing scene";
  sendSpatialRuntime();
});

frame.addEventListener("error", () => {
  showError("The renderer failed to start.", "Retry the release or use a supported WebGL2 browser.");
  void recordTelemetry("renderer_error", undefined, { reason: "iframe_error" });
});

function handleRendererMessage(event: MessageEvent<unknown>): void {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (!isSpatialRendererMessage(event.data)) return;
  const message = event.data;
  if (message.type === "camera") {
    const pending = cameraRequests.get(message.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    cameraRequests.delete(message.requestId);
    pending.resolve(message.cameraPose);
    return;
  }
  if (message.source === "spatial-spark" && message.type === "camera-update") {
    updateFloorPlanCamera(message.cameraPose);
    return;
  }
  if (message.type === "camera-set") {
    const pending = cameraMoveRequests.get(message.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    cameraMoveRequests.delete(message.requestId);
    if (message.accepted) {
      updateFloorPlanCamera(message.cameraPose);
      pending.resolve(message.cameraPose);
    } else {
      pending.reject(new Error(message.message ?? "The selected room is outside the authored walkable area."));
    }
    return;
  }
  if (message.source === "spatial-spark" && message.type === "control-mode") {
    byId("viewport").classList.toggle("mobile-free-roam-active", message.mode === "free-roam");
    return;
  }
  if (message.source === "spatial-spark" && message.type === "control-onboarding") {
    byId("viewport").classList.toggle("mobile-controls-onboarding", message.visible);
    return;
  }
  if (message.source === "spatial-spark" && message.type === "control-help") {
    const viewport = byId<HTMLElement>("viewport");
    const helpHeight = Number.isFinite(message.height)
      ? Math.min(innerHeight, Math.max(0, message.height))
      : 0;
    viewport.classList.toggle("renderer-help-open", message.visible);
    if (message.visible) {
      viewport.style.setProperty("--renderer-help-height", `${helpHeight}px`);
      setViewerHudMode("collapsed");
    } else {
      viewport.style.removeProperty("--renderer-help-height");
    }
    return;
  }
  if (message.type === "progress") {
    setLoading(true, message.detail, message.progress);
    byId("rendererStatus").textContent = message.detail;
    return;
  }
  if (message.type === "error") {
    const runtime = message.source === "spatial-playcanvas" ? "playcanvas" : "spark";
    showError(
      runtime === "playcanvas"
        ? "The native SOG viewer could not render this release."
        : "Spark could not render this release.",
      message.message,
    );
    void recordTelemetry("renderer_error", undefined, {
      reason: message.code,
      runtime,
    });
    return;
  }
  if (loadTimeout !== null) window.clearTimeout(loadTimeout);
  frame.classList.remove("is-loading");
  setLoading(false);
  rendererReady = true;
  byId<HTMLElement>("viewerHud").hidden = false;
  releaseInfo.hidden = false;
  byId("reviewPanel").hidden = !reviewMode;
  setNavigatorReady(true);
  byId("rendererStatus").textContent = "Scene ready";
  sendSpatialRuntime();
  void recordTelemetry("renderer_ready", message.timeToFirstFrameMs, {
    runtime: message.runtime,
    format: message.format,
    splatBudget: message.splatBudget,
  });
  void recordTelemetry("time_to_first_frame", message.timeToFirstFrameMs, {
    runtime: message.runtime,
    format: message.format,
  });
}

function isSpatialRendererMessage(value: unknown): value is SpatialRendererMessage {
  if (!value || typeof value !== "object") return false;
  const source = Reflect.get(value, "source");
  const type = Reflect.get(value, "type");
  if (source === "spatial-playcanvas") {
    return type === "progress" || type === "ready" || type === "error" ||
      type === "camera" || type === "camera-set";
  }
  return source === "spatial-spark" &&
    (type === "progress" || type === "ready" || type === "error" || type === "camera" ||
      type === "camera-update" || type === "camera-set" || type === "control-mode" ||
      type === "control-onboarding" || type === "control-help");
}

function publishedRendererUrl(manifest: ReleaseManifest): URL {
  const budget = manifest.viewer.splatBudgetMillions ?? manifestBudget(manifest);
  if (manifest.scene.format.toLowerCase() === "sog") {
    activeRendererRuntime = "playcanvas";
    const rendererUrl = new URL("/playcanvas-renderer/index.html", location.origin);
    rendererUrl.searchParams.set("content", manifest.scene.contentUrl);
    rendererUrl.searchParams.set("format", "sog");
    rendererUrl.searchParams.set("budget", String(budget));
    rendererUrl.searchParams.set("settings", playCanvasSettingsUrl(manifest));
    rendererUrl.searchParams.set("webgl", "");
    rendererUrl.searchParams.set("noui", "");
    rendererUrl.searchParams.set("noanim", "");
    rendererUrl.searchParams.set("nofx", "");
    if (manifest.scene.posterUrl) rendererUrl.searchParams.set("poster", manifest.scene.posterUrl);
    return rendererUrl;
  }

  activeRendererRuntime = "spark";
  const rendererUrl = new URL("/renderer/index.html", location.origin);
  rendererUrl.searchParams.set("content", manifest.scene.contentUrl);
  rendererUrl.searchParams.set("format", manifest.scene.format);
  rendererUrl.searchParams.set("budget", String(budget));
  if (manifest.viewer.sceneRotationDegrees) {
    rendererUrl.searchParams.set("rotation", manifest.viewer.sceneRotationDegrees.join(","));
  }
  if (manifest.viewer.sourceToWorld) {
    rendererUrl.searchParams.set(
      "sourceToWorld",
      JSON.stringify(manifest.viewer.sourceToWorld),
    );
  }
  if (manifest.viewer.initialCamera) {
    rendererUrl.searchParams.set("camera", manifest.viewer.initialCamera.position.join(","));
    rendererUrl.searchParams.set("target", manifest.viewer.initialCamera.target.join(","));
    if (manifest.viewer.initialCamera.up) {
      rendererUrl.searchParams.set("up", manifest.viewer.initialCamera.up.join(","));
    }
    rendererUrl.searchParams.set("fov", String(manifest.viewer.initialCamera.fovDegrees ?? 58));
  }
  return rendererUrl;
}

function playCanvasSettingsUrl(manifest: ReleaseManifest): string {
  const camera = manifest.viewer.initialCamera;
  const settings = {
    version: 2,
    tonemapping: "none",
    highPrecisionRendering: false,
    background: { color: [0.043, 0.067, 0.055] },
    postEffectSettings: {
      sharpness: { enabled: false, amount: 0 },
      bloom: { enabled: false, intensity: 1, blurLevel: 2 },
      grading: {
        enabled: false,
        brightness: 0,
        contrast: 1,
        saturation: 1,
        tint: [1, 1, 1],
      },
      vignette: { enabled: false, intensity: 0.5, inner: 0.3, outer: 0.75, curvature: 1 },
      fringing: { enabled: false, intensity: 0.5 },
    },
    animTracks: [],
    cameras: camera
      ? [{
          initial: {
            position: camera.position,
            target: camera.target,
            fov: camera.fovDegrees ?? 58,
          },
        }]
      : [],
    annotations: [],
    startMode: "default",
  };
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(settings))}`;
}

function applyManifest(manifest: ReleaseManifest): void {
  document.title = `${manifest.viewer.title} | Spatial Studio`;
  byId("projectName").textContent = manifest.project.name;
  byId("accessPolicy").textContent = manifest.release.accessPolicy.toUpperCase();
  byId("releaseTitle").textContent = manifest.viewer.title;
  byId("releaseSubtitle").textContent = manifest.viewer.subtitle ?? manifest.project.name;
  byId("captureDate").textContent = manifest.viewer.captureDate ?? "Not provided";
  byId("sceneFormat").textContent = manifest.scene.format.toUpperCase();
  const worldUnit = manifest.viewer.sourceToWorld?.worldUnit ??
    manifest.spatial?.navigationProfile.worldUnit;
  byId("scaleStatus").textContent = worldUnit === "scene_units"
    ? "Provisional scene units (SU)"
    : manifest.viewer.sourceToWorld
    ? "Reviewed metric metres"
    : "Visual only — scale not declared";
  byId("publishedAt").textContent = new Date(manifest.release.publishedAt).toLocaleDateString();
  byId("measurementDisclaimer").textContent = manifest.viewer.measurementDisclaimer;
  if (manifest.theme) {
    document.documentElement.style.setProperty("--accent", manifest.theme.accentColor);
    document.documentElement.style.setProperty("--surface", manifest.theme.surfaceColor);
    const brand = document.querySelector<HTMLElement>("#releaseApp .brand strong");
    if (brand && manifest.theme.brandName) brand.textContent = manifest.theme.brandName;
  }
  renderSpatialNavigator(manifest);
}

function bindViewerHud(): void {
  const toggle = byId<HTMLButtonElement>("toggleReleaseInfo");
  toggle.addEventListener("click", () => {
    setViewerHudMode(toggle.getAttribute("aria-expanded") === "true" ? "collapsed" : "release");
  });
}

function bindViewerKeyboardBridge(): void {
  window.addEventListener("keydown", (event) => {
    if (
      !rendererReady ||
      !VIEWER_MOVEMENT_KEYS.has(event.code) ||
      isViewerEditableTarget(event.target)
    ) return;
    sendViewerMovementKey(event.code, true);
    event.preventDefault();
  });
  window.addEventListener("keyup", (event) => {
    if (!rendererReady || !VIEWER_MOVEMENT_KEYS.has(event.code)) return;
    sendViewerMovementKey(event.code, false);
    event.preventDefault();
  });
  window.addEventListener("blur", () => {
    frame.contentWindow?.postMessage({
      source: "spatial-host",
      type: "movement-keys-clear",
    }, location.origin);
  });
}

function sendViewerMovementKey(code: string, pressed: boolean): void {
  frame.contentWindow?.postMessage({
    source: "spatial-host",
    type: "movement-key",
    code,
    pressed,
  }, location.origin);
}

function isViewerEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;
}

function setViewerHudMode(mode: "collapsed" | "release" | "navigator"): void {
  const toggle = byId<HTMLButtonElement>("toggleReleaseInfo");
  const navigatorToggle = byId<HTMLButtonElement>("openNavigator");
  const releaseExpanded = mode === "release";
  const navigatorExpanded = mode === "navigator";
  toggle.setAttribute("aria-expanded", String(releaseExpanded));
  navigatorToggle.setAttribute("aria-expanded", String(navigatorExpanded));
  byId<HTMLElement>("releaseInfoDetails").hidden = !releaseExpanded;
  byId<HTMLElement>("spatialNavigator").hidden = !navigatorExpanded;
  releaseInfo.classList.toggle("is-expanded", mode !== "collapsed");
  releaseInfo.classList.toggle("is-navigating", navigatorExpanded);
}

function bindSpatialNavigator(): void {
  const trigger = byId<HTMLButtonElement>("openNavigator");
  trigger.addEventListener("click", () => {
    setViewerHudMode(trigger.getAttribute("aria-expanded") === "true" ? "collapsed" : "navigator");
  });
  byId("closeNavigator").addEventListener("click", () => {
    setViewerHudMode("collapsed");
    trigger.focus();
  });
  byId<HTMLSelectElement>("floorPlanSelect").addEventListener("change", (event) => {
    const selected = (event.currentTarget as HTMLSelectElement).value;
    if (!activeFloorPlans.some((plan) => plan.id === selected)) return;
    activeFloorPlanId = selected;
    renderActiveFloorPlan();
  });
}

function hasSpatialNavigation(manifest: ReleaseManifest | null): boolean {
  const spatial = manifest?.spatial;
  return Boolean(
    spatial?.routes.length ||
    spatial?.entities.some((entity) => entity.kind === "room" || entity.kind === "poi"),
  );
}

function renderSpatialNavigator(manifest: ReleaseManifest): void {
  const spatial = manifest.spatial;
  const rooms = spatial?.entities.filter((entity) => entity.kind === "room" || entity.kind === "poi") ?? [];
  const routes = spatial?.routes ?? [];
  activeFloorPlans = buildFloorPlans(spatial?.entities ?? []);
  planRoomsById.clear();
  for (const plan of activeFloorPlans) {
    for (const room of plan.rooms) planRoomsById.set(room.id, room);
  }
  if (!activeFloorPlans.some((plan) => plan.id === activeFloorPlanId)) {
    activeFloorPlanId = activeFloorPlans[0]?.id ?? null;
  }
  renderFloorPlanSelector();
  renderActiveFloorPlan();
  const trigger = byId<HTMLButtonElement>("openNavigator");
  if (!hasSpatialNavigation(manifest)) {
    trigger.hidden = true;
    setViewerHudMode("collapsed");
    return;
  }
  trigger.hidden = false;
  byId("navigatorTriggerLabel").textContent = routes.length ? "Start guided visit" : "Explore rooms";
  const roomDirectory = byId("roomDirectory");
  roomDirectory.replaceChildren();
  for (const room of rooms) {
    const button = document.createElement("button");
    button.className = "navigator-item";
    button.type = "button";
    button.textContent = room.label;
    button.disabled = !rendererReady;
    button.addEventListener("click", () => {
      const pose = cameraFromEntity(room);
      if (!pose) {
        showToast(`${room.label} has no authored camera yet`);
        return;
      }
      void runAction({
        key: "viewer-camera-move",
        trigger: button,
        pendingLabel: "Moving…",
        errorTarget: byId<HTMLElement>("navigatorError"),
      }, async () => {
        await setRendererCamera(pose);
        showToast(`Moved to ${room.label}`);
        if (innerWidth < 760) {
          setViewerHudMode("collapsed");
        }
      });
    });
    roomDirectory.append(button);
  }
  const routeList = byId("guidedRoutes");
  routeList.replaceChildren();
  for (const route of routes) {
    const button = document.createElement("button");
    button.className = "navigator-item route";
    button.type = "button";
    button.disabled = !rendererReady;
    const stop = spatial?.routeStops
      .filter((candidate) => candidate.route_id === route.id)
      .sort((a, b) => a.sequence_number - b.sequence_number)[0];
    button.textContent = `${route.label}${route.estimated_seconds ? ` · ${Math.ceil(route.estimated_seconds / 60)} min` : ""}`;
    button.addEventListener("click", () => {
      let pose = parseCameraPose(stop?.camera_pose_json ?? null);
      if (!pose && stop) {
        const entity = spatial?.entities.find((candidate) => candidate.id === stop.entity_id);
        pose = entity ? cameraFromEntity(entity) : null;
      }
      if (!pose) {
        showToast(`${route.label} has no authored starting view`);
        return;
      }
      void runAction({
        key: "viewer-camera-move",
        trigger: button,
        pendingLabel: "Starting…",
        errorTarget: byId<HTMLElement>("navigatorError"),
      }, async () => {
        await setRendererCamera(pose);
        showToast(`Guided route started: ${route.label}`);
      });
    });
    routeList.append(button);
  }
}

function cameraFromEntity(entity: NonNullable<ReleaseManifest["spatial"]>["entities"][number]): CameraPose | null {
  try {
    const metadata = JSON.parse(entity.metadata_json) as Record<string, unknown>;
    if (metadata.cameraPose) return metadata.cameraPose as CameraPose;
  } catch {
    // A malformed optional camera does not block the scene.
  }
  const planRoom = planRoomsById.get(entity.id);
  if (planRoom) return cameraPoseForPlanRoom(planRoom);
  if (!entity.position_json) return null;
  try {
    const position = JSON.parse(entity.position_json) as [number, number, number];
    return {
      position: [position[0], position[1] + 1.6, position[2] + 2],
      target: [position[0], position[1] + 1.2, position[2]],
      up: [0, 1, 0],
      fovDegrees: 58,
    };
  } catch {
    return null;
  }
}

function renderFloorPlanSelector(): void {
  const section = byId<HTMLElement>("floorPlanSection");
  const select = byId<HTMLSelectElement>("floorPlanSelect");
  const control = byId<HTMLElement>("floorPlanFloorControl");
  select.replaceChildren();
  section.hidden = activeFloorPlans.length === 0;
  control.hidden = activeFloorPlans.length <= 1;
  for (const plan of activeFloorPlans) {
    const option = document.createElement("option");
    option.value = plan.id;
    option.textContent = plan.label;
    option.selected = plan.id === activeFloorPlanId;
    select.append(option);
  }
}

function setNavigatorReady(ready: boolean): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".navigator-item")) {
    button.disabled = !ready;
  }
  for (const target of document.querySelectorAll<SVGGElement>(".floor-plan-room-target")) {
    target.setAttribute("aria-disabled", String(!ready));
  }
  byId<HTMLElement>("floorPlanSection").setAttribute("aria-busy", String(!ready));
}

function renderActiveFloorPlan(): void {
  const section = byId<HTMLElement>("floorPlanSection");
  const roomsRoot = byId<SVGGElement>("floorPlanRooms");
  roomsRoot.replaceChildren();
  const plan = activeFloorPlans.find((candidate) => candidate.id === activeFloorPlanId);
  if (!plan) {
    section.hidden = true;
    byId<SVGGElement>("floorPlanMarker").toggleAttribute("hidden", true);
    return;
  }
  section.hidden = false;
  byId<HTMLSelectElement>("floorPlanSelect").value = plan.id;
  const projected = projectFloorPlan(plan);
  byId<SVGSVGElement>("floorPlanMap").setAttribute("viewBox", projected.viewBox);
  for (const projectedRoom of projected.rooms) {
    const room = planRoomsById.get(projectedRoom.id);
    if (!room) continue;
    const group = svgElement("g");
    group.classList.add("floor-plan-room-target");
    group.dataset.roomId = room.id;
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", `Move to ${room.label}`);
    group.setAttribute("aria-disabled", String(!rendererReady));
    const title = svgElement("title");
    title.textContent = `Move to ${room.label}`;
    const path = svgElement("path");
    path.classList.add("floor-plan-room");
    path.setAttribute("d", projectedRoom.path);
    const label = svgElement("text");
    label.classList.add("floor-plan-label");
    label.setAttribute("x", String(projectedRoom.labelPosition[0]));
    label.setAttribute("y", String(projectedRoom.labelPosition[1]));
    label.textContent = room.label;
    const activate = (): void => navigateToPlanRoom(room);
    group.addEventListener("click", activate);
    group.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    });
    group.append(title, path, label);
    roomsRoot.append(group);
  }
  if (latestCameraPose) updateFloorPlanCamera(latestCameraPose);
  else {
    byId("floorPlanPosition").textContent = plan.label;
    byId<SVGGElement>("floorPlanMarker").toggleAttribute("hidden", true);
  }
}

function navigateToPlanRoom(room: PlanRoom): void {
  if (!rendererReady || viewerActions.isPending("floor-plan-camera-move")) {
    if (!rendererReady) showToast("Wait for the spatial scene to finish loading.");
    return;
  }
  const group = document.querySelector<SVGGElement>(
    `.floor-plan-room-target[data-room-id="${CSS.escape(room.id)}"]`,
  );
  const pose = cameraPoseForPlanRoom(room);
  group?.classList.add("is-pending");
  group?.setAttribute("aria-busy", "true");
  byId("navigatorError").textContent = "";
  void viewerActions.run("floor-plan-camera-move", async () => {
    try {
      await setRendererCamera(pose);
      showToast(`Moved to ${room.label}`);
      if (innerWidth < 760) {
        setViewerHudMode("collapsed");
      }
    } catch (error) {
      byId("navigatorError").textContent = error instanceof Error
        ? error.message
        : "The room could not be opened. Retry after the scene is ready.";
    } finally {
      group?.classList.remove("is-pending");
      group?.removeAttribute("aria-busy");
    }
  });
}

function updateFloorPlanCamera(cameraPose: CameraPose): void {
  latestCameraPose = cameraPose;
  let locatedPlan: FloorPlan | null = null;
  let locatedRoom: PlanRoom | null = null;
  for (const plan of activeFloorPlans) {
    const room = locatePlanRoom(plan, cameraPose.position);
    if (!room) continue;
    locatedPlan = plan;
    locatedRoom = room;
    break;
  }
  if (locatedPlan && locatedPlan.id !== activeFloorPlanId) {
    activeFloorPlanId = locatedPlan.id;
    renderActiveFloorPlan();
    return;
  }
  const plan = activeFloorPlans.find((candidate) => candidate.id === activeFloorPlanId);
  if (!plan) return;
  const marker = byId<SVGGElement>("floorPlanMarker");
  const insidePlanBounds = cameraPose.position[0] >= plan.bounds.minX &&
    cameraPose.position[0] <= plan.bounds.maxX &&
    cameraPose.position[2] >= plan.bounds.minZ &&
    cameraPose.position[2] <= plan.bounds.maxZ;
  if (!insidePlanBounds) {
    marker.toggleAttribute("hidden", true);
    byId("floorPlanPosition").textContent = `${plan.label} · position outside mapped area`;
    for (const target of document.querySelectorAll<SVGGElement>(".floor-plan-room-target")) {
      target.classList.remove("active");
    }
    return;
  }
  const [x, y] = projectPlanPoint(plan, [cameraPose.position[0], cameraPose.position[2]]);
  const directionX = cameraPose.target[0] - cameraPose.position[0];
  const directionY = -(cameraPose.target[2] - cameraPose.position[2]);
  const rotation = Math.atan2(directionY, directionX) * 180 / Math.PI + 90;
  marker.toggleAttribute("hidden", false);
  marker.setAttribute("transform", `translate(${x} ${y}) rotate(${roundAngle(rotation)})`);
  byId("floorPlanPosition").textContent = locatedRoom
    ? `You are in ${locatedRoom.label}`
    : plan.label;
  for (const target of document.querySelectorAll<SVGGElement>(".floor-plan-room-target")) {
    target.classList.toggle("active", target.dataset.roomId === locatedRoom?.id);
  }
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

function roundAngle(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseCameraPose(value: string | null): CameraPose | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as CameraPose;
  } catch {
    return null;
  }
}

function setRendererCamera(cameraPose: CameraPose): Promise<CameraPose> {
  if (!rendererReady || !frame.contentWindow || frame.hidden) {
    return Promise.reject(new Error("Wait for the spatial scene to finish loading, then retry."));
  }
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cameraMoveRequests.delete(requestId);
      reject(new Error("The renderer did not confirm the room change. Retry this action."));
    }, 3_000);
    cameraMoveRequests.set(requestId, { resolve, reject, timeout });
    frame.contentWindow?.postMessage({
      source: "spatial-host",
      type: "set-camera",
      requestId,
      cameraPose,
    }, location.origin);
  });
}

function sendSpatialRuntime(): void {
  const spatial = activeManifest?.spatial;
  if (!spatial) return;
  frame.contentWindow?.postMessage({
    source: "spatial-host",
    type: "set-spatial-runtime",
    collisionBoxes: spatial.collisionProxy.boxes,
    navigationMesh: spatial.navigationMesh,
    obstacleBoxes: spatial.obstacleProxy?.boxes ?? [],
    navigationProfile: spatial.navigationProfile,
  }, location.origin);
}

function bindReviewInterface(): void {
  const form = byId<HTMLFormElement>("sceneReviewForm");
  const submit = form.querySelector<HTMLButtonElement>("[type='submit']")!;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    void runAction({
      key: "scene-review-comment",
      trigger: submit,
      form,
      pendingLabel: "Capturing this view…",
      errorTarget: byId<HTMLElement>("sceneReviewError"),
    }, () => submitSceneFeedback(formData));
  });
  const approve = byId<HTMLButtonElement>("approveReviewButton");
  approve.addEventListener("click", () => {
    void runAction({
      key: "scene-review-decision",
      trigger: approve,
      pendingLabel: "Approving…",
      disable: [byId<HTMLButtonElement>("requestChangesButton")],
      errorTarget: byId<HTMLElement>("sceneReviewError"),
    }, () => submitReviewDecision("approved"));
  });
  const requestChanges = byId<HTMLButtonElement>("requestChangesButton");
  requestChanges.addEventListener("click", () => {
    const note = prompt("Summarise the changes required. You can add anchored feedback separately.")?.trim();
    if (!note) return;
    void runAction({
      key: "scene-review-decision",
      trigger: requestChanges,
      pendingLabel: "Recording…",
      disable: [approve],
      errorTarget: byId<HTMLElement>("sceneReviewError"),
    }, () => submitReviewDecision("changes_requested", note));
  });
}

async function loadSceneReview(): Promise<void> {
  if (!activeManifest) return;
  try {
    activeReview = await api<SceneReview>(`/api/review/projects/${activeManifest.project.id}`);
    renderSceneReview();
  } catch (error) {
    byId("sceneReviewError").textContent = error instanceof Error
      ? `${error.message} Sign in through the review inbox, then retry this release.`
      : "Review access could not be loaded.";
  }
}

async function submitSceneFeedback(form: FormData): Promise<void> {
  if (!activeManifest) throw new Error("The immutable release is not ready.");
  byId("sceneReviewError").textContent = "";
  const pose = await captureCameraPose();
  await api(`/api/review/projects/${activeManifest.project.id}/versions/${activeManifest.project.versionId}/comments`, {
    method: "POST",
    body: JSON.stringify({
      clientOperationId: crypto.randomUUID(),
      kind: String(form.get("kind") ?? "comment"),
      body: String(form.get("body") ?? ""),
      cameraPose: pose,
    }),
  });
  byId<HTMLFormElement>("sceneReviewForm").reset();
  showToast("Feedback attached to this camera view");
  await loadSceneReview();
}

async function submitReviewDecision(decision: "approved" | "changes_requested", note?: string): Promise<void> {
  if (!activeManifest) throw new Error("The immutable release is not ready.");
  await api(`/api/review/projects/${activeManifest.project.id}/versions/${activeManifest.project.versionId}/decisions`, {
    method: "POST",
    body: JSON.stringify({ decision, note }),
  });
  showToast(decision === "approved" ? "Version approved" : "Changes requested");
  await loadSceneReview();
}

function captureCameraPose(): Promise<CameraPose> {
  if (!frame.contentWindow || frame.hidden) return Promise.reject(new Error("Wait for the scene to finish loading."));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cameraRequests.delete(requestId);
      reject(new Error("The renderer did not return the current camera. Retry after the scene is ready."));
    }, 5_000);
    cameraRequests.set(requestId, { resolve, reject, timeout });
    frame.contentWindow?.postMessage({ source: "spatial-host", type: "capture-camera", requestId }, location.origin);
  });
}

function renderSceneReview(): void {
  const container = byId("sceneReviewActivity");
  container.replaceChildren();
  if (!activeReview || (!activeReview.comments.length && !activeReview.decisions.length)) {
    container.append(document.createTextNode("No feedback has been recorded for this project."));
    return;
  }
  for (const comment of activeReview.comments.slice(0, 6)) {
    const row = document.createElement("div");
    row.className = "scene-review-line";
    row.textContent = `${comment.kind === "redaction" ? "Redaction" : "Comment"} | ${comment.status}: ${comment.body}`;
    container.append(row);
  }
  for (const decision of activeReview.decisions.slice(0, 3)) {
    const row = document.createElement("div");
    row.className = `scene-review-line ${decision.decision}`;
    row.textContent = `${decision.decision === "approved" ? "Approved" : "Changes requested"}${decision.note ? `: ${decision.note}` : ""}`;
    container.append(row);
  }
}

function releaseSlug(): string | null {
  const match = location.pathname.match(/^\/(?:s|review)\/([a-z0-9-]+)\/?$/);
  return match?.[1] ?? null;
}

function setLoading(visible: boolean, detail = "", progress?: number): void {
  loading.classList.toggle("hidden", !visible);
  if (detail) byId("loadingDetail").textContent = detail;
  const boundedProgress = Number.isFinite(progress)
    ? Math.min(100, Math.max(0, Number(progress)))
    : 14;
  byId<HTMLElement>("progressBar").style.width = visible ? `${boundedProgress}%` : "100%";
}

function showError(title: string, message: string): void {
  if (loadTimeout !== null) window.clearTimeout(loadTimeout);
  rendererReady = false;
  setNavigatorReady(false);
  byId("viewport").classList.remove("mobile-free-roam-active");
  byId("viewport").classList.remove("mobile-controls-onboarding");
  byId("viewport").classList.remove("renderer-help-open");
  byId<HTMLElement>("viewport").style.removeProperty("--renderer-help-height");
  setLoading(false);
  byId<HTMLElement>("viewerHud").hidden = true;
  frame.classList.add("is-loading");
  frame.hidden = true;
  errorPanel.hidden = false;
  byId("errorTitle").textContent = title;
  byId("errorMessage").textContent = message;
  byId("rendererStatus").textContent = "Scene unavailable";
}

async function shareCurrentUrl(): Promise<void> {
  try {
    if (navigator.share) {
      await navigator.share({ title: document.title, url: location.href });
      showToast("Share sheet opened");
    } else {
      await navigator.clipboard.writeText(location.href);
      showToast("Release link copied");
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      showToast("Share cancelled");
      return;
    }
    try {
      await navigator.clipboard.writeText(location.href);
      showToast("Release link copied");
    } catch {
      showToast("Could not share the link. Copy it from the address bar.");
    }
  }
}

async function recordTelemetry(
  eventType: "viewer_open" | "renderer_ready" | "renderer_error" | "time_to_first_frame",
  metricValue?: number,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  if (!activeManifest) return;
  try {
    await api<void>("/api/telemetry", {
      method: "POST",
      body: JSON.stringify({
        releaseId: activeManifest.release.id,
        eventType,
        sessionId: viewerSessionId,
        deviceProfile,
        metricValue,
        metadata,
      }),
    });
  } catch {
    // Telemetry must never block or break the viewer.
  }
}

function detectDeviceProfile(): string {
  const memory = "deviceMemory" in navigator && typeof navigator.deviceMemory === "number" ? navigator.deviceMemory : null;
  const mobile = matchMedia("(pointer: coarse)").matches || innerWidth < 760;
  if (mobile && memory !== null && memory <= 4) return "mobile-lite";
  if (mobile) return "mobile-standard";
  if (memory !== null && memory >= 8) return "desktop-high";
  return "desktop-standard";
}

function deviceBudget(profile: string): number {
  if (profile === "mobile-lite") return 0.75;
  if (profile === "mobile-standard") return 1.25;
  if (profile === "desktop-high") return 4;
  return 2;
}

function manifestBudget(manifest: ReleaseManifest): number {
  const policy = manifest.deliveryPolicy;
  if (!policy || !policy.adaptive_quality) return deviceBudget(deviceProfile);
  if (deviceProfile === "mobile-lite") return policy.mobile_lite_budget;
  if (deviceProfile === "mobile-standard") return policy.mobile_standard_budget;
  if (deviceProfile === "desktop-high") return policy.desktop_high_budget;
  return policy.desktop_standard_budget;
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2200);
}

type WorkflowStage = {
  kicker: string;
  title: string;
  body: string;
  output: string;
};

const workflowStages: WorkflowStage[] = [
  {
    kicker: "Source quality",
    title: "Record the place with context.",
    body: "Capture geometry, imagery, trajectories, access boundaries, and project control in one traceable source package.",
    output: "Raw scan, images, poses, point cloud, control context",
  },
  {
    kicker: "Reconstruction",
    title: "Build appearance and geometry.",
    body: "Reconstruct the photoreal scene, preserve metric geometry, remove transient artefacts, and record the processing recipe.",
    output: "Quality splat master, E57 or LAZ geometry, QA evidence",
  },
  {
    kicker: "Spatial semantics",
    title: "Give the place structure.",
    body: "Define floors, rooms, doors, routes, collision, points of interest, privacy regions, and measurement status.",
    output: "Scene manifest, collision mesh, navigation, room graph",
  },
  {
    kicker: "Delivery lifecycle",
    title: "Publish the right derivative.",
    body: "Generate device-aware web assets, approve an immutable release, control access, observe performance, and keep version history.",
    output: "Spark RAD, SPZ or SOG, public or private release",
  },
];

function initialiseMarketingPage(): void {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealElements = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
  if (!reducedMotion) document.body.classList.add("motion-ready");
  if (reducedMotion || !("IntersectionObserver" in window)) {
    for (const element of revealElements) element.classList.add("is-visible");
  } else {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -10% 0px" });
    for (const element of revealElements) observer.observe(element);
  }

  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".workflow-tabs [role='tab']"));
  const content = byId<HTMLElement>("workflowContent");
  let activeIndex = 0;

  const renderStage = (index: number): void => {
    const stage = workflowStages[index];
    if (!stage) return;
    byId("workflowKicker").textContent = stage.kicker;
    byId("workflowTitle").textContent = stage.title;
    byId("workflowBody").textContent = stage.body;
    byId("workflowOutput").textContent = stage.output;
    for (const [tabIndex, tab] of tabs.entries()) {
      const selected = tabIndex === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    activeIndex = index;
  };

  const selectStage = async (index: number): Promise<void> => {
    if (index === activeIndex || !workflowStages[index]) return;
    if (reducedMotion || !content.animate) {
      renderStage(index);
      return;
    }
    const exit = content.animate([
      { opacity: 1, transform: "translateY(0)" },
      { opacity: 0, transform: "translateY(-6px)" },
    ], {
      duration: 100,
      easing: "cubic-bezier(0.4, 0, 1, 1)",
      fill: "forwards",
    });
    await exit.finished;
    renderStage(index);
    content.animate([
      { opacity: 0, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], {
      duration: 220,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "forwards",
    });
  };

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => void selectStage(index));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (activeIndex + direction + tabs.length) % tabs.length;
      tabs[nextIndex]?.focus();
      void selectStage(nextIndex);
    });
  }
}
