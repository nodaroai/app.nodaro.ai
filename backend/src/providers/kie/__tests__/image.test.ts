import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockRunKieTask = vi.fn()
  const mockCreateSanitizedError = vi.fn((msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`))
  return { mockRunKieTask, mockCreateSanitizedError }
})

vi.mock("../client.js", () => ({
  runKieTask: mocks.mockRunKieTask,
  createSanitizedError: mocks.mockCreateSanitizedError,
}))

vi.mock("../models.js", () => ({
  KIE_IMAGE_MODELS: {
    "nano-banana": { model: "nano-banana-pro", cost: 0.02, inputType: "text-to-image", extraParams: { output_format: "png" } },
    "flux": { model: "flux-2/pro-text-to-image", cost: 0.05, inputType: "text-to-image", extraParams: {} },
    "gpt-image": { model: "gpt-image/1.5-text-to-image", cost: 0.06, inputType: "image-to-image", imageParam: "input_urls", extraParams: {} },
    "grok-i2i": { model: "grok-imagine/image-to-image", cost: 0.04, inputType: "image-to-image", imageParam: "image_urls", extraParams: {} },
    "recraft-upscale": { model: "recraft/crisp-upscale", cost: 0.04, inputType: "image-to-image", imageParam: "image", extraParams: {} },
    "recraft-remove-bg": { model: "recraft/remove-background", cost: 0.03, inputType: "image-to-image", imageParam: "image", extraParams: {} },
    "nano-banana-edit": { model: "google/nano-banana-edit", cost: 0.04, inputType: "image-to-image", imageParam: "image_urls", extraParams: {} },
  },
}))

import { KieImageProvider } from "../image.js"

let provider: KieImageProvider

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockRunKieTask.mockResolvedValue({
    resultJson: { resultUrls: ["https://kie.example.com/result.png"] },
  })
  provider = new KieImageProvider()
})

describe("KieImageProvider.generateImage", () => {
  it("happy path with default model (nano-banana)", async () => {
    const result = await provider.generateImage("a cat")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith("nano-banana-pro", expect.objectContaining({ prompt: "a cat" }))
    expect(result.url).toBe("https://kie.example.com/result.png")
    expect(result.cost).toBe(0.02)
  })

  it("uses custom model (flux)", async () => {
    const result = await provider.generateImage("a dog", undefined, "flux")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith("flux-2/pro-text-to-image", expect.objectContaining({ prompt: "a dog" }))
    expect(result.cost).toBe(0.05)
  })

  it("throws for unsupported model", async () => {
    await expect(provider.generateImage("test", undefined, "unsupported")).rejects.toThrow()
    expect(mocks.mockCreateSanitizedError).toHaveBeenCalled()
  })

  it("passes reference images as image_input for t2i models", async () => {
    await provider.generateImage("style", ["https://ref1.png"], "nano-banana")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "nano-banana-pro",
      expect.objectContaining({ image_input: ["https://ref1.png"] }),
    )
  })

  it("passes reference images via array imageParam for gpt-image (input_urls)", async () => {
    await provider.generateImage("edit", ["https://img1.png", "https://img2.png"], "gpt-image")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "gpt-image/1.5-text-to-image",
      expect.objectContaining({ input_urls: ["https://img1.png", "https://img2.png"] }),
    )
  })

  it("passes reference images via array imageParam for grok (image_urls)", async () => {
    await provider.generateImage("edit", ["https://img.png"], "grok-i2i")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "grok-imagine/image-to-image",
      expect.objectContaining({ image_urls: ["https://img.png"] }),
    )
  })

  it("throws when no URL in result", async () => {
    mocks.mockRunKieTask.mockResolvedValueOnce({ resultJson: { resultUrls: [] } })
    await expect(provider.generateImage("test")).rejects.toThrow()
  })

  it("passes extraParams from caller", async () => {
    await provider.generateImage("wide shot", undefined, "nano-banana", { aspect_ratio: "16:9" })
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "nano-banana-pro",
      expect.objectContaining({ image_size: "16:9" }),
    )
  })
})

describe("KieImageProvider.editImage", () => {
  it("happy path with default model (recraft-upscale)", async () => {
    const result = await provider.editImage("https://input.png")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith("recraft/crisp-upscale", expect.objectContaining({ image: "https://input.png" }))
    expect(result.url).toBe("https://kie.example.com/result.png")
    expect(result.cost).toBe(0.04)
  })

  it("includes prompt for nano-banana-edit", async () => {
    await provider.editImage("https://input.png", "make it blue", "nano-banana-edit")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "google/nano-banana-edit",
      expect.objectContaining({ prompt: "make it blue", image_urls: ["https://input.png"] }),
    )
  })

  it("omits prompt for recraft-remove-bg", async () => {
    await provider.editImage("https://input.png", "remove background", "recraft-remove-bg")
    const callArgs = mocks.mockRunKieTask.mock.calls[0][1]
    expect(callArgs.prompt).toBeUndefined()
  })

  it("throws for unsupported model", async () => {
    await expect(provider.editImage("https://input.png", undefined, "unsupported")).rejects.toThrow()
  })

  it("throws when no URL in result", async () => {
    mocks.mockRunKieTask.mockResolvedValueOnce({ resultJson: { resultUrls: [] } })
    await expect(provider.editImage("https://input.png")).rejects.toThrow()
  })
})
