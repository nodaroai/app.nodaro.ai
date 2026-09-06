import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The BILLING INTEGRATION surface of `/v1/deployment-billing/*` — the verbs a
 * machine in the customer's back office drives with an integration key, as
 * opposed to the page the billing account drives with a browser session.
 *
 * Four properties are pinned here, and they are the four ways this surface
 * loses money or tells a lie:
 *
 *  1. **A user is named three ways and resolved once.** The back office knows
 *     the identity its own IdP asserts, never the studio's uuid, so `sso:` and
 *     `email:` are first-class. An ambiguous email is a REFUSAL, never a
 *     guess: allocating a paid quota to an arbitrary half of a duplicated
 *     address is the failure that costs a customer their plan.
 *
 *  2. **Every verb is replay-safe.** An integration retries and a webhook
 *     arrives twice. A replayed `set` is a `noop`; a replayed `renew` inside a
 *     day is refused, because a second renewal would zero a period's spend
 *     that the customer really used. That refusal is the single most
 *     expensive thing in this file to get wrong, and it lives in the ROUTE —
 *     the database will happily renew twice.
 *
 *  3. **Units never reach the ledger (R3).** `creditsFromUnits` on the way in,
 *     `toUnits` on the way out, and both figures on every response because an
 *     integration is a render boundary. Zero is a legal target for `set` and
 *     `renew` — a cancelled plan is a quota of 0 — and is still refused for a
 *     `grant`, which must move something.
 *
 *  4. **A read is a read.** `/usage` pages with a keyset cursor that covers
 *     the boundary row exactly once and never aggregates; `/pricing` answers
 *     304 against its own ETag; `/balance` computes `lowBalance` server-side
 *     so two callers cannot disagree about it.
 *
 * The allowance SERVICE is not mocked — Supabase is, and the RPCs dispatch by
 * name. Mocking the service would leave the RPC argument shape untested on
 * both sides of the seam, which is exactly where a unit that reached the
 * ledger would hide.
 */

const PAYER = "00000000-0000-4000-8000-000000000009"
const U1 = "00000000-0000-4000-8000-000000000101"
const U2 = "00000000-0000-4000-8000-000000000102"
const GHOST = "00000000-0000-4000-8000-0000000001ff"
const KEY_ID = "00000000-0000-4000-8000-00000000ffff"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

/** Results are keyed `table` or `table:list` / `table:single`, so one test can
 *  give a batch read an array and a `maybeSingle` on the SAME table an object.
 *  Without that split, `allowanceLedgerOne` reading a list fixture would build
 *  an allowance out of `undefined` and every figure would silently be 0. */
const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown; count?: number }
  const tableResults = new Map<string, Result>()
  const rpcHandlers = new Map<string, (args: Record<string, unknown>) => Result>()
  const rec = {
    fromCalls: [] as string[],
    selectCols: {} as Record<string, string | null>,
    filterCalls: [] as Array<{ table: string; op: string; args: unknown[] }>,
    writePayloads: [] as Array<{ table: string; op: string; payload: unknown }>,
    rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  }
  function chainFor(table: string): Record<string, unknown> {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    const result = (terminal: "list" | "single"): Result =>
      tableResults.get(`${table}:${terminal}`) ??
      tableResults.get(table) ?? { data: terminal === "list" ? [] : null, error: null, count: 0 }
    chain.select = (cols?: string) => {
      rec.selectCols[table] = cols ?? null
      return self()
    }
    for (const op of ["update", "insert", "delete", "upsert"] as const) {
      chain[op] = (payload?: unknown) => {
        rec.writePayloads.push({ table, op, payload })
        return self()
      }
    }
    const filters = ["eq", "neq", "in", "is", "gt", "gte", "lt", "lte", "or", "ilike", "order", "range", "limit", "not"]
    for (const op of filters) {
      chain[op] = (...args: unknown[]) => {
        rec.filterCalls.push({ table, op, args })
        return self()
      }
    }
    chain.single = async () => result("single")
    chain.maybeSingle = async () => result("single")
    chain.then = (resolve: (v: unknown) => void) => {
      const r = result("list")
      return resolve({ data: r.data, error: r.error, count: r.count ?? null })
    }
    return chain
  }
  class PriceNotConfiguredError extends Error {
    constructor(id: string) {
      super(`no price configured for ${id}`)
      this.name = "PriceNotConfiguredError"
    }
  }
  return {
    tableResults,
    rpcHandlers,
    rec,
    chainFor,
    PriceNotConfiguredError,
    getBalance: vi.fn(),
    getModelCreditCost: vi.fn(),
    invalidateBalanceCache: vi.fn(),
    config: { EDITION: "cloud" } as { EDITION: string; STRIPE_SECRET_KEY?: string },
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      h.rec.fromCalls.push(table)
      return h.chainFor(table)
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rec.rpcCalls.push({ name, args })
      const handler = h.rpcHandlers.get(name)
      return handler ? handler(args) : { data: null, error: null }
    },
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: h.config,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasCredits: () => true,
  hasAdmin: () => true,
}))

