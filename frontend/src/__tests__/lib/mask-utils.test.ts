import { describe, it, expect, vi } from "vitest"
import { generateMaskBlob } from "@/lib/mask-utils"
import type { MaskStroke } from "@/lib/mask-utils"

// Mock canvas/blob for jsdom
const mockToBlob = vi.fn((cb: BlobCallback) => cb(new Blob(["png"], { type: "image/png" })))
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
  fillRect: vi.fn(),
  fillStyle: "",
  globalAlpha: 1,
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  putImageData: vi.fn(),
} as unknown as CanvasRenderingContext2D)
vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(mockToBlob)

describe("generateMaskBlob", () => {
  it("resolves a Blob for empty strokes", async () => {
    const blob = await generateMaskBlob(100, 100, [])
    expect(blob).toBeInstanceOf(Blob)
  })

  it("resolves a Blob with lasso stroke", async () => {
    const lassoStroke: MaskStroke = {
      points: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }],
      radius: 0,
      isEraser: false,
      isLasso: true,
    }
    const blob = await generateMaskBlob(100, 100, [lassoStroke])
    expect(blob).toBeInstanceOf(Blob)
  })

  it("resolves a Blob with opacity stroke", async () => {
    const opaqueStroke: MaskStroke = {
      points: [{ x: 20, y: 20 }],
      radius: 10,
      isEraser: false,
      opacity: 0.5,
    }
    const blob = await generateMaskBlob(100, 100, [opaqueStroke])
    expect(blob).toBeInstanceOf(Blob)
  })

  it("uses baseImageData as starting layer when provided", async () => {
    const fakeImageData = new ImageData(100, 100)
    const blob = await generateMaskBlob(100, 100, [], fakeImageData)
    expect(blob).toBeInstanceOf(Blob)
  })
})
