/**
 * The full-frame picture: each segment's one source, letterboxed onto the
 * canvas (scale to fit, pad with black). Apply EDL's picture since phase 1, and
 * the timeline's default builder. Its chain is exactly the one Apply EDL's
 * slices always carried, so every Apply EDL graph is unchanged by the
 * timeline extraction (the F10 golden trace pins it). Regions are not drawn:
 * Apply EDL's rule refuses any (`@nodaro/render-rules`), and a renderer that
 * draws them supplies its own builder.
 */
import type { EdlPictureBuilder } from "./edl-picture.js"

/** Scale to fit the canvas, then pad to it, centred, in black. */
export function scalePadChain(canvas: { readonly width: number; readonly height: number }): string {
  return (
    `scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=decrease,` +
    `pad=${canvas.width}:${canvas.height}:(ow-iw)/2:(oh-ih)/2:color=black`
  )
}

export const fullFramePicture: EdlPictureBuilder = (ctx) => ({ chain: scalePadChain(ctx.canvas) })
