import { describe, it, expect } from "vitest"
import {
  promptPartSeparator,
  joinPromptParts,
  applyPromptAffixes,
  resolvePrompt,
  computeNodePrompt,
  computeLlmChatFields,
} from "../resolve-prompt.js"

const M = new Map<string, string>()
const R = new Map([["Character", "Mira"], ["Hero", "a knight"]])

describe("promptPartSeparator", () => {
  it("inserts a space between two words", () => expect(promptPartSeparator("a", "b")).toBe(" "))
  it("no space when left ends with whitespace", () => expect(promptPartSeparator("a ", "b")).toBe(""))
  it("no space when left ends with a newline", () => expect(promptPartSeparator("a\n\n", "b")).toBe(""))
  it("no space when right starts with whitespace", () => expect(promptPartSeparator("a", " b")).toBe(""))
  it.each([",", ".", ";", ":", "!", "?", ")"])("no space when right starts with %s", (p) =>
    expect(promptPartSeparator("a", `${p} b`)).toBe(""))
})

describe("joinPromptParts (spec §4.2)", () => {
  it("prefix + core + comma-suffix", () =>
    expect(joinPromptParts(["Cinematic 35mm still of", "a woman in Tokyo", ", golden hour"]))
      .toBe("Cinematic 35mm still of a woman in Tokyo, golden hour"))
  it("keeps an author's trailing newlines", () =>
    expect(joinPromptParts(["RULES:\n- no text\n\n", "a red shoe", undefined])).toBe("RULES:\n- no text\n\na red shoe"))
  it("core + sentence suffix", () =>
    expect(joinPromptParts([undefined, "a red shoe", "Avoid clutter."])).toBe("a red shoe Avoid clutter."))
  it("drops blank parts", () => expect(joinPromptParts(["  ", "x", ""])).toBe("x"))
  it("all blank → empty string", () => expect(joinPromptParts(["", undefined, "  "])).toBe(""))
})

describe("applyPromptAffixes", () => {
  it("no affixes → returns the SAME core reference", () => {
    const core = "a red shoe"
    expect(applyPromptAffixes(core, undefined, M)).toBe(core)
    expect(applyPromptAffixes(core, {}, M)).toBe(core)
    expect(applyPromptAffixes(undefined, {}, M)).toBeUndefined()
  })
  it("whitespace-only affixes are a no-op", () => {
    const core = "x"
    expect(applyPromptAffixes(core, { prefix: "  ", suffix: "" }, M)).toBe(core)
  })
  it("wraps with the join rule", () =>
    expect(applyPromptAffixes("a woman in Tokyo", { prefix: "Cinematic 35mm still of", suffix: ", golden hour" }, M))
      .toBe("Cinematic 35mm still of a woman in Tokyo, golden hour"))
  it("resolves {Label} refs inside the affixes", () =>
    expect(applyPromptAffixes("", { prefix: "Portrait of {Character}" }, R)).toBe("Portrait of Mira"))
  it("empty core + affixes → the affixes alone", () =>
    expect(applyPromptAffixes(undefined, { prefix: "PRE", suffix: "POST" }, M)).toBe("PRE POST"))
  it("does not touch the core (no ref resolution, no trim)", () =>
    expect(applyPromptAffixes(" {Hero} ", { suffix: "S" }, R)).toBe(" {Hero} S"))
})

describe("resolvePrompt × affixes", () => {
  const A = { prefix: "PRE", suffix: "POST" }
  it("wraps the override", () =>
    expect(resolvePrompt({ override: "o", typed: ["t"], wired: "w", refMap: M, affixes: A })).toBe("PRE o POST"))
  it("wraps the typed winner", () =>
    expect(resolvePrompt({ typed: ["t"], wired: "w", refMap: M, affixes: A })).toBe("PRE t POST"))
  it("wraps the wired fallback", () =>
    expect(resolvePrompt({ typed: [""], wired: "w", refMap: M, affixes: A })).toBe("PRE w POST"))
  it("appendWired: wraps the COMBINED typed. wired core", () =>
    expect(resolvePrompt({ typed: ["t"], wired: "w", refMap: M, appendWired: true, affixes: A })).toBe("PRE t. w POST"))
  it("nothing + affixes → affixes alone", () =>
    expect(resolvePrompt({ typed: [], refMap: M, affixes: A })).toBe("PRE POST"))
  it("without affixes is byte-identical to before", () =>
    expect(resolvePrompt({ typed: ["x {Hero} y"], refMap: R })).toBe("x a knight y"))
})

describe("computeNodePrompt / computeLlmChatFields read affixes off data", () => {
  it("generate-image", () =>
    expect(computeNodePrompt("generate-image", { prompt: "typed", promptPrefix: "PRE", promptSuffix: "POST" }, { wired: "wire", refMap: M }))
      .toBe("PRE typed POST"))
  it("text-to-speech direct", () =>
    expect(computeNodePrompt("text-to-speech", { textSource: "direct", directText: "d", promptSuffix: "POST" }, { refMap: M }))
      .toBe("d POST"))
  it("llm-chat: userInput wrapped, systemPrompt never", () =>
    expect(computeLlmChatFields({ userInput: "u", systemPrompt: "s", promptPrefix: "PRE" }, { refMap: M }))
      .toEqual({ userInput: "PRE u", systemPrompt: "s" }))
})
