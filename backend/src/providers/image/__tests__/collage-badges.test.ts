/**
 * Unit tests for the storyboard-badge builder. Everything here asserts on the
 * SVG STRING (or the pure integer geometry) — never on rendered pixels — because
 * the whole reason this module exists is that its output can be checked exactly
 * without spawning sharp/ffmpeg. The load-bearing safety property is that no
 * control character (which crashes libvips' XML parser) can reach the SVG.
 */
import { describe, it, expect } from "vitest"
import {
  MAX_LABEL_CHARS,
  sanitizeCollageLabel,
  normalizeCollageLabels,
  resolveBadgePosition,
  collageBadgeTexts,
  fittedImageRect,
  layoutCollageBadge,
  sheetBadgeFontSize,
  buildCollageBadgesSvg,
} from "../collage-badges.js"

describe("sanitizeCollageLabel", () => {
  it("returns undefined for non-strings", () => {
    expect(sanitizeCollageLabel(undefined)).toBeUndefined()
    expect(sanitizeCollageLabel(null)).toBeUndefined()
    expect(sanitizeCollageLabel(42)).toBeUndefined()
    expect(sanitizeCollageLabel({})).toBeUndefined()
  })

  it("strips C0 control chars incl. NUL / 0x01 / 0x0B (VT)", () => {
    expect(sanitizeCollageLabel("a\u0000\u0001\u000Bb")).toBe("ab")
  })

  it("replaces tab/newline/CR with a space and collapses runs", () => {
    expect(sanitizeCollageLabel("a\tb\nc\rd")).toBe("a b c d")
    expect(sanitizeCollageLabel("a    b")).toBe("a b")
  })

  it("strips C1 controls and DEL", () => {
    expect(sanitizeCollageLabel("a\u007F\u0085b")).toBe("ab")
  })

  it("strips bidi format + zero-width controls", () => {
    expect(sanitizeCollageLabel("a\u202Eb")).toBe("ab") // RLO
    expect(sanitizeCollageLabel("a\u200Bb")).toBe("ab") // ZWSP
    expect(sanitizeCollageLabel("a\u2066b\u2069")).toBe("ab") // LRI/PDI
    expect(sanitizeCollageLabel("a\uFEFFb")).toBe("ab") // BOM
  })

  it("strips the BMP non-characters U+FFFE / U+FFFF (valid JS, invalid XML-1.0 Char)", () => {
    expect(sanitizeCollageLabel("Wide\uFFFFshot")).toBe("Wideshot")
    expect(sanitizeCollageLabel("\uFFFEa")).toBe("a")
  })

  it("strips unpaired surrogates", () => {
    expect(sanitizeCollageLabel("a\uD800b")).toBe("ab")
    expect(sanitizeCollageLabel("a\uDC00b")).toBe("ab")
  })

  it("keeps a valid surrogate pair (emoji) intact", () => {
    expect(sanitizeCollageLabel("hi \u{1F600}")).toBe("hi \u{1F600}")
  })

  it("returns undefined for empty / whitespace-only", () => {
    expect(sanitizeCollageLabel("")).toBeUndefined()
    expect(sanitizeCollageLabel("   ")).toBeUndefined()
    expect(sanitizeCollageLabel("\t\n")).toBeUndefined()
  })

  it("caps at MAX_LABEL_CHARS code points", () => {
    const out = sanitizeCollageLabel("x".repeat(200))
    expect(Array.from(out ?? "").length).toBe(MAX_LABEL_CHARS)
  })

  it("never splits a surrogate pair at the cap boundary", () => {
    // 79 ASCII then an emoji (2 UTF-16 units) → the 80th code point is the emoji
    // and must survive whole; the trailing 'z' is dropped.
    const out = sanitizeCollageLabel("y".repeat(79) + "\u{1F600}z")
    const cps = Array.from(out ?? "")
    expect(cps.length).toBe(MAX_LABEL_CHARS)
    expect(cps[79]).toBe("\u{1F600}")
  })
})