vi.mock("@/ee/billing/stripe-client.js", () => ({ getStripe: () => ({}) }))
vi.mock("@/ee/billing/provision-credits.js", () => ({ ensureStripeCustomer: vi.fn() }))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: {
    getBalance: (...a: unknown[]) => h.getBalance(...a),
    getModelCreditCost: (...a: unknown[]) => h.getModelCreditCost(...a),
  },
  PriceNotConfiguredError: h.PriceNotConfiguredError,
}))

vi.mock("@/ee/routes/credits.js", () => ({
  invalidateBalanceCache: (...a: unknown[]) => h.invalidateBalanceCache(...a),
}))

const { tableResults, rpcHandlers, rec } = h

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { deploymentBillingRoutes } from "../deployment-billing.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } from "../../../lib/deployment-payer.js"
import {
  __resetDeploymentAllowanceCacheForTests,
  applyPendingAllowance,
} from "../../billing/deployment-allowance-service.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REAL_ENV = process.env.NODARO_SURFACE_PROFILE

/** 1 credit = 2000 units, a payer, enforcement still off — the state the
 *  integration is wired against before the flip. */
function payerDeployment(extra: Record<string, unknown> = {}, models?: { allow?: string[]; deny?: string[] }): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
    billing: {
      unitLabel: "קרדיטים",
      unitRate: 2000,
      unitDecimals: 0,
      selfServe: false,
      payerAccount: PAYER,
      ...extra,
    },
    ...(models ? { models: { allow: models.allow ?? [], deny: models.deny ?? [] } } : {}),
  })
  __resetSurfaceProfileCacheForTests()
  __setDeploymentPayerForTests(PAYER)
}

/** What `set_deployment_allowance` answers: PostgREST returns an ARRAY of one
 *  row for a `RETURNS TABLE` function, and the service unwraps it. */
function allowanceRpcRow(over: Record<string, unknown> = {}) {
  return {
    data: [
      {
        applied: "set",
        granted_credits: 10,
        reserved_credits: 0,
        spent_credits: 0,
        reset_at: null,
        ...over,
      },
    ],
    error: null,
  }
}

let app: FastifyInstance

/** `x-user-id` is the identity, `x-auth-kind` the credential class. A
 *  `billing_key` request also carries `req.billingKey`, exactly as the auth
 *  hook stamps it — without that field `rejectProgrammaticAuth`'s billing-key
 *  branch is never reached and every "a key may do this" assertion below would
 *  pass for the wrong reason. */
async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false })
  instance.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
    const kind = req.headers["x-auth-kind"]
    req.authKind = typeof kind === "string" ? (kind as NonNullable<typeof req.authKind>) : "jwt"
    if (req.authKind === "api_token") req.apiToken = { id: "tok", userId: String(userId) } as never
    if (req.authKind === "app_token") req.appAuthorization = { id: "auth" } as never
    if (req.authKind === "billing_key") req.billingKey = { id: KEY_ID, name: "back office" }
  })
  await instance.register(async (i) => {
    await deploymentBillingRoutes(i)
  })
  await instance.ready()
  return instance
}

