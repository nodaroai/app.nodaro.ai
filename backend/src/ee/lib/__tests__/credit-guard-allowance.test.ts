/**
 * Track A — the credit guard's per-user allowance pre-flight (D7, D8, D10).
 *
 * WHAT THIS FILE IS FOR, in one sentence each:
 *
 *  - **The first-Generate regression** (the first test, deliberately first).
 *    Provisioning is lazy: a row appears at the first ENFORCED reserve, so a
 *    user who has never generated has NO row. If any read surface answers 0
 *    for that user, this guard refuses their first ever Generate with a 402
 *    the RPC would never have raised — and the failure is invisible until a
 *    real new user arrives on a live instance. The rule (D7) lives once, in
 *    `deployment-allowance-service.ts`; this test proves the guard actually
 *    goes through it rather than reading the table itself.
 *
 *  - **The refusal is honest and leaks nothing** (D10). Raw credits, the
 *    requester's own two figures, and not one byte about the payer — the same
 *    property `deployment-payer-guard.test.ts` guards for the pool-empty 402,
 *    because this response also reaches anyone who can press Generate.
 *
 *  - **The pre-flight is NON-AUTHORITATIVE and OFF before the flip.** The
 *    decision that matters is inside `reserve_credits`, under `FOR UPDATE`
 *    (D8). This check exists so a user gets a truthful 402 before a job row
 *    exists. It must therefore refuse NOTHING while `billing.allowances` is
 *    still "off" — rollout step 8 is the only change in the track that may
 *    refuse a generation.
 *
 * Nothing here mocks `deployment-allowance-service.ts`: the whole point is
 * that the guard's answer comes from that module's real D7 branch, driven by
 * the supabase rows below.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, tableResponses, tablesTouched, state } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const tablesTouched: string[] = []
  const state = { payerActive: true, payerId: "payer-acct", enforce: true }
  function createChain(table: string, response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    }
    return chain
  }
  const mockFrom = vi.fn().mockImplementation((table: string) => {
    tablesTouched.push(table)
    return createChain(table, tableResponses.get(table) ?? null)
  })
  return { mockFrom, tableResponses, tablesTouched, state }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, auth: { getUser: vi.fn() }, rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
}))
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie", cost_markup_percent: 0 }),
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
// Partial mocks (importOriginal + spread): the payer seam is module state
// written at boot, and there is no boot here. Everything else in these two
// modules stays REAL, so a signature change breaks this file loudly instead
// of silently passing against a hand-written stand-in.
vi.mock("@/lib/deployment-payer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/deployment-payer.js")>()
  return {
    ...actual,
    deploymentPayerActive: () => state.payerActive,
    deploymentPayerId: () => (state.payerActive ? state.payerId : null),
    allowanceEnforcementActive: () => state.payerActive && state.enforce,
  }
})
// `billing.allowances` also drives the enforcement predicate WS0's service
// still keeps a local copy of; overriding it here means this file passes
// identically before and after that copy is replaced by the shared import.
vi.mock("@/lib/surface-profile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/surface-profile.js")>()
  return {
    ...actual,
    runtimeSurfaceProfile: () => ({
      ...actual.SURFACE_PROFILE_DEFAULT,
      billing: { ...actual.SURFACE_PROFILE_DEFAULT.billing, allowances: state.enforce ? "enforce" : "off" },
    }),
  }
})

import { creditGuardImpl } from "../credit-guard-impl.js"
import { mapReserveError } from "../../../lib/reserve-errors.js"
import { allowanceFor, __resetDeploymentAllowanceCacheForTests } from "../../billing/deployment-allowance-service.js"

const REQUESTER = "requester-1"
const PAYER = "payer-acct"
const DEP_CTX = {
  payer: "deployment" as const,
  userId: REQUESTER,
  payerId: PAYER,
  entitlements: { watermark: false as const, dailyCapCredits: null, parallelism: 4, tierForGates: "business" },
}

/** A payer wallet with plenty in it — the wealth check must PASS so the
 *  allowance check is the thing under test. */
function richPayer(): void {
  tableResponses.set("profiles", {
    data: {
      role: "user",
      tier: "business",
      subscription_tier: "business",
      lifetime_topup_credits: 0,
      subscription_credits: 10_000_000,
      topup_credits: 0,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString().slice(0, 10),
      storage_used_bytes: 0,
      storage_limit_bytes: 1_000_000_000,
    },
    error: null,
  })
}

