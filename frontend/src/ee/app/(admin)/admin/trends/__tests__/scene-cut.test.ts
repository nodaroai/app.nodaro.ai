/**
 * What a preview run keeps of the whole clip's scene description
 * (scene-cut.ts): the engine's own cut, mirrored for the admin to read.
 *
 * - Both shot-line formats, each kept in its own: whole seconds (start
 *   floored, end ceiled, within 0–4) and a shot list's tenths.
 * - A line across the window's start begins at 0, one across its end ends at
 *   4; lines outside are dropped; every other line stays where it was.
 * - The text is sent with the whole clip's window, so a ~5 s clip is cut too.
 * - A window past the last shot keeps only the other lines; a text with no
 *   shot line, or a clip that is the preview's window already, is kept.
 */
import { describe, expect, it } from "vitest"
import { lastShotEnd, previewCut, retimeSceneText, rewriteWindow, shotLineOf, textCoverage } from "../scene-cut"

const STORED =
  "A small kitchen with white tiles, warm light from a hood lamp.\nThe singer is a tall man in a red hoodie and jeans, short black hair. The dog is a brown terrier.\n0-3s: the singer turns to the counter, the camera pushes in.\n3-6s: the dog jumps up, a slow pan right.\n6-12s: the singer lifts the bottle, a fixed wide shot."
const LIST =
  "A beach at dusk.\n[0.0-1.2 s] wide; static; beach. The singer walks in.\n[1.2-3.4 s] close-up; handheld; beach. The bride smiles. The singer is not in this shot.\n[3.4-6.0 s] medium; pan left; beach. Both laugh."

describe("the engine's re-timing, mirrored", () => {
  it("reads both shot-line formats, and nothing else", () => {
    expect(shotLineOf("[1.2-3.4 s] close-up; static")).toMatchObject({ from: 1.2, to: 3.4, bracket: true })
    expect(shotLineOf("- [0.0–2.0s] wide")).toMatchObject({ from: 0, to: 2, bracket: true, prefix: "- " })
    expect(shotLineOf("0-2s: the singer turns.")).toMatchObject({ from: 0, to: 2, bracket: false })
    expect(shotLineOf("- 3–5 s: the dog sits.")).toMatchObject({ from: 3, to: 5, bracket: false, prefix: "- " })
    expect(shotLineOf("The singer is tall.")).toBeNull()
    expect(lastShotEnd(LIST)).toBe(6)
    expect(lastShotEnd("No shots.")).toBeNull()
  })

  it("whole seconds: the overlapping shots cut and re-based, the other lines kept; none to re-time is null", () => {
    expect(retimeSceneText(STORED, { fromSec: 3, toSec: 7 })).toBe(
      "A small kitchen with white tiles, warm light from a hood lamp.\nThe singer is a tall man in a red hoodie and jeans, short black hair. The dog is a brown terrier.\n0-3s: the dog jumps up, a slow pan right.\n3-4s: the singer lifts the bottle, a fixed wide shot.",
    )
    expect(retimeSceneText("- 0–2 s: a.\n- 2-5s: b.", { fromSec: 1.5, toSec: 5.5 })).toBe("- 0-1s: a.\n- 0-4s: b.")
    expect(retimeSceneText("0-3s: a.\n3-6s: b.", { fromSec: 2, toSec: 6 })).toBe("0-1s: a.\n1-4s: b.")
    expect(retimeSceneText("No shots here.", { fromSec: 0, toSec: 4 })).toBeNull()
  })

  it("a shot list: re-timed in tenths, its bracketed form kept", () => {
    expect(retimeSceneText(LIST, { fromSec: 1.0, toSec: 5.0 })).toBe(
      "A beach at dusk.\n[0.0-0.2 s] wide; static; beach. The singer walks in.\n[0.2-2.4 s] close-up; handheld; beach. The bride smiles. The singer is not in this shot.\n[2.4-4.0 s] medium; pan left; beach. Both laugh.",
    )
  })

  it("the whole clip's text is told by its shots running past the window; the same window is no re-timing", () => {
    expect(textCoverage(STORED, { fromSec: 3, toSec: 7 })).toEqual({ fromSec: 0, toSec: 12 })
    expect(textCoverage("0-4s: a.", { fromSec: 3, toSec: 7 })).toEqual({ fromSec: 3, toSec: 7 })
    expect(rewriteWindow({ fromSec: 0, toSec: 12 }, { fromSec: 3, toSec: 7 })).toEqual({ fromSec: 3, toSec: 7 })
    expect(rewriteWindow({ fromSec: 0, toSec: 4 }, { fromSec: 0, toSec: 4.3 })).toBeNull()
    expect(rewriteWindow({ fromSec: 0, toSec: 4 }, { fromSec: 0, toSec: 4.3 }, 0.05)).toEqual({ fromSec: 0, toSec: 4 })
  })
})

