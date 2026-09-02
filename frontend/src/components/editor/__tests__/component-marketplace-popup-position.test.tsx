import { describe, it, expect } from "vitest"
import { MARKETPLACE_POPUP_WIDTH, clampPopupLeft } from "../component-marketplace-modal"

// Every caller hands the popup a physical x (rail button edge, right-click
// clientX, handle drop) with no idea of the popup's width; under RTL the rail
// sits near the viewport's right edge, so an unclamped left pushed the popup
// almost entirely off-screen. One clamp in the modal covers all of them.
describe("marketplace popup placement", () => {
  it("keeps the popup inside the viewport with an 8px inset", () => {
    expect(clampPopupLeft(1200, 1000)).toBe(1000 - MARKETPLACE_POPUP_WIDTH - 8)
    expect(clampPopupLeft(-40, 1000)).toBe(8)
    expect(clampPopupLeft(300, 1000)).toBe(300)
  })
  it("exports the width the rail anchors against", () => {
    expect(MARKETPLACE_POPUP_WIDTH).toBe(320)
  })
})
