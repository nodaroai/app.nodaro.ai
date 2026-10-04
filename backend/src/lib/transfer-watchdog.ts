/**
 * The BODY limits of a transfer that is allowed to be big — one rule shared by
 * `downloadFile`'s big-media path (`providers/video/ffmpeg-utils.ts`, Track
 * 0.19, decided 2026-09-25) and the storage client's own reads (`lib/storage.ts`,
 * Track 0.12, decided 2026-10-04), so the two can never drift apart:
 *
 *  - a known-size body gets its size at the floor rate (at least the grace, at
 *    most the overall ceiling — `downloadBodyDeadlineMs`); an unknown size gets
 *    the ceiling;
 *  - every window must deliver a minimum number of bytes — but only once the
 *    grace has passed since the transfer STARTED, so it is never stricter than
 *    a flat bound of that length.
 *
 * Pure timers: the caller owns the transfer and decides how to stop it (abort
 * a fetch, destroy a stream). Every reason reads like the big-media path's
 * ("longer than … for its size", "too slow — …"); the caller prefixes it.
 */
import { downloadBodyDeadlineMs } from "../providers/video/ffmpeg-timeouts.js"

export interface TransferRateLimits {
  /** The grace: within this long of the start the rate never applies, and the
   *  least time a body gets. */
  readonly responseMs: number
  /** The body is checked once per window of this length ... */
  readonly windowMs: number
  /** ... and stopped when a window delivers fewer bytes than this. */
  readonly minBytesPerWindow: number
  /** A known-size body gets size ÷ this (at least `responseMs`). */
  readonly floorBytesPerSec: number
  /** Nothing takes longer than this. */
  readonly maxMs: number
}

export interface TransferWatch {
  /** Count bytes as they arrive (feeds the current rate window). */
  readonly count: (bytes: number) => void
  /** Clear every timer — call on success AND failure. */
  readonly stop: () => void
}

const seconds = (ms: number) => `${Math.round(ms / 1000)} s`

/**
 * Start the body limits of a transfer that began at `startedAt` (ms epoch).
 * `stop(reason)` is called at most once, with a human reason; the watch then
 * clears itself.
 */
export function watchTransferBody(opts: {
  readonly limits: TransferRateLimits
  readonly sizeBytes?: number
  readonly startedAt: number
  readonly stop: (reason: string) => void
}): TransferWatch {
  const { limits } = opts
  const known = typeof opts.sizeBytes === "number" && Number.isFinite(opts.sizeBytes) && opts.sizeBytes > 0
  const bodyMs = downloadBodyDeadlineMs(known ? opts.sizeBytes : undefined, {
    minMs: limits.responseMs, floorBytesPerSec: limits.floorBytesPerSec, maxMs: limits.maxMs,
  })
  let stopped = false
  let windowBytes = 0
  const clear = () => {
    clearTimeout(deadline)
    clearInterval(rate)
  }
  const fire = (reason: string) => {
    if (stopped) return
    stopped = true
    clear()
    opts.stop(reason)
  }
  const deadline = setTimeout(
    () => fire(`longer than ${seconds(bodyMs)} for its size (${known ? `${Math.round(opts.sizeBytes! / (1024 * 1024))} MB` : "unknown"})`),
    bodyMs,
  )
  const rate = setInterval(() => {
    if (Date.now() - opts.startedAt >= limits.responseMs && windowBytes < limits.minBytesPerWindow) {
      fire(`too slow — ${windowBytes} bytes in the last ${seconds(limits.windowMs)}, under the ${limits.minBytesPerWindow} minimum`)
      return
    }
    windowBytes = 0
  }, limits.windowMs)
  return {
    count: (bytes) => { windowBytes += bytes },
    stop: () => { stopped = true; clear() },
  }
}
