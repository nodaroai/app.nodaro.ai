import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * WS4 — the billing account's own routes (spec §8.2), and the write half of
 * the allowance service they drive.
 *
 * Three things are pinned here, and they are the three ways this surface can
 * go wrong:
 *
 *  1. **Who may call it.** These routes read Nodaro's real balance, mint
 *     allocations and spend a card. The guard is IDENTITY (`req.userId ===
 *     deploymentPayerId()`) plus a first-party session — not adminship, which
 *     on a payer deployment the CUSTOMER mints. The real
 *     `requireDeploymentPayer` runs here on purpose: a mocked guard proves the
 *     handler works and says nothing about whether the gate is attached.
 *
 *  2. **Units never reach the ledger (R3).** `units` arrives from the browser
 *     in display units and is refused unless it divides by `billing.unitRate`
 *     into a WHOLE number of Nodaro credits. Every per-user figure that goes
 *     back out is converted at render, through the one conversion (`toUnits`).
 *     A route that passed a unit to `grant_deployment_allowance` would inflate
 *     every allocation by 2000x, and the ledger has no way to notice.
 *
 *  3. **The money edges.** `stripeConfigured` must never be answered by
 *     calling `getStripe()` — it THROWS when unconfigured (R4), which would
 *     turn a page load into a 500 on exactly the deployment the flag exists to
 *     describe. And the checkout's `success_url` must land on
 *     `/billing-admin?topup=true`: the stock billing routes return to
 *     `/billing`, a page `selfServe:false` withholds, so the payer would pay
 *     and then be bounced.
 *
 * The allowance SERVICE is NOT mocked — Supabase is. The write half is this
 * workstream's code too, and mocking it would leave the RPC argument shape
 * (the 2000x bug above) untested on both sides of the seam.
 */

const PAYER = "00000000-0000-4000-8000-000000000009"
const U1 = "00000000-0000-4000-8000-000000000101"
const U2 = "00000000-0000-4000-8000-000000000102"
const OTHER = "00000000-0000-4000-8000-000000000103"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

/** Per-table results the route/service will read, plus a record of what was
 *  asked for. A single fluent chain serves every table: the assertions read
 *  the recorded calls, so a query that quietly stops filtering is visible.
 *  All of it lives in `vi.hoisted` because the `vi.mock` factories below are
 *  hoisted above every top-level const. */
const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown; count?: number }
  const tableResults = new Map<string, Result>()
  const rec = {
    fromCalls: [] as string[],
    selectCols: {} as Record<string, string | null>,
    filterCalls: [] as Array<{ table: string; op: string; args: unknown[] }>,
    updatePayloads: [] as Array<{ table: string; payload: unknown }>,
  }
  function chainFor(table: string): Record<string, unknown> {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    const result = (): Result => tableResults.get(table) ?? { data: null, error: null, count: 0 }
    chain.select = (cols?: string) => {
      rec.selectCols[table] = cols ?? null
      return self()
    }
    chain.update = (payload: unknown) => {
      rec.updatePayloads.push({ table, payload })
      return self()
    }
    chain.insert = (payload: unknown) => {
      rec.updatePayloads.push({ table, payload })
      return self()
    }
    for (const op of ["eq", "neq", "in", "is", "gte", "lte", "or", "order", "range", "limit"]) {
      chain[op] = (...args: unknown[]) => {
        rec.filterCalls.push({ table, op, args })
        return self()
      }
    }
    chain.single = async () => result()
    chain.maybeSingle = async () => result()
    chain.then = (resolve: (v: unknown) => void) => {
      const r = result()
      return resolve({ data: r.data, error: r.error, count: r.count ?? null })
    }
    return chain
  }
  return {
    tableResults,
    rec,
    chainFor,
    rpc: vi.fn(),
    config: { EDITION: "cloud" } as { EDITION: string; STRIPE_SECRET_KEY?: string },
    getStripe: vi.fn(),
    getBalance: vi.fn(),
    invalidateBalanceCache: vi.fn(),
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      h.rec.fromCalls.push(table)
      return h.chainFor(table)
    },
    rpc: (...args: unknown[]) => h.rpc(...args),
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

vi.mock("@/ee/billing/stripe-client.js", () => ({ getStripe: () => h.getStripe() }))