describe("collageBadgeTexts", () => {
  it("numbers only when numbered, 1-based", () => {
    expect(collageBadgeTexts(3, true)).toEqual(["1", "2", "3"])
  })

  it("labels only when not numbered", () => {
    expect(collageBadgeTexts(2, false, ["Wide", "Close-up"])).toEqual(["Wide", "Close-up"])
  })

  it("combines number and label as `N · label`", () => {
    expect(collageBadgeTexts(2, true, ["Wide", null])).toEqual(["1 · Wide", "2"])
  })

  it("treats null / empty / whitespace label as no label", () => {
    expect(collageBadgeTexts(3, false, [null, "", "   "])).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect(collageBadgeTexts(3, true, [null, "", "  "])).toEqual(["1", "2", "3"])
  })

  it("ignores extra labels and pads a short array with none", () => {
    expect(collageBadgeTexts(2, false, ["A", "B", "C"])).toEqual(["A", "B"])
    expect(collageBadgeTexts(2, false, ["A"])).toEqual(["A", undefined])
  })

  it("uses the ` · ` middot separator (U+00B7 with spaces)", () => {
    expect(collageBadgeTexts(1, true, ["X"])[0]).toBe("1 · X")
  })
})

describe("fittedImageRect", () => {
  it("centres a portrait image inside a landscape grid cell", () => {
    // 800x1200 portrait into a 1000x1000 cell: scale = 1000/1200 ≈ 0.833.
    const fitted = fittedImageRect({ w: 800, h: 1200 }, { x: 0, y: 0, w: 1000, h: 1000 })
    expect(fitted.h).toBe(1000)
    expect(fitted.w).toBe(667)
    expect(fitted.y).toBe(0)
    expect(fitted.x).toBe(166) // floor((1000-667)/2)
  })

  it("treats non-positive dimensions as 1 (no divide-by-zero → finite rect)", () => {
    // dw/dh coerced to 1, so scale = min(100/1, 100/1) = 100 → a finite square,
    // never NaN/Infinity from a 0 divisor.
    const fitted = fittedImageRect({ w: 0, h: 0 }, { x: 10, y: 20, w: 100, h: 100 })
    expect(Number.isFinite(fitted.w)).toBe(true)
    expect(fitted.w).toBe(100)
    expect(fitted.h).toBe(100)
  })
})

