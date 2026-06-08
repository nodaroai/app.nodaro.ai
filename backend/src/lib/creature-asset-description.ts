/**
 * System prompt + LLM options + user-message builder for the Creature Studio
 * "asset description" LLM helper.
 *
 * Sibling to lib/object-asset-description.ts (object-leaning) — this is the
 * creature-shaped variant (`materials`→`poses`, object→creature). The
 * Studio-gated LLM draft step uses this module to produce a per-asset-type,
 * per-variant description from the canonical_description + userPrompt context.
 * The drafted description then flows into buildVariantPrompt() in
 * generate-creature-asset.ts (Phase D7) — the worker handler is unchanged
 * (it only sees the final prompt string).
 *
 * Pattern note: spec Pass 8 F-85 considered generalizing the shared
 * asset-description-prompt.ts to an entityType parameter but rejected that to
 * avoid character/image-to-image regression risk. Per-entity sibling files
 * match the character-caption.ts + location-caption.ts + object-caption.ts +
 * creature-caption.ts precedent.
 *
 * Used by:
 *  - routes/generate-creature-asset.ts (Phase D7 — inline route-side draft)
 */

/**
 * System prompt for the creature-asset-description LLM call.
 *
 * 15-25 word output, concrete anatomy/coat/markings/pose detail only — no
 * preamble, no camera / rendering language.
 */
export const CREATURE_ASSET_DESCRIPTION_SYSTEM_PROMPT =
  "You write concise, single-sentence visual descriptions of a creature's " +
  "anatomy / coat / markings / pose for an asset variant. " +
  "The description is fed to an image-gen model alongside a reference " +
  "creature image. Be specific about silhouette, texture (fur/scale/feather), " +
  "coloration, and stance cues relevant to the asset type. ~15–25 words. " +
  "Output only the description."

/**
 * Shared LLM options for the asset-description call. Same shape as
 * OBJECT_ASSET_DESCRIPTION_LLM_OPTIONS in the object-leaning sibling.
 */
export const CREATURE_ASSET_DESCRIPTION_LLM_OPTIONS = {
  maxTokens: 400,
  temperature: 0.8,
} as const

export interface CreatureAssetDescriptionPromptCtx {
  assetType: string
  /**
   * The canonical variant name (e.g. `"front"`, `"idle"`) for non-custom
   * asset types. For `assetType === "custom"`, the route passes the literal
   * `"custom"` here — which on its own is meaningless input to the LLM, so
   * the builder falls back to userPrompt.
   */
  variant?: string
  /**
   * Free-form user prompt used when the asset is `"custom"` (or as a
   * fallback when variant is omitted).
   */
  userPrompt?: string
  /**
   * Optional canonical description from the creature row — gives the LLM the
   * creature's identity context (e.g. "a six-legged armored reptilian beast
   * with bioluminescent spines") so the generated description stays
   * consistent across variants of the same creature.
   */
  canonicalDescription?: string | null
}

/**
 * Build the user message string for the creature-asset-description LLM call.
 *
 * Selection rule for variant-or-prompt: prefer variant if set, else
 * userPrompt, else empty. For `assetType === "custom"`, variant is literally
 * "custom" — meaningless on its own — so the rule inverts: prefer userPrompt.
 *
 * Label: `Creature: ${canonicalDescription}` so the LLM knows the context is
 * creature-shaped.
 */
export function buildCreatureAssetDescriptionUserMessage(
  ctx: CreatureAssetDescriptionPromptCtx,
): string {
  const variantOrPrompt =
    ctx.assetType === "custom"
      ? (ctx.userPrompt ?? ctx.variant ?? "")
      : (ctx.variant ?? ctx.userPrompt ?? "")
  return (
    `Asset type: ${ctx.assetType}. Variant or prompt: "${variantOrPrompt}".` +
    (ctx.canonicalDescription ? `\nCreature: ${ctx.canonicalDescription}` : "")
  )
}
