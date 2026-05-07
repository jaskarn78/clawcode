import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { resizeForVision } from "../image-resize.js";

async function makeTestImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 100, g: 150, b: 200 } },
  })
    .png()
    .toBuffer();
}

describe("resizeForVision", () => {
  it("always returns mimeType image/jpeg", async () => {
    const input = await makeTestImage(800, 600);
    const { mimeType } = await resizeForVision(input);
    expect(mimeType).toBe("image/jpeg");
  });

  it("resizes so the longest side is ≤1568 when input exceeds limit", async () => {
    const input = await makeTestImage(2000, 1500);
    const { buffer } = await resizeForVision(input);
    const meta = await sharp(buffer).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1568);
  });

  it("preserves aspect ratio after resize", async () => {
    const input = await makeTestImage(3000, 1000); // 3:1 ratio
    const { buffer } = await resizeForVision(input);
    const meta = await sharp(buffer).metadata();
    const ratio = meta.width! / meta.height!;
    expect(ratio).toBeCloseTo(3, 0);
  });

  it("does not upscale images smaller than maxDim", async () => {
    const input = await makeTestImage(800, 600);
    const { buffer } = await resizeForVision(input);
    const meta = await sharp(buffer).metadata();
    expect(meta.width!).toBeLessThanOrEqual(800);
    expect(meta.height!).toBeLessThanOrEqual(600);
  });

  it("respects a custom maxDim", async () => {
    const input = await makeTestImage(2000, 1000);
    const { buffer } = await resizeForVision(input, 800);
    const meta = await sharp(buffer).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(800);
  });

  it("returns a non-empty buffer", async () => {
    const input = await makeTestImage(400, 300);
    const { buffer } = await resizeForVision(input);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
