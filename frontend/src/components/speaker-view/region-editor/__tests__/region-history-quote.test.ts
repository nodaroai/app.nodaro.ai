import { describe, it, expect } from "vitest"
import { initialHistory, isDirty, regionHistoryReducer as step, withBox } from "../region-history"
import { rawLabelOf, speakerQuote } from "../region-quote"

const A = { x: 0, y: 0, w: 0.5, h: 1 }
const B = { x: 0.5, y: 0, w: 0.5, h: 1 }

describe("the region editor's undo", () => {
  it("a drag is one step: checkpoint, then live moves", () => {
    let h = initialHistory(new Map([["k", A]]))
    h = step(h, { type: "checkpoint" })
    h = step(h, { type: "live", key: "k", region: { ...A, x: 0.1 } })
    h = step(h, { type: "live", key: "k", region: B })
    expect(h.present.get("k")).toEqual(B)
    expect(isDirty(h)).toBe(true)
    h = step(h, { type: "undo" })
    expect(h.present.get("k")).toEqual(A)
    expect(isDirty(h)).toBe(false)
    h = step(h, { type: "redo" })
    expect(h.present.get("k")).toEqual(B)
  })

  it("a new edit clears what could be redone; undo past the start does nothing", () => {
    let h = initialHistory(new Map())
    h = step(h, { type: "commit", boxes: withBox(h.present, "k", A) })
    h = step(h, { type: "undo" })
    h = step(h, { type: "commit", boxes: withBox(h.present, "k", B) })
    expect(step(h, { type: "redo" })).toBe(h)
    const start = step(step(h, { type: "undo" }), { type: "undo" })
    expect(start.present.size).toBe(0)
  })

  it("a press that moves nothing is no step: undo still undoes the last edit, redo survives", () => {
    let h = initialHistory(new Map([["k", A]]))
    h = step(h, { type: "commit", boxes: withBox(h.present, "k", B) })
    h = step(h, { type: "undo" })
    // A click on a box (select it, or press and let go): checkpoint, no move.
    h = step(h, { type: "checkpoint" })
    expect(h.future).toHaveLength(1)
    expect(h.past).toHaveLength(0)
    // A move to where the box already is is no move either.
    h = step(h, { type: "checkpoint" })
    h = step(h, { type: "live", key: "k", region: A })
    expect(h.past).toHaveLength(0)
    h = step(h, { type: "redo" })
    expect(h.present.get("k")).toEqual(B)
    h = step(h, { type: "checkpoint" })
    h = step(h, { type: "undo" })
    expect(h.present.get("k")).toEqual(A)
  })

  it("the step a drag takes is the state before its first real move", () => {
    let h = initialHistory(new Map([["k", A]]))
    h = step(h, { type: "checkpoint" })
    h = step(h, { type: "live", key: "k", region: A })
    h = step(h, { type: "live", key: "k", region: B })
    h = step(h, { type: "live", key: "k", region: { ...B, x: 0.4 } })
    expect(h.past).toHaveLength(1)
    h = step(h, { type: "undo" })
    expect(h.present.get("k")).toEqual(A)
  })

  it("is not dirty when an edit is put back by hand", () => {
    let h = initialHistory(new Map([["k", A]]))
    h = step(h, { type: "commit", boxes: withBox(h.present, "k", B) })
    h = step(h, { type: "commit", boxes: withBox(h.present, "k", A) })
    expect(isDirty(h)).toBe(false)
  })
})

describe("the speaker quote (SV15)", () => {
  const words = [
    { text: "Hi", startMs: 0, endMs: 100, speaker: "speaker_1" },
    ...Array.from({ length: 12 }, (_, i) => ({ text: `w${i}`, startMs: 1000 + i * 100, endMs: 1050 + i * 100, speaker: "speaker_0" })),
    { text: "Yes", startMs: 3000, endMs: 3100, speaker: "speaker_1" },
    { text: "Short", startMs: 4000, endMs: 4100, speaker: "speaker_0" },
  ]
  const transcript = JSON.stringify({ version: 1, words })
  const names = { speaker_0: "Host", speaker_1: "Guest" }

  it("quotes ten words of the turn, cut with …, matched by the name Camera Switch gave", () => {
    expect(speakerQuote(transcript, "Host", 0, names)).toBe("w0 w1 w2 w3 w4 w5 w6 w7 w8 w9…")
    expect(rawLabelOf("Host", names)).toBe("speaker_0")
  })

  it("stops at the next speaker without …, and starts from the given master time", () => {
    expect(speakerQuote(transcript, "Guest", 0, names)).toBe("Hi")
    expect(speakerQuote(transcript, "speaker_0", 3500)).toBe("Short")
  })

  it("maps the transcript's own clock through its source's offset", () => {
    const t = { version: 1, sourceId: "mic", words: [{ text: "Late", startMs: 0, endMs: 100, speaker: "A" }] }
    expect(speakerQuote(t, "A", 1000, undefined, () => 2000)).toBe("Late")
    expect(speakerQuote(t, "A", 1000, undefined, () => 0)).toBeUndefined()
  })

  it("is undefined without a transcript or the speaker's words", () => {
    expect(speakerQuote(undefined, "Host", 0)).toBeUndefined()
    expect(speakerQuote("{bad", "Host", 0)).toBeUndefined()
    expect(speakerQuote(transcript, "Producer", 0, names)).toBeUndefined()
    expect(rawLabelOf("Host", undefined)).toBeUndefined()
  })
})
