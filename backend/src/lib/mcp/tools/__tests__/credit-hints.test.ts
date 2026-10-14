import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { creditsOf, creditHint, creditLadderHint, lipSyncPriceSuffix } from "../_credit-hint.js"
import { STATIC_CREDIT_COSTS } from "../../../../ee/billing/credits.js"
import { statedPrices } from "../../../../ee/billing/stated-prices.js"

// Audit 2026-09-06 fix #4 (A-1 / C-7, R2b-L2 — worse since June): credit
// figures typed by hand into tool descriptions were 10–12× off the pricing
// table ("kling-turbo (5s, 10 credits)" — the table says 110; "wav2lip (1 cr)"
// — 10; "kling-avatar (28 cr)" — 300 per 15 s). Every agent read a wrong price. The
// only number a description may carry is one derived from
// STATIC_CREDIT_COSTS at registration — the VIDEO_ANALYSIS_PRICING_HINT
// discipline — and this test is the tripwire on the literal.
describe("_credit-hint — derived credit figures", () => {
  it("states the CHARGED price, never the price-table row, and refuses an unknown id at registration", () => {
    const charged = statedPrices().credits("kling-turbo:5s")!
    expect(creditsOf("kling-turbo:5s")).toBe(charged)
    // The row is what the price table holds before the pricing settings apply — not what a run costs.
    expect(charged).toBeGreaterThan(STATIC_CREDIT_COSTS["kling-turbo:5s"] as number)
    expect(creditHint("latentsync")).toBe(`${statedPrices().credits("latentsync")} cr`)
    expect(() => creditsOf("not-a-model-id")).toThrow(/unknown credit id/)
  })

  it("prices a per-second lip-sync model at its charged 15 s bucket, a flat one at its charged price", () => {
    expect(lipSyncPriceSuffix("volcengine-lipsync")).toBe(` (${statedPrices().credits("volcengine-lipsync:15s")} cr/15s)`)
    expect(lipSyncPriceSuffix("latentsync")).toBe(` (${statedPrices().credits("latentsync")} cr)`)
  })

  it("renders a ladder of charged figures, one per id", () => {
    expect(creditLadderHint(["latentsync", "wav2lip"])).toBe(
      `${statedPrices().credits("latentsync")}/${statedPrices().credits("wav2lip")} credits`,
    )
  })

  it("names each figure's price id only when rendering the docs (NODARO_PRICE_ANNOTATIONS=1)", () => {
    const was = process.env.NODARO_PRICE_ANNOTATIONS
    try {
      process.env.NODARO_PRICE_ANNOTATIONS = "1"
      expect(creditHint("latentsync")).toBe(`${statedPrices().credits("latentsync")}<!-- credits: latentsync --> cr`)
      expect(lipSyncPriceSuffix("volcengine-lipsync")).toBe(
        ` (${statedPrices().credits("volcengine-lipsync:15s")}<!-- credits: volcengine-lipsync:15s --> cr/15s)`,
      )
    } finally {
      if (was === undefined) delete process.env.NODARO_PRICE_ANNOTATIONS
      else process.env.NODARO_PRICE_ANNOTATIONS = was
    }
    expect(creditHint("latentsync")).not.toContain("<!--")
  })
})

describe("tool descriptions carry no hand-typed credit figure", () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const toolsDir = resolve(here, "..")
  const LITERAL = /\b\d+(?:\.\d+)?\s*(?:cr|credits?)\b/g

  it("no `<number> cr|credit(s)` literal remains in backend/src/lib/mcp/tools/*.ts", () => {
    const offenders: string[] = []
    for (const file of readdirSync(toolsDir)) {
      if (!file.endsWith(".ts") || file === "_credit-hint.ts") continue
      const src = readFileSync(resolve(toolsDir, file), "utf8")
      src.split("\n").forEach((line, i) => {
        // Only string content counts: a comment may explain a price, a
        // description must derive it.
        const code = line.replace(/\/\/.*$/, "")
        if (LITERAL.test(code)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`)
        LITERAL.lastIndex = 0
      })
    }
    expect(offenders).toEqual([])
  })
})
