/**
 * Stripe SDK Client
 *
 * Singleton Stripe instance configured from the validated config object.
 */

import Stripe from "stripe"
import { config } from "../lib/config.js"

export const stripe = new Stripe(config.STRIPE_SECRET_KEY)
