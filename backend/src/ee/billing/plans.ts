/**
 * The plans and credit packs Nodaro Cloud sells — what `GET /v1/billing/plans`
 * answers. Public, and the same for every caller.
 *
 * Every figure is read from the thing that charges or grants it; this module
 * keeps no copy of its own:
 *
 *  - a plan's prices: the Stripe Price its checkout charges (`STRIPE_PRODUCTS`
 *    in stripe-config.ts), read from Stripe. A Stripe price's amount never
 *    changes, so a re-price is a new id in stripe-config.ts, and the next read
 *    picks it up;
 *  - the credits a price grants, a plan's parallelism and storage:
 *    `TIER_CREDITS`, `TIER_PARALLELISM` and `TIER_STORAGE_LIMITS`, the constants
 *    provisioning and the orchestrator apply;
 *  - the credit packs and the custom-amount range: the load rate
 *    (load-rate.ts), the function the top-up checkout prices with — each pack's
 *    price confirmed against the Stripe price the fixed-pack checkout sells it
 *    by (`TOP_UPS`).
 *
 * Not read, on purpose: `tier_config.price_usd` (stale, read by nothing —
 * migration 287) and the frontend's display tables (a copy of these).
 *
 * A price Stripe cannot sell — one that fails to read, or is archived — is
 * `null` with a warning, and the rest of the list stands.
 *
 * The Stripe read is cached per process: fresh for PLAN_PRICES_FRESH_MS (only
 * PLAN_PRICES_RETRY_MS after an incomplete read), one read in flight at a time,
 * each Stripe call bounded by a timeout. Past the fresh window the last prices
 * are answered at once and re-read behind the request; a failed read is not
 * retried for PLAN_PRICES_RETRY_MS, and prices older than
 * PLAN_PRICES_MAX_STALE_MS are never served. So a public route cannot fan out
 * to Stripe, no caller waits on a warm cache, and an outage does not take the
 * list down once it has been read — for an hour.
 */

import type Stripe from "stripe"
import { config } from "../../lib/config.js"
import { getStripe } from "./stripe-client.js"
import { STRIPE_PRODUCTS, TIER_CREDITS, TIER_PARALLELISM, TIER_STORAGE_LIMITS, TOP_UPS } from "./stripe-config.js"
import { LOAD_CURRENCY, LOAD_RATE_ANCHORS, MAX_LOAD_USD, MIN_LOAD_USD, type LoadRateAnchor } from "./load-rate.js"

/** A sum of money in its currency's major unit (12 = 12.00), with the ISO-4217 code. */
export interface PlanMoney {
  amount: number
  currency: string
}

/** The credits a price grants, and how often. */
export interface PriceCredits {
  amount: number
  per: "month" | "year"
}

export interface PlanMonthlyPrice extends PlanMoney {
  /** null when Stripe does not bill this price monthly (a misconfiguration, warned). */
  credits: PriceCredits | null
}

export interface PlanYearlyPrice extends PlanMoney {
  /** The yearly amount spread over the months Stripe bills it for; null when Stripe's interval is not months or years. */
  perMonth: number | null
  /** The plan's credits every month (YEARLY_PRICE_CREDITS_PER). */
  credits: PriceCredits | null
}

export interface PlanPrices {
  /** null: Stripe cannot sell this price right now (unreadable or archived) — unavailable, never 0. */
  monthly: PlanMonthlyPrice | null
  yearly: PlanYearlyPrice | null
}

export interface BillingPlan {
  id: string
  name: string
  /** null for the free plan: there is nothing to pay. */
  prices: PlanPrices | null
  /** The free plan's one-time grant at sign-up; null on a paid plan, whose credits come with each price. */
  signupCredits: number | null
  /** How many nodes of one workflow run at once. */
  parallelism: number
  storageBytes: number
}

export interface TopUpPack {
  id: string
  credits: number
  /** null when the two checkouts that sell this pack disagree on its price, or Stripe cannot sell it. */
  price: PlanMoney | null
}

export interface BillingPlans {
  data: BillingPlan[]
  topUps: TopUpPack[]
  /** Any whole amount in this range can be loaded as credits, at the same rate as the packs. */
  topUpRange: { min: number; max: number; currency: string }
}

export type BillingPlansResult =
  | { readonly ok: true; readonly plans: BillingPlans }
  | { readonly ok: false; readonly code: "stripe_not_configured" }
  | { readonly ok: false; readonly code: "plan_prices_unavailable"; readonly error: unknown }

/**
 * How often a YEARLY subscription grants its credits: every month, as a
 * monthly one does — the plan's `TIER_CREDITS` at each monthly reset, unused
 * subscription credits expiring at the reset (set, not added) and top-up
 * credits untouched. Provisioning grants yearly subscriptions on that monthly
 * schedule; this states it on the yearly price.
 */
export const YEARLY_PRICE_CREDITS_PER: PriceCredits["per"] = "month"

