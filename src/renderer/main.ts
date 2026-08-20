import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/latin-600.css";
import {
  SparkRenderer,
  SplatMesh,
} from "@sparkjsdev/spark";
import * as THREE from "three";
import { runAction } from "../client/action-state";
import type { DeviceProfile } from "../client/device-profile";
import {
  MobileControlSurface,
  nearestWalkablePoint,
} from "./mobile-controls";
import {
  createSpatialLookControls,
} from "./look-controls";
import {
  isNavigationPointAllowed,
  nearestNavigationPoint,
  parseNavigationRuntimeMessage,
  resolveNavigationMovement,
  type NavigationRuntime,
  type SourceToWorldTransform,
  type Vector3Tuple,
} from "../shared/navigation-runtime";
import { parseWorldUnit } from "../shared/world-units";
import {
  STARTING_VIEW_NEAR_BLACK_LUMINANCE_CEILING,
  STARTING_VIEW_QUALITY_SCHEMA_VERSION,
  type StartingViewQualityMetrics,
} from "../shared/starting-view-quality";
import { captureAdapterDisplayLabel } from "../shared/capture-adapters";
import { isSceneRegisteredTraversalEvidenceReceipt } from "../shared/traversal-evidence";
import type { DetourNavigationRuntime } from "./detour-navigation";
import type { PhysicalNavigationRuntime } from "./physical-navigation";
import type { PhysicalMovementMode } from "./physical-navigation";
import {
  AuthoredTraversalOverlay,
} from "./authored-traversal-overlay";
import type { AuthoredTraversalFrame } from "./authored-traversal";
import {
  appendSceneAuthoringPick,
  sceneAuthoringGeometry,
  type SceneAuthoringMode,
  type SceneAuthoringSession,
} from "./scene-authoring";
import {
  sceneAuthoringOverlaySegments,
  type SceneAuthoringOverlayKind,
} from "./scene-authoring-overlay";

declare const __SPATIAL_E2E__: boolean;

const SPARK_RUNTIME_VERSION = "2.1.0";
const parentOrigin = location.origin;
const startedAt = performance.now();
// camera-update leaves the renderer only while the player moves, so an idle
// scene is indistinguishable from a dead GPU process. A low-frequency
// heartbeat gives the host a post-ready liveness signal to watch.
const HEARTBEAT_INTERVAL_MS = 5_000;
// A paged RAD scene streams bounded chunks against the splat budget, but a
// non-paged SPZ/SOG downloads and decodes its whole asset before the first
// frame. These ceilings turn the inevitable OOM tab-kill of an oversized
// download into an explicit, retryable error. Desktop keeps twice the 256 MiB
// collision-proxy cap; the mobile tiers scale it down by roughly their splat
// budgets (0.75M/1.25M against the 2M desktop-standard budget).
const MAX_SCENE_ASSET_BYTES: Record<DeviceProfile, number> = {
  "mobile-lite": 96 * 1024 * 1024,
  "mobile-standard": 160 * 1024 * 1024,
  "desktop-standard": 512 * 1024 * 1024,
  "desktop-high": 512 * 1024 * 1024,
};
const MAX_SCENE_ASSET_BYTES_DEFAULT = 512 * 1024 * 1024;

if (window.parent !== window) {
  document.documentElement.classList.add("spark-embedded");
}

type SparkSceneFormat = "rad" | "spz" | "sog";
type WalkableBoundarySource = "authored" | "none";

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
      runtime: "spark";
      version: string;
      timeToFirstFrameMs: number;
      format: SparkSceneFormat;
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
      cameraPose: {
        position: Vector3Tuple;
        target: Vector3Tuple;
        up: Vector3Tuple;
        fovDegrees: number;
      };
      // First-frame quality of the exact frame at this pose, measured from
      // the live drawing buffer. Null when the buffer cannot be read; hosts
      // that predate the field simply ignore it.
      frameQuality: StartingViewQualityMetrics | null;
    }
  | {
      source: "spatial-spark";
      type: "camera-update";
      cameraPose: {
        position: Vector3Tuple;
        target: Vector3Tuple;
        up: Vector3Tuple;
        fovDegrees: number;
      };
    }
  | {
      source: "spatial-spark";
      type: "camera-set";
      requestId: string;
      accepted: boolean;
      message?: string;
      cameraPose: {
        position: Vector3Tuple;
        target: Vector3Tuple;
        up: Vector3Tuple;
        fovDegrees: number;
      };
    }
  | {
      source: "spatial-spark";
      type: "control-mode";
      mode: "orbit" | "free-roam";
    }
  | {
      source: "spatial-spark";
      type: "movement-mode";
      mode: PhysicalMovementMode;
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
    }
  | {
      source: "spatial-spark";
      type: "heartbeat";
    }
  | {
      source: "spatial-spark";
      type: "control-help";
      visible: boolean;
      height: number;
    }
  | {
      source: "spatial-spark";
      type: "authoring-mode";
      requestId: string;
      mode: SceneAuthoringMode | null;
      accepted: boolean;
    }
  | {
      source: "spatial-spark";
      type: "authoring-pick";
      requestId: string;
      mode: SceneAuthoringMode;
      point: Vector3Tuple;
      points: Vector3Tuple[];
      complete: boolean;
    };

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing renderer element #${id}`);
  return element as T;
};

const canvas = byId<HTMLCanvasElement>("sparkCanvas");
const loading = byId<HTMLElement>("sparkLoading");
const loadingTitle = byId<HTMLElement>("sparkLoadingTitle");
const loadingDetail = byId<HTMLElement>("sparkLoadingDetail");
const progressBar = byId<HTMLElement>("sparkProgress");
const errorPanel = byId<HTMLElement>("sparkError");
const errorTitle = byId<HTMLElement>("sparkErrorTitle");
const errorDetail = byId<HTMLElement>("sparkErrorDetail");
const qualityLabel = byId<HTMLElement>("sparkQuality");
const resetButton = byId<HTMLButtonElement>("resetView");
const helpButton = byId<HTMLButtonElement>("toggleHelp");
const helpPanel = byId<HTMLElement>("controlHelp");
const sparkViewport = byId<HTMLElement>("sparkViewport");
const fullscreenButton = byId<HTMLButtonElement>("enterFullscreen");
const controlStatus = byId<HTMLElement>("controlStatus");
const mobileMovementHelp = byId<HTMLElement>("mobileMovementHelp");
const desktopMovementHelp = byId<HTMLElement>("desktopMovementHelp");
const desktopKeyboardHelp = byId<HTMLElement>("desktopKeyboardHelp");
const desktopVerticalHelp = byId<HTMLElement>("desktopVerticalHelp");
const movementModeToggle = byId<HTMLButtonElement>("movementModeToggle");
const flightAltitudeControls = byId<HTMLElement>("flightAltitudeControls");
const flyAscend = byId<HTMLButtonElement>("flyAscend");
const flyDescend = byId<HTMLButtonElement>("flyDescend");
const mobileControls = new MobileControlSurface({
  coarsePointer: matchMedia("(any-pointer: coarse)"),
  elements: {
    viewport: sparkViewport,
    pad: byId("movementPad"),
    knob: byId("movementKnob"),
    status: byId("movementStatus"),
    lookHint: byId("mobileLookHint"),
  },
  onModeChange: (active) => {
    post({
      source: "spatial-spark",
      type: "control-mode",
      mode: active ? "free-roam" : "orbit",
    });
    updateMovementModeChrome();
  },
});

type ControlStatusTone = "ready" | "info" | "error";

function setControlStatus(message: string, tone: ControlStatusTone = "info"): void {
  controlStatus.textContent = message;
  controlStatus.dataset.tone = tone;
}
const enableMobileControlsForTest = (): void => mobileControls.setReady(true);
if (__SPATIAL_E2E__) {
  window.addEventListener("spatial:e2e-mobile-controls-ready", enableMobileControlsForTest);
}

let sparkRenderer: SparkRenderer | null = null;
let splatMesh: SplatMesh | null = null;
let webglRenderer: THREE.WebGLRenderer | null = null;
let rendererCamera: THREE.PerspectiveCamera | null = null;
let rendererControls: ReturnType<typeof createSpatialLookControls> | null = null;
let resizeObserver: ResizeObserver | null = null;
let initialView: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null;
let readySent = false;
let visualReadyHandled = false;
let heartbeatHandle: number | null = null;
let activeSceneAssetPath: string | null = null;
let firstFrameMs: number | null = null;
// A posted error is terminal for the ready protocol: the host treats "ready"
// as permission to enable navigation, so a ready after a failure would hide
// the failure behind live controls that have no runtime beneath them.
let fatalFailure = false;
let walkableBoxes: Array<{ min: THREE.Vector3; max: THREE.Vector3 }> = [];
let navigationRuntime: NavigationRuntime | null = null;
let detourNavigationRuntime: DetourNavigationRuntime | null = null;
let physicalNavigationRuntime: PhysicalNavigationRuntime | null = null;
let authoredTraversalOverlay: AuthoredTraversalOverlay | null = null;
let collisionDrivenMovement = false;
let movementMode: PhysicalMovementMode = "walk";
let mobileVerticalMovement = 0;
let navigationRuntimeGeneration = 0;
let walkableBoundarySource: WalkableBoundarySource = "none";
let movementRuntimeReady = false;
let authoringHostActive = false;
let lastWalkablePosition: THREE.Vector3 | null = null;
let lastCameraBroadcastAt = 0;
let lastBroadcastPosition: THREE.Vector3 | null = null;
let lastBroadcastDirection: THREE.Vector3 | null = null;
let sceneAuthoringSession: SceneAuthoringSession | null = null;
// Camera captures awaiting the end of the next rendered frame, so their
// first-frame quality metrics read the exact pixels the captured pose
// presents (see measureStartingViewQuality).
let pendingCameraCaptureRequestIds: string[] = [];
let renderLoopRunning = false;

bindChrome();
void start().catch((error: unknown) => {
  console.error("Spark scene initialisation failed", error);
  fail(
    "SCENE_INITIALISATION_FAILED",
    errorMessage(error, "The Spark renderer could not initialise."),
  );
});

