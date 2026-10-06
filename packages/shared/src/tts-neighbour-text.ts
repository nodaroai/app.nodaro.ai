/**
 * The neighbour-text rule of Text to Speech — what is spoken just BEFORE and just AFTER a clip in the finished
 * piece — in ONE place, so the editor's run, the provider exits and the REST route cannot drift: a request that
 * the editor sends must be one the route accepts.
 *
 * A string is trimmed; an empty one, or anything that is not a string, is ABSENT. Over the cap the value is
 * TRIMMED, never rejected, by every sender and exit: previous text keeps its LAST characters (what leads into
 * the clip), next text its FIRST (what the clip leads into). The REST route is the one place that rejects an
 * over-cap value — measured on the trimmed text, for a model that stitches only. Whether a model takes the
 * fields at all is its sheet (`ttsSupportsStitching`), never decided here.
 */

/**
 * The most characters of context sent on each side. ElevenLabs documents no limit for the text-to-speech
 * endpoint's fields; this bounds what we send (and what the vendor may count) to about two sentences' worth of
 * run-in and run-out — enough to carry intonation across a cut.
 */
export const TTS_NEIGHBOUR_TEXT_MAX_CHARS = 1000

/** The normalised pair: only non-empty strings within the cap; a side that was unusable is not a key. */
export interface TtsNeighbourText {
  previousText?: string
  nextText?: string
}

function usableText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/** `previousText` / `nextText` of `options`, normalised. Other keys are not carried over; the input is never mutated. */
export function normalizeTtsNeighbourText(
  options: Readonly<{ previousText?: unknown; nextText?: unknown }> | undefined,
): TtsNeighbourText {
  const out: TtsNeighbourText = {}
  const previous = usableText(options?.previousText)
  if (previous !== undefined) {
    out.previousText = previous.length > TTS_NEIGHBOUR_TEXT_MAX_CHARS ? previous.slice(-TTS_NEIGHBOUR_TEXT_MAX_CHARS) : previous
  }
  const next = usableText(options?.nextText)
  if (next !== undefined) {
    out.nextText = next.length > TTS_NEIGHBOUR_TEXT_MAX_CHARS ? next.slice(0, TTS_NEIGHBOUR_TEXT_MAX_CHARS) : next
  }
  return out
}
