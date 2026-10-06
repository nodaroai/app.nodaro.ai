export interface CaptionWordTiming {
  readonly text: string
  readonly startMs: number
  readonly endMs: number
}

/**
 * A caption plan: the opening line, where it ends, and the timed words that
 * follow it. Times and words only — no styling travels on a plan; whoever
 * renders it applies the look. Times are milliseconds from the video's start.
 */
/** The opening line and the body's words, timed. No styling. */
export interface CaptionPlan {
  readonly v: 1
  /** The opening line as written; sent as is, never trimmed. */
  readonly hookText: string
  /** Where the opening line ends; the body starts here. */
  readonly hookEndMs: number
  /** Where the body captions end, any tail included (the producer decides it). */
  readonly bodyEndMs: number
  /** The body's words, in milliseconds. */
  readonly captions: readonly CaptionWordTiming[]
  /** When known, the opening line and the body are clamped to it. */
  readonly videoDurationMs?: number
  /** Primary language tag: "en", "he", … */
  readonly language?: string
}

const nonNegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0

/**
 * A wired caption plan (object or JSON string) → the plan, or the first problem
 * named as "Caption plan: <issue>." Only the CaptionPlan fields are kept.
 */
export function parseCaptionPlan(raw: unknown): { plan: CaptionPlan } | { error: string } {
  let value: unknown = raw
  if (typeof raw === "string") {
    try { value = JSON.parse(raw) } catch { return { error: "Caption plan: not valid JSON." } }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Caption plan: not an object." }
  const o = value as Record<string, unknown>
  if (o.v !== 1) return { error: "Caption plan: v must be 1." }
  if (typeof o.hookText !== "string") return { error: "Caption plan: hookText must be text." }
  for (const f of ["hookEndMs", "bodyEndMs"] as const) {
    if (!nonNegative(o[f])) return { error: `Caption plan: ${f} must be a non-negative number.` }
  }
  if (o.videoDurationMs !== undefined && !nonNegative(o.videoDurationMs)) {
    return { error: "Caption plan: videoDurationMs must be a non-negative number." }
  }
  if (o.language !== undefined && typeof o.language !== "string") return { error: "Caption plan: language must be text." }
  if (!Array.isArray(o.captions)) return { error: "Caption plan: captions must be a list." }
  const captions: CaptionWordTiming[] = []
  for (let i = 0; i < o.captions.length; i++) {
    const c = o.captions[i] as Record<string, unknown> | null
    if (!c || typeof c !== "object" || typeof c.text !== "string" || !nonNegative(c.startMs) || !nonNegative(c.endMs)) {
      return { error: `Caption plan: captions[${i}] needs text, startMs and endMs.` }
    }
    if (c.endMs < c.startMs) return { error: `Caption plan: captions[${i}] ends before it starts.` }
    captions.push({ text: c.text, startMs: c.startMs, endMs: c.endMs })
  }
  return {
    plan: {
      v: 1,
      hookText: o.hookText,
      hookEndMs: o.hookEndMs as number,
      bodyEndMs: o.bodyEndMs as number,
      captions,
      ...(o.videoDurationMs !== undefined ? { videoDurationMs: o.videoDurationMs as number } : {}),
      ...(o.language !== undefined ? { language: o.language as string } : {}),
    },
  }
}
