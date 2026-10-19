/**
 * Whom a clip pack's automatic boxes are dealt over (decided 2026-10-14, the
 * talk-time floor decided 2026-10-18): the speakers of the WHOLE episode's
 * transcript, first heard first — but only those who really talk. A stray
 * label (a diarizer's one-word `speaker_2`, a cough given a speaker) would
 * otherwise take a third of the frame on every clip. A speaker counts when
 * their talk time is at least `AUTO_REGIONS_PACK_MIN_TALK_MS`, OR at least
 * `AUTO_REGIONS_PACK_MIN_TALK_SHARE` of the episode's total talk time — so a
 * guest with five minutes in a three-hour episode still gets a box.
 *
 * Talk time is the summed length of a speaker's words (`normalizeTranscript`,
 * the reading `transcriptSpeakerLabels` uses, so a broken word counts for no
 * one); the total is every labelled word's. One edit is not filtered: its
 * boxes go to whoever is on screen in it.
 */
import { normalizeTranscript } from "@nodaro/shared/edl"

/** A speaker who talks at least this long (ms) in the episode counts. */
export const AUTO_REGIONS_PACK_MIN_TALK_MS = 10_000

/** …or at least this share of the episode's total talk time. */
export const AUTO_REGIONS_PACK_MIN_TALK_SHARE = 0.05

const parse = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try { return JSON.parse(raw) } catch { return undefined }
}

/** The speakers a pack's boxes are dealt over, first heard first. Empty with no transcript. */
export function speakerViewPackSpeakers(transcript: unknown): string[] {
  const parsed = parse(transcript)
  if (!parsed || typeof parsed !== "object") return []
  const talk = new Map<string, number>()
  let total = 0
  for (const w of normalizeTranscript(parsed).words) {
    if (!w.speaker) continue
    const ms = Math.max(0, w.endMs - w.startMs)
    talk.set(w.speaker, (talk.get(w.speaker) ?? 0) + ms)
    total += ms
  }
  // Map keeps first-insertion order: the words are in time order, so first heard first.
  // A share is of talk that exists: with no talk at all (every word zero-length) no one has one.
  return [...talk]
    .filter(([, ms]) => ms >= AUTO_REGIONS_PACK_MIN_TALK_MS || (total > 0 && ms >= AUTO_REGIONS_PACK_MIN_TALK_SHARE * total))
    .map(([s]) => s)
}
