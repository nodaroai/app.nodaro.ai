/**
 * What a Text to Speech / Text to Dialogue node costs, as its pill, its config
 * panel and its Run button show it: the flat row (today), or — when the server
 * serves the model's per-100-characters unit row, i.e. it prices speech by
 * length — the server's own price for the whole request the node will send,
 * through the one estimator (lib/speech-estimate.ts), which names every id. A
 * text that arrives at run time is a range (the floor up to the ceiling) and
 * runs at the ceiling.
 *
 * The ids are asked for through the batch endpoint, which answers an id it
 * serves nowhere in `missing` (a 200), and that answer is remembered for the
 * session: one request per (model, length), no refetch loop on an instance
 * with length pricing off. A price the pre-run prefetch already cached is read
 * from the cache. The flat path is `useModelCredits`, exactly as before.
 */
import { useQuery } from "@tanstack/react-query"
import { useShallow } from "zustand/react/shallow"
import { fetchBatchModelCreditCosts } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { getCachedModelCredits, isModelUnpriced, rememberUnpricedModels, useModelCredits } from "@/hooks/use-model-credit-cost"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { speechFlatId, speechQuote, speechQuoteIds, upstreamSpeechText, type SpeechQuote } from "@/lib/speech-estimate"

export interface SpeechPricing {
  /** What the Run button quotes: the flat row, or the length price (its ceiling for an unknown text). */
  readonly credits: number
  /** False when the text arrives at run time and `credits` is a ceiling. */
  readonly exact: boolean
  /** Set for an unknown text under length pricing: from the floor up to the ceiling. */
  readonly range?: { min: number; max: number }
  /** The length quote, when the server serves the unit row; undefined on the flat path. */
  readonly quote?: SpeechQuote
}

export function useSpeechPricing(
  nodeId: string | undefined,
  nodeType: "text-to-speech" | "text-to-dialogue",
  data: Record<string, unknown>,
): SpeechPricing {
  // The flat path, as today (a node with no stored model runs, and is billed, as the default model).
  const flat = useModelCredits(speechFlatId(nodeType, data), 4)
  // What the canvas says about a connected text (the one-hop rule); the app-input limits exist only at publish.
  const ctx = useWorkflowStore(useShallow((s) => upstreamSpeechText({ id: nodeId, type: nodeType, data }, s.nodes, s.edges, {})))
  const ids = speechQuoteIds(nodeType, data, ctx)
  const toAsk = ids.filter((id) => getCachedModelCredits(id) === undefined && !isModelUnpriced(id))
  const priceQuery = useQuery({
    queryKey: ["credits", "speech-quote", ...ids],
    queryFn: async () => {
      const { data: prices, missing } = await fetchBatchModelCreditCosts(toAsk)
      for (const [id, cost] of Object.entries(prices)) queryClient.setQueryData(queryKeys.credits.modelCost(id), cost)
      // Served nowhere (length pricing off): remembered, never re-asked.
      rememberUnpricedModels(missing)
      return prices
    },
    enabled: hasCredits() && toAsk.length > 0,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  })
  const fetched = priceQuery.data
  const quote = speechQuote(nodeType, data, ctx, (id) => getCachedModelCredits(id) ?? fetched?.[id])
  if (!quote) return { credits: flat, exact: true }
  return { credits: quote.credits, exact: quote.exact, range: quote.range, quote }
}
