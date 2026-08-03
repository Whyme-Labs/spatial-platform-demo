import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/latin-600.css";
import {
  SparkRenderer,
  SplatMesh,
} from "@sparkjsdev/spark";
import * as THREE from "three";
import { runAction } from "../client/action-state";
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

declare const __SPATIAL_E2E__: boolean;

const SPARK_RUNTIME_VERSION = "2.1.0";
const parentOrigin = location.origin;
const startedAt = performance.now();

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
      type: "control-onboarding";
      visible: boolean;
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
const freeRoamToggle = byId<HTMLButtonElement>("freeRoamToggle");
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
    toggle: freeRoamToggle,
    pad: byId("movementPad"),
    knob: byId("movementKnob"),
    status: byId("movementStatus"),
    lookHint: byId("mobileLookHint"),
    onboarding: byId("mobileOnboarding"),
    onboardingStart: byId<HTMLButtonElement>("startFreeRoam"),
    onboardingDismiss: byId<HTMLButtonElement>("dismissMobileOnboarding"),
  },
  onModeChange: (active) => {
    post({
      source: "spatial-spark",
      type: "control-mode",
      mode: active ? "free-roam" : "orbit",
    });
    updateMovementModeChrome();
  },
  onOnboardingChange: (visible) => {
    post({
      source: "spatial-spark",
      type: "control-onboarding",
      visible,
    });
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
let lastWalkablePosition: THREE.Vector3 | null = null;
let lastCameraBroadcastAt = 0;
let lastBroadcastPosition: THREE.Vector3 | null = null;
let lastBroadcastDirection: THREE.Vector3 | null = null;
let sceneAuthoringSession: SceneAuthoringSession | null = null;

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
  const spark = new SparkRenderer({
    renderer,
    lodSplatCount: budgetSplats,
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
  const authoringMarkers = new THREE.Group();
  const authoringMarkerGeometry = new THREE.SphereGeometry(0.045, 12, 8);
  const authoringMarkerMaterial = new THREE.MeshBasicMaterial({
    color: 0xc8ff42,
    depthTest: false,
  });
  authoringMarkers.name = "spatial-authoring-markers";
  scene.add(authoringMarkers);
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.origin !== parentOrigin || event.source !== window.parent) return;
    if (!event.data || typeof event.data !== "object") return;
    if (Reflect.get(event.data, "source") !== "spatial-host") return;
    if (Reflect.get(event.data, "type") === "set-authoring-mode") {
      const requestId = Reflect.get(event.data, "requestId");
      const requestedMode = Reflect.get(event.data, "mode");
      const mode = requestedMode === "room" || requestedMode === "wall" ||
          requestedMode === "opening" || requestedMode === "connector"
        ? requestedMode
        : null;
      if (typeof requestId !== "string") return;
      sceneAuthoringSession = mode ? { mode, requestId, points: [] } : null;
      authoringMarkers.clear();
      controls.setLookEnabled(!mode);
      controls.setTranslationEnabled(mode ? false : movementRuntimeReady);
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
        walkableBoxes = authoredBoxes;
        const navigationArtifact = Reflect.get(event.data, "navigationArtifact");
        if (!navigationArtifact || typeof navigationArtifact !== "object") {
          navigationRuntime = null;
          walkableBoxes = [];
          walkableBoundarySource = "none";
          fail(
            "WALKING_MAP_REQUIRED",
            "This scene has no approved walking map and cannot be viewed.",
          );
          return;
        }
        const structuralV7 = navigationArtifact && typeof navigationArtifact === "object" &&
          ["spatial-navigation-v7", "spatial-navigation-v8", "spatial-navigation-v9"].includes(
            String(Reflect.get(navigationArtifact, "schemaVersion")),
          );
        const requestedMode = Reflect.get(runtimeMessage, "defaultMovementMode");
        const preserveAuthoredFlyOpening = structuralV7 && requestedMode === "fly";
        walkableBoxes = [];
        if (!walkableBoxes.length) {
          const bounds = navigationMeshBounds(authoredRuntime);
          if (bounds) walkableBoxes = [bounds];
        }
        walkableBoundarySource = "authored";
        movementRuntimeReady = false;
        setMovementAvailability(controls, movementRuntimeReady);
        if (preserveAuthoredFlyOpening) {
          lastWalkablePosition = camera.position.clone();
        } else {
          anchorCameraToWalkable(camera);
        }
        const obstacleCount = authoredRuntime.obstacleBoxes.length;
        setControlStatus(
          `Walking enabled · ${obstacleCount
            ? `${obstacleCount} obstacle${obstacleCount === 1 ? "" : "s"} mapped`
            : "clear route map"}`,
          "ready",
        );
        setMovementAvailability(controls, false);
        setControlStatus("Preparing verified walking map");
        const collisionUrl = Reflect.get(event.data, "collisionUrl");
        if (typeof collisionUrl !== "string" || !collisionUrl) {
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
            const results = await Promise.allSettled([
              detourModule.DetourNavigationRuntime.create(navigationArtifact),
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
            camera.position.fromArray(projected);
            if (!physicalRuntime.placeCamera(projected)) {
              runtime.destroy();
              physicalRuntime.destroy();
              throw new Error("Opening camera overlaps reviewed collision geometry");
            }
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
      if (supported) {
        detourNavigationRuntime!.setDynamicBarrierState(barrierId, active as boolean);
        physicalNavigationRuntime!.setDynamicBarrierState(barrierId, active as boolean);
      }
      if (requestId) {
        post({
          source: "spatial-spark",
          type: "dynamic-barrier-state",
          requestId,
          barrierId,
          active: active === true,
          accepted: supported,
          message: supported
            ? `${barrierId} is now ${active ? "closed" : "open"}`
            : "The requested dynamic barrier is not part of this verified runtime.",
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
      if (
        physicalNavigationRuntime &&
        !physicalNavigationRuntime.placeCamera(acceptedPosition.toArray() as Vector3Tuple)
      ) {
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
    post({
      source: "spatial-spark",
      type: "camera",
      requestId: String(Reflect.get(event.data, "requestId")),
      cameraPose: cameraPose(camera),
    });
  });

  setProgress(9, config.format === "rad" ? "Opening the paged RAD scene" : "Loading the Spark scene");
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
  renderer.setAnimationLoop(() => {
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
      const resolved = physicalNavigationRuntime.moveCamera(
        origin,
        desired,
        deltaSeconds,
      );
      if (resolved) {
        camera.position.fromArray(resolved);
        lastWalkablePosition = camera.position.clone();
      } else if (lastWalkablePosition) {
        camera.position.copy(lastWalkablePosition);
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
    if (!readySent && movementRuntimeReady) {
      readySent = true;
      resetButton.disabled = false;
      setMovementAvailability(controls, movementRuntimeReady);
      const timeToFirstFrameMs = Math.round(performance.now() - startedAt);
      setProgress(100, "Spatial scene ready");
      loading.classList.add("is-complete");
      loading.setAttribute("aria-hidden", "true");
      loading.hidden = true;
      post({
        source: "spatial-spark",
        type: "ready",
        runtime: "spark",
        version: SPARK_RUNTIME_VERSION,
        timeToFirstFrameMs,
        format: config.format,
        splatBudget: budgetSplats,
      });
      canvas.focus({ preventScroll: true });
    }
  });

  window.addEventListener("pagehide", dispose, { once: true });
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
  if (now - lastCameraBroadcastAt < 180) return;
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
  freeRoamToggle.textContent = available
    ? (mobileControls.active ? "Exit roam" : "Free roam")
    : "Walking required";
  freeRoamToggle.title = available
    ? "Enable touch-friendly movement"
    : "This scene is blocked until its walking map is available";
  mobileMovementHelp.textContent = available
    ? collisionDrivenMovement && movementMode === "fly"
      ? "Drag to look · use Free roam to fly · Rise and Lower change altitude"
      : "Drag to look · use the Free roam joystick to move"
    : "Walking map required before this scene can be viewed";
  desktopMovementHelp.textContent = available
    ? collisionDrivenMovement && movementMode === "fly"
      ? "Drag to look · move through the full camera direction"
      : "Drag to look · scroll or two-finger swipe to travel"
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
    ? "Drag to look · move through the full camera direction"
    : "Drag to look · scroll or two-finger swipe to travel";
}

function movementStatusText(): string {
  return movementMode === "fly"
    ? "Fly enabled · structural shell collision · furniture ignored"
    : "Walk enabled · structural shell collision · furniture ignored";
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
  if (
    physicalNavigationRuntime &&
    !physicalNavigationRuntime.placeCamera(camera.position.toArray() as Vector3Tuple)
  ) {
    const opening = detourNavigationRuntime?.openingCamera();
    if (opening && physicalNavigationRuntime.placeCamera(opening)) {
      camera.position.fromArray(opening);
    }
  }
  rendererControls?.align(camera);
  if (navigationRuntime && isCameraPositionAllowed(camera.position)) {
    lastWalkablePosition = camera.position.clone();
  }
  setControlStatus("Opening view restored");
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
  mobileControls.dispose();
  rendererControls?.dispose();
  detourNavigationRuntime?.destroy();
  detourNavigationRuntime = null;
  physicalNavigationRuntime?.destroy();
  physicalNavigationRuntime = null;
  resizeObserver?.disconnect();
  webglRenderer?.setAnimationLoop(null);
  splatMesh?.dispose();
  sparkRenderer?.dispose();
  webglRenderer?.dispose();
  rendererCamera = null;
  rendererControls = null;
}
