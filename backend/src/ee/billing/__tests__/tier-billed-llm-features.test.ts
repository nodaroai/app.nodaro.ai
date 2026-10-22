// @test-units-by-name names no node type: it holds the tier-billed LLM features out of every metered price resolver
import { describe, expect, it } from "vitest"
import { LLM_MODEL_IDS } from "@nodaro/shared/llm-models"
import { TIER_BILLED_LLM_FEATURES } from "@nodaro/render-rules"
import { METERED_LLM_FEATURES } from "../llm-typical-usage.js"
import { parseMeteredLlmId } from "../metered-llm-id.js"
import { chargedPriceTableFrom, isMeteredLlmQuoteId, meteredLlmQuote } from "../credits.js"
import { setLlmMeteredSchemaReadyForTesting } from "../../../lib/llm-metered-schema-gate.js"

/**
 * The one tier-billed set (`@nodaro/render-rules`): Workflow Copilot keeps its own ceilings, and
 * Content Recipe / Ideas bill their tier rows until their plugin meters. No metered resolver may
 * quote a per-model price for a call of theirs — the server charges it at its tier.
 */
describe("tier-billed LLM features are never metered", () => {
  it("METERED_LLM_FEATURES excludes every tier-billed feature", () => {
    for (const feature of TIER_BILLED_LLM_FEATURES) expect(METERED_LLM_FEATURES as readonly string[], feature).not.toContain(feature)
  })

  it("a `<feature>:<model>` key of theirs parses as no metered id and is quoted nowhere as an estimate", () => {
    setLlmMeteredSchemaReadyForTesting(true)
    try {
      const table = chargedPriceTableFrom(new Map(), { cost_markup_percent: 10 } as never)
      for (const feature of TIER_BILLED_LLM_FEATURES) {
        for (const modelId of LLM_MODEL_IDS) {
          for (const key of [`${feature}:${modelId}`, `${feature}:${modelId}:direct`]) {
            expect(parseMeteredLlmId(key), key).toBeNull()
            expect(isMeteredLlmQuoteId(key), key).toBe(false)
            expect(meteredLlmQuote(table, key), key).toBeNull()
          }
        }
      }
    } finally {
      setLlmMeteredSchemaReadyForTesting(undefined)
    }
  })
})
