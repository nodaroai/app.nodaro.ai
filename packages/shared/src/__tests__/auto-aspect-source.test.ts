import { describe, it, expect } from "vitest"
import {
  MODEL_CATALOG,
  autoAspectNeedsSourceImage,
  fitAspectRatioToModel,
  nearestCatalogAspectRatio,
  normalizeModelInput,
  validateModelInput,
} from "../model-catalog.js"
import { imageGenAutoAspectNeedsSourceImage, normalizedImageGenModelId, resolveNormalizedImageGen } from "../credit-identifiers.js"
import { IMAGE_ASPECT_RATIO_VALUES, T2I_TO_I2I_VARIANT } from "../model-constants.js"
import { normalizeNodeModelParams, AUTO_ASPECT_AT_RUN_NODE_TYPES, SOURCE_IMAGE_NODE_TYPES } from "../normalize-node-params.js"

/**
 * "auto" means "keep the source photo's shape". A model that lists "auto"
 * receives it as is. A model that does not would otherwise have "auto" snapped
 * to its FIRST listed ratio, which reframes every source of another shape — so
 * when the request carries a source image, "auto" becomes the model's supported
 * ratio nearest the source's aspect instead.
 */

/** The fixed eight-ratio list a model with no "match the input" option takes. */
const SEEDREAM_LIST = MODEL_CATALOG["seedream-5-pro-i2i"]!.aspectRatios!
/** A list without 21:9, for the wide-cinema case. */
const NO_WIDE_LIST = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const

/** Runs `fn` with a made-up text-to-image model and its image-to-image sibling
 *  registered (their ratio lists as given), then removes both — for the pairs
 *  today's catalog does not have. */
function withModelPair(textToImageRatios: string[] | undefined, siblingRatios: string[] | undefined, fn: (provider: string) => void) {
  const provider = "pair-probe"
  const sibling = "pair-probe-i2i"
  const base = MODEL_CATALOG["seedream-5-pro"]!
  MODEL_CATALOG[provider] = { ...base, label: "Pair probe", aspectRatios: textToImageRatios }
  MODEL_CATALOG[sibling] = { ...base, label: "Pair probe edit", aspectRatios: siblingRatios }
  T2I_TO_I2I_VARIANT[provider] = sibling
  try {
    fn(provider)
  } finally {
    delete MODEL_CATALOG[provider]
    delete MODEL_CATALOG[sibling]
    delete T2I_TO_I2I_VARIANT[provider]
  }
}

describe("nearestCatalogAspectRatio", () => {
  it("returns the listed ratio a source already has", () => {
    expect(nearestCatalogAspectRatio(1600, 1200, SEEDREAM_LIST)).toBe("4:3")
    expect(nearestCatalogAspectRatio(1080, 1920, SEEDREAM_LIST)).toBe("9:16")
    expect(nearestCatalogAspectRatio(1024, 1024, SEEDREAM_LIST)).toBe("1:1")
    expect(nearestCatalogAspectRatio(1500, 1000, SEEDREAM_LIST)).toBe("3:2")
  })

  it("reads a phone portrait as 3:4", () => {
    expect(nearestCatalogAspectRatio(1104, 1472, SEEDREAM_LIST)).toBe("3:4")
  })

  it("maps a 2.39:1 frame to the nearest listed ratio — 21:9 when listed, else 16:9", () => {
    expect(nearestCatalogAspectRatio(2390, 1000, SEEDREAM_LIST)).toBe("21:9")
    expect(nearestCatalogAspectRatio(2390, 1000, NO_WIDE_LIST)).toBe("16:9")
  })

  it("compares in log space, so a portrait and its landscape mirror are symmetric", () => {
    expect(nearestCatalogAspectRatio(1000, 2390, NO_WIDE_LIST)).toBe("9:16")
  })

  it("ignores entries that are not ratios", () => {
    expect(nearestCatalogAspectRatio(1600, 1200, ["auto", "match_input_image", "adaptive", "4:3"])).toBe("4:3")
  })

  it("breaks a tie by the order the catalog lists the ratios", () => {
    // A square source is exactly as far from 4:3 as from 3:4.
    expect(nearestCatalogAspectRatio(1000, 1000, ["4:3", "3:4"])).toBe("4:3")
    expect(nearestCatalogAspectRatio(1000, 1000, ["3:4", "4:3"])).toBe("3:4")
  })

  /**
   * The tie rule belongs to the source-size path alone. The ratio-TOKEN fit
   * keeps the strict comparison every video lane shares (the provider
   * adapters' snap and the MCP normalizer): 4:3 sits exactly between 16:9 and
   * 1:1 in log space, and those lanes answer 1:1.
   */
  it("leaves the ratio-token fit as it was", () => {
    for (const id of ["kling", "kling-3-omni", "wan-turbo", "bytedance-lite", "bytedance-pro"]) {
      expect(fitAspectRatioToModel(id, "4:3"), id).toBe("1:1")
    }
  })

  it("answers undefined for unusable dimensions or a list with no ratios", () => {
    expect(nearestCatalogAspectRatio(0, 1000, SEEDREAM_LIST)).toBeUndefined()
    expect(nearestCatalogAspectRatio(1000, -5, SEEDREAM_LIST)).toBeUndefined()
    expect(nearestCatalogAspectRatio(Number.NaN, 1000, SEEDREAM_LIST)).toBeUndefined()
    expect(nearestCatalogAspectRatio(Number.POSITIVE_INFINITY, 1000, SEEDREAM_LIST)).toBeUndefined()
    expect(nearestCatalogAspectRatio(1000, 1000, ["auto"])).toBeUndefined()
    expect(nearestCatalogAspectRatio(1000, 1000, [])).toBeUndefined()
  })
})