vi.mock("@/ee/billing/provision-credits.js", () => ({ ensureStripeCustomer: vi.fn() }))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { getBalance: (...a: unknown[]) => h.getBalance(...a) },
}))

vi.mock("@/ee/routes/credits.js", () => ({
  invalidateBalanceCache: (...a: unknown[]) => h.invalidateBalanceCache(...a),
}))

const { tableResults, rec } = h
const mockRpc = h.rpc
const mockConfig = h.config
const mockGetStripe = h.getStripe
const mockGetBalance = h.getBalance

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { deploymentBillingRoutes } from "../deployment-billing.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } from "../../../lib/deployment-payer.js"
import { __resetDeploymentAllowanceCacheForTests } from "../../billing/deployment-allowance-service.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REAL_ENV = process.env.NODARO_SURFACE_PROFILE

/** The hosted shape: the deployment's unit trio, a payer, enforcement still
 *  OFF — which is the state at rollout step 6, when this page ships and the
 *  payer sets the default and tops people up. The page must show real figures
 *  there. */
function payerDeployment(extra: Record<string, unknown> = {}): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({
    billing: {
      unitLabel: "קרדיטים",
      unitRate: 2000,
      unitDecimals: 0,
      selfServe: false,
      payerAccount: PAYER,
      ...extra,
    },
  })
  __resetSurfaceProfileCacheForTests()
  __setDeploymentPayerForTests(PAYER)
}

let app: FastifyInstance

/** `x-user-id` sets the identity; `x-auth-kind` the credential class, so the
 *  guard's `ndr_`-token refusal is exercised through the same door. */
async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false })
  instance.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
    const kind = req.headers["x-auth-kind"]
    req.authKind = typeof kind === "string" ? (kind as "jwt" | "api_token" | "app_token") : "jwt"
    if (req.authKind === "api_token") req.apiToken = { id: "tok", userId: String(userId) } as never
    if (req.authKind === "app_token") req.appAuthorization = { id: "auth" } as never
    // A programmatic credential that nonetheless carries authKind "jwt" — the
    // shape the guard alone would let through, and the reason every write verb
    // ALSO calls rejectProgrammaticAuth. The two live in different files, and
    // either one going missing must not open the money surface.
    if (req.headers["x-app-auth"] === "1") req.appAuthorization = { id: "auth" } as never
  })
  await instance.register(async (i) => {
    await deploymentBillingRoutes(i)
  })
  await instance.ready()
  return instance
}

const AS_PAYER = { "x-user-id": PAYER }