describe("layoutCollageBadge — geometry invariants", () => {
  it("clamps fontSize to the floor of 12", () => {
    // Narrow but tall: short=120 → round(10.8)=11 → clamped up to 12, and the
    // tall image leaves room so the shrink rule doesn't pull it back down.
    const g = layoutCollageBadge("1", { x: 0, y: 0, w: 120, h: 2000 }, 3000)
    expect(g?.fontSize).toBe(12)
  })

  it("clamps fontSize to the ceiling of round(canvasW*0.05)", () => {
    const g = layoutCollageBadge("1", { x: 0, y: 0, w: 4000, h: 4000 }, 1000)
    expect(g?.fontSize).toBe(50) // round(1000*0.05)
  })

  it("defaults to the TOP-LEFT corner: pill hugs the image's left edge, text anchored start", () => {
    const fitted = { x: 100, y: 200, w: 1000, h: 800 }
    const g = layoutCollageBadge("3 · Close-up", fitted, 3000)
    expect(g).toBeDefined()
    if (!g) return
    const margin = Math.round(g.fontSize * 0.35)
    expect(g.pillX).toBe(fitted.x + margin)
    expect(g.pillY).toBe(fitted.y + margin)
    expect(g.pillX + g.pillW).toBeLessThanOrEqual(fitted.x + fitted.w)
    expect(g.textAnchor).toBe("start")
    // text x sits at the pill's left padding, inside the pill
    expect(g.textX).toBe(g.pillX + Math.round(g.fontSize * 0.5))
    expect(g.textX).toBeLessThan(g.pillX + g.pillW)
  })

  it("top-right keeps the pill within the fitted rect at its right edge, text anchored end", () => {
    const fitted = { x: 100, y: 200, w: 1000, h: 800 }
    const g = layoutCollageBadge("3 · Close-up", fitted, 3000, undefined, "top-right")
    expect(g).toBeDefined()
    if (!g) return
    const margin = Math.round(g.fontSize * 0.35)
    expect(g.pillX + g.pillW).toBe(fitted.x + fitted.w - margin)
    expect(g.pillX).toBeGreaterThanOrEqual(fitted.x)
    expect(g.pillY).toBe(fitted.y + margin)
    expect(g.textAnchor).toBe("end")
    expect(g.textX).toBe(g.pillX + g.pillW - Math.round(g.fontSize * 0.5))
    expect(g.textX).toBeGreaterThan(g.pillX)
  })

  it("both corners share the same font size and pill size for the same text", () => {
    const fitted = { x: 0, y: 0, w: 1000, h: 800 }
    const l = layoutCollageBadge("7 · Two-shot", fitted, 3000, 40, "top-left")!
    const r = layoutCollageBadge("7 · Two-shot", fitted, 3000, 40, "top-right")!
    expect(l.fontSize).toBe(r.fontSize)
    expect(l.pillW).toBe(r.pillW)
    expect(l.pillH).toBe(r.pillH)
    expect(l.pillY).toBe(r.pillY)
  })

  it("keeps the pill height ≤ 35% of the fitted image height (small 4K-grid cell)", () => {
    // Smallest-cell stress: a 30-image 4K grid produces small fitted rects.
    for (const fitted of [
      { x: 0, y: 0, w: 600, h: 400 },
      { x: 0, y: 0, w: 240, h: 160 },
      { x: 0, y: 0, w: 180, h: 300 },
    ]) {
      const g = layoutCollageBadge("30 · A long-ish caption", fitted, 3840)
      if (g) expect(g.pillH).toBeLessThanOrEqual(0.35 * fitted.h)
    }
  })

  it("ellipsizes a long label but keeps the number, appending …", () => {
    const g = layoutCollageBadge("3 · " + "VeryLongLabel".repeat(6), { x: 0, y: 0, w: 300, h: 600 }, 3000)
    expect(g).toBeDefined()
    expect(g?.text.startsWith("3")).toBe(true)
    expect(g?.text.endsWith("…")).toBe(true)
  })

  it("skips (returns undefined) when even fontSize 8 can't fit the pill", () => {
    // 10px-tall fitted rect: 35% is 3.5px, far below the min pill height.
    expect(layoutCollageBadge("1", { x: 0, y: 0, w: 100, h: 10 }, 1000)).toBeUndefined()
  })
})

