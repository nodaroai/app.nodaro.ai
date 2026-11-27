/**
 * Video Remake quotes, as the CLI shows them. The engine's vendor-named keys
 * are being renamed to neutral ones: Cast Swap 0.394.0
 * answers both, 0.395.0 the new ones only, 0.393.0 and older the old ones
 * only. The CLI reads the new key first, falls back to the old one, and never
 * prints an old name — in its text or its `--json`:
 *
 *   base            was castSwap (Cast Swap 0.396.0 answers both, 0.397.0 base only)
 *   motion          was seedance / kling
 *   motionExpected  was seedanceExpected
 *   motionHd        was seedanceHd
 *   privacy         was masking
 *   privacyCredits  was maskingCredits
 *
 * (The same renames as the platform's `backend/src/lib/nodaro-motion-quote.ts`.)
 *
 * The step that makes a size larger is never named: a server that still
 * answers it as its own part (`upscale`) has its credits folded into the
 * engine's line, the first of the 1080p render (`motionHd`), the video
 * (`motion`) or the job's own steps (`base`) present, so the total is unchanged
 * (the platform's `withStepFolded`).
 */
const RENAMES: Readonly<Record<string, readonly string[]>> = {
  base: ["castSwap"],
  motion: ["seedance", "kling"],
  motionExpected: ["seedanceExpected"],
  motionHd: ["seedanceHd"],
  privacy: ["masking"],
}
const OLD_KEYS: ReadonlySet<string> = new Set(Object.values(RENAMES).flat())

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** The parts a server's step line is folded into, in the order they are looked for. */
const STEP_LINE_TARGETS = ["motionHd", "motion", "base"] as const

/** The parts with a server's step line folded into the engine's (see above). A new object. */
function withStepFolded(parts: Record<string, number>): Record<string, number> {
  const step = parts.upscale
  const target = STEP_LINE_TARGETS.find((key) => finite(parts[key]))
  if (step === undefined || target === undefined) return parts
  const { upscale: _step, ...rest } = parts
  return { ...rest, [target]: rest[target]! + step }
}

/**
 * A breakdown with the neutral key names only: new key first, else the old one; other parts as given, and a
 * server's step line folded into the engine's.
 */
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
  return withStepFolded(out)
}

/**
 * Whether a Full Quality quote reuses an earlier try's 1080p render: the server's `renderReused` when it answers one
 * (its render line then carries the folded step), else an older server's render line of 0, read before any fold.
 */
export function renderReused(quote: { renderReused?: unknown; breakdown?: unknown }): boolean {
  if (typeof quote.renderReused === "boolean") return quote.renderReused
  const breakdown = quote.breakdown
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) return false
  const b = breakdown as Record<string, unknown>
  return (finite(b.motionHd) ? b.motionHd : b.seedanceHd) === 0
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
  base: "Video Remake",
  references: "reference pictures",
  motion: "video",
  motionExpected: "video, expected",
  motionHd: "1080p render",
  privacy: "clip preparation",
  // Folded into the engine's line above; named so only where there is no such line to fold it into.
  upscale: "video, finishing",
}

/** A breakdown part as people read it; a part not listed here is shown as its own name. */
export function quotePartLabel(part: string): string {
  return Object.hasOwn(PART_LABELS, part) ? PART_LABELS[part]! : part
}
