import { safeFetch } from "./safe-fetch.js"
import {
  DEFAULT_DOWNLOAD_LIMITS,
  limitInWords,
  readWithin,
  transferDeadline,
  watchTransferBody,
  type TransferRateLimits,
  type TransferWatch,
} from "./transfer-watchdog.js"

const MAX_CAPTURE_BYTES = 25 * 1024 * 1024

/** A public download that passed its byte cap. `code` lets a caller tell
 *  "too large" from "unreachable" without matching message text. */
export class PublicDownloadTooLargeError extends Error {
  readonly code = "download_too_large"
}

/** Public HTTP retrieval with the normal SSRF checks and a decoded-byte cap.
 * This does not authorize a source or attach storage credentials. `signal`
 * aborts the download early (the 30 s timeout applies either way). */
export async function safeFetchBytes(url: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_CAPTURE_BYTES) {
    throw new Error("Invalid image download limit")
  }
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of boundedPublicChunks(url, { maxBytes, timeoutMs: 30_000, label: "Image", signal })) {
    chunks.push(chunk); length += chunk.length
  }
  return Buffer.concat(chunks, length)
}

/** The most a size-scaled public download (`rate`) may take in all: the
 *  default download path's own ceiling. */
export const PUBLIC_DOWNLOAD_MAX_MS = DEFAULT_DOWNLOAD_LIMITS.maxMs

/** The ceiling of a size-scaled video download a synchronous request waits on
 *  (a plugin route's kept provider video, a source frame): 10 min — 500 MB at
 *  about 0.85 MB/s — not the default path's 30, which no request should wait. */
export const REQUEST_PATH_DOWNLOAD_MAX_MS = 10 * 60_000

/** The size-scaled rule for a download on a request path: the default path's
 *  body rule (`DEFAULT_DOWNLOAD_LIMITS`) under {@link REQUEST_PATH_DOWNLOAD_MAX_MS}. */
export const REQUEST_PATH_VIDEO_DOWNLOAD: TransferRateLimits = Object.freeze({
  ...DEFAULT_DOWNLOAD_LIMITS,
  maxMs: REQUEST_PATH_DOWNLOAD_MAX_MS,
})

type Label = "Image" | "Video" | "File"

/** Shared decoded-byte limiter for memory and disk consumers. No origin read
 * fallback is permitted, including on an own-storage HTTP 404.
 *
 * FLAT (no `rate`, every image- and document-sized caller): `timeoutMs` is one
 * limit over the response AND the body — our own timer, whose signal goes to
 * the fetch and ends every read, so a body that stalls or trickles stops at it
 * (`transferDeadline`).
 *
 * SIZE-SCALED (`rate`, for a caller fetching up to hundreds of MB from a host
 * that may be slow — normally `DEFAULT_DOWNLOAD_LIMITS`, the default download
 * path's own rule): `timeoutMs` bounds the RESPONSE only (status + headers);
 * the body is then held to `watchTransferBody` — never judged within
 * `rate.responseMs` of the start, then every `rate.windowMs` window must
 * deliver `rate.minBytesPerWindow` (a stall or a drip-feed ends), and a body
 * that announces its size (uncompressed) gets that size at
 * `rate.floorBytesPerSec`. Nothing runs past `rate.maxMs` from the start
 * (response and body together): that ceiling is the real bound a caller's own
 * budget counts. A flat 120 s would need 4.2 MB/s sustained for 500 MB. */
export async function* boundedPublicChunks(url: string, options: {
  maxBytes: number; timeoutMs: number; label: Label; signal?: AbortSignal; rate?: TransferRateLimits
}): AsyncGenerator<Buffer> {
  const { maxBytes, timeoutMs, label, signal, rate } = options
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 500 * 1024 * 1024
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("Invalid public download limits")
  if (rate && !validRate(rate)) throw new Error("Invalid public download limits")
  if (rate) {
    yield* readSizeScaled(url, { maxBytes, timeoutMs, label, rate, ...(signal ? { signal } : {}) })
    return
  }
  // Worded like this module's other errors: no link (a caller logs the message).
  const reason = () => timedOut(label, `over its ${limitInWords(timeoutMs)} limit`)
  const deadline = transferDeadline({ ms: timeoutMs, reason, ...(signal ? { signal } : {}) })
  try {
    yield* readBounded(url, { maxBytes, fetchTimeoutMs: timeoutMs, label, signal: deadline.signal })
  } finally {
    deadline.clear()
  }
}

