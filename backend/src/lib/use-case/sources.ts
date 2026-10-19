/**
 * The sources a use-case run is built on, and their shape (how many
 * recordings, whether a Master audio is wired), from what is known of each
 * input. One function for the run's preparation (request.ts, everything
 * probed) and the route's keyless preflight (use-case-run.ts, nothing probed),
 * so both build the graph on the same sources. With one recording and no
 * master the sources carry exactly `media` and the optional inputs, as they
 * always did. Pure.
 */
import { usecaseRecordingsKind, type UseCaseMediaKind, type UseCaseMediaSource, type UseCaseSources, type UseCaseSourcesShape } from "@nodaro/render-rules"

export interface UseCaseSourceFacts {
  /** Every recording, in the order the run reads them; at least one. */
  readonly recordings: readonly [UseCaseMediaSource, ...UseCaseMediaSource[]]
  readonly masterAudio?: UseCaseMediaSource
  readonly musicUrl?: string
  readonly introCard?: { readonly url: string; readonly durationSec?: number }
}

export function usecaseSourcesOf(facts: UseCaseSourceFacts): { readonly sources: UseCaseSources; readonly shape: UseCaseSourcesShape } {
  const [media, ...moreMedia] = facts.recordings
  const sources: UseCaseSources = {
    media,
    ...(moreMedia.length > 0 ? { moreMedia } : {}),
    ...(facts.masterAudio ? { masterAudio: facts.masterAudio } : {}),
    ...(facts.musicUrl ? { music: { url: facts.musicUrl } } : {}),
    ...(facts.introCard ? { introCard: facts.introCard } : {}),
  }
  return { sources, shape: { recordings: facts.recordings.length, masterAudio: !!facts.masterAudio } }
}

/**
 * The length of the run's clock: the Master audio's when one is wired (the
 * plan's clock, decided 2026-10-17), else the first recording's — what the
 * estimate answers and the wrapper records as the run's length.
 */
export function usecaseClockSec(sources: UseCaseSources): number | undefined {
  return sources.masterAudio ? sources.masterAudio.durationSec : sources.media.durationSec
}

/**
 * What a wrapper job's `input_data` records of a run on several recordings or
 * a Master audio, beside the first recording's `mediaUrl` every row keeps
 * (decided 2026-10-18): every recording in order, the master, and the run's
 * kind (its recordings' — the kind its settings were resolved for). A
 * continue-from-failed resumes the attempt only when all of them are the
 * node's now. One recording without a master records nothing more, as before.
 */
export function usecaseWrapperRecordings(sources: UseCaseSources): {
  readonly mediaUrls?: readonly string[]
  readonly masterAudioUrl?: string
  readonly mediaKind?: UseCaseMediaKind
} {
  const recordings = [sources.media, ...(sources.moreMedia ?? [])]
  if (recordings.length === 1 && !sources.masterAudio) return {}
  return {
    mediaUrls: recordings.map((r) => r.url),
    ...(sources.masterAudio ? { masterAudioUrl: sources.masterAudio.url } : {}),
    mediaKind: usecaseRecordingsKind(recordings.map((r) => r.kind)) ?? sources.media.kind,
  }
}
