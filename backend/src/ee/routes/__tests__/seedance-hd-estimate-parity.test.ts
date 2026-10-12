import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * Parity: the Seedance 2.5 HD estimate quotes EXACTLY what a run of the same
 * draft reserves.
 *
 * The run side is the real thing, end to end: `POST /v1/video-upscale` through
 * the real credit-guard shim, `creditGuardImpl` (computeCredits + markup) and
 * `CreditsService.reserveCredits` (the `model_pricing` read, the markup) — the
 * number recorded is the `p_credits` the `reserve_credits` RPC receives. Only
 * the database, the queue and the draft lookup are stand-ins, and both routes
 * read the SAME stand-in draft.
 *
 * The pricing world is deliberately one where a shortcut would show: a
 * non-zero global markup, a different per-service margin on the finalize's
 * prefix, and a `model_pricing` row for the 4 s row that disagrees with
 * STATIC_CREDIT_COSTS (the admin override the reservation honours).
 */

const resolver = vi.hoisted(() => ({ result: {} as Record<string, unknown> }))
const db = vi.hoisted(() => ({
  modelPricing: new Map<string, number>(),
  reserved: [] as Array<{ credits: number; model: string }>,
}))

vi.mock("@/lib/seedance-draft-finalize.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seedance-draft-finalize.js")>()),
  resolveSeedanceDraftFinalize: async () => resolver.result,
}))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => true,
  isCloud: () => true,
  hasAdmin: () => true,
}))
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: async () => ({
    ai_provider: "kie",
    cost_markup_percent: 15,
    service_margin_percent: { "seedance-2-5-hd": 25 },
  }),
}))
vi.mock("@/lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access-blocks.js")>()),
  refuseBlockedReservation: async () => {},
}))
vi.mock("@/ee/billing/auto-recharge.js", () => ({ attemptAutoRecharge: async () => {} }))
vi.mock("@/ee/lib/welcome-offer-config.js", () => ({ getWelcomeOfferConfig: async () => ({ enabled: false }) }))
vi.mock("@/lib/supabase.js", () => {
  const PROFILE = {
    role: "user",
    tier: "pro",
    subscription_tier: "pro",
    lifetime_topup_credits: 0,
    subscription_credits: 1_000_000,
    topup_credits: 0,
    daily_spent_credits: 0,
    last_daily_reset: new Date().toISOString().slice(0, 10),
    storage_used_bytes: 0,
    storage_limit_bytes: 10_000_000_000,
  }
  const answer = (table: string, eqs: Array<[string, unknown]>, many: boolean) => {
    if (table === "profiles") return { data: PROFILE, error: null }
    if (table === "model_pricing") {
      const id = eqs.find(([col]) => col === "model_identifier")?.[1] as string | undefined
      const cost = id === undefined ? undefined : db.modelPricing.get(id)
      if (many) return { data: [...db.modelPricing].map(([model_identifier, credit_cost]) => ({ model_identifier, credit_cost })), error: null }
      return cost === undefined
        ? { data: null, error: { code: "PGRST116", message: "no rows" } }
        : { data: { credit_cost: cost, is_enabled: true, tier_restriction: null }, error: null }
    }
    if (table === "tier_config") return { data: { daily_credit_limit: null, monthly_credits: null, features: null }, error: null }
    return { data: null, error: null }
  }
  const from = (table: string) => {
    const eqs: Array<[string, unknown]> = []
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "insert", "update", "upsert", "delete", "order", "range", "limit", "gte", "lte", "in", "is", "neq"]) {
      chain[m] = () => chain
    }
    chain.eq = (col: string, value: unknown) => { eqs.push([col, value]); return chain }
    chain.single = async () => answer(table, eqs, false)
    chain.maybeSingle = async () => answer(table, eqs, false)
    chain.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(answer(table, eqs, true)).then(ok, ko)
    return chain
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === "reserve_credits") {
      db.reserved.push({ credits: args.p_credits as number, model: args.p_model_identifier as string })
      return { data: "usage-log-1", error: null }
    }
    return { data: null, error: null }
  }
  return { supabase: { from, rpc, auth: { getUser: async () => ({ data: { user: null }, error: null }) } } }
})
vi.mock("@/lib/insert-job.js", () => ({
  insertJob: vi.fn().mockResolvedValue({ data: { id: "job-hd" }, error: null }),
}))
vi.mock("@/lib/kie-task-ownership.js", () => ({ kieTaskOwnedByAnother: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "q" }) }, redis: {} }))

