import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * WS7 — the route half of the admin leak (spec D11, §8.3).
 *
 * Two things are being pinned here, and they pull in opposite directions:
 *
 *  1. **Under a deployment payer**, an admin must not read anyone's Nodaro
 *     credit figures and must not see the payer's row at all. The payer's own
 *     profile row is where Nodaro's real money sits; migration 381 hides it
 *     from the browser, and this route is the OTHER way in — it runs as the
 *     service role, which no RLS policy constrains.
 *
 *  2. **On mainline** — no `billing.payerAccount` — every byte of the response
 *     and the exact `select()` column string stay as they are today. Nodaro
 *     Cloud's own admin users page reads this route's browser-direct twin, and
 *     a stray column here is a behaviour change nobody asked for.
 *
 * The predicates are driven for real (`__setDeploymentPayerForTests` plus a
 * NODARO_SURFACE_PROFILE), never mocked: a mocked `deploymentPayerActive` would
 * pass whether or not the route actually consults it. The allowance SERVICE is
 * mocked, because its own 17 tests own the D7 no-row rule; what is under test
 * here is how the route renders a map, and a null.
 */

const ADMIN = "00000000-0000-4000-8000-000000000002"
const PAYER = "00000000-0000-4000-8000-000000000009"
const U1 = "00000000-0000-4000-8000-000000000101"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

const mockFrom = vi.fn()
const mockRpc = vi.fn()
vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args), rpc: (...args: unknown[]) => mockRpc(...args) },
}))

// The payer may also hold `admin` on a deployment; the gate under test is the
// payer-id refusal, not adminship, so both ids pass the role check here.
vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (
    req: { userId?: string },
    reply: { status: (code: number) => { send: (body: unknown) => void } },
  ) => {
    if (req.userId !== ADMIN && req.userId !== PAYER) {
      reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    }
  },
}))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { getBalance: vi.fn(), adminAdjustCredits: vi.fn() },
  invalidateModelPricingCache: vi.fn(),
}))

vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
  invalidateAdminCache: vi.fn(),
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn(),
}))

const mockAllowancesFor = vi.fn()
const mockAllowanceFor = vi.fn()
vi.mock("@/ee/billing/deployment-allowance-service.js", () => ({
  allowancesFor: (...a: unknown[]) => mockAllowancesFor(...a),
  allowanceFor: (...a: unknown[]) => mockAllowanceFor(...a),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { adminCreditsRoutes } from "../admin-credits.js"
import { CreditsService } from "../../billing/credits.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import {
  __setDeploymentPayerForTests,
  __resetDeploymentPayerForTests,
} from "../../../lib/deployment-payer.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Exactly the columns today's `select()` names — no more, so the key-set
 *  assertion below measures the ROUTE's shape and not the fixture's. */
const MAINLINE_ROW = {
  id: U1,
  display_name: "Test User",
  avatar_url: null,
  tier: "pro",
  subscription_tier: "pro",
  lifetime_topup_credits: 0,
  subscription_credits: 500,
  topup_credits: 100,
  daily_spent_credits: 10,
  storage_used_bytes: 1024,
  storage_limit_bytes: 50_000_000_000,
  created_at: "2025-01-01T00:00:00Z",
}

/** The payer branch also selects the three identity columns the page needs —
 *  and does NOT select `display_name`, which `profiles` does not have, so the
 *  fixture must not carry it either (a stub that answers a non-column is how
 *  this defect stayed invisible in the first place). */
const { display_name: _mainlineOnlyName, ...PAYER_ROW_BASE } = MAINLINE_ROW
const PAYER_ROW = { ...PAYER_ROW_BASE, email: "u1@example.com", full_name: "Test User", role: "user" }

const TODAYS_COLUMNS =
  "id, display_name, avatar_url, tier, subscription_tier, lifetime_topup_credits, subscription_credits, topup_credits, daily_spent_credits, storage_used_bytes, storage_limit_bytes, created_at"

/**
 * The payer branch's projection, written out rather than derived: it is a claim
 * about the SCHEMA, and a derivation would just restate the route's own
 * expression. Today's columns MINUS `display_name` — `profiles` has no such
 * column (routes/me.ts:33; the name lives in `full_name`) and PostgREST refuses
 * the whole request naming it — PLUS the three identity columns the page needs.
 */
const PAYER_COLUMNS =
  "id, avatar_url, tier, subscription_tier, lifetime_topup_credits, subscription_credits, topup_credits, " +
  "daily_spent_credits, storage_used_bytes, storage_limit_bytes, created_at, email, full_name, role"

const REAL_ENV = process.env.NODARO_SURFACE_PROFILE

let selectedColumns: string | null
let neqCalls: Array<[string, unknown]>

/** A fluent Supabase chain that records what the route asked for. */
function chainReturning(result: { data: unknown; error: unknown; count?: number }) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.select = vi.fn((cols?: string) => {
    selectedColumns = cols ?? null
    return self()
  })
  chain.eq = vi.fn(self)
  chain.is = vi.fn(self)
  chain.limit = vi.fn(self)
  chain.or = vi.fn(self)
  chain.neq = vi.fn((col: string, val: unknown) => {
    neqCalls.push([col, val])
    return self()
  })
  chain.order = vi.fn(self)
  chain.range = vi.fn(self)
  chain.single = vi.fn(async () => result)
  chain.maybeSingle = vi.fn(async () => result)
  chain.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve({ data: result.data, error: result.error, count: result.count ?? null }),
  )
  return chain
}

