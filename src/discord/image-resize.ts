/**
 * Local image resize for vision pre-pass (Phase 113).
 *
 * Downsamples to ≤1568px longest side before any API call.
 * Anthropic resizes server-side anyway and bills you for the original —
 * local resize cuts upload bandwidth, latency, and token cost ~30-60%.
 *
 * Output is always JPEG (85% quality) regardless of input format,
 * which normalises mimeType for the Haiku content block call.
 */

import sharp from "sharp";

/** Anthropic's documented vision sweet spot — longest side in pixels. */
const VISION_MAX_DIM = 1568;

/**
 * Resize an image buffer for vision API submission.
 *
 * @param input  Raw image buffer (PNG, JPEG, WebP, GIF, etc.)
 * @param maxDim Maximum pixels on the longest side. Defaults to 1568.
 * @returns      Resized JPEG buffer + literal "image/jpeg" mimeType string.
 */
export async function resizeForVision(
  input: Buffer,
  maxDim: number = VISION_MAX_DIM,
): Promise<{ buffer: Buffer; mimeType: "image/jpeg" }> {
  const buffer = await sharp(input)
    .resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { buffer, mimeType: "image/jpeg" };
}
