import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockRunKieTask = vi.fn()
  const mockCreateSanitizedError = vi.fn((msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`))
  const mockSafeFetch = vi.fn()
  const mockUploadBufferToR2 = vi.fn()
  return { mockRunKieTask, mockCreateSanitizedError, mockSafeFetch, mockUploadBufferToR2 }
})

vi.mock("../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client.js")>()
  return {
    // Real class so `err instanceof KieError` checks in image.ts stay honest.
    KieError: actual.KieError,
    runKieTask: mocks.mockRunKieTask,
    createSanitizedError: mocks.mockCreateSanitizedError,
  }
})

// Spread the real module: editImage now imports the shared image-format
// chokepoint from ../video.js, which pulls the KIE_VIDEO_* maps out of
// models.js. A fixture-only mock would leave those undefined.
vi.mock("../models.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../models.js")>()),
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
    "ideogram-edit": { model: "ideogram/character-edit", cost: 0.09, inputType: "image-to-image", imageParam: "image_url", extraParams: { rendering_speed: "BALANCED", style: "AUTO" } },
  },
}))

// editImage now runs its source image through ensureImageForProvider (the
// shared format chokepoint), which downloads via safeFetch and — for a format
// the SKU does not accept — re-uploads a JPEG to R2. Serve a real 8x8 PNG so
// every test below takes the already-accepted pass-through path and neither
// the network nor R2 is touched. See image-format-normalize.test.ts for the
// conversion behaviour itself.
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: mocks.mockSafeFetch }))
vi.mock("../../../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage.js")>()),
  uploadBufferToR2: mocks.mockUploadBufferToR2,
}))

import sharp from "sharp"
import { KieError } from "../client.js"
import { KieImageProvider } from "../image.js"

let provider: KieImageProvider
let pngFixture: Buffer

beforeAll(async () => {
  pngFixture = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#fff" },
  }).png().toBuffer()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockRunKieTask.mockResolvedValue({
    resultJson: { resultUrls: ["https://kie.example.com/result.png"] },
  })
  mocks.mockSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => pngFixture,
  })
  mocks.mockUploadBufferToR2.mockResolvedValue("https://cdn.example.com/converted.jpg")
  provider = new KieImageProvider()
})

describe("KieImageProvider.generateImage", () => {
  it("happy path with default model (nano-banana)", async () => {
    const result = await provider.generateImage("a cat")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith("nano-banana-pro", expect.objectContaining({ prompt: "a cat" }), undefined, undefined, expect.objectContaining({ modelKey: "nano-banana" }))
    expect(result.url).toBe("https://kie.example.com/result.png")
    expect(result.cost).toBe(0.02)
  })

  it("uses custom model (flux)", async () => {
    const result = await provider.generateImage("a dog", undefined, "flux")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith("flux-2/pro-text-to-image", expect.objectContaining({ prompt: "a dog" }), undefined, undefined, expect.objectContaining({ modelKey: "flux" }))
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
      expect.objectContaining({ modelKey: "nano-banana" }),
    )
  })

  it("passes reference images via array imageParam for grok (image_urls)", async () => {
    await provider.generateImage("edit", ["https://img.png"], "grok-i2i")
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith(
      "grok-imagine/image-to-image",
      expect.objectContaining({ image_urls: ["https://img.png"] }),
      undefined,
      undefined,
      expect.objectContaining({ modelKey: "grok-i2i" }),
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
    expect(mocks.mockRunKieTask).toHaveBeenCalledWith("recraft/crisp-upscale", expect.objectContaining({ image: "https://input.png" }), undefined, undefined, expect.objectContaining({ modelKey: "recraft-upscale" }))
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
      expect.objectContaining({ modelKey: "nano-banana-edit" }),
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

describe("ideogram-edit upstream internal-500 hint", () => {
  // Incident 2026-08-14 (jobs 4a3a6023 / 7f5fb8b2): ideogram/character-edit
  // used as a generic masked i2i died twice with a terminal KIE
  // `[500] internal error, please try again later.` on identical payloads.
  // The generic "Please try again" message is wrong advice for a
  // deterministic failure — generateImage swaps in an actionable hint while
  // preserving the upstream-failure classification the reconcile path keys on.
  const upstream500 = () =>
    new KieError(
      "Generation failed. Please try again or contact support if the issue persists.",
      "task failed: [500] internal error, please try again later.",
      "Generation",
      true,
      false,
    )

  it("swaps in the Flux Fill hint and preserves classification flags", async () => {
    mocks.mockRunKieTask.mockRejectedValueOnce(upstream500())
    await expect(
      provider.generateImage("Replace on iPad", undefined, "ideogram-edit"),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Flux Fill"),
      internalDetails: "task failed: [500] internal error, please try again later.",
      isUpstreamFailure: true,
      contentPolicy: false,
    })
  })

  it("leaves content-policy failures untouched (they carry a specific reason)", async () => {
    const policyErr = new KieError(
      "Content policy violation: blocked by the provider's safety filter.",
      "task failed: [500] flagged by moderation",
      "Generation",
      true,
      true,
    )
    mocks.mockRunKieTask.mockRejectedValueOnce(policyErr)
    await expect(
      provider.generateImage("edit", undefined, "ideogram-edit"),
    ).rejects.toBe(policyErr)
  })

  it("leaves non-500 upstream failures untouched", async () => {
    const validationErr = new KieError(
      "Invalid input parameters. Please check your settings and try again.",
      "task failed: [400] mask dimensions mismatch",
      "Generation",
      true,
      false,
    )
    mocks.mockRunKieTask.mockRejectedValueOnce(validationErr)
    await expect(
      provider.generateImage("edit", undefined, "ideogram-edit"),
    ).rejects.toBe(validationErr)
  })

  it("does not hint for other providers on the same internal-500", async () => {
    mocks.mockRunKieTask.mockRejectedValueOnce(upstream500())
    await expect(
      provider.generateImage("a cat", undefined, "nano-banana"),
    ).rejects.toMatchObject({
      message: "Generation failed. Please try again or contact support if the issue persists.",
    })
  })
})
