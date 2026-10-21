import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { creditsOf, creditHint, creditLadderHint, estimateHint, lipSyncPriceSuffix, meteredLlmPriceSentence } from "../_credit-hint.js"
import { config } from "../../../../lib/config.js"
import { STATIC_CREDIT_COSTS } from "../../../../ee/billing/credits.js"
import { statedPrices } from "../../../../ee/billing/stated-prices.js"
import { setLlmMeteredSchemaReadyForTesting } from "../../../llm-metered-schema-gate.js"
// What is measured is the hosted deployment, where metered LLM pricing is on (R33: its schema is applied).
setLlmMeteredSchemaReadyForTesting(true)

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

describe("estimateHint — a metered LLM call's typical figure", () => {
  it("states the server's estimate for the feature on the model, as approximate, never a tier price", () => {
    const quoted = statedPrices().credits("llm-chat:gemini-3.6-flash")!
    expect(quoted).toBeGreaterThan(0)
    expect(estimateHint("llm-chat", "gemini-3.6-flash")).toBe(`~${quoted} credits typical on Gemini 3.6 Flash`)
    // The default model when none is named — Choose Best's judge borrows pick-best-llm's.
    expect(estimateHint("reduce:pick-best-llm")).toBe(
      `~${statedPrices().credits("reduce:pick-best-llm:claude-sonnet-5.5")} credits typical on Claude Sonnet 5.5`,
    )
    // A default effort that serves direct is quoted on the direct key (Describe to Picker on Opus 5.5 at high).
    expect(estimateHint("describe-to-picker", "claude-opus-5.5")).toBe(
      `~${statedPrices().credits("describe-to-picker:claude-opus-5.5:direct")} credits typical on Claude Opus 5.5`,
    )
    expect(meteredLlmPriceSentence("prompt-helper", "claude-sonnet-4.6")).toBe(
      `Charged per token at the model's rate: ~${statedPrices().credits("prompt-helper:claude-sonnet-4.6")} credits typical on Claude Sonnet 4.6 (every model: docs/pricing/llm-models.md).`,
    )
  })

  it("names its price key only when rendering the docs (NODARO_PRICE_ANNOTATIONS=1)", () => {
    const was = process.env.NODARO_PRICE_ANNOTATIONS
    try {
      process.env.NODARO_PRICE_ANNOTATIONS = "1"
      expect(estimateHint("llm-chat", "gemini-3.6-flash")).toBe(
        `~${statedPrices().credits("llm-chat:gemini-3.6-flash")}<!-- credits: llm-chat:gemini-3.6-flash --> credits typical on Gemini 3.6 Flash`,
      )
    } finally {
      if (was === undefined) delete process.env.NODARO_PRICE_ANNOTATIONS
      else process.env.NODARO_PRICE_ANNOTATIONS = was
    }
  })

  it("never throws at registration: under the rollback, and for a model with no price, it names no figure", () => {
    const was = config.LLM_TIER_PRICING_ROLLBACK
    try {
      ;(config as { LLM_TIER_PRICING_ROLLBACK: boolean }).LLM_TIER_PRICING_ROLLBACK = true
      expect(estimateHint("llm-chat", "gemini-3.6-flash")).toBe("on Gemini 3.6 Flash, see docs/pricing/llm-models.md")
      // creditsOf cannot price a metered key at all — the reason estimateHint exists.
      expect(() => creditsOf("llm-chat:gemini-3.6-flash")).toThrow(/unknown credit id/)
    } finally {
      ;(config as { LLM_TIER_PRICING_ROLLBACK: boolean }).LLM_TIER_PRICING_ROLLBACK = was
    }
    expect(estimateHint("llm-chat", "not-a-model")).toBe("on not-a-model, see docs/pricing/llm-models.md")
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
