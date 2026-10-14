import { describe, it, expect } from "vitest"
import { captionAnchor, captionLookStyle, captionRowColors, captionWord } from "../caption-look"
import { CAPTION_EDGE_INSET } from "../overlay-position"
import { FONT_MAP, FONT_LOADED_WEIGHTS, withRtlFallback } from "../font-registry"
import { CAPTION_LOOK_IDS, CAPTION_LOOKS, resolveCaptionLook, DEFAULT_CAPTION_LOOK } from "@nodaro/shared/captions"

describe("captionAnchor", () => {
  it("edge-anchors the named top/bottom slots (block grows toward the frame centre, no clip)", () => {
    expect(captionAnchor("top")).toEqual({ top: CAPTION_EDGE_INSET.top, translate: "" })
    expect(captionAnchor("bottom")).toEqual({ bottom: CAPTION_EDGE_INSET.bottom, translate: "" })
  })
  it("center is a true centre", () => {
    expect(captionAnchor("center")).toEqual({ top: "50%", translate: "translateY(-50%)" })
  })
  it("positionY wins and centres the block at that % (any position)", () => {
    expect(captionAnchor("bottom", 65)).toEqual({ top: "65%", translate: "translateY(-50%)" })
    expect(captionAnchor("top", 0)).toEqual({ top: "0%", translate: "translateY(-50%)" })
  })
  it("clamps positionY to 0-100", () => {
    expect(captionAnchor("bottom", -10).top).toBe("0%")
    expect(captionAnchor("bottom", 150).top).toBe("100%")
  })
  it("NaN positionY falls back to the named slot", () => {
    expect(captionAnchor("center", Number.NaN)).toEqual({ top: "50%", translate: "translateY(-50%)" })
  })
})

describe("captionLookStyle", () => {
  it("returns an empty object when no lever is set (spread is a no-op)", () => {
    expect(captionLookStyle({})).toEqual({})
  })
  it("uppercase → textTransform", () => {
    expect(captionLookStyle({ uppercase: true })).toEqual({ textTransform: "uppercase" })
  })
  it("resolves a known font to its loaded family + RTL fallback", () => {
    expect(captionLookStyle({ fontFamily: "Montserrat" }).fontFamily).toBe(
      withRtlFallback(FONT_MAP["Montserrat"]),
    )
  })
  it("disables font-synthesis ONLY when a face is chosen (no faux-bold on single-weight faces)", () => {
    // Anton loads weight 400 only; the overlays request 700-900, so without
    // fontSynthesis:none Chrome would synthesise a faux-bold.
    expect(captionLookStyle({ fontFamily: "Anton" }).fontSynthesis).toBe("none")
    // Not present on the default path (byte-identical when no font is chosen).
    expect(captionLookStyle({}).fontSynthesis).toBeUndefined()
    expect(captionLookStyle({ uppercase: true }).fontSynthesis).toBeUndefined()
    expect(captionLookStyle({ strokeWidth: 4 }).fontSynthesis).toBeUndefined()
  })
  it("passes an unknown font name through (never hard-blocks a typo)", () => {
    expect(captionLookStyle({ fontFamily: "Nonesuch" }).fontFamily).toBe(withRtlFallback("Nonesuch"))
  })
  it("applies fontWeight when set, absent otherwise", () => {
    expect(captionLookStyle({ fontWeight: 900 }).fontWeight).toBe(900)
    expect(captionLookStyle({}).fontWeight).toBeUndefined()
  })
  it("stroke: width + default black, painted behind the glyph", () => {
    expect(captionLookStyle({ strokeWidth: 4 })).toMatchObject({
      WebkitTextStrokeWidth: "4px",
      WebkitTextStrokeColor: "#000000",
      paintOrder: "stroke fill",
    })
  })
  it("stroke honours an explicit colour", () => {
    expect(captionLookStyle({ strokeWidth: 6, strokeColor: "#112233" }).WebkitTextStrokeColor).toBe("#112233")
  })
  it("strokeWidth 0 / unset draws no outline", () => {
    expect(captionLookStyle({ strokeWidth: 0 })).toEqual({})
    expect(captionLookStyle({ strokeColor: "#000000" })).toEqual({})
  })
  it("highlightColor is not a container-level style (it is applied per-word by the overlays)", () => {
    expect(captionLookStyle({ highlightColor: "#ff0000" })).toEqual({})
  })
})

