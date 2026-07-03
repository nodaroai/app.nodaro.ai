export type TextDirection = "rtl" | "ltr"

/** Hebrew + Hebrew presentation forms. */
const HEBREW_RANGES = "\\u0590-\\u05FF\\uFB1D-\\uFB4F"

/** Arabic (+ Supplement, Extended-A) and Arabic presentation forms A & B. */
const ARABIC_RANGES = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF"

/**
 * Strong right-to-left codepoints: Hebrew, Hebrew presentation forms, Arabic
 * (+ Supplement, Extended-A), and Arabic presentation forms A & B.
 */
const RTL_STRONG = new RegExp(`[${HEBREW_RANGES}${ARABIC_RANGES}]`)

/**
 * Base direction from the first *strong* directional character (Unicode bidi
 * rule P2/P3, simplified to the scripts we support). Neutrals — digits,
 * punctuation, whitespace, symbols — are skipped. Any non-RTL letter counts as
 * strong LTR. No strong char found → "ltr".
 */
export function detectBaseDirection(text: string): TextDirection {
  for (const ch of text) {
    if (RTL_STRONG.test(ch)) return "rtl"
    if (/\p{L}/u.test(ch)) return "ltr"
  }
  return "ltr"
}

/** Explicit override wins; otherwise auto-detect from content. */
export function resolveDirection(text: string, explicit?: TextDirection): TextDirection {
  return explicit ?? detectBaseDirection(text)
}

/** Arabic-script codepoints (the Arabic subranges of RTL_STRONG; Hebrew excluded).
 *  letter-spacing on Arabic breaks cursive joining, so callers suppress tracking. */
const ARABIC = new RegExp(`[${ARABIC_RANGES}]`)

export const containsArabic = (text: string): boolean => ARABIC.test(text)

/** Base direction for a row of caption words — detects from the joined line text
 *  so the flex row can be laid out RTL without reversing the words array
 *  (which would corrupt timing indices). */
export function rowDirectionFromCaptions(captions: readonly { text: string }[]): TextDirection {
  return detectBaseDirection(captions.map((c) => c.text).join(" "))
}

/**
 * CSS props a text node spreads onto its style. `direction` comes straight from
 * `resolveDirection` (deterministic — no `unicode-bidi: plaintext`, which would
 * override the explicit `dir`). `textAlign` is only returned when the caller
 * opts in (surfaces that shrink-wrap don't need it).
 */
export function directionStyle(
  text: string,
  opts?: { explicit?: TextDirection; align?: boolean },
): { direction: TextDirection; textAlign?: "left" | "right" } {
  const direction = resolveDirection(text, opts?.explicit)
  if (opts?.align) {
    return { direction, textAlign: direction === "rtl" ? "right" : "left" }
  }
  return { direction }
}
