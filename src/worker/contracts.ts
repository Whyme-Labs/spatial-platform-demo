import { z } from "zod";
import {
  captureAdapterIds,
  captureAssetFormats,
  captureAssetPurposes,
} from "../shared/capture-adapters";
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

export const uploadInputSchema = z.object({
  clientOperationId: z.string().uuid().optional(),
  fileName: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  format: z.enum(captureAssetFormats),
  purpose: z.enum(captureAssetPurposes).optional(),
  mimeType: z.string().trim().min(1).max(120),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
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

export const workerJobCompletionSchema = z.object({
  leaseToken: z.string().min(20).max(512),
  progressMessage: z.string().trim().min(2).max(500),
  outputs: z.array(workerOutputSchema).max(20).default([]),
  report: z.record(z.string(), z.unknown()).default({}),
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
}).superRefine((value, context) => {
  if (value.eyeHeight >= value.agentHeight) {
    context.addIssue({
      code: "custom",
      path: ["eyeHeight"],
      message: "Eye height must be lower than total agent height",
    });
  }
});

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

const semanticExtractionCandidateSchema = z.object({
  candidateKey: z.string().regex(/^walkable-[0-9]{3}$/),
  kind: z.literal("walkable_region"),
  label: z.string().trim().min(1).max(120),
  elevationM: z.number().finite(),
  areaM2: z.number().positive().max(10_000_000),
  confidence: z.number().min(0).max(1),
  geometry: z.object({
    type: z.literal("polygon"),
    points: polygon3Schema,
  }),
  evidence: z.record(z.string(), z.unknown()),
});

export const workerSemanticExtractionCompletionSchema = z.object({
  leaseToken: z.string().min(20).max(512),
  progressMessage: z.string().trim().min(2).max(500),
  output: workerOutputSchema.extend({
    kind: z.literal("report"),
    format: z.literal("json"),
  }),
  report: z.object({
    schemaVersion: z.literal("1.0.0"),
    method: z.enum([
      "registered-ply-walkable-candidates-v1",
      "registered-ply-walkable-candidates-v2",
    ]),
    result: z.literal("candidates_ready"),
    source: z.record(z.string(), z.unknown()),
    parameters: z.record(z.string(), z.unknown()),
    summary: z.object({
      inferredFloorElevationM: z.number().finite(),
      credibleHorizontalLayerCount: z.number().int().positive(),
      candidateCount: z.number().int().min(1).max(100),
      totalCandidateAreaM2: z.number().positive(),
    }),
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

export const floorplanProposalReportSchema = z.object({
    schemaVersion: z.literal("1.0.0"),
    method: z.literal("metric-pointcloud-floorplan-v1"),
    result: z.literal("proposal_ready"),
    measurementClass: z.literal("indicative"),
    source: z.record(z.string(), z.unknown()),
    parameters: z.record(z.string(), z.unknown()),
    summary: z.object({
      inferredFloorElevationM: boundedMetricSchema,
      credibleHorizontalLayerCount: z.number().int().positive(),
      wallCellCount: z.number().int().positive(),
      wallCount: z.number().int().min(1).max(5_000),
      roomCount: z.number().int().min(1).max(250),
      openingCount: z.number().int().min(0).max(2_000),
      totalRoomAreaM2: z.number().positive().max(10_000_000),
    }),
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
  });

export const workerFloorplanExtractionCompletionSchema = z.object({
  leaseToken: z.string().min(20).max(512),
  progressMessage: z.string().trim().min(2).max(500),
  output: workerOutputSchema.extend({
    kind: z.literal("report"),
    format: z.literal("json"),
  }),
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
    rooms: z.array(floorplanRoomSchema).min(1).max(250),
    walls: z.array(floorplanWallSchema).min(1).max(5_000),
    openings: z.array(floorplanOpeningSchema).max(2_000),
  })).min(1).max(100),
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
    splatBudgetMillions: z.number().min(0.25).max(8).default(2),
    sceneRotationDegrees: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
    sourceToWorld: sourceToWorldTransformSchema.optional(),
    initialCamera: cameraPoseSchema.optional(),
  }),
}).superRefine((value, context) => {
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
});

export const telemetrySchema = z.object({
  releaseId: z.string().uuid(),
  eventType: z.enum(["viewer_open", "renderer_ready", "renderer_error", "time_to_first_frame", "unsupported_device", "session_complete"]),
  sessionId: z.string().uuid().optional(),
  deviceProfile: z.string().max(80).optional(),
  metricValue: z.number().finite().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

export type AuthContext = {
  userId: string;
  organisationId: string;
  email: string;
  displayName: string;
  role: "platform_admin" | "production_operator" | "customer_reviewer" | "customer_readonly";
};