const AS_PAYER = { "x-user-id": PAYER }
const AS_KEY = { "x-user-id": PAYER, "x-auth-kind": "billing_key" }

beforeEach(async () => {
  vi.clearAllMocks()
  tableResults.clear()
  rpcHandlers.clear()
  rec.fromCalls = []
  rec.selectCols = {}
  rec.filterCalls = []
  rec.writePayloads = []
  rec.rpcCalls = []
  delete h.config.STRIPE_SECRET_KEY
  __resetDeploymentPayerForTests()
  __resetDeploymentAllowanceCacheForTests()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  app = await buildApp()
})

afterEach(async () => {
  await app.close()
  __resetDeploymentPayerForTests()
  __resetDeploymentAllowanceCacheForTests()
  if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
  __resetSurfaceProfileCacheForTests()
})

/** The user exists and every lookup says so. */
function userExists(userId: string, opts: { subject?: string; email?: string } = {}): void {
  tableResults.set("profiles:single", { data: { id: userId, email: opts.email ?? "dana@example.com" }, error: null })
  tableResults.set("profiles:list", {
    data: [{ id: userId, email: opts.email ?? "dana@example.com", full_name: "Dana" }],
    error: null,
    count: 1,
  })
  rpcHandlers.set("find_user_by_sso_subject", () => ({ data: userId, error: null }))
  rpcHandlers.set("sso_subjects_for", () => ({
    data: [{ id: userId, sso_subject: opts.subject ?? "usr_01HZX" }],
    error: null,
  }))
}

/** Nobody answers to any of the three forms. */
function userAbsent(): void {
  tableResults.set("profiles:single", { data: null, error: null })
  tableResults.set("profiles:list", { data: [], error: null, count: 0 })
  rpcHandlers.set("find_user_by_sso_subject", () => ({ data: null, error: null }))
  rpcHandlers.set("sso_subjects_for", () => ({ data: [], error: null }))
}

const ALLOWANCE = (ref: string) => `/v1/deployment-billing/users/${ref}/allowance`

// ===========================================================================
// PUT /users/:ref/allowance — the three identity forms
// ===========================================================================

describe("PUT /users/:ref/allowance — naming the user", () => {
  beforeEach(() => {
    payerDeployment()
    tableResults.set("deployment_user_allowances", { data: null, error: null })
    tableResults.set("deployment_payer_settings", { data: { default_allowance_credits: 100 }, error: null })
    rpcHandlers.set("set_deployment_allowance", () => allowanceRpcRow())
  })

  it("accepts a studio uuid and passes the RESOLVED id to the RPC", async () => {
    userExists(U1)
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(U1),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "set" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.userId).toBe(U1)
    const call = rec.rpcCalls.find((c) => c.name === "set_deployment_allowance")
    expect(call?.args.p_user_id).toBe(U1)
    // R3: 20 000 units at 2000/credit is TEN credits, and ten is what the
    // ledger must see. A unit that reached the RPC would be a 2000x
    // over-allocation the database cannot notice.
    expect(call?.args.p_target_credits).toBe(10)
  })

  it("accepts sso:<subject> and resolves it through the trusted subject lookup", async () => {
    userExists(U1, { subject: "usr_01HZX" })
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE("sso:usr_01HZX"),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "set" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.userId).toBe(U1)
    expect(rec.rpcCalls.some((c) => c.name === "find_user_by_sso_subject" && c.args.p_subject === "usr_01HZX")).toBe(
      true,
    )
  })

  it("accepts email:<addr>, URL-ENCODED, and matches it case-insensitively", async () => {
    userExists(U1, { email: "Dana@Example.com" })
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(encodeURIComponent("email:DANA@example.com")),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "set" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.userId).toBe(U1)
  })

  it("refuses a reference that is none of the three forms with 400 invalid_user_ref", async () => {
    userExists(U1)
    for (const ref of ["not-a-uuid", "sso:", "email:", "email:nope", "%20"]) {
      const res = await app.inject({
        method: "PUT",
        url: ALLOWANCE(ref),
        headers: AS_PAYER,
        payload: { units: 20_000, mode: "set" },
      })
      expect(res.statusCode, ref).toBe(400)
      expect(res.json().error.code, ref).toBe("invalid_user_ref")
    }
    expect(rec.rpcCalls.some((c) => c.name === "set_deployment_allowance")).toBe(false)
  })

  it("refuses an AMBIGUOUS email with 409 user_ambiguous and writes nothing", async () => {
    tableResults.set("profiles:list", {
      data: [
        { id: U1, email: "dana@example.com" },
        { id: U2, email: "DANA@example.com" },
      ],
      error: null,
    })
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(encodeURIComponent("email:dana@example.com")),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "set" },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("user_ambiguous")
    expect(rec.rpcCalls.some((c) => c.name === "set_deployment_allowance")).toBe(false)
  })

  it("refuses the billing account itself, by uuid AND through a subject that resolves to it", async () => {
    userExists(PAYER)
    for (const ref of [PAYER, "sso:usr_01HZX"]) {
      const res = await app.inject({
        method: "PUT",
        url: ALLOWANCE(ref),
        headers: AS_PAYER,
        payload: { units: 20_000, mode: "set" },
      })
      expect(res.statusCode, ref).toBe(400)
      expect(res.json().error.code, ref).toBe("payer_has_no_allowance")
    }
  })

  it("answers 404 user_not_found for a UUID nobody answers to — a uuid cannot be pending", async () => {
    userAbsent()
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(GHOST),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "set" },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("user_not_found")
    expect(rec.writePayloads.some((w) => w.table === "deployment_allowance_pending")).toBe(false)
  })
})

