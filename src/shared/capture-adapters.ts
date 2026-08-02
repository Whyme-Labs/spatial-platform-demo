export const captureAdapterIds = [
  "xgrids-lcc",
  "fjd-trion",
  "phone-video",
  "drone-imagery",
  "open-import",
] as const;

export type CaptureAdapterId = typeof captureAdapterIds[number];

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
  "metric_point_cloud",
  "collision_mesh",
] as const;

export type CaptureAssetPurpose = typeof captureAssetPurposes[number];

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
    summary: "Preserve FJD SLAM capture, open point-cloud exports, source imagery, and portable Gaussian masters.",
    evidence: [
      "Immutable FJDSLAM or vendor project",
      "Metric E57, LAS, LAZ, PTS, or PLY point cloud",
      "Portable Gaussian PLY, SPZ, or SOG",
      "Images and calibrated transforms when exported",
    ],
    nativeInputs: [
      "fjdslam", "ply", "spz", "sog", "splat", "ksplat", "rad", "e57", "las", "laz", "pts", "jpg", "jpeg",
      "png", "webp", "zip", "json", "csv", "yaml", "yml",
    ],
    limitations: [
      "The platform records exported evidence and does not infer calibration accuracy.",
      "FJD vendor projects remain evidence unless a compatible portable Gaussian master is also supplied.",
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
  metric_point_cloud: ["ply", "e57", "las", "laz", "pts"],
  collision_mesh: ["glb", "gltf", "obj", "ply"],
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
  metric_point_cloud: "pointcloud",
  collision_mesh: "collision",
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
