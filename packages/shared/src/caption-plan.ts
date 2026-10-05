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
