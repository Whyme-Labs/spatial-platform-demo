import "@fontsource-variable/manrope";
import { wayfinderRevisionSummaryLines } from "./wayfinder-summary";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import {
  api,
  apiFile,
  ApiError,
  AUTH_SESSION_EXPIRED_EVENT,
  markAuthenticationEstablished,
  markAuthenticationSignedOut,
  restoreAuthenticationSession,
} from "./api";
import { isActionPending, runAction, SingleFlight } from "./action-state";
import {
  parseSceneRotationDegrees,
  SCENE_ROTATION_MAX_DEGREES,
  SCENE_ROTATION_MIN_DEGREES,
} from "../shared/scene-rotation";
import {
  comparisonWorkspaceAvailable,
  resolveComparisonWorkspaceSection,
} from "./project-stage-policy";
import type { ComparisonReadiness } from "../shared/comparison-readiness";
import {
  createCompareDomain,
  type GeometryChangeReport,
  type RegisteredSceneChangeReport,
} from "./studio/stages/compare";
import { hasAuthoredSpatialRuntime } from "../shared/spatial-release-guard";
import {
  parseStartingViewQualityMetrics,
  startingViewQualityViolations,
  startingViewQualityWarnings,
  type StartingViewQualityMetrics,
} from "../shared/starting-view-quality";
import {
  assetProducerIds,
  assetProducerForLegacyAdapter,
  captureAdapterDisplayLabel,
  captureAdapterProfiles,
  captureAssetPurposeCanAttachToExistingVersion,
  captureFileExtensionsForFormat,
  captureFormatForFileName,
  captureAssetFormats,
  captureFormatsForPurpose,
  inferCaptureAssetPurpose,
  captureOriginForLegacyAdapter,
  captureOriginIds,
  planProducedAssetImport,
  type CaptureAdapterId,
  type CaptureAssetFormat,
  type CaptureAssetPurpose,
} from "../shared/capture-adapters";
import {
  parseWorldUnit,
  PROVISIONAL_MEASUREMENT_DISCLAIMER,
  worldUnitSymbol,
  type WorldUnit,
} from "../shared/world-units";
import {
  applyRenderNativeFloorplanCorrection,
  type EditableFloorplan,
  type RenderNativeCorrectionMode,
} from "./render-native-floorplan";
import { sha256HexOfBlob } from "./sha256-stream";
import { parsePlyCoordinateDescriptor, PLY_COORDINATE_HEADER_BUDGET_BYTES, plyCoordinateHeaderBudgetError, preflightPairedPlyCoordinateDescriptors } from "../../scripts/capture-compatibility-core.mjs";
import {
  AUTOMATIC_PAIRED_CAPTURE_METHOD,
  ATTESTED_PAIRED_CAPTURE_METHOD,
} from "../shared/paired-capture-journey";
import {
  legacyUnspecifiedProjectWorkflowPolicy,
  parseProjectWorkflowPolicy,
  projectPolicyForDeliveryTemplate,
  type ProjectWorkflowPolicy,
} from "../shared/project-policies";
import {
  parseMeasurementGrade,
  publicationMeasurementDisclaimer,
} from "../shared/measurement-disclaimers";
import {
  adaRouteReviewClearance,
  navigationClearancePresetSummary,
  type NavigationClearancePresetId,
} from "../shared/navigation-clearance-presets";
import "../../styles.css";

type TurnstileWidgetOptions = {
  sitekey: string;
  action: string;
  theme: "dark";
  size: "compact" | "flexible";
  retry: "auto";
  "refresh-expired": "manual";
  "response-field": false;
  callback: (token: string) => void;
  "error-callback": (code: string) => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "unsupported-callback": () => void;
};
type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileWidgetOptions): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type User = {
  userId: string;
  organisationId: string;
  email: string;
  displayName: string;
  role: string;
};
type OrganisationMembership = {
  id: string;
  name: string;
  slug: string;
  role: string;
  membershipUpdatedAt: string | null;
  current: boolean;
};
type Project = {
  id: string;
  name: string;
  slug: string;
  status: string;
  captureAdapter: string;
  captureOrigin?: string;
  assetProducer: string | null;
  deliveryTemplate: string;
  projectTemplateId: string | null;
  workflowPolicy?: ProjectWorkflowPolicy;
  notes: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customFields: Record<string, string | number | boolean>;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
  activeReleaseSlug: string | null;
  updatedAt: string;
};
function effectiveProjectWorkflowPolicy(project: Project): ProjectWorkflowPolicy {
  if (project.workflowPolicy) return project.workflowPolicy;
  return projectPolicyForDeliveryTemplate(project.deliveryTemplate);
}
type ProjectCustomFieldDefinition = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type: "text" | "number" | "boolean" | "date" | "select" | "url";
  required: boolean;
  options: string[];
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
type PortfolioHandoffPreview = {
  valid: boolean;
  sourceOrganisation: { id: string; name: string };
  targetOrganisation: { id: string; name: string; slug: string };
  summary: {
    projects: number;
    customers: number;
    customFields: number;
    fieldsToCreate: number;
  };
  projects: Array<{ id: string; name: string; targetStatus: "DRAFT" }>;
  fieldsToCreate: ProjectCustomFieldDefinition[];
  conflicts: Array<{
    key: string;
    label: string;
    sourceType: string;
    targetType: string;
  }>;
  exclusions: {
    versions: true;
    assets: true;
    releases: true;
    jobs: true;
    reviews: true;
  };
  warning: string;
};
type AssetHandoffPreview = {
  valid: boolean;
  sourceSnapshotHash: string;
  sourceOrganisation: { id: string; name: string };
  targetOrganisation: { id: string; name: string; slug: string };
  project: { id: string; name: string; targetStatus: "INGESTED" };
  summary: {
    versions: number;
    assets: number;
    bytes: number;
    customFields: number;
    fieldsToCreate: number;
  };
  conflicts: Array<{
    key: string;
    label: string;
    sourceType: string;
    targetType: string;
  }>;
  exclusions: {
    releases: true;
    jobs: true;
    reviews: true;
    memberships: true;
    billing: true;
    uploadSessions: true;
  };
  warnings: string[];
};
type AssetHandoff = {
  id: string;
  sourceOrganisationId: string;
  targetOrganisationId: string;
  sourceProjectId: string;
  targetProjectId: string;
  sourceSnapshotHash: string;
  status: "queued" | "copying" | "finalizing" | "failed" | "completed" | "cancelled";
  totalVersions: number;
  totalAssets: number;
  totalBytes: number;
  copiedAssets: number;
  copiedBytes: number;
  progressPercent: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  items: Array<{
    id: string;
    sourceAssetId: string;
    targetAssetId: string;
    targetObjectKey: string;
    kind: string;
    format: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    status: "queued" | "copying" | "copied" | "failed" | "cancelled";
    attemptCount: number;
    errorMessage: string | null;
    copiedAt: string | null;
  }>;
};
type Asset = {
  id: string;
  version_id: string;
  kind: string;
  format: string;
  file_name: string;
  size_bytes: number;
  sha256: string | null;
  integrity_status: string;
};
type Version = {
  id: string;
  version_number: number;
  status: string;
  source_provenance_json?: string | null;
  manifest_json?: string | null;
  workflow_policy_revision_id?: string | null;
  workflow_policy_json?: string | null;
  workflow_policy_delivery_template?: string | null;
  workflow_policy_classification_status?: "classified" | "legacy_unknown";
  created_at: string;
};
function effectiveVersionWorkflowPolicy(
  project: Project,
  version: Version | null | undefined,
): ProjectWorkflowPolicy {
  if (!version) return effectiveProjectWorkflowPolicy(project);
  if (
    version.workflow_policy_revision_id === undefined &&
    version.workflow_policy_json === undefined
  ) return effectiveProjectWorkflowPolicy(project);
  if (!version.workflow_policy_revision_id || !version.workflow_policy_json) {
    return legacyUnspecifiedProjectWorkflowPolicy;
  }
  try {
    return parseProjectWorkflowPolicy(JSON.parse(version.workflow_policy_json)) ??
      legacyUnspecifiedProjectWorkflowPolicy;
  } catch {
    return legacyUnspecifiedProjectWorkflowPolicy;
  }
}
type Job = {
  id: string;
  project_id: string;
  version_id: string;
  project_name?: string;
  job_type: string;
  state: string;
  progress: number;
  progress_message: string | null;
  attempt_count: number;
  max_attempts: number;
  error_json?: string | null;
  compute_duration_ms?: number | null;
  active_human_duration_ms?: number | null;
  input_bytes?: number | null;
  output_bytes?: number | null;
  created_at: string;
};
type Release = {
  id: string;
  project_id?: string;
  project_name?: string;
  version_id: string;
  version_number: number;
  release_number: number;
  access_policy: string;
  published_at: string;
  expires_at?: string | null;
  revoked_at: string | null;
  viewer_config_json?: string | null;
  slug: string;
  is_active: number;
};
type CaptureBundleValidation = {
  method: "capture-bundle-contract-v1";
  result: "ready" | "ready_with_warnings" | "blocked";
  summary: {
    assetCount: number;
    totalBytes: number;
    roleCount: number;
    renderableNow: boolean;
    metricReady: boolean;
    reconstructionPortable: boolean;
    independentlyReconstructable: boolean;
    automationReady: boolean;
    sceneRegistered: boolean;
  };
  issues: Array<{
    code: string;
    severity: "blocker" | "warning";
    message: string;
    assetId?: string;
  }>;
  limitations: string[];
};
type CaptureBundle = {
  id: string;
  version_id: string;
  adapter: string;
  schema_version: "1.0.0";
  status: "ready" | "reviewed";
  result: "ready" | "ready_with_warnings" | "blocked";
  manifest_asset_id: string;
  manifest_hash: string;
  validation_json: string;
  review_decision: "accepted" | "needs_vendor_evidence" | "rejected" | null;
  review_note: string | null;
  review_generation: number;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};
type ProjectDetail = {
  project: Project;
  versions: Version[];
  assets: Asset[];
  jobs: Job[];
  releases: Release[];
  captureBundles: CaptureBundle[];
  comparisonReadiness: ComparisonReadiness;
  previewReadyVersionIds: string[];
  walkTestReadyVersionIds?: string[];
};
const emptyComparisonReadiness: ComparisonReadiness = {
  available: false,
  eligiblePairs: [],
  versions: [],
};
type ProjectTemplate = {
  id: string;
  name: string;
  description: string | null;
  captureAdapter: string;
  deliveryTemplate: string;
  notes: string | null;
  policy: ProjectWorkflowPolicy;
  createdAt: string;
  updatedAt: string;
};
type ProjectViewFilter = {
  query: string;
  statuses: string[];
  captureAdapters: string[];
  deliveryTemplates: string[];
  sort: "updated_desc" | "updated_asc" | "name_asc" | "name_desc";
};
type SavedProjectView = {
  id: string;
  name: string;
  filter: ProjectViewFilter;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};
type PortfolioManifest = {
  format: "whymelabs.spatial.portfolio";
  schemaVersion: 1 | 2;
  exportedAt?: string;
  fieldDefinitions?: Array<{
    key: string;
    label: string;
    description?: string | null;
    type: ProjectCustomFieldDefinition["type"];
    required: boolean;
    options: string[];
    sortOrder: number;
  }>;
  projects: Array<{
    sourceId?: string;
    name: string;
    customerName?: string | null;
    customerEmail?: string | null;
    captureAdapter: string;
    deliveryTemplate: string;
    notes?: string | null;
    customFields?: Record<string, string | number | boolean | null>;
  }>;
};
type PortfolioPreview = {
  valid: boolean;
  schemaVersion: number;
  summary: {
    projects: number;
    customers: number;
    existingNameMatches: number;
    customFields?: number;
    fieldsToCreate?: number;
  };
  warnings: string[];
  conflicts?: Array<{
    key: string;
    label: string;
    sourceType: string;
    targetType: string;
  }>;
  projects: Array<{
    sourceId: string | null;
    name: string;
    customerName: string | null;
    captureAdapter: string;
    deliveryTemplate: string;
    targetStatus: "DRAFT";
    nameAlreadyExists: boolean;
  }>;
};
type ReviewProject = {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: string;
  latest_version_id: string | null;
  latest_version_number: number | null;
  release_slug: string | null;
};
type ReviewComment = {
  id: string;
  version_id: string;
  kind: "comment" | "redaction";
  status: "open" | "resolved" | "dismissed";
  body: string;
  author_email?: string;
  author_name?: string;
  created_at: string;
};
type ReviewDecision = {
  id: string;
  version_id: string;
  decision: "approved" | "changes_requested";
  note: string | null;
  reviewer_email?: string;
  reviewer_name?: string;
  created_at: string;
};
type Reviewer = {
  invitation_id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  invitation_status: string;
  expires_at: string;
  revoked_at: string | null;
};
type ReviewDetail = {
  comments: ReviewComment[];
  decisions: ReviewDecision[];
  reviewers?: Reviewer[];
  versions?: Version[];
};
type VersionRenderable = {
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
  spatial: Pick<
    SpatialWorkspace,
    | "entities"
    | "routes"
    | "routeStops"
    | "collisionProxy"
    | "navigationMesh"
    | "obstacleProxy"
    | "navigationProfile"
    | "navigationArtifact"
  >;
  viewer: {
    splatBudgetMillions?: number;
    defaultMovementMode?: "walk" | "fly";
    sceneRotationDegrees?: [number, number, number];
    sourceToWorld?: {
      sourceUpAxis: "Y" | "Z";
      worldUnit?: WorldUnit;
      metresPerSourceUnit: number;
      yawDegrees: number;
      translationMetres: [number, number, number];
    };
    initialCamera?: {
      position: [number, number, number];
      target: [number, number, number];
      up?: [number, number, number];
      fovDegrees?: number;
    };
  } | null;
};
type SceneAuthoringRenderable = Pick<
  VersionRenderable,
  | "versionId"
  | "assetId"
  | "format"
  | "fileName"
  | "mimeType"
  | "sizeBytes"
  | "sha256"
  | "contentUrl"
  | "sessionExpiresAt"
  | "viewer"
> & { purpose: "spatial-authoring" };

function sendVersionSpatialRuntime(
  frame: HTMLIFrameElement,
  renderable: VersionRenderable,
): void {
  const spatial = renderable.spatial;
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
    obstacleBoxes: spatial.obstacleProxy.boxes,
    doorwayBoxes: spatial.collisionProxy.boxes.filter((box) =>
      doorwayEntityIds.has(box.entityId)
    ),
    navigationProfile: spatial.navigationProfile,
    navigationArtifact: spatial.navigationArtifact,
    collisionUrl: renderable.collisionUrl,
    defaultMovementMode: renderable.viewer?.defaultMovementMode ?? "walk",
  }, location.origin);
}

function rendererAssetUrl(renderable: Pick<
  VersionRenderable,
  "contentUrl" | "format" | "viewer"
>): URL {
  const url = new URL("/renderer/index.html", location.origin);
  url.searchParams.set("content", renderable.contentUrl);
  url.searchParams.set("format", renderable.format);
  url.searchParams.set("budget", String(renderable.viewer?.splatBudgetMillions ?? 1.25));
  const rotation = renderable.viewer?.sceneRotationDegrees;
  if (rotation) url.searchParams.set("rotation", rotation.join(","));
  if (renderable.viewer?.sourceToWorld) {
    url.searchParams.set(
      "sourceToWorld",
      JSON.stringify(renderable.viewer.sourceToWorld),
    );
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

function validNumberTuple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => Number.isFinite(item));
}
type HostingPlan = {
  code: string;
  name: string;
  monthly_price_cents: number;
  included_storage_bytes: number;
  included_delivery_bytes: number;
  retention_days: number;
};
type HostingSubscription = {
  id: string;
  project_id: string;
  project_name: string;
  plan_code: string;
  plan_name: string;
  status: string;
  current_period_end: string;
  renews_automatically: number;
  storage_bytes: number;
  included_storage_bytes: number;
  payment_provider: string | null;
  provider_subscription_id: string | null;
  provider_cancel_at_period_end: number;
  billing_note: string | null;
};
type HostingCheckout = {
  id: string;
  project_id: string;
  project_name: string;
  plan_code: string;
  status: string;
  amount_cents: number;
  currency: string;
  payment_provider: string;
  provider_checkout_id: string | null;
  payment_status: string | null;
  checkout_url: string | null;
  last_error: string | null;
  expires_at: string | null;
  completed_at: string | null;
  created_at: string;
};
type HostingWorkspace = {
  paymentProviderConfigured: boolean;
  manualBillingEnabled: boolean;
  plans: HostingPlan[];
  subscriptions: HostingSubscription[];
  checkouts: HostingCheckout[];
  invoices: Array<{
    id: string;
    project_name: string;
    status: string;
    currency: string;
    amount_cents: number;
    due_at: string;
    period_start: string;
    period_end: string;
    paid_at: string | null;
    billing_method: "manual" | "provider";
    external_reference: string | null;
    payment_reference: string | null;
    note: string | null;
    subscription_id: string;
  }>;
  alerts: Array<{ id: string; kind: string; label: string; detail: string | null; created_at: string }>;
  lifecycleRuns: Array<{
    id: string;
    trigger_type: string;
    status: string;
    summary_json: string;
    started_at: string;
    completed_at: string | null;
    error_message: string | null;
    action_count: number;
  }>;
};
type CustomDomain = {
  id: string;
  hostname: string;
  status:
    | "ownership_pending"
    | "provider_configuration_required"
    | "ready_to_provision"
    | "provider_pending"
    | "active"
    | "failed";
  dnsVerifiedAt: string | null;
  provider: string | null;
  providerHostnameId: string | null;
  providerStatus: string | null;
  providerSslStatus: string | null;
  providerValidation: {
    ownershipVerification?: { name?: string; type?: string; value?: string } | null;
    sslValidationRecords?: Array<{
      status?: string | null;
      txtName?: string | null;
      txtValue?: string | null;
    }>;
    verificationErrors?: string[];
  };
  provisioningAttempts: number;
  lastCheckedAt: string | null;
  provisionedAt: string | null;
  lastError: string | null;
  createdAt: string;
};
type CustomDomainWorkspace = {
  providerConfigured: boolean;
  cnameTarget: string;
  domains: CustomDomain[];
};
type SpatialEntity = {
  id: string;
  parent_id: string | null;
  kind: "floor" | "room" | "doorway" | "poi";
  label: string;
  description: string | null;
  position_json: string | null;
  geometry_json: string | null;
  world_unit: WorldUnit;
  status: string;
};
type CaptureCompletenessSummary = {
  method: "authored-room-trajectory-coverage-v1";
  result: "complete" | "complete_with_warnings" | "recapture_required" | "insufficient_evidence";
  scope: "pose_path_against_authored_rooms";
  limitation: string;
  version: { id: string; versionNumber: number };
  source: {
    adapter: string;
    fileName: string;
    format: "canonical_pose_json_v1";
    coordinateFrame: string;
    alignmentEvidence: string;
  };
  parameters: {
    coverageRadiusM: number;
    maximumSampleGapM: number;
    loopClosureRadiusM: number;
    minimumRoomCoveragePercent: number;
    verticalToleranceM: number;
  };
  summary: {
    sampleCount: number;
    roomCount: number;
    roomsMeetingCoverage: number;
    roomsBelowCoverage: number;
    pathLengthM: number;
    maximumGapM: number;
    gapCount: number;
    startEndDistanceM: number;
    loopClosed: boolean;
    durationSeconds: number | null;
  };
  rooms: Array<{
    entityId: string;
    label: string;
    classification: "covered" | "recapture";
    coveragePercent: number;
    sampleCount: number;
    coveredGridPoints: number;
    totalGridPoints: number;
  }>;
  issues: Array<{
    code: string;
    severity: "blocker" | "warning";
    message: string;
    roomId?: string;
    roomLabel?: string;
    segmentIndex?: number;
  }>;
  blockers: string[];
  invalidRooms: Array<{ entityId: string; label: string; reason: string }>;
  visual: {
    coordinatePlane: "XZ";
    units: "metres";
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number } | null;
    rooms: Array<{
      entityId: string;
      label: string;
      classification: "covered" | "recapture";
      points: Array<[number, number]>;
    }>;
    trajectory: Array<[number, number]>;
    blindSpots: Array<{ roomId: string; roomLabel: string; position: [number, number] }>;
    gapSegments: Array<{ segmentIndex: number; from: [number, number]; to: [number, number]; distanceM: number }>;
  };
};
type CaptureCompletenessReport = {
  id: string;
  version_id: string;
  status: "ready" | "reviewed";
  method: string;
  result: CaptureCompletenessSummary["result"];
  source_asset_id: string;
  source_file_name: string;
  source_format: string;
  source_hash: string;
  coordinate_frame: string;
  alignment_evidence: string;
  parameters_json: string;
  summary_json: string;
  review_decision: "accepted" | "needs_recapture" | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};
// A read-only reading of a public ASTM E57 container. Vendor extension field
// names are listed verbatim; the platform decodes no vendor classification or
// mesh schema, so this card never asserts what those names mean.
type CaptureScanStructure = {
  id: string;
  assetId: string;
  assetFileName: string;
  assetFormat: string;
  reportAssetId: string | null;
  reportFileName: string | null;
  reportSha256: string | null;
  method: string;
  status: "structure_read" | "structure_unreadable";
  sourceFormat: string;
  scanCount: number;
  imageCount: number;
  hasPerScanPoses: boolean;
  vendorFieldNames: string[];
  unreadableReason: string | null;
  createdAt: string;
  limitation: string;
};
type SpatialWorkspace = {
  version: { id: string; version_number: number } | null;
  entities: SpatialEntity[];
  routes: Array<{ id: string; label: string; accessibility: string; estimated_seconds: number | null }>;
  routeStops: Array<{ route_id: string; entity_id: string; sequence_number: number }>;
  privacyRegions: Array<{ id: string; label: string; source: string; status: string; confidence: number | null }>;
  privacyScans: Array<{
    id: string;
    status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "DEAD_LETTER";
    detector: string;
    detector_version: string;
    attempt_count: number;
    max_attempts: number;
    input_count: number;
    candidate_count: number;
    evidence_json: string | null;
    error_json: string | null;
    created_at: string;
    completed_at: string | null;
  }>;
  privacyCandidates: Array<{
    id: string;
    scan_id: string;
    asset_id: string;
    asset_file_name: string;
    asset_mime_type: string;
    target: string;
    label: string;
    bbox_json: string;
    confidence: number | null;
    detector_metadata_json: string;
    status: "pending" | "confirmed" | "dismissed" | "resolved";
    decision_note: string | null;
    created_at: string;
    reviewed_at: string | null;
  }>;
  changeReports: GeometryChangeReport[];
  captureCompletenessReports: CaptureCompletenessReport[];
  captureScanStructures: CaptureScanStructure[];
  rawChangeReports: RegisteredSceneChangeReport[];
  semanticExtractions: Array<{
    id: string;
    version_id: string;
    input_asset_id: string;
    job_id: string;
    method: string;
    status: "QUEUED" | "PROCESSING" | "READY_FOR_REVIEW" | "REVIEWED" | "FAILED";
    parameters_json: string;
    summary_json: string | null;
    candidate_count: number;
    review_decision: "accept_selected" | "reject_all" | null;
    review_note: string | null;
    job_state: string;
    job_progress: number;
    job_progress_message: string | null;
    job_error_json: string | null;
    input_file_name: string;
    input_size_bytes: number;
    created_at: string;
  }>;
  semanticCandidates: Array<{
    id: string;
    extraction_id: string;
    candidate_key: string;
    kind: "walkable_region";
    label: string;
    geometry_json: string;
    elevation: number;
    area: number;
    worldUnit: WorldUnit;
    confidence: number;
    evidence_json: string;
    status: "pending" | "accepted" | "rejected";
    scene_entity_id: string | null;
  }>;
  floorplanExtractions: Array<{
    id: string;
    version_id: string;
    input_asset_id: string;
    job_id: string;
    method: string;
    normalizer: string;
    status: "QUEUED" | "PROCESSING" | "READY_FOR_REVIEW" | "REVIEWED" | "REJECTED" | "FAILED" | "CANCELLED";
    parameters_json: string;
    source_evidence_json: string;
    proposal_json: string | null;
    proposal_hash: string | null;
    report_asset_id: string | null;
    review_decision: "approve" | "reject" | null;
    review_note: string | null;
    error_json: string | null;
    job_state: string;
    job_progress: number;
    job_progress_message: string | null;
    job_error_json: string | null;
    input_file_name: string;
    input_format: string;
    input_size_bytes: number;
    created_at: string;
  }>;
  floorplanRevisions: Array<{
    id: string;
    version_id: string;
    extraction_id: string;
    revision_number: number;
    measurement_class: "indicative";
    status: "approved" | "superseded";
    plan_json: string;
    plan_hash: string;
    source_proposal_hash: string;
    review_note: string;
    capture_agreement_json?: string | null;
    trajectory_evidence_json?: string | null;
    approved_at: string;
    created_at: string;
  }>;
  floorplanExports: Array<{
    id: string;
    revision_id: string;
    asset_id: string;
    format: "svg" | "pdf" | "dxf";
    generator_version: string;
    plan_hash: string;
    status: "ready" | "superseded";
    file_name: string;
    mime_type: string;
    size_bytes: number;
    sha256: string;
    created_at: string;
    download_url: string;
  }>;
  deliveryPolicy: Record<string, unknown> | null;
  collisionProxy: { version: string; boxes: Array<{ entityId: string; label: string; min: number[]; max: number[] }> };
  navigationMesh: { version: string; vertices: number[][]; indices: number[]; sourceEntityIds: string[] };
  navigationObstacles: Array<{
    id: string;
    label: string;
    bounds_json: string;
    metadata_json: string;
    world_unit: WorldUnit;
  }>;
  navigationTraversals: Array<{
    id: string;
    traversal_kind: "elevator" | "ladder" | "moving_platform";
    label: string;
    path_json: string;
    bidirectional: number;
    speed_units_per_second: number;
    reviewed_purpose: string;
    evidence_asset_id: string;
    evidence_sha256: string;
    evidence_manifest_id: string;
    evidence_manifest_sha256: string;
    evidence_adapter: string;
    evidence_manifest_review_generation: number;
    evidence_registration_sha256: string | null;
    evidence_source_to_world_json: string | null;
    evidence_source_path_json: string | null;
    created_at: string;
    updated_at: string;
  }>;
  traversalEvidenceOptions: Array<{
    assetId: string;
    fileName: string;
    kind: string;
    sha256: string;
    manifestId: string;
    manifestSha256: string;
    adapter: string;
    reviewGeneration: number;
    registrationSha256: string;
    sourceToWorld: {
      sourceUpAxis: "Y" | "Z";
      worldUnit: "metres";
      metresPerSourceUnit: number;
      yawDegrees: number;
      translationMetres: [number, number, number];
    };
  }>;
  obstacleProxy: {
    version: string;
    boxes: Array<{ entityId: string; label: string; min: number[]; max: number[] }>;
  };
  navigationProfile: {
    worldUnit?: WorldUnit;
    agentRadius: number;
    agentHeight: number;
    eyeHeight: number;
    maxStepMetres: number;
    maxSlopeDegrees: number;
    maxSpeed: number;
    maxAcceleration: number;
  };
  navigationBuilds: Array<{
    id: string;
    collision_asset_id: string;
    job_id: string;
    status: "QUEUED" | "PROCESSING" | "READY_FOR_REVIEW" | "APPROVED" | "REJECTED" | "FAILED";
    parameters_json: string;
    artifact_json: string | null;
    navmesh_asset_id: string | null;
    report_asset_id: string | null;
    review_note: string | null;
    reviewed_at: string | null;
    created_at: string;
    updated_at: string;
  }>;
  walkTests: Array<{
    id: string;
    navigation_build_id: string;
    start_pose_json: string;
    end_pose_json: string;
    runtime_evidence_json: string;
    completed_by: string;
    completed_at: string;
  }>;
  releaseRepublishIntents: Array<{
    id: string;
    navigation_build_id: string;
    source_release_id: string;
    status: "pending" | "completed" | "failed";
    completed_release_id: string | null;
    error_message: string | null;
    slug: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  }>;
  navigationArtifact: Record<string, unknown> | null;
};
type MeasurementWorkspace = {
  briefs: Array<{
    id: string;
    version_id: string;
    product_type: string;
    intended_use: string;
    tolerance_mm: number;
    reliance_class: string;
    status: string;
    created_at: string;
  }>;
  checkPoints: Array<{ id: string; brief_id: string; label: string; residual_mm: number }>;
  qaReports: Array<{ id: string; brief_id: string; point_count: number; rmse_mm: number | null; max_mm: number | null; tolerance_mm: number; result: string }>;
  signoffs: Array<{ id: string; brief_id: string; professional_name: string; registration_body: string; registration_number: string }>;
  costs: Array<{ id: string; category: string; amount_cents: number; quantity: number; currency: string }>;
  deliverables: Array<{
    id: string;
    brief_id: string;
    version_id: string;
    qa_report_id: string;
    asset_id: string;
    deliverable_type: string;
    source_geometry_hash: string;
    generator_version: string;
    status: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    sha256: string;
    created_at: string;
  }>;
  economics: { totalCostCents: number; currency: string };
};
type RecoverableUpload = {
  id: string;
  projectId: string;
  versionId: string;
  assetId: string;
  fileName: string;
  format: string;
  purpose: CaptureAssetPurpose;
  mimeType: string;
  expectedSizeBytes: number;
  uploadedBytes: number;
  sha256: string | null;
  partSizeBytes: number;
  expiresAt: string;
  createdAt: string;
  expired: boolean;
  parts: Array<{ partNumber: number; etag: string; sizeBytes: number; uploadedAt: string }>;
};
type TeamMember = {
  userId: string;
  email: string;
  displayName: string;
  role: "platform_admin" | "production_operator";
  status: "active" | "invited" | "revoked";
  joinedAt: string;
  updatedAt: string | null;
  revokedAt: string | null;
  lastActiveAt: string | null;
};
type TeamInvitation = {
  id: string;
  email: string;
  role: "platform_admin" | "production_operator";
  status: "pending" | "accepted" | "expired" | "revoked";
  invitedAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  lastSentAt: string | null;
  sendCount: number;
  invitedBy: string;
};
type TeamWorkspace = { members: TeamMember[]; invitations: TeamInvitation[] };
// Invitations addressed to this signed-in account. Auto-acceptance only covers
// first-time onboarding, so an account that already belongs to an organisation
// answers each invitation explicitly from the workspace.
type PendingOrganisationInvitation = {
  id: string;
  organisationId: string;
  organisationName: string;
  role: "platform_admin" | "production_operator";
  invitedAt: string;
  expiresAt: string;
};
type OrganisationInvitationAnswer = {
  invitation: PendingOrganisationInvitation & { status: "accepted" | "declined" };
};
type EnterpriseIdentityProvider = {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  emailDomains: string[];
  status: "draft" | "active" | "disabled";
  secretConfigured: boolean;
  discovery: Record<string, unknown> | null;
  discoveryCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
type EnterpriseIdentityProviderWorkspace = {
  providers: EnterpriseIdentityProvider[];
};
type CaptureAgentCredential = {
  id: string;
  name: string;
  status: "active" | "expired" | "revoked";
  generation: number;
  projectIds: string[];
  expiresAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  rotatedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type ProjectBulkLifecycleResult = {
  operationId: string;
  clientOperationId: string;
  action: "archive" | "restore";
  requestedCount: number;
  idempotent?: boolean;
  summary: {
    changed: number;
    unchanged: number;
    blocked: number;
    notFound: number;
  };
  results: Array<{
    projectId: string;
    projectName?: string;
    outcome: "changed" | "unchanged" | "blocked" | "not_found";
    status?: string;
    message?: string;
  }>;
};
type StudioView = "projects" | "project" | "jobs" | "releases" | "reviews" | "hosting" | "team";
type ProjectSection =
  | "overview"
  | "process"
  | "structure"
  | "privacy"
  | "compare"
  | "walk"
  | "publish"
  | "measurement"
  | "expert";

type ProjectStageCapability =
  | "structure-processing-poll"
  | "privacy-evidence-poll"
  | "comparison-evidence-poll";

const projectStageCapabilities: Record<ProjectSection, readonly ProjectStageCapability[]> = {
  overview: [],
  process: [],
  structure: ["structure-processing-poll"],
  privacy: ["privacy-evidence-poll"],
  compare: ["comparison-evidence-poll"],
  walk: [],
  publish: [],
  measurement: [],
  expert: [],
};

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

const state: {
  user: User | null;
  organisations: OrganisationMembership[];
  pendingInvitations: PendingOrganisationInvitation[];
  projects: Project[];
  projectsNextCursor: string | null;
  jobs: Job[];
  jobsNextCursor: string | null;
  releases: Release[];
  releasesNextCursor: string | null;
  reviewProjects: ReviewProject[];
  reviewDetails: Record<string, ReviewDetail>;
  hosting: HostingWorkspace | null;
  spatial: SpatialWorkspace | null;
  spatialProjectId: string | null;
  spatialVersionId: string | null;
  measurement: MeasurementWorkspace | null;
  measurementProjectId: string | null;
  recoverableUploads: RecoverableUpload[];
  team: TeamWorkspace | null;
  identityProviders: EnterpriseIdentityProvider[];
  captureAgents: CaptureAgentCredential[];
  selected: ProjectDetail | null;
  selectedProjectIds: Set<string>;
  projectTemplates: ProjectTemplate[];
  projectTemplatesNextCursor: string | null;
  projectFields: ProjectCustomFieldDefinition[];
  projectViews: SavedProjectView[];
  projectViewsNextCursor: string | null;
  activeProjectViewId: string | null;
  projectStatuses: string[];
  projectQuery: string;
  projectAdapter: string;
  projectDelivery: string;
  projectSort: ProjectViewFilter["sort"];
  projectSection: ProjectSection;
  view: StudioView;
} = {
  user: null,
  organisations: [],
  pendingInvitations: [],
  projects: [],
  projectsNextCursor: null,
  jobs: [],
  jobsNextCursor: null,
  releases: [],
  releasesNextCursor: null,
  reviewProjects: [],
  reviewDetails: {},
  hosting: null,
  spatial: null,
  spatialProjectId: null,
  spatialVersionId: null,
  measurement: null,
  measurementProjectId: null,
  recoverableUploads: [],
  team: null,
  identityProviders: [],
  captureAgents: [],
  selected: null,
  selectedProjectIds: new Set(),
  projectTemplates: [],
  projectTemplatesNextCursor: null,
  projectFields: [],
  projectViews: [],
  projectViewsNextCursor: null,
  activeProjectViewId: null,
  projectStatuses: [],
  projectQuery: "",
  projectAdapter: "",
  projectDelivery: "",
  projectSort: "updated_desc",
  projectSection: "overview",
  view: "projects",
};

function projectPollingContextIsActive(
  projectId: string,
  capability: ProjectStageCapability,
): boolean {
  return state.selected?.project.id === projectId &&
    state.view === "project" &&
    projectStageCapabilities[state.projectSection].includes(capability);
}

let authenticationStatus: "checking" | "authenticated" | "signed-out" | "unavailable" = "checking";

const loginDialog = byId<HTMLDialogElement>("loginDialog");
const newProjectDialog = byId<HTMLDialogElement>("newProjectDialog");
const savedViewDialog = byId<HTMLDialogElement>("savedViewDialog");
const portfolioToolsDialog = byId<HTMLDialogElement>("portfolioToolsDialog");
const editProjectDialog = byId<HTMLDialogElement>("editProjectDialog");
const uploadDialog = byId<HTMLDialogElement>("uploadDialog");
const qaDialog = byId<HTMLDialogElement>("qaDialog");
const releaseDialog = byId<HTMLDialogElement>("releaseDialog");
const reviewerDialog = byId<HTMLDialogElement>("reviewerDialog");
const deliveryDialog = byId<HTMLDialogElement>("deliveryDialog");
const domainDialog = byId<HTMLDialogElement>("domainDialog");
const entityDialog = byId<HTMLDialogElement>("entityDialog");
const navigationProfileDialog = byId<HTMLDialogElement>("navigationProfileDialog");
const navigationTraversalDialog = byId<HTMLDialogElement>("navigationTraversalDialog");
const navigationBuildDialog = byId<HTMLDialogElement>("navigationBuildDialog");
const semanticExtractionDialog = byId<HTMLDialogElement>("semanticExtractionDialog");
const semanticReviewDialog = byId<HTMLDialogElement>("semanticReviewDialog");
const floorplanExtractionDialog = byId<HTMLDialogElement>("floorplanExtractionDialog");
const floorplanReviewDialog = byId<HTMLDialogElement>("floorplanReviewDialog");
const routeDialog = byId<HTMLDialogElement>("routeDialog");
const privacyCandidateDialog = byId<HTMLDialogElement>("privacyCandidateDialog");
const measurementBriefDialog = byId<HTMLDialogElement>("measurementBriefDialog");
const checkPointDialog = byId<HTMLDialogElement>("checkPointDialog");
const captureCompletenessDialog = byId<HTMLDialogElement>("captureCompletenessDialog");
const captureCompletenessReviewDialog = byId<HTMLDialogElement>("captureCompletenessReviewDialog");
const captureBundleDialog = byId<HTMLDialogElement>("captureBundleDialog");
const captureBundleReviewDialog = byId<HTMLDialogElement>("captureBundleReviewDialog");
const teamInvitationDialog = byId<HTMLDialogElement>("teamInvitationDialog");
const identityProviderDialog = byId<HTMLDialogElement>("identityProviderDialog");
const captureAgentDialog = byId<HTMLDialogElement>("captureAgentDialog");
const captureAgentTokenDialog = byId<HTMLDialogElement>("captureAgentTokenDialog");
let activeMeasurementBriefId: string | null = null;
const backgroundActions = new SingleFlight();
let authChallengeId: string | null = null;
let otpResendAvailableAt = 0;
let otpCooldownTimer: number | null = null;
let turnstileToken: string | null = null;
let turnstileWidgetId: string | null = null;
let turnstileLoadPromise: Promise<TurnstileApi> | null = null;
let turnstileInitialisePromise: Promise<void> | null = null;
let projectOperationId: string | null = null;
let newCaptureIntakeStep: 1 | 2 | 3 = 1;
let captureQualificationMode:
  | typeof AUTOMATIC_PAIRED_CAPTURE_METHOD
  | typeof ATTESTED_PAIRED_CAPTURE_METHOD = ATTESTED_PAIRED_CAPTURE_METHOD;
let captureQualificationRenderGeneration = 0;
let latestWalkTestPose: {
  position: [number, number, number];
  target: [number, number, number];
  observedAt: number;
} | null = null;
let previousWalkTestSample: { position: [number, number, number]; observedAt: number } | null = null;
let activeWalkTestSession: {
  projectId: string;
  versionId: string;
  buildId: string;
  clientOperationId: string | null;
  startPose: { position: [number, number, number]; target: [number, number, number] } | null;
  movementObserved: boolean;
  runtimeFailure: string | null;
} | null = null;
let captureJourneyOperation: {
  id: string;
  primaryUploadOperationId: string;
  geometryUploadOperationId: string;
} | null = null;
let templateOperation: { id: string; requestKey: string } | null = null;
let savedViewOperation: { id: string; requestKey: string } | null = null;
let portfolioImportOperationId: string | null = null;
let portfolioImportManifest: PortfolioManifest | null = null;
let portfolioImportPreview: PortfolioPreview | null = null;
let portfolioImportCommitted = false;
let projectFieldOperation: { id: string; requestKey: string } | null = null;
let portfolioHandoffOperationId: string | null = null;
let portfolioHandoffPreview: PortfolioHandoffPreview | null = null;
let portfolioHandoffCommitted = false;
let assetHandoffOperationId: string | null = null;
let assetHandoffPreview: AssetHandoffPreview | null = null;
let activeAssetHandoff: AssetHandoff | null = null;
let assetHandoffRetryOperationId: string | null = null;
let assetHandoffCancelOperationId: string | null = null;
let assetHandoffPollTimer: number | null = null;
let projectViewsInitialised = false;
let editingSpatialEntity: SpatialEntity | null = null;
let editingNavigationTraversal: SpatialWorkspace["navigationTraversals"][number] | null = null;
let releaseOperationId: string | null = null;
let reviewerOperationId: string | null = null;
let teamInvitationOperationId: string | null = null;
let captureAgentOperationId: string | null = null;
let bulkLifecycleOperation: {
  id: string;
  action: "archive" | "restore";
  projectIdsKey: string;
} | null = null;
let pendingUploadOperation: {
  id: string;
  projectId: string;
  fileName: string;
  fileSize: number;
  format: string;
  purpose: CaptureAssetPurpose;
  targetVersionId: string | null;
  captureJourneyId: string | null;
  sha256: string | null;
} | null = null;
let activeUpload: {
  id: string;
  projectId: string;
  fileName: string;
  fileSize: number;
  format: string;
  purpose: CaptureAssetPurpose;
  partSizeBytes: number;
  sha256: string | null;
  parts: Map<number, string>;
} | null = null;
let uploadAbortController: AbortController | null = null;
let privacyScanOperation: { versionId: string; id: string } | null = null;
let captureCompletenessOperation: {
  id: string;
  requestKey: string;
} | null = null;
let captureBundleOperation: {
  id: string;
  requestKey: string;
} | null = null;
let semanticExtractionOperation: {
  id: string;
  requestKey: string;
} | null = null;
let semanticReviewOperation: {
  id: string;
  requestKey: string;
} | null = null;
let floorplanExtractionOperation: {
  id: string;
  requestKey: string;
} | null = null;
let floorplanReviewOperation: {
  id: string;
  requestKey: string;
} | null = null;
const floorplanExportOperations = new Map<string, { id: string; requestKey: string }>();
let customDomainWorkspace: CustomDomainWorkspace | null = null;
const customDomainChallenges = new Map<string, string>();
let privacyScanPollGeneration = 0;
let semanticExtractionPollGeneration = 0;
let floorplanExtractionPollGeneration = 0;
type CaptureAgreementFinding = {
  kind: string;
  barrierId: string;
  levelKey?: string | null;
  elevationM?: number;
  spanCount: number;
  metres: number;
  from: [number, number];
  to: [number, number];
  maximumSpanPoints: number;
};

let sceneAuthoringWorkspace: {
  projectId: string;
  versionId: string;
  extractionId: string | null;
  revisionId: string | null;
  plan: EditableFloorplan | null;
  history: EditableFloorplan[];
  dirty: boolean;
  mode: RenderNativeCorrectionMode | null;
  requestId: string | null;
  points: Array<[number, number, number]>;
  frame: HTMLIFrameElement;
  status: HTMLElement;
  finish: HTMLButtonElement;
  undo: HTMLButtonElement;
  save: HTMLButtonElement;
  modeButtons: HTMLButtonElement[];
  correctionDraftOperationId: string;
  correctionReviewOperationId: string;
  republishReleaseId: string | null;
  captureAgreementFindings: CaptureAgreementFinding[];
  captureAgreementClassifications: Map<string, string>;
} | null = null;
type ReleaseCameraPose = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovDegrees: number;
};
let latestReleaseCameraPose: ReleaseCameraPose | null = null;
// The pending "Use current view" capture request and the quality receipt of
// the most recent capture. The receipt stays bound to the exact pose it
// measured: if the operator edits the expert camera fields afterwards, the
// receipt no longer describes the published pose and is dropped at submit.
let releaseViewCaptureRequestId: string | null = null;
let latestReleaseViewQuality: {
  metrics: StartingViewQualityMetrics;
  pose: ReleaseCameraPose;
} | null = null;

const compareDomain = createCompareDomain({
  currentProject: () => state.selected
    ? {
        id: state.selected.project.id,
        versions: state.selected.versions,
        assets: state.selected.assets,
        comparisonReadiness: state.selected.comparisonReadiness,
      }
    : null,
  currentRawReports: () => state.spatial?.rawChangeReports ?? [],
  loadSpatialWorkspace,
  pollingContextIsActive: (projectId) =>
    projectPollingContextIsActive(projectId, "comparison-evidence-poll"),
  showNotice: (message) => showNotice(message, "error"),
  showToast,
  humanStatus,
  statusClass,
  formatBytes,
  parseTimestamp,
});

bindInterface();
void initialise();

async function initialise(): Promise<void> {
  try {
    const ssoStatus = new URLSearchParams(window.location.search).get("sso");
    const ssoCode = new URLSearchParams(window.location.search).get("code");
    let session = await api<
      | { authenticated: true; user: User; pendingInvitations?: PendingOrganisationInvitation[] }
      | { authenticated: false }
    >("/api/auth/session");
    if (!session.authenticated) {
      try {
        const restored = await restoreAuthenticationSession();
        if (restored) {
          session = await api<
            | { authenticated: true; user: User; pendingInvitations?: PendingOrganisationInvitation[] }
            | { authenticated: false }
          >("/api/auth/session");
        }
      } catch (error) {
        if (error instanceof ApiError && error.retryable) throw error;
        // A missing or expired refresh session is the expected anonymous path.
      }
    }
    if (!session.authenticated) {
      markAuthenticationSignedOut();
      authenticationStatus = "signed-out";
      renderIdentity();
      if (ssoStatus === "error") {
        byId("loginError").textContent = enterpriseLoginErrorMessage(ssoCode);
      }
      loginDialog.showModal();
      beginTurnstileInitialisation();
      clearSsoReturnParameters();
      return;
    }
    markAuthenticationEstablished();
    authenticationStatus = "authenticated";
    state.user = session.user;
    state.pendingInvitations = session.pendingInvitations ?? [];
    renderIdentity();
    renderPendingInvitations();
    await refreshAll();
    if (ssoStatus === "success") {
      showNotice("Enterprise sign-in verified.", "success");
      clearSsoReturnParameters();
    }
    void reconcileBillingCheckoutReturn();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      authenticationStatus = "signed-out";
      renderIdentity();
      loginDialog.showModal();
      beginTurnstileInitialisation();
      return;
    }
    authenticationStatus = "unavailable";
    renderIdentity();
    showNotice(errorMessage(error), "error");
    if (!loginDialog.open) loginDialog.showModal();
    beginTurnstileInitialisation();
  }
}

function bindInterface(): void {
  compareDomain.bind();
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, () => {
    transitionToSignedOut("Your session expired. Sign in again.");
  });
  window.addEventListener("spatial-action-start", clearNotice);
  window.addEventListener("spatial-action-error", (event) => {
    const message = event instanceof CustomEvent && typeof event.detail?.message === "string"
      ? event.detail.message
      : "The action could not be completed. Retry when the connection is stable.";
    showNotice(message, "error");
  });
  const loginForm = byId<HTMLFormElement>("loginForm");
  const newProjectForm = byId<HTMLFormElement>("newProjectForm");
  const savedViewForm = byId<HTMLFormElement>("savedViewForm");
  const projectTemplateForm = byId<HTMLFormElement>("projectTemplateForm");
  const projectFieldForm = byId<HTMLFormElement>("projectFieldForm");
  const editProjectForm = byId<HTMLFormElement>("editProjectForm");
  const uploadForm = byId<HTMLFormElement>("uploadForm");
  const qaForm = byId<HTMLFormElement>("qaForm");
  const releaseForm = byId<HTMLFormElement>("releaseForm");
  const reviewerForm = byId<HTMLFormElement>("reviewerForm");
  const deliveryForm = byId<HTMLFormElement>("deliveryForm");
  const domainForm = byId<HTMLFormElement>("domainForm");
  const entityForm = byId<HTMLFormElement>("entityForm");
  const navigationProfileForm = byId<HTMLFormElement>("navigationProfileForm");
  const navigationTraversalForm = byId<HTMLFormElement>("navigationTraversalForm");
  const navigationBuildForm = byId<HTMLFormElement>("navigationBuildForm");
  const semanticExtractionForm = byId<HTMLFormElement>("semanticExtractionForm");
  const semanticReviewForm = byId<HTMLFormElement>("semanticReviewForm");
  const floorplanExtractionForm = byId<HTMLFormElement>("floorplanExtractionForm");
  const floorplanReviewForm = byId<HTMLFormElement>("floorplanReviewForm");
  const routeForm = byId<HTMLFormElement>("routeForm");
  const privacyCandidateForm = byId<HTMLFormElement>("privacyCandidateForm");
  const measurementBriefForm = byId<HTMLFormElement>("measurementBriefForm");
  const checkPointForm = byId<HTMLFormElement>("checkPointForm");
  const geometryChangeForm = byId<HTMLFormElement>("geometryChangeForm");
  const geometryChangeReviewForm = byId<HTMLFormElement>("geometryChangeReviewForm");
  const rawSceneChangeForm = byId<HTMLFormElement>("rawSceneChangeForm");
  const rawSceneChangeReviewForm = byId<HTMLFormElement>("rawSceneChangeReviewForm");
  const captureCompletenessForm = byId<HTMLFormElement>("captureCompletenessForm");
  const captureCompletenessReviewForm = byId<HTMLFormElement>("captureCompletenessReviewForm");
  const captureBundleForm = byId<HTMLFormElement>("captureBundleForm");
  const captureBundleReviewForm = byId<HTMLFormElement>("captureBundleReviewForm");
  const versionComparisonForm = byId<HTMLFormElement>("versionComparisonForm");
  const teamInvitationForm = byId<HTMLFormElement>("teamInvitationForm");
  const identityProviderForm = byId<HTMLFormElement>("identityProviderForm");
  const captureAgentForm = byId<HTMLFormElement>("captureAgentForm");
  for (const form of [
    loginForm,
    newProjectForm,
    savedViewForm,
    projectTemplateForm,
    projectFieldForm,
    editProjectForm,
    uploadForm,
    qaForm,
    releaseForm,
    reviewerForm,
    deliveryForm,
    domainForm,
    entityForm,
    navigationProfileForm,
    navigationTraversalForm,
    navigationBuildForm,
    semanticExtractionForm,
    semanticReviewForm,
    routeForm,
    privacyCandidateForm,
    measurementBriefForm,
    checkPointForm,
    geometryChangeForm,
    geometryChangeReviewForm,
    rawSceneChangeForm,
    rawSceneChangeReviewForm,
    captureCompletenessForm,
    captureCompletenessReviewForm,
    captureBundleForm,
    captureBundleReviewForm,
    versionComparisonForm,
    teamInvitationForm,
    identityProviderForm,
    captureAgentForm,
  ]) {
    bindConstraintFeedback(form);
  }
  byId("newProjectButton").addEventListener("click", () => {
    projectOperationId = crypto.randomUUID();
    newProjectForm.reset();
    byId("projectError").textContent = "";
    byId<HTMLElement>("newProjectUploadProgress").style.width = "0%";
    byId("newProjectStatus").textContent = "Ready to upload.";
    byId<HTMLDetailsElement>("newProjectOptionalDetails").open = false;
    renderNewProjectMetadataFields();
    renderProjectTemplateOptions();
    void renderNewCaptureHelp();
    setNewCaptureIntakeStep(1, false);
    newProjectDialog.showModal();
  });
  byId("portfolioToolsButton").addEventListener("click", () => {
    resetProjectTemplateForm();
    resetProjectFieldForm();
    resetPortfolioImport();
    resetPortfolioHandoff();
    resetAssetHandoff();
    renderPortfolioTools();
    portfolioToolsDialog.showModal();
    void loadRecentAssetHandoff();
  });
  byId<HTMLSelectElement>("newCaptureAdapter").addEventListener("change", () => void renderNewCaptureHelp());
  byId<HTMLSelectElement>("newCaptureOrigin").addEventListener("change", () => void renderNewCaptureHelp());
  byId<HTMLSelectElement>("newProjectTemplate").addEventListener("change", applySelectedProjectTemplate);
  byId<HTMLInputElement>("newCaptureAsset").addEventListener("change", () => {
    inferNewCaptureAdapter();
    void renderNewCaptureHelp();
  });
  byId<HTMLInputElement>("newCaptureGeometry").addEventListener("change", () => {
    inferNewCaptureAdapter();
    void renderNewCaptureHelp();
  });
  byId<HTMLButtonElement>("newCaptureBack").addEventListener("click", () => {
    setNewCaptureIntakeStep(newCaptureIntakeStep === 3 ? 2 : 1);
  });
  byId<HTMLButtonElement>("newCaptureNext").addEventListener("click", advanceNewCaptureIntake);
  const projectSearch = byId<HTMLInputElement>("projectSearch");
  const projectAdapterFilter = byId<HTMLSelectElement>("projectAdapterFilter");
  const projectDeliveryFilter = byId<HTMLSelectElement>("projectDeliveryFilter");
  const projectSort = byId<HTMLSelectElement>("projectSort");
  projectSearch.addEventListener("input", () => {
    state.projectQuery = projectSearch.value.trim();
    markProjectViewDirty();
    renderProjects();
  });
  projectAdapterFilter.addEventListener("change", () => {
    state.projectAdapter = projectAdapterFilter.value;
    markProjectViewDirty();
    renderProjects();
  });
  projectDeliveryFilter.addEventListener("change", () => {
    state.projectDelivery = projectDeliveryFilter.value;
    markProjectViewDirty();
    renderProjects();
  });
  projectSort.addEventListener("change", () => {
    const value = projectSort.value;
    if (value === "updated_desc" || value === "updated_asc" || value === "name_asc" || value === "name_desc") {
      state.projectSort = value;
      markProjectViewDirty();
      renderProjects();
    }
  });
  byId<HTMLSelectElement>("savedProjectView").addEventListener("change", (event) => {
    const select = event.currentTarget;
    if (!(select instanceof HTMLSelectElement)) return;
    const view = state.projectViews.find((candidate) => candidate.id === select.value);
    if (view) applyProjectView(view);
    else {
      state.activeProjectViewId = null;
      renderProjectControls();
    }
  });
  byId("saveProjectViewButton").addEventListener("click", openSavedProjectViewDialog);
  const loadMoreProjectsButton = byId<HTMLButtonElement>("loadMoreProjects");
  loadMoreProjectsButton.addEventListener("click", () => {
    void runAction({
      key: "load-more-projects",
      trigger: loadMoreProjectsButton,
      pendingLabel: "Loading projects…",
    }, loadMoreProjects);
  });
  bindListContinuation("loadMoreProjectViews", "load-more-project-views", "Loading views…", loadMoreProjectViews);
  bindListContinuation("loadMoreProjectTemplates", "load-more-project-templates", "Loading templates…", loadMoreProjectTemplates);
  bindListContinuation("loadMoreJobs", "load-more-jobs", "Loading jobs…", loadMoreJobs);
  bindListContinuation("loadMoreReleases", "load-more-releases", "Loading releases…", loadMoreReleases);
  const deleteProjectViewButton = byId<HTMLButtonElement>("deleteProjectViewButton");
  deleteProjectViewButton.addEventListener("click", () => {
    const view = state.projectViews.find((candidate) => candidate.id === state.activeProjectViewId);
    if (!view || !confirm(`Delete the saved view “${view.name}”? Project data will not change.`)) return;
    void runAction({
      key: `delete-project-view:${view.id}`,
      trigger: deleteProjectViewButton,
      pendingLabel: "Deleting…",
      disable: [byId<HTMLButtonElement>("saveProjectViewButton")],
    }, () => deleteProjectView(view));
  });
  const savedViewSubmit = savedViewForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  savedViewForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(savedViewForm);
    void runAction({
      key: "save-project-view",
      trigger: savedViewSubmit,
      form: savedViewForm,
      pendingLabel: "Saving view…",
      errorTarget: byId("savedViewError"),
    }, () => saveProjectView(form));
  });
  const projectTemplateSubmit = projectTemplateForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  projectTemplateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(projectTemplateForm);
    void runAction({
      key: "save-project-template",
      trigger: projectTemplateSubmit,
      form: projectTemplateForm,
      pendingLabel: "Saving template…",
      errorTarget: byId("projectTemplateError"),
      disable: [byId<HTMLButtonElement>("cancelTemplateEdit")],
    }, () => saveProjectTemplate(form));
  });
  byId("cancelTemplateEdit").addEventListener("click", resetProjectTemplateForm);
  const projectFieldSubmit = projectFieldForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  projectFieldForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(projectFieldForm);
    void runAction({
      key: "save-project-field",
      trigger: projectFieldSubmit,
      form: projectFieldForm,
      pendingLabel: "Saving field…",
      errorTarget: byId("projectFieldError"),
      disable: [byId<HTMLButtonElement>("cancelProjectFieldEdit")],
    }, () => saveProjectField(form));
  });
  byId("cancelProjectFieldEdit").addEventListener("click", resetProjectFieldForm);
  const exportSelectedProjects = byId<HTMLButtonElement>("exportSelectedProjects");
  const exportAllProjects = byId<HTMLButtonElement>("exportAllProjects");
  exportSelectedProjects.addEventListener("click", () => {
    void runAction({
      key: "export-selected-projects",
      trigger: exportSelectedProjects,
      pendingLabel: "Exporting…",
      errorTarget: byId("portfolioExportError"),
      disable: [exportAllProjects],
    }, () => exportProjectPortfolio([...state.selectedProjectIds]));
  });
  exportAllProjects.addEventListener("click", () => {
    void runAction({
      key: "export-all-projects",
      trigger: exportAllProjects,
      pendingLabel: "Exporting…",
      errorTarget: byId("portfolioExportError"),
      disable: [exportSelectedProjects],
    }, () => exportProjectPortfolio(null));
  });
  const portfolioImportFile = byId<HTMLInputElement>("portfolioImportFile");
  portfolioImportFile.addEventListener("change", () => {
    resetPortfolioImport(false);
    byId<HTMLButtonElement>("previewPortfolioImport").disabled = !portfolioImportFile.files?.length;
    byId("portfolioImportPreview").textContent = portfolioImportFile.files?.[0]
      ? `${portfolioImportFile.files[0].name} selected. Validate it before any project is created.`
      : "Choose an exported portfolio file to begin.";
  });
  const previewPortfolioImport = byId<HTMLButtonElement>("previewPortfolioImport");
  const commitPortfolioImport = byId<HTMLButtonElement>("commitPortfolioImport");
  previewPortfolioImport.addEventListener("click", () => {
    void runAction({
      key: "preview-project-import",
      trigger: previewPortfolioImport,
      pendingLabel: "Validating…",
      errorTarget: byId("portfolioImportError"),
    }, previewProjectPortfolioImport).finally(renderPortfolioImportActions);
  });
  commitPortfolioImport.addEventListener("click", () => {
    if (!portfolioImportPreview || !portfolioImportManifest) return;
    if (!confirm(`Create ${portfolioImportPreview.summary.projects} new DRAFT project${portfolioImportPreview.summary.projects === 1 ? "" : "s"} from this validated file?`)) return;
    void runAction({
      key: "commit-project-import",
      trigger: commitPortfolioImport,
      pendingLabel: "Creating projects…",
      errorTarget: byId("portfolioImportError"),
      disable: [previewPortfolioImport, portfolioImportFile],
    }, commitProjectPortfolioImport).finally(renderPortfolioImportActions);
  });
  const portfolioHandoffTarget = byId<HTMLSelectElement>("portfolioHandoffTarget");
  portfolioHandoffTarget.addEventListener("change", () => {
    resetPortfolioHandoff(false);
    renderPortfolioHandoffActions();
  });
  const previewPortfolioHandoff = byId<HTMLButtonElement>("previewPortfolioHandoff");
  const commitPortfolioHandoffButton = byId<HTMLButtonElement>("commitPortfolioHandoff");
  previewPortfolioHandoff.addEventListener("click", () => {
    void runAction({
      key: "preview-portfolio-handoff",
      trigger: previewPortfolioHandoff,
      pendingLabel: "Checking destination…",
      errorTarget: byId("portfolioHandoffError"),
      disable: [portfolioHandoffTarget, commitPortfolioHandoffButton],
    }, previewProjectPortfolioHandoff).finally(renderPortfolioHandoffActions);
  });
  commitPortfolioHandoffButton.addEventListener("click", () => {
    if (!portfolioHandoffPreview?.valid) return;
    if (!confirm(
      `Create ${portfolioHandoffPreview.summary.projects} DRAFT project ${
        portfolioHandoffPreview.summary.projects === 1 ? "copy" : "copies"
      } in ${portfolioHandoffPreview.targetOrganisation.name}? No versions or assets will move.`,
    )) return;
    void runAction({
      key: "commit-portfolio-handoff",
      trigger: commitPortfolioHandoffButton,
      pendingLabel: "Creating DRAFT copies…",
      errorTarget: byId("portfolioHandoffError"),
      disable: [portfolioHandoffTarget, previewPortfolioHandoff],
    }, commitProjectPortfolioHandoff).finally(renderPortfolioHandoffActions);
  });
  const assetHandoffTarget = byId<HTMLSelectElement>("assetHandoffTarget");
  const previewAssetHandoff = byId<HTMLButtonElement>("previewAssetHandoff");
  const commitAssetHandoff = byId<HTMLButtonElement>("commitAssetHandoff");
  const refreshAssetHandoff = byId<HTMLButtonElement>("refreshAssetHandoff");
  const retryAssetHandoff = byId<HTMLButtonElement>("retryAssetHandoff");
  const cancelAssetHandoff = byId<HTMLButtonElement>("cancelAssetHandoff");
  const assetHandoffControls = [
    assetHandoffTarget,
    previewAssetHandoff,
    commitAssetHandoff,
    refreshAssetHandoff,
    retryAssetHandoff,
    cancelAssetHandoff,
  ];
  assetHandoffTarget.addEventListener("change", () => {
    resetAssetHandoff(false);
    renderAssetHandoffActions();
  });
  previewAssetHandoff.addEventListener("click", () => {
    void runAction({
      key: "preview-asset-handoff",
      trigger: previewAssetHandoff,
      pendingLabel: "Checking immutable assets…",
      errorTarget: byId("assetHandoffError"),
      disable: assetHandoffControls,
    }, previewProjectAssetHandoff).finally(renderAssetHandoffActions);
  });
  commitAssetHandoff.addEventListener("click", () => {
    if (!assetHandoffPreview?.valid) return;
    if (!confirm(
      `Copy ${assetHandoffPreview.summary.assets} verified asset${
        assetHandoffPreview.summary.assets === 1 ? "" : "s"
      } (${formatBytes(assetHandoffPreview.summary.bytes)}) into ${
        assetHandoffPreview.targetOrganisation.name
      }? The source remains unchanged and the destination must repeat QA.`,
    )) return;
    void runAction({
      key: "commit-asset-handoff",
      trigger: commitAssetHandoff,
      pendingLabel: "Starting verified copy…",
      errorTarget: byId("assetHandoffError"),
      disable: assetHandoffControls,
    }, commitProjectAssetHandoff).finally(renderAssetHandoffActions);
  });
  refreshAssetHandoff.addEventListener("click", () => {
    void runAction({
      key: "refresh-asset-handoff",
      trigger: refreshAssetHandoff,
      pendingLabel: "Refreshing progress…",
      errorTarget: byId("assetHandoffError"),
      disable: assetHandoffControls,
    }, () => refreshProjectAssetHandoff(false)).finally(renderAssetHandoffActions);
  });
  retryAssetHandoff.addEventListener("click", () => {
    void runAction({
      key: "retry-asset-handoff",
      trigger: retryAssetHandoff,
      pendingLabel: "Requeueing failed items…",
      errorTarget: byId("assetHandoffError"),
      disable: assetHandoffControls,
    }, retryProjectAssetHandoff).finally(renderAssetHandoffActions);
  });
  cancelAssetHandoff.addEventListener("click", () => {
    if (!activeAssetHandoff || !confirm(
      "Cancel this copy and remove all destination objects written by it? The source project is unaffected.",
    )) return;
    void runAction({
      key: "cancel-asset-handoff",
      trigger: cancelAssetHandoff,
      pendingLabel: "Cancelling and cleaning up…",
      errorTarget: byId("assetHandoffError"),
      disable: assetHandoffControls,
    }, cancelProjectAssetHandoff).finally(renderAssetHandoffActions);
  });
  byId("inviteTeamButton").addEventListener("click", () => {
    openTeamInvitation();
  });
  byId("addIdentityProviderButton").addEventListener("click", openIdentityProviderDialog);
  byId("createCaptureAgentButton").addEventListener("click", () => {
    openCaptureAgentDialog("create");
  });
  const captureAgentSubmit = byId<HTMLButtonElement>("captureAgentSubmit");
  captureAgentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(captureAgentForm);
    const mode = String(form.get("mode") ?? "create");
    const pendingLabel = mode === "rotate"
      ? "Rotating token…"
      : mode === "edit"
        ? "Saving scope…"
        : "Creating token…";
    void runAction({
      key: `capture-agent-${mode}`,
      trigger: captureAgentSubmit,
      form: captureAgentForm,
      pendingLabel,
      errorTarget: byId("captureAgentError"),
    }, () => saveCaptureAgent(form));
  });
  const copyCaptureAgentToken = byId<HTMLButtonElement>("copyCaptureAgentToken");
  copyCaptureAgentToken.addEventListener("click", () => {
    void runAction({
      key: "copy-capture-agent-token",
      trigger: copyCaptureAgentToken,
      pendingLabel: "Copying…",
      errorTarget: byId("captureAgentTokenError"),
    }, copyIssuedCaptureAgentToken);
  });
  captureAgentTokenDialog.addEventListener("close", () => {
    byId<HTMLTextAreaElement>("captureAgentTokenValue").value = "";
    byId("captureAgentTokenError").textContent = "";
  });
  const refreshButton = byId<HTMLButtonElement>("refreshButton");
  refreshButton.addEventListener("click", () => {
    void runAction({
      key: "workspace-refresh",
      trigger: refreshButton,
      pendingLabel: "Refreshing…",
    }, refreshAll);
  });
  const clearProjectSelection = byId<HTMLButtonElement>("clearProjectSelection");
  const bulkArchiveProjects = byId<HTMLButtonElement>("bulkArchiveProjects");
  const bulkRestoreProjects = byId<HTMLButtonElement>("bulkRestoreProjects");
  clearProjectSelection.addEventListener("click", () => {
    state.selectedProjectIds.clear();
    bulkLifecycleOperation = null;
    renderProjects();
  });
  bulkArchiveProjects.addEventListener("click", () => {
    const count = selectedProjectsForAction("archive").length;
    if (!count || !confirm(`Archive ${count} selected project${count === 1 ? "" : "s"}? Projects with active releases, jobs, or uploads will remain selected for recovery.`)) return;
    void runAction({
      key: "bulk-project-archive",
      trigger: bulkArchiveProjects,
      pendingLabel: "Archiving…",
      disable: [bulkRestoreProjects, clearProjectSelection],
    }, () => bulkChangeProjectLifecycle("archive")).finally(renderBulkProjectActions);
  });
  bulkRestoreProjects.addEventListener("click", () => {
    const count = selectedProjectsForAction("restore").length;
    if (!count || !confirm(`Restore ${count} selected archived project${count === 1 ? "" : "s"} to its previous lifecycle state?`)) return;
    void runAction({
      key: "bulk-project-restore",
      trigger: bulkRestoreProjects,
      pendingLabel: "Restoring…",
      disable: [bulkArchiveProjects, clearProjectSelection],
    }, () => bulkChangeProjectLifecycle("restore")).finally(renderBulkProjectActions);
  });
  const signOutButton = byId<HTMLButtonElement>("signOutButton");
  signOutButton.addEventListener("click", () => {
    void runAction({
      key: "sign-out",
      trigger: signOutButton,
      pendingLabel: "Signing out…",
    }, signOut);
  });
  const organisationSelect = byId<HTMLSelectElement>("organisationSelect");
  const switchOrganisationButton = byId<HTMLButtonElement>("switchOrganisationButton");
  organisationSelect.addEventListener("change", renderOrganisationSwitcher);
  switchOrganisationButton.addEventListener("click", () => {
    void runAction({
      key: "switch-organisation",
      trigger: switchOrganisationButton,
      pendingLabel: "Switching…",
      errorTarget: byId("organisationSwitchError"),
      disable: [
        organisationSelect,
        refreshButton,
        byId<HTMLButtonElement>("newProjectButton"),
        byId<HTMLButtonElement>("portfolioToolsButton"),
        ...Array.from(document.querySelectorAll<HTMLButtonElement>(".nav-item")),
      ],
    }, switchOrganisation).finally(renderOrganisationSwitcher);
  });
  const loginSubmit = byId<HTMLButtonElement>("loginSubmit");
  const enterpriseLoginButton = byId<HTMLButtonElement>("enterpriseLoginButton");
  const loginEmail = byId<HTMLInputElement>("loginEmail");
  loginEmail.addEventListener("input", () => {
    updateEnterpriseLoginAvailability();
    updateEmailOtpAvailability();
  });
  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(loginForm);
    void runAction({
      key: "auth-submit",
      trigger: loginSubmit,
      form: loginForm,
      pendingLabel: authChallengeId ? "Signing in…" : "Sending code…",
      idleLabel: () => authChallengeId ? "Verify and sign in" : "Email me a code",
      errorTarget: byId("loginError"),
    }, () => handleSignIn(form)).finally(() => {
      updateOtpCooldown();
      updateEmailOtpAvailability();
    });
  });
  byId("changeLoginEmail").addEventListener("click", resetLogin);
  byId("retryTurnstile").addEventListener("click", retryTurnstile);
  enterpriseLoginButton.addEventListener("click", () => {
    void runAction({
      key: "enterprise-auth-discovery",
      trigger: enterpriseLoginButton,
      pendingLabel: "Finding your provider…",
      errorTarget: byId("loginError"),
      disable: [loginSubmit, loginEmail],
    }, discoverEnterpriseLogin).finally(updateEnterpriseLoginAvailability);
  });
  updateEnterpriseLoginAvailability();
  byId("qaOpenPrivacyWorkspace").addEventListener("click", () => {
    qaDialog.close();
    activateProjectSection("privacy", true, "push", true);
  });
  const resendButton = byId<HTMLButtonElement>("resendLoginCode");
  resendButton.addEventListener("click", () => {
    const email = byId<HTMLInputElement>("loginEmail").value.trim().toLowerCase();
    void runAction({
      key: "auth-submit",
      trigger: resendButton,
      pendingLabel: "Sending another code…",
      errorTarget: byId("loginError"),
      disable: [loginSubmit, byId<HTMLButtonElement>("changeLoginEmail")],
    }, () => requestSignInCode(email)).finally(() => {
      updateOtpCooldown();
      updateEmailOtpAvailability();
    });
  });
  const newProjectSubmit = newProjectForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  newProjectForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (newCaptureIntakeStep !== 3) {
      advanceNewCaptureIntake();
      return;
    }
    const form = new FormData(newProjectForm);
    void runAction({
      key: "create-project",
      trigger: newProjectSubmit,
      form: newProjectForm,
      pendingLabel: "Uploading capture…",
      errorTarget: byId("projectError"),
    }, () => createCapture(form));
  });
  const editProjectSubmit = editProjectForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  editProjectForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(editProjectForm);
    void runAction({
      key: "update-project",
      trigger: editProjectSubmit,
      form: editProjectForm,
      pendingLabel: "Saving settings…",
      errorTarget: byId("editProjectError"),
    }, () => updateProject(form));
  });
  const uploadSubmit = uploadForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  const pauseUploadButton = byId<HTMLButtonElement>("pauseUploadButton");
  const uploadPurpose = byId<HTMLSelectElement>("uploadPurpose");
  const uploadFormat = byId<HTMLSelectElement>("uploadFormat");
  const uploadAssetInput = byId<HTMLInputElement>("uploadAssetInput");
  // The picker must offer every format the dialog's purposes accept, or the
  // operator cannot even select the evidence the platform asks for: a
  // Gaussian-only filter hid metric point clouds, scanner trajectories, E57,
  // video, and imagery behind a file dialog that refused to show them.
  // Derived from the shared vocabulary so it cannot drift from the purposes.
  uploadAssetInput.accept = captureAssetFormats
    .flatMap((format) => captureFileExtensionsForFormat(format))
    .map((extension) => `.${extension}`)
    .join(",");
  uploadPurpose.addEventListener("change", () => {
    syncUploadPurpose(uploadPurpose.value as CaptureAssetPurpose);
  });
  uploadFormat.addEventListener("change", syncUploadPosterCameraRequirement);
  uploadAssetInput.addEventListener("change", () => {
    const file = uploadAssetInput.files?.[0];
    if (!file) return;
    // The filename already states what most uploads are; restating it in two
    // dropdowns buried under a disclosure is work the operator should not do.
    // Detection fills both and reports what it chose — ambiguous names simply
    // leave the pickers alone.
    const inferredPurpose = inferCaptureAssetPurpose(file.name);
    if (inferredPurpose) {
      uploadPurpose.value = inferredPurpose;
      syncUploadPurpose(inferredPurpose);
    }
    const format = byId<HTMLSelectElement>("uploadFormat");
    const detectedFormat = captureFormatForFileName(
      file.name,
      captureFormatsForPurpose(uploadPurpose.value as CaptureAssetPurpose),
    );
    if (detectedFormat) {
      format.value = detectedFormat;
      syncUploadPosterCameraRequirement();
    }
    const purposeLabel = uploadPurpose.selectedOptions[0]?.textContent ?? uploadPurpose.value;
    byId("uploadDetectionNote").textContent = inferredPurpose
      ? `Detected ${purposeLabel}${detectedFormat ? ` · ${detectedFormat.toUpperCase()}` : ""} from the file name. Change it under Advanced ingest options if that is wrong.`
      : `Choose the asset purpose under Advanced ingest options — ${file.name.split(".").at(-1)?.toUpperCase() ?? "this format"} is used by more than one kind of evidence.`;
  });
  pauseUploadButton.addEventListener("click", () => {
    if (!uploadAbortController) return;
    pauseUploadButton.disabled = true;
    pauseUploadButton.textContent = "Pausing…";
    byId("uploadStatus").textContent = "Pausing after the active request…";
    uploadAbortController.abort();
  });
  uploadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(uploadForm);
    void runAction({
      key: "upload-asset",
      trigger: uploadSubmit,
      form: uploadForm,
      pendingLabel: "Uploading…",
      idleLabel: () => activeUpload ? "Retry upload" : "Start resumable upload",
      errorTarget: byId("uploadError"),
      keepEnabled: [pauseUploadButton],
    }, () => uploadAsset(form));
  });
  const qaSubmit = qaForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  qaForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(qaForm);
    void runAction({
      key: "approve-version",
      trigger: qaSubmit,
      form: qaForm,
      pendingLabel: "Approving version…",
      errorTarget: byId("qaError"),
    }, () => approveVersion(form));
  });
  const releaseSubmit = releaseForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  releaseForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(releaseForm);
    void runAction({
      key: "publish-release",
      trigger: releaseSubmit,
      form: releaseForm,
      pendingLabel: "Publishing release…",
      errorTarget: byId("releaseError"),
    }, () => publishRelease(form));
  });
  const qualityPreset = releaseForm.elements.namedItem("qualityPreset");
  if (qualityPreset instanceof HTMLSelectElement) {
    qualityPreset.addEventListener("change", () => syncReleaseQualityPreset(releaseForm));
  }
  byId<HTMLButtonElement>("releaseUseCurrentView").addEventListener(
    "click",
    applyReleaseCurrentView,
  );
  const releaseEvidence = releaseForm.elements.namedItem("sourceToWorldEvidenceId");
  if (releaseEvidence instanceof HTMLSelectElement) {
    releaseEvidence.addEventListener("change", () => {
      if (releaseEvidence.value) {
        if (applyReleaseTransform instanceof HTMLInputElement) {
          applyReleaseTransform.checked = true;
          for (const input of releaseSceneRotationInputs(releaseForm)) input.value = "0";
        }
        applyReviewedTransformToReleaseForm(releaseEvidence.value);
      } else {
        setProvisionalReleaseDisclaimer(releaseForm, false);
      }
      syncReleaseTransformModes(releaseForm);
    });
  }
  const applyReleaseTransform = releaseForm.elements.namedItem("applySourceToWorld");
  if (applyReleaseTransform instanceof HTMLInputElement) {
    applyReleaseTransform.addEventListener("change", () => {
      if (applyReleaseTransform.checked) {
        for (const input of releaseSceneRotationInputs(releaseForm)) input.value = "0";
      }
      if (!applyReleaseTransform.checked) {
        setProvisionalReleaseDisclaimer(releaseForm, false);
      } else if (releaseEvidence instanceof HTMLSelectElement && releaseEvidence.value) {
        applyReviewedTransformToReleaseForm(releaseEvidence.value);
      }
      syncReleaseTransformModes(releaseForm);
    });
  }
  for (const input of releaseSceneRotationInputs(releaseForm)) {
    input.min = String(SCENE_ROTATION_MIN_DEGREES);
    input.max = String(SCENE_ROTATION_MAX_DEGREES);
    input.addEventListener("input", () => {
      if (hasEnteredSceneRotation(releaseForm) && applyReleaseTransform instanceof HTMLInputElement) {
        applyReleaseTransform.checked = false;
        if (releaseEvidence instanceof HTMLSelectElement) releaseEvidence.value = "";
        setProvisionalReleaseDisclaimer(releaseForm, false);
      }
      syncReleaseTransformModes(releaseForm);
    });
  }
  const reviewerSubmit = reviewerForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  reviewerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(reviewerForm);
    void runAction({
      key: "invite-reviewer",
      trigger: reviewerSubmit,
      form: reviewerForm,
      pendingLabel: "Sending invitation…",
      errorTarget: byId("reviewerError"),
    }, () => inviteReviewer(form));
  });
  const deliverySubmit = deliveryForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  deliveryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(deliveryForm);
    void runAction({
      key: "save-delivery-settings",
      trigger: deliverySubmit,
      form: deliveryForm,
      pendingLabel: "Saving settings…",
      errorTarget: byId("deliveryError"),
    }, () => saveDeliverySettings(form));
  });
  const checkoutButton = byId<HTMLButtonElement>("startHostingCheckout");
  const hostingPlan = deliveryForm.elements.namedItem("planCode");
  if (hostingPlan instanceof HTMLSelectElement) {
    hostingPlan.addEventListener("change", updateDeliveryBillingState);
  }
  checkoutButton.addEventListener("click", () => {
    deliveryDialog.close();
    activateView("hosting");
    byId("hostingWorkspace").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const domainSubmit = domainForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  domainForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(domainForm);
    void runAction({
      key: "create-custom-domain",
      trigger: domainSubmit,
      form: domainForm,
      pendingLabel: "Creating record…",
      errorTarget: byId("domainError"),
    }, () => createCustomDomain(form));
  });
  const entitySubmit = entityForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  entityForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(entityForm);
    void runAction({
      key: "create-spatial-entity",
      trigger: entitySubmit,
      form: entityForm,
      pendingLabel: "Adding entity…",
      errorTarget: byId("entityError"),
    }, () => createSpatialEntity(form));
  });
  const navigationProfileSubmit =
    navigationProfileForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  const navigationClearancePreset = navigationProfileForm.elements.namedItem("clearancePreset");
  if (navigationClearancePreset instanceof HTMLSelectElement) {
    navigationClearancePreset.addEventListener("change", () => {
      syncNavigationClearancePreset(navigationProfileForm, true);
    });
  }
  navigationProfileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(navigationProfileForm);
    void runAction({
      key: "update-navigation-profile",
      trigger: navigationProfileSubmit,
      form: navigationProfileForm,
      pendingLabel: "Saving profile…",
      errorTarget: byId("navigationProfileError"),
    }, () => updateNavigationProfile(form));
  });
  const navigationBuildSubmit =
    navigationBuildForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  for (const input of navigationBuildForm.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    "input[name='bounds'], input[name='spawn'], select[name='collisionAssetId']",
  )) {
    input.addEventListener("input", syncNavigationBuildReadiness);
    input.addEventListener("change", syncNavigationBuildReadiness);
  }
  navigationBuildForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(navigationBuildForm);
    void runAction({
      key: "queue-navigation-build",
      trigger: navigationBuildSubmit,
      form: navigationBuildForm,
      pendingLabel: "Queueing verified build…",
      errorTarget: byId("navigationBuildError"),
    }, () => queueNavigationBuild(form));
  });
  const navigationTraversalSubmit =
    navigationTraversalForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  navigationTraversalForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(navigationTraversalForm);
    void runAction({
      key: "create-navigation-traversal",
      trigger: navigationTraversalSubmit,
      form: navigationTraversalForm,
      pendingLabel: "Authoring traversal…",
      errorTarget: byId("navigationTraversalError"),
    }, () => createNavigationTraversal(form));
  });
  const semanticExtractionSubmit =
    semanticExtractionForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  semanticExtractionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(semanticExtractionForm);
    void runAction({
      key: "queue-semantic-extraction",
      trigger: semanticExtractionSubmit,
      form: semanticExtractionForm,
      pendingLabel: "Queueing extraction…",
      errorTarget: byId("semanticExtractionError"),
    }, () => queueSemanticExtraction(form));
  });
  const semanticReviewSubmit =
    semanticReviewForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  semanticReviewForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(semanticReviewForm);
    const extractionId = String(form.get("extractionId") ?? "");
    void runAction({
      key: `review-semantic-extraction:${extractionId}`,
      trigger: semanticReviewSubmit,
      form: semanticReviewForm,
      pendingLabel: "Recording review…",
      errorTarget: byId("semanticReviewError"),
    }, () => reviewSemanticExtraction(form));
  });
  const semanticReviewDecision =
    semanticReviewForm.elements.namedItem("decision");
  if (semanticReviewDecision instanceof HTMLSelectElement) {
    semanticReviewDecision.addEventListener("change", updateSemanticReviewChoiceState);
  }
  const floorplanExtractionSubmit =
    floorplanExtractionForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  floorplanExtractionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(floorplanExtractionForm);
    void runAction({
      key: "queue-floorplan-extraction",
      trigger: floorplanExtractionSubmit,
      form: floorplanExtractionForm,
      pendingLabel: "Queueing floor-plan extraction…",
      errorTarget: byId("floorplanExtractionError"),
    }, () => queueFloorplanExtraction(form));
  });
  const floorplanReviewSubmit =
    floorplanReviewForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  floorplanReviewForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(floorplanReviewForm);
    const extractionId = String(form.get("extractionId") ?? "");
    const decision = String(form.get("decision") ?? "approve");
    void runAction({
      key: `review-floorplan-extraction:${extractionId}`,
      trigger: floorplanReviewSubmit,
      form: floorplanReviewForm,
      pendingLabel: decision === "reject"
        ? "Recording rejection…"
        : "Saving approved revision…",
      errorTarget: byId("floorplanReviewError"),
    }, () => reviewFloorplanExtraction(form));
  });
  const floorplanReviewDecision = floorplanReviewForm.elements.namedItem("decision");
  if (floorplanReviewDecision instanceof HTMLSelectElement) {
    floorplanReviewDecision.addEventListener("change", updateFloorplanReviewState);
  }
  byId<HTMLTextAreaElement>("floorplanPlanEditor").addEventListener(
    "input",
    updateFloorplanReviewPreview,
  );
  const routeSubmit = routeForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  routeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(routeForm);
    void runAction({
      key: "create-spatial-route",
      trigger: routeSubmit,
      form: routeForm,
      pendingLabel: "Creating route…",
      errorTarget: byId("routeError"),
    }, () => createSpatialRoute(form));
  });
  const privacyCandidateSubmit = privacyCandidateForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  const privacyCandidateStatus = privacyCandidateForm.elements.namedItem("status");
  const privacyCandidateNote = privacyCandidateForm.elements.namedItem("note");
  if (privacyCandidateStatus instanceof HTMLSelectElement && privacyCandidateNote instanceof HTMLTextAreaElement) {
    privacyCandidateStatus.addEventListener("change", () => {
      const resolved = privacyCandidateStatus.value === "resolved";
      privacyCandidateNote.minLength = resolved ? 10 : 2;
      privacyCandidateNote.placeholder = resolved
        ? "Describe the applied redaction or other evidence that resolves this issue."
        : "What did you verify?";
    });
  }
  privacyCandidateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(privacyCandidateForm);
    const candidateId = String(form.get("candidateId") ?? "");
    void runAction({
      key: `privacy-candidate-decision:${candidateId}`,
      trigger: privacyCandidateSubmit,
      form: privacyCandidateForm,
      pendingLabel: "Recording decision…",
      errorTarget: byId("privacyCandidateError"),
    }, () => recordPrivacyCandidateDecision(form));
  });
  const briefSubmit = measurementBriefForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  measurementBriefForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(measurementBriefForm);
    void runAction({
      key: "create-measurement-brief",
      trigger: briefSubmit,
      form: measurementBriefForm,
      pendingLabel: "Creating brief…",
      errorTarget: byId("measurementBriefError"),
    }, () => createMeasurementBrief(form));
  });
  const checkPointSubmit = checkPointForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  checkPointForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(checkPointForm);
    void runAction({
      key: "create-check-point",
      trigger: checkPointSubmit,
      form: checkPointForm,
      pendingLabel: "Recording point…",
      errorTarget: byId("checkPointError"),
    }, () => createCheckPoint(form));
  });
  const captureCompletenessSubmit = captureCompletenessForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  captureCompletenessForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(captureCompletenessForm);
    void runAction({
      key: "capture-completeness",
      trigger: captureCompletenessSubmit,
      form: captureCompletenessForm,
      pendingLabel: "Analyzing trajectory…",
      errorTarget: byId("captureCompletenessError"),
    }, () => createCaptureCompletenessReport(form));
  });
  const captureCompletenessReviewSubmit =
    captureCompletenessReviewForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  captureCompletenessReviewForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(captureCompletenessReviewForm);
    const reportId = String(form.get("reportId") ?? "");
    void runAction({
      key: `capture-completeness-review:${reportId}`,
      trigger: captureCompletenessReviewSubmit,
      form: captureCompletenessReviewForm,
      pendingLabel: "Recording review…",
      errorTarget: byId("captureCompletenessReviewError"),
    }, () => reviewCaptureCompletenessReport(form));
  });
  const captureBundleSubmit = captureBundleForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  captureBundleForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(captureBundleForm);
    void runAction({
      key: "register-capture-bundle",
      trigger: captureBundleSubmit,
      form: captureBundleForm,
      pendingLabel: "Registering bundle…",
      errorTarget: byId("captureBundleError"),
    }, () => registerCaptureBundle(form));
  });
  const captureBundleVersion = byId<HTMLSelectElement>("captureBundleVersion");
  captureBundleVersion.addEventListener("change", () => {
    applyCaptureBundleVersionDefaults(captureBundleVersion.value);
    renderCaptureBundleAssets(captureBundleVersion.value);
    renderCaptureBundlePreview();
  });
  byId("captureBundleAssets").addEventListener("change", renderCaptureBundlePreview);
  byId<HTMLInputElement>("captureAttachSceneRegistration").addEventListener("change", (event) => {
    setCaptureSceneRegistrationEnabled((event.currentTarget as HTMLInputElement).checked);
    renderCaptureBundlePreview();
  });
  const captureBundleReviewSubmit =
    captureBundleReviewForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  captureBundleReviewForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(captureBundleReviewForm);
    const manifestId = String(form.get("manifestId") ?? "");
    void runAction({
      key: `review-capture-bundle:${manifestId}`,
      trigger: captureBundleReviewSubmit,
      form: captureBundleReviewForm,
      pendingLabel: "Recording review…",
      errorTarget: byId("captureBundleReviewError"),
    }, () => reviewCaptureBundle(form));
  });
  const teamInvitationSubmit = teamInvitationForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  teamInvitationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(teamInvitationForm);
    void runAction({
      key: "invite-team-member",
      trigger: teamInvitationSubmit,
      form: teamInvitationForm,
      pendingLabel: "Sending invitation…",
      errorTarget: byId("teamInvitationError"),
    }, () => inviteTeamMember(form));
  });
  const identityProviderSubmit = identityProviderForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  identityProviderForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(identityProviderForm);
    void runAction({
      key: "identity-provider-create",
      trigger: identityProviderSubmit,
      form: identityProviderForm,
      pendingLabel: "Creating draft…",
      errorTarget: byId("identityProviderError"),
    }, () => createIdentityProvider(form));
  });
  window.addEventListener("message", handleSceneAuthoringRendererMessage);
  window.addEventListener("message", handleReleaseCameraRendererMessage);
  window.addEventListener("message", handleWalkTestRendererMessage);
  document.querySelectorAll<HTMLElement>("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });
  document.querySelectorAll<HTMLButtonElement>(".filter-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.filter ?? "all";
      state.projectStatuses = filter === "all" ? [] : [filter];
      markProjectViewDirty();
      renderProjects();
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.dataset.section;
      if (section === "projects" || section === "jobs" || section === "releases" || section === "reviews" || section === "hosting" || section === "team") {
        activateView(section, true, "push");
      }
    });
  });
  byId<HTMLButtonElement>("backToProjects").addEventListener("click", () => activateView("projects", true, "push"));
  const projectSectionButtons: Array<[HTMLButtonElement, ProjectSection]> = [
    [byId<HTMLButtonElement>("projectOverviewTab"), "overview"],
    [byId<HTMLButtonElement>("projectStructureTab"), "structure"],
    [byId<HTMLButtonElement>("projectPrivacyTab"), "privacy"],
    [byId<HTMLButtonElement>("projectCompareTab"), "compare"],
    [byId<HTMLButtonElement>("projectWalkTab"), "walk"],
    [byId<HTMLButtonElement>("projectPublishTab"), "publish"],
    [byId<HTMLButtonElement>("projectMeasurementTab"), "measurement"],
    [byId<HTMLButtonElement>("projectExpertTab"), "expert"],
  ];
  projectSectionButtons.forEach(([button, section]) => {
    button.addEventListener("click", () => {
      activateProjectSection(section, true, "push", true);
    });
  });
  window.addEventListener("hashchange", () => void navigateFromHash());
  window.addEventListener("popstate", () => void navigateFromHash());
  activateView(viewFromHash(), false);
}

function bindConstraintFeedback(form: HTMLFormElement): void {
  const errorTarget = form.querySelector<HTMLElement>(".form-error");
  if (!errorTarget) return;
  form.addEventListener("invalid", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
    errorTarget.textContent = field.validationMessage || "Review the highlighted field and try again.";
  }, true);
  form.addEventListener("input", (event) => {
    const field = event.target;
    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLSelectElement ||
      field instanceof HTMLTextAreaElement
    ) {
      if (field.validity.valid) errorTarget.textContent = "";
    }
  });
}

async function handleSignIn(form: FormData): Promise<void> {
  byId("loginError").textContent = "";
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!authChallengeId) {
    await requestSignInCode(email);
    return;
  }
  const result = await api<{
    user: User;
    pendingInvitations?: PendingOrganisationInvitation[];
  }>("/api/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({
      email,
      challengeId: authChallengeId,
      code: String(form.get("code") ?? ""),
    }),
  });
  markAuthenticationEstablished();
  authenticationStatus = "authenticated";
  state.user = result.user;
  state.pendingInvitations = result.pendingInvitations ?? [];
  loginDialog.close();
  resetLogin();
  renderIdentity();
  renderPendingInvitations();
  await refreshAll();
}

async function requestSignInCode(email: string): Promise<void> {
  const token = turnstileToken;
  if (!token) {
    throw new Error("Complete the security check before requesting an email code.");
  }
  let requestAccepted = false;
  turnstileToken = null;
  updateTurnstileState("loading", "Verifying this security check…");
  updateEmailOtpAvailability();
  const challenge = await api<{
    challengeId: string;
    expiresInSeconds: number;
    retryAfterSeconds: number;
    message: string;
  }>("/api/auth/otp/request", {
    method: "POST",
    body: JSON.stringify({ email, turnstileToken: token }),
  }).then((result) => {
    requestAccepted = true;
    return result;
  }).finally(() => resetTurnstile(
    requestAccepted
      ? "Complete a fresh security check before resending."
      : "Complete the security check to request a code.",
  ));
  authChallengeId = challenge.challengeId;
  byId<HTMLInputElement>("loginEmail").readOnly = true;
  byId("otpField").classList.add("active");
  byId<HTMLInputElement>("loginCode").required = true;
  byId<HTMLButtonElement>("changeLoginEmail").hidden = false;
  byId<HTMLButtonElement>("resendLoginCode").hidden = false;
  byId("enterpriseLoginRegion").hidden = true;
  byId("loginInstructions").textContent = `A code was sent if ${email} is authorised. It expires in ${Math.ceil(challenge.expiresInSeconds / 60)} minutes.`;
  startOtpCooldown(challenge.retryAfterSeconds);
  byId<HTMLInputElement>("loginCode").focus();
}

function resetLogin(): void {
  authChallengeId = null;
  otpResendAvailableAt = 0;
  if (otpCooldownTimer !== null) window.clearInterval(otpCooldownTimer);
  otpCooldownTimer = null;
  const form = byId<HTMLFormElement>("loginForm");
  form.reset();
  byId<HTMLInputElement>("loginEmail").readOnly = false;
  byId("otpField").classList.remove("active");
  byId<HTMLInputElement>("loginCode").required = false;
  byId("changeLoginEmail").hidden = true;
  byId("resendLoginCode").hidden = true;
  byId("enterpriseLoginRegion").hidden = false;
  byId("enterpriseProviderChoices").replaceChildren();
  byId("loginSubmit").textContent = "Email me a code";
  byId("loginInstructions").innerHTML = "Enter your authorised email. We will send a one-time code from <strong>login@whymelabs.com</strong>.";
  byId("loginError").textContent = "";
  resetTurnstile("Complete the security check to request a code.");
  updateEnterpriseLoginAvailability();
  updateEmailOtpAvailability();
}

function startOtpCooldown(seconds: number): void {
  otpResendAvailableAt = Date.now() + Math.max(1, seconds) * 1_000;
  if (otpCooldownTimer !== null) window.clearInterval(otpCooldownTimer);
  updateOtpCooldown();
  otpCooldownTimer = window.setInterval(updateOtpCooldown, 1_000);
}

function updateOtpCooldown(): void {
  const resend = byId<HTMLButtonElement>("resendLoginCode");
  if (!authChallengeId) {
    resend.hidden = true;
    return;
  }
  const remaining = Math.max(0, Math.ceil((otpResendAvailableAt - Date.now()) / 1_000));
  const pending = isActionPending("auth-submit");
  resend.hidden = false;
  resend.disabled = pending || remaining > 0 || !turnstileToken;
  resend.textContent = pending
    ? "Sending another code…"
    : remaining > 0
      ? `Resend code in ${remaining}s`
      : !turnstileToken
        ? "Complete security check to resend"
      : "Resend code";
  if (remaining === 0 && otpCooldownTimer !== null) {
    window.clearInterval(otpCooldownTimer);
    otpCooldownTimer = null;
  }
}

function updateEnterpriseLoginAvailability(): void {
  const email = byId<HTMLInputElement>("loginEmail");
  const button = byId<HTMLButtonElement>("enterpriseLoginButton");
  const pending = isActionPending("enterprise-auth-discovery");
  button.disabled = pending || Boolean(authChallengeId) || !email.validity.valid || !email.value.trim();
}

function updateEmailOtpAvailability(): void {
  const button = byId<HTMLButtonElement>("loginSubmit");
  const email = byId<HTMLInputElement>("loginEmail");
  const pending = isActionPending("auth-submit");
  button.disabled = pending ||
    !email.validity.valid ||
    !email.value.trim() ||
    (!authChallengeId && !turnstileToken);
}

function beginTurnstileInitialisation(): void {
  void initialiseTurnstile().catch((error) => {
    turnstileInitialisePromise = null;
    updateTurnstileState(
      "error",
      error instanceof Error
        ? `${error.message} Retry the security check.`
        : "The security check could not load. Retry when the connection is stable.",
      true,
    );
  });
}

function initialiseTurnstile(): Promise<void> {
  if (turnstileInitialisePromise) return turnstileInitialisePromise;
  turnstileInitialisePromise = (async () => {
    turnstileToken = null;
    updateTurnstileState("loading", "Preparing security check…");
    updateEmailOtpAvailability();
    const config = await api<{
      turnstileSiteKey: string;
      turnstileAction: string;
    }>("/api/auth/config");
    if (
      !config.turnstileSiteKey ||
      config.turnstileAction !== "otp_request"
    ) {
      throw new Error("The security check is not configured correctly.");
    }
    const turnstile = await loadTurnstileApi();
    if (turnstileWidgetId) {
      turnstile.remove(turnstileWidgetId);
      turnstileWidgetId = null;
    }
    turnstileWidgetId = turnstile.render(byId("turnstileWidget"), {
      sitekey: config.turnstileSiteKey,
      action: config.turnstileAction,
      theme: "dark",
      size: window.matchMedia("(max-width: 359px)").matches ? "compact" : "flexible",
      retry: "auto",
      "refresh-expired": "manual",
      "response-field": false,
      callback: (token) => {
        turnstileToken = token;
        updateTurnstileState("verified", "Security check complete.");
        updateEmailOtpAvailability();
        updateOtpCooldown();
      },
      "error-callback": () => {
        turnstileToken = null;
        updateTurnstileState(
          "error",
          "The security check did not complete. Retry it before requesting a code.",
          true,
        );
        updateEmailOtpAvailability();
        updateOtpCooldown();
      },
      "expired-callback": () => {
        turnstileToken = null;
        updateTurnstileState(
          "expired",
          "The security check expired. Complete a fresh check.",
          true,
        );
        updateEmailOtpAvailability();
        updateOtpCooldown();
      },
      "timeout-callback": () => {
        turnstileToken = null;
        updateTurnstileState(
          "expired",
          "The security check timed out. Retry to continue.",
          true,
        );
        updateEmailOtpAvailability();
        updateOtpCooldown();
      },
      "unsupported-callback": () => {
        turnstileToken = null;
        updateTurnstileState(
          "error",
          "This browser cannot run the security check. Update it or use another supported browser.",
          true,
        );
        updateEmailOtpAvailability();
        updateOtpCooldown();
      },
    });
    updateTurnstileState("ready", "Security check in progress…");
  })();
  return turnstileInitialisePromise;
}

function loadTurnstileApi(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileLoadPromise) return turnstileLoadPromise;
  turnstileLoadPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.spatialTurnstile = "true";
    script.addEventListener("load", () => {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }
      turnstileLoadPromise = null;
      reject(new Error("The security-check API did not initialise."));
    }, { once: true });
    script.addEventListener("error", () => {
      turnstileLoadPromise = null;
      script.remove();
      reject(new Error("The security-check script could not be downloaded."));
    }, { once: true });
    document.head.append(script);
  });
  return turnstileLoadPromise;
}

function retryTurnstile(): void {
  turnstileToken = null;
  if (!turnstileWidgetId || !window.turnstile) {
    turnstileInitialisePromise = null;
    beginTurnstileInitialisation();
    return;
  }
  updateTurnstileState("loading", "Retrying security check…");
  window.turnstile.reset(turnstileWidgetId);
  updateEmailOtpAvailability();
  updateOtpCooldown();
}

function resetTurnstile(message: string): void {
  turnstileToken = null;
  if (turnstileWidgetId && window.turnstile) {
    updateTurnstileState("loading", message);
    window.turnstile.reset(turnstileWidgetId);
  } else {
    updateTurnstileState("loading", "Preparing security check…");
    turnstileInitialisePromise = null;
    beginTurnstileInitialisation();
  }
  updateEmailOtpAvailability();
  updateOtpCooldown();
}

function updateTurnstileState(
  state: "loading" | "ready" | "verified" | "expired" | "error",
  message: string,
  canRetry = false,
): void {
  const region = byId("turnstileRegion");
  region.dataset.state = state;
  byId("turnstileStatus").textContent = message;
  byId<HTMLButtonElement>("retryTurnstile").hidden = !canRetry;
}

async function discoverEnterpriseLogin(): Promise<void> {
  const emailField = byId<HTMLInputElement>("loginEmail");
  if (!emailField.reportValidity()) return;
  const email = emailField.value.trim().toLowerCase();
  const discovery = await api<{
    providers: Array<{ id: string; name: string }>;
  }>("/api/auth/oidc/discover", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  if (!discovery.providers.length) {
    throw new Error("No active enterprise identity provider is configured for this email. Use the email code flow or contact your administrator.");
  }
  if (discovery.providers.length === 1) {
    await startEnterpriseLogin(discovery.providers[0]!, email);
    return;
  }
  const choices = byId("enterpriseProviderChoices");
  choices.replaceChildren(element("small", "", "Choose your organisation identity provider."));
  for (const provider of discovery.providers) {
    const button = element("button", "quiet-button wide", provider.name);
    button.type = "button";
    button.addEventListener("click", () => {
      void runAction({
        key: `enterprise-auth-start:${provider.id}`,
        trigger: button,
        pendingLabel: "Opening identity provider…",
        errorTarget: byId("loginError"),
        disable: [
          byId<HTMLButtonElement>("enterpriseLoginButton"),
          byId<HTMLButtonElement>("loginSubmit"),
          emailField,
        ],
      }, () => startEnterpriseLogin(provider, email));
    });
    choices.append(button);
  }
}

async function startEnterpriseLogin(
  provider: { id: string; name: string },
  email: string,
): Promise<void> {
  const started = await api<{
    authorizationUrl: string;
    expiresInSeconds: number;
  }>(`/api/auth/oidc/${encodeURIComponent(provider.id)}/start`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  const authorizationUrl = new URL(started.authorizationUrl);
  if (authorizationUrl.protocol !== "https:") {
    throw new Error("The enterprise identity provider returned an unsafe authorization address.");
  }
  window.location.assign(authorizationUrl.toString());
}

function enterpriseLoginErrorMessage(code: string | null): string {
  const messages: Record<string, string> = {
    provider_denied: "The identity provider did not approve sign-in. Retry or use an email code.",
    account_not_invited: "Your verified enterprise account has not been invited to this organisation.",
    account_link_conflict: "This enterprise account is already linked. Contact a platform administrator.",
    email_unverified: "The identity provider did not verify your email address.",
    email_mismatch: "The returned identity did not match the email used to begin sign-in.",
    email_domain: "The returned identity is outside the provider's allowed email domains.",
    provider_configuration: "Enterprise sign-in is temporarily unavailable because provider configuration is incomplete.",
    provider_timeout: "The identity provider timed out. Retry when the connection is stable.",
    provider_unavailable: "The identity provider is temporarily unavailable.",
    state_mismatch: "The enterprise sign-in request could not be matched to this browser. Start again.",
    state_invalid: "The enterprise sign-in request is invalid. Start again.",
    attempt_invalid: "The enterprise sign-in request expired or was already used. Start again.",
  };
  return (code && messages[code]) || "Enterprise sign-in could not be completed. Start again or use an email code.";
}

function clearSsoReturnParameters(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("sso");
  url.searchParams.delete("code");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function viewFromHash(): StudioView {
  const [candidate, projectId] = window.location.hash.slice(1).split("/");
  if (
    candidate === "project" ||
    candidate === "spatial" ||
    candidate === "measurement" ||
    (candidate === "projects" && projectId)
  ) return "project";
  return candidate === "jobs" || candidate === "releases" || candidate === "reviews" || candidate === "hosting" || candidate === "team"
    ? candidate
    : "projects";
}

function projectIdFromHash(): string | null {
  const candidate = window.location.hash.slice(1).split("/")[1];
  if (!candidate) return null;
  const decoded = decodeURIComponent(candidate);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)
    ? decoded
    : null;
}

function hashForView(view: StudioView): string {
  const projectId = state.selected?.project.id;
  if (view === "project" && projectId) {
    const suffix = state.projectSection === "overview" ? "" : `/${state.projectSection}`;
    return `#project/${encodeURIComponent(projectId)}${suffix}`;
  }
  return `#${view}`;
}

function projectSectionFromHash(): ProjectSection {
  const [candidate, , section] = window.location.hash.slice(1).split("/");
  if (section === "process") return "process";
  if (candidate === "spatial" || section === "scene" || section === "structure") return "structure";
  if (section === "privacy") return "privacy";
  if (section === "compare") return "compare";
  if (section === "walk") return "walk";
  if (section === "publish") return "publish";
  if (candidate === "measurement" || section === "measurement") return "measurement";
  if (section === "expert") return "expert";
  return "overview";
}

async function navigateFromHash(): Promise<void> {
  const view = viewFromHash();
  const projectId = projectIdFromHash();
  if (!isReviewer() && projectId && state.selected?.project.id !== projectId) {
    await backgroundActions.run(`navigate-project:${projectId}`, () =>
      selectProject(projectId, false, false)
    );
  }
  if (view === "project") state.projectSection = projectSectionFromHash();
  activateView(view, false);
}

function activateProjectSection(
  section: ProjectSection,
  updateLocation = true,
  historyMode: "replace" | "push" = "replace",
  focusHeading = false,
): void {
  if (!state.selected) {
    activateView("projects", updateLocation);
    return;
  }
  state.projectSection = section;
  activateView("project", updateLocation, historyMode);
  if (focusHeading) {
    window.requestAnimationFrame(() => focusProjectSectionHeading(section));
  }
}

function focusProjectSectionHeading(section: ProjectSection): void {
  const selector = section === "overview"
    ? "#detailTitle"
    : section === "process"
      ? "#detailBody .project-journey h3"
      : section === "publish"
        ? "#publishWorkspace h2"
        : section === "measurement"
          ? "#measurementWorkspace h2"
          : "#spatialWorkspace h2";
  const heading = document.querySelector<HTMLElement>(selector);
  if (!heading) return;
  heading.tabIndex = -1;
  heading.scrollIntoView({ behavior: "smooth", block: "start" });
  heading.focus({ preventScroll: true });
}

function activateView(
  view: StudioView,
  updateLocation = true,
  historyMode: "replace" | "push" = "replace",
): void {
  let comparisonSectionRedirected = false;
  if (isReviewer() && view !== "reviews") view = "reviews";
  if (view === "project" && !state.selected) view = "projects";
  if (view === "team" && state.user?.role !== "platform_admin") view = "projects";
  if (view === "project" && state.selected) {
    const resolvedSection = resolveComparisonWorkspaceSection(
      state.projectSection,
      state.selected.comparisonReadiness,
    ) as ProjectSection;
    comparisonSectionRedirected = resolvedSection !== state.projectSection;
    state.projectSection = resolvedSection;
  }
  state.view = view;
  byId<HTMLButtonElement>("projectCompareTab").hidden = !comparisonWorkspaceAvailable(
    state.selected?.comparisonReadiness ?? emptyComparisonReadiness,
  );
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === (view === "project" ? "projects" : view));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-project-section]").forEach((button) => {
    const active = view === "project" && button.dataset.projectSection === state.projectSection;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll<HTMLButtonElement>("[data-project-journey-section]").forEach((button) => {
    const active = view === "project" &&
      button.dataset.projectJourneySection === state.projectSection;
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  const advancedNavigation = document.querySelector<HTMLDetailsElement>(".studio-nav-advanced");
  if (advancedNavigation) advancedNavigation.open = !["projects", "project", "releases"].includes(view);
  const projectsVisible = view === "projects";
  const projectVisible = view === "project";
  const jobsVisible = view === "jobs";
  byId("studioHeader").hidden = projectVisible;
  byId("projectWorkspaceHeader").hidden = !projectVisible;
  byId("summaryGrid").hidden = !projectsVisible;
  byId("studioGrid").hidden = !["projects", "jobs"].includes(view);
  byId("studioGrid").classList.toggle("jobs-only", jobsVisible);
  byId("studioGrid").classList.toggle("projects-only", projectsVisible);
  byId("projectBoard").hidden = jobsVisible;
  byId("queuePanel").hidden = !jobsVisible;
  byId("projectDetail").hidden = !projectVisible || !["overview", "process"].includes(state.projectSection);
  byId("releaseWorkspace").hidden = view !== "releases";
  byId("reviewWorkspace").hidden = view !== "reviews";
  byId("spatialWorkspace").hidden = !projectVisible ||
    !["structure", "privacy", "compare", "walk", "expert"].includes(state.projectSection);
  byId("publishWorkspace").hidden = !projectVisible || state.projectSection !== "publish";
  byId("measurementWorkspace").hidden = !projectVisible || state.projectSection !== "measurement";
  byId("hostingWorkspace").hidden = view !== "hosting";
  byId("teamWorkspace").hidden = view !== "team";
  byId<HTMLButtonElement>("newProjectButton").hidden = !projectsVisible || isReviewer();
  byId<HTMLButtonElement>("portfolioToolsButton").hidden = !projectsVisible || state.user?.role !== "platform_admin";
  const headings = {
    projects: {
      eyebrow: "CAPTURE TO PREVIEW",
      title: "Upload once. Preview the processed splat. Edit only when needed.",
    },
    project: {
      eyebrow: "PROJECT",
      title: "One project, one workspace.",
    },
    jobs: {
      eyebrow: "PROCESSING OPERATIONS",
      title: "Durable jobs with visible progress and accountable outcomes.",
    },
    releases: {
      eyebrow: "PUBLISHED PREVIEWS",
      title: "Shareable scene URLs and their release history.",
    },
    reviews: {
      eyebrow: "CLIENT APPROVAL",
      title: "Feedback stays attached to the exact place and version.",
    },
    hosting: {
      eyebrow: "COMMERCIAL LIFECYCLE",
      title: "Operate every hosted asset as a renewable, accountable service.",
    },
    team: {
      eyebrow: "ACCESS CONTROL",
      title: "Invite deliberately, assign least privilege, and revoke immediately.",
    },
  } as const;
  byId("viewEyebrow").textContent = headings[view].eyebrow;
  byId("viewTitle").textContent = headings[view].title;
  const spatialHeading: readonly [string, string] | undefined = ({
    structure: ["STRUCTURE", "Review reconstructed rooms and openings"],
    privacy: ["PRIVACY", "Review privacy evidence before approval"],
    compare: ["COMPARE", "Review change evidence across immutable versions"],
    walk: ["WALK TEST", "Verify movement, clearance, and destinations"],
    expert: ["EXPERT", "Inspect technical evidence and recovery controls"],
  } as const)[state.projectSection as "structure" | "privacy" | "compare" | "walk" | "expert"];
  if (spatialHeading) {
    byId("spatialWorkspaceEyebrow").textContent = spatialHeading[0];
    byId("spatialWorkspaceTitle").textContent = spatialHeading[1];
  }
  renderJobs();
  if (view === "reviews") renderReviews();
  if (projectVisible && ["structure", "privacy", "compare", "walk", "expert"].includes(state.projectSection)) {
    renderSpatial();
    void ensureProjectWorkspace("spatial");
  }
  if (projectVisible && state.projectSection === "publish") {
    renderPublish();
    void ensureProjectWorkspace("spatial");
  }
  if (projectVisible && state.projectSection === "measurement") {
    renderMeasurement();
    void ensureProjectWorkspace("measurement");
  }
  if (view === "hosting") renderHosting();
  if (view === "team") renderTeam();
  const nextHash = hashForView(view);
  if (updateLocation && window.location.hash !== nextHash) {
    window.history[historyMode === "push" ? "pushState" : "replaceState"](null, "", nextHash);
  } else if (comparisonSectionRedirected && window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
}

async function signOut(): Promise<void> {
  try {
    await api<void>("/api/auth/session", { method: "DELETE" });
    markAuthenticationSignedOut();
    transitionToSignedOut();
  } catch (error) {
    showNotice(errorMessage(error), "error");
  }
}

function transitionToSignedOut(message = ""): void {
  authenticationStatus = "signed-out";
  state.user = null;
  state.organisations = [];
  state.pendingInvitations = [];
  compareDomain.cancel();
  semanticExtractionPollGeneration += 1;
  floorplanExtractionPollGeneration += 1;
  clearAssetHandoffPoll();
  clearTenantWorkspace();
  renderIdentity();
  renderPendingInvitations();
  renderProjectControls();
  renderProjectTemplateOptions();
  renderProjects();
  renderJobs();
  renderReleases();
  renderReviews();
  renderHosting();
  renderTeam();
  renderSpatial();
  renderMeasurement();
  byId("activeProjects").textContent = "-";
  byId("processingJobs").textContent = "-";
  byId("hostedAssets").textContent = "-";
  byId("hostedBytes").textContent = "Private R2 storage";
  byId("activeReleases").textContent = "-";
  byId("projectDetail").hidden = true;
  byId("projectWorkspaceHeader").hidden = true;
  byId("studioHeader").hidden = false;
  clearNotice();
  resetLogin();
  byId("loginError").textContent = message;
  window.history.replaceState(null, "", "#projects");
  if (!loginDialog.open) loginDialog.showModal();
  beginTurnstileInitialisation();
}

async function refreshAll(): Promise<void> {
  return backgroundActions.run("refresh-all", async () => {
    try {
      const [organisationResult, reviewInbox] = await Promise.all([
        api<{
          currentOrganisationId: string;
          organisations: OrganisationMembership[];
        }>("/api/auth/organisations"),
        api<{ projects: ReviewProject[] }>("/api/review/inbox"),
      ]);
      state.organisations = organisationResult.organisations;
      renderIdentity();
      state.reviewProjects = reviewInbox.projects;
      if (isReviewer()) {
        state.projects = [];
        state.projectsNextCursor = null;
        state.projectFields = [];
        state.selectedProjectIds.clear();
        bulkLifecycleOperation = null;
        state.jobs = [];
        state.jobsNextCursor = null;
        state.releases = [];
        state.releasesNextCursor = null;
        state.hosting = null;
        state.team = null;
        state.identityProviders = [];
        state.captureAgents = [];
        renderProjects();
        renderJobs();
        renderReleases();
        renderReviews();
        activateView("reviews");
        return;
      }
      const [dashboard, projects, jobs, releases, hosting, team, identityProviders, captureAgents, templates, views, fields] = await Promise.all([
        api<{ activeProjects: number; processingJobs: number; hostedAssets: number; hostedBytes: number; activeReleases: number }>("/api/dashboard"),
        api<{ projects: Project[]; nextCursor: string | null }>("/api/projects"),
        api<{ jobs: Job[]; nextCursor: string | null }>("/api/jobs"),
        api<{ releases: Release[]; nextCursor: string | null }>("/api/releases"),
        api<HostingWorkspace>("/api/hosting"),
        state.user?.role === "platform_admin"
          ? api<TeamWorkspace>("/api/team")
          : Promise.resolve(null),
        state.user?.role === "platform_admin"
          ? api<EnterpriseIdentityProviderWorkspace>("/api/team/identity-providers")
          : Promise.resolve({ providers: [] }),
        state.user?.role === "platform_admin"
          ? api<{ credentials: CaptureAgentCredential[] }>("/api/capture-agents")
          : Promise.resolve({ credentials: [] }),
        api<{ templates: ProjectTemplate[]; nextCursor: string | null }>("/api/project-templates"),
        api<{ views: SavedProjectView[]; nextCursor: string | null }>("/api/project-views"),
        api<{ fields: ProjectCustomFieldDefinition[] }>("/api/project-fields"),
      ]);
      state.projects = projects.projects;
      state.projectsNextCursor = projects.nextCursor;
      state.projectTemplates = templates.templates;
      state.projectTemplatesNextCursor = templates.nextCursor;
      state.projectFields = fields.fields;
      state.projectViews = views.views;
      state.projectViewsNextCursor = views.nextCursor;
      if (!projectViewsInitialised) {
        const defaultView = state.projectViews.find((view) => view.isDefault);
        if (defaultView) applyProjectView(defaultView, false);
        projectViewsInitialised = true;
      } else if (
        state.activeProjectViewId
        && !state.projectViews.some((view) => view.id === state.activeProjectViewId)
      ) {
        state.activeProjectViewId = null;
      }
      const currentProjectIds = new Set(state.projects.map((project) => project.id));
      for (const projectId of state.selectedProjectIds) {
        if (!currentProjectIds.has(projectId)) state.selectedProjectIds.delete(projectId);
      }
      state.jobs = jobs.jobs;
      state.jobsNextCursor = jobs.nextCursor;
      state.releases = releases.releases;
      state.releasesNextCursor = releases.nextCursor;
      state.hosting = hosting;
      state.team = team;
      state.identityProviders = identityProviders.providers;
      state.captureAgents = captureAgents.credentials;
      byId("activeProjects").textContent = String(dashboard.activeProjects);
      byId("processingJobs").textContent = String(dashboard.processingJobs);
      byId("hostedAssets").textContent = String(dashboard.hostedAssets);
      byId("hostedBytes").textContent = `${formatBytes(dashboard.hostedBytes)} private storage`;
      byId("activeReleases").textContent = String(dashboard.activeReleases);
      renderProjectControls();
      renderProjectTemplateOptions();
      renderProjects();
      renderJobs();
      renderReleases();
      renderReviews();
      renderHosting();
      renderTeam();
      const requestedView = viewFromHash();
      const requestedProjectId = projectIdFromHash() ?? state.selected?.project.id ?? null;
      if (requestedProjectId && state.projects.some((project) => project.id === requestedProjectId)) {
        await selectProject(requestedProjectId, false, false);
      }
      if (requestedView === "project") state.projectSection = projectSectionFromHash();
      activateView(requestedView, false);
      if (requestedView === "project" && !["overview", "process"].includes(state.projectSection)) {
        await ensureProjectWorkspace(
          state.projectSection === "measurement" ? "measurement" : "spatial",
          true,
        );
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (state.user || !loginDialog.open) {
          transitionToSignedOut("Your session expired. Sign in again.");
        }
      }
      else showNotice(errorMessage(error), "error");
    }
  });
}

async function reconcileBillingCheckoutReturn(): Promise<void> {
  const parameters = new URLSearchParams(window.location.search);
  const outcome = parameters.get("checkout");
  if (outcome !== "success" && outcome !== "cancelled") return;
  const providerCheckoutId = parameters.get("session_id");
  parameters.delete("checkout");
  parameters.delete("session_id");
  const cleanUrl = `${window.location.pathname}${
    parameters.size ? `?${parameters.toString()}` : ""
  }${window.location.hash || "#hosting"}`;
  window.history.replaceState(null, "", cleanUrl);
  activateView("hosting", false);

  if (outcome === "cancelled") {
    showNotice(
      "Secure checkout was cancelled. No paid hosting entitlement was activated; you can resume the open Checkout Session when ready.",
      "warning",
    );
    return;
  }
  if (!providerCheckoutId?.startsWith("cs_")) {
    showNotice(
      "Checkout returned without a valid provider session. No entitlement has been assumed; refresh after checking Stripe.",
      "error",
    );
    return;
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const checkout = state.hosting?.checkouts.find((candidate) =>
      candidate.provider_checkout_id === providerCheckoutId
    );
    const subscription = checkout && state.hosting?.subscriptions.find((candidate) =>
      candidate.project_id === checkout.project_id && candidate.status === "active"
    );
    if (checkout?.payment_status === "paid" && subscription) {
      showNotice(
        `Payment confirmed. ${subscription.plan_name} hosting is active through ${
          parseTimestamp(subscription.current_period_end).toLocaleDateString()
        }.`,
        "success",
      );
      return;
    }
    showNotice(
      "Stripe returned successfully. Waiting for the signed payment webhook before activating hosting…",
      "warning",
    );
    if (attempt === 3) break;
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    await refreshAll();
  }
  showNotice(
    "Payment confirmation is still processing. Hosting remains inactive until the signed Stripe webhook is reconciled; use Refresh to check again.",
    "warning",
  );
}

const portableCaptureFormats = ["ply", "spz", "sog", "splat", "ksplat", "rad"] as const;
const metricGeometryFormats = ["ply", "e57", "las", "laz", "pts"] as const;

function setNewCaptureIntakeStep(step: 1 | 2 | 3, focusHeading = true): void {
  newCaptureIntakeStep = step;
  for (const section of document.querySelectorAll<HTMLElement>("[data-capture-intake-step]")) {
    section.hidden = Number(section.dataset.captureIntakeStep) !== step;
  }
  for (const indicator of document.querySelectorAll<HTMLElement>("[data-capture-intake-indicator]")) {
    const active = Number(indicator.dataset.captureIntakeIndicator) === step;
    indicator.classList.toggle("active", active);
    if (active) indicator.setAttribute("aria-current", "step");
    else indicator.removeAttribute("aria-current");
  }
  byId<HTMLButtonElement>("newCaptureBack").hidden = step === 1;
  byId<HTMLButtonElement>("newCaptureNext").hidden = step === 3;
  byId<HTMLButtonElement>("newCaptureNext").textContent = step === 1
    ? "Continue to files"
    : "Review processing plan";
  byId<HTMLButtonElement>("newCaptureSubmit").hidden = step !== 3;
  if (step === 3) renderNewCaptureReview();
  if (focusHeading) {
    window.requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>(
        `[data-capture-intake-step="${step}"] h3`,
      );
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus();
    });
  }
}

function advanceNewCaptureIntake(): void {
  const section = document.querySelector<HTMLElement>(
    `[data-capture-intake-step="${newCaptureIntakeStep}"]`,
  );
  const invalid = section?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input:invalid, select:invalid, textarea:invalid",
  );
  if (invalid) {
    invalid.reportValidity();
    invalid.focus();
    return;
  }
  if (newCaptureIntakeStep === 1) setNewCaptureIntakeStep(2);
  else if (newCaptureIntakeStep === 2) setNewCaptureIntakeStep(3);
}

function renderNewCaptureReview(): void {
  const form = byId<HTMLFormElement>("newProjectForm");
  const origin = form.elements.namedItem("captureOrigin");
  const producer = form.elements.namedItem("assetProducer");
  const capture = form.elements.namedItem("capture");
  const geometry = form.elements.namedItem("geometry");
  const review = byId("newCaptureReview");
  const originLabel = origin instanceof HTMLSelectElement
    ? origin.selectedOptions[0]?.textContent ?? "Not selected"
    : "Not selected";
  const producerLabel = producer instanceof HTMLSelectElement
    ? producer.selectedOptions[0]?.textContent ?? "Not selected"
    : "Not selected";
  const captureName = capture instanceof HTMLInputElement
    ? capture.files?.[0]?.name ?? "Not selected"
    : "Not selected";
  const geometryName = geometry instanceof HTMLInputElement
    ? geometry.files?.[0]?.name ?? "Not selected"
    : "Not selected";
  review.replaceChildren(
    projectFact("Scene", String(new FormData(form).get("name") ?? "")),
    projectFact("Capture origin", originLabel),
    projectFact("Asset producer", producerLabel),
    projectFact("3D appearance", captureName),
    projectFact("Measurement geometry", geometryName),
    element("h4", "", "The platform will"),
    element("p", "capture-plan-item", "✓ Preserve both source files"),
    element("p", "capture-plan-item", "✓ Prepare the browser scene"),
    element("p", "capture-plan-item", "✓ Detect rooms, walls, and openings"),
    element("p", "capture-plan-item", "✓ Build the walkable area"),
    element("p", "capture-plan-item", "✓ Run privacy detection"),
  );
}

function inferNewCaptureAdapter(): void {
  const select = byId<HTMLSelectElement>("newCaptureAdapter");
  const origin = byId<HTMLSelectElement>("newCaptureOrigin");
  const names = [
    byId<HTMLInputElement>("newCaptureAsset").files?.[0]?.name,
    byId<HTMLInputElement>("newCaptureGeometry").files?.[0]?.name,
  ].filter((name): name is string => Boolean(name)).join(" ").toLowerCase();
  const inferred = /(?:^|[^a-z0-9])(?:xgrids|lcc)(?:[^a-z0-9]|$)/.test(names)
    ? "xgrids-lcc"
    : /(?:^|[^a-z0-9])(?:fjd|trion)(?:[^a-z0-9]|$)/.test(names)
      ? "fjd-trion"
      : null;
  if (inferred && !select.value) select.value = inferred;
  if (inferred && !origin.value) origin.value = inferred === "xgrids-lcc" ? "xgrids" : "fjd";
}

function portableCapturePlan(file: File): {
  format: typeof portableCaptureFormats[number];
  purpose: "gaussian_splat" | "web_scene";
} {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (!extension || !portableCaptureFormats.includes(extension as typeof portableCaptureFormats[number])) {
    throw new Error("Choose a portable PLY, SPZ, SOG, SPLAT, KSPLAT, or Spark RAD export.");
  }
  const format = extension as typeof portableCaptureFormats[number];
  return { format, purpose: format === "rad" ? "web_scene" : "gaussian_splat" };
}

function metricGeometryPlan(file: File): {
  format: typeof metricGeometryFormats[number];
  purpose: "metric_point_cloud";
} {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (!extension || !metricGeometryFormats.includes(extension as typeof metricGeometryFormats[number])) {
    throw new Error("Choose a registered metric PLY, E57, LAS, LAZ, or PTS point cloud.");
  }
  return {
    format: extension as typeof metricGeometryFormats[number],
    purpose: "metric_point_cloud",
  };
}

type PairedCapturePreflight =
  | { status: "qualified" }
  | { status: "unavailable" }
  | { status: "contradicted"; reason: string };

async function pairedCaptureCanQualifyAutomatically(
  visual: File,
  geometry: File,
): Promise<PairedCapturePreflight> {
  if (
    visual.name.split(".").at(-1)?.toLowerCase() !== "ply" ||
    geometry.name.split(".").at(-1)?.toLowerCase() !== "ply"
  ) return { status: "unavailable" };
  try {
    const [visualHeader, geometryHeader] = await Promise.all([
      visual.slice(0, PLY_COORDINATE_HEADER_BUDGET_BYTES).arrayBuffer(),
      geometry.slice(0, PLY_COORDINATE_HEADER_BUDGET_BYTES).arrayBuffer(),
    ]);
    const visualDescriptor = parsePlyCoordinateDescriptor(visualHeader);
    const geometryDescriptor = parsePlyCoordinateDescriptor(geometryHeader);
    return preflightPairedPlyCoordinateDescriptors(visualDescriptor, geometryDescriptor);
  } catch (error) {
    if (
      errorMessage(error) === "PLY header has no end_header marker" &&
      (visual.size > PLY_COORDINATE_HEADER_BUDGET_BYTES ||
        geometry.size > PLY_COORDINATE_HEADER_BUDGET_BYTES)
    ) throw plyCoordinateHeaderBudgetError();
    return { status: "unavailable" };
  }
}

async function renderNewCaptureHelp(): Promise<void> {
  const renderGeneration = ++captureQualificationRenderGeneration;
  const producer = byId<HTMLSelectElement>("newCaptureAdapter").value;
  const file = byId<HTMLInputElement>("newCaptureAsset").files?.[0];
  const geometryInput = byId<HTMLInputElement>("newCaptureGeometry");
  const geometry = geometryInput.files?.[0];
  const frameConfirmation = byId<HTMLInputElement>("sameCaptureFrameConfirmed");
  const frameConfirmationRow = byId<HTMLElement>("newCaptureFrameConfirmation");
  const qualificationStatus = byId("newCaptureQualificationStatus");
  geometryInput.required = true;
  const source = producer === "xgrids-lcc"
    ? "XGRIDS"
    : producer === "fjd-trion"
      ? "FJD"
      : "This export";
  let message = `${source} scenes need a browser visual (PLY, SPZ, SOG, SPLAT, KSPLAT, or Spark RAD) plus measurement geometry from the same scan. Native project files remain supporting evidence.`;
  if (file) {
    try {
      const plan = portableCapturePlan(file);
      message = plan.purpose === "web_scene"
        ? `${file.name} is a ready Spark scene. It will be verified and made available for private preview.`
        : `${file.name} will be preserved as the Gaussian master and converted into a browser-ready Spark scene.`;
    } catch (error) {
      message = errorMessage(error);
    }
  }
  byId("newCaptureHelp").textContent = message;
  byId("newCaptureGeometryHelp").textContent = geometry
    ? `${geometry.name} will be verified, then used to generate the floor plan, structural collision draft, and navigation draft automatically.`
    : "Required. Choose the registered PLY, E57, LAS, LAZ, or PTS point cloud exported from the same scan. It supplies the floor plan, collision shell, and walking map.";
  if (!file || !geometry) {
    captureQualificationMode = ATTESTED_PAIRED_CAPTURE_METHOD;
    frameConfirmationRow.hidden = true;
    frameConfirmation.required = false;
    qualificationStatus.textContent = "Add both files to check their coordinate compatibility.";
    return;
  }
  qualificationStatus.textContent = "Checking embedded frame, scale, and up-axis metadata…";
  byId<HTMLButtonElement>("newCaptureNext").disabled = true;
  let preflight: PairedCapturePreflight = { status: "unavailable" };
  try {
    preflight = await pairedCaptureCanQualifyAutomatically(file, geometry);
  } catch (error) {
    if (renderGeneration !== captureQualificationRenderGeneration) return;
    byId<HTMLButtonElement>("newCaptureNext").disabled = true;
    captureQualificationMode = ATTESTED_PAIRED_CAPTURE_METHOD;
    frameConfirmationRow.hidden = true;
    frameConfirmation.required = false;
    qualificationStatus.textContent = errorMessage(error);
    return;
  }
  if (renderGeneration !== captureQualificationRenderGeneration) return;
  if (preflight.status === "contradicted") {
    byId<HTMLButtonElement>("newCaptureNext").disabled = true;
    captureQualificationMode = ATTESTED_PAIRED_CAPTURE_METHOD;
    frameConfirmationRow.hidden = true;
    frameConfirmation.required = false;
    qualificationStatus.textContent = `${preflight.reason} Export both files again from one unchanged Y-up metre frame.`;
    return;
  }
  byId<HTMLButtonElement>("newCaptureNext").disabled = false;
  captureQualificationMode = preflight.status === "qualified"
    ? AUTOMATIC_PAIRED_CAPTURE_METHOD
    : ATTESTED_PAIRED_CAPTURE_METHOD;
  frameConfirmationRow.hidden = preflight.status === "qualified";
  frameConfirmation.required = preflight.status !== "qualified";
  if (preflight.status === "qualified") frameConfirmation.checked = false;
  qualificationStatus.textContent = preflight.status === "qualified"
    ? "Automatic qualification available. The processor will verify the shared frame identity, metre scale, Y-up axis, and exact bounds overlap from both uploaded PLY files."
    : "These files cannot prove their shared frame automatically. The fallback attestation preserves provenance only; register measured capture-to-scene evidence before building or publishing walking geometry.";
}

async function createCapture(form: FormData): Promise<void> {
  const file = form.get("capture");
  if (!(file instanceof File)) throw new Error("Choose a portable capture result to upload.");
  const plan = portableCapturePlan(file);
  const geometryFile = form.get("geometry");
  const geometry = geometryFile instanceof File && geometryFile.size > 0 ? geometryFile : null;
  const captureOrigin = String(form.get("captureOrigin") ?? "");
  const assetProducer = String(form.get("assetProducer") ?? "");
  if (!captureOriginIds.includes(captureOrigin as typeof captureOriginIds[number])) {
    throw new Error("Choose where the original capture observations came from.");
  }
  if (!assetProducerIds.includes(assetProducer as typeof assetProducerIds[number])) {
    throw new Error("Choose the pipeline that produced these capture files.");
  }
  const template = state.projectTemplates.find((candidate) =>
    candidate.id === String(form.get("projectTemplate") ?? "")
  ) ?? null;
  if (!geometry) {
    throw new Error("Add the registered metric point cloud so the floor plan and navigation can be generated automatically.");
  }
  const qualificationPreflight = await pairedCaptureCanQualifyAutomatically(file, geometry);
  if (qualificationPreflight.status === "contradicted") {
    throw new Error(
      `${qualificationPreflight.reason} Export both files again from one unchanged Y-up metre frame.`,
    );
  }
  const automaticQualification = qualificationPreflight.status === "qualified";
  captureQualificationMode = automaticQualification
    ? AUTOMATIC_PAIRED_CAPTURE_METHOD
    : ATTESTED_PAIRED_CAPTURE_METHOD;
  if (!automaticQualification && form.get("sameCaptureFrameConfirmed") !== "on") {
    throw new Error(
      "Confirm that both exports come directly from the same capture and still share one registered Y-up metre frame.",
    );
  }
  const geometryPlan = geometry ? metricGeometryPlan(geometry) : null;
  for (const asset of [plan, geometryPlan]) {
    if (!asset) continue;
    const compatibility = planProducedAssetImport({
      producer: assetProducer as typeof assetProducerIds[number],
      purpose: asset.purpose,
      format: asset.format,
    });
    if (!compatibility.accepted) throw new Error(compatibility.reason);
  }
  projectOperationId ??= crypto.randomUUID();
  captureJourneyOperation ??= {
    id: crypto.randomUUID(),
    primaryUploadOperationId: crypto.randomUUID(),
    geometryUploadOperationId: crypto.randomUUID(),
  };
  try {
    const result = await api<{ project: { id: string } }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        clientOperationId: projectOperationId,
        name: String(form.get("name") ?? ""),
        customerName: optionalString(form.get("customerName")),
        customerEmail: optionalString(form.get("customerEmail")),
        captureOrigin,
        assetProducer,
        capturePlan: [plan, geometryPlan].filter((asset) => asset !== null),
        deliveryTemplate: template?.deliveryTemplate ?? "Property showcase",
        notes: optionalString(form.get("notes")),
        customFields: {
          ...projectCustomFieldsFromForm(byId("newProjectRequiredCustomFields")),
          ...projectCustomFieldsFromForm(byId("newProjectCustomFields")),
        },
        ...(template ? { projectTemplateId: template.id } : {}),
      }),
    });
    byId("newProjectStatus").textContent = "Project created. Starting resumable upload…";
    await refreshAll();
    activateView("projects");
    await selectProject(result.project.id);
    const upload = new FormData();
    upload.set("asset", file);
    upload.set("format", plan.format);
    upload.set("purpose", plan.purpose);
    const primary = await uploadAsset(upload, {
      status: byId("newProjectStatus"),
      progress: byId<HTMLElement>("newProjectUploadProgress"),
      error: byId("projectError"),
      successToast: "Visual capture uploaded; adding spatial geometry",
    }, {
      clientOperationId: captureJourneyOperation.primaryUploadOperationId,
      captureJourney: {
        id: captureJourneyOperation.id,
        qualification: captureQualificationMode,
        ...(automaticQualification ? {} : { sameFrameConfirmed: true }),
      },
    });
    byId("newProjectStatus").textContent = "Visual capture preserved. Uploading registered geometry…";
    byId<HTMLElement>("newProjectUploadProgress").style.width = "0%";
    const spatialUpload = new FormData();
    spatialUpload.set("asset", geometry);
    spatialUpload.set("format", geometryPlan!.format);
    spatialUpload.set("purpose", geometryPlan!.purpose);
    await uploadAsset(spatialUpload, {
      status: byId("newProjectStatus"),
      progress: byId<HTMLElement>("newProjectUploadProgress"),
      error: byId("projectError"),
      closeDialog: newProjectDialog,
      successToast: automaticQualification
        ? "Capture uploaded; splat, floor plan, and navigation processing started"
        : "Capture uploaded; provenance preserved. Register measured alignment before building walking geometry",
    }, {
      targetVersionId: primary.asset.versionId,
      clientOperationId: captureJourneyOperation.geometryUploadOperationId,
      captureJourney: {
        id: captureJourneyOperation.id,
        qualification: captureQualificationMode,
        ...(automaticQualification ? {} : { sameFrameConfirmed: true }),
      },
    });
    projectOperationId = null;
    captureJourneyOperation = null;
    window.setTimeout(() => {
      byId<HTMLFormElement>("newProjectForm").reset();
      void renderNewCaptureHelp();
      setNewCaptureIntakeStep(1, false);
    }, 950);
  } catch (error) {
    byId("projectError").textContent = errorMessage(error);
    throw error;
  }
}

function currentProjectViewFilter(): ProjectViewFilter {
  return {
    query: state.projectQuery,
    statuses: [...state.projectStatuses].sort(),
    captureAdapters: state.projectAdapter ? [state.projectAdapter] : [],
    deliveryTemplates: state.projectDelivery ? [state.projectDelivery] : [],
    sort: state.projectSort,
  };
}

function applyProjectView(view: SavedProjectView, render = true): void {
  state.activeProjectViewId = view.id;
  state.projectQuery = view.filter.query;
  state.projectStatuses = [...view.filter.statuses];
  state.projectAdapter = view.filter.captureAdapters[0] ?? "";
  state.projectDelivery = view.filter.deliveryTemplates[0] ?? "";
  state.projectSort = view.filter.sort;
  if (render) {
    renderProjectControls();
    renderProjects();
  }
}

function markProjectViewDirty(): void {
  state.activeProjectViewId = null;
  renderProjectControls();
}

function renderProjectControls(): void {
  const search = byId<HTMLInputElement>("projectSearch");
  const adapter = byId<HTMLSelectElement>("projectAdapterFilter");
  const delivery = byId<HTMLSelectElement>("projectDeliveryFilter");
  const sort = byId<HTMLSelectElement>("projectSort");
  const saved = byId<HTMLSelectElement>("savedProjectView");
  search.value = state.projectQuery;
  adapter.value = state.projectAdapter;
  sort.value = state.projectSort;

  const deliveryValues = [...new Set([
    ...state.projects.map((project) => project.deliveryTemplate),
    ...state.projectTemplates.map((template) => template.deliveryTemplate),
    ...(state.projectDelivery ? [state.projectDelivery] : []),
  ])].sort((left, right) => left.localeCompare(right));
  delivery.replaceChildren(new Option("All delivery classifications", ""));
  for (const value of deliveryValues) delivery.append(new Option(value, value));
  delivery.value = state.projectDelivery;

  saved.replaceChildren(new Option("Current filters", ""));
  for (const view of state.projectViews) {
    saved.append(new Option(`${view.isDefault ? "★ " : ""}${view.name}`, view.id));
  }
  saved.value = state.activeProjectViewId ?? "";
  byId<HTMLButtonElement>("loadMoreProjectViews").hidden = !state.projectViewsNextCursor;
  const activeView = state.projectViews.find((view) => view.id === state.activeProjectViewId);
  byId("saveProjectViewButton").textContent = activeView ? "Update view" : "Save view";
  byId("deleteProjectViewButton").hidden = !activeView;
  document.querySelectorAll<HTMLButtonElement>(".filter-chip").forEach((chip) => {
    const filter = chip.dataset.filter ?? "all";
    chip.classList.toggle(
      "active",
      filter === "all" ? state.projectStatuses.length === 0 : state.projectStatuses.includes(filter),
    );
  });
}

function openSavedProjectViewDialog(): void {
  const form = byId<HTMLFormElement>("savedViewForm");
  const active = state.projectViews.find((view) => view.id === state.activeProjectViewId);
  form.reset();
  const idField = form.elements.namedItem("viewId");
  const nameField = form.elements.namedItem("name");
  const defaultField = form.elements.namedItem("isDefault");
  if (idField instanceof HTMLInputElement) idField.value = active?.id ?? "";
  if (nameField instanceof HTMLInputElement) nameField.value = active?.name ?? "";
  if (defaultField instanceof HTMLInputElement) defaultField.checked = active?.isDefault ?? false;
  savedViewOperation = null;
  byId("savedViewTitle").textContent = active ? `Update “${active.name}”.` : "Save the current filters.";
  byId("savedViewError").textContent = "";
  savedViewDialog.showModal();
  window.setTimeout(() => {
    if (nameField instanceof HTMLInputElement) nameField.focus();
  }, 0);
}

async function saveProjectView(form: FormData): Promise<void> {
  const viewId = optionalString(form.get("viewId"));
  const body = {
    name: String(form.get("name") ?? ""),
    filter: currentProjectViewFilter(),
    isDefault: form.get("isDefault") === "on",
  };
  const requestKey = JSON.stringify(body);
  if (!viewId && savedViewOperation?.requestKey !== requestKey) {
    savedViewOperation = { id: crypto.randomUUID(), requestKey };
  }
  const result = await api<{ view: SavedProjectView }>(
    viewId ? `/api/project-views/${viewId}` : "/api/project-views",
    {
      method: viewId ? "PATCH" : "POST",
      body: JSON.stringify(viewId ? body : {
        ...body,
        clientOperationId: savedViewOperation!.id,
      }),
    },
  );
  await refreshProjectPortfolioMetadata();
  const saved = state.projectViews.find((view) => view.id === result.view.id) ?? result.view;
  applyProjectView(saved);
  savedViewDialog.close();
  savedViewOperation = null;
  showToast(viewId ? "Project view updated" : "Project view saved");
}

async function deleteProjectView(view: SavedProjectView): Promise<void> {
  await api(`/api/project-views/${view.id}`, { method: "DELETE" });
  state.activeProjectViewId = null;
  await refreshProjectPortfolioMetadata();
  renderProjectControls();
  renderProjects();
  showToast("Saved view deleted");
}

async function refreshProjectPortfolioMetadata(): Promise<void> {
  const [templates, views, fields] = await Promise.all([
    api<{ templates: ProjectTemplate[]; nextCursor: string | null }>("/api/project-templates"),
    api<{ views: SavedProjectView[]; nextCursor: string | null }>("/api/project-views"),
    api<{ fields: ProjectCustomFieldDefinition[] }>("/api/project-fields"),
  ]);
  state.projectTemplates = templates.templates;
  state.projectTemplatesNextCursor = templates.nextCursor;
  state.projectViews = views.views;
  state.projectViewsNextCursor = views.nextCursor;
  state.projectFields = fields.fields;
  renderProjectTemplateOptions();
  renderProjectControls();
  if (portfolioToolsDialog.open) renderPortfolioTools();
}

function renderProjectTemplateOptions(): void {
  const select = document.getElementById("newProjectTemplate");
  if (!(select instanceof HTMLSelectElement)) return;
  const selected = select.value;
  select.replaceChildren(new Option("No saved defaults", ""));
  for (const template of state.projectTemplates) {
    select.append(new Option(template.name, template.id));
  }
  select.value = state.projectTemplates.some((template) => template.id === selected) ? selected : "";
}

function applySelectedProjectTemplate(): void {
  const form = byId<HTMLFormElement>("newProjectForm");
  const templateId = byId<HTMLSelectElement>("newProjectTemplate").value;
  const template = state.projectTemplates.find((candidate) => candidate.id === templateId);
  if (!template) return;
  const adapter = form.elements.namedItem("assetProducer");
  const notes = form.elements.namedItem("notes");
  if (adapter instanceof HTMLSelectElement) {
    const supported = Array.from(adapter.options).some((option) =>
      option.value === template.captureAdapter
    );
    if (!supported) {
      byId<HTMLSelectElement>("newProjectTemplate").value = "";
      showNotice(
        `The “${template.name}” defaults use a capture source this Studio version cannot create. Update the defaults in Portfolio tools before applying them.`,
        "error",
      );
      return;
    }
    adapter.value = template.captureAdapter;
  }
  if (notes instanceof HTMLTextAreaElement && !notes.value.trim()) notes.value = template.notes ?? "";
  void renderNewCaptureHelp();
}

function renderPortfolioTools(): void {
  const list = byId("projectTemplateList");
  list.replaceChildren();
  if (!state.projectTemplates.length) {
    list.append(emptyState("No reusable templates yet.", true));
  } else {
    for (const template of state.projectTemplates) {
      const row = element("article", "compact-record");
      const copy = element("span");
      copy.append(
        element("strong", "", template.name),
        element("small", "", `${template.captureAdapter} · ${template.deliveryTemplate}`),
      );
      if (template.description) copy.append(element("small", "", template.description));
      const actions = element("div", "compact-record-actions");
      const edit = element("button", "text-button", "Edit");
      edit.addEventListener("click", () => editProjectTemplate(template));
      const remove = element("button", "text-button", "Delete");
      remove.addEventListener("click", () => {
        if (!confirm(`Delete the template “${template.name}”? Existing projects keep their settings.`)) return;
        void runAction({
          key: `delete-project-template:${template.id}`,
          trigger: remove,
          pendingLabel: "Deleting…",
          disable: [edit],
        }, () => deleteProjectTemplate(template));
      });
      actions.append(edit, remove);
      row.append(copy, actions);
      list.append(row);
    }
  }
  renderListPagination(
    "projectTemplatePagination",
    "projectTemplatePaginationStatus",
    state.projectTemplatesNextCursor,
    `${state.projectTemplates.length} templates loaded. More templates are available.`,
  );
  const selectedCount = state.selectedProjectIds.size;
  byId("portfolioExportHint").textContent = selectedCount
    ? `${selectedCount} selected project${selectedCount === 1 ? "" : "s"} can be exported, or export the full portfolio. Assets and lifecycle state stay here.`
    : "Select projects in the portfolio for a scoped export, or export all. Assets and lifecycle state stay here.";
  byId<HTMLButtonElement>("exportSelectedProjects").disabled = selectedCount === 0 || selectedCount > 100;
  byId<HTMLButtonElement>("exportAllProjects").disabled = state.projects.length === 0 || state.projects.length > 100;
  renderProjectFieldManager();
  renderPortfolioHandoffTarget();
  renderAssetHandoffTarget();
  renderPortfolioImportActions();
  renderPortfolioHandoffActions();
  renderAssetHandoffActions();
}

function editProjectTemplate(template: ProjectTemplate): void {
  const form = byId<HTMLFormElement>("projectTemplateForm");
  const fields = {
    templateId: template.id,
    name: template.name,
    description: template.description ?? "",
    captureAdapter: template.captureAdapter,
    deliveryTemplate: template.deliveryTemplate,
    notes: template.notes ?? "",
    privacyReview: template.policy.privacyReview,
    publication: template.policy.publication,
    navigation: template.policy.navigation,
    requiredFiles: template.policy.requiredFiles,
    structureWorkflow: template.policy.structureWorkflow,
    navigationClearance: template.policy.navigationClearance,
    measurement: template.policy.measurement,
    hosting: template.policy.hosting,
    quality: template.policy.quality,
  };
  for (const [name, value] of Object.entries(fields)) {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
      field.value = value;
    }
  }
  templateOperation = null;
  byId("cancelTemplateEdit").hidden = false;
  form.querySelector<HTMLButtonElement>("[type='submit']")!.textContent = "Update template";
  byId("projectTemplateError").textContent = "";
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function resetProjectTemplateForm(): void {
  const form = byId<HTMLFormElement>("projectTemplateForm");
  form.reset();
  const idField = form.elements.namedItem("templateId");
  if (idField instanceof HTMLInputElement) idField.value = "";
  templateOperation = null;
  byId("cancelTemplateEdit").hidden = true;
  form.querySelector<HTMLButtonElement>("[type='submit']")!.textContent = "Create template";
  byId("projectTemplateError").textContent = "";
}

function renderProjectFieldManager(): void {
  const section = byId("projectFieldManager");
  const list = byId("projectFieldList");
  const form = byId<HTMLFormElement>("projectFieldForm");
  const canManage = state.user?.role === "platform_admin";
  section.hidden = !state.user;
  form.hidden = !canManage;
  list.replaceChildren();
  if (!state.projectFields.length) {
    list.append(emptyState(
      canManage
        ? "No organisation-defined project fields yet."
        : "No organisation-defined project fields are configured.",
      true,
    ));
    return;
  }
  for (const field of state.projectFields) {
    const row = element("article", "compact-record");
    const copy = element("span");
    copy.append(
      element("strong", "", `${field.label}${field.required ? " · required" : ""}`),
      element(
        "small",
        "",
        `${field.key} · ${humanStatus(field.type)} · ${field.active ? "active" : "inactive"}`,
      ),
    );
    if (field.description) copy.append(element("small", "", field.description));
    row.append(copy);
    if (canManage) {
      const actions = element("div", "compact-record-actions");
      const edit = element("button", "text-button", "Edit");
      edit.addEventListener("click", () => editProjectField(field));
      const toggle = element(
        "button",
        "text-button",
        field.active ? "Deactivate" : "Reactivate",
      );
      toggle.addEventListener("click", () => {
        void runAction({
          key: `toggle-project-field:${field.id}`,
          trigger: toggle,
          pendingLabel: field.active ? "Deactivating…" : "Reactivating…",
          disable: [edit],
        }, () => updateProjectFieldActivation(field, !field.active));
      });
      actions.append(edit, toggle);
      row.append(actions);
    }
    list.append(row);
  }
}

function editProjectField(field: ProjectCustomFieldDefinition): void {
  const form = byId<HTMLFormElement>("projectFieldForm");
  setFormValue(form, "fieldId", field.id);
  setFormValue(form, "key", field.key);
  setFormValue(form, "label", field.label);
  setFormValue(form, "type", field.type);
  setFormValue(form, "sortOrder", String(field.sortOrder));
  setFormValue(form, "description", field.description ?? "");
  setFormValue(form, "options", field.options.join("\n"));
  const required = form.elements.namedItem("required");
  if (required instanceof HTMLInputElement) required.checked = field.required;
  for (const name of ["key", "type"]) {
    const immutable = form.elements.namedItem(name);
    if (immutable instanceof HTMLInputElement || immutable instanceof HTMLSelectElement) {
      immutable.disabled = true;
    }
  }
  byId("cancelProjectFieldEdit").hidden = false;
  form.querySelector<HTMLButtonElement>("[type='submit']")!.textContent = "Update field";
  byId("projectFieldError").textContent = "";
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function resetProjectFieldForm(): void {
  const form = byId<HTMLFormElement>("projectFieldForm");
  form.reset();
  setFormValue(form, "fieldId", "");
  for (const name of ["key", "type"]) {
    const mutable = form.elements.namedItem(name);
    if (mutable instanceof HTMLInputElement || mutable instanceof HTMLSelectElement) {
      mutable.disabled = false;
    }
  }
  projectFieldOperation = null;
  byId("cancelProjectFieldEdit").hidden = true;
  form.querySelector<HTMLButtonElement>("[type='submit']")!.textContent = "Create field";
  byId("projectFieldError").textContent = "";
}

async function saveProjectField(form: FormData): Promise<void> {
  const fieldId = optionalString(form.get("fieldId"));
  const options = String(form.get("options") ?? "")
    .split(/\r?\n/)
    .map((option) => option.trim())
    .filter(Boolean);
  const common = {
    label: String(form.get("label") ?? "").trim(),
    description: optionalString(form.get("description")),
    required: form.get("required") === "on",
    options,
    sortOrder: Number(form.get("sortOrder") ?? 0),
  };
  if (fieldId) {
    await api(`/api/project-fields/${fieldId}`, {
      method: "PATCH",
      body: JSON.stringify(common),
    });
  } else {
    const body = {
      ...common,
      key: String(form.get("key") ?? "").trim(),
      type: String(form.get("type") ?? "text"),
    };
    const requestKey = JSON.stringify(body);
    if (projectFieldOperation?.requestKey !== requestKey) {
      projectFieldOperation = { id: crypto.randomUUID(), requestKey };
    }
    await api("/api/project-fields", {
      method: "POST",
      body: JSON.stringify({
        ...body,
        clientOperationId: projectFieldOperation.id,
      }),
    });
  }
  resetProjectFieldForm();
  await refreshProjectPortfolioMetadata();
  renderProjectFieldManager();
  showToast(fieldId ? "Project field updated" : "Project field created");
}

async function updateProjectFieldActivation(
  field: ProjectCustomFieldDefinition,
  active: boolean,
): Promise<void> {
  await api(`/api/project-fields/${field.id}`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });
  await refreshProjectPortfolioMetadata();
  renderProjectFieldManager();
  showToast(`${field.label} ${active ? "reactivated" : "deactivated"}`);
}

async function saveProjectTemplate(form: FormData): Promise<void> {
  const templateId = optionalString(form.get("templateId"));
  const body = {
    name: String(form.get("name") ?? ""),
    description: optionalString(form.get("description")),
    captureAdapter: String(form.get("captureAdapter") ?? "open-import"),
    deliveryTemplate: String(form.get("deliveryTemplate") ?? "Property showcase"),
    notes: optionalString(form.get("notes")),
    policy: {
      schemaVersion: "project-workflow-policy-v1",
      privacyReview: String(form.get("privacyReview") ?? "strict"),
      publication: String(form.get("publication") ?? "public-after-approval"),
      navigation: String(form.get("navigation") ?? "visitor-walk"),
      requiredFiles: String(form.get("requiredFiles") ?? "visual-and-registered-geometry"),
      structureWorkflow: String(form.get("structureWorkflow") ?? "automatic-extract-review"),
      navigationClearance: String(form.get("navigationClearance") ?? "approved-scene"),
      measurement: String(form.get("measurement") ?? "hidden"),
      hosting: String(form.get("hosting") ?? "managed-optional"),
      quality: String(form.get("quality") ?? "standard"),
    },
  };
  const requestKey = JSON.stringify(body);
  if (!templateId && templateOperation?.requestKey !== requestKey) {
    templateOperation = { id: crypto.randomUUID(), requestKey };
  }
  await api(templateId ? `/api/project-templates/${templateId}` : "/api/project-templates", {
    method: templateId ? "PATCH" : "POST",
    body: JSON.stringify(templateId ? body : { ...body, clientOperationId: templateOperation!.id }),
  });
  templateOperation = null;
  resetProjectTemplateForm();
  await refreshProjectPortfolioMetadata();
  showToast(templateId ? "Project template updated" : "Project template created");
}

async function deleteProjectTemplate(template: ProjectTemplate): Promise<void> {
  await api(`/api/project-templates/${template.id}`, { method: "DELETE" });
  await refreshProjectPortfolioMetadata();
  resetProjectTemplateForm();
  showToast("Project template deleted");
}

async function exportProjectPortfolio(projectIds: string[] | null): Promise<void> {
  const file = await apiFile("/api/projects/export", {
    method: "POST",
    body: JSON.stringify(projectIds ? { projectIds } : {}),
    timeoutMs: 30_000,
  });
  downloadBrowserFile(file.blob, file.fileName ?? "spatial-portfolio.json");
  showToast(`${file.fileName ?? "Spatial portfolio"} downloaded`);
}

async function exportNavigationTraversalEvidence(release: Release): Promise<void> {
  const file = await apiFile(
    `/api/releases/${release.id}/navigation-traversal-evidence`,
  );
  downloadBrowserFile(
    file.blob,
    file.fileName ?? `release-${release.release_number}-navigation-evidence.json`,
  );
  if (file.sha256) {
    showNotice(
      `${file.fileName ?? "Traversal evidence"} downloaded. SHA-256 ${file.sha256}`,
      "success",
    );
  } else {
    showNotice(
      `${file.fileName ?? "Traversal evidence"} downloaded without a server digest; do not use it as a qualification receipt.`,
      "warning",
    );
  }
}

function downloadBrowserFile(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function resetPortfolioImport(clearFile = true): void {
  portfolioImportManifest = null;
  portfolioImportPreview = null;
  portfolioImportOperationId = null;
  portfolioImportCommitted = false;
  if (clearFile) byId<HTMLInputElement>("portfolioImportFile").value = "";
  byId<HTMLButtonElement>("previewPortfolioImport").disabled = true;
  byId<HTMLButtonElement>("commitPortfolioImport").disabled = true;
  byId("portfolioImportError").textContent = "";
  byId("portfolioImportPreview").textContent = "Choose an exported portfolio file to begin.";
  byId("portfolioImportPreview").className = "notice-card";
}

function renderPortfolioImportActions(): void {
  const hasFile = Boolean(byId<HTMLInputElement>("portfolioImportFile").files?.length);
  const previewPending = isActionPending("preview-project-import");
  const commitPending = isActionPending("commit-project-import");
  byId<HTMLButtonElement>("previewPortfolioImport").disabled =
    !hasFile || previewPending || commitPending || portfolioImportCommitted;
  byId<HTMLButtonElement>("commitPortfolioImport").disabled =
    !portfolioImportPreview?.valid || previewPending || commitPending || portfolioImportCommitted;
  byId<HTMLInputElement>("portfolioImportFile").disabled = previewPending || commitPending;
}

async function previewProjectPortfolioImport(): Promise<void> {
  const input = byId<HTMLInputElement>("portfolioImportFile");
  const file = input.files?.[0];
  if (!file) throw new Error("Choose a portfolio JSON file first.");
  if (file.size > 1_048_576) throw new Error("Portfolio metadata files must be 1 MiB or smaller.");
  let manifest: unknown;
  try {
    manifest = JSON.parse(await file.text());
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  const preview = await api<PortfolioPreview>("/api/projects/import/preview", {
    method: "POST",
    body: JSON.stringify(manifest),
  });
  portfolioImportManifest = manifest as PortfolioManifest;
  portfolioImportPreview = preview;
  portfolioImportOperationId = crypto.randomUUID();
  portfolioImportCommitted = false;
  renderPortfolioImportPreview(preview);
  renderPortfolioImportActions();
}

function renderPortfolioImportPreview(preview: PortfolioPreview): void {
  const container = byId("portfolioImportPreview");
  container.replaceChildren();
  container.className = `notice-card ${
    !preview.valid ? "error" : preview.warnings.length ? "warning" : "success"
  }`;
  container.append(element(
    "strong",
    "",
    `${preview.summary.projects} DRAFT project${preview.summary.projects === 1 ? "" : "s"} ready · ${preview.summary.customers} customer record${preview.summary.customers === 1 ? "" : "s"}`,
  ));
  if (preview.summary.customFields) {
    container.append(element(
      "p",
      "",
      `${preview.summary.customFields} organisation field${
        preview.summary.customFields === 1 ? "" : "s"
      } · ${preview.summary.fieldsToCreate ?? 0} will be created here.`,
    ));
  }
  for (const warning of preview.warnings) container.append(element("p", "", warning));
  const list = element("ol", "portfolio-import-list");
  for (const project of preview.projects) {
    list.append(element(
      "li",
      "",
      `${project.name} · ${project.captureAdapter} · ${project.deliveryTemplate}${project.nameAlreadyExists ? " · existing name; a new ID will be created" : ""}`,
    ));
  }
  container.append(list);
}

async function commitProjectPortfolioImport(): Promise<void> {
  if (!portfolioImportManifest || !portfolioImportPreview?.valid) {
    throw new Error("Validate a portfolio file before importing it.");
  }
  portfolioImportOperationId ??= crypto.randomUUID();
  const result = await api<{
    importId: string;
    createdCount: number;
    projects: Array<{ id: string; name: string; status: string }>;
  }>("/api/projects/import", {
    method: "POST",
    body: JSON.stringify({
      clientOperationId: portfolioImportOperationId,
      manifest: portfolioImportManifest,
    }),
    timeoutMs: 60_000,
  });
  const completedId = portfolioImportOperationId;
  await refreshAll();
  state.selectedProjectIds = new Set(result.projects.map((project) => project.id));
  renderProjects();
  renderPortfolioTools();
  portfolioImportOperationId = null;
  portfolioImportCommitted = true;
  renderPortfolioImportActions();
  const container = byId("portfolioImportPreview");
  container.className = "notice-card success";
  container.textContent = `${result.createdCount} project${result.createdCount === 1 ? "" : "s"} created as DRAFT. Import ${completedId?.slice(0, 8)} is persisted and safe to retry.`;
  showToast(`${result.createdCount} projects imported`);
}

function eligiblePortfolioHandoffOrganisations(): OrganisationMembership[] {
  return state.organisations.filter((organisation) =>
    organisation.id !== state.user?.organisationId &&
    organisation.role === "platform_admin"
  );
}

function renderPortfolioHandoffTarget(): void {
  const section = byId("portfolioHandoffSection");
  const select = byId<HTMLSelectElement>("portfolioHandoffTarget");
  const eligible = eligiblePortfolioHandoffOrganisations();
  const selected = select.value;
  section.hidden = state.user?.role !== "platform_admin";
  select.replaceChildren(new Option(
    eligible.length
      ? "Choose a destination workspace"
      : "No other administrator workspace is available",
    "",
  ));
  for (const organisation of eligible) {
    select.append(new Option(organisation.name, organisation.id));
  }
  select.value = eligible.some((organisation) => organisation.id === selected)
    ? selected
    : "";
}

function resetPortfolioHandoff(clearTarget = true): void {
  portfolioHandoffOperationId = null;
  portfolioHandoffPreview = null;
  portfolioHandoffCommitted = false;
  if (clearTarget && document.getElementById("portfolioHandoffTarget")) {
    byId<HTMLSelectElement>("portfolioHandoffTarget").value = "";
  }
  if (document.getElementById("portfolioHandoffPreview")) {
    const preview = byId("portfolioHandoffPreview");
    preview.className = "notice-card";
    preview.textContent = "Select projects in the portfolio and choose a destination.";
    byId("portfolioHandoffError").textContent = "";
  }
}

function renderPortfolioHandoffActions(): void {
  const target = byId<HTMLSelectElement>("portfolioHandoffTarget");
  const preview = byId<HTMLButtonElement>("previewPortfolioHandoff");
  const commit = byId<HTMLButtonElement>("commitPortfolioHandoff");
  const selectedCount = state.selectedProjectIds.size;
  const previewPending = isActionPending("preview-portfolio-handoff");
  const commitPending = isActionPending("commit-portfolio-handoff");
  target.disabled = previewPending || commitPending || portfolioHandoffCommitted;
  preview.disabled =
    !target.value ||
    selectedCount === 0 ||
    selectedCount > 50 ||
    previewPending ||
    commitPending ||
    portfolioHandoffCommitted;
  commit.disabled =
    !portfolioHandoffPreview?.valid ||
    previewPending ||
    commitPending ||
    portfolioHandoffCommitted;
}

async function previewProjectPortfolioHandoff(): Promise<void> {
  const targetOrganisationId = byId<HTMLSelectElement>("portfolioHandoffTarget").value;
  const projectIds = [...state.selectedProjectIds].sort();
  if (!targetOrganisationId) throw new Error("Choose a destination workspace.");
  if (!projectIds.length) throw new Error("Select at least one source project.");
  const preview = await api<PortfolioHandoffPreview>(
    "/api/projects/portfolio-handoffs/preview",
    {
      method: "POST",
      body: JSON.stringify({ targetOrganisationId, projectIds }),
    },
  );
  portfolioHandoffPreview = preview;
  portfolioHandoffOperationId = crypto.randomUUID();
  portfolioHandoffCommitted = false;
  renderPortfolioHandoffPreview(preview);
}

function renderPortfolioHandoffPreview(preview: PortfolioHandoffPreview): void {
  const container = byId("portfolioHandoffPreview");
  container.replaceChildren();
  container.className = `notice-card ${preview.valid ? "success" : "error"}`;
  container.append(element(
    "strong",
    "",
    `${preview.summary.projects} DRAFT ${preview.summary.projects === 1 ? "copy" : "copies"} → ${preview.targetOrganisation.name}`,
  ));
  container.append(element(
    "p",
    "",
    `${preview.summary.customFields} field definitions · ${preview.summary.fieldsToCreate} will be created · ${preview.summary.customers} customer records represented.`,
  ));
  if (preview.conflicts.length) {
    const conflicts = element("ul", "portfolio-import-list");
    for (const conflict of preview.conflicts) {
      conflicts.append(element(
        "li",
        "",
        `${conflict.label} (${conflict.key}) conflicts: ${conflict.sourceType} in source, ${conflict.targetType} in destination.`,
      ));
    }
    container.append(conflicts);
  }
  container.append(element("p", "", preview.warning));
  renderPortfolioHandoffActions();
}

async function commitProjectPortfolioHandoff(): Promise<void> {
  if (!portfolioHandoffPreview?.valid) {
    throw new Error("Preview a valid portfolio handoff before committing it.");
  }
  portfolioHandoffOperationId ??= crypto.randomUUID();
  const projectIds = [...state.selectedProjectIds].sort();
  const result = await api<{
    handoffId: string;
    createdCount: number;
    projects: Array<{ id: string; sourceId: string; status: "DRAFT" }>;
    targetOrganisation: { id: string; name: string };
  }>("/api/projects/portfolio-handoffs", {
    method: "POST",
    body: JSON.stringify({
      clientOperationId: portfolioHandoffOperationId,
      targetOrganisationId: portfolioHandoffPreview.targetOrganisation.id,
      projectIds,
    }),
    timeoutMs: 60_000,
  });
  portfolioHandoffCommitted = true;
  const container = byId("portfolioHandoffPreview");
  container.className = "notice-card success";
  container.textContent =
    `${result.createdCount} DRAFT ${result.createdCount === 1 ? "copy" : "copies"} created in ` +
    `${result.targetOrganisation.name}. Source projects and all source assets remain unchanged. ` +
    `Handoff ${result.handoffId.slice(0, 8)} is persisted and safe to retry.`;
  renderPortfolioHandoffActions();
  showToast(`${result.createdCount} projects handed off`);
}

function renderAssetHandoffTarget(): void {
  const section = byId("assetHandoffSection");
  const select = byId<HTMLSelectElement>("assetHandoffTarget");
  const eligible = eligiblePortfolioHandoffOrganisations();
  const selected = select.value;
  section.hidden = state.user?.role !== "platform_admin";
  select.replaceChildren(new Option(
    eligible.length
      ? "Choose a destination workspace"
      : "No other administrator workspace is available",
    "",
  ));
  for (const organisation of eligible) {
    select.append(new Option(organisation.name, organisation.id));
  }
  select.value = eligible.some((organisation) => organisation.id === selected)
    ? selected
    : "";
}

function clearAssetHandoffPoll(): void {
  if (assetHandoffPollTimer !== null) {
    window.clearTimeout(assetHandoffPollTimer);
    assetHandoffPollTimer = null;
  }
}

function resetAssetHandoff(clearTarget = true): void {
  clearAssetHandoffPoll();
  assetHandoffOperationId = null;
  assetHandoffPreview = null;
  activeAssetHandoff = null;
  assetHandoffRetryOperationId = null;
  assetHandoffCancelOperationId = null;
  if (clearTarget && document.getElementById("assetHandoffTarget")) {
    byId<HTMLSelectElement>("assetHandoffTarget").value = "";
  }
  if (document.getElementById("assetHandoffPreview")) {
    const preview = byId("assetHandoffPreview");
    preview.className = "notice-card";
    preview.removeAttribute("aria-busy");
    preview.textContent = "Select exactly one project and choose a destination.";
    byId("assetHandoffProgress").hidden = true;
    byId("assetHandoffProgress").replaceChildren();
    byId("assetHandoffError").textContent = "";
  }
}

function assetHandoffBusy(): boolean {
  return [
    "preview-asset-handoff",
    "commit-asset-handoff",
    "refresh-asset-handoff",
    "retry-asset-handoff",
    "cancel-asset-handoff",
  ].some(isActionPending);
}

function renderAssetHandoffActions(): void {
  const target = byId<HTMLSelectElement>("assetHandoffTarget");
  const preview = byId<HTMLButtonElement>("previewAssetHandoff");
  const commit = byId<HTMLButtonElement>("commitAssetHandoff");
  const refresh = byId<HTMLButtonElement>("refreshAssetHandoff");
  const retry = byId<HTMLButtonElement>("retryAssetHandoff");
  const cancel = byId<HTMLButtonElement>("cancelAssetHandoff");
  const selectedCount = state.selectedProjectIds.size;
  const busy = assetHandoffBusy();
  const terminal = activeAssetHandoff
    ? ["completed", "cancelled"].includes(activeAssetHandoff.status)
    : false;
  target.disabled = busy || Boolean(activeAssetHandoff && !terminal);
  preview.disabled =
    busy ||
    !target.value ||
    selectedCount !== 1 ||
    Boolean(activeAssetHandoff && !terminal);
  commit.disabled =
    busy ||
    !assetHandoffPreview?.valid ||
    Boolean(activeAssetHandoff && !terminal);
  refresh.disabled = busy || !activeAssetHandoff;
  retry.disabled = busy || activeAssetHandoff?.status !== "failed";
  cancel.disabled =
    busy ||
    !activeAssetHandoff ||
    terminal;
}

async function loadRecentAssetHandoff(): Promise<void> {
  if (state.user?.role !== "platform_admin" || state.selectedProjectIds.size !== 1) {
    renderAssetHandoffActions();
    return;
  }
  const projectId = [...state.selectedProjectIds][0]!;
  const preview = byId("assetHandoffPreview");
  preview.className = "notice-card";
  preview.textContent = "Checking this project's recent verified copies…";
  preview.setAttribute("aria-busy", "true");
  try {
    const result = await backgroundActions.run(`load-asset-handoff:${projectId}`, () =>
      api<{ handoffs: AssetHandoff[] }>(
        `/api/projects/asset-handoffs?projectId=${encodeURIComponent(projectId)}`,
      )
    );
    activeAssetHandoff = result.handoffs.find((handoff) =>
      !["completed", "cancelled"].includes(handoff.status)
    ) ?? result.handoffs[0] ?? null;
    if (activeAssetHandoff) {
      const select = byId<HTMLSelectElement>("assetHandoffTarget");
      if ([...select.options].some((option) =>
        option.value === activeAssetHandoff!.targetOrganisationId
      )) {
        select.value = activeAssetHandoff.targetOrganisationId;
      }
      preview.className = "notice-card";
      preview.textContent =
        `Recovered asset copy ${activeAssetHandoff.id.slice(0, 8)} from persisted state.`;
      renderAssetHandoffProgress();
      scheduleAssetHandoffPoll();
    } else {
      preview.textContent = "Select exactly one project and choose a destination.";
    }
  } catch (error) {
    byId("assetHandoffError").textContent =
      error instanceof Error ? error.message : "Recent asset copies could not be loaded.";
    preview.textContent = "Recent copy status is unavailable. You can retry by reopening these tools.";
  } finally {
    preview.removeAttribute("aria-busy");
    renderAssetHandoffActions();
  }
}

async function previewProjectAssetHandoff(): Promise<void> {
  const targetOrganisationId = byId<HTMLSelectElement>("assetHandoffTarget").value;
  const projectIds = [...state.selectedProjectIds];
  if (!targetOrganisationId) throw new Error("Choose a destination workspace.");
  if (projectIds.length !== 1) throw new Error("Select exactly one source project.");
  const preview = await api<AssetHandoffPreview>(
    "/api/projects/asset-handoffs/preview",
    {
      method: "POST",
      body: JSON.stringify({
        targetOrganisationId,
        projectId: projectIds[0],
      }),
    },
  );
  clearAssetHandoffPoll();
  assetHandoffPreview = preview;
  activeAssetHandoff = null;
  assetHandoffOperationId = crypto.randomUUID();
  assetHandoffRetryOperationId = null;
  assetHandoffCancelOperationId = null;
  renderAssetHandoffPreview(preview);
}

function renderAssetHandoffPreview(preview: AssetHandoffPreview): void {
  const container = byId("assetHandoffPreview");
  container.replaceChildren();
  container.className = `notice-card ${preview.valid ? "success" : "error"}`;
  container.append(element(
    "strong",
    "",
    `${preview.project.name} → ${preview.targetOrganisation.name}`,
  ));
  container.append(element(
    "p",
    "",
    `${preview.summary.versions} immutable version${
      preview.summary.versions === 1 ? "" : "s"
    } · ${preview.summary.assets} verified asset${
      preview.summary.assets === 1 ? "" : "s"
    } · ${formatBytes(preview.summary.bytes)}.`,
  ));
  if (preview.conflicts.length) {
    const conflicts = element("ul", "portfolio-import-list");
    for (const conflict of preview.conflicts) {
      conflicts.append(element(
        "li",
        "",
        `${conflict.label} (${conflict.key}) conflicts: ${conflict.sourceType} in source, ${conflict.targetType} in destination.`,
      ));
    }
    container.append(conflicts);
  }
  for (const warning of preview.warnings) {
    container.append(element("p", "", warning));
  }
  container.append(element(
    "small",
    "",
    `Immutable snapshot ${preview.sourceSnapshotHash.slice(0, 12)}…`,
  ));
  renderAssetHandoffActions();
}

async function commitProjectAssetHandoff(): Promise<void> {
  if (!assetHandoffPreview?.valid) {
    throw new Error("Preview a valid asset copy before starting it.");
  }
  assetHandoffOperationId ??= crypto.randomUUID();
  const result = await api<{ handoff: AssetHandoff }>(
    "/api/projects/asset-handoffs",
    {
      method: "POST",
      body: JSON.stringify({
        clientOperationId: assetHandoffOperationId,
        targetOrganisationId: assetHandoffPreview.targetOrganisation.id,
        projectId: assetHandoffPreview.project.id,
        sourceSnapshotHash: assetHandoffPreview.sourceSnapshotHash,
      }),
      timeoutMs: 60_000,
    },
  );
  activeAssetHandoff = result.handoff;
  assetHandoffPreview = null;
  renderAssetHandoffProgress();
  scheduleAssetHandoffPoll();
  showToast("Verified asset copy queued");
}

function renderAssetHandoffProgress(): void {
  const handoff = activeAssetHandoff;
  const container = byId("assetHandoffProgress");
  if (!handoff) {
    container.hidden = true;
    container.replaceChildren();
    renderAssetHandoffActions();
    return;
  }
  container.hidden = false;
  container.replaceChildren();
  const heading = element(
    "strong",
    "",
    `${humanStatus(handoff.status)} · ${handoff.copiedAssets}/${handoff.totalAssets} assets`,
  );
  const summary = element(
    "p",
    "",
    `${formatBytes(handoff.copiedBytes)} of ${formatBytes(handoff.totalBytes)} verified · operation ${handoff.id.slice(0, 8)}`,
  );
  const meter = element("div", "asset-handoff-meter");
  meter.setAttribute("role", "progressbar");
  meter.setAttribute("aria-label", "Asset copy progress");
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "100");
  meter.setAttribute("aria-valuenow", String(handoff.progressPercent));
  meter.style.setProperty("--handoff-progress", `${handoff.progressPercent}%`);
  meter.append(element("span"));
  container.append(heading, summary, meter);
  if (handoff.errorMessage) {
    container.append(element("p", "form-error", handoff.errorMessage));
  }
  const list = element("ul", "asset-handoff-item-list");
  for (const item of handoff.items) {
    const row = element("li");
    row.append(
      element("span", "", `${item.fileName} · ${formatBytes(item.sizeBytes)}`),
      element("span", `status-pill ${item.status.toLowerCase()}`, humanStatus(item.status)),
    );
    if (item.errorMessage) row.title = item.errorMessage;
    list.append(row);
  }
  container.append(list);
  if (handoff.status === "completed") {
    const complete = byId("assetHandoffPreview");
    complete.className = "notice-card success";
    complete.textContent =
      `Verified copy completed as destination project ${handoff.targetProjectId.slice(0, 8)}. ` +
      "Switch workspaces to repeat processing, QA, review, and publication.";
  } else if (handoff.status === "cancelled") {
    const cancelled = byId("assetHandoffPreview");
    cancelled.className = "notice-card";
    cancelled.textContent =
      "Copy cancelled. Destination objects were removed and the source remains unchanged.";
  }
  renderAssetHandoffActions();
}

function scheduleAssetHandoffPoll(): void {
  clearAssetHandoffPoll();
  if (
    !activeAssetHandoff ||
    ["completed", "cancelled", "failed"].includes(activeAssetHandoff.status)
  ) return;
  assetHandoffPollTimer = window.setTimeout(() => {
    assetHandoffPollTimer = null;
    void refreshProjectAssetHandoff(true).catch((error) => {
      byId("assetHandoffError").textContent =
        error instanceof Error ? error.message : "Copy progress could not be refreshed.";
      renderAssetHandoffActions();
      scheduleAssetHandoffPoll();
    });
  }, 3_000);
}

async function refreshProjectAssetHandoff(automatic: boolean): Promise<void> {
  if (!activeAssetHandoff) throw new Error("No asset copy is active.");
  const result = await api<{ handoff: AssetHandoff }>(
    `/api/projects/asset-handoffs/${activeAssetHandoff.id}`,
  );
  activeAssetHandoff = result.handoff;
  // A background poll must never erase an error owned by a deliberate user
  // action. Explicit refreshes and new runAction calls may clear it.
  if (!automatic) byId("assetHandoffError").textContent = "";
  renderAssetHandoffProgress();
  scheduleAssetHandoffPoll();
}

async function retryProjectAssetHandoff(): Promise<void> {
  if (!activeAssetHandoff || activeAssetHandoff.status !== "failed") {
    throw new Error("Only a failed asset copy can be retried.");
  }
  assetHandoffRetryOperationId ??= crypto.randomUUID();
  await api(`/api/projects/asset-handoffs/${activeAssetHandoff.id}/retry`, {
    method: "POST",
    body: JSON.stringify({ clientOperationId: assetHandoffRetryOperationId }),
  });
  assetHandoffRetryOperationId = null;
  await refreshProjectAssetHandoff(false);
  showToast("Failed copy items requeued");
}

async function cancelProjectAssetHandoff(): Promise<void> {
  if (!activeAssetHandoff) throw new Error("No asset copy is active.");
  assetHandoffCancelOperationId ??= crypto.randomUUID();
  const result = await api<{ handoff: AssetHandoff }>(
    `/api/projects/asset-handoffs/${activeAssetHandoff.id}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ clientOperationId: assetHandoffCancelOperationId }),
      timeoutMs: 60_000,
    },
  );
  assetHandoffCancelOperationId = null;
  activeAssetHandoff = result.handoff;
  clearAssetHandoffPoll();
  renderAssetHandoffProgress();
  showToast("Asset copy cancelled and cleaned up");
}

function renderIdentity(): void {
  const anonymousIdentity = authenticationStatus === "checking"
    ? {
      name: "Checking session…",
      role: "Restoring secure workspace",
    }
    : authenticationStatus === "unavailable"
      ? {
        name: "Session check unavailable",
        role: "Check your connection and retry",
      }
      : {
        name: "Sign in required",
        role: "Secure production environment",
      };
  byId("workspaceName").textContent = state.user?.displayName ?? anonymousIdentity.name;
  byId("workspaceRole").textContent = state.user
    ? `${state.user.email} · ${state.user.role}`
    : anonymousIdentity.role;
  byId("signOutButton").hidden = !state.user;
  renderOrganisationSwitcher();
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
    button.hidden = (isReviewer() && button.dataset.section !== "reviews")
      || (button.dataset.section === "team" && state.user?.role !== "platform_admin");
  });
  byId<HTMLButtonElement>("inviteTeamButton").hidden = state.user?.role !== "platform_admin";
  byId<HTMLButtonElement>("addIdentityProviderButton").hidden = state.user?.role !== "platform_admin";
  byId<HTMLButtonElement>("createCaptureAgentButton").hidden = state.user?.role !== "platform_admin";
}

function renderOrganisationSwitcher(): void {
  const container = byId("organisationSwitcher");
  const select = byId<HTMLSelectElement>("organisationSelect");
  const switchButton = byId<HTMLButtonElement>("switchOrganisationButton");
  const currentId = state.user?.organisationId ?? null;
  const previousValue = select.value;
  container.hidden = !state.user || state.organisations.length < 2;
  select.replaceChildren(...state.organisations.map((organisation) => {
    const option = document.createElement("option");
    option.value = organisation.id;
    option.textContent = `${organisation.name} · ${humanStatus(organisation.role)}`;
    return option;
  }));
  const preferredValue = state.organisations.some((organisation) => organisation.id === previousValue)
    ? previousValue
    : currentId;
  if (preferredValue) select.value = preferredValue;
  const pending = isActionPending("switch-organisation");
  select.disabled = pending;
  switchButton.disabled = pending || !select.value || select.value === currentId;
}

async function switchOrganisation(): Promise<void> {
  const organisationId = byId<HTMLSelectElement>("organisationSelect").value;
  if (!organisationId || organisationId === state.user?.organisationId) return;
  const result = await api<{
    user: User;
    organisation: { id: string; name: string; slug: string; role: string };
  }>("/api/auth/organisations/switch", {
    method: "POST",
    body: JSON.stringify({ organisationId }),
  });
  markAuthenticationEstablished();
  clearTenantWorkspace();
  state.user = result.user;
  renderIdentity();
  window.history.replaceState(null, "", "#projects");
  await refreshAll();
  showToast(`Switched to ${result.organisation.name}`);
}

function renderPendingInvitations(): void {
  const panel = byId("pendingInvitationsPanel");
  const list = byId("pendingInvitationList");
  if (!state.user || !state.pendingInvitations.length) {
    panel.hidden = true;
    list.replaceChildren(emptyState("No organisation invitation is awaiting your response."));
    return;
  }
  panel.hidden = false;
  const card = element("article", "workspace-card-large");
  const invitationError = element("p", "form-error");
  invitationError.id = "pendingInvitationError";
  invitationError.setAttribute("role", "alert");
  card.append(
    element("span", "eyebrow", "EXPLICIT CONSENT"),
    element(
      "h3",
      "",
      `${state.pendingInvitations.length} organisation invitation${state.pendingInvitations.length === 1 ? "" : "s"} awaiting your answer`,
    ),
    element(
      "p",
      "muted-copy",
      "Accepting adds the organisation to your workspace switcher without moving you out of the current one. Declining leaves no membership behind and an administrator must issue a new invitation.",
    ),
    invitationError,
  );
  for (const invitation of state.pendingInvitations) {
    const row = element("div", "team-member-row");
    const identity = element("div", "team-member-identity");
    identity.append(
      element("strong", "", invitation.organisationName),
      element("span", "", humanStatus(invitation.role)),
      element(
        "small",
        "",
        `Invited ${relativeTime(invitation.invitedAt)} · expires ${relativeTime(invitation.expiresAt)}`,
      ),
    );
    const status = element("span", "status-pill invited", "Pending");
    const actions = element("div", "team-member-actions");
    const accept = element("button", "primary-button", "Accept");
    const decline = element("button", "quiet-button", "Decline");
    accept.addEventListener("click", () => {
      void runAction({
        key: `team-invitation-accept:${invitation.id}`,
        trigger: accept,
        pendingLabel: "Joining…",
        disable: [decline],
        errorTarget: invitationError,
      }, () => acceptOrganisationInvitation(invitation));
    });
    decline.addEventListener("click", () => {
      if (!confirm(
        `Decline the invitation to ${invitation.organisationName}? An administrator must send a new invitation to restore it.`,
      )) return;
      void runAction({
        key: `team-invitation-decline:${invitation.id}`,
        trigger: decline,
        pendingLabel: "Declining…",
        disable: [accept],
        errorTarget: invitationError,
      }, () => declineOrganisationInvitation(invitation));
    });
    actions.append(accept, decline);
    row.append(identity, status, actions);
    card.append(row);
  }
  list.replaceChildren(card);
}

async function acceptOrganisationInvitation(
  invitation: PendingOrganisationInvitation,
): Promise<void> {
  const result = await api<OrganisationInvitationAnswer>(
    `/api/team/invitations/${invitation.id}/accept`,
    { method: "POST" },
  );
  removePendingInvitation(invitation.id);
  await refreshAll();
  showToast(`Joined ${result.invitation.organisationName}`);
}

async function declineOrganisationInvitation(
  invitation: PendingOrganisationInvitation,
): Promise<void> {
  const result = await api<OrganisationInvitationAnswer>(
    `/api/team/invitations/${invitation.id}/decline`,
    { method: "POST" },
  );
  removePendingInvitation(invitation.id);
  showToast(`Declined the invitation to ${result.invitation.organisationName}`);
}

function removePendingInvitation(invitationId: string): void {
  state.pendingInvitations = state.pendingInvitations.filter(
    (invitation) => invitation.id !== invitationId,
  );
  renderPendingInvitations();
}

function clearTenantWorkspace(): void {
  state.projects = [];
  state.jobs = [];
  state.releases = [];
  state.reviewProjects = [];
  state.reviewDetails = {};
  state.hosting = null;
  state.spatial = null;
  state.spatialProjectId = null;
  state.spatialVersionId = null;
  state.measurement = null;
  state.measurementProjectId = null;
  state.team = null;
  state.identityProviders = [];
  state.captureAgents = [];
  state.recoverableUploads = [];
  state.selected = null;
  state.selectedProjectIds.clear();
  state.projectsNextCursor = null;
  state.projectTemplates = [];
  state.projectTemplatesNextCursor = null;
  state.projectFields = [];
  state.projectViews = [];
  state.projectViewsNextCursor = null;
  state.activeProjectViewId = null;
  state.projectQuery = "";
  state.projectAdapter = "";
  state.projectDelivery = "";
  state.projectSort = "updated_desc";
  state.projectStatuses = [];
  state.jobsNextCursor = null;
  state.releasesNextCursor = null;
  projectViewsInitialised = false;
  resetPortfolioImport();
  resetPortfolioHandoff();
  resetAssetHandoff();
  bulkLifecycleOperation = null;
}

function renderProjects(): void {
  const container = byId("projectTable");
  container.replaceChildren();
  container.setAttribute("role", "table");
  container.setAttribute("aria-label", "Production projects");
  const projects = visibleProjects();
  if (!projects.length) {
    renderBulkProjectActions();
    container.append(emptyState("No projects match this filter."));
    renderProjectPagination();
    return;
  }
  const header = element("div", "project-row header");
  header.setAttribute("role", "row");
  const selectVisible = document.createElement("input");
  selectVisible.type = "checkbox";
  selectVisible.className = "project-select";
  selectVisible.setAttribute("aria-label", "Select all projects shown by this filter");
  const selectedVisibleCount = projects.filter((project) => state.selectedProjectIds.has(project.id)).length;
  selectVisible.checked = selectedVisibleCount === projects.length;
  selectVisible.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < projects.length;
  selectVisible.addEventListener("change", () => {
    for (const project of projects) {
      if (selectVisible.checked) state.selectedProjectIds.add(project.id);
      else state.selectedProjectIds.delete(project.id);
    }
    bulkLifecycleOperation = null;
    renderProjects();
  });
  const selectVisibleCell = element("span", "project-select-cell");
  selectVisibleCell.append(selectVisible);
  header.append(selectVisibleCell);
  ["Project", "Source", "Stage", "Updated"].forEach((label) => header.append(element("span", "", label)));
  for (const cell of header.children) cell.setAttribute("role", "columnheader");
  container.append(header);
  for (const project of projects) {
    const row = element("div", "project-row");
    row.setAttribute("role", "row");
    if (state.selectedProjectIds.has(project.id)) row.classList.add("selected");
    const selected = document.createElement("input");
    selected.type = "checkbox";
    selected.className = "project-select";
    selected.checked = state.selectedProjectIds.has(project.id);
    selected.setAttribute("aria-label", `Select ${project.name}`);
    selected.addEventListener("change", () => {
      if (selected.checked) state.selectedProjectIds.add(project.id);
      else state.selectedProjectIds.delete(project.id);
      bulkLifecycleOperation = null;
      renderProjects();
    });
    const identityCell = element("span", "project-identity-cell");
    const identity = element("button", "project-row-link project-identity");
    identity.setAttribute("aria-label", `Open ${project.name}`);
    const icon = element("b", "project-icon property", project.name.slice(0, 1).toUpperCase());
    const name = element("span");
    name.append(element("strong", "", project.name), element("small", "", project.customerName ?? "Capture project"));
    identity.append(icon, name);
    identityCell.append(identity);
    const stage = element("span");
    stage.append(element("i", `state ${statusClass(project.status)}`), document.createTextNode(humanStatus(project.status)));
    identity.addEventListener("click", () => {
      void runAction({
        key: `select-project:${project.id}`,
        trigger: identity,
        pendingLabel: "Opening…",
      }, () => selectProject(project.id));
    });
    row.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("button, input, a, select, textarea")) return;
      identity.click();
    });
    const selectedCell = element("span", "project-select-cell");
    selectedCell.append(selected);
    row.append(selectedCell, identityCell, element("span", "", project.captureAdapter), stage, element("span", "", relativeTime(project.updatedAt)));
    for (const cell of row.children) cell.setAttribute("role", "cell");
    container.append(row);
  }
  renderBulkProjectActions();
  renderProjectPagination();
}

function renderProjectPagination(): void {
  const pagination = byId("projectPagination");
  pagination.hidden = !state.projectsNextCursor || isReviewer();
  byId("projectPaginationStatus").textContent = state.projectsNextCursor
    ? `${state.projects.length} projects loaded. More projects are available.`
    : "";
}

function bindListContinuation(
  triggerId: string,
  key: string,
  pendingLabel: string,
  task: () => Promise<void>,
): void {
  const trigger = byId<HTMLButtonElement>(triggerId);
  trigger.addEventListener("click", () => {
    void runAction({ key, trigger, pendingLabel }, task);
  });
}

function renderListPagination(
  containerId: string,
  statusId: string,
  cursor: string | null,
  status: string,
): void {
  byId(containerId).hidden = !cursor;
  byId(statusId).textContent = cursor ? status : "";
}

async function loadMoreProjects(): Promise<void> {
  const requestedCursor = state.projectsNextCursor;
  if (!requestedCursor) return;
  const result = await api<{ projects: Project[]; nextCursor: string | null }>(
    `/api/projects?cursor=${encodeURIComponent(requestedCursor)}`,
  );
  if (state.projectsNextCursor !== requestedCursor) return;
  const projects = new Map(state.projects.map((project) => [project.id, project]));
  for (const project of result.projects) projects.set(project.id, project);
  state.projects = [...projects.values()];
  state.projectsNextCursor = result.nextCursor;
  renderProjects();
}

async function loadMoreProjectViews(): Promise<void> {
  const requestedCursor = state.projectViewsNextCursor;
  if (!requestedCursor) return;
  const result = await api<{ views: SavedProjectView[]; nextCursor: string | null }>(
    `/api/project-views?cursor=${encodeURIComponent(requestedCursor)}`,
  );
  if (state.projectViewsNextCursor !== requestedCursor) return;
  state.projectViews = appendUniqueById(state.projectViews, result.views);
  state.projectViewsNextCursor = result.nextCursor;
  renderProjectControls();
}

async function loadMoreProjectTemplates(): Promise<void> {
  const requestedCursor = state.projectTemplatesNextCursor;
  if (!requestedCursor) return;
  const result = await api<{ templates: ProjectTemplate[]; nextCursor: string | null }>(
    `/api/project-templates?cursor=${encodeURIComponent(requestedCursor)}`,
  );
  if (state.projectTemplatesNextCursor !== requestedCursor) return;
  state.projectTemplates = appendUniqueById(state.projectTemplates, result.templates);
  state.projectTemplatesNextCursor = result.nextCursor;
  renderProjectTemplateOptions();
  if (portfolioToolsDialog.open) renderPortfolioTools();
}

async function loadMoreJobs(): Promise<void> {
  const requestedCursor = state.jobsNextCursor;
  if (!requestedCursor) return;
  const result = await api<{ jobs: Job[]; nextCursor: string | null }>(
    `/api/jobs?cursor=${encodeURIComponent(requestedCursor)}`,
  );
  if (state.jobsNextCursor !== requestedCursor) return;
  state.jobs = appendUniqueById(state.jobs, result.jobs);
  state.jobsNextCursor = result.nextCursor;
  renderJobs();
}

async function loadMoreReleases(): Promise<void> {
  const requestedCursor = state.releasesNextCursor;
  if (!requestedCursor) return;
  const result = await api<{ releases: Release[]; nextCursor: string | null }>(
    `/api/releases?cursor=${encodeURIComponent(requestedCursor)}`,
  );
  if (state.releasesNextCursor !== requestedCursor) return;
  state.releases = appendUniqueById(state.releases, result.releases);
  state.releasesNextCursor = result.nextCursor;
  renderReleases();
}

function appendUniqueById<T extends { id: string }>(current: T[], next: T[]): T[] {
  const records = new Map(current.map((record) => [record.id, record]));
  for (const record of next) records.set(record.id, record);
  return [...records.values()];
}

function visibleProjects(): Project[] {
  const query = state.projectQuery.trim().toLowerCase();
  const projects = state.projects.filter((project) => {
    if (!state.projectStatuses.length && project.status === "ARCHIVED") return false;
    if (state.projectStatuses.length && !state.projectStatuses.includes(project.status)) return false;
    if (state.projectAdapter && project.captureAdapter !== state.projectAdapter) return false;
    if (state.projectDelivery && project.deliveryTemplate !== state.projectDelivery) return false;
    if (!query) return true;
    return [
      project.name,
      project.customerName ?? "",
      project.deliveryTemplate,
      project.captureAdapter,
      project.status,
    ].some((value) => value.toLowerCase().includes(query));
  });
  return projects.sort((left, right) => {
    if (state.projectSort === "name_asc") return left.name.localeCompare(right.name);
    if (state.projectSort === "name_desc") return right.name.localeCompare(left.name);
    const time = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
    return state.projectSort === "updated_asc" ? time : -time;
  });
}

function selectedProjectsForAction(action: "archive" | "restore"): Project[] {
  return state.projects.filter((project) =>
    state.selectedProjectIds.has(project.id)
    && (action === "archive" ? project.status !== "ARCHIVED" : project.status === "ARCHIVED")
  );
}

function renderBulkProjectActions(): void {
  const bar = byId("projectBulkBar");
  const selected = state.projects.filter((project) => state.selectedProjectIds.has(project.id));
  bar.hidden = selected.length === 0 || isReviewer();
  byId("projectSelectionCount").textContent =
    `${selected.length} project${selected.length === 1 ? "" : "s"} selected`;
  const archiveCount = selectedProjectsForAction("archive").length;
  const restoreCount = selectedProjectsForAction("restore").length;
  byId("projectSelectionHint").textContent = [
    archiveCount ? `${archiveCount} can be archived` : "",
    restoreCount ? `${restoreCount} can be restored` : "",
  ].filter(Boolean).join(" · ") || "No lifecycle change is available.";
  byId<HTMLButtonElement>("bulkArchiveProjects").disabled =
    archiveCount === 0 || isActionPending("bulk-project-archive") || isActionPending("bulk-project-restore");
  byId<HTMLButtonElement>("bulkRestoreProjects").disabled =
    restoreCount === 0 || isActionPending("bulk-project-archive") || isActionPending("bulk-project-restore");
  byId<HTMLButtonElement>("clearProjectSelection").disabled =
    isActionPending("bulk-project-archive") || isActionPending("bulk-project-restore");
}

function renderJobs(): void {
  const container = byId("jobList");
  container.replaceChildren();
  if (!state.jobs.length) {
    container.append(emptyState("No processing jobs.", true));
    renderJobPagination();
    return;
  }
  const visibleJobs = state.view === "jobs" ? state.jobs : state.jobs.slice(0, 12);
  for (const [index, job] of visibleJobs.entries()) {
    const row = element("div", "queue-item");
    const order = element("span", "queue-order", String(index + 1).padStart(2, "0"));
    const body = element("div");
    body.append(
      element("strong", "", job.job_type),
      element("small", "", `${job.project_name ?? job.project_id} · ${humanStatus(job.state)} · attempt ${job.attempt_count}/${job.max_attempts}`),
    );
    if (job.progress_message) body.append(element("small", "", job.progress_message));
    const jobError = storedJobError(job.error_json);
    if (jobError) body.append(element("small", "job-error", jobError));
    if (job.compute_duration_ms != null) {
      body.append(element(
        "small",
        "",
        `${formatDuration(job.compute_duration_ms)} compute · ${formatBytes(job.input_bytes ?? 0)} in · ${formatBytes(job.output_bytes ?? 0)} out`,
      ));
    }
    const progress = element("div", "mini-progress");
    const bar = element("i");
    bar.style.width = `${job.progress}%`;
    progress.append(bar);
    body.append(progress);
    const actions = element("div", "job-actions");
    if (["FAILED", "DEAD_LETTER", "CANCELLED"].includes(job.state)) {
      const retry = element("button", "job-action", "Retry");
      retry.addEventListener("click", () => {
        if (!confirm(`Retry ${job.job_type} from a clean lease? The prior failure remains in the audit log.`)) return;
        void runAction({
          key: `retry-job:${job.id}`,
          trigger: retry,
          pendingLabel: "Queuing…",
        }, () => retryJob(job));
      });
      actions.append(retry);
    } else if (["QUEUED", "LEASED", "RUNNING"].includes(job.state)) {
      const cancel = element("button", "job-action", "Cancel");
      cancel.addEventListener("click", () => {
        if (!confirm(`Cancel ${job.job_type}? Any leased processor will lose permission to upload or complete it.`)) return;
        void runAction({
          key: `cancel-job:${job.id}`,
          trigger: cancel,
          pendingLabel: "Cancelling…",
        }, () => cancelJob(job));
      });
      actions.append(cancel);
    } else {
      actions.append(element(
        "span",
        `status-pill ${statusClass(job.state)}`,
        humanStatus(job.state),
      ));
    }
    row.append(order, body, actions);
    container.append(row);
  }
  renderJobPagination();
}

function renderJobPagination(): void {
  renderListPagination(
    "jobPagination",
    "jobPaginationStatus",
    state.view === "jobs" ? state.jobsNextCursor : null,
    `${state.jobs.length} jobs loaded. More jobs are available.`,
  );
}

function renderReleases(): void {
  const container = byId("releaseList");
  container.replaceChildren();
  if (!state.releases.length) {
    container.append(emptyState("No release history yet. Approve a version, then publish its first channel."));
    renderReleasePagination();
    return;
  }
  const header = element("div", "release-list-row header");
  header.setAttribute("role", "row");
  ["Project", "Channel", "Policy", "Published", "State", ""].forEach((label) =>
    header.append(element("span", "", label))
  );
  for (const cell of header.children) cell.setAttribute("role", "columnheader");
  container.setAttribute("role", "table");
  container.setAttribute("aria-label", "Published release history");
  container.append(header);
  for (const release of state.releases) {
    const row = element("div", "release-list-row");
    row.setAttribute("role", "row");
    const project = element("span");
    project.append(
      element("strong", "", release.project_name ?? "Project"),
      element("small", "", `Scene v${release.version_number} · Release ${release.release_number}`),
    );
    const channel = document.createElement("a");
    channel.href = `/s/${release.slug}`;
    channel.target = "_blank";
    channel.rel = "noopener";
    channel.textContent = `/s/${release.slug}`;
    const stateLabel = release.revoked_at
      ? "Revoked"
      : release.is_active
        ? "Active"
        : "Historical";
    const actions = element("span", "release-actions");
    if (release.project_id) {
      const manage = element("button", "quiet-button", "Manage");
      manage.addEventListener("click", () => {
        void runAction({
          key: `select-project:${release.project_id}`,
          trigger: manage,
          pendingLabel: "Opening…",
        }, () => selectProject(release.project_id!));
      });
      actions.append(manage);
    }
    const exportEvidence = element("button", "quiet-button", "Export traversal evidence");
    exportEvidence.addEventListener("click", () => {
      void runAction({
        key: `export-navigation-evidence:${release.id}`,
        trigger: exportEvidence,
        pendingLabel: "Exporting…",
      }, () => exportNavigationTraversalEvidence(release));
    });
    actions.append(exportEvidence);
    if (release.is_active && !release.revoked_at) {
      const revoke = element("button", "danger-button", "Revoke");
      revoke.addEventListener("click", async () => {
        const confirmed = await confirmPublicationDecision({
          title: `Revoke /s/${release.slug}?`,
          message: "Visitors will lose access immediately. The immutable release remains in history.",
          confirmLabel: "Revoke release",
          danger: true,
        });
        if (!confirmed) return;
        await runAction({
          key: `revoke-release:${release.slug}`,
          trigger: revoke,
          pendingLabel: "Revoking…",
        }, () => revokeRelease(release.slug));
      });
      actions.append(revoke);
    } else if (!release.revoked_at) {
      const rollback = element("button", "quiet-button", "Make active");
      rollback.addEventListener("click", async () => {
        const confirmed = await confirmPublicationDecision({
          title: `Make /s/${release.slug} active?`,
          message: "This historical release will replace the currently active release on the channel.",
          confirmLabel: "Make active",
        });
        if (!confirmed) return;
        await runAction({
          key: `rollback-release:${release.id}`,
          trigger: rollback,
          pendingLabel: "Activating…",
        }, () => rollbackRelease(release));
      });
      actions.append(rollback);
    }
    row.append(
      project,
      channel,
      element("span", "", release.access_policy),
      element("span", "", relativeTime(release.published_at)),
      element("span", `release-state ${stateLabel.toLowerCase()}`, stateLabel),
      actions,
    );
    for (const cell of row.children) cell.setAttribute("role", "cell");
    container.append(row);
  }
  renderReleasePagination();
}

function renderReleasePagination(): void {
  renderListPagination(
    "releasePagination",
    "releasePaginationStatus",
    state.releasesNextCursor,
    `${state.releases.length} releases loaded. More releases are available.`,
  );
}

function renderReviews(): void {
  const container = byId("reviewInbox");
  container.replaceChildren();
  if (!state.reviewProjects.length) {
    container.append(emptyState(isReviewer()
      ? "No project has been shared with this account."
      : "No active projects are available for client review."));
    return;
  }
  for (const project of state.reviewProjects) {
    const card = element("article", "workspace-card-large");
    const heading = element("div", "workspace-card-heading");
    const title = element("div");
    title.append(
      element("span", "eyebrow", project.role.replaceAll("_", " ").toUpperCase()),
      element("h3", "", project.name),
    );
    heading.append(title, element("span", "status-pill", humanStatus(project.status)));
    const metadata = element(
      "p",
      "muted-copy",
      project.latest_version_number
        ? `Latest immutable version: v${project.latest_version_number}`
        : "No immutable version is ready yet.",
    );
    const actions = element("div", "workspace-actions");
    const inspect = element("button", "quiet-button", state.reviewDetails[project.id] ? "Refresh activity" : "Open activity");
    inspect.addEventListener("click", () => {
      void runAction({
        key: `load-review:${project.id}`,
        trigger: inspect,
        pendingLabel: "Loading…",
      }, () => loadReviewDetail(project));
    });
    actions.append(inspect);
    if (project.release_slug) {
      const reviewScene = document.createElement("a");
      reviewScene.className = "primary-button";
      reviewScene.href = `/review/${project.release_slug}`;
      reviewScene.textContent = isReviewer() ? "Review in scene" : "Open review link";
      actions.append(reviewScene);
    }
    if (!isReviewer()) {
      const invite = element("button", "quiet-button", "Invite reviewer");
      invite.addEventListener("click", () => openReviewerDialog(project.id));
      actions.append(invite);
    }
    card.append(heading, metadata, actions);
    const detail = state.reviewDetails[project.id];
    if (detail) card.append(renderReviewActivity(project, detail));
    container.append(card);
  }
}

function renderReviewActivity(project: ReviewProject, detail: ReviewDetail): HTMLElement {
  const activity = element("div", "review-activity");
  const openComments = detail.comments.filter((comment) => comment.status === "open");
  const summary = element("div", "review-summary");
  summary.append(
    projectFact("Open feedback", String(openComments.length)),
    projectFact("Decisions", String(detail.decisions.length)),
    projectFact("Reviewers", String(detail.reviewers?.filter((reviewer) => !reviewer.revoked_at).length ?? "Scoped")),
  );
  activity.append(summary);
  if ((detail.versions?.length ?? 0) >= 2) {
    const compare = element("button", "quiet-button", "Compare immutable versions");
    compare.addEventListener("click", () => compareDomain.openVersionComparison(project.id, detail.versions ?? []));
    activity.append(compare);
  }
  if (!openComments.length && !detail.decisions.length) {
    activity.append(element("p", "muted-copy", "No review activity has been recorded."));
  }
  for (const comment of detail.comments.slice(0, 12)) {
    const row = element("div", "review-line");
    const copy = element("div");
    copy.append(
      element("strong", "", `${humanStatus(comment.kind)} · ${humanStatus(comment.status)}`),
      element("p", "", comment.body),
      element("small", "", `${comment.author_name ?? comment.author_email ?? "Reviewer"} · ${relativeTime(comment.created_at)}`),
    );
    row.append(copy);
    if (!isReviewer() && comment.status === "open") {
      const actions = element("span", "release-actions");
      for (const status of ["resolved", "dismissed"] as const) {
        const button = element("button", status === "resolved" ? "quiet-button" : "danger-button", status === "resolved" ? "Resolve" : "Dismiss");
        button.addEventListener("click", () => {
          void runAction({
            key: `${status}-comment:${comment.id}`,
            trigger: button,
            pendingLabel: status === "resolved" ? "Resolving…" : "Dismissing…",
            disable: Array.from(actions.querySelectorAll("button")),
          }, () => resolveReviewComment(project, comment.id, status));
        });
        actions.append(button);
      }
      row.append(actions);
    }
    activity.append(row);
  }
  for (const decision of detail.decisions.slice(0, 8)) {
    activity.append(element(
      "div",
      `decision-line ${decision.decision}`,
      `${decision.decision === "approved" ? "Approved" : "Changes requested"} | ${decision.reviewer_name ?? decision.reviewer_email ?? "Reviewer"}${decision.note ? `: ${decision.note}` : ""}`,
    ));
  }
  if (!isReviewer() && detail.reviewers?.length) {
    for (const reviewer of detail.reviewers) {
      const row = element("div", "review-line");
      row.append(element("div", "", `${reviewer.email} · ${humanStatus(reviewer.role)} · ${humanStatus(reviewer.invitation_status)}`));
      if (!reviewer.revoked_at && reviewer.invitation_status !== "revoked") {
        const revoke = element("button", "danger-button", "Revoke access");
        revoke.addEventListener("click", () => {
          if (!confirm(`Revoke ${reviewer.email} from ${project.name}?`)) return;
          void runAction({
            key: `revoke-reviewer:${reviewer.user_id}`,
            trigger: revoke,
            pendingLabel: "Revoking…",
          }, () => revokeReviewer(project, reviewer));
        });
        row.append(revoke);
      }
      activity.append(row);
    }
  }
  return activity;
}

function renderHosting(): void {
  const container = byId("hostingOverview");
  container.replaceChildren();
  if (!state.hosting) {
    container.append(emptyState("Hosting information is unavailable."));
    return;
  }
  const plans = element("article", "workspace-card-large");
  plans.append(
    element("span", "eyebrow", "AVAILABLE PLANS"),
    element("h3", "", "Productised recurring hosting"),
    element(
      "p",
      "muted-copy",
      "Hosting is merchant billed. An open invoice never grants access; only a platform administrator can record verified payment and activate the service period.",
    ),
  );
  const planGrid = element("div", "plan-grid");
  for (const plan of state.hosting.plans) {
    const card = element("div", "plan-card");
    card.append(
      element("strong", "", plan.name),
      element("b", "", plan.monthly_price_cents ? `${formatMoney(plan.monthly_price_cents, "MYR")} / mo` : "Custom"),
      element("small", "", `${formatBytes(plan.included_storage_bytes)} storage · ${formatBytes(plan.included_delivery_bytes)} delivery`),
    );
    planGrid.append(card);
  }
  plans.append(planGrid);

  const subscriptions = element("article", "workspace-card-large");
  subscriptions.append(element("span", "eyebrow", "ACTIVE SERVICES"), element("h3", "", "Project subscriptions"));
  if (!state.hosting.subscriptions.length) subscriptions.append(element("p", "muted-copy", "No hosting subscription configured."));
  for (const subscription of state.hosting.subscriptions) {
    const row = element("div", "hosting-row");
    const copy = element("div");
    const usage = subscription.included_storage_bytes > 0
      ? `${Math.min(100, (subscription.storage_bytes / subscription.included_storage_bytes) * 100).toFixed(1)}% storage`
      : `${formatBytes(subscription.storage_bytes)} storage`;
    copy.append(
      element("strong", "", subscription.project_name),
      element("small", "", `${subscription.plan_name} · ${humanStatus(subscription.status)} · ${usage} · through ${parseTimestamp(subscription.current_period_end).toLocaleDateString()}`),
    );
    const actions = element("span", "release-actions");
    const manage = element("button", "quiet-button", "Manage");
    manage.addEventListener("click", () => {
      void runAction({
        key: `select-project:${subscription.project_id}`,
        trigger: manage,
        pendingLabel: "Opening…",
      }, async () => {
        await selectProject(subscription.project_id, false);
        await openDeliveryDialog();
      });
    });
    actions.append(manage);
    if (
      state.hosting.manualBillingEnabled &&
      subscription.payment_provider === "manual" &&
      ["active", "past_due"].includes(subscription.status)
    ) {
      const controls = manualSubscriptionControls(subscription);
      actions.append(controls);
    }
    if (
      subscription.status !== "cancelled" &&
      subscription.payment_provider === "stripe" &&
      subscription.provider_subscription_id &&
      !subscription.provider_cancel_at_period_end
    ) {
      const cancel = element("button", "danger-button", "Cancel at period end");
      cancel.addEventListener("click", () => {
        if (!confirm(`Cancel Stripe renewal for ${subscription.project_name} at the end of the paid period?`)) return;
        void runAction({
          key: `cancel-hosting:${subscription.project_id}`,
          trigger: cancel,
          pendingLabel: "Contacting Stripe…",
        }, () => cancelHosting(subscription.project_id));
      });
      actions.append(cancel);
    }
    row.append(copy, actions);
    subscriptions.append(row);
  }

  const finance = element("article", "workspace-card-large");
  finance.append(element("span", "eyebrow", "BILLING & ALERTS"), element("h3", "", "Invoice and recovery ledger"));
  for (const invoice of state.hosting.invoices.slice(0, 8)) {
    const row = element("div", "hosting-row billing-invoice-row");
    const copy = element("div");
    copy.append(
      element("strong", "", `${invoice.project_name} · ${formatMoney(invoice.amount_cents, invoice.currency)}`),
      element(
        "small",
        "",
        `${humanStatus(invoice.status)} · due ${parseTimestamp(invoice.due_at).toLocaleDateString()} · ${humanStatus(invoice.billing_method)}${
          invoice.external_reference ? ` · ${invoice.external_reference}` : ""
        }`,
      ),
    );
    if (invoice.payment_reference) {
      copy.append(element("small", "billing-payment-reference", `Payment: ${invoice.payment_reference}`));
    }
    row.append(copy);
    if (
      state.hosting.manualBillingEnabled &&
      invoice.billing_method === "manual" &&
      invoice.status === "open"
    ) {
      row.append(manualInvoiceControls(invoice));
    }
    finance.append(row);
  }
  for (const checkout of state.hosting.checkouts.slice(0, 8)) {
    const row = element("div", "hosting-row");
    const copy = element("div");
    copy.append(
      element("strong", "", `${checkout.project_name} · ${humanStatus(checkout.plan_code)}`),
      element("small", "", `${formatMoney(checkout.amount_cents, checkout.currency)} · Checkout ${humanStatus(checkout.status)}${checkout.payment_status ? ` · ${humanStatus(checkout.payment_status)}` : ""}`),
    );
    row.append(copy);
    if (
      checkout.checkout_url &&
      ["pending", "open"].includes(checkout.status) &&
      (!checkout.expires_at || Date.parse(checkout.expires_at) > Date.now())
    ) {
      const resume = element("a", "quiet-button", "Resume secure checkout");
      resume.href = checkout.checkout_url;
      resume.rel = "noopener";
      row.append(resume);
    }
    if (checkout.last_error) row.append(element("p", "form-error", checkout.last_error));
    finance.append(row);
  }
  for (const alert of state.hosting.alerts.slice(0, 8)) {
    finance.append(element("div", "alert-line", `${humanStatus(alert.kind)} | ${alert.label}${alert.detail ? `: ${alert.detail}` : ""}`));
  }
  if (!state.hosting.invoices.length && !state.hosting.alerts.length && !state.hosting.checkouts.length) {
    finance.append(element("p", "muted-copy", "No invoices or operational alerts."));
  }

  const lifecycle = element("article", "workspace-card-large");
  lifecycle.append(
    element("span", "eyebrow", "ENFORCED LIFECYCLE"),
    element("h3", "", "Expiry, retention, and restore evidence"),
    element("p", "muted-copy", "The hourly Worker trigger expires access, archives lapsed projects, applies legal-hold-aware R2 retention, and records every action."),
  );
  const lifecycleActions = element("div", "release-actions");
  const runNow = element("button", "quiet-button", "Run enforcement now");
  runNow.addEventListener("click", () => {
    void runAction({
      key: "run-lifecycle-enforcement",
      trigger: runNow,
      pendingLabel: "Enforcing…",
    }, runLifecycleNow);
  });
  const restoreDrill = element("button", "quiet-button", "Verify retained asset");
  restoreDrill.disabled = !state.selected?.project;
  restoreDrill.title = state.selected?.project
    ? `Read a retained object for ${state.selected.project.name}`
    : "Open a project first";
  restoreDrill.addEventListener("click", () => {
    void runAction({
      key: `restore-drill:${state.selected?.project.id ?? "none"}`,
      trigger: restoreDrill,
      pendingLabel: "Verifying…",
    }, runRestoreDrill);
  });
  lifecycleActions.append(runNow, restoreDrill);
  lifecycle.append(lifecycleActions);
  if (!state.hosting.lifecycleRuns.length) {
    lifecycle.append(element("p", "muted-copy", "No lifecycle run has produced actions for this organisation yet."));
  }
  for (const run of state.hosting.lifecycleRuns.slice(0, 6)) {
    const summary = readLifecycleSummary(run.summary_json);
    lifecycle.append(element(
      "div",
      "hosting-row",
      `${humanStatus(run.trigger_type)} · ${humanStatus(run.status)} · ${run.action_count} audited action${run.action_count === 1 ? "" : "s"} · ${summary}`,
    ));
  }
  const manualBilling = renderManualBillingPanel();
  container.append(plans, manualBilling, subscriptions, finance, lifecycle);
}

function renderManualBillingPanel(): HTMLElement {
  const card = element("article", "workspace-card-large manual-billing-card");
  const hosting = state.hosting;
  card.append(
    element("span", "eyebrow", "MERCHANT BILLING"),
    element("h3", "", "Issue and reconcile invoices"),
  );
  if (!hosting?.manualBillingEnabled) {
    card.append(element(
      "p",
      "muted-copy",
      "Invoice management is restricted to platform administrators. Production operators can inspect the ledger but cannot change financial state.",
    ));
    return card;
  }
  card.append(element(
    "p",
    "muted-copy",
    "Create an open invoice for bank transfer or another offline collection method. Hosting remains past due until the payment reference is verified and recorded.",
  ));
  const form = document.createElement("form");
  form.className = "manual-billing-form";
  const project = document.createElement("select");
  project.name = "projectId";
  project.required = true;
  project.append(new Option("Choose a project", ""));
  for (const item of state.projects.filter((candidate) => candidate.status !== "ARCHIVED")) {
    project.append(new Option(item.name, item.id));
  }
  const plan = document.createElement("select");
  plan.name = "planCode";
  plan.required = true;
  for (const item of hosting.plans) plan.append(new Option(item.name, item.code));
  const amount = document.createElement("input");
  amount.name = "amount";
  amount.type = "number";
  amount.required = true;
  amount.min = "0";
  amount.max = "1000000";
  amount.step = "0.01";
  const setDefaultAmount = () => {
    const selected = hosting.plans.find((candidate) => candidate.code === plan.value);
    amount.value = selected ? (selected.monthly_price_cents / 100).toFixed(2) : "";
  };
  plan.addEventListener("change", setDefaultAmount);
  setDefaultAmount();
  const currency = document.createElement("input");
  currency.name = "currency";
  currency.required = true;
  currency.maxLength = 3;
  currency.pattern = "[A-Za-z]{3}";
  currency.value = "MYR";
  const periodStart = document.createElement("input");
  periodStart.name = "periodStart";
  periodStart.type = "date";
  periodStart.required = true;
  periodStart.value = dateInputValue(new Date());
  const periodEndDate = new Date();
  periodEndDate.setMonth(periodEndDate.getMonth() + 1);
  const periodEnd = document.createElement("input");
  periodEnd.name = "periodEnd";
  periodEnd.type = "date";
  periodEnd.required = true;
  periodEnd.value = dateInputValue(periodEndDate);
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 7);
  const dueAt = document.createElement("input");
  dueAt.name = "dueAt";
  dueAt.type = "date";
  dueAt.required = true;
  dueAt.value = dateInputValue(dueDate);
  const reference = document.createElement("input");
  reference.name = "externalReference";
  reference.maxLength = 120;
  reference.placeholder = "INV-2026-001";
  const note = document.createElement("textarea");
  note.name = "note";
  note.maxLength = 1000;
  note.rows = 3;
  note.placeholder = "Payment instructions or internal collection note";
  form.append(
    billingField("Project", project),
    billingField("Plan", plan),
    billingField("Amount", amount),
    billingField("Currency", currency),
    billingField("Period starts", periodStart),
    billingField("Period ends", periodEnd),
    billingField("Due date", dueAt),
    billingField("Invoice reference", reference),
    billingField("Collection note", note, true),
  );
  const archive = document.createElement("input");
  archive.type = "checkbox";
  archive.name = "archiveOnExpiry";
  archive.checked = true;
  const archiveLabel = element("label", "checkbox-row");
  archiveLabel.append(archive, element("span", "", "Archive the project if the paid service period expires"));
  const error = element("p", "form-error");
  error.setAttribute("role", "alert");
  const submit = element("button", "primary-button", "Issue open invoice");
  submit.type = "button";
  const actions = element("div", "form-actions");
  actions.append(submit);
  form.append(archiveLabel, error, actions);
  submit.addEventListener("click", () => {
    if (!form.reportValidity()) return;
    form.dataset.clientOperationId ||= crypto.randomUUID();
    const clientOperationId = form.dataset.clientOperationId;
    const snapshot = new FormData(form);
    void runAction({
      key: `manual-invoice-issue:${clientOperationId}`,
      trigger: submit,
      form,
      pendingLabel: "Issuing invoice…",
      errorTarget: error,
    }, async () => {
      await issueManualInvoice(snapshot, clientOperationId);
      delete form.dataset.clientOperationId;
      reference.value = "";
      note.value = "";
    });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.click();
  });
  card.append(form);
  return card;
}

function billingField(
  labelText: string,
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  wide = false,
): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = wide ? "billing-field billing-field-wide" : "billing-field";
  label.append(element("span", "", labelText), control);
  return label;
}

function manualInvoiceControls(invoice: HostingWorkspace["invoices"][number]): HTMLElement {
  const form = document.createElement("form");
  form.className = "manual-ledger-controls";
  const paymentReference = document.createElement("input");
  paymentReference.name = "paymentReference";
  paymentReference.required = true;
  paymentReference.maxLength = 160;
  paymentReference.placeholder = "Bank or receipt reference";
  paymentReference.setAttribute("aria-label", `Payment reference for ${invoice.project_name}`);
  const error = element("p", "form-error");
  error.setAttribute("role", "alert");
  const paid = element("button", "quiet-button", "Mark paid");
  paid.type = "button";
  const voidInvoice = element("button", "danger-button", "Void");
  voidInvoice.type = "button";
  paid.addEventListener("click", () => {
    if (!form.reportValidity()) return;
    form.dataset.paidOperationId ||= crypto.randomUUID();
    const clientOperationId = form.dataset.paidOperationId;
    const snapshot = new FormData(form);
    void runAction({
      key: `manual-invoice-paid:${invoice.id}:${clientOperationId}`,
      trigger: paid,
      form,
      pendingLabel: "Recording payment…",
      errorTarget: error,
    }, async () => {
      await transitionManualInvoice(
        invoice.id,
        "paid",
        String(snapshot.get("paymentReference") ?? ""),
        "Payment verified by platform administrator.",
        clientOperationId,
      );
      delete form.dataset.paidOperationId;
    });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    paid.click();
  });
  voidInvoice.addEventListener("click", () => {
    if (!confirm(`Void the open invoice for ${invoice.project_name}? This does not activate hosting.`)) return;
    voidInvoice.dataset.operationId ||= crypto.randomUUID();
    void runAction({
      key: `manual-invoice-void:${invoice.id}:${voidInvoice.dataset.operationId}`,
      trigger: voidInvoice,
      form,
      pendingLabel: "Voiding…",
      errorTarget: error,
    }, async () => {
      await transitionManualInvoice(
        invoice.id,
        "void",
        null,
        "Voided by platform administrator.",
        voidInvoice.dataset.operationId!,
      );
      delete voidInvoice.dataset.operationId;
    });
  });
  const actions = element("div", "release-actions");
  actions.append(paid, voidInvoice);
  form.append(paymentReference, actions, error);
  return form;
}

function manualSubscriptionControls(subscription: HostingSubscription): HTMLElement {
  const wrapper = document.createElement("details");
  wrapper.className = "manual-subscription-controls";
  const summary = document.createElement("summary");
  summary.textContent = "Billing controls";
  const form = document.createElement("form");
  const note = document.createElement("input");
  note.required = true;
  note.maxLength = 1000;
  note.placeholder = "Required reason";
  note.setAttribute("aria-label", `Billing state reason for ${subscription.project_name}`);
  const error = element("p", "form-error");
  error.setAttribute("role", "alert");
  const actions = element("div", "release-actions");
  const statuses: Array<{ status: "past_due" | "cancelled" | "expired"; label: string }> = [];
  if (subscription.status === "active") statuses.push({ status: "past_due", label: "Mark past due" });
  statuses.push({ status: "cancelled", label: "Cancel now" }, { status: "expired", label: "Expire now" });
  for (const item of statuses) {
    const button = element("button", item.status === "past_due" ? "quiet-button" : "danger-button", item.label);
    button.type = "button";
    button.addEventListener("click", () => {
      if (!form.reportValidity()) return;
      if (
        ["cancelled", "expired"].includes(item.status) &&
        !confirm(`${item.label} for ${subscription.project_name}? Public hosting access will stop.`)
      ) return;
      button.dataset.operationId ||= crypto.randomUUID();
      const clientOperationId = button.dataset.operationId;
      const reason = note.value;
      void runAction({
        key: `manual-subscription-${item.status}:${subscription.id}:${clientOperationId}`,
        trigger: button,
        form,
        pendingLabel: "Updating…",
        errorTarget: error,
      }, async () => {
        await transitionManualSubscription(
          subscription.id,
          item.status,
          reason,
          clientOperationId,
        );
        delete button.dataset.operationId;
      });
    });
    actions.append(button);
  }
  form.append(note, actions, error);
  wrapper.append(summary, form);
  return wrapper;
}

function dateInputValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function billingDateTime(value: FormDataEntryValue | null, field: string): string {
  const parsed = new Date(String(value ?? ""));
  if (!Number.isFinite(parsed.valueOf())) throw new Error(`${field} is not a valid date.`);
  return parsed.toISOString();
}

async function issueManualInvoice(form: FormData, clientOperationId: string): Promise<void> {
  const amount = Number(form.get("amount"));
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid non-negative invoice amount.");
  await api("/api/admin/billing/invoices", {
    method: "POST",
    body: JSON.stringify({
      clientOperationId,
      projectId: String(form.get("projectId") ?? ""),
      planCode: String(form.get("planCode") ?? ""),
      amountCents: Math.round(amount * 100),
      currency: String(form.get("currency") ?? "MYR").toUpperCase(),
      periodStart: billingDateTime(form.get("periodStart"), "Period start"),
      periodEnd: billingDateTime(form.get("periodEnd"), "Period end"),
      dueAt: billingDateTime(form.get("dueAt"), "Due date"),
      archiveOnExpiry: form.get("archiveOnExpiry") === "on",
      externalReference: String(form.get("externalReference") ?? "").trim() || null,
      note: String(form.get("note") ?? "").trim() || null,
    }),
  });
  showToast("Open invoice issued; hosting remains inactive until payment is verified");
  await refreshAll();
}

async function transitionManualInvoice(
  invoiceId: string,
  status: "paid" | "void",
  paymentReference: string | null,
  note: string,
  clientOperationId: string,
): Promise<void> {
  await api(`/api/admin/billing/invoices/${invoiceId}/transition`, {
    method: "POST",
    body: JSON.stringify({
      clientOperationId,
      status,
      paymentReference,
      note,
    }),
  });
  showToast(status === "paid" ? "Payment recorded and hosting activated" : "Invoice voided");
  await refreshAll();
}

async function transitionManualSubscription(
  subscriptionId: string,
  status: "past_due" | "cancelled" | "expired",
  note: string,
  clientOperationId: string,
): Promise<void> {
  await api(`/api/admin/billing/subscriptions/${subscriptionId}/transition`, {
    method: "POST",
    body: JSON.stringify({
      clientOperationId,
      status,
      note,
    }),
  });
  showToast(`Hosting subscription marked ${humanStatus(status)}`);
  await refreshAll();
}

function renderTeam(): void {
  const container = byId("teamOverview");
  container.replaceChildren();
  if (state.user?.role !== "platform_admin") {
    container.append(emptyState("Platform administrator access is required."));
    return;
  }
  if (!state.team) {
    container.append(emptyState("Team membership could not be loaded. Use Refresh to retry."));
    return;
  }

  const identityProviders = element("article", "workspace-card-large identity-provider-card");
  const identityError = element("p", "form-error");
  identityError.id = "identityProviderWorkspaceError";
  identityError.setAttribute("role", "alert");
  identityProviders.append(
    element("span", "eyebrow", "ENTERPRISE OIDC"),
    element("h3", "", `${state.identityProviders.length} configured identity provider${state.identityProviders.length === 1 ? "" : "s"}`),
    element(
      "p",
      "muted-copy",
      "Providers remain drafts until their Worker secret exists and live discovery proves authorization-code, PKCE S256, and supported signed ID tokens. Disabling a provider immediately revokes every session issued through it.",
    ),
    identityError,
  );
  if (!state.identityProviders.length) {
    identityProviders.append(emptyState("No enterprise identity provider is configured. Email OTP remains available."));
  }
  for (const provider of state.identityProviders) {
    const row = element("div", "team-member-row");
    const copy = element("div", "team-member-identity");
    const readiness = provider.secretConfigured ? "secret configured" : "secret required";
    copy.append(
      element("strong", "", provider.name),
      element("span", "", provider.issuer),
      element(
        "small",
        "",
        `${provider.emailDomains.join(", ")} · ${readiness} · ${
          provider.discoveryCheckedAt ? `checked ${relativeTime(provider.discoveryCheckedAt)}` : "discovery not checked"
        }`,
      ),
      element("code", "identity-provider-reference", `Secret reference: ${provider.id}`),
    );
    if (provider.lastError) {
      copy.append(element("small", "provider-error-copy", provider.lastError));
    }
    const status = element("span", `status-pill ${provider.status}`, humanStatus(provider.status));
    const actions = element("div", "team-member-actions");
    if (provider.status !== "active") {
      const activate = element(
        "button",
        "quiet-button",
        provider.status === "disabled" ? "Re-activate" : "Activate",
      );
      activate.title = provider.secretConfigured
        ? "Run live OIDC discovery and activate this provider."
        : `Configure OIDC_CLIENT_SECRETS for key ${provider.id} before activation.`;
      activate.addEventListener("click", () => {
        void runAction({
          key: `identity-provider-activate:${provider.id}`,
          trigger: activate,
          pendingLabel: "Checking provider…",
          errorTarget: identityError,
        }, () => activateIdentityProvider(provider));
      });
      actions.append(activate);
    } else {
      const disable = element("button", "danger-button", "Disable");
      disable.addEventListener("click", () => {
        if (!confirm(`Disable ${provider.name} and revoke every session issued through it?`)) return;
        void runAction({
          key: `identity-provider-disable:${provider.id}`,
          trigger: disable,
          pendingLabel: "Disabling…",
          errorTarget: identityError,
        }, () => disableIdentityProvider(provider));
      });
      actions.append(disable);
    }
    if (provider.status !== "active") {
      const remove = element("button", "text-button", "Delete");
      remove.addEventListener("click", () => {
        if (!confirm(`Delete the ${provider.name} draft? Providers with linked identities cannot be deleted.`)) return;
        void runAction({
          key: `identity-provider-delete:${provider.id}`,
          trigger: remove,
          pendingLabel: "Deleting…",
          errorTarget: identityError,
        }, () => deleteIdentityProvider(provider));
      });
      actions.append(remove);
    }
    row.append(copy, status, actions);
    identityProviders.append(row);
  }

  const captureAgents = element("article", "workspace-card-large capture-agent-card");
  const captureAgentWorkspaceError = element("p", "form-error");
  captureAgentWorkspaceError.id = "captureAgentWorkspaceError";
  captureAgentWorkspaceError.setAttribute("role", "alert");
  const activeCaptureAgents = state.captureAgents.filter((credential) => credential.status === "active").length;
  captureAgents.append(
    element("span", "eyebrow", "SCOPED TRANSFER CREDENTIALS"),
    element(
      "h3",
      "",
      `${activeCaptureAgents} active capture agent${activeCaptureAgents === 1 ? "" : "s"}`,
    ),
    element(
      "p",
      "muted-copy",
      "Each workstation receives one short-lived, project-scoped bearer token. Rotation invalidates the prior token immediately; revocation stops new parts and completion without deleting preserved source evidence.",
    ),
    captureAgentWorkspaceError,
  );
  if (!state.captureAgents.length) {
    captureAgents.append(emptyState("No unattended transfer credential has been issued."));
  }
  for (const credential of state.captureAgents) {
    const row = element("div", `team-member-row ${credential.status}`);
    const identity = element("div", "team-member-identity");
    const projectNames = credential.projectIds.map((projectId) => (
      state.projects.find((project) => project.id === projectId)?.name ?? `Unavailable project ${projectId.slice(0, 8)}`
    ));
    identity.append(
      element("strong", "", credential.name),
      element(
        "span",
        "",
        projectNames.length
          ? projectNames.join(" · ")
          : "No project assignments",
      ),
      element(
        "small",
        "",
        `Generation ${credential.generation} · expires ${relativeTime(credential.expiresAt)} · ${
          credential.lastUsedAt
            ? `last used ${relativeTime(credential.lastUsedAt)}${credential.lastUsedIp ? ` from ${credential.lastUsedIp}` : ""}`
            : "never used"
        }`,
      ),
    );
    const status = element("span", `status-pill ${credential.status}`, humanStatus(credential.status));
    const actions = element("div", "team-member-actions");
    if (credential.status !== "revoked") {
      const edit = element("button", "quiet-button", "Edit scope");
      edit.addEventListener("click", () => openCaptureAgentDialog("edit", credential));
      const rotate = element("button", "quiet-button", "Rotate token");
      rotate.addEventListener("click", () => openCaptureAgentDialog("rotate", credential));
      const revoke = element("button", "danger-button", "Revoke");
      revoke.addEventListener("click", () => {
        if (!confirm(
          `Revoke ${credential.name}? The current token will stop working immediately and cannot be restored.`,
        )) return;
        void runAction({
          key: `capture-agent-revoke:${credential.id}`,
          trigger: revoke,
          pendingLabel: "Revoking…",
          disable: [edit, rotate],
          errorTarget: captureAgentWorkspaceError,
        }, () => revokeCaptureAgent(credential));
      });
      actions.append(edit, rotate, revoke);
    } else {
      actions.append(element("small", "current-member-label", `Revoked ${relativeTime(credential.revokedAt ?? credential.updatedAt)}`));
    }
    row.append(identity, status, actions);
    captureAgents.append(row);
  }

  const members = element("article", "workspace-card-large team-members-card");
  const activeCount = state.team.members.filter((member) => member.status === "active").length;
  members.append(
    element("span", "eyebrow", "LEAST-PRIVILEGE MEMBERSHIP"),
    element("h3", "", `${activeCount} active team member${activeCount === 1 ? "" : "s"}`),
    element("p", "muted-copy", "Role changes and revocations terminate every active session for that member. A new OTP sign-in is required after any role change."),
  );
  if (!state.team.members.length) members.append(emptyState("No production team members found."));
  for (const member of state.team.members) {
    const row = element("div", `team-member-row ${member.status}`);
    const identity = element("div", "team-member-identity");
    identity.append(
      element("strong", "", member.displayName),
      element("span", "", member.email),
      element(
        "small",
        "",
        `${humanStatus(member.status)} · ${humanStatus(member.role)} · ${
          member.lastActiveAt ? `last active ${relativeTime(member.lastActiveAt)}` : "no active session"
        }`,
      ),
    );
    const status = element("span", `status-pill ${member.status}`, humanStatus(member.status));
    const actions = element("div", "team-member-actions");
    if (member.userId === state.user?.userId) {
      actions.append(element("small", "current-member-label", "Current session"));
    } else if (member.status === "revoked") {
      const reinvite = element("button", "quiet-button", "Re-invite");
      reinvite.addEventListener("click", () => openTeamInvitation(member.email, member.role));
      actions.append(reinvite);
    } else {
      const role = document.createElement("select");
      role.className = "compact-select";
      role.setAttribute("aria-label", `Role for ${member.email}`);
      role.append(
        new Option("Production operator", "production_operator"),
        new Option("Platform administrator", "platform_admin"),
      );
      role.value = member.role;
      const save = element("button", "quiet-button", "Save role");
      save.disabled = true;
      role.addEventListener("change", () => {
        save.disabled = role.value === member.role;
      });
      save.addEventListener("click", () => {
        void runAction({
          key: `team-role:${member.userId}`,
          trigger: save,
          pendingLabel: "Saving role…",
          disable: [role],
        }, () => changeTeamRole(member, role.value as TeamMember["role"]));
      });
      const revoke = element("button", "danger-button", "Revoke");
      revoke.addEventListener("click", () => {
        if (!confirm(`Revoke all Spatial Studio access for ${member.email}? Active sessions will stop immediately.`)) return;
        void runAction({
          key: `team-revoke:${member.userId}`,
          trigger: revoke,
          pendingLabel: "Revoking…",
          disable: [role, save],
        }, () => revokeTeamMember(member));
      });
      actions.append(role, save, revoke);
    }
    row.append(identity, status, actions);
    members.append(row);
  }

  const invitations = element("article", "workspace-card-large");
  invitations.append(
    element("span", "eyebrow", "INVITATION LEDGER"),
    element("h3", "", "Recent invitation lifecycle"),
  );
  if (!state.team.invitations.length) {
    invitations.append(element("p", "muted-copy", "No team invitations have been issued."));
  }
  for (const invitation of state.team.invitations) {
    const row = element("div", "hosting-row");
    const copy = element("div");
    copy.append(
      element("strong", "", invitation.email),
      element(
        "small",
        "",
        `${humanStatus(invitation.role)} · ${humanStatus(invitation.status)} · ${
          invitation.status === "pending"
            ? `expires ${relativeTime(invitation.expiresAt)}`
            : invitation.acceptedAt
              ? `accepted ${relativeTime(invitation.acceptedAt)}`
              : `issued ${relativeTime(invitation.invitedAt)}`
        } · ${invitation.sendCount} email attempt${invitation.sendCount === 1 ? "" : "s"}`,
      ),
    );
    row.append(copy);
    if (invitation.status === "pending") {
      const resend = element("button", "quiet-button", "Resend");
      resend.addEventListener("click", () => {
        void runAction({
          key: `team-resend:${invitation.id}`,
          trigger: resend,
          pendingLabel: "Resending…",
        }, () => resendTeamInvitation(invitation));
      });
      row.append(resend);
    }
    invitations.append(row);
  }
  container.append(identityProviders, captureAgents, members, invitations);
}

function openCaptureAgentDialog(
  mode: "create" | "edit" | "rotate",
  credential?: CaptureAgentCredential,
): void {
  const form = byId<HTMLFormElement>("captureAgentForm");
  form.reset();
  const modeInput = form.elements.namedItem("mode") as HTMLInputElement;
  const credentialIdInput = form.elements.namedItem("credentialId") as HTMLInputElement;
  const nameInput = form.elements.namedItem("name") as HTMLInputElement;
  const expiresInput = form.elements.namedItem("expiresInDays") as HTMLSelectElement;
  const nameField = byId<HTMLElement>("captureAgentNameField");
  const expiryField = byId<HTMLElement>("captureAgentExpiryField");
  const projectField = byId<HTMLElement>("captureAgentProjectField");
  modeInput.value = mode;
  credentialIdInput.value = credential?.id ?? "";
  nameInput.value = credential?.name ?? "";
  nameField.hidden = mode === "rotate";
  nameInput.required = mode !== "rotate";
  expiryField.hidden = mode === "edit";
  expiresInput.disabled = mode === "edit";
  projectField.hidden = mode === "rotate";
  captureAgentOperationId = mode === "edit" ? null : crypto.randomUUID();
  byId("captureAgentError").textContent = "";
  if (mode === "create") {
    byId("captureAgentTitle").textContent = "Create a scoped transfer credential.";
    byId("captureAgentDescription").textContent =
      "Assign only the projects this workstation may upload. The token is returned once and never stored in plaintext.";
    byId("captureAgentSubmit").textContent = "Create scoped token";
  } else if (mode === "edit" && credential) {
    byId("captureAgentTitle").textContent = "Change workstation scope.";
    byId("captureAgentDescription").textContent =
      "Project removals take effect on the next API request. The current token and expiry remain unchanged.";
    byId("captureAgentSubmit").textContent = "Save project scope";
  } else if (credential) {
    byId("captureAgentTitle").textContent = "Rotate this transfer token.";
    byId("captureAgentDescription").textContent =
      "Issuing the next generation invalidates the current token immediately. Store the replacement before closing the next dialog.";
    byId("captureAgentSubmit").textContent = "Rotate and issue token";
  }
  renderCaptureAgentProjectChoices(credential?.projectIds ?? []);
  captureAgentDialog.showModal();
}

function renderCaptureAgentProjectChoices(selectedProjectIds: string[]): void {
  const container = byId("captureAgentProjectChoices");
  container.replaceChildren();
  const selected = new Set(selectedProjectIds);
  const projects = [...state.projects].sort((left, right) => left.name.localeCompare(right.name));
  if (!projects.length) {
    container.append(emptyState("Create a project before issuing a capture-agent credential."));
    return;
  }
  for (const project of projects) {
    const label = document.createElement("label");
    label.className = "capture-agent-project-choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = project.id;
    input.dataset.captureAgentProjectId = project.id;
    input.checked = selected.has(project.id);
    const copy = document.createElement("span");
    copy.append(
      element("strong", "", project.name),
      element("small", "", `${humanStatus(project.status)} · ${humanStatus(project.captureAdapter)}`),
    );
    label.append(input, copy);
    container.append(label);
  }
}

async function saveCaptureAgent(form: FormData): Promise<void> {
  const mode = String(form.get("mode") ?? "create");
  const credentialId = String(form.get("credentialId") ?? "");
  const projectIds = [...document.querySelectorAll<HTMLInputElement>(
    "#captureAgentProjectChoices [data-capture-agent-project-id]:checked",
  )].map((input) => input.value).sort();
  if (mode !== "rotate" && !projectIds.length) {
    throw new Error("Assign at least one project to this capture agent.");
  }
  let result: { credential: CaptureAgentCredential; token?: string };
  if (mode === "edit") {
    if (!credentialId) throw new Error("Capture-agent credential is missing. Refresh and retry.");
    result = await api<{ credential: CaptureAgentCredential }>(
      `/api/capture-agents/${encodeURIComponent(credentialId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          projectIds,
        }),
      },
    );
  } else if (mode === "rotate") {
    if (!credentialId) throw new Error("Capture-agent credential is missing. Refresh and retry.");
    captureAgentOperationId ??= crypto.randomUUID();
    result = await api<{ credential: CaptureAgentCredential; token: string }>(
      `/api/capture-agents/${encodeURIComponent(credentialId)}/rotate`,
      {
        method: "POST",
        body: JSON.stringify({
          clientOperationId: captureAgentOperationId,
          expiresInDays: Number(form.get("expiresInDays") ?? 90),
        }),
      },
    );
  } else {
    captureAgentOperationId ??= crypto.randomUUID();
    result = await api<{ credential: CaptureAgentCredential; token: string }>(
      "/api/capture-agents",
      {
        method: "POST",
        body: JSON.stringify({
          clientOperationId: captureAgentOperationId,
          name: String(form.get("name") ?? ""),
          expiresInDays: Number(form.get("expiresInDays") ?? 90),
          projectIds,
        }),
      },
    );
  }
  const index = state.captureAgents.findIndex((credential) => credential.id === result.credential.id);
  if (index >= 0) state.captureAgents[index] = result.credential;
  else state.captureAgents.unshift(result.credential);
  renderTeam();
  captureAgentDialog.close();
  if (result.token) {
    showIssuedCaptureAgentToken(result.credential, result.token, mode === "rotate");
  } else {
    showToast("Capture-agent scope updated");
  }
}

function showIssuedCaptureAgentToken(
  credential: CaptureAgentCredential,
  token: string,
  rotated: boolean,
): void {
  byId("captureAgentTokenTitle").textContent = rotated
    ? `Replacement token for ${credential.name}`
    : `Store the token for ${credential.name}`;
  byId<HTMLTextAreaElement>("captureAgentTokenValue").value = token;
  byId("captureAgentTokenError").textContent = "";
  captureAgentTokenDialog.showModal();
}

async function copyIssuedCaptureAgentToken(): Promise<void> {
  const value = byId<HTMLTextAreaElement>("captureAgentTokenValue").value;
  if (!value) throw new Error("This token is no longer available. Rotate the credential to issue another.");
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable. Select and copy the token manually before closing this dialog.");
  }
  await navigator.clipboard.writeText(value);
  showToast("Capture-agent token copied");
}

async function revokeCaptureAgent(credential: CaptureAgentCredential): Promise<void> {
  await api<void>(`/api/capture-agents/${encodeURIComponent(credential.id)}`, {
    method: "DELETE",
  });
  const current = state.captureAgents.find((candidate) => candidate.id === credential.id);
  if (current) {
    current.status = "revoked";
    current.revokedAt = new Date().toISOString();
    current.updatedAt = current.revokedAt;
  }
  renderTeam();
  showToast(`${credential.name} revoked`);
}

function openIdentityProviderDialog(): void {
  const form = byId<HTMLFormElement>("identityProviderForm");
  form.reset();
  byId("identityProviderError").textContent = "";
  identityProviderDialog.showModal();
}

async function createIdentityProvider(form: FormData): Promise<void> {
  const emailDomains = String(form.get("emailDomains") ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  const result = await api<{
    provider: EnterpriseIdentityProvider;
    secretReference: string;
    nextStep: string;
  }>("/api/team/identity-providers", {
    method: "POST",
    body: JSON.stringify({
      name: String(form.get("name") ?? ""),
      issuer: String(form.get("issuer") ?? ""),
      clientId: String(form.get("clientId") ?? ""),
      emailDomains,
    }),
  });
  identityProviderDialog.close();
  showNotice(
    `Draft created. Store its client secret under OIDC_CLIENT_SECRETS key ${result.secretReference}, then activate it from Team.`,
    "warning",
  );
  await refreshAll();
  activateView("team");
}

async function activateIdentityProvider(provider: EnterpriseIdentityProvider): Promise<void> {
  await api(`/api/team/identity-providers/${encodeURIComponent(provider.id)}/activate`, {
    method: "POST",
  });
  showToast(`${provider.name} is active`);
  await refreshAll();
  activateView("team");
}

async function disableIdentityProvider(provider: EnterpriseIdentityProvider): Promise<void> {
  await api(`/api/team/identity-providers/${encodeURIComponent(provider.id)}/disable`, {
    method: "POST",
  });
  showToast(`${provider.name} disabled and its sessions revoked`);
  await refreshAll();
  activateView("team");
}

async function deleteIdentityProvider(provider: EnterpriseIdentityProvider): Promise<void> {
  await api(`/api/team/identity-providers/${encodeURIComponent(provider.id)}`, {
    method: "DELETE",
  });
  showToast(`${provider.name} deleted`);
  await refreshAll();
  activateView("team");
}

function openTeamInvitation(
  email = "",
  role: TeamMember["role"] = "production_operator",
): void {
  teamInvitationOperationId = crypto.randomUUID();
  const form = byId<HTMLFormElement>("teamInvitationForm");
  form.reset();
  const emailField = form.elements.namedItem("email");
  const roleField = form.elements.namedItem("role");
  if (emailField instanceof HTMLInputElement) emailField.value = email;
  if (roleField instanceof HTMLSelectElement) roleField.value = role;
  byId("teamInvitationError").textContent = "";
  teamInvitationDialog.showModal();
}

async function inviteTeamMember(form: FormData): Promise<void> {
  teamInvitationOperationId ??= crypto.randomUUID();
  await api("/api/team/invitations", {
    method: "POST",
    body: JSON.stringify({
      clientOperationId: teamInvitationOperationId,
      email: String(form.get("email") ?? ""),
      role: String(form.get("role") ?? "production_operator"),
      expiresInDays: Number(form.get("expiresInDays") ?? 7),
    }),
  });
  teamInvitationOperationId = null;
  teamInvitationDialog.close();
  showToast("Secure team invitation sent");
  await refreshAll();
  activateView("team");
}

async function changeTeamRole(member: TeamMember, role: TeamMember["role"]): Promise<void> {
  await api(`/api/team/members/${member.userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
  showToast(`Role updated for ${member.email}`);
  await refreshAll();
  activateView("team");
}

async function revokeTeamMember(member: TeamMember): Promise<void> {
  await api(`/api/team/members/${member.userId}`, { method: "DELETE" });
  showToast(`Access revoked for ${member.email}`);
  await refreshAll();
  activateView("team");
}

async function resendTeamInvitation(invitation: TeamInvitation): Promise<void> {
  await api(`/api/team/invitations/${invitation.id}/resend`, { method: "POST" });
  showToast(`Invitation resent to ${invitation.email}`);
  await refreshAll();
  activateView("team");
}

function readLifecycleSummary(value: string): string {
  try {
    const summary = JSON.parse(value) as Record<string, unknown>;
    const entries = Object.entries(summary)
      .filter(([, count]) => typeof count === "number" && count > 0)
      .slice(0, 3)
      .map(([label, count]) => `${humanStatus(label)} ${String(count)}`);
    return entries.join(" · ") || "no destructive action";
  } catch {
    return "summary unavailable";
  }
}

async function runLifecycleNow(): Promise<void> {
  const result = await api<{ summary: Record<string, number> }>("/api/hosting/lifecycle/run", { method: "POST" });
  const actionCount = Object.entries(result.summary)
    .filter(([key]) => key !== "notificationsSent" && key !== "notificationFailures")
    .reduce((total, [, count]) => total + count, 0);
  showToast(actionCount ? `${actionCount} lifecycle actions completed` : "Lifecycle is already current");
  await refreshAll();
}

async function runRestoreDrill(): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before running a restore drill.");
  const result = await api<{ sampledBytes: number }>(
    `/api/projects/${project.id}/retention/restore-drill`,
    { method: "POST" },
  );
  showToast(`Restore path verified with ${formatBytes(result.sampledBytes)} read from R2`);
  await refreshAll();
}

async function loadReviewDetail(project: ReviewProject): Promise<void> {
  try {
    state.reviewDetails[project.id] = await api<ReviewDetail>(
      isReviewer() ? `/api/review/projects/${project.id}` : `/api/projects/${project.id}/reviews`,
    );
    renderReviews();
  } catch (error) {
    showNotice(errorMessage(error), "error");
    throw error;
  }
}

async function resolveReviewComment(project: ReviewProject, commentId: string, status: "resolved" | "dismissed"): Promise<void> {
  await api(`/api/projects/${project.id}/reviews/comments/${commentId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  showToast(status === "resolved" ? "Feedback resolved" : "Feedback dismissed");
  await loadReviewDetail(project);
}

async function revokeReviewer(project: ReviewProject, reviewer: Reviewer): Promise<void> {
  await api(`/api/projects/${project.id}/reviewers/${reviewer.user_id}`, { method: "DELETE" });
  showToast("Reviewer access revoked");
  await loadReviewDetail(project);
}

function renderSpatial(): void {
  const container = byId("spatialOverview");
  container.replaceChildren();
  const project = state.selected?.project;
  const spatial = state.spatial;
  if (!project) {
    container.append(emptyState("Open a project from Projects before authoring its spatial structure."));
    return;
  }
  if (!spatial?.version) {
    container.append(emptyState("Upload and process an immutable scene version before authoring semantics."));
    return;
  }
  const versionControl = element(
    "article",
    state.projectSection === "walk"
      ? "workspace-card-large spatial-version-control spatial-version-strip"
      : "workspace-card-large spatial-version-control",
  );
  const versionSelect = document.createElement("select");
  versionSelect.setAttribute("aria-label", "Spatial version");
  for (const version of state.selected?.versions ?? []) {
    const hasCollision = (state.selected?.assets ?? []).some((asset) =>
      asset.version_id === version.id &&
      asset.kind === "collision" &&
      asset.integrity_status === "verified" &&
      Boolean(asset.sha256)
    );
    versionSelect.append(new Option(
      `v${version.version_number} · ${humanStatus(version.status)}${hasCollision ? " · verified collision" : ""}`,
      version.id,
    ));
  }
  versionSelect.value = spatial.version.id;
  versionSelect.addEventListener("change", () => {
    const versionId = versionSelect.value;
    versionSelect.disabled = true;
    container.setAttribute("aria-busy", "true");
    void loadSpatialWorkspace(project.id, versionId).catch((error) => {
      showNotice(errorMessage(error), "error");
      versionSelect.disabled = false;
      container.removeAttribute("aria-busy");
    });
  });
  versionControl.append(
    element("span", "eyebrow", "IMMUTABLE AUTHORING TARGET"),
    element("h3", "", "Choose the visual version to author"),
    element(
      "p",
      "muted-copy",
      "Collision, rooms, routes, and navigation builds remain bound to this exact immutable scene version.",
    ),
    versionSelect,
  );
  container.append(versionControl);
  if (state.projectSection === "structure") {
    container.append(renderSceneAuthoringWorkspace(project, spatial));
  }
  const hierarchy = element("article", "workspace-card-large");
  hierarchy.append(
    element("span", "eyebrow", `VERSION ${spatial.version.version_number}`),
    element("h3", "", "Place structure"),
    element("p", "muted-copy", "These semantics stay independent from scanner and Gaussian format."),
  );
  const grouped = new Map<string, SpatialEntity[]>();
  for (const entity of spatial.entities) {
    const list = grouped.get(entity.kind) ?? [];
    list.push(entity);
    grouped.set(entity.kind, list);
  }
  for (const kind of ["floor", "room", "doorway", "poi"] as const) {
    const group = element("div", "semantic-group");
    group.append(element("strong", "", `${humanStatus(kind)}s · ${grouped.get(kind)?.length ?? 0}`));
    for (const entity of grouped.get(kind) ?? []) {
      const row = element("div", "semantic-row");
      row.append(element("span", "", entity.label));
      const edit = element("button", "quiet-button", "Edit");
      edit.addEventListener("click", () => openSpatialEntityDialog(entity));
      const remove = element("button", "danger-button", "Archive");
      remove.addEventListener("click", () => {
        if (!confirm(`Archive ${entity.label}? Routes using it may need revision.`)) return;
        void runAction({
          key: `archive-entity:${entity.id}`,
          trigger: remove,
          pendingLabel: "Archiving…",
        }, () => archiveSpatialEntity(entity.id));
      });
      row.append(edit, remove);
      group.append(row);
    }
    hierarchy.append(group);
  }
  const obstacleGroup = element("div", "semantic-group");
  obstacleGroup.append(element(
    "strong",
    "",
    `Navigation obstacles · ${spatial.navigationObstacles.length}`,
  ));
  for (const obstacle of spatial.navigationObstacles) {
    const row = element("div", "semantic-row");
    row.append(element("span", "", obstacle.label));
    const remove = element("button", "danger-button", "Archive");
    remove.addEventListener("click", () => {
      if (!confirm(`Archive navigation obstacle ${obstacle.label}?`)) return;
      void runAction({
        key: `archive-navigation-obstacle:${obstacle.id}`,
        trigger: remove,
        pendingLabel: "Archiving…",
      }, () => archiveNavigationObstacle(obstacle.id));
    });
    row.append(remove);
    obstacleGroup.append(row);
  }
  hierarchy.append(obstacleGroup);
  const add = element("button", "primary-button wide", "Add structure or navigation obstacle");
  add.addEventListener("click", () => openSpatialEntityDialog(null));
  hierarchy.append(add);

  const semanticExtraction = element("article", "workspace-card-large semantic-extraction-card");
  semanticExtraction.append(
    element("span", "eyebrow", "POINT-CLOUD SEMANTICS"),
    element("h3", "", "Machine candidates, human-authored structure"),
    element(
      "p",
      "muted-copy",
      "A leased processor normalizes a verified PLY through reviewed source-to-world evidence, then proposes bounded walkable polygons. Nothing enters the scene hierarchy until an operator accepts specific candidates.",
    ),
  );
  const eligibleSemanticAssets = semanticExtractionAssets();
  const extractionRuns = spatial.semanticExtractions ?? [];
  if (!extractionRuns.length) {
    semanticExtraction.append(
      element("p", "muted-copy", "No point-cloud semantic extraction has been queued for this version."),
    );
  }
  for (const extraction of extractionRuns.slice(0, 8)) {
    const card = element("section", "semantic-extraction-run");
    const heading = element("div", "semantic-extraction-heading");
    heading.append(
      element("strong", "", extraction.input_file_name),
      element(
        "span",
        `status-pill ${statusClass(extraction.status)}`,
        humanStatus(extraction.status),
      ),
    );
    const summary = parseSemanticExtractionSummary(extraction.summary_json);
    const extractionUnit = semanticExtractionWorldUnit(extraction);
    const linearUnit = worldUnitSymbol(extractionUnit);
    const summaryText = summary
      ? `${summary.candidateCount} candidate${summary.candidateCount === 1 ? "" : "s"} · ${summary.totalCandidateArea.toFixed(2)} ${linearUnit}² proxy area · inferred elevation ${summary.inferredFloorElevation.toFixed(2)} ${linearUnit}`
      : `${extraction.candidate_count} candidate${extraction.candidate_count === 1 ? "" : "s"} · ${humanStatus(extraction.job_state)}`;
    card.append(
      heading,
      element("small", "muted-copy", `${summaryText} · queued ${parseTimestamp(extraction.created_at).toLocaleString()}`),
    );
    if (extraction.job_progress_message) {
      card.append(element("p", "inline-status", extraction.job_progress_message));
    }
    if (extraction.status === "FAILED") {
      card.append(
        element("p", "form-error", processingJobError(extraction.job_error_json)),
      );
    }
    const actions = element("div", "semantic-extraction-actions");
    if (extraction.status === "READY_FOR_REVIEW") {
      const review = element("button", "primary-button", "Review candidates");
      review.addEventListener("click", () => openSemanticReviewDialog(extraction.id));
      actions.append(review);
    }
    if (
      extraction.status === "QUEUED" ||
      extraction.status === "PROCESSING"
    ) {
      const cancel = element("button", "danger-button", "Cancel extraction");
      cancel.addEventListener("click", () => {
        if (!confirm("Cancel this semantic extraction job? Its verified source asset will be retained.")) return;
        void runAction({
          key: `cancel-semantic-extraction:${extraction.job_id}`,
          trigger: cancel,
          pendingLabel: "Cancelling…",
        }, () => cancelSemanticExtraction(extraction.job_id));
      });
      actions.append(cancel);
    }
    if (
      extraction.status === "FAILED" &&
      (extraction.job_state === "FAILED" || extraction.job_state === "DEAD_LETTER")
    ) {
      const retry = element("button", "quiet-button", "Retry extraction");
      retry.addEventListener("click", () => {
        void runAction({
          key: `retry-semantic-extraction:${extraction.job_id}`,
          trigger: retry,
          pendingLabel: "Queueing retry…",
        }, () => retrySemanticExtraction(extraction.job_id));
      });
      actions.append(retry);
    }
    if (extraction.status === "REVIEWED") {
      card.append(
        element(
          "p",
          "field-note",
          extraction.review_decision === "accept_selected"
            ? "Human review accepted selected polygons as editable room seeds."
            : "Human review rejected every machine candidate.",
        ),
      );
    }
    if (actions.childElementCount) card.append(actions);
    semanticExtraction.append(card);
  }
  const extractionActions = element("div", "semantic-extraction-actions");
  const queueExtraction = element(
    "button",
    "primary-button",
    extractionRuns.length ? "Queue another extraction" : "Propose walkable regions",
  );
  queueExtraction.disabled = eligibleSemanticAssets.length === 0;
  queueExtraction.title = eligibleSemanticAssets.length
    ? ""
    : "Upload and verify a source, master, or point-cloud PLY on this immutable version first.";
  queueExtraction.addEventListener("click", openSemanticExtractionDialog);
  const refreshExtractions = element("button", "quiet-button", "Refresh status");
  refreshExtractions.addEventListener("click", () => {
    void runAction({
      key: `refresh-semantic-extractions:${project.id}`,
      trigger: refreshExtractions,
      pendingLabel: "Refreshing…",
      disable: [queueExtraction],
    }, () => loadSpatialWorkspace(project.id));
  });
  extractionActions.append(queueExtraction, refreshExtractions);
  semanticExtraction.append(
    extractionActions,
    element(
      "small",
      "field-note",
      eligibleSemanticAssets.length
        ? `${eligibleSemanticAssets.length} verified PLY asset${eligibleSemanticAssets.length === 1 ? "" : "s"} can be inspected. Accepted polygons remain editable and explicitly non-certified.`
        : "A verified PLY source is required. Candidate extraction cannot run from a visual-only splat derivative.",
    ),
  );

  const routes = element("article", "workspace-card-large");
  routes.append(
    element("span", "eyebrow", "GUIDED NAVIGATION"),
    element("h3", "", "Routes and movement runtime"),
    projectFact("Collision regions", String(spatial.collisionProxy.boxes.length)),
    projectFact("Navigation triangles", String(Math.floor(spatial.navigationMesh.indices.length / 3))),
    projectFact("Navigation obstacles", String(spatial.obstacleProxy.boxes.length)),
    projectFact(
      "Navigation radius",
      `${spatial.navigationProfile.agentRadius.toFixed(2)} ${
        worldUnitSymbol(spatial.navigationProfile.worldUnit)
      } radius`,
    ),
    projectFact(
      "World scale",
      spatial.navigationProfile.worldUnit === "scene_units"
        ? "Provisional scene units"
        : "Metric metres",
    ),
  );
  if (!spatial.routes.length) routes.append(element("p", "muted-copy", "No guided route yet."));
  for (const route of spatial.routes) {
    const stopCount = spatial.routeStops.filter((stop) => stop.route_id === route.id).length;
    routes.append(element("div", "hosting-row", `${route.label} · ${humanStatus(route.accessibility)} · ${stopCount} stops`));
  }
  const addRoute = element("button", "quiet-button wide", "Create guided route");
  addRoute.disabled = spatial.entities.length === 0;
  addRoute.addEventListener("click", openRouteDialog);
  const tuneNavigation = element("button", "quiet-button wide", "Walking profile");
  tuneNavigation.addEventListener("click", openNavigationProfileDialog);
  const authorTraversal = element("button", "quiet-button wide", "Author vertical traversal");
  authorTraversal.addEventListener("click", () => openNavigationTraversalDialog());
  const buildNavigation = element("button", "primary-button wide", "Build verified navigation");
  const collisionAssets = navigationCollisionAssets();
  buildNavigation.disabled = collisionAssets.length === 0;
  buildNavigation.title = collisionAssets.length
    ? "Build Detour route topology, replay capsule routes, then validate every v7 room anchor and reviewed wall with Rapier sphere sweeps."
    : "Upload a verified collision GLB on this immutable version first.";
  buildNavigation.addEventListener("click", openNavigationBuildDialog);
  const navigationActions = element("div", "navigation-authoring-actions");
  navigationActions.append(addRoute, tuneNavigation, authorTraversal, buildNavigation);
  routes.append(navigationActions);

  const navigationTraversals = spatial.navigationTraversals ?? [];
  if (navigationTraversals.length) {
    const traversalList = element("div", "navigation-build-history");
    traversalList.append(element(
      "p",
      "field-note",
      `${navigationTraversals.length} reviewed discontinuity ${
        navigationTraversals.length === 1 ? "is" : "are"
      } frozen into the next verified build.`,
    ));
    for (const traversal of navigationTraversals) {
      const row = element("div", "semantic-row navigation-build-row");
      row.append(element(
        "span",
        "",
        `${humanStatus(traversal.traversal_kind)} · ${traversal.label}`,
      ));
      const actions = element("div", "navigation-build-actions");
      const edit = element("button", "quiet-button", "Edit");
      edit.addEventListener("click", () => openNavigationTraversalDialog(traversal));
      const archive = element("button", "danger-button", "Archive");
      archive.addEventListener("click", () => {
        void runAction({
          key: `archive-navigation-traversal:${traversal.id}`,
          trigger: archive,
          pendingLabel: "Archiving…",
        }, () => archiveNavigationTraversal(traversal.id));
      });
      actions.append(edit, archive);
      row.append(actions);
      const evidence = document.createElement("details");
      evidence.className = "navigation-evidence-details";
      evidence.append(element("summary", "", "Inspect path and immutable receipt"));
      try {
        const path = JSON.parse(traversal.path_json) as unknown;
        evidence.append(element("pre", "navigation-evidence-json", JSON.stringify({
          path,
          speedUnitsPerSecond: traversal.speed_units_per_second,
          bidirectional: traversal.bidirectional === 1,
          reviewedPurpose: traversal.reviewed_purpose,
          evidence: {
            assetId: traversal.evidence_asset_id,
            sha256: traversal.evidence_sha256,
            manifestId: traversal.evidence_manifest_id,
            manifestSha256: traversal.evidence_manifest_sha256,
            adapter: traversal.evidence_adapter,
            reviewGeneration: traversal.evidence_manifest_review_generation,
            registrationSha256: traversal.evidence_registration_sha256,
            sourceToWorld: traversal.evidence_source_to_world_json
              ? JSON.parse(traversal.evidence_source_to_world_json)
              : null,
            sourcePath: traversal.evidence_source_path_json
              ? JSON.parse(traversal.evidence_source_path_json)
              : null,
          },
        }, null, 2)));
      } catch (error) {
        evidence.append(element(
          "p",
          "form-error",
          `Stored path JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
        ));
      }
      row.append(evidence);
      traversalList.append(row);
    }
    routes.append(traversalList);
  }

  const navigationBuilds = spatial.navigationBuilds ?? [];
  const navigationBuildHistory = element("div", "navigation-build-history");
  if (!navigationBuilds.length) {
    navigationBuildHistory.append(element(
      "p",
      "field-note",
      "No approved navigation artifact exists. A future movement-enabled release remains blocked until one passes processor validation and operator review.",
    ));
  }
  for (const build of navigationBuilds.slice(0, 6)) {
    const row = element("div", "semantic-row navigation-build-row");
    const label = element(
      "span",
      "",
      `${humanStatus(build.status)} · ${parseTimestamp(build.created_at).toLocaleString()}`,
    );
    const actions = element("div", "navigation-build-actions");
    let evidenceDetails: HTMLDetailsElement | null = null;
    row.append(label);
    if (build.artifact_json) {
      const evidence = document.createElement("details");
      evidenceDetails = evidence;
      evidence.className = "navigation-evidence-details";
      evidence.append(element("summary", "", "Inspect build evidence"));
      try {
        const artifact = JSON.parse(build.artifact_json) as Record<string, unknown>;
        evidence.append(element("pre", "navigation-evidence-json", JSON.stringify({
          schemaVersion: artifact.schemaVersion,
          source: artifact.source,
          validation: artifact.validation,
          physicalValidation: artifact.physicalValidation,
          structuralValidation: artifact.structuralValidation,
          offMeshConnections: artifact.offMeshConnections,
          authoredTraversalValidation: artifact.authoredTraversalValidation,
          reportAssetId: build.report_asset_id,
          navmeshAssetId: build.navmesh_asset_id,
        }, null, 2)));
      } catch (error) {
        evidence.append(element(
          "p",
          "form-error",
          `Stored build evidence is invalid: ${error instanceof Error ? error.message : String(error)}`,
        ));
      }
      row.append(evidence);
    }
    if (build.status === "READY_FOR_REVIEW") {
      const approve = element("button", "primary-button", "Approve navigation");
      approve.disabled = !evidenceDetails?.open;
      approve.title = evidenceDetails
        ? "Open and inspect the frozen build evidence before approval."
        : "This build has no inspectable artifact and cannot be approved.";
      evidenceDetails?.addEventListener("toggle", () => {
        approve.disabled = !evidenceDetails?.open;
      });
      approve.addEventListener("click", () => {
        const note = window.prompt(
          "Record what you reviewed (minimum 10 characters).",
          "Reviewed whole-scene reachability and capsule-collision evidence.",
        );
        if (note === null) return;
        const finalResolutions = collectFinalAgreementResolutions(build.artifact_json);
        if (finalResolutions === null) return;
        void runAction({
          key: `approve-navigation-build:${build.id}`,
          trigger: approve,
          pendingLabel: "Approving…",
        }, () => reviewNavigationBuild(build.id, "approve", note, finalResolutions));
      });
      const reject = element("button", "danger-button", "Reject");
      reject.addEventListener("click", () => {
        const note = window.prompt("Explain the rejection (minimum 10 characters).", "Route evidence needs correction.");
        if (note === null) return;
        void runAction({
          key: `reject-navigation-build:${build.id}`,
          trigger: reject,
          pendingLabel: "Rejecting…",
        }, () => reviewNavigationBuild(build.id, "reject", note));
      });
      actions.append(approve, reject);
    } else if (["QUEUED", "PROCESSING"].includes(build.status)) {
      const refresh = element("button", "quiet-button", "Refresh");
      refresh.addEventListener("click", () => {
        void runAction({
          key: `refresh-navigation-build:${build.id}`,
          trigger: refresh,
          pendingLabel: "Refreshing…",
        }, () => loadSpatialWorkspace(project.id));
      });
      actions.append(refresh);
    } else if (build.status === "FAILED") {
      const retry = element("button", "quiet-button", "Retry");
      retry.addEventListener("click", () => {
        void runAction({
          key: `retry-navigation-build:${build.id}`,
          trigger: retry,
          pendingLabel: "Queueing retry…",
        }, () => retryNavigationBuild(build.job_id));
      });
      actions.append(retry);
    }
    if (actions.childElementCount) row.append(actions);
    navigationBuildHistory.append(row);
  }
  const navigationBuildsCard = element("article", "workspace-card-large navigation-builds-card");
  navigationBuildsCard.append(
    element("span", "eyebrow", "VERIFIED NAVIGATION"),
    element("h3", "", "Build receipts and operator review"),
    navigationBuildHistory,
  );
  const approvedNavigationBuild = navigationBuilds.find((build) => build.status === "APPROVED");
  const walkTestCard = approvedNavigationBuild
    ? renderWalkTestCard(spatial, approvedNavigationBuild)
    : null;

  const captureEvidence = element("article", "workspace-card-large capture-assurance");
  captureEvidence.append(
    element("span", "eyebrow", "CAPTURE COMPLETENESS"),
    element("h3", "", "Pose-path coverage, explicit recapture evidence"),
    element(
      "p",
      "muted-copy",
      "A private canonical trajectory is checked against authored room footprints. This is vendor-neutral path evidence, not an automatic claim about image quality, SLAM accuracy, or reconstruction success.",
    ),
  );
  const captureReports = spatial.captureCompletenessReports ?? [];
  if (!captureReports.length) {
    captureEvidence.append(element("p", "muted-copy", "No capture completeness evidence has been recorded for this project."));
  }
  for (const report of captureReports.slice(0, 5)) {
    captureEvidence.append(renderCaptureCompletenessReport(report));
  }
  const scanStructures = spatial.captureScanStructures ?? [];
  if (scanStructures.length) {
    captureEvidence.append(
      element("span", "eyebrow", "CONTAINER STRUCTURE"),
      element(
        "p",
        "muted-copy",
        "Read from the public ASTM E57 container only. Vendor classification and mesh semantics — indoor wall, floor, and ceiling labels — are not parsed, and no structural claim derives from this reading.",
      ),
    );
    for (const structure of scanStructures.slice(0, 5)) {
      captureEvidence.append(renderCaptureScanStructure(structure));
    }
  }
  const authoredRooms = spatial.entities.filter((entity) => entity.kind === "room" && entity.geometry_json);
  const captureUsesProvisionalUnits =
    spatial.navigationProfile.worldUnit === "scene_units";
  const analyzeCapture = element("button", "primary-button wide", captureReports.length
    ? "Analyze another trajectory"
    : "Analyze capture trajectory");
  analyzeCapture.disabled = authoredRooms.length === 0 || captureUsesProvisionalUnits;
  analyzeCapture.title = captureUsesProvisionalUnits
    ? "Capture completeness requires reviewed metric metres; provisional scene units support relative navigation only."
    : authoredRooms.length
    ? ""
    : "Author at least one room footprint before evaluating path coverage.";
  analyzeCapture.addEventListener("click", openCaptureCompletenessDialog);
  captureEvidence.append(
    analyzeCapture,
    element(
      "small",
      "field-note",
      captureUsesProvisionalUnits
        ? "Unavailable for this version: pose-path coverage radii and gaps are metric evidence. Establish measured scale in a new version before running this analysis."
        : authoredRooms.length
        ? `${authoredRooms.length} authored room footprint${authoredRooms.length === 1 ? "" : "s"} will define the coverage target.`
        : "No authored room footprint is available for a defensible coverage target.",
    ),
  );

  const assurance = element("article", "workspace-card-large privacy-assurance");
  assurance.id = "privacyAssuranceCard";
  assurance.append(
    element("span", "eyebrow", "PRIVACY EVIDENCE"),
    element("h3", "", "Automated candidates, human decisions"),
    element(
      "p",
      "muted-copy",
      "Private rendered evidence frames are checked by the configured detector. The model can only propose candidates; an operator must dismiss, confirm, or resolve each one.",
    ),
  );
  const posterAssets = (state.selected?.assets ?? []).filter((asset) =>
    asset.version_id === spatial.version!.id &&
    asset.kind === "poster" &&
    asset.integrity_status === "verified"
  );
  const latestScan = spatial.privacyScans[0] ?? null;
  const scanSummary = element("section", "privacy-scan-summary");
  if (latestScan) {
    const statusLine = element("div", "privacy-scan-heading");
    statusLine.append(
      element("span", `status-pill ${statusClass(latestScan.status)}`, humanStatus(latestScan.status)),
      element(
        "strong",
        "",
        `${latestScan.candidate_count} candidate${latestScan.candidate_count === 1 ? "" : "s"} across ${latestScan.input_count} frame${latestScan.input_count === 1 ? "" : "s"}`,
      ),
    );
    scanSummary.append(
      statusLine,
      element(
        "small",
        "muted-copy",
        `${latestScan.detector_version} · attempt ${latestScan.attempt_count}/${latestScan.max_attempts} · queued ${parseTimestamp(latestScan.created_at).toLocaleString()}`,
      ),
    );
    if (latestScan.status === "QUEUED" || latestScan.status === "RUNNING") {
      scanSummary.append(element("p", "inline-status", latestScan.status === "QUEUED"
        ? "Waiting for the privacy worker. Refresh to retrieve the latest state."
        : "Detection is running. Refresh to retrieve completed evidence."));
    }
    if (latestScan.status === "FAILED" || latestScan.status === "DEAD_LETTER") {
      const retry = element("button", "quiet-button", "Retry failed scan");
      retry.addEventListener("click", () => {
        void runAction({
          key: `privacy-scan-retry:${latestScan.id}`,
          trigger: retry,
          pendingLabel: "Queueing retry…",
        }, () => retryPrivacyScan(latestScan.id));
      });
      scanSummary.append(
        element("p", "form-error", privacyScanError(latestScan.error_json)),
        retry,
      );
    }
  } else {
    scanSummary.append(element("p", "muted-copy", "No automated privacy evidence has been recorded for this version."));
  }
  const scanAction = element("button", "primary-button wide", latestScan ? "Run a new privacy scan" : "Run automated privacy scan");
  const scanActive = latestScan?.status === "QUEUED" || latestScan?.status === "RUNNING";
  scanAction.disabled = posterAssets.length === 0 || scanActive;
  scanAction.title = posterAssets.length === 0
    ? "A verified poster image is required before privacy detection can run."
    : scanActive
      ? "The latest privacy scan is still active."
      : "";
  scanAction.addEventListener("click", () => {
    void runAction({
      key: `privacy-scan:${project.id}:${spatial.version!.id}`,
      trigger: scanAction,
      pendingLabel: "Queueing scan…",
    }, queuePrivacyScan);
  });
  scanSummary.append(
    scanAction,
    element(
      "small",
      "field-note",
      posterAssets.length
        ? `${posterAssets.length} verified evidence frame${posterAssets.length === 1 ? "" : "s"} will remain private during detection.`
        : "Process this version to generate a verified private poster frame first.",
    ),
  );
  assurance.append(scanSummary);

  const latestCandidates = latestScan
    ? spatial.privacyCandidates.filter((candidate) => candidate.scan_id === latestScan.id)
    : [];
  if (latestScan?.status === "COMPLETED" && !latestCandidates.length) {
    assurance.append(element("div", "notice-card", "No privacy candidates were detected. The completed scan remains part of the QA evidence."));
  }
  if (latestCandidates.length) {
    const candidates = element("section", "privacy-candidate-grid");
    for (const candidate of latestCandidates) {
      const card = element("article", `privacy-candidate-card ${candidate.status}`);
      card.append(privacyCandidatePreview(project.id, candidate));
      const copy = element("div", "privacy-candidate-copy");
      const heading = element("div", "privacy-candidate-heading");
      heading.append(
        element("strong", "", candidate.label),
        element("span", `status-pill ${statusClass(candidate.status.toUpperCase())}`, humanStatus(candidate.status)),
      );
      const confidence = candidate.confidence === null
        ? "Model confidence unavailable"
        : `${Math.round(candidate.confidence * 100)}% model confidence`;
      copy.append(
        heading,
        element("small", "muted-copy", `${candidate.asset_file_name} · ${confidence}`),
      );
      if (candidate.decision_note) copy.append(element("p", "field-note", candidate.decision_note));
      const review = element("button", candidate.status === "pending" || candidate.status === "confirmed"
        ? "primary-button wide"
        : "quiet-button wide", candidate.reviewed_at ? "Review decision" : "Review candidate");
      review.addEventListener("click", () => openPrivacyCandidateDialog(candidate));
      copy.append(review);
      card.append(copy);
      candidates.append(card);
    }
    assurance.append(candidates);
  }

  assurance.append(element("hr", "section-rule"));
  assurance.append(element("h4", "", "Authored privacy regions"));
  if (!spatial.privacyRegions.length) assurance.append(element("p", "muted-copy", "No privacy regions are awaiting review."));
  for (const region of spatial.privacyRegions) {
    const row = element("div", "review-line");
    row.append(element("div", "", `${region.label} · ${humanStatus(region.source)} · ${humanStatus(region.status)}`));
    if (region.status === "pending") {
      const actions = element("span", "release-actions");
      for (const status of ["approved", "rejected"] as const) {
        const button = element("button", status === "approved" ? "quiet-button" : "danger-button", humanStatus(status));
        button.addEventListener("click", () => {
          void runAction({
            key: `${status}-privacy:${region.id}`,
            trigger: button,
            pendingLabel: status === "approved" ? "Approving…" : "Rejecting…",
          }, () => reviewPrivacyRegion(region.id, status));
        });
        actions.append(button);
      }
      row.append(actions);
    }
    if (region.status === "approved") {
      const applied = element("button", "primary-button", "Mark redaction applied");
      applied.addEventListener("click", () => {
        void runAction({
          key: `applied-privacy:${region.id}`,
          trigger: applied,
          pendingLabel: "Recording…",
        }, () => reviewPrivacyRegion(region.id, "applied"));
      });
      row.append(applied);
    }
    assurance.append(row);
  }
  const comparisonEvidence = compareDomain.renderStage({
    projectId: project.id,
    versions: state.selected?.versions ?? [],
    assets: state.selected?.assets ?? [],
    geometryReports: spatial.changeReports,
    rawReports: spatial.rawChangeReports ?? [],
    readiness: state.selected?.comparisonReadiness ?? emptyComparisonReadiness,
  });

  const delivery = element("article", "workspace-card-large");
  delivery.append(
    element("span", "eyebrow", "ADAPTIVE DELIVERY"),
    element("h3", "", "Measured device policy"),
    projectFact("Mobile lite", `${String(Reflect.get(spatial.deliveryPolicy ?? {}, "mobile_lite_budget") ?? 0.75)}M splats`),
    projectFact("Mobile standard", `${String(Reflect.get(spatial.deliveryPolicy ?? {}, "mobile_standard_budget") ?? 1.25)}M splats`),
    projectFact("Desktop high", `${String(Reflect.get(spatial.deliveryPolicy ?? {}, "desktop_high_budget") ?? 4)}M splats`),
    element("p", "muted-copy", "The viewer selects this budget from pointer type, viewport, and reported device memory; Spark RAD supplies paged LoD."),
  );
  const savePolicy = element("button", "quiet-button wide", "Apply production quality policy");
  savePolicy.addEventListener("click", () => {
    void runAction({
      key: `save-delivery-policy:${project.id}`,
      trigger: savePolicy,
      pendingLabel: "Applying…",
    }, saveDefaultDeliveryPolicy);
  });
  delivery.append(savePolicy);
  if (state.projectSection === "privacy") {
    container.append(assurance);
    return;
  }
  if (state.projectSection === "compare") {
    container.append(comparisonEvidence);
    return;
  }
  if (state.projectSection === "structure") {
    container.append(renderFloorplanWorkflow(project, spatial));
    return;
  }
  if (state.projectSection === "walk") {
    if (walkTestCard) container.append(walkTestCard);
    container.append(routes, navigationBuildsCard);
    return;
  }
  if (!comparisonWorkspaceAvailable(state.selected?.comparisonReadiness ?? emptyComparisonReadiness)) {
    container.append(comparisonEvidence);
  }
  container.append(hierarchy, semanticExtraction, captureEvidence, delivery);
}

function renderWalkTestCard(
  spatial: SpatialWorkspace,
  build: SpatialWorkspace["navigationBuilds"][number],
): HTMLElement {
  const project = state.selected?.project;
  if (
    project && spatial.version &&
    (
      activeWalkTestSession?.projectId !== project.id ||
      activeWalkTestSession.versionId !== spatial.version.id ||
      activeWalkTestSession.buildId !== build.id
    )
  ) {
    activeWalkTestSession = {
      projectId: project.id,
      versionId: spatial.version.id,
      buildId: build.id,
      clientOperationId: null,
      startPose: null,
      movementObserved: false,
      runtimeFailure: null,
    };
    latestWalkTestPose = null;
    previousWalkTestSample = null;
  }
  const card = element("article", "workspace-card-large walk-test-card");
  const status = element("p", "field-note", "Preparing the approved scene and walking runtime…");
  status.id = "walkTestStatus";
  const heading = element("div", "walk-test-heading");
  heading.append(
    element("span", "eyebrow", "MOVEMENT VERIFICATION"),
    element("h3", "", "Walk test"),
    status,
  );
  const frame = document.createElement("iframe");
  frame.id = "walkTestPreview";
  frame.title = "Test the approved walking map inside the scene";
  const evidence = walkTestEvidenceSummary(build);
  const evidenceSummary = element("p", "field-note", evidence);
  const reset = element("button", "quiet-button", "Reset walk test");
  const usePosition = element("button", "quiet-button", "Set test start here");
  usePosition.disabled = true;
  usePosition.id = "walkTestUsePosition";
  const complete = element("button", "primary-button", "Complete walk test");
  complete.disabled = true;
  complete.id = "walkTestComplete";
  reset.addEventListener("click", () => {
    latestWalkTestPose = null;
    previousWalkTestSample = null;
    if (activeWalkTestSession) {
      activeWalkTestSession.startPose = null;
      activeWalkTestSession.clientOperationId = null;
      activeWalkTestSession.movementObserved = false;
      activeWalkTestSession.runtimeFailure = null;
    }
    usePosition.disabled = true;
    complete.disabled = true;
    void prepareWalkTest(frame, status, spatial.version!.id);
  });
  usePosition.addEventListener("click", () => {
    if (!latestWalkTestPose || !activeWalkTestSession) return;
    activeWalkTestSession.startPose = {
      position: [...latestWalkTestPose.position] as [number, number, number],
      target: [...latestWalkTestPose.target] as [number, number, number],
    };
    activeWalkTestSession.clientOperationId = crypto.randomUUID();
    activeWalkTestSession.movementObserved = false;
    activeWalkTestSession.runtimeFailure = null;
    complete.disabled = true;
    status.textContent = "Starting point set. Walk away from it through the approved scene, then complete the test.";
    showToast("Walk-test starting point set");
  });
  complete.addEventListener("click", () => {
    if (!activeWalkTestSession || !latestWalkTestPose) return;
    void runAction({
      key: `complete-walk-test:${build.id}`,
      trigger: complete,
      pendingLabel: "Recording…",
      disable: [reset, usePosition],
    }, () => completeWalkTest(build.id, activeWalkTestSession!, latestWalkTestPose!));
  });
  const actions = element("div", "navigation-authoring-actions");
  actions.append(reset, usePosition, complete);
  const side = element("div", "walk-test-side");
  side.append(heading, evidenceSummary, actions);
  card.append(frame, side);
  const completed = spatial.walkTests?.find((walkTest) =>
    walkTest.navigation_build_id === build.id
  );
  if (completed) {
    side.append(element(
      "p",
      "generated-readback",
      `Walk-test receipt recorded ${parseTimestamp(completed.completed_at).toLocaleString()} for this exact approved walking map.`,
    ));
  }
  window.queueMicrotask(() => void prepareWalkTest(frame, status, spatial.version!.id));
  return card;
}

async function completeWalkTest(
  buildId: string,
  session: NonNullable<typeof activeWalkTestSession>,
  endPose: NonNullable<typeof latestWalkTestPose>,
): Promise<void> {
  if (!session.startPose || !session.movementObserved || session.runtimeFailure) {
    throw new Error("Set a starting point, walk away from it, and resolve runtime failures before completion.");
  }
  await api(`/api/projects/${session.projectId}/spatial/navigation-builds/${buildId}/walk-tests`, {
    method: "POST",
    body: JSON.stringify({
      clientOperationId: session.clientOperationId ??= crypto.randomUUID(),
      versionId: session.versionId,
      startPose: session.startPose,
      endPose: { position: endPose.position, target: endPose.target },
      runtimeEvidence: {
        movementObserved: true,
        collisionFailureReported: false,
        traversalBlockReported: false,
      },
    }),
  });
  showToast("Walk test completed and recorded");
  await Promise.all([
    loadSpatialWorkspace(session.projectId),
    selectProject(session.projectId, false, false),
  ]);
}

function walkTestEvidenceSummary(build: SpatialWorkspace["navigationBuilds"][number]): string {
  try {
    const artifact = JSON.parse(build.artifact_json ?? "{}") as Record<string, unknown>;
    const validation = Reflect.get(artifact, "validation");
    const physical = Reflect.get(artifact, "physicalValidation");
    const unreachable = validation && typeof validation === "object"
      ? Reflect.get(validation, "unreachableDestinationIds")
      : null;
    const failed = physical && typeof physical === "object"
      ? Reflect.get(physical, "failedDestinationIds")
      : null;
    const unreachableCount = Array.isArray(unreachable) ? unreachable.length : 0;
    const failedCount = Array.isArray(failed) ? failed.length : 0;
    return `${unreachableCount} unreachable authored destinations · ${failedCount} failed physical routes in the approved processor receipt.`;
  } catch {
    return "The approved build receipt could not be summarized; inspect its immutable evidence above.";
  }
}

async function prepareWalkTest(
  frame: HTMLIFrameElement,
  status: HTMLElement,
  versionId: string,
): Promise<void> {
  frame.onload = null;
  frame.src = "about:blank";
  status.textContent = "Preparing the approved scene and walking runtime…";
  try {
    const renderable = await createVersionPreview(versionId);
    if (!frame.isConnected || state.spatial?.version?.id !== versionId) return;
    frame.onload = () => sendVersionSpatialRuntime(frame, renderable);
    frame.src = rendererAssetUrl(renderable).toString();
  } catch (error) {
    if (!frame.isConnected) return;
    status.textContent = `Walk test unavailable: ${errorMessage(error)}`;
  }
}

function handleWalkTestRendererMessage(event: MessageEvent<unknown>): void {
  const frame = document.getElementById("walkTestPreview");
  const status = document.getElementById("walkTestStatus");
  if (
    !(frame instanceof HTMLIFrameElement) || !status ||
    event.origin !== location.origin || event.source !== frame.contentWindow ||
    !event.data || typeof event.data !== "object" ||
    Reflect.get(event.data, "source") !== "spatial-spark"
  ) return;
  const type = Reflect.get(event.data, "type");
  if (type === "ready") {
    status.textContent = "Ready. Click the scene, then walk with WASD or arrow keys; collision remains enforced by the approved runtime.";
    return;
  }
  if (type === "error") {
    const message = String(Reflect.get(event.data, "message") ?? "walking runtime error");
    if (activeWalkTestSession) activeWalkTestSession.runtimeFailure = message;
    const complete = document.getElementById("walkTestComplete");
    if (complete instanceof HTMLButtonElement) complete.disabled = true;
    status.textContent = `Runtime warning: ${message}`;
    return;
  }
  if (type === "authored-traversal-state" && Reflect.get(event.data, "phase") === "blocked") {
    const message = String(Reflect.get(event.data, "message") ?? "review the approved path evidence");
    if (activeWalkTestSession) activeWalkTestSession.runtimeFailure = message;
    const complete = document.getElementById("walkTestComplete");
    if (complete instanceof HTMLButtonElement) complete.disabled = true;
    status.textContent = `Traversal blocked: ${message}`;
    return;
  }
  if (type !== "camera-update") return;
  const pose = Reflect.get(event.data, "cameraPose");
  if (!pose || typeof pose !== "object") return;
  const position = finiteStudioPoint(Reflect.get(pose, "position"));
  const target = finiteStudioPoint(Reflect.get(pose, "target"));
  if (!position || !target) return;
  const observedAt = performance.now();
  const elapsedSeconds = previousWalkTestSample
    ? (observedAt - previousWalkTestSample.observedAt) / 1000
    : 0;
  const speed = previousWalkTestSample && elapsedSeconds > 0
    ? Math.hypot(...position.map((value, axis) => value - previousWalkTestSample!.position[axis]!)) /
      elapsedSeconds
    : 0;
  latestWalkTestPose = { position, target, observedAt };
  previousWalkTestSample = { position, observedAt };
  const usePosition = document.getElementById("walkTestUsePosition");
  if (usePosition instanceof HTMLButtonElement) usePosition.disabled = false;
  if (activeWalkTestSession?.startPose) {
    activeWalkTestSession.movementObserved = position.some((coordinate, axis) =>
      coordinate !== activeWalkTestSession!.startPose!.position[axis]
    );
  }
  const complete = document.getElementById("walkTestComplete");
  if (complete instanceof HTMLButtonElement) {
    complete.disabled = !activeWalkTestSession?.movementObserved ||
      Boolean(activeWalkTestSession.runtimeFailure);
  }
  status.textContent = `Walking runtime active · current speed ${speed.toFixed(2)} ${worldUnitSymbol(
    state.spatial?.navigationProfile.worldUnit ?? "metres",
  )}/s · no runtime collision failure reported.`;
}

function renderPublish(): void {
  const container = byId("publishOverview");
  container.replaceChildren();
  const detail = state.selected;
  if (!detail) {
    container.append(emptyState("Open a project before reviewing publication readiness."));
    return;
  }
  if (!state.spatial?.version) {
    container.append(emptyState("Loading publication evidence…"));
    return;
  }

  const card = element("article", "workspace-card-large publication-readiness-card");
  const latestVersion = detail.versions[0] ?? null;
  const releasableVersion = auxiliaryCollisionTargetVersion();
  const navigationReady = Boolean(
    releasableVersion && detail.previewReadyVersionIds.includes(releasableVersion.id),
  );
  const walkTestReady = Boolean(
    releasableVersion &&
    (detail.walkTestReadyVersionIds ?? []).includes(releasableVersion.id),
  );
  const privacy = privacyQaReadiness(state.spatial);
  const workflowPolicy = effectiveVersionWorkflowPolicy(detail.project, releasableVersion);
  const hostingSubscription = state.hosting?.subscriptions.find((subscription) =>
    subscription.project_id === detail.project.id && subscription.status === "active"
  ) ?? null;
  const hostingReady = workflowPolicy.hosting !== "managed-required" || Boolean(hostingSubscription);
  card.append(
    element("span", "eyebrow", "PUBLICATION READINESS"),
    element("h3", "", "Confirm evidence, then publish"),
    projectFact(
      "Visual scene",
      releasableVersion ? `Version ${releasableVersion.version_number} approved` : "Awaiting QA approval",
    ),
    projectFact("Walking map", navigationReady ? "Verified and approved" : "Not ready"),
    projectFact("In-scene walk test", walkTestReady ? "Completed and recorded" : "Required before publication"),
    projectFact("Privacy evidence", privacy.ready ? "Ready for human approval" : privacy.message),
    projectFact(
      "Managed hosting",
      workflowPolicy.hosting === "managed-required"
        ? hostingReady
          ? `${hostingSubscription!.plan_name} active`
          : "Required before publication"
        : hostingSubscription
          ? `${hostingSubscription.plan_name} active`
          : "Optional",
    ),
  );
  const republish = (state.spatial.releaseRepublishIntents ?? [])[0];
  if (republish) {
    card.append(projectFact(
      "Walking-map republish",
      republish.status === "pending"
        ? `Queued for /${republish.slug ?? "current release"}; this request survives closing Studio`
        : republish.status === "completed"
          ? `Completed for /${republish.slug ?? "published release"}`
          : republish.error_message ?? "Stopped; publish manually after resolving the rebuild",
    ));
  }

  if (latestVersion?.status === "QA_REQUIRED") {
    const review = element("button", "quiet-button wide", "Review privacy and approve");
    review.addEventListener("click", () => {
      void runAction({
        key: `open-qa:${detail.project.id}`,
        trigger: review,
        pendingLabel: "Checking evidence…",
      }, openQaDialog);
    });
    card.append(review);
  }
  if (releasableVersion && navigationReady && walkTestReady && hostingReady) {
    const configure = element("button", "primary-button wide", "Configure publication");
    configure.addEventListener("click", () => {
      void runAction({
        key: `open-release:${detail.project.id}`,
        trigger: configure,
        pendingLabel: "Loading release evidence…",
      }, openReleaseDialog);
    });
    card.append(configure);
  } else if (releasableVersion && navigationReady && walkTestReady && !hostingReady) {
    const configureHosting = element("button", "primary-button wide", "Configure managed hosting");
    configureHosting.addEventListener("click", () => {
      void runAction({
        key: `open-hosting:${detail.project.id}`,
        trigger: configureHosting,
        pendingLabel: "Loading hosting settings…",
      }, openDeliveryDialog);
    });
    card.append(configureHosting);
  }
  const activeRelease = detail.releases.find((release) => release.is_active && !release.revoked_at);
  if (activeRelease) {
    const publishedLink = document.createElement("a");
    publishedLink.className = "quiet-button wide";
    publishedLink.href = `/s/${activeRelease.slug}`;
    publishedLink.target = "_blank";
    publishedLink.rel = "noopener";
    publishedLink.textContent = `Open published /${activeRelease.slug}`;
    card.append(publishedLink);
  }
  container.append(card);
}

function renderSceneAuthoringWorkspace(
  project: Project,
  spatial: SpatialWorkspace,
): HTMLElement {
  const card = element("article", "workspace-card-large scene-authoring-workspace");
  const heading = element("div", "scene-authoring-heading");
  const copy = element("div");
  copy.append(
    element("span", "eyebrow", "RENDER-NATIVE WALKING MAP"),
    element("h3", "", "Inspect and correct the reconstructed structure in place"),
    element(
      "p",
      "muted-copy",
      "Automatic geometry is the baseline. Mark only incorrect or missing rooms, walls, doorways, stairs, and ramps directly on this immutable render.",
    ),
  );
  const status = element("span", "scene-authoring-status", "Opening registered scene…");
  heading.append(copy, status);

  const stage = element("div", "scene-authoring-stage");
  const frame = document.createElement("iframe");
  frame.title = `Spatial authoring for ${project.name}`;
  frame.allow = "fullscreen";
  stage.append(frame);

  const legend = element("div", "scene-authoring-legend");
  for (const [kind, label] of [
    ["room", "Room outline"],
    ["wall", "Wall"],
    ["door", "Passable doorway"],
    ["window", "Blocked window"],
    ["unknown", "Unresolved opening"],
    ["connector", "Stairs / ramp"],
  ] as const) {
    const item = element("span", `scene-authoring-legend-item ${kind}`);
    item.append(element("i", ""), document.createTextNode(label));
    legend.append(item);
  }

  const toolbar = element("div", "scene-authoring-toolbar");
  const modes = [
    [null, "Inspect"],
    ["room", "Mark room"],
    ["wall", "Mark wall"],
    ["door", "Mark doorway"],
    ["window", "Mark window"],
    ["stairs", "Mark stairs"],
    ["ramp", "Mark ramp"],
    ["remove", "Remove structure"],
  ] as const;
  const modeButtons = modes.map(([mode, label]) => {
    const button = element("button", mode === null ? "primary-button" : "quiet-button", label);
    button.type = "button";
    button.addEventListener("click", () => activateSceneAuthoringMode(mode));
    toolbar.append(button);
    return button;
  });
  modeButtons.forEach((button, index) => { if (index > 0) button.disabled = true; });
  const undo = element("button", "quiet-button", "Undo staged change");
  undo.type = "button";
  undo.disabled = true;
  undo.addEventListener("click", undoSceneAuthoringCorrection);
  const finish = element("button", "quiet-button", "Finish shape");
  finish.type = "button";
  finish.disabled = true;
  finish.addEventListener("click", finishSceneAuthoringShape);
  const save = element("button", "primary-button", "Approve structure and build walking map");
  save.type = "button";
  save.disabled = true;
  save.addEventListener("click", () => {
    void runAction({
      key: `save-render-authoring:${spatial.version!.id}`,
      trigger: save,
      pendingLabel: "Saving and rebuilding…",
    }, submitSceneAuthoringCorrections);
  });
  toolbar.append(undo, finish, save);
  const publicationFollowUp = element("div", "scene-authoring-publication-follow-up");
  const pendingRepublish = (spatial.releaseRepublishIntents ?? []).find(
    (intent) => intent.status === "pending",
  );
  const activeRelease = state.selected?.releases.find((release) =>
    Boolean(release.is_active) && !release.revoked_at && release.version_id === spatial.version!.id
  ) ?? null;
  if (pendingRepublish) {
    publicationFollowUp.append(element(
      "p",
      "inline-status",
      `Publication /${pendingRepublish.slug ?? activeRelease?.slug ?? "current"} will refresh after this walking map passes verification. This request is durable; closing Studio will not cancel it.`,
    ));
  } else if (activeRelease?.access_policy === "token") {
    publicationFollowUp.append(element(
      "p",
      "field-note",
      "This release uses a recipient token. Rebuild the walking map here, then publish manually to issue a new token.",
    ));
  } else if (activeRelease) {
    const label = element("label", "checkbox-row");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", () => {
      if (sceneAuthoringWorkspace?.versionId === spatial.version!.id) {
        sceneAuthoringWorkspace.republishReleaseId = input.checked ? activeRelease.id : null;
      }
    });
    label.append(
      input,
      element(
        "span",
        "",
        `Republish /${activeRelease.slug} automatically after the rebuilt walking map passes verification.`,
      ),
    );
    publicationFollowUp.append(
      label,
      element(
        "small",
        "field-note",
        "The worker preserves this release's audience, expiry, and viewer settings. The request survives closing this browser.",
      ),
    );
  }

  const reviewable = [...(spatial.floorplanExtractions ?? [])]
    .find((extraction) => extraction.status === "READY_FOR_REVIEW" && extraction.proposal_json);
  let plan: EditableFloorplan | null = null;
  let revisionId: string | null = null;
  let frozenAgreementJson: string | null = null;
  if (reviewable?.proposal_json) {
    try {
      plan = floorplanProposalToEditablePlan(reviewable.proposal_json);
    } catch (error) {
      status.textContent = errorMessage(error);
      status.dataset.tone = "error";
    }
  } else {
    const approved = (spatial.floorplanRevisions ?? []).find(
      (revision) => revision.status === "approved",
    );
    if (approved) {
      revisionId = approved.id;
      frozenAgreementJson = approved.capture_agreement_json ?? null;
      try {
        plan = parseEditableFloorplan(approved.plan_json);
      } catch (error) {
        status.textContent = errorMessage(error);
        status.dataset.tone = "error";
      }
    }
  }
  // A fresh proposal carries its findings inline; a correction of an approved
  // revision inherits the findings and prior classifications frozen with that
  // revision, so the correction draft the server clones can be re-approved
  // without re-deriving what the operator already answered.
  const frozenAgreement = frozenAgreementJson
    ? captureAgreementFromFrozenRevision(frozenAgreementJson)
    : null;
  const captureAgreementFindings = reviewable?.proposal_json
    ? captureAgreementFindingsFromProposal(reviewable.proposal_json)
    : frozenAgreement?.findings ?? [];
  const captureAgreementClassifications = frozenAgreement?.classifications ??
    new Map<string, string>();
  sceneAuthoringWorkspace = {
    projectId: project.id,
    versionId: spatial.version!.id,
    extractionId: reviewable?.id ?? null,
    revisionId,
    plan,
    history: [],
    dirty: false,
    mode: null,
    requestId: null,
    points: [],
    frame,
    status,
    finish,
    undo,
    save,
    modeButtons,
    correctionDraftOperationId: crypto.randomUUID(),
    correctionReviewOperationId: crypto.randomUUID(),
    republishReleaseId: null,
    captureAgreementFindings,
    captureAgreementClassifications,
  };
  if (!plan) {
    status.textContent = "Waiting for automatic structural reconstruction";
  } else if (reviewable || revisionId) {
    // An approved revision may be re-approved WITHOUT geometry edits: the
    // recook adopts the current collision standard (volumetric wall prisms,
    // elevation-stamped capture classifications) for revisions that predate
    // it — the staged migration path for pre-volumetric scenes.
    save.disabled = false;
  }
  void loadSceneAuthoringRenderable(project.id, spatial.version!.id);
  card.append(heading, stage, legend, toolbar);
  if (publicationFollowUp.childElementCount) card.append(publicationFollowUp);
  if (captureAgreementFindings.length) {
    card.append(renderCaptureAgreementFindings(
      captureAgreementFindings,
      captureAgreementClassifications,
    ));
  }
  return card;
}

async function loadSceneAuthoringRenderable(projectId: string, versionId: string): Promise<void> {
  const workspace = sceneAuthoringWorkspace;
  if (!workspace || workspace.projectId !== projectId || workspace.versionId !== versionId) return;
  try {
    const response = await api<{ renderable: SceneAuthoringRenderable }>(
      `/api/projects/${projectId}/spatial/authoring-renderable?versionId=${encodeURIComponent(versionId)}`,
    );
    if (sceneAuthoringWorkspace !== workspace) return;
    workspace.frame.onload = () => {
      if (sceneAuthoringWorkspace !== workspace) return;
      workspace.modeButtons.forEach((button, index) => {
        if (index > 0) button.disabled = !workspace.plan;
      });
      workspace.status.textContent = workspace.plan
        ? "Registered scene ready · inspect or mark corrections"
        : "Registered scene ready · automatic structure is still processing";
      workspace.status.dataset.tone = "ready";
      sendSceneAuthoringPlan(workspace);
    };
    workspace.frame.src = rendererAssetUrl(response.renderable).toString();
  } catch (error) {
    if (sceneAuthoringWorkspace !== workspace) return;
    workspace.status.textContent = errorMessage(error);
    workspace.status.dataset.tone = "error";
  }
}

function activateSceneAuthoringMode(
  mode: RenderNativeCorrectionMode | null,
): void {
  const workspace = sceneAuthoringWorkspace;
  if (!workspace) return;
  if (mode && !workspace.plan) {
    workspace.status.textContent = "Automatic structural reconstruction must produce a plan before corrections can be marked.";
    workspace.status.dataset.tone = "error";
    return;
  }
  const requestId = crypto.randomUUID();
  workspace.mode = mode;
  workspace.requestId = requestId;
  workspace.points = [];
  workspace.finish.disabled = true;
  for (const [index, button] of workspace.modeButtons.entries()) {
    const activeMode = [null, "room", "wall", "door", "window", "stairs", "ramp", "remove"][index];
    const active = activeMode === mode;
    button.className = active ? "primary-button" : "quiet-button";
  }
  workspace.status.textContent = mode === null
    ? "Inspect mode · drag to look around"
    : `${sceneAuthoringModeLabel(mode)} mode · click the rendered geometry`;
  workspace.status.dataset.tone = "ready";
  workspace.frame.contentWindow?.postMessage({
    source: "spatial-host",
    type: "set-authoring-mode",
    requestId,
    mode,
  }, location.origin);
}

function handleSceneAuthoringRendererMessage(event: MessageEvent<unknown>): void {
  const workspace = sceneAuthoringWorkspace;
  if (
    !workspace || event.origin !== location.origin ||
    event.source !== workspace.frame.contentWindow ||
    !event.data || typeof event.data !== "object" ||
    Reflect.get(event.data, "source") !== "spatial-spark"
  ) return;
  const type = Reflect.get(event.data, "type");
  if (type === "progress") {
    workspace.status.textContent = String(Reflect.get(event.data, "detail") ?? "Loading registered scene");
    return;
  }
  if (type === "error") {
    workspace.status.textContent = String(Reflect.get(event.data, "message") ?? "The registered scene could not be loaded.");
    workspace.status.dataset.tone = "error";
    return;
  }
  if (type !== "authoring-pick" || Reflect.get(event.data, "requestId") !== workspace.requestId) return;
  const points = Reflect.get(event.data, "points");
  if (!Array.isArray(points) || !points.every(validNumberTuple)) return;
  workspace.points = points.map((point) => [...point] as [number, number, number]);
  const complete = Reflect.get(event.data, "complete") === true;
  workspace.finish.disabled = !complete ||
    workspace.mode === "wall" || workspace.mode === "door" || workspace.mode === "window" ||
    workspace.mode === "remove";
  workspace.status.textContent = `${workspace.points.length} point${workspace.points.length === 1 ? "" : "s"} marked on the registered scene`;
  if (complete && ["wall", "door", "window", "remove"].includes(workspace.mode ?? "")) {
    commitSceneAuthoringGeometry();
  }
}

function finishSceneAuthoringShape(): void {
  commitSceneAuthoringGeometry();
}

function commitSceneAuthoringGeometry(): void {
  const workspace = sceneAuthoringWorkspace;
  const plan = workspace?.plan;
  const mode = workspace?.mode;
  if (!workspace || !plan || !mode || !workspace.points.length) return;
  try {
    const result = applyRenderNativeFloorplanCorrection(plan, mode, workspace.points);
    workspace.history.push(plan);
    workspace.plan = result.plan;
    workspace.dirty = true;
    workspace.undo.disabled = false;
    workspace.save.disabled = false;
    workspace.status.textContent = `${result.summary} · staged for rebuild`;
    workspace.status.dataset.tone = "ready";
    sendSceneAuthoringPlan(workspace);
    activateSceneAuthoringMode(mode);
  } catch (error) {
    workspace.status.textContent = errorMessage(error);
    workspace.status.dataset.tone = "error";
  }
}

function undoSceneAuthoringCorrection(): void {
  const workspace = sceneAuthoringWorkspace;
  const prior = workspace?.history.pop();
  if (!workspace || !prior) return;
  workspace.plan = prior;
  workspace.dirty = workspace.history.length > 0;
  workspace.undo.disabled = !workspace.history.length;
  workspace.save.disabled = !workspace.dirty && !workspace.extractionId && !workspace.revisionId;
  workspace.status.textContent = workspace.dirty
    ? "Last rendered correction undone · earlier staged changes remain"
    : "All staged corrections undone";
  workspace.status.dataset.tone = "ready";
  sendSceneAuthoringPlan(workspace);
}

const CAPTURE_AGREEMENT_CLASSIFICATIONS = [
  ["actual_wall", "Actual wall · capture too sparse"],
  ["glass_wall", "Glass wall"],
  ["mirror", "Mirror"],
  ["unobserved_boundary", "Unobserved boundary"],
  ["intentional_no_go", "Intentional no-go boundary"],
  ["door_opening", "Door or opening · corrected in the plan"],
  ["false_barrier", "False barrier · removed in the plan"],
] as const;

function captureAgreementFindingIdentity(finding: CaptureAgreementFinding): string {
  return `${finding.barrierId}|${finding.levelKey ?? ""}|${finding.from.join(",")}|${
    finding.to.join(",")
  }`;
}

function captureAgreementFromFrozenRevision(captureAgreementJson: string): {
  findings: CaptureAgreementFinding[];
  classifications: Map<string, string>;
} | null {
  try {
    const frozen = JSON.parse(captureAgreementJson) as {
      report?: { findings?: CaptureAgreementFinding[] } | null;
      resolutions?: Array<CaptureAgreementFinding & { classification: string }>;
    };
    const findings = (frozen.report?.findings ?? []).filter((finding) =>
      finding && typeof finding.barrierId === "string" &&
      Array.isArray(finding.from) && Array.isArray(finding.to)
    );
    const classifications = new Map<string, string>();
    for (const resolution of frozen.resolutions ?? []) {
      if (!resolution || typeof resolution.classification !== "string") continue;
      classifications.set(captureAgreementFindingIdentity(resolution), resolution.classification);
    }
    return { findings, classifications };
  } catch {
    return null;
  }
}

function captureAgreementFindingsFromProposal(proposalJson: string): CaptureAgreementFinding[] {
  try {
    const report = JSON.parse(proposalJson) as {
      captureAgreement?: { findings?: CaptureAgreementFinding[] };
    };
    return (report.captureAgreement?.findings ?? []).filter((finding) =>
      finding && typeof finding.barrierId === "string" &&
      Array.isArray(finding.from) && Array.isArray(finding.to)
    );
  } catch {
    return [];
  }
}

// The extractor read its own proposed walls back against the capture. A
// crossing finding must be classified before approval; the other kinds are
// informational — sparse capture, glass, and occlusion make real walls look
// unsupported, so nothing here deletes a wall automatically.
function renderCaptureAgreementFindings(
  findings: CaptureAgreementFinding[],
  classifications: Map<string, string>,
): HTMLElement {
  const section = element("div", "scene-authoring-capture-agreement");
  const crossings = findings.filter((finding) => finding.kind === "barrier_crosses_open_capture");
  section.append(
    element("h4", "", "Capture disagreements"),
    element(
      "p",
      "muted-copy",
      crossings.length
        ? `The capture shows a way through ${crossings.length} proposed wall span(s). Classify each before approving — walls are never deleted automatically; use Mark doorway or Remove structure when the capture is right.`
        : "The capture could not confirm these wall spans. No classification is required; they are listed for awareness.",
    ),
  );
  const list = element("ul", "scene-authoring-capture-findings");
  for (const finding of findings) {
    const item = element("li", "");
    const where = finding.levelKey ? `${finding.levelKey} · ` : "";
    const kindLabel = finding.kind === "barrier_crosses_open_capture"
      ? "crosses capture that shows a way through"
      : finding.kind === "barrier_end_without_capture"
      ? "end of the wall has no capture behind it"
      : "no capture anywhere behind it";
    item.append(element(
      "span",
      "",
      `${where}${finding.barrierId} · ${finding.metres} m near [${finding.from.join(", ")}] → [${
        finding.to.join(", ")
      }] · ${kindLabel}`,
    ));
    if (finding.kind === "barrier_crosses_open_capture") {
      const select = document.createElement("select");
      select.className = "scene-authoring-capture-classification";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Classify this wall…";
      select.append(placeholder);
      for (const [value, label] of CAPTURE_AGREEMENT_CLASSIFICATIONS) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.append(option);
      }
      const identity = captureAgreementFindingIdentity(finding);
      select.value = classifications.get(identity) ?? "";
      select.addEventListener("change", () => {
        if (select.value) classifications.set(identity, select.value);
        else classifications.delete(identity);
      });
      item.append(select);
    }
    list.append(item);
  }
  section.append(list);
  return section;
}

function sendSceneAuthoringPlan(workspace: NonNullable<typeof sceneAuthoringWorkspace>): void {
  if (!workspace.plan) return;
  workspace.frame.contentWindow?.postMessage({
    source: "spatial-host",
    type: "set-authoring-plan",
    plan: workspace.plan,
  }, location.origin);
}

function sceneAuthoringModeLabel(mode: RenderNativeCorrectionMode): string {
  if (mode === "door") return "Doorway";
  if (mode === "window") return "Window";
  if (mode === "remove") return "Remove structure";
  return humanStatus(mode);
}

async function submitSceneAuthoringCorrections(): Promise<void> {
  const workspace = sceneAuthoringWorkspace;
  if (!workspace?.plan) {
    throw new Error("Wait for the automatic structure before approving the walking map.");
  }
  if (!workspace.dirty && !workspace.extractionId && !workspace.revisionId) {
    throw new Error("The approved structure has no staged correction to save.");
  }
  parseEditableFloorplan(JSON.stringify(workspace.plan));
  const crossings = workspace.captureAgreementFindings
    .filter((finding) => finding.kind === "barrier_crosses_open_capture");
  const unclassified = crossings.filter((finding) =>
    !workspace.captureAgreementClassifications.get(captureAgreementFindingIdentity(finding))
  );
  if (unclassified.length) {
    throw new Error(
      `Classify ${unclassified.length} capture disagreement(s) before approving: the capture shows a way through ${
        unclassified.map((finding) => finding.barrierId).join(", ")
      }.`,
    );
  }
  const captureAgreementResolutions = crossings.map((finding) => ({
    barrierId: finding.barrierId,
    ...(finding.levelKey ? { levelKey: finding.levelKey } : {}),
    // The elevation pins the classification to its storey: stacked floors
    // share X/Z footprints and a resolution without height could otherwise
    // satisfy the same wall one level up.
    ...(typeof finding.elevationM === "number" ? { elevationM: finding.elevationM } : {}),
    from: finding.from,
    to: finding.to,
    classification: workspace.captureAgreementClassifications.get(
      captureAgreementFindingIdentity(finding),
    )!,
  }));
  let extractionId = workspace.extractionId;
  if (!extractionId) {
    if (!workspace.revisionId) {
      throw new Error("The registered scene has no approved floor-plan revision to correct.");
    }
    const draft = await api<{ extraction: { id: string } }>(
      `/api/projects/${workspace.projectId}/spatial/floorplan-revisions/${workspace.revisionId}/correction-drafts`,
      {
        method: "POST",
        body: JSON.stringify({ clientOperationId: workspace.correctionDraftOperationId }),
      },
    );
    extractionId = draft.extraction.id;
    workspace.extractionId = extractionId;
  }
  let review: { republishIntent?: { id: string; status: string } | null };
  try {
    review = await api<{ republishIntent?: { id: string; status: string } | null }>(
      `/api/projects/${workspace.projectId}/spatial/floorplan-extractions/${extractionId}/review`,
      {
        method: "POST",
        body: JSON.stringify({
          clientOperationId: workspace.correctionReviewOperationId,
          decision: "approve",
          note: workspace.dirty
            ? "Corrected against the registered Gaussian render in Spatial Studio."
            : "Automatic structure inspected and approved against the registered Gaussian render in Spatial Studio.",
          plan: workspace.plan,
          ...(workspace.republishReleaseId
            ? { republishReleaseId: workspace.republishReleaseId }
            : {}),
          ...(captureAgreementResolutions.length ? { captureAgreementResolutions } : {}),
        }),
      },
    );
  } catch (error) {
    // A clean re-approval of a pre-agreement revision can be rejected with
    // FRESH capture-agreement findings computed on the correction draft the
    // workspace has never seen. Reload so the draft's findings render for
    // classification before the retry — but only when nothing is staged:
    // a dirty workspace must never lose the operator's corrections.
    if (!workspace.dirty) {
      await loadSpatialWorkspace(workspace.projectId, workspace.versionId);
    }
    throw error;
  }
  showToast(review.republishIntent
    ? "Corrections saved; walking-map rebuild and durable republish queued"
    : "Corrections saved; collision and navigation rebuild queued");
  await loadSpatialWorkspace(workspace.projectId, workspace.versionId);
}

function renderFloorplanWorkflow(project: Project, spatial: SpatialWorkspace): HTMLElement {
  const workflow = element("article", "workspace-card-large floorplan-workflow-card");
  workflow.append(
    element("span", "eyebrow", "VENDOR-NEUTRAL FLOOR PLAN"),
    element("h3", "", "Metric capture → operator revision → portable drawings"),
    element(
      "p",
      "muted-copy",
      "Verified PLY, E57, LAS, LAZ, and PTS evidence enters one bounded pipeline. Machine topology is never published directly: an operator corrects it first, and every indicative export is hash-bound to that approved revision.",
    ),
  );
  const assets = floorplanExtractionAssets();
  const runs = spatial.floorplanExtractions ?? [];
  if (!runs.length) {
    workflow.append(
      element(
        "p",
        "muted-copy",
        "No floor-plan extraction has been queued for this immutable version.",
      ),
    );
  }
  for (const run of runs.slice(0, 8)) {
    const card = element("section", "floorplan-run");
    const heading = element("div", "floorplan-run-heading");
    heading.append(
      element("strong", "", run.input_file_name),
      element("span", `status-pill ${statusClass(run.status)}`, humanStatus(run.status)),
    );
    card.append(
      heading,
      element(
        "small",
        "muted-copy",
        `${run.input_format.toUpperCase()} · ${formatBytes(run.input_size_bytes)} · ${run.normalizer} · queued ${parseTimestamp(run.created_at).toLocaleString()}`,
      ),
    );
    const summary = floorplanProposalSummary(run.proposal_json);
    if (summary) {
      const metrics = element("div", "floorplan-run-metrics");
      metrics.append(
        ...(summary.levelCount === null ? [] : [
          element("span", "", `${summary.levelCount} level${summary.levelCount === 1 ? "" : "s"}`),
        ]),
        element("span", "", `${summary.roomCount} room${summary.roomCount === 1 ? "" : "s"}`),
        element("span", "", `${summary.wallCount} wall run${summary.wallCount === 1 ? "" : "s"}`),
        element("span", "", `${summary.openingCount} opening candidate${summary.openingCount === 1 ? "" : "s"}`),
        element("span", "", `${summary.totalRoomAreaM2.toFixed(2)} m² indicative`),
        ...(summary.connectorCount === null ? [] : [
          element("span", "", `${summary.connectorCount} stair/ramp connector${summary.connectorCount === 1 ? "" : "s"}`),
        ]),
      );
      card.append(metrics);
    }
    if (run.job_progress_message) {
      card.append(element("p", "inline-status", run.job_progress_message));
    }
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      card.append(
        element(
          "p",
          run.status === "CANCELLED" ? "field-note" : "form-error",
          processingJobError(run.error_json ?? run.job_error_json),
        ),
      );
    }
    if (run.status === "REVIEWED" || run.status === "REJECTED") {
      card.append(
        element(
          "p",
          "field-note",
          run.status === "REVIEWED"
            ? "Operator correction is preserved as an immutable indicative revision."
            : "The operator rejected this proposal; no floor-plan revision was created.",
        ),
      );
    }
    const actions = element("div", "semantic-extraction-actions");
    if (run.status === "READY_FOR_REVIEW") {
      const review = element("button", "primary-button", "Correct and review plan");
      review.addEventListener("click", () => openFloorplanReviewDialog(run.id));
      actions.append(review);
    }
    if (run.status === "QUEUED" || run.status === "PROCESSING") {
      const cancel = element("button", "danger-button", "Cancel extraction");
      cancel.addEventListener("click", () => {
        if (!confirm("Cancel this floor-plan extraction? Its immutable source will be retained.")) return;
        void runAction({
          key: `cancel-floorplan-extraction:${run.job_id}`,
          trigger: cancel,
          pendingLabel: "Cancelling…",
        }, () => cancelFloorplanExtraction(run.job_id));
      });
      actions.append(cancel);
    }
    if (
      (run.status === "FAILED" || run.status === "CANCELLED") &&
      (run.job_state === "FAILED" || run.job_state === "DEAD_LETTER" ||
        run.job_state === "CANCELLED")
    ) {
      const retry = element("button", "quiet-button", "Retry extraction");
      retry.addEventListener("click", () => {
        void runAction({
          key: `retry-floorplan-extraction:${run.job_id}`,
          trigger: retry,
          pendingLabel: "Queueing retry…",
        }, () => retryFloorplanExtraction(run.job_id));
      });
      actions.append(retry);
    }
    if (actions.childElementCount) card.append(actions);
    workflow.append(card);
  }

  const controls = element("div", "semantic-extraction-actions");
  const queue = element(
    "button",
    "primary-button",
    runs.length ? "Queue another floor plan" : "Generate floor-plan proposal",
  );
  queue.disabled = assets.length === 0;
  queue.title = assets.length
    ? ""
    : "Upload and verify a metric PLY, E57, LAS, LAZ, or PTS asset first.";
  queue.addEventListener("click", openFloorplanExtractionDialog);
  const refresh = element("button", "quiet-button", "Refresh status");
  refresh.addEventListener("click", () => {
    void runAction({
      key: `refresh-floorplans:${project.id}`,
      trigger: refresh,
      pendingLabel: "Refreshing…",
      disable: [queue],
    }, () => loadSpatialWorkspace(project.id));
  });
  controls.append(queue, refresh);
  // Evidence attached after intake — a scanner trajectory, corrected
  // geometry — only reaches a walking map through the automatic lane, and
  // that lane used to run once at capture. Re-running it over the evidence
  // already on this version avoids re-uploading a capture the platform
  // already holds (and would refuse, since registered geometry must carry
  // its original paired-capture receipt).
  const versionId = spatial.version?.id ?? null;
  if (versionId) {
    const rebuild = element("button", "quiet-button", "Rebuild structure from this capture");
    rebuild.addEventListener("click", () => {
      void runAction({
        key: `rebuild-structure:${versionId}`,
        trigger: rebuild,
        pendingLabel: "Queueing rebuild…",
        disable: [queue, refresh],
      }, async () => {
        await api(
          `/api/projects/${project.id}/spatial/versions/${versionId}/structure-rebuilds`,
          {
            method: "POST",
            body: JSON.stringify({ clientOperationId: crypto.randomUUID() }),
          },
        );
        showToast("Structure rebuild queued from the attached capture");
        await loadSpatialWorkspace(project.id);
      });
    });
    controls.append(rebuild);
  }
  workflow.append(
    controls,
    element(
      "small",
      "field-note",
      assets.length
        ? `${assets.length} verified metric point-cloud asset${assets.length === 1 ? "" : "s"} available. Every output remains explicitly indicative.`
        : "A verified metric point cloud is required; visual-only Gaussian splats are not measurement evidence.",
    ),
  );

  for (const revision of (spatial.floorplanRevisions ?? []).slice(0, 5)) {
    const card = element("section", "floorplan-run");
    const heading = element("div", "floorplan-run-heading");
    heading.append(
      element("strong", "", `Revision ${revision.revision_number}`),
      element(
        "span",
        `status-pill ${revision.status === "approved" ? "status-ready" : ""}`,
        `${humanStatus(revision.status)} · indicative`,
      ),
    );
    card.append(
      heading,
      element(
        "small",
        "muted-copy",
        `Approved ${parseTimestamp(revision.approved_at).toLocaleString()} · plan SHA-256 ${revision.plan_hash.slice(0, 16)}…`,
      ),
    );
    if (revision.status === "approved") {
      for (const line of wayfinderRevisionSummaryLines(revision)) {
        card.append(element("small", line.tone === "machine" ? "field-note" : "muted-copy", line.text));
      }
    }
    const exportsForRevision = (spatial.floorplanExports ?? []).filter(
      (item) => item.revision_id === revision.id,
    );
    if (exportsForRevision.length) {
      const downloads = element("div", "floorplan-export-list");
      for (const item of exportsForRevision) {
        const download = element(
          "button",
          "floorplan-export-link",
          `${item.format.toUpperCase()} · ${formatBytes(item.size_bytes)}`,
        );
        const downloadError = element("span", "form-error");
        download.addEventListener("click", () => {
          void runAction({
            key: `download-floorplan-export:${item.id}`,
            trigger: download,
            pendingLabel: "Downloading…",
            errorTarget: downloadError,
          }, () => downloadFloorplanExport(item.download_url, item.file_name));
        });
        downloads.append(download, downloadError);
      }
      card.append(downloads);
    }
    if (revision.status === "approved" && exportsForRevision.length < 3) {
      const generate = element("button", "quiet-button", "Generate SVG, PDF, and DXF");
      generate.addEventListener("click", () => {
        void runAction({
          key: `export-floorplan:${revision.id}`,
          trigger: generate,
          pendingLabel: "Generating exports…",
        }, () => exportFloorplanRevision(revision.id));
      });
      card.append(generate);
    }
    workflow.append(card);
  }
  return workflow;
}

async function loadSpatialWorkspace(projectId: string, requestedVersionId?: string): Promise<void> {
  const versionId = state.selected?.project.id === projectId
    ? requestedVersionId ?? state.spatialVersionId ?? state.selected.versions[0]?.id
    : requestedVersionId;
  const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : "";
  const workspace = await api<SpatialWorkspace>(`/api/projects/${projectId}/spatial${query}`);
  if (state.selected?.project.id !== projectId) return;
  state.spatial = workspace;
  state.spatialProjectId = projectId;
  state.spatialVersionId = workspace.version?.id ?? null;
  if (
    state.view === "project" &&
    ["structure", "privacy", "compare", "walk", "expert"].includes(state.projectSection)
  ) renderSpatial();
  if (state.view === "project" && state.projectSection === "publish") renderPublish();
}

function semanticExtractionAssets(): Asset[] {
  const versionId = state.spatial?.version?.id;
  if (!versionId) return [];
  return (state.selected?.assets ?? []).filter((asset) => (
    asset.version_id === versionId &&
    ["source", "master", "pointcloud"].includes(asset.kind) &&
    asset.format.toLowerCase() === "ply" &&
    asset.integrity_status === "verified"
  ));
}

function openSemanticExtractionDialog(): void {
  const assets = semanticExtractionAssets();
  if (!assets.length) {
    showNotice(
      "Upload and verify a source, master, or point-cloud PLY on this immutable version first.",
      "error",
    );
    return;
  }
  const form = byId<HTMLFormElement>("semanticExtractionForm");
  form.reset();
  const select = byId<HTMLSelectElement>("semanticInputAsset");
  select.replaceChildren();
  for (const asset of assets) {
    select.append(new Option(
      `${asset.file_name} · ${humanStatus(asset.kind)} · ${formatBytes(asset.size_bytes)}`,
      asset.id,
    ));
  }
  byId("semanticExtractionError").textContent = "";
  semanticExtractionOperation = null;
  semanticExtractionDialog.showModal();
}

async function queueSemanticExtraction(form: FormData): Promise<void> {
  const project = state.selected?.project;
  const version = state.spatial?.version;
  if (!project || !version) throw new Error("Open an immutable scene version first.");
  const elevationValue = String(form.get("elevationHintM") ?? "").trim();
  const body = {
    versionId: version.id,
    inputAssetId: String(form.get("inputAssetId") ?? ""),
    coordinateAssurance: "authored_source_to_world_v1",
    sourceToWorld: {
      sourceUpAxis: String(form.get("sourceUpAxis") ?? "Y"),
      worldUnit: String(form.get("worldUnit") ?? "scene_units"),
      metresPerSourceUnit: Number(form.get("metresPerSourceUnit") ?? 1),
      yawDegrees: Number(form.get("yawDegrees") ?? 0),
      translationMetres: [
        Number(form.get("translationX") ?? 0),
        Number(form.get("translationY") ?? 0),
        Number(form.get("translationZ") ?? 0),
      ],
    },
    registrationEvidence: String(form.get("registrationEvidence") ?? "").trim(),
    gridSizeM: Number(form.get("gridSizeM") ?? 0.25),
    floorBandM: Number(form.get("floorBandM") ?? 0.15),
    minimumAreaM2: Number(form.get("minimumAreaM2") ?? 2),
    maximumCandidates: Number(form.get("maximumCandidates") ?? 24),
    maximumSamplePoints: Number(form.get("maximumSamplePoints") ?? 2_000_000),
    elevationHintM: elevationValue === "" ? null : Number(elevationValue),
  };
  const requestKey = JSON.stringify(body);
  if (
    !semanticExtractionOperation ||
    semanticExtractionOperation.requestKey !== requestKey
  ) {
    semanticExtractionOperation = { id: crypto.randomUUID(), requestKey };
  }
  const result = await api<{ extraction: { id: string; status: string } }>(
    `/api/projects/${project.id}/spatial/semantic-extractions`,
    {
      method: "POST",
      body: JSON.stringify({
        clientOperationId: semanticExtractionOperation.id,
        ...body,
      }),
    },
  );
  semanticExtractionOperation = null;
  semanticExtractionDialog.close();
  showToast("Point-cloud semantic extraction queued");
  await loadSpatialWorkspace(project.id);
  void pollSemanticExtraction(project.id, result.extraction.id);
}

function openSemanticReviewDialog(extractionId: string): void {
  const spatial = state.spatial;
  const extraction = spatial?.semanticExtractions.find(
    (candidate) => candidate.id === extractionId,
  );
  if (!spatial || !extraction || extraction.status !== "READY_FOR_REVIEW") {
    showNotice("This extraction is no longer ready for review. Refresh the workspace.", "error");
    return;
  }
  const candidates = spatial.semanticCandidates.filter(
    (candidate) => candidate.extraction_id === extraction.id && candidate.status === "pending",
  );
  if (!candidates.length) {
    showNotice("No pending walkable candidates are available for this extraction.", "error");
    return;
  }
  const form = byId<HTMLFormElement>("semanticReviewForm");
  form.reset();
  const extractionInput = form.elements.namedItem("extractionId");
  if (extractionInput instanceof HTMLInputElement) extractionInput.value = extraction.id;
  byId("semanticReviewContext").textContent =
    `${extraction.input_file_name} produced ${candidates.length} reviewable polygon` +
    `${candidates.length === 1 ? "" : "s"} in ${
      semanticExtractionWorldUnit(extraction) === "scene_units"
        ? "provisional scene units"
        : "metric metres"
    }. Select only regions inspected against the registered point cloud.`;
  const choices = byId("semanticCandidateChoices");
  choices.replaceChildren();
  const unit = worldUnitSymbol(semanticExtractionWorldUnit(extraction));
  for (const candidate of candidates) {
    const label = element("label", "semantic-candidate-choice");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "candidateIds";
    checkbox.value = candidate.id;
    checkbox.checked = true;
    const copy = element("span");
    copy.append(
      element("strong", "", candidate.label),
      element(
        "small",
        "muted-copy",
        `${candidate.area.toFixed(2)} ${unit}² proxy area · elevation ${candidate.elevation.toFixed(2)} ${unit} · ${Math.round(candidate.confidence * 100)}% extraction confidence`,
      ),
    );
    label.append(checkbox, copy);
    choices.append(label);
  }
  byId("semanticReviewError").textContent = "";
  semanticReviewOperation = null;
  updateSemanticReviewChoiceState();
  semanticReviewDialog.showModal();
}

function updateSemanticReviewChoiceState(): void {
  const form = byId<HTMLFormElement>("semanticReviewForm");
  const decision = form.elements.namedItem("decision");
  const rejectAll = decision instanceof HTMLSelectElement && decision.value === "reject_all";
  for (const checkbox of form.querySelectorAll<HTMLInputElement>("input[name='candidateIds']")) {
    checkbox.disabled = rejectAll;
    if (rejectAll) checkbox.checked = false;
  }
}

async function reviewSemanticExtraction(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before reviewing semantic candidates.");
  const extractionId = String(form.get("extractionId") ?? "");
  const decision = String(form.get("decision") ?? "accept_selected");
  const candidateIds = decision === "accept_selected"
    ? form.getAll("candidateIds").map(String)
    : [];
  if (decision === "accept_selected" && candidateIds.length === 0) {
    throw new Error("Select at least one inspected walkable candidate, or reject the whole extraction.");
  }
  const body = {
    decision,
    candidateIds,
    note: String(form.get("note") ?? "").trim(),
  };
  const requestKey = JSON.stringify({ extractionId, ...body });
  if (!semanticReviewOperation || semanticReviewOperation.requestKey !== requestKey) {
    semanticReviewOperation = { id: crypto.randomUUID(), requestKey };
  }
  await api(
    `/api/projects/${project.id}/spatial/semantic-extractions/${extractionId}/review`,
    {
      method: "POST",
      body: JSON.stringify({
        clientOperationId: semanticReviewOperation.id,
        ...body,
      }),
    },
  );
  semanticReviewOperation = null;
  semanticReviewDialog.close();
  showToast(
    decision === "accept_selected"
      ? "Selected polygons added as editable room seeds"
      : "All semantic candidates rejected",
  );
  await loadSpatialWorkspace(project.id);
}

async function retrySemanticExtraction(jobId: string): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before retrying semantic extraction.");
  await api(`/api/jobs/${jobId}/retry`, { method: "POST" });
  showToast("Semantic extraction retry queued");
  await loadSpatialWorkspace(project.id);
  const extraction = state.spatial?.semanticExtractions.find((run) => run.job_id === jobId);
  if (extraction) void pollSemanticExtraction(project.id, extraction.id);
}

async function cancelSemanticExtraction(jobId: string): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before cancelling semantic extraction.");
  await api(`/api/jobs/${jobId}/cancel`, { method: "POST" });
  showToast("Semantic extraction cancelled");
  await loadSpatialWorkspace(project.id);
}

async function pollSemanticExtraction(projectId: string, extractionId: string): Promise<void> {
  const generation = ++semanticExtractionPollGeneration;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, attempt < 4 ? 1_500 : 5_000));
    if (
      generation !== semanticExtractionPollGeneration ||
      !projectPollingContextIsActive(projectId, "structure-processing-poll")
    ) return;
    try {
      await loadSpatialWorkspace(projectId);
    } catch {
      continue;
    }
    const extraction = state.spatial?.semanticExtractions.find(
      (candidate) => candidate.id === extractionId,
    );
    if (!extraction || !["QUEUED", "PROCESSING"].includes(extraction.status)) return;
  }
  if (
    generation === semanticExtractionPollGeneration &&
    projectPollingContextIsActive(projectId, "structure-processing-poll")
  ) {
    showNotice(
      "Semantic extraction is still running. Its verified inputs and queued job are retained; refresh later.",
      "error",
    );
  }
}

function parseSemanticExtractionSummary(value: string | null): {
  candidateCount: number;
  totalCandidateArea: number;
  inferredFloorElevation: number;
} | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const candidateCount = Number(parsed.candidateCount);
    const totalCandidateArea = Number(
      parsed.totalCandidateArea ?? parsed.totalCandidateAreaM2,
    );
    const inferredFloorElevation = Number(
      parsed.inferredFloorElevation ?? parsed.inferredFloorElevationM,
    );
    if (
      !Number.isFinite(candidateCount) ||
      !Number.isFinite(totalCandidateArea) ||
      !Number.isFinite(inferredFloorElevation)
    ) return null;
    return { candidateCount, totalCandidateArea, inferredFloorElevation };
  } catch {
    return null;
  }
}

function semanticExtractionWorldUnit(
  extraction: { parameters_json: string },
): WorldUnit {
  try {
    const parameters = JSON.parse(extraction.parameters_json) as Record<string, unknown>;
    const transform = parameters.sourceToWorld;
    if (transform && typeof transform === "object") {
      return parseWorldUnit(Reflect.get(transform, "worldUnit"));
    }
  } catch {
    // Legacy or malformed extraction evidence remains metric-only.
  }
  return "metres";
}

function floorplanExtractionAssets(): Asset[] {
  const versionId = state.spatial?.version?.id;
  if (!versionId) return [];
  return (state.selected?.assets ?? []).filter((asset) => (
    asset.version_id === versionId &&
    asset.kind === "pointcloud" &&
    ["ply", "e57", "las", "laz", "pts"].includes(asset.format.toLowerCase()) &&
    asset.integrity_status === "verified" &&
    /^[a-f0-9]{64}$/i.test(asset.sha256 ?? "") &&
    asset.size_bytes <= 1024 * 1024 * 1024
  ));
}

function floorplanTrajectoryAssets(): Asset[] {
  const versionId = state.spatial?.version?.id;
  if (!versionId) return [];
  return (state.selected?.assets ?? []).filter((asset) => (
    asset.version_id === versionId &&
    asset.kind === "source" &&
    ["las", "laz"].includes(asset.format.toLowerCase()) &&
    asset.integrity_status === "verified" &&
    /^[a-f0-9]{64}$/i.test(asset.sha256 ?? "") &&
    asset.size_bytes <= 512 * 1024 * 1024
  ));
}

function openFloorplanExtractionDialog(): void {
  const assets = floorplanExtractionAssets();
  if (!assets.length) {
    showNotice(
      "Upload and verify a metric PLY, E57, LAS, LAZ, or PTS asset on this immutable version first.",
      "error",
    );
    return;
  }
  const form = byId<HTMLFormElement>("floorplanExtractionForm");
  form.reset();
  const select = byId<HTMLSelectElement>("floorplanInputAsset");
  select.replaceChildren();
  for (const asset of assets) {
    select.append(new Option(
      `${asset.file_name} · ${asset.format.toUpperCase()} · ${formatBytes(asset.size_bytes)}`,
      asset.id,
    ));
  }
  const trajectorySelect = byId<HTMLSelectElement>("floorplanTrajectoryAsset");
  trajectorySelect.replaceChildren(new Option("None — no traversal evidence", ""));
  for (const asset of floorplanTrajectoryAssets()) {
    trajectorySelect.append(new Option(
      `${asset.file_name} · ${asset.format.toUpperCase()} · ${formatBytes(asset.size_bytes)}`,
      asset.id,
    ));
  }
  byId("floorplanExtractionError").textContent = "";
  floorplanExtractionOperation = null;
  floorplanExtractionDialog.showModal();
}

async function queueFloorplanExtraction(form: FormData): Promise<void> {
  const project = state.selected?.project;
  const version = state.spatial?.version;
  if (!project || !version) throw new Error("Open an immutable scene version first.");
  const elevationValue = String(form.get("elevationHintM") ?? "").trim();
  const trajectoryValue = String(form.get("trajectoryAssetId") ?? "").trim();
  const body = {
    versionId: version.id,
    inputAssetId: String(form.get("inputAssetId") ?? ""),
    ...(trajectoryValue ? { trajectoryAssetId: trajectoryValue } : {}),
    coordinateAssurance: "registered_y_up_metric_frame",
    sourceUpAxis: String(form.get("sourceUpAxis") ?? "y"),
    registrationEvidence: String(form.get("registrationEvidence") ?? "").trim(),
    gridSizeM: Number(form.get("gridSizeM") ?? 0.25),
    floorBandM: Number(form.get("floorBandM") ?? 0.15),
    wallMinHeightM: Number(form.get("wallMinHeightM") ?? 0.25),
    wallMaxHeightM: Number(form.get("wallMaxHeightM") ?? 2.5),
    minimumWallHeightCoverage: Number(form.get("minimumWallHeightCoverage") ?? 0.45),
    minimumRoomAreaM2: Number(form.get("minimumRoomAreaM2") ?? 2),
    maximumOpeningWidthM: Number(form.get("maximumOpeningWidthM") ?? 1.25),
    maximumRooms: Number(form.get("maximumRooms") ?? 100),
    maximumSamplePoints: Number(form.get("maximumSamplePoints") ?? 2_000_000),
    elevationHintM: elevationValue === "" ? null : Number(elevationValue),
  };
  const requestKey = JSON.stringify(body);
  if (!floorplanExtractionOperation || floorplanExtractionOperation.requestKey !== requestKey) {
    floorplanExtractionOperation = { id: crypto.randomUUID(), requestKey };
  }
  const result = await api<{ extraction: { id: string } }>(
    `/api/projects/${project.id}/spatial/floorplan-extractions`,
    {
      method: "POST",
      body: JSON.stringify({
        clientOperationId: floorplanExtractionOperation.id,
        ...body,
      }),
    },
  );
  floorplanExtractionOperation = null;
  floorplanExtractionDialog.close();
  showToast("Vendor-neutral floor-plan extraction queued");
  await loadSpatialWorkspace(project.id);
  void pollFloorplanExtraction(project.id, result.extraction.id);
}

function floorplanProposalSummary(value: string | null): {
  roomCount: number;
  wallCount: number;
  openingCount: number;
  totalRoomAreaM2: number;
  levelCount: number | null;
  connectorCount: number | null;
} | null {
  if (!value) return null;
  try {
    const proposal = JSON.parse(value) as Record<string, unknown>;
    const summary = proposal.summary;
    if (!summary || typeof summary !== "object") return null;
    const roomCount = Number(Reflect.get(summary, "roomCount"));
    const wallCount = Number(Reflect.get(summary, "wallCount"));
    const openingCount = Number(Reflect.get(summary, "openingCount"));
    const totalRoomAreaM2 = Number(Reflect.get(summary, "totalRoomAreaM2"));
    if ([roomCount, wallCount, openingCount, totalRoomAreaM2].some((item) => !Number.isFinite(item))) {
      return null;
    }
    const rawLevelCount = Reflect.get(summary, "levelCount");
    const rawConnectorCount = Reflect.get(summary, "connectorCount");
    const levelCount = rawLevelCount === undefined ? null : Number(rawLevelCount);
    const connectorCount = rawConnectorCount === undefined ? null : Number(rawConnectorCount);
    if ((levelCount !== null && !Number.isFinite(levelCount)) ||
      (connectorCount !== null && !Number.isFinite(connectorCount))) return null;
    return { roomCount, wallCount, openingCount, totalRoomAreaM2, levelCount, connectorCount };
  } catch {
    return null;
  }
}

function openFloorplanReviewDialog(extractionId: string): void {
  const extraction = state.spatial?.floorplanExtractions.find((item) => item.id === extractionId);
  if (!extraction || extraction.status !== "READY_FOR_REVIEW" || !extraction.proposal_json) {
    showNotice("This floor-plan proposal is no longer ready for review. Refresh the workspace.", "error");
    return;
  }
  let plan: EditableFloorplan;
  try {
    plan = floorplanProposalToEditablePlan(extraction.proposal_json);
  } catch (error) {
    showNotice(errorMessage(error), "error");
    return;
  }
  const form = byId<HTMLFormElement>("floorplanReviewForm");
  form.reset();
  const extractionInput = form.elements.namedItem("extractionId");
  if (extractionInput instanceof HTMLInputElement) extractionInput.value = extraction.id;
  byId("floorplanReviewContext").textContent =
    `${extraction.input_file_name} was normalized with ${extraction.normalizer}. ` +
    "Correct labels, polygons, wall endpoints, and opening classifications against the immutable source.";
  byId<HTMLTextAreaElement>("floorplanPlanEditor").value = JSON.stringify(plan, null, 2);
  byId("floorplanReviewError").textContent = "";
  floorplanReviewOperation = null;
  updateFloorplanReviewState();
  updateFloorplanReviewPreview();
  floorplanReviewDialog.showModal();
}

function floorplanProposalToEditablePlan(proposalJson: string): EditableFloorplan {
  const proposal = JSON.parse(proposalJson) as Record<string, unknown>;
  const rooms = Array.isArray(proposal.rooms) ? proposal.rooms : [];
  const walls = Array.isArray(proposal.walls) ? proposal.walls : [];
  const openings = Array.isArray(proposal.openings) ? proposal.openings : [];
  const proposalLevels = Array.isArray(proposal.levels) ? proposal.levels : [];
  const proposalConnectors = Array.isArray(proposal.connectors) ? proposal.connectors : [];
  if (!rooms.length || !walls.length) {
    throw new Error("The stored proposal has no reviewable rooms or walls.");
  }
  const proposalSummary = proposal.summary;
  const elevationM = Number(
    proposalSummary && typeof proposalSummary === "object"
      ? Reflect.get(proposalSummary, "inferredFloorElevationM")
      : 0,
  );
  const inferredCeiling = proposalSummary && typeof proposalSummary === "object"
    ? Reflect.get(proposalSummary, "inferredCeilingElevationM")
    : null;
  const inferredCeilingElevationM = typeof inferredCeiling === "number" &&
      Number.isFinite(inferredCeiling)
    ? inferredCeiling
    : null;
  const toPoint2 = (value: unknown): [number, number] => {
    if (!Array.isArray(value) || value.length !== 3) throw new Error("Proposal geometry is malformed.");
    const point = value.map(Number);
    if (point.some((coordinate) => !Number.isFinite(coordinate))) {
      throw new Error("Proposal geometry contains a non-finite coordinate.");
    }
    return [point[0]!, point[2]!];
  };
  const toPoint3 = (value: unknown): [number, number, number] => {
    if (!Array.isArray(value) || value.length !== 3) throw new Error("Proposal geometry is malformed.");
    const point = value.map(Number);
    if (point.some((coordinate) => !Number.isFinite(coordinate))) {
      throw new Error("Proposal geometry contains a non-finite coordinate.");
    }
    return [point[0]!, point[1]!, point[2]!];
  };
  const candidateKey = (candidate: unknown, property: string): string =>
    candidate && typeof candidate === "object" ? String(Reflect.get(candidate, property) ?? "") : "";
  const selectCandidates = (
    candidates: unknown[],
    property: string,
    keys: unknown,
    levelKey: string,
  ): unknown[] => {
    if (Array.isArray(keys)) {
      const selected = new Set(keys.map(String));
      return candidates.filter((candidate) => selected.has(candidateKey(candidate, property)));
    }
    return candidates.filter((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const evidence = Reflect.get(candidate, "evidence");
      return evidence && typeof evidence === "object" &&
        Reflect.get(evidence, "levelKey") === levelKey;
    });
  };
  const editableRoom = (candidate: unknown, index: number) => {
    const room = candidate as Record<string, unknown>;
    const geometry = room.geometry as Record<string, unknown>;
    if (!Array.isArray(geometry?.points)) throw new Error("A proposed room is missing its polygon.");
    return {
      id: String(room.roomKey ?? `room-${index + 1}`),
      label: String(room.label ?? `Room ${index + 1}`),
      points: geometry.points.map(toPoint2),
    };
  };
  const editableWall = (candidate: unknown, index: number) => {
    const wall = candidate as Record<string, unknown>;
    const geometry = wall.geometry as Record<string, unknown>;
    if (!Array.isArray(geometry?.points) || geometry.points.length !== 2) {
      throw new Error("A proposed wall is missing its endpoints.");
    }
    return {
      id: String(wall.wallKey ?? `wall-${index + 1}`),
      label: String(wall.label ?? `Wall ${index + 1}`),
      start: toPoint2(geometry.points[0]),
      end: toPoint2(geometry.points[1]),
      thicknessM: Number(wall.thicknessM ?? 0.2),
      heightM: Number(wall.heightM ?? 2.5),
    };
  };
  const editableOpening = (candidate: unknown, index: number) => {
    const opening = candidate as Record<string, unknown>;
    const geometry = opening.geometry as Record<string, unknown>;
    if (!Array.isArray(geometry?.points) || geometry.points.length !== 2) {
      throw new Error("A proposed opening is missing its endpoints.");
    }
    return {
      id: String(opening.openingKey ?? `opening-${index + 1}`),
      label: String(opening.label ?? `Opening ${index + 1}`),
      type: "unknown" as const,
      wallId: null,
      start: toPoint2(geometry.points[0]),
      end: toPoint2(geometry.points[1]),
      widthM: Number(opening.widthM),
      heightM: null,
    };
  };
  const levels = proposalLevels.length
    ? proposalLevels.map((candidate, index) => {
        if (!candidate || typeof candidate !== "object") {
          throw new Error("A proposed level is malformed.");
        }
        const level = candidate as Record<string, unknown>;
        const levelKey = String(level.levelKey ?? `level-${index + 1}`);
        return {
          id: levelKey,
          label: String(level.label ?? `Level ${index + 1}`),
          elevationM: Number(level.elevationM),
          ceilingElevationM: typeof level.ceilingElevationM === "number" &&
              Number.isFinite(level.ceilingElevationM)
            ? level.ceilingElevationM
            : null,
          rooms: selectCandidates(rooms, "roomKey", level.roomKeys, levelKey).map(editableRoom),
          walls: selectCandidates(walls, "wallKey", level.wallKeys, levelKey).map(editableWall),
          openings: selectCandidates(
            openings,
            "openingKey",
            level.openingKeys,
            levelKey,
          ).map(editableOpening),
        };
      })
    : [{
        id: "level-1",
        label: "Level 1",
        elevationM: Number.isFinite(elevationM) ? elevationM : 0,
        ceilingElevationM: inferredCeilingElevationM,
        rooms: rooms.map(editableRoom),
        walls: walls.map(editableWall),
        openings: openings.map(editableOpening),
      }];
  return {
    schemaVersion: "1.0.0",
    units: "metres",
    coordinateFrame: "registered_y_up_metric_frame",
    levels,
    connectors: proposalConnectors.map((candidate, index) => {
      if (!candidate || typeof candidate !== "object") {
        throw new Error("A proposed connector is malformed.");
      }
      const connector = candidate as Record<string, unknown>;
      const geometry = connector.geometry as Record<string, unknown>;
      if (!Array.isArray(geometry?.points)) {
        throw new Error("A proposed connector is missing its surface.");
      }
      return {
        id: String(connector.connectorKey ?? `connector-${index + 1}`),
        label: String(connector.label ?? `Connector ${index + 1}`),
        type: "unknown" as const,
        lowerLevelId: String(connector.lowerLevelKey ?? ""),
        upperLevelId: String(connector.upperLevelKey ?? ""),
        points: geometry.points.map(toPoint3),
      };
    }),
  };
}

function parseEditableFloorplan(value: string): EditableFloorplan {
  let plan: unknown;
  try {
    plan = JSON.parse(value);
  } catch {
    throw new Error("The structured plan is not valid JSON.");
  }
  if (!plan || typeof plan !== "object") throw new Error("The structured plan must be an object.");
  if (
    Reflect.get(plan, "schemaVersion") !== "1.0.0" ||
    Reflect.get(plan, "units") !== "metres" ||
    Reflect.get(plan, "coordinateFrame") !== "registered_y_up_metric_frame"
  ) {
    throw new Error("Keep schemaVersion 1.0.0, metres, and the registered Y-up metric frame.");
  }
  const levels = Reflect.get(plan, "levels");
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error("The corrected plan needs at least one level.");
  }
  const finitePoint = (point: unknown): point is [number, number] =>
    Array.isArray(point) && point.length === 2 && point.every((value) => Number.isFinite(value));
  const finitePoint3 = (point: unknown): point is [number, number, number] =>
    Array.isArray(point) && point.length === 3 && point.every((value) => Number.isFinite(value));
  const levelIds = new Set<string>();
  for (const level of levels) {
    if (!level || typeof level !== "object") throw new Error("Every level must be an object.");
    if (
      !Array.isArray(Reflect.get(level, "rooms")) ||
      !Array.isArray(Reflect.get(level, "walls")) ||
      !Array.isArray(Reflect.get(level, "openings"))
    ) {
      throw new Error("Every level needs room, wall, and opening arrays.");
    }
    const levelId = String(Reflect.get(level, "id") ?? "");
    if (!levelId || levelIds.has(levelId)) throw new Error("Every level needs a unique id.");
    levelIds.add(levelId);
    const ceilingElevation = Reflect.get(level, "ceilingElevationM");
    if (ceilingElevation !== null &&
      (typeof ceilingElevation !== "number" || !Number.isFinite(ceilingElevation))) {
      throw new Error("Every level ceilingElevationM must be a finite metre value or null.");
    }
    for (const room of Reflect.get(level, "rooms") as unknown[]) {
      const points = room && typeof room === "object" ? Reflect.get(room, "points") : null;
      if (!Array.isArray(points) || points.length < 3 || !points.every(finitePoint)) {
        throw new Error("Every room needs at least three finite [x, z] points.");
      }
    }
    for (const wall of Reflect.get(level, "walls") as unknown[]) {
      if (
        !wall || typeof wall !== "object" ||
        !finitePoint(Reflect.get(wall, "start")) ||
        !finitePoint(Reflect.get(wall, "end"))
      ) throw new Error("Every wall needs finite start and end points.");
    }
  }
  const connectorValue = Reflect.get(plan, "connectors");
  const connectors = connectorValue === undefined ? [] : connectorValue;
  if (!Array.isArray(connectors)) throw new Error("The corrected plan connectors must be an array.");
  if (connectorValue === undefined) Reflect.set(plan, "connectors", connectors);
  for (const connector of connectors) {
    if (!connector || typeof connector !== "object") {
      throw new Error("Every connector must be an object.");
    }
    const points = Reflect.get(connector, "points");
    if (!Array.isArray(points) || points.length < 4 || !points.every(finitePoint3)) {
      throw new Error("Every connector needs at least four finite [x, y, z] points.");
    }
    if (!levelIds.has(String(Reflect.get(connector, "lowerLevelId") ?? "")) ||
      !levelIds.has(String(Reflect.get(connector, "upperLevelId") ?? ""))) {
      throw new Error("Every connector must reference two levels in this plan.");
    }
  }
  return plan as EditableFloorplan;
}

function updateFloorplanReviewState(): void {
  const form = byId<HTMLFormElement>("floorplanReviewForm");
  const decision = form.elements.namedItem("decision");
  const reject = decision instanceof HTMLSelectElement && decision.value === "reject";
  const editor = byId<HTMLTextAreaElement>("floorplanPlanEditor");
  editor.disabled = reject;
  editor.required = !reject;
  byId("floorplanReviewPreview").toggleAttribute("hidden", reject);
  byId("floorplanReviewValidation").textContent = reject
    ? "Rejecting preserves the source and proposal evidence but creates no plan revision."
    : "";
  if (!reject) updateFloorplanReviewPreview();
}

function updateFloorplanReviewPreview(): void {
  const preview = byId("floorplanReviewPreview");
  const validation = byId("floorplanReviewValidation");
  preview.replaceChildren();
  try {
    const plan = parseEditableFloorplan(byId<HTMLTextAreaElement>("floorplanPlanEditor").value);
    for (const level of plan.levels) {
      preview.append(floorplanLevelPreview(level, plan.connectors));
    }
    validation.classList.remove("floorplan-json-invalid");
    const roomCount = plan.levels.reduce((sum, level) => sum + level.rooms.length, 0);
    const wallCount = plan.levels.reduce((sum, level) => sum + level.walls.length, 0);
    const openingCount = plan.levels.reduce((sum, level) => sum + level.openings.length, 0);
    validation.textContent =
      `${plan.levels.length} levels · ${roomCount} rooms · ${wallCount} walls · ` +
      `${openingCount} openings · ${plan.connectors.length} stair/ramp connectors`;
  } catch (error) {
    validation.classList.add("floorplan-json-invalid");
    validation.textContent = errorMessage(error);
    preview.append(emptyState("Fix the structured plan to restore the live preview."));
  }
}

function floorplanLevelPreview(
  level: EditableFloorplan["levels"][number],
  connectors: EditableFloorplan["connectors"],
): HTMLElement {
  const levelConnectors = connectors.filter((connector) =>
    connector.lowerLevelId === level.id || connector.upperLevelId === level.id);
  const allPoints = [
    ...level.rooms.flatMap((room) => room.points),
    ...level.walls.flatMap((wall) => [wall.start, wall.end]),
    ...level.openings.flatMap((opening) => [opening.start, opening.end]),
    ...levelConnectors.flatMap((connector) =>
      connector.points.map((point) => [point[0], point[2]] as [number, number])),
  ];
  const minX = Math.min(...allPoints.map((point) => point[0]));
  const maxX = Math.max(...allPoints.map((point) => point[0]));
  const minZ = Math.min(...allPoints.map((point) => point[1]));
  const maxZ = Math.max(...allPoints.map((point) => point[1]));
  const width = 640;
  const height = 400;
  const padding = 28;
  const scale = Math.min(
    (width - padding * 2) / Math.max(0.1, maxX - minX),
    (height - padding * 2) / Math.max(0.1, maxZ - minZ),
  );
  const x = (value: number) => padding + (value - minX) * scale;
  const y = (value: number) => height - padding - (value - minZ) * scale;
  const figure = document.createElement("figure");
  figure.className = "floorplan-level-preview";
  const caption = document.createElement("figcaption");
  caption.textContent = `${level.label} · ${level.elevationM.toFixed(2)} m`;
  figure.append(caption);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${level.label} floor-plan preview`);
  for (const room of level.rooms) {
    const polygon = document.createElementNS(svg.namespaceURI, "polygon");
    polygon.setAttribute("points", room.points.map((point) => `${x(point[0])},${y(point[1])}`).join(" "));
    polygon.setAttribute("class", "preview-room");
    svg.append(polygon);
    const center = room.points.reduce(
      (sum, point) => [sum[0] + point[0], sum[1] + point[1]] as [number, number],
      [0, 0],
    ).map((value) => value / room.points.length) as [number, number];
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", String(x(center[0])));
    label.setAttribute("y", String(y(center[1])));
    label.setAttribute("class", "preview-label");
    label.textContent = room.label;
    svg.append(label);
  }
  for (const wall of level.walls) {
    svg.append(floorplanPreviewLine(wall.start, wall.end, "preview-wall", x, y));
  }
  for (const opening of level.openings) {
    svg.append(floorplanPreviewLine(opening.start, opening.end, "preview-opening", x, y));
  }
  for (const connector of levelConnectors) {
    const polygon = document.createElementNS(svg.namespaceURI, "polygon");
    polygon.setAttribute("points", connector.points
      .map((point) => `${x(point[0])},${y(point[2])}`).join(" "));
    polygon.setAttribute("class", "preview-connector");
    svg.append(polygon);
  }
  figure.append(svg);
  return figure;
}

function floorplanPreviewLine(
  start: [number, number],
  end: [number, number],
  className: string,
  x: (value: number) => number,
  y: (value: number) => number,
): SVGLineElement {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(x(start[0])));
  line.setAttribute("y1", String(y(start[1])));
  line.setAttribute("x2", String(x(end[0])));
  line.setAttribute("y2", String(y(end[1])));
  line.setAttribute("class", className);
  return line;
}

async function reviewFloorplanExtraction(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before reviewing a floor plan.");
  const extractionId = String(form.get("extractionId") ?? "");
  const decision = String(form.get("decision") ?? "approve");
  const plan = decision === "approve"
    ? parseEditableFloorplan(String(form.get("planJson") ?? ""))
    : null;
  const body = {
    decision,
    note: String(form.get("note") ?? "").trim(),
    plan,
  };
  const requestKey = JSON.stringify({ extractionId, ...body });
  if (!floorplanReviewOperation || floorplanReviewOperation.requestKey !== requestKey) {
    floorplanReviewOperation = { id: crypto.randomUUID(), requestKey };
  }
  await api(
    `/api/projects/${project.id}/spatial/floorplan-extractions/${extractionId}/review`,
    {
      method: "POST",
      body: JSON.stringify({
        clientOperationId: floorplanReviewOperation.id,
        ...body,
      }),
    },
  );
  floorplanReviewOperation = null;
  floorplanReviewDialog.close();
  showToast(decision === "approve"
    ? "Indicative floor-plan revision approved"
    : "Floor-plan proposal rejected");
  await loadSpatialWorkspace(project.id);
}

async function retryFloorplanExtraction(jobId: string): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before retrying floor-plan extraction.");
  await api(`/api/jobs/${jobId}/retry`, { method: "POST" });
  showToast("Floor-plan extraction retry queued");
  await loadSpatialWorkspace(project.id);
  const extraction = state.spatial?.floorplanExtractions.find((run) => run.job_id === jobId);
  if (extraction) void pollFloorplanExtraction(project.id, extraction.id);
}

async function cancelFloorplanExtraction(jobId: string): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before cancelling floor-plan extraction.");
  await api(`/api/jobs/${jobId}/cancel`, { method: "POST" });
  showToast("Floor-plan extraction cancelled");
  await loadSpatialWorkspace(project.id);
}

async function pollFloorplanExtraction(projectId: string, extractionId: string): Promise<void> {
  const generation = ++floorplanExtractionPollGeneration;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, attempt < 4 ? 1_500 : 5_000));
    if (
      generation !== floorplanExtractionPollGeneration ||
      !projectPollingContextIsActive(projectId, "structure-processing-poll")
    ) return;
    try {
      await loadSpatialWorkspace(projectId);
    } catch {
      continue;
    }
    const extraction = state.spatial?.floorplanExtractions.find(
      (candidate) => candidate.id === extractionId,
    );
    if (!extraction || !["QUEUED", "PROCESSING"].includes(extraction.status)) return;
  }
  if (
    generation === floorplanExtractionPollGeneration &&
    projectPollingContextIsActive(projectId, "structure-processing-poll")
  ) {
    showNotice(
      "Floor-plan extraction is still running. Its immutable inputs and queued job are retained; refresh later.",
      "error",
    );
  }
}

async function exportFloorplanRevision(revisionId: string): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before exporting its floor plan.");
  const formats = ["dxf", "pdf", "svg"];
  const requestKey = JSON.stringify({ revisionId, formats });
  const prior = floorplanExportOperations.get(revisionId);
  const operation = prior?.requestKey === requestKey
    ? prior
    : { id: crypto.randomUUID(), requestKey };
  floorplanExportOperations.set(revisionId, operation);
  await api(
    `/api/projects/${project.id}/spatial/floorplan-revisions/${revisionId}/exports`,
    {
      method: "POST",
      body: JSON.stringify({
        clientOperationId: operation.id,
        formats,
      }),
    },
  );
  floorplanExportOperations.delete(revisionId);
  showToast("Indicative SVG, PDF, and DXF exports are ready");
  await loadSpatialWorkspace(project.id);
}

async function downloadFloorplanExport(downloadUrl: string, fallbackFileName: string): Promise<void> {
  const file = await apiFile(downloadUrl, { timeoutMs: 30_000, retries: 2 });
  const objectUrl = URL.createObjectURL(file.blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = file.fileName ?? fallbackFileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  showToast(`${anchor.download} downloaded`);
}

function processingJobError(value: string | null): string {
  if (!value) return "The processor did not return a structured failure reason.";
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // Retain the bounded fallback rather than exposing an untrusted raw payload.
  }
  return "The processor reported a failure. Retry the retained job or inspect its evidence log.";
}

function openSpatialEntityDialog(entity: SpatialEntity | null): void {
  const form = byId<HTMLFormElement>("entityForm");
  form.reset();
  editingSpatialEntity = entity;
  const kind = form.elements.namedItem("kind");
  if (kind instanceof HTMLSelectElement) {
    kind.disabled = Boolean(entity);
    if (entity) kind.value = entity.kind;
  }
  const submit = form.querySelector<HTMLButtonElement>("[type='submit']")!;
  submit.textContent = entity ? "Save spatial entity" : "Add spatial entity";
  if (entity) {
    setFormValue(form, "label", entity.label);
    setFormValue(form, "description", entity.description ?? "");
    if (entity.position_json) {
      try {
        const position = JSON.parse(entity.position_json);
        if (validNumberTuple(position)) setFormValue(form, "position", position.join(", "));
      } catch {
        // The server remains the source of truth for malformed legacy values.
      }
    }
    if (entity.geometry_json) {
      try {
        const geometry = JSON.parse(entity.geometry_json) as {
          type?: string;
          points?: unknown[];
        };
        if (geometry.type === "box" && geometry.points?.length === 2) {
          setFormValue(
            form,
            "bounds",
            `${String(geometry.points[0])} → ${String(geometry.points[1])}`,
          );
        } else if (geometry.type === "polygon" && Array.isArray(geometry.points)) {
          setFormValue(
            form,
            "polygon",
            geometry.points.map((point) => String(point)).join("\n"),
          );
        }
      } catch {
        // Keep the editor empty instead of exposing malformed legacy JSON.
      }
    }
  }
  byId("entityError").textContent = "";
  entityDialog.showModal();
}

async function createSpatialEntity(form: FormData): Promise<void> {
  const project = state.selected?.project;
  const version = state.spatial?.version;
  if (!project || !version) throw new Error("Open an immutable scene version first.");
  const position = parsePosition(String(form.get("position") ?? ""));
  const bounds = parseWalkableBounds(String(form.get("bounds") ?? ""));
  const polygon = parseWalkablePolygon(String(form.get("polygon") ?? ""));
  if (bounds && polygon) {
    throw new Error("Use either walkable bounds or a polygon, not both.");
  }
  const geometry = polygon ?? bounds;
  const kind = String(form.get("kind") ?? "room");
  if (editingSpatialEntity) {
    await api(
      `/api/projects/${project.id}/spatial/entities/${editingSpatialEntity.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          label: String(form.get("label") ?? ""),
          description: optionalString(form.get("description")) ?? null,
          position,
          geometry,
        }),
      },
    );
    editingSpatialEntity = null;
    entityDialog.close();
    showToast("Spatial entity updated");
    await loadSpatialWorkspace(project.id);
    return;
  }
  if (kind === "navigation_obstacle") {
    if (!geometry || geometry.type !== "box") {
      throw new Error("Navigation obstacles require two opposing bounds corners.");
    }
    await api(`/api/projects/${project.id}/spatial/navigation-obstacles`, {
      method: "POST",
      body: JSON.stringify({
        clientOperationId: crypto.randomUUID(),
        versionId: version.id,
        label: String(form.get("label") ?? ""),
        geometry,
        metadata: {
          description: optionalString(form.get("description")) ?? null,
        },
      }),
    });
    entityDialog.close();
    showToast("Navigation obstacle added");
    await loadSpatialWorkspace(project.id);
    return;
  }
  await api(`/api/projects/${project.id}/spatial/entities`, {
    method: "POST",
    body: JSON.stringify({
      clientOperationId: crypto.randomUUID(),
      versionId: version.id,
      kind,
      label: String(form.get("label") ?? ""),
      description: optionalString(form.get("description")) ?? null,
      position,
      geometry,
      metadata: {},
    }),
  });
  entityDialog.close();
  showToast("Spatial entity added");
  await loadSpatialWorkspace(project.id);
}

async function archiveNavigationObstacle(obstacleId: string): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  await api(
    `/api/projects/${project.id}/spatial/navigation-obstacles/${obstacleId}`,
    { method: "DELETE" },
  );
  showToast("Navigation obstacle archived");
  await loadSpatialWorkspace(project.id);
}

function openNavigationProfileDialog(): void {
  const profile = state.spatial?.navigationProfile;
  if (!profile) return;
  const form = byId<HTMLFormElement>("navigationProfileForm");
  const versionPolicy = state.selected
    ? effectiveVersionWorkflowPolicy(
      state.selected.project,
      state.selected.versions.find((version) => version.id === state.spatial?.version?.id),
    )
    : legacyUnspecifiedProjectWorkflowPolicy;
  setFormValue(form, "worldUnit", profile.worldUnit ?? "metres");
  setFormValue(form, "agentRadius", String(profile.agentRadius));
  setFormValue(form, "agentHeight", String(profile.agentHeight));
  setFormValue(form, "eyeHeight", String(profile.eyeHeight));
  setFormValue(form, "maxStepMetres", String(profile.maxStepMetres));
  setFormValue(form, "maxSlopeDegrees", String(profile.maxSlopeDegrees ?? 45));
  setFormValue(form, "maxSpeed", String(profile.maxSpeed ?? 1.6));
  setFormValue(form, "maxAcceleration", String(profile.maxAcceleration ?? 8));
  form.dataset.approvedClearance = JSON.stringify({
    agentRadius: profile.agentRadius,
    maxStepMetres: profile.maxStepMetres,
    maxSlopeDegrees: profile.maxSlopeDegrees ?? 45,
  });
  setFormValue(
    form,
    "clearancePreset",
    versionPolicy.navigationClearance,
  );
  const adaOption = form.querySelector<HTMLOptionElement>(
    'select[name="clearancePreset"] option[value="ada-route-review"]',
  );
  if (adaOption) {
    adaOption.disabled = profile.worldUnit !== "metres";
    adaOption.title = adaOption.disabled
      ? "Metric registration is required before applying a standards-based clearance review."
      : "";
  }
  setFormValue(
    form,
    "navigationIntent",
    versionPolicy.navigation,
  );
  for (const fieldName of ["navigationIntent", "clearancePreset"]) {
    const control = form.elements.namedItem(fieldName);
    if (control instanceof HTMLSelectElement) {
      control.disabled = true;
      control.title = "This value is fixed by the immutable policy for this scene version.";
    }
  }
  byId("navigationProfileSummary").textContent =
    `${profile.worldUnit === "scene_units" ? "Provisional scene-unit" : "Metric"} profile · ` +
    `${profile.agentRadius} ${worldUnitSymbol(profile.worldUnit)} radius · ` +
    `${profile.agentHeight} ${worldUnitSymbol(profile.worldUnit)} standing height · ` +
    `${profile.maxStepMetres} ${worldUnitSymbol(profile.worldUnit)} maximum step.`;
  syncNavigationClearancePreset(form, true);
  byId("navigationProfileError").textContent = "";
  navigationProfileDialog.showModal();
}

function syncNavigationClearancePreset(form: HTMLFormElement, applyValues: boolean): void {
  const presetControl = form.elements.namedItem("clearancePreset");
  if (!(presetControl instanceof HTMLSelectElement)) return;
  const preset = presetControl.value as NavigationClearancePresetId;
  const worldUnit = form.elements.namedItem("worldUnit");
  if (
    preset === "ada-route-review" &&
    (!(worldUnit instanceof HTMLSelectElement) || worldUnit.value !== "metres")
  ) {
    presetControl.value = "approved-scene";
    showNotice(
      "The US ADA route review needs an accepted metric registration. Keep the approved scene profile until this version has metre evidence.",
      "error",
    );
  }
  const selected = presetControl.value as NavigationClearancePresetId;
  if (applyValues && selected === "ada-route-review") {
    setFormValue(form, "agentRadius", String(adaRouteReviewClearance.agentRadius));
    setFormValue(form, "maxStepMetres", String(adaRouteReviewClearance.maxStepMetres));
    setFormValue(form, "maxSlopeDegrees", String(adaRouteReviewClearance.maxSlopeDegrees));
  } else if (applyValues && selected === "approved-scene") {
    try {
      const approved = JSON.parse(form.dataset.approvedClearance ?? "{}") as Record<string, unknown>;
      for (const name of ["agentRadius", "maxStepMetres", "maxSlopeDegrees"]) {
        const value = Reflect.get(approved, name);
        if (typeof value === "number" && Number.isFinite(value)) {
          setFormValue(form, name, String(value));
        }
      }
    } catch {
      // The immutable profile values are still present in the form.
    }
  }
  byId("navigationClearancePresetSummary").textContent =
    navigationClearancePresetSummary(selected);
  byId<HTMLDetailsElement>("navigationExpertSettings").open = selected === "custom";
}

async function updateNavigationProfile(form: FormData): Promise<void> {
  const project = state.selected?.project;
  const version = state.spatial?.version;
  if (!project || !version) throw new Error("Open an immutable scene version first.");
  await api(`/api/projects/${project.id}/spatial/navigation-profile`, {
    method: "PUT",
    body: JSON.stringify({
      versionId: version.id,
      worldUnit: String(form.get("worldUnit") ?? "metres"),
      agentRadius: Number(form.get("agentRadius")),
      agentHeight: Number(form.get("agentHeight")),
      eyeHeight: Number(form.get("eyeHeight")),
      maxStepMetres: Number(form.get("maxStepMetres")),
      maxSlopeDegrees: Number(form.get("maxSlopeDegrees")),
      maxSpeed: Number(form.get("maxSpeed")),
      maxAcceleration: Number(form.get("maxAcceleration")),
    }),
  });
  navigationProfileDialog.close();
  showToast("Navigation profile updated");
  await loadSpatialWorkspace(project.id);
}

function openNavigationTraversalDialog(
  traversal: SpatialWorkspace["navigationTraversals"][number] | null = null,
): void {
  const spatial = state.spatial;
  if (!spatial?.version) return;
  const form = byId<HTMLFormElement>("navigationTraversalForm");
  form.reset();
  editingNavigationTraversal = traversal;
  const evidenceOptions = navigationEvidenceOptions();
  if (!evidenceOptions.length) {
    showNotice(
      "Accept a non-blocked capture contract with a numerical capture-to-scene registration and immutable traversal evidence before authoring a traversal.",
      "error",
    );
    return;
  }
  const evidenceSelect = byId<HTMLSelectElement>("navigationTraversalEvidenceAsset");
  evidenceSelect.replaceChildren(...evidenceOptions.map((option) => new Option(
    `${option.fileName} · ${captureAdapterDisplayLabel(option.adapter)} capture · registration ${option.registrationSha256.slice(0, 12)}…`,
    `${option.manifestId}|${option.assetId}`,
  )));
  if (traversal) {
    setFormValue(form, "traversalKind", traversal.traversal_kind);
    setFormValue(form, "label", traversal.label);
    try {
      const path = traversal.evidence_source_path_json
        ? JSON.parse(traversal.evidence_source_path_json) as unknown
        : null;
      if (Array.isArray(path)) {
        setFormValue(form, "sourcePath", path.map((point) => String(point)).join("\n"));
      } else {
        showNotice(
          `Stored traversal ${traversal.id} predates capture-frame path receipts. Archive it and author a new traversal from source coordinates.`,
          "error",
        );
        return;
      }
    } catch (error) {
      showNotice(
        `Stored traversal ${traversal.id} has invalid path JSON and cannot be edited: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
      return;
    }
    const bidirectional = form.elements.namedItem("bidirectional");
    if (bidirectional instanceof HTMLInputElement) {
      bidirectional.checked = traversal.bidirectional === 1;
    }
    setFormValue(form, "speedUnitsPerSecond", String(traversal.speed_units_per_second));
    setFormValue(form, "reviewedPurpose", traversal.reviewed_purpose);
    setFormValue(
      form,
      "evidenceReceipt",
      `${traversal.evidence_manifest_id}|${traversal.evidence_asset_id}`,
    );
  } else {
    setFormValue(form, "speedUnitsPerSecond", String(spatial.navigationProfile.maxSpeed));
  }
  const submit = form.querySelector<HTMLButtonElement>("[type='submit']")!;
  submit.textContent = traversal ? "Save traversal" : "Author traversal";
  byId("navigationTraversalUnit").textContent =
    spatial.navigationProfile.worldUnit === "scene_units"
      ? "provisional scene units"
      : "metres";
  byId("navigationTraversalError").textContent = "";
  navigationTraversalDialog.showModal();
}

async function createNavigationTraversal(form: FormData): Promise<void> {
  const project = state.selected?.project;
  const version = state.spatial?.version;
  if (!project || !version) throw new Error("Open an immutable scene version first.");
  const sourcePath = parseTraversalPath(String(form.get("sourcePath") ?? ""));
  const [evidenceManifestId, evidenceAssetId] = String(
    form.get("evidenceReceipt") ?? "",
  ).split("|");
  if (!evidenceManifestId || !evidenceAssetId) {
    throw new Error("Choose a qualified capture-manifest traversal receipt.");
  }
  const body = {
    traversalKind: String(form.get("traversalKind") ?? "elevator"),
    label: String(form.get("label") ?? ""),
    sourcePath,
    bidirectional: form.get("bidirectional") === "on",
    speedUnitsPerSecond: Number(form.get("speedUnitsPerSecond")),
    reviewedPurpose: String(form.get("reviewedPurpose") ?? ""),
    evidenceAssetId,
    evidenceManifestId,
  };
  await api(editingNavigationTraversal
    ? `/api/projects/${project.id}/spatial/navigation-traversals/${editingNavigationTraversal.id}`
    : `/api/projects/${project.id}/spatial/navigation-traversals`, {
    method: editingNavigationTraversal ? "PATCH" : "POST",
    body: JSON.stringify({
      ...(!editingNavigationTraversal
        ? { clientOperationId: crypto.randomUUID(), versionId: version.id }
        : {}),
      ...body,
    }),
  });
  const updated = Boolean(editingNavigationTraversal);
  editingNavigationTraversal = null;
  navigationTraversalDialog.close();
  showToast(updated
    ? "Reviewed traversal updated; rebuild navigation to freeze it"
    : "Reviewed traversal authored; rebuild navigation to freeze it");
  await loadSpatialWorkspace(project.id);
}

async function archiveNavigationTraversal(traversalId: string): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  await api(
    `/api/projects/${project.id}/spatial/navigation-traversals/${traversalId}`,
    { method: "DELETE" },
  );
  showToast("Authored traversal archived");
  await loadSpatialWorkspace(project.id);
}

function parseTraversalPath(value: string): Array<[number, number, number]> {
  const points = value.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parsePosition(line));
  if (points.length < 2 || points.some((point) => !point)) {
    throw new Error("Traversal path requires at least two x, y, z points, one per line.");
  }
  return points as Array<[number, number, number]>;
}

function navigationCollisionAssets(): Asset[] {
  const versionId = state.spatial?.version?.id;
  return (state.selected?.assets ?? []).filter((asset) =>
    asset.version_id === versionId &&
    asset.kind === "collision" &&
    asset.format.toLowerCase() === "glb" &&
    asset.integrity_status === "verified" &&
    Boolean(asset.sha256)
  );
}

function navigationEvidenceOptions(): SpatialWorkspace["traversalEvidenceOptions"] {
  return state.spatial?.traversalEvidenceOptions ?? [];
}

function openNavigationBuildDialog(): void {
  const spatial = state.spatial;
  if (!spatial?.version) return;
  const form = byId<HTMLFormElement>("navigationBuildForm");
  form.reset();
  const select = byId<HTMLSelectElement>("navigationCollisionAsset");
  select.replaceChildren(...navigationCollisionAssets().map((asset) => {
    const option = document.createElement("option");
    option.value = asset.id;
    option.textContent = `${asset.file_name} · ${formatBytes(asset.size_bytes)}`;
    return option;
  }));
  const points = spatial.entities.flatMap((entity) => {
    try {
      const geometry = entity.geometry_json ? JSON.parse(entity.geometry_json) : null;
      return Array.isArray(geometry?.points)
        ? geometry.points.filter(validNumberTuple)
        : [];
    } catch {
      return [];
    }
  });
  if (points.length) {
    const minimum = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]!)) - 0.5);
    const maximum = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]!)) + 0.5);
    setFormValue(form, "bounds", `${minimum.join(", ")} → ${maximum.join(", ")}`);
  }
  const opening = spatial.entities.find((entity) => entity.kind === "room" || entity.kind === "floor");
  if (opening) {
    let position: [number, number, number] | null = null;
    try {
      position = opening.position_json ? finiteStudioPoint(JSON.parse(opening.position_json)) : null;
    } catch {
      // A malformed legacy position must never become a walking spawn.
    }
    if (position) setFormValue(form, "spawn", position.join(", "));
  }
  const provisional = form.elements.namedItem("provisional");
  if (provisional instanceof HTMLInputElement) {
    provisional.checked = spatial.navigationProfile.worldUnit === "scene_units";
  }
  syncNavigationBuildReadiness();
  byId("navigationBuildError").textContent = "";
  navigationBuildDialog.showModal();
}

function syncNavigationBuildReadiness(): void {
  const form = byId<HTMLFormElement>("navigationBuildForm");
  const collision = form.elements.namedItem("collisionAssetId");
  const bounds = form.elements.namedItem("bounds");
  const spawn = form.elements.namedItem("spawn");
  const ready = collision instanceof HTMLSelectElement && Boolean(collision.value) &&
    bounds instanceof HTMLInputElement && Boolean(parseWalkableBounds(bounds.value)) &&
    spawn instanceof HTMLInputElement && Boolean(parsePosition(spawn.value));
  const submit = form.querySelector<HTMLButtonElement>("[type='submit']");
  if (submit) submit.disabled = !ready;
  byId("navigationBuildSummary").textContent = ready
    ? "Approved collision, structure-derived bounds, and an authored room starting point are ready. The exact evidence will be frozen into the walking-map job."
    : "Approve structure and choose a starting point in the scene before building. Expert values remain inspectable, but polygon averages are never treated as safe walking positions.";
}

async function queueNavigationBuild(form: FormData): Promise<void> {
  const project = state.selected?.project;
  const spatial = state.spatial;
  if (!project || !spatial?.version) throw new Error("Open an immutable scene version first.");
  const bounds = parseWalkableBounds(String(form.get("bounds") ?? ""));
  const spawn = parsePosition(String(form.get("spawn") ?? ""));
  if (!bounds || !spawn) throw new Error("Build bounds and an opening spawn are required.");
  await api(`/api/projects/${project.id}/spatial/navigation-builds`, {
    method: "POST",
    body: JSON.stringify({
      clientOperationId: crypto.randomUUID(),
      versionId: spatial.version.id,
      collisionAssetId: String(form.get("collisionAssetId") ?? ""),
      provisional: form.get("provisional") === "on",
      bounds: bounds.points,
      spawn: { id: "opening", position: spawn },
      destinations: [],
      offMeshConnections: [],
      build: {
        cellSize: Number(form.get("cellSize")),
        cellHeight: Number(form.get("cellHeight")),
        tileSize: Number(form.get("tileSize")),
        maxEdgeLengthVoxels: Number(form.get("maxEdgeLengthVoxels")),
        maxSimplificationError: Number(form.get("maxSimplificationError")),
        minimumRegionSizeVoxels: Number(form.get("minimumRegionSizeVoxels")),
        mergeRegionSizeVoxels: Number(form.get("mergeRegionSizeVoxels")),
      },
    }),
  });
  navigationBuildDialog.close();
  showToast("Verified walking-map build queued");
  await loadSpatialWorkspace(project.id);
}

type FinalAgreementResolution = {
  findingId: string;
  classification: string;
  note: string;
};

// The immutable identity of a final capture finding — must byte-match the
// Worker's finalAgreementFindingIdentity so a resolution names exactly the
// finding the operator saw.
function finalAgreementFindingId(finding: CaptureAgreementFinding): string {
  return `${finding.barrierId}|${finding.elevationM ?? ""}|${finding.from.join(",")}|${
    finding.to.join(",")
  }`;
}

// The build's own final capture agreement can carry crossings the floor-plan
// review never saw — walls added or moved during correction. Approval walks
// each one so the operator states what the wall is, per finding, with a note;
// an empty answer defers to the classification frozen with the revision, and
// the Worker decides whether that actually covers the span. Only the finding
// id travels — the Worker copies the geometry from the frozen agreement.
function collectFinalAgreementResolutions(
  artifactJson: string | null,
): FinalAgreementResolution[] | null {
  if (!artifactJson) return [];
  let crossings: CaptureAgreementFinding[] = [];
  try {
    const artifact = JSON.parse(artifactJson) as {
      finalCaptureAgreement?: { findings?: CaptureAgreementFinding[] } | null;
    };
    crossings = (artifact.finalCaptureAgreement?.findings ?? []).filter((finding) =>
      finding && finding.kind === "barrier_crosses_open_capture" &&
      typeof finding.barrierId === "string" &&
      Array.isArray(finding.from) && Array.isArray(finding.to)
    );
  } catch {
    return [];
  }
  const resolutions: FinalAgreementResolution[] = [];
  const options = CAPTURE_AGREEMENT_CLASSIFICATIONS.map(([value]) => value).join(" / ");
  for (const finding of crossings) {
    const answer = window.prompt(
      `Final capture check: ${finding.barrierId} still crosses open capture near [${
        finding.from.join(", ")
      }]→[${finding.to.join(", ")}]${
        typeof finding.elevationM === "number" ? ` at ${finding.elevationM} m` : ""
      }.\nClassify it (${options}), or leave empty if the floor-plan review already classified this span.`,
      "",
    );
    if (answer === null) return null;
    const classification = answer.trim();
    if (!classification) continue;
    const note = window.prompt(
      `Record what you verified about ${finding.barrierId} (minimum 10 characters).`,
      "Verified against the registered render during navigation approval.",
    );
    if (note === null) return null;
    resolutions.push({
      findingId: finalAgreementFindingId(finding),
      classification,
      note,
    });
  }
  return resolutions;
}

async function reviewNavigationBuild(
  buildId: string,
  decision: "approve" | "reject",
  note: string,
  finalCaptureAgreementResolutions: FinalAgreementResolution[] = [],
): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project first.");
  await api(`/api/projects/${project.id}/spatial/navigation-builds/${buildId}/review`, {
    method: "POST",
    body: JSON.stringify({
      decision,
      note,
      ...(finalCaptureAgreementResolutions.length
        ? { finalCaptureAgreementResolutions }
        : {}),
    }),
  });
  showToast(decision === "approve" ? "Walking map approved" : "Walking map rejected");
  await loadSpatialWorkspace(project.id);
}

async function retryNavigationBuild(jobId: string): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project first.");
  await api(`/api/jobs/${jobId}/retry`, { method: "POST" });
  showToast("Walking-map retry queued");
  await loadSpatialWorkspace(project.id);
}

function finiteStudioPoint(value: unknown): [number, number, number] | null {
  return validNumberTuple(value) ? value : null;
}

async function archiveSpatialEntity(entityId: string): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  await api(`/api/projects/${project.id}/spatial/entities/${entityId}`, { method: "DELETE" });
  showToast("Spatial entity archived");
  await loadSpatialWorkspace(project.id);
}

function openRouteDialog(): void {
  const spatial = state.spatial;
  if (!spatial) return;
  const select = byId<HTMLSelectElement>("routeStops");
  select.replaceChildren();
  for (const entity of spatial.entities) {
    const option = document.createElement("option");
    option.value = entity.id;
    option.textContent = `${humanStatus(entity.kind)} · ${entity.label}`;
    select.append(option);
  }
  byId<HTMLFormElement>("routeForm").reset();
  byId("routeError").textContent = "";
  routeDialog.showModal();
}

async function createSpatialRoute(form: FormData): Promise<void> {
  const project = state.selected?.project;
  const version = state.spatial?.version;
  if (!project || !version) throw new Error("Open an immutable scene version first.");
  const stopIds = form.getAll("stops").map(String);
  await api(`/api/projects/${project.id}/spatial/routes`, {
    method: "POST",
    body: JSON.stringify({
      versionId: version.id,
      label: String(form.get("label") ?? ""),
      description: optionalString(form.get("description")) ?? null,
      accessibility: String(form.get("accessibility") ?? "standard"),
      stops: stopIds.map((entityId) => ({ entityId })),
    }),
  });
  routeDialog.close();
  showToast("Guided route created");
  await loadSpatialWorkspace(project.id);
}

async function queuePrivacyScan(): Promise<void> {
  const project = state.selected?.project;
  const version = state.spatial?.version;
  if (!project || !version) throw new Error("Open an immutable scene version first.");
  const assetIds = (state.selected?.assets ?? [])
    .filter((asset) =>
      asset.version_id === version.id &&
      asset.kind === "poster" &&
      asset.integrity_status === "verified"
    )
    .map((asset) => asset.id)
    .sort();
  if (!assetIds.length) throw new Error("A verified private poster image is required before privacy detection can run.");
  if (!privacyScanOperation || privacyScanOperation.versionId !== version.id) {
    privacyScanOperation = { versionId: version.id, id: crypto.randomUUID() };
  }
  try {
    const result = await api<{ scan: { id: string; status: string } }>(`/api/projects/${project.id}/privacy-scans`, {
      method: "POST",
      body: JSON.stringify({
        clientOperationId: privacyScanOperation.id,
        versionId: version.id,
        assetIds,
      }),
    });
    privacyScanOperation = null;
    if (result.scan.status === "FAILED" || result.scan.status === "DEAD_LETTER") {
      await loadSpatialWorkspace(project.id);
      throw new Error("The existing privacy scan failed before it reached the worker. Use Retry failed scan.");
    }
    showToast("Privacy scan queued");
    await loadSpatialWorkspace(project.id);
    void pollPrivacyScan(project.id, result.scan.id);
  } catch (error) {
    await loadSpatialWorkspace(project.id).catch(() => undefined);
    throw error;
  }
}

async function retryPrivacyScan(scanId: string): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before retrying privacy detection.");
  await api(`/api/projects/${project.id}/privacy-scans/${scanId}/retry`, { method: "POST" });
  showToast("Privacy scan retry queued");
  await loadSpatialWorkspace(project.id);
  void pollPrivacyScan(project.id, scanId);
}

async function pollPrivacyScan(projectId: string, scanId: string): Promise<void> {
  const generation = ++privacyScanPollGeneration;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, attempt < 3 ? 1_500 : 3_000));
    if (
      generation !== privacyScanPollGeneration ||
      !projectPollingContextIsActive(projectId, "privacy-evidence-poll")
    ) return;
    try {
      await loadSpatialWorkspace(projectId);
    } catch {
      // Transient polling errors are retried without replacing the actionable workspace state.
      continue;
    }
    const scan = state.spatial?.privacyScans.find((candidate) => candidate.id === scanId);
    if (!scan || !["QUEUED", "RUNNING"].includes(scan.status)) return;
  }
  if (
    generation === privacyScanPollGeneration &&
    projectPollingContextIsActive(projectId, "privacy-evidence-poll")
  ) {
    showNotice("Privacy detection is still running. Refresh later; the queued evidence is retained.", "error");
  }
}

function openPrivacyCandidateDialog(candidate: SpatialWorkspace["privacyCandidates"][number]): void {
  const form = byId<HTMLFormElement>("privacyCandidateForm");
  form.reset();
  const candidateId = form.elements.namedItem("candidateId");
  const status = form.elements.namedItem("status");
  const note = form.elements.namedItem("note");
  if (candidateId instanceof HTMLInputElement) candidateId.value = candidate.id;
  if (status instanceof HTMLSelectElement) {
    status.value = candidate.status === "pending" ? "dismissed" : candidate.status;
    status.dispatchEvent(new Event("change"));
  }
  if (note instanceof HTMLTextAreaElement) note.value = candidate.decision_note ?? "";
  byId("privacyCandidateContext").textContent =
    `${candidate.label} in ${candidate.asset_file_name}. Current status: ${humanStatus(candidate.status)}.`;
  byId("privacyCandidateError").textContent = "";
  privacyCandidateDialog.showModal();
}

async function recordPrivacyCandidateDecision(form: FormData): Promise<void> {
  const project = state.selected?.project;
  const candidateId = String(form.get("candidateId") ?? "");
  if (!project || !candidateId) throw new Error("The privacy candidate is no longer available.");
  const status = String(form.get("status") ?? "");
  await api(`/api/projects/${project.id}/privacy-candidates/${candidateId}`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
      note: String(form.get("note") ?? "").trim(),
    }),
  });
  privacyCandidateDialog.close();
  showToast(`Privacy candidate ${humanStatus(status).toLowerCase()}`);
  await loadSpatialWorkspace(project.id);
}

function privacyScanError(raw: string | null): string {
  if (!raw) return "Detection failed before error evidence was recorded.";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const message = Reflect.get(parsed, "message");
    return typeof message === "string" ? message : "Detection failed. Retry the scan when the service is available.";
  } catch {
    return "Detection failed. Retry the scan when the service is available.";
  }
}

function privacyCandidatePreview(
  projectId: string,
  candidate: SpatialWorkspace["privacyCandidates"][number],
): HTMLElement {
  const frame = element("figure", "privacy-frame");
  const image = document.createElement("img");
  image.alt = `Private privacy evidence frame for ${candidate.label}`;
  image.loading = "lazy";
  image.decoding = "async";
  const status = element("span", "privacy-preview-status", "Loading private evidence…");
  const retry = element("button", "quiet-button privacy-preview-retry", "Retry preview");
  retry.type = "button";
  retry.hidden = true;
  const load = () => {
    status.hidden = false;
    status.textContent = "Loading private evidence…";
    retry.hidden = true;
    image.hidden = false;
    image.src = `/api/projects/${projectId}/privacy-assets/${candidate.asset_id}?v=${Date.now()}`;
  };
  image.addEventListener("load", () => {
    status.hidden = true;
  });
  image.addEventListener("error", () => {
    image.hidden = true;
    status.hidden = false;
    status.textContent = "Private evidence preview could not be loaded.";
    retry.hidden = false;
  });
  retry.addEventListener("click", load);
  frame.append(image);
  const bounds = parsePrivacyBounds(candidate.bbox_json);
  if (bounds) {
    const overlay = element("span", "privacy-bbox");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.left = `${bounds.xMin * 100}%`;
    overlay.style.top = `${bounds.yMin * 100}%`;
    overlay.style.width = `${(bounds.xMax - bounds.xMin) * 100}%`;
    overlay.style.height = `${(bounds.yMax - bounds.yMin) * 100}%`;
    frame.append(overlay);
  }
  frame.append(status, retry);
  load();
  return frame;
}

function parsePrivacyBounds(raw: string): {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
} | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const xMin = Number(Reflect.get(parsed, "xMin"));
    const yMin = Number(Reflect.get(parsed, "yMin"));
    const xMax = Number(Reflect.get(parsed, "xMax"));
    const yMax = Number(Reflect.get(parsed, "yMax"));
    if (![xMin, yMin, xMax, yMax].every(Number.isFinite)) return null;
    if (xMin < 0 || yMin < 0 || xMax > 1 || yMax > 1 || xMin >= xMax || yMin >= yMax) return null;
    return { xMin, yMin, xMax, yMax };
  } catch {
    return null;
  }
}

async function reviewPrivacyRegion(regionId: string, status: "approved" | "rejected" | "applied"): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  await api(`/api/projects/${project.id}/spatial/privacy-regions/${regionId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  showToast(`Privacy region ${status}`);
  await loadSpatialWorkspace(project.id);
}

function openCaptureCompletenessDialog(): void {
  const versions = state.selected?.versions ?? [];
  if (!versions.length) return;
  const select = byId<HTMLSelectElement>("captureCompletenessVersion");
  select.replaceChildren();
  for (const version of versions) {
    select.append(new Option(
      `Version ${version.version_number} · ${humanStatus(version.status)}`,
      version.id,
    ));
  }
  select.value = state.spatial?.version?.id ?? versions[0]!.id;
  const form = byId<HTMLFormElement>("captureCompletenessForm");
  form.reset();
  select.value = state.spatial?.version?.id ?? versions[0]!.id;
  const coordinateFrame = form.elements.namedItem("coordinateFrame");
  if (coordinateFrame instanceof HTMLInputElement) coordinateFrame.value = "project-local-y-up";
  byId("captureCompletenessError").textContent = "";
  captureCompletenessOperation = null;
  captureCompletenessDialog.showModal();
}

async function createCaptureCompletenessReport(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  const file = form.get("trajectoryFile");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a canonical trajectory JSON file.");
  if (file.size > 750 * 1024) throw new Error("Trajectory JSON must be 750 KiB or smaller.");
  const parsed = JSON.parse(await file.text()) as unknown;
  const points = parseCanonicalTrajectory(parsed);
  const versionId = String(form.get("versionId") ?? "");
  const captureAdapter = versionCaptureAdapter(
    state.selected?.versions.find((version) => version.id === versionId),
  );
  if (!captureAdapter) {
    throw new Error("The selected immutable version does not record its asset producer.");
  }
  const body = {
    versionId,
    source: {
      adapter: captureAdapter,
      fileName: file.name,
      format: "canonical_pose_json_v1",
      coordinateFrame: String(form.get("coordinateFrame") ?? "").trim(),
      alignmentEvidence: String(form.get("alignmentEvidence") ?? "").trim(),
    },
    parameters: {
      coverageRadiusM: Number(form.get("coverageRadiusM") ?? 1.25),
      maximumSampleGapM: Number(form.get("maximumSampleGapM") ?? 3),
      loopClosureRadiusM: Number(form.get("loopClosureRadiusM") ?? 1),
      minimumRoomCoveragePercent: Number(form.get("minimumRoomCoveragePercent") ?? 85),
      verticalToleranceM: Number(form.get("verticalToleranceM") ?? 0.5),
    },
    points,
  };
  const requestKey = JSON.stringify(body);
  if (!captureCompletenessOperation || captureCompletenessOperation.requestKey !== requestKey) {
    captureCompletenessOperation = { id: crypto.randomUUID(), requestKey };
  }
  await api(`/api/projects/${project.id}/spatial/capture-completeness`, {
    method: "POST",
    body: JSON.stringify({
      clientOperationId: captureCompletenessOperation.id,
      ...body,
    }),
  });
  captureCompletenessDialog.close();
  captureCompletenessOperation = null;
  showToast("Capture completeness evidence generated");
  await loadSpatialWorkspace(project.id);
}

function parseCanonicalTrajectory(value: unknown): Array<{
  position: [number, number, number];
  timestampMs?: number;
}> {
  if (!value || typeof value !== "object") throw new Error("Trajectory JSON must be an object.");
  const rawPoints = Reflect.get(value, "points");
  if (!Array.isArray(rawPoints) || rawPoints.length < 2) {
    throw new Error("Trajectory JSON must contain at least two points.");
  }
  if (rawPoints.length > 5000) throw new Error("Trajectory JSON cannot contain more than 5,000 points.");
  return rawPoints.map((rawPoint, index) => {
    if (!rawPoint || typeof rawPoint !== "object") throw new Error(`Point ${index + 1} must be an object.`);
    const rawPosition = Reflect.get(rawPoint, "position");
    if (!Array.isArray(rawPosition) || rawPosition.length !== 3) {
      throw new Error(`Point ${index + 1} must contain position [x, y, z].`);
    }
    const position = rawPosition.map(Number);
    if (position.some((coordinate) => !Number.isFinite(coordinate))) {
      throw new Error(`Point ${index + 1} contains a non-finite coordinate.`);
    }
    const rawTimestamp = Reflect.get(rawPoint, "timestampMs");
    if (rawTimestamp !== undefined && (!Number.isInteger(rawTimestamp) || Number(rawTimestamp) < 0)) {
      throw new Error(`Point ${index + 1} timestampMs must be a non-negative integer.`);
    }
    return {
      position: position as [number, number, number],
      ...(rawTimestamp === undefined ? {} : { timestampMs: Number(rawTimestamp) }),
    };
  });
}

function openCaptureCompletenessReview(
  report: CaptureCompletenessReport,
  summary: CaptureCompletenessSummary,
): void {
  const form = byId<HTMLFormElement>("captureCompletenessReviewForm");
  form.reset();
  const reportId = form.elements.namedItem("reportId");
  if (reportId instanceof HTMLInputElement) reportId.value = report.id;
  const decision = form.elements.namedItem("decision");
  if (decision instanceof HTMLSelectElement) {
    decision.value = summary.result === "complete" || summary.result === "complete_with_warnings"
      ? "accepted"
      : "needs_recapture";
  }
  const note = form.elements.namedItem("note");
  if (note instanceof HTMLTextAreaElement) note.value = report.review_note ?? "";
  byId("captureCompletenessReviewContext").textContent =
    `Version ${summary.version.versionNumber}: ${summary.summary.roomsMeetingCoverage}/${summary.summary.roomCount} rooms meet ` +
    `${summary.parameters.minimumRoomCoveragePercent}% coverage; maximum sample gap ${summary.summary.maximumGapM} m; ` +
    `${summary.summary.loopClosed ? "trajectory loop closed" : "trajectory loop remains open"}.`;
  byId("captureCompletenessReviewError").textContent = "";
  captureCompletenessReviewDialog.showModal();
}

async function reviewCaptureCompletenessReport(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  const reportId = String(form.get("reportId") ?? "");
  await api(`/api/projects/${project.id}/spatial/capture-completeness/${reportId}`, {
    method: "PATCH",
    body: JSON.stringify({
      decision: String(form.get("decision") ?? ""),
      note: String(form.get("note") ?? "").trim(),
    }),
  });
  captureCompletenessReviewDialog.close();
  showToast("Capture review recorded");
  await loadSpatialWorkspace(project.id);
}

function compactMetric(label: string, value: string | number): HTMLElement {
  const item = element("span", "");
  item.append(element("small", "", label), element("strong", "", String(value)));
  return item;
}

// Read-only evidence. The card offers no control because the platform cannot
// act on a vendor extension field it has never been given a schema for.
function renderCaptureScanStructure(structure: CaptureScanStructure): HTMLElement {
  const card = element("article", "geometry-change-card capture-report-card");
  const header = element("div", "geometry-change-heading");
  const title = element("div");
  title.append(
    element("strong", "", structure.assetFileName),
    element(
      "small",
      "muted-copy",
      `${structure.sourceFormat.toUpperCase()} · ${structure.method} · ${
        parseTimestamp(structure.createdAt).toLocaleString()
      }`,
    ),
  );
  header.append(
    title,
    element(
      "span",
      `status-pill ${statusClass(structure.status === "structure_read" ? "READY" : "BLOCKED")}`,
      structure.status === "structure_read" ? "Structure read" : "Structure unreadable",
    ),
  );
  card.append(header);
  if (structure.status === "structure_read") {
    const metrics = element("div", "geometry-change-metrics");
    metrics.append(
      compactMetric("Scans", structure.scanCount),
      compactMetric("Images", structure.imageCount),
      compactMetric("Per-scan poses", structure.hasPerScanPoses ? "Present" : "Absent"),
      compactMetric("Vendor fields", structure.vendorFieldNames.length),
    );
    card.append(metrics);
    if (structure.vendorFieldNames.length) {
      const fields = element("div", "notice-card capture-evidence-issues");
      fields.append(element("strong", "", "Vendor extension fields recorded verbatim"));
      const list = document.createElement("ul");
      for (const name of structure.vendorFieldNames) list.append(element("li", "", name));
      fields.append(
        list,
        element(
          "small",
          "muted-copy",
          "These names are preserved as evidence. Their meaning is undocumented to this platform and is not decoded.",
        ),
      );
      card.append(fields);
    }
  } else {
    card.append(element(
      "p",
      "form-error",
      structure.unreadableReason ??
        "The container structure could not be read. The immutable bytes are still preserved.",
    ));
  }
  card.append(element("small", "field-note", structure.limitation));
  if (structure.reportFileName) {
    card.append(element(
      "small",
      "muted-copy",
      `Immutable reading: ${structure.reportFileName}${
        structure.reportSha256 ? ` · ${structure.reportSha256.slice(0, 12)}…` : ""
      }`,
    ));
  }
  return card;
}

function renderCaptureCompletenessReport(report: CaptureCompletenessReport): HTMLElement {
  const card = element("article", "geometry-change-card capture-report-card");
  const summary = parseCaptureCompletenessSummary(report.summary_json);
  if (!summary) {
    card.append(
      element("strong", "", "Unreadable capture report"),
      element("p", "form-error", "The stored capture evidence could not be parsed. Analyze the source again."),
    );
    return card;
  }
  const header = element("div", "geometry-change-heading");
  const title = element("div");
  title.append(
    element("strong", "", `Version ${summary.version.versionNumber} · ${summary.source.fileName}`),
    element("small", "muted-copy", `${humanStatus(summary.source.adapter)} · ${summary.source.coordinateFrame}`),
  );
  header.append(
    title,
    element("span", `status-pill ${statusClass(summary.result.toUpperCase())}`, humanStatus(summary.result)),
  );
  const metrics = element("div", "geometry-change-metrics");
  metrics.append(
    compactMetric("Pose samples", summary.summary.sampleCount),
    compactMetric("Rooms covered", `${summary.summary.roomsMeetingCoverage} / ${summary.summary.roomCount}`),
    compactMetric("Path length", `${summary.summary.pathLengthM} m`),
    compactMetric("Maximum gap", `${summary.summary.maximumGapM} m`),
    compactMetric("Loop", summary.summary.loopClosed ? "Closed" : "Open"),
  );
  card.append(header, metrics, renderCaptureCompletenessOverlay(summary));

  if (summary.blockers.length) {
    const blockers = element("div", "notice-card capture-evidence-issues");
    blockers.append(element("strong", "", "Conclusion blocked"));
    const list = document.createElement("ul");
    for (const blocker of summary.blockers) list.append(element("li", "", blocker));
    blockers.append(list);
    card.append(blockers);
  }
  const roomRows = element("div", "capture-room-coverage");
  for (const room of summary.rooms) {
    const row = element("div", `capture-room-row ${room.classification}`);
    const heading = element("div");
    heading.append(
      element("strong", "", room.label),
      element("span", "", `${room.coveragePercent}% · ${room.sampleCount} samples`),
    );
    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = room.coveragePercent;
    progress.setAttribute("aria-label", `${room.label} pose-path coverage`);
    row.append(heading, progress);
    roomRows.append(row);
  }
  if (summary.rooms.length) card.append(roomRows);
  if (summary.issues.length) {
    const issues = element("div", "capture-evidence-issues");
    const list = document.createElement("ul");
    for (const issue of summary.issues.slice(0, 12)) {
      list.append(element("li", issue.severity, issue.message));
    }
    issues.append(list);
    card.append(issues);
  }
  card.append(
    element("p", "field-note", summary.source.alignmentEvidence),
    element("p", "field-note", summary.limitation),
  );
  if (report.status === "reviewed") {
    card.append(element(
      "div",
      "notice-card",
      `${humanStatus(report.review_decision ?? "reviewed")}: ${report.review_note ?? "Review recorded."}`,
    ));
  }
  const review = element(
    "button",
    report.status === "reviewed" ? "quiet-button wide" : "primary-button wide",
    report.status === "reviewed" ? "Review capture evidence again" : "Review capture evidence",
  );
  review.addEventListener("click", () => openCaptureCompletenessReview(report, summary));
  card.append(review);
  return card;
}

function parseCaptureCompletenessSummary(value: string): CaptureCompletenessSummary | null {
  try {
    const parsed = JSON.parse(value) as CaptureCompletenessSummary;
    return parsed?.method === "authored-room-trajectory-coverage-v1" ? parsed : null;
  } catch {
    return null;
  }
}

function renderCaptureCompletenessOverlay(summary: CaptureCompletenessSummary): HTMLElement {
  const stage = element("div", "capture-completeness-visual");
  const bounds = summary.visual.bounds;
  if (!bounds) {
    stage.append(element("p", "muted-copy", "No spatial overlay is available."));
    return stage;
  }
  const width = 480;
  const height = 240;
  const padding = 18;
  const spanX = Math.max(0.001, bounds.maxX - bounds.minX);
  const spanZ = Math.max(0.001, bounds.maxZ - bounds.minZ);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanZ);
  const offsetX = (width - spanX * scale) / 2;
  const offsetZ = (height - spanZ * scale) / 2;
  const project = ([x, z]: [number, number]): [number, number] => [
    offsetX + (x - bounds.minX) * scale,
    height - (offsetZ + (z - bounds.minZ) * scale),
  ];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "XZ plan showing authored rooms, capture trajectory, gaps, and uncovered sample points");
  for (const room of summary.visual.rooms) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const points = room.points.map(project);
    path.setAttribute("d", `${points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ")} Z`);
    path.setAttribute("class", `capture-room-outline ${room.classification}`);
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${room.label}: ${room.classification}`;
    path.append(title);
    svg.append(path);
  }
  if (summary.visual.trajectory.length > 1) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const points = summary.visual.trajectory.map(project);
    path.setAttribute("d", points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" "));
    path.setAttribute("class", "capture-trajectory-path");
    svg.append(path);
  }
  for (const gap of summary.visual.gapSegments) {
    const [fromX, fromY] = project(gap.from);
    const [toX, toY] = project(gap.to);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", fromX.toFixed(2));
    line.setAttribute("y1", fromY.toFixed(2));
    line.setAttribute("x2", toX.toFixed(2));
    line.setAttribute("y2", toY.toFixed(2));
    line.setAttribute("class", "capture-gap-segment");
    svg.append(line);
  }
  for (const spot of summary.visual.blindSpots.slice(0, 100)) {
    const [cx, cy] = project(spot.position);
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", cx.toFixed(2));
    circle.setAttribute("cy", cy.toFixed(2));
    circle.setAttribute("r", "2.5");
    circle.setAttribute("class", "capture-blind-spot");
    circle.setAttribute("aria-hidden", "true");
    svg.append(circle);
  }
  const legend = element("div", "capture-evidence-legend");
  legend.append(
    element("span", "covered", "Covered room"),
    element("span", "recapture", "Recapture room"),
    element("span", "trajectory", "Pose path"),
    element("span", "blind", "Blind spot"),
  );
  stage.append(svg, legend);
  return stage;
}

async function saveDefaultDeliveryPolicy(): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  await api(`/api/projects/${project.id}/spatial/delivery-policy`, {
    method: "PUT",
    body: JSON.stringify({
      adaptiveQuality: true,
      mobileLiteBudget: 0.75,
      mobileStandardBudget: 1.25,
      desktopStandardBudget: 2,
      desktopHighBudget: 4,
      maxInitialBytes: 15_728_640,
    }),
  });
  showToast("Adaptive quality policy applied");
  await loadSpatialWorkspace(project.id);
}

function parsePosition(value: string): [number, number, number] | null {
  if (!value.trim()) return null;
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("Position must contain exactly three finite numbers: x, y, z.");
  }
  return parts as [number, number, number];
}

function parseWalkableBounds(value: string): { type: "box"; points: [[number, number, number], [number, number, number]] } | null {
  if (!value.trim()) return null;
  const corners = value.split(/\s*(?:→|->)\s*/);
  if (corners.length !== 2) {
    throw new Error("Walkable bounds require two x, y, z corners separated by → or ->.");
  }
  const first = parsePosition(corners[0] ?? "");
  const second = parsePosition(corners[1] ?? "");
  if (!first || !second) throw new Error("Both walkable-bound corners are required.");
  if (first.every((coordinate, index) => coordinate === second[index])) {
    throw new Error("Walkable bounds must enclose a non-zero space.");
  }
  return {
    type: "box",
    points: [
      [Math.min(first[0], second[0]), Math.min(first[1], second[1]), Math.min(first[2], second[2])],
      [Math.max(first[0], second[0]), Math.max(first[1], second[1]), Math.max(first[2], second[2])],
    ],
  };
}

function parseWalkablePolygon(value: string): {
  type: "polygon";
  points: Array<[number, number, number]>;
} | null {
  if (!value.trim()) return null;
  const points = value
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parsePosition);
  if (points.length < 3 || points.some((point) => !point)) {
    throw new Error(
      "A walkable polygon requires at least three lines of x, y, z coordinates.",
    );
  }
  return {
    type: "polygon",
    points: points as Array<[number, number, number]>,
  };
}

function renderMeasurement(): void {
  const container = byId("measurementOverview");
  container.replaceChildren();
  const project = state.selected?.project;
  const workspace = state.measurement;
  if (!project || !workspace) {
    container.append(emptyState("Open a project from Projects before defining its measurement evidence."));
    return;
  }
  const briefs = element("article", "workspace-card-large");
  briefs.append(
    element("span", "eyebrow", "ACCEPTANCE CONTRACT"),
    element("h3", "", "Measurement briefs"),
    element("p", "muted-copy", "A splat is visual. Reliance begins only when units, tolerances, independent checks, and exclusions are explicit."),
  );
  if (!workspace.briefs.length) briefs.append(element("p", "muted-copy", "No measured deliverable has been scoped."));
  for (const brief of workspace.briefs) {
    const points = workspace.checkPoints.filter((point) => point.brief_id === brief.id);
    const latestReport = workspace.qaReports.find((report) => report.brief_id === brief.id);
    const deliverable = workspace.deliverables.find((item) => item.brief_id === brief.id && item.status === "ready");
    const row = element("div", "measurement-brief");
    row.append(
      element("strong", "", humanStatus(brief.product_type)),
      element("small", "", `${brief.tolerance_mm} mm tolerance · ${humanStatus(brief.reliance_class)} · ${humanStatus(brief.status)}`),
      element("p", "", brief.intended_use),
    );
    const actionError = element("p", "form-error");
    const actions = element("div", "workspace-actions");
    const addPoint = element("button", "quiet-button", `Add check point (${points.length})`);
    addPoint.addEventListener("click", () => openCheckPointDialog(brief.id));
    const report = element("button", "quiet-button", latestReport ? "Regenerate QA report" : "Generate QA report");
    report.addEventListener("click", () => {
      void runAction({
        key: `measurement-report:${brief.id}`,
        trigger: report,
        pendingLabel: "Calculating…",
        errorTarget: actionError,
      }, () => generateMeasurementQa(brief.id));
    });
    actions.append(addPoint, report);
    const generate = element("button", "primary-button", deliverable ? "Refresh DXF" : "Generate DXF");
    const generationReady = brief.status === "accepted" &&
      latestReport?.result === "pass" &&
      points.length >= 3;
    generate.disabled = !generationReady;
    if (!generationReady) {
      generate.title = points.length < 3
        ? "Record at least three independent check points and generate a passing QA report."
        : "Generate a passing QA report before creating the DXF.";
    }
    generate.addEventListener("click", () => {
      void runAction({
        key: `measurement-deliverable:${brief.id}`,
        trigger: generate,
        pendingLabel: "Generating DXF…",
        errorTarget: actionError,
        disable: [addPoint, report],
      }, () => generateMeasurementDeliverable(brief.id));
    });
    actions.append(generate);
    if (deliverable) {
      const download = element("button", "quiet-button", "Download DXF");
      download.addEventListener("click", () => {
        void runAction({
          key: `measurement-download:${deliverable.id}`,
          trigger: download,
          pendingLabel: "Downloading…",
          errorTarget: actionError,
        }, () => downloadMeasurementDeliverable(deliverable.id, deliverable.file_name));
      });
      actions.append(download);
    }
    row.append(actions, actionError);
    if (latestReport) {
      row.append(element(
        "div",
        `measurement-result ${latestReport.result}`,
        `${humanStatus(latestReport.result)} | ${latestReport.point_count} points | RMSE ${latestReport.rmse_mm?.toFixed(1) ?? "-"} mm | max ${latestReport.max_mm?.toFixed(1) ?? "-"} mm`,
      ));
    }
    if (deliverable) {
      row.append(element(
        "div",
        "measurement-result pass",
        `Draft DXF ready · ${formatBytes(deliverable.size_bytes)} · ${deliverable.generator_version} · SHA-256 ${deliverable.sha256.slice(0, 12)}…`,
      ));
    } else if (!generationReady) {
      row.append(element(
        "div",
        "measurement-result",
        points.length < 3
          ? `DXF gate blocked · ${3 - points.length} more independent check point${3 - points.length === 1 ? "" : "s"} required`
          : "DXF gate blocked · passing QA evidence required",
      ));
    }
    briefs.append(row);
  }
  const create = element("button", "primary-button wide", "Create measured floor-plan / CAD brief");
  create.disabled = !project.latestVersionId;
  create.addEventListener("click", () => {
    byId<HTMLFormElement>("measurementBriefForm").reset();
    byId("measurementBriefError").textContent = "";
    measurementBriefDialog.showModal();
  });
  briefs.append(create);

  const economics = element("article", "workspace-card-large");
  economics.append(
    element("span", "eyebrow", "UNIT ECONOMICS"),
    element("h3", "", "Measured delivery cost"),
    projectFact("Recorded direct cost", formatMoney(workspace.economics.totalCostCents, workspace.economics.currency)),
    projectFact("Cost records", String(workspace.costs.length)),
    element("p", "muted-copy", "Capture, compute, cleanup, QA, and professional partner costs are recorded separately so pricing can be validated from real jobs."),
  );
  const boundaries = element("article", "workspace-card-large");
  boundaries.append(
    element("span", "eyebrow", "PROFESSIONAL BOUNDARY"),
    element("h3", "", "Certification cannot be self-declared"),
    element("p", "muted-copy", "The platform refuses a professional-certified brief. That reliance class becomes available only after a passing QA report and a recorded licensed-professional sign-off."),
    projectFact("Recorded sign-offs", String(workspace.signoffs.length)),
    projectFact("Validation target", "Three paid briefs with explicit acceptance tolerances"),
  );
  container.append(briefs, economics, boundaries);
}

async function loadMeasurementWorkspace(projectId: string): Promise<void> {
  const workspace = await api<MeasurementWorkspace>(`/api/projects/${projectId}/measurement`);
  if (state.selected?.project.id !== projectId) return;
  state.measurement = workspace;
  state.measurementProjectId = projectId;
  if (state.view === "project" && state.projectSection === "measurement") renderMeasurement();
}

async function createMeasurementBrief(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project?.latestVersionId) throw new Error("Process an immutable scene version first.");
  await api(`/api/projects/${project.id}/measurement/briefs`, {
    method: "POST",
    body: JSON.stringify({
      versionId: project.latestVersionId,
      productType: String(form.get("productType") ?? "measured_floor_plan"),
      intendedUse: String(form.get("intendedUse") ?? ""),
      units: "metres",
      toleranceMm: Number(form.get("toleranceMm") ?? 30),
      relianceClass: String(form.get("relianceClass") ?? "indicative"),
      coordinateReference: optionalString(form.get("coordinateReference")) ?? null,
      exclusions: optionalString(form.get("exclusions")) ?? null,
    }),
  });
  measurementBriefDialog.close();
  showToast("Measurement brief created");
  await loadMeasurementWorkspace(project.id);
}

function openCheckPointDialog(briefId: string): void {
  activeMeasurementBriefId = briefId;
  byId<HTMLFormElement>("checkPointForm").reset();
  byId("checkPointError").textContent = "";
  checkPointDialog.showModal();
}

async function createCheckPoint(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project || !activeMeasurementBriefId) throw new Error("Select a measurement brief first.");
  const reference = parsePosition(String(form.get("reference") ?? ""));
  const observed = parsePosition(String(form.get("observed") ?? ""));
  if (!reference || !observed) throw new Error("Reference and observed coordinates are required.");
  await api(`/api/projects/${project.id}/measurement/briefs/${activeMeasurementBriefId}/check-points`, {
    method: "POST",
    body: JSON.stringify({
      label: String(form.get("label") ?? ""),
      reference,
      observed,
      evidenceNote: optionalString(form.get("evidenceNote")) ?? null,
    }),
  });
  checkPointDialog.close();
  activeMeasurementBriefId = null;
  showToast("Independent check point recorded");
  await loadMeasurementWorkspace(project.id);
}

async function generateMeasurementQa(briefId: string): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  const result = await api<{ report: { result: string } }>(
    `/api/projects/${project.id}/measurement/briefs/${briefId}/qa-report`,
    { method: "POST" },
  );
  showToast(`Measurement QA: ${humanStatus(result.report.result)}`);
  await loadMeasurementWorkspace(project.id);
}

async function generateMeasurementDeliverable(briefId: string): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Select a project before generating a measurement deliverable.");
  const result = await api<{ deliverable: { fileName: string }; idempotent?: boolean }>(
    `/api/projects/${project.id}/measurement/briefs/${briefId}/deliverables`,
    { method: "POST" },
  );
  showToast(result.idempotent
    ? `${result.deliverable.fileName} is already current`
    : `${result.deliverable.fileName} generated`);
  await loadMeasurementWorkspace(project.id);
}

async function downloadMeasurementDeliverable(deliverableId: string, fallbackFileName: string): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Select a project before downloading a measurement deliverable.");
  const file = await apiFile(
    `/api/projects/${project.id}/measurement/deliverables/${deliverableId}/download`,
    { timeoutMs: 30_000, retries: 2 },
  );
  const objectUrl = URL.createObjectURL(file.blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = file.fileName ?? fallbackFileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  showToast(`${anchor.download} downloaded`);
}

async function selectProject(
  projectId: string,
  focusWorkspace = true,
  openProjectView = true,
): Promise<void> {
  try {
    const detail = await api<ProjectDetail>(`/api/projects/${projectId}`);
    const selectedVersionChanged =
      state.selected?.project.id === projectId &&
      state.selected.versions[0]?.id !== detail.versions[0]?.id;
    if (state.selected?.project.id !== projectId || selectedVersionChanged) {
      state.spatial = null;
      state.spatialProjectId = null;
      state.spatialVersionId = null;
      state.measurement = null;
      state.measurementProjectId = null;
      state.recoverableUploads = [];
      activeUpload = null;
      pendingUploadOperation = null;
    }
    state.selected = detail;
    renderProjectDetail();
    const openingSection = firstIncompleteProjectSection(detail);
    if (openProjectView) activateProjectSection(openingSection, true, "push");
    if (focusWorkspace) {
      const header = byId("projectWorkspaceHeader");
      header.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => focusProjectSectionHeading(openingSection), 320);
    }
  } catch (error) {
    showNotice(errorMessage(error), "error");
  }
}

function firstIncompleteProjectSection(detail: ProjectDetail): ProjectSection {
  const journey = projectJourneyState(detail);
  const privacyIsStrict = effectiveProjectWorkflowPolicy(detail.project).privacyReview === "strict";
  if (!journey.hasCapture) return "overview";
  if (journey.captureQualification?.status === "blocked") return "process";
  if (!journey.renderableVersion) return "process";
  if (!journey.navigationReady && journey.automaticWalkingWorkActive) return "process";
  if (!journey.structureReady) return "structure";
  if (privacyIsStrict && journey.privacyVersion?.status === "QA_REQUIRED") return "privacy";
  if (!journey.navigationReady || !journey.walkTestReady) return "walk";
  if (journey.privacyVersion?.status === "QA_REQUIRED") return "privacy";
  if (!journey.privacyApproved) return "privacy";
  if (!detail.releases.some((release) => release.is_active && !release.revoked_at)) return "publish";
  return "overview";
}

function projectJourneyState(detail: ProjectDetail) {
  const renderableVersion = detail.versions.find((version) =>
    detail.assets.some((asset) =>
      asset.version_id === version.id &&
      asset.kind === "web" &&
      asset.integrity_status === "verified" &&
      ["rad", "spz", "sog"].includes(asset.format)
    )
  ) ?? null;
  const journeyJobs = renderableVersion
    ? detail.jobs.filter((job) => job.version_id === renderableVersion.id)
    : detail.jobs;
  const activeJob = journeyJobs.find((job) =>
    ["QUEUED", "LEASED", "RUNNING"].includes(job.state)
  ) ?? null;
  const supersededByLaterSuccess = (candidate: Job) =>
    journeyJobs.some((other) => other.job_type === candidate.job_type &&
      other.state === "SUCCEEDED" && other.created_at >= candidate.created_at);
  const failedJob = journeyJobs.find((job) =>
    ["FAILED", "DEAD_LETTER", "CANCELLED"].includes(job.state) &&
    !supersededByLaterSuccess(job)) ?? null;
  const captureQualification = automaticCaptureQualification(
    renderableVersion ?? detail.versions.find((version) => version.source_provenance_json) ?? null,
  );
  const hasCapture = detail.assets.length > 0;
  const hasMetricGeometry = detail.assets.some((asset) =>
    asset.kind === "pointcloud" && ["ply", "e57", "las", "laz", "pts"].includes(asset.format)
  );
  const floorplanJob = journeyJobs.find((job) => job.job_type === "floorplan.extract-v1") ?? null;
  const navigationJob = journeyJobs.find((job) => job.job_type === "navigation.build-v1") ?? null;
  const navigationReady = Boolean(
    renderableVersion && detail.previewReadyVersionIds.includes(renderableVersion.id),
  );
  const walkTestReady = Boolean(
    navigationReady && renderableVersion &&
    (detail.walkTestReadyVersionIds ?? []).includes(renderableVersion.id),
  );
  const structureReady = navigationReady || Boolean(navigationJob);
  // Privacy follows the newest immutable version, including an auxiliary QA
  // version. Publication independently resolves the approved visual target,
  // so an outstanding QA review can remain the recommended stage without
  // hiding an already releasable visual version.
  const privacyVersion = detail.versions[0] ?? null;
  const privacyApproved = Boolean(
    privacyVersion && ["APPROVED", "PUBLISHED"].includes(privacyVersion.status),
  );
  const automaticWalkingWorkActive = Boolean(
    activeJob && ["asset.evidence-validate", "floorplan.extract-v1", "navigation.build-v1"]
      .includes(activeJob.job_type),
  );
  const walkingExceptionReviewReady = Boolean(
    renderableVersion && hasMetricGeometry && floorplanJob?.state === "SUCCEEDED" &&
    !structureReady && !automaticWalkingWorkActive && !failedJob,
  );
  return {
    renderableVersion,
    activeJob,
    failedJob,
    captureQualification,
    hasCapture,
    hasMetricGeometry,
    floorplanJob,
    navigationJob,
    navigationReady,
    walkTestReady,
    structureReady,
    privacyVersion,
    privacyApproved,
    automaticWalkingWorkActive,
    walkingExceptionReviewReady,
  };
}

function automaticCaptureQualification(version: Version | null): {
  status: "pending" | "verified" | "blocked";
  reason: string | null;
} | null {
  if (!version?.source_provenance_json) return null;
  try {
    const provenance = JSON.parse(version.source_provenance_json) as unknown;
    const journey = provenance && typeof provenance === "object"
      ? Reflect.get(provenance, "captureJourney")
      : null;
    const qualification = journey && typeof journey === "object"
      ? Reflect.get(journey, "qualification")
      : null;
    if (
      !qualification || typeof qualification !== "object" ||
      Reflect.get(qualification, "method") !== AUTOMATIC_PAIRED_CAPTURE_METHOD
    ) return null;
    const status = Reflect.get(qualification, "status");
    if (status !== "pending" && status !== "verified" && status !== "blocked") return null;
    const reason = Reflect.get(qualification, "reason");
    return {
      status,
      reason: typeof reason === "string" && reason.trim() ? reason : null,
    };
  } catch {
    return null;
  }
}

function versionCaptureAdapter(version: Version | null | undefined): string | null {
  if (!version?.source_provenance_json) return null;
  try {
    const provenance = JSON.parse(version.source_provenance_json) as unknown;
    if (!provenance || typeof provenance !== "object") return null;
    const candidate = Reflect.get(provenance, "assetProducer") ??
      Reflect.get(provenance, "adapter");
    return typeof candidate === "string" &&
        captureAdapterProfiles.some((profile) => profile.id === candidate)
      ? candidate
      : null;
  } catch {
    return null;
  }
}

async function ensureProjectWorkspace(view: "spatial" | "measurement", force = false): Promise<void> {
  const projectId = state.selected?.project.id;
  if (!projectId) return;
  const cachedProjectId = view === "spatial" ? state.spatialProjectId : state.measurementProjectId;
  if (!force && cachedProjectId === projectId) return;

  const container = byId(
    view === "spatial"
      ? state.projectSection === "publish" ? "publishOverview" : "spatialOverview"
      : "measurementOverview",
  );
  container.setAttribute("aria-busy", "true");
  container.replaceChildren(emptyState(
    view === "spatial"
      ? "Loading spatial structure…"
      : "Loading measurement evidence…",
  ));

  try {
    await backgroundActions.run(`load-${view}:${projectId}`, async () => {
      if (view === "spatial") await loadSpatialWorkspace(projectId);
      else await loadMeasurementWorkspace(projectId);
    });
  } catch (error) {
    if (
      state.selected?.project.id !== projectId ||
      state.view !== "project" ||
      (view === "spatial"
        ? !["structure", "privacy", "compare", "walk", "expert", "publish"].includes(state.projectSection)
        : state.projectSection !== "measurement")
    ) return;
    const retry = element("button", "quiet-button", "Retry");
    const errorState = emptyState(errorMessage(error));
    retry.addEventListener("click", () => {
      void runAction({
        key: `retry-${view}:${projectId}`,
        trigger: retry,
        pendingLabel: "Retrying…",
      }, () => ensureProjectWorkspace(view, true));
    });
    errorState.append(retry);
    container.replaceChildren(errorState);
  } finally {
    if (state.selected?.project.id === projectId) container.removeAttribute("aria-busy");
  }
}

async function createVersionPreview(versionId: string): Promise<VersionRenderable> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before preparing its preview.");
  const result = await api<{ renderable: VersionRenderable }>(
    `/api/projects/${project.id}/versions/${versionId}/preview`,
    { timeoutMs: 20_000, retries: 2 },
  );
  return result.renderable;
}

async function openVersionPreview(versionId: string): Promise<void> {
  const previewWindow = window.open("about:blank", "_blank");
  try {
    await createVersionPreview(versionId);
    const projectId = state.selected?.project.id;
    if (!projectId) throw new Error("Open a project before preparing its preview.");
    const url = privatePreviewPageUrl(projectId, versionId).toString();
    if (previewWindow) previewWindow.location.replace(url);
    else window.open(url, "_blank", "noopener");
  } catch (error) {
    previewWindow?.close();
    throw error;
  }
}

async function copyVersionPreviewUrl(versionId: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable. Open the preview and copy its address instead.");
  }
  await createVersionPreview(versionId);
  const projectId = state.selected?.project.id;
  if (!projectId) throw new Error("Open a project before preparing its preview.");
  await navigator.clipboard.writeText(privatePreviewPageUrl(projectId, versionId).toString());
  showToast("Private preview URL copied");
}

function privatePreviewPageUrl(projectId: string, versionId: string): URL {
  return new URL(
    `/preview/${encodeURIComponent(projectId)}/${encodeURIComponent(versionId)}`,
    location.origin,
  );
}

// The access link of a live token release, recoverable on demand: the server
// re-derives the token from the release's frozen mint parameters, proves it
// against the stored hash, and audits the reveal.
function revealAccessLinkButton(
  projectId: string,
  releaseId: string,
  className: string,
): HTMLButtonElement {
  const reveal = element("button", className, "Reveal access link");
  reveal.addEventListener("click", () => {
    void runAction({
      key: `reveal-release-token:${releaseId}`,
      trigger: reveal,
      pendingLabel: "Revealing…",
    }, async () => {
      const result = await api<{ accessToken: string; url: string | null }>(
        `/api/projects/${projectId}/releases/${releaseId}/access-token`,
      );
      const link = result.url ?? result.accessToken;
      showNotice(`Access link: ${link}`, "success");
      await navigator.clipboard.writeText(link).catch(() => undefined);
      showToast("Access link copied");
    });
  });
  return reveal;
}

function renderProjectDetail(): void {
  const detail = state.selected;
  if (!detail) return;
  byId("projectDetail").hidden = false;
  byId("detailTitle").textContent = detail.project.name;
  byId("detailStatus").textContent = humanStatus(detail.project.status);
  const body = byId("detailBody");
  body.className = "project-detail-flow";
  body.replaceChildren();

  const {
    renderableVersion,
    activeJob,
    failedJob,
    captureQualification,
    hasCapture,
    hasMetricGeometry,
    floorplanJob,
    navigationJob,
    navigationReady,
    walkTestReady,
    structureReady,
    privacyVersion: latestVersion,
    privacyApproved,
    automaticWalkingWorkActive,
    walkingExceptionReviewReady,
  } = projectJourneyState(detail);
  const activeRelease = detail.releases.find((release) => release.is_active && !release.revoked_at) ?? null;

  const journey = element("section", "project-journey");
  const journeyHeading = element("div", "project-journey-heading");
  const journeyCopy = element("div");
  journeyCopy.append(
    element("span", "eyebrow", "CAPTURE JOURNEY"),
    element(
      "h3",
      "",
      renderableVersion
        ? captureQualification?.status === "blocked"
          ? "Capture compatibility needs correction."
          : navigationReady
          ? "Your walkable splat preview is ready."
          : automaticWalkingWorkActive
            ? "Building and verifying the walking map."
            : walkingExceptionReviewReady
              ? "Structural exceptions need review."
              : hasMetricGeometry
                ? "Walking-map processing needs attention."
                : "Registered structural geometry is required."
        : "From capture result to browser preview.",
    ),
    element(
      "p",
      "muted-copy",
      renderableVersion
        ? captureQualification?.status === "blocked"
          ? `${captureQualification.reason ?? "Automatic qualification could not verify the shared capture frame."} Return to the capture source, export both files again from one unchanged Y-up metre frame, and upload them as a new immutable capture.`
          : navigationReady
          ? "The visual splat, verified collision, and approved walking map are ready for review."
          : automaticWalkingWorkActive
            ? `${humanStatus(activeJob!.job_type)} is ${humanStatus(activeJob!.state).toLowerCase()}: ${activeJob!.progress_message ?? `${activeJob!.progress}% complete`}. No routine navigation setup is required.`
            : walkingExceptionReviewReady
              ? "Automatic reconstruction found structure that cannot be accepted from geometry alone. Inspect only the highlighted gaps or connectors on the render; collision and walking proof rebuild automatically after correction."
              : failedJob
                ? `Automatic walking-map processing needs attention: ${failedJob.progress_message ?? humanStatus(failedJob.state)}.`
                : "The visual is preserved, but it has no registered structural source from which collision and walking proof can be generated safely."
        : activeJob
          ? `${humanStatus(activeJob.job_type)} is ${humanStatus(activeJob.state).toLowerCase()}: ${activeJob.progress_message ?? `${activeJob.progress}% complete`}.`
          : failedJob
            ? `Processing needs attention: ${failedJob.progress_message ?? humanStatus(failedJob.state)}.`
            : hasCapture
              ? "The capture is preserved. Refresh processing activity if a browser derivative has not been queued."
              : "Upload the portable splat and registered metric geometry together. The platform handles browser conversion, floor-plan extraction, structural collision, and navigation generation.",
    ),
  );
  const journeyActions = element("div", "project-journey-actions");
  if (!hasCapture) {
    const upload = element("button", "primary-button", "Upload capture result");
    upload.disabled = detail.project.status === "ARCHIVED";
    upload.addEventListener("click", openUploadDialog);
    journeyActions.append(upload);
  } else if (captureQualification?.status === "blocked") {
    if (failedJob) {
      const retry = element("button", "primary-button", "Retry automatic qualification");
      retry.addEventListener("click", () => {
        void runAction({
          key: `retry-job:${failedJob.id}`,
          trigger: retry,
          pendingLabel: "Queueing retry…",
        }, () => retryJob(failedJob));
      });
      journeyActions.append(retry);
    } else {
      const correction = element("button", "quiet-button", "Show correction steps");
      correction.addEventListener("click", () => showNotice(
        `${captureQualification.reason ?? "The shared capture frame was not verified."} Export the visual and geometry PLY files again from the same unchanged Y-up metre coordinate frame, then start a replacement immutable capture.`,
        "error",
      ));
      journeyActions.append(correction);
    }
  } else if (renderableVersion && navigationReady) {
    const preview = element("button", "primary-button", "Open private preview");
    preview.addEventListener("click", () => {
      void runAction({
        key: `open-preview:${renderableVersion.id}`,
        trigger: preview,
        pendingLabel: "Preparing preview…",
      }, () => openVersionPreview(renderableVersion.id));
    });
    const copy = element("button", "quiet-button", "Copy preview URL");
    copy.addEventListener("click", () => {
      void runAction({
        key: `copy-preview:${renderableVersion.id}`,
        trigger: copy,
        pendingLabel: "Creating link…",
      }, () => copyVersionPreviewUrl(renderableVersion.id));
    });
    const editScene = element("button", "quiet-button", "Edit scene");
    editScene.addEventListener("click", () => openSceneEditor(detail.project.id, editScene));
    journeyActions.append(preview, copy, editScene);
  } else if (renderableVersion && automaticWalkingWorkActive) {
    const refresh = element("button", "quiet-button", "Refresh walking-map progress");
    refresh.addEventListener("click", () => {
      void runAction({
        key: `refresh-project:${detail.project.id}`,
        trigger: refresh,
        pendingLabel: "Refreshing…",
      }, async () => {
        await refreshAll();
        await selectProject(detail.project.id, false, false);
      });
    });
    journeyActions.append(refresh);
  } else if (renderableVersion && walkingExceptionReviewReady) {
    const reviewExceptions = element("button", "primary-button", "Review structural exceptions");
    reviewExceptions.addEventListener("click", () => {
      openSceneEditor(detail.project.id, reviewExceptions);
    });
    journeyActions.append(reviewExceptions);
  } else if (renderableVersion && failedJob) {
    const retry = element("button", "primary-button", "Retry automatic processing");
    retry.addEventListener("click", () => {
      void runAction({
        key: `retry-job:${failedJob.id}`,
        trigger: retry,
        pendingLabel: "Queueing retry…",
      }, () => retryJob(failedJob));
    });
    journeyActions.append(retry);
  } else {
    const refresh = element("button", "quiet-button", "Refresh processing status");
    refresh.addEventListener("click", () => {
      void runAction({
        key: `refresh-project:${detail.project.id}`,
        trigger: refresh,
        pendingLabel: "Refreshing…",
      }, async () => {
        await refreshAll();
        await selectProject(detail.project.id, false, false);
      });
    });
    journeyActions.append(refresh);
  }
  journeyHeading.append(journeyCopy, journeyActions);
  const steps = element("div", "project-journey-steps");
  steps.append(
    projectJourneyStep("1", "Capture", hasCapture ? "complete" : "current", hasCapture ? "Source preserved" : "Upload files", "overview"),
    projectJourneyStep(
      "2",
      "Process",
      captureQualification?.status === "blocked"
        ? "blocked"
        : renderableVersion ? "complete" : activeJob ? "current" : failedJob ? "blocked" : "waiting",
      captureQualification?.status === "blocked"
        ? "Capture frame not verified"
        : renderableVersion ? "Visual scene prepared" : activeJob ? `${activeJob.progress}% complete` : failedJob ? "Needs attention" : "Starts automatically",
      "process",
    ),
    projectJourneyStep(
      "3",
      "Structure",
      captureQualification?.status === "blocked"
        ? "blocked"
        : structureReady
        ? "complete"
        : walkingExceptionReviewReady || floorplanJob && ["QUEUED", "LEASED", "RUNNING"].includes(floorplanJob.state)
          ? "current"
          : floorplanJob ? "blocked" : hasMetricGeometry ? "waiting" : "blocked",
      captureQualification?.status === "blocked"
        ? "Correct capture exports first"
        : structureReady
        ? "Rooms and openings approved"
        : walkingExceptionReviewReady
          ? "Review structural exceptions"
          : floorplanJob ? humanStatus(floorplanJob.state) : hasMetricGeometry ? "Starts automatically" : "Geometry required",
      "structure",
    ),
    projectJourneyStep(
      "4",
      "Privacy",
      privacyApproved ? "complete" : latestVersion?.status === "QA_REQUIRED" ? "current" : renderableVersion ? "waiting" : "blocked",
      privacyApproved ? "Human approval recorded" : latestVersion?.status === "QA_REQUIRED" ? "Review findings" : "Wait for processed scene",
      "privacy",
    ),
    projectJourneyStep(
      "5",
      "Walk test",
      walkTestReady ? "complete" : navigationReady
        ? "current"
        : navigationJob && ["QUEUED", "LEASED", "RUNNING"].includes(navigationJob.state)
        ? "current"
        : navigationJob ? "blocked" : "waiting",
      walkTestReady
        ? "Operator test recorded"
        : navigationReady
          ? "Set start and complete test"
          : navigationJob ? humanStatus(navigationJob.state) : "Follows structure automatically",
      "walk",
    ),
    projectJourneyStep(
      "6",
      "Publish",
      activeRelease ? "complete" : walkTestReady && privacyApproved ? "current" : "blocked",
      activeRelease
        ? `Live at /${activeRelease.slug}`
        : !privacyApproved
          ? "Privacy approval required"
          : walkTestReady
            ? "Choose audience and publish"
            : navigationReady
              ? "Complete the in-scene walk test"
            : walkingExceptionReviewReady
              ? "Review structural exceptions"
              : "Verified walk required",
      "publish",
    ),
  );
  journey.append(journeyHeading, steps);

  const sharing = detailCard("Preview and sharing");
  sharing.classList.add("project-sharing-card");
  if (renderableVersion && navigationReady) {
    sharing.append(element(
      "p",
      "muted-copy",
      "Private preview URLs are short-lived operator sessions. Public or customer-facing URLs are created only after privacy review and publication.",
    ));
  } else if (renderableVersion) {
    sharing.append(element(
      "p",
      "muted-copy",
      "Preview and publication remain blocked until this exact version has a verified visual-to-structure registration plus approved collision, Recast/Detour navigation, and Rapier movement proof.",
    ));
  }
  if (activeRelease) {
    const publishedLink = document.createElement("a");
    publishedLink.className = "primary-button wide";
    publishedLink.href = `/s/${activeRelease.slug}`;
    publishedLink.target = "_blank";
    publishedLink.rel = "noopener";
    publishedLink.textContent = "Open published preview";
    sharing.append(publishedLink, projectFact("Published URL", `${location.origin}/s/${activeRelease.slug}`));
    // A token release's published URL is incomplete without its token; the
    // recoverable link belongs right beside it, not only in release history.
    if (activeRelease.access_policy === "token" && !activeRelease.revoked_at) {
      sharing.append(revealAccessLinkButton(
        detail.project.id,
        activeRelease.id,
        "quiet-button wide",
      ));
    }
  }
  const releasableVisualVersion = auxiliaryCollisionTargetVersion();
  if (latestVersion?.status === "QA_REQUIRED" && navigationReady) {
    const qaButton = element("button", "quiet-button wide", "Review privacy and approve");
    qaButton.addEventListener("click", () => {
      void runAction({
        key: `open-qa:${detail.project.id}`,
        trigger: qaButton,
        pendingLabel: "Checking evidence…",
      }, openQaDialog);
    });
    sharing.append(qaButton);
  }
  if (releasableVisualVersion && walkTestReady) {
    const publishButton = element("button", "primary-button wide", "Publish shareable URL");
    publishButton.addEventListener("click", () => {
      void runAction({
        key: `open-release:${detail.project.id}`,
        trigger: publishButton,
        pendingLabel: "Loading release evidence…",
      }, openReleaseDialog);
    });
    sharing.append(publishButton);
  }
  if (!sharing.querySelector("button, a")) {
    sharing.append(element("p", "muted-copy", "A shareable release becomes available after the processed scene passes privacy review."));
  }

  const overview = detailCard("Project record");
  overview.append(
    projectFact("Customer", detail.project.customerName ?? "Not assigned"),
    projectFact("Customer contact", detail.project.customerEmail ?? "Not assigned"),
    projectFact(
      "Capture origin",
      humanStatus(detail.project.captureOrigin ?? captureOriginForLegacyAdapter(
        detail.project.captureAdapter as CaptureAdapterId,
      )),
    ),
    projectFact(
      "Asset producer",
      detail.project.assetProducer || assetProducerForLegacyAdapter(
        detail.project.captureAdapter as CaptureAdapterId,
      )
        ? humanStatus(detail.project.assetProducer ?? detail.project.captureAdapter)
        : "Not recorded",
    ),
    projectFact("Delivery classification", detail.project.deliveryTemplate),
    projectFact("Privacy policy", humanStatus(effectiveProjectWorkflowPolicy(detail.project).privacyReview)),
    projectFact("Publication policy", humanStatus(effectiveProjectWorkflowPolicy(detail.project).publication)),
    projectFact("Navigation policy", humanStatus(effectiveProjectWorkflowPolicy(detail.project).navigation)),
    projectFact("Required files", humanStatus(effectiveProjectWorkflowPolicy(detail.project).requiredFiles)),
    projectFact("Structure workflow", humanStatus(effectiveProjectWorkflowPolicy(detail.project).structureWorkflow)),
    projectFact("Walking clearance", humanStatus(effectiveProjectWorkflowPolicy(detail.project).navigationClearance)),
    projectFact("Measurement policy", humanStatus(effectiveProjectWorkflowPolicy(detail.project).measurement)),
    projectFact("Notes", detail.project.notes ?? "No project notes."),
  );
  for (const field of state.projectFields.filter((candidate) =>
    detail.project.customFields[candidate.key] !== undefined
  )) {
    overview.append(projectFact(
      field.label,
      formatProjectCustomFieldValue(detail.project.customFields[field.key]),
    ));
  }
  const editButton = element("button", "quiet-button wide", "Edit project settings");
  editButton.addEventListener("click", openEditProjectDialog);
  overview.append(editButton);
  const lifecycleButton = element(
    "button",
    detail.project.status === "ARCHIVED" ? "quiet-button wide" : "danger-button wide",
    detail.project.status === "ARCHIVED" ? "Restore project" : "Archive project",
  );
  lifecycleButton.addEventListener("click", () => {
    const restoring = detail.project.status === "ARCHIVED";
    if (!confirm(
      restoring
        ? `Restore ${detail.project.name} to ${humanStatus(detail.project.status === "ARCHIVED" ? "DRAFT" : detail.project.status)}?`
        : `Archive ${detail.project.name}? Active releases, jobs, and uploads must be resolved first.`,
    )) return;
    void runAction({
      key: `${restoring ? "restore" : "archive"}-project:${detail.project.id}`,
      trigger: lifecycleButton,
      pendingLabel: restoring ? "Restoring…" : "Archiving…",
    }, () => changeProjectLifecycle(restoring ? "restore" : "archive"));
  });
  overview.append(lifecycleButton);

  const versions = detailCard("Version history");
  if (!detail.versions.length) versions.append(element("p", "muted-copy", "No immutable scene version yet."));
  for (const version of detail.versions) {
    versions.append(element("div", "detail-line", `v${version.version_number} · ${humanStatus(version.status)} · ${parseTimestamp(version.created_at).toLocaleString()}`));
    if (version.workflow_policy_classification_status === "legacy_unknown") {
      versions.append(element(
        "p",
        "notice-card",
        `Version ${version.version_number} predates classified workflow-policy receipts. Existing releases remain historical evidence; create a new immutable version under an administrator-classified policy before publishing again.`,
      ));
    }
  }
  if (comparisonWorkspaceAvailable(detail.comparisonReadiness ?? emptyComparisonReadiness)) {
    const compareButton = element("button", "quiet-button wide", "Compare immutable versions");
    compareButton.addEventListener("click", () => compareDomain.openVersionComparison(detail.project.id, detail.versions));
    versions.append(compareButton);
  }
  const uploadButton = element("button", "primary-button", "Upload source asset");
  uploadButton.addEventListener("click", openUploadDialog);
  uploadButton.disabled = detail.project.status === "ARCHIVED";
  versions.append(uploadButton);

  const assets = detailCard("Assets");
  if (!detail.assets.length) assets.append(element("p", "muted-copy", "No assets stored."));
  for (const asset of detail.assets) {
    assets.append(element("div", "detail-line", `${asset.format.toUpperCase()} · ${asset.file_name} · ${formatBytes(asset.size_bytes)} · ${asset.integrity_status}`));
  }

  const captureBundles = detailCard("Capture contracts");
  if (!detail.captureBundles.length) {
    captureBundles.append(element(
      "p",
      "muted-copy",
      "No vendor-neutral capture contract has been registered for this project.",
    ));
  }
  for (const bundle of detail.captureBundles) {
    captureBundles.append(renderCaptureBundleSummary(bundle));
  }
  const verifiedAssets = detail.assets.filter((asset) => asset.integrity_status === "verified");
  if (verifiedAssets.length) {
    const registerBundle = element("button", "primary-button wide", "Register capture bundle");
    registerBundle.addEventListener("click", openCaptureBundleDialog);
    captureBundles.append(registerBundle);
  } else {
    captureBundles.append(element(
      "p",
      "field-note",
      "Upload and complete immutable asset validation before registering a capture contract.",
    ));
  }

  const releaseHistory = detailCard("Release history");
  for (const release of detail.releases) {
    const releaseRow = element("div", "release-row");
    const link = document.createElement("a");
    link.href = `/s/${release.slug}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `${release.slug} · ${release.access_policy}${release.is_active ? " · active" : ""}`;
    releaseRow.append(link);
    const exportEvidence = element("button", "quiet-button", "Export traversal evidence");
    exportEvidence.addEventListener("click", () => {
      void runAction({
        key: `export-navigation-evidence:${release.id}`,
        trigger: exportEvidence,
        pendingLabel: "Exporting…",
      }, () => exportNavigationTraversalEvidence(release));
    });
    releaseRow.append(exportEvidence);
    if (release.access_policy === "token" && !release.revoked_at) {
      releaseRow.append(revealAccessLinkButton(detail.project.id, release.id, "quiet-button"));
    }
    if (release.is_active) {
      const revoke = element("button", "danger-button", "Revoke");
      revoke.addEventListener("click", async () => {
        const confirmed = await confirmPublicationDecision({
          title: `Revoke /s/${release.slug}?`,
          message: "Visitors will lose access immediately. The immutable release remains in history.",
          confirmLabel: "Revoke release",
          danger: true,
        });
        if (!confirmed) return;
        await runAction({
          key: `revoke-release:${release.slug}`,
          trigger: revoke,
          pendingLabel: "Revoking…",
        }, () => revokeRelease(release.slug));
      });
      releaseRow.append(revoke);
    } else if (!release.revoked_at) {
      const rollback = element("button", "quiet-button", "Make active");
      rollback.addEventListener("click", async () => {
        const confirmed = await confirmPublicationDecision({
          title: `Make /s/${release.slug} active?`,
          message: "This historical release will replace the currently active release on the channel.",
          confirmLabel: "Make active",
        });
        if (!confirmed) return;
        await runAction({
          key: `rollback-release:${release.id}`,
          trigger: rollback,
          pendingLabel: "Activating…",
        }, () => rollbackRelease(release));
      });
      releaseRow.append(rollback);
    }
    releaseHistory.append(releaseRow);
  }
  if (!detail.releases.length) releaseHistory.append(element("p", "muted-copy", "No published releases yet."));

  const optionalTools = detailCard("Optional tools");
  const inviteButton = element("button", "quiet-button wide", "Invite client reviewer");
  inviteButton.addEventListener("click", () => openReviewerDialog(detail.project.id));
  const reviewButton = element("button", "quiet-button wide", "Open review workspace");
  reviewButton.addEventListener("click", () => {
    activateView("reviews");
    const project = state.reviewProjects.find((candidate) => candidate.id === detail.project.id);
    if (project) {
      void runAction({
        key: `load-review:${project.id}`,
        trigger: reviewButton,
        pendingLabel: "Loading activity…",
      }, () => loadReviewDetail(project));
    }
  });
  const deliveryButton = element("button", "quiet-button wide", "Delivery & hosting settings");
  deliveryButton.addEventListener("click", () => {
    void runAction({
      key: `load-delivery:${detail.project.id}`,
      trigger: deliveryButton,
      pendingLabel: "Loading settings…",
    }, openDeliveryDialog);
  });
  const spatialButton = element("button", "quiet-button wide", "Edit scene, rooms and navigation");
  spatialButton.disabled = !detail.project.latestVersionId;
  spatialButton.addEventListener("click", () => openSceneEditor(detail.project.id, spatialButton));
  const measurementButton = element("button", "quiet-button wide", "Measurement brief & QA");
  measurementButton.disabled = !detail.project.latestVersionId;
  measurementButton.addEventListener("click", () => {
    void runAction({
      key: `load-measurement:${detail.project.id}`,
      trigger: measurementButton,
      pendingLabel: "Opening evidence…",
    }, async () => {
      await loadMeasurementWorkspace(detail.project.id);
      activateProjectSection("measurement", true, "push", true);
    });
  });
  const domainButton = element("button", "quiet-button wide", "Add custom domain");
  domainButton.addEventListener("click", () => {
    void openDomainDialog();
  });
  optionalTools.append(spatialButton);
  if (effectiveProjectWorkflowPolicy(detail.project).measurement !== "hidden") optionalTools.append(measurementButton);
  optionalTools.append(inviteButton, reviewButton, deliveryButton, domainButton);

  const technicalDetails = element("details", "project-detail-disclosure");
  technicalDetails.append(element("summary", "", "Technical details and source history"));
  const technicalGrid = element("div", "project-detail-grid");
  technicalGrid.append(overview, versions, assets, captureBundles, releaseHistory);
  technicalDetails.append(technicalGrid);

  const optionalDetails = element("details", "project-detail-disclosure");
  optionalDetails.append(element("summary", "", "Optional editing, evidence, and delivery tools"));
  const optionalGrid = element("div", "project-detail-grid");
  optionalGrid.append(optionalTools);
  optionalDetails.append(optionalGrid);

  body.append(journey, sharing, technicalDetails, optionalDetails);
}

function projectJourneyStep(
  number: string,
  label: string,
  status: "complete" | "current" | "available" | "waiting" | "blocked",
  detail: string,
  target: ProjectSection,
): HTMLElement {
  const step = element("button", `project-journey-step ${status}`);
  step.type = "button";
  step.dataset.projectJourneySection = target;
  step.addEventListener("click", () => activateProjectSection(target, true, "push", true));
  if (state.projectSection === target) step.setAttribute("aria-current", "step");
  step.append(
    element("span", "project-journey-number", number),
    element("strong", "", label),
    element("small", "", detail),
  );
  return step;
}

function openSceneEditor(projectId: string, trigger: HTMLButtonElement): void {
  void runAction({
    key: `load-spatial:${projectId}`,
    trigger,
    pendingLabel: "Opening editor…",
  }, async () => {
    await loadSpatialWorkspace(projectId);
    activateProjectSection("structure", true, "push", true);
  });
}

function projectFact(label: string, value: string): HTMLElement {
  const line = element("div", "detail-line");
  line.append(element("strong", "", label), element("span", "", value));
  return line;
}

const captureBundleRoleLabels: Record<string, string> = {
  vendor_project: "Vendor project / export archive",
  raw_capture: "Raw capture",
  source_images: "Source images",
  camera_poses: "Camera poses",
  calibration: "Intrinsics + extrinsics",
  imu_trajectory: "IMU trajectory",
  gnss_trajectory: "GNSS trajectory",
  scanner_trajectory: "Scanner pose trajectory",
  metric_point_cloud: "Metric point cloud",
  gaussian_splat: "Gaussian splat",
  collision_mesh: "Collision mesh",
  vendor_semantic_mesh: "Vendor semantic export (preserved, not parsed)",
  traversal_evidence: "Traversal evidence",
};

function openCaptureBundleDialog(): void {
  const detail = state.selected;
  if (!detail) return;
  const form = byId<HTMLFormElement>("captureBundleForm");
  form.reset();
  setCaptureSceneRegistrationEnabled(false);
  captureBundleOperation = null;
  byId("captureBundleError").textContent = "";
  const versionSelect = byId<HTMLSelectElement>("captureBundleVersion");
  versionSelect.replaceChildren();
  for (const version of detail.versions.filter((candidate) =>
    detail.assets.some((asset) =>
      asset.version_id === candidate.id && asset.integrity_status === "verified"
    )
  )) {
    versionSelect.append(new Option(
      `Version ${version.version_number} · ${humanStatus(version.status)}`,
      version.id,
    ));
  }
  if (!versionSelect.options.length) {
    showNotice("A verified immutable asset is required before registering a capture bundle.", "error");
    return;
  }
  applyCaptureBundleVersionDefaults(versionSelect.value);
  setFormValue(form, "exportedAt", datetimeLocalValue(new Date()));
  renderCaptureBundleAssets(versionSelect.value);
  renderCaptureBundlePreview();
  captureBundleDialog.showModal();
}

function applyCaptureBundleVersionDefaults(versionId: string): void {
  const detail = state.selected;
  if (!detail) return;
  const captureProducer = versionCaptureAdapter(
    detail.versions.find((version) => version.id === versionId),
  );
  const form = byId<HTMLFormElement>("captureBundleForm");
  setFormValue(form, "adapter", captureProducer ?? "");
  const defaults = captureProducer
    ? captureAdapterDefaults(captureProducer)
    : { vendor: "", model: "", exporter: "" };
  setFormValue(form, "vendor", defaults.vendor);
  setFormValue(form, "model", defaults.model);
  setFormValue(form, "exporterName", defaults.exporter);
}

function captureAdapterDefaults(adapter: string): {
  vendor: string;
  model: string;
  exporter: string;
} {
  if (adapter === "xgrids-lcc") {
    return { vendor: "XGRIDS", model: "", exporter: "Lixel CyberColor" };
  }
  if (adapter === "fjd-trion") {
    return { vendor: "FJDynamics", model: "", exporter: "Trion Model" };
  }
  if (adapter === "phone-video") {
    return { vendor: "Mobile capture", model: "", exporter: "Spatial import adapter" };
  }
  if (adapter === "drone-imagery") {
    return { vendor: "Aerial capture", model: "", exporter: "Spatial drone import adapter" };
  }
  return { vendor: "Independent import", model: "", exporter: "Open export workflow" };
}

function setFormValue(form: HTMLFormElement, name: string, value: string): void {
  const field = form.elements.namedItem(name);
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
  ) {
    field.value = value;
  }
}

function datetimeLocalValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function captureBundleEligibleRoles(asset: Asset): string[] {
  const format = asset.format.toLowerCase();
  const roles: string[] = [];
  if (asset.kind === "source") roles.push("vendor_project", "raw_capture");
  if (asset.kind === "source" && ["zip", "jpg", "jpeg", "png"].includes(format)) {
    roles.push("source_images");
  }
  if (["source", "report"].includes(asset.kind) && ["json", "csv"].includes(format)) {
    roles.push("camera_poses", "imu_trajectory", "gnss_trajectory");
  }
  if (["source", "report"].includes(asset.kind) && ["json", "yaml", "yml"].includes(format)) {
    roles.push("calibration");
  }
  if (
    ["source", "master", "pointcloud"].includes(asset.kind) &&
    ["ply", "e57", "las", "laz", "pts"].includes(format)
  ) {
    roles.push("metric_point_cloud");
  }
  if (
    ["source", "master", "web", "portable"].includes(asset.kind) &&
    ["ply", "spz", "sog", "rad", "lcc", "lcc2"].includes(format)
  ) {
    roles.push("gaussian_splat");
  }
  if (
    ["source", "master", "collision"].includes(asset.kind) &&
    ["glb", "gltf", "obj", "ply"].includes(format)
  ) {
    roles.push("collision_mesh");
  }
  // A classified mesh or segmentation sidecar is declarable under its own role
  // so it is never promoted to collision_mesh, which would assert a physical
  // claim from labels this platform does not decode.
  if (
    ["source", "master", "report"].includes(asset.kind) &&
    ["obj", "ply", "glb", "gltf", "e57", "json", "csv", "zip"].includes(format)
  ) {
    roles.push("vendor_semantic_mesh");
  }
  if (["source", "master", "pointcloud", "collision", "report"].includes(asset.kind)) {
    roles.push("traversal_evidence");
  }
  return [...new Set(roles)];
}

function renderCaptureBundleAssets(versionId: string): void {
  const container = byId("captureBundleAssets");
  container.replaceChildren();
  const assets = state.selected?.assets.filter((asset) =>
    asset.version_id === versionId &&
    asset.integrity_status === "verified" &&
    asset.format !== "capture-bundle-manifest-json"
  ) ?? [];
  if (!assets.length) {
    container.append(emptyState("No verified immutable assets exist on this version.", true));
    return;
  }
  for (const asset of assets) {
    const row = element("label", "capture-bundle-asset");
    const selected = document.createElement("input");
    selected.type = "checkbox";
    selected.name = "captureAsset";
    selected.value = asset.id;
    const description = element("span");
    description.append(
      element("strong", "", asset.file_name),
      element(
        "small",
        "",
        `${humanStatus(asset.kind)} · ${asset.format.toUpperCase()} · ${formatBytes(asset.size_bytes)}`,
      ),
    );
    const roles = document.createElement("select");
    roles.multiple = true;
    roles.dataset.captureRoles = asset.id;
    roles.setAttribute("aria-label", `Evidence roles for ${asset.file_name}`);
    const eligibleRoles = captureBundleEligibleRoles(asset);
    for (const role of eligibleRoles) {
      const option = new Option(captureBundleRoleLabels[role] ?? humanStatus(role), role);
      roles.append(option);
    }
    const defaultRole = asset.kind === "source"
      ? "vendor_project"
      : asset.kind === "pointcloud"
        ? "metric_point_cloud"
        : asset.kind === "collision"
          ? "collision_mesh"
          : ["master", "web", "portable"].includes(asset.kind) &&
              ["ply", "spz", "sog", "rad", "lcc", "lcc2"].includes(asset.format.toLowerCase())
            ? "gaussian_splat"
            : null;
    if (defaultRole) {
      selected.checked = true;
      const option = Array.from(roles.options).find((candidate) => candidate.value === defaultRole);
      if (option) option.selected = true;
    }
    roles.disabled = !selected.checked;
    row.setAttribute("aria-disabled", String(!selected.checked));
    selected.addEventListener("change", () => {
      roles.disabled = !selected.checked;
      row.setAttribute("aria-disabled", String(!selected.checked));
      if (selected.checked && !Array.from(roles.selectedOptions).length && roles.options[0]) {
        roles.options[0].selected = true;
      }
      renderCaptureBundlePreview();
      renderCaptureRegistrationEvidenceOptions();
    });
    roles.addEventListener("change", () => {
      renderCaptureBundlePreview();
      renderCaptureRegistrationEvidenceOptions();
    });
    row.append(selected, description, roles);
    container.append(row);
  }
  renderCaptureRegistrationEvidenceOptions();
}

function renderCaptureRegistrationEvidenceOptions(): void {
  const select = byId<HTMLSelectElement>("captureRegistrationEvidence");
  const selectedId = select.value;
  const declarations = selectedCaptureBundleAssets();
  const assets = state.selected?.assets ?? [];
  select.replaceChildren();
  for (const declaration of declarations) {
    const asset = assets.find((candidate) => candidate.id === declaration.assetId);
    if (!asset) continue;
    select.append(new Option(
      `${asset.file_name} · ${declaration.roles.map((role) => captureBundleRoleLabels[role] ?? humanStatus(role)).join(", ")}`,
      asset.id,
    ));
  }
  if (selectedId && Array.from(select.options).some((option) => option.value === selectedId)) {
    select.value = selectedId;
  }
}

function setCaptureSceneRegistrationEnabled(enabled: boolean): void {
  for (const container of document.querySelectorAll<HTMLElement>(
    "#captureBundleForm [data-scene-registration-field]",
  )) {
    container.hidden = !enabled;
    for (const control of container.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "input, select",
    )) {
      control.required = enabled;
      if (!enabled) control.value = "";
    }
  }
}

function selectedCaptureBundleAssets(): Array<{
  assetId: string;
  roles: string[];
}> {
  const container = byId("captureBundleAssets");
  return Array.from(container.querySelectorAll<HTMLInputElement>("input[name='captureAsset']:checked"))
    .map((input) => {
      const roleSelect = container.querySelector<HTMLSelectElement>(
        `select[data-capture-roles="${CSS.escape(input.value)}"]`,
      );
      return {
        assetId: input.value,
        roles: roleSelect ? Array.from(roleSelect.selectedOptions, (option) => option.value) : [],
      };
    });
}

function captureBundleCapabilities(assets: Array<{ roles: string[] }>): Record<string, boolean> {
  const roles = new Set(assets.flatMap((asset) => asset.roles));
  return {
    rawImages: roles.has("source_images"),
    cameraPoses: roles.has("camera_poses"),
    intrinsics: roles.has("calibration"),
    extrinsics: roles.has("calibration"),
    imu: roles.has("imu_trajectory"),
    gnss: roles.has("gnss_trajectory"),
    lidarPointCloud: roles.has("metric_point_cloud"),
    gaussianSplat: roles.has("gaussian_splat"),
    collisionMesh: roles.has("collision_mesh"),
  };
}

function renderCaptureBundlePreview(): void {
  const assets = selectedCaptureBundleAssets();
  const preview = byId("captureBundlePreview");
  if (!assets.length) {
    preview.className = "notice-card warning";
    preview.textContent = "Select at least one immutable asset and assign one or more truthful evidence roles.";
    return;
  }
  const missingRoles = assets.filter((asset) => !asset.roles.length);
  if (missingRoles.length) {
    preview.className = "notice-card warning";
    preview.textContent = `${missingRoles.length} selected asset${missingRoles.length === 1 ? "" : "s"} still need an evidence role.`;
    return;
  }
  const capabilities = captureBundleCapabilities(assets);
  const independent =
    capabilities.rawImages &&
    capabilities.cameraPoses &&
    capabilities.intrinsics &&
    capabilities.extrinsics;
  const ready = [
    capabilities.gaussianSplat ? "browser master" : null,
    capabilities.lidarPointCloud ? "metric geometry" : null,
    independent ? "independent reconstruction inputs" : null,
    capabilities.collisionMesh ? "collision geometry" : null,
  ].filter(Boolean);
  preview.className = "notice-card";
  const registered = byId<HTMLInputElement>("captureAttachSceneRegistration").checked;
  preview.textContent =
    `${assets.length} immutable asset${assets.length === 1 ? "" : "s"} selected. ` +
    (ready.length ? `Evidences ${ready.join(", ")}. ` : "No delivery capability is evidenced yet. ") +
    (independent
      ? "Images, poses, intrinsics, and extrinsics are all represented. "
      : "Independent reconstruction remains unproven until images, poses, intrinsics, and extrinsics are all preserved. ") +
    (registered
      ? "A reviewed numeric scene registration will be attached."
      : "No scene registration will be claimed; this provenance-only manifest cannot qualify traversal.");
}

async function registerCaptureBundle(form: FormData): Promise<void> {
  const detail = state.selected;
  if (!detail) throw new Error("Open a project before registering a capture bundle.");
  const assets = selectedCaptureBundleAssets();
  if (!assets.length) throw new Error("Select at least one verified immutable asset.");
  if (assets.some((asset) => !asset.roles.length)) {
    throw new Error("Every selected asset requires at least one evidence role.");
  }
  const exportedAt = new Date(String(form.get("exportedAt") ?? ""));
  if (Number.isNaN(exportedAt.getTime())) throw new Error("Enter a valid export time.");
  const epsgValue = optionalString(form.get("epsg"));
  const axisConvention = String(form.get("axisConvention") ?? "right-handed-y-up");
  const coordinateUnits = String(form.get("coordinateUnits") ?? "metres");
  const attachSceneRegistration = form.get("attachSceneRegistration") === "on";
  let sceneRegistration: {
    evidenceAssetId: string;
    sourceToWorld: {
      sourceUpAxis: "Y" | "Z";
      worldUnit: "metres";
      metresPerSourceUnit: number;
      yawDegrees: number;
      translationMetres: number[];
    };
  } | undefined;
  if (attachSceneRegistration) {
    const sourceUpAxis = axisConvention.endsWith("z-up") ? "Z" : "Y";
    const metresPerSourceUnit = coordinateUnits === "millimetres" ? 0.001 : 1;
    const registrationNumbers = [
      Number(form.get("registrationYawDegrees")),
      Number(form.get("registrationTranslationX")),
      Number(form.get("registrationTranslationY")),
      Number(form.get("registrationTranslationZ")),
    ];
    if (registrationNumbers.some((value) => !Number.isFinite(value))) {
      throw new Error("Capture-to-scene yaw and translation must be evidence-derived finite numbers.");
    }
    const registrationEvidenceAssetId = String(form.get("registrationEvidenceAssetId") ?? "");
    if (!assets.some((asset) => asset.assetId === registrationEvidenceAssetId)) {
      throw new Error("Choose one selected immutable asset as registration evidence.");
    }
    sceneRegistration = {
      evidenceAssetId: registrationEvidenceAssetId,
      sourceToWorld: {
        sourceUpAxis,
        worldUnit: "metres",
        metresPerSourceUnit,
        yawDegrees: registrationNumbers[0]!,
        translationMetres: registrationNumbers.slice(1),
      },
    };
  }
  const limitations = String(form.get("limitations") ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (limitations.length > 20) throw new Error("Record no more than 20 known limitations.");
  const versionId = String(form.get("versionId") ?? "");
  const captureProducer = versionCaptureAdapter(
    detail.versions.find((version) => version.id === versionId),
  );
  if (!captureProducer) {
    throw new Error("The selected immutable version does not record its asset producer.");
  }
  const body = {
    versionId,
    schemaVersion: "1.0.0",
    adapter: captureProducer,
    captureSystem: {
      vendor: String(form.get("vendor") ?? "").trim(),
      model: String(form.get("model") ?? "").trim(),
      hardwareVersion: optionalString(form.get("hardwareVersion")) ?? null,
      firmwareVersion: optionalString(form.get("firmwareVersion")) ?? null,
      deviceIdHash: null,
    },
    exporter: {
      name: String(form.get("exporterName") ?? "").trim(),
      version: String(form.get("exporterVersion") ?? "").trim(),
      exportedAt: exportedAt.toISOString(),
      mode: String(form.get("exporterMode") ?? "gui"),
      operatingSystem: navigator.platform || null,
    },
    coordinateFrame: {
      id: String(form.get("coordinateFrameId") ?? "").trim(),
      units: coordinateUnits,
      axisConvention,
      epsg: epsgValue ? Number(epsgValue) : null,
      registrationMethod: String(form.get("registrationMethod") ?? "").trim(),
      ...(sceneRegistration ? { sceneRegistration } : {}),
    },
    assets: assets.map((asset) => ({
      assetId: asset.assetId,
      roles: asset.roles,
      description: null,
    })),
    capabilities: captureBundleCapabilities(assets),
    rights: {
      commercialUseConfirmed: form.get("commercialUseConfirmed") === "on",
      selfHostingConfirmed: form.get("selfHostingConfirmed") === "on",
      redistributionConfirmed: form.get("redistributionConfirmed") === "on",
      evidence: String(form.get("rightsEvidence") ?? "").trim(),
    },
    limitations,
  };
  const requestKey = JSON.stringify(body);
  if (!captureBundleOperation || captureBundleOperation.requestKey !== requestKey) {
    captureBundleOperation = { id: crypto.randomUUID(), requestKey };
  }
  const result = await api<{ manifest: { result: string } }>(
    `/api/projects/${detail.project.id}/capture-bundles`,
    {
      method: "POST",
      body: JSON.stringify({
        clientOperationId: captureBundleOperation.id,
        ...body,
      }),
    },
  );
  captureBundleDialog.close();
  captureBundleOperation = null;
  showNotice(
    result.manifest.result === "blocked"
      ? "Capture bundle registered with blockers. Review the evidence before production use."
      : "Capture bundle registered as immutable evidence.",
    result.manifest.result === "blocked" ? "warning" : "success",
  );
  await selectProject(detail.project.id, false);
}

function renderCaptureBundleSummary(bundle: CaptureBundle): HTMLElement {
  const validation = parseCaptureBundleValidation(bundle.validation_json);
  const container = element("section", "capture-bundle-summary");
  const header = element("header");
  header.append(
    element("strong", "", `Version ${captureBundleVersionNumber(bundle.version_id)} · ${humanStatus(bundle.adapter)}`),
    element("span", `status-pill ${bundle.result}`, humanStatus(bundle.result)),
  );
  container.append(header);
  if (!validation) {
    container.append(element("p", "form-error", "Stored capture-contract validation is unreadable."));
    return container;
  }
  container.append(element(
    "small",
    "muted-copy",
    `${validation.summary.assetCount} assets · ${formatBytes(validation.summary.totalBytes)} · ` +
      `${validation.summary.reconstructionPortable ? "portable reconstruction" : "portability incomplete"} · ` +
      `${validation.summary.independentlyReconstructable ? "independent inputs complete" : "independent inputs incomplete"} · ` +
      `${validation.summary.sceneRegistered ? "scene transform registered" : "scene transform missing"}`,
  ));
  if (validation.issues.length) {
    const issues = document.createElement("ul");
    for (const issue of validation.issues.slice(0, 4)) {
      issues.append(element("li", "", issue.message));
    }
    if (validation.issues.length > 4) {
      issues.append(element("li", "", `${validation.issues.length - 4} additional issue(s) retained in the manifest.`));
    }
    container.append(issues);
  }
  if (bundle.review_decision) {
    container.append(element(
      "small",
      "muted-copy",
      `${humanStatus(bundle.review_decision)} · ${bundle.review_note ?? "Review recorded."}`,
    ));
  }
  const review = element(
    "button",
    bundle.review_decision ? "quiet-button" : "primary-button",
    bundle.review_decision ? "Review again" : "Review capture contract",
  );
  review.addEventListener("click", () => openCaptureBundleReview(bundle, validation));
  container.append(review);
  return container;
}

function parseCaptureBundleValidation(value: string): CaptureBundleValidation | null {
  try {
    const validation = JSON.parse(value) as CaptureBundleValidation;
    return validation?.method === "capture-bundle-contract-v1" ? validation : null;
  } catch {
    return null;
  }
}

function captureBundleVersionNumber(versionId: string): number | string {
  return state.selected?.versions.find((version) => version.id === versionId)?.version_number ?? "-";
}

function openCaptureBundleReview(
  bundle: CaptureBundle,
  validation: CaptureBundleValidation,
): void {
  const form = byId<HTMLFormElement>("captureBundleReviewForm");
  form.reset();
  setFormValue(form, "manifestId", bundle.id);
  setFormValue(
    form,
    "decision",
    bundle.review_decision ??
      (bundle.result === "blocked" ? "needs_vendor_evidence" : "accepted"),
  );
  setFormValue(form, "note", bundle.review_note ?? "");
  const blockers = validation.issues.filter((issue) => issue.severity === "blocker").length;
  const warnings = validation.issues.filter((issue) => issue.severity === "warning").length;
  byId("captureBundleReviewContext").textContent =
    `${humanStatus(bundle.result)} · ${validation.summary.assetCount} exact assets · ${blockers} blockers · ` +
    `${warnings} warnings · ${validation.summary.reconstructionPortable ? "portable master evidenced" : "portable master not evidenced"} · ` +
    `${validation.summary.independentlyReconstructable ? "independent reconstruction inputs complete" : "independent reconstruction inputs incomplete"}.`;
  byId("captureBundleReviewError").textContent = "";
  captureBundleReviewDialog.showModal();
}

async function reviewCaptureBundle(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before reviewing its capture bundle.");
  const manifestId = String(form.get("manifestId") ?? "");
  await api(`/api/projects/${project.id}/capture-bundles/${manifestId}`, {
    method: "PATCH",
    body: JSON.stringify({
      decision: String(form.get("decision") ?? ""),
      note: String(form.get("note") ?? "").trim(),
    }),
  });
  captureBundleReviewDialog.close();
  showToast("Capture-contract review recorded");
  await selectProject(project.id, false);
}

function renderProjectCustomFieldForm(
  containerId: "newProjectRequiredCustomFields" | "newProjectCustomFields" | "editProjectCustomFields",
  values: Record<string, string | number | boolean>,
): void {
  const container = byId(containerId);
  container.replaceChildren();
  const fields = state.projectFields.filter((field) => {
    if (!field.active) return false;
    if (containerId === "newProjectRequiredCustomFields") return field.required;
    if (containerId === "newProjectCustomFields") return !field.required;
    return true;
  });
  if (!fields.length) return;
  if (containerId !== "newProjectRequiredCustomFields") {
    container.append(
      element("h3", "", "Organisation metadata"),
      element(
        "p",
        "",
        "These typed fields are governed by the current workspace and validated before saving.",
      ),
    );
  }
  const grid = element("div", "custom-field-grid");
  for (const field of fields) {
    const label = document.createElement("label");
    label.append(element(
      "span",
      "",
      `${field.label}${field.required ? " *" : ""}`,
    ));
    const value = values[field.key];
    let input: HTMLInputElement | HTMLSelectElement;
    if (field.type === "select") {
      input = document.createElement("select");
      input.append(new Option(field.required ? "Choose an option" : "Not set", ""));
      for (const option of field.options) input.append(new Option(option, option));
      input.value = typeof value === "string" ? value : "";
    } else if (field.type === "boolean") {
      input = document.createElement("select");
      input.append(
        new Option(field.required ? "Choose true or false" : "Not set", ""),
        new Option("True", "true"),
        new Option("False", "false"),
      );
      input.value = typeof value === "boolean" ? String(value) : "";
    } else {
      input = document.createElement("input");
      input.type = field.type === "number" ? "number" : field.type;
      if (field.type === "number") input.step = "any";
      if (field.type === "text" || field.type === "url") input.maxLength = 2048;
      input.value = value === undefined ? "" : String(value);
    }
    input.dataset.customFieldKey = field.key;
    input.dataset.customFieldType = field.type;
    input.required = field.required;
    input.setAttribute("aria-label", field.label);
    label.append(input);
    if (field.description) label.append(element("small", "", field.description));
    grid.append(label);
  }
  container.append(grid);
}

function renderNewProjectMetadataFields(): void {
  renderProjectCustomFieldForm("newProjectRequiredCustomFields", {});
  renderProjectCustomFieldForm("newProjectCustomFields", {});
  const requiredCount = state.projectFields.filter((field) => field.active && field.required).length;
  const optionalCustomCount = state.projectFields.filter((field) => field.active && !field.required).length;
  byId("newProjectRequiredInformation").hidden = requiredCount === 0;
  byId("newProjectOptionalSummary").textContent =
    `Optional project details · ${4 + optionalCustomCount} fields`;
}

function projectCustomFieldsFromForm(
  container: HTMLElement,
  includeEmpty = false,
): Record<string, string | number | boolean | null> {
  const values: Record<string, string | number | boolean | null> = {};
  for (const input of container.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    "[data-custom-field-key]",
  )) {
    const key = input.dataset.customFieldKey;
    const type = input.dataset.customFieldType;
    if (!key || !type) continue;
    if (!input.value) {
      if (includeEmpty) values[key] = null;
      continue;
    }
    if (type === "number") values[key] = Number(input.value);
    else if (type === "boolean") values[key] = input.value === "true";
    else values[key] = input.value.trim();
  }
  return values;
}

function formatProjectCustomFieldValue(value: string | number | boolean | undefined): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value === undefined ? "Not set" : String(value);
}

function openEditProjectDialog(): void {
  const project = state.selected?.project;
  if (!project) return;
  const form = byId<HTMLFormElement>("editProjectForm");
  const setValue = (name: string, value: string) => {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
      field.value = value;
    }
  };
  setValue("name", project.name);
  setValue("customerName", project.customerName ?? "");
  setValue("customerEmail", project.customerEmail ?? "");
  setValue(
    "captureOrigin",
    project.captureOrigin ?? captureOriginForLegacyAdapter(project.captureAdapter as CaptureAdapterId),
  );
  setValue("assetProducer", project.assetProducer ?? "");
  setValue("deliveryTemplate", project.deliveryTemplate);
  setValue("notes", project.notes ?? "");
  // Trajectory auto-open changes what the platform will open on machine
  // evidence alone, so it stays an administrator decision and is shown only
  // to the role that can save it.
  const trajectoryAutoOpenVisible = state.user?.role === "platform_admin";
  byId("editProjectTrajectoryAutoOpenField").hidden = !trajectoryAutoOpenVisible;
  byId("editProjectTrajectoryAutoOpenNote").hidden = !trajectoryAutoOpenVisible;
  byId("editProjectTrajectoryClutterDemotionField").hidden = !trajectoryAutoOpenVisible;
  byId("editProjectTrajectoryClutterDemotionNote").hidden = !trajectoryAutoOpenVisible;
  setValue("trajectoryAutoOpen", effectiveProjectWorkflowPolicy(project).trajectoryAutoOpen);
  setValue(
    "trajectoryClutterDemotion",
    effectiveProjectWorkflowPolicy(project).trajectoryClutterDemotion,
  );
  renderProjectCustomFieldForm("editProjectCustomFields", project.customFields);
  const canGovern = state.user?.role === "platform_admin";
  for (const name of ["captureOrigin", "assetProducer", "deliveryTemplate"]) {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLSelectElement) {
      field.disabled = !canGovern;
      field.title = canGovern
        ? "Changes become defaults for the next immutable scene version."
        : "A platform administrator must approve this governed transition.";
    }
  }
  byId("editProjectError").textContent = "";
  editProjectDialog.showModal();
}

async function updateProject(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  const assetProducer = String(form.get("assetProducer") ?? "");
  const currentPolicy = effectiveProjectWorkflowPolicy(project);
  const trajectoryAutoOpen = String(
    form.get("trajectoryAutoOpen") ?? currentPolicy.trajectoryAutoOpen,
  ) as ProjectWorkflowPolicy["trajectoryAutoOpen"];
  const trajectoryClutterDemotion = String(
    form.get("trajectoryClutterDemotion") ?? currentPolicy.trajectoryClutterDemotion,
  ) as ProjectWorkflowPolicy["trajectoryClutterDemotion"];
  const policyChanged = trajectoryAutoOpen !== currentPolicy.trajectoryAutoOpen ||
    trajectoryClutterDemotion !== currentPolicy.trajectoryClutterDemotion;
  const clutterDemotionReason = {
    "pass-through":
      "Limit clutter demotion to pass-through evidence: only walls the scanner walked through are removed.",
    "walked-majority":
      "Enable walked-majority clutter demotion: wall runs mostly standing on walked floor are removed.",
    "walked-contact":
      "Enable walked-contact clutter demotion: any wall run standing on walked floor is removed.",
  }[trajectoryClutterDemotion];
  try {
    await api(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        customerName: optionalString(form.get("customerName")) ?? null,
        customerEmail: optionalString(form.get("customerEmail")) ?? null,
        notes: optionalString(form.get("notes")) ?? null,
        customFields: projectCustomFieldsFromForm(byId("editProjectCustomFields"), true),
        ...(state.user?.role === "platform_admin" ? {
          captureOrigin: String(form.get("captureOrigin") ?? project.captureOrigin ??
            captureOriginForLegacyAdapter(project.captureAdapter as CaptureAdapterId)),
          assetProducer: assetProducer || null,
          deliveryTemplate: String(form.get("deliveryTemplate") ?? project.deliveryTemplate),
          // The policy schema is strict and every dimension is behaviour, so
          // the whole current policy travels with the one dimension this form
          // edits — never a partial object that would reset the rest.
          ...(policyChanged ? {
            workflowPolicy: { ...currentPolicy, trajectoryAutoOpen, trajectoryClutterDemotion },
            transitionReason: trajectoryAutoOpen !== currentPolicy.trajectoryAutoOpen
              ? (trajectoryAutoOpen === "visited-rooms"
                ? "Enable trajectory auto-open: scanner-visited rooms may qualify unresolved openings."
                : "Disable trajectory auto-open: unresolved openings stay sealed until an operator classifies them.")
              : clutterDemotionReason,
          } : {}),
        } : {}),
      }),
    });
    editProjectDialog.close();
    showToast("Project settings saved");
    await refreshAll();
  } catch (error) {
    byId("editProjectError").textContent = errorMessage(error);
  }
}

async function bulkChangeProjectLifecycle(action: "archive" | "restore"): Promise<void> {
  const projectIds = selectedProjectsForAction(action).map((project) => project.id).sort();
  if (!projectIds.length) return;
  const projectIdsKey = projectIds.join(":");
  if (
    !bulkLifecycleOperation
    || bulkLifecycleOperation.action !== action
    || bulkLifecycleOperation.projectIdsKey !== projectIdsKey
  ) {
    bulkLifecycleOperation = {
      id: crypto.randomUUID(),
      action,
      projectIdsKey,
    };
  }

  const result = await api<ProjectBulkLifecycleResult>("/api/projects/bulk-lifecycle", {
    method: "POST",
    body: JSON.stringify({
      clientOperationId: bulkLifecycleOperation.id,
      action,
      projectIds,
    }),
  });
  bulkLifecycleOperation = null;
  for (const item of result.results) {
    if (item.outcome !== "blocked") state.selectedProjectIds.delete(item.projectId);
  }
  await refreshAll();

  if (result.summary.blocked || result.summary.notFound) {
    const blocked = result.results
      .filter((item) => item.outcome === "blocked")
      .map((item) => item.projectName ?? item.projectId)
      .slice(0, 3);
    showNotice(
      `${result.summary.changed} changed, ${result.summary.unchanged} already in the requested state, `
      + `${result.summary.blocked} blocked, and ${result.summary.notFound} unavailable.`
      + (blocked.length ? ` Resolve dependencies for ${blocked.join(", ")}, then retry the retained selection.` : ""),
      "error",
    );
    return;
  }
  showNotice(
    `${result.summary.changed} project${result.summary.changed === 1 ? "" : "s"} ${action === "archive" ? "archived" : "restored"}`
    + `${result.summary.unchanged ? `; ${result.summary.unchanged} already matched the requested state` : ""}.`,
    "success",
  );
}

async function changeProjectLifecycle(action: "archive" | "restore"): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  try {
    await api(`/api/projects/${project.id}/${action}`, { method: "POST" });
    showToast(action === "archive" ? "Project archived" : "Project restored");
    await refreshAll();
  } catch (error) {
    showNotice(errorMessage(error), "error");
  }
}

function openUploadDialog(): void {
  if (!state.selected) return;
  const projectId = state.selected.project.id;
  const captureProducer = state.selected.project.assetProducer ?? state.selected.project.captureAdapter;
  const profile = captureAdapterProfiles.find((candidate) =>
    candidate.id === captureProducer
  );
  const guidance = byId("uploadAdapterGuidance");
  guidance.replaceChildren(
    element("strong", "", profile?.label ?? humanStatus(captureProducer)),
    element("p", "muted-copy", profile?.summary ?? "Preserve the immutable source and declare its role truthfully."),
    element(
      "small",
      "",
      profile
        ? `Evidence target: ${profile.evidence.join(" · ")}`
        : "No adapter-specific evidence profile is available.",
    ),
  );
  const defaultPurpose: CaptureAssetPurpose =
    captureProducer === "phone-video"
      ? "source_video"
      : captureProducer === "drone-imagery"
        ? "source_images"
        : "gaussian_splat";
  byId<HTMLSelectElement>("uploadPurpose").value = defaultPurpose;
  syncUploadPurpose(defaultPurpose);
  byId<HTMLTextAreaElement>("uploadPosterCamera").value = "";
  byId<HTMLInputElement>("uploadProjectName").value = state.selected.project.name;
  byId<HTMLElement>("uploadProgress").style.width = "0%";
  byId("uploadStatus").textContent = "Checking for interrupted uploads…";
  byId("uploadError").textContent = "";
  const submit = byId<HTMLFormElement>("uploadForm").querySelector<HTMLButtonElement>("[type='submit']");
  if (submit) submit.textContent = activeUpload?.projectId === state.selected.project.id
    ? "Resume upload"
    : "Start resumable upload";
  uploadDialog.showModal();
  void loadRecoverableUploads(projectId);
}

const captureFormatLabels: Record<CaptureAssetFormat, string> = {
  ply: "PLY",
  spz: "SPZ",
  sog: "SOG",
  splat: "SPLAT",
  ksplat: "KSPLAT",
  zip: "ZIP archive",
  rad: "Spark RAD",
  lcc: "XGRIDS LCC",
  lcc2: "XGRIDS LCC2",
  xbin: "XGRIDS XBIN",
  fjdslam: "FJD SLAM project",
  e57: "ASTM E57",
  las: "LAS",
  laz: "LAZ",
  pts: "PTS",
  jpg: "JPEG",
  jpeg: "JPEG",
  png: "PNG",
  webp: "WEBP",
  mp4: "MP4",
  mov: "MOV",
  webm: "WEBM",
  json: "JSON",
  csv: "CSV",
  yaml: "YAML",
  yml: "YAML",
  glb: "Binary glTF",
  gltf: "glTF",
  obj: "OBJ",
};

const capturePurposeHelp: Record<CaptureAssetPurpose, string> = {
  gaussian_splat: "Spark validates this portable Gaussian master and derives an immutable browser-ready RAD scene.",
  web_scene: "The platform verifies this prebuilt Spark RAD, SPZ, or SOG scene and records it directly as a browser-delivery asset.",
  vendor_project: "The original vendor project remains private evidence; it is not treated as a browser scene.",
  raw_capture: "The raw scanner or capture container remains private evidence and requires a later reconstruction output.",
  source_images: "Original imagery is preserved for reproducibility and future reconstruction. A ZIP should retain the source filenames and metadata.",
  source_video: "Original video is preserved for a later reconstruction adapter; uploading it does not create a spatial scene by itself.",
  camera_poses: "Pose evidence is integrity-checked and must still be reviewed for coordinate convention and frame alignment.",
  calibration: "Calibration evidence is preserved without claiming that the camera model or calibration accuracy has been independently verified.",
  imu_trajectory: "The trajectory is preserved as source evidence; semantic validation remains a review task.",
  gnss_trajectory: "GNSS evidence is preserved without inferring RTK fix quality, datum, or survey control.",
  scanner_trajectory: "The scanner's registered pose path becomes traversal evidence: rooms it visited can qualify for automatic walkability at review time.",
  metric_point_cloud: "Metric geometry is stored as a point-cloud asset and does not enter the Gaussian reconstruction lane.",
  collision_mesh: "Collision geometry is preserved separately from appearance and requires spatial-alignment review.",
  vendor_semantic_mesh: "A vendor's classified mesh or segmentation sidecar is preserved verbatim as evidence. Its classification semantics are not parsed, and it never becomes collision or navigation geometry.",
};

function syncUploadPurpose(purpose: CaptureAssetPurpose): void {
  const formatSelect = byId<HTMLSelectElement>("uploadFormat");
  const formats = captureFormatsForPurpose(purpose);
  const prior = formatSelect.value;
  formatSelect.replaceChildren(...formats.map((format) =>
    new Option(captureFormatLabels[format], format),
  ));
  if (formats.includes(prior as CaptureAssetFormat)) formatSelect.value = prior;
  // The file picker deliberately stays permissive. Narrowing it to the
  // selected purpose made the dialog unusable in the normal direction: the
  // purpose is detected FROM the chosen file, so a picker that hides
  // everything except the current purpose's formats can never show the file
  // that would correct it. The format select below still narrows, and the
  // server still validates purpose against format and adapter.
  const attachmentTarget = captureAssetPurposeCanAttachToExistingVersion(purpose)
    ? auxiliaryAssetTargetVersion()
    : null;
  byId("uploadPurposeHelp").textContent = attachmentTarget
    ? `${capturePurposeHelp[purpose]} It will attach to v${attachmentTarget.version_number}, the latest approved visual version, without replacing its immutable scene bytes.`
    : capturePurposeHelp[purpose];
  syncUploadPosterCameraRequirement();
}

function auxiliaryAssetTargetVersion(): Version | null {
  if (!state.selected) return null;
  return [...state.selected.versions]
    .sort((left, right) => right.version_number - left.version_number)
    .find((version) =>
      ["APPROVED", "PUBLISHED"].includes(version.status) &&
      state.selected!.assets.some((asset) =>
        asset.version_id === version.id &&
        asset.kind === "web" &&
        asset.integrity_status === "verified"
      )
    ) ?? null;
}

function auxiliaryCollisionTargetVersion(): Version | null {
  return auxiliaryAssetTargetVersion();
}

function syncUploadPosterCameraRequirement(): void {
  const purpose = byId<HTMLSelectElement>("uploadPurpose").value;
  const format = byId<HTMLSelectElement>("uploadFormat").value;
  const field = byId<HTMLElement>("uploadPosterCameraField");
  const input = byId<HTMLTextAreaElement>("uploadPosterCamera");
  field.hidden = purpose !== "web_scene";
  input.required = purpose === "web_scene" && format === "sog";
}

async function loadRecoverableUploads(projectId: string): Promise<void> {
  const recovery = byId("uploadRecovery");
  recovery.hidden = false;
  recovery.setAttribute("aria-busy", "true");
  recovery.replaceChildren(element("small", "", "Checking durable upload sessions…"));
  try {
    const result = await api<{ uploads: RecoverableUpload[] }>(
      `/api/projects/${projectId}/uploads/open`,
    );
    if (state.selected?.project.id !== projectId || !uploadDialog.open) return;
    state.recoverableUploads = result.uploads;
    renderRecoverableUploads(projectId);
  } catch (error) {
    if (state.selected?.project.id !== projectId || !uploadDialog.open) return;
    const retry = element("button", "quiet-button", "Retry recovery check");
    retry.addEventListener("click", () => {
      void runAction({
        key: `upload-recovery:${projectId}`,
        trigger: retry,
        pendingLabel: "Checking…",
        errorTarget: byId("uploadError"),
      }, () => loadRecoverableUploads(projectId));
    });
    recovery.replaceChildren(
      element("strong", "", "Upload recovery unavailable"),
      element("p", "muted-copy", errorMessage(error)),
      retry,
    );
  } finally {
    if (state.selected?.project.id === projectId) recovery.removeAttribute("aria-busy");
  }
}

function renderRecoverableUploads(projectId: string): void {
  const recovery = byId("uploadRecovery");
  recovery.replaceChildren();
  if (!state.recoverableUploads.length) {
    recovery.hidden = true;
    byId("uploadStatus").textContent = "Ready to upload.";
    return;
  }
  recovery.hidden = false;
  recovery.append(
    element("strong", "", "Interrupted uploads found"),
    element("p", "muted-copy", "Select the exact same local file to resume only the missing 25 MiB parts, or discard a session you no longer need."),
  );
  for (const upload of state.recoverableUploads) {
    const row = element("div", "upload-recovery-row");
    const description = element("span");
    const percentage = upload.expectedSizeBytes
      ? Math.min(100, Math.round(upload.uploadedBytes / upload.expectedSizeBytes * 100))
      : 0;
    description.append(
      element("strong", "", upload.fileName),
      element(
        "small",
        "",
        upload.expired
          ? `Expired · ${formatBytes(upload.uploadedBytes)} retained until discarded`
          : `${humanStatus(upload.purpose)} · ${percentage}% · ${formatBytes(upload.uploadedBytes)} of ${formatBytes(upload.expectedSizeBytes)} · expires ${relativeTime(upload.expiresAt)}`,
      ),
    );
    const actions = element("span", "workspace-actions");
    if (!upload.expired) {
      const resume = element(
        "button",
        activeUpload?.id === upload.id ? "primary-button" : "quiet-button",
        activeUpload?.id === upload.id ? "Selected" : "Resume",
      );
      resume.type = "button";
      resume.disabled = activeUpload?.id === upload.id;
      resume.addEventListener("click", () => {
        selectRecoverableUpload(upload);
        renderRecoverableUploads(projectId);
      });
      actions.append(resume);
    }
    const discard = element("button", "danger-button", "Discard");
    discard.type = "button";
    discard.addEventListener("click", () => {
      if (!confirm(`Discard the interrupted upload for ${upload.fileName}? Uploaded parts will be removed from R2.`)) return;
      void runAction({
        key: `discard-upload:${upload.id}`,
        trigger: discard,
        pendingLabel: "Discarding…",
        errorTarget: byId("uploadError"),
      }, () => discardRecoverableUpload(projectId, upload.id));
    });
    actions.append(discard);
    row.append(description, actions);
    recovery.append(row);
  }
  byId("uploadStatus").textContent = activeUpload?.projectId === projectId
    ? `Resume selected: choose ${activeUpload.fileName} above.`
    : "Choose a session to resume, or select a new file to start another upload.";
}

function selectRecoverableUpload(upload: RecoverableUpload): void {
  activeUpload = {
    id: upload.id,
    projectId: upload.projectId,
    fileName: upload.fileName,
    fileSize: upload.expectedSizeBytes,
    format: upload.format,
    purpose: upload.purpose,
    partSizeBytes: upload.partSizeBytes,
    sha256: upload.sha256,
    parts: new Map(upload.parts.map((part) => [part.partNumber, part.etag])),
  };
  const format = byId<HTMLFormElement>("uploadForm").elements.namedItem("format");
  const purpose = byId<HTMLFormElement>("uploadForm").elements.namedItem("purpose");
  if (purpose instanceof HTMLSelectElement) {
    purpose.value = upload.purpose;
    syncUploadPurpose(upload.purpose);
  }
  if (format instanceof HTMLSelectElement) format.value = upload.format;
  const submit = byId<HTMLFormElement>("uploadForm").querySelector<HTMLButtonElement>("[type='submit']");
  if (submit) submit.textContent = "Resume upload";
}

async function discardRecoverableUpload(projectId: string, uploadId: string): Promise<void> {
  await api(`/api/uploads/${uploadId}`, { method: "DELETE" });
  if (activeUpload?.id === uploadId) activeUpload = null;
  state.recoverableUploads = state.recoverableUploads.filter((upload) => upload.id !== uploadId);
  renderRecoverableUploads(projectId);
  showToast("Interrupted upload discarded");
  await refreshAll();
}

type UploadPresentation = {
  status: HTMLElement;
  progress: HTMLElement;
  error: HTMLElement;
  pauseButton?: HTMLButtonElement;
  closeDialog?: HTMLDialogElement;
  successToast?: string;
};

type CompletedCaptureUpload = {
  asset: {
    id: string;
    versionId: string;
    kind: string;
    purpose: CaptureAssetPurpose;
    sizeBytes: number;
    integrityStatus: string;
  };
  job: { id: string; type: string; state: string };
};

type UploadOptions = {
  targetVersionId?: string;
  clientOperationId?: string;
  captureJourney?: {
    id: string;
    qualification:
      | typeof AUTOMATIC_PAIRED_CAPTURE_METHOD
      | typeof ATTESTED_PAIRED_CAPTURE_METHOD;
    sameFrameConfirmed?: true;
  };
};

async function uploadAsset(
  form: FormData,
  presentation: UploadPresentation = {
    status: byId("uploadStatus"),
    progress: byId<HTMLElement>("uploadProgress"),
    error: byId("uploadError"),
    pauseButton: byId<HTMLButtonElement>("pauseUploadButton"),
    closeDialog: uploadDialog,
    successToast: "Source asset ingested",
  },
  options: UploadOptions = {},
): Promise<CompletedCaptureUpload> {
  if (!state.selected) throw new Error("Open a project before uploading capture data.");
  const file = form.get("asset");
  if (!(file instanceof File)) throw new Error("Choose a capture file to upload.");
  const format = String(form.get("format") ?? "");
  const purpose = String(form.get("purpose") ?? "") as CaptureAssetPurpose;
  const targetVersionId = options.targetVersionId ?? (
    captureAssetPurposeCanAttachToExistingVersion(purpose)
      ? auxiliaryAssetTargetVersion()?.id ?? null
      : null
  );
  if (captureAssetPurposeCanAttachToExistingVersion(purpose) && !targetVersionId) {
    throw new Error("Approve a visual scene version before attaching capture evidence or geometry.");
  }
  const posterCameraText = String(form.get("posterCamera") ?? "").trim();
  let posterCamera: unknown;
  if (posterCameraText) {
    try {
      posterCamera = JSON.parse(posterCameraText);
    } catch {
      throw new Error("The authored opening camera must be valid JSON.");
    }
  }
  const { status, progress } = presentation;
  const pauseButton = presentation.pauseButton;
  uploadAbortController = new AbortController();
  if (pauseButton) {
    pauseButton.hidden = false;
    pauseButton.disabled = false;
    pauseButton.textContent = "Pause upload";
  }
  try {
    const projectId = state.selected.project.id;
    const canResume = activeUpload?.projectId === projectId &&
      activeUpload.fileName === file.name &&
      activeUpload.fileSize === file.size &&
      activeUpload.format === format &&
      activeUpload.purpose === purpose;
    if (activeUpload?.projectId === projectId && !canResume) {
      throw new Error(`Choose the exact ${activeUpload.fileName} file to resume this session, or discard the selected session.`);
    }
    if (!canResume) {
      const operationMatches = pendingUploadOperation?.projectId === projectId &&
        pendingUploadOperation.fileName === file.name &&
        pendingUploadOperation.fileSize === file.size &&
        pendingUploadOperation.format === format &&
        pendingUploadOperation.purpose === purpose &&
        pendingUploadOperation.targetVersionId === targetVersionId &&
        pendingUploadOperation.captureJourneyId === (options.captureJourney?.id ?? null) &&
        (!options.clientOperationId || pendingUploadOperation.id === options.clientOperationId);
      if (!operationMatches) {
        pendingUploadOperation = {
          id: options.clientOperationId ?? crypto.randomUUID(),
          projectId,
          fileName: file.name,
          fileSize: file.size,
          format,
          purpose,
          targetVersionId,
          captureJourneyId: options.captureJourney?.id ?? null,
          sha256: null,
        };
      }
      const operationId = pendingUploadOperation?.id;
      if (!operationId) throw new Error("The upload operation could not be initialised.");
      let declaredSha256 = pendingUploadOperation?.sha256 ?? null;
      if (!declaredSha256) {
        try {
          let lastPercent = -1;
          declaredSha256 = await sha256HexOfBlob(file, {
            signal: uploadAbortController.signal,
            onProgress: (hashedBytes, totalBytes) => {
              const percent = totalBytes ? Math.floor(hashedBytes / totalBytes * 100) : 100;
              if (percent === lastPercent) return;
              lastPercent = percent;
              status.textContent = `Computing SHA-256 integrity fingerprint… ${percent}%`;
            },
          });
          if (pendingUploadOperation) pendingUploadOperation.sha256 = declaredSha256;
        } catch (error) {
          if (uploadAbortController.signal.aborted) throw error;
          // The file could not be streamed for hashing; continue without a
          // declared fingerprint so the upload itself stays functional.
          declaredSha256 = null;
        }
      }
      status.textContent = "Creating immutable multipart upload…";
      const initiated = await api<{ upload: { id: string; partSizeBytes: number; expectedSizeBytes: number } }>(
        `/api/projects/${projectId}/uploads`,
        {
          method: "POST",
          body: JSON.stringify({
            clientOperationId: operationId,
            fileName: file.name,
            sizeBytes: file.size,
            format,
            purpose,
            mimeType: file.type || "application/octet-stream",
            ...(declaredSha256 ? { sha256: declaredSha256 } : {}),
            ...(targetVersionId ? { targetVersionId } : {}),
            ...(posterCamera ? { posterCamera } : {}),
            ...(options.captureJourney ? { captureJourney: options.captureJourney } : {}),
          }),
          signal: uploadAbortController.signal,
        },
      );
      activeUpload = {
        id: initiated.upload.id,
        projectId,
        fileName: file.name,
        fileSize: file.size,
        format,
        purpose,
        partSizeBytes: initiated.upload.partSizeBytes,
        sha256: declaredSha256,
        parts: new Map(),
      };
      pendingUploadOperation = null;
    }
    const upload = activeUpload;
    if (!upload) throw new Error("The upload session could not be created.");
    // Resumed sessions declared their SHA-256 when they were created; re-stream
    // the selected file sequentially while parts upload so the fingerprint can
    // be verified before the immutable completion call. Read failures resolve
    // to null and keep the resumed upload functional.
    const resumeIntegrityCheck = canResume && upload.sha256
      ? sha256HexOfBlob(file, { signal: uploadAbortController.signal }).catch(() => null)
      : null;
    const totalParts = Math.ceil(file.size / upload.partSizeBytes);
    for (let index = 0; index < totalParts; index += 1) {
      const partNumber = index + 1;
      if (upload.parts.has(partNumber)) {
        progress.style.width = `${Math.round(partNumber / totalParts * 92)}%`;
        continue;
      }
      const start = index * upload.partSizeBytes;
      const chunk = file.slice(start, Math.min(file.size, start + upload.partSizeBytes));
      status.textContent = `Uploading part ${partNumber} of ${totalParts}…`;
      const response = await api<{ part: { partNumber: number; etag: string } }>(
        `/api/uploads/${upload.id}/parts/${partNumber}`,
        {
          method: "PUT",
          body: chunk,
          headers: { "Content-Type": "application/octet-stream" },
          retries: 3,
          timeoutMs: 120_000,
          signal: uploadAbortController.signal,
        },
      );
      upload.parts.set(response.part.partNumber, response.part.etag);
      progress.style.width = `${Math.round(partNumber / totalParts * 92)}%`;
    }
    if (resumeIntegrityCheck) {
      status.textContent = "Verifying the resumed file against its declared SHA-256 fingerprint…";
      const resumedSha256 = await resumeIntegrityCheck;
      if (uploadAbortController.signal.aborted) {
        throw new Error("Upload paused before the resumed file could be verified.");
      }
      if (resumedSha256 && resumedSha256 !== upload.sha256) {
        throw new Error(
          `The selected file no longer matches the SHA-256 fingerprint declared for ${upload.fileName}. Choose the exact original capture file to resume this session.`,
        );
      }
    }
    status.textContent = "Finalising immutable source…";
    const parts = Array.from(upload.parts, ([partNumber, etag]) => ({ partNumber, etag }))
      .sort((left, right) => left.partNumber - right.partNumber);
    const completed = await api<CompletedCaptureUpload>(`/api/uploads/${upload.id}/complete`, {
      method: "POST",
      body: JSON.stringify({ parts }),
      retries: 2,
      timeoutMs: 60_000,
      signal: uploadAbortController.signal,
    });
    progress.style.width = "100%";
    status.textContent = "Upload completed and validation job queued.";
    activeUpload = null;
    pendingUploadOperation = null;
    state.recoverableUploads = state.recoverableUploads.filter((item) => item.id !== upload.id);
    showToast(presentation.successToast ?? "Source asset ingested");
    if (presentation.closeDialog) {
      window.setTimeout(() => presentation.closeDialog?.close(), 900);
    }
    await refreshAll();
    return completed;
  } catch (error) {
    status.textContent = errorMessage(error);
    const prefix = uploadAbortController.signal.aborted
      ? "Upload paused."
      : errorMessage(error);
    presentation.error.textContent = `${prefix} Uploaded parts are retained in D1 and R2; reopen this project and choose Resume upload to continue from the first incomplete part.`;
    throw error;
  } finally {
    uploadAbortController = null;
    if (pauseButton) {
      pauseButton.hidden = true;
      pauseButton.disabled = false;
      pauseButton.textContent = "Pause upload";
    }
  }
}

async function retryJob(job: Job): Promise<void> {
  await api(`/api/jobs/${job.id}/retry`, {
    method: "POST",
  });
  showToast("Processing retry queued");
  await refreshAll();
}

async function cancelJob(job: Job): Promise<void> {
  await api(`/api/jobs/${job.id}/cancel`, {
    method: "POST",
  });
  showToast("Processing job cancelled");
  await refreshAll();
}

async function openQaDialog(): Promise<void> {
  if (!state.selected) return;
  await loadSpatialWorkspace(state.selected.project.id);
  const select = byId<HTMLSelectElement>("qaAssetSelect");
  select.replaceChildren();
  // The Spark RAD derivative is the paged format every published viewer
  // streams directly, so it leads the list and becomes the default choice.
  // Creation order once put a raw NGSP SPZ first, and approving that default
  // failed the server's loadability guard every time.
  const webFormatRank: Record<string, number> = { rad: 0, sog: 1, spz: 2 };
  const webCandidates = state.selected.assets
    .filter((candidate) =>
      candidate.format === "rad" ||
      candidate.format === "spz" ||
      candidate.format === "sog"
    )
    .sort((left, right) =>
      (webFormatRank[left.format] ?? 3) - (webFormatRank[right.format] ?? 3)
    );
  for (const asset of webCandidates) {
    const option = document.createElement("option");
    option.value = asset.id;
    option.textContent = `${asset.file_name} · ${asset.format.toUpperCase()} · ${formatBytes(asset.size_bytes)}`;
    select.append(option);
  }
  if (!select.options.length) {
    showNotice("No Spark RAD, SPZ, or SOG derivative is available for approval.", "error");
    return;
  }
  const readiness = privacyQaReadiness(state.spatial);
  const evidence = byId("qaPrivacyEvidence");
  evidence.className = `notice-card${readiness.ready ? " success" : " warning"}`;
  evidence.replaceChildren(
    element("strong", "", readiness.ready ? "Privacy evidence is ready" : "Privacy evidence is incomplete"),
    element("p", "", readiness.message),
  );
  const privacyApproved = byId<HTMLFormElement>("qaForm").elements.namedItem("privacyApproved");
  const submit = byId<HTMLFormElement>("qaForm").querySelector<HTMLButtonElement>("[type='submit']")!;
  if (privacyApproved instanceof HTMLInputElement) {
    privacyApproved.checked = false;
    privacyApproved.disabled = !readiness.ready;
  }
  submit.disabled = !readiness.ready;
  byId("qaError").textContent = "";
  qaDialog.showModal();
}

function privacyQaReadiness(spatial: SpatialWorkspace | null): { ready: boolean; message: string } {
  if (!spatial?.version) {
    return { ready: false, message: "No immutable version is open for privacy review." };
  }
  const scan = spatial.privacyScans[0];
  if (!scan) {
    return { ready: false, message: "Run an automated privacy scan from Spatial authoring before approving publication." };
  }
  if (scan.status !== "COMPLETED") {
    return {
      ready: false,
      message: `The latest privacy scan is ${humanStatus(scan.status).toLowerCase()}. Complete or retry it before QA.`,
    };
  }
  const candidateBlockers = spatial.privacyCandidates.filter((candidate) =>
    candidate.scan_id === scan.id &&
    (candidate.status === "pending" || candidate.status === "confirmed")
  ).length;
  const regionBlockers = spatial.privacyRegions.filter((region) =>
    region.status === "pending" || region.status === "approved"
  ).length;
  if (candidateBlockers || regionBlockers) {
    return {
      ready: false,
      message: `${candidateBlockers} automated candidate${candidateBlockers === 1 ? "" : "s"} and ${regionBlockers} authored region${regionBlockers === 1 ? "" : "s"} still require resolution.`,
    };
  }
  return {
    ready: true,
    message: `${scan.input_count} private evidence frame${scan.input_count === 1 ? "" : "s"} checked; every candidate and authored region has a recorded human outcome.`,
  };
}

async function approveVersion(form: FormData): Promise<void> {
  const version = state.selected?.versions[0];
  if (!version) return;
  const verifiedPoster = state.selected?.assets.find((asset) =>
    asset.version_id === version.id &&
    asset.kind === "poster" &&
    asset.integrity_status === "verified"
  );
  try {
    await api(`/api/versions/${version.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        webAssetId: String(form.get("webAssetId") ?? ""),
        posterAssetId: verifiedPoster?.id ?? null,
        visualGrade: String(form.get("visualGrade") ?? "B"),
        measurementGrade: String(form.get("measurementGrade") ?? "visual-only"),
        privacyStatus: "approved",
        notes: optionalString(form.get("notes")),
      }),
    });
    qaDialog.close();
    showToast("Version approved");
    await refreshAll();
    // Publication is the natural next act after QA, so the release dialog
    // opens itself with the reviewed transform evidence pre-selected instead
    // of making the operator hunt for the publish button. Publishing stays
    // its own explicit submit: it binds source-to-world evidence, rotation,
    // and audience, and rollback operates on releases — its receipt cannot
    // be folded into the QA approval's.
    await openReleaseDialog();
  } catch (error) {
    byId("qaError").textContent = errorMessage(error);
  }
}

async function openReleaseDialog(): Promise<void> {
  if (!state.selected) return;
  const projectId = state.selected.project.id;
  const versionId = auxiliaryCollisionTargetVersion()?.id ?? null;
  if (!versionId) {
    showNotice("Approve a visual scene version before publishing a release.", "error");
    return;
  }
  if (
    state.spatialProjectId !== projectId ||
    state.spatial?.version?.id !== versionId
  ) {
    await loadSpatialWorkspace(projectId, versionId);
  }
  if (
    state.selected?.project.id !== projectId ||
    state.spatial?.version?.id !== versionId
  ) return;
  const form = byId<HTMLFormElement>("releaseForm");
  form.reset();
  const version = state.selected.versions.find((candidate) => candidate.id === versionId);
  const versionPolicy = effectiveVersionWorkflowPolicy(state.selected.project, version);
  const accessPolicy = form.elements.namedItem("accessPolicy");
  if (accessPolicy instanceof HTMLSelectElement) {
    accessPolicy.value = versionPolicy.publication === "private-review"
      ? "token"
      : "public";
  }
  const qualityPreset = form.elements.namedItem("qualityPreset");
  if (qualityPreset instanceof HTMLSelectElement) {
    qualityPreset.value = versionPolicy.quality;
  }
  const movementMode = form.elements.namedItem("defaultMovementMode");
  if (movementMode instanceof HTMLSelectElement) {
    movementMode.value = versionPolicy.navigation === "review-walk-and-fly"
      ? "fly"
      : "walk";
  }
  syncReleaseQualityPreset(form);
  byId<HTMLDetailsElement>("releaseExpertSettings").open = false;
  const slug = form.elements.namedItem("slug");
  const title = form.elements.namedItem("title");
  if (slug instanceof HTMLInputElement) slug.value = state.selected.project.activeReleaseSlug ?? state.selected.project.slug;
  if (title instanceof HTMLInputElement) title.value = state.selected.project.name;
  const hasAuthoredSpatialGeometry = hasAuthoredSpatialRuntime(state.spatial);
  form.dataset.hasAuthoredSpatialRuntime = String(hasAuthoredSpatialGeometry);
  byId("sceneRotationNote").textContent = hasAuthoredSpatialGeometry
    ? "Scene rotation is unavailable because this version has authored spatial geometry. Rotate the complete spatial frame before publication instead."
    : "Visual orientation only. This renderer transform does not establish metric scale or replace reviewed source-to-world evidence.";
  const reviewedTransforms = reviewedSemanticSourceToWorld();
  const latestTransform = reviewedTransforms[0] ?? null;
  const evidenceSelect = form.elements.namedItem("sourceToWorldEvidenceId");
  if (evidenceSelect instanceof HTMLSelectElement) {
    evidenceSelect.replaceChildren(new Option(
      reviewedTransforms.length
        ? "Select reviewed transform evidence"
        : "No accepted extraction available",
      "",
    ));
    for (const evidence of reviewedTransforms) {
      evidenceSelect.append(new Option(
        `Accepted extraction · ${evidence.sourceUpAxis}-up · ${evidence.metresPerSourceUnit} ${
          worldUnitSymbol(evidence.worldUnit)
        }/source unit`,
        evidence.extractionId,
      ));
    }
    if (latestTransform) evidenceSelect.value = latestTransform.extractionId;
  }
  const applyTransform = form.elements.namedItem("applySourceToWorld");
  if (applyTransform instanceof HTMLInputElement) applyTransform.checked = Boolean(latestTransform);
  if (latestTransform) {
    applyReviewedTransformToReleaseForm(latestTransform.extractionId);
  } else {
    setProvisionalReleaseDisclaimer(form, false);
  }
  syncReleaseTransformModes(form);
  releaseOperationId = crypto.randomUUID();
  latestReleaseCameraPose = null;
  latestReleaseViewQuality = null;
  releaseViewCaptureRequestId = null;
  byId<HTMLButtonElement>("releaseUseCurrentView").disabled = true;
  byId("releaseCameraStatus").textContent = "Preparing the approved scene…";
  byId("releaseError").textContent = "";
  releaseDialog.showModal();
  void prepareReleaseCameraPreview(versionId);
}

async function prepareReleaseCameraPreview(versionId: string): Promise<void> {
  const frame = byId<HTMLIFrameElement>("releaseCameraPreview");
  frame.onload = null;
  frame.dataset.previewReady = "false";
  frame.src = "about:blank";
  try {
    const renderable = await createVersionPreview(versionId);
    if (!releaseDialog.open || state.spatial?.version?.id !== versionId) return;
    frame.onload = () => {
      frame.dataset.previewReady = "true";
      sendVersionSpatialRuntime(frame, renderable);
    };
    frame.src = rendererAssetUrl(renderable).toString();
  } catch (error) {
    if (!releaseDialog.open) return;
    byId("releaseCameraStatus").textContent =
      `Starting-view preview unavailable: ${errorMessage(error)} Publication settings remain editable.`;
  }
}

function handleReleaseCameraRendererMessage(event: MessageEvent<unknown>): void {
  const frame = byId<HTMLIFrameElement>("releaseCameraPreview");
  if (
    !releaseDialog.open ||
    frame.dataset.previewReady !== "true" ||
    event.origin !== location.origin ||
    event.source !== frame.contentWindow ||
    !event.data ||
    typeof event.data !== "object" ||
    Reflect.get(event.data, "source") !== "spatial-spark"
  ) return;
  const type = Reflect.get(event.data, "type");
  if (type === "camera-update") {
    const pose = Reflect.get(event.data, "cameraPose");
    if (!validReleaseCameraPose(pose)) return;
    latestReleaseCameraPose = pose;
    byId<HTMLButtonElement>("releaseUseCurrentView").disabled = false;
    byId("releaseCameraStatus").textContent =
      "Move to the view visitors should see first, then capture it.";
    return;
  }
  if (type === "camera") {
    // Reply to the "Use current view" capture request: the renderer measured
    // the exact frame at this pose, so the pose and its quality receipt stay
    // bound together.
    const requestId = Reflect.get(event.data, "requestId");
    if (typeof requestId !== "string" || requestId !== releaseViewCaptureRequestId) return;
    releaseViewCaptureRequestId = null;
    const pose = Reflect.get(event.data, "cameraPose");
    if (!validReleaseCameraPose(pose)) return;
    latestReleaseCameraPose = pose;
    const metrics = parseStartingViewQualityMetrics(
      Reflect.get(event.data, "frameQuality"),
    );
    latestReleaseViewQuality = metrics ? { metrics, pose } : null;
    applyCapturedReleaseView(pose, metrics);
    return;
  }
  if (type === "ready") {
    byId("releaseCameraStatus").textContent =
      "Move in the approved scene to choose the visitor starting view.";
    return;
  }
  if (type === "error") {
    byId("releaseCameraStatus").textContent =
      `Starting-view preview unavailable: ${String(Reflect.get(event.data, "message") ?? "renderer error")}.`;
  }
}

function validReleaseCameraPose(value: unknown): value is ReleaseCameraPose {
  if (!value || typeof value !== "object") return false;
  return (
    validReleaseCameraTuple(Reflect.get(value, "position")) &&
    validReleaseCameraTuple(Reflect.get(value, "target")) &&
    validReleaseCameraTuple(Reflect.get(value, "up")) &&
    Number.isFinite(Number(Reflect.get(value, "fovDegrees")))
  );
}

function validReleaseCameraTuple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => Number.isFinite(item));
}

function applyReleaseCurrentView(): void {
  if (!latestReleaseCameraPose) return;
  const frame = byId<HTMLIFrameElement>("releaseCameraPreview");
  if (frame.dataset.previewReady === "true" && frame.contentWindow) {
    // Ask the live renderer for the pose AND the first-frame quality of the
    // exact frame being frozen; the reply lands in
    // handleReleaseCameraRendererMessage and fills the form there.
    releaseViewCaptureRequestId = crypto.randomUUID();
    frame.contentWindow.postMessage({
      source: "spatial-host",
      type: "capture-camera",
      requestId: releaseViewCaptureRequestId,
    }, location.origin);
    return;
  }
  // The preview renderer is gone (failed load mid-session): capture still
  // works from the last broadcast pose, only without a quality receipt.
  latestReleaseViewQuality = null;
  applyCapturedReleaseView(latestReleaseCameraPose, null);
}

function applyCapturedReleaseView(
  pose: ReleaseCameraPose,
  metrics: StartingViewQualityMetrics | null,
): void {
  const form = byId<HTMLFormElement>("releaseForm");
  setFormValue(form, "initialCameraPosition", pose.position.join(", "));
  setFormValue(form, "initialCameraTarget", pose.target.join(", "));
  setFormValue(form, "initialCameraUp", pose.up.join(", "));
  setFormValue(form, "initialCameraFov", String(pose.fovDegrees));
  const violations = metrics ? startingViewQualityViolations(metrics) : [];
  const warnings = metrics ? startingViewQualityWarnings(metrics) : [];
  // A hard violation is surfaced immediately in the same error element the
  // publish rejection would use, so the operator can fix the view before
  // submitting; the worker remains the enforcement authority.
  byId("releaseError").textContent = violations[0] ?? "";
  byId("releaseCameraStatus").textContent = violations.length
    ? `${violations[0]}.`
    : warnings.length
      ? `${warnings[0]} Move again and choose Use current view to replace it.`
      : "Starting view captured. Move again and choose Use current view to replace it.";
  showToast(
    violations.length
      ? "Starting view captured, but it will be blocked at publish"
      : "Publication starting view captured",
  );
}

function releaseSceneRotationInputs(form: HTMLFormElement): [
  HTMLInputElement,
  HTMLInputElement,
  HTMLInputElement,
] {
  const inputs = ["sceneRotationX", "sceneRotationY", "sceneRotationZ"].map(
    (name) => form.elements.namedItem(name),
  );
  if (inputs.some((input) => !(input instanceof HTMLInputElement))) {
    throw new Error("Release scene rotation controls are unavailable.");
  }
  return inputs as [HTMLInputElement, HTMLInputElement, HTMLInputElement];
}

function syncReleaseTransformModes(form: HTMLFormElement): void {
  const rotationInputs = releaseSceneRotationInputs(form);
  const applyTransform = form.elements.namedItem("applySourceToWorld");
  const evidence = form.elements.namedItem("sourceToWorldEvidenceId");
  if (!(applyTransform instanceof HTMLInputElement) || !(evidence instanceof HTMLSelectElement)) {
    return;
  }
  const hasAuthoredSpatialRuntime = form.dataset.hasAuthoredSpatialRuntime === "true";
  const hasRotation = hasEnteredSceneRotation(form);
  for (const input of rotationInputs) {
    input.disabled = hasAuthoredSpatialRuntime || applyTransform.checked;
  }
  applyTransform.disabled = hasRotation;
  evidence.disabled = hasRotation;
  const acceptedTransform = applyTransform.checked && Boolean(evidence.value);
  for (const name of [
    "releaseMetresPerSourceUnit",
    "releaseYawDegrees",
    "releaseTranslationX",
    "releaseTranslationY",
    "releaseTranslationZ",
  ]) {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement) input.readOnly = acceptedTransform;
  }
  for (const name of ["releaseWorldUnit", "releaseSourceUpAxis"]) {
    const select = form.elements.namedItem(name);
    if (!(select instanceof HTMLSelectElement)) continue;
    select.setAttribute("aria-readonly", String(acceptedTransform));
    select.tabIndex = acceptedTransform ? -1 : 0;
    select.style.pointerEvents = acceptedTransform ? "none" : "";
  }
}

function syncReleaseQualityPreset(form: HTMLFormElement): void {
  const preset = form.elements.namedItem("qualityPreset");
  const budget = form.elements.namedItem("splatBudgetMillions");
  if (!(preset instanceof HTMLSelectElement) || !(budget instanceof HTMLInputElement)) return;
  const policy = state.spatial?.deliveryPolicy ?? {};
  const budgetByPreset = {
    "data-saver": Reflect.get(policy, "mobile_lite_budget"),
    standard: Reflect.get(policy, "desktop_standard_budget"),
    "high-detail": Reflect.get(policy, "desktop_high_budget"),
  };
  const selected = Number(budgetByPreset[preset.value as keyof typeof budgetByPreset]);
  if (Number.isFinite(selected) && selected > 0) budget.value = String(selected);
}

function hasEnteredSceneRotation(form: HTMLFormElement): boolean {
  return releaseSceneRotationInputs(form).some((input) => {
    const value = Number(input.value);
    return Number.isFinite(value) && value !== 0;
  });
}

async function publishRelease(form: FormData): Promise<void> {
  if (!state.selected) return;
  releaseOperationId ??= crypto.randomUUID();
  const expiresAtValue = optionalString(form.get("expiresAt"));
  try {
    const initialCamera = parseReleaseInitialCamera(form);
    const startingViewQuality = releaseStartingViewQualityReceipt(initialCamera);
    const sceneRotationDegrees = parseSceneRotationDegrees([
      form.get("sceneRotationX"),
      form.get("sceneRotationY"),
      form.get("sceneRotationZ"),
    ]);
    const sourceToWorld = parseReleaseSourceToWorld(form);
    if (sceneRotationDegrees && sourceToWorld) {
      throw new Error(
        "Use either visual scene rotation or reviewed source-to-world evidence, not both.",
      );
    }
    const sourceToWorldEvidenceId = sourceToWorld
      ? String(form.get("sourceToWorldEvidenceId") ?? "")
      : null;
    if (sourceToWorld && !sourceToWorldEvidenceId) {
      throw new Error(
        "Choose an accepted semantic extraction that proves the release transform.",
      );
    }
    const navigationWorldUnit = state.spatial?.navigationProfile.worldUnit ?? "metres";
    if (sourceToWorld && sourceToWorld.worldUnit !== navigationWorldUnit) {
      throw new Error(
        `Tune the navigation agent to ${
          sourceToWorld.worldUnit === "scene_units"
            ? "Provisional scene units (SU)"
            : "Metric metres"
        } before publishing this transform.`,
      );
    }
    const accessPolicy = String(form.get("accessPolicy") ?? "token");
    // Open exposure is a deliberate act, never a dialog default: anyone with
    // the link (public and unlisted alike) walks the scene with no credential.
    if (accessPolicy === "public" || accessPolicy === "unlisted") {
      const confirmed = await confirmPublicationDecision({
        title: accessPolicy === "public" ? "Publish publicly?" : "Publish unlisted?",
        message: "Anyone with the link will enter this scene with no credential. " +
          "Choose Access token instead to gate it behind a shareable secret link.",
        confirmLabel: accessPolicy === "public" ? "Make it public" : "Publish unlisted",
      });
      if (!confirmed) return;
    }
    const result = await api<{ release: { url: string; accessPolicy: string; accessToken: string | null } }>(
      `/api/projects/${state.selected.project.id}/releases`,
      {
        method: "POST",
        body: JSON.stringify({
          clientOperationId: releaseOperationId,
          slug: String(form.get("slug") ?? ""),
          accessPolicy,
          expiresAt: expiresAtValue ? new Date(expiresAtValue).toISOString() : null,
          ...(sourceToWorldEvidenceId ? { sourceToWorldEvidenceId } : {}),
          ...(startingViewQuality ? { startingViewQuality } : {}),
          viewerConfig: {
            title: String(form.get("title") ?? state.selected.project.name),
            subtitle: optionalString(form.get("subtitle")),
            captureDate: optionalString(form.get("captureDate")),
            measurementDisclaimer: String(form.get("measurementDisclaimer") ?? ""),
            splatBudgetMillions: Number(form.get("splatBudgetMillions") ?? 2),
            defaultMovementMode: form.get("defaultMovementMode") === "fly" ? "fly" : "walk",
            ...(sceneRotationDegrees ? { sceneRotationDegrees } : {}),
            ...(sourceToWorld ? { sourceToWorld } : {}),
            ...(initialCamera ? { initialCamera } : {}),
          },
        }),
      },
    );
    releaseDialog.close();
    releaseOperationId = null;
    const access = result.release.accessToken ? `${result.release.url}?access_token=${encodeURIComponent(result.release.accessToken)}` : result.release.url;
    showNotice(`Published: ${access}`, "success");
    await navigator.clipboard.writeText(access).catch(() => undefined);
    showToast("Release published; link copied");
    await refreshAll();
  } catch (error) {
    byId("releaseError").textContent = errorMessage(error);
  }
}

function reviewedSemanticSourceToWorld(): Array<{
  extractionId: string;
  sourceUpAxis: "Y" | "Z";
  worldUnit: WorldUnit;
  metresPerSourceUnit: number;
  yawDegrees: number;
  translationMetres: [number, number, number];
}> {
  const reviewed: Array<{
    extractionId: string;
    sourceUpAxis: "Y" | "Z";
    worldUnit: WorldUnit;
    metresPerSourceUnit: number;
    yawDegrees: number;
    translationMetres: [number, number, number];
  }> = [];
  for (const extraction of state.spatial?.semanticExtractions ?? []) {
    if (
      extraction.status !== "REVIEWED" ||
      extraction.review_decision !== "accept_selected"
    ) continue;
    try {
      const parameters = JSON.parse(extraction.parameters_json) as Record<string, unknown>;
      const transform = parameters.sourceToWorld;
      if (!transform || typeof transform !== "object") continue;
      const sourceUpAxis = Reflect.get(transform, "sourceUpAxis");
      const worldUnit = parseWorldUnit(Reflect.get(transform, "worldUnit"));
      const metresPerSourceUnit = Number(Reflect.get(transform, "metresPerSourceUnit"));
      const yawDegrees = Number(Reflect.get(transform, "yawDegrees"));
      const translationMetres = Reflect.get(transform, "translationMetres");
      if (
        (sourceUpAxis === "Y" || sourceUpAxis === "Z") &&
        Number.isFinite(metresPerSourceUnit) &&
        Number.isFinite(yawDegrees) &&
        validNumberTuple(translationMetres)
      ) {
        reviewed.push({
          extractionId: extraction.id,
          sourceUpAxis,
          worldUnit,
          metresPerSourceUnit,
          yawDegrees,
          translationMetres,
        });
      }
    } catch {
      // Ignore legacy or malformed extraction evidence.
    }
  }
  return reviewed;
}

function applyReviewedTransformToReleaseForm(extractionId: string): void {
  if (!extractionId) return;
  const transform = reviewedSemanticSourceToWorld().find(
    (candidate) => candidate.extractionId === extractionId,
  );
  if (!transform) return;
  const form = byId<HTMLFormElement>("releaseForm");
  setFormValue(form, "releaseWorldUnit", transform.worldUnit);
  setFormValue(form, "releaseSourceUpAxis", transform.sourceUpAxis);
  setFormValue(form, "releaseMetresPerSourceUnit", String(transform.metresPerSourceUnit));
  setFormValue(form, "releaseYawDegrees", String(transform.yawDegrees));
  setFormValue(form, "releaseTranslationX", String(transform.translationMetres[0]));
  setFormValue(form, "releaseTranslationY", String(transform.translationMetres[1]));
  setFormValue(form, "releaseTranslationZ", String(transform.translationMetres[2]));
  setProvisionalReleaseDisclaimer(
    form,
    transform.worldUnit === "scene_units",
  );
}

function setProvisionalReleaseDisclaimer(
  form: HTMLFormElement,
  provisional: boolean,
): void {
  const disclaimer = form.elements.namedItem("measurementDisclaimer");
  if (!(disclaimer instanceof HTMLTextAreaElement)) return;
  disclaimer.readOnly = true;
  disclaimer.title = "The platform generates this warning from the approved version's measurement reliance grade and accepted coordinate evidence.";
  const approvedVersion = auxiliaryCollisionTargetVersion();
  let manifest: unknown = null;
  try {
    manifest = approvedVersion?.manifest_json
      ? JSON.parse(approvedVersion.manifest_json)
      : null;
  } catch {
    manifest = null;
  }
  const grade = parseMeasurementGrade(
    manifest && typeof manifest === "object" ? Reflect.get(manifest, "measurementGrade") : null,
  );
  disclaimer.value = grade
    ? publicationMeasurementDisclaimer(grade, provisional)
    : provisional
      ? PROVISIONAL_MEASUREMENT_DISCLAIMER
      : publicationMeasurementDisclaimer("visual-only");
}

function parseReleaseSourceToWorld(form: FormData): {
  sourceUpAxis: "Y" | "Z";
  worldUnit: WorldUnit;
  metresPerSourceUnit: number;
  yawDegrees: number;
  translationMetres: [number, number, number];
} | null {
  if (form.get("applySourceToWorld") !== "on") return null;
  const sourceUpAxis = String(form.get("releaseSourceUpAxis") ?? "Y");
  const worldUnit = String(form.get("releaseWorldUnit") ?? "scene_units");
  const metresPerSourceUnit = Number(form.get("releaseMetresPerSourceUnit") ?? 1);
  const yawDegrees = Number(form.get("releaseYawDegrees") ?? 0);
  const translationMetres: [number, number, number] = [
    Number(form.get("releaseTranslationX") ?? 0),
    Number(form.get("releaseTranslationY") ?? 0),
    Number(form.get("releaseTranslationZ") ?? 0),
  ];
  if (
    (sourceUpAxis !== "Y" && sourceUpAxis !== "Z") ||
    (worldUnit !== "metres" && worldUnit !== "scene_units") ||
    !Number.isFinite(metresPerSourceUnit) ||
    metresPerSourceUnit <= 0 ||
    !Number.isFinite(yawDegrees) ||
    translationMetres.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("The source-to-world transform must use a valid axis, scale, yaw, and translation.");
  }
  return {
    sourceUpAxis,
    worldUnit,
    metresPerSourceUnit,
    yawDegrees,
    translationMetres,
  };
}

// The receipt travels with the publish request only while it still measures
// the pose actually being published: expert edits to the camera fields after a
// capture orphan the receipt, and the release simply carries no receipt (the
// worker gates only receipted starting views). The worker re-checks the same
// binding server-side.
function releaseStartingViewQualityReceipt(
  initialCamera: {
    position: [number, number, number];
    target: [number, number, number];
    up: [number, number, number];
    fovDegrees: number;
  } | null,
): (StartingViewQualityMetrics & { cameraPose: ReleaseCameraPose }) | null {
  if (!initialCamera || !latestReleaseViewQuality) return null;
  const { metrics, pose } = latestReleaseViewQuality;
  const matches = (["position", "target", "up"] as const).every((key) =>
    pose[key].every((coordinate, axis) =>
      Math.abs(coordinate - initialCamera[key][axis]!) <= 1e-6
    )
  ) && Math.abs(pose.fovDegrees - initialCamera.fovDegrees) <= 1e-6;
  return matches ? { ...metrics, cameraPose: pose } : null;
}

function parseReleaseInitialCamera(form: FormData): {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovDegrees: number;
} | null {
  const rawPosition = String(form.get("initialCameraPosition") ?? "");
  const rawTarget = String(form.get("initialCameraTarget") ?? "");
  if (!rawPosition.trim() && !rawTarget.trim()) return null;
  const position = parsePosition(rawPosition);
  const target = parsePosition(rawTarget);
  if (!position || !target) {
    throw new Error("Starting camera position and target are both required.");
  }
  if ([...position, ...target].some((coordinate) => Math.abs(coordinate) > 1_000_000)) {
    throw new Error("Starting camera coordinates must be between -1,000,000 and 1,000,000.");
  }
  const view: [number, number, number] = [
    target[0] - position[0],
    target[1] - position[1],
    target[2] - position[2],
  ];
  if (
    Math.hypot(...view) < 1e-9
  ) {
    throw new Error("Starting camera position and target must differ.");
  }
  const up = parsePosition(String(form.get("initialCameraUp") ?? "")) ?? [0, 1, 0];
  if (up.some((coordinate) => Math.abs(coordinate) > 1_000_000)) {
    throw new Error("Camera up coordinates must be between -1,000,000 and 1,000,000.");
  }
  if (Math.hypot(...up) < 1e-9) throw new Error("Camera up must be a non-zero vector.");
  const crossLength = Math.hypot(
    view[1] * up[2] - view[2] * up[1],
    view[2] * up[0] - view[0] * up[2],
    view[0] * up[1] - view[1] * up[0],
  );
  if (crossLength / (Math.hypot(...view) * Math.hypot(...up)) < 1e-8) {
    throw new Error("Camera up must not be parallel to its viewing direction.");
  }
  const fovDegrees = Number(form.get("initialCameraFov") ?? 58);
  if (!Number.isFinite(fovDegrees) || fovDegrees < 20 || fovDegrees > 100) {
    throw new Error("Field of view must be between 20 and 100 degrees.");
  }
  return { position, target, up, fovDegrees };
}

async function revokeRelease(slug: string): Promise<void> {
  try {
    await api(`/api/release-channels/${encodeURIComponent(slug)}`, { method: "DELETE" });
    showToast("Release revoked");
    await refreshAll();
  } catch (error) {
    showNotice(errorMessage(error), "error");
  }
}

async function rollbackRelease(release: Release): Promise<void> {
  try {
    await api(`/api/release-channels/${encodeURIComponent(release.slug)}/rollback`, {
      method: "POST",
      body: JSON.stringify({ releaseId: release.id }),
    });
    showToast("Historical release is active");
    await refreshAll();
  } catch (error) {
    showNotice(errorMessage(error), "error");
  }
}

function openReviewerDialog(projectId?: string): void {
  const selectedId = projectId ?? state.selected?.project.id;
  if (!selectedId) return;
  const project = state.projects.find((candidate) => candidate.id === selectedId);
  if (project && state.selected?.project.id !== selectedId) {
    state.selected = {
      project,
      versions: [],
      assets: [],
      jobs: [],
      releases: [],
      captureBundles: [],
      comparisonReadiness: emptyComparisonReadiness,
      previewReadyVersionIds: [],
    };
  }
  reviewerOperationId = crypto.randomUUID();
  byId<HTMLFormElement>("reviewerForm").reset();
  byId("reviewerError").textContent = "";
  reviewerDialog.showModal();
}

async function inviteReviewer(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before inviting a reviewer.");
  reviewerOperationId ??= crypto.randomUUID();
  const result = await api<{
    invitation: { email: string; deliveryStatus: "sent" | "failed"; expiresAt: string };
  }>(`/api/projects/${project.id}/reviewers`, {
    method: "POST",
    body: JSON.stringify({
      clientOperationId: reviewerOperationId,
      email: String(form.get("email") ?? ""),
      role: String(form.get("role") ?? "customer_reviewer"),
      expiresInDays: Number(form.get("expiresInDays") ?? 7),
    }),
  });
  reviewerDialog.close();
  reviewerOperationId = null;
  showToast(result.invitation.deliveryStatus === "sent" ? "Secure review invitation sent" : "Access created; email delivery needs attention");
  if (result.invitation.deliveryStatus === "failed") {
    showNotice(`Reviewer access was created for ${result.invitation.email}, but the invitation email failed. Retry delivery from the operational alert.`, "error");
  }
  const reviewProject = state.reviewProjects.find((candidate) => candidate.id === project.id);
  if (reviewProject) await loadReviewDetail(reviewProject);
}

async function openDeliveryDialog(): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  byId("deliveryError").textContent = "";
  const form = byId<HTMLFormElement>("deliveryForm");
  const setValue = (name: string, value: string) => {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = value;
  };
  try {
    const result = await api<{ theme: {
      brand_name: string | null;
      logo_url: string | null;
      accent_color: string;
      surface_color: string;
    } }>(`/api/projects/${project.id}/theme`);
    setValue("brandName", result.theme.brand_name ?? "");
    setValue("logoUrl", result.theme.logo_url ?? "");
    setValue("accentColor", result.theme.accent_color);
    setValue("surfaceColor", result.theme.surface_color);
    const subscription = state.hosting?.subscriptions.find((candidate) => candidate.project_id === project.id);
    if (subscription) {
      setValue("planCode", subscription.plan_code);
    }
    updateDeliveryBillingState();
    deliveryDialog.showModal();
  } catch (error) {
    showNotice(errorMessage(error), "error");
  }
}

async function saveDeliverySettings(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before configuring delivery.");
  const theme = {
    brandName: optionalString(form.get("brandName")) ?? null,
    logoUrl: optionalString(form.get("logoUrl")) ?? null,
    accentColor: String(form.get("accentColor") ?? "#d6ff4b"),
    surfaceColor: String(form.get("surfaceColor") ?? "#0d0f0e"),
  };
  const retention = {
    rawRetentionDays: Number(form.get("rawRetentionDays") ?? 365),
    derivativeRetentionDays: Number(form.get("derivativeRetentionDays") ?? 730),
    releaseRetentionDays: Number(form.get("releaseRetentionDays") ?? 1095),
    legalHold: form.get("legalHold") === "on",
  };
  const [themeResult, retentionResult] = await Promise.allSettled([
    api(`/api/projects/${project.id}/theme`, { method: "PUT", body: JSON.stringify(theme) }),
    api(`/api/projects/${project.id}/retention`, { method: "PUT", body: JSON.stringify(retention) }),
  ]);
  const failed = [themeResult, retentionResult].filter((result) => result.status === "rejected");
  if (failed.length) {
    throw new Error(`${failed.length} delivery setting ${failed.length === 1 ? "update" : "updates"} failed. Safe updates were retained; retry to reconcile all settings.`);
  }
  deliveryDialog.close();
  showToast("Delivery settings saved");
  await refreshAll();
}

function updateDeliveryBillingState(): void {
  const button = byId<HTMLButtonElement>("startHostingCheckout");
  const status = byId("deliveryBillingStatus");
  const projectId = state.selected?.project.id;
  const subscription = state.hosting?.subscriptions.find((item) =>
    item.project_id === projectId
  );
  status.className = "notice-card";
  if (subscription?.status === "active") {
    button.disabled = true;
    button.textContent = "Hosting already active";
    status.classList.add("success");
    status.textContent = `${subscription.plan_name} hosting is active through ${parseTimestamp(subscription.current_period_end).toLocaleDateString()}. Billing is recorded through the ${humanStatus(subscription.payment_provider ?? "manual")} ledger.`;
    return;
  }
  if (!state.hosting?.manualBillingEnabled) {
    button.disabled = true;
    button.textContent = "Administrator billing";
    status.classList.add("warning");
    status.textContent = "Save the requested delivery settings, then ask a platform administrator to issue and reconcile the hosting invoice.";
    return;
  }
  button.disabled = false;
  button.textContent = "Open billing workspace";
  status.textContent = subscription?.status === "past_due"
    ? "An invoice is outstanding. Reconcile payment from the administrator billing workspace before hosting becomes active."
    : "Hosting is merchant billed. Issuing an invoice does not activate access; an administrator must verify and record payment.";
}

async function openDomainDialog(): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  const form = byId<HTMLFormElement>("domainForm");
  form.reset();
  byId("domainError").textContent = "";
  const instructions = byId("domainInstructions");
  instructions.hidden = true;
  instructions.replaceChildren();
  customDomainWorkspace = null;
  customDomainChallenges.clear();
  const inventory = byId("domainInventory");
  inventory.setAttribute("aria-busy", "true");
  inventory.replaceChildren(element("p", "muted-copy", "Loading registered hostnames…"));
  domainDialog.showModal();
  try {
    await loadCustomDomains(project.id);
  } catch (error) {
    renderDomainInventoryFailure(project.id, error);
  }
}

async function createCustomDomain(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before adding a domain.");
  const result = await api<{
    domain: {
      id: string;
      hostname: string;
      verificationName: string;
      verificationValue: string;
      verificationToken: string;
      cnameTarget: string;
      providerConfigured: boolean;
    };
  }>(`/api/projects/${project.id}/domains`, {
    method: "POST",
    body: JSON.stringify({ hostname: String(form.get("hostname") ?? "") }),
  });
  showDomainChallenge(project.id, result.domain);
  await loadCustomDomains(project.id);
}

async function loadCustomDomains(projectId: string): Promise<void> {
  const inventory = byId("domainInventory");
  inventory.setAttribute("aria-busy", "true");
  const workspace = await api<CustomDomainWorkspace>(`/api/projects/${projectId}/domains`);
  if (!domainDialog.open || state.selected?.project.id !== projectId) return;
  customDomainWorkspace = workspace;
  renderCustomDomains(projectId);
}

function renderDomainInventoryFailure(projectId: string, error: unknown): void {
  const inventory = byId("domainInventory");
  inventory.removeAttribute("aria-busy");
  const retry = element("button", "quiet-button", "Retry domain inventory");
  retry.type = "button";
  retry.addEventListener("click", () => {
    void runAction({
      key: `load-domains:${projectId}`,
      trigger: retry,
      pendingLabel: "Loading…",
      errorTarget: byId("domainError"),
    }, () => loadCustomDomains(projectId));
  });
  inventory.replaceChildren(
    element("strong", "", "Domain inventory unavailable"),
    element("p", "muted-copy", errorMessage(error)),
    retry,
  );
}

function renderCustomDomains(projectId: string): void {
  const inventory = byId("domainInventory");
  inventory.removeAttribute("aria-busy");
  inventory.replaceChildren();
  const workspace = customDomainWorkspace;
  if (!workspace) {
    renderDomainInventoryFailure(projectId, new Error("Domain inventory is unavailable."));
    return;
  }
  const routeNote = element(
    "p",
    "field-note",
    `Customer DNS must point the hostname to ${workspace.cnameTarget}. Routing is not declared active until Cloudflare reports both hostname and TLS certificate status as active.`,
  );
  inventory.append(routeNote);
  if (!workspace.domains.length) {
    inventory.append(element("p", "muted-copy", "No branded hostname registered for this project."));
    return;
  }
  for (const domain of workspace.domains) {
    const row = element("article", "domain-row");
    const heading = element("div", "domain-row-heading");
    const title = element("div");
    title.append(
      element("strong", "", domain.hostname),
      element("small", "", domainStatusDescription(domain)),
    );
    const badge = element("span", `status-badge ${domain.status === "active" ? "success" : domain.status === "failed" ? "danger" : "warning"}`, humanStatus(domain.status));
    heading.append(title, badge);
    row.append(heading);

    const evidence = element("div", "domain-evidence");
    evidence.append(
      element("span", "", `Ownership · ${domain.dnsVerifiedAt ? "verified" : "pending"}`),
      element("span", "", `Routing · ${humanStatus(domain.providerStatus ?? "not provisioned")}`),
      element("span", "", `TLS · ${humanStatus(domain.providerSslStatus ?? "not provisioned")}`),
    );
    row.append(evidence);
    const validation = domain.providerValidation?.sslValidationRecords ?? [];
    for (const record of validation) {
      if (!record.txtName || !record.txtValue) continue;
      row.append(element("code", "domain-dns-record", `${record.txtName} → ${record.txtValue}`));
    }
    if (domain.lastError) {
      row.append(element("p", "form-error", domain.lastError));
    }

    const actions = element("div", "release-actions");
    if (!domain.dnsVerifiedAt && domain.status !== "active") {
      const token = customDomainChallenges.get(domain.id);
      if (token) {
        const verify = element("button", "quiet-button", "Verify ownership");
        verify.type = "button";
        verify.addEventListener("click", () => {
          void runAction({
            key: `verify-domain:${domain.id}`,
            trigger: verify,
            pendingLabel: "Checking DNS…",
            errorTarget: byId("domainError"),
          }, () => verifyCustomDomain(projectId, domain.id, token));
        });
        actions.append(verify);
      }
      const challenge = element("button", "quiet-button", token ? "Replace TXT challenge" : "Generate TXT challenge");
      challenge.type = "button";
      challenge.addEventListener("click", () => {
        void runAction({
          key: `domain-challenge:${domain.id}`,
          trigger: challenge,
          pendingLabel: "Generating…",
          errorTarget: byId("domainError"),
        }, () => rotateDomainChallenge(projectId, domain.id));
      });
      actions.append(challenge);
    } else if (domain.status !== "active") {
      if (workspace.providerConfigured) {
        const provision = element(
          "button",
          "primary-button",
          domain.providerHostnameId ? "Refresh activation" : "Provision hostname",
        );
        provision.type = "button";
        provision.addEventListener("click", () => {
          void runAction({
            key: `provision-domain:${domain.id}`,
            trigger: provision,
            pendingLabel: domain.providerHostnameId ? "Refreshing…" : "Provisioning…",
            errorTarget: byId("domainError"),
          }, () => provisionCustomDomain(projectId, domain.id));
        });
        actions.append(provision);
      } else {
        const configuration = element(
          "span",
          "inline-status",
          "Cloudflare for SaaS setup required",
        );
        configuration.title =
          "Configure the Cloudflare for SaaS zone and API token before provisioning.";
        actions.append(configuration);
      }
    } else {
      const open = element("a", "quiet-button", "Open branded scene");
      open.href = `https://${domain.hostname}/`;
      open.target = "_blank";
      open.rel = "noopener";
      actions.append(open);
    }

    const remove = element("button", "danger-button", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => {
      if (!confirm(`Remove ${domain.hostname}? Its Cloudflare hostname and certificate will also be deleted when provisioned.`)) return;
      void runAction({
        key: `remove-domain:${domain.id}`,
        trigger: remove,
        pendingLabel: "Removing…",
        errorTarget: byId("domainError"),
      }, () => removeCustomDomain(projectId, domain.id));
    });
    actions.append(remove);
    row.append(actions);
    inventory.append(row);
  }
}

function domainStatusDescription(domain: CustomDomain): string {
  switch (domain.status) {
    case "ownership_pending":
      return "Add the Spatial Studio TXT challenge, then verify ownership.";
    case "provider_configuration_required":
      return "Ownership is verified; platform-level Cloudflare for SaaS configuration is required.";
    case "ready_to_provision":
      return "Ownership is verified and the hostname is ready for provider provisioning.";
    case "provider_pending":
      return "Cloudflare is validating routing and issuing the TLS certificate.";
    case "active":
      return `Routing and TLS active${domain.provisionedAt ? ` · ${relativeTime(domain.provisionedAt)}` : ""}.`;
    case "failed":
      return domain.dnsVerifiedAt
        ? "Provider activation failed; inspect the error and retry."
        : "Ownership verification failed; correct DNS or rotate the challenge.";
  }
}

function showDomainChallenge(
  projectId: string,
  domain: {
    id: string;
    verificationName: string;
    verificationValue: string;
    verificationToken: string;
    cnameTarget: string;
  },
): void {
  customDomainChallenges.set(domain.id, domain.verificationToken);
  const instructions = byId("domainInstructions");
  instructions.hidden = false;
  instructions.replaceChildren(
    element("strong", "", "Publish both DNS records"),
    element("code", "domain-dns-record", `TXT ${domain.verificationName} → ${domain.verificationValue}`),
    element("code", "domain-dns-record", `CNAME hostname → ${domain.cnameTarget}`),
    element("p", "field-note", "The TXT record proves ownership. The CNAME sends customer traffic to Spatial Studio and allows Cloudflare to complete routing and TLS activation."),
  );
  const verify = element("button", "primary-button wide", "Verify ownership");
  verify.type = "button";
  verify.addEventListener("click", () => {
    void runAction({
      key: `verify-domain:${domain.id}`,
      trigger: verify,
      pendingLabel: "Checking DNS…",
      errorTarget: byId("domainError"),
    }, () => verifyCustomDomain(projectId, domain.id, domain.verificationToken));
  });
  instructions.append(verify);
}

async function rotateDomainChallenge(projectId: string, domainId: string): Promise<void> {
  const result = await api<{
    domain: {
      id: string;
      verificationName: string;
      verificationValue: string;
      verificationToken: string;
      cnameTarget: string;
    };
  }>(`/api/projects/${projectId}/domains/${domainId}/challenge`, { method: "POST" });
  showDomainChallenge(projectId, result.domain);
  await loadCustomDomains(projectId);
}

async function verifyCustomDomain(projectId: string, domainId: string, token: string): Promise<void> {
  await api(`/api/projects/${projectId}/domains/${domainId}/verify`, {
    method: "POST",
    body: JSON.stringify({ verificationToken: token }),
  });
  customDomainChallenges.delete(domainId);
  showToast("Domain ownership verified");
  await loadCustomDomains(projectId);
}

async function provisionCustomDomain(projectId: string, domainId: string): Promise<void> {
  const result = await api<{ ready: boolean }>(
    `/api/projects/${projectId}/domains/${domainId}/provision`,
    { method: "POST" },
  );
  showToast(result.ready ? "Branded hostname is active" : "Cloudflare activation is in progress");
  await loadCustomDomains(projectId);
}

async function removeCustomDomain(projectId: string, domainId: string): Promise<void> {
  await api(`/api/projects/${projectId}/domains/${domainId}`, { method: "DELETE" });
  customDomainChallenges.delete(domainId);
  showToast("Custom hostname removed");
  await loadCustomDomains(projectId);
}

async function cancelHosting(projectId: string): Promise<void> {
  await api(`/api/projects/${projectId}/hosting/cancel`, { method: "POST" });
  showToast("Stripe will cancel renewal at the paid period end");
  await refreshAll();
}

function isReviewer(): boolean {
  return Boolean(state.user && !["platform_admin", "production_operator"].includes(state.user.role));
}

function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency }).format(amountCents / 100);
}

function showNotice(message: string, type: "error" | "success" | "warning"): void {
  const notice = byId("globalNotice");
  notice.hidden = false;
  notice.className = `notice-card ${type}`;
  notice.textContent = message;
}

function clearNotice(): void {
  const notice = byId("globalNotice");
  notice.hidden = true;
  notice.textContent = "";
  notice.className = "notice-card";
}

async function confirmPublicationDecision(options: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  const dialog = byId<HTMLDialogElement>("publicationConfirmationDialog");
  const submit = byId<HTMLButtonElement>("publicationConfirmationSubmit");
  if (dialog.open) dialog.close("cancel");
  byId("publicationConfirmationTitle").textContent = options.title;
  byId("publicationConfirmationMessage").textContent = options.message;
  submit.textContent = options.confirmLabel;
  submit.className = options.danger ? "danger-button" : "primary-button";
  dialog.returnValue = "cancel";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), {
      once: true,
    });
    dialog.showModal();
  });
}

function showToast(message: string): void {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function detailCard(title: string): HTMLElement {
  const card = element("article", "detail-card");
  card.append(element("span", "eyebrow", title.toUpperCase()));
  return card;
}

function emptyState(message: string, compact = false): HTMLElement {
  return element("div", `empty-state${compact ? " compact" : ""}`, message);
}

function optionalString(value: FormDataEntryValue | null): string | undefined {
  const stringValue = typeof value === "string" ? value.trim() : "";
  return stringValue || undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const retry = error.status === 429 && error.retryAfterSeconds
      ? ` Try again in ${error.retryAfterSeconds} seconds.`
      : error.retryable
        ? " You can retry this action."
        : "";
    const request = error.requestId ? ` Reference: ${error.requestId}.` : "";
    // A bare "Validation failed" hides the field message that says what to
    // change; the server always sends it in details.
    const fields = validationFieldMessages(error.details);
    const detail = fields.length ? ` ${fields.join(" ")}` : "";
    return `${error.message}.${detail}${retry}${request}`.replace("..", ".");
  }
  return error instanceof Error ? error.message : String(error);
}

function validationFieldMessages(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const details = Reflect.get(payload, "details");
  if (!details || typeof details !== "object") return [];
  const messages: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      messages.push(value.endsWith(".") ? value : `${value}.`);
      return;
    }
    if (Array.isArray(value)) value.forEach(collect);
  };
  // Field maps arrive either directly or in zod's { fieldErrors, formErrors }.
  const fieldErrors = Reflect.get(details, "fieldErrors");
  const formErrors = Reflect.get(details, "formErrors");
  if (fieldErrors && typeof fieldErrors === "object") {
    Object.values(fieldErrors).forEach(collect);
    collect(formErrors);
  } else {
    Object.values(details).forEach(collect);
  }
  return messages.slice(0, 3);
}

function humanStatus(status: string): string {
  return status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusClass(status: string): string {
  if (
    status === "PUBLISHED" ||
    status === "APPROVED" ||
    status === "SUCCEEDED" ||
    status === "COMPLETED" ||
    status === "COMPLETE" ||
    status === "NO_MATERIAL_CHANGE" ||
    status === "COVERED" ||
    status === "RESOLVED" ||
    status === "DISMISSED"
  ) return "published";
  if (
    status === "QA_REQUIRED" ||
    status === "FAILED" ||
    status === "DEAD_LETTER" ||
    status === "RECAPTURE_REQUIRED" ||
    status === "INSUFFICIENT_EVIDENCE" ||
    status === "INSUFFICIENT_CORRESPONDENCE" ||
    status === "RECAPTURE" ||
    status === "PENDING" ||
    status === "CONFIRMED"
  ) return "review";
  return "processing";
}

function relativeTime(value: string): string {
  const deltaSeconds = Math.round((parseTimestamp(value).getTime() - Date.now()) / 1000);
  const seconds = Math.abs(deltaSeconds);
  if (seconds < 60) return deltaSeconds > 0 ? "in under 1m" : "just now";
  const amount = seconds < 3600
    ? `${Math.floor(seconds / 60)}m`
    : seconds < 86400
      ? `${Math.floor(seconds / 3600)}h`
      : `${Math.floor(seconds / 86400)}d`;
  return deltaSeconds > 0 ? `in ${amount}` : `${amount} ago`;
}

function parseTimestamp(value: string): Date {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return new Date(normalized);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024 ** 3).toFixed(1)} GiB`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  return `${(milliseconds / 60_000).toFixed(1)} min`;
}

function storedJobError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const message = typeof parsed.message === "string" ? parsed.message : "Processing failed";
    const failureClass = typeof parsed.failureClass === "string"
      ? humanStatus(parsed.failureClass)
      : null;
    return failureClass ? `${failureClass}: ${message}` : message;
  } catch {
    return "Processing failed; the stored error could not be decoded.";
  }
}
