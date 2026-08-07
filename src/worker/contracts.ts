import { z } from "zod";
import {
  captureAdapterIds,
  captureAssetFormats,
  captureAssetPurposes,
} from "../shared/capture-adapters";
import { PROVISIONAL_MEASUREMENT_DISCLAIMER } from "../shared/world-units";
import {
  hasNonIdentitySceneRotation,
  SCENE_ROTATION_MAX_DEGREES,
  SCENE_ROTATION_MIN_DEGREES,
} from "../shared/scene-rotation";
import { captureBundleRoles } from "./capture-bundle";

const captureAdapterSchema = z.enum(captureAdapterIds);
export const projectCustomFieldTypeSchema = z.enum([
  "text",
  "number",
  "boolean",
  "date",
  "select",
  "url",
]);
const projectCustomFieldValueSchema = z.union([
  z.string().max(2048),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const projectCustomFieldValuesSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  projectCustomFieldValueSchema,
).superRefine((values, context) => {
  if (Object.keys(values).length > 50) {
    context.addIssue({
      code: "custom",
      message: "At most 50 custom fields may be supplied",
    });
  }
});

export const projectCustomFieldDefinitionSchema = z.object({
  clientOperationId: z.string().uuid(),
  key: z.string().trim().min(2).max(40).regex(/^[a-z][a-z0-9_]*$/, {
    message: "Use a lower-case key beginning with a letter and containing only letters, numbers, and underscores",
  }),
  label: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  type: projectCustomFieldTypeSchema,
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  sortOrder: z.number().int().min(0).max(10000).default(0),
}).superRefine((definition, context) => {
  const uniqueOptions = new Set(definition.options.map((option) => option.toLowerCase()));
  if (uniqueOptions.size !== definition.options.length) {
    context.addIssue({
      code: "custom",
      message: "Select options must be unique",
      path: ["options"],
    });
  }
  if (definition.type === "select" && definition.options.length === 0) {
    context.addIssue({
      code: "custom",
      message: "Select fields require at least one option",
      path: ["options"],
    });
  }
  if (definition.type !== "select" && definition.options.length > 0) {
    context.addIssue({
      code: "custom",
      message: "Only select fields may declare options",
      path: ["options"],
    });
  }
});

export const projectCustomFieldUpdateSchema = z.object({
  label: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one custom-field setting is required",
});

export const organisationSwitchSchema = z.object({
  organisationId: z.string().uuid(),
});

export const projectInputSchema = z.object({
  clientOperationId: z.string().uuid().optional(),
  name: z.string().trim().min(3).max(120),
  customerName: z.string().trim().min(2).max(120).optional(),
  customerEmail: z.string().email().optional(),
  captureAdapter: captureAdapterSchema,
  deliveryTemplate: z.string().trim().min(2).max(80),
  notes: z.string().trim().max(4000).optional(),
  customFields: projectCustomFieldValuesSchema.default({}),
});

export const projectUpdateSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  customerName: z.string().trim().min(2).max(120).nullable().optional(),
  customerEmail: z.string().trim().email().nullable().optional(),
  captureAdapter: captureAdapterSchema.optional(),
  deliveryTemplate: z.string().trim().min(2).max(80).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  customFields: projectCustomFieldValuesSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one project field is required",
});

export const projectBulkLifecycleSchema = z.object({
  clientOperationId: z.string().uuid(),
  action: z.enum(["archive", "restore"]),
  projectIds: z.array(z.string().uuid()).min(1).max(50)
    .transform((projectIds) => [...new Set(projectIds)].sort()),
});

export const projectTemplateSchema = z.object({
  clientOperationId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  captureAdapter: captureAdapterSchema,
  deliveryTemplate: z.string().trim().min(2).max(80),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export const projectTemplateUpdateSchema = projectTemplateSchema.omit({
  clientOperationId: true,
}).partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one template field is required",
});

export const projectViewFilterSchema = z.object({
  query: z.string().trim().max(120).default(""),
  statuses: z.array(z.enum([
    "DRAFT",
    "UPLOADING",
    "INGESTED",
    "PROCESSING",
    "QA_REQUIRED",
    "APPROVED",
    "PUBLISHED",
    "ARCHIVED",
    "UPLOAD_FAILED",
    "PROCESSING_FAILED",
    "QA_REJECTED",
    "REVOKED",
  ])).max(12).transform((values) => [...new Set(values)].sort()).default([]),
  captureAdapters: z.array(captureAdapterSchema).max(captureAdapterIds.length)
    .transform((values) => [...new Set(values)].sort()).default([]),
  deliveryTemplates: z.array(z.string().trim().min(2).max(80)).max(20)
    .transform((values) => [...new Set(values)].sort()).default([]),
  sort: z.enum(["updated_desc", "updated_asc", "name_asc", "name_desc"]).default("updated_desc"),
});

export const projectSavedViewSchema = z.object({
  clientOperationId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  filter: projectViewFilterSchema,
  isDefault: z.boolean().default(false),
});

export const projectSavedViewUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  filter: projectViewFilterSchema.optional(),
  isDefault: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one saved-view field is required",
});

export const portfolioProjectSchema = z.object({
  sourceId: z.string().uuid().optional(),
  name: z.string().trim().min(3).max(120),
  customerName: z.string().trim().min(2).max(120).nullable().optional(),
  customerEmail: z.string().trim().email().max(254).nullable().optional(),
  captureAdapter: captureAdapterSchema,
  deliveryTemplate: z.string().trim().min(2).max(80),
  notes: z.string().trim().max(4000).nullable().optional(),
  customFields: projectCustomFieldValuesSchema.default({}),
});

const portfolioCustomFieldDefinitionSchema = z.object({
  key: z.string().trim().min(2).max(40).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  type: projectCustomFieldTypeSchema,
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  sortOrder: z.number().int().min(0).max(10000).default(0),
}).superRefine((definition, context) => {
  if (definition.type === "select" && definition.options.length === 0) {
    context.addIssue({
      code: "custom",
      message: "Select fields require at least one option",
      path: ["options"],
    });
  }
  if (definition.type !== "select" && definition.options.length > 0) {
    context.addIssue({
      code: "custom",
      message: "Only select fields may declare options",
      path: ["options"],
    });
  }
});

