/**
 * THE DOCS STATE THE CHARGED PRICE.
 *
 * `docs/` is the public reference, and a price there is read as what a run
 * costs. A figure copied from the price table (the row before the
 * deployment's pricing settings apply) is not that: the page said 30 for a job
 * charged 33. So every price figure in `docs/` names the price id it comes
 * from in an invisible annotation (`33 credits<!-- credits: ugc-finish -->`,
 * syntax in `scripts/lib/docs-prices.ts`), and this suite prices each one with
 * the server's own price-table rule (`chargedPriceTableFrom` + `chargedCredits`)
 * at the settings in `docs-price-settings.json`:
 *
 *   - an annotated figure that differs from its charged price fails;
 *   - a price figure with no annotation fails (so a new one cannot slip in
 *     unchecked) — `npm run docs:prices -- --fix` rewrites every annotated
 *     figure to its charged price after a reprice;
 *   - `npm run docs:prices -- --live <url>` holds the same figures to a running
 *     deployment, which is how the settings file is kept true.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The docs describe the hosted deployment, where speech is priced by length.
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, speechLengthPricingEnabled: () => true }
})

import { chargedCredits, chargedPriceTableFrom } from "../credits.js"
import {
  REPO_ROOT,
  annotationIds,
  docsPricing,
  findUnannotatedFigures,
  listDocPages,
  loadDocsPriceSettings,
  parseAnnotation,
  priceOf,
  readDocFigures,
  rewriteDocFigures,
  type DocFigure,
} from "../../../../scripts/lib/docs-prices.js"

/**
 * Pages whose figures are generated from text this suite does not own:
 * `docs/mcp/tool-parameters.md` is rendered from the MCP tools' own parameter
 * descriptions, which agents read on the wire and which say "list price".
 */
const NOT_CENSUSED = new Set(["docs/mcp/tool-parameters.md"])

const settings = loadDocsPriceSettings()
const table = chargedPriceTableFrom(new Map(), settings)
const { chargeOf, rateOf } = docsPricing(table, chargedCredits, settings.charged)
const pages = listDocPages()
const textOf = (file: string) => readFileSync(join(REPO_ROOT, file), "utf8")
const figures: DocFigure[] = pages.flatMap((file) => readDocFigures(file, textOf(file)))
const where = (f: DocFigure) => `${f.file}:${f.line} ${f.source}`

describe("every price figure in docs/ is the charged price", () => {
  it("the docs carry annotated figures (the reader finds them)", () => {
    expect(figures.length).toBeGreaterThan(100)
  })

  it("every annotated id is priced", () => {
    const unpriced = figures.filter((f) => f.annotation.kind !== "none" && priceOf(f.annotation, chargeOf, rateOf) === undefined)
    expect(unpriced.map(where), "annotated with an id that has no price").toEqual([])
  })

  it("every annotated figure equals its charged price", () => {
    const wrong = figures.flatMap((f) => {
      const charged = priceOf(f.annotation, chargeOf, rateOf)
      return charged === undefined || charged === f.figure ? [] : [`${where(f)}: page ${f.figure}, charged ${charged}`]
    })
    expect(wrong, "run `npm run docs:prices -- --fix` and re-read the sentence around each figure").toEqual([])
  })

  it("no price figure goes unannotated", () => {
    const loose = pages
      .filter((file) => !NOT_CENSUSED.has(file))
      .flatMap((file) => findUnannotatedFigures(file, textOf(file)))
      .map((u) => `${u.file}:${u.line} ${u.text}`)
    expect(loose, "annotate each with <!-- credits: <price id> --> (or n/a for a number that is not a price)").toEqual([])
  })

  it("the charged snapshot holds only ids the repo prices differently, and only ones the docs quote", () => {
    const quoted = new Set(figures.flatMap((f) => annotationIds(f.annotation)))
    for (const [id, value] of Object.entries(settings.charged)) {
      expect(chargedCredits(table, id), `"${id}" is priced the same without its snapshot entry — remove it`).not.toBe(value)
      expect(quoted.has(id), `"${id}" in the charged snapshot is quoted by no page — remove it`).toBe(true)
    }
  })
})

