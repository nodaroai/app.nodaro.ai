import { afterEach, describe, expect, it } from "vitest"
import { computeFlipPosition } from "../flip-position"

/**
 * Guard tests for `computeFlipPosition` — the shared flip-above-when-cramped
 * positioning heuristic used by the suggestion lists, the snippet pill's swap
 * menu, and (after RF Task 1) the four byte-identical hover-preview portals
 * (`tag-textarea`, `character-ref-view`, `image-ref-view`, `location-ref-view`).
 *
 * Every expected value below is derived BY HAND from the implementation so the
 * suite locks the heuristic rather than re-deriving it. The four invariants:
 *   margin    = opts.margin            ?? 4
 *   threshold = opts.placeBelowThreshold ?? 160
 *   secMargin = opts.secondaryClauseMargin ?? 0
 *   spaceBelow = vh - rect.bottom - margin
 *   placeBelow = spaceBelow >= threshold || spaceBelow >= rect.top - secMargin
 *   top  = placeBelow ? rect.bottom + margin
 *                     : Math.max(margin, rect.top - estHeight - margin)
 *   left = Math.min(Math.max(margin, rect.left), vw - width - margin)
 *
 * jsdom defaults innerWidth/innerHeight to 1024×768; we override per-case via
 * Object.defineProperty (the repo precedent — see pipeline-panel.test.tsx) and
 * restore both after each test.
 */

const DEFAULT_VW = 1024
const DEFAULT_VH = 768

function setViewport(vw: number, vh: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: vw })
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: vh })
}

/** Build a partial DOMRect — only the fields the helper reads. */
function rect(r: { top: number; bottom: number; left: number }): DOMRect {
  return { top: r.top, bottom: r.bottom, left: r.left } as DOMRect
}

afterEach(() => {
  setViewport(DEFAULT_VW, DEFAULT_VH)
})

