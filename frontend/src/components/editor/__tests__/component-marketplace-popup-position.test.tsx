import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
// The geometry lives in a leaf module: the canvas toolbar imports it, and a
// static value import of the modal itself would pull the whole marketplace
// (react-query mutations, preview modal, cards) into the eager editor chunk,
// defeating the three lazy() boundaries that mount it.
import { MARKETPLACE_POPUP_WIDTH, clampPopupLeft, popupDefaultStyle } from "../marketplace-popup-geometry"

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
  it("defaults to the inline-start edge, past the app sidebar, in both directions", () => {
    // The only caller with no position is the Add Node panel's Components
    // entry — a panel at the inline start. The popup opens beside it.
    expect(popupDefaultStyle(false)).toEqual({ left: 70, top: "50%", transform: "translateY(-50%)" })
    expect(popupDefaultStyle(true)).toEqual({ right: 70, top: "50%", transform: "translateY(-50%)" })
  })
  it("keeps the canvas toolbar off the modal's static import graph", () => {
    const toolbar = fs.readFileSync(path.resolve(__dirname, "../canvas-toolbar.tsx"), "utf8")
    expect(toolbar).not.toMatch(/from "\.\/component-marketplace-modal"/)
  })
})
