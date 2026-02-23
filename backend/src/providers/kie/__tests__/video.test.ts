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
  return { mockRunKieTask, mockRunVeoTask, mockCreateSanitizedError, mockKling3Generate }
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
    )
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
    expect(result.url).toBe("https://cdn.kie.ai/veo-video.mp4")
    expect(result.cost).toBe(2.0)
  })

  it("calls runVeoTask for veo3.1", async () => {
    await provider.imageToVideo("https://img.png", "cinematic", "veo3.1")
    expect(mocks.mockRunVeoTask).toHaveBeenCalledWith(
      "veo3_fast",
      "cinematic",
      ["https://img.png"],
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
    expect(result.cost).toBe(0.50)
  })

  it("returns correct cost for each model", async () => {
    const r1 = await provider.imageToVideo("https://img.png", "test", "minimax")
    expect(r1.cost).toBe(0.40)

    vi.clearAllMocks()
    mocks.mockRunKieTask.mockResolvedValue({
      resultJson: { resultUrls: ["https://cdn.kie.ai/video.mp4"] },
    })
    const r2 = await provider.imageToVideo("https://img.png", "test", "kling-turbo")
    expect(r2.cost).toBe(0.25)
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
    expect(result.cost).toBe(0.40)
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
    )
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
    expect(result.url).toBe("https://cdn.kie.ai/veo-video.mp4")
    expect(result.cost).toBe(2.0)
  })

  it("passes aspect ratio when provided", async () => {
    await provider.textToVideo("test prompt", "minimax", undefined, "9:16")
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(input.aspect_ratio).toBe("9:16")
  })

  it("converts duration to n_frames for sora2-pro", async () => {
    await provider.textToVideo("test", "sora2-pro", 10)
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(input.n_frames).toBe("15")
    expect(input.duration).toBeUndefined()
  })

  it("converts 5s duration to n_frames=10 for sora2-pro", async () => {
    await provider.textToVideo("test", "sora2-pro", 5)
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(input.n_frames).toBe("10")
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
    expect(result.cost).toBe(0.50)
  })
})
