/**
 * A subscription grants its plan only once it is paid for.
 *
 * Stripe creates a Checkout subscription `incomplete` while its first payment
 * is not done (a payment that needs the customer's action, a declined card)
 * and moves it to `active` once that invoice is paid, or to
 * `incomplete_expired` when it stays unpaid for 23 hours. Stripe does not
 * deliver events in order, and may deliver one more than once.
 *
 *   - `active` (or `trialing`) at creation: today's grant, write for write.
 *   - `incomplete` at creation: the row is recorded, the account untouched.
 *   - The first event that sees it `active`/`trialing` grants it, once —
 *     whichever of created and updated comes first, or both at once.
 *   - It never pays: nothing granted, the account as it was, also when the
 *     subscription is cancelled.
 *   - An update sets the paid tier only while the subscription is `active`,
 *     `trialing` or `past_due`.
 *   - A row the marker does not know (written before it, or by a writer that
 *     does not name it) counts as granted; a database without the marker yet
 *     behaves as before.
 *
 *   - A second subscription claimed while another of the account is claimed
 *     (from its claim on, before its live status is written) or granted and
 *     live is refused (`other_live`): it grants nothing and stays
 *     `incomplete`. A paid subscription is recorded `incomplete`, claimed,
 *     granted, and only then given its status, as on the update path.
 *
 * Runs against `memory-tables`, so filters and the unique subscription id
 * behave as the database's do; `claim_subscription_grant` (migration 663) is
 * mirrored over the same tables below, and proven against a real Postgres by
 * supabase/tests/subscription-claim-one-live.behavior.sql.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { STRIPE_PRODUCTS, TIER_CREDITS, TIER_STORAGE_LIMITS } from "../stripe-config.js"
import type { MemoryDb, Row } from "../../../test/memory-tables.js"

/** The statuses the subscriptions CHECK accepts (migrations 650 and 656). */
const STORABLE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "expired",
])

const { state } = vi.hoisted(() => {
  const state = {
    db: { tables: {} } as MemoryDb,
    /** Every write, in order: table writes and RPCs. */
    writes: [] as Array<Record<string, unknown>>,
    /** Columns the database does not have yet (a database before the migration). */
    missingColumns: new Set<string>(),
    /** The claim (the function, or its fallback's conditional update) fails with a database error while set. */
    failClaim: false,
    /** Database functions the database does not have yet (a database before the migration). */
    missingFunctions: new Set<string>(),
    /** Answers the claim function with this instead of running it, while set. */
    claimAnswer: undefined as unknown,
    /**
     * Database errors to answer instead of running a call: the first rule whose
     * `when` matches the table, the builder method and its first argument.
     * `once` rules are dropped once used.
     */
    refusals: [] as Array<{
      when: (table: string, prop: string, arg: unknown) => boolean
      error: { code: string; message: string }
      once?: boolean
      /** The write commits, then the error is reported (a connection dropped after the commit). */
      landed?: boolean
    }>,
    /**
     * Another event, run to its end just before the next subscriptions write
     * (or claim function call) that `when` matches lands: what a concurrent
     * delivery does between a handler's read and its write. Runs once.
     */
    interleave: null as { when: (write: Record<string, unknown>) => boolean; run: () => Promise<unknown> } | null,
    logTransaction: vi.fn(async (_entry: Record<string, unknown>) => undefined),
    invalidate: vi.fn(),
    notifyPaidConversion: vi.fn(async () => undefined),
    notifyCancellation: vi.fn(async () => undefined),
  }
  return { state }
})

