import { describe, it, expect, vi, beforeEach } from "vitest"

const size = vi.hoisted(() => ({ current: undefined as { width: number; height: number } | undefined }))
vi.mock("@/lib/image-source-size.js", () => ({ probeImageDisplaySize: vi.fn(async () => size.current) }))
// The tier rows as seeded (25 for 1×/2×, 50 for 4×) and the one-unit row at 25.
vi.mock("@/lib/credit-base-cost.js", () => ({
  baseCreditCostFor: vi.fn(async (id: string) => (id === "topaz-image-upscale:4K" ? 50 : 25)),
  unitRateBaseCredits: vi.fn(async (_id: string, units: number) => units * 25),
}))

import { topazImageSizeUnits, TOPAZ_IMAGE_MAX_OUTPUT_MP } from "@nodaro/render-rules"
import {
  readTopazImageSize,
  stampTopazImageSize,
  topazImageSizeBaseCredits,
  topazImageStampedBaseCredits,
  topazImageTier,
} from "../topaz-image-size.js"

beforeEach(() => {
  size.current = { width: 1024, height: 1024 }
})

describe("Topaz image size units (the provider's published steps)", () => {
  it("prices an output by the smallest step that holds it", () => {
    expect(topazImageSizeUnits(4.2)).toBe(1)
    expect(topazImageSizeUnits(24)).toBe(1)
    expect(topazImageSizeUnits(24.1)).toBe(2)
    expect(topazImageSizeUnits(67)).toBe(4)
    expect(topazImageSizeUnits(TOPAZ_IMAGE_MAX_OUTPUT_MP)).toBe(17)
    expect(topazImageSizeUnits(TOPAZ_IMAGE_MAX_OUTPUT_MP + 1)).toBeUndefined()
  })
})

describe("readTopazImageSize", () => {
  it("reads the output size of the factor over the image's header", async () => {
    size.current = { width: 2048, height: 2048 }
    expect(await readTopazImageSize("https://cdn/a.png", "4")).toEqual({ kind: "sized", units: 4, megapixels: expect.closeTo(67.1, 1) })
  })

  it("an output past the largest step is too large; an unreadable header is unknown", async () => {
    size.current = { width: 8192, height: 8192 }
    expect((await readTopazImageSize("https://cdn/a.png", "4")).kind).toBe("too-large")
    size.current = undefined
    expect(await readTopazImageSize("https://cdn/a.png", "2")).toEqual({ kind: "unknown" })
  })
})

describe("the charge", () => {
  it("an ordinary image costs its tier row, as before (no override)", async () => {
    expect(await topazImageSizeBaseCredits("topaz-image-upscale", 1)).toBeUndefined()
    // 4× at 2 units: the 50-credit tier already covers it.
    expect(await topazImageSizeBaseCredits("topaz-image-upscale:4K", 2)).toBeUndefined()
  })

  it("a large output costs its size units when that is higher than the tier", async () => {
    expect(await topazImageSizeBaseCredits("topaz-image-upscale:4K", 4)).toBe(100)
    expect(await topazImageSizeBaseCredits("topaz-image-upscale", 2)).toBe(50)
  })

  it("reads the tier from the same resolver the route and the worker use", () => {
    expect(topazImageTier({ upscaleFactor: "4" })).toEqual({ creditId: "topaz-image-upscale:4K", factor: "4" })
    expect(topazImageTier({})).toEqual({ creditId: "topaz-image-upscale", factor: "2" })
  })
})

describe("the workflow run's stamp", () => {
  it("stamps the size units and prices a large output above its tier", async () => {
    size.current = { width: 2048, height: 2048 }
    const payload = { provider: "topaz-image-upscale", imageUrl: "https://cdn/a.png", upscaleFactor: "4" }
    const stamp = await stampTopazImageSize("edit-image", payload, true)
    expect(stamp).toEqual({ ok: true, patch: { topazSizeUnits: 4 } })
    expect(await topazImageStampedBaseCredits("edit-image", { ...payload, topazSizeUnits: 4 })).toBe(100)
  })

  it("refuses an output past the largest size; skips other providers and credit-less installs", async () => {
    size.current = { width: 8192, height: 8192 }
    const payload = { provider: "topaz-image-upscale", imageUrl: "https://cdn/a.png", upscaleFactor: "4" }
    expect(await stampTopazImageSize("edit-image", payload, true)).toEqual({ ok: false, message: expect.stringContaining("512 megapixels") })
    expect(await stampTopazImageSize("edit-image", payload, false)).toEqual({ ok: true, patch: {} })
    expect(await stampTopazImageSize("edit-image", { provider: "recraft-upscale", imageUrl: "https://cdn/a.png" }, true)).toEqual({ ok: true, patch: {} })
  })
})