/** The hosted shape: a real payer id and a real unit-bearing profile. */
function payerDeployment(): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
    billing: { unitLabel: "קרדיטים", unitRate: 2000, selfServe: false, payerAccount: PAYER },
  })
  __resetSurfaceProfileCacheForTests()
  __setDeploymentPayerForTests(PAYER)
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  selectedColumns = null
  neqCalls = []
  __resetDeploymentPayerForTests()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
  })
  await app.register(async (instance) => {
    await adminCreditsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  __resetDeploymentPayerForTests()
  if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
  __resetSurfaceProfileCacheForTests()
})

// ---------------------------------------------------------------------------
// Mainline identity — these must pass against the UNMODIFIED route
// ---------------------------------------------------------------------------

describe("GET /v1/admin/users — mainline (no deployment payer)", () => {
  it("returns today's exact key set: the credit columns, no `sai_*` figures, no identity columns", async () => {
    mockFrom.mockReturnValue(chainReturning({ data: [MAINLINE_ROW], error: null, count: 1 }))

    const res = await app.inject({ method: "GET", url: "/v1/admin/users", headers: { "x-user-id": ADMIN } })

    expect(res.statusCode).toBe(200)
    const row = res.json().data[0]
    expect(Object.keys(row).sort()).toEqual([
      "avatar_url",
      "created_at",
      "daily_spent_credits",
      "display_name",
      "effective_tier",
      "id",
      "lifetime_topup_credits",
      "storage_limit_bytes",
      "storage_used_bytes",
      "subscription_credits",
      "subscription_tier",
      "tier",
      "topup_credits",
      "total_credits",
    ])
    expect(row.total_credits).toBe(600)
  })

  it("searches by a HEBREW name — the term reaches the filter, not a bare space", async () => {
    const chain = chainReturning({ data: [MAINLINE_ROW], error: null, count: 1 })
    mockFrom.mockReturnValue(chain)

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/users?search=" + encodeURIComponent("דנה כהן"),
      headers: { "x-user-id": ADMIN },
    })

    expect(res.statusCode).toBe(200)
    const or = chain.or as ReturnType<typeof vi.fn>
    expect(or).toHaveBeenCalledTimes(1)
    const filter = String(or.mock.calls[0]?.[0])
    expect(filter).toContain("דנה כהן")
    expect(filter).not.toContain("%% %")
  })

  it("still strips PostgREST filter syntax out of a non-Latin search term", async () => {
    const chain = chainReturning({ data: [MAINLINE_ROW], error: null, count: 1 })
    mockFrom.mockReturnValue(chain)

    await app.inject({
      method: "GET",
      url: "/v1/admin/users?search=" + encodeURIComponent("דנה),or(id.eq.x"),
      headers: { "x-user-id": ADMIN },
    })

    const or = chain.or as ReturnType<typeof vi.fn>
    const filter = String(or.mock.calls[0]?.[0])
    // The filter itself is `display_name.ilike.%TERM%,email.ilike.%TERM%`, so
    // assert on the TERM between the first pair of percent signs, not on the
    // whole string (which legitimately carries commas and dots).
    const term = filter.slice(filter.indexOf("%") + 1, filter.indexOf("%", filter.indexOf("%") + 1))
    expect(term).toContain("דנה")
    expect(term).not.toMatch(/[(),:]/)
  })

  it("asks Postgres for today's exact column string and never filters the payer out", async () => {
    mockFrom.mockReturnValue(chainReturning({ data: [MAINLINE_ROW], error: null, count: 1 }))

    await app.inject({ method: "GET", url: "/v1/admin/users", headers: { "x-user-id": ADMIN } })

    expect(selectedColumns).toBe(TODAYS_COLUMNS)
    expect(neqCalls).toEqual([])
  })

  it("never consults the allowance service", async () => {
    mockFrom.mockReturnValue(chainReturning({ data: [MAINLINE_ROW], error: null, count: 1 }))

    await app.inject({ method: "GET", url: "/v1/admin/users", headers: { "x-user-id": ADMIN } })

    expect(mockAllowancesFor).not.toHaveBeenCalled()
  })
})

