export const projectWorkflowPolicyIds = {
  publication: ["private-review", "public-after-approval"],
  navigation: ["visitor-walk", "review-walk-and-fly"],
  measurement: ["hidden", "indicative", "controlled"],
  hosting: ["managed-optional", "managed-required"],
  quality: ["data-saver", "standard", "high-detail"],
  requiredFiles: ["visual-and-registered-geometry"],
  structureWorkflow: ["automatic-extract-review", "review-every-proposal"],
  navigationClearance: ["approved-scene", "ada-route-review", "custom"],
  // Wayfinder (#32): whether trajectory evidence may cook unresolved (type
  // "unknown") openings as passable when the scanner visited both adjacent
  // rooms. Off everywhere by default — opening walkable space on machine
  // evidence is an explicit per-project decision, not a platform default.
  trajectoryAutoOpen: ["off", "visited-rooms"],
  // Wayfinder: whether walked-floor evidence may demote extracted wall runs
  // that stand on ground the scanner was carried over. Pass-through demotion
  // alone only fires on walls the rig walked STRAIGHT THROUGH, which never
  // clears the clutter flanking an aisle. "walked-majority" demotes a run
  // whose majority sits on walked floor; "walked-contact" demotes any run
  // touching it, at the cost of also clearing a real wall the rig passed
  // close beside. Neither can enlarge the walkable world: the cook lays floor
  // only under room polygons, thresholds, and walked rectangles.
  trajectoryClutterDemotion: ["pass-through", "walked-majority", "walked-contact"],
} as const;

export type ProjectWorkflowPolicy = {
  schemaVersion: "project-workflow-policy-v1";
  publication: typeof projectWorkflowPolicyIds.publication[number];
  navigation: typeof projectWorkflowPolicyIds.navigation[number];
  measurement: typeof projectWorkflowPolicyIds.measurement[number];
  hosting: typeof projectWorkflowPolicyIds.hosting[number];
  quality: typeof projectWorkflowPolicyIds.quality[number];
  requiredFiles: typeof projectWorkflowPolicyIds.requiredFiles[number];
  structureWorkflow: typeof projectWorkflowPolicyIds.structureWorkflow[number];
  navigationClearance: typeof projectWorkflowPolicyIds.navigationClearance[number];
  trajectoryAutoOpen: typeof projectWorkflowPolicyIds.trajectoryAutoOpen[number];
  trajectoryClutterDemotion: typeof projectWorkflowPolicyIds.trajectoryClutterDemotion[number];
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
    publication: "public-after-approval",
    navigation: "visitor-walk",
    measurement: "hidden",
    hosting: "managed-optional",
    quality: "standard",
    requiredFiles: "visual-and-registered-geometry",
    structureWorkflow: "automatic-extract-review",
    navigationClearance: "approved-scene",
    trajectoryAutoOpen: "off",
    trajectoryClutterDemotion: "pass-through",
  },
  "Venue navigator": {
    schemaVersion: "project-workflow-policy-v1",
    publication: "public-after-approval",
    navigation: "visitor-walk",
    measurement: "indicative",
    hosting: "managed-required",
    quality: "standard",
    requiredFiles: "visual-and-registered-geometry",
    structureWorkflow: "review-every-proposal",
    navigationClearance: "ada-route-review",
    trajectoryAutoOpen: "off",
    trajectoryClutterDemotion: "pass-through",
  },
  "Film production scene": {
    schemaVersion: "project-workflow-policy-v1",
    publication: "private-review",
    navigation: "review-walk-and-fly",
    measurement: "hidden",
    hosting: "managed-optional",
    quality: "high-detail",
    requiredFiles: "visual-and-registered-geometry",
    structureWorkflow: "automatic-extract-review",
    navigationClearance: "custom",
    trajectoryAutoOpen: "off",
    trajectoryClutterDemotion: "pass-through",
  },
  "Measured capture pack": {
    schemaVersion: "project-workflow-policy-v1",
    publication: "private-review",
    navigation: "visitor-walk",
    measurement: "controlled",
    hosting: "managed-optional",
    quality: "high-detail",
    requiredFiles: "visual-and-registered-geometry",
    structureWorkflow: "review-every-proposal",
    navigationClearance: "approved-scene",
    trajectoryAutoOpen: "off",
    trajectoryClutterDemotion: "pass-through",
  },
};

export const legacyUnspecifiedProjectWorkflowPolicy: ProjectWorkflowPolicy = {
  schemaVersion: "project-workflow-policy-v1",
  publication: "private-review",
  navigation: "review-walk-and-fly",
  measurement: "hidden",
  hosting: "managed-optional",
  quality: "standard",
  requiredFiles: "visual-and-registered-geometry",
  structureWorkflow: "review-every-proposal",
  navigationClearance: "custom",
  trajectoryAutoOpen: "off",
  trajectoryClutterDemotion: "pass-through",
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

export function trajectoryAutoOpenEnabled(
  policy: ProjectWorkflowPolicy,
): boolean {
  return policy.trajectoryAutoOpen === "visited-rooms";
}

export type TrajectoryClutterDemotionMode = Exclude<
  ProjectWorkflowPolicy["trajectoryClutterDemotion"],
  "pass-through"
>;

// The walked-floor demotion mode this policy asks the cook for, or null when
// pass-through evidence alone governs wall removal.
export function trajectoryClutterDemotionMode(
  policy: ProjectWorkflowPolicy,
): TrajectoryClutterDemotionMode | null {
  return policy.trajectoryClutterDemotion === "pass-through"
    ? null
    : policy.trajectoryClutterDemotion;
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
    trajectoryAutoOpen: policy.trajectoryAutoOpen ?? "off",
    trajectoryClutterDemotion: policy.trajectoryClutterDemotion ?? "pass-through",
  };
  for (const [field, values] of Object.entries(projectWorkflowPolicyIds)) {
    if (!(values as readonly unknown[]).includes(normalized[field])) return null;
  }
  return normalized as ProjectWorkflowPolicy;
}
