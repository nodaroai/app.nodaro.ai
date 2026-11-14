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
 * Runs against `memory-tables`, so filters, the unique subscription id and
 * the conditional claim behave as the database's do.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { STRIPE_PRODUCTS, TIER_CREDITS, TIER_STORAGE_LIMITS } from "../stripe-config.js"
import type { MemoryDb, Row } from "../../../test/memory-tables.js"

/** The statuses the subscriptions CHECK accepts once the marker's migration is in. */
const STORABLE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
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
    /** The claim's conditional update fails (a database error) while set. */
    failClaim: false,
    /**
     * Another event, run to its end just before the next subscriptions write
     * that `when` matches lands: what a concurrent delivery does between a
     * handler's read and its write. Runs once.
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
    const touches = (value: unknown) =>
      [...state.missingColumns].find((c) => (typeof value === "string" ? value.includes(c) : value != null && typeof value === "object" && c in value))
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
        if (typeof fn !== "function") return fn
        return (...args: unknown[]) => {
          const column = touches(prop === "select" ? args[0] : prop === "insert" || prop === "update" || prop === "upsert" ? args[0] : prop === "eq" || prop === "is" ? args[0] : undefined)
          if (column && table === "subscriptions") refused = missing(prop === "insert" ? "PGRST204" : "42703", column)
          if (table === "subscriptions" && prop === "update" && state.failClaim && (args[0] as Row | undefined)?.plan_granted === true) {
            refused = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }
          }
          if (prop === "insert" || prop === "update") record = { table, [prop]: args[0] }
          const out = fn.apply(target, args)
          return out === target ? proxy : out
        }
      },
    })
    return proxy
  }
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
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
      subscriptions: ({ row }) =>
        STORABLE_STATUSES.has(String(row.status))
          ? null
          : { code: "23514", message: 'new row for relation "subscriptions" violates check constraint "subscriptions_status_check"' },
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
  it("records the subscription, SETs the plan, carries the remainder over, audits, logs and announces — in that order", async () => {
    await handleSubscriptionCreated(created("active"))

    expect(state.writes).toEqual([
      {
        table: "subscriptions",
        insert: {
          user_id: USER,
          stripe_subscription_id: SUB,
          stripe_price_id: PRO,
          tier: "pro",
          status: "active",
          current_period_start: PERIOD.currentPeriodStart,
          current_period_end: PERIOD.currentPeriodEnd,
        },
      },
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
    ])
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
  const isClaim = (w: Record<string, unknown>) => (w.update as Row | undefined)?.plan_granted === true
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