describe("computeFlipPosition", () => {
  // ── Primary clause: plenty of room below → anchor below the rect ──────────
  it("places below when spaceBelow >= threshold (top = bottom + margin)", () => {
    setViewport(1000, 800)
    // rect bottom=100, top=80, left=200. margin defaults to 4, threshold 160.
    // spaceBelow = 800 - 100 - 4 = 696 >= 160 → placeBelow = true.
    // top  = 100 + 4 = 104
    // left = min(max(4, 200), 1000 - 300 - 4) = min(200, 696) = 200
    const out = computeFlipPosition(rect({ top: 80, bottom: 100, left: 200 }), {
      width: 300,
      estHeight: 300,
    })
    expect(out).toEqual({ top: 104, left: 200 })
  })

  // ── Primary clause fails, secondary fails → cramped flip-up ───────────────
  it("flips up when cramped (top = rect.top - estHeight - margin, secondary fails)", () => {
    setViewport(1000, 800)
    // Anchor pinned near the bottom: bottom=760, top=740, left=100.
    // margin 4, threshold 160, secMargin 0 (default).
    // spaceBelow = 800 - 760 - 4 = 36. 36 >= 160? no.
    // secondary: 36 >= rect.top - 0 = 740? no → placeBelow = false.
    // estHeight = 220 → top = max(4, 740 - 220 - 4) = max(4, 516) = 516
    // left = min(max(4, 100), 1000 - 300 - 4) = 100
    const out = computeFlipPosition(rect({ top: 740, bottom: 760, left: 100 }), {
      width: 300,
      estHeight: 220,
    })
    expect(out).toEqual({ top: 516, left: 100 })
  })

  // ── Cramped flip-up where the max(margin, …) FLOOR actually fires ─────────
  it("clamps flip-up top to margin when rect.top - estHeight - margin < margin", () => {
    setViewport(1000, 300)
    // Short viewport. rect bottom=250, top=230, left=50. margin 4, est 220, thr 160.
    // spaceBelow = 300 - 250 - 4 = 46. 46 >= 160? no.
    // secondary (secMargin 0): 46 >= 230? no → placeBelow = false.
    // rect.top - estHeight - margin = 230 - 220 - 4 = 6 → max(4, 6) = 6 (no floor yet)…
    // Push est higher to force the floor: est=240 → 230 - 240 - 4 = -14 → max(4, -14) = 4.
    const out = computeFlipPosition(rect({ top: 230, bottom: 250, left: 50 }), {
      width: 300,
      estHeight: 240,
    })
    // top floored to margin (4); left = min(max(4,50), 1000-300-4)=50
    expect(out).toEqual({ top: 4, left: 50 })
  })

  // ── Left clamp at the RIGHT viewport edge (rect.left too large) ───────────
  it("clamps left to vw - width - margin at the right edge", () => {
    setViewport(500, 800)
    // rect left=480 (near right edge), width 300, margin 4.
    // Right bound = 500 - 300 - 4 = 196. max(4, 480) = 480 → min(480, 196) = 196.
    // bottom=100,top=80 → spaceBelow = 800-100-4=696>=160 → top=104.
    const out = computeFlipPosition(rect({ top: 80, bottom: 100, left: 480 }), {
      width: 300,
      estHeight: 300,
    })
    expect(out).toEqual({ top: 104, left: 196 })
  })

  // ── Left clamp at the LEFT viewport edge (rect.left negative) ─────────────
  it("clamps left to margin at the left edge (negative rect.left)", () => {
    setViewport(1000, 800)
    // rect left=-30, margin 4 → max(4, -30) = 4. Right bound 1000-300-4=696.
    // min(4, 696) = 4.
    // bottom=100,top=80 → spaceBelow = 800-100-4 = 696 >= 160 → placeBelow → top = 100+4 = 104.
    const out = computeFlipPosition(rect({ top: 80, bottom: 100, left: -30 }), {
      width: 300,
      estHeight: 300,
    })
    expect(out).toEqual({ top: 104, left: 4 })
  })

  // ── Default threshold 160 governs the flip decision ───────────────────────
  it("uses default threshold 160 for the primary placeBelow clause", () => {
    setViewport(1000, 800)
    // Choose spaceBelow strictly between 160 and the secondary bound so ONLY the
    // 160 default can flip it below. bottom=636 → spaceBelow = 800-636-4 = 160.
    // 160 >= 160 → true → placeBelow regardless of secondary. top = 636+4 = 640.
    const below = computeFlipPosition(rect({ top: 500, bottom: 636, left: 10 }), {
      width: 100,
      estHeight: 100,
    })
    expect(below.top).toBe(640)

    // One pixel less room: bottom=637 → spaceBelow = 800-637-4 = 159 < 160.
    // secondary: 159 >= rect.top(500) - 0? no → flip up.
    // top = max(4, 500 - 100 - 4) = 396.
    const up = computeFlipPosition(rect({ top: 500, bottom: 637, left: 10 }), {
      width: 100,
      estHeight: 100,
    })
    expect(up.top).toBe(396)
  })

  // ── Custom placeBelowThreshold (the pill's estH-keyed path) ───────────────
  it("honors a custom placeBelowThreshold (pill passes its dynamic estHeight)", () => {
    setViewport(1000, 800)
    // The snippet pill passes placeBelowThreshold === estHeight (e.g. 320) and
    // secondaryClauseMargin: 4. bottom=460,top=300 → spaceBelow = 800-460-4 = 336.
    // Default 160 would place below (336>=160). With threshold 320: 336>=320 → still below.
    // top = 460 + 4 = 464. left = min(max(4,10), 1000-280-4)=10.
    const out = computeFlipPosition(rect({ top: 300, bottom: 460, left: 10 }), {
      width: 280,
      estHeight: 320,
      placeBelowThreshold: 320,
      secondaryClauseMargin: 4,
    })
    expect(out).toEqual({ top: 464, left: 10 })

    // Now make spaceBelow fall below the 320 threshold but stay >= 160 so the
    // raised threshold demonstrably changes the decision vs the default.
    // bottom=540 → spaceBelow = 800-540-4 = 256. 256 >= 320? no.
    // secondary (secMargin 4): 256 >= rect.top(300) - 4 = 296? no → flip up.
    // top = max(4, 300 - 320 - 4) = max(4, -24) = 4.
    const flipped = computeFlipPosition(rect({ top: 300, bottom: 540, left: 10 }), {
      width: 280,
      estHeight: 320,
      placeBelowThreshold: 320,
      secondaryClauseMargin: 4,
    })
    expect(flipped.top).toBe(4)
    // Under the DEFAULT threshold (160) the SAME geometry would place below
    // (256 >= 160) — proving placeBelowThreshold actually drove the flip.
    const defaultThreshold = computeFlipPosition(rect({ top: 300, bottom: 540, left: 10 }), {
      width: 280,
      estHeight: 320,
    })
    expect(defaultThreshold.top).toBe(544) // 540 + 4 (default margin), placed below
  })

  // ── secondaryClauseMargin affects the placeBelow decision ─────────────────
  it("secondaryClauseMargin shifts the secondary 'room below' boundary", () => {
    setViewport(1000, 800)
    // Geometry where the primary clause fails and the secondary clause sits
    // right on the knife-edge so secMargin flips the outcome.
    // bottom=708, top=300, margin 4 (default), threshold 160.
    // spaceBelow = 800 - 708 - 4 = 88. 88 >= 160? no (primary fails both cases).
    //
    // secMargin = 0 (default): secondary = 88 >= 300 - 0 = 300? no → flip up.
    //   top = max(4, 300 - 100 - 4) = 196.
    const sec0 = computeFlipPosition(rect({ top: 300, bottom: 708, left: 10 }), {
      width: 100,
      estHeight: 100,
    })
    expect(sec0.top).toBe(196)

    // secMargin = 300: secondary = 88 >= 300 - 300 = 0? yes → place below.
    //   top = 708 + 4 = 712.
    const sec300 = computeFlipPosition(rect({ top: 300, bottom: 708, left: 10 }), {
      width: 100,
      estHeight: 100,
      secondaryClauseMargin: 300,
    })
    expect(sec300.top).toBe(712)
  })

  // ── margin: 0 honored — proves `??` (nullish) not `||` (falsy) ────────────
  it("honors margin: 0 (nullish-coalescing, not falsy-OR)", () => {
    setViewport(1000, 800)
    // With margin 0 the defaults would be 4 if `||` were used. Pin geometry so
    // the difference is observable in BOTH top and left.
    // rect bottom=100, top=80, left=-5, width 300.
    // spaceBelow = 800 - 100 - 0 = 700 >= 160 → placeBelow.
    // top = 100 + 0 = 100   (would be 104 if margin fell back to 4)
    // left = min(max(0, -5), 1000 - 300 - 0) = min(0, 700) = 0  (would be 4 if margin=4)
    const out = computeFlipPosition(rect({ top: 80, bottom: 100, left: -5 }), {
      width: 300,
      estHeight: 300,
      margin: 0,
    })
    expect(out).toEqual({ top: 100, left: 0 })
  })

  // ── margin: 0 on the flip-up branch (max(margin, …) floor with margin 0) ──
  it("honors margin: 0 on the flip-up floor", () => {
    setViewport(1000, 300)
    // Cramped + margin 0. bottom=280, top=200, left=10, est=240.
    // spaceBelow = 300 - 280 - 0 = 20. 20 >= 160? no.
    // secondary: 20 >= rect.top(200) - 0 = 200? no → flip up.
    // top = max(0, 200 - 240 - 0) = max(0, -40) = 0  (floor is now 0, not 4 — `??` honors 0)
    const out = computeFlipPosition(rect({ top: 200, bottom: 280, left: 10 }), {
      width: 100,
      estHeight: 240,
      margin: 0,
    })
    expect(out.top).toBe(0)
  })

  // ── The exact hover-preview parameterization (RF Task 1 consolidation) ────
  it("reproduces the hover-preview block math (width/est=220, margin 8, thr 220, secMargin 8)", () => {
    const opts = {
      width: 220,
      estHeight: 220,
      margin: 8,
      placeBelowThreshold: 220,
      secondaryClauseMargin: 8,
    }

    // Case A — room below. anchor bottom=100, top=80, left=300. vw=1000, vh=800.
    // spaceBelow = 800 - 100 - 8 = 692. 692 >= 220 → placeBelow.
    // top = 100 + 8 = 108. left = min(max(8,300), 1000-220-8)=min(300,772)=300.
    setViewport(1000, 800)
    expect(computeFlipPosition(rect({ top: 80, bottom: 100, left: 300 }), opts)).toEqual({
      top: 108,
      left: 300,
    })

    // Case B — cramped, secondary fails → flip up. anchor bottom=760, top=740, left=900.
    // spaceBelow = 800 - 760 - 8 = 32. 32>=220? no. secondary: 32 >= 740-8=732? no → flip up.
    // top = max(8, 740 - 220 - 8) = max(8, 512) = 512.
    // left = min(max(8,900), 1000-220-8=772) = 772 (right-edge clamp).
    expect(computeFlipPosition(rect({ top: 740, bottom: 760, left: 900 }), opts)).toEqual({
      top: 512,
      left: 772,
    })

    // Case C — secondary clause rescues a bottom-anchored preview in a short
    // viewport (the documented "open downward rather than off-screen" path).
    // vh=400. anchor bottom=300, top=280, left=10.
    // spaceBelow = 400 - 300 - 8 = 92. 92>=220? no.
    // secondary: 92 >= 280 - 8 = 272? no → still flips up here.
    // (Kept as a flip-up assertion; secMargin 8 < the 272 gap.)
    // top = max(8, 280 - 220 - 8) = max(8, 52) = 52.
    setViewport(1000, 400)
    expect(computeFlipPosition(rect({ top: 280, bottom: 300, left: 10 }), opts)).toEqual({
      top: 52,
      left: 10,
    })
  })
})
