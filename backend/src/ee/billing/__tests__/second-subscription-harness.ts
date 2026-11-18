/**
 * What the second-subscription tests share: an account whose first plan is
 * granted, the database (`memory-tables` with migration 024's index
 * `idx_one_active_subscription_per_user` and the status CHECK as a guard, and
 * migration 663's `claim_subscription_grant` mirrored over the same tables,
 * so a second subscription is refused as the database refuses it), and what
 * Stripe holds. Each test file mocks its modules from here.
 */
import { vi, expect } from "vitest"
import { STRIPE_PRODUCTS, TIER_CREDITS, TIER_STORAGE_LIMITS } from "../stripe-config.js"
import { memorySupabase, type MemoryDb, type Row } from "../../../test/memory-tables.js"

const STORABLE_STATUSES = new Set([
  "active", "trialing", "past_due", "unpaid", "paused", "canceled", "incomplete", "incomplete_expired", "expired",
])

/** What Stripe holds of a subscription. */
export interface StripeSub {
  status: string
  /** When Stripe created it, in seconds. */
  created?: number
  latest_invoice: Record<string, unknown> | string | null
  metadata?: Record<string, string>
  items?: { data: Array<Record<string, unknown>> }
}

export const state = {
  db: { tables: {} } as MemoryDb,
  writes: [] as Array<Record<string, unknown>>,
  refusals: [] as Array<{ when: (table: string, prop: string, arg: unknown) => boolean; error: { code: string; message: string }; once?: boolean }>,
  /** Every call of the claim function, in order (kept apart from `writes`: a refused claim writes nothing). */
  claims: [] as Array<Record<string, unknown>>,
  /** Answers the claim function with this instead of running it, while set. */
  claimAnswer: undefined as unknown,
  interleave: null as { when: (write: Record<string, unknown>) => boolean; run: () => Promise<unknown> } | null,
  logTransaction: vi.fn(async (_entry: Record<string, unknown>) => undefined),
  invalidate: vi.fn(),
  notifyPaidConversion: vi.fn(async () => undefined),
  notifyCancellation: vi.fn(async () => undefined),
  /** Answers whether the message was posted. */
  notifySecondSubscription: vi.fn(async (..._args: unknown[]) => true),
  stripeSubs: new Map<string, StripeSub>(),
  invoicePayments: [] as Array<Record<string, unknown>>,
  stripe: {
    subscriptions: { retrieve: vi.fn(), cancel: vi.fn(), update: vi.fn() },
    invoices: { retrieve: vi.fn() },
    invoicePayments: { list: vi.fn() },
    refunds: { create: vi.fn() },
  },
}

