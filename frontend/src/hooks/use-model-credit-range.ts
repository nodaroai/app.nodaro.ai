import { useQuery } from "@tanstack/react-query"
import { getBatchModelCreditCosts } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { creditRangesFrom, isVariablePricedModel, VARIABLE_PRICED_MODELS, type CreditRange } from "@/lib/model-credit-range"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

/** `POST /v1/credits/model-costs` answers at most this many identifiers per request. */
const MODEL_COSTS_BATCH = 50

/**
 * The charged price of every variant of every variable-priced model, read in
 * batches, reduced to one range per model. Each price also seeds the
 * per-identifier cache the Run buttons read, so both show the same number.
 */
async function fetchChargedCreditRanges(): Promise<Record<string, CreditRange>> {
  const identifiers = [...new Set(VARIABLE_PRICED_MODELS.flatMap(([, ids]) => ids))]
  const batches: string[][] = []
  for (let i = 0; i < identifiers.length; i += MODEL_COSTS_BATCH) {
    batches.push(identifiers.slice(i, i + MODEL_COSTS_BATCH))
  }
  const answers = await Promise.all(batches.map((batch) => getBatchModelCreditCosts(batch)))
  const costs: Record<string, number> = Object.assign({}, ...answers)
  for (const [identifier, credits] of Object.entries(costs)) {
    queryClient.setQueryData(queryKeys.credits.modelCost(identifier), credits)
  }
  return creditRangesFrom(costs)
}

/**
 * The range a model picker quotes for a variable-priced model: the cheapest
 * and the priciest variant at the price a run is CHARGED. It used to be read
 * off the catalog's base prices, so the picker quoted below the Run button.
 * Undefined until the prices load, for a fixed-price model, and on editions
 * without a credit system.
 */
export function useModelCreditRange(modelId: string): CreditRange | undefined {
  const { data } = useQuery({
    queryKey: queryKeys.credits.modelRanges(),
    queryFn: fetchChargedCreditRanges,
    enabled: hasCredits() && isVariablePricedModel(modelId),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  })
  return data?.[modelId]
}