describe("buildCollageBadgesSvg", () => {
  const rects = [
    { x: 0, y: 0, w: 1000, h: 1000 },
    { x: 1000, y: 0, w: 1000, h: 1000 },
  ]
  const dims = [
    { w: 1000, h: 1000 },
    { w: 1000, h: 1000 },
  ]

  it("returns undefined when no text is defined (byte-identity no-badge path)", () => {
    expect(buildCollageBadgesSvg({ canvasW: 2000, canvasH: 2000, rects, dims, texts: [undefined, undefined] })).toBeUndefined()
  })

  it("returns undefined when a lone label is whitespace-only", () => {
    const texts = collageBadgeTexts(2, false, ["   ", "\t"])
    expect(buildCollageBadgesSvg({ canvasW: 2000, canvasH: 2000, rects, dims, texts })).toBeUndefined()
  })

  it("emits one <g>/<text>/<clipPath> per drawn badge", () => {
    const svg = buildCollageBadgesSvg({ canvasW: 2000, canvasH: 2000, rects, dims, texts: ["1 · A", "2"] })!
    expect(svg).toBeDefined()
    expect((svg.match(/<g /g) ?? []).length).toBe(2)
    expect((svg.match(/<text /g) ?? []).length).toBe(2)
    expect((svg.match(/<clipPath /g) ?? []).length).toBe(2)
    expect(svg).toContain('clip-path="url(#cb0)"')
    expect(svg).toContain('clip-path="url(#cb1)"')
  })

  it("skips the undefined entries (only defined texts draw)", () => {
    const svg = buildCollageBadgesSvg({ canvasW: 2000, canvasH: 2000, rects, dims, texts: [undefined, "2"] })!
    expect((svg.match(/<text /g) ?? []).length).toBe(1)
    expect(svg).toContain('clip-path="url(#cb1)"')
    expect(svg).not.toContain('url(#cb0)')
  })

  it("sets the svg root width/height/xmlns to the canvas", () => {
    const svg = buildCollageBadgesSvg({ canvasW: 2560, canvasH: 1920, rects, dims, texts: ["1", "2"] })!
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1920">')).toBe(true)
  })

  it("uses no dominant-baseline; explicit baseline + start anchor (top-left default) + preserved spaces", () => {
    const svg = buildCollageBadgesSvg({ canvasW: 2000, canvasH: 2000, rects, dims, texts: ["1 · A", "2"] })!
    expect(svg).not.toContain("dominant-baseline")
    expect(svg).toContain('text-anchor="start"')
    expect(svg).not.toContain('text-anchor="end"')
    expect(svg).toContain('xml:space="preserve"')
    expect(svg).toContain('font-weight="700"')
    expect(svg).toContain('font-family="DejaVu Sans, sans-serif"')
    expect(svg).toContain('fill="rgba(0,0,0,0.62)"')
  })

  it("XML-escapes & < > \" ' and never emits the raw label markup", () => {
    const texts = collageBadgeTexts(1, false, ["<a>&\"'"])
    const svg = buildCollageBadgesSvg({ canvasW: 2000, canvasH: 2000, rects, dims, texts })!
    expect(svg).toContain("&lt;a&gt;&amp;&quot;&apos;")
    expect(svg).not.toContain("<a>")
  })

  it("never lets a control char reach the SVG (libvips-crash guard)", () => {
    const texts = collageBadgeTexts(1, false, ["a\u0000\u0001\u000B\u202Eb"])
    const svg = buildCollageBadgesSvg({ canvasW: 2000, canvasH: 2000, rects, dims, texts })!
    expect(svg).toContain(">ab</text>")
    for (const bad of ["\u0000", "\u0001", "\u000B", "\u202E"]) {
      expect(svg.includes(bad)).toBe(false)
    }
  })

  it("renders a portrait image's badge inside its fitted rect within a landscape cell", () => {
    // Portrait 800x1200 letterboxed in a 1000x1000 grid cell → fitted w=667,
    // x-offset 166. The badge must sit within [166, 833], not the full cell.
    const g = layoutCollageBadge("1", fittedImageRect({ w: 800, h: 1200 }, { x: 0, y: 0, w: 1000, h: 1000 }), 2000)
    expect(g).toBeDefined()
    if (!g) return
    expect(g.pillX).toBeGreaterThanOrEqual(166)
    expect(g.pillX + g.pillW).toBeLessThanOrEqual(166 + 667)
  })
})

