/**
 * The output-format levers of the image routes (`/v1/generate-image`,
 * `/v1/image-to-image`), declared once so both bodies take them alike.
 *
 * Vocabulary bounds only: which formats a model writes, a GIF's frames and
 * speed and an SVG's level are snapped per model by the catalog
 * (`resolveNormalizedImageGen` → `normalizeModelInput`), which says what it
 * changed in the response's `adjustments`. The frame bounds are the provider's
 * documented ones; within them the snap rounds a frame time to its step and
 * moves a frame count to one a model takes.
 */
import { z } from "zod"
import { IMAGE_OUTPUT_FORMAT_VALUES, IMAGE_SVG_LEVEL_VALUES } from "@nodaro/shared/models"
import { MASKLESS_OUTPUT_FORMATS } from "@nodaro/shared/model-catalog"

export const imageFormatFields = {
  /** The file the run writes: `png` (default), `jpeg`, `webp`, `gif` (animated) or `svg` (vector), on the models that list it. */
  outputFormat: z.enum(IMAGE_OUTPUT_FORMAT_VALUES).optional(),
  /** A GIF's frames (2 to 16, 9 by default). Read only with `outputFormat: "gif"`. */
  gifFrames: z.number().int().min(2).max(16).optional(),
  /** How long each GIF frame shows, in ms (20 to 2000 in steps of 10, 200 by default). Read only with `outputFormat: "gif"`. */
  gifFrameDurationMs: z.number().int().min(20).max(2000).optional(),
  /** An SVG's level of detail: `standard` (default), `detailed` or `max`. Read only with `outputFormat: "svg"`. */
  svgLevel: z.enum(IMAGE_SVG_LEVEL_VALUES).optional(),
}


export const MASK_WITH_FORMAT_MESSAGE =
  "A mask can't be used with a GIF or an SVG. Choose PNG, JPEG or WebP, or remove the mask."

/**
 * Why a request asking for `outputFormat` cannot carry a mask, or `undefined`.
 * Checked on the request as sent, before any price is held: a GIF or an SVG
 * takes no mask, and an inpaint's result is composited over its base as a
 * still image, which would lose the animation or the drawing.
 */
export function maskFormatConflict(data: { outputFormat?: unknown; maskUrl?: unknown }): string | undefined {
  const masked = typeof data.maskUrl === "string" && data.maskUrl.length > 0
  return masked && typeof data.outputFormat === "string" && MASKLESS_OUTPUT_FORMATS.includes(data.outputFormat)
    ? MASK_WITH_FORMAT_MESSAGE
    : undefined
}
