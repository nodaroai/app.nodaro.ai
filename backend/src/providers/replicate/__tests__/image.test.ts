import { describe, it, expect, vi, beforeEach } from "vitest"
import { flux2CostUsd } from "@nodaro/shared"

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
  // Faithful stand-in for the real client.ts helper: same create → fire →
  // wait → extractCost envelope, driven by the same low-level mocks so the
  // assertions on mockCreate / mockWait / mockExtractCost / onTaskCreated
  // (order + args) still describe real behavior.
  runReplicatePrediction: async (opts: {
    version?: string
    model?: string
    input: Record<string, unknown>
    label: string
    reconcileOpts?: { onTaskCreated?: (id: string) => Promise<void> }
    costModelKey?: string
  }) => {
    const createOptions =
      opts.version !== undefined
        ? { version: opts.version, input: opts.input }
        : { model: opts.model, input: opts.input }
    const prediction = await mocks.mockCreate(createOptions)
    if (opts.reconcileOpts?.onTaskCreated) {
      try {
        await opts.reconcileOpts.onTaskCreated(prediction.id)
      } catch {
        /* fireOnTaskCreated swallows */
      }
    }
    const completed = await mocks.mockWait(prediction)
    const cost = mocks.mockExtractCost(completed.metrics, opts.costModelKey)
    return { output: completed.output, cost, predictionId: prediction.id }
  },
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
    // flux-2-klein cost is formula-derived (not GPU-time): 1 MP default, 0 refs
    expect(result.cost).toBe(flux2CostUsd("flux-2-klein", 1, 0))
  })

  it("translates prompt to English", async () => {
    mocks.mockTranslateToEnglish.mockResolvedValueOnce("a cat in English")
    await provider.generateImage("une chat")
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ prompt: "a cat in English" }),
    }))
  })

  it("flux-2-klein forwards refs as an `images` array", async () => {
    await provider.generateImage("style", ["https://ref.png"], "flux-2-klein")
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    expect(callArgs.model).toBe("black-forest-labs/flux-2-klein-9b")
    expect(callArgs.input).toEqual(expect.objectContaining({
      prompt: "style",
      images: ["https://ref.png"],
    }))
    // flux-2-klein-9b's schema field is `images` (array, max 5) — the old
    // single-string `image` field does not exist and is silently dropped.
    expect(callArgs.input.image).toBeUndefined()
  })

  it("kontext-multi maps refs to input_image_1/2 only (model has no input_image_3+)", async () => {
    await provider.generateImage(
      "merge",
      ["https://a.png", "https://b.png", "https://c.png", "https://d.png"],
      "kontext-multi",
    )
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    expect(callArgs.model).toBe("flux-kontext-apps/multi-image-kontext-pro")
    expect(callArgs.input).toEqual(expect.objectContaining({
      prompt: "merge",
      input_image_1: "https://a.png",
      input_image_2: "https://b.png",
      aspect_ratio: "1:1",
      output_format: "png",
    }))
    // multi-image-kontext-pro only accepts input_image_1 + input_image_2;
    // sending _3/_4 would be silently dropped by Replicate, so we must not.
    expect(callArgs.input.input_image_3).toBeUndefined()
    expect(callArgs.input.input_image_4).toBeUndefined()
  })

  it("flux-2-pro maps refs to an input_images array with safety_tolerance=5", async () => {
    await provider.generateImage(
      "open-content scene",
      ["https://a.png", "https://b.png", "https://c.png", "https://d.png"],
      "flux-2-pro",
    )
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    expect(callArgs.model).toBe("black-forest-labs/flux-2-pro")
    expect(callArgs.input).toEqual(expect.objectContaining({
      prompt: "open-content scene",
      input_images: ["https://a.png", "https://b.png", "https://c.png", "https://d.png"],
      aspect_ratio: "1:1",
      output_format: "png",
      safety_tolerance: 5,
    }))
    // Legacy per-index fields are not part of the real schema
    expect(callArgs.input.image_prompt_1).toBeUndefined()
  })

  it("flux-2-pro pure t2i (no refs) still sends safety_tolerance=5 and no input_images", async () => {
    await provider.generateImage("solo prompt", undefined, "flux-2-pro")
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    expect(callArgs.model).toBe("black-forest-labs/flux-2-pro")
    expect(callArgs.input).toEqual(expect.objectContaining({
      prompt: "solo prompt",
      aspect_ratio: "1:1",
      output_format: "png",
      safety_tolerance: 5,
    }))
    expect(callArgs.input.input_images).toBeUndefined()
  })

  it("flux-2-max maps refs to an input_images array with safety_tolerance=5", async () => {
    const refs = Array.from({ length: 8 }, (_, i) => `https://ref-${i + 1}.png`)
    await provider.generateImage("eight-ref scene", refs, "flux-2-max")
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    expect(callArgs.model).toBe("black-forest-labs/flux-2-max")
    expect(callArgs.input).toEqual(expect.objectContaining({
      prompt: "eight-ref scene",
      input_images: refs,
      aspect_ratio: "1:1",
      output_format: "png",
      safety_tolerance: 5,
    }))
    expect(callArgs.input.image_prompt_1).toBeUndefined()
  })

  it("flux-2-max caps refs at 8 when more are passed", async () => {
    const refs = Array.from({ length: 12 }, (_, i) => `https://r${i + 1}.png`)
    await provider.generateImage("overflow", refs, "flux-2-max")
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    const sent = callArgs.input.input_images as string[]
    expect(sent).toHaveLength(8)
    expect(sent[7]).toBe("https://r8.png")
    // Inputs 9..12 must NOT leak into the payload
    expect(sent).not.toContain("https://r9.png")
    expect(sent).not.toContain("https://r12.png")
  })

  it("flux-2-max pure t2i (no refs) sends safety_tolerance=5 and no input_images", async () => {
    await provider.generateImage("pure t2i", undefined, "flux-2-max")
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    expect(callArgs.model).toBe("black-forest-labs/flux-2-max")
    expect(callArgs.input).toEqual(expect.objectContaining({
      prompt: "pure t2i",
      aspect_ratio: "1:1",
      output_format: "png",
      safety_tolerance: 5,
    }))
    expect(callArgs.input.input_images).toBeUndefined()
  })

  // Regression: a production job (flux-2-max + a single reference image +
  // aspectRatio "1:1") completed but ignored the reference. buildInput wrote
  // the ref to a non-existent `image_prompt_1` field; the real schema takes a
  // single `input_images` array and Replicate silently drops unknown fields.
  it("flux-2-max with a single ref + explicit aspect_ratio sends input_images and keeps the ratio", async () => {
    await provider.generateImage(
      "change color to green",
      ["https://cdn.nodaro.ai/images/source.png"],
      "flux-2-max",
      { aspect_ratio: "1:1" },
    )
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    expect(callArgs.input.input_images).toEqual(["https://cdn.nodaro.ai/images/source.png"])
    expect(callArgs.input.aspect_ratio).toBe("1:1")
    expect(callArgs.input.image_prompt_1).toBeUndefined()
  })

  it("extracts cost from prediction metrics (non-flux-2 model, GPU-time path)", async () => {
    // Use kontext-multi (not a flux-2 model) to exercise the GPU-time cost path.
    // Flux 2 models override cost with the formula — this test guards the path
    // where predict_time * rate IS the cost that flows through.
    mocks.mockExtractCost.mockReturnValueOnce(0.01)
    const result = await provider.generateImage("test", undefined, "kontext-multi")
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

  it("calls onTaskCreated with the Replicate prediction.id before waiting", async () => {
    let onTaskCreatedTaskId: string | null = null
    let waitCalledAt = -1
    let callbackFiredAt = -1
    let counter = 0
    mocks.mockCreate.mockResolvedValueOnce({ id: "rep-pred-1" })
    mocks.mockWait.mockImplementationOnce(async () => {
      waitCalledAt = counter++
      return {
        output: "https://replicate.example.com/image.png",
        metrics: { predict_time: 2.5 },
      }
    })

    await provider.generateImage("a cat", undefined, "flux-2-pro", undefined, {
      onTaskCreated: async (id) => {
        onTaskCreatedTaskId = id
        callbackFiredAt = counter++
      },
    })

    expect(onTaskCreatedTaskId).toBe("rep-pred-1")
    // Callback must fire BEFORE wait
    expect(callbackFiredAt).toBeLessThan(waitCalledAt)
  })

  it("does not fail the prediction if onTaskCreated throws", async () => {
    mocks.mockCreate.mockResolvedValueOnce({ id: "rep-pred-2" })

    const result = await provider.generateImage("a cat", undefined, "flux-2-klein", undefined, {
      onTaskCreated: async () => {
        throw new Error("persistence failed")
      },
    })

    expect(result.url).toBe("https://replicate.example.com/image.png")
  })

  // ─── Resolution field mapping + cost override tests (TASK 6) ──────────────

  it("flux-2-max with resolution '2 MP' sends input.resolution='2 MP' and formula cost", async () => {
    const refs = ["https://ref-1.png", "https://ref-2.png"]
    const result = await provider.generateImage("scene", refs, "flux-2-max", { resolution: "2 MP" })
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    expect(callArgs.input.resolution).toBe("2 MP")
    // input_images still wired correctly
    expect(callArgs.input.input_images).toEqual(refs)
    // Cost is formula-derived, NOT the mocked GPU-time value (0.005)
    expect(result.cost).toBe(flux2CostUsd("flux-2-max", 2, refs.length))
    expect(result.cost).not.toBe(0.005)
  })

  it("flux-2-klein with resolution '2 MP' sends megapixels='2' (bare string) and no resolution field", async () => {
    await provider.generateImage("style", ["https://ref.png"], "flux-2-klein", { resolution: "2 MP" })
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    expect(callArgs.input.megapixels).toBe("2")
    expect(callArgs.input.resolution).toBeUndefined()
    // images array still wired
    expect(callArgs.input.images).toEqual(["https://ref.png"])
  })

  it("flux-2-pro with resolution '0.5 MP' sends input.resolution='0.5 MP'", async () => {
    await provider.generateImage("solo", undefined, "flux-2-pro", { resolution: "0.5 MP" })
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    expect(callArgs.input.resolution).toBe("0.5 MP")
  })

  it("flux-2-max with NO resolution extraParam defaults to '1 MP' and formula cost at 1 MP", async () => {
    const refs = ["https://ref-1.png"]
    const result = await provider.generateImage("legacy", refs, "flux-2-max")
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    // resolutionMp returns 1 when resolution is absent (legacy node behavior)
    expect(callArgs.input.resolution).toBe("1 MP")
    expect(result.cost).toBe(flux2CostUsd("flux-2-max", 1, refs.length))
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
