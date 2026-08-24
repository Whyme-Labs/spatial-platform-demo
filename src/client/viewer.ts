import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import { api, ApiError } from "./api";
import { runAction, SingleFlight } from "./action-state";
import {
  bindFormFeedback,
  clearActionFeedback,
  showActionFailure,
} from "./feedback";
import { resolveDeviceProfile } from "./device-profile";
import {
  buildFloorPlans,
  cameraPoseForPlanRoom,
  floorPlanDisplayLabel,
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
  "Space",
  "KeyE",
  "KeyC",
  "KeyQ",
  "ShiftLeft",
  "ShiftRight",
]);
const forwardedViewerKeys = new Set<string>();

type ReleaseManifest = {
  schemaVersion: string;
  release: {
    id: string;
    number: number;
    slug: string;
    publishedAt: string;
    expiresAt: string | null;
    accessPolicy: string;
    workflowPolicyRevisionId: string | null;
  };
  project: {
    id: string;
    versionId: string;
    versionNumber: number;
    name: string;
    captureAdapter: string;
    provenance: unknown;
  };
  scene: {
    assetId: string;
    sha256: string | null;
    format: string;
    contentUrl: string;
    posterUrl: string | null;
    collisionUrl?: string | null;
    detourUrl?: string | null;
    navMeshUrl?: string | null;
    sizeBytes: number;
    etag: string | null;
  };
  viewer: {
    title: string;
    subtitle?: string;
    captureDate?: string;
    measurementDisclaimer: string;
    splatBudgetMillions?: number | null;
    defaultMovementMode?: "walk" | "fly";
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
    navigationArtifact?: Record<string, unknown> | null;
    navigationAssets?: {
      buildId: string;
      authoringHash: string;
      artifact: { assetId: string; format: "json"; sha256: string; sizeBytes: number };
      detour: { assetId: string; format: "bin"; sha256: string; sizeBytes: number };
    } | null;
  };
  deliveryPolicy?: {
    adaptive_quality: number;
    mobile_lite_budget: number;
    mobile_standard_budget: number;
    desktop_standard_budget: number;
    desktop_high_budget: number;
    max_initial_bytes: number;
  };
  integrity?: {
    assetSha256?: string | null;
    sessionId?: string;
    sessionExpiresAt?: string;
    sessionHardExpiresAt?: string;
    sessionRenewalPath?: string;
  };
};

type SceneRenderSession = {
  token: string;
  // A private preview mints a non-renewable token, so the viewer only tracks
  // its deadline and reports the expiry when it arrives.
  renewalPath: string | null;
  expiresAtMs: number;
  hardExpiresAtMs: number;
};

type SceneSessionRenewal = {
  token: string;
  expiresAtEpochSeconds: number;
  sessionExpiresAt: string;
  sessionHardExpiresAt: string;
  renewalPath: string;
};

type SpatialEntity = NonNullable<ReleaseManifest["spatial"]>["entities"][number];
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
      type: "heartbeat";
    }
  | {
      source: "spatial-spark";
      type: "movement-blocked";
      message: string;
      cause: { kind: string; id: string | null };
      position: [number, number, number];
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
      type: "control-help";
      visible: boolean;
      height: number;
    }
  | {
      source: "spatial-spark";
      type: "authored-traversal-state";
      connectionId: string;
      traversalKind: "elevator" | "ladder" | "moving_platform";
      label: string;
      phase: "started" | "completed" | "blocked";
      qualification: {
        adapter: string;
        manifestSha256: string;
        reviewGeneration: number;
        registrationSha256: string;
      } | null;
      message?: string;
    }
  | {
      source: "spatial-spark";
      type: "dynamic-barrier-state";
      requestId: string;
      barrierId: string;
      active: boolean;
      accepted: boolean;
      message: string;
    };

type ViewerTelemetryEvent = {
  releaseId: string;
  eventType:
    | "viewer_open"
    | "renderer_ready"
    | "renderer_error"
    | "time_to_first_frame"
    | "navigation_traversal";
  deviceProfile: string;
  metricValue?: number;
  metadata: Record<string, string | number | boolean | null>;
};

type ViewerTelemetrySession = {
  sessionId: string;
  token: string;
  expiresAtEpochSeconds: number;
};
type SpatialRendererMessage = SparkRendererMessage;

const byId = <T extends Element = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as unknown as T;
};

// A published scene keeps loading for as long as the renderer keeps reporting
// progress. Once nothing at all arrives for this long the infinite spinner is
// replaced by a retryable error instead of a viewer that never resolves.
const LOADING_WATCHDOG_MS = 90_000;
// Renewal and the watchdog share one short tick. Long timers are throttled and
// coalesced in background tabs, so every deadline is compared against the wall
// clock rather than trusted to fire on time.
const VIEWER_TICK_MS = 1_000;
const SESSION_RENEWAL_FRACTION = 0.6;
const SESSION_RENEWAL_RETRY_MS = 15_000;
const SESSION_RENEWAL_MAX_FAILURES = 3;
const POSTER_FADE_MS = 400;
// A ready renderer heartbeats every few seconds, so thirty silent seconds in a
// visible tab means the iframe's process is gone (mobile OOM kill, GPU-process
// death) — states that fire no webglcontextlost and would otherwise leave a
// frozen canvas behind a healthy-looking viewer.
const RENDERER_LIVENESS_TIMEOUT_MS = 30_000;

