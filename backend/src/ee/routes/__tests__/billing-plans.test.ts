import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * GET /v1/billing/plans — the plans and credit packs Nodaro Cloud sells, with
 * what each costs. Public: no credential, and none is read.
 *
 * Every assertion below compares against the AUTHORITY a figure comes from,
 * never a literal: a plan's prices are the Stripe Prices its checkout charges
 * (the Stripe client is the only mock), its credits / parallelism / storage are
 * the stripe-config constants provisioning and the orchestrator enforce, and
 * the packs are the load rate's anchors, confirmed against the Stripe prices
 * the fixed-pack checkout sells them by. A re-price or a new tier must not
 * need this file edited — only a change to where a figure comes from does.
 */

const h = vi.hoisted(() => ({ retrieve: vi.fn() }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/ee/billing/stripe-client.js", () => ({
  getStripe: () => ({ prices: { retrieve: h.retrieve } }),
}))
vi.mock("@/ee/billing/provision-credits.js", () => ({ ensureStripeCustomer: vi.fn() }))

import { billingRoutes } from "../billing.js"
import { config } from "../../../lib/config.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"
import {
  __billingPlansRefreshForTests,
  __resetBillingPlansCacheForTests,
  PLAN_PRICES_FRESH_MS,
  PLAN_PRICES_MAX_STALE_MS,
  PLAN_PRICES_RETRY_MS,
  priceCredits,
  YEARLY_PRICE_CREDITS_PER,
} from "../../billing/plans.js"
import { STRIPE_PRODUCTS, TIER_CREDITS, TIER_PARALLELISM, TIER_STORAGE_LIMITS, TOP_UPS } from "../../billing/stripe-config.js"
import { LOAD_CURRENCY, LOAD_RATE_ANCHORS, MAX_LOAD_USD, MIN_LOAD_USD } from "../../billing/load-rate.js"

const PLANS = Object.entries(STRIPE_PRODUCTS)
const PLAN_PRICE_IDS = PLANS.flatMap(([, p]) => [p.monthly, p.yearly])
const PACK_PRICE_IDS = Object.keys(TOP_UPS)
const ALL_PRICE_IDS = [...PLAN_PRICE_IDS, ...PACK_PRICE_IDS]
const CURRENCY = LOAD_CURRENCY.toUpperCase()

/** The fixed-pack Stripe price id a load-rate anchor is sold by (the same grant). */
function packPriceId(credits: number): string {
  return Object.entries(TOP_UPS).find(([, c]) => c === credits)![0]
}

/**
 * A distinct amount per plan price id, so a price landing on the wrong plan or
 * interval cannot pass. Yearly amounts are whole multiples of 12 units, so the
 * per-month figure is exact. A pack's Stripe price agrees with its anchor.
 */
const UNIT_AMOUNT = new Map<string, number>([
  ...PLANS.flatMap(([, p], i): Array<[string, number]> => [
    [p.monthly, (i + 1) * 1000 + 99],
    [p.yearly, (i + 1) * 12 * 900],
  ]),
  ...LOAD_RATE_ANCHORS.map((a): [string, number] => [packPriceId(a.credits), a.usd * 100]),
])

function stripePrice(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const owner = Object.values(STRIPE_PRODUCTS).find((p) => p.monthly === id || p.yearly === id)
  const recurring = owner ? { interval: owner.yearly === id ? "year" : "month", interval_count: 1 } : null
  return {
    id,
    object: "price",
    active: true,
    currency: "usd",
    unit_amount: UNIT_AMOUNT.get(id) ?? null,
    recurring,
    product: owner?.productId ?? "prod_pack",
    ...over,
  }
}

function priceAt(over: Record<string, Record<string, unknown>>) {
  return async (id: string) => stripePrice(id, over[id] ?? {})
}

