import { useQuery } from "@tanstack/react-query"
import { getUserCredits, type UserBalance } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"

export function useUserCredits(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.credits.balance(userId ?? ""),
    queryFn: async () => {
      const result = await getUserCredits(userId!)
      const data = result.data ?? (result as unknown as UserBalance)
      return data
    },
    enabled: !!userId && hasCredits(),
    refetchInterval: 30_000,
    staleTime: 30_000,
  })
}

// The price cache itself is core (hooks/use-model-credit-cost.ts) so a core
// estimate can read it; these names stay for the existing ee callers.
export {
  useModelCreditCost,
  getCachedModelCredits as getCachedCredits,
  prefetchModelCreditCosts as prefetchModelCredits,
  isModelUnpriced,
} from "@/hooks/use-model-credit-cost"