beforeEach(async () => {
  vi.clearAllMocks()
  tableResults.clear()
  rec.fromCalls = []
  rec.selectCols = {}
  rec.filterCalls = []
  rec.updatePayloads = []
  delete mockConfig.STRIPE_SECRET_KEY
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

// ---------------------------------------------------------------------------
// The guard is attached — on every route, not just the one somebody tested
// ---------------------------------------------------------------------------

const EVERY_ROUTE: ReadonlyArray<{ method: "GET" | "PUT" | "POST"; url: string; body?: Record<string, unknown> }> = [
  { method: "GET", url: "/v1/deployment-billing/overview" },
  { method: "GET", url: "/v1/deployment-billing/transactions" },
  { method: "GET", url: "/v1/deployment-billing/users" },
  { method: "GET", url: `/v1/deployment-billing/users/${U1}/grants` },
  { method: "PUT", url: "/v1/deployment-billing/default-allowance", body: { units: 2000 } },
  { method: "POST", url: `/v1/deployment-billing/users/${U1}/grant`, body: { units: 2000 } },
  { method: "POST", url: "/v1/deployment-billing/checkout", body: { amountUsd: 10 } },
]

describe("the guard is on every route", () => {
  it("refuses an admin who is not the billing account, on all seven", async () => {
    payerDeployment()
    for (const r of EVERY_ROUTE) {
      const res = await app.inject({ method: r.method, url: r.url, headers: { "x-user-id": OTHER }, payload: r.body })
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403)
      expect(res.json().error.code, `${r.method} ${r.url}`).toBe("payer_required")
    }
  })

  it("refuses the payer's own PERSONAL API TOKEN on all seven — identity is not enough", async () => {
    payerDeployment()
    for (const r of EVERY_ROUTE) {
      const res = await app.inject({
        method: r.method,
        url: r.url,
        headers: { ...AS_PAYER, "x-auth-kind": "api_token" },
        payload: r.body,
      })
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403)
    }
  })

  it("refuses an unauthenticated caller with 401", async () => {
    payerDeployment()
    const res = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview" })
    expect(res.statusCode).toBe(401)
  })

  it("404s every route when no payer is configured — mounted anywhere, safe anywhere", async () => {
    for (const r of EVERY_ROUTE) {
      const res = await app.inject({ method: r.method, url: r.url, headers: AS_PAYER, payload: r.body })
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(404)
    }
  })

  it("refuses a programmatic credential that presents as a browser session, on the WRITE verbs", async () => {
    payerDeployment()
    const writes = EVERY_ROUTE.filter((r) => r.method !== "GET")
    for (const r of writes) {
      const res = await app.inject({
        method: r.method,
        url: r.url,
        headers: { ...AS_PAYER, "x-app-auth": "1" },
        payload: r.body,
      })
      // The guard passes this request (authKind is "jwt"); the second belt is
      // what refuses it. Deleting rejectProgrammaticAuth turns this green-red.
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403)
      expect(res.json().error.code, `${r.method} ${r.url}`).toBe("forbidden")
    }
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("refuses an OAuth app token on the WRITE verbs even though the guard already would", async () => {
    payerDeployment()
    const writes = EVERY_ROUTE.filter((r) => r.method !== "GET")
    for (const r of writes) {
      const res = await app.inject({
        method: r.method,
        url: r.url,
        headers: { ...AS_PAYER, "x-auth-kind": "app_token" },
        payload: r.body,
      })
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(403)
    }
  })
})

// ---------------------------------------------------------------------------
// GET /overview
// ---------------------------------------------------------------------------

describe("GET /v1/deployment-billing/overview", () => {
  beforeEach(() => {
    payerDeployment()
    mockGetBalance.mockResolvedValue({ total: 12_345, subscription: 1_000, topup: 11_345, tier: "pro", periodEnd: null })
    tableResults.set("deployment_payer_settings", { data: { default_allowance_credits: 200 }, error: null })
    tableResults.set("usage_logs", { data: [{ credits_used: 300 }, { credits_used: 600 }], error: null })
    tableResults.set("profiles", { data: null, error: null, count: 42 })
    tableResults.set("deployment_user_allowances", { data: null, error: null, count: 7 })
  })

  it("answers the payer's real balance in RAW Nodaro credits and the default in BOTH", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_PAYER })

    expect(res.statusCode).toBe(200)
    const d = res.json().data
    expect(d.payer.balanceCredits).toBe(12_345)
    // The default is 200 raw credits; at rate 2000 that is 400 000 display units.
    expect(d.defaultAllowance).toEqual({ credits: 200, units: 400_000 })
    expect(d.unit).toEqual({ label: "קרדיטים", rate: 2000, decimals: 0 })
    expect(mockGetBalance).toHaveBeenCalledWith(PAYER)
  })

  it("sums this period's burn from the PAYER's usage rows, and counts users", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_PAYER })

    const d = res.json().data
    expect(d.burn.credits).toBe(900)
    expect(d.burn.generations).toBe(2)
    expect(typeof d.burn.periodStart).toBe("string")
    expect(d.users).toEqual({ total: 42, provisioned: 7 })
    // The payer is not one of "the users" — it holds the pool, not an allowance.
    expect(rec.filterCalls.filter((c) => c.table === "profiles" && c.op === "neq")).toEqual([
      { table: "profiles", op: "neq", args: ["id", PAYER] },
    ])
  })

  it("reports stripeConfigured from the ENV, and never calls getStripe()", async () => {
    const off = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_PAYER })
    expect(off.json().data.stripeConfigured).toBe(false)

    mockConfig.STRIPE_SECRET_KEY = "sk_test_123"
    const on = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_PAYER })
    expect(on.json().data.stripeConfigured).toBe(true)

    // getStripe() THROWS when unconfigured (R4) — a page-load 500 on exactly
    // the deployment the flag describes.
    expect(mockGetStripe).not.toHaveBeenCalled()
  })

  it("reports whether enforcement is live, so the page can say 'nothing is refused yet'", async () => {
    const off = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_PAYER })
    expect(off.json().data.allowancesEnforced).toBe(false)

    payerDeployment({ allowances: "enforce" })
    const on = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_PAYER })
    expect(on.json().data.allowancesEnforced).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// GET /users — the per-user table, in UNITS, with the D7 no-row rule
