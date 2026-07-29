import { api, apiFile, ApiError } from "./api";
import { isActionPending, runAction, SingleFlight } from "./action-state";
import {
  captureAdapterProfiles,
  captureFormatsForPurpose,
  type CaptureAssetFormat,
  type CaptureAssetPurpose,
} from "../shared/capture-adapters";
import "../../styles.css";

type TurnstileWidgetOptions = {
  sitekey: string;
  action: string;
  theme: "dark";
  size: "flexible";
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
  deliveryTemplate: string;
  notes: string | null;
  customerName: string | null;
  customFields: Record<string, string | number | boolean>;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
  activeReleaseSlug: string | null;
  updatedAt: string;
};
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
type Version = { id: string; version_number: number; status: string; created_at: string };
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
  access_policy: string;
  published_at: string;
  expires_at?: string | null;
  revoked_at: string | null;
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
};
type ProjectTemplate = {
  id: string;
  name: string;
  description: string | null;
  captureAdapter: string;
  deliveryTemplate: string;
  notes: string | null;
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
type ComparisonCameraPose = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovDegrees: number;
};
type VersionComparison = {
  requested: { left: string; right: string };
  versions: Array<Version & {
    source_provenance_json: string | null;
    manifest_json: string | null;
    updated_at: string;
  }>;
  assets: Array<Asset & {
    mime_type: string;
    sha256: string | null;
  }>;
  reviewComments: Array<{ version_id: string; kind: string; status: string; count: number }>;
  reviewDecisions: Array<{ version_id: string; decision: string; count: number; latest_at: string }>;
  reviewDecisionHistory: Array<ReviewDecision & { version_id: string }>;
  reviewCommentHistory: Array<ReviewComment & { version_id: string }>;
  renderables: Array<{
    versionId: string;
    assetId: string;
    format: "rad" | "spz" | "sog";
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string | null;
    contentUrl: string;
    sessionExpiresAt: string;
    viewer: {
      splatBudgetMillions?: number;
      sceneRotationDegrees?: [number, number, number];
      initialCamera?: {
        position: [number, number, number];
        target: [number, number, number];
        up?: [number, number, number];
        fovDegrees?: number;
      };
    } | null;
  }>;
};
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
  status: string;
};
type GeometryChangeSummary = {
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
type GeometryChangeReport = {
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
type RegisteredSceneChangeSummary = {
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
type RegisteredSceneChangeReport = {
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
    elevation_m: number;
    area_m2: number;
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
type StudioView = "projects" | "jobs" | "releases" | "reviews" | "spatial" | "measurement" | "hosting" | "team";

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

const state: {
  user: User | null;
  organisations: OrganisationMembership[];
  projects: Project[];
  jobs: Job[];
  releases: Release[];
  reviewProjects: ReviewProject[];
  reviewDetails: Record<string, ReviewDetail>;
  hosting: HostingWorkspace | null;
  spatial: SpatialWorkspace | null;
  spatialProjectId: string | null;
  measurement: MeasurementWorkspace | null;
  measurementProjectId: string | null;
  recoverableUploads: RecoverableUpload[];
  comparison: VersionComparison | null;
  team: TeamWorkspace | null;
  identityProviders: EnterpriseIdentityProvider[];
  captureAgents: CaptureAgentCredential[];
  selected: ProjectDetail | null;
  selectedProjectIds: Set<string>;
  projectTemplates: ProjectTemplate[];
  projectFields: ProjectCustomFieldDefinition[];
  projectViews: SavedProjectView[];
  activeProjectViewId: string | null;
  projectStatuses: string[];
  projectQuery: string;
  projectAdapter: string;
  projectDelivery: string;
  projectSort: ProjectViewFilter["sort"];
  view: StudioView;
} = {
  user: null,
  organisations: [],
  projects: [],
  jobs: [],
  releases: [],
  reviewProjects: [],
  reviewDetails: {},
  hosting: null,
  spatial: null,
  spatialProjectId: null,
  measurement: null,
  measurementProjectId: null,
  recoverableUploads: [],
  comparison: null,
  team: null,
  identityProviders: [],
  captureAgents: [],
  selected: null,
  selectedProjectIds: new Set(),
  projectTemplates: [],
  projectFields: [],
  projectViews: [],
  activeProjectViewId: null,
  projectStatuses: [],
  projectQuery: "",
  projectAdapter: "",
  projectDelivery: "",
  projectSort: "updated_desc",
  view: "projects",
};

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
const semanticExtractionDialog = byId<HTMLDialogElement>("semanticExtractionDialog");
const semanticReviewDialog = byId<HTMLDialogElement>("semanticReviewDialog");
const floorplanExtractionDialog = byId<HTMLDialogElement>("floorplanExtractionDialog");
const floorplanReviewDialog = byId<HTMLDialogElement>("floorplanReviewDialog");
const routeDialog = byId<HTMLDialogElement>("routeDialog");
const privacyCandidateDialog = byId<HTMLDialogElement>("privacyCandidateDialog");
const measurementBriefDialog = byId<HTMLDialogElement>("measurementBriefDialog");
const checkPointDialog = byId<HTMLDialogElement>("checkPointDialog");
const geometryChangeDialog = byId<HTMLDialogElement>("geometryChangeDialog");
const geometryChangeReviewDialog = byId<HTMLDialogElement>("geometryChangeReviewDialog");
const rawSceneChangeDialog = byId<HTMLDialogElement>("rawSceneChangeDialog");
const rawSceneChangeReviewDialog = byId<HTMLDialogElement>("rawSceneChangeReviewDialog");
const captureCompletenessDialog = byId<HTMLDialogElement>("captureCompletenessDialog");
const captureCompletenessReviewDialog = byId<HTMLDialogElement>("captureCompletenessReviewDialog");
const captureBundleDialog = byId<HTMLDialogElement>("captureBundleDialog");
const captureBundleReviewDialog = byId<HTMLDialogElement>("captureBundleReviewDialog");
const versionComparisonDialog = byId<HTMLDialogElement>("versionComparisonDialog");
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
} | null = null;
let activeUpload: {
  id: string;
  projectId: string;
  fileName: string;
  fileSize: number;
  format: string;
  purpose: CaptureAssetPurpose;
  partSizeBytes: number;
  parts: Map<number, string>;
} | null = null;
let uploadAbortController: AbortController | null = null;
let privacyScanOperation: { versionId: string; id: string } | null = null;
let geometryChangeOperation: {
  id: string;
  requestKey: string;
} | null = null;
let rawSceneChangeOperation: {
  id: string;
  requestKey: string;
} | null = null;
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
let rawSceneChangePollGeneration = 0;
let semanticExtractionPollGeneration = 0;
let floorplanExtractionPollGeneration = 0;
let comparisonProjectId: string | null = null;
let comparisonVersions: Version[] = [];
let comparisonGeneration = 0;
let comparisonSyncAt = 0;
const comparisonFrameReady = { left: false, right: false };
const comparisonFrameTimeouts: { left: number | null; right: number | null } = {
  left: null,
  right: null,
};

bindInterface();
void initialise();

async function initialise(): Promise<void> {
  try {
    const ssoStatus = new URLSearchParams(window.location.search).get("sso");
    const ssoCode = new URLSearchParams(window.location.search).get("code");
    let session = await api<
      { authenticated: true; user: User } | { authenticated: false }
    >("/api/auth/session");
    if (!session.authenticated) {
      try {
        await api("/api/auth/refresh", { method: "POST" });
        session = await api<
          { authenticated: true; user: User } | { authenticated: false }
        >("/api/auth/session");
      } catch {
        // A missing or expired refresh session is the expected anonymous path.
      }
    }
    if (!session.authenticated) {
      if (ssoStatus === "error") {
        byId("loginError").textContent = enterpriseLoginErrorMessage(ssoCode);
      }
      loginDialog.showModal();
      beginTurnstileInitialisation();
      clearSsoReturnParameters();
      return;
    }
    state.user = session.user;
    renderIdentity();
    await refreshAll();
    if (ssoStatus === "success") {
      showNotice("Enterprise sign-in verified.", "success");
      clearSsoReturnParameters();
    }
    void reconcileBillingCheckoutReturn();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      loginDialog.showModal();
      beginTurnstileInitialisation();
      return;
    }
    showNotice(errorMessage(error), "error");
  }
}

function bindInterface(): void {
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
    byId("projectError").textContent = "";
    renderProjectTemplateOptions();
    renderProjectCustomFieldForm("newProjectCustomFields", {});
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
  byId<HTMLSelectElement>("newProjectTemplate").addEventListener("change", (event) => {
    const select = event.currentTarget;
    if (!(select instanceof HTMLSelectElement)) return;
    applyProjectTemplateToForm(select.value, newProjectForm);
  });
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
    activateView("spatial");
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
    const form = new FormData(newProjectForm);
    void runAction({
      key: "create-project",
      trigger: newProjectSubmit,
      form: newProjectForm,
      pendingLabel: "Creating project…",
      errorTarget: byId("projectError"),
    }, () => createProject(form));
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
  const uploadAssetInput = byId<HTMLInputElement>("uploadAssetInput");
  uploadPurpose.addEventListener("change", () => {
    syncUploadPurpose(uploadPurpose.value as CaptureAssetPurpose);
  });
  uploadAssetInput.addEventListener("change", () => {
    const file = uploadAssetInput.files?.[0];
    if (!file) return;
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    const format = byId<HTMLSelectElement>("uploadFormat");
    if (extension && Array.from(format.options).some((option) => option.value === extension)) {
      format.value = extension;
    }
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
  const geometryChangeSubmit = geometryChangeForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  geometryChangeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(geometryChangeForm);
    if (String(form.get("fromVersionId")) === String(form.get("toVersionId"))) {
      byId("geometryChangeError").textContent = "Choose two distinct immutable versions.";
      return;
    }
    void runAction({
      key: "generate-geometry-change",
      trigger: geometryChangeSubmit,
      form: geometryChangeForm,
      pendingLabel: "Comparing geometry…",
      errorTarget: byId("geometryChangeError"),
    }, () => generateChangeReport(form));
  });
  const geometryChangeReviewSubmit = geometryChangeReviewForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  geometryChangeReviewForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(geometryChangeReviewForm);
    const reportId = String(form.get("reportId") ?? "");
    void runAction({
      key: `review-geometry-change:${reportId}`,
      trigger: geometryChangeReviewSubmit,
      form: geometryChangeReviewForm,
      pendingLabel: "Recording review…",
      errorTarget: byId("geometryChangeReviewError"),
    }, () => reviewGeometryChangeReport(form));
  });
  const rawSceneChangeSubmit = rawSceneChangeForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  rawSceneChangeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(rawSceneChangeForm);
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
      trigger: rawSceneChangeSubmit,
      form: rawSceneChangeForm,
      pendingLabel: "Queueing registration…",
      errorTarget: byId("rawSceneChangeError"),
    }, () => createRawSceneChangeReport(form));
  });
  const rawSceneChangeReviewSubmit =
    rawSceneChangeReviewForm.querySelector<HTMLButtonElement>("[type='submit']")!;
  rawSceneChangeReviewForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(rawSceneChangeReviewForm);
    const reportId = String(form.get("reportId") ?? "");
    void runAction({
      key: `review-raw-scene-change:${reportId}`,
      trigger: rawSceneChangeReviewSubmit,
      form: rawSceneChangeReviewForm,
      pendingLabel: "Recording review…",
      errorTarget: byId("rawSceneChangeReviewError"),
    }, () => reviewRawSceneChangeReport(form));
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
    renderCaptureBundleAssets(captureBundleVersion.value);
    renderCaptureBundlePreview();
  });
  byId("captureBundleAssets").addEventListener("change", renderCaptureBundlePreview);
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
  const comparisonSubmit = byId<HTMLButtonElement>("comparisonSubmit");
  versionComparisonForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(versionComparisonForm);
    const left = String(form.get("left") ?? "");
    const right = String(form.get("right") ?? "");
    if (left === right) {
      byId("comparisonError").textContent = "Choose two distinct immutable versions.";
      return;
    }
    void runAction({
      key: "load-version-comparison",
      trigger: comparisonSubmit,
      form: versionComparisonForm,
      pendingLabel: "Loading comparison…",
      errorTarget: byId("comparisonError"),
    }, () => loadVersionComparison(left, right));
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
  for (const side of ["left", "right"] as const) {
    const retry = byId<HTMLButtonElement>(side === "left" ? "compareLeftRetry" : "compareRightRetry");
    retry.addEventListener("click", () => {
      void runAction({
        key: `retry-comparison-renderer:${side}`,
        trigger: retry,
        pendingLabel: "Retrying renderer…",
      }, () => retryComparisonRenderer(side));
    });
  }
  window.addEventListener("message", handleComparisonRendererMessage);
  versionComparisonDialog.addEventListener("close", resetVersionComparison);
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
      if (section === "projects" || section === "jobs" || section === "releases" || section === "reviews" || section === "spatial" || section === "measurement" || section === "hosting" || section === "team") {
        activateView(section);
      }
    });
  });
  window.addEventListener("hashchange", () => void navigateFromHash());
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
  const result = await api<{ user: User }>("/api/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({
      email,
      challengeId: authChallengeId,
      code: String(form.get("code") ?? ""),
    }),
  });
  state.user = result.user;
  loginDialog.close();
  resetLogin();
  renderIdentity();
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
      size: "flexible",
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
  const candidate = window.location.hash.slice(1).split("/", 1)[0];
  return candidate === "jobs" || candidate === "releases" || candidate === "reviews" || candidate === "spatial" || candidate === "measurement" || candidate === "hosting" || candidate === "team"
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
  return projectId && ["projects", "spatial", "measurement"].includes(view)
    ? `#${view}/${encodeURIComponent(projectId)}`
    : `#${view}`;
}

