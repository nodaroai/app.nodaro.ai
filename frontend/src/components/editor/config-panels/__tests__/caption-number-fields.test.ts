import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CAPTION_MAX_WORDS_PER_LINE_MIN, CAPTION_MAX_WORDS_PER_LINE_MAX, CAPTION_LEVER_BOUNDS } from "@nodaro/shared/captions"
import { captionIntField, captionFontSizeDraft, CAPTION_STROKE_WIDTH_MAX } from "../processing-configs"

/**
 * The Add Captions panel's number fields (max words per line, outline width).
 * `min`/`max` on an <input type="number"> are advisory — the browser accepts a
 * typed 99 — but the route's Zod is not, so the panel coerces on write. A value
 * that only fails at generate-time, after credits reserve, is the trap this
 * closes (the FONT_FAMILY_AUTO rule's numeric sibling: never write a value the
 * route rejects into node data).
 */
describe("captionIntField", () => {
  const MIN = CAPTION_MAX_WORDS_PER_LINE_MIN
  const MAX = CAPTION_MAX_WORDS_PER_LINE_MAX

  it("an empty field is Auto — undefined, never 0 or NaN", () => {
    expect(captionIntField("", MIN, MAX)).toBeUndefined()
  })

  it("unparseable input is Auto rather than NaN in node data", () => {
    expect(captionIntField("-", MIN, MAX)).toBeUndefined()
    expect(captionIntField("abc", MIN, MAX)).toBeUndefined()
  })

  it("passes a value inside the lever's bounds through unchanged", () => {
    expect(captionIntField("3", MIN, MAX)).toBe(3)
    expect(captionIntField(String(MAX), MIN, MAX)).toBe(MAX)
  })

  it("clamps past either bound instead of writing a Zod-rejected value", () => {
    expect(captionIntField("99", MIN, MAX)).toBe(MAX)
    expect(captionIntField("0", MIN, MAX)).toBe(MIN)
  })

  it("keeps outline width 0 — 'no outline' is a real value, not empty", () => {
    expect(captionIntField("0", 0, CAPTION_STROKE_WIDTH_MAX)).toBe(0)
    expect(captionIntField("", 0, CAPTION_STROKE_WIDTH_MAX)).toBeUndefined()
    expect(captionIntField("999", 0, CAPTION_STROKE_WIDTH_MAX)).toBe(CAPTION_STROKE_WIDTH_MAX)
  })
})

/**
 * Font size was the one caption control that could still author a value the
 * route refuses: `min={8}` plus a raw parseInt wrote a 10 the canvas run 400s on
 * — while the orchestrator silently renders the same node at 12. One node, two
 * engines, two answers. The bounds are the shared lever table's, and the floor
 * is applied on COMMIT so typing "24" is not eaten digit by digit.
 */
describe("the font size field never authors a value the route rejects", () => {
  const { min, max } = CAPTION_LEVER_BOUNDS.fontSize

  it("clears to Auto on an empty or unparseable field", () => {
    expect(captionFontSizeDraft("")).toBeUndefined()
    expect(captionFontSizeDraft("abc")).toBeUndefined()
  })

  it("lets a half-typed value below the floor stand while typing", () => {
    // The first digit of "24". A live floor would snap it to 12 and the field
    // would read "124".
    expect(captionFontSizeDraft("2")).toBe(2)
  })

  it("holds the ceiling on every keystroke — the one bound a digit can cross", () => {
    expect(captionFontSizeDraft("2000")).toBe(max)
  })

  it("settles a below-floor value on commit, to the SHARED bound", () => {
    expect(captionIntField("10", min, max)).toBe(min)
    expect(min).toBe(12)
  })

  it("passes an in-range size through both ways", () => {
    expect(captionFontSizeDraft("48")).toBe(48)
    expect(captionIntField("48", min, max)).toBe(48)
  })

  // Structural: the control must advertise the same bounds it enforces. The
  // defect was a hand-typed `min={8}` next to a route that requires 12 (what
  // the field DOES with a typed value is covered in caption-lever-clearing).
  it("the input's own bounds come from the shared lever table", () => {
    const source = readFileSync(join(__dirname, "..", "processing-configs.tsx"), "utf8")
    expect(source).toMatch(/min=\{CAPTION_LEVER_BOUNDS\.fontSize\.min\}/)
    expect(source).toMatch(/max=\{CAPTION_LEVER_BOUNDS\.fontSize\.max\}/)
  })
})
