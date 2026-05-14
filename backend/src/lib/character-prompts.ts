/**
 * Studio prompt-assembly helpers. Centralizes "studio scaffolding" trailers
 * that push provider output toward studio-quality reference material, and
 * composes the two-channel prompts used by portrait + asset gen routes.
 *
 * See docs/superpowers/specs/2026-05-14-character-studio-identity-foundation.md
 ***REDACTED-OSS-SCRUB***
 */

export const PORTRAIT_SCAFFOLDING =
  "4k portrait, plain background, studio lighting, neutral expression unless described otherwise, no text, no labels, no watermarks"

export const ASSET_STILL_SCAFFOLDING =
  "The subject must remain exactly the same person — preserve facial identity, bone structure, eye color, hair color, skin tone, proportions, and unique features. Do not alter eyes, nose, mouth, or facial shape. Maintain natural skin texture. Ultra-detailed, 8K quality, cinematic framing, plain background, no text, no labels, no watermarks"

export const ASSET_MOTION_SCAFFOLDING =
  "The subject must remain exactly the same person — preserve facial identity, bone structure, eye color, hair color, skin tone, and proportions. Smooth motion, natural movement, no text, no labels, no watermarks"

// Framing fragments per asset type. "custom" is intentionally absent — when
// users supply their own free-form prompt, framing is their responsibility,
// so we don't impose one. Unknown assetTypes fall through to no framing.
//
// `angles` is now treated as head angles (the column was split — see migration
// 118). `headAngles` is the explicit alias; both produce head-and-shoulders
// framing. `bodyAngles` writes to the new `body_angles` column and produces
// full-body T-pose framing. This is a small behavior change for existing
// characters' future angle gens — they were semantically head angles all along,
// so the new framing matches the column's new meaning.
const ASSET_FRAMING_BY_TYPE: Record<string, string> = {
  expressions: "portrait headshot",
  poses: "full body visible including feet",
  angles: "head-and-shoulders portrait, same neutral expression",
  headAngles: "head-and-shoulders portrait, same neutral expression",
  bodyAngles: "full body T-pose, neutral standing posture, plain background",
  lighting: "full body, same neutral standing pose",
}

function nonEmpty(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null
  const trimmed = s.trim()
  return trimmed.length === 0 ? null : trimmed
}

function stripTrailingPeriod(s: string): string {
  return s.replace(/\.+$/, "")
}

export function buildPortraitPrompt(args: { seedPrompt: string }): string {
  const seed = stripTrailingPeriod(args.seedPrompt.trim())
  return `${seed}. ${PORTRAIT_SCAFFOLDING}.`
}

export function buildAssetPromptText(args: {
  canonicalDescription: string | null | undefined
  assetDescription: string
  variantOrPrompt: string
  assetType: string
}): string {
  const canonical = nonEmpty(args.canonicalDescription)
  const framing = ASSET_FRAMING_BY_TYPE[args.assetType] ?? ""
  const parts = [
    canonical,
    args.assetDescription.trim(),
    args.variantOrPrompt.trim(),
    framing,
    ASSET_STILL_SCAFFOLDING,
  ]
    .filter((p): p is string => p !== null && p.length > 0)
    .map(stripTrailingPeriod)
  return parts.join(". ") + "."
}

export function buildMotionPromptText(args: {
  canonicalDescription: string | null | undefined
  assetDescription: string
  motionDescription: string | null | undefined
  variantOrPrompt: string
}): string {
  const canonical = nonEmpty(args.canonicalDescription)
  const motion = nonEmpty(args.motionDescription)
  const parts = [
    canonical,
    args.assetDescription.trim(),
    motion,
    args.variantOrPrompt.trim(),
    ASSET_MOTION_SCAFFOLDING,
  ]
    .filter((p): p is string => p !== null && p.length > 0)
    .map(stripTrailingPeriod)
  return parts.join(". ") + "."
}
