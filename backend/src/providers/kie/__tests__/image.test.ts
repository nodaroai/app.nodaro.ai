import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockRunKieTask = vi.fn()
  const mockCreateSanitizedError = vi.fn((msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`))
  const mockSafeFetch = vi.fn()
  const mockUploadBufferToR2 = vi.fn()
  const mockRunFluxKontextTask = vi.fn()
  return { mockRunKieTask, mockCreateSanitizedError, mockSafeFetch, mockUploadBufferToR2, mockRunFluxKontextTask }
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
// Flux Kontext runs on its own endpoint through this client, not runKieTask.
vi.mock("../kontext-client.js", () => ({
  runFluxKontextTask: mocks.mockRunFluxKontextTask,
}))

// Spread the real module: editImage now imports the shared image-format
// chokepoint from ../video.js, which pulls the KIE_VIDEO_* maps out of
// models.js. A fixture-only mock would leave those undefined.
vi.mock("../models.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../models.js")>()
  return {
    ...actual,
    KIE_IMAGE_MODELS: {
      // Seedream 5 Flash — the REAL configs, so the `resolutionParam: "size"`
      // declaration (its schema has no `resolution`/`quality`) is what is tested.
      "seedream-5-flash": actual.KIE_IMAGE_MODELS["seedream-5-flash"],
      "seedream-5-flash-i2i": actual.KIE_IMAGE_MODELS["seedream-5-flash-i2i"],
      "nano-banana": { model: "nano-banana-pro", cost: 0.02, inputType: "text-to-image", extraParams: { output_format: "png" } },
      "nano-banana-pro": actual.KIE_IMAGE_MODELS["nano-banana-pro"],
      "flux": { model: "flux-2/pro-text-to-image", cost: 0.05, inputType: "text-to-image", extraParams: {} },
      // Flux Kontext — the REAL configs: their camelCase `extraParams`
      // (`aspectRatio`, `outputFormat`) are what the aspect-ratio rename is tested against.
      "flux-kontext": actual.KIE_IMAGE_MODELS["flux-kontext"],
      "flux-kontext-max": actual.KIE_IMAGE_MODELS["flux-kontext-max"],
      // GPT Image 1.5 — t2i endpoint IGNORES a supplied anchor; the i2i sibling
      // consumes it via input_urls. Mirrors the real models.ts shapes (t2i has no
      // inputType/imageParam) so the t2i→i2i anchor routing is exercised honestly.
      "gpt-image": { model: "gpt-image/1.5-text-to-image", cost: 0.02, extraParams: { aspect_ratio: "3:2", quality: "medium" } },
      "gpt-image-i2i": { model: "gpt-image/1.5-image-to-image", cost: 0.02, inputType: "image-to-image", imageParam: "input_urls", extraParams: { aspect_ratio: "3:2", quality: "medium" } },
      // GPT Image 2 — same quirk; resolution-based pricing instead of quality.
      // `cost` differs from every figure KIE bills on purpose: a picture's
      // recorded cost must come from GPT_IMAGE_2_KIE_CREDITS, not from here.
      "gpt-image-2": { model: "gpt-image-2-text-to-image", cost: 0.02, extraParams: { aspect_ratio: "16:9", resolution: "1K" } },
      "gpt-image-2-i2i": { model: "gpt-image-2-image-to-image", cost: 0.02, inputType: "image-to-image", imageParam: "input_urls", extraParams: { aspect_ratio: "16:9", resolution: "1K" } },
      // GPT Image 2.5 Flare — same family quirk; widest ratio set, no cross-field limit.
      // GPT Image 2.6 — the REAL configs: what is tested is what they declare.
      "gpt-image-2-6-flare": actual.KIE_IMAGE_MODELS["gpt-image-2-6-flare"],
      "gpt-image-2-6-flare-i2i": actual.KIE_IMAGE_MODELS["gpt-image-2-6-flare-i2i"],
      "gpt-image-2-6-economy": actual.KIE_IMAGE_MODELS["gpt-image-2-6-economy"],
      "gpt-image-2-6-economy-i2i": actual.KIE_IMAGE_MODELS["gpt-image-2-6-economy-i2i"],
      "gpt-image-2-6-sunburst-i2i": actual.KIE_IMAGE_MODELS["gpt-image-2-6-sunburst-i2i"],
      "gpt-image-2-5-flare": { model: "gpt-image-2-5-flare-text-to-image", cost: 0.03, extraParams: { aspect_ratio: "16:9", resolution: "1K" } },
      "gpt-image-2-5-flare-i2i": { model: "gpt-image-2-5-flare-image-to-image", cost: 0.03, inputType: "image-to-image", imageParam: "input_urls", extraParams: { aspect_ratio: "16:9", resolution: "1K" } },
      "grok-i2i": { model: "grok-imagine/image-to-image", cost: 0.04, inputType: "image-to-image", imageParam: "image_urls", extraParams: {} },
      // Z-Image — the family's SHORTEST prompt cap (1000 chars, docs.kie.ai), so
      // it is the fixture the per-provider clamp is exercised on.
      "z-image": { model: "z-image", cost: 0.004, extraParams: { aspect_ratio: "16:9" } },
      "recraft-upscale": { model: "recraft/crisp-upscale", cost: 0.04, inputType: "image-to-image", imageParam: "image", extraParams: {} },
      "recraft-remove-bg": { model: "recraft/remove-background", cost: 0.03, inputType: "image-to-image", imageParam: "image", extraParams: {} },
      "nano-banana-edit": { model: "google/nano-banana-edit", cost: 0.04, inputType: "image-to-image", imageParam: "image_urls", extraParams: {} },
      // The REAL config, so its `maskEditColor: "black"` declaration is what is tested.
      "ideogram-edit": actual.KIE_IMAGE_MODELS["ideogram-edit"],
      // SKUs whose KIE schema types `seed` as a STRING (google/imagen4 and
      // imagen4-ultra are the real ones). One per lane, so both input builders
      // are shown to honour the declaration — not a model name.
      "string-seed-t2i": { model: "test/string-seed-t2i", cost: 0.01, seedType: "string", extraParams: {} },
      "string-seed-edit": { model: "test/string-seed-edit", cost: 0.01, inputType: "image-to-image", imageParam: "image_url", seedType: "string", extraParams: {} },
    },
  }
})

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
import { getMaxImagePromptChars } from "@nodaro/shared/models"
import { GPT_IMAGE_2_KIE_CREDITS, KIE_CREDIT_USD, KIE_IMAGE_MODELS } from "../models.js"

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

  it("flux-kontext: the caller's aspect ratio reaches the Kontext endpoint as camelCase `aspectRatio`, never beside the config default", async () => {
    // The Kontext endpoint reads camelCase fields; the config default
    // `aspectRatio: "16:9"` beside a snake_case `aspect_ratio` won — every
    // picture came out 1280×720 (prod 2026-10-28, six 9:16 / 3:4 runs).
    mocks.mockRunFluxKontextTask.mockResolvedValue({ resultJson: { resultUrls: ["https://kie.example.com/k.png"] } })
    for (const kontext of ["flux-kontext", "flux-kontext-max"]) {
      await provider.generateImage("a tall tree", undefined, kontext, { aspect_ratio: "9:16" })
      const [, input] = mocks.mockRunFluxKontextTask.mock.calls.at(-1) as [string, Record<string, unknown>]
      expect(input.aspectRatio).toBe("9:16")
      expect(input).not.toHaveProperty("aspect_ratio")
      expect(input.outputFormat).toBe("jpeg")
    }
    // No caller choice: the config default stands.
    await provider.generateImage("a wide field", undefined, "flux-kontext")
    const [, input] = mocks.mockRunFluxKontextTask.mock.calls.at(-1) as [string, Record<string, unknown>]
    expect(input.aspectRatio).toBe("16:9")
    expect(input).not.toHaveProperty("aspect_ratio")
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

  // Prod 2026-09-07: three z-image runs from one workflow reached KIE with a
  // prompt over the model's 1000-char cap and came back
  // {"code":500,"msg":"The text length cannot exceed the maximum limit"}. The
  // per-provider cap was enforced only inside the structured prompt assembler,
  // so the flat path (orchestrator / API / MCP) sent whatever it was handed.
  it("truncates a prompt over the provider's cap instead of sending it (z-image, 1000)", async () => {
    await provider.generateImage("x".repeat(4000), undefined, "z-image")
    const input = mocks.mockRunKieTask.mock.calls[0][1] as { prompt: string }
    expect(input.prompt.length).toBe(getMaxImagePromptChars("z-image"))
    expect(input.prompt.endsWith("...")).toBe(true)
  })

  it("leaves a prompt inside the cap byte-identical", async () => {
    await provider.generateImage("a short prompt", undefined, "z-image")
    const input = mocks.mockRunKieTask.mock.calls[0][1] as { prompt: string }
    expect(input.prompt).toBe("a short prompt")
  })

  // The cap follows the FINAL provider: the t2i → i2i swap below raises
  // gpt-image-2's 5000 to gpt-image-2-i2i's 20000, so an 8000-char prompt that
  // would be cut on the t2i lane must survive intact on the i2i one.
  it("clamps against the swapped-to provider, not the requested one", async () => {
    await provider.generateImage("y".repeat(8000), ["https://ref1.png"], "gpt-image-2")
    const input = mocks.mockRunKieTask.mock.calls[0][1] as { prompt: string }
    expect(input.prompt.length).toBe(8000)
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
    expect(result.cost).toBe(GPT_IMAGE_2_KIE_CREDITS["1K"] * KIE_CREDIT_USD)
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

  it("gpt-image-2.5 + anchor routes to the flare i2i endpoint via input_urls", async () => {
    await provider.generateImage("front 3/4 view", ["https://anchor.png"], "gpt-image-2-5-flare")
    const [modelId, body] = mocks.mockRunKieTask.mock.calls[0]
    expect(modelId).toBe("gpt-image-2-5-flare-image-to-image")
    expect(body).toMatchObject({ input_urls: ["https://anchor.png"] })
    expect(body).not.toHaveProperty("image_input")
  })

  it("gpt-image-2.5 WITHOUT an anchor stays on the flare t2i endpoint", async () => {
    await provider.generateImage("a stone castle", undefined, "gpt-image-2-5-flare")
    const [modelId, body] = mocks.mockRunKieTask.mock.calls[0]
    expect(modelId).toBe("gpt-image-2-5-flare-text-to-image")
    expect(body).not.toHaveProperty("input_urls")
  })

  // The four ratios GPT Image 2.5 adds (27:16, 16:27, 9:8, 8:9) are novel to the
  // whole platform. Assert they reach KIE VERBATIM as `aspect_ratio` — the named
  // image_size rewrite (RATIO_TO_NAMED_SIZE) must NOT apply to this family, and
  // `resolution` must survive because 2.5 prices on it.
  it.each(["27:16", "16:27", "9:8", "8:9", "21:9", "3:2"])(
    "gpt-image-2.5 passes the novel ratio %s through verbatim with resolution intact",
    async (ratio) => {
      await provider.generateImage("wide vista", undefined, "gpt-image-2-5-flare", {
        aspect_ratio: ratio,
        resolution: "2K",
      })
      const [modelId, body] = mocks.mockRunKieTask.mock.calls[0]
      expect(modelId).toBe("gpt-image-2-5-flare-text-to-image")
      expect(body).toMatchObject({ aspect_ratio: ratio, resolution: "2K" })
      expect(body).not.toHaveProperty("image_size")
    },
  )

  it("gpt-image-2.5 i2i carries the documented 16-image input_urls maximum", async () => {
    const urls = Array.from({ length: 16 }, (_, i) => `https://ref${i}.png`)
    await provider.generateImage("restyle", urls, "gpt-image-2-5-flare", { resolution: "4K" })
    const [modelId, body] = mocks.mockRunKieTask.mock.calls[0]
    expect(modelId).toBe("gpt-image-2-5-flare-image-to-image")
    expect(body).toMatchObject({ input_urls: urls, resolution: "4K" })
    expect((body as { input_urls: string[] }).input_urls).toHaveLength(16)
  })
})

