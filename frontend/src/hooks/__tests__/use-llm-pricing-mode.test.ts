/**
 * The editor's LLM pricing mode (`use-llm-pricing-mode`): learned from every
 * price answer — the batch (`prefetchModelCreditCosts`) and the single GET —
 * the LATEST answer winning, so a mid-session rollback (or its end) is followed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({ batch: vi.fn(), one: vi.fn() }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchBatchModelCreditCosts: (...a: unknown[]) => api.batch(...a),
  getModelCreditCost: (...a: unknown[]) => api.one(...a),
}))

import { queryClient } from "@/lib/query-client"
import { fetchModelCredits, forgetEstimateModels, forgetUnpricedModels, prefetchModelCreditCosts, refusedModelMessage } from "../use-model-credit-cost"
import { isMeteredLlmPriceKey, llmPricingMode, meteredPricingSeen } from "../use-llm-pricing-mode"

const KEY = "llm-chat:claude-opus-5.5"

beforeEach(() => {
  queryClient.clear()
  forgetUnpricedModels()
  forgetEstimateModels()
  api.batch.mockReset()
  api.one.mockReset()
})
afterEach(() => forgetEstimateModels())

describe("isMeteredLlmPriceKey", () => {
  it("a metered key names a known model (optionally `:direct`); a tier id or another composite does not", () => {
    expect(isMeteredLlmPriceKey(KEY)).toBe(true)
    expect(isMeteredLlmPriceKey(`${KEY}:direct`)).toBe(true)
    expect(isMeteredLlmPriceKey("reduce:pick-best-llm:claude-opus-5.5")).toBe(true)
    expect(isMeteredLlmPriceKey("llm-chat:premium")).toBe(false)
    expect(isMeteredLlmPriceKey("llm-chat")).toBe(false)
    expect(isMeteredLlmPriceKey("gpt-image:high")).toBe(false)
    expect(isMeteredLlmPriceKey("claude-opus-5.5")).toBe(false)
    // Only a feature the server meters: an unknown one would be `missing` under per-model pricing too.
    expect(isMeteredLlmPriceKey("unknown-feature:claude-opus-5.5")).toBe(false)
    expect(isMeteredLlmPriceKey("workflow-copilot:claude-opus-5.5")).toBe(false)
  })

  it("an id the server would not meter, answered missing, leaves the mode as it was", async () => {
    api.batch.mockResolvedValueOnce({ data: { [KEY]: 6 }, missing: [], estimates: [KEY] })
    await prefetchModelCreditCosts([KEY])
    api.batch.mockResolvedValueOnce({ data: {}, missing: ["unknown-feature:claude-opus-5.5"] })
    await prefetchModelCreditCosts(["unknown-feature:claude-opus-5.5"])
    expect(llmPricingMode()).toBe("metered")
  })
})

describe("the pricing mode, from the price answers", () => {
  it("unknown before any answer; metered on an estimate; tier when the next answer reports a metered key missing; metered again", async () => {
    expect(llmPricingMode()).toBe("unknown")
    api.batch.mockResolvedValueOnce({ data: { [KEY]: 6 }, missing: [], estimates: [KEY] })
    await prefetchModelCreditCosts([KEY])
    expect(llmPricingMode()).toBe("metered")
    expect(meteredPricingSeen()).toBe(true)
    // A rollback mid-session: a key not asked before comes back `missing`.
    api.batch.mockResolvedValueOnce({ data: { "llm-chat:premium": 3 }, missing: ["llm-chat:gpt-5.6-terra"] })
    await prefetchModelCreditCosts(["llm-chat:gpt-5.6-terra", "llm-chat:premium"])
    expect(llmPricingMode()).toBe("tier")
    expect(meteredPricingSeen()).toBe(false)
    // An answer about non-LLM ids leaves the mode as it was.
    api.batch.mockResolvedValueOnce({ data: {}, missing: ["gpt-image:high"] })
    await prefetchModelCreditCosts(["gpt-image:high"])
    expect(llmPricingMode()).toBe("tier")
    // The rollback ends.
    api.batch.mockResolvedValueOnce({ data: { "qa-check:claude-opus-5.5": 4 }, missing: [], estimates: ["qa-check:claude-opus-5.5"] })
    await prefetchModelCreditCosts(["qa-check:claude-opus-5.5"])
    expect(llmPricingMode()).toBe("metered")
  })

  it("a model refused for having no rate is metered pricing too, and its sentence is kept for the run totals", async () => {
    const message = 'The model "claude-opus-5.5" has no price yet, so it cannot be run. Choose another model.'
    api.batch.mockResolvedValueOnce({ data: {}, missing: [], errors: [KEY], errorCodes: { [KEY]: { code: "llm_model_unpriced", message } } })
    await prefetchModelCreditCosts([KEY])
    expect(llmPricingMode()).toBe("metered")
    expect(refusedModelMessage(KEY)).toBe(message)
  })

  it("the single GET answer says it too", async () => {
    api.one.mockResolvedValueOnce({ data: { creditCost: 6, estimate: true } })
    await fetchModelCredits(KEY)
    expect(llmPricingMode()).toBe("metered")
    api.one.mockResolvedValueOnce({ data: { creditCost: 3 } })
    await fetchModelCredits("llm-chat:gpt-5.6-terra")
    expect(llmPricingMode()).toBe("tier")
  })
})
