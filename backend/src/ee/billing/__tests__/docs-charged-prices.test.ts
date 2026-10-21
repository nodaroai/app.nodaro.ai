// @test-watches docs/**/*.{md,txt} docs/pricing/** frontend/src/nodes/** backend/src/nodes/**
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
 *     deployment, and `--live <url> --write` refreshes the settings file's
 *     `charged` snapshot from it.
 *
 * The same holds for the skills MCP agents read (`backend/skills/`, hand-written
 * figures annotated the same way) and for `docs/mcp/tool-parameters.md`,
 * rendered from the MCP tool descriptions: their credit hints are charged
 * prices too (`lib/mcp/tools/_credit-hint.ts`), annotated only in the render.
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The docs describe the hosted deployment, where speech is priced by length.
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, speechLengthPricingEnabled: () => true }
})

import { STATIC_CREDIT_COSTS, chargedCredits, chargedPriceTableFrom } from "../credits.js"
import { setLlmMeteredSchemaReadyForTesting } from "@/lib/llm-metered-schema-gate.js"
// What is measured is the hosted deployment, where metered LLM pricing is on (R33: its schema is applied).
setLlmMeteredSchemaReadyForTesting(true)
import { BUILD_ASSETS } from "../../../../scripts/copy-build-assets.mjs"
import { LLM_RATE_TABLE_PAGE, renderLlmRateTable } from "../../../../scripts/gen-llm-rate-table.js"
import { METERED_LLM_FEATURES } from "../llm-typical-usage.js"
import { effectiveMarkupPercent } from "../service-margin.js"
import {
  REPO_ROOT,
  annotationIds,
  docsPricing,
  llmFigurePricing,
  findUnannotatedFigures,
  listPricedPages,
  loadDocsPriceSettings,
  parseAnnotation,
  priceOf,
  readDocFigures,
  rewriteDocFigures,
  type DocFigure,
} from "../../../../scripts/lib/docs-prices.js"

const settings = loadDocsPriceSettings()
const table = chargedPriceTableFrom(new Map(), settings)
const { chargeOf, rateOf } = docsPricing(table, chargedCredits, settings.charged)
const llmOf = llmFigurePricing(settings)
const pages = listPricedPages()
const textOf = (file: string) => readFileSync(join(REPO_ROOT, file), "utf8")
const figures: DocFigure[] = pages.flatMap((file) => readDocFigures(file, textOf(file)))
const where = (f: DocFigure) => `${f.file}:${f.line} ${f.source}`

describe("every price figure in docs/ is the charged price", () => {
  it("the docs carry annotated figures (the reader finds them)", () => {
    expect(figures.length).toBeGreaterThan(100)
  })

  it("every annotated id is priced", () => {
    const unpriced = figures.filter((f) => f.annotation.kind !== "none" && priceOf(f.annotation, chargeOf, rateOf, llmOf) === undefined)
    expect(unpriced.map(where), "annotated with an id that has no price").toEqual([])
  })

  it("every annotated figure equals its charged price", () => {
    const wrong = figures.flatMap((f) => {
      const charged = priceOf(f.annotation, chargeOf, rateOf, llmOf)
      return charged === undefined || charged === f.figure ? [] : [`${where(f)}: page ${f.figure}, charged ${charged}`]
    })
    expect(wrong, "run `npm run docs:prices -- --fix` and re-read the sentence around each figure").toEqual([])
  })

  it("no price figure goes unannotated", () => {
    const loose = pages
      .flatMap((file) => findUnannotatedFigures(file, textOf(file)))
      .map((u) => `${u.file}:${u.line} ${u.text}`)
    expect(loose, "annotate each with <!-- credits: <price id> --> (or n/a for a number that is not a price)").toEqual([])
  })

  it("the charged snapshot holds only ids the repo prices differently, and a plugin-priced one only while a page quotes it", () => {
    const quoted = new Set(figures.flatMap((f) => annotationIds(f.annotation)))
    for (const [id, value] of Object.entries(settings.charged)) {
      expect(chargedCredits(table, id), `"${id}" is priced the same without its snapshot entry — remove it`).not.toBe(value)
      // A repo-priced id whose deployed price differs is kept for every surface that states it (bands
      // in the skills, MCP hints); one the repo cannot price at all is there for the pages that quote it.
      if (STATIC_CREDIT_COSTS[id] === undefined) {
        expect(quoted.has(id), `"${id}" in the charged snapshot is priced only by a plugin and quoted by no page — remove it`).toBe(true)
      }
    }
  })

  it("the settings ship next to the compiled billing module (the MCP hints read them at runtime)", () => {
    const asset = BUILD_ASSETS.find((a) => a.dir === "ee/billing")
    expect(asset, "add docs-price-settings.json to BUILD_ASSETS in scripts/copy-build-assets.mjs").toBeDefined()
    expect(asset!.match.test("docs-price-settings.json")).toBe(true)
  })
})

