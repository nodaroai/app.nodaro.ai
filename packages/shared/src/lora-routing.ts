/**
 * Character LoRA routing decision + identifier constants.
 *
 * Shared between backend (orchestrator's payload-builder) and frontend
 * (single-node Run's execute-node). MUST agree byte-for-byte — the backend
 * stamps the credit identifier and worker payload off this decision, the
 * frontend stamps the `_internalLora` body hint off it. Mismatches would
 * silently degrade trained-character generations to ref injection.
 */

/**
 * Synthetic Replicate model id selected by the orchestrator (and the
 * single-node Run pre-Zod swap) when a single trained `@character` mention
 * is detected. Routes through `black-forest-labs/flux-dev-lora` with the
 * character's trained version under `extraParams.lora_version`. Never
 * appears in user-facing dropdowns.
 */
export const FLUX_LORA_CHARACTER_MODEL_ID = "flux-lora-character" as const

/**
 * `jobs.job_type` discriminator + credit identifier for character LoRA
 * training jobs. Used for `STATIC_CREDIT_COSTS`/`model_pricing` lookup,
 * `creditGuard` reservation, refund flow, and webhook job lookup.
 */
export const CHARACTER_LORA_TRAINING_JOB_TYPE = "character-lora-training" as const

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
