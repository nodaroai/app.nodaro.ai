import type { NodaroClientCore } from "../core.js"

/**
 * Plans and prices, the subscription, and the billing surface — the shapes of
 * the `/v1/billing/*` routes an app may call. Mirrors the backend routes
 * (`backend/src/ee/routes/billing.ts`, `backend/src/routes/billing-surface.ts`),
 * the source of truth: keep these in sync if they change.
 *
 * Buying, the plan, the payment settings, the receipts and the invoices answer
 * a SIGNED-IN SESSION only (`supabaseAuth`, the credential a first-party web
 * app holds): those routes refuse an API key and an app's OAuth token with
 * `403 forbidden` (`ForbiddenError`). Their methods are marked so below.
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

  // ── Signed-in session only (ForbiddenError on an API key or an app token) ──

  /**
   * `GET /v1/billing/transactions` → the account's credit purchases, newest
   * first: subscription payments and credit packs, each with its Stripe
   * receipt link when one was captured. **Signed-in session only.**
   */
  async purchases(): Promise<BillingPurchase[]> {
    const res = await this.client.request<{ data: BillingPurchase[] }>("GET", "/v1/billing/transactions")
    return res.data
  }

  /**
   * `GET /v1/billing/invoices` → every payment as a document, newest first:
   * a Stripe invoice (with its PDF) for each subscription payment, a hosted
   * receipt for each credit pack or load. **Signed-in session only.**
   */
  async invoices(): Promise<BillingDocument[]> {
    const res = await this.client.request<{ data: BillingDocument[] }>("GET", "/v1/billing/invoices")
    return res.data
  }

  /**
   * `GET /v1/billing/payment-method` → the card and the billing details on
   * file with Stripe; both `null` for an account that has not bought yet
   * (never an error). **Signed-in session only.**
   */
  async paymentMethod(): Promise<BillingPaymentMethod> {
    const res = await this.client.request<{ data: BillingPaymentMethod }>("GET", "/v1/billing/payment-method")
    return res.data
  }

  /**
   * `GET /v1/billing/auto-recharge` → the automatic top-up setting: when the
   * balance falls under `thresholdCredits`, `amountUsd` is loaded from the
   * saved card. **Signed-in session only.**
   */
  async autoRecharge(): Promise<BillingAutoRecharge> {
    const res = await this.client.request<{ data: BillingAutoRecharge }>("GET", "/v1/billing/auto-recharge")
    return res.data
  }

  /**
   * `PUT /v1/billing/auto-recharge` → changes the automatic top-up. Enabling
   * needs both `thresholdCredits` (100–100,000) and `amountUsd` (a whole
   * amount in the load range); the server answers `400` otherwise. A change
   * clears the failure count. **Signed-in session only.**
   */
  async setAutoRecharge(input: BillingAutoRechargeInput): Promise<BillingAutoRechargeSaved> {
    const res = await this.client.request<{ data: BillingAutoRechargeSaved }>("PUT", "/v1/billing/auto-recharge", { body: input })
    return res.data
  }

  /**
   * `POST /v1/billing/create-checkout-session` → a Stripe Checkout page for a
   * plan or a credit pack (`priceId` from {@link BillingPlansResult}): send
   * the person to `url`. Pass `returnPath` (a path on your own origin, such
   * as `"/billing"`) to have Stripe bring them back to your app with
   * `checkout=success` or `checkout=cancelled` in the query; without it the
   * Nodaro app's own pages are used. `ForbiddenError` with the code
   * `self_serve_disabled` on a deployment that does not sell to its users.
   * **Signed-in session only.**
   */
  async checkout(input: BillingCheckoutInput): Promise<BillingCheckoutSession> {
    const res = await this.client.request<{ data: BillingCheckoutSession }>("POST", "/v1/billing/create-checkout-session", { body: input })
    return res.data
  }

  /**
   * `POST /v1/billing/create-load-session` → a Stripe Checkout page that loads
   * a whole amount (`amountUsd`, within {@link BillingPlansResult.topUpRange})
   * as credits at the packs' rate; `credits` is what it will grant. The card
   * is saved for auto top-up. `returnPath` as in {@link checkout}.
   * **Signed-in session only.**
   */
  async loadCredits(input: BillingLoadInput): Promise<BillingLoadSession> {
    const res = await this.client.request<{ data: BillingLoadSession }>("POST", "/v1/billing/create-load-session", { body: input })
    return res.data
  }

  /**
   * `POST /v1/billing/manage-subscription` → a Stripe Customer Portal page
   * (the card, the billing address, the invoices, cancelling): send the person
   * to `url`; `returnPath` is where the portal's Back goes (default the app's
   * `/billing`). `NotFoundError` before a first purchase — Stripe does not
   * know the account yet. **Signed-in session only.**
   */
  async portal(input: BillingPortalInput = {}): Promise<BillingPortalSession> {
    const res = await this.client.request<{ data: BillingPortalSession }>("POST", "/v1/billing/manage-subscription", { body: input })
    return res.data
  }

  /**
   * `POST /v1/billing/change-plan` → moves the active subscription to another
   * plan's price (`newPriceId`, a subscription price from the plans list),
   * prorated by Stripe; the new tier applies at once. `NotFoundError` with no
   * active subscription; `400` on a pack's price or the current one.
   * **Signed-in session only.**
   */
  async changePlan(input: BillingChangePlanInput): Promise<BillingChangePlanResult> {
    const res = await this.client.request<{ data: BillingChangePlanResult }>("POST", "/v1/billing/change-plan", { body: input })
    return res.data
  }
}