describe("the per-model LLM rate table (docs/pricing/llm-models.md)", () => {
  it("is the generator's output for the current rates and settings", () => {
    expect(textOf(LLM_RATE_TABLE_PAGE), "run: cd backend && npx tsx scripts/gen-llm-rate-table.ts").toBe(renderLlmRateTable(settings))
  })

  it("states charged credits per million tokens: Claude Fable 5 output on the aggregator is 11,000", () => {
    // usdToCredits(20) = 10000 base → applyMarkupPercent(10000, 10) = ceil(10000 × 1.1) = 11000
    expect(llmOf({ kind: "per-million", modelId: "claude-fable-5", lane: "kie", direction: "output", band: "base" })).toBe(11000)
    expect(textOf(LLM_RATE_TABLE_PAGE)).toContain("11,000<!-- credits-llm-rate: claude-fable-5:kie:output -->")
  })

  it("prices a call as the metered settle does: summed, floored at the minimum, charged once", () => {
    // Fable on the aggregator, 2,000 in / 2,000 out = 0.048 USD → 24 base → 27 (the plan's settle figure)
    expect(llmOf({ kind: "call", modelId: "claude-fable-5", lane: "kie", inputTokens: 2000, outputTokens: 2000 })).toBe(27)
    // A first attempt of 2,667 in at the 32,768-token output cap: 368 on the aggregator (the hold), 917 direct.
    expect(llmOf({ kind: "call", modelId: "claude-fable-5", lane: "kie", inputTokens: 2667, outputTokens: 32768 })).toBe(368)
    expect(llmOf({ kind: "call", modelId: "claude-fable-5", lane: "direct", inputTokens: 2667, outputTokens: 32768 })).toBe(917)
    // 0.004 USD → 2 base → 3 (the plan's stopped-stream figure)
    expect(llmOf({ kind: "call", modelId: "claude-sonnet-5.5", lane: "kie", inputTokens: 1000, outputTokens: 800 })).toBe(3)
    // A call that computed next to nothing is charged the floor: 1 base → 2
    expect(llmOf({ kind: "call", modelId: "gemini-3-flash", lane: "kie", inputTokens: 1, outputTokens: 1 })).toBe(2)
    // A lane with no rate of its own is priced nowhere (gemini-4-argon never runs on the aggregator).
    expect(llmOf({ kind: "call", modelId: "gemini-4-argon", lane: "kie", inputTokens: 1, outputTokens: 1 })).toBeUndefined()
  })

  it("every metered feature is charged at the global setting the table states (no metered feature has a margin of its own)", () => {
    // Workflow Copilot keeps its own pricing (D4): a tier-billed feature, not in METERED_LLM_FEATURES.
    const own = METERED_LLM_FEATURES.filter(
      (f) => effectiveMarkupPercent(settings, `${f}:claude-fable-5`) !== settings.cost_markup_percent,
    )
    expect(own, "a feature with its own margin is not charged the table's rates — state its rates or drop the margin").toEqual([])
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

  it("reads credits-llm-rate figures: per million tokens (base and long band) and one call's usage", () => {
    expect(readDocFigures("x.md", "| 11,000<!-- credits-llm-rate: claude-fable-5:kie:output --> |")[0]!.annotation).toEqual({
      kind: "llm",
      figure: { kind: "per-million", modelId: "claude-fable-5", lane: "kie", direction: "output", band: "base" },
    })
    expect(parseAnnotation("llm-rate", "gemini-3.1-pro:direct:input:long")).toEqual({
      kind: "llm",
      figure: { kind: "per-million", modelId: "gemini-3.1-pro", lane: "direct", direction: "input", band: "long" },
    })
    expect(parseAnnotation("llm-rate", "claude-fable-5:direct@2667/32768")).toEqual({
      kind: "llm",
      figure: { kind: "call", modelId: "claude-fable-5", lane: "direct", inputTokens: 2667, outputTokens: 32768 },
    })
    expect(() => parseAnnotation("llm-rate", "claude-fable-5:premium:output")).toThrow(/credits-llm-rate/)
    expect(() => parseAnnotation("llm-rate", "n/a")).toThrow(/credits-llm-rate/)
  })

  it("holds a credits-llm-rate figure to the rule (a wrong one is caught, --fix rewrites it)", () => {
    const [wrong] = readDocFigures("x.md", "costs 28 credits<!-- credits-llm-rate: claude-fable-5:kie@2000/2000 -->")
    expect(priceOf(wrong!.annotation, chargeOf, rateOf, llmOf)).toBe(27)
    expect(wrong!.figure).toBe(28)
    // Without the LLM evaluator it is priced nowhere — never silently "correct".
    expect(priceOf(wrong!.annotation, chargeOf, rateOf)).toBeUndefined()
    const fixed = rewriteDocFigures("costs 28 credits<!-- credits-llm-rate: claude-fable-5:kie@2000/2000 -->", (a) => priceOf(a, chargeOf, rateOf, llmOf))
    expect(fixed).toBe("costs 27 credits<!-- credits-llm-rate: claude-fable-5:kie@2000/2000 -->")
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
