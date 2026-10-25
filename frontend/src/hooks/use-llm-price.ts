/**
 * The price of an LLM call as a surface shows it: the server's ESTIMATE for
 * the model (shown `≈N`) while metered pricing is on, else today's tier price.
 *
 * Both ids (`llmPriceIds`) go out in ONE batch; the server alone decides which
 * applies — it marks the metered key in `estimates`, or reports it `missing`
 * under the tier-pricing rollback, and then the tier price shows exactly as
 * before (D6/D7). Core: it reads the core price cache
 * (`use-model-credit-cost`), never `@/ee`.
 */
import { useEffect, useMemo } from "react"
import { useQueries } from "@tanstack/react-query"
import { hasCredits } from "@/lib/edition"
import { availableReasoningEfforts, supportsAdvancedMode, type LlmReasoningEffort } from "@nodaro/shared/llm-models"
import { creditUnits, creditUnitLabel, formatCreditUnits } from "@/lib/credit-units"
import { queryKeys } from "@/lib/query-keys"
import { queryClient } from "@/lib/query-client"
import type { MessageKey } from "@/lib/i18n"
import { llmNodePriceIds, llmPriceIds, type LlmNodeLike, type LlmPriceIds } from "@/lib/llm-price-ids"
import { isModelEstimate, isModelRefused, isModelUnpriced, prefetchModelCreditCosts } from "./use-model-credit-cost"

export interface LlmPrice {
  /** The figure to show; undefined while loading, without credits, or when the server refuses the model. */
  readonly credits: number | undefined
  /** `credits` is an estimate (show `≈`). */
  readonly estimate: boolean
  readonly loading: boolean
  /** The server refuses to price this model (`llm_model_unpriced`): a run would be refused. */
  readonly refused?: true
}

const NO_PRICE: LlmPrice = { credits: undefined, estimate: false, loading: false }

/** Read-only subscription to a cached price: re-renders when a batch writes it, never fetches. */
function cachedPriceQuery(id: string) {
  return {
    queryKey: queryKeys.credits.modelCost(id),
    queryFn: () => queryClient.getQueryData<number>(queryKeys.credits.modelCost(id)) ?? null,
    enabled: false,
    staleTime: Infinity,
  }
}

/** The price `ids` resolve to, given what is cached for each. */
export function llmPriceOf(ids: LlmPriceIds, keyCredits: number | undefined, tierCredits: number | undefined): LlmPrice {
  if (!hasCredits()) return NO_PRICE
  if (isModelRefused(ids.key)) return { ...NO_PRICE, refused: true }
  if (keyCredits !== undefined && isModelEstimate(ids.key)) return { credits: keyCredits, estimate: true, loading: false }
  const settled = isModelUnpriced(ids.key) || isModelEstimate(ids.key)
  return { credits: tierCredits, estimate: false, loading: tierCredits === undefined && !settled }
}

/**
 * Prices of several LLM calls at once — one batch for every id (the model
 * pickers: one row per model). Keyed like the input list.
 */
