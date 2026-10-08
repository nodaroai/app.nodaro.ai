import { describe, it, expect } from "vitest"
import {
  MODEL_CATALOG,
  autoAspectNeedsSourceImage,
  fitAspectRatioToModel,
  nearestCatalogAspectRatio,
  normalizeModelInput,
  validateModelInput,
} from "../model-catalog.js"
import { resolveNormalizedImageGen } from "../credit-identifiers.js"
import { IMAGE_ASPECT_RATIO_VALUES } from "../model-constants.js"
import { normalizeNodeModelParams, SOURCE_IMAGE_NODE_TYPES } from "../normalize-node-params.js"

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
            const base = { provider: id, quality, resolution, refCount }
            const priced = resolveNormalizedImageGen({ ...base, aspectRatio: "auto" }).identifier
            const sizes = [{ width: 1104, height: 1472 }, { width: 2390, height: 1000 }]
            for (const sourceImage of sizes) {
              const withSource = resolveNormalizedImageGen({ ...base, aspectRatio: "auto", sourceImage }).identifier
              if (withSource !== priced) failures.push(`${id} q=${quality} r=${resolution} refs=${refCount}: ${priced} vs ${withSource}`)
            }
            for (const ratio of m.aspectRatios ?? []) {
              const listed = resolveNormalizedImageGen({ ...base, aspectRatio: ratio }).identifier
              if (listed !== priced) failures.push(`${id} ${ratio} q=${quality} r=${resolution} refs=${refCount}: ${priced} vs ${listed}`)
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
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

  it("keeps 'auto' for the run to resolve against the source image", () => {
    for (const type of SOURCE_IMAGE_NODE_TYPES) {
      const provider = type === "edit-image" ? "nano-banana-edit" : "seedream-5-pro-i2i"
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

  it("keeps coercing 'auto' on a text-to-image node, which has no source photo", () => {
    const { nodes, adjustments } = normalizeNodeModelParams([
      node("g", "generate-image", { provider: "seedream-5-pro", aspectRatio: "auto" }),
    ])
    expect((nodes[0].data as Record<string, unknown>).aspectRatio).toBe(SEEDREAM_LIST[0])
    expect(adjustments.map((a) => a.field)).toEqual(["aspectRatio"])
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
