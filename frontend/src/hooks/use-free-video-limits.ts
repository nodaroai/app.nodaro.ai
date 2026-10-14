import { useQuery } from "@tanstack/react-query"
import { getUserCredits, type UserBalance } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { queryClient } from "@/lib/query-client"
import { getCachedUserId } from "@/hooks/use-auth"
import type { FreeVideoLimits } from "@/lib/free-video-locks"

/**
 * The free-credit video limits that apply to the signed-in account, or null
 * when none do (it paid, or this edition has no credits). Reads the SAME
 * balance query the credit widgets do (shared cache, refreshed every 30 s), so
 * a purchase unlocks the options without a reload. Core, not ee: it calls the
 * core API client directly, and names the app's query client itself, so a
 * picker rendered outside a QueryClientProvider (a test, an isolated preview)
 * still works.
 */
export function useFreeVideoLimits(): FreeVideoLimits | null {
  const userId = getCachedUserId()
  const { data } = useQuery({
    queryKey: queryKeys.credits.balance(userId ?? ""),
    queryFn: async () => {
      const result = await getUserCredits(userId!)
      return result.data ?? (result as unknown as UserBalance)
    },
    enabled: !!userId && hasCredits(),
    refetchInterval: 30_000,
    staleTime: 30_000,
  }, queryClient)
  return data?.freeVideoLimits ?? null
}
