import type { QueryClient } from "@tanstack/react-query"

import { HEADER_QUERY_KEYS } from "@/ee/shell/query-keys"
import { dispatchAccountChanged } from "@/lib/account-changed-event"
import { queryKeys } from "@/lib/query-keys"

/**
 * A white-label header caches the balance it shows under exactly `["credits"]`
 * in the app's own QueryClient; the app keeps its own per-user entry, and the
 * hosted header keeps its own copy and listens for one event. A change to the
 * balance (a top-up, a plan change, the welcome credits) must refresh all
 * three, or the header's figure waits for its next poll. `exact` keeps the
 * model prices under the same `["credits", …]` prefix untouched.
 */
export const HEADER_BALANCE_KEY = HEADER_QUERY_KEYS.credits

export async function invalidateBalance(queryClient: QueryClient, userId: string): Promise<void> {
  dispatchAccountChanged()
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.credits.balance(userId) }),
    queryClient.invalidateQueries({ queryKey: HEADER_BALANCE_KEY, exact: true }),
  ])
}
