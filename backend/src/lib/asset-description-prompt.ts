/**
 * Shared system prompt + LLM options + user-message builder for the
 * Character Studio "asset description" LLM helper.
 *
 * Both surfaces produce the same kind of one-sentence visual description of a
 * character's pose / expression / lighting / angle, fed to an image-gen model
 * alongside a reference portrait:
 *
 *   - `routes/llm-suggest-description.ts` — the standalone ✨ helper endpoint
 *     used by the studio's ✨ button.
 *   - `routes/generate-character-asset.ts` — the inline draft path triggered
 *     when the user kicks off generation without first filling the description
 *     field (studio path only, `attachToCharacterId` set, no `description`).
 *
 * Keeping the system prompt, LLM options, and user-message format here means
 * the two routes can't drift out of sync.
 */

/**
 * System prompt for the asset-description LLM call.
 *
 * 15-25 word output, concrete physical / behavioral detail only — no
 * preamble, no camera / rendering language.
 */
export const ASSET_DESCRIPTION_SYSTEM_PROMPT =
  "You write concise, single-sentence visual descriptions of a character pose / expression / lighting / angle. " +
  "The description is fed to an image gen model alongside a reference portrait. " +
  "Be specific about facial muscles, body posture, framing as relevant. ~15–25 words. Output only the description."

/**
 * Shared LLM options for the asset-description call. Both surfaces write to
 * the SAME `description` field with the SAME system prompt, so output
 * character must be comparable.
 */
export const ASSET_DESCRIPTION_LLM_OPTIONS = {
  maxTokens: 400,
  temperature: 0.8,
} as const

export interface AssetDescriptionPromptCtx {
  assetType: string
  /**
   * The canonical variant name from `VARIANTS` (e.g. `"smile"`, `"standing"`)
   * for non-custom asset types. For `assetType === "custom"`, the inline
   * route passes the literal string `"custom"` here — which on its own is a
   * meaningless input to the LLM, so the builder falls back to `userPrompt`.
   */
  variant?: string
  /**
   * Free-form user prompt used when the asset is `"custom"` (or as a fallback
   * when `variant` is omitted by the standalone helper endpoint).
   */
  userPrompt?: string
  /**
   * Optional canonical description from the character row — gives the LLM
   * the identity context (e.g. "tall woman with red hair") so the generated
   * description stays consistent across assets of the same character.
   */
  canonicalDescription?: string | null
}

/**
 * Build the user message string for the asset-description LLM call.
 *
 * Selection rule for variant-or-prompt: prefer `variant` if set, else
 * `userPrompt`, else empty. This mirrors the standalone helper route's
 * `ctx.variant ?? ctx.userPrompt` behavior — critical for `custom` assets
 * where the inline route passes `variant === "custom"` and the meaningful
 * input is in `userPrompt`.
 */
export function buildAssetDescriptionUserMessage(ctx: AssetDescriptionPromptCtx): string {
  // For custom assets, `variant` is literally the string "custom" — a
  // meaningless input. Prefer userPrompt in that case. For non-custom
  // assets, variant carries the catalog value (e.g. "smile") and is what
  // we want to send.
  const variantOrPrompt =
    ctx.assetType === "custom"
      ? (ctx.userPrompt ?? ctx.variant ?? "")
      : (ctx.variant ?? ctx.userPrompt ?? "")
  return (
    `Asset type: ${ctx.assetType}. Variant or prompt: "${variantOrPrompt}".` +
    (ctx.canonicalDescription ? `\nCharacter: ${ctx.canonicalDescription}` : "")
  )
}
