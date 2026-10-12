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
 * A ZOOM (decided 2026-10-07; per zoomed segment since 2026-10-10; refit on
 * the pinned build's own thread counts, one straight slope in T, 2026-10-11) adds a term of its own
 * (`zoomPeakMemoryMiB`): a Speaker View zoom crops its camera to the start
 * box and scales that window (about 1.56× the canvas) on every frame of the
 * segment, the tween's and the rest's, so its slice holds more than the canvas
 * model predicts - and every zoomed segment is its own crop + scale branch of
 * the graph, so it holds more again for each one. The picture builder says
 * which segments draw one (`EdlPictureFragment.memoryHint`); the slice counts
 * them (Z). Without a hint the prediction is exactly the one above.
 *
 *   zoom ≈ MP·(44 + Z·(26 + 6.5·T)) MiB,
 *
 * T = the graph's side of the counts (decode / filter): the zoom adds crops,
 * scales, a split and pads - filter-graph work - and leaves the encoder as it
 * was. Every measured row had equal counts, so the split is by mechanism, not
 * measured. The per-zoom thread slope is ONE straight line in T (decided
 * 2026-10-11): the pinned rows past 16 threads are floors or ran into the
 * venue's pid cap (below), so they are not evidence of a flatter slope, and
 * the reservation errs on the safe side. An earlier fit bent the slope at 16
 * threads (2.2 past it); it reserved 12,191 MiB for the 30-zoom 1080p final
 * at 32 threads where the straight line reserves 16,471.
 *
 * DERIVATION (measured 2026-10-11, the zoom-memory probe). The Speaker View
 * cost probe's harness (C4), run on the pinned n8.1.2 on the nodaro-ci runner
 * (AMD EPYC 9655/9655P, 2 vCPU quota, 8 GB container, pids.max 1000) with the
 * decode / filter / encode thread counts FORCED to 2 / 16 / 32 the way the
 * canvas model was fitted (x264's own SEI in each chunk confirms the count):
 * `sv2-zoom` (one camera per segment, every segment but the first two zoomed,
 * so Z = N − 2) against Apply EDL's static multicam slice `aedl-mc3` of the
 * same N, 3 reps per row, peak = ffmpeg's own maxrss, the highest rep shown
 * (the spread is under 3 %). Peak MiB:
 *
 *   1080p final   Z=2    4    6     8     13     18     23     28
 *     T = 2      679  857 1,030 1,197  1,581  1,966  2,414  2,720
 *     T = 16   1,120 1,320 1,535 1,733  2,099† 3,826† ≥5,308† ≥6,051†
 *     T = 32   1,666 1,949 2,141† 2,826† 3,974† 5,517† ≥5,915† ≥6,003†
 *   720p proxy    Z=2    4    6     8     13     18     23     28
 *     T = 2      323  420   523   605    820  1,036  1,296  1,467
 *     T = 16     606  749   894 1,018  1,281† 2,062† 3,342† 3,867†
 *     T = 32     925 1,187 1,337† 1,701† 2,285† 3,055† 4,195† 4,782†
 *   static twins (N = 4 / 10 / 20 / 30), 1080p: T=2 532 / 666 / 847 / 1,041;
 *     T=16 962 / 1,174 / 1,390 / 1,562; T=32 1,456 / 1,783 / 2,067 / 2,271.
 *     720p: T=2 245 / 320 / 411 / 508; T=16 498 / 700 / 861 / 1,022;
 *     T=32 795 / 1,126 / 1,394 / 1,581.
 *   (the earlier pinned 2-thread slices of 2-4-chunk edits, in the test, reach
 *   2,822 MiB at 1080p and 1,542 at 720p, both Z = 30.)
 *
 * TWO LIMITS OF THE VENUE, both visible in the table:
 *   ≥ = a FLOOR, not a peak. The container cannot hold the real peak, so the
 *     harness stopped ffmpeg when its RSS passed 5.3-6.0 GB (an unstopped run
 *     killed the whole runner container). The four 1080p floors are at or
 *     above the ceiling they hit; the real peaks are higher (the steps at 32
 *     threads, ~240 MiB per zoomed segment from Z = 8 to 18, put Z = 28 near
 *     7.4 GB), and a slice that large was NOT measured.
 *   † = the pids cgroup (pids.max 1000) refused ffmpeg's thread creation
 *     during the row (swscaler: "Resource temporarily unavailable"; the
 *     process held ~900 threads, at 16 threads from Z = 13, at 32 from Z = 6).
 *     ffmpeg ran with fewer threads than asked for, and its memory climbs
 *     faster than linearly in Z there. The canvas model's thread terms were
 *     fitted on this same venue, so the term follows what it produced - but
 *     whether a container WITHOUT such a cap holds more or less is not
 *     established (lifting the cap from the job is not permitted on this
 *     runner). So the slope is not bent at 16 threads where the venue
 *     saturates: the straight line is the safe side of rows that are floors
 *     or capped, not a measurement of an uncapped container.
 *
 * THE FIT: the term is the smallest of its shape that makes the WHOLE
 * prediction (canvas model + term, the base then without a per-input term) at
 * or above 1.05× every row above (floors included, so a floor's real peak is
 * covered only to the extent the real peak is within 5 % of it) AND the term
 * itself at or above 1.05× each row's excess over its static twin, over the
 * one-zoom rows (plugin probes F4b / F4c, 2 / 16 / 32 / 48 threads) and the
 * older pinned and local-macOS rows as well (a search over the three
 * coefficients, total reservation minimised, then each coefficient rounded up;
 * with the per-slice and flat parts at 44 and 26 the thread slope needs 6.39,
 * so 6.5). The binding rows are the 720p ones at 2 threads (Z = 28-30) and at
 * 16 (Z = 23), and the one-zoom 16-thread row; at 2 and 16 threads the
 * tightest row sat within 1.06-1.09× of the reservation, at 32 threads the line
 * sat 1.3× or more above every row (the floors 2.2-2.6×). With the per-input
 * term in the base (below) the sweep's whole prediction is 1.14× or more at 16
 * threads and 1.5× or more at 32. The term was NOT refit: its own 1.05× excess
 * requirement still binds on the older pinned rows (2 threads) and the one-zoom
 * macOS row (16), and the smallest slope that meets every requirement with the
 * new base is 6.36, i.e. 6.5 again. The term scales with the canvas megapixels
 * like the rest of the model (the windows are canvas-sized); 720p binds per
 * megapixel, so the 1080p rows are reserved well above their measured peaks.
 * Only 720p and 1080p were measured: 4K follows the megapixels, not a
 * measurement (Speaker View draws at most 1080p, so no 4K zoom slice is
 * launched today).
 *
 * WHAT IT COSTS: a 30-zoom 1080p slice at production's 32 threads reserves
 * 16,471 MiB on one input (the bent fit 12,191; before the per-zoom term 2,237)
 * and 17,011 for a two-camera Speaker View slice (3 inputs, see BASE PER CAMERA),
 * so the 25,622 MiB budget admits ONE of them at a time (it was eleven). A
 * 30-zoom 720p proxy slice reserves 7,464 (8,004 on 3 inputs).
 *
 * FEW ZOOMS AMONG MANY SEGMENTS (measured 2026-10-11, the same harness and
 * venue, N = 30, 3 reps, highest peak shown). A zoom starts at a speaker change
 * and runs to the END of the slice (a carried window), so Z = N − the index of
 * the first change: a change in the last segment draws one zoom, in the third
 * from last four. `z0` = one camera (2 inputs, no change), `mc3` = Apply EDL's
 * static multicam twin (4 inputs), `zK` = K zooms (3 inputs). Peak MiB, and the
 * reservation (canvas model + the per-input term below + the term above) in
 * brackets:
 *
 *   1080p final     z0          mc3           z1            z2            z4
 *     T = 2        987 (1136)  1,037 (1136)  1,109 (1308)  1,196 (1389)  1,291 (1551)
 *     T = 16     1,427 (1583)  1,580 (1835)  1,581 (2069)  1,704 (2339)  1,796 (2878)
 *     T = 32     1,862 (2093)  2,269 (2633)  2,340 (2940)  2,705 (3425)  2,528 (4395)
 *   720p proxy
 *     T = 2        441  (648)    498  (648)    519  (724)    557  (760)    608  (832)
 *     T = 16       848  (916)  1,019 (1168)    972 (1203)  1,049 (1323)  1,111 (1562)
 *     T = 32     1,160 (1223)  1,580 (1763)  1,415 (1750)  1,674 (1965)  1,585 (2397)
 *
 * What it shows. (1) The term covers every excess over the static multicam
 * twin, by the same 5 %. (2) Before the per-input term the WHOLE reservation did
 * not cover every few-zoom slice: at 16 and 32 threads the static multicam
 * slice itself held more than the canvas model predicted (the base gap, up to
 * −628 MiB, −40 %, at 720p / 32 threads / N = 30), and a slice with few zooms had
 * little term to make up for it (720p at 32 threads reserved 0.85-0.86× of
 * Z = 1-2). (3) Memory is NOT monotone in Z at fixed N on this venue at 32
 * threads (Z = 4 holds less than Z = 2): ffmpeg asked for more threads than the
 * pid cap allows (the refused thread creations climb with Z), so those rows too
 * are what the venue produced. (4) The input count is what the gap follows: one
 * camera (z0) holds 10-27 % less than the 4-input twin at 16 and 32 threads.
 *
 * BASE PER CAMERA (decided 2026-10-11). The canvas model's base was fitted on
 * single-source slices, one input file (4K and 1080p, N = 2 ... 30). A slice that
 * opens several source files holds more at 16+ threads: each input's decoder
 * runs its own `-threads` frame threads. So the base carries a term per extra
 * input and per decode / filter thread above the 2 the base is anchored at:
 *
 *   per-input ≈ (inputs − 1)·(T − 2)·9·S MiB,   inputs = the ffmpeg input files
 *               (`-i`) the launch opens, T = the graph's side of the counts,
 *               S = max(1, largest camera MP ÷ 1080p MP)   (see 4K SCALING).
 *
 * It is zero for ONE input at any thread count (the 38 single-source rows of
 * `ffmpeg-memory-model.test.ts` are reserved exactly as before, inside the same
 * 1.4× ceiling) and at or below 2 threads (the base already covered every
 * multicam row there, 1.09× or more). In MiB, not per canvas megapixel: the gap
 * in MiB is larger at 720p than at 1080p because the cameras are 1080p whatever
 * the canvas, so a per-megapixel term sized for the 720p rows reserves the 1080p
 * ones far above their peaks.
 *
 * FIT (measured rows only, no new probe): the smallest coefficient with every
 * multicam row at 1.05× or more, over the 24 static twins (4 inputs), the 6
 * N = 30 twins of the few-zoom runs (4), the 6 one-camera `z0` rows (2), the 18
 * few-zoom rows (3) and the 48 sweep rows (3, one speaker change = two cameras
 * and the master), whole prediction with the zoom term unchanged. The binding
 * row is `z0` at 720p / 32 threads (the single camera and the master's sound,
 * 8.84 MiB per thread, rounded up to 9); the 4-input twins sit at 1.09× or more.
 * A second coefficient, per segment, ((inputs − 1)·(T − 2)·(2.6 + 0.21·N)),
 * also meets the target; it was left out as the simpler form that meets it is
 * one coefficient (it reserves 970 against 1,527 MiB for a 4-input 720p N = 1
 * launch at 32 threads, and the same at N = 30).
 *
 * WHAT THE COUNT IS. A timeline slice counts `inputIds.length` - the distinct
 * source files its segments read (a multicam edit's cameras and the master's
 * sound file) - plus the sound files its inline-sound twin would open when it is
 * a picture-only chunk (`omitAudio`): every row behind the term is a launch with
 * its sound inline, so the sound input's own share cannot be separated from a
 * camera's. A chunk that touches two of an edit's three cameras counts two. The
 * silent lavfi generator is not an input. The launches that decode one file (a
 * re-encode, the yt-dlp recode, the media proxy, the face detector's frame
 * decode) pass 1. A launch that cannot state its count is charged
 * `UNKNOWN_INPUTS` = 4, the largest measured. Nothing about it needs the plugin
 * contract: the host opens the files, so it counts them.
 *
 * 4K SCALING (decided 2026-10-11). Every measured camera was 1080p, and a
 * decoder's frame threads hold frames of the CAMERA's size, so the term scales
 * by S = max(1, the largest camera's megapixels ÷ 1080p's 2.0736): unchanged at
 * or below 1080p (every measured row), ×4 for 4K cameras (4 inputs at 32
 * threads: +3,240 MiB instead of +810), ×1.78 for 1440p. The slice learns the
 * sizes from the sources it downloads (an ffprobe of each picture source in
 * `renderEdlTimeline`, passed as `SliceOptions.sourceSizes` and carried in
 * `memoryBasis.cameraMegapixels`); a camera whose size is not known (no probe,
 * or it failed) counts as 4K. The scale is NOT measured above 1080p - it follows
 * the frame size, not a row.
 *
 * NOT MEASURED: the thread term at more than 4 inputs is a straight
 * extrapolation; only decode / filter threads were varied together (the term
 * follows the graph's side by mechanism).
 * `defaultPeakMemoryMiB` (a launch that predicts nothing: a sound-only slice,
 * an unclassified launch) carries no input term, it stays 393 + 22.9·T.
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

/** The zoom's terms (MiB), per canvas megapixel: a per-slice part, and per
 *  zoomed segment a flat part plus a per-thread part of the graph's side - one
 *  straight slope in the threads (the rows past 16 are floors or ran into the
 *  venue's pid cap, so the line is not bent where the venue saturates). */
const ZOOM_PER_MEGAPIXEL_MIB = 44
const ZOOM_SEGMENT_PER_MEGAPIXEL_MIB = 26
const ZOOM_SEGMENT_PER_MEGAPIXEL_THREAD_MIB = 6.5

/** The per-input part: MiB per extra input per decode / filter thread above
 *  the two the base model is anchored at (`BASE_THREADS`). Canvas-independent:
 *  the cameras are whatever size they are, not the canvas's. */
const INPUT_PER_THREAD_MIB = 9
const INPUT_BASE_THREADS = 2

/** What a launch with an input count it cannot state is charged: the largest
 *  count the model was measured on (three cameras and the master's sound). */
export const UNKNOWN_INPUTS = 4

/** The cameras the per-input term was measured on: 1080p (1920 x 1080). */
const CAMERA_REFERENCE_MEGAPIXELS = (1920 * 1080) / 1e6

/** A camera's picture size in megapixels - what `extras.cameraMegapixels` takes. */
export const cameraMegapixelsOf = (size: { readonly width: number; readonly height: number }): number =>
  (size.width * size.height) / 1e6

/** What a launch declares beyond its canvas and segments. */
export interface PictureMemoryExtras {
  /** HOW MANY FILES the launch opens as ffmpeg inputs (`-i`; a lavfi generator
   *  is not one): 1 for a launch that decodes one file, a slice's distinct
   *  sources for a timeline slice. REQUIRED, so every caller has to say; pass
   *  `undefined` only for a launch that truly cannot know, which is charged
   *  `UNKNOWN_INPUTS` (conservative). */
  readonly inputs: number | undefined
  /** The LARGEST camera's picture size in megapixels (`cameraMegapixelsOf`): the
   *  per-input term scales by it over a 1080p camera's, floored at 1, so cameras
   *  at or below 1080p change nothing. REQUIRED, like `inputs`; `undefined` = a
   *  camera whose size is not known, assumed 4K (conservative). Moot for one
   *  input (the term is zero), so those callers pass what they decode. */
  readonly cameraMegapixels: number | undefined
  /** How many of the slice's segments draw a zoom
   *  (`EdlPictureFragment.memoryHint`). 0 or absent: none. */
  readonly zoomSegments?: number
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
 *  per-input term when it opens more than one file (`extras.inputs`) and the
 *  zoom's term when `extras.zoomSegments` says the slice draws any. */
export function canvasPeakMemoryMiB(
  canvas: { readonly width: number; readonly height: number },
  segments: number,
  threads: FfmpegThreads,
  extras: PictureMemoryExtras,
): number {
  const megapixels = (canvas.width * canvas.height) / 1e6
  const perMegapixel =
    PER_MEGAPIXEL_MIB +
    PER_MEGAPIXEL_SEGMENT_MIB * Math.max(1, segments) +
    PER_MEGAPIXEL_ENCODE_THREAD_MIB * threads.encode +
    PER_MEGAPIXEL_DECODE_THREAD_MIB * decodeSide(threads)
  const zoomSegments = extras.zoomSegments ?? 0
  const zoom = zoomSegments > 0 ? zoomPeakMemoryMiB(canvas, threads, zoomSegments) : 0
  return Math.ceil(BASE_MIB + megapixels * perMegapixel + inputsPeakMemoryMiB(threads, extras.inputs, extras.cameraMegapixels) + zoom)
}

/** The per-input term in MiB, unrounded: (inputs − 1)·(T − 2)·9·S, T the graph's
 *  side of the launch's counts (decode / filter), S = max(1, the largest
 *  camera's megapixels ÷ a 1080p camera's) - zero at or below 2 threads and for
 *  one input. `inputs` is floored; absent, below 1 or not a number it is
 *  `UNKNOWN_INPUTS`. A camera size that is absent or not a positive number is
 *  4K (S = 4). */
export function inputsPeakMemoryMiB(threads: FfmpegThreads, inputs: number | undefined, cameraMegapixels: number | undefined): number {
  const count = inputs !== undefined && Number.isFinite(inputs) && inputs >= 1 ? Math.floor(inputs) : UNKNOWN_INPUTS
  const camera = cameraMegapixels !== undefined && Number.isFinite(cameraMegapixels) && cameraMegapixels > 0 ? cameraMegapixels : cameraMegapixelsOf(UHD_CANVAS)
  const scale = Math.max(1, camera / CAMERA_REFERENCE_MEGAPIXELS)
  return (count - 1) * Math.max(0, decodeSide(threads) - INPUT_BASE_THREADS) * INPUT_PER_THREAD_MIB * scale
}

/** The zoom's own term in MiB, unrounded, for a slice that draws
 *  `zoomSegments` (Z ≥ 1) zoomed segments:
 *  MP·(44 + Z·(26 + 6.5·T)), T the graph's side of
 *  the launch's counts (`canvasPeakMemoryMiB` with `{ zoomSegments }`). */
export function zoomPeakMemoryMiB(
  canvas: { readonly width: number; readonly height: number },
  threads: FfmpegThreads,
  zoomSegments: number,
): number {
  const megapixels = (canvas.width * canvas.height) / 1e6
  const t = decodeSide(threads)
  const perZoom = ZOOM_SEGMENT_PER_MEGAPIXEL_MIB + ZOOM_SEGMENT_PER_MEGAPIXEL_THREAD_MIB * t
  return megapixels * (ZOOM_PER_MEGAPIXEL_MIB + Math.max(1, zoomSegments) * perZoom)
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
  return canvasPeakMemoryMiB({ width: 0, height: 0 }, 1, { decode: 1, filter: 1, encode: 1 }, { inputs: 1, cameraMegapixels: undefined })
}
