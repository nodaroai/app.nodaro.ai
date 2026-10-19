/**
 * Generate Mask — text-prompted IMAGE segmentation (Grounded SAM). The wire
 * contract of `POST /v1/generate-mask`, the `generate_mask` MCP verb,
 * `client.media.generateMask` and `nodaro media generate-mask`, defined ONCE:
 * every bound the route schema and the SDK/CLI read.
 *
 * The finished job's output is `{ maskUrl, imageUrl }`: `maskUrl` is the
 * black-and-white mask PNG (white = the subject), `imageUrl` is the SOURCE
 * image passed through unchanged, so an inpainting step can take the pair.
 *
 * Wire contract only — no I/O.
 */

export const GENERATE_MASK_LIMITS = {
  /** Subject description length cap. */
  PROMPT_MAX_LENGTH: 500,
  /** Segmentation confidence bounds. */
  THRESHOLD_MIN: 0,
  THRESHOLD_MAX: 1,
  /** Default segmentation confidence. Lower selects more (and less precise) regions. */
  THRESHOLD_DEFAULT: 0.3,
} as const

/** `POST /v1/generate-mask` request body. */
export interface GenerateMaskRequest {
  /** The image to segment. */
  readonly imageUrl: string
  /** What to select, in plain words (e.g. "the person", "sky and clouds"). 1–500 characters. */
  readonly prompt: string
  /** Segmentation confidence, `GENERATE_MASK_LIMITS.THRESHOLD_MIN`–`THRESHOLD_MAX` (default 0.3). */
  readonly threshold?: number
}

/** A completed Generate Mask job's `output_data`. */
export interface GenerateMaskOutput {
  /** The mask: a black-and-white PNG, white = the subject. */
  readonly maskUrl: string
  /** The source image, passed through unchanged. */
  readonly imageUrl: string
}