function price(cost: number): void {
  tableResponses.set("model_pricing", { data: { credit_cost: cost, is_enabled: true, tier_restriction: null }, error: null })
}

/** The settings singleton the D7 fallback reads for a user with no row. */
function defaultAllowance(credits: number): void {
  tableResponses.set("deployment_payer_settings", { data: { default_allowance_credits: credits }, error: null })
}

/** No allowance row for this user — the D7 branch. A CLEAN empty answer
 *  (`data: null, error: null`), which is what PostgREST returns for a
 *  `maybeSingle()` that matched nothing; an error would be "unavailable"
 *  instead, a different case with a different (null) answer. */
function noAllowanceRow(): void {
  tableResponses.set("deployment_user_allowances", { data: null, error: null })
}

/** An existing allowance row. `remaining` is granted − reserved − spent. */
function allowanceRow(granted: number, reserved: number, spent: number): void {
  tableResponses.set("deployment_user_allowances", {
    data: { user_id: REQUESTER, granted_credits: granted, reserved_credits: reserved, spent_credits: spent },
    error: null,
  })
}

function makeReply() {
  const sent: Array<{ status: number; body: unknown }> = []
  return {
    sent,
    reply: {
      status(code: number) {
        return { send: (body: unknown) => { sent.push({ status: code, body }) } }
      },
    },
  }
}

const makeReq = (overrides: Record<string, unknown> = {}) => ({
  userId: REQUESTER, url: "/v1/generate-image", headers: {}, body: {}, billingContext: DEP_CTX, ...overrides,
})

// `getModelCreditBaseCost` caches by identifier for 60 s, so each case that
// needs its own price uses its own identifier rather than fighting the cache.
let modelSeq = 0
const nextModel = () => `alw-test-${++modelSeq}`

beforeEach(() => {
  tableResponses.clear()
  tablesTouched.length = 0
  mockFrom.mockClear()
  __resetDeploymentAllowanceCacheForTests()
  state.payerActive = true
  state.payerId = PAYER
  state.enforce = true
})

