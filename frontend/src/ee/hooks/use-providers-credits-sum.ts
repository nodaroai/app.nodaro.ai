import { useQueries } from "@tanstack/react-query"
import { getModelCreditCost } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { buildCreditModelIdentifier } from "@/components/editor/config-panels/helpers"

/**
 * Subscribe to credit costs for every provider in `providers`, summing the
 * results. Used to show the per-press cost on multi-provider nodes (each press
 * runs the node once per provider, so the displayed total is the sum, not a
 * single provider's cost).
 *
 * Returns 0 until at least one of the queries resolves; partial results are
 * summed as they come in. Pass the same `nodeData` you'd pass to
 * `buildCreditModelIdentifier` so quality/resolution composite ids are picked
 * up correctly per provider.
 */
export function useProvidersCreditsSum(
  providers: readonly string[],
  nodeData: Record<string, unknown>,
): number {
  const queries = useQueries({
    queries: providers.map((p) => {
      const id = buildCreditModelIdentifier(p, nodeData)
      return {
        queryKey: queryKeys.credits.modelCost(id),
        queryFn: async () => {
          const { data } = await getModelCreditCost(id)
          return data.creditCost
        },
        enabled: hasCredits(),
        staleTime: Infinity,
        gcTime: 30 * 60_000,
      }
    }),
  })
  return queries.reduce((sum, q) => sum + (q.data ?? 0), 0)
}
