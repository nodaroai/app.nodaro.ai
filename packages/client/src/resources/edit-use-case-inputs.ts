/**
 * The inputs of the podcast use-case runs on the `edit` resource (Tighten
 * Episode, Chapters, Trailer, Clip Pack) and the request body each one sends.
 * Split from `edit.ts`, which holds the methods, the type list and the
 * continue routes; every name here is re-exported from there.
 */
import type { EditPlanTier, EdlTargetAspect, SpeakerEmphasisStyle, SpeakerSwitchId } from "@nodaro/shared/edl"
import type { CaptionStyle } from "@nodaro/shared/captions"

/**
 * Input for {@link EditResource.tightenEpisode} and
 * {@link EditResource.estimateTightenEpisode}: one recording in, the tightened
 * episode out. Only `mediaUrl` is required; every other field left out takes
 * the node's default.
 */
export interface TightenEpisodeInput {
  /** The recording — a video or audio URL, up to 3 hours. */
  mediaUrl: string
  /** Optional music bed, ducked under the voice and ending with the episode. */
  musicUrl?: string
  /** `"video"` or `"audio"`; an audio recording always makes an audio episode. */
  output?: "video" | "audio"
  /**
   * Frame a video episode with Speaker View: an output aspect and a layout,
   * over automatic boxes on the speakers on screen. A layout the aspect does
   * not draw is snapped to one it does. `null` or absent: no framing.
   */
  framing?: {
    aspect: EdlTargetAspect
    layout: "auto" | "single" | "side-by-side" | "stacked" | "grid" | "pip"
  } | null
  /** Captions on a video episode (on by default). */
  captions?: boolean
  /** The captions' look. */
  captionStyle?: CaptionStyle
  /**
   * Stop at a quick preview for a person to review; render the full-quality
   * episode afterwards with {@link EditResource.continueUseCase}
   * (`mode: "render-final"`).
   */
  reviewBeforeRender?: boolean
  /** The planner's tier. */
  planTier?: EditPlanTier
  /** Editing instructions for the planner (up to 4 000 characters). */
  instructions?: string
  /** A style guide for the planner (up to 4 000 characters). */
  styleGuide?: string
  /** How far the music dips under the voice, 0–100 (default 75). */
  musicDuckAmount?: number
}

/**
 * Input for {@link EditResource.episodeChapters} and
 * {@link EditResource.estimateEpisodeChapters}: one recording in, its chapters
 * out. Only `mediaUrl` is required; every other field left out takes the
 * node's default.
 */
export interface EpisodeChaptersInput {
  /** The recording — a video or audio URL, up to 3 hours. */
  mediaUrl: string
  /** The planner's tier (default `"economy"`). */
  planTier?: EditPlanTier
  /** Instructions for the chapters, e.g. "5 to 8 chapters" (up to 4 000 characters). */
  instructions?: string
  /** A style guide for the chapter titles (up to 4 000 characters). */
  styleGuide?: string
}

/** The formats a Trailer is delivered in, in delivery order (16:9 is a 1920×1080 landscape). */
export const TRAILER_FORMATS = ["9:16", "1:1", "4:5", "16:9"] as const
/** One Trailer format (see {@link TRAILER_FORMATS}). */
export type TrailerFormat = (typeof TRAILER_FORMATS)[number]

/**
 * Input for {@link EditResource.episodeTrailer} and
 * {@link EditResource.estimateEpisodeTrailer}: one video recording in, a
 * 20–40 s trailer out in each chosen format. Only `mediaUrl` is required.
 */
export interface EpisodeTrailerInput {
  /** The recording — a video URL, up to 3 hours (an audio-only recording is refused). */
  mediaUrl: string
  /** An optional intro card: a short video (15 s at most) played before the trailer. */
  introCardUrl?: string
  /** The formats to deliver, padded, never cropped (default `["9:16", "1:1", "4:5"]`; an empty list is refused). */
  formats?: TrailerFormat[]
  /** Stop at a preview of the trailer; render every format with {@link EditResource.continueUseCase} (`mode: "render-final"`). */
  reviewBeforeRender?: boolean
  /** The planner's tier (default `"standard"`). */
  planTier?: EditPlanTier
  /** Instructions for the trailer (up to 4 000 characters). */
  instructions?: string
  /** A style guide for the planner (up to 4 000 characters). */
  styleGuide?: string
}

