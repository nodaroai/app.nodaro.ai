/**
 * GET /v1/billing/subscription answers the account's live plan.
 *
 * An account can hold several subscription rows: an old one that ended, and
 * a second subscription that was granted nothing (recorded as ended, or
 * still unpaid). The newest row is not always the plan the account has, so a
 * row with a live status is answered first, and the newest only when none is
 * live.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { MemoryDb, Row } from "../../../test/memory-tables.js"

const state = vi.hoisted(() => ({ db: { tables: {} } as MemoryDb, tablesRead: [] as string[], failLiveRead: false }))

vi.mock("@/lib/supabase.js", async () => {
  const { memorySupabase } = await import("../../../test/memory-tables.js")
  return {
    supabase: {
      from: (table: string) => {
        state.tablesRead.push(table)
        const chain = memorySupabase(state.db).from(table) as Record<string, (...args: unknown[]) => unknown>
        if (table !== "subscriptions" || !state.failLiveRead) return chain
        // The second read (the one filtered by status) fails.
        const filtered = chain.in!
        chain.in = (...args: unknown[]) => {
          filtered(...args)
          chain.maybeSingle = async () => ({ data: null, error: { message: "statement timeout" } })
          return chain
        }
        return chain
      },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  }
})
vi.mock("@/ee/billing/stripe-client.js", () => ({ getStripe: () => ({}) }))
vi.mock("@/ee/billing/provision-credits.js", () => ({ ensureStripeCustomer: vi.fn() }))
vi.mock("@/lib/surface-profile.js", () => ({ runtimeSurfaceProfile: () => ({ billing: { selfServe: true } }) }))
vi.mock("@/lib/deployment-payer.js", () => ({ deploymentPayerId: () => null, payerCoverage: () => null }))
vi.mock("@/middleware/credit-guard.js", () => ({ creditGuard: () => async () => {}, reserveCreditsForJob: vi.fn() }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn(), creditsRoutes: vi.fn() }))
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: vi.fn() }))

import { billingRoutes } from "../billing.js"

const USER = "user-123"
const row = (id: string, status: string, createdAt: string, over: Row = {}): Row => ({
  id, user_id: USER, stripe_subscription_id: `sub_${id}`, tier: "pro", status, stripe_price_id: "price_pro",
  current_period_start: "2026-11-01T00:00:00.000Z", current_period_end: "2026-12-01T00:00:00.000Z",
  cancel_at_period_end: false, cancel_at: null, canceled_at: null, plan_granted: true, created_at: createdAt, ...over,
})
const FIRST = row("first", "active", "2026-11-01T00:00:00.000Z")
/** A second subscription granted nothing, recorded after the first. */
const REFUSED = row("second", "canceled", "2026-11-10T00:00:00.000Z", { tier: "basic", plan_granted: false, canceled_at: "2026-11-10T00:00:05.000Z" })

let app: FastifyInstance

beforeEach(async () => {
  state.db = { tables: { profiles: [{ id: USER, tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0 }], subscriptions: [] } }
  state.tablesRead.length = 0
  state.failLiveRead = false
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const userId = (req.query as Record<string, unknown> | undefined)?.userId
    if (typeof userId === "string") req.userId = userId
  })
  await app.register(async (instance) => {
    await billingRoutes(instance)
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const read = async () => (await app.inject({ method: "GET", url: `/v1/billing/subscription?userId=${USER}` })).json() as { data: Row | null; effectiveTier: string }

describe("GET /v1/billing/subscription: the live plan first", () => {
  it("a newer second subscription that ended, never granted, does not hide the live plan", async () => {
    state.db.tables.subscriptions = [FIRST, REFUSED]
    const body = await read()
    expect(body.data).toMatchObject({ id: "first", stripe_subscription_id: "sub_first", status: "active", tier: "pro" })
    expect(body.effectiveTier).toBe("pro")
    // The same fields as before, and no more.
    expect(Object.keys(body.data!).sort()).toEqual(
      ["cancel_at", "cancel_at_period_end", "canceled_at", "current_period_end", "current_period_start", "id", "status", "stripe_price_id", "stripe_subscription_id", "tier"],
    )
  })

  it.each(["incomplete", "incomplete_expired", "expired"])("nor does a newer one stored %s", async (status) => {
    state.db.tables.subscriptions = [FIRST, { ...REFUSED, status }]
    expect((await read()).data).toMatchObject({ id: "first" })
  })

  it.each(["trialing", "past_due", "unpaid"])("a plan stored %s is live", async (status) => {
    state.db.tables.subscriptions = [{ ...FIRST, status }, REFUSED]
    expect((await read()).data).toMatchObject({ id: "first", status })
  })

  it("of two live rows the newest is answered", async () => {
    state.db.tables.subscriptions = [{ ...FIRST, status: "past_due" }, row("newer", "active", "2026-11-12T00:00:00.000Z"), REFUSED]
    expect((await read()).data).toMatchObject({ id: "newer" })
  })

  it("with no live row the newest is answered, as before", async () => {
    state.db.tables.subscriptions = [{ ...FIRST, status: "canceled" }, REFUSED]
    expect((await read()).data).toMatchObject({ id: "second", status: "canceled" })
  })

  it("a newest row that is live is answered from the one read, as before", async () => {
    state.db.tables.subscriptions = [{ ...REFUSED, created_at: "2026-10-01T00:00:00.000Z" }, FIRST]
    expect((await read()).data).toMatchObject({ id: "first" })
    expect(state.tablesRead).toEqual(["profiles", "subscriptions"])
  })

  it("no subscription at all: null, from the one read", async () => {
    expect(await read()).toEqual({ data: null, effectiveTier: "pro" })
    expect(state.tablesRead).toEqual(["profiles", "subscriptions"])
  })

  it("a failed read of the live row answers the newest rather than an error", async () => {
    state.db.tables.subscriptions = [FIRST, REFUSED]
    state.failLiveRead = true
    expect((await read()).data).toMatchObject({ id: "second" })
  })
})
