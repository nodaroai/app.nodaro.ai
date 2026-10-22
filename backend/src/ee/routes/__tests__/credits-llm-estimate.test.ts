// @test-units-by-name names no node type: it prices the metered LLM ids it names (CreditsService mocked)
/**
 * The metered LLM price keys on the two public price lookups (plan v2 Task 6):
 * `POST /v1/credits/model-costs` and `GET /v1/credits/model-cost`.
 *
 * A key `<feature>:<model>[:direct]` (`llmPriceKey`) is answered with its
 * estimate — the feature's typical call on the model's lane, marked up at its
 * charge id — and flagged as one (`estimates[]` / `estimate: true`). A fixed id
 * answers exactly as before. Under the rollback a metered key is priced nowhere
 * (`missing`, the D7 signal), and a model with no rate on its lane is reported
 * `llm_model_unpriced` — never priced 0.
 *
 * The price table is the real one (`chargedPriceTableFrom`, 10% markup); the
 * figures are Task 5's: Opus 5.5 llm-chat KIE 5 → 6, direct 12 → 14.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  rollback: { value: false },
  unpriced: new Set<string>(),
  getModelCreditCost: vi.fn(),
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/config.js")>()
  return {
    ...actual,
    hasCredits: () => true,
    isCloud: () => true,
    isCommunity: () => false,
    isBusiness: () => false,
    hasAdmin: () => true,
    hasOrganizations: () => true,
    llmMeteredPricing: () => !h.rollback.value,
  }
})

// A model is made unpriced by withholding its rates — the state the
// rate-coverage guard keeps out of production, which the API still answers.
vi.mock("@/lib/pricing/llm-cost.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/pricing/llm-cost.js")>()
  return { ...actual, hasLlmRate: (modelId: string, lane: never) => !h.unpriced.has(modelId) && actual.hasLlmRate(modelId, lane) }
})

const FIXED_ID = "nano-banana"
vi.mock("@/ee/billing/credits.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../billing/credits.js")>()
  return {
    ...actual,
    getChargedPriceTable: async () => actual.chargedPriceTableFrom(new Map([[FIXED_ID, 40]]), { cost_markup_percent: 10 } as never),
  }
})

vi.mock("@/ee/services/credits.js", () => ({
  CreditsService: { getModelCreditCost: h.getModelCreditCost },
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }))
vi.mock("@/middleware/credit-guard.js", () => ({ creditGuard: () => async () => {}, reserveCreditsForJob: vi.fn() }))
vi.mock("@/lib/private-plugins/load.js", () => ({ getPluginServices: () => ({ billing: undefined }) }))
vi.mock("@/lib/private-plugins/services-registry.js", () => ({ getPluginServices: () => ({ billing: undefined }) }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/deployment-payer.js", () => ({
  deploymentPayerActive: vi.fn(() => false),
  deploymentPayerId: vi.fn(() => null),
  allowanceEnforcementActive: vi.fn(() => false),
}))
vi.mock("@/ee/billing/deployment-allowance-service.js", () => ({ allowanceFor: vi.fn() }))
vi.mock("@/lib/use-case/inner-availability.js", () => ({ usecaseViewerEstimateFor: async () => ({}) }))

import { creditsRoutes } from "../credits.js"
import { PriceNotConfiguredError } from "../../billing/credits.js"

const OPUS = "llm-chat:claude-opus-5.5"
const OPUS_DIRECT = "llm-chat:claude-opus-5.5:direct"

let app: FastifyInstance

beforeEach(async () => {
  h.rollback.value = false
  h.unpriced.clear()
  h.getModelCreditCost.mockReset()
  app = Fastify({ logger: false })
  await app.register(async (instance) => {
    await creditsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const batch = (models: string[]) => app.inject({ method: "POST", url: "/v1/credits/model-costs", payload: { models } })
const single = (model: string) => app.inject({ method: "GET", url: `/v1/credits/model-cost?model=${encodeURIComponent(model)}` })

describe("POST /v1/credits/model-costs — metered LLM price keys", () => {
  it("batch: metered keys priced with estimates[], fixed ids unchanged", async () => {
    const res = await batch([OPUS, OPUS_DIRECT, FIXED_ID])
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data[OPUS]).toBe(6)
    expect(body.data[OPUS_DIRECT]).toBe(14)
    expect(body.data[FIXED_ID]).toBe(44)
    expect(body.estimates).toEqual([OPUS, OPUS_DIRECT])
    expect(body.missing).toEqual([])
    expect(body.errors).toEqual([])
    expect(body).not.toHaveProperty("errorCodes")
  })

  it("batch with only fixed ids has no estimates key (byte-identical to before)", async () => {
    const res = await batch([FIXED_ID, "mystery-model"])
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(JSON.stringify({ data: { [FIXED_ID]: 44 }, missing: ["mystery-model"], errors: [] }))
  })

  it("rollback answers metered ids as missing", async () => {
    h.rollback.value = true
    const res = await batch([OPUS, OPUS_DIRECT, FIXED_ID])
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(JSON.stringify({ data: { [FIXED_ID]: 44 }, missing: [OPUS, OPUS_DIRECT], errors: [] }))
  })

  it("unpriced model → errors[] names it, errorCodes[id].code llm_model_unpriced — never 0", async () => {
    h.unpriced.add("claude-opus-5.5")
    const res = await batch([OPUS, FIXED_ID, "llm-chat:gemini-3.8-flash"])
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toEqual({ [FIXED_ID]: 44, "llm-chat:gemini-3.8-flash": 2 })
    expect(body.data).not.toHaveProperty(OPUS)
    expect(body.missing).toEqual([])
    expect(body.errors).toEqual([OPUS])
    expect(body.errorCodes[OPUS].code).toBe("llm_model_unpriced")
    expect(body.errorCodes[OPUS].message).toMatch(/no price/)
    expect(body.estimates).toEqual(["llm-chat:gemini-3.8-flash"])
  })

  it("Advanced mode on a model without a direct lane is priced on its primary lane, not refused", async () => {
    const res = await batch(["llm-chat:gpt-5.2:direct", "llm-chat:gpt-5.2"])
    const body = res.json()
    expect(body.data["llm-chat:gpt-5.2:direct"]).toBe(body.data["llm-chat:gpt-5.2"])
    expect(body.data["llm-chat:gpt-5.2"]).toBeGreaterThan(0)
    expect(body.errors).toEqual([])
  })

  it("a bare key is priced at the default effort its run uses (Opus 5.5 at high on describe-to-picker runs direct)", async () => {
    const keys = [
      "describe-to-picker:claude-opus-5.5",
      "describe-to-picker:claude-opus-5.5:direct",
      "text-to-picker:claude-opus-5.5",
      "text-to-picker:claude-opus-5.5:direct",
      "llm-structured:claude-opus-5.5",
      "llm-structured:claude-opus-5.5:direct",
    ]
    const body = (await batch(keys)).json()
    expect(body.data["describe-to-picker:claude-opus-5.5"]).toBe(body.data["describe-to-picker:claude-opus-5.5:direct"])
    expect(body.data["text-to-picker:claude-opus-5.5"]).toBe(body.data["text-to-picker:claude-opus-5.5:direct"])
    // Generate Structured has no recipe effort: its bare key stays on KIE, below direct.
    expect(body.data["llm-structured:claude-opus-5.5"]).toBeLessThan(body.data["llm-structured:claude-opus-5.5:direct"])
  })

  it("a repeated id is listed once in estimates and errors", async () => {
    const priced = (await batch([OPUS, OPUS, FIXED_ID])).json()
    expect(priced.estimates).toEqual([OPUS])
    h.unpriced.add("claude-opus-5.5")
    const unpriced = (await batch([OPUS, OPUS])).json()
    expect(unpriced.errors).toEqual([OPUS])
    expect(Object.keys(unpriced.errorCodes)).toEqual([OPUS])
  })

  it("an id that only looks metered (unknown model) stays a plain missing id", async () => {
    const body = (await batch(["llm-chat:no-such-model"])).json()
    expect(body.missing).toEqual(["llm-chat:no-such-model"])
    expect(body).not.toHaveProperty("estimates")
  })
})

describe("GET /v1/credits/model-cost — metered LLM price keys", () => {
  it("GET metered key → estimate: true and Cache-Control no-store", async () => {
    const res = await single(OPUS_DIRECT)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { model: OPUS_DIRECT, creditCost: 14, estimate: true } })
    expect(res.headers["cache-control"]).toBe("no-store")
    expect(h.getModelCreditCost).not.toHaveBeenCalled()
  })

  it("a fixed id answers as before: no estimate flag, public cache", async () => {
    h.getModelCreditCost.mockResolvedValue(44)
    const res = await single(FIXED_ID)
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(JSON.stringify({ data: { model: FIXED_ID, creditCost: 44 } }))
    expect(res.headers["cache-control"]).toBe("public, max-age=3600, stale-while-revalidate=86400")
  })

  it("an unpriced model → 400 llm_model_unpriced, never creditCost 0", async () => {
    h.unpriced.add("claude-opus-5.5")
    const res = await single(OPUS)
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "validation_error", reason: "llm_model_unpriced", modelId: "claude-opus-5.5" })
    expect(res.headers["cache-control"]).toBe("no-store")
    expect(h.getModelCreditCost).not.toHaveBeenCalled()
  })

  it("under rollback a metered key takes today's path: priced nowhere (503 price_not_configured)", async () => {
    h.rollback.value = true
    h.getModelCreditCost.mockRejectedValue(new PriceNotConfiguredError(OPUS))
    const res = await single(OPUS)
    expect(res.statusCode).toBe(503)
    expect(h.getModelCreditCost).toHaveBeenCalledWith(OPUS)
    expect(res.headers["cache-control"]).toBeUndefined()
  })
})
