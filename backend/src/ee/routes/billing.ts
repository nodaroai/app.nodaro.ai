/**
 * Billing Routes
 *
 * GET  /v1/billing/plans                  - The plans and credit packs on sale, with prices (public)
 * GET  /v1/billing/subscription          - Get current subscription
 * GET  /v1/billing/transactions           - Get transaction history
 * POST /v1/billing/create-checkout-session - Create Stripe Checkout session
 * POST /v1/billing/manage-subscription    - Get Stripe Customer Portal URL
 * POST /v1/billing/change-plan            - Change subscription tier
 * GET  /v1/billing/payment-method         - The card and billing details on file
 * GET  /v1/billing/invoices               - Invoices (subscriptions) and receipts (credit purchases), newest first
 *
 * The three routes that send the person to Stripe (checkout, load, portal)
 * take an optional `returnPath` — a path on the CALLING origin (`/billing`,
 * `/settings/credits`) Stripe sends them back to, so a first-party app on
 * another origin (tools.nodaro.ai) lands on its own screen. Checkout and
 * load add `checkout=success` or `checkout=cancelled` to it.
 */

import type { FastifyInstance } from "fastify"
import { resolveEffectiveTier, resolveStoredTier } from "@nodaro/shared/credits"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { getStripe } from "../billing/stripe-client.js"
import { createStripeCustomer, createCheckoutSession, createPortalSession } from "../billing/stripe-english.js"
import { PRICE_TO_PLAN, getTierFromPriceId, TIER_CREDITS, TIER_STORAGE_LIMITS, TOP_UPS } from "../billing/stripe-config.js"
import { creditsForLoadUsd, LOAD_CURRENCY, MIN_LOAD_USD, MAX_LOAD_USD } from "../billing/load-rate.js"
import { readBillingPlans } from "../billing/plans.js"
import { ensureStripeCustomer } from "../billing/provision-credits.js"
import { rejectProgrammaticAuth } from "../../lib/api-auth-mode.js"
import { tierColumns } from "../billing/tier-columns.js"
import { runtimeSurfaceProfile } from "../../lib/surface-profile.js"
import { deploymentPayerId } from "../../lib/deployment-payer.js"
import { byNewest, invoiceDocument, paymentMethodView, receiptDocument, type PurchaseRow } from "../billing/billing-documents.js"
import { stripeCustomerIdOf } from "../billing/stripe-customer.js"

/** Extract origin from request headers for redirect URLs. */
function getOrigin(req: { headers: Record<string, string | string[] | undefined> }): string {
  const origin = req.headers.origin
  const referer = req.headers.referer
  if (typeof origin === "string" && origin) return origin
  if (typeof referer === "string" && referer) {
    try { return new URL(referer).origin } catch { /* fall through */ }
  }
  return ""
}

/**
 * Where Stripe sends the person back: a path on the calling origin, never
 * another host, so a first-party app on its own origin lands on its own
 * screen. One leading `/` (not `//host`), no backslash (a browser reads
 * `/\host` as `//host`), no whitespace, no fragment (`#` would swallow the
 * `checkout=` flag); a query is allowed.
 */
