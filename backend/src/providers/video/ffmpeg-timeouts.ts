/**
 * The ceilings `ffmpeg-utils.ts` gives its spawns, fetches and probes, in a
 * leaf with no imports — so a PURE budget (`apply-edl-budget.ts`) can count
 * the steps it runs at the same numbers without dragging `child_process`,
 * the storage client or `config` into its importer's graph (the workflow
 * engine reads apply-edl's budget to size its own node ceilings).
 * `ffmpeg-utils.ts` re-exports all three; either import path is the same value.
 */
// Hard ceiling so a hung ffmpeg can't hold its slot forever and starve the
// FIFO queue. (It once had to stay below a 15-min BullMQ lockDuration; the
// video worker's lock is 5 min now and BullMQ renews it while the processor
// runs, so the lock no longer constrains this.) Exported so a handler that
// budgets its own liveness (`HandlerFn.livenessBudgetMs`) can count the
// spawns it makes at the default ceiling with the same number.
export const DEFAULT_FFMPEG_TIMEOUT_MS = 10 * 60 * 1000

/** How long `downloadFile` waits for a response (status + headers), and the
 *  least time it ever gives a body. A body is then bounded by
 *  `downloadBodyDeadlineMs` and the per-window minimum rate, never by this. NOT
 *  a bound on the R2-origin 404 fallback, which goes through the storage client
 *  — that client has no request timeout. */
export const DOWNLOAD_TIMEOUT_MS = 120_000

/** A big-media download is checked once per window of this length ... */
export const DOWNLOAD_RATE_WINDOW_MS = 60_000

/** ... and must deliver at least this many bytes in every window — 15 MB a
 *  minute, about 2 Mbit/s (decided 2026-09-25). A dead or deliberately
 *  drip-fed transfer (a hostile URL holding a worker) fails within a minute; a
 *  real camera transfer, even over a slow self-hoster link, is far faster. */
export const DOWNLOAD_MIN_BYTES_PER_WINDOW = 15 * 1024 * 1024

/** The most one big-media download may write to disk: a 3-hour 4K original
 *  fits. Guards a fast hostile server from filling the worker's disk. */
export const BIG_MEDIA_MAX_BYTES = 64 * 1024 * 1024 * 1024

/** The slowest a live transfer is assumed to run when its size is known — the
 *  body gets `size ÷ this` (at least `DOWNLOAD_TIMEOUT_MS`). 2 MB/s (16 Mbit/s)
 *  is conservative for a cloud worker and a self-hoster's link alike. */
export const DOWNLOAD_FLOOR_BYTES_PER_SEC = 2 * 1024 * 1024

/** The most one download may ever take, whatever its size (a 3-hour 1080p
 *  camera file is ~15 GB). THE per-download ceiling a declared liveness budget
 *  counts (`applyEdlRenderBudgetMs`, `audioSyncRenderBudgetMs`). */
export const DOWNLOAD_MAX_MS = 60 * 60_000

/** The time a body of `contentLength` bytes is given: its size at the floor
 *  rate, at least `DOWNLOAD_TIMEOUT_MS`, at most `DOWNLOAD_MAX_MS`. Unknown size
 *  → the maximum (the stall guard is what catches a dead one). */
export function downloadBodyDeadlineMs(
  contentLength: number | undefined,
  limits: { readonly minMs: number; readonly floorBytesPerSec: number; readonly maxMs: number } = {
    minMs: DOWNLOAD_TIMEOUT_MS,
    floorBytesPerSec: DOWNLOAD_FLOOR_BYTES_PER_SEC,
    maxMs: DOWNLOAD_MAX_MS,
  },
): number {
  if (contentLength === undefined || !Number.isFinite(contentLength) || contentLength <= 0) return limits.maxMs
  return Math.min(limits.maxMs, Math.max(limits.minMs, Math.ceil((contentLength / limits.floorBytesPerSec) * 1000)))
}

/** Wall-clock ceiling of one `runFfprobe` call (its execFile watchdog). */
export const FFPROBE_TIMEOUT_MS = 120_000

/** Per-spawn ceiling of the media-proxy encode (`services/media-proxy.ts`): a
 *  3-hour 360p / 16 kHz proxy can run well past `DEFAULT_FFMPEG_TIMEOUT_MS`.
 *  Faster than real time at those settings, so a backstop, not a target. Here
 *  so a pure budget (audio-sync's) counts the proxy step at the same number. */
export const MEDIA_PROXY_FFMPEG_TIMEOUT_MS = 45 * 60_000
