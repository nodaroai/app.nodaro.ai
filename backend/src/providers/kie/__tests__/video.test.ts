import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock() calls
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockRunKieTask = vi.fn()
  const mockRunVeoTask = vi.fn()
  const mockCreateSanitizedError = vi.fn(
    (msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`),
  )
  const mockKling3Generate = vi.fn()
  const mockUploadBufferToR2 = vi.fn()
  // Mutable so a test can simulate a PNG / oversized image driving conversion.
  const sharpMeta: { format: string; width: number; height: number } = {
    format: "jpeg",
    width: 1024,
    height: 1024,
  }
  return {
    mockRunKieTask,
    mockRunVeoTask,
    mockCreateSanitizedError,
    mockKling3Generate,
    mockUploadBufferToR2,
    sharpMeta,
  }
})

vi.mock("../client.js", () => ({
  runKieTask: mocks.mockRunKieTask,
  runVeoTask: mocks.mockRunVeoTask,
  createSanitizedError: mocks.mockCreateSanitizedError,
  MAX_POLL_ATTEMPTS_VIDEO: 120,
}))

vi.mock("../kling3-client.js", () => ({
  kling3Generate: mocks.mockKling3Generate,
}))

vi.mock("../models.js", async () => {
  const actual = await vi.importActual<typeof import("../models.js")>("../models.js")
  return actual
})

vi.mock("../../../lib/storage.js", () => ({
  uploadBufferToR2: mocks.mockUploadBufferToR2,
}))

// Mock sharp so ensureImageForProvider doesn't need real image data. The chain
// is intentionally permissive — resize/jpeg return `this`, toBuffer returns a
// tiny fake JPEG — so the conversion path can run without real image bytes.
vi.mock("sharp", () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.metadata = () => Promise.resolve({ ...mocks.sharpMeta })
    chain.resize = () => chain
    chain.jpeg = () => chain
    chain.toBuffer = () => Promise.resolve(Buffer.from("converted-jpeg-data"))
    return chain
  }
  const mockSharp = () => makeChain()
  mockSharp.default = mockSharp
  return { default: mockSharp }
})

// ---------------------------------------------------------------------------
// Import class under test
// ---------------------------------------------------------------------------

import { KieVideoProvider } from "../video.js"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let provider: KieVideoProvider

beforeEach(() => {
  vi.clearAllMocks()
  // Reset the sharp metadata to "small JPEG" — i.e. nothing to convert.
  Object.assign(mocks.sharpMeta, { format: "jpeg", width: 1024, height: 1024 })
  mocks.mockUploadBufferToR2.mockResolvedValue(
    "https://cdn.nodaro.ai/images/provider-converted-test.jpg",
  )
  // Mock global fetch for ensureImageForProvider (returns a tiny fake buffer)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
  }))
  mocks.mockRunKieTask.mockResolvedValue({
    resultJson: { resultUrls: ["https://cdn.kie.ai/video.mp4"] },
  })
  mocks.mockRunVeoTask.mockResolvedValue({
    resultJson: { resultUrls: ["https://cdn.kie.ai/veo-video.mp4"] },
  })
  mocks.mockKling3Generate.mockResolvedValue({
    videoUrl: "https://cdn.kie.ai/kling3-video.mp4",
  })
  provider = new KieVideoProvider()
})

// ---------------------------------------------------------------------------
// imageToVideo
// ---------------------------------------------------------------------------

describe("KieVideoProvider.imageToVideo", () => {
  it("throws for unsupported model", async () => {
    await expect(
      provider.imageToVideo("https://img.png", "prompt", "nonexistent-model"),
    ).rejects.toThrow()
    expect(mocks.mockCreateSanitizedError).toHaveBeenCalledWith(
      expect.stringContaining("nonexistent-model"),
      "Video generation",
    )
  })

  it("uses correct KIE model ID for minimax", async () => {
    await provider.imageToVideo("https://img.png", "cinematic", "minimax")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "hailuo/02-image-to-video-pro",
      expect.any(Object),
      120,
      undefined,
    )
  })

  it("uses correct KIE model ID for kling", async () => {
    await provider.imageToVideo("https://img.png", "cinematic", "kling")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "kling-2.6/image-to-video",
      expect.any(Object),
      120,
      undefined,
    )
  })

  it("calls runVeoTask for veo3 (not runKieTask)", async () => {
    const result = await provider.imageToVideo("https://img.png", "cinematic", "veo3")
    expect(mocks.mockRunVeoTask).toHaveBeenCalledWith(
      "veo3",
      "cinematic",
      ["https://img.png"],
      { aspectRatio: undefined, seed: undefined },
    )
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
    expect(result.url).toBe("https://cdn.kie.ai/veo-video.mp4")
    expect(result.cost).toBe(1.25)
  })

  it("calls runVeoTask for veo3.1", async () => {
    await provider.imageToVideo("https://img.png", "cinematic", "veo3.1")
    expect(mocks.mockRunVeoTask).toHaveBeenCalledWith(
      "veo3_fast",
      "cinematic",
      ["https://img.png"],
      { aspectRatio: undefined, seed: undefined },
    )
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
  })

  it("passes correct duration for kling 5s", async () => {
    await provider.imageToVideo("https://img.png", "cinematic", "kling", 5)
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(input.duration).toBe("5")
  })

  it("passes correct duration for kling 10s", async () => {
    await provider.imageToVideo("https://img.png", "cinematic", "kling", 10)
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(input.duration).toBe("10")
  })

  it("handles end frame for minimax (end_image_url)", async () => {
    await provider.imageToVideo(
      "https://start.png",
      "cinematic",
      "minimax",
      undefined,
      "https://end.png",
    )
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(input.end_image_url).toBe("https://end.png")
  })

  it("handles end frame for kling-turbo (tail_image_url)", async () => {
    await provider.imageToVideo(
      "https://start.png",
      "cinematic",
      "kling-turbo",
      undefined,
      "https://end.png",
    )
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(input.tail_image_url).toBe("https://end.png")
  })

  it("uses image_url for minimax (single URL, not array)", async () => {
    await provider.imageToVideo("https://img.png", "test", "minimax")
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(input.image_url).toBe("https://img.png")
    expect(input.image_urls).toBeUndefined()
  })

  it("uses image_urls array for kling", async () => {
    await provider.imageToVideo("https://img.png", "test", "kling")
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(input.image_urls).toEqual(["https://img.png"])
  })

  it("calls kling3Generate for kling-3.0", async () => {
    const result = await provider.imageToVideo(
      "https://img.png",
      "cinematic",
      "kling-3.0",
    )
    expect(mocks.mockKling3Generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "cinematic",
        imageUrls: ["https://img.png"],
      }),
    )
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
    expect(result.url).toBe("https://cdn.kie.ai/kling3-video.mp4")
    expect(result.cost).toBe(1.00)
  })

  it("handles end frame for seedance via input_urls array", async () => {
    await provider.imageToVideo(
      "https://start.png",
      "cinematic",
      "seedance",
      undefined,
      "https://end.png",
    )
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    // Seedance sends both frames in input_urls array, NOT a separate end_frame param
    expect(input.input_urls).toEqual(["https://start.png", "https://end.png"])
    expect(input.end_frame).toBeUndefined()
    expect(input.end_image_url).toBeUndefined()
    expect(input.tail_image_url).toBeUndefined()
  })

  it("veo3 sends REFERENCE_2_VIDEO generationType when explicitly set", async () => {
    await provider.imageToVideo(
      "https://placeholder.png",
      "cinematic scene",
      "veo3",
      undefined,
      undefined,
      {
        referenceImageUrls: ["https://ref1.png", "https://ref2.png"],
        generationType: "REFERENCE_2_VIDEO",
      },
    )
    expect(mocks.mockRunVeoTask).toHaveBeenCalledWith(
      "veo3",
      "cinematic scene",
      ["https://ref1.png", "https://ref2.png"],
      expect.objectContaining({ generationType: "REFERENCE_2_VIDEO" }),
    )
  })

  it("veo3 caps reference images at 3 in reference mode", async () => {
    await provider.imageToVideo(
      "https://placeholder.png",
      "cinematic scene",
      "veo3",
      undefined,
      undefined,
      {
        referenceImageUrls: ["https://r1.png", "https://r2.png", "https://r3.png", "https://r4.png"],
        generationType: "REFERENCE_2_VIDEO",
      },
    )
    const imageUrls = mocks.mockRunVeoTask.mock.calls[0][2]
    expect(imageUrls).toHaveLength(3)
  })

  it("grok-i2v merges startFrame + referenceImageUrls into image_urls array (max 7)", async () => {
    await provider.imageToVideo(
      "https://start.png",
      "animate",
      "grok-i2v",
      6,
      undefined,
      { referenceImageUrls: ["https://ref1.png", "https://ref2.png", "https://ref3.png"] },
    )
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        image_urls: ["https://start.png", "https://ref1.png", "https://ref2.png", "https://ref3.png"],
      }),
      expect.any(Number),
      undefined,
    )
  })

  it("grok-i2v caps merged image_urls at 7 total", async () => {
    const refs = Array.from({ length: 8 }, (_, i) => `https://ref${i}.png`)
    await provider.imageToVideo(
      "https://start.png",
      "animate",
      "grok-i2v",
      6,
      undefined,
      { referenceImageUrls: refs },
    )
    const callArgs = mocks.mockRunKieTask.mock.calls[0][1]
    expect(callArgs.image_urls).toHaveLength(7)
    expect(callArgs.image_urls[0]).toBe("https://start.png")
  })

  it("returns correct cost for each model", async () => {
    const r1 = await provider.imageToVideo("https://img.png", "test", "minimax")
    expect(r1.cost).toBe(0.285)

    vi.clearAllMocks()
    mocks.mockRunKieTask.mockResolvedValue({
      resultJson: { resultUrls: ["https://cdn.kie.ai/video.mp4"] },
    })
    const r2 = await provider.imageToVideo("https://img.png", "test", "kling-turbo")
    expect(r2.cost).toBe(0.21)
  })

  // -------------------------------------------------------------------------
  // Input image normalization (Hailuo/MiniMax 500s on big RGBA PNGs; every
  // i2v model gets the >2048px cap regardless).
  // -------------------------------------------------------------------------

  it("re-encodes a large RGBA PNG to JPEG before sending to hailuo-2.3", async () => {
    Object.assign(mocks.sharpMeta, { format: "png", width: 2752, height: 1536 })
    mocks.mockUploadBufferToR2.mockResolvedValue("https://cdn.nodaro.ai/images/conv-h23.jpg")
    await provider.imageToVideo("https://cdn.nodaro.ai/images/orig.png", "test", "hailuo-2.3")
    expect(mocks.mockUploadBufferToR2).toHaveBeenCalledOnce()
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(input.image_url).toBe("https://cdn.nodaro.ai/images/conv-h23.jpg")
  })

  it("re-encodes a large RGBA PNG to JPEG before sending to hailuo-2.3-pro", async () => {
    Object.assign(mocks.sharpMeta, { format: "png", width: 3000, height: 2000 })
    mocks.mockUploadBufferToR2.mockResolvedValue("https://cdn.nodaro.ai/images/conv-h23pro.jpg")
    await provider.imageToVideo("https://cdn.nodaro.ai/images/orig.png", "test", "hailuo-2.3-pro")
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(input.image_url).toBe("https://cdn.nodaro.ai/images/conv-h23pro.jpg")
  })

  it("passes an already-small JPEG through unchanged for hailuo-2.3", async () => {
    // beforeEach leaves sharpMeta as a 1024×1024 JPEG — nothing to do.
    await provider.imageToVideo("https://cdn.nodaro.ai/images/small.jpg", "test", "hailuo-2.3")
    expect(mocks.mockUploadBufferToR2).not.toHaveBeenCalled()
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(input.image_url).toBe("https://cdn.nodaro.ai/images/small.jpg")
  })

  it("downscales an oversized image even for a non-Hailuo provider (kling)", async () => {
    Object.assign(mocks.sharpMeta, { format: "jpeg", width: 4096, height: 2160 })
    mocks.mockUploadBufferToR2.mockResolvedValue("https://cdn.nodaro.ai/images/conv-kling.jpg")
    await provider.imageToVideo("https://cdn.nodaro.ai/images/big.jpg", "test", "kling")
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect((input.image_urls as string[])[0]).toBe("https://cdn.nodaro.ai/images/conv-kling.jpg")
  })

  it("does not touch input images for VEO (separate endpoint)", async () => {
    Object.assign(mocks.sharpMeta, { format: "png", width: 4096, height: 4096 })
    await provider.imageToVideo("https://cdn.nodaro.ai/images/big.png", "test", "veo3")
    expect(mocks.mockUploadBufferToR2).not.toHaveBeenCalled()
    expect(mocks.mockRunVeoTask).toHaveBeenCalledWith(
      "veo3",
      "test",
      ["https://cdn.nodaro.ai/images/big.png"],
      expect.any(Object),
    )
  })
})

