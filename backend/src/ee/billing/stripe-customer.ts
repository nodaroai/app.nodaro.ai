import { supabase } from "../../lib/supabase.js"

/**
 * The person's Stripe customer id, `null` when they never reached Stripe.
 * Throws on a database error: a missing customer and a failed read are not
 * the same answer, and only the first means "nothing to show".
 */
export async function stripeCustomerIdOf(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from("stripe_customers").select("stripe_customer_id").eq("user_id", userId).maybeSingle()
  if (error) throw new Error(`stripe_customers lookup failed: ${error.message}`)
  const id = data?.stripe_customer_id
  return typeof id === "string" && id ? id : null
}