describe("autoAspectNeedsSourceImage", () => {
  it("is true only for 'auto' on a model whose ratio list lacks it", () => {
    expect(autoAspectNeedsSourceImage("seedream-5-pro-i2i", "auto")).toBe(true)
    expect(autoAspectNeedsSourceImage("seedream-5-pro-i2i", " Auto ")).toBe(true)
    // A native auto goes to the provider untouched.
    expect(autoAspectNeedsSourceImage("gpt-image-2-i2i", "auto")).toBe(false)
    // A concrete ratio is not asking for the source's shape.
    expect(autoAspectNeedsSourceImage("seedream-5-pro-i2i", "16:9")).toBe(false)
    expect(autoAspectNeedsSourceImage("seedream-5-pro-i2i", undefined)).toBe(false)
    // No ratio lever at all, or a model the catalog does not know.
    expect(autoAspectNeedsSourceImage("grok-i2i", "auto")).toBe(false)
    expect(autoAspectNeedsSourceImage("not-a-model", "auto")).toBe(false)
  })
})

describe("normalizeModelInput — 'auto' with a source image", () => {
  const portrait = { width: 1104, height: 1472 }

  it("picks the supported ratio nearest the source and says so", () => {
    const out = normalizeModelInput("seedream-5-pro-i2i", { aspectRatio: "auto" }, { sourceImage: portrait })
    expect(out.aspectRatio).toBe("3:4")
    expect(out.adjustments).toHaveLength(1)
    expect(out.adjustments[0]).toMatchObject({ field: "aspectRatio", from: "auto", to: "3:4" })
    expect(out.adjustments[0].reason).toContain("source image")
  })

  it("keeps today's answer when no source size is known", () => {
    const today = normalizeModelInput("seedream-5-pro-i2i", { aspectRatio: "auto" })
    expect(today.aspectRatio).toBe(SEEDREAM_LIST[0])
    expect(normalizeModelInput("seedream-5-pro-i2i", { aspectRatio: "auto" }, {})).toEqual(today)
    expect(normalizeModelInput("seedream-5-pro-i2i", { aspectRatio: "auto" }, { sourceImage: undefined })).toEqual(today)
  })

  it("keeps today's answer when the source size is unusable", () => {
    const today = normalizeModelInput("seedream-5-pro-i2i", { aspectRatio: "auto" })
    const out = normalizeModelInput("seedream-5-pro-i2i", { aspectRatio: "auto" }, { sourceImage: { width: 0, height: 900 } })
    expect(out).toEqual(today)
  })

  it("leaves a native 'auto' alone even when the source size is known", () => {
    const out = normalizeModelInput("gpt-image-2-i2i", { aspectRatio: "auto" }, { sourceImage: portrait })
    expect(out.aspectRatio).toBe("auto")
    expect(out.adjustments).toEqual([])
  })

  it("never second-guesses a concrete ratio", () => {
    expect(normalizeModelInput("seedream-5-pro-i2i", { aspectRatio: "16:9" }, { sourceImage: portrait }).aspectRatio).toBe("16:9")
    // An off-list ratio still snaps exactly as it does without a source image.
    const off = normalizeModelInput("seedream-5-pro-i2i", { aspectRatio: "4:5" }, { sourceImage: portrait })
    expect(off).toEqual(normalizeModelInput("seedream-5-pro-i2i", { aspectRatio: "4:5" }))
  })

  it("still drops the value for a model with no ratio lever", () => {
    const out = normalizeModelInput("grok-i2i", { aspectRatio: "auto" }, { sourceImage: portrait })
    expect(out.aspectRatio).toBeUndefined()
    expect(out.adjustments[0]?.to).toBeUndefined()
  })

  it("reads 'auto' in any case", () => {
    const out = normalizeModelInput("seedream-5-pro-i2i", { aspectRatio: "AUTO" }, { sourceImage: { width: 1920, height: 1080 } })
    expect(out.aspectRatio).toBe("16:9")
  })

  it("INVARIANT: every image model without a native auto resolves to one of its own ratios", () => {
    const sources = [
      { width: 1104, height: 1472 },
      { width: 1920, height: 1080 },
      { width: 2390, height: 1000 },
      { width: 1000, height: 1000 },
      { width: 400, height: 3200 },
    ]
    const failures: string[] = []
    for (const [id, m] of Object.entries(MODEL_CATALOG)) {
      if (m.kind !== "image" || !autoAspectNeedsSourceImage(id, "auto")) continue
      for (const sourceImage of sources) {
        const out = normalizeModelInput(id, { aspectRatio: "auto" }, { sourceImage })
        const issue = validateModelInput(id, { aspectRatio: out.aspectRatio })
        if (issue || out.aspectRatio === "auto") failures.push(`${id} ${sourceImage.width}x${sourceImage.height} → ${out.aspectRatio}`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe("resolveNormalizedImageGen — source image", () => {
  it("threads the source size into the snap", () => {
    const out = resolveNormalizedImageGen({
      provider: "seedream-5-pro-i2i",
      aspectRatio: "auto",
      quality: "high",
      refCount: 1,
      sourceImage: { width: 1920, height: 1080 },
    })
    expect(out.aspectRatio).toBe("16:9")
    expect(out.quality).toBe("high")
  })

  /**
   * The credit CHECK (route preHandler) runs before the source image is read,
   * so it prices "auto" with no size; the DEBIT prices the resolved ratio. They
   * agree only because, on every model this rule touches, the ratio is not a
   * pricing dimension. This pins that across the whole catalog: a model added
   * later that prices by ratio fails here instead of under-billing in silence.
   */
  it("INVARIANT: on a model without a native auto, the ratio never changes the credit id", () => {
    const failures: string[] = []
    for (const [id, m] of Object.entries(MODEL_CATALOG)) {
      if (m.kind !== "image" || !autoAspectNeedsSourceImage(id, "auto")) continue
      const qualities: Array<string | undefined> = [undefined, ...(m.qualities ?? [])]
      const resolutions: Array<string | undefined> = [undefined, ...(m.resolutions ?? [])]
      for (const quality of qualities) {
        for (const resolution of resolutions) {
          for (const refCount of [0, 1, 3]) {
            // Generate Image prices with the T2I→I2I swap (references attached);
            // the image-to-image / edit routes price without it.
            for (const swapToI2i of [false, true]) {
              const base = { provider: id, quality, resolution, refCount, swapToI2i }
              const at = `${id} q=${quality} r=${resolution} refs=${refCount} swap=${swapToI2i}`
              const priced = resolveNormalizedImageGen({ ...base, aspectRatio: "auto" }).identifier
              const sizes = [{ width: 1104, height: 1472 }, { width: 2390, height: 1000 }]
              for (const sourceImage of sizes) {
                const withSource = resolveNormalizedImageGen({ ...base, aspectRatio: "auto", sourceImage }).identifier
                if (withSource !== priced) failures.push(`${at}: ${priced} vs ${withSource}`)
              }
              for (const ratio of m.aspectRatios ?? []) {
                const listed = resolveNormalizedImageGen({ ...base, aspectRatio: ratio }).identifier
                if (listed !== priced) failures.push(`${at} ${ratio}: ${priced} vs ${listed}`)
              }
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it("names the model the snap runs against — the i2i variant once references attach", () => {
    expect(normalizedImageGenModelId({ provider: "seedream-5-pro", refCount: 1, swapToI2i: true })).toBe("seedream-5-pro-i2i")
    expect(normalizedImageGenModelId({ provider: "seedream-5-pro", refCount: 0, swapToI2i: true })).toBe("seedream-5-pro")
    expect(normalizedImageGenModelId({ provider: "seedream-5-pro", refCount: 2, swapToI2i: false })).toBe("seedream-5-pro")
    expect(normalizedImageGenModelId({ provider: "nano-banana-2", refCount: 1, swapToI2i: true })).toBe("nano-banana-2")
    expect(normalizedImageGenModelId({ provider: undefined, refCount: 0 })).toBe("nano-banana")
    // The same id the snap itself reports, for every swap pair.
    for (const t2i of Object.keys(T2I_TO_I2I_VARIANT)) {
      const opts = { provider: t2i, refCount: 1, swapToI2i: true }
      expect(normalizedImageGenModelId(opts), t2i).toBe(resolveNormalizedImageGen(opts).modelId)
    }
  })

  it("asks whether 'auto' needs the photo about the model the snap runs against", () => {
    const needs = (provider: string, refCount?: number, aspectRatio: string = "auto") =>
      imageGenAutoAspectNeedsSourceImage({ provider, aspectRatio, refCount })
    // With the assembled reference count: exactly that model. grok's sibling
    // takes no ratio, so once a reference attaches there is nothing to resolve.
    expect(needs("grok", 0)).toBe(true)
    expect(needs("grok", 1)).toBe(false)
    expect(needs("seedream-5-pro", 1)).toBe(true)
    expect(needs("gpt-image-2", 1)).toBe(false)
    expect(needs("nano-banana-2", 2)).toBe(autoAspectNeedsSourceImage("nano-banana-2", "auto"))
    expect(needs("seedream-5-pro", 1, "16:9")).toBe(false)
    // Before assembly (no count): either model, since references may yet attach.
    expect(needs("grok")).toBe(true)
    withModelPair(["auto", "1:1"], ["1:1", "16:9"], (p) => {
      expect(needs(p, 0)).toBe(false)
      expect(needs(p, 1)).toBe(true)
      expect(needs(p)).toBe(true)
    })
    withModelPair(["auto", "1:1"], ["auto", "1:1"], (p) => expect(needs(p)).toBe(false))
    withModelPair(undefined, undefined, (p) => expect(needs(p)).toBe(false))
  })

  /**
   * The routes write the resolved ratio back through their own Zod enum
   * (`applySnappedLevers`), which leaves a value the enum does not carry
   * untouched — so a ratio a model lists but the shared vocabulary lacks would
   * send the caller's "auto" on to a model that cannot take it.
   */
  it("INVARIANT: every ratio an image model lists is in the routes' ratio vocabulary", () => {
    const vocabulary = new Set<string>(IMAGE_ASPECT_RATIO_VALUES)
    const missing: string[] = []
    for (const [id, m] of Object.entries(MODEL_CATALOG)) {
      if (m.kind !== "image") continue
      for (const ratio of m.aspectRatios ?? []) if (!vocabulary.has(ratio)) missing.push(`${id}:${ratio}`)
    }
    expect(missing).toEqual([])
  })
})

describe("normalizeNodeModelParams — 'auto' on a node that transforms a source image", () => {
  const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, data })

  it("names the node types that carry a source image", () => {
    expect([...SOURCE_IMAGE_NODE_TYPES].sort()).toEqual(["edit-image", "image-to-image", "modify-image"])
  })

  it("names the node types whose 'auto' the run resolves — the source-image ones plus Generate Image", () => {
    expect([...AUTO_ASPECT_AT_RUN_NODE_TYPES].sort()).toEqual(["edit-image", "generate-image", "image-to-image", "modify-image"])
    for (const type of SOURCE_IMAGE_NODE_TYPES) expect(AUTO_ASPECT_AT_RUN_NODE_TYPES.has(type), type).toBe(true)
  })

  it("keeps 'auto' for the run to resolve against the photo", () => {
    for (const type of AUTO_ASPECT_AT_RUN_NODE_TYPES) {
      const provider = type === "edit-image" ? "nano-banana-edit" : type === "generate-image" ? "seedream-5-pro" : "seedream-5-pro-i2i"
      const input = [node("n", type, { provider, aspectRatio: "auto" })]
      const { nodes, adjustments } = normalizeNodeModelParams(input)
      expect(adjustments, type).toEqual([])
      expect(nodes[0], type).toBe(input[0])
    }
  })

  it("writes the canonical spelling so the route's enum accepts it", () => {
    const { nodes, adjustments } = normalizeNodeModelParams([
      node("n", "modify-image", { provider: "seedream-5-pro-i2i", aspectRatio: " Auto " }),
    ])
    expect((nodes[0].data as Record<string, unknown>).aspectRatio).toBe("auto")
    expect(adjustments).toEqual([])
  })

  it("still corrects the other levers on the same node", () => {
    const { nodes, adjustments } = normalizeNodeModelParams([
      node("n", "image-to-image", { provider: "seedream-5-pro-i2i", aspectRatio: "auto", quality: "medium" }),
    ])
    const d = nodes[0].data as Record<string, unknown>
    expect(d.aspectRatio).toBe("auto")
    expect(d.quality).toBe("basic")
    expect(adjustments.map((a) => a.field)).toEqual(["quality"])
  })

  it("keeps 'auto' on a Generate Image node too, so a wired photo can decide it at run time", () => {
    const input = [node("g", "generate-image", { provider: "seedream-5-pro", aspectRatio: "auto" })]
    const { nodes, adjustments } = normalizeNodeModelParams(input)
    expect(adjustments).toEqual([])
    expect(nodes[0]).toBe(input[0])
    // With no photo the run snaps it to exactly what this boundary used to store.
    expect(normalizeModelInput("seedream-5-pro", { aspectRatio: "auto" }).aspectRatio).toBe(SEEDREAM_LIST[0])
  })

  it("keeps 'auto' on a Generate Image node whose image-to-image sibling resolves it from the photo", () => {
    // The node's own model has no ratio lever; references would swap the run to
    // a sibling that lists ratios but no auto, so the run can still use the photo.
    withModelPair(undefined, ["1:1", "16:9"], (provider) => {
      const input = [node("g", "generate-image", { provider, aspectRatio: "auto" })]
      const { nodes, adjustments } = normalizeNodeModelParams(input)
      expect(adjustments).toEqual([])
      expect(nodes[0]).toBe(input[0])
      // Only Generate Image swaps on references: another node type asks about its own model.
      const other = normalizeNodeModelParams([node("m", "modify-image", { provider, aspectRatio: "auto" })])
      expect((other.nodes[0].data as Record<string, unknown>).aspectRatio).toBeUndefined()
    })
  })

  it("still drops 'auto' on a model with no ratio lever", () => {
    const { nodes } = normalizeNodeModelParams([
      node("e", "edit-image", { provider: "recraft-upscale", aspectRatio: "auto" }),
    ])
    expect((nodes[0].data as Record<string, unknown>).aspectRatio).toBeUndefined()
  })

  it("leaves a native 'auto' alone, as before", () => {
    const input = [node("m", "modify-image", { provider: "gpt-image-2-i2i", aspectRatio: "auto" })]
    const { nodes, adjustments } = normalizeNodeModelParams(input)
    expect(adjustments).toEqual([])
    expect(nodes[0]).toBe(input[0])
  })

  it("is idempotent", () => {
    const once = normalizeNodeModelParams([
      node("n", "modify-image", { provider: "seedream-5-pro-i2i", aspectRatio: "Auto", quality: "medium" }),
    ])
    const twice = normalizeNodeModelParams(once.nodes)
    expect(twice.adjustments).toEqual([])
    expect(twice.nodes[0]).toBe(once.nodes[0])
  })
})
