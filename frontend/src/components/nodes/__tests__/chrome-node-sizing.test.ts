import { describe, it, expect } from "vitest"
import { computeFittedNodeBox } from "../video-node-defaults"

describe("computeFittedNodeBox with chromeHeight", () => {
  const base = { aspectRatio: 16 / 9, minWidth: 240, minHeight: 368 }

  it("adds chrome height on top of the preview height (first fit)", () => {
    const C = 120
    // Width must clear the proportional-min floor (max(minWidth, minHeight*aspect)
    // = 654.2 for 368 @ 16:9) to be preserved — matches the existing first-fit
    // contract in compute-fitted-node-box.test.ts. 800 > 654.2, so width is kept.
    const W = 800
    const { width, height } = computeFittedNodeBox({ ...base, width: W, height: undefined, chromeHeight: C })
    // preview = width/aspect; node height = preview + chrome
    expect(width).toBe(W)
    expect(height).toBe(C + W / (16 / 9))
  })

  it("is idempotent: re-feeding its own output reproduces the box (preview area preserved across chrome)", () => {
    const C = 120
    const first = computeFittedNodeBox({ ...base, width: 600, height: 400, chromeHeight: C })
    const second = computeFittedNodeBox({ ...base, width: first.width, height: first.height, chromeHeight: C })
    expect(Math.abs(second.width - first.width)).toBeLessThan(1)
    expect(Math.abs(second.height - first.height)).toBeLessThan(1)
  })

  it("does NOT double-count chrome at the floor (minHeight is the preview floor)", () => {
    const C = 120
    // Tiny width forces the preview floor (minHeight). Node height must be
    // exactly minHeight + C, NOT minHeight + 2C.
    const { height } = computeFittedNodeBox({ ...base, width: 10, height: undefined, chromeHeight: C })
    expect(height).toBe(base.minHeight + C)
  })

  it("defaults chromeHeight to 0 (today's behavior unchanged)", () => {
    const without = computeFittedNodeBox({ ...base, width: 480, height: undefined })
    const withZero = computeFittedNodeBox({ ...base, width: 480, height: undefined, chromeHeight: 0 })
    expect(withZero).toEqual(without)
  })

  it("is WIDTH-DRIVEN with chrome: a new larger width is kept, NOT √-resnapped from a stale height", () => {
    const C = 120
    // The node carries a STALE stored height (457) from before a horizontal
    // resize that wrote only the new width (800). Area preservation would pull
    // width back to ~692 (√(800·337·aspect)); width-driven keeps the dragged 800.
    const { width, height } = computeFittedNodeBox({
      aspectRatio: 16 / 9,
      width: 800,
      height: 457,
      minWidth: 240,
      minHeight: 368,
      chromeHeight: C,
    })
    expect(width).toBe(800)
    // Height re-derived from the kept width: chrome + (width / aspect). The impl
    // returns the raw w/aspect (no rounding); 800/(16/9) === 450 exactly.
    expect(height).toBe(C + 800 / (16 / 9))
  })
})

describe("toggle idempotency (ON → OFF → ON)", () => {
  const base = { aspectRatio: 16 / 9, minWidth: 240, minHeight: 368 }
  it("returns to the original box after a chrome on/off/on cycle", () => {
    const C = 120
    const on1 = computeFittedNodeBox({ ...base, width: 600, height: 400, chromeHeight: C })
    // OFF: strip chrome out of the stored height (what the OFF-mode effect would store).
    const off = computeFittedNodeBox({ ...base, width: on1.width, height: on1.height - C, chromeHeight: 0 })
    // ON again from the OFF box.
    const on2 = computeFittedNodeBox({ ...base, width: off.width, height: off.height, chromeHeight: C })
    expect(Math.abs(on2.width - on1.width)).toBeLessThan(1)
    expect(Math.abs(on2.height - on1.height)).toBeLessThan(1)
  })
})