describe("KieImageProvider: gpt-image-2 records its provider cost by the resolution it sends", () => {
  it("image-to-image at 4K and at 2K: each its own figure", async () => {
    const at4k = await provider.generateImage("a sheet", ["https://ref.png"], "gpt-image-2-i2i", { resolution: "4K" })
    const at2k = await provider.generateImage("a body", ["https://ref.png"], "gpt-image-2-i2i", { resolution: "2K" })

    expect(at4k.cost).toBe(GPT_IMAGE_2_KIE_CREDITS["4K"] * KIE_CREDIT_USD)
    expect(at2k.cost).toBe(GPT_IMAGE_2_KIE_CREDITS["2K"] * KIE_CREDIT_USD)
    expect(at4k.cost).toBe(16 * KIE_CREDIT_USD)
    expect(at2k.cost).toBe(10 * KIE_CREDIT_USD)
  })

  it("text-to-image at 2K", async () => {
    const result = await provider.generateImage("a castle", undefined, "gpt-image-2", { resolution: "2K" })
    expect(mocks.mockRunKieTask.mock.calls[0]![0]).toBe("gpt-image-2-text-to-image")
    expect(result.cost).toBe(10 * KIE_CREDIT_USD)
  })

  it("the text-to-image id with a reference, swapped to its image-to-image sibling, at 4K", async () => {
    const result = await provider.generateImage("a sheet", ["https://ref.png"], "gpt-image-2", { resolution: "4K" })
    expect(mocks.mockRunKieTask.mock.calls[0]![0]).toBe("gpt-image-2-image-to-image")
    expect(result.cost).toBe(16 * KIE_CREDIT_USD)
  })

  it("1K, asked for or left to the model's default: 6 KIE credits", async () => {
    const asked = await provider.generateImage("a sheet", ["https://ref.png"], "gpt-image-2-i2i", { resolution: "1K" })
    const byDefault = await provider.generateImage("a castle", undefined, "gpt-image-2")

    expect(asked.cost).toBe(0.03)
    expect(asked.cost).toBe(6 * KIE_CREDIT_USD)
    expect(byDefault.cost).toBe(6 * KIE_CREDIT_USD)
  })

  it("the edit lane records the same figures", async () => {
    const at4k = await provider.editImage("https://input.png", undefined, "gpt-image-2-i2i", { resolution: "4K" })
    const at2k = await provider.editImage("https://input.png", undefined, "gpt-image-2-i2i", { resolution: "2K" })
    const at1k = await provider.editImage("https://input.png", undefined, "gpt-image-2-i2i")

    expect(at4k.cost).toBe(16 * KIE_CREDIT_USD)
    expect(at2k.cost).toBe(10 * KIE_CREDIT_USD)
    expect(at1k.cost).toBe(6 * KIE_CREDIT_USD)
  })

  it("another model keeps its config's figure at any resolution, on both lanes", async () => {
    const pro = KIE_IMAGE_MODELS["nano-banana-pro"]!.cost
    expect((await provider.generateImage("a cat", undefined, "nano-banana-pro", { resolution: "4K" })).cost).toBe(pro)
    expect((await provider.generateImage("a cat", undefined, "nano-banana-pro", { resolution: "1K" })).cost).toBe(pro)
    expect((await provider.editImage("https://input.png", "a cat", "nano-banana-pro", { resolution: "4K" })).cost).toBe(pro)
    // A sibling family whose id starts the same way is not caught by the table.
    const flare = KIE_IMAGE_MODELS["gpt-image-2-5-flare"]!.cost
    expect((await provider.generateImage("a cat", undefined, "gpt-image-2-5-flare", { resolution: "4K" })).cost).toBe(flare)
  })

  it("a resolution the table does not name keeps the config's figure, never NaN", async () => {
    const result = await provider.generateImage("a cat", undefined, "gpt-image-2", { resolution: "1 MP" })
    expect(result.cost).toBe(KIE_IMAGE_MODELS["gpt-image-2"]!.cost)
  })

  it("the KIE request is the one it was: the exact body, on both lanes", async () => {
    await provider.generateImage("a sheet", ["https://ref.png"], "gpt-image-2", { resolution: "4K", aspect_ratio: "4:3" })
    await provider.editImage("https://input.png", undefined, "gpt-image-2-i2i", { resolution: "2K", aspect_ratio: "4:3" })

    const [generate, edit] = mocks.mockRunKieTask.mock.calls
    expect(generate![0]).toBe("gpt-image-2-image-to-image")
    expect(generate![1]).toEqual({ prompt: "a sheet", aspect_ratio: "4:3", resolution: "4K", input_urls: ["https://ref.png"] })
    expect(generate![4].dimensions).toMatchObject({ resolution: "4K" })
    expect(edit![0]).toBe("gpt-image-2-image-to-image")
    expect(edit![1]).toEqual({ aspect_ratio: "4:3", resolution: "2K", input_urls: ["https://input.png"] })
    expect(edit![4].dimensions).toMatchObject({ resolution: "2K" })
  })

  it("the cost is all that is added: no meteredCost, so the job commits its reserved tier", async () => {
    const generated = await provider.generateImage("a sheet", ["https://ref.png"], "gpt-image-2-i2i", { resolution: "4K" })
    const edited = await provider.editImage("https://input.png", undefined, "gpt-image-2-i2i", { resolution: "4K" })

    expect(generated).toEqual({ url: "https://kie.example.com/result.png", cost: 16 * KIE_CREDIT_USD })
    expect(edited).toEqual({ url: "https://kie.example.com/result.png", cost: 16 * KIE_CREDIT_USD })
    expect(generated).not.toHaveProperty("meteredCost")
    expect(edited).not.toHaveProperty("meteredCost")
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

describe("seed wire type (models.ts `seedType`)", () => {
  // KIE checks `seed` against the TYPE in each SKU's schema, and a SKU that
  // declares a string refuses a number at createTask ("seed must be a string").
  // The worker hands the seed to both lanes in extraParams as a number.
  const sentSeed = () => (mocks.mockRunKieTask.mock.calls[0][1] as { seed?: unknown }).seed

  it("generateImage sends a string-seed SKU its seed as a decimal string", async () => {
    await provider.generateImage("a cat", undefined, "string-seed-t2i", { seed: 7103 })
    expect(sentSeed()).toBe("7103")
  })

  it("generateImage leaves the seed a number on a SKU that declares no seed type", async () => {
    await provider.generateImage("a cat", undefined, "flux", { seed: 7103 })
    expect(sentSeed()).toBe(7103)
  })

  it("editImage sends a string-seed SKU its seed as a decimal string", async () => {
    await provider.editImage("https://input.png", undefined, "string-seed-edit", { seed: 7103 })
    expect(sentSeed()).toBe("7103")
  })

  it("editImage leaves the seed a number on a SKU that declares no seed type", async () => {
    await provider.editImage("https://input.png", undefined, "ideogram-edit", { seed: 7103 })
    expect(sentSeed()).toBe(7103)
  })

  it("adds no seed when the caller sent none", async () => {
    await provider.generateImage("a cat", undefined, "string-seed-t2i")
    expect(mocks.mockRunKieTask.mock.calls[0][1]).not.toHaveProperty("seed")
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

describe("Seedream 5 Flash — resolution goes out as `size`", () => {
  const lastInput = () => mocks.mockRunKieTask.mock.calls.at(-1)?.[1] as Record<string, unknown>
  const lastOpts = () => mocks.mockRunKieTask.mock.calls.at(-1)?.[4] as { dimensions?: Record<string, unknown> }

  it("t2i: default 1K and a chosen 2K are sent as size, never as resolution", async () => {
    await provider.generateImage("a lighthouse at dusk", undefined, "seedream-5-flash")
    expect(mocks.mockRunKieTask.mock.calls.at(-1)?.[0]).toBe("seedream/5-flash-text-to-image")
    expect(lastInput()).toMatchObject({ size: "1K", aspect_ratio: "16:9", output_format: "png" })
    expect(lastInput()).not.toHaveProperty("resolution")

    await provider.generateImage("a lighthouse at dusk", undefined, "seedream-5-flash", { resolution: "2K", aspect_ratio: "21:9" })
    expect(lastInput()).toMatchObject({ size: "2K", aspect_ratio: "21:9" })
    expect(lastInput()).not.toHaveProperty("resolution")
    expect(lastOpts().dimensions).toMatchObject({ resolution: "2K" })
  })

  it("i2i: references ride image_urls and the size rename still applies", async () => {
    await provider.generateImage("make it winter", ["https://a.png", "https://b.png"], "seedream-5-flash-i2i", { resolution: "2K" })
    expect(mocks.mockRunKieTask.mock.calls.at(-1)?.[0]).toBe("seedream/5-flash-image-to-image")
    expect(lastInput()).toMatchObject({ image_urls: ["https://a.png", "https://b.png"], size: "2K" })
    expect(lastInput()).not.toHaveProperty("resolution")
  })

  it("editImage lane: prompt is kept, size replaces resolution", async () => {
    await provider.editImage("https://src.png", "make it winter", "seedream-5-flash-i2i", { resolution: "2K" })
    expect(mocks.mockRunKieTask.mock.calls.at(-1)?.[0]).toBe("seedream/5-flash-image-to-image")
    expect(lastInput()).toMatchObject({ prompt: "make it winter", image_urls: ["https://src.png"], size: "2K" })
    expect(lastInput()).not.toHaveProperty("resolution")
    expect(lastOpts().dimensions).toMatchObject({ resolution: "2K" })
  })
})

describe("ideogram-edit mask polarity (models.ts `maskEditColor`)", () => {
  // Production 2026-10-19: a mask painted white over the trees (the platform's
  // white = change) recolored everything BUT the trees on Ideogram, which
  // reads black as the area to edit. The same mask on flux-fill was right.
  let maskFixture: Buffer // left half white (change), right half black (keep)

  beforeAll(async () => {
    const half = await sharp({ create: { width: 4, height: 8, channels: 3, background: "#fff" } }).png().toBuffer()
    maskFixture = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } })
      .composite([{ input: half, left: 0, top: 0 }])
      .png()
      .toBuffer()
  })

  beforeEach(() => {
    mocks.mockSafeFetch.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => (url.includes("mask") ? maskFixture : pngFixture),
    }))
    mocks.mockUploadBufferToR2.mockResolvedValue("https://cdn.example.com/prepared-mask.png")
  })

  const sentInput = () => mocks.mockRunKieTask.mock.calls[0]![1] as Record<string, unknown>
  const greyAt = async (png: Buffer, x: number, y: number) => {
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
    return data[y * info.width + x]
  }

  it("declares Ideogram's mask black = edit", () => {
    expect(KIE_IMAGE_MODELS["ideogram-edit"]?.maskEditColor).toBe("black")
  })

  it("inverts a caller's mask, so the painted area is the one Ideogram edits", async () => {
    await provider.generateImage("recolor the trees", ["https://src.png"], "ideogram-edit", { mask_url: "https://x/mask.png" })

    const [buffer, key] = mocks.mockUploadBufferToR2.mock.calls[0]! as [Buffer, string]
    expect(key).toContain("prepared-mask")
    expect(await greyAt(buffer, 0, 0)).toBe(0) // painted (white) → black: edit
    expect(await greyAt(buffer, 7, 7)).toBe(255) // unpainted (black) → white: keep
    expect(sentInput().mask_url).toBe("https://cdn.example.com/prepared-mask.png")
    expect(sentInput().image_url).toBe("https://src.png")
  })

  it("never inverts the source-image stand-in sent when the caller gave no mask", async () => {
    await provider.generateImage("restyle", ["https://src.png"], "ideogram-edit")

    expect(mocks.mockUploadBufferToR2).not.toHaveBeenCalled()
    expect(sentInput().mask_url).toBe("https://src.png")
  })
})

describe("GPT Image 2.6 on the wire", () => {
  beforeEach(() => vi.clearAllMocks())
  const done = (creditsConsumed?: unknown) => ({
    resultJson: { resultUrls: ["https://result.png"] },
    rawRecordInfo: { code: 200, message: "success", data: creditsConsumed === undefined ? { taskId: "t1" } : { taskId: "t1", creditsConsumed } },
  })

  it("sends KIE's model id, the quality, the size and the background", async () => {
    mocks.mockRunKieTask.mockResolvedValue(done(9.5))
    await provider.generateImage("a tag that reads BATCH 07", undefined, "gpt-image-2-6-flare", { quality: "low", resolution: "1K", background: "transparent" })
    const [modelId, input] = mocks.mockRunKieTask.mock.calls[0]!
    expect(modelId).toBe("gpt-image-2-6/flare-text-to-image")
    expect(input).toMatchObject({ quality: "low", resolution: "1K", background: "transparent" })
    expect(input.moderation).toBeUndefined()
  })

  it("an image sent moves it to the edit endpoint as input_urls", async () => {
    mocks.mockRunKieTask.mockResolvedValue(done(12))
    await provider.generateImage("keep the bottle", ["https://a.png"], "gpt-image-2-6-flare")
    const [modelId, input] = mocks.mockRunKieTask.mock.calls[0]!
    expect(modelId).toBe("gpt-image-2-6/flare-image-to-image")
    expect(input.input_urls).toHaveLength(1)
  })

  it("never sends more than 16 input images, the first one kept", async () => {
    mocks.mockRunKieTask.mockResolvedValue(done(40))
    const urls = Array.from({ length: 17 }, (_, i) => `https://img${i}.png`)
    await provider.generateImage("keep the bottle", urls, "gpt-image-2-6-flare")
    const [, input] = mocks.mockRunKieTask.mock.calls[0]!
    expect(input.input_urls).toHaveLength(16)
    expect(input.input_urls[0]).toBe("https://img0.png")
    expect(input.input_urls[15]).toBe("https://img15.png")
  })

  it("Economy sends neither quality nor size", async () => {
    mocks.mockRunKieTask.mockResolvedValue(done(5))
    await provider.generateImage("a cat", undefined, "gpt-image-2-6-economy")
    const [modelId, input] = mocks.mockRunKieTask.mock.calls[0]!
    expect(modelId).toBe("gpt-image-2-6/economy-text-to-image")
    expect(input.quality).toBeUndefined()
    expect(input.resolution).toBeUndefined()
  })

  it("sends a Flare request only the fields of its schema", async () => {
    mocks.mockRunKieTask.mockResolvedValue(done(9.5))
    await provider.generateImage("a cat", undefined, "gpt-image-2-6-flare", {
      aspect_ratio: "16:9", resolution: "2K", quality: "high", background: "auto",
      seed: 7, strength: 0.5, guidance_scale: 3, rendering_speed: "TURBO", style_type: "REALISTIC", negative_prompt: "x", mask_url: "https://m.png",
    })
    const [, input] = mocks.mockRunKieTask.mock.calls[0]!
    expect(Object.keys(input).sort()).toEqual(["aspect_ratio", "background", "prompt", "quality", "resolution"])
  })

  it("an edit keeps its images and drops a stray seed", async () => {
    mocks.mockRunKieTask.mockResolvedValue(done(12))
    await provider.generateImage("keep it", ["https://a.png"], "gpt-image-2-6-sunburst-i2i", { seed: 3 })
    const [, input] = mocks.mockRunKieTask.mock.calls[0]!
    expect(input.input_urls).toHaveLength(1)
    expect(input.mask_url).toBeUndefined()
    expect(input.seed).toBeUndefined()
  })

  it("Economy's edit sends no mask (its schema has none)", async () => {
    mocks.mockRunKieTask.mockResolvedValue(done(5))
    const result = await provider.generateImage("keep it", ["https://a.png"], "gpt-image-2-6-economy-i2i", { mask_url: "https://m.png" })
    const [, input] = mocks.mockRunKieTask.mock.calls[0]!
    expect(input.mask_url).toBeUndefined()
    expect(mocks.mockUploadBufferToR2).not.toHaveBeenCalled()
    expect(result.maskEditSourceUrl).toBeUndefined()
  })

  it("quality auto is sent as it is and reports what KIE billed", async () => {
    mocks.mockRunKieTask.mockResolvedValue(done(21.5))
    const result = await provider.generateImage("a cat", undefined, "gpt-image-2-6-flare", { quality: "auto" })
    expect(mocks.mockRunKieTask.mock.calls[0]![1]).toMatchObject({ quality: "auto" })
    expect(result.autoQualityKieCredits).toBe(21.5)
  })

  it("every other quality keeps its fixed price: no settlement figure", async () => {
    mocks.mockRunKieTask.mockResolvedValue(done(21.5))
    const result = await provider.generateImage("a cat", undefined, "gpt-image-2-6-flare", { quality: "max" })
    expect(result.autoQualityKieCredits).toBeUndefined()
  })

  it("an auto run whose record has no figure says so loudly and settles on nothing", async () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.mockRunKieTask.mockResolvedValue(done())
    const result = await provider.generateImage("a cat", undefined, "gpt-image-2-6-flare", { quality: "auto" })
    expect(result.autoQualityKieCredits).toBeUndefined()
    expect(alert.mock.calls.some(([m]) => String(m).startsWith("[ALERT]") && String(m).includes("Max price"))).toBe(true)
    alert.mockRestore()
  })

  it("Economy sends only what its own schema has", async () => {
    mocks.mockRunKieTask.mockResolvedValue(done(5))
    await provider.generateImage("a cat", ["https://a.png"], "gpt-image-2-6-economy-i2i", {
      aspect_ratio: "1:1", resolution: "2K", quality: "high", background: "transparent", moderation: "low", seed: 1,
    })
    const [modelId, input] = mocks.mockRunKieTask.mock.calls[0]!
    expect(modelId).toBe("gpt-image-2-6/economy-image-to-image")
    expect(Object.keys(input).sort()).toEqual(["aspect_ratio", "background", "input_urls", "prompt"])
  })

  it("another model is sent as before", async () => {
    mocks.mockRunKieTask.mockResolvedValue(done())
    await provider.generateImage("a cat", undefined, "gpt-image-2-5-flare", { seed: 9 })
    expect(mocks.mockRunKieTask.mock.calls[0]![1].seed).toBe(9)
  })

  it("records what the task really consumed", async () => {
    mocks.mockRunKieTask.mockResolvedValue(done(9.5))
    const result = await provider.generateImage("a cat", undefined, "gpt-image-2-6-flare")
    expect(result.cost).toBeCloseTo(9.5 * 0.005, 6)
  })

  it("keeps the listed figure when the record carries none", async () => {
    mocks.mockRunKieTask.mockResolvedValue(done())
    const result = await provider.generateImage("a cat", undefined, "gpt-image-2-6-flare")
    expect(result.cost).toBe(0.0391)
  })
})

describe("GPT Image 2.6 masks (models.ts `maskFormat`: transparent = change)", () => {
  // A live masked run (2026-11-11): an opaque white-on-black mask is refused
  // ("must be a PNG with an alpha channel"); a transparent box is where it
  // changes. The platform's mask stays white = change, converted here.
  const SOURCE = "https://src.png"
  let source8: Buffer // 8x8, the image the mask is aligned to
  let mask8: Buffer // 8x8: column 0 white, column 1 grey 128, the rest black
  let mask4White: Buffer // 4x4 all white: resized to the source

  beforeAll(async () => {
    source8 = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#3366cc" } }).png().toBuffer()
    const raw = Buffer.alloc(8 * 8)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) raw[y * 8 + x] = x === 0 ? 255 : x === 1 ? 128 : 0
    mask8 = await sharp(raw, { raw: { width: 8, height: 8, channels: 1 } }).png().toBuffer()
    mask4White = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer()
  })

  const serve = (masks: Record<string, Buffer>) => {
    mocks.mockSafeFetch.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => masks[url] ?? source8,
    }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    serve({ "https://x/mask.png": mask8, "https://x/mask-small.png": mask4White })
    mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://result.png"] } })
    mocks.mockUploadBufferToR2.mockResolvedValue("https://cdn.example.com/prepared-mask.png")
  })

  const sentInput = () => mocks.mockRunKieTask.mock.calls[0]![1] as Record<string, unknown>
  const uploadedMask = () => mocks.mockUploadBufferToR2.mock.calls[0]! as [Buffer, string, string]
  const rgbaAt = async (png: Buffer, x: number, y: number) => {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    const i = (y * info.width + x) * info.channels
    return [...data.subarray(i, i + info.channels)]
  }

  for (const model of ["gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst-i2i"] as const) {
    it(`${model}: sends a PNG with an alpha channel, transparent where the mask is white`, async () => {
      const result = await provider.generateImage("make it green", [SOURCE], model, { mask_url: "https://x/mask.png" })

      const [buffer, key, contentType] = uploadedMask()
      expect(key).toContain("prepared-mask")
      expect(key).toMatch(/\.png$/)
      expect(contentType).toBe("image/png")
      const meta = await sharp(buffer).metadata()
      expect(meta.format).toBe("png")
      expect(meta.hasAlpha).toBe(true)
      expect(meta.channels).toBe(4)
      expect((await rgbaAt(buffer, 0, 3))[3]).toBe(0) // white → transparent: change
      expect((await rgbaAt(buffer, 5, 3))[3]).toBe(255) // black → opaque: keep
      expect((await rgbaAt(buffer, 1, 3))[3]).toBe(127) // grey 128 → alpha 127: a soft edge stays soft

      const input = sentInput()
      expect(input.mask_url).toBe("https://cdn.example.com/prepared-mask.png")
      expect(input.input_urls).toEqual([SOURCE])
      expect(input).not.toHaveProperty("markup")
      expect(result.maskEditSourceUrl).toBe(SOURCE)
    })
  }

  it("sizes the mask to the source image", async () => {
    await provider.generateImage("make it green", [SOURCE], "gpt-image-2-6-flare-i2i", { mask_url: "https://x/mask-small.png" })
    const [buffer] = uploadedMask()
    const meta = await sharp(buffer).metadata()
    expect([meta.width, meta.height]).toEqual([8, 8])
    expect(meta.hasAlpha).toBe(true)
    expect((await rgbaAt(buffer, 7, 7))[3]).toBe(0)
  })

  it("an all-black mask is still a PNG with an alpha channel, opaque everywhere", async () => {
    const black = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).png().toBuffer()
    serve({ "https://x/black.png": black })
    await provider.generateImage("nothing", [SOURCE], "gpt-image-2-6-flare-i2i", { mask_url: "https://x/black.png" })
    const [buffer] = uploadedMask()
    const meta = await sharp(buffer).metadata()
    expect(meta.channels).toBe(4)
    expect((await rgbaAt(buffer, 0, 0))[3]).toBe(255)
    expect((await rgbaAt(buffer, 7, 7))[3]).toBe(255)
  })

  for (const format of ["jpeg", "webp"] as const) {
    it(`a ${format} edit sends the mask too`, async () => {
      await provider.generateImage("make it green", [SOURCE], "gpt-image-2-6-flare-i2i", { mask_url: "https://x/mask.png", output_format: format })
      expect(sentInput()).toMatchObject({ output_format: format, mask_url: "https://cdn.example.com/prepared-mask.png" })
    })
  }

  for (const format of ["gif", "svg"] as const) {
    it(`a ${format} edit sends no mask and converts none (KIE refuses a mask with it)`, async () => {
      const result = await provider.generateImage("make it green", [SOURCE], "gpt-image-2-6-flare-i2i", { mask_url: "https://x/mask.png", output_format: format })
      expect(sentInput()).not.toHaveProperty("mask_url")
      expect(mocks.mockUploadBufferToR2).not.toHaveBeenCalled()
      expect(result.maskEditSourceUrl).toBeUndefined()
    })
  }

  it("an edit with no mask sends none and asks for no paste-back", async () => {
    const result = await provider.generateImage("make it green", [SOURCE], "gpt-image-2-6-flare-i2i")
    expect(sentInput()).not.toHaveProperty("mask_url")
    expect(mocks.mockUploadBufferToR2).not.toHaveBeenCalled()
    expect(result.maskEditSourceUrl).toBeUndefined()
  })

  it("a mask on GPT Image 2.6's text-to-image id with no image is dropped, as before", async () => {
    const result = await provider.generateImage("a cat", undefined, "gpt-image-2-6-flare", { mask_url: "https://x/mask.png" })
    expect(sentInput()).not.toHaveProperty("mask_url")
    expect(result.maskEditSourceUrl).toBeUndefined()
  })
})