describe("sheetBadgeFontSize — one size for the whole sheet", () => {
  it("derives the base from the MEDIAN fitted short side, not the smallest", () => {
    // 12-frame 4K sheet: median short side ~700px, one narrow portrait at 380px.
    const rects = [
      ...Array.from({ length: 11 }, (_, i) => ({ x: 0, y: 0, w: 1200, h: 700 + i })),
      { x: 0, y: 0, w: 380, h: 800 },
    ]
    const size = sheetBadgeFontSize(rects, 3840)
    expect(size).toBe(Math.round(705.5 * 0.09))
  })

  it("has a canvas-relative floor (dense sheets stay legible after a downscale)", () => {
    const tiny = Array.from({ length: 30 }, () => ({ x: 0, y: 0, w: 216, h: 216 }))
    expect(sheetBadgeFontSize(tiny, 3840)).toBe(Math.round(3840 * 0.01))
    expect(sheetBadgeFontSize([], 3840)).toBe(Math.round(3840 * 0.01))
  })

  it("is capped at round(canvasW*0.05) for very large frames", () => {
    expect(sheetBadgeFontSize([{ x: 0, y: 0, w: 3000, h: 3000 }], 3840)).toBe(Math.round(3840 * 0.05))
  })

  it("makes every badge on a mixed-aspect sheet the same font size (only shrinking when a frame can't fit it)", () => {
    const rects = [
      { x: 0, y: 0, w: 1600, h: 900 },
      { x: 1624, y: 0, w: 450, h: 900 }, // narrow portrait beside a wide frame
      { x: 0, y: 924, w: 1000, h: 1000 },
    ]
    const dims = [
      { w: 1600, h: 900 },
      { w: 450, h: 900 },
      { w: 1000, h: 1000 },
    ]
    const svg = buildCollageBadgesSvg({ canvasW: 3840, canvasH: 2000, rects, dims, texts: ["1", "2", "3"] })!
    const sizes = [...svg.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]))
    expect(sizes).toHaveLength(3)
    expect(new Set(sizes).size).toBe(1)
    expect(sizes[0]).toBe(sheetBadgeFontSize(rects, 3840))
  })

  it("still shrinks an individual badge when the shared size cannot fit its frame", () => {
    const fitted = { x: 0, y: 0, w: 120, h: 60 }
    const g = layoutCollageBadge("12", fitted, 3840, 150)!
    expect(g.fontSize).toBeLessThan(150)
    expect(g.pillH).toBeLessThanOrEqual(0.35 * fitted.h)
  })
})

describe("normalizeCollageLabels — the wire-boundary normalization (route + payload builder)", () => {
  it("sanitizes every entry, null marks no caption", () => {
    expect(normalizeCollageLabels(["  Wide ", "", null, 7, "a\u0000b"])).toEqual(["Wide", null, null, null, "ab"])
  })

  it("returns undefined when nothing survives (so the key is omitted)", () => {
    expect(normalizeCollageLabels(["", "   ", null, "\u0000"])).toBeUndefined()
    expect(normalizeCollageLabels([])).toBeUndefined()
    expect(normalizeCollageLabels(undefined)).toBeUndefined()
  })

  it("trims extras past the limit", () => {
    expect(normalizeCollageLabels(["A", "B", "C"], 2)).toEqual(["A", "B"])
  })

  it("never lets a NUL reach the persisted array (JSONB rejects \\u0000)", () => {
    const out = normalizeCollageLabels(["x\u0000y"])!
    expect(JSON.stringify(out)).not.toContain("\\u0000")
  })
})

describe("badge position", () => {
  const rects = [{ x: 0, y: 0, w: 1000, h: 1000 }, { x: 1024, y: 0, w: 1000, h: 1000 }]
  const dims = [{ w: 1000, h: 1000 }, { w: 1000, h: 1000 }]

  it("resolveBadgePosition coerces anything but 'top-right' to the top-left default", () => {
    expect(resolveBadgePosition("top-right")).toBe("top-right")
    expect(resolveBadgePosition("top-left")).toBe("top-left")
    expect(resolveBadgePosition(undefined)).toBe("top-left")
    expect(resolveBadgePosition("bottom-left")).toBe("top-left")
    expect(resolveBadgePosition(42)).toBe("top-left")
  })

  it("position: top-right anchors every badge end and places pills at the right edge", () => {
    const svg = buildCollageBadgesSvg({ canvasW: 2024, canvasH: 1000, rects, dims, texts: ["1", "2"], position: "top-right" })!
    expect(svg).toContain('text-anchor="end"')
    expect(svg).not.toContain('text-anchor="start"')
    const xs = [...svg.matchAll(/<rect x="(\d+)"/g)].map((m) => Number(m[1]))
    // the second image's pill starts well into its cell (right-anchored), not at its left edge
    expect(xs[1]).toBeGreaterThan(1024 + 500)
  })

  it("the default (no position) is top-left", () => {
    const svg = buildCollageBadgesSvg({ canvasW: 2024, canvasH: 1000, rects, dims, texts: ["1", "2"] })!
    const xs = [...svg.matchAll(/<rect x="(\d+)"/g)].map((m) => Number(m[1]))
    expect(xs[1]).toBeLessThan(1024 + 100)
  })
})
