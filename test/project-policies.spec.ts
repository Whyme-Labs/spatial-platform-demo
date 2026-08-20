import { describe, expect, it } from "vitest";
import {
  normalizeProjectDeliveryTemplate,
  parseProjectWorkflowPolicy,
  projectPolicyForDeliveryTemplate,
  projectWorkflowPolicyIds,
  structureWorkflowAllowsAutomaticProposal,
} from "../src/shared/project-policies";

describe("behavior-driving project policies", () => {
  it("maps each supported delivery classification to a complete workflow policy", () => {
    const policies = [
      "Property showcase",
      "Venue navigator",
      "Film production scene",
      "Measured capture pack",
    ].map(projectPolicyForDeliveryTemplate);

    expect(policies).toEqual([
      {
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
        trajectoryAutoOpen: "off",
      },
      {
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
        trajectoryAutoOpen: "off",
      },
      {
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
        trajectoryAutoOpen: "off",
      },
      {
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
        trajectoryAutoOpen: "off",
      },
    ]);
  });

  it("keeps every policy dimension closed and machine-readable", () => {
    expect(projectWorkflowPolicyIds).toEqual({
      privacyReview: ["standard", "strict"],
      publication: ["private-review", "public-after-approval"],
      navigation: ["visitor-walk", "review-walk-and-fly"],
      measurement: ["hidden", "indicative", "controlled"],
      hosting: ["managed-optional", "managed-required"],
      quality: ["data-saver", "standard", "high-detail"],
      requiredFiles: ["visual-and-registered-geometry"],
      structureWorkflow: ["automatic-extract-review", "review-every-proposal"],
      navigationClearance: ["approved-scene", "ada-route-review", "custom"],
      trajectoryAutoOpen: ["off", "visited-rooms"],
    });
  });

  it("lets only exception review advance directly from a machine proposal", () => {
    expect(structureWorkflowAllowsAutomaticProposal("automatic-extract-review")).toBe(true);
    expect(structureWorkflowAllowsAutomaticProposal("review-every-proposal")).toBe(false);
  });

  it("fills newly behavior-driving dimensions on valid legacy v1 policy rows", () => {
    expect(parseProjectWorkflowPolicy({
      schemaVersion: "project-workflow-policy-v1",
      privacyReview: "strict",
      publication: "private-review",
      navigation: "visitor-walk",
      measurement: "hidden",
      hosting: "managed-optional",
      quality: "standard",
    })).toMatchObject({
      requiredFiles: "visual-and-registered-geometry",
      structureWorkflow: "automatic-extract-review",
      navigationClearance: "approved-scene",
      trajectoryAutoOpen: "off",
    });
  });

  it("rejects unknown delivery classifications instead of silently applying another policy", () => {
    expect(() => projectPolicyForDeliveryTemplate("Unknown delivery")).toThrow(
      "Unknown project delivery template: Unknown delivery",
    );
  });

  it("normalizes each documented legacy identifier explicitly", () => {
    expect(normalizeProjectDeliveryTemplate("indoor-experience")).toBe("Property showcase");
    expect(normalizeProjectDeliveryTemplate("property-tour")).toBe("Property showcase");
    expect(normalizeProjectDeliveryTemplate("venue-navigator")).toBe("Venue navigator");
    expect(normalizeProjectDeliveryTemplate("operations-twin")).toBe("Measured capture pack");
    expect(normalizeProjectDeliveryTemplate("measured-floor-plan")).toBe("Measured capture pack");
  });
});
