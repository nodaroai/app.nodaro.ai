/**
 * System prompt + LLM options + user-message builder for the Object Studio
 * "asset description" LLM helper.
 *
 * Sibling to lib/asset-description-prompt.ts (character-leaning). Object's
 * Studio-gated LLM draft step uses this module to produce a per-asset-type,
 * per-variant description from the canonical_description + userPrompt
 * context. The drafted description then flows into buildVariantPrompt() in
 * generate-object-asset.ts (Phase C2) — the worker handler is unchanged
 * (it only sees the final prompt string).
 *
 * Pattern note: spec Pass 8 F-85 considered generalizing the existing
 * shared asset-description-prompt.ts to an entityType parameter, but
 * rejected that to avoid character/image-to-image regression risk.
 * Sibling files match the character-caption.ts + location-caption.ts
 * precedent.
 *
 * Used by:
 *  - routes/generate-object-asset.ts (Phase C2 — inline route-side draft)
 */

/**
 * System prompt for the object-asset-description LLM call.
 *
 * 15-25 word output, concrete material/surface/condition detail only — no
 * preamble, no camera / rendering language.
 */
export const OBJECT_ASSET_DESCRIPTION_SYSTEM_PROMPT =
  "You write concise, single-sentence visual descriptions of an object's " +
  "surface / material / condition / detail for an asset variant. " +
  "The description is fed to an image-gen model alongside a reference " +
  "object image. Be specific about texture, finish, wear state, and " +
  "lighting cues relevant to the asset type. ~15–25 words. Output only " +
  "the description."

/**
 * Shared LLM options for the asset-description call. Same shape as
 * ASSET_DESCRIPTION_LLM_OPTIONS in the character-leaning sibling.
 */
export const OBJECT_ASSET_DESCRIPTION_LLM_OPTIONS = {
  maxTokens: 400,
  temperature: 0.8,
} as const

export interface ObjectAssetDescriptionPromptCtx {
  assetType: string
  /**
   * The canonical variant name from VARIANTS (e.g. `"wood"`, `"front"`) for
   * non-custom asset types. For `assetType === "custom"`, the route passes
   * the literal `"custom"` here — which on its own is meaningless input to
   * the LLM, so the builder falls back to userPrompt.
   */
  variant?: string
  /**
   * Free-form user prompt used when the asset is `"custom"` (or as a
   * fallback when variant is omitted).
   */
  userPrompt?: string
  /**
   * Optional canonical description from the object row — gives the LLM the
   * object's identity context (e.g. "an ornate brass goblet with intricate
   * engravings") so the generated description stays consistent across
   * variants of the same object.
   */
  canonicalDescription?: string | null
}

/**
 * Build the user message string for the object-asset-description LLM call.
 *
 * Selection rule for variant-or-prompt: prefer variant if set, else
 * userPrompt, else empty. For `assetType === "custom"`, variant is literally
 * "custom" — meaningless on its own — so the rule inverts: prefer userPrompt.
 *
 * Label: `Object: ${canonicalDescription}` (not `Character:` like the
 * sibling file) so the LLM knows the context is object-shaped.
 */
export function buildObjectAssetDescriptionUserMessage(
  ctx: ObjectAssetDescriptionPromptCtx,
): string {
  const variantOrPrompt =
    ctx.assetType === "custom"
      ? (ctx.userPrompt ?? ctx.variant ?? "")
      : (ctx.variant ?? ctx.userPrompt ?? "")
  return (
    `Asset type: ${ctx.assetType}. Variant or prompt: "${variantOrPrompt}".` +
    (ctx.canonicalDescription ? `\nObject: ${ctx.canonicalDescription}` : "")
  )
}
