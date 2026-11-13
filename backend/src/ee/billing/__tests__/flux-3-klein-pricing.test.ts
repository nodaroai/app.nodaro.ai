// @test-units-by-name looks up only the flux-3-klein credit rows it names
import { describe, expect, it } from "vitest"
import { buildCreditModelIdentifier, resolveNormalizedImageGen } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "../credits.js"
import { flux3KleinBaseCredits, flux3KleinStaticCosts } from "../flux-3-klein-pricing.js"
import { statedPrices } from "../stated-prices.js"
import { imageCreditIdentifierFor } from "../../../routes/generate-image-credit-id.js"
import { resolveImageToImageCreditIdentifier } from "../../../routes/image-to-image-credit-id.js"
import {
  plainEntityCheckIdentifier,
  plainEntityCreditIdentifier,
  resolveEntityImageCreditIdentifier,
  workflowEntityCreditIdentifier,
} from "../../../lib/entity-credit-identifier.js"
import { FLUX_3_KLEIN_KIE_HUNDREDTHS, KIE_IMAGE_MODELS } from "../../../providers/kie/models.js"
import { kieImageCostUsd } from "../../../providers/kie/image-cost.js"
import { kieImageModelSent } from "../../../providers/kie/image-edit-sibling.js"

const T2I = "flux-3-klein"
const I2I = "flux-3-klein-i2i"
const SIZES = ["1K", "2K", "4K"] as const
/** Base credits by size (decided 2026-11-11), and what a run is charged at the hosted settings. */
const BASE = { "1K": 4, "2K": 7, "4K": 17 } as const
const CHARGED = { "1K": 5, "2K": 8, "4K": 19 } as const
const SRC = "https://cdn.example.com/src.png"
const REF = (n: number) => `https://cdn.example.com/ref-${n}.png`
const refs = (n: number) => Array.from({ length: n }, (_, i) => REF(i + 1))

