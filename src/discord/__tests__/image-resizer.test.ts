import { describe, it, expect, beforeEach, vi } from "vitest";

const mockChain = {
  resize: vi.fn(),
  png: vi.fn(),
  toBuffer: vi.fn(),
};
mockChain.resize.mockReturnValue(mockChain);
mockChain.png.mockReturnValue(mockChain);

const mockSharp = vi.fn(() => mockChain);

vi.mock("sharp", () => ({ default: mockSharp }));

const { resizeImageForVision } = await import("../image-resizer.js");

describe("resizeImageForVision", () => {
  beforeEach(() => {
    mockSharp.mockClear();
    mockChain.resize.mockClear();
    mockChain.png.mockClear();
    mockChain.toBuffer.mockClear();
    mockChain.resize.mockReturnValue(mockChain);
    mockChain.png.mockReturnValue(mockChain);
  });

  it("calls sharp with the file path, resizes to 1568px, outputs PNG", async () => {
    const buf = Buffer.from("fake-image-bytes");
    mockChain.toBuffer.mockResolvedValue(buf);

    const result = await resizeImageForVision("/tmp/screenshot.png");

    expect(result).toBe(buf);
    expect(mockSharp).toHaveBeenCalledWith("/tmp/screenshot.png");
    expect(mockChain.resize).toHaveBeenCalledWith(1568, 1568, {
      fit: "inside",
      withoutEnlargement: true,
    });
    expect(mockChain.png).toHaveBeenCalled();
    expect(mockChain.toBuffer).toHaveBeenCalled();
  });

  it("withoutEnlargement: true so small images are not upscaled", async () => {
    mockChain.toBuffer.mockResolvedValue(Buffer.alloc(4));
    await resizeImageForVision("/tmp/small.jpg");
    const [, , opts] = mockChain.resize.mock.calls[0]!;
    expect((opts as { withoutEnlargement: boolean }).withoutEnlargement).toBe(true);
  });

  it("uses fit: inside to preserve aspect ratio", async () => {
    mockChain.toBuffer.mockResolvedValue(Buffer.alloc(4));
    await resizeImageForVision("/tmp/wide.png");
    const [, , opts] = mockChain.resize.mock.calls[0]!;
    expect((opts as { fit: string }).fit).toBe("inside");
  });
});
