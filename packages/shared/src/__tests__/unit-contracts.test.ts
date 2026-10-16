// @test-watches packages/shared/src/generated/unit-contracts.ts tools/units/__fixtures__/expected/packages/shared/src/generated/unit-contracts.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { UNIT_CONTRACTS } from "../generated/unit-contracts.js"

/**
 * What the node units may put in @nodaro/shared (decided 2026-10-16): a node
 * type id and its producer kind — the same grant the published producer sets
 * already make for every hand-written node. Never a price, a credit id, a
 * number, prompt or doctrine text: every published version of this package is
 * an irrevocable Apache grant, and those live in backend/ (prices, ee/) and
 * @nodaro/prompts (FSL). gen:units writes the file; this holds it to that.
 */
const SOURCE = readFileSync(path.resolve(__dirname, "../generated/unit-contracts.ts"), "utf8")
// The generator's golden for its fixture unit — a file WITH a row, so the line rule is proven on one.
const GOLDEN = readFileSync(path.resolve(__dirname, "../../../../tools/units/__fixtures__/expected/packages/shared/src/generated/unit-contracts.ts"), "utf8")

/** Problems with a contracts file's code lines (comments and blanks aside); [] when it holds only rows. */
function contractProblems(source: string): string[] {
  const code = source.split("\n").filter((l) => !l.trim().startsWith("//") && l.trim() !== "")
  const out: string[] = []
  if (!/^export const UNIT_CONTRACTS: ReadonlyArray<readonly \[type: string, producer: "audio" \| "video" \| "image" \| "dynamic"\]> = \[$/.test(code[0] ?? "")) out.push(`declaration: ${code[0]}`)
  if (code[code.length - 1] !== "]") out.push(`end: ${code[code.length - 1]}`)
  for (const line of code.slice(1, -1)) if (!/^ {2}\["[a-z][a-z0-9-]*", "(?:audio|video|image|dynamic)"\], \/\/ unit:[a-z][a-z0-9-]*$/.test(line)) out.push(`row: ${line}`)
  return out
}

describe("generated/unit-contracts.ts carries only [type, producer] rows", () => {
  it("every row is a kebab-case type id and a producer kind", () => {
    for (const row of UNIT_CONTRACTS) {
      expect(row).toHaveLength(2)
      expect(row[0]).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
      expect(["audio", "video", "image", "dynamic"]).toContain(row[1])
    }
    expect(new Set(UNIT_CONTRACTS.map(([t]) => t)).size).toBe(UNIT_CONTRACTS.length)
  })

  it("the file holds nothing else: one declaration and rows of two strings", () => {
    expect(contractProblems(SOURCE)).toEqual([])
  })

  it("the line rule accepts a real row and refuses a price, a credit id or prose", () => {
    expect(contractProblems(GOLDEN)).toEqual([])
    expect(contractProblems(GOLDEN.replace('"video"], // unit', '"video", 20], // unit'))).toHaveLength(1)
    expect(contractProblems(GOLDEN.replace("]\n", '  ["remove-audio:pro", "video"], // unit:remove-audio\n]\n'))).toHaveLength(1)
    expect(contractProblems(`${GOLDEN}export const PROMPT = "Write a poem"\n`)).not.toEqual([])
  })
})
