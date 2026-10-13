import { describe, expect, it } from "vitest"
import { translate } from "@/lib/i18n"
import { SCRIPT_EDIT_WORDS_EN, applyScriptLineEdits, scriptLines, scriptLinesEditable, type ScriptEditWords } from "../ugc-script-edit"

/** Placeholder limits, as the server hands them: the opening line's, a beat line's, the closing line's. */
const LIMITS = { hook: 12, beatLine: 20, closerLine: 16 } as const
const plan = { v: 1, hook: "Open", beats: [{ line: "One", x: { y: 1 } }, { line: "Two" }], closer: { line: "Close", z: 2 }, other: [1, 2] }

describe("the script editor touches only the public lines", () => {
  it("reads hook, beat lines and closer line", () => {
    expect(scriptLines(plan)).toEqual({ hook: "Open", beats: ["One", "Two"], closer: "Close" })
  })
  it("writes them and keeps every other key byte for byte", () => {
    const r = applyScriptLineEdits(plan, { hook: "Hi", beats: ["Uno", "Dos"], closer: "Bye" })
    expect(r).toEqual({ plan: { v: 1, hook: "Hi", beats: [{ line: "Uno", x: { y: 1 } }, { line: "Dos" }], closer: { line: "Bye", z: 2 }, other: [1, 2] } })
    expect(plan.hook).toBe("Open")
  })
  it("a blank or whitespace-only line is refused and the plan is unchanged", () => {
    expect(applyScriptLineEdits(plan, { hook: "  ", beats: ["One", "Two"], closer: "Close" })).toEqual({ error: "The opening line is empty." })
    expect(applyScriptLineEdits(plan, { hook: "Open", beats: ["One", "\t"], closer: "Close" })).toEqual({ error: "Beat 2's line is empty." })
  })
  it("never adds or removes a beat", () => {
    expect("error" in applyScriptLineEdits(plan, { hook: "Open", beats: ["One"], closer: "Close" })).toBe(true)
  })
})