// A token release strips its `access_token` from the address bar after the
// first authorised manifest load, so continuity across reloads lives in
// sessionStorage — deliberately not localStorage: access ends with the tab
// session instead of persisting on a shared machine.
const RELEASE_ACCESS_STORAGE_PREFIX = "release-access:";

const frame = byId<HTMLIFrameElement>("rendererFrame");
const loading = byId<HTMLElement>("loadingOverlay");
const errorPanel = byId<HTMLElement>("errorPanel");
const releaseInfo = byId<HTMLElement>("releaseInfo");
const toast = byId<HTMLElement>("toast");
const deviceProfile = detectDeviceProfile();
const viewerSessionId = crypto.randomUUID();
const activeReleaseSlug = releaseSlug();
const activePrivatePreview = privatePreviewRoute();
const viewerActions = new SingleFlight();
let activeManifest: ReleaseManifest | null = null;
let traversalTelemetrySession: ViewerTelemetrySession | null = null;
let telemetryDelivery = Promise.resolve();
let activeReview: SceneReview | null = null;
let activeFloorPlans: FloorPlan[] = [];
let activeFloorPlanId: string | null = null;
let latestCameraPose: CameraPose | null = null;
let rendererReady = false;
let sceneSession: SceneRenderSession | null = null;
let sceneSessionRenewAtMs = Number.POSITIVE_INFINITY;
let sceneSessionFailures = 0;
let sceneSessionExpiryShown = false;
let loadingWatchdogAtMs: number | null = null;
let rendererLivenessAtMs: number | null = null;
// An access code typed into the unavailable panel; consumed by the next
// manifest load and kept out of the URL, telemetry, and logs.
let pendingAccessCode: string | null = null;
let viewerWasHidden = document.hidden;
let viewerTickHandle: number | null = null;
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
const dynamicBarrierRequests = new Map<string, {
  resolve: (state: { barrierId: string; active: boolean; message: string }) => void;
  reject: (error: Error) => void;
  timeout: number;
}>();
const activeDynamicBarriers = new Map<string, boolean>();
const reviewMode = location.pathname.startsWith("/review/");

if (activeReleaseSlug || activePrivatePreview) {
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
  const accessCodeForm = byId<HTMLFormElement>("accessCodeForm");
  bindFormFeedback(accessCodeForm);
  accessCodeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const submitted = new FormData(accessCodeForm).get("accessCode");
    const accessCode = typeof submitted === "string" ? submitted.trim() : "";
    if (!accessCode) return;
    pendingAccessCode = accessCode;
    void runAction({
      key: "retry-release",
      trigger: byId<HTMLButtonElement>("accessCodeSubmit"),
      pendingLabel: "Unlocking…",
      form: accessCodeForm,
      errorTarget: byId<HTMLElement>("accessCodeError"),
    }, loadPublishedRelease);
  });
  window.addEventListener("message", handleRendererMessage);
  bindViewerLifecycle();
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
  const slug = activeReleaseSlug;
  if (!slug && !activePrivatePreview) return;
  for (const [requestId, pending] of dynamicBarrierRequests) {
    window.clearTimeout(pending.timeout);
    pending.reject(new Error("The scene reloaded before the door state was applied."));
    dynamicBarrierRequests.delete(requestId);
  }
  activeDynamicBarriers.clear();
  setLoading(true, activePrivatePreview ? "Authorising private walkable preview…" : "Authorising scene release…");
  rendererReady = false;
  rendererLivenessAtMs = null;
  sceneSession = null;
  sceneSessionRenewAtMs = Number.POSITIVE_INFINITY;
  sceneSessionFailures = 0;
  sceneSessionExpiryShown = false;
  armLoadingWatchdog();
  setNavigatorReady(false);
  byId("viewport").classList.remove("mobile-free-roam-active");
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
  const urlToken = new URL(location.href).searchParams.get("access_token");
  const typedCode = pendingAccessCode;
  pendingAccessCode = null;
  const storedToken = !urlToken && !typedCode && slug ? storedAccessToken(slug) : null;
  const accessToken = urlToken ?? typedCode ?? storedToken;
  try {
    const query = accessToken
      ? `?access_token=${encodeURIComponent(accessToken)}`
      : "";
    const manifest = activePrivatePreview
      ? (await api<{ manifest: ReleaseManifest }>(
          `/api/projects/${encodeURIComponent(activePrivatePreview.projectId)}/versions/${encodeURIComponent(activePrivatePreview.versionId)}/preview`,
        )).manifest
      : await api<ReleaseManifest>(`/api/releases/${encodeURIComponent(slug!)}/manifest${query}`);
    activeManifest = manifest;
    if (accessToken && slug) storeAccessToken(slug, accessToken);
    if (urlToken) {
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete("access_token");
      history.replaceState({}, "", cleanUrl);
    }
    byId<HTMLFormElement>("accessCodeForm").reset();
    adoptSceneRenderSession(manifest);
    applyManifest(manifest);
    if (reviewMode) await loadSceneReview();
    void recordTelemetry("viewer_open");
    const rendererUrl = publishedRendererUrl(manifest);
    frame.src = rendererUrl.toString();
    frame.hidden = false;
  } catch (error) {
    if (!activePrivatePreview && error instanceof ApiError && error.status === 401) {
      // A stored token can lapse when the release is republished with a fresh
      // token; drop it so the next attempt prompts instead of looping.
      if (storedToken && slug) clearStoredAccessToken(slug);
      showAccessRequired(error, Boolean(urlToken ?? typedCode));
      return;
    }
    showError("This spatial release is unavailable.", error instanceof Error ? error.message : "The release could not be authorised.");
  }
}

