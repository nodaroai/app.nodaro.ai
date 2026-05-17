import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockCreate = vi.fn()
  const mockWait = vi.fn()
  const mockExtractUrl = vi.fn((v: unknown) => {
    if (typeof v === "string") return v
    if (v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string") {
      return (v as { url: string }).url
    }
    throw new Error(`Unexpected Replicate output type: ${typeof v}`)
  })
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
  it("happy path with default model (flux-2-klein)", async () => {
    const result = await provider.generateImage("a cat")
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "black-forest-labs/flux-2-klein-9b",
      input: expect.objectContaining({ prompt: "a cat", aspect_ratio: "1:1" }),
    }))
    expect(result.url).toBe("https://replicate.example.com/image.png")
    expect(result.cost).toBe(0.005)
  })

  it("translates prompt to English", async () => {
    mocks.mockTranslateToEnglish.mockResolvedValueOnce("a cat in English")
    await provider.generateImage("une chat")
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ prompt: "a cat in English" }),
    }))
  })

  it("flux-2-klein forwards first ref image as `image`", async () => {
    await provider.generateImage("style", ["https://ref.png"], "flux-2-klein")
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "black-forest-labs/flux-2-klein-9b",
      input: expect.objectContaining({
        prompt: "style",
        image: "https://ref.png",
      }),
    }))
  })

  it("kontext-multi maps up to 4 refs to input_image_1..4", async () => {
    await provider.generateImage(
      "merge",
      ["https://a.png", "https://b.png", "https://c.png", "https://d.png"],
      "kontext-multi",
    )
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "flux-kontext-apps/multi-image-kontext-pro",
      input: expect.objectContaining({
        prompt: "merge",
        input_image_1: "https://a.png",
        input_image_2: "https://b.png",
        input_image_3: "https://c.png",
        input_image_4: "https://d.png",
        aspect_ratio: "1:1",
        output_format: "png",
      }),
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
    await expect(provider.generateImage("test")).rejects.toThrow(/Unexpected Replicate output/)
  })

  it("throws on unknown model id", async () => {
    await expect(
      provider.generateImage("test", undefined, "totally-fake-model"),
    ).rejects.toThrow(/Unknown model/)
  })
})

describe("kontext-multi via generateImage (image-to-image worker path)", () => {
  it("routes the source image as the first ref input", async () => {
    await provider.generateImage(
      "make it shiny",
      ["https://input.png"],
      "kontext-multi",
    )
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "flux-kontext-apps/multi-image-kontext-pro",
      input: expect.objectContaining({
        prompt: "make it shiny",
        input_image_1: "https://input.png",
      }),
    }))
  })
})
