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

  it("flux-2-pro maps refs to image_prompt_1..4 with safety_tolerance=5", async () => {
    await provider.generateImage(
      "open-content scene",
      ["https://a.png", "https://b.png", "https://c.png", "https://d.png"],
      "flux-2-pro",
    )
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "black-forest-labs/flux-2-pro",
      input: expect.objectContaining({
        prompt: "open-content scene",
        image_prompt_1: "https://a.png",
        image_prompt_2: "https://b.png",
        image_prompt_3: "https://c.png",
        image_prompt_4: "https://d.png",
        aspect_ratio: "1:1",
        output_format: "png",
        safety_tolerance: 5,
      }),
    }))
  })

  it("flux-2-pro pure t2i (no refs) still sends safety_tolerance=5", async () => {
    await provider.generateImage("solo prompt", undefined, "flux-2-pro")
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    expect(callArgs.model).toBe("black-forest-labs/flux-2-pro")
    expect(callArgs.input).toEqual(expect.objectContaining({
      prompt: "solo prompt",
      aspect_ratio: "1:1",
      output_format: "png",
      safety_tolerance: 5,
    }))
    expect(callArgs.input.image_prompt_1).toBeUndefined()
    expect(callArgs.input.image_prompt_2).toBeUndefined()
  })

  it("flux-2-max maps refs to image_prompt_1..8 with safety_tolerance=5", async () => {
    const refs = Array.from({ length: 8 }, (_, i) => `https://ref-${i + 1}.png`)
    await provider.generateImage("eight-ref scene", refs, "flux-2-max")
    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "black-forest-labs/flux-2-max",
      input: expect.objectContaining({
        prompt: "eight-ref scene",
        image_prompt_1: "https://ref-1.png",
        image_prompt_2: "https://ref-2.png",
        image_prompt_3: "https://ref-3.png",
        image_prompt_4: "https://ref-4.png",
        image_prompt_5: "https://ref-5.png",
        image_prompt_6: "https://ref-6.png",
        image_prompt_7: "https://ref-7.png",
        image_prompt_8: "https://ref-8.png",
        aspect_ratio: "1:1",
        output_format: "png",
        safety_tolerance: 5,
      }),
    }))
  })

  it("flux-2-max caps refs at 8 when more are passed", async () => {
    const refs = Array.from({ length: 12 }, (_, i) => `https://r${i + 1}.png`)
    await provider.generateImage("overflow", refs, "flux-2-max")
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    expect(callArgs.input.image_prompt_8).toBe("https://r8.png")
    // Inputs 9..12 must NOT leak into the payload
    expect(callArgs.input.image_prompt_9).toBeUndefined()
    expect(callArgs.input.image_prompt_10).toBeUndefined()
  })

  it("flux-2-max pure t2i (no refs) sends safety_tolerance=5 and no image_prompt_*", async () => {
    await provider.generateImage("pure t2i", undefined, "flux-2-max")
    const callArgs = mocks.mockCreate.mock.calls[0][0]
    expect(callArgs.model).toBe("black-forest-labs/flux-2-max")
    expect(callArgs.input).toEqual(expect.objectContaining({
      prompt: "pure t2i",
      aspect_ratio: "1:1",
      output_format: "png",
      safety_tolerance: 5,
    }))
    expect(callArgs.input.image_prompt_1).toBeUndefined()
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