vi.mock("@/lib/supabase.js", async () => {
  const { memorySupabase } = await import("../../../test/memory-tables.js")
  const missing = (code: string, column: string) => ({
    data: null,
    error: { code, message: `column subscriptions.${column} does not exist` },
  })
  function from(table: string) {
    const inner = memorySupabase(state.db).from(table) as Record<string, (...args: unknown[]) => unknown>
    let refused: ReturnType<typeof missing> | null = null
    let record: Record<string, unknown> | null = null
    let landedError: { data: null; error: { code: string; message: string } } | null = null
    const touches = (value: unknown) =>
      [...state.missingColumns].find((c) => (typeof value === "string" ? value.includes(c) : value != null && typeof value === "object" && c in value))
    const proxy: Record<string, unknown> = new Proxy(inner, {
      get(target, prop: string) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
            if (refused) return Promise.resolve(refused).then(resolve, reject)
            if (landedError) {
              if (record) state.writes.push(record)
              const failure = landedError
              return (target.then as (a: unknown, b: unknown) => Promise<unknown>)(() => failure, reject).then(resolve, reject)
            }
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
        if (typeof fn !== "function") return fn
        return (...args: unknown[]) => {
          const column = touches(prop === "select" ? args[0] : prop === "insert" || prop === "update" || prop === "upsert" ? args[0] : prop === "eq" || prop === "is" ? args[0] : undefined)
          if (column && table === "subscriptions") refused = missing(prop === "insert" ? "PGRST204" : "42703", column)
          if (table === "subscriptions" && prop === "update" && state.failClaim && (args[0] as Row | undefined)?.plan_granted === true) {
            refused = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }
          }
          const rule = state.refusals.find((r) => r.when(table, prop, args[0]))
          if (rule?.landed) {
            landedError = { data: null, error: rule.error }
            if (rule.once) state.refusals.splice(state.refusals.indexOf(rule), 1)
          } else if (rule) {
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
    if (state.missingFunctions.has(name)) {
      return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` } }
    }
    if (name === "claim_subscription_grant") {
      if (state.failClaim) return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }
      const write = { rpc: name, args }
      const other = state.interleave
      if (other && other.when(write)) {
        state.interleave = null
        await other.run()
      }
      state.writes.push(write)
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
})
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: state.logTransaction } }))
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: state.invalidate }))
vi.mock("@/ee/notifications/founder-notify.js", () => ({
  notifyPaidConversion: state.notifyPaidConversion,
  notifyCancellation: state.notifyCancellation,
}))
vi.mock("@/ee/billing/stripe-client.js", () => ({ getStripe: () => ({}) }))
vi.mock("@/ee/billing/signup-grant.js", () => ({
  activateSignupGrantOnPurchase: vi.fn(async () => ({ activated: false, state: "granted" })),
}))
vi.mock("@/ee/lib/account-blocking.js", () => ({ releaseQuietStopOnPurchase: vi.fn(async () => ({ released: false })) }))

import { handleSubscriptionCreated, handleSubscriptionUpdated, handleSubscriptionCanceled } from "../provision-credits.js"
import { claimSubscriptionGrant, resetClaimFunctionWarning } from "../subscription-grant.js"
import { readLiveOrClaimedSubscriptions } from "../downgrade-floor.js"

const USER = "user-pay-1"
const CUSTOMER = "cus_pay_1"
const SUB = "sub_pay_1"
const PRO = STRIPE_PRODUCTS.pro.monthly
const PERIOD = { currentPeriodStart: "2026-11-01T00:00:00.000Z", currentPeriodEnd: "2026-12-01T00:00:00.000Z" }
/** What the account holds before it subscribes: the free tier and what is left of its signup grant. */
const FREE_PROFILE: Row = {
  id: USER,
  tier: "free",
  subscription_tier: "free",
  subscription_credits: 150,
  topup_credits: 0,
  lifetime_topup_credits: 0,
  storage_limit_bytes: TIER_STORAGE_LIMITS.free,
  subscription_ended_at: null,
  current_period_end: null,
  credits_reset_at: null,
}

function created(status: string, over: Record<string, unknown> = {}) {
  return {
    subscriptionId: SUB,
    stripeCustomerId: CUSTOMER,
    priceId: PRO,
    status,
    ...PERIOD,
    metadata: { userId: USER },
    ...over,
  }
}

function updated(status: string, over: Record<string, unknown> = {}) {
  return {
    subscriptionId: SUB,
    stripeCustomerId: CUSTOMER,
    priceId: PRO,
    status,
    ...PERIOD,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    canceledAt: null,
    collectionPaused: false,
    metadata: { userId: USER },
    ...over,
  }
}

const canceled = { subscriptionId: SUB, stripeCustomerId: CUSTOMER, currentPeriodEnd: PERIOD.currentPeriodEnd, metadata: { userId: USER } }

/** A database with the marker's migration in: its column default, the unique id, the status CHECK. */
function migratedDb(profile: Row = FREE_PROFILE): MemoryDb {
  return {
    tables: {
      stripe_customers: [{ stripe_customer_id: CUSTOMER, user_id: USER }],
      profiles: [{ ...profile }],
      subscriptions: [],
    },
    unique: { subscriptions: ["stripe_subscription_id"] },
    defaults: { subscriptions: () => ({ plan_granted: true }) },
    guards: {
      subscriptions: ({ row }) => {
        if (!STORABLE_STATUSES.has(String(row.status))) {
          return { code: "23514", message: 'new row for relation "subscriptions" violates check constraint "subscriptions_status_check"' }
        }
        // idx_one_active_subscription_per_user (migration 024): one `active` row per account.
        const otherActive = ((state.db.tables.subscriptions ?? []) as Row[]).some(
          (r) => r.user_id === row.user_id && r.stripe_subscription_id !== row.stripe_subscription_id && r.status === "active",
        )
        return row.status === "active" && otherActive
          ? { code: "23505", message: 'duplicate key value violates unique constraint "idx_one_active_subscription_per_user"' }
          : null
      },
    },
  }
}

const profile = () => (state.db.tables.profiles as Row[])[0]!
const subscription = () => (state.db.tables.subscriptions as Row[]).find((r) => r.stripe_subscription_id === SUB)
/** The plan grants given: one audit row each. */
const planGrants = () =>
  state.logTransaction.mock.calls.filter(([e]) => e.source === "subscription_created" && e.creditType === "subscription")
const profileWrites = () => state.writes.filter((w) => w.table === "profiles")

/** What the account looks like once the Pro plan is granted. */
const GRANTED_PRO = {
  tier: "pro",
  subscription_tier: "pro",
  subscription_credits: TIER_CREDITS.pro,
  topup_credits: 150,
  storage_limit_bytes: TIER_STORAGE_LIMITS.pro,
  subscription_ended_at: null,
  current_period_end: PERIOD.currentPeriodEnd,
}

let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  state.db = migratedDb()
  state.writes.length = 0
  state.missingColumns.clear()
  state.failClaim = false
  state.missingFunctions.clear()
  state.claimAnswer = undefined
  resetClaimFunctionWarning()
  state.refusals.length = 0
  state.interleave = null
  state.logTransaction.mockClear()
  state.invalidate.mockClear()
  state.notifyPaidConversion.mockClear()
  state.notifyCancellation.mockClear()
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
  warnSpy.mockRestore()
})

describe("a subscription paid at once (active at creation) — today's grant, write for write", () => {
  it("records the subscription incomplete and unclaimed, claims it through the function, SETs the plan, carries the remainder over, audits, logs, announces, then writes its status — in that order", async () => {
    await handleSubscriptionCreated(created("active"))

    expect(state.writes).toEqual([
      {
        table: "subscriptions",
        insert: {
          user_id: USER,
          stripe_subscription_id: SUB,
          stripe_price_id: PRO,
          tier: "pro",
          status: "incomplete",
          current_period_start: PERIOD.currentPeriodStart,
          current_period_end: PERIOD.currentPeriodEnd,
          plan_granted: false,
          plan_claimed_at: null,
        },
      },
      { rpc: "claim_subscription_grant", args: { p_stripe_subscription_id: SUB, p_user_id: USER } },
      {
        table: "profiles",
        update: {
          tier: "pro",
          subscription_tier: "pro",
          subscription_credits: TIER_CREDITS.pro,
          credits_reset_at: expect.any(String),
          storage_limit_bytes: TIER_STORAGE_LIMITS.pro,
          subscription_ended_at: null,
          current_period_end: PERIOD.currentPeriodEnd,
        },
      },
      { rpc: "add_topup_credits", args: { p_user_id: USER, p_credits: 150 } },
      // The event's status, once the grant has landed (the update path's order).
      { table: "subscriptions", update: { status: "active", updated_at: expect.any(String) } },
    ])
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true, plan_claimed_at: expect.any(String) })
    expect(state.logTransaction.mock.calls.map(([e]) => e)).toEqual([
      {
        userId: USER,
        amount: 150,
        creditType: "topup",
        source: "subscription_created",
        description: "Pre-subscription balance preserved: 150 credits moved to top-up",
        balanceAfter: 150,
      },
      {
        userId: USER,
        amount: TIER_CREDITS.pro,
        creditType: "subscription",
        source: "subscription_created",
        description: `Subscription created: pro tier (${TIER_CREDITS.pro} credits)`,
        balanceAfter: TIER_CREDITS.pro,
      },
    ])
    expect(state.invalidate).toHaveBeenCalledWith(USER)
    expect(state.notifyPaidConversion).toHaveBeenCalledTimes(1)
    expect(state.notifyPaidConversion).toHaveBeenCalledWith(USER, "free", "pro")
    expect(logSpy.mock.calls).toEqual([[`[stripe] subscription.created: user=${USER} tier=pro credits=${TIER_CREDITS.pro}`]])
    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(profile()).toMatchObject(GRANTED_PRO)
  })
})

describe("a subscription whose first payment is not done (incomplete)", () => {
  it("is recorded with its status and marked not granted; the account is untouched", async () => {
    await handleSubscriptionCreated(created("incomplete"))

    expect(subscription()).toMatchObject({ status: "incomplete", tier: "pro", plan_granted: false })
    expect(profile()).toEqual(FREE_PROFILE)
    expect(state.writes.filter((w) => w.table !== "subscriptions")).toEqual([])
    expect(state.logTransaction).not.toHaveBeenCalled()
    expect(state.notifyPaidConversion).not.toHaveBeenCalled()
  })

  it("gets the full grant once when it turns active; a redelivered update grants nothing more", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    expect(profile()).toEqual(FREE_PROFILE)
    await handleSubscriptionUpdated(updated("active"))

    expect(profile()).toMatchObject(GRANTED_PRO)
    expect(planGrants()).toHaveLength(1)
    expect(state.writes.filter((w) => w.rpc === "add_topup_credits")).toEqual([
      { rpc: "add_topup_credits", args: { p_user_id: USER, p_credits: 150 } },
    ])
    expect(state.notifyPaidConversion).toHaveBeenCalledWith(USER, "free", "pro")
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })

    // The account spends some of the plan, then Stripe redelivers the update.
    state.db.tables.profiles = [{ ...profile(), subscription_credits: 1000 }]
    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject({ subscription_credits: 1000, topup_credits: 150 })
    expect(state.writes.filter((w) => w.rpc === "add_topup_credits")).toHaveLength(1)
  })

  it("never paid: incomplete → incomplete_expired grants nothing and stores the status", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionUpdated(updated("incomplete_expired"))

    expect(subscription()).toMatchObject({ status: "incomplete_expired", plan_granted: false })
    expect(profile()).toEqual(FREE_PROFILE)
    expect(state.logTransaction).not.toHaveBeenCalled()
  })

  it("a price change while it is unpaid sets no paid tier and notes no plan as held", async () => {
    await handleSubscriptionCreated(created("incomplete", { priceId: STRIPE_PRODUCTS.basic.monthly }))
    await handleSubscriptionUpdated(updated("incomplete", { priceId: PRO }))

    expect(profile()).toEqual(FREE_PROFILE)
    expect(state.writes.filter((w) => w.rpc)).toEqual([])
    expect(state.logTransaction).not.toHaveBeenCalled()
  })

  it("cancelled before it was ever paid (an expired Checkout session): the account is left as it was", async () => {
    const adminRaised = { ...FREE_PROFILE, storage_limit_bytes: 200 * 1024 * 1024 * 1024 }
    state.db = migratedDb(adminRaised)
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionCanceled(canceled)

    expect(subscription()).toMatchObject({ status: "canceled" })
    expect(profile()).toEqual(adminRaised)
    expect(state.logTransaction).not.toHaveBeenCalled()
    expect(state.notifyCancellation).not.toHaveBeenCalled()
  })
})

describe("events out of order, redelivered, or at once", () => {
  it("the paid update arriving BEFORE created: one grant, and the late created changes nothing", async () => {
    await handleSubscriptionUpdated(updated("active"))
    await handleSubscriptionCreated(created("incomplete"))

    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject(GRANTED_PRO)
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
    expect(state.db.tables.subscriptions).toHaveLength(1)
  })

  it("created (incomplete) and the paid update at once: one grant", async () => {
    await Promise.all([handleSubscriptionCreated(created("incomplete")), handleSubscriptionUpdated(updated("active"))])

    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject(GRANTED_PRO)
    expect(state.db.tables.subscriptions).toHaveLength(1)
  })

  it("the paid update and created at once, update first in line: one grant", async () => {
    await Promise.all([handleSubscriptionUpdated(updated("active")), handleSubscriptionCreated(created("incomplete"))])

    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject(GRANTED_PRO)
  })

  it("created (active) and its update at once, no row yet: one grant", async () => {
    await Promise.all([handleSubscriptionCreated(created("active")), handleSubscriptionUpdated(updated("active"))])

    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject(GRANTED_PRO)
  })

  it("the paid update delivered twice at once: one grant", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    await Promise.all([handleSubscriptionUpdated(updated("active")), handleSubscriptionUpdated(updated("active"))])

    expect(planGrants()).toHaveLength(1)
    expect(state.writes.filter((w) => w.rpc === "add_topup_credits")).toHaveLength(1)
  })

  it("a stale incomplete update after the grant: the status stays active, the account untouched, and a redelivered paid update grants nothing", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionUpdated(updated("active"))
    const afterGrant = { ...profile() }
    state.writes.length = 0

    await handleSubscriptionUpdated(updated("incomplete"))
    expect(subscription()).toMatchObject({ status: "active" })
    expect(profileWrites()).toEqual([])

    await handleSubscriptionUpdated(updated("active"))
    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject({ subscription_credits: afterGrant.subscription_credits, topup_credits: 150 })
  })

  it("a row flipped to active by another writer first (the self-heal upsert) still gets its one grant", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    state.db.tables.subscriptions = (state.db.tables.subscriptions as Row[]).map((r) => ({ ...r, status: "active" }))

    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject(GRANTED_PRO)
  })
})

describe("an ended subscription is not revived by a late paid update", () => {
  it("a deletion delivered before the paid update: the late update grants nothing and the row stays canceled", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionCanceled(canceled)
    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(0)
    expect(subscription()).toMatchObject({ status: "canceled", plan_granted: false })
    expect(profile()).toEqual(FREE_PROFILE)
  })

  it("incomplete_expired stored, then a late paid update: nothing granted, the status stays incomplete_expired", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionUpdated(updated("incomplete_expired"))
    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(0)
    expect(subscription()).toMatchObject({ status: "incomplete_expired", plan_granted: false })
    expect(profile()).toEqual(FREE_PROFILE)
  })

  it("a granted subscription cancelled, then a stale paid update with a moved period: no renewal, no paid tier, still canceled", async () => {
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionCanceled(canceled)
    const afterCancel = { ...profile() }
    state.writes.length = 0
    state.logTransaction.mockClear()

    await handleSubscriptionUpdated(
      updated("active", { currentPeriodStart: "2026-12-01T00:00:00.000Z", currentPeriodEnd: "2027-01-01T00:00:00.000Z" }),
    )

    expect(subscription()).toMatchObject({ status: "canceled" })
    expect(profile()).toEqual(afterCancel)
    expect(profileWrites()).toEqual([])
    expect(state.logTransaction).not.toHaveBeenCalled()
  })
})

describe("a cancellation and a paid update at the same time", () => {
  const isClaim = (w: Record<string, unknown>) => w.rpc === "claim_subscription_grant"
  const isCancel = (w: Record<string, unknown>) => (w.update as Row | undefined)?.status === "canceled"
  const isRowUpdate = (w: Record<string, unknown>) => (w.update as Row | undefined)?.stripe_price_id !== undefined

  it("the paid update claims and grants while the cancellation is in flight: the cancellation downgrades as for a granted plan", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    state.interleave = { when: isCancel, run: () => handleSubscriptionUpdated(updated("active")) }

    await handleSubscriptionCanceled(canceled)

    expect(planGrants()).toHaveLength(1)
    expect(subscription()).toMatchObject({ status: "canceled", plan_granted: true })
    expect(profile()).toMatchObject({ tier: "free", subscription_tier: "free", storage_limit_bytes: TIER_STORAGE_LIMITS.free })
    expect(state.logTransaction).toHaveBeenCalledWith(expect.objectContaining({ source: "expiry" }))
  })

  it("on a database without the marker yet, the cancellation downgrades as before", async () => {
    state.db = migratedDb()
    delete state.db.defaults
    state.missingColumns.add("plan_granted")
    await handleSubscriptionCreated(created("active"))

    await handleSubscriptionCanceled(canceled)

    expect(subscription()).toMatchObject({ status: "canceled" })
    expect(profile()).toMatchObject({ tier: "free", storage_limit_bytes: TIER_STORAGE_LIMITS.free })
  })

  it("cancelled after the paid update read the row but before its claim: the database refuses the claim, nothing is granted", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    state.interleave = { when: isClaim, run: () => handleSubscriptionCanceled(canceled) }

    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(0)
    expect(subscription()).toMatchObject({ status: "canceled", plan_granted: false })
    expect(profile()).toEqual(FREE_PROFILE)
  })

  it("a granted subscription cancelled after the update read it but before its row write: the row stays canceled and the account downgraded", async () => {
    await handleSubscriptionCreated(created("active"))
    state.interleave = { when: isRowUpdate, run: () => handleSubscriptionCanceled(canceled) }

    await handleSubscriptionUpdated(updated("active"))

    expect(subscription()).toMatchObject({ status: "canceled" })
    expect(profile()).toMatchObject({ tier: "free", subscription_tier: "free", storage_limit_bytes: TIER_STORAGE_LIMITS.free })
  })
})

describe("a claim that fails", () => {
  it("writes no live status, asks Stripe to redeliver, and the redelivery grants once", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    state.failClaim = true

    await expect(handleSubscriptionUpdated(updated("active"))).rejects.toMatchObject({ name: "StripeEventRetryError" })

    expect(subscription()).toMatchObject({ status: "incomplete", plan_granted: false })
    expect(profile()).toEqual(FREE_PROFILE)
    expect(planGrants()).toHaveLength(0)

    state.failClaim = false
    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(1)
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
    expect(profile()).toMatchObject(GRANTED_PRO)
  })
})

describe("the update that outruns created", () => {
  it("finding the row already recorded is expected: logged as information, not as an error", async () => {
    await Promise.all([handleSubscriptionCreated(created("incomplete")), handleSubscriptionUpdated(updated("active"))])

    expect(planGrants()).toHaveLength(1)
    expect(errorSpy).not.toHaveBeenCalled()
    expect(logSpy.mock.calls.flat().join("\n")).toMatch(/subscription\.updated: already recorded/)
  })
})

describe("trialing and past_due", () => {
  it("created trialing is granted like active", async () => {
    await handleSubscriptionCreated(created("trialing"))

    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject(GRANTED_PRO)
  })

  it("incomplete → trialing is granted once", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    expect(planGrants()).toHaveLength(0)
    await handleSubscriptionUpdated(updated("trialing"))
    await handleSubscriptionUpdated(updated("trialing"))

    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject(GRANTED_PRO)
  })

  it("a granted subscription gone past_due keeps writing its paid tier, as before", async () => {
    await handleSubscriptionCreated(created("active"))
    state.writes.length = 0

    await handleSubscriptionUpdated(updated("past_due"))

    expect(profileWrites()).toEqual([
      {
        table: "profiles",
        update: {
          tier: "pro",
          subscription_tier: "pro",
          storage_limit_bytes: TIER_STORAGE_LIMITS.pro,
          current_period_end: PERIOD.currentPeriodEnd,
          subscription_ended_at: null,
        },
      },
    ])
  })

  it("an unpaid subscription gone past_due is not granted", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionUpdated(updated("past_due"))

    expect(planGrants()).toHaveLength(0)
    expect(profile()).toEqual(FREE_PROFILE)
  })
})

describe("an update sets the paid tier only while active, trialing or past_due", () => {
  it.each(["incomplete_expired", "canceled", "paused", "unpaid", "incomplete"])(
    "a granted subscription's %s update writes no paid tier",
    async (status) => {
      await handleSubscriptionCreated(created("active"))
      state.writes.length = 0

      await handleSubscriptionUpdated(updated(status, { priceId: STRIPE_PRODUCTS.basic.monthly }))

      expect(profileWrites()).toEqual([])
      expect(profile()).toMatchObject({ tier: "pro", subscription_tier: "pro" })
    },
  )
})

describe("rows the marker does not know", () => {
  it("a row written without the marker (before it existed) counts as granted: no second grant when it turns active", async () => {
    // Inserted the way the old created handler did — granted at creation, column default.
    state.db.tables.subscriptions = [
      { user_id: USER, stripe_subscription_id: SUB, stripe_price_id: PRO, tier: "pro", status: "incomplete", plan_granted: true, current_period_start: PERIOD.currentPeriodStart, current_period_end: PERIOD.currentPeriodEnd },
    ]
    state.db.tables.profiles = [{ ...FREE_PROFILE, ...GRANTED_PRO, subscription_credits: 900 }]

    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(0)
    expect(profile()).toMatchObject({ subscription_credits: 900 })
  })

  it("a granted subscription's cancellation downgrades as before", async () => {
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionCanceled(canceled)

    expect(profile()).toMatchObject({ tier: "free", subscription_tier: "free", storage_limit_bytes: TIER_STORAGE_LIMITS.free })
    expect(state.logTransaction).toHaveBeenCalledWith(expect.objectContaining({ source: "expiry" }))
  })
})

describe("a database without the marker yet (staging runs ahead of the migration)", () => {
  beforeEach(() => {
    state.db = migratedDb()
    delete state.db.defaults
    state.missingColumns.add("plan_granted")
    state.missingFunctions.add("claim_subscription_grant")
  })

  it("created incomplete is granted at creation, as before", async () => {
    await handleSubscriptionCreated(created("incomplete"))

    expect(subscription()).toMatchObject({ status: "incomplete" })
    expect(subscription()).not.toHaveProperty("plan_granted")
    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject(GRANTED_PRO)
  })

  it("and its paid update grants nothing more", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(1)
    expect(subscription()).toMatchObject({ status: "active" })
  })

  it("the paid update arriving first still grants once", async () => {
    await handleSubscriptionUpdated(updated("active"))
    await handleSubscriptionCreated(created("incomplete"))

    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject(GRANTED_PRO)
  })

  it("a cancellation downgrades as before", async () => {
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionCanceled(canceled)

    expect(profile()).toMatchObject({ tier: "free" })
  })
})

// ---------------------------------------------------------------------------
// A grant whose write fails is retried, never lost.
// ---------------------------------------------------------------------------

const TIMEOUT = { code: "57014", message: "canceling statement due to statement timeout" }
/** The grant's profile write: the plan's credits with its storage. */
const isGrantWrite = (table: string, prop: string, arg: unknown) =>
  table === "profiles" && prop === "update" && (arg as Row | undefined)?.storage_limit_bytes !== undefined && (arg as Row | undefined)?.subscription_credits !== undefined
const isRelease = (table: string, prop: string, arg: unknown) =>
  table === "subscriptions" && prop === "update" && (arg as Row | undefined)?.plan_granted === false

describe("a plan grant whose write fails", () => {
  it("paid at creation: the claim is released, Stripe is asked again, and the redelivered created event grants once", async () => {
    state.refusals.push({ when: isGrantWrite, error: TIMEOUT, once: true })

    await expect(handleSubscriptionCreated(created("active"))).rejects.toMatchObject({ name: "StripeEventRetryError" })

    expect(subscription()).toMatchObject({ status: "incomplete", plan_granted: false, plan_claimed_at: null })
    expect(profile()).toEqual(FREE_PROFILE)
    expect(state.logTransaction).not.toHaveBeenCalled()
    expect(state.notifyPaidConversion).not.toHaveBeenCalled()
    expect(state.writes.filter((w) => w.rpc && w.rpc !== "claim_subscription_grant")).toEqual([])

    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionCreated(created("active"))

    expect(planGrants()).toHaveLength(1)
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
    expect(profile()).toMatchObject(GRANTED_PRO)
    expect(state.writes.filter((w) => w.rpc === "add_topup_credits")).toHaveLength(1)
  })

  it("paid at creation: a later paid update grants it too, once, if the created redelivery never comes", async () => {
    state.refusals.push({ when: isGrantWrite, error: TIMEOUT, once: true })
    await expect(handleSubscriptionCreated(created("active"))).rejects.toMatchObject({ name: "StripeEventRetryError" })

    await handleSubscriptionUpdated(updated("active"))
    await handleSubscriptionCreated(created("active"))

    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject(GRANTED_PRO)
  })

  it("claimed by a paid update: released, Stripe is asked again, and the redelivered update grants once", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    state.refusals.push({ when: isGrantWrite, error: TIMEOUT, once: true })

    await expect(handleSubscriptionUpdated(updated("active"))).rejects.toMatchObject({ name: "StripeEventRetryError" })

    // Nothing after the failed grant ran: the status, the row and the account are as they were.
    expect(subscription()).toMatchObject({ status: "incomplete", plan_granted: false })
    expect(profile()).toEqual(FREE_PROFILE)
    expect(state.logTransaction).not.toHaveBeenCalled()

    await handleSubscriptionUpdated(updated("active"))
    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(1)
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
    expect(profile()).toMatchObject(GRANTED_PRO)
  })

  it("recorded and granted by an update that outran created: released, and the redelivered update grants once", async () => {
    state.refusals.push({ when: isGrantWrite, error: TIMEOUT, once: true })

    await expect(handleSubscriptionUpdated(updated("active"))).rejects.toMatchObject({ name: "StripeEventRetryError" })
    expect(subscription()).toMatchObject({ plan_granted: false })
    expect(profile()).toEqual(FREE_PROFILE)

    await handleSubscriptionUpdated(updated("active"))
    await handleSubscriptionCreated(created("incomplete"))

    expect(planGrants()).toHaveLength(1)
    expect(profile()).toMatchObject(GRANTED_PRO)
  })

  it("a write that commits but reports an error is not granted twice: no release, no second allocation, no carryover of the first", async () => {
    state.refusals.push({ when: isGrantWrite, error: TIMEOUT, once: true, landed: true })

    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(1)
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
    expect(profile()).toMatchObject(GRANTED_PRO)
    // The pre-subscribe balance moves to top-up once; the plan's own allocation never does.
    expect(state.writes.filter((w) => w.rpc === "add_topup_credits")).toHaveLength(1)
  })

  it("a release that fails too is logged loudly and Stripe is still asked again", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    state.refusals.push({ when: isGrantWrite, error: TIMEOUT, once: true })
    state.refusals.push({ when: isRelease, error: TIMEOUT, once: true })

    await expect(handleSubscriptionUpdated(updated("active"))).rejects.toMatchObject({ name: "StripeEventRetryError" })

    expect(errorSpy.mock.calls.flat().join("\n")).toMatch(/PLAN NOT GRANTED AND ITS CLAIM NOT RELEASED: sub=sub_pay_1/)
    expect(profile()).toEqual(FREE_PROFILE)
    expect(planGrants()).toHaveLength(0)
  })

  it("a release never un-grants a plan granted before: it is conditional on the marker it gives back", async () => {
    await handleSubscriptionCreated(created("active"))
    state.writes.length = 0

    // A redelivered created event for a granted row: nothing to claim, nothing written.
    await handleSubscriptionCreated(created("active"))

    expect(state.writes).toEqual([])
    expect(subscription()).toMatchObject({ plan_granted: true })
  })
})

// ---------------------------------------------------------------------------
// The cancellation's retry without the marker decides from the marker.
// ---------------------------------------------------------------------------

describe("a cancellation whose write is retried without returning the marker", () => {
  /** The first cancel write is answered "no such column" though the marker exists. */
  const refuseFirstCancel = () =>
    state.refusals.push({
      when: (table, prop, arg) => table === "subscriptions" && prop === "update" && (arg as Row | undefined)?.status === "canceled",
      error: { code: "42703", message: 'column "something_else" does not exist' },
      once: true,
    })

  it("a subscription never paid for leaves the account as it was, a tier it holds from elsewhere included", async () => {
    // An account on a paid tier this subscription never gave (set by an admin).
    const adminSet = { ...FREE_PROFILE, tier: "pro", subscription_tier: "pro", subscription_credits: 900, storage_limit_bytes: TIER_STORAGE_LIMITS.pro }
    state.db = migratedDb(adminSet)
    await handleSubscriptionCreated(created("incomplete"))
    refuseFirstCancel()

    await handleSubscriptionCanceled(canceled)

    expect(subscription()).toMatchObject({ status: "canceled", plan_granted: false })
    expect(profile()).toEqual(adminSet)
    expect(state.logTransaction).not.toHaveBeenCalled()
  })

  it("a granted subscription is downgraded, as before", async () => {
    await handleSubscriptionCreated(created("active"))
    refuseFirstCancel()

    await handleSubscriptionCanceled(canceled)

    expect(profile()).toMatchObject({ tier: "free", subscription_tier: "free", storage_limit_bytes: TIER_STORAGE_LIMITS.free })
    expect(state.logTransaction).toHaveBeenCalledWith(expect.objectContaining({ source: "expiry" }))
  })

  it("a marker read that fails asks Stripe again and touches no account; the redelivery decides from the marker", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    refuseFirstCancel()
    state.refusals.push({
      when: (table, prop, arg) => table === "subscriptions" && prop === "select" && arg === "plan_granted",
      error: TIMEOUT,
      once: true,
    })

    await expect(handleSubscriptionCanceled(canceled)).rejects.toMatchObject({ name: "StripeEventRetryError" })
    expect(profile()).toEqual(FREE_PROFILE)

    await handleSubscriptionCanceled(canceled)

    expect(subscription()).toMatchObject({ status: "canceled", plan_granted: false })
    expect(profile()).toEqual(FREE_PROFILE)
  })
})

// ---------------------------------------------------------------------------
// `unpaid` is stored, and the account keeps its plan as under past_due.
// ---------------------------------------------------------------------------

describe("unpaid (payment retries ended without payment)", () => {
  it("is stored on the row; the account keeps its tier and no paid tier is written", async () => {
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionUpdated(updated("past_due"))
    state.writes.length = 0

    await handleSubscriptionUpdated(updated("unpaid"))

    expect(subscription()).toMatchObject({ status: "unpaid" })
    expect(profileWrites().filter((w) => (w.update as Row).tier !== undefined)).toEqual([])
    expect(profile()).toMatchObject({ tier: "pro", subscription_tier: "pro", storage_limit_bytes: TIER_STORAGE_LIMITS.pro })
  })

  it("still counts as the account's live subscription when an older one is cancelled", async () => {
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionUpdated(updated("unpaid"))
    // An older subscription of the same account, granted long ago, deleted late.
    ;(state.db.tables.subscriptions as Row[]).push({
      user_id: USER, stripe_subscription_id: "sub_old", stripe_price_id: PRO, tier: "pro", status: "active", plan_granted: true,
      current_period_start: PERIOD.currentPeriodStart, current_period_end: PERIOD.currentPeriodEnd,
    })

    await handleSubscriptionCanceled({ ...canceled, subscriptionId: "sub_old" })

    expect(profile()).toMatchObject({ tier: "pro", subscription_tier: "pro" })
    expect(state.logTransaction).not.toHaveBeenCalledWith(expect.objectContaining({ source: "expiry" }))
  })
})

// ---------------------------------------------------------------------------
// One live granted subscription per account (migration 663).
// ---------------------------------------------------------------------------

describe("two subscriptions of one account", () => {
  const SUB_B = "sub_pay_2"
  const subscriptionB = () => (state.db.tables.subscriptions as Row[]).find((r) => r.stripe_subscription_id === SUB_B)
  const claimOf = (id: string) => (w: Record<string, unknown>) =>
    w.rpc === "claim_subscription_grant" && (w.args as Row).p_stripe_subscription_id === id
  const refusals = () => errorSpy.mock.calls.flat().filter((m: unknown) => typeof m === "string" && m.includes("second live subscription refused"))

  it("both recorded unpaid; the second's paid update lands in full before the first's claim: one grant, the first refused, written no status, granted nothing", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionCreated(created("incomplete", { subscriptionId: SUB_B }))
    // B's paid update runs to its end between A's read and A's claim.
    state.interleave = { when: claimOf(SUB), run: () => handleSubscriptionUpdated(updated("active", { subscriptionId: SUB_B })) }

    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(1)
    expect(state.writes.filter((w) => w.rpc === "add_topup_credits")).toHaveLength(1)
    expect(subscriptionB()).toMatchObject({ status: "active", plan_granted: true })
    expect(subscription()).toMatchObject({ status: "incomplete", plan_granted: false })
    expect(profile()).toMatchObject(GRANTED_PRO)
    expect(refusals()).toEqual([
      `[stripe] second live subscription refused: sub=${SUB} user=${USER} granted nothing; kept sub=${SUB_B}, the account's live subscription`,
    ])
    // A's update wrote no status (and no paid tier) for A.
    const aWrites = state.writes.filter(
      (w) => w.table === "subscriptions" && (w.update as Row | undefined)?.status !== undefined && (w.update as Row).stripe_price_id !== undefined,
    )
    expect(aWrites).toHaveLength(1) // B's own status write only
  })

  it("the second's paid update lands between the first's claim and its status write: still one grant, no carryover of the first's credits", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionCreated(created("incomplete", { subscriptionId: SUB_B }))
    // A has claimed and granted; B's update runs to its end before A's row (and status) write lands.
    state.interleave = {
      when: (w) => w.table === "subscriptions" && (w.update as Row | undefined)?.stripe_price_id !== undefined,
      run: () => handleSubscriptionUpdated(updated("active", { subscriptionId: SUB_B })),
    }

    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(1)
    expect(state.writes.filter((w) => w.rpc === "add_topup_credits")).toEqual([
      { rpc: "add_topup_credits", args: { p_user_id: USER, p_credits: 150 } },
    ])
    expect(profile()).toMatchObject(GRANTED_PRO)
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
    expect(subscriptionB()).toMatchObject({ status: "incomplete", plan_granted: false })
    expect(refusals()).toEqual([
      `[stripe] second live subscription refused: sub=${SUB_B} user=${USER} granted nothing; kept sub=${SUB}, the account's live subscription`,
    ])
  })

  it("a released claim (its grant write failed) stops blocking: the other subscription is claimed and granted", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionCreated(created("incomplete", { subscriptionId: SUB_B }))
    state.refusals.push({ when: isGrantWrite, error: TIMEOUT, once: true })
    await expect(handleSubscriptionUpdated(updated("active"))).rejects.toMatchObject({ name: "StripeEventRetryError" })
    expect(subscription()).toMatchObject({ status: "incomplete", plan_granted: false, plan_claimed_at: null })

    await handleSubscriptionUpdated(updated("active", { subscriptionId: SUB_B }))

    expect(planGrants()).toHaveLength(1)
    expect(subscriptionB()).toMatchObject({ status: "active", plan_granted: true })
    expect(refusals()).toEqual([])
  })

  it("a row granted before the claim marker (stuck incomplete, no claim time) does not block", async () => {
    ;(state.db.tables.subscriptions as Row[]).push({
      user_id: USER, stripe_subscription_id: "sub_legacy", stripe_price_id: PRO, tier: "pro", status: "incomplete", plan_granted: true,
      current_period_start: PERIOD.currentPeriodStart, current_period_end: PERIOD.currentPeriodEnd,
    })

    await handleSubscriptionCreated(created("active"))

    expect(planGrants()).toHaveLength(1)
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
  })

  it("a trialing pair recorded at creation, at once: one grant, and the refused one stays incomplete", async () => {
    state.interleave = { when: claimOf(SUB), run: () => handleSubscriptionCreated(created("trialing", { subscriptionId: SUB_B })) }

    await handleSubscriptionCreated(created("trialing"))

    expect(planGrants()).toHaveLength(1)
    expect(subscriptionB()).toMatchObject({ status: "trialing", plan_granted: true })
    expect(subscription()).toMatchObject({ status: "incomplete", plan_granted: false })
    expect(refusals()).toHaveLength(1)
    expect(refusals()[0]).toContain(`sub=${SUB} `)
    expect(refusals()[0]).toContain(`kept sub=${SUB_B}`)

    // Its later trialing update is refused again: no grant, no hold, no paid tier written for it.
    state.writes.length = 0
    await handleSubscriptionUpdated(updated("trialing"))
    expect(planGrants()).toHaveLength(1)
    expect(profileWrites()).toEqual([])
  })

  it("a redelivery of the granted subscription is not_claimable, never other_live", async () => {
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionCreated(created("incomplete", { subscriptionId: SUB_B }))
    await handleSubscriptionUpdated(updated("active", { subscriptionId: SUB_B }))
    expect(refusals()).toHaveLength(1)
    errorSpy.mockClear()

    await expect(claimSubscriptionGrant(SUB, USER)).resolves.toEqual({ outcome: "not_claimable" })
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionUpdated(updated("active"))

    expect(refusals()).toEqual([])
    expect(planGrants()).toHaveLength(1)
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
  })

  it("a second subscription after the first ended (cancelled) is claimed and granted normally", async () => {
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionCanceled(canceled)
    state.logTransaction.mockClear()

    await handleSubscriptionCreated(created("incomplete", { subscriptionId: SUB_B }))
    await handleSubscriptionUpdated(updated("active", { subscriptionId: SUB_B }))

    expect(planGrants()).toHaveLength(1)
    expect(subscriptionB()).toMatchObject({ status: "active", plan_granted: true })
    expect(profile()).toMatchObject({ tier: "pro", subscription_tier: "pro", subscription_credits: TIER_CREDITS.pro })
    expect(refusals()).toEqual([])
  })

  it("the update that outran created, refused: one claim, one log, and the row stays incomplete", async () => {
    await handleSubscriptionCreated(created("active"))
    state.writes.length = 0

    await handleSubscriptionUpdated(updated("trialing", { subscriptionId: SUB_B }))

    expect(state.writes.filter(claimOf(SUB_B))).toHaveLength(1)
    expect(refusals()).toHaveLength(1)
    expect(subscriptionB()).toMatchObject({ status: "incomplete", plan_granted: false })
    expect(planGrants()).toHaveLength(1)
  })
})