// ---------------------------------------------------------------------------

describe("GET /v1/deployment-billing/users", () => {
  beforeEach(() => {
    payerDeployment()
    tableResults.set("profiles", {
      data: [
        { id: U1, email: "u1@acme.example", full_name: "One", created_at: "2026-01-01T00:00:00Z" },
        { id: U2, email: "u2@acme.example", full_name: "Two", created_at: "2026-01-02T00:00:00Z" },
      ],
      error: null,
      count: 2,
    })
    tableResults.set("deployment_payer_settings", { data: { default_allowance_credits: 200 }, error: null })
  })

  it("renders granted/remaining/spent in display units, and a user with NO ROW gets the default", async () => {
    // U1 has generated (a real row); U2 has never generated (no row at all).
    tableResults.set("deployment_user_allowances", {
      data: [{ user_id: U1, granted_credits: 200, reserved_credits: 20, spent_credits: 30 }],
      error: null,
    })

    const res = await app.inject({ method: "GET", url: "/v1/deployment-billing/users", headers: AS_PAYER })

    expect(res.statusCode).toBe(200)
    const rows = res.json().data as Array<Record<string, unknown>>
    const one = rows.find((r) => r.id === U1)!
    expect(one.granted).toBe(400_000) // 200 credits × 2000
    expect(one.remaining).toBe(300_000) // 200 − 20 − 30 = 150 credits
    expect(one.spent).toBe(60_000) // 30 credits
    expect(one.provisioned).toBe(true)

    const two = rows.find((r) => r.id === U2)!
    // D7: never 0, never an em dash — the default, because that is what this
    // user will actually get at their first Generate.
    expect(two.granted).toBe(400_000)
    expect(two.remaining).toBe(400_000)
    expect(two.spent).toBe(0)
    expect(two.provisioned).toBe(false)
  })

  it("shows real figures at rollout step 6, while `allowances` is still OFF", async () => {
    tableResults.set("deployment_user_allowances", {
      data: [{ user_id: U1, granted_credits: 400, reserved_credits: 0, spent_credits: 0 }],
      error: null,
    })

    const res = await app.inject({ method: "GET", url: "/v1/deployment-billing/users", headers: AS_PAYER })

    // The payer sets the default and tops people up BEFORE the flip. If this
    // read were gated on enforcement, every figure on the page would be an em
    // dash for two rollout steps and a top-up would read as a failed save.
    expect(res.json().data[0].granted).toBe(800_000)
  })

  it("never lists the payer's own row", async () => {
    tableResults.set("deployment_user_allowances", { data: [], error: null })

    await app.inject({ method: "GET", url: "/v1/deployment-billing/users", headers: AS_PAYER })

    expect(rec.filterCalls).toContainEqual({ table: "profiles", op: "neq", args: ["id", PAYER] })
  })

  it("asks Postgres only for columns `profiles` ACTUALLY HAS", async () => {
    // The stub answers whatever the fixture holds, so a non-existent column
    // name is invisible to every other assertion in this file — and this route
    // named one (`display_name`), which PostgREST refuses outright. Real
    // PostgREST answers `column "display_name" does not exist`, the route maps
    // any query error to a 500 `read_failed`, and the payer's user table never
    // renders. Pin the exact projection so the next added column is checked
    // against the schema (frontend/src/types/database.types.ts) and not against
    // this mock. `profiles` has NO `display_name`: the human-readable name is
    // `full_name` (routes/me.ts:33).
    tableResults.set("deployment_user_allowances", { data: [], error: null })

    await app.inject({ method: "GET", url: "/v1/deployment-billing/users", headers: AS_PAYER })

    expect(rec.selectCols.profiles).toBe("id, email, full_name, created_at")
  })

  it("searches the column the page RENDERS — a user shown by full_name is findable", async () => {
    // users-block renders `full_name || email || id`. Filtering on a column the
    // table does not have meant the on-screen name matched nothing (once the
    // 500 above was fixed), and the page reported `usersEmpty` — the payer's
    // honest reading being "this user does not exist".
    tableResults.set("deployment_user_allowances", { data: [], error: null })

    await app.inject({
      method: "GET",
      url: "/v1/deployment-billing/users?search=" + encodeURIComponent("יוסי כהן"),
      headers: AS_PAYER,
    })

    const or = rec.filterCalls.find((c) => c.op === "or")!
    expect(String(or.args[0])).toContain("full_name.ilike.%יוסי כהן%")
    expect(String(or.args[0])).not.toContain("display_name")
  })

  it("passes a search term through a strict allowlist, never raw", async () => {
    tableResults.set("deployment_user_allowances", { data: [], error: null })

    await app.inject({
      method: "GET",
      url: "/v1/deployment-billing/users?search=" + encodeURIComponent("bob*)%,or(x"),
      headers: AS_PAYER,
    })

    // `or()` takes a PostgREST filter EXPRESSION, so `%` and `,` are its own
    // syntax. The assertion is that the TERM carries none of the characters
    // that would let a search box rewrite the filter.
    const or = rec.filterCalls.find((c) => c.op === "or")!
    expect(String(or.args[0])).toBe("full_name.ilike.%boborx%,email.ilike.%boborx%")
  })

  it("searches by a HEBREW name — the display names on this deployment ARE Hebrew", async () => {
    // The allowlist used to be `[a-zA-Z0-9\s@.\-]`, which strips the whole
    // Hebrew block: the term sanitised to "", `sanitizeSearch` reported "no
    // search", the `.or()` was skipped and the route answered with EVERY user.
    // The payer typed a name, got the unfiltered list back, and had no way to
    // tell the filter had done nothing.
    tableResults.set("deployment_user_allowances", { data: [], error: null })

    await app.inject({
      method: "GET",
      url: "/v1/deployment-billing/users?search=" + encodeURIComponent("דנה כהן"),
      headers: AS_PAYER,
    })

    const or = rec.filterCalls.find((c) => c.op === "or")
    expect(or).toBeDefined()
    expect(String(or!.args[0])).toBe("full_name.ilike.%דנה כהן%,email.ilike.%דנה כהן%")
  })

  it("still strips PostgREST filter syntax out of a non-Latin term", async () => {
    // Widening the allowlist to Unicode LETTERS AND DIGITS must not widen it to
    // punctuation: `%`, `,`, `(`, `)` and `*` are `or()`'s own syntax, and they
    // are the injection vector whatever script surrounds them.
    tableResults.set("deployment_user_allowances", { data: [], error: null })

    await app.inject({
      method: "GET",
      url: "/v1/deployment-billing/users?search=" + encodeURIComponent("דנה*)%,or(x"),
      headers: AS_PAYER,
    })

    const or = rec.filterCalls.find((c) => c.op === "or")!
    expect(String(or.args[0])).toBe("full_name.ilike.%דנהorx%,email.ilike.%דנהorx%")
  })
})

