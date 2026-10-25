/**
 * The LLM features whose calls still bill a TIER row while metered pricing is
 * on — the one list the server's price resolvers (the metered id parser, the
 * deployment price list) and the editor's model pickers read, so a picker can
 * never quote a per-model `≈N` for a call the server charges at its tier.
 *
 * - `workflow-copilot`: the Copilot keeps its own hand-set reservation
 *   ceilings (decided: Copilot unchanged under metered pricing).
 * - `content-recipe` / `content-ideas`: billed by their plugin at the tier
 *   row until that plugin meters its calls.
 *
 * Every other LLM feature bills per model while metered pricing is on.
 * Structure only — no prices.
 */
export const TIER_BILLED_LLM_FEATURES = ["workflow-copilot", "content-recipe", "content-ideas"] as const

export type TierBilledLlmFeature = (typeof TIER_BILLED_LLM_FEATURES)[number]

const TIER_BILLED: ReadonlySet<string> = new Set(TIER_BILLED_LLM_FEATURES)

/** Does a call of `feature` bill at its tier row even while metered pricing is on? */
export function isTierBilledLlmFeature(feature: string): feature is TierBilledLlmFeature {
  return TIER_BILLED.has(feature)
}