/** The `@/lib/supabase.js` module: every write recorded, refusals and one interleaved handler on request. */
export function supabaseModule() {
  function from(table: string) {
    const inner = memorySupabase(state.db).from(table) as Record<string, (...args: unknown[]) => unknown>
    let refused: { data: null; error: { code: string; message: string } } | null = null
    let record: Record<string, unknown> | null = null
    const proxy: Record<string, unknown> = new Proxy(inner, {
      get(target, prop: string) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
            if (refused) return Promise.resolve(refused).then(resolve, reject)
            const other = state.interleave
            if (record && other && table === "subscriptions" && other.when(record)) {
              state.interleave = null
              const write = record
              return other.run().then(() => {
                state.writes.push(write)
                return (target.then as (a: unknown, b: unknown) => unknown)(resolve, reject)
              })
            }
            if (record) state.writes.push(record)
            return (target.then as (a: unknown, b: unknown) => unknown)(resolve, reject)
          }
        }
        if (prop === "single" || prop === "maybeSingle") {
          return async () => {
            if (refused) return refused
            if (record) state.writes.push(record)
            return (target[prop] as () => Promise<unknown>)()
          }
        }
        const fn = target[prop]
        // An upsert (the receipts) is only recorded: the tables under test take none.
        if (prop === "upsert" && typeof fn !== "function") {
          return (row: unknown) => {
            state.writes.push({ table, upsert: row })
            return Promise.resolve({ data: null, error: null })
          }
        }
        if (typeof fn !== "function") return fn
        return (...args: unknown[]) => {
          const rule = state.refusals.find((r) => r.when(table, prop, args[0]))
          if (rule) {
            refused = { data: null, error: rule.error }
            if (rule.once) state.refusals.splice(state.refusals.indexOf(rule), 1)
          }
          if (prop === "insert" || prop === "update") record = { table, [prop]: args[0] }
          const out = fn.apply(target, args)
          return out === target ? proxy : out
        }
      },
    })
    return proxy
  }
  /** Migration 663's claim_subscription_grant, over the same tables. */
  function claimSubscriptionGrantFn(args: Record<string, unknown>) {
    const ENDED = ["canceled", "expired", "incomplete_expired"]
    const LIVE = ["active", "trialing", "past_due", "unpaid"]
    const answer = (outcome: string, other: string | null = null) => ({ data: [{ outcome, other_stripe_subscription_id: other }], error: null })
    const subs = (state.db.tables.subscriptions ?? []) as Row[]
    const row = subs.find((r) => r.stripe_subscription_id === args.p_stripe_subscription_id && r.user_id === args.p_user_id)
    // A row without the field carries the column's default (true).
    if (!row || row.plan_granted !== false || ENDED.includes(String(row.status))) return answer("not_claimable")
    const other = subs
      .filter((r) => r.user_id === row.user_id && r.stripe_subscription_id !== row.stripe_subscription_id && !ENDED.includes(String(r.status)))
      .find((r) => (r.plan_granted !== false && LIVE.includes(String(r.status))) || r.plan_claimed_at != null)
    if (other) return answer("other_live", String(other.stripe_subscription_id))
    state.db.tables.subscriptions = subs.map((r) => (r === row ? { ...r, plan_granted: true, plan_claimed_at: new Date().toISOString() } : r))
    return answer("claimed")
  }
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_subscription_grant") {
      state.claims.push(args)
      if (state.claimAnswer !== undefined) return { data: state.claimAnswer, error: null }
      return claimSubscriptionGrantFn(args)
    }
    state.writes.push({ rpc: name, args })
    if (name === "add_topup_credits") {
      const profiles = (state.db.tables.profiles ?? []) as Row[]
      state.db.tables.profiles = profiles.map((p) =>
        p.id === args.p_user_id ? { ...p, topup_credits: ((p.topup_credits as number) ?? 0) + (args.p_credits as number) } : p,
      )
    }
    return { data: null, error: null }
  })
  return { supabase: { from, rpc } }
}

export const configModule = () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
})

export const USER = "user-second-1"
export const CUSTOMER = "cus_second_1"
export const FIRST = "sub_first"
export const SECOND = "sub_second"
export const PRO = STRIPE_PRODUCTS.pro.monthly
export const BASIC = STRIPE_PRODUCTS.basic.monthly
export const PERIOD = { currentPeriodStart: "2026-11-01T00:00:00.000Z", currentPeriodEnd: "2026-12-01T00:00:00.000Z" }

