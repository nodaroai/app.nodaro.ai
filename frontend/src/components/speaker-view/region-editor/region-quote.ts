/**
 * "Who is this?" for a box (U4, SV15): Speaker View renames no one — Camera
 * Switch owns names — so beside each speaker the editor quotes what the
 * transcript has them saying, under the transcriber's raw label with the
 * display name it was given ("speaker_0 (Host)"). Pure.
 */
import { normalizeTranscript } from "@nodaro/shared"

const QUOTE_WORDS = 10

/** The raw label Camera Switch renamed to `speaker`, if any. */
export function rawLabelOf(speaker: string, names: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (!names) return undefined
  return Object.keys(names).find((raw) => raw !== speaker && names[raw] === speaker)
}

/**
 * The first words `speaker` says from `fromMs` (master clock) on, until
 * someone else talks — at most ten, with "…" when the turn runs on. Words are matched by
 * their label or by the name Camera Switch gave it. Undefined when the
 * transcript carries no such words.
 */
export function speakerQuote(
  transcript: unknown,
  speaker: string,
  fromMs: number,
  names?: Readonly<Record<string, unknown>>,
  offsetOf?: (sourceId: string | undefined) => number,
): string | undefined {
  if (transcript === undefined || transcript === null || transcript === "") return undefined
  let parsed: unknown = transcript
  if (typeof transcript === "string") {
    try { parsed = JSON.parse(transcript) } catch { return undefined }
  }
  const t = normalizeTranscript(parsed)
  const offset = offsetOf?.(t.sourceId) ?? 0
  const isTheirs = (label: string | undefined) => label !== undefined && (label === speaker || names?.[label] === speaker)
  const start = t.words.findIndex((w) => w.startMs + offset >= fromMs && isTheirs(w.speaker))
  if (start < 0) return undefined
  const words: string[] = []
  let cut = false
  for (let i = start; i < t.words.length; i++) {
    const w = t.words[i]!
    if (!isTheirs(w.speaker)) break
    if (words.length === QUOTE_WORDS) {
      cut = true
      break
    }
    words.push(w.text.trim())
  }
  const text = words.filter(Boolean).join(" ")
  if (!text) return undefined
  return cut ? `${text}…` : text
}