const { videoUpscaleRoutes } = await import("@/routes/video-upscale.js")
const { registerSeedanceHdEstimate } = await import("../seedance-hd-estimate.js")
const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")

const PLAN = {
  ok: true,
  sourceJobId: "11111111-2222-4333-8444-555555555555",
  draftTaskId: "task-draft",
  outputSec: 4,
  hasRefVideo: false,
  refVideoDurationsSec: [] as unknown[],
  creditId: "seedance-2-5-hd:4s",
}

let app: FastifyInstance
beforeAll(async () => {
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => { req.userId = "user-a" })
  await app.register(async (i) => { await videoUpscaleRoutes(i) })
  registerSeedanceHdEstimate(app)
  await app.ready()
})
afterAll(async () => { await app.close() })
beforeEach(() => {
  db.reserved = []
  db.modelPricing = new Map()
})

/** [credits the estimate quotes, credits the run reserves] for one draft. */
async function quoteAndReserve(plan: Record<string, unknown>): Promise<[number, number]> {
  resolver.result = plan
  const estimate = await app.inject({ method: "POST", url: "/v1/credits/seedance-hd-estimate", payload: { taskId: "task-draft" } })
  expect(estimate.statusCode, estimate.body).toBe(200)
  const run = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { provider: "seedance-2-5-hd", taskId: "task-draft" } })
  expect(run.statusCode, run.body).toBe(200)
  expect(db.reserved).toHaveLength(1)
  expect(db.reserved[0]!.model).toBe(plan.creditId)
  return [estimate.json().data.credits as number, db.reserved[0]!.credits]
}

describe("estimate == reservation", () => {
  it("a draft without a reference video, its row overridden in model_pricing", async () => {
    // A different id each case: the base-price cache is per id (60 s).
    db.modelPricing.set("seedance-2-5-hd:5s", 2100)
    const [quoted, reserved] = await quoteAndReserve({ ...PLAN, outputSec: 5, creditId: "seedance-2-5-hd:5s" })
    expect(reserved).toBe(quoted)
    // The override and the per-service margin were both honoured (not STATIC, not the global 15%).
    expect(STATIC_CREDIT_COSTS["seedance-2-5-hd:5s"]).not.toBe(2100)
    expect(quoted).toBe(Math.ceil(2100 * 1.25))
  })

  it("a draft without a reference video, priced from STATIC", async () => {
    const [quoted, reserved] = await quoteAndReserve(PLAN)
    expect(reserved).toBe(quoted)
    expect(quoted).toBe(Math.ceil(STATIC_CREDIT_COSTS["seedance-2-5-hd:4s"]! * 1.25))
  })

  it("a draft made with a reference video (input + output seconds)", async () => {
    const [quoted, reserved] = await quoteAndReserve({
      ...PLAN, hasRefVideo: true, refVideoDurationsSec: [4.04], creditId: "seedance-2-5-hd:4s-ref",
    })
    expect(reserved).toBe(quoted)
    // 1900 base (4 s in + 4 s out), marked up once at the finalize's margin.
    expect(quoted).toBe(Math.ceil(1900 * 1.25))
  })

  it("a reference-video draft whose clip could not be measured (worst case)", async () => {
    const [quoted, reserved] = await quoteAndReserve({
      ...PLAN, outputSec: 6, hasRefVideo: true, refVideoDurationsSec: [null], creditId: "seedance-2-5-hd:6s-ref",
    })
    expect(reserved).toBe(quoted)
  })
})
