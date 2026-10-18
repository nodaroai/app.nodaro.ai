// @test-watches packages/shared/src/generated/unit-contracts.ts tools/units/__fixtures__/expected/packages/shared/src/generated/unit-contracts.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { UNIT_CONTRACTS, UNIT_JSON_PIPS, UNIT_NON_PROMPT_INPUTS, UNIT_PRESENTS, UNIT_REVIEW_HOLDS, UNIT_USE_CASE_TYPES } from "../generated/unit-contracts.js"

/**
 * What the node units may put in @nodaro/shared (decided 2026-10-16, widened
 * 2026-10-18): node type ids with closed vocabularies — the producer kind, the
 * use-case types, what a JSON pip carries, the non-prompt input pips, the
 * review holds and how a published app presents the result. Each replaces a
 * published hand-list. Never a price, a credit id, a number, prompt or
 * doctrine text: every published version of this package is an irrevocable
 * Apache grant, and those live in backend/ (prices, ee/) and @nodaro/prompts
 * (FSL). gen:units writes the file; this holds it to that.
 */
const SOURCE = readFileSync(path.resolve(__dirname, "../generated/unit-contracts.ts"), "utf8")
// The generator's golden for its fixture units — a file WITH rows, so the line rule is proven on one.
const GOLDEN = readFileSync(path.resolve(__dirname, "../../../../tools/units/__fixtures__/expected/packages/shared/src/generated/unit-contracts.ts"), "utf8")