// ---------------------------------------------------------------------------
// textToVideo
// ---------------------------------------------------------------------------

describe("KieVideoProvider.textToVideo", () => {
  it("sends prompt and uses correct model for minimax", async () => {
    const result = await provider.textToVideo("a sunset scene", "minimax")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "hailuo/02-text-to-video-pro",
      expect.objectContaining({ prompt: "a sunset scene" }),
      120,
      undefined,
    )
    expect(result.url).toBe("https://cdn.kie.ai/video.mp4")
    expect(result.cost).toBe(0.285)
  })

  it("throws for unsupported model", async () => {
    await expect(
      provider.textToVideo("test", "nonexistent-model"),
    ).rejects.toThrow()
    expect(mocks.mockCreateSanitizedError).toHaveBeenCalledWith(
      expect.stringContaining("nonexistent-model"),
      "Video generation",
    )
  })

  it("calls runVeoTask for veo3", async () => {
    const result = await provider.textToVideo("space exploration", "veo3")
    expect(mocks.mockRunVeoTask).toHaveBeenCalledWith(
      "veo3",
      "space exploration",
      undefined,
      { aspectRatio: undefined, seed: undefined },
    )
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
    expect(result.url).toBe("https://cdn.kie.ai/veo-video.mp4")
    expect(result.cost).toBe(1.25)
  })

  it("passes aspect ratio when provided", async () => {
    await provider.textToVideo("test prompt", "minimax", undefined, "9:16")
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(input.aspect_ratio).toBe("9:16")
  })

  it("calls kling3Generate for kling-3.0 (no imageUrls)", async () => {
    const result = await provider.textToVideo("cinematic", "kling-3.0")
    expect(mocks.mockKling3Generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "cinematic",
      }),
    )
    // textToVideo for kling-3.0 should NOT pass imageUrls
    const callArgs = mocks.mockKling3Generate.mock.calls[0][0]
    expect(callArgs.imageUrls).toBeUndefined()
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
    expect(result.cost).toBe(1.00)
  })
})
