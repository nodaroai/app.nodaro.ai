/**
 * Character-mention usage modes — describe HOW the AI should consume a
 * referenced character image. The mode shapes the per-image directive in the
 * assembled prompt (see `usageModeDirective`) so the same character reference
 * can act as a full likeness replacement, a face-only crop, a style donor,
 * etc., without needing different upstream images.
 *
 * The mode source-of-truth lives in two places:
 *
 *   1. **Character node default** — `CharacterNodeData.defaultUsageMode`.
 *      Set via the small dropdown in the character node's title row.
 *      Propagates into every `ConnectedReference` derived from that node.
 *
 *   2. **Per-mention override** — optional 4th segment in the slug,
 *      e.g. `@kira:1:smile:face` overrides the character's default for that
 *      specific mention. Parsed by `parseCharacterMentionToken` in
 *      `character-mention-slug.ts`.
 *
 * Mode resolution at prompt-build time (in `resolveCharacterMentions`):
 *   token.usageMode  ??  ref.defaultUsageMode  ??  "identical"
 */

export const USAGE_MODES = [
  "identical",
  "face",
  "face-pose",
  "pose",
  "emotion",
  "style",
] as const

export type UsageMode = (typeof USAGE_MODES)[number]

/** Default mode when neither the slug nor the character node specifies one. */
export const DEFAULT_USAGE_MODE: UsageMode = "identical"

/** Type guard — narrows an arbitrary string to `UsageMode` when valid. */
export function isUsageMode(s: string): s is UsageMode {
  return (USAGE_MODES as readonly string[]).includes(s)
}

/**
 * Return the natural-language directive appended to a per-image bullet for the
 * given mode. The text is intentionally explicit so the model knows exactly
 * which aspects of the reference to take and which to derive from the rest of
 * the prompt.
 *
 * Calling sites: `resolveCharacterMentions` (shared/prompt-builder.ts) and the
 * per-character canonical fallback (also in prompt-builder.ts), plus the video
 * mention resolvers on frontend (execute-node.ts) and backend (payload-builder.ts)
 * which mirror the same directive shape.
 */
export function usageModeDirective(mode: UsageMode): string {
  switch (mode) {
    case "identical":
      return "The subject must remain exactly the same person — preserve 100% facial identity, bone structure, skin tone, proportions, and all unique features. Do not alter eyes, nose, mouth, or facial shape. Maintain natural skin texture, including pores and imperfections."
    case "face":
      return "Take ONLY the facial features and expression — preserve 100% facial identity, bone structure, skin tone, and all unique features. Do not alter eyes, nose, mouth, or facial shape. Maintain natural skin texture, including pores and imperfections. Adopt clothing, hair styling, and posture from the rest of the prompt."
    case "face-pose":
      return "Take the facial features AND body pose — preserve 100% facial identity, bone structure, skin tone, and all unique features. Do not alter eyes, nose, mouth, or facial shape. Maintain natural skin texture. Adopt clothing and styling from the rest of the prompt."
    case "pose":
      return "Take only the body pose and posture — do not copy facial identity, features, or skin. Adopt face, clothing, hair, and all other details from the rest of the prompt."
    case "emotion":
      return "Take only the emotional expression — preserve 100% facial identity and all unique features unchanged. Adopt face shape, clothing, body, and pose from the rest of the prompt; transfer only the emotional cue."
    case "style":
      return "Take only the visual style and tone (lighting, color grade, atmosphere). Do not copy the subject's identity, clothing, or pose."
  }
}

/** Human-readable label for the dropdown / badge UI. */
export function usageModeLabel(mode: UsageMode): string {
  switch (mode) {
    case "identical": return "Identical"
    case "face": return "Face only"
    case "face-pose": return "Face + Pose"
    case "pose": return "Pose only"
    case "emotion": return "Emotion only"
    case "style": return "Style only"
  }
}
