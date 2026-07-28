const DEFAULT_BACKGROUND = [11, 17, 14];

export function analysePosterSample(
  pixels,
  {
    background = DEFAULT_BACKGROUND,
    minimumSignalDelta = 12,
  } = {},
) {
  if (!(pixels instanceof Uint8ClampedArray) && !(pixels instanceof Uint8Array)) {
    throw new TypeError("Poster pixels must be an RGBA byte array");
  }
  if (pixels.length === 0 || pixels.length % 4 !== 0) {
    throw new RangeError("Poster pixels must contain one or more RGBA pixels");
  }
  if (!Array.isArray(background) || background.length !== 3) {
    throw new TypeError("Poster background must contain three RGB values");
  }

  let signalPixels = 0;
  let minimumLuminance = 255;
  let maximumLuminance = 0;
  const colourBuckets = new Set();
  const pixelCount = pixels.length / 4;

  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    if (alpha === 0) continue;

    const delta =
      Math.abs(red - background[0]) +
      Math.abs(green - background[1]) +
      Math.abs(blue - background[2]);
    if (delta >= minimumSignalDelta) signalPixels += 1;

    const luminance = Math.round((red * 54 + green * 183 + blue * 19) / 256);
    minimumLuminance = Math.min(minimumLuminance, luminance);
    maximumLuminance = Math.max(maximumLuminance, luminance);
    colourBuckets.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
  }

  return {
    pixelCount,
    signalPixels,
    signalFraction: signalPixels / pixelCount,
    luminanceRange: maximumLuminance - minimumLuminance,
    colourBucketCount: colourBuckets.size,
  };
}

export function posterSampleIsReady(stats) {
  return stats.signalFraction >= 0.01 &&
    stats.luminanceRange >= 8 &&
    stats.colourBucketCount >= 4;
}