describe("the script editor's refusals", () => {
  it("a blank closing line is refused too", () => {
    expect(applyScriptLineEdits(plan, { hook: "Open", beats: ["One", "Two"], closer: "\n " })).toEqual({ error: "The closing line is empty." })
  })

  it("a line is written as typed, and the copy shares nothing with the plan it came from", () => {
    const r = applyScriptLineEdits(plan, { hook: " Hi there ", beats: ["One", "Two"], closer: "Close" })
    if (!("plan" in r)) throw new Error("expected a plan")
    expect(r.plan.hook).toBe(" Hi there ")
    expect(r.plan.beats).not.toBe(plan.beats)
    expect((r.plan.beats as Array<{ x?: unknown }>)[0]!.x).not.toBe(plan.beats[0]!.x)
    expect(r.plan.other).not.toBe(plan.other)
    expect(plan).toEqual({ v: 1, hook: "Open", beats: [{ line: "One", x: { y: 1 } }, { line: "Two" }], closer: { line: "Close", z: 2 }, other: [1, 2] })
  })

  it("a plan whose beats or closing line are not objects is refused, never rebuilt", () => {
    const linesOnly = { error: SCRIPT_EDIT_WORDS_EN.linesOnly }
    expect(applyScriptLineEdits({ hook: "Open", beats: ["One"], closer: { line: "Close" } }, { hook: "Open", beats: ["One"], closer: "Close" })).toEqual(linesOnly)
    expect(applyScriptLineEdits({ hook: "Open", beats: [{ line: "One" }], closer: "Close" }, { hook: "Open", beats: ["One"], closer: "Close" })).toEqual(linesOnly)
    expect(applyScriptLineEdits({ hook: "Open", closer: { line: "Close" } }, { hook: "Open", beats: [], closer: "Close" })).toEqual(linesOnly)
  })

  it("only a plan whose beats and closing line are objects can be edited (the editor offers no Edit for another)", () => {
    expect(scriptLinesEditable(plan)).toBe(true)
    expect(scriptLinesEditable({ hook: "Open", beats: [], closer: { line: "Close" } })).toBe(true)
    expect(scriptLinesEditable({ hook: "Open", beats: ["One"], closer: { line: "Close" } })).toBe(false)
    expect(scriptLinesEditable({ hook: "Open", beats: [{ line: "One" }], closer: "Close" })).toBe(false)
    expect(scriptLinesEditable({ hook: "Open", closer: { line: "Close" } })).toBe(false)
  })

  it("the note for a script that cannot be edited says how to get one that can", () => {
    expect(SCRIPT_EDIT_WORDS_EN.linesOnly).toBe("This script can't be edited here. Turn off Keep this script, then run UGC Script to write a new one.")
  })

  it("says each refusal in the words it is given (the editor passes its own language's)", () => {
    const words: ScriptEditWords = {
      hookEmpty: "H", beatEmpty: (n) => `B${n}`, closerEmpty: "C", linesOnly: "L",
      hookTooLong: (max) => `HL${max}`, beatTooLong: (n, max) => `BL${n}:${max}`, closerTooLong: (max) => `CL${max}`,
    }
    expect(applyScriptLineEdits(plan, { hook: "", beats: ["One", "Two"], closer: "Close" }, words)).toEqual({ error: "H" })
    expect(applyScriptLineEdits(plan, { hook: "Open", beats: ["", "Two"], closer: "Close" }, words)).toEqual({ error: "B1" })
    expect(applyScriptLineEdits(plan, { hook: "Open", beats: ["One", "Two"], closer: "" }, words)).toEqual({ error: "C" })
    expect(applyScriptLineEdits(plan, { hook: "Open", beats: [], closer: "Close" }, words)).toEqual({ error: "L" })
    expect(applyScriptLineEdits(plan, { hook: "a".repeat(LIMITS.hook + 1), beats: ["One", "Two"], closer: "Close" }, words, LIMITS)).toEqual({ error: `HL${LIMITS.hook}` })
    expect(applyScriptLineEdits(plan, { hook: "Open", beats: ["One", "b".repeat(LIMITS.beatLine + 1)], closer: "Close" }, words, LIMITS)).toEqual({ error: `BL2:${LIMITS.beatLine}` })
    expect(applyScriptLineEdits(plan, { hook: "Open", beats: ["One", "Two"], closer: "c".repeat(LIMITS.closerLine + 1) }, words, LIMITS)).toEqual({ error: `CL${LIMITS.closerLine}` })
  })

  it("the English refusals are the dictionary's own sentences", () => {
    expect(SCRIPT_EDIT_WORDS_EN.hookEmpty).toBe(translate("en", "ugc.script.hookEmpty"))
    expect(SCRIPT_EDIT_WORDS_EN.beatEmpty(3)).toBe(translate("en", "ugc.script.beatEmpty", { n: 3 }))
    expect(SCRIPT_EDIT_WORDS_EN.closerEmpty).toBe(translate("en", "ugc.script.closerEmpty"))
    expect(SCRIPT_EDIT_WORDS_EN.linesOnly).toBe(translate("en", "ugc.script.linesOnly"))
    expect(SCRIPT_EDIT_WORDS_EN.hookTooLong(LIMITS.hook)).toBe(translate("en", "ugc.script.hookTooLong", { max: LIMITS.hook }))
    expect(SCRIPT_EDIT_WORDS_EN.beatTooLong(3, LIMITS.beatLine)).toBe(translate("en", "ugc.script.beatTooLong", { n: 3, max: LIMITS.beatLine }))
    expect(SCRIPT_EDIT_WORDS_EN.closerTooLong(LIMITS.closerLine)).toBe(translate("en", "ugc.script.closerTooLong", { max: LIMITS.closerLine }))
  })
})

