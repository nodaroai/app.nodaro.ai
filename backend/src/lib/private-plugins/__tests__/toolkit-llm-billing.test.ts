import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() } }))
const { mockStructured } = vi.hoisted(() => ({ mockStructured: vi.fn() }))
vi.mock("../../llm-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../llm-client.js")>()),
  llmCompleteStructured: mockStructured,
}))

import { buildToolkit } from "../toolkit.js"
import { LlmSpend } from "../../llm-billing.js"
import { config } from "../../config.js"
import { setLlmMeteredSchemaReadyForTesting } from "../../llm-metered-schema-gate.js"

describe("toolkit.llmBilling", () => {
  it("toolkit.llmBilling exposes reserve/newSpend/settle/meteredPricing", async () => {
    const billing = buildToolkit().llmBilling!
    expect(typeof billing.reserve).toBe("function")
    expect(typeof billing.settle).toBe("function")
    expect(typeof billing.meteredPricing).toBe("function")
    const spend = billing.newSpend()
    expect(spend).toBeInstanceOf(LlmSpend)
    expect(spend.billedAnything).toBe(false)
    // A tier reservation is never settled metered.
    expect(await billing.settle("job", { metered: false }, spend)).toEqual({ outcome: "not-metered" })
    // A spend the host did not make is refused rather than settled.
    expect(() => billing.settle("job", { metered: false }, { add() {}, costUsd: 0, billedAnything: false })).toThrow(/newSpend/)
  })

  it("meteredPricing follows the host's switch", () => {
    const original = { edition: config.EDITION, rollback: config.LLM_TIER_PRICING_ROLLBACK }
    try {
      config.EDITION = "cloud"
      setLlmMeteredSchemaReadyForTesting(true)
      config.LLM_TIER_PRICING_ROLLBACK = false
      expect(buildToolkit().llmBilling!.meteredPricing()).toBe(true)
      config.LLM_TIER_PRICING_ROLLBACK = true
      expect(buildToolkit().llmBilling!.meteredPricing()).toBe(false)
    } finally {
      config.EDITION = original.edition
      setLlmMeteredSchemaReadyForTesting(undefined)
      config.LLM_TIER_PRICING_ROLLBACK = original.rollback
    }
  })

  it("554: toolkit.llmBilling.side — feature-detectable, reports unavailable under the rollback (plugins keep their fixed price)", async () => {
    const original = { edition: config.EDITION, rollback: config.LLM_TIER_PRICING_ROLLBACK }
    const call = { modelId: "claude-sonnet-5.5", request: { modelId: "claude-sonnet-5.5", system: "", messages: [] } }
    try {
      config.EDITION = "cloud"
      setLlmMeteredSchemaReadyForTesting(true)
      config.LLM_TIER_PRICING_ROLLBACK = false
      const side = buildToolkit().llmBilling!.side!
      expect(Object.keys(side).sort()).toEqual(["available", "creditsFor", "holdFor", "payerOf", "reserve"])
      expect(side.available()).toBe(true)
      config.LLM_TIER_PRICING_ROLLBACK = true
      // Read per call: the same toolkit answers the rollback at once.
      expect(side.available()).toBe(false)
      expect(await side.reserve({ jobId: "00000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000002", feature: "image-to-text", calls: [call], key: "take:1" }))
        .toMatchObject({ ok: false, code: "unavailable" })
      expect(await side.holdFor({ feature: "image-to-text", calls: [call] })).toBeUndefined()
      // A spend the host did not make is refused.
      expect(() => side.creditsFor("image-to-text:claude-sonnet-5.5", { add() {}, costUsd: 0, billedAnything: false })).toThrow(/newSpend/)
    } finally {
      config.EDITION = original.edition
      setLlmMeteredSchemaReadyForTesting(undefined)
      config.LLM_TIER_PRICING_ROLLBACK = original.rollback
    }
  })

  it("554: payerOf carries the request's resolved payer for the job's payload (never re-resolved by the worker)", () => {
    const ctx = { payer: "user", userId: "u1" }
    const req = { billingContext: ctx, isAppRun: true, webFreeMode: false, appAuthorization: { appKind: "community_instance" } } as never
    expect(buildToolkit().llmBilling!.side!.payerOf(req)).toEqual({ billingContext: ctx, isAppRun: true, webFreeMode: false, skipAutoRecharge: true, communityInstance: true })
    expect(buildToolkit().llmBilling!.side!.payerOf({} as never)).toEqual({})
  })

  it("a plugin's completeStructuredMetered result settles faithfully: lane + attempts ride it (I5)", async () => {
    const attempts = [
      { lane: "kie", modelId: "claude-opus-5.5", requestChars: 8000, inputTokens: 12, outputTokens: 500 },
      { lane: "direct-anthropic", modelId: "claude-opus-5.5", requestChars: 9000, inputTokens: 2300, outputTokens: 400, providerCost: 0.0172 },
    ]
    mockStructured.mockResolvedValueOnce({ output: { ok: 1 }, inputTokens: 2312, outputTokens: 900, providerCost: 0.0212, usageComplete: true, lane: "direct-anthropic", attempts })
    const tk = buildToolkit()
    const req = { model: "claude-opus-5.5", system: "s", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "q" }] }] }
    const result = await tk.llm.completeStructuredMetered!(req, {})
    expect(result).toMatchObject({ ok: true, lane: "direct-anthropic", attempts })
    const spend = tk.llmBilling!.newSpend()
    spend.add("claude-opus-5.5", { modelId: "claude-opus-5.5", system: "s", messages: req.messages }, { output: result as never })
    // KIE attempt from its request size (2000×1.6e-6 + 500×8e-6 = 0.0072) + the direct one's cost
    expect(spend.costUsd).toBeCloseTo(0.0072 + 0.0172, 12)

    // and a failure: its usage carries the attempts
    const { StructuredLlmError } = await import("../../llm/structured.js")
    mockStructured.mockRejectedValueOnce(new StructuredLlmError("bad", { inputTokens: 12, outputTokens: 500, complete: true, attempts: [attempts[0]!] as never }))
    const failed = await tk.llm.completeStructuredMetered!(req, {})
    expect(failed.ok).toBe(false)
    const spend2 = tk.llmBilling!.newSpend()
    spend2.add("claude-opus-5.5", { modelId: "claude-opus-5.5", system: "s", messages: req.messages }, { error: failed })
    expect(spend2.costUsd).toBeCloseTo(0.0072, 12)
  })

  it("completeStructuredMultimodal returns lane + attempts too", async () => {
    const attempts = [{ lane: "direct-gemini", modelId: "gemini-3.8-flash", requestChars: 10, inputTokens: 100, outputTokens: 10, providerCost: 0.0001 }]
    mockStructured.mockResolvedValueOnce({ output: { ok: 1 }, inputTokens: 100, outputTokens: 10, providerCost: 0.0001, lane: "direct-gemini", attempts })
    const out = await buildToolkit().llm.completeStructuredMultimodal({ model: "gemini-3.8-flash", messages: [{ role: "user", content: [{ type: "text", text: "q" }] }] }, {})
    expect(out).toEqual({ output: { ok: 1 }, providerCost: 0.0001, lane: "direct-gemini", attempts })
  })
})
