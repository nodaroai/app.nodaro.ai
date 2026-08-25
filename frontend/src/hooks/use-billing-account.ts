import { useQuery } from "@tanstack/react-query"
import { getBillingAccount } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { queryKeys } from "@/lib/query-keys"
import type { BillingAccount } from "@/lib/billing-surface"

/**
 * The per-user account summary (B2 `account()`), rendered generically by the
 * usage view. `enabled` follows the deployment surface's `canAccount`, so a
 * `none` deployment never fires the request. `null` (authority unavailable) is
 * a distinct, real answer, never coerced to zeros.
 *
 * The query key is scoped by the authenticated userId, and `gcTime: 0` drops
 * the entry the moment nothing observes it. The app switches accounts WITHOUT
 * a page reload (see use-auth.ts) and signOut does not clear the React Query
 * cache, so an unscoped key would serve user A's account to user B on a
 * same-browser account switch — a cross-user cache leak.
 */
export function useBillingAccount(enabled: boolean): {
  account: BillingAccount | null
  isLoading: boolean
  isError: boolean
} {
  const { user } = useAuth()
  const userId = user?.id
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.billing.account(userId ?? ""),
    queryFn: getBillingAccount,
    enabled: enabled && !!userId,
    staleTime: 30_000,
    gcTime: 0,
  })
  return { account: data ?? null, isLoading: enabled && !!userId && isLoading, isError }
}
