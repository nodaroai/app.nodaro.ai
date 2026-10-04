import { useQuery } from "@tanstack/react-query"
import { getModelCreditCost, getBatchModelCreditCosts } from "@/lib/api"
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

/**
 * The cached price of a model id, outside React and without a fetch:
 * undefined until some reader fetched it. The same cache `useModelCredits`
 * fills, so a price any node's button fetched is already here for an estimate.
 */
export function getCachedModelCredits(model: string): number | undefined {
  return queryClient.getQueryData<number>(queryKeys.credits.modelCost(model))
}

/**
 * Fetch these model ids' prices into that cache — one batch request, falling
 * back to one request per id. Ids already cached are skipped; a build without
 * credits fetches nothing.
 */
export async function prefetchModelCreditCosts(models: readonly string[]): Promise<void> {
  if (!hasCredits() || models.length === 0) return
  const uncached = models.filter((m) => queryClient.getQueryData(queryKeys.credits.modelCost(m)) === undefined)
  if (uncached.length === 0) return
  try {
    const costs = await getBatchModelCreditCosts(uncached)
    for (const [model, cost] of Object.entries(costs)) {
      queryClient.setQueryData(queryKeys.credits.modelCost(model), cost)
    }
  } catch {
    await Promise.allSettled(uncached.map((model) => queryClient.prefetchQuery(modelCreditCostQuery(model))))
  }
}