describe("CAPTION_LOOKS — every preset's font/weight is actually loaded (design-honesty guard)", () => {
  // captionLookStyle sets `fontSynthesis: none` whenever a face is chosen, so a
  // preset asking for a weight the face doesn't ship would render at the nearest
  // LOADED weight with NO faux-bold — silently wrong. Pin that every preset's
  // (fontFamily, fontWeight) pair is a weight the font-registry loads for it.
  it.each(CAPTION_LOOK_IDS)("look %s uses a loaded (face, weight)", (id) => {
    const levers = CAPTION_LOOKS[id](64)
    if (levers.fontFamily === undefined) return // no face pinned → nothing to load
    const loaded = FONT_LOADED_WEIGHTS[levers.fontFamily]
    expect(loaded, `${id} pins an unknown face "${levers.fontFamily}"`).toBeDefined()
    if (levers.fontWeight !== undefined) {
      expect(
        loaded.includes(levers.fontWeight),
        `${id} wants ${levers.fontFamily} ${levers.fontWeight}, but only ${loaded.join("/")} are loaded`,
      ).toBe(true)
    }
  })
})

describe("captionRowColors — spoken vs rest for karaoke / word-highlight", () => {
  it("with a highlight colour: rest is the FULL color (separate by hue), spoken is the highlight", () => {
    expect(captionRowColors("#ffffff", "#FFE600")).toEqual({ spoken: "#FFE600", rest: "#ffffff" })
    expect(captionRowColors("#ff3366", "#FFE600")).toEqual({ spoken: "#FFE600", rest: "#ff3366" })
  })
  it("without a highlight colour: rest is `color` dimmed toward black (separate by luminance), spoken is `color`", () => {
    expect(captionRowColors("#ffffff")).toEqual({ spoken: "#ffffff", rest: "color-mix(in srgb, #ffffff 55%, #000000)" })
    expect(captionRowColors("#ff3366")).toEqual({ spoken: "#ff3366", rest: "color-mix(in srgb, #ff3366 55%, #000000)" })
  })
})

describe("resolveCaptionLook — coerces, never throws (worker crash guard)", () => {
  // The orchestrator / authored-JSON / import / Copilot paths write `look` onto
  // node data with NO Zod validation. An out-of-vocabulary id must fall back to
  // the default preset, not throw a TypeError after a paid transcription.
  it("an unknown look id falls back to the default preset", () => {
    const bad = resolveCaptionLook("Outline" as never, {}, 64) // wrong case → not a valid id
    expect(bad).toEqual(resolveCaptionLook(DEFAULT_CAPTION_LOOK, {}, 64))
  })
  it("an empty-string look id also coerces to the default (no crash)", () => {
    expect(() => resolveCaptionLook("" as never, {}, 64)).not.toThrow()
    expect(resolveCaptionLook("" as never, {}, 64).fontFamily).toBe(CAPTION_LOOKS[DEFAULT_CAPTION_LOOK](64).fontFamily)
  })
  it("explicit levers still win over the coerced default", () => {
    expect(resolveCaptionLook("nonsense" as never, { highlightColor: "#abcabc" }, 64).highlightColor).toBe("#abcabc")
  })
})

describe("captionWord — inter-word spacing (Bug: glued word-level captions)", () => {
  it("the first word in a row has no leading space", () => {
    expect(captionWord("face", 0)).toBe("face")
  })
  it("bare word-level input (no delimiter) gets a single separating space", () => {
    // The reported failure: {text:"face"},{text:"doesn't"},{text:"drift."} rendered
    // as "facedoesn'tdrift." — each non-first word must carry one leading space.
    expect(captionWord("doesn't", 1)).toBe(" doesn't")
    expect(captionWord("drift.", 2)).toBe(" drift.")
  })
  it("delimited transcription input (leading space) is normalised to exactly one space", () => {
    expect(captionWord(" word", 1)).toBe(" word")
    expect(captionWord("  word  ", 3)).toBe(" word")
  })
  it("trims a delimiter off the first word too", () => {
    expect(captionWord(" word", 0)).toBe("word")
  })
  it("a full row joins into readable, single-spaced text", () => {
    const words = ["face", "doesn't", "drift.", "Not", "once."]
    expect(words.map((w, i) => captionWord(w, i)).join("")).toBe("face doesn't drift. Not once.")
  })
})
