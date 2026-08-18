import { api } from "../../api";
import { runAction } from "../../action-state";
import {
  comparisonModeAvailable,
  comparisonVersionIdsForMode,
  type ComparisonMode,
  type ComparisonReadiness,
} from "../../../shared/comparison-readiness";

export type CompareVersion = {
  id: string;
  version_number: number;
  status: string;
  created_at: string;
};

export type CompareAsset = {
  id: string;
  version_id: string;
  kind: string;
  format: string;
  file_name: string;
  size_bytes: number;
  sha256: string | null;
  integrity_status: string;
};

type ComparisonCameraPose = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovDegrees: number;
};

type ComparisonRenderable = {
  versionId: string;
  assetId: string;
  format: "rad" | "spz" | "sog";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  contentUrl: string;
  collisionUrl: string;
  sessionExpiresAt: string;
  spatial: {
    entities: Array<{ id: string; kind: string }>;
    collisionProxy: { boxes: unknown[] };
    navigationMesh: unknown;
    obstacleProxy: { boxes: unknown[] };
    navigationProfile: unknown;
    navigationArtifact: unknown;
  };
  viewer: {
    splatBudgetMillions?: number;
    defaultMovementMode?: "walk" | "fly";
    sceneRotationDegrees?: [number, number, number];
    sourceToWorld?: unknown;
    initialCamera?: {
      position: [number, number, number];
      target: [number, number, number];
      up?: [number, number, number];
      fovDegrees?: number;
    };
  } | null;
};

type VersionComparison = {
  requested: { left: string; right: string };
  versions: Array<CompareVersion & {
    source_provenance_json: string | null;
    manifest_json: string | null;
    updated_at: string;
  }>;
  reviewDecisionHistory: Array<{
    version_id: string;
    decision: "approved" | "changes_requested";
    reviewer_name?: string;
    reviewer_email?: string;
    note: string | null;
    created_at: string;
  }>;
  reviewCommentHistory: Array<{
    version_id: string;
    kind: string;
    status: string;
    author_name?: string;
    author_email?: string;
    body: string;
    created_at: string;
  }>;
  renderables: ComparisonRenderable[];
};