/** The shortest and longest clip a Clip Pack asks the plan for, in seconds. */
export const CLIP_PACK_MIN_TARGET_SEC = 5
export const CLIP_PACK_MAX_TARGET_SEC = 180

/**
 * A Clip Pack emphasis: `"none"`, or one or more of `"scale"`, `"border"` and
 * `"dim"` joined with `"+"` (each once — the route refuses a repeat).
 */
export type ClipPackEmphasis = SpeakerEmphasisStyle | `${Exclude<SpeakerEmphasisStyle, "none">}+${string}`

/**
 * Input for {@link EditResource.clipPack} and
 * {@link EditResource.estimateClipPack}: one recording in, a pack of short
 * clips out. Only `mediaUrl` is required; every other field left out takes
 * the node's default.
 */
export interface ClipPackInput {
  /** The recording — a video or audio URL, up to 3 hours. An audio recording makes audio clips (no framing, no captions). */
  mediaUrl: string
  /** How many clips to find, 1–50 (default 8). The plan may find fewer. */
  count?: number
  /** Each clip's target length in seconds, {@link CLIP_PACK_MIN_TARGET_SEC}–{@link CLIP_PACK_MAX_TARGET_SEC} (default 60). */
  targetDurationSec?: number
  /**
   * Frame each video clip with Speaker View on automatic boxes over the
   * episode's speakers: the shape, and optionally the layout (default
   * `"stacked"`; one the shape does not draw is snapped), the switch at each
   * speaker change (default `"pan"`) and the emphasis (default `"scale"`;
   * `"none"`, or `"scale"`, `"border"` and `"dim"` joined with `"+"`). Left
   * out: 9:16, stacked, pan, scale. `null`: no framing (the recording's shape).
   */
  framing?: {
    aspect: EdlTargetAspect
    layout?: "auto" | "single" | "side-by-side" | "stacked" | "grid" | "pip"
    switchType?: SpeakerSwitchId
    emphasisStyle?: ClipPackEmphasis
  } | null
  /** Caption each video clip (on by default). */
  captions?: boolean
  /** The captions' look (default `"karaoke"`). */
  captionStyle?: CaptionStyle
  /**
   * Stop at quick previews of the clips for a person to review; render the
   * kept clips at full quality with {@link EditResource.continueUseCase}
   * (`mode: "render-final"`, an `editedEdl` that keeps or drops clips).
   */
  reviewBeforeRender?: boolean
  /** The planner's tier (default `"standard"`). */
  planTier?: EditPlanTier
  /** Instructions for picking the clips (up to 4 000 characters). */
  instructions?: string
  /** A style guide for the planner (up to 4 000 characters). */
  styleGuide?: string
}

export function tightenBody(input: TightenEpisodeInput): Record<string, unknown> {
  const { mediaUrl, ...rest } = input
  return { mediaUrls: [mediaUrl], ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) }
}

export function chaptersBody(input: EpisodeChaptersInput): Record<string, unknown> {
  return {
    mediaUrls: [input.mediaUrl],
    ...(input.planTier !== undefined ? { planTier: input.planTier } : {}),
    ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
    ...(input.styleGuide !== undefined ? { styleGuide: input.styleGuide } : {}),
  }
}

export function trailerBody(input: EpisodeTrailerInput): Record<string, unknown> {
  return {
    mediaUrls: [input.mediaUrl],
    ...(input.introCardUrl !== undefined ? { introCardUrl: input.introCardUrl } : {}),
    // An empty list is sent as is: the route refuses it (at least one format).
    ...(input.formats !== undefined ? { formats: input.formats } : {}),
    ...(input.reviewBeforeRender !== undefined ? { reviewBeforeRender: input.reviewBeforeRender } : {}),
    ...(input.planTier !== undefined ? { planTier: input.planTier } : {}),
    ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
    ...(input.styleGuide !== undefined ? { styleGuide: input.styleGuide } : {}),
  }
}

/** Clip Pack's body: what the caller set, `framing: null` included (no framing). */
export function clipPackBody(input: ClipPackInput): Record<string, unknown> {
  const { mediaUrl, ...rest } = input
  return { mediaUrls: [mediaUrl], ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) }
}
