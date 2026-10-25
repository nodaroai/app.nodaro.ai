/**
 * Nodaro Motion quotes, as the CLI shows them. The engine's vendor-named keys
 * are being renamed to neutral ones: Cast Swap 0.394.0
 * answers both, 0.395.0 the new ones only, 0.393.0 and older the old ones
 * only. The CLI reads the new key first, falls back to the old one, and never
 * prints an old name — in its text or its `--json`:
 *
 *   motion          was seedance / kling
 *   motionExpected  was seedanceExpected
 *   motionHd        was seedanceHd
 *   privacy         was masking
 *   privacyCredits  was maskingCredits
 *
 * (The same renames as the platform's `backend/src/lib/nodaro-motion-quote.ts`.)
 */
const RENAMES: Readonly<Record<string, readonly string[]>> = {
  motion: ["seedance", "kling"],
  motionExpected: ["seedanceExpected"],
  motionHd: ["seedanceHd"],
  privacy: ["masking"],
}
const OLD_KEYS: ReadonlySet<string> = new Set(Object.values(RENAMES).flat())

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** A breakdown with the neutral key names only: new key first, else the old one; other parts as given. */
export function neutralParts(breakdown: unknown): Record<string, number> {
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return {}
  const b = breakdown as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(b)) if (!OLD_KEYS.has(key) && finite(value)) out[key] = value
  for (const [key, old] of Object.entries(RENAMES)) {
    if (key in out) continue
    const from = old.find((k) => finite(b[k]))
    if (from !== undefined) out[key] = b[from] as number
  }
  return out
}

/** A quote with its breakdown's neutral names and `privacyCredits` in place of the old `maskingCredits`. A new object. */
export function neutralQuote<T extends { breakdown?: unknown }>(quote: T): T {
  const { maskingCredits, privacyCredits, ...rest } = quote as T & { maskingCredits?: unknown; privacyCredits?: unknown }
  const privacy = finite(privacyCredits) ? privacyCredits : finite(maskingCredits) ? maskingCredits : undefined
  return {
    ...(rest as T),
    ...(quote.breakdown !== undefined ? { breakdown: neutralParts(quote.breakdown) } : {}),
    ...(privacy !== undefined ? { privacyCredits: privacy } : {}),
  }
}

const PART_LABELS: Readonly<Record<string, string>> = {
  castSwap: "Nodaro Motion",
  references: "reference pictures",
  motion: "video",
  motionExpected: "video, expected",
  motionHd: "1080p render",
  privacy: "clip preparation",
}

/** A breakdown part as people read it; a part not listed here is shown as its own name. */
export function quotePartLabel(part: string): string {
  return Object.hasOwn(PART_LABELS, part) ? PART_LABELS[part]! : part
}
