/**
 * The price of a whole Voice Changer Pro convert, as ONE id.
 *
 * A convert is charged as one whole: every changed speaker's slot is priced in
 * base credits (a recast slot by the length of its stem, a Re-speak slot by
 * its characters on its engine's row), the slots are summed, and the sum is
 * marked up ONCE at `voice-changer-pro`. A client that prices each slot on the
 * served (already marked-up, already rounded) rows and adds them up cannot
 * reach that figure: the rounding happens in a different place.
 *
 * `voiceChangerProQuoteCreditId(slots)` names the whole price:
 * `voice-changer-pro:<slot>,<slot>,…`, one slot per changed speaker, where a
 * slot is
 *
 *   - `sts-<seconds>` — a recast (speech-to-speech) slot whose stem is that
 *     many seconds long (the speaker's last utterance end); `sts` alone when
 *     the length is unknown (priced as one minute, as the convert reserves it);
 *   - `respeak-<chars>` — a Re-speak slot on the default engine (v3) that
 *     re-speaks that many characters; `respeak` alone when the count is unknown;
 *   - `respeak-v4-<chars>` — a Re-speak slot on the v4 engine (`respeak-v4`
 *     when the count is unknown); `respeak-v3-<chars>` names v3 explicitly
 *     and is the same price as `respeak-<chars>`;
 *   - `respeak-v4t-<chars>` — a v4 slot speaking a TRANSLATION of its
 *     `<chars>` transcript characters. The convert reserves such a slot for more
 *     speech than its transcript holds (a line may be re-rendered once,
 *     shorter); the server applies that allowance, so the client sends the
 *     transcript's own count and never the arithmetic. Only v4 speaks a
 *     translation, so there is no `v3t`.
 *
 * `POST /v1/credits/model-costs` and `GET /v1/credits/model-cost` answer it
 * with the figure the convert reserves; an id the server does not price
 * (a malformed slot, more slots than a convert takes, a count out of range)
 * lands in `missing`. Numbers are written exactly as JavaScript prints them,
 * so the server reads back the value the client priced.
 */

/** The id a convert is reserved (and marked up) at. */
export const VOICE_CHANGER_PRO_QUOTE_RATE_ID = "voice-changer-pro"

/** A Re-speak engine, as the quote names it. */
export type VoiceChangerProQuoteRespeakEngine = "v3" | "v4"

/** One changed speaker of a convert, as the quote prices it. */
export type VoiceChangerProQuoteSlot =
  /** A recast slot: the stem's length in seconds; `null` (or not a positive number) = unknown. */
  | { readonly kind: "sts"; readonly seconds: number | null }
  /**
   * A Re-speak slot: the characters of its transcript; `null` (or not a
   * positive number) = unknown. `engine` absent = the default engine (v3).
   * `translated` = the slot speaks the plan's target language — read only on
   * v4, the one engine that speaks a translation (the convert route reads it
   * the same way).
   */
  | {
      readonly kind: "respeak"
      readonly chars: number | null
      readonly engine?: VoiceChangerProQuoteRespeakEngine
      readonly translated?: boolean
    }

/** A `voice-changer-pro:<slots>` id, read back into the convert's pricing inputs (slot order kept per kind). */
export interface VoiceChangerProQuoteCreditIdParts {
  /** Stem seconds per recast slot; `null` = unknown. */
  readonly stsSlotSeconds: ReadonlyArray<number | null>
  /** Transcript characters per Re-speak slot; `null` = unknown. */
  readonly respeakChars: ReadonlyArray<number | null>
  /** The engine of each Re-speak slot, index-aligned with `respeakChars`; `null` = not named (the default engine). */
  readonly respeakEngines: ReadonlyArray<VoiceChangerProQuoteRespeakEngine | null>
  /** Whether each Re-speak slot speaks a translation, index-aligned with `respeakChars` (only ever true on v4). */
  readonly respeakTranslated: ReadonlyArray<boolean>
}

const PREFIX = `${VOICE_CHANGER_PRO_QUOTE_RATE_ID}:`
const NUMBER = String.raw`\d{1,7}(?:\.\d{1,20})?`
const STS_SLOT = new RegExp(`^sts(?:-(${NUMBER}))?$`)
const RESPEAK_SLOT = new RegExp(`^respeak(?:-(v3|v4|v4t))?(?:-(${NUMBER}))?$`)

const known = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0

/** The engine token of a Re-speak slot: none for the default engine (the id every client sent before engines were named). */
function respeakEngineToken(slot: { readonly engine?: VoiceChangerProQuoteRespeakEngine; readonly translated?: boolean }): string {
  if (slot.engine !== "v4") return ""
  return slot.translated === true ? "-v4t" : "-v4"
}

/** `voice-changer-pro:<slot>,…` — the id of the whole price of a convert with these changed speakers. */
export function voiceChangerProQuoteCreditId(slots: ReadonlyArray<VoiceChangerProQuoteSlot>): string {
  return (
    PREFIX +
    slots
      .map((slot) => {
        if (slot.kind === "sts") return known(slot.seconds) ? `sts-${String(slot.seconds)}` : "sts"
        const head = `respeak${respeakEngineToken(slot)}`
        return known(slot.chars) ? `${head}-${String(slot.chars)}` : head
      })
      .join(",")
  )
}

function measureOf(text: string | undefined): number | null | undefined {
  if (text === undefined) return null
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : undefined
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
  const respeakEngines: Array<VoiceChangerProQuoteRespeakEngine | null> = []
  const respeakTranslated: boolean[] = []
  for (const part of body.split(",")) {
    const sts = STS_SLOT.exec(part)
    if (sts) {
      const seconds = measureOf(sts[1])
      if (seconds === undefined) return undefined
      stsSlotSeconds.push(seconds)
      continue
    }
    const respeak = RESPEAK_SLOT.exec(part)
    if (!respeak) return undefined
    const chars = measureOf(respeak[2])
    if (chars === undefined) return undefined
    const token = respeak[1]
    respeakChars.push(chars)
    respeakEngines.push(token === undefined ? null : token === "v3" ? "v3" : "v4")
    respeakTranslated.push(token === "v4t")
  }
  return { stsSlotSeconds, respeakChars, respeakEngines, respeakTranslated }
}
