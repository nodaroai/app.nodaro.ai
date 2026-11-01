import { describe, it, expect, vi } from "vitest"
import type { FastifyBaseLogger } from "fastify"
import { FLUX_LORA_CHARACTER_MODEL_ID } from "@nodaro/shared/models"
import { planImageJob } from "../generate-image-plan.js"
import { jobModelIdOf } from "../../lib/safety-block.js"
import { generateImageModelOf } from "../../workers/handlers/default-models.js"
import type { GenerateImageData } from "../generate-image-body.js"

// A job's `input_data` names the model the worker actually runs
// (`resolvedModel`): with references or for an edit of a base, a
// text-to-image model's image-to-image sibling; on the LoRA path, the
// trained-character model. The reconcile path reads `jobModelIdOf(input_data)`
// for a refused job's safety class and fallback, the worker
// `jobModelIdOf(job.data)`: the same model, except on an edit of a base, where
// the worker's payload still names the text-to-image model it swaps itself —
// a pair that shares one safety policy (@nodaro/shared safety-retry-policy
// test). `input_data.provider` stays the caller's choice (the gallery label,
// a batch replay's group model and the run stats read it).

const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as FastifyBaseLogger

const plan = (data: Partial<GenerateImageData>, lora: { version: string; trigger: string } | null = null) => {
  const full = { prompt: "a cat on a chair", aspectRatio: "1:1", ...data } as GenerateImageData
  return planImageJob({
    data: full,
    assembled: { queueReferenceImageUrls: full.referenceImageUrls, basePrompt: full.prompt, negativePrompt: undefined, styleReferencesSent: undefined },
    resolvedLora: lora,
    identityText: null,
    userDirection: undefined,
    log,
  })
}

describe("planImageJob records the model the worker runs", () => {
  it("a text-to-image model with references: the image-to-image sibling, as the queue sends", async () => {
    const p = await plan({ provider: "gpt-image-2", referenceImageUrls: ["https://cdn.example.com/ref.png"] })
    expect(p.queueData.provider).toBe("gpt-image-2-i2i")
    expect(jobModelIdOf(p.inputData)).toBe(jobModelIdOf(p.queueData))
    expect(p.inputData.resolvedModel).toBe("gpt-image-2-i2i")
    // The caller's choice is kept where the gallery, replay and stats read it.
    expect(p.inputData.provider).toBe("gpt-image-2")
  })

  it("no references: the model asked for", async () => {
    const p = await plan({ provider: "gpt-image-2" })
    expect(p.queueData.provider).toBe("gpt-image-2")
    expect(jobModelIdOf(p.inputData)).toBe(jobModelIdOf(p.queueData))
    expect(p.inputData.resolvedModel).toBe("gpt-image-2")
    expect(p.inputData.provider).toBe("gpt-image-2")
  })

  // "Refine this result": a base image and no references. The route sends the
  // text-to-image model and the worker swaps to its image-to-image sibling for
  // an edit of a base (`generateImageModelOf`), so the row records the sibling
  // — what a workflow Run of the same node records. What runs and bills stays.
  it("a refine of a base, no references: the image-to-image sibling the worker swaps to", async () => {
    const refine = await plan({ provider: "gpt-image-2", baseImageUrl: "https://cdn.example.com/base.png" })
    const plain = await plan({ provider: "gpt-image-2" })
    expect(refine.inputData.resolvedModel).toBe("gpt-image-2-i2i")
    expect(refine.inputData.resolvedModel).toBe(generateImageModelOf(refine.queueData).effectiveModel)
    // Unchanged: the payload the worker gets, the price, and the caller's choice.
    expect(refine.queueData.provider).toBe("gpt-image-2")
    expect(refine.creditIdentifier).toBe(plain.creditIdentifier)
    expect(refine.inputData.provider).toBe("gpt-image-2")
  })

  it("an inpaint (base + mask): the image-to-image sibling the worker runs", async () => {
    const p = await plan({ provider: "gpt-image-2", baseImageUrl: "https://cdn.example.com/base.png", maskUrl: "https://cdn.example.com/mask.png" })
    expect(p.inputData.resolvedModel).toBe("gpt-image-2-i2i")
    expect(p.queueData.provider).toBe("gpt-image-2")
  })

  it("every shape records the model the worker's own choice picks from the payload it is sent", async () => {
    const shapes: Array<Parameters<typeof plan>> = [
      [{ provider: "gpt-image-2" }],
      [{ provider: "gpt-image-2", referenceImageUrls: ["https://cdn.example.com/ref.png"] }],
      [{ provider: "gpt-image-2", baseImageUrl: "https://cdn.example.com/base.png" }],
      [{ provider: "nano-banana-pro", baseImageUrl: "https://cdn.example.com/base.png" }],
      [{}],
      [{ provider: "flux" }, { version: "v1", trigger: "ohwx" }],
    ]
    for (const args of shapes) {
      const p = await plan(...args)
      expect({ args, recorded: p.inputData.resolvedModel }).toEqual({ args, recorded: generateImageModelOf(p.queueData).effectiveModel })
    }
  })

  it("the LoRA path: the trained-character model", async () => {
    const p = await plan({ provider: "flux" }, { version: "v1", trigger: "ohwx" })
    expect(jobModelIdOf(p.queueData)).toBe(FLUX_LORA_CHARACTER_MODEL_ID)
    expect(jobModelIdOf(p.inputData)).toBe(FLUX_LORA_CHARACTER_MODEL_ID)
    expect(p.inputData.provider).toBe("flux")
  })
})
