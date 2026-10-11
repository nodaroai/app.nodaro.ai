import { describe, it, expect, vi, afterEach } from "vitest"
import { FLUX_LORA_CHARACTER_MODEL_ID, IMAGE_GEN_PROVIDERS, MODEL_CATALOG, SOURCE_IMAGE_NODE_TYPES, autoAspectNeedsSourceImage, normalizeModelInput } from "@nodaro/shared"
import { buildPayload, type PayloadBuildContext } from "../payload-builder.js"
import { autoAspectSourceImageUrl } from "../source-image.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

/**
 * "auto" on a model without a native auto keeps the source photo's shape in a
 * workflow run exactly as on the image routes: node-executor reads the size of
 * the url `autoAspectSourceImageUrl` names, and every branch that sends a source
 * image normalizes with it (`PayloadBuildContext.sourceImage`).
 */

afterEach(() => {
  vi.restoreAllMocks()
})

const SOURCE = "https://cdn.example.com/source.png"
const landscape = { width: 1920, height: 1080 }

function node(type: string, data: Record<string, unknown>, id = "n1"): SimpleNode {
  return { id, type, data }
}

/** Every source-image node type, and both arms of modify-image. */
const BRANCHES: ReadonlyArray<{ type: string; provider: string; jobName: string }> = [
  { type: "image-to-image", provider: "seedream-5-pro-i2i", jobName: "image-to-image" },
  { type: "modify-image", provider: "seedream-5-pro-i2i", jobName: "image-to-image" },
  { type: "modify-image", provider: "nano-banana-edit", jobName: "edit-image" },
  { type: "edit-image", provider: "nano-banana-edit", jobName: "edit-image" },
]

describe("buildPayload — 'auto' with a source image", () => {
  it("covers every source-image node type", () => {
    expect(new Set(BRANCHES.map((b) => b.type))).toEqual(new Set(SOURCE_IMAGE_NODE_TYPES))
  })

  for (const b of BRANCHES) {
    it(`${b.type} on ${b.provider}: becomes the ratio nearest the source`, () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const result = buildPayload(
        node(b.type, { provider: b.provider, prompt: "make it dusk", aspectRatio: "auto" }),
        "job-1",
        { imageUrl: SOURCE },
        undefined,
        { sourceImage: landscape },
      )
      expect(result.jobName).toBe(b.jobName)
      expect(result.payload.aspectRatio).toBe("16:9")
      expect(result.payload.imageUrl).toBe(SOURCE)
    })

    it(`${b.type} on ${b.provider}: keeps today's fallback without a source size`, () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const result = buildPayload(
        node(b.type, { provider: b.provider, prompt: "make it dusk", aspectRatio: "auto" }),
        "job-1",
        { imageUrl: SOURCE },
      )
      expect(result.payload.aspectRatio).toBe(MODEL_CATALOG[b.provider]!.aspectRatios![0])
    })
  }

  it("never moves the price", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const data = { provider: "seedream-5-pro-i2i", prompt: "x", aspectRatio: "auto", quality: "high" }
    const withSize = buildPayload(node("image-to-image", data), "job-1", { imageUrl: SOURCE }, undefined, { sourceImage: landscape })
    const without = buildPayload(node("image-to-image", data), "job-1", { imageUrl: SOURCE })
    expect(withSize.modelIdentifier).toBe(without.modelIdentifier)
    expect(withSize.modelIdentifier).toBe("seedream-5-pro-i2i:high")
  })

  it("passes a native 'auto' through untouched", () => {
    const result = buildPayload(
      node("image-to-image", { provider: "gpt-image-2-i2i", prompt: "x", aspectRatio: "auto" }),
      "job-1",
      { imageUrl: SOURCE },
      undefined,
      { sourceImage: landscape },
    )
    expect(result.payload.aspectRatio).toBe("auto")
  })

})

/**
 * Generate Image: the photo is the first image the build sends (the first
 * assembled reference, or the inpaint / refine base); `buildPayloadWithSourceSize`
 * reads its size and hands it in. With no photo, "auto" snaps exactly as before.
 */
