/**
 * What one face mesh run may take from the box: memory and time — named, so
 * a test pins each (`face-mesh-budget.test.ts`). Pure (no onnxruntime import).
 *
 * The run's decoders (the clip the faces are found in, the clip the lines go
 * on, the mask, the depth), its two onnxruntime sessions, sharp's drawing, the
 * frames it holds while their faces' tracks are decided and its encoder
 * all run inside ONE ffmpeg admission hold (`withFfmpegSlot`): the box's
 * shared memory budget sees all of them at once.
 */
import { FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD } from "../face-detect/face-detect-budget.js"
import { cameraMegapixelsOf, canvasPeakMemoryMiB } from "../../providers/video/ffmpeg-memory-model.js"
import type { FfmpegThreads } from "../../providers/video/ffmpeg-threads.js"
import { FACE_MESH_LOOKAHEAD_FRAMES } from "./face-mesh-tracks.js"

/**
 * The landmark session's working set per intra-op thread, MiB (a 4.9 MB model,
 * one 256 × 256 crop at a time). It was 128 for the former 192 × 192 model,
 * about twice what a run grew by locally. Re-measured for this one (2026-11-02,
 * onnxruntime-node 1.30.0, `README` in model/): the session alone, built and
 * run on 200 real crops, grows the process by 15–17 MiB (the former model:
 * 8–13), at one thread as at two; a whole run with onnxruntime and YuNet
 * already loaded, by 81–99 MiB (the former: 76–86). The former figure plus
 * about twice the largest increase.
 */
export const FACE_MESH_SESSION_PEAK_MIB_PER_THREAD = 160
/** sharp's working set while it draws a frame (libvips' cache is per call), MiB. */
export const FACE_MESH_DRAW_PEAK_MIB = 96

/**
 * Hold budget per frame, ms: several times the worst measured (decode,
 * detection, every face's landmarks, drawing and the encode's share; `README`
 * in model/). The landmark model costs 2.5–3.5 × the former's a face
 * (3.4–3.5 ms on an Apple M4 Max, 9.8–9.9 ms on linux/arm64; one thread):
 * the whole step measured 56–61 CPU-ms a frame on four faces a frame (the
 * former model: 47–51), still well inside.
 */
export const FACE_MESH_MS_PER_FRAME = 400
/** Fixed hold budget per run, ms: the decoders' and encoder's start. */
export const FACE_MESH_FIXED_MS = 120_000

/** How long a run of `frames` frames may hold its slot (every child is killed past it). */
export function faceMeshTimeoutMs(frames: number): number {
  return FACE_MESH_FIXED_MS + FACE_MESH_MS_PER_FRAME * Math.max(1, Math.ceil(frames))
}

type Size = { readonly width: number; readonly height: number }

/**
 * The frames the drawer holds at once, at most: the `FACE_MESH_LOOKAHEAD_FRAMES`
 * waiting for their faces' tracks (`face-mesh-tracks.ts`) and the one being
 * drawn. Each is a copy of the drawn clip's frame and, on a depth map, of the
 * depth render's (RGB, 3 bytes a pixel); its found faces' points (468 × 2
 * doubles, about 7 KiB a face) are not counted.
 */
export const FACE_MESH_HELD_FRAMES = FACE_MESH_LOOKAHEAD_FRAMES + 1

/** The held frames' memory, MiB (`FACE_MESH_HELD_FRAMES`). */
export function faceMeshHeldFramesMiB(sizes: { readonly draw: Size; readonly depth?: Size }): number {
  const bytes = (s: Size) => s.width * s.height * 3
  return Math.ceil((FACE_MESH_HELD_FRAMES * (bytes(sizes.draw) + (sizes.depth ? bytes(sizes.depth) : 0))) / (1024 * 1024))
}

/**
 * The run's declared peak, MiB: the encoder's canvas prediction at the drawn
 * clip's size (its decoder, the mask's and the depth's counted as inputs), the detection
 * decode's at the found clip's size (it encodes nothing), both sessions,
 * sharp, and the frames held (`faceMeshHeldFramesMiB`).
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
  const sessions = (FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD + FACE_MESH_SESSION_PEAK_MIB_PER_THREAD) * threads
  return encode + detect + sessions + FACE_MESH_DRAW_PEAK_MIB + faceMeshHeldFramesMiB(sizes)
}
