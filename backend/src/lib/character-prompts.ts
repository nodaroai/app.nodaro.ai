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

/**
 * The minor-age clothing floor (W1-a). Unlike the two clauses above it is NOT
 * self-disabling: it carries no "unless otherwise described" escape, because
 * yielding to a preceding outfit description is exactly the risk the floor
 * exists to close for a minor subject.
 *
 * It lives HERE, next to the two clauses it replaces, for one structural
 * reason: BOTH layers need it — assembly (the scaffolding functions below,
 * which pick the clothing clause from the subject's age) and the Layer-2
 * `minor-age-floor` policy (which appends it to free text). The policy already
 * imports the two self-disabling floors from this module, so defining the
 * clause here keeps ONE import direction (policy → character-prompts) and no
 * cycle; `prompt-policies/index.ts` re-exports it from `minor-age-floor.ts`, so
 * every existing import site is unchanged. Still backend-owned deployment
 * content, never a package — the content-free guard on `@nodaro/prompts` holds.
 */
export const MODEST_ATTIRE_CLAUSE = "fully clothed in modest, age-appropriate everyday attire"

/**
 * Portrait scaffolding as a function of the SUBJECT'S AGE (W1-a). For a minor
 * the self-disabling `CLOTHED_DEFAULT` is not merely insufficient, it is the
 * hazard: it hands control of the clothing back to any outfit text that
 * precedes it. A minor gets the non-negotiable modest clause instead.
 *
 * The adult branch is the pre-W1-a string verbatim — `PORTRAIT_SCAFFOLDING`
 * below IS `portraitScaffolding(false)`, so every adult prompt is
 * byte-identical to what it was before the age became a parameter.
 */
export function portraitScaffolding(subjectMinor: boolean): string {
  const clothing = subjectMinor ? MODEST_ATTIRE_CLAUSE : CLOTHED_DEFAULT
  return `4k portrait, plain background, studio lighting, neutral expression unless described otherwise, ${clothing}, no text, no labels, no watermarks`
}

/** The ADULT portrait scaffolding — kept as a named export for the call sites
 *  and tests that pin the adult string. */
export const PORTRAIT_SCAFFOLDING = portraitScaffolding(false)

/** Asset-still scaffolding as a function of the subject's age — see
 *  `portraitScaffolding` for why a minor gets a different clothing clause. */
export function assetStillScaffolding(subjectMinor: boolean): string {
  const clothing = subjectMinor ? MODEST_ATTIRE_CLAUSE : CLOTHED_DEFAULT
  return `The subject must remain exactly the same person — preserve facial identity, bone structure, eye color, hair color, skin tone, proportions, and unique features. Do not alter eyes, nose, mouth, or facial shape. Maintain natural skin texture. Ultra-detailed, 8K quality, cinematic framing, plain background, ${clothing}, no text, no labels, no watermarks`
}

/** The ADULT asset-still scaffolding. */
export const ASSET_STILL_SCAFFOLDING = assetStillScaffolding(false)

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
  bodyAngles: "full body, a freely chosen natural pose that suits the character — crossed arms, hands on hips, hand in pocket, thinking pose, or similar — plain background",
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
  /** W1-a: the subject is a minor — decided ONCE by the caller from the same
   *  person value the hints are derived from (`isMinorAge`, @nodaro/prompts).
   *  Absent/false → byte-identical to the pre-W1-a prompt. */
  subjectMinor?: boolean
}): string {
  const hints = buildEntityHints(args.person, args.wardrobe).join(", ")
  const injected = nonEmpty(args.injectedAssets)
  const seed = [
    stripTrailingPeriod(args.seedPrompt.trim()),
    hints,
    injected ? stripTrailingPeriod(injected) : null,
  ].filter(Boolean).join(", ")
  return `${seed}. ${portraitScaffolding(args.subjectMinor === true)}.`
}

export function buildAssetPromptText(args: {
  canonicalDescription: string | null | undefined
  assetDescription: string
  variantOrPrompt: string
  assetType: string
  /** W1-a: see `buildPortraitPrompt`. Absent/false → byte-identical output. */
  subjectMinor?: boolean
}): string {
  const canonical = nonEmpty(args.canonicalDescription)
  const framing = ASSET_FRAMING_BY_TYPE[args.assetType] ?? ""
  const parts = [
    canonical,
    args.assetDescription.trim(),
    args.variantOrPrompt.trim(),
    framing,
    assetStillScaffolding(args.subjectMinor === true),
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