frame.addEventListener("load", () => {
  if (!activeManifest) return;
  if (rendererReady) return;
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
  // The liveness watchdog arms on the first post-ready heartbeat — a renderer
  // that never heartbeats is never misread as dead — and any later message
  // proves the frame is still alive.
  if (rendererReady && (rendererLivenessAtMs !== null || message.type === "heartbeat")) {
    rendererLivenessAtMs = Date.now() + RENDERER_LIVENESS_TIMEOUT_MS;
  }
  if (message.type === "heartbeat") return;
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
  // Someone pressing forward and going nowhere deserves to know why, in the
  // scene they were given rather than only in the studio that produced it.
  // The renderer's own hint is transient; this line holds the last verdict.
  if (message.type === "movement-blocked") {
    const readout = document.getElementById("viewerBlockedReason");
    if (readout) {
      readout.textContent = message.message;
      readout.hidden = !message.message;
    }
    return;
  }
  if (message.type === "authored-traversal-state") {
    void recordTelemetry("navigation_traversal", undefined, {
      connectionId: message.connectionId,
      phase: message.phase,
    });
    return;
  }
  if (message.type === "dynamic-barrier-state") {
    const pending = dynamicBarrierRequests.get(message.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    dynamicBarrierRequests.delete(message.requestId);
    if (!message.accepted) {
      pending.reject(new Error(message.message));
      return;
    }
    activeDynamicBarriers.set(message.barrierId, message.active);
    pending.resolve({
      barrierId: message.barrierId,
      active: message.active,
      message: message.message,
    });
    return;
  }
  if (message.source === "spatial-spark" && message.type === "control-mode") {
    byId("viewport").classList.toggle("mobile-free-roam-active", message.mode === "free-roam");
    return;
  }
  if (message.type === "control-help") {
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
    armLoadingWatchdog();
    setLoading(true, message.detail, message.progress);
    byId("rendererStatus").textContent = message.detail;
    return;
  }
  if (message.type === "error") {
    showError("Spark could not render this release.", message.message);
    void recordTelemetry("renderer_error", undefined, {
      reason: message.code,
      runtime: "spark",
    });
    return;
  }
  if (message.type !== "ready") return;
  loadingWatchdogAtMs = null;
  errorPanel.hidden = true;
  frame.hidden = false;
  frame.classList.remove("is-loading");
  fadeScenePoster();
  setLoading(false);
  rendererReady = true;
  byId<HTMLElement>("viewerHud").hidden = false;
  releaseInfo.hidden = false;
  byId("reviewPanel").hidden = !reviewMode;
  setNavigatorReady(true);
  byId("rendererStatus").textContent = "Scene ready";
  // A session renewed while the renderer was still loading never reached it, so
  // ready replays the current token; the renderer applies it idempotently.
  if (sceneSession) sendSceneTokenRefresh();
  // The runtime payload is sent once, on iframe load: the renderer cannot even
  // reach "ready" before it has rebuilt physics and navigation from that
  // payload, so re-sending here only forces a redundant collision download.
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
  return source === "spatial-spark" &&
    (type === "progress" || type === "ready" || type === "error" || type === "camera" ||
      type === "camera-update" || type === "camera-set" || type === "control-mode" ||
      type === "control-help" || type === "heartbeat" ||
      type === "authored-traversal-state" || type === "dynamic-barrier-state");
}

function bindViewerLifecycle(): void {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // iOS Safari can freeze a hidden page before a single interval tick
      // observes the hidden state, so the transition itself must record it —
      // the resume tick depends on it to forgive the frozen silence.
      viewerWasHidden = true;
      return;
    }
    viewerTick();
  });
  if (viewerTickHandle === null) {
    viewerTickHandle = window.setInterval(viewerTick, VIEWER_TICK_MS);
  }
}