// ===========================================================================
// set / renew semantics
// ===========================================================================

describe("PUT /users/:ref/allowance — set, renew and the replay rules", () => {
  beforeEach(() => {
    payerDeployment()
    userExists(U1)
    tableResults.set("deployment_payer_settings", { data: { default_allowance_credits: 100 }, error: null })
  })

  it("returns BOTH units and credits for every allowance figure", async () => {
    tableResults.set("deployment_user_allowances", { data: null, error: null })
    rpcHandlers.set("set_deployment_allowance", () =>
      allowanceRpcRow({ applied: "set", granted_credits: 10, reserved_credits: 1, spent_credits: 2 }),
    )
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(U1),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "set" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({
      userId: U1,
      applied: "set",
      allowance: {
        granted: { units: 20_000, credits: 10 },
        remaining: { units: 14_000, credits: 7 },
        spent: { units: 4_000, credits: 2 },
        resetAt: null,
      },
    })
  })

  it("is idempotent: a replayed set is applied 'noop' and invalidates no cache", async () => {
    tableResults.set("deployment_user_allowances", { data: null, error: null })
    rpcHandlers.set("set_deployment_allowance", () => allowanceRpcRow({ applied: "noop" }))
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(U1),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "set" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.applied).toBe("noop")
    // Nothing moved, so nothing to invalidate — and a cache drop here would
    // make the page redraw for a write that never happened.
    expect(h.invalidateBalanceCache).not.toHaveBeenCalled()
  })

  it("invalidates the requester's balance cache on an APPLIED write", async () => {
    tableResults.set("deployment_user_allowances", { data: null, error: null })
    rpcHandlers.set("set_deployment_allowance", () => allowanceRpcRow({ applied: "set" }))
    await app.inject({ method: "PUT", url: ALLOWANCE(U1), headers: AS_PAYER, payload: { units: 20_000, mode: "set" } })
    expect(h.invalidateBalanceCache).toHaveBeenCalledWith(U1)
  })

  it("renews, then refuses an immediate second renew with 409 renewal_too_soon naming resetAt", async () => {
    const justNow = new Date(Date.now() - 60_000).toISOString()
    tableResults.set("deployment_user_allowances:single", {
      data: { user_id: U1, granted_credits: 10, reserved_credits: 0, spent_credits: 0, reset_at: justNow },
      error: null,
    })
    rpcHandlers.set("set_deployment_allowance", () => allowanceRpcRow({ applied: "renew", reset_at: justNow }))
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(U1),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "renew" },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("renewal_too_soon")
    expect(res.json().error.detail).toContain(justNow)
    // The whole point: the RPC that would zero a real period's spend never ran.
    expect(rec.rpcCalls.some((c) => c.name === "set_deployment_allowance")).toBe(false)
  })

  it("allows the same renew with force: true", async () => {
    const justNow = new Date(Date.now() - 60_000).toISOString()
    tableResults.set("deployment_user_allowances:single", {
      data: { user_id: U1, granted_credits: 10, reserved_credits: 0, spent_credits: 0, reset_at: justNow },
      error: null,
    })
    rpcHandlers.set("set_deployment_allowance", () => allowanceRpcRow({ applied: "renew", reset_at: justNow }))
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(U1),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "renew", force: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.applied).toBe("renew")
    expect(rec.rpcCalls.find((c) => c.name === "set_deployment_allowance")?.args.p_mode).toBe("renew")
  })

  it("allows a renew when the last one was more than 24 hours ago", async () => {
    const longAgo = new Date(Date.now() - 40 * 3_600_000).toISOString()
    tableResults.set("deployment_user_allowances:single", {
      data: { user_id: U1, granted_credits: 10, reserved_credits: 0, spent_credits: 0, reset_at: longAgo },
      error: null,
    })
    rpcHandlers.set("set_deployment_allowance", () => allowanceRpcRow({ applied: "renew" }))
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(U1),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "renew" },
    })
    expect(res.statusCode).toBe(200)
  })

  it("refuses an unverifiable renew rather than risk zeroing a live period", async () => {
    // The ledger read failed, so "when was this last renewed?" has no answer.
    // Guessing "never" would let a duplicate webhook wipe a real spend figure.
    tableResults.set("deployment_user_allowances:single", { data: null, error: { message: "boom" } })
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(U1),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "renew" },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("read_failed")
    expect(rec.rpcCalls.some((c) => c.name === "set_deployment_allowance")).toBe(false)
  })

  it("refuses an unknown mode with 400", async () => {
    tableResults.set("deployment_user_allowances", { data: null, error: null })
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(U1),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "topup" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("allowance_mode_invalid")
  })

  it("maps the database's below-committed refusal to 409", async () => {
    tableResults.set("deployment_user_allowances", { data: null, error: null })
    rpcHandlers.set("set_deployment_allowance", () => ({
      data: null,
      error: { message: "ALLOWANCE_BELOW_COMMITTED: target 4 is below reserved+spent 9" },
    }))
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(U1),
      headers: AS_PAYER,
      payload: { units: 8_000, mode: "set" },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("allowance_below_committed")
  })
})

