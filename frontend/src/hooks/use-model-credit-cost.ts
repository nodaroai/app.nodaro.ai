import { useQuery } from "@tanstack/react-query"
import { getModelCreditCost } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/** The one query both readers below share, so a price either of them fetched
 *  is already cached for the other. */
function modelCreditCostQuery(model: string) {
  return {
    queryKey: queryKeys.credits.modelCost(model),
    queryFn: async () => {
      const { data } = await getModelCreditCost(model)
      return data.creditCost
    },
    staleTime: Infinity,
  }
}

/** Public model-cost metadata; community builds never request billing data. */
export function useModelCreditCost(model: string | undefined) {
  return useQuery({
    ...modelCreditCostQuery(model ?? ""),
    enabled: !!model && hasCredits(),
    gcTime: 30 * 60_000,
  })
}

export function useModelCredits(model: string | undefined, fallback = 0): number {
  const { data } = useModelCreditCost(model)
  return hasCredits() ? data ?? fallback : 0
}

/**
 * The same price outside React, for a message raised by the run executor.
 * `undefined` when there is no price to quote: a build without credits, or a
 * lookup that failed. The caller then words its message without a figure
 * rather than quoting a guess.
 */
export async function fetchModelCredits(model: string): Promise<number | undefined> {
  if (!hasCredits()) return undefined
  try {
    return await queryClient.fetchQuery(modelCreditCostQuery(model))
  } catch {
    return undefined
  }
}
