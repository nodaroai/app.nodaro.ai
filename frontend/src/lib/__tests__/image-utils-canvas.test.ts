import { describe, it, expect, vi, beforeEach } from "vitest"

// --- Canvas API mocks ---

const mockDrawImage = vi.fn()
const mockBeginPath = vi.fn()
const mockMoveTo = vi.fn()
const mockLineTo = vi.fn()
const mockClosePath = vi.fn()
const mockClip = vi.fn()
const mockClearRect = vi.fn()
const mockSave = vi.fn()
const mockRestore = vi.fn()

const mockContext = {
  drawImage: mockDrawImage,
  beginPath: mockBeginPath,
  moveTo: mockMoveTo,
  lineTo: mockLineTo,
  closePath: mockClosePath,
  clip: mockClip,
  clearRect: mockClearRect,
  save: mockSave,
  restore: mockRestore,
  fillStyle: "",
  globalCompositeOperation: "",
}

const mockToBlob = vi.fn()
const mockCanvas = {
  getContext: vi.fn(() => mockContext),
  toBlob: mockToBlob,
  width: 0,
  height: 0,
}

vi.stubGlobal("document", {
  ...document,
  createElement: vi.fn((tag: string) => {
    if (tag === "canvas") return mockCanvas
    return document.createElement(tag)
  }),
})

import {
  cropImageElementToBlob,
  cropPolygonToBlob,
} from "../image-utils"

// Helper: create a mock HTMLImageElement-like object
function makeImg(naturalWidth = 800, naturalHeight = 600): HTMLImageElement {
  return { naturalWidth, naturalHeight } as unknown as HTMLImageElement
}

describe("cropImageElementToBlob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanvas.width = 0
    mockCanvas.height = 0
    mockToBlob.mockImplementation((cb: (blob: Blob | null) => void) => {
      cb(new Blob(["test"], { type: "image/png" }))
    })
    mockCanvas.getContext.mockReturnValue(mockContext)
  })

  it("sets canvas dimensions to the crop region size", async () => {
    const img = makeImg()
    const box = { x: 10, y: 20, width: 200, height: 150 }

    await cropImageElementToBlob(img, box)

    expect(mockCanvas.width).toBe(200)
    expect(mockCanvas.height).toBe(150)
  })

  it("calls drawImage with correct source and destination parameters", async () => {
    const img = makeImg()
    const box = { x: 50, y: 60, width: 300, height: 200 }

    await cropImageElementToBlob(img, box)

    expect(mockDrawImage).toHaveBeenCalledWith(
      img,
      50, 60, 300, 200, // source rect
      0, 0, 300, 200,   // destination rect
    )
  })

  it("resolves with the Blob returned by toBlob", async () => {
    const expectedBlob = new Blob(["crop-result"], { type: "image/png" })
    mockToBlob.mockImplementation((cb: (blob: Blob | null) => void) => {
      cb(expectedBlob)
    })

    const img = makeImg()
    const result = await cropImageElementToBlob(img, { x: 0, y: 0, width: 100, height: 100 })

    expect(result).toBe(expectedBlob)
  })

  it("calls toBlob with image/png format", async () => {
    const img = makeImg()
    await cropImageElementToBlob(img, { x: 0, y: 0, width: 50, height: 50 })

    expect(mockToBlob).toHaveBeenCalledWith(expect.any(Function), "image/png")
  })

  it("rejects when canvas context is null", async () => {
    mockCanvas.getContext.mockReturnValueOnce(null)
    const img = makeImg()

    await expect(
      cropImageElementToBlob(img, { x: 0, y: 0, width: 100, height: 100 }),
    ).rejects.toThrow("Failed to get canvas context")
  })

  it("rejects when toBlob returns null", async () => {
    mockToBlob.mockImplementation((cb: (blob: Blob | null) => void) => {
      cb(null)
    })
    const img = makeImg()

    await expect(
      cropImageElementToBlob(img, { x: 0, y: 0, width: 100, height: 100 }),
    ).rejects.toThrow("Failed to create blob from canvas")
  })
})

