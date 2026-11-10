/**
 * The output-format arguments of generate_image, modify_image and
 * image_to_image (GPT Image 2.6 writes PNG, JPEG, WebP, an animated GIF or an
 * SVG), and how they become the image routes' body.
 *
 * Kept to the bytes the per-tool wire budget leaves: plain strings and numbers
 * on the wire, normalized here the tool way (never refused for a value): a
 * format in any case, `jpg` as `jpeg`, a GIF's numbers moved inside their
 * range. The route then fits each to the model (`normalizeModelInput`) and
 * reports what it changed in `adjustments`; which models write which formats is
 * on `list_models` (`outputFormats`, `gifFrames`, `svgLevels`).
 */
import { z } from "zod"
import { IMAGE_OUTPUT_FORMAT_VALUES, IMAGE_SVG_LEVEL_VALUES } from "@nodaro/shared/models"

export const imageFormatArgs = {
  output_format: z.string().optional().describe("png, jpeg, webp, gif (animated, square) or svg; see outputFormats."),
  gif_frames: z.number().optional().describe("GIF frames 2-16."),
  gif_frame_duration_ms: z.number().optional().describe("GIF ms per frame 20-2000."),
  svg_level: z.string().optional().describe("standard, detailed or max."),
}

/** A value inside `[min, max]`, a whole multiple of `step`. */
function within(value: unknown, min: number, max: number, step = 1): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.min(Math.max(Math.round(value / step) * step, min), max)
}

/** The format arguments as the image routes' body fields; a value that names nothing is left out. */
export function imageFormatBody(args: {
  output_format?: unknown
  gif_frames?: unknown
  gif_frame_duration_ms?: unknown
  svg_level?: unknown
}): Record<string, unknown> {
  const asked = typeof args.output_format === "string" ? args.output_format.trim().toLowerCase() : undefined
  const outputFormat = asked === "jpg" ? "jpeg" : asked
  if (!outputFormat || !(IMAGE_OUTPUT_FORMAT_VALUES as readonly string[]).includes(outputFormat)) return {}
  const level = typeof args.svg_level === "string" ? args.svg_level.trim().toLowerCase() : undefined
  const gifFrames = within(args.gif_frames, 2, 16)
  const gifFrameDurationMs = within(args.gif_frame_duration_ms, 20, 2000, 10)
  return {
    outputFormat,
    ...(outputFormat === "gif" && gifFrames !== undefined && { gifFrames }),
    ...(outputFormat === "gif" && gifFrameDurationMs !== undefined && { gifFrameDurationMs }),
    ...(outputFormat === "svg" && level && (IMAGE_SVG_LEVEL_VALUES as readonly string[]).includes(level) && { svgLevel: level }),
  }
}
