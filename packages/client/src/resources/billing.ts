import type { NodaroClientCore } from "../core.js"

/**
 * Plans and prices, the subscription, and the billing surface — the shapes of
 * the `/v1/billing/*` routes an app may call. Mirrors the backend routes
 * (`backend/src/ee/routes/billing.ts`, `backend/src/routes/billing-surface.ts`),
 * the source of truth: keep these in sync if they change.
 *
 * Buying, changing the plan and the payment settings stay in the Nodaro app:
 * those routes refuse API and app tokens, so they have no method here.
 */

/** A sum of money in its currency's major unit (`12` = 12.00), with its ISO-4217 code (`"USD"`). */
export interface BillingMoney {
  amount: number
  currency: string
}

/** The credits a price grants, and how often. */
export interface BillingPriceCredits {
  amount: number
  per: "month" | "year"
}

/** A monthly price, and what it grants. */
export interface BillingMonthlyPrice extends BillingMoney {
  /** `null` when the price does not state it. */
  credits: BillingPriceCredits | null
}

/** A yearly price, what it comes to per month, and what it grants. */
export interface BillingYearlyPrice extends BillingMoney {
  /** The yearly amount spread over the months it pays for; `null` when that cannot be said. */
  perMonth: number | null
  /** What the price grants — the plan's credits every month, as a monthly price; `null` when the price does not state it. */
  credits: BillingPriceCredits | null
}

export interface BillingPlanPrices {
  /** `null` = Stripe cannot sell this price right now: show it as unavailable, never as free. */
  monthly: BillingMonthlyPrice | null
  yearly: BillingYearlyPrice | null
}

/** One plan on sale. */
export interface BillingPlan {
  /** `"free"`, `"basic"`, `"standard"`, … — the stable id. */
  id: string
  name: string
  /** `null` for the free plan: there is nothing to pay. */
  prices: BillingPlanPrices | null
  /** The free plan's one-time grant at sign-up; `null` on a paid plan, whose credits come with each price. */
  signupCredits: number | null
  /** How many nodes of one workflow run at once. */
  parallelism: number
  /** Storage for your media, in bytes. */
  storageBytes: number
}

/** A credit pack: this many credits for this price. */
export interface BillingTopUp {
  id: string
  credits: number
  /** `null` when the pack's price cannot be stated right now: show it as unavailable. */
  price: BillingMoney | null
}

/** The answer of `GET /v1/billing/plans`. */
export interface BillingPlansResult {
  /** The free plan first, then each paid plan from the smallest. */
  data: BillingPlan[]
  /** The credit packs, from the smallest. */
  topUps: BillingTopUp[]
  /** Any whole amount in this range can be loaded as credits, at the same rate as the packs. */
  topUpRange: { min: number; max: number; currency: string }
}

/** The account's latest subscription record. */
export interface BillingSubscription {
  id: string
  stripe_subscription_id: string | null
  /** The plan id: `"basic"`, `"standard"`, … */
  tier: string
  /** `"active"`, `"trialing"`, `"past_due"`, `"paused"`, `"canceled"`, `"incomplete"` or `"expired"`. */
  status: string
  stripe_price_id: string | null
  /** ISO-8601. */
  current_period_start: string | null
  /** ISO-8601: when the current period ends (and renews, unless cancelled). */
  current_period_end: string | null
  /** True when the subscription ends at `current_period_end` instead of renewing. */
  cancel_at_period_end: boolean
  /** ISO-8601: when a scheduled cancellation takes effect. */
  cancel_at: string | null
  /** ISO-8601: when it was cancelled. */
  canceled_at: string | null
}

/** The answer of `GET /v1/billing/subscription`. */
export interface BillingSubscriptionResult {
  /** `null` when the account never subscribed. */
  data: BillingSubscription | null
  /**
   * The tier the account's entitlements follow: usually a plan id from
   * `plans()` (`"free"` included); `"payg"` — no subscription, but credits
   * bought (every model, no watermark); or a tier that is not on sale, such
   * as `"enterprise"`.
   */
  effectiveTier: string
}

