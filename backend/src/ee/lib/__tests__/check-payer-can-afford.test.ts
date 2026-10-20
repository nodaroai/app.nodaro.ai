/**
 * `checkPayerCanAffordImpl` — the toolkit's `http.checkPayerCanAfford`: can the
 * payer of this request afford N final credits right now?
 *
 *  - Payer-aware: a personal payer's own pools, a deployment payer's pool (the
 *    PAYER's profile row, never echoed), a workspace payer's headroom.
 *  - A refusal is exactly what the credit guard sends for the same shortfall
 *    (proved against `creditGuardImpl` itself, not a hand-written copy).
 *  - Holds nothing and writes nothing: no reservation, no RPC, no insert or
 *    update, nothing stamped on the request.
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
    rpc: vi.fn(async (name: string) => {
      h.state.writes.push(`rpc:${name}`)
      return { data: null, error: null }
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

import { checkPayerCanAffordImpl, creditGuardImpl } from "../credit-guard-impl.js"
import { __resetDeploymentAllowanceCacheForTests } from "../../billing/deployment-allowance-service.js"

const MEMBER = "member-1"

const WORKSPACE_CTX = {
  payer: "workspace" as const,
  userId: MEMBER,
  workspaceId: "ws-1",
  orgId: "org-1",
  memberCap: null,
  entitlements: {
    watermark: false as const,
    dailyCapCredits: null,
    parallelism: 12,
    tierForGates: "business" as const,
    freeTierBlocklist: false as const,
    webFreeMode: false as const,
    appCreditsAllowance: false as const,
  },
}

const DEPLOYMENT_CTX = {
  payer: "deployment" as const,
  userId: MEMBER,
  payerId: "operator",
  entitlements: { watermark: false as const, dailyCapCredits: null, parallelism: 4, tierForGates: "business" },
}

function profile(credits: { subscription: number; topup: number; tier?: string; subscriptionTier?: string | null; lifetimeTopup?: number }) {
  return {
    role: "user",
    tier: credits.tier ?? "basic",
    subscription_tier: credits.subscriptionTier === undefined ? (credits.tier ?? "basic") : credits.subscriptionTier,
    lifetime_topup_credits: credits.lifetimeTopup ?? 0,
    subscription_credits: credits.subscription,
    topup_credits: credits.topup,
    daily_spent_credits: 0,
    last_daily_reset: new Date().toISOString().slice(0, 10),
    storage_used_bytes: 0,
    storage_limit_bytes: 1_000_000_000,
  }
}

const makeReq = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  userId: MEMBER,
  url: "/v1/plugin-route",
  headers: {},
  body: {},
  ...overrides,
})

function makeReply() {
  const sent: Array<{ status: number; body: unknown }> = []
  return {
    sent,
    reply: {
      sent: false,
      status(code: number) {
        return { send: (body: unknown) => { sent.push({ status: code, body }) } }
      },
    },
  }
}

// The guard prices by identifier through a 60 s cache — one id per case.
let modelSeq = 0
function pricedModel(cost: number): string {
  h.state.tables.set("model_pricing", { data: { credit_cost: cost, is_enabled: true, tier_restriction: null }, error: null })
  return `afford-test-${++modelSeq}`
}

/** What the credit guard itself sends for a run priced `cost` on this request. */
async function guardRefusal(req: Record<string, unknown>, cost: number) {
  const { sent, reply } = makeReply()
  await creditGuardImpl(() => pricedModel(cost))(req as never, reply as never)
  return sent
}

beforeEach(() => {
  h.state.profiles.clear()
  h.state.tables.clear()
  h.state.profileReads.length = 0
  h.state.writes.length = 0
  h.state.headroom = undefined
  h.state.headroomCalls.length = 0
  h.state.payerActive = false
  h.state.enforce = false
  __resetDeploymentAllowanceCacheForTests()
})

