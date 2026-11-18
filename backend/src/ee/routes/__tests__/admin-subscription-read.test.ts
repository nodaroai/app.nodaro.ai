/**
 * GET /v1/admin/users/:id/subscription answers the account's live plan first,
 * as the account's own read does: a newer row that ended (a second
 * subscription granted nothing) does not hide it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { MemoryDb, Row } from "../../../test/memory-tables.js"

const ADMIN_UUID = "00000000-0000-4000-8000-000000000002"
const USER = "00000000-0000-4000-8000-000000000001"

const state = vi.hoisted(() => ({ db: { tables: {} } as MemoryDb, tablesRead: [] as string[] }))

vi.mock("@/lib/supabase.js", async () => {
  const { memorySupabase } = await import("../../../test/memory-tables.js")
  return {
    supabase: {
      from: (table: string) => {
        state.tablesRead.push(table)
        return memorySupabase(state.db).from(table)
      },
      rpc: vi.fn(),
    },
  }
})
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (req: { userId?: string }, reply: { status: (code: number) => { send: (body: unknown) => void } }) => {
    if (req.userId !== ADMIN_UUID) reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
  },
}))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { getBalance: vi.fn(), adminAdjustCredits: vi.fn(), logTransaction: vi.fn().mockResolvedValue(true) },
  invalidateModelPricingCache: vi.fn(),
}))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: vi.fn() }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false), invalidateAdminCache: vi.fn() }))
vi.mock("@/middleware/credit-guard.js", () => ({ creditGuard: () => async () => {}, reserveCreditsForJob: vi.fn() }))
vi.mock("@/lib/account-measures.js", () => ({ suspensionEndsAt: vi.fn(async () => null) }))

import { adminCreditsRoutes } from "../admin-credits.js"

const row = (id: string, status: string, createdAt: string, over: Row = {}): Row => ({
  id, user_id: USER, stripe_subscription_id: `sub_${id}`, tier: "pro", status, stripe_price_id: "price_pro",
  current_period_start: "2026-11-01T00:00:00.000Z", current_period_end: "2026-12-01T00:00:00.000Z",
  cancel_at_period_end: false, cancel_at: null, canceled_at: null, plan_granted: true, created_at: createdAt, ...over,
})
const FIRST = row("first", "active", "2026-11-01T00:00:00.000Z")
const REFUSED = row("second", "canceled", "2026-11-10T00:00:00.000Z", { tier: "basic", plan_granted: false })

let app: FastifyInstance

beforeEach(async () => {
  state.db = { tables: { subscriptions: [] } }
  state.tablesRead.length = 0
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
})

const read = async () => {
  const res = await app.inject({ method: "GET", url: `/v1/admin/users/${USER}/subscription`, headers: { "x-user-id": ADMIN_UUID } })
  return { status: res.statusCode, body: res.json() as { data: Row | null } }
}

describe("GET /v1/admin/users/:id/subscription: the live plan first", () => {
  it("a newer second subscription that ended, never granted, does not hide the live plan", async () => {
    state.db.tables.subscriptions = [FIRST, REFUSED]
    const { status, body } = await read()
    expect(status).toBe(200)
    expect(body.data).toMatchObject({ id: "first", stripe_subscription_id: "sub_first", status: "active", created_at: FIRST.created_at })
    expect(Object.keys(body.data!).sort()).toEqual(
      ["cancel_at", "cancel_at_period_end", "canceled_at", "created_at", "current_period_end", "current_period_start", "id", "status", "stripe_subscription_id", "tier"],
    )
  })

  it.each(["trialing", "past_due", "unpaid"])("a plan stored %s is live", async (planStatus) => {
    state.db.tables.subscriptions = [{ ...FIRST, status: planStatus }, { ...REFUSED, status: "incomplete" }]
    expect((await read()).body.data).toMatchObject({ id: "first", status: planStatus })
  })

  it("with no live row the newest is answered, as before", async () => {
    state.db.tables.subscriptions = [{ ...FIRST, status: "canceled" }, REFUSED]
    expect((await read()).body.data).toMatchObject({ id: "second" })
  })

  it("a newest row that is live, and no row at all, are answered from the one read, as before", async () => {
    state.db.tables.subscriptions = [{ ...REFUSED, created_at: "2026-10-01T00:00:00.000Z" }, FIRST]
    expect((await read()).body.data).toMatchObject({ id: "first" })
    state.db.tables.subscriptions = []
    expect((await read()).body).toEqual({ data: null })
    expect(state.tablesRead).toEqual(["subscriptions", "subscriptions"])
  })

  it("someone who is not an admin is refused", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/users/${USER}/subscription`, headers: { "x-user-id": USER } })
    expect(res.statusCode).toBe(403)
  })
})