export function useLlmPrices(idsList: readonly LlmPriceIds[]): LlmPrice[] {
  const flat = useMemo(() => [...new Set(idsList.flatMap((ids) => [ids.key, ids.tierId]))], [idsList])
  const flatKey = flat.join("\u0001")
  useEffect(() => {
    if (!hasCredits() || flat.length === 0) return
    void prefetchModelCreditCosts(flat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatKey])
  const results = useQueries({ queries: flat.map(cachedPriceQuery) }, queryClient)
  const byId = new Map<string, number | undefined>()
  flat.forEach((id, i) => {
    const value = results[i]?.data
    byId.set(id, typeof value === "number" ? value : undefined)
  })
  return idsList.map((ids) => llmPriceOf(ids, byId.get(ids.key), byId.get(ids.tierId)))
}

/**
 * The price of one LLM call of `feature` on `modelId` (unset → the feature's
 * default model): `{ credits, estimate: true }` when the server returned the
 * metered key as an estimate, else the tier price with `estimate: false`.
 */
export function useLlmPrice(
  feature: string,
  modelId: string | undefined,
  reasoningEffort?: string,
  advancedMode?: boolean,
): LlmPrice {
  const ids = useMemo(
    () => llmPriceIds(feature, modelId, reasoningEffort, advancedMode),
    [feature, modelId, reasoningEffort, advancedMode],
  )
  const list = useMemo(() => [ids], [ids])
  return useLlmPrices(list)[0]!
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

/**
 * A Run button's price suffix — `(≈6 CR)` for an estimate, `(6 CR)` for a
 * fixed price — in the deployment's display unit.
 */
export function formatCreditsSuffix(t: Translate, credits: number, estimate: boolean): string {
  return t(estimate ? "node.creditsSuffixApprox" : "node.creditsSuffix", {
    n: creditUnits(credits),
    u: creditUnitLabel(t("credits.unitShort")),
  })
}

/**
 * A metered LLM node's price as its pill and Run button show it: the server's
 * estimate (`estimate: true`), else the tier price, else `fallback` while
 * nothing has loaded (the figure the node always showed then). A model the
 * server refuses to price shows none.
 */
export function useLlmNodeCredits(
  feature: string,
  data: { readonly llmModel?: string; readonly reasoningEffort?: string; readonly advancedMode?: boolean },
  fallback: number,
): { readonly credits: number | undefined; readonly estimate: boolean } {
  const price = useLlmPrice(feature, data.llmModel, data.reasoningEffort, data.advancedMode === true)
  if (price.refused) return { credits: undefined, estimate: false }
  return { credits: price.credits ?? fallback, estimate: price.estimate }
}

/**
 * {@link useLlmNodeCredits} for a whole node, priced by the one rule the run
 * estimate reads (`llmNodePriceIds`): Generate Script's legacy provider maps to
 * its model, a Choose Best judge reads its strategy config, a deterministic
 * Edit 3D Scene makes no call (`credits: undefined`). The pill and the run
 * estimate cannot disagree.
 */
export function useLlmNodePrice(node: LlmNodeLike, fallback: number): { readonly credits: number | undefined; readonly estimate: boolean; readonly metered: boolean } {
  const ids = llmNodePriceIds(node)
  const idsList = useMemo(() => (ids ? [ids] : []), [ids?.key, ids?.tierId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [price] = useLlmPrices(idsList)
  if (!ids) return { credits: undefined, estimate: false, metered: false }
  if (!price || price.refused) return { credits: undefined, estimate: false, metered: true }
  return { credits: price.credits ?? fallback, estimate: price.estimate, metered: true }
}

/**
 * Each model's price in a model picker, for a node of `feature` running at the
 * node's effort and lane — the effort only on a model that accepts it, and
 * Advanced only on a model that has a direct lane, exactly as the run would
 * treat that model once picked. ONE batch for every row.
 */
export function useLlmModelPrices(
  feature: string,
  modelIds: readonly string[],
  reasoningEffort?: string,
  advancedMode?: boolean,
  /** Advanced mode applies to this model alone — a picker whose model switch
   *  clears Advanced (the quick strip) quotes every other model without it. */
  advancedOnlyFor?: string,
): ReadonlyMap<string, LlmPrice> {
  const idsList = useMemo(
    () => modelIds.map((model) => {
      const adv = advancedMode === true && supportsAdvancedMode(model) && (advancedOnlyFor === undefined || model === advancedOnlyFor)
      const effort = reasoningEffort && availableReasoningEfforts(model, adv).includes(reasoningEffort as LlmReasoningEffort)
        ? reasoningEffort
        : undefined
      return llmPriceIds(feature, model, effort, adv)
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feature, modelIds.join("\u0001"), reasoningEffort, advancedMode, advancedOnlyFor],
  )
  const prices = useLlmPrices(idsList)
  const pricesKey = modelIds.map((model, i) => `${model}=${prices[i]?.credits}:${prices[i]?.estimate}`).join("\u0001")
  return useMemo(() => new Map(modelIds.map((model, i) => [model, prices[i]!] as const)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pricesKey])
}

/**
 * A picker row's price — `≈27 CR` — shown ONLY for a figure the server
 * returned as an estimate (D7): under the tier-pricing rollback no model has
 * one, so the picker shows no prices, exactly as before. `unitLabel` is the
 * locale's short unit (`t("credits.unitShort")`).
 */
export function llmPickerPriceLabel(price: LlmPrice | undefined, unitLabel: string): string | undefined {
  if (!price || !price.estimate || price.credits === undefined) return undefined
  return `≈${formatCreditUnits(price.credits, { label: unitLabel })}`
}

/** The vendor's API costs over the usual lane: what the Effort and Advanced notes say. */
export interface LlmDirectCost {
  /** The server priced the direct lane as an estimate: metered pricing is on. */
  readonly metered: boolean
  /** About how many times the usual lane's estimate the direct lane's is —
   *  only when both are estimates and the direct one is clearly dearer. */
  readonly times: number | undefined
}

/** Below this the two lanes cost about the same: no "about N×" is said. */
const DIRECT_COST_MIN_TIMES = 1.5

/** `~2.3`, `~3`, `~12` — a multiple as a note says it. */
function roundTimes(ratio: number): number {
  return ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10
}

/**
 * What running `modelId` on the vendor's own API (an effort on a Claude model,
 * or Advanced mode) costs against its usual lane, from the server's two lane
 * estimates in one batch. Under the tier-pricing rollback neither is an
 * estimate (`metered: false`) and the notes keep their tier-era words.
 */
export function useLlmDirectCost(
  feature: string,
  modelId: string | undefined,
  direct: { readonly reasoningEffort?: string; readonly advancedMode?: boolean },
): LlmDirectCost {
  const idsList = useMemo(
    () => [
      llmPriceIds(feature, modelId, undefined, false),
      llmPriceIds(feature, modelId, direct.reasoningEffort, direct.advancedMode),
    ],
    [feature, modelId, direct.reasoningEffort, direct.advancedMode],
  )
  const [usual, vendor] = useLlmPrices(idsList)
  const metered = vendor?.estimate === true
  if (!metered || usual?.estimate !== true || idsList[0]!.key === idsList[1]!.key) return { metered, times: undefined }
  const ratio = (vendor.credits ?? 0) / (usual.credits ?? 0)
  return { metered, times: Number.isFinite(ratio) && ratio >= DIRECT_COST_MIN_TIMES ? roundTimes(ratio) : undefined }
}
