/**
 * How much memory one ffmpeg launch needs at its peak — what it reserves from
 * the container's ffmpeg budget before it starts (`ffmpeg-admission.ts`,
 * decided 2026-10-05, fixing the 4K OOM).
 *
 * MEASURED on the Railway nodaro-ci runner (pinned ffmpeg n8.1.2), one FINAL
 * Apply EDL chunk's peak RSS with the decode/filter/encode thread counts forced
 * (T = threads, N = segments in the chunk, MP = canvas megapixels):
 *   4K    ≈ 1,223 + 91.7·T + 72.6·N MiB      (R² 0.999)
 *   1080p ≈   393 + 22.9·T + 17.75·N MiB     (R² 0.997)
 * and across canvases — the per-thread slope is ~11.05 MiB per canvas megapixel
 * at both sizes:
 *   peak ≈ 107 + MP·(136 + 8.85·N + 11.05·T) MiB.
 * Threads dominate: 4K, N = 30, T = 32 measured 6,286 MiB (the model: 6,302).
 * Each x264 frame thread holds frames of its own, so memory follows the thread
 * count, not the work.
 *
 * THE THREAD TERM IS SPLIT, because the counts are not always equal: the
 * encoder's threads weigh most, the decoders' and the filter graph's the rest.
 * 11.05 = 8.15 (encode) + 2.9 (decode / filter) per megapixel — fitted on the
 * probe's mixed settings (4K, N = 30: decode/filter 32 with encode 2 is +570
 * MiB over 2/2; encode 32 with decode 2 is +1,680 MiB), so a launch whose
 * counts differ is predicted from each, and an equal-count launch (everything
 * the backend itself starts: `ffmpegThreadsFor`) is exactly the joint model.
 *
 * CONSERVATIVE, on purpose: the joint fit under-predicts a few measured mid
 * points by up to ~10 % (the N = 10 sets sit above the line through N = 2 and
 * N = 30, 1080p most), so a flat 150 MiB is added — the smallest round number
 * that puts the prediction at or above EVERY measured row, symmetric or not
 * (`ffmpeg-memory-model.test.ts` holds the table). It costs under 1 % of a
 * 32 GB container's budget per launch.
 *
 * Segment LENGTH does not matter; segment COUNT does (every segment is its own
 * branch of the filter graph). Inline audio adds nothing measurable. A proxy
 * (lighter preset) predicts as a final of its canvas — an over-estimate, which
 * only ever makes a launch wait, never run short.
 *
 * A launch that predicts nothing reserves `defaultPeakMemoryMiB`: the 1080p
 * base, scaled by its thread counts.
 *
 * AUDIO ONLY has no picture, so the model's picture terms vanish and the fixed
 * term (107 fitted + 150 margin = 257 MiB) is what is left (`audioPeakMemoryMiB`).
 * Checked against a real run (round 4, decided 2026-10-05): a 4K H.264 + AAC source
 * demuxed and converted to mp3 (`-vn -c:a libmp3lame`, the call yt-dlp's
 * ExtractAudio makes) peaks at ~39 MiB RSS at 1, 8 and the default thread counts
 * alike — the figure sits far above it, by design.
 *
 * A ZOOM (decided 2026-10-07) adds a term of its own (`zoomPeakMemoryMiB`): a
 * Speaker View zoom crops its camera to the start box and scales that window
 * (about 1.56× the canvas) on every frame of the segment, the tween's and the
 * rest's, so its slice holds more than the canvas model predicts. The picture
 * builder says which segments draw one (`EdlPictureFragment.memoryHint`);
 * without the hint the prediction is exactly the one above.
 *
 * MEASURED by the Speaker View plugin's probes (F4b / F4c): a one-segment
 * 1080p slice, launched with the host's thread counts and encoder, ffmpeg's
 * own peak RSS, the zoom slice against the static slice of the same framing:
 *   2 threads (pinned n8.1.2, the 2-vCPU CI runner)  +103 to +118 MiB, flat in
 *     the box (0.40 down to 0.03 of the frame width);
 *   16 / 32 / 48 threads (macOS, ffmpeg 9.0.2)      about +330 / +260 / +350
 *     MiB (worst pairings 339 / 271 / 362), the 48-thread row indicative only.
 * At 16 threads the zoom slice (945 MiB) passed the no-zoom prediction (924);
 * at production's 32 (1,425 MiB) it passed it (1,291) by 134 MiB.
 *
 * The term is fitted like the canvas model, per canvas megapixel and per
 * thread, least squares over the four thread counts' worst pairings:
 *   zoom ≈ MP·(82.65 + 2.0·T) MiB,
 * T = the graph's side of the counts (decode / filter): the zoom adds crops,
 * scales, a split and pads — filter-graph work — and leaves the encoder as it
 * was. Every measured row had equal counts, so the split is by mechanism, not
 * measured. So is the scaling with the canvas: every row is 1080p (one 9:16),
 * and the term follows the megapixels because its windows are canvas-sized.
 * The fit misses the 16-thread row by 101 MiB, so a flat 110 is added — the
 * smallest multiple of 10 that puts the TERM alone at or above every measured
 * zoom term, so it never leans on the canvas model's own margin
 * (`ffmpeg-memory-zoom.test.ts` holds the table). It is charged ONCE per
 * slice, however many of its segments zoom: every measured slice held one
 * zoom segment; a slice with several was not measured.
 *
 * Pure.
 */
