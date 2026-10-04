/**
 * The storage client's bounds (Track 0.12, decided 2026-10-04). The ONE place
 * the numbers live: `lib/storage.ts` builds the client from them, and every
 * send that moves a known number of bytes takes its budget from here.
 *
 * Before this the client had no request handler, and `@smithy/node-http-handler`
 * defaults to no timeout at all — every storage call could hang forever.
 * What bounds what (pinned by `__tests__/storage-handler-timeouts.test.ts`):
 *
 *  - `connectionTimeout` + `requestTimeout` (with `throwOnRequestTimeout` — a
 *    bare `requestTimeout` only logs a warning) bound a call up to the
 *    response headers. That includes WRITING an upload's body (the response
 *    comes after it), so a PUT or a copy of a known size gets a per-call
 *    budget scaled to its bytes (`storageTransferOptions`).
 *  - Nothing in the handler bounds a response BODY: its timers are cleared at
 *    the headers, and `socketTimeout` ≥ 6 s is registered too late to fire. A
 *    body we read gets the big-media body rule instead
 *    (`STORAGE_DOWNLOAD_LIMITS` with `watchTransferBody`). No `socketTimeout`:
 *    a short one would also kill a viewer's stream that is merely paused.
 *
 * The values match the big-media downloads' (Track 0.19, decided 2026-09-25):
 * 120 s to answer, a 2 MB/s floor for a known size, at least 15 MB per 60 s
 * after a 120 s grace, 60 minutes overall. A timed-out call is retried by the
 * SDK — 3 attempts — so its ceiling counts every attempt.
 */
import {
  DOWNLOAD_FLOOR_BYTES_PER_SEC,
  DOWNLOAD_MAX_MS,
  DOWNLOAD_MIN_BYTES_PER_WINDOW,
  DOWNLOAD_RATE_WINDOW_MS,
  DOWNLOAD_TIMEOUT_MS,
} from "../providers/video/ffmpeg-timeouts.js"
import { Transform, type Readable } from "node:stream"
import { watchTransferBody, type TransferRateLimits } from "./transfer-watchdog.js"

/** Opening a connection to the store. */
export const STORAGE_CONNECT_TIMEOUT_MS = 10_000

/** A call up to its response headers — every call that moves no sizeable body. */
export const STORAGE_RESPONSE_TIMEOUT_MS = DOWNLOAD_TIMEOUT_MS

/** A known-size transfer is given its size at this rate (at least the response bound). */
export const STORAGE_FLOOR_BYTES_PER_SEC = DOWNLOAD_FLOOR_BYTES_PER_SEC

/** Attempts per call, timeouts included (the SDK's standard retry). A stream
 *  body is never retried (the SDK cannot replay it). */
export const STORAGE_MAX_ATTEMPTS = 3

/** Pooled connections per client (the SDK default is 50). The connect bound
 *  counts the wait for a free connection, so a full pool would fail calls to a
 *  healthy store with a "could not connect" error (decided 2026-10-04). */
export const STORAGE_MAX_SOCKETS = 256

/** When the SDK runs its socket-usage check (it logs only once every pooled
 *  connection to an origin is in use AND twice as many calls wait). Left at its
 *  default — request + connect bound — the check could never run before the
 *  connect bound failed the call; a wait shorter than that saturation still
 *  logs nothing, and fails as "did not establish a connection". */
export const STORAGE_POOL_WARNING_MS = 5_000

/** The client's request handler — a plain options object the SDK builds its
 *  `NodeHttpHandler` (and that handler's own connection pool) from. Uploads of
 *  2 MB or more still ask `Expect: 100-continue` first and wait for the answer
 *  within their budget — R2, MinIO and AWS answer it (decided 2026-10-04). */
export const STORAGE_HANDLER_OPTIONS = Object.freeze({
  connectionTimeout: STORAGE_CONNECT_TIMEOUT_MS,
  requestTimeout: STORAGE_RESPONSE_TIMEOUT_MS,
  throwOnRequestTimeout: true,
  socketAcquisitionWarningTimeout: STORAGE_POOL_WARNING_MS,
  httpAgent: Object.freeze({ maxSockets: STORAGE_MAX_SOCKETS }),
  httpsAgent: Object.freeze({ maxSockets: STORAGE_MAX_SOCKETS }),
})

