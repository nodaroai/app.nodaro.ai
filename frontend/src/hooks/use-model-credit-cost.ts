import { useQuery } from "@tanstack/react-query"
import { getModelCreditCost } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"

/** Public model-cost metadata; community builds never request billing data. */
export function useModelCreditCost(model: string | undefined) {
  return useQuery({
    queryKey: queryKeys.credits.modelCost(model ?? ""),
    queryFn: async () => {
      const { data } = await getModelCreditCost(model!)
      return data.creditCost
    },
    enabled: !!model && hasCredits(),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  })
}

export function useModelCredits(model: string | undefined, fallback = 0): number {
  const { data } = useModelCreditCost(model)
  return hasCredits() ? data ?? fallback : 0
}