export const PLAN_PRICES_FRESH_MS = 5 * 60_000
export const PLAN_PRICES_RETRY_MS = 30_000
/** The oldest prices served while Stripe cannot be read; past this the list answers 503. */
export const PLAN_PRICES_MAX_STALE_MS = 60 * 60_000
/** Per Stripe call; a public request must not wait out Stripe's own 80 s default. */
const STRIPE_REQUEST: Stripe.RequestOptions = { timeout: 5_000, maxNetworkRetries: 1 }

/** The free plan: no Stripe product, the signup grant as its credits. */
const FREE_PLAN = "free"

interface PriceFacts {
  /** Minor units (Stripe's `unit_amount`); null when the price has no fixed amount. */
  readonly unitAmount: number | null
  /** ISO-4217, upper case. */
  readonly currency: string
  /** The billing interval in months; null when Stripe bills by week/day or not at all. */
  readonly months: number | null
}

/** id → what Stripe sells it for, or null when Stripe cannot sell it (unreadable, archived). */
type PriceTable = ReadonlyMap<string, PriceFacts | null>

interface Snapshot {
  readonly plans: BillingPlans
  readonly readAt: number
  /** Some price failed to read (not archived — failed): read again sooner. */
  readonly incomplete: boolean
}

let snapshot: Snapshot | null = null
let inflight: Promise<Snapshot> | null = null
let lastFailure: { readonly at: number; readonly error: unknown } | null = null

export function __resetBillingPlansCacheForTests(): void {
  snapshot = null
  inflight = null
  lastFailure = null
}

/** The read in flight, if any — tests await a refresh started behind a request. */
export function __billingPlansRefreshForTests(): Promise<Snapshot> | null {
  return inflight
}

/** The plans and packs, or why they cannot be listed right now. */
export async function readBillingPlans(): Promise<BillingPlansResult> {
  // Never getStripe() without a key: it throws, and a deployment that takes no
  // card is not broken, it has nothing to quote (deployment-billing.ts, R4).
  if (!config.STRIPE_SECRET_KEY) return { ok: false, code: "stripe_not_configured" }
  try {
    return { ok: true, plans: (await currentSnapshot()).plans }
  } catch (error) {
    return { ok: false, code: "plan_prices_unavailable", error }
  }
}

/** What a price grants: the tier's credits, `per` month or year; null when that is not stated. */
export function priceCredits(planId: string, per: PriceCredits["per"] | null): PriceCredits | null {
  return per === null ? null : { amount: TIER_CREDITS[planId]!, per }
}

async function currentSnapshot(): Promise<Snapshot> {
  const now = Date.now()
  const current = snapshot
  if (current && now - current.readAt < (current.incomplete ? PLAN_PRICES_RETRY_MS : PLAN_PRICES_FRESH_MS)) {
    return current
  }
  const failedRecently = lastFailure !== null && now - lastFailure.at < PLAN_PRICES_RETRY_MS
  if (current && now - current.readAt <= PLAN_PRICES_MAX_STALE_MS) {
    // Stale but still servable: answer now and read again behind the request.
    // The read records its own outcome; nothing waits on it here.
    if (!failedRecently) void refresh().catch(() => {})
    return current
  }
  // Nothing servable: wait for a read — unless one just failed.
  if (failedRecently) throw lastFailure!.error
  return refresh()
}

