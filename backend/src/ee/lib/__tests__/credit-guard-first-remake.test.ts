// @test-units-by-name prices one Video Remake fee through CreditsService; enumerates no node registry
/**
 * "First Remake on us" through the credit guard (credit-guard-impl.ts + first-remake-offer.ts):
 *
 *  - the Video Remake run's balance check admits a never-paid account's run
 *    its balance cannot cover, when the run is one the offer covers, and
 *    refuses one it does not cover with its own 402;
 *  - the run's fee check counts the pending cover;
 *  - the run's fee reservation grants the cover FIRST, and a refused grant
 *    refuses the run (job deleted, cover undone);
 *  - a reservation that fails after the grant gives the cover back before the
 *    job is deleted;
 *  - an account that can pay, another route, a workspace or a deployment payer:
 *    exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => {
  const state = {
    profiles: new Map<string, Record<string, unknown>>(),
    tables: new Map<string, { data: unknown; error: unknown }>(),
    profileReads: [] as string[],
    writes: [] as string[],
    headroom: undefined as undefined | null | ((ws: string, user: string) => Promise<{ headroomCredits: number } | null>),
    headroomCalls: [] as Array<[string, string]>,
    payerActive: false,
    enforce: false,
    rpc: new Map<string, { data: unknown; error: unknown }>(),
    rpcArgs: [] as Array<{ name: string; args: unknown }>,
  }
  function chain(table: string) {
    let id: string | undefined
    const answer = () => {
      if (table === "profiles") {
        if (id) state.profileReads.push(id)
        const row = id ? state.profiles.get(id) : undefined
        return Promise.resolve(row ? { data: row, error: null } : { data: null, error: { code: "PGRST116" } })
      }
      return Promise.resolve(state.tables.get(table) ?? { data: null, error: { code: "PGRST116" } })
    }
    const c: Record<string, unknown> = {
      select: () => c,
      eq: (col: string, v: string) => {
        if (col === "id") id = v
        return c
      },
      in: () => c,
      gte: () => c,
      order: () => c,
      limit: () => c,
      single: answer,
      maybeSingle: answer,
      insert: () => { state.writes.push(`insert:${table}`); return c },
      update: () => { state.writes.push(`update:${table}`); return c },
      upsert: () => { state.writes.push(`upsert:${table}`); return c },
      delete: () => { state.writes.push(`delete:${table}`); return c },
    }
    return c
  }
  return { state, chain }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => h.chain(table)),
    auth: { getUser: vi.fn() },
    rpc: vi.fn(async (name: string, args: unknown) => {
      h.state.writes.push(`rpc:${name}`)
      h.state.rpcArgs.push({ name, args })
      const answer = h.state.rpc.get(name)
      return answer ?? { data: null, error: null }
    }),
  },
}))
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie", cost_markup_percent: 0 }),
}))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => true,
  isCloud: () => true,
}))
vi.mock("@/lib/deployment-payer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/deployment-payer.js")>()
  return {
    ...actual,
    deploymentPayerActive: () => h.state.payerActive,
    deploymentPayerId: () => (h.state.payerActive ? "operator" : null),
    deploymentBillingContext: (requesterId: string) => ({
      payer: "deployment" as const,
      userId: requesterId,
      payerId: "operator",
      entitlements: { watermark: false as const, dailyCapCredits: null, parallelism: 4, tierForGates: "business" },
    }),
    allowanceEnforcementActive: () => h.state.payerActive && h.state.enforce,
  }
})
vi.mock("@/lib/surface-profile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/surface-profile.js")>()
  return {
    ...actual,
    runtimeSurfaceProfile: () => ({
      ...actual.SURFACE_PROFILE_DEFAULT,
      billing: { ...actual.SURFACE_PROFILE_DEFAULT.billing, allowances: h.state.enforce ? "enforce" : "off" },
    }),
  }
})
vi.mock("@/lib/billing-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/billing-context.js")>()
  return {
    ...actual,
    billingService: () => {
      const hr = h.state.headroom
      if (hr === undefined) return null
      return {
        resolve: vi.fn(),
        ...(hr
          ? {
              headroom: async (ws: string, user: string) => {
                h.state.headroomCalls.push([ws, user])
                return hr(ws, user)
              },
            }
          : {}),
      }
    },
  }
})

// A Video Remake step (a child of the covered run): the parent check, held by the test.
const step = vi.hoisted(() => ({ kind: null as null | "result" | "helper", parent: undefined as string | undefined }))
vi.mock("@/ee/lib/video-remake-child.js", () => ({ videoRemakeStepOf: async () => step.kind }))
vi.mock("@/lib/job-submission-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/job-submission-context.js")>()),
  trustedPluginParentJobId: () => step.parent,
}))

import { checkPayerCanAffordImpl, creditGuardImpl, reserveCreditsForJobImpl } from "../credit-guard-impl.js"
import { CreditsService } from "../../billing/credits.js"
import { pendingFirstRemakeCover, resetFirstRemakeSchemaCheck, firstRemakeOfferForBalance, firstRemakeOfferForEstimate, sweepFirstRemakeOffers, abandonFirstRemakeCover } from "../first-remake-offer.js"
import { __resetDeploymentAllowanceCacheForTests } from "../../billing/deployment-allowance-service.js"

const MEMBER = "member-1"

function freeProfile(subscription: number) {
  return {
    role: "user",
    tier: "free",
    subscription_tier: "free",
    lifetime_topup_credits: 0,
    subscription_credits: subscription,
    topup_credits: 0,
    daily_spent_credits: 0,
    last_daily_reset: new Date().toISOString().slice(0, 10),
    storage_used_bytes: 0,
    storage_limit_bytes: 1_000_000_000,
  }
}

const PRISM_PREVIEW = { videoUrl: "https://x/clip.mp4", roles: [], preview: true }

function runReq(body: unknown = PRISM_PREVIEW, url = "/v1/video-remake", overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { userId: MEMBER, method: "POST", url, routeOptions: { url }, headers: {}, body, ...overrides }
}

function makeReply() {
  const sent: Array<{ status: number; body: unknown }> = []
  const reply = {
    sent: false,
    status(code: number) {
      return { send: (b: unknown) => { sent.push({ status: code, body: b }); reply.sent = true } }
    },
  }
  return { sent, reply }
}

let modelSeq = 0
function pricedModel(cost: number): string {
  h.state.tables.set("model_pricing", { data: { credit_cost: cost, is_enabled: true, tier_restriction: null }, error: null })
  return `first-remake-test-${++modelSeq}`
}

function offer(state: string, balance: number) {
  h.state.rpc.set("first_remake_offer_status", { data: { state, balance }, error: null })
}

const rpcNames = () => h.state.rpcArgs.map((c) => c.name)

beforeEach(() => {
  h.state.profiles.clear()
  h.state.tables.clear()
  h.state.profileReads.length = 0
  h.state.writes.length = 0
  h.state.headroom = undefined
  h.state.headroomCalls.length = 0
  h.state.payerActive = false
  h.state.enforce = false
  h.state.rpc.clear()
  h.state.rpcArgs.length = 0
  step.kind = null
  step.parent = undefined
  resetFirstRemakeSchemaCheck()
  __resetDeploymentAllowanceCacheForTests()
})

describe("the run's balance check", () => {
  it("admits a covered run its balance cannot pay, with the cover pending", async () => {
    h.state.profiles.set(MEMBER, freeProfile(300))
    offer("available", 300)
    const req = runReq()
    expect(await checkPayerCanAffordImpl(req as never, 520)).toEqual({ ok: true })
    expect(pendingFirstRemakeCover(req as never)).toEqual({ quote: 520, cover: 220 })
    // Nothing granted yet: no job exists.
    expect(rpcNames()).toEqual(["first_remake_offer_status"])
  })

  it("a trend run (the injected run route) is the same run", async () => {
    h.state.profiles.set(MEMBER, freeProfile(300))
    offer("available", 300)
    const req = runReq({ ...PRISM_PREVIEW, trendRun: true }, "/v1/cast-swap", { authKind: "internal" })
    expect(await checkPayerCanAffordImpl(req as never, 520)).toEqual({ ok: true })
  })

  it("refuses a run the offer does not cover with first_remake_option_locked", async () => {
    h.state.profiles.set(MEMBER, freeProfile(300))
    offer("available", 300)
    const verdict = await checkPayerCanAffordImpl(runReq({ ...PRISM_PREVIEW, resolution: "1080p" }) as never, 900)
    expect(verdict).toMatchObject({
      ok: false,
      statusCode: 402,
      body: { error: { code: "first_remake_option_locked" }, required: 900, balance: 300 },
    })
  })

  it("an account that can pay pays: the offer is not even read", async () => {
    h.state.profiles.set(MEMBER, freeProfile(600))
    offer("available", 600)
    const req = runReq()
    expect(await checkPayerCanAffordImpl(req as never, 520)).toEqual({ ok: true })
    expect(pendingFirstRemakeCover(req as never)).toBeUndefined()
    expect(rpcNames()).toEqual([])
  })

  it("a used offer: the refusal of before", async () => {
    h.state.profiles.set(MEMBER, freeProfile(300))
    offer("used", 300)
    expect(await checkPayerCanAffordImpl(runReq() as never, 520)).toMatchObject({
      ok: false,
      statusCode: 402,
      body: { error: { code: "insufficient_credits" } },
    })
  })

  it("another route: the refusal of before, the offer never read", async () => {
    h.state.profiles.set(MEMBER, freeProfile(300))
    offer("available", 300)
    expect(await checkPayerCanAffordImpl(runReq(PRISM_PREVIEW, "/v1/cast-swap/:jobId/full-quality") as never, 520)).toMatchObject({ ok: false, statusCode: 402 })
    expect(rpcNames()).toEqual([])
  })

  it("a deployment payer: the refusal of before, the offer never read", async () => {
    h.state.payerActive = true
    h.state.profiles.set("operator", freeProfile(10))
    offer("available", 300)
    const dep = { payer: "deployment" as const, userId: MEMBER, payerId: "operator", entitlements: { watermark: false as const, dailyCapCredits: null, parallelism: 4, tierForGates: "business" } }
    expect(await checkPayerCanAffordImpl(runReq(PRISM_PREVIEW, "/v1/video-remake", { billingContext: dep }) as never, 520)).toMatchObject({ ok: false, statusCode: 402 })
    expect(rpcNames()).toEqual([])
  })
})

describe("the run's fee check", () => {
  it("counts the pending cover: the fee passes on a balance short of it", async () => {
    h.state.profiles.set(MEMBER, freeProfile(5))
    offer("available", 5)
    const req = runReq()
    expect(await checkPayerCanAffordImpl(req as never, 520)).toEqual({ ok: true })
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => pricedModel(12))(req as never, reply as never)
    expect(sent).toEqual([])
  })

  it("without a pending cover the same fee is refused", async () => {
    h.state.profiles.set(MEMBER, freeProfile(5))
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => pricedModel(12))(runReq() as never, reply as never)
    expect(sent[0]?.status).toBe(402)
  })
})

describe("the run's fee reservation", () => {
  async function admitted() {
    h.state.profiles.set(MEMBER, freeProfile(300))
    offer("available", 300)
    const req = runReq()
    await checkPayerCanAffordImpl(req as never, 520)
    h.state.rpcArgs.length = 0
    return req
  }

  it("grants the cover for the job BEFORE the fee is reserved", async () => {
    const req = await admitted()
    const order: string[] = []
    h.state.rpc.set("grant_first_remake_cover", { data: 220, error: null })
    const reserve = vi.spyOn(CreditsService, "reserveCredits").mockImplementation(async () => {
      order.push(...rpcNames(), "reserve")
      return { usageLogId: "log-1", creditsReserved: 12, watermark: true }
    })
    try {
      const { sent, reply } = makeReply()
      const r = await reserveCreditsForJobImpl(req as never, reply as never, "job-1", "cast-swap")
      expect(r).toMatchObject({ usageLogId: "log-1" })
      expect(sent).toEqual([])
      expect(order).toEqual(["grant_first_remake_cover", "reserve"])
      expect(h.state.rpcArgs[0]).toEqual({ name: "grant_first_remake_cover", args: { p_user_id: MEMBER, p_job_id: "job-1", p_quote: 520 } })
    } finally {
      reserve.mockRestore()
    }
  })

  it("a refused grant refuses the run: the cover undone, the job deleted, nothing reserved", async () => {
    const req = await admitted()
    h.state.rpc.set("grant_first_remake_cover", { data: null, error: { message: "FIRST_REMAKE_UNAVAILABLE: taken" } })
    const reserve = vi.spyOn(CreditsService, "reserveCredits")
    try {
      const { sent, reply } = makeReply()
      expect(await reserveCreditsForJobImpl(req as never, reply as never, "job-1", "cast-swap")).toBeUndefined()
      expect(sent).toEqual([{ status: 402, body: { error: { code: "insufficient_credits", message: "Insufficient credits" }, required: 520 } }])
      expect(reserve).not.toHaveBeenCalled()
      expect(rpcNames()).toEqual(["grant_first_remake_cover", "finalize_first_remake_offer"])
      expect(h.state.rpcArgs[1]?.args).toEqual({ p_job_id: "job-1", p_abandoned: true })
      expect(h.state.writes).toContain("delete:jobs")
    } finally {
      reserve.mockRestore()
    }
  })

  it("a reservation failing after the grant gives the cover back before the job is deleted", async () => {
    const req = await admitted()
    h.state.rpc.set("grant_first_remake_cover", { data: 220, error: null })
    const reserve = vi.spyOn(CreditsService, "reserveCredits").mockRejectedValue(new Error("boom"))
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const { sent, reply } = makeReply()
      expect(await reserveCreditsForJobImpl(req as never, reply as never, "job-1", "cast-swap")).toBeUndefined()
      expect(sent[0]?.status).toBe(500)
      const finalize = h.state.writes.indexOf("rpc:finalize_first_remake_offer")
      const del = h.state.writes.indexOf("delete:jobs")
      expect(finalize).toBeGreaterThan(-1)
      expect(del).toBeGreaterThan(finalize)
    } finally {
      reserve.mockRestore()
      errors.mockRestore()
    }
  })

  it("an affordable run takes the offer with no quote (its first run), then reserves as before", async () => {
    h.state.profiles.set(MEMBER, freeProfile(600))
    h.state.rpc.set("grant_first_remake_cover", { data: 0, error: null })
    const reserve = vi.spyOn(CreditsService, "reserveCredits").mockResolvedValue({ usageLogId: "log-1", creditsReserved: 12, watermark: true })
    try {
      const { sent, reply } = makeReply()
      await reserveCreditsForJobImpl(runReq() as never, reply as never, "job-1", "cast-swap")
      expect(h.state.rpcArgs).toEqual([{ name: "grant_first_remake_cover", args: { p_user_id: MEMBER, p_job_id: "job-1", p_quote: null } }])
      expect(reserve).toHaveBeenCalledTimes(1)
      expect(sent).toEqual([])
    } finally {
      reserve.mockRestore()
    }
  })

  it("an affordable run is never refused when the offer cannot be taken", async () => {
    h.state.profiles.set(MEMBER, freeProfile(600))
    h.state.rpc.set("grant_first_remake_cover", { data: null, error: { message: "FIRST_REMAKE_UNAVAILABLE: x" } })
    const reserve = vi.spyOn(CreditsService, "reserveCredits").mockResolvedValue({ usageLogId: "log-1", creditsReserved: 12, watermark: true })
    try {
      const { sent, reply } = makeReply()
      await reserveCreditsForJobImpl(runReq() as never, reply as never, "job-1", "cast-swap")
      expect(reserve).toHaveBeenCalledTimes(1)
      expect(sent).toEqual([])
      expect(h.state.writes).not.toContain("delete:jobs")
    } finally {
      reserve.mockRestore()
    }
  })

  it("another model's reservation never touches the offer", async () => {
    h.state.profiles.set(MEMBER, freeProfile(600))
    const reserve = vi.spyOn(CreditsService, "reserveCredits").mockResolvedValue({ usageLogId: "log-1", creditsReserved: 12, watermark: true })
    try {
      const { reply } = makeReply()
      await reserveCreditsForJobImpl(runReq({}, "/v1/generate-video") as never, reply as never, "job-1", "seedance-2-5")
      expect(rpcNames()).toEqual([])
    } finally {
      reserve.mockRestore()
    }
  })
})

describe("a step of the covered run", () => {
  it("is checked against its own credits plus the run's cover (held apart from the pools)", async () => {
    h.state.profiles.set(MEMBER, freeProfile(40))
    step.kind = "result"
    step.parent = "run-1"
    h.state.rpc.set("first_remake_cover_available", { data: 400, error: null })
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => pricedModel(300))(runReq({}, "/v1/generate-video") as never, reply as never)
    expect(sent).toEqual([])
    expect(h.state.rpcArgs).toContainEqual({ name: "first_remake_cover_available", args: { p_user_id: MEMBER, p_job_id: "run-1" } })
  })

  it("beyond own credits and the cover it is refused", async () => {
    h.state.profiles.set(MEMBER, freeProfile(40))
    step.kind = "result"
    step.parent = "run-1"
    h.state.rpc.set("first_remake_cover_available", { data: 100, error: null })
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => pricedModel(300))(runReq({}, "/v1/generate-video") as never, reply as never)
    expect(sent[0]?.status).toBe(402)
  })

  it("any other request never asks for the cover", async () => {
    h.state.profiles.set(MEMBER, freeProfile(40))
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => pricedModel(300))(runReq({}, "/v1/generate-video") as never, reply as never)
    expect(sent[0]?.status).toBe(402)
    expect(rpcNames()).not.toContain("first_remake_cover_available")
  })
})

describe("the settle fallbacks never touch a covered hold", () => {
  it("the refund fallback leaves a hold that drew on the cover for the RPC", async () => {
    h.state.rpc.set("refund_credits", { data: null, error: { message: "rpc down" } })
    h.state.tables.set("usage_logs", {
      data: { user_id: MEMBER, job_id: "job-1", credits_used: 300, status: "reserved", metadata: { from_sub: 80, from_topup: 0, from_cover: 220 }, workspace_id: null, on_behalf_of: null },
      error: null,
    })
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await CreditsService.refundCredits("log-1")
      expect(rpcNames()).not.toContain("add_topup_credits")
      expect(rpcNames()).not.toContain("add_subscription_credits")
      expect(h.state.writes).not.toContain("update:usage_logs")
      expect(errors).toHaveBeenCalledWith(expect.stringContaining("refund fallback REFUSED for a first-Remake covered usage log"))
    } finally {
      errors.mockRestore()
      warns.mockRestore()
    }
  })
})

describe("a database without migration 684 (staging runs dev's code on the shared database first)", () => {
  const MISSING = { data: null, error: { code: "PGRST202", message: "Could not find the function public.x in the schema cache" } }
  function schemaAbsent() {
    for (const name of ["first_remake_offer_status", "grant_first_remake_cover", "finalize_first_remake_offer", "first_remake_cover_available", "sweep_first_remake_offers"]) {
      h.state.rpc.set(name, MISSING)
    }
  }

  it("a short run gets the refusal of before, and nothing is logged as an error", async () => {
    schemaAbsent()
    h.state.profiles.set(MEMBER, freeProfile(300))
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const req = runReq()
      expect(await checkPayerCanAffordImpl(req as never, 520)).toMatchObject({ ok: false, statusCode: 402, body: { error: { code: "insufficient_credits" } } })
      expect(pendingFirstRemakeCover(req as never)).toBeUndefined()
      expect(errors).not.toHaveBeenCalled()
      expect(warns).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
      warns.mockRestore()
    }
  })

  it("an affordable run reserves exactly as before, and the schema is asked once a minute, not per call", async () => {
    schemaAbsent()
    h.state.profiles.set(MEMBER, freeProfile(600))
    const reserve = vi.spyOn(CreditsService, "reserveCredits").mockResolvedValue({ usageLogId: "log-1", creditsReserved: 12, watermark: true })
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {})
    const infos = vi.spyOn(console, "info").mockImplementation(() => {})
    try {
      for (const job of ["job-1", "job-2", "job-3"]) {
        const { sent, reply } = makeReply()
        const r = await reserveCreditsForJobImpl(runReq() as never, reply as never, job, "cast-swap")
        expect(r).toMatchObject({ usageLogId: "log-1" })
        expect(sent).toEqual([])
      }
      expect(reserve).toHaveBeenCalledTimes(3)
      expect(rpcNames().filter((n) => n === "grant_first_remake_cover")).toHaveLength(1)
      expect(warns).not.toHaveBeenCalled()
      expect(infos).toHaveBeenCalledTimes(1)
    } finally {
      reserve.mockRestore()
      warns.mockRestore()
      infos.mockRestore()
    }
  })

  it("a step of a Video Remake run is checked as before (no cover counted)", async () => {
    schemaAbsent()
    h.state.profiles.set(MEMBER, freeProfile(40))
    step.kind = "result"
    step.parent = "run-1"
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => pricedModel(300))(runReq({}, "/v1/generate-video") as never, reply as never)
    expect(sent[0]?.status).toBe(402)
  })

  it("the balance and the estimate carry no offer; the sweep and an abandon do nothing", async () => {
    schemaAbsent()
    vi.spyOn(console, "info").mockImplementation(() => {})
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      expect(await firstRemakeOfferForBalance(MEMBER, undefined)).toBeNull()
      expect(await firstRemakeOfferForEstimate(MEMBER, undefined, PRISM_PREVIEW, { totalCredits: 520 })).toBeNull()
      expect(await sweepFirstRemakeOffers()).toEqual([])
      await abandonFirstRemakeCover(MEMBER, "job-1")
      expect(errors).not.toHaveBeenCalled()
      expect(warns).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
      warns.mockRestore()
    }
  })
})