// ---------------------------------------------------------------------------
// PUT /default-allowance — the unit discipline on input
// ---------------------------------------------------------------------------

describe("PUT /v1/deployment-billing/default-allowance", () => {
  beforeEach(() => {
    payerDeployment()
    tableResults.set("deployment_payer_settings", { data: { default_allowance_credits: 200 }, error: null })
  })

  it("writes RAW CREDITS to the settings row, never the unit figure", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/deployment-billing/default-allowance",
      headers: AS_PAYER,
      payload: { units: 400_000 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ units: 400_000, credits: 200 })
    const write = rec.updatePayloads.find((u) => u.table === "deployment_payer_settings")!
    expect((write.payload as Record<string, unknown>).default_allowance_credits).toBe(200)
    expect((write.payload as Record<string, unknown>).updated_by).toBe(PAYER)
  })

  it("400s a figure that is not a whole number of credits, and says the rate", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/deployment-billing/default-allowance",
      headers: AS_PAYER,
      payload: { units: 400_001 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("unit_not_whole_credits")
    expect(res.json().error.message).toContain("2000")
    expect(rec.updatePayloads).toEqual([])
  })

  it("400s a negative or non-integer default", async () => {
    for (const units of [-2000, 1.5, "400000", null]) {
      const res = await app.inject({
        method: "PUT",
        url: "/v1/deployment-billing/default-allowance",
        headers: AS_PAYER,
        payload: { units },
      })
      expect(res.statusCode, String(units)).toBe(400)
    }
    expect(rec.updatePayloads).toEqual([])
  })

  it("500s when the settings singleton does not exist — an UPDATE that matched nothing is not a save", async () => {
    tableResults.set("deployment_payer_settings", { data: [], error: null })

    const res = await app.inject({
      method: "PUT",
      url: "/v1/deployment-billing/default-allowance",
      headers: AS_PAYER,
      payload: { units: 400_000 },
    })

    // PostgREST reports a no-match UPDATE as a success that changed no row.
    // Answering 200 would tell the payer the default was saved when the boot
    // upsert has never run against this database.
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("allowance_unconfigured")
  })

  it("drops the cached default, so the page's next read is the value just saved", async () => {
    // Warm the cache with the OLD value through /overview…
    mockGetBalance.mockResolvedValue({ total: 0 })
    tableResults.set("usage_logs", { data: [], error: null })
    tableResults.set("profiles", { data: null, error: null, count: 0 })
    tableResults.set("deployment_user_allowances", { data: null, error: null, count: 0 })
    const before = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_PAYER })
    expect(before.json().data.defaultAllowance.credits).toBe(200)

    await app.inject({
      method: "PUT",
      url: "/v1/deployment-billing/default-allowance",
      headers: AS_PAYER,
      payload: { units: 800_000 },
    })
    tableResults.set("deployment_payer_settings", { data: { default_allowance_credits: 400 }, error: null })

    const after = await app.inject({ method: "GET", url: "/v1/deployment-billing/overview", headers: AS_PAYER })
    // Without the invalidation this reads 200 for up to a minute, which on the
    // page is indistinguishable from a save that silently failed.
    expect(after.json().data.defaultAllowance.credits).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /users/:id/grant — the RPC contract and its refusals
