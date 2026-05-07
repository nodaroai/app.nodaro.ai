/**
 * Stripe SDK Client
 *
 * Singleton Stripe instance, lazily constructed on first use.
 * Lazy init so that EDITION=community deployments can boot without
 * STRIPE_SECRET_KEY set — billing routes are gated behind hasCredits()
 * and never call getStripe() in community/business editions.
 */

import Stripe from "stripe"
import { config } from "../../lib/config.js"

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!config.STRIPE_SECRET_KEY) {
      throw new Error(
        "STRIPE_SECRET_KEY is required for billing operations but is not set. " +
        "This indicates an attempted billing call in a non-cloud edition or a misconfigured cloud deployment."
      )
    }
    _stripe = new Stripe(config.STRIPE_SECRET_KEY)
  }
  return _stripe
}
