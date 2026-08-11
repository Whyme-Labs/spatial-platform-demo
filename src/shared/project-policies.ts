export const projectWorkflowPolicyIds = {
  privacyReview: ["standard", "strict"],
  publication: ["private-review", "public-after-approval"],
  navigation: ["visitor-walk", "review-walk-and-fly"],
  measurement: ["hidden", "indicative", "controlled"],
  hosting: ["managed-optional", "managed-required"],
  quality: ["data-saver", "standard", "high-detail"],
  requiredFiles: ["visual-and-registered-geometry"],
  structureWorkflow: ["automatic-extract-review", "review-every-proposal"],
  navigationClearance: ["approved-scene", "ada-route-review", "custom"],
} as const;

export type ProjectWorkflowPolicy = {
  schemaVersion: "project-workflow-policy-v1";
  privacyReview: typeof projectWorkflowPolicyIds.privacyReview[number];
  publication: typeof projectWorkflowPolicyIds.publication[number];
  navigation: typeof projectWorkflowPolicyIds.navigation[number];
  measurement: typeof projectWorkflowPolicyIds.measurement[number];
  hosting: typeof projectWorkflowPolicyIds.hosting[number];
  quality: typeof projectWorkflowPolicyIds.quality[number];
  requiredFiles: typeof projectWorkflowPolicyIds.requiredFiles[number];
  structureWorkflow: typeof projectWorkflowPolicyIds.structureWorkflow[number];
  navigationClearance: typeof projectWorkflowPolicyIds.navigationClearance[number];
};

export const projectDeliveryTemplates = [
  "Property showcase",
  "Venue navigator",
  "Film production scene",
  "Measured capture pack",
] as const;

export type ProjectDeliveryTemplate = typeof projectDeliveryTemplates[number];

export const legacyProjectDeliveryTemplateAliases = {
  "indoor-experience": "Property showcase",
  "property-tour": "Property showcase",
  "venue-navigator": "Venue navigator",
  "operations-twin": "Measured capture pack",
  "measured-floor-plan": "Measured capture pack",
} as const satisfies Record<string, ProjectDeliveryTemplate>;

export const projectDeliveryTemplateInputs = [
  ...projectDeliveryTemplates,
  ...Object.keys(legacyProjectDeliveryTemplateAliases),
] as [string, ...string[]];

export function normalizeProjectDeliveryTemplate(deliveryTemplate: string): ProjectDeliveryTemplate {
  if ((projectDeliveryTemplates as readonly string[]).includes(deliveryTemplate)) {
    return deliveryTemplate as ProjectDeliveryTemplate;
  }
  const canonical = legacyProjectDeliveryTemplateAliases[
    deliveryTemplate as keyof typeof legacyProjectDeliveryTemplateAliases
  ];
  if (canonical) return canonical;
  throw new RangeError(`Unknown project delivery template: ${deliveryTemplate}`);
}

const deliveryPolicies: Record<ProjectDeliveryTemplate, ProjectWorkflowPolicy> = {
  "Property showcase": {
    schemaVersion: "project-workflow-policy-v1",
    privacyReview: "strict",
    publication: "public-after-approval",
    navigation: "visitor-walk",
    measurement: "hidden",
    hosting: "managed-optional",
    quality: "standard",
    requiredFiles: "visual-and-registered-geometry",
    structureWorkflow: "automatic-extract-review",
    navigationClearance: "approved-scene",
  },
  "Venue navigator": {
    schemaVersion: "project-workflow-policy-v1",
    privacyReview: "strict",
    publication: "public-after-approval",
    navigation: "visitor-walk",
    measurement: "indicative",
    hosting: "managed-required",
    quality: "standard",
    requiredFiles: "visual-and-registered-geometry",
    structureWorkflow: "review-every-proposal",
    navigationClearance: "ada-route-review",
  },
  "Film production scene": {
    schemaVersion: "project-workflow-policy-v1",
    privacyReview: "standard",
    publication: "private-review",
    navigation: "review-walk-and-fly",
    measurement: "hidden",
    hosting: "managed-optional",
    quality: "high-detail",
    requiredFiles: "visual-and-registered-geometry",
    structureWorkflow: "automatic-extract-review",
    navigationClearance: "custom",
  },
  "Measured capture pack": {
    schemaVersion: "project-workflow-policy-v1",
    privacyReview: "strict",
    publication: "private-review",
    navigation: "visitor-walk",
    measurement: "controlled",
    hosting: "managed-optional",
    quality: "high-detail",
    requiredFiles: "visual-and-registered-geometry",
    structureWorkflow: "review-every-proposal",
    navigationClearance: "approved-scene",
  },
};

export const legacyUnspecifiedProjectWorkflowPolicy: ProjectWorkflowPolicy = {
  schemaVersion: "project-workflow-policy-v1",
  privacyReview: "strict",
  publication: "private-review",
  navigation: "review-walk-and-fly",
  measurement: "hidden",
  hosting: "managed-optional",
  quality: "standard",
  requiredFiles: "visual-and-registered-geometry",
  structureWorkflow: "review-every-proposal",
  navigationClearance: "custom",
};

export function projectPolicyForDeliveryTemplate(deliveryTemplate: string): ProjectWorkflowPolicy {
  return deliveryPolicies[normalizeProjectDeliveryTemplate(deliveryTemplate)];
}

export function projectPolicyForPersistedDeliveryTemplate(
  deliveryTemplate: string,
): ProjectWorkflowPolicy {
  try {
    return projectPolicyForDeliveryTemplate(deliveryTemplate);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return legacyUnspecifiedProjectWorkflowPolicy;
  }
}

export function structureWorkflowAllowsAutomaticProposal(
  workflow: ProjectWorkflowPolicy["structureWorkflow"],
): boolean {
  return workflow === "automatic-extract-review";
}

export function parseProjectWorkflowPolicy(value: unknown): ProjectWorkflowPolicy | null {
  if (!value || typeof value !== "object") return null;
  const policy = value as Record<string, unknown>;
  if (policy.schemaVersion !== "project-workflow-policy-v1") return null;
  const normalized: Record<string, unknown> = {
    ...policy,
    requiredFiles: policy.requiredFiles ?? "visual-and-registered-geometry",
    structureWorkflow: policy.structureWorkflow ?? "automatic-extract-review",
    navigationClearance: policy.navigationClearance ?? "approved-scene",
  };
  for (const [field, values] of Object.entries(projectWorkflowPolicyIds)) {
    if (!(values as readonly unknown[]).includes(normalized[field])) return null;
  }
  return normalized as ProjectWorkflowPolicy;
}
