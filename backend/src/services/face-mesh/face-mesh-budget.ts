/**
 * What one face mesh run may take from the box: memory and time — named, so
 * a test pins each (`face-mesh-budget.test.ts`). Pure (no onnxruntime import).
 *
 * The run's decoders (the clip the faces are found in, the clip the lines go
 * on, the mask, the depth), its two onnxruntime sessions, sharp's drawing and its encoder
 * all run inside ONE ffmpeg admission hold (`withFfmpegSlot`): the box's
 * shared memory budget sees all of them at once.
 */
import { FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD } from "../face-detect/face-detect-budget.js"
import { cameraMegapixelsOf, canvasPeakMemoryMiB } from "../../providers/video/ffmpeg-memory-model.js"
import type { FfmpegThreads } from "../../providers/video/ffmpeg-threads.js"

/** The landmark session's working set per intra-op thread, MiB (a 2.3 MB model,
 *  one 192 × 192 crop at a time): about twice what a run grew by locally. */
export const FACE_MESH_SESSION_PEAK_MIB_PER_THREAD = 128
/** sharp's working set while it draws a frame (libvips' cache is per call), MiB. */
export const FACE_MESH_DRAW_PEAK_MIB = 96

/** Hold budget per frame, ms: several times the worst measured (decode, detection,
 *  two faces' landmarks, drawing and the encode's share; `README` in model/). */
export const FACE_MESH_MS_PER_FRAME = 400
/** Fixed hold budget per run, ms: the decoders' and encoder's start. */
export const FACE_MESH_FIXED_MS = 120_000

/** How long a run of `frames` frames may hold its slot (every child is killed past it). */
export function faceMeshTimeoutMs(frames: number): number {
  return FACE_MESH_FIXED_MS + FACE_MESH_MS_PER_FRAME * Math.max(1, Math.ceil(frames))
}

type Size = { readonly width: number; readonly height: number }

/**
 * The run's declared peak, MiB: the encoder's canvas prediction at the drawn
 * clip's size (its decoder, the mask's and the depth's counted as inputs), the detection
 * decode's at the found clip's size (it encodes nothing), both sessions and
 * sharp.
 */
export function faceMeshPeakMemoryMiB(
  sizes: { readonly detect: Size; readonly draw: Size; readonly mask?: Size; readonly depth?: Size },
  ortThreads: number,
  ffmpegThreads: FfmpegThreads,
): number {
  const largest = [sizes.draw, sizes.detect, ...(sizes.mask ? [sizes.mask] : []), ...(sizes.depth ? [sizes.depth] : [])].reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b))
  const encode = canvasPeakMemoryMiB(sizes.draw, 1, ffmpegThreads, {
    inputs: 1 + (sizes.mask ? 1 : 0) + (sizes.depth ? 1 : 0),
    cameraMegapixels: cameraMegapixelsOf(largest),
  })
  const detect = canvasPeakMemoryMiB(sizes.detect, 1, { ...ffmpegThreads, encode: 0 }, { inputs: 1, cameraMegapixels: cameraMegapixelsOf(sizes.detect) })
  const threads = Math.max(1, Math.ceil(ortThreads))
  return encode + detect + (FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD + FACE_MESH_SESSION_PEAK_MIB_PER_THREAD) * threads + FACE_MESH_DRAW_PEAK_MIB
}
