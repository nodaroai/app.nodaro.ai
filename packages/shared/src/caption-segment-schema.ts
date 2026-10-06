import { z } from "zod"
import {
  ALL_CAPTION_STYLES,
  CAPTION_LOOK_IDS,
  CAPTION_MAX_WORDS_PER_LINE_MAX,
  CAPTION_MAX_WORDS_PER_LINE_MIN,
} from "./caption-styles.js"
import { SUPPORTED_FONT_NAMES } from "./supported-fonts.js"

/**
 * The add-captions SEGMENT contract — one definition for the route's Zod, the
 * provider's overlap check and both workflow engines' pre-reservation check of a
 * caption plan's segments (a DAG payload never passes the route's validation).
 * Moved here from backend/src/routes/add-captions.ts so the copies can never differ.
 */

/** Caption font weight: 100..900 on the 100 grid. */
export const captionFontWeightSchema = z.number().int().min(100).max(900).multipleOf(100)

/** A text caption source must carry a visible glyph (whitespace synthesises to zero words). */
export const nonBlankCaptionText = z.string().min(1).refine((t) => /\S/.test(t), { message: "text must contain a non-whitespace character" })

/** One word-timed caption entry. */
export const captionInputSchema = z.object({
  text: z.string(),
  // startMs/endMs are the visibility window and drive the highlight; timestampMs
  // is the word timestamp used by tiktok-words token timing; confidence is
  // metadata, ignored by rendering. timestampMs/confidence default to null.
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  timestampMs: z.number().min(0).nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null),
})

/**
 * One caption SEGMENT: a time range, optional levers (each inherits the top-level
 * value when omitted) and optional own words (`text` or `captions[]`; falls back
 * to the shared transcript filtered to the range). A segmented render is entirely
 * Remotion, so any `style` (incl. subtitle) and any look lever is valid on a segment.
 */
export const captionSegmentInputSchema = z.object({
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  style: z.enum(ALL_CAPTION_STYLES).optional(),
  position: z.enum(["bottom", "top", "center"]).optional(),
  fontSize: z.number().min(12).max(200).optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  // A named look preset (outline/clean); explicit levers below override it.
  look: z.enum(CAPTION_LOOK_IDS).optional(),
  fontFamily: z.enum(SUPPORTED_FONT_NAMES).optional(),
  fontWeight: captionFontWeightSchema.optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().min(0).max(40).optional(),
  highlightColor: z.string().optional(),
  uppercase: z.boolean().optional(),
  positionY: z.number().min(0).max(100).optional(),
  animate: z.boolean().optional(),
  maxWordsPerLine: z.number().int().min(CAPTION_MAX_WORDS_PER_LINE_MIN).max(CAPTION_MAX_WORDS_PER_LINE_MAX).optional(),
  text: nonBlankCaptionText.optional(),
  captions: z.array(captionInputSchema).optional(),
}).refine((s) => s.endMs > s.startMs, { message: "segment endMs must be greater than startMs" })

export type CaptionSegmentInput = z.infer<typeof captionSegmentInputSchema>

/** Every field a segment may carry, in schema order. */
export const CAPTION_SEGMENT_SCHEMA_KEYS: readonly string[] = Object.keys(captionSegmentInputSchema.shape)

/**
 * Segments must be sorted and non-overlapping. Returns the first offending pair
 * as the route's 400 text; null when none overlap (abutting is fine).
 * `startMs < endMs` per segment is enforced by the schema; this is the cross-segment rule.
 */
export function findSegmentOverlap(segments: readonly { startMs: number; endMs: number }[]): string | null {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.startMs < sorted[i - 1]!.endMs) {
      return `segments overlap: [${sorted[i - 1]!.startMs}, ${sorted[i - 1]!.endMs}) and [${sorted[i]!.startMs}, ${sorted[i]!.endMs})`
    }
  }
  return null
}
