import { describe, expect, it } from "vitest"
import {
  CAPTION_SEGMENT_SCHEMA_KEYS,
  captionFontWeightSchema,
  captionSegmentInputSchema,
  findSegmentOverlap,
} from "../caption-segment-schema.js"

describe("the add-captions segment schema, shared by the route and both engines", () => {
  it("accepts a timed segment with its own text and levers", () => {
    const r = captionSegmentInputSchema.safeParse({ startMs: 0, endMs: 1200, text: "Sample line", style: "subtitle", look: "clean", positionY: 20, fontWeight: 800 })
    expect(r.success).toBe(true)
  })
  it("refuses an end at or before the start, blank text and a weight off the 100 grid", () => {
    expect(captionSegmentInputSchema.safeParse({ startMs: 500, endMs: 500 }).success).toBe(false)
    expect(captionSegmentInputSchema.safeParse({ startMs: 0, endMs: 10, text: "   " }).success).toBe(false)
    expect(captionFontWeightSchema.safeParse(850).success).toBe(false)
  })
  it("names exactly the route's segment fields", () => {
    expect([...CAPTION_SEGMENT_SCHEMA_KEYS].sort()).toEqual([
      "animate", "backgroundColor", "captions", "color", "endMs", "fontFamily", "fontSize", "fontWeight",
      "highlightColor", "look", "maxWordsPerLine", "position", "positionY", "startMs", "strokeColor",
      "strokeWidth", "style", "text", "uppercase",
    ])
  })
  it("finds an overlap and lets abutting segments pass", () => {
    expect(findSegmentOverlap([{ startMs: 0, endMs: 1000 }, { startMs: 1000, endMs: 2000 }])).toBeNull()
    expect(findSegmentOverlap([{ startMs: 900, endMs: 2000 }, { startMs: 0, endMs: 1000 }])).toBe("segments overlap: [0, 1000) and [900, 2000)")
  })
})