describe("buildPayload — Generate Image, 'auto' and a wired photo", () => {
  const gen = (data: Record<string, unknown>, id = "g1") => node("generate-image", { prompt: "a lighthouse", ...data }, id)
  const todays = (modelId: string) => normalizeModelInput(modelId, { aspectRatio: "auto" }).aspectRatio

  it("uses the ratio nearest the photo when its size is handed in", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = buildPayload(gen({ provider: "seedream-5-pro", aspectRatio: "auto" }), "job-1", { referenceImageUrls: [SOURCE] }, undefined, { sourceImage: landscape })
    expect((result.payload.referenceImageUrls as string[])[0]).toBe(SOURCE)
    expect(result.payload.aspectRatio).toBe("16:9")
  })

  it("snaps exactly as before without a size", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = buildPayload(gen({ provider: "seedream-5-pro", aspectRatio: "auto" }), "job-1", { referenceImageUrls: [SOURCE] })
    expect(result.payload.aspectRatio).toBe(MODEL_CATALOG["seedream-5-pro"]!.aspectRatios![0])
  })

  it("never moves the price", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const data = { provider: "seedream-5-pro", aspectRatio: "auto", quality: "high" }
    const withSize = buildPayload(gen(data), "job-1", { referenceImageUrls: [SOURCE] }, undefined, { sourceImage: landscape })
    const without = buildPayload(gen(data), "job-1", { referenceImageUrls: [SOURCE] })
    expect(withSize.modelIdentifier).toBe(without.modelIdentifier)
  })

  /** NO PROVIDER EVER RECEIVES "auto" IT CANNOT TAKE — every Generate Image model without one. */
  it("no photo: every model without a native auto is sent today's snapped ratio", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const failures: string[] = []
    for (const provider of IMAGE_GEN_PROVIDERS.filter((p) => autoAspectNeedsSourceImage(p, "auto"))) {
      const sent = buildPayload(gen({ provider, aspectRatio: "auto" }), "job-1", {}).payload.aspectRatio
      if (sent === "auto" || sent !== todays(provider)) failures.push(`${provider} → ${String(sent)}`)
    }
    expect(failures).toEqual([])
  })

  /**
   * A LoRA run swaps to the trained character model, which has no catalog
   * entry and takes no "auto". A native-auto node model keeps "auto" through
   * the snap, so the LoRA arm itself must not forward it.
   */
  describe("the LoRA arm", () => {
    const character = node("character", {
      characterName: "Kira",
      sourceImageUrl: "https://cdn.example.com/kira.png",
      loraReplicateVersion: "owner/char-kira:abc",
      loraTriggerWord: "TOK_kira",
      loraTrainingStatus: "succeeded",
    }, "c1")
    const edges: SimpleEdge[] = [{ id: "e1", source: "c1", target: "g1", sourceHandle: "character" }]
    const lora = (data: Record<string, unknown>) => {
      const g = gen(data)
      return buildPayload(g, "job-1", {}, undefined, { nodes: [character, g], edges, nodeStates: {} })
    }

    it("never sends 'auto' to the trained model", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const result = lora({ provider: "gpt-image-2", aspectRatio: "auto" })
      expect(result.payload.model).toBe(FLUX_LORA_CHARACTER_MODEL_ID)
      expect(result.payload.aspectRatio).toBeUndefined()
    })

    it("sends today's snapped ratio for a model without a native auto, and any concrete ratio as is", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      expect(lora({ provider: "seedream-5-pro", aspectRatio: "auto" }).payload.aspectRatio).toBe(todays("seedream-5-pro"))
      expect(lora({ provider: "seedream-5-pro", aspectRatio: "16:9" }).payload.aspectRatio).toBe("16:9")
    })
  })
})

