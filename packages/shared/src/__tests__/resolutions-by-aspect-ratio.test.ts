import { describe, it, expect } from "vitest"
import {
  MODEL_CATALOG,
  defaultResolutionFor,
  resolutionAtAspectRatio,
  resolutionsAtAspectRatio,
} from "../model-catalog.js"
import { buildCreditModelIdentifier, resolveNormalizedImageGen } from "../credit-identifiers.js"
import { normalizeNodeModelParams } from "../normalize-node-params.js"

/**
 * `resolutionsByAspectRatio`: the ratios at which a model renders fewer sizes
 * than it lists. GPT Image 2.5 renders 27:16, 16:27, 9:8 and 8:9 at 1K only, so
 * a 2K or 4K request there is sent, and priced, as 1K.
 */

const GPT_IMAGE_2_5 = [
  "gpt-image-2-5-flare",
  "gpt-image-2-5-flare-i2i",
  "gpt-image-2-5-sunburst",
  "gpt-image-2-5-sunburst-i2i",
] as const
const ONE_K_ONLY = ["27:16", "16:27", "9:8", "8:9"] as const

describe("the catalog's resolutionsByAspectRatio", () => {
  it("is declared on the four GPT Image 2.5 ids, 1K at each of the four ratios", () => {
    for (const id of GPT_IMAGE_2_5) {
      expect(MODEL_CATALOG[id].resolutionsByAspectRatio, id).toEqual({
        "27:16": ["1K"], "16:27": ["1K"], "9:8": ["1K"], "8:9": ["1K"],
      })
    }
  })

  it("INVARIANT: every declaration names the model's own ratios and sizes, and its default size renders everywhere", () => {
    const failures: string[] = []
    for (const [id, m] of Object.entries(MODEL_CATALOG)) {
      if (!m.resolutionsByAspectRatio) continue
      // The size an unset request is priced at must render at every listed
      // ratio, or a request naming no size would be priced above what it renders.
      const unsetSize = defaultResolutionFor(id) ?? m.resolutions?.[0]
      for (const [ratio, sizes] of Object.entries(m.resolutionsByAspectRatio)) {
        if (!m.aspectRatios?.includes(ratio)) failures.push(`${id}: ${ratio} is not one of its ratios`)
        if (sizes.length === 0) failures.push(`${id}: ${ratio} renders no size`)
        for (const size of sizes) {
          if (!m.resolutions?.includes(size)) failures.push(`${id}: ${ratio} names ${size}, not one of its sizes`)
        }
        if (unsetSize !== undefined && !sizes.includes(unsetSize)) {
          failures.push(`${id}: its default size ${unsetSize} does not render at ${ratio}`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})

describe("resolutionsAtAspectRatio", () => {
  it("narrows the sizes at a limited ratio, in the catalog's order", () => {
    for (const id of GPT_IMAGE_2_5) {
      for (const ratio of ONE_K_ONLY) expect(resolutionsAtAspectRatio(id, ratio)).toEqual(["1K"])
      expect(resolutionsAtAspectRatio(id, "16:9")).toEqual(["1K", "2K", "4K"])
      expect(resolutionsAtAspectRatio(id, "auto")).toEqual(["1K", "2K", "4K"])
      expect(resolutionsAtAspectRatio(id, undefined)).toEqual(["1K", "2K", "4K"])
    }
  })

  it("reads a padded ratio, and never the object's prototype", () => {
    expect(resolutionsAtAspectRatio("gpt-image-2-5-flare", " 9:8 ")).toEqual(["1K"])
    expect(resolutionsAtAspectRatio("gpt-image-2-5-flare", "constructor")).toEqual(["1K", "2K", "4K"])
    expect(resolutionsAtAspectRatio("gpt-image-2-5-flare", "__proto__")).toEqual(["1K", "2K", "4K"])
  })

  it("is the model's own list where nothing is limited, and undefined with no size setting", () => {
    expect(resolutionsAtAspectRatio("gpt-image-2-6-flare", "16:9")).toEqual(MODEL_CATALOG["gpt-image-2-6-flare"].resolutions)
    expect(resolutionsAtAspectRatio("nano-banana", "16:9")).toBeUndefined()
    expect(resolutionsAtAspectRatio("not-a-model", "27:16")).toBeUndefined()
  })
})

describe("resolutionAtAspectRatio", () => {
  it("moves a size the ratio does not render to the largest it does at or below it", () => {
    for (const ratio of ONE_K_ONLY) {
      expect(resolutionAtAspectRatio("gpt-image-2-5-sunburst", ratio, "4K")).toBe("1K")
      expect(resolutionAtAspectRatio("gpt-image-2-5-sunburst", ratio, "2K")).toBe("1K")
      expect(resolutionAtAspectRatio("gpt-image-2-5-sunburst", ratio, "1K")).toBe("1K")
    }
  })

  it("leaves everything else as it is", () => {
    expect(resolutionAtAspectRatio("gpt-image-2-5-flare", "16:9", "4K")).toBe("4K")
    expect(resolutionAtAspectRatio("gpt-image-2-5-flare", "27:16", undefined)).toBeUndefined()
    // A size the model does not list is the lever snap's to correct, not this one's.
    expect(resolutionAtAspectRatio("gpt-image-2-5-flare", "27:16", "8K")).toBe("8K")
    expect(resolutionAtAspectRatio("gpt-image-2-6-flare", "21:9", "4K")).toBe("4K")
    expect(resolutionAtAspectRatio("not-a-model", "27:16", "4K")).toBe("4K")
  })
})

describe("the price follows the size that renders (quote = charge)", () => {
  it.each(GPT_IMAGE_2_5.flatMap((id) => ONE_K_ONLY.map((ratio) => [id, ratio] as const)))(
    "%s at %s: a 2K or 4K request is priced as 1K",
    (id, ratio) => {
      for (const resolution of ["2K", "4K"]) {
        // Image-to-image / edit pricing (no swap) and Generate Image pricing.
        const direct = resolveNormalizedImageGen({ provider: id, aspectRatio: ratio, resolution, refCount: 1, swapToI2i: false })
        expect(direct.resolution).toBe("1K")
        expect(direct.identifier).toBe(buildCreditModelIdentifier(id, undefined, "1K"))
        expect(direct.identifier).toBe(id)
        expect(direct.adjustments.some((a) => a.field === "resolution" && a.to === "1K")).toBe(true)
      }
    },
  )

  it("a text-to-image id swapped onto its edit sibling by references is priced as that sibling's 1K", () => {
    const out = resolveNormalizedImageGen({ provider: "gpt-image-2-5-flare", aspectRatio: "16:27", resolution: "4K", refCount: 2, swapToI2i: true })
    expect(out.modelId).toBe("gpt-image-2-5-flare-i2i")
    expect(out.resolution).toBe("1K")
    expect(out.identifier).toBe("gpt-image-2-5-flare-i2i")
  })

  it("other ratios keep their 2K and 4K prices", () => {
    expect(resolveNormalizedImageGen({ provider: "gpt-image-2-5-flare", aspectRatio: "21:9", resolution: "2K", refCount: 0 }).identifier)
      .toBe("gpt-image-2-5-flare:2K")
    expect(resolveNormalizedImageGen({ provider: "gpt-image-2-5-sunburst-i2i", aspectRatio: "auto", resolution: "4K", refCount: 1 }).identifier)
      .toBe("gpt-image-2-5-sunburst-i2i:4K")
  })

  it("a workflow written by an agent stores the size that renders (normalizeNodeModelParams)", () => {
    const { nodes, adjustments } = normalizeNodeModelParams([
      { id: "n1", type: "generate-image", data: { provider: "gpt-image-2-5-sunburst", aspectRatio: "9:8", resolution: "4K" } },
    ])
    expect((nodes[0]!.data as Record<string, unknown>).resolution).toBe("1K")
    expect(adjustments).toMatchObject([{ nodeId: "n1", field: "resolution", from: "4K", to: "1K" }])
  })
})
