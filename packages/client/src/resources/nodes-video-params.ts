import type { VideoToVideoNodeProvider } from "@nodaro/shared/models"
import type { GenerationSessionParams } from "./nodes.js"

/**
 * Typed request body for `nodes.run("video-to-video", …)` / `runAndWait` /
 * `quote` — `POST /v1/video-to-video`: change or restyle an existing clip from
 * a prompt. Mirrors the route's body; fields a model does not use are ignored
 * by that model.
 */
export interface VideoToVideoParams extends GenerationSessionParams {
  /** The clip to change. */
  videoUrl: string
  /** What to change. On `seedance-2-5` it is an edit instruction ("make it
   *  black and white"); the platform frames it as an edit of the clip. */
  prompt?: string
  /** The person's own words, kept for the record when `prompt` was rewritten. */
  userPrompt?: string
  /** Default `"wan"`. `seedance-2-5` edits the whole clip and is priced by the
   *  clip's length (see `nodes.quote`). */
  provider?: VideoToVideoNodeProvider
  /** Wan / Wan Flash. A Seedance edit ignores it: the result keeps the source
   *  clip's own length. */
  duration?: "5" | "10"
  /** `480p` is Seedance only. */
  resolution?: "480p" | "720p" | "1080p"
  /** Native audio: Wan Flash's audio track, Seedance's generated sound. */
  audio?: boolean
  /** Wan Flash multi-shot. */
  multiShots?: boolean
  /** Runway Aleph output ratio. */
  aspectRatio?: "16:9" | "9:16" | "4:3" | "3:4" | "1:1" | "21:9"
  seed?: number
  /** One image the edit can refer to (Seedance: `@image_1`). */
  referenceImageUrl?: string
  negativePrompt?: string
  /** Wan Video Edit: seconds of the source to edit (`"0"` = the whole clip). */
  videoEditDuration?: "0" | "5" | "10"
  /** Wan Video Edit: keep the source audio (`"origin"`) or let the model decide. */
  audioSetting?: "auto" | "origin"
  promptExtend?: boolean
  /** Seedance 2.5 only: a 480p draft, finalized later with `video-upscale`. */
  draft?: boolean
  [k: string]: unknown
}

/** One way the platform shaped the price — shown so a client can explain it. */
export interface QuoteAdjustment {
  /** Stable code, e.g. `ref_video_length`, `extra_reference_images`,
   *  `loop_trim_addon`, `voiced_audio_addon`, `params_adjusted`. */
  readonly code: string
  readonly message: string
  /** Credits this adjustment adds to `reserve`, when it is a separate amount. */
  readonly credits?: number
}

/** Something the caller should know before running. */
export interface QuoteWarning {
  /** Stable code, e.g. `ref_video_unmeasured`, `settles_to_actual`. */
  readonly code: string
  readonly message: string
}

/**
 * The price of a run before it starts — `POST /v1/quote`. Computed by the same
 * code the run route reserves with, on the same body: nothing is started and
 * nothing is charged.
 */
export interface NodeQuote {
  /** The price id the run is charged under. */
  readonly identifier: string
  /** Credits the run reserves when it starts. */
  readonly reserve: number
  /**
   * Credits the run is expected to cost, when that differs from `reserve` and
   * can be worked out from the measured inputs (a Seedance edit renders the
   * source clip's length, not the longest tier). The run settles to what was
   * actually generated and never above `reserve`.
   */
  readonly expected?: number
  readonly adjustments: readonly QuoteAdjustment[]
  readonly warnings: readonly QuoteWarning[]
}
