// @test-units-by-name prices only the kling-image-4 set rows it names
import { describe, expect, it, vi } from "vitest"

// The row a settled id is priced at: the static rows, as an empty
// model_pricing table would answer (`creditIdBaseCredits` reads the row).
vi.mock("../credit-id-base.js", async () => {
  const { klingImage4StaticCosts } = await import("../../ee/billing/kling-image-4-pricing.js")
  const rows = klingImage4StaticCosts()
  return { creditIdBaseCredits: async (id: string) => rows[id] }
})

import { imageSetSettledBase, imageSetSettledCreditId } from "../image-set-settle.js"

describe("a set settles on the images it stored", () => {
  it("fewer images than asked settle on the row of the images stored", () => {
    expect(imageSetSettledCreditId("kling-image-4:2K:x6", 4)).toBe("kling-image-4:2K:x4")
    expect(imageSetSettledCreditId("kling-image-4-i2i:8K:3ref:x10", 2)).toBe("kling-image-4-i2i:8K:3ref:x2")
    expect(imageSetSettledCreditId("kling-image-4:4K:x5", 1)).toBe("kling-image-4:4K")
  })

  it("all of them, more, none, or no set at all commit the hold", () => {
    expect(imageSetSettledCreditId("kling-image-4:2K:x6", 6)).toBeUndefined()
    expect(imageSetSettledCreditId("kling-image-4:2K:x6", 9)).toBeUndefined()
    expect(imageSetSettledCreditId("kling-image-4:2K:x6", 0)).toBeUndefined()
    expect(imageSetSettledCreditId("kling-image-4:2K", 1)).toBeUndefined()
    expect(imageSetSettledCreditId(undefined, 1)).toBeUndefined()
    expect(imageSetSettledCreditId(42, 1)).toBeUndefined()
  })

  it("reads the hold recorded on the job and prices the row it settles on", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await imageSetSettledBase({ setHoldCreditId: "kling-image-4:2K:x10" }, 7)).toBe(7 * 29)
    expect(await imageSetSettledBase({ setHoldCreditId: "kling-image-4-i2i:2K:1ref:x3" }, 1)).toBe(30)
    expect(await imageSetSettledBase({ setHoldCreditId: "kling-image-4:2K:x10" }, 10)).toBeUndefined()
    expect(await imageSetSettledBase({}, 3)).toBeUndefined()
    expect(await imageSetSettledBase(null, 3)).toBeUndefined()
  })
})
