/**
 * The canvas preview's first frame must fit the flow into the ground its
 * floating chrome leaves free — edge to edge, a flow's outputs sat under the
 * Clone panel and its lower lanes under the results rail (2026-09-24).
 */
import { describe, expect, it } from "vitest"
import { chromeInsets, fitViewPadding } from "../chrome-insets"

const canvas = { left: 0, top: 0, right: 1440, bottom: 900 }
const topBar = { left: 0, top: 0, right: 1440, bottom: 64 }
const rail = { left: 18, top: 662, right: 778, bottom: 882 }
const panel = { left: 1082, top: 330, right: 1422, bottom: 882 }

describe("chromeInsets", () => {
  it("keeps a plain margin on every side when nothing floats over the canvas", () => {
    expect(chromeInsets(canvas, [])).toEqual({ top: 40, right: 40, bottom: 40, left: 40 })
  })

  it("charges each piece of chrome to the side it reaches in least from", () => {
    // The top bar is a strip along the top, the corner rail a strip along the
    // bottom and the tall corner panel a column down the right — plus air.
    expect(chromeInsets(canvas, [topBar, rail, panel])).toEqual({ top: 88, right: 382, bottom: 262, left: 40 })
  })

  it("mirrors with the page: an RTL rail and panel swap corners", () => {
    const rtlRail = { left: 662, top: 662, right: 1422, bottom: 882 }
    const rtlPanel = { left: 18, top: 330, right: 358, bottom: 882 }
    expect(chromeInsets(canvas, [rtlRail, rtlPanel])).toEqual({ top: 40, right: 40, bottom: 262, left: 382 })
  })

  it("ignores hidden chrome and chrome outside the canvas", () => {
    const hidden = { left: 18, top: 882, right: 18, bottom: 882 }
    const outside = { left: 1500, top: 0, right: 1600, bottom: 100 }
    expect(chromeInsets(canvas, [hidden, outside])).toEqual({ top: 40, right: 40, bottom: 40, left: 40 })
  })

  it("falls back to the plain margin when the chrome would leave too little canvas", () => {
    const phone = { left: 0, top: 0, right: 390, bottom: 700 }
    const sheet = { left: 18, top: 150, right: 372, bottom: 682 }
    expect(chromeInsets(phone, [sheet])).toEqual({ top: 40, right: 40, bottom: 40, left: 40 })
  })
})

describe("fitViewPadding", () => {
  it("keeps React Flow's 10% when the page floats no chrome", () => {
    expect(fitViewPadding(undefined)).toBe(0.1)
  })

  it("hands the insets to fitView as px per side", () => {
    expect(fitViewPadding({ top: 88, right: 382, bottom: 262, left: 40 })).toEqual({
      top: "88px",
      right: "382px",
      bottom: "262px",
      left: "40px",
    })
  })
})