const REAL_KEY = config.STRIPE_SECRET_KEY
const REAL_PROFILE = process.env.NODARO_SURFACE_PROFILE

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  __resetBillingPlansCacheForTests()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  config.STRIPE_SECRET_KEY = "sk_test_plans"
  h.retrieve.mockImplementation(async (id: string) => stripePrice(id))

  app = Fastify({ logger: false })
  await app.register(async (i) => {
    await billingRoutes(i)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
  config.STRIPE_SECRET_KEY = REAL_KEY
  if (REAL_PROFILE === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = REAL_PROFILE
  __resetSurfaceProfileCacheForTests()
  __resetBillingPlansCacheForTests()
})

async function getPlans() {
  return app.inject({ method: "GET", url: "/v1/billing/plans" })
}

type Plan = { id: string; prices: Record<string, Record<string, unknown> | null> | null; [k: string]: unknown }

function planOf(body: { data: Plan[] }, id: string): Plan {
  return body.data.find((p) => p.id === id)!
}

function quiet() {
  return {
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  }
}

describe("GET /v1/billing/plans — public", () => {
  it("answers with no credential at all", async () => {
    const res = await getPlans()
    expect(res.statusCode).toBe(200)
  })

  it("lists the free plan first, then every plan Stripe sells, in stripe-config order", async () => {
    const body = (await getPlans()).json()
    expect(body.data.map((p: { id: string }) => p.id)).toEqual(["free", ...Object.keys(STRIPE_PRODUCTS)])
  })

  it("orders the paid plans and the packs from the smallest, as the docs promise", async () => {
    const body = (await getPlans()).json()
    const grants: number[] = body.data.slice(1).map((p: Plan) => (p.prices!.monthly!.credits as { amount: number }).amount)
    expect(grants).toEqual([...grants].sort((a, b) => a - b))
    const packs: number[] = body.topUps.map((t: { credits: number }) => t.credits)
    expect(packs).toEqual([...packs].sort((a, b) => a - b))
  })

  it("is cacheable by anyone: it is the same answer for every caller", async () => {
    const res = await getPlans()
    expect(res.headers["cache-control"]).toBe("public, max-age=300")
  })

  it("names each plan after its id", async () => {
    const body = (await getPlans()).json()
    for (const plan of body.data) {
      expect(plan.name).toBe(plan.id.charAt(0).toUpperCase() + plan.id.slice(1))
    }
  })
})

describe("every figure comes from what charges or grants it", () => {
  it("a plan's parallelism and storage are the tier constants the orchestrator and provisioning use", async () => {
    const body = (await getPlans()).json()
    for (const plan of body.data) {
      // A tier missing from a table would read `undefined` on both sides, so
      // the type is pinned first.
      expect(typeof plan.parallelism, plan.id).toBe("number")
      expect(typeof plan.storageBytes, plan.id).toBe("number")
      expect(plan.parallelism, plan.id).toBe(TIER_PARALLELISM[plan.id])
      expect(plan.storageBytes, plan.id).toBe(TIER_STORAGE_LIMITS[plan.id])
    }
  })

  it("the free plan costs nothing and grants its credits once, at sign-up", async () => {
    const free = planOf((await getPlans()).json(), "free")
    expect(free.prices).toBeNull()
    expect(typeof free.signupCredits).toBe("number")
    expect(free.signupCredits).toBe(TIER_CREDITS.free)
  })

  it("a paid plan's credits come with each price, never as a plan-wide claim", async () => {
    const body = (await getPlans()).json()
    for (const [id] of PLANS) {
      expect(planOf(body, id).signupCredits, id).toBeNull()
      expect(planOf(body, id)).not.toHaveProperty("credits")
    }
  })

  it("a monthly price is the Stripe Price its checkout charges, and grants the tier's credits each month", async () => {
    const body = (await getPlans()).json()
    for (const [id, product] of PLANS) {
      expect(planOf(body, id).prices!.monthly, id).toEqual({
        amount: UNIT_AMOUNT.get(product.monthly)! / 100,
        currency: "USD",
        credits: { amount: TIER_CREDITS[id], per: "month" },
      })
    }
  })

  it("a yearly price is the Stripe Price its checkout charges, with its per-month figure", async () => {
    const body = (await getPlans()).json()
    for (const [id, product] of PLANS) {
      const yearly = planOf(body, id).prices!.yearly!
      expect(yearly.amount, id).toBe(UNIT_AMOUNT.get(product.yearly)! / 100)
      expect(yearly.currency, id).toBe("USD")
      expect(yearly.perMonth, id).toBe(UNIT_AMOUNT.get(product.yearly)! / 100 / 12)
    }
  })

  it("reads exactly the configured plan and pack price ids, nothing else", async () => {
    await getPlans()
    expect(h.retrieve.mock.calls.map((c) => c[0]).sort()).toEqual([...ALL_PRICE_IDS].sort())
  })

  it("asks Stripe with a bounded timeout, so a slow Stripe cannot hold the request", async () => {
    await getPlans()
    for (const call of h.retrieve.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ timeout: expect.any(Number) }))
    }
  })

  it("the credit packs are the load rate's anchors, priced as Stripe sells them; the custom range is its bounds", async () => {
    const body = (await getPlans()).json()
    expect(body.topUps.map((t: { credits: number; price: { amount: number } }) => [t.price.amount, t.credits])).toEqual(
      LOAD_RATE_ANCHORS.map((a) => [a.usd, a.credits]),
    )
    for (const t of body.topUps) expect(t.price.currency).toBe(CURRENCY)
    expect(body.topUpRange).toEqual({ min: MIN_LOAD_USD, max: MAX_LOAD_USD, currency: CURRENCY })
    expect(new Set(body.topUps.map((t: { id: string }) => t.id)).size).toBe(LOAD_RATE_ANCHORS.length)
  })
})

