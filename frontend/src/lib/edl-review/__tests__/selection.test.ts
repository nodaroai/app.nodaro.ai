import { describe, it, expect } from "vitest"
import {
  extendSelection,
  isWordSelected,
  selectedWords,
  selectionCutMs,
  selectionRange,
  selectionRestoreMs,
  selectionText,
  selectionTouchesCut,
  startSelection,
} from "../selection"
import type { WordMark } from "../word-index"

const iv = (inMs: number, outMs: number) => ({ inMs, outMs })
const word = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs })
const WORDS = [word("So", 0, 200), word("the", 300, 500), word("um", 600, 800), word("thing", 900, 1200), word("is", 1300, 1500)]
const KEPT = { state: "kept" } as const
const CUT: WordMark = { state: "cut", reason: "filler", drop: 0 }

/**
 * The index-based selection (§2.3 of the inspectors design): the transcript is
 * virtualised, so a drag's anchor row can unmount; the selection is two word
 * indices, never a DOM Selection.
 */
describe("the word selection", () => {
  it("starts on one word, and extends to the focus in either direction", () => {
    const sel = startSelection(3)
    expect(selectedWords(sel)).toEqual({ first: 3, last: 3 })
    expect(selectedWords(extendSelection(sel, 1))).toEqual({ first: 1, last: 3 })
    expect(selectedWords(extendSelection(sel, 4))).toEqual({ first: 3, last: 4 })
    // Extending keeps the anchor: a shift-click after a drag moves the focus only.
    expect(extendSelection(extendSelection(sel, 4), 0)).toEqual({ anchor: 3, focus: 0 })
  })

  it("knows which words it highlights", () => {
    const sel = extendSelection(startSelection(3), 1)
    expect([0, 1, 2, 3, 4].map((i) => isWordSelected(sel, i))).toEqual([false, true, true, true, false])
  })

  it("copies the selected words' text from the model, in order", () => {
    expect(selectionText(extendSelection(startSelection(3), 1), WORDS)).toBe("the um thing")
  })

  it("its range is on the master clock, from the first word's start to the latest end", () => {
    expect(selectionRange(extendSelection(startSelection(1), 3), WORDS)).toEqual(iv(300, 1200))
    expect(selectionRange(startSelection(1), WORDS, 500)).toEqual(iv(800, 1000))
  })

  it("an index outside the transcript selects nothing", () => {
    expect(selectionRange(startSelection(9), WORDS)).toBeNull()
    expect(selectionText(startSelection(-1), WORDS)).toBe("")
  })

  it("offers Restore selection only when it touches a struck word (R10 a)", () => {
    const marks = [KEPT, KEPT, CUT, KEPT, KEPT]
    expect(selectionTouchesCut(extendSelection(startSelection(0), 1), marks)).toBe(false)
    expect(selectionTouchesCut(extendSelection(startSelection(1), 2), marks)).toBe(true)
    expect(selectionTouchesCut(startSelection(3), [KEPT, KEPT, KEPT, { state: "partial" }, KEPT])).toBe(true)
  })

  it("names the time Cut selection removes and Restore selection brings back", () => {
    // K keeps 0–550 and 850–1500: "um" (600–800) is already cut.
    const kept = [iv(0, 550), iv(850, 1500)]
    const sel = extendSelection(startSelection(1), 3)
    expect(selectionCutMs(sel, WORDS, kept)).toBe(250 + 350)
    expect(selectionRestoreMs(sel, WORDS, kept)).toBe(300)
  })
})
