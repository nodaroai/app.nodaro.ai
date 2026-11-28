/**
 * How much of the box one render may use: its browser tabs and its encoder's
 * threads. Both follow the cores the renderer can SEE unless they are told
 * otherwise, and every tab and every encoder thread counts toward the one
 * limit a container has on processes and threads together.
 *
 * Measured 2026-11-26, two 1080×1920 renders with a video layer at once, on a
 * box showing 10 CPUs (threads at the peak, all programs of both renders):
 *   - 8 tabs each, encoder left to itself (the renderer's own choice): 491 —
 *     the tabs' processes 263, the two encoders 88;
 *   - 4 tabs each, encoder left to itself: 367, and no slower (30 s vs 37 s:
 *     sixteen tabs on ten CPUs only take turns);
 *   - 4 tabs each, encoder at 8 threads: 343, in 27 s.
 * A tab's process held about 10 threads when it saw 4 CPUs and about 14 when
 * it saw 10, so the same two renders hold far more where 32 or more are
 * visible: on 2026-11-25 two of them at 8 tabs used every thread a container
 * may have (`render-shortage.ts`).
 */
import { availableParallelism, cpus } from "node:os"
import { affinityCpuCount, ffmpegThreads, ffmpegThreadsFor, withFfmpegThreads, type FfmpegThreads, type ReadText } from "../providers/video/ffmpeg-threads.js"

/** The most tabs one render opens unless `REMOTION_CONCURRENCY` says otherwise (decided 2026-11-26; the renderer's own ceiling is 8). */
export const RENDER_TAB_CAP = 4
/** A 3D scene's tabs: each WebGL tab owns renderer threads of its own. */
export const SCENE_RENDER_TABS = 2
/** The most CPUs one render's encoder is sized for. It runs beside the tabs
 *  that draw the frames and is never the slow part: at 8 threads x264 encodes
 *  1080p many times faster than the tabs produce frames. */
export const RENDER_ENCODER_CPUS = 8

/** The CPUs the renderer counts on this box: what `nproc` prints, never more than Node's own count. */
export function renderCpuCount(): number {
  const node = typeof availableParallelism === "function" ? availableParallelism() : cpus().length
  return Math.max(1, Math.min(node, affinityCpuCount() ?? node))
}

/**
 * The tabs one render of `compositionId` opens. An operator's
 * `REMOTION_CONCURRENCY` is used as given. Otherwise: a 3D scene opens
 * {@link SCENE_RENDER_TABS}; every other composition opens what the renderer
 * would pick itself (half the CPUs, at most 8) but never more than
 * {@link RENDER_TAB_CAP} — and never more than the CPUs, which the renderer
 * refuses.
 */
export function remotionConcurrencyFor(
  compositionId: string,
  configured: number | null | undefined,
  cpuCount: number = renderCpuCount(),
): number {
  if (configured !== null && configured !== undefined) return configured
  const available = Math.max(1, Math.floor(cpuCount))
  if (compositionId === "3d-scene") return Math.min(SCENE_RENDER_TABS, available)
  const renderersOwn = Math.round(Math.min(8, Math.max(1, cpuCount / 2)))
  return Math.max(1, Math.min(RENDER_TAB_CAP, renderersOwn, available))
}

/**
 * The thread counts of one render's encoder: the box's own counts for an
 * ffmpeg (`ffmpegThreads`: a CPU quota below the cores it sees, the 16-CPU
 * ceiling), never more than {@link RENDER_ENCODER_CPUS}.
 */
export function renderEncoderThreads(read?: ReadText): FfmpegThreads {
  const boxCounts = ffmpegThreads(read)
  const visible = affinityCpuCount(read) ?? cpus().length
  return ffmpegThreadsFor(Math.min(RENDER_ENCODER_CPUS, boxCounts?.decode ?? visible))
}

let warnedUnplaced = false

/**
 * The renderer's ffmpeg command lines (the encoder its frames are piped into,
 * and the final mux) with the render's thread counts placed in them — the same
 * placement every ffmpeg the backend launches gets. The renderer builds these
 * itself and passes no counts, so its encoder would size itself by every core
 * it sees. Hand this to `renderMedia` as `ffmpegOverride`.
 *
 * A command line the placement cannot read for certain is returned as given
 * (it never guesses), with one warning: the renderer changed its command.
 */
export function renderFfmpegArgs(
  info: { readonly type: string; readonly args: readonly unknown[] },
  threads: FfmpegThreads = renderEncoderThreads(),
): string[] {
  // The renderer leaves numbers in its list (the frame rate); ffmpeg gets strings either way.
  const args = info.args.map((arg) => String(arg))
  const placed = withFfmpegThreads(args, threads)
  if (!placed.includes("-threads") && !warnedUnplaced) {
    warnedUnplaced = true
    console.warn(`[render-worker] the renderer's ${info.type} command could not be given thread counts — it runs with ffmpeg's own`)
  }
  return placed
}
