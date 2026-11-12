// @test-units-by-name looks up only Nodaro Image Upscale's own price ids and node types
/**
 * Nodaro Image Upscale's prices: one row per output tier and the hold, at the
 * figures migration 627 seeds, and the workflow estimate prices a node from
 * the photo size its graph records — the same id the run reserves.
 */
import { describe, expect, it } from "vitest"
import { NODARO_IMAGE_UPSCALE_CREDIT_IDS, nodaroImageUpscaleSizing } from "@nodaro/render-rules"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "../credits.js"
import { statedPrices } from "../stated-prices.js"

describe("Nodaro Image Upscale static prices", () => {
  it("the tiers cost 4 / 10 / 30 base credits and the hold costs the top tier's", () => {
    expect(NODARO_IMAGE_UPSCALE_CREDIT_IDS.map((id) => [id, STATIC_CREDIT_COSTS[id]])).toEqual([
      ["nodaro-image-upscale:2K", 4],
      ["nodaro-image-upscale:4K", 10],
      ["nodaro-image-upscale:8K", 30],
      ["nodaro-image-upscale", 30],
    ])
  })

  it("the catalog's pricing rows are the same ids at the same figures", () => {
    const rows = MODEL_CATALOG["nodaro-image-upscale"]!.pricing
    expect(rows.map((r) => r.identifier).sort()).toEqual([...NODARO_IMAGE_UPSCALE_CREDIT_IDS].sort())
    for (const row of rows) expect(row.credits, row.identifier).toBe(STATIC_CREDIT_COSTS[row.identifier])
  })
})

describe("the workflow estimate prices the output's size", () => {
  const node = (type: string, data: Record<string, unknown>) => ({ id: "n", type, data: { provider: "nodaro-image-upscale", ...data } }) as never

  it.each(["upscale-image", "edit-image"])("%s: the recorded photo size × the factor; the hold without one", (type) => {
    const sourceImage = { width: 1024, height: 1024 }
    expect(getNodeModelIdentifier(node(type, { upscaleFactor: "2" }), { sourceImage })).toBe("nodaro-image-upscale:2K")
    expect(getNodeModelIdentifier(node(type, { upscaleFactor: "4" }), { sourceImage })).toBe("nodaro-image-upscale:4K")
    expect(getNodeModelIdentifier(node(type, { upscaleFactor: "8" }), { sourceImage })).toBe("nodaro-image-upscale:8K")
    expect(getNodeModelIdentifier(node(type, { upscaleFactor: "8", targetResolution: "2K" }), {})).toBe("nodaro-image-upscale")
    expect(getNodeModelIdentifier(node(type, { upscaleFactor: "8" }), { sourceImage: { width: 1100, height: 1100 } })).toBe("nodaro-image-upscale")
  })
})

describe("the price table's worked examples: a 1024 × 1024 picture (docs/nodes/ai-image/upscale-image.md)", () => {
  // The charged price is what the Run button shows: the row, at the hosted deployment's settings.
  it.each([
    ["1", 1024, "nodaro-image-upscale:2K", 5],
    ["2", 2048, "nodaro-image-upscale:2K", 5],
    ["4", 4096, "nodaro-image-upscale:4K", 11],
    ["8", 8192, "nodaro-image-upscale:8K", 33],
  ])("at %sx: %i × %i, %s, %i credits", (factor, side, creditId, charged) => {
    const sizing = nodaroImageUpscaleSizing({ width: 1024, height: 1024 }, factor)
    expect(sizing).toMatchObject({ kind: "sized", width: side, height: side, creditId })
    expect(getNodeModelIdentifier(({ id: "n", type: "upscale-image", data: { provider: "nodaro-image-upscale", upscaleFactor: factor } }) as never, { sourceImage: { width: 1024, height: 1024 } })).toBe(creditId)
    expect(statedPrices().credits(creditId)).toBe(charged)
  })

  it("the hold is the top tier's charged price", () => {
    expect(statedPrices().credits("nodaro-image-upscale")).toBe(33)
  })
})
