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
  "4k highly detailed, plain background, no text, no labels, no watermarks"

export const ASSET_MOTION_SCAFFOLDING =
  "smooth motion, natural movement, no text, no labels, no watermarks"

const ASSET_FRAMING_BY_TYPE: Record<string, string> = {
  expressions: "portrait headshot",
  poses: "full body visible including feet",
  angles: "full body, same neutral standing pose",
  lighting: "full body, same neutral standing pose",
}

function nonEmpty(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null
  const trimmed = s.trim()
  return trimmed.length === 0 ? null : trimmed
}

export function buildPortraitPrompt(args: { seedPrompt: string }): string {
  const seed = args.seedPrompt.trim()
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
  ].filter((p): p is string => p !== null && p.length > 0)
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
  ].filter((p): p is string => p !== null && p.length > 0)
  return parts.join(". ") + "."
}
