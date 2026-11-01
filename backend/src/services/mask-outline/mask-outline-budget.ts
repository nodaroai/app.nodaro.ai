/**
 * What one mask outline run may take from the box: memory and time — named,
 * so a test pins each. Pure.
 *
 * The run's two decoders (the clip drawn on, the mask), its drawing (JS, on
 * the frame buffers) and its encoder run inside ONE ffmpeg admission hold
 * (`withFfmpegSlot`): the box's shared memory budget sees all of them at once.
 */
import { cameraMegapixelsOf, canvasPeakMemoryMiB } from "../../providers/video/ffmpeg-memory-model.js"
import type { FfmpegThreads } from "../../providers/video/ffmpeg-threads.js"

type Size = { readonly width: number; readonly height: number }

/** The drawing's fixed working set (the region lists, the module's code and small arrays), MiB. */
export const MASK_OUTLINE_DRAW_FIXED_MIB = 32
/**
 * The drawing's bytes per pixel of the CLIP: the nearest-ring buffer (Int32,
 * 4), the distance buffer at worst the whole frame (Int32, 4), and two RGB
 * frame copies (the one painted and one the encoder still holds, 3 each).
 */
export const MASK_OUTLINE_BYTES_PER_CLIP_PIXEL = 4 + 4 + 3 + 3
/** The drawing's bytes per pixel of the MASK: the label image (Int32, 4) and its gray frame (1). */
export const MASK_OUTLINE_BYTES_PER_MASK_PIXEL = 4 + 1

/** The drawing's own working set, MiB, at the clip's and the mask's sizes: a 4K clip is admitted at its real size. */
export function maskOutlineDrawPeakMiB(sizes: { readonly draw: Size; readonly mask: Size }): number {
  const bytes =
    MASK_OUTLINE_BYTES_PER_CLIP_PIXEL * sizes.draw.width * sizes.draw.height + MASK_OUTLINE_BYTES_PER_MASK_PIXEL * sizes.mask.width * sizes.mask.height
  return MASK_OUTLINE_DRAW_FIXED_MIB + Math.ceil(bytes / (1024 * 1024))
}

/** Hold budget per frame, ms: several times a 1080p frame's decode, labelling, rings and encode share. */
export const MASK_OUTLINE_MS_PER_FRAME = 250
/** Fixed hold budget per run, ms: the decoders' and encoder's start. */
export const MASK_OUTLINE_FIXED_MS = 120_000

/** How long a run of `frames` frames may hold its slot (every child is killed past it). */
export function maskOutlineTimeoutMs(frames: number): number {
  return MASK_OUTLINE_FIXED_MS + MASK_OUTLINE_MS_PER_FRAME * Math.max(1, Math.ceil(frames))
}

/**
 * The run's declared peak, MiB: the encoder's canvas prediction at the drawn
 * clip's size (its decoder and the mask's counted as its two inputs) and the
 * drawing's buffers at their sizes (`maskOutlineDrawPeakMiB`).
 */
export function maskOutlinePeakMemoryMiB(sizes: { readonly draw: Size; readonly mask: Size }, ffmpegThreads: FfmpegThreads): number {
  const largest = sizes.draw.width * sizes.draw.height >= sizes.mask.width * sizes.mask.height ? sizes.draw : sizes.mask
  const encode = canvasPeakMemoryMiB(sizes.draw, 1, ffmpegThreads, { inputs: 2, cameraMegapixels: cameraMegapixelsOf(largest) })
  return encode + maskOutlineDrawPeakMiB(sizes)
}
