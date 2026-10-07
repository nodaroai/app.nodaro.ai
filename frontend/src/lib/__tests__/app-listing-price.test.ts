import { describe, it, expect } from "vitest"
import { listedAppCredits } from "../app-listing-price"

// A published app's listed price (decided 2026-10-06): the preview run with
// the creator's fee, plus each Render final without it — the server's
// `appListingPrice`, which the creator's price preview must agree with.
describe("listedAppCredits", () => {
  it("the fee marks up the preview run alone", () => {
    expect(listedAppCredits({ base: 40, final: 150 }, { enabled: true, flatFee: 10, percent: 50 })).toBe(40 + 10 + 20 + 150)
  })

  it("no fee: the two parts, summed", () => {
    expect(listedAppCredits({ base: 40, final: 150 }, { enabled: false, flatFee: 10, percent: 50 })).toBe(190)
  })

  it("no final part (no Preview render, or a listing stored before the split): as before", () => {
    expect(listedAppCredits({ base: 130, final: 0 }, { enabled: true, flatFee: 10, percent: 0 })).toBe(140)
    expect(listedAppCredits({ base: 130 }, { enabled: true, flatFee: 10, percent: 0 })).toBe(140)
  })

  it("a free preview is never marked up", () => {
    expect(listedAppCredits({ base: 0, final: 150 }, { enabled: true, flatFee: 10, percent: 0 })).toBe(150)
  })
})
