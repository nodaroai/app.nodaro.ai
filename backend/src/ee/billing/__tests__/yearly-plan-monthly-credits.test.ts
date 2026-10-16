import { describe, it, expect, vi, beforeEach } from "vitest"
import { PRICE_TO_PLAN, STRIPE_PRODUCTS, TIER_CREDITS } from "../stripe-config.js"

// ---------------------------------------------------------------------------
// Mocks. Every query builder is a thenable chain that answers the next queued
// response for its table; every builder call is recorded for the assertions.
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, queues, calls, mockInvalidateBalanceCache, reset } = vi.hoisted(() => {
  type Response = { data: unknown; error: unknown }
  const queues = new Map<string, Response[]>()
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []

  function next(table: string): Response {
    const queue = queues.get(table)
    return queue && queue.length > 0 ? queue.shift()! : { data: [], error: null }
  }

  function chain(table: string) {
    const c: Record<string, unknown> = {}
    for (const method of ["select", "eq", "in", "gt", "order", "limit"]) {
      c[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args })
        return c
      })
    }
    c.then = (resolve: (v: Response) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(next(table)).then(resolve, reject)
    return c
  }

  const mockFrom = vi.fn((table: string) => chain(table))
  const mockRpc = vi.fn()
  const mockInvalidateBalanceCache = vi.fn()

  function reset() {
    queues.clear()
    calls.length = 0
    mockFrom.mockClear()
    mockRpc.mockReset()
    mockRpc.mockResolvedValue({ data: true, error: null })
    mockInvalidateBalanceCache.mockClear()
  }

  return { mockFrom, mockRpc, queues, calls, mockInvalidateBalanceCache, reset }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, rpc: mockRpc, auth: { getUser: vi.fn() } },
}))

vi.mock("@/ee/routes/credits.js", () => ({
  invalidateBalanceCache: mockInvalidateBalanceCache,
}))
// The leaf the consumers read from forwards to the mock above.
vi.mock("@/ee/billing/balance-cache.js", async () => ({ invalidateBalanceCache: (await import("@/ee/routes/credits.js")).invalidateBalanceCache }))

import {
  grantYearlyPlanMonthlyCredits,
  YEARLY_CREDITS_PAGE_SIZE,
  YEARLY_PRICE_IDS,
} from "../yearly-plan-monthly-credits.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-15T12:40:00.000Z")

interface SubRow {
  id: string
  user_id: string
  stripe_price_id: string
  current_period_start: string | null
  current_period_end: string | null
  cancel_at: string | null
}

function yearlySub(overrides: Partial<SubRow> = {}): SubRow {
  return {
    id: "a0000000-0000-4000-8000-000000000001",
    user_id: "u0000000-0000-4000-8000-000000000001",
    stripe_price_id: STRIPE_PRODUCTS.standard.yearly,
    // Postgres wire format, as PostgREST returns a timestamptz.
    current_period_start: "2026-03-10T00:00:05+00:00",
    current_period_end: "2027-03-10T00:00:05+00:00",
    cancel_at: null,
    ...overrides,
  }
}

function queue(table: string, ...responses: Array<{ data: unknown; error?: unknown }>) {
  queues.set(table, [...(queues.get(table) ?? []), ...responses.map((r) => ({ data: r.data, error: r.error ?? null }))])
}

function callsOn(table: string, method: string) {
  return calls.filter((c) => c.table === table && c.method === method)
}

function grantCalls() {
  return mockRpc.mock.calls.filter((c) => c[0] === "grant_yearly_plan_monthly_credits")
}

