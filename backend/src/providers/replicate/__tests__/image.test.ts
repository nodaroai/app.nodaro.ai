import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockCreate = vi.fn()
  const mockWait = vi.fn()
  const mockExtractUrl = vi.fn((v: unknown) => String(v))
  const mockExtractCost = vi.fn().mockReturnValue(0.005)
  const mockTranslateToEnglish = vi.fn((text: string) => Promise.resolve(text))
  return { mockCreate, mockWait, mockExtractUrl, mockExtractCost, mockTranslateToEnglish }
})

vi.mock("../client.js", () => ({
  replicate: {
    predictions: { create: mocks.mockCreate },
    wait: mocks.mockWait,
  },
  extractUrl: mocks.mockExtractUrl,
  extractCost: mocks.mockExtractCost,
}))

vi.mock("@/lib/translate.js", () => ({
  translateToEnglish: mocks.mockTranslateToEnglish,
}))

import { ReplicateImageProvider } from "../image.js"

let provider: ReplicateImageProvider

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockCreate.mockResolvedValue({ id: "pred-1" })
  mocks.mockWait.mockResolvedValue({
    output: "https://replicate.example.com/image.png",
    metrics: { predict_time: 2.5 },
  })
  mocks.mockExtractCost.mockReturnValue(0.005)
  provider = new ReplicateImageProvider()
})

describe("ReplicateImageProvider.generateImage", () => {
  it("happy path with default model", async () => {
    const result = await provider.generateImage("a cat")
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "google/nano-banana",
      input: { prompt: "a cat" },
    }))
    expect(result.url).toBe("https://replicate.example.com/image.png")
    expect(result.cost).toBe(0.005)
  })

  it("translates prompt to English", async () => {
    mocks.mockTranslateToEnglish.mockResolvedValueOnce("a cat in English")
    await provider.generateImage("une chat")
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: { prompt: "a cat in English" },
    }))
  })

  it("uses custom model mapped to Replicate ID", async () => {
    await provider.generateImage("a dog", undefined, "flux")
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "black-forest-labs/flux-schnell",
    }))
  })

  it("passes reference images as image_input", async () => {
    await provider.generateImage("style", ["https://ref.png"])
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: { prompt: "style", image_input: ["https://ref.png"] },
    }))
  })

  it("extracts cost from prediction metrics", async () => {
    mocks.mockExtractCost.mockReturnValueOnce(0.01)
    const result = await provider.generateImage("test")
    expect(result.cost).toBe(0.01)
  })

  it("handles array output", async () => {
    mocks.mockWait.mockResolvedValueOnce({
      output: ["https://replicate.example.com/img1.png"],
      metrics: {},
    })
    mocks.mockExtractUrl.mockReturnValueOnce("https://replicate.example.com/img1.png")
    const result = await provider.generateImage("test")
    expect(result.url).toBe("https://replicate.example.com/img1.png")
  })

  it("throws on unexpected output format", async () => {
    mocks.mockWait.mockResolvedValueOnce({ output: null, metrics: {} })
    await expect(provider.generateImage("test")).rejects.toThrow("Unexpected Replicate output")
  })
})
