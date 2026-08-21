// Filename-driven purpose detection: it must be right often enough to remove
// the two dropdowns from the common path, and silent whenever the name is
// genuinely ambiguous rather than guessing at the operator's expense.
import { describe, expect, it } from "vitest";
import { inferCaptureAssetPurpose } from "../src/shared/capture-adapters";

describe("inferCaptureAssetPurpose", () => {
  it("reads a scanner trajectory by name, not just extension", () => {
    expect(inferCaptureAssetPurpose("2026-08-12-17-14-01_2.trajectory.las"))
      .toBe("scanner_trajectory");
    expect(inferCaptureAssetPurpose("SEGMENTED.CLEAN1.TRAJECTORY.LAZ"))
      .toBe("scanner_trajectory");
  });

  it("treats a plain LAS/E57/PTS as metric geometry", () => {
    for (const name of ["2026-08-12-17-14-01_2.las", "scan.e57", "site.pts", "cloud.laz"]) {
      expect(inferCaptureAssetPurpose(name)).toBe("metric_point_cloud");
    }
  });

  it("separates a prepared web scene from a portable master", () => {
    expect(inferCaptureAssetPurpose("scene.rad")).toBe("web_scene");
    expect(inferCaptureAssetPurpose("master.spz")).toBe("gaussian_splat");
    expect(inferCaptureAssetPurpose("master.sog")).toBe("gaussian_splat");
  });

  it("recognises vendor projects, video, and imagery", () => {
    expect(inferCaptureAssetPurpose("capture.fjdslam")).toBe("vendor_project");
    expect(inferCaptureAssetPurpose("room.lcc2")).toBe("vendor_project");
    expect(inferCaptureAssetPurpose("walkthrough.mp4")).toBe("source_video");
    expect(inferCaptureAssetPurpose("frame-001.jpg")).toBe("source_images");
  });

  it("stays silent on genuinely ambiguous names", () => {
    // .ply is both the Gaussian master and a metric point-cloud export;
    // .glb/.obj are both collision geometry and vendor semantic exports.
    for (const name of ["model.ply", "collision.glb", "mesh.obj", "poses.json", "notes.txt"]) {
      expect(inferCaptureAssetPurpose(name)).toBeNull();
    }
  });

  it("never infers a purpose outside the declared vocabulary", async () => {
    const { captureAssetPurposes } = await import("../src/shared/capture-adapters");
    for (const name of ["a.las", "b.trajectory.las", "c.rad", "d.mp4", "e.fjdslam"]) {
      const inferred = inferCaptureAssetPurpose(name);
      expect(inferred && captureAssetPurposes.includes(inferred)).toBe(true);
    }
  });
});
