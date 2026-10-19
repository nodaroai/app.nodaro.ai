/**
 * The sources a use-case run is built on, and their shape (how many
 * recordings, whether a Master audio is wired), from what is known of each
 * input. One function for the run's preparation (request.ts, everything
 * probed) and the route's keyless preflight (use-case-run.ts, nothing probed),
 * so both build the graph on the same sources. With one recording and no
 * master the sources carry exactly `media` and the optional inputs, as they
 * always did. Pure.
 */
import type { UseCaseMediaSource, UseCaseSources, UseCaseSourcesShape } from "@nodaro/render-rules"

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