describe("autoAspectSourceImageUrl", () => {
  it("names the wired source image when the size will be used", () => {
    expect(
      autoAspectSourceImageUrl(node("image-to-image", { provider: "seedream-5-pro-i2i", aspectRatio: "auto" }), { imageUrl: SOURCE }),
    ).toBe(SOURCE)
    expect(
      autoAspectSourceImageUrl(node("modify-image", { provider: "nano-banana-edit", aspectRatio: "auto" }), { imageUrl: SOURCE }),
    ).toBe(SOURCE)
    // A stored image counts when nothing is wired.
    expect(
      autoAspectSourceImageUrl(node("edit-image", { provider: "nano-banana-edit", aspectRatio: "auto", imageUrl: SOURCE }), {}),
    ).toBe(SOURCE)
  })

  it("names nothing when the size would not be used", () => {
    const inputs = { imageUrl: SOURCE }
    // A native auto, a concrete ratio, a type with no source photo, no image at all.
    expect(autoAspectSourceImageUrl(node("image-to-image", { provider: "gpt-image-2-i2i", aspectRatio: "auto" }), inputs)).toBeUndefined()
    expect(autoAspectSourceImageUrl(node("image-to-image", { provider: "seedream-5-pro-i2i", aspectRatio: "16:9" }), inputs)).toBeUndefined()
    expect(autoAspectSourceImageUrl(node("generate-image", { provider: "seedream-5-pro", aspectRatio: "auto" }), inputs)).toBeUndefined()
    expect(autoAspectSourceImageUrl(node("image-to-image", { provider: "seedream-5-pro-i2i", aspectRatio: "auto" }), {})).toBeUndefined()
    // Each branch's own default model when the node names none: the edit
    // default has a native auto, and edit-image's default has no ratio lever.
    expect(autoAspectSourceImageUrl(node("modify-image", { aspectRatio: "auto" }), inputs)).toBeUndefined()
    expect(autoAspectSourceImageUrl(node("edit-image", { aspectRatio: "auto" }), inputs)).toBeUndefined()
  })

  /**
   * `connectedMediaOrder` can promote a wired reference to the main slot. The
   * size must be read from THAT image — the one the provider is sent — not from
   * whatever arrived on the `image` input.
   */
  it("follows a reorder to the image the payload sends", () => {
    const a = node("upload-image", {}, "a")
    const b = node("upload-image", {}, "b")
    const states: Record<string, NodeExecutionState> = {
      a: { status: "completed", output: { imageUrl: "https://cdn.example.com/a.png" } },
      b: { status: "completed", output: { imageUrl: "https://cdn.example.com/b.png" } },
    }
    const edges: SimpleEdge[] = [
      { id: "e1", source: "a", target: "t", targetHandle: "image" },
      { id: "e2", source: "b", target: "t", targetHandle: "image" },
    ]
    for (const b0 of BRANCHES) {
      const target = node(b0.type, { provider: b0.provider, prompt: "x", aspectRatio: "auto", connectedMediaOrder: ["b", "a"] }, "t")
      const inputs = { imageUrl: "https://cdn.example.com/a.png", referenceImageUrls: ["https://cdn.example.com/b.png"] }
      const ctx: PayloadBuildContext = { nodes: [a, b, target], edges, nodeStates: states }
      const url = autoAspectSourceImageUrl(target, inputs, ctx)
      expect(url, b0.type).toBe("https://cdn.example.com/b.png")
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const result = buildPayload(target, "job-1", inputs, undefined, { ...ctx, sourceImage: landscape })
      expect(result.payload.imageUrl, b0.type).toBe(url)
    }
  })

  it("keeps each branch's reference list when the media is reordered", () => {
    const a = node("upload-image", {}, "a")
    const b = node("upload-image", {}, "b")
    const states: Record<string, NodeExecutionState> = {
      a: { status: "completed", output: { imageUrl: "https://cdn.example.com/a.png" } },
      b: { status: "completed", output: { imageUrl: "https://cdn.example.com/b.png" } },
    }
    const edges: SimpleEdge[] = [
      { id: "e1", source: "a", target: "t", targetHandle: "image" },
      { id: "e2", source: "b", target: "t", targetHandle: "image" },
    ]
    const inputs = { imageUrl: "https://cdn.example.com/a.png", referenceImageUrls: ["https://cdn.example.com/b.png"] }
    const edit = node("edit-image", { provider: "nano-banana-edit", prompt: "x", connectedMediaOrder: ["b", "a"] }, "t")
    const editResult = buildPayload(edit, "job-1", inputs, undefined, { nodes: [a, b, edit], edges, nodeStates: states })
    expect(editResult.payload.imageUrl).toBe("https://cdn.example.com/b.png")
    expect(editResult.payload.referenceImageUrls).toEqual(["https://cdn.example.com/a.png"])

    // No reorder: the edit branch sends no references of its own.
    const plain = node("edit-image", { provider: "nano-banana-edit", prompt: "x" }, "t")
    const plainResult = buildPayload(plain, "job-1", inputs, undefined, { nodes: [a, b, plain], edges, nodeStates: states })
    expect(plainResult.payload.imageUrl).toBe("https://cdn.example.com/a.png")
    expect(plainResult.payload.referenceImageUrls).toBeUndefined()
  })
})