/**
 * A yearly subscription grants the plan's credits every month, as a monthly
 * one does (the owner's answer): the yearly price states the same grant, per
 * month. `YEARLY_PRICE_CREDITS_PER` in ee/billing/plans.ts holds it.
 */
describe("the yearly price's credits", () => {
  it("are the plan's credits every month, like a monthly price", async () => {
    expect(YEARLY_PRICE_CREDITS_PER).toBe("month")
    const body = (await getPlans()).json()
    for (const [id] of PLANS) {
      const prices = planOf(body, id).prices!
      expect(prices.yearly!.credits, id).toEqual({ amount: TIER_CREDITS[id], per: "month" })
      expect(prices.yearly!.credits, id).toEqual(prices.monthly!.credits)
    }
  })

  it("the grant is stated through one helper, for either period", () => {
    for (const [id] of PLANS) {
      expect(priceCredits(id, "month")).toEqual({ amount: TIER_CREDITS[id], per: "month" })
      expect(priceCredits(id, "year")).toEqual({ amount: TIER_CREDITS[id], per: "year" })
      expect(priceCredits(id, null)).toBeNull()
    }
  })
})

describe("money", () => {
  it("rounds a per-month figure to the currency's minor unit", async () => {
    const [id, first] = PLANS[0]!
    h.retrieve.mockImplementation(priceAt({ [first.yearly]: { unit_amount: 10000 } }))
    const yearly = planOf((await getPlans()).json(), id).prices!.yearly!
    expect(yearly).toMatchObject({ amount: 100, currency: "USD", perMonth: 8.33 })
  })

  it("does not divide a zero-decimal currency's amount", async () => {
    const [id, first] = PLANS[0]!
    h.retrieve.mockImplementation(priceAt({ [first.monthly]: { currency: "jpy", unit_amount: 1500 } }))
    const monthly = planOf((await getPlans()).json(), id).prices!.monthly!
    expect(monthly).toMatchObject({ amount: 1500, currency: "JPY" })
  })

  it("a price Stripe holds no fixed amount for is null (unavailable), never 0", async () => {
    const [id, first] = PLANS[0]!
    h.retrieve.mockImplementation(priceAt({ [first.monthly]: { unit_amount: null } }))
    const plan = planOf((await getPlans()).json(), id)
    expect(plan.prices!.monthly).toBeNull()
    expect(plan.prices!.yearly).not.toBeNull()
  })

  it("follows the interval Stripe bills, not the configured label, and says so in the log", async () => {
    const { warn } = quiet()
    const [id, first] = PLANS[0]!
    h.retrieve.mockImplementation(
      priceAt({
        [first.yearly]: { recurring: { interval: "month", interval_count: 6 } },
        [first.monthly]: { recurring: { interval: "year", interval_count: 1 } },
      }),
    )
    const plan = planOf((await getPlans()).json(), id)
    const yearly = plan.prices!.yearly!
    expect(yearly.perMonth).toBe(Number(((yearly.amount as number) / 6).toFixed(2)))
    // A "monthly" price Stripe bills yearly does not grant per month.
    expect(plan.prices!.monthly!.credits).toBeNull()
    expect(warn).toHaveBeenCalled()
  })
})

