import { describe, expect, it } from "vitest";
import {
  captureAdapterDisplayLabel,
  captureAdapterProfiles,
  planCaptureAssetImport,
} from "../src/shared/capture-adapters";

describe("capture adapter import contract", () => {
  it("publishes one device-neutral profile for every supported capture path", () => {
    expect(captureAdapterProfiles.map((profile) => profile.id)).toEqual([
      "xgrids-lcc",
      "fjd-trion",
      "phone-video",
      "drone-imagery",
      "open-import",
    ]);
    expect(captureAdapterProfiles.every((profile) => profile.evidence.length > 0)).toBe(true);
    expect(captureAdapterDisplayLabel("xgrids-lcc")).toBe("XGRIDS Lixel / LCC");
    expect(captureAdapterDisplayLabel("future-device")).toBe("Future Device");
  });

  it("routes only compatible Gaussian masters into Spark reconstruction", () => {
    expect(planCaptureAssetImport({
      adapter: "xgrids-lcc",
      purpose: "gaussian_splat",
      format: "ply",
    })).toMatchObject({
      accepted: true,
      jobType: "asset.validate",
      assetKind: "master",
      browserRenderable: false,
    });

    expect(planCaptureAssetImport({
      adapter: "fjd-trion",
      purpose: "metric_point_cloud",
      format: "e57",
    })).toMatchObject({
      accepted: true,
      jobType: "asset.evidence-validate",
      assetKind: "pointcloud",
      browserRenderable: false,
    });

    expect(planCaptureAssetImport({
      adapter: "drone-imagery",
      purpose: "source_images",
      format: "zip",
    })).toMatchObject({
      accepted: true,
      jobType: "asset.evidence-validate",
      assetKind: "source",
      browserRenderable: false,
    });
  });

  it("accepts prebuilt Spark scenes as web assets without rebuilding them", () => {
    for (const format of ["rad", "spz", "sog"] as const) {
      expect(planCaptureAssetImport({
        adapter: "open-import",
        purpose: "web_scene",
        format,
      })).toMatchObject({
        accepted: true,
        jobType: "asset.evidence-validate",
        assetKind: "web",
        browserRenderable: true,
      });
    }
  });

  it("accepts portable calibration evidence for every calibrated capture path", () => {
    for (const adapter of ["xgrids-lcc", "fjd-trion", "phone-video", "drone-imagery"]) {
      expect(planCaptureAssetImport({
        adapter: adapter as "xgrids-lcc" | "fjd-trion" | "phone-video" | "drone-imagery",
        purpose: "calibration",
        format: "yaml",
      })).toMatchObject({
        accepted: true,
        jobType: "asset.evidence-validate",
        assetKind: "source",
      });
    }
  });

  it("rejects incompatible declarations before any bytes are uploaded", () => {
    expect(planCaptureAssetImport({
      adapter: "phone-video",
      purpose: "gaussian_splat",
      format: "mp4",
    })).toMatchObject({
      accepted: false,
      reason: expect.stringContaining("mp4"),
    });

    expect(planCaptureAssetImport({
      adapter: "fjd-trion",
      purpose: "web_scene",
      format: "e57",
    })).toMatchObject({
      accepted: false,
      reason: expect.stringContaining("web"),
    });
  });
});
