import { describe, it, expect } from "vitest"
import { alignCues } from "../aligner.js"
import type { AlignmentWord } from "../../../providers/elevenlabs/forced-alignment.js"

// helper: build alignment at 1 word/second
function align(words: string[]): AlignmentWord[] {
  return words.map((word, i) => ({ word, start: i, end: i + 1 }))
}

describe("alignCues", () => {
  it("matches a single-word cue at the right position", () => {
    const a = align(["ship", "faster", "with", "nodaro"])
    const { spans, warnings } = alignCues([{ id: "c1", text: "faster" }], a)
    expect(warnings).toEqual([])
    expect(spans.c1).toEqual({ startMs: 1000, endMs: 2000 })
  })

  it("matches a multi-word contiguous cue", () => {
    const a = align(["ship", "faster", "with", "nodaro"])
    const { spans } = alignCues([{ id: "c1", text: "ship faster" }], a)
    expect(spans.c1).toEqual({ startMs: 0, endMs: 2000 })
  })

  it("advances monotonically across cues in script order", () => {
    const a = align(["one", "two", "three", "four"])
    const { spans } = alignCues([{ id: "a", text: "two" }, { id: "b", text: "four" }], a)
    expect(spans.a).toEqual({ startMs: 1000, endMs: 2000 })
    expect(spans.b).toEqual({ startMs: 3000, endMs: 4000 })
  })

  it("binds the RIGHT occurrence of a repeated phrase via the cursor", () => {
    const a = align(["go", "now", "go", "now"])
    const { spans } = alignCues([{ id: "a", text: "go now" }, { id: "b", text: "go now" }], a)
    expect(spans.a).toEqual({ startMs: 0, endMs: 2000 })
    expect(spans.b).toEqual({ startMs: 2000, endMs: 4000 })
  })

  it("normalizes case and punctuation", () => {
    const a = align(["Hello,", "World!"])
    const { spans, warnings } = alignCues([{ id: "c1", text: "hello world" }], a)
    expect(warnings).toEqual([])
    expect(spans.c1).toEqual({ startMs: 0, endMs: 2000 })
  })

  it("matches a hyphenated word the aligner glued into one token", () => {
    // forced-alignment splits on whitespace only → "well-known" is ONE token
    const a: AlignmentWord[] = [{ word: "well-known", start: 0, end: 1 }, { word: "brand", start: 1, end: 2 }]
    const { spans, warnings } = alignCues([{ id: "c1", text: "well-known brand" }], a)
    expect(warnings).toEqual([])
    expect(spans.c1).toEqual({ startMs: 0, endMs: 2000 })
  })

  it("skips empty-normalized tokens (spaced punctuation)", () => {
    const a: AlignmentWord[] = [{ word: "stop", start: 0, end: 1 }, { word: "—", start: 1, end: 1.2 }, { word: "go", start: 2, end: 3 }]
    const { spans, warnings } = alignCues([{ id: "c1", text: "stop go" }], a)
    expect(warnings).toEqual([])
    expect(spans.c1).toEqual({ startMs: 0, endMs: 3000 })
  })

  it("falls back proportionally + warns on an unmatched cue", () => {
    const a = align(["alpha", "beta"]) // narration ends at 2000ms
    const { spans, warnings } = alignCues([{ id: "c1", text: "gamma" }], a)
    expect(warnings).toHaveLength(1)
    expect(spans.c1).toEqual({ startMs: 0, endMs: 2000 }) // index 0 of 1 → [0, 2000]
  })

  it("returns one warning per cue when alignment is empty", () => {
    const { spans, warnings } = alignCues([{ id: "c1", text: "x" }, { id: "c2", text: "y" }], [])
    expect(warnings).toHaveLength(2)
    expect(spans.c1).toEqual({ startMs: 0, endMs: 0 })
    expect(spans.c2).toEqual({ startMs: 0, endMs: 0 })
  })
})