export const projectPortfolioManifestSchema = z.object({
  format: z.literal("whymelabs.spatial.portfolio"),
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string().datetime().optional(),
  fieldDefinitions: z.array(portfolioCustomFieldDefinitionSchema).max(50).default([]),
  projects: z.array(portfolioProjectSchema).min(1).max(100),
}).superRefine((manifest, context) => {
  const sourceIds = new Set<string>();
  const fieldKeys = new Set<string>();
  for (const [index, field] of manifest.fieldDefinitions.entries()) {
    if (fieldKeys.has(field.key)) {
      context.addIssue({
        code: "custom",
        message: "Custom field keys must be unique inside a portfolio",
        path: ["fieldDefinitions", index, "key"],
      });
    }
    fieldKeys.add(field.key);
  }
  for (const [index, project] of manifest.projects.entries()) {
    if (project.sourceId) {
      if (sourceIds.has(project.sourceId)) {
        context.addIssue({
          code: "custom",
          message: "sourceId values must be unique inside a portfolio",
          path: ["projects", index, "sourceId"],
        });
      }
      sourceIds.add(project.sourceId);
    }
    for (const key of Object.keys(project.customFields)) {
      if (!fieldKeys.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Project custom field "${key}" has no field definition`,
          path: ["projects", index, "customFields", key],
        });
      }
    }
  }
  if (
    manifest.schemaVersion === 1 &&
    (manifest.fieldDefinitions.length > 0 ||
      manifest.projects.some((project) => Object.keys(project.customFields).length > 0))
  ) {
    context.addIssue({
      code: "custom",
      message: "Custom fields require portfolio schema version 2",
      path: ["schemaVersion"],
    });
  }
});

export const projectPortfolioImportSchema = z.object({
  clientOperationId: z.string().uuid(),
  manifest: projectPortfolioManifestSchema,
});

export const projectPortfolioExportSchema = z.object({
  projectIds: z.array(z.string().uuid()).min(1).max(100)
    .transform((projectIds) => [...new Set(projectIds)].sort()).optional(),
});

export const projectPortfolioHandoffPreviewSchema = z.object({
  targetOrganisationId: z.string().uuid(),
  projectIds: z.array(z.string().uuid()).min(1).max(50)
    .transform((projectIds) => [...new Set(projectIds)].sort()),
});

export const projectPortfolioHandoffSchema = projectPortfolioHandoffPreviewSchema.extend({
  clientOperationId: z.string().uuid(),
});

export const projectAssetHandoffPreviewSchema = z.object({
  targetOrganisationId: z.string().uuid(),
  projectId: z.string().uuid(),
});

export const projectAssetHandoffSchema = projectAssetHandoffPreviewSchema.extend({
  clientOperationId: z.string().uuid(),
  sourceSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export const projectAssetHandoffRetrySchema = z.object({
  clientOperationId: z.string().uuid(),
});

export const projectAssetHandoffCancelSchema = z.object({
  clientOperationId: z.string().uuid(),
});

export const captureAgentCredentialSchema = z.object({
  clientOperationId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  expiresInDays: z.number().int().min(1).max(365),
  projectIds: z.array(z.string().uuid()).min(1).max(100)
    .transform((projectIds) => [...new Set(projectIds)].sort()),
});

export const captureAgentCredentialUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  projectIds: z.array(z.string().uuid()).min(1).max(100)
    .transform((projectIds) => [...new Set(projectIds)].sort()).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one capture-agent setting is required",
});

export const captureAgentCredentialRotateSchema = z.object({
  clientOperationId: z.string().uuid(),
  expiresInDays: z.number().int().min(1).max(365),
});

const uploadCameraCoordinateSchema = z.number().finite().min(-1_000_000).max(1_000_000);
const uploadCameraVectorSchema = z.tuple([
  uploadCameraCoordinateSchema,
  uploadCameraCoordinateSchema,
  uploadCameraCoordinateSchema,
]);
const uploadPosterCameraSchema = z.object({
  position: uploadCameraVectorSchema,
  target: uploadCameraVectorSchema,
  up: uploadCameraVectorSchema,
  fovDegrees: z.number().finite().min(20).max(100),
}).superRefine((camera, context) => {
  const direction: [number, number, number] = [
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2],
  ];
  const directionLength = Math.hypot(...direction);
  const upLength = Math.hypot(...camera.up);
  const crossLength = Math.hypot(
    direction[1] * camera.up[2] - direction[2] * camera.up[1],
    direction[2] * camera.up[0] - direction[0] * camera.up[2],
    direction[0] * camera.up[1] - direction[1] * camera.up[0],
  );
  if (directionLength <= 1e-6) {
    context.addIssue({ code: "custom", message: "Poster camera position and target must differ" });
  }
  if (upLength <= 1e-6 || crossLength <= 1e-6) {
    context.addIssue({ code: "custom", message: "Poster camera up must be non-zero and not parallel to its view" });
  }
});

export const uploadInputSchema = z.object({
  clientOperationId: z.string().uuid().optional(),
  targetVersionId: z.string().uuid().optional(),
  fileName: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  format: z.enum(captureAssetFormats),
  purpose: z.enum(captureAssetPurposes).optional(),
  mimeType: z.string().trim().min(1).max(120),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  posterCamera: uploadPosterCameraSchema.optional(),
  captureJourney: z.object({
    id: z.string().uuid(),
    sameFrameConfirmed: z.literal(true),
  }).strict().optional(),
});

export const uploadCompleteSchema = z.object({
  parts: z.array(z.object({
    partNumber: z.number().int().min(1).max(10000),
    etag: z.string().min(1).max(256),
  })).min(1).max(10000),
});

export const otpRequestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  turnstileToken: z.string().trim().min(1).max(2048),
});

export const otpVerifySchema = z.object({
  challengeId: z.string().uuid(),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  code: z.string().regex(/^\d{6}$/),
});

export const teamInvitationSchema = z.object({
  clientOperationId: z.string().uuid().optional(),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(["platform_admin", "production_operator"]).default("production_operator"),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const teamMemberUpdateSchema = z.object({
  role: z.enum(["platform_admin", "production_operator"]),
});

export const enterpriseIdentityProviderSchema = z.object({
  name: z.string().trim().min(2).max(80),
  issuer: z.string().trim().url().max(500),
  clientId: z.string().trim().min(3).max(300),
  emailDomains: z.array(
    z.string().trim().toLowerCase()
      .regex(/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
  ).min(1).max(20).transform((domains) => [...new Set(domains)].sort()),
});

export const enterpriseIdentityDiscoverySchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
});

export const enterpriseIdentityStartSchema = enterpriseIdentityDiscoverySchema;

export const manualJobCompletionSchema = z.object({
  progressMessage: z.string().trim().min(2).max(500),
  report: z.record(z.string(), z.unknown()).default({}),
});

const workerOutputSchema = z.object({
  kind: z.enum(["master", "web", "portable", "poster", "pointcloud", "collision", "navmesh", "report"]),
  format: z.string().trim().toLowerCase().min(1).max(40),
  objectKey: z.string().trim().min(1).max(1024),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});

// The bounded reading of a public ASTM E57 container. Vendor extension field
// names are carried verbatim as evidence; nothing here decodes a vendor
// classification or mesh schema, and none is assumed.
export const captureScanStructureSchema = z.object({
  status: z.enum(["structure_read", "structure_unreadable"]),
  method: z.string().trim().min(1).max(120),
  scanCount: z.number().int().nonnegative().max(100_000),
  imageCount: z.number().int().nonnegative().max(100_000),
  hasPerScanPoses: z.boolean(),
  vendorFieldNames: z.array(z.string().trim().min(1).max(200)).max(512).default([]),
  reportSha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable().default(null),
  reason: z.string().trim().min(2).max(1000).optional(),
});

export const workerJobCompletionSchema = z.object({
  leaseToken: z.string().min(20).max(512),
  progressMessage: z.string().trim().min(2).max(500),
  outputs: z.array(workerOutputSchema).max(20).default([]),
  report: z.record(z.string(), z.unknown()).default({}),
  captureScanStructure: captureScanStructureSchema.optional(),
  evidence: z.object({
    processorVersion: z.string().trim().min(1).max(120),
    computeDurationMs: z.number().int().nonnegative(),
    activeHumanDurationMs: z.number().int().nonnegative(),
    inputBytes: z.number().int().nonnegative(),
    outputBytes: z.number().int().nonnegative(),
    toolVersions: z.record(z.string(), z.string().trim().min(1).max(120)).default({}),
  }),
});

export const workerJobFailureSchema = z.object({
  leaseToken: z.string().min(20).max(512),
  code: z.string().trim().min(2).max(80),
  message: z.string().trim().min(2).max(1000),
  retryable: z.boolean().default(true),
  failureClass: z.enum([
    "input_validation",
    "reconstruction",
    "conversion",
    "storage",
    "network",
    "capacity",
    "configuration",
    "lease",
    "unknown",
  ]).default("unknown"),
  details: z.record(z.string(), z.unknown()).default({}),
});

export const workerOutputUploadSchema = z.object({
  kind: workerOutputSchema.shape.kind,
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});

export const qaDecisionSchema = z.object({
  webAssetId: z.string().uuid(),
  posterAssetId: z.string().uuid().nullable().optional(),
  visualGrade: z.enum(["A", "B", "C"]),
  privacyStatus: z.literal("approved"),
  measurementGrade: z.enum(["visual-only", "indicative", "project-verified", "professional-certified"]),
  notes: z.string().trim().max(4000).optional(),
});

const cameraCoordinateSchema = z.number().finite().min(-1_000_000).max(1_000_000);
const cameraVectorSchema = z.tuple([
  cameraCoordinateSchema,
  cameraCoordinateSchema,
  cameraCoordinateSchema,
]);

const cameraPoseSchema = z.object({
  position: cameraVectorSchema,
  target: cameraVectorSchema,
  up: cameraVectorSchema.optional(),
  fovDegrees: z.number().min(20).max(100).default(58),
}).superRefine((camera, context) => {
  const view: [number, number, number] = [
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2],
  ];
  const viewLength = Math.hypot(...view);
  if (viewLength < 1e-9) {
    context.addIssue({
      code: "custom",
      path: ["target"],
      message: "Camera target must differ from its position",
    });
  }
  if (!camera.up) return;
  const upLength = Math.hypot(...camera.up);
  if (upLength < 1e-9) {
    context.addIssue({
      code: "custom",
      path: ["up"],
      message: "Camera up vector must be non-zero",
    });
    return;
  }
  const crossLength = Math.hypot(
    view[1] * camera.up[2] - view[2] * camera.up[1],
    view[2] * camera.up[0] - view[0] * camera.up[2],
    view[0] * camera.up[1] - view[1] * camera.up[0],
  );
  if (viewLength >= 1e-9 && crossLength / (viewLength * upLength) < 1e-8) {
    context.addIssue({
      code: "custom",
      path: ["up"],
      message: "Camera up vector must not be parallel to its viewing direction",
    });
  }
});

export const reviewerInvitationSchema = z.object({
  clientOperationId: z.string().uuid().optional(),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(["customer_reviewer", "customer_readonly"]).default("customer_reviewer"),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const reviewCommentSchema = z.object({
  clientOperationId: z.string().uuid().optional(),
  kind: z.enum(["comment", "redaction"]),
  body: z.string().trim().min(2).max(4000),
  cameraPose: cameraPoseSchema,
  anchor: z.object({
    point: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    radius: z.number().positive().max(100).optional(),
  }).nullable().optional(),
});

export const reviewDecisionSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  note: z.string().trim().max(4000).optional(),
});

export const reviewCommentResolutionSchema = z.object({
  status: z.enum(["resolved", "dismissed"]),
});

const hexColorSchema = z.string().trim().regex(/^#[0-9a-f]{6}$/i);

export const projectThemeSchema = z.object({
  brandName: z.string().trim().max(120).nullable().optional(),
  logoUrl: z.string().trim().url().max(2048).nullable().optional(),
  accentColor: hexColorSchema.default("#d6ff4b"),
  surfaceColor: hexColorSchema.default("#0d0f0e"),
});

export const customDomainSchema = z.object({
  hostname: z.string().trim().toLowerCase()
    .regex(/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
});

export const customDomainVerifySchema = z.object({
  verificationToken: z.string().min(32).max(256),
});

export const hostingSubscriptionSchema = z.object({
  clientOperationId: z.string().uuid(),
  planCode: z.enum(["listing", "portfolio", "venue", "enterprise"]),
  renewsAutomatically: z.literal(true).default(true),
  archiveOnExpiry: z.boolean().default(true),
});

const manualBillingNoteSchema = z.string().trim().min(2).max(1000).nullable().optional();

export const manualInvoiceIssueSchema = z.object({
  clientOperationId: z.string().uuid(),
  projectId: z.string().uuid(),
  planCode: z.enum(["listing", "portfolio", "venue", "enterprise"]),
  amountCents: z.number().int().min(0).max(100_000_000),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("MYR"),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  dueAt: z.string().datetime(),
  archiveOnExpiry: z.boolean().default(true),
  externalReference: z.string().trim().min(2).max(120).nullable().optional(),
  note: manualBillingNoteSchema,
}).superRefine((value, context) => {
  const start = Date.parse(value.periodStart);
  const end = Date.parse(value.periodEnd);
  if (end <= start) {
    context.addIssue({
      code: "custom",
      message: "Billing period end must be after the start",
      path: ["periodEnd"],
    });
  }
});

export const manualInvoiceTransitionSchema = z.object({
  clientOperationId: z.string().uuid(),
  status: z.enum(["paid", "void"]),
  paymentReference: z.string().trim().min(2).max(160).nullable().optional(),
  note: manualBillingNoteSchema,
}).superRefine((value, context) => {
  if (value.status === "paid" && !value.paymentReference) {
    context.addIssue({
      code: "custom",
      message: "A payment reference is required before activating hosting",
      path: ["paymentReference"],
    });
  }
});

export const manualSubscriptionTransitionSchema = z.object({
  clientOperationId: z.string().uuid(),
  status: z.enum(["past_due", "cancelled", "expired"]),
  note: z.string().trim().min(2).max(1000),
});

export const retentionPolicySchema = z.object({
  rawRetentionDays: z.number().int().min(0).max(3650),
  derivativeRetentionDays: z.number().int().min(1).max(3650),
  releaseRetentionDays: z.number().int().min(1).max(3650),
  deleteAfter: z.string().datetime().nullable().optional(),
  legalHold: z.boolean().default(false),
});

const point3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const polygon3Schema = z.array(point3Schema).min(3).max(2000);
const sourceToWorldTransformSchema = z.object({
  sourceUpAxis: z.enum(["Y", "Z"]),
  worldUnit: z.enum(["metres", "scene_units"]).default("metres"),
  metresPerSourceUnit: z.number().positive().max(10_000),
  yawDegrees: z.number().finite().min(-360).max(360).default(0),
  translationMetres: point3Schema.default([0, 0, 0]),
});
const sceneGeometrySchema = z.object({
  type: z.enum(["point", "polygon", "box"]),
  points: z.array(point3Schema).min(1).max(2000),
}).superRefine((geometry, context) => {
  if (geometry.type === "box" && geometry.points.length !== 2) {
    context.addIssue({
      code: "custom",
      message: "A box requires exactly two opposing corners",
      path: ["points"],
    });
  }
  if (geometry.type === "polygon" && geometry.points.length < 3) {
    context.addIssue({
      code: "custom",
      message: "A polygon requires at least three points",
      path: ["points"],
    });
  }
});

export const sceneEntitySchema = z.object({
  clientOperationId: z.string().uuid().optional(),
  versionId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  kind: z.enum(["floor", "room", "doorway", "poi"]),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  position: point3Schema.nullable().optional(),
  geometry: sceneGeometrySchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});

export const sceneEntityUpdateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  position: point3Schema.nullable().optional(),
  geometry: sceneGeometrySchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one entity field must be updated",
});

export const navigationObstacleSchema = z.object({
  clientOperationId: z.string().uuid().optional(),
  versionId: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  geometry: z.object({
    type: z.literal("box"),
    points: z.tuple([point3Schema, point3Schema]),
  }).superRefine((geometry, context) => {
    const [first, second] = geometry.points;
    if (
      Math.abs(first[0] - second[0]) < 0.01 ||
      Math.abs(first[1] - second[1]) < 0.01 ||
      Math.abs(first[2] - second[2]) < 0.01
    ) {
      context.addIssue({
        code: "custom",
        path: ["points"],
        message: "An obstacle must have non-zero width, height, and depth",
      });
    }
  }),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const navigationProfileSchema = z.object({
  versionId: z.string().uuid(),
  worldUnit: z.enum(["metres", "scene_units"]).default("metres"),
  agentRadius: z.number().min(0.05).max(2),
  agentHeight: z.number().min(0.5).max(4),
  eyeHeight: z.number().min(0.3).max(3),
  maxStepMetres: z.number().min(0.01).max(0.5),
  maxSlopeDegrees: z.number().min(0).max(89).default(45),
  maxSpeed: z.number().min(0.1).max(20).default(1.6),
  maxAcceleration: z.number().min(0.1).max(100).default(8),
}).superRefine((value, context) => {
  if (value.agentHeight <= value.agentRadius * 2) {
    context.addIssue({
      code: "custom",
      path: ["agentHeight"],
      message: "Agent height must exceed the capsule diameter",
    });
  }
  if (value.eyeHeight >= value.agentHeight) {
    context.addIssue({
      code: "custom",
      path: ["eyeHeight"],
      message: "Eye height must be lower than total agent height",
    });
  }
});

export const navigationBuildSchema = z.object({
  clientOperationId: z.string().uuid(),
  versionId: z.string().uuid(),
  collisionAssetId: z.string().uuid(),
  provisional: z.boolean().default(false),
  bounds: z.tuple([point3Schema, point3Schema]),
  spawn: z.object({
    id: z.string().trim().min(1).max(120).default("opening"),
    position: point3Schema,
  }),
  destinations: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    position: point3Schema,
  })).max(0, "Off-mesh traversal is not publishable until a browser traversal controller exists").default([]),
  offMeshConnections: z.array(z.never()).length(
    0,
    "Author traversal links on the immutable scene version; builds freeze the stored records",
  ).default([]),
  build: z.object({
    cellSize: z.number().min(0.02).max(1).default(0.1),
    cellHeight: z.number().min(0.01).max(0.5).default(0.05),
    tileSize: z.number().int().min(16).max(1024).default(32),
    maxEdgeLengthVoxels: z.number().int().min(1).max(10_000).default(12),
    maxSimplificationError: z.number().min(0).max(100).default(1.3),
    minimumRegionSizeVoxels: z.number().int().min(1).max(10_000).default(8),
    mergeRegionSizeVoxels: z.number().int().min(1).max(10_000).default(20),
  }).default({
    cellSize: 0.1,
    cellHeight: 0.05,
    tileSize: 32,
    maxEdgeLengthVoxels: 12,
    maxSimplificationError: 1.3,
    minimumRegionSizeVoxels: 8,
    mergeRegionSizeVoxels: 20,
  }),
}).superRefine((value, context) => {
  const [minimum, maximum] = value.bounds;
  if (minimum.some((coordinate, axis) => coordinate >= maximum[axis]!)) {
    context.addIssue({
      code: "custom",
      path: ["bounds"],
      message: "Navigation bounds minimum must be below maximum on every axis",
    });
  }
});

export const navigationBuildReviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().min(10).max(2000),
});

const frozenNavigationAssetSchema = <Format extends "json" | "bin">(format: Format) =>
  z.object({
    assetId: z.string().uuid(),
    format: z.literal(format),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    sizeBytes: z.number().int().positive(),
  });

export const navigationAssetsSchema = z.object({
  buildId: z.string().uuid(),
  authoringHash: z.string().regex(/^[a-f0-9]{64}$/i),
  artifact: frozenNavigationAssetSchema("json"),
  detour: frozenNavigationAssetSchema("bin"),
});

const authoredTraversalConnectionSchema = z.object({
  id: z.string().trim().min(1),
  traversalKind: z.enum(["elevator", "ladder", "moving_platform"]),
  label: z.string().trim().min(1).optional(),
  requestedStartPosition: point3Schema.optional(),
  startPosition: point3Schema,
  controlPoints: z.array(point3Schema),
  requestedEndPosition: point3Schema.optional(),
  endPosition: point3Schema,
  radius: z.number().positive(),
  bidirectional: z.boolean(),
  speedUnitsPerSecond: z.number().positive(),
  area: z.number().int().min(0).max(63),
  flags: z.number().int().min(1).max(65535),
  userId: z.number().int().min(0).max(0xffffffff),
  reviewedPurpose: z.string().trim().min(1),
  evidenceReceipt: z.object({
    assetId: z.string().uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    manifestId: z.string().uuid().optional(),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    adapter: z.string().trim().min(1).optional(),
    reviewGeneration: z.number().int().positive().optional(),
    registrationSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    sourceToWorld: sourceToWorldTransformSchema.optional(),
    sourcePath: z.array(point3Schema).min(2).optional(),
  }).superRefine((value, context) => {
    const registrationFields = [
      value.registrationSha256,
      value.sourceToWorld,
      value.sourcePath,
    ];
    if (registrationFields.some((field) => field === undefined) &&
      registrationFields.some((field) => field !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Traversal registration requires registrationSha256, sourceToWorld, and sourcePath together",
      });
    }
  }),
});

export const authoredTraversalConnectionsSchema = z.array(authoredTraversalConnectionSchema);

export const navigationTraversalCreateSchema = z.object({
  clientOperationId: z.string().uuid(),
  versionId: z.string().uuid(),
  traversalKind: z.enum(["elevator", "ladder", "moving_platform"]),
  label: z.string().trim().min(1),
  sourcePath: z.array(point3Schema).min(2),
  bidirectional: z.boolean().default(true),
  speedUnitsPerSecond: z.number().positive(),
  reviewedPurpose: z.string().trim().min(1),
  evidenceAssetId: z.string().uuid(),
  evidenceManifestId: z.string().uuid(),
}).superRefine((value, context) => {
  if (value.sourcePath.some((point, index) => index > 0 &&
    point.every((coordinate, axis) => coordinate === value.sourcePath[index - 1]![axis]))) {
    context.addIssue({
      code: "custom",
      path: ["sourcePath"],
      message: "A traversal path cannot contain a zero-length segment",
    });
  }
});

export const navigationTraversalUpdateSchema = z.object({
  traversalKind: z.enum(["elevator", "ladder", "moving_platform"]).optional(),
  label: z.string().trim().min(1).optional(),
  sourcePath: z.array(point3Schema).min(2).optional(),
  bidirectional: z.boolean().optional(),
  speedUnitsPerSecond: z.number().positive().optional(),
  reviewedPurpose: z.string().trim().min(1).optional(),
  evidenceAssetId: z.string().uuid().optional(),
  evidenceManifestId: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if (!Object.keys(value).length) {
    context.addIssue({ code: "custom", message: "At least one traversal field must be updated" });
  }
  if (value.sourcePath?.some((point, index) => index > 0 &&
    point.every((coordinate, axis) => coordinate === value.sourcePath![index - 1]![axis]))) {
    context.addIssue({
      code: "custom",
      path: ["sourcePath"],
      message: "A traversal path cannot contain a zero-length segment",
    });
  }
});

export const navigationArtifactSchema = z.object({
  schemaVersion: z.enum([
    "spatial-navigation-v6",
    "spatial-navigation-v7",
    "spatial-navigation-v8",
    "spatial-navigation-v9",
  ]),
  generator: z.object({
    name: z.literal("recast-navigation-js"),
    version: z.literal("0.43.1"),
    nativeRecastCommit: z.string().regex(/^[a-f0-9]{40}$/),
    mode: z.literal("tiled"),
  }),
  coordinateSystem: z.object({
    handedness: z.literal("right"),
    upAxis: z.literal("Y"),
    worldUnit: z.enum(["metres", "scene_units"]),
    triangleWinding: z.literal("counter-clockwise"),
  }),
  source: z.object({
    assetId: z.string().min(1).max(255),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    authoringHash: z.string().regex(/^[a-f0-9]{64}$/i),
    triangleCount: z.number().int().positive(),
    vertexCount: z.number().int().positive(),
    // The visual master an authored shell was drawn against. The Worker
    // re-checks this digest against the version's own verified master before
    // it counts as registration, so the shape is typed rather than passed
    // through untouched.
    authoredVisualBinding: z.object({
      visualMasterSha256: z.string().regex(/^[a-f0-9]{64}$/i),
      visualVersionId: z.string().uuid().optional(),
    }).strict().optional(),
  }).passthrough(),
  collisionSemantics: z.object({
    schemaVersion: z.literal("spatial-structural-collision-v1"),
    provenance: z.enum(["operator_reviewed", "registered_metric_mesh"]),
    structuralShellComplete: z.literal(true),
    includedGroups: z.array(z.enum([
      "STRUCTURAL_FLOOR",
      "STRUCTURAL_BARRIER",
      "DYNAMIC_BARRIER",
    ])).min(2),
    ignoredGroups: z.array(z.enum(["FURNITURE", "TRIGGER"])).min(1),
  }).optional(),
  dynamicBarriers: z.array(z.object({
    id: z.string().min(1).max(120),
    min: point3Schema,
    max: point3Schema,
    defaultActive: z.boolean(),
  })).max(500).optional(),
  structuralGeometry: z.object({
    schemaVersion: z.literal("authored-structural-collision-v2"),
    floorRectangles: z.array(z.object({
      id: z.string().min(1).max(120),
      min: z.tuple([z.number().finite(), z.number().finite()]),
      max: z.tuple([z.number().finite(), z.number().finite()]),
      elevation: z.number().finite(),
    })).min(1).max(2000),
    ceilingRectangles: z.array(z.object({
      id: z.string().min(1).max(120),
      min: z.tuple([z.number().finite(), z.number().finite()]),
      max: z.tuple([z.number().finite(), z.number().finite()]),
      elevation: z.number().finite(),
    })).min(1).max(2000),
    floorSurfaces: z.array(z.object({
      id: z.string().min(1).max(120),
      points: z.array(point3Schema).min(3),
      holes: z.array(z.array(point3Schema).min(3)),
    })).min(1).optional(),
    ceilingSurfaces: z.array(z.object({
      id: z.string().min(1).max(120),
      points: z.array(point3Schema).min(3),
      holes: z.array(z.array(point3Schema).min(3)),
    })).min(1).optional(),
    barrierSegments: z.array(z.object({
      id: z.string().min(1).max(120),
      start: z.tuple([z.number().finite(), z.number().finite()]),
      end: z.tuple([z.number().finite(), z.number().finite()]),
      minY: z.number().finite(),
      maxY: z.number().finite(),
    })).min(1).max(5000),
    dynamicBarrierIds: z.array(z.string().min(1).max(120)).max(500),
  }).optional(),
  movementProfiles: z.object({
    defaultMode: z.enum(["walk", "fly"]),
    supportedModes: z.tuple([
      z.literal("walk"),
      z.literal("fly"),
      z.literal("noclip"),
    ]),
    walk: z.object({
      shape: z.literal("capsule"),
      gravity: z.literal(true),
      groundSnap: z.literal(true),
      collisionGroups: z.array(z.enum([
        "STRUCTURAL_FLOOR",
        "STRUCTURAL_BARRIER",
        "DYNAMIC_BARRIER",
      ])).min(2),
      input: z.object({
        forward: z.tuple([z.literal("KeyW"), z.literal("ArrowUp")]),
        backward: z.tuple([z.literal("KeyS"), z.literal("ArrowDown")]),
        left: z.tuple([z.literal("KeyA"), z.literal("ArrowLeft")]),
        right: z.tuple([z.literal("KeyD"), z.literal("ArrowRight")]),
        boost: z.tuple([z.literal("ShiftLeft"), z.literal("ShiftRight")]),
      }),
      speedUnitsPerSecond: z.number().positive().max(20),
      boostMultiplier: z.number().min(1).max(10),
      recoveryBounds: z.tuple([point3Schema, point3Schema]),
    }),
    fly: z.object({
      shape: z.literal("sphere"),
      gravity: z.literal(false),
      groundSnap: z.literal(false),
      collisionGroups: z.array(z.enum([
        "STRUCTURAL_FLOOR",
        "STRUCTURAL_BARRIER",
        "DYNAMIC_BARRIER",
      ])).min(2),
      input: z.object({
        forward: z.tuple([z.literal("KeyW"), z.literal("ArrowUp")]),
        backward: z.tuple([z.literal("KeyS"), z.literal("ArrowDown")]),
        left: z.tuple([z.literal("KeyA"), z.literal("ArrowLeft")]),
        right: z.tuple([z.literal("KeyD"), z.literal("ArrowRight")]),
        boost: z.tuple([z.literal("ShiftLeft"), z.literal("ShiftRight")]),
        ascend: z.tuple([z.literal("Space"), z.literal("KeyE")]),
        descend: z.tuple([z.literal("KeyC"), z.literal("KeyQ")]),
      }),
      speedUnitsPerSecond: z.number().positive().max(20),
      boostMultiplier: z.number().min(1).max(10),
      recoveryBounds: z.tuple([point3Schema, point3Schema]),
    }),
    noclip: z.object({
      operatorOnly: z.literal(true),
      shape: z.literal("none"),
      gravity: z.literal(false),
      groundSnap: z.literal(false),
      collisionGroups: z.tuple([]),
      input: z.object({
        forward: z.tuple([z.literal("KeyW"), z.literal("ArrowUp")]),
        backward: z.tuple([z.literal("KeyS"), z.literal("ArrowDown")]),
        left: z.tuple([z.literal("KeyA"), z.literal("ArrowLeft")]),
        right: z.tuple([z.literal("KeyD"), z.literal("ArrowRight")]),
        boost: z.tuple([z.literal("ShiftLeft"), z.literal("ShiftRight")]),
        ascend: z.tuple([z.literal("Space"), z.literal("KeyE")]),
        descend: z.tuple([z.literal("KeyC"), z.literal("KeyQ")]),
      }),
      speedUnitsPerSecond: z.number().positive().max(20),
      boostMultiplier: z.number().min(1).max(10),
      recoveryBounds: z.tuple([point3Schema, point3Schema]),
    }),
  }).optional(),
  agent: z.object({
    radius: z.number().min(0.05).max(2),
    height: z.number().min(0.5).max(4),
    eyeHeight: z.number().min(0.3).max(3),
    maxClimb: z.number().min(0.01).max(0.5),
    maxSlopeDegrees: z.number().min(0).max(89),
    maxSpeed: z.number().min(0.1).max(20),
    maxAcceleration: z.number().min(0.1).max(100),
  }).superRefine((value, context) => {
    if (value.height <= value.radius * 2) {
      context.addIssue({
        code: "custom",
        path: ["height"],
        message: "Agent height must exceed the capsule diameter",
      });
    }
    if (value.eyeHeight >= value.height) {
      context.addIssue({
        code: "custom",
        path: ["eyeHeight"],
        message: "Eye height must be lower than total agent height",
      });
    }
  }),
  build: z.object({
    cellSize: z.number().min(0.02).max(1),
    cellHeight: z.number().min(0.01).max(0.5),
    tileSize: z.number().int().min(16).max(1024),
    maxEdgeLengthVoxels: z.number().int().min(1).max(10_000),
    maxSimplificationError: z.number().min(0).max(100),
    minimumRegionSizeVoxels: z.number().int().min(1).max(10_000),
    mergeRegionSizeVoxels: z.number().int().min(1).max(10_000),
  }),
  recastConfig: z.record(z.string(), z.unknown()),
  bounds: z.tuple([point3Schema, point3Schema]),
  spawn: z.object({
    id: z.string().min(1).max(120),
    requestedPosition: point3Schema,
    projectedPosition: point3Schema,
  }),
  offMeshConnections: z.array(authoredTraversalConnectionSchema),
  navMesh: z.object({
    clearanceApplied: z.literal(true),
    vertices: z.array(point3Schema).min(3).max(2_000_000),
    indices: z.array(z.number().int().nonnegative()).min(3).max(6_000_000),
  }),
  detour: z.object({
    format: z.literal("recast-navigation-js-export-v1"),
    byteLength: z.number().int().positive(),
    bytesBase64: z.string().min(40).max(16_000_000),
  }),
  validation: z.object({
    passed: z.literal(true),
    componentCount: z.literal(1),
    rawTriangleComponentCount: z.number().int().positive(),
    spawnProjectedDistance: z.number().nonnegative(),
    destinationCount: z.number().int().nonnegative(),
    unreachableDestinationIds: z.array(z.string()).length(0),
    destinations: z.array(z.object({
      id: z.string().min(1).max(120),
      requestedPosition: point3Schema,
      projectedPosition: point3Schema,
      reachable: z.literal(true),
      outboundReachable: z.literal(true),
      inboundReachable: z.literal(true),
      outboundPathPointCount: z.number().int().positive(),
      inboundPathPointCount: z.number().int().positive(),
    })),
  }),
  physicalValidation: z.object({
    passed: z.literal(true),
    engine: z.literal("rapier3d"),
    version: z.literal("0.19.3"),
    controller: z.literal("kinematic-capsule"),
    spawnOccupancyPassed: z.literal(true),
    routeCount: z.number().int().nonnegative(),
    failedDestinationIds: z.array(z.string()).length(0),
    routes: z.array(z.object({
      destinationId: z.string().min(1),
      direction: z.enum(["outbound", "inbound"]),
      passed: z.literal(true),
      waypointCount: z.number().int().positive(),
      simulatedSteps: z.number().int().nonnegative(),
      pathLength: z.number().nonnegative(),
      finalPosition: point3Schema,
    })),
  }).superRefine((value, context) => {
    if (value.routeCount !== value.routes.length) {
      context.addIssue({
        code: "custom",
        path: ["routeCount"],
        message: "Physical route count must match the evidence list",
      });
    }
  }),
  authoredTraversalValidation: z.object({
    passed: z.literal(true),
    engine: z.literal("rapier3d"),
    version: z.literal("0.19.3"),
    controller: z.literal("kinematic-capsule-controlled-path"),
    connectionCount: z.number().int().positive(),
    directionCount: z.number().int().positive(),
    traversals: z.array(z.object({
      connectionId: z.string().min(1),
      traversalKind: z.enum(["elevator", "ladder", "moving_platform"]),
      direction: z.enum(["forward", "reverse"]),
      waypointCount: z.number().int().min(2),
      simulatedSteps: z.number().int().positive(),
      pathLength: z.number().positive(),
      finalPosition: point3Schema,
    })).min(1),
  }).superRefine((value, context) => {
    if (value.directionCount !== value.traversals.length) {
      context.addIssue({
        code: "custom",
        path: ["directionCount"],
        message: "Traversal direction count must match the controlled-path evidence list",
      });
    }
  }).optional(),
  structuralValidation: z.object({
    passed: z.literal(true),
    engine: z.literal("rapier3d"),
    version: z.literal("0.19.3"),
    shape: z.literal("sphere"),
    ignoredFurnitureMeshCount: z.number().int().nonnegative(),
    anchorCount: z.number().int().positive(),
    probeCount: z.number().int().positive(),
    probes: z.array(z.object({
      anchorId: z.string().min(1).max(120),
      origin: point3Schema,
      direction: z.enum(["east", "west", "up", "down", "south", "north"]),
      blocked: z.literal(true),
      requestedDistance: z.number().positive(),
      actualDistance: z.number().nonnegative(),
    })).min(6),
    boundaryCount: z.number().int().nonnegative(),
    boundaryProbeCount: z.number().int().nonnegative(),
    boundaryProbes: z.array(z.object({
      barrierId: z.string().min(1).max(120),
      mode: z.enum(["walk", "fly"]),
      shape: z.enum(["capsule", "sphere"]),
      side: z.union([z.literal(-1), z.literal(1)]),
      origin: point3Schema,
      direction: point3Schema,
      requestedDistance: z.number().positive(),
      hitDistance: z.number().nonnegative(),
      blocked: z.literal(true),
    })).max(10_000),
    cornerCount: z.number().int().nonnegative(),
    cornerProbeCount: z.number().int().nonnegative(),
    cornerProbes: z.array(z.object({
      cornerId: z.string().min(1).max(120),
      origin: point3Schema,
      requestedEnd: point3Schema,
      actualEnd: point3Schema,
      blocked: z.literal(true),
      remainedInside: z.literal(true),
    })).max(10_000),
    dynamicBarrierCount: z.number().int().nonnegative(),
    dynamicBarrierProbeCount: z.number().int().nonnegative(),
    dynamicBarrierProbes: z.array(z.object({
      barrierId: z.string().min(1).max(120),
      axis: z.enum(["x", "z"]),
      open: z.object({
        physicsPassable: z.literal(true),
        routePassable: z.literal(true),
      }),
      closed: z.object({
        physicsBlocked: z.literal(true),
        routeBlocked: z.literal(true),
      }),
    })).max(500),
    boundaryTopology: z.object({
      passed: z.literal(true),
      method: z.enum([
        "explicit-closed-segment-loops-v1",
        "explicit-planar-boundary-faces-v2",
        "registered-mesh-anchor-enclosure",
      ]),
      loopCount: z.number().int().nonnegative(),
      floorComponentCount: z.number().int().nonnegative(),
      dynamicClosureCount: z.number().int().nonnegative(),
    }),
  }).superRefine((value, context) => {
    if (value.probeCount !== value.probes.length || value.probeCount !== value.anchorCount * 6) {
      context.addIssue({
        code: "custom",
        path: ["probeCount"],
        message: "Every structural anchor must have exactly six blocked sphere probes",
      });
    }
    const directionsByAnchor = new Map<string, Set<string>>();
    for (const probe of value.probes) {
      const directions = directionsByAnchor.get(probe.anchorId) ?? new Set<string>();
      directions.add(probe.direction);
      directionsByAnchor.set(probe.anchorId, directions);
    }
    if (
      directionsByAnchor.size !== value.anchorCount ||
      [...directionsByAnchor.values()].some((directions) => directions.size !== 6)
    ) {
      context.addIssue({
        code: "custom",
        path: ["probes"],
        message: "Structural probe evidence must cover all six directions once per anchor",
      });
    }
    if (
      value.boundaryProbeCount !== value.boundaryProbes.length ||
      value.boundaryProbeCount !== value.boundaryCount * 4
    ) {
      context.addIssue({
        code: "custom",
        path: ["boundaryProbeCount"],
        message: "Every reviewed structural barrier must pass opposing Walk capsule and Fly sphere sweeps",
      });
    }
    if (
      value.cornerProbeCount !== value.cornerProbes.length ||
      value.cornerProbeCount !== value.cornerCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["cornerProbeCount"],
        message: "Every reviewed structural corner must pass a capsule slide probe",
      });
    }
    if (
      value.dynamicBarrierProbeCount !== value.dynamicBarrierProbes.length ||
      value.dynamicBarrierProbeCount !== value.dynamicBarrierCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["dynamicBarrierProbeCount"],
        message: "Every dynamic barrier must prove synchronized open and closed physics and route state",
      });
    }
  }).optional(),
}).superRefine((value, context) => {
  if (["spatial-navigation-v7", "spatial-navigation-v8", "spatial-navigation-v9"].includes(value.schemaVersion)) {
    if (!value.collisionSemantics) {
      context.addIssue({
        code: "custom",
        path: ["collisionSemantics"],
        message: "V7 requires frozen structural collision semantics",
      });
    }
    if (!value.movementProfiles) {
      context.addIssue({
        code: "custom",
        path: ["movementProfiles"],
        message: "V7 requires Walk and Fly movement profiles",
      });
    }
    if (!value.structuralValidation) {
      context.addIssue({
        code: "custom",
        path: ["structuralValidation"],
        message: "V7 requires Rapier evidence that every authored anchor is enclosed by the structural shell",
      });
    } else {
      const expectedAnchors = new Map<string, [number, number, number]>([
        [value.spawn.id, [
          value.spawn.projectedPosition[0],
          value.spawn.projectedPosition[1] + value.agent.eyeHeight,
          value.spawn.projectedPosition[2],
        ]],
        ...value.validation.destinations.map((destination) => [
          destination.id,
          [
            destination.projectedPosition[0],
            destination.projectedPosition[1] + value.agent.eyeHeight,
            destination.projectedPosition[2],
          ] as [number, number, number],
        ] as const),
      ]);
      const actualAnchorIds = new Set(value.structuralValidation.probes.map((probe) => probe.anchorId));
      if (
        expectedAnchors.size !== value.validation.destinationCount + 1 ||
        value.structuralValidation.anchorCount !== expectedAnchors.size ||
        actualAnchorIds.size !== expectedAnchors.size ||
        [...expectedAnchors.keys()].some((id) => !actualAnchorIds.has(id)) ||
        [...actualAnchorIds].some((id) => !expectedAnchors.has(id))
      ) {
        context.addIssue({
          code: "custom",
          path: ["structuralValidation", "probes"],
          message: "Structural probe anchors must exactly match the spawn and every published destination",
        });
      }
      if (value.structuralGeometry && (
        !new Set([
          "explicit-closed-segment-loops-v1",
          "explicit-planar-boundary-faces-v2",
        ]).has(value.structuralValidation.boundaryTopology.method) ||
        value.structuralValidation.boundaryTopology.loopCount < 1 ||
        value.structuralValidation.boundaryTopology.floorComponentCount < 1
      )) {
        context.addIssue({
          code: "custom",
          path: ["structuralValidation", "boundaryTopology"],
          message: "Operator-authored structural surfaces require proven closed loops around every floor component",
        });
      }
      for (const probe of value.structuralValidation.probes) {
        const expected = expectedAnchors.get(probe.anchorId);
        if (!expected || probe.origin.some((coordinate, axis) =>
          Math.abs(coordinate - expected[axis]!) > 0.001
        )) {
          context.addIssue({
            code: "custom",
            path: ["structuralValidation", "probes"],
            message: `Structural probe ${probe.anchorId} has an origin that does not match its frozen navigation anchor`,
          });
          break;
        }
      }
      const expectedBarrierIds = new Set(
        value.structuralGeometry?.barrierSegments.map((barrier) => barrier.id) ?? [],
      );
      const sidesByBarrier = new Map<string, Set<string>>();
      for (const probe of value.structuralValidation.boundaryProbes) {
        const sides = sidesByBarrier.get(probe.barrierId) ?? new Set<string>();
        sides.add(`${probe.mode}:${probe.side}`);
        sidesByBarrier.set(probe.barrierId, sides);
      }
      if (
        value.structuralValidation.boundaryCount !== expectedBarrierIds.size ||
        sidesByBarrier.size !== expectedBarrierIds.size ||
        [...expectedBarrierIds].some((id) => {
          const sides = sidesByBarrier.get(id);
          return !sides ||
            !sides.has("walk:-1") || !sides.has("walk:1") ||
            !sides.has("fly:-1") || !sides.has("fly:1") || sides.size !== 4;
        }) ||
        [...sidesByBarrier.keys()].some((id) => !expectedBarrierIds.has(id))
      ) {
        context.addIssue({
          code: "custom",
          path: ["structuralValidation", "boundaryProbes"],
          message: "Structural boundary evidence must cover both sides of every frozen barrier",
        });
      }
      // Corner evidence proves the loops that enclose the floors. A shell whose
      // walls chain completely makes that equal to covering every barrier
      // endpoint, but any scene carrying observed wall fragments — automatic or
      // operator-approved — cannot chain thousands of fragments into loops, and
      // provenance says who vouched for the geometry, not how it chains. The
      // invariant that holds for every scene: every proving loop exercised,
      // one probe recorded per counted corner, and boundary probes (checked
      // above) covering both sides of every barrier.
      if (value.structuralValidation.cornerCount <
          (value.structuralValidation.boundaryTopology?.loopCount ?? 1) ||
        value.structuralValidation.cornerCount !==
          value.structuralValidation.cornerProbes.length) {
        context.addIssue({
          code: "custom",
          path: ["structuralValidation", "cornerProbes"],
          message: "Structural corner evidence must exercise every proving boundary loop",
        });
      }
      const expectedDynamicBarrierIds = new Set(
        value.dynamicBarriers?.map((barrier) => barrier.id) ?? [],
      );
      const probedDynamicBarrierIds = new Set(
        value.structuralValidation.dynamicBarrierProbes.map((probe) => probe.barrierId),
      );
      if (
        value.structuralValidation.dynamicBarrierCount !== expectedDynamicBarrierIds.size ||
        probedDynamicBarrierIds.size !== expectedDynamicBarrierIds.size ||
        [...expectedDynamicBarrierIds].some((id) => !probedDynamicBarrierIds.has(id)) ||
        value.structuralValidation.boundaryTopology.dynamicClosureCount !==
          expectedDynamicBarrierIds.size
      ) {
        context.addIssue({
          code: "custom",
          path: ["structuralValidation", "dynamicBarrierProbes"],
          message: "Dynamic barrier evidence must exactly cover every frozen barrier",
        });
      }
    }
    if (value.collisionSemantics?.provenance === "operator_reviewed" && !value.structuralGeometry) {
      context.addIssue({
        code: "custom",
        path: ["structuralGeometry"],
        message: "Operator-reviewed v7 collision requires explicit v2 floor, ceiling, and barrier metadata",
      });
    }
  }
  if (["spatial-navigation-v8", "spatial-navigation-v9"].includes(value.schemaVersion)) {
    const connectionIds = new Set(value.offMeshConnections.map((connection) => connection.id));
    if (
      connectionIds.size !== value.offMeshConnections.length ||
      value.offMeshConnections.some((connection) => {
        const path = [
          connection.startPosition,
          ...connection.controlPoints,
          connection.endPosition,
        ];
        return connection.radius < value.agent.radius || path.some((point, index) =>
          index > 0 && point.every((coordinate, axis) =>
            coordinate === path[index - 1]![axis]));
      })
    ) {
      context.addIssue({
        code: "custom",
        path: ["offMeshConnections"],
        message: "Authored traversal links require unique ids, agent clearance, and non-zero path segments",
      });
    }
    if (!value.offMeshConnections.length) {
      context.addIssue({
        code: "custom",
        path: ["offMeshConnections"],
        message: "Authored traversal artifacts require at least one traversal link",
      });
    }
    if (!value.authoredTraversalValidation) {
      context.addIssue({
        code: "custom",
        path: ["authoredTraversalValidation"],
        message: "Authored traversal artifacts require Rapier controlled-path evidence for every direction",
      });
    } else {
      const expectedDirections = new Map(value.offMeshConnections.flatMap((connection) => [
        [`${connection.id}:forward`, connection.traversalKind],
        ...(connection.bidirectional
          ? [[`${connection.id}:reverse`, connection.traversalKind] as const]
          : []),
      ] as Array<readonly [string, typeof connection.traversalKind]>));
      const actualDirections = new Map(value.authoredTraversalValidation.traversals.map((entry) => [
        `${entry.connectionId}:${entry.direction}`,
        entry.traversalKind,
      ]));
      if (
        value.authoredTraversalValidation.connectionCount !== value.offMeshConnections.length ||
        value.authoredTraversalValidation.directionCount !== expectedDirections.size ||
        actualDirections.size !== expectedDirections.size ||
        [...expectedDirections].some(([key, kind]) => actualDirections.get(key) !== kind)
      ) {
        context.addIssue({
          code: "custom",
          path: ["authoredTraversalValidation"],
          message: "Traversal evidence must exactly cover every frozen connection and direction",
        });
      }
    }
    if (value.schemaVersion === "spatial-navigation-v9" && value.offMeshConnections.some(
      (connection) => !connection.label || !connection.requestedStartPosition ||
        !connection.requestedEndPosition || !connection.evidenceReceipt.manifestId ||
        !connection.evidenceReceipt.manifestSha256 ||
        !connection.evidenceReceipt.adapter ||
        !connection.evidenceReceipt.reviewGeneration ||
        traversalProjectionDistance(connection.startPosition, connection.requestedStartPosition) >
          Math.max(value.agent.radius * 2, value.build.cellSize * 3, connection.radius) ||
        traversalProjectionDistance(connection.endPosition, connection.requestedEndPosition) >
          Math.max(value.agent.radius * 2, value.build.cellSize * 3, connection.radius),
    )) {
      context.addIssue({
        code: "custom",
        path: ["offMeshConnections"],
        message: "V9 requires requested and bounded projected landings plus a labelled capture-manifest qualification receipt on every traversal",
      });
    }
    if (value.schemaVersion === "spatial-navigation-v8" && value.offMeshConnections.some(
      (connection) => connection.requestedStartPosition !== undefined ||
        connection.requestedEndPosition !== undefined ||
        connection.evidenceReceipt.manifestId !== undefined ||
        connection.evidenceReceipt.manifestSha256 !== undefined ||
        connection.evidenceReceipt.adapter !== undefined ||
        connection.evidenceReceipt.reviewGeneration !== undefined,
    )) {
      context.addIssue({
        code: "custom",
        path: ["offMeshConnections"],
        message: "Legacy v8 traversal receipts cannot carry v9 capture qualification fields",
      });
    }
  } else if (value.offMeshConnections.length || value.authoredTraversalValidation) {
    context.addIssue({
      code: "custom",
      path: ["offMeshConnections"],
      message: "Authored traversal links require a v8 or v9 navigation artifact",
    });
  }
  if (value.collisionSemantics && (
    !value.collisionSemantics.includedGroups.includes("STRUCTURAL_FLOOR") ||
    !value.collisionSemantics.includedGroups.includes("STRUCTURAL_BARRIER") ||
    value.collisionSemantics.includedGroups.length !==
      new Set(value.collisionSemantics.includedGroups).size ||
    value.collisionSemantics.ignoredGroups.length !== 2 ||
    new Set(value.collisionSemantics.ignoredGroups).size !== 2 ||
    !value.collisionSemantics.ignoredGroups.includes("FURNITURE") ||
    !value.collisionSemantics.ignoredGroups.includes("TRIGGER")
  )) {
    context.addIssue({
      code: "custom",
      path: ["collisionSemantics"],
      message: "Structural collision must include floors and barriers while ignoring furniture",
    });
  }
  const dynamicBarrierIds = new Set((value.dynamicBarriers ?? []).map((barrier) => barrier.id));
  if (
    dynamicBarrierIds.size !== (value.dynamicBarriers?.length ?? 0) ||
    value.dynamicBarriers?.some((barrier) =>
      barrier.min.some((coordinate, axis) => coordinate >= barrier.max[axis]!))
  ) {
    context.addIssue({
      code: "custom",
      path: ["dynamicBarriers"],
      message: "Dynamic barriers require unique ids and strictly ordered bounds",
    });
  }
  if (value.collisionSemantics) {
    const dynamicGroupIncluded = value.collisionSemantics.includedGroups.includes("DYNAMIC_BARRIER");
    if (dynamicGroupIncluded !== Boolean(value.dynamicBarriers?.length)) {
      context.addIssue({
        code: "custom",
        path: ["dynamicBarriers"],
        message: "The DYNAMIC_BARRIER collision group must exactly match the frozen barrier list",
      });
    }
  }
  if (value.structuralGeometry) {
    const floorIds = new Set(value.structuralGeometry.floorRectangles.map((surface) => surface.id));
    const ceilingIds = new Set(value.structuralGeometry.ceilingRectangles.map((surface) => surface.id));
    const barrierIds = new Set(value.structuralGeometry.barrierSegments.map((barrier) => barrier.id));
    const authoredDynamicIds = value.structuralGeometry.dynamicBarrierIds;
    const floorSurfaceIds = new Set(
      value.structuralGeometry.floorSurfaces?.map((surface) => surface.id) ?? [],
    );
    const ceilingSurfaceIds = new Set(
      value.structuralGeometry.ceilingSurfaces?.map((surface) => surface.id) ?? [],
    );
    const nonHorizontalSurface = [
      ...(value.structuralGeometry.floorSurfaces ?? []),
      ...(value.structuralGeometry.ceilingSurfaces ?? []),
    ].some((surface) => {
      const elevation = surface.points[0]![1];
      return [surface.points, ...surface.holes].flat().some((point) =>
        Math.abs(point[1] - elevation) > 0.000001);
    });
    const surfaceBoundsMismatch = (
      surfaces: typeof value.structuralGeometry.floorSurfaces,
      rectangles: typeof value.structuralGeometry.floorRectangles,
    ) => {
      if (!surfaces) return false;
      const rectanglesById = new Map(rectangles.map((rectangle) => [rectangle.id, rectangle]));
      return surfaces.length !== rectangles.length || surfaces.some((surface) => {
        const rectangle = rectanglesById.get(surface.id);
        if (!rectangle) return true;
        const min = [
          Math.min(...surface.points.map((point) => point[0])),
          Math.min(...surface.points.map((point) => point[2])),
        ];
        const max = [
          Math.max(...surface.points.map((point) => point[0])),
          Math.max(...surface.points.map((point) => point[2])),
        ];
        return Math.abs(rectangle.elevation - surface.points[0]![1]) > 0.000001 ||
          min.some((coordinate, axis) => Math.abs(coordinate - rectangle.min[axis]!) > 0.000001) ||
          max.some((coordinate, axis) => Math.abs(coordinate - rectangle.max[axis]!) > 0.000001);
      });
    };
    if (
      floorIds.size !== value.structuralGeometry.floorRectangles.length ||
      ceilingIds.size !== value.structuralGeometry.ceilingRectangles.length ||
      value.structuralGeometry.floorRectangles.some((surface) =>
        surface.min.some((coordinate, axis) => coordinate >= surface.max[axis]!)) ||
      value.structuralGeometry.ceilingRectangles.some((surface) =>
        surface.min.some((coordinate, axis) => coordinate >= surface.max[axis]!)) ||
      floorSurfaceIds.size !== (value.structuralGeometry.floorSurfaces?.length ?? 0) ||
      ceilingSurfaceIds.size !== (value.structuralGeometry.ceilingSurfaces?.length ?? 0) ||
      nonHorizontalSurface ||
      surfaceBoundsMismatch(
        value.structuralGeometry.floorSurfaces,
        value.structuralGeometry.floorRectangles,
      ) ||
      surfaceBoundsMismatch(
        value.structuralGeometry.ceilingSurfaces,
        value.structuralGeometry.ceilingRectangles,
      ) ||
      barrierIds.size !== value.structuralGeometry.barrierSegments.length ||
      value.structuralGeometry.barrierSegments.some((barrier) =>
        barrier.minY >= barrier.maxY ||
        Math.hypot(
          barrier.end[0] - barrier.start[0],
          barrier.end[1] - barrier.start[1],
        ) <= 0.000001) ||
      authoredDynamicIds.length !== dynamicBarrierIds.size ||
      authoredDynamicIds.some((id, index) => id !== value.dynamicBarriers?.[index]?.id)
    ) {
      context.addIssue({
        code: "custom",
        path: ["structuralGeometry"],
        message: "Explicit structural geometry requires unique valid surfaces and exact dynamic barrier ids",
      });
    }
  }
  if (value.navMesh.indices.length % 3 !== 0) {
    context.addIssue({
      code: "custom",
      path: ["navMesh", "indices"],
      message: "Navigation debug indices must contain complete triangles",
    });
  }
  if (value.navMesh.indices.some((index) => index >= value.navMesh.vertices.length)) {
    context.addIssue({
      code: "custom",
      path: ["navMesh", "indices"],
      message: "Navigation debug indices must reference an existing vertex",
    });
  }
  try {
    if (atob(value.detour.bytesBase64).length !== value.detour.byteLength) {
      context.addIssue({
        code: "custom",
        path: ["detour", "byteLength"],
        message: "Detour byte length must match its encoded immutable payload",
      });
    }
  } catch {
    context.addIssue({
      code: "custom",
      path: ["detour", "bytesBase64"],
      message: "Detour payload must be valid base64",
    });
  }
  if (value.physicalValidation.routeCount !== value.validation.destinationCount * 2) {
    context.addIssue({
      code: "custom",
      path: ["physicalValidation", "routeCount"],
      message: "Every Detour destination must have outbound and inbound physical capsule evidence",
    });
  }
  const destinationRouteIds = value.validation.destinations
    .map((destination) => Reflect.get(destination, "id"))
    .filter((id): id is string => typeof id === "string")
    .flatMap((id) => [`${id}:inbound`, `${id}:outbound`])
    .sort();
  const physicalRouteIds = value.physicalValidation.routes
    .map((route) => `${route.destinationId}:${route.direction}`)
    .sort();
  if (JSON.stringify(destinationRouteIds) !== JSON.stringify(physicalRouteIds)) {
    context.addIssue({
      code: "custom",
      path: ["physicalValidation", "routes"],
      message: "Physical route evidence must identify both directions for every validated destination exactly once",
    });
  }
});

function traversalProjectionDistance(
  left: [number, number, number],
  right: [number, number, number],
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

export const semanticExtractionSchema = z.object({
  clientOperationId: z.string().uuid(),
  versionId: z.string().uuid(),
  inputAssetId: z.string().uuid(),
  coordinateAssurance: z.enum([
    "registered_y_up_metric_frame",
    "authored_source_to_world_v1",
  ]),
  sourceToWorld: sourceToWorldTransformSchema.optional(),
  registrationEvidence: z.string().trim().min(10).max(2000),
  gridSizeM: z.number().min(0.05).max(2).default(0.25),
  floorBandM: z.number().min(0.05).max(0.5).default(0.15),
  minimumAreaM2: z.number().min(0.25).max(10_000).default(2),
  maximumCandidates: z.number().int().min(1).max(100).default(24),
  maximumSamplePoints: z.number().int().min(1_000).max(10_000_000).default(2_000_000),
  elevationHintM: z.number().finite().nullable().optional(),
}).superRefine((value, context) => {
  if (value.coordinateAssurance === "authored_source_to_world_v1" && !value.sourceToWorld) {
    context.addIssue({
      code: "custom",
      path: ["sourceToWorld"],
      message: "An authored source-to-world transform is required for this coordinate assurance",
    });
  }
  if (value.coordinateAssurance === "registered_y_up_metric_frame" && value.sourceToWorld) {
    context.addIssue({
      code: "custom",
      path: ["sourceToWorld"],
      message: "A pre-registered Y-up metric source must not declare a second transform",
    });
  }
});

export const semanticExtractionReviewSchema = z.object({
  clientOperationId: z.string().uuid(),
  decision: z.enum(["accept_selected", "reject_all"]),
  candidateIds: z.array(z.string().uuid()).max(100)
    .transform((candidateIds) => [...new Set(candidateIds)].sort())
    .default([]),
  note: z.string().trim().min(10).max(2000),
}).superRefine((value, context) => {
  if (value.decision === "accept_selected" && value.candidateIds.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["candidateIds"],
      message: "Select at least one walkable candidate to accept",
    });
  }
  if (value.decision === "reject_all" && value.candidateIds.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["candidateIds"],
      message: "Rejecting the extraction does not accept individual candidates",
    });
  }
});

const semanticExtractionCandidateSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    elevation: record.elevation ?? record.elevationM,
    area: record.area ?? record.areaM2,
  };
}, z.object({
  candidateKey: z.string().regex(/^walkable-[0-9]{3}$/),
  kind: z.literal("walkable_region"),
  label: z.string().trim().min(1).max(120),
  elevation: z.number().finite(),
  area: z.number().positive().max(10_000_000),
  confidence: z.number().min(0).max(1),
  geometry: z.object({
    type: z.literal("polygon"),
    points: polygon3Schema,
  }),
  evidence: z.record(z.string(), z.unknown()),
}));

const semanticExtractionSummarySchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return {
    ...record,
    inferredFloorElevation:
      record.inferredFloorElevation ?? record.inferredFloorElevationM,
    totalCandidateArea:
      record.totalCandidateArea ?? record.totalCandidateAreaM2,
  };
}, z.object({
  inferredFloorElevation: z.number().finite(),
  credibleHorizontalLayerCount: z.number().int().positive(),
  candidateCount: z.number().int().min(1).max(100),
  totalCandidateArea: z.number().positive(),
}));

const semanticExtractionReportParametersSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return {
    gridSize: record.gridSize ?? record.gridSizeM,
    floorBand: record.floorBand ?? record.floorBandM,
    minimumArea: record.minimumArea ?? record.minimumAreaM2,
    maximumCandidates: record.maximumCandidates,
    elevationHint: record.elevationHint ?? record.elevationHintM ?? null,
  };
}, z.object({
  gridSize: z.number().min(0.05).max(2),
  floorBand: z.number().min(0.05).max(0.5),
  minimumArea: z.number().min(0.25).max(10_000),
  maximumCandidates: z.number().int().min(1).max(100),
  elevationHint: z.number().finite().nullable(),
}));

export const workerSemanticExtractionCompletionSchema = z.object({
  leaseToken: z.string().min(20).max(512),
  progressMessage: z.string().trim().min(2).max(500),
  output: workerOutputSchema.extend({
    kind: z.literal("report"),
    format: z.literal("json"),
  }),
  report: z.object({
    schemaVersion: z.literal("1.0.0"),
    worldUnit: z.enum(["metres", "scene_units"]).default("metres"),
    method: z.enum([
      "registered-ply-walkable-candidates-v1",
      "registered-ply-walkable-candidates-v2",
    ]),
    result: z.literal("candidates_ready"),
    source: z.record(z.string(), z.unknown()),
    parameters: semanticExtractionReportParametersSchema,
    summary: semanticExtractionSummarySchema,
    candidates: z.array(semanticExtractionCandidateSchema).min(1).max(100),
    humanReviewRequired: z.literal(true),
    limitations: z.array(z.string().trim().min(10).max(1000)).min(1).max(20),
  }).superRefine((report, context) => {
    if (report.summary.candidateCount !== report.candidates.length) {
      context.addIssue({
        code: "custom",
        path: ["summary", "candidateCount"],
        message: "Candidate count must match the candidate array",
      });
    }
  }),
  evidence: z.object({
    processorVersion: z.string().trim().min(1).max(120),
    computeDurationMs: z.number().int().nonnegative(),
    activeHumanDurationMs: z.number().int().nonnegative(),
    inputBytes: z.number().int().positive(),
    outputBytes: z.number().int().positive(),
    toolVersions: z.record(z.string(), z.string().trim().min(1).max(120)).default({}),
  }),
});

const boundedMetricSchema = z.number().finite().min(-10_000_000).max(10_000_000);
const point2MetricSchema = z.tuple([boundedMetricSchema, boundedMetricSchema]);
const floorplanKeySchema = z.string().trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);

export const floorplanExtractionSchema = z.object({
  clientOperationId: z.string().uuid(),
  versionId: z.string().uuid(),
  inputAssetId: z.string().uuid(),
  coordinateAssurance: z.literal("registered_y_up_metric_frame"),
  sourceUpAxis: z.enum(["y", "z"]).default("y"),
  registrationEvidence: z.string().trim().min(10).max(2000),
  gridSizeM: z.number().min(0.05).max(1).default(0.25),
  floorBandM: z.number().min(0.05).max(0.5).default(0.15),
  wallMinHeightM: z.number().min(0.1).max(5).default(0.25),
  wallMaxHeightM: z.number().min(0.2).max(10).default(2.5),
  minimumWallHeightCoverage: z.number().min(0.1).max(1).default(0.45),
  minimumRoomAreaM2: z.number().min(0.25).max(10_000).default(2),
  maximumOpeningWidthM: z.number().min(0.1).max(5).default(1.25),
  maximumRooms: z.number().int().min(1).max(250).default(100),
  maximumSamplePoints: z.number().int().min(1_000).max(10_000_000).default(2_000_000),
  elevationHintM: z.number().finite().nullable().optional(),
}).superRefine((value, context) => {
  if (value.wallMaxHeightM <= value.wallMinHeightM) {
    context.addIssue({
      code: "custom",
      path: ["wallMaxHeightM"],
      message: "Maximum wall height must be greater than minimum wall height",
    });
  }
  if (value.maximumOpeningWidthM < value.gridSizeM) {
    context.addIssue({
      code: "custom",
      path: ["maximumOpeningWidthM"],
      message: "Maximum opening width must be at least one grid cell",
    });
  }
});

const floorplanRoomProposalSchema = z.object({
  roomKey: z.string().regex(/^room-[0-9]{3}$/),
  kind: z.literal("room_candidate"),
  label: z.string().trim().min(1).max(120),
  elevationM: boundedMetricSchema,
  areaM2: z.number().positive().max(10_000_000),
  confidence: z.number().min(0).max(1),
  geometry: z.object({
    type: z.literal("polygon"),
    points: polygon3Schema,
  }),
  evidence: z.record(z.string(), z.unknown()),
});

const floorplanLineProposalSchema = z.object({
  label: z.string().trim().min(1).max(120),
  elevationM: boundedMetricSchema,
  confidence: z.number().min(0).max(1),
  geometry: z.object({
    type: z.literal("line"),
    points: z.array(point3Schema).length(2),
  }),
  evidence: z.record(z.string(), z.unknown()),
});

const floorplanWallProposalSchema = floorplanLineProposalSchema.extend({
  wallKey: z.string().regex(/^wall-[0-9]{3}$/),
  kind: z.literal("wall_candidate"),
  heightM: z.number().positive().max(100),
  thicknessM: z.number().positive().max(10),
});

const floorplanOpeningProposalSchema = floorplanLineProposalSchema.extend({
  openingKey: z.string().regex(/^opening-[0-9]{3}$/),
  kind: z.literal("opening_candidate"),
  widthM: z.number().positive().max(50),
  heightM: z.number().positive().max(100).nullable(),
});

const floorplanLevelProposalSchema = z.object({
  levelKey: z.string().regex(/^level-[0-9]{3}$/),
  label: z.string().trim().min(1).max(120),
  elevationM: boundedMetricSchema,
  ceilingElevationM: boundedMetricSchema.nullable(),
  roomKeys: z.array(z.string().regex(/^room-[0-9]{3}$/)).min(1).max(250),
  wallKeys: z.array(z.string().regex(/^wall-[0-9]{3}$/)).min(1).max(5_000),
  openingKeys: z.array(z.string().regex(/^opening-[0-9]{3}$/)).max(2_000),
});

const floorplanConnectorProposalSchema = z.object({
  connectorKey: z.string().regex(/^connector-[0-9]{3}$/),
  kind: z.literal("stair_or_ramp_candidate"),
  label: z.string().trim().min(1).max(120),
  lowerLevelKey: z.string().regex(/^level-[0-9]{3}$/),
  upperLevelKey: z.string().regex(/^level-[0-9]{3}$/),
  riseM: z.number().positive().max(100),
  runM: z.number().positive().max(1_000),
  widthM: z.number().positive().max(50),
  slopeDegrees: z.number().positive().max(89),
  confidence: z.number().min(0).max(1),
  geometry: z.object({
    type: z.literal("polygon"),
    points: z.array(point3Schema).length(4),
  }),
  evidence: z.record(z.string(), z.unknown()),
});

export const floorplanProposalReportSchema = z.object({
    schemaVersion: z.literal("1.0.0"),
    method: z.enum([
      "metric-pointcloud-floorplan-v1",
      "metric-pointcloud-floorplan-v2",
    ]),
    result: z.literal("proposal_ready"),
    measurementClass: z.literal("indicative"),
    source: z.record(z.string(), z.unknown()),
    parameters: z.record(z.string(), z.unknown()),
    summary: z.object({
      inferredFloorElevationM: boundedMetricSchema,
      inferredCeilingElevationM: boundedMetricSchema.nullable().optional(),
      credibleHorizontalLayerCount: z.number().int().positive(),
      wallCellCount: z.number().int().positive(),
      wallCount: z.number().int().min(1).max(5_000),
      roomCount: z.number().int().min(1).max(250),
      openingCount: z.number().int().min(0).max(2_000),
      totalRoomAreaM2: z.number().positive().max(10_000_000),
      levelCount: z.number().int().min(1).max(100).optional(),
      connectorCount: z.number().int().min(0).max(100).optional(),
    }),
    levels: z.array(floorplanLevelProposalSchema).min(1).max(100).optional(),
    connectors: z.array(floorplanConnectorProposalSchema).max(100).optional(),
    rooms: z.array(floorplanRoomProposalSchema).min(1).max(250),
    walls: z.array(floorplanWallProposalSchema).min(1).max(5_000),
    openings: z.array(floorplanOpeningProposalSchema).max(2_000),
    humanReviewRequired: z.literal(true),
    limitations: z.array(z.string().trim().min(10).max(1000)).min(1).max(20),
  }).superRefine((report, context) => {
    for (const [property, count] of [
      ["roomCount", report.rooms.length],
      ["wallCount", report.walls.length],
      ["openingCount", report.openings.length],
    ] as const) {
      if (report.summary[property] !== count) {
        context.addIssue({
          code: "custom",
          path: ["summary", property],
          message: `${property} must match its proposal array`,
        });
      }
    }
    if (report.method === "metric-pointcloud-floorplan-v2") {
      if (!report.levels || !report.connectors) {
        context.addIssue({
          code: "custom",
          path: ["levels"],
          message: "Multi-level floor-plan reports require level and connector arrays",
        });
        return;
      }
      if (report.summary.levelCount !== report.levels.length ||
        report.summary.connectorCount !== report.connectors.length) {
        context.addIssue({
          code: "custom",
          path: ["summary"],
          message: "Level and connector counts must match their proposal arrays",
        });
      }
      const levelKeys = new Set(report.levels.map((level) => level.levelKey));
      const assignedRoomKeys = report.levels.flatMap((level) => level.roomKeys);
      const assignedWallKeys = report.levels.flatMap((level) => level.wallKeys);
      const assignedOpeningKeys = report.levels.flatMap((level) => level.openingKeys);
      for (const [path, assigned, proposals] of [
        ["roomKeys", assignedRoomKeys, report.rooms.map((room) => room.roomKey)],
        ["wallKeys", assignedWallKeys, report.walls.map((wall) => wall.wallKey)],
        ["openingKeys", assignedOpeningKeys, report.openings.map((opening) => opening.openingKey)],
      ] as const) {
        if (assigned.length !== new Set(assigned).size ||
          assigned.length !== proposals.length ||
          proposals.some((key) => !assigned.includes(key))) {
          context.addIssue({
            code: "custom",
            path: ["levels", path],
            message: `Every ${path} proposal must belong to exactly one level`,
          });
        }
      }
      const elevationByLevel = new Map(report.levels.map((level) =>
        [level.levelKey, level.elevationM]));
      for (const [index, connector] of report.connectors.entries()) {
        const lower = elevationByLevel.get(connector.lowerLevelKey);
        const upper = elevationByLevel.get(connector.upperLevelKey);
        if (!levelKeys.has(connector.lowerLevelKey) ||
          !levelKeys.has(connector.upperLevelKey) || lower === undefined ||
          upper === undefined || upper <= lower ||
          Math.abs((upper - lower) - connector.riseM) > 0.05) {
          context.addIssue({
            code: "custom",
            path: ["connectors", index],
            message: "A connector must join two declared levels with matching metric rise",
          });
        }
      }
    }
  });

export const workerFloorplanExtractionCompletionSchema = z.object({
  leaseToken: z.string().min(20).max(512),
  progressMessage: z.string().trim().min(2).max(500),
  output: workerOutputSchema.extend({
    kind: z.literal("report"),
    format: z.literal("json"),
  }),
  collisionOutput: workerOutputSchema.extend({
    kind: z.literal("collision"),
    format: z.literal("glb"),
  }).optional(),
  report: floorplanProposalReportSchema,
  evidence: z.object({
    processorVersion: z.string().trim().min(1).max(120),
    computeDurationMs: z.number().int().nonnegative(),
    activeHumanDurationMs: z.number().int().nonnegative(),
    inputBytes: z.number().int().positive(),
    outputBytes: z.number().int().positive(),
    toolVersions: z.record(z.string(), z.string().trim().min(1).max(120)).default({}),
    normalization: z.object({
      sourceFormat: z.enum(["ply", "e57", "las", "laz", "pts"]),
      sourceUpAxis: z.enum(["y", "z"]),
      normalizedFormat: z.literal("ply"),
      tool: z.string().trim().min(1).max(120),
      commandDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    }),
  }),
});

const floorplanRoomSchema = z.object({
  id: floorplanKeySchema,
  label: z.string().trim().min(1).max(120),
  points: z.array(point2MetricSchema).min(3).max(2_000),
});
const floorplanWallSchema = z.object({
  id: floorplanKeySchema,
  label: z.string().trim().min(1).max(120),
  start: point2MetricSchema,
  end: point2MetricSchema,
  thicknessM: z.number().positive().max(10),
  heightM: z.number().positive().max(100),
});
const floorplanOpeningSchema = z.object({
  id: floorplanKeySchema,
  label: z.string().trim().min(1).max(120),
  type: z.enum(["door", "window", "opening", "unknown"]),
  wallId: floorplanKeySchema.nullable().optional(),
  start: point2MetricSchema,
  end: point2MetricSchema,
  widthM: z.number().positive().max(50),
  heightM: z.number().positive().max(100).nullable().optional(),
});

export const floorplanReviewPlanSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  units: z.literal("metres"),
  coordinateFrame: z.literal("registered_y_up_metric_frame"),
  levels: z.array(z.object({
    id: floorplanKeySchema,
    label: z.string().trim().min(1).max(120),
    elevationM: boundedMetricSchema,
    ceilingElevationM: boundedMetricSchema.nullable().optional(),
    rooms: z.array(floorplanRoomSchema).min(1).max(250),
    walls: z.array(floorplanWallSchema).min(1).max(5_000),
    openings: z.array(floorplanOpeningSchema).max(2_000),
  })).min(1).max(100),
  connectors: z.array(z.object({
    id: floorplanKeySchema,
    label: z.string().trim().min(1).max(120),
    type: z.enum(["stairs", "ramp", "unknown"]),
    lowerLevelId: floorplanKeySchema,
    upperLevelId: floorplanKeySchema,
    points: z.array(point3Schema).min(4).max(256),
  })).max(100).default([]),
}).superRefine((plan, context) => {
  const elevationByLevel = new Map(plan.levels.map((level) => [level.id, level.elevationM]));
  for (const [index, level] of plan.levels.entries()) {
    if (level.ceilingElevationM !== undefined && level.ceilingElevationM !== null &&
      level.ceilingElevationM - level.elevationM < 1.8) {
      context.addIssue({
        code: "custom",
        path: ["levels", index, "ceilingElevationM"],
        message: "A reviewed ceiling must be at least 1.8 metres above its floor",
      });
    }
  }
  for (const [index, connector] of plan.connectors.entries()) {
    const lower = elevationByLevel.get(connector.lowerLevelId);
    const upper = elevationByLevel.get(connector.upperLevelId);
    if (lower === undefined || upper === undefined || upper <= lower) {
      context.addIssue({
        code: "custom",
        path: ["connectors", index],
        message: "A floor-plan connector must join two declared levels in ascending order",
      });
    }
  }
});

export const floorplanExtractionReviewSchema = z.object({
  clientOperationId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().min(10).max(2000),
  plan: floorplanReviewPlanSchema.nullable().optional(),
}).superRefine((value, context) => {
  if (value.decision === "approve" && !value.plan) {
    context.addIssue({
      code: "custom",
      path: ["plan"],
      message: "An operator-corrected plan is required for approval",
    });
  }
  if (value.decision === "reject" && value.plan) {
    context.addIssue({
      code: "custom",
      path: ["plan"],
      message: "A rejected proposal must not create an approved plan",
    });
  }
});

export const floorplanCorrectionDraftSchema = z.object({
  clientOperationId: z.string().uuid(),
});

export const floorplanExportSchema = z.object({
  clientOperationId: z.string().uuid(),
  formats: z.array(z.enum(["svg", "pdf", "dxf"])).min(1).max(3)
    .transform((formats) => [...new Set(formats)].sort()),
});

export const sceneRouteSchema = z.object({
  versionId: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  accessibility: z.enum(["standard", "step_free", "restricted"]).default("standard"),
  estimatedSeconds: z.number().int().min(1).max(86400).nullable().optional(),
  stops: z.array(z.object({
    entityId: z.string().uuid(),
    cameraPose: cameraPoseSchema.nullable().optional(),
    narration: z.string().trim().max(1000).nullable().optional(),
  })).min(1).max(100),
});

export const privacyRegionSchema = z.object({
  versionId: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  geometry: z.object({ type: z.literal("polygon"), points: polygon3Schema }),
  source: z.enum(["operator", "automated"]).default("operator"),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

export const privacyRegionDecisionSchema = z.object({
  status: z.enum(["approved", "rejected", "applied"]),
});

export const privacyScanSchema = z.object({
  clientOperationId: z.string().uuid(),
  versionId: z.string().uuid(),
  assetIds: z.array(z.string().uuid()).min(1).max(12)
    .transform((assetIds) => [...new Set(assetIds)].sort()),
});

export const privacyCandidateDecisionSchema = z.object({
  status: z.enum(["confirmed", "dismissed", "resolved"]),
  note: z.string().trim().min(2).max(1000),
}).superRefine((value, context) => {
  if (value.status === "resolved" && value.note.length < 10) {
    context.addIssue({
      code: "custom",
      path: ["note"],
      message: "Resolution evidence must describe how the privacy issue was addressed",
    });
  }
});

export const changeDetectionSchema = z.object({
  clientOperationId: z.string().uuid(),
  fromVersionId: z.string().uuid(),
  toVersionId: z.string().uuid(),
  thresholdMm: z.number().min(1).max(10_000),
  coordinateAssurance: z.enum(["shared_local_frame", "registered_project_frame"]),
  registrationEvidence: z.string().trim().min(10).max(2000),
}).refine((value) => value.fromVersionId !== value.toVersionId, {
  message: "Versions must be distinct",
});

export const changeDetectionReviewSchema = z.object({
  decision: z.enum(["accepted", "needs_recapture"]),
  note: z.string().trim().min(10).max(2000),
});

export const registeredSceneChangeSchema = z.object({
  clientOperationId: z.string().uuid(),
  baselineVersionId: z.string().uuid(),
  candidateVersionId: z.string().uuid(),
  baselineAssetId: z.string().uuid(),
  candidateAssetId: z.string().uuid(),
  registrationMode: z.enum(["declared", "automatic_rigid"]).default("declared"),
  coordinateAssurance: z.enum(["shared_local_frame", "registered_project_frame"]),
  registrationEvidence: z.string().trim().min(10).max(2000),
  registrationSearchRadiusM: z.number().min(0.005).max(20).default(1),
  registrationMaximumRmseMm: z.number().min(1).max(10_000).default(100),
  registrationMinimumOverlapPercent: z.number().min(5).max(100).default(55),
  voxelSizeM: z.number().min(0.005).max(5).default(0.1),
  structuralChangeThresholdPercent: z.number().min(0).max(100).default(2),
  photometricChangeThresholdPercent: z.number().min(0).max(100).default(12),
  centroidChangeThresholdMm: z.number().min(1).max(10_000).default(50),
  maximumSamplePoints: z.number().int().min(1_000).max(10_000_000).default(2_000_000),
}).superRefine((value, context) => {
  if (value.baselineVersionId === value.candidateVersionId) {
    context.addIssue({ code: "custom", path: ["candidateVersionId"], message: "Versions must be distinct" });
  }
  if (value.baselineAssetId === value.candidateAssetId) {
    context.addIssue({ code: "custom", path: ["candidateAssetId"], message: "Assets must be distinct" });
  }
});

export const registeredSceneChangeReviewSchema = z.object({
  decision: z.enum(["accepted", "needs_recapture", "investigate"]),
  note: z.string().trim().min(10).max(2000),
});

export const workerSceneChangeCompletionSchema = z.object({
  leaseToken: z.string().min(20).max(512),
  progressMessage: z.string().trim().min(2).max(500),
  output: workerOutputSchema.extend({
    kind: z.literal("report"),
    format: z.literal("json"),
  }),
  report: z.record(z.string(), z.unknown()),
  evidence: z.object({
    processorVersion: z.string().trim().min(1).max(120),
    computeDurationMs: z.number().int().nonnegative(),
    activeHumanDurationMs: z.number().int().nonnegative(),
    baselineInputBytes: z.number().int().positive(),
    candidateInputBytes: z.number().int().positive(),
    inputBytes: z.number().int().positive(),
    outputBytes: z.number().int().positive(),
    toolVersions: z.record(z.string(), z.string().trim().min(1).max(120)).default({}),
  }),
});

export const captureCompletenessSchema = z.object({
  clientOperationId: z.string().uuid(),
  versionId: z.string().uuid(),
  // Optional binding to an immutable structure reading. Without it the
  // trajectory claim cites nothing; with it the claim is bound to the exact
  // exported scan poses it describes.
  scanStructureId: z.string().uuid().optional(),
  source: z.object({
    adapter: captureAdapterSchema,
    fileName: z.string().trim().min(1).max(255),
    format: z.literal("canonical_pose_json_v1"),
    coordinateFrame: z.string().trim().min(3).max(240),
    alignmentEvidence: z.string().trim().min(10).max(2000),
  }),
  parameters: z.object({
    coverageRadiusM: z.number().min(0.1).max(10),
    maximumSampleGapM: z.number().min(0.1).max(20),
    loopClosureRadiusM: z.number().min(0.1).max(20),
    minimumRoomCoveragePercent: z.number().min(1).max(100),
    verticalToleranceM: z.number().min(0).max(10),
  }),
  points: z.array(z.object({
    position: point3Schema,
    timestampMs: z.number().int().nonnegative().optional(),
  })).min(2).max(5000),
});

export const captureCompletenessReviewSchema = z.object({
  decision: z.enum(["accepted", "needs_recapture"]),
  note: z.string().trim().min(10).max(2000),
});

const captureBundleRoleSchema = z.enum(captureBundleRoles);

export const captureBundleManifestSchema = z.object({
  clientOperationId: z.string().uuid(),
  versionId: z.string().uuid(),
  schemaVersion: z.literal("1.0.0"),
  adapter: captureAdapterSchema,
  captureSystem: z.object({
    vendor: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(120),
    hardwareVersion: z.string().trim().max(120).nullable().optional(),
    firmwareVersion: z.string().trim().max(120).nullable().optional(),
    deviceIdHash: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
  }),
  exporter: z.object({
    name: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(120),
    exportedAt: z.string().datetime(),
    mode: z.enum(["gui", "cli", "api", "cloud"]),
    operatingSystem: z.string().trim().max(120).nullable().optional(),
  }),
  coordinateFrame: z.object({
    id: z.string().trim().min(2).max(240),
    units: z.enum(["metres", "millimetres"]),
    axisConvention: z.enum([
      "right-handed-y-up",
      "right-handed-z-up",
      "left-handed-y-up",
      "left-handed-z-up",
    ]),
    epsg: z.number().int().min(2000).max(999999).nullable().optional(),
    registrationMethod: z.string().trim().min(10).max(2000),
    sceneRegistration: z.object({
      evidenceAssetId: z.string().uuid(),
      sourceToWorld: sourceToWorldTransformSchema,
    }).optional(),
  }),
  assets: z.array(z.object({
    assetId: z.string().uuid(),
    roles: z.array(captureBundleRoleSchema).min(1).max(captureBundleRoles.length)
      .transform((roles) => [...new Set(roles)].sort()),
    description: z.string().trim().max(500).nullable().optional(),
  })).min(1).max(32).superRefine((assets, context) => {
    const assetIds = new Set<string>();
    for (const [index, asset] of assets.entries()) {
      if (assetIds.has(asset.assetId)) {
        context.addIssue({
          code: "custom",
          message: "Each asset can appear only once; assign all applicable roles to that entry",
          path: [index, "assetId"],
        });
      }
      assetIds.add(asset.assetId);
    }
  }),
  capabilities: z.object({
    rawImages: z.boolean(),
    cameraPoses: z.boolean(),
    intrinsics: z.boolean(),
    extrinsics: z.boolean(),
    imu: z.boolean(),
    gnss: z.boolean(),
    lidarPointCloud: z.boolean(),
    gaussianSplat: z.boolean(),
    collisionMesh: z.boolean(),
  }),
  rights: z.object({
    commercialUseConfirmed: z.boolean(),
    selfHostingConfirmed: z.boolean(),
    redistributionConfirmed: z.boolean(),
    evidence: z.string().trim().min(10).max(2000),
  }),
  limitations: z.array(z.string().trim().min(3).max(500)).max(20)
    .transform((items) => [...new Set(items)]).default([]),
});

export const captureBundleReviewSchema = z.object({
  decision: z.enum(["accepted", "needs_vendor_evidence", "rejected"]),
  note: z.string().trim().min(10).max(2000),
});

export const deliveryPolicySchema = z.object({
  adaptiveQuality: z.boolean().default(true),
  mobileLiteBudget: z.number().min(0.25).max(8),
  mobileStandardBudget: z.number().min(0.25).max(8),
  desktopStandardBudget: z.number().min(0.25).max(8),
  desktopHighBudget: z.number().min(0.25).max(8),
  maxInitialBytes: z.number().int().min(1_048_576).max(536_870_912),
});

export const measurementBriefSchema = z.object({
  versionId: z.string().uuid(),
  productType: z.enum(["measured_floor_plan", "scan_to_cad"]),
  intendedUse: z.string().trim().min(3).max(2000),
  units: z.enum(["metres", "millimetres"]).default("metres"),
  toleranceMm: z.number().positive().max(1000),
  relianceClass: z.enum(["indicative", "project_verified", "professional_certified"]),
  coordinateReference: z.string().trim().max(240).nullable().optional(),
  exclusions: z.string().trim().max(4000).nullable().optional(),
  acceptanceNotes: z.string().trim().max(4000).nullable().optional(),
});

export const measurementCheckPointSchema = z.object({
  label: z.string().trim().min(1).max(120),
  reference: point3Schema,
  observed: point3Schema,
  evidenceNote: z.string().trim().max(1000).nullable().optional(),
});

export const professionalSignoffSchema = z.object({
  professionalName: z.string().trim().min(2).max(160),
  registrationBody: z.string().trim().min(2).max(160),
  registrationNumber: z.string().trim().min(2).max(120),
  scope: z.string().trim().min(3).max(2000),
  signedAt: z.string().datetime(),
  evidenceAssetId: z.string().uuid().nullable().optional(),
});

export const projectCostSchema = z.object({
  briefId: z.string().uuid().nullable().optional(),
  category: z.enum(["capture_labour", "travel", "compute", "cleanup_labour", "qa_labour", "partner", "hosting", "other"]),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default("MYR"),
  quantity: z.number().nonnegative().default(1),
  unit: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  incurredAt: z.string().datetime().optional(),
});

export const releaseInputSchema = z.object({
  clientOperationId: z.string().uuid().optional(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(80),
  accessPolicy: z.enum(["public", "unlisted", "token", "customer-authenticated"]),
  expiresAt: z.string().datetime().nullable().optional(),
  sourceToWorldEvidenceId: z.string().uuid().optional(),
  viewerConfig: z.object({
    title: z.string().trim().min(1).max(120),
    subtitle: z.string().trim().max(240).optional(),
    captureDate: z.string().date().optional(),
    measurementDisclaimer: z.string().trim().min(1).max(500),
    // An unset budget must stay unset: a default here would publish every scene
    // at the same splat count and permanently bypass the viewer's device-aware
    // and delivery-policy budget selection.
    splatBudgetMillions: z.number().min(0.25).max(8).nullish(),
    defaultMovementMode: z.enum(["walk", "fly"]).default("walk"),
    sceneRotationDegrees: z.tuple([
      z.number().finite().min(SCENE_ROTATION_MIN_DEGREES).max(SCENE_ROTATION_MAX_DEGREES),
      z.number().finite().min(SCENE_ROTATION_MIN_DEGREES).max(SCENE_ROTATION_MAX_DEGREES),
      z.number().finite().min(SCENE_ROTATION_MIN_DEGREES).max(SCENE_ROTATION_MAX_DEGREES),
    ]).transform((rotation) =>
      hasNonIdentitySceneRotation(rotation) ? rotation : undefined
    ).optional(),
    sourceToWorld: sourceToWorldTransformSchema.optional(),
    initialCamera: cameraPoseSchema.optional(),
  }),
}).superRefine((value, context) => {
  if (value.viewerConfig.sceneRotationDegrees && value.viewerConfig.sourceToWorld) {
    context.addIssue({
      code: "custom",
      path: ["viewerConfig"],
      message: "Scene rotation cannot be combined with a reviewed source-to-world transform",
    });
  }
  if (value.viewerConfig.sourceToWorld && !value.sourceToWorldEvidenceId) {
    context.addIssue({
      code: "custom",
      path: ["sourceToWorldEvidenceId"],
      message: "A reviewed semantic extraction is required for a source-to-world release",
    });
  }
  if (!value.viewerConfig.sourceToWorld && value.sourceToWorldEvidenceId) {
    context.addIssue({
      code: "custom",
      path: ["sourceToWorldEvidenceId"],
      message: "Source-to-world evidence cannot be attached without a release transform",
    });
  }
  if (
    value.viewerConfig.sourceToWorld?.worldUnit === "scene_units" &&
    value.viewerConfig.measurementDisclaimer !== PROVISIONAL_MEASUREMENT_DISCLAIMER
  ) {
    context.addIssue({
      code: "custom",
      path: ["viewerConfig"],
      message:
        "Provisional releases must use the platform-authored non-measurement warning",
    });
  }
});

const telemetryBaseSchema = z.object({
  releaseId: z.string().uuid(),
  deviceProfile: z.string().max(80).optional(),
  metricValue: z.number().finite().optional(),
});

export const telemetrySchema = z.discriminatedUnion("eventType", [
  telemetryBaseSchema.extend({
    eventType: z.literal("navigation_traversal"),
    sessionId: z.string().uuid(),
    metadata: z.object({
      connectionId: z.string().trim().min(1),
      phase: z.enum(["started", "completed", "blocked"]),
    }).strict(),
  }),
  telemetryBaseSchema.extend({
    eventType: z.enum(["viewer_open", "renderer_ready", "renderer_error", "time_to_first_frame", "unsupported_device", "session_complete"]),
    sessionId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  }),
]);

export const telemetrySessionSchema = z.object({
  releaseId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
}).strict();

// Scene render sessions are renewed by presenting the scene token itself, so the
// walkthrough can keep streaming paged assets past the original token TTL.
export const sceneSessionRenewalSchema = z.object({
  token: z.string().trim().min(1).max(4096),
}).strict();

export type AuthContext = {
  userId: string;
  organisationId: string;
  email: string;
  displayName: string;
  role: "platform_admin" | "production_operator" | "customer_reviewer" | "customer_readonly";
};

// Tenant invitations awaiting an explicit accept or decline. Auto-acceptance is
// limited to first-time onboarding, so an established account sees its pending
// invitations on the login and session responses instead of being enrolled
// silently.
export type PendingOrganisationInvitation = {
  id: string;
  organisationId: string;
  organisationName: string;
  role: "platform_admin" | "production_operator";
  invitedAt: string;
  expiresAt: string;
};

export type OrganisationInvitationResponse = {
  invitation: PendingOrganisationInvitation & { status: "accepted" | "declined" };
};