describe("the insert path's order: recorded incomplete, claimed, granted, then its status", () => {
  it("the paid update before created, then created and redeliveries: one grant, the status written once, never moved back", async () => {
    await handleSubscriptionUpdated(updated("active"))
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(1)
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
    expect(state.db.tables.subscriptions).toHaveLength(1)
  })

  it("a cancellation landing between the grant and the status write is never overwritten", async () => {
    state.interleave = {
      when: (w) => w.table === "subscriptions" && (w.update as Row | undefined)?.status === "active",
      run: () => handleSubscriptionCanceled(canceled),
    }

    await handleSubscriptionCreated(created("active"))

    expect(subscription()).toMatchObject({ status: "canceled" })
  })

  const failStatusWriteOnce = () =>
    state.refusals.push({
      when: (table, prop, arg) => table === "subscriptions" && prop === "update" && (arg as Row | undefined)?.status === "active",
      error: TIMEOUT,
      once: true,
    })

  it("a status write that fails asks Stripe again; the redelivered created writes the status once and grants nothing more", async () => {
    failStatusWriteOnce()

    await expect(handleSubscriptionCreated(created("active"))).rejects.toMatchObject({ name: "StripeEventRetryError" })

    expect(planGrants()).toHaveLength(1)
    expect(subscription()).toMatchObject({ status: "incomplete", plan_granted: true })
    expect(errorSpy.mock.calls.flat().join("\n")).toMatch(/plan granted but its status write failed: sub=sub_pay_1/)

    state.writes.length = 0
    await handleSubscriptionCreated(created("active"))
    await handleSubscriptionCreated(created("active"))

    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
    expect(planGrants()).toHaveLength(1)
    expect(state.writes.filter((w) => w.rpc)).toEqual([])
    expect(state.writes.filter((w) => w.table === "subscriptions" && (w.update as Row | undefined)?.status === "active")).toHaveLength(1)
    expect(profileWrites()).toEqual([])
  })

  it("a status write that fails on the update that outran created: its redelivery writes the status, no second grant", async () => {
    failStatusWriteOnce()

    await expect(handleSubscriptionUpdated(updated("active"))).rejects.toMatchObject({ name: "StripeEventRetryError" })
    await handleSubscriptionUpdated(updated("active"))

    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
    expect(planGrants()).toHaveLength(1)
  })
})

