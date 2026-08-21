export const captureAdapterIds = [
  "xgrids-lcc",
  "fjd-trion",
  "phone-video",
  "drone-imagery",
  "open-import",
] as const;

export type CaptureAdapterId = typeof captureAdapterIds[number];

export const captureOriginIds = [
  "xgrids",
  "fjd",
  "phone",
  "drone",
  "third-party",
] as const;

export type CaptureOriginId = typeof captureOriginIds[number];

export const assetProducerIds = [
  "xgrids-lcc",
  "fjd-trion",
  "open-import",
] as const;

export type AssetProducerId = typeof assetProducerIds[number];

export function captureOriginForLegacyAdapter(adapter: CaptureAdapterId): CaptureOriginId {
  if (adapter === "xgrids-lcc") return "xgrids";
  if (adapter === "fjd-trion") return "fjd";
  if (adapter === "phone-video") return "phone";
  if (adapter === "drone-imagery") return "drone";
  return "third-party";
}

export function assetProducerForLegacyAdapter(adapter: CaptureAdapterId): AssetProducerId | null {
  return assetProducerIds.includes(adapter as AssetProducerId)
    ? adapter as AssetProducerId
    : null;
}

export function captureAdapterForOrigin(origin: CaptureOriginId): CaptureAdapterId {
  if (origin === "xgrids") return "xgrids-lcc";
  if (origin === "fjd") return "fjd-trion";
  if (origin === "phone") return "phone-video";
  if (origin === "drone") return "drone-imagery";
  return "open-import";
}

export const captureAssetPurposes = [
  "gaussian_splat",
  "web_scene",
  "vendor_project",
  "raw_capture",
  "source_images",
  "source_video",
  "camera_poses",
  "calibration",
  "imu_trajectory",
  "gnss_trajectory",
  // The scanner's SLAM pose path as the vendor exports it (FJD Trion
  // `.trajectory.las`). Distinct from imu_trajectory/gnss_trajectory (raw
  // sensor streams, JSON/CSV) and from the capture-completeness JSON lane:
  // this is registered metric pose evidence in the capture's own frame.
  "scanner_trajectory",
  "metric_point_cloud",
  "collision_mesh",
  "vendor_semantic_mesh",
] as const;

export type CaptureAssetPurpose = typeof captureAssetPurposes[number];

const existingVersionAttachmentPurposes = new Set<CaptureAssetPurpose>([
  "vendor_project",
  "raw_capture",
  "source_images",
  "source_video",
  "camera_poses",
  "calibration",
  "imu_trajectory",
  "gnss_trajectory",
  "scanner_trajectory",
  "metric_point_cloud",
  "collision_mesh",
  "vendor_semantic_mesh",
]);

export function captureAssetPurposeCanAttachToExistingVersion(
  purpose: CaptureAssetPurpose,
): boolean {
  return existingVersionAttachmentPurposes.has(purpose);
}

export const captureAssetFormats = [
  "ply",
  "spz",
  "sog",
  "splat",
  "ksplat",
  "zip",
  "rad",
  "lcc",
  "lcc2",
  "xbin",
  "fjdslam",
  "e57",
  "las",
  "laz",
  "pts",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "mp4",
  "mov",
  "webm",
  "json",
  "csv",
  "yaml",
  "yml",
  "glb",
  "gltf",
  "obj",
] as const;

export type CaptureAssetFormat = typeof captureAssetFormats[number];

const fileExtensionsByFormat: Partial<
  Record<CaptureAssetFormat, readonly string[]>
> = {
  fjdslam: ["fjdslam", "fjdslamp2"],
};

export function captureFileExtensionsForFormat(
  format: CaptureAssetFormat,
): readonly string[] {
  return fileExtensionsByFormat[format] ?? [format];
}

export function captureFileNameMatchesFormat(
  fileName: string,
  format: CaptureAssetFormat,
): boolean {
  const lowerFileName = fileName.toLowerCase();
  return captureFileExtensionsForFormat(format).some((extension) =>
    lowerFileName.endsWith(`.${extension}`)
  );
}

export function captureFormatForFileName(
  fileName: string,
  formats: readonly CaptureAssetFormat[] = captureAssetFormats,
): CaptureAssetFormat | null {
  return formats.find((format) => captureFileNameMatchesFormat(fileName, format)) ?? null;
}

export type CaptureAdapterProfile = {
  id: CaptureAdapterId;
  label: string;
  summary: string;
  evidence: string[];
  nativeInputs: CaptureAssetFormat[];
  limitations: string[];
};

