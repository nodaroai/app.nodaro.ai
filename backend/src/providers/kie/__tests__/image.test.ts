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
    // GPT Image 1.5 — t2i endpoint IGNORES a supplied anchor; the i2i sibling
    // consumes it via input_urls. Mirrors the real models.ts shapes (t2i has no
    // inputType/imageParam) so the t2i→i2i anchor routing is exercised honestly.
    "gpt-image": { model: "gpt-image/1.5-text-to-image", cost: 0.02, extraParams: { aspect_ratio: "3:2", quality: "medium" } },
    "gpt-image-i2i": { model: "gpt-image/1.5-image-to-image", cost: 0.02, inputType: "image-to-image", imageParam: "input_urls", extraParams: { aspect_ratio: "3:2", quality: "medium" } },
    // GPT Image 2 — same quirk; resolution-based pricing instead of quality.
    "gpt-image-2": { model: "gpt-image-2-text-to-image", cost: 0.02, extraParams: { aspect_ratio: "16:9", resolution: "1K" } },
    "gpt-image-2-i2i": { model: "gpt-image-2-image-to-image", cost: 0.02, inputType: "image-to-image", imageParam: "input_urls", extraParams: { aspect_ratio: "16:9", resolution: "1K" } },
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
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith("nano-banana-pro", expect.objectContaining({ prompt: "a cat" }), undefined, undefined, undefined)
    expect(result.url).toBe("https://kie.example.com/result.png")
    expect(result.cost).toBe(0.02)
  })

  it("uses custom model (flux)", async () => {
    const result = await provider.generateImage("a dog", undefined, "flux")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith("flux-2/pro-text-to-image", expect.objectContaining({ prompt: "a dog" }), undefined, undefined, undefined)
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
      undefined,
      undefined,
      undefined,
    )
  })

  it("passes reference images via array imageParam for grok (image_urls)", async () => {
    await provider.generateImage("edit", ["https://img.png"], "grok-i2i")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "grok-imagine/image-to-image",
      expect.objectContaining({ image_urls: ["https://img.png"] }),
      undefined,
      undefined,
      undefined,
    )
  })

  it("throws when no URL in result", async () => {
    mocks.mockRunKieTask.mockResolvedValueOnce({ resultJson: { resultUrls: [] } })
    await expect(provider.generateImage("test")).rejects.toThrow()
  })

  it("passes aspect_ratio through to KIE for nano-banana (Pro endpoint accepts aspect_ratio, not image_size)", async () => {
    await provider.generateImage("wide shot", undefined, "nano-banana", { aspect_ratio: "9:16" })
    const callArgs = mocks.mockRunKieTask.mock.calls[0]
    expect(callArgs[0]).toBe("nano-banana-pro")
    expect(callArgs[1]).toMatchObject({ aspect_ratio: "9:16" })
    expect(callArgs[1]).not.toHaveProperty("image_size")
    expect(callArgs[1]).not.toHaveProperty("resolution")
  })
})

describe("KieImageProvider.generateImage — GPT Image t2i → i2i anchor routing", () => {
  // Regression: GPT Image text-to-image endpoints ignore a supplied anchor (they
  // generate from the prompt only → entity identity loss). When a reference image
  // is present, generateImage must route to the i2i sibling so the anchor is
  // consumed via input_urls (NOT image_input, which the t2i endpoint drops).

  it("gpt-image-2 + anchor routes to gpt-image-2-image-to-image via input_urls", async () => {
    const result = await provider.generateImage("front 3/4 view", ["https://anchor.png"], "gpt-image-2")
    const [modelId, body] = mocks.mockRunKieTask.mock.calls[0]
    expect(modelId).toBe("gpt-image-2-image-to-image")
    expect(body).toMatchObject({ input_urls: ["https://anchor.png"] })
    expect(body).not.toHaveProperty("image_input")
    // pricing parity: the i2i sibling costs the same as the t2i base
    expect(result.cost).toBe(0.02)
  })

  it("gpt-image-2 WITHOUT an anchor stays on gpt-image-2-text-to-image", async () => {
    await provider.generateImage("a stone castle", undefined, "gpt-image-2")
    const [modelId, body] = mocks.mockRunKieTask.mock.calls[0]
    expect(modelId).toBe("gpt-image-2-text-to-image")
    expect(body).not.toHaveProperty("input_urls")
    expect(body).not.toHaveProperty("image_input")
  })

  it("gpt-image (1.5) + anchor routes to gpt-image/1.5-image-to-image via input_urls", async () => {
    await provider.generateImage("smiling expression", ["https://a.png", "https://b.png"], "gpt-image")
    const [modelId, body] = mocks.mockRunKieTask.mock.calls[0]
    expect(modelId).toBe("gpt-image/1.5-image-to-image")
    expect(body).toMatchObject({ input_urls: ["https://a.png", "https://b.png"] })
    expect(body).not.toHaveProperty("image_input")
  })

  it("gpt-image (1.5) WITHOUT an anchor stays on gpt-image/1.5-text-to-image", async () => {
    await provider.generateImage("a wide landscape", undefined, "gpt-image")
    const [modelId, body] = mocks.mockRunKieTask.mock.calls[0]
    expect(modelId).toBe("gpt-image/1.5-text-to-image")
    expect(body).not.toHaveProperty("input_urls")
  })
})

describe("KieImageProvider.editImage", () => {
  it("happy path with default model (recraft-upscale)", async () => {
    const result = await provider.editImage("https://input.png")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith("recraft/crisp-upscale", expect.objectContaining({ image: "https://input.png" }), undefined, undefined, undefined)
    expect(result.url).toBe("https://kie.example.com/result.png")
    expect(result.cost).toBe(0.04)
  })

  it("includes prompt for nano-banana-edit", async () => {
    await provider.editImage("https://input.png", "make it blue", "nano-banana-edit")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "google/nano-banana-edit",
      expect.objectContaining({ prompt: "make it blue", image_urls: ["https://input.png"] }),
      undefined,
      undefined,
      undefined,
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