const TYPE = "[a-z][a-z0-9-]*"
const ROW_END = `, \\/\\/ unit:${TYPE}$`
const PIP = `"[a-zA-Z][\\w-]*"`
/** The six declarations, in order, each with the one row shape its block may hold, and how the block ends. */
const DECLARATIONS: ReadonlyArray<{ readonly head: RegExp; readonly row: RegExp; readonly end: string }> = [
  {
    head: /^export const UNIT_CONTRACTS: ReadonlyArray<readonly \[type: string, producer: "audio" \| "video" \| "image" \| "dynamic"\]> = \[$/,
    row: new RegExp(`^ {2}\\["${TYPE}", "(?:audio|video|image|dynamic)"\\]${ROW_END}`),
    end: "]",
  },
  { head: /^export const UNIT_USE_CASE_TYPES = \[$/, row: new RegExp(`^ {2}"${TYPE}"${ROW_END}`), end: "] as const" },
  {
    head: /^export const UNIT_JSON_PIPS: ReadonlyArray<readonly \[type: string, pips: Readonly<Record<string, "transcript" \| "edl" \| "other">>\]> = \[$/,
    row: new RegExp(`^ {2}\\["${TYPE}", \\{ ${PIP}: "(?:transcript|edl|other)"(?:, ${PIP}: "(?:transcript|edl|other)")* \\}\\]${ROW_END}`),
    end: "]",
  },
  {
    head: /^export const UNIT_NON_PROMPT_INPUTS: ReadonlyArray<readonly \[type: string, handles: ReadonlyArray<string>\]> = \[$/,
    row: new RegExp(`^ {2}\\["${TYPE}", \\[${PIP}(?:, ${PIP})*\\]\\]${ROW_END}`),
    end: "]",
  },
  { head: /^export const UNIT_REVIEW_HOLDS: ReadonlyArray<string> = \[$/, row: new RegExp(`^ {2}"${TYPE}"${ROW_END}`), end: "]" },
  {
    head: /^export const UNIT_PRESENTS: ReadonlyArray<readonly \[type: string, presents: "image" \| "video" \| "audio" \| "text"\]> = \[$/,
    row: new RegExp(`^ {2}\\["${TYPE}", "(?:image|video|audio|text)"\\]${ROW_END}`),
    end: "]",
  },
]

/**
 * Problems with a contracts file's code lines (`//` comments and blanks aside —
 * a `/** … *\/` line is code, and refused); [] when it holds exactly the six
 * declarations, in order, each followed only by its own rows and its end line.
 */
function contractProblems(source: string): string[] {
  const code = source.split("\n").filter((l) => !l.trim().startsWith("//") && l.trim() !== "")
  const out: string[] = []
  let i = 0
  for (const d of DECLARATIONS) {
    if (!d.head.test(code[i] ?? "")) { out.push(`declaration: ${code[i]}`); return out }
    i++
    while (i < code.length && code[i] !== d.end && !code[i].startsWith("export ")) {
      if (!d.row.test(code[i])) out.push(`row: ${code[i]}`)
      i++
    }
    if (code[i] !== d.end) { out.push(`end: ${code[i]}`); return out }
    i++
  }
  for (const line of code.slice(i)) out.push(`after the declarations: ${line}`)
  // No digit outside a type id, a pip id or the comment tags: a price can never slip in.
  for (const line of code) if (/\d/.test(line.replace(new RegExp(`"[a-zA-Z][\\w-]*"|// unit:${TYPE}`, "g"), ""))) out.push(`digit: ${line}`)
  return out
}

describe("generated/unit-contracts.ts carries only type ids with closed vocabularies", () => {
  it("every row is a kebab-case type id and a closed-vocabulary value", () => {
    const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
    for (const row of UNIT_CONTRACTS) {
      expect(row).toHaveLength(2)
      expect(row[0]).toMatch(KEBAB)
      expect(["audio", "video", "image", "dynamic"]).toContain(row[1])
    }
    expect(new Set(UNIT_CONTRACTS.map(([t]) => t)).size).toBe(UNIT_CONTRACTS.length)
    for (const t of [...UNIT_USE_CASE_TYPES, ...UNIT_REVIEW_HOLDS, ...UNIT_JSON_PIPS.map(([x]) => x), ...UNIT_NON_PROMPT_INPUTS.map(([x]) => x), ...UNIT_PRESENTS.map(([x]) => x)]) expect(t).toMatch(KEBAB)
    for (const [, pips] of UNIT_JSON_PIPS) for (const v of Object.values(pips)) expect(["transcript", "edl", "other"]).toContain(v)
    for (const [, p] of UNIT_PRESENTS) expect(["image", "video", "audio", "text"]).toContain(p)
  })

  it("the file holds nothing else: the six declarations and their rows", () => {
    expect(contractProblems(SOURCE)).toEqual([])
  })

  it("the line rule accepts real rows and refuses a price, a credit id, prose or a doc comment", () => {
    expect(contractProblems(GOLDEN)).toEqual([])
    // A row in every block is accepted.
    const full = GOLDEN
      .replace("ReadonlyArray<string>]> = [\n", 'ReadonlyArray<string>]> = [\n  ["fixture-case", ["media"]], // unit:fixture-case\n')
      .replace("UNIT_REVIEW_HOLDS: ReadonlyArray<string> = [\n", 'UNIT_REVIEW_HOLDS: ReadonlyArray<string> = [\n  "fixture-case", // unit:fixture-case\n')
    expect(full).not.toBe(GOLDEN)
    expect(contractProblems(full)).toEqual([])
    const refused = [
      GOLDEN.replace('"video"], // unit', '"video", 20], // unit'),
      GOLDEN.replace("]\n", '  ["remove-audio:pro", "video"], // unit:remove-audio\n]\n'),
      `${GOLDEN}export const PROMPT = "Write a poem"\n`,
      GOLDEN.replace('  "fixture-case", // unit:fixture-case\n] as const', '  "fixture-case", 10, // unit:fixture-case\n] as const'),
      GOLDEN.replace('{ "json": "other" }', '{ "json": "other", "fee": 10 }'),
      full.replace('["fixture-case", ["media"]]', '["fixture-case", [10]]'),
      full.replace('  "fixture-case", // unit:fixture-case\n]\n\n', '  10, // unit:fixture-case\n]\n\n'),
      GOLDEN.replace('["fixture-case", "text"]', '["fixture-case", "text", 10]'),
      GOLDEN.replace("export const UNIT_USE_CASE_TYPES", "/** The use-case types. */\nexport const UNIT_USE_CASE_TYPES"),
    ]
    for (const [i, src] of refused.entries()) {
      expect(src, `case ${i} changed the golden`).not.toBe(GOLDEN)
      expect(contractProblems(src), `case ${i}`).not.toEqual([])
    }
  })
})
