/**
 * What a podcast use-case run (Tighten Episode, Clip Pack, Speaker Layout)
 * reports on its job's `output_data`: the wire shapes an app reads
 * (`client.jobs.getStatus(jobId).data.output_data`). The server writes them
 * (the use-case wrapper's output); the SDK re-exports them. Every field is
 * optional: a run that finished before a field shipped has none of it, and a
 * reader must treat an absent field as "not reported", never as zero.
 *
 * Times are integer milliseconds on the RECORDING's clock — the clock of the
 * run's sound, which its plan is written on and every recording is lined up
 * to: the recording itself for a run of one recording; with several
 * recordings, the Master audio, else the sound-only recording, else the wide
 * camera's own sound (else Camera 1's). Structural only, no I/O.
 */

/** A stretch of the recording, `[inMs, outMs)` in ms on the recording's clock. */
export interface UseCaseSourceSpan {
  readonly inMs: number
  readonly outMs: number
}

/** One delivered clip of a Clip Pack run (`output_data.clips[]`), in plan order. */
export interface ClipPackClip {
  readonly url: string
  readonly quality: "proxy" | "final"
  /** The plan clip it renders: `"<first inMs>-<last outMs>"` of that clip, the same two numbers as `sourceStartMs` and `sourceEndMs`. */
  readonly clipKey?: string
  readonly planBasis?: string
  readonly renderBasis?: string
  readonly title?: string
  readonly hook?: string
  /** The still of the file it delivers (none for an audio clip). */
  readonly thumbnailUrl?: string
  /** Its captions could not be added: the clip is its render, uncaptioned. */
  readonly captionsFailed?: true
  /** Where the clip starts in the recording: the earliest kept stretch's start. */
  readonly sourceStartMs?: number
  /** Where the clip ends in the recording: the latest kept stretch's end. */
  readonly sourceEndMs?: number
  /**
   * The stretches of the recording the clip is made of, sorted by `inMs`,
   * touching or overlapping stretches merged. Present only when there are two
   * or more (a clip cut from one stretch is `sourceStartMs`–`sourceEndMs`).
   */
  readonly sourceSpans?: readonly UseCaseSourceSpan[]
}

/**
 * A planned clip of a Clip Pack run that could not be rendered
 * (`output_data.failedClipList[]`), in plan order: the clips `failedClips`
 * counts, by name. Rendered again with Edit Plan's clip set (`json`) and its
 * `clipKey`.
 */
export interface ClipPackFailedClip {
  readonly clipKey: string
  readonly title?: string
  readonly hook?: string
  readonly sourceStartMs?: number
  readonly sourceEndMs?: number
  readonly sourceSpans?: readonly UseCaseSourceSpan[]
}

/** One speaker of a run (`output_data.speakers[]`), in the order they are first heard. */
export interface UseCaseSpeaker {
  /** The speaker's label in the transcript (e.g. `speaker_0`). */
  readonly label: string
  /** The name the request's `speakerNames` gave this label. Never guessed. */
  readonly name?: string
  /** How long they talk across the whole recording, in ms (see the node docs for how it is counted). */
  readonly talkMs: number
}

/** The part of a use-case run's `output_data` every podcast run may carry. */
export interface UseCaseOutputData {
  readonly videoUrl?: string
  readonly audioUrl?: string
  /** `"proxy"` for a review-on run's preview, else `"final"`. */
  readonly quality?: "proxy" | "final"
  /** The result's length in seconds, when the run knows it. */
  readonly durationSec?: number
}

/** A Clip Pack run's `output_data` (the fields typed here; others may be present). */
export interface ClipPackOutputData extends UseCaseOutputData {
  readonly clips?: readonly ClipPackClip[]
  /** How many planned clips could not be rendered. */
  readonly failedClips?: number
  /** Which planned clips could not be rendered, in plan order (a clip whose key is unknown is counted but not listed). */
  readonly failedClipList?: readonly ClipPackFailedClip[]
  /** How many delivered clips came without captions. */
  readonly failedCaptions?: number
}

/** A Tighten Episode run's `output_data` (the fields typed here; others may be present). */
export interface TightenEpisodeOutputData extends UseCaseOutputData {
  readonly speakers?: readonly UseCaseSpeaker[]
}

/** A Speaker Layout run's `output_data` (the fields typed here; others may be present). */
export interface SpeakerLayoutOutputData extends UseCaseOutputData {
  readonly speakers?: readonly UseCaseSpeaker[]
}
