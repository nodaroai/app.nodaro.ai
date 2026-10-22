import { useQuery } from "@tanstack/react-query"
import { getModelCreditCost, fetchBatchModelCreditCosts, estimateSeedanceRefCredits } from "@/lib/api"
import { isSeedanceRefQuoteKey, parseSeedanceRefQuoteKey } from "@/lib/seedance-ref-quote-key"
import { hasCredits } from "@/lib/edition"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { forgetLlmPricingMode, notePricingAnswer } from "./use-llm-pricing-mode"

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

/**
 * Ids the server answered with an ESTIMATE (the batch's `estimates`, the GET's
 * `estimate: true`): a metered LLM call's price key, charged its actual usage
 * after the run. Every surface shows such a figure with a leading `~`. Only the
 * server marks one — under the tier-pricing rollback no metered key is priced,
 * so nothing lands here and every surface looks exactly as before.
 */
const estimateModelIds = new Set<string>()

/** The server priced `model` as an estimate this session. */
export function isModelEstimate(model: string): boolean {
  return estimateModelIds.has(model)
}

/** Remember the ids an answer marked as estimates. */
export function rememberEstimateModels(models: readonly string[] | undefined): void {
  for (const model of models ?? []) estimateModelIds.add(model)
}

/**
 * Metered price keys the server REFUSES to price (`errorCodes` —
 * `llm_model_unpriced`): a run on that model would be refused, so no price is
 * shown for it (and it is never quoted at another key's price). Each with the
 * server's own sentence, the one the run's refusal says.
 */
const refusedModelIds = new Map<string, string | undefined>()

/** The server refused to price `model` (a metered model with no rate). */
export function isModelRefused(model: string): boolean {
  return refusedModelIds.has(model)
}

/** Why the server refused to price `model` — its `llm_model_unpriced` message — when it did and said so. */
export function refusedModelMessage(model: string): string | undefined {
  return refusedModelIds.get(model)
}

/** Remember the metered keys an answer refused to price (`errorCodes`), each with its message when the answer gave one. */
export function rememberRefusedModels(
  models: readonly string[] | undefined,
  messages?: Readonly<Record<string, { readonly message?: string }>>,
): void {
  for (const model of models ?? []) refusedModelIds.set(model, messages?.[model]?.message ?? refusedModelIds.get(model))
}

/** Tests only: forget every remembered estimate and refused id, and the pricing mode they showed. */
export function forgetEstimateModels(): void {
  estimateModelIds.clear()
  refusedModelIds.clear()
  forgetLlmPricingMode()
}

/** The one query both readers below share, so a price either of them fetched
 *  is already cached for the other. */
function modelCreditCostQuery(model: string) {
  return {
    queryKey: queryKeys.credits.modelCost(model),
    queryFn: async () => {
      const { data } = await getModelCreditCost(model)
      if (data.estimate === true) rememberEstimateModels([model])
      // The pricing mode this answer shows: an estimate is per-model pricing; a
      // metered key priced at a plain figure, the tier rollback.
      notePricingAnswer(data.estimate === true ? { estimates: [model] } : { missing: [model] })
      return data.creditCost
    },
    staleTime: Infinity,
  }
}

/** A Seedance 2 reference-video quote (the server probes the clips). */
export interface SeedanceRefQuote {
  readonly credits: number
  readonly min: number
  readonly exact: boolean
}

/** The one query a quote key is fetched through — by the node's pill and by
 *  the run estimate's prefetch alike, so either one's answer serves both. */
function seedanceRefQuoteQuery(quoteKey: string) {
  return {
    queryKey: queryKeys.credits.seedanceRef(quoteKey),
    queryFn: async (): Promise<SeedanceRefQuote> => {
      const request = parseSeedanceRefQuoteKey(quoteKey)
      if (!request) throw new Error("not a Seedance reference-video quote key")
      return estimateSeedanceRefCredits(request)
    },
    // A key names its clips by URL: a new clip is a new key.
    staleTime: Infinity,
    retry: false,
  }
}

/**
 * The quote for a Seedance 2 run with reference video(s) — `undefined` while
 * it loads, when it failed (a clip the run would refuse), or with no key.
 * `exact: false` while a clip is not produced yet: `credits` is then the most
 * the run can reserve and `min` the least.
 */
export function useSeedanceRefQuote(quoteKey: string | undefined): SeedanceRefQuote | undefined {
  // The app's one client, named explicitly: the run estimate reads this cache
  // through `getCachedModelCredits`, which has no React context either.
  const { data } = useQuery({
    ...seedanceRefQuoteQuery(quoteKey ?? ""),
    enabled: !!quoteKey && hasCredits(),
    gcTime: 30 * 60_000,
  }, queryClient)
  return data
}

/** Public model-cost metadata; community builds never request billing data. */
export function useModelCreditCost(model: string | undefined) {
  return useQuery({
    ...modelCreditCostQuery(model ?? ""),
    // A reference-video quote key is not a model id: `useSeedanceRefQuote`.
    enabled: !!model && hasCredits() && !isSeedanceRefQuoteKey(model),
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
  // A reference-video quote key: what that run reserves (or, with a clip not
  // produced yet, the most it can) — `seedance-ref-quote-key.ts`.
  if (isSeedanceRefQuoteKey(model)) return queryClient.getQueryData<SeedanceRefQuote>(queryKeys.credits.seedanceRef(model))?.credits
  return queryClient.getQueryData<number>(queryKeys.credits.modelCost(model))
}

/**
 * Fetch these model ids' prices into that cache — one batch request, falling
 * back to one request per id. Ids already cached, and ids the server has
 * reported priced nowhere, are skipped; a build without credits fetches nothing.
 */
export async function prefetchModelCreditCosts(models: readonly string[]): Promise<void> {
  if (!hasCredits() || models.length === 0) return
  // Reference-video quote keys go to their own endpoint (the server probes the
  // clips); one it refuses (a clip the run would refuse too) is not asked again.
  const quotes = models.filter((m) => isSeedanceRefQuoteKey(m) && getCachedModelCredits(m) === undefined && !unpricedModelIds.has(m))
  const quoted = Promise.allSettled(quotes.map((key) =>
    queryClient.fetchQuery(seedanceRefQuoteQuery(key)).catch(() => rememberUnpricedModels([key])),
  ))
  const uncached = models.filter((m) => !isSeedanceRefQuoteKey(m) && queryClient.getQueryData(queryKeys.credits.modelCost(m)) === undefined && !unpricedModelIds.has(m))
  if (uncached.length === 0) {
    await quoted
    return
  }
  await Promise.all([quoted, prefetchRows(uncached)])
}

async function prefetchRows(uncached: readonly string[]): Promise<void> {
  try {
    const { data: costs, missing, estimates, errorCodes } = await fetchBatchModelCreditCosts([...uncached])
    // Marked BEFORE the prices land in the cache: a reader re-rendered by the
    // cache write already sees the id as an estimate.
    rememberEstimateModels(estimates)
    const refused = Object.keys(errorCodes ?? {})
    rememberRefusedModels(refused, errorCodes)
    // Every answer says which mode the server prices LLM calls in (the effort
    // labels follow it, a mid-session rollback included).
    notePricingAnswer({ estimates, refused, missing })
    for (const [model, cost] of Object.entries(costs)) {
      queryClient.setQueryData(queryKeys.credits.modelCost(model), cost)
    }
    // A refused key is not asked again either: its answer will not change.
    rememberUnpricedModels([...missing, ...refused])
  } catch {
    await Promise.allSettled(uncached.map((model) => queryClient.prefetchQuery(modelCreditCostQuery(model))))
  }
}
