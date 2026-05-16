/**
 * Image resize helper for the vision pre-pass pipeline (Phase 113).
 *
 * Anthropic bills based on image pixel count. Resizing to ≤1568px on the
 * longest side before the Haiku vision call cuts billed pixel cost ~30-60%
 * with negligible quality loss for screenshot analysis.
 */

import sharp from "sharp";

const MAX_SIDE_PX = 1568;

/**
 * Resize an image file so neither dimension exceeds 1568px.
 * Preserves aspect ratio. Does not upscale images already within bounds.
 * Output is PNG (lossless, consistent with screenshot content).
 */
export async function resizeImageForVision(filePath: string): Promise<Buffer> {
  return sharp(filePath)
    .resize(MAX_SIDE_PX, MAX_SIDE_PX, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}
