/**
 * Which subscription row is "the account's subscription" for a read.
 *
 * An account can hold several rows: one that ended before a re-subscribe,
 * and a second subscription that was granted nothing (second-subscription.ts:
 * left as recorded, unpaid, or recorded as ended). The newest row is therefore not always the
 * plan the account has. A row with a live status is answered first, the
 * newest of them; only when none is live is the newest row answered.
 */

import { supabase } from "../../lib/supabase.js"
import { LIVE_SUBSCRIPTION_STATUSES } from "./downgrade-floor.js"

/**
 * Given the account's newest row (already read with `columns`, which must
 * include `status`): that row when it is live, else the account's newest live
 * row, else that row. A newest row that is live costs no further read. A read
 * of the live row that fails answers the newest row, as before.
 */
export async function liveSubscriptionFirst<T extends { readonly status?: string | null }>(userId: string, columns: string, newest: T): Promise<T> {
  if (typeof newest.status === "string" && LIVE_SUBSCRIPTION_STATUSES.includes(newest.status)) return newest
  const { data, error } = await supabase
    .from("subscriptions")
    .select(columns)
    .eq("user_id", userId)
    .in("status", [...LIVE_SUBSCRIPTION_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return newest
  return data as unknown as T
}