describe("a claimed subscription is the account's live one for every liveness reader", () => {
  const SUB_B = "sub_pay_2"

  it("A ended; B claimed but still incomplete; A's redelivered deletion does not downgrade the account", async () => {
    await handleSubscriptionCreated(created("active"))
    // A is cancelled at once (its updated(canceled) lands first; its deletion is redelivered below).
    await handleSubscriptionUpdated(updated("canceled"))
    await handleSubscriptionCreated(created("incomplete", { subscriptionId: SUB_B }))
    state.logTransaction.mockClear()
    // B is claimed and granted; before its row (and live status) write lands, A's deletion arrives.
    state.interleave = {
      when: (w) => w.table === "subscriptions" && (w.update as Row | undefined)?.stripe_price_id !== undefined,
      run: () => handleSubscriptionCanceled(canceled),
    }

    await handleSubscriptionUpdated(updated("active", { subscriptionId: SUB_B }))

    expect(planGrants()).toHaveLength(1)
    expect(state.logTransaction).not.toHaveBeenCalledWith(expect.objectContaining({ source: "expiry" }))
    expect(profile()).toMatchObject({ tier: "pro", subscription_tier: "pro", subscription_credits: TIER_CREDITS.pro })
    expect(logSpy.mock.calls.flat().join("\n")).toMatch(/has another live subscription, account unchanged/)
  })
})