export type GeometryChangeSummary = {
  method: string;
  result: "changes_detected" | "no_material_change" | "insufficient_correspondence";
  scope: string;
  limitation: string;
  thresholdMm: number;
  coordinateAssurance: string;
  registrationEvidence: string;
  versions: {
    from: { id: string; versionNumber: number };
    to: { id: string; versionNumber: number };
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
  invalidGeometry: Array<{ version: string; entityId: string; label: string; reason: string }>;
  visual: {
    coordinatePlane: "XZ";
    units: "metres";
    bounds: {
      minX: number;
      minZ?: number;
      maxX: number;
      maxZ?: number;
      minY?: number;
      maxY?: number;
    } | null;
    overlays: Array<{
      key: string;
      label: string;
      kind: string;
      classification: "changed" | "unchanged" | "added" | "removed";
      fromPoints: Array<[number, number]> | null;
      toPoints: Array<[number, number]> | null;
    }>;
  };
};

export type GeometryChangeReport = {
  id: string;
  from_version_id: string;
  to_version_id: string;
  status: "ready" | "reviewed";
  summary_json: string;
  method: string;
  result: string | null;
  threshold_mm: number | null;
  coordinate_assurance: string | null;
  registration_evidence: string | null;
  source_geometry_hash: string | null;
  review_decision: "accepted" | "needs_recapture" | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RegisteredSceneChangeSummary = {
  method: "registered-ply-voxel-change-v1";
  result: "changes_detected" | "no_material_change" | "registration_blocked";
  scope: string;
  limitation: string;
  parameters: {
    voxelSizeM: number;
    structuralChangeThresholdPercent: number;
    photometricChangeThresholdPercent: number;
    centroidChangeThresholdMm: number;
  };
  sources: {
    baseline: { vertexCount: number; sampledPointCount: number; samplingStride: number; voxelCount: number; hasPhotometricData: boolean };
    candidate: { vertexCount: number; sampledPointCount: number; samplingStride: number; voxelCount: number; hasPhotometricData: boolean };
  };
  summary: {
    baselineVoxels: number;
    candidateVoxels: number;
    commonVoxels: number;
    addedVoxels: number;
    removedVoxels: number;
    structurallyChangedPercent: number;
    photometricallyComparableVoxels: number;
    changedCommonVoxels: number;
    p95CentroidDisplacementMm: number | null;
    maximumCentroidDisplacementMm: number | null;
    p95PhotometricDeltaPercent: number | null;
    maximumPhotometricDeltaPercent: number | null;
  };
  materialSignals: string[];
  registration?: {
    method?: "bounded-yaw-icp-v1";
    status?: "accepted" | "blocked";
    coordinateAssurance: string;
    evidence: string;
    performedByProcessor: boolean;
    transform?: {
      matrix4x4: number[];
      yawDegrees: number;
      translationM: number[];
      scale: number;
    };
    summary?: {
      overlapPercent: number;
      rmseMm: number;
      p95ResidualMm: number;
      maximumResidualMm: number;
      ambiguous: boolean;
      iterations: number;
    };
    qualityGates?: Array<{
      name: string;
      threshold: number | boolean;
      observed: number | boolean;
      passed: boolean;
    }>;
  };
};

export type RegisteredSceneChangeReport = {
  id: string;
  baseline_version_id: string;
  candidate_version_id: string;
  baseline_asset_id: string;
  candidate_asset_id: string;
  job_id: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "DEAD_LETTER" | "REVIEWED";
  coordinate_assurance: string;
  registration_evidence: string;
  registration_mode: "declared" | "automatic_rigid";
  registration_status: "accepted" | "blocked" | null;
  registration_search_radius_m: number;
  registration_maximum_rmse_mm: number;
  registration_minimum_overlap_percent: number;
  voxel_size_m: number;
  structural_threshold_percent: number;
  photometric_threshold_percent: number;
  centroid_threshold_mm: number;
  maximum_sample_points: number;
  result: "changes_detected" | "no_material_change" | null;
  summary_json: string | null;
  error_json: string | null;
  review_decision: "accepted" | "needs_recapture" | "investigate" | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  completed_at: string | null;
  job_state: string;
  job_progress: number;
  job_progress_message: string | null;
  job_error_json: string | null;
  attempt_count: number;
  max_attempts: number;
  baseline_version_number: number;
  candidate_version_number: number;
  baseline_file_name: string;
  candidate_file_name: string;
};

type CompareProject = {
  id: string;
  versions: CompareVersion[];
  assets: CompareAsset[];
  comparisonReadiness: ComparisonReadiness;
};

export type CompareDomainDependencies = {
  currentProject: () => CompareProject | null;
  currentRawReports: () => RegisteredSceneChangeReport[];
  loadSpatialWorkspace: (projectId: string) => Promise<void>;
  pollingContextIsActive: (projectId: string) => boolean;
  showNotice: (message: string, kind: "error") => void;
  showToast: (message: string) => void;
  humanStatus: (value: string) => string;
  statusClass: (value: string) => string;
  formatBytes: (value: number) => string;
  parseTimestamp: (value: string) => Date;
};

export type CompareStageInput = {
  projectId: string;
  versions: readonly CompareVersion[];
  assets: readonly CompareAsset[];
  geometryReports: readonly GeometryChangeReport[];
  rawReports: readonly RegisteredSceneChangeReport[];
  readiness: ComparisonReadiness;
};

export type CompareDomain = {
  bind: () => void;
  cancel: () => void;
  openVersionComparison: (projectId: string, versions: CompareVersion[]) => void;
  renderStage: (input: CompareStageInput) => HTMLElement;
};

export function createCompareDomain(dependencies: CompareDomainDependencies): CompareDomain {
  let geometryChangeOperation: { id: string; requestKey: string } | null = null;
  let rawSceneChangeOperation: { id: string; requestKey: string } | null = null;
  let rawSceneChangePollGeneration = 0;
  let comparisonProjectId: string | null = null;
  let comparisonVersions: CompareVersion[] = [];
  let comparisonGeneration = 0;
  let comparisonSyncAt = 0;
  let bound = false;
  const comparisonFrameReady = { left: false, right: false };
  const comparisonFrameTimeouts: { left: number | null; right: number | null } = {
    left: null,
    right: null,
  };

  const versionComparisonDialog = () => byId<HTMLDialogElement>("versionComparisonDialog");

  function bind(): void {
    if (bound) return;
    bound = true;
    const geometryForm = byId<HTMLFormElement>("geometryChangeForm");
    const geometrySubmit = geometryForm.querySelector<HTMLButtonElement>("[type='submit']")!;
    geometryForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(geometryForm);
      if (String(form.get("fromVersionId")) === String(form.get("toVersionId"))) {
        byId("geometryChangeError").textContent = "Choose two distinct immutable versions.";
        return;
      }
      void runAction({
        key: "generate-geometry-change",
        trigger: geometrySubmit,
        form: geometryForm,
        pendingLabel: "Comparing geometry…",
        errorTarget: byId("geometryChangeError"),
      }, () => generateChangeReport(form));
    });

    const geometryReviewForm = byId<HTMLFormElement>("geometryChangeReviewForm");
    const geometryReviewSubmit = geometryReviewForm.querySelector<HTMLButtonElement>("[type='submit']")!;
    geometryReviewForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(geometryReviewForm);
      const reportId = String(form.get("reportId") ?? "");
      void runAction({
        key: `review-geometry-change:${reportId}`,
        trigger: geometryReviewSubmit,
        form: geometryReviewForm,
        pendingLabel: "Recording review…",
        errorTarget: byId("geometryChangeReviewError"),
      }, () => reviewGeometryChangeReport(form));
    });

    const rawForm = byId<HTMLFormElement>("rawSceneChangeForm");
    const rawSubmit = rawForm.querySelector<HTMLButtonElement>("[type='submit']")!;
    rawForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(rawForm);
      if (String(form.get("baselineVersionId")) === String(form.get("candidateVersionId"))) {
        byId("rawSceneChangeError").textContent = "Choose two distinct immutable versions.";
        return;
      }
      if (!String(form.get("baselineAssetId")) || !String(form.get("candidateAssetId"))) {
        byId("rawSceneChangeError").textContent = "Each version needs a verified source, master, or point-cloud PLY.";
        return;
      }
      void runAction({
        key: "create-raw-scene-change",
        trigger: rawSubmit,
        form: rawForm,
        pendingLabel: "Queueing registration…",
        errorTarget: byId("rawSceneChangeError"),
      }, () => createRawSceneChangeReport(form));
    });

    const rawReviewForm = byId<HTMLFormElement>("rawSceneChangeReviewForm");
    const rawReviewSubmit = rawReviewForm.querySelector<HTMLButtonElement>("[type='submit']")!;
    rawReviewForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(rawReviewForm);
      const reportId = String(form.get("reportId") ?? "");
      void runAction({
        key: `review-raw-scene-change:${reportId}`,
        trigger: rawReviewSubmit,
        form: rawReviewForm,
        pendingLabel: "Recording review…",
        errorTarget: byId("rawSceneChangeReviewError"),
      }, () => reviewRawSceneChangeReport(form));
    });

    const comparisonForm = byId<HTMLFormElement>("versionComparisonForm");
    const comparisonSubmit = byId<HTMLButtonElement>("comparisonSubmit");
    comparisonForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(comparisonForm);
      const left = String(form.get("left") ?? "");
      const right = String(form.get("right") ?? "");
      if (left === right) {
        byId("comparisonError").textContent = "Choose two distinct immutable versions.";
        return;
      }
      void runAction({
        key: "load-version-comparison",
        trigger: comparisonSubmit,
        form: comparisonForm,
        pendingLabel: "Loading comparison…",
        errorTarget: byId("comparisonError"),
      }, () => loadVersionComparison(left, right));
    });
    for (const side of ["left", "right"] as const) {
      const retry = byId<HTMLButtonElement>(side === "left" ? "compareLeftRetry" : "compareRightRetry");
      retry.addEventListener("click", () => {
        void runAction({
          key: `retry-comparison-renderer:${side}`,
          trigger: retry,
          pendingLabel: "Retrying renderer…",
        }, () => retryComparisonRenderer());
      });
    }
    window.addEventListener("message", handleComparisonRendererMessage);
    versionComparisonDialog().addEventListener("close", resetVersionComparison);
  }

  function cancel(): void {
    rawSceneChangePollGeneration += 1;
    resetVersionComparison();
  }

  function openVersionComparison(projectId: string, versions: CompareVersion[]): void {
    const project = dependencies.currentProject();
    const eligibleIds = project
      ? comparisonVersionIdsForMode(project.comparisonReadiness, "visual")
      : new Set<string>();
    const eligibleVersions = versions.filter((version) => eligibleIds.has(version.id));
    if (eligibleVersions.length < 2) {
      dependencies.showNotice(
        "Visual comparison needs two versions with verified web scenes, approved navigation, and capture registration.",
        "error",
      );
      return;
    }
    comparisonProjectId = projectId;
    comparisonVersions = [...eligibleVersions]
      .sort((left, right) => right.version_number - left.version_number);
    const left = byId<HTMLSelectElement>("comparisonLeftVersion");
    const right = byId<HTMLSelectElement>("comparisonRightVersion");
    const options = comparisonVersions.map((version) => {
      const option = document.createElement("option");
      option.value = version.id;
      option.textContent = `v${version.version_number} · ${dependencies.humanStatus(version.status)} · ${dependencies.parseTimestamp(version.created_at).toLocaleDateString()}`;
      return option;
    });
    left.replaceChildren(...options.map((option) => option.cloneNode(true)));
    right.replaceChildren(...options.map((option) => option.cloneNode(true)));
    left.value = comparisonVersions[1]!.id;
    right.value = comparisonVersions[0]!.id;
    resetComparisonPresentation();
    byId("comparisonError").textContent = project
      ? comparisonExclusionMessage(project.comparisonReadiness, "visual", versions)
      : "";
    versionComparisonDialog().showModal();
    window.requestAnimationFrame(() => byId<HTMLButtonElement>("comparisonSubmit").click());
  }

  async function loadVersionComparison(leftId: string, rightId: string): Promise<void> {
    if (!comparisonProjectId) throw new Error("The comparison project is no longer available.");
    if (leftId === rightId) throw new Error("Choose two distinct immutable versions.");
    const generation = ++comparisonGeneration;
    const loading = byId("comparisonLoading");
    loading.hidden = false;
    loading.querySelector("span")!.textContent = "Preparing signed comparison sessions…";
    byId("comparisonGrid").setAttribute("aria-busy", "true");
    resetComparisonFrames();
    try {
      const comparison = await api<VersionComparison>(
        `/api/projects/${comparisonProjectId}/versions/compare?left=${encodeURIComponent(leftId)}&right=${encodeURIComponent(rightId)}`,
        { timeoutMs: 20_000, retries: 2 },
      );
      if (generation !== comparisonGeneration || !versionComparisonDialog().open) return;
      renderVersionComparison(comparison);
    } catch (error) {
      if (generation === comparisonGeneration) {
        loading.hidden = true;
        byId("comparisonGrid").removeAttribute("aria-busy");
        setComparisonSideStatus("left", "Comparison unavailable", "error");
        setComparisonSideStatus("right", "Comparison unavailable", "error");
      }
      throw error;
    }
  }

  function renderVersionComparison(comparison: VersionComparison): void {
    const sides = [
      ["left", comparison.requested.left],
      ["right", comparison.requested.right],
    ] as const;
    for (const [side, versionId] of sides) {
      const version = comparison.versions.find((candidate) => candidate.id === versionId);
      if (!version) {
        setComparisonSideStatus(side, "Version unavailable", "error");
        continue;
      }
      byId(side === "left" ? "compareLeftTitle" : "compareRightTitle").textContent =
        `Version ${version.version_number} · ${dependencies.humanStatus(version.status)}`;
      renderComparisonEvidence(side, comparison, version);
      const renderable = comparison.renderables.find((candidate) => candidate.versionId === version.id);
      const elements = comparisonSideElements(side);
      if (!renderable) {
        comparisonFrameReady[side] = true;
        elements.frame.hidden = true;
        elements.empty.hidden = false;
        elements.empty.textContent = "This version cannot be compared until both its verified web scene and approved walking package are available.";
        elements.retry.hidden = true;
        setComparisonSideStatus(side, "Comparison blocked", "error");
        continue;
      }
      elements.empty.hidden = true;
      elements.frame.hidden = false;
      elements.retry.hidden = true;
      setComparisonSideStatus(side, "Starting Spark…", "");
      elements.frame.onload = () => sendVersionSpatialRuntime(elements.frame, renderable);
      elements.frame.src = rendererAssetUrl(renderable).toString();
      elements.frame.dataset.generation = String(comparisonGeneration);
      comparisonFrameTimeouts[side] = window.setTimeout(() => {
        if (comparisonFrameReady[side] || !versionComparisonDialog().open) return;
        setComparisonSideStatus(side, "Renderer timed out", "error");
        elements.retry.hidden = false;
        finishComparisonLoadingIfSettled();
      }, 25_000);
    }
    finishComparisonLoadingIfSettled();
  }

  function sendVersionSpatialRuntime(frame: HTMLIFrameElement, renderable: ComparisonRenderable): void {
    const spatial = renderable.spatial;
    const artifactNavMesh = spatial.navigationArtifact && typeof spatial.navigationArtifact === "object"
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
      spatial.entities.filter((entity) => entity.kind === "doorway").map((entity) => entity.id),
    );
    frame.contentWindow?.postMessage({
      source: "spatial-host",
      type: "set-spatial-runtime",
      collisionBoxes: spatial.collisionProxy.boxes,
      navigationMesh,
      obstacleBoxes: spatial.obstacleProxy.boxes,
      doorwayBoxes: spatial.collisionProxy.boxes.filter((box) =>
        box && typeof box === "object" && doorwayEntityIds.has(String(Reflect.get(box, "entityId")))
      ),
      navigationProfile: spatial.navigationProfile,
      navigationArtifact: spatial.navigationArtifact,
      collisionUrl: renderable.collisionUrl,
      defaultMovementMode: renderable.viewer?.defaultMovementMode ?? "walk",
    }, location.origin);
  }

  function rendererAssetUrl(renderable: ComparisonRenderable): URL {
    const url = new URL("/renderer/index.html", location.origin);
    url.searchParams.set("content", renderable.contentUrl);
    url.searchParams.set("format", renderable.format);
    url.searchParams.set("budget", String(renderable.viewer?.splatBudgetMillions ?? 1.25));
    const rotation = renderable.viewer?.sceneRotationDegrees;
    if (rotation) url.searchParams.set("rotation", rotation.join(","));
    if (renderable.viewer?.sourceToWorld) {
      url.searchParams.set("sourceToWorld", JSON.stringify(renderable.viewer.sourceToWorld));
    }
    const camera = renderable.viewer?.initialCamera;
    if (camera) {
      url.searchParams.set("camera", camera.position.join(","));
      url.searchParams.set("target", camera.target.join(","));
      if (camera.up) url.searchParams.set("up", camera.up.join(","));
      url.searchParams.set("fov", String(camera.fovDegrees ?? 58));
    }
    return url;
  }

  function renderComparisonEvidence(
    side: "left" | "right",
    comparison: VersionComparison,
    version: VersionComparison["versions"][number],
  ): void {
    const container = byId(side === "left" ? "compareLeftEvidence" : "compareRightEvidence");
    container.replaceChildren();
    const renderable = comparison.renderables.find((candidate) => candidate.versionId === version.id);
    const facts = createElement("div", "comparison-facts");
    facts.append(
      comparisonFact("Created", dependencies.parseTimestamp(version.created_at).toLocaleString()),
      comparisonFact("Web asset", renderable ? `${renderable.format.toUpperCase()} · ${dependencies.formatBytes(renderable.sizeBytes)}` : "Not attached"),
      comparisonFact("Integrity", renderable?.sha256 ? renderable.sha256.slice(0, 12) : "No verified hash"),
    );
    container.append(facts);
    const decisions = comparison.reviewDecisionHistory.filter((item) => item.version_id === version.id);
    const decisionHistory = createElement("section", "comparison-history");
    decisionHistory.append(createElement("strong", "", "Approval history"));
    if (!decisions.length) {
      decisionHistory.append(createElement("div", "comparison-history-line", "No approval decision has been recorded."));
    }
    for (const decision of decisions) {
      decisionHistory.append(createElement(
        "div",
        `comparison-history-line ${decision.decision}`,
        `${decision.decision === "approved" ? "Approved" : "Changes requested"} | ${decision.reviewer_name ?? decision.reviewer_email ?? "Reviewer"} | ${dependencies.parseTimestamp(decision.created_at).toLocaleString()}${decision.note ? `: ${decision.note}` : ""}`,
      ));
    }
    container.append(decisionHistory);
    const comments = comparison.reviewCommentHistory.filter((item) => item.version_id === version.id);
    const commentHistory = createElement("section", "comparison-history");
    commentHistory.append(createElement("strong", "", "Review comments"));
    if (!comments.length) {
      commentHistory.append(createElement("div", "comparison-history-line", "No comments are attached to this version."));
    }
    for (const comment of comments.slice(0, 16)) {
      commentHistory.append(createElement(
        "div",
        `comparison-history-line ${comment.status}`,
        `${dependencies.humanStatus(comment.kind)} | ${dependencies.humanStatus(comment.status)} | ${comment.author_name ?? comment.author_email ?? "Reviewer"} | ${dependencies.parseTimestamp(comment.created_at).toLocaleString()}: ${comment.body}`,
      ));
    }
    container.append(commentHistory);
  }

  function comparisonFact(label: string, value: string): HTMLElement {
    const fact = createElement("div", "comparison-fact");
    fact.append(createElement("small", "", label), createElement("strong", "", value));
    return fact;
  }

  function comparisonSideElements(side: "left" | "right") {
    const prefix = side === "left" ? "Left" : "Right";
    return {
      frame: byId<HTMLIFrameElement>(`compare${prefix}Frame`),
      empty: byId(`compare${prefix}Empty`),
      retry: byId<HTMLButtonElement>(`compare${prefix}Retry`),
      status: byId(`compare${prefix}Status`),
    };
  }

  function setComparisonSideStatus(
    side: "left" | "right",
    text: string,
    stateClass: "" | "ready" | "error",
  ): void {
    const status = comparisonSideElements(side).status;
    status.textContent = text;
    status.className = `comparison-status${stateClass ? ` ${stateClass}` : ""}`;
  }

  function handleComparisonRendererMessage(event: MessageEvent<unknown>): void {
    if (event.origin !== location.origin || !versionComparisonDialog().open) return;
    const leftFrame = comparisonSideElements("left").frame;
    const rightFrame = comparisonSideElements("right").frame;
    const side = event.source === leftFrame.contentWindow
      ? "left"
      : event.source === rightFrame.contentWindow
        ? "right"
        : null;
    if (!side || !event.data || typeof event.data !== "object") return;
    if (Reflect.get(event.data, "source") !== "spatial-spark") return;
    const messageType = Reflect.get(event.data, "type");
    if (messageType === "progress") {
      const progress = Number(Reflect.get(event.data, "progress"));
      const detail = String(Reflect.get(event.data, "detail") ?? "Loading scene");
      setComparisonSideStatus(side, `${Math.round(progress)}% · ${detail}`, "");
      return;
    }
    if (messageType === "ready") {
      clearComparisonFrameTimeout(side);
      comparisonFrameReady[side] = true;
      const elapsed = Number(Reflect.get(event.data, "timeToFirstFrameMs"));
      setComparisonSideStatus(side, Number.isFinite(elapsed) ? `Spark ready · ${elapsed} ms` : "Spark ready", "ready");
      comparisonSideElements(side).retry.hidden = true;
      finishComparisonLoadingIfSettled();
      return;
    }
    if (messageType === "error") {
      clearComparisonFrameTimeout(side);
      comparisonFrameReady[side] = false;
      const message = String(Reflect.get(event.data, "message") ?? "The Spark renderer could not load this version.");
      setComparisonSideStatus(side, message, "error");
      comparisonSideElements(side).retry.hidden = false;
      finishComparisonLoadingIfSettled();
      return;
    }
    if (
      messageType !== "camera-update" ||
      !byId<HTMLInputElement>("comparisonSync").checked ||
      !comparisonFrameReady.left ||
      !comparisonFrameReady.right
    ) return;
    const now = performance.now();
    if (now - comparisonSyncAt < 100) return;
    const pose = Reflect.get(event.data, "cameraPose");
    if (!validComparisonCameraPose(pose)) return;
    comparisonSyncAt = now;
    const target = comparisonSideElements(side === "left" ? "right" : "left").frame;
    target.contentWindow?.postMessage({
      source: "spatial-host",
      type: "sync-camera",
      cameraPose: pose,
    }, location.origin);
  }

  function validComparisonCameraPose(value: unknown): value is ComparisonCameraPose {
    if (!value || typeof value !== "object") return false;
    return validNumberTuple(Reflect.get(value, "position")) &&
      validNumberTuple(Reflect.get(value, "target")) &&
      validNumberTuple(Reflect.get(value, "up")) &&
      Number.isFinite(Number(Reflect.get(value, "fovDegrees")));
  }

  function validNumberTuple(value: unknown): value is [number, number, number] {
    return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(item));
  }

  async function retryComparisonRenderer(): Promise<void> {
    await loadVersionComparison(
      byId<HTMLSelectElement>("comparisonLeftVersion").value,
      byId<HTMLSelectElement>("comparisonRightVersion").value,
    );
  }

  function finishComparisonLoadingIfSettled(): void {
    const retryVisible = !comparisonSideElements("left").retry.hidden || !comparisonSideElements("right").retry.hidden;
    if ((!comparisonFrameReady.left || !comparisonFrameReady.right) && !retryVisible) return;
    byId("comparisonLoading").hidden = true;
    byId("comparisonGrid").removeAttribute("aria-busy");
  }

  function clearComparisonFrameTimeout(side: "left" | "right"): void {
    if (comparisonFrameTimeouts[side] !== null) {
      window.clearTimeout(comparisonFrameTimeouts[side]!);
      comparisonFrameTimeouts[side] = null;
    }
  }

  function resetComparisonFrames(): void {
    for (const side of ["left", "right"] as const) {
      clearComparisonFrameTimeout(side);
      comparisonFrameReady[side] = false;
      const elements = comparisonSideElements(side);
      elements.frame.onload = null;
      // Removing the src attribute does not navigate an iframe, so the loaded
      // renderer document (splat buffers, physics world, frame loop) would stay
      // alive hidden; an about:blank navigation actually unloads it.
      elements.frame.src = "about:blank";
      elements.frame.hidden = true;
      elements.empty.hidden = false;
      elements.empty.textContent = "Preparing a signed Spark renderer session…";
      elements.retry.hidden = true;
      setComparisonSideStatus(side, "Preparing", "");
    }
  }

  function resetComparisonPresentation(): void {
    resetComparisonFrames();
    byId("comparisonLoading").hidden = true;
    byId("comparisonGrid").removeAttribute("aria-busy");
    byId("compareLeftTitle").textContent = "Select a version";
    byId("compareRightTitle").textContent = "Select a version";
    byId("compareLeftEvidence").replaceChildren();
    byId("compareRightEvidence").replaceChildren();
  }

  function resetVersionComparison(): void {
    comparisonGeneration += 1;
    comparisonProjectId = null;
    comparisonVersions = [];
    resetComparisonPresentation();
    byId("comparisonError").textContent = "";
  }

  function openGeometryChangeDialog(): void {
    const project = dependencies.currentProject();
    const eligibleIds = project
      ? comparisonVersionIdsForMode(project.comparisonReadiness, "authored_geometry")
      : new Set<string>();
    const versions = (project?.versions ?? []).filter((version) => eligibleIds.has(version.id));
    if (versions.length < 2) return;
    const from = byId<HTMLSelectElement>("geometryChangeFrom");
    const to = byId<HTMLSelectElement>("geometryChangeTo");
    from.replaceChildren();
    to.replaceChildren();
    for (const version of versions) {
      const label = `Version ${version.version_number} · ${dependencies.humanStatus(version.status)}`;
      from.append(new Option(label, version.id));
      to.append(new Option(label, version.id));
    }
    from.value = versions[1]?.id ?? versions[0]!.id;
    to.value = versions[0]!.id;
    const form = byId<HTMLFormElement>("geometryChangeForm");
    const evidence = form.elements.namedItem("registrationEvidence");
    if (evidence instanceof HTMLTextAreaElement) evidence.value = "";
    byId("geometryChangeError").textContent = project
      ? comparisonExclusionMessage(project.comparisonReadiness, "authored_geometry", project.versions)
      : "";
    geometryChangeOperation = null;
    byId<HTMLDialogElement>("geometryChangeDialog").showModal();
  }

  async function generateChangeReport(form: FormData): Promise<void> {
    const project = dependencies.currentProject();
    if (!project) return;
    const body = {
      fromVersionId: String(form.get("fromVersionId") ?? ""),
      toVersionId: String(form.get("toVersionId") ?? ""),
      thresholdMm: Number(form.get("thresholdMm") ?? 50),
      coordinateAssurance: String(form.get("coordinateAssurance") ?? "shared_local_frame"),
      registrationEvidence: String(form.get("registrationEvidence") ?? "").trim(),
    };
    const requestKey = JSON.stringify(body);
    if (!geometryChangeOperation || geometryChangeOperation.requestKey !== requestKey) {
      geometryChangeOperation = { id: crypto.randomUUID(), requestKey };
    }
    await api(`/api/projects/${project.id}/spatial/change-reports`, {
      method: "POST",
      body: JSON.stringify({ clientOperationId: geometryChangeOperation.id, ...body }),
    });
    byId<HTMLDialogElement>("geometryChangeDialog").close();
    geometryChangeOperation = null;
    dependencies.showToast("Authored geometry evidence generated");
    await dependencies.loadSpatialWorkspace(project.id);
  }

  function openGeometryChangeReview(report: GeometryChangeReport, summary: GeometryChangeSummary): void {
    const form = byId<HTMLFormElement>("geometryChangeReviewForm");
    form.reset();
    const reportId = form.elements.namedItem("reportId");
    if (reportId instanceof HTMLInputElement) reportId.value = report.id;
    const decision = form.elements.namedItem("decision");
    if (decision instanceof HTMLSelectElement) {
      decision.value = summary.result === "no_material_change" ? "accepted" : "needs_recapture";
    }
    const note = form.elements.namedItem("note");
    if (note instanceof HTMLTextAreaElement) note.value = report.review_note ?? "";
    byId("geometryChangeReviewContext").textContent =
      `Version ${summary.versions.from.versionNumber} → ${summary.versions.to.versionNumber}: ` +
      `${summary.summary.changed} changed, ${summary.summary.added} added, ${summary.summary.removed} removed; ` +
      `maximum ${summary.summary.maxDeviationMm ?? "not available"} mm at a ${summary.thresholdMm} mm threshold.`;
    byId("geometryChangeReviewError").textContent = "";
    byId<HTMLDialogElement>("geometryChangeReviewDialog").showModal();
  }

  async function reviewGeometryChangeReport(form: FormData): Promise<void> {
    const project = dependencies.currentProject();
    if (!project) return;
    const reportId = String(form.get("reportId") ?? "");
    await api(`/api/projects/${project.id}/spatial/change-reports/${encodeURIComponent(reportId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: String(form.get("decision") ?? ""),
        note: String(form.get("note") ?? "").trim(),
      }),
    });
    byId<HTMLDialogElement>("geometryChangeReviewDialog").close();
    dependencies.showToast("Geometry evidence review recorded");
    await dependencies.loadSpatialWorkspace(project.id);
  }

  function renderGeometryChangeReport(projectId: string, report: GeometryChangeReport): HTMLElement {
    const card = createElement("article", "geometry-change-card");
    const summary = parseGeometryChangeSummary(report.summary_json);
    if (!summary) {
      card.append(
        createElement("strong", "", "Unreadable geometry report"),
        createElement("p", "form-error", "The stored evidence could not be parsed. Generate a fresh comparison."),
      );
      return card;
    }
    const header = createElement("div", "geometry-change-heading");
    const title = createElement("div", "");
    title.append(
      createElement("strong", "", `Version ${summary.versions.from.versionNumber} → ${summary.versions.to.versionNumber}`),
      createElement("small", "muted-copy", `${summary.thresholdMm} mm threshold · ${dependencies.humanStatus(summary.coordinateAssurance)}`),
    );
    header.append(
      title,
      createElement("span", `status-pill ${dependencies.statusClass(summary.result.toUpperCase())}`, dependencies.humanStatus(summary.result)),
    );
    card.append(header);
    const metrics = createElement("div", "geometry-change-metrics");
    metrics.append(
      compactMetric("Comparable", summary.summary.comparable),
      compactMetric("Changed", summary.summary.changed),
      compactMetric("Added / removed", `${summary.summary.added} / ${summary.summary.removed}`),
      compactMetric("P95 deviation", summary.summary.p95DeviationMm === null ? "-" : `${summary.summary.p95DeviationMm} mm`),
      compactMetric("Maximum", summary.summary.maxDeviationMm === null ? "-" : `${summary.summary.maxDeviationMm} mm`),
    );
    card.append(metrics, renderGeometryChangeOverlay(summary));
    if (summary.blockers.length) {
      const blockers = createElement("div", "notice-card geometry-change-blockers");
      blockers.append(createElement("strong", "", "Metric conclusion blocked"));
      const list = document.createElement("ul");
      for (const blocker of summary.blockers) list.append(createElement("li", "", blocker));
      blockers.append(list);
      card.append(blockers);
    }
    if (summary.comparisons.length) {
      const rows = createElement("div", "geometry-change-rows");
      for (const comparison of summary.comparisons.slice(0, 8)) {
        const row = createElement("div", "geometry-change-row");
        row.append(
          createElement("span", "", comparison.label),
          createElement("span", "", `${comparison.maxDeviationMm} mm max`),
          createElement("span", `status-pill ${dependencies.statusClass(comparison.classification.toUpperCase())}`, dependencies.humanStatus(comparison.classification)),
        );
        rows.append(row);
      }
      card.append(rows);
    }
    card.append(createElement("p", "field-note", summary.limitation));
    if (report.status === "reviewed") {
      card.append(createElement(
        "div",
        "notice-card",
        `${dependencies.humanStatus(report.review_decision ?? "reviewed")}: ${report.review_note ?? "Review recorded."}`,
      ));
    }
    const actions = createElement("div", "release-actions");
    const review = createElement(
      "button",
      report.status === "reviewed" ? "quiet-button" : "primary-button",
      report.status === "reviewed" ? "Review again" : "Review evidence",
    );
    review.addEventListener("click", () => openGeometryChangeReview(report, summary));
    const visual = createElement("button", "quiet-button", "Open rendered versions");
    visual.addEventListener("click", () => {
      const versions = dependencies.currentProject()?.versions ?? [];
      const relevant = versions.filter((version) =>
        version.id === report.from_version_id || version.id === report.to_version_id
      );
      openVersionComparison(projectId, relevant.length === 2 ? relevant : versions);
    });
    actions.append(review, visual);
    card.append(actions);
    return card;
  }

  function eligibleRawChangeAssets(versionId: string, assets: readonly CompareAsset[]): CompareAsset[] {
    return assets.filter((asset) =>
      asset.version_id === versionId &&
      ["source", "master", "pointcloud"].includes(asset.kind) &&
      asset.format.toLowerCase() === "ply" &&
      asset.integrity_status === "verified"
    );
  }

  function openRawSceneChangeDialog(): void {
    const project = dependencies.currentProject();
    const eligibleIds = project
      ? comparisonVersionIdsForMode(project.comparisonReadiness, "raw")
      : new Set<string>();
    const versions = (project?.versions ?? []).filter((version) =>
      eligibleIds.has(version.id) &&
      eligibleRawChangeAssets(version.id, project?.assets ?? []).length > 0
    );
    if (!project || versions.length < 2) {
      dependencies.showNotice("Two immutable versions with verified source, master, or point-cloud PLY assets are required.", "error");
      return;
    }
    const form = byId<HTMLFormElement>("rawSceneChangeForm");
    form.reset();
    const baselineVersion = byId<HTMLSelectElement>("rawChangeBaselineVersion");
    const candidateVersion = byId<HTMLSelectElement>("rawChangeCandidateVersion");
    baselineVersion.replaceChildren();
    candidateVersion.replaceChildren();
    for (const version of versions) {
      const label = `Version ${version.version_number} · ${dependencies.humanStatus(version.status)}`;
      baselineVersion.append(new Option(label, version.id));
      candidateVersion.append(new Option(label, version.id));
    }
    baselineVersion.value = versions[1]?.id ?? versions[0]!.id;
    candidateVersion.value = versions[0]!.id;
    const populateAssets = (versionSelect: HTMLSelectElement, assetSelectId: string): void => {
      const assetSelect = byId<HTMLSelectElement>(assetSelectId);
      assetSelect.replaceChildren();
      for (const asset of eligibleRawChangeAssets(versionSelect.value, project.assets)) {
        assetSelect.append(new Option(
          `${asset.file_name} · ${dependencies.formatBytes(asset.size_bytes)} · ${dependencies.humanStatus(asset.kind)}`,
          asset.id,
        ));
      }
    };
    const refreshAssets = (): void => {
      populateAssets(baselineVersion, "rawChangeBaselineAsset");
      populateAssets(candidateVersion, "rawChangeCandidateAsset");
    };
    baselineVersion.onchange = refreshAssets;
    candidateVersion.onchange = refreshAssets;
    refreshAssets();
    byId("rawSceneChangeError").textContent = comparisonExclusionMessage(
      project.comparisonReadiness,
      "raw",
      project.versions,
    );
    rawSceneChangeOperation = null;
    byId<HTMLDialogElement>("rawSceneChangeDialog").showModal();
  }

  function comparisonExclusionMessage(
    readiness: ComparisonReadiness,
    mode: ComparisonMode,
    versions: readonly CompareVersion[],
  ): string {
    const eligibleIds = comparisonVersionIdsForMode(readiness, mode);
    const excluded = versions.flatMap((version) => {
      if (eligibleIds.has(version.id)) return [];
      const reasons = readiness.versions.find((candidate) =>
        candidate.versionId === version.id
      )?.modes[mode].reasons ?? ["no eligible pair"];
      return [`v${version.version_number}: ${reasons.map(dependencies.humanStatus).join(", ")}`];
    });
    return excluded.length ? `Excluded versions — ${excluded.join("; ")}.` : "";
  }

  async function createRawSceneChangeReport(form: FormData): Promise<void> {
    const project = dependencies.currentProject();
    if (!project) throw new Error("Open a project before comparing raw scenes.");
    const body = {
      baselineVersionId: String(form.get("baselineVersionId") ?? ""),
      candidateVersionId: String(form.get("candidateVersionId") ?? ""),
      baselineAssetId: String(form.get("baselineAssetId") ?? ""),
      candidateAssetId: String(form.get("candidateAssetId") ?? ""),
      registrationMode: String(form.get("registrationMode") ?? "automatic_rigid"),
      coordinateAssurance: String(form.get("coordinateAssurance") ?? "shared_local_frame"),
      registrationEvidence: String(form.get("registrationEvidence") ?? "").trim(),
      registrationSearchRadiusM: Number(form.get("registrationSearchRadiusM") ?? 1),
      registrationMaximumRmseMm: Number(form.get("registrationMaximumRmseMm") ?? 100),
      registrationMinimumOverlapPercent: Number(form.get("registrationMinimumOverlapPercent") ?? 55),
      voxelSizeM: Number(form.get("voxelSizeM") ?? 0.1),
      structuralChangeThresholdPercent: Number(form.get("structuralChangeThresholdPercent") ?? 2),
      photometricChangeThresholdPercent: Number(form.get("photometricChangeThresholdPercent") ?? 12),
      centroidChangeThresholdMm: Number(form.get("centroidChangeThresholdMm") ?? 50),
      maximumSamplePoints: Number(form.get("maximumSamplePoints") ?? 2_000_000),
    };
    const requestKey = JSON.stringify(body);
    if (!rawSceneChangeOperation || rawSceneChangeOperation.requestKey !== requestKey) {
      rawSceneChangeOperation = { id: crypto.randomUUID(), requestKey };
    }
    const result = await api<{ report: { id: string; status: string } }>(
      `/api/projects/${project.id}/spatial/raw-change-reports`,
      {
        method: "POST",
        body: JSON.stringify({ clientOperationId: rawSceneChangeOperation.id, ...body }),
      },
    );
    rawSceneChangeOperation = null;
    byId<HTMLDialogElement>("rawSceneChangeDialog").close();
    dependencies.showToast(body.registrationMode === "automatic_rigid"
      ? "Automatic registration and raw-scene comparison queued"
      : "Declared-frame raw-scene comparison queued");
    await dependencies.loadSpatialWorkspace(project.id);
    void pollRawSceneChange(project.id, result.report.id);
  }

  async function retryRawSceneChange(report: RegisteredSceneChangeReport): Promise<void> {
    const project = dependencies.currentProject();
    if (!project) throw new Error("Open a project before retrying raw-scene evidence.");
    await api(`/api/projects/${project.id}/spatial/raw-change-reports/${report.id}/retry`, { method: "POST" });
    dependencies.showToast("Raw-scene comparison retry queued");
    await dependencies.loadSpatialWorkspace(project.id);
    void pollRawSceneChange(project.id, report.id);
  }

  async function pollRawSceneChange(projectId: string, reportId: string): Promise<void> {
    const generation = ++rawSceneChangePollGeneration;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt < 4 ? 1_500 : 5_000));
      if (generation !== rawSceneChangePollGeneration || !dependencies.pollingContextIsActive(projectId)) return;
      try {
        await dependencies.loadSpatialWorkspace(projectId);
      } catch {
        continue;
      }
      const report = dependencies.currentRawReports().find((candidate) => candidate.id === reportId);
      if (!report || !["QUEUED", "RUNNING"].includes(report.status)) return;
    }
    if (generation === rawSceneChangePollGeneration && dependencies.pollingContextIsActive(projectId)) {
      dependencies.showNotice("Raw-scene processing is still running. Refresh later; the queued evidence is retained.", "error");
    }
  }

  function openRawSceneChangeReview(report: RegisteredSceneChangeReport, summary: RegisteredSceneChangeSummary): void {
    const form = byId<HTMLFormElement>("rawSceneChangeReviewForm");
    form.reset();
    const reportId = form.elements.namedItem("reportId");
    if (reportId instanceof HTMLInputElement) reportId.value = report.id;
    const decision = form.elements.namedItem("decision");
    if (decision instanceof HTMLSelectElement) {
      decision.value = report.review_decision ??
        (summary.result === "no_material_change"
          ? "accepted"
          : summary.result === "registration_blocked"
            ? "needs_recapture"
            : "investigate");
    }
    const note = form.elements.namedItem("note");
    if (note instanceof HTMLTextAreaElement) note.value = report.review_note ?? "";
    byId("rawSceneChangeReviewContext").textContent = summary.result === "registration_blocked"
      ? `Version ${report.baseline_version_number} → ${report.candidate_version_number}: automatic registration did not pass the declared quality gates, so change analysis was not run.`
      : `Version ${report.baseline_version_number} → ${report.candidate_version_number}: ${summary.summary.addedVoxels} added and ${summary.summary.removedVoxels} removed voxels; ${summary.summary.structurallyChangedPercent}% occupancy delta.`;
    byId("rawSceneChangeReviewError").textContent = "";
    byId<HTMLDialogElement>("rawSceneChangeReviewDialog").showModal();
  }

  async function reviewRawSceneChangeReport(form: FormData): Promise<void> {
    const project = dependencies.currentProject();
    if (!project) throw new Error("Open a project before reviewing raw-scene evidence.");
    const reportId = String(form.get("reportId") ?? "");
    await api(`/api/projects/${project.id}/spatial/raw-change-reports/${reportId}`, {
      method: "PATCH",
      body: JSON.stringify({
        decision: String(form.get("decision") ?? ""),
        note: String(form.get("note") ?? "").trim(),
      }),
    });
    byId<HTMLDialogElement>("rawSceneChangeReviewDialog").close();
    dependencies.showToast("Raw-scene evidence review recorded");
    await dependencies.loadSpatialWorkspace(project.id);
  }

  function renderRawSceneChangeReport(report: RegisteredSceneChangeReport): HTMLElement {
    const card = createElement("article", "geometry-change-card raw-scene-change-card");
    const header = createElement("div", "geometry-change-heading");
    const title = createElement("div", "");
    title.append(
      createElement("strong", "", `Version ${report.baseline_version_number} → ${report.candidate_version_number}`),
      createElement("small", "muted-copy", `${report.baseline_file_name} → ${report.candidate_file_name}`),
    );
    header.append(
      title,
      createElement("span", `status-pill ${dependencies.statusClass(report.status)}`, dependencies.humanStatus(report.status)),
    );
    card.append(header);
    if (report.status === "QUEUED" || report.status === "RUNNING") {
      const progress = document.createElement("progress");
      progress.max = 100;
      progress.value = report.job_progress;
      progress.setAttribute("aria-label", "Registered raw-scene processing progress");
      card.append(
        progress,
        createElement("p", "inline-status", report.job_progress_message ?? "Waiting for a processing worker."),
        createElement("small", "muted-copy", `Attempt ${report.attempt_count}/${report.max_attempts}`),
      );
      return card;
    }
    if (report.status === "FAILED" || report.status === "DEAD_LETTER") {
      const retry = createElement("button", "primary-button", "Retry registered comparison");
      retry.addEventListener("click", () => {
        void runAction({
          key: `retry-raw-scene-change:${report.id}`,
          trigger: retry,
          pendingLabel: "Queueing retry…",
        }, () => retryRawSceneChange(report));
      });
      card.append(createElement("p", "form-error", rawSceneChangeError(report)), retry);
      return card;
    }
    const summary = parseRegisteredSceneChangeSummary(report.summary_json);
    if (!summary) {
      card.append(createElement("p", "form-error", "The stored processor report is unreadable. Retry from the failed job if source evidence is available."));
      return card;
    }
    if (summary.registration?.performedByProcessor && summary.registration.summary) {
      const registrationMetrics = createElement("div", "geometry-change-metrics");
      registrationMetrics.append(
        compactMetric("Registration", dependencies.humanStatus(summary.registration.status ?? "unknown")),
        compactMetric("Overlap", `${summary.registration.summary.overlapPercent}%`),
        compactMetric("RMSE", `${summary.registration.summary.rmseMm} mm`),
        compactMetric("P95 residual", `${summary.registration.summary.p95ResidualMm} mm`),
        compactMetric(
          "Yaw / translation",
          summary.registration.transform
            ? `${summary.registration.transform.yawDegrees}° · ${summary.registration.transform.translationM.map((value) => value.toFixed(3)).join(", ")} m`
            : "Unavailable",
        ),
      );
      card.append(createElement("p", "section-kicker", "AUTOMATIC REGISTRATION EVIDENCE"), registrationMetrics);
    }
    if (summary.result !== "registration_blocked") {
      const metrics = createElement("div", "geometry-change-metrics");
      metrics.append(
        compactMetric("Occupancy delta", `${summary.summary.structurallyChangedPercent}%`),
        compactMetric("Added / removed", `${summary.summary.addedVoxels} / ${summary.summary.removedVoxels}`),
        compactMetric("Common voxels", summary.summary.commonVoxels),
        compactMetric("P95 centroid", summary.summary.p95CentroidDisplacementMm === null ? "-" : `${summary.summary.p95CentroidDisplacementMm} mm`),
        compactMetric("P95 colour", summary.summary.p95PhotometricDeltaPercent === null ? "-" : `${summary.summary.p95PhotometricDeltaPercent}%`),
      );
      card.append(metrics);
    }
    if (summary.materialSignals.length) {
      const signals = createElement("div", "notice-card");
      signals.append(createElement("strong", "", "Material signals"));
      const list = document.createElement("ul");
      for (const signal of summary.materialSignals) list.append(createElement("li", "", signal));
      signals.append(list);
      card.append(signals);
    }
    card.append(
      createElement("p", "field-note", report.registration_evidence),
      createElement("p", "field-note", summary.limitation),
    );
    if (report.status === "REVIEWED") {
      card.append(createElement(
        "div",
        "notice-card",
        `${dependencies.humanStatus(report.review_decision ?? "reviewed")}: ${report.review_note ?? "Review recorded."}`,
      ));
    }
    const actions = createElement("div", "release-actions");
    const review = createElement(
      "button",
      report.status === "REVIEWED" ? "quiet-button" : "primary-button",
      report.status === "REVIEWED" ? "Review again" : "Review evidence",
    );
    review.addEventListener("click", () => openRawSceneChangeReview(report, summary));
    const visual = createElement("button", "quiet-button", "Open rendered versions");
    visual.addEventListener("click", () => {
      const project = dependencies.currentProject();
      if (!project) return;
      const versions = project.versions.filter((version) =>
        version.id === report.baseline_version_id || version.id === report.candidate_version_id
      );
      openVersionComparison(project.id, versions);
    });
    actions.append(review, visual);
    card.append(actions);
    return card;
  }

  function renderStage(input: CompareStageInput): HTMLElement {
    const eligibleVersionCount = (mode: ComparisonMode) =>
      comparisonVersionIdsForMode(input.readiness, mode).size;
    const visualAvailable = comparisonModeAvailable(input.readiness, "visual");
    const geometryAvailable = comparisonModeAvailable(input.readiness, "authored_geometry");
    const rawAvailable = comparisonModeAvailable(input.readiness, "raw");
    const card = createElement("article", "workspace-card-large comparison-evidence");
    card.append(
      createElement("span", "eyebrow", "CHANGE EVIDENCE"),
      createElement("h3", "", "Compare immutable versions"),
      createElement("p", "muted-copy", "Visual, authored-structure, and registered-capture evidence remains bound to the exact baseline and candidate versions."),
      createElement("h4", "", "Visual version comparison"),
      createElement("p", "muted-copy", "Open the immutable scenes side by side with their source and walking-package identities visible."),
    );
    const visual = createElement("button", "quiet-button wide", "Compare scenes side by side");
    visual.toggleAttribute("disabled", !visualAvailable);
    visual.title = visualAvailable
      ? ""
      : "Two versions need verified web scenes, approved navigation, and capture registration.";
    visual.addEventListener("click", () => openVersionComparison(input.projectId, [...input.versions]));
    card.append(visual, createElement("hr", "section-rule"));
    card.append(
      createElement("h4", "", "Authored geometry change evidence"),
      createElement("p", "muted-copy", "Metric footprints and an XZ overlay are generated only when both versions are asserted to share a coordinate frame."),
    );
    if (!input.geometryReports.length) {
      card.append(createElement("p", "muted-copy", "No geometry comparison has been generated for this project."));
    }
    for (const report of input.geometryReports) card.append(renderGeometryChangeReport(input.projectId, report));
    if (geometryAvailable) {
      const compare = createElement(
        "button",
        "quiet-button wide",
        input.geometryReports.length ? "Generate another geometry comparison" : "Compare authored geometry",
      );
      compare.addEventListener("click", openGeometryChangeDialog);
      card.append(compare);
    } else {
      card.append(createElement(
        "p",
        "field-note",
        "Two versions need reviewed metric structure before authored geometry can be compared.",
      ));
    }
    card.append(
      createElement("hr", "section-rule"),
      createElement("h4", "", "Registered raw-scene change evidence"),
      createElement("p", "muted-copy", "A leased processor can estimate bounded yaw and translation, enforce overlap/RMSE/ambiguity gates, then compare verified PLY occupancy, centroid movement, and mean colour. Results remain human-reviewed evidence, not survey or causation claims."),
    );
    if (!input.rawReports.length) {
      card.append(createElement("p", "muted-copy", "No registered raw-scene comparison has been queued for this project."));
    }
    for (const report of input.rawReports.slice(0, 8)) card.append(renderRawSceneChangeReport(report));
    const compareRaw = createElement(
      "button",
      "quiet-button wide",
      input.rawReports.length ? "Queue another registration + comparison" : "Register and compare PLY assets",
    );
    compareRaw.toggleAttribute("disabled", !rawAvailable);
    compareRaw.title = rawAvailable
      ? ""
      : "Two versions need verified source PLY assets and capture-registration evidence.";
    compareRaw.addEventListener("click", openRawSceneChangeDialog);
    card.append(
      compareRaw,
      createElement(
        "small",
        "field-note",
        rawAvailable
          ? `${eligibleVersionCount("raw")} immutable versions have verified PLY and registration evidence.`
          : "Upload and verify source PLY assets and registration evidence on two immutable versions first.",
      ),
    );
    const excluded = input.readiness.versions.filter((version) =>
      !Object.values(version.modes).some((mode) => mode.eligible)
    );
    if (excluded.length) {
      card.append(createElement(
        "p",
        "field-note",
        `Excluded until evidence is complete: ${excluded.map((version) =>
          `v${version.versionNumber} (${[...new Set(
            Object.values(version.modes).flatMap((mode) => mode.reasons),
          )].join(", ")})`
        ).join("; ")}.`,
      ));
    }
    return card;
  }

  return { bind, cancel, openVersionComparison, renderStage };
}

function parseGeometryChangeSummary(value: string): GeometryChangeSummary | null {
  try {
    const parsed = JSON.parse(value) as GeometryChangeSummary;
    return parsed?.method === "authored-plan-geometry-diff-v1" ? parsed : null;
  } catch {
    return null;
  }
}

function renderGeometryChangeOverlay(summary: GeometryChangeSummary): HTMLElement {
  const stage = createElement("div", "geometry-change-visual");
  const bounds = summary.visual.bounds;
  if (!bounds || !summary.visual.overlays.length) {
    stage.append(createElement("p", "muted-copy", "No comparable footprints are available for an overlay."));
    return stage;
  }
  const width = 480;
  const height = 240;
  const padding = 18;
  const minZ = bounds.minZ ?? bounds.minY;
  const maxZ = bounds.maxZ ?? bounds.maxY;
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    stage.append(createElement("p", "muted-copy", "The stored overlay bounds are invalid."));
    return stage;
  }
  const spanX = Math.max(0.001, bounds.maxX - bounds.minX);
  const spanZ = Math.max(0.001, maxZ! - minZ!);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanZ);
  const offsetX = (width - spanX * scale) / 2;
  const offsetZ = (height - spanZ * scale) / 2;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Plan overlay comparing from-version dashed footprints with to-version solid footprints");
  for (const overlay of summary.visual.overlays) {
    for (const [side, points] of [["from", overlay.fromPoints], ["to", overlay.toPoints]] as const) {
      if (!points?.length) continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const projected = points.map<[number, number]>(([x, z]) => [
        offsetX + (x - bounds.minX) * scale,
        height - (offsetZ + (z - minZ!) * scale),
      ]);
      path.setAttribute("d", `${projected.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ")} Z`);
      path.setAttribute("class", `geometry-overlay ${side} ${overlay.classification}`);
      const label = document.createElementNS("http://www.w3.org/2000/svg", "title");
      label.textContent = `${overlay.label}: ${overlay.classification}, ${side} version`;
      path.append(label);
      svg.append(path);
    }
  }
  const legend = createElement("div", "geometry-change-legend");
  legend.append(createElement("span", "from", "From · dashed"), createElement("span", "to", "To · solid"));
  stage.append(svg, legend);
  return stage;
}

function parseRegisteredSceneChangeSummary(value: string | null): RegisteredSceneChangeSummary | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as RegisteredSceneChangeSummary;
    return parsed?.method === "registered-ply-voxel-change-v1" ? parsed : null;
  } catch {
    return null;
  }
}

function rawSceneChangeError(report: RegisteredSceneChangeReport): string {
  for (const value of [report.job_error_json, report.error_json]) {
    if (!value) continue;
    try {
      const parsed = JSON.parse(value) as { message?: unknown };
      if (typeof parsed.message === "string") return parsed.message;
    } catch {
      // The fallback remains actionable without exposing malformed stored state.
    }
  }
  return "The processor could not complete this registered comparison.";
}

function compactMetric(label: string, value: string | number): HTMLElement {
  const item = createElement("span", "");
  item.append(createElement("small", "", label), createElement("strong", "", String(value)));
  return item;
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