export const captureAdapterProfiles: CaptureAdapterProfile[] = [
  {
    id: "xgrids-lcc",
    label: "XGRIDS Lixel / LCC",
    summary: "Preserve scanner-native capture, LCC exports, metric geometry, and portable Gaussian masters.",
    evidence: [
      "Immutable XBIN or vendor project",
      "Metric point-cloud export",
      "Portable Gaussian master",
      "Images, poses, and calibration when the licensed exporter provides them",
    ],
    nativeInputs: [
      "xbin", "lcc", "lcc2", "ply", "spz", "sog", "splat", "ksplat", "rad", "e57", "las", "laz", "zip",
      "jpg", "jpeg", "png", "webp", "json", "csv", "yaml", "yml",
    ],
    limitations: [
      "LCC and LCC2 are preserved as vendor evidence; Spark does not decode them.",
      "Camera-pose and calibration availability must be confirmed for the licensed software build.",
    ],
  },
  {
    id: "fjd-trion",
    label: "FJD Trion",
    summary: "Preserve FJD SLAM capture, open point-cloud exports, source imagery, vendor semantic exports, and portable Gaussian masters.",
    evidence: [
      "Immutable FJDSLAM or vendor project",
      "Metric E57, LAS, LAZ, PTS, or PLY point cloud",
      "Structured E57 scan poses, image records, and point-field inventory read from the public ASTM container",
      "Portable Gaussian PLY, SPZ, or SOG",
      "Images and calibrated transforms when exported",
      "Vendor semantic exports — classified mesh or segmentation sidecars — preserved verbatim",
    ],
    nativeInputs: [
      "fjdslam", "ply", "spz", "sog", "splat", "ksplat", "rad", "e57", "las", "laz", "pts", "jpg", "jpeg",
      "png", "webp", "zip", "json", "csv", "yaml", "yml", "obj", "glb", "gltf",
    ],
    limitations: [
      "The platform records exported evidence and does not infer calibration accuracy.",
      "FJD vendor projects remain evidence unless a compatible portable Gaussian master is also supplied.",
      "Structured E57 readings cover the public ASTM container only: scan poses, bounds, image representation types, and point-field names. Vendor extension field names are recorded verbatim and never decoded.",
      "FJD classified mesh and segmentation semantics — indoor wall, floor, and ceiling labels — are NOT parsed. These exports are preserved as immutable evidence pending a registered indoor FJD corpus that documents the actual exported dimensions and pose records.",
    ],
  },
  {
    id: "phone-video",
    label: "Phone / video capture",
    summary: "Preserve the original video or image sequence and add reconstruction outputs as separate immutable assets.",
    evidence: [
      "Original video or image sequence",
      "Capture-device metadata",
      "Camera poses and calibration when available",
      "Portable Gaussian master after reconstruction",
    ],
    nativeInputs: [
      "mp4", "mov", "webm", "zip", "jpg", "jpeg", "png", "webp", "json", "csv",
      "yaml", "yml",
    ],
    limitations: [
      "Source video is not itself browser-renderable spatial geometry.",
      "Metric scale and camera calibration require explicit evidence.",
    ],
  },
  {
    id: "drone-imagery",
    label: "Drone imagery",
    summary: "Preserve aerial imagery, flight metadata, calibration, control, and each derived spatial asset independently.",
    evidence: [
      "Original aerial image or video set",
      "Flight, camera, and GNSS metadata",
      "Control and registration evidence",
      "Portable Gaussian and metric outputs after reconstruction",
    ],
    nativeInputs: [
      "zip", "jpg", "jpeg", "png", "mp4", "mov", "json", "csv", "yaml", "yml",
      "e57", "las", "laz", "ply",
    ],
    limitations: [
      "Uploading imagery does not prove flight permission, survey control, or metric accuracy.",
      "A separate reconstruction stage is required before browser delivery.",
    ],
  },
  {
    id: "open-import",
    label: "Open / existing data",
    summary: "Import compatible masters and evidence from another capture or reconstruction pipeline.",
    evidence: [
      "Immutable source or vendor export",
      "Declared coordinate units and frame",
      "Portable Gaussian or metric master",
      "Commercial-use and self-hosting rights",
    ],
    nativeInputs: [...captureAssetFormats],
    limitations: [
      "The platform validates integrity and declared compatibility, not the origin or accuracy of third-party data.",
    ],
  },
];

export function captureAdapterDisplayLabel(adapter: string): string {
  const profile = captureAdapterProfiles.find((candidate) => candidate.id === adapter);
  if (profile) return profile.label;
  return adapter.split("-").map((part) =>
    part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : ""
  ).join(" ");
}

export type CaptureAssetImportPlan =
  | {
    accepted: true;
    jobType: "asset.validate" | "asset.evidence-validate";
    assetKind: "source" | "master" | "web" | "pointcloud" | "collision";
    browserRenderable: boolean;
  }
  | {
    accepted: false;
    reason: string;
  };