describe("readLiveOrClaimedSubscriptions", () => {
  const rows = () => [
    { user_id: USER, stripe_subscription_id: "sub_live", status: "past_due", plan_granted: true },
    { user_id: USER, stripe_subscription_id: "sub_claimed", status: "incomplete", plan_granted: true, plan_claimed_at: "2026-11-01T00:00:00Z" },
    { user_id: USER, stripe_subscription_id: "sub_claimed_ended", status: "canceled", plan_granted: true, plan_claimed_at: "2026-10-01T00:00:00Z" },
    { user_id: USER, stripe_subscription_id: "sub_legacy", status: "incomplete", plan_granted: true },
    { user_id: "someone-else", stripe_subscription_id: "sub_other", status: "active", plan_granted: true },
  ]
  const read = () => readLiveOrClaimedSubscriptions<{ stripe_subscription_id: string }>("stripe_subscription_id", (q) => q.eq("user_id", USER))

  it("reads a live status, or a claim on a subscription that has not ended; a pre-marker row by its status alone", async () => {
    state.db.tables.subscriptions = rows()
    const { data, error } = await read()
    expect(error).toBeNull()
    expect(data.map((r) => r.stripe_subscription_id).sort()).toEqual(["sub_claimed", "sub_live"])
  })

  it("a database without the claim time: the claimed read counts nothing", async () => {
    state.db.tables.subscriptions = rows()
    state.refusals.push({ when: (t, p, a) => t === "subscriptions" && p === "not" && a === "plan_claimed_at", error: { code: "42703", message: "column subscriptions.plan_claimed_at does not exist" } })
    const { data, error } = await read()
    expect(error).toBeNull()
    expect(data.map((r) => r.stripe_subscription_id)).toEqual(["sub_live"])
  })

  it("any other error is returned, never read as nothing live", async () => {
    state.db.tables.subscriptions = rows()
    state.refusals.push({ when: (t, p, a) => t === "subscriptions" && p === "not" && a === "plan_claimed_at", error: TIMEOUT })
    const { data, error } = await read()
    expect(error).toMatchObject({ message: TIMEOUT.message })
    expect(data).toEqual([])
  })
})