function validRate(r: TransferRateLimits): boolean {
  const positive = (n: number) => Number.isSafeInteger(n) && n >= 1
  return positive(r.responseMs) && positive(r.windowMs) && positive(r.minBytesPerWindow) && positive(r.floorBytesPerSec)
    && positive(r.maxMs) && r.maxMs <= PUBLIC_DOWNLOAD_MAX_MS
}

/** A `TimeoutError` in this module's words (no link). */
function timedOut(label: Label, what: string): Error {
  return Object.assign(new Error(`${label} download timed out: ${what}`), { name: "TimeoutError" })
}

/** The size-scaled read (see {@link boundedPublicChunks}): three limits, one signal. */
async function* readSizeScaled(url: string, o: {
  maxBytes: number; timeoutMs: number; label: Label; rate: TransferRateLimits; signal?: AbortSignal
}): AsyncGenerator<Buffer> {
  const startedAt = Date.now()
  const limit = new AbortController()
  const stop = (what: string) => { if (!limit.signal.aborted) limit.abort(timedOut(o.label, what)) }
  // The overall ceiling, from the start: response and body together.
  const overall = transferDeadline({
    ms: o.rate.maxMs,
    reason: () => timedOut(o.label, `over its ${limitInWords(o.rate.maxMs)} overall limit`),
    signal: o.signal ? AbortSignal.any([o.signal, limit.signal]) : limit.signal,
  })
  const response = setTimeout(() => stop(`no response within ${limitInWords(o.timeoutMs)}`), o.timeoutMs)
  ;(response as { unref?: () => void }).unref?.()
  let body: TransferWatch | undefined
  try {
    yield* readBounded(url, {
      maxBytes: o.maxBytes,
      // safeFetch's own timer must not end a body still inside the ceiling.
      fetchTimeoutMs: o.rate.maxMs,
      label: o.label,
      signal: overall.signal,
      onResponse: (res) => {
        clearTimeout(response)
        // Only an unencoded length is the size of what arrives.
        const encoded = (res.headers.get("content-encoding") ?? "identity").trim().toLowerCase() !== "identity"
        const size = encoded ? undefined : Number(res.headers.get("content-length") ?? Number.NaN)
        body = watchTransferBody({ limits: o.rate, ...(size !== undefined ? { sizeBytes: size } : {}), startedAt, stop })
      },
      onChunk: (bytes) => body?.count(bytes),
    })
  } finally {
    clearTimeout(response)
    body?.stop()
    overall.clear()
  }
}

async function* readBounded(url: string, options: {
  maxBytes: number; fetchTimeoutMs: number; label: Label; signal: AbortSignal
  onResponse?: (response: Response) => void; onChunk?: (bytes: number) => void
}): AsyncGenerator<Buffer> {
  const { maxBytes, fetchTimeoutMs, label, signal } = options
  // safeFetch's own timer is only a backstop past the limit.
  const response = await safeFetch(url, { timeoutMs: fetchTimeoutMs + 5_000, signal })
  const reader = response.body?.getReader()
  if (!reader) throw new Error(`${label} download returned no body`)
  let finished = false
  try {
    if (!response.ok) throw new Error(`${label} download failed`)
    if (Number(response.headers.get("content-length")) > maxBytes) throw new PublicDownloadTooLargeError(`${label} download exceeds the size limit`)
    options.onResponse?.(response)
    let length = 0
    while (true) {
      const part = await readWithin(signal, reader.read())
      if (part.done) { finished = true; break }
      length += part.value.byteLength
      if (length > maxBytes) throw new PublicDownloadTooLargeError(`${label} download exceeds the size limit`)
      options.onChunk?.(part.value.byteLength)
      yield Buffer.from(part.value)
    }
    if (!length) throw new Error(`${label} download returned no bytes`)
  } finally {
    if (!finished) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