/** The account once its first plan (Pro) was granted. */
export const GRANTED_PRO: Row = {
  id: USER,
  tier: "pro",
  subscription_tier: "pro",
  subscription_credits: TIER_CREDITS.pro,
  topup_credits: 150,
  lifetime_topup_credits: 0,
  storage_limit_bytes: TIER_STORAGE_LIMITS.pro,
  subscription_ended_at: null,
  current_period_end: PERIOD.currentPeriodEnd,
  credits_reset_at: "2026-11-01T00:00:05.000Z",
}
export const FREE_PROFILE: Row = {
  ...GRANTED_PRO,
  tier: "free",
  subscription_tier: "free",
  subscription_credits: 150,
  topup_credits: 0,
  storage_limit_bytes: TIER_STORAGE_LIMITS.free,
  current_period_end: null,
  credits_reset_at: null,
}
export const FIRST_ROW: Row = {
  user_id: USER,
  stripe_subscription_id: FIRST,
  stripe_price_id: PRO,
  tier: "pro",
  status: "active",
  current_period_start: PERIOD.currentPeriodStart,
  current_period_end: PERIOD.currentPeriodEnd,
  cancel_at_period_end: false,
  plan_granted: true,
  created_at: "2026-11-01T00:00:00.000Z",
}
/** The second subscription as its created event records it while unpaid. */
export const SECOND_UNPAID_ROW: Row = {
  ...FIRST_ROW, stripe_subscription_id: SECOND, stripe_price_id: BASIC, tier: "basic", status: "incomplete", plan_granted: false,
}

export function created(status: string, over: Record<string, unknown> = {}) {
  return { subscriptionId: SECOND, stripeCustomerId: CUSTOMER, priceId: BASIC, status, ...PERIOD, metadata: { userId: USER }, ...over }
}
export function updated(status: string, over: Record<string, unknown> = {}) {
  return {
    subscriptionId: SECOND, stripeCustomerId: CUSTOMER, priceId: BASIC, status, ...PERIOD,
    cancelAtPeriodEnd: false, cancelAt: null, canceledAt: null, collectionPaused: false, metadata: { userId: USER }, ...over,
  }
}
export const deleted = (subscriptionId: string) => ({ subscriptionId, stripeCustomerId: CUSTOMER, currentPeriodEnd: PERIOD.currentPeriodEnd, metadata: { userId: USER } })
export const firstInvoicePaid = (subscriptionId: string) => ({
  invoiceId: `in_${subscriptionId}`, subscriptionId, stripeCustomerId: CUSTOMER, amountPaid: 1900, metadata: null, billingReason: "subscription_create",
})

const INDEX_REFUSAL = { code: "23505", message: 'duplicate key value violates unique constraint "idx_one_active_subscription_per_user"' }

/** Migration 024's index and the status CHECK, over the account with its first plan granted. */
export function migratedDb(profile: Row = GRANTED_PRO, subscriptions: Row[] = [FIRST_ROW]): MemoryDb {
  return {
    tables: {
      stripe_customers: [{ stripe_customer_id: CUSTOMER, user_id: USER }],
      profiles: [{ ...profile }],
      subscriptions: subscriptions.map((r) => ({ ...r })),
    },
    unique: { subscriptions: ["stripe_subscription_id"] },
    defaults: { subscriptions: () => ({ plan_granted: true }) },
    guards: {
      subscriptions: ({ row, before }) => {
        if (!STORABLE_STATUSES.has(String(row.status))) {
          return { code: "23514", message: 'new row for relation "subscriptions" violates check constraint "subscriptions_status_check"' }
        }
        const others = ((state.db.tables.subscriptions ?? []) as Row[]).filter((r) => r !== before && r.stripe_subscription_id !== row.stripe_subscription_id)
        if (row.status === "active" && others.some((r) => r.user_id === row.user_id && r.status === "active")) return INDEX_REFUSAL
        return null
      },
    },
  }
}

/** The first invoice of a subscription, as Stripe expands it on the subscription: paid in full. */
export function firstInvoice(subscriptionId: string, over: Record<string, unknown> = {}) {
  return {
    id: `in_${subscriptionId}`,
    billing_reason: "subscription_create",
    status: "paid",
    amount_paid: 1900,
    amount_remaining: 0,
    parent: { type: "subscription_details", subscription_details: { subscription: subscriptionId } },
    ...over,
  }
}