describe("a line that only looks blank", () => {
  // Pasted or model-written text can carry invisible marks; deleting the visible words around one
  // leaves a field that looks empty. UGC Clips reads no word in such a line and refuses the plan
  // later, naming no line, so the editor refuses it here, with the line named.
  const INVISIBLE = ["\u200F", "\u200E", "\u061C", "\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF", "\u00AD", "\u202B\u202C", "\u2067\u2069", "\u034F", "\uFE0F", " \u200F\u200E\t"]
  it("holding only direction marks, zero-width spaces and joiners or word joiners, it is refused like an empty one", () => {
    for (const line of INVISIBLE) {
      const label = JSON.stringify(line)
      expect(applyScriptLineEdits(plan, { hook: line, beats: ["One", "Two"], closer: "Close" }), label).toEqual({ error: SCRIPT_EDIT_WORDS_EN.hookEmpty })
      expect(applyScriptLineEdits(plan, { hook: "Open", beats: [line, "Two"], closer: "Close" }), label).toEqual({ error: SCRIPT_EDIT_WORDS_EN.beatEmpty(1) })
      expect(applyScriptLineEdits(plan, { hook: "Open", beats: ["One", "Two"], closer: line }), label).toEqual({ error: SCRIPT_EDIT_WORDS_EN.closerEmpty })
    }
  })
  it("a word beside a mark, a price or a word beside an audio tag is a line, as UGC Clips reads it", () => {
    // U+3164 is invisible too, but a letter: UGC Clips reads it as a word, so it is not refused here either.
    for (const line of ["One", "\u200Fשלום", "סוף\u200F", "49 ₪", "[laughs] hi", "\u3164"]) {
      expect(applyScriptLineEdits(plan, { hook: "Open", beats: [line, "Two"], closer: "Close" }), JSON.stringify(line)).toHaveProperty("plan")
    }
  })
})

describe("a line longer than a script line can be", () => {
  // The limits are the plan schema's own, which the server hands the editor (`useUgcPlanLineLimits`);
  // the app holds no copy of them. Placeholders here.
  const E = SCRIPT_EDIT_WORDS_EN
  it("each line takes up to its limit, and one character more is refused with the line named", () => {
    expect(applyScriptLineEdits(plan, { hook: "a".repeat(LIMITS.hook), beats: ["b".repeat(LIMITS.beatLine), "Two"], closer: "c".repeat(LIMITS.closerLine) }, E, LIMITS)).toHaveProperty("plan")
    expect(applyScriptLineEdits(plan, { hook: "a".repeat(LIMITS.hook + 1), beats: ["One", "Two"], closer: "Close" }, E, LIMITS)).toEqual({ error: E.hookTooLong(LIMITS.hook) })
    expect(applyScriptLineEdits(plan, { hook: "Open", beats: ["One", "b".repeat(LIMITS.beatLine + 1)], closer: "Close" }, E, LIMITS)).toEqual({ error: E.beatTooLong(2, LIMITS.beatLine) })
    expect(applyScriptLineEdits(plan, { hook: "Open", beats: ["One", "Two"], closer: "c".repeat(LIMITS.closerLine + 1) }, E, LIMITS)).toEqual({ error: E.closerTooLong(LIMITS.closerLine) })
  })
  it("counts a line as typed, spaces included, the way the script's own check counts it", () => {
    expect(applyScriptLineEdits(plan, { hook: "a".repeat(LIMITS.hook - 1) + "  ", beats: ["One", "Two"], closer: "Close" }, E, LIMITS)).toEqual({ error: E.hookTooLong(LIMITS.hook) })
  })
  it("the refusal names the first line that is wrong, in the script's order", () => {
    expect(applyScriptLineEdits(plan, { hook: " ".repeat(LIMITS.hook + 5), beats: ["One", "Two"], closer: "Close" }, E, LIMITS)).toEqual({ error: E.hookEmpty })
    expect(applyScriptLineEdits(plan, { hook: "Open", beats: ["b".repeat(LIMITS.beatLine + 1), ""], closer: " " }, E, LIMITS)).toEqual({ error: E.beatTooLong(1, LIMITS.beatLine) })
  })
  it("with no limits from the server (an older plugin), no line is refused for its length: UGC Clips refuses it as before", () => {
    expect(applyScriptLineEdits(plan, { hook: "a".repeat(5_000), beats: ["b".repeat(5_000), "Two"], closer: "c".repeat(5_000) })).toHaveProperty("plan")
  })
})