// ── Types of the signed-in-session methods ──

/** One credit purchase (`billing.purchases()`), as the `transactions` row names it. */
export interface BillingPurchase {
  id: string
  /** The Stripe payment or subscription id. */
  stripe_transaction_id: string | null
  /** `"subscription"` (a plan payment), `"topup"` (a credit pack or a load) or `"refund"` (money given back: `credits_granted` negative). */
  type: string
  /** What was paid, in US dollars (on a refund, the sum given back). */
  amount_usd: number
  /** Negative on a refund. */
  credits_granted: number
  /** The plan paid for, on a subscription payment. */
  tier: string | null
  /** ISO-8601. */
  created_at: string
  /** Stripe's hosted receipt; `null` when none was captured. */
  receipt_url: string | null
}

/** A payment document: a Stripe invoice (a subscription payment) or a receipt (a credit purchase). */
export interface BillingDocument {
  id: string
  kind: "invoice" | "receipt"
  /** The invoice number Stripe printed; `null` on a receipt. */
  number: string | null
  /** ISO-8601. */
  at: string
  amount: BillingMoney
  /** The credits the payment granted; `null` on an invoice (the plan's credits come with the period). Negative on a refund. */
  credits: number | null
  /** `"paid"`, `"open"`, `"void"`, `"uncollectible"`, or `"refunded"` (a receipt for money given back: `amount` and `credits` negative). */
  status: string
  description: string | null
  /** The PDF, on an invoice; `null` on a receipt. */
  pdfUrl: string | null
  /** The hosted page: Stripe's invoice page, or the receipt. */
  url: string | null
}

/** The card on file, as Stripe shows it. */
export interface BillingCard {
  /** `"visa"`, `"mastercard"`, … */
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

/** The name, email and country on file. */
export interface BillingDetails {
  name: string | null
  email: string | null
  /** ISO-3166 alpha-2. */
  country: string | null
}

/** The answer of `billing.paymentMethod()`: both `null` before a first purchase. */
export interface BillingPaymentMethod {
  card: BillingCard | null
  billingDetails: BillingDetails | null
}

/** The automatic top-up setting (`billing.autoRecharge()`). */
export interface BillingAutoRecharge {
  enabled: boolean
  /** Load when the balance falls under this many credits; `null` when never set. */
  thresholdCredits: number | null
  /** The whole dollar amount loaded each time; `null` when never set. */
  amountUsd: number | null
  /** Failed attempts in a row; the server stops trying after a few, until the setting is saved again. */
  failureCount: number
  /** ISO-8601; `null` before the first attempt. */
  lastAttemptAt: string | null
  /** Whether a card is saved to charge; without one, enabling cannot work. */
  hasSavedCard: boolean
}

/** What `billing.setAutoRecharge()` sends; `thresholdCredits` and `amountUsd` are both required to enable. */
export interface BillingAutoRechargeInput {
  enabled: boolean
  thresholdCredits?: number
  amountUsd?: number
}

/** What `billing.setAutoRecharge()` answers: the fields as sent (`null` for one left out, even when a stored value remains); read {@link BillingResource.autoRecharge} for the whole setting. */
export interface BillingAutoRechargeSaved {
  enabled: boolean
  thresholdCredits: number | null
  amountUsd: number | null
}

/** What `billing.checkout()` sends. */
export interface BillingCheckoutInput {
  /** A plan's monthly or yearly price id, or a credit pack's (`BillingTopUp.id`). */
  priceId: string
  /** Inferred from the price when omitted. */
  mode?: "subscription" | "payment"
  /** A path on the calling origin Stripe brings the person back to (`"/billing"`, a query allowed): one leading `/`, no host, no `#`. Wins over `embedded`. */
  returnPath?: string
  /** Set by an embedded first-party surface: return to the app's public checkout-complete page. */
  embedded?: boolean
}

/** A Stripe Checkout page to send the person to. */
export interface BillingCheckoutSession {
  url: string | null
}

/** What `billing.loadCredits()` sends. */
export interface BillingLoadInput {
  /** A whole dollar amount within `topUpRange`. */
  amountUsd: number
  /** As in {@link BillingCheckoutInput.returnPath}; wins over `embedded`. */
  returnPath?: string
  embedded?: boolean
}

/** A Stripe Checkout page for a load, and the credits it grants. */
export interface BillingLoadSession {
  url: string | null
  credits: number
}

/** What `billing.portal()` sends. */
export interface BillingPortalInput {
  /** Where the portal's Back goes: a path on the calling origin; default the app's `/billing`. */
  returnPath?: string
}

/** A Stripe Customer Portal page to send the person to. */
export interface BillingPortalSession {
  url: string
}

/** What `billing.changePlan()` sends. */
export interface BillingChangePlanInput {
  /** A subscription price id from the plans list. */
  newPriceId: string
}

/** What `billing.changePlan()` answers. */
export interface BillingChangePlanResult {
  subscriptionId: string
  /** The plan now in force: `"basic"`, `"standard"`, … */
  tier: string
}