describe("FLUX 3 Klein base credits", () => {
  it("one base price per size, from what the provider bills for it", () => {
    expect(FLUX_3_KLEIN_KIE_HUNDREDTHS).toEqual({ "1K": 160, "2K": 250, "4K": 650 })
    for (const size of SIZES) expect(flux3KleinBaseCredits(size), size).toBe(BASE[size])
  })

  it("has the two bare ids and one row per size on each id, nothing else", () => {
    expect(flux3KleinStaticCosts()).toEqual({
      "flux-3-klein": 4,
      "flux-3-klein-i2i": 4,
      "flux-3-klein:1K": 4,
      "flux-3-klein:2K": 7,
      "flux-3-klein:4K": 17,
      "flux-3-klein-i2i:1K": 4,
      "flux-3-klein-i2i:2K": 7,
      "flux-3-klein-i2i:4K": 17,
    })
  })

  it("every row is in the credit table at its base price", () => {
    for (const [id, credits] of Object.entries(flux3KleinStaticCosts())) expect(STATIC_CREDIT_COSTS[id], id).toBe(credits)
  })

  it("the catalog's rows are the rows charged", () => {
    for (const id of [T2I, I2I]) {
      for (const row of MODEL_CATALOG[id]!.pricing) expect(STATIC_CREDIT_COSTS[row.identifier], row.identifier).toBe(row.credits)
    }
  })

  it("is charged 5, 8 and 19 at 1K, 2K and 4K, the same on both ids", () => {
    for (const size of SIZES) {
      expect(statedPrices().credits(`flux-3-klein:${size}`), size).toBe(CHARGED[size])
      expect(statedPrices().credits(`flux-3-klein-i2i:${size}`), size).toBe(CHARGED[size])
    }
    expect(statedPrices().credits(T2I)).toBe(5)
    expect(statedPrices().credits(I2I)).toBe(5)
  })

  it("every id a run can be priced on has a row, at any reference count", () => {
    for (const size of [...SIZES, undefined, "1.5K", "2 MP"]) {
      for (let n = 0; n <= 20; n++) {
        for (const id of [T2I, I2I]) {
          const credit = buildCreditModelIdentifier(id, undefined, size, undefined, undefined, n)
          expect(STATIC_CREDIT_COSTS[credit], `${id} ${size} ${n}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it("no existing row moved, FLUX 2 Klein's included", () => {
    expect(STATIC_CREDIT_COSTS["flux-2-klein"]).toBe(3)
    expect(STATIC_CREDIT_COSTS["flux-flex"]).toBe(35)
    expect(STATIC_CREDIT_COSTS["seedream-5-5:2K"]).toBe(16)
    expect(STATIC_CREDIT_COSTS["minimax-h3-image:4K"]).toBe(14)
  })

  it("the job's provider cost is KIE's price for the size sent, whatever the images", () => {
    for (const size of SIZES) {
      const usd = (FLUX_3_KLEIN_KIE_HUNDREDTHS[size] / 100) * 0.005
      expect(kieImageCostUsd(T2I, KIE_IMAGE_MODELS[T2I]!, size), size).toBeCloseTo(usd, 10)
      expect(kieImageCostUsd(I2I, KIE_IMAGE_MODELS[I2I]!, size, 7), size).toBeCloseTo(usd, 10)
    }
    expect(kieImageCostUsd(T2I, KIE_IMAGE_MODELS[T2I]!, undefined)).toBeCloseTo(0.008, 10)
  })
})

describe("FLUX 3 Klein: every reserving path sees the size, on both ids", () => {
  const check = (body: Record<string, unknown>) => imageCreditIdentifierFor(body, undefined, undefined)
  const charged = (id: string) => statedPrices().credits(id)

  it.each(SIZES)("at %s: the route check, the image-to-image check, the workflow and the editor estimate charge the same", (size) => {
    const atSize = { resolution: size }
    // Generate Image from a prompt, and with references (moved to the edit).
    const fromPrompt = check({ provider: T2I, prompt: "x", ...atSize })
    const withRefs = check({ provider: T2I, prompt: "x", ...atSize, referenceImageUrls: refs(3) })
    expect(fromPrompt).toBe(`flux-3-klein:${size}`)
    expect(withRefs).toBe(`flux-3-klein-i2i:${size}`)
    // The route's DEBIT (`resolveNormalizedImageGen`, the swap on) prices what the CHECK does.
    expect(resolveNormalizedImageGen({ provider: T2I, resolution: size, refCount: 0, swapToI2i: true }).identifier).toBe(fromPrompt)
    expect(resolveNormalizedImageGen({ provider: T2I, resolution: size, refCount: 3, swapToI2i: true }).identifier).toBe(withRefs)
    // Image to Image, its source counted with the references.
    const edit = resolveImageToImageCreditIdentifier({ body: { provider: I2I, imageUrl: SRC, referenceImageUrls: refs(2), ...atSize } } as never)
    expect(edit).toBe(`flux-3-klein-i2i:${size}`)
    // The workflow estimate (the editor's run total and a published app's price).
    const genEstimate = getNodeModelIdentifier({ id: "a", type: "generate-image", data: { provider: T2I, ...atSize } } as never, {})
    const genEstimateRefs = getNodeModelIdentifier({ id: "a", type: "generate-image", data: { provider: T2I, ...atSize, referenceImageUrls: [REF(1)] } } as never, { imageRefsWired: 4 })
    const editEstimate = getNodeModelIdentifier({ id: "b", type: "image-to-image", data: { provider: I2I, ...atSize } } as never, { imageRefsWired: 9 })
    // Every one of them charges the size's price.
    for (const id of [fromPrompt, withRefs, edit, genEstimate, genEstimateRefs, editEstimate]) expect(charged(id), id).toBe(CHARGED[size])
  })

  it("a request naming no size is priced at 1K everywhere", () => {
    expect(check({ provider: T2I, prompt: "x" })).toBe("flux-3-klein:1K")
    // A base image alone is an image sent: the run is an edit, priced on the edit id.
    expect(check({ provider: T2I, prompt: "x", baseImageUrl: SRC })).toBe("flux-3-klein-i2i:1K")
    expect(resolveImageToImageCreditIdentifier({ body: { provider: I2I, imageUrl: SRC } } as never)).toBe("flux-3-klein-i2i:1K")
    expect(getNodeModelIdentifier({ id: "a", type: "generate-image", data: { provider: T2I } } as never, {})).toBe("flux-3-klein:1K")
  })

  it("a size the model does not list is snapped to 1K before the check prices it", () => {
    expect(check({ provider: T2I, prompt: "x", resolution: "1.5K" })).toBe("flux-3-klein:1K")
    expect(check({ provider: T2I, prompt: "x", resolution: "2 MP" })).toBe("flux-3-klein:1K")
  })

  it("the entity routes: face, object, creature, scene and surround price what they send (no size: 1K)", () => {
    expect(plainEntityCreditIdentifier(T2I, 0)).toBe("flux-3-klein:1K")
    expect(plainEntityCreditIdentifier(T2I, 2)).toBe("flux-3-klein-i2i:1K")
    expect(plainEntityCheckIdentifier({ provider: T2I, sourceImageUrl: SRC }, "nano-banana")).toBe("flux-3-klein-i2i:1K")
    expect(plainEntityCheckIdentifier({ provider: T2I }, "nano-banana")).toBe("flux-3-klein:1K")
  })

  it("the character and location routes price the size they send", () => {
    for (const size of SIZES) {
      expect(resolveEntityImageCreditIdentifier({ provider: T2I, resolution: size })).toBe(`flux-3-klein:${size}`)
      expect(resolveEntityImageCreditIdentifier({ provider: T2I, resolution: size, sourceImageUrl: SRC })).toBe(`flux-3-klein-i2i:${size}`)
    }
  })

  it("a workflow estimate counts a base image and the node's own references as images sent", () => {
    expect(getNodeModelIdentifier({ id: "a", type: "generate-image", data: { provider: T2I, baseImageUrl: SRC } } as never, {})).toBe("flux-3-klein-i2i:1K")
    expect(getNodeModelIdentifier({ id: "a", type: "generate-image", data: { provider: T2I, resolution: "2K", referenceImageUrls: [REF(1)] } } as never, {})).toBe("flux-3-klein-i2i:2K")
    expect(getNodeModelIdentifier({ id: "a", type: "generate-image", data: { provider: T2I, resolution: "4K" } } as never, { imageRefsWired: 2 })).toBe("flux-3-klein-i2i:4K")
  })

  it("a workflow Character node is priced on what its job sends: no size, so 1K", () => {
    expect(workflowEntityCreditIdentifier({ provider: T2I, resolution: "4K" })).toBe("flux-3-klein:1K")
    expect(workflowEntityCreditIdentifier({ provider: T2I, sourceImageUrl: SRC })).toBe("flux-3-klein-i2i:1K")
    // Every other model keeps its own rule.
    expect(workflowEntityCreditIdentifier({ provider: "gpt-image-2", resolution: "4K" })).toBe("gpt-image-2:4K")
  })
})

describe("FLUX 3 Klein: the id priced is the id the provider runs, on every path", () => {
  const check = (body: Record<string, unknown>) => imageCreditIdentifierFor(body, undefined, undefined)
  // The model the KIE provider sends a request to: the edit id whenever an image goes.
  const runs = (sent: number) => kieImageModelSent(T2I, sent)
  const modelOf = (creditId: string) => creditId.split(":")[0]

  it.each([
    ["a prompt alone", {}, 0],
    ["a base image alone (a refine)", { baseImageUrl: SRC }, 1],
    ["references", { referenceImageUrls: refs(2) }, 2],
    ["a base image and references", { baseImageUrl: SRC, referenceImageUrls: refs(3) }, 4],
  ] as const)("Generate Image with %s", (_label, extra, sent) => {
    const id = check({ provider: T2I, prompt: "x", resolution: "2K", ...extra })
    expect(modelOf(id)).toBe(runs(sent))
    expect(resolveNormalizedImageGen({ provider: T2I, resolution: "2K", refCount: sent, swapToI2i: true }).identifier).toBe(id)
  })

  it.each([
    ["nothing", {}, 0, 0],
    ["a base image", { baseImageUrl: SRC }, 0, 1],
    ["its own references", { referenceImageUrls: refs(2) }, 0, 2],
    ["wired references", {}, 3, 3],
  ] as const)("a workflow estimate of a Generate Image node with %s", (_label, data, wired, sent) => {
    const id = getNodeModelIdentifier({ id: "a", type: "generate-image", data: { provider: T2I, resolution: "4K", ...data } } as never, { imageRefsWired: wired })
    expect(modelOf(id)).toBe(runs(sent))
  })

  it("a workflow estimate of an entity node quotes the id its run reserves, not a stored size", () => {
    for (const type of ["character", "location"]) {
      expect(getNodeModelIdentifier({ id: "c", type, data: { provider: T2I, resolution: "4K" } } as never, {}), type).toBe(workflowEntityCreditIdentifier({ provider: T2I, resolution: "4K" }))
      expect(getNodeModelIdentifier({ id: "c", type, data: { provider: T2I, resolution: "4K" } } as never, {}), type).toBe("flux-3-klein:1K")
    }
    for (const type of ["face", "object", "creature"]) {
      expect(getNodeModelIdentifier({ id: "f", type, data: { provider: T2I, resolution: "4K" } } as never, {}), type).toBe("flux-3-klein:1K")
      expect(getNodeModelIdentifier({ id: "f", type, data: { provider: T2I, sourceImageUrl: SRC } } as never, { imageRefsWired: 3 }), type).toBe("flux-3-klein-i2i:1K")
    }
    // Every other model keeps its own quote.
    expect(getNodeModelIdentifier({ id: "c", type: "character", data: { provider: "gpt-image-2", resolution: "4K" } } as never, {})).toBe("gpt-image-2:4K")
  })

  it("the entity runs: the edit id exactly when a source image goes", () => {
    expect(modelOf(plainEntityCreditIdentifier(T2I, 0))).toBe(runs(0))
    expect(modelOf(plainEntityCreditIdentifier(T2I, 1))).toBe(runs(1))
    expect(modelOf(workflowEntityCreditIdentifier({ provider: T2I }))).toBe(runs(0))
    expect(modelOf(workflowEntityCreditIdentifier({ provider: T2I, sourceImageUrl: SRC }))).toBe(runs(1))
    expect(modelOf(resolveEntityImageCreditIdentifier({ provider: T2I, sourceImageUrl: SRC }))).toBe(runs(1))
  })
})
