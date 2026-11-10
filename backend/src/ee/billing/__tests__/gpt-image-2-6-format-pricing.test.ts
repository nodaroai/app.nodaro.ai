// @test-units-by-name looks up only the gpt-image-2-6 credit rows and image node types it names
// @test-watches supabase/migrations/610_gpt_image_2_6_pricing.sql
/**
 * GPT Image 2.6's GIF and SVG prices: the charged figures the founder set
 * (pinned, through the real charged-price rule at the hosted settings), the
 * QUOTE equal to the CHARGE for every new row (the editor's estimate, the
 * routes' credit check and the workflow engine price one id, and it has a
 * row), and every PNG id and price as migration 610 seeded it.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildCreditModelIdentifier } from "@nodaro/shared/credits"
import { GPT_IMAGE_2_6_GIF_BANDS, GPT_IMAGE_2_6_SVG_LEVELS } from "@nodaro/shared/model-catalog"
import { STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "../credits.js"
import { statedPrices } from "../stated-prices.js"
import { gptImage26GifBaseCredits, gptImage26StaticCosts, gptImage26SvgBaseCredits } from "../gpt-image-2-6-pricing.js"
import { imageCreditIdentifierFor } from "../../../routes/generate-image-credit-id.js"
import { resolveImageToImageCreditIdentifier } from "../../../routes/image-to-image-credit-id.js"

const T2I = ["gpt-image-2-6-flare", "gpt-image-2-6-sunburst"] as const
const I2I = ["gpt-image-2-6-flare-i2i", "gpt-image-2-6-sunburst-i2i"] as const
const QUALITIES = ["auto", "low", "medium", "high", "xhigh", "max"] as const
const FIXED = ["low", "medium", "high", "xhigh", "max"] as const
const SIZES = ["1K", "2K", "4K"] as const
const charged = (id: string) => statedPrices().credits(id)

describe("a GIF's price: quality and band of frames", () => {
  // Tal, 2026-11-10: the charged figures for 2-8 / 9-12 / 13-16 frames, no input image.
  const CHARGED: Record<(typeof FIXED)[number], readonly [number, number, number]> = {
    low: [9, 19, 26],
    medium: [16, 32, 46],
    high: [19, 39, 54],
    xhigh: [32, 68, 95],
    max: [72, 150, 214],
  }
  const BASE: Record<(typeof FIXED)[number], readonly [number, number, number]> = {
    low: [8, 17, 23],
    medium: [14, 29, 41],
    high: [17, 35, 49],
    xhigh: [29, 61, 86],
    max: [65, 136, 194],
  }

  it("charges the figures set, from a prompt, on Flare and Sunburst alike", () => {
    for (const quality of FIXED) for (const [i, band] of ["2-8", "9-12", "13-16"].entries()) {
      for (const model of T2I) {
        const id = `${model}:${quality}:gif-${band}`
        expect(STATIC_CREDIT_COSTS[id], id).toBe(BASE[quality][i])
        expect(charged(id), id).toBe(CHARGED[quality][i])
      }
    }
  })

  it("prices by the band the frames fall in, 10 to 12 at 9's price", () => {
    const at = (frames: number) => buildCreditModelIdentifier("gpt-image-2-6-flare", "medium", "4K", undefined, undefined, 0, { outputFormat: "gif", gifFrames: frames })
    expect([2, 8].map(at)).toEqual(["gpt-image-2-6-flare:medium:gif-2-8", "gpt-image-2-6-flare:medium:gif-2-8"])
    expect([9, 10, 12].map(at)).toEqual(Array(3).fill("gpt-image-2-6-flare:medium:gif-9-12"))
    expect([13, 16].map(at)).toEqual(Array(2).fill("gpt-image-2-6-flare:medium:gif-13-16"))
    // No frames named: KIE's nine.
    expect(buildCreditModelIdentifier("gpt-image-2-6-flare", "medium", "1K", undefined, undefined, 0, { outputFormat: "gif" })).toBe("gpt-image-2-6-flare:medium:gif-9-12")
  })

  it("an edit adds the same per input image as a still, for 1 to 16 images", () => {
    for (const quality of FIXED) for (const { id: band } of GPT_IMAGE_2_6_GIF_BANDS) for (let n = 1; n <= 16; n++) {
      expect(gptImage26GifBaseCredits(quality, band, n) - gptImage26GifBaseCredits(quality, band, 0)).toBeGreaterThanOrEqual(Math.floor(2.2 * 2.5 * n))
      for (const model of I2I) expect(STATIC_CREDIT_COSTS[`${model}:${quality}:gif-${band}:${n}ref`]).toBe(gptImage26GifBaseCredits(quality, band, n))
    }
    expect(STATIC_CREDIT_COSTS["gpt-image-2-6-flare-i2i:medium:gif-9-12:1ref"]).toBe(34)
  })

  it("Auto is reserved at the Max row of its band", () => {
    for (const { id: band } of GPT_IMAGE_2_6_GIF_BANDS) for (let n = 0; n <= 16; n++) {
      expect(gptImage26GifBaseCredits("auto", band, n)).toBe(gptImage26GifBaseCredits("max", band, n))
    }
  })
})

describe("an SVG's price: the PNG row plus its level", () => {
  // Tal, 2026-11-10: charged at Medium, 1K / 2K / 4K.
  const CHARGED = { standard: [28, 50, 80], detailed: [71, 93, 123], max: [90, 112, 141] } as const

  it("charges the figures set at Medium", () => {
    for (const level of GPT_IMAGE_2_6_SVG_LEVELS) for (const [i, size] of SIZES.entries()) {
      for (const model of T2I) expect(charged(`${model}:medium:${size}:svg-${level}`), `${model} ${level} ${size}`).toBe(CHARGED[level][i])
    }
  })

  it("adds the same amount to every quality, size and image count", () => {
    const addOn = { standard: 5, detailed: 44, max: 61 } as const
    for (const level of GPT_IMAGE_2_6_SVG_LEVELS) for (const quality of QUALITIES) for (const size of SIZES) for (let n = 0; n <= 16; n++) {
      const png = n === 0 ? `gpt-image-2-6-flare:${quality}:${size}` : `gpt-image-2-6-flare-i2i:${quality}:${size}:${n}ref`
      const svg = n === 0 ? `gpt-image-2-6-flare:${quality}:${size}:svg-${level}` : `gpt-image-2-6-flare-i2i:${quality}:${size}:svg-${level}:${n}ref`
      expect(STATIC_CREDIT_COSTS[svg], svg).toBe(STATIC_CREDIT_COSTS[png]! + addOn[level])
      expect(gptImage26SvgBaseCredits(quality, size, n, level)).toBe(STATIC_CREDIT_COSTS[svg])
    }
  })
})

describe("JPEG and WebP cost what PNG costs: the same ids", () => {
  it("adds no part to the id", () => {
    for (const outputFormat of ["png", "jpeg", "webp", undefined]) {
      expect(buildCreditModelIdentifier("gpt-image-2-6-flare", "high", "2K", undefined, undefined, 0, { outputFormat })).toBe("gpt-image-2-6-flare:high:2K")
      expect(buildCreditModelIdentifier("gpt-image-2-6-flare-i2i", "high", "2K", undefined, undefined, 3, { outputFormat })).toBe("gpt-image-2-6-flare-i2i:high:2K:3ref")
    }
  })

  it("another model's id ignores the format", () => {
    expect(buildCreditModelIdentifier("gpt-image-2-5-flare", undefined, "2K", undefined, undefined, 0, { outputFormat: "gif" })).toBe("gpt-image-2-5-flare:2K")
    expect(buildCreditModelIdentifier("gpt-image-2-6-economy", undefined, undefined, undefined, undefined, 0, { outputFormat: "gif", gifFrames: 16 })).toBe("gpt-image-2-6-economy")
  })
})

describe("quote = charge for every GIF and SVG row", () => {
  /** Every request shape a new row prices, with the id it must be priced on. */
  function* cases(): Generator<{ levers: Record<string, unknown>; quality: string; size: string; refs: number; id: string }> {
    for (const quality of QUALITIES) for (let refs = 0; refs <= 16; refs++) {
      const model = refs === 0 ? "gpt-image-2-6-flare" : "gpt-image-2-6-flare-i2i"
      const suffix = refs === 0 ? "" : `:${refs}ref`
      for (const { id: band, min } of GPT_IMAGE_2_6_GIF_BANDS) {
        yield { levers: { outputFormat: "gif", gifFrames: min }, quality, size: "2K", refs, id: `${model}:${quality}:gif-${band}${suffix}` }
      }
      for (const level of GPT_IMAGE_2_6_SVG_LEVELS) for (const size of SIZES) {
        yield { levers: { outputFormat: "svg", svgLevel: level }, quality, size, refs, id: `${model}:${quality}:${size}:svg-${level}${suffix}` }
      }
    }
  }
  const refUrls = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn.example.com/r${i}.png`)

  it("the estimate, the generate route's check and the id built agree, and the row is there", () => {
    let checked = 0
    for (const c of cases()) {
      const body = { prompt: "x", provider: "gpt-image-2-6-flare", quality: c.quality, resolution: c.size, referenceImageUrls: refUrls(c.refs), ...c.levers }
      expect(imageCreditIdentifierFor(body, undefined, undefined), `route ${c.id}`).toBe(c.id)
      const node = { id: "n", type: "generate-image", data: { provider: "gpt-image-2-6-flare", quality: c.quality, resolution: c.size, referenceImageUrls: refUrls(c.refs), ...c.levers } }
      expect(getNodeModelIdentifier(node as never, {}), `estimate ${c.id}`).toBe(c.id)
      expect(STATIC_CREDIT_COSTS[c.id], c.id).toBeGreaterThan(0)
      checked++
    }
    expect(checked).toBe(6 * 17 * (3 + 9))
  })

  it("the edit route's check prices the source and the references", () => {
    for (const c of cases()) {
      if (c.refs === 0) continue
      const req = { body: { provider: "gpt-image-2-6-flare-i2i", imageUrl: "https://cdn.example.com/src.png", prompt: "x", quality: c.quality, resolution: c.size, referenceImageUrls: refUrls(c.refs - 1), ...c.levers } }
      expect(resolveImageToImageCreditIdentifier(req as never), c.id).toBe(c.id)
    }
  })

  it("every new row has a charged price, never below its base", () => {
    for (const [id, base] of Object.entries(gptImage26StaticCosts())) {
      if (!id.includes(":gif-") && !id.includes(":svg-")) continue
      expect(charged(id), id).toBeGreaterThanOrEqual(base)
    }
  })
})

describe("every PNG id and price is the one migration 610 seeded", () => {
  const sql = readFileSync(join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations", "610_gpt_image_2_6_pricing.sql"), "utf8")
  const seeded = new Map([...sql.matchAll(/\('([^']+)', (\d+), true, 'image'\)/g)].map((m) => [m[1]!, Number(m[2])]))

  it("reads all 618 rows of 610", () => {
    expect(seeded.size).toBe(618)
  })

  it("the rows that are not a GIF or an SVG are exactly 610's Flare and Sunburst rows, at 610's prices", () => {
    const png = Object.entries(gptImage26StaticCosts()).filter(([id]) => !id.includes(":gif-") && !id.includes(":svg-"))
    const flareSunburst = [...seeded].filter(([id]) => !id.startsWith("gpt-image-2-6-economy"))
    expect(new Map(png)).toEqual(new Map(flareSunburst))
    for (const [id, credits] of seeded) expect(STATIC_CREDIT_COSTS[id], id).toBe(credits)
  })

  it("a PNG, JPEG or WebP request prices a 610 id", () => {
    for (const outputFormat of ["png", "jpeg", "webp"]) for (const quality of QUALITIES) for (const size of SIZES) {
      expect(seeded.has(imageCreditIdentifierFor({ prompt: "x", provider: "gpt-image-2-6-sunburst", quality, resolution: size, outputFormat }, undefined, undefined))).toBe(true)
    }
  })
})