function viewerTick(): void {
  const now = Date.now();
  // A suspended tab (iOS page freeze, Chrome intensive throttling) runs no
  // ticks while hidden, so the first visible tick after resume can observe a
  // deadline that went stale during legitimately silent background time —
  // before any queued heartbeat from the live renderer is processed. The
  // hidden→visible transition therefore re-arms both watchdogs before any
  // expiry is evaluated: silence only counts against a deadline armed while
  // the tab was continuously visible.
  const resumed = viewerWasHidden && !document.hidden;
  viewerWasHidden = document.hidden;
  if (loadingWatchdogAtMs !== null) {
    // A hidden tab pauses the renderer's frame loop, so the scene cannot report
    // progress or reach its first frame. That silence is not a stall.
    if (document.hidden || resumed) armLoadingWatchdog();
    else if (now >= loadingWatchdogAtMs) failStalledLoading();
  }
  if (rendererReady && rendererLivenessAtMs !== null) {
    // A hidden tab throttles the renderer's heartbeat timer to a crawl, so
    // silence while hidden is expected, exactly like the loading watchdog.
    if (document.hidden || resumed) rendererLivenessAtMs = now + RENDERER_LIVENESS_TIMEOUT_MS;
    else if (now >= rendererLivenessAtMs) failDeadRenderer();
  }
  if (document.hidden || !sceneSession || sceneSessionExpiryShown) return;
  if (viewerActions.isPending("renew-scene-session")) return;
  if (now >= sceneSession.hardExpiresAtMs || now >= sceneSession.expiresAtMs) {
    showSessionExpired();
    return;
  }
  if (now >= sceneSessionRenewAtMs) void renewSceneRenderSession();
}

function armLoadingWatchdog(): void {
  if (rendererReady) return;
  loadingWatchdogAtMs = Date.now() + LOADING_WATCHDOG_MS;
}

function failStalledLoading(): void {
  loadingWatchdogAtMs = null;
  showError(
    "This scene stopped responding while loading.",
    "The renderer reported no progress for 90 seconds. Retry to reload the scene, or reopen it on a faster connection.",
  );
  void recordTelemetry("renderer_error", undefined, { reason: "loading_watchdog" });
}

function failDeadRenderer(): void {
  rendererLivenessAtMs = null;
  showError(
    "This scene stopped responding.",
    "The renderer went silent for 30 seconds while the tab was visible. Retry to reload the scene.",
  );
  void recordTelemetry("renderer_error", undefined, { reason: "renderer_liveness_watchdog" });
}

// The scene token embedded in every asset URL expires with its render session.
// Reading the manifest expiry lets the viewer renew ahead of that deadline and,
// when renewal is impossible, say so instead of letting paged asset reads fail
// as unexplained 401s inside the renderer.
function adoptSceneRenderSession(manifest: ReleaseManifest): void {
  const expiresAtMs = parseTimestamp(manifest.integrity?.sessionExpiresAt);
  const token = sceneTokenFromManifest(manifest);
  // A fully public release carries no token on any asset URL, so nothing about
  // this manifest can expire and there is no session to track.
  if (!expiresAtMs || !token) {
    sceneSession = null;
    sceneSessionRenewAtMs = Number.POSITIVE_INFINITY;
    return;
  }
  sceneSession = {
    token,
    renewalPath: manifest.integrity?.sessionRenewalPath ?? null,
    expiresAtMs,
    hardExpiresAtMs: parseTimestamp(manifest.integrity?.sessionHardExpiresAt) ?? expiresAtMs,
  };
  scheduleSceneSessionRenewal();
}

function scheduleSceneSessionRenewal(): void {
  if (!sceneSession?.renewalPath) {
    sceneSessionRenewAtMs = Number.POSITIVE_INFINITY;
    return;
  }
  const now = Date.now();
  const remaining = Math.max(0, sceneSession.expiresAtMs - now);
  sceneSessionRenewAtMs = now + Math.floor(remaining * SESSION_RENEWAL_FRACTION);
}

async function renewSceneRenderSession(): Promise<void> {
  const session = sceneSession;
  if (!session?.renewalPath) return;
  const renewalPath = session.renewalPath;
  await viewerActions.run("renew-scene-session", async () => {
    try {
      // A scene token is not an account session. Renewal deliberately bypasses
      // the shared API client so a rejected scene token can never be mistaken
      // for an expired sign-in and sign a reviewer out of the studio.
      const response = await fetch(renewalPath, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: session.token }),
      });
      if (response.status === 401 || response.status === 410) {
        showSessionExpired();
        return;
      }
      if (!response.ok) {
        throw new Error(`The scene session renewal failed with status ${response.status}.`);
      }
      const renewed = await response.json() as SceneSessionRenewal;
      const expiresAtMs = parseTimestamp(renewed.sessionExpiresAt);
      if (!expiresAtMs) throw new Error("The renewed scene session has no expiry.");
      sceneSessionFailures = 0;
      sceneSession = {
        token: renewed.token,
        renewalPath: renewed.renewalPath || renewalPath,
        expiresAtMs,
        hardExpiresAtMs: parseTimestamp(renewed.sessionHardExpiresAt) ?? session.hardExpiresAtMs,
      };
      applyRenewedSceneToken(renewed.token);
      scheduleSceneSessionRenewal();
    } catch {
      // A transient network failure is retried; repeated failures leave the
      // viewer holding a token it can no longer prove is live.
      sceneSessionFailures += 1;
      if (sceneSessionFailures >= SESSION_RENEWAL_MAX_FAILURES) {
        showSessionExpired();
        return;
      }
      sceneSessionRenewAtMs = Date.now() + SESSION_RENEWAL_RETRY_MS;
    }
  });
}