async function navigateFromHash(): Promise<void> {
  const view = viewFromHash();
  const projectId = projectIdFromHash();
  if (!isReviewer() && projectId && state.selected?.project.id !== projectId) {
    await backgroundActions.run(`navigate-project:${projectId}`, () =>
      selectProject(projectId, false, false)
    );
  }
  activateView(view, false);
}

function activateView(
  view: StudioView,
  updateLocation = true,
): void {
  if (isReviewer() && view !== "reviews") view = "reviews";
  if (view === "team" && state.user?.role !== "platform_admin") view = "projects";
  state.view = view;
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === view);
  });
  const projectsVisible = view === "projects";
  const jobsVisible = view === "jobs";
  byId("summaryGrid").hidden = !projectsVisible;
  byId("studioGrid").hidden = !["projects", "jobs"].includes(view);
  byId("studioGrid").classList.toggle("jobs-only", jobsVisible);
  byId("projectBoard").hidden = jobsVisible;
  byId("queuePanel").hidden = false;
  byId("projectDetail").hidden = !projectsVisible || state.selected === null;
  byId("releaseWorkspace").hidden = view !== "releases";
  byId("reviewWorkspace").hidden = view !== "reviews";
  byId("spatialWorkspace").hidden = view !== "spatial";
  byId("measurementWorkspace").hidden = view !== "measurement";
  byId("hostingWorkspace").hidden = view !== "hosting";
  byId("teamWorkspace").hidden = view !== "team";
  byId<HTMLButtonElement>("newProjectButton").hidden = !projectsVisible || isReviewer();
  byId<HTMLButtonElement>("portfolioToolsButton").hidden = !projectsVisible || isReviewer();
  const headings = {
    projects: {
      eyebrow: "POST-CAPTURE CONTROL PLANE",
      title: "From immutable source to approved spatial release.",
    },
    jobs: {
      eyebrow: "PROCESSING OPERATIONS",
      title: "Durable jobs with visible progress and accountable outcomes.",
    },
    releases: {
      eyebrow: "DELIVERY OPERATIONS",
      title: "Every published scene has a version, owner, and lifecycle.",
    },
    reviews: {
      eyebrow: "CLIENT APPROVAL",
      title: "Feedback stays attached to the exact place and version.",
    },
    spatial: {
      eyebrow: "SPATIAL PRODUCT",
      title: "Turn visual reconstruction into a place people can understand.",
    },
    measurement: {
      eyebrow: "MEASUREMENT EVIDENCE",
      title: "Define tolerance, prove residuals, and state who may rely on the output.",
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
  renderJobs();
  if (view === "reviews") renderReviews();
  if (view === "spatial") {
    renderSpatial();
    void ensureProjectWorkspace("spatial");
  }
  if (view === "measurement") {
    renderMeasurement();
    void ensureProjectWorkspace("measurement");
  }
  if (view === "hosting") renderHosting();
  if (view === "team") renderTeam();
  const nextHash = hashForView(view);
  if (updateLocation && window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
}

async function signOut(): Promise<void> {
  try {
    await api<void>("/api/auth/session", { method: "DELETE" });
    state.user = null;
    state.organisations = [];
    clearTenantWorkspace();
    renderIdentity();
    renderProjects();
    renderJobs();
    renderReleases();
    byId("projectDetail").hidden = true;
    window.history.replaceState(null, "", "#projects");
    loginDialog.showModal();
  } catch (error) {
    showNotice(errorMessage(error), "error");
  }
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
        state.projectFields = [];
        state.selectedProjectIds.clear();
        bulkLifecycleOperation = null;
        state.jobs = [];
        state.releases = [];
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
        api<{ projects: Project[] }>("/api/projects"),
        api<{ jobs: Job[] }>("/api/jobs"),
        api<{ releases: Release[] }>("/api/releases"),
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
        api<{ templates: ProjectTemplate[] }>("/api/project-templates"),
        api<{ views: SavedProjectView[] }>("/api/project-views"),
        api<{ fields: ProjectCustomFieldDefinition[] }>("/api/project-fields"),
      ]);
      state.projects = projects.projects;
      state.projectTemplates = templates.templates;
      state.projectFields = fields.fields;
      state.projectViews = views.views;
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
      state.releases = releases.releases;
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
      activateView(requestedView, false);
      if (requestedView === "spatial" || requestedView === "measurement") {
        await ensureProjectWorkspace(requestedView, true);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) loginDialog.showModal();
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

async function createProject(form: FormData): Promise<void> {
  projectOperationId ??= crypto.randomUUID();
  try {
    const result = await api<{ project: { id: string } }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        clientOperationId: projectOperationId,
        name: String(form.get("name") ?? ""),
        customerName: optionalString(form.get("customerName")),
        captureAdapter: String(form.get("captureAdapter") ?? "open-import"),
        deliveryTemplate: String(form.get("deliveryTemplate") ?? "Property showcase"),
        notes: optionalString(form.get("notes")),
        customFields: projectCustomFieldsFromForm(byId("newProjectCustomFields")),
      }),
    });
    newProjectDialog.close();
    projectOperationId = null;
    byId<HTMLFormElement>("newProjectForm").reset();
    showToast("Project created");
    await refreshAll();
    activateView("projects");
    await selectProject(result.project.id);
  } catch (error) {
    byId("projectError").textContent = errorMessage(error);
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
  delivery.replaceChildren(new Option("All delivery templates", ""));
  for (const value of deliveryValues) delivery.append(new Option(value, value));
  delivery.value = state.projectDelivery;

  saved.replaceChildren(new Option("Current filters", ""));
  for (const view of state.projectViews) {
    saved.append(new Option(`${view.isDefault ? "★ " : ""}${view.name}`, view.id));
  }
  saved.value = state.activeProjectViewId ?? "";
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
    api<{ templates: ProjectTemplate[] }>("/api/project-templates"),
    api<{ views: SavedProjectView[] }>("/api/project-views"),
    api<{ fields: ProjectCustomFieldDefinition[] }>("/api/project-fields"),
  ]);
  state.projectTemplates = templates.templates;
  state.projectViews = views.views;
  state.projectFields = fields.fields;
  renderProjectTemplateOptions();
  renderProjectControls();
  if (portfolioToolsDialog.open) renderPortfolioTools();
}

