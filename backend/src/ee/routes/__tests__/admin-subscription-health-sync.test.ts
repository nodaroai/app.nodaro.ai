/**
 * POST /v1/admin/subscription-health/sync refreshes only the subscription the
 * account was granted: a refused or unrecorded one answers 409 and nothing
 * is written, neither the subscription row nor the profile's tier.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { MemoryDb, Row } from "../../../test/memory-tables.js"

const USER = "00000000-0000-4000-8000-000000000001"

const state = vi.hoisted(() => ({ db: { tables: {} } as MemoryDb, stripeSubs: [] as unknown[] }))

vi.mock("@/lib/supabase.js", async () => {
  const { memorySupabase } = await import("../../../test/memory-tables.js")
  return { supabase: { from: (table: string) => memorySupabase(state.db).from(table) } }
})
vi.mock("@/ee/middleware/require-admin.js", () => ({ requireAdmin: async () => {} }))
vi.mock("@/ee/middleware/require-platform-operator.js", () => ({ requirePlatformOperator: async () => {} }))
vi.mock("@/ee/billing/stripe-client.js", () => ({
  getStripe: () => ({ subscriptions: { list: async () => ({ data: state.stripeSubs }) } }),
}))
vi.mock("@/ee/billing/stripe-config.js", () => ({
  getTierFromPriceId: (price: string) => (price === "price_basic" ? "basic" : price === "price_retired" ? "free" : "pro"),
}))

import { adminSubscriptionHealthRoutes } from "../admin-subscription-health.js"

const START = 1_763_000_000
const END = START + 30 * 24 * 3600
const stripeSub = (id: string, price = "price_pro") => ({
  id,
  items: { data: [{ current_period_start: START, current_period_end: END, price: { id: price } }] },
})
const row = (id: string, over: Row = {}): Row => ({
  id, user_id: USER, stripe_subscription_id: id, tier: "pro", status: "active", stripe_price_id: "price_pro",
  current_period_start: "2026-10-01T00:00:00.000Z", current_period_end: "2026-11-01T00:00:00.000Z",
  plan_granted: true, ...over,
})
const profile = (): Row => ({ id: USER, tier: "pro", subscription_tier: "pro", current_period_end: null })

let app: FastifyInstance
beforeEach(async () => {
  state.db = {
    tables: {
      stripe_customers: [{ user_id: USER, stripe_customer_id: "cus_1" }],
      subscriptions: [],
      profiles: [profile()],
    },
  }
  state.stripeSubs = []
  app = Fastify({ logger: false })
  await app.register(adminSubscriptionHealthRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const sync = () =>
  app.inject({ method: "POST", url: "/v1/admin/subscription-health/sync", payload: { userId: USER } })

describe("admin subscription sync", () => {
  it("syncs the granted subscription and the profile's period", async () => {
    state.db.tables.subscriptions = [row("sub_a")]
    state.stripeSubs = [stripeSub("sub_a")]
    const res = await sync()
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ synced: true, stripeSubscriptionId: "sub_a", tier: "pro" })
    expect((state.db.tables.profiles as Row[])[0]!.current_period_end).toBe(new Date(END * 1000).toISOString())
  })

  it("a sync that finds the account on a lower plan (Pro → Basic) returns private outputs to public", async () => {
    ;(state.db.tables.profiles as Row[])[0]!.public_outputs = false
    state.db.tables.subscriptions = [row("sub_a")]
    state.stripeSubs = [stripeSub("sub_a", "price_basic")]
    const res = await sync()
    expect(res.statusCode).toBe(200)
    expect((state.db.tables.profiles as Row[])[0]).toMatchObject({ tier: "basic", public_outputs: true })
  })

  it("a sync onto a price that maps to no plan (unknown or retired: read as free) resets nothing", async () => {
    ;(state.db.tables.profiles as Row[])[0]!.public_outputs = false
    state.db.tables.subscriptions = [row("sub_a")]
    state.stripeSubs = [stripeSub("sub_a", "price_retired")]
    const res = await sync()
    expect(res.statusCode).toBe(200)
    expect((state.db.tables.profiles as Row[])[0]).toMatchObject({ public_outputs: false })
  })

  it("a sync on the same plan leaves private outputs alone", async () => {
    ;(state.db.tables.profiles as Row[])[0]!.public_outputs = false
    state.db.tables.subscriptions = [row("sub_a")]
    state.stripeSubs = [stripeSub("sub_a")]
    const res = await sync()
    expect(res.statusCode).toBe(200)
    expect((state.db.tables.profiles as Row[])[0]).toMatchObject({ tier: "pro", public_outputs: false })
  })

  it("answers 409 for a refused second subscription and writes nothing", async () => {
    state.db.tables.subscriptions = [row("sub_dup", { status: "incomplete", plan_granted: false, tier: "basic" })]
    state.stripeSubs = [stripeSub("sub_dup", "price_basic")]
    const res = await sync()
    expect(res.statusCode).toBe(409)
    expect((state.db.tables.subscriptions as Row[])[0]).toMatchObject({ status: "incomplete", plan_granted: false })
    expect((state.db.tables.profiles as Row[])[0]).toEqual(profile())
  })

  it("answers 409 for a subscription with no local record and creates none", async () => {
    state.stripeSubs = [stripeSub("sub_new")]
    const res = await sync()
    expect(res.statusCode).toBe(409)
    expect(state.db.tables.subscriptions).toHaveLength(0)
    expect((state.db.tables.profiles as Row[])[0]).toEqual(profile())
  })

  it("answers 404 when Stripe lists no active subscription", async () => {
    const res = await sync()
    expect(res.statusCode).toBe(404)
  })
})