beforeEach(() => {
  reset()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("YEARLY_PRICE_IDS", () => {
  it("is every yearly price in PRICE_TO_PLAN, and only those (derived, never a hand list)", () => {
    const yearly = Object.entries(PRICE_TO_PLAN).filter(([, p]) => p.interval === "yearly").map(([id]) => id)
    const monthly = Object.entries(PRICE_TO_PLAN).filter(([, p]) => p.interval === "monthly").map(([id]) => id)
    expect([...YEARLY_PRICE_IDS].sort()).toEqual([...yearly].sort())
    expect(YEARLY_PRICE_IDS.length).toBe(4)
    for (const id of monthly) expect(YEARLY_PRICE_IDS).not.toContain(id)
  })
})

describe("grantYearlyPlanMonthlyCredits", () => {
  it("reads only ACTIVE subscriptions on a YEARLY price — monthly and canceled ones are never selected", async () => {
    queue("subscriptions", { data: [] })

    await grantYearlyPlanMonthlyCredits(NOW)

    expect(callsOn("subscriptions", "eq")).toEqual([
      expect.objectContaining({ args: ["status", "active"] }),
    ])
    const priceFilter = callsOn("subscriptions", "in")
    expect(priceFilter).toHaveLength(1)
    expect(priceFilter[0].args[0]).toBe("stripe_price_id")
    expect([...(priceFilter[0].args[1] as string[])].sort()).toEqual([...YEARLY_PRICE_IDS].sort())
    expect(grantCalls()).toHaveLength(0)
  })

  it("grants the plan's monthly amount at this month's anchor when the last reset is older", async () => {
    queue("subscriptions", { data: [yearlySub()] })
    queue("profiles", { data: [{ id: yearlySub().user_id, credits_reset_at: "2026-09-10T00:40:00+00:00" }] })

    const result = await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()).toEqual([
      [
        "grant_yearly_plan_monthly_credits",
        {
          p_user_id: "u0000000-0000-4000-8000-000000000001",
          p_subscription_id: "a0000000-0000-4000-8000-000000000001",
          p_price_id: STRIPE_PRODUCTS.standard.yearly,
          // The row's own value, passed through: the database compares it to
          // the period it reads under the lock.
          p_period_start: "2026-03-10T00:00:05+00:00",
          p_anchor: "2026-10-10T00:00:05.000Z",
          p_credits: TIER_CREDITS.standard,
        },
      ],
    ])
    expect(result).toEqual({ granted: 1, refused: 0, errors: 0, awaitingMigration: false })
    expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("u0000000-0000-4000-8000-000000000001")
  })

  it("a second run in the same month asks for nothing (the reset already passed this month's anchor)", async () => {
    queue("subscriptions", { data: [yearlySub()] })
    // What the first run stamped, read back in Postgres wire format.
    queue("profiles", { data: [{ id: yearlySub().user_id, credits_reset_at: "2026-10-10T00:40:01.123456+00:00" }] })

    const result = await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()).toHaveLength(0)
    expect(mockInvalidateBalanceCache).not.toHaveBeenCalled()
    expect(result).toEqual({ granted: 0, refused: 0, errors: 0, awaitingMigration: false })
  })

  it("never back-pays missed months: one grant at the latest anchor, however old the last reset", async () => {
    // A subscriber who got the plan amount once, at subscription seven months ago.
    queue("subscriptions", { data: [yearlySub()] })
    queue("profiles", { data: [{ id: yearlySub().user_id, credits_reset_at: "2026-03-10T00:00:09+00:00" }] })

    const result = await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()).toHaveLength(1)
    expect(grantCalls()[0][1]).toMatchObject({ p_anchor: "2026-10-10T00:00:05.000Z", p_credits: TIER_CREDITS.standard })
    expect(result.granted).toBe(1)
  })

  it("a profile that was never stamped is due its grant", async () => {
    queue("subscriptions", { data: [yearlySub()] })
    queue("profiles", { data: [{ id: yearlySub().user_id, credits_reset_at: null }] })

    await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()).toHaveLength(1)
  })

  it("the amount follows the price the subscription is on NOW (a mid-year change of plan)", async () => {
    queue("subscriptions", { data: [yearlySub({ stripe_price_id: STRIPE_PRODUCTS.pro.yearly })] })
    queue("profiles", { data: [{ id: yearlySub().user_id, credits_reset_at: "2026-09-10T00:40:00+00:00" }] })

    await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()[0][1]).toMatchObject({
      p_price_id: STRIPE_PRODUCTS.pro.yearly,
      p_credits: TIER_CREDITS.pro,
    })
  })

  it("the first month's anchor is the period start itself", async () => {
    // A period that started this month and that no reset has followed.
    queue("subscriptions", {
      data: [yearlySub({ current_period_start: "2026-10-01T09:00:00+00:00", current_period_end: "2027-10-01T09:00:00+00:00" })],
    })
    queue("profiles", { data: [{ id: yearlySub().user_id, credits_reset_at: "2026-09-01T09:00:30+00:00" }] })

    await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()[0][1]).toMatchObject({ p_anchor: "2026-10-01T09:00:00.000Z" })
  })

  it("never grants at or past the period end — the renewal owns that grant", async () => {
    // The row was not moved on at the year end (webhook still pending): the
    // last anchor inside the period is month 11, and it was already granted.
    queue("subscriptions", {
      data: [yearlySub({ current_period_start: "2025-10-12T00:00:00+00:00", current_period_end: "2026-10-12T00:00:00+00:00" })],
    })
    queue("profiles", { data: [{ id: yearlySub().user_id, credits_reset_at: "2026-09-12T00:40:00+00:00" }] })

    await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()).toHaveLength(0)
  })

  it("grants nothing once the period has ended, even a month-11 anchor never granted — the renewal owns the year end", async () => {
    // A late run (cron down, webhook pending): a month-11 grant now would
    // stamp credits_reset_at past the period end and the safety net would
    // then skip the year-end renewal.
    queue("subscriptions", {
      data: [yearlySub({ current_period_start: "2025-10-12T00:00:00+00:00", current_period_end: "2026-10-12T00:00:00+00:00" })],
    })
    queue("profiles", { data: [{ id: yearlySub().user_id, credits_reset_at: "2026-08-12T00:40:00+00:00" }] })

    const result = await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()).toHaveLength(0)
    expect(result.granted).toBe(0)
  })

  it("grants nothing for the months after a scheduled cancellation date", async () => {
    queue("subscriptions", { data: [yearlySub({ cancel_at: "2026-09-01T00:00:00+00:00" })] })
    // August's credits were set; September and October fall after cancel_at.
    queue("profiles", { data: [{ id: yearlySub().user_id, credits_reset_at: "2026-08-10T00:40:00+00:00" }] })

    await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()).toHaveLength(0)
  })

  it("never grants to a row on a monthly price, even if one is returned", async () => {
    queue("subscriptions", { data: [yearlySub({ stripe_price_id: STRIPE_PRODUCTS.standard.monthly })] })
    queue("profiles", { data: [{ id: yearlySub().user_id, credits_reset_at: null }] })

    const result = await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()).toHaveLength(0)
    expect(result.granted).toBe(0)
  })

  it("skips a row whose period cannot be read", async () => {
    queue("subscriptions", {
      data: [yearlySub({ current_period_start: null }), yearlySub({ id: "a2", current_period_end: "not a date" })],
    })
    queue("profiles", { data: [] })

    const result = await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()).toHaveLength(0)
    expect(result.errors).toBe(0)
  })

  it("a refusal from the database (another run, the webhook, a change since the read) is not a grant", async () => {
    queue("subscriptions", { data: [yearlySub()] })
    queue("profiles", { data: [{ id: yearlySub().user_id, credits_reset_at: "2026-09-10T00:40:00+00:00" }] })
    mockRpc.mockResolvedValueOnce({ data: false, error: null })

    const result = await grantYearlyPlanMonthlyCredits(NOW)

    expect(result).toEqual({ granted: 0, refused: 1, errors: 0, awaitingMigration: false })
    expect(mockInvalidateBalanceCache).not.toHaveBeenCalled()
  })

  it("a failed grant is counted, never thrown, and the run goes on to the next subscription", async () => {
    const second = yearlySub({ id: "a0000000-0000-4000-8000-000000000002", user_id: "u0000000-0000-4000-8000-000000000002" })
    queue("subscriptions", { data: [yearlySub(), second] })
    queue("profiles", {
      data: [
        { id: yearlySub().user_id, credits_reset_at: "2026-09-10T00:40:00+00:00" },
        { id: second.user_id, credits_reset_at: "2026-09-10T00:40:00+00:00" },
      ],
    })
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: "40001", message: "could not serialize access" } })

    const result = await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()).toHaveLength(2)
    expect(result).toEqual({ granted: 1, refused: 0, errors: 1, awaitingMigration: false })
    expect(mockInvalidateBalanceCache).toHaveBeenCalledTimes(1)
    expect(mockInvalidateBalanceCache).toHaveBeenCalledWith(second.user_id)
  })

  it("stops quietly on a database that does not have the grant function yet (staging runs ahead of main)", async () => {
    const second = yearlySub({ id: "a0000000-0000-4000-8000-000000000002", user_id: "u0000000-0000-4000-8000-000000000002" })
    queue("subscriptions", { data: [yearlySub(), second] })
    queue("profiles", { data: [] })
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.grant_yearly_plan_monthly_credits" },
    })

    const result = await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()).toHaveLength(1)
    expect(result).toEqual({ granted: 0, refused: 0, errors: 0, awaitingMigration: true })
  })

  it("still asks the database when the profile read fails — the database decides", async () => {
    queue("subscriptions", { data: [yearlySub()] })
    queue("profiles", { data: null, error: { message: "timeout" } })

    const result = await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()).toHaveLength(1)
    expect(result).toEqual({ granted: 1, refused: 0, errors: 1, awaitingMigration: false })
  })

  it("a failed subscription read is an error and grants nothing", async () => {
    queue("subscriptions", { data: null, error: { message: "boom" } })

    const result = await grantYearlyPlanMonthlyCredits(NOW)

    expect(grantCalls()).toHaveLength(0)
    expect(result).toEqual({ granted: 0, refused: 0, errors: 1, awaitingMigration: false })
  })

  it("walks every page, keyed on the last id it saw", async () => {
    const page = Array.from({ length: YEARLY_CREDITS_PAGE_SIZE }, (_, i) =>
      yearlySub({
        id: `a0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        user_id: `u0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      }),
    )
    const last = yearlySub({ id: "b0000000-0000-4000-8000-000000000001", user_id: "v0000000-0000-4000-8000-000000000001" })
    queue("subscriptions", { data: page }, { data: [last] })
    queue("profiles", { data: [] }, { data: [] })

    const result = await grantYearlyPlanMonthlyCredits(NOW)

    expect(result.granted).toBe(YEARLY_CREDITS_PAGE_SIZE + 1)
    expect(callsOn("subscriptions", "order")[0].args).toEqual(["id", { ascending: true }])
    expect(callsOn("subscriptions", "limit").map((c) => c.args[0])).toEqual([YEARLY_CREDITS_PAGE_SIZE, YEARLY_CREDITS_PAGE_SIZE])
    expect(callsOn("subscriptions", "gt").map((c) => c.args)).toEqual([["id", page[page.length - 1].id]])
  })
})
