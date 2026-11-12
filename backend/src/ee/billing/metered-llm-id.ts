/**
 * The metered LLM credit id — `<feature>:<modelId>[:direct | :effort-<level>]`
 * — read back into its parts. The id a metered call is reserved, settled and
 * marked up under (`llmChargeId`, always the bare `<feature>:<modelId>`), and
 * the id a price surface asks an estimate for (`llmPriceKey`: `:direct` = the
 * call pinned to the vendor's own API, Advanced mode; `:effort-<level>` = the
 * effort the call sends, on a model whose price depends on it).
 *
 * Pure. Nothing here consults the rollback switch: the resolvers that read a
 * parsed id (`getModelCreditBaseCost`, the charged price table) decide whether
 * metered ids resolve at all.
 */
import { parseLlmPriceKeyModel, type LlmReasoningEffort } from "@nodaro/shared/llm-models"
import { METERED_LLM_FEATURES, type MeteredLlmFeature } from "./llm-typical-usage.js"

export interface MeteredLlmId {
  feature: MeteredLlmFeature
  modelId: string
  /** Present only for an id that names the direct lane. */
  lane?: "direct"
  /**
   * Present only for an id that names the effort the call sends — a price key
   * of an `effortPriced` model. Such a model's key always says it: a key with
   * none means no effort is sent.
   */
  reasoningEffort?: LlmReasoningEffort
}

/** Longest first, so `reduce:pick-best-llm` is matched before any shorter feature it starts with. */
const FEATURES_LONGEST_FIRST: readonly MeteredLlmFeature[] = [...METERED_LLM_FEATURES].sort((a, b) => b.length - a.length)

/**
 * `{ feature, modelId, lane?, reasoningEffort? }` for a key `llmPriceKey`
 * could build, where `feature` is the longest matching
 * {@link METERED_LLM_FEATURES} prefix and the rest reads as one registry model
 * (`parseLlmPriceKeyModel`, the reader the editor uses too); null for anything
 * else — a tier id (`llm-chat:premium`), a bare feature, an unknown model, a
 * suffix no key carries.
 */
export function parseMeteredLlmId(id: string): MeteredLlmId | null {
  const feature = FEATURES_LONGEST_FIRST.find((f) => id.startsWith(`${f}:`))
  if (!feature) return null
  const model = parseLlmPriceKeyModel(id.slice(feature.length + 1))
  return model ? { feature, ...model } : null
}
