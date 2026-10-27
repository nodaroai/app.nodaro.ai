/**
 * Every document Stripe writes for us — the invoice PDF and hosted page, the
 * receipt, a credit note — is in English, whatever language the person's
 * browser spoke at checkout.
 *
 * Stripe renders those documents in the customer's `preferred_locales`, and
 * a Checkout appears to write the browser's locale onto the customer it is
 * handed (the customers we create without a locale carry `en-US` or `he-IL`
 * after their first checkout; Stripe's own Hebrew invoice is a half-translated
 * mix). So the customer is created in English, every Checkout and Billing
 * Portal session runs in English — the payment page too, for everyone, by
 * decision — and a Checkout for a customer from before this rule first sets
 * that customer to English. These are the ONLY places the backend creates a
 * Stripe customer, a Checkout session or a Portal session —
 * `__tests__/stripe-english.test.ts` fails the build on another.
 */
import type Stripe from "stripe"
import { getStripe } from "./stripe-client.js"

/** The language of every Stripe-written document, and of the Checkout and Portal pages. */
export const STRIPE_DOCUMENT_LOCALE = "en" as const

/** A Stripe customer whose invoices, receipts and credit notes are in English. */
export async function createStripeCustomer(params: Stripe.CustomerCreateParams): Promise<Stripe.Customer> {
  return getStripe().customers.create({ ...params, preferred_locales: [STRIPE_DOCUMENT_LOCALE] })
}

/**
 * A Checkout session shown in English, so it never writes another language
 * onto the customer. An existing customer is set to English first (one from
 * before this rule may still carry the browser's locale); a failure of that
 * write is logged and never blocks the purchase.
 */
export async function createCheckoutSession(params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session> {
  if (typeof params.customer === "string") await setCustomerEnglish(params.customer)
  return getStripe().checkout.sessions.create({ ...params, locale: STRIPE_DOCUMENT_LOCALE })
}

/** A Billing Portal session shown in English. */
export async function createPortalSession(params: Stripe.BillingPortal.SessionCreateParams): Promise<Stripe.BillingPortal.Session> {
  return getStripe().billingPortal.sessions.create({ ...params, locale: STRIPE_DOCUMENT_LOCALE })
}

async function setCustomerEnglish(customerId: string): Promise<void> {
  try {
    await getStripe().customers.update(customerId, { preferred_locales: [STRIPE_DOCUMENT_LOCALE] })
  } catch (err) {
    console.warn(`[billing] could not set Stripe customer ${customerId} to English documents:`, (err as Error).message)
  }
}