/** One read in flight, whoever asks; its outcome is recorded once, by the read. */
function refresh(): Promise<Snapshot> {
  inflight ??= readSnapshot()
    .then((read) => {
      snapshot = read
      lastFailure = null
      return read
    })
    .catch((error: unknown) => {
      lastFailure = { at: Date.now(), error }
      console.error(
        "[billing] plan prices: Stripe read failed:",
        error instanceof Error ? error.message : error,
      )
      throw error
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

async function readSnapshot(): Promise<Snapshot> {
  const planIds = Object.values(STRIPE_PRODUCTS).flatMap((p) => [p.monthly, p.yearly])
  const { prices, incomplete } = await readStripePrices([...planIds, ...Object.keys(TOP_UPS)])
  warnOnMisbilledIntervals(prices)
  return { plans: assemble(prices), readAt: Date.now(), incomplete }
}

/** Each price on its own: one that cannot be read or sold is null, and the read still stands. */
async function readStripePrices(ids: readonly string[]): Promise<{ prices: PriceTable; incomplete: boolean }> {
  const stripe = getStripe()
  const settled = await Promise.allSettled(ids.map((id) => stripe.prices.retrieve(id, {}, STRIPE_REQUEST)))
  // Nothing read at all is a failed read (Stripe down, a wrong key), not a list of nulls.
  const firstFailure = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")
  if (firstFailure && settled.every((s) => s.status === "rejected")) throw firstFailure.reason

  const prices = new Map<string, PriceFacts | null>()
  settled.forEach((outcome, i) => {
    const id = ids[i]!
    if (outcome.status === "rejected") {
      const why = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
      console.warn(`[billing] plan prices: Stripe price ${id} could not be read (${why}); listed as unavailable`)
      prices.set(id, null)
    } else if (!outcome.value.active) {
      console.warn(`[billing] plan prices: Stripe price ${id} is archived, so checkout refuses it; listed as unavailable`)
      prices.set(id, null)
    } else {
      prices.set(id, factsOf(outcome.value))
    }
  })
  return { prices, incomplete: firstFailure !== undefined }
}

function factsOf(price: Stripe.Price): PriceFacts {
  const recurring = price.recurring
  const months =
    recurring?.interval === "month"
      ? recurring.interval_count
      : recurring?.interval === "year"
        ? recurring.interval_count * 12
        : null
  return { unitAmount: price.unit_amount, currency: price.currency.toUpperCase(), months }
}

/** A price stripe-config files under one interval that Stripe bills under another is a mistake someone must see. */
function warnOnMisbilledIntervals(prices: PriceTable): void {
  for (const [plan, product] of Object.entries(STRIPE_PRODUCTS)) {
    for (const [slot, id, expected] of [
      ["monthly", product.monthly, 1],
      ["yearly", product.yearly, 12],
    ] as const) {
      const facts = prices.get(id)
      if (facts && facts.months !== expected) {
        console.warn(`[billing] plan price ${id} (${plan} ${slot}) bills every ${facts.months ?? "?"} month(s) in Stripe`)
      }
    }
  }
}

function assemble(prices: PriceTable): BillingPlans {
  const paid = Object.entries(STRIPE_PRODUCTS).map(
    ([id, product]): BillingPlan => ({
      ...tierFacts(id),
      prices: {
        monthly: monthlyOf(id, prices.get(product.monthly)),
        yearly: yearlyOf(id, prices.get(product.yearly)),
      },
      signupCredits: null,
    }),
  )
  const currency = LOAD_CURRENCY.toUpperCase()
  return {
    data: [{ ...tierFacts(FREE_PLAN), prices: null, signupCredits: TIER_CREDITS[FREE_PLAN]! }, ...paid],
    topUps: LOAD_RATE_ANCHORS.map((anchor) => ({
      id: `topup-${anchor.usd}`,
      credits: anchor.credits,
      price: packPrice(anchor, prices),
    })),
    topUpRange: { min: MIN_LOAD_USD, max: MAX_LOAD_USD, currency },
  }
}

function tierFacts(id: string): Pick<BillingPlan, "id" | "name" | "parallelism" | "storageBytes"> {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    parallelism: TIER_PARALLELISM[id]!,
    storageBytes: TIER_STORAGE_LIMITS[id]!,
  }
}

function monthlyOf(planId: string, facts: PriceFacts | null | undefined): PlanMonthlyPrice | null {
  const money = moneyOf(facts)
  if (!money || !facts) return null
  // Credits renew with each Stripe billing period: per month only when Stripe bills monthly.
  return { ...money, credits: priceCredits(planId, facts.months === 1 ? "month" : null) }
}

function yearlyOf(planId: string, facts: PriceFacts | null | undefined): PlanYearlyPrice | null {
  const money = moneyOf(facts)
  if (!money || !facts) return null
  const perMonth = facts.months ? roundTo(money.amount / facts.months, minorDigits(facts.currency)) : null
  return { ...money, perMonth, credits: priceCredits(planId, YEARLY_PRICE_CREDITS_PER) }
}

/**
 * A pack is sold two ways: the load checkout charges the anchor's amount, and
 * the fixed-pack checkout charges the Stripe price of the `TOP_UPS` id with the
 * same grant. Its price is published only when both say the same.
 */
function packPrice(anchor: LoadRateAnchor, prices: PriceTable): PlanMoney | null {
  const currency = LOAD_CURRENCY.toUpperCase()
  const priceId = Object.entries(TOP_UPS).find(([, credits]) => credits === anchor.credits)?.[0]
  const sold = priceId ? moneyOf(prices.get(priceId)) : null
  if (sold && sold.amount === anchor.usd && sold.currency === currency) return { amount: anchor.usd, currency }
  // Every withheld price says why, once per read.
  const why = !priceId
    ? "no fixed-pack price grants it"
    : sold
      ? `the load rate charges ${anchor.usd} ${currency}, the fixed-pack price ${priceId} charges ${sold.amount} ${sold.currency}`
      : `the fixed-pack price ${priceId} cannot be sold right now`
  console.warn(`[billing] credit pack ${anchor.credits}: ${why}; listed without a price`)
  return null
}

function moneyOf(facts: PriceFacts | null | undefined): PlanMoney | null {
  if (!facts || facts.unitAmount === null) return null
  return { amount: toMajor(facts.unitAmount, facts.currency), currency: facts.currency }
}

/** Stripe amounts are in the currency's minor unit; ISO-4217 says how many digits that is (USD 2, JPY 0). */
function toMajor(minor: number, currency: string): number {
  const digits = minorDigits(currency)
  return roundTo(minor / 10 ** digits, digits)
}

function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

function roundTo(value: number, digits: number): number {
  return Number(value.toFixed(digits))
}
