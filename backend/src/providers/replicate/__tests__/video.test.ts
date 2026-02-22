import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockCreate = vi.fn()
  const mockWait = vi.fn()
  const mockExtractUrl = vi.fn((v: unknown) => String(v))
  const mockExtractCost = vi.fn().mockReturnValue(0.05)
  return { mockCreate, mockWait, mockExtractUrl, mockExtractCost }
})

vi.mock("../client.js", () => ({
  replicate: {
    predictions: { create: mocks.mockCreate },
    wait: mocks.mockWait,
  },
  extractUrl: mocks.mockExtractUrl,
  extractCost: mocks.mockExtractCost,
}))

import { ReplicateVideoProvider } from "../video.js"

let provider: ReplicateVideoProvider

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockCreate.mockResolvedValue({ id: "pred-1" })
  mocks.mockWait.mockResolvedValue({
    output: "https://replicate.example.com/video.mp4",
    metrics: { predict_time: 30 },
  })
  provider = new ReplicateVideoProvider()
})

describe("ReplicateVideoProvider.imageToVideo", () => {
  it("happy path with default model (minimax)", async () => {
    const result = await provider.imageToVideo("https://example.com/image.png", "smooth motion")
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "minimax/video-01",
      input: expect.objectContaining({
        prompt: "smooth motion",
        first_frame_image: "https://example.com/image.png",
        prompt_optimizer: true,
      }),
    }))
    expect(result.url).toBe("https://replicate.example.com/video.mp4")
    expect(result.cost).toBe(0.05)
  })

  it("uses end frame when supported", async () => {
    await provider.imageToVideo("https://start.png", "motion", "kling", undefined, "https://end.png")
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        start_image: "https://start.png",
        end_image: "https://end.png",
      }),
    }))
  })

  it("ignores end frame for models that don't support it", async () => {
    await provider.imageToVideo("https://start.png", "motion", "minimax", undefined, "https://end.png")
    const callArgs = mocks.mockCreate.mock.calls[0][0].input
    expect(callArgs.end_image).toBeUndefined()
  })

  it("passes duration parameter", async () => {
    await provider.imageToVideo("https://img.png", "motion", "minimax", 10)
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ length: 10 }),
    }))
  })

  it("clamps duration for veo3.1 to valid values", async () => {
    await provider.imageToVideo("https://img.png", "motion", "veo3.1", 5)
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ duration: 4 }),
    }))
  })

  it("uses default prompt when none provided", async () => {
    await provider.imageToVideo("https://img.png")
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ prompt: "smooth cinematic motion" }),
    }))
  })
})

describe("ReplicateVideoProvider.textToVideo", () => {
  it("happy path with default model", async () => {
    const result = await provider.textToVideo("a sunset over the ocean")
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "minimax/video-01",
      input: expect.objectContaining({ prompt: "a sunset over the ocean", prompt_optimizer: true }),
    }))
    expect(result.url).toBe("https://replicate.example.com/video.mp4")
  })

  it("uses custom model", async () => {
    await provider.textToVideo("a sunset", "veo3")
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "google/veo-3",
    }))
  })

  it("extracts cost from metrics", async () => {
    mocks.mockExtractCost.mockReturnValueOnce(0.10)
    const result = await provider.textToVideo("test")
    expect(result.cost).toBe(0.10)
  })
})
