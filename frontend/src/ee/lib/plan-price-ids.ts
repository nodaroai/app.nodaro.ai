import type { BillingPlansResult } from "@nodaro/sdk/billing"
import { getTierIdFromPriceId, type BillingCycle, type PricingTier, type TopupPackage } from "@/lib/pricing-data"

/**
 * The Stripe price a checkout sends: only the one this deployment lists
 * (`GET /v1/billing/plans`). A deployment on Stripe's test mode sells test
 * prices, which the display table (`pricing-data.ts`, the live ids) can't
 * know, so the table's ids are never sent. While the list is not here, or when
 * it lists a plan or pack without a price (Stripe cannot sell it right now),
 * there is no id: the purchase says it is unavailable instead.
 */
export function planCheckoutPriceId(tier: PricingTier, cycle: BillingCycle, plans: BillingPlansResult | undefined): string | null {
  const prices = plans?.data.find((plan) => plan.id === tier.id)?.prices
  return (cycle === "monthly" ? prices?.monthly?.priceId : prices?.yearly?.priceId) ?? null
}

/** A credit pack's price: the listed pack that grants the same credits, else none (never the table's). */
export function packCheckoutPriceId(pkg: TopupPackage, plans: BillingPlansResult | undefined): string | null {
  return plans?.topUps.find((pack) => pack.credits === pkg.credits)?.priceId ?? null
}

/** The plan a subscription's price belongs to: a live price (retired ones included) from the table, a deployment's own from the list. */
export function subscriptionTierId(priceId: string | null | undefined, plans: BillingPlansResult | undefined): string | null {
  if (!priceId) return null
  return (
    getTierIdFromPriceId(priceId) ??
    plans?.data.find((plan) => plan.prices?.monthly?.priceId === priceId || plan.prices?.yearly?.priceId === priceId)?.id ??
    null
  )
}