function renderProjectTemplateOptions(): void {
  const select = byId<HTMLSelectElement>("newProjectTemplate");
  const selected = select.value;
  select.replaceChildren(new Option("No template — choose settings below", ""));
  for (const template of state.projectTemplates) {
    select.append(new Option(template.name, template.id));
  }
  select.value = state.projectTemplates.some((template) => template.id === selected) ? selected : "";
}

function applyProjectTemplateToForm(templateId: string, form: HTMLFormElement): void {
  const template = state.projectTemplates.find((candidate) => candidate.id === templateId);
  if (!template) return;
  const captureAdapter = form.elements.namedItem("captureAdapter");
  const deliveryTemplate = form.elements.namedItem("deliveryTemplate");
  const notes = form.elements.namedItem("notes");
  if (captureAdapter instanceof HTMLSelectElement) captureAdapter.value = template.captureAdapter;
  if (deliveryTemplate instanceof HTMLSelectElement) deliveryTemplate.value = template.deliveryTemplate;
  if (notes instanceof HTMLTextAreaElement) notes.value = template.notes ?? "";
  byId("projectError").textContent = "";
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
  byId("workspaceName").textContent = state.user?.displayName ?? "Sign in required";
  byId("workspaceRole").textContent = state.user ? `${state.user.email} · ${state.user.role}` : "Secure production environment";
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
  clearTenantWorkspace();
  state.user = result.user;
  renderIdentity();
  window.history.replaceState(null, "", "#projects");
  await refreshAll();
  showToast(`Switched to ${result.organisation.name}`);
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
  state.measurement = null;
  state.measurementProjectId = null;
  state.team = null;
  state.identityProviders = [];
  state.captureAgents = [];
  state.recoverableUploads = [];
  state.selected = null;
  state.selectedProjectIds.clear();
  state.projectTemplates = [];
  state.projectFields = [];
  state.projectViews = [];
  state.activeProjectViewId = null;
  state.projectQuery = "";
  state.projectAdapter = "";
  state.projectDelivery = "";
  state.projectSort = "updated_desc";
  state.projectStatuses = [];
  projectViewsInitialised = false;
  resetPortfolioImport();
  resetPortfolioHandoff();
  resetAssetHandoff();
  bulkLifecycleOperation = null;
}

function renderProjects(): void {
  const container = byId("projectTable");
  container.replaceChildren();
  const projects = visibleProjects();
  if (!projects.length) {
    renderBulkProjectActions();
    container.append(emptyState("No projects match this filter."));
    return;
  }
  const header = element("div", "project-row header");
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
  header.append(selectVisible);
  ["Project", "Source", "Stage", "Updated", ""].forEach((label) => header.append(element("span", "", label)));
  container.append(header);
  for (const project of projects) {
    const row = element("div", "project-row");
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
    const identity = element("span", "project-identity");
    const icon = element("b", "project-icon property", project.name.slice(0, 1).toUpperCase());
    const name = element("span");
    name.append(element("strong", "", project.name), element("small", "", project.customerName ?? project.deliveryTemplate));
    identity.append(icon, name);
    const stage = element("span");
    stage.append(element("i", `state ${statusClass(project.status)}`), document.createTextNode(humanStatus(project.status)));
    const open = element("button", "", "Manage");
    open.addEventListener("click", () => {
      void runAction({
        key: `select-project:${project.id}`,
        trigger: open,
        pendingLabel: "Opening…",
      }, () => selectProject(project.id));
    });
    row.append(selected, identity, element("span", "", project.captureAdapter), stage, element("span", "", relativeTime(project.updatedAt)), open);
    container.append(row);
  }
  renderBulkProjectActions();
}