describe("a database without migration 663 (staging runs dev before main applies it)", () => {
  beforeEach(() => {
    state.missingFunctions.add("claim_subscription_grant")
    state.missingColumns.add("plan_claimed_at")
  })

  it("records a paid subscription with its live status, as before, so the one-active index refuses a second paid one", async () => {
    await handleSubscriptionCreated(created("active"))
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })

    await handleSubscriptionCreated(created("active", { subscriptionId: "sub_pay_2" }))

    expect(planGrants()).toHaveLength(1)
    expect((state.db.tables.subscriptions as Row[]).map((r) => r.stripe_subscription_id)).toEqual([SUB])
    expect(errorSpy.mock.calls.flat().join("\n")).toMatch(/second live subscription refused: sub=sub_pay_2 .* kept sub=sub_pay_1/)
  })

  it("a released claim is released without the claim time", async () => {
    state.refusals.push({ when: isGrantWrite, error: TIMEOUT, once: true })
    await expect(handleSubscriptionCreated(created("active"))).rejects.toMatchObject({ name: "StripeEventRetryError" })
    expect(subscription()).toMatchObject({ status: "active", plan_granted: false })

    await handleSubscriptionCreated(created("active"))
    expect(planGrants()).toHaveLength(1)
    expect(subscription()).toMatchObject({ plan_granted: true })
  })
})