// ===========================================================================
// Units
// ===========================================================================

describe("PUT /users/:ref/allowance — the unit rule", () => {
  beforeEach(() => {
    payerDeployment()
    userExists(U1)
    tableResults.set("deployment_user_allowances", { data: null, error: null })
    tableResults.set("deployment_payer_settings", { data: { default_allowance_credits: 100 }, error: null })
    rpcHandlers.set("set_deployment_allowance", () => allowanceRpcRow())
  })

  it("still refuses a figure that is not a whole number of credits", async () => {
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(U1),
      headers: AS_PAYER,
      payload: { units: 20_001, mode: "set" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("unit_not_whole_credits")
    expect(rec.rpcCalls.some((c) => c.name === "set_deployment_allowance")).toBe(false)
  })

  it("accepts ZERO as a target for set and for renew — a cancelled plan is a quota of 0", async () => {
    rpcHandlers.set("set_deployment_allowance", () => allowanceRpcRow({ granted_credits: 0 }))
    for (const mode of ["set", "renew"]) {
      rec.rpcCalls = []
      tableResults.set("deployment_user_allowances:single", {
        data: { user_id: U1, granted_credits: 10, reserved_credits: 0, spent_credits: 0, reset_at: null },
        error: null,
      })
      const res = await app.inject({
        method: "PUT",
        url: ALLOWANCE(U1),
        headers: AS_PAYER,
        payload: { units: 0, mode },
      })
      expect(res.statusCode, mode).toBe(200)
      expect(rec.rpcCalls.find((c) => c.name === "set_deployment_allowance")?.args.p_target_credits, mode).toBe(0)
    }
  })

  it("still refuses ZERO on a grant — a grant must move something", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/deployment-billing/users/${U1}/grant`,
      headers: AS_PAYER,
      payload: { units: 0 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_units")
  })

  it("refuses a negative target — a downgrade is a lower target, never a negative one", async () => {
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(U1),
      headers: AS_PAYER,
      payload: { units: -20_000, mode: "set" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_units")
  })

  it("caps the note at 500 characters, with its own code", async () => {
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(U1),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "set", note: "x".repeat(501) },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("note_too_long")
  })
})

// ===========================================================================
// The pending path
// ===========================================================================

describe("PUT /users/:ref/allowance — the user who has not signed in yet", () => {
  beforeEach(() => {
    payerDeployment()
    userAbsent()
    tableResults.set("deployment_payer_settings", { data: { default_allowance_credits: 100 }, error: null })
  })

  it("stores the intent and answers 202 pending for an unknown SUBJECT", async () => {
    tableResults.set("deployment_allowance_pending:single", {
      data: { id: "11111111-1111-4111-8111-111111111111", expires_at: "2026-12-05T10:41:00.000Z" },
      error: null,
    })
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE("sso:usr_new"),
      headers: AS_KEY,
      payload: { units: 20_000, mode: "set", note: "plan 10" },
    })
    expect(res.statusCode).toBe(202)
    expect(res.json().data).toEqual({ status: "pending", expiresAt: "2026-12-05T10:41:00.000Z" })
    const write = rec.writePayloads.find((w) => w.table === "deployment_allowance_pending" && w.op === "insert")
    expect(write?.payload).toMatchObject({
      sso_subject: "usr_new",
      target_credits: 10,
      mode: "set",
      created_by: PAYER,
      credential_id: KEY_ID,
    })
    // Nothing was applied — no allowance RPC ran at all.
    expect(rec.rpcCalls.some((c) => c.name === "set_deployment_allowance")).toBe(false)
  })

  it("stores the intent for an unknown EMAIL, lower-cased", async () => {
    tableResults.set("deployment_allowance_pending:single", {
      data: { id: "11111111-1111-4111-8111-111111111112", expires_at: "2026-12-05T10:41:00.000Z" },
      error: null,
    })
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(encodeURIComponent("email:Yosef@Example.com")),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "set" },
    })
    expect(res.statusCode).toBe(202)
    const write = rec.writePayloads.find((w) => w.table === "deployment_allowance_pending" && w.op === "insert")
    expect((write?.payload as { email: string }).email).toBe("yosef@example.com")
  })

  it("a sign-in applies the intent, and the NEXT set is then a real delta", async () => {
    // 1. pending
    tableResults.set("deployment_allowance_pending:single", {
      data: { id: "11111111-1111-4111-8111-111111111113", expires_at: "2026-12-05T10:41:00.000Z" },
      error: null,
    })
    const first = await app.inject({
      method: "PUT",
      url: ALLOWANCE("sso:usr_late"),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "set" },
    })
    expect(first.statusCode).toBe(202)

    // 2. the sign-in — the same call `sso-linking.ts` makes after createUser.
    rpcHandlers.set("apply_pending_deployment_allowance", () => ({ data: 1, error: null }))
    await expect(applyPendingAllowance(U2, "usr_late", null)).resolves.toBe(1)

    // 3. the account now exists, and a second `set` at the same figure is a
    //    noop against the applied intent rather than a second allocation.
    userExists(U2, { subject: "usr_late" })
    tableResults.set("deployment_user_allowances:single", {
      data: { user_id: U2, granted_credits: 10, reserved_credits: 0, spent_credits: 0, reset_at: null },
      error: null,
    })
    rpcHandlers.set("set_deployment_allowance", () => allowanceRpcRow({ applied: "noop" }))
    const second = await app.inject({
      method: "PUT",
      url: ALLOWANCE("sso:usr_late"),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "set" },
    })
    expect(second.statusCode).toBe(200)
    expect(second.json().data).toMatchObject({ userId: U2, applied: "noop" })

    // 4. and a HIGHER figure now moves a real delta.
    rpcHandlers.set("set_deployment_allowance", () => allowanceRpcRow({ applied: "set", granted_credits: 20 }))
    const third = await app.inject({
      method: "PUT",
      url: ALLOWANCE("sso:usr_late"),
      headers: AS_PAYER,
      payload: { units: 40_000, mode: "set" },
    })
    expect(third.statusCode).toBe(200)
    expect(third.json().data.applied).toBe("set")
    expect(third.json().data.allowance.granted).toEqual({ units: 40_000, credits: 20 })
  })

  it("a replayed pending write REPLACES the stored intent rather than queueing a second", async () => {
    tableResults.set("deployment_allowance_pending:single", {
      data: { id: "11111111-1111-4111-8111-111111111114", expires_at: "2026-12-05T10:41:00.000Z" },
      error: null,
    })
    await app.inject({
      method: "PUT",
      url: ALLOWANCE("sso:usr_new"),
      headers: AS_PAYER,
      payload: { units: 20_000, mode: "set" },
    })
    expect(rec.writePayloads.some((w) => w.table === "deployment_allowance_pending" && w.op === "delete")).toBe(true)
  })
})

// ===========================================================================
// GET /users — the two new columns
// ===========================================================================

describe("GET /users — ssoSubject and resetAt", () => {
  it("decorates each row with its trusted subject and its period start", async () => {
    payerDeployment()
    const resetAt = "2026-09-01T00:00:00.000Z"
    tableResults.set("profiles:list", {
      data: [
        { id: U1, email: "dana@example.com", full_name: "Dana", created_at: "2026-01-01T00:00:00.000Z" },
        { id: U2, email: "yosef@example.com", full_name: "Yosef", created_at: "2026-01-02T00:00:00.000Z" },
      ],
      error: null,
      count: 2,
    })
    tableResults.set("deployment_user_allowances:list", {
      data: [
        { user_id: U1, granted_credits: 10, reserved_credits: 0, spent_credits: 1, reset_at: resetAt },
        { user_id: U2, granted_credits: 5, reserved_credits: 0, spent_credits: 0, reset_at: null },
      ],
      error: null,
    })
    rpcHandlers.set("sso_subjects_for", () => ({ data: [{ id: U1, sso_subject: "usr_dana" }], error: null }))

    const res = await app.inject({ method: "GET", url: "/v1/deployment-billing/users", headers: AS_PAYER })
    expect(res.statusCode).toBe(200)
    const rows = res.json().data as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({ id: U1, ssoSubject: "usr_dana", resetAt })
    // Absent, not fabricated: a user with no federated identity is a different
    // fact from one whose subject we failed to read.
    expect(rows[1]).toMatchObject({ id: U2, ssoSubject: null, resetAt: null })
    // ONE lookup for the page, never one per row.
    expect(rec.rpcCalls.filter((c) => c.name === "sso_subjects_for")).toHaveLength(1)
  })
})

// ===========================================================================
// GET /users/resolve
// ===========================================================================

describe("GET /users/resolve", () => {
  beforeEach(() => {
    payerDeployment()
    tableResults.set("deployment_payer_settings", { data: { default_allowance_credits: 100 }, error: null })
  })

  it("answers the studio uuid, the email, the subject and the allowance for a subject", async () => {
    userExists(U1, { subject: "usr_dana", email: "dana@example.com" })
    tableResults.set("deployment_user_allowances:single", {
      data: { user_id: U1, granted_credits: 10, reserved_credits: 0, spent_credits: 2, reset_at: null },
      error: null,
    })
    const res = await app.inject({
      method: "GET",
      url: "/v1/deployment-billing/users/resolve?sso_subject=usr_dana",
      headers: AS_KEY,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({
      id: U1,
      email: "dana@example.com",
      ssoSubject: "usr_dana",
      provisioned: true,
      allowance: {
        granted: { units: 20_000, credits: 10 },
        remaining: { units: 16_000, credits: 8 },
        spent: { units: 4_000, credits: 2 },
        resetAt: null,
      },
    })
  })

  it("answers provisioned: false with the DEFAULT figures for a user who has no row", async () => {
    userExists(U1, { subject: "usr_dana" })
    tableResults.set("deployment_user_allowances:single", { data: null, error: null })
    const res = await app.inject({
      method: "GET",
      url: "/v1/deployment-billing/users/resolve?sso_subject=usr_dana",
      headers: AS_PAYER,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.provisioned).toBe(false)
    expect(res.json().data.allowance.granted).toEqual({ units: 200_000, credits: 100 })
  })

  it("404s when nobody matches", async () => {
    userAbsent()
    const res = await app.inject({
      method: "GET",
      url: "/v1/deployment-billing/users/resolve?email=nobody@example.com",
      headers: AS_PAYER,
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("user_not_found")
  })

  it("409s on an ambiguous email", async () => {
    tableResults.set("profiles:list", {
      data: [
        { id: U1, email: "dana@example.com" },
        { id: U2, email: "dana@example.com" },
      ],
      error: null,
    })
    const res = await app.inject({
      method: "GET",
      url: "/v1/deployment-billing/users/resolve?email=dana@example.com",
      headers: AS_PAYER,
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("user_ambiguous")
  })

  it("refuses both parameters at once, and neither, with invalid_user_ref", async () => {
    for (const q of ["", "?sso_subject=a&email=b@example.com"]) {
      const res = await app.inject({
        method: "GET",
        url: `/v1/deployment-billing/users/resolve${q}`,
        headers: AS_PAYER,
      })
      expect(res.statusCode, q).toBe(400)
      expect(res.json().error.code, q).toBe("invalid_user_ref")
    }
  })

  it("refuses the billing account", async () => {
    userExists(PAYER, { subject: "usr_support" })
    const res = await app.inject({
      method: "GET",
      url: "/v1/deployment-billing/users/resolve?sso_subject=usr_support",
      headers: AS_PAYER,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("payer_has_no_allowance")
  })
})

// ===========================================================================
// The credential — a key may allocate, and stamps its own id
// ===========================================================================

describe("the integration key on the write verbs", () => {
  beforeEach(() => {
    payerDeployment()
    userExists(U1)
    tableResults.set("deployment_user_allowances", { data: null, error: null })
    tableResults.set("deployment_payer_settings", { data: { default_allowance_credits: 100 }, error: null })
  })

  it("stamps credential_id on a set", async () => {
    rpcHandlers.set("set_deployment_allowance", () => allowanceRpcRow())
    const res = await app.inject({
      method: "PUT",
      url: ALLOWANCE(U1),
      headers: AS_KEY,
      payload: { units: 20_000, mode: "set" },
    })
    expect(res.statusCode).toBe(200)
    expect(rec.rpcCalls.find((c) => c.name === "set_deployment_allowance")?.args.p_credential_id).toBe(KEY_ID)
  })

  it("stamps NULL from the page's browser session", async () => {
    rpcHandlers.set("set_deployment_allowance", () => allowanceRpcRow())
    await app.inject({ method: "PUT", url: ALLOWANCE(U1), headers: AS_PAYER, payload: { units: 20_000, mode: "set" } })
    expect(rec.rpcCalls.find((c) => c.name === "set_deployment_allowance")?.args.p_credential_id).toBeNull()
  })

  it("stamps credential_id on a grant too", async () => {
    rpcHandlers.set("grant_deployment_allowance", () => ({ data: null, error: null }))
    const res = await app.inject({
      method: "POST",
      url: `/v1/deployment-billing/users/${U1}/grant`,
      headers: AS_KEY,
      payload: { units: 20_000 },
    })
    expect(res.statusCode).toBe(200)
    expect(rec.rpcCalls.find((c) => c.name === "grant_deployment_allowance")?.args.p_credential_id).toBe(KEY_ID)
  })
})