const formatsByPurpose: Record<CaptureAssetPurpose, readonly CaptureAssetFormat[]> = {
  gaussian_splat: ["ply", "spz", "sog", "splat", "ksplat", "zip"],
  web_scene: ["rad", "spz", "sog"],
  vendor_project: ["zip", "xbin", "fjdslam", "lcc", "lcc2"],
  raw_capture: ["zip", "xbin", "fjdslam"],
  source_images: ["zip", "jpg", "jpeg", "png", "webp"],
  source_video: ["mp4", "mov", "webm"],
  camera_poses: ["json", "csv"],
  calibration: ["json", "yaml", "yml"],
  imu_trajectory: ["json", "csv"],
  gnss_trajectory: ["json", "csv"],
  scanner_trajectory: ["las", "laz"],
  metric_point_cloud: ["ply", "e57", "las", "laz", "pts"],
  collision_mesh: ["glb", "gltf", "obj", "ply"],
  vendor_semantic_mesh: ["obj", "ply", "glb", "gltf", "e57", "json", "csv", "zip"],
};

const assetKindByPurpose: Record<CaptureAssetPurpose, "source" | "master" | "web" | "pointcloud" | "collision"> = {
  gaussian_splat: "master",
  web_scene: "web",
  vendor_project: "source",
  raw_capture: "source",
  source_images: "source",
  source_video: "source",
  camera_poses: "source",
  calibration: "source",
  imu_trajectory: "source",
  gnss_trajectory: "source",
  scanner_trajectory: "source",
  metric_point_cloud: "pointcloud",
  collision_mesh: "collision",
  vendor_semantic_mesh: "source",
};

export function captureFormatsForPurpose(purpose: CaptureAssetPurpose): readonly CaptureAssetFormat[] {
  return formatsByPurpose[purpose];
}

export function planCaptureAssetImport(input: {
  adapter: CaptureAdapterId;
  purpose: CaptureAssetPurpose;
  format: CaptureAssetFormat;
}): CaptureAssetImportPlan {
  const compatibleFormats = formatsByPurpose[input.purpose];
  if (!compatibleFormats.includes(input.format)) {
    return {
      accepted: false,
      reason: `${input.format} is not compatible with the ${input.purpose.replaceAll("_", " ")} import purpose.`,
    };
  }
  const profile = captureAdapterProfiles.find((candidate) => candidate.id === input.adapter);
  if (!profile || !profile.nativeInputs.includes(input.format)) {
    return {
      accepted: false,
      reason: `${input.format} is not declared as a supported ${profile?.label ?? input.adapter} input.`,
    };
  }
  return {
    accepted: true,
    jobType: input.purpose === "gaussian_splat" ? "asset.validate" : "asset.evidence-validate",
    assetKind: assetKindByPurpose[input.purpose],
    browserRenderable: input.purpose === "web_scene",
  };
}

export function planProducedAssetImport(input: {
  producer: AssetProducerId;
  purpose: CaptureAssetPurpose;
  format: CaptureAssetFormat;
}): CaptureAssetImportPlan {
  return planCaptureAssetImport({
    adapter: input.producer,
    purpose: input.purpose,
    format: input.format,
  });
}

// Operators should not have to restate what a filename already says. Each rule
// below is a name or extension that maps to exactly ONE purpose in practice;
// genuinely ambiguous inputs (a .ply that could be a Gaussian master or metric
// geometry, a .glb that could be collision or a vendor semantic export) return
// null so the operator still chooses. Detection is a default, never a lock:
// the dialog shows what it inferred and the picker stays editable.
const purposeByFileNamePattern: ReadonlyArray<{
  test: (lowerFileName: string) => boolean;
  purpose: CaptureAssetPurpose;
}> = [
  // Name wins over extension: a Trion trajectory is a LAS whose name says so.
  { test: (name) => /trajector(y|ies)/.test(name) && /\.(las|laz)$/.test(name), purpose: "scanner_trajectory" },
  { test: (name) => /\.(las|laz|e57|pts)$/.test(name), purpose: "metric_point_cloud" },
  { test: (name) => name.endsWith(".rad"), purpose: "web_scene" },
  { test: (name) => /\.(spz|sog|splat|ksplat)$/.test(name), purpose: "gaussian_splat" },
  { test: (name) => /\.(fjdslam|fjdslamp2|xbin|lcc|lcc2)$/.test(name), purpose: "vendor_project" },
  { test: (name) => /\.(mp4|mov|webm)$/.test(name), purpose: "source_video" },
  { test: (name) => /\.(jpg|jpeg|png|webp)$/.test(name), purpose: "source_images" },
];

export function inferCaptureAssetPurpose(fileName: string): CaptureAssetPurpose | null {
  const lowerFileName = fileName.toLowerCase();
  return purposeByFileNamePattern.find((rule) => rule.test(lowerFileName))?.purpose ?? null;
}
