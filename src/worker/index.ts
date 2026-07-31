import { Hono, type Context } from "hono";
import { Earcut } from "three/src/extras/Earcut.js";
import {
  manualJobCompletionSchema,
  customDomainSchema,
  customDomainVerifySchema,
  hostingSubscriptionSchema,
  manualInvoiceIssueSchema,
  manualInvoiceTransitionSchema,
  manualSubscriptionTransitionSchema,
  organisationSwitchSchema,
  otpRequestSchema,
  otpVerifySchema,
  teamInvitationSchema,
  teamMemberUpdateSchema,
  enterpriseIdentityProviderSchema,
  enterpriseIdentityDiscoverySchema,
  enterpriseIdentityStartSchema,
  projectInputSchema,
  projectBulkLifecycleSchema,
  projectCustomFieldDefinitionSchema,
  projectCustomFieldUpdateSchema,
  projectPortfolioExportSchema,
  projectPortfolioHandoffPreviewSchema,
  projectPortfolioHandoffSchema,
  projectAssetHandoffPreviewSchema,
  projectAssetHandoffSchema,
  projectAssetHandoffRetrySchema,
  projectAssetHandoffCancelSchema,
  captureAgentCredentialSchema,
  captureAgentCredentialUpdateSchema,
  captureAgentCredentialRotateSchema,
  projectPortfolioImportSchema,
  projectPortfolioManifestSchema,
  projectSavedViewSchema,
  projectSavedViewUpdateSchema,
  projectTemplateSchema,
  projectTemplateUpdateSchema,
  projectThemeSchema,
  projectUpdateSchema,
  qaDecisionSchema,
  reviewCommentResolutionSchema,
  reviewCommentSchema,
  reviewDecisionSchema,
  releaseInputSchema,
  reviewerInvitationSchema,
  retentionPolicySchema,
  sceneEntitySchema,
  sceneEntityUpdateSchema,
  navigationObstacleSchema,
  navigationProfileSchema,
  semanticExtractionSchema,
  semanticExtractionReviewSchema,
  floorplanExtractionSchema,
  floorplanExtractionReviewSchema,
  floorplanExportSchema,
  floorplanProposalReportSchema,
  floorplanReviewPlanSchema,
  sceneRouteSchema,
  privacyRegionSchema,
  privacyRegionDecisionSchema,
  privacyScanSchema,
  privacyCandidateDecisionSchema,
  changeDetectionSchema,
  changeDetectionReviewSchema,
  registeredSceneChangeSchema,
  registeredSceneChangeReviewSchema,
  captureCompletenessSchema,
  captureCompletenessReviewSchema,
  captureBundleManifestSchema,
  captureBundleReviewSchema,
  deliveryPolicySchema,
  measurementBriefSchema,
  measurementCheckPointSchema,
  professionalSignoffSchema,
  projectCostSchema,
  telemetrySchema,
  uploadCompleteSchema,
  uploadInputSchema,
  workerJobCompletionSchema,
  workerJobFailureSchema,
  workerSceneChangeCompletionSchema,
  workerSemanticExtractionCompletionSchema,
  workerFloorplanExtractionCompletionSchema,
  workerOutputUploadSchema,
  type AuthContext,
} from "./contracts";
import {
  appendAuthCookies,
  appendExpiredAuthCookies,
  authenticateRequest,
  createAuthSession,
  extractRefreshToken,
  generateOtp,
  otpHash,
  publicJwks,
  revokeSession,
  rotateRefreshSession,
  type AuthSessionRow,
} from "./auth";
import {
  parseRangeHeader,
  parseCookie,
  base64UrlDecode,
  base64UrlEncode,
  safeFileName,
  secureToken,
  sha256Hex,
  signSceneToken,
  slugify,
  timingSafeStringEqual,
  verifySceneToken,
} from "./security";
import {
  computeAuthoredGeometryChange,
  type GeometryEntity,
} from "./geometry-change";
import {
  computeCaptureCompleteness,
  type CaptureRoomEntity,
} from "./capture-completeness";
import {
  validateCaptureBundle,
  type CaptureBundleAssetEvidence,
} from "./capture-bundle";
import {
  planCaptureAssetImport,
  type CaptureAdapterId,
  type CaptureAssetFormat,
  type CaptureAssetPurpose,
} from "../shared/capture-adapters";
import {
  parseWorldUnit,
  PROVISIONAL_MEASUREMENT_DISCLAIMER,
  type WorldUnit,
} from "../shared/world-units";
import {
  CloudflareSaasError,
  createCloudflareCustomHostname,
  deleteCloudflareCustomHostname,
  findCloudflareCustomHostname,
  getCloudflareCustomHostname,
  isCloudflareCustomHostnameReady,
  type CloudflareCustomHostname,
  type CloudflareSaasConfig,
} from "./cloudflare-saas";
import {
  StripeBillingError,
  cancelStripeSubscriptionAtPeriodEnd,
  createStripeCheckoutSession,
  verifyStripeWebhookSignature,
  type StripeBillingConfig,
  type StripePlanCode,
} from "./stripe-billing";
import {
  OidcError,
  buildOidcAuthorizationUrl,
  discoverOidcProvider,
  exchangeOidcCode,
  normalizeOidcIssuer,
  verifyOidcIdToken,
  type OidcMetadata,
} from "./oidc";
import {
  TurnstileVerificationError,
  verifyTurnstileToken,
} from "./turnstile";

type AppEnvironment = {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
};

type ProjectRow = {
  id: string;
  organisation_id: string;
  customer_id: string | null;
  name: string;
  slug: string;
  status: string;
  capture_adapter: string;
  delivery_template: string;
  notes: string | null;
  customer_name: string | null;
  created_at: string;
  updated_at: string;
  latest_version_id: string | null;
  latest_version_number: number | null;
  active_release_slug: string | null;
  archived_from_status: string | null;
};

type ProjectCustomFieldType = "text" | "number" | "boolean" | "date" | "select" | "url";
type ProjectCustomFieldValue = string | number | boolean | null;
type ProjectCustomFieldDefinitionRow = {
  id: string;
  organisation_id: string;
  key: string;
  label: string;
  description: string | null;
  field_type: ProjectCustomFieldType;
  required: number;
  options_json: string;
  active: number;
  sort_order: number;
  client_operation_id: string | null;
  request_hash: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectPortfolioHandoffRow = {
  id: string;
  request_hash: string;
  status: "running" | "completed" | "failed";
  response_json: string | null;
  updated_at: string;
};

type ProjectAssetHandoffStatus =
  | "queued"
  | "copying"
  | "finalizing"
  | "failed"
  | "completed"
  | "cancelled";

type ProjectAssetHandoffRow = {
  id: string;
  source_organisation_id: string;
  target_organisation_id: string;
  actor_user_id: string;
  source_project_id: string;
  target_project_id: string;
  client_operation_id: string;
  request_hash: string;
  source_snapshot_hash: string;
  source_snapshot_json: string;
  status: ProjectAssetHandoffStatus;
  total_versions: number;
  total_assets: number;
  total_bytes: number;
  copied_assets: number;
  copied_bytes: number;
  response_json: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
};

type ProjectAssetHandoffItemRow = {
  id: string;
  handoff_id: string;
  version_mapping_id: string;
  source_asset_id: string;
  target_asset_id: string;
  source_object_key: string;
  target_object_key: string;
  kind: string;
  format: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  source_etag: string | null;
  target_etag: string | null;
  status: "queued" | "copying" | "copied" | "failed" | "cancelled";
  attempt_count: number;
  error_message: string | null;
  copied_at: string | null;
  updated_at: string;
};

type CaptureAgentCredentialRow = {
  id: string;
  organisation_id: string;
  name: string;
  token_hash: string;
  token_generation: number;
  project_ids_json: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  created_by: string;
  client_operation_id: string;
  request_hash: string;
  rotation_operation_id: string | null;
  rotation_request_hash: string | null;
  rotated_at: string | null;
  created_at: string;
  updated_at: string;
};

type CaptureAgentPrincipal = {
  kind: "capture_agent";
  credentialId: string;
  credentialName: string;
  generation: number;
  organisationId: string;
  createdByUserId: string;
  projectIds: string[];
  expiresAt: string;
};

type UploadPrincipal =
  | { kind: "human"; auth: AuthContext }
  | CaptureAgentPrincipal;

type ProjectLifecycleOutcome = {
  project: ProjectRow | null;
  outcome: "changed" | "unchanged" | "blocked" | "not_found";
  message?: string;
};

type ProjectBulkOperationRow = {
  id: string;
  request_hash: string;
  status: "running" | "completed" | "partial" | "failed";
  response_json: string | null;
  updated_at: string;
};

type ProjectTemplateRow = {
  id: string;
  organisation_id: string;
  name: string;
  description: string | null;
  capture_adapter: string;
  delivery_template: string;
  notes: string | null;
  client_operation_id: string | null;
  request_hash: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectSavedViewRow = {
  id: string;
  name: string;
  filter_json: string;
  is_default: number;
  client_operation_id?: string | null;
  request_hash?: string | null;
  created_at: string;
  updated_at: string;
};

type PortfolioImportRow = {
  id: string;
  request_hash: string;
  status: "running" | "completed" | "failed";
  response_json: string | null;
  updated_at: string;
};

type PortfolioManifest = {
  format: "whymelabs.spatial.portfolio";
  schemaVersion: 1 | 2;
  exportedAt?: string;
  fieldDefinitions: Array<{
    key: string;
    label: string;
    description?: string | null;
    type: ProjectCustomFieldType;
    required: boolean;
    options: string[];
    sortOrder: number;
  }>;
  projects: Array<{
    sourceId?: string;
    name: string;
    customerName?: string | null;
    customerEmail?: string | null;
    captureAdapter: CaptureAdapterId;
    deliveryTemplate: string;
    notes?: string | null;
    customFields: Record<string, ProjectCustomFieldValue>;
  }>;
};

type PrivacyScanRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  version_id: string;
  client_operation_id: string;
  request_hash: string;
  detector: string;
  detector_version: string;
  targets_json: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "DEAD_LETTER";
  attempt_count: number;
  max_attempts: number;
  input_count: number;
  candidate_count: number;
  evidence_json: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type PrivacyScanInputRow = AssetRow & {
  scan_id: string;
};

type PrivacyScanQueueMessage = {
  scanId: string;
};

type ProjectAssetCopyQueueMessage = {
  type: "project_asset_copy";
  itemId: string;
};

type SpatialQueueMessage = PrivacyScanQueueMessage | ProjectAssetCopyQueueMessage;

type UploadRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  version_id: string;
  asset_id: string;
  object_key: string;
  r2_upload_id: string;
  file_name: string;
  format: string;
  purpose: CaptureAssetPurpose;
  mime_type: string;
  expected_size_bytes: number;
  part_size_bytes: number;
  sha256: string | null;
  status: string;
  expires_at: string;
  capture_agent_credential_id: string | null;
};

type AssetRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  version_id: string;
  kind: string;
  format: string;
  object_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  etag: string | null;
  sha256: string | null;
  integrity_status: string;
};

type MeasurementDeliverableRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  brief_id: string;
  version_id: string;
  qa_report_id: string;
  asset_id: string;
  deliverable_type: "floor_plan_dxf" | "scan_to_cad_dxf";
  source_geometry_hash: string;
  generator_version: string;
  status: "ready" | "superseded";
  created_at: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
};

type JobLeaseRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  version_id: string;
  input_asset_id: string;
  job_type: string;
  processor_version: string;
  attempt_count: number;
  lease_expires_at: string;
  input_file_name: string;
  input_format: string;
  input_purpose: CaptureAssetPurpose | null;
  input_mime_type: string;
  input_size_bytes: number;
  input_sha256: string | null;
  input_object_key: string;
  version_provenance_json: string;
  change_report_id: string | null;
  change_config_json: string | null;
  secondary_input_asset_id: string | null;
  secondary_input_file_name: string | null;
  secondary_input_format: string | null;
  secondary_input_mime_type: string | null;
  secondary_input_size_bytes: number | null;
  secondary_input_sha256: string | null;
  secondary_input_object_key: string | null;
  semantic_extraction_id: string | null;
  semantic_config_json: string | null;
  floorplan_extraction_id: string | null;
  floorplan_config_json: string | null;
};

type SemanticExtractionRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  version_id: string;
  input_asset_id: string;
  job_id: string;
  method:
    | "registered-ply-walkable-candidates-v1"
    | "registered-ply-walkable-candidates-v2";
  status: "QUEUED" | "PROCESSING" | "READY_FOR_REVIEW" | "REVIEWED" | "FAILED";
  parameters_json: string;
  summary_json: string | null;
  report_asset_id: string | null;
  candidate_count: number;
  client_operation_id: string;
  request_hash: string;
  created_by: string;
  reviewed_by: string | null;
  review_decision: "accept_selected" | "reject_all" | null;
  review_note: string | null;
  review_client_operation_id: string | null;
  review_request_hash: string | null;
  review_response_json: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type FloorplanExtractionRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  version_id: string;
  input_asset_id: string;
  job_id: string;
  method: "metric-pointcloud-floorplan-v1";
  normalizer: string;
  status: "QUEUED" | "PROCESSING" | "READY_FOR_REVIEW" | "REVIEWED" | "REJECTED" | "FAILED" | "CANCELLED";
  parameters_json: string;
  source_evidence_json: string;
  proposal_json: string | null;
  proposal_hash: string | null;
  report_asset_id: string | null;
  client_operation_id: string;
  request_hash: string;
  created_by: string;
  reviewed_by: string | null;
  review_decision: "approve" | "reject" | null;
  review_note: string | null;
  review_client_operation_id: string | null;
  review_request_hash: string | null;
  review_response_json: string | null;
  reviewed_at: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
};

type FloorplanRevisionRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  version_id: string;
  extraction_id: string;
  revision_number: number;
  measurement_class: "indicative";
  status: "approved" | "superseded";
  plan_json: string;
  plan_hash: string;
  source_proposal_hash: string;
  review_note: string;
  created_by: string;
  approved_at: string;
  created_at: string;
};

type FloorplanExportRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  version_id: string;
  revision_id: string;
  batch_id: string;
  asset_id: string;
  format: "svg" | "pdf" | "dxf";
  generator_version: string;
  plan_hash: string;
  status: "ready" | "superseded";
  created_by: string;
  created_at: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
};

type RegisteredSceneChangeRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  baseline_version_id: string;
  candidate_version_id: string;
  baseline_asset_id: string;
  candidate_asset_id: string;
  job_id: string;
  client_operation_id: string;
  request_hash: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "DEAD_LETTER" | "REVIEWED";
  coordinate_assurance: "shared_local_frame" | "registered_project_frame";
  registration_evidence: string;
  registration_mode: "declared" | "automatic_rigid";
  registration_search_radius_m: number;
  registration_maximum_rmse_mm: number;
  registration_minimum_overlap_percent: number;
  registration_status: "accepted" | "blocked" | null;
  registration_summary_json: string | null;
  voxel_size_m: number;
  structural_threshold_percent: number;
  photometric_threshold_percent: number;
  centroid_threshold_mm: number;
  maximum_sample_points: number;
  report_asset_id: string | null;
  result: "changes_detected" | "no_material_change" | null;
  summary_json: string | null;
  error_json: string | null;
  review_decision: "accepted" | "needs_recapture" | "investigate" | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type CaptureBundleRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  version_id: string;
  adapter: string;
  adapter_v2: string | null;
  schema_version: "1.0.0";
  status: "ready" | "reviewed";
  result: "ready" | "ready_with_warnings" | "blocked";
  client_operation_id: string;
  request_hash: string;
  manifest_asset_id: string;
  manifest_hash: string;
  canonical_manifest_json: string;
  validation_json: string;
  review_decision: "accepted" | "needs_vendor_evidence" | "rejected" | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type JobOutputUploadRow = {
  id: string;
  job_id: string;
  organisation_id: string;
  project_id: string;
  version_id: string;
  kind: string;
  format: string;
  object_key: string;
  file_name: string;
  mime_type: string;
  expected_size_bytes: number;
  sha256: string | null;
  r2_upload_id: string;
  status: string;
  expires_at: string;
};

type ReleaseRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  version_id: string;
  web_asset_id: string;
  poster_asset_id: string | null;
  access_policy: string;
  access_token_hash: string | null;
  viewer_config_json: string;
  spatial_snapshot_json: string | null;
  published_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  slug: string;
  project_name: string;
  capture_adapter: string;
  source_provenance_json: string;
};

type CustomDomainRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  hostname: string;
  status: "pending" | "active" | "failed" | "removed";
  verification_token_hash: string;
  last_error: string | null;
  created_at: string;
  verified_at: string | null;
  removed_at: string | null;
  dns_verified_at: string | null;
  provider: string | null;
  provider_hostname_id: string | null;
  provider_status: string | null;
  provider_ssl_status: string | null;
  provider_validation_json: string | null;
  provisioning_attempts: number;
  last_checked_at: string | null;
  provisioned_at: string | null;
};

type BillingCheckoutRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  plan_code: string;
  status: "pending" | "open" | "complete" | "expired" | "failed" | "cancelled";
  amount_cents: number;
  currency: string;
  customer_email: string;
  archive_on_expiry: number;
  payment_provider: string;
  provider_checkout_id: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  checkout_url: string | null;
  payment_status: string | null;
  request_hash: string;
  client_operation_id: string;
  last_error: string | null;
  expires_at: string | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ManualBillingOperationRow = {
  request_hash: string;
  invoice_id: string | null;
  subscription_id: string | null;
};

type ManualInvoiceRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  subscription_id: string;
  status: "draft" | "open" | "paid" | "void";
  currency: string;
  amount_cents: number;
  period_start: string;
  period_end: string;
  due_at: string;
  paid_at: string | null;
  billing_method: "manual";
  external_reference: string | null;
  payment_reference: string | null;
  note: string | null;
};

type ManualSubscriptionRow = {
  id: string;
  organisation_id: string;
  project_id: string;
  plan_code: string;
  status: "trial" | "active" | "past_due" | "cancelled" | "expired";
  current_period_start: string;
  current_period_end: string;
  billing_note: string | null;
};

type EnterpriseIdentityProviderRow = {
  id: string;
  organisation_id: string;
  name: string;
  issuer: string;
  client_id: string;
  email_domains_json: string;
  status: "draft" | "active" | "disabled";
  discovery_json: string | null;
  discovery_checked_at: string | null;
  last_error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

const app = new Hono<AppEnvironment>();
const maximumPartBytes = 95 * 1024 * 1024;
const captureUploadPartBytes = 10 * 1024 * 1024;
const maximumPrivacyImageBytes = 10 * 1024 * 1024;
const privacyDetector = "@cf/moondream/moondream3.1-9B-A2B";
const privacyDetectorVersion = "moondream3.1-9B-A2B:2026-07";
const workerJobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const privacyTargets = [
  { target: "human face", label: "Human face" },
  { target: "vehicle license plate", label: "Vehicle license plate" },
  { target: "document showing personal information", label: "Personal document" },
  { target: "screen displaying readable personal or confidential information", label: "Sensitive screen" },
  { target: "security keypad or written access code", label: "Access credential" },
  { target: "personal photograph containing a person", label: "Personal photograph" },
] as const;
const allowedWebFormats = new Set(["rad", "spz", "sog"]);
const workerOutputFormats = new Map<string, Set<string>>([
  ["master", new Set(["ply", "rad"])],
  ["web", allowedWebFormats],
  ["portable", new Set(["ply", "spz", "sog"])],
  ["poster", new Set(["webp", "png", "jpg", "jpeg"])],
  ["pointcloud", new Set(["e57", "las", "laz", "ply"])],
  ["collision", new Set(["glb"])],
  ["navmesh", new Set(["bin"])],
  ["report", new Set(["json"])],
]);

app.use("*", async (context, next) => {
  const requestId = context.req.header("CF-Ray") ?? crypto.randomUUID();
  const startedAt = Date.now();
  context.set("requestId", requestId);
  try {
    await next();
  } finally {
    context.header("X-Request-Id", requestId);
    applySecurityHeaders(context);
    console.log(JSON.stringify({
      event: "request.completed",
      requestId,
      method: context.req.method,
      path: context.req.path,
      status: context.res.status,
      durationMs: Date.now() - startedAt,
      environment: context.env.APP_ENV,
    }));
  }
});

app.onError((error, context) => {
  console.error(JSON.stringify({
    event: "request.failed",
    requestId: context.get("requestId"),
    path: context.req.path,
    error: error.message,
    stack: error.stack,
  }));
  return context.json({ error: "Internal server error", requestId: context.get("requestId") }, 500);
});

app.notFound((context) => context.json({ error: "Not found", requestId: context.get("requestId") }, 404));

app.get("/api/health", async (context) => {
  const database = await context.env.DB.prepare("SELECT 1 AS ready").first<{ ready: number }>();
  return context.json({
    status: database?.ready === 1 ? "ok" : "degraded",
    environment: context.env.APP_ENV,
    timestamp: new Date().toISOString(),
    requestId: context.get("requestId"),
  }, database?.ready === 1 ? 200 : 503);
});

for (const path of [
  "/studio.html",
  "/index.html",
  "/404.html",
  "/assets/*",
  "/images/*",
  "/renderer/*",
  "/playcanvas-renderer/*",
]) {
  app.get(path, (context) => serveStaticEntry(context, context.req.path));
}

app.use("/api/auth/*", async (context, next) => {
  await next();
  context.header("Cache-Control", "private, no-store");
});

app.get("/api/auth/config", (context) => {
  return context.json({
    turnstileSiteKey: context.env.TURNSTILE_SITE_KEY,
    turnstileAction: "otp_request",
  });
});

app.post("/api/auth/otp/request", async (context) => {
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const clientAddress = context.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await allowRate(context.env.DB, "otp-ip", clientAddress, 8, 600))) return tooManyRequests(context);
  const parsed = otpRequestSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const email = parsed.data.email;
  const emailSubject = await sha256Hex(email);
  try {
    const turnstileTestMode =
      context.env.APP_ENV !== "production" &&
      context.env.TURNSTILE_SITE_KEY === "1x00000000000000000000AA";
    await verifyTurnstileToken({
      secretKey: context.env.TURNSTILE_SECRET_KEY,
      token: parsed.data.turnstileToken,
      remoteIp: clientAddress === "unknown" ? null : clientAddress,
      expectedHostname: turnstileTestMode
        ? "localhost"
        : new URL(context.env.APP_ORIGIN).hostname,
      expectedAction: turnstileTestMode ? "test" : "otp_request",
      testMode: turnstileTestMode,
    });
  } catch (error) {
    const verificationError = error instanceof TurnstileVerificationError
      ? error
      : new TurnstileVerificationError(
        "Turnstile verification did not complete",
        "unavailable",
        true,
      );
    await authSecurityEvent(
      context,
      verificationError.code === "rejected"
        ? "otp.turnstile_rejected"
        : "otp.turnstile_unavailable",
      emailSubject,
      null,
      null,
    );
    console.warn(JSON.stringify({
      event: "auth.turnstile_verification_failed",
      requestId: context.get("requestId"),
      code: verificationError.code,
      retryable: verificationError.retryable,
      providerCodes: verificationError.providerCodes,
    }));
    if (verificationError.code === "rejected") {
      return context.json({
        error: "Security check expired or failed. Complete it again.",
        code: "turnstile_rejected",
        retryable: true,
        requestId: context.get("requestId"),
      }, 403);
    }
    return context.json({
      error: "Security verification is temporarily unavailable. Retry with a new check.",
      code: "turnstile_unavailable",
      retryable: true,
      requestId: context.get("requestId"),
    }, 503);
  }
  if (!(await allowRate(context.env.DB, "otp-email", emailSubject, 5, 900))) return tooManyRequests(context);

  let challengeId = crypto.randomUUID();
  const ttlSeconds = positiveInteger(context.env.OTP_TTL_SECONDS, 600);
  const retryAfterSeconds = positiveInteger(context.env.OTP_RESEND_SECONDS, 60);
  const genericResponse = () => context.json({
    challengeId,
    expiresInSeconds: ttlSeconds,
    retryAfterSeconds,
    message: "If this email can access Spatial Studio, a one-time code has been sent.",
  }, 202);
  const cooldownKey = `otp:cooldown:${emailSubject}`;
  const cooldownChallenge = await context.env.AUTH_CACHE.get(cooldownKey);
  if (cooldownChallenge) {
    challengeId = cooldownChallenge;
    return genericResponse();
  }

  const code = generateOtp();
  const codeHash = await otpHash(challengeId, email, code, context.env.OTP_PEPPER);
  await context.env.DB.prepare(`
    INSERT INTO auth_otp_challenges
      (id, email, code_hash, expires_at, requested_ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    challengeId,
    email,
    codeHash,
    new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    clientAddress,
    context.req.header("User-Agent")?.slice(0, 512) ?? null,
  ).run();

  const authorised = email === context.env.ADMIN_EMAIL.toLowerCase() ||
    Boolean(await context.env.DB.prepare(`
      SELECT u.id FROM users u
      WHERE lower(u.email) = ? AND (
        EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.user_id = u.id AND m.revoked_at IS NULL AND m.status = 'active'
        )
        OR EXISTS (
          SELECT 1 FROM organisation_invitations oi
          WHERE lower(oi.email) = lower(u.email) AND oi.status = 'pending'
            AND oi.expires_at > ?
        )
      ) LIMIT 1
    `).bind(email, new Date().toISOString()).first<{ id: string }>());
  if (authorised) {
    await context.env.AUTH_CACHE.put(cooldownKey, challengeId, { expirationTtl: retryAfterSeconds });
    try {
      await sendOtpEmail(context.env, email, code, ttlSeconds);
      await authSecurityEvent(context, "otp.sent", emailSubject, null, null);
    } catch (error) {
      console.error(JSON.stringify({
        event: "auth.otp_email_failed",
        requestId: context.get("requestId"),
        challengeId,
        error: error instanceof Error ? error.message : String(error),
      }));
      await context.env.DB.prepare(
        "UPDATE auth_otp_challenges SET consumed_at = datetime('now') WHERE id = ?",
      ).bind(challengeId).run();
      await authSecurityEvent(context, "otp.delivery_failed", emailSubject, null, null);
    }
  } else {
    await authSecurityEvent(context, "otp.unknown_email", emailSubject, null, null);
  }
  return genericResponse();
});

app.post("/api/auth/otp/verify", async (context) => {
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const clientAddress = context.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await allowRate(context.env.DB, "otp-verify-ip", clientAddress, 20, 600))) return tooManyRequests(context);
  const parsed = otpVerifySchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const { challengeId, email, code } = parsed.data;
  const codeHash = await otpHash(challengeId, email, code, context.env.OTP_PEPPER);
  const consumed = await context.env.DB.prepare(`
    UPDATE auth_otp_challenges
    SET consumed_at = datetime('now')
    WHERE id = ? AND email = ? AND code_hash = ?
      AND consumed_at IS NULL AND expires_at > ?
      AND attempt_count < max_attempts
    RETURNING id
  `).bind(challengeId, email, codeHash, new Date().toISOString()).first<{ id: string }>();
  if (!consumed) {
    await context.env.DB.prepare(`
      UPDATE auth_otp_challenges SET attempt_count = attempt_count + 1
      WHERE id = ? AND email = ? AND consumed_at IS NULL AND expires_at > ?
        AND attempt_count < max_attempts
    `).bind(challengeId, email, new Date().toISOString()).run();
    await authSecurityEvent(context, "otp.rejected", await sha256Hex(email), null, null);
    return unauthorized(context, "Invalid or expired one-time code");
  }

  let auth = email === context.env.ADMIN_EMAIL.toLowerCase()
    ? await provisionAdministrator(context.env, email)
    : null;
  await acceptPendingOrganisationInvitations(context.env.DB, email);
  auth ??= await memberForEmail(context.env.DB, email);
  if (!auth) {
    await authSecurityEvent(context, "otp.no_membership", await sha256Hex(email), null, null);
    return unauthorized(context, "This account is not authorised");
  }
  await acceptPendingProjectInvitations(context.env.DB, auth);
  const tokens = await createAuthSession(context.env, auth, context.req.raw);
  const response = context.json({ user: auth, accessExpiresAt: tokens.accessExpiresAt });
  appendAuthCookies(response.headers, tokens);
  const sessionId = tokens.refreshToken.slice(0, tokens.refreshToken.indexOf("."));
  await audit(context, auth, "auth.login", "auth_session", sessionId);
  await authSecurityEvent(context, "auth.login", await sha256Hex(email), auth.userId, sessionId);
  return response;
});

app.post("/api/auth/oidc/discover", async (context) => {
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const clientAddress = context.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await allowRate(context.env.DB, "oidc-discover-ip", clientAddress, 20, 600))) {
    return tooManyRequests(context);
  }
  const parsed = enterpriseIdentityDiscoverySchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const emailHash = await sha256Hex(parsed.data.email);
  if (!(await allowRate(context.env.DB, "oidc-discover-email", emailHash, 12, 900))) {
    return tooManyRequests(context);
  }
  const domain = emailDomain(parsed.data.email);
  const secrets = oidcClientSecrets(context.env);
  const providers = await context.env.DB.prepare(`
    SELECT * FROM enterprise_identity_providers
    WHERE status = 'active'
    ORDER BY lower(name), id
  `).all<EnterpriseIdentityProviderRow>();
  const matches = providers.results
    .filter((provider) =>
      Boolean(secrets[provider.id]) &&
      identityProviderDomains(provider).includes(domain)
    )
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
    }));
  await authSecurityEvent(context, "oidc.discovery", emailHash, null, null, {
    matched: matches.length > 0,
  });
  return context.json({ providers: matches });
});

app.post("/api/auth/oidc/:providerId/start", async (context) => {
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const clientAddress = context.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await allowRate(context.env.DB, "oidc-start-ip", clientAddress, 12, 600))) {
    return tooManyRequests(context);
  }
  const parsed = enterpriseIdentityStartSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const provider = await context.env.DB.prepare(`
    SELECT * FROM enterprise_identity_providers
    WHERE id = ? AND status = 'active'
  `).bind(context.req.param("providerId")).first<EnterpriseIdentityProviderRow>();
  const domain = emailDomain(parsed.data.email);
  const emailHash = await sha256Hex(parsed.data.email);
  const clientSecret = provider ? oidcClientSecrets(context.env)[provider.id] : null;
  if (
    !provider ||
    !clientSecret ||
    !identityProviderDomains(provider).includes(domain)
  ) {
    await authSecurityEvent(context, "oidc.start_rejected", emailHash, null, null);
    return notFound(context, "Enterprise sign-in is not available for this account");
  }
  if (!(await allowRate(context.env.DB, "oidc-start-email", emailHash, 8, 900))) {
    return tooManyRequests(context);
  }

  let metadata: OidcMetadata;
  try {
    metadata = await discoverOidcProvider(provider.issuer);
  } catch (error) {
    const oidcError = asOidcError(error);
    await recordIdentityProviderError(context.env.DB, provider.id, oidcError);
    await authSecurityEvent(context, "oidc.provider_unavailable", emailHash, null, null, {
      providerId: provider.id,
      code: oidcError.code,
    });
    return context.json({
      error: "Enterprise identity provider is temporarily unavailable",
      retryable: oidcError.retryable,
      requestId: context.get("requestId"),
    }, 502);
  }

  const state = secureToken(32);
  const nonce = secureToken(32);
  const codeVerifier = secureToken(64);
  const [stateHash, nonceHash, sealedNonce, sealedCodeVerifier] = await Promise.all([
    sha256Hex(state),
    sha256Hex(nonce),
    sealOidcAttemptSecret(context.env, nonce),
    sealOidcAttemptSecret(context.env, codeVerifier),
  ]);
  const callbackUrl = oidcCallbackUrl(context.env, provider.id);
  const authorization = await buildOidcAuthorizationUrl(metadata, {
    clientId: provider.client_id,
    redirectUri: callbackUrl,
    state,
    nonce,
    codeVerifier,
  });
  const attemptId = crypto.randomUUID();
  const expiresInSeconds = 600;
  await context.env.DB.prepare(`
    INSERT INTO oidc_login_attempts
      (id, provider_id, state_hash, nonce_hash, nonce_ciphertext,
        code_verifier_ciphertext, requested_email_hash, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    attemptId,
    provider.id,
    stateHash,
    nonceHash,
    sealedNonce,
    sealedCodeVerifier,
    emailHash,
    new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  ).run();
  await context.env.DB.prepare(`
    UPDATE enterprise_identity_providers
    SET discovery_json = ?, discovery_checked_at = datetime('now'),
      last_error = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).bind(JSON.stringify(metadata), provider.id).run();
  await authSecurityEvent(context, "oidc.start", emailHash, null, null, {
    providerId: provider.id,
    attemptId,
  });
  const response = context.json({
    authorizationUrl: authorization.url,
    expiresInSeconds,
  }, 201);
  response.headers.append("Set-Cookie", oidcStateCookie(stateHash, expiresInSeconds));
  return response;
});

app.get("/api/auth/oidc/:providerId/callback", async (context) => {
  const providerId = context.req.param("providerId");
  const state = context.req.query("state") ?? "";
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(state)) {
    return oidcFailureRedirect(context, "state_invalid");
  }
  const stateHash = await sha256Hex(state);
  const boundStateHash = parseCookie(context.req.header("Cookie"), "spatial_oidc_state");
  if (
    !boundStateHash ||
    !(await timingSafeStringEqual(boundStateHash, stateHash))
  ) {
    return oidcFailureRedirect(context, "state_mismatch");
  }
  const attempt = await context.env.DB.prepare(`
    SELECT a.id, a.provider_id AS providerId, a.nonce_hash AS nonceHash,
      a.nonce_ciphertext AS nonceCiphertext,
      a.code_verifier_ciphertext AS codeVerifierCiphertext,
      a.requested_email_hash AS requestedEmailHash,
      a.expires_at AS expiresAt, a.consumed_at AS consumedAt,
      p.organisation_id AS organisationId, p.name AS providerName,
      p.issuer, p.client_id AS clientId, p.email_domains_json AS emailDomainsJson,
      p.status
    FROM oidc_login_attempts a
    JOIN enterprise_identity_providers p ON p.id = a.provider_id
    WHERE a.state_hash = ? AND a.provider_id = ?
  `).bind(stateHash, providerId).first<{
    id: string;
    providerId: string;
    nonceHash: string;
    nonceCiphertext: string;
    codeVerifierCiphertext: string;
    requestedEmailHash: string;
    expiresAt: string;
    consumedAt: string | null;
    organisationId: string;
    providerName: string;
    issuer: string;
    clientId: string;
    emailDomainsJson: string;
    status: string;
  }>();
  if (
    !attempt ||
    attempt.consumedAt ||
    Date.parse(attempt.expiresAt) <= Date.now() ||
    attempt.status !== "active"
  ) {
    return oidcFailureRedirect(context, "attempt_invalid");
  }
  const consumed = await context.env.DB.prepare(`
    UPDATE oidc_login_attempts
    SET consumed_at = datetime('now')
    WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
    RETURNING id
  `).bind(attempt.id, new Date().toISOString()).first<{ id: string }>();
  if (!consumed) return oidcFailureRedirect(context, "attempt_invalid");

  const providerError = context.req.query("error");
  if (providerError) {
    await recordOidcAttemptError(context.env.DB, attempt.id, "provider_denied");
    await authSecurityEvent(context, "oidc.provider_denied", attempt.requestedEmailHash, null, null, {
      providerId,
    });
    return oidcFailureRedirect(context, "provider_denied");
  }
  const code = context.req.query("code") ?? "";
  if (!code || code.length > 4096) {
    await recordOidcAttemptError(context.env.DB, attempt.id, "code_missing");
    return oidcFailureRedirect(context, "code_missing");
  }
  const clientSecret = oidcClientSecrets(context.env)[providerId];
  if (!clientSecret) {
    await recordOidcAttemptError(context.env.DB, attempt.id, "provider_configuration");
    return oidcFailureRedirect(context, "provider_configuration");
  }

  try {
    const [nonce, codeVerifier] = await Promise.all([
      openOidcAttemptSecret(context.env, attempt.nonceCiphertext),
      openOidcAttemptSecret(context.env, attempt.codeVerifierCiphertext),
    ]);
    if (!(await timingSafeStringEqual(await sha256Hex(nonce), attempt.nonceHash))) {
      throw new OidcError("OIDC attempt nonce was not preserved", "attempt_integrity", false);
    }
    const metadata = await discoverOidcProvider(attempt.issuer);
    const tokens = await exchangeOidcCode(metadata, {
      clientId: attempt.clientId,
      clientSecret,
      redirectUri: oidcCallbackUrl(context.env, providerId),
      code,
      codeVerifier,
    });
    const identity = await verifyOidcIdToken(tokens.idToken, metadata, {
      clientId: attempt.clientId,
      expectedNonce: nonce,
    });
    if (!identity.emailVerified) {
      throw new OidcError("Enterprise identity email is not verified", "email_unverified", false);
    }
    const domains = parseIdentityDomains(attempt.emailDomainsJson);
    if (!domains.includes(emailDomain(identity.email))) {
      throw new OidcError("Enterprise identity email domain is not allowed", "email_domain", false);
    }
    const identityEmailHash = await sha256Hex(identity.email);
    if (!(await timingSafeStringEqual(identityEmailHash, attempt.requestedEmailHash))) {
      throw new OidcError("Enterprise identity does not match the requested account", "email_mismatch", false);
    }

    let auth = await linkedEnterpriseIdentity(
      context.env.DB,
      providerId,
      identity.subject,
      attempt.organisationId,
    );
    if (!auth) {
      await acceptPendingOrganisationInvitationForOrganisation(
        context.env.DB,
        attempt.organisationId,
        identity.email,
      );
      auth = await memberForEmailInOrganisation(
        context.env.DB,
        attempt.organisationId,
        identity.email,
      );
      if (!auth) {
        throw new OidcError("Enterprise account has not been invited", "account_not_invited", false);
      }
      const existingUserLink = await context.env.DB.prepare(`
        SELECT subject FROM enterprise_identity_links
        WHERE provider_id = ? AND user_id = ?
      `).bind(providerId, auth.userId).first<{ subject: string }>();
      if (existingUserLink && existingUserLink.subject !== identity.subject) {
        throw new OidcError("Enterprise account is already linked", "account_link_conflict", false);
      }
      await context.env.DB.prepare(`
        INSERT INTO enterprise_identity_links
          (provider_id, subject, organisation_id, user_id, email_at_link)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(provider_id, subject) DO UPDATE SET
          last_login_at = datetime('now')
      `).bind(
        providerId,
        identity.subject,
        attempt.organisationId,
        auth.userId,
        identity.email,
      ).run();
    } else {
      await context.env.DB.prepare(`
        UPDATE enterprise_identity_links
        SET last_login_at = datetime('now')
        WHERE provider_id = ? AND subject = ?
      `).bind(providerId, identity.subject).run();
    }
    await acceptPendingProjectInvitations(context.env.DB, auth);
    const sessionTokens = await createAuthSession(
      context.env,
      auth,
      context.req.raw,
      { authMethod: "oidc", identityProviderId: providerId },
    );
    const sessionId = sessionTokens.refreshToken.slice(0, sessionTokens.refreshToken.indexOf("."));
    await audit(context, auth, "auth.oidc_login", "auth_session", sessionId, {
      providerId,
      providerName: attempt.providerName,
    });
    await authSecurityEvent(context, "auth.oidc_login", identityEmailHash, auth.userId, sessionId, {
      providerId,
    });
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: `${context.env.APP_ORIGIN}/studio.html?sso=success`,
        "Cache-Control": "no-store",
      },
    });
    appendAuthCookies(response.headers, sessionTokens);
    response.headers.append("Set-Cookie", expiredOidcStateCookie());
    return response;
  } catch (error) {
    const oidcError = asOidcError(error);
    await recordOidcAttemptError(context.env.DB, attempt.id, oidcError.code);
    await authSecurityEvent(context, "oidc.login_failed", attempt.requestedEmailHash, null, null, {
      providerId,
      code: oidcError.code,
      retryable: oidcError.retryable,
    });
    return oidcFailureRedirect(context, oidcError.code);
  }
});

app.post("/api/auth/refresh", async (context) => {
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  if (!extractRefreshToken(context.req.raw)) return context.body(null, 204);
  const result = await rotateRefreshSession(context.env, context.req.raw);
  if (!result) {
    const response = unauthorized(context, "Refresh session is invalid or expired");
    appendExpiredAuthCookies(response.headers);
    return response;
  }
  const response = context.json({ user: result.auth, accessExpiresAt: result.tokens.accessExpiresAt });
  appendAuthCookies(response.headers, result.tokens);
  return response;
});

app.get("/.well-known/jwks.json", (context) => {
  context.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  return context.json(publicJwks(context.env.JWT_KEYRING));
});

app.get("/.well-known/openid-configuration", (context) => {
  context.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  return context.json({
    issuer: context.env.JWT_ISSUER,
    jwks_uri: `${context.env.APP_ORIGIN}/.well-known/jwks.json`,
    token_endpoint: `${context.env.APP_ORIGIN}/api/auth/refresh`,
    claims_supported: ["iss", "aud", "sub", "sid", "jti", "iat", "nbf", "exp", "organisationId", "role", "email"],
    id_token_signing_alg_values_supported: ["ES256"],
  });
});

app.post("/api/auth/session", (context) => {
  return context.json({ error: "Bootstrap-token login has been retired. Request an email one-time code." }, 410);
});

app.get("/api/auth/session", async (context) => {
  const auth = await authenticate(context);
  if (!auth) return context.json({ authenticated: false });
  return context.json({ authenticated: true, user: publicAuthContext(auth) });
});

app.get("/api/auth/organisations", async (context) => {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const organisations = await context.env.DB.prepare(`
    SELECT o.id, o.name, o.slug, m.role, m.updated_at AS membershipUpdatedAt
    FROM memberships m
    JOIN organisations o ON o.id = m.organisation_id
    WHERE m.user_id = ? AND m.status = 'active' AND m.revoked_at IS NULL
    ORDER BY CASE WHEN o.id = ? THEN 0 ELSE 1 END, lower(o.name), o.id
  `).bind(auth.userId, auth.organisationId).all<{
    id: string;
    name: string;
    slug: string;
    role: AuthContext["role"];
    membershipUpdatedAt: string | null;
  }>();
  return context.json({
    currentOrganisationId: auth.organisationId,
    organisations: organisations.results.map((organisation) => ({
      ...organisation,
      current: organisation.id === auth.organisationId,
    })),
  });
});

app.post("/api/auth/organisations/switch", async (context) => {
  const auth = await authenticate(context);
  if (!auth) return unauthorized(context, "Sign in required");
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  if (auth.authMethod === "oidc") {
    return forbidden(context, "Enterprise SSO sessions are restricted to their configured organisation");
  }
  const parsed = organisationSwitchSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const organisation = await context.env.DB.prepare(`
    SELECT o.id, o.name, o.slug, m.role
    FROM memberships m
    JOIN organisations o ON o.id = m.organisation_id
    WHERE m.user_id = ? AND m.organisation_id = ?
      AND m.status = 'active' AND m.revoked_at IS NULL
  `).bind(auth.userId, parsed.data.organisationId).first<{
    id: string;
    name: string;
    slug: string;
    role: AuthContext["role"];
  }>();
  if (!organisation) return forbidden(context, "You do not have an active membership in this organisation");
  if (organisation.id === auth.organisationId) {
    return context.json({
      user: publicAuthContext(auth),
      organisation,
      idempotent: true,
    });
  }

  const nextAuth: AuthContext = {
    userId: auth.userId,
    organisationId: organisation.id,
    email: auth.email,
    displayName: auth.displayName,
    role: organisation.role,
  };
  await acceptPendingProjectInvitations(context.env.DB, nextAuth);
  const tokens = await createAuthSession(context.env, nextAuth, context.req.raw);
  const nextSessionId = tokens.refreshToken.slice(0, tokens.refreshToken.indexOf("."));
  await audit(context, nextAuth, "auth.organisation_switch", "auth_session", nextSessionId, {
    fromOrganisationId: auth.organisationId,
    previousSessionId: auth.sessionId,
  });
  await authSecurityEvent(
    context,
    "auth.organisation_switch",
    await sha256Hex(auth.email),
    auth.userId,
    nextSessionId,
    { fromOrganisationId: auth.organisationId, toOrganisationId: organisation.id },
  );
  await revokeSession(context.env.DB, auth.sessionId, "organisation_switch");
  const response = context.json({
    user: nextAuth,
    organisation,
    accessExpiresAt: tokens.accessExpiresAt,
  });
  appendAuthCookies(response.headers, tokens);
  return response;
});

app.delete("/api/auth/session", async (context) => {
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const auth = await authenticate(context);
  const refresh = extractRefreshToken(context.req.raw);
  if (auth) {
    await revokeSession(context.env.DB, auth.sessionId, "logout");
    await audit(context, auth, "auth.logout", "auth_session", auth.sessionId);
  } else if (refresh) {
    const sessionId = refresh.split(".", 1)[0];
    if (sessionId) await revokeSession(context.env.DB, sessionId, "logout");
  }
  const response = context.body(null, 204);
  appendExpiredAuthCookies(response.headers);
  return response;
});

app.get("/api/team", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  const now = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare(`
      UPDATE organisation_invitations
      SET status = 'expired'
      WHERE organisation_id = ? AND status = 'pending' AND expires_at <= ?
    `).bind(auth.organisationId, now),
    context.env.DB.prepare(`
      UPDATE memberships
      SET status = 'revoked', revoked_at = COALESCE(revoked_at, datetime('now')),
        updated_at = datetime('now')
      WHERE organisation_id = ? AND status = 'invited'
        AND NOT EXISTS (
          SELECT 1 FROM organisation_invitations pending
          JOIN users invited_user ON lower(invited_user.email) = lower(pending.email)
          WHERE pending.organisation_id = memberships.organisation_id
            AND invited_user.id = memberships.user_id
            AND pending.status = 'pending' AND pending.expires_at > ?
        )
    `).bind(auth.organisationId, now),
  ]);
  const [members, invitations] = await Promise.all([
    context.env.DB.prepare(`
      SELECT u.id AS userId, u.email, u.display_name AS displayName, m.role,
        m.created_at AS joinedAt, m.updated_at AS updatedAt, m.revoked_at AS revokedAt,
        m.status,
        (SELECT MAX(s.last_seen_at) FROM auth_sessions s
          WHERE s.organisation_id = m.organisation_id AND s.user_id = m.user_id
            AND s.revoked_at IS NULL) AS lastActiveAt
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.organisation_id = ?
        AND m.role IN ('platform_admin', 'production_operator')
      ORDER BY
        CASE WHEN m.revoked_at IS NULL AND EXISTS (
          SELECT 1 FROM organisation_invitations pending
          WHERE pending.organisation_id = m.organisation_id
            AND lower(pending.email) = lower(u.email)
            AND pending.status = 'pending' AND pending.expires_at > ?
        ) THEN 0 WHEN m.revoked_at IS NULL THEN 1 ELSE 2 END,
        COALESCE(m.updated_at, m.created_at) DESC
    `).bind(auth.organisationId, now).all(),
    context.env.DB.prepare(`
      SELECT oi.id, oi.email, oi.role, oi.status, oi.invited_at AS invitedAt,
        oi.expires_at AS expiresAt, oi.accepted_at AS acceptedAt,
        oi.revoked_at AS revokedAt, oi.last_sent_at AS lastSentAt,
        oi.send_count AS sendCount, inviter.display_name AS invitedBy
      FROM organisation_invitations oi
      JOIN users inviter ON inviter.id = oi.invited_by
      WHERE oi.organisation_id = ?
        AND oi.id = (
          SELECT latest.id FROM organisation_invitations latest
          WHERE latest.organisation_id = oi.organisation_id
            AND lower(latest.email) = lower(oi.email)
          ORDER BY latest.invited_at DESC LIMIT 1
        )
      ORDER BY oi.invited_at DESC
    `).bind(auth.organisationId).all(),
  ]);
  return context.json({ members: members.results, invitations: invitations.results });
});

app.get("/api/capture-agents", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  const credentials = await context.env.DB.prepare(`
    SELECT * FROM capture_agent_credentials
    WHERE organisation_id = ?
    ORDER BY CASE WHEN revoked_at IS NULL AND expires_at > ? THEN 0 ELSE 1 END,
      lower(name), created_at DESC
  `).bind(auth.organisationId, new Date().toISOString()).all<CaptureAgentCredentialRow>();
  return context.json({
    credentials: credentials.results.map(publicCaptureAgentCredential),
  });
});

app.post("/api/capture-agents", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = captureAgentCredentialSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const assignmentError = await captureAgentProjectAssignmentError(
    context.env.DB,
    auth.organisationId,
    parsed.data.projectIds,
  );
  if (assignmentError) return context.json({ error: assignmentError }, 422);
  const requestHash = await sha256Hex(JSON.stringify({
    name: parsed.data.name,
    expiresInDays: parsed.data.expiresInDays,
    projectIds: parsed.data.projectIds,
  }));
  const prior = await context.env.DB.prepare(`
    SELECT * FROM capture_agent_credentials
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(
    auth.organisationId,
    parsed.data.clientOperationId,
  ).first<CaptureAgentCredentialRow>();
  if (prior) {
    if (prior.request_hash !== requestHash) {
      return context.json({
        error: "Operation ID was already used for a different capture-agent request",
      }, 409);
    }
    if (prior.token_generation !== 1 || prior.rotation_operation_id || prior.revoked_at) {
      return context.json({
        error: "This credential has changed since creation; rotate it to issue a new token",
        credential: publicCaptureAgentCredential(prior),
      }, 409);
    }
    return context.json({
      credential: publicCaptureAgentCredential(prior),
      token: await captureAgentToken(
        prior.id,
        prior.token_generation,
        parsed.data.clientOperationId,
        context.env.SESSION_PEPPER,
      ),
      idempotent: true,
    });
  }
  const credentialId = crypto.randomUUID();
  const generation = 1;
  const expiresAt = new Date(
    Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const token = await captureAgentToken(
    credentialId,
    generation,
    parsed.data.clientOperationId,
    context.env.SESSION_PEPPER,
  );
  await context.env.DB.prepare(`
    INSERT INTO capture_agent_credentials
      (id, organisation_id, name, token_hash, token_generation,
        project_ids_json, expires_at, created_by, client_operation_id,
        request_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    credentialId,
    auth.organisationId,
    parsed.data.name,
    await captureAgentTokenHash(token, context.env.SESSION_PEPPER),
    generation,
    JSON.stringify(parsed.data.projectIds),
    expiresAt,
    auth.userId,
    parsed.data.clientOperationId,
    requestHash,
  ).run();
  const created = await captureAgentCredential(
    context.env.DB,
    auth.organisationId,
    credentialId,
  );
  if (!created) throw new Error("Capture-agent credential was not created");
  await audit(context, auth, "capture_agent.create", "capture_agent_credential", credentialId, {
    name: created.name,
    projectIds: parsed.data.projectIds,
    expiresAt,
  });
  return context.json({
    credential: publicCaptureAgentCredential(created),
    token,
  }, 201);
});

app.patch("/api/capture-agents/:credentialId", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = captureAgentCredentialUpdateSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const credential = await captureAgentCredential(
    context.env.DB,
    auth.organisationId,
    context.req.param("credentialId"),
  );
  if (!credential) return notFound(context, "Capture-agent credential not found");
  if (credential.revoked_at) {
    return context.json({ error: "Revoked capture-agent credentials cannot be changed" }, 409);
  }
  if (parsed.data.projectIds) {
    const assignmentError = await captureAgentProjectAssignmentError(
      context.env.DB,
      auth.organisationId,
      parsed.data.projectIds,
    );
    if (assignmentError) return context.json({ error: assignmentError }, 422);
  }
  await context.env.DB.prepare(`
    UPDATE capture_agent_credentials
    SET name = ?, project_ids_json = ?, updated_at = datetime('now')
    WHERE id = ? AND organisation_id = ?
  `).bind(
    parsed.data.name ?? credential.name,
    JSON.stringify(parsed.data.projectIds ?? captureAgentProjectIds(credential)),
    credential.id,
    auth.organisationId,
  ).run();
  const updated = await captureAgentCredential(
    context.env.DB,
    auth.organisationId,
    credential.id,
  );
  if (!updated) throw new Error("Capture-agent credential update was not persisted");
  await audit(context, auth, "capture_agent.update", "capture_agent_credential", credential.id, {
    fields: Object.keys(parsed.data),
    projectIds: captureAgentProjectIds(updated),
  });
  return context.json({ credential: publicCaptureAgentCredential(updated) });
});

app.post("/api/capture-agents/:credentialId/rotate", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = captureAgentCredentialRotateSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const credential = await captureAgentCredential(
    context.env.DB,
    auth.organisationId,
    context.req.param("credentialId"),
  );
  if (!credential) return notFound(context, "Capture-agent credential not found");
  if (credential.revoked_at) {
    return context.json({ error: "Revoked capture-agent credentials cannot be rotated" }, 409);
  }
  const requestHash = await sha256Hex(JSON.stringify({
    expiresInDays: parsed.data.expiresInDays,
  }));
  if (credential.rotation_operation_id === parsed.data.clientOperationId) {
    if (credential.rotation_request_hash !== requestHash) {
      return context.json({
        error: "Operation ID was already used for a different rotation request",
      }, 409);
    }
    return context.json({
      credential: publicCaptureAgentCredential(credential),
      token: await captureAgentToken(
        credential.id,
        credential.token_generation,
        parsed.data.clientOperationId,
        context.env.SESSION_PEPPER,
      ),
      idempotent: true,
    });
  }
  const nextGeneration = credential.token_generation + 1;
  const nextExpiry = new Date(
    Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const token = await captureAgentToken(
    credential.id,
    nextGeneration,
    parsed.data.clientOperationId,
    context.env.SESSION_PEPPER,
  );
  const updated = await context.env.DB.prepare(`
    UPDATE capture_agent_credentials
    SET token_hash = ?, token_generation = ?, expires_at = ?,
      rotation_operation_id = ?, rotation_request_hash = ?,
      rotated_at = datetime('now'), updated_at = datetime('now'),
      last_used_at = NULL, last_used_ip = NULL
    WHERE id = ? AND organisation_id = ? AND token_generation = ?
      AND revoked_at IS NULL
  `).bind(
    await captureAgentTokenHash(token, context.env.SESSION_PEPPER),
    nextGeneration,
    nextExpiry,
    parsed.data.clientOperationId,
    requestHash,
    credential.id,
    auth.organisationId,
    credential.token_generation,
  ).run();
  if (updated.meta.changes !== 1) {
    return context.json({
      error: "Credential changed while it was being rotated; refresh before retrying",
    }, 409);
  }
  const rotated = await captureAgentCredential(
    context.env.DB,
    auth.organisationId,
    credential.id,
  );
  if (!rotated) throw new Error("Rotated capture-agent credential was not found");
  await audit(context, auth, "capture_agent.rotate", "capture_agent_credential", credential.id, {
    generation: nextGeneration,
    expiresAt: nextExpiry,
  });
  return context.json({
    credential: publicCaptureAgentCredential(rotated),
    token,
  });
});

app.delete("/api/capture-agents/:credentialId", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const credential = await captureAgentCredential(
    context.env.DB,
    auth.organisationId,
    context.req.param("credentialId"),
  );
  if (!credential || credential.revoked_at) return context.body(null, 204);
  await context.env.DB.prepare(`
    UPDATE capture_agent_credentials
    SET revoked_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND organisation_id = ? AND revoked_at IS NULL
  `).bind(credential.id, auth.organisationId).run();
  await audit(context, auth, "capture_agent.revoke", "capture_agent_credential", credential.id, {
    name: credential.name,
    generation: credential.token_generation,
  });
  return context.body(null, 204);
});

app.get("/api/capture-agent/projects", async (context) => {
  const principal = await requireCaptureAgent(context);
  if (principal instanceof Response) return principal;
  if (!principal.projectIds.length) return context.json({
    credential: publicCaptureAgentPrincipal(principal),
    projects: [],
  });
  const placeholders = principal.projectIds.map(() => "?").join(", ");
  const projects = await context.env.DB.prepare(`
    SELECT id, name, slug, status,
      COALESCE(capture_adapter_v2, capture_adapter) AS captureAdapter,
      delivery_template AS deliveryTemplate, updated_at AS updatedAt
    FROM projects
    WHERE organisation_id = ? AND id IN (${placeholders})
    ORDER BY lower(name), id
  `).bind(
    principal.organisationId,
    ...principal.projectIds,
  ).all<{
    id: string;
    name: string;
    slug: string;
    status: string;
    captureAdapter: CaptureAdapterId;
    deliveryTemplate: string;
    updatedAt: string;
  }>();
  return context.json({
    credential: publicCaptureAgentPrincipal(principal),
    projects: projects.results,
  });
});

app.get("/api/team/identity-providers", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  const secrets = oidcClientSecrets(context.env);
  const providers = await context.env.DB.prepare(`
    SELECT * FROM enterprise_identity_providers
    WHERE organisation_id = ?
    ORDER BY lower(name), id
  `).bind(auth.organisationId).all<EnterpriseIdentityProviderRow>();
  return context.json({
    providers: providers.results.map((provider) => publicIdentityProvider(
      provider,
      Boolean(secrets[provider.id]),
    )),
  });
});

app.post("/api/team/identity-providers", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = enterpriseIdentityProviderSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  let issuer: string;
  try {
    issuer = normalizeOidcIssuer(parsed.data.issuer);
  } catch (error) {
    const oidcError = asOidcError(error);
    return context.json({
      error: oidcError.message,
      code: oidcError.code,
      requestId: context.get("requestId"),
    }, 422);
  }
  const existing = await context.env.DB.prepare(`
    SELECT * FROM enterprise_identity_providers
    WHERE organisation_id = ? AND issuer = ?
  `).bind(auth.organisationId, issuer).first<EnterpriseIdentityProviderRow>();
  if (existing) {
    if (
      existing.name === parsed.data.name &&
      existing.client_id === parsed.data.clientId &&
      JSON.stringify(identityProviderDomains(existing)) === JSON.stringify(parsed.data.emailDomains)
    ) {
      return context.json({
        provider: publicIdentityProvider(
          existing,
          Boolean(oidcClientSecrets(context.env)[existing.id]),
        ),
        secretReference: existing.id,
        nextStep: "Store this provider ID as a key in the OIDC_CLIENT_SECRETS Worker secret, then activate the provider.",
        idempotent: true,
      });
    }
    return conflict(context, "This issuer is already configured for the organisation");
  }
  const providerId = crypto.randomUUID();
  const provider = await context.env.DB.prepare(`
    INSERT INTO enterprise_identity_providers
      (id, organisation_id, name, issuer, client_id, email_domains_json,
        status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)
    RETURNING *
  `).bind(
    providerId,
    auth.organisationId,
    parsed.data.name,
    issuer,
    parsed.data.clientId,
    JSON.stringify(parsed.data.emailDomains),
    auth.userId,
  ).first<EnterpriseIdentityProviderRow>();
  if (!provider) throw new Error("Enterprise identity provider was not created");
  await audit(context, auth, "identity_provider.create", "enterprise_identity_provider", providerId, {
    issuer,
    emailDomains: parsed.data.emailDomains,
  });
  return context.json({
    provider: publicIdentityProvider(
      provider,
      Boolean(oidcClientSecrets(context.env)[providerId]),
    ),
    secretReference: providerId,
    nextStep: "Store this provider ID as a key in the OIDC_CLIENT_SECRETS Worker secret, then activate the provider.",
  }, 201);
});

app.post("/api/team/identity-providers/:providerId/activate", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const provider = await identityProviderForOrganisation(
    context.env.DB,
    auth.organisationId,
    context.req.param("providerId"),
  );
  if (!provider) return notFound(context, "Enterprise identity provider not found");
  const clientSecret = oidcClientSecrets(context.env)[provider.id];
  if (!clientSecret) {
    return context.json({
      error: "OIDC client secret is not configured for this provider",
      code: "client_secret_missing",
      secretReference: provider.id,
      retryable: false,
      requestId: context.get("requestId"),
    }, 503);
  }
  try {
    const metadata = await discoverOidcProvider(provider.issuer);
    const updated = await context.env.DB.prepare(`
      UPDATE enterprise_identity_providers
      SET status = 'active', discovery_json = ?,
        discovery_checked_at = datetime('now'), last_error = NULL,
        updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
      RETURNING *
    `).bind(
      JSON.stringify(metadata),
      provider.id,
      auth.organisationId,
    ).first<EnterpriseIdentityProviderRow>();
    if (!updated) throw new Error("Enterprise identity provider activation was not persisted");
    await audit(context, auth, "identity_provider.activate", "enterprise_identity_provider", provider.id);
    return context.json({
      provider: publicIdentityProvider(updated, true),
    });
  } catch (error) {
    const oidcError = asOidcError(error);
    await recordIdentityProviderError(context.env.DB, provider.id, oidcError);
    return context.json({
      error: oidcError.message,
      code: oidcError.code,
      retryable: oidcError.retryable,
      requestId: context.get("requestId"),
    }, oidcError.retryable ? 502 : 422);
  }
});

app.post("/api/team/identity-providers/:providerId/disable", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const provider = await identityProviderForOrganisation(
    context.env.DB,
    auth.organisationId,
    context.req.param("providerId"),
  );
  if (!provider) return notFound(context, "Enterprise identity provider not found");
  if (provider.status === "disabled") {
    return context.json({
      provider: publicIdentityProvider(
        provider,
        Boolean(oidcClientSecrets(context.env)[provider.id]),
      ),
      idempotent: true,
    });
  }
  const results = await context.env.DB.batch([
    context.env.DB.prepare(`
      UPDATE enterprise_identity_providers
      SET status = 'disabled', updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
      RETURNING *
    `).bind(provider.id, auth.organisationId),
    context.env.DB.prepare(`
      UPDATE auth_sessions
      SET revoked_at = datetime('now'),
        revoke_reason = COALESCE(revoke_reason, 'identity_provider_disabled')
      WHERE identity_provider_id = ? AND revoked_at IS NULL
    `).bind(provider.id),
  ]);
  const updated = requiredBatchResult(results, 0).results[0] as EnterpriseIdentityProviderRow | undefined;
  if (!updated) throw new Error("Enterprise identity provider disable was not persisted");
  await audit(context, auth, "identity_provider.disable", "enterprise_identity_provider", provider.id, {
    revokedSessions: requiredBatchResult(results, 1).meta.changes ?? 0,
  });
  return context.json({
    provider: publicIdentityProvider(
      updated,
      Boolean(oidcClientSecrets(context.env)[provider.id]),
    ),
  });
});

app.delete("/api/team/identity-providers/:providerId", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const provider = await identityProviderForOrganisation(
    context.env.DB,
    auth.organisationId,
    context.req.param("providerId"),
  );
  if (!provider) return context.body(null, 204);
  if (provider.status === "active") {
    return conflict(context, "Disable this provider before deleting it");
  }
  const linked = await context.env.DB.prepare(`
    SELECT COUNT(*) AS count FROM enterprise_identity_links
    WHERE provider_id = ?
  `).bind(provider.id).first<{ count: number }>();
  if ((linked?.count ?? 0) > 0) {
    return conflict(context, "This provider has linked identities and must be retained for audit history");
  }
  await context.env.DB.prepare(`
    DELETE FROM enterprise_identity_providers
    WHERE id = ? AND organisation_id = ?
  `).bind(provider.id, auth.organisationId).run();
  await audit(context, auth, "identity_provider.delete", "enterprise_identity_provider", provider.id);
  return context.body(null, 204);
});

app.post("/api/team/invitations", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = teamInvitationSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());

  if (parsed.data.clientOperationId) {
    const existing = await context.env.DB.prepare(`
      SELECT oi.id, oi.email, oi.role, oi.status, oi.expires_at AS expiresAt,
        u.id AS userId
      FROM organisation_invitations oi
      JOIN users u ON lower(u.email) = lower(oi.email)
      WHERE oi.organisation_id = ? AND oi.client_operation_id = ?
    `).bind(auth.organisationId, parsed.data.clientOperationId).first<{
      id: string;
      email: string;
      role: string;
      status: string;
      expiresAt: string;
      userId: string;
    }>();
    if (existing) {
      if (existing.email !== parsed.data.email || existing.role !== parsed.data.role) {
        return conflict(context, "Operation ID was already used for a different team invitation");
      }
      return context.json({ invitation: existing, idempotent: true });
    }
  }

  const existingMemberships = await context.env.DB.prepare(`
    SELECT m.organisation_id AS organisationId, m.role, m.status,
      m.revoked_at AS revokedAt,
      u.id AS userId
    FROM users u JOIN memberships m ON m.user_id = u.id
    WHERE lower(u.email) = ?
  `).bind(parsed.data.email).all<{
    organisationId: string;
    role: string;
    revokedAt: string | null;
    status: string;
    userId: string;
  }>();
  const activeTeamMember = existingMemberships.results.find(
    (membership) =>
      !membership.revokedAt &&
      membership.status === "active" &&
      membership.organisationId === auth.organisationId &&
      ["platform_admin", "production_operator"].includes(membership.role),
  );
  if (activeTeamMember) return conflict(context, "This email is already an active team member");

  const displayName = parsed.data.email.split("@")[0]?.replace(/[._-]+/g, " ") || "Team member";
  const user = await context.env.DB.prepare(`
    INSERT INTO users (id, email, display_name)
    VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET email = excluded.email
    RETURNING id
  `).bind(crypto.randomUUID(), parsed.data.email, displayName).first<{ id: string }>();
  if (!user) throw new Error("Team member user record was not created");
  const invitationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 86_400_000).toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO memberships (organisation_id, user_id, role, updated_at, revoked_at, status)
      VALUES (?, ?, ?, datetime('now'), NULL, 'invited')
      ON CONFLICT(organisation_id, user_id) DO UPDATE SET
        role = excluded.role, updated_at = datetime('now'), revoked_at = NULL,
        status = 'invited'
    `).bind(auth.organisationId, user.id, parsed.data.role),
    context.env.DB.prepare(`
      UPDATE organisation_invitations
      SET status = 'revoked', revoked_at = datetime('now')
      WHERE organisation_id = ? AND lower(email) = ? AND status = 'pending'
    `).bind(auth.organisationId, parsed.data.email),
    context.env.DB.prepare(`
      INSERT INTO organisation_invitations
        (id, organisation_id, email, role, status, invited_by, expires_at,
          client_operation_id)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `).bind(
      invitationId,
      auth.organisationId,
      parsed.data.email,
      parsed.data.role,
      auth.userId,
      expiresAt,
      parsed.data.clientOperationId ?? null,
    ),
  ]);
  const delivery = await deliverTeamInvitation(
    context.env,
    auth.organisationId,
    invitationId,
    parsed.data.email,
    parsed.data.role,
    expiresAt,
  );
  await audit(context, auth, "team.invite", "organisation_invitation", invitationId, {
    emailHash: await sha256Hex(parsed.data.email),
    role: parsed.data.role,
    deliveryStatus: delivery.status,
  });
  return context.json({
    invitation: {
      id: invitationId,
      userId: user.id,
      email: parsed.data.email,
      role: parsed.data.role,
      status: "pending",
      expiresAt,
      deliveryStatus: delivery.status,
    },
  }, 201);
});

app.post("/api/team/invitations/:invitationId/resend", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const invitation = await context.env.DB.prepare(`
    SELECT id, email, role, status, expires_at AS expiresAt
    FROM organisation_invitations
    WHERE id = ? AND organisation_id = ?
  `).bind(context.req.param("invitationId"), auth.organisationId).first<{
    id: string;
    email: string;
    role: "platform_admin" | "production_operator";
    status: string;
    expiresAt: string;
  }>();
  if (!invitation) return notFound(context, "Team invitation not found");
  if (invitation.status !== "pending") return conflict(context, "Only a pending invitation can be resent");
  if (Date.parse(invitation.expiresAt) <= Date.now()) {
    await context.env.DB.prepare(
      "UPDATE organisation_invitations SET status = 'expired' WHERE id = ? AND status = 'pending'",
    ).bind(invitation.id).run();
    return conflict(context, "This invitation has expired. Create a new invitation.");
  }
  const delivery = await deliverTeamInvitation(
    context.env,
    auth.organisationId,
    invitation.id,
    invitation.email,
    invitation.role,
    invitation.expiresAt,
  );
  await audit(context, auth, "team.invitation_resend", "organisation_invitation", invitation.id, {
    deliveryStatus: delivery.status,
  });
  if (delivery.status === "failed") {
    return context.json({ error: delivery.error ?? "Invitation email could not be delivered" }, 502);
  }
  return context.json({ invitation: { ...invitation, deliveryStatus: delivery.status } });
});

app.patch("/api/team/members/:userId", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = teamMemberUpdateSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const userId = context.req.param("userId");
  if (userId === auth.userId) return conflict(context, "You cannot change your own team role");
  const member = await activeTeamMember(context.env.DB, auth.organisationId, userId);
  if (!member) return notFound(context, "Active team member not found");
  if (member.role === parsed.data.role) {
    return context.json({ member, idempotent: true });
  }
  if (member.role === "platform_admin" && parsed.data.role !== "platform_admin") {
    if (await isLastAdministrator(context.env.DB, auth.organisationId, userId)) {
      return conflict(context, "The final platform administrator cannot be demoted");
    }
  }
  await context.env.DB.batch([
    context.env.DB.prepare(`
      UPDATE memberships SET role = ?, updated_at = datetime('now')
      WHERE organisation_id = ? AND user_id = ? AND revoked_at IS NULL
    `).bind(parsed.data.role, auth.organisationId, userId),
    context.env.DB.prepare(`
      UPDATE auth_sessions
      SET revoked_at = COALESCE(revoked_at, datetime('now')),
        revoke_reason = COALESCE(revoke_reason, 'membership_role_changed')
      WHERE organisation_id = ? AND user_id = ? AND revoked_at IS NULL
    `).bind(auth.organisationId, userId),
  ]);
  await audit(context, auth, "team.role_change", "membership", userId, {
    previousRole: member.role,
    role: parsed.data.role,
  });
  return context.json({
    member: { ...member, role: parsed.data.role, updatedAt: new Date().toISOString() },
  });
});

app.delete("/api/team/members/:userId", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const userId = context.req.param("userId");
  if (userId === auth.userId) return conflict(context, "You cannot revoke your own team access");
  const member = await activeTeamMember(context.env.DB, auth.organisationId, userId);
  if (!member) return notFound(context, "Active team member not found");
  if (member.role === "platform_admin" && await isLastAdministrator(context.env.DB, auth.organisationId, userId)) {
    return conflict(context, "The final platform administrator cannot be revoked");
  }
  await context.env.DB.batch([
    context.env.DB.prepare(`
      UPDATE memberships
      SET status = 'revoked', revoked_at = datetime('now'), updated_at = datetime('now')
      WHERE organisation_id = ? AND user_id = ? AND revoked_at IS NULL
    `).bind(auth.organisationId, userId),
    context.env.DB.prepare(`
      UPDATE auth_sessions
      SET revoked_at = COALESCE(revoked_at, datetime('now')),
        revoke_reason = COALESCE(revoke_reason, 'membership_revoked')
      WHERE organisation_id = ? AND user_id = ? AND revoked_at IS NULL
    `).bind(auth.organisationId, userId),
    context.env.DB.prepare(`
      UPDATE organisation_invitations
      SET status = 'revoked', revoked_at = datetime('now')
      WHERE organisation_id = ? AND lower(email) = lower(?)
        AND status IN ('pending', 'accepted')
    `).bind(auth.organisationId, member.email),
  ]);
  await audit(context, auth, "team.revoke", "membership", userId, {
    role: member.role,
    emailHash: await sha256Hex(member.email),
  });
  return context.body(null, 204);
});

app.get("/api/dashboard", async (context) => {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const dashboardResults = await context.env.DB.batch([
    context.env.DB.prepare("SELECT COUNT(*) AS count FROM projects WHERE organisation_id = ? AND status != 'ARCHIVED'").bind(auth.organisationId),
    context.env.DB.prepare("SELECT COUNT(*) AS count FROM processing_jobs WHERE organisation_id = ? AND state IN ('QUEUED', 'LEASED', 'RUNNING')").bind(auth.organisationId),
    context.env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM assets WHERE organisation_id = ?").bind(auth.organisationId),
    context.env.DB.prepare("SELECT COUNT(*) AS count FROM release_channels WHERE organisation_id = ? AND active_release_id IS NOT NULL").bind(auth.organisationId),
  ]);
  const projects = requiredBatchResult(dashboardResults, 0);
  const queuedJobs = requiredBatchResult(dashboardResults, 1);
  const hostedAssets = requiredBatchResult(dashboardResults, 2);
  const releases = requiredBatchResult(dashboardResults, 3);
  return context.json({
    activeProjects: scalarCount(projects),
    processingJobs: scalarCount(queuedJobs),
    hostedAssets: scalarCount(hostedAssets),
    hostedBytes: scalarNumber(hostedAssets, "bytes"),
    activeReleases: scalarCount(releases),
  });
});

app.get("/api/project-templates", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  const result = await context.env.DB.prepare(`
    SELECT id, organisation_id, name, description,
      COALESCE(capture_adapter_v2, capture_adapter) AS capture_adapter,
      delivery_template, notes, client_operation_id, request_hash,
      created_at, updated_at
    FROM project_templates
    WHERE organisation_id = ?
    ORDER BY lower(name), created_at
    LIMIT 100
  `).bind(auth.organisationId).all<ProjectTemplateRow>();
  return context.json({ templates: result.results.map(publicProjectTemplate) });
});

app.post("/api/project-templates", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectTemplateSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const canonicalRequest = JSON.stringify(parsed.data);
  const requestHash = await sha256Hex(canonicalRequest);
  const prior = await context.env.DB.prepare(`
    SELECT id, organisation_id, name, description,
      COALESCE(capture_adapter_v2, capture_adapter) AS capture_adapter,
      delivery_template, notes, client_operation_id, request_hash,
      created_at, updated_at
    FROM project_templates
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(auth.organisationId, parsed.data.clientOperationId).first<ProjectTemplateRow>();
  if (prior) {
    if (prior.request_hash !== requestHash) {
      return context.json({ error: "Operation ID was already used for a different template request" }, 409);
    }
    return context.json({ template: publicProjectTemplate(prior), idempotent: true });
  }
  const duplicate = await context.env.DB.prepare(`
    SELECT id FROM project_templates
    WHERE organisation_id = ? AND lower(name) = lower(?)
  `).bind(auth.organisationId, parsed.data.name).first<{ id: string }>();
  if (duplicate) return context.json({ error: "A project template with this name already exists" }, 409);

  const templateId = crypto.randomUUID();
  await context.env.DB.prepare(`
    INSERT INTO project_templates
      (id, organisation_id, name, description, capture_adapter, capture_adapter_v2,
        delivery_template, notes, client_operation_id, request_hash, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    templateId,
    auth.organisationId,
    parsed.data.name,
    parsed.data.description ?? null,
    legacyCaptureAdapter(parsed.data.captureAdapter),
    parsed.data.captureAdapter,
    parsed.data.deliveryTemplate,
    parsed.data.notes ?? null,
    parsed.data.clientOperationId,
    requestHash,
    auth.userId,
  ).run();
  const created = await context.env.DB.prepare(`
    SELECT id, organisation_id, name, description,
      COALESCE(capture_adapter_v2, capture_adapter) AS capture_adapter,
      delivery_template, notes, client_operation_id, request_hash,
      created_at, updated_at
    FROM project_templates WHERE id = ? AND organisation_id = ?
  `).bind(templateId, auth.organisationId).first<ProjectTemplateRow>();
  if (!created) throw new Error("Project template was not created");
  await audit(context, auth, "project_template.create", "project_template", templateId, {
    name: parsed.data.name,
  });
  return context.json({ template: publicProjectTemplate(created) }, 201);
});

app.patch("/api/project-templates/:templateId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectTemplateUpdateSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const template = await context.env.DB.prepare(`
    SELECT id, organisation_id, name, description,
      COALESCE(capture_adapter_v2, capture_adapter) AS capture_adapter,
      delivery_template, notes, client_operation_id, request_hash,
      created_at, updated_at
    FROM project_templates WHERE id = ? AND organisation_id = ?
  `).bind(context.req.param("templateId"), auth.organisationId).first<ProjectTemplateRow>();
  if (!template) return notFound(context, "Project template not found");
  if (parsed.data.name && parsed.data.name.toLowerCase() !== template.name.toLowerCase()) {
    const duplicate = await context.env.DB.prepare(`
      SELECT id FROM project_templates
      WHERE organisation_id = ? AND lower(name) = lower(?) AND id != ?
    `).bind(auth.organisationId, parsed.data.name, template.id).first<{ id: string }>();
    if (duplicate) return context.json({ error: "A project template with this name already exists" }, 409);
  }
  await context.env.DB.prepare(`
    UPDATE project_templates
    SET name = ?, description = ?, capture_adapter = ?, capture_adapter_v2 = ?,
      delivery_template = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ? AND organisation_id = ?
  `).bind(
    parsed.data.name ?? template.name,
    parsed.data.description === undefined ? template.description : parsed.data.description,
    legacyCaptureAdapter(parsed.data.captureAdapter ?? template.capture_adapter as CaptureAdapterId),
    parsed.data.captureAdapter ?? template.capture_adapter,
    parsed.data.deliveryTemplate ?? template.delivery_template,
    parsed.data.notes === undefined ? template.notes : parsed.data.notes,
    template.id,
    auth.organisationId,
  ).run();
  const updated = await context.env.DB.prepare(`
    SELECT id, organisation_id, name, description,
      COALESCE(capture_adapter_v2, capture_adapter) AS capture_adapter,
      delivery_template, notes, client_operation_id, request_hash,
      created_at, updated_at
    FROM project_templates WHERE id = ? AND organisation_id = ?
  `).bind(template.id, auth.organisationId).first<ProjectTemplateRow>();
  await audit(context, auth, "project_template.update", "project_template", template.id, {
    fields: Object.keys(parsed.data),
  });
  return context.json({ template: publicProjectTemplate(updated!) });
});

app.delete("/api/project-templates/:templateId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const template = await context.env.DB.prepare(`
    SELECT id, name FROM project_templates WHERE id = ? AND organisation_id = ?
  `).bind(context.req.param("templateId"), auth.organisationId).first<{ id: string; name: string }>();
  if (!template) return context.body(null, 204);
  await context.env.DB.prepare(`
    DELETE FROM project_templates WHERE id = ? AND organisation_id = ?
  `).bind(template.id, auth.organisationId).run();
  await audit(context, auth, "project_template.delete", "project_template", template.id, {
    name: template.name,
  });
  return context.body(null, 204);
});

app.get("/api/project-views", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  const result = await context.env.DB.prepare(`
    SELECT id, name, filter_json, is_default, created_at, updated_at
    FROM project_saved_views
    WHERE organisation_id = ? AND user_id = ?
    ORDER BY is_default DESC, lower(name), created_at
    LIMIT 50
  `).bind(auth.organisationId, auth.userId).all<ProjectSavedViewRow>();
  return context.json({ views: result.results.map(publicProjectSavedView) });
});

app.post("/api/project-views", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectSavedViewSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const requestHash = await sha256Hex(JSON.stringify(parsed.data));
  const prior = await context.env.DB.prepare(`
    SELECT id, name, filter_json, is_default, client_operation_id, request_hash,
      created_at, updated_at
    FROM project_saved_views
    WHERE organisation_id = ? AND user_id = ? AND client_operation_id = ?
  `).bind(
    auth.organisationId,
    auth.userId,
    parsed.data.clientOperationId,
  ).first<ProjectSavedViewRow>();
  if (prior) {
    if (prior.request_hash !== requestHash) {
      return context.json({ error: "Operation ID was already used for a different saved-view request" }, 409);
    }
    return context.json({ view: publicProjectSavedView(prior), idempotent: true });
  }
  const duplicate = await context.env.DB.prepare(`
    SELECT id FROM project_saved_views
    WHERE organisation_id = ? AND user_id = ? AND lower(name) = lower(?)
  `).bind(auth.organisationId, auth.userId, parsed.data.name).first<{ id: string }>();
  if (duplicate) return context.json({ error: "A saved view with this name already exists" }, 409);
  const viewId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  if (parsed.data.isDefault) {
    statements.push(context.env.DB.prepare(`
      UPDATE project_saved_views SET is_default = 0, updated_at = datetime('now')
      WHERE organisation_id = ? AND user_id = ? AND is_default = 1
    `).bind(auth.organisationId, auth.userId));
  }
  statements.push(context.env.DB.prepare(`
    INSERT INTO project_saved_views
      (id, organisation_id, user_id, name, filter_json, is_default,
        client_operation_id, request_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    viewId,
    auth.organisationId,
    auth.userId,
    parsed.data.name,
    JSON.stringify(parsed.data.filter),
    parsed.data.isDefault ? 1 : 0,
    parsed.data.clientOperationId,
    requestHash,
  ));
  await context.env.DB.batch(statements);
  const created = await context.env.DB.prepare(`
    SELECT id, name, filter_json, is_default, created_at, updated_at
    FROM project_saved_views
    WHERE id = ? AND organisation_id = ? AND user_id = ?
  `).bind(viewId, auth.organisationId, auth.userId).first<ProjectSavedViewRow>();
  if (!created) throw new Error("Saved view was not created");
  await audit(context, auth, "project_view.create", "project_saved_view", viewId, {
    name: parsed.data.name,
    isDefault: parsed.data.isDefault,
  });
  return context.json({ view: publicProjectSavedView(created) }, 201);
});

app.patch("/api/project-views/:viewId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectSavedViewUpdateSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const view = await context.env.DB.prepare(`
    SELECT id, name, filter_json, is_default, created_at, updated_at
    FROM project_saved_views
    WHERE id = ? AND organisation_id = ? AND user_id = ?
  `).bind(context.req.param("viewId"), auth.organisationId, auth.userId).first<ProjectSavedViewRow>();
  if (!view) return notFound(context, "Saved view not found");
  if (parsed.data.name && parsed.data.name.toLowerCase() !== view.name.toLowerCase()) {
    const duplicate = await context.env.DB.prepare(`
      SELECT id FROM project_saved_views
      WHERE organisation_id = ? AND user_id = ? AND lower(name) = lower(?) AND id != ?
    `).bind(auth.organisationId, auth.userId, parsed.data.name, view.id).first<{ id: string }>();
    if (duplicate) return context.json({ error: "A saved view with this name already exists" }, 409);
  }
  const nextDefault = parsed.data.isDefault === undefined ? view.is_default === 1 : parsed.data.isDefault;
  const statements: D1PreparedStatement[] = [];
  if (nextDefault) {
    statements.push(context.env.DB.prepare(`
      UPDATE project_saved_views SET is_default = 0, updated_at = datetime('now')
      WHERE organisation_id = ? AND user_id = ? AND id != ? AND is_default = 1
    `).bind(auth.organisationId, auth.userId, view.id));
  }
  statements.push(context.env.DB.prepare(`
    UPDATE project_saved_views
    SET name = ?, filter_json = ?, is_default = ?, updated_at = datetime('now')
    WHERE id = ? AND organisation_id = ? AND user_id = ?
  `).bind(
    parsed.data.name ?? view.name,
    JSON.stringify(parsed.data.filter ?? JSON.parse(view.filter_json)),
    nextDefault ? 1 : 0,
    view.id,
    auth.organisationId,
    auth.userId,
  ));
  await context.env.DB.batch(statements);
  const updated = await context.env.DB.prepare(`
    SELECT id, name, filter_json, is_default, created_at, updated_at
    FROM project_saved_views
    WHERE id = ? AND organisation_id = ? AND user_id = ?
  `).bind(view.id, auth.organisationId, auth.userId).first<ProjectSavedViewRow>();
  await audit(context, auth, "project_view.update", "project_saved_view", view.id, {
    fields: Object.keys(parsed.data),
  });
  return context.json({ view: publicProjectSavedView(updated!) });
});

app.delete("/api/project-views/:viewId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const view = await context.env.DB.prepare(`
    SELECT id, name FROM project_saved_views
    WHERE id = ? AND organisation_id = ? AND user_id = ?
  `).bind(context.req.param("viewId"), auth.organisationId, auth.userId).first<{ id: string; name: string }>();
  if (!view) return context.body(null, 204);
  await context.env.DB.prepare(`
    DELETE FROM project_saved_views
    WHERE id = ? AND organisation_id = ? AND user_id = ?
  `).bind(view.id, auth.organisationId, auth.userId).run();
  await audit(context, auth, "project_view.delete", "project_saved_view", view.id, {
    name: view.name,
  });
  return context.body(null, 204);
});

app.get("/api/project-fields", async (context) => {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const definitions = await projectCustomFieldDefinitions(
    context.env.DB,
    auth.organisationId,
    false,
  );
  return context.json({
    fields: definitions.map(publicProjectCustomFieldDefinition),
  });
});

app.post("/api/project-fields", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectCustomFieldDefinitionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const { clientOperationId, ...definition } = parsed.data;
  const requestHash = await sha256Hex(JSON.stringify(definition));
  const prior = await context.env.DB.prepare(`
    SELECT * FROM project_custom_field_definitions
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(auth.organisationId, clientOperationId).first<ProjectCustomFieldDefinitionRow>();
  if (prior) {
    if (prior.request_hash !== requestHash) {
      return context.json({
        error: "Operation ID was already used for a different custom-field request",
      }, 409);
    }
    return context.json({
      field: publicProjectCustomFieldDefinition(prior),
      idempotent: true,
    });
  }
  const duplicate = await context.env.DB.prepare(`
    SELECT id FROM project_custom_field_definitions
    WHERE organisation_id = ? AND key = ?
  `).bind(auth.organisationId, definition.key).first<{ id: string }>();
  if (duplicate) {
    return context.json({ error: "A project field with this key already exists" }, 409);
  }
  const fieldId = crypto.randomUUID();
  await context.env.DB.prepare(`
    INSERT INTO project_custom_field_definitions
      (id, organisation_id, key, label, description, field_type, required,
        options_json, active, sort_order, created_by, client_operation_id,
        request_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).bind(
    fieldId,
    auth.organisationId,
    definition.key,
    definition.label,
    definition.description ?? null,
    definition.type,
    definition.required ? 1 : 0,
    JSON.stringify(definition.options),
    definition.sortOrder,
    auth.userId,
    clientOperationId,
    requestHash,
  ).run();
  const created = await context.env.DB.prepare(`
    SELECT * FROM project_custom_field_definitions
    WHERE id = ? AND organisation_id = ?
  `).bind(fieldId, auth.organisationId).first<ProjectCustomFieldDefinitionRow>();
  if (!created) throw new Error("Project custom field was not created");
  await audit(context, auth, "project_field.create", "project_custom_field", fieldId, {
    key: definition.key,
    type: definition.type,
    required: definition.required,
  });
  return context.json({ field: publicProjectCustomFieldDefinition(created) }, 201);
});

app.patch("/api/project-fields/:fieldId", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectCustomFieldUpdateSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const field = await context.env.DB.prepare(`
    SELECT * FROM project_custom_field_definitions
    WHERE id = ? AND organisation_id = ?
  `).bind(
    context.req.param("fieldId"),
    auth.organisationId,
  ).first<ProjectCustomFieldDefinitionRow>();
  if (!field) return notFound(context, "Project field not found");
  const options = parsed.data.options ?? parseStringArray(field.options_json);
  if (field.field_type === "select" && options.length === 0) {
    return context.json({ error: "Select fields require at least one option" }, 422);
  }
  if (field.field_type !== "select" && parsed.data.options && parsed.data.options.length > 0) {
    return context.json({ error: "Only select fields may declare options" }, 422);
  }
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
    return context.json({ error: "Select options must be unique" }, 422);
  }
  if (field.field_type === "select") {
    const used = await context.env.DB.prepare(`
      SELECT value_json FROM project_custom_field_values
      WHERE organisation_id = ? AND field_id = ?
    `).bind(auth.organisationId, field.id).all<{ value_json: string }>();
    const removedValue = used.results
      .map((row) => parseJsonValue(row.value_json))
      .find((value) => typeof value === "string" && !options.includes(value));
    if (removedValue !== undefined) {
      return context.json({
        error: `Option "${removedValue}" is still used by at least one project`,
      }, 409);
    }
  }
  await context.env.DB.prepare(`
    UPDATE project_custom_field_definitions
    SET label = ?, description = ?, required = ?, options_json = ?,
      active = ?, sort_order = ?, updated_at = datetime('now')
    WHERE id = ? AND organisation_id = ?
  `).bind(
    parsed.data.label ?? field.label,
    parsed.data.description === undefined ? field.description : parsed.data.description,
    parsed.data.required === undefined ? field.required : parsed.data.required ? 1 : 0,
    JSON.stringify(options),
    parsed.data.active === undefined ? field.active : parsed.data.active ? 1 : 0,
    parsed.data.sortOrder ?? field.sort_order,
    field.id,
    auth.organisationId,
  ).run();
  const updated = await context.env.DB.prepare(`
    SELECT * FROM project_custom_field_definitions
    WHERE id = ? AND organisation_id = ?
  `).bind(field.id, auth.organisationId).first<ProjectCustomFieldDefinitionRow>();
  if (!updated) throw new Error("Project custom field update was not persisted");
  await audit(context, auth, "project_field.update", "project_custom_field", field.id, {
    fields: Object.keys(parsed.data),
  });
  return context.json({ field: publicProjectCustomFieldDefinition(updated) });
});

app.post("/api/projects/portfolio-handoffs/preview", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectPortfolioHandoffPreviewSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const destination = await requireDestinationAdministrator(
    context,
    auth,
    parsed.data.targetOrganisationId,
  );
  if (destination instanceof Response) return destination;
  const preview = await buildPortfolioHandoffPreview(
    context.env.DB,
    auth,
    destination,
    parsed.data.projectIds,
  );
  if ("error" in preview) {
    return context.json({ error: preview.error }, preview.status);
  }
  return context.json(preview);
});

app.post("/api/projects/portfolio-handoffs", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectPortfolioHandoffSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const destination = await requireDestinationAdministrator(
    context,
    auth,
    parsed.data.targetOrganisationId,
  );
  if (destination instanceof Response) return destination;
  const canonicalRequest = JSON.stringify({
    targetOrganisationId: parsed.data.targetOrganisationId,
    projectIds: parsed.data.projectIds,
  });
  const requestHash = await sha256Hex(canonicalRequest);
  let operation = await context.env.DB.prepare(`
    SELECT id, request_hash, status, response_json, updated_at
    FROM project_portfolio_handoffs
    WHERE source_organisation_id = ? AND client_operation_id = ?
  `).bind(
    auth.organisationId,
    parsed.data.clientOperationId,
  ).first<ProjectPortfolioHandoffRow>();
  if (operation) {
    if (operation.request_hash !== requestHash) {
      return context.json({
        error: "Operation ID was already used for a different portfolio handoff",
      }, 409);
    }
    if (operation.status === "completed" && operation.response_json) {
      return context.json({
        ...(JSON.parse(operation.response_json) as Record<string, unknown>),
        idempotent: true,
      });
    }
    const fresh = Date.parse(operation.updated_at) > Date.now() - 5 * 60_000;
    if (operation.status === "running" && fresh) {
      return context.json({
        error: "This portfolio handoff is still running",
        handoffId: operation.id,
        retryAfterSeconds: 5,
      }, 409);
    }
    await context.env.DB.prepare(`
      UPDATE project_portfolio_handoffs
      SET status = 'running', response_json = NULL, error_message = NULL,
        completed_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND source_organisation_id = ? AND request_hash = ?
    `).bind(operation.id, auth.organisationId, requestHash).run();
  } else {
    const handoffId = crypto.randomUUID();
    const inserted = await context.env.DB.prepare(`
      INSERT OR IGNORE INTO project_portfolio_handoffs
        (id, source_organisation_id, target_organisation_id, actor_user_id,
          client_operation_id, request_hash, project_ids_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'running')
    `).bind(
      handoffId,
      auth.organisationId,
      destination.id,
      auth.userId,
      parsed.data.clientOperationId,
      requestHash,
      JSON.stringify(parsed.data.projectIds),
    ).run();
    if ((inserted.meta.changes ?? 0) === 0) {
      operation = await context.env.DB.prepare(`
        SELECT id, request_hash, status, response_json, updated_at
        FROM project_portfolio_handoffs
        WHERE source_organisation_id = ? AND client_operation_id = ?
      `).bind(
        auth.organisationId,
        parsed.data.clientOperationId,
      ).first<ProjectPortfolioHandoffRow>();
      if (!operation || operation.request_hash !== requestHash) {
        return context.json({
          error: "Operation ID was already used for a different portfolio handoff",
        }, 409);
      }
      if (operation.status === "completed" && operation.response_json) {
        return context.json({
          ...(JSON.parse(operation.response_json) as Record<string, unknown>),
          idempotent: true,
        });
      }
      return context.json({
        error: "This portfolio handoff is already running",
        handoffId: operation.id,
        retryAfterSeconds: 5,
      }, 409);
    }
    operation = {
      id: handoffId,
      request_hash: requestHash,
      status: "running",
      response_json: null,
      updated_at: new Date().toISOString(),
    };
  }

  try {
    const preview = await buildPortfolioHandoffPreview(
      context.env.DB,
      auth,
      destination,
      parsed.data.projectIds,
    );
    if ("error" in preview) {
      await markPortfolioHandoffFailed(
        context.env.DB,
        operation.id,
        auth.organisationId,
        preview.error,
      );
      return context.json({ error: preview.error }, preview.status);
    }
    if (!preview.valid) {
      const error = "Resolve custom-field type conflicts before committing this handoff";
      await markPortfolioHandoffFailed(
        context.env.DB,
        operation.id,
        auth.organisationId,
        error,
      );
      return context.json({ error, preview }, 409);
    }
    const response = await commitPortfolioHandoff(
      context,
      auth,
      destination,
      operation.id,
      parsed.data.clientOperationId,
      requestHash,
      parsed.data.projectIds,
      preview,
    );
    return context.json(response, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Portfolio handoff failed";
    await markPortfolioHandoffFailed(
      context.env.DB,
      operation.id,
      auth.organisationId,
      message,
    );
    throw error;
  }
});

app.post("/api/projects/asset-handoffs/preview", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectAssetHandoffPreviewSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const destination = await requireDestinationAdministrator(
    context,
    auth,
    parsed.data.targetOrganisationId,
  );
  if (destination instanceof Response) return destination;
  const preview = await buildProjectAssetHandoffPreview(
    context.env.DB,
    auth,
    destination,
    parsed.data.projectId,
  );
  if ("error" in preview) {
    return context.json({ error: preview.error }, preview.status);
  }
  const { snapshot: _snapshot, ...publicPreview } = preview;
  return context.json(publicPreview);
});

app.get("/api/projects/asset-handoffs", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  const projectId = context.req.query("projectId");
  if (projectId && !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return context.json({ error: "projectId must be a UUID" }, 422);
  }
  const result = await context.env.DB.prepare(`
    SELECT *
    FROM project_asset_handoffs
    WHERE (source_organisation_id = ? OR target_organisation_id = ?)
      AND (? IS NULL OR source_project_id = ? OR target_project_id = ?)
    ORDER BY started_at DESC
    LIMIT 30
  `).bind(
    auth.organisationId,
    auth.organisationId,
    projectId ?? null,
    projectId ?? null,
    projectId ?? null,
  ).all<ProjectAssetHandoffRow>();
  const handoffs = await Promise.all(
    result.results.map((row) => publicProjectAssetHandoff(context.env.DB, row)),
  );
  return context.json({ handoffs });
});

app.get("/api/projects/asset-handoffs/:handoffId", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  const row = await projectAssetHandoffForOrganisation(
    context.env.DB,
    context.req.param("handoffId"),
    auth.organisationId,
  );
  if (!row) return notFound(context, "Asset handoff not found");
  return context.json({ handoff: await publicProjectAssetHandoff(context.env.DB, row) });
});

app.post("/api/projects/asset-handoffs", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectAssetHandoffSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const destination = await requireDestinationAdministrator(
    context,
    auth,
    parsed.data.targetOrganisationId,
  );
  if (destination instanceof Response) return destination;
  const canonicalRequest = JSON.stringify({
    projectId: parsed.data.projectId,
    sourceSnapshotHash: parsed.data.sourceSnapshotHash,
    targetOrganisationId: destination.id,
  });
  const requestHash = await sha256Hex(canonicalRequest);
  const existing = await context.env.DB.prepare(`
    SELECT * FROM project_asset_handoffs
    WHERE source_organisation_id = ? AND client_operation_id = ?
  `).bind(
    auth.organisationId,
    parsed.data.clientOperationId,
  ).first<ProjectAssetHandoffRow>();
  if (existing) {
    if (existing.request_hash !== requestHash) {
      return context.json({
        error: "Operation ID was already used for a different asset handoff",
      }, 409);
    }
    return context.json({
      handoff: await publicProjectAssetHandoff(context.env.DB, existing),
      idempotent: true,
    });
  }
  const preview = await buildProjectAssetHandoffPreview(
    context.env.DB,
    auth,
    destination,
    parsed.data.projectId,
  );
  if ("error" in preview) {
    return context.json({ error: preview.error }, preview.status);
  }
  if (!preview.valid) {
    return context.json({
      error: "Resolve the asset-handoff preview before committing",
      preview,
    }, 409);
  }
  if (preview.sourceSnapshotHash !== parsed.data.sourceSnapshotHash) {
    return context.json({
      error: "The source project changed after preview. Preview it again before copying.",
      preview,
    }, 409);
  }
  const handoffId = crypto.randomUUID();
  const targetProjectId = crypto.randomUUID();
  const versionMappings = preview.snapshot.versions.map((version) => ({
    id: crypto.randomUUID(),
    sourceVersionId: version.id,
    targetVersionId: crypto.randomUUID(),
    version,
  }));
  const versionBySource = new Map(
    versionMappings.map((mapping) => [mapping.sourceVersionId, mapping]),
  );
  const items = preview.snapshot.assets.map((asset) => {
    const version = versionBySource.get(asset.versionId);
    if (!version) throw new Error("Asset handoff lost its version mapping");
    const targetAssetId = crypto.randomUUID();
    return {
      id: crypto.randomUUID(),
      versionMappingId: version.id,
      sourceAssetId: asset.id,
      targetAssetId,
      targetObjectKey:
        `${destination.id}/${targetProjectId}/${version.targetVersionId}/${targetAssetId}/${safeFileName(asset.fileName)}`,
      asset,
    };
  });
  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare(`
      INSERT INTO project_asset_handoffs
        (id, source_organisation_id, target_organisation_id, actor_user_id,
          source_project_id, target_project_id, client_operation_id, request_hash,
          source_snapshot_hash, source_snapshot_json, status, total_versions,
          total_assets, total_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
    `).bind(
      handoffId,
      auth.organisationId,
      destination.id,
      auth.userId,
      parsed.data.projectId,
      targetProjectId,
      parsed.data.clientOperationId,
      requestHash,
      preview.sourceSnapshotHash,
      JSON.stringify(preview.snapshot),
      preview.summary.versions,
      preview.summary.assets,
      preview.summary.bytes,
    ),
    ...versionMappings.map((mapping) => context.env.DB.prepare(`
      INSERT INTO project_asset_handoff_versions
        (id, handoff_id, source_version_id, target_version_id, version_number,
          source_provenance_json, manifest_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      mapping.id,
      handoffId,
      mapping.sourceVersionId,
      mapping.targetVersionId,
      mapping.version.versionNumber,
      mapping.version.sourceProvenanceJson,
      mapping.version.manifestJson,
    )),
    ...items.map((item) => context.env.DB.prepare(`
      INSERT INTO project_asset_handoff_items
        (id, handoff_id, version_mapping_id, source_asset_id, target_asset_id,
          source_object_key, target_object_key, kind, format, file_name,
          mime_type, size_bytes, sha256, source_etag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      item.id,
      handoffId,
      item.versionMappingId,
      item.sourceAssetId,
      item.targetAssetId,
      item.asset.objectKey,
      item.targetObjectKey,
      item.asset.kind,
      item.asset.format,
      item.asset.fileName,
      item.asset.mimeType,
      item.asset.sizeBytes,
      item.asset.sha256,
      item.asset.etag,
    )),
  ];
  try {
    await context.env.DB.batch(statements);
  } catch (error) {
    const raced = await context.env.DB.prepare(`
      SELECT * FROM project_asset_handoffs
      WHERE source_organisation_id = ? AND client_operation_id = ?
    `).bind(
      auth.organisationId,
      parsed.data.clientOperationId,
    ).first<ProjectAssetHandoffRow>();
    if (!raced || raced.request_hash !== requestHash) throw error;
    return context.json({
      handoff: await publicProjectAssetHandoff(context.env.DB, raced),
      idempotent: true,
    });
  }
  try {
    await Promise.all(items.map((item) => context.env.PORTFOLIO_COPY_QUEUE.send({
      type: "project_asset_copy",
      itemId: item.id,
    } satisfies ProjectAssetCopyQueueMessage, {
      contentType: "json",
    })));
  } catch (error) {
    await context.env.DB.prepare(`
      UPDATE project_asset_handoffs
      SET status = 'failed', error_message = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'queued'
    `).bind(`Queue dispatch failed: ${errorMessage(error)}`.slice(0, 1000), handoffId).run();
    return context.json({
      error: "The handoff was saved but Queue dispatch failed. Retry the handoff.",
      handoffId,
    }, 503);
  }
  const created = await context.env.DB.prepare(`
    SELECT * FROM project_asset_handoffs WHERE id = ?
  `).bind(handoffId).first<ProjectAssetHandoffRow>();
  if (!created) throw new Error("Asset handoff was not persisted");
  await audit(context, auth, "project_asset_handoff.queue", "project_asset_handoff", handoffId, {
    targetOrganisationId: destination.id,
    projectId: parsed.data.projectId,
    assets: preview.summary.assets,
    bytes: preview.summary.bytes,
  });
  return context.json({
    handoff: await publicProjectAssetHandoff(context.env.DB, created),
  }, 202);
});

app.post("/api/projects/asset-handoffs/:handoffId/retry", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectAssetHandoffRetrySchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const handoff = await context.env.DB.prepare(`
    SELECT * FROM project_asset_handoffs
    WHERE id = ? AND source_organisation_id = ?
  `).bind(
    context.req.param("handoffId"),
    auth.organisationId,
  ).first<ProjectAssetHandoffRow>();
  if (!handoff) return notFound(context, "Asset handoff not found");
  const action = await existingProjectAssetHandoffAction(
    context.env.DB,
    auth.organisationId,
    parsed.data.clientOperationId,
    "retry",
    handoff.id,
  );
  if ("error" in action) return context.json({ error: action.error }, 409);
  if (action.response) return context.json({ ...action.response, idempotent: true });
  if (handoff.status === "completed" || handoff.status === "cancelled") {
    return context.json({ error: `A ${handoff.status} handoff cannot be retried` }, 409);
  }
  const items = await context.env.DB.prepare(`
    SELECT * FROM project_asset_handoff_items
    WHERE handoff_id = ?
    ORDER BY id
  `).bind(handoff.id).all<ProjectAssetHandoffItemRow>();
  const queueItems = items.results.filter((item) => item.status !== "copied");
  const ids = (queueItems.length > 0 ? queueItems : items.results.slice(0, 1))
    .map((item) => item.id);
  const response = {
    handoffId: handoff.id,
    status: "queued",
    queuedItems: ids.length,
  };
  await context.env.DB.batch([
    context.env.DB.prepare(`
      UPDATE project_asset_handoffs
      SET status = 'queued', error_message = NULL, updated_at = datetime('now')
      WHERE id = ? AND source_organisation_id = ?
    `).bind(handoff.id, auth.organisationId),
    context.env.DB.prepare(`
      UPDATE project_asset_handoff_items
      SET status = 'queued', attempt_count = 0, error_message = NULL,
        updated_at = datetime('now')
      WHERE handoff_id = ? AND status IN ('failed', 'queued', 'copying')
    `).bind(handoff.id),
    context.env.DB.prepare(`
      INSERT INTO project_asset_handoff_actions
        (id, handoff_id, source_organisation_id, client_operation_id, action,
          request_hash, response_json)
      VALUES (?, ?, ?, ?, 'retry', ?, ?)
    `).bind(
      crypto.randomUUID(),
      handoff.id,
      auth.organisationId,
      parsed.data.clientOperationId,
      await sha256Hex(`retry:${handoff.id}`),
      JSON.stringify(response),
    ),
  ]);
  try {
    await Promise.all(ids.map((itemId) => context.env.PORTFOLIO_COPY_QUEUE.send({
      type: "project_asset_copy",
      itemId,
    } satisfies ProjectAssetCopyQueueMessage, {
      contentType: "json",
    })));
  } catch (error) {
    await context.env.DB.prepare(`
      UPDATE project_asset_handoffs SET status = 'failed', error_message = ?,
        updated_at = datetime('now') WHERE id = ?
    `).bind(`Queue dispatch failed: ${errorMessage(error)}`.slice(0, 1000), handoff.id).run();
    return context.json({
      error: "Retry was saved but Queue dispatch failed. Retry again.",
      handoffId: handoff.id,
    }, 503);
  }
  await audit(context, auth, "project_asset_handoff.retry", "project_asset_handoff", handoff.id, {
    queuedItems: ids.length,
  });
  return context.json(response, 202);
});

app.post("/api/projects/asset-handoffs/:handoffId/cancel", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectAssetHandoffCancelSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const handoff = await context.env.DB.prepare(`
    SELECT * FROM project_asset_handoffs
    WHERE id = ? AND source_organisation_id = ?
  `).bind(
    context.req.param("handoffId"),
    auth.organisationId,
  ).first<ProjectAssetHandoffRow>();
  if (!handoff) return notFound(context, "Asset handoff not found");
  const action = await existingProjectAssetHandoffAction(
    context.env.DB,
    auth.organisationId,
    parsed.data.clientOperationId,
    "cancel",
    handoff.id,
  );
  if ("error" in action) return context.json({ error: action.error }, 409);
  if (action.response) return context.json({ ...action.response, idempotent: true });
  if (handoff.status === "completed") {
    return context.json({ error: "A completed handoff cannot be cancelled" }, 409);
  }
  const objects = await context.env.DB.prepare(`
    SELECT target_object_key FROM project_asset_handoff_items WHERE handoff_id = ?
  `).bind(handoff.id).all<{ target_object_key: string }>();
  await context.env.DB.batch([
    context.env.DB.prepare(`
      UPDATE project_asset_handoffs
      SET status = 'cancelled', error_message = NULL,
        cancelled_at = COALESCE(cancelled_at, datetime('now')),
        completed_at = COALESCE(completed_at, datetime('now')),
        updated_at = datetime('now')
      WHERE id = ? AND source_organisation_id = ? AND status != 'completed'
    `).bind(handoff.id, auth.organisationId),
    context.env.DB.prepare(`
      UPDATE project_asset_handoff_items
      SET status = 'cancelled', error_message = NULL, updated_at = datetime('now')
      WHERE handoff_id = ? AND status != 'cancelled'
    `).bind(handoff.id),
  ]);
  await Promise.all(objects.results.map((object) =>
    context.env.SPATIAL_ASSETS.delete(object.target_object_key)
  ));
  const cancelled = await context.env.DB.prepare(`
    SELECT * FROM project_asset_handoffs WHERE id = ?
  `).bind(handoff.id).first<ProjectAssetHandoffRow>();
  if (!cancelled) throw new Error("Cancelled asset handoff disappeared");
  const publicHandoff = await publicProjectAssetHandoff(context.env.DB, cancelled);
  const response = { handoff: publicHandoff };
  await context.env.DB.prepare(`
    INSERT INTO project_asset_handoff_actions
      (id, handoff_id, source_organisation_id, client_operation_id, action,
        request_hash, response_json)
    VALUES (?, ?, ?, ?, 'cancel', ?, ?)
  `).bind(
    crypto.randomUUID(),
    handoff.id,
    auth.organisationId,
    parsed.data.clientOperationId,
    await sha256Hex(`cancel:${handoff.id}`),
    JSON.stringify(response),
  ).run();
  await audit(context, auth, "project_asset_handoff.cancel", "project_asset_handoff", handoff.id, {
    removedObjects: objects.results.length,
  });
  return context.json(response);
});

app.get("/api/projects", async (context) => {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const operator = ["platform_admin", "production_operator"].includes(auth.role) ? 1 : 0;
  const result = await context.env.DB.prepare(`
    SELECT p.*, COALESCE(p.capture_adapter_v2, p.capture_adapter) AS capture_adapter,
      c.name AS customer_name,
      sv.id AS latest_version_id, sv.version_number AS latest_version_number,
      rc.slug AS active_release_slug
    FROM projects p
    LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN scene_versions sv ON sv.id = (
      SELECT id FROM scene_versions WHERE project_id = p.id ORDER BY version_number DESC LIMIT 1
    )
    LEFT JOIN release_channels rc ON rc.project_id = p.id AND rc.active_release_id IS NOT NULL
    WHERE p.organisation_id = ?
      AND (? = 1 OR EXISTS (
        SELECT 1 FROM project_access pa
        WHERE pa.project_id = p.id AND pa.organisation_id = p.organisation_id
          AND pa.user_id = ? AND pa.revoked_at IS NULL
      ))
    ORDER BY p.updated_at DESC
    LIMIT 200
  `).bind(auth.organisationId, operator, auth.userId).all<ProjectRow>();
  const customFields = await projectCustomFieldValues(
    context.env.DB,
    auth.organisationId,
    result.results.map((project) => project.id),
  );
  return context.json({
    projects: result.results.map((project) => publicProject(
      project,
      customFields.get(project.id) ?? {},
    )),
  });
});

app.post("/api/projects/export", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectPortfolioExportSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const selectedIds = parsed.data.projectIds;
  const predicates = ["p.organisation_id = ?"];
  const bindings: unknown[] = [auth.organisationId];
  if (selectedIds) {
    predicates.push(`p.id IN (${selectedIds.map(() => "?").join(", ")})`);
    bindings.push(...selectedIds);
  }
  const result = await context.env.DB.prepare(`
    SELECT p.id, p.name,
      COALESCE(p.capture_adapter_v2, p.capture_adapter) AS capture_adapter,
      p.delivery_template, p.notes,
      c.name AS customer_name, c.contact_email AS customer_email
    FROM projects p
    LEFT JOIN customers c ON c.id = p.customer_id AND c.organisation_id = p.organisation_id
    WHERE ${predicates.join(" AND ")}
    ORDER BY p.updated_at DESC, p.id
    LIMIT 101
  `).bind(...bindings).all<{
    id: string;
    name: string;
    capture_adapter: string;
    delivery_template: string;
    notes: string | null;
    customer_name: string | null;
    customer_email: string | null;
  }>();
  if (!result.results.length) return notFound(context, "No projects were available to export");
  if (result.results.length > 100) {
    return context.json({ error: "Select at most 100 projects for one portable export" }, 413);
  }
  if (selectedIds && result.results.length !== selectedIds.length) {
    return context.json({ error: "One or more selected projects were not found in this workspace" }, 404);
  }
  const [fieldDefinitions, customFieldValues] = await Promise.all([
    projectCustomFieldDefinitions(context.env.DB, auth.organisationId, true),
    projectCustomFieldValues(
      context.env.DB,
      auth.organisationId,
      result.results.map((project) => project.id),
    ),
  ]);
  const manifest = {
    format: "whymelabs.spatial.portfolio" as const,
    schemaVersion: 2 as const,
    exportedAt: new Date().toISOString(),
    fieldDefinitions: fieldDefinitions.map((field) => ({
      key: field.key,
      label: field.label,
      description: field.description,
      type: field.field_type,
      required: field.required === 1,
      options: parseStringArray(field.options_json),
      sortOrder: field.sort_order,
    })),
    projects: result.results.map((project) => ({
      sourceId: project.id,
      name: project.name,
      customerName: project.customer_name,
      customerEmail: project.customer_email,
      captureAdapter: project.capture_adapter,
      deliveryTemplate: project.delivery_template,
      notes: project.notes,
      customFields: customFieldValues.get(project.id) ?? {},
    })),
  };
  await audit(context, auth, "project_portfolio.export", "organisation", auth.organisationId, {
    projectCount: manifest.projects.length,
    selected: Boolean(selectedIds),
  });
  context.header("Content-Type", "application/json; charset=utf-8");
  context.header(
    "Content-Disposition",
    `attachment; filename="${safeFileName(`spatial-portfolio-${new Date().toISOString().slice(0, 10)}.json`)}"`,
  );
  context.header("Cache-Control", "no-store");
  return context.body(`${JSON.stringify(manifest, null, 2)}\n`);
});

app.post("/api/projects/import/preview", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectPortfolioManifestSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const preview = await portfolioPreview(context.env.DB, auth.organisationId, parsed.data);
  return context.json(preview);
});

app.post("/api/projects/import", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectPortfolioImportSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const { clientOperationId, manifest } = parsed.data;
  const canonicalRequest = JSON.stringify(manifest);
  const requestHash = await sha256Hex(canonicalRequest);
  let operation = await context.env.DB.prepare(`
    SELECT id, request_hash, status, response_json, updated_at
    FROM project_portfolio_imports
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(auth.organisationId, clientOperationId).first<PortfolioImportRow>();
  if (operation) {
    if (operation.request_hash !== requestHash) {
      return context.json({ error: "Operation ID was already used for a different portfolio import" }, 409);
    }
    if (operation.status === "completed" && operation.response_json) {
      return context.json({
        ...(JSON.parse(operation.response_json) as Record<string, unknown>),
        idempotent: true,
      });
    }
    const fresh = Date.parse(operation.updated_at) > Date.now() - 5 * 60_000;
    if (operation.status === "running" && fresh) {
      return context.json({
        error: "This portfolio import is still running",
        importId: operation.id,
        retryAfterSeconds: 5,
      }, 409);
    }
    await context.env.DB.prepare(`
      UPDATE project_portfolio_imports
      SET status = 'running', response_json = NULL, error_message = NULL,
        completed_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ? AND request_hash = ?
    `).bind(operation.id, auth.organisationId, requestHash).run();
  } else {
    const importId = crypto.randomUUID();
    const inserted = await context.env.DB.prepare(`
      INSERT OR IGNORE INTO project_portfolio_imports
        (id, organisation_id, actor_user_id, client_operation_id, request_hash,
          schema_version, project_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'running')
    `).bind(
      importId,
      auth.organisationId,
      auth.userId,
      clientOperationId,
      requestHash,
      manifest.schemaVersion,
      manifest.projects.length,
    ).run();
    if ((inserted.meta.changes ?? 0) === 0) {
      operation = await context.env.DB.prepare(`
        SELECT id, request_hash, status, response_json, updated_at
        FROM project_portfolio_imports
        WHERE organisation_id = ? AND client_operation_id = ?
      `).bind(auth.organisationId, clientOperationId).first<PortfolioImportRow>();
      if (!operation || operation.request_hash !== requestHash) {
        return context.json({ error: "Operation ID was already used for a different portfolio import" }, 409);
      }
      if (operation.status === "completed" && operation.response_json) {
        return context.json({
          ...(JSON.parse(operation.response_json) as Record<string, unknown>),
          idempotent: true,
        });
      }
      return context.json({
        error: "This portfolio import is already running",
        importId: operation.id,
        retryAfterSeconds: 5,
      }, 409);
    }
    operation = {
      id: importId,
      request_hash: requestHash,
      status: "running",
      response_json: null,
      updated_at: new Date().toISOString(),
    };
  }

  try {
    const fieldPlan = await portfolioManifestFieldPlan(
      context.env.DB,
      auth.organisationId,
      manifest,
    );
    if (fieldPlan.conflicts.length || fieldPlan.valueErrors.length) {
      const message = fieldPlan.conflicts.length
        ? "Resolve custom-field type conflicts before importing this portfolio"
        : fieldPlan.valueErrors[0] ?? "Portfolio custom-field values are invalid";
      await context.env.DB.prepare(`
        UPDATE project_portfolio_imports
        SET status = 'failed', error_message = ?, completed_at = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ? AND organisation_id = ?
      `).bind(message, operation.id, auth.organisationId).run();
      return context.json({
        error: message,
        conflicts: fieldPlan.conflicts,
        valueErrors: fieldPlan.valueErrors,
      }, 409);
    }
    const existingCustomers = await context.env.DB.prepare(`
      SELECT id, name FROM customers WHERE organisation_id = ?
    `).bind(auth.organisationId).all<{ id: string; name: string }>();
    const customerIds = new Map(
      existingCustomers.results.map((customer) => [customer.name.trim().toLowerCase(), customer.id]),
    );
    const newCustomers = new Map<string, {
      id: string;
      name: string;
      email: string | null;
    }>();
    for (const project of manifest.projects) {
      if (!project.customerName) continue;
      const key = project.customerName.trim().toLowerCase();
      if (customerIds.has(key) || newCustomers.has(key)) continue;
      const customer = {
        id: crypto.randomUUID(),
        name: project.customerName,
        email: project.customerEmail ?? null,
      };
      newCustomers.set(key, customer);
      customerIds.set(key, customer.id);
    }
    const importedProjects = manifest.projects.map((project) => {
      const id = crypto.randomUUID();
      return {
        id,
        sourceId: project.sourceId ?? null,
        name: project.name,
        slug: `${slugify(project.name)}-${id.slice(0, 8)}`,
        status: "DRAFT" as const,
        customerId: project.customerName
          ? customerIds.get(project.customerName.trim().toLowerCase()) ?? null
          : null,
        captureAdapter: project.captureAdapter,
        deliveryTemplate: project.deliveryTemplate,
        notes: project.notes ?? null,
        customFields: project.customFields,
      };
    });
    const response = {
      importId: operation.id,
      clientOperationId,
      schemaVersion: manifest.schemaVersion,
      createdCount: importedProjects.length,
      projects: importedProjects.map(({
        customerId: _customerId,
        slug: _slug,
        customFields: _customFields,
        ...project
      }) => project),
    };
    const statements: D1PreparedStatement[] = [];
    const currentFields = await projectCustomFieldDefinitions(
      context.env.DB,
      auth.organisationId,
      false,
    );
    const fieldByKey = new Map(currentFields.map((field) => [field.key, field]));
    for (const definition of fieldPlan.fieldsToCreate) {
      const row: ProjectCustomFieldDefinitionRow = {
        id: crypto.randomUUID(),
        organisation_id: auth.organisationId,
        key: definition.key,
        label: definition.label,
        description: definition.description ?? null,
        field_type: definition.type,
        required: definition.required ? 1 : 0,
        options_json: JSON.stringify(definition.options),
        active: 1,
        sort_order: definition.sortOrder,
        client_operation_id: null,
        request_hash: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      fieldByKey.set(row.key, row);
      statements.push(context.env.DB.prepare(`
        INSERT INTO project_custom_field_definitions
          (id, organisation_id, key, label, description, field_type, required,
            options_json, active, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).bind(
        row.id,
        auth.organisationId,
        row.key,
        row.label,
        row.description,
        row.field_type,
        row.required,
        row.options_json,
        row.sort_order,
        auth.userId,
      ));
    }
    for (const customer of newCustomers.values()) {
      statements.push(context.env.DB.prepare(`
        INSERT INTO customers (id, organisation_id, name, contact_email)
        VALUES (?, ?, ?, ?)
      `).bind(customer.id, auth.organisationId, customer.name, customer.email));
    }
    for (const project of importedProjects) {
      statements.push(context.env.DB.prepare(`
        INSERT INTO projects
          (id, organisation_id, customer_id, name, slug, status,
            capture_adapter, capture_adapter_v2,
            delivery_template, notes, created_by)
        VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)
      `).bind(
        project.id,
        auth.organisationId,
        project.customerId,
        project.name,
        project.slug,
        legacyCaptureAdapter(project.captureAdapter),
        project.captureAdapter,
        project.deliveryTemplate,
        project.notes,
        auth.userId,
      ));
      for (const [key, value] of Object.entries(project.customFields)) {
        const field = fieldByKey.get(key);
        if (!field || value === null) continue;
        statements.push(context.env.DB.prepare(`
          INSERT INTO project_custom_field_values
            (organisation_id, project_id, field_id, value_json, updated_by)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          auth.organisationId,
          project.id,
          field.id,
          JSON.stringify(value),
          auth.userId,
        ));
      }
    }
    statements.push(context.env.DB.prepare(`
      UPDATE project_portfolio_imports
      SET status = 'completed', response_json = ?, completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ? AND request_hash = ?
    `).bind(JSON.stringify(response), operation.id, auth.organisationId, requestHash));
    await context.env.DB.batch(statements);
    await audit(context, auth, "project_portfolio.import", "project_portfolio_import", operation.id, {
      projectCount: importedProjects.length,
      customerCount: newCustomers.size,
      schemaVersion: manifest.schemaVersion,
    });
    return context.json(response, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Portfolio import failed";
    await context.env.DB.prepare(`
      UPDATE project_portfolio_imports
      SET status = 'failed', error_message = ?, completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(message, operation.id, auth.organisationId).run();
    throw error;
  }
});

app.post("/api/projects", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectInputSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const customFieldResult = await validateProjectCustomFieldValues(
    context.env.DB,
    auth.organisationId,
    parsed.data.customFields,
    true,
  );
  if (!customFieldResult.ok) {
    return context.json({ error: customFieldResult.error }, 422);
  }
  const projectRequestHash = await sha256Hex(JSON.stringify({
    name: parsed.data.name,
    customerName: parsed.data.customerName ?? null,
    customerEmail: parsed.data.customerEmail ?? null,
    captureAdapter: parsed.data.captureAdapter,
    deliveryTemplate: parsed.data.deliveryTemplate,
    notes: parsed.data.notes ?? null,
    customFields: JSON.parse(canonicalCustomFields(customFieldResult.values)),
  }));
  if (parsed.data.clientOperationId) {
    const existing = await context.env.DB.prepare(`
      SELECT id, slug, status, name,
        COALESCE(capture_adapter_v2, capture_adapter) AS capture_adapter,
        delivery_template, create_request_hash
      FROM projects
      WHERE organisation_id = ? AND client_operation_id = ?
    `).bind(auth.organisationId, parsed.data.clientOperationId).first<{
      id: string;
      slug: string;
      status: string;
      name: string;
      capture_adapter: string;
      delivery_template: string;
      create_request_hash: string | null;
    }>();
    if (existing) {
      const existingCustomFields = await projectCustomFieldValues(
        context.env.DB,
        auth.organisationId,
        [existing.id],
      );
      const legacyConflict =
        existing.name !== parsed.data.name ||
        existing.capture_adapter !== parsed.data.captureAdapter ||
        existing.delivery_template !== parsed.data.deliveryTemplate ||
        canonicalCustomFields(existingCustomFields.get(existing.id) ?? {}) !==
          canonicalCustomFields(customFieldResult.values);
      if (
        existing.create_request_hash
          ? existing.create_request_hash !== projectRequestHash
          : legacyConflict
      ) {
        return context.json({ error: "Operation ID was already used for a different project request" }, 409);
      }
      return context.json({
        project: {
          id: existing.id,
          slug: existing.slug,
          status: existing.status,
          ...parsed.data,
          customFields: customFieldResult.values,
        },
        idempotent: true,
      });
    }
  }

  const projectId = crypto.randomUUID();
  const projectSlug = `${slugify(parsed.data.name)}-${projectId.slice(0, 8)}`;
  let customerId: string | null = null;
  if (parsed.data.customerName) {
    const customer = await context.env.DB.prepare(`
      INSERT INTO customers (id, organisation_id, name, contact_email)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(organisation_id, name) DO UPDATE SET
        contact_email = COALESCE(excluded.contact_email, customers.contact_email)
      RETURNING id
    `).bind(
      crypto.randomUUID(),
      auth.organisationId,
      parsed.data.customerName,
      parsed.data.customerEmail ?? null,
    ).first<{ id: string }>();
    if (!customer) throw new Error("Customer record was not created");
    customerId = customer.id;
  }
  const projectStatements: D1PreparedStatement[] = [
    context.env.DB.prepare(`
      INSERT INTO projects
        (id, organisation_id, customer_id, name, slug, status,
          capture_adapter, capture_adapter_v2, delivery_template, notes,
          created_by, client_operation_id, create_request_hash)
      VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      projectId,
      auth.organisationId,
      customerId,
      parsed.data.name,
      projectSlug,
      legacyCaptureAdapter(parsed.data.captureAdapter),
      parsed.data.captureAdapter,
      parsed.data.deliveryTemplate,
      parsed.data.notes ?? null,
      auth.userId,
      parsed.data.clientOperationId ?? null,
      projectRequestHash,
    ),
  ];
  appendProjectCustomFieldStatements(
    context.env.DB,
    projectStatements,
    auth.organisationId,
    projectId,
    auth.userId,
    customFieldResult.definitions,
    customFieldResult.values,
  );
  await context.env.DB.batch(projectStatements);
  await audit(context, auth, "project.create", "project", projectId, { name: parsed.data.name });
  return context.json({
    project: {
      id: projectId,
      slug: projectSlug,
      status: "DRAFT",
      ...parsed.data,
      customFields: customFieldResult.values,
    },
  }, 201);
});

app.post("/api/projects/bulk-lifecycle", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectBulkLifecycleSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());

  const { action, clientOperationId, projectIds } = parsed.data;
  const canonicalRequest = JSON.stringify({ action, projectIds });
  const requestHash = await sha256Hex(canonicalRequest);
  let operation = await context.env.DB.prepare(`
    SELECT id, request_hash, status, response_json, updated_at
    FROM project_bulk_operations
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(auth.organisationId, clientOperationId).first<ProjectBulkOperationRow>();

  if (operation) {
    if (operation.request_hash !== requestHash) {
      return context.json({ error: "Operation ID was already used for a different bulk request" }, 409);
    }
    if ((operation.status === "completed" || operation.status === "partial") && operation.response_json) {
      return context.json({
        ...(JSON.parse(operation.response_json) as Record<string, unknown>),
        idempotent: true,
      });
    }
    const operationIsFresh = Date.parse(operation.updated_at) > Date.now() - 5 * 60_000;
    if (operation.status === "running" && operationIsFresh) {
      return context.json({
        error: "This bulk operation is still running",
        operationId: operation.id,
        retryAfterSeconds: 5,
      }, 409);
    }
    await context.env.DB.prepare(`
      UPDATE project_bulk_operations
      SET status = 'running', response_json = NULL, error_message = NULL,
        completed_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ? AND request_hash = ?
    `).bind(operation.id, auth.organisationId, requestHash).run();
  } else {
    const operationId = crypto.randomUUID();
    const inserted = await context.env.DB.prepare(`
      INSERT OR IGNORE INTO project_bulk_operations
        (id, organisation_id, actor_user_id, client_operation_id, action,
          project_ids_json, request_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'running')
    `).bind(
      operationId,
      auth.organisationId,
      auth.userId,
      clientOperationId,
      action,
      JSON.stringify(projectIds),
      requestHash,
    ).run();
    if ((inserted.meta.changes ?? 0) === 0) {
      operation = await context.env.DB.prepare(`
        SELECT id, request_hash, status, response_json, updated_at
        FROM project_bulk_operations
        WHERE organisation_id = ? AND client_operation_id = ?
      `).bind(auth.organisationId, clientOperationId).first<ProjectBulkOperationRow>();
      if (!operation || operation.request_hash !== requestHash) {
        return context.json({ error: "Operation ID was already used for a different bulk request" }, 409);
      }
      if ((operation.status === "completed" || operation.status === "partial") && operation.response_json) {
        return context.json({
          ...(JSON.parse(operation.response_json) as Record<string, unknown>),
          idempotent: true,
        });
      }
      return context.json({
        error: "This bulk operation is already running",
        operationId: operation.id,
        retryAfterSeconds: 5,
      }, 409);
    }
    operation = {
      id: operationId,
      request_hash: requestHash,
      status: "running",
      response_json: null,
      updated_at: new Date().toISOString(),
    };
  }

  try {
    const results: Array<{
      projectId: string;
      projectName?: string;
      outcome: ProjectLifecycleOutcome["outcome"];
      status?: string;
      message?: string;
    }> = [];
    for (const projectId of projectIds) {
      const result = await applyProjectLifecycleAction(context, auth, projectId, action);
      results.push({
        projectId,
        ...(result.project?.name ? { projectName: result.project.name } : {}),
        outcome: result.outcome,
        ...(result.project?.status ? { status: result.project.status } : {}),
        ...(result.message ? { message: result.message } : {}),
      });
    }
    const summary = {
      changed: results.filter((result) => result.outcome === "changed").length,
      unchanged: results.filter((result) => result.outcome === "unchanged").length,
      blocked: results.filter((result) => result.outcome === "blocked").length,
      notFound: results.filter((result) => result.outcome === "not_found").length,
    };
    const response = {
      operationId: operation.id,
      clientOperationId,
      action,
      requestedCount: projectIds.length,
      summary,
      results,
    };
    const status = summary.blocked > 0 || summary.notFound > 0 ? "partial" : "completed";
    await context.env.DB.prepare(`
      UPDATE project_bulk_operations
      SET status = ?, response_json = ?, completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(status, JSON.stringify(response), operation.id, auth.organisationId).run();
    await audit(context, auth, `project.bulk_${action}`, "project_bulk_operation", operation.id, {
      requestedCount: projectIds.length,
      ...summary,
    });
    return context.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Bulk operation failed";
    await context.env.DB.prepare(`
      UPDATE project_bulk_operations
      SET status = 'failed', error_message = ?, completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(message, operation.id, auth.organisationId).run();
    throw error;
  }
});

app.patch("/api/projects/:projectId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectUpdateSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  let customFieldResult: Awaited<ReturnType<typeof validateProjectCustomFieldValues>> | null = null;
  if (parsed.data.customFields !== undefined) {
    const existing = await projectCustomFieldValues(
      context.env.DB,
      auth.organisationId,
      [project.id],
    );
    const merged: Record<string, ProjectCustomFieldValue> = {
      ...(existing.get(project.id) ?? {}),
    };
    for (const [key, value] of Object.entries(parsed.data.customFields)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    customFieldResult = await validateProjectCustomFieldValues(
      context.env.DB,
      auth.organisationId,
      merged,
      true,
    );
    if (!customFieldResult.ok) {
      return context.json({ error: customFieldResult.error }, 422);
    }
  }

  let customerId = project.customer_id;
  if (parsed.data.customerName !== undefined) {
    if (parsed.data.customerName === null) {
      customerId = null;
    } else {
      const customer = await context.env.DB.prepare(`
        INSERT INTO customers (id, organisation_id, name, contact_email)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(organisation_id, name) DO UPDATE SET
          contact_email = COALESCE(excluded.contact_email, customers.contact_email)
        RETURNING id
      `).bind(
        crypto.randomUUID(),
        auth.organisationId,
        parsed.data.customerName,
        parsed.data.customerEmail ?? null,
      ).first<{ id: string }>();
      if (!customer) throw new Error("Customer record was not created");
      customerId = customer.id;
    }
  }

  const updateStatements: D1PreparedStatement[] = [
    context.env.DB.prepare(`
      UPDATE projects
      SET customer_id = ?, name = ?, capture_adapter = ?, capture_adapter_v2 = ?,
        delivery_template = ?, notes = ?, updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(
      customerId,
      parsed.data.name ?? project.name,
      legacyCaptureAdapter(parsed.data.captureAdapter ?? project.capture_adapter as CaptureAdapterId),
      parsed.data.captureAdapter ?? project.capture_adapter,
      parsed.data.deliveryTemplate ?? project.delivery_template,
      parsed.data.notes === undefined ? project.notes : parsed.data.notes,
      project.id,
      auth.organisationId,
    ),
  ];
  if (customFieldResult?.ok) {
    updateStatements.push(
      context.env.DB.prepare(`
        DELETE FROM project_custom_field_values
        WHERE organisation_id = ? AND project_id = ?
      `).bind(auth.organisationId, project.id),
    );
    appendProjectCustomFieldStatements(
      context.env.DB,
      updateStatements,
      auth.organisationId,
      project.id,
      auth.userId,
      customFieldResult.definitions,
      customFieldResult.values,
    );
  }
  await context.env.DB.batch(updateStatements);
  await audit(context, auth, "project.update", "project", project.id, {
    fields: Object.keys(parsed.data),
  });
  const updated = await scopedProject(context.env.DB, auth.organisationId, project.id);
  if (!updated) return notFound(context, "Project not found");
  const updatedCustomFields = await projectCustomFieldValues(
    context.env.DB,
    auth.organisationId,
    [project.id],
  );
  return context.json({
    project: publicProject(updated, updatedCustomFields.get(project.id) ?? {}),
  });
});

app.post("/api/projects/:projectId/archive", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const result = await applyProjectLifecycleAction(
    context,
    auth,
    context.req.param("projectId"),
    "archive",
  );
  if (result.outcome === "not_found" || !result.project) return notFound(context, "Project not found");
  if (result.outcome === "blocked") return context.json({ error: result.message }, 409);
  return context.json({
    project: publicProject(result.project),
    ...(result.outcome === "unchanged" ? { idempotent: true } : {}),
  });
});

app.post("/api/projects/:projectId/restore", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const result = await applyProjectLifecycleAction(
    context,
    auth,
    context.req.param("projectId"),
    "restore",
  );
  if (result.outcome === "not_found" || !result.project) return notFound(context, "Project not found");
  return context.json({
    project: publicProject(result.project),
    ...(result.outcome === "unchanged" ? { idempotent: true } : {}),
  });
});

app.get("/api/projects/:projectId", async (context) => {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const projectId = context.req.param("projectId");
  if (!(await canReadProject(context.env.DB, auth, projectId))) return notFound(context, "Project not found");
  const project = await scopedProject(context.env.DB, auth.organisationId, projectId);
  if (!project) return notFound(context, "Project not found");
  const detailResults = await context.env.DB.batch([
    context.env.DB.prepare("SELECT * FROM scene_versions WHERE project_id = ? ORDER BY version_number DESC").bind(projectId),
    context.env.DB.prepare("SELECT id, version_id, kind, format, file_name, mime_type, size_bytes, integrity_status, created_at FROM assets WHERE project_id = ? AND organisation_id = ? ORDER BY created_at DESC").bind(projectId, auth.organisationId),
    context.env.DB.prepare("SELECT id, version_id, job_type, state, attempt_count, progress, progress_message, error_json, created_at, updated_at FROM processing_jobs WHERE project_id = ? AND organisation_id = ? ORDER BY created_at DESC").bind(projectId, auth.organisationId),
    context.env.DB.prepare(`
      SELECT r.id, r.version_id, r.access_policy, r.published_at, r.expires_at, r.revoked_at, rc.slug,
        CASE WHEN rc.active_release_id = r.id THEN 1 ELSE 0 END AS is_active
      FROM releases r JOIN release_channels rc ON rc.project_id = r.project_id
      WHERE r.project_id = ? AND r.organisation_id = ?
      ORDER BY r.published_at DESC
    `).bind(projectId, auth.organisationId),
    context.env.DB.prepare(`
      SELECT id, version_id, adapter, schema_version, status, result,
        manifest_asset_id, manifest_hash, validation_json, review_decision,
        review_note, reviewed_at, created_at, updated_at
      FROM capture_bundle_manifests
      WHERE project_id = ? AND organisation_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).bind(projectId, auth.organisationId),
  ]);
  const versions = requiredBatchResult(detailResults, 0);
  const assets = requiredBatchResult(detailResults, 1);
  const jobs = requiredBatchResult(detailResults, 2);
  const releases = requiredBatchResult(detailResults, 3);
  const captureBundles = requiredBatchResult(detailResults, 4);
  const customFields = await projectCustomFieldValues(
    context.env.DB,
    auth.organisationId,
    [project.id],
  );
  return context.json({
    project: publicProject(project, customFields.get(project.id) ?? {}),
    versions: versions.results,
    assets: assets.results,
    jobs: jobs.results,
    releases: releases.results,
    captureBundles: captureBundles.results,
  });
});

app.post("/api/projects/:projectId/capture-bundles", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = captureBundleManifestSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(
    context.env.DB,
    auth.organisationId,
    context.req.param("projectId"),
  );
  if (!project) return notFound(context, "Project not found");
  if (parsed.data.adapter !== project.capture_adapter) {
    return unprocessable(context, {
      adapter: [`Capture bundle adapter must match the project capture adapter (${project.capture_adapter})`],
    });
  }
  const requestHash = await sha256Hex(JSON.stringify(parsed.data));
  const prior = await context.env.DB.prepare(`
    SELECT * FROM capture_bundle_manifests
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(
    auth.organisationId,
    parsed.data.clientOperationId,
  ).first<CaptureBundleRow>();
  if (prior) {
    if (prior.request_hash !== requestHash) {
      return conflict(context, "Operation ID was already used for a different capture bundle");
    }
    return context.json({ manifest: captureBundleApi(prior), idempotent: true });
  }
  const version = await context.env.DB.prepare(`
    SELECT id, version_number
    FROM scene_versions
    WHERE id = ? AND project_id = ?
  `).bind(
    parsed.data.versionId,
    project.id,
  ).first<{ id: string; version_number: number }>();
  if (!version) return notFound(context, "Scene version not found");

  const requestedAssetIds = parsed.data.assets.map((asset) => asset.assetId);
  const placeholders = requestedAssetIds.map(() => "?").join(", ");
  const storedAssets = await context.env.DB.prepare(`
    SELECT id, organisation_id, project_id, version_id, kind, format,
      object_key, file_name, mime_type, size_bytes, etag, sha256,
      integrity_status
    FROM assets
    WHERE organisation_id = ? AND project_id = ? AND version_id = ?
      AND id IN (${placeholders}) AND deleted_at IS NULL
  `).bind(
    auth.organisationId,
    project.id,
    version.id,
    ...requestedAssetIds,
  ).all<AssetRow>();
  if (storedAssets.results.length !== requestedAssetIds.length) {
    return notFound(context, "One or more capture-bundle assets were not found on the selected version");
  }
  const evidenceAssets: CaptureBundleAssetEvidence[] = [];
  for (const declaration of parsed.data.assets) {
    const asset = storedAssets.results.find((candidate) => candidate.id === declaration.assetId);
    if (!asset) return notFound(context, "Capture-bundle asset not found");
    if (asset.integrity_status !== "verified") {
      return conflict(context, `${asset.file_name} has not passed immutable integrity verification`);
    }
    if (!asset.sha256 || !/^[a-f0-9]{64}$/i.test(asset.sha256)) {
      return conflict(context, `${asset.file_name} does not have a verified SHA-256 digest`);
    }
    const object = await context.env.SPATIAL_ASSETS.head(asset.object_key);
    if (!object || object.size !== asset.size_bytes) {
      return conflict(context, `${asset.file_name} is missing from R2 or no longer matches its D1 inventory`);
    }
    evidenceAssets.push({
      id: asset.id,
      roles: declaration.roles,
      kind: asset.kind,
      format: asset.format,
      fileName: asset.file_name,
      mimeType: asset.mime_type,
      sizeBytes: asset.size_bytes,
      sha256: asset.sha256,
    });
  }

  const validation = validateCaptureBundle({
    assets: evidenceAssets,
    capabilities: parsed.data.capabilities,
    rights: parsed.data.rights,
    exporterMode: parsed.data.exporter.mode,
    coordinateUnits: parsed.data.coordinateFrame.units,
    declaredLimitations: parsed.data.limitations,
  });
  const manifestId = crypto.randomUUID();
  const manifestAssetId = crypto.randomUUID();
  const canonicalManifest = {
    format: "whymelabs.spatial.capture-bundle",
    schemaVersion: parsed.data.schemaVersion,
    manifestId,
    project: {
      id: project.id,
      captureAdapter: project.capture_adapter,
    },
    version: {
      id: version.id,
      versionNumber: version.version_number,
    },
    captureSystem: parsed.data.captureSystem,
    exporter: parsed.data.exporter,
    coordinateFrame: parsed.data.coordinateFrame,
    assets: parsed.data.assets.map((declaration) => {
      const asset = evidenceAssets.find((candidate) => candidate.id === declaration.assetId)!;
      return {
        id: asset.id,
        roles: declaration.roles,
        description: declaration.description ?? null,
        kind: asset.kind,
        format: asset.format,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
      };
    }),
    capabilities: parsed.data.capabilities,
    rights: parsed.data.rights,
    declaredLimitations: parsed.data.limitations,
    validation,
  };
  const canonicalManifestJson = JSON.stringify(canonicalManifest);
  const manifestHash = await sha256Hex(canonicalManifestJson);
  const manifestBytes = new TextEncoder().encode(`${canonicalManifestJson}\n`);
  const fileName = `capture-bundle-${manifestId}.json`;
  const objectKey =
    `reports-private/${auth.organisationId}/${project.id}/${version.id}/capture-bundles/${manifestId}/${fileName}`;
  const object = await context.env.SPATIAL_ASSETS.put(objectKey, manifestBytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      organisationId: auth.organisationId,
      projectId: project.id,
      versionId: version.id,
      manifestId,
      manifestHash,
      immutable: "true",
    },
  });
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(`
        INSERT INTO assets (
          id, organisation_id, project_id, version_id, kind, format,
          object_key, file_name, mime_type, size_bytes, etag, sha256,
          integrity_status
        ) VALUES (?, ?, ?, ?, 'report', 'capture-bundle-manifest-json',
          ?, ?, 'application/json', ?, ?, ?, 'verified')
      `).bind(
        manifestAssetId,
        auth.organisationId,
        project.id,
        version.id,
        objectKey,
        fileName,
        manifestBytes.byteLength,
        object.etag,
        manifestHash,
      ),
      context.env.DB.prepare(`
        INSERT INTO capture_bundle_manifests (
          id, organisation_id, project_id, version_id, adapter, adapter_v2,
          schema_version, status, result, client_operation_id, request_hash,
          manifest_asset_id, manifest_hash, canonical_manifest_json,
          validation_json, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        manifestId,
        auth.organisationId,
        project.id,
        version.id,
        legacyCaptureAdapter(parsed.data.adapter),
        parsed.data.adapter,
        parsed.data.schemaVersion,
        validation.result,
        parsed.data.clientOperationId,
        requestHash,
        manifestAssetId,
        manifestHash,
        canonicalManifestJson,
        JSON.stringify(validation),
        auth.userId,
      ),
    ]);
  } catch (error) {
    await context.env.SPATIAL_ASSETS.delete(objectKey);
    throw error;
  }
  await audit(context, auth, "capture.bundle.create", "capture_bundle_manifest", manifestId, {
    projectId: project.id,
    versionId: version.id,
    adapter: parsed.data.adapter,
    result: validation.result,
    manifestAssetId,
    manifestHash,
    inputAssetIds: requestedAssetIds,
  });
  const created = await context.env.DB.prepare(
    "SELECT * FROM capture_bundle_manifests WHERE id = ?",
  ).bind(manifestId).first<CaptureBundleRow>();
  if (!created) throw new Error("Capture bundle manifest was not persisted");
  return context.json({ manifest: captureBundleApi(created) }, 201);
});

app.patch("/api/projects/:projectId/capture-bundles/:manifestId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = captureBundleReviewSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const existing = await context.env.DB.prepare(`
    SELECT * FROM capture_bundle_manifests
    WHERE id = ? AND project_id = ? AND organisation_id = ?
  `).bind(
    context.req.param("manifestId"),
    context.req.param("projectId"),
    auth.organisationId,
  ).first<CaptureBundleRow>();
  if (!existing) return notFound(context, "Capture bundle manifest not found");
  if (parsed.data.decision === "accepted" && existing.result === "blocked") {
    return conflict(context, "A blocked capture bundle cannot be accepted until its evidence is replaced");
  }
  const reviewed = await context.env.DB.prepare(`
    UPDATE capture_bundle_manifests
    SET status = 'reviewed', review_decision = ?, review_note = ?,
      reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND project_id = ? AND organisation_id = ?
    RETURNING *
  `).bind(
    parsed.data.decision,
    parsed.data.note,
    auth.userId,
    existing.id,
    existing.project_id,
    auth.organisationId,
  ).first<CaptureBundleRow>();
  if (!reviewed) throw new Error("Capture bundle review was not persisted");
  await audit(context, auth, "capture.bundle.review", "capture_bundle_manifest", reviewed.id, parsed.data);
  return context.json({ manifest: captureBundleApi(reviewed) });
});

app.get("/api/projects/:projectId/reviewers", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const result = await context.env.DB.prepare(`
    SELECT pi.id AS invitation_id, u.id AS user_id, u.email, u.display_name,
      COALESCE(pa.role, pi.role) AS role, pi.status AS invitation_status,
      pi.invited_at, pi.expires_at, pi.accepted_at, pa.revoked_at
    FROM project_invitations pi
    JOIN users u ON lower(u.email) = lower(pi.email)
    LEFT JOIN project_access pa ON pa.project_id = pi.project_id AND pa.user_id = u.id
    WHERE pi.project_id = ? AND pi.organisation_id = ?
      AND pi.id = (
        SELECT latest.id FROM project_invitations latest
        WHERE latest.project_id = pi.project_id AND lower(latest.email) = lower(pi.email)
        ORDER BY latest.invited_at DESC LIMIT 1
      )
    ORDER BY pi.invited_at DESC
  `).bind(project.id, auth.organisationId).all();
  return context.json({ reviewers: result.results });
});

app.post("/api/projects/:projectId/reviewers", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = reviewerInvitationSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  if (parsed.data.clientOperationId) {
    const existing = await context.env.DB.prepare(`
      SELECT pi.id, pi.status, pi.expires_at, u.id AS user_id
      FROM project_invitations pi JOIN users u ON lower(u.email) = lower(pi.email)
      WHERE pi.organisation_id = ? AND pi.client_operation_id = ?
    `).bind(auth.organisationId, parsed.data.clientOperationId).first<{
      id: string;
      status: string;
      expires_at: string;
      user_id: string;
    }>();
    if (existing) {
      return context.json({
        invitation: {
          id: existing.id,
          userId: existing.user_id,
          status: existing.status,
          expiresAt: existing.expires_at,
        },
        idempotent: true,
      });
    }
  }
  const displayName = parsed.data.email.split("@")[0]?.replace(/[._-]+/g, " ") || "Customer reviewer";
  const user = await context.env.DB.prepare(`
    INSERT INTO users (id, email, display_name)
    VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET email = excluded.email
    RETURNING id
  `).bind(crypto.randomUUID(), parsed.data.email, displayName).first<{ id: string }>();
  if (!user) throw new Error("Reviewer user record was not created");
  const invitationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 86_400_000).toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO memberships (organisation_id, user_id, role, updated_at, revoked_at, status)
      VALUES (?, ?, ?, datetime('now'), NULL, 'active')
      ON CONFLICT(organisation_id, user_id) DO UPDATE SET
        role = CASE WHEN memberships.role IN ('platform_admin', 'production_operator')
          THEN memberships.role ELSE excluded.role END,
        updated_at = datetime('now'),
        revoked_at = CASE WHEN memberships.role IN ('platform_admin', 'production_operator')
          THEN memberships.revoked_at ELSE NULL END,
        status = CASE WHEN memberships.role IN ('platform_admin', 'production_operator')
          THEN memberships.status ELSE 'active' END
    `).bind(auth.organisationId, user.id, parsed.data.role),
    context.env.DB.prepare(`
      UPDATE project_invitations
      SET status = 'revoked', revoked_at = datetime('now')
      WHERE project_id = ? AND organisation_id = ? AND lower(email) = ?
        AND status = 'pending'
    `).bind(project.id, auth.organisationId, parsed.data.email),
    context.env.DB.prepare(`
      INSERT INTO project_invitations
        (id, organisation_id, project_id, email, role, status, invited_by,
          expires_at, client_operation_id)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).bind(
      invitationId,
      auth.organisationId,
      project.id,
      parsed.data.email,
      parsed.data.role,
      auth.userId,
      expiresAt,
      parsed.data.clientOperationId ?? null,
    ),
  ]);
  let deliveryStatus: "sent" | "failed" = "sent";
  let deliveryError: string | null = null;
  try {
    await sendReviewInvitationEmail(context.env, parsed.data.email, project.name, expiresAt);
  } catch (error) {
    deliveryStatus = "failed";
    deliveryError = error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed";
  }
  await context.env.DB.prepare(`
    INSERT INTO notification_deliveries
      (id, organisation_id, project_id, channel, template, recipient, status, error_message, sent_at)
    VALUES (?, ?, ?, 'email', 'review_invitation', ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    auth.organisationId,
    project.id,
    parsed.data.email,
    deliveryStatus,
    deliveryError,
    deliveryStatus === "sent" ? new Date().toISOString() : null,
  ).run();
  await audit(context, auth, "reviewer.invite", "project_invitation", invitationId, {
    projectId: project.id,
    role: parsed.data.role,
    deliveryStatus,
  });
  return context.json({
    invitation: {
      id: invitationId,
      userId: user.id,
      email: parsed.data.email,
      role: parsed.data.role,
      status: "pending",
      expiresAt,
      deliveryStatus,
    },
  }, 201);
});

app.delete("/api/projects/:projectId/reviewers/:userId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const reviewer = await context.env.DB.prepare(
    "SELECT email FROM users WHERE id = ?",
  ).bind(context.req.param("userId")).first<{ email: string }>();
  if (!reviewer) return notFound(context, "Reviewer not found");
  await context.env.DB.batch([
    context.env.DB.prepare(`
      UPDATE project_access SET revoked_at = datetime('now')
      WHERE project_id = ? AND organisation_id = ? AND user_id = ? AND revoked_at IS NULL
    `).bind(project.id, auth.organisationId, context.req.param("userId")),
    context.env.DB.prepare(`
      UPDATE project_invitations SET status = 'revoked', revoked_at = datetime('now')
      WHERE project_id = ? AND organisation_id = ? AND lower(email) = lower(?)
        AND status IN ('pending', 'accepted')
    `).bind(project.id, auth.organisationId, reviewer.email),
  ]);
  await audit(context, auth, "reviewer.revoke", "project_access", context.req.param("userId"), {
    projectId: project.id,
  });
  return context.body(null, 204);
});

app.get("/api/review/inbox", async (context) => {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  if (["platform_admin", "production_operator"].includes(auth.role)) {
    const result = await context.env.DB.prepare(`
      SELECT p.id, p.name, p.slug, p.status, 'production_operator' AS role,
        sv.id AS latest_version_id, sv.version_number AS latest_version_number,
        rc.slug AS release_slug
      FROM projects p
      LEFT JOIN scene_versions sv ON sv.id = (
        SELECT id FROM scene_versions WHERE project_id = p.id ORDER BY version_number DESC LIMIT 1
      )
      LEFT JOIN release_channels rc ON rc.project_id = p.id AND rc.active_release_id IS NOT NULL
      WHERE p.organisation_id = ? AND p.status != 'ARCHIVED'
      ORDER BY p.updated_at DESC
    `).bind(auth.organisationId).all();
    return context.json({ projects: result.results });
  }
  const result = await context.env.DB.prepare(`
    SELECT p.id, p.name, p.slug, p.status, pa.role,
      sv.id AS latest_version_id, sv.version_number AS latest_version_number,
      rc.slug AS release_slug
    FROM project_access pa
    JOIN projects p ON p.id = pa.project_id AND p.organisation_id = pa.organisation_id
    LEFT JOIN scene_versions sv ON sv.id = (
      SELECT id FROM scene_versions WHERE project_id = p.id ORDER BY version_number DESC LIMIT 1
    )
    LEFT JOIN release_channels rc ON rc.project_id = p.id AND rc.active_release_id IS NOT NULL
    WHERE pa.organisation_id = ? AND pa.user_id = ? AND pa.revoked_at IS NULL
      AND p.status != 'ARCHIVED'
    ORDER BY p.updated_at DESC
  `).bind(auth.organisationId, auth.userId).all();
  return context.json({ projects: result.results });
});

app.get("/api/review/projects/:projectId", async (context) => {
  const access = await requireReviewProject(context, context.req.param("projectId"));
  if (access instanceof Response) return access;
  const detail = await context.env.DB.batch([
    context.env.DB.prepare(`
      SELECT id, version_number, status, created_at, updated_at
      FROM scene_versions WHERE project_id = ? ORDER BY version_number DESC
    `).bind(access.project.id),
    context.env.DB.prepare(`
      SELECT id, version_id, kind, status, body, camera_pose_json, anchor_json,
        author_user_id, created_at, updated_at
      FROM review_comments WHERE project_id = ? AND organisation_id = ?
      ORDER BY created_at DESC
    `).bind(access.project.id, access.auth.organisationId),
    context.env.DB.prepare(`
      SELECT id, version_id, reviewer_user_id, decision, note, created_at
      FROM version_review_decisions WHERE project_id = ? AND organisation_id = ?
      ORDER BY created_at DESC
    `).bind(access.project.id, access.auth.organisationId),
  ]);
  return context.json({
    project: publicProject(access.project),
    accessRole: access.accessRole,
    versions: requiredBatchResult(detail, 0).results,
    comments: requiredBatchResult(detail, 1).results,
    decisions: requiredBatchResult(detail, 2).results,
  });
});

app.post("/api/review/projects/:projectId/versions/:versionId/comments", async (context) => {
  const access = await requireReviewProject(context, context.req.param("projectId"), true);
  if (access instanceof Response) return access;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = reviewCommentSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const version = await context.env.DB.prepare(
    "SELECT id FROM scene_versions WHERE id = ? AND project_id = ?",
  ).bind(context.req.param("versionId"), access.project.id).first<{ id: string }>();
  if (!version) return notFound(context, "Scene version not found");
  if (parsed.data.clientOperationId) {
    const existing = await context.env.DB.prepare(`
      SELECT id, version_id, kind, status, body, camera_pose_json, anchor_json,
        author_user_id, created_at, updated_at
      FROM review_comments
      WHERE organisation_id = ? AND client_operation_id = ?
    `).bind(access.auth.organisationId, parsed.data.clientOperationId).first();
    if (existing) return context.json({ comment: existing, idempotent: true });
  }
  const commentId = crypto.randomUUID();
  await context.env.DB.prepare(`
    INSERT INTO review_comments
      (id, organisation_id, project_id, version_id, author_user_id, kind, status,
        body, camera_pose_json, anchor_json, client_operation_id)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
  `).bind(
    commentId,
    access.auth.organisationId,
    access.project.id,
    version.id,
    access.auth.userId,
    parsed.data.kind,
    parsed.data.body,
    JSON.stringify(parsed.data.cameraPose),
    parsed.data.anchor ? JSON.stringify(parsed.data.anchor) : null,
    parsed.data.clientOperationId ?? null,
  ).run();
  if (parsed.data.kind === "redaction") {
    const geometry = parsed.data.anchor
      ? { type: "sphere", point: parsed.data.anchor.point, radius: parsed.data.anchor.radius ?? 0.25 }
      : { type: "camera-frustum", cameraPose: parsed.data.cameraPose };
    await context.env.DB.prepare(`
      INSERT INTO privacy_regions
        (id, organisation_id, project_id, version_id, label, geometry_json,
          source, confidence, review_comment_id)
      VALUES (?, ?, ?, ?, ?, ?, 'client_review', 1, ?)
    `).bind(
      crypto.randomUUID(),
      access.auth.organisationId,
      access.project.id,
      version.id,
      parsed.data.body.slice(0, 120),
      JSON.stringify(geometry),
      commentId,
    ).run();
  }
  await audit(context, access.auth, "review.comment.create", "review_comment", commentId, {
    projectId: access.project.id,
    versionId: version.id,
    kind: parsed.data.kind,
  });
  return context.json({
    comment: {
      id: commentId,
      versionId: version.id,
      kind: parsed.data.kind,
      status: "open",
      body: parsed.data.body,
      cameraPose: parsed.data.cameraPose,
      anchor: parsed.data.anchor ?? null,
    },
  }, 201);
});

app.post("/api/review/projects/:projectId/versions/:versionId/decisions", async (context) => {
  const access = await requireReviewProject(context, context.req.param("projectId"), true);
  if (access instanceof Response) return access;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = reviewDecisionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const version = await context.env.DB.prepare(
    "SELECT id FROM scene_versions WHERE id = ? AND project_id = ?",
  ).bind(context.req.param("versionId"), access.project.id).first<{ id: string }>();
  if (!version) return notFound(context, "Scene version not found");
  const decisionId = crypto.randomUUID();
  await context.env.DB.prepare(`
    INSERT INTO version_review_decisions
      (id, organisation_id, project_id, version_id, reviewer_user_id, decision, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    decisionId,
    access.auth.organisationId,
    access.project.id,
    version.id,
    access.auth.userId,
    parsed.data.decision,
    parsed.data.note ?? null,
  ).run();
  await audit(context, access.auth, "review.decision.create", "version_review_decision", decisionId, {
    projectId: access.project.id,
    versionId: version.id,
    decision: parsed.data.decision,
  });
  return context.json({
    decision: {
      id: decisionId,
      versionId: version.id,
      decision: parsed.data.decision,
      note: parsed.data.note ?? null,
    },
  }, 201);
});

app.get("/api/projects/:projectId/reviews", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const results = await context.env.DB.batch([
    context.env.DB.prepare(`
      SELECT rc.*, u.email AS author_email, u.display_name AS author_name
      FROM review_comments rc JOIN users u ON u.id = rc.author_user_id
      WHERE rc.project_id = ? AND rc.organisation_id = ? ORDER BY rc.created_at DESC
    `).bind(project.id, auth.organisationId),
    context.env.DB.prepare(`
      SELECT d.*, u.email AS reviewer_email, u.display_name AS reviewer_name
      FROM version_review_decisions d JOIN users u ON u.id = d.reviewer_user_id
      WHERE d.project_id = ? AND d.organisation_id = ? ORDER BY d.created_at DESC
    `).bind(project.id, auth.organisationId),
    context.env.DB.prepare(`
      SELECT pi.id AS invitation_id, u.id AS user_id, u.email, u.display_name,
        COALESCE(pa.role, pi.role) AS role, pi.status AS invitation_status,
        pi.invited_at, pi.expires_at, pi.accepted_at, pa.revoked_at
      FROM project_invitations pi
      JOIN users u ON lower(u.email) = lower(pi.email)
      LEFT JOIN project_access pa ON pa.project_id = pi.project_id AND pa.user_id = u.id
      WHERE pi.project_id = ? AND pi.organisation_id = ?
        AND pi.id = (
          SELECT latest.id FROM project_invitations latest
          WHERE latest.project_id = pi.project_id AND lower(latest.email) = lower(pi.email)
          ORDER BY latest.invited_at DESC LIMIT 1
        )
      ORDER BY pi.invited_at DESC
    `).bind(project.id, auth.organisationId),
    context.env.DB.prepare(`
      SELECT id, version_number, status, created_at, updated_at
      FROM scene_versions
      WHERE project_id = ?
      ORDER BY version_number DESC
    `).bind(project.id),
  ]);
  return context.json({
    comments: requiredBatchResult(results, 0).results,
    decisions: requiredBatchResult(results, 1).results,
    reviewers: requiredBatchResult(results, 2).results,
    versions: requiredBatchResult(results, 3).results,
  });
});

app.patch("/api/projects/:projectId/reviews/comments/:commentId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = reviewCommentResolutionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const result = await context.env.DB.prepare(`
    UPDATE review_comments SET status = ?, resolved_by = ?, resolved_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ? AND project_id = ? AND organisation_id = ? AND status = 'open'
    RETURNING id, status, resolved_at
  `).bind(
    parsed.data.status,
    auth.userId,
    context.req.param("commentId"),
    context.req.param("projectId"),
    auth.organisationId,
  ).first();
  if (!result) return notFound(context, "Open review comment not found");
  await audit(context, auth, "review.comment.resolve", "review_comment", context.req.param("commentId"), {
    status: parsed.data.status,
  });
  return context.json({ comment: result });
});

app.get("/api/projects/:projectId/versions/compare", async (context) => {
  const access = await requireReviewProject(context, context.req.param("projectId"));
  if (access instanceof Response) return access;
  const leftId = context.req.query("left");
  const rightId = context.req.query("right");
  if (!leftId || !rightId || leftId === rightId) {
    return validationError(context, { versions: ["Two distinct version IDs are required"] });
  }
  const versions = await context.env.DB.prepare(`
    SELECT id, version_number, status, source_provenance_json, manifest_json, created_at, updated_at
    FROM scene_versions WHERE project_id = ? AND id IN (?, ?)
    ORDER BY version_number
  `).bind(access.project.id, leftId, rightId).all();
  if (versions.results.length !== 2) return notFound(context, "One or both versions were not found");
  const details = await context.env.DB.batch([
    context.env.DB.prepare(`
      SELECT id, version_id, kind, format, file_name, mime_type, object_key,
        size_bytes, sha256, integrity_status
      FROM assets WHERE project_id = ? AND organisation_id = ? AND version_id IN (?, ?)
      ORDER BY version_id, kind, created_at
    `).bind(access.project.id, access.auth.organisationId, leftId, rightId),
    context.env.DB.prepare(`
      SELECT version_id, kind, status, COUNT(*) AS count
      FROM review_comments WHERE project_id = ? AND organisation_id = ? AND version_id IN (?, ?)
      GROUP BY version_id, kind, status
    `).bind(access.project.id, access.auth.organisationId, leftId, rightId),
    context.env.DB.prepare(`
      SELECT version_id, decision, COUNT(*) AS count, MAX(created_at) AS latest_at
      FROM version_review_decisions
      WHERE project_id = ? AND organisation_id = ? AND version_id IN (?, ?)
      GROUP BY version_id, decision
    `).bind(access.project.id, access.auth.organisationId, leftId, rightId),
    context.env.DB.prepare(`
      SELECT version_id, viewer_config_json, published_at
      FROM releases
      WHERE project_id = ? AND organisation_id = ? AND version_id IN (?, ?)
        AND revoked_at IS NULL
      ORDER BY published_at DESC
    `).bind(access.project.id, access.auth.organisationId, leftId, rightId),
    context.env.DB.prepare(`
      SELECT d.id, d.version_id, d.decision, d.note, d.created_at,
        u.display_name AS reviewer_name, u.email AS reviewer_email
      FROM version_review_decisions d
      JOIN users u ON u.id = d.reviewer_user_id
      WHERE d.project_id = ? AND d.organisation_id = ? AND d.version_id IN (?, ?)
      ORDER BY d.created_at DESC
      LIMIT 100
    `).bind(access.project.id, access.auth.organisationId, leftId, rightId),
    context.env.DB.prepare(`
      SELECT c.id, c.version_id, c.kind, c.status, c.body, c.created_at,
        u.display_name AS author_name, u.email AS author_email
      FROM review_comments c
      JOIN users u ON u.id = c.author_user_id
      WHERE c.project_id = ? AND c.organisation_id = ? AND c.version_id IN (?, ?)
      ORDER BY c.created_at DESC
      LIMIT 100
    `).bind(access.project.id, access.auth.organisationId, leftId, rightId),
  ]);
  const versionRows = versions.results as Array<{
    id: string;
    version_number: number;
    status: string;
    source_provenance_json: string | null;
    manifest_json: string | null;
    created_at: string;
    updated_at: string;
  }>;
  const assetRows = requiredBatchResult(details, 0).results as Array<{
    id: string;
    version_id: string;
    kind: string;
    format: string;
    file_name: string;
    mime_type: string;
    object_key: string;
    size_bytes: number;
    sha256: string | null;
    integrity_status: string;
  }>;
  const releaseConfigs = requiredBatchResult(details, 3).results as Array<{
    version_id: string;
    viewer_config_json: string;
    published_at: string;
  }>;
  const tokenTtl = positiveInteger(context.env.SCENE_SESSION_TTL_SECONDS, 1800);
  const sessionExpiresAt = Math.floor(Date.now() / 1000) + tokenTtl;
  const renderables = (await Promise.all(versionRows.map(async (version) => {
    const manifest = parseStoredObject(version.manifest_json ?? "{}");
    const approvedAssetId = readStringProperty(manifest, "webAssetId");
    const asset = assetRows.find((candidate) =>
      candidate.version_id === version.id &&
      candidate.id === approvedAssetId &&
      candidate.kind === "web" &&
      candidate.integrity_status === "verified" &&
      allowedWebFormats.has(candidate.format)
    ) ?? assetRows.find((candidate) =>
      candidate.version_id === version.id &&
      candidate.kind === "web" &&
      candidate.integrity_status === "verified" &&
      allowedWebFormats.has(candidate.format)
    );
    if (!asset || !(await context.env.SPATIAL_ASSETS.head(asset.object_key))) return null;
    const tokenScope = comparisonAssetTokenScope(access.project.id, version.id, asset.id);
    const token = await signSceneToken({
      releaseId: tokenScope,
      expiresAt: sessionExpiresAt,
    }, context.env.SESSION_PEPPER);
    const releaseConfig = releaseConfigs.find((candidate) => candidate.version_id === version.id);
    return {
      versionId: version.id,
      assetId: asset.id,
      format: asset.format,
      fileName: asset.file_name,
      mimeType: asset.mime_type,
      sizeBytes: asset.size_bytes,
      sha256: asset.sha256,
      contentUrl: `/comparison-asset/${access.project.id}/${version.id}/${asset.id}/${encodeURIComponent(asset.file_name)}?token=${encodeURIComponent(token)}`,
      sessionExpiresAt: new Date(sessionExpiresAt * 1000).toISOString(),
      viewer: releaseConfig ? parseStoredObject(releaseConfig.viewer_config_json) : null,
    };
  }))).filter((value) => value !== null);
  return context.json({
    requested: { left: leftId, right: rightId },
    versions: versionRows,
    assets: assetRows.map(({ object_key: _objectKey, ...asset }) => asset),
    reviewComments: requiredBatchResult(details, 1).results,
    reviewDecisions: requiredBatchResult(details, 2).results,
    reviewDecisionHistory: requiredBatchResult(details, 4).results,
    reviewCommentHistory: requiredBatchResult(details, 5).results,
    renderables,
  });
});

app.get("/api/projects/:projectId/theme", async (context) => {
  const access = await requireReviewProject(context, context.req.param("projectId"));
  if (access instanceof Response) return access;
  const theme = await context.env.DB.prepare(
    "SELECT brand_name, logo_url, accent_color, surface_color, updated_at FROM project_themes WHERE project_id = ? AND organisation_id = ?",
  ).bind(access.project.id, access.auth.organisationId).first();
  return context.json({
    theme: theme ?? {
      brand_name: null,
      logo_url: null,
      accent_color: "#d6ff4b",
      surface_color: "#0d0f0e",
      updated_at: null,
    },
  });
});

app.put("/api/projects/:projectId/theme", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectThemeSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  await context.env.DB.prepare(`
    INSERT INTO project_themes
      (project_id, organisation_id, brand_name, logo_url, accent_color, surface_color, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      brand_name = excluded.brand_name,
      logo_url = excluded.logo_url,
      accent_color = excluded.accent_color,
      surface_color = excluded.surface_color,
      updated_by = excluded.updated_by,
      updated_at = datetime('now')
  `).bind(
    project.id,
    auth.organisationId,
    parsed.data.brandName ?? null,
    parsed.data.logoUrl ?? null,
    parsed.data.accentColor,
    parsed.data.surfaceColor,
    auth.userId,
  ).run();
  await audit(context, auth, "project.theme.update", "project", project.id);
  return context.json({ theme: parsed.data });
});

app.get("/api/projects/:projectId/domains", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const result = await context.env.DB.prepare(`
    SELECT *
    FROM custom_domains WHERE project_id = ? AND organisation_id = ? AND status != 'removed'
    ORDER BY created_at DESC
  `).bind(project.id, auth.organisationId).all();
  const providerConfig = cloudflareSaasConfig(context.env);
  return context.json({
    providerConfigured: Boolean(providerConfig),
    cnameTarget: context.env.CLOUDFLARE_SAAS_CNAME_TARGET,
    domains: result.results.map((row) =>
      publicCustomDomain(row as unknown as CustomDomainRow, Boolean(providerConfig))
    ),
  });
});

app.post("/api/projects/:projectId/domains", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = customDomainSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const domainId = crypto.randomUUID();
  const token = secureToken(32);
  const tokenHash = await sha256Hex(`${token}:${context.env.SESSION_PEPPER}`);
  try {
    await context.env.DB.prepare(`
      INSERT INTO custom_domains
        (id, organisation_id, project_id, hostname, status, verification_token_hash, created_by)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).bind(domainId, auth.organisationId, project.id, parsed.data.hostname, tokenHash, auth.userId).run();
  } catch {
    return context.json({ error: "This hostname is already registered" }, 409);
  }
  await audit(context, auth, "custom_domain.create", "custom_domain", domainId, {
    hostname: parsed.data.hostname,
  });
  return context.json({
    domain: {
      id: domainId,
      hostname: parsed.data.hostname,
      status: "ownership_pending",
      verificationName: `_spatial.${parsed.data.hostname}`,
      verificationValue: `spatial-verification=${token}`,
      verificationToken: token,
      cnameTarget: context.env.CLOUDFLARE_SAAS_CNAME_TARGET,
      providerConfigured: Boolean(cloudflareSaasConfig(context.env)),
    },
  }, 201);
});

app.post("/api/projects/:projectId/domains/:domainId/challenge", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const domain = await scopedCustomDomain(
    context.env.DB,
    auth.organisationId,
    context.req.param("projectId"),
    context.req.param("domainId"),
  );
  if (!domain) return notFound(context, "Custom domain not found");
  if (domain.provider_hostname_id) {
    return conflict(context, "A provisioned hostname cannot restart ownership verification; remove it first");
  }
  const token = secureToken(32);
  const tokenHash = await sha256Hex(`${token}:${context.env.SESSION_PEPPER}`);
  await context.env.DB.prepare(`
    UPDATE custom_domains
    SET verification_token_hash = ?, status = 'pending', verified_at = NULL,
      dns_verified_at = NULL, last_error = NULL
    WHERE id = ? AND organisation_id = ?
  `).bind(tokenHash, domain.id, auth.organisationId).run();
  await audit(context, auth, "custom_domain.challenge.rotate", "custom_domain", domain.id);
  return context.json({
    domain: {
      ...publicCustomDomain({ ...domain, status: "pending", dns_verified_at: null, verified_at: null, last_error: null }, Boolean(cloudflareSaasConfig(context.env))),
      verificationName: `_spatial.${domain.hostname}`,
      verificationValue: `spatial-verification=${token}`,
      verificationToken: token,
      cnameTarget: context.env.CLOUDFLARE_SAAS_CNAME_TARGET,
    },
  });
});

app.post("/api/projects/:projectId/domains/:domainId/verify", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = customDomainVerifySchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const domain = await scopedCustomDomain(
    context.env.DB,
    auth.organisationId,
    context.req.param("projectId"),
    context.req.param("domainId"),
  );
  if (!domain) return notFound(context, "Custom domain not found");
  if (domain.provider_hostname_id) {
    return conflict(context, "Ownership is already bound to a provisioned provider hostname");
  }
  const suppliedHash = await sha256Hex(`${parsed.data.verificationToken}:${context.env.SESSION_PEPPER}`);
  if (!timingSafeStringEqual(suppliedHash, domain.verification_token_hash)) {
    return forbidden(context, "Domain verification token is invalid");
  }
  const expected = `spatial-verification=${parsed.data.verificationToken}`;
  let verified = false;
  let lastError: string | null = null;
  try {
    const dnsResponse = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(`_spatial.${domain.hostname}`)}&type=TXT`,
      { headers: { accept: "application/dns-json" } },
    );
    if (!dnsResponse.ok) throw new Error(`DNS resolver returned ${dnsResponse.status}`);
    const dns = await dnsResponse.json<{ Answer?: Array<{ data?: string }> }>();
    verified = Boolean(dns.Answer?.some((answer) =>
      answer.data?.replaceAll('"', "").includes(expected)
    ));
    if (!verified) lastError = "The expected TXT verification record was not found";
  } catch (error) {
    lastError = error instanceof Error ? error.message.slice(0, 500) : "DNS verification failed";
  }
  await context.env.DB.prepare(`
    UPDATE custom_domains
    SET status = ?, verified_at = ?, dns_verified_at = ?, last_error = ?,
      last_checked_at = datetime('now')
    WHERE id = ? AND organisation_id = ?
  `).bind(
    verified ? "pending" : "failed",
    verified ? new Date().toISOString() : null,
    verified ? new Date().toISOString() : null,
    lastError,
    domain.id,
    auth.organisationId,
  ).run();
  await audit(context, auth, "custom_domain.ownership.verify", "custom_domain", domain.id, { verified });
  const providerConfigured = Boolean(cloudflareSaasConfig(context.env));
  return context.json({
    domain: publicCustomDomain({
      ...domain,
      status: verified ? "pending" : "failed",
      verified_at: verified ? new Date().toISOString() : null,
      dns_verified_at: verified ? new Date().toISOString() : null,
      last_error: lastError,
      last_checked_at: new Date().toISOString(),
    }, providerConfigured),
    nextAction: verified
      ? providerConfigured ? "provision" : "provider_configuration_required"
      : "retry_ownership",
  }, verified ? 200 : 409);
});

app.post("/api/projects/:projectId/domains/:domainId/provision", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const domain = await scopedCustomDomain(
    context.env.DB,
    auth.organisationId,
    context.req.param("projectId"),
    context.req.param("domainId"),
  );
  if (!domain) return notFound(context, "Custom domain not found");
  if (!domain.dns_verified_at) {
    return conflict(context, "Verify the Spatial Studio ownership TXT record before provisioning");
  }
  const config = cloudflareSaasConfig(context.env);
  if (!config) {
    return context.json({
      error: "Cloudflare for SaaS is not configured for this environment",
      retryable: false,
      requestId: context.get("requestId"),
    }, 503);
  }
  try {
    let providerHostname: CloudflareCustomHostname;
    if (domain.provider_hostname_id) {
      providerHostname = await getCloudflareCustomHostname(config, domain.provider_hostname_id);
    } else {
      providerHostname = await findCloudflareCustomHostname(config, domain.hostname)
        ?? await createCloudflareCustomHostname(config, domain.hostname, {
          organisationId: auth.organisationId,
          projectId: domain.project_id,
          domainId: domain.id,
        });
    }
    const ready = isCloudflareCustomHostnameReady(providerHostname);
    const now = new Date().toISOString();
    await context.env.DB.prepare(`
      UPDATE custom_domains
      SET provider = 'cloudflare-for-saas', provider_hostname_id = ?,
        provider_status = ?, provider_ssl_status = ?,
        provider_validation_json = ?, status = ?, last_error = ?,
        provisioning_attempts = provisioning_attempts + 1,
        last_checked_at = ?, provisioned_at = ?
      WHERE id = ? AND organisation_id = ?
    `).bind(
      providerHostname.id,
      providerHostname.status,
      providerHostname.sslStatus,
      JSON.stringify(providerHostnameEvidence(providerHostname)),
      ready ? "active" : "pending",
      providerHostname.verificationErrors.length
        ? providerHostname.verificationErrors.join("; ").slice(0, 1000)
        : null,
      now,
      ready ? now : null,
      domain.id,
      auth.organisationId,
    ).run();
    await audit(context, auth, "custom_domain.provision", "custom_domain", domain.id, {
      provider: "cloudflare-for-saas",
      providerHostnameId: providerHostname.id,
      providerStatus: providerHostname.status,
      providerSslStatus: providerHostname.sslStatus,
      ready,
    });
    const updated = await scopedCustomDomain(
      context.env.DB,
      auth.organisationId,
      domain.project_id,
      domain.id,
    );
    return context.json({
      domain: publicCustomDomain(updated ?? domain, true),
      cnameTarget: config.cnameTarget,
      ready,
    }, ready ? 200 : 202);
  } catch (error) {
    const providerError = error instanceof CloudflareSaasError
      ? error
      : new CloudflareSaasError(errorMessage(error), 503, null, true);
    await context.env.DB.prepare(`
      UPDATE custom_domains
      SET status = 'failed', last_error = ?,
        provisioning_attempts = provisioning_attempts + 1,
        last_checked_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(providerError.message.slice(0, 1000), domain.id, auth.organisationId).run();
    await audit(context, auth, "custom_domain.provision.failed", "custom_domain", domain.id, {
      providerCode: providerError.providerCode,
      providerStatus: providerError.status,
      retryable: providerError.retryable,
    });
    return context.json({
      error: providerError.message,
      providerCode: providerError.providerCode,
      retryable: providerError.retryable,
      requestId: context.get("requestId"),
    }, providerError.retryable ? 503 : 409);
  }
});

app.delete("/api/projects/:projectId/domains/:domainId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const domain = await scopedCustomDomain(
    context.env.DB,
    auth.organisationId,
    context.req.param("projectId"),
    context.req.param("domainId"),
  );
  if (!domain) return notFound(context, "Custom domain not found");
  if (domain.provider_hostname_id) {
    const config = cloudflareSaasConfig(context.env);
    if (!config) {
      return context.json({
        error: "Cloudflare for SaaS is not configured; refusing to orphan the provider hostname",
        retryable: false,
        requestId: context.get("requestId"),
      }, 503);
    }
    try {
      await deleteCloudflareCustomHostname(config, domain.provider_hostname_id);
    } catch (error) {
      if (!(error instanceof CloudflareSaasError) || error.status !== 404) {
        const providerError = error instanceof CloudflareSaasError
          ? error
          : new CloudflareSaasError(errorMessage(error), 503, null, true);
        return context.json({
          error: providerError.message,
          providerCode: providerError.providerCode,
          retryable: providerError.retryable,
          requestId: context.get("requestId"),
        }, providerError.retryable ? 503 : 409);
      }
    }
  }
  await context.env.DB.prepare(`
    UPDATE custom_domains SET status = 'removed', removed_at = datetime('now')
    WHERE id = ? AND project_id = ? AND organisation_id = ? AND status != 'removed'
  `).bind(domain.id, domain.project_id, auth.organisationId).run();
  await audit(context, auth, "custom_domain.remove", "custom_domain", domain.id, {
    provider: domain.provider,
    providerHostnameId: domain.provider_hostname_id,
  });
  return context.body(null, 204);
});

app.get("/api/hosting", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  const results = await context.env.DB.batch([
    context.env.DB.prepare("SELECT * FROM hosting_plans WHERE active = 1 ORDER BY monthly_price_cents"),
    context.env.DB.prepare(`
      SELECT s.*, p.name AS project_name, hp.name AS plan_name,
        hp.monthly_price_cents, hp.included_storage_bytes,
        COALESCE((SELECT SUM(size_bytes) FROM assets a
          WHERE a.project_id = s.project_id AND a.deleted_at IS NULL), 0) AS storage_bytes
      FROM project_hosting_subscriptions s
      JOIN projects p ON p.id = s.project_id
      JOIN hosting_plans hp ON hp.code = s.plan_code
      WHERE s.organisation_id = ?
      ORDER BY s.updated_at DESC
    `).bind(auth.organisationId),
    context.env.DB.prepare(`
      SELECT i.*, p.name AS project_name FROM billing_invoices i
      JOIN projects p ON p.id = i.project_id
      WHERE i.organisation_id = ? ORDER BY i.created_at DESC LIMIT 100
    `).bind(auth.organisationId),
    context.env.DB.prepare(`
      SELECT 'notification' AS kind, id, template AS label, error_message AS detail, created_at
      FROM notification_deliveries WHERE organisation_id = ? AND status = 'failed'
      UNION ALL
      SELECT 'subscription' AS kind, id, 'Hosting period expires soon' AS label,
        current_period_end AS detail, updated_at AS created_at
      FROM project_hosting_subscriptions
      WHERE organisation_id = ? AND status IN ('trial', 'active')
        AND current_period_end <= datetime('now', '+14 days')
      UNION ALL
      SELECT 'processing' AS kind, id, 'Processing job needs recovery' AS label,
        error_json AS detail, updated_at AS created_at
      FROM processing_jobs WHERE organisation_id = ? AND state IN ('FAILED', 'DEAD_LETTER')
      ORDER BY created_at DESC LIMIT 100
    `).bind(auth.organisationId, auth.organisationId, auth.organisationId),
    context.env.DB.prepare(`
      SELECT lr.id, lr.trigger_type, lr.status, lr.summary_json, lr.started_at,
        lr.completed_at, lr.error_message,
        COUNT(la.id) AS action_count
      FROM lifecycle_runs lr
      LEFT JOIN lifecycle_actions la ON la.run_id = lr.id
      WHERE EXISTS (
        SELECT 1 FROM lifecycle_actions scoped
        WHERE scoped.run_id = lr.id AND scoped.organisation_id = ?
      )
      GROUP BY lr.id ORDER BY lr.started_at DESC LIMIT 20
    `).bind(auth.organisationId),
    context.env.DB.prepare(`
      SELECT c.id, c.project_id, p.name AS project_name, c.plan_code, c.status,
        c.amount_cents, c.currency, c.payment_provider, c.provider_checkout_id,
        c.payment_status, c.checkout_url, c.last_error, c.expires_at,
        c.completed_at, c.created_at
      FROM billing_checkout_sessions c
      JOIN projects p ON p.id = c.project_id
      WHERE c.organisation_id = ?
      ORDER BY c.created_at DESC LIMIT 100
    `).bind(auth.organisationId),
  ]);
  return context.json({
    paymentProviderConfigured: Boolean(stripeBillingConfig(context.env)),
    manualBillingEnabled: auth.role === "platform_admin",
    plans: requiredBatchResult(results, 0).results,
    subscriptions: requiredBatchResult(results, 1).results,
    invoices: requiredBatchResult(results, 2).results,
    alerts: requiredBatchResult(results, 3).results,
    lifecycleRuns: requiredBatchResult(results, 4).results,
    checkouts: requiredBatchResult(results, 5).results,
  });
});

app.post("/api/admin/billing/invoices", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = manualInvoiceIssueSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, parsed.data.projectId);
  if (!project) return notFound(context, "Project not found");
  const plan = await context.env.DB.prepare(`
    SELECT code, name FROM hosting_plans WHERE code = ? AND active = 1
  `).bind(parsed.data.planCode).first<{ code: string; name: string }>();
  if (!plan) return notFound(context, "Hosting plan not found");
  const requestHash = await sha256Hex(JSON.stringify({
    projectId: project.id,
    planCode: parsed.data.planCode,
    amountCents: parsed.data.amountCents,
    currency: parsed.data.currency,
    periodStart: parsed.data.periodStart,
    periodEnd: parsed.data.periodEnd,
    dueAt: parsed.data.dueAt,
    archiveOnExpiry: parsed.data.archiveOnExpiry,
    externalReference: parsed.data.externalReference ?? null,
    note: parsed.data.note ?? null,
  }));
  const existingOperation = await context.env.DB.prepare(`
    SELECT request_hash, invoice_id, subscription_id
    FROM billing_manual_operations
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(auth.organisationId, parsed.data.clientOperationId).first<ManualBillingOperationRow>();
  if (existingOperation) {
    if (existingOperation.request_hash !== requestHash) {
      return conflict(context, "This billing operation identifier was already used for a different invoice");
    }
    const state = await manualBillingState(
      context.env.DB,
      auth.organisationId,
      existingOperation.invoice_id,
      existingOperation.subscription_id,
    );
    return context.json({ ...state, idempotent: true });
  }
  const invoiceId = crypto.randomUUID();
  const subscriptionId = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO project_hosting_subscriptions (
        id, organisation_id, project_id, plan_code, status,
        current_period_start, current_period_end, renews_automatically,
        archive_on_expiry, created_by, payment_provider, billing_note
      ) VALUES (?, ?, ?, ?, 'past_due', ?, ?, 0, ?, ?, 'manual', ?)
    `).bind(
      subscriptionId,
      auth.organisationId,
      project.id,
      parsed.data.planCode,
      parsed.data.periodStart,
      parsed.data.periodEnd,
      parsed.data.archiveOnExpiry ? 1 : 0,
      auth.userId,
      parsed.data.note ?? null,
    ),
    context.env.DB.prepare(`
      INSERT INTO billing_invoices (
        id, organisation_id, project_id, subscription_id, status,
        currency, amount_cents, period_start, period_end, due_at,
        payment_provider, billing_method, external_reference, note,
        issued_by, updated_at
      ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 'manual', 'manual', ?, ?, ?, datetime('now'))
    `).bind(
      invoiceId,
      auth.organisationId,
      project.id,
      subscriptionId,
      parsed.data.currency,
      parsed.data.amountCents,
      parsed.data.periodStart,
      parsed.data.periodEnd,
      parsed.data.dueAt,
      parsed.data.externalReference ?? null,
      parsed.data.note ?? null,
      auth.userId,
    ),
    context.env.DB.prepare(`
      INSERT INTO billing_manual_operations (
        id, organisation_id, project_id, subscription_id, invoice_id,
        client_operation_id, operation, request_hash, note, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'issue_invoice', ?, ?, ?)
    `).bind(
      operationId,
      auth.organisationId,
      project.id,
      subscriptionId,
      invoiceId,
      parsed.data.clientOperationId,
      requestHash,
      parsed.data.note ?? null,
      auth.userId,
    ),
  ]);
  await audit(context, auth, "billing.manual.invoice.issue", "billing_invoice", invoiceId, {
    projectId: project.id,
    subscriptionId,
    planCode: parsed.data.planCode,
    amountCents: parsed.data.amountCents,
    currency: parsed.data.currency,
    externalReference: parsed.data.externalReference ?? null,
  });
  const state = await manualBillingState(
    context.env.DB,
    auth.organisationId,
    invoiceId,
    subscriptionId,
  );
  return context.json({ ...state, idempotent: false }, 201);
});

app.post("/api/admin/billing/invoices/:invoiceId/transition", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = manualInvoiceTransitionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const invoice = await context.env.DB.prepare(`
    SELECT * FROM billing_invoices
    WHERE id = ? AND organisation_id = ? AND billing_method = 'manual'
  `).bind(
    context.req.param("invoiceId"),
    auth.organisationId,
  ).first<ManualInvoiceRow>();
  if (!invoice) return notFound(context, "Manual invoice not found");
  const requestHash = await sha256Hex(JSON.stringify({
    invoiceId: invoice.id,
    status: parsed.data.status,
    paymentReference: parsed.data.paymentReference ?? null,
    note: parsed.data.note ?? null,
  }));
  const existingOperation = await context.env.DB.prepare(`
    SELECT request_hash, invoice_id, subscription_id
    FROM billing_manual_operations
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(auth.organisationId, parsed.data.clientOperationId).first<ManualBillingOperationRow>();
  if (existingOperation) {
    if (existingOperation.request_hash !== requestHash) {
      return conflict(context, "This billing operation identifier was already used for a different transition");
    }
    const state = await manualBillingState(
      context.env.DB,
      auth.organisationId,
      existingOperation.invoice_id,
      existingOperation.subscription_id,
    );
    return context.json({ ...state, idempotent: true });
  }
  if (invoice.status !== "open") {
    return conflict(context, `A ${invoice.status} invoice cannot transition to ${parsed.data.status}`);
  }
  const operation = parsed.data.status === "paid" ? "mark_paid" : "void_invoice";
  const targetSubscriptionStatus = parsed.data.status === "paid" ? "active" : "cancelled";
  const operationId = crypto.randomUUID();
  const results = await context.env.DB.batch([
    context.env.DB.prepare(`
      UPDATE billing_invoices
      SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE NULL END,
        payment_reference = CASE WHEN ? = 'paid' THEN ? ELSE payment_reference END,
        note = COALESCE(?, note), updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ? AND billing_method = 'manual' AND status = 'open'
    `).bind(
      parsed.data.status,
      parsed.data.status,
      parsed.data.status,
      parsed.data.paymentReference ?? null,
      parsed.data.note ?? null,
      invoice.id,
      auth.organisationId,
    ),
    context.env.DB.prepare(`
      UPDATE project_hosting_subscriptions
      SET status = ?, activated_at = CASE WHEN ? = 'active' THEN datetime('now') ELSE activated_at END,
        renews_automatically = 0, billing_note = COALESCE(?, billing_note),
        updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
        AND EXISTS (
          SELECT 1 FROM billing_invoices
          WHERE id = ? AND organisation_id = ? AND status = ?
        )
    `).bind(
      targetSubscriptionStatus,
      targetSubscriptionStatus,
      parsed.data.note ?? null,
      invoice.subscription_id,
      auth.organisationId,
      invoice.id,
      auth.organisationId,
      parsed.data.status,
    ),
    context.env.DB.prepare(`
      INSERT INTO billing_manual_operations (
        id, organisation_id, project_id, subscription_id, invoice_id,
        client_operation_id, operation, request_hash, payment_reference,
        note, created_by
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM billing_invoices
        WHERE id = ? AND organisation_id = ? AND status = ?
      )
    `).bind(
      operationId,
      auth.organisationId,
      invoice.project_id,
      invoice.subscription_id,
      invoice.id,
      parsed.data.clientOperationId,
      operation,
      requestHash,
      parsed.data.paymentReference ?? null,
      parsed.data.note ?? null,
      auth.userId,
      invoice.id,
      auth.organisationId,
      parsed.data.status,
    ),
  ]);
  if ((requiredBatchResult(results, 2).meta.changes ?? 0) !== 1) {
    return conflict(context, "Invoice state changed concurrently; refresh before retrying");
  }
  await audit(context, auth, `billing.manual.invoice.${parsed.data.status}`, "billing_invoice", invoice.id, {
    projectId: invoice.project_id,
    subscriptionId: invoice.subscription_id,
    paymentReference: parsed.data.paymentReference ?? null,
  });
  const state = await manualBillingState(
    context.env.DB,
    auth.organisationId,
    invoice.id,
    invoice.subscription_id,
  );
  return context.json({ ...state, idempotent: false });
});

app.post("/api/admin/billing/subscriptions/:subscriptionId/transition", async (context) => {
  const auth = await requireAdministrator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = manualSubscriptionTransitionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const subscription = await context.env.DB.prepare(`
    SELECT * FROM project_hosting_subscriptions
    WHERE id = ? AND organisation_id = ? AND payment_provider = 'manual'
  `).bind(
    context.req.param("subscriptionId"),
    auth.organisationId,
  ).first<ManualSubscriptionRow>();
  if (!subscription) return notFound(context, "Manual subscription not found");
  const requestHash = await sha256Hex(JSON.stringify({
    subscriptionId: subscription.id,
    status: parsed.data.status,
    note: parsed.data.note,
  }));
  const existingOperation = await context.env.DB.prepare(`
    SELECT request_hash, invoice_id, subscription_id
    FROM billing_manual_operations
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(auth.organisationId, parsed.data.clientOperationId).first<ManualBillingOperationRow>();
  if (existingOperation) {
    if (existingOperation.request_hash !== requestHash) {
      return conflict(context, "This billing operation identifier was already used for a different transition");
    }
    const state = await manualBillingState(
      context.env.DB,
      auth.organisationId,
      existingOperation.invoice_id,
      existingOperation.subscription_id,
    );
    return context.json({ ...state, idempotent: true });
  }
  if (subscription.status === parsed.data.status) {
    return context.json({
      invoice: null,
      subscription,
      idempotent: true,
    });
  }
  const allowed = subscription.status === "active"
    ? ["past_due", "cancelled", "expired"]
    : subscription.status === "past_due"
      ? ["cancelled", "expired"]
      : [];
  if (!allowed.includes(parsed.data.status)) {
    return conflict(context, `A ${subscription.status} subscription cannot transition to ${parsed.data.status}`);
  }
  const operation = parsed.data.status === "past_due"
    ? "mark_past_due"
    : parsed.data.status === "cancelled"
      ? "cancel_subscription"
      : "expire_subscription";
  const operationId = crypto.randomUUID();
  const results = await context.env.DB.batch([
    context.env.DB.prepare(`
      UPDATE project_hosting_subscriptions
      SET status = ?, renews_automatically = 0, billing_note = ?,
        updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ? AND payment_provider = 'manual'
        AND status = ?
    `).bind(
      parsed.data.status,
      parsed.data.note,
      subscription.id,
      auth.organisationId,
      subscription.status,
    ),
    context.env.DB.prepare(`
      INSERT INTO billing_manual_operations (
        id, organisation_id, project_id, subscription_id, invoice_id,
        client_operation_id, operation, request_hash, note, created_by
      )
      SELECT ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM project_hosting_subscriptions
        WHERE id = ? AND organisation_id = ? AND status = ?
      )
    `).bind(
      operationId,
      auth.organisationId,
      subscription.project_id,
      subscription.id,
      parsed.data.clientOperationId,
      operation,
      requestHash,
      parsed.data.note,
      auth.userId,
      subscription.id,
      auth.organisationId,
      parsed.data.status,
    ),
  ]);
  if ((requiredBatchResult(results, 1).meta.changes ?? 0) !== 1) {
    return conflict(context, "Subscription state changed concurrently; refresh before retrying");
  }
  await audit(context, auth, `billing.manual.subscription.${parsed.data.status}`, "hosting_subscription", subscription.id, {
    projectId: subscription.project_id,
    note: parsed.data.note,
  });
  const state = await manualBillingState(
    context.env.DB,
    auth.organisationId,
    null,
    subscription.id,
  );
  return context.json({ ...state, idempotent: false });
});

app.post("/api/billing/stripe/webhook", async (context) => {
  const config = stripeBillingConfig(context.env);
  if (!config) {
    return context.json({ error: "Stripe webhook processing is not configured" }, 503);
  }
  const rawBody = await context.req.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1_048_576) {
    return context.json({ error: "Webhook body is too large" }, 413);
  }
  const signature = context.req.header("stripe-signature") ?? null;
  if (!(await verifyStripeWebhookSignature(rawBody, signature, config.webhookSecret))) {
    return context.json({ error: "Stripe webhook signature is invalid or stale" }, 400);
  }
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    event = parsed as Record<string, unknown>;
  } catch {
    return context.json({ error: "Stripe webhook body is invalid" }, 400);
  }
  const eventId = readStringProperty(event, "id");
  const eventType = readStringProperty(event, "type");
  if (!eventId || !eventType || !eventId.startsWith("evt_")) {
    return context.json({ error: "Stripe webhook event identity is invalid" }, 400);
  }
  const payloadHash = await sha256Hex(rawBody);
  const existing = await context.env.DB.prepare(`
    SELECT payload_sha256, outcome FROM billing_provider_events
    WHERE provider = 'stripe' AND provider_event_id = ?
  `).bind(eventId).first<{ payload_sha256: string; outcome: string }>();
  if (existing && existing.payload_sha256 !== payloadHash) {
    return conflict(context, "Stripe event identity was reused with a different payload");
  }
  if (existing && ["processed", "ignored"].includes(existing.outcome)) {
    return context.json({ received: true, idempotent: true, outcome: existing.outcome });
  }
  const providerCreatedAt = readFiniteNumber(event, "created");
  if (existing) {
    await context.env.DB.prepare(`
      UPDATE billing_provider_events
      SET outcome = 'processing', error_message = NULL, processed_at = NULL
      WHERE provider = 'stripe' AND provider_event_id = ?
    `).bind(eventId).run();
  } else {
    await context.env.DB.prepare(`
      INSERT INTO billing_provider_events (
        provider, provider_event_id, event_type, payload_sha256,
        provider_created_at, outcome
      ) VALUES ('stripe', ?, ?, ?, ?, 'processing')
    `).bind(
      eventId,
      eventType,
      payloadHash,
      providerCreatedAt ? new Date(providerCreatedAt * 1000).toISOString() : null,
    ).run();
  }
  try {
    const outcome = await applyStripeBillingEvent(context.env.DB, eventId, eventType, event);
    await context.env.DB.prepare(`
      UPDATE billing_provider_events
      SET outcome = ?, processed_at = datetime('now'), error_message = NULL
      WHERE provider = 'stripe' AND provider_event_id = ?
    `).bind(outcome, eventId).run();
    return context.json({ received: true, idempotent: false, outcome });
  } catch (error) {
    const message = errorMessage(error).slice(0, 500);
    await context.env.DB.prepare(`
      UPDATE billing_provider_events
      SET outcome = 'failed', processed_at = datetime('now'), error_message = ?
      WHERE provider = 'stripe' AND provider_event_id = ?
    `).bind(message, eventId).run();
    return context.json({ error: "Stripe event could not be reconciled" }, 500);
  }
});

app.post("/api/hosting/lifecycle/run", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const result = await runLifecycleEnforcement(context.env, "manual");
  await audit(context, auth, "lifecycle.enforce", "lifecycle_run", result.runId, result.summary);
  return context.json(result);
});

app.post("/api/projects/:projectId/retention/restore-drill", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const asset = await context.env.DB.prepare(`
    SELECT id, object_key, size_bytes, etag FROM assets
    WHERE project_id = ? AND organisation_id = ? AND deleted_at IS NULL
    ORDER BY CASE kind WHEN 'master' THEN 1 WHEN 'web' THEN 2 ELSE 3 END, created_at DESC
    LIMIT 1
  `).bind(project.id, auth.organisationId).first<{
    id: string;
    object_key: string;
    size_bytes: number;
    etag: string | null;
  }>();
  if (!asset) return notFound(context, "No retained asset is available for a restore drill");
  const runId = crypto.randomUUID();
  await context.env.DB.prepare(`
    INSERT INTO lifecycle_runs (id, trigger_type, status)
    VALUES (?, 'restore_drill', 'running')
  `).bind(runId).run();
  try {
    const stored = await context.env.SPATIAL_ASSETS.get(asset.object_key, { range: { offset: 0, length: 64 } });
    if (!stored) throw new Error("The retained R2 object is missing");
    const sample = await stored.arrayBuffer();
    if (asset.size_bytes > 0 && sample.byteLength === 0) throw new Error("The retained object returned no readable bytes");
    await context.env.DB.batch([
      context.env.DB.prepare(`
        INSERT INTO lifecycle_actions
          (id, run_id, organisation_id, project_id, action, resource_type, resource_id, metadata_json)
        VALUES (?, ?, ?, ?, 'restore_verified', 'asset', ?, ?)
      `).bind(
        crypto.randomUUID(),
        runId,
        auth.organisationId,
        project.id,
        asset.id,
        JSON.stringify({ sampleBytes: sample.byteLength, expectedBytes: asset.size_bytes, etag: asset.etag }),
      ),
      context.env.DB.prepare(`
        UPDATE lifecycle_runs SET status = 'succeeded', completed_at = datetime('now'),
          summary_json = ? WHERE id = ?
      `).bind(JSON.stringify({ restoredAssets: 1, sampledBytes: sample.byteLength }), runId),
    ]);
    await audit(context, auth, "retention.restore_drill", "asset", asset.id, { runId, sampledBytes: sample.byteLength });
    return context.json({
      runId,
      status: "succeeded",
      assetId: asset.id,
      sampledBytes: sample.byteLength,
      expectedBytes: asset.size_bytes,
    });
  } catch (error) {
    const message = errorMessage(error).slice(0, 1000);
    await context.env.DB.prepare(`
      UPDATE lifecycle_runs SET status = 'failed', completed_at = datetime('now'),
        error_message = ? WHERE id = ?
    `).bind(message, runId).run();
    return context.json({ error: `Restore drill failed: ${message}`, requestId: context.get("requestId") }, 409);
  }
});

app.put("/api/projects/:projectId/hosting", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = hostingSubscriptionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const plan = await context.env.DB.prepare(
    "SELECT code, monthly_price_cents FROM hosting_plans WHERE code = ? AND active = 1",
  ).bind(parsed.data.planCode).first<{ code: string; monthly_price_cents: number }>();
  if (!plan) return notFound(context, "Hosting plan not found");
  if (plan.code === "enterprise" || plan.monthly_price_cents === 0) {
    return conflict(context, "Enterprise private hosting requires a signed contract and manual provisioning");
  }
  const config = stripeBillingConfig(context.env);
  if (!config) {
    return context.json({
      error: "The payment provider is not configured; no subscription or invoice was created",
      retryable: false,
      requestId: context.get("requestId"),
    }, 503);
  }
  const planCode = plan.code as StripePlanCode;
  const requestHash = await sha256Hex(JSON.stringify({
    projectId: project.id,
    planCode,
    renewsAutomatically: parsed.data.renewsAutomatically,
    archiveOnExpiry: parsed.data.archiveOnExpiry,
  }));
  let checkout = await context.env.DB.prepare(`
    SELECT * FROM billing_checkout_sessions
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(
    auth.organisationId,
    parsed.data.clientOperationId,
  ).first<BillingCheckoutRow>();
  if (checkout && checkout.request_hash !== requestHash) {
    return conflict(context, "This checkout operation identifier was already used for different settings");
  }
  if (
    checkout &&
    checkout.provider_checkout_id &&
    checkout.checkout_url &&
    ["open", "complete"].includes(checkout.status)
  ) {
    return context.json({
      checkout: publicBillingCheckout(checkout),
      idempotent: true,
    });
  }
  const checkoutId = checkout?.id ?? crypto.randomUUID();
  if (!checkout) {
    await context.env.DB.prepare(`
      INSERT INTO billing_checkout_sessions (
        id, organisation_id, project_id, plan_code, status, amount_cents,
        currency, customer_email, archive_on_expiry, request_hash,
        client_operation_id, created_by
      ) VALUES (?, ?, ?, ?, 'pending', ?, 'MYR', ?, ?, ?, ?, ?)
    `).bind(
      checkoutId,
      auth.organisationId,
      project.id,
      planCode,
      plan.monthly_price_cents,
      auth.email,
      parsed.data.archiveOnExpiry ? 1 : 0,
      requestHash,
      parsed.data.clientOperationId,
      auth.userId,
    ).run();
  } else {
    await context.env.DB.prepare(`
      UPDATE billing_checkout_sessions
      SET status = 'pending', last_error = NULL, updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(checkoutId, auth.organisationId).run();
  }
  try {
    const providerCheckout = await createStripeCheckoutSession(config, {
      checkoutId,
      organisationId: auth.organisationId,
      projectId: project.id,
      planCode,
      customerEmail: auth.email,
      successUrl: `${context.env.APP_ORIGIN}/studio.html?checkout=success&session_id={CHECKOUT_SESSION_ID}#hosting`,
      cancelUrl: `${context.env.APP_ORIGIN}/studio.html?checkout=cancelled#hosting`,
    });
    await context.env.DB.prepare(`
      UPDATE billing_checkout_sessions
      SET status = ?, provider_checkout_id = ?, provider_customer_id = ?,
        provider_subscription_id = ?, checkout_url = ?, payment_status = ?,
        expires_at = ?, last_error = NULL, updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(
      providerCheckout.status === "open" ? "open" : "pending",
      providerCheckout.id,
      providerCheckout.customerId,
      providerCheckout.subscriptionId,
      providerCheckout.url,
      providerCheckout.paymentStatus,
      providerCheckout.expiresAt
        ? new Date(providerCheckout.expiresAt * 1000).toISOString()
        : null,
      checkoutId,
      auth.organisationId,
    ).run();
    checkout = await context.env.DB.prepare(
      "SELECT * FROM billing_checkout_sessions WHERE id = ? AND organisation_id = ?",
    ).bind(checkoutId, auth.organisationId).first<BillingCheckoutRow>();
    await audit(context, auth, "billing.checkout.create", "billing_checkout", checkoutId, {
      projectId: project.id,
      planCode,
      provider: "stripe",
      providerCheckoutId: providerCheckout.id,
    });
    return context.json({
      checkout: publicBillingCheckout(checkout!),
      idempotent: false,
    }, 201);
  } catch (error) {
    const providerError = error instanceof StripeBillingError
      ? error
      : new StripeBillingError(errorMessage(error), 503, null, true);
    await context.env.DB.prepare(`
      UPDATE billing_checkout_sessions
      SET status = 'failed', last_error = ?, updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(providerError.message.slice(0, 500), checkoutId, auth.organisationId).run();
    await audit(context, auth, "billing.checkout.failed", "billing_checkout", checkoutId, {
      providerCode: providerError.providerCode,
      providerStatus: providerError.status,
      retryable: providerError.retryable,
    });
    return context.json({
      error: providerError.message,
      providerCode: providerError.providerCode,
      retryable: providerError.retryable,
      requestId: context.get("requestId"),
    }, providerError.retryable ? 503 : 409);
  }
});

app.post("/api/projects/:projectId/hosting/renew", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  return context.json({
    error: "Provider-managed subscriptions renew through Stripe; start a new checkout to recover a past-due plan",
    retryable: false,
    requestId: context.get("requestId"),
  }, 409);
});

app.post("/api/projects/:projectId/hosting/cancel", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const subscription = await context.env.DB.prepare(`
    SELECT id, status, payment_provider, provider_subscription_id, current_period_end
    FROM project_hosting_subscriptions
    WHERE project_id = ? AND organisation_id = ? AND status IN ('trial', 'active', 'past_due')
    ORDER BY created_at DESC LIMIT 1
  `).bind(context.req.param("projectId"), auth.organisationId).first<{
    id: string;
    status: string;
    payment_provider: string | null;
    provider_subscription_id: string | null;
    current_period_end: string;
  }>();
  if (!subscription) return notFound(context, "Active hosting subscription not found");
  if (subscription.payment_provider !== "stripe" || !subscription.provider_subscription_id) {
    return conflict(context, "This legacy hosting record has no provider subscription to cancel");
  }
  const config = stripeBillingConfig(context.env);
  if (!config) {
    return context.json({
      error: "The payment provider is not configured; refusing to claim the subscription was cancelled",
      retryable: false,
      requestId: context.get("requestId"),
    }, 503);
  }
  try {
    const provider = await cancelStripeSubscriptionAtPeriodEnd(
      config,
      subscription.provider_subscription_id,
    );
    await context.env.DB.prepare(`
      UPDATE project_hosting_subscriptions
      SET renews_automatically = 0, provider_cancel_at_period_end = ?,
        current_period_end = COALESCE(?, current_period_end),
        updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(
      provider.cancelAtPeriodEnd ? 1 : 0,
      provider.currentPeriodEnd
        ? new Date(provider.currentPeriodEnd * 1000).toISOString()
        : null,
      subscription.id,
      auth.organisationId,
    ).run();
    await audit(context, auth, "hosting.subscription.cancel_at_period_end", "hosting_subscription", subscription.id, {
      provider: "stripe",
      providerSubscriptionId: subscription.provider_subscription_id,
      cancelAtPeriodEnd: provider.cancelAtPeriodEnd,
    });
    return context.json({
      subscription: {
        id: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: provider.cancelAtPeriodEnd,
        currentPeriodEnd: provider.currentPeriodEnd
          ? new Date(provider.currentPeriodEnd * 1000).toISOString()
          : subscription.current_period_end,
      },
    });
  } catch (error) {
    const providerError = error instanceof StripeBillingError
      ? error
      : new StripeBillingError(errorMessage(error), 503, null, true);
    return context.json({
      error: providerError.message,
      providerCode: providerError.providerCode,
      retryable: providerError.retryable,
      requestId: context.get("requestId"),
    }, providerError.retryable ? 503 : 409);
  }
});

app.put("/api/projects/:projectId/retention", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = retentionPolicySchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  await context.env.DB.prepare(`
    INSERT INTO project_retention_policies
      (project_id, organisation_id, raw_retention_days, derivative_retention_days,
        release_retention_days, delete_after, legal_hold, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      raw_retention_days = excluded.raw_retention_days,
      derivative_retention_days = excluded.derivative_retention_days,
      release_retention_days = excluded.release_retention_days,
      delete_after = excluded.delete_after,
      legal_hold = excluded.legal_hold,
      updated_by = excluded.updated_by,
      updated_at = datetime('now')
  `).bind(
    project.id,
    auth.organisationId,
    parsed.data.rawRetentionDays,
    parsed.data.derivativeRetentionDays,
    parsed.data.releaseRetentionDays,
    parsed.data.deleteAfter ?? null,
    parsed.data.legalHold ? 1 : 0,
    auth.userId,
  ).run();
  await audit(context, auth, "retention.policy.update", "project", project.id, parsed.data);
  return context.json({ policy: parsed.data });
});

app.get("/api/projects/:projectId/spatial", async (context) => {
  const access = await requireReviewProject(context, context.req.param("projectId"));
  if (access instanceof Response) return access;
  const versionId = context.req.query("versionId") ?? access.project.latest_version_id;
  if (!versionId) return context.json({
    versionId: null,
    entities: [],
    routes: [],
    routeStops: [],
    privacyRegions: [],
    privacyScans: [],
    privacyCandidates: [],
    changeReports: [],
    captureCompletenessReports: [],
    rawChangeReports: [],
    semanticExtractions: [],
    semanticCandidates: [],
    floorplanExtractions: [],
    floorplanRevisions: [],
    floorplanExports: [],
    navigationObstacles: [],
    deliveryPolicy: null,
    collisionProxy: { version: "box-union-v1", boxes: [] },
    navigationMesh: { version: "room-box-triangles-v1", vertices: [], indices: [], sourceEntityIds: [] },
    obstacleProxy: { version: "authored-obstacle-boxes-v1", boxes: [] },
    navigationProfile: defaultNavigationProfile,
  });
  const version = await context.env.DB.prepare(
    "SELECT id, version_number FROM scene_versions WHERE id = ? AND project_id = ?",
  ).bind(versionId, access.project.id).first<{ id: string; version_number: number }>();
  if (!version) return notFound(context, "Scene version not found");
  const results = await context.env.DB.batch([
    context.env.DB.prepare(`
      SELECT * FROM scene_entities WHERE version_id = ? AND project_id = ? AND status = 'active'
      ORDER BY kind, sort_order, label
    `).bind(version.id, access.project.id),
    context.env.DB.prepare(`
      SELECT * FROM scene_routes WHERE version_id = ? AND project_id = ? AND status = 'active'
      ORDER BY created_at
    `).bind(version.id, access.project.id),
    context.env.DB.prepare(`
      SELECT rs.* FROM scene_route_stops rs JOIN scene_routes r ON r.id = rs.route_id
      WHERE r.version_id = ? AND r.project_id = ? ORDER BY rs.route_id, rs.sequence_number
    `).bind(version.id, access.project.id),
    context.env.DB.prepare(`
      SELECT * FROM privacy_regions WHERE version_id = ? AND project_id = ?
      ORDER BY created_at DESC
    `).bind(version.id, access.project.id),
    context.env.DB.prepare(`
      SELECT * FROM privacy_scans
      WHERE version_id = ? AND project_id = ? AND organisation_id = ?
      ORDER BY created_at DESC LIMIT 25
    `).bind(version.id, access.project.id, access.auth.organisationId),
    context.env.DB.prepare(`
      SELECT pc.*, a.file_name AS asset_file_name, a.mime_type AS asset_mime_type
      FROM privacy_candidates pc
      JOIN assets a ON a.id = pc.asset_id
      WHERE pc.version_id = ? AND pc.project_id = ? AND pc.organisation_id = ?
      ORDER BY pc.created_at DESC LIMIT 250
    `).bind(version.id, access.project.id, access.auth.organisationId),
    context.env.DB.prepare(`
      SELECT * FROM change_detection_reports WHERE project_id = ? AND organisation_id = ?
      ORDER BY created_at DESC LIMIT 50
    `).bind(access.project.id, access.auth.organisationId),
    context.env.DB.prepare(`
      SELECT * FROM capture_completeness_reports
      WHERE project_id = ? AND organisation_id = ?
      ORDER BY created_at DESC LIMIT 25
    `).bind(access.project.id, access.auth.organisationId),
    context.env.DB.prepare(`
      SELECT r.*, j.state AS job_state, j.progress AS job_progress,
        j.progress_message AS job_progress_message, j.attempt_count,
        j.max_attempts, j.error_json AS job_error_json,
        bv.version_number AS baseline_version_number,
        cv.version_number AS candidate_version_number,
        ba.file_name AS baseline_file_name,
        ca.file_name AS candidate_file_name
      FROM registered_scene_change_reports r
      JOIN processing_jobs j ON j.id = r.job_id
      JOIN scene_versions bv ON bv.id = r.baseline_version_id
      JOIN scene_versions cv ON cv.id = r.candidate_version_id
      JOIN assets ba ON ba.id = r.baseline_asset_id
      JOIN assets ca ON ca.id = r.candidate_asset_id
      WHERE r.project_id = ? AND r.organisation_id = ?
      ORDER BY r.created_at DESC LIMIT 25
    `).bind(access.project.id, access.auth.organisationId),
    context.env.DB.prepare(`
      SELECT * FROM project_delivery_policies WHERE project_id = ? AND organisation_id = ?
    `).bind(access.project.id, access.auth.organisationId),
    context.env.DB.prepare(`
      SELECT r.*, j.state AS job_state, j.progress AS job_progress,
        j.progress_message AS job_progress_message, j.attempt_count,
        j.max_attempts, j.error_json AS job_error_json,
        a.file_name AS input_file_name, a.size_bytes AS input_size_bytes
      FROM semantic_extraction_runs r
      JOIN processing_jobs j ON j.id = r.job_id
      JOIN assets a ON a.id = r.input_asset_id
      WHERE r.project_id = ? AND r.version_id = ? AND r.organisation_id = ?
      ORDER BY r.created_at DESC LIMIT 25
    `).bind(access.project.id, version.id, access.auth.organisationId),
    context.env.DB.prepare(`
      SELECT * FROM semantic_candidates
      WHERE project_id = ? AND version_id = ? AND organisation_id = ?
      ORDER BY created_at DESC, candidate_key LIMIT 250
    `).bind(access.project.id, version.id, access.auth.organisationId),
    context.env.DB.prepare(`
      SELECT r.*, j.state AS job_state, j.progress AS job_progress,
        j.progress_message AS job_progress_message, j.attempt_count,
        j.max_attempts, j.error_json AS job_error_json,
        a.file_name AS input_file_name, a.format AS input_format,
        a.size_bytes AS input_size_bytes
      FROM floorplan_extraction_runs r
      JOIN processing_jobs j ON j.id = r.job_id
      JOIN assets a ON a.id = r.input_asset_id
      WHERE r.project_id = ? AND r.version_id = ? AND r.organisation_id = ?
      ORDER BY r.created_at DESC LIMIT 25
    `).bind(access.project.id, version.id, access.auth.organisationId),
    context.env.DB.prepare(`
      SELECT * FROM floorplan_revisions
      WHERE project_id = ? AND version_id = ? AND organisation_id = ?
      ORDER BY revision_number DESC, created_at DESC LIMIT 100
    `).bind(access.project.id, version.id, access.auth.organisationId),
    context.env.DB.prepare(`
      SELECT e.*, a.file_name, a.mime_type, a.size_bytes, a.sha256
      FROM floorplan_exports e
      JOIN assets a ON a.id = e.asset_id
      WHERE e.project_id = ? AND e.version_id = ? AND e.organisation_id = ?
      ORDER BY e.created_at DESC LIMIT 300
    `).bind(access.project.id, version.id, access.auth.organisationId),
    context.env.DB.prepare(`
      SELECT * FROM scene_navigation_obstacles
      WHERE project_id = ? AND version_id = ? AND organisation_id = ? AND status = 'active'
      ORDER BY label, created_at
    `).bind(access.project.id, version.id, access.auth.organisationId),
    context.env.DB.prepare(`
      SELECT world_unit, agent_radius, agent_height, eye_height, max_step_metres
      FROM scene_navigation_profiles
      WHERE project_id = ? AND version_id = ? AND organisation_id = ?
    `).bind(access.project.id, version.id, access.auth.organisationId),
  ]);
  const entities = requiredBatchResult(results, 0).results;
  const navigationObstacles = requiredBatchResult(results, 15).results;
  const navigationProfile = requiredBatchResult(results, 16).results[0];
  const runtime = buildSpatialRuntime(entities, navigationObstacles, navigationProfile);
  return context.json({
    version,
    entities,
    routes: requiredBatchResult(results, 1).results,
    routeStops: requiredBatchResult(results, 2).results,
    privacyRegions: requiredBatchResult(results, 3).results,
    privacyScans: requiredBatchResult(results, 4).results,
    privacyCandidates: requiredBatchResult(results, 5).results,
    changeReports: requiredBatchResult(results, 6).results,
    captureCompletenessReports: requiredBatchResult(results, 7).results,
    rawChangeReports: requiredBatchResult(results, 8).results,
    deliveryPolicy: requiredBatchResult(results, 9).results[0] ?? null,
    semanticExtractions: requiredBatchResult(results, 10).results,
    semanticCandidates: requiredBatchResult(results, 11).results.map(
      semanticCandidateApi,
    ),
    floorplanExtractions: requiredBatchResult(results, 12).results,
    floorplanRevisions: requiredBatchResult(results, 13).results,
    floorplanExports: (requiredBatchResult(results, 14).results as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      download_url:
        `/api/projects/${access.project.id}/spatial/floorplan-exports/${String(row.id)}/download`,
    })),
    navigationObstacles,
    collisionProxy: runtime.collisionProxy,
    navigationMesh: runtime.navigationMesh,
    obstacleProxy: runtime.obstacleProxy,
    navigationProfile: runtime.navigationProfile,
  });
});

app.post("/api/projects/:projectId/spatial/entities", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = sceneEntitySchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const version = await context.env.DB.prepare(
    "SELECT id FROM scene_versions WHERE id = ? AND project_id = ?",
  ).bind(parsed.data.versionId, project.id).first<{ id: string }>();
  if (!version) return notFound(context, "Scene version not found");
  if (parsed.data.parentId) {
    const parent = await context.env.DB.prepare(
      "SELECT id FROM scene_entities WHERE id = ? AND version_id = ? AND project_id = ?",
    ).bind(parsed.data.parentId, version.id, project.id).first();
    if (!parent) return validationError(context, { parentId: ["Parent entity is not in this version"] });
  }
  if (parsed.data.clientOperationId) {
    const existing = await context.env.DB.prepare(
      "SELECT * FROM scene_entities WHERE organisation_id = ? AND client_operation_id = ?",
    ).bind(auth.organisationId, parsed.data.clientOperationId).first();
    if (existing) return context.json({ entity: existing, idempotent: true });
  }
  const id = crypto.randomUUID();
  const created = await context.env.DB.prepare(`
    INSERT INTO scene_entities
      (id, organisation_id, project_id, version_id, parent_id, kind, label,
        description, position_json, geometry_json, metadata_json, sort_order,
        client_operation_id, created_by, world_unit)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      COALESCE((
        SELECT world_unit FROM scene_navigation_profiles
        WHERE organisation_id = ? AND project_id = ? AND version_id = ?
      ), 'metres')
    RETURNING world_unit
  `).bind(
    id,
    auth.organisationId,
    project.id,
    version.id,
    parsed.data.parentId ?? null,
    parsed.data.kind,
    parsed.data.label,
    parsed.data.description ?? null,
    parsed.data.position ? JSON.stringify(parsed.data.position) : null,
    parsed.data.geometry ? JSON.stringify(parsed.data.geometry) : null,
    JSON.stringify(parsed.data.metadata),
    parsed.data.sortOrder,
    parsed.data.clientOperationId ?? null,
    auth.userId,
    auth.organisationId,
    project.id,
    version.id,
  ).first<{ world_unit: string }>();
  if (!created) throw new Error("Spatial entity was not persisted");
  const worldUnit = parseWorldUnit(created.world_unit);
  await audit(context, auth, "spatial.entity.create", "scene_entity", id, { kind: parsed.data.kind, versionId: version.id });
  return context.json({ entity: { id, ...parsed.data, world_unit: worldUnit } }, 201);
});

app.patch("/api/projects/:projectId/spatial/entities/:entityId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = sceneEntityUpdateSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const existing = await context.env.DB.prepare(`
    SELECT id, label, description, position_json, geometry_json, metadata_json, sort_order
    FROM scene_entities
    WHERE id = ? AND project_id = ? AND organisation_id = ? AND status = 'active'
  `).bind(
    context.req.param("entityId"),
    context.req.param("projectId"),
    auth.organisationId,
  ).first<{
    id: string;
    label: string;
    description: string | null;
    position_json: string | null;
    geometry_json: string | null;
    metadata_json: string;
    sort_order: number;
  }>();
  if (!existing) return notFound(context, "Spatial entity not found");
  const next = {
    label: parsed.data.label ?? existing.label,
    description: parsed.data.description === undefined
      ? existing.description
      : parsed.data.description,
    positionJson: parsed.data.position === undefined
      ? existing.position_json
      : parsed.data.position === null
      ? null
      : JSON.stringify(parsed.data.position),
    geometryJson: parsed.data.geometry === undefined
      ? existing.geometry_json
      : parsed.data.geometry === null
      ? null
      : JSON.stringify(parsed.data.geometry),
    metadataJson: parsed.data.metadata === undefined
      ? existing.metadata_json
      : JSON.stringify(parsed.data.metadata),
    sortOrder: parsed.data.sortOrder ?? existing.sort_order,
  };
  await context.env.DB.prepare(`
    UPDATE scene_entities
    SET label = ?, description = ?, position_json = ?, geometry_json = ?,
      metadata_json = ?, sort_order = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    next.label,
    next.description,
    next.positionJson,
    next.geometryJson,
    next.metadataJson,
    next.sortOrder,
    existing.id,
  ).run();
  await audit(context, auth, "spatial.entity.update", "scene_entity", existing.id, {
    fields: Object.keys(parsed.data).sort(),
  });
  return context.json({ entity: { id: existing.id, ...next } });
});

app.delete("/api/projects/:projectId/spatial/entities/:entityId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const result = await context.env.DB.prepare(`
    UPDATE scene_entities SET status = 'archived', updated_at = datetime('now')
    WHERE id = ? AND project_id = ? AND organisation_id = ? AND status = 'active'
    RETURNING id
  `).bind(context.req.param("entityId"), context.req.param("projectId"), auth.organisationId).first();
  if (!result) return notFound(context, "Spatial entity not found");
  await audit(context, auth, "spatial.entity.archive", "scene_entity", context.req.param("entityId"));
  return context.body(null, 204);
});

app.post("/api/projects/:projectId/spatial/navigation-obstacles", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = navigationObstacleSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(
    context.env.DB,
    auth.organisationId,
    context.req.param("projectId"),
  );
  if (!project) return notFound(context, "Project not found");
  const version = await context.env.DB.prepare(
    "SELECT id FROM scene_versions WHERE id = ? AND project_id = ?",
  ).bind(parsed.data.versionId, project.id).first<{ id: string }>();
  if (!version) return notFound(context, "Scene version not found");
  if (parsed.data.clientOperationId) {
    const existing = await context.env.DB.prepare(`
      SELECT * FROM scene_navigation_obstacles
      WHERE organisation_id = ? AND client_operation_id = ?
    `).bind(auth.organisationId, parsed.data.clientOperationId).first();
    if (existing) return context.json({ obstacle: existing, idempotent: true });
  }
  const id = crypto.randomUUID();
  const created = await context.env.DB.prepare(`
    INSERT INTO scene_navigation_obstacles
      (id, organisation_id, project_id, version_id, label, bounds_json,
        metadata_json, client_operation_id, created_by, world_unit)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?,
      COALESCE((
        SELECT world_unit FROM scene_navigation_profiles
        WHERE organisation_id = ? AND project_id = ? AND version_id = ?
      ), 'metres')
    RETURNING world_unit
  `).bind(
    id,
    auth.organisationId,
    project.id,
    version.id,
    parsed.data.label,
    JSON.stringify(parsed.data.geometry),
    JSON.stringify(parsed.data.metadata),
    parsed.data.clientOperationId ?? null,
    auth.userId,
    auth.organisationId,
    project.id,
    version.id,
  ).first<{ world_unit: string }>();
  if (!created) throw new Error("Navigation obstacle was not persisted");
  const worldUnit = parseWorldUnit(created.world_unit);
  await audit(context, auth, "spatial.navigation_obstacle.create", "scene_navigation_obstacle", id, {
    versionId: version.id,
    label: parsed.data.label,
  });
  return context.json({ obstacle: { id, ...parsed.data, world_unit: worldUnit } }, 201);
});

app.delete("/api/projects/:projectId/spatial/navigation-obstacles/:obstacleId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const result = await context.env.DB.prepare(`
    UPDATE scene_navigation_obstacles
    SET status = 'archived', updated_at = datetime('now')
    WHERE id = ? AND project_id = ? AND organisation_id = ? AND status = 'active'
    RETURNING id
  `).bind(
    context.req.param("obstacleId"),
    context.req.param("projectId"),
    auth.organisationId,
  ).first();
  if (!result) return notFound(context, "Navigation obstacle not found");
  await audit(
    context,
    auth,
    "spatial.navigation_obstacle.archive",
    "scene_navigation_obstacle",
    context.req.param("obstacleId"),
  );
  return context.body(null, 204);
});

app.put("/api/projects/:projectId/spatial/navigation-profile", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = navigationProfileSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(
    context.env.DB,
    auth.organisationId,
    context.req.param("projectId"),
  );
  if (!project) return notFound(context, "Project not found");
  const version = await context.env.DB.prepare(
    "SELECT id FROM scene_versions WHERE id = ? AND project_id = ?",
  ).bind(parsed.data.versionId, project.id).first<{ id: string }>();
  if (!version) return notFound(context, "Scene version not found");
  const updated = await context.env.DB.prepare(`
    INSERT INTO scene_navigation_profiles (
      version_id, organisation_id, project_id, world_unit, agent_radius,
      agent_height, eye_height, max_step_metres, updated_by
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM scene_entities
      WHERE organisation_id = ? AND project_id = ? AND version_id = ?
        AND status = 'active' AND world_unit <> ?
      UNION ALL
      SELECT 1 FROM scene_navigation_obstacles
      WHERE organisation_id = ? AND project_id = ? AND version_id = ?
        AND status = 'active' AND world_unit <> ?
      UNION ALL
      SELECT 1 FROM measurement_briefs
      WHERE organisation_id = ? AND project_id = ? AND version_id = ?
        AND ? <> 'metres'
    )
    ON CONFLICT(version_id) DO UPDATE SET
      world_unit = excluded.world_unit,
      agent_radius = excluded.agent_radius,
      agent_height = excluded.agent_height,
      eye_height = excluded.eye_height,
      max_step_metres = excluded.max_step_metres,
      updated_by = excluded.updated_by,
      updated_at = datetime('now')
    WHERE scene_navigation_profiles.organisation_id = excluded.organisation_id
      AND scene_navigation_profiles.project_id = excluded.project_id
      AND NOT EXISTS (
        SELECT 1 FROM scene_entities
        WHERE organisation_id = ? AND project_id = ? AND version_id = ?
          AND status = 'active' AND world_unit <> ?
        UNION ALL
        SELECT 1 FROM scene_navigation_obstacles
        WHERE organisation_id = ? AND project_id = ? AND version_id = ?
          AND status = 'active' AND world_unit <> ?
        UNION ALL
        SELECT 1 FROM measurement_briefs
        WHERE organisation_id = ? AND project_id = ? AND version_id = ?
          AND ? <> 'metres'
      )
    RETURNING world_unit
  `).bind(
    version.id,
    auth.organisationId,
    project.id,
    parsed.data.worldUnit,
    parsed.data.agentRadius,
    parsed.data.agentHeight,
    parsed.data.eyeHeight,
    parsed.data.maxStepMetres,
    auth.userId,
    auth.organisationId,
    project.id,
    version.id,
    parsed.data.worldUnit,
    auth.organisationId,
    project.id,
    version.id,
    parsed.data.worldUnit,
    auth.organisationId,
    project.id,
    version.id,
    parsed.data.worldUnit,
    auth.organisationId,
    project.id,
    version.id,
    parsed.data.worldUnit,
    auth.organisationId,
    project.id,
    version.id,
    parsed.data.worldUnit,
    auth.organisationId,
    project.id,
    version.id,
    parsed.data.worldUnit,
  ).first<{ world_unit: string }>();
  if (!updated) {
    return conflict(
      context,
      "This scene version already contains authored geometry or measurement evidence that fixes another unit. Create a new version instead of relabelling the existing coordinates.",
    );
  }
  await audit(context, auth, "spatial.navigation_profile.update", "scene_version", version.id, {
    worldUnit: parsed.data.worldUnit,
    agentRadius: parsed.data.agentRadius,
    agentHeight: parsed.data.agentHeight,
    eyeHeight: parsed.data.eyeHeight,
    maxStepMetres: parsed.data.maxStepMetres,
  });
  return context.json({
    navigationProfile: {
      worldUnit: parsed.data.worldUnit,
      agentRadius: parsed.data.agentRadius,
      agentHeight: parsed.data.agentHeight,
      eyeHeight: parsed.data.eyeHeight,
      maxStepMetres: parsed.data.maxStepMetres,
    },
  });
});

app.post("/api/projects/:projectId/spatial/routes", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = sceneRouteSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const entities = await context.env.DB.prepare(`
    SELECT id FROM scene_entities WHERE project_id = ? AND version_id = ?
      AND id IN (${parsed.data.stops.map(() => "?").join(",")}) AND status = 'active'
  `).bind(project.id, parsed.data.versionId, ...parsed.data.stops.map((stop) => stop.entityId)).all();
  if (entities.results.length !== new Set(parsed.data.stops.map((stop) => stop.entityId)).size) {
    return validationError(context, { stops: ["Every route stop must reference an active entity in this version"] });
  }
  const routeId = crypto.randomUUID();
  const statements = [
    context.env.DB.prepare(`
      INSERT INTO scene_routes
        (id, organisation_id, project_id, version_id, label, description,
          accessibility, estimated_seconds, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      routeId, auth.organisationId, project.id, parsed.data.versionId,
      parsed.data.label, parsed.data.description ?? null, parsed.data.accessibility,
      parsed.data.estimatedSeconds ?? null, auth.userId,
    ),
    ...parsed.data.stops.map((stop, index) => context.env.DB.prepare(`
      INSERT INTO scene_route_stops
        (route_id, entity_id, sequence_number, camera_pose_json, narration)
      VALUES (?, ?, ?, ?, ?)
    `).bind(routeId, stop.entityId, index, stop.cameraPose ? JSON.stringify(stop.cameraPose) : null, stop.narration ?? null)),
  ];
  await context.env.DB.batch(statements);
  await audit(context, auth, "spatial.route.create", "scene_route", routeId, { versionId: parsed.data.versionId });
  return context.json({ route: { id: routeId, ...parsed.data } }, 201);
});

app.post("/api/projects/:projectId/privacy-scans", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = privacyScanSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const version = await context.env.DB.prepare(
    "SELECT id FROM scene_versions WHERE id = ? AND project_id = ?",
  ).bind(parsed.data.versionId, project.id).first<{ id: string }>();
  if (!version) return notFound(context, "Scene version not found");

  const requestHash = await sha256Hex(JSON.stringify({
    versionId: parsed.data.versionId,
    assetIds: parsed.data.assetIds,
    detector: privacyDetectorVersion,
    targets: privacyTargets.map(({ target }) => target),
  }));
  const existing = await context.env.DB.prepare(`
    SELECT * FROM privacy_scans
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(auth.organisationId, parsed.data.clientOperationId).first<PrivacyScanRow>();
  if (existing) {
    if (existing.request_hash !== requestHash || existing.project_id !== project.id) {
      return conflict(context, "Operation ID was already used for a different privacy scan");
    }
    return context.json({ scan: privacyScanApi(existing), idempotent: true }, 202);
  }

  const placeholders = parsed.data.assetIds.map(() => "?").join(",");
  const assets = await context.env.DB.prepare(`
    SELECT * FROM assets
    WHERE organisation_id = ? AND project_id = ? AND version_id = ?
      AND id IN (${placeholders}) AND kind = 'poster'
      AND integrity_status = 'verified' AND deleted_at IS NULL
  `).bind(
    auth.organisationId,
    project.id,
    version.id,
    ...parsed.data.assetIds,
  ).all<AssetRow>();
  if (assets.results.length !== parsed.data.assetIds.length) {
    return validationError(context, {
      assetIds: ["Every privacy input must be a verified poster image in this scene version"],
    });
  }
  for (const asset of assets.results) {
    if (!asset.mime_type.startsWith("image/")) {
      return validationError(context, { assetIds: [`${asset.file_name} is not an image`] });
    }
    if (asset.size_bytes > maximumPrivacyImageBytes) {
      return validationError(context, {
        assetIds: [`${asset.file_name} exceeds the 10 MiB privacy-input limit`],
      });
    }
    if (!(await context.env.SPATIAL_ASSETS.head(asset.object_key))) {
      return validationError(context, { assetIds: [`${asset.file_name} is missing from private storage`] });
    }
  }

  const scanId = crypto.randomUUID();
  const targetsJson = JSON.stringify(privacyTargets);
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO privacy_scans
        (id, organisation_id, project_id, version_id, client_operation_id,
          request_hash, detector, detector_version, targets_json, status,
          input_count, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)
    `).bind(
      scanId,
      auth.organisationId,
      project.id,
      version.id,
      parsed.data.clientOperationId,
      requestHash,
      privacyDetector,
      privacyDetectorVersion,
      targetsJson,
      assets.results.length,
      auth.userId,
    ),
    ...assets.results.map((asset) => context.env.DB.prepare(`
      INSERT INTO privacy_scan_inputs
        (scan_id, asset_id, asset_sha256, mime_type, size_bytes)
      VALUES (?, ?, ?, ?, ?)
    `).bind(scanId, asset.id, asset.sha256, asset.mime_type, asset.size_bytes)),
  ]);
  try {
    await context.env.PRIVACY_SCAN_QUEUE.send({ scanId } satisfies PrivacyScanQueueMessage, {
      contentType: "json",
    });
  } catch (error) {
    await markPrivacyScanEnqueueFailure(context.env.DB, scanId, error);
    return context.json({
      error: "Privacy scan could not be queued",
      scan: { id: scanId, status: "FAILED" },
      retryable: true,
      requestId: context.get("requestId"),
    }, 503);
  }
  await audit(context, auth, "privacy.scan.queue", "privacy_scan", scanId, {
    versionId: version.id,
    assetIds: parsed.data.assetIds,
    detector: privacyDetectorVersion,
  });
  const scan = await context.env.DB.prepare(
    "SELECT * FROM privacy_scans WHERE id = ?",
  ).bind(scanId).first<PrivacyScanRow>();
  return context.json({ scan: privacyScanApi(scan!) }, 202);
});

app.post("/api/projects/:projectId/privacy-scans/:scanId/retry", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const scan = await context.env.DB.prepare(`
    SELECT * FROM privacy_scans
    WHERE id = ? AND project_id = ? AND organisation_id = ?
  `).bind(
    context.req.param("scanId"),
    context.req.param("projectId"),
    auth.organisationId,
  ).first<PrivacyScanRow>();
  if (!scan) return notFound(context, "Privacy scan not found");
  if (scan.status === "COMPLETED") return conflict(context, "Completed privacy scans cannot be retried");
  if (scan.status === "RUNNING") return conflict(context, "Privacy scan is already running");
  await context.env.DB.prepare(`
    UPDATE privacy_scans
    SET status = 'QUEUED', error_json = NULL, completed_at = NULL,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(scan.id).run();
  try {
    await context.env.PRIVACY_SCAN_QUEUE.send({ scanId: scan.id } satisfies PrivacyScanQueueMessage, {
      contentType: "json",
    });
  } catch (error) {
    await markPrivacyScanEnqueueFailure(context.env.DB, scan.id, error);
    return context.json({
      error: "Privacy scan could not be queued",
      scan: { id: scan.id, status: "FAILED" },
      retryable: true,
      requestId: context.get("requestId"),
    }, 503);
  }
  await audit(context, auth, "privacy.scan.retry", "privacy_scan", scan.id);
  const queued = await context.env.DB.prepare(
    "SELECT * FROM privacy_scans WHERE id = ?",
  ).bind(scan.id).first<PrivacyScanRow>();
  return context.json({ scan: privacyScanApi(queued!) }, 202);
});

app.get("/api/projects/:projectId/privacy-assets/:assetId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  const asset = await context.env.DB.prepare(`
    SELECT * FROM assets
    WHERE id = ? AND project_id = ? AND organisation_id = ?
      AND kind = 'poster' AND integrity_status = 'verified' AND deleted_at IS NULL
  `).bind(
    context.req.param("assetId"),
    context.req.param("projectId"),
    auth.organisationId,
  ).first<AssetRow>();
  if (!asset) return notFound(context, "Privacy input asset not found");
  const response = await serveR2Object(context, asset.object_key);
  response.headers.set("Content-Type", asset.mime_type);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

app.patch("/api/projects/:projectId/privacy-candidates/:candidateId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = privacyCandidateDecisionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const result = await context.env.DB.prepare(`
    UPDATE privacy_candidates
    SET status = ?, decision_note = ?, reviewed_by = ?,
      reviewed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND project_id = ? AND organisation_id = ?
    RETURNING id, status, decision_note, reviewed_at
  `).bind(
    parsed.data.status,
    parsed.data.note,
    auth.userId,
    context.req.param("candidateId"),
    context.req.param("projectId"),
    auth.organisationId,
  ).first();
  if (!result) return notFound(context, "Privacy candidate not found");
  await audit(
    context,
    auth,
    "privacy.candidate.review",
    "privacy_candidate",
    context.req.param("candidateId"),
    parsed.data,
  );
  return context.json({ privacyCandidate: result });
});

app.post("/api/projects/:projectId/spatial/privacy-regions", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = privacyRegionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const id = crypto.randomUUID();
  await context.env.DB.prepare(`
    INSERT INTO privacy_regions
      (id, organisation_id, project_id, version_id, label, geometry_json, source, confidence)
    SELECT ?, ?, ?, id, ?, ?, ?, ? FROM scene_versions WHERE id = ? AND project_id = ?
  `).bind(
    id, auth.organisationId, project.id, parsed.data.label, JSON.stringify(parsed.data.geometry),
    parsed.data.source, parsed.data.confidence ?? null, parsed.data.versionId, project.id,
  ).run();
  const created = await context.env.DB.prepare("SELECT id FROM privacy_regions WHERE id = ?").bind(id).first();
  if (!created) return notFound(context, "Scene version not found");
  await audit(context, auth, "privacy.region.create", "privacy_region", id);
  return context.json({ privacyRegion: { id, status: "pending", ...parsed.data } }, 201);
});

app.patch("/api/projects/:projectId/spatial/privacy-regions/:regionId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = privacyRegionDecisionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const result = await context.env.DB.prepare(`
    UPDATE privacy_regions SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ? AND project_id = ? AND organisation_id = ?
    RETURNING id, status
  `).bind(parsed.data.status, auth.userId, context.req.param("regionId"), context.req.param("projectId"), auth.organisationId).first();
  if (!result) return notFound(context, "Privacy region not found");
  await audit(context, auth, "privacy.region.review", "privacy_region", context.req.param("regionId"), parsed.data);
  return context.json({ privacyRegion: result });
});

app.post("/api/projects/:projectId/spatial/change-reports", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = changeDetectionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const canonicalRequest = JSON.stringify(parsed.data);
  const requestHash = await sha256Hex(canonicalRequest);
  const prior = await context.env.DB.prepare(`
    SELECT request_hash, response_json
    FROM change_detection_operations
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(
    auth.organisationId,
    parsed.data.clientOperationId,
  ).first<{
    request_hash: string;
    response_json: string;
  }>();
  if (prior) {
    if (prior.request_hash !== requestHash) {
      return context.json({ error: "Operation ID was already used for a different geometry comparison" }, 409);
    }
    return context.json({
      ...(JSON.parse(prior.response_json) as Record<string, unknown>),
      idempotent: true,
    });
  }
  const versions = await context.env.DB.prepare(`
    SELECT id, version_number FROM scene_versions
    WHERE project_id = ? AND id IN (?, ?)
  `).bind(project.id, parsed.data.fromVersionId, parsed.data.toVersionId).all<{
    id: string; version_number: number;
  }>();
  if (versions.results.length !== 2) return notFound(context, "One or both scene versions were not found");
  const versionUnits = await Promise.all([
    spatialVersionWorldUnit(
      context.env.DB,
      auth.organisationId,
      project.id,
      parsed.data.fromVersionId,
    ),
    spatialVersionWorldUnit(
      context.env.DB,
      auth.organisationId,
      project.id,
      parsed.data.toVersionId,
    ),
  ]);
  if (versionUnits.includes("scene_units")) {
    return conflict(
      context,
      "Authored geometry change evidence requires reviewed metric metres. Provisional scene-unit versions support relative navigation only.",
    );
  }
  const entities = await context.env.DB.prepare(`
    SELECT id, version_id, kind, label, geometry_json, world_unit
    FROM scene_entities
    WHERE project_id = ? AND version_id IN (?, ?) AND status = 'active'
      AND kind IN ('floor', 'room', 'doorway') AND geometry_json IS NOT NULL
    ORDER BY version_id, kind, lower(label), id
  `).bind(
    project.id,
    parsed.data.fromVersionId,
    parsed.data.toVersionId,
  ).all<GeometryEntity & { version_id: string }>();
  if (entities.results.some((entity) =>
    parseWorldUnit(Reflect.get(entity, "world_unit")) !== "metres"
  )) {
    return conflict(
      context,
      "Authored geometry change evidence cannot mix provisional scene units with metric geometry",
    );
  }
  const fromVersion = versions.results.find((version) => version.id === parsed.data.fromVersionId)!;
  const toVersion = versions.results.find((version) => version.id === parsed.data.toVersionId)!;
  const fromEntities = entities.results.filter((entity) => entity.version_id === fromVersion.id);
  const toEntities = entities.results.filter((entity) => entity.version_id === toVersion.id);
  const summary = computeAuthoredGeometryChange({
    fromVersion: { id: fromVersion.id, versionNumber: fromVersion.version_number },
    toVersion: { id: toVersion.id, versionNumber: toVersion.version_number },
    fromEntities,
    toEntities,
    thresholdMm: parsed.data.thresholdMm,
    coordinateAssurance: parsed.data.coordinateAssurance,
    registrationEvidence: parsed.data.registrationEvidence,
  });
  const sourceGeometryHash = await sha256Hex(JSON.stringify({
    from: fromEntities,
    to: toEntities,
  }));
  const reportId = crypto.randomUUID();
  const stored = await context.env.DB.prepare(`
    INSERT INTO change_detection_reports
      (id, organisation_id, project_id, from_version_id, to_version_id, status,
        summary_json, created_by, method, result, threshold_mm,
        coordinate_assurance, registration_evidence, source_geometry_hash,
        client_operation_id, request_hash)
    VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, from_version_id, to_version_id) DO UPDATE SET
      summary_json = excluded.summary_json,
      status = 'ready',
      method = excluded.method,
      result = excluded.result,
      threshold_mm = excluded.threshold_mm,
      coordinate_assurance = excluded.coordinate_assurance,
      registration_evidence = excluded.registration_evidence,
      source_geometry_hash = excluded.source_geometry_hash,
      client_operation_id = excluded.client_operation_id,
      request_hash = excluded.request_hash,
      review_decision = NULL,
      review_note = NULL,
      reviewed_by = NULL,
      reviewed_at = NULL,
      updated_at = datetime('now')
    RETURNING id, created_at, updated_at
  `).bind(
    reportId,
    auth.organisationId,
    project.id,
    parsed.data.fromVersionId,
    parsed.data.toVersionId,
    JSON.stringify(summary),
    auth.userId,
    summary.method,
    summary.result,
    parsed.data.thresholdMm,
    parsed.data.coordinateAssurance,
    parsed.data.registrationEvidence,
    sourceGeometryHash,
    parsed.data.clientOperationId,
    requestHash,
  ).first<{ id: string; created_at: string; updated_at: string }>();
  if (!stored) throw new Error("Geometry change report was not persisted");
  const responsePayload = {
    report: {
      id: stored.id,
      status: "ready",
      summary,
      reviewDecision: null,
      reviewNote: null,
      reviewedAt: null,
      createdAt: stored.created_at,
      updatedAt: stored.updated_at,
    },
  };
  await context.env.DB.prepare(`
    INSERT INTO change_detection_operations
      (organisation_id, project_id, client_operation_id, request_hash, response_json, report_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    auth.organisationId,
    project.id,
    parsed.data.clientOperationId,
    requestHash,
    JSON.stringify(responsePayload),
    stored.id,
  ).run();
  await audit(context, auth, "spatial.change_report.create", "change_detection_report", stored.id, {
    ...parsed.data,
    sourceGeometryHash,
    result: summary.result,
  });
  return context.json(responsePayload, 201);
});

app.patch("/api/projects/:projectId/spatial/change-reports/:reportId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = changeDetectionReviewSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const report = await context.env.DB.prepare(`
    UPDATE change_detection_reports
    SET status = 'reviewed', review_decision = ?, review_note = ?,
      reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND project_id = ? AND organisation_id = ?
    RETURNING id, status, review_decision, review_note, reviewed_at, updated_at
  `).bind(
    parsed.data.decision,
    parsed.data.note,
    auth.userId,
    context.req.param("reportId"),
    context.req.param("projectId"),
    auth.organisationId,
  ).first<{
    id: string;
    status: string;
    review_decision: string;
    review_note: string;
    reviewed_at: string;
    updated_at: string;
  }>();
  if (!report) return notFound(context, "Geometry change report not found");
  await audit(context, auth, "spatial.change_report.review", "change_detection_report", report.id, parsed.data);
  return context.json({
    report: {
      id: report.id,
      status: report.status,
      reviewDecision: report.review_decision,
      reviewNote: report.review_note,
      reviewedAt: report.reviewed_at,
      updatedAt: report.updated_at,
    },
  });
});

app.post("/api/projects/:projectId/spatial/raw-change-reports", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = registeredSceneChangeSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const requestHash = await sha256Hex(JSON.stringify(parsed.data));
  const prior = await context.env.DB.prepare(`
    SELECT * FROM registered_scene_change_reports
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(
    auth.organisationId,
    parsed.data.clientOperationId,
  ).first<RegisteredSceneChangeRow>();
  if (prior) {
    if (prior.request_hash !== requestHash) {
      return conflict(context, "Operation ID was already used for a different raw-scene comparison");
    }
    return context.json({ report: registeredSceneChangeApi(prior), idempotent: true });
  }
  const versions = await context.env.DB.prepare(`
    SELECT id FROM scene_versions
    WHERE project_id = ? AND id IN (?, ?)
  `).bind(
    project.id,
    parsed.data.baselineVersionId,
    parsed.data.candidateVersionId,
  ).all<{ id: string }>();
  if (versions.results.length !== 2) {
    return notFound(context, "One or both immutable scene versions were not found");
  }
  const assets = await context.env.DB.prepare(`
    SELECT id, version_id, kind, format, integrity_status
    FROM assets
    WHERE project_id = ? AND organisation_id = ? AND id IN (?, ?)
      AND deleted_at IS NULL
  `).bind(
    project.id,
    auth.organisationId,
    parsed.data.baselineAssetId,
    parsed.data.candidateAssetId,
  ).all<{
    id: string;
    version_id: string;
    kind: string;
    format: string;
    integrity_status: string;
  }>();
  const baselineAsset = assets.results.find((asset) => asset.id === parsed.data.baselineAssetId);
  const candidateAsset = assets.results.find((asset) => asset.id === parsed.data.candidateAssetId);
  if (!baselineAsset || !candidateAsset) {
    return notFound(context, "One or both raw-scene assets were not found");
  }
  for (const [label, asset, versionId] of [
    ["Baseline", baselineAsset, parsed.data.baselineVersionId],
    ["Candidate", candidateAsset, parsed.data.candidateVersionId],
  ] as const) {
    if (asset.version_id !== versionId) {
      return unprocessable(context, { assets: [`${label} asset does not belong to its selected version`] });
    }
    if (!["source", "master", "pointcloud"].includes(asset.kind) || asset.format.toLowerCase() !== "ply") {
      return unprocessable(context, { assets: [`${label} asset must be a source, master, or point-cloud PLY`] });
    }
    if (asset.integrity_status !== "verified") {
      return conflict(context, `${label} asset has not passed immutable integrity verification`);
    }
  }
  const reportId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO processing_jobs (
        id, organisation_id, project_id, version_id, input_asset_id, job_type,
        processor_version, idempotency_key, state, priority, max_attempts,
        progress_message
      ) VALUES (?, ?, ?, ?, ?, 'registered-scene-change-v1',
        'spatial-processor/0.4.0', ?, 'QUEUED', 80, 3,
        'Waiting for a registered-scene change worker')
    `).bind(
      jobId,
      auth.organisationId,
      project.id,
      parsed.data.candidateVersionId,
      parsed.data.baselineAssetId,
      `raw-change:${auth.organisationId}:${parsed.data.clientOperationId}`,
    ),
    context.env.DB.prepare(`
      INSERT INTO registered_scene_change_reports (
        id, organisation_id, project_id, baseline_version_id,
        candidate_version_id, baseline_asset_id, candidate_asset_id, job_id,
        client_operation_id, request_hash, status, coordinate_assurance,
        registration_evidence, registration_mode, registration_search_radius_m,
        registration_maximum_rmse_mm, registration_minimum_overlap_percent,
        voxel_size_m, structural_threshold_percent,
        photometric_threshold_percent, centroid_threshold_mm,
        maximum_sample_points, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      reportId,
      auth.organisationId,
      project.id,
      parsed.data.baselineVersionId,
      parsed.data.candidateVersionId,
      parsed.data.baselineAssetId,
      parsed.data.candidateAssetId,
      jobId,
      parsed.data.clientOperationId,
      requestHash,
      parsed.data.coordinateAssurance,
      parsed.data.registrationEvidence,
      parsed.data.registrationMode,
      parsed.data.registrationSearchRadiusM,
      parsed.data.registrationMaximumRmseMm,
      parsed.data.registrationMinimumOverlapPercent,
      parsed.data.voxelSizeM,
      parsed.data.structuralChangeThresholdPercent,
      parsed.data.photometricChangeThresholdPercent,
      parsed.data.centroidChangeThresholdMm,
      parsed.data.maximumSamplePoints,
      auth.userId,
    ),
  ]);
  await audit(context, auth, "spatial.raw_change.create", "registered_scene_change_report", reportId, {
    jobId,
    baselineVersionId: parsed.data.baselineVersionId,
    candidateVersionId: parsed.data.candidateVersionId,
    baselineAssetId: parsed.data.baselineAssetId,
    candidateAssetId: parsed.data.candidateAssetId,
    registrationMode: parsed.data.registrationMode,
    coordinateAssurance: parsed.data.coordinateAssurance,
  });
  dispatchProcessingJob(context, jobId);
  const created = await context.env.DB.prepare(
    "SELECT * FROM registered_scene_change_reports WHERE id = ?",
  ).bind(reportId).first<RegisteredSceneChangeRow>();
  return context.json({ report: registeredSceneChangeApi(created!) }, 202);
});

app.post("/api/projects/:projectId/spatial/semantic-extractions", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = semanticExtractionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  if (project.status === "ARCHIVED") return conflict(context, "Archived projects cannot start semantic extraction");
  const requestHash = await sha256Hex(JSON.stringify(parsed.data));
  const prior = await context.env.DB.prepare(`
    SELECT * FROM semantic_extraction_runs
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(auth.organisationId, parsed.data.clientOperationId).first<SemanticExtractionRow>();
  if (prior) {
    if (prior.request_hash !== requestHash) {
      return conflict(context, "Operation ID was already used for a different semantic extraction");
    }
    return context.json({ extraction: semanticExtractionApi(prior), idempotent: true });
  }
  const version = await context.env.DB.prepare(`
    SELECT id FROM scene_versions WHERE id = ? AND project_id = ?
  `).bind(parsed.data.versionId, project.id).first<{ id: string }>();
  if (!version) return notFound(context, "Immutable scene version not found");
  const asset = await context.env.DB.prepare(`
    SELECT id, version_id, kind, format, integrity_status
    FROM assets
    WHERE id = ? AND project_id = ? AND organisation_id = ? AND deleted_at IS NULL
  `).bind(
    parsed.data.inputAssetId,
    project.id,
    auth.organisationId,
  ).first<{
    id: string;
    version_id: string;
    kind: string;
    format: string;
    integrity_status: string;
  }>();
  if (!asset) return notFound(context, "Registered point-cloud asset not found");
  if (asset.version_id !== version.id) {
    return unprocessable(context, { inputAssetId: ["Point-cloud asset does not belong to the selected version"] });
  }
  if (!["source", "master", "pointcloud"].includes(asset.kind) || asset.format.toLowerCase() !== "ply") {
    return unprocessable(context, {
      inputAssetId: ["Semantic extraction requires a source, master, or point-cloud PLY"],
    });
  }
  if (asset.integrity_status !== "verified") {
    return conflict(context, "Point-cloud asset has not passed immutable integrity verification");
  }
  const extractionId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const parameters = {
    coordinateAssurance: parsed.data.coordinateAssurance,
    ...(parsed.data.sourceToWorld
      ? { sourceToWorld: parsed.data.sourceToWorld }
      : {}),
    registrationEvidence: parsed.data.registrationEvidence,
    gridSizeM: parsed.data.gridSizeM,
    floorBandM: parsed.data.floorBandM,
    minimumAreaM2: parsed.data.minimumAreaM2,
    maximumCandidates: parsed.data.maximumCandidates,
    maximumSamplePoints: parsed.data.maximumSamplePoints,
    elevationHintM: parsed.data.elevationHintM ?? null,
  };
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO processing_jobs (
        id, organisation_id, project_id, version_id, input_asset_id, job_type,
        processor_version, idempotency_key, state, priority, max_attempts,
        progress_message
      ) VALUES (?, ?, ?, ?, ?, 'semantic.extract-v1',
        'spatial-processor/0.7.0', ?, 'QUEUED', 75, 3,
        'Waiting for a point-cloud semantic worker')
    `).bind(
      jobId,
      auth.organisationId,
      project.id,
      version.id,
      asset.id,
      `semantic-extraction:${auth.organisationId}:${parsed.data.clientOperationId}`,
    ),
    context.env.DB.prepare(`
      INSERT INTO semantic_extraction_runs (
        id, organisation_id, project_id, version_id, input_asset_id, job_id,
        parameters_json, client_operation_id, request_hash, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      extractionId,
      auth.organisationId,
      project.id,
      version.id,
      asset.id,
      jobId,
      JSON.stringify(parameters),
      parsed.data.clientOperationId,
      requestHash,
      auth.userId,
    ),
  ]);
  await audit(context, auth, "spatial.semantic_extraction.create", "semantic_extraction", extractionId, {
    jobId,
    versionId: version.id,
    inputAssetId: asset.id,
    parameters,
  });
  dispatchProcessingJob(context, jobId);
  const created = await context.env.DB.prepare(
    "SELECT * FROM semantic_extraction_runs WHERE id = ?",
  ).bind(extractionId).first<SemanticExtractionRow>();
  return context.json({ extraction: semanticExtractionApi(created!) }, 202);
});

app.post("/api/projects/:projectId/spatial/semantic-extractions/:extractionId/review", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = semanticExtractionReviewSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const extraction = await context.env.DB.prepare(`
    SELECT * FROM semantic_extraction_runs
    WHERE id = ? AND project_id = ? AND organisation_id = ?
  `).bind(
    context.req.param("extractionId"),
    project.id,
    auth.organisationId,
  ).first<SemanticExtractionRow>();
  if (!extraction) return notFound(context, "Semantic extraction not found");
  const requestHash = await sha256Hex(JSON.stringify(parsed.data));
  if (extraction.review_client_operation_id) {
    if (
      extraction.review_client_operation_id !== parsed.data.clientOperationId ||
      extraction.review_request_hash !== requestHash
    ) {
      return conflict(context, "This semantic extraction has already received a different review decision");
    }
    const response = parseStoredObject(extraction.review_response_json ?? "{}");
    return context.json({ ...(response as Record<string, unknown>), idempotent: true });
  }
  if (extraction.status !== "READY_FOR_REVIEW") {
    return conflict(context, `Semantic extraction is ${extraction.status.toLowerCase()} and cannot be reviewed`);
  }
  const candidates = await context.env.DB.prepare(`
    SELECT * FROM semantic_candidates
    WHERE extraction_id = ? AND project_id = ? AND organisation_id = ?
    ORDER BY candidate_key
  `).bind(
    extraction.id,
    project.id,
    auth.organisationId,
  ).all<{
    id: string;
    label: string;
    geometry_json: string;
    elevation_m: number;
    area_m2: number;
    world_unit: string;
    confidence: number;
    status: string;
  }>();
  const selectedIds = new Set(parsed.data.candidateIds);
  const extractionParameters = parseStoredObject(extraction.parameters_json);
  const sourceToWorld = Reflect.get(extractionParameters as object, "sourceToWorld");
  const extractionWorldUnit = parseWorldUnit(
    sourceToWorld && typeof sourceToWorld === "object"
      ? Reflect.get(sourceToWorld, "worldUnit")
      : undefined,
  );
  if (candidates.results.some((candidate) =>
    parseWorldUnit(candidate.world_unit) !== extractionWorldUnit
  )) {
    return conflict(
      context,
      "Semantic candidate unit provenance differs from its extraction evidence",
    );
  }
  if (
    parsed.data.decision === "accept_selected" &&
    parsed.data.candidateIds.some((id) => !candidates.results.some((candidate) =>
      candidate.id === id && candidate.status === "pending"))
  ) {
    return unprocessable(context, { candidateIds: ["Every selected candidate must be pending in this extraction"] });
  }

  const floorId = parsed.data.decision === "accept_selected" ? crypto.randomUUID() : null;
  const entityPlans = parsed.data.decision === "accept_selected"
    ? candidates.results
      .filter((candidate) => selectedIds.has(candidate.id))
      .map((candidate) => ({
        candidate,
        entityId: crypto.randomUUID(),
      }))
    : [];
  const createdEntities = floorId
    ? [
      { id: floorId, kind: "floor", parentId: null },
      ...entityPlans.map(({ entityId }) => ({ id: entityId, kind: "room", parentId: floorId })),
    ]
    : [];
  const response = {
    extraction: {
      id: extraction.id,
      status: "REVIEWED",
      reviewDecision: parsed.data.decision,
    },
    createdEntities,
  };
  const elevation = entityPlans.length
    ? entityPlans.reduce((sum, plan) => sum + plan.candidate.elevation_m, 0) / entityPlans.length
    : null;
  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare(`
      INSERT INTO scene_navigation_profiles (
        version_id, organisation_id, project_id, world_unit, agent_radius,
        agent_height, eye_height, max_step_metres, updated_by
      )
      SELECT ?, ?, ?, ?, 0.22, 1.8, 1.6, 0.1, ?
      WHERE ? = 'accept_selected' AND NOT EXISTS (
        SELECT 1 FROM scene_entities
        WHERE organisation_id = ? AND project_id = ? AND version_id = ?
          AND status = 'active' AND world_unit <> ?
        UNION ALL
        SELECT 1 FROM scene_navigation_obstacles
        WHERE organisation_id = ? AND project_id = ? AND version_id = ?
          AND status = 'active' AND world_unit <> ?
        UNION ALL
        SELECT 1 FROM measurement_briefs
        WHERE organisation_id = ? AND project_id = ? AND version_id = ?
          AND ? <> 'metres'
      )
      ON CONFLICT(version_id) DO NOTHING
    `).bind(
      extraction.version_id,
      auth.organisationId,
      project.id,
      extractionWorldUnit,
      auth.userId,
      parsed.data.decision,
      auth.organisationId,
      project.id,
      extraction.version_id,
      extractionWorldUnit,
      auth.organisationId,
      project.id,
      extraction.version_id,
      extractionWorldUnit,
      auth.organisationId,
      project.id,
      extraction.version_id,
      extractionWorldUnit,
    ),
    context.env.DB.prepare(`
      UPDATE semantic_extraction_runs
      SET status = 'REVIEWED', reviewed_by = ?, review_decision = ?,
        review_note = ?, review_client_operation_id = ?, review_request_hash = ?,
        review_response_json = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND project_id = ? AND organisation_id = ?
        AND status = 'READY_FOR_REVIEW' AND review_client_operation_id IS NULL
        AND (
          ? = 'reject_all' OR EXISTS (
            SELECT 1 FROM scene_navigation_profiles
            WHERE version_id = ? AND organisation_id = ? AND project_id = ?
              AND world_unit = ?
          )
        )
    `).bind(
      auth.userId,
      parsed.data.decision,
      parsed.data.note,
      parsed.data.clientOperationId,
      requestHash,
      JSON.stringify(response),
      extraction.id,
      project.id,
      auth.organisationId,
      parsed.data.decision,
      extraction.version_id,
      auth.organisationId,
      project.id,
      extractionWorldUnit,
    ),
    parsed.data.decision === "accept_selected"
      ? context.env.DB.prepare(`
      UPDATE semantic_candidates
      SET status = CASE WHEN id IN (${parsed.data.candidateIds.map(() => "?").join(", ")}) THEN 'accepted'
          ELSE 'rejected'
        END,
        reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
      WHERE extraction_id = ? AND organisation_id = ? AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM semantic_extraction_runs r
          WHERE r.id = semantic_candidates.extraction_id
            AND r.review_client_operation_id = ?
        )
    `).bind(
      ...parsed.data.candidateIds,
      auth.userId,
      extraction.id,
      auth.organisationId,
      parsed.data.clientOperationId,
    )
      : context.env.DB.prepare(`
      UPDATE semantic_candidates
      SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE extraction_id = ? AND organisation_id = ? AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM semantic_extraction_runs r
          WHERE r.id = semantic_candidates.extraction_id
            AND r.review_client_operation_id = ?
        )
    `).bind(
      auth.userId,
      extraction.id,
      auth.organisationId,
      parsed.data.clientOperationId,
    ),
  ];
  if (floorId && elevation !== null) {
    statements.push(context.env.DB.prepare(`
      INSERT INTO scene_entities (
        id, organisation_id, project_id, version_id, kind, label, description,
        position_json, geometry_json, metadata_json, sort_order, created_by,
        world_unit
      )
      SELECT ?, ?, ?, ?, 'floor', ?, ?,
        ?, NULL, ?, 0, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM semantic_extraction_runs
        WHERE id = ? AND review_client_operation_id = ?
      )
    `).bind(
      floorId,
      auth.organisationId,
      project.id,
      extraction.version_id,
      `Extracted floor · ${dxfNumber(elevation)} ${
        extractionWorldUnit === "scene_units" ? "SU" : "m"
      }`,
      "Operator-reviewed floor grouping created from registered point-cloud walkable candidates.",
      JSON.stringify([0, elevation, 0]),
      JSON.stringify({
        source: "reviewed_semantic_extraction",
        extractionId: extraction.id,
        method: extraction.method,
      }),
      auth.userId,
      extractionWorldUnit,
      extraction.id,
      parsed.data.clientOperationId,
    ));
    for (const { candidate, entityId } of entityPlans) {
      statements.push(context.env.DB.prepare(`
        INSERT INTO scene_entities (
          id, organisation_id, project_id, version_id, parent_id, kind, label,
          description, geometry_json, metadata_json, sort_order, created_by,
          world_unit
        )
        SELECT ?, ?, ?, ?, ?, 'room', ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM semantic_extraction_runs
          WHERE id = ? AND review_client_operation_id = ?
        )
      `).bind(
        entityId,
        auth.organisationId,
        project.id,
        extraction.version_id,
        floorId,
        candidate.label,
        "Editable room seed accepted from bounded registered point-cloud occupancy evidence.",
        candidate.geometry_json,
        JSON.stringify({
          source: "reviewed_semantic_extraction",
          extractionId: extraction.id,
          candidateId: candidate.id,
          confidence: candidate.confidence,
          area: candidate.area_m2,
          worldUnit: extractionWorldUnit,
        }),
        createdEntities.findIndex((entity) => entity.id === entityId),
        auth.userId,
        extractionWorldUnit,
        extraction.id,
        parsed.data.clientOperationId,
      ));
      statements.push(context.env.DB.prepare(`
        UPDATE semantic_candidates SET scene_entity_id = ?
        WHERE id = ? AND extraction_id = ? AND status = 'accepted'
      `).bind(entityId, candidate.id, extraction.id));
    }
  }
  await context.env.DB.batch(statements);
  const storedReview = await context.env.DB.prepare(`
    SELECT review_client_operation_id, review_request_hash, review_response_json
    FROM semantic_extraction_runs
    WHERE id = ? AND organisation_id = ?
  `).bind(extraction.id, auth.organisationId).first<{
    review_client_operation_id: string | null;
    review_request_hash: string | null;
    review_response_json: string | null;
  }>();
  if (
    storedReview?.review_client_operation_id !== parsed.data.clientOperationId ||
    storedReview.review_request_hash !== requestHash
  ) {
    return conflict(context, "A different semantic review completed first");
  }
  await audit(context, auth, "spatial.semantic_extraction.review", "semantic_extraction", extraction.id, {
    decision: parsed.data.decision,
    acceptedCandidateIds: parsed.data.candidateIds,
    createdEntityIds: createdEntities.map((entity) => entity.id),
  });
  return context.json(parseStoredObject(storedReview.review_response_json ?? "{}"));
});

app.post("/api/projects/:projectId/spatial/floorplan-extractions", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = floorplanExtractionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  if (project.status === "ARCHIVED") {
    return conflict(context, "Archived projects cannot start floor-plan extraction");
  }
  const requestHash = await sha256Hex(JSON.stringify(parsed.data));
  const prior = await context.env.DB.prepare(`
    SELECT * FROM floorplan_extraction_runs
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(
    auth.organisationId,
    parsed.data.clientOperationId,
  ).first<FloorplanExtractionRow>();
  if (prior) {
    if (prior.request_hash !== requestHash) {
      return conflict(context, "Operation ID was already used for a different floor-plan extraction");
    }
    return context.json({ extraction: floorplanExtractionApi(prior), idempotent: true });
  }
  const version = await context.env.DB.prepare(`
    SELECT id FROM scene_versions WHERE id = ? AND project_id = ?
  `).bind(parsed.data.versionId, project.id).first<{ id: string }>();
  if (!version) return notFound(context, "Immutable scene version not found");
  const asset = await context.env.DB.prepare(`
    SELECT id, version_id, kind, format, integrity_status, file_name, size_bytes, sha256
    FROM assets
    WHERE id = ? AND project_id = ? AND organisation_id = ? AND deleted_at IS NULL
  `).bind(
    parsed.data.inputAssetId,
    project.id,
    auth.organisationId,
  ).first<{
    id: string;
    version_id: string;
    kind: string;
    format: string;
    integrity_status: string;
    file_name: string;
    size_bytes: number;
    sha256: string | null;
  }>();
  if (!asset) return notFound(context, "Metric point-cloud asset not found");
  if (asset.version_id !== version.id) {
    return unprocessable(context, {
      inputAssetId: ["Point-cloud asset does not belong to the selected version"],
    });
  }
  const sourceFormat = asset.format.toLowerCase();
  if (
    asset.kind !== "pointcloud" ||
    !["ply", "e57", "las", "laz", "pts"].includes(sourceFormat)
  ) {
    return unprocessable(context, {
      inputAssetId: [
        "Floor-plan extraction requires a metric point-cloud PLY, E57, LAS, LAZ, or PTS asset",
      ],
    });
  }
  if (asset.integrity_status !== "verified") {
    return conflict(context, "Point-cloud asset has not passed immutable integrity verification");
  }
  if (!asset.sha256 || !/^[a-f0-9]{64}$/i.test(asset.sha256)) {
    return conflict(
      context,
      "Point-cloud asset is missing the immutable SHA-256 required for floor-plan extraction",
    );
  }
  if (asset.size_bytes > 1024 * 1024 * 1024) {
    return unprocessable(context, {
      inputAssetId: [
        "This worker profile accepts point clouds up to 1 GiB; tile or decimate larger captures first",
      ],
    });
  }
  const extractionId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const normalizer =
    sourceFormat === "ply" && parsed.data.sourceUpAxis === "y"
      ? "native-ply-v1"
      : "pdal";
  const parameters = {
    coordinateAssurance: parsed.data.coordinateAssurance,
    sourceUpAxis: parsed.data.sourceUpAxis,
    registrationEvidence: parsed.data.registrationEvidence,
    gridSizeM: parsed.data.gridSizeM,
    floorBandM: parsed.data.floorBandM,
    wallMinHeightM: parsed.data.wallMinHeightM,
    wallMaxHeightM: parsed.data.wallMaxHeightM,
    minimumWallHeightCoverage: parsed.data.minimumWallHeightCoverage,
    minimumRoomAreaM2: parsed.data.minimumRoomAreaM2,
    maximumOpeningWidthM: parsed.data.maximumOpeningWidthM,
    maximumRooms: parsed.data.maximumRooms,
    maximumSamplePoints: parsed.data.maximumSamplePoints,
    elevationHintM: parsed.data.elevationHintM ?? null,
  };
  const sourceEvidence = {
    assetId: asset.id,
    fileName: asset.file_name,
    sourceFormat,
    sizeBytes: asset.size_bytes,
    sha256: asset.sha256,
    integrityStatus: asset.integrity_status,
    coordinateAssurance: parsed.data.coordinateAssurance,
    sourceUpAxis: parsed.data.sourceUpAxis,
    registrationEvidence: parsed.data.registrationEvidence,
    normalizer,
  };
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO processing_jobs (
        id, organisation_id, project_id, version_id, input_asset_id, job_type,
        processor_version, idempotency_key, state, priority, max_attempts,
        progress_message
      ) VALUES (?, ?, ?, ?, ?, 'floorplan.extract-v1',
        'spatial-processor/0.7.0', ?, 'QUEUED', 78, 3,
        'Waiting for a vendor-neutral floor-plan worker')
    `).bind(
      jobId,
      auth.organisationId,
      project.id,
      version.id,
      asset.id,
      `floorplan-extraction:${auth.organisationId}:${parsed.data.clientOperationId}`,
    ),
    context.env.DB.prepare(`
      INSERT INTO floorplan_extraction_runs (
        id, organisation_id, project_id, version_id, input_asset_id, job_id,
        normalizer, parameters_json, source_evidence_json,
        client_operation_id, request_hash, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      extractionId,
      auth.organisationId,
      project.id,
      version.id,
      asset.id,
      jobId,
      normalizer,
      JSON.stringify(parameters),
      JSON.stringify(sourceEvidence),
      parsed.data.clientOperationId,
      requestHash,
      auth.userId,
    ),
  ]);
  await audit(context, auth, "spatial.floorplan_extraction.create", "floorplan_extraction", extractionId, {
    jobId,
    versionId: version.id,
    inputAssetId: asset.id,
    sourceFormat,
    normalizer,
    parameters,
  });
  dispatchProcessingJob(context, jobId);
  const created = await context.env.DB.prepare(
    "SELECT * FROM floorplan_extraction_runs WHERE id = ?",
  ).bind(extractionId).first<FloorplanExtractionRow>();
  return context.json({ extraction: floorplanExtractionApi(created!) }, 202);
});

app.post(
  "/api/projects/:projectId/spatial/floorplan-extractions/:extractionId/review",
  async (context) => {
    const auth = await requireOperator(context);
    if (auth instanceof Response) return auth;
    if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
    const parsed = floorplanExtractionReviewSchema.safeParse(await readJson(context));
    if (!parsed.success) return validationError(context, parsed.error.flatten());
    const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
    if (!project) return notFound(context, "Project not found");
    const extraction = await context.env.DB.prepare(`
      SELECT * FROM floorplan_extraction_runs
      WHERE id = ? AND project_id = ? AND organisation_id = ?
    `).bind(
      context.req.param("extractionId"),
      project.id,
      auth.organisationId,
    ).first<FloorplanExtractionRow>();
    if (!extraction) return notFound(context, "Floor-plan extraction not found");
    const requestHash = await sha256Hex(JSON.stringify(parsed.data));
    if (extraction.review_client_operation_id) {
      if (
        extraction.review_client_operation_id !== parsed.data.clientOperationId ||
        extraction.review_request_hash !== requestHash
      ) {
        return conflict(context, "This floor-plan proposal already received a different review");
      }
      return context.json({
        ...(parseStoredObject(extraction.review_response_json ?? "{}") as Record<string, unknown>),
        idempotent: true,
      });
    }
    if (extraction.status !== "READY_FOR_REVIEW" || !extraction.proposal_hash) {
      return conflict(
        context,
        `Floor-plan extraction is ${extraction.status.toLowerCase()} and cannot be reviewed`,
      );
    }
    if (parsed.data.plan) {
      const planIssue = floorplanPlanIssue(parsed.data.plan);
      if (planIssue) return unprocessable(context, { plan: [planIssue] });
    }
    const revisionId = parsed.data.decision === "approve" ? crypto.randomUUID() : null;
    const planJson = parsed.data.plan ? JSON.stringify(parsed.data.plan) : null;
    const planHash = planJson ? await sha256Hex(planJson) : null;
    let response: Record<string, unknown> = {};
    let reviewWriteError: unknown = null;
    for (let allocationAttempt = 0; allocationAttempt < 3; allocationAttempt += 1) {
      const revisionNumber = revisionId
        ? ((await context.env.DB.prepare(`
          SELECT COALESCE(MAX(revision_number), 0) AS value
          FROM floorplan_revisions
          WHERE project_id = ? AND version_id = ? AND organisation_id = ?
        `).bind(project.id, extraction.version_id, auth.organisationId)
          .first<{ value: number }>())?.value ?? 0) + 1
        : null;
      response = {
        extraction: {
          id: extraction.id,
          status: parsed.data.decision === "approve" ? "REVIEWED" : "REJECTED",
          reviewDecision: parsed.data.decision,
        },
        revision: revisionId && planHash && planJson && revisionNumber
          ? {
            id: revisionId,
            revisionNumber,
            status: "approved",
            measurementClass: "indicative",
            planHash,
          }
          : null,
      };
      const serializedResponse = JSON.stringify(response);
      const statements: D1PreparedStatement[] = [
        context.env.DB.prepare(`
          UPDATE floorplan_extraction_runs
          SET status = ?, reviewed_by = ?, review_decision = ?, review_note = ?,
            review_client_operation_id = ?, review_request_hash = ?,
            review_response_json = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ? AND project_id = ? AND organisation_id = ?
            AND status = 'READY_FOR_REVIEW' AND review_client_operation_id IS NULL
        `).bind(
          parsed.data.decision === "approve" ? "REVIEWED" : "REJECTED",
          auth.userId,
          parsed.data.decision,
          parsed.data.note,
          parsed.data.clientOperationId,
          requestHash,
          serializedResponse,
          extraction.id,
          project.id,
          auth.organisationId,
        ),
      ];
      if (revisionId && planHash && planJson && revisionNumber) {
        statements.push(
          context.env.DB.prepare(`
            UPDATE floorplan_revisions SET status = 'superseded'
            WHERE project_id = ? AND version_id = ? AND organisation_id = ?
              AND status = 'approved'
              AND EXISTS (
                SELECT 1 FROM floorplan_extraction_runs
                WHERE id = ? AND review_client_operation_id = ?
                  AND review_request_hash = ?
                  AND review_response_json = ?
              )
          `).bind(
            project.id,
            extraction.version_id,
            auth.organisationId,
            extraction.id,
            parsed.data.clientOperationId,
            requestHash,
            serializedResponse,
          ),
          context.env.DB.prepare(`
            INSERT INTO floorplan_revisions (
              id, organisation_id, project_id, version_id, extraction_id,
              revision_number, plan_json, plan_hash, source_proposal_hash,
              review_note, created_by
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM floorplan_extraction_runs
              WHERE id = ? AND review_client_operation_id = ?
                AND review_request_hash = ?
                AND review_response_json = ?
            )
          `).bind(
            revisionId,
            auth.organisationId,
            project.id,
            extraction.version_id,
            extraction.id,
            revisionNumber,
            planJson,
            planHash,
            extraction.proposal_hash,
            parsed.data.note,
            auth.userId,
            extraction.id,
            parsed.data.clientOperationId,
            requestHash,
            serializedResponse,
          ),
        );
      }
      try {
        await context.env.DB.batch(statements);
        reviewWriteError = null;
        break;
      } catch (error) {
        reviewWriteError = error;
        if (
          revisionId &&
          allocationAttempt < 2 &&
          isFloorplanRevisionSequenceConflict(error)
        ) {
          continue;
        }
        break;
      }
    }
    const storedReview = await context.env.DB.prepare(`
      SELECT review_client_operation_id, review_request_hash, review_response_json
      FROM floorplan_extraction_runs WHERE id = ? AND organisation_id = ?
    `).bind(extraction.id, auth.organisationId).first<{
      review_client_operation_id: string | null;
      review_request_hash: string | null;
      review_response_json: string | null;
    }>();
    if (
      storedReview?.review_client_operation_id !== parsed.data.clientOperationId ||
      storedReview.review_request_hash !== requestHash
    ) {
      if (reviewWriteError) throw reviewWriteError;
      return conflict(context, "A different floor-plan review completed first");
    }
    if (reviewWriteError) {
      return context.json({
        ...(parseStoredObject(storedReview.review_response_json ?? "{}") as Record<string, unknown>),
        idempotent: true,
      });
    }
    if (storedReview.review_response_json !== JSON.stringify(response)) {
      return context.json({
        ...(parseStoredObject(storedReview.review_response_json ?? "{}") as Record<string, unknown>),
        idempotent: true,
      });
    }
    await audit(context, auth, "spatial.floorplan_extraction.review", "floorplan_extraction", extraction.id, {
      decision: parsed.data.decision,
      revisionId,
      planHash,
    });
    return context.json(parseStoredObject(storedReview.review_response_json ?? "{}"));
  },
);

app.post(
  "/api/projects/:projectId/spatial/floorplan-revisions/:revisionId/exports",
  async (context) => {
    const auth = await requireOperator(context);
    if (auth instanceof Response) return auth;
    if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
    const parsed = floorplanExportSchema.safeParse(await readJson(context));
    if (!parsed.success) return validationError(context, parsed.error.flatten());
    const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
    if (!project) return notFound(context, "Project not found");
    const revision = await context.env.DB.prepare(`
      SELECT * FROM floorplan_revisions
      WHERE id = ? AND project_id = ? AND organisation_id = ?
    `).bind(
      context.req.param("revisionId"),
      project.id,
      auth.organisationId,
    ).first<FloorplanRevisionRow>();
    if (!revision) return notFound(context, "Approved floor-plan revision not found");
    if (revision.status !== "approved") {
      return conflict(context, "Superseded floor-plan revisions cannot create new exports");
    }
    const requestHash = await sha256Hex(JSON.stringify(parsed.data));
    const prior = await context.env.DB.prepare(`
      SELECT response_json, request_hash FROM floorplan_export_batches
      WHERE organisation_id = ? AND client_operation_id = ?
    `).bind(auth.organisationId, parsed.data.clientOperationId).first<{
      response_json: string | null;
      request_hash: string;
    }>();
    if (prior) {
      if (prior.request_hash !== requestHash) {
        return conflict(context, "Operation ID was already used for different floor-plan exports");
      }
      return context.json({
        ...(parseStoredObject(prior.response_json ?? "{}") as Record<string, unknown>),
        idempotent: true,
      });
    }
    const storedPlan = floorplanReviewPlanSchema.safeParse(parseStoredObject(revision.plan_json));
    if (!storedPlan.success) {
      return conflict(context, "Approved floor-plan revision failed its stored schema check");
    }
    const existing = await context.env.DB.prepare(`
      SELECT e.*, a.file_name, a.mime_type, a.size_bytes, a.sha256, a.object_key
      FROM floorplan_exports e
      JOIN assets a ON a.id = e.asset_id
      WHERE e.revision_id = ? AND e.organisation_id = ?
    `).bind(revision.id, auth.organisationId).all<FloorplanExportRow>();
    const existingByFormat = new Map(existing.results.map((row) => [row.format, row]));
    const batchId = crypto.randomUUID();
    const generated: FloorplanExportRow[] = [];
    const assetStatements: D1PreparedStatement[] = [];
    try {
      for (const format of parsed.data.formats) {
        if (existingByFormat.has(format)) continue;
        const exportId = crypto.randomUUID();
        const assetId = crypto.randomUUID();
        const generatedFile = floorplanExportBytes(storedPlan.data, format, {
          projectName: project.name,
          revisionNumber: revision.revision_number,
          planHash: revision.plan_hash,
          approvedAt: revision.approved_at,
        });
        const fileName =
          `${slugify(project.name)}-indicative-floorplan-r${revision.revision_number}.${format}`;
        const objectKey =
          `deliverables-private/${auth.organisationId}/${project.id}/${revision.version_id}` +
          `/floorplans/${revision.id}/${exportId}-${fileName}`;
        const digest = await sha256Hex(generatedFile.bytes);
        const stored = await context.env.SPATIAL_ASSETS.put(objectKey, generatedFile.bytes, {
          httpMetadata: { contentType: generatedFile.mimeType },
          customMetadata: {
            projectId: project.id,
            revisionId: revision.id,
            planHash: revision.plan_hash,
            measurementClass: "indicative",
          },
        });
        const row: FloorplanExportRow = {
          id: exportId,
          organisation_id: auth.organisationId,
          project_id: project.id,
          version_id: revision.version_id,
          revision_id: revision.id,
          batch_id: batchId,
          asset_id: assetId,
          format,
          generator_version: "indicative-floorplan-export-v1",
          plan_hash: revision.plan_hash,
          status: "ready",
          created_by: auth.userId,
          created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          file_name: fileName,
          mime_type: generatedFile.mimeType,
          size_bytes: generatedFile.bytes.byteLength,
          sha256: digest,
          object_key: objectKey,
        };
        generated.push(row);
        assetStatements.push(
          context.env.DB.prepare(`
            INSERT INTO assets (
              id, organisation_id, project_id, version_id, kind, format, object_key,
              file_name, mime_type, size_bytes, etag, sha256, integrity_status
            ) VALUES (?, ?, ?, ?, 'portable', ?, ?, ?, ?, ?, ?, ?, 'verified')
          `).bind(
            assetId,
            auth.organisationId,
            project.id,
            revision.version_id,
            format,
            objectKey,
            fileName,
            generatedFile.mimeType,
            generatedFile.bytes.byteLength,
            stored.etag,
            digest,
          ),
          context.env.DB.prepare(`
            INSERT INTO floorplan_exports (
              id, organisation_id, project_id, version_id, revision_id, batch_id,
              asset_id, format, plan_hash, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            exportId,
            auth.organisationId,
            project.id,
            revision.version_id,
            revision.id,
            batchId,
            assetId,
            format,
            revision.plan_hash,
            auth.userId,
          ),
        );
      }
    } catch (error) {
      await Promise.all(
        generated.map((row) => context.env.SPATIAL_ASSETS.delete(row.object_key)),
      );
      throw error;
    }
    const allRows = parsed.data.formats.map((format) => {
      const row = existingByFormat.get(format) ?? generated.find((candidate) => candidate.format === format);
      if (!row) throw new Error(`Floor-plan export ${format} was not generated`);
      return row;
    });
    const response = {
      revision: {
        id: revision.id,
        revisionNumber: revision.revision_number,
        planHash: revision.plan_hash,
        measurementClass: revision.measurement_class,
      },
      exports: allRows.map((row) => floorplanExportApi(row)),
    };
    try {
      await context.env.DB.batch([
        context.env.DB.prepare(`
          INSERT INTO floorplan_export_batches (
            id, organisation_id, project_id, revision_id, client_operation_id,
            request_hash, response_json, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          batchId,
          auth.organisationId,
          project.id,
          revision.id,
          parsed.data.clientOperationId,
          requestHash,
          JSON.stringify(response),
          auth.userId,
        ),
        ...assetStatements,
      ]);
    } catch (error) {
      await Promise.all(
        generated.map((row) => context.env.SPATIAL_ASSETS.delete(row.object_key)),
      );
      const concurrentOperation = await context.env.DB.prepare(`
        SELECT response_json, request_hash FROM floorplan_export_batches
        WHERE organisation_id = ? AND client_operation_id = ?
      `).bind(auth.organisationId, parsed.data.clientOperationId).first<{
        response_json: string | null;
        request_hash: string;
      }>();
      if (concurrentOperation?.response_json) {
        if (concurrentOperation.request_hash !== requestHash) {
          return conflict(context, "Operation ID was already used for different floor-plan exports");
        }
        return context.json({
          ...(parseStoredObject(concurrentOperation.response_json) as Record<string, unknown>),
          idempotent: true,
        });
      }
      const concurrentRows = await context.env.DB.prepare(`
        SELECT e.*, a.file_name, a.mime_type, a.size_bytes, a.sha256, a.object_key
        FROM floorplan_exports e
        JOIN assets a ON a.id = e.asset_id
        WHERE e.revision_id = ? AND e.organisation_id = ?
          AND e.format IN (${parsed.data.formats.map(() => "?").join(",")})
      `).bind(
        revision.id,
        auth.organisationId,
        ...parsed.data.formats,
      ).all<FloorplanExportRow>();
      const concurrentByFormat = new Map(
        concurrentRows.results.map((row) => [row.format, row]),
      );
      if (parsed.data.formats.every((format) => concurrentByFormat.has(format))) {
        const concurrentResponse = {
          revision: response.revision,
          exports: parsed.data.formats.map((format) =>
            floorplanExportApi(concurrentByFormat.get(format)!)),
        };
        await context.env.DB.prepare(`
          INSERT OR IGNORE INTO floorplan_export_batches (
            id, organisation_id, project_id, revision_id, client_operation_id,
            request_hash, response_json, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          batchId,
          auth.organisationId,
          project.id,
          revision.id,
          parsed.data.clientOperationId,
          requestHash,
          JSON.stringify(concurrentResponse),
          auth.userId,
        ).run();
        return context.json({ ...concurrentResponse, reused: true });
      }
      throw error;
    }
    await audit(context, auth, "spatial.floorplan_export.create", "floorplan_revision", revision.id, {
      batchId,
      formats: parsed.data.formats,
      planHash: revision.plan_hash,
      generatedFormats: generated.map((row) => row.format),
    });
    return context.json(response, generated.length ? 201 : 200);
  },
);

app.get(
  "/api/projects/:projectId/spatial/floorplan-exports/:exportId/download",
  async (context) => {
    const access = await requireReviewProject(context, context.req.param("projectId"));
    if (access instanceof Response) return access;
    const row = await context.env.DB.prepare(`
      SELECT e.id, e.status, a.object_key, a.file_name
      FROM floorplan_exports e
      JOIN assets a ON a.id = e.asset_id
      WHERE e.id = ? AND e.project_id = ? AND e.organisation_id = ?
        AND a.deleted_at IS NULL
    `).bind(
      context.req.param("exportId"),
      access.project.id,
      access.auth.organisationId,
    ).first<{ id: string; status: string; object_key: string; file_name: string }>();
    if (!row) return notFound(context, "Floor-plan export not found");
    const response = await serveR2Object(context, row.object_key);
    response.headers.set(
      "Content-Disposition",
      `attachment; filename="${row.file_name.replaceAll("\"", "")}"`,
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  },
);

app.post("/api/projects/:projectId/spatial/raw-change-reports/:reportId/retry", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const report = await context.env.DB.prepare(`
    SELECT r.*, j.state AS job_state
    FROM registered_scene_change_reports r
    JOIN processing_jobs j ON j.id = r.job_id
    WHERE r.id = ? AND r.project_id = ? AND r.organisation_id = ?
  `).bind(
    context.req.param("reportId"),
    context.req.param("projectId"),
    auth.organisationId,
  ).first<RegisteredSceneChangeRow & { job_state: string }>();
  if (!report) return notFound(context, "Raw-scene change report not found");
  if (["QUEUED", "LEASED", "RUNNING"].includes(report.job_state)) {
    return context.json({ report: registeredSceneChangeApi(report), idempotent: true }, 202);
  }
  if (report.job_state === "SUCCEEDED") {
    return conflict(context, "Completed raw-scene evidence cannot be retried");
  }
  await context.env.DB.batch([
    context.env.DB.prepare(`
      UPDATE processing_jobs
      SET state = 'QUEUED', attempt_count = 0, progress = 0,
        progress_message = 'Deliberate retry queued', error_json = NULL,
        lease_token_hash = NULL, leased_by = NULL, lease_expires_at = NULL,
        completed_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(report.job_id, auth.organisationId),
    context.env.DB.prepare(`
      UPDATE registered_scene_change_reports
      SET status = 'QUEUED', error_json = NULL, completed_at = NULL,
        updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(report.id, auth.organisationId),
  ]);
  await audit(context, auth, "spatial.raw_change.retry", "registered_scene_change_report", report.id, {
    jobId: report.job_id,
  });
  dispatchProcessingJob(context, report.job_id);
  return context.json({
    report: { ...registeredSceneChangeApi(report), status: "QUEUED", errorJson: null },
  }, 202);
});

app.patch("/api/projects/:projectId/spatial/raw-change-reports/:reportId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = registeredSceneChangeReviewSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const report = await context.env.DB.prepare(`
    UPDATE registered_scene_change_reports
    SET status = 'REVIEWED', review_decision = ?, review_note = ?,
      reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND project_id = ? AND organisation_id = ?
      AND status IN ('COMPLETED', 'REVIEWED')
    RETURNING *
  `).bind(
    parsed.data.decision,
    parsed.data.note,
    auth.userId,
    context.req.param("reportId"),
    context.req.param("projectId"),
    auth.organisationId,
  ).first<RegisteredSceneChangeRow>();
  if (!report) {
    const exists = await context.env.DB.prepare(`
      SELECT status FROM registered_scene_change_reports
      WHERE id = ? AND project_id = ? AND organisation_id = ?
    `).bind(
      context.req.param("reportId"),
      context.req.param("projectId"),
      auth.organisationId,
    ).first<{ status: string }>();
    if (!exists) return notFound(context, "Raw-scene change report not found");
    return conflict(context, `Raw-scene evidence is ${exists.status.toLowerCase()} and cannot be reviewed yet`);
  }
  await audit(context, auth, "spatial.raw_change.review", "registered_scene_change_report", report.id, parsed.data);
  return context.json({ report: registeredSceneChangeApi(report) });
});

app.post("/api/projects/:projectId/spatial/capture-completeness", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = captureCompletenessSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  if (parsed.data.source.adapter !== project.capture_adapter) {
    return unprocessable(context, {
      source: [`Trajectory adapter must match the project capture adapter (${project.capture_adapter})`],
    });
  }
  const requestHash = await sha256Hex(JSON.stringify(parsed.data));
  const prior = await context.env.DB.prepare(`
    SELECT id, status, result, summary_json, request_hash,
      review_decision, review_note, reviewed_at, created_at, updated_at
    FROM capture_completeness_reports
    WHERE organisation_id = ? AND client_operation_id = ?
  `).bind(
    auth.organisationId,
    parsed.data.clientOperationId,
  ).first<{
    id: string;
    status: string;
    result: string;
    summary_json: string;
    request_hash: string;
    review_decision: string | null;
    review_note: string | null;
    reviewed_at: string | null;
    created_at: string;
    updated_at: string;
  }>();
  if (prior) {
    if (prior.request_hash !== requestHash) {
      return context.json({ error: "Operation ID was already used for different capture evidence" }, 409);
    }
    return context.json({
      report: {
        id: prior.id,
        status: prior.status,
        result: prior.result,
        summary: JSON.parse(prior.summary_json),
        reviewDecision: prior.review_decision,
        reviewNote: prior.review_note,
        reviewedAt: prior.reviewed_at,
        createdAt: prior.created_at,
        updatedAt: prior.updated_at,
      },
      idempotent: true,
    });
  }
  const version = await context.env.DB.prepare(`
    SELECT id, version_number FROM scene_versions WHERE id = ? AND project_id = ?
  `).bind(
    parsed.data.versionId,
    project.id,
  ).first<{ id: string; version_number: number }>();
  if (!version) return notFound(context, "Scene version not found");
  const worldUnit = await spatialVersionWorldUnit(
    context.env.DB,
    auth.organisationId,
    project.id,
    version.id,
  );
  if (worldUnit === "scene_units") {
    return conflict(
      context,
      "Capture completeness evidence requires reviewed metric metres. Provisional scene units support relative navigation only.",
    );
  }
  const rooms = await context.env.DB.prepare(`
    SELECT id, kind, label, geometry_json, world_unit
    FROM scene_entities
    WHERE organisation_id = ? AND project_id = ? AND version_id = ?
      AND kind = 'room' AND status = 'active' AND geometry_json IS NOT NULL
    ORDER BY lower(label), id
  `).bind(
    auth.organisationId,
    project.id,
    version.id,
  ).all<CaptureRoomEntity>();
  if (rooms.results.some((room) =>
    parseWorldUnit(Reflect.get(room, "world_unit")) !== "metres"
  )) {
    return conflict(
      context,
      "Capture completeness evidence cannot use provisional scene-unit room geometry",
    );
  }
  const summary = computeCaptureCompleteness({
    version: { id: version.id, versionNumber: version.version_number },
    source: parsed.data.source,
    parameters: parsed.data.parameters,
    rooms: rooms.results,
    points: parsed.data.points,
  });
  const sourcePayload = JSON.stringify({
    schemaVersion: 1,
    source: parsed.data.source,
    points: parsed.data.points,
  });
  const sourceHash = await sha256Hex(sourcePayload);
  const reportId = crypto.randomUUID();
  const sourceAssetId = crypto.randomUUID();
  const fileName = safeFileName(parsed.data.source.fileName);
  const objectKey =
    `reports-private/${auth.organisationId}/${project.id}/${version.id}/capture/${reportId}/${fileName}`;
  const sourceBytes = new TextEncoder().encode(sourcePayload);
  const object = await context.env.SPATIAL_ASSETS.put(objectKey, sourceBytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      organisationId: auth.organisationId,
      projectId: project.id,
      versionId: version.id,
      reportId,
      sourceHash,
      immutable: "true",
    },
  });
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, etag, sha256, integrity_status)
        VALUES (?, ?, ?, ?, 'report', 'capture-trajectory-json', ?, ?, 'application/json',
          ?, ?, ?, 'verified')
      `).bind(
        sourceAssetId,
        auth.organisationId,
        project.id,
        version.id,
        objectKey,
        fileName,
        sourceBytes.byteLength,
        object.etag,
        sourceHash,
      ),
      context.env.DB.prepare(`
        INSERT INTO capture_completeness_reports
          (id, organisation_id, project_id, version_id, status, method, result,
            source_asset_id, source_file_name, source_format, source_hash,
            coordinate_frame, alignment_evidence, parameters_json, summary_json,
            client_operation_id, request_hash, created_by)
        VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        reportId,
        auth.organisationId,
        project.id,
        version.id,
        summary.method,
        summary.result,
        sourceAssetId,
        fileName,
        parsed.data.source.format,
        sourceHash,
        parsed.data.source.coordinateFrame,
        parsed.data.source.alignmentEvidence,
        JSON.stringify(parsed.data.parameters),
        JSON.stringify(summary),
        parsed.data.clientOperationId,
        requestHash,
        auth.userId,
      ),
    ]);
  } catch (error) {
    await context.env.SPATIAL_ASSETS.delete(objectKey);
    throw error;
  }
  await audit(context, auth, "capture.completeness.create", "capture_completeness_report", reportId, {
    projectId: project.id,
    versionId: version.id,
    sourceAssetId,
    sourceHash,
    result: summary.result,
    sampleCount: parsed.data.points.length,
  });
  return context.json({
    report: {
      id: reportId,
      status: "ready",
      result: summary.result,
      summary,
      reviewDecision: null,
      reviewNote: null,
      reviewedAt: null,
    },
  }, 201);
});

app.patch("/api/projects/:projectId/spatial/capture-completeness/:reportId", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = captureCompletenessReviewSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const report = await context.env.DB.prepare(`
    UPDATE capture_completeness_reports
    SET status = 'reviewed', review_decision = ?, review_note = ?,
      reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND project_id = ? AND organisation_id = ?
    RETURNING id, status, result, review_decision, review_note, reviewed_at, updated_at
  `).bind(
    parsed.data.decision,
    parsed.data.note,
    auth.userId,
    context.req.param("reportId"),
    context.req.param("projectId"),
    auth.organisationId,
  ).first<{
    id: string;
    status: string;
    result: string;
    review_decision: string;
    review_note: string;
    reviewed_at: string;
    updated_at: string;
  }>();
  if (!report) return notFound(context, "Capture completeness report not found");
  await audit(context, auth, "capture.completeness.review", "capture_completeness_report", report.id, parsed.data);
  return context.json({
    report: {
      id: report.id,
      status: report.status,
      result: report.result,
      reviewDecision: report.review_decision,
      reviewNote: report.review_note,
      reviewedAt: report.reviewed_at,
      updatedAt: report.updated_at,
    },
  });
});

app.put("/api/projects/:projectId/spatial/delivery-policy", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = deliveryPolicySchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  await context.env.DB.prepare(`
    INSERT INTO project_delivery_policies
      (project_id, organisation_id, adaptive_quality, mobile_lite_budget,
        mobile_standard_budget, desktop_standard_budget, desktop_high_budget,
        max_initial_bytes, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      adaptive_quality = excluded.adaptive_quality,
      mobile_lite_budget = excluded.mobile_lite_budget,
      mobile_standard_budget = excluded.mobile_standard_budget,
      desktop_standard_budget = excluded.desktop_standard_budget,
      desktop_high_budget = excluded.desktop_high_budget,
      max_initial_bytes = excluded.max_initial_bytes,
      updated_by = excluded.updated_by,
      updated_at = datetime('now')
  `).bind(
    project.id, auth.organisationId, parsed.data.adaptiveQuality ? 1 : 0,
    parsed.data.mobileLiteBudget, parsed.data.mobileStandardBudget,
    parsed.data.desktopStandardBudget, parsed.data.desktopHighBudget,
    parsed.data.maxInitialBytes, auth.userId,
  ).run();
  await audit(context, auth, "spatial.delivery_policy.update", "project", project.id);
  return context.json({ deliveryPolicy: parsed.data });
});

app.get("/api/projects/:projectId/measurement", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const results = await context.env.DB.batch([
    context.env.DB.prepare(`
      SELECT * FROM measurement_briefs WHERE project_id = ? AND organisation_id = ?
      ORDER BY created_at DESC
    `).bind(project.id, auth.organisationId),
    context.env.DB.prepare(`
      SELECT cp.* FROM measurement_check_points cp
      JOIN measurement_briefs b ON b.id = cp.brief_id
      WHERE b.project_id = ? AND b.organisation_id = ? ORDER BY cp.created_at
    `).bind(project.id, auth.organisationId),
    context.env.DB.prepare(`
      SELECT qr.* FROM measurement_qa_reports qr
      JOIN measurement_briefs b ON b.id = qr.brief_id
      WHERE b.project_id = ? AND b.organisation_id = ? ORDER BY qr.generated_at DESC
    `).bind(project.id, auth.organisationId),
    context.env.DB.prepare(`
      SELECT ps.* FROM professional_signoffs ps
      JOIN measurement_briefs b ON b.id = ps.brief_id
      WHERE b.project_id = ? AND b.organisation_id = ? ORDER BY ps.signed_at DESC
    `).bind(project.id, auth.organisationId),
    context.env.DB.prepare(`
      SELECT * FROM project_cost_records WHERE project_id = ? AND organisation_id = ?
      ORDER BY incurred_at DESC
    `).bind(project.id, auth.organisationId),
    context.env.DB.prepare(`
      SELECT md.*, a.file_name, a.mime_type, a.size_bytes, a.sha256, a.object_key
      FROM measurement_deliverables md
      JOIN assets a ON a.id = md.asset_id
      WHERE md.project_id = ? AND md.organisation_id = ? AND a.deleted_at IS NULL
      ORDER BY md.created_at DESC
    `).bind(project.id, auth.organisationId),
  ]);
  const costs = requiredBatchResult(results, 4).results as Array<Record<string, unknown>>;
  const totalCostCents = costs.reduce((sum, row) =>
    sum + Number(row.amount_cents ?? 0) * Number(row.quantity ?? 1), 0);
  return context.json({
    briefs: requiredBatchResult(results, 0).results,
    checkPoints: requiredBatchResult(results, 1).results,
    qaReports: requiredBatchResult(results, 2).results,
    signoffs: requiredBatchResult(results, 3).results,
    costs,
    deliverables: requiredBatchResult(results, 5).results,
    economics: { totalCostCents, currency: "MYR" },
  });
});

app.post("/api/projects/:projectId/measurement/briefs", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = measurementBriefSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  const version = await context.env.DB.prepare(
    "SELECT id FROM scene_versions WHERE id = ? AND project_id = ?",
  ).bind(parsed.data.versionId, project.id).first();
  if (!version) return notFound(context, "Scene version not found");
  if (parsed.data.relianceClass === "professional_certified") {
    return validationError(context, {
      relianceClass: ["Create the brief as project_verified; professional certification is applied only after a recorded partner sign-off"],
    });
  }
  const id = crypto.randomUUID();
  const created = await context.env.DB.prepare(`
    INSERT INTO measurement_briefs
      (id, organisation_id, project_id, version_id, product_type, intended_use,
        units, tolerance_mm, reliance_class, coordinate_reference, exclusions,
        acceptance_notes, status, created_by)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'evidence_required', ?
    WHERE NOT EXISTS (
      SELECT 1 FROM scene_navigation_profiles
      WHERE organisation_id = ? AND project_id = ? AND version_id = ?
        AND world_unit <> 'metres'
      UNION ALL
      SELECT 1 FROM scene_entities
      WHERE organisation_id = ? AND project_id = ? AND version_id = ?
        AND status = 'active' AND world_unit <> 'metres'
      UNION ALL
      SELECT 1 FROM scene_navigation_obstacles
      WHERE organisation_id = ? AND project_id = ? AND version_id = ?
        AND status = 'active' AND world_unit <> 'metres'
    )
    RETURNING id
  `).bind(
    id, auth.organisationId, project.id, parsed.data.versionId, parsed.data.productType,
    parsed.data.intendedUse, parsed.data.units, parsed.data.toleranceMm,
    parsed.data.relianceClass, parsed.data.coordinateReference ?? null,
    parsed.data.exclusions ?? null, parsed.data.acceptanceNotes ?? null, auth.userId,
    auth.organisationId, project.id, parsed.data.versionId,
    auth.organisationId, project.id, parsed.data.versionId,
    auth.organisationId, project.id, parsed.data.versionId,
  ).first<{ id: string }>();
  if (!created) {
    return conflict(
      context,
      "Measurement briefs require reviewed metric metres. Provisional scene-unit versions support relative navigation only.",
    );
  }
  await audit(context, auth, "measurement.brief.create", "measurement_brief", id, {
    productType: parsed.data.productType,
    toleranceMm: parsed.data.toleranceMm,
    relianceClass: parsed.data.relianceClass,
  });
  return context.json({ brief: { id, status: "evidence_required", ...parsed.data } }, 201);
});

app.post("/api/projects/:projectId/measurement/briefs/:briefId/check-points", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = measurementCheckPointSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const brief = await context.env.DB.prepare(`
    SELECT id, units, version_id FROM measurement_briefs
    WHERE id = ? AND project_id = ? AND organisation_id = ?
  `).bind(context.req.param("briefId"), context.req.param("projectId"), auth.organisationId)
    .first<{ id: string; units: "metres" | "millimetres"; version_id: string }>();
  if (!brief) return notFound(context, "Measurement brief not found");
  const [rx, ry, rz] = parsed.data.reference;
  const [ox, oy, oz] = parsed.data.observed;
  const rawResidual = Math.hypot(ox - rx, oy - ry, oz - rz);
  const residualMm = brief.units === "metres" ? rawResidual * 1000 : rawResidual;
  const id = crypto.randomUUID();
  const created = await context.env.DB.prepare(`
    INSERT INTO measurement_check_points
      (id, brief_id, label, reference_x, reference_y, reference_z,
        observed_x, observed_y, observed_z, residual_mm, evidence_note)
    SELECT ?, b.id, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM measurement_briefs b
    WHERE b.id = ? AND b.project_id = ? AND b.organisation_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM scene_navigation_profiles
        WHERE organisation_id = ? AND project_id = ? AND version_id = ?
          AND world_unit <> 'metres'
        UNION ALL
        SELECT 1 FROM scene_entities
        WHERE organisation_id = ? AND project_id = ? AND version_id = ?
          AND status = 'active' AND world_unit <> 'metres'
        UNION ALL
        SELECT 1 FROM scene_navigation_obstacles
        WHERE organisation_id = ? AND project_id = ? AND version_id = ?
          AND status = 'active' AND world_unit <> 'metres'
      )
    RETURNING id
  `).bind(
    id, parsed.data.label, rx, ry, rz, ox, oy, oz,
    residualMm, parsed.data.evidenceNote ?? null,
    brief.id, context.req.param("projectId"), auth.organisationId,
    auth.organisationId, context.req.param("projectId"), brief.version_id,
    auth.organisationId, context.req.param("projectId"), brief.version_id,
    auth.organisationId, context.req.param("projectId"), brief.version_id,
  ).first<{ id: string }>();
  if (!created) {
    return conflict(
      context,
      "Measurement checkpoints require reviewed metric metres. Provisional scene-unit versions support relative navigation only.",
    );
  }
  await context.env.DB.prepare(
    "UPDATE measurement_briefs SET status = 'qa_required', updated_at = datetime('now') WHERE id = ?",
  ).bind(brief.id).run();
  await audit(context, auth, "measurement.check_point.create", "measurement_check_point", id, { residualMm });
  return context.json({ checkPoint: { id, residualMm, ...parsed.data } }, 201);
});

app.post("/api/projects/:projectId/measurement/briefs/:briefId/qa-report", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const brief = await context.env.DB.prepare(`
    SELECT id, version_id, tolerance_mm FROM measurement_briefs
    WHERE id = ? AND project_id = ? AND organisation_id = ?
  `).bind(context.req.param("briefId"), context.req.param("projectId"), auth.organisationId)
    .first<{ id: string; version_id: string; tolerance_mm: number }>();
  if (!brief) return notFound(context, "Measurement brief not found");
  if (!(await isMetricSpatialVersion(
    context.env.DB,
    auth.organisationId,
    context.req.param("projectId"),
    brief.version_id,
  ))) {
    return conflict(
      context,
      "Measurement QA requires reviewed metric metres and cannot use provisional scene-unit geometry.",
    );
  }
  const [points, entities] = await Promise.all([
    context.env.DB.prepare(
      "SELECT residual_mm FROM measurement_check_points WHERE brief_id = ? ORDER BY residual_mm",
    ).bind(brief.id).all<{ residual_mm: number }>(),
    context.env.DB.prepare(`
      SELECT id, label, geometry_json, world_unit FROM scene_entities
      WHERE project_id = ? AND version_id = ? AND organisation_id = ?
        AND kind = 'room' AND status = 'active' AND geometry_json IS NOT NULL
      ORDER BY sort_order, label, id
    `).bind(context.req.param("projectId"), brief.version_id, auth.organisationId)
      .all<{
        id: string;
        label: string;
        geometry_json: string;
        world_unit: string;
      }>(),
  ]);
  if (entities.results.some((entity) =>
    parseWorldUnit(entity.world_unit) !== "metres"
  )) {
    return conflict(
      context,
      "Measurement QA cannot interpret provisional scene-unit room coordinates as metres.",
    );
  }
  const residuals = points.results.map((point) => Number(point.residual_mm));
  const footprints = entities.results
    .map(measurementFootprint)
    .filter((footprint): footprint is MeasurementFootprint => Boolean(footprint));
  const sourceGeometryHash = footprints.length
    ? await sha256Hex(measurementSourceGeometry(footprints))
    : null;
  const count = residuals.length;
  const mean = count ? residuals.reduce((sum, value) => sum + value, 0) / count : null;
  const rmse = count ? Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / count) : null;
  const max = count ? Math.max(...residuals) : null;
  const p95 = count ? residuals[Math.min(count - 1, Math.ceil(count * 0.95) - 1)]! : null;
  const result = count < 3
    ? "insufficient_evidence"
    : (rmse! <= brief.tolerance_mm && max! <= brief.tolerance_mm * 1.5 ? "pass" : "fail");
  const id = crypto.randomUUID();
  const methodology = "3D Euclidean residuals at independent check points; RMSE and maximum compared with the brief tolerance. Minimum three check points.";
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO measurement_qa_reports
        (id, organisation_id, brief_id, point_count, rmse_mm, mean_mm, max_mm,
          p95_mm, tolerance_mm, result, methodology, source_geometry_hash, generated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, auth.organisationId, brief.id, count, rmse, mean, max, p95,
      brief.tolerance_mm, result, methodology, sourceGeometryHash, auth.userId,
    ),
    context.env.DB.prepare(
      "UPDATE measurement_briefs SET status = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind(result === "pass" ? "accepted" : result === "fail" ? "rejected" : "evidence_required", brief.id),
  ]);
  await audit(context, auth, "measurement.qa_report.generate", "measurement_qa_report", id, { result, count, rmse, max });
  return context.json({
    report: {
      id,
      pointCount: count,
      rmseMm: rmse,
      meanMm: mean,
      maxMm: max,
      p95Mm: p95,
      toleranceMm: brief.tolerance_mm,
      result,
      methodology,
      sourceGeometryHash,
    },
  }, 201);
});

app.post("/api/projects/:projectId/measurement/briefs/:briefId/deliverables", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const brief = await context.env.DB.prepare(`
    SELECT b.id, b.version_id, b.product_type, b.status, b.units, b.tolerance_mm,
      b.reliance_class, b.coordinate_reference, b.intended_use, b.exclusions,
      p.slug AS project_slug, qr.id AS qa_report_id, qr.result AS latest_qa_result,
      qr.point_count, qr.rmse_mm, qr.max_mm, qr.source_geometry_hash AS qa_source_geometry_hash
    FROM measurement_briefs b
    JOIN projects p ON p.id = b.project_id
    LEFT JOIN measurement_qa_reports qr ON qr.id = (
      SELECT latest.id FROM measurement_qa_reports latest
      WHERE latest.brief_id = b.id
      ORDER BY latest.generated_at DESC, latest.id DESC LIMIT 1
    )
    WHERE b.id = ? AND b.project_id = ? AND b.organisation_id = ?
  `).bind(context.req.param("briefId"), context.req.param("projectId"), auth.organisationId)
    .first<{
      id: string;
      version_id: string;
      product_type: "measured_floor_plan" | "scan_to_cad";
      status: string;
      units: "metres" | "millimetres";
      tolerance_mm: number;
      reliance_class: string;
      coordinate_reference: string | null;
      intended_use: string;
      exclusions: string | null;
      project_slug: string;
      qa_report_id: string | null;
      latest_qa_result: string | null;
      point_count: number | null;
      rmse_mm: number | null;
      max_mm: number | null;
      qa_source_geometry_hash: string | null;
    }>();
  if (!brief) return notFound(context, "Measurement brief not found");
  if (!(await isMetricSpatialVersion(
    context.env.DB,
    auth.organisationId,
    context.req.param("projectId"),
    brief.version_id,
  ))) {
    return conflict(
      context,
      "Measurement deliverables require reviewed metric metres and cannot use provisional scene-unit geometry.",
    );
  }
  if (brief.latest_qa_result !== "pass" || brief.status !== "accepted") {
    return context.json({
      error: "A passing measurement QA report is required before generating a deliverable",
      code: "measurement_qa_required",
    }, 409);
  }
  const entities = await context.env.DB.prepare(`
    SELECT id, label, geometry_json, world_unit
    FROM scene_entities
    WHERE project_id = ? AND version_id = ? AND organisation_id = ?
      AND kind = 'room' AND status = 'active' AND geometry_json IS NOT NULL
    ORDER BY sort_order, label, id
  `).bind(context.req.param("projectId"), brief.version_id, auth.organisationId)
    .all<{
      id: string;
      label: string;
      geometry_json: string;
      world_unit: string;
    }>();
  if (entities.results.some((entity) =>
    parseWorldUnit(entity.world_unit) !== "metres"
  )) {
    return conflict(
      context,
      "Measurement deliverables cannot interpret provisional scene-unit room coordinates as metres.",
    );
  }
  const footprints = entities.results
    .map(measurementFootprint)
    .filter((footprint): footprint is MeasurementFootprint => Boolean(footprint));
  if (!footprints.length) {
    return context.json({
      error: "At least one active room with valid box or polygon geometry is required",
      code: "measurement_geometry_required",
    }, 409);
  }
  const sourceGeometry = measurementSourceGeometry(footprints);
  const sourceGeometryHash = await sha256Hex(sourceGeometry);
  if (!brief.qa_source_geometry_hash || brief.qa_source_geometry_hash !== sourceGeometryHash) {
    return context.json({
      error: "The authored room geometry changed after the passing QA report; regenerate QA before creating another deliverable",
      code: "measurement_qa_stale",
    }, 409);
  }
  const deliverableType = brief.product_type === "scan_to_cad" ? "scan_to_cad_dxf" : "floor_plan_dxf";
  const existing = await context.env.DB.prepare(`
    SELECT md.*, a.file_name, a.mime_type, a.size_bytes, a.sha256, a.object_key
    FROM measurement_deliverables md
    JOIN assets a ON a.id = md.asset_id
    WHERE md.brief_id = ? AND md.qa_report_id = ? AND md.deliverable_type = ?
      AND md.source_geometry_hash = ? AND md.organisation_id = ? AND a.deleted_at IS NULL
    LIMIT 1
  `).bind(
    brief.id, brief.qa_report_id, deliverableType, sourceGeometryHash, auth.organisationId,
  ).first<MeasurementDeliverableRow>();
  if (existing && await context.env.SPATIAL_ASSETS.head(existing.object_key)) {
    return context.json({
      deliverable: measurementDeliverableApi(existing),
      idempotent: true,
    });
  }

  const generatorVersion = "whymelabs-dxf-r12-v1";
  const dxf = generateMeasurementDxf({
    footprints,
    units: brief.units,
    productType: brief.product_type,
    intendedUse: brief.intended_use,
    exclusions: brief.exclusions,
    coordinateReference: brief.coordinate_reference,
    relianceClass: brief.reliance_class,
    toleranceMm: brief.tolerance_mm,
    qaReportId: brief.qa_report_id!,
    pointCount: Number(brief.point_count),
    rmseMm: Number(brief.rmse_mm),
    maxMm: Number(brief.max_mm),
    sourceGeometryHash,
    generatorVersion,
  });
  const encoded = new TextEncoder().encode(dxf);
  const outputHash = await sha256Hex(dxf);
  const suffix = brief.product_type === "scan_to_cad" ? "scan-to-cad" : "floor-plan";
  const fileName = `${brief.project_slug}-${suffix}.dxf`;
  const objectKey = [
    "reports-private",
    auth.organisationId,
    context.req.param("projectId"),
    brief.version_id,
    "measurement",
    brief.id,
    `${outputHash}.dxf`,
  ].join("/");
  await context.env.SPATIAL_ASSETS.put(objectKey, encoded, {
    httpMetadata: {
      contentType: "application/dxf",
      contentDisposition: `attachment; filename="${fileName}"`,
      cacheControl: "private, no-store",
    },
    customMetadata: {
      sha256: outputHash,
      sourceGeometryHash,
      qaReportId: brief.qa_report_id!,
      generatorVersion,
    },
  });
  const assetId = crypto.randomUUID();
  const deliverableId = existing?.id ?? crypto.randomUUID();
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, etag, sha256, integrity_status)
        VALUES (?, ?, ?, ?, 'report', 'dxf', ?, ?, 'application/dxf', ?, ?, ?, 'verified')
      `).bind(
        assetId, auth.organisationId, context.req.param("projectId"), brief.version_id,
        objectKey, fileName, encoded.byteLength, `"${outputHash}"`, outputHash,
      ),
      context.env.DB.prepare(`
        INSERT INTO measurement_deliverables
          (id, organisation_id, project_id, brief_id, version_id, qa_report_id,
            asset_id, deliverable_type, source_geometry_hash, generator_version,
            status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)
      `).bind(
        deliverableId, auth.organisationId, context.req.param("projectId"), brief.id,
        brief.version_id, brief.qa_report_id, assetId, deliverableType,
        sourceGeometryHash, generatorVersion, auth.userId,
      ),
    ]);
  } catch (error) {
    const concurrent = await context.env.DB.prepare(`
      SELECT md.*, a.file_name, a.mime_type, a.size_bytes, a.sha256, a.object_key
      FROM measurement_deliverables md JOIN assets a ON a.id = md.asset_id
      WHERE md.brief_id = ? AND md.qa_report_id = ? AND md.deliverable_type = ?
        AND md.source_geometry_hash = ? AND md.organisation_id = ? AND a.deleted_at IS NULL
      LIMIT 1
    `).bind(
      brief.id, brief.qa_report_id, deliverableType, sourceGeometryHash, auth.organisationId,
    ).first<MeasurementDeliverableRow>();
    if (concurrent) {
      return context.json({ deliverable: measurementDeliverableApi(concurrent), idempotent: true });
    }
    await context.env.SPATIAL_ASSETS.delete(objectKey);
    throw error;
  }
  const stored: MeasurementDeliverableRow = {
    id: deliverableId,
    organisation_id: auth.organisationId,
    project_id: context.req.param("projectId"),
    brief_id: brief.id,
    version_id: brief.version_id,
    qa_report_id: brief.qa_report_id!,
    asset_id: assetId,
    deliverable_type: deliverableType,
    source_geometry_hash: sourceGeometryHash,
    generator_version: generatorVersion,
    status: "ready",
    created_at: new Date().toISOString(),
    file_name: fileName,
    mime_type: "application/dxf",
    size_bytes: encoded.byteLength,
    sha256: outputHash,
    object_key: objectKey,
  };
  await audit(context, auth, "measurement.deliverable.generate", "measurement_deliverable", deliverableId, {
    briefId: brief.id,
    qaReportId: brief.qa_report_id,
    assetId,
    outputHash,
    sourceGeometryHash,
    generatorVersion,
  });
  return context.json({ deliverable: measurementDeliverableApi(stored) }, 201);
});

app.get("/api/projects/:projectId/measurement/deliverables/:deliverableId/download", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  const deliverable = await context.env.DB.prepare(`
    SELECT md.*, a.file_name, a.mime_type, a.size_bytes, a.sha256, a.object_key
    FROM measurement_deliverables md
    JOIN assets a ON a.id = md.asset_id
    WHERE md.id = ? AND md.project_id = ? AND md.organisation_id = ?
      AND md.status = 'ready' AND a.deleted_at IS NULL
  `).bind(
    context.req.param("deliverableId"), context.req.param("projectId"), auth.organisationId,
  ).first<MeasurementDeliverableRow>();
  if (!deliverable) return notFound(context, "Measurement deliverable not found");
  const response = await serveR2Object(context, deliverable.object_key);
  response.headers.set("Content-Type", deliverable.mime_type);
  response.headers.set("Content-Disposition", `attachment; filename="${safeFileName(deliverable.file_name)}"`);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

app.post("/api/projects/:projectId/measurement/briefs/:briefId/signoffs", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = professionalSignoffSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const brief = await context.env.DB.prepare(`
    SELECT id, version_id, status FROM measurement_briefs
    WHERE id = ? AND project_id = ? AND organisation_id = ?
  `).bind(context.req.param("briefId"), context.req.param("projectId"), auth.organisationId)
    .first<{ id: string; version_id: string; status: string }>();
  if (!brief) return notFound(context, "Measurement brief not found");
  if (!(await isMetricSpatialVersion(
    context.env.DB,
    auth.organisationId,
    context.req.param("projectId"),
    brief.version_id,
  ))) {
    return conflict(
      context,
      "Professional sign-off requires reviewed metric metres and cannot certify a provisional scene-unit version.",
    );
  }
  if (brief.status !== "accepted") return context.json({ error: "A passing project QA report is required before professional sign-off" }, 409);
  if (parsed.data.evidenceAssetId) {
    const asset = await context.env.DB.prepare(
      "SELECT id FROM assets WHERE id = ? AND project_id = ? AND organisation_id = ?",
    ).bind(parsed.data.evidenceAssetId, context.req.param("projectId"), auth.organisationId).first();
    if (!asset) return validationError(context, { evidenceAssetId: ["Evidence asset is not part of this project"] });
  }
  const id = crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO professional_signoffs
        (id, organisation_id, brief_id, professional_name, registration_body,
          registration_number, scope, signed_at, evidence_asset_id, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, auth.organisationId, brief.id, parsed.data.professionalName,
      parsed.data.registrationBody, parsed.data.registrationNumber, parsed.data.scope,
      parsed.data.signedAt, parsed.data.evidenceAssetId ?? null, auth.userId,
    ),
    context.env.DB.prepare(
      "UPDATE measurement_briefs SET reliance_class = 'professional_certified', updated_at = datetime('now') WHERE id = ?",
    ).bind(brief.id),
  ]);
  await audit(context, auth, "measurement.professional_signoff.record", "professional_signoff", id);
  return context.json({ signoff: { id, ...parsed.data } }, 201);
});

app.post("/api/projects/:projectId/costs", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = projectCostSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  if (parsed.data.briefId) {
    const brief = await context.env.DB.prepare(
      "SELECT id FROM measurement_briefs WHERE id = ? AND project_id = ? AND organisation_id = ?",
    ).bind(parsed.data.briefId, project.id, auth.organisationId).first();
    if (!brief) return validationError(context, { briefId: ["Measurement brief is not part of this project"] });
  }
  const id = crypto.randomUUID();
  await context.env.DB.prepare(`
    INSERT INTO project_cost_records
      (id, organisation_id, project_id, brief_id, category, amount_cents,
        currency, quantity, unit, note, incurred_at, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, auth.organisationId, project.id, parsed.data.briefId ?? null,
    parsed.data.category, parsed.data.amountCents, parsed.data.currency,
    parsed.data.quantity, parsed.data.unit ?? null, parsed.data.note ?? null,
    parsed.data.incurredAt ?? new Date().toISOString(), auth.userId,
  ).run();
  await audit(context, auth, "project.cost.record", "project_cost_record", id, {
    category: parsed.data.category,
    amountCents: parsed.data.amountCents,
    quantity: parsed.data.quantity,
  });
  return context.json({ cost: { id, ...parsed.data } }, 201);
});

app.get("/api/projects/:projectId/uploads/open", async (context) => {
  const principal = await requireUploadPrincipal(context);
  if (principal instanceof Response) return principal;
  const organisationId = uploadPrincipalOrganisationId(principal);
  const project = await scopedProject(context.env.DB, organisationId, context.req.param("projectId"));
  if (!project || !uploadPrincipalCanAccessProject(principal, project.id)) {
    return notFound(context, "Project not found");
  }
  const rows = await context.env.DB.prepare(`
    SELECT us.id, us.project_id, us.version_id, us.asset_id, us.file_name,
      us.format, us.purpose, us.mime_type, us.expected_size_bytes, us.sha256, us.expires_at,
      us.part_size_bytes AS configured_part_size_bytes, us.created_at,
      up.part_number, up.etag AS part_etag,
      up.size_bytes AS part_size_bytes, up.uploaded_at
    FROM upload_sessions us
    LEFT JOIN upload_parts up ON up.upload_session_id = us.id
    WHERE us.project_id = ? AND us.organisation_id = ? AND us.status = 'OPEN'
    ORDER BY us.created_at DESC, up.part_number
  `).bind(project.id, organisationId).all<{
    id: string;
    project_id: string;
    version_id: string;
    asset_id: string;
    file_name: string;
    format: string;
    purpose: CaptureAssetPurpose;
    mime_type: string;
    expected_size_bytes: number;
    configured_part_size_bytes: number;
    sha256: string | null;
    expires_at: string;
    created_at: string;
    part_number: number | null;
    part_etag: string | null;
    part_size_bytes: number | null;
    uploaded_at: string | null;
  }>();
  const grouped = new Map<string, {
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
  }>();
  const now = Date.now();
  for (const row of rows.results) {
    let upload = grouped.get(row.id);
    if (!upload) {
      upload = {
        id: row.id,
        projectId: row.project_id,
        versionId: row.version_id,
        assetId: row.asset_id,
        fileName: row.file_name,
        format: row.format,
        purpose: row.purpose,
        mimeType: row.mime_type,
        expectedSizeBytes: row.expected_size_bytes,
        uploadedBytes: 0,
        sha256: row.sha256,
        partSizeBytes: row.configured_part_size_bytes,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        expired: Date.parse(row.expires_at) <= now,
        parts: [],
      };
      grouped.set(row.id, upload);
    }
    if (
      typeof row.part_number === "number" &&
      typeof row.part_etag === "string" &&
      typeof row.part_size_bytes === "number" &&
      typeof row.uploaded_at === "string"
    ) {
      upload.parts.push({
        partNumber: row.part_number,
        etag: row.part_etag,
        sizeBytes: row.part_size_bytes,
        uploadedAt: row.uploaded_at,
      });
      upload.uploadedBytes += row.part_size_bytes;
    }
  }
  return context.json({ uploads: Array.from(grouped.values()) });
});

app.post("/api/projects/:projectId/uploads", async (context) => {
  const principal = await requireUploadPrincipal(context);
  if (principal instanceof Response) return principal;
  const organisationId = uploadPrincipalOrganisationId(principal);
  const parsed = uploadInputSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, organisationId, context.req.param("projectId"));
  if (!project || !uploadPrincipalCanAccessProject(principal, project.id)) {
    return notFound(context, "Project not found");
  }
  if (project.status === "ARCHIVED") {
    return context.json({ error: "Restore this project before uploading new capture evidence" }, 409);
  }
  const maximumUploadBytes = positiveInteger(context.env.MAX_UPLOAD_BYTES, 100 * 1024 * 1024 * 1024);
  if (parsed.data.sizeBytes > maximumUploadBytes) return context.json({ error: "Asset exceeds organisation upload limit" }, 413);
  if (!fileNameMatchesFormat(parsed.data.fileName, parsed.data.format)) return validationError(context, { fileName: ["File extension does not match declared format"] });
  const purpose: CaptureAssetPurpose = parsed.data.purpose ??
    (parsed.data.format === "rad" ? "web_scene" : "gaussian_splat");
  const importPlan = planCaptureAssetImport({
    adapter: project.capture_adapter as CaptureAdapterId,
    purpose,
    format: parsed.data.format,
  });
  if (!importPlan.accepted) return context.json({ error: importPlan.reason }, 422);
  if (parsed.data.clientOperationId) {
    const existing = await context.env.DB.prepare(`
      SELECT u.id, u.project_id, u.version_id, u.asset_id, u.file_name, u.format, u.purpose,
        u.expected_size_bytes, u.part_size_bytes, u.expires_at, u.status,
        sv.source_provenance_json
      FROM upload_sessions u
      JOIN scene_versions sv ON sv.id = u.version_id
      WHERE organisation_id = ? AND client_operation_id = ?
    `).bind(organisationId, parsed.data.clientOperationId).first<{
      id: string;
      project_id: string;
      version_id: string;
      asset_id: string;
      file_name: string;
      format: string;
      purpose: CaptureAssetPurpose;
      expected_size_bytes: number;
      part_size_bytes: number;
      expires_at: string;
      status: string;
      source_provenance_json: string;
    }>();
    if (existing) {
      if (
        existing.project_id !== project.id ||
        existing.file_name !== safeFileName(parsed.data.fileName) ||
        existing.format !== parsed.data.format ||
        existing.purpose !== purpose ||
        existing.expected_size_bytes !== parsed.data.sizeBytes ||
        JSON.stringify(storedPosterCamera(existing.source_provenance_json) ?? null) !==
          JSON.stringify(parsed.data.posterCamera ?? null)
      ) {
        return context.json({ error: "Operation ID was already used for a different upload request" }, 409);
      }
      if (Date.parse(existing.expires_at) <= Date.now()) {
        return context.json({
          error: "This multipart upload expired; discard it and start a new upload",
          code: "upload_expired",
        }, 410);
      }
      return context.json({
        upload: {
          id: existing.id,
          versionId: existing.version_id,
          assetId: existing.asset_id,
          purpose: existing.purpose,
          partSizeBytes: existing.part_size_bytes,
          expectedSizeBytes: existing.expected_size_bytes,
          expiresAt: existing.expires_at,
          status: existing.status,
        },
        idempotent: true,
      });
    }
  }

  const versionNumberRow = await context.env.DB.prepare(
    "SELECT COALESCE(MAX(version_number), 0) + 1 AS next_number FROM scene_versions WHERE project_id = ?",
  ).bind(project.id).first<{ next_number: number }>();
  const versionNumber = versionNumberRow?.next_number ?? 1;
  const versionId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const uploadSessionId = crypto.randomUUID();
  const fileName = safeFileName(parsed.data.fileName);
  const credentialId = uploadPrincipalCredentialId(principal);
  const objectKey = `raw-private/${organisationId}/${project.id}/${versionId}/${assetId}/${fileName}`;
  const multipartUpload = await context.env.SPATIAL_ASSETS.createMultipartUpload(objectKey, {
    httpMetadata: { contentType: parsed.data.mimeType },
    customMetadata: {
      organisationId,
      projectId: project.id,
      versionId,
      assetId,
      immutable: "true",
      purpose,
      ...(credentialId ? { captureAgentCredentialId: credentialId } : {}),
    },
  });
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(`
        INSERT INTO scene_versions
          (id, project_id, version_number, status, source_provenance_json,
            created_by, capture_agent_credential_id)
        VALUES (?, ?, ?, 'UPLOADING', ?, ?, ?)
      `).bind(
        versionId,
        project.id,
        versionNumber,
        JSON.stringify({
          adapter: project.capture_adapter,
          importedAt: new Date().toISOString(),
          ...(credentialId ? { captureAgentCredentialId: credentialId } : {}),
          ...(parsed.data.posterCamera ? { posterCamera: parsed.data.posterCamera } : {}),
        }),
        uploadPrincipalUserId(principal),
        credentialId,
      ),
      context.env.DB.prepare(`
        INSERT INTO upload_sessions
          (id, organisation_id, project_id, version_id, asset_id, object_key,
            r2_upload_id, file_name, format, purpose, mime_type,
            expected_size_bytes, part_size_bytes, sha256, status, expires_at, created_by,
            client_operation_id, capture_agent_credential_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)
      `).bind(
        uploadSessionId,
        organisationId,
        project.id,
        versionId,
        assetId,
        objectKey,
        multipartUpload.uploadId,
        fileName,
        parsed.data.format,
        purpose,
        parsed.data.mimeType,
        parsed.data.sizeBytes,
        captureUploadPartBytes,
        parsed.data.sha256 ?? null,
        expiresAt,
        uploadPrincipalUserId(principal),
        parsed.data.clientOperationId ?? null,
        credentialId,
      ),
      context.env.DB.prepare("UPDATE projects SET status = 'UPLOADING', updated_at = datetime('now') WHERE id = ? AND organisation_id = ?").bind(project.id, organisationId),
    ]);
  } catch (error) {
    await multipartUpload.abort();
    throw error;
  }
  await auditUploadPrincipal(context, principal, "upload.create", "upload_session", uploadSessionId, {
    projectId: project.id,
    versionId,
    sizeBytes: parsed.data.sizeBytes,
    purpose,
    format: parsed.data.format,
  });
  return context.json({
    upload: {
      id: uploadSessionId,
      versionId,
      assetId,
      purpose,
      partSizeBytes: captureUploadPartBytes,
      expectedSizeBytes: parsed.data.sizeBytes,
      expiresAt,
      status: "OPEN",
    },
  }, 201);
});

app.put("/api/uploads/:uploadId/parts/:partNumber", async (context) => {
  const principal = await requireUploadPrincipal(context);
  if (principal instanceof Response) return principal;
  const organisationId = uploadPrincipalOrganisationId(principal);
  const upload = await scopedUpload(context.env.DB, organisationId, context.req.param("uploadId"));
  if (
    !upload ||
    upload.status !== "OPEN" ||
    !uploadPrincipalCanAccessProject(principal, upload.project_id)
  ) return notFound(context, "Open upload session not found");
  if (Date.parse(upload.expires_at) <= Date.now()) {
    return context.json({
      error: "This multipart upload expired; discard it and start a new upload",
      code: "upload_expired",
    }, 410);
  }
  const partNumber = Number(context.req.param("partNumber"));
  const contentLength = Number(context.req.header("Content-Length"));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return validationError(context, { partNumber: ["Invalid part number"] });
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > maximumPartBytes) {
    return context.json({ error: `Each part must be between 1 byte and ${maximumPartBytes} bytes` }, 413);
  }
  if (!context.req.raw.body) return validationError(context, { body: ["Missing upload body"] });
  const multipart = context.env.SPATIAL_ASSETS.resumeMultipartUpload(upload.object_key, upload.r2_upload_id);
  let result: R2UploadedPart;
  try {
    result = await multipart.uploadPart(partNumber, context.req.raw.body);
  } catch (error) {
    console.error(JSON.stringify({ event: "upload.part_failed", uploadId: upload.id, partNumber, error: errorMessage(error) }));
    return context.json({ error: "R2 rejected this upload part; retry the same part" }, 502);
  }
  await context.env.DB.prepare(`
    INSERT INTO upload_parts (upload_session_id, part_number, etag, size_bytes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(upload_session_id, part_number)
    DO UPDATE SET etag = excluded.etag, size_bytes = excluded.size_bytes, uploaded_at = datetime('now')
  `).bind(upload.id, partNumber, result.etag, contentLength).run();
  return context.json({ part: result });
});

app.post("/api/uploads/:uploadId/complete", async (context) => {
  const principal = await requireUploadPrincipal(context);
  if (principal instanceof Response) return principal;
  const organisationId = uploadPrincipalOrganisationId(principal);
  const upload = await scopedUpload(context.env.DB, organisationId, context.req.param("uploadId"));
  if (!upload || !uploadPrincipalCanAccessProject(principal, upload.project_id)) {
    return notFound(context, "Upload session not found");
  }
  if (upload.status === "COMPLETED") {
    const existing = await context.env.DB.prepare("SELECT * FROM assets WHERE id = ? AND organisation_id = ?").bind(upload.asset_id, organisationId).first<AssetRow>();
    return context.json({ asset: existing, idempotent: true });
  }
  if (upload.status !== "OPEN") return validationError(context, { upload: [`Upload is ${upload.status.toLowerCase()}`] });
  if (Date.parse(upload.expires_at) <= Date.now()) {
    return context.json({
      error: "This multipart upload expired; discard it and start a new upload",
      code: "upload_expired",
    }, 410);
  }
  const parsed = uploadCompleteSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const storedParts = await context.env.DB.prepare(
    "SELECT part_number, etag, size_bytes FROM upload_parts WHERE upload_session_id = ? ORDER BY part_number",
  ).bind(upload.id).all<{ part_number: number; etag: string; size_bytes: number }>();
  if (storedParts.results.length !== parsed.data.parts.length) return validationError(context, { parts: ["Submitted parts do not match uploaded parts"] });
  const supplied = new Map(parsed.data.parts.map((part) => [part.partNumber, part.etag]));
  const totalBytes = storedParts.results.reduce((total, part) => total + part.size_bytes, 0);
  if (totalBytes !== upload.expected_size_bytes) return validationError(context, { parts: [`Uploaded ${totalBytes} of ${upload.expected_size_bytes} expected bytes`] });
  for (const part of storedParts.results) {
    if (supplied.get(part.part_number) !== part.etag) return validationError(context, { parts: [`ETag mismatch for part ${part.part_number}`] });
  }
  const multipart = context.env.SPATIAL_ASSETS.resumeMultipartUpload(upload.object_key, upload.r2_upload_id);
  let object: R2Object;
  try {
    object = await multipart.complete(storedParts.results.map((part) => ({ partNumber: part.part_number, etag: part.etag })));
  } catch (error) {
    console.error(JSON.stringify({ event: "upload.complete_failed", uploadId: upload.id, error: errorMessage(error) }));
    return context.json({ error: "R2 could not complete this multipart upload; verify part sizes and retry" }, 502);
  }
  const jobId = crypto.randomUUID();
  const project = await scopedProject(context.env.DB, organisationId, upload.project_id);
  if (!project) return notFound(context, "Project not found");
  const importPlan = planCaptureAssetImport({
    adapter: project.capture_adapter as CaptureAdapterId,
    purpose: upload.purpose,
    format: upload.format as CaptureAssetFormat,
  });
  if (!importPlan.accepted) return context.json({ error: importPlan.reason }, 422);
  const processorVersion = importPlan.jobType === "asset.validate"
    ? "open-import-v1"
    : "spatial-evidence/1.0.0";
  const idempotencyKey = `${importPlan.jobType}:${upload.asset_id}:v1`;
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO assets
        (id, organisation_id, project_id, version_id, kind, format, object_key, file_name, mime_type, size_bytes, etag, sha256, integrity_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      upload.asset_id,
      upload.organisation_id,
      upload.project_id,
      upload.version_id,
      importPlan.assetKind,
      upload.format,
      upload.object_key,
      upload.file_name,
      upload.mime_type,
      object.size,
      object.etag,
      upload.sha256,
    ),
    context.env.DB.prepare("UPDATE upload_sessions SET status = 'COMPLETED', completed_at = datetime('now') WHERE id = ? AND status = 'OPEN'").bind(upload.id),
    context.env.DB.prepare("UPDATE scene_versions SET status = 'INGESTED', updated_at = datetime('now') WHERE id = ?").bind(upload.version_id),
    context.env.DB.prepare("UPDATE projects SET status = 'INGESTED', updated_at = datetime('now') WHERE id = ? AND organisation_id = ?").bind(upload.project_id, organisationId),
    context.env.DB.prepare(`
      INSERT INTO processing_jobs
        (id, organisation_id, project_id, version_id, input_asset_id, job_type, processor_version, idempotency_key, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED')
    `).bind(
      jobId,
      organisationId,
      upload.project_id,
      upload.version_id,
      upload.asset_id,
      importPlan.jobType,
      processorVersion,
      idempotencyKey,
    ),
  ]);
  await auditUploadPrincipal(context, principal, "upload.complete", "asset", upload.asset_id, {
    projectId: upload.project_id,
    jobId,
    jobType: importPlan.jobType,
    purpose: upload.purpose,
    kind: importPlan.assetKind,
    sizeBytes: object.size,
    etag: object.etag,
  });
  dispatchProcessingJob(context, jobId);
  return context.json({
    asset: {
      id: upload.asset_id,
      versionId: upload.version_id,
      kind: importPlan.assetKind,
      purpose: upload.purpose,
      sizeBytes: object.size,
      etag: object.etag,
      integrityStatus: "pending",
    },
    job: { id: jobId, type: importPlan.jobType, state: "QUEUED" },
  });
});

app.delete("/api/uploads/:uploadId", async (context) => {
  const principal = await requireUploadPrincipal(context);
  if (principal instanceof Response) return principal;
  const organisationId = uploadPrincipalOrganisationId(principal);
  const upload = await scopedUpload(context.env.DB, organisationId, context.req.param("uploadId"));
  if (
    !upload ||
    upload.status !== "OPEN" ||
    !uploadPrincipalCanAccessProject(principal, upload.project_id)
  ) return notFound(context, "Open upload session not found");
  const multipart = context.env.SPATIAL_ASSETS.resumeMultipartUpload(upload.object_key, upload.r2_upload_id);
  await multipart.abort();
  await context.env.DB.batch([
    context.env.DB.prepare("UPDATE upload_sessions SET status = 'ABORTED' WHERE id = ?").bind(upload.id),
    context.env.DB.prepare("UPDATE scene_versions SET status = 'UPLOAD_FAILED', updated_at = datetime('now') WHERE id = ?").bind(upload.version_id),
    context.env.DB.prepare("UPDATE projects SET status = 'UPLOAD_FAILED', updated_at = datetime('now') WHERE id = ? AND organisation_id = ?").bind(upload.project_id, organisationId),
  ]);
  await auditUploadPrincipal(context, principal, "upload.abort", "upload_session", upload.id, {
    projectId: upload.project_id,
  });
  return context.body(null, 204);
});

app.get("/api/jobs", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  const result = await context.env.DB.prepare(`
    SELECT j.id, j.project_id, j.version_id, j.job_type, j.processor_version, j.state, j.priority,
      j.attempt_count, j.max_attempts, j.leased_by, j.lease_expires_at, j.progress, j.progress_message,
      j.error_json, j.compute_duration_ms, j.active_human_duration_ms, j.input_bytes,
      j.output_bytes, j.evidence_json, j.created_at, j.updated_at, p.name AS project_name
    FROM processing_jobs j JOIN projects p ON p.id = j.project_id
    WHERE j.organisation_id = ?
    ORDER BY CASE j.state WHEN 'RUNNING' THEN 0 WHEN 'LEASED' THEN 1 WHEN 'QUEUED' THEN 2 ELSE 3 END,
      j.priority ASC, j.created_at ASC
    LIMIT 200
  `).bind(auth.organisationId).all();
  return context.json({ jobs: result.results });
});

app.get("/api/releases", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  const result = await context.env.DB.prepare(`
    SELECT r.id, r.project_id, p.name AS project_name, r.version_id, r.access_policy,
      r.published_at, r.expires_at, r.revoked_at,
      COALESCE(
        (SELECT active.slug FROM release_channels active
          WHERE active.active_release_id = r.id AND active.organisation_id = r.organisation_id LIMIT 1),
        (SELECT historical.slug FROM release_channels historical
          WHERE historical.project_id = r.project_id AND historical.organisation_id = r.organisation_id
          ORDER BY historical.updated_at DESC LIMIT 1)
      ) AS slug,
      CASE WHEN EXISTS (
        SELECT 1 FROM release_channels active
        WHERE active.active_release_id = r.id AND active.organisation_id = r.organisation_id
      ) THEN 1 ELSE 0 END AS is_active
    FROM releases r
    JOIN projects p ON p.id = r.project_id
    WHERE r.organisation_id = ?
    ORDER BY r.published_at DESC
    LIMIT 500
  `).bind(auth.organisationId).all();
  return context.json({ releases: result.results });
});

app.post("/api/jobs/:jobId/retry", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const job = await context.env.DB.prepare(`
    SELECT id, project_id, version_id, job_type, state
    FROM processing_jobs
    WHERE id = ? AND organisation_id = ?
  `).bind(context.req.param("jobId"), auth.organisationId).first<{
    id: string;
    project_id: string;
    version_id: string;
    job_type: string;
    state: string;
  }>();
  if (!job) return notFound(context, "Job not found");
  if (job.state === "QUEUED") {
    return context.json({ job: { id: job.id, state: job.state }, idempotent: true });
  }
  if (!["FAILED", "DEAD_LETTER", "CANCELLED"].includes(job.state)) {
    return context.json({ error: `A ${job.state.toLowerCase()} job cannot be retried` }, 409);
  }
  const retryStatements: D1PreparedStatement[] = [
    context.env.DB.prepare(`
      UPDATE processing_jobs
      SET state = 'QUEUED', attempt_count = 0, progress = 0,
        progress_message = 'Operator retry queued', error_json = NULL,
        lease_token_hash = NULL, leased_by = NULL, lease_expires_at = NULL,
        heartbeat_at = NULL, completed_at = NULL, updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(job.id, auth.organisationId),
    context.env.DB.prepare(`
      UPDATE registered_scene_change_reports
      SET status = 'QUEUED', error_json = NULL, completed_at = NULL,
        updated_at = datetime('now')
      WHERE job_id = ? AND organisation_id = ?
    `).bind(job.id, auth.organisationId),
    context.env.DB.prepare(`
      UPDATE semantic_extraction_runs
      SET status = 'QUEUED', updated_at = datetime('now')
      WHERE job_id = ? AND organisation_id = ?
    `).bind(job.id, auth.organisationId),
    context.env.DB.prepare(`
      UPDATE floorplan_extraction_runs
      SET status = 'QUEUED', error_json = NULL, updated_at = datetime('now')
      WHERE job_id = ? AND organisation_id = ?
    `).bind(job.id, auth.organisationId),
  ];
  if (!["registered-scene-change-v1", "semantic.extract-v1", "floorplan.extract-v1"].includes(job.job_type)) {
    retryStatements.push(context.env.DB.prepare(
      "UPDATE scene_versions SET status = 'PROCESSING', updated_at = datetime('now') WHERE id = ?",
    ).bind(job.version_id));
    retryStatements.push(context.env.DB.prepare(
      "UPDATE projects SET status = 'PROCESSING', updated_at = datetime('now') WHERE id = ? AND organisation_id = ?",
    ).bind(job.project_id, auth.organisationId));
  }
  await context.env.DB.batch(retryStatements);
  await audit(context, auth, "job.retry", "processing_job", job.id, { priorState: job.state });
  dispatchProcessingJob(context, job.id);
  return context.json({ job: { id: job.id, state: "QUEUED" } });
});

app.post("/api/jobs/:jobId/cancel", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const job = await context.env.DB.prepare(`
    SELECT id, project_id, version_id, job_type, state
    FROM processing_jobs
    WHERE id = ? AND organisation_id = ?
  `).bind(context.req.param("jobId"), auth.organisationId).first<{
    id: string;
    project_id: string;
    version_id: string;
    job_type: string;
    state: string;
  }>();
  if (!job) return notFound(context, "Job not found");
  if (job.state === "CANCELLED") {
    return context.json({ job: { id: job.id, state: job.state }, idempotent: true });
  }
  if (!["QUEUED", "LEASED", "RUNNING"].includes(job.state)) {
    return context.json({ error: `A ${job.state.toLowerCase()} job cannot be cancelled` }, 409);
  }
  const cancelledResource = job.job_type === "floorplan.extract-v1"
    ? "Vendor-neutral floor-plan extraction"
    : job.job_type === "semantic.extract-v1"
    ? "Semantic extraction"
    : job.job_type === "registered-scene-change-v1"
    ? "Registered raw-scene comparison"
    : "Processing job";
  const cancelError = JSON.stringify({
    code: "OPERATOR_CANCELLED",
    message: `${cancelledResource} was cancelled by a production operator`,
    retryable: true,
    failedAt: new Date().toISOString(),
  });
  const cancelStatements: D1PreparedStatement[] = [
    context.env.DB.prepare(`
      UPDATE processing_jobs
      SET state = 'CANCELLED', progress_message = 'Cancelled by production operator',
        lease_token_hash = NULL, leased_by = NULL, lease_expires_at = NULL,
        completed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(job.id, auth.organisationId),
    context.env.DB.prepare(`
      UPDATE registered_scene_change_reports
      SET status = 'FAILED', error_json = ?, completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE job_id = ? AND organisation_id = ?
    `).bind(cancelError, job.id, auth.organisationId),
    context.env.DB.prepare(`
      UPDATE semantic_extraction_runs
      SET status = 'FAILED', updated_at = datetime('now')
      WHERE job_id = ? AND organisation_id = ?
    `).bind(job.id, auth.organisationId),
    context.env.DB.prepare(`
      UPDATE floorplan_extraction_runs
      SET status = 'CANCELLED', error_json = ?, updated_at = datetime('now')
      WHERE job_id = ? AND organisation_id = ?
    `).bind(cancelError, job.id, auth.organisationId),
  ];
  if (!["registered-scene-change-v1", "semantic.extract-v1", "floorplan.extract-v1"].includes(job.job_type)) {
    cancelStatements.push(context.env.DB.prepare(
      "UPDATE scene_versions SET status = 'PROCESSING_FAILED', updated_at = datetime('now') WHERE id = ?",
    ).bind(job.version_id));
    cancelStatements.push(context.env.DB.prepare(
      "UPDATE projects SET status = 'PROCESSING_FAILED', updated_at = datetime('now') WHERE id = ? AND organisation_id = ?",
    ).bind(job.project_id, auth.organisationId));
  }
  await context.env.DB.batch(cancelStatements);
  await audit(context, auth, "job.cancel", "processing_job", job.id, { priorState: job.state });
  return context.json({ job: { id: job.id, state: "CANCELLED" } });
});

app.post("/api/jobs/:jobId/manual-complete", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = manualJobCompletionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const job = await context.env.DB.prepare(
    "SELECT id, project_id, version_id, job_type, state FROM processing_jobs WHERE id = ? AND organisation_id = ?",
  ).bind(context.req.param("jobId"), auth.organisationId).first<{
    id: string;
    project_id: string;
    version_id: string;
    job_type: string;
    state: string;
  }>();
  if (!job) return notFound(context, "Job not found");
  if (job.job_type === "registered-scene-change-v1") {
    return conflict(context, "Registered raw-scene jobs require processor-generated evidence and cannot be completed manually");
  }
  if (["SUCCEEDED", "CANCELLED"].includes(job.state)) return context.json({ job: { id: job.id, state: job.state }, idempotent: true });
  const qaReportId = crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`
      UPDATE processing_jobs
      SET state = 'SUCCEEDED', progress = 100, progress_message = ?, output_json = ?, completed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ?
    `).bind(parsed.data.progressMessage, JSON.stringify({ manual: true, ...parsed.data.report }), job.id, auth.organisationId),
    context.env.DB.prepare(`
      INSERT INTO qa_reports (id, organisation_id, project_id, version_id, status, report_json)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).bind(qaReportId, auth.organisationId, job.project_id, job.version_id, JSON.stringify(parsed.data.report)),
    context.env.DB.prepare(
      "UPDATE assets SET integrity_status = 'verified' WHERE id = (SELECT input_asset_id FROM processing_jobs WHERE id = ?) AND organisation_id = ?",
    ).bind(job.id, auth.organisationId),
    context.env.DB.prepare("UPDATE scene_versions SET status = 'QA_REQUIRED', updated_at = datetime('now') WHERE id = ?").bind(job.version_id),
    context.env.DB.prepare("UPDATE projects SET status = 'QA_REQUIRED', updated_at = datetime('now') WHERE id = ? AND organisation_id = ?").bind(job.project_id, auth.organisationId),
  ]);
  await audit(context, auth, "job.manual_complete", "processing_job", job.id, { qaReportId });
  return context.json({ job: { id: job.id, state: "SUCCEEDED" }, qaReportId });
});

app.post("/api/worker/jobs/lease", async (context) => {
  if (!(await authenticateWorker(context))) return unauthorized(context, "Invalid worker credential");
  const input = await readJson(context);
  const workerId = readStringProperty(input, "workerId")?.slice(0, 120);
  if (!workerId) return validationError(context, { workerId: ["workerId is required"] });
  const requestedJobId = readStringProperty(input, "jobId");
  if (
    input &&
    typeof input === "object" &&
    Object.prototype.hasOwnProperty.call(input, "jobId") &&
    (!requestedJobId || !workerJobIdPattern.test(requestedJobId))
  ) {
    return validationError(context, { jobId: ["jobId must be a UUID"] });
  }
  const rawLeaseToken = secureToken();
  const leaseTokenHash = await sha256Hex(`${rawLeaseToken}:${context.env.SESSION_PEPPER}`);
  const leaseExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const claimed = await context.env.DB.prepare(`
    UPDATE processing_jobs
    SET state = 'LEASED', leased_by = ?, lease_token_hash = ?, lease_expires_at = ?,
      attempt_count = attempt_count + 1, updated_at = datetime('now')
    WHERE id = (
      SELECT id FROM processing_jobs
      WHERE (state = 'QUEUED' OR (state IN ('LEASED', 'RUNNING') AND lease_expires_at < ?))
        AND attempt_count < max_attempts
        AND (? IS NULL OR id = ?)
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
    )
    RETURNING id
  `).bind(
    workerId,
    leaseTokenHash,
    leaseExpiresAt,
    new Date().toISOString(),
    requestedJobId,
    requestedJobId,
  ).first<{ id: string }>();
  if (!claimed) return context.body(null, 204);
  const job = await context.env.DB.prepare(`
    SELECT j.id, j.organisation_id, j.project_id, j.version_id, j.input_asset_id,
      j.job_type, j.processor_version, j.attempt_count, j.lease_expires_at,
      a.file_name AS input_file_name, a.format AS input_format,
      a.mime_type AS input_mime_type, a.size_bytes AS input_size_bytes,
      a.sha256 AS input_sha256, a.object_key AS input_object_key,
      sv.source_provenance_json AS version_provenance_json,
      us.purpose AS input_purpose,
      r.id AS change_report_id,
      CASE WHEN r.id IS NULL THEN NULL ELSE json_object(
        'coordinateAssurance', r.coordinate_assurance,
        'registrationEvidence', r.registration_evidence,
        'registrationMode', r.registration_mode,
        'registrationSearchRadiusM', r.registration_search_radius_m,
        'registrationMaximumRmseMm', r.registration_maximum_rmse_mm,
        'registrationMinimumOverlapPercent', r.registration_minimum_overlap_percent,
        'voxelSizeM', r.voxel_size_m,
        'structuralChangeThresholdPercent', r.structural_threshold_percent,
        'photometricChangeThresholdPercent', r.photometric_threshold_percent,
        'centroidChangeThresholdMm', r.centroid_threshold_mm,
        'maximumSamplePoints', r.maximum_sample_points
      ) END AS change_config_json,
      ca.id AS secondary_input_asset_id,
      ca.file_name AS secondary_input_file_name,
      ca.format AS secondary_input_format,
      ca.mime_type AS secondary_input_mime_type,
      ca.size_bytes AS secondary_input_size_bytes,
      ca.sha256 AS secondary_input_sha256,
      ca.object_key AS secondary_input_object_key,
      se.id AS semantic_extraction_id,
      se.parameters_json AS semantic_config_json,
      fe.id AS floorplan_extraction_id,
      fe.parameters_json AS floorplan_config_json
    FROM processing_jobs j
    JOIN assets a ON a.id = j.input_asset_id AND a.organisation_id = j.organisation_id
    JOIN scene_versions sv ON sv.id = j.version_id AND sv.project_id = j.project_id
    LEFT JOIN upload_sessions us ON us.asset_id = a.id
    LEFT JOIN registered_scene_change_reports r ON r.job_id = j.id
    LEFT JOIN assets ca ON ca.id = r.candidate_asset_id
      AND ca.organisation_id = j.organisation_id
    LEFT JOIN semantic_extraction_runs se ON se.job_id = j.id
    LEFT JOIN floorplan_extraction_runs fe ON fe.job_id = j.id
    WHERE j.id = ? AND j.lease_token_hash = ?
  `).bind(claimed.id, leaseTokenHash).first<JobLeaseRow>();
  if (!job) {
    await context.env.DB.prepare(`
      UPDATE processing_jobs
      SET state = 'FAILED', progress_message = 'Input asset is missing', lease_token_hash = NULL,
        leased_by = NULL, lease_expires_at = NULL, completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ? AND lease_token_hash = ?
    `).bind(claimed.id, leaseTokenHash).run();
    return context.json({ error: "Claimed job has no readable input asset" }, 409);
  }
  if (job.job_type === "registered-scene-change-v1" && (
    !job.change_report_id ||
    !job.secondary_input_asset_id ||
    !job.secondary_input_file_name ||
    !job.secondary_input_format ||
    !job.secondary_input_mime_type ||
    job.secondary_input_size_bytes === null ||
    !job.secondary_input_object_key
  )) {
    await context.env.DB.batch([
      context.env.DB.prepare(`
        UPDATE processing_jobs
        SET state = 'FAILED', progress_message = 'Registered comparison input is missing',
          lease_token_hash = NULL, leased_by = NULL, lease_expires_at = NULL,
          completed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND lease_token_hash = ?
      `).bind(claimed.id, leaseTokenHash),
      context.env.DB.prepare(`
        UPDATE registered_scene_change_reports
        SET status = 'FAILED',
          error_json = '{"code":"CHANGE_INPUT_MISSING","message":"Registered comparison input is missing"}',
          completed_at = datetime('now'), updated_at = datetime('now')
        WHERE job_id = ?
      `).bind(claimed.id),
    ]);
    return context.json({ error: "Claimed registered comparison has no readable candidate asset" }, 409);
  }
  if (job.change_report_id) {
    await context.env.DB.prepare(`
      UPDATE registered_scene_change_reports
      SET status = 'RUNNING', error_json = NULL, updated_at = datetime('now')
      WHERE id = ? AND status IN ('QUEUED', 'RUNNING')
    `).bind(job.change_report_id).run();
  }
  if (job.semantic_extraction_id) {
    await context.env.DB.prepare(`
      UPDATE semantic_extraction_runs
      SET status = 'PROCESSING', updated_at = datetime('now')
      WHERE id = ? AND status IN ('QUEUED', 'PROCESSING')
    `).bind(job.semantic_extraction_id).run();
  }
  if (job.floorplan_extraction_id) {
    await context.env.DB.prepare(`
      UPDATE floorplan_extraction_runs
      SET status = 'PROCESSING', error_json = NULL, updated_at = datetime('now')
      WHERE id = ? AND status IN ('QUEUED', 'PROCESSING')
    `).bind(job.floorplan_extraction_id).run();
  }
  const posterCamera = storedPosterCamera(job.version_provenance_json);
  return context.json({
    job: {
      id: job.id,
      organisationId: job.organisation_id,
      projectId: job.project_id,
      versionId: job.version_id,
      jobType: job.job_type,
      processorVersion: job.processor_version,
      attemptCount: job.attempt_count,
      input: {
        id: job.input_asset_id,
        fileName: job.input_file_name,
        format: job.input_format,
        purpose: job.input_purpose ?? "gaussian_splat",
        mimeType: job.input_mime_type,
        sizeBytes: job.input_size_bytes,
        sha256: job.input_sha256,
        downloadUrl: job.change_report_id
          ? `/api/worker/jobs/${job.id}/inputs/baseline`
          : `/api/worker/jobs/${job.id}/input`,
      },
      ...(posterCamera ? { posterCamera } : {}),
      ...(job.change_report_id && job.secondary_input_asset_id
        ? {
          changeReportId: job.change_report_id,
          changeConfig: parseStoredObject(job.change_config_json ?? "{}"),
          secondaryInput: {
            id: job.secondary_input_asset_id,
            fileName: job.secondary_input_file_name,
            format: job.secondary_input_format,
            mimeType: job.secondary_input_mime_type,
            sizeBytes: job.secondary_input_size_bytes,
            sha256: job.secondary_input_sha256,
            downloadUrl: `/api/worker/jobs/${job.id}/inputs/candidate`,
          },
        }
        : {}),
      ...(job.semantic_extraction_id
        ? {
          semanticExtractionId: job.semantic_extraction_id,
          semanticConfig: parseStoredObject(job.semantic_config_json ?? "{}"),
        }
        : {}),
      ...(job.floorplan_extraction_id
        ? {
          floorplanExtractionId: job.floorplan_extraction_id,
          floorplanConfig: parseStoredObject(job.floorplan_config_json ?? "{}"),
        }
        : {}),
    },
    leaseToken: rawLeaseToken,
    leaseExpiresAt,
  });
});

app.get("/api/worker/jobs/:jobId/input", async (context) => {
  if (!(await authenticateWorker(context))) return unauthorized(context, "Invalid worker credential");
  const lease = await requireWorkerLease(context, context.req.param("jobId"));
  if (lease instanceof Response) return lease;
  const asset = await context.env.DB.prepare(`
    SELECT a.* FROM assets a
    JOIN processing_jobs j ON j.input_asset_id = a.id
    WHERE j.id = ? AND a.organisation_id = ? AND a.project_id = ? AND a.version_id = ?
  `).bind(lease.id, lease.organisation_id, lease.project_id, lease.version_id).first<AssetRow>();
  if (!asset) return notFound(context, "Job input asset not found");
  const response = await serveR2Object(context, asset.object_key);
  response.headers.set("Content-Disposition", `attachment; filename="${asset.file_name.replaceAll("\"", "")}"`);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

app.get("/api/worker/jobs/:jobId/inputs/:role", async (context) => {
  if (!(await authenticateWorker(context))) return unauthorized(context, "Invalid worker credential");
  const lease = await requireWorkerLease(context, context.req.param("jobId"));
  if (lease instanceof Response) return lease;
  const role = context.req.param("role");
  if (role !== "baseline" && role !== "candidate") {
    return notFound(context, "Registered comparison input role not found");
  }
  const asset = await context.env.DB.prepare(`
    SELECT a.* FROM registered_scene_change_reports r
    JOIN assets a ON a.id = CASE
      WHEN ? = 'baseline' THEN r.baseline_asset_id
      ELSE r.candidate_asset_id
    END
    WHERE r.job_id = ? AND r.organisation_id = ? AND r.project_id = ?
      AND a.organisation_id = r.organisation_id
      AND a.integrity_status = 'verified' AND a.deleted_at IS NULL
  `).bind(
    role,
    lease.id,
    lease.organisation_id,
    lease.project_id,
  ).first<AssetRow>();
  if (!asset) return notFound(context, "Registered comparison input asset not found");
  const response = await serveR2Object(context, asset.object_key);
  response.headers.set("Content-Disposition", `attachment; filename="${asset.file_name.replaceAll("\"", "")}"`);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});

app.put("/api/worker/jobs/:jobId/outputs/:kind/:fileName", async (context) => {
  if (!(await authenticateWorker(context))) return unauthorized(context, "Invalid worker credential");
  const lease = await requireWorkerLease(context, context.req.param("jobId"));
  if (lease instanceof Response) return lease;
  const kind = context.req.param("kind");
  const fileName = safeFileName(decodeURIComponent(context.req.param("fileName")));
  const format = outputFormat(kind, fileName);
  if (!format) return validationError(context, { output: ["Unsupported output kind or file extension"] });
  const contentLength = Number(context.req.header("Content-Length"));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > maximumPartBytes) {
    return context.json({
      error: `Direct worker outputs must be between 1 byte and ${maximumPartBytes} bytes; use the multipart output API for larger derivatives`,
    }, 413);
  }
  if (!context.req.raw.body) return validationError(context, { body: ["Missing output body"] });
  const mimeType = canonicalOutputMimeType(kind, format, context.req.header("Content-Type"));
  const outputId = crypto.randomUUID();
  const objectKey = workerOutputObjectKey(lease, kind, outputId, fileName);
  const object = await context.env.SPATIAL_ASSETS.put(objectKey, context.req.raw.body, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      immutable: "true",
      jobId: lease.id,
      organisationId: lease.organisation_id,
      projectId: lease.project_id,
      versionId: lease.version_id,
      kind,
    },
  });
  return context.json({
    output: {
      kind,
      format,
      objectKey,
      fileName,
      mimeType,
      sizeBytes: object.size,
      etag: object.etag,
    },
  }, 201);
});

app.post("/api/worker/jobs/:jobId/outputs", async (context) => {
  if (!(await authenticateWorker(context))) return unauthorized(context, "Invalid worker credential");
  const lease = await requireWorkerLease(context, context.req.param("jobId"));
  if (lease instanceof Response) return lease;
  const parsed = workerOutputUploadSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const fileName = safeFileName(parsed.data.fileName);
  const format = outputFormat(parsed.data.kind, fileName);
  if (!format) return validationError(context, { output: ["Unsupported output kind or file extension"] });
  const mimeType = canonicalOutputMimeType(parsed.data.kind, format, parsed.data.mimeType);
  const outputUploadId = crypto.randomUUID();
  const objectKey = workerOutputObjectKey(lease, parsed.data.kind, outputUploadId, fileName);
  const multipart = await context.env.SPATIAL_ASSETS.createMultipartUpload(objectKey, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      immutable: "true",
      jobId: lease.id,
      organisationId: lease.organisation_id,
      projectId: lease.project_id,
      versionId: lease.version_id,
      kind: parsed.data.kind,
    },
  });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await context.env.DB.prepare(`
    INSERT INTO job_output_uploads
      (id, job_id, organisation_id, project_id, version_id, kind, format, object_key,
        file_name, mime_type, expected_size_bytes, sha256, r2_upload_id, status, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
  `).bind(
    outputUploadId,
    lease.id,
    lease.organisation_id,
    lease.project_id,
    lease.version_id,
    parsed.data.kind,
    format,
    objectKey,
    fileName,
    mimeType,
    parsed.data.sizeBytes,
    parsed.data.sha256 ?? null,
    multipart.uploadId,
    expiresAt,
  ).run();
  return context.json({
    upload: {
      id: outputUploadId,
      partSizeBytes: 25 * 1024 * 1024,
      expectedSizeBytes: parsed.data.sizeBytes,
      expiresAt,
    },
  }, 201);
});

app.put("/api/worker/jobs/:jobId/outputs/:outputId/parts/:partNumber", async (context) => {
  if (!(await authenticateWorker(context))) return unauthorized(context, "Invalid worker credential");
  const lease = await requireWorkerLease(context, context.req.param("jobId"));
  if (lease instanceof Response) return lease;
  const upload = await workerOutputUpload(
    context.env.DB,
    lease,
    context.req.param("outputId"),
  );
  if (!upload || upload.status !== "OPEN" || upload.expires_at <= new Date().toISOString()) {
    return notFound(context, "Open output upload not found");
  }
  const partNumber = Number(context.req.param("partNumber"));
  const contentLength = Number(context.req.header("Content-Length"));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return validationError(context, { partNumber: ["Invalid part number"] });
  }
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > maximumPartBytes) {
    return context.json({ error: `Each output part must be between 1 byte and ${maximumPartBytes} bytes` }, 413);
  }
  if (!context.req.raw.body) return validationError(context, { body: ["Missing output part body"] });
  const multipart = context.env.SPATIAL_ASSETS.resumeMultipartUpload(upload.object_key, upload.r2_upload_id);
  const part = await multipart.uploadPart(partNumber, context.req.raw.body);
  await context.env.DB.prepare(`
    INSERT INTO job_output_parts (output_upload_id, part_number, etag, size_bytes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(output_upload_id, part_number)
    DO UPDATE SET etag = excluded.etag, size_bytes = excluded.size_bytes, uploaded_at = datetime('now')
  `).bind(upload.id, partNumber, part.etag, contentLength).run();
  return context.json({ part });
});

app.post("/api/worker/jobs/:jobId/outputs/:outputId/complete", async (context) => {
  if (!(await authenticateWorker(context))) return unauthorized(context, "Invalid worker credential");
  const lease = await requireWorkerLease(context, context.req.param("jobId"));
  if (lease instanceof Response) return lease;
  const upload = await workerOutputUpload(
    context.env.DB,
    lease,
    context.req.param("outputId"),
  );
  if (!upload) return notFound(context, "Output upload not found");
  if (upload.status === "COMPLETED") {
    const stored = await context.env.SPATIAL_ASSETS.head(upload.object_key);
    if (!stored) return notFound(context, "Completed output object not found");
    return context.json({ output: workerOutputDescriptor(upload, stored), idempotent: true });
  }
  if (upload.status !== "OPEN") return validationError(context, { upload: [`Output upload is ${upload.status.toLowerCase()}`] });
  const parsed = uploadCompleteSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const storedParts = await context.env.DB.prepare(`
    SELECT part_number, etag, size_bytes
    FROM job_output_parts
    WHERE output_upload_id = ?
    ORDER BY part_number
  `).bind(upload.id).all<{ part_number: number; etag: string; size_bytes: number }>();
  if (storedParts.results.length !== parsed.data.parts.length) {
    return validationError(context, { parts: ["Submitted parts do not match uploaded output parts"] });
  }
  const supplied = new Map(parsed.data.parts.map((part) => [part.partNumber, part.etag]));
  const totalBytes = storedParts.results.reduce((total, part) => total + part.size_bytes, 0);
  if (totalBytes !== upload.expected_size_bytes) {
    return validationError(context, { parts: [`Uploaded ${totalBytes} of ${upload.expected_size_bytes} expected bytes`] });
  }
  for (const part of storedParts.results) {
    if (supplied.get(part.part_number) !== part.etag) {
      return validationError(context, { parts: [`ETag mismatch for part ${part.part_number}`] });
    }
  }
  const multipart = context.env.SPATIAL_ASSETS.resumeMultipartUpload(upload.object_key, upload.r2_upload_id);
  const object = await multipart.complete(
    storedParts.results.map((part) => ({ partNumber: part.part_number, etag: part.etag })),
  );
  await context.env.DB.prepare(`
    UPDATE job_output_uploads
    SET status = 'COMPLETED', completed_at = datetime('now')
    WHERE id = ? AND status = 'OPEN'
  `).bind(upload.id).run();
  return context.json({ output: workerOutputDescriptor(upload, object) });
});

app.post("/api/worker/jobs/:jobId/heartbeat", async (context) => {
  if (!(await authenticateWorker(context))) return unauthorized(context, "Invalid worker credential");
  const input = await readJson(context);
  const leaseToken = readStringProperty(input, "leaseToken");
  const progress = readNumberProperty(input, "progress");
  const message = readStringProperty(input, "message")?.slice(0, 500) ?? null;
  if (!leaseToken || progress === null || progress < 0 || progress > 100) return validationError(context, { heartbeat: ["Invalid leaseToken or progress"] });
  const tokenHash = await sha256Hex(`${leaseToken}:${context.env.SESSION_PEPPER}`);
  const leaseExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const result = await context.env.DB.prepare(`
    UPDATE processing_jobs
    SET state = 'RUNNING', progress = ?, progress_message = ?, heartbeat_at = datetime('now'),
      lease_expires_at = ?, updated_at = datetime('now')
    WHERE id = ? AND lease_token_hash = ? AND state IN ('LEASED', 'RUNNING')
      AND lease_expires_at > ?
  `).bind(
    Math.floor(progress),
    message,
    leaseExpiresAt,
    context.req.param("jobId"),
    tokenHash,
    new Date().toISOString(),
  ).run();
  if (result.meta.changes !== 1) return forbidden(context, "Lease is invalid or expired");
  return context.json({ leaseExpiresAt });
});

app.post("/api/worker/jobs/:jobId/complete", async (context) => {
  if (!(await authenticateWorker(context))) return unauthorized(context, "Invalid worker credential");
  const parsed = workerJobCompletionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const tokenHash = await sha256Hex(`${parsed.data.leaseToken}:${context.env.SESSION_PEPPER}`);
  const job = await context.env.DB.prepare(`
    SELECT j.id, j.organisation_id, j.project_id, j.version_id, j.input_asset_id,
      j.job_type, j.state, a.size_bytes AS input_size_bytes
    FROM processing_jobs j
    JOIN assets a ON a.id = j.input_asset_id AND a.organisation_id = j.organisation_id
    WHERE j.id = ? AND j.lease_token_hash = ? AND j.state IN ('LEASED', 'RUNNING')
      AND j.lease_expires_at > ?
  `).bind(context.req.param("jobId"), tokenHash, new Date().toISOString()).first<{
    id: string;
    organisation_id: string;
    project_id: string;
    version_id: string;
    input_asset_id: string | null;
    job_type: string;
    state: string;
    input_size_bytes: number;
  }>();
  if (!job) return forbidden(context, "Lease is invalid or expired");
  if (job.job_type === "registered-scene-change-v1") {
    return conflict(context, "Registered raw-scene jobs must use the evidence-specific completion contract");
  }
  if (parsed.data.evidence.inputBytes !== job.input_size_bytes) {
    return validationError(context, { evidence: ["Reported input bytes do not match the leased source asset"] });
  }

  const assetStatements: D1PreparedStatement[] = [];
  const outputSummary: Array<Record<string, unknown>> = [];
  for (const output of parsed.data.outputs) {
    const allowedPrefixes = [
      `delivery-private/${job.organisation_id}/${job.project_id}/${job.version_id}/`,
      `masters-private/${job.organisation_id}/${job.project_id}/${job.version_id}/`,
      `reports-private/${job.organisation_id}/${job.project_id}/${job.version_id}/`,
    ];
    if (!allowedPrefixes.some((prefix) => output.objectKey.startsWith(prefix))) {
      return validationError(context, { objectKey: ["Output key is outside this job's immutable project prefix"] });
    }
    if (safeFileName(output.fileName) !== output.fileName) {
      return validationError(context, { fileName: ["Output filename is not canonical"] });
    }
    if (output.kind === "web" && !allowedWebFormats.has(output.format)) {
      return validationError(context, { format: ["Spark web outputs must be RAD, SPZ, or SOG"] });
    }
    const stored = await context.env.SPATIAL_ASSETS.head(output.objectKey);
    if (!stored) return validationError(context, { objectKey: [`Stored output does not exist: ${output.objectKey}`] });
    const assetId = crypto.randomUUID();
    assetStatements.push(context.env.DB.prepare(`
      INSERT INTO assets
        (id, organisation_id, project_id, version_id, kind, format, object_key, file_name, mime_type, size_bytes, etag, sha256, integrity_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified')
    `).bind(
      assetId,
      job.organisation_id,
      job.project_id,
      job.version_id,
      output.kind,
      output.format,
      output.objectKey,
      output.fileName,
      output.mimeType,
      stored.size,
      stored.etag,
      output.sha256 ?? null,
    ));
    outputSummary.push({ id: assetId, kind: output.kind, format: output.format, sizeBytes: stored.size });
  }
  const storedOutputBytes = outputSummary.reduce((total, output) => {
    const size = output.sizeBytes;
    return total + (typeof size === "number" ? size : 0);
  }, 0);
  if (parsed.data.evidence.outputBytes !== storedOutputBytes) {
    return validationError(context, { evidence: ["Reported output bytes do not match stored derivative assets"] });
  }

  const qaReportId = crypto.randomUUID();
  const executionEvidence = {
    ...parsed.data.evidence,
    completedAt: new Date().toISOString(),
  };
  await context.env.DB.batch([
    ...assetStatements,
    context.env.DB.prepare(
      "UPDATE assets SET integrity_status = 'verified' WHERE id = ? AND organisation_id = ?",
    ).bind(job.input_asset_id, job.organisation_id),
    context.env.DB.prepare(`
      UPDATE processing_jobs
      SET state = 'SUCCEEDED', progress = 100, progress_message = ?, output_json = ?,
        processor_version = ?, compute_duration_ms = ?, active_human_duration_ms = ?,
        input_bytes = ?, output_bytes = ?, evidence_json = ?,
        completed_at = datetime('now'), lease_token_hash = NULL, lease_expires_at = NULL,
        updated_at = datetime('now')
      WHERE id = ? AND lease_token_hash = ?
    `).bind(
      parsed.data.progressMessage,
      JSON.stringify({ outputs: outputSummary, report: parsed.data.report }),
      parsed.data.evidence.processorVersion,
      parsed.data.evidence.computeDurationMs,
      parsed.data.evidence.activeHumanDurationMs,
      parsed.data.evidence.inputBytes,
      parsed.data.evidence.outputBytes,
      JSON.stringify(executionEvidence),
      job.id,
      tokenHash,
    ),
    context.env.DB.prepare(`
      INSERT INTO qa_reports (id, organisation_id, project_id, version_id, status, report_json)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).bind(
      qaReportId,
      job.organisation_id,
      job.project_id,
      job.version_id,
      JSON.stringify(parsed.data.report),
    ),
    context.env.DB.prepare(
      "UPDATE scene_versions SET status = 'QA_REQUIRED', updated_at = datetime('now') WHERE id = ?",
    ).bind(job.version_id),
    context.env.DB.prepare(
      "UPDATE projects SET status = 'QA_REQUIRED', updated_at = datetime('now') WHERE id = ? AND organisation_id = ?",
    ).bind(job.project_id, job.organisation_id),
  ]);
  return context.json({ job: { id: job.id, state: "SUCCEEDED" }, outputs: outputSummary, qaReportId });
});

app.post("/api/worker/jobs/:jobId/scene-change-complete", async (context) => {
  if (!(await authenticateWorker(context))) return unauthorized(context, "Invalid worker credential");
  const parsed = workerSceneChangeCompletionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const tokenHash = await sha256Hex(`${parsed.data.leaseToken}:${context.env.SESSION_PEPPER}`);
  const job = await context.env.DB.prepare(`
    SELECT j.id, j.organisation_id, j.project_id, j.version_id,
      j.input_asset_id, j.state, ba.size_bytes AS baseline_size_bytes,
      ca.size_bytes AS candidate_size_bytes, r.id AS report_id,
      r.registration_mode, r.registration_maximum_rmse_mm,
      r.registration_minimum_overlap_percent
    FROM processing_jobs j
    JOIN registered_scene_change_reports r ON r.job_id = j.id
    JOIN assets ba ON ba.id = r.baseline_asset_id
    JOIN assets ca ON ca.id = r.candidate_asset_id
    WHERE j.id = ? AND j.job_type = 'registered-scene-change-v1'
      AND j.lease_token_hash = ? AND j.state IN ('LEASED', 'RUNNING')
      AND j.lease_expires_at > ?
  `).bind(
    context.req.param("jobId"),
    tokenHash,
    new Date().toISOString(),
  ).first<{
    id: string;
    organisation_id: string;
    project_id: string;
    version_id: string;
    input_asset_id: string;
    state: string;
    baseline_size_bytes: number;
    candidate_size_bytes: number;
    report_id: string;
    registration_mode: "declared" | "automatic_rigid";
    registration_maximum_rmse_mm: number;
    registration_minimum_overlap_percent: number;
  }>();
  if (!job) return forbidden(context, "Lease is invalid or expired");
  const expectedInputBytes = job.baseline_size_bytes + job.candidate_size_bytes;
  if (
    parsed.data.evidence.baselineInputBytes !== job.baseline_size_bytes ||
    parsed.data.evidence.candidateInputBytes !== job.candidate_size_bytes ||
    parsed.data.evidence.inputBytes !== expectedInputBytes
  ) {
    return validationError(context, {
      evidence: ["Reported input bytes do not match the exact registered comparison assets"],
    });
  }
  const reportMethod = readStringProperty(parsed.data.report, "method");
  const reportResult = readStringProperty(parsed.data.report, "result");
  if (reportMethod !== "registered-ply-voxel-change-v1") {
    return validationError(context, { report: ["Unsupported registered-scene report method"] });
  }
  if (
    reportResult !== "changes_detected" &&
    reportResult !== "no_material_change" &&
    reportResult !== "registration_blocked"
  ) {
    return validationError(context, { report: ["Registered-scene report has no valid result"] });
  }
  const registration = Reflect.get(parsed.data.report, "registration");
  if (!registration || typeof registration !== "object") {
    return validationError(context, { report: ["Registered-scene report has no registration evidence"] });
  }
  const performedByProcessor = Reflect.get(registration, "performedByProcessor");
  const registrationStatus = readStringProperty(registration, "status");
  if (job.registration_mode === "declared") {
    if (performedByProcessor !== false || reportResult === "registration_blocked") {
      return validationError(context, { report: ["Declared registration report has invalid processor evidence"] });
    }
  } else {
    const registrationMethod = readStringProperty(registration, "method");
    const registrationSummary = Reflect.get(registration, "summary");
    const transform = Reflect.get(registration, "transform");
    const matrix = transform && typeof transform === "object"
      ? Reflect.get(transform, "matrix4x4")
      : null;
    const rmseMm = registrationSummary && typeof registrationSummary === "object"
      ? Reflect.get(registrationSummary, "rmseMm")
      : null;
    const overlapPercent = registrationSummary && typeof registrationSummary === "object"
      ? Reflect.get(registrationSummary, "overlapPercent")
      : null;
    if (
      performedByProcessor !== true ||
      registrationMethod !== "bounded-yaw-icp-v1" ||
      (registrationStatus !== "accepted" && registrationStatus !== "blocked") ||
      !Array.isArray(matrix) ||
      matrix.length !== 16 ||
      !matrix.every((value) => typeof value === "number" && Number.isFinite(value)) ||
      typeof rmseMm !== "number" ||
      !Number.isFinite(rmseMm) ||
      typeof overlapPercent !== "number" ||
      !Number.isFinite(overlapPercent)
    ) {
      return validationError(context, { report: ["Automatic registration evidence is incomplete"] });
    }
    const gatesAccepted = (
      rmseMm <= job.registration_maximum_rmse_mm &&
      overlapPercent >= job.registration_minimum_overlap_percent &&
      Reflect.get(registrationSummary, "ambiguous") === false
    );
    if (
      (registrationStatus === "accepted") !== gatesAccepted ||
      (registrationStatus === "blocked") !== (reportResult === "registration_blocked")
    ) {
      return validationError(context, { report: ["Automatic registration result contradicts its server-declared gates"] });
    }
  }
  const output = parsed.data.output;
  const expectedPrefix = `reports-private/${job.organisation_id}/${job.project_id}/${job.version_id}/`;
  if (!output.objectKey.startsWith(expectedPrefix)) {
    return validationError(context, { objectKey: ["Change report is outside this job's immutable report prefix"] });
  }
  if (safeFileName(output.fileName) !== output.fileName) {
    return validationError(context, { fileName: ["Output filename is not canonical"] });
  }
  const stored = await context.env.SPATIAL_ASSETS.head(output.objectKey);
  if (!stored) return validationError(context, { objectKey: ["Stored change report does not exist"] });
  if (stored.size !== parsed.data.evidence.outputBytes) {
    return validationError(context, { evidence: ["Reported output bytes do not match the stored report"] });
  }
  const reportAssetId = crypto.randomUUID();
  const executionEvidence = {
    ...parsed.data.evidence,
    completedAt: new Date().toISOString(),
    changeReportId: job.report_id,
  };
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO assets (
        id, organisation_id, project_id, version_id, kind, format, object_key,
        file_name, mime_type, size_bytes, etag, sha256, integrity_status
      ) VALUES (?, ?, ?, ?, 'report', 'json', ?, ?, ?, ?, ?, ?, 'verified')
    `).bind(
      reportAssetId,
      job.organisation_id,
      job.project_id,
      job.version_id,
      output.objectKey,
      output.fileName,
      output.mimeType,
      stored.size,
      stored.etag,
      output.sha256 ?? null,
    ),
    context.env.DB.prepare(`
      UPDATE processing_jobs
      SET state = 'SUCCEEDED', progress = 100, progress_message = ?,
        output_json = ?, processor_version = ?, compute_duration_ms = ?,
        active_human_duration_ms = ?, input_bytes = ?, output_bytes = ?,
        evidence_json = ?, completed_at = datetime('now'),
        lease_token_hash = NULL, leased_by = NULL, lease_expires_at = NULL,
        updated_at = datetime('now')
      WHERE id = ? AND lease_token_hash = ?
    `).bind(
      parsed.data.progressMessage,
      JSON.stringify({ outputs: [{ id: reportAssetId, kind: "report", format: "json", sizeBytes: stored.size }], report: parsed.data.report }),
      parsed.data.evidence.processorVersion,
      parsed.data.evidence.computeDurationMs,
      parsed.data.evidence.activeHumanDurationMs,
      parsed.data.evidence.inputBytes,
      parsed.data.evidence.outputBytes,
      JSON.stringify(executionEvidence),
      job.id,
      tokenHash,
    ),
    context.env.DB.prepare(`
      UPDATE registered_scene_change_reports
      SET status = 'COMPLETED', report_asset_id = ?, result = ?,
        summary_json = ?, registration_status = ?,
        registration_summary_json = ?, error_json = NULL, completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ? AND job_id = ?
    `).bind(
      reportAssetId,
      reportResult === "registration_blocked" ? null : reportResult,
      JSON.stringify(parsed.data.report),
      registrationStatus === "accepted" || registrationStatus === "blocked"
        ? registrationStatus
        : null,
      JSON.stringify(registration),
      job.report_id,
      job.id,
    ),
  ]);
  return context.json({
    job: { id: job.id, state: "SUCCEEDED" },
    report: { id: job.report_id, status: "COMPLETED", result: reportResult },
    reportAssetId,
  });
});

app.post("/api/worker/jobs/:jobId/semantic-extraction-complete", async (context) => {
  if (!(await authenticateWorker(context))) return unauthorized(context, "Invalid worker credential");
  const parsed = workerSemanticExtractionCompletionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const tokenHash = await sha256Hex(`${parsed.data.leaseToken}:${context.env.SESSION_PEPPER}`);
  const job = await context.env.DB.prepare(`
    SELECT j.id, j.organisation_id, j.project_id, j.version_id,
      j.input_asset_id, j.state, a.size_bytes AS input_size_bytes,
      r.id AS extraction_id, r.parameters_json
    FROM processing_jobs j
    JOIN semantic_extraction_runs r ON r.job_id = j.id
    JOIN assets a ON a.id = j.input_asset_id
    WHERE j.id = ? AND j.job_type = 'semantic.extract-v1'
      AND j.lease_token_hash = ? AND j.state IN ('LEASED', 'RUNNING')
      AND j.lease_expires_at > ?
  `).bind(
    context.req.param("jobId"),
    tokenHash,
    new Date().toISOString(),
  ).first<{
    id: string;
    organisation_id: string;
    project_id: string;
    version_id: string;
    input_asset_id: string;
    state: string;
    input_size_bytes: number;
    extraction_id: string;
    parameters_json: string;
  }>();
  if (!job) return forbidden(context, "Lease is invalid or expired");
  if (parsed.data.evidence.inputBytes !== job.input_size_bytes) {
    return validationError(context, {
      evidence: ["Reported input bytes do not match the exact registered point-cloud asset"],
    });
  }
  const serverParameters = parseStoredObject(job.parameters_json);
  const reportParameters = parsed.data.report.parameters;
  const semanticWorldUnit = parseWorldUnit(Reflect.get(
    Reflect.get(serverParameters as object, "sourceToWorld") ?? {},
    "worldUnit",
  ));
  if (parsed.data.report.worldUnit !== semanticWorldUnit) {
    return validationError(context, {
      report: ["Semantic report world unit differs from the queued source-to-world evidence"],
    });
  }
  for (const [serverProperty, reportProperty] of [
    ["gridSizeM", "gridSize"],
    ["floorBandM", "floorBand"],
    ["minimumAreaM2", "minimumArea"],
    ["maximumCandidates", "maximumCandidates"],
    ["elevationHintM", "elevationHint"],
  ] as const) {
    if (
      (Reflect.get(serverParameters as object, serverProperty) ?? null) !==
      Reflect.get(reportParameters, reportProperty)
    ) {
      return validationError(context, {
        report: [
          `Semantic report parameter ${reportProperty} differs from the queued job`,
        ],
      });
    }
  }
  if (
    Reflect.get(parsed.data.report.source, "coordinateAssurance") !==
      Reflect.get(serverParameters as object, "coordinateAssurance")
  ) {
    return validationError(context, {
      report: ["Semantic report coordinate assurance differs from the queued job"],
    });
  }
  if (
    JSON.stringify(Reflect.get(parsed.data.report.source, "sourceToWorld") ?? null) !==
      JSON.stringify(Reflect.get(serverParameters as object, "sourceToWorld") ?? null)
  ) {
    return validationError(context, {
      report: ["Semantic report source-to-world transform differs from the queued job"],
    });
  }
  const candidateKeys = new Set(parsed.data.report.candidates.map((candidate) => candidate.candidateKey));
  if (candidateKeys.size !== parsed.data.report.candidates.length) {
    return validationError(context, { report: ["Semantic candidate keys must be unique"] });
  }
  for (const candidate of parsed.data.report.candidates) {
    const footprint = measurementFootprint({
      id: candidate.candidateKey,
      label: candidate.label,
      geometry_json: JSON.stringify(candidate.geometry),
    });
    if (!footprint) {
      return validationError(context, { report: [`Candidate ${candidate.candidateKey} has invalid polygon geometry`] });
    }
    const area = polygonArea2(footprint.points);
    const tolerance = Math.max(0.01, candidate.area * 0.01);
    if (Math.abs(area - candidate.area) > tolerance) {
      return validationError(context, {
        report: [`Candidate ${candidate.candidateKey} area contradicts its polygon geometry`],
      });
    }
    if (candidate.geometry.points.some((point) => Math.abs(point[1] - candidate.elevation) > 0.001)) {
      return validationError(context, {
        report: [`Candidate ${candidate.candidateKey} polygon is not on its declared elevation`],
      });
    }
  }
  const output = parsed.data.output;
  const expectedPrefix = `reports-private/${job.organisation_id}/${job.project_id}/${job.version_id}/`;
  if (!output.objectKey.startsWith(expectedPrefix)) {
    return validationError(context, { objectKey: ["Semantic report is outside this job's immutable report prefix"] });
  }
  if (safeFileName(output.fileName) !== output.fileName) {
    return validationError(context, { fileName: ["Output filename is not canonical"] });
  }
  const stored = await context.env.SPATIAL_ASSETS.head(output.objectKey);
  if (!stored) return validationError(context, { objectKey: ["Stored semantic report does not exist"] });
  if (stored.size !== parsed.data.evidence.outputBytes) {
    return validationError(context, { evidence: ["Reported output bytes do not match the stored report"] });
  }
  const reportAssetId = crypto.randomUUID();
  const executionEvidence = {
    ...parsed.data.evidence,
    completedAt: new Date().toISOString(),
    semanticExtractionId: job.extraction_id,
    humanReviewRequired: true,
  };
  const candidateStatements = parsed.data.report.candidates.map((candidate) =>
    context.env.DB.prepare(`
      INSERT INTO semantic_candidates (
        id, extraction_id, organisation_id, project_id, version_id,
        candidate_key, kind, label, geometry_json, elevation_m, area_m2,
        confidence, evidence_json, world_unit
      ) VALUES (?, ?, ?, ?, ?, ?, 'walkable_region', ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      job.extraction_id,
      job.organisation_id,
      job.project_id,
      job.version_id,
      candidate.candidateKey,
      candidate.label,
      JSON.stringify(candidate.geometry),
      candidate.elevation,
      candidate.area,
      candidate.confidence,
      JSON.stringify(candidate.evidence),
      semanticWorldUnit,
    )
  );
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO assets (
        id, organisation_id, project_id, version_id, kind, format, object_key,
        file_name, mime_type, size_bytes, etag, sha256, integrity_status
      ) VALUES (?, ?, ?, ?, 'report', 'json', ?, ?, ?, ?, ?, ?, 'verified')
    `).bind(
      reportAssetId,
      job.organisation_id,
      job.project_id,
      job.version_id,
      output.objectKey,
      output.fileName,
      output.mimeType,
      stored.size,
      stored.etag,
      output.sha256 ?? null,
    ),
    context.env.DB.prepare(`
      UPDATE processing_jobs
      SET state = 'SUCCEEDED', progress = 100, progress_message = ?,
        output_json = ?, processor_version = ?, compute_duration_ms = ?,
        active_human_duration_ms = ?, input_bytes = ?, output_bytes = ?,
        evidence_json = ?, completed_at = datetime('now'),
        lease_token_hash = NULL, leased_by = NULL, lease_expires_at = NULL,
        updated_at = datetime('now')
      WHERE id = ? AND lease_token_hash = ?
    `).bind(
      parsed.data.progressMessage,
      JSON.stringify({
        outputs: [{ id: reportAssetId, kind: "report", format: "json", sizeBytes: stored.size }],
        report: parsed.data.report,
      }),
      parsed.data.evidence.processorVersion,
      parsed.data.evidence.computeDurationMs,
      parsed.data.evidence.activeHumanDurationMs,
      parsed.data.evidence.inputBytes,
      parsed.data.evidence.outputBytes,
      JSON.stringify(executionEvidence),
      job.id,
      tokenHash,
    ),
    context.env.DB.prepare(`
      UPDATE semantic_extraction_runs
      SET status = 'READY_FOR_REVIEW', report_asset_id = ?, summary_json = ?,
        candidate_count = ?, updated_at = datetime('now')
      WHERE id = ? AND job_id = ? AND status IN ('PROCESSING', 'QUEUED')
    `).bind(
      reportAssetId,
      JSON.stringify(parsed.data.report.summary),
      parsed.data.report.candidates.length,
      job.extraction_id,
      job.id,
    ),
    ...candidateStatements,
  ]);
  return context.json({
    job: { id: job.id, state: "SUCCEEDED" },
    extraction: {
      id: job.extraction_id,
      status: "READY_FOR_REVIEW",
      candidateCount: parsed.data.report.candidates.length,
    },
    reportAssetId,
  });
});

app.post("/api/worker/jobs/:jobId/floorplan-extraction-complete", async (context) => {
  if (!(await authenticateWorker(context))) return unauthorized(context, "Invalid worker credential");
  const parsed = workerFloorplanExtractionCompletionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const tokenHash = await sha256Hex(`${parsed.data.leaseToken}:${context.env.SESSION_PEPPER}`);
  const job = await context.env.DB.prepare(`
    SELECT j.id, j.organisation_id, j.project_id, j.version_id,
      j.input_asset_id, j.state, a.size_bytes AS input_size_bytes,
      a.format AS input_format, r.id AS extraction_id, r.parameters_json,
      r.normalizer
    FROM processing_jobs j
    JOIN floorplan_extraction_runs r ON r.job_id = j.id
    JOIN assets a ON a.id = j.input_asset_id
    WHERE j.id = ? AND j.job_type = 'floorplan.extract-v1'
      AND j.lease_token_hash = ? AND j.state IN ('LEASED', 'RUNNING')
      AND j.lease_expires_at > ?
  `).bind(
    context.req.param("jobId"),
    tokenHash,
    new Date().toISOString(),
  ).first<{
    id: string;
    organisation_id: string;
    project_id: string;
    version_id: string;
    input_asset_id: string;
    state: string;
    input_size_bytes: number;
    input_format: string;
    extraction_id: string;
    parameters_json: string;
    normalizer: string;
  }>();
  if (!job) return forbidden(context, "Lease is invalid or expired");
  if (parsed.data.evidence.inputBytes !== job.input_size_bytes) {
    return validationError(context, {
      evidence: ["Reported input bytes do not match the exact registered point-cloud asset"],
    });
  }
  const sourceFormat = job.input_format.toLowerCase();
  if (
    parsed.data.evidence.normalization.sourceFormat !== sourceFormat ||
    Reflect.get(parsed.data.report.source, "sourceFormat") !== sourceFormat
  ) {
    return validationError(context, {
      evidence: ["Normalization evidence does not match the immutable source format"],
    });
  }
  if (
    (job.normalizer === "native-ply-v1" && (
      parsed.data.evidence.normalization.tool !== "native-ply-v1" ||
      parsed.data.evidence.normalization.commandDigest !== null
    )) ||
    (job.normalizer === "pdal" && (
      parsed.data.evidence.normalization.tool !== "PDAL" ||
      parsed.data.evidence.normalization.commandDigest === null
    ))
  ) {
    return validationError(context, {
      evidence: ["Normalization provenance is inconsistent with the source format"],
    });
  }
  const serverParameters = parseStoredObject(job.parameters_json);
  if (
    parsed.data.evidence.normalization.sourceUpAxis !==
      Reflect.get(serverParameters as object, "sourceUpAxis")
  ) {
    return validationError(context, {
      evidence: ["Normalization up-axis does not match the queued source declaration"],
    });
  }
  for (const property of [
    "gridSizeM",
    "floorBandM",
    "wallMinHeightM",
    "wallMaxHeightM",
    "minimumWallHeightCoverage",
    "minimumRoomAreaM2",
    "maximumOpeningWidthM",
    "maximumRooms",
    "maximumSamplePoints",
    "sourceUpAxis",
    "elevationHintM",
  ]) {
    if (Reflect.get(serverParameters as object, property) !==
      Reflect.get(parsed.data.report.parameters, property)) {
      return validationError(context, {
        report: [`Floor-plan report parameter ${property} differs from the queued job`],
      });
    }
  }
  const maximumSamplePoints = Reflect.get(serverParameters as object, "maximumSamplePoints");
  const sampledPointCount = Reflect.get(parsed.data.report.source, "sampledPointCount");
  if (
    typeof maximumSamplePoints !== "number" ||
    !Number.isSafeInteger(maximumSamplePoints) ||
    typeof sampledPointCount !== "number" ||
    !Number.isSafeInteger(sampledPointCount) ||
    sampledPointCount < 1 ||
    sampledPointCount > maximumSamplePoints
  ) {
    return validationError(context, {
      report: ["Floor-plan sampled point count exceeds or omits the queued processing bound"],
    });
  }
  if (
    Reflect.get(parsed.data.report.source, "coordinateAssurance") !==
      Reflect.get(serverParameters as object, "coordinateAssurance")
  ) {
    return validationError(context, {
      report: ["Floor-plan coordinate assurance differs from the queued job"],
    });
  }
  const proposalKeys = [
    ...parsed.data.report.rooms.map((room) => room.roomKey),
    ...parsed.data.report.walls.map((wall) => wall.wallKey),
    ...parsed.data.report.openings.map((opening) => opening.openingKey),
  ];
  if (new Set(proposalKeys).size !== proposalKeys.length) {
    return validationError(context, { report: ["Every proposal key must be unique"] });
  }
  for (const room of parsed.data.report.rooms) {
    const footprint = measurementFootprint({
      id: room.roomKey,
      label: room.label,
      geometry_json: JSON.stringify(room.geometry),
    });
    if (!footprint) {
      return validationError(context, { report: [`Room ${room.roomKey} has invalid polygon geometry`] });
    }
    const area = polygonArea2(footprint.points);
    const tolerance = Math.max(0.01, room.areaM2 * 0.01);
    if (Math.abs(area - room.areaM2) > tolerance) {
      return validationError(context, {
        report: [`Room ${room.roomKey} area contradicts its polygon geometry`],
      });
    }
    if (room.geometry.points.some((point) => Math.abs(point[1] - room.elevationM) > 0.001)) {
      return validationError(context, {
        report: [`Room ${room.roomKey} is not on its declared elevation`],
      });
    }
  }
  const reportedArea = parsed.data.report.rooms.reduce((sum, room) => sum + room.areaM2, 0);
  if (Math.abs(reportedArea - parsed.data.report.summary.totalRoomAreaM2) >
    Math.max(0.01, reportedArea * 0.01)) {
    return validationError(context, {
      report: ["Total room area contradicts the room proposals"],
    });
  }
  const output = parsed.data.output;
  const expectedPrefix = `reports-private/${job.organisation_id}/${job.project_id}/${job.version_id}/`;
  if (!output.objectKey.startsWith(expectedPrefix)) {
    return validationError(context, {
      objectKey: ["Floor-plan proposal is outside this job's immutable report prefix"],
    });
  }
  if (safeFileName(output.fileName) !== output.fileName) {
    return validationError(context, { fileName: ["Output filename is not canonical"] });
  }
  const stored = await context.env.SPATIAL_ASSETS.head(output.objectKey);
  if (!stored) return validationError(context, { objectKey: ["Stored floor-plan report does not exist"] });
  if (stored.size !== parsed.data.evidence.outputBytes) {
    return validationError(context, {
      evidence: ["Reported output bytes do not match the stored floor-plan report"],
    });
  }
  if (!output.sha256) {
    return validationError(context, {
      output: ["Floor-plan proposal completion requires the processor's SHA-256"],
    });
  }
  const storedReport = await context.env.SPATIAL_ASSETS.get(output.objectKey);
  if (!storedReport) {
    return validationError(context, { objectKey: ["Stored floor-plan report disappeared"] });
  }
  const storedReportBytes = await storedReport.arrayBuffer();
  const storedReportHash = await sha256Hex(storedReportBytes);
  if (storedReportHash !== output.sha256) {
    return unprocessable(context, {
      output: ["Floor-plan proposal SHA-256 does not match the immutable R2 object"],
    });
  }
  let storedProposal: unknown;
  try {
    storedProposal = JSON.parse(new TextDecoder().decode(storedReportBytes));
  } catch {
    return unprocessable(context, {
      output: ["Stored floor-plan proposal is not valid JSON"],
    });
  }
  const parsedStoredProposal = floorplanProposalReportSchema.safeParse(storedProposal);
  if (
    !parsedStoredProposal.success ||
    JSON.stringify(parsedStoredProposal.data) !== JSON.stringify(parsed.data.report)
  ) {
    return unprocessable(context, {
      output: [
        "Stored floor-plan proposal does not match the report submitted for approval",
      ],
    });
  }
  const proposalJson = JSON.stringify(parsed.data.report);
  const proposalHash = await sha256Hex(proposalJson);
  const reportAssetId = crypto.randomUUID();
  const executionEvidence = {
    ...parsed.data.evidence,
    completedAt: new Date().toISOString(),
    floorplanExtractionId: job.extraction_id,
    proposalHash,
    humanReviewRequired: true,
  };
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO assets (
        id, organisation_id, project_id, version_id, kind, format, object_key,
        file_name, mime_type, size_bytes, etag, sha256, integrity_status
      ) VALUES (?, ?, ?, ?, 'report', 'json', ?, ?, ?, ?, ?, ?, 'verified')
    `).bind(
      reportAssetId,
      job.organisation_id,
      job.project_id,
      job.version_id,
      output.objectKey,
      output.fileName,
      output.mimeType,
      stored.size,
      stored.etag,
      storedReportHash,
    ),
    context.env.DB.prepare(`
      UPDATE processing_jobs
      SET state = 'SUCCEEDED', progress = 100, progress_message = ?,
        output_json = ?, processor_version = ?, compute_duration_ms = ?,
        active_human_duration_ms = ?, input_bytes = ?, output_bytes = ?,
        evidence_json = ?, completed_at = datetime('now'),
        lease_token_hash = NULL, leased_by = NULL, lease_expires_at = NULL,
        updated_at = datetime('now')
      WHERE id = ? AND lease_token_hash = ?
    `).bind(
      parsed.data.progressMessage,
      JSON.stringify({
        outputs: [{ id: reportAssetId, kind: "report", format: "json", sizeBytes: stored.size }],
        proposalHash,
      }),
      parsed.data.evidence.processorVersion,
      parsed.data.evidence.computeDurationMs,
      parsed.data.evidence.activeHumanDurationMs,
      parsed.data.evidence.inputBytes,
      parsed.data.evidence.outputBytes,
      JSON.stringify(executionEvidence),
      job.id,
      tokenHash,
    ),
    context.env.DB.prepare(`
      UPDATE floorplan_extraction_runs
      SET status = 'READY_FOR_REVIEW', proposal_json = ?, proposal_hash = ?,
        report_asset_id = ?, error_json = NULL, updated_at = datetime('now')
      WHERE id = ? AND job_id = ? AND status IN ('PROCESSING', 'QUEUED')
    `).bind(
      proposalJson,
      proposalHash,
      reportAssetId,
      job.extraction_id,
      job.id,
    ),
  ]);
  return context.json({
    job: { id: job.id, state: "SUCCEEDED" },
    extraction: {
      id: job.extraction_id,
      status: "READY_FOR_REVIEW",
      proposalHash,
      roomCount: parsed.data.report.rooms.length,
      wallCount: parsed.data.report.walls.length,
      openingCount: parsed.data.report.openings.length,
    },
    reportAssetId,
  });
});

app.post("/api/worker/jobs/:jobId/fail", async (context) => {
  if (!(await authenticateWorker(context))) return unauthorized(context, "Invalid worker credential");
  const parsed = workerJobFailureSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const tokenHash = await sha256Hex(`${parsed.data.leaseToken}:${context.env.SESSION_PEPPER}`);
  const job = await context.env.DB.prepare(`
    SELECT id, organisation_id, project_id, version_id, job_type, attempt_count, max_attempts
    FROM processing_jobs
    WHERE id = ? AND lease_token_hash = ? AND state IN ('LEASED', 'RUNNING')
      AND lease_expires_at > ?
  `).bind(context.req.param("jobId"), tokenHash, new Date().toISOString()).first<{
    id: string;
    organisation_id: string;
    project_id: string;
    version_id: string;
    job_type: string;
    attempt_count: number;
    max_attempts: number;
  }>();
  if (!job) return forbidden(context, "Lease is invalid");
  const retry = parsed.data.retryable && job.attempt_count < job.max_attempts;
  const terminalState = job.attempt_count >= job.max_attempts ? "DEAD_LETTER" : "FAILED";
  const error = JSON.stringify({
    code: parsed.data.code,
    message: parsed.data.message,
    failureClass: parsed.data.failureClass,
    details: parsed.data.details,
    failedAt: new Date().toISOString(),
  });
  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare(`
      UPDATE processing_jobs
      SET state = ?, error_json = ?, progress_message = ?, lease_token_hash = NULL,
        leased_by = NULL, lease_expires_at = NULL, updated_at = datetime('now'),
        completed_at = CASE WHEN ? = 'QUEUED' THEN NULL ELSE datetime('now') END
      WHERE id = ? AND lease_token_hash = ?
    `).bind(
      retry ? "QUEUED" : terminalState,
      error,
      retry ? "Retry queued after worker failure" : parsed.data.message,
      retry ? "QUEUED" : terminalState,
      job.id,
      tokenHash,
    ),
    context.env.DB.prepare(`
      UPDATE registered_scene_change_reports
      SET status = CASE WHEN ? = 'QUEUED' THEN 'QUEUED' ELSE ? END,
        error_json = ?, completed_at = CASE WHEN ? = 'QUEUED' THEN NULL ELSE datetime('now') END,
        updated_at = datetime('now')
      WHERE job_id = ?
    `).bind(
      retry ? "QUEUED" : terminalState,
      terminalState,
      error,
      retry ? "QUEUED" : terminalState,
      job.id,
    ),
    context.env.DB.prepare(`
      UPDATE semantic_extraction_runs
      SET status = CASE WHEN ? = 'QUEUED' THEN 'QUEUED' ELSE 'FAILED' END,
        updated_at = datetime('now')
      WHERE job_id = ?
    `).bind(
      retry ? "QUEUED" : terminalState,
      job.id,
    ),
    context.env.DB.prepare(`
      UPDATE floorplan_extraction_runs
      SET status = CASE WHEN ? = 'QUEUED' THEN 'QUEUED' ELSE 'FAILED' END,
        error_json = ?, updated_at = datetime('now')
      WHERE job_id = ?
    `).bind(
      retry ? "QUEUED" : terminalState,
      error,
      job.id,
    ),
  ];
  if (
    !retry &&
    !["registered-scene-change-v1", "semantic.extract-v1", "floorplan.extract-v1"].includes(job.job_type)
  ) {
    statements.push(
      context.env.DB.prepare(
        "UPDATE scene_versions SET status = 'PROCESSING_FAILED', updated_at = datetime('now') WHERE id = ?",
      ).bind(job.version_id),
      context.env.DB.prepare(
        "UPDATE projects SET status = 'PROCESSING_FAILED', updated_at = datetime('now') WHERE id = ? AND organisation_id = ?",
      ).bind(job.project_id, job.organisation_id),
    );
  }
  await context.env.DB.batch(statements);
  return context.json({ job: { id: job.id, state: retry ? "QUEUED" : terminalState, retryQueued: retry } });
});

app.post("/api/versions/:versionId/approve", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = qaDecisionSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const version = await context.env.DB.prepare(`
    SELECT sv.id, sv.project_id, sv.status, sv.manifest_json
    FROM scene_versions sv JOIN projects p ON p.id = sv.project_id
    WHERE sv.id = ? AND p.organisation_id = ?
  `).bind(context.req.param("versionId"), auth.organisationId).first<{
    id: string;
    project_id: string;
    status: string;
    manifest_json: string | null;
  }>();
  if (!version) return notFound(context, "Version not found");
  if (version.status === "APPROVED" || version.status === "PUBLISHED") {
    const prior = parseStoredObject(version.manifest_json ?? "{}");
    if (readStringProperty(prior, "webAssetId") === parsed.data.webAssetId) {
      return context.json({
        version: { id: version.id, status: version.status },
        idempotent: true,
      });
    }
  }
  if (version.status !== "QA_REQUIRED") return validationError(context, { version: ["Version is not awaiting QA"] });
  const webAsset = await context.env.DB.prepare(
    "SELECT * FROM assets WHERE id = ? AND version_id = ? AND organisation_id = ?",
  ).bind(parsed.data.webAssetId, version.id, auth.organisationId).first<AssetRow>();
  if (!webAsset) return validationError(context, { webAssetId: ["Asset does not belong to this version"] });
  if (!allowedWebFormats.has(webAsset.format)) {
    return validationError(context, { webAssetId: ["Publishable Spark assets must be RAD, SPZ, or SOG"] });
  }
  if (webAsset.integrity_status !== "verified") return validationError(context, { webAssetId: ["Asset integrity has not been verified"] });
  const latestPrivacyScan = await context.env.DB.prepare(`
    SELECT id, status, input_count FROM privacy_scans
    WHERE version_id = ? AND project_id = ? AND organisation_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).bind(version.id, version.project_id, auth.organisationId)
    .first<{ id: string; status: string; input_count: number }>();
  if (!latestPrivacyScan) {
    return conflict(context, "A completed automated privacy scan is required before privacy approval");
  }
  if (latestPrivacyScan.status !== "COMPLETED") {
    return conflict(
      context,
      `The latest automated privacy scan is ${latestPrivacyScan.status.toLowerCase()}; complete or retry it before privacy approval`,
    );
  }
  if (latestPrivacyScan.input_count < 1) {
    return conflict(context, "The completed privacy scan has no verified image evidence");
  }
  const privacyBlockers = await context.env.DB.batch([
    context.env.DB.prepare(`
      SELECT COUNT(*) AS count FROM privacy_candidates
      WHERE scan_id = ? AND status IN ('pending', 'confirmed')
    `).bind(latestPrivacyScan.id),
    context.env.DB.prepare(`
      SELECT COUNT(*) AS count FROM privacy_regions
      WHERE version_id = ? AND project_id = ? AND organisation_id = ?
        AND status IN ('pending', 'approved')
    `).bind(version.id, version.project_id, auth.organisationId),
  ]);
  const unresolvedCandidates = scalarCount(requiredBatchResult(privacyBlockers, 0));
  const unresolvedRegions = scalarCount(requiredBatchResult(privacyBlockers, 1));
  if (unresolvedCandidates > 0 || unresolvedRegions > 0) {
    return conflict(
      context,
      `Privacy review has ${unresolvedCandidates} unresolved automated candidate(s) and ${unresolvedRegions} unresolved spatial region(s)`,
    );
  }
  const report = {
    visualGrade: parsed.data.visualGrade,
    privacyStatus: parsed.data.privacyStatus,
    measurementGrade: parsed.data.measurementGrade,
    notes: parsed.data.notes ?? null,
    webAssetId: webAsset.id,
    posterAssetId: parsed.data.posterAssetId ?? null,
  };
  const reportId = crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO qa_reports (id, organisation_id, project_id, version_id, status, report_json, reviewed_by, reviewed_at)
      VALUES (?, ?, ?, ?, 'approved', ?, ?, datetime('now'))
    `).bind(reportId, auth.organisationId, version.project_id, version.id, JSON.stringify(report), auth.userId),
    context.env.DB.prepare("UPDATE scene_versions SET status = 'APPROVED', manifest_json = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(report), version.id),
    context.env.DB.prepare("UPDATE projects SET status = 'APPROVED', updated_at = datetime('now') WHERE id = ? AND organisation_id = ?").bind(version.project_id, auth.organisationId),
  ]);
  await audit(context, auth, "qa.approve", "scene_version", version.id, report);
  return context.json({ version: { id: version.id, status: "APPROVED" }, reportId });
});

app.post("/api/projects/:projectId/releases", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const parsed = releaseInputSchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const project = await scopedProject(context.env.DB, auth.organisationId, context.req.param("projectId"));
  if (!project) return notFound(context, "Project not found");
  if (parsed.data.clientOperationId) {
    const existing = await context.env.DB.prepare(`
      SELECT r.id, r.project_id, r.access_policy, r.published_at, rc.slug
      FROM releases r
      LEFT JOIN release_channels rc ON rc.active_release_id = r.id
      WHERE r.organisation_id = ? AND r.client_operation_id = ?
    `).bind(auth.organisationId, parsed.data.clientOperationId).first<{
      id: string;
      project_id: string;
      access_policy: string;
      published_at: string;
      slug: string | null;
    }>();
    if (existing) {
      if (
        existing.project_id !== project.id ||
        existing.access_policy !== parsed.data.accessPolicy ||
        existing.slug !== parsed.data.slug
      ) {
        return context.json({ error: "Operation ID was already used for a different release request" }, 409);
      }
      const accessToken = existing.access_policy === "token"
        ? await releaseAccessToken(parsed.data.clientOperationId, context.env.SESSION_PEPPER)
        : null;
      return context.json({
        release: {
          id: existing.id,
          slug: existing.slug,
          url: `${new URL(context.req.url).origin}/s/${existing.slug}`,
          accessPolicy: existing.access_policy,
          accessToken,
          publishedAt: existing.published_at,
        },
        idempotent: true,
      });
    }
  }
  const approved = await context.env.DB.prepare(`
    SELECT sv.id, sv.manifest_json
    FROM scene_versions sv
    WHERE sv.project_id = ? AND sv.status IN ('APPROVED', 'PUBLISHED')
    ORDER BY sv.version_number DESC LIMIT 1
  `).bind(project.id).first<{ id: string; manifest_json: string | null }>();
  if (!approved?.manifest_json) return validationError(context, { project: ["Project has no approved scene version"] });
  const approval = parseStoredObject(approved.manifest_json);
  const webAssetId = readStringProperty(approval, "webAssetId");
  let posterAssetId = readNullableStringProperty(approval, "posterAssetId");
  if (!webAssetId) return validationError(context, { project: ["Approved version has no web asset"] });
  if (!posterAssetId) {
    const generatedPoster = await context.env.DB.prepare(`
      SELECT id FROM assets
      WHERE organisation_id = ? AND project_id = ? AND version_id = ?
        AND kind = 'poster' AND integrity_status = 'verified'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).bind(auth.organisationId, project.id, approved.id).first<{ id: string }>();
    posterAssetId = generatedPoster?.id ?? null;
  }
  if (parsed.data.viewerConfig.sourceToWorld) {
    const evidence = await context.env.DB.prepare(`
      SELECT id, status, review_decision, parameters_json
      FROM semantic_extraction_runs
      WHERE id = ? AND organisation_id = ? AND project_id = ? AND version_id = ?
    `).bind(
      parsed.data.sourceToWorldEvidenceId!,
      auth.organisationId,
      project.id,
      approved.id,
    ).first<{
      id: string;
      status: string;
      review_decision: string | null;
      parameters_json: string;
    }>();
    if (
      !evidence ||
      evidence.status !== "REVIEWED" ||
      evidence.review_decision !== "accept_selected"
    ) {
      return conflict(
        context,
        "The source-to-world transform must come from an accepted semantic extraction on this exact scene version",
      );
    }
    const evidenceTransform = canonicalSourceToWorldTransform(Reflect.get(
      parseStoredObject(evidence.parameters_json) as object,
      "sourceToWorld",
    ));
    const releaseTransform = canonicalSourceToWorldTransform(
      parsed.data.viewerConfig.sourceToWorld,
    );
    if (
      JSON.stringify(evidenceTransform) !== JSON.stringify(releaseTransform)
    ) {
      return unprocessable(context, {
        sourceToWorldEvidenceId: [
          "The release transform differs from its reviewed semantic extraction evidence",
        ],
      });
    }
  }
  const spatialSnapshot = await captureSpatialSnapshot(
    context.env.DB,
    auth.organisationId,
    project.id,
    approved.id,
  );
  const snapshotProfile = Reflect.get(spatialSnapshot, "navigationProfile");
  const navigationWorldUnit = parseWorldUnit(
    snapshotProfile && typeof snapshotProfile === "object"
      ? Reflect.get(snapshotProfile, "worldUnit")
      : undefined,
  );
  const releaseWorldUnit = parseWorldUnit(
    parsed.data.viewerConfig.sourceToWorld?.worldUnit,
  );
  if (navigationWorldUnit !== releaseWorldUnit) {
    return conflict(
      context,
      "The navigation profile world unit must match the reviewed source-to-world transform",
    );
  }
  const snapshotArtifacts = [
    ...((Reflect.get(spatialSnapshot, "entities") as unknown[]) ?? []),
    ...((Reflect.get(spatialSnapshot, "navigationObstacles") as unknown[]) ?? []),
  ];
  if (snapshotArtifacts.some((artifact) =>
    artifact && typeof artifact === "object" &&
    parseWorldUnit(Reflect.get(artifact, "world_unit")) !== navigationWorldUnit
  )) {
    return conflict(
      context,
      "Authored geometry unit provenance must match the navigation profile before publication",
    );
  }
  if (
    navigationWorldUnit === "scene_units" &&
    parsed.data.viewerConfig.measurementDisclaimer !== PROVISIONAL_MEASUREMENT_DISCLAIMER
  ) {
    return conflict(
      context,
      "Provisional releases must use the platform-authored non-measurement warning",
    );
  }
  const releaseId = crypto.randomUUID();
  const channelId = crypto.randomUUID();
  const existingChannel = await context.env.DB.prepare(
    "SELECT organisation_id, project_id FROM release_channels WHERE slug = ?",
  ).bind(parsed.data.slug).first<{ organisation_id: string; project_id: string }>();
  if (existingChannel && (
    existingChannel.organisation_id !== auth.organisationId ||
    existingChannel.project_id !== project.id
  )) {
    return context.json({ error: "Release slug is already assigned to another project" }, 409);
  }
  const rawAccessToken = parsed.data.accessPolicy === "token"
    ? parsed.data.clientOperationId
      ? await releaseAccessToken(parsed.data.clientOperationId, context.env.SESSION_PEPPER)
      : secureToken()
    : null;
  const accessTokenHash = rawAccessToken ? await sha256Hex(`${rawAccessToken}:${context.env.SESSION_PEPPER}`) : null;
  const publishedAt = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO releases
        (id, organisation_id, project_id, version_id, web_asset_id, poster_asset_id,
          access_policy, access_token_hash, viewer_config_json, spatial_snapshot_json,
          published_at, expires_at, created_by, client_operation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      releaseId,
      auth.organisationId,
      project.id,
      approved.id,
      webAssetId,
      posterAssetId,
      parsed.data.accessPolicy,
      accessTokenHash,
      JSON.stringify(parsed.data.viewerConfig),
      JSON.stringify(spatialSnapshot),
      publishedAt,
      parsed.data.expiresAt ?? null,
      auth.userId,
      parsed.data.clientOperationId ?? null,
    ),
    context.env.DB.prepare(`
      INSERT INTO release_channels (id, organisation_id, project_id, slug, active_release_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        active_release_id = excluded.active_release_id,
        updated_at = datetime('now')
      WHERE release_channels.organisation_id = excluded.organisation_id
        AND release_channels.project_id = excluded.project_id
    `).bind(channelId, auth.organisationId, project.id, parsed.data.slug, releaseId),
    context.env.DB.prepare("UPDATE scene_versions SET status = 'PUBLISHED', updated_at = datetime('now') WHERE id = ?").bind(approved.id),
    context.env.DB.prepare("UPDATE projects SET status = 'PUBLISHED', updated_at = datetime('now') WHERE id = ? AND organisation_id = ?").bind(project.id, auth.organisationId),
  ]);
  await audit(context, auth, "release.publish", "release", releaseId, {
    slug: parsed.data.slug,
    accessPolicy: parsed.data.accessPolicy,
    sourceToWorldEvidenceId: parsed.data.sourceToWorldEvidenceId ?? null,
  });
  return context.json({
    release: {
      id: releaseId,
      slug: parsed.data.slug,
      url: `${new URL(context.req.url).origin}/s/${parsed.data.slug}`,
      accessPolicy: parsed.data.accessPolicy,
      accessToken: rawAccessToken,
      publishedAt,
    },
  }, 201);
});

app.post("/api/release-channels/:slug/rollback", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const input = await readJson(context);
  const releaseId = readStringProperty(input, "releaseId");
  if (!releaseId) return validationError(context, { releaseId: ["releaseId is required"] });
  const release = await context.env.DB.prepare(`
    SELECT r.id, r.project_id FROM releases r
    JOIN release_channels rc ON rc.project_id = r.project_id
    WHERE r.id = ? AND rc.slug = ? AND r.organisation_id = ? AND r.revoked_at IS NULL
  `).bind(releaseId, context.req.param("slug"), auth.organisationId).first<{ id: string; project_id: string }>();
  if (!release) return notFound(context, "Eligible release not found");
  await context.env.DB.batch([
    context.env.DB.prepare(
      "UPDATE release_channels SET active_release_id = ?, updated_at = datetime('now') WHERE slug = ? AND organisation_id = ?",
    ).bind(release.id, context.req.param("slug"), auth.organisationId),
    context.env.DB.prepare(
      "UPDATE projects SET status = 'PUBLISHED', updated_at = datetime('now') WHERE id = ? AND organisation_id = ?",
    ).bind(release.project_id, auth.organisationId),
  ]);
  await audit(context, auth, "release.rollback", "release_channel", context.req.param("slug"), { releaseId });
  return context.json({ slug: context.req.param("slug"), activeReleaseId: release.id });
});

app.delete("/api/release-channels/:slug", async (context) => {
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const channel = await context.env.DB.prepare(
    "SELECT id, project_id, active_release_id FROM release_channels WHERE slug = ? AND organisation_id = ?",
  ).bind(context.req.param("slug"), auth.organisationId).first<{
    id: string;
    project_id: string;
    active_release_id: string | null;
  }>();
  if (!channel) return notFound(context, "Release channel not found");
  await context.env.DB.batch([
    context.env.DB.prepare("UPDATE releases SET revoked_at = datetime('now') WHERE id = ? AND organisation_id = ?").bind(channel.active_release_id, auth.organisationId),
    context.env.DB.prepare("UPDATE release_channels SET active_release_id = NULL, updated_at = datetime('now') WHERE id = ?").bind(channel.id),
    context.env.DB.prepare(
      "UPDATE projects SET status = 'REVOKED', updated_at = datetime('now') WHERE id = ? AND organisation_id = ?",
    ).bind(channel.project_id, auth.organisationId),
  ]);
  await audit(context, auth, "release.revoke", "release_channel", channel.id);
  return context.body(null, 204);
});

app.get("/api/releases/:slug/manifest", async (context) => {
  const release = await activeRelease(context.env.DB, context.req.param("slug"));
  if (!release) return notFound(context, "Published scene not found");
  const requestHostname = new URL(context.req.url).hostname;
  if (!isPlatformHostname(context.env, requestHostname)) {
    const domain = await customDomainForHost(context.env.DB, requestHostname);
    if (!domain || !customDomainReady(domain) || domain.project_id !== release.project_id) {
      return notFound(context, "Published scene not found for this hostname");
    }
  }
  if (release.revoked_at || (release.expires_at && Date.parse(release.expires_at) <= Date.now())) return context.json({ error: "This scene is no longer available" }, 410);
  if (!(await canViewRelease(context, release))) return unauthorized(context, "This scene requires access");
  const webAsset = await context.env.DB.prepare(
    "SELECT * FROM assets WHERE id = ? AND organisation_id = ? AND deleted_at IS NULL",
  ).bind(release.web_asset_id, release.organisation_id).first<AssetRow>();
  const posterAsset = release.poster_asset_id
    ? await context.env.DB.prepare(
        "SELECT * FROM assets WHERE id = ? AND organisation_id = ? AND deleted_at IS NULL",
      ).bind(release.poster_asset_id, release.organisation_id).first<AssetRow>()
    : null;
  if (!webAsset) return context.json({ error: "Published scene asset is unavailable" }, 503);
  const tokenTtl = positiveInteger(context.env.SCENE_SESSION_TTL_SECONDS, 1800);
  const sceneToken = await signSceneToken({
    releaseId: release.id,
    expiresAt: Math.floor(Date.now() / 1000) + tokenTtl,
  }, context.env.SESSION_PEPPER);
  const viewerConfig = parseStoredObject(release.viewer_config_json);
  const theme = await context.env.DB.prepare(`
    SELECT brand_name, logo_url, accent_color, surface_color
    FROM project_themes WHERE project_id = ? AND organisation_id = ?
  `).bind(release.project_id, release.organisation_id).first<{
    brand_name: string | null;
    logo_url: string | null;
    accent_color: string;
    surface_color: string;
  }>();
  const spatial = await context.env.DB.batch([
    context.env.DB.prepare(`
      SELECT id, parent_id, kind, label, description, position_json, geometry_json,
        metadata_json, sort_order, world_unit
      FROM scene_entities WHERE project_id = ? AND version_id = ? AND status = 'active'
      ORDER BY kind, sort_order, label
    `).bind(release.project_id, release.version_id),
    context.env.DB.prepare(`
      SELECT id, label, description, accessibility, estimated_seconds
      FROM scene_routes WHERE project_id = ? AND version_id = ? AND status = 'active'
      ORDER BY created_at
    `).bind(release.project_id, release.version_id),
    context.env.DB.prepare(`
      SELECT rs.route_id, rs.entity_id, rs.sequence_number, rs.camera_pose_json, rs.narration
      FROM scene_route_stops rs JOIN scene_routes r ON r.id = rs.route_id
      WHERE r.project_id = ? AND r.version_id = ? AND r.status = 'active'
      ORDER BY rs.route_id, rs.sequence_number
    `).bind(release.project_id, release.version_id),
    context.env.DB.prepare(`
      SELECT adaptive_quality, mobile_lite_budget, mobile_standard_budget,
        desktop_standard_budget, desktop_high_budget, max_initial_bytes
      FROM project_delivery_policies WHERE project_id = ? AND organisation_id = ?
    `).bind(release.project_id, release.organisation_id),
    context.env.DB.prepare(`
      SELECT id, label, bounds_json, metadata_json, world_unit
      FROM scene_navigation_obstacles
      WHERE project_id = ? AND version_id = ? AND organisation_id = ? AND status = 'active'
      ORDER BY label, created_at
    `).bind(release.project_id, release.version_id, release.organisation_id),
    context.env.DB.prepare(`
      SELECT world_unit, agent_radius, agent_height, eye_height, max_step_metres
      FROM scene_navigation_profiles
      WHERE project_id = ? AND version_id = ? AND organisation_id = ?
    `).bind(release.project_id, release.version_id, release.organisation_id),
  ]);
  const spatialEntities = requiredBatchResult(spatial, 0).results;
  const navigationObstacles = requiredBatchResult(spatial, 4).results;
  const navigationProfile = requiredBatchResult(spatial, 5).results[0];
  const spatialRuntime = buildSpatialRuntime(
    spatialEntities,
    navigationObstacles,
    navigationProfile,
  );
  const liveSpatial = {
    schemaVersion: "spatial-runtime-v5",
    entities: spatialEntities,
    routes: requiredBatchResult(spatial, 1).results,
    routeStops: requiredBatchResult(spatial, 2).results,
    navigationObstacles,
    collisionProxy: spatialRuntime.collisionProxy,
    navigationMesh: spatialRuntime.navigationMesh,
    obstacleProxy: spatialRuntime.obstacleProxy,
    navigationProfile: spatialRuntime.navigationProfile,
  };
  const publishedSpatial = release.spatial_snapshot_json
    ? parseSpatialSnapshot(release.spatial_snapshot_json) ?? liveSpatial
    : liveSpatial;
  return context.json({
    schemaVersion: "1.0.0",
    release: {
      id: release.id,
      slug: release.slug,
      publishedAt: release.published_at,
      expiresAt: release.expires_at,
      accessPolicy: release.access_policy,
    },
    project: {
      id: release.project_id,
      versionId: release.version_id,
      name: release.project_name,
      captureAdapter: release.capture_adapter,
      provenance: parseStoredObject(release.source_provenance_json),
    },
    scene: {
      format: webAsset.format,
      contentUrl: `/asset/${release.id}/${webAsset.id}/${encodeURIComponent(webAsset.file_name)}?token=${encodeURIComponent(sceneToken)}`,
      posterUrl: posterAsset
        ? `/asset/${release.id}/${posterAsset.id}/${encodeURIComponent(posterAsset.file_name)}?token=${encodeURIComponent(sceneToken)}`
        : null,
      sizeBytes: webAsset.size_bytes,
      etag: webAsset.etag,
    },
    viewer: viewerConfig,
    theme: {
      brandName: theme?.brand_name ?? null,
      logoUrl: theme?.logo_url ?? null,
      accentColor: theme?.accent_color ?? "#d6ff4b",
      surfaceColor: theme?.surface_color ?? "#0d0f0e",
    },
    spatial: publishedSpatial,
    deliveryPolicy: requiredBatchResult(spatial, 3).results[0] ?? {
      adaptive_quality: 1,
      mobile_lite_budget: 0.75,
      mobile_standard_budget: 1.25,
      desktop_standard_budget: 2,
      desktop_high_budget: 4,
      max_initial_bytes: 15_728_640,
    },
    integrity: {
      assetSha256: webAsset.sha256,
      sessionExpiresAt: new Date((Math.floor(Date.now() / 1000) + tokenTtl) * 1000).toISOString(),
    },
  });
});

app.get("/asset/:releaseId/:assetId/:fileName", async (context) => {
  const token = context.req.query("token");
  if (!token) return unauthorized(context, "Missing scene token");
  const payload = await verifySceneToken(token, context.env.SESSION_PEPPER);
  if (!payload || payload.releaseId !== context.req.param("releaseId")) return unauthorized(context, "Invalid or expired scene token");
  const asset = await context.env.DB.prepare(`
    SELECT a.* FROM assets a
    JOIN releases r ON (r.web_asset_id = a.id OR r.poster_asset_id = a.id)
    WHERE r.id = ? AND a.id = ? AND r.revoked_at IS NULL AND a.deleted_at IS NULL
      AND (r.expires_at IS NULL OR r.expires_at > ?)
  `).bind(payload.releaseId, context.req.param("assetId"), new Date().toISOString()).first<AssetRow>();
  if (!asset) return notFound(context, "Scene asset not found");
  if (context.req.param("fileName") !== asset.file_name) return notFound(context, "Scene asset not found");
  return serveR2Object(context, asset.object_key);
});

app.get("/comparison-asset/:projectId/:versionId/:assetId/:fileName", async (context) => {
  const token = context.req.query("token");
  if (!token) return unauthorized(context, "Missing comparison token");
  const payload = await verifySceneToken(token, context.env.SESSION_PEPPER);
  const expectedScope = comparisonAssetTokenScope(
    context.req.param("projectId"),
    context.req.param("versionId"),
    context.req.param("assetId"),
  );
  if (!payload || payload.releaseId !== expectedScope) {
    return unauthorized(context, "Invalid or expired comparison token");
  }
  const asset = await context.env.DB.prepare(`
    SELECT * FROM assets
    WHERE id = ? AND project_id = ? AND version_id = ? AND kind = 'web'
      AND integrity_status = 'verified' AND deleted_at IS NULL
  `).bind(
    context.req.param("assetId"),
    context.req.param("projectId"),
    context.req.param("versionId"),
  ).first<AssetRow>();
  if (!asset || !allowedWebFormats.has(asset.format)) return notFound(context, "Comparison asset not found");
  if (context.req.param("fileName") !== asset.file_name) return notFound(context, "Comparison asset not found");
  return serveR2Object(context, asset.object_key);
});

async function serveR2Object(
  context: Context<AppEnvironment>,
  objectKey: string,
): Promise<Response> {
  const metadata = await context.env.SPATIAL_ASSETS.head(objectKey);
  if (!metadata) return notFound(context, "Stored object not found");
  const range = parseRangeHeader(context.req.header("Range"), metadata.size);
  if (context.req.header("Range") && !range) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${metadata.size}` } });
  }
  const object = await context.env.SPATIAL_ASSETS.get(objectKey, {
    onlyIf: context.req.raw.headers,
    ...(range ? { range } : {}),
  });
  if (!object) return notFound(context, "Stored object not found");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "private, max-age=1800, immutable");
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  if (range) {
    const offset = range && "offset" in range && typeof range.offset === "number"
      ? range.offset
      : metadata.size - (range && "suffix" in range && typeof range.suffix === "number" ? range.suffix : object.size);
    const length = range && "length" in range && typeof range.length === "number" ? range.length : object.size;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${metadata.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}

app.post("/api/telemetry", async (context) => {
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  const clientAddress = context.req.header("CF-Connecting-IP") ?? "unknown";
  if (!(await allowRate(context.env.DB, "telemetry", clientAddress, 120, 60))) return tooManyRequests(context);
  const parsed = telemetrySchema.safeParse(await readJson(context));
  if (!parsed.success) return validationError(context, parsed.error.flatten());
  const releaseExists = await context.env.DB.prepare("SELECT id FROM releases WHERE id = ?").bind(parsed.data.releaseId).first<{ id: string }>();
  if (!releaseExists) return notFound(context, "Release not found");
  await context.env.DB.prepare(`
    INSERT INTO viewer_events
      (id, release_id, event_type, session_id, device_profile, metric_value, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    parsed.data.releaseId,
    parsed.data.eventType,
    parsed.data.sessionId ?? null,
    parsed.data.deviceProfile ?? null,
    parsed.data.metricValue ?? null,
    JSON.stringify(parsed.data.metadata),
  ).run();
  return context.body(null, 204);
});

app.get("/", async (context) => {
  const hostname = new URL(context.req.url).hostname;
  if (isPlatformHostname(context.env, hostname)) {
    return serveStaticEntry(context, "/index.html");
  }
  const domain = await customDomainForHost(context.env.DB, hostname);
  if (!domain) return notFound(context, "Custom hostname is not registered");
  if (!customDomainReady(domain)) {
    return customDomainUnavailable(
      context,
      "This custom hostname is still completing routing and certificate activation.",
      503,
    );
  }
  if (!domain.active_release_slug) {
    return customDomainUnavailable(
      context,
      "This custom hostname is active, but its project has no published release.",
      404,
    );
  }
  return context.redirect(`/s/${encodeURIComponent(domain.active_release_slug)}`, 302);
});
app.get("/s/:slug", async (context) => {
  const hostname = new URL(context.req.url).hostname;
  if (!isPlatformHostname(context.env, hostname)) {
    const domain = await customDomainForHost(context.env.DB, hostname);
    if (
      !domain ||
      !customDomainReady(domain) ||
      domain.active_release_slug !== context.req.param("slug")
    ) {
      return notFound(context, "Published scene not found for this hostname");
    }
  }
  return serveStaticEntry(context, "/index.html");
});
app.get("/review/:slug", async (context) => serveStaticEntry(context, "/index.html"));

async function authenticate(context: Context<AppEnvironment>): Promise<AuthSessionRow | null> {
  return authenticateRequest(context.req.raw, context.env);
}

async function requireAuth(context: Context<AppEnvironment>): Promise<AuthContext | Response> {
  const auth = await authenticate(context);
  return auth ?? unauthorized(context, "Sign in required");
}

async function requireOperator(context: Context<AppEnvironment>): Promise<AuthContext | Response> {
  const auth = await authenticate(context);
  if (!auth) return unauthorized(context, "Sign in required");
  if (!["platform_admin", "production_operator"].includes(auth.role)) return forbidden(context, "Operator role required");
  return auth;
}

async function requireAdministrator(context: Context<AppEnvironment>): Promise<AuthContext | Response> {
  const auth = await authenticate(context);
  if (!auth) return unauthorized(context, "Sign in required");
  if (auth.role !== "platform_admin") return forbidden(context, "Platform administrator role required");
  return auth;
}

async function requireCaptureAgent(
  context: Context<AppEnvironment>,
): Promise<CaptureAgentPrincipal | Response> {
  const authorization = context.req.header("Authorization");
  const match = authorization?.match(
    /^Bearer (spcap_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{32,128})$/i,
  );
  if (!match) return unauthorized(context, "Capture-agent credential required");
  const token = match[1]!;
  const credentialId = match[2]!;
  const credential = await context.env.DB.prepare(`
    SELECT * FROM capture_agent_credentials
    WHERE id = ? AND revoked_at IS NULL AND expires_at > ?
  `).bind(
    credentialId,
    new Date().toISOString(),
  ).first<CaptureAgentCredentialRow>();
  if (
    !credential ||
    !await timingSafeStringEqual(
      credential.token_hash,
      await captureAgentTokenHash(token, context.env.SESSION_PEPPER),
    )
  ) {
    return unauthorized(context, "Capture-agent credential is invalid or expired");
  }
  if (!await allowRate(
    context.env.DB,
    "capture-agent-request",
    credential.id,
    1_000,
    60,
  )) {
    return context.json({
      error: "Capture-agent request rate exceeded; retry after the current minute window",
      retryAfterSeconds: 60,
    }, 429);
  }
  await context.env.DB.prepare(`
    UPDATE capture_agent_credentials
    SET last_used_at = datetime('now'), last_used_ip = ?
    WHERE id = ? AND token_generation = ? AND revoked_at IS NULL
  `).bind(
    context.req.header("CF-Connecting-IP") ?? null,
    credential.id,
    credential.token_generation,
  ).run();
  return {
    kind: "capture_agent",
    credentialId: credential.id,
    credentialName: credential.name,
    generation: credential.token_generation,
    organisationId: credential.organisation_id,
    createdByUserId: credential.created_by,
    projectIds: captureAgentProjectIds(credential),
    expiresAt: credential.expires_at,
  };
}

async function requireUploadPrincipal(
  context: Context<AppEnvironment>,
): Promise<UploadPrincipal | Response> {
  if (context.req.header("Authorization")?.startsWith("Bearer spcap_")) {
    return requireCaptureAgent(context);
  }
  const auth = await requireOperator(context);
  if (auth instanceof Response) return auth;
  if (!isSameOrigin(context)) return forbidden(context, "Cross-origin request rejected");
  return { kind: "human", auth };
}

function uploadPrincipalOrganisationId(principal: UploadPrincipal): string {
  return principal.kind === "human"
    ? principal.auth.organisationId
    : principal.organisationId;
}

function uploadPrincipalUserId(principal: UploadPrincipal): string {
  return principal.kind === "human"
    ? principal.auth.userId
    : principal.createdByUserId;
}

function uploadPrincipalCredentialId(principal: UploadPrincipal): string | null {
  return principal.kind === "capture_agent" ? principal.credentialId : null;
}

function uploadPrincipalCanAccessProject(
  principal: UploadPrincipal,
  projectId: string,
): boolean {
  return principal.kind === "human" || principal.projectIds.includes(projectId);
}

async function requireReviewProject(
  context: Context<AppEnvironment>,
  projectId: string,
  write = false,
): Promise<{ auth: AuthContext; project: ProjectRow; accessRole: string } | Response> {
  const auth = await requireAuth(context);
  if (auth instanceof Response) return auth;
  const project = await scopedProject(context.env.DB, auth.organisationId, projectId);
  if (!project) return notFound(context, "Project not found");
  if (["platform_admin", "production_operator"].includes(auth.role)) {
    return { auth, project, accessRole: "production_operator" };
  }
  const access = await context.env.DB.prepare(`
    SELECT role FROM project_access
    WHERE organisation_id = ? AND project_id = ? AND user_id = ? AND revoked_at IS NULL
  `).bind(auth.organisationId, project.id, auth.userId).first<{ role: string }>();
  if (!access) return notFound(context, "Project not found");
  if (write && access.role !== "customer_reviewer") {
    return forbidden(context, "Reviewer role required");
  }
  return { auth, project, accessRole: access.role };
}

async function canReadProject(
  database: D1Database,
  auth: AuthContext,
  projectId: string,
): Promise<boolean> {
  if (["platform_admin", "production_operator"].includes(auth.role)) return true;
  return Boolean(await database.prepare(`
    SELECT 1 AS allowed FROM project_access
    WHERE organisation_id = ? AND project_id = ? AND user_id = ? AND revoked_at IS NULL
  `).bind(auth.organisationId, projectId, auth.userId).first<{ allowed: number }>());
}

async function authenticateWorker(context: Context<AppEnvironment>): Promise<boolean> {
  const header = context.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) return false;
  return timingSafeStringEqual(header.slice(7), context.env.WORKER_API_TOKEN);
}

function dispatchProcessingJob(context: Context<AppEnvironment>, jobId: string): void {
  context.executionCtx.waitUntil(
    context.env.PROCESSING_DISPATCH_QUEUE.send({ jobId }).catch((error) => {
      console.error(JSON.stringify({
        event: "processing.dispatch_enqueue_failed",
        jobId,
        error: errorMessage(error),
      }));
    }),
  );
}

async function enqueueDispatchableProcessingJobs(env: Env): Promise<void> {
  const result = await env.DB.prepare(`
    SELECT id
    FROM processing_jobs
    WHERE (
      state = 'QUEUED'
      OR (state IN ('LEASED', 'RUNNING') AND lease_expires_at < ?)
    )
      AND attempt_count < max_attempts
    ORDER BY priority ASC, created_at ASC
    LIMIT 100
  `).bind(new Date().toISOString()).all<{ id: string }>();
  await Promise.all(result.results.map(async ({ id }) => {
    try {
      await env.PROCESSING_DISPATCH_QUEUE.send({ jobId: id });
    } catch (error) {
      console.error(JSON.stringify({
        event: "processing.dispatch_reconcile_failed",
        jobId: id,
        error: errorMessage(error),
      }));
    }
  }));
  console.log(JSON.stringify({
    event: "processing.dispatch_reconciled",
    jobs: result.results.length,
  }));
}

async function enqueueDispatchableProjectAssetCopies(env: Env): Promise<void> {
  const result = await env.DB.prepare(`
    SELECT i.id
    FROM project_asset_handoff_items i
    JOIN project_asset_handoffs h ON h.id = i.handoff_id
    WHERE h.status IN ('queued', 'copying')
      AND i.status = 'queued'
      AND i.attempt_count < 10
    ORDER BY h.started_at ASC, i.updated_at ASC
    LIMIT 50
  `).all<{ id: string }>();
  await Promise.all(result.results.map(async ({ id }) => {
    try {
      await env.PORTFOLIO_COPY_QUEUE.send({
        type: "project_asset_copy",
        itemId: id,
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: "project_asset_handoff.dispatch_reconcile_failed",
        itemId: id,
        error: errorMessage(error),
      }));
    }
  }));
  console.log(JSON.stringify({
    event: "project_asset_handoff.dispatch_reconciled",
    items: result.results.length,
  }));
}

async function requireWorkerLease(
  context: Context<AppEnvironment>,
  jobId: string,
): Promise<JobLeaseRow | Response> {
  const rawLeaseToken = context.req.header("X-Job-Lease");
  if (!rawLeaseToken) return unauthorized(context, "Missing job lease credential");
  const tokenHash = await sha256Hex(`${rawLeaseToken}:${context.env.SESSION_PEPPER}`);
  const job = await context.env.DB.prepare(`
    SELECT j.id, j.organisation_id, j.project_id, j.version_id, j.input_asset_id,
      j.job_type, j.processor_version, j.attempt_count, j.lease_expires_at,
      a.file_name AS input_file_name, a.format AS input_format,
      a.mime_type AS input_mime_type, a.size_bytes AS input_size_bytes,
      a.sha256 AS input_sha256, a.object_key AS input_object_key
    FROM processing_jobs j
    JOIN assets a ON a.id = j.input_asset_id AND a.organisation_id = j.organisation_id
    WHERE j.id = ? AND j.lease_token_hash = ? AND j.state IN ('LEASED', 'RUNNING')
      AND j.lease_expires_at > ?
  `).bind(jobId, tokenHash, new Date().toISOString()).first<JobLeaseRow>();
  return job ?? forbidden(context, "Lease is invalid or expired");
}

function outputFormat(kind: string, fileName: string): string | null {
  const separator = fileName.lastIndexOf(".");
  if (separator <= 0 || separator === fileName.length - 1) return null;
  const format = fileName.slice(separator + 1).toLowerCase();
  return workerOutputFormats.get(kind)?.has(format) ? format : null;
}

function canonicalOutputMimeType(kind: string, format: string, supplied?: string): string {
  const known = new Map<string, string>([
    ["rad", "application/octet-stream"],
    ["spz", "application/octet-stream"],
    ["sog", "application/octet-stream"],
    ["ply", "application/octet-stream"],
    ["e57", "application/octet-stream"],
    ["las", "application/octet-stream"],
    ["laz", "application/octet-stream"],
    ["glb", "model/gltf-binary"],
    ["bin", "application/octet-stream"],
    ["webp", "image/webp"],
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["json", "application/json"],
  ]);
  const expected = known.get(format) ?? "application/octet-stream";
  void kind;
  void supplied;
  return expected;
}

function workerOutputObjectKey(
  lease: JobLeaseRow,
  kind: string,
  outputId: string,
  fileName: string,
): string {
  const root = kind === "master" || kind === "pointcloud"
    ? "masters-private"
    : kind === "report"
      ? "reports-private"
      : "delivery-private";
  return `${root}/${lease.organisation_id}/${lease.project_id}/${lease.version_id}/${lease.id}/${outputId}/${fileName}`;
}

async function workerOutputUpload(
  database: D1Database,
  lease: JobLeaseRow,
  outputId: string,
): Promise<JobOutputUploadRow | null> {
  return database.prepare(`
    SELECT * FROM job_output_uploads
    WHERE id = ? AND job_id = ? AND organisation_id = ? AND project_id = ? AND version_id = ?
  `).bind(
    outputId,
    lease.id,
    lease.organisation_id,
    lease.project_id,
    lease.version_id,
  ).first<JobOutputUploadRow>();
}

function workerOutputDescriptor(
  upload: JobOutputUploadRow,
  stored: { size: number; etag: string },
): Record<string, unknown> {
  return {
    kind: upload.kind,
    format: upload.format,
    objectKey: upload.object_key,
    fileName: upload.file_name,
    mimeType: upload.mime_type,
    sizeBytes: stored.size,
    etag: stored.etag,
    ...(upload.sha256 ? { sha256: upload.sha256 } : {}),
  };
}

async function applyProjectLifecycleAction(
  context: Context<AppEnvironment>,
  auth: AuthContext,
  projectId: string,
  action: "archive" | "restore",
): Promise<ProjectLifecycleOutcome> {
  const project = await scopedProject(context.env.DB, auth.organisationId, projectId);
  if (!project) return { project: null, outcome: "not_found", message: "Project not found" };

  if (action === "restore") {
    if (project.status !== "ARCHIVED") return { project, outcome: "unchanged" };
    const update = await context.env.DB.prepare(`
      UPDATE projects
      SET status = COALESCE(archived_from_status, 'DRAFT'), archived_from_status = NULL,
        updated_at = datetime('now')
      WHERE id = ? AND organisation_id = ? AND status = 'ARCHIVED'
    `).bind(project.id, auth.organisationId).run();
    const restored = await scopedProject(context.env.DB, auth.organisationId, project.id);
    if (!restored) return { project: null, outcome: "not_found", message: "Project not found" };
    if ((update.meta.changes ?? 0) !== 1) return { project: restored, outcome: "unchanged" };
    await audit(context, auth, "project.restore", "project", project.id, {
      restoredStatus: project.archived_from_status ?? "DRAFT",
    });
    return { project: restored, outcome: "changed" };
  }

  if (project.status === "ARCHIVED") return { project, outcome: "unchanged" };
  const blocker = await projectArchiveBlocker(context.env.DB, auth.organisationId, project.id);
  if (blocker) return { project, outcome: "blocked", message: blocker };

  const update = await context.env.DB.prepare(`
    UPDATE projects
    SET archived_from_status = status, status = 'ARCHIVED', updated_at = datetime('now')
    WHERE id = ? AND organisation_id = ? AND status != 'ARCHIVED'
      AND NOT EXISTS (
        SELECT 1 FROM release_channels
        WHERE project_id = ? AND organisation_id = ? AND active_release_id IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM processing_jobs
        WHERE project_id = ? AND organisation_id = ?
          AND state IN ('QUEUED', 'LEASED', 'RUNNING')
      )
      AND NOT EXISTS (
        SELECT 1 FROM upload_sessions
        WHERE project_id = ? AND organisation_id = ? AND status = 'OPEN'
      )
  `).bind(
    project.id,
    auth.organisationId,
    project.id,
    auth.organisationId,
    project.id,
    auth.organisationId,
    project.id,
    auth.organisationId,
  ).run();
  const archived = await scopedProject(context.env.DB, auth.organisationId, project.id);
  if (!archived) return { project: null, outcome: "not_found", message: "Project not found" };
  if ((update.meta.changes ?? 0) !== 1) {
    if (archived.status === "ARCHIVED") return { project: archived, outcome: "unchanged" };
    return {
      project: archived,
      outcome: "blocked",
      message: await projectArchiveBlocker(context.env.DB, auth.organisationId, project.id)
        ?? "The project changed while archival was running. Refresh and retry.",
    };
  }
  await audit(context, auth, "project.archive", "project", project.id, { fromStatus: project.status });
  return { project: archived, outcome: "changed" };
}

function publicProjectCustomFieldDefinition(
  field: ProjectCustomFieldDefinitionRow,
): Record<string, unknown> {
  return {
    id: field.id,
    key: field.key,
    label: field.label,
    description: field.description,
    type: field.field_type,
    required: field.required === 1,
    options: parseStringArray(field.options_json),
    active: field.active === 1,
    sortOrder: field.sort_order,
    createdAt: field.created_at,
    updatedAt: field.updated_at,
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function captureAgentProjectIds(credential: CaptureAgentCredentialRow): string[] {
  return parseStringArray(credential.project_ids_json);
}

function publicCaptureAgentCredential(
  credential: CaptureAgentCredentialRow,
): Record<string, unknown> {
  const status = credential.revoked_at
    ? "revoked"
    : Date.parse(credential.expires_at) <= Date.now()
      ? "expired"
      : "active";
  return {
    id: credential.id,
    name: credential.name,
    status,
    generation: credential.token_generation,
    projectIds: captureAgentProjectIds(credential),
    expiresAt: credential.expires_at,
    lastUsedAt: credential.last_used_at,
    lastUsedIp: credential.last_used_ip,
    rotatedAt: credential.rotated_at,
    revokedAt: credential.revoked_at,
    createdAt: credential.created_at,
    updatedAt: credential.updated_at,
  };
}

function publicCaptureAgentPrincipal(
  principal: CaptureAgentPrincipal,
): Record<string, unknown> {
  return {
    id: principal.credentialId,
    name: principal.credentialName,
    generation: principal.generation,
    expiresAt: principal.expiresAt,
  };
}

async function captureAgentCredential(
  database: D1Database,
  organisationId: string,
  credentialId: string,
): Promise<CaptureAgentCredentialRow | null> {
  return database.prepare(`
    SELECT * FROM capture_agent_credentials
    WHERE id = ? AND organisation_id = ?
  `).bind(credentialId, organisationId).first<CaptureAgentCredentialRow>();
}

async function captureAgentProjectAssignmentError(
  database: D1Database,
  organisationId: string,
  projectIds: string[],
): Promise<string | null> {
  if (!projectIds.length) return "Assign at least one project";
  const placeholders = projectIds.map(() => "?").join(", ");
  const existing = await database.prepare(`
    SELECT id FROM projects
    WHERE organisation_id = ? AND id IN (${placeholders})
  `).bind(organisationId, ...projectIds).all<{ id: string }>();
  const found = new Set(existing.results.map((project) => project.id));
  const missing = projectIds.filter((projectId) => !found.has(projectId));
  return missing.length
    ? "Every assigned project must belong to the current organisation"
    : null;
}

async function captureAgentToken(
  credentialId: string,
  generation: number,
  operationId: string,
  pepper: string,
): Promise<string> {
  const secret = await sha256Hex(
    `capture-agent-issue:${credentialId}:${generation}:${operationId}:${pepper}`,
  );
  return `spcap_${credentialId}.${secret}`;
}

async function captureAgentTokenHash(
  token: string,
  pepper: string,
): Promise<string> {
  return sha256Hex(`capture-agent-verify:${token}:${pepper}`);
}

function parseJsonValue(value: string): ProjectCustomFieldValue {
  const parsed: unknown = JSON.parse(value);
  if (
    parsed === null ||
    typeof parsed === "string" ||
    typeof parsed === "number" ||
    typeof parsed === "boolean"
  ) {
    return parsed;
  }
  throw new Error("Stored project custom-field value is not a supported primitive");
}

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

async function projectCustomFieldDefinitions(
  database: D1Database,
  organisationId: string,
  activeOnly: boolean,
): Promise<ProjectCustomFieldDefinitionRow[]> {
  const result = await database.prepare(`
    SELECT * FROM project_custom_field_definitions
    WHERE organisation_id = ? ${activeOnly ? "AND active = 1" : ""}
    ORDER BY sort_order, lower(label), key
  `).bind(organisationId).all<ProjectCustomFieldDefinitionRow>();
  return result.results;
}

async function projectCustomFieldValues(
  database: D1Database,
  organisationId: string,
  projectIds: string[],
): Promise<Map<string, Record<string, ProjectCustomFieldValue>>> {
  const values = new Map<string, Record<string, ProjectCustomFieldValue>>();
  if (projectIds.length === 0) return values;
  const uniqueProjectIds = [...new Set(projectIds)];
  const result = await database.prepare(`
    SELECT v.project_id, d.key, v.value_json
    FROM project_custom_field_values v
    JOIN project_custom_field_definitions d
      ON d.id = v.field_id AND d.organisation_id = v.organisation_id
    WHERE v.organisation_id = ?
      AND v.project_id IN (${uniqueProjectIds.map(() => "?").join(", ")})
    ORDER BY d.sort_order, d.key
  `).bind(
    organisationId,
    ...uniqueProjectIds,
  ).all<{ project_id: string; key: string; value_json: string }>();
  for (const row of result.results) {
    const projectValues = values.get(row.project_id) ?? {};
    projectValues[row.key] = parseJsonValue(row.value_json);
    values.set(row.project_id, projectValues);
  }
  return values;
}

async function validateProjectCustomFieldValues(
  database: D1Database,
  organisationId: string,
  candidate: Record<string, ProjectCustomFieldValue>,
  requireAll: boolean,
): Promise<
  | {
    ok: true;
    values: Record<string, ProjectCustomFieldValue>;
    definitions: ProjectCustomFieldDefinitionRow[];
  }
  | { ok: false; error: string }
> {
  const definitions = await projectCustomFieldDefinitions(database, organisationId, true);
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const values: Record<string, ProjectCustomFieldValue> = {};
  for (const [key, value] of Object.entries(candidate)) {
    const definition = byKey.get(key);
    if (!definition) {
      return { ok: false, error: `Custom field "${key}" is not active in this organisation` };
    }
    if (value === null) continue;
    const validation = validateProjectCustomFieldValue(definition, value);
    if (validation) return { ok: false, error: validation };
    values[key] = value;
  }
  if (requireAll) {
    const missing = definitions.find((definition) =>
      definition.required === 1 && values[definition.key] === undefined
    );
    if (missing) {
      return { ok: false, error: `${missing.label} is required` };
    }
  }
  return { ok: true, values, definitions };
}

function validateProjectCustomFieldValue(
  definition: ProjectCustomFieldDefinitionRow,
  value: ProjectCustomFieldValue,
): string | null {
  const label = definition.label;
  if (definition.field_type === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? null
      : `${label} must be a finite number`;
  }
  if (definition.field_type === "boolean") {
    return typeof value === "boolean" ? null : `${label} must be true or false`;
  }
  if (typeof value !== "string") return `${label} must be text`;
  if (definition.field_type === "text") {
    if (!value.trim()) return `${label} cannot be empty`;
    return value.length <= 2048 ? null : `${label} cannot exceed 2,048 characters`;
  }
  if (definition.field_type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${label} must use YYYY-MM-DD`;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
      ? null
      : `${label} must be a real calendar date`;
  }
  if (definition.field_type === "url") {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol)
        ? null
        : `${label} must use HTTPS or HTTP`;
    } catch {
      return `${label} must be a valid URL`;
    }
  }
  const options = parseStringArray(definition.options_json);
  return options.includes(value) ? null : `${label} must use one of its configured options`;
}

function appendProjectCustomFieldStatements(
  database: D1Database,
  statements: D1PreparedStatement[],
  organisationId: string,
  projectId: string,
  userId: string,
  definitions: ProjectCustomFieldDefinitionRow[],
  values: Record<string, ProjectCustomFieldValue>,
): void {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  for (const [key, value] of Object.entries(values)) {
    const definition = byKey.get(key);
    if (!definition || value === null) continue;
    statements.push(database.prepare(`
      INSERT INTO project_custom_field_values
        (organisation_id, project_id, field_id, value_json, updated_by)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, field_id) DO UPDATE SET
        value_json = excluded.value_json,
        updated_by = excluded.updated_by,
        updated_at = datetime('now')
    `).bind(
      organisationId,
      projectId,
      definition.id,
      JSON.stringify(value),
      userId,
    ));
  }
}

function canonicalCustomFields(values: Record<string, ProjectCustomFieldValue>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(values).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

type PortfolioHandoffDestination = {
  id: string;
  name: string;
  slug: string;
};

type PortfolioHandoffPreview = {
  valid: boolean;
  sourceOrganisation: { id: string; name: string };
  targetOrganisation: PortfolioHandoffDestination;
  summary: {
    projects: number;
    customers: number;
    customFields: number;
    fieldsToCreate: number;
  };
  projects: Array<{
    id: string;
    name: string;
    targetStatus: "DRAFT";
  }>;
  fieldsToCreate: Array<Record<string, unknown>>;
  conflicts: Array<{
    key: string;
    label: string;
    sourceType: ProjectCustomFieldType;
    targetType: ProjectCustomFieldType;
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

async function requireDestinationAdministrator(
  context: Context<AppEnvironment>,
  auth: AuthContext,
  targetOrganisationId: string,
): Promise<PortfolioHandoffDestination | Response> {
  if (targetOrganisationId === auth.organisationId) {
    return context.json({ error: "Choose a different destination organisation" }, 409);
  }
  const destination = await context.env.DB.prepare(`
    SELECT o.id, o.name, o.slug
    FROM memberships m
    JOIN organisations o ON o.id = m.organisation_id
    WHERE m.user_id = ? AND m.organisation_id = ?
      AND m.role = 'platform_admin'
      AND m.status = 'active' AND m.revoked_at IS NULL
  `).bind(auth.userId, targetOrganisationId).first<PortfolioHandoffDestination>();
  if (!destination) {
    return forbidden(
      context,
      "You must be an active platform administrator in the destination organisation",
    );
  }
  return destination;
}

async function buildPortfolioHandoffPreview(
  database: D1Database,
  auth: AuthContext,
  destination: PortfolioHandoffDestination,
  projectIds: string[],
): Promise<PortfolioHandoffPreview | { error: string; status: 404 }> {
  const projects = await portfolioHandoffSourceProjects(
    database,
    auth.organisationId,
    projectIds,
  );
  if (projects.length !== projectIds.length) {
    return { error: "One or more selected projects were not found in this workspace", status: 404 };
  }
  const sourceOrganisation = await database.prepare(`
    SELECT id, name FROM organisations WHERE id = ?
  `).bind(auth.organisationId).first<{ id: string; name: string }>();
  if (!sourceOrganisation) {
    return { error: "Source organisation not found", status: 404 };
  }
  const [sourceFields, targetFields] = await Promise.all([
    projectCustomFieldDefinitions(database, auth.organisationId, true),
    projectCustomFieldDefinitions(database, destination.id, false),
  ]);
  const targetByKey = new Map(targetFields.map((field) => [field.key, field]));
  const fieldsToCreate = sourceFields.filter((field) => !targetByKey.has(field.key));
  const conflicts = sourceFields.flatMap((field) => {
    const target = targetByKey.get(field.key);
    if (!target || target.field_type === field.field_type) return [];
    return [{
      key: field.key,
      label: field.label,
      sourceType: field.field_type,
      targetType: target.field_type,
    }];
  });
  return {
    valid: conflicts.length === 0,
    sourceOrganisation,
    targetOrganisation: destination,
    summary: {
      projects: projects.length,
      customers: new Set(
        projects.map((project) => project.customer_name?.trim().toLowerCase()).filter(Boolean),
      ).size,
      customFields: sourceFields.length,
      fieldsToCreate: fieldsToCreate.length,
    },
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      targetStatus: "DRAFT",
    })),
    fieldsToCreate: fieldsToCreate.map(publicProjectCustomFieldDefinition),
    conflicts,
    exclusions: {
      versions: true,
      assets: true,
      releases: true,
      jobs: true,
      reviews: true,
    },
    warning:
      "This handoff creates new DRAFT metadata records. Versions, R2 assets, releases, jobs, and review history remain in the source organisation.",
  };
}

type PortfolioHandoffSourceProject = {
  id: string;
  name: string;
  capture_adapter: CaptureAdapterId;
  delivery_template: string;
  notes: string | null;
  customer_name: string | null;
  customer_email: string | null;
};

async function portfolioHandoffSourceProjects(
  database: D1Database,
  organisationId: string,
  projectIds: string[],
): Promise<PortfolioHandoffSourceProject[]> {
  const result = await database.prepare(`
    SELECT p.id, p.name,
      COALESCE(p.capture_adapter_v2, p.capture_adapter) AS capture_adapter,
      p.delivery_template, p.notes,
      c.name AS customer_name, c.contact_email AS customer_email
    FROM projects p
    LEFT JOIN customers c
      ON c.id = p.customer_id AND c.organisation_id = p.organisation_id
    WHERE p.organisation_id = ?
      AND p.id IN (${projectIds.map(() => "?").join(", ")})
    ORDER BY p.id
  `).bind(
    organisationId,
    ...projectIds,
  ).all<PortfolioHandoffSourceProject>();
  return result.results;
}

async function markPortfolioHandoffFailed(
  database: D1Database,
  handoffId: string,
  sourceOrganisationId: string,
  message: string,
): Promise<void> {
  await database.prepare(`
    UPDATE project_portfolio_handoffs
    SET status = 'failed', error_message = ?, completed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ? AND source_organisation_id = ?
  `).bind(message.slice(0, 1000), handoffId, sourceOrganisationId).run();
}

async function commitPortfolioHandoff(
  context: Context<AppEnvironment>,
  auth: AuthContext,
  destination: PortfolioHandoffDestination,
  handoffId: string,
  clientOperationId: string,
  requestHash: string,
  projectIds: string[],
  preview: PortfolioHandoffPreview,
): Promise<Record<string, unknown>> {
  const database = context.env.DB;
  const projects = await portfolioHandoffSourceProjects(
    database,
    auth.organisationId,
    projectIds,
  );
  const sourceFields = await projectCustomFieldDefinitions(
    database,
    auth.organisationId,
    true,
  );
  const targetFields = await projectCustomFieldDefinitions(database, destination.id, false);
  const targetFieldByKey = new Map(targetFields.map((field) => [field.key, field]));
  const statements: D1PreparedStatement[] = [];
  for (const sourceField of sourceFields) {
    if (targetFieldByKey.has(sourceField.key)) continue;
    const copiedField: ProjectCustomFieldDefinitionRow = {
      ...sourceField,
      id: crypto.randomUUID(),
      organisation_id: destination.id,
      client_operation_id: null,
      request_hash: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    targetFieldByKey.set(copiedField.key, copiedField);
    statements.push(database.prepare(`
      INSERT INTO project_custom_field_definitions
        (id, organisation_id, key, label, description, field_type, required,
          options_json, active, sort_order, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      copiedField.id,
      destination.id,
      copiedField.key,
      copiedField.label,
      copiedField.description,
      copiedField.field_type,
      copiedField.required,
      copiedField.options_json,
      copiedField.active,
      copiedField.sort_order,
      auth.userId,
    ));
  }
  const existingCustomers = await database.prepare(`
    SELECT id, name FROM customers WHERE organisation_id = ?
  `).bind(destination.id).all<{ id: string; name: string }>();
  const customerIds = new Map(
    existingCustomers.results.map((customer) => [customer.name.trim().toLowerCase(), customer.id]),
  );
  for (const project of projects) {
    if (!project.customer_name) continue;
    const key = project.customer_name.trim().toLowerCase();
    if (customerIds.has(key)) continue;
    const customerId = crypto.randomUUID();
    customerIds.set(key, customerId);
    statements.push(database.prepare(`
      INSERT INTO customers (id, organisation_id, name, contact_email)
      VALUES (?, ?, ?, ?)
    `).bind(customerId, destination.id, project.customer_name, project.customer_email));
  }
  const sourceValues = await projectCustomFieldValues(
    database,
    auth.organisationId,
    projectIds,
  );
  const createdProjects = projects.map((project) => ({
    id: crypto.randomUUID(),
    sourceId: project.id,
    name: project.name,
    status: "DRAFT" as const,
  }));
  const createdBySource = new Map(createdProjects.map((project) => [project.sourceId, project]));
  for (const project of projects) {
    const created = createdBySource.get(project.id);
    if (!created) throw new Error("Portfolio handoff lost a project mapping");
    statements.push(database.prepare(`
      INSERT INTO projects
        (id, organisation_id, customer_id, name, slug, status,
          capture_adapter, capture_adapter_v2, delivery_template, notes,
          created_by)
      VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)
    `).bind(
      created.id,
      destination.id,
      project.customer_name
        ? customerIds.get(project.customer_name.trim().toLowerCase()) ?? null
        : null,
      project.name,
      `${slugify(project.name)}-${created.id.slice(0, 8)}`,
      legacyCaptureAdapter(project.capture_adapter),
      project.capture_adapter,
      project.delivery_template,
      project.notes,
      auth.userId,
    ));
    const values = sourceValues.get(project.id) ?? {};
    for (const [key, value] of Object.entries(values)) {
      const targetField = targetFieldByKey.get(key);
      if (!targetField || value === null) continue;
      statements.push(database.prepare(`
        INSERT INTO project_custom_field_values
          (organisation_id, project_id, field_id, value_json, updated_by)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        destination.id,
        created.id,
        targetField.id,
        JSON.stringify(value),
        auth.userId,
      ));
    }
  }
  const response = {
    handoffId,
    clientOperationId,
    sourceOrganisation: preview.sourceOrganisation,
    targetOrganisation: destination,
    createdCount: createdProjects.length,
    projects: createdProjects,
    exclusions: preview.exclusions,
    warning: preview.warning,
  };
  statements.push(database.prepare(`
    UPDATE project_portfolio_handoffs
    SET status = 'completed', response_json = ?, completed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ? AND source_organisation_id = ? AND request_hash = ?
  `).bind(JSON.stringify(response), handoffId, auth.organisationId, requestHash));
  statements.push(database.prepare(`
    INSERT INTO audit_events
      (id, organisation_id, actor_user_id, action, resource_type, resource_id,
        request_id, metadata_json)
    VALUES (?, ?, ?, 'project_portfolio.handoff_out', 'project_portfolio_handoff',
      ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    auth.organisationId,
    auth.userId,
    handoffId,
    context.get("requestId"),
    JSON.stringify({
      targetOrganisationId: destination.id,
      projectCount: createdProjects.length,
      assetsExcluded: true,
    }),
  ));
  statements.push(database.prepare(`
    INSERT INTO audit_events
      (id, organisation_id, actor_user_id, action, resource_type, resource_id,
        request_id, metadata_json)
    VALUES (?, ?, ?, 'project_portfolio.handoff_in', 'project_portfolio_handoff',
      ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    destination.id,
    auth.userId,
    handoffId,
    context.get("requestId"),
    JSON.stringify({
      sourceOrganisationId: auth.organisationId,
      projectCount: createdProjects.length,
      assetsExcluded: true,
    }),
  ));
  await database.batch(statements);
  return response;
}

type ProjectAssetHandoffSnapshot = {
  schemaVersion: 1;
  sourceOrganisation: { id: string; name: string };
  project: {
    id: string;
    name: string;
    captureAdapter: CaptureAdapterId;
    deliveryTemplate: string;
    notes: string | null;
    customerName: string | null;
    customerEmail: string | null;
  };
  fieldDefinitions: Array<{
    key: string;
    label: string;
    description: string | null;
    type: ProjectCustomFieldType;
    required: boolean;
    options: string[];
    active: boolean;
    sortOrder: number;
  }>;
  customFields: Record<string, ProjectCustomFieldValue>;
  versions: Array<{
    id: string;
    versionNumber: number;
    sourceProvenanceJson: string;
    manifestJson: string | null;
  }>;
  assets: Array<{
    id: string;
    versionId: string;
    kind: string;
    format: string;
    objectKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    etag: string | null;
  }>;
};

type ProjectAssetHandoffPreview = {
  valid: boolean;
  sourceSnapshotHash: string;
  sourceOrganisation: { id: string; name: string };
  targetOrganisation: PortfolioHandoffDestination;
  project: { id: string; name: string; targetStatus: "INGESTED" };
  summary: {
    versions: number;
    assets: number;
    bytes: number;
    customFields: number;
    fieldsToCreate: number;
  };
  fieldsToCreate: Array<Record<string, unknown>>;
  conflicts: Array<{
    key: string;
    label: string;
    sourceType: ProjectCustomFieldType;
    targetType: ProjectCustomFieldType;
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
  snapshot: ProjectAssetHandoffSnapshot;
};

type AssetHandoffProjectSnapshotRow = {
  id: string;
  name: string;
  capture_adapter: CaptureAdapterId;
  delivery_template: string;
  notes: string | null;
  customer_name: string | null;
  customer_email: string | null;
};

type AssetHandoffVersionSnapshotRow = {
  id: string;
  version_number: number;
  status: string;
  source_provenance_json: string;
  manifest_json: string | null;
};

type AssetHandoffAssetSnapshotRow = {
  id: string;
  version_id: string;
  kind: string;
  format: string;
  object_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  etag: string | null;
  sha256: string | null;
  integrity_status: string;
};

async function buildProjectAssetHandoffPreview(
  database: D1Database,
  auth: AuthContext,
  destination: PortfolioHandoffDestination,
  projectId: string,
): Promise<ProjectAssetHandoffPreview | { error: string; status: 404 | 409 | 422 }> {
  const [sourceOrganisation, project, versionResult, assetResult, sourceFields, targetFields, values] =
    await Promise.all([
      database.prepare(`
        SELECT id, name FROM organisations WHERE id = ?
      `).bind(auth.organisationId).first<{ id: string; name: string }>(),
      database.prepare(`
        SELECT p.id, p.name,
          COALESCE(p.capture_adapter_v2, p.capture_adapter) AS capture_adapter,
          p.delivery_template, p.notes,
          c.name AS customer_name, c.contact_email AS customer_email
        FROM projects p
        LEFT JOIN customers c
          ON c.id = p.customer_id AND c.organisation_id = p.organisation_id
        WHERE p.id = ? AND p.organisation_id = ?
      `).bind(projectId, auth.organisationId).first<AssetHandoffProjectSnapshotRow>(),
      database.prepare(`
        SELECT id, version_number, status, source_provenance_json, manifest_json
        FROM scene_versions
        WHERE project_id = ?
        ORDER BY version_number, id
      `).bind(projectId).all<AssetHandoffVersionSnapshotRow>(),
      database.prepare(`
        SELECT id, version_id, kind, format, object_key, file_name, mime_type,
          size_bytes, etag, sha256, integrity_status
        FROM assets
        WHERE project_id = ? AND organisation_id = ? AND deleted_at IS NULL
        ORDER BY version_id, id
      `).bind(projectId, auth.organisationId).all<AssetHandoffAssetSnapshotRow>(),
      projectCustomFieldDefinitions(database, auth.organisationId, true),
      projectCustomFieldDefinitions(database, destination.id, false),
      projectCustomFieldValues(database, auth.organisationId, [projectId]),
    ]);
  if (!sourceOrganisation || !project) {
    return { error: "The source project was not found in this workspace", status: 404 };
  }
  const assets = assetResult.results;
  const assetVersionIds = new Set(assets.map((asset) => asset.version_id));
  const versions = versionResult.results.filter((version) => assetVersionIds.has(version.id));
  if (versions.length === 0 || assets.length === 0) {
    return {
      error: "Asset-bearing handoff requires at least one immutable version and verified asset",
      status: 409,
    };
  }
  if (versions.length > 10) {
    return { error: "Copy at most 10 immutable versions in one handoff", status: 422 };
  }
  if (assets.length > 50) {
    return { error: "Copy at most 50 immutable assets in one handoff", status: 422 };
  }
  const incompleteAsset = assets.find((asset) =>
    asset.integrity_status !== "verified" ||
    !asset.sha256 ||
    !/^[0-9a-f]{64}$/.test(asset.sha256) ||
    asset.size_bytes <= 0
  );
  if (incompleteAsset) {
    return {
      error:
        `Asset ${incompleteAsset.file_name} is not a verified immutable SHA-256 source`,
      status: 409,
    };
  }
  const unstableVersion = versions.find((version) =>
    ["UPLOADING", "PROCESSING"].includes(version.status)
  );
  if (unstableVersion) {
    return {
      error: `Version ${unstableVersion.version_number} is still mutable or processing`,
      status: 409,
    };
  }
  const totalBytes = assets.reduce((sum, asset) => sum + asset.size_bytes, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > 100 * 1024 ** 3) {
    return { error: "Copy at most 100 GiB in one handoff", status: 422 };
  }
  const customFields = values.get(projectId) ?? {};
  const usedKeys = new Set(Object.keys(customFields));
  const snapshotFields = sourceFields
    .filter((field) => usedKeys.has(field.key))
    .sort((left, right) => left.key.localeCompare(right.key));
  const targetByKey = new Map(targetFields.map((field) => [field.key, field]));
  const fieldsToCreate = snapshotFields.filter((field) => !targetByKey.has(field.key));
  const conflicts = snapshotFields.flatMap((field) => {
    const target = targetByKey.get(field.key);
    if (!target || target.field_type === field.field_type) return [];
    return [{
      key: field.key,
      label: field.label,
      sourceType: field.field_type,
      targetType: target.field_type,
    }];
  });
  const snapshot: ProjectAssetHandoffSnapshot = {
    schemaVersion: 1,
    sourceOrganisation,
    project: {
      id: project.id,
      name: project.name,
      captureAdapter: project.capture_adapter,
      deliveryTemplate: project.delivery_template,
      notes: project.notes,
      customerName: project.customer_name,
      customerEmail: project.customer_email,
    },
    fieldDefinitions: snapshotFields.map((field) => ({
      key: field.key,
      label: field.label,
      description: field.description,
      type: field.field_type,
      required: Boolean(field.required),
      options: JSON.parse(field.options_json) as string[],
      active: Boolean(field.active),
      sortOrder: field.sort_order,
    })),
    customFields: Object.fromEntries(
      Object.entries(customFields).sort(([left], [right]) => left.localeCompare(right)),
    ),
    versions: versions.map((version) => ({
      id: version.id,
      versionNumber: version.version_number,
      sourceProvenanceJson: version.source_provenance_json,
      manifestJson: version.manifest_json,
    })),
    assets: assets.map((asset) => ({
      id: asset.id,
      versionId: asset.version_id,
      kind: asset.kind,
      format: asset.format,
      objectKey: asset.object_key,
      fileName: asset.file_name,
      mimeType: asset.mime_type,
      sizeBytes: asset.size_bytes,
      sha256: asset.sha256!,
      etag: asset.etag,
    })),
  };
  const sourceSnapshotHash = await sha256Hex(JSON.stringify(snapshot));
  return {
    valid: conflicts.length === 0,
    sourceSnapshotHash,
    sourceOrganisation,
    targetOrganisation: destination,
    project: {
      id: project.id,
      name: project.name,
      targetStatus: "INGESTED",
    },
    summary: {
      versions: versions.length,
      assets: assets.length,
      bytes: totalBytes,
      customFields: snapshotFields.length,
      fieldsToCreate: fieldsToCreate.length,
    },
    fieldsToCreate: fieldsToCreate.map(publicProjectCustomFieldDefinition),
    conflicts,
    exclusions: {
      releases: true,
      jobs: true,
      reviews: true,
      memberships: true,
      billing: true,
      uploadSessions: true,
    },
    warnings: [
      "The source remains unchanged. Destination versions return to INGESTED.",
      "QA, approvals, releases, jobs, reviews, identity, billing, and lifecycle authority do not transfer.",
    ],
    snapshot,
  };
}

async function projectAssetHandoffForOrganisation(
  database: D1Database,
  handoffId: string,
  organisationId: string,
): Promise<ProjectAssetHandoffRow | null> {
  return database.prepare(`
    SELECT * FROM project_asset_handoffs
    WHERE id = ? AND (source_organisation_id = ? OR target_organisation_id = ?)
  `).bind(handoffId, organisationId, organisationId).first<ProjectAssetHandoffRow>();
}

async function publicProjectAssetHandoff(
  database: D1Database,
  handoff: ProjectAssetHandoffRow,
): Promise<Record<string, unknown>> {
  const items = await database.prepare(`
    SELECT * FROM project_asset_handoff_items
    WHERE handoff_id = ?
    ORDER BY id
  `).bind(handoff.id).all<ProjectAssetHandoffItemRow>();
  return {
    id: handoff.id,
    sourceOrganisationId: handoff.source_organisation_id,
    targetOrganisationId: handoff.target_organisation_id,
    sourceProjectId: handoff.source_project_id,
    targetProjectId: handoff.target_project_id,
    sourceSnapshotHash: handoff.source_snapshot_hash,
    status: handoff.status,
    totalVersions: handoff.total_versions,
    totalAssets: handoff.total_assets,
    totalBytes: handoff.total_bytes,
    copiedAssets: handoff.copied_assets,
    copiedBytes: handoff.copied_bytes,
    progressPercent:
      handoff.total_bytes > 0
        ? Math.min(100, Math.round((handoff.copied_bytes / handoff.total_bytes) * 100))
        : 0,
    errorMessage: handoff.error_message,
    startedAt: handoff.started_at,
    completedAt: handoff.completed_at,
    cancelledAt: handoff.cancelled_at,
    updatedAt: handoff.updated_at,
    items: items.results.map((item) => ({
      id: item.id,
      sourceAssetId: item.source_asset_id,
      targetAssetId: item.target_asset_id,
      targetObjectKey: item.target_object_key,
      kind: item.kind,
      format: item.format,
      fileName: item.file_name,
      mimeType: item.mime_type,
      sizeBytes: item.size_bytes,
      sha256: item.sha256,
      status: item.status,
      attemptCount: item.attempt_count,
      errorMessage: item.error_message,
      copiedAt: item.copied_at,
    })),
  };
}

async function existingProjectAssetHandoffAction(
  database: D1Database,
  organisationId: string,
  clientOperationId: string,
  expectedAction: "retry" | "cancel",
  expectedHandoffId: string,
): Promise<{ response: Record<string, unknown> | null } | { error: string }> {
  const action = await database.prepare(`
    SELECT handoff_id, action, request_hash, response_json
    FROM project_asset_handoff_actions
    WHERE source_organisation_id = ? AND client_operation_id = ?
  `).bind(
    organisationId,
    clientOperationId,
  ).first<{
    handoff_id: string;
    action: string;
    request_hash: string;
    response_json: string;
  }>();
  if (!action) return { response: null };
  const expectedHash = await sha256Hex(`${expectedAction}:${expectedHandoffId}`);
  if (
    action.handoff_id !== expectedHandoffId ||
    action.action !== expectedAction ||
    action.request_hash !== expectedHash
  ) {
    return { error: "Operation ID was already used for a different handoff action" };
  }
  return { response: JSON.parse(action.response_json) as Record<string, unknown> };
}

function arrayBufferToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function processProjectAssetCopy(
  env: Env,
  itemId: string,
  queueAttempt: number,
): Promise<void> {
  const joined = await env.DB.prepare(`
    SELECT i.*, h.status AS handoff_status
    FROM project_asset_handoff_items i
    JOIN project_asset_handoffs h ON h.id = i.handoff_id
    WHERE i.id = ?
  `).bind(itemId).first<ProjectAssetHandoffItemRow & {
    handoff_status: ProjectAssetHandoffStatus;
  }>();
  if (!joined) return;
  if (joined.handoff_status === "cancelled") {
    await env.SPATIAL_ASSETS.delete(joined.target_object_key);
    await env.DB.prepare(`
      UPDATE project_asset_handoff_items
      SET status = 'cancelled', error_message = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).bind(itemId).run();
    return;
  }
  if (joined.handoff_status === "completed") return;
  if (joined.status === "copied") {
    await finalizeProjectAssetHandoff(env, joined.handoff_id);
    return;
  }
  const claim = await env.DB.prepare(`
    UPDATE project_asset_handoff_items
    SET status = 'copying', attempt_count = attempt_count + 1,
      error_message = NULL, updated_at = datetime('now')
    WHERE id = ? AND status IN ('queued', 'failed')
  `).bind(itemId).run();
  if ((claim.meta.changes ?? 0) === 0) return;
  await env.DB.prepare(`
    UPDATE project_asset_handoffs
    SET status = 'copying', error_message = NULL, updated_at = datetime('now')
    WHERE id = ? AND status IN ('queued', 'failed')
  `).bind(joined.handoff_id).run();
  try {
    const sourceRecord = await env.DB.prepare(`
      SELECT object_key, size_bytes, sha256, integrity_status, deleted_at
      FROM assets WHERE id = ?
    `).bind(joined.source_asset_id).first<{
      object_key: string;
      size_bytes: number;
      sha256: string | null;
      integrity_status: string;
      deleted_at: string | null;
    }>();
    if (
      !sourceRecord ||
      sourceRecord.object_key !== joined.source_object_key ||
      sourceRecord.size_bytes !== joined.size_bytes ||
      sourceRecord.sha256 !== joined.sha256 ||
      sourceRecord.integrity_status !== "verified" ||
      sourceRecord.deleted_at !== null
    ) {
      throw new Error("Source asset metadata changed after the immutable snapshot");
    }
    const existingTarget = await env.SPATIAL_ASSETS.head(joined.target_object_key);
    if (
      existingTarget &&
      existingTarget.size === joined.size_bytes &&
      existingTarget.customMetadata?.sha256 === joined.sha256
    ) {
      await markProjectAssetHandoffItemCopied(
        env,
        joined,
        existingTarget.etag,
      );
      return;
    }
    if (existingTarget) await env.SPATIAL_ASSETS.delete(joined.target_object_key);
    const source = await env.SPATIAL_ASSETS.get(joined.source_object_key);
    if (!source) throw new Error("Source object is missing from R2");
    if (source.size !== joined.size_bytes) {
      throw new Error(
        `Source object size changed: expected ${joined.size_bytes}, received ${source.size}`,
      );
    }
    const copied = await env.SPATIAL_ASSETS.put(
      joined.target_object_key,
      source.body,
      {
        sha256: joined.sha256,
        httpMetadata: {
          contentType: joined.mime_type,
          contentDisposition: `attachment; filename="${safeFileName(joined.file_name)}"`,
        },
        customMetadata: {
          handoffId: joined.handoff_id,
          sourceAssetId: joined.source_asset_id,
          sha256: joined.sha256,
        },
      },
    );
    if (!copied || copied.size !== joined.size_bytes) {
      throw new Error("Destination object size did not match the immutable source");
    }
    const copiedSha = copied.checksums.sha256
      ? arrayBufferToHex(copied.checksums.sha256)
      : null;
    if (copiedSha !== joined.sha256) {
      await env.SPATIAL_ASSETS.delete(joined.target_object_key);
      throw new Error("Destination object SHA-256 did not match the immutable source");
    }
    const latest = await env.DB.prepare(`
      SELECT status FROM project_asset_handoffs WHERE id = ?
    `).bind(joined.handoff_id).first<{ status: ProjectAssetHandoffStatus }>();
    if (!latest || latest.status === "cancelled") {
      await env.SPATIAL_ASSETS.delete(joined.target_object_key);
      await env.DB.prepare(`
        UPDATE project_asset_handoff_items
        SET status = 'cancelled', error_message = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).bind(itemId).run();
      return;
    }
    await markProjectAssetHandoffItemCopied(env, joined, copied.etag);
  } catch (error) {
    const message = errorMessage(error).slice(0, 1000);
    const terminal = queueAttempt >= 3;
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE project_asset_handoff_items
        SET status = ?, error_message = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(terminal ? "failed" : "queued", message, itemId),
      env.DB.prepare(`
        UPDATE project_asset_handoffs
        SET status = ?, error_message = ?, updated_at = datetime('now')
        WHERE id = ? AND status != 'cancelled'
      `).bind(terminal ? "failed" : "copying", message, joined.handoff_id),
    ]);
    if (!terminal) throw error;
  }
}

async function markProjectAssetHandoffItemCopied(
  env: Env,
  item: Pick<ProjectAssetHandoffItemRow, "id" | "handoff_id">,
  targetEtag: string,
): Promise<void> {
  await env.DB.prepare(`
    UPDATE project_asset_handoff_items
    SET status = 'copied', target_etag = ?, error_message = NULL,
      copied_at = COALESCE(copied_at, datetime('now')), updated_at = datetime('now')
    WHERE id = ? AND status != 'cancelled'
  `).bind(targetEtag, item.id).run();
  const progress = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total_assets,
      SUM(CASE WHEN status = 'copied' THEN 1 ELSE 0 END) AS copied_assets,
      COALESCE(SUM(CASE WHEN status = 'copied' THEN size_bytes ELSE 0 END), 0)
        AS copied_bytes
    FROM project_asset_handoff_items
    WHERE handoff_id = ?
  `).bind(item.handoff_id).first<{
    total_assets: number;
    copied_assets: number;
    copied_bytes: number;
  }>();
  if (!progress) throw new Error("Asset handoff progress could not be calculated");
  await env.DB.prepare(`
    UPDATE project_asset_handoffs
    SET copied_assets = ?, copied_bytes = ?, error_message = NULL,
      updated_at = datetime('now')
    WHERE id = ? AND status NOT IN ('cancelled', 'completed')
  `).bind(
    progress.copied_assets,
    progress.copied_bytes,
    item.handoff_id,
  ).run();
  if (progress.copied_assets === progress.total_assets) {
    await finalizeProjectAssetHandoff(env, item.handoff_id);
  }
}

async function finalizeProjectAssetHandoff(env: Env, handoffId: string): Promise<void> {
  const progress = await env.DB.prepare(`
    SELECT h.*,
      (SELECT COUNT(*) FROM project_asset_handoff_items i
        WHERE i.handoff_id = h.id AND i.status = 'copied') AS actual_copied
    FROM project_asset_handoffs h
    WHERE h.id = ?
  `).bind(handoffId).first<ProjectAssetHandoffRow & { actual_copied: number }>();
  if (
    !progress ||
    progress.status === "completed" ||
    progress.status === "cancelled" ||
    progress.actual_copied !== progress.total_assets
  ) return;
  const claim = await env.DB.prepare(`
    UPDATE project_asset_handoffs
    SET status = 'finalizing', error_message = NULL, updated_at = datetime('now')
    WHERE id = ? AND status IN ('queued', 'copying', 'failed')
  `).bind(handoffId).run();
  if ((claim.meta.changes ?? 0) === 0) return;
  try {
    const snapshot = JSON.parse(progress.source_snapshot_json) as ProjectAssetHandoffSnapshot;
    const targetAdmin = await env.DB.prepare(`
      SELECT 1 AS allowed
      FROM memberships
      WHERE organisation_id = ? AND user_id = ?
        AND role = 'platform_admin' AND status = 'active'
    `).bind(
      progress.target_organisation_id,
      progress.actor_user_id,
    ).first<{ allowed: number }>();
    if (!targetAdmin) {
      throw new Error("Destination administrator access was revoked before finalization");
    }
    const [versionRows, itemRows, targetFields, existingCustomers] = await Promise.all([
      env.DB.prepare(`
        SELECT * FROM project_asset_handoff_versions
        WHERE handoff_id = ? ORDER BY version_number
      `).bind(handoffId).all<{
        id: string;
        source_version_id: string;
        target_version_id: string;
        version_number: number;
        source_provenance_json: string;
        manifest_json: string | null;
      }>(),
      env.DB.prepare(`
        SELECT * FROM project_asset_handoff_items
        WHERE handoff_id = ? ORDER BY id
      `).bind(handoffId).all<ProjectAssetHandoffItemRow>(),
      projectCustomFieldDefinitions(env.DB, progress.target_organisation_id, false),
      env.DB.prepare(`
        SELECT id, name FROM customers WHERE organisation_id = ?
      `).bind(progress.target_organisation_id).all<{ id: string; name: string }>(),
    ]);
    if (
      versionRows.results.length !== progress.total_versions ||
      itemRows.results.length !== progress.total_assets ||
      itemRows.results.some((item) => item.status !== "copied" || !item.target_etag)
    ) {
      throw new Error("Asset handoff mappings are incomplete");
    }
    const targetFieldByKey = new Map(targetFields.map((field) => [field.key, field]));
    for (const sourceField of snapshot.fieldDefinitions) {
      const target = targetFieldByKey.get(sourceField.key);
      if (target && target.field_type !== sourceField.type) {
        throw new Error(
          `Destination custom field "${sourceField.key}" changed to an incompatible type`,
        );
      }
    }
    const statements: D1PreparedStatement[] = [];
    for (const sourceField of snapshot.fieldDefinitions) {
      if (targetFieldByKey.has(sourceField.key)) continue;
      const id = crypto.randomUUID();
      const row: ProjectCustomFieldDefinitionRow = {
        id,
        organisation_id: progress.target_organisation_id,
        key: sourceField.key,
        label: sourceField.label,
        description: sourceField.description,
        field_type: sourceField.type,
        required: sourceField.required ? 1 : 0,
        options_json: JSON.stringify(sourceField.options),
        active: sourceField.active ? 1 : 0,
        sort_order: sourceField.sortOrder,
        client_operation_id: null,
        request_hash: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      targetFieldByKey.set(row.key, row);
      statements.push(env.DB.prepare(`
        INSERT INTO project_custom_field_definitions
          (id, organisation_id, key, label, description, field_type, required,
            options_json, active, sort_order, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        row.id,
        row.organisation_id,
        row.key,
        row.label,
        row.description,
        row.field_type,
        row.required,
        row.options_json,
        row.active,
        row.sort_order,
        progress.actor_user_id,
      ));
    }
    let customerId: string | null = null;
    if (snapshot.project.customerName) {
      customerId = existingCustomers.results.find((customer) =>
        customer.name.trim().toLowerCase() === snapshot.project.customerName!.trim().toLowerCase()
      )?.id ?? null;
      if (!customerId) {
        customerId = crypto.randomUUID();
        statements.push(env.DB.prepare(`
          INSERT INTO customers (id, organisation_id, name, contact_email)
          VALUES (?, ?, ?, ?)
        `).bind(
          customerId,
          progress.target_organisation_id,
          snapshot.project.customerName,
          snapshot.project.customerEmail,
        ));
      }
    }
    statements.push(env.DB.prepare(`
      INSERT INTO projects
        (id, organisation_id, customer_id, name, slug, status, capture_adapter,
          capture_adapter_v2, delivery_template, notes, created_by)
      SELECT ?, ?, ?, ?, ?, 'INGESTED', ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM project_asset_handoffs
        WHERE id = ? AND status = 'finalizing'
      )
    `).bind(
      progress.target_project_id,
      progress.target_organisation_id,
      customerId,
      snapshot.project.name,
      `${slugify(snapshot.project.name)}-${progress.target_project_id.slice(0, 8)}`,
      legacyCaptureAdapter(snapshot.project.captureAdapter),
      snapshot.project.captureAdapter,
      snapshot.project.deliveryTemplate,
      snapshot.project.notes,
      progress.actor_user_id,
      handoffId,
    ));
    const versionByMapping = new Map(versionRows.results.map((row) => [row.id, row]));
    for (const mapping of versionRows.results) {
      const originalProvenance = parseJsonRecord(mapping.source_provenance_json);
      statements.push(env.DB.prepare(`
        INSERT INTO scene_versions
          (id, project_id, version_number, status, source_provenance_json,
            manifest_json, created_by)
        VALUES (?, ?, ?, 'INGESTED', ?, ?, ?)
      `).bind(
        mapping.target_version_id,
        progress.target_project_id,
        mapping.version_number,
        JSON.stringify({
          ...originalProvenance,
          assetHandoff: {
            handoffId,
            sourceOrganisationId: progress.source_organisation_id,
            sourceProjectId: progress.source_project_id,
            sourceVersionId: mapping.source_version_id,
            sourceSnapshotHash: progress.source_snapshot_hash,
          },
        }),
        mapping.manifest_json,
        progress.actor_user_id,
      ));
    }
    for (const item of itemRows.results) {
      const version = versionByMapping.get(item.version_mapping_id);
      if (!version) throw new Error("Asset handoff lost a destination version mapping");
      statements.push(env.DB.prepare(`
        INSERT INTO assets
          (id, organisation_id, project_id, version_id, kind, format, object_key,
            file_name, mime_type, size_bytes, etag, sha256, integrity_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified')
      `).bind(
        item.target_asset_id,
        progress.target_organisation_id,
        progress.target_project_id,
        version.target_version_id,
        item.kind,
        item.format,
        item.target_object_key,
        item.file_name,
        item.mime_type,
        item.size_bytes,
        item.target_etag,
        item.sha256,
      ));
    }
    for (const [key, value] of Object.entries(snapshot.customFields)) {
      const field = targetFieldByKey.get(key);
      if (!field || value === null) continue;
      statements.push(env.DB.prepare(`
        INSERT INTO project_custom_field_values
          (organisation_id, project_id, field_id, value_json, updated_by)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        progress.target_organisation_id,
        progress.target_project_id,
        field.id,
        JSON.stringify(value),
        progress.actor_user_id,
      ));
    }
    const response = {
      handoffId,
      sourceProjectId: progress.source_project_id,
      targetProjectId: progress.target_project_id,
      versions: progress.total_versions,
      assets: progress.total_assets,
      bytes: progress.total_bytes,
      sourceSnapshotHash: progress.source_snapshot_hash,
      destinationStatus: "INGESTED",
    };
    statements.push(env.DB.prepare(`
      UPDATE project_asset_handoffs
      SET status = 'completed', copied_assets = total_assets,
        copied_bytes = total_bytes, response_json = ?, error_message = NULL,
        completed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status = 'finalizing'
    `).bind(JSON.stringify(response), handoffId));
    statements.push(env.DB.prepare(`
      INSERT INTO audit_events
        (id, organisation_id, actor_user_id, action, resource_type, resource_id,
          request_id, metadata_json)
      VALUES (?, ?, ?, 'project_asset_handoff.copy_out', 'project_asset_handoff',
        ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      progress.source_organisation_id,
      progress.actor_user_id,
      handoffId,
      `queue:${handoffId}`,
      JSON.stringify({
        targetOrganisationId: progress.target_organisation_id,
        sourceProjectId: progress.source_project_id,
        assets: progress.total_assets,
        bytes: progress.total_bytes,
      }),
    ));
    statements.push(env.DB.prepare(`
      INSERT INTO audit_events
        (id, organisation_id, actor_user_id, action, resource_type, resource_id,
          request_id, metadata_json)
      VALUES (?, ?, ?, 'project_asset_handoff.copy_in', 'project_asset_handoff',
        ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      progress.target_organisation_id,
      progress.actor_user_id,
      handoffId,
      `queue:${handoffId}`,
      JSON.stringify({
        sourceOrganisationId: progress.source_organisation_id,
        targetProjectId: progress.target_project_id,
        assets: progress.total_assets,
        bytes: progress.total_bytes,
        lifecycleAuthorityTransferred: false,
      }),
    ));
    await env.DB.batch(statements);
    console.log(JSON.stringify({
      event: "project_asset_handoff.completed",
      handoffId,
      assets: progress.total_assets,
      bytes: progress.total_bytes,
      targetProjectId: progress.target_project_id,
    }));
  } catch (error) {
    await env.DB.prepare(`
      UPDATE project_asset_handoffs
      SET status = 'failed', error_message = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'finalizing'
    `).bind(errorMessage(error).slice(0, 1000), handoffId).run();
    throw error;
  }
}

async function projectArchiveBlocker(
  database: D1Database,
  organisationId: string,
  projectId: string,
): Promise<string | null> {
  const blockers = await database.batch([
    database.prepare(`
      SELECT COUNT(*) AS count FROM release_channels
      WHERE project_id = ? AND organisation_id = ? AND active_release_id IS NOT NULL
    `).bind(projectId, organisationId),
    database.prepare(`
      SELECT COUNT(*) AS count FROM processing_jobs
      WHERE project_id = ? AND organisation_id = ? AND state IN ('QUEUED', 'LEASED', 'RUNNING')
    `).bind(projectId, organisationId),
    database.prepare(`
      SELECT COUNT(*) AS count FROM upload_sessions
      WHERE project_id = ? AND organisation_id = ? AND status = 'OPEN'
    `).bind(projectId, organisationId),
  ]);
  if (scalarCount(requiredBatchResult(blockers, 0)) > 0) {
    return "Revoke the active release before archiving this project";
  }
  if (scalarCount(requiredBatchResult(blockers, 1)) > 0 || scalarCount(requiredBatchResult(blockers, 2)) > 0) {
    return "Finish or cancel active processing and uploads before archiving this project";
  }
  return null;
}

async function scopedProject(database: D1Database, organisationId: string, projectId: string): Promise<ProjectRow | null> {
  return database.prepare(`
    SELECT p.*, COALESCE(p.capture_adapter_v2, p.capture_adapter) AS capture_adapter,
      c.name AS customer_name,
      sv.id AS latest_version_id, sv.version_number AS latest_version_number,
      rc.slug AS active_release_slug
    FROM projects p LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN scene_versions sv ON sv.id = (
      SELECT id FROM scene_versions WHERE project_id = p.id ORDER BY version_number DESC LIMIT 1
    )
    LEFT JOIN release_channels rc ON rc.project_id = p.id AND rc.active_release_id IS NOT NULL
    WHERE p.id = ? AND p.organisation_id = ?
  `).bind(projectId, organisationId).first<ProjectRow>();
}

async function scopedUpload(database: D1Database, organisationId: string, uploadId: string): Promise<UploadRow | null> {
  return database.prepare("SELECT * FROM upload_sessions WHERE id = ? AND organisation_id = ?").bind(uploadId, organisationId).first<UploadRow>();
}

async function activeRelease(database: D1Database, slug: string): Promise<ReleaseRow | null> {
  return database.prepare(`
    SELECT r.*, rc.slug, p.name AS project_name,
      COALESCE(p.capture_adapter_v2, p.capture_adapter) AS capture_adapter,
      sv.source_provenance_json
    FROM release_channels rc
    JOIN releases r ON r.id = rc.active_release_id
    JOIN projects p ON p.id = r.project_id
    JOIN scene_versions sv ON sv.id = r.version_id
    WHERE rc.slug = ?
  `).bind(slug).first<ReleaseRow>();
}

function cloudflareSaasConfig(env: Env): CloudflareSaasConfig | null {
  const zoneId = env.CLOUDFLARE_SAAS_ZONE_ID?.trim();
  const apiToken = env.CLOUDFLARE_SAAS_API_TOKEN?.trim();
  const cnameTarget = env.CLOUDFLARE_SAAS_CNAME_TARGET?.trim();
  if (!zoneId || !apiToken || !cnameTarget) return null;
  return { zoneId, apiToken, cnameTarget };
}

function stripeBillingConfig(env: Env): StripeBillingConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  const listing = env.STRIPE_PRICE_LISTING?.trim();
  const portfolio = env.STRIPE_PRICE_PORTFOLIO?.trim();
  const venue = env.STRIPE_PRICE_VENUE?.trim();
  if (!secretKey || !webhookSecret || !listing || !portfolio || !venue) return null;
  return {
    secretKey,
    webhookSecret,
    prices: { listing, portfolio, venue },
  };
}

async function manualBillingState(
  database: D1Database,
  organisationId: string,
  invoiceId: string | null,
  subscriptionId: string | null,
): Promise<{ invoice: ManualInvoiceRow | null; subscription: ManualSubscriptionRow | null }> {
  const [invoice, subscription] = await Promise.all([
    invoiceId
      ? database.prepare(`
          SELECT * FROM billing_invoices
          WHERE id = ? AND organisation_id = ? AND billing_method = 'manual'
        `).bind(invoiceId, organisationId).first<ManualInvoiceRow>()
      : Promise.resolve(null),
    subscriptionId
      ? database.prepare(`
          SELECT * FROM project_hosting_subscriptions
          WHERE id = ? AND organisation_id = ? AND payment_provider = 'manual'
        `).bind(subscriptionId, organisationId).first<ManualSubscriptionRow>()
      : Promise.resolve(null),
  ]);
  return { invoice, subscription };
}

function publicBillingCheckout(checkout: BillingCheckoutRow): Record<string, unknown> {
  return {
    id: checkout.id,
    projectId: checkout.project_id,
    planCode: checkout.plan_code,
    status: checkout.status,
    amountCents: checkout.amount_cents,
    currency: checkout.currency,
    paymentProvider: checkout.payment_provider,
    providerCheckoutId: checkout.provider_checkout_id,
    paymentStatus: checkout.payment_status,
    checkoutUrl: checkout.checkout_url,
    lastError: checkout.last_error,
    expiresAt: checkout.expires_at,
    completedAt: checkout.completed_at,
    createdAt: checkout.created_at,
  };
}

async function scopedCustomDomain(
  database: D1Database,
  organisationId: string,
  projectId: string,
  domainId: string,
): Promise<CustomDomainRow | null> {
  return database.prepare(`
    SELECT * FROM custom_domains
    WHERE id = ? AND project_id = ? AND organisation_id = ? AND status != 'removed'
  `).bind(domainId, projectId, organisationId).first<CustomDomainRow>();
}

async function customDomainForHost(
  database: D1Database,
  hostname: string,
): Promise<{
  project_id: string;
  status: string;
  provider_status: string | null;
  provider_ssl_status: string | null;
  active_release_slug: string | null;
} | null> {
  return database.prepare(`
    SELECT cd.project_id, cd.status, cd.provider_status, cd.provider_ssl_status,
      rc.slug AS active_release_slug
    FROM custom_domains cd
    LEFT JOIN release_channels rc
      ON rc.project_id = cd.project_id AND rc.organisation_id = cd.organisation_id
        AND rc.active_release_id IS NOT NULL
    WHERE lower(cd.hostname) = lower(?) AND cd.status != 'removed' AND cd.removed_at IS NULL
    LIMIT 1
  `).bind(hostname).first<{
    project_id: string;
    status: string;
    provider_status: string | null;
    provider_ssl_status: string | null;
    active_release_slug: string | null;
  }>();
}

function customDomainReady(
  domain: {
    status: string;
    provider_status: string | null;
    provider_ssl_status: string | null;
  },
): boolean {
  return domain.status === "active" &&
    domain.provider_status === "active" &&
    domain.provider_ssl_status === "active";
}

function isPlatformHostname(env: Env, hostname: string): boolean {
  try {
    if (hostname === new URL(env.APP_ORIGIN).hostname) return true;
  } catch {
    // Invalid configuration is handled by the normal application boundary.
  }
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".workers.dev");
}

function publicCustomDomain(
  domain: CustomDomainRow,
  providerConfigured: boolean,
): Record<string, unknown> {
  let status: string;
  if (
    domain.status === "active" &&
    domain.provider_status === "active" &&
    domain.provider_ssl_status === "active"
  ) {
    status = "active";
  } else if (domain.status === "failed") {
    status = "failed";
  } else if (!domain.dns_verified_at) {
    status = "ownership_pending";
  } else if (!providerConfigured && !domain.provider_hostname_id) {
    status = "provider_configuration_required";
  } else if (!domain.provider_hostname_id) {
    status = "ready_to_provision";
  } else {
    status = "provider_pending";
  }
  return {
    id: domain.id,
    hostname: domain.hostname,
    status,
    dnsVerifiedAt: domain.dns_verified_at,
    provider: domain.provider,
    providerHostnameId: domain.provider_hostname_id,
    providerStatus: domain.provider_status,
    providerSslStatus: domain.provider_ssl_status,
    providerValidation: parseProviderValidation(domain.provider_validation_json),
    provisioningAttempts: domain.provisioning_attempts,
    lastCheckedAt: domain.last_checked_at,
    provisionedAt: domain.provisioned_at,
    lastError: domain.last_error,
    createdAt: domain.created_at,
  };
}

function providerHostnameEvidence(hostname: CloudflareCustomHostname): Record<string, unknown> {
  return {
    ownershipVerification: hostname.ownershipVerification,
    sslValidationRecords: hostname.sslValidationRecords,
    verificationErrors: hostname.verificationErrors,
  };
}

function parseProviderValidation(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function canViewRelease(context: Context<AppEnvironment>, release: ReleaseRow): Promise<boolean> {
  if (release.access_policy === "public" || release.access_policy === "unlisted") return true;
  if (release.access_policy === "customer-authenticated") {
    const auth = await authenticate(context);
    if (!auth || auth.organisationId !== release.organisation_id) return false;
    if (["platform_admin", "production_operator"].includes(auth.role)) return true;
    return Boolean(await context.env.DB.prepare(`
      SELECT 1 AS allowed FROM project_access
      WHERE organisation_id = ? AND project_id = ? AND user_id = ? AND revoked_at IS NULL
    `).bind(
      release.organisation_id,
      release.project_id,
      auth.userId,
    ).first<{ allowed: number }>());
  }
  const supplied = context.req.query("access_token");
  if (!supplied || !release.access_token_hash) return false;
  const suppliedHash = await sha256Hex(`${supplied}:${context.env.SESSION_PEPPER}`);
  return timingSafeStringEqual(suppliedHash, release.access_token_hash);
}

async function provisionAdministrator(env: Env, email: string): Promise<AuthContext> {
  const organisationId = "00000000-0000-4000-8000-000000000001";
  const userId = "00000000-0000-4000-8000-000000000002";
  const displayName = email.split("@")[0] || "Platform administrator";
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organisations (id, name, slug) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name",
    ).bind(organisationId, "Spatial Studio", "spatial-studio"),
    env.DB.prepare(
      "INSERT INTO users (id, email, display_name) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name",
    ).bind(userId, email, displayName),
    env.DB.prepare(
      `INSERT INTO memberships (organisation_id, user_id, role, updated_at, revoked_at, status)
       VALUES (?, ?, 'platform_admin', datetime('now'), NULL, 'active')
       ON CONFLICT(organisation_id, user_id) DO UPDATE SET
         role = excluded.role, updated_at = datetime('now'), revoked_at = NULL,
         status = 'active'`,
    ).bind(organisationId, userId),
  ]);
  return { userId, organisationId, email, displayName, role: "platform_admin" };
}

async function memberForEmail(database: D1Database, email: string): Promise<AuthContext | null> {
  return database.prepare(`
    SELECT u.id AS userId, m.organisation_id AS organisationId, u.email,
      u.display_name AS displayName, m.role
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    WHERE lower(u.email) = ? AND m.revoked_at IS NULL AND m.status = 'active'
    ORDER BY CASE m.role
      WHEN 'platform_admin' THEN 1
      WHEN 'production_operator' THEN 2
      WHEN 'customer_reviewer' THEN 3
      ELSE 4 END
    LIMIT 1
  `).bind(email).first<AuthContext>();
}

async function memberForEmailInOrganisation(
  database: D1Database,
  organisationId: string,
  email: string,
): Promise<AuthContext | null> {
  return database.prepare(`
    SELECT u.id AS userId, m.organisation_id AS organisationId, u.email,
      u.display_name AS displayName, m.role
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    WHERE lower(u.email) = ? AND m.organisation_id = ?
      AND m.revoked_at IS NULL AND m.status = 'active'
    LIMIT 1
  `).bind(email, organisationId).first<AuthContext>();
}

async function linkedEnterpriseIdentity(
  database: D1Database,
  providerId: string,
  subject: string,
  organisationId: string,
): Promise<AuthContext | null> {
  return database.prepare(`
    SELECT u.id AS userId, m.organisation_id AS organisationId, u.email,
      u.display_name AS displayName, m.role
    FROM enterprise_identity_links link
    JOIN users u ON u.id = link.user_id
    JOIN memberships m
      ON m.user_id = link.user_id
      AND m.organisation_id = link.organisation_id
    WHERE link.provider_id = ? AND link.subject = ?
      AND link.organisation_id = ?
      AND m.revoked_at IS NULL AND m.status = 'active'
    LIMIT 1
  `).bind(providerId, subject, organisationId).first<AuthContext>();
}

type TeamMemberRecord = {
  userId: string;
  email: string;
  displayName: string;
  role: "platform_admin" | "production_operator";
  joinedAt: string;
  updatedAt: string | null;
  revokedAt: string | null;
  status: "active" | "invited";
};

async function activeTeamMember(
  database: D1Database,
  organisationId: string,
  userId: string,
): Promise<TeamMemberRecord | null> {
  return database.prepare(`
    SELECT u.id AS userId, u.email, u.display_name AS displayName, m.role, m.status,
      m.created_at AS joinedAt, m.updated_at AS updatedAt, m.revoked_at AS revokedAt
    FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.organisation_id = ? AND m.user_id = ? AND m.revoked_at IS NULL
      AND m.status IN ('active', 'invited')
      AND m.role IN ('platform_admin', 'production_operator')
  `).bind(organisationId, userId).first<TeamMemberRecord>();
}

async function isLastAdministrator(
  database: D1Database,
  organisationId: string,
  userId: string,
): Promise<boolean> {
  const result = await database.prepare(`
    SELECT COUNT(*) AS count FROM memberships
    WHERE organisation_id = ? AND role = 'platform_admin'
      AND revoked_at IS NULL AND status = 'active' AND user_id != ?
  `).bind(organisationId, userId).first<{ count: number }>();
  return (result?.count ?? 0) === 0;
}

async function deliverTeamInvitation(
  env: Env,
  organisationId: string,
  invitationId: string,
  email: string,
  role: "platform_admin" | "production_operator",
  expiresAt: string,
): Promise<{ status: "sent" | "failed"; error: string | null }> {
  let status: "sent" | "failed" = "sent";
  let deliveryError: string | null = null;
  try {
    await sendTeamInvitationEmail(env, email, role, expiresAt);
  } catch (error) {
    status = "failed";
    deliveryError = errorMessage(error).slice(0, 500);
  }
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE organisation_invitations
      SET last_sent_at = datetime('now'), send_count = send_count + 1
      WHERE id = ? AND organisation_id = ?
    `).bind(invitationId, organisationId),
    env.DB.prepare(`
      INSERT INTO notification_deliveries
        (id, organisation_id, channel, template, recipient, status,
          error_message, sent_at)
      VALUES (?, ?, 'email', 'team_invitation', ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      organisationId,
      email,
      status,
      deliveryError,
      status === "sent" ? new Date().toISOString() : null,
    ),
  ]);
  return { status, error: deliveryError };
}

async function acceptPendingOrganisationInvitation(
  database: D1Database,
  email: string,
): Promise<AuthContext | null> {
  const now = new Date().toISOString();
  await database.prepare(`
    UPDATE organisation_invitations SET status = 'expired'
    WHERE lower(email) = lower(?) AND status = 'pending' AND expires_at <= ?
  `).bind(email, now).run();
  const invitation = await database.prepare(`
    SELECT oi.id, oi.organisation_id AS organisationId, u.id AS userId,
      u.email, u.display_name AS displayName, m.role
    FROM organisation_invitations oi
    JOIN users u ON lower(u.email) = lower(oi.email)
    JOIN memberships m ON m.organisation_id = oi.organisation_id AND m.user_id = u.id
    WHERE lower(oi.email) = lower(?) AND oi.status = 'pending'
      AND oi.expires_at > ? AND m.status = 'invited' AND m.revoked_at IS NULL
    ORDER BY oi.invited_at DESC LIMIT 1
  `).bind(email, now).first<AuthContext & { id: string }>();
  if (!invitation) return null;
  await database.batch([
    database.prepare(`
      UPDATE memberships
      SET status = 'active', updated_at = datetime('now'), revoked_at = NULL
      WHERE organisation_id = ? AND user_id = ? AND status = 'invited'
    `).bind(invitation.organisationId, invitation.userId),
    database.prepare(`
      UPDATE organisation_invitations
      SET status = 'accepted', accepted_by = ?, accepted_at = datetime('now')
      WHERE id = ? AND status = 'pending' AND expires_at > ?
    `).bind(invitation.userId, invitation.id, now),
  ]);
  return {
    userId: invitation.userId,
    organisationId: invitation.organisationId,
    email: invitation.email,
    displayName: invitation.displayName,
    role: invitation.role,
  };
}

async function acceptPendingOrganisationInvitationForOrganisation(
  database: D1Database,
  organisationId: string,
  email: string,
): Promise<void> {
  const now = new Date().toISOString();
  await database.prepare(`
    UPDATE organisation_invitations SET status = 'expired'
    WHERE organisation_id = ? AND lower(email) = lower(?)
      AND status = 'pending' AND expires_at <= ?
  `).bind(organisationId, email, now).run();
  const invitation = await database.prepare(`
    SELECT oi.id, u.id AS userId
    FROM organisation_invitations oi
    JOIN users u ON lower(u.email) = lower(oi.email)
    JOIN memberships m
      ON m.organisation_id = oi.organisation_id
      AND m.user_id = u.id
    WHERE oi.organisation_id = ? AND lower(oi.email) = lower(?)
      AND oi.status = 'pending' AND oi.expires_at > ?
      AND m.status = 'invited' AND m.revoked_at IS NULL
    ORDER BY oi.invited_at DESC LIMIT 1
  `).bind(organisationId, email, now).first<{
    id: string;
    userId: string;
  }>();
  if (!invitation) return;
  await database.batch([
    database.prepare(`
      UPDATE memberships
      SET status = 'active', updated_at = datetime('now'), revoked_at = NULL
      WHERE organisation_id = ? AND user_id = ? AND status = 'invited'
    `).bind(organisationId, invitation.userId),
    database.prepare(`
      UPDATE organisation_invitations
      SET status = 'accepted', accepted_by = ?, accepted_at = datetime('now')
      WHERE id = ? AND status = 'pending' AND expires_at > ?
    `).bind(invitation.userId, invitation.id, now),
  ]);
}

async function acceptPendingOrganisationInvitations(
  database: D1Database,
  email: string,
): Promise<void> {
  while (await acceptPendingOrganisationInvitation(database, email)) {
    // Accept every live tenant invitation before selecting the initial session.
  }
}

async function acceptPendingProjectInvitations(database: D1Database, auth: AuthContext): Promise<void> {
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`
      UPDATE project_invitations SET status = 'expired'
      WHERE organisation_id = ? AND lower(email) = lower(?)
        AND status = 'pending' AND expires_at <= ?
    `).bind(auth.organisationId, auth.email, now),
    database.prepare(`
      INSERT INTO project_access
        (organisation_id, project_id, user_id, role, invited_by, granted_at, revoked_at)
      SELECT organisation_id, project_id, ?, role, invited_by, datetime('now'), NULL
      FROM project_invitations
      WHERE organisation_id = ? AND lower(email) = lower(?)
        AND status = 'pending' AND expires_at > ?
      ON CONFLICT(project_id, user_id) DO UPDATE SET
        role = excluded.role,
        invited_by = excluded.invited_by,
        granted_at = excluded.granted_at,
        revoked_at = NULL
    `).bind(auth.userId, auth.organisationId, auth.email, now),
    database.prepare(`
      UPDATE project_invitations
      SET status = 'accepted', accepted_by = ?, accepted_at = datetime('now')
      WHERE organisation_id = ? AND lower(email) = lower(?)
        AND status = 'pending' AND expires_at > ?
    `).bind(auth.userId, auth.organisationId, auth.email, now),
  ]);
}

async function sendOtpEmail(env: Env, email: string, code: string, ttlSeconds: number): Promise<void> {
  const minutes = Math.max(1, Math.ceil(ttlSeconds / 60));
  const safeCode = escapeHtml(code);
  await env.EMAIL.send({
    to: email,
    from: { email: env.EMAIL_FROM, name: "Spatial Studio" },
    subject: `${code} is your Spatial Studio sign-in code`,
    text: [
      "Sign in to Spatial Studio",
      "",
      `Your one-time code is: ${code}`,
      `It expires in ${minutes} minutes and can only be used once.`,
      "",
      "If you did not request this code, you can ignore this message.",
      `Open Spatial Studio: ${env.APP_ORIGIN}/studio.html`,
    ].join("\n"),
    html: `<!doctype html>
      <html><body style="margin:0;background:#f4f5f0;color:#17231d;font-family:Arial,sans-serif">
        <div style="max-width:560px;margin:0 auto;padding:40px 20px">
          <div style="background:#fff;border:1px solid #dfe5dc;border-radius:16px;padding:32px">
            <p style="margin:0 0 8px;color:#56705f;font-size:12px;font-weight:700;letter-spacing:.12em">SPATIAL STUDIO</p>
            <h1 style="margin:0 0 16px;font-size:26px">Your sign-in code</h1>
            <p style="margin:0 0 24px;line-height:1.6">Use this one-time code to sign in. It expires in ${minutes} minutes.</p>
            <div style="padding:18px 20px;border-radius:12px;background:#eef4ed;font-size:32px;font-weight:700;letter-spacing:.22em;text-align:center">${safeCode}</div>
            <p style="margin:24px 0 0;color:#607067;font-size:13px;line-height:1.5">This code can only be used once. If you did not request it, no action is needed.</p>
          </div>
        </div>
      </body></html>`,
  });
}

async function sendReviewInvitationEmail(
  env: Env,
  email: string,
  projectName: string,
  expiresAt: string,
): Promise<void> {
  const reviewUrl = `${env.APP_ORIGIN}/studio.html#reviews`;
  const safeProjectName = escapeHtml(projectName);
  await env.EMAIL.send({
    to: email,
    from: { email: env.EMAIL_FROM, name: "Spatial Studio" },
    subject: `Review ${projectName} in Spatial Studio`,
    text: [
      "You have been invited to review a spatial project.",
      "",
      `Project: ${projectName}`,
      `Invitation expires: ${expiresAt}`,
      "",
      `Sign in with this email address: ${reviewUrl}`,
      "Spatial Studio will send a one-time code; no password is required.",
    ].join("\n"),
    html: `<!doctype html>
      <html><body style="margin:0;background:#f4f5f0;color:#17231d;font-family:Arial,sans-serif">
        <div style="max-width:560px;margin:0 auto;padding:40px 20px">
          <div style="background:#fff;border:1px solid #dfe5dc;border-radius:16px;padding:32px">
            <p style="margin:0 0 8px;color:#56705f;font-size:12px;font-weight:700;letter-spacing:.12em">SPATIAL STUDIO</p>
            <h1 style="margin:0 0 16px;font-size:26px">A spatial project is ready for review</h1>
            <p style="margin:0 0 24px;line-height:1.6">You have been invited to review <strong>${safeProjectName}</strong>. Sign in with this email address and a one-time code.</p>
            <a href="${reviewUrl}" style="display:inline-block;padding:13px 20px;border-radius:999px;background:#17231d;color:#fff;text-decoration:none;font-weight:700">Open review workspace</a>
            <p style="margin:24px 0 0;color:#607067;font-size:13px;line-height:1.5">This invitation expires ${escapeHtml(expiresAt)}.</p>
          </div>
        </div>
      </body></html>`,
  });
}

async function sendTeamInvitationEmail(
  env: Env,
  email: string,
  role: "platform_admin" | "production_operator",
  expiresAt: string,
): Promise<void> {
  const studioUrl = `${env.APP_ORIGIN}/studio.html#team`;
  const roleLabel = role === "platform_admin" ? "platform administrator" : "production operator";
  await env.EMAIL.send({
    to: email,
    from: { email: env.EMAIL_FROM, name: "Spatial Studio" },
    subject: "Join the Spatial Studio production team",
    text: [
      "You have been invited to join Spatial Studio.",
      "",
      `Role: ${roleLabel}`,
      `Invitation expires: ${expiresAt}`,
      "",
      `Sign in with this email address: ${studioUrl}`,
      "Spatial Studio will send a one-time code; no password is required.",
    ].join("\n"),
    html: `<!doctype html>
      <html><body style="margin:0;background:#f4f5f0;color:#17231d;font-family:Arial,sans-serif">
        <div style="max-width:560px;margin:0 auto;padding:40px 20px">
          <div style="background:#fff;border:1px solid #dfe5dc;border-radius:16px;padding:32px">
            <p style="margin:0 0 8px;color:#56705f;font-size:12px;font-weight:700;letter-spacing:.12em">SPATIAL STUDIO</p>
            <h1 style="margin:0 0 16px;font-size:26px">Join the production team</h1>
            <p style="margin:0 0 24px;line-height:1.6">You have been invited as a <strong>${escapeHtml(roleLabel)}</strong>. Confirm access by signing in with this email and a one-time code.</p>
            <a href="${studioUrl}" style="display:inline-block;padding:13px 20px;border-radius:999px;background:#17231d;color:#fff;text-decoration:none;font-weight:700">Open Spatial Studio</a>
            <p style="margin:24px 0 0;color:#607067;font-size:13px;line-height:1.5">This invitation expires ${escapeHtml(expiresAt)}.</p>
          </div>
        </div>
      </body></html>`,
  });
}

async function applyStripeBillingEvent(
  database: D1Database,
  eventId: string,
  eventType: string,
  event: Record<string, unknown>,
): Promise<"processed" | "ignored"> {
  const data = objectValue(event.data);
  const providerObject = objectValue(data?.object);
  if (!providerObject) return "ignored";

  if (eventType === "checkout.session.completed") {
    const providerCheckoutId = readStringProperty(providerObject, "id");
    const metadata = objectValue(providerObject.metadata);
    const checkoutId = readStringProperty(providerObject, "client_reference_id")
      ?? readStringProperty(metadata, "checkout_id");
    if (!providerCheckoutId || !checkoutId) return "ignored";
    const checkout = await database.prepare(`
      SELECT * FROM billing_checkout_sessions
      WHERE id = ? AND payment_provider = 'stripe'
    `).bind(checkoutId).first<BillingCheckoutRow>();
    if (!checkout) return "ignored";
    if (
      checkout.provider_checkout_id &&
      checkout.provider_checkout_id !== providerCheckoutId
    ) {
      throw new Error("Checkout event does not match the recorded provider session");
    }
    const paymentStatus = readStringProperty(providerObject, "payment_status") ?? "unpaid";
    const providerCustomerId = expandableProviderId(providerObject.customer);
    const providerSubscriptionId = expandableProviderId(providerObject.subscription);
    await database.prepare(`
      UPDATE billing_checkout_sessions
      SET status = 'complete', provider_checkout_id = ?,
        provider_customer_id = ?, provider_subscription_id = ?,
        payment_status = ?, completed_at = datetime('now'),
        updated_at = datetime('now'), last_error = NULL
      WHERE id = ?
    `).bind(
      providerCheckoutId,
      providerCustomerId,
      providerSubscriptionId,
      paymentStatus,
      checkout.id,
    ).run();
    return "processed";
  }

  if (eventType === "checkout.session.expired") {
    const providerCheckoutId = readStringProperty(providerObject, "id");
    if (!providerCheckoutId) return "ignored";
    const result = await database.prepare(`
      UPDATE billing_checkout_sessions
      SET status = 'expired', updated_at = datetime('now')
      WHERE payment_provider = 'stripe' AND provider_checkout_id = ?
        AND status IN ('pending', 'open')
    `).bind(providerCheckoutId).run();
    return (result.meta.changes ?? 0) > 0 ? "processed" : "ignored";
  }

  if (eventType === "invoice.paid") {
    const providerInvoiceId = readStringProperty(providerObject, "id");
    const providerSubscriptionId = stripeInvoiceSubscriptionId(providerObject);
    const checkoutId = stripeInvoiceCheckoutId(providerObject);
    const checkout = await findBillingCheckout(
      database,
      checkoutId,
      providerSubscriptionId,
    );
    if (!checkout || !providerInvoiceId || !providerSubscriptionId) return "ignored";
    const period = stripeInvoicePeriod(providerObject);
    if (!period) throw new Error("Paid Stripe invoice omitted its service period");
    const amountPaid = readIntegerProperty(providerObject, "amount_paid");
    const currency = readStringProperty(providerObject, "currency")?.toUpperCase();
    if (amountPaid === null || !currency) {
      throw new Error("Paid Stripe invoice omitted amount or currency evidence");
    }
    if (amountPaid !== checkout.amount_cents || currency !== checkout.currency.toUpperCase()) {
      throw new Error("Paid Stripe invoice does not match the recorded checkout amount");
    }
    const providerCustomerId = expandableProviderId(providerObject.customer)
      ?? checkout.provider_customer_id;
    const localSubscription = await database.prepare(`
      SELECT id FROM project_hosting_subscriptions
      WHERE project_id = ? AND organisation_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(
      checkout.project_id,
      checkout.organisation_id,
    ).first<{ id: string }>();
    const subscriptionId = localSubscription?.id ?? crypto.randomUUID();
    const paidAt = stripeInvoicePaidAt(providerObject) ?? new Date().toISOString();
    const invoiceId = crypto.randomUUID();
    const statements = [
      localSubscription
        ? database.prepare(`
            UPDATE project_hosting_subscriptions
            SET plan_code = ?, status = 'active', current_period_start = ?,
              current_period_end = ?, renews_automatically = 1,
              archive_on_expiry = ?, payment_provider = 'stripe',
              provider_subscription_id = ?, provider_customer_id = ?,
              activated_at = COALESCE(activated_at, ?),
              provider_cancel_at_period_end = 0, updated_at = datetime('now')
            WHERE id = ? AND organisation_id = ?
          `).bind(
            checkout.plan_code,
            period.start,
            period.end,
            checkout.archive_on_expiry,
            providerSubscriptionId,
            providerCustomerId,
            paidAt,
            subscriptionId,
            checkout.organisation_id,
          )
        : database.prepare(`
            INSERT INTO project_hosting_subscriptions (
              id, organisation_id, project_id, plan_code, status,
              current_period_start, current_period_end, renews_automatically,
              archive_on_expiry, created_by, payment_provider,
              provider_subscription_id, provider_customer_id, activated_at
            ) VALUES (?, ?, ?, ?, 'active', ?, ?, 1, ?, ?, 'stripe', ?, ?, ?)
          `).bind(
            subscriptionId,
            checkout.organisation_id,
            checkout.project_id,
            checkout.plan_code,
            period.start,
            period.end,
            checkout.archive_on_expiry,
            checkout.created_by,
            providerSubscriptionId,
            providerCustomerId,
            paidAt,
          ),
      database.prepare(`
        INSERT OR IGNORE INTO billing_invoices (
          id, organisation_id, project_id, subscription_id, status, currency,
          amount_cents, period_start, period_end, due_at, paid_at,
          payment_provider, provider_invoice_id, provider_payment_intent_id,
          provider_event_id
        ) VALUES (?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, 'stripe', ?, ?, ?)
      `).bind(
        invoiceId,
        checkout.organisation_id,
        checkout.project_id,
        subscriptionId,
        currency,
        amountPaid,
        period.start,
        period.end,
        paidAt,
        paidAt,
        providerInvoiceId,
        stripeInvoicePaymentIntentId(providerObject),
        eventId,
      ),
      database.prepare(`
        UPDATE billing_invoices
        SET status = 'paid', amount_cents = ?, currency = ?,
          period_start = ?, period_end = ?, due_at = ?, paid_at = ?,
          provider_payment_intent_id = ?, provider_event_id = ?
        WHERE payment_provider = 'stripe' AND provider_invoice_id = ?
      `).bind(
        amountPaid,
        currency,
        period.start,
        period.end,
        paidAt,
        paidAt,
        stripeInvoicePaymentIntentId(providerObject),
        eventId,
        providerInvoiceId,
      ),
      database.prepare(`
        UPDATE billing_checkout_sessions
        SET status = 'complete', payment_status = 'paid',
          provider_customer_id = ?, provider_subscription_id = ?,
          completed_at = COALESCE(completed_at, datetime('now')),
          updated_at = datetime('now'), last_error = NULL
        WHERE id = ?
      `).bind(providerCustomerId, providerSubscriptionId, checkout.id),
    ];
    await database.batch(statements);
    return "processed";
  }

  if (eventType === "invoice.payment_failed") {
    const providerSubscriptionId = stripeInvoiceSubscriptionId(providerObject);
    if (!providerSubscriptionId) return "ignored";
    const result = await database.prepare(`
      UPDATE project_hosting_subscriptions
      SET status = 'past_due', updated_at = datetime('now')
      WHERE payment_provider = 'stripe' AND provider_subscription_id = ?
    `).bind(providerSubscriptionId).run();
    return (result.meta.changes ?? 0) > 0 ? "processed" : "ignored";
  }

  if (eventType === "customer.subscription.deleted") {
    const providerSubscriptionId = readStringProperty(providerObject, "id");
    if (!providerSubscriptionId) return "ignored";
    const result = await database.prepare(`
      UPDATE project_hosting_subscriptions
      SET status = 'cancelled', renews_automatically = 0,
        provider_cancel_at_period_end = 1, updated_at = datetime('now')
      WHERE payment_provider = 'stripe' AND provider_subscription_id = ?
    `).bind(providerSubscriptionId).run();
    return (result.meta.changes ?? 0) > 0 ? "processed" : "ignored";
  }

  if (eventType === "customer.subscription.updated") {
    const providerSubscriptionId = readStringProperty(providerObject, "id");
    const providerStatus = readStringProperty(providerObject, "status");
    if (!providerSubscriptionId || !providerStatus) return "ignored";
    const localStatus = stripeSubscriptionStatus(providerStatus);
    const cancelAtPeriodEnd = providerObject.cancel_at_period_end === true;
    const periodEnd = stripeSubscriptionPeriodEnd(providerObject);
    const result = await database.prepare(`
      UPDATE project_hosting_subscriptions
      SET status = ?, renews_automatically = ?,
        provider_cancel_at_period_end = ?,
        current_period_end = COALESCE(?, current_period_end),
        updated_at = datetime('now')
      WHERE payment_provider = 'stripe' AND provider_subscription_id = ?
    `).bind(
      localStatus,
      localStatus === "active" && !cancelAtPeriodEnd ? 1 : 0,
      cancelAtPeriodEnd ? 1 : 0,
      periodEnd,
      providerSubscriptionId,
    ).run();
    return (result.meta.changes ?? 0) > 0 ? "processed" : "ignored";
  }

  return "ignored";
}

async function findBillingCheckout(
  database: D1Database,
  checkoutId: string | null,
  providerSubscriptionId: string | null,
): Promise<BillingCheckoutRow | null> {
  if (checkoutId) {
    const byId = await database.prepare(`
      SELECT * FROM billing_checkout_sessions
      WHERE id = ? AND payment_provider = 'stripe'
    `).bind(checkoutId).first<BillingCheckoutRow>();
    if (byId) return byId;
  }
  if (!providerSubscriptionId) return null;
  return database.prepare(`
    SELECT * FROM billing_checkout_sessions
    WHERE provider_subscription_id = ? AND payment_provider = 'stripe'
    ORDER BY created_at DESC LIMIT 1
  `).bind(providerSubscriptionId).first<BillingCheckoutRow>();
}

function stripeInvoiceSubscriptionId(invoice: Record<string, unknown>): string | null {
  const direct = expandableProviderId(invoice.subscription);
  if (direct) return direct;
  const parent = objectValue(invoice.parent);
  const details = objectValue(parent?.subscription_details);
  return expandableProviderId(details?.subscription);
}

function stripeInvoiceCheckoutId(invoice: Record<string, unknown>): string | null {
  const parent = objectValue(invoice.parent);
  const details = objectValue(parent?.subscription_details);
  const metadata = objectValue(details?.metadata);
  return readStringProperty(metadata, "checkout_id");
}

function stripeInvoicePeriod(
  invoice: Record<string, unknown>,
): { start: string; end: string } | null {
  const lines = objectValue(invoice.lines);
  const data = Array.isArray(lines?.data) ? lines.data : [];
  for (const line of data) {
    const period = objectValue(objectValue(line)?.period);
    const start = readIntegerProperty(period, "start");
    const end = readIntegerProperty(period, "end");
    if (start !== null && end !== null && end > start) {
      return {
        start: new Date(start * 1000).toISOString(),
        end: new Date(end * 1000).toISOString(),
      };
    }
  }
  return null;
}

function stripeInvoicePaidAt(invoice: Record<string, unknown>): string | null {
  const transitions = objectValue(invoice.status_transitions);
  const paidAt = readIntegerProperty(transitions, "paid_at");
  return paidAt === null ? null : new Date(paidAt * 1000).toISOString();
}

function stripeInvoicePaymentIntentId(invoice: Record<string, unknown>): string | null {
  const direct = expandableProviderId(invoice.payment_intent);
  if (direct) return direct;
  const payments = objectValue(invoice.payments);
  const data = Array.isArray(payments?.data) ? payments.data : [];
  for (const payment of data) {
    const paymentRecord = objectValue(payment);
    const paymentObject = objectValue(paymentRecord?.payment);
    const id = expandableProviderId(paymentObject?.payment_intent);
    if (id) return id;
  }
  return null;
}

function stripeSubscriptionStatus(
  providerStatus: string,
): "trial" | "active" | "past_due" | "cancelled" | "expired" {
  if (providerStatus === "trialing") return "trial";
  if (providerStatus === "active") return "active";
  if (providerStatus === "canceled") return "cancelled";
  if (providerStatus === "incomplete_expired") return "expired";
  return "past_due";
}

function stripeSubscriptionPeriodEnd(subscription: Record<string, unknown>): string | null {
  const direct = readIntegerProperty(subscription, "current_period_end");
  if (direct !== null) return new Date(direct * 1000).toISOString();
  const items = objectValue(subscription.items);
  const data = Array.isArray(items?.data) ? items.data : [];
  let latest: number | null = null;
  for (const item of data) {
    const periodEnd = readIntegerProperty(objectValue(item), "current_period_end");
    if (periodEnd !== null && (latest === null || periodEnd > latest)) latest = periodEnd;
  }
  return latest === null ? null : new Date(latest * 1000).toISOString();
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function expandableProviderId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  return readStringProperty(objectValue(value), "id");
}

function readIntegerProperty(value: unknown, property: string): number | null {
  const candidate = objectValue(value)?.[property];
  return typeof candidate === "number" && Number.isInteger(candidate) ? candidate : null;
}

function readFiniteNumber(value: unknown, property: string): number | null {
  const candidate = objectValue(value)?.[property];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

type LifecycleTrigger = "scheduled" | "manual";
type LifecycleSummary = {
  invitationsExpired: number;
  oidcAttemptsDeleted: number;
  otpChallengesDeleted: number;
  rateLimitWindowsDeleted: number;
  refreshHistoryDeleted: number;
  releasesExpired: number;
  subscriptionsPastDue: number;
  subscriptionsExpired: number;
  projectsArchived: number;
  assetsDeleted: number;
  notificationsSent: number;
  notificationFailures: number;
};

async function runLifecycleEnforcement(
  env: Env,
  triggerType: LifecycleTrigger,
): Promise<{ runId: string; status: "succeeded"; summary: LifecycleSummary }> {
  const runId = crypto.randomUUID();
  const summary: LifecycleSummary = {
    invitationsExpired: 0,
    oidcAttemptsDeleted: 0,
    otpChallengesDeleted: 0,
    rateLimitWindowsDeleted: 0,
    refreshHistoryDeleted: 0,
    releasesExpired: 0,
    subscriptionsPastDue: 0,
    subscriptionsExpired: 0,
    projectsArchived: 0,
    assetsDeleted: 0,
    notificationsSent: 0,
    notificationFailures: 0,
  };
  await env.DB.prepare(`
    INSERT INTO lifecycle_runs (id, trigger_type, status)
    VALUES (?, ?, 'running')
  `).bind(runId, triggerType).run();
  try {
    const expiredInvitations = await env.DB.prepare(`
      SELECT id, organisation_id, project_id FROM project_invitations
      WHERE status = 'pending' AND expires_at <= datetime('now') LIMIT 500
    `).all<{ id: string; organisation_id: string; project_id: string }>();
    for (const invitation of expiredInvitations.results) {
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE project_invitations SET status = 'expired'
          WHERE id = ? AND status = 'pending'
        `).bind(invitation.id),
        lifecycleActionStatement(env.DB, runId, invitation.organisation_id, invitation.project_id,
          "invitation_expired", "project_invitation", invitation.id),
      ]);
      summary.invitationsExpired += 1;
    }

    const expiredTeamInvitations = await env.DB.prepare(`
      SELECT oi.id, oi.organisation_id, u.id AS user_id
      FROM organisation_invitations oi
      JOIN users u ON lower(u.email) = lower(oi.email)
      WHERE oi.status = 'pending' AND oi.expires_at <= datetime('now')
      LIMIT 500
    `).all<{ id: string; organisation_id: string; user_id: string }>();
    for (const invitation of expiredTeamInvitations.results) {
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE organisation_invitations SET status = 'expired'
          WHERE id = ? AND status = 'pending'
        `).bind(invitation.id),
        env.DB.prepare(`
          UPDATE memberships
          SET status = 'revoked', revoked_at = COALESCE(revoked_at, datetime('now')),
            updated_at = datetime('now')
          WHERE organisation_id = ? AND user_id = ? AND status = 'invited'
            AND NOT EXISTS (
              SELECT 1 FROM organisation_invitations pending
              JOIN users invited_user ON lower(invited_user.email) = lower(pending.email)
              WHERE pending.organisation_id = memberships.organisation_id
                AND invited_user.id = memberships.user_id
                AND pending.status = 'pending' AND pending.expires_at > datetime('now')
            )
        `).bind(invitation.organisation_id, invitation.user_id),
        lifecycleActionStatement(env.DB, runId, invitation.organisation_id, null,
          "invitation_expired", "organisation_invitation", invitation.id),
      ]);
      summary.invitationsExpired += 1;
    }

    const expiredOidcAttempts = await env.DB.prepare(`
      SELECT id FROM oidc_login_attempts
      WHERE expires_at <= datetime('now', '-1 day')
      ORDER BY expires_at LIMIT 500
    `).all<{ id: string }>();
    if (expiredOidcAttempts.results.length) {
      const placeholders = expiredOidcAttempts.results.map(() => "?").join(",");
      const deleted = await env.DB.prepare(`
        DELETE FROM oidc_login_attempts WHERE id IN (${placeholders})
      `).bind(...expiredOidcAttempts.results.map((attempt) => attempt.id)).run();
      summary.oidcAttemptsDeleted = deleted.meta.changes ?? 0;
    }

    const expiredOtpChallenges = await env.DB.prepare(`
      DELETE FROM auth_otp_challenges
      WHERE id IN (
        SELECT id FROM auth_otp_challenges
        WHERE expires_at <= datetime('now', '-7 days')
        ORDER BY expires_at
        LIMIT 500
      )
    `).run();
    summary.otpChallengesDeleted = expiredOtpChallenges.meta.changes ?? 0;

    const expiredRateLimitWindows = await env.DB.prepare(`
      DELETE FROM rate_limits
      WHERE rowid IN (
        SELECT rowid FROM rate_limits
        WHERE window_start <= unixepoch('now') - 172800
        ORDER BY window_start
        LIMIT 1000
      )
    `).run();
    summary.rateLimitWindowsDeleted = expiredRateLimitWindows.meta.changes ?? 0;

    const expiredRefreshHistory = await env.DB.prepare(`
      DELETE FROM auth_refresh_token_history
      WHERE token_hash IN (
        SELECT history.token_hash
        FROM auth_refresh_token_history history
        JOIN auth_sessions session ON session.id = history.session_id
        WHERE history.used_at <= datetime('now', '-31 days')
          AND (session.revoked_at IS NOT NULL OR session.expires_at <= datetime('now'))
        ORDER BY history.used_at
        LIMIT 500
      )
    `).run();
    summary.refreshHistoryDeleted = expiredRefreshHistory.meta.changes ?? 0;

    const expiredReleases = await env.DB.prepare(`
      SELECT r.id, r.organisation_id, r.project_id FROM releases r
      WHERE r.revoked_at IS NULL AND r.expires_at IS NOT NULL
        AND r.expires_at <= datetime('now') LIMIT 500
    `).all<{ id: string; organisation_id: string; project_id: string }>();
    for (const release of expiredReleases.results) {
      await env.DB.batch([
        env.DB.prepare("UPDATE releases SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").bind(release.id),
        env.DB.prepare(`
          UPDATE release_channels SET active_release_id = NULL, updated_at = datetime('now')
          WHERE active_release_id = ?
        `).bind(release.id),
        lifecycleActionStatement(env.DB, runId, release.organisation_id, release.project_id,
          "release_expired", "release", release.id),
      ]);
      summary.releasesExpired += 1;
    }

    const dueSubscriptions = await env.DB.prepare(`
      SELECT id, organisation_id, project_id, renews_automatically, archive_on_expiry
      FROM project_hosting_subscriptions
      WHERE status IN ('trial', 'active') AND current_period_end <= datetime('now')
      LIMIT 500
    `).all<{
      id: string;
      organisation_id: string;
      project_id: string;
      renews_automatically: number;
      archive_on_expiry: number;
    }>();
    for (const subscription of dueSubscriptions.results) {
      const status = subscription.renews_automatically ? "past_due" : "expired";
      const action = subscription.renews_automatically ? "subscription_past_due" : "subscription_expired";
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE project_hosting_subscriptions SET status = ?, updated_at = datetime('now')
          WHERE id = ? AND status IN ('trial', 'active')
        `).bind(status, subscription.id),
        lifecycleActionStatement(env.DB, runId, subscription.organisation_id, subscription.project_id,
          action, "hosting_subscription", subscription.id),
      ]);
      if (subscription.renews_automatically) summary.subscriptionsPastDue += 1;
      else summary.subscriptionsExpired += 1;

      if (subscription.archive_on_expiry) {
        const project = await env.DB.prepare(`
          SELECT status FROM projects WHERE id = ? AND organisation_id = ?
        `).bind(subscription.project_id, subscription.organisation_id).first<{ status: string }>();
        if (project && project.status !== "ARCHIVED") {
          await env.DB.batch([
            env.DB.prepare(`
              UPDATE projects SET archived_from_status = status, status = 'ARCHIVED',
                updated_at = datetime('now') WHERE id = ? AND organisation_id = ?
            `).bind(subscription.project_id, subscription.organisation_id),
            env.DB.prepare(`
              UPDATE releases SET revoked_at = datetime('now')
              WHERE project_id = ? AND organisation_id = ? AND revoked_at IS NULL
            `).bind(subscription.project_id, subscription.organisation_id),
            env.DB.prepare(`
              UPDATE release_channels SET active_release_id = NULL, updated_at = datetime('now')
              WHERE project_id = ? AND organisation_id = ?
            `).bind(subscription.project_id, subscription.organisation_id),
            lifecycleActionStatement(env.DB, runId, subscription.organisation_id, subscription.project_id,
              "project_archived", "project", subscription.project_id, { reason: "hosting_expired" }),
          ]);
          summary.projectsArchived += 1;
        }
      }
    }

    const retainedAssets = await env.DB.prepare(`
      SELECT a.id, a.organisation_id, a.project_id, a.kind, a.object_key, a.created_at,
        rp.raw_retention_days, rp.derivative_retention_days, rp.release_retention_days,
        rp.delete_after
      FROM assets a
      JOIN projects p ON p.id = a.project_id
      JOIN project_retention_policies rp ON rp.project_id = a.project_id
      WHERE a.deleted_at IS NULL AND rp.legal_hold = 0 AND p.status = 'ARCHIVED'
      ORDER BY a.created_at LIMIT 500
    `).all<{
      id: string;
      organisation_id: string;
      project_id: string;
      kind: string;
      object_key: string;
      created_at: string;
      raw_retention_days: number;
      derivative_retention_days: number;
      release_retention_days: number;
      delete_after: string | null;
    }>();
    const now = Date.now();
    for (const asset of retainedAssets.results) {
      const retentionDays = asset.kind === "source"
        ? asset.raw_retention_days
        : asset.kind === "web" || asset.kind === "poster"
          ? asset.release_retention_days
          : asset.derivative_retention_days;
      const retentionDeadline = Date.parse(asset.created_at) + retentionDays * 86_400_000;
      const explicitDeadline = asset.delete_after ? Date.parse(asset.delete_after) : Number.POSITIVE_INFINITY;
      if (Math.min(retentionDeadline, explicitDeadline) > now) continue;
      const reason = explicitDeadline <= now ? "project_delete_after" : `${asset.kind}_retention_elapsed`;
      await env.SPATIAL_ASSETS.delete(asset.object_key);
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE assets SET deleted_at = datetime('now'), deletion_reason = ?
          WHERE id = ? AND deleted_at IS NULL
        `).bind(reason, asset.id),
        env.DB.prepare(`
          UPDATE releases SET revoked_at = COALESCE(revoked_at, datetime('now'))
          WHERE web_asset_id = ? OR poster_asset_id = ?
        `).bind(asset.id, asset.id),
        lifecycleActionStatement(env.DB, runId, asset.organisation_id, asset.project_id,
          "asset_deleted", "asset", asset.id, { reason, objectKey: asset.object_key }),
      ]);
      summary.assetsDeleted += 1;
    }

    const actionOrganisations = await env.DB.prepare(`
      SELECT DISTINCT organisation_id FROM lifecycle_actions
      WHERE run_id = ? AND action NOT IN ('notification_sent', 'notification_failed')
    `).bind(runId).all<{ organisation_id: string }>();
    for (const item of actionOrganisations.results) {
      try {
        await sendLifecycleDigestEmail(env, summary, runId);
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO notification_deliveries
              (id, organisation_id, channel, template, recipient, status, sent_at)
            VALUES (?, ?, 'email', 'lifecycle_digest', ?, 'sent', datetime('now'))
          `).bind(crypto.randomUUID(), item.organisation_id, env.ADMIN_EMAIL),
          lifecycleActionStatement(env.DB, runId, item.organisation_id, null,
            "notification_sent", "lifecycle_run", runId),
        ]);
        summary.notificationsSent += 1;
      } catch (error) {
        const message = errorMessage(error).slice(0, 500);
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO notification_deliveries
              (id, organisation_id, channel, template, recipient, status, error_message)
            VALUES (?, ?, 'email', 'lifecycle_digest', ?, 'failed', ?)
          `).bind(crypto.randomUUID(), item.organisation_id, env.ADMIN_EMAIL, message),
          lifecycleActionStatement(env.DB, runId, item.organisation_id, null,
            "notification_failed", "lifecycle_run", runId, { error: message }),
        ]);
        summary.notificationFailures += 1;
      }
    }
    await env.DB.prepare(`
      UPDATE lifecycle_runs SET status = 'succeeded', summary_json = ?,
        completed_at = datetime('now') WHERE id = ?
    `).bind(JSON.stringify(summary), runId).run();
    return { runId, status: "succeeded", summary };
  } catch (error) {
    await env.DB.prepare(`
      UPDATE lifecycle_runs SET status = 'failed', error_message = ?,
        completed_at = datetime('now') WHERE id = ?
    `).bind(errorMessage(error).slice(0, 1000), runId).run();
    throw error;
  }
}

function lifecycleActionStatement(
  database: D1Database,
  runId: string,
  organisationId: string,
  projectId: string | null,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
): D1PreparedStatement {
  return database.prepare(`
    INSERT INTO lifecycle_actions
      (id, run_id, organisation_id, project_id, action, resource_type, resource_id, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    runId,
    organisationId,
    projectId,
    action,
    resourceType,
    resourceId,
    JSON.stringify(metadata),
  );
}

async function sendLifecycleDigestEmail(env: Env, summary: LifecycleSummary, runId: string): Promise<void> {
  const lines = [
    `Lifecycle run ${runId} completed.`,
    `Invitations expired: ${summary.invitationsExpired}`,
    `Expired OIDC attempts deleted: ${summary.oidcAttemptsDeleted}`,
    `Expired OTP challenges deleted: ${summary.otpChallengesDeleted}`,
    `Expired rate-limit windows deleted: ${summary.rateLimitWindowsDeleted}`,
    `Expired refresh-token history deleted: ${summary.refreshHistoryDeleted}`,
    `Releases expired: ${summary.releasesExpired}`,
    `Subscriptions past due: ${summary.subscriptionsPastDue}`,
    `Subscriptions expired: ${summary.subscriptionsExpired}`,
    `Projects archived: ${summary.projectsArchived}`,
    `Assets deleted: ${summary.assetsDeleted}`,
  ];
  await env.EMAIL.send({
    to: env.ADMIN_EMAIL,
    from: { email: env.EMAIL_FROM, name: "Spatial Studio" },
    subject: "Spatial Studio lifecycle actions completed",
    text: lines.join("\n"),
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17231d">
      <h1>Lifecycle actions completed</h1>
      <p>Run <code>${escapeHtml(runId)}</code> completed with the following audited actions.</p>
      <ul>${lines.slice(1).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
      <p><a href="${env.APP_ORIGIN}/studio.html#hosting">Open the hosting workspace</a></p>
    </body></html>`,
  });
}

async function authSecurityEvent(
  context: Context<AppEnvironment>,
  eventType: string,
  emailHash: string | null,
  userId: string | null,
  sessionId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await context.env.DB.prepare(`
    INSERT INTO auth_security_events
      (id, event_type, email_hash, user_id, session_id, request_id, ip_address, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    eventType,
    emailHash,
    userId,
    sessionId,
    context.get("requestId"),
    context.req.header("CF-Connecting-IP") ?? null,
    JSON.stringify(metadata),
  ).run();
}

async function audit(
  context: Context<AppEnvironment>,
  auth: AuthContext,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await context.env.DB.prepare(`
    INSERT INTO audit_events
      (id, organisation_id, actor_user_id, action, resource_type, resource_id, request_id, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    auth.organisationId,
    auth.userId,
    action,
    resourceType,
    resourceId,
    context.get("requestId"),
    JSON.stringify(metadata),
  ).run();
}

async function auditUploadPrincipal(
  context: Context<AppEnvironment>,
  principal: UploadPrincipal,
  action: "upload.create" | "upload.complete" | "upload.abort",
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  if (principal.kind === "human") {
    await audit(context, principal.auth, action, resourceType, resourceId, metadata);
    return;
  }
  await context.env.DB.prepare(`
    INSERT INTO audit_events
      (id, organisation_id, actor_user_id, action, resource_type, resource_id,
        request_id, metadata_json)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    principal.organisationId,
    `capture_agent.${action}`,
    resourceType,
    resourceId,
    context.get("requestId"),
    JSON.stringify({
      credentialId: principal.credentialId,
      credentialName: principal.credentialName,
      generation: principal.generation,
      ...metadata,
    }),
  ).run();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

async function allowRate(database: D1Database, bucket: string, subject: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const result = await database.prepare(`
    INSERT INTO rate_limits (bucket, subject, window_start, request_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(bucket, subject, window_start)
    DO UPDATE SET request_count = request_count + 1
    RETURNING request_count
  `).bind(bucket, subject, windowStart).first<{ request_count: number }>();
  return (result?.request_count ?? limit + 1) <= limit;
}

async function serveStaticEntry(context: Context<AppEnvironment>, path: string): Promise<Response> {
  const target = new URL(path, context.req.url);
  const request = new Request(target, { method: "GET", headers: context.req.raw.headers });
  return context.env.STATIC_ASSETS.fetch(request);
}

function customDomainUnavailable(
  context: Context<AppEnvironment>,
  message: string,
  status: 404 | 503,
): Response {
  const requestId = escapeHtml(context.get("requestId"));
  return context.html(`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Spatial scene unavailable</title>
        <style>
          :root{color-scheme:dark;font-family:Arial,sans-serif;background:#0d0f0e;color:#f4f3e8}
          body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;box-sizing:border-box}
          main{max-width:560px;border:1px solid #394039;border-radius:24px;padding:32px;background:#151916}
          p{color:#b8beb8;line-height:1.6}small{color:#818981}
        </style>
      </head>
      <body><main>
        <small>SPATIAL STUDIO</small>
        <h1>Scene not available yet.</h1>
        <p>${escapeHtml(message)}</p>
        <small>Request reference: ${requestId}</small>
      </main></body>
    </html>`, status);
}

function publicProject(
  project: ProjectRow,
  customFields: Record<string, ProjectCustomFieldValue> = {},
): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    status: project.status,
    captureAdapter: project.capture_adapter,
    deliveryTemplate: project.delivery_template,
    notes: project.notes,
    customerName: project.customer_name,
    customFields,
    latestVersionId: project.latest_version_id,
    latestVersionNumber: project.latest_version_number,
    activeReleaseSlug: project.active_release_slug,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

function publicAuthContext(auth: AuthContext): AuthContext {
  return {
    userId: auth.userId,
    organisationId: auth.organisationId,
    email: auth.email,
    displayName: auth.displayName,
    role: auth.role,
  };
}

function publicIdentityProvider(
  provider: EnterpriseIdentityProviderRow,
  secretConfigured: boolean,
): Record<string, unknown> {
  return {
    id: provider.id,
    name: provider.name,
    issuer: provider.issuer,
    clientId: provider.client_id,
    emailDomains: identityProviderDomains(provider),
    status: provider.status,
    secretConfigured,
    discovery: provider.discovery_json ? parseStoredObject(provider.discovery_json) : null,
    discoveryCheckedAt: provider.discovery_checked_at,
    lastError: provider.last_error,
    createdAt: provider.created_at,
    updatedAt: provider.updated_at,
  };
}

function oidcClientSecrets(env: Env): Record<string, string> {
  if (!env.OIDC_CLIENT_SECRETS || env.OIDC_CLIENT_SECRETS.length > 64_000) return {};
  try {
    const value: unknown = JSON.parse(env.OIDC_CLIENT_SECRETS);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, secret]) =>
          key.length <= 100 &&
          typeof secret === "string" &&
          secret.length >= 8 &&
          secret.length <= 4096
        )
        .map(([key, secret]) => [key, secret as string]),
    );
  } catch {
    return {};
  }
}

function identityProviderDomains(provider: EnterpriseIdentityProviderRow): string[] {
  return parseIdentityDomains(provider.email_domains_json);
}

function parseIdentityDomains(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((domain): domain is string =>
        typeof domain === "string" &&
        /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
      )
      : [];
  } catch {
    return [];
  }
}

function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

function oidcCallbackUrl(env: Env, providerId: string): string {
  return `${env.APP_ORIGIN}/api/auth/oidc/${encodeURIComponent(providerId)}/callback`;
}

function oidcStateCookie(stateHash: string, maxAgeSeconds: number): string {
  return `spatial_oidc_state=${encodeURIComponent(stateHash)}; Path=/api/auth/oidc; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function expiredOidcStateCookie(): string {
  return "spatial_oidc_state=; Path=/api/auth/oidc; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

function oidcFailureRedirect(
  context: Context<AppEnvironment>,
  errorCode: string,
): Response {
  const safeCode = /^[a-z0-9_]{2,80}$/.test(errorCode) ? errorCode : "login_failed";
  const response = new Response(null, {
    status: 302,
    headers: {
      Location: `${context.env.APP_ORIGIN}/studio.html?sso=error&code=${encodeURIComponent(safeCode)}`,
      "Cache-Control": "no-store",
    },
  });
  response.headers.append("Set-Cookie", expiredOidcStateCookie());
  return response;
}

function asOidcError(error: unknown): OidcError {
  return error instanceof OidcError
    ? error
    : new OidcError("Enterprise identity operation failed", "provider_internal", true);
}

async function recordIdentityProviderError(
  database: D1Database,
  providerId: string,
  error: OidcError,
): Promise<void> {
  await database.prepare(`
    UPDATE enterprise_identity_providers
    SET last_error = ?, discovery_checked_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(`${error.code}: ${error.message}`.slice(0, 500), providerId).run();
}

async function recordOidcAttemptError(
  database: D1Database,
  attemptId: string,
  errorCode: string,
): Promise<void> {
  await database.prepare(`
    UPDATE oidc_login_attempts SET error_code = ?
    WHERE id = ?
  `).bind(errorCode.slice(0, 80), attemptId).run();
}

async function oidcAttemptEncryptionKey(env: Env): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${env.SESSION_PEPPER}:oidc-attempt:v1`),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sealOidcAttemptSecret(env: Env, value: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode("spatial-oidc-attempt-v1"),
    },
    await oidcAttemptEncryptionKey(env),
    new TextEncoder().encode(value),
  );
  return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`;
}

async function openOidcAttemptSecret(env: Env, sealed: string): Promise<string> {
  const segments = sealed.split(".");
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    throw new OidcError("OIDC attempt secret is malformed", "attempt_integrity", false);
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlDecode(segments[0]),
        additionalData: new TextEncoder().encode("spatial-oidc-attempt-v1"),
      },
      await oidcAttemptEncryptionKey(env),
      base64UrlDecode(segments[1]),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new OidcError("OIDC attempt secret could not be opened", "attempt_integrity", false);
  }
}

async function identityProviderForOrganisation(
  database: D1Database,
  organisationId: string,
  providerId: string,
): Promise<EnterpriseIdentityProviderRow | null> {
  return database.prepare(`
    SELECT * FROM enterprise_identity_providers
    WHERE id = ? AND organisation_id = ?
  `).bind(providerId, organisationId).first<EnterpriseIdentityProviderRow>();
}

function publicProjectTemplate(template: ProjectTemplateRow): Record<string, unknown> {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    captureAdapter: template.capture_adapter,
    deliveryTemplate: template.delivery_template,
    notes: template.notes,
    createdAt: template.created_at,
    updatedAt: template.updated_at,
  };
}

function publicProjectSavedView(view: ProjectSavedViewRow): Record<string, unknown> {
  return {
    id: view.id,
    name: view.name,
    filter: JSON.parse(view.filter_json) as Record<string, unknown>,
    isDefault: view.is_default === 1,
    createdAt: view.created_at,
    updatedAt: view.updated_at,
  };
}

async function portfolioPreview(
  database: D1Database,
  organisationId: string,
  manifest: PortfolioManifest,
): Promise<Record<string, unknown>> {
  const fieldPlan = await portfolioManifestFieldPlan(database, organisationId, manifest);
  const existing = await database.prepare(`
    SELECT lower(name) AS normalized_name
    FROM projects WHERE organisation_id = ?
  `).bind(organisationId).all<{ normalized_name: string }>();
  const existingNames = new Set(existing.results.map((project) => project.normalized_name));
  const customerNames = new Set(
    manifest.projects
      .map((project) => project.customerName?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name)),
  );
  const duplicateWorkspaceNames = manifest.projects
    .filter((project) => existingNames.has(project.name.trim().toLowerCase()))
    .map((project) => project.name);
  const duplicateManifestNames = manifest.projects
    .map((project) => project.name.trim().toLowerCase())
    .filter((name, index, names) => names.indexOf(name) !== index);
  const warnings: string[] = [];
  if (duplicateWorkspaceNames.length) {
    warnings.push(
      `${duplicateWorkspaceNames.length} imported project name${duplicateWorkspaceNames.length === 1 ? "" : "s"} already exist; new DRAFT records will still receive unique IDs and slugs.`,
    );
  }
  if (duplicateManifestNames.length) {
    warnings.push(
      `${new Set(duplicateManifestNames).size} project name${new Set(duplicateManifestNames).size === 1 ? "" : "s"} appear more than once in the import file.`,
    );
  }
  if (fieldPlan.fieldsToCreate.length) {
    warnings.push(
      `${fieldPlan.fieldsToCreate.length} project field definition${
        fieldPlan.fieldsToCreate.length === 1 ? "" : "s"
      } will be created in this workspace.`,
    );
  }
  for (const conflict of fieldPlan.conflicts) {
    warnings.push(
      `${conflict.label} (${conflict.key}) is ${conflict.sourceType} in the file but ${conflict.targetType} in this workspace.`,
    );
  }
  warnings.push(...fieldPlan.valueErrors);
  return {
    valid: fieldPlan.conflicts.length === 0 && fieldPlan.valueErrors.length === 0,
    format: manifest.format,
    schemaVersion: manifest.schemaVersion,
    summary: {
      projects: manifest.projects.length,
      customers: customerNames.size,
      existingNameMatches: duplicateWorkspaceNames.length,
      customFields: manifest.fieldDefinitions.length,
      fieldsToCreate: fieldPlan.fieldsToCreate.length,
    },
    warnings,
    conflicts: fieldPlan.conflicts,
    fieldsToCreate: fieldPlan.fieldsToCreate,
    projects: manifest.projects.map((project) => ({
      sourceId: project.sourceId ?? null,
      name: project.name,
      customerName: project.customerName ?? null,
      captureAdapter: project.captureAdapter,
      deliveryTemplate: project.deliveryTemplate,
      targetStatus: "DRAFT",
      nameAlreadyExists: existingNames.has(project.name.trim().toLowerCase()),
    })),
  };
}

async function portfolioManifestFieldPlan(
  database: D1Database,
  organisationId: string,
  manifest: PortfolioManifest,
): Promise<{
  fieldsToCreate: PortfolioManifest["fieldDefinitions"];
  conflicts: Array<{
    key: string;
    label: string;
    sourceType: ProjectCustomFieldType;
    targetType: ProjectCustomFieldType;
  }>;
  valueErrors: string[];
}> {
  const targetFields = await projectCustomFieldDefinitions(database, organisationId, false);
  const targetByKey = new Map(targetFields.map((field) => [field.key, field]));
  const fieldsToCreate = manifest.fieldDefinitions.filter((field) => !targetByKey.has(field.key));
  const conflicts = manifest.fieldDefinitions.flatMap((field) => {
    const target = targetByKey.get(field.key);
    if (!target || target.field_type === field.type) return [];
    return [{
      key: field.key,
      label: field.label,
      sourceType: field.type,
      targetType: target.field_type,
    }];
  });
  const definitions = new Map(manifest.fieldDefinitions.map((field) => [field.key, field]));
  const valueErrors: string[] = [];
  for (const project of manifest.projects) {
    for (const definition of manifest.fieldDefinitions) {
      const value = project.customFields[definition.key];
      if (definition.required && (value === undefined || value === null)) {
        valueErrors.push(`${project.name}: ${definition.label} is required.`);
      }
    }
    for (const [key, value] of Object.entries(project.customFields)) {
      if (value === null) continue;
      const definition = definitions.get(key);
      if (!definition) continue;
      const row: ProjectCustomFieldDefinitionRow = {
        id: "",
        organisation_id: organisationId,
        key: definition.key,
        label: definition.label,
        description: definition.description ?? null,
        field_type: definition.type,
        required: definition.required ? 1 : 0,
        options_json: JSON.stringify(definition.options),
        active: 1,
        sort_order: definition.sortOrder,
        client_operation_id: null,
        request_hash: null,
        created_at: "",
        updated_at: "",
      };
      const error = validateProjectCustomFieldValue(row, value);
      if (error) valueErrors.push(`${project.name}: ${error}.`);
    }
  }
  return {
    fieldsToCreate,
    conflicts,
    valueErrors: [...new Set(valueErrors)].slice(0, 100),
  };
}

function applySecurityHeaders(context: Context<AppEnvironment>): void {
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "strict-origin-when-cross-origin");
  context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  context.header("X-Frame-Options", "SAMEORIGIN");
  context.header("Cross-Origin-Opener-Policy", "same-origin");
  context.header("Cross-Origin-Resource-Policy", "same-origin");
  context.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' data: https://cloudflareinsights.com; worker-src 'self' blob:; frame-src 'self' https://challenges.cloudflare.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
  );
  if (context.env.APP_ENV === "production") context.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function isSameOrigin(context: Context<AppEnvironment>): boolean {
  const origin = context.req.header("Origin");
  return !origin || origin === new URL(context.req.url).origin;
}

function fileNameMatchesFormat(fileName: string, format: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(`.${format}`);
}

function legacyCaptureAdapter(adapter: CaptureAdapterId): Exclude<CaptureAdapterId, "drone-imagery"> {
  return adapter === "drone-imagery" ? "open-import" : adapter;
}

async function readJson(context: Context<AppEnvironment>): Promise<unknown> {
  const contentLength = Number(context.req.header("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 1024 * 1024) {
    throw new Error("JSON request body exceeds 1 MiB");
  }
  const body = await context.req.text();
  if (new TextEncoder().encode(body).byteLength > 1024 * 1024) {
    throw new Error("JSON request body exceeds 1 MiB");
  }
  return JSON.parse(body) as unknown;
}

function parseStoredObject(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function storedPosterCamera(value: string): unknown {
  const provenance = parseStoredObject(value);
  return provenance && typeof provenance === "object"
    ? Reflect.get(provenance, "posterCamera")
    : undefined;
}

function isFloorplanRevisionSequenceConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UNIQUE constraint failed") &&
    message.includes("floorplan_revisions.organisation_id") &&
    message.includes("floorplan_revisions.project_id") &&
    message.includes("floorplan_revisions.version_id") &&
    message.includes("floorplan_revisions.revision_number");
}

type MeasurementFootprint = {
  entityId: string;
  label: string;
  points: Array<[number, number]>;
};

function measurementFootprint(
  row: { id: string; label: string; geometry_json: string },
): MeasurementFootprint | null {
  let geometry: unknown;
  try {
    geometry = JSON.parse(row.geometry_json);
  } catch {
    return null;
  }
  if (!geometry || typeof geometry !== "object") return null;
  const type = Reflect.get(geometry, "type");
  const rawPoints = Reflect.get(geometry, "points");
  if (!Array.isArray(rawPoints)) return null;
  if (type === "box" && rawPoints.length === 2) {
    const first = finitePoint3(rawPoints[0]);
    const second = finitePoint3(rawPoints[1]);
    if (!first || !second) return null;
    const minX = Math.min(first[0], second[0]);
    const maxX = Math.max(first[0], second[0]);
    const minZ = Math.min(first[2], second[2]);
    const maxZ = Math.max(first[2], second[2]);
    if (maxX - minX < 0.05 || maxZ - minZ < 0.05) return null;
    return {
      entityId: row.id,
      label: row.label,
      points: [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]],
    };
  }
  if (type === "polygon" && rawPoints.length >= 3) {
    const points: Array<[number, number]> = [];
    for (const rawPoint of rawPoints) {
      const point = finitePoint3(rawPoint);
      if (!point) return null;
      points.push([point[0], point[2]]);
    }
    const area = Math.abs(points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]!;
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2);
    return area >= 0.0025 ? { entityId: row.id, label: row.label, points } : null;
  }
  return null;
}

function measurementSourceGeometry(footprints: MeasurementFootprint[]): string {
  return JSON.stringify(footprints.map((footprint) => ({
    entityId: footprint.entityId,
    label: footprint.label,
    points: footprint.points,
  })));
}

function polygonArea2(points: Array<[number, number]>): number {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
}

function semanticExtractionApi(run: SemanticExtractionRow): Record<string, unknown> {
  return {
    id: run.id,
    projectId: run.project_id,
    versionId: run.version_id,
    inputAssetId: run.input_asset_id,
    jobId: run.job_id,
    method: run.method,
    status: run.status,
    parameters: parseStoredObject(run.parameters_json),
    summary: run.summary_json ? parseStoredObject(run.summary_json) : null,
    reportAssetId: run.report_asset_id,
    candidateCount: run.candidate_count,
    reviewDecision: run.review_decision,
    reviewNote: run.review_note,
    reviewedAt: run.reviewed_at,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

function semanticCandidateApi(value: unknown): Record<string, unknown> {
  const row = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const {
    elevation_m: elevation,
    area_m2: area,
    world_unit: rawWorldUnit,
    ...rest
  } = row;
  return {
    ...rest,
    elevation,
    area,
    worldUnit: parseWorldUnit(rawWorldUnit),
  };
}

type FloorplanPlan = ReturnType<typeof floorplanReviewPlanSchema.parse>;

function floorplanExtractionApi(run: FloorplanExtractionRow): Record<string, unknown> {
  return {
    id: run.id,
    projectId: run.project_id,
    versionId: run.version_id,
    inputAssetId: run.input_asset_id,
    jobId: run.job_id,
    method: run.method,
    normalizer: run.normalizer,
    status: run.status,
    parameters: parseStoredObject(run.parameters_json),
    sourceEvidence: parseStoredObject(run.source_evidence_json),
    proposal: run.proposal_json ? parseStoredObject(run.proposal_json) : null,
    proposalHash: run.proposal_hash,
    reportAssetId: run.report_asset_id,
    reviewDecision: run.review_decision,
    reviewNote: run.review_note,
    reviewedAt: run.reviewed_at,
    error: run.error_json ? parseStoredObject(run.error_json) : null,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

function floorplanPlanIssue(plan: FloorplanPlan): string | null {
  const identifiers = new Set<string>();
  for (const level of plan.levels) {
    if (identifiers.has(level.id)) return `Duplicate floor-plan identifier: ${level.id}`;
    identifiers.add(level.id);
    const wallIds = new Set<string>();
    for (const room of level.rooms) {
      if (identifiers.has(room.id)) return `Duplicate floor-plan identifier: ${room.id}`;
      identifiers.add(room.id);
      if (polygonArea2(room.points) < 0.01) {
        return `Room ${room.label} has less than 0.01 square metre of enclosed area`;
      }
      if (floorplanPolygonSelfIntersects(room.points)) {
        return `Room ${room.label} has a self-intersecting outline`;
      }
    }
    for (const wall of level.walls) {
      if (identifiers.has(wall.id)) return `Duplicate floor-plan identifier: ${wall.id}`;
      identifiers.add(wall.id);
      wallIds.add(wall.id);
      if (floorplanDistance(wall.start, wall.end) < 0.05) {
        return `Wall ${wall.label} is shorter than 0.05 metre`;
      }
    }
    for (const opening of level.openings) {
      if (identifiers.has(opening.id)) return `Duplicate floor-plan identifier: ${opening.id}`;
      identifiers.add(opening.id);
      const observedWidth = floorplanDistance(opening.start, opening.end);
      if (observedWidth < 0.05) return `Opening ${opening.label} is shorter than 0.05 metre`;
      if (Math.abs(observedWidth - opening.widthM) > Math.max(0.1, opening.widthM * 0.1)) {
        return `Opening ${opening.label} width does not match its endpoints`;
      }
      if (opening.wallId && !wallIds.has(opening.wallId)) {
        return `Opening ${opening.label} refers to a wall outside its level`;
      }
    }
  }
  return null;
}

function floorplanPolygonSelfIntersects(points: Array<[number, number]>): boolean {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (
        first === second ||
        firstNext === second ||
        secondNext === first ||
        (first === 0 && secondNext === 0)
      ) continue;
      if (floorplanSegmentsIntersect(
        points[first]!,
        points[firstNext]!,
        points[second]!,
        points[secondNext]!,
      )) return true;
    }
  }
  return false;
}

function floorplanSegmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const cross = (
    first: [number, number],
    second: [number, number],
    third: [number, number],
  ) => (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0]);
  const first = cross(a, b, c);
  const second = cross(a, b, d);
  const third = cross(c, d, a);
  const fourth = cross(c, d, b);
  return (
    ((first > 0 && second < 0) || (first < 0 && second > 0)) &&
    ((third > 0 && fourth < 0) || (third < 0 && fourth > 0))
  );
}

function floorplanDistance(start: [number, number], end: [number, number]): number {
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}

function floorplanExportApi(row: FloorplanExportRow): Record<string, unknown> {
  return {
    id: row.id,
    revisionId: row.revision_id,
    assetId: row.asset_id,
    format: row.format,
    generatorVersion: row.generator_version,
    planHash: row.plan_hash,
    status: row.status,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdAt: databaseTimestampToIso(row.created_at),
    downloadUrl:
      `/api/projects/${row.project_id}/spatial/floorplan-exports/${row.id}/download`,
  };
}

function databaseTimestampToIso(value: string): string {
  const timestamp = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function floorplanExportBytes(
  plan: FloorplanPlan,
  format: "svg" | "pdf" | "dxf",
  metadata: {
    projectName: string;
    revisionNumber: number;
    planHash: string;
    approvedAt: string;
  },
): { bytes: Uint8Array; mimeType: string } {
  if (format === "svg") {
    return {
      bytes: new TextEncoder().encode(generateIndicativeFloorplanSvg(plan, metadata)),
      mimeType: "image/svg+xml",
    };
  }
  if (format === "dxf") {
    return {
      bytes: new TextEncoder().encode(generateIndicativeFloorplanDxf(plan, metadata)),
      mimeType: "application/dxf",
    };
  }
  return {
    bytes: generateIndicativeFloorplanPdf(plan, metadata),
    mimeType: "application/pdf",
  };
}

function floorplanLevelBounds(level: FloorplanPlan["levels"][number]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const points = [
    ...level.rooms.flatMap((room) => room.points),
    ...level.walls.flatMap((wall) => [wall.start, wall.end]),
    ...level.openings.flatMap((opening) => [opening.start, opening.end]),
  ];
  return {
    minX: Math.min(...points.map((point) => point[0])),
    minY: Math.min(...points.map((point) => point[1])),
    maxX: Math.max(...points.map((point) => point[0])),
    maxY: Math.max(...points.map((point) => point[1])),
  };
}

function generateIndicativeFloorplanSvg(
  plan: FloorplanPlan,
  metadata: {
    projectName: string;
    revisionNumber: number;
    planHash: string;
    approvedAt: string;
  },
): string {
  const scale = 80;
  const padding = 48;
  const titleHeight = 88;
  const levelGap = 80;
  const layouts = plan.levels.map((level) => {
    const bounds = floorplanLevelBounds(level);
    return {
      level,
      bounds,
      width: Math.max(1, bounds.maxX - bounds.minX) * scale + padding * 2,
      height: Math.max(1, bounds.maxY - bounds.minY) * scale + padding * 2 + 36,
    };
  });
  const width = Math.max(720, ...layouts.map((layout) => layout.width));
  const height = titleHeight + layouts.reduce((sum, layout) => sum + layout.height, 0) +
    Math.max(0, layouts.length - 1) * levelGap + 56;
  let offsetY = titleHeight;
  const groups = layouts.map(({ level, bounds, height: levelHeight }) => {
    const x = (value: number) => padding + (value - bounds.minX) * scale;
    const y = (value: number) => padding + (bounds.maxY - value) * scale;
    const roomPaths = level.rooms.map((room) => {
      const points = room.points.map((point) => `${dxfNumber(x(point[0]))},${dxfNumber(y(point[1]))}`).join(" ");
      const centroid = room.points.reduce(
        (sum, point) => [sum[0] + point[0], sum[1] + point[1]] as [number, number],
        [0, 0],
      ).map((value) => value / room.points.length) as [number, number];
      return `<polygon points="${points}" class="room"/><text x="${dxfNumber(x(centroid[0]))}" y="${dxfNumber(y(centroid[1]))}" class="label">${xmlText(room.label)}</text>`;
    }).join("");
    const walls = level.walls.map((wall) =>
      `<line x1="${dxfNumber(x(wall.start[0]))}" y1="${dxfNumber(y(wall.start[1]))}" x2="${dxfNumber(x(wall.end[0]))}" y2="${dxfNumber(y(wall.end[1]))}" class="wall"/>`
    ).join("");
    const openings = level.openings.map((opening) =>
      `<line x1="${dxfNumber(x(opening.start[0]))}" y1="${dxfNumber(y(opening.start[1]))}" x2="${dxfNumber(x(opening.end[0]))}" y2="${dxfNumber(y(opening.end[1]))}" class="opening"/>`
    ).join("");
    const result = `<g transform="translate(0 ${dxfNumber(offsetY)})"><text x="${padding}" y="24" class="level">${xmlText(level.label)} · ${dxfNumber(level.elevationM)} m</text><g transform="translate(0 36)">${roomPaths}${walls}${openings}</g></g>`;
    offsetY += levelHeight + levelGap;
    return result;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" role="img" aria-labelledby="title desc">
  <title id="title">${xmlText(metadata.projectName)} indicative floor plan</title>
  <desc id="desc">Operator-reviewed indicative floor plan; not a survey or construction drawing.</desc>
  <style>
    .room{fill:#f4f1e8;stroke:#b7ad99;stroke-width:1.5}
    .wall{stroke:#171916;stroke-width:8;stroke-linecap:square}
    .opening{stroke:#fff;stroke-width:12;stroke-linecap:butt}
    .opening+*{stroke:#2f786f}
    .label{font:500 13px system-ui,sans-serif;text-anchor:middle;dominant-baseline:middle;fill:#20231f}
    .level{font:700 18px system-ui,sans-serif;fill:#20231f}
    .meta{font:500 12px ui-monospace,monospace;fill:#62675f}
    .watermark{font:800 28px system-ui,sans-serif;letter-spacing:4px;fill:#ad3b2f;opacity:.7}
  </style>
  <rect width="100%" height="100%" fill="#fcfbf7"/>
  <text x="${padding}" y="34" class="level">${xmlText(metadata.projectName)}</text>
  <text x="${padding}" y="58" class="meta">Revision ${metadata.revisionNumber} · approved ${xmlText(metadata.approvedAt)} · SHA-256 ${metadata.planHash.slice(0, 16)}…</text>
  <text x="${width - padding}" y="38" text-anchor="end" class="watermark">INDICATIVE</text>
  ${groups}
  <text x="${padding}" y="${height - 24}" class="meta">Operator-reviewed visual deliverable · metres · not for survey, construction, title, or regulated reliance</text>
</svg>
`;
}

function generateIndicativeFloorplanDxf(
  plan: FloorplanPlan,
  metadata: {
    projectName: string;
    revisionNumber: number;
    planHash: string;
    approvedAt: string;
  },
): string {
  const values = [
    "999", `Whyme Labs indicative floor plan: ${dxfText(metadata.projectName)}`,
    "999", `Revision ${metadata.revisionNumber}; approved ${dxfText(metadata.approvedAt)}`,
    "999", `Plan SHA-256: ${metadata.planHash}`,
    "999", "INDICATIVE ONLY - NOT FOR SURVEY, CONSTRUCTION, TITLE, OR REGULATED RELIANCE",
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "9", "$INSUNITS", "70", "6",
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LAYER", "70", "5",
    ...dxfLayer("ROOM_OUTLINE", 8),
    ...dxfLayer("WALL", 7),
    ...dxfLayer("OPENING", 4),
    ...dxfLayer("LABEL", 3),
    ...dxfLayer("INDICATIVE", 1),
    "0", "ENDTAB", "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
  ];
  for (const level of plan.levels) {
    for (const room of level.rooms) {
      for (let index = 0; index < room.points.length; index += 1) {
        const start = room.points[index]!;
        const end = room.points[(index + 1) % room.points.length]!;
        values.push(...floorplanDxfLine("ROOM_OUTLINE", start, end, level.elevationM));
      }
      const centroid = room.points.reduce(
        (sum, point) => [sum[0] + point[0], sum[1] + point[1]] as [number, number],
        [0, 0],
      ).map((value) => value / room.points.length) as [number, number];
      values.push(
        "0", "TEXT", "8", "LABEL",
        "10", dxfNumber(centroid[0]), "20", dxfNumber(centroid[1]),
        "30", dxfNumber(level.elevationM), "40", "0.25",
        "1", dxfText(room.label), "72", "1", "73", "2",
        "11", dxfNumber(centroid[0]), "21", dxfNumber(centroid[1]),
        "31", dxfNumber(level.elevationM),
      );
    }
    for (const wall of level.walls) {
      values.push(...floorplanDxfLine("WALL", wall.start, wall.end, level.elevationM));
    }
    for (const opening of level.openings) {
      values.push(...floorplanDxfLine("OPENING", opening.start, opening.end, level.elevationM));
    }
  }
  values.push(
    "0", "TEXT", "8", "INDICATIVE",
    "10", "0", "20", "0", "30", "0", "40", "0.35",
    "1", "INDICATIVE - OPERATOR REVIEWED - NOT A SURVEY",
    "0", "ENDSEC", "0", "EOF",
  );
  return `${values.join("\n")}\n`;
}

function floorplanDxfLine(
  layer: string,
  start: [number, number],
  end: [number, number],
  elevationM: number,
): string[] {
  return [
    "0", "LINE", "8", layer,
    "10", dxfNumber(start[0]), "20", dxfNumber(start[1]), "30", dxfNumber(elevationM),
    "11", dxfNumber(end[0]), "21", dxfNumber(end[1]), "31", dxfNumber(elevationM),
  ];
}

function generateIndicativeFloorplanPdf(
  plan: FloorplanPlan,
  metadata: {
    projectName: string;
    revisionNumber: number;
    planHash: string;
    approvedAt: string;
  },
): Uint8Array {
  const pageWidth = 842;
  const pageHeight = 595;
  const pageObjects: Array<{ page: number; content: number; stream: string }> = [];
  for (const [index, level] of plan.levels.entries()) {
    const bounds = floorplanLevelBounds(level);
    const drawingWidth = Math.max(0.1, bounds.maxX - bounds.minX);
    const drawingHeight = Math.max(0.1, bounds.maxY - bounds.minY);
    const scale = Math.min(740 / drawingWidth, 450 / drawingHeight);
    const offsetX = 50 + (740 - drawingWidth * scale) / 2;
    const offsetY = 70 + (450 - drawingHeight * scale) / 2;
    const x = (value: number) => offsetX + (value - bounds.minX) * scale;
    const y = (value: number) => offsetY + (value - bounds.minY) * scale;
    const commands = [
      "0.18 0.20 0.17 RG 0.8 w",
      ...level.rooms.flatMap((room) => {
        const [first, ...rest] = room.points;
        return [
          `${dxfNumber(x(first![0]))} ${dxfNumber(y(first![1]))} m`,
          ...rest.map((point) => `${dxfNumber(x(point[0]))} ${dxfNumber(y(point[1]))} l`),
          "h S",
        ];
      }),
      "0.05 0.06 0.05 RG 4 w",
      ...level.walls.map((wall) =>
        `${dxfNumber(x(wall.start[0]))} ${dxfNumber(y(wall.start[1]))} m ${dxfNumber(x(wall.end[0]))} ${dxfNumber(y(wall.end[1]))} l S`
      ),
      "0.20 0.55 0.50 RG 7 w",
      ...level.openings.map((opening) =>
        `${dxfNumber(x(opening.start[0]))} ${dxfNumber(y(opening.start[1]))} m ${dxfNumber(x(opening.end[0]))} ${dxfNumber(y(opening.end[1]))} l S`
      ),
      "BT /F1 16 Tf 50 555 Td",
      `(${pdfText(metadata.projectName)} - ${pdfText(level.label)}) Tj ET`,
      "BT /F1 9 Tf 50 537 Td",
      `(Revision ${metadata.revisionNumber} | elevation ${dxfNumber(level.elevationM)} m | approved ${pdfText(metadata.approvedAt)}) Tj ET`,
      "1 0.2 0.16 rg BT /F1 18 Tf 650 555 Td (INDICATIVE) Tj ET",
      "0.25 0.27 0.24 rg BT /F1 8 Tf 50 32 Td",
      `(Operator-reviewed visual deliverable | metres | SHA-256 ${metadata.planHash.slice(0, 20)}... | not a survey or construction drawing) Tj ET`,
    ];
    pageObjects.push({
      page: 4 + index * 2,
      content: 5 + index * 2,
      stream: `${commands.join("\n")}\n`,
    });
  }
  const objectCount = 3 + pageObjects.length * 2;
  const objects = new Map<number, string>([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, `<< /Type /Pages /Count ${pageObjects.length} /Kids [${pageObjects.map((entry) => `${entry.page} 0 R`).join(" ")}] >>`],
    [3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
  ]);
  for (const entry of pageObjects) {
    objects.set(
      entry.page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${entry.content} 0 R >>`,
    );
    objects.set(
      entry.content,
      `<< /Length ${new TextEncoder().encode(entry.stream).byteLength} >>\nstream\n${entry.stream}endstream`,
    );
  }
  const chunks: string[] = ["%PDF-1.4\n"];
  const offsets = [0];
  let byteOffset = new TextEncoder().encode(chunks[0]!).byteLength;
  for (let index = 1; index <= objectCount; index += 1) {
    offsets[index] = byteOffset;
    const chunk = `${index} 0 obj\n${objects.get(index)}\nendobj\n`;
    chunks.push(chunk);
    byteOffset += new TextEncoder().encode(chunk).byteLength;
  }
  const xrefOffset = byteOffset;
  const xref = [
    `xref\n0 ${objectCount + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  chunks.push(xref);
  return new TextEncoder().encode(chunks.join(""));
}

function xmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function pdfText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/([\\()])/g, "\\$1")
    .slice(0, 500);
}

function measurementDeliverableApi(row: MeasurementDeliverableRow): {
  id: string;
  briefId: string;
  versionId: string;
  qaReportId: string;
  assetId: string;
  deliverableType: string;
  sourceGeometryHash: string;
  generatorVersion: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  createdAt: string;
  downloadUrl: string;
} {
  return {
    id: row.id,
    briefId: row.brief_id,
    versionId: row.version_id,
    qaReportId: row.qa_report_id,
    assetId: row.asset_id,
    deliverableType: row.deliverable_type,
    sourceGeometryHash: row.source_geometry_hash,
    generatorVersion: row.generator_version,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    status: row.status,
    createdAt: row.created_at,
    downloadUrl: `/api/projects/${row.project_id}/measurement/deliverables/${row.id}/download`,
  };
}

function generateMeasurementDxf(input: {
  footprints: MeasurementFootprint[];
  units: "metres" | "millimetres";
  productType: "measured_floor_plan" | "scan_to_cad";
  intendedUse: string;
  exclusions: string | null;
  coordinateReference: string | null;
  relianceClass: string;
  toleranceMm: number;
  qaReportId: string;
  pointCount: number;
  rmseMm: number;
  maxMm: number;
  sourceGeometryHash: string;
  generatorVersion: string;
}): string {
  const scale = input.units === "millimetres" ? 1000 : 1;
  const unitCode = input.units === "millimetres" ? 4 : 6;
  const values: string[] = [
    "999", `Whyme Labs ${input.productType === "scan_to_cad" ? "Scan-to-CAD" : "Measured floor plan"} draft`,
    "999", `Generator: ${input.generatorVersion}`,
    "999", `QA report: ${input.qaReportId}`,
    "999", `Evidence: ${input.pointCount} independent points; RMSE ${dxfNumber(input.rmseMm)} mm; max ${dxfNumber(input.maxMm)} mm; tolerance ${dxfNumber(input.toleranceMm)} mm`,
    "999", `Reliance: ${dxfText(input.relianceClass)}; intended use: ${dxfText(input.intendedUse)}`,
    "999", `Coordinate reference: ${dxfText(input.coordinateReference ?? "local scene coordinates")}`,
    "999", `Exclusions: ${dxfText(input.exclusions ?? "none stated")}`,
    "999", `Source geometry SHA-256: ${input.sourceGeometryHash}`,
    "0", "SECTION",
    "2", "HEADER",
    "9", "$ACADVER",
    "1", "AC1009",
    "9", "$INSUNITS",
    "70", String(unitCode),
    "0", "ENDSEC",
    "0", "SECTION",
    "2", "TABLES",
    "0", "TABLE",
    "2", "LAYER",
    "70", "2",
    ...dxfLayer("ROOM_OUTLINE", 7),
    ...dxfLayer("ROOM_LABEL", 3),
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION",
    "2", "ENTITIES",
  ];
  for (const footprint of input.footprints) {
    const points = footprint.points.map(([x, y]) => [x * scale, y * scale] as const);
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index]!;
      const end = points[(index + 1) % points.length]!;
      values.push(
        "0", "LINE",
        "8", "ROOM_OUTLINE",
        "10", dxfNumber(start[0]),
        "20", dxfNumber(start[1]),
        "30", "0",
        "11", dxfNumber(end[0]),
        "21", dxfNumber(end[1]),
        "31", "0",
      );
    }
    const centroid = points.reduce(
      (sum, point) => [sum[0] + point[0], sum[1] + point[1]] as [number, number],
      [0, 0] as [number, number],
    ).map((value) => value / points.length) as [number, number];
    values.push(
      "0", "TEXT",
      "8", "ROOM_LABEL",
      "10", dxfNumber(centroid[0]),
      "20", dxfNumber(centroid[1]),
      "30", "0",
      "40", dxfNumber(input.units === "millimetres" ? 250 : 0.25),
      "1", dxfText(footprint.label),
      "72", "1",
      "73", "2",
      "11", dxfNumber(centroid[0]),
      "21", dxfNumber(centroid[1]),
      "31", "0",
    );
  }
  values.push("0", "ENDSEC", "0", "EOF");
  return `${values.join("\n")}\n`;
}

function dxfLayer(name: string, color: number): string[] {
  return ["0", "LAYER", "2", name, "70", "0", "62", String(color), "6", "CONTINUOUS"];
}

function dxfText(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f]+/g, " ").trim().slice(0, 1000);
}

function dxfNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function canonicalSourceToWorldTransform(value: unknown): {
  sourceUpAxis: "Y" | "Z";
  worldUnit: "metres" | "scene_units";
  metresPerSourceUnit: number;
  yawDegrees: number;
  translationMetres: [number, number, number];
} | null {
  if (!value || typeof value !== "object") return null;
  const sourceUpAxis = Reflect.get(value, "sourceUpAxis");
  const metresPerSourceUnit = Number(Reflect.get(value, "metresPerSourceUnit"));
  const yawDegrees = Number(Reflect.get(value, "yawDegrees"));
  const translationMetres = finitePoint3(Reflect.get(value, "translationMetres"));
  if (
    (sourceUpAxis !== "Y" && sourceUpAxis !== "Z") ||
    !Number.isFinite(metresPerSourceUnit) ||
    metresPerSourceUnit <= 0 ||
    !Number.isFinite(yawDegrees) ||
    !translationMetres
  ) return null;
  return {
    sourceUpAxis,
    worldUnit: parseWorldUnit(Reflect.get(value, "worldUnit")),
    metresPerSourceUnit,
    yawDegrees,
    translationMetres,
  };
}

type RuntimeBox = {
  entityId: string;
  label: string;
  min: [number, number, number];
  max: [number, number, number];
};

type RuntimeObstacleBox = {
  entityId: string;
  label: string;
  min: [number, number, number];
  max: [number, number, number];
};

const defaultNavigationProfile = {
  worldUnit: "metres",
  agentRadius: 0.22,
  agentHeight: 1.8,
  eyeHeight: 1.6,
  maxStepMetres: 0.1,
} as const;

async function spatialVersionWorldUnit(
  database: D1Database,
  organisationId: string,
  projectId: string,
  versionId: string,
): Promise<WorldUnit> {
  const profile = await database.prepare(`
    SELECT world_unit
    FROM scene_navigation_profiles
    WHERE organisation_id = ? AND project_id = ? AND version_id = ?
  `).bind(organisationId, projectId, versionId).first<{ world_unit: string }>();
  return parseWorldUnit(profile?.world_unit);
}

async function isMetricSpatialVersion(
  database: D1Database,
  organisationId: string,
  projectId: string,
  versionId: string,
): Promise<boolean> {
  const results = await database.batch([
    database.prepare(`
      SELECT world_unit
      FROM scene_navigation_profiles
      WHERE organisation_id = ? AND project_id = ? AND version_id = ?
    `).bind(organisationId, projectId, versionId),
    database.prepare(`
      SELECT count(*) AS count FROM (
        SELECT id FROM scene_entities
        WHERE organisation_id = ? AND project_id = ? AND version_id = ?
          AND status = 'active' AND world_unit <> 'metres'
        UNION ALL
        SELECT id FROM scene_navigation_obstacles
        WHERE organisation_id = ? AND project_id = ? AND version_id = ?
          AND status = 'active' AND world_unit <> 'metres'
      )
    `).bind(
      organisationId,
      projectId,
      versionId,
      organisationId,
      projectId,
      versionId,
    ),
  ]);
  const profile = requiredBatchResult(results, 0).results[0];
  const incompatible = requiredBatchResult(results, 1).results[0] as
    | { count?: number }
    | undefined;
  return parseWorldUnit(
    profile && typeof profile === "object"
      ? Reflect.get(profile, "world_unit")
      : undefined,
  ) === "metres" && Number(incompatible?.count ?? 0) === 0;
}

async function captureSpatialSnapshot(
  database: D1Database,
  organisationId: string,
  projectId: string,
  versionId: string,
): Promise<Record<string, unknown>> {
  const results = await database.batch([
    database.prepare(`
      SELECT id, parent_id, kind, label, description, position_json, geometry_json,
        metadata_json, sort_order, world_unit
      FROM scene_entities
      WHERE organisation_id = ? AND project_id = ? AND version_id = ? AND status = 'active'
      ORDER BY kind, sort_order, label
    `).bind(organisationId, projectId, versionId),
    database.prepare(`
      SELECT id, label, description, accessibility, estimated_seconds
      FROM scene_routes
      WHERE organisation_id = ? AND project_id = ? AND version_id = ? AND status = 'active'
      ORDER BY created_at
    `).bind(organisationId, projectId, versionId),
    database.prepare(`
      SELECT rs.route_id, rs.entity_id, rs.sequence_number, rs.camera_pose_json, rs.narration
      FROM scene_route_stops rs
      JOIN scene_routes r ON r.id = rs.route_id
      WHERE r.organisation_id = ? AND r.project_id = ? AND r.version_id = ?
        AND r.status = 'active'
      ORDER BY rs.route_id, rs.sequence_number
    `).bind(organisationId, projectId, versionId),
    database.prepare(`
      SELECT id, label, bounds_json, metadata_json, world_unit
      FROM scene_navigation_obstacles
      WHERE organisation_id = ? AND project_id = ? AND version_id = ? AND status = 'active'
      ORDER BY label, created_at
    `).bind(organisationId, projectId, versionId),
    database.prepare(`
      SELECT world_unit, agent_radius, agent_height, eye_height, max_step_metres
      FROM scene_navigation_profiles
      WHERE organisation_id = ? AND project_id = ? AND version_id = ?
    `).bind(organisationId, projectId, versionId),
  ]);
  const entities = requiredBatchResult(results, 0).results;
  const obstacles = requiredBatchResult(results, 3).results;
  const profile = requiredBatchResult(results, 4).results[0];
  const runtime = buildSpatialRuntime(entities, obstacles, profile);
  return {
    schemaVersion: "spatial-runtime-v5",
    entities,
    routes: requiredBatchResult(results, 1).results,
    routeStops: requiredBatchResult(results, 2).results,
    navigationObstacles: obstacles,
    collisionProxy: runtime.collisionProxy,
    navigationMesh: runtime.navigationMesh,
    obstacleProxy: runtime.obstacleProxy,
    navigationProfile: runtime.navigationProfile,
  };
}

function parseSpatialSnapshot(value: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (Reflect.get(parsed, "schemaVersion") !== "spatial-runtime-v5") return null;
  if (
    !Array.isArray(Reflect.get(parsed, "entities")) ||
    !Array.isArray(Reflect.get(parsed, "routes")) ||
    !Array.isArray(Reflect.get(parsed, "routeStops")) ||
    !Reflect.get(parsed, "navigationMesh")
  ) return null;
  return parsed as Record<string, unknown>;
}

function buildSpatialRuntime(
  rows: unknown[],
  obstacleRows: unknown[] = [],
  profileRow: unknown = null,
): {
  collisionProxy: { version: "box-union-v1"; boxes: RuntimeBox[] };
  navigationMesh: {
    version: "room-box-triangles-v1" | "authored-polygon-triangles-v2";
    vertices: Array<[number, number, number]>;
    indices: number[];
    sourceEntityIds: string[];
  };
  obstacleProxy: {
    version: "authored-obstacle-boxes-v1";
    boxes: RuntimeObstacleBox[];
  };
  navigationProfile: {
    worldUnit: "metres" | "scene_units";
    agentRadius: number;
    agentHeight: number;
    eyeHeight: number;
    maxStepMetres: number;
  };
} {
  const regions: Array<{
    entityId: string;
    kind: "floor" | "room" | "doorway";
    label: string;
    box: RuntimeBox;
    polygon: Array<[number, number, number]> | null;
  }> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const kind = Reflect.get(row, "kind");
    if (kind !== "floor" && kind !== "room" && kind !== "doorway") continue;
    const geometryJson = Reflect.get(row, "geometry_json");
    if (typeof geometryJson !== "string") continue;
    let geometry: unknown;
    try {
      geometry = JSON.parse(geometryJson);
    } catch {
      continue;
    }
    if (!geometry || typeof geometry !== "object") continue;
    const points = Reflect.get(geometry, "points");
    if (!Array.isArray(points)) continue;
    const type = Reflect.get(geometry, "type");
    let polygon: Array<[number, number, number]> | null = null;
    let first: [number, number, number] | null = null;
    let second: [number, number, number] | null = null;
    if (type === "box" && points.length === 2) {
      first = finitePoint3(points[0]);
      second = finitePoint3(points[1]);
    } else if (type === "polygon" && points.length >= 3) {
      const parsed = points.map(finitePoint3);
      if (parsed.some((point) => !point)) continue;
      polygon = parsed as Array<[number, number, number]>;
      first = [
        Math.min(...polygon.map((point) => point[0])),
        Math.min(...polygon.map((point) => point[1])),
        Math.min(...polygon.map((point) => point[2])),
      ];
      second = [
        Math.max(...polygon.map((point) => point[0])),
        Math.max(...polygon.map((point) => point[1])),
        Math.max(...polygon.map((point) => point[2])),
      ];
    }
    if (!first || !second) continue;
    const min: [number, number, number] = [
      Math.min(first[0], second[0]),
      Math.min(first[1], second[1]),
      Math.min(first[2], second[2]),
    ];
    const max: [number, number, number] = [
      Math.max(first[0], second[0]),
      Math.max(first[1], second[1]),
      Math.max(first[2], second[2]),
    ];
    if (max[0] - min[0] < 0.05 || max[2] - min[2] < 0.05) continue;
    const entityId = String(Reflect.get(row, "id") ?? "");
    const label = String(Reflect.get(row, "label") ?? "Walkable region");
    regions.push({
      entityId,
      kind,
      label,
      box: { entityId, label, min, max },
      polygon,
    });
  }

  const primaryWalkable = regions.some((region) => region.kind === "room")
    ? regions.filter((region) => region.kind === "room")
    : regions.filter((region) => region.kind === "floor");
  const walkable = [
    ...primaryWalkable,
    ...regions.filter((region) => region.kind === "doorway"),
  ];
  const boxes = walkable.map((region) => region.box);
  const vertices: Array<[number, number, number]> = [];
  const indices: number[] = [];
  for (const region of walkable) {
    const offset = vertices.length;
    if (region.polygon) {
      const floorY = region.polygon.reduce((sum, point) => sum + point[1], 0) /
        region.polygon.length + 0.02;
      vertices.push(...region.polygon.map((point) =>
        [point[0], floorY, point[2]] as [number, number, number]));
      indices.push(...triangulateWalkablePolygon(region.polygon).map((index) => offset + index));
    } else {
      const box = region.box;
      const floorY = box.min[1] + 0.02;
      vertices.push(
        [box.min[0], floorY, box.min[2]],
        [box.max[0], floorY, box.min[2]],
        [box.max[0], floorY, box.max[2]],
        [box.min[0], floorY, box.max[2]],
      );
      indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    }
  }
  const obstacleBoxes = obstacleRows.flatMap((row): RuntimeObstacleBox[] => {
    if (!row || typeof row !== "object") return [];
    const boundsJson = Reflect.get(row, "bounds_json");
    if (typeof boundsJson !== "string") return [];
    let geometry: unknown;
    try {
      geometry = JSON.parse(boundsJson);
    } catch {
      return [];
    }
    if (!geometry || typeof geometry !== "object" || Reflect.get(geometry, "type") !== "box") {
      return [];
    }
    const points = Reflect.get(geometry, "points");
    if (!Array.isArray(points) || points.length !== 2) return [];
    const first = finitePoint3(points[0]);
    const second = finitePoint3(points[1]);
    if (!first || !second) return [];
    return [{
      entityId: String(Reflect.get(row, "id") ?? ""),
      label: String(Reflect.get(row, "label") ?? "Obstacle"),
      min: [
        Math.min(first[0], second[0]),
        Math.min(first[1], second[1]),
        Math.min(first[2], second[2]),
      ],
      max: [
        Math.max(first[0], second[0]),
        Math.max(first[1], second[1]),
        Math.max(first[2], second[2]),
      ],
    }];
  });
  const navigationProfile = navigationProfileFromRow(profileRow);
  return {
    collisionProxy: { version: "box-union-v1", boxes },
    navigationMesh: {
      version: walkable.some((region) => region.polygon)
        ? "authored-polygon-triangles-v2"
        : "room-box-triangles-v1",
      vertices,
      indices,
      sourceEntityIds: walkable.map((region) => region.entityId),
    },
    obstacleProxy: {
      version: "authored-obstacle-boxes-v1",
      boxes: obstacleBoxes,
    },
    navigationProfile,
  };
}

function navigationProfileFromRow(
  row: unknown,
): typeof defaultNavigationProfile | {
  worldUnit: "metres" | "scene_units";
  agentRadius: number;
  agentHeight: number;
  eyeHeight: number;
  maxStepMetres: number;
} {
  if (!row || typeof row !== "object") return defaultNavigationProfile;
  const worldUnit = parseWorldUnit(Reflect.get(row, "world_unit"));
  const agentRadius = Number(Reflect.get(row, "agent_radius"));
  const agentHeight = Number(Reflect.get(row, "agent_height"));
  const eyeHeight = Number(Reflect.get(row, "eye_height"));
  const maxStepMetres = Number(Reflect.get(row, "max_step_metres"));
  if (
    !Number.isFinite(agentRadius) ||
    !Number.isFinite(agentHeight) ||
    !Number.isFinite(eyeHeight) ||
    !Number.isFinite(maxStepMetres)
  ) return defaultNavigationProfile;
  return { worldUnit, agentRadius, agentHeight, eyeHeight, maxStepMetres };
}

export function triangulateWalkablePolygon(points: Array<[number, number, number]>): number[] {
  const ring = points
    .map((point, index) => ({ point, index }))
    .filter((entry, index, entries) =>
      index === 0 || !sameWalkablePoint(entry.point, entries[index - 1]!.point));
  if (
    ring.length > 1 &&
    sameWalkablePoint(ring[0]!.point, ring[ring.length - 1]!.point)
  ) {
    ring.pop();
  }
  if (ring.length < 3) return [];
  const rings = splitWalkableRings(ring);
  const sourceWinding = Math.sign(walkableRingArea(ring));
  if (!sourceWinding) return [];
  const outerRings = rings
    .filter((candidate) => walkableRingArea(candidate) * sourceWinding > 1e-9)
    .sort((left, right) =>
      Math.abs(walkableRingArea(left)) - Math.abs(walkableRingArea(right)));
  const holeRings = rings.filter((candidate) =>
    walkableRingArea(candidate) * sourceWinding < -1e-9);
  const holesByOuter = new Map(outerRings.map((outer) => [outer, [] as typeof holeRings]));
  for (const hole of holeRings) {
    const owner = outerRings.find((outer) =>
      walkablePointInRing(hole[0]!.point, outer));
    if (owner) holesByOuter.get(owner)!.push(hole);
  }
  return outerRings.flatMap((outer) =>
    triangulateSimpleWalkableRing(outer, holesByOuter.get(outer) ?? []));
}

function splitWalkableRings(
  ring: Array<{ point: [number, number, number]; index: number }>,
): Array<Array<{ point: [number, number, number]; index: number }>> {
  for (let first = 0; first < ring.length; first += 1) {
    for (let second = first + 2; second < ring.length; second += 1) {
      if (first === 0 && second === ring.length - 1) continue;
      if (!sameWalkablePoint(ring[first]!.point, ring[second]!.point)) continue;
      const left = ring.slice(first, second);
      const right = [...ring.slice(second), ...ring.slice(0, first)];
      if (left.length < 3 || right.length < 3) continue;
      return [
        ...splitWalkableRings(left),
        ...splitWalkableRings(right),
      ];
    }
  }
  return [ring];
}

function triangulateSimpleWalkableRing(
  outer: Array<{ point: [number, number, number]; index: number }>,
  holes: Array<Array<{ point: [number, number, number]; index: number }>>,
): number[] {
  const flattened = [outer, ...holes].flat();
  const holeIndices: number[] = [];
  let offset = outer.length;
  for (const hole of holes) {
    holeIndices.push(offset);
    offset += hole.length;
  }
  const data = flattened.flatMap(({ point }) => [point[0], point[2]]);
  return Earcut.triangulate(data, holeIndices, 2).map((index) =>
    flattened[index]!.index);
}

function walkableRingArea(
  ring: Array<{ point: [number, number, number] }>,
): number {
  return ring.reduce((sum, entry, index) => {
    const next = ring[(index + 1) % ring.length]!;
    return sum + entry.point[0] * next.point[2] - next.point[0] * entry.point[2];
  }, 0) / 2;
}

function sameWalkablePoint(
  first: [number, number, number],
  second: [number, number, number],
): boolean {
  return Math.abs(first[0] - second[0]) <= 1e-9 &&
    Math.abs(first[2] - second[2]) <= 1e-9;
}

function walkablePointInRing(
  point: [number, number, number],
  ring: Array<{ point: [number, number, number] }>,
): boolean {
  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const first = ring[index]!.point;
    const second = ring[(index + 1) % ring.length]!.point;
    const cross = (point[0] - first[0]) * (second[2] - first[2]) -
      (point[2] - first[2]) * (second[0] - first[0]);
    if (
      Math.abs(cross) <= 1e-9 &&
      point[0] >= Math.min(first[0], second[0]) - 1e-9 &&
      point[0] <= Math.max(first[0], second[0]) + 1e-9 &&
      point[2] >= Math.min(first[2], second[2]) - 1e-9 &&
      point[2] <= Math.max(first[2], second[2]) + 1e-9
    ) return true;
    if (
      (first[2] > point[2]) !== (second[2] > point[2]) &&
      point[0] < (second[0] - first[0]) * (point[2] - first[2]) /
        (second[2] - first[2]) + first[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function finitePoint3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const point = value.map(Number);
  if (point.some((coordinate) => !Number.isFinite(coordinate))) return null;
  return point as [number, number, number];
}

function readStringProperty(value: unknown, property: string): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = Reflect.get(value, property);
  return typeof candidate === "string" ? candidate : null;
}

function readNullableStringProperty(value: unknown, property: string): string | null {
  return readStringProperty(value, property);
}

function readNumberProperty(value: unknown, property: string): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = Reflect.get(value, property);
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function scalarCount(result: D1Result<unknown>): number {
  return scalarNumber(result, "count");
}

function requiredBatchResult(results: D1Result<unknown>[], index: number): D1Result<unknown> {
  const result = results[index];
  if (!result) throw new Error(`D1 batch result ${index} is missing`);
  return result;
}

function scalarNumber(result: D1Result<unknown>, key: string): number {
  const first = result.results[0];
  if (!first || typeof first !== "object") return 0;
  const value = Reflect.get(first, key);
  return typeof value === "number" ? value : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function comparisonAssetTokenScope(projectId: string, versionId: string, assetId: string): string {
  return `comparison:${projectId}:${versionId}:${assetId}`;
}

async function releaseAccessToken(operationId: string, secret: string): Promise<string> {
  return sha256Hex(`release-access:${operationId}:${secret}`);
}

function validationError(context: Context<AppEnvironment>, details: unknown): Response {
  return context.json({ error: "Validation failed", details, requestId: context.get("requestId") }, 400);
}

function unprocessable(context: Context<AppEnvironment>, details: unknown): Response {
  return context.json({ error: "Request cannot be applied", details, requestId: context.get("requestId") }, 422);
}

function unauthorized(context: Context<AppEnvironment>, message: string): Response {
  context.header("Cache-Control", "private, no-store");
  return context.json({ error: message, requestId: context.get("requestId") }, 401);
}

function forbidden(context: Context<AppEnvironment>, message: string): Response {
  context.header("Cache-Control", "private, no-store");
  return context.json({ error: message, requestId: context.get("requestId") }, 403);
}

function conflict(context: Context<AppEnvironment>, message: string): Response {
  return context.json({ error: message, requestId: context.get("requestId") }, 409);
}

function notFound(context: Context<AppEnvironment>, message: string): Response {
  return context.json({ error: message, requestId: context.get("requestId") }, 404);
}

function tooManyRequests(context: Context<AppEnvironment>): Response {
  context.header("Retry-After", "60");
  return context.json({ error: "Rate limit exceeded", requestId: context.get("requestId") }, 429);
}

function registeredSceneChangeApi(report: RegisteredSceneChangeRow): Record<string, unknown> {
  return {
    id: report.id,
    projectId: report.project_id,
    baselineVersionId: report.baseline_version_id,
    candidateVersionId: report.candidate_version_id,
    baselineAssetId: report.baseline_asset_id,
    candidateAssetId: report.candidate_asset_id,
    jobId: report.job_id,
    status: report.status,
    coordinateAssurance: report.coordinate_assurance,
    registrationEvidence: report.registration_evidence,
    registration: {
      mode: report.registration_mode,
      searchRadiusM: report.registration_search_radius_m,
      maximumRmseMm: report.registration_maximum_rmse_mm,
      minimumOverlapPercent: report.registration_minimum_overlap_percent,
      status: report.registration_status,
      summary: parseStoredObject(report.registration_summary_json ?? "null"),
    },
    parameters: {
      voxelSizeM: report.voxel_size_m,
      structuralChangeThresholdPercent: report.structural_threshold_percent,
      photometricChangeThresholdPercent: report.photometric_threshold_percent,
      centroidChangeThresholdMm: report.centroid_threshold_mm,
      maximumSamplePoints: report.maximum_sample_points,
    },
    reportAssetId: report.report_asset_id,
    result: report.result,
    summary: parseStoredObject(report.summary_json ?? "null"),
    error: parseStoredObject(report.error_json ?? "null"),
    reviewDecision: report.review_decision,
    reviewNote: report.review_note,
    reviewedAt: report.reviewed_at,
    createdAt: report.created_at,
    updatedAt: report.updated_at,
    completedAt: report.completed_at,
  };
}

function captureBundleApi(manifest: CaptureBundleRow): Record<string, unknown> {
  return {
    id: manifest.id,
    projectId: manifest.project_id,
    versionId: manifest.version_id,
    adapter: manifest.adapter_v2 ?? manifest.adapter,
    schemaVersion: manifest.schema_version,
    status: manifest.status,
    result: manifest.result,
    manifestAssetId: manifest.manifest_asset_id,
    manifestHash: manifest.manifest_hash,
    validation: parseStoredObject(manifest.validation_json),
    reviewDecision: manifest.review_decision,
    reviewNote: manifest.review_note,
    reviewedAt: manifest.reviewed_at,
    createdAt: manifest.created_at,
    updatedAt: manifest.updated_at,
  };
}

function privacyScanApi(scan: PrivacyScanRow): Record<string, unknown> {
  return {
    id: scan.id,
    versionId: scan.version_id,
    status: scan.status,
    detector: scan.detector,
    detectorVersion: scan.detector_version,
    attemptCount: scan.attempt_count,
    maxAttempts: scan.max_attempts,
    inputCount: scan.input_count,
    candidateCount: scan.candidate_count,
    evidence: parseStoredObject(scan.evidence_json ?? "{}"),
    error: parseStoredObject(scan.error_json ?? "null"),
    createdAt: scan.created_at,
    updatedAt: scan.updated_at,
    startedAt: scan.started_at,
    completedAt: scan.completed_at,
  };
}

async function markPrivacyScanEnqueueFailure(
  database: D1Database,
  scanId: string,
  error: unknown,
): Promise<void> {
  await database.prepare(`
    UPDATE privacy_scans
    SET status = 'FAILED', error_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(JSON.stringify({
    code: "queue_unavailable",
    message: errorMessage(error).slice(0, 1000),
    retryable: true,
    failedAt: new Date().toISOString(),
  }), scanId).run();
}

type NormalisedPrivacyBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  confidence: number | null;
  raw: Record<string, unknown>;
};

export function normalisePrivacyBoxes(response: unknown): NormalisedPrivacyBox[] {
  if (!response || typeof response !== "object") return [];
  const objects = Reflect.get(response, "objects");
  if (!Array.isArray(objects)) return [];
  const boxes: NormalisedPrivacyBox[] = [];
  for (const candidate of objects) {
    if (!candidate || typeof candidate !== "object") continue;
    const raw = candidate as Record<string, unknown>;
    const nested = (
      Reflect.get(raw, "bbox") ??
      Reflect.get(raw, "box") ??
      Reflect.get(raw, "bounding_box")
    );
    let coordinates: number[] | null = null;
    if (Array.isArray(nested) && nested.length >= 4) {
      coordinates = nested.slice(0, 4).map(Number);
    } else {
      const source = nested && typeof nested === "object"
        ? nested as Record<string, unknown>
        : raw;
      coordinates = [
        numberFromProperties(source, ["x_min", "xmin", "xMin", "left", "x1"]),
        numberFromProperties(source, ["y_min", "ymin", "yMin", "top", "y1"]),
        numberFromProperties(source, ["x_max", "xmax", "xMax", "right", "x2"]),
        numberFromProperties(source, ["y_max", "ymax", "yMax", "bottom", "y2"]),
      ].map((value) => value ?? Number.NaN);
    }
    if (!coordinates.every(Number.isFinite)) continue;
    const maximum = Math.max(...coordinates);
    if (maximum > 1 && maximum <= 1000) {
      coordinates = coordinates.map((value) => value / 1000);
    }
    let [xMin, yMin, xMax, yMax] = coordinates;
    xMin = clampUnit(xMin!);
    yMin = clampUnit(yMin!);
    xMax = clampUnit(xMax!);
    yMax = clampUnit(yMax!);
    if (xMax <= xMin || yMax <= yMin || (xMax - xMin) * (yMax - yMin) < 0.00001) continue;
    const confidenceValue = numberFromProperties(raw, ["confidence", "score", "probability"]);
    boxes.push({
      xMin: roundCoordinate(xMin),
      yMin: roundCoordinate(yMin),
      xMax: roundCoordinate(xMax),
      yMax: roundCoordinate(yMax),
      confidence: confidenceValue === null ? null : clampUnit(confidenceValue),
      raw,
    });
  }
  return deduplicatePrivacyBoxes(boxes);
}

async function processPrivacyScan(
  env: Env,
  scanId: string,
  deliveryAttempt: number,
): Promise<void> {
  const scan = await env.DB.prepare(`
    UPDATE privacy_scans
    SET status = 'RUNNING', attempt_count = attempt_count + 1,
      started_at = datetime('now'), completed_at = NULL, error_json = NULL,
      updated_at = datetime('now')
    WHERE id = ? AND status IN ('QUEUED', 'FAILED')
    RETURNING *
  `).bind(scanId).first<PrivacyScanRow>();
  if (!scan) {
    const existing = await env.DB.prepare(
      "SELECT status FROM privacy_scans WHERE id = ?",
    ).bind(scanId).first<{ status: string }>();
    if (existing?.status === "COMPLETED" || existing?.status === "RUNNING") return;
    throw new Error("Privacy scan is unavailable for processing");
  }
  const startedAt = Date.now();
  try {
    const inputs = await env.DB.prepare(`
      SELECT a.*, psi.scan_id
      FROM privacy_scan_inputs psi
      JOIN assets a ON a.id = psi.asset_id
      WHERE psi.scan_id = ? AND a.organisation_id = ? AND a.project_id = ?
        AND a.version_id = ? AND a.integrity_status = 'verified'
        AND a.deleted_at IS NULL
      ORDER BY a.id
    `).bind(
      scan.id,
      scan.organisation_id,
      scan.project_id,
      scan.version_id,
    ).all<PrivacyScanInputRow>();
    if (!inputs.results.length || inputs.results.length !== scan.input_count) {
      throw new Error("Privacy scan inputs are missing or no longer verified");
    }
    await env.DB.prepare("DELETE FROM privacy_candidates WHERE scan_id = ?").bind(scan.id).run();
    const candidates: Array<{
      id: string;
      asset: AssetRow;
      target: string;
      label: string;
      box: NormalisedPrivacyBox;
      bboxJson: string;
      bboxHash: string;
    }> = [];
    let inferenceCount = 0;
    let inferenceAttemptCount = 0;
    let truncated = false;
    const ai = env.AI as unknown as {
      run(
        model: string,
        inputs: Record<string, unknown>,
        options?: Record<string, unknown>,
      ): Promise<unknown>;
    };
    for (const asset of inputs.results) {
      if (!asset.mime_type.startsWith("image/") || asset.size_bytes > maximumPrivacyImageBytes) {
        throw new Error(`Privacy input ${asset.file_name} is not a supported bounded image`);
      }
      const object = await env.SPATIAL_ASSETS.get(asset.object_key);
      if (!object) throw new Error(`Privacy input ${asset.file_name} is missing from private storage`);
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > maximumPrivacyImageBytes) {
        throw new Error(`Privacy input ${asset.file_name} has an invalid byte length`);
      }
      const dataUri = `data:${asset.mime_type};base64,${bytesToBase64(bytes)}`;
      for (const targetDefinition of privacyTargets) {
        const inference = await runPrivacyDetectionWithRetry(
          ai,
          {
            task: "detect",
            image: dataUri,
            target: targetDefinition.target,
            max_objects: 20,
            stream: false,
          },
          {
            tags: ["spatial-studio", "privacy-detection", scan.id.slice(0, 36)],
          },
        );
        const output = inference.output;
        inferenceAttemptCount += inference.attempts;
        inferenceCount += 1;
        for (const box of normalisePrivacyBoxes(output)) {
          if (candidates.length >= 250) {
            truncated = true;
            break;
          }
          const bboxJson = JSON.stringify({
            xMin: box.xMin,
            yMin: box.yMin,
            xMax: box.xMax,
            yMax: box.yMax,
          });
          candidates.push({
            id: crypto.randomUUID(),
            asset,
            target: targetDefinition.target,
            label: targetDefinition.label,
            box,
            bboxJson,
            bboxHash: await sha256Hex(bboxJson),
          });
        }
      }
    }
    for (let offset = 0; offset < candidates.length; offset += 50) {
      const chunk = candidates.slice(offset, offset + 50);
      await env.DB.batch(chunk.map((candidate) => env.DB.prepare(`
        INSERT INTO privacy_candidates
          (id, scan_id, organisation_id, project_id, version_id, asset_id,
            target, label, bbox_json, bbox_hash, confidence,
            detector_metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        candidate.id,
        scan.id,
        scan.organisation_id,
        scan.project_id,
        scan.version_id,
        candidate.asset.id,
        candidate.target,
        candidate.label,
        candidate.bboxJson,
        candidate.bboxHash,
        candidate.box.confidence,
        JSON.stringify({
          detector: privacyDetectorVersion,
          modelConfidenceUnavailable: candidate.box.confidence === null,
          raw: candidate.box.raw,
        }),
      )));
    }
    const completedAt = new Date().toISOString();
    const evidence = {
      detector: privacyDetector,
      detectorVersion: privacyDetectorVersion,
      targets: privacyTargets.map(({ target }) => target),
      inputs: inputs.results.map((asset) => ({
        assetId: asset.id,
        sha256: asset.sha256,
        mimeType: asset.mime_type,
        sizeBytes: asset.size_bytes,
      })),
      inferenceCount,
      inferenceAttemptCount,
      inferenceRetryCount: inferenceAttemptCount - inferenceCount,
      candidateCount: candidates.length,
      truncated,
      deliveryAttempt,
      durationMs: Date.now() - startedAt,
      completedAt,
      humanReviewRequired: true,
    };
    await env.DB.prepare(`
      UPDATE privacy_scans
      SET status = 'COMPLETED', candidate_count = ?, evidence_json = ?,
        error_json = NULL, completed_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(candidates.length, JSON.stringify(evidence), completedAt, scan.id).run();
  } catch (error) {
    const exhausted = deliveryAttempt >= scan.max_attempts;
    await env.DB.prepare(`
      UPDATE privacy_scans
      SET status = ?, error_json = ?, completed_at = CASE WHEN ? THEN datetime('now') ELSE NULL END,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      exhausted ? "DEAD_LETTER" : "FAILED",
      JSON.stringify({
        code: "privacy_detection_failed",
        message: errorMessage(error).slice(0, 1000),
        retryable: !exhausted,
        detector: privacyDetectorVersion,
        deliveryAttempt,
        failedAt: new Date().toISOString(),
      }),
      exhausted ? 1 : 0,
      scan.id,
    ).run();
    throw error;
  }
}

export async function runPrivacyDetectionWithRetry(
  ai: {
    run(
      model: string,
      inputs: Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
  },
  inputs: Record<string, unknown>,
  options: Record<string, unknown>,
  maximumAttempts = 3,
): Promise<{ output: unknown; attempts: number }> {
  const attempts = Math.min(3, Math.max(1, Math.trunc(maximumAttempts)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return {
        output: await ai.run(privacyDetector, inputs, options),
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.min(1_000, 250 * 2 ** (attempt - 1)));
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error(errorMessage(lastError));
}

function numberFromProperties(
  object: Record<string, unknown>,
  properties: string[],
): number | null {
  for (const property of properties) {
    const value = Reflect.get(object, property);
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function deduplicatePrivacyBoxes(boxes: NormalisedPrivacyBox[]): NormalisedPrivacyBox[] {
  const retained: NormalisedPrivacyBox[] = [];
  for (const candidate of boxes) {
    if (retained.some((existing) => privacyBoxIou(existing, candidate) >= 0.9)) continue;
    retained.push(candidate);
  }
  return retained;
}

function privacyBoxIou(left: NormalisedPrivacyBox, right: NormalisedPrivacyBox): number {
  const intersectionWidth = Math.max(0, Math.min(left.xMax, right.xMax) - Math.max(left.xMin, right.xMin));
  const intersectionHeight = Math.max(0, Math.min(left.yMax, right.yMax) - Math.max(left.yMin, right.yMin));
  const intersection = intersectionWidth * intersectionHeight;
  const leftArea = (left.xMax - left.xMin) * (left.yMax - left.yMin);
  const rightArea = (right.xMax - right.xMin) * (right.yMax - right.yMin);
  const union = leftArea + rightArea - intersection;
  return union > 0 ? intersection / union : 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

const worker = {
  async fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, executionContext);
  },
  async scheduled(controller: ScheduledController, env: Env, executionContext: ExecutionContext): Promise<void> {
    if (controller.cron === "17 * * * *") {
      executionContext.waitUntil(runLifecycleEnforcement(env, "scheduled"));
    }
    executionContext.waitUntil(enqueueDispatchableProcessingJobs(env));
    executionContext.waitUntil(enqueueDispatchableProjectAssetCopies(env));
  },
  async queue(batch: MessageBatch<SpatialQueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      if (
        message.body &&
        "type" in message.body &&
        message.body.type === "project_asset_copy"
      ) {
        if (
          typeof message.body.itemId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(message.body.itemId)
        ) {
          message.ack();
          continue;
        }
        try {
          await processProjectAssetCopy(env, message.body.itemId, message.attempts);
          message.ack();
        } catch (error) {
          console.error(JSON.stringify({
            event: "project_asset_handoff.copy_failed",
            itemId: message.body.itemId,
            attempt: message.attempts,
            error: errorMessage(error),
          }));
          message.retry({
            delaySeconds: Math.min(300, 15 * 2 ** Math.max(0, message.attempts - 1)),
          });
        }
        continue;
      }
      if (
        !message.body ||
        !("scanId" in message.body) ||
        typeof message.body.scanId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(message.body.scanId)
      ) {
        message.ack();
        continue;
      }
      try {
        await processPrivacyScan(env, message.body.scanId, message.attempts);
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          event: "privacy.scan_failed",
          scanId: message.body.scanId,
          attempt: message.attempts,
          error: errorMessage(error),
        }));
        message.retry({ delaySeconds: Math.min(300, 15 * 2 ** Math.max(0, message.attempts - 1)) });
      }
    }
  },
} satisfies ExportedHandler<Env, SpatialQueueMessage>;

export default worker;