describe("a price Stripe cannot sell is null, and the others stand", () => {
  it("one price that fails to read: only it is null, with a warning; the list still answers", async () => {
    const { warn } = quiet()
    const [id, first] = PLANS[0]!
    h.retrieve.mockImplementation(async (pid: string) => {
      if (pid === first.monthly) throw new Error("No such price")
      return stripePrice(pid)
    })
    const res = await getPlans()
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(planOf(body, id).prices!.monthly).toBeNull()
    expect(planOf(body, id).prices!.yearly).not.toBeNull()
    expect(planOf(body, PLANS[1]![0]).prices!.monthly).not.toBeNull()
    expect(warn.mock.calls.flat().join(" ")).toContain(first.monthly)
  })

  it("an archived price is null — checkout refuses it — with a warning", async () => {
    const { warn } = quiet()
    const [id, first] = PLANS[0]!
    h.retrieve.mockImplementation(priceAt({ [first.yearly]: { active: false } }))
    const plan = planOf((await getPlans()).json(), id)
    expect(plan.prices!.yearly).toBeNull()
    expect(plan.prices!.monthly).not.toBeNull()
    expect(warn.mock.calls.flat().join(" ")).toContain(first.yearly)
  })

  it("a pack whose Stripe price differs from the load rate has no price, with a warning", async () => {
    const { warn } = quiet()
    const anchor = LOAD_RATE_ANCHORS[0]!
    h.retrieve.mockImplementation(priceAt({ [packPriceId(anchor.credits)]: { unit_amount: anchor.usd * 100 + 100 } }))
    const body = (await getPlans()).json()
    expect(body.topUps[0].credits).toBe(anchor.credits)
    expect(body.topUps[0].price).toBeNull()
    expect(body.topUps[1].price).not.toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it("a pack whose Stripe price cannot be read has no price", async () => {
    quiet()
    const anchor = LOAD_RATE_ANCHORS[0]!
    h.retrieve.mockImplementation(async (pid: string) => {
      if (pid === packPriceId(anchor.credits)) throw new Error("No such price")
      return stripePrice(pid)
    })
    expect((await getPlans()).json().topUps[0].price).toBeNull()
  })

  it("every withheld pack price is said in the log, even one Stripe reads without an amount", async () => {
    const { warn } = quiet()
    const anchor = LOAD_RATE_ANCHORS[0]!
    h.retrieve.mockImplementation(priceAt({ [packPriceId(anchor.credits)]: { unit_amount: null } }))
    expect((await getPlans()).json().topUps[0].price).toBeNull()
    expect(warn.mock.calls.flat().join(" ")).toContain(`credit pack ${anchor.credits}`)
  })
})

describe("the Stripe read", () => {
  it("happens once per cache window, however many requests arrive", async () => {
    await getPlans()
    await getPlans()
    await getPlans()
    expect(h.retrieve).toHaveBeenCalledTimes(ALL_PRICE_IDS.length)
  })

  it("is shared by concurrent requests on a cold cache", async () => {
    await Promise.all([getPlans(), getPlans(), getPlans()])
    expect(h.retrieve).toHaveBeenCalledTimes(ALL_PRICE_IDS.length)
  })

  it("past the window, answers at once with the last prices and refreshes behind the request", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-15T10:00:00Z"))
    const first = (await getPlans()).json()

    const [id, product] = PLANS[0]!
    h.retrieve.mockImplementation(priceAt({ [product.monthly]: { unit_amount: 4242 } }))
    vi.setSystemTime(new Date(Date.now() + PLAN_PRICES_FRESH_MS + 1))
    const served = await getPlans()
    expect(served.statusCode).toBe(200)
    expect(served.json()).toEqual(first)

    await __billingPlansRefreshForTests()
    expect(h.retrieve).toHaveBeenCalledTimes(ALL_PRICE_IDS.length * 2)
    expect(planOf((await getPlans()).json(), id).prices!.monthly!.amount).toBe(42.42)
  })

  it("after an incomplete read, asks again sooner than a full window", async () => {
    quiet()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-15T10:00:00Z"))
    const [id, first] = PLANS[0]!
    h.retrieve.mockImplementation(async (pid: string) => {
      if (pid === first.monthly) throw new Error("timeout")
      return stripePrice(pid)
    })
    await getPlans()

    h.retrieve.mockImplementation(async (pid: string) => stripePrice(pid))
    vi.setSystemTime(new Date(Date.now() + PLAN_PRICES_RETRY_MS + 1))
    await getPlans()
    await __billingPlansRefreshForTests()
    expect(planOf((await getPlans()).json(), id).prices!.monthly).not.toBeNull()
  })

  it("failing with nothing read yet answers 503 plan_prices_unavailable, never cached, and says so in the log once", async () => {
    const { error } = quiet()
    h.retrieve.mockRejectedValue(new Error("stripe down"))
    const [res] = await Promise.all([getPlans(), getPlans()])
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("plan_prices_unavailable")
    expect(res.headers["cache-control"]).toBe("no-store")
    expect(error).toHaveBeenCalledTimes(1)
  })

  it("failing after a good read keeps serving the last prices Stripe gave", async () => {
    quiet()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-15T10:00:00Z"))
    const first = (await getPlans()).json()

    h.retrieve.mockRejectedValue(new Error("stripe down"))
    vi.setSystemTime(new Date(Date.now() + PLAN_PRICES_FRESH_MS + 1))
    const res = await getPlans()
    await __billingPlansRefreshForTests()?.catch(() => {})
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(first)
  })

  it("does not serve prices older than the age limit: 503 once Stripe has failed that long", async () => {
    quiet()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-15T10:00:00Z"))
    await getPlans()

    h.retrieve.mockRejectedValue(new Error("stripe down"))
    vi.setSystemTime(new Date(Date.now() + PLAN_PRICES_MAX_STALE_MS + 1))
    const res = await getPlans()
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("plan_prices_unavailable")
  })

  it("after a failure, waits before asking Stripe again, then recovers", async () => {
    quiet()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-15T10:00:00Z"))
    h.retrieve.mockRejectedValue(new Error("stripe down"))
    await getPlans()
    const calls = h.retrieve.mock.calls.length
    expect((await getPlans()).statusCode).toBe(503)
    expect(h.retrieve.mock.calls.length).toBe(calls)

    h.retrieve.mockImplementation(async (id: string) => stripePrice(id))
    vi.setSystemTime(new Date(Date.now() + PLAN_PRICES_RETRY_MS + 1))
    expect((await getPlans()).statusCode).toBe(200)
  })

  it("is never attempted without a Stripe key: 503 stripe_not_configured", async () => {
    config.STRIPE_SECRET_KEY = ""
    const res = await getPlans()
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("stripe_not_configured")
    expect(h.retrieve).not.toHaveBeenCalled()
  })
})

describe("a deployment that does not sell to its users", () => {
  it("answers 403 self_serve_disabled, the code its checkout answers, without asking Stripe", async () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ billing: { selfServe: false } })
    __resetSurfaceProfileCacheForTests()
    const res = await getPlans()
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("self_serve_disabled")
    expect(h.retrieve).not.toHaveBeenCalled()
  })
})