/** What EVERY `new S3Client(...)` in the backend spreads in — the storage
 *  clients and the Scene3D private-bucket clients alike (a guard test fails the
 *  build for one that does not). A fresh object per client, so each client
 *  builds its own handler and connection pool. */
export function boundedStorageClientConfig(): { maxAttempts: number; requestHandler: typeof STORAGE_HANDLER_OPTIONS } {
  return {
    maxAttempts: STORAGE_MAX_ATTEMPTS,
    requestHandler: {
      ...STORAGE_HANDLER_OPTIONS,
      httpAgent: { ...STORAGE_HANDLER_OPTIONS.httpAgent },
      httpsAgent: { ...STORAGE_HANDLER_OPTIONS.httpsAgent },
    },
  }
}

/** One attempt at a transfer of `bytes`: its size at the floor rate, never
 *  less than the response bound. */
export function storageTransferTimeoutMs(bytes: number | undefined): number {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return STORAGE_RESPONSE_TIMEOUT_MS
  return Math.max(STORAGE_RESPONSE_TIMEOUT_MS, Math.ceil((bytes / STORAGE_FLOOR_BYTES_PER_SEC) * 1000))
}

/** The per-call options for a send that writes (or copies) `bytes` — pass as
 *  `s3.send(command, storageTransferOptions(bytes))`, merged with any other. */
export function storageTransferOptions(bytes: number | undefined): { requestTimeout: number } {
  return { requestTimeout: storageTransferTimeoutMs(bytes) }
}

/** The body rule for an object we READ (`downloadR2ObjectToFile`,
 *  `readR2Object`): the big-media numbers. */
export const STORAGE_DOWNLOAD_LIMITS: TransferRateLimits = Object.freeze({
  responseMs: DOWNLOAD_TIMEOUT_MS,
  windowMs: DOWNLOAD_RATE_WINDOW_MS,
  minBytesPerWindow: DOWNLOAD_MIN_BYTES_PER_WINDOW,
  floorBytesPerSec: DOWNLOAD_FLOOR_BYTES_PER_SEC,
  maxMs: DOWNLOAD_MAX_MS,
})

/**
 * A storage body the APP reads — not a viewer's stream, which stays bounded at
 * the headers only (decided 2026-10-04) — under the body rule. Returns the
 * stream to read instead of `body`. A tripped limit errors it with
 * "Download timeout: <the limit>: <label>". Whenever the returned stream closes
 * before the source has ended — a tripped limit, or the reader giving up (a
 * cancellation, a size cap) — the source is destroyed and `controller` (the
 * signal the GetObject was sent with) is aborted: destroying the SDK's checksum
 * wrapper alone leaves the connection open, holding a pooled socket.
 * `startedAt`: when the response headers arrived, so the grace is the body's.
 */
export function guardStorageReadBody(
  body: Readable,
  opts: {
    readonly sizeBytes?: number | null
    readonly startedAt: number
    readonly label: string
    readonly controller?: AbortController
    readonly limits?: TransferRateLimits
  },
): Readable {
  const guarded = new Transform({
    transform(chunk: Buffer, _enc, cb) { watch.count(chunk.length); cb(null, chunk) },
  })
  const watch = watchTransferBody({
    limits: opts.limits ?? STORAGE_DOWNLOAD_LIMITS,
    sizeBytes: opts.sizeBytes ?? undefined,
    startedAt: opts.startedAt,
    stop: (reason) => {
      const err = new Error(`Download timeout: ${reason}: ${opts.label}`)
      guarded.destroy(err)
      body.destroy(err)
      opts.controller?.abort(err)
    },
  })
  // Nobody may be reading yet when a limit trips or a caller destroys the body
  // with an error (a cancellation before its read loop): with `pipe`'s own
  // listener the only one, the error would be re-emitted as an uncaught
  // exception and take the process down. A reader (`for await`, `pipeline`)
  // attaches its own listener and still gets the error.
  guarded.on("error", () => {})
  let sourceEnded = false
  body.once("end", () => { sourceEnded = true })
  guarded.once("close", () => {
    watch.stop()
    if (sourceEnded) return
    if (!body.destroyed) body.destroy()
    opts.controller?.abort()
  })
  body.on("error", (err) => { if (!guarded.destroyed) guarded.destroy(err) })
  body.pipe(guarded)
  return guarded
}