describe("an update that loses the claim to a concurrent created", () => {
  it("re-reads the row and goes on from it: its status is written as for a plan granted before", async () => {
    await handleSubscriptionCreated(created("incomplete"))
    // Between the update's read and its claim, a created event (trialing) claims and grants it.
    state.interleave = {
      when: (w) => w.rpc === "claim_subscription_grant",
      run: () => handleSubscriptionCreated(created("trialing")),
    }

    await handleSubscriptionUpdated(updated("active"))

    expect(planGrants()).toHaveLength(1)
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
    expect(profile()).toMatchObject(GRANTED_PRO)
  })
})

describe("the claim function", () => {
  it("a subscription paid at creation is claimed through it before its grant", async () => {
    await handleSubscriptionCreated(created("active"))

    const claimAt = state.writes.findIndex((w) => w.rpc === "claim_subscription_grant")
    const grantAt = state.writes.findIndex((w) => w.table === "profiles")
    expect(claimAt).toBeGreaterThan(0)
    expect(grantAt).toBeGreaterThan(claimAt)
    expect((state.writes[0]!.insert as Row).plan_granted).toBe(false)
  })

  it("missing from the database: the conditional update claims, warned once, and grants once", async () => {
    state.missingFunctions.add("claim_subscription_grant")
    await handleSubscriptionCreated(created("incomplete"))
    await handleSubscriptionUpdated(updated("active"))
    await handleSubscriptionUpdated(updated("active"))
    expect(subscription()).toMatchObject({ status: "active", plan_granted: true })
    // A later subscription, once the first has ended, claims through the fallback too.
    await handleSubscriptionCanceled(canceled)
    await handleSubscriptionCreated(created("active", { subscriptionId: "sub_pay_3" }))

    expect(planGrants()).toHaveLength(2)
    expect((state.db.tables.subscriptions as Row[]).find((r) => r.stripe_subscription_id === "sub_pay_3")).toMatchObject({ status: "active", plan_granted: true })
    const warnings = warnSpy.mock.calls.flat().filter((m: unknown) => typeof m === "string" && m.includes("claim_subscription_grant is not in the database yet"))
    expect(warnings).toHaveLength(1)
  })

  it("missing from the database, a failing conditional update still asks Stripe again", async () => {
    state.missingFunctions.add("claim_subscription_grant")
    await handleSubscriptionCreated(created("incomplete"))
    state.failClaim = true

    await expect(handleSubscriptionUpdated(updated("active"))).rejects.toMatchObject({ name: "StripeEventRetryError" })
    expect(subscription()).toMatchObject({ status: "incomplete", plan_granted: false })
  })

  it("a database error asks Stripe again, writing nothing", async () => {
    state.failClaim = true

    await expect(handleSubscriptionCreated(created("active"))).rejects.toMatchObject({ name: "StripeEventRetryError" })
    expect(subscription()).toMatchObject({ status: "incomplete", plan_granted: false })
    expect(profile()).toEqual(FREE_PROFILE)
    expect(planGrants()).toHaveLength(0)

    state.failClaim = false
    await handleSubscriptionCreated(created("active"))
    expect(planGrants()).toHaveLength(1)
  })

  it.each([[[]], [null], [[{ outcome: "granted" }]], [[{ outcome: "other_live", other_stripe_subscription_id: null }]]])(
    "an answer it does not know (%j) asks Stripe again, never reads as claimed",
    async (answer) => {
      await handleSubscriptionCreated(created("incomplete"))
      state.claimAnswer = answer

      await expect(handleSubscriptionUpdated(updated("active"))).rejects.toMatchObject({ name: "StripeEventRetryError" })
      expect(planGrants()).toHaveLength(0)
      expect(subscription()).toMatchObject({ status: "incomplete", plan_granted: false })
    },
  )
})
