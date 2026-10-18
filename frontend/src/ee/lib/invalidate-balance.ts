import type { QueryClient } from "@tanstack/react-query"

import { queryKeys } from "@/lib/query-keys"

/**
 * The shared site header (Cloud, `hasSharedHeader()`) caches the balance it
 * shows under exactly `["credits"]`; the app keeps its own per-user entry. A
 * change to the balance (a top-up, a plan change, the welcome credits) must
 * refresh both, or the header's figure waits for its next poll. `exact` keeps
 * the model prices under the same `["credits", …]` prefix untouched.
 */
export const HEADER_BALANCE_KEY = ["credits"] as const

export async function invalidateBalance(queryClient: QueryClient, userId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.credits.balance(userId) }),
    queryClient.invalidateQueries({ queryKey: HEADER_BALANCE_KEY, exact: true }),
  ])
}
