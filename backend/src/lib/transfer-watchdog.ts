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
import {
  DEFAULT_DOWNLOAD_FLOOR_BYTES_PER_SEC,
  DEFAULT_DOWNLOAD_MAX_MS,
  DEFAULT_DOWNLOAD_MIN_BYTES_PER_WINDOW,
  DEFAULT_DOWNLOAD_RATE_WINDOW_MS,
  DOWNLOAD_TIMEOUT_MS,
  downloadBodyDeadlineMs,
} from "../providers/video/ffmpeg-timeouts.js"

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

/** The default download path's body limits (`DEFAULT_DOWNLOAD_*`, decided
 *  2026-11-24): looser than big media's, since their callers fetch provider
 *  results that can be large on slow hosts — see the constants' header in
 *  `ffmpeg-timeouts.ts`. `downloadFile` runs its default path under them
 *  (re-exported from `ffmpeg-utils.ts`), and a large public fetch opts into
 *  them (`boundedPublicChunks`'s `rate`). Here, not in `ffmpeg-utils.ts`, so
 *  that a caller of the public fetch does not load the ffmpeg runtime. */
export const DEFAULT_DOWNLOAD_LIMITS: TransferRateLimits = Object.freeze({
  responseMs: DOWNLOAD_TIMEOUT_MS,
  windowMs: DEFAULT_DOWNLOAD_RATE_WINDOW_MS,
  minBytesPerWindow: DEFAULT_DOWNLOAD_MIN_BYTES_PER_WINDOW,
  floorBytesPerSec: DEFAULT_DOWNLOAD_FLOOR_BYTES_PER_SEC,
  maxMs: DEFAULT_DOWNLOAD_MAX_MS,
})

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

/**
 * A transfer's flat limit, held so it really ends the BODY. Give `signal` to
 * the fetch AND to whatever reads the body (`pipeline(..., { signal })`, or
 * {@link readWithin} around each read): the limit then stops the stream that
 * writes the bytes, not only the request.
 *
 * The limit is held on our own timer and the same signal goes to the code
 * that reads the body, so it ends the body whatever the fetch layer does with
 * its own timeout — as `downloadFile` does (`providers/video/ffmpeg-utils.ts`).
 * The timer is unref'd: a consumer that never finishes cannot hold the
 * process open at shutdown.
 *
 * The caller's own `signal` (a client that went away) stops it too, with the
 * caller's reason; the limit stops it with `reason()`. `timedOut()` tells the
 * two apart. Call `clear()` once the body is held — on every way out.
 */
export interface TransferDeadline {
  readonly signal: AbortSignal
  /** Whether this limit (not the caller's signal) stopped the transfer. */
  readonly timedOut: () => boolean
  /** Clear the timer and the caller listener. */
  readonly clear: () => void
}

export function transferDeadline(opts: {
  /** The limit, from now. */
  readonly ms: number
  /** The error the limit aborts with (named `TimeoutError` by convention). */
  readonly reason: () => Error
  readonly signal?: AbortSignal
}): TransferDeadline {
  const ctrl = new AbortController()
  let fired = false
  const timer = setTimeout(() => {
    if (ctrl.signal.aborted) return
    fired = true
    ctrl.abort(opts.reason())
  }, Math.max(0, opts.ms))
  ;(timer as { unref?: () => void }).unref?.()
  const outer = opts.signal
  const onCallerAbort = () => { if (!ctrl.signal.aborted) ctrl.abort(outer!.reason) }
  if (outer?.aborted) onCallerAbort()
  else outer?.addEventListener("abort", onCallerAbort, { once: true })
  return {
    signal: ctrl.signal,
    timedOut: () => fired,
    clear: () => {
      clearTimeout(timer)
      outer?.removeEventListener("abort", onCallerAbort)
    },
  }
}

/** A limit in words: whole minutes from ten minutes up, else seconds. */
export function limitInWords(limitMs: number): string {
  return limitMs >= 600_000 && limitMs % 60_000 === 0 ? `${limitMs / 60_000} min` : seconds(limitMs)
}

/** A `Download timeout:` error naming its limit, as `downloadFile`'s are —
 *  and its link only when given one (leave it out where the words reach a
 *  user or a log that keeps links out, as a signed link's query is a credential). */
export function downloadTimeoutError(limitMs: number, url?: string): Error {
  return Object.assign(new Error(`Download timeout: over its ${limitInWords(limitMs)} limit${url ? `: ${url}` : ""}`), { name: "TimeoutError" })
}

/**
 * `read` (one body read), or the signal's reason the moment it aborts —
 * whether or not the source honours the abort. A reader whose source ignores
 * the fetch's signal would otherwise wait on its next read for ever.
 */
export function readWithin<T>(signal: AbortSignal, read: Promise<T>): Promise<T> {
  if (signal.aborted) {
    read.catch(() => undefined)
    return Promise.reject(signal.reason)
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
    read.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v) },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e) },
    )
  })
}
