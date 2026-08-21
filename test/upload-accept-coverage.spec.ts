// The file picker must offer every format the upload purposes accept.
// A narrower filter silently hides evidence the platform asks for — a
// Gaussian-only accept list made metric point clouds and scanner
// trajectories unselectable while the purpose menu still offered them.
import { describe, expect, it } from "vitest";
import {
  captureAssetFormats,
  captureAssetPurposes,
  captureFileExtensionsForFormat,
  captureFormatsForPurpose,
} from "../src/shared/capture-adapters";

describe("upload file picker coverage", () => {
  it("covers every extension every purpose can accept", () => {
    const offered = new Set(
      captureAssetFormats
        .flatMap((format) => captureFileExtensionsForFormat(format))
        .map((extension) => `.${extension}`),
    );
    for (const purpose of captureAssetPurposes) {
      for (const format of captureFormatsForPurpose(purpose)) {
        for (const extension of captureFileExtensionsForFormat(format)) {
          expect(offered.has(`.${extension}`)).toBe(true);
        }
      }
    }
  });
});