function applyRenewedSceneToken(token: string): void {
  if (!activeManifest) return;
  const scene = activeManifest.scene;
  scene.contentUrl = withSceneToken(scene.contentUrl, token);
  scene.posterUrl = withSceneToken(scene.posterUrl, token);
  scene.collisionUrl = withSceneToken(scene.collisionUrl, token);
  scene.detourUrl = withSceneToken(scene.detourUrl, token);
  scene.navMeshUrl = withSceneToken(scene.navMeshUrl, token);
  sendSceneTokenRefresh();
}

// The iframe src embeds the token minted with the manifest, and a paged scene
// keeps issuing ranged tile fetches long after that. A renewed token must
// therefore reach the running renderer or its streaming fetches start failing
// the moment the original token expires. Pre-ready renewals are replayed when
// ready arrives; the renderer ignores the message until then.
function sendSceneTokenRefresh(): void {
  const scene = activeManifest?.scene;
  if (!scene || !rendererReady) return;
  frame.contentWindow?.postMessage({
    source: "spatial-host",
    type: "refresh-scene-tokens",
    contentUrl: scene.contentUrl,
    collisionUrl: scene.collisionUrl ?? null,
    detourUrl: scene.detourUrl ?? null,
    navMeshUrl: scene.navMeshUrl ?? null,
  }, location.origin);
}

function withSceneToken<T extends string | null | undefined>(url: T, token: string): T {
  if (!url) return url;
  const next = new URL(url, location.origin);
  if (!next.searchParams.has("token")) return url;
  next.searchParams.set("token", token);
  return `${next.pathname}${next.search}` as T;
}

function sceneTokenFromManifest(manifest: ReleaseManifest): string | null {
  for (const url of [
    manifest.scene.contentUrl,
    manifest.scene.collisionUrl,
    manifest.scene.detourUrl,
    manifest.scene.posterUrl,
  ]) {
    if (!url) continue;
    const token = new URL(url, location.origin).searchParams.get("token");
    if (token) return token;
  }
  return null;
}

