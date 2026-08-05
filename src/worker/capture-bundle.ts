import type { SourceToWorldTransform } from "../shared/navigation-runtime";

export const captureBundleRoles = [
  "vendor_project",
  "raw_capture",
  "source_images",
  "camera_poses",
  "calibration",
  "imu_trajectory",
  "gnss_trajectory",
  "metric_point_cloud",
  "gaussian_splat",
  "collision_mesh",
  "vendor_semantic_mesh",
  "traversal_evidence",
] as const;

export type CaptureBundleRole = typeof captureBundleRoles[number];

export type CaptureBundleAssetEvidence = {
  id: string;
  roles: CaptureBundleRole[];
  kind: string;
  format: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
};

export type CaptureBundleCapabilities = {
  rawImages: boolean;
  cameraPoses: boolean;
  intrinsics: boolean;
  extrinsics: boolean;
  imu: boolean;
  gnss: boolean;
  lidarPointCloud: boolean;
  gaussianSplat: boolean;
  collisionMesh: boolean;
};

export type CaptureBundleRights = {
  commercialUseConfirmed: boolean;
  selfHostingConfirmed: boolean;
  redistributionConfirmed: boolean;
  evidence: string;
};

export type CaptureBundleValidationIssue = {
  code: string;
  severity: "blocker" | "warning";
  message: string;
  assetId?: string;
};

export type CaptureBundleValidation = {
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
  issues: CaptureBundleValidationIssue[];
  limitations: string[];
};

const roleCompatibility: Record<CaptureBundleRole, {
  kinds: string[];
  formats?: string[];
}> = {
  vendor_project: {
    kinds: ["source"],
  },
  raw_capture: {
    kinds: ["source"],
  },
  source_images: {
    kinds: ["source"],
    formats: ["zip", "jpg", "jpeg", "png"],
  },
  camera_poses: {
    kinds: ["source", "report"],
    formats: ["json", "csv"],
  },
  calibration: {
    kinds: ["source", "report"],
    formats: ["json", "yaml", "yml"],
  },
  imu_trajectory: {
    kinds: ["source", "report"],
    formats: ["json", "csv"],
  },
  gnss_trajectory: {
    kinds: ["source", "report"],
    formats: ["json", "csv"],
  },
  metric_point_cloud: {
    kinds: ["source", "master", "pointcloud"],
    formats: ["ply", "e57", "las", "laz", "pts"],
  },
  gaussian_splat: {
    kinds: ["source", "master", "web", "portable"],
    formats: ["ply", "spz", "sog", "rad", "lcc", "lcc2"],
  },
  collision_mesh: {
    kinds: ["source", "master", "collision"],
    formats: ["glb", "gltf", "obj", "ply"],
  },
  // A vendor's classified mesh or segmentation sidecar is preserved verbatim
  // under its own role. It is never promoted to collision_mesh: that would
  // assert a physical claim from labels this platform does not decode.
  vendor_semantic_mesh: {
    kinds: ["source", "master", "report"],
    formats: ["obj", "ply", "glb", "gltf", "e57", "json", "csv", "zip"],
  },
  traversal_evidence: {
    kinds: ["source", "master", "pointcloud", "collision", "report"],
  },
};

const capabilityRoles: Array<{
  capability: keyof CaptureBundleCapabilities;
  roles: CaptureBundleRole[];
  label: string;
}> = [
  { capability: "rawImages", roles: ["source_images"], label: "raw images" },
  { capability: "cameraPoses", roles: ["camera_poses"], label: "camera poses" },
  { capability: "intrinsics", roles: ["calibration"], label: "camera intrinsics" },
  { capability: "extrinsics", roles: ["calibration"], label: "camera extrinsics" },
  { capability: "imu", roles: ["imu_trajectory"], label: "IMU trajectory" },
  { capability: "gnss", roles: ["gnss_trajectory"], label: "GNSS trajectory" },
  { capability: "lidarPointCloud", roles: ["metric_point_cloud"], label: "metric point cloud" },
  { capability: "gaussianSplat", roles: ["gaussian_splat"], label: "Gaussian splat" },
  { capability: "collisionMesh", roles: ["collision_mesh"], label: "collision mesh" },
];

