import { useQuery } from "@tanstack/react-query"
import { getModelCreditCost, fetchBatchModelCreditCosts } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Ids the server has answered are priced NOWHERE on this instance (the batch
 * endpoint's `missing`): a speech model's per-100-characters unit row while length
 * pricing is off, an unseeded admin row. Remembered for the session so an
 * estimate that runs on every graph change does not ask for them again; a
 * reader that finds no cached price quotes without it (the flat row).
 */
const unpricedModelIds = new Set<string>()

/** The server reported `model` priced nowhere this session. */
export function isModelUnpriced(model: string): boolean {
  return unpricedModelIds.has(model)
}

/** Remember the ids a batch answer reported `missing`. */
export function rememberUnpricedModels(models: readonly string[] | undefined): void {
  for (const model of models ?? []) unpricedModelIds.add(model)
}

/** Tests only: forget every remembered unpriced id. */
export function forgetUnpricedModels(): void {
  unpricedModelIds.clear()
}

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
 * back to one request per id. Ids already cached, and ids the server has
 * reported priced nowhere, are skipped; a build without credits fetches nothing.
 */
export async function prefetchModelCreditCosts(models: readonly string[]): Promise<void> {
  if (!hasCredits() || models.length === 0) return
  const uncached = models.filter((m) => queryClient.getQueryData(queryKeys.credits.modelCost(m)) === undefined && !unpricedModelIds.has(m))
  if (uncached.length === 0) return
  try {
    const { data: costs, missing } = await fetchBatchModelCreditCosts(uncached)
    for (const [model, cost] of Object.entries(costs)) {
      queryClient.setQueryData(queryKeys.credits.modelCost(model), cost)
    }
    rememberUnpricedModels(missing)
  } catch {
    await Promise.allSettled(uncached.map((model) => queryClient.prefetchQuery(modelCreditCostQuery(model))))
  }
}
