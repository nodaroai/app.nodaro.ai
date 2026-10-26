/**
 * Nodaro Motion's quote and completion keys, as people read them: the
 * engine's vendor-named keys are renamed to neutral ones.
 * Cast Swap 0.394.0 answers the new keys BESIDE the old ones, 0.395.0 the new
 * ones only, 0.393.0 and older the old ones only — so every reader here takes
 * the new key first and falls back to the old, and every answer the platform
 * shapes itself (MCP, the trend routes) carries the new keys only.
 *
 *   breakdown.motion          was breakdown.seedance / breakdown.kling
 *   breakdown.motionExpected  was breakdown.seedanceExpected
 *   breakdown.motionHd        was breakdown.seedanceHd (Full Quality)
 *   breakdown.privacy         was breakdown.masking
 *   privacyCredits            was maskingCredits
 *   output privacy            was output faceMasking ({ applied, reason, stored? })
 */

type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** Each neutral breakdown key and the old keys it replaces, in the order they are read. */
export const NODARO_MOTION_BREAKDOWN_RENAMES: Readonly<Record<string, readonly string[]>> = {
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
