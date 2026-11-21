/**
 * The Stripe self-heal (balance read + admin sync) refreshes only a
 * subscription this account was granted. It never creates a row (one made
 * here would default to granted with no credits behind it, so the webhook's
 * claim would grant nothing) and never marks an ungranted one active (a
 * refused second subscription would then read as live).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { MemoryDb, Row } from "../../../test/memory-tables.js"

const USER = "00000000-0000-4000-8000-000000000001"

const state = vi.hoisted(() => ({
  db: { tables: {} } as MemoryDb,
  stripeSubs: [] as unknown[],
  listArgs: [] as unknown[],
}))

vi.mock("@/lib/supabase.js", async () => {
  const { memorySupabase } = await import("../../../test/memory-tables.js")
  return { supabase: { from: (table: string) => memorySupabase(state.db).from(table) } }
})
vi.mock("@/ee/billing/stripe-client.js", () => ({
  getStripe: () => ({
    subscriptions: {
      list: async (args: unknown) => {
        state.listArgs.push(args)
        return { data: state.stripeSubs }
      },
    },
  }),
}))

import { syncGrantedSubscriptionFromStripe } from "../subscription-self-heal.js"

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
const sync = () =>
  syncGrantedSubscriptionFromStripe({ userId: USER, stripeCustomerId: "cus_1", tierFor: () => "pro" })
const subs = () => state.db.tables.subscriptions as Row[]

beforeEach(() => {
  state.db = { tables: { subscriptions: [] } }
  state.stripeSubs = []
  state.listArgs.length = 0
})

describe("syncGrantedSubscriptionFromStripe", () => {
  it("refreshes the granted subscription's period", async () => {
    state.db.tables.subscriptions = [row("sub_a")]
    state.stripeSubs = [stripeSub("sub_a")]
    const out = await sync()
    expect(out).toMatchObject({ outcome: "synced", stripeSubscriptionId: "sub_a", tier: "pro" })
    expect(subs()[0]!.current_period_end).toBe(new Date(END * 1000).toISOString())
  })

  it("never creates a row for a subscription with no local record", async () => {
    state.stripeSubs = [stripeSub("sub_new")]
    const out = await sync()
    expect(out).toEqual({ outcome: "not_granted", stripeSubscriptionIds: ["sub_new"] })
    expect(subs()).toHaveLength(0)
  })

  it("never marks a never-granted (refused or unpaid) row active", async () => {
    state.db.tables.subscriptions = [row("sub_dup", { status: "incomplete", plan_granted: false })]
    state.stripeSubs = [stripeSub("sub_dup")]
    const out = await sync()
    expect(out.outcome).toBe("not_granted")
    expect(subs()[0]).toMatchObject({ status: "incomplete", plan_granted: false, current_period_end: "2026-11-01T00:00:00.000Z" })
  })

  it("picks the granted subscription even when Stripe lists the refused one first", async () => {
    state.db.tables.subscriptions = [
      row("sub_kept"),
      row("sub_dup", { status: "incomplete", plan_granted: false, tier: "basic" }),
    ]
    state.stripeSubs = [stripeSub("sub_dup", "price_basic"), stripeSub("sub_kept")]
    const out = await sync()
    expect(out).toMatchObject({ outcome: "synced", stripeSubscriptionId: "sub_kept" })
    const dup = subs().find((r) => r.id === "sub_dup")!
    expect(dup).toMatchObject({ status: "incomplete", plan_granted: false })
  })

  it("leaves an ended row alone", async () => {
    state.db.tables.subscriptions = [row("sub_a", { status: "canceled" })]
    state.stripeSubs = [stripeSub("sub_a")]
    expect((await sync()).outcome).toBe("not_granted")
    expect(subs()[0]!.status).toBe("canceled")
  })

  it("answers no_active_stripe_subscription when Stripe lists none", async () => {
    state.db.tables.subscriptions = [row("sub_a")]
    expect(await sync()).toEqual({ outcome: "no_active_stripe_subscription" })
  })

  it("lists more than one active subscription", async () => {
    state.stripeSubs = []
    await sync()
    expect((state.listArgs[0] as { limit: number }).limit).toBeGreaterThan(1)
  })
})