function visibleProjects(): Project[] {
  const query = state.projectQuery.trim().toLowerCase();
  const projects = state.projects.filter((project) => {
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
}

function renderReleases(): void {
  const container = byId("releaseList");
  container.replaceChildren();
  if (!state.releases.length) {
    container.append(emptyState("No release history yet. Approve a version, then publish its first channel."));
    return;
  }
  const header = element("div", "release-list-row header");
  ["Project", "Channel", "Policy", "Published", "State", ""].forEach((label) =>
    header.append(element("span", "", label))
  );
  container.append(header);
  for (const release of state.releases) {
    const row = element("div", "release-list-row");
    const project = element("span");
    project.append(
      element("strong", "", release.project_name ?? "Project"),
      element("small", "", `Version ${release.version_id.slice(0, 8)}`),
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
    if (release.is_active && !release.revoked_at) {
      const revoke = element("button", "danger-button", "Revoke");
      revoke.addEventListener("click", () => {
        if (!confirm(`Revoke /s/${release.slug}? Visitors will lose access immediately.`)) return;
        void runAction({
          key: `revoke-release:${release.slug}`,
          trigger: revoke,
          pendingLabel: "Revoking…",
        }, () => revokeRelease(release.slug));
      });
      actions.append(revoke);
    } else if (!release.revoked_at) {
      const rollback = element("button", "quiet-button", "Make active");
      rollback.addEventListener("click", () => {
        if (!confirm(`Make this historical release active at /s/${release.slug}?`)) return;
        void runAction({
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
    container.append(row);
  }
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
    compare.addEventListener("click", () => openVersionComparison(project.id, detail.versions ?? []));
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
      `${decision.decision === "approved" ? "Approved" : "Changes requested"} · ${decision.reviewer_name ?? decision.reviewer_email ?? "Reviewer"}${decision.note ? ` — ${decision.note}` : ""}`,
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
    finance.append(element("div", "alert-line", `${humanStatus(alert.kind)} · ${alert.label}${alert.detail ? ` — ${alert.detail}` : ""}`));
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

function openVersionComparison(projectId: string, versions: Version[]): void {
  if (versions.length < 2) {
    showNotice("At least two immutable versions are required for comparison.", "error");
    return;
  }
  comparisonProjectId = projectId;
  comparisonVersions = [...versions].sort((left, right) => right.version_number - left.version_number);
  state.comparison = null;
  const left = byId<HTMLSelectElement>("comparisonLeftVersion");
  const right = byId<HTMLSelectElement>("comparisonRightVersion");
  const options = comparisonVersions.map((version) => {
    const option = document.createElement("option");
    option.value = version.id;
    option.textContent = `v${version.version_number} · ${humanStatus(version.status)} · ${parseTimestamp(version.created_at).toLocaleDateString()}`;
    return option;
  });
  left.replaceChildren(...options.map((option) => option.cloneNode(true)));
  right.replaceChildren(...options.map((option) => option.cloneNode(true)));
  left.value = comparisonVersions[1]!.id;
  right.value = comparisonVersions[0]!.id;
  resetComparisonPresentation();
  byId("comparisonError").textContent = "";
  versionComparisonDialog.showModal();
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
    if (generation !== comparisonGeneration || !versionComparisonDialog.open) return;
    state.comparison = comparison;
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
      `Version ${version.version_number} · ${humanStatus(version.status)}`;
    renderComparisonEvidence(side, comparison, version);
    const renderable = comparison.renderables.find((candidate) => candidate.versionId === version.id);
    const elements = comparisonSideElements(side);
    if (!renderable) {
      comparisonFrameReady[side] = true;
      elements.frame.hidden = true;
      elements.empty.hidden = false;
      elements.empty.textContent = "No verified Spark web derivative is attached to this version. Approval history remains available below.";
      elements.retry.hidden = true;
      setComparisonSideStatus(side, "Evidence only", "");
      continue;
    }
    elements.empty.hidden = true;
    elements.frame.hidden = false;
    elements.retry.hidden = true;
    setComparisonSideStatus(side, "Starting Spark…", "");
    elements.frame.src = comparisonRendererUrl(renderable).toString();
    elements.frame.dataset.generation = String(comparisonGeneration);
    comparisonFrameTimeouts[side] = window.setTimeout(() => {
      if (comparisonFrameReady[side] || !versionComparisonDialog.open) return;
      setComparisonSideStatus(side, "Renderer timed out", "error");
      elements.retry.hidden = false;
      finishComparisonLoadingIfSettled();
    }, 25_000);
  }
  finishComparisonLoadingIfSettled();
}

function comparisonRendererUrl(renderable: VersionComparison["renderables"][number]): URL {
  const url = new URL("/renderer/index.html", location.origin);
  url.searchParams.set("content", renderable.contentUrl);
  url.searchParams.set("format", renderable.format);
  url.searchParams.set("budget", String(renderable.viewer?.splatBudgetMillions ?? 1.25));
  const rotation = renderable.viewer?.sceneRotationDegrees;
  if (rotation) url.searchParams.set("rotation", rotation.join(","));
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
  const facts = element("div", "comparison-facts");
  facts.append(
    comparisonFact("Created", parseTimestamp(version.created_at).toLocaleString()),
    comparisonFact("Web asset", renderable ? `${renderable.format.toUpperCase()} · ${formatBytes(renderable.sizeBytes)}` : "Not attached"),
    comparisonFact("Integrity", renderable?.sha256 ? renderable.sha256.slice(0, 12) : "No verified hash"),
  );
  container.append(facts);

  const decisions = comparison.reviewDecisionHistory.filter((item) => item.version_id === version.id);
  const decisionHistory = element("section", "comparison-history");
  decisionHistory.append(element("strong", "", "Approval history"));
  if (!decisions.length) {
    decisionHistory.append(element("div", "comparison-history-line", "No approval decision has been recorded."));
  }
  for (const decision of decisions) {
    decisionHistory.append(element(
      "div",
      `comparison-history-line ${decision.decision}`,
      `${decision.decision === "approved" ? "Approved" : "Changes requested"} · ${decision.reviewer_name ?? decision.reviewer_email ?? "Reviewer"} · ${parseTimestamp(decision.created_at).toLocaleString()}${decision.note ? ` — ${decision.note}` : ""}`,
    ));
  }
  container.append(decisionHistory);

  const comments = comparison.reviewCommentHistory.filter((item) => item.version_id === version.id);
  const commentHistory = element("section", "comparison-history");
  commentHistory.append(element("strong", "", "Review comments"));
  if (!comments.length) {
    commentHistory.append(element("div", "comparison-history-line", "No comments are attached to this version."));
  }
  for (const comment of comments.slice(0, 16)) {
    commentHistory.append(element(
      "div",
      `comparison-history-line ${comment.status}`,
      `${humanStatus(comment.kind)} · ${humanStatus(comment.status)} · ${comment.author_name ?? comment.author_email ?? "Reviewer"} · ${parseTimestamp(comment.created_at).toLocaleString()} — ${comment.body}`,
    ));
  }
  container.append(commentHistory);
}

function comparisonFact(label: string, value: string): HTMLElement {
  const fact = element("div", "comparison-fact");
  fact.append(element("small", "", label), element("strong", "", value));
  return fact;
}

function comparisonSideElements(side: "left" | "right"): {
  frame: HTMLIFrameElement;
  empty: HTMLElement;
  retry: HTMLButtonElement;
  status: HTMLElement;
} {
  const prefix = side === "left" ? "Left" : "Right";
  return {
    frame: byId<HTMLIFrameElement>(`compare${prefix}Frame`),
    empty: byId(`compare${prefix}Empty`),
    retry: byId<HTMLButtonElement>(`compare${prefix}Retry`),
    status: byId(`compare${prefix}Status`),
  };
}

function setComparisonSideStatus(side: "left" | "right", text: string, stateClass: "" | "ready" | "error"): void {
  const status = comparisonSideElements(side).status;
  status.textContent = text;
  status.className = `comparison-status${stateClass ? ` ${stateClass}` : ""}`;
}

function handleComparisonRendererMessage(event: MessageEvent<unknown>): void {
  if (event.origin !== location.origin || !versionComparisonDialog.open) return;
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
  return (
    validNumberTuple(Reflect.get(value, "position")) &&
    validNumberTuple(Reflect.get(value, "target")) &&
    validNumberTuple(Reflect.get(value, "up")) &&
    Number.isFinite(Number(Reflect.get(value, "fovDegrees")))
  );
}

function validNumberTuple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(item));
}

async function retryComparisonRenderer(_side: "left" | "right"): Promise<void> {
  const left = byId<HTMLSelectElement>("comparisonLeftVersion").value;
  const right = byId<HTMLSelectElement>("comparisonRightVersion").value;
  await loadVersionComparison(left, right);
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
    elements.frame.removeAttribute("src");
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
  state.comparison = null;
  resetComparisonPresentation();
  byId("comparisonError").textContent = "";
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
      const remove = element("button", "danger-button", "Archive");
      remove.addEventListener("click", () => {
        if (!confirm(`Archive ${entity.label}? Routes using it may need revision.`)) return;
        void runAction({
          key: `archive-entity:${entity.id}`,
          trigger: remove,
          pendingLabel: "Archiving…",
        }, () => archiveSpatialEntity(entity.id));
      });
      row.append(remove);
      group.append(row);
    }
    hierarchy.append(group);
  }
  const add = element("button", "primary-button wide", "Add floor, room, doorway, or POI");
  add.addEventListener("click", () => {
    byId<HTMLFormElement>("entityForm").reset();
    byId("entityError").textContent = "";
    entityDialog.showModal();
  });
  hierarchy.append(add);

  const semanticExtraction = element("article", "workspace-card-large semantic-extraction-card");
  semanticExtraction.append(
    element("span", "eyebrow", "POINT-CLOUD SEMANTICS"),
    element("h3", "", "Machine candidates, human-authored structure"),
    element(
      "p",
      "muted-copy",
      "A leased processor can propose bounded walkable polygons from a verified, registered Y-up metric PLY. Nothing enters the scene hierarchy until an operator accepts specific candidates.",
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
    const summaryText = summary
      ? `${summary.candidateCount} candidate${summary.candidateCount === 1 ? "" : "s"} · ${summary.totalCandidateAreaM2.toFixed(2)} m² proxy area · inferred elevation ${summary.inferredFloorElevationM.toFixed(2)} m`
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
    element("h3", "", "Routes and walkable runtime"),
    projectFact("Collision regions", String(spatial.collisionProxy.boxes.length)),
    projectFact("Navigation triangles", String(Math.floor(spatial.navigationMesh.indices.length / 3))),
  );
  if (!spatial.routes.length) routes.append(element("p", "muted-copy", "No guided route yet."));
  for (const route of spatial.routes) {
    const stopCount = spatial.routeStops.filter((stop) => stop.route_id === route.id).length;
    routes.append(element("div", "hosting-row", `${route.label} · ${humanStatus(route.accessibility)} · ${stopCount} stops`));
  }
  const addRoute = element("button", "quiet-button wide", "Create guided route");
  addRoute.disabled = spatial.entities.length === 0;
  addRoute.addEventListener("click", openRouteDialog);
  routes.append(addRoute);

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
  const authoredRooms = spatial.entities.filter((entity) => entity.kind === "room" && entity.geometry_json);
  const analyzeCapture = element("button", "primary-button wide", captureReports.length
    ? "Analyze another trajectory"
    : "Analyze capture trajectory");
  analyzeCapture.disabled = authoredRooms.length === 0;
  analyzeCapture.title = authoredRooms.length
    ? ""
    : "Author at least one room footprint before evaluating path coverage.";
  analyzeCapture.addEventListener("click", openCaptureCompletenessDialog);
  captureEvidence.append(
    analyzeCapture,
    element(
      "small",
      "field-note",
      authoredRooms.length
        ? `${authoredRooms.length} authored room footprint${authoredRooms.length === 1 ? "" : "s"} will define the coverage target.`
        : "No authored room footprint is available for a defensible coverage target.",
    ),
  );

  const assurance = element("article", "workspace-card-large privacy-assurance");
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
  assurance.append(element("hr", "section-rule"));
  assurance.append(
    element("h4", "", "Authored geometry change evidence"),
    element("p", "muted-copy", "Metric footprints and an XZ overlay are generated only when both versions are asserted to share a coordinate frame."),
  );
  if (!spatial.changeReports.length) {
    assurance.append(element("p", "muted-copy", "No geometry comparison has been generated for this project."));
  }
  for (const report of spatial.changeReports) {
    assurance.append(renderGeometryChangeReport(project.id, report));
  }
  if ((state.selected?.versions.length ?? 0) >= 2) {
    const compare = element("button", "quiet-button wide", spatial.changeReports.length
      ? "Generate another geometry comparison"
      : "Compare authored geometry");
    compare.addEventListener("click", openGeometryChangeDialog);
    assurance.append(compare);
  } else {
    assurance.append(element("p", "field-note", "Two immutable versions are required before geometry can be compared."));
  }
  assurance.append(element("hr", "section-rule"));
  assurance.append(
    element("h4", "", "Registered raw-scene change evidence"),
    element(
      "p",
      "muted-copy",
      "A leased processor can estimate bounded yaw and translation, enforce overlap/RMSE/ambiguity gates, then compare verified PLY occupancy, centroid movement, and mean colour. Results remain human-reviewed evidence—not survey or causation claims.",
    ),
  );
  const rawReports = spatial.rawChangeReports ?? [];
  if (!rawReports.length) {
    assurance.append(element("p", "muted-copy", "No registered raw-scene comparison has been queued for this project."));
  }
  for (const report of rawReports.slice(0, 8)) {
    assurance.append(renderRawSceneChangeReport(report));
  }
  const comparableVersions = (state.selected?.versions ?? []).filter((version) =>
    eligibleRawChangeAssets(version.id).length > 0
  );
  const compareRaw = element(
    "button",
    "quiet-button wide",
    rawReports.length ? "Queue another registration + comparison" : "Register and compare PLY assets",
  );
  compareRaw.disabled = comparableVersions.length < 2;
  compareRaw.title = comparableVersions.length < 2
    ? "Two immutable versions with verified PLY assets are required."
    : "";
  compareRaw.addEventListener("click", openRawSceneChangeDialog);
  assurance.append(
    compareRaw,
    element(
      "small",
      "field-note",
      comparableVersions.length >= 2
        ? `${comparableVersions.length} immutable versions have eligible verified PLY evidence.`
        : "Upload and verify a source, master, or point-cloud PLY on two immutable versions first.",
    ),
  );

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
  container.append(
    hierarchy,
    semanticExtraction,
    renderFloorplanWorkflow(project, spatial),
    routes,
    captureEvidence,
    assurance,
    delivery,
  );
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
        element("span", "", `${summary.roomCount} room${summary.roomCount === 1 ? "" : "s"}`),
        element("span", "", `${summary.wallCount} wall run${summary.wallCount === 1 ? "" : "s"}`),
        element("span", "", `${summary.openingCount} opening candidate${summary.openingCount === 1 ? "" : "s"}`),
        element("span", "", `${summary.totalRoomAreaM2.toFixed(2)} m² indicative`),
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

async function loadSpatialWorkspace(projectId: string): Promise<void> {
  const workspace = await api<SpatialWorkspace>(`/api/projects/${projectId}/spatial`);
  if (state.selected?.project.id !== projectId) return;
  state.spatial = workspace;
  state.spatialProjectId = projectId;
  if (state.view === "spatial") renderSpatial();
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
    coordinateAssurance: "registered_y_up_metric_frame",
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
    `${candidates.length === 1 ? "" : "s"}. Select only regions inspected against the registered point cloud.`;
  const choices = byId("semanticCandidateChoices");
  choices.replaceChildren();
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
        `${candidate.area_m2.toFixed(2)} m² proxy area · elevation ${candidate.elevation_m.toFixed(2)} m · ${Math.round(candidate.confidence * 100)}% extraction confidence`,
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
      state.selected?.project.id !== projectId ||
      state.view !== "spatial"
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
  if (generation === semanticExtractionPollGeneration && state.selected?.project.id === projectId) {
    showNotice(
      "Semantic extraction is still running. Its verified inputs and queued job are retained; refresh later.",
      "error",
    );
  }
}

function parseSemanticExtractionSummary(value: string | null): {
  candidateCount: number;
  totalCandidateAreaM2: number;
  inferredFloorElevationM: number;
} | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const candidateCount = Number(parsed.candidateCount);
    const totalCandidateAreaM2 = Number(parsed.totalCandidateAreaM2);
    const inferredFloorElevationM = Number(parsed.inferredFloorElevationM);
    if (
      !Number.isFinite(candidateCount) ||
      !Number.isFinite(totalCandidateAreaM2) ||
      !Number.isFinite(inferredFloorElevationM)
    ) return null;
    return { candidateCount, totalCandidateAreaM2, inferredFloorElevationM };
  } catch {
    return null;
  }
}

type EditableFloorplan = {
  schemaVersion: "1.0.0";
  units: "metres";
  coordinateFrame: "registered_y_up_metric_frame";
  levels: Array<{
    id: string;
    label: string;
    elevationM: number;
    rooms: Array<{ id: string; label: string; points: Array<[number, number]> }>;
    walls: Array<{
      id: string;
      label: string;
      start: [number, number];
      end: [number, number];
      thicknessM: number;
      heightM: number;
    }>;
    openings: Array<{
      id: string;
      label: string;
      type: "door" | "window" | "opening" | "unknown";
      wallId: string | null;
      start: [number, number];
      end: [number, number];
      widthM: number;
      heightM: number | null;
    }>;
  }>;
};

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
  byId("floorplanExtractionError").textContent = "";
  floorplanExtractionOperation = null;
  floorplanExtractionDialog.showModal();
}

async function queueFloorplanExtraction(form: FormData): Promise<void> {
  const project = state.selected?.project;
  const version = state.spatial?.version;
  if (!project || !version) throw new Error("Open an immutable scene version first.");
  const elevationValue = String(form.get("elevationHintM") ?? "").trim();
  const body = {
    versionId: version.id,
    inputAssetId: String(form.get("inputAssetId") ?? ""),
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
    return { roomCount, wallCount, openingCount, totalRoomAreaM2 };
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
  if (!rooms.length || !walls.length) {
    throw new Error("The stored proposal has no reviewable rooms or walls.");
  }
  const proposalSummary = proposal.summary;
  const elevationM = Number(
    proposalSummary && typeof proposalSummary === "object"
      ? Reflect.get(proposalSummary, "inferredFloorElevationM")
      : 0,
  );
  const toPoint2 = (value: unknown): [number, number] => {
    if (!Array.isArray(value) || value.length !== 3) throw new Error("Proposal geometry is malformed.");
    const point = value.map(Number);
    if (point.some((coordinate) => !Number.isFinite(coordinate))) {
      throw new Error("Proposal geometry contains a non-finite coordinate.");
    }
    return [point[0]!, point[2]!];
  };
  return {
    schemaVersion: "1.0.0",
    units: "metres",
    coordinateFrame: "registered_y_up_metric_frame",
    levels: [{
      id: "level-1",
      label: "Level 1",
      elevationM: Number.isFinite(elevationM) ? elevationM : 0,
      rooms: rooms.map((candidate, index) => {
        const room = candidate as Record<string, unknown>;
        const geometry = room.geometry as Record<string, unknown>;
        if (!Array.isArray(geometry?.points)) throw new Error("A proposed room is missing its polygon.");
        return {
          id: String(room.roomKey ?? `room-${index + 1}`),
          label: String(room.label ?? `Room ${index + 1}`),
          points: geometry.points.map(toPoint2),
        };
      }),
      walls: walls.map((candidate, index) => {
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
      }),
      openings: openings.map((candidate, index) => {
        const opening = candidate as Record<string, unknown>;
        const geometry = opening.geometry as Record<string, unknown>;
        if (!Array.isArray(geometry?.points) || geometry.points.length !== 2) {
          throw new Error("A proposed opening is missing its endpoints.");
        }
        return {
          id: String(opening.openingKey ?? `opening-${index + 1}`),
          label: String(opening.label ?? `Opening ${index + 1}`),
          type: "unknown",
          wallId: null,
          start: toPoint2(geometry.points[0]),
          end: toPoint2(geometry.points[1]),
          widthM: Number(opening.widthM),
          heightM: null,
        };
      }),
    }],
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
  for (const level of levels) {
    if (!level || typeof level !== "object") throw new Error("Every level must be an object.");
    if (
      !Array.isArray(Reflect.get(level, "rooms")) ||
      !Array.isArray(Reflect.get(level, "walls")) ||
      !Array.isArray(Reflect.get(level, "openings"))
    ) {
      throw new Error("Every level needs room, wall, and opening arrays.");
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
    const level = plan.levels[0]!;
    const allPoints = [
      ...level.rooms.flatMap((room) => room.points),
      ...level.walls.flatMap((wall) => [wall.start, wall.end]),
      ...level.openings.flatMap((opening) => [opening.start, opening.end]),
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
    preview.append(svg);
    validation.classList.remove("floorplan-json-invalid");
    validation.textContent =
      `${level.rooms.length} rooms · ${level.walls.length} walls · ${level.openings.length} openings` +
      `${plan.levels.length > 1 ? ` · previewing first of ${plan.levels.length} levels` : ""}`;
  } catch (error) {
    validation.classList.add("floorplan-json-invalid");
    validation.textContent = errorMessage(error);
    preview.append(emptyState("Fix the structured plan to restore the live preview."));
  }
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
      state.selected?.project.id !== projectId ||
      state.view !== "spatial"
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
  if (generation === floorplanExtractionPollGeneration && state.selected?.project.id === projectId) {
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

async function createSpatialEntity(form: FormData): Promise<void> {
  const project = state.selected?.project;
  const version = state.spatial?.version;
  if (!project || !version) throw new Error("Open an immutable scene version first.");
  const position = parsePosition(String(form.get("position") ?? ""));
  const geometry = parseWalkableBounds(String(form.get("bounds") ?? ""));
  await api(`/api/projects/${project.id}/spatial/entities`, {
    method: "POST",
    body: JSON.stringify({
      clientOperationId: crypto.randomUUID(),
      versionId: version.id,
      kind: String(form.get("kind") ?? "room"),
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
      state.selected?.project.id !== projectId ||
      state.view !== "spatial"
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
  if (generation === privacyScanPollGeneration && state.selected?.project.id === projectId) {
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
  const body = {
    versionId: String(form.get("versionId") ?? ""),
    source: {
      adapter: project.captureAdapter,
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

function openGeometryChangeDialog(): void {
  const versions = state.selected?.versions ?? [];
  if (versions.length < 2) return;
  const from = byId<HTMLSelectElement>("geometryChangeFrom");
  const to = byId<HTMLSelectElement>("geometryChangeTo");
  from.replaceChildren();
  to.replaceChildren();
  for (const version of versions) {
    const label = `Version ${version.version_number} · ${humanStatus(version.status)}`;
    from.append(new Option(label, version.id));
    to.append(new Option(label, version.id));
  }
  from.value = versions[1]?.id ?? versions[0]!.id;
  to.value = versions[0]!.id;
  const form = byId<HTMLFormElement>("geometryChangeForm");
  const evidence = form.elements.namedItem("registrationEvidence");
  if (evidence instanceof HTMLTextAreaElement) evidence.value = "";
  byId("geometryChangeError").textContent = "";
  geometryChangeOperation = null;
  geometryChangeDialog.showModal();
}

async function generateChangeReport(form: FormData): Promise<void> {
  const project = state.selected?.project;
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
    body: JSON.stringify({
      clientOperationId: geometryChangeOperation.id,
      ...body,
    }),
  });
  geometryChangeDialog.close();
  geometryChangeOperation = null;
  showToast("Authored geometry evidence generated");
  await loadSpatialWorkspace(project.id);
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
  geometryChangeReviewDialog.showModal();
}

async function reviewGeometryChangeReport(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  const reportId = String(form.get("reportId") ?? "");
  await api(`/api/projects/${project.id}/spatial/change-reports/${encodeURIComponent(reportId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      decision: String(form.get("decision") ?? ""),
      note: String(form.get("note") ?? "").trim(),
    }),
  });
  geometryChangeReviewDialog.close();
  showToast("Geometry evidence review recorded");
  await loadSpatialWorkspace(project.id);
}

function renderGeometryChangeReport(projectId: string, report: GeometryChangeReport): HTMLElement {
  const card = element("article", "geometry-change-card");
  const summary = parseGeometryChangeSummary(report.summary_json);
  if (!summary) {
    card.append(
      element("strong", "", "Unreadable geometry report"),
      element("p", "form-error", "The stored evidence could not be parsed. Generate a fresh comparison."),
    );
    return card;
  }
  const header = element("div", "geometry-change-heading");
  const title = element("div");
  title.append(
    element("strong", "", `Version ${summary.versions.from.versionNumber} → ${summary.versions.to.versionNumber}`),
    element("small", "muted-copy", `${summary.thresholdMm} mm threshold · ${humanStatus(summary.coordinateAssurance)}`),
  );
  header.append(
    title,
    element("span", `status-pill ${statusClass(summary.result.toUpperCase())}`, humanStatus(summary.result)),
  );
  card.append(header);

  const metrics = element("div", "geometry-change-metrics");
  metrics.append(
    compactMetric("Comparable", summary.summary.comparable),
    compactMetric("Changed", summary.summary.changed),
    compactMetric("Added / removed", `${summary.summary.added} / ${summary.summary.removed}`),
    compactMetric("P95 deviation", summary.summary.p95DeviationMm === null ? "—" : `${summary.summary.p95DeviationMm} mm`),
    compactMetric("Maximum", summary.summary.maxDeviationMm === null ? "—" : `${summary.summary.maxDeviationMm} mm`),
  );
  card.append(metrics, renderGeometryChangeOverlay(summary));

  if (summary.blockers.length) {
    const blockers = element("div", "notice-card geometry-change-blockers");
    blockers.append(element("strong", "", "Metric conclusion blocked"));
    const list = document.createElement("ul");
    for (const blocker of summary.blockers) list.append(element("li", "", blocker));
    blockers.append(list);
    card.append(blockers);
  }
  if (summary.comparisons.length) {
    const rows = element("div", "geometry-change-rows");
    for (const comparison of summary.comparisons.slice(0, 8)) {
      const row = element("div", "geometry-change-row");
      row.append(
        element("span", "", comparison.label),
        element("span", "", `${comparison.maxDeviationMm} mm max`),
        element("span", `status-pill ${statusClass(comparison.classification.toUpperCase())}`, humanStatus(comparison.classification)),
      );
      rows.append(row);
    }
    card.append(rows);
  }
  card.append(element("p", "field-note", summary.limitation));
  if (report.status === "reviewed") {
    card.append(element(
      "div",
      "notice-card",
      `${humanStatus(report.review_decision ?? "reviewed")}: ${report.review_note ?? "Review recorded."}`,
    ));
  }
  const actions = element("div", "release-actions");
  const review = element("button", report.status === "reviewed" ? "quiet-button" : "primary-button", report.status === "reviewed"
    ? "Review again"
    : "Review evidence");
  review.addEventListener("click", () => openGeometryChangeReview(report, summary));
  const visual = element("button", "quiet-button", "Open rendered versions");
  visual.addEventListener("click", () => {
    const versions = state.selected?.versions ?? [];
    const relevant = versions.filter((version) => (
      version.id === report.from_version_id || version.id === report.to_version_id
    ));
    openVersionComparison(projectId, relevant.length === 2 ? relevant : versions);
  });
  actions.append(review, visual);
  card.append(actions);
  return card;
}

function eligibleRawChangeAssets(versionId: string): Asset[] {
  return (state.selected?.assets ?? []).filter((asset) => (
    asset.version_id === versionId &&
    ["source", "master", "pointcloud"].includes(asset.kind) &&
    asset.format.toLowerCase() === "ply" &&
    asset.integrity_status === "verified"
  ));
}

function openRawSceneChangeDialog(): void {
  const versions = (state.selected?.versions ?? []).filter((version) =>
    eligibleRawChangeAssets(version.id).length > 0
  );
  if (versions.length < 2) {
    showNotice("Two immutable versions with verified source, master, or point-cloud PLY assets are required.", "error");
    return;
  }
  const form = byId<HTMLFormElement>("rawSceneChangeForm");
  form.reset();
  const baselineVersion = byId<HTMLSelectElement>("rawChangeBaselineVersion");
  const candidateVersion = byId<HTMLSelectElement>("rawChangeCandidateVersion");
  baselineVersion.replaceChildren();
  candidateVersion.replaceChildren();
  for (const version of versions) {
    const label = `Version ${version.version_number} · ${humanStatus(version.status)}`;
    baselineVersion.append(new Option(label, version.id));
    candidateVersion.append(new Option(label, version.id));
  }
  baselineVersion.value = versions[1]?.id ?? versions[0]!.id;
  candidateVersion.value = versions[0]!.id;
  const populateAssets = (versionSelect: HTMLSelectElement, assetSelectId: string): void => {
    const assetSelect = byId<HTMLSelectElement>(assetSelectId);
    assetSelect.replaceChildren();
    for (const asset of eligibleRawChangeAssets(versionSelect.value)) {
      assetSelect.append(new Option(
        `${asset.file_name} · ${formatBytes(asset.size_bytes)} · ${humanStatus(asset.kind)}`,
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
  byId("rawSceneChangeError").textContent = "";
  rawSceneChangeOperation = null;
  rawSceneChangeDialog.showModal();
}

async function createRawSceneChangeReport(form: FormData): Promise<void> {
  const project = state.selected?.project;
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
      body: JSON.stringify({
        clientOperationId: rawSceneChangeOperation.id,
        ...body,
      }),
    },
  );
  rawSceneChangeOperation = null;
  rawSceneChangeDialog.close();
  showToast(body.registrationMode === "automatic_rigid"
    ? "Automatic registration and raw-scene comparison queued"
    : "Declared-frame raw-scene comparison queued");
  await loadSpatialWorkspace(project.id);
  void pollRawSceneChange(project.id, result.report.id);
}

async function retryRawSceneChange(report: RegisteredSceneChangeReport): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before retrying raw-scene evidence.");
  await api(`/api/projects/${project.id}/spatial/raw-change-reports/${report.id}/retry`, {
    method: "POST",
  });
  showToast("Raw-scene comparison retry queued");
  await loadSpatialWorkspace(project.id);
  void pollRawSceneChange(project.id, report.id);
}

async function pollRawSceneChange(projectId: string, reportId: string): Promise<void> {
  const generation = ++rawSceneChangePollGeneration;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, attempt < 4 ? 1_500 : 5_000));
    if (
      generation !== rawSceneChangePollGeneration ||
      state.selected?.project.id !== projectId ||
      state.view !== "spatial"
    ) return;
    try {
      await loadSpatialWorkspace(projectId);
    } catch {
      continue;
    }
    const report = state.spatial?.rawChangeReports.find((candidate) => candidate.id === reportId);
    if (!report || !["QUEUED", "RUNNING"].includes(report.status)) return;
  }
  if (generation === rawSceneChangePollGeneration && state.selected?.project.id === projectId) {
    showNotice("Raw-scene processing is still running. Refresh later; the queued evidence is retained.", "error");
  }
}

function openRawSceneChangeReview(
  report: RegisteredSceneChangeReport,
  summary: RegisteredSceneChangeSummary,
): void {
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
    ? `Version ${report.baseline_version_number} → ${report.candidate_version_number}: ` +
      "automatic registration did not pass the declared quality gates, so change analysis was not run."
    : `Version ${report.baseline_version_number} → ${report.candidate_version_number}: ` +
      `${summary.summary.addedVoxels} added and ${summary.summary.removedVoxels} removed voxels; ` +
      `${summary.summary.structurallyChangedPercent}% occupancy delta.`;
  byId("rawSceneChangeReviewError").textContent = "";
  rawSceneChangeReviewDialog.showModal();
}

async function reviewRawSceneChangeReport(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project) throw new Error("Open a project before reviewing raw-scene evidence.");
  const reportId = String(form.get("reportId") ?? "");
  await api(`/api/projects/${project.id}/spatial/raw-change-reports/${reportId}`, {
    method: "PATCH",
    body: JSON.stringify({
      decision: String(form.get("decision") ?? ""),
      note: String(form.get("note") ?? "").trim(),
    }),
  });
  rawSceneChangeReviewDialog.close();
  showToast("Raw-scene evidence review recorded");
  await loadSpatialWorkspace(project.id);
}

function renderRawSceneChangeReport(report: RegisteredSceneChangeReport): HTMLElement {
  const card = element("article", "geometry-change-card raw-scene-change-card");
  const header = element("div", "geometry-change-heading");
  const title = element("div");
  title.append(
    element("strong", "", `Version ${report.baseline_version_number} → ${report.candidate_version_number}`),
    element("small", "muted-copy", `${report.baseline_file_name} → ${report.candidate_file_name}`),
  );
  header.append(
    title,
    element("span", `status-pill ${statusClass(report.status)}`, humanStatus(report.status)),
  );
  card.append(header);
  if (report.status === "QUEUED" || report.status === "RUNNING") {
    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = report.job_progress;
    progress.setAttribute("aria-label", "Registered raw-scene processing progress");
    card.append(
      progress,
      element("p", "inline-status", report.job_progress_message ?? "Waiting for a processing worker."),
      element("small", "muted-copy", `Attempt ${report.attempt_count}/${report.max_attempts}`),
    );
    return card;
  }
  if (report.status === "FAILED" || report.status === "DEAD_LETTER") {
    const retry = element("button", "primary-button", "Retry registered comparison");
    retry.addEventListener("click", () => {
      void runAction({
        key: `retry-raw-scene-change:${report.id}`,
        trigger: retry,
        pendingLabel: "Queueing retry…",
      }, () => retryRawSceneChange(report));
    });
    card.append(
      element("p", "form-error", rawSceneChangeError(report)),
      retry,
    );
    return card;
  }
  const summary = parseRegisteredSceneChangeSummary(report.summary_json);
  if (!summary) {
    card.append(element("p", "form-error", "The stored processor report is unreadable. Retry from the failed job if source evidence is available."));
    return card;
  }
  if (summary.registration?.performedByProcessor && summary.registration.summary) {
    const registrationMetrics = element("div", "geometry-change-metrics");
    registrationMetrics.append(
      compactMetric("Registration", humanStatus(summary.registration.status ?? "unknown")),
      compactMetric("Overlap", `${summary.registration.summary.overlapPercent}%`),
      compactMetric("RMSE", `${summary.registration.summary.rmseMm} mm`),
      compactMetric("P95 residual", `${summary.registration.summary.p95ResidualMm} mm`),
      compactMetric(
        "Yaw / translation",
        summary.registration.transform
          ? `${summary.registration.transform.yawDegrees}° · ` +
            `${summary.registration.transform.translationM.map((value) => value.toFixed(3)).join(", ")} m`
          : "Unavailable",
      ),
    );
    card.append(
      element("p", "section-kicker", "AUTOMATIC REGISTRATION EVIDENCE"),
      registrationMetrics,
    );
  }
  if (summary.result !== "registration_blocked") {
    const metrics = element("div", "geometry-change-metrics");
    metrics.append(
      compactMetric("Occupancy delta", `${summary.summary.structurallyChangedPercent}%`),
      compactMetric("Added / removed", `${summary.summary.addedVoxels} / ${summary.summary.removedVoxels}`),
      compactMetric("Common voxels", summary.summary.commonVoxels),
      compactMetric("P95 centroid", summary.summary.p95CentroidDisplacementMm === null
        ? "—"
        : `${summary.summary.p95CentroidDisplacementMm} mm`),
      compactMetric("P95 colour", summary.summary.p95PhotometricDeltaPercent === null
        ? "—"
        : `${summary.summary.p95PhotometricDeltaPercent}%`),
    );
    card.append(metrics);
  }
  if (summary.materialSignals.length) {
    const signals = element("div", "notice-card");
    signals.append(element("strong", "", "Material signals"));
    const list = document.createElement("ul");
    for (const signal of summary.materialSignals) list.append(element("li", "", signal));
    signals.append(list);
    card.append(signals);
  }
  card.append(
    element("p", "field-note", report.registration_evidence),
    element("p", "field-note", summary.limitation),
  );
  if (report.status === "REVIEWED") {
    card.append(element(
      "div",
      "notice-card",
      `${humanStatus(report.review_decision ?? "reviewed")}: ${report.review_note ?? "Review recorded."}`,
    ));
  }
  const actions = element("div", "release-actions");
  const review = element(
    "button",
    report.status === "REVIEWED" ? "quiet-button" : "primary-button",
    report.status === "REVIEWED" ? "Review again" : "Review evidence",
  );
  review.addEventListener("click", () => openRawSceneChangeReview(report, summary));
  const visual = element("button", "quiet-button", "Open rendered versions");
  visual.addEventListener("click", () => {
    const versions = state.selected?.versions.filter((version) =>
      version.id === report.baseline_version_id || version.id === report.candidate_version_id
    ) ?? [];
    openVersionComparison(state.selected!.project.id, versions);
  });
  actions.append(review, visual);
  card.append(actions);
  return card;
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
      // The fallback below remains actionable without exposing malformed state.
    }
  }
  return "The processor could not complete this registered comparison.";
}

function compactMetric(label: string, value: string | number): HTMLElement {
  const item = element("span", "");
  item.append(element("small", "", label), element("strong", "", String(value)));
  return item;
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

function parseGeometryChangeSummary(value: string): GeometryChangeSummary | null {
  try {
    const parsed = JSON.parse(value) as GeometryChangeSummary;
    return parsed?.method === "authored-plan-geometry-diff-v1" ? parsed : null;
  } catch {
    return null;
  }
}

function renderGeometryChangeOverlay(summary: GeometryChangeSummary): HTMLElement {
  const stage = element("div", "geometry-change-visual");
  const bounds = summary.visual.bounds;
  if (!bounds || !summary.visual.overlays.length) {
    stage.append(element("p", "muted-copy", "No comparable footprints are available for an overlay."));
    return stage;
  }
  const width = 480;
  const height = 240;
  const padding = 18;
  const minZ = bounds.minZ ?? bounds.minY;
  const maxZ = bounds.maxZ ?? bounds.maxY;
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    stage.append(element("p", "muted-copy", "The stored overlay bounds are invalid."));
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
  const legend = element("div", "geometry-change-legend");
  legend.append(
    element("span", "from", "From · dashed"),
    element("span", "to", "To · solid"),
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
        `${humanStatus(latestReport.result)} · ${latestReport.point_count} points · RMSE ${latestReport.rmse_mm?.toFixed(1) ?? "—"} mm · max ${latestReport.max_mm?.toFixed(1) ?? "—"} mm`,
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
  if (state.view === "measurement") renderMeasurement();
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
  openProjectsView = true,
): Promise<void> {
  try {
    const detail = await api<ProjectDetail>(`/api/projects/${projectId}`);
    if (state.selected?.project.id !== projectId) {
      state.spatial = null;
      state.spatialProjectId = null;
      state.measurement = null;
      state.measurementProjectId = null;
      state.recoverableUploads = [];
      activeUpload = null;
      pendingUploadOperation = null;
    }
    state.selected = detail;
    renderProjectDetail();
    if (openProjectsView) activateView("projects");
    if (focusWorkspace) {
      const detail = byId("projectDetail");
      detail.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => detail.focus({ preventScroll: true }), 320);
    }
  } catch (error) {
    showNotice(errorMessage(error), "error");
  }
}

async function ensureProjectWorkspace(view: "spatial" | "measurement", force = false): Promise<void> {
  const projectId = state.selected?.project.id;
  if (!projectId) return;
  const cachedProjectId = view === "spatial" ? state.spatialProjectId : state.measurementProjectId;
  if (!force && cachedProjectId === projectId) return;

  const container = byId(view === "spatial" ? "spatialOverview" : "measurementOverview");
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
    if (state.selected?.project.id !== projectId || state.view !== view) return;
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

function renderProjectDetail(): void {
  const detail = state.selected;
  if (!detail) return;
  byId("projectDetail").hidden = false;
  byId("detailTitle").textContent = detail.project.name;
  byId("detailStatus").textContent = humanStatus(detail.project.status);
  const body = byId("detailBody");
  body.replaceChildren();

  const overview = detailCard("Project record");
  overview.append(
    projectFact("Customer", detail.project.customerName ?? "Not assigned"),
    projectFact("Capture adapter", detail.project.captureAdapter),
    projectFact("Delivery", detail.project.deliveryTemplate),
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
  }
  if (detail.versions.length >= 2) {
    const compareButton = element("button", "quiet-button wide", "Compare immutable versions");
    compareButton.addEventListener("click", () => openVersionComparison(detail.project.id, detail.versions));
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

  const controls = detailCard("Release controls");
  const latestVersion = detail.versions[0];
  if (latestVersion?.status === "QA_REQUIRED") {
    const qaButton = element("button", "quiet-button wide", "Run QA approval");
    qaButton.addEventListener("click", () => {
      void runAction({
        key: `open-qa:${detail.project.id}`,
        trigger: qaButton,
        pendingLabel: "Checking evidence…",
      }, openQaDialog);
    });
    controls.append(qaButton);
  }
  if (latestVersion?.status === "APPROVED" || latestVersion?.status === "PUBLISHED") {
    const publishButton = element("button", "primary-button wide", "Publish new release");
    publishButton.addEventListener("click", openReleaseDialog);
    controls.append(publishButton);
  }
  for (const release of detail.releases) {
    const releaseRow = element("div", "release-row");
    const link = document.createElement("a");
    link.href = `/s/${release.slug}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `${release.slug} · ${release.access_policy}${release.is_active ? " · active" : ""}`;
    releaseRow.append(link);
    if (release.is_active) {
      const revoke = element("button", "danger-button", "Revoke");
      revoke.addEventListener("click", () => {
        if (!confirm(`Revoke /s/${release.slug}? Visitors will lose access immediately.`)) return;
        void runAction({
          key: `revoke-release:${release.slug}`,
          trigger: revoke,
          pendingLabel: "Revoking…",
        }, () => revokeRelease(release.slug));
      });
      releaseRow.append(revoke);
    } else if (!release.revoked_at) {
      const rollback = element("button", "quiet-button", "Make active");
      rollback.addEventListener("click", () => {
        if (!confirm(`Make this historical release active at /s/${release.slug}?`)) return;
        void runAction({
          key: `rollback-release:${release.id}`,
          trigger: rollback,
          pendingLabel: "Activating…",
        }, () => rollbackRelease(release));
      });
      releaseRow.append(rollback);
    }
    controls.append(releaseRow);
  }
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
  const spatialButton = element("button", "primary-button wide", "Author spatial experience");
  spatialButton.disabled = !detail.project.latestVersionId;
  spatialButton.addEventListener("click", () => {
    void runAction({
      key: `load-spatial:${detail.project.id}`,
      trigger: spatialButton,
      pendingLabel: "Opening authoring…",
    }, async () => {
      await loadSpatialWorkspace(detail.project.id);
      activateView("spatial");
    });
  });
  const measurementButton = element("button", "quiet-button wide", "Measurement brief & QA");
  measurementButton.disabled = !detail.project.latestVersionId;
  measurementButton.addEventListener("click", () => {
    void runAction({
      key: `load-measurement:${detail.project.id}`,
      trigger: measurementButton,
      pendingLabel: "Opening evidence…",
    }, async () => {
      await loadMeasurementWorkspace(detail.project.id);
      activateView("measurement");
    });
  });
  const domainButton = element("button", "quiet-button wide", "Add custom domain");
  domainButton.addEventListener("click", () => {
    void openDomainDialog();
  });
  controls.append(spatialButton, measurementButton, inviteButton, reviewButton, deliveryButton, domainButton);
  if (!controls.querySelector("button, a")) {
    controls.append(element("p", "muted-copy", "Complete validation and QA before publication."));
  }
  body.append(overview, versions, assets, captureBundles, controls);
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
  metric_point_cloud: "Metric point cloud",
  gaussian_splat: "Gaussian splat",
  collision_mesh: "Collision mesh",
};

function openCaptureBundleDialog(): void {
  const detail = state.selected;
  if (!detail) return;
  const form = byId<HTMLFormElement>("captureBundleForm");
  form.reset();
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
  setFormValue(form, "adapter", detail.project.captureAdapter);
  const defaults = captureAdapterDefaults(detail.project.captureAdapter);
  setFormValue(form, "vendor", defaults.vendor);
  setFormValue(form, "model", defaults.model);
  setFormValue(form, "exporterName", defaults.exporter);
  setFormValue(form, "exportedAt", datetimeLocalValue(new Date()));
  renderCaptureBundleAssets(versionSelect.value);
  renderCaptureBundlePreview();
  captureBundleDialog.showModal();
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
    });
    roles.addEventListener("change", renderCaptureBundlePreview);
    row.append(selected, description, roles);
    container.append(row);
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
  preview.textContent =
    `${assets.length} immutable asset${assets.length === 1 ? "" : "s"} selected. ` +
    (ready.length ? `Evidences ${ready.join(", ")}. ` : "No delivery capability is evidenced yet. ") +
    (independent
      ? "Images, poses, intrinsics, and extrinsics are all represented."
      : "Independent reconstruction remains unproven until images, poses, intrinsics, and extrinsics are all preserved.");
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
  const limitations = String(form.get("limitations") ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (limitations.length > 20) throw new Error("Record no more than 20 known limitations.");
  const body = {
    versionId: String(form.get("versionId") ?? ""),
    schemaVersion: "1.0.0",
    adapter: detail.project.captureAdapter,
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
      units: String(form.get("coordinateUnits") ?? "metres"),
      axisConvention: String(form.get("axisConvention") ?? "right-handed-y-up"),
      epsg: epsgValue ? Number(epsgValue) : null,
      registrationMethod: String(form.get("registrationMethod") ?? "").trim(),
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
      `${validation.summary.independentlyReconstructable ? "independent inputs complete" : "independent inputs incomplete"}`,
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
  return state.selected?.versions.find((version) => version.id === versionId)?.version_number ?? "—";
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
  containerId: "newProjectCustomFields" | "editProjectCustomFields",
  values: Record<string, string | number | boolean>,
): void {
  const container = byId(containerId);
  container.replaceChildren();
  const fields = state.projectFields.filter((field) => field.active);
  if (!fields.length) return;
  container.append(
    element("h3", "", "Organisation metadata"),
    element(
      "p",
      "",
      "These typed fields are governed by the current workspace and validated before saving.",
    ),
  );
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
  setValue("captureAdapter", project.captureAdapter);
  setValue("deliveryTemplate", project.deliveryTemplate);
  setValue("notes", project.notes ?? "");
  renderProjectCustomFieldForm("editProjectCustomFields", project.customFields);
  byId("editProjectError").textContent = "";
  editProjectDialog.showModal();
}

async function updateProject(form: FormData): Promise<void> {
  const project = state.selected?.project;
  if (!project) return;
  try {
    await api(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        customerName: optionalString(form.get("customerName")) ?? null,
        captureAdapter: String(form.get("captureAdapter") ?? "open-import"),
        deliveryTemplate: String(form.get("deliveryTemplate") ?? "Property showcase"),
        notes: optionalString(form.get("notes")) ?? null,
        customFields: projectCustomFieldsFromForm(byId("editProjectCustomFields"), true),
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
  const profile = captureAdapterProfiles.find((candidate) =>
    candidate.id === state.selected?.project.captureAdapter
  );
  const guidance = byId("uploadAdapterGuidance");
  guidance.replaceChildren(
    element("strong", "", profile?.label ?? humanStatus(state.selected.project.captureAdapter)),
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
    state.selected.project.captureAdapter === "phone-video"
      ? "source_video"
      : state.selected.project.captureAdapter === "drone-imagery"
        ? "source_images"
        : "gaussian_splat";
  byId<HTMLSelectElement>("uploadPurpose").value = defaultPurpose;
  syncUploadPurpose(defaultPurpose);
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
  web_scene: "The platform verifies this prebuilt Spark RAD scene and records it directly as a browser-delivery asset.",
  vendor_project: "The original vendor project remains private evidence; it is not treated as a browser scene.",
  raw_capture: "The raw scanner or capture container remains private evidence and requires a later reconstruction output.",
  source_images: "Original imagery is preserved for reproducibility and future reconstruction. A ZIP should retain the source filenames and metadata.",
  source_video: "Original video is preserved for a later reconstruction adapter; uploading it does not create a spatial scene by itself.",
  camera_poses: "Pose evidence is integrity-checked and must still be reviewed for coordinate convention and frame alignment.",
  calibration: "Calibration evidence is preserved without claiming that the camera model or calibration accuracy has been independently verified.",
  imu_trajectory: "The trajectory is preserved as source evidence; semantic validation remains a review task.",
  gnss_trajectory: "GNSS evidence is preserved without inferring RTK fix quality, datum, or survey control.",
  metric_point_cloud: "Metric geometry is stored as a point-cloud asset and does not enter the Gaussian reconstruction lane.",
  collision_mesh: "Collision geometry is preserved separately from appearance and requires spatial-alignment review.",
};

function syncUploadPurpose(purpose: CaptureAssetPurpose): void {
  const formatSelect = byId<HTMLSelectElement>("uploadFormat");
  const formats = captureFormatsForPurpose(purpose);
  const prior = formatSelect.value;
  formatSelect.replaceChildren(...formats.map((format) =>
    new Option(captureFormatLabels[format], format),
  ));
  if (formats.includes(prior as CaptureAssetFormat)) formatSelect.value = prior;
  const fileInput = byId<HTMLInputElement>("uploadAssetInput");
  fileInput.accept = formats.map((format) => `.${format}`).join(",");
  byId("uploadPurposeHelp").textContent = capturePurposeHelp[purpose];
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

async function uploadAsset(form: FormData): Promise<void> {
  if (!state.selected) return;
  const file = form.get("asset");
  if (!(file instanceof File)) return;
  const format = String(form.get("format") ?? "");
  const purpose = String(form.get("purpose") ?? "") as CaptureAssetPurpose;
  const status = byId("uploadStatus");
  const progress = byId<HTMLElement>("uploadProgress");
  const pauseButton = byId<HTMLButtonElement>("pauseUploadButton");
  uploadAbortController = new AbortController();
  pauseButton.hidden = false;
  pauseButton.disabled = false;
  pauseButton.textContent = "Pause upload";
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
        pendingUploadOperation.purpose === purpose;
      if (!operationMatches) {
        pendingUploadOperation = {
          id: crypto.randomUUID(),
          projectId,
          fileName: file.name,
          fileSize: file.size,
          format,
          purpose,
        };
      }
      const operationId = pendingUploadOperation?.id;
      if (!operationId) throw new Error("The upload operation could not be initialised.");
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
        parts: new Map(),
      };
      pendingUploadOperation = null;
    }
    const upload = activeUpload;
    if (!upload) throw new Error("The upload session could not be created.");
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
    status.textContent = "Finalising immutable source…";
    const parts = Array.from(upload.parts, ([partNumber, etag]) => ({ partNumber, etag }))
      .sort((left, right) => left.partNumber - right.partNumber);
    await api(`/api/uploads/${upload.id}/complete`, {
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
    showToast("Source asset ingested");
    window.setTimeout(() => uploadDialog.close(), 900);
    await refreshAll();
  } catch (error) {
    status.textContent = errorMessage(error);
    const prefix = uploadAbortController.signal.aborted
      ? "Upload paused."
      : errorMessage(error);
    byId("uploadError").textContent = `${prefix} Uploaded parts are retained in D1 and R2; reopen this project and choose Resume upload to continue from the first incomplete part.`;
  } finally {
    uploadAbortController = null;
    pauseButton.hidden = true;
    pauseButton.disabled = false;
    pauseButton.textContent = "Pause upload";
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
  for (const asset of state.selected.assets.filter((candidate) =>
    candidate.format === "rad" ||
    candidate.format === "spz" ||
    candidate.format === "sog"
  )) {
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
  try {
    await api(`/api/versions/${version.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        webAssetId: String(form.get("webAssetId") ?? ""),
        visualGrade: String(form.get("visualGrade") ?? "B"),
        measurementGrade: String(form.get("measurementGrade") ?? "visual-only"),
        privacyStatus: "approved",
        notes: optionalString(form.get("notes")),
      }),
    });
    qaDialog.close();
    showToast("Version approved");
    await refreshAll();
  } catch (error) {
    byId("qaError").textContent = errorMessage(error);
  }
}

function openReleaseDialog(): void {
  if (!state.selected) return;
  const form = byId<HTMLFormElement>("releaseForm");
  const slug = form.elements.namedItem("slug");
  const title = form.elements.namedItem("title");
  if (slug instanceof HTMLInputElement) slug.value = state.selected.project.activeReleaseSlug ?? state.selected.project.slug;
  if (title instanceof HTMLInputElement) title.value = state.selected.project.name;
  releaseOperationId = crypto.randomUUID();
  byId("releaseError").textContent = "";
  releaseDialog.showModal();
}

async function publishRelease(form: FormData): Promise<void> {
  if (!state.selected) return;
  releaseOperationId ??= crypto.randomUUID();
  const expiresAtValue = optionalString(form.get("expiresAt"));
  try {
    const result = await api<{ release: { url: string; accessPolicy: string; accessToken: string | null } }>(
      `/api/projects/${state.selected.project.id}/releases`,
      {
        method: "POST",
        body: JSON.stringify({
          clientOperationId: releaseOperationId,
          slug: String(form.get("slug") ?? ""),
          accessPolicy: String(form.get("accessPolicy") ?? "public"),
          expiresAt: expiresAtValue ? new Date(expiresAtValue).toISOString() : null,
          viewerConfig: {
            title: String(form.get("title") ?? state.selected.project.name),
            subtitle: optionalString(form.get("subtitle")),
            captureDate: optionalString(form.get("captureDate")),
            measurementDisclaimer: String(form.get("measurementDisclaimer") ?? ""),
            splatBudgetMillions: 2,
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
    return `${error.message}.${retry}${request}`.replace("..", ".");
  }
  return error instanceof Error ? error.message : String(error);
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