// ---------------------------------------------------------------------------

describe("POST /v1/deployment-billing/users/:id/grant", () => {
  beforeEach(() => {
    payerDeployment()
    mockRpc.mockResolvedValue({ data: null, error: null })
    tableResults.set("deployment_payer_settings", { data: { default_allowance_credits: 200 }, error: null })
    tableResults.set("deployment_user_allowances", {
      data: { user_id: U1, granted_credits: 210, reserved_credits: 0, spent_credits: 0 },
      error: null,
    })
  })

  it("calls grant_deployment_allowance with all five arguments, in RAW credits, actor = the payer", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/deployment-billing/users/${U1}/grant`,
      headers: AS_PAYER,
      payload: { units: 20_000, note: "September top-up" },
    })

    expect(res.statusCode).toBe(200)
    expect(mockRpc).toHaveBeenCalledWith("grant_deployment_allowance", {
      p_user_id: U1,
      p_credits: 10, // 20 000 units ÷ 2000 — the ledger never sees a unit
      p_actor_id: PAYER,
      p_kind: "topup",
      p_note: "September top-up",
    })
  })

  it("names the NOTE when the note is over-long — never `invalid_units` for a valid amount", async () => {
    // The schema used to be `{ units: z.unknown(), note: z.string().max(500) }`,
    // so an over-long note failed the WHOLE object; `units` was then read as
    // `undefined` and the route answered `invalid_units` → "Enter a whole
    // number." The payer's amount was a whole number, so the message named the
    // wrong field and retyping the amount failed identically. The textarea has
    // no maxLength and the column is bare `text`, so this route is the only
    // place the cap exists.
    const res = await app.inject({
      method: "POST",
      url: `/v1/deployment-billing/users/${U1}/grant`,
      headers: AS_PAYER,
      payload: { units: 20_000, note: "x".repeat(501) },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("note_too_long")
    expect(res.json().error.message).toContain("note")
    // Fail-closed: no RPC call, no grant row, nothing to undo.
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("accepts a note of exactly the cap, and still refuses a bad amount first", async () => {
    const ok = await app.inject({
      method: "POST",
      url: `/v1/deployment-billing/users/${U1}/grant`,
      headers: AS_PAYER,
      payload: { units: 20_000, note: "x".repeat(500) },
    })
    expect(ok.statusCode).toBe(200)

    // The amount is judged FIRST: a request that is wrong in both places is
    // still reported as the units problem, which is the one the payer must fix
    // before the grant can mean anything.
    mockRpc.mockClear()
    const bad = await app.inject({
      method: "POST",
      url: `/v1/deployment-billing/users/${U1}/grant`,
      headers: AS_PAYER,
      payload: { units: "twenty thousand", note: "x".repeat(501) },
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe("invalid_units")
  })

  it("refuses a non-text note by naming the note, not the amount", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/deployment-billing/users/${U1}/grant`,
      headers: AS_PAYER,
      payload: { units: 20_000, note: { nested: true } },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_note")
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("sends p_note as an explicit null when the payer wrote none — the RPC has no defaults", async () => {
    await app.inject({
      method: "POST",
      url: `/v1/deployment-billing/users/${U1}/grant`,
      headers: AS_PAYER,
      payload: { units: 20_000 },
    })

    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_note: null })
  })

  it("returns the user's allowance AFTER the grant, in units", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/deployment-billing/users/${U1}/grant`,
      headers: AS_PAYER,
      payload: { units: 20_000 },
    })

    // 210 credits granted (a 200 default + a 10-credit top-up: the RPC seeds
    // the default row and writes TWO grant rows for a never-generated user).
    expect(res.json().data.allowance).toEqual({ granted: 420_000, remaining: 420_000, spent: 0 })
  })

  it("400s a unit figure that is not a whole number of credits, without calling the RPC", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/deployment-billing/users/${U1}/grant`,
      headers: AS_PAYER,
      payload: { units: 1999 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("unit_not_whole_credits")
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("400s a zero grant before the database has to", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/deployment-billing/users/${U1}/grant`,
      headers: AS_PAYER,
      payload: { units: 0 },
    })
    expect(res.statusCode).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("maps every RPC refusal prefix to the status that means it", async () => {
    const cases: ReadonlyArray<[string, number, string]> = [
      ["ALLOWANCE_UNCONFIGURED: enforcement requested but deployment_payer_settings names no payer", 500, "allowance_unconfigured"],
      ["ALLOWANCE_ACTOR_NOT_PAYER: actor is not the billing account", 403, "allowance_actor_not_payer"],
      ["ALLOWANCE_KIND_INVALID: kind must be topup or correction", 400, "allowance_kind_invalid"],
      ["ALLOWANCE_ZERO_GRANT: credits must be non-zero", 400, "allowance_zero_grant"],
      ["ALLOWANCE_BELOW_COMMITTED: granted 100 would fall below reserved 20 + spent 90", 409, "allowance_below_committed"],
    ]
    for (const [message, status, code] of cases) {
      mockRpc.mockResolvedValueOnce({ data: null, error: { message } })
      const res = await app.inject({
        method: "POST",
        url: `/v1/deployment-billing/users/${U1}/grant`,
        headers: AS_PAYER,
        payload: { units: 20_000 },
      })
      expect(res.statusCode, message).toBe(status)
      expect(res.json().error.code, message).toBe(code)
    }
  })

  it("500s an unrecognised database error rather than reporting success", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "deadlock detected" } })
    const res = await app.inject({
      method: "POST",
      url: `/v1/deployment-billing/users/${U1}/grant`,
      headers: AS_PAYER,
      payload: { units: 20_000 },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("allowance_write_failed")
  })

  it("refuses to grant to the PAYER itself — it holds the pool, not an allowance (D13)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/deployment-billing/users/${PAYER}/grant`,
      headers: AS_PAYER,
      payload: { units: 20_000 },
    })
    expect(res.statusCode).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// GET /users/:id/grants — the history, with the overrun rows LABELLED
// ---------------------------------------------------------------------------

describe("GET /v1/deployment-billing/users/:id/grants", () => {
  it("returns each row's kind and its units, so an audit-only overrun can be labelled", async () => {
    payerDeployment()
    tableResults.set("deployment_payer_settings", { data: { default_allowance_credits: 200 }, error: null })
    tableResults.set("deployment_user_allowances", {
      data: { user_id: U1, granted_credits: 210, reserved_credits: 0, spent_credits: 10 },
      error: null,
    })
    tableResults.set("deployment_allowance_grants", {
      data: [
        { id: "g1", credits: 200, kind: "default", note: null, created_at: "2026-02-01T00:00:00Z" },
        { id: "g2", credits: 10, kind: "topup", note: "extra", created_at: "2026-02-02T00:00:00Z" },
        { id: "g3", credits: -4, kind: "overrun", note: "metered overrun", created_at: "2026-02-03T00:00:00Z" },
      ],
      error: null,
    })

    const res = await app.inject({ method: "GET", url: `/v1/deployment-billing/users/${U1}/grants`, headers: AS_PAYER })

    expect(res.statusCode).toBe(200)
    const body = res.json().data
    expect(body.grants.map((g: { kind: string }) => g.kind)).toEqual(["default", "topup", "overrun"])
    expect(body.grants[0].units).toBe(400_000)
    // Negative, and NOT in `granted` — 'overrun' is audit-only (invariant 4).
    expect(body.grants[2].units).toBe(-8_000)
    expect(body.user.granted).toBe(420_000)
  })
})

// ---------------------------------------------------------------------------
// POST /checkout — the payer's own card
// ---------------------------------------------------------------------------

describe("POST /v1/deployment-billing/checkout", () => {
  const sessionsCreate = vi.fn()

  beforeEach(() => {
    payerDeployment()
    mockConfig.STRIPE_SECRET_KEY = "sk_test_123"
    sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.test/s/1" })
    mockGetStripe.mockReturnValue({
      checkout: { sessions: { create: sessionsCreate } },
      customers: { create: vi.fn().mockResolvedValue({ id: "cus_new" }) },
    })
    tableResults.set("stripe_customers", { data: { stripe_customer_id: "cus_1" }, error: null })
  })

  it("returns to /billing-admin?topup=true — the stock /billing page is withheld here", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/deployment-billing/checkout",
      headers: { ...AS_PAYER, origin: "https://acme.example" },
      payload: { amountUsd: 10 },
    })

    expect(res.statusCode).toBe(200)
    const arg = sessionsCreate.mock.calls[0][0]
    expect(arg.success_url).toBe("https://acme.example/billing-admin?topup=true")
    expect(arg.cancel_url).toBe("https://acme.example/billing-admin")
  })

  it("keeps the load webhook's metadata shape byte-for-byte — no webhook change (D14)", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/deployment-billing/checkout",
      headers: { ...AS_PAYER, origin: "https://acme.example" },
      payload: { amountUsd: 25 },
    })

    const arg = sessionsCreate.mock.calls[0][0]
    expect(arg.metadata).toEqual({ userId: PAYER, kind: "load", loadUsd: "25" })
    expect(arg.mode).toBe("payment")
    expect(arg.line_items[0].price_data.unit_amount).toBe(2500)
  })

  it("quotes credits through the ONE rate function", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/deployment-billing/checkout",
      headers: { ...AS_PAYER, origin: "https://acme.example" },
      payload: { amountUsd: 10 },
    })
    expect(res.json().data.credits).toBe(3300)
  })

  it("400s an out-of-range amount and names the cap, so the payer learns it from the product", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/deployment-billing/checkout",
      headers: AS_PAYER,
      payload: { amountUsd: 5000 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("1000")
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it("503s — never 500 — when Stripe is not configured on this deployment", async () => {
    delete mockConfig.STRIPE_SECRET_KEY

    const res = await app.inject({
      method: "POST",
      url: "/v1/deployment-billing/checkout",
      headers: AS_PAYER,
      payload: { amountUsd: 10 },
    })

    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("stripe_not_configured")
    // The throw inside getStripe() would have been a 500 with a stack trace.
    expect(mockGetStripe).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The unit seam itself
// ---------------------------------------------------------------------------

describe("with no display unit configured", () => {
  it("refuses a units-bearing write rather than treating a unit as a credit", async () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ billing: { selfServe: false, payerAccount: PAYER } })
    __resetSurfaceProfileCacheForTests()
    __setDeploymentPayerForTests(PAYER)

    const res = await app.inject({
      method: "PUT",
      url: "/v1/deployment-billing/default-allowance",
      headers: AS_PAYER,
      payload: { units: 400_000 },
    })

    // Rate 1 would be a silent 2000x under-allocation on a deployment whose
    // profile lost its unit trio.
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("unit_not_configured")
    expect(rec.updatePayloads).toEqual([])
  })
})