describe("cropPolygonToBlob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanvas.width = 0
    mockCanvas.height = 0
    mockToBlob.mockImplementation((cb: (blob: Blob | null) => void) => {
      cb(new Blob(["polygon"], { type: "image/png" }))
    })
    mockCanvas.getContext.mockReturnValue(mockContext)
  })

  it("rejects when polygon has fewer than 3 points", async () => {
    const img = makeImg()
    const twoPoints = [{ x: 0, y: 0 }, { x: 10, y: 10 }]

    await expect(
      cropPolygonToBlob(img, twoPoints),
    ).rejects.toThrow("Polygon needs at least 3 points")
  })

  it("rejects for an empty points array", async () => {
    const img = makeImg()

    await expect(cropPolygonToBlob(img, [])).rejects.toThrow(
      "Polygon needs at least 3 points",
    )
  })

  it("sets canvas dimensions to the polygon bounding box", async () => {
    const img = makeImg(1000, 1000)
    const points = [
      { x: 100, y: 200 },
      { x: 400, y: 200 },
      { x: 250, y: 500 },
    ]

    await cropPolygonToBlob(img, points)

    // bounding box: minX=100, minY=200, maxX=400, maxY=500
    expect(mockCanvas.width).toBe(300)  // 400 - 100
    expect(mockCanvas.height).toBe(300) // 500 - 200
  })

  it("creates a clipping path with moveTo for the first point and lineTo for the rest", async () => {
    const img = makeImg(1000, 1000)
    const points = [
      { x: 100, y: 200 },
      { x: 400, y: 200 },
      { x: 400, y: 500 },
      { x: 100, y: 500 },
    ]

    await cropPolygonToBlob(img, points)

    // Points are shifted to local coords (subtract minX=100, minY=200)
    expect(mockBeginPath).toHaveBeenCalledOnce()
    expect(mockMoveTo).toHaveBeenCalledWith(0, 0)     // (100-100, 200-200)
    expect(mockLineTo).toHaveBeenCalledTimes(3)
    expect(mockLineTo).toHaveBeenNthCalledWith(1, 300, 0)   // (400-100, 200-200)
    expect(mockLineTo).toHaveBeenNthCalledWith(2, 300, 300)  // (400-100, 500-200)
    expect(mockLineTo).toHaveBeenNthCalledWith(3, 0, 300)    // (100-100, 500-200)
    expect(mockClosePath).toHaveBeenCalledOnce()
    expect(mockClip).toHaveBeenCalledOnce()
  })

  it("calls drawImage with the bounding box region", async () => {
    const img = makeImg(1000, 1000)
    const points = [
      { x: 50, y: 100 },
      { x: 250, y: 100 },
      { x: 150, y: 300 },
    ]

    await cropPolygonToBlob(img, points)

    // minX=50, minY=100, maxX=250, maxY=300 => w=200, h=200
    expect(mockDrawImage).toHaveBeenCalledWith(
      img,
      50, 100, 200, 200, // source
      0, 0, 200, 200,    // destination
    )
  })

  it("resolves with the Blob from toBlob", async () => {
    const expectedBlob = new Blob(["poly-crop"], { type: "image/png" })
    mockToBlob.mockImplementation((cb: (blob: Blob | null) => void) => {
      cb(expectedBlob)
    })

    const img = makeImg(500, 500)
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ]

    const result = await cropPolygonToBlob(img, points)
    expect(result).toBe(expectedBlob)
  })

  it("clamps bounding box to image natural dimensions", async () => {
    const img = makeImg(200, 200)
    // Points extend beyond the image boundary
    const points = [
      { x: 150, y: 150 },
      { x: 300, y: 150 }, // beyond naturalWidth 200
      { x: 300, y: 300 }, // beyond both dimensions
    ]

    await cropPolygonToBlob(img, points)

    // maxX clamped to 200, maxY clamped to 200
    // minX=150, minY=150, maxX=200, maxY=200 => w=50, h=50
    expect(mockCanvas.width).toBe(50)
    expect(mockCanvas.height).toBe(50)
  })

  it("rejects when the clamped bounding box is too small", async () => {
    const img = makeImg(100, 100)
    // All points are beyond the image boundary on one axis
    const points = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 150, y: 200 },
    ]

    // minX=100 -> clamped to 100, maxX=200 -> clamped to 100 => w=0
    await expect(cropPolygonToBlob(img, points)).rejects.toThrow(
      "Selection too small",
    )
  })

  it("rejects when canvas context is null", async () => {
    mockCanvas.getContext.mockReturnValueOnce(null)
    const img = makeImg(500, 500)
    const points = [
      { x: 10, y: 10 },
      { x: 100, y: 10 },
      { x: 50, y: 100 },
    ]

    await expect(cropPolygonToBlob(img, points)).rejects.toThrow(
      "Failed to get canvas context",
    )
  })
})
