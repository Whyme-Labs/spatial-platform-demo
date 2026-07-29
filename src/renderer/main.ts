import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/latin-600.css";
import {
  SparkControls,
  SparkRenderer,
  SplatMesh,
} from "@sparkjsdev/spark";
import * as THREE from "three";
import { runAction } from "../client/action-state";
import {
  MobileControlSurface,
  nearestWalkablePoint,
  planarCameraStep,
} from "./mobile-controls";

declare const __SPATIAL_E2E__: boolean;

const SPARK_RUNTIME_VERSION = "2.1.0";
const parentOrigin = location.origin;
const startedAt = performance.now();

type SparkSceneFormat = "rad" | "spz" | "sog";
type Vector3Tuple = [number, number, number];

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
const fullscreenButton = byId<HTMLButtonElement>("enterFullscreen");
const controlStatus = byId<HTMLElement>("controlStatus");
const mobileControls = new MobileControlSurface({
  coarsePointer: matchMedia("(any-pointer: coarse)"),
  elements: {
    viewport: byId("sparkViewport"),
    toggle: byId<HTMLButtonElement>("freeRoamToggle"),
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
  },
});
const enableMobileControlsForTest = (): void => mobileControls.setReady(true);
if (__SPATIAL_E2E__) {
  window.addEventListener("spatial:e2e-mobile-controls-ready", enableMobileControlsForTest);
}

let sparkRenderer: SparkRenderer | null = null;
let splatMesh: SplatMesh | null = null;
let webglRenderer: THREE.WebGLRenderer | null = null;
let rendererCamera: THREE.PerspectiveCamera | null = null;
let resizeObserver: ResizeObserver | null = null;
let initialView: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null;
let readySent = false;
let walkableBoxes: Array<{ min: THREE.Vector3; max: THREE.Vector3 }> = [];
let lastWalkablePosition: THREE.Vector3 | null = null;
let lastCameraBroadcastAt = 0;
let lastBroadcastPosition: THREE.Vector3 | null = null;
let lastBroadcastDirection: THREE.Vector3 | null = null;

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

  const controls = new SparkControls({ canvas });
  controls.fpsMovement.moveSpeed = 1.4;
  controls.fpsMovement.shiftMultiplier = 3;
  controls.pointerControls.scrollSpeed = 0.8;
  controls.pointerControls.moveInertia = 0.82;
  controls.pointerControls.rotateInertia = 0.78;
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.origin !== parentOrigin || event.source !== window.parent) return;
    if (!event.data || typeof event.data !== "object") return;
    if (Reflect.get(event.data, "source") !== "spatial-host") return;
    if (Reflect.get(event.data, "type") === "set-spatial-runtime") {
      const boxes = Reflect.get(event.data, "collisionBoxes");
      walkableBoxes = Array.isArray(boxes)
        ? boxes.flatMap((box) => {
            if (!box || typeof box !== "object") return [];
            const min = finiteVector3(Reflect.get(box, "min"));
            const max = finiteVector3(Reflect.get(box, "max"));
            return min && max ? [{ min, max }] : [];
          })
        : [];
      const cameraAdjusted = anchorCameraToWalkable(camera);
      controlStatus.textContent = walkableBoxes.length
        ? `${walkableBoxes.length} authored walkable region${walkableBoxes.length === 1 ? "" : "s"} active${cameraAdjusted ? " · view aligned" : ""}`
        : "";
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
      if (walkableBoxes.length && !isWalkable(requestedPosition)) {
        if (requestId) {
          post({
            source: "spatial-spark",
            type: "camera-set",
            requestId,
            accepted: false,
            message: "The authored room camera is outside the walkable collision boundary.",
            cameraPose: cameraPose(camera),
          });
        }
        return;
      }
      camera.position.fromArray(pose.position);
      camera.up.fromArray(pose.up ?? [0, 1, 0]).normalize();
      camera.lookAt(new THREE.Vector3().fromArray(pose.target));
      if (typeof pose.fovDegrees === "number") camera.fov = Math.min(100, Math.max(20, pose.fovDegrees));
      camera.updateProjectionMatrix();
      if (walkableBoxes.length && isWalkable(camera.position)) lastWalkablePosition = camera.position.clone();
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
  if (config.sceneRotationDegrees) {
    mesh.rotation.set(
      THREE.MathUtils.degToRad(config.sceneRotationDegrees[0]),
      THREE.MathUtils.degToRad(config.sceneRotationDegrees[1]),
      THREE.MathUtils.degToRad(config.sceneRotationDegrees[2]),
    );
  }
  splatMesh = mesh;
  scene.add(mesh);

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
  anchorCameraToWalkable(camera);
  initialView = {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
  };
  let lastFrameAt = performance.now();
  const forward = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const deltaSeconds = Math.min(0.05, Math.max(0, (now - lastFrameAt) / 1_000));
    lastFrameAt = now;
    controls.update(camera);
    applyMobileMovement(camera, forward, deltaSeconds);
    if (walkableBoxes.length) {
      if (isWalkable(camera.position)) {
        lastWalkablePosition = camera.position.clone();
      } else if (lastWalkablePosition) {
        camera.position.copy(lastWalkablePosition);
      } else {
        anchorCameraToWalkable(camera);
      }
    }
    broadcastCameraUpdate(camera);
    renderer.render(scene, camera);
    if (!readySent) {
      readySent = true;
      resetButton.disabled = false;
      mobileControls.setReady(true);
      const timeToFirstFrameMs = Math.round(performance.now() - startedAt);
      setProgress(100, "Spatial scene ready");
      window.setTimeout(() => {
        loading.classList.add("is-complete");
        loading.setAttribute("aria-hidden", "true");
      }, 140);
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
      !contentUrl.pathname.startsWith("/comparison-asset/"))
  ) {
    throw new Error("The scene asset URL is outside the trusted release boundary.");
  }

  const rawBudget = Number(params.get("budget") ?? "2");
  const splatBudget = Number.isFinite(rawBudget)
    ? Math.min(8, Math.max(0.25, rawBudget))
    : 2;
  const sceneRotationDegrees = readVector(params.get("rotation"));
  const cameraPosition = readVector(params.get("camera"));
  const cameraTarget = readVector(params.get("target"));
  const cameraUp = readVector(params.get("up"));
  const rawFov = Number(params.get("fov") ?? "58");
  const fovDegrees = Number.isFinite(rawFov) ? Math.min(100, Math.max(20, rawFov)) : 58;
  const initialCamera = cameraPosition && cameraTarget
    ? { position: cameraPosition, target: cameraTarget, up: cameraUp, fovDegrees }
    : null;
  return { contentUrl, format, splatBudget, sceneRotationDegrees, initialCamera };
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