async function start(): Promise<void> {
  const config = readConfig();
  activeSceneAssetPath = config.contentUrl.pathname;
  setProgress(4, "Validating the signed scene release");

  const context = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: true,
    powerPreference: "high-performance",
    premultipliedAlpha: true,
  });
  if (!context) {
    throw new Error("This device does not provide the WebGL2 support required by Spark.");
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080b0d);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10_000);
  rendererCamera = camera;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    antialias: false,
    powerPreference: "high-performance",
  });
  webglRenderer = renderer;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(pixelRatioFor(config.splatBudget));

  const budgetSplats = Math.round(config.splatBudget * 1_000_000);
  // Spark otherwise allocates paged-splat texture backing (packed + SH) for a
  // fixed 16.78M-splat capacity on CPU and GPU regardless of scene size. The
  // budget already bounds simultaneously rendered splats; 1.5x headroom keeps
  // LRU page eviction comfortable. Must be a multiple of the 65,536 page size.
  const splatPageSize = 65_536;
  const maxPagedSplats = Math.ceil((budgetSplats * 1.5) / splatPageSize) * splatPageSize;
  const spark = new SparkRenderer({
    renderer,
    lodSplatCount: budgetSplats,
    maxPagedSplats,
    lodRenderScale: 1.2,
    minPixelRadius: 0.15,
    maxPixelRadius: 384,
    sortRadial: true,
    numLodFetchers: 3,
  });
  sparkRenderer = spark;
  scene.add(spark);
  qualityLabel.textContent = `${formatCount(budgetSplats)} splat budget`;

  const controls = createSpatialLookControls(canvas);
  controls.setTranslationEnabled(false);
  rendererControls = controls;
  let visualSceneReady = false;
  let pendingSpatialRuntimeMessage: object | null = null;
  let activeSpatialRuntimeSignature: string | null = null;
  let hydratedNavigationMeshUrl: string | null = null;
  const authoringMarkers = new THREE.Group();
  const authoringMarkerGeometry = new THREE.SphereGeometry(0.045, 12, 8);
  const authoringMarkerMaterial = new THREE.MeshBasicMaterial({
    color: 0xc8ff42,
    depthTest: false,
  });
  authoringMarkers.name = "spatial-authoring-markers";
  scene.add(authoringMarkers);
  const authoringPlanOverlay = new THREE.Group();
  authoringPlanOverlay.name = "spatial-authoring-plan-overlay";
  scene.add(authoringPlanOverlay);
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.origin !== parentOrigin || event.source !== window.parent) return;
    if (!event.data || typeof event.data !== "object") return;
    if (Reflect.get(event.data, "source") !== "spatial-host") return;
    if (Reflect.get(event.data, "type") === "set-authoring-plan") {
      replaceSceneAuthoringOverlay(authoringPlanOverlay, Reflect.get(event.data, "plan"));
      // An authoring host is a reviewer's context: the walking package under
      // review does not exist yet, so the usual verified-runtime gate would
      // leave the inspector pinned to one point. Reviewing a scene requires
      // moving through it; grant free flight, collision-free by design.
      if (!authoringHostActive) {
        authoringHostActive = true;
        movementMode = "fly";
        if (!sceneAuthoringSession) {
          controls.setTranslationEnabled(true);
        }
      }
      return;
    }
    if (Reflect.get(event.data, "type") === "set-authoring-mode") {
      const requestId = Reflect.get(event.data, "requestId");
      const requestedMode = Reflect.get(event.data, "mode");
      const mode = requestedMode === "room" || requestedMode === "wall" ||
          requestedMode === "door" || requestedMode === "window" ||
          requestedMode === "stairs" || requestedMode === "ramp" ||
          requestedMode === "remove"
        ? requestedMode
        : null;
      if (typeof requestId !== "string") return;
      sceneAuthoringSession = mode ? { mode, requestId, points: [] } : null;
      authoringMarkers.clear();
      controls.setLookEnabled(!mode);
      controls.setTranslationEnabled(mode ? false : (movementRuntimeReady || authoringHostActive));
      canvas.dataset.authoringMode = mode ?? "";
      post({
        source: "spatial-spark",
        type: "authoring-mode",
        requestId,
        mode,
        accepted: requestedMode === null || mode !== null,
      });
      return;
    }
    if (Reflect.get(event.data, "type") === "set-spatial-runtime") {
      if (!visualSceneReady) {
        pendingSpatialRuntimeMessage = event.data;
        return;
      }
      // A release may advertise its navigation mesh as a same-origin asset
      // instead of inlining every triangle in the payload. Download it once,
      // then replay the completed message through the normal path so an inline
      // payload and a streamed one take exactly the same code.
      const navigationMeshUrl = Reflect.get(event.data, "navMeshUrl");
      if (
        typeof navigationMeshUrl === "string" && navigationMeshUrl &&
        !Reflect.get(event.data, "navigationMesh") &&
        navigationMeshUrl !== hydratedNavigationMeshUrl
      ) {
        hydratedNavigationMeshUrl = navigationMeshUrl;
        const streamedMessage = event.data;
        setControlStatus("Downloading the verified walking map");
        void fetchNavigationMesh(navigationMeshUrl).then((navigationMesh) => {
          window.dispatchEvent(new MessageEvent("message", {
            data: { ...streamedMessage, navigationMesh, navMeshUrl: null },
            origin: parentOrigin,
            source: window.parent,
          }));
        }).catch((error) => {
          hydratedNavigationMeshUrl = null;
          fail(
            "WALKING_MAP_DOWNLOAD_FAILED",
            `The approved walking map could not be downloaded: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        });
        return;
      }
      // Hosts may re-send the same runtime payload; rebuilding Rapier + Detour
      // for an identical runtime would discard live movement state for nothing.
      const runtimeSignature = spatialRuntimeMessageSignature(event.data);
      if (runtimeSignature !== null && runtimeSignature === activeSpatialRuntimeSignature) {
        return;
      }
      activeSpatialRuntimeSignature = runtimeSignature;
      const runtimeGeneration = ++navigationRuntimeGeneration;
      detourNavigationRuntime?.destroy();
      detourNavigationRuntime = null;
      physicalNavigationRuntime?.destroy();
      physicalNavigationRuntime = null;
      authoredTraversalOverlay?.destroy();
      authoredTraversalOverlay = null;
      collisionDrivenMovement = false;
      movementMode = "walk";
      stopMobileVerticalMovement();
      controls.setMovementMode("walk");
      movementModeToggle.hidden = true;
      flightAltitudeControls.hidden = true;
      movementRuntimeReady = false;
      const boxes = Reflect.get(event.data, "collisionBoxes");
      const authoredBoxes = Array.isArray(boxes)
        ? boxes.flatMap((box) => {
            if (!box || typeof box !== "object") return [];
            const min = finiteVector3(Reflect.get(box, "min"));
            const max = finiteVector3(Reflect.get(box, "max"));
            return min && max ? [{ min, max }] : [];
          })
        : [];
      const authoredRuntime = parseNavigationRuntimeMessage(
        event.data,
        authoredBoxes.map((box) => ({
          min: box.min.toArray() as Vector3Tuple,
          max: box.max.toArray() as Vector3Tuple,
        })),
      );
      if (authoredRuntime) {
        const runtimeMessage = event.data;
        navigationRuntime = authoredRuntime;
        const navigationArtifact = Reflect.get(event.data, "navigationArtifact");
        if (!navigationArtifact || typeof navigationArtifact !== "object") {
          activeSpatialRuntimeSignature = null;
          navigationRuntime = null;
          walkableBoxes = [];
          walkableBoundarySource = "none";
          fail(
            "WALKING_MAP_REQUIRED",
            "This scene has no approved walking map and cannot be viewed.",
          );
          return;
        }
        const structuralV7 =
          ["spatial-navigation-v7", "spatial-navigation-v8", "spatial-navigation-v9"].includes(
            String(Reflect.get(navigationArtifact, "schemaVersion")),
          );
        const requestedMode = Reflect.get(runtimeMessage, "defaultMovementMode");
        const preserveAuthoredFlyOpening = structuralV7 && requestedMode === "fly";
        walkableBoxes = authoredBoxes;
        if (!walkableBoxes.length) {
          const bounds = navigationMeshBounds(authoredRuntime);
          if (bounds) walkableBoxes = [bounds];
        }
        walkableBoundarySource = "authored";
        movementRuntimeReady = false;
        setMovementAvailability(controls, false);
        if (preserveAuthoredFlyOpening) {
          lastWalkablePosition = camera.position.clone();
        } else {
          anchorCameraToWalkable(camera);
        }
        setControlStatus("Preparing verified walking map");
        const collisionUrl = Reflect.get(event.data, "collisionUrl");
        if (typeof collisionUrl !== "string" || !collisionUrl) {
          activeSpatialRuntimeSignature = null;
          fail(
            "WALKING_MAP_COLLISION_REQUIRED",
            "This scene's approved walking map has no verified collision asset.",
          );
          return;
        }
        void Promise.all([
            import("./detour-navigation"),
            import("./physical-navigation"),
          ]).then(async ([detourModule, physicalModule]) => {
            const initialMode: PhysicalMovementMode = structuralV7 && requestedMode === "fly"
              ? "fly"
              : "walk";
            const streamedDetourUrl = Reflect.get(runtimeMessage, "detourUrl");
            const results = await Promise.allSettled([
              detourModule.DetourNavigationRuntime.create(
                navigationArtifact,
                typeof streamedDetourUrl === "string" && streamedDetourUrl
                  ? streamedDetourUrl
                  : null,
              ),
              physicalModule.PhysicalNavigationRuntime.create(
                collisionUrl,
                navigationArtifact,
                authoredRuntime.obstacleBoxes,
                initialMode,
              ),
            ]);
            const detourResult = results[0];
            const physicalResult = results[1];
            if (detourResult.status === "rejected") {
              if (physicalResult.status === "fulfilled") physicalResult.value.destroy();
              throw detourResult.reason;
            }
            if (physicalResult.status === "rejected") {
              if (detourResult.status === "fulfilled") detourResult.value.destroy();
              throw physicalResult.reason;
            }
            return [detourResult.value, physicalResult.value] as const;
          }).then(([runtime, physicalRuntime]) => {
            if (runtimeGeneration !== navigationRuntimeGeneration) {
              runtime.destroy();
              physicalRuntime.destroy();
              return;
            }
            const authoredPosition = camera.position.toArray() as Vector3Tuple;
            const projected = physicalRuntime.mode === "fly" &&
              physicalRuntime.canPlaceCamera(authoredPosition)
              ? authoredPosition
              : runtime.projectCamera(authoredPosition) ?? runtime.openingCamera();
            const placed = physicalRuntime.placeCamera(projected);
            if (!placed) {
              runtime.destroy();
              physicalRuntime.destroy();
              throw new Error("Opening camera overlaps reviewed collision geometry");
            }
            camera.position.fromArray(placed);
            detourNavigationRuntime = runtime;
            physicalNavigationRuntime = physicalRuntime;
            authoredTraversalOverlay = new AuthoredTraversalOverlay(
              scene,
              runtime.authoredTraversalLinks,
              runtime.eyeHeight,
            );
            collisionDrivenMovement = ["spatial-navigation-v7", "spatial-navigation-v8", "spatial-navigation-v9"].includes(
              String(Reflect.get(navigationArtifact as object, "schemaVersion")),
            );
            movementMode = physicalRuntime.mode;
            controls.configureMovementProfiles(navigationArtifact);
            controls.setMovementMode(movementMode);
            movementModeToggle.hidden = !collisionDrivenMovement;
            updateMovementModeChrome();
            lastWalkablePosition = camera.position.clone();
            // A walk release opens standing: the runtime placement above chose
            // the feet and eye height, and the authored QA framing contributes
            // only its heading. The framing itself is an elevated review pose —
            // steeply pitched, often carrying a non-vertical authored up — and
            // a standing walker must open level, with world-vertical up, so
            // that yaw turns about gravity and verticals render upright. A
            // structural fly opening keeps the authored framing: that is the
            // reviewed way to present a flythrough release, and Reset view in
            // fly mode restores it.
            if (physicalRuntime.mode === "walk") {
              levelCameraForWalking(camera);
              // Only the default heading is suggested: an operator-captured
              // starting view (config.initialCamera) is authored content whose
              // quality the publish gate already validated, so its heading is
              // kept. Without one, the heading inherited from the QA framing
              // may face anywhere — turn the spawn toward the centroid of the
              // walkable region unless the framing already roughly faces it.
              // This runs identically for a published walk release and for the
              // publish dialog's starting-view scene; in the dialog the
              // operator stays free to move before "Use current view".
              if (!config.initialCamera) {
                faceWalkableRegionCentroid(camera, authoredRuntime);
              }
            }
            controls.align(camera);
            initialView = {
              position: camera.position.clone(),
              quaternion: camera.quaternion.clone(),
            };
            movementRuntimeReady = true;
            setMovementAvailability(controls, true);
            setControlStatus(
              collisionDrivenMovement
                ? movementStatusText()
                : "Walking enabled · Detour + capsule collision verified",
              "ready",
            );
          }).catch((error) => {
            if (runtimeGeneration !== navigationRuntimeGeneration) return;
            activeSpatialRuntimeSignature = null;
            detourNavigationRuntime = null;
            collisionDrivenMovement = false;
            movementRuntimeReady = false;
            setMovementAvailability(controls, false);
            fail(
              "WALKING_MAP_VALIDATION_FAILED",
              `The walking map failed validation: ${error instanceof Error ? error.message : "unknown error"}`,
            );
          });
      } else {
        activeSpatialRuntimeSignature = null;
        navigationRuntime = null;
        walkableBoxes = [];
        walkableBoundarySource = "none";
        movementRuntimeReady = false;
        setMovementAvailability(controls, false);
        fail(
          "WALKING_MAP_REQUIRED",
          "This scene has no approved walking map and cannot be viewed.",
        );
      }
      return;
    }
    if (Reflect.get(event.data, "type") === "refresh-scene-tokens") {
      // Before ready the token minted with the manifest is still live for the
      // whole initial load (the host renews at sixty percent of the session
      // lifetime and replays the current token on ready); after a fatal
      // failure no further fetches are issued. Both states ignore the refresh
      // instead of mutating a runtime that is not streaming.
      if (!readySent || fatalFailure) return;
      applySceneTokenRefresh(Reflect.get(event.data, "contentUrl"));
      return;
    }
    if (Reflect.get(event.data, "type") === "set-dynamic-barrier-state") {
      const requestId = typeof Reflect.get(event.data, "requestId") === "string"
        ? String(Reflect.get(event.data, "requestId"))
        : null;
      const barrierId = String(Reflect.get(event.data, "barrierId") ?? "");
      const active = Reflect.get(event.data, "active");
      const supported = Boolean(
        requestId &&
        barrierId &&
        typeof active === "boolean" &&
        detourNavigationRuntime?.hasDynamicBarrier(barrierId) &&
        physicalNavigationRuntime?.hasDynamicBarrier(barrierId),
      );
      // The physical world decides first: it refuses to close a barrier on a
      // player standing in it. Detour only follows an accepted change so the
      // route planner and the collision world can never disagree.
      const applied = supported &&
        physicalNavigationRuntime!.setDynamicBarrierState(barrierId, active as boolean);
      if (applied) {
        detourNavigationRuntime!.setDynamicBarrierState(barrierId, active as boolean);
      }
      if (requestId) {
        post({
          source: "spatial-spark",
          type: "dynamic-barrier-state",
          requestId,
          barrierId,
          active: applied ? active === true : active !== true,
          accepted: applied,
          message: !supported
            ? "The requested dynamic barrier is not part of this verified runtime."
            : applied
            ? `${barrierId} is now ${active ? "closed" : "open"}`
            : `${barrierId} cannot close while the player is standing in it`,
        });
      }
      return;
    }
    if (Reflect.get(event.data, "type") === "movement-key") {
      controls.setKeyboardKeyState(
        String(Reflect.get(event.data, "code") ?? ""),
        Reflect.get(event.data, "pressed") === true,
      );
      return;
    }
    if (Reflect.get(event.data, "type") === "movement-keys-clear") {
      controls.clearKeyboardState();
      return;
    }
    if (Reflect.get(event.data, "type") === "sync-camera") {
      mobileControls.suspend();
      const pose = Reflect.get(event.data, "cameraPose");
      if (!pose || typeof pose !== "object") return;
      const position = finiteVector3(Reflect.get(pose, "position"));
      const target = finiteVector3(Reflect.get(pose, "target"));
      const up = finiteVector3(Reflect.get(pose, "up")) ?? new THREE.Vector3(0, 1, 0);
      const fovDegrees = Number(Reflect.get(pose, "fovDegrees"));
      if (!position || !target || !Number.isFinite(fovDegrees)) return;
      camera.position.copy(position);
      anchorCameraToWalkable(camera);
      camera.up.copy(up).normalize();
      camera.lookAt(target);
      controls.align(camera);
      camera.fov = Math.min(100, Math.max(20, fovDegrees));
      camera.updateProjectionMatrix();
      const direction = camera.getWorldDirection(new THREE.Vector3());
      lastCameraBroadcastAt = performance.now();
      lastBroadcastPosition = camera.position.clone();
      lastBroadcastDirection = direction;
      return;
    }
    if (Reflect.get(event.data, "type") === "set-camera") {
      mobileControls.suspend();
      const requestId = typeof Reflect.get(event.data, "requestId") === "string"
        ? String(Reflect.get(event.data, "requestId"))
        : null;
      const pose = Reflect.get(event.data, "cameraPose") as Partial<{
        position: Vector3Tuple;
        target: Vector3Tuple;
        up: Vector3Tuple;
        fovDegrees: number;
      }> | undefined;
      if (!pose?.position || !pose.target) {
        if (requestId) {
          post({
            source: "spatial-spark",
            type: "camera-set",
            requestId,
            accepted: false,
            message: "The authored room camera is incomplete.",
            cameraPose: cameraPose(camera),
          });
        }
        return;
      }
      const requestedPosition = new THREE.Vector3().fromArray(pose.position);
      let acceptedPosition = requestedPosition;
      if (detourNavigationRuntime) {
        const projectedPosition = detourNavigationRuntime.projectCamera(
          requestedPosition.toArray() as Vector3Tuple,
        );
        const currentPosition = camera.position.toArray() as Vector3Tuple;
        if (
          !projectedPosition ||
          !(collisionDrivenMovement && movementMode === "fly"
            ? detourNavigationRuntime.hasCompleteTopologyPath(currentPosition, projectedPosition)
            : detourNavigationRuntime.hasCompletePath(currentPosition, projectedPosition))
        ) {
          if (requestId) {
            post({
              source: "spatial-spark",
              type: "camera-set",
              requestId,
              accepted: false,
              message: "The requested room is not reachable by the verified walking map.",
              cameraPose: cameraPose(camera),
            });
          }
          return;
        }
        acceptedPosition = collisionDrivenMovement && movementMode === "fly"
          ? requestedPosition
          : new THREE.Vector3().fromArray(projectedPosition);
      } else if (navigationRuntime && !isCameraPositionAllowed(requestedPosition)) {
        if (requestId) {
          post({
            source: "spatial-spark",
            type: "camera-set",
            requestId,
            accepted: false,
            message: "The requested room camera is outside the scene navigation boundary.",
            cameraPose: cameraPose(camera),
          });
        }
        return;
      }
      if (physicalNavigationRuntime) {
        const placedPosition = physicalNavigationRuntime.placeCamera(
          acceptedPosition.toArray() as Vector3Tuple,
        );
        if (!placedPosition) {
          if (requestId) {
            post({
              source: "spatial-spark",
              type: "camera-set",
              requestId,
              accepted: false,
              message: "The requested room camera overlaps reviewed collision geometry.",
              cameraPose: cameraPose(camera),
            });
          }
          return;
        }
        acceptedPosition = new THREE.Vector3().fromArray(placedPosition);
      }
      camera.position.copy(acceptedPosition);
      camera.up.fromArray(pose.up ?? [0, 1, 0]).normalize();
      camera.lookAt(new THREE.Vector3().fromArray(pose.target));
      controls.align(camera);
      if (typeof pose.fovDegrees === "number") camera.fov = Math.min(100, Math.max(20, pose.fovDegrees));
      camera.updateProjectionMatrix();
      if (navigationRuntime && isCameraPositionAllowed(camera.position)) {
        lastWalkablePosition = camera.position.clone();
      }
      if (requestId) {
        post({
          source: "spatial-spark",
          type: "camera-set",
          requestId,
          accepted: true,
          cameraPose: cameraPose(camera),
        });
      }
      return;
    }
    if (
      Reflect.get(event.data, "type") !== "capture-camera" ||
      typeof Reflect.get(event.data, "requestId") !== "string"
    ) return;
    const captureRequestId = String(Reflect.get(event.data, "requestId"));
    // Defer the reply to the end of the next rendered frame when the loop is
    // running: the quality metrics must describe the exact pixels this pose
    // presents, and only the render loop observes a complete frame. A paused
    // loop (hidden tab, pre-load capture) answers immediately without
    // metrics rather than stalling the host.
    if (renderLoopRunning) {
      pendingCameraCaptureRequestIds.push(captureRequestId);
      return;
    }
    post({
      source: "spatial-spark",
      type: "camera",
      requestId: captureRequestId,
      cameraPose: cameraPose(camera),
      frameQuality: null,
    });
  });

  setProgress(9, config.format === "rad" ? "Opening the paged RAD scene" : "Loading the Spark scene");
  if (config.format !== "rad") {
    const declaredBytes = await declaredSceneAssetBytes(config.contentUrl);
    const ceiling = config.deviceProfile
      ? MAX_SCENE_ASSET_BYTES[config.deviceProfile]
      : MAX_SCENE_ASSET_BYTES_DEFAULT;
    if (declaredBytes !== null && declaredBytes > ceiling) {
      fail(
        "SCENE_ASSET_TOO_LARGE",
        `This ${formatBytes(declaredBytes)} ${config.format.toUpperCase()} scene exceeds the ${
          formatBytes(ceiling)
        } ceiling for this device. Publish a smaller delivery derivative for this release.`,
      );
      return;
    }
  }
  const mesh = new SplatMesh({
    url: config.contentUrl.toString(),
    fileName: `scene.${config.format}`,
    paged: config.format === "rad",
    // Compact SPZ/SOG releases are already bounded delivery derivatives. Spark's
    // client-side LoD path is reserved for paged RAD scenes; enabling it for a
    // plain SPZ can distort older v3 assets that carry no LoD metadata.
    lod: undefined,
    lodAbove: undefined,
    raycastable: true,
    onProgress: (event) => {
      const total = Number.isFinite(event.total) && event.total > 0 ? event.total : 0;
      const loaded = Number.isFinite(event.loaded) ? event.loaded : 0;
      const fraction = total > 0 ? loaded / total : 0;
      const progress = total > 0 ? 10 + Math.round(Math.min(fraction, 1) * 70) : 18;
      const detail = total > 0
        ? `Streaming ${formatBytes(loaded)} of ${formatBytes(total)}`
        : "Streaming scene data";
      setProgress(progress, detail);
    },
  });
  if (config.sourceToWorld) {
    const upAxisRotation = new THREE.Quaternion();
    if (config.sourceToWorld.sourceUpAxis === "Z") {
      upAxisRotation.setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        -Math.PI / 2,
      );
    }
    const yawRotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      THREE.MathUtils.degToRad(config.sourceToWorld.yawDegrees),
    );
    mesh.quaternion.copy(yawRotation.multiply(upAxisRotation));
    mesh.scale.setScalar(config.sourceToWorld.metresPerSourceUnit);
    mesh.position.fromArray(config.sourceToWorld.translationMetres);
  } else if (config.sceneRotationDegrees) {
    mesh.rotation.set(
      THREE.MathUtils.degToRad(config.sceneRotationDegrees[0]),
      THREE.MathUtils.degToRad(config.sceneRotationDegrees[1]),
      THREE.MathUtils.degToRad(config.sceneRotationDegrees[2]),
    );
  }
  splatMesh = mesh;
  scene.add(mesh);
  canvas.addEventListener("pointerdown", (event) => {
    if (!sceneAuthoringSession || event.button !== 0 || !rendererCamera || !splatMesh) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, rendererCamera);
    const hit = raycaster.intersectObject(splatMesh, true)[0];
    if (!hit) return;
    const point = hit.point.toArray() as Vector3Tuple;
    sceneAuthoringSession = appendSceneAuthoringPick(sceneAuthoringSession, point);
    const geometry = sceneAuthoringGeometry(sceneAuthoringSession);
    const marker = new THREE.Mesh(
      authoringMarkerGeometry,
      authoringMarkerMaterial,
    );
    marker.position.copy(hit.point);
    marker.renderOrder = 1000;
    authoringMarkers.add(marker);
    post({
      source: "spatial-spark",
      type: "authoring-pick",
      requestId: sceneAuthoringSession.requestId,
      mode: sceneAuthoringSession.mode,
      point,
      points: geometry.points,
      complete: geometry.complete,
    });
  });

  resizeObserver = new ResizeObserver(() => resize(renderer, camera));
  resizeObserver.observe(canvas);
  resize(renderer, camera);

  await mesh.initialized;
  setProgress(86, "Framing the reconstructed place");
  if (config.initialCamera) {
    camera.fov = config.initialCamera.fovDegrees;
    if (config.initialCamera.up) {
      camera.up.fromArray(config.initialCamera.up).normalize();
    }
    camera.position.fromArray(config.initialCamera.position);
    camera.lookAt(new THREE.Vector3().fromArray(config.initialCamera.target));
    camera.updateProjectionMatrix();
  } else {
    frameScene(mesh, camera);
  }
  setMovementAvailability(controls, movementRuntimeReady);
  if (walkableBoundarySource === "none") {
    setControlStatus("Walking map required · preview blocked", "error");
  }
  anchorCameraToWalkable(camera);
  controls.align(camera);
  initialView = {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
  };
  visualSceneReady = true;
  if (pendingSpatialRuntimeMessage) {
    const message = pendingSpatialRuntimeMessage;
    pendingSpatialRuntimeMessage = null;
    window.dispatchEvent(new MessageEvent("message", {
      data: message,
      origin: parentOrigin,
      source: window.parent,
    }));
  }
  let lastFrameAt = performance.now();
  let contextLost = false;
  const renderLoop = (): void => {
    const now = performance.now();
    const deltaSeconds = Math.min(0.05, Math.max(0, (now - lastFrameAt) / 1_000));
    lastFrameAt = now;
    const movementStart = lastWalkablePosition?.clone() ?? camera.position.clone();
    controls.update(camera, deltaSeconds, {
      ...mobileControls.movement,
      y: mobileVerticalMovement,
    });
    const desired = camera.position.toArray() as Vector3Tuple;
    const origin = movementStart.toArray() as Vector3Tuple;
    const authoredTraversal = collisionDrivenMovement && movementMode === "walk"
      ? detourNavigationRuntime?.resolveAuthoredTraversal(origin, desired, deltaSeconds) ?? null
      : null;
    if (authoredTraversal && physicalNavigationRuntime) {
      const controlledPosition = physicalNavigationRuntime.moveControlledCamera(
        origin,
        authoredTraversal.position,
      );
      if (controlledPosition) {
        camera.position.fromArray(controlledPosition);
        lastWalkablePosition = camera.position.clone();
        const overlayState = authoredTraversalOverlay?.update(authoredTraversal) ?? null;
        if (authoredTraversal.started) {
          setControlStatus(
            overlayState
              ? `${overlayState.label} · evidence-linked ${captureAdapterDisplayLabel(overlayState.adapter)} path in progress`
              : `${traversalKindLabel(authoredTraversal.traversalKind)} traversal in progress`,
            "ready",
          );
          post(authoredTraversalMessage(authoredTraversal, "started"));
        }
        if (authoredTraversal.phase === "completed") {
          setControlStatus(movementStatusText(), "ready");
          post(authoredTraversalMessage(authoredTraversal, "completed"));
        }
      } else {
        detourNavigationRuntime?.cancelAuthoredTraversal();
        authoredTraversalOverlay?.update(null);
        if (lastWalkablePosition) camera.position.copy(lastWalkablePosition);
        const message = physicalNavigationRuntime.controlledFailure ?? "structural collision";
        setControlStatus(
          `${traversalKindLabel(authoredTraversal.traversalKind)} traversal blocked: ${
            message
          }`,
        );
        post(authoredTraversalMessage(authoredTraversal, "blocked", message));
      }
    } else if (collisionDrivenMovement && physicalNavigationRuntime) {
      authoredTraversalOverlay?.update(null);
      // Detour owns where Walk may go; Rapier owns how the capsule gets there.
      // Reversing those authorities lets a valid collision floor extend past
      // the reviewed navmesh and eventually drop the walker into shell void.
      const navigationConstrained = movementMode === "walk" && detourNavigationRuntime
        ? detourNavigationRuntime.moveCamera(origin, desired)
        : desired;
      const resolved = physicalNavigationRuntime.moveCamera(
        origin,
        navigationConstrained ?? origin,
        deltaSeconds,
      );
      noteMovementResistance(origin, desired, resolved, deltaSeconds);
      if (resolved) {
        camera.position.fromArray(resolved);
        lastWalkablePosition = camera.position.clone();
      } else if (lastWalkablePosition) {
        camera.position.copy(lastWalkablePosition);
      } else {
        // No anchored position means the body was never established here —
        // an earlier placement failed and left walking dead. Re-place from
        // wherever the camera is now: placement runs the same navmesh
        // projection and collision validation as every other placement, so
        // recovery can never skip a reviewed wall.
        anchorCameraToWalkable(camera);
      }
    } else if (detourNavigationRuntime) {
      const detourResolved = detourNavigationRuntime.moveCamera(origin, desired);
      const resolved = detourResolved && physicalNavigationRuntime
        ? physicalNavigationRuntime.moveCamera(origin, detourResolved)
        : null;
      if (resolved) {
        camera.position.fromArray(resolved);
        lastWalkablePosition = camera.position.clone();
      } else if (lastWalkablePosition) {
        camera.position.copy(lastWalkablePosition);
      } else {
        anchorCameraToWalkable(camera);
      }
    } else if (navigationRuntime) {
      const resolved = resolveNavigationMovement(origin, desired, navigationRuntime);
      if (resolved) {
        camera.position.fromArray(resolved);
        lastWalkablePosition = camera.position.clone();
      } else if (lastWalkablePosition) {
        camera.position.copy(lastWalkablePosition);
      } else {
        anchorCameraToWalkable(camera);
      }
    }
    broadcastCameraUpdate(camera);
    renderer.render(scene, camera);
    if (pendingCameraCaptureRequestIds.length) {
      // Same task as the render above: the default framebuffer still holds
      // the complete presented frame this pose produced.
      const frameQuality = measureStartingViewQuality(renderer);
      for (const captureRequestId of pendingCameraCaptureRequestIds) {
        post({
          source: "spatial-spark",
          type: "camera",
          requestId: captureRequestId,
          cameraPose: cameraPose(camera),
          frameQuality,
        });
      }
      pendingCameraCaptureRequestIds = [];
    }
    // The loader clears once the visual is on screen: the authoring host
    // reviews the scene precisely before a walking runtime exists, and gating
    // the overlay on that runtime stranded it on a permanent "Finalising the
    // view" over a fully rendered scene. But the visual alone must never post
    // "ready" — the host treats ready as movement-ready and enables room
    // navigation on it, so ready waits for the verified runtime (or an
    // authoring host's free-fly grant), and never follows a fatal error.
    if (!visualReadyHandled && visualSceneReady && !fatalFailure) {
      visualReadyHandled = true;
      resetButton.disabled = false;
      firstFrameMs = Math.round(performance.now() - startedAt);
      setProgress(100, "Spatial scene ready");
      loading.classList.add("is-complete");
      loading.setAttribute("aria-hidden", "true");
      loading.hidden = true;
      canvas.focus({ preventScroll: true });
    }
    if (
      !readySent && !fatalFailure && visualSceneReady &&
      (movementRuntimeReady || authoringHostActive)
    ) {
      readySent = true;
      setMovementAvailability(controls, movementRuntimeReady || authoringHostActive);
      post({
        source: "spatial-spark",
        type: "ready",
        runtime: "spark",
        version: SPARK_RUNTIME_VERSION,
        timeToFirstFrameMs: firstFrameMs ?? Math.round(performance.now() - startedAt),
        format: config.format,
        splatBudget: budgetSplats,
      });
      startHeartbeat();
    }
  };
  renderLoopRunning = true;
  renderer.setAnimationLoop(renderLoop);

  // A lost WebGL context must halt rendering and physics and tell the host,
  // never leave a silent black canvas. Spark GPU resources cannot be rebuilt
  // in place on restore, so the restored signal becomes a distinct fatal
  // message the host can turn into a reload affordance.
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    renderLoopRunning = false;
    renderer.setAnimationLoop(null);
    fail(
      "WEBGL_CONTEXT_LOST",
      "The graphics context was lost. The scene can continue after the browser restores it.",
    );
  });
  canvas.addEventListener("webglcontextrestored", () => {
    fail(
      "WEBGL_CONTEXT_RESTORE_RELOAD_REQUIRED",
      "The graphics context was restored, but the scene must be reloaded to rebuild its splat resources.",
    );
  });

  // A hidden tab pauses rendering and physics entirely; resetting the frame
  // clock on resume keeps the first visible frame from integrating the whole
  // hidden interval as one giant step.
  document.addEventListener("visibilitychange", () => {
    if (contextLost) return;
    if (document.hidden) {
      renderLoopRunning = false;
      renderer.setAnimationLoop(null);
      return;
    }
    lastFrameAt = performance.now();
    renderLoopRunning = true;
    renderer.setAnimationLoop(renderLoop);
  });

  window.addEventListener("pagehide", dispose, { once: true });
}

// A renewed scene token only matters to fetches issued after it arrives, and
// the only renderer state that keeps fetching after the initial load is the
// paged splat stream: Spark's pager reads its public rootUrl on every ranged
// chunk fetch, so swapping that property is the supported way to point future
// tile reads at the renewed token. Non-paged formats downloaded their whole
// asset up front and hold no URL a refresh could repoint.
function applySceneTokenRefresh(value: unknown): void {
  if (typeof value !== "string" || !value) return;
  let refreshed: URL;
  try {
    refreshed = new URL(value, location.origin);
  } catch {
    return;
  }
  if (
    refreshed.origin !== location.origin ||
    (!refreshed.pathname.startsWith("/asset/") &&
      !refreshed.pathname.startsWith("/public-asset/") &&
      !refreshed.pathname.startsWith("/comparison-asset/"))
  ) return;
  // A refresh renews credentials on the same asset; a different asset path is
  // not a token refresh and must not repoint the stream.
  if (activeSceneAssetPath === null || refreshed.pathname !== activeSceneAssetPath) return;
  const paged = splatMesh?.paged;
  if (paged) paged.rootUrl = refreshed.toString();
  if (__SPATIAL_E2E__) {
    const applied = Reflect.get(window, "__sceneTokenRefreshes");
    if (Array.isArray(applied)) applied.push(refreshed.toString());
    else Reflect.set(window, "__sceneTokenRefreshes", [refreshed.toString()]);
  }
}

// Mirrors the collision proxy's Content-Length gate, but as a ranged preflight
// so the decision costs one byte instead of the whole download. An asset route
// that ignores Range answers 200 with a Content-Length; either shape yields
// the full size. A failed or shapeless preflight resolves to null and the real
// download surfaces its own network error.
async function declaredSceneAssetBytes(contentUrl: URL): Promise<number | null> {
  try {
    const response = await fetch(contentUrl.toString(), {
      credentials: "same-origin",
      headers: { Range: "bytes=0-0" },
    });
    void response.body?.cancel();
    if (!response.ok) return null;
    const rangeTotal = response.headers.get("Content-Range")?.match(/\/(\d+)\s*$/);
    if (rangeTotal) return Number(rangeTotal[1]);
    const contentLength = Number(response.headers.get("Content-Length"));
    return response.status === 200 && Number.isFinite(contentLength) && contentLength > 0
      ? contentLength
      : null;
  } catch {
    return null;
  }
}

// Streamed navigation payloads are only ever read back from the platform's own
// release asset routes, never from a URL that could point somewhere else.
async function fetchNavigationMesh(url: string): Promise<{
  version: string;
  vertices: Vector3Tuple[];
  indices: number[];
  sourceEntityIds: string[];
}> {
  const resolved = new URL(url, location.origin);
  if (
    resolved.origin !== location.origin ||
    (!resolved.pathname.startsWith("/asset/") &&
      !resolved.pathname.startsWith("/public-asset/") &&
      !resolved.pathname.startsWith("/comparison-asset/"))
  ) {
    throw new Error("The navigation mesh URL is outside the trusted release boundary.");
  }
  const response = await fetch(resolved.toString(), { credentials: "same-origin" });
  if (!response.ok) throw new Error(`the download failed with status ${response.status}`);
  const payload = await response.json() as unknown;
  const vertices = Reflect.get(payload as object, "vertices");
  const indices = Reflect.get(payload as object, "indices");
  const sourceEntityIds = Reflect.get(payload as object, "sourceEntityIds");
  if (
    !payload || typeof payload !== "object" ||
    !Array.isArray(vertices) || !vertices.every((vertex) => finiteTuple(vertex)) ||
    !Array.isArray(indices) || !indices.every((index) => Number.isInteger(index))
  ) {
    throw new Error("the downloaded navigation mesh is incomplete");
  }
  return {
    version: String(Reflect.get(payload, "version") ?? "streamed-navigation-mesh-v1"),
    vertices: vertices as Vector3Tuple[],
    indices: indices as number[],
    sourceEntityIds: Array.isArray(sourceEntityIds) ? sourceEntityIds.map(String) : [],
  };
}

function startHeartbeat(): void {
  if (heartbeatHandle !== null) return;
  heartbeatHandle = window.setInterval(() => {
    // A fatal failure ends the ready protocol; the host must never read a
    // heartbeat as a live scene behind its error panel.
    if (fatalFailure) return;
    post({ source: "spatial-spark", type: "heartbeat" });
  }, HEARTBEAT_INTERVAL_MS);
}

function spatialRuntimeMessageSignature(message: object): string | null {
  try {
    return JSON.stringify(message) ?? null;
  } catch {
    return null;
  }
}

function replaceSceneAuthoringOverlay(group: THREE.Group, value: unknown): void {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
      else child.material.dispose();
    }
  }
  const byKind = new Map<SceneAuthoringOverlayKind, number[]>();
  for (const segment of sceneAuthoringOverlaySegments(value)) {
    const positions = byKind.get(segment.kind) ?? [];
    positions.push(...segment.start, ...segment.end);
    byKind.set(segment.kind, positions);
  }
  const colors: Record<SceneAuthoringOverlayKind, number> = {
    room: 0xc8ff42,
    wall: 0xf6f3e8,
    door: 0x51e2c2,
    window: 0x55a7ff,
    "unknown-opening": 0xff8c6b,
    connector: 0xffd166,
  };
  for (const [kind, positions] of byKind) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: colors[kind],
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.92,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.name = `spatial-authoring-${kind}`;
    lines.renderOrder = 999;
    group.add(lines);
  }
}

function traversalKindLabel(kind: "elevator" | "ladder" | "moving_platform"): string {
  if (kind === "moving_platform") return "Moving platform";
  return kind === "elevator" ? "Elevator" : "Ladder";
}

function authoredTraversalMessage(
  frame: AuthoredTraversalFrame,
  phase: "started" | "completed" | "blocked",
  message?: string,
): RendererMessage {
  const receipt = frame.evidenceReceipt;
  return {
    source: "spatial-spark",
    type: "authored-traversal-state",
    connectionId: frame.connectionId,
    traversalKind: frame.traversalKind,
    label: frame.label,
    phase,
    qualification: isSceneRegisteredTraversalEvidenceReceipt(receipt)
      ? {
        adapter: receipt.adapter,
        manifestSha256: receipt.manifestSha256,
        reviewGeneration: receipt.reviewGeneration,
        registrationSha256: receipt.registrationSha256,
      }
      : null,
    ...(message ? { message } : {}),
  };
}

function cameraPose(camera: THREE.PerspectiveCamera): {
  position: Vector3Tuple;
  target: Vector3Tuple;
  up: Vector3Tuple;
  fovDegrees: number;
} {
  const direction = camera.getWorldDirection(new THREE.Vector3());
  const target = camera.position.clone().add(direction);
  return {
    position: camera.position.toArray() as Vector3Tuple,
    target: target.toArray() as Vector3Tuple,
    up: camera.up.toArray() as Vector3Tuple,
    fovDegrees: camera.fov,
  };
}

function broadcastCameraUpdate(camera: THREE.PerspectiveCamera): void {
  const now = performance.now();
  if (now - lastCameraBroadcastAt < 66) return;
  const direction = camera.getWorldDirection(new THREE.Vector3());
  const moved = !lastBroadcastPosition || lastBroadcastPosition.distanceToSquared(camera.position) > 0.0004;
  const turned = !lastBroadcastDirection || lastBroadcastDirection.angleTo(direction) > 0.015;
  if (!moved && !turned && lastCameraBroadcastAt > 0) return;
  lastCameraBroadcastAt = now;
  lastBroadcastPosition = camera.position.clone();
  lastBroadcastDirection = direction;
  post({
    source: "spatial-spark",
    type: "camera-update",
    cameraPose: cameraPose(camera),
  });
}

function readConfig(): {
  contentUrl: URL;
  format: SparkSceneFormat;
  splatBudget: number;
  deviceProfile: DeviceProfile | null;
  sceneRotationDegrees: Vector3Tuple | null;
  sourceToWorld: SourceToWorldTransform | null;
  initialCamera: {
    position: Vector3Tuple;
    target: Vector3Tuple;
    up: Vector3Tuple | null;
    fovDegrees: number;
  } | null;
} {
  const params = new URLSearchParams(location.search);
  const content = params.get("content");
  const format = params.get("format");
  if (!content) throw new Error("The release did not provide a scene asset URL.");
  if (format !== "rad" && format !== "spz" && format !== "sog") {
    throw new Error("The release format is not supported by the Spark runtime.");
  }

  const contentUrl = new URL(content, location.origin);
  if (
    contentUrl.origin !== location.origin ||
    (!contentUrl.pathname.startsWith("/asset/") &&
      !contentUrl.pathname.startsWith("/public-asset/") &&
      !contentUrl.pathname.startsWith("/comparison-asset/"))
  ) {
    throw new Error("The scene asset URL is outside the trusted release boundary.");
  }

  const rawBudget = Number(params.get("budget") ?? "2");
  const splatBudget = Number.isFinite(rawBudget)
    ? Math.min(8, Math.max(0.25, rawBudget))
    : 2;
  // A host that names no profile (authoring hosts, older embeds) keeps the
  // generous desktop download ceiling rather than guessing a stricter one.
  const rawProfile = params.get("profile");
  const deviceProfile: DeviceProfile | null =
    rawProfile === "mobile-lite" || rawProfile === "mobile-standard" ||
      rawProfile === "desktop-standard" || rawProfile === "desktop-high"
      ? rawProfile
      : null;
  const sceneRotationDegrees = readVector(params.get("rotation"));
  const sourceToWorld = readSourceToWorld(params.get("sourceToWorld"));
  const cameraPosition = readVector(params.get("camera"));
  const cameraTarget = readVector(params.get("target"));
  const cameraUp = readVector(params.get("up"));
  const rawFov = Number(params.get("fov") ?? "58");
  const fovDegrees = Number.isFinite(rawFov) ? Math.min(100, Math.max(20, rawFov)) : 58;
  const initialCamera = cameraPosition && cameraTarget
    ? { position: cameraPosition, target: cameraTarget, up: cameraUp, fovDegrees }
    : null;
  return {
    contentUrl,
    format,
    splatBudget,
    deviceProfile,
    sceneRotationDegrees,
    sourceToWorld,
    initialCamera,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function readVector(value: string | null): Vector3Tuple | null {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function readSourceToWorld(value: string | null): SourceToWorldTransform | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const sourceUpAxis = Reflect.get(parsed, "sourceUpAxis");
  const worldUnit = parseWorldUnit(Reflect.get(parsed, "worldUnit"));
  const metresPerSourceUnit = Number(Reflect.get(parsed, "metresPerSourceUnit"));
  const yawDegrees = Number(Reflect.get(parsed, "yawDegrees"));
  const translationMetres = finiteTuple(Reflect.get(parsed, "translationMetres"));
  if (
    (sourceUpAxis !== "Y" && sourceUpAxis !== "Z") ||
    !Number.isFinite(metresPerSourceUnit) ||
    metresPerSourceUnit <= 0 ||
    metresPerSourceUnit > 10_000 ||
    !Number.isFinite(yawDegrees) ||
    !translationMetres
  ) return null;
  return {
    sourceUpAxis,
    worldUnit,
    metresPerSourceUnit,
    yawDegrees,
    translationMetres,
  };
}

function finiteVector3(value: unknown): THREE.Vector3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const coordinates = value.map(Number);
  if (coordinates.some((coordinate) => !Number.isFinite(coordinate))) return null;
  return new THREE.Vector3(coordinates[0], coordinates[1], coordinates[2]);
}

function finiteTuple(value: unknown): Vector3Tuple | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const coordinates = value.map(Number);
  if (coordinates.some((coordinate) => !Number.isFinite(coordinate))) return null;
  return [coordinates[0]!, coordinates[1]!, coordinates[2]!];
}

function isCameraPositionAllowed(position: THREE.Vector3): boolean {
  if (collisionDrivenMovement && physicalNavigationRuntime) {
    return physicalNavigationRuntime.canPlaceCamera(position.toArray() as Vector3Tuple);
  }
  if (detourNavigationRuntime) {
    return detourNavigationRuntime.isCameraAllowed(position.toArray() as Vector3Tuple);
  }
  return navigationRuntime
    ? isNavigationPointAllowed(position.toArray() as Vector3Tuple, navigationRuntime)
    : false;
}

function navigationMeshBounds(
  runtime: NavigationRuntime,
): { min: THREE.Vector3; max: THREE.Vector3 } | null {
  if (!runtime.navigationMesh.vertices.length) return null;
  const minimum = new THREE.Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );
  const maximum = new THREE.Vector3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  );
  for (const vertex of runtime.navigationMesh.vertices) {
    minimum.min(new THREE.Vector3().fromArray(vertex));
    maximum.max(new THREE.Vector3().fromArray(vertex));
  }
  minimum.y -= 0.5;
  maximum.y += runtime.profile.agentHeight + 0.5;
  return { min: minimum, max: maximum };
}

// First-frame quality is measured from the drawing buffer that the operator is
// actually looking at, not from scene metadata: a pose can be perfectly valid
// on the walkable region while the frame it produces is the black void around
// the capture. The read happens inside the render loop, in the same task and
// immediately after the loop's own render call, because that is the only
// moment the default framebuffer verifiably holds the complete presented
// frame: Spark performs its splat passes inside the loop, and the buffer is
// cleared after presentation.
//
// Receipt for 65,536 samples: a 1280x800 buffer holds ~1M pixels; reading them
// all costs one 4 MiB copy, and sampling on a stride keeps the arithmetic
// bounded at 64K samples regardless of canvas size while still touching every
// region of the frame. The stride only widens on buffers larger than 64K
// pixels, so small mobile canvases are measured exhaustively.
const STARTING_VIEW_SAMPLE_TARGET = 65_536;
// The scene clear color is #080b0d (see start()); a pixel within this byte
// tolerance of it on every channel carries no visible splat contribution.
const STARTING_VIEW_CLEAR_COLOR_BYTES: [number, number, number] = [8, 11, 13];
const STARTING_VIEW_CLEAR_COLOR_BYTE_TOLERANCE = 4;

function measureStartingViewQuality(
  renderer: THREE.WebGLRenderer,
): StartingViewQualityMetrics | null {
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  if (!width || !height) return null;
  const pixels = new Uint8Array(width * height * 4);
  try {
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  } catch {
    return null;
  }
  const stride = Math.max(
    1,
    Math.floor(Math.sqrt((width * height) / STARTING_VIEW_SAMPLE_TARGET)),
  );
  const [clearRed, clearGreen, clearBlue] = STARTING_VIEW_CLEAR_COLOR_BYTES;
  let sampled = 0;
  let nearBlack = 0;
  let covered = 0;
  let luminanceSum = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset]!;
      const green = pixels[offset + 1]!;
      const blue = pixels[offset + 2]!;
      const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
      sampled += 1;
      luminanceSum += luminance;
      if (luminance <= STARTING_VIEW_NEAR_BLACK_LUMINANCE_CEILING) nearBlack += 1;
      if (
        Math.abs(red - clearRed) > STARTING_VIEW_CLEAR_COLOR_BYTE_TOLERANCE ||
        Math.abs(green - clearGreen) > STARTING_VIEW_CLEAR_COLOR_BYTE_TOLERANCE ||
        Math.abs(blue - clearBlue) > STARTING_VIEW_CLEAR_COLOR_BYTE_TOLERANCE
      ) covered += 1;
    }
  }
  if (!sampled) return null;
  return {
    schemaVersion: STARTING_VIEW_QUALITY_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    frame: { width, height, sampledPixels: sampled },
    nearBlackFraction: nearBlack / sampled,
    meanLuminance: luminanceSum / sampled,
    renderedCoverageFraction: covered / sampled,
  };
}

// The area-weighted centroid of the approved walkable region: the one point
// the navigation evidence itself nominates as "where the scene is". A plain
// vertex average would let one densely triangulated corridor drag the
// suggested view away from the rooms.
function walkableRegionCentroid(runtime: NavigationRuntime): THREE.Vector3 | null {
  const { vertices, indices } = runtime.navigationMesh;
  if (!vertices.length) return null;
  const centroid = new THREE.Vector3();
  let weight = 0;
  const cornerA = new THREE.Vector3();
  const cornerB = new THREE.Vector3();
  const cornerC = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  for (let index = 0; index + 2 < indices.length; index += 3) {
    const a = vertices[indices[index]!];
    const b = vertices[indices[index + 1]!];
    const c = vertices[indices[index + 2]!];
    if (!a || !b || !c) continue;
    cornerA.fromArray(a);
    cornerB.fromArray(b);
    cornerC.fromArray(c);
    const area = edgeAB.subVectors(cornerB, cornerA)
      .cross(edgeAC.subVectors(cornerC, cornerA))
      .length() / 2;
    if (!(area > 0)) continue;
    centroid.addScaledVector(cornerA, area / 3);
    centroid.addScaledVector(cornerB, area / 3);
    centroid.addScaledVector(cornerC, area / 3);
    weight += area;
  }
  if (weight > 0) return centroid.divideScalar(weight);
  // Degenerate mesh (collinear or duplicate triangles): fall back to the
  // vertex average rather than suggesting nothing.
  for (const vertex of vertices) centroid.add(cornerA.fromArray(vertex));
  return centroid.divideScalar(vertices.length);
}

// Receipt for 45 degrees: the suggestion exists to stop a spawn from facing
// away from the scene, not to fight an authored framing. Within a quarter
// turn of the centroid the room is already in frame at a 58-degree default
// FOV, so the authored heading is kept for stability; beyond it the visitor
// would open facing mostly off-content and the centroid heading wins.
const STARTING_HEADING_KEEP_AUTHORED_RADIANS = Math.PI / 4;
// Standing within arm's reach of the centroid, every heading frames the room
// equally and the bearing to the centroid is numerically meaningless.
const STARTING_HEADING_MIN_CENTROID_DISTANCE_METRES = 0.75;

// Suggests the default walk-spawn heading: from the placed standing position,
// face the centroid of the approved walkable region so the first frame looks
// into the scene rather than at the darkest unreconstructed corner. Heading
// only — the placed position, eye height, ready gating, and body authority
// are untouched. Callers apply this only when no operator-captured starting
// view exists; a captured view is authored content and keeps its heading.
function faceWalkableRegionCentroid(
  camera: THREE.PerspectiveCamera,
  runtime: NavigationRuntime,
): void {
  const centroid = walkableRegionCentroid(runtime);
  if (!centroid) return;
  const toCentroid = new THREE.Vector3(
    centroid.x - camera.position.x,
    0,
    centroid.z - camera.position.z,
  );
  if (toCentroid.length() < STARTING_HEADING_MIN_CENTROID_DISTANCE_METRES) return;
  toCentroid.normalize();
  const heading = camera.getWorldDirection(new THREE.Vector3());
  heading.y = 0;
  if (
    heading.lengthSq() >= 1e-8 &&
    heading.normalize().angleTo(toCentroid) <= STARTING_HEADING_KEEP_AUTHORED_RADIANS
  ) return;
  camera.up.set(0, 1, 0);
  camera.lookAt(camera.position.clone().add(toCentroid));
}

// Levels the camera for standing movement: world-vertical up, level gaze, and
// the heading preserved from whatever orientation the camera held. The
// approved floor-plan frame is Y-up and the walking runtime's gravity is -Y,
// so an authored camera up that leans away from world Y is a review-framing
// artifact, never a walking frame.
function levelCameraForWalking(camera: THREE.PerspectiveCamera): void {
  const heading = camera.getWorldDirection(new THREE.Vector3());
  heading.y = 0;
  if (heading.lengthSq() < 1e-8) {
    // Looking along the pole: for a roll-free camera the screen-up vector
    // lies in the vertical plane of the heading — toward it looking down,
    // away from it looking up.
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    heading.set(screenUp.x, 0, screenUp.z);
    if (camera.getWorldDirection(new THREE.Vector3()).y > 0) heading.negate();
  }
  if (heading.lengthSq() < 1e-8) heading.set(0, 0, -1);
  heading.normalize();
  camera.up.set(0, 1, 0);
  camera.lookAt(camera.position.clone().add(heading));
}

function anchorCameraToWalkable(camera: THREE.PerspectiveCamera): boolean {
  if (
    collisionDrivenMovement &&
    movementMode === "fly" &&
    physicalNavigationRuntime
  ) {
    const position = camera.position.toArray() as Vector3Tuple;
    if (!physicalNavigationRuntime.placeCamera(position)) {
      lastWalkablePosition = null;
      return false;
    }
    lastWalkablePosition = camera.position.clone();
    return false;
  }
  if (collisionDrivenMovement && physicalNavigationRuntime) {
    // Walk mode: an externally supplied camera is a teleport request, and a
    // teleport must pass the same placement validation as any other. A
    // rejected placement recovers the camera from the body — the body never
    // silently follows a camera through reviewed collision geometry.
    const requested = camera.position.toArray() as Vector3Tuple;
    const projected = detourNavigationRuntime?.projectCamera(requested) ?? requested;
    const placed = physicalNavigationRuntime.placeCamera(projected);
    if (placed) {
      const adjusted = camera.position.distanceToSquared(
        new THREE.Vector3().fromArray(placed),
      ) > 1e-12;
      camera.position.fromArray(placed);
      lastWalkablePosition = camera.position.clone();
      return adjusted;
    }
    camera.position.fromArray(physicalNavigationRuntime.cameraPosition());
    lastWalkablePosition = camera.position.clone();
    return true;
  }
  if (detourNavigationRuntime) {
    const nearest = detourNavigationRuntime.projectCamera(
      camera.position.toArray() as Vector3Tuple,
    );
    if (!nearest) {
      lastWalkablePosition = null;
      return false;
    }
    const target = new THREE.Vector3().fromArray(nearest);
    const adjusted = camera.position.distanceToSquared(target) > 1e-12;
    camera.position.copy(target);
    lastWalkablePosition = camera.position.clone();
    return adjusted;
  }
  if (navigationRuntime) {
    const nearest = nearestNavigationPoint(
      camera.position.toArray() as Vector3Tuple,
      navigationRuntime,
    );
    if (!nearest) {
      lastWalkablePosition = null;
      return false;
    }
    const target = new THREE.Vector3().fromArray(nearest);
    const adjusted = camera.position.distanceToSquared(target) > 1e-12;
    camera.position.copy(target);
    lastWalkablePosition = camera.position.clone();
    return adjusted;
  }
  if (!walkableBoxes.length) {
    lastWalkablePosition = null;
    return false;
  }
  const nearest = nearestWalkablePoint(
    camera.position.toArray() as Vector3Tuple,
    walkableBoxes.map(({ min, max }) => ({
      min: min.toArray() as Vector3Tuple,
      max: max.toArray() as Vector3Tuple,
    })),
  );
  if (!nearest) {
    lastWalkablePosition = null;
    return false;
  }
  const target = new THREE.Vector3().fromArray(nearest);
  const adjusted = camera.position.distanceToSquared(target) > 1e-12;
  camera.position.copy(target);
  lastWalkablePosition = camera.position.clone();
  return adjusted;
}

function setMovementAvailability(
  controls: ReturnType<typeof createSpatialLookControls>,
  available: boolean,
): void {
  controls.setTranslationEnabled(available);
  controls.setNavigationBounds(available && !collisionDrivenMovement ? walkableBoxes : []);
  mobileControls.setReady(available && readySent);
  mobileMovementHelp.textContent = available
    ? collisionDrivenMovement && movementMode === "fly"
      ? "Drag to look · fly with the joystick · Rise and Lower change altitude"
      : "Drag to look · move with the left-thumb joystick"
    : "Walking map required before this scene can be viewed";
  desktopMovementHelp.textContent = available
    ? collisionDrivenMovement && movementMode === "fly"
      ? "Click or drag to look · Esc releases mouse look · move through the full camera direction"
      : "Click or drag to look · Esc releases mouse look · scroll or two-finger swipe to travel"
    : "Walking map required before this scene can be viewed";
  desktopKeyboardHelp.hidden = !available;
  desktopVerticalHelp.hidden = !available || !collisionDrivenMovement || movementMode !== "fly";
  flightAltitudeControls.hidden = !available || !collisionDrivenMovement ||
    movementMode !== "fly" || !mobileControls.active;
}

function frameScene(mesh: SplatMesh, camera: THREE.PerspectiveCamera): void {
  mesh.updateMatrixWorld(true);
  const bounds = mesh.getBoundingBox().clone().applyMatrix4(mesh.matrixWorld);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center;
  const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;
  camera.near = Math.max(0.005, radius / 2_000);
  camera.far = Math.max(1_000, radius * 50);
  camera.position.copy(center).add(new THREE.Vector3(radius * 0.65, radius * 0.28, radius * 1.85));
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

function resize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function pixelRatioFor(budgetMillions: number): number {
  const mobile = matchMedia("(any-pointer: coarse)").matches;
  const ceiling = mobile || budgetMillions <= 1 ? 1.35 : 1.75;
  return Math.min(window.devicePixelRatio || 1, ceiling);
}

function setProgress(progress: number, detail: string): void {
  const bounded = Math.min(100, Math.max(0, progress));
  progressBar.style.width = `${bounded}%`;
  loadingTitle.textContent = bounded >= 86 ? "Finalising the view" : "Loading spatial scene";
  loadingDetail.textContent = detail;
  post({
    source: "spatial-spark",
    type: "progress",
    progress: bounded,
    detail,
  });
}

function fail(code: string, message: string): void {
  fatalFailure = true;
  resetButton.disabled = true;
  mobileControls.setReady(false);
  if (rendererControls) setMovementAvailability(rendererControls, false);
  loading.classList.add("is-complete");
  loading.setAttribute("aria-hidden", "true");
  errorPanel.hidden = false;
  errorTitle.textContent = "The spatial scene could not be rendered.";
  errorDetail.textContent = message;
  post({ source: "spatial-spark", type: "error", code, message });
}

function post(message: RendererMessage): void {
  if (window.parent === window) return;
  window.parent.postMessage(message, parentOrigin);
}

function updateFullscreenControl(): void {
  fullscreenButton.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
  fullscreenButton.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
}

function bindChrome(): void {
  resetButton.addEventListener("click", resetView);
  movementModeToggle.addEventListener("click", toggleMovementMode);
  flyAscend.addEventListener("pointerdown", startFlyAscend);
  flyDescend.addEventListener("pointerdown", startFlyDescend);
  for (const button of [flyAscend, flyDescend]) {
    button.addEventListener("pointerup", stopMobileVerticalMovement);
    button.addEventListener("pointercancel", stopMobileVerticalMovement);
    button.addEventListener("lostpointercapture", stopMobileVerticalMovement);
  }
  helpButton.addEventListener("click", toggleHelp);
  fullscreenButton.addEventListener("click", requestFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenControl);
  window.addEventListener("resize", handleControlHelpResize);
}

function toggleMovementMode(): void {
  const camera = activeCamera();
  if (!camera || !physicalNavigationRuntime || !collisionDrivenMovement) return;
  const nextMode: PhysicalMovementMode = movementMode === "walk" ? "fly" : "walk";
  if (!physicalNavigationRuntime.setMode(
    nextMode,
    camera.position.toArray() as Vector3Tuple,
  )) {
    setControlStatus(
      nextMode === "walk"
        ? "Cannot land here · move into clear structural space"
        : "Cannot enter Fly mode at this position",
      "error",
    );
    return;
  }
  movementMode = nextMode;
  detourNavigationRuntime?.cancelAuthoredTraversal();
  authoredTraversalOverlay?.update(null);
  stopMobileVerticalMovement();
  rendererControls?.setMovementMode(nextMode);
  if (nextMode === "walk") {
    // Landing means standing: gravity owns the vertical, so the walking frame
    // is world Y even when the release opened on an authored fly framing with
    // its own up vector. Re-aligning here levels any authored roll away while
    // keeping the direction the pilot was looking.
    camera.up.set(0, 1, 0);
  }
  rendererControls?.align(camera);
  lastWalkablePosition = camera.position.clone();
  updateMovementModeChrome();
  setControlStatus(movementStatusText(), "ready");
  canvas.focus({ preventScroll: true });
  post({ source: "spatial-spark", type: "movement-mode", mode: nextMode });
}

function updateMovementModeChrome(): void {
  movementModeToggle.hidden = !collisionDrivenMovement;
  const compact = matchMedia("(any-pointer: coarse)").matches;
  movementModeToggle.textContent = movementMode === "walk"
    ? (compact ? "Fly" : "Fly mode")
    : (compact ? "Walk" : "Walk mode");
  movementModeToggle.setAttribute("aria-pressed", String(movementMode === "fly"));
  desktopVerticalHelp.hidden = !movementRuntimeReady || movementMode !== "fly";
  flightAltitudeControls.hidden = !movementRuntimeReady || movementMode !== "fly" ||
    !mobileControls.active;
  desktopMovementHelp.textContent = movementMode === "fly"
    ? "Click or drag to look · Esc releases mouse look · move through the full camera direction"
    : "Click or drag to look · Esc releases mouse look · scroll or two-finger swipe to travel";
}

function movementStatusText(): string {
  return movementMode === "fly"
    ? "Fly enabled · structural shell collision · furniture ignored"
    : "Walk enabled · structural shell collision · furniture ignored";
}

// A reviewed shell stops the walker at surfaces the capture shows but never
// opened — an exterior door, or a wall the operator authored across a visible
// gap. Without a word the scene reads as broken input, so hold the requested
// direction against the achieved one and name the boundary once it is clear
// the walker is leaning on it rather than brushing past a corner.
const BLOCKED_MOVEMENT_HINT_SECONDS = 1.2;
const BLOCKED_MOVEMENT_EPSILON_METRES = 1e-4;
type BlockedMovementBarrier = {
  id: string;
  kind: "dynamic" | "structural" | "solid_furniture" | "no_go";
};
let blockedMovementSeconds = 0;
let blockedMovementHintShown = false;
let blockedMovementBarrier: BlockedMovementBarrier | null = null;

function noteMovementResistance(
  origin: Vector3Tuple,
  desired: Vector3Tuple,
  resolved: Vector3Tuple | null,
  deltaSeconds: number,
): void {
  const requestedX = desired[0] - origin[0];
  const requestedZ = desired[2] - origin[2];
  const requested = Math.hypot(requestedX, requestedZ);
  // Measure progress along the requested heading rather than raw displacement:
  // a capsule leaning on a wall keeps sliding sideways, which reads as motion
  // while the walker gets nowhere it asked to go.
  const advanced = requested > BLOCKED_MOVEMENT_EPSILON_METRES && resolved
    ? ((resolved[0] - origin[0]) * requestedX + (resolved[2] - origin[2]) * requestedZ) / requested
    : 0;
  if (requested <= BLOCKED_MOVEMENT_EPSILON_METRES || advanced > requested * 0.25) {
    blockedMovementSeconds = 0;
    blockedMovementBarrier = null;
    if (blockedMovementHintShown) {
      blockedMovementHintShown = false;
      setControlStatus(movementStatusText(), "ready");
    }
    return;
  }
  // Rapier reports the contact that starts the stop, but may report only the
  // supporting floor once the capsule is resting. Keep that first reviewed
  // blocker for this uninterrupted resistance episode so the delayed hint
  // still names the geometry that caused it.
  blockedMovementBarrier ??= physicalNavigationRuntime?.lastBlockedBarrier() ??
    physicalNavigationRuntime?.blockedStructuralBarrierNear(origin, desired) ??
    null;
  blockedMovementSeconds += deltaSeconds;
  if (blockedMovementSeconds >= BLOCKED_MOVEMENT_HINT_SECONDS && !blockedMovementHintShown) {
    blockedMovementHintShown = true;
    setControlStatus(
      blockedMovementMessage(blockedMovementBarrier),
      "info",
    );
  }
}

// A stopped walker deserves to know which reviewed geometry stopped them:
// a real wall, a closed door, and the edge of the captured world all feel
// identical from inside, and only the name tells an operator whether the
// scene or the walker is wrong.
function blockedMovementMessage(
  blocker: BlockedMovementBarrier | null,
): string {
  if (!blocker) return "Blocked by the walking map · this surface has no reviewed opening";
  if (blocker.kind === "dynamic") {
    return `Blocked by ${blocker.id} · this door is closed`;
  }
  if (blocker.kind === "solid_furniture") {
    return `Blocked by ${blocker.id} · solid furniture`;
  }
  if (blocker.kind === "no_go") {
    return `Blocked by ${blocker.id} · reviewed no-go volume`;
  }
  if (blocker.id.startsWith("auto-capture-ring-")) {
    return "Blocked at the reviewed edge of the captured world";
  }
  const automaticWall = blocker.id.match(/^auto-barrier-(.+)-\d+$/);
  if (automaticWall) {
    return `Blocked by ${automaticWall[1]} · automatic structural wall`;
  }
  if (blocker.id.startsWith("auto-threshold-")) {
    return `Blocked by ${blocker.id} · reviewed threshold`;
  }
  return `Blocked by ${blocker.id} · reviewed structural wall`;
}

function startFlyAscend(event: PointerEvent): void {
  startMobileVerticalMovement(event, flyAscend, 1);
}

function startFlyDescend(event: PointerEvent): void {
  startMobileVerticalMovement(event, flyDescend, -1);
}

function startMobileVerticalMovement(
  event: PointerEvent,
  button: HTMLButtonElement,
  direction: -1 | 1,
): void {
  if (!movementRuntimeReady || movementMode !== "fly" || !mobileControls.active) return;
  event.preventDefault();
  mobileVerticalMovement = direction;
  button.toggleAttribute("data-active", true);
  try {
    button.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic and assistive pointer sources may not expose native capture.
  }
}

function stopMobileVerticalMovement(): void {
  mobileVerticalMovement = 0;
  flyAscend.removeAttribute("data-active");
  flyDescend.removeAttribute("data-active");
}

function resetView(): void {
  if (!initialView) return;
  mobileControls.suspend();
  stopMobileVerticalMovement();
  const camera = activeCamera();
  if (!camera) return;
  camera.position.copy(initialView.position);
  camera.quaternion.copy(initialView.quaternion);
  if (physicalNavigationRuntime) {
    const restored = physicalNavigationRuntime.placeCamera(
      camera.position.toArray() as Vector3Tuple,
    );
    if (restored) {
      camera.position.fromArray(restored);
    } else {
      const opening = detourNavigationRuntime?.openingCamera();
      const placedOpening = opening ? physicalNavigationRuntime.placeCamera(opening) : null;
      if (placedOpening) camera.position.fromArray(placedOpening);
    }
  }
  rendererControls?.align(camera);
  if (navigationRuntime && isCameraPositionAllowed(camera.position)) {
    lastWalkablePosition = camera.position.clone();
  }
  setControlStatus("Opening view restored");
  // The click leaves focus on the Reset button, and movement keys targeted at
  // a button are deliberately ignored so keyboard button activation still
  // works. Walking must resume immediately after a reset, so hand focus back
  // to the canvas the same way the movement-mode toggle does.
  canvas.focus({ preventScroll: true });
}

function toggleHelp(): void {
  setControlHelpVisible(helpPanel.hidden);
}

function setControlHelpVisible(visible: boolean): void {
  helpPanel.hidden = !visible;
  helpButton.setAttribute("aria-expanded", String(visible));
  sparkViewport.classList.toggle("control-help-open", visible);
  post({
    source: "spatial-spark",
    type: "control-help",
    visible,
    height: visible ? Math.ceil(helpPanel.getBoundingClientRect().height) : 0,
  });
}

function handleControlHelpResize(): void {
  if (helpPanel.hidden) return;
  setControlHelpVisible(true);
}

function requestFullscreen(): void {
  void runAction({
    key: "renderer-fullscreen",
    trigger: fullscreenButton,
    pendingLabel: document.fullscreenElement ? "Exiting…" : "Entering…",
    idleLabel: () => document.fullscreenElement ? "Exit full screen" : "Full screen",
  }, async () => {
    setControlStatus("");
    try {
      await toggleFullscreen();
    } catch (error) {
      setControlStatus(
        error instanceof Error
          ? `Full screen is unavailable: ${error.message}`
          : "Full screen is unavailable in this browser.",
        "error",
      );
    }
  });
}

async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  await byId<HTMLElement>("sparkViewport").requestFullscreen();
}

function activeCamera(): THREE.PerspectiveCamera | null {
  return rendererCamera;
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 ** 2) return `${(value / 1_024).toFixed(1)} KiB`;
  if (value < 1_024 ** 3) return `${(value / 1_024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1_024 ** 3).toFixed(1)} GiB`;
}

function formatCount(value: number): string {
  return value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 2)}M`
    : `${Math.round(value / 1_000)}K`;
}

function dispose(): void {
  if (__SPATIAL_E2E__) {
    window.removeEventListener("spatial:e2e-mobile-controls-ready", enableMobileControlsForTest);
  }
  window.removeEventListener("resize", handleControlHelpResize);
  document.removeEventListener("fullscreenchange", updateFullscreenControl);
  resetButton.removeEventListener("click", resetView);
  movementModeToggle.removeEventListener("click", toggleMovementMode);
  flyAscend.removeEventListener("pointerdown", startFlyAscend);
  flyDescend.removeEventListener("pointerdown", startFlyDescend);
  for (const button of [flyAscend, flyDescend]) {
    button.removeEventListener("pointerup", stopMobileVerticalMovement);
    button.removeEventListener("pointercancel", stopMobileVerticalMovement);
    button.removeEventListener("lostpointercapture", stopMobileVerticalMovement);
  }
  helpButton.removeEventListener("click", toggleHelp);
  fullscreenButton.removeEventListener("click", requestFullscreen);
  if (heartbeatHandle !== null) {
    window.clearInterval(heartbeatHandle);
    heartbeatHandle = null;
  }
  mobileControls.dispose();
  rendererControls?.dispose();
  detourNavigationRuntime?.destroy();
  detourNavigationRuntime = null;
  physicalNavigationRuntime?.destroy();
  physicalNavigationRuntime = null;
  resizeObserver?.disconnect();
  renderLoopRunning = false;
  webglRenderer?.setAnimationLoop(null);
  splatMesh?.dispose();
  sparkRenderer?.dispose();
  webglRenderer?.dispose();
  rendererCamera = null;
  rendererControls = null;
}
