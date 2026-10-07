import { MODEL_CATALOG } from "@nodaro/shared"
import { isSpeechUnitRow } from "./speech-estimate"

/** The cheapest and the priciest variant of one model, in credits. */
export interface CreditRange {
  min: number
  max: number
}

/** Every catalog model whose price depends on its settings, with the
 *  identifiers its variants are priced by. A speech model's per-100-characters
 *  row is a rate the speech estimator applies to the text, not a variant: it is
 *  left out, so a speech model keeps its flat badge. */
export const VARIABLE_PRICED_MODELS: ReadonlyArray<readonly [string, readonly string[]]> = Object.values(MODEL_CATALOG)
  .map((m) => [m.id, m.pricing.map((p) => p.identifier).filter((id) => !isSpeechUnitRow(id))] as const)
  .filter(([, ids]) => ids.length > 1)

const VARIABLE_PRICED_IDS: ReadonlySet<string> = new Set(VARIABLE_PRICED_MODELS.map(([id]) => id))

/** Whether a model's price depends on its settings, so a picker quotes a range. */
export function isVariablePricedModel(modelId: string): boolean {
  return VARIABLE_PRICED_IDS.has(modelId)
}

/** Each variable-priced model's range over the prices it is given (by identifier);
 *  a model none of whose variants is priced is left out. */
export function creditRangesFrom(costs: Readonly<Record<string, number>>): Record<string, CreditRange> {
  const ranges: Record<string, CreditRange> = {}
  for (const [modelId, ids] of VARIABLE_PRICED_MODELS) {
    const priced = ids.map((id) => costs[id]).filter((c): c is number => typeof c === "number")
    if (priced.length > 0) ranges[modelId] = { min: Math.min(...priced), max: Math.max(...priced) }
  }
  return ranges
}
