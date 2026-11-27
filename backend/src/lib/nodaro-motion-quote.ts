/**
 * Video Remake's quote and completion keys, as people read them: the
 * engine's vendor-named keys are renamed to neutral ones.
 * Cast Swap 0.394.0 answers the new keys BESIDE the old ones, 0.395.0 the new
 * ones only, 0.393.0 and older the old ones only — so every reader here takes
 * the new key first and falls back to the old, and every answer the platform
 * shapes itself (MCP, the trend routes) carries the new keys only.
 *
 *   breakdown.base            was breakdown.castSwap (the run's own base fee)
 *   breakdown.motion          was breakdown.seedance / breakdown.kling
 *   breakdown.motionExpected  was breakdown.seedanceExpected
 *   breakdown.motionHd        was breakdown.seedanceHd (Full Quality)
 *   breakdown.privacy         was breakdown.masking
 *   privacyCredits            was maskingCredits
 *   output privacy            was output faceMasking ({ applied, reason, stored? })
 *
 * `base` follows the same pattern one release later: Cast Swap 0.396.0
 * answers `base` beside `castSwap`, 0.397.0 `base` only.
 */

type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** Each neutral breakdown key and the old keys it replaces, in the order they are read. */
export const NODARO_MOTION_BREAKDOWN_RENAMES: Readonly<Record<string, readonly string[]>> = {
  base: ["castSwap"],
  motion: ["seedance", "kling"],
  motionExpected: ["seedanceExpected"],
  motionHd: ["seedanceHd"],
  privacy: ["masking"],
}

const OLD_KEYS: ReadonlySet<string> = new Set(Object.values(NODARO_MOTION_BREAKDOWN_RENAMES).flat())

/**
 * A quote's breakdown with neutral keys only: its own finite numeric parts,
 * each renamed part read from its new key, else the first old key that holds
 * a number. Any other part passes through as given. A new object.
 */
export function neutralBreakdown(breakdown: unknown): Record<string, number> {
  if (!isRec(breakdown)) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(breakdown)) {
    if (OLD_KEYS.has(key) || !finite(value)) continue
    out[key] = value
  }
  for (const [key, old] of Object.entries(NODARO_MOTION_BREAKDOWN_RENAMES)) {
    if (key in out) continue
    const from = old.find((k) => finite(breakdown[k]))
    if (from !== undefined) out[key] = breakdown[from] as number
  }
  return out
}

/**
 * The breakdown parts that fold a step's line into, in the order they are
 * looked for: the 1080p render (a Full Quality same take), the video (a new
 * take, a run), else the job's own steps.
 */
const STEP_LINE_TARGETS = ["motionHd", "motion", "base"] as const

/**
 * A neutral breakdown with the step that makes a size larger never named
 * (decided 2026-11-27): an engine that still answers it as its own part
 * (`upscale`) has its credits folded into the engine's line it belongs to, the
 * first of `STEP_LINE_TARGETS` present, so every total is unchanged. An engine
 * that answers no such part is answered as it is; with none of the targets
 * present the part is left as it is. A new object.
 */
export function withStepFolded(breakdown: Readonly<Record<string, number>>): Record<string, number> {
  const step = breakdown.upscale
  if (step === undefined) return { ...breakdown }
  const target = STEP_LINE_TARGETS.find((key) => finite(breakdown[key]))
  if (target === undefined) return { ...breakdown }
  const { upscale: _step, ...rest } = breakdown
  return { ...rest, [target]: (rest[target] as number) + step }
}

/** A quote's privacy credits (`privacyCredits`, else the old `maskingCredits`), when a finite number. */
export function privacyCreditsOf(quote: unknown): number | undefined {
  if (!isRec(quote)) return undefined
  if (finite(quote.privacyCredits)) return quote.privacyCredits
  return finite(quote.maskingCredits) ? quote.maskingCredits : undefined
}

/** A completed job output's privacy outcome (`privacy`, else the old `faceMasking`), when an object. */
export function privacyOutcomeOf(output: unknown): Rec | undefined {
  if (!isRec(output)) return undefined
  if (isRec(output.privacy)) return output.privacy
  return isRec(output.faceMasking) ? output.faceMasking : undefined
}