/** How this deployment bills, the same for every caller (`GET /v1/billing/surface`). */
export interface BillingSurface {
  /** The billing-surface contract version (an integer). */
  contract: number
  /** The registered billing provider; `"none"` = this deployment meters nothing. */
  providerId: string
  /** The unit costs display in by default (`"credits"`, `"usd"`, or a deployment's own label). */
  displayUnit: string
  canReport: boolean
  canQuote: boolean
  canAccount: boolean
  /** Whether a cost view belongs on this deployment. */
  mountCostTab: boolean
  /** One billing account pays for every user here. */
  deploymentPayer: boolean
}

/** One row of {@link BillingAccountSummary.byCategory}. */
export interface BillingUsageCategory {
  category: string
  count: number
  /** Spend in the display unit; `null` = unavailable, never 0. */
  amount: number | null
  spent: BillingMoney | null
}

/**
 * The caller's account as the deployment's billing provider sees it
 * (`GET /v1/billing/account`). Money and amounts are `null` when the provider
 * could not say: show that distinctly, never as 0. A field the provider leaves
 * out is a concept it does not have.
 */
export interface BillingAccountSummary {
  /** A plain string; `"unknown"` is a real answer. */
  plan: string
  balance: number | null
  dailyAllowance: number | null
  unit: string
  /** `"external_wallet"` when the balance comes from a wallet outside Nodaro. */
  balanceSource?: "external_wallet"
  /** ISO-8601 start of the current usage period. */
  periodStart?: string | null
  /** Generations this period. */
  generations?: number | null
  /** Money spent this period. */
  spent?: BillingMoney | null
  /** Pay-as-you-go state. */
  payg?: {
    enabled: boolean
    reserve: number | null
    rate: { creditsPerUnit: number; currency: string } | null
    monthlyCap: BillingMoney | null
  } | null
  /** The daily cap and when it resets; prefer it over `dailyAllowance` when present. `limit: 0` means blocked. */
  daily?: { limit: number; used: number; remaining: number; resetsAt: string } | null
  /** Money value of the pay-as-you-go reserve. */
  reserveValue?: BillingMoney | null
  byCategory?: BillingUsageCategory[] | null
  /** The total the balance is drawn from, where the provider grants each user an allocation. */
  allocated?: number | null
}

export class BillingResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * `GET /v1/billing/plans` → the plans and credit packs on sale, with their
   * prices. Public: works with no credential, the same for every caller.
   * Nodaro Cloud only — a self-hosted instance answers 404. Throws on `403
   * self_serve_disabled` (this deployment does not sell to its users) and on
   * `503` (`stripe_not_configured`, or prices briefly unavailable).
   */
  plans(): Promise<BillingPlansResult> {
    return this.client.request<BillingPlansResult>("GET", "/v1/billing/plans")
  }

  /**
   * `GET /v1/billing/subscription` → the account's latest subscription
   * (`null` when it never subscribed) and the tier its entitlements follow.
   * Match `effectiveTier` to a {@link BillingPlan} `id` to mark the current
   * plan (no match: pay-as-you-go, or a tier not on sale). Needs a signed-in
   * session, a personal API token without a workflow limit, or an app's OAuth
   * token. Nodaro Cloud only — a self-hosted instance answers 404.
   */
  subscription(): Promise<BillingSubscriptionResult> {
    return this.client.request<BillingSubscriptionResult>("GET", "/v1/billing/subscription")
  }

  /**
   * `GET /v1/billing/surface` → how this deployment bills: whether it meters
   * at all (`providerId !== "none"`) and in which unit costs display. Public,
   * every edition.
   */
  async surface(): Promise<BillingSurface> {
    const res = await this.client.request<{ data: BillingSurface }>("GET", "/v1/billing/surface")
    return res.data
  }

  /**
   * `GET /v1/billing/account` → the caller's plan and balance as the
   * deployment's billing provider reports them, in its display unit. `null`
   * when the provider could not answer — not a zero balance. Every edition.
   */
  async account(): Promise<BillingAccountSummary | null> {
    const res = await this.client.request<{ data: BillingAccountSummary | null }>("GET", "/v1/billing/account")
    return res.data
  }
}