describe("checkPayerCanAffordImpl — personal payer", () => {
  it("enough → ok", async () => {
    h.state.profiles.set(MEMBER, profile({ subscription: 400, topup: 100 }))
    expect(await checkPayerCanAffordImpl(makeReq() as never, 500)).toEqual({ ok: true })
    expect(h.state.profileReads).toEqual([MEMBER])
  })

  it("short → ok:false with exactly the guard's 402 (code, message, required, balance)", async () => {
    h.state.profiles.set(MEMBER, profile({ subscription: 40, topup: 10 }))
    const verdict = await checkPayerCanAffordImpl(makeReq() as never, 530)
    expect(verdict).toEqual({
      ok: false,
      statusCode: 402,
      body: {
        error: { code: "insufficient_credits", message: "Insufficient credits. Required: 530, Available: 50" },
        required: 530,
        balance: 50,
      },
    })
    const guard = await guardRefusal(makeReq(), 530)
    expect(guard).toEqual([{ status: 402, body: (verdict as { body: unknown }).body }])
  })

  it("a payg account on a consumer surface (web-free) gets the guard's subscription ask, and the flag is read, not stamped", async () => {
    // payg: stored free tier with a purchase on record; its free pool can't cover, its topup could.
    h.state.profiles.set(MEMBER, profile({ subscription: 20, topup: 5000, tier: "free", subscriptionTier: null, lifetimeTopup: 5000 }))
    const req = makeReq({ webFreeMode: true })
    const verdict = await checkPayerCanAffordImpl(req as never, 100)
    expect(verdict).toMatchObject({ ok: false, statusCode: 403, body: { error: { code: "subscription_required" } } })
    expect(req.webFreeMode).toBe(true)

    const offSurface = makeReq()
    expect(await checkPayerCanAffordImpl(offSurface as never, 100)).toEqual({ ok: true })
    expect(offSurface).not.toHaveProperty("webFreeMode")
  })

  it("0 credits is always affordable", async () => {
    h.state.profiles.set(MEMBER, profile({ subscription: 0, topup: 0 }))
    expect(await checkPayerCanAffordImpl(makeReq() as never, 0)).toEqual({ ok: true })
  })
})

describe("checkPayerCanAffordImpl — workspace payer", () => {
  it("member personal 0, workspace enough → ok (the personal pools are not what pays)", async () => {
    h.state.profiles.set(MEMBER, profile({ subscription: 0, topup: 0 }))
    h.state.headroom = async () => ({ headroomCredits: 5000 })
    const verdict = await checkPayerCanAffordImpl(makeReq({ billingContext: WORKSPACE_CTX }) as never, 900)
    expect(verdict).toEqual({ ok: true })
    expect(h.state.headroomCalls).toEqual([["ws-1", MEMBER]])
  })

  it("member personal plenty, workspace short → ok:false in the reserve RPC's words (budget_exceeded)", async () => {
    h.state.profiles.set(MEMBER, profile({ subscription: 1_000_000, topup: 0 }))
    h.state.headroom = async () => ({ headroomCredits: 300 })
    const verdict = await checkPayerCanAffordImpl(makeReq({ billingContext: WORKSPACE_CTX }) as never, 900)
    expect(verdict).toEqual({
      ok: false,
      statusCode: 402,
      body: { error: { code: "budget_exceeded", message: "The workspace budget cannot cover this run" } },
    })
    // The member's own wallet was never consulted, so nothing of it can leak.
    expect(h.state.profileReads).toEqual([])
  })

  it("no headroom answer (older plugin, failed read, no service) → ok: the reservation stays the authority", async () => {
    h.state.headroom = async () => null
    expect(await checkPayerCanAffordImpl(makeReq({ billingContext: WORKSPACE_CTX }) as never, 900)).toEqual({ ok: true })
    h.state.headroom = null // service without the member
    expect(await checkPayerCanAffordImpl(makeReq({ billingContext: WORKSPACE_CTX }) as never, 900)).toEqual({ ok: true })
    h.state.headroom = undefined // no service
    expect(await checkPayerCanAffordImpl(makeReq({ billingContext: WORKSPACE_CTX }) as never, 900)).toEqual({ ok: true })
  })

  it("a headroom read that throws rejects", async () => {
    h.state.headroom = async () => { throw new Error("db down") }
    await expect(checkPayerCanAffordImpl(makeReq({ billingContext: WORKSPACE_CTX }) as never, 900)).rejects.toThrow("db down")
  })
})

