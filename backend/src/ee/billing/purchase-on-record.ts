import { supabase } from "../../lib/supabase.js"

/**
 * Has this account ever actually PAID? A settled `transactions` row (written
 * only by the Stripe webhook, after settlement) for MORE than zero dollars —
 * a top-up or a paid subscription invoice. A card on file, a trial, or a $0
 * invoice is not a payment: entering a card was exactly how the 2026-10
 * signup farm looked like a customer (owner decision 2026-10-14). A cancelled
 * subscriber who paid an invoice keeps the exemption, although their stored
 * tier went back to free.
 *
 * Read only on the refusal path of the free-credit video limits, cached per
 * account for a minute. A failed read answers false: the limits stay on, the
 * safe direction for free credits.
 */
const TTL_MS = 60_000
const cache = new Map<string, { paid: boolean; at: number }>()

export async function hasPurchaseOnRecord(userId: string): Promise<boolean> {
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.paid
  try {
    const { count, error } = await supabase
      .from("transactions")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "completed")
      .gt("amount_usd", 0)
    if (error) return false
    const paid = (count ?? 0) > 0
    cache.set(userId, { paid, at: Date.now() })
    return paid
  } catch {
    return false
  }
}

/** Tests: forget the cached answers. */
export function invalidatePurchaseOnRecordCache(): void {
  cache.clear()
}