describe("the annotation reader", () => {
  it("binds the number before the comment, past a credits word, a unit suffix and bold", () => {
    const at = (line: string) => readDocFigures("x.md", line).map((f) => f.figure)
    expect(at("one finish job, 33 credits<!-- credits: ugc-finish -->.")).toEqual([33])
    expect(at("costs **1,200 credits**<!-- credits: dubbing -->")).toEqual([1200])
    expect(at("at 44 credits/sec<!-- credits-rate: x -->")).toEqual([44])
    expect(at("**11<!-- credits: a --> / 22<!-- credits: b --> credits**")).toEqual([11, 22])
    expect(() => readDocFigures("x.md", "no number <!-- credits: a -->")).toThrow(/follows no number/)
  })

  it("reads counts, units, sums, grouped charges, rates and n/a", () => {
    expect(parseAnnotation(false, "8*camera-switch")).toEqual({
      kind: "charge",
      charges: [{ count: 8, parts: [{ id: "camera-switch", units: 1 }] }],
    })
    expect(parseAnnotation(false, "elevenlabs-v4:per-100-chars@10")).toEqual({
      kind: "charge",
      charges: [{ count: 1, parts: [{ id: "elevenlabs-v4:per-100-chars", units: 10 }] }],
    })
    expect(parseAnnotation(false, "(image-overlay + 4)").kind).toBe("charge")
    expect(parseAnnotation(false, "(minimax-h3:8s@0.75 + 82.5)")).toEqual({
      kind: "charge",
      charges: [{ count: 1, parts: [{ id: "minimax-h3:8s", units: 0.75 }, { literal: 82.5, units: 1 }] }],
    })
    expect(parseAnnotation(false, "veo3.1 + 2*b@1.5").kind).toBe("charge")
    expect(parseAnnotation(true, "ltx-2.3-pro-extend:per-second")).toEqual({ kind: "rate", id: "ltx-2.3-pro-extend:per-second", units: 1 })
    expect(parseAnnotation(true, "elevenlabs-v4:per-100-chars@8")).toEqual({ kind: "rate", id: "elevenlabs-v4:per-100-chars", units: 8 })
    expect(parseAnnotation(false, "n/a")).toEqual({ kind: "none" })
    expect(() => parseAnnotation(false, "a - b")).toThrow()
    expect(() => parseAnnotation(false, "(12 + 3)")).toThrow(/names no price id/)
  })

  it("prices a whole-run charge once and separate charges each", () => {
    const fake = {
      base: (id: string) => ({ a: 1, b: 10 })[id],
      charge: (_id: string, credits: number) => Math.ceil((credits * 115) / 100),
    }
    const { chargeOf: c, rateOf: r } = docsPricing(fake, chargedCredits, {})
    // 12 units of a 1-credit row: one charge of 12 → 14, never 12 × 2.
    expect(priceOf(parseAnnotation(false, "a@12"), c, r)).toBe(14)
    expect(priceOf(parseAnnotation(false, "12*a"), c, r)).toBe(24)
    expect(priceOf(parseAnnotation(false, "b + a"), c, r)).toBe(12 + 2)
    // One charge of the row plus an amount: (10 + 2.5) → 13 → charged once, 15.
    expect(priceOf(parseAnnotation(false, "(b + 2.5)"), c, r)).toBe(15)
    expect(priceOf(parseAnnotation(true, "a"), c, r)).toBe(1.15)
    expect(priceOf(parseAnnotation(true, "a@8"), c, r)).toBe(9.2)
  })

  it("never scales or adds to a snapshot figure", () => {
    const fake = { base: () => 10, charge: (_id: string, credits: number) => credits }
    const { chargeOf: c, rateOf: r } = docsPricing(fake, chargedCredits, { s: 33 })
    expect(priceOf(parseAnnotation(false, "2*s"), c, r)).toBe(66)
    expect(() => priceOf(parseAnnotation(false, "s@2"), c, r)).toThrow(/snapshot/)
    expect(() => priceOf(parseAnnotation(false, "(s + 1)"), c, r)).toThrow(/snapshot/)
    expect(() => priceOf(parseAnnotation(true, "s"), c, r)).toThrow(/snapshot/)
  })

  it("--fix rewrites only the bound figures, keeping their grouping", () => {
    const text = "Costs 30 credits<!-- credits: x -->, 950<!-- credits: y --> and 1,000<!-- credits: z -->; 7 stays."
    const out = rewriteDocFigures(text, (a) => (a.kind === "charge" ? { x: 33, y: 1045, z: 1100 }[a.charges[0]!.parts[0]!.id!] : undefined))
    expect(out).toBe("Costs 33 credits<!-- credits: x -->, 1045<!-- credits: y --> and 1,100<!-- credits: z -->; 7 stays.")
  })

  it("flags an unannotated figure in prose and in a price column, not zero or code", () => {
    const page = [
      "Costs 30 credits per run.",
      "Free (0 credits), about 40 credits a second.",
      "| Model | Credits |",
      "|---|---|",
      "| a | 20 |",
      "| b | 22<!-- credits: b --> |",
      "```",
      "cost: 50 credits",
      "```",
    ].join("\n")
    expect(findUnannotatedFigures("x.md", page).map((u) => u.line)).toEqual([1, 5])
  })
})