const RETURN_PATH = /^\/(?![/\\])[^\\\s#?]*(\?[^\\\s#]*)?$/
const RETURN_PATH_MESSAGE = "returnPath must be a path on this origin: one leading /, no host, no #"
const returnPathSchema = z.string().max(200).regex(RETURN_PATH, RETURN_PATH_MESSAGE).optional()

/** `returnPath` with `checkout=<outcome>` added to its query, on the calling origin. */
function returnUrl(origin: string, returnPath: string, outcome: "success" | "cancelled"): string {
  const [path, query = ""] = returnPath.split("?", 2)
  const params = new URLSearchParams(query)
  params.set("checkout", outcome)
  return `${origin}${path}?${params.toString()}`
}

const checkoutSessionSchema = z.object({
  priceId: z.string(),
  mode: z.enum(["subscription", "payment"]).optional(),
  // Set by first-party embedded surfaces (e.g. studio.nodaro.ai's pricing /
  // billing iframe, which opens checkout in a new tab): return to the public
  // no-auth /checkout-complete page instead of /billing — the latter would
  // bounce that tab to login, since its session lives in the parent app.
  embedded: z.boolean().optional(),
  returnPath: returnPathSchema,
})

const changePlanSchema = z.object({
  newPriceId: z.string(),
})

// Billing is a first-party UI action — block OAuth apps + personal tokens
// (no scope authorizes changing the owner's Stripe subscription / charges).
const BILLING_JWT_ONLY_MSG = "Billing management is only available from a logged-in session."

/**
 * B4 — `billing.selfServe` had NO backend reader.
 *
 * The flag removes the pricing page, the buy-packs UI and the billing nav from
 * the browser, and it was assumed to be the control. It is not: the two
 * Checkout routes never consulted it, so any signed-in user of a
 * `selfServe:false` deployment could open Stripe Checkout by calling the route
 * directly and buy Nodaro credits into a personal balance that — on a
 * deployment-payer instance — nothing will ever spend. That is a real charge
 * for credits the customer's user cannot use.
 *
 * The payer keeps its own access: it buys through its own guarded route
 * (`/v1/deployment-billing/checkout`, whose success_url lands on a page this
 * deployment actually serves), and leaving the stock routes open to that one
 * account means a future page or a support flow is not broken by this same
 * class of surprise a second time.
 *
 * MAINLINE (R2): `selfServe` defaults TRUE in the code default, so this
 * short-circuits before it reads the payer at all and both routes take exactly
 * today's path.
 */
function selfServePurchaseAllowed(userId: string): boolean {
  return runtimeSurfaceProfile().billing.selfServe || userId === deploymentPayerId()
}

const SELF_SERVE_DISABLED = {
  error: {
    code: "self_serve_disabled",
    message:
      "This deployment does not sell credits to its users. Credits are purchased by the deployment's billing account.",
  },
} as const

export async function billingRoutes(app: FastifyInstance) {
  // The plans and credit packs on sale, with what each costs. Public pricing
  // data (middleware/auth.ts lists the path): no credential is needed and none
  // is read, so every caller gets the same answer and it may be cached. Where
  // each figure comes from: ee/billing/plans.ts.
  app.get("/v1/billing/plans", async (_req, reply) => {
    // B4 — a deployment that does not sell to its users has nothing on sale;
    // the same answer its checkout gives.
    if (!runtimeSurfaceProfile().billing.selfServe) {
      return reply.status(403).header("Cache-Control", "no-store").send(SELF_SERVE_DISABLED)
    }
    const result = await readBillingPlans()
    if (!result.ok) {
      reply.status(503).header("Cache-Control", "no-store")
      return result.code === "stripe_not_configured"
        ? reply.send({
            error: { code: "stripe_not_configured", message: "Card payment is not configured on this deployment." },
          })
        : reply.send({
            error: { code: "plan_prices_unavailable", message: "Plan prices are unavailable right now. Try again shortly." },
          })
    }
    return reply.header("Cache-Control", "public, max-age=300").send(result.plans)
  })

  // Get current subscription for a user
  app.get("/v1/billing/subscription", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }

    // effectiveTier needs a profiles lookup — this route historically read
    // only `subscriptions` and returned {data: null} for non-subscribers,
    // which left payg users indistinguishable from free here.
    const { data: profile } = await supabase
      .from("profiles")
      .select("tier, subscription_tier, lifetime_topup_credits")
      .eq("id", userId)
      .single()
    const effectiveTier = profile
      ? resolveEffectiveTier({
          tier: (profile.tier as string | null) ?? null,
          subscription_tier: (profile.subscription_tier as string | null) ?? null,
          lifetime_topup_credits: (profile.lifetime_topup_credits as number) ?? 0,
        })
      : "free"

    const { data, error } = await supabase
      .from("subscriptions")
      .select(
        "id, stripe_subscription_id, tier, status, stripe_price_id, current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (error || !data) {
      return reply.status(200).send({ data: null, effectiveTier })
    }

    return reply.send({ data, effectiveTier })
  })

  // Get transaction history for a user. JWT-only like every other billing
  // surface — purchase history + Stripe receipt URLs are settings-grade data
  // an OAuth-app or API token has no business reading.
  app.get("/v1/billing/transactions", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }
    if (rejectProgrammaticAuth(req, reply, BILLING_JWT_ONLY_MSG)) return

    // Org pack claims carry the OWNER's user_id by design (migration 351);
    // those credits never entered the personal balance, so the personal
    // receipts view must not list them. 42703 = the org_id column has not
    // reached this database yet (351 applies on the next promotion) — then
    // no org rows can exist and the unfiltered query is the same answer.
    let { data, error } = await supabase
      .from("transactions")
      .select(
        "id, stripe_transaction_id, type, amount_usd, credits_granted, tier, created_at, receipt_url"
      )
      .eq("user_id", userId)
      .is("org_id", null)
      .order("created_at", { ascending: false })
      .limit(50)
    if (error?.code === "42703") {
      ;({ data, error } = await supabase
        .from("transactions")
        .select(
          "id, stripe_transaction_id, type, amount_usd, credits_granted, tier, created_at, receipt_url"
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50))
    }

    if (error) {
      console.error("[billing] Failed to fetch transactions:", error.message)
      return reply.status(500).send({ error: "Failed to fetch transactions" })
    }

    return reply.send({ data: data ?? [] })
  })

  // Create a Stripe Checkout session for subscriptions or top-ups
  app.post("/v1/billing/create-checkout-session", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }
    // Billing is a first-party UI action — block OAuth apps + personal tokens
    // (no scope authorizes changing the owner's Stripe subscription / charges).
    if (rejectProgrammaticAuth(req, reply, BILLING_JWT_ONLY_MSG)) return
    // B4 — see selfServePurchaseAllowed. Refused BEFORE Stripe is touched.
    if (!selfServePurchaseAllowed(userId)) return reply.status(403).send(SELF_SERVE_DISABLED)

    const parsed = checkoutSessionSchema.safeParse(req.body)
    if (!parsed.success) {
      const onReturnPath = parsed.error.issues.some((issue) => issue.path[0] === "returnPath")
      return reply.status(400).send({ error: onReturnPath ? RETURN_PATH_MESSAGE : "priceId is required" })
    }

    const { priceId, mode, embedded, returnPath } = parsed.data
    const checkoutMode = mode ?? (PRICE_TO_PLAN[priceId] ? "subscription" : "payment")

    // Validate price ID
    if (checkoutMode === "subscription" && !PRICE_TO_PLAN[priceId]) {
      return reply.status(400).send({ error: "Invalid subscription price ID" })
    }
    if (checkoutMode === "payment" && !TOP_UPS[priceId]) {
      return reply.status(400).send({ error: "Invalid top-up price ID" })
    }

    try {
      // Ensure Stripe customer exists
      let stripeCustomerId: string | null = null

      const { data: existingCustomer } = await supabase
        .from("stripe_customers")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .single()

      if (existingCustomer) {
        stripeCustomerId = existingCustomer.stripe_customer_id
      } else {
        // Get user email from profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", userId)
          .single()

        const customer = await createStripeCustomer({
          email: profile?.email ?? undefined,
          metadata: { userId },
        })
        stripeCustomerId = customer.id
        await ensureStripeCustomer(customer.id, userId)
      }

      const baseUrl = getOrigin(req)
      // Embedded checkouts (opened in a new tab from a parent app's iframe)
      // return to the public no-auth /checkout-complete page — the normal
      // /billing (or /pricing) return URL would bounce that tab to login,
      // since its session lives in the parent app, not here.
      const successUrl = returnPath
        ? returnUrl(baseUrl, returnPath, "success")
        : embedded
          ? `${baseUrl}/checkout-complete?status=success`
          : checkoutMode === "payment"
            ? `${baseUrl}/billing?topup=true`
            : `${baseUrl}/billing?success=true`
      const cancelUrl = returnPath
        ? returnUrl(baseUrl, returnPath, "cancelled")
        : embedded
          ? `${baseUrl}/checkout-complete?status=cancelled`
          : `${baseUrl}/pricing`

      const session = await createCheckoutSession({
        customer: stripeCustomerId ?? undefined,
        mode: checkoutMode,
        line_items: [{ price: priceId, quantity: 1 }],
        // Seed the top-up priceId so the webhook can resolve credits from event
        // metadata if the secondary listLineItems API call fails (it swallows
        // errors → [] → 0 credits granted on a paid top-up, with no retry).
        metadata: checkoutMode === "payment" ? { userId, topupPriceId: priceId } : { userId },
        subscription_data: checkoutMode === "subscription" ? { metadata: { userId } } : undefined,
        allow_promotion_codes: true,
        success_url: successUrl,
        cancel_url: cancelUrl,
      })

      return reply.send({ data: { url: session.url } })
    } catch (err) {
      console.error("[billing] Failed to create checkout session:", (err as Error).message)
      return reply.status(500).send({ error: "Failed to create checkout session" })
    }
  })

  // Pay-as-you-go: load an ARBITRARY whole-dollar amount of credits.
  // The rate function (ee/billing/load-rate.ts) is the single pricing
  // source — this route only quotes it for the Checkout line item; the
  // webhook re-derives the grant from the settled amount through the same
  // function, so a mismatch fails loudly instead of granting.
  app.post("/v1/billing/create-load-session", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }
    if (rejectProgrammaticAuth(req, reply, BILLING_JWT_ONLY_MSG)) return
    // B4 — see selfServePurchaseAllowed. Refused BEFORE Stripe is touched.
    if (!selfServePurchaseAllowed(userId)) return reply.status(403).send(SELF_SERVE_DISABLED)

    const parsed = z
      .object({
        amountUsd: z.number().int().min(MIN_LOAD_USD).max(MAX_LOAD_USD),
        embedded: z.boolean().optional(),
        returnPath: returnPathSchema,
      })
      .safeParse(req.body)
    if (!parsed.success) {
      const onReturnPath = parsed.error.issues.some((issue) => issue.path[0] === "returnPath")
      return reply.status(400).send({
        error: onReturnPath ? RETURN_PATH_MESSAGE : `amountUsd must be a whole dollar amount between ${MIN_LOAD_USD} and ${MAX_LOAD_USD}`,
      })
    }
    const { amountUsd, embedded, returnPath } = parsed.data
    const credits = creditsForLoadUsd(amountUsd)

    try {
      let stripeCustomerId: string | null = null
      const { data: existingCustomer } = await supabase
        .from("stripe_customers")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .single()

      if (existingCustomer) {
        stripeCustomerId = existingCustomer.stripe_customer_id
      } else {
        const { data: profile } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", userId)
          .single()
        const customer = await createStripeCustomer({
          email: profile?.email ?? undefined,
          metadata: { userId },
        })
        stripeCustomerId = customer.id
        await ensureStripeCustomer(customer.id, userId)
      }

      // Receipt destination for this charge (Billing-UX): Stripe emails the
      // receipt per-PI, independent of the account-level email settings.
      const { data: emailRow } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", userId)
        .single()
      const loadEmail = emailRow?.email ?? null

      const baseUrl = getOrigin(req)
      const successUrl = returnPath
        ? returnUrl(baseUrl, returnPath, "success")
        : embedded
          ? `${baseUrl}/checkout-complete?status=success`
          : `${baseUrl}/billing?topup=true`
      const cancelUrl = returnPath
        ? returnUrl(baseUrl, returnPath, "cancelled")
        : embedded
          ? `${baseUrl}/checkout-complete?status=cancelled`
          : `${baseUrl}/billing`

      const session = await createCheckoutSession({
        customer: stripeCustomerId ?? undefined,
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: LOAD_CURRENCY,
              unit_amount: amountUsd * 100,
              product_data: {
                name: `${credits.toLocaleString()} Nodaro credits`,
                description: "Pay-as-you-go credit load — credits valid for 12 months",
              },
            },
            quantity: 1,
          },
        ],
        metadata: { userId, kind: "load", loadUsd: String(amountUsd) },
        // Save the card for off-session auto-recharge (design §5.1), and
        // have Stripe email the charge receipt (Billing-UX, 2026-08-12);
        // grant sizing never reads PI metadata from here.
        payment_intent_data: {
          setup_future_usage: "off_session",
          ...(loadEmail ? { receipt_email: loadEmail } : {}),
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      })

      return reply.send({ data: { url: session.url, credits } })
    } catch (err) {
      console.error("[billing] Failed to create load session:", (err as Error).message)
      return reply.status(500).send({ error: "Failed to create load session" })
    }
  })

  // Auto-recharge configuration — "when balance < X credits, load $Y".
  // JWT-only like every billing surface. The columns are RLS-guarded against
  // client writes; this service-role route is the ONLY writer.
  app.get("/v1/billing/auto-recharge", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: "Authentication required" })
    if (rejectProgrammaticAuth(req, reply, BILLING_JWT_ONLY_MSG)) return

    const { data: p } = await supabase
      .from("profiles")
      .select(
        "auto_recharge_enabled, auto_recharge_threshold_credits, auto_recharge_amount_usd, auto_recharge_failure_count, auto_recharge_last_attempt_at"
      )
      .eq("id", userId)
      .single()
    if (!p) return reply.status(404).send({ error: "Profile not found" })

    // Saved-card presence drives the needs_setup UI state.
    let hasSavedCard = false
    try {
      const { data: cust } = await supabase
        .from("stripe_customers")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .maybeSingle()
      const custId = cust?.stripe_customer_id
      if (custId) {
        const pms = await getStripe().paymentMethods.list({ customer: custId, type: "card", limit: 1 })
        hasSavedCard = pms.data.length > 0
      }
    } catch {
      // Card lookup is best-effort — the config itself still loads.
    }

    return reply.send({
      data: {
        enabled: p.auto_recharge_enabled ?? false,
        thresholdCredits: p.auto_recharge_threshold_credits ?? null,
        amountUsd: p.auto_recharge_amount_usd ?? null,
        failureCount: p.auto_recharge_failure_count ?? 0,
        lastAttemptAt: p.auto_recharge_last_attempt_at ?? null,
        hasSavedCard,
      },
    })
  })

  app.put("/v1/billing/auto-recharge", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: "Authentication required" })
    if (rejectProgrammaticAuth(req, reply, BILLING_JWT_ONLY_MSG)) return

    const parsed = z
      .object({
        enabled: z.boolean(),
        thresholdCredits: z.number().int().min(100).max(100000).optional(),
        amountUsd: z.number().int().min(MIN_LOAD_USD).max(MAX_LOAD_USD).optional(),
      })
      .safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message ?? "Invalid auto-recharge config",
      })
    }
    const { enabled, thresholdCredits, amountUsd } = parsed.data
    if (enabled && (!thresholdCredits || !amountUsd)) {
      return reply.status(400).send({ error: "Enabling requires thresholdCredits and amountUsd" })
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        auto_recharge_enabled: enabled,
        ...(thresholdCredits !== undefined ? { auto_recharge_threshold_credits: thresholdCredits } : {}),
        ...(amountUsd !== undefined ? { auto_recharge_amount_usd: amountUsd } : {}),
        // A deliberate config change is the user vouching for their card
        // again — clear the failure streak so re-enabling actually works.
        auto_recharge_failure_count: 0,
      })
      .eq("id", userId)
    if (error) {
      console.error("[billing] auto-recharge config update failed:", error.message)
      return reply.status(500).send({ error: "Failed to update auto-recharge settings" })
    }
    return reply.send({ data: { enabled, thresholdCredits: thresholdCredits ?? null, amountUsd: amountUsd ?? null } })
  })

  // Create a Stripe Customer Portal session for subscription management
  app.post("/v1/billing/manage-subscription", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({ error: "Authentication required" })
    }
    if (rejectProgrammaticAuth(req, reply, BILLING_JWT_ONLY_MSG)) return

    // Look up Stripe customer ID
    const { data: customer } = await supabase
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .single()

    if (!customer) {
      return reply.status(404).send({ error: "No Stripe customer found for this user" })
    }

    const parsedReturn = z.object({ returnPath: returnPathSchema }).safeParse(req.body ?? {})
    if (!parsedReturn.success) {
      return reply.status(400).send({ error: RETURN_PATH_MESSAGE })
    }
    const { returnPath } = parsedReturn.data

    try {
      const portalSession = await createPortalSession({
        customer: customer.stripe_customer_id,
        return_url: `${getOrigin(req)}${returnPath ?? "/billing"}`,
      })

      return reply.send({ data: { url: portalSession.url } })
    } catch (err) {
      console.error("[billing] Failed to create portal session:", (err as Error).message)
      return reply.status(500).send({ error: "Failed to create portal session" })
    }
  })

  // Change subscription plan (upgrade/downgrade via Stripe API)
  app.post("/v1/billing/change-plan", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(400).send({ error: "Authentication and newPriceId are required" })
    }
    if (rejectProgrammaticAuth(req, reply, BILLING_JWT_ONLY_MSG)) return

    const parsed = changePlanSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: "Authentication and newPriceId are required" })
    }

    const { newPriceId } = parsed.data

    // Only allow known subscription price IDs (reject topup IDs)
    if (!PRICE_TO_PLAN[newPriceId]) {
      return reply.status(400).send({ error: "Invalid price ID" })
    }

    // Find active subscription
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id, stripe_price_id, status")
      .eq("user_id", userId)
      .in("status", ["active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (!sub) {
      return reply.status(404).send({ error: "No active subscription found" })
    }

    if (sub.stripe_price_id === newPriceId) {
      return reply.status(400).send({ error: "Already on this plan" })
    }

    try {
      // Get the subscription to find the item ID
      const stripeSub = await getStripe().subscriptions.retrieve(sub.stripe_subscription_id)
      const itemId = stripeSub.items.data[0]?.id
      if (!itemId) {
        return reply.status(500).send({ error: "Could not find subscription item" })
      }

      const updated = await getStripe().subscriptions.update(
        sub.stripe_subscription_id,
        {
          items: [{ id: itemId, price: newPriceId }],
          proration_behavior: "create_prorations",
        }
      )

      const newTier = getTierFromPriceId(newPriceId)
      const newCredits = TIER_CREDITS[newTier] ?? 0
      const newStorageLimit = TIER_STORAGE_LIMITS[newTier] ?? TIER_STORAGE_LIMITS.free
      const oldTier = getTierFromPriceId(sub.stripe_price_id)
      const isUpgrade = newCredits > (TIER_CREDITS[oldTier] ?? 0)

      // Immediate local DB update so users see changes right away
      // (webhook will reconcile later as a backup)
      const { error: subUpdateError } = await supabase
        .from("subscriptions")
        .update({
          stripe_price_id: newPriceId,
          tier: newTier,
        })
        .eq("stripe_subscription_id", sub.stripe_subscription_id)

      if (subUpdateError) {
        console.error("[billing] change-plan: subscriptions update failed:", subUpdateError.message)
      }

      // Tier flips immediately for both directions. But ONLY raise credits +
      // storage on an UPGRADE — on a downgrade, keep the current (higher) credits
      // and storage until next renewal, matching handleSubscriptionUpdated's
      // downgrade policy in stripe-webhook. Reducing them here charged the user
      // back the credits they already paid for this period and could shove them
      // over the new (smaller) storage quota mid-cycle.
      const profileUpdate: Record<string, unknown> = { ...tierColumns(newTier) }
      if (isUpgrade) {
        profileUpdate.subscription_credits = newCredits
        profileUpdate.storage_limit_bytes = newStorageLimit
      }
      const { error: profileUpdateError } = await supabase
        .from("profiles")
        .update(profileUpdate)
        .eq("id", userId)

      if (profileUpdateError) {
        console.error("[billing] change-plan: profiles update failed:", profileUpdateError.message)
      }
      console.log(`[billing] change-plan: profile updated for user=${userId}, tier=${newTier}, isUpgrade=${isUpgrade}${isUpgrade ? `, credits=${newCredits}` : " (credits kept until renewal)"}`)

      return reply.send({
        data: { subscriptionId: updated.id, tier: newTier },
      })
    } catch (err) {
      console.error("[billing] Failed to change plan:", (err as Error).message)
      return reply.status(500).send({ error: "Failed to change plan" })
    }
  })

  // The card and the billing details on file with Stripe: the customer's
  // default payment method, else the first saved card. Settings-grade data,
  // so a signed-in session only, like every billing surface. A user Stripe
  // does not know yet (no purchase) has nothing on file: `{ card: null,
  // billingDetails: null }`, never an error.
  app.get("/v1/billing/payment-method", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: "Authentication required" })
    if (rejectProgrammaticAuth(req, reply, BILLING_JWT_ONLY_MSG)) return

    try {
      const customerId = await stripeCustomerIdOf(userId)
      if (!customerId) return reply.send({ data: paymentMethodView(null, null) })

      const stripe = getStripe()
      const customer = await stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] })
      if (customer.deleted) return reply.send({ data: paymentMethodView(null, null) })
      const preferred = customer.invoice_settings?.default_payment_method
      // The default when it is a card; else the first saved card (the default may be Link or a bank account).
      let method = preferred && typeof preferred !== "string" && preferred.card ? preferred : null
      if (!method) {
        const cards = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 })
        method = cards.data[0] ?? null
      }
      return reply.send({ data: paymentMethodView(customer, method) })
    } catch (err) {
      console.error("[billing] Failed to read the payment method:", (err as Error).message)
      return reply.status(500).send({ error: "Failed to read the payment method" })
    }
  })

  // Every payment as a document, newest first: a Stripe invoice for each
  // subscription payment (with its PDF), a receipt for each credit purchase
  // (a pack or a pay-as-you-go load; the `transactions` row's hosted receipt)
  // and the refund of one (migration 308: `type = 'refund'`, credits negative).
  // Personal rows only: an organization's pack claims ride the owner's
  // user_id (migration 351) and are not this person's purchases. The latest
  // 100 of each source; `amount_usd` is what the person paid, in US dollars.
  app.get("/v1/billing/invoices", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: "Authentication required" })
    if (rejectProgrammaticAuth(req, reply, BILLING_JWT_ONLY_MSG)) return

    const purchaseColumns = "id, type, amount_usd, credits_granted, status, created_at, receipt_url"
    let { data: purchases, error } = await supabase
      .from("transactions")
      .select(purchaseColumns)
      .eq("user_id", userId)
      .in("type", ["topup", "refund"])
      .is("org_id", null)
      .order("created_at", { ascending: false })
      .limit(100)
    if (error?.code === "42703") {
      // The org_id column has not reached this database yet: no org rows can exist.
      ;({ data: purchases, error } = await supabase
        .from("transactions")
        .select(purchaseColumns)
        .eq("user_id", userId)
        .in("type", ["topup", "refund"])
        .order("created_at", { ascending: false })
        .limit(100))
    }
    if (error) {
      console.error("[billing] Failed to fetch purchases:", error.message)
      return reply.status(500).send({ error: "Failed to fetch invoices" })
    }

    try {
      const customerId = await stripeCustomerIdOf(userId)
      const invoices = customerId ? (await getStripe().invoices.list({ customer: customerId, limit: 100 })).data : []
      const docs = [
        ...invoices.map(invoiceDocument).filter((doc) => doc !== null),
        ...((purchases ?? []) as PurchaseRow[]).map((row) => receiptDocument(row, "USD")),
      ]
      return reply.send({ data: byNewest(docs) })
    } catch (err) {
      console.error("[billing] Failed to list invoices:", (err as Error).message)
      return reply.status(500).send({ error: "Failed to fetch invoices" })
    }
  })
}
