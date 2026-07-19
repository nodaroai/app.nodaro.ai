/**
 * Studio prompt-assembly helpers. Centralizes "studio scaffolding" trailers
 * that push provider output toward studio-quality reference material, and
 * composes the two-channel prompts used by portrait + asset gen routes.
 */

import { buildPersonHints, type PersonValue, buildWardrobeHints, type WardrobeValue } from "@nodaro/prompts"

/**
 * Clothing floor. A face-referenced full-body studio shot with no outfit specified
 * renders in underwear or nude (the model invents the unseen body), and the pose /
 * body-angle / lighting framings all demand a full body — so every portrait + still
 * asset carries a clothed default. "unless the outfit is otherwise described" keeps
 * intentional wardrobe (or swimwear, etc.) working: a described outfit / wardrobe
 * hint precedes this clause in the assembled prompt and takes precedence.
 */
export const CLOTHED_DEFAULT =
  "fully clothed in simple everyday attire unless the outfit is otherwise described"

/**
 * Reference-aware variant of the clothing floor, for generations that condition
 * on reference images (the asset route's multi-image identity set). The plain
 * CLOTHED_DEFAULT actively FIGHTS outfit continuity there: the model sees
 * "simple everyday attire" in the text and the established outfit in the refs,
 * and the text often wins — so every asset render re-invents clothes and the
 * identity sheet drifts. Lead with "same outfit as the reference images"; a
 * described outfit (wardrobe hints / baseOutfit, which precede this clause)
 * still overrides, and the everyday-attire floor remains the final fallback
 * for refs that show no outfit (head-only portraits).
 */
export const CLOTHED_MATCH_REFERENCES =
  "wearing the same outfit as shown in the reference images unless a different outfit is described; if no outfit is visible or described, fully clothed in simple everyday attire"

export const PORTRAIT_SCAFFOLDING =
  `4k portrait, plain background, studio lighting, neutral expression unless described otherwise, ${CLOTHED_DEFAULT}, no text, no labels, no watermarks`

export const ASSET_STILL_SCAFFOLDING =
  `The subject must remain exactly the same person — preserve facial identity, bone structure, eye color, hair color, skin tone, proportions, and unique features. Do not alter eyes, nose, mouth, or facial shape. Maintain natural skin texture. Ultra-detailed, 8K quality, cinematic framing, plain background, ${CLOTHED_DEFAULT}, no text, no labels, no watermarks`

export const ASSET_MOTION_SCAFFOLDING =
  "The subject must remain exactly the same person — preserve facial identity, bone structure, eye color, hair color, skin tone, and proportions. Smooth motion, natural movement, no text, no labels, no watermarks"

// Framing fragments per asset type. "custom" is intentionally absent — when
// users supply their own free-form prompt, framing is their responsibility,
// so we don't impose one. Unknown assetTypes fall through to no framing.
//
// `angles` is now treated as head angles (the column was split — see migration
// 118). `headAngles` is the explicit alias; both produce head-and-shoulders
// framing. `bodyAngles` writes to the new `body_angles` column and produces
// full-body natural standing framing. This is a small behavior change for existing
// characters' future angle gens — they were semantically head angles all along,
// so the new framing matches the column's new meaning.
const ASSET_FRAMING_BY_TYPE: Record<string, string> = {
  expressions: "portrait headshot",
  poses: "full body visible including feet",
  angles: "head-and-shoulders portrait, same neutral expression",
  headAngles: "head-and-shoulders portrait, same neutral expression",
  bodyAngles: "full body, standing in a relaxed natural pose, natural hand placement, plain background",
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

/**
 * Derive the combined Person + Wardrobe prompt-hint fragments. Empty/unknown
 * ids produce no hint. Shared by `buildPortraitPrompt` here and
 * `buildVariantPrompt` in the asset route so the two can't drift.
 */
export function buildEntityHints(person?: PersonValue, wardrobe?: WardrobeValue): string[] {
  return [
    ...(person ? buildPersonHints(person as Record<string, unknown> & PersonValue) : []),
    ...(wardrobe ? buildWardrobeHints(wardrobe as Record<string, unknown> & WardrobeValue) : []),
  ]
}

export function buildPortraitPrompt(args: {
  seedPrompt: string
  person?: PersonValue
  wardrobe?: WardrobeValue
  /** Composed text from nodes wired into the character's Assets handle
   *  (element/asset injection). Appended after seed+hints, before the studio
   *  scaffolding. Empty/absent → byte-identical to the pre-injection prompt. */
  injectedAssets?: string
}): string {
  const hints = buildEntityHints(args.person, args.wardrobe).join(", ")
  const injected = nonEmpty(args.injectedAssets)
  const seed = [
    stripTrailingPeriod(args.seedPrompt.trim()),
    hints,
    injected ? stripTrailingPeriod(injected) : null,
  ].filter(Boolean).join(", ")
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