function showSessionExpired(): void {
  if (sceneSessionExpiryShown) return;
  sceneSessionExpiryShown = true;
  sceneSession = null;
  sceneSessionRenewAtMs = Number.POSITIVE_INFINITY;
  showError(
    "This viewing session expired.",
    "Scene assets are no longer authorised for this tab. Retry to authorise a new session and reload the scene.",
  );
  void recordTelemetry("renderer_error", undefined, { reason: "scene_session_expired" });
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function showScenePoster(posterUrl: string | null): void {
  const poster = byId<HTMLImageElement>("scenePoster");
  poster.classList.remove("is-faded");
  if (!posterUrl) {
    poster.hidden = true;
    poster.removeAttribute("src");
    return;
  }
  poster.src = posterUrl;
  poster.hidden = false;
}

function fadeScenePoster(): void {
  const poster = byId<HTMLImageElement>("scenePoster");
  if (poster.hidden) return;
  poster.classList.add("is-faded");
  window.setTimeout(() => {
    if (!poster.classList.contains("is-faded")) return;
    poster.hidden = true;
    poster.removeAttribute("src");
  }, POSTER_FADE_MS);
}

function publishedRendererUrl(manifest: ReleaseManifest): URL {
  // An operator budget wins; a release published without one carries null so the
  // device and delivery-policy budget below is what actually reaches the scene.
  const budget = manifest.viewer.splatBudgetMillions ?? manifestBudget(manifest);
  const rendererUrl = new URL("/renderer/index.html", location.origin);
  rendererUrl.searchParams.set("content", manifest.scene.contentUrl);
  rendererUrl.searchParams.set("format", manifest.scene.format);
  rendererUrl.searchParams.set("budget", String(budget));
  // An operator budget can raise splat density, but the non-paged download
  // ceiling stays a device decision, so the profile travels separately.
  rendererUrl.searchParams.set("profile", deviceProfile);
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

function applyManifest(manifest: ReleaseManifest): void {
  showScenePoster(manifest.scene.posterUrl);
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
    forwardedViewerKeys.add(event.code);
    sendViewerMovementKey(event.code, true);
    event.preventDefault();
  });
  window.addEventListener("keyup", (event) => {
    if (!rendererReady || !forwardedViewerKeys.delete(event.code)) return;
    sendViewerMovementKey(event.code, false);
    event.preventDefault();
  });
  window.addEventListener("blur", () => {
    forwardedViewerKeys.clear();
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
    target instanceof HTMLSelectElement ||
    target.closest("button, a[href], [role='button'], [role='link']") !== null;
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

function hasSpatialNavigation(
  manifest: ReleaseManifest | null,
  floorPlans: FloorPlan[],
): boolean {
  const spatial = manifest?.spatial;
  return Boolean(
    floorPlans.length ||
    spatial?.routes.length ||
    dynamicBarriersFromManifest(manifest).length ||
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
  renderDynamicBarrierControls(manifest);
  const trigger = byId<HTMLButtonElement>("openNavigator");
  if (!hasSpatialNavigation(manifest, activeFloorPlans)) {
    trigger.hidden = true;
    setViewerHudMode("collapsed");
    return;
  }
  trigger.hidden = false;
  byId("navigatorTriggerLabel").textContent = routes.length ? "Start guided visit" : "Explore rooms";
  const roomDirectory = byId("roomDirectory");
  roomDirectory.replaceChildren();
  const floorPlanEntities = activeFloorPlans
    .flatMap((plan) => plan.rooms)
    .map((room) => spatial?.entities.find((entity) => entity.id === room.id))
    .filter((entity): entity is SpatialEntity => Boolean(entity));
  const directoryRooms = rooms.length ? rooms : floorPlanEntities;
  for (const [index, room] of directoryRooms.entries()) {
    const button = document.createElement("button");
    button.className = "navigator-item";
    button.type = "button";
    button.textContent = floorPlanDisplayLabel(room.label, index, directoryRooms.length) === room.label
      ? room.label
      : `${index + 1}. ${room.label}`;
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

type ViewerDynamicBarrier = {
  id: string;
  defaultActive: boolean;
};

function dynamicBarriersFromManifest(manifest: ReleaseManifest | null): ViewerDynamicBarrier[] {
  const artifact = manifest?.spatial?.navigationArtifact;
  if (!artifact || typeof artifact !== "object") return [];
  const raw = Reflect.get(artifact, "dynamicBarriers");
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const id = typeof Reflect.get(value, "id") === "string"
      ? String(Reflect.get(value, "id"))
      : "";
    const defaultActive = Reflect.get(value, "defaultActive");
    if (!id || ids.has(id) || typeof defaultActive !== "boolean") return [];
    ids.add(id);
    return [{ id, defaultActive }];
  });
}

function renderDynamicBarrierControls(manifest: ReleaseManifest): void {
  const section = byId<HTMLElement>("dynamicBarrierSection");
  const list = byId<HTMLElement>("dynamicBarrierList");
  const barriers = dynamicBarriersFromManifest(manifest);
  const currentIds = new Set(barriers.map((barrier) => barrier.id));
  for (const id of activeDynamicBarriers.keys()) {
    if (!currentIds.has(id)) activeDynamicBarriers.delete(id);
  }
  list.replaceChildren();
  section.hidden = barriers.length === 0;
  for (const barrier of barriers) {
    if (!activeDynamicBarriers.has(barrier.id)) {
      activeDynamicBarriers.set(barrier.id, barrier.defaultActive);
    }
    const row = document.createElement("div");
    row.className = "dynamic-barrier-row";
    const copy = document.createElement("div");
    copy.className = "dynamic-barrier-copy";
    const label = document.createElement("strong");
    label.textContent = dynamicBarrierLabel(barrier.id);
    const state = document.createElement("span");
    const currentState = () => activeDynamicBarriers.get(barrier.id) === true;
    state.textContent = currentState() ? "Closed · route blocked" : "Open · route available";
    copy.append(label, state);
    const button = document.createElement("button");
    button.className = "dynamic-barrier-toggle";
    button.type = "button";
    button.disabled = !rendererReady;
    const idleLabel = () => currentState() ? "Open" : "Close";
    button.textContent = idleLabel();
    button.setAttribute("aria-label", `${idleLabel()} ${dynamicBarrierLabel(barrier.id)}`);
    button.addEventListener("click", () => {
      const requestedActive = !currentState();
      void runAction({
        key: `dynamic-barrier:${barrier.id}`,
        trigger: button,
        pendingLabel: requestedActive ? "Closing…" : "Opening…",
        idleLabel,
        errorTarget: byId<HTMLElement>("navigatorError"),
      }, async () => {
        const result = await setDynamicBarrierState(barrier.id, requestedActive);
        state.textContent = result.active ? "Closed · route blocked" : "Open · route available";
        button.setAttribute("aria-label", `${idleLabel()} ${dynamicBarrierLabel(barrier.id)}`);
        showToast(result.message);
      });
    });
    row.append(copy, button);
    list.append(row);
  }
}

function dynamicBarrierLabel(id: string): string {
  return id
    .replace(/^door[-_]?/i, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ") || "Authored door";
}

function setDynamicBarrierState(
  barrierId: string,
  active: boolean,
): Promise<{ barrierId: string; active: boolean; message: string }> {
  if (!rendererReady) return Promise.reject(new Error("The scene is not ready yet."));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      dynamicBarrierRequests.delete(requestId);
      reject(new Error("The door did not respond. Retry after the scene is ready."));
    }, 5_000);
    dynamicBarrierRequests.set(requestId, { resolve, reject, timeout });
    frame.contentWindow?.postMessage({
      source: "spatial-host",
      type: "set-dynamic-barrier-state",
      requestId,
      barrierId,
      active,
    }, location.origin);
  });
}

function cameraFromEntity(entity: SpatialEntity): CameraPose | null {
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
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".navigator-item, .dynamic-barrier-toggle",
  )) {
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
  for (const connector of projected.connectors) {
    const title = svgElement("title");
    title.textContent = connector.label;
    const path = svgElement("path");
    path.classList.add("floor-plan-connector");
    path.setAttribute("d", connector.path);
    path.append(title);
    roomsRoot.append(path);
  }
  for (const [index, projectedRoom] of projected.rooms.entries()) {
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
    const displayLabel = floorPlanDisplayLabel(
      projectedRoom.label,
      index,
      projected.rooms.length,
    );
    label.classList.toggle("is-index", displayLabel !== projectedRoom.label);
    label.setAttribute("x", String(projectedRoom.labelPosition[0]));
    label.setAttribute("y", String(projectedRoom.labelPosition[1]));
    label.textContent = displayLabel;
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
  frame.contentWindow?.postMessage({
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
    // Optional same-origin derivatives. A renderer that understands them streams
    // the navigation payload instead of decoding the inline copy; a release that
    // ships neither URL keeps working from the inline bytes alone.
    detourUrl: activeManifest?.scene.detourUrl ?? null,
    navMeshUrl: activeManifest?.scene.navMeshUrl ?? null,
    defaultMovementMode: activeManifest?.viewer.defaultMovementMode ?? "walk",
  }, location.origin);
}

function bindReviewInterface(): void {
  const form = byId<HTMLFormElement>("sceneReviewForm");
  bindFormFeedback(form);
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

function privatePreviewRoute(): { projectId: string; versionId: string } | null {
  const match = location.pathname.match(
    /^\/preview\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/?$/i,
  );
  return match?.[1] && match[2]
    ? { projectId: match[1], versionId: match[2] }
    : null;
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
  rendererReady = false;
  loadingWatchdogAtMs = null;
  rendererLivenessAtMs = null;
  setNavigatorReady(false);
  byId("viewport").classList.remove("mobile-free-roam-active");
  byId("viewport").classList.remove("renderer-help-open");
  byId<HTMLElement>("viewport").style.removeProperty("--renderer-help-height");
  setLoading(false);
  byId<HTMLElement>("viewerHud").hidden = true;
  frame.classList.add("is-loading");
  frame.hidden = true;
  errorPanel.hidden = false;
  byId("errorTitle").textContent = title;
  byId("errorMessage").textContent = message;
  // Non-auth failures keep the plain Retry affordance; the access-specific
  // affordances only appear through showAccessRequired.
  byId<HTMLFormElement>("accessCodeForm").hidden = true;
  byId<HTMLAnchorElement>("accessSignInLink").hidden = true;
  byId<HTMLButtonElement>("retryButton").hidden = false;
  byId("rendererStatus").textContent = "Scene unavailable";
}

// The unavailable panel for an access-denied manifest is recoverable: token
// releases prompt for the access code inline, customer-authenticated releases
// route to the existing sign-in. A wrong code re-prompts with an inline error
// instead of dead-ending; the entered code itself is never logged or reported.
function showAccessRequired(error: ApiError, rejectedCode: boolean): void {
  const accessPolicy = releaseAccessPolicy(error);
  showError(
    "This scene requires access",
    accessPolicy === "customer-authenticated"
      ? "This release is limited to invited customers. Sign in, then retry this link."
      : "Paste the access code from your invitation.",
  );
  const accessCodeForm = byId<HTMLFormElement>("accessCodeForm");
  const accessCodeSubmit = byId<HTMLButtonElement>("accessCodeSubmit");
  const accessCodeError = byId<HTMLElement>("accessCodeError");
  const signInLink = byId<HTMLAnchorElement>("accessSignInLink");
  const retryButton = byId<HTMLButtonElement>("retryButton");
  if (accessPolicy === "customer-authenticated") {
    clearActionFeedback(accessCodeError, {
      form: accessCodeForm,
      trigger: accessCodeSubmit,
    });
    signInLink.hidden = false;
    return;
  }
  accessCodeForm.hidden = false;
  // The tokenless Retry would repeat the same denied request forever.
  retryButton.hidden = true;
  if (rejectedCode) {
    showActionFailure(accessCodeError, error, {
      form: accessCodeForm,
      trigger: accessCodeSubmit,
      message: "That access code was not accepted. Check it against your invitation and try again.",
    });
  } else {
    clearActionFeedback(accessCodeError, {
      form: accessCodeForm,
      trigger: accessCodeSubmit,
    });
  }
  const codeInput = accessCodeForm.elements.namedItem("accessCode");
  if (codeInput instanceof HTMLInputElement) codeInput.focus();
}

function releaseAccessPolicy(error: ApiError): string | null {
  if (!error.details || typeof error.details !== "object") return null;
  const policy = (error.details as Record<string, unknown>).accessPolicy;
  return typeof policy === "string" ? policy : null;
}

function accessTokenStorageKey(slug: string): string {
  return `${RELEASE_ACCESS_STORAGE_PREFIX}${slug}`;
}

// sessionStorage can throw (storage disabled, private-mode quirks); access
// continuity then simply degrades to prompting again.
function storedAccessToken(slug: string): string | null {
  try {
    return sessionStorage.getItem(accessTokenStorageKey(slug));
  } catch {
    return null;
  }
}

function storeAccessToken(slug: string, token: string): void {
  try {
    sessionStorage.setItem(accessTokenStorageKey(slug), token);
  } catch {
    // Continuity is best-effort; the scene already loaded for this view.
  }
}

function clearStoredAccessToken(slug: string): void {
  try {
    sessionStorage.removeItem(accessTokenStorageKey(slug));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
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
  eventType:
    | "viewer_open"
    | "renderer_ready"
    | "renderer_error"
    | "time_to_first_frame"
    | "navigation_traversal",
  metricValue?: number,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  if (!activeManifest || activePrivatePreview) return;
  const event: ViewerTelemetryEvent = {
    releaseId: activeManifest.release.id,
    eventType,
    deviceProfile,
    ...(metricValue === undefined ? {} : { metricValue }),
    metadata,
  };
  if (eventType !== "navigation_traversal") {
    try {
      await api<void>("/api/telemetry", {
        method: "POST",
        body: JSON.stringify({ ...event, sessionId: viewerSessionId }),
      });
    } catch {
      // General delivery metrics never block or break the published viewer.
    }
    return;
  }
  if (!reviewMode) return;
  telemetryDelivery = telemetryDelivery
    .then(() => deliverTraversalTelemetry(event))
    .catch((error) => {
      console.warn("Viewer telemetry delivery failed", error);
      if (event.eventType === "navigation_traversal" && reviewMode) {
        showToast(
          "Traversal evidence was not recorded. Keep this device run in VALIDATE and retry.",
        );
      }
    });
  await telemetryDelivery;
}

async function deliverTraversalTelemetry(event: ViewerTelemetryEvent): Promise<void> {
  let session = await currentTraversalTelemetrySession();
  const send = (candidate: ViewerTelemetrySession) => api<void>("/api/telemetry", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${candidate.token}`,
    },
    body: JSON.stringify({ ...event, sessionId: candidate.sessionId }),
  });
  try {
    await send(session);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    session = await currentTraversalTelemetrySession(true);
    await send(session);
  }
}

async function currentTraversalTelemetrySession(
  renew = false,
): Promise<ViewerTelemetrySession> {
  if (
    !renew && traversalTelemetrySession &&
    traversalTelemetrySession.expiresAtEpochSeconds > Math.floor(Date.now() / 1000)
  ) return traversalTelemetrySession;
  if (!activeReleaseSlug) throw new Error("The active release slug is unavailable");
  if (!activeManifest) throw new Error("The active release manifest is unavailable");
  const releaseId = activeManifest.release.id;
  const requestSession = async (sessionId?: string): Promise<ViewerTelemetrySession> =>
    api<ViewerTelemetrySession>(
      `/api/releases/${encodeURIComponent(activeReleaseSlug)}/telemetry-session`,
      {
        method: "POST",
        body: JSON.stringify({
          releaseId,
          ...(sessionId ? { sessionId } : {}),
        }),
      },
    );
  const previousSessionId = traversalTelemetrySession?.sessionId;
  try {
    traversalTelemetrySession = await requestSession(previousSessionId);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 410 || !previousSessionId) throw error;
    traversalTelemetrySession = null;
    traversalTelemetrySession = await requestSession();
  }
  return traversalTelemetrySession;
}

function detectDeviceProfile(): string {
  const memory = "deviceMemory" in navigator && typeof navigator.deviceMemory === "number" ? navigator.deviceMemory : null;
  const mobile = matchMedia("(pointer: coarse)").matches || innerWidth < 760;
  return resolveDeviceProfile({ mobile, deviceMemoryGb: memory });
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
    title: "Give the place physical rules.",
    body: "Review floors, walls, ceilings, doors, furniture groups, room anchors, and movement profiles independently from the splat.",
    output: "Structural shell, Rapier collision, Detour navmesh, room graph",
  },
  {
    kicker: "Delivery lifecycle",
    title: "Publish the right derivative.",
    body: "Validate Walk and Fly paths, freeze the approved navigation evidence, generate device-aware web assets, control access, and keep version history.",
    output: "Spark RAD, SPZ or SOG plus an immutable movement package",
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