import type { FfmpegThreads } from "./ffmpeg-threads.js"

/** The model's terms (MiB): fixed (107 fitted + 150 margin), per canvas
 *  megapixel, per megapixel-segment, per megapixel-thread (encode, decode/filter). */
const BASE_MIB = 107 + 150
const PER_MEGAPIXEL_MIB = 136
const PER_MEGAPIXEL_SEGMENT_MIB = 8.85
const PER_MEGAPIXEL_ENCODE_THREAD_MIB = 8.15
const PER_MEGAPIXEL_DECODE_THREAD_MIB = 2.9

/** The zoom's terms (MiB): flat margin, per canvas megapixel, per
 *  megapixel-thread (the graph's side). */
const ZOOM_MARGIN_MIB = 110
const ZOOM_PER_MEGAPIXEL_MIB = 82.65
const ZOOM_PER_MEGAPIXEL_THREAD_MIB = 2.0

/** What a slice draws beyond its canvas and segments, as its picture builder
 *  declares it (`EdlPictureFragment.memoryHint`). Absent: nothing. */
export interface PictureMemoryExtras {
  /** Some segment of the slice draws a zoom. */
  readonly zoom?: boolean
}

/** 4K: the picture size assumed when a launch cannot say what it will process. */
export const UHD_CANVAS = { width: 3840, height: 2160 } as const

/** The 1080p base of a launch with no prediction: 393 + 22.9·T. */
const DEFAULT_BASE_MIB = 393
const DEFAULT_PER_THREAD_MIB = 22.9

/** The graph's side of the thread counts: decoders and filter workers run the
 *  same pipeline stage count in every probe, so the larger of the two stands. */
const decodeSide = (threads: FfmpegThreads): number => Math.max(threads.decode, threads.filter)

/** One picture launch's predicted peak memory in MiB, rounded up — with the
 *  zoom's term when `extras.zoom` says the slice draws one. */
export function canvasPeakMemoryMiB(
  canvas: { readonly width: number; readonly height: number },
  segments: number,
  threads: FfmpegThreads,
  extras?: PictureMemoryExtras,
): number {
  const megapixels = (canvas.width * canvas.height) / 1e6
  const perMegapixel =
    PER_MEGAPIXEL_MIB +
    PER_MEGAPIXEL_SEGMENT_MIB * Math.max(1, segments) +
    PER_MEGAPIXEL_ENCODE_THREAD_MIB * threads.encode +
    PER_MEGAPIXEL_DECODE_THREAD_MIB * decodeSide(threads)
  const zoom = extras?.zoom === true ? zoomPeakMemoryMiB(canvas, threads) : 0
  return Math.ceil(BASE_MIB + megapixels * perMegapixel + zoom)
}

/** The zoom's own term in MiB, unrounded: 110 + MP·(82.65 + 2.0·T), T the
 *  graph's side of the launch's counts. Charged once per slice that draws a
 *  zoom (`canvasPeakMemoryMiB` with `{ zoom: true }`). */
export function zoomPeakMemoryMiB(canvas: { readonly width: number; readonly height: number }, threads: FfmpegThreads): number {
  const megapixels = (canvas.width * canvas.height) / 1e6
  return ZOOM_MARGIN_MIB + megapixels * (ZOOM_PER_MEGAPIXEL_MIB + ZOOM_PER_MEGAPIXEL_THREAD_MIB * decodeSide(threads))
}

/** What a launch that predicts nothing reserves, in MiB: 393 + 22.9·T at the
 *  1080p base, T the launch's thread count (encode and decode/filter weighted
 *  as in the canvas model — equal counts give exactly `T`). */
export function defaultPeakMemoryMiB(threads: FfmpegThreads): number {
  const equivalent =
    (PER_MEGAPIXEL_ENCODE_THREAD_MIB * threads.encode + PER_MEGAPIXEL_DECODE_THREAD_MIB * decodeSide(threads)) /
    (PER_MEGAPIXEL_ENCODE_THREAD_MIB + PER_MEGAPIXEL_DECODE_THREAD_MIB)
  return Math.ceil(DEFAULT_BASE_MIB + DEFAULT_PER_THREAD_MIB * equivalent)
}

/** What an AUDIO-ONLY ffmpeg (an audio conversion or cut — no picture decoded or
 *  encoded) reserves, in MiB: the model's fixed term, whatever the threads. */
export function audioPeakMemoryMiB(): number {
  return canvasPeakMemoryMiB({ width: 0, height: 0 }, 1, { decode: 1, filter: 1, encode: 1 })
}