describe("GET /v1/admin/users/:id/balance and /transactions — mainline", () => {
  it("still answers the credit balance for any id", async () => {
    vi.mocked(CreditsService.getBalance).mockResolvedValue({ total: 600 } as never)

    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${PAYER}/balance`,
      headers: { "x-user-id": ADMIN },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ total: 600 })
    expect(CreditsService.getBalance).toHaveBeenCalledWith(PAYER)
  })

  it("still answers transactions for any id", async () => {
    mockFrom.mockReturnValue(chainReturning({ data: [{ id: "tx1" }], error: null }))

    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${PAYER}/transactions`,
      headers: { "x-user-id": ADMIN },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ id: "tx1" }])
  })
})

// ---------------------------------------------------------------------------
// Under a deployment payer
// ---------------------------------------------------------------------------

describe("GET /v1/admin/users — under a deployment payer", () => {
  beforeEach(() => payerDeployment())

  it("drops every Nodaro credit column and answers `sai_*` figures in units", async () => {
    mockFrom.mockReturnValue(chainReturning({ data: [PAYER_ROW], error: null, count: 1 }))
    mockAllowancesFor.mockResolvedValue(new Map([[U1, { granted: 200, remaining: 150, spent: 40 }]]))

    const res = await app.inject({ method: "GET", url: "/v1/admin/users", headers: { "x-user-id": ADMIN } })

    expect(res.statusCode).toBe(200)
    const row = res.json().data[0]
    expect(row.subscription_credits).toBeUndefined()
    expect(row.topup_credits).toBeUndefined()
    expect(row.total_credits).toBeUndefined()
    // unitRate 2000: 200 credits is 400 000 display units.
    expect(row.sai_granted).toBe(400_000)
    expect(row.sai_remaining).toBe(300_000)
    // `spent` is the SETTLED figure and deliberately NOT `granted − remaining`
    // (here 50 credits), which also counts an in-flight RESERVATION as money
    // already gone. 40 credits at rate 2000 is 80 000 display units.
    expect(row.sai_spent).toBe(80_000)
    // The page needs these three, and the browser-direct read is no longer
    // allowed to supply them.
    expect(row.email).toBe("u1@example.com")
    expect(row.full_name).toBe("Test User")
    expect(row.role).toBe("user")
  })

  it("answers an exact key set with NO Nodaro credit figure of any kind (§9.2)", async () => {
    // RULING: spec §9.2 ("no credit columns anywhere") wins over D11's
    // narrower three-column list. `daily_spent_credits` and
    // `lifetime_topup_credits` are Nodaro figures about the DEPLOYMENT's money
    // — a deployment admin who sees either can reason about a wallet they do
    // not hold and cannot touch. The only spend figure they get is `sai_spent`,
    // in display units. Asserted as a whole key set, not as more
    // `toBeUndefined`s: a new credit column added to `USER_COLUMNS` later must
    // fail HERE.
    mockFrom.mockReturnValue(chainReturning({ data: [PAYER_ROW], error: null, count: 1 }))
    mockAllowancesFor.mockResolvedValue(new Map([[U1, { granted: 200, remaining: 150, spent: 40 }]]))

    const res = await app.inject({ method: "GET", url: "/v1/admin/users", headers: { "x-user-id": ADMIN } })

    const row = res.json().data[0]
    expect(Object.keys(row).sort()).toEqual([
      "avatar_url",
      "created_at",
      // No `display_name`: `profiles` has no such column, so the payer branch
      // does not ask for it and the page reads `full_name` (which it already
      // did — nothing downstream loses a field).
      "effective_tier",
      "email",
      "full_name",
      "id",
      "role",
      "sai_granted",
      "sai_remaining",
      "sai_spent",
      "storage_limit_bytes",
      "storage_used_bytes",
      "subscription_tier",
      "tier",
    ])
    // …and `lifetime_topup_credits` was still READ, on the way out: the
    // derived tier is computed from it before the drop.
    expect(row.effective_tier).toBeDefined()
  })

  it("a never-generated user's sai_spent is a real 0, not an em dash (D7)", async () => {
    // `spent: 0` is a TRUTH for a no-row user — they have settled nothing — and
    // `toUnits` is null-guarded rather than falsy-guarded precisely so a real
    // zero survives the conversion. Rendering it as null would put an em dash
    // where the page should say "has spent nothing yet", which is the same
    // confusion between "unavailable" and "zero" the whole track avoids.
    mockFrom.mockReturnValue(chainReturning({ data: [PAYER_ROW], error: null, count: 1 }))
    mockAllowancesFor.mockResolvedValue(new Map([[U1, { granted: 200, remaining: 200, spent: 0 }]]))

    const res = await app.inject({ method: "GET", url: "/v1/admin/users", headers: { "x-user-id": ADMIN } })

    const row = res.json().data[0]
    expect(row.sai_spent).toBe(0)
    expect(row.sai_granted).toBe(400_000)
    expect(row.sai_remaining).toBe(400_000)
  })

  it("omits the payer's own row at the query, so it cannot reach the page", async () => {
    mockFrom.mockReturnValue(chainReturning({ data: [PAYER_ROW], error: null, count: 1 }))
    mockAllowancesFor.mockResolvedValue(new Map())

    await app.inject({ method: "GET", url: "/v1/admin/users", headers: { "x-user-id": ADMIN } })

    expect(neqCalls).toEqual([["id", PAYER]])
    expect(selectedColumns).toBe(PAYER_COLUMNS)
  })

  it("asks Postgres only for columns `profiles` ACTUALLY HAS — this route is the page's only source", async () => {
    // Under a payer the browser-direct read is gone (381 narrows the policy),
    // so `useAdminUsers` switches to THIS route (use-admin-queries.ts:241). It
    // named `display_name`, a column `profiles` does not have; PostgREST
    // refuses the request outright, the route maps any query error to a 500,
    // and the admin user list is dead on exactly the deployments this branch is
    // for. The stub answers whatever the fixture holds, so only an explicit
    // assertion on the projection can see it.
    mockFrom.mockReturnValue(chainReturning({ data: [PAYER_ROW], error: null, count: 1 }))
    mockAllowancesFor.mockResolvedValue(new Map())

    await app.inject({ method: "GET", url: "/v1/admin/users", headers: { "x-user-id": ADMIN } })

    expect(selectedColumns).not.toContain("display_name")
    expect(selectedColumns).toContain("full_name")
  })

  it("searches the column the payer branch RENDERS — full_name, not the non-column", async () => {
    const chain = chainReturning({ data: [PAYER_ROW], error: null, count: 1 })
    mockFrom.mockReturnValue(chain)
    mockAllowancesFor.mockResolvedValue(new Map())

    await app.inject({
      method: "GET",
      url: "/v1/admin/users?search=" + encodeURIComponent("יוסי כהן"),
      headers: { "x-user-id": ADMIN },
    })

    const filter = String((chain.or as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
    expect(filter).toBe("full_name.ilike.%יוסי כהן%,email.ilike.%יוסי כהן%")
  })

  it("renders — (null), never 0, when the batch read is UNAVAILABLE", async () => {
    // The service answers null for the whole batch rather than a partial map
    // when the read (or the default behind it) failed. Zero would read as
    // "this user is exhausted", which is the one thing an admin would act on.
    // NB since the display/enforcement ruling, "enforcement is off" is NOT one
    // of the reasons for that null: an allowance is visible from the moment a
    // payer exists.
    mockFrom.mockReturnValue(chainReturning({ data: [PAYER_ROW], error: null, count: 1 }))
    mockAllowancesFor.mockResolvedValue(null)

    const res = await app.inject({ method: "GET", url: "/v1/admin/users", headers: { "x-user-id": ADMIN } })

    const row = res.json().data[0]
    expect(row.sai_granted).toBeNull()
    expect(row.sai_remaining).toBeNull()
    expect(row.sai_spent).toBeNull()
    expect(row.subscription_credits).toBeUndefined()
  })
})

describe("GET /v1/admin/users/:id/* — under a deployment payer", () => {
  beforeEach(() => payerDeployment())

  it("refuses the payer's balance to an admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${PAYER}/balance`,
      headers: { "x-user-id": ADMIN },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(CreditsService.getBalance).not.toHaveBeenCalled()
  })

  it("refuses the payer's transactions to an admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${PAYER}/transactions`,
      headers: { "x-user-id": ADMIN },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("lets the payer itself through", async () => {
    mockFrom.mockReturnValue(chainReturning({ data: [{ id: "tx1" }], error: null }))

    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${PAYER}/transactions`,
      headers: { "x-user-id": PAYER },
    })

    expect(res.statusCode).toBe(200)
  })

  it("answers another user's balance in display units, with no credit columns", async () => {
    mockAllowanceFor.mockResolvedValue({ granted: 200, remaining: 150, spent: 40 })

    const res = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${U1}/balance`,
      headers: { "x-user-id": ADMIN },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ sai_granted: 400_000, sai_remaining: 300_000, sai_spent: 80_000 })
    expect(CreditsService.getBalance).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// GET /v1/admin/credits/summary — the THIRD way in (F2)
// ---------------------------------------------------------------------------
//
// 381 hides the payer's `profiles` row in RLS and the two routes above refuse
// it by id, but this route never names an id: it publishes an AGGREGATE that
// the payer's row dominates. `totalCreditsOutstanding` sums every profile's
// credits; under a payer all the others hold the same frozen signup grant G,
// which the caller reads off its own /v1/user/credits, so
// `payer_balance = totalCreditsOutstanding − (totalUsers−1)·G` — an exact
// inversion, and two polls give the burn rate. `tierBreakdown` and
// `totalTransactions` leak the same account by other routes. So the whole
// route is refused to a non-payer caller under a payer, and left byte-identical
// on mainline — this is Nodaro Cloud's own platform route and no payer fix may
// change what it answers there. It has no frontend caller today, which is also
// why refusing it outright under a payer costs nothing.
const SUMMARY = { totalUsers: 42, totalCreditsOutstanding: 1_023_456, tierBreakdown: { free: 41, pro: 1 }, totalTransactions: 7 }

describe("GET /v1/admin/credits/summary", () => {
  it("MAINLINE: answers today's body, verbatim, to any admin", async () => {
    mockRpc.mockResolvedValue({ data: SUMMARY, error: null })

    const res = await app.inject({ method: "GET", url: "/v1/admin/credits/summary", headers: { "x-user-id": ADMIN } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(SUMMARY)
    expect(mockRpc).toHaveBeenCalledWith("get_credit_summary")
  })

  it("under a payer: refuses a non-payer admin — and never runs the aggregate", async () => {
    payerDeployment()
    mockRpc.mockResolvedValue({ data: SUMMARY, error: null })

    const res = await app.inject({ method: "GET", url: "/v1/admin/credits/summary", headers: { "x-user-id": ADMIN } })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    // The refusal must precede the read: a body computed and then discarded
    // still puts the payer's balance in a log line and a query plan.
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("under a payer: the payer itself still reads the summary", async () => {
    payerDeployment()
    mockRpc.mockResolvedValue({ data: SUMMARY, error: null })

    const res = await app.inject({ method: "GET", url: "/v1/admin/credits/summary", headers: { "x-user-id": PAYER } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(SUMMARY)
  })
})
