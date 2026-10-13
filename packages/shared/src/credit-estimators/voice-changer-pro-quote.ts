/**
 * The price of a whole Voice Changer Pro convert, as ONE id.
 *
 * A convert is charged as one whole: every changed speaker's slot is priced in
 * base credits (a recast slot by the length of its stem, a Re-speak slot by
 * its characters), the slots are summed, and the sum is marked up ONCE at
 * `voice-changer-pro`. A client that prices each slot on the served (already
 * marked-up, already rounded) rows and adds them up cannot reach that figure:
 * the rounding happens in a different place.
 *
 * `voiceChangerProQuoteCreditId(slots)` names the whole price:
 * `voice-changer-pro:<slot>,<slot>,…`, one slot per changed speaker, where a
 * slot is
 *
 *   - `sts-<seconds>` — a recast (speech-to-speech) slot whose stem is that
 *     many seconds long (the speaker's last utterance end); `sts` alone when
 *     the length is unknown (priced as one minute, as the convert reserves it);
 *   - `respeak-<chars>` — a Re-speak slot that re-speaks that many characters;
 *     `respeak` alone when the count is unknown.
 *
 * `POST /v1/credits/model-costs` and `GET /v1/credits/model-cost` answer it
 * with the figure the convert reserves; an id the server does not price
 * (a malformed slot, more slots than a convert takes, a count out of range)
 * lands in `missing`. Numbers are written exactly as JavaScript prints them,
 * so the server reads back the value the client priced.
 */

/** The id a convert is reserved (and marked up) at. */
export const VOICE_CHANGER_PRO_QUOTE_RATE_ID = "voice-changer-pro"

/** One changed speaker of a convert, as the quote prices it. */
export type VoiceChangerProQuoteSlot =
  /** A recast slot: the stem's length in seconds; `null` (or not a positive number) = unknown. */
  | { readonly kind: "sts"; readonly seconds: number | null }
  /** A Re-speak slot: the characters it re-speaks; `null` (or not a positive number) = unknown. */
  | { readonly kind: "respeak"; readonly chars: number | null }

/** A `voice-changer-pro:<slots>` id, read back into the convert's pricing inputs (slot order kept per kind). */
export interface VoiceChangerProQuoteCreditIdParts {
  /** Stem seconds per recast slot; `null` = unknown. */
  readonly stsSlotSeconds: ReadonlyArray<number | null>
  /** Characters per Re-speak slot; `null` = unknown. */
  readonly respeakChars: ReadonlyArray<number | null>
}

const PREFIX = `${VOICE_CHANGER_PRO_QUOTE_RATE_ID}:`
const SLOT = /^(sts|respeak)(?:-(\d{1,7}(?:\.\d{1,20})?))?$/

const known = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0

/** `voice-changer-pro:<slot>,…` — the id of the whole price of a convert with these changed speakers. */
export function voiceChangerProQuoteCreditId(slots: ReadonlyArray<VoiceChangerProQuoteSlot>): string {
  return (
    PREFIX +
    slots
      .map((slot) => {
        const n = slot.kind === "sts" ? slot.seconds : slot.chars
        return known(n) ? `${slot.kind}-${String(n)}` : slot.kind
      })
      .join(",")
  )
}

/**
 * The parts of a `voice-changer-pro:<slots>` id by its shape alone, or
 * undefined (not such an id, an empty or malformed slot). How many slots and
 * what counts the server prices is the server's to say: an id it does not
 * price lands in `missing`.
 */
export function parseVoiceChangerProQuoteCreditId(id: string): VoiceChangerProQuoteCreditIdParts | undefined {
  if (typeof id !== "string" || !id.startsWith(PREFIX)) return undefined
  const body = id.slice(PREFIX.length)
  if (body.length === 0) return undefined
  const stsSlotSeconds: Array<number | null> = []
  const respeakChars: Array<number | null> = []
  for (const part of body.split(",")) {
    const m = SLOT.exec(part)
    if (!m) return undefined
    let value: number | null = null
    if (m[2] !== undefined) {
      value = Number(m[2])
      if (!Number.isFinite(value) || value <= 0) return undefined
    }
    if (m[1] === "sts") stsSlotSeconds.push(value)
    else respeakChars.push(value)
  }
  return { stsSlotSeconds, respeakChars }
}