describe("previewCut", () => {
  it("keeps the setting and the people, and cuts the shots to the preview, re-timed to 0–4 s", () => {
    expect(previewCut(STORED, 3, 12)).toBe(retimeSceneText(STORED, { fromSec: 3, toSec: 7 }))
    expect(previewCut(STORED, 3, undefined)).toBe(retimeSceneText(STORED, { fromSec: 3, toSec: 7 }))
  })

  it("a fractional start: whole seconds floor the start and ceil the end, within 0–4", () => {
    // Window 2.5–6.5: a spans the start (begins at 0), c spans the end (ends at 4).
    expect(previewCut("A kitchen.\n0-3s: a.\n3-6s: b.\n6-12s: c.", 2.5, 12)).toBe("A kitchen.\n0-1s: a.\n0-4s: b.\n3-4s: c.")
  })

  it("a shot list: tenths, a line before the window dropped, one across its end ending at 4.0", () => {
    const full = "A beach.\n[0.0-2.5 s] wide. A.\n[2.5-5.3 s] close. B.\n[5.3-12.0 s] medium. C."
    expect(previewCut(full, 3, 12)).toBe("A beach.\n[0.0-2.3 s] close. B.\n[2.3-4.0 s] medium. C.")
    expect(previewCut(full, 2.5, 12)).toBe("A beach.\n[0.0-2.8 s] close. B.\n[2.8-4.0 s] medium. C.")
  })

  it("other lines stay in place: a line between shots stays where it was", () => {
    expect(previewCut("Setting.\n0-4s: a.\nThe dog leaves here.\n4-8s: b.\n8-12s: c.", 2, 12)).toBe("Setting.\n0-2s: a.\nThe dog leaves here.\n2-4s: b.")
  })

  it("a window past the last shot keeps only the other lines; nothing left is empty", () => {
    expect(previewCut("A kitchen.\nThe woman wears red.\n0-3s: a.\n3-7s: b.", 8, 12)).toBe("A kitchen.\nThe woman wears red.")
    expect(previewCut("0-3s: a.\n3-7s: b.", 8, 12)).toBe("")
  })

  it("no shot line, or a clip that is the preview's window already: kept as it is", () => {
    expect(previewCut("  A rainy rooftop at night.  ", 3, 12)).toBe("A rainy rooftop at night.")
    expect(previewCut("0-2s: a.\n2-4s: b.", 0, 4)).toBe("0-2s: a.\n2-4s: b.")
    // Within half a second for whole seconds; a shot list's tenths are told apart at 0.05 s.
    expect(previewCut("0-2s: a.\n2-4s: b.", 0, 4.3)).toBe("0-2s: a.\n2-4s: b.")
    expect(previewCut("[0.0-2.0 s] a.\n[2.0-4.3 s] b.", 0, 4.3)).toBe("[0.0-2.0 s] a.\n[2.0-4.0 s] b.")
  })

  it("a ~5 s clip is cut too: the whole clip's window is sent, never the preview's", () => {
    // A 5 s clip, preview from 1 s: its shots end within 1.5 s past 4 s, yet it is the whole clip's text.
    expect(previewCut("A kitchen.\n0-2s: a.\n2-5s: b.", 1, 5)).toBe("A kitchen.\n0-1s: a.\n1-4s: b.")
    expect(textCoverage("0-2s: a.\n2-5s: b.", { fromSec: 0, toSec: 5 })).toEqual({ fromSec: 0, toSec: 5 })
    expect(rewriteWindow({ fromSec: 0, toSec: 5 }, { fromSec: 1, toSec: 5 })).toEqual({ fromSec: 1, toSec: 5 })
  })
})
