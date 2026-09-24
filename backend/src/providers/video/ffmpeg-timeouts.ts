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

/** Wall-clock ceiling `downloadFile` gives one fetch (safeFetch's timeout).
 *  NOT a bound on the R2-origin 404 fallback inside it, which goes through the
 *  storage client — that client has no request timeout. */
export const DOWNLOAD_TIMEOUT_MS = 120_000

/** Wall-clock ceiling of one `runFfprobe` call (its execFile watchdog). */
export const FFPROBE_TIMEOUT_MS = 120_000