describe("the credit guard's allowance pre-flight", () => {
  // THE FIRST-GENERATE REGRESSION. Keep this test first, and keep it green.
  it("ALLOWS a user with no allowance row (D7: no row answers the default)", async () => {
    richPayer()
    price(5)
    defaultAllowance(400_000)
    noAllowanceRow()
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => nextModel())(makeReq() as never, reply as never)

    expect(sent).toHaveLength(0)
    // …and it really went through the service, not around it.
    expect(tablesTouched).toContain("deployment_user_allowances")
    expect(tablesTouched).toContain("deployment_payer_settings")
  })

  it("a user whose remaining cannot cover the run gets 402 user_allowance_exceeded", async () => {
    richPayer()
    price(12_000)
    allowanceRow(200_000, 0, 196_000) // remaining 4 000
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => nextModel())(makeReq() as never, reply as never)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.status).toBe(402)
    const body = sent[0]?.body as { error: { code: string; message: string }; required: number; remaining: number }
    expect(body.error.code).toBe("user_allowance_exceeded")
    // RAW credits, both of them — D10's both-or-neither rule.
    expect(body.required).toBe(12_000)
    expect(body.remaining).toBe(4_000)
  })

  it("the refusal carries no payer figure and no payer identity", async () => {
    richPayer()
    price(12_000)
    allowanceRow(200_000, 0, 196_000)
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => nextModel())(makeReq() as never, reply as never)

    const body = sent[0]?.body as Record<string, unknown>
    expect(body).not.toHaveProperty("balance")
    expect(body).not.toHaveProperty("granted") // the pool is not the subject; nor is the grant total
    expect(JSON.stringify(body)).not.toContain(PAYER)
    expect(JSON.stringify(body)).not.toContain("10000000")
  })

  it("speaks the SAME code and message the RPC's refusal maps to", async () => {
    richPayer()
    price(12_000)
    allowanceRow(200_000, 0, 196_000)
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => nextModel())(makeReq() as never, reply as never)

    // The guard's 402 and the reserve RPC's 402 are the same refusal seen
    // twice; a user must not be told two different things depending on which
    // one fired. `.raw` figures never travel — this asserts that too.
    const rpc = mapReserveError(new Error("USER_ALLOWANCE_EXCEEDED: granted 200000, remaining 4000, need 12000"))
    const body = sent[0]?.body as { error: { code: string; message: string } }
    expect(rpc).not.toBeNull()
    expect(body.error.code).toBe(rpc!.code)
    expect(body.error.message).toBe(rpc!.message)
    expect(body.error.message).not.toContain("196000")
  })

  it("allows a run that exactly exhausts the remaining allowance", async () => {
    richPayer()
    price(4_000)
    allowanceRow(200_000, 0, 196_000) // remaining 4 000 — equal, not short
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => nextModel())(makeReq() as never, reply as never)

    expect(sent).toHaveLength(0)
  })

  it("refuses NOTHING while enforcement is off, and reads no allowance table", async () => {
    state.enforce = false
    richPayer()
    price(12_000)
    allowanceRow(200_000, 0, 199_999) // remaining 1 — would refuse if read
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => nextModel())(makeReq() as never, reply as never)

    expect(sent).toHaveLength(0)
    expect(tablesTouched).not.toContain("deployment_user_allowances")
    expect(tablesTouched).not.toContain("deployment_payer_settings")
  })

  it("does NOT 402 while enforcement is off even though the allowance is VISIBLE and exhausted", async () => {
    // THE RULING. Display and enforcement are two switches: `allowanceFor`
    // answers a real (here: exhausted) figure the moment a payer is active, so
    // the sidebar can stop lying at rollout step 5 — and this guard must still
    // refuse nothing until step 8 flips `billing.allowances`. The two halves
    // are asserted together on purpose: without the visibility half this reads
    // as the old double-gate, where the service's own null did the work and
    // dropping the guard's `allowanceEnforcementActive()` term changed nothing.
    state.enforce = false
    richPayer()
    price(12_000)
    allowanceRow(200_000, 0, 200_000) // remaining 0 — nothing could cover the run

    // Visible: the read surface answers the exhausted figure, not null.
    expect(await allowanceFor(REQUESTER)).toEqual({ granted: 200_000, remaining: 0, spent: 200_000 })

    // Forget the tables THIS test's own visibility read touched, so what
    // follows measures the guard alone.
    tablesTouched.length = 0
    __resetDeploymentAllowanceCacheForTests()

    const { sent, reply } = makeReply()
    await creditGuardImpl(() => nextModel())(makeReq() as never, reply as never)

    // Not enforced: the run goes through — and the guard short-circuited
    // BEFORE the read, which is the property that keeps the pre-flip window
    // free of both refusals and queries.
    expect(sent).toHaveLength(0)
    expect(tablesTouched).not.toContain("deployment_user_allowances")
  })

  it("exempts the payer's own run (D13)", async () => {
    richPayer()
    price(12_000)
    allowanceRow(200_000, 0, 199_999)
    const { sent, reply } = makeReply()
    const req = makeReq({
      userId: PAYER,
      billingContext: { ...DEP_CTX, userId: PAYER },
    })
    await creditGuardImpl(() => nextModel())(req as never, reply as never)

    expect(sent).toHaveLength(0)
  })

  it("mainline: no payer ⇒ no allowance query at all", async () => {
    state.payerActive = false
    state.enforce = false
    richPayer()
    price(5)
    const { sent, reply } = makeReply()
    const req = makeReq({ billingContext: { payer: "user" as const, userId: REQUESTER } })
    await creditGuardImpl(() => nextModel())(req as never, reply as never)

    expect(sent).toHaveLength(0)
    expect(tablesTouched).not.toContain("deployment_user_allowances")
    expect(tablesTouched).not.toContain("deployment_payer_settings")
  })

  it("the payer-pool refusal is UNCHANGED — still insufficient_credits, still no balance", async () => {
    // The redaction that already exists must not be disturbed by the new
    // branch sitting next to it: an empty POOL is a different condition with
    // a different fixer, and the pool's size still never travels.
    tableResponses.set("profiles", {
      data: {
        role: "user", tier: "business", subscription_tier: "business", lifetime_topup_credits: 0,
        subscription_credits: 0, topup_credits: 0, daily_spent_credits: 0,
        last_daily_reset: new Date().toISOString().slice(0, 10),
        storage_used_bytes: 0, storage_limit_bytes: 1_000_000_000,
      },
      error: null,
    })
    price(5)
    defaultAllowance(400_000)
    noAllowanceRow()
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => nextModel())(makeReq() as never, reply as never)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.status).toBe(402)
    const body = sent[0]?.body as { error: { code: string; message: string }; required: number }
    expect(body.error.code).toBe("insufficient_credits")
    expect(body.error.message).toMatch(/administrator/i)
    expect(body).not.toHaveProperty("balance")
    expect(body.required).toBe(5)
  })
})
