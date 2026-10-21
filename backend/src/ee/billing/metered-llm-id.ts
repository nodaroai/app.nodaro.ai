/**
 * The metered LLM credit id — `<feature>:<modelId>[:direct]` — read back into
 * its parts. The id a metered call is reserved, settled and marked up under
 * (`llmChargeId`), and the id a price surface asks an estimate for (`:direct`
 * = the call pinned to the vendor's own API, Advanced mode).
 *
 * Pure. Nothing here consults the rollback switch: the resolvers that read a
 * parsed id (`getModelCreditBaseCost`, the charged price table) decide whether
 * metered ids resolve at all.
 */
import { LLM_MODEL_IDS } from "@nodaro/shared/llm-models"
import { METERED_LLM_FEATURES, type MeteredLlmFeature } from "./llm-typical-usage.js"

export interface MeteredLlmId {
  feature: MeteredLlmFeature
  modelId: string
  /** Present only for an id that names the direct lane. */
  lane?: "direct"
}

/** Longest first, so `reduce:pick-best-llm` is matched before any shorter feature it starts with. */
const FEATURES_LONGEST_FIRST: readonly MeteredLlmFeature[] = [...METERED_LLM_FEATURES].sort((a, b) => b.length - a.length)

/**
 * Registry model ids only — never a borrowed KIE slug that `getLlmModel`
 * would also resolve to its owner, so an id names exactly one model.
 */
const MODEL_IDS: ReadonlySet<string> = new Set<string>(LLM_MODEL_IDS)

const DIRECT_SUFFIX = ":direct"

/**
 * `{ feature, modelId, lane? }` for `<feature>:<modelId>` or
 * `<feature>:<modelId>:direct`, where `feature` is the longest matching
 * {@link METERED_LLM_FEATURES} prefix and `modelId` a registry model id; null
 * for anything else — a tier id (`llm-chat:premium`), a bare feature, an
 * unknown model, a trailing segment other than `:direct`.
 */
export function parseMeteredLlmId(id: string): MeteredLlmId | null {
  const feature = FEATURES_LONGEST_FIRST.find((f) => id.startsWith(`${f}:`))
  if (!feature) return null
  let rest = id.slice(feature.length + 1)
  let lane: "direct" | undefined
  if (rest.endsWith(DIRECT_SUFFIX)) {
    const model = rest.slice(0, -DIRECT_SUFFIX.length)
    // A model id that itself ends in ":direct" does not exist; prefer the model reading anyway.
    if (!MODEL_IDS.has(rest)) {
      rest = model
      lane = "direct"
    }
  }
  if (!MODEL_IDS.has(rest)) return null
  return lane ? { feature, modelId: rest, lane } : { feature, modelId: rest }
}
