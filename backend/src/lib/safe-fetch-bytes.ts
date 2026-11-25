import { safeFetch } from "./safe-fetch.js"
import { limitInWords, readWithin, transferDeadline } from "./transfer-watchdog.js"

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

/** Shared decoded-byte limiter for memory and disk consumers. No origin read
 * fallback is permitted, including on an own-storage HTTP 404. `timeoutMs` is
 * one limit over the response AND the body: our own timer, whose signal goes
 * to the fetch and ends every read, so a body that stalls or trickles stops
 * at it (`transferDeadline`). */
export async function* boundedPublicChunks(url: string, options: {
  maxBytes: number; timeoutMs: number; label: "Image" | "Video" | "File"; signal?: AbortSignal
}): AsyncGenerator<Buffer> {
  const { maxBytes, timeoutMs, label, signal } = options
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 500 * 1024 * 1024
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error("Invalid public download limits")
  // Worded like this module's other errors: no link (a caller logs the message).
  const reason = () => Object.assign(new Error(`${label} download timed out: over its ${limitInWords(timeoutMs)} limit`), { name: "TimeoutError" })
  const deadline = transferDeadline({ ms: timeoutMs, reason, ...(signal ? { signal } : {}) })
  try {
    yield* readBounded(url, { maxBytes, timeoutMs, label, signal: deadline.signal })
  } finally {
    deadline.clear()
  }
}

async function* readBounded(url: string, options: {
  maxBytes: number; timeoutMs: number; label: "Image" | "Video" | "File"; signal: AbortSignal
}): AsyncGenerator<Buffer> {
  const { maxBytes, timeoutMs, label, signal } = options
  // safeFetch's own timer is only a backstop past the limit.
  const response = await safeFetch(url, { timeoutMs: timeoutMs + 5_000, signal })
  const reader = response.body?.getReader()
  if (!reader) throw new Error(`${label} download returned no body`)
  let finished = false
  try {
    if (!response.ok) throw new Error(`${label} download failed`)
    if (Number(response.headers.get("content-length")) > maxBytes) throw new PublicDownloadTooLargeError(`${label} download exceeds the size limit`)
    let length = 0
    while (true) {
      const part = await readWithin(signal, reader.read())
      if (part.done) { finished = true; break }
      length += part.value.byteLength
      if (length > maxBytes) throw new PublicDownloadTooLargeError(`${label} download exceeds the size limit`)
      yield Buffer.from(part.value)
    }
    if (!length) throw new Error(`${label} download returned no bytes`)
  } finally {
    if (!finished) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
