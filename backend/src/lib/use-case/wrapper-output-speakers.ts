/**
 * A run's speakers (decided 2026-11-17): each speaker label of the run's
 * transcript, in the order they are first heard (the order the cameras report
 * lists them), with the name the request's `speakerNames` gave it and how long
 * they talk. Pure.
 *
 * - `name`: only what the request said, trimmed (`cleanSpeakerNames`). A name
 *   is never guessed from what is said; a name for a label nobody spoke is
 *   dropped.
 * - `talkMs`: the sum of the speaker's runs of talk across the whole
 *   recording. A run is consecutive words of one speaker (in time order) with
 *   no pause of `USE_CASE_TALK_GAP_MS` or longer between them and no other
 *   speaker's word in between; it lasts from its first word's start to its
 *   last word's end. Words with no speaker are no one's talk and break no run.
 *   Two speakers talking at once both count, so the totals can add up to more
 *   than the recording.
 */
import { cleanSpeakerNames, normalizeTranscript, transcriptSpeakerLabels, type Transcript, type UseCaseSpeaker } from "@nodaro/shared/edl"
import { isRecord } from "./wrapper-output-parts.js"
import { parsedJson } from "./wrapper-output-spans.js"

/** The transcript's words (a transcript object or its JSON text), or none when it is not a transcript. */
function transcriptWords(raw: unknown): Transcript["words"] {
  const value = parsedJson(raw)
  return isRecord(value) ? normalizeTranscript(value).words : []
}

/** A pause this long (ms) or longer ends a run of talk: the pause the run's own Silence Detect calls silence. */
export const USE_CASE_TALK_GAP_MS = 700

interface Run {
  readonly speaker: string
  readonly startMs: number
  readonly endMs: number
}

/**
 * Each speaker's runs of talk, as one total per label. One pass over the words
 * (a 3-hour episode is tens of thousands): the totals are a local map, never
 * the caller's data.
 */
function talkPerSpeaker(words: ReturnType<typeof transcriptWords>): ReadonlyMap<string, number> {
  const totals = new Map<string, number>()
  const close = (run: Run | undefined) => {
    if (run) totals.set(run.speaker, (totals.get(run.speaker) ?? 0) + Math.max(0, run.endMs - run.startMs))
  }
  let run: Run | undefined
  for (const w of words) {
    if (!w.speaker) continue
    if (run && run.speaker === w.speaker && w.startMs - run.endMs < USE_CASE_TALK_GAP_MS) {
      run = { ...run, endMs: Math.max(run.endMs, w.endMs) }
      continue
    }
    close(run)
    run = { speaker: w.speaker, startMs: w.startMs, endMs: w.endMs }
  }
  close(run)
  return totals
}

/**
 * The speakers' names a wrapper job keeps on its input (`input_data.speakerNames`,
 * written by the run route and carried by every continuation): cleaned, and
 * nothing at all when no name is left.
 */
export function usecaseKeptSpeakerNames(raw: unknown): { readonly speakerNames?: Readonly<Record<string, string>> } {
  const names = cleanSpeakerNames(raw)
  return Object.keys(names).length > 0 ? { speakerNames: names } : {}
}

/** A run's speakers, first heard first, with the names the request gave and their talk (see the module note); [] when the transcript names no speaker. */
export function usecaseSpeakers(transcript: unknown, speakerNames?: unknown): UseCaseSpeaker[] {
  const words = transcriptWords(transcript)
  const labels = transcriptSpeakerLabels({ words })
  if (labels.length === 0) return []
  const talk = talkPerSpeaker(words)
  const names = cleanSpeakerNames(speakerNames)
  return labels.map((label) => ({
    label,
    // The map's own keys only: a label that happens to be an Object property ("constructor") has no name.
    ...(Object.hasOwn(names, label) ? { name: names[label] } : {}),
    talkMs: talk.get(label) ?? 0,
  }))
}