function finiteVector3(value: unknown): THREE.Vector3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const coordinates = value.map(Number);
  if (coordinates.some((coordinate) => !Number.isFinite(coordinate))) return null;
  return new THREE.Vector3(coordinates[0], coordinates[1], coordinates[2]);
}

function isWalkable(position: THREE.Vector3): boolean {
  const horizontalPadding = 0.05;
  const verticalPadding = 0.35;
  return walkableBoxes.some(({ min, max }) =>
    position.x >= min.x - horizontalPadding &&
    position.x <= max.x + horizontalPadding &&
    position.z >= min.z - horizontalPadding &&
    position.z <= max.z + horizontalPadding &&
    position.y >= min.y - verticalPadding &&
    position.y <= max.y + verticalPadding
  );
}

function anchorCameraToWalkable(camera: THREE.PerspectiveCamera): boolean {
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

function frameScene(mesh: SplatMesh, camera: THREE.PerspectiveCamera): void {
  const bounds = mesh.getBoundingBox();
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
  fullscreenButton.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
  fullscreenButton.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement)));
}

function bindChrome(): void {
  resetButton.addEventListener("click", resetView);
  helpButton.addEventListener("click", toggleHelp);
  fullscreenButton.addEventListener("click", requestFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenControl);
}

function resetView(): void {
  if (!initialView) return;
  mobileControls.suspend();
  const camera = activeCamera();
  if (!camera) return;
  camera.position.copy(initialView.position);
  camera.quaternion.copy(initialView.quaternion);
  if (walkableBoxes.length && isWalkable(camera.position)) {
    lastWalkablePosition = camera.position.clone();
  }
  controlStatus.textContent = "View reset";
}

function toggleHelp(): void {
  helpPanel.hidden = !helpPanel.hidden;
  helpButton.setAttribute("aria-expanded", String(!helpPanel.hidden));
}

function requestFullscreen(): void {
  void runAction({
    key: "renderer-fullscreen",
    trigger: fullscreenButton,
    pendingLabel: document.fullscreenElement ? "Exiting…" : "Entering…",
    idleLabel: () => document.fullscreenElement ? "Exit fullscreen" : "Fullscreen",
  }, async () => {
    controlStatus.textContent = "";
    try {
      await toggleFullscreen();
    } catch (error) {
      controlStatus.textContent = error instanceof Error
        ? `Fullscreen is unavailable: ${error.message}`
        : "Fullscreen is unavailable in this browser.";
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

function applyMobileMovement(
  camera: THREE.PerspectiveCamera,
  forward: THREE.Vector3,
  deltaSeconds: number,
): void {
  const movement = mobileControls.movement;
  if (Math.hypot(movement.x, movement.z) < 0.001 || deltaSeconds <= 0) return;
  camera.getWorldDirection(forward);
  camera.position.fromArray(planarCameraStep({
    position: camera.position.toArray() as Vector3Tuple,
    forward: forward.toArray() as Vector3Tuple,
    movement,
    speed: 1.4,
    deltaSeconds,
  }));
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
  document.removeEventListener("fullscreenchange", updateFullscreenControl);
  resetButton.removeEventListener("click", resetView);
  helpButton.removeEventListener("click", toggleHelp);
  fullscreenButton.removeEventListener("click", requestFullscreen);
  mobileControls.dispose();
  resizeObserver?.disconnect();
  webglRenderer?.setAnimationLoop(null);
  splatMesh?.dispose();
  sparkRenderer?.dispose();
  webglRenderer?.dispose();
  rendererCamera = null;
}