export function validateCaptureBundle(input: {
  assets: CaptureBundleAssetEvidence[];
  capabilities: CaptureBundleCapabilities;
  rights: CaptureBundleRights;
  exporterMode: "gui" | "cli" | "api" | "cloud";
  coordinateUnits: "metres" | "millimetres";
  coordinateAxisConvention:
    | "right-handed-y-up"
    | "right-handed-z-up"
    | "left-handed-y-up"
    | "left-handed-z-up";
  sceneRegistration?: {
    evidenceAssetId: string;
    sourceToWorld: SourceToWorldTransform;
  };
  declaredLimitations: string[];
}): CaptureBundleValidation {
  const issues: CaptureBundleValidationIssue[] = [];
  const roles = new Set(input.assets.flatMap((asset) => asset.roles));

  for (const asset of input.assets) {
    for (const role of asset.roles) {
      const compatibility = roleCompatibility[role];
      const format = asset.format.toLowerCase();
      if (
        !compatibility.kinds.includes(asset.kind) ||
        (compatibility.formats && !compatibility.formats.includes(format))
      ) {
        issues.push({
          code: "asset_role_mismatch",
          severity: "blocker",
          message: `${asset.fileName} (${asset.kind}/${format}) cannot evidence ${role}.`,
          assetId: asset.id,
        });
      }
    }
  }

  if (!roles.has("raw_capture") && !roles.has("vendor_project")) {
    issues.push({
      code: "capture_source_missing",
      severity: "blocker",
      message: "At least one immutable raw-capture or vendor-project asset is required.",
    });
  }

  for (const declaration of capabilityRoles) {
    if (
      input.capabilities[declaration.capability] &&
      !declaration.roles.some((role) => roles.has(role))
    ) {
      issues.push({
        code: "capability_evidence_missing",
        severity: "blocker",
        message: `The manifest declares ${declaration.label}, but no compatible immutable asset evidences it.`,
      });
    }
  }

  for (const [confirmed, label] of [
    [input.rights.commercialUseConfirmed, "commercial use"],
    [input.rights.selfHostingConfirmed, "self-hosting"],
    [input.rights.redistributionConfirmed, "derived-asset redistribution"],
  ] as const) {
    if (!confirmed) {
      issues.push({
        code: "rights_not_confirmed",
        severity: "blocker",
        message: `Written ${label} rights have not been confirmed.`,
      });
    }
  }

  if (!input.capabilities.gaussianSplat) {
    issues.push({
      code: "renderable_master_missing",
      severity: "warning",
      message: "No portable Gaussian-splat master is declared; browser delivery requires another reconstruction step.",
    });
  }
  if (!input.capabilities.lidarPointCloud) {
    issues.push({
      code: "metric_geometry_missing",
      severity: "warning",
      message: "No metric point cloud is declared; measurement and registration claims remain unsupported.",
    });
  }
  const independentlyReconstructable =
    input.capabilities.rawImages &&
    input.capabilities.cameraPoses &&
    input.capabilities.intrinsics &&
    input.capabilities.extrinsics;
  if (!independentlyReconstructable) {
    issues.push({
      code: "reconstruction_inputs_incomplete",
      severity: "warning",
      message: "Images, poses, intrinsics, and extrinsics are not all preserved as immutable evidence.",
    });
  }
  const automationReady = input.exporterMode === "cli" || input.exporterMode === "api";
  if (!automationReady) {
    issues.push({
      code: "export_not_automatable",
      severity: "warning",
      message: "The recorded export mode is interactive; unattended pipeline support is not evidenced.",
    });
  }
  if (input.coordinateUnits !== "metres") {
    issues.push({
      code: "coordinate_normalisation_required",
      severity: "warning",
      message: "The source frame uses millimetres and must be normalised to metres at the platform boundary.",
    });
  }

  const registrationIssueCount = issues.length;
  if (!input.sceneRegistration) {
    issues.push({
      code: "scene_registration_missing",
      severity: "warning",
      message: "No numerical capture-to-scene transform is registered; traversal evidence cannot be physically qualified.",
    });
  } else {
    const registrationAsset = input.assets.find(
      (asset) => asset.id === input.sceneRegistration!.evidenceAssetId,
    );
    if (!registrationAsset) {
      issues.push({
        code: "scene_registration_evidence_missing",
        severity: "blocker",
        message: "The capture-to-scene transform must cite one immutable asset in this manifest.",
        assetId: input.sceneRegistration.evidenceAssetId,
      });
    }
    const expectedUpAxis = input.coordinateAxisConvention.endsWith("y-up") ? "Y" : "Z";
    if (input.sceneRegistration.sourceToWorld.sourceUpAxis !== expectedUpAxis) {
      issues.push({
        code: "scene_registration_axis_mismatch",
        severity: "blocker",
        message: `The numerical transform declares ${input.sceneRegistration.sourceToWorld.sourceUpAxis}-up but the capture frame declares ${expectedUpAxis}-up.`,
      });
    }
    if (input.coordinateAxisConvention.startsWith("left-handed")) {
      issues.push({
        code: "scene_registration_handedness_unsupported",
        severity: "blocker",
        message: "The current capture-to-scene transform is rigid right-handed; a left-handed capture requires an adapter-authored handedness conversion.",
      });
    }
    if (input.sceneRegistration.sourceToWorld.worldUnit !== "metres") {
      issues.push({
        code: "scene_registration_world_unit_invalid",
        severity: "blocker",
        message: "A physically qualified capture must map into the scene's metric world frame.",
      });
    }
    const expectedScale = input.coordinateUnits === "metres" ? 1 : 0.001;
    if (input.sceneRegistration.sourceToWorld.metresPerSourceUnit !== expectedScale) {
      issues.push({
        code: "scene_registration_scale_mismatch",
        severity: "blocker",
        message: `The capture frame units require metresPerSourceUnit=${expectedScale}, requested ${input.sceneRegistration.sourceToWorld.metresPerSourceUnit}.`,
      });
    }
  }
  const sceneRegistered = Boolean(input.sceneRegistration) && issues.length === registrationIssueCount;

  const blockers = issues.filter((issue) => issue.severity === "blocker").length;
  const result = blockers
    ? "blocked"
    : issues.length
      ? "ready_with_warnings"
      : "ready";
  return {
    method: "capture-bundle-contract-v1",
    result,
    summary: {
      assetCount: input.assets.length,
      totalBytes: input.assets.reduce((total, asset) => total + asset.sizeBytes, 0),
      roleCount: roles.size,
      renderableNow: input.capabilities.gaussianSplat && roles.has("gaussian_splat"),
      metricReady: input.capabilities.lidarPointCloud && roles.has("metric_point_cloud"),
      reconstructionPortable:
        input.capabilities.gaussianSplat &&
        roles.has("gaussian_splat") &&
        input.rights.selfHostingConfirmed &&
        input.rights.redistributionConfirmed,
      independentlyReconstructable,
      automationReady,
      sceneRegistered,
    },
    issues,
    limitations: [
      ...input.declaredLimitations,
      ...(roles.has("vendor_semantic_mesh")
        ? [
          "Vendor semantic exports are preserved as immutable evidence only. Their classification semantics — indoor wall, floor, and ceiling labels — are NOT parsed, and no structural, collision, or navigation claim derives from them pending a registered indoor vendor corpus.",
        ]
        : []),
      "This manifest proves what the operator registered and the platform preserved; it does not independently verify scanner origin, calibration accuracy, reconstruction quality, or vendor licence terms.",
    ],
  };
}
