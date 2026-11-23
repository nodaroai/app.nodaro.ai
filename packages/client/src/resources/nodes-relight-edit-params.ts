import type { GenerationSessionParams } from "./nodes.js"

/** How Relight & Switch finds what to relight. */
export type RelightSwitchMode = "auto" | "fill" | "select" | "custom"

/**
 * Typed request body for `nodes.run("switchx", …)` / `runAndWait` / `quote` —
 * `POST /v1/switchx`, Relight & Switch: relight a subject, restyle or swap a
 * background, or composite new elements onto a video's own pixels. The motion
 * and the framing stay the source's.
 *
 * Give a `prompt`, a `referenceImageUrl`, or both. `alphaMode` says what is
 * relit:
 * - `"auto"`: the subject, found for you. No mask.
 * - `"fill"`: the whole scene. No mask.
 * - `"select"`: `maskUrl` is a mask IMAGE of one frame (`alphaKeyframeIndex`,
 *   0 = the first frame); the model follows it across the clip.
 * - `"custom"`: `maskUrl` is a mask VIDEO, one mask frame per source frame.
 *
 * Priced by the clip's frames, in blocks of 30, and by `maxResolution`. Ask
 * the price first with `nodes.quote("switchx", params)`: it measures the clip
 * as the run does and starts nothing.
 *
 * The clip is measured before any credits are reserved. Refusals, each a
 * `400` whose `message` is a sentence you can show:
 * - `VIDEO_TOO_MANY_FRAMES`: more than 240 frames (a clip up to 270 is cut to
 *   its first 240 instead, and the job's `output_data.sourceTrimmedToFrames`
 *   says so). Trim the clip first.
 * - `SOURCE_TOO_LARGE`: a frame over 2.77 megapixels. Use a smaller clip.
 * - `MISSING_STYLE_INPUT`: neither a prompt nor a reference image.
 * - `MISSING_ALPHA`: `"select"` or `"custom"` without `maskUrl`.
 * - `validation_error`: anything else wrong with the body.
 */
export interface RelightSwitchParams extends GenerationSessionParams {
  /** The source video — a public http(s) URL. At most 240 frames, 2.77 megapixels a frame. */
  videoUrl: string
  /** What is relit. See {@link RelightSwitchMode}. */
  alphaMode: RelightSwitchMode
  /** `"select"`: a mask image of one frame. `"custom"`: a mask video. Required by both; unused by `"auto"` and `"fill"`. */
  maskUrl?: string
  /** `"select"` only: the frame the mask image belongs to, counted from 0. Default 0. */
  alphaKeyframeIndex?: number
  /** A picture whose light and look the result takes. Required when there is no `prompt`. */
  referenceImageUrl?: string
  /** The light or the look, in your own words (up to 2,000 characters). Required when there is no `referenceImageUrl`. */
  prompt?: string
  /** The output's longer side cap: 720 or 1080 (the default). Part of the price. */
  maxResolution?: 720 | 1080
  /** A seed to repeat a result, 0–4294967295. */
  seed?: number
  [k: string]: unknown
}

/** The Seedance 2 family models Edit Video Pro runs on. A newer family member may be accepted before it is listed here. */
export type EditVideoProProvider = "seedance-2" | "seedance-2-fast" | "seedance-2-mini" | "seedance-2-5" | (string & {})

/**
 * Typed request body for `nodes.run("edit-video-pro", …)` / `runAndWait` /
 * `quote` — `POST /v1/edit-video-pro` (Nodaro Cloud): replace a span of time
 * inside a video with newly generated content, stitched back into the source.
 * Everything before `spanStart` and after `spanEnd` stays as it was.
 *
 * The span is 4 to 120 seconds long and must end inside the video. Ask the
 * price first with `nodes.quote("edit-video-pro", params)`: its `reserve` is
 * the most the edit can cost (a `settles_to_actual` warning), and the run is
 * charged for what it generates.
 *
 * Refusals, each a `400` whose `message` is a sentence you can show:
 * - `validation_error`: a span shorter than 4 seconds or longer than the
 *   maximum, a missing prompt, a link that cannot be used.
 * - `span_exceeds_source`: `spanEnd` is past the end of the video.
 * A model this deployment does not offer answers `403 model_not_available`.
 */
export interface EditVideoProParams extends GenerationSessionParams {
  /** The source video — a public http(s) URL. */
  videoUrl: string
  /** Where the replaced span starts, in seconds from the start of the video. */
  spanStart: number
  /** Where it ends, in seconds. 4 to 120 seconds after `spanStart`, and not past the end of the video. */
  spanEnd: number
  /** What happens in the span, in your own words. Required. */
  prompt: string
  /** The model. Default `seedance-2`. */
  provider?: EditVideoProProvider
  /** Up to 9 pictures the new content may draw on (a character, a product, a place). */
  referenceImageUrls?: string[]
  /** Generate the span's sound too. Default `true`. */
  generateAudio?: boolean
  [k: string]: unknown
}