describe("checkPayerCanAffordImpl — deployment payer", () => {
  it("reads the PAYER's pool; short → the guard's refusal, which never echoes that pool", async () => {
    h.state.payerActive = true
    h.state.profiles.set(MEMBER, profile({ subscription: 1_000_000, topup: 0 }))
    h.state.profiles.set("operator", profile({ subscription: 120, topup: 0, tier: "business" }))
    const req = makeReq({ billingContext: DEPLOYMENT_CTX })
    const verdict = await checkPayerCanAffordImpl(req as never, 900)
    expect(h.state.profileReads).toEqual(["operator"])
    expect(verdict).toEqual({
      ok: false,
      statusCode: 402,
      body: {
        error: { code: "insufficient_credits", message: "This deployment is out of credits. Contact your administrator." },
        required: 900,
      },
    })
    expect(JSON.stringify(verdict)).not.toContain("120")
    const guard = await guardRefusal(req, 900)
    expect(guard).toEqual([{ status: 402, body: (verdict as { body: unknown }).body }])
  })

  it("the payer's own programmatic credential (an app token whose user IS the payer) never learns the pool either", async () => {
    // With a payer configured every request resolves to the deployment payer —
    // the payer's own relay token included — so the refusal withholds the pool.
    h.state.payerActive = true
    h.state.profiles.set("operator", profile({ subscription: 120, topup: 0, tier: "business" }))
    const req = makeReq({ userId: "operator", authKind: "app_token", billingContext: { ...DEPLOYMENT_CTX, userId: "operator" } })
    const verdict = await checkPayerCanAffordImpl(req as never, 900)
    expect(verdict).toMatchObject({ ok: false, statusCode: 402 })
    expect((verdict as { body: Record<string, unknown> }).body).not.toHaveProperty("balance")
    expect(JSON.stringify(verdict)).not.toContain("120")
  })

  it("with NO billing context on the request (a GET / HEAD the hook skips), the deployment payer is still the payer", async () => {
    h.state.payerActive = true
    h.state.profiles.set("operator", profile({ subscription: 120, topup: 0, tier: "business" }))
    // The payer's own app token: without the fallback its own row would be read as personal and echoed.
    const short = await checkPayerCanAffordImpl(makeReq({ userId: "operator", authKind: "app_token" }) as never, 900)
    expect(h.state.profileReads).toEqual(["operator"])
    expect(short).toEqual({
      ok: false,
      statusCode: 402,
      body: {
        error: { code: "insufficient_credits", message: "This deployment is out of credits. Contact your administrator." },
        required: 900,
      },
    })
    expect(JSON.stringify(short)).not.toContain("120")

    // An ordinary requester is judged on the payer's pool, not their own.
    h.state.profiles.set(MEMBER, profile({ subscription: 0, topup: 0 }))
    expect(await checkPayerCanAffordImpl(makeReq() as never, 100)).toEqual({ ok: true })
    expect(h.state.profileReads.at(-1)).toBe("operator")
  })

  it("enough in the payer's pool → ok", async () => {
    h.state.payerActive = true
    h.state.profiles.set("operator", profile({ subscription: 10_000, topup: 0, tier: "business" }))
    expect(await checkPayerCanAffordImpl(makeReq({ billingContext: DEPLOYMENT_CTX }) as never, 900)).toEqual({ ok: true })
  })

  it("with allowances enforced, a requester whose allowance is short gets the guard's user_allowance_exceeded", async () => {
    h.state.payerActive = true
    h.state.enforce = true
    h.state.profiles.set("operator", profile({ subscription: 10_000_000, topup: 0, tier: "business" }))
    h.state.tables.set("deployment_user_allowances", {
      data: { user_id: MEMBER, granted_credits: 200_000, reserved_credits: 0, spent_credits: 196_000 },
      error: null,
    })
    const req = makeReq({ billingContext: DEPLOYMENT_CTX })
    const verdict = await checkPayerCanAffordImpl(req as never, 12_000)
    expect(verdict).toEqual({
      ok: false,
      statusCode: 402,
      body: {
        error: { code: "user_allowance_exceeded", message: "Your allowance cannot cover this run" },
        required: 12_000,
        remaining: 4_000,
      },
    })
    __resetDeploymentAllowanceCacheForTests()
    const guard = await guardRefusal(req, 12_000)
    expect(guard).toEqual([{ status: 402, body: (verdict as { body: unknown }).body }])
  })
})

describe("checkPayerCanAffordImpl — holds nothing, leaves nothing", () => {
  it("no reservation, no RPC, no write, and nothing stamped on the request", async () => {
    h.state.profiles.set(MEMBER, profile({ subscription: 400, topup: 100 }))
    const req = makeReq()
    await checkPayerCanAffordImpl(req as never, 500)
    h.state.profiles.set(MEMBER, profile({ subscription: 1, topup: 0 }))
    await checkPayerCanAffordImpl(req as never, 500)
    expect(h.state.writes).toEqual([])
    expect(req).not.toHaveProperty("creditReservation")
    expect(req).not.toHaveProperty("webFreeMode")
    expect(req).not.toHaveProperty("storageSnapshot")
  })
})

describe("checkPayerCanAffordImpl — internal failures reject", () => {
  it("an unreadable payer profile rejects rather than answering ok", async () => {
    await expect(checkPayerCanAffordImpl(makeReq() as never, 500)).rejects.toThrow()
  })

  it("a bad amount or a request with no user rejects", async () => {
    await expect(checkPayerCanAffordImpl(makeReq() as never, Number.NaN)).rejects.toThrow()
    await expect(checkPayerCanAffordImpl(makeReq() as never, -1)).rejects.toThrow()
    await expect(checkPayerCanAffordImpl(makeReq({ userId: undefined }) as never, 5)).rejects.toThrow()
  })
})