/** A subscription the checkout sold to the account: a plan's price and the account's stamp. */
export function soldSub(subscriptionId: string, priceId: string, over: Partial<StripeSub> = {}): StripeSub {
  return {
    status: "active",
    created: Math.floor(Date.now() / 1000) - 60,
    latest_invoice: firstInvoice(subscriptionId),
    metadata: { userId: USER },
    items: { data: [{ price: { id: priceId }, current_period_start: 1793491200, current_period_end: 1796083200 }] },
    ...over,
  }
}

export const profile = () => (state.db.tables.profiles as Row[])[0]!
export const rowOf = (id: string) => (state.db.tables.subscriptions as Row[]).find((r) => r.stripe_subscription_id === id)
export const planGrants = () => state.logTransaction.mock.calls.filter(([e]) => e.source === "subscription_created" && e.creditType === "subscription")
export const refundKey = { idempotencyKey: "second-subscription-refund:pi_second" }
/** Every Stripe call that writes. */
export const stripeWrites = () => [state.stripe.subscriptions.cancel, state.stripe.subscriptions.update, state.stripe.refunds.create]
/** Every Stripe call at all. */
export const stripeCalls = () => Object.values(state.stripe).flatMap((r) => Object.values(r))
/** The alerts sent, as `[action, note]`. */
export const alerts = () => state.notifySecondSubscription.mock.calls.map((c) => [c[3], c[4]])

let spies: Array<ReturnType<typeof vi.spyOn>> = []

/** A fresh account, Stripe and database, on the production deployment. */
export function resetHarness() {
  vi.stubEnv("RUNTIME_ENV", "production")
  state.db = migratedDb()
  state.writes.length = 0
  state.claims.length = 0
  state.claimAnswer = undefined
  state.refusals.length = 0
  state.interleave = null
  for (const fn of [state.logTransaction, state.invalidate, state.notifyPaidConversion, state.notifyCancellation, state.notifySecondSubscription]) fn.mockClear()
  state.notifySecondSubscription.mockReset().mockImplementation(async () => true)
  state.stripeSubs = new Map([
    [FIRST, soldSub(FIRST, PRO)],
    [SECOND, soldSub(SECOND, BASIC)],
  ])
  state.invoicePayments = [{ id: "inpay_1", status: "paid", amount_paid: 1900, payment: { type: "payment_intent", payment_intent: "pi_second" } }]
  const s = state.stripe
  s.subscriptions.retrieve.mockReset().mockImplementation(async (id: string) => {
    const sub = state.stripeSubs.get(id)
    if (!sub) throw Object.assign(new Error(`No such subscription: '${id}'`), { type: "StripeInvalidRequestError", code: "resource_missing" })
    return { id, ...sub }
  })
  s.subscriptions.cancel.mockReset().mockImplementation(async (id: string) => {
    const sub = state.stripeSubs.get(id)!
    state.stripeSubs.set(id, { ...sub, status: "canceled" })
    return { id, ...sub, status: "canceled" }
  })
  s.subscriptions.update.mockReset().mockImplementation(async (id: string) => ({ id, ...state.stripeSubs.get(id) }))
  s.invoices.retrieve.mockReset().mockImplementation(async (id: string) => firstInvoice(id.replace(/^in_/, "")))
  s.invoicePayments.list.mockReset().mockImplementation(async () => ({ object: "list", data: state.invoicePayments, has_more: false }))
  s.refunds.create.mockReset().mockImplementation(async () => ({ id: "re_second", status: "succeeded" }))
  spies = [vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})]
}

export function restoreHarness() {
  for (const spy of spies) spy.mockRestore()
  vi.unstubAllEnvs()
}

/** Nothing of the second subscription reached the account. */
export function expectNothingGranted(before: Row) {
  expect(profile()).toEqual(before)
  expect(planGrants()).toHaveLength(0)
  expect(state.writes.filter((w) => w.table === "profiles" || w.table === "transactions" || w.rpc)).toEqual([])
  expect(state.notifyPaidConversion).not.toHaveBeenCalled()
  expect(rowOf(FIRST)).toEqual(FIRST_ROW)
}
