/**
 * Character LoRA routing decision.
 *
 * Shared between backend (orchestrator's payload-builder) and frontend
 * (single-node Run's execute-node). MUST agree byte-for-byte — the backend
 * stamps the credit identifier and worker payload off this decision, the
 * frontend stamps the `_internalLora` body hint off it. Mismatches would
 * silently degrade trained-character generations to ref injection.
 */

export interface LoraRouting {
  readonly characterSlug: string
  readonly triggerWord: string
  readonly loraVersion: string
}

export interface LoraEligibleRef {
  readonly characterSlug?: string
  readonly loraReplicateVersion?: string | null
  readonly loraTriggerWord?: string | null
  readonly loraTrainingStatus?: string | null
}

/**
 * Returns a LoraRouting iff EXACTLY ONE distinct character is mentioned AND
 * that character has a successful LoRA. Returns null otherwise → caller
 * falls back to ref injection. Multi-character LoRA composition is Phase 2.
 */
export function selectLoraRoutingForMentions(
  refs: readonly LoraEligibleRef[],
): LoraRouting | null {
  const distinct = new Set(refs.map((r) => r.characterSlug).filter(Boolean))
  if (distinct.size !== 1) return null
  const slug = [...distinct][0]!
  const match = refs.find((r) => r.characterSlug === slug)
  if (
    !match ||
    !match.loraReplicateVersion ||
    !match.loraTriggerWord ||
    match.loraTrainingStatus !== "succeeded"
  ) {
    return null
  }
  return {
    characterSlug: slug,
    triggerWord: match.loraTriggerWord,
    loraVersion: match.loraReplicateVersion,
  }
}
